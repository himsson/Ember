const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const { TOOLS, TOOL_MAP, execTool, commandRisk, clip, checkSyntax } = require('./tools');
const writer = require('./writer');
const mcp = require('./mcp');
const gitx = require('./git');
const docs = require('./docs');
const checks = require('./checks');

let capture = null;
const setCapture = (fn) => (capture = fn);
const providers = require('./providers');
const store = require('./store');
const hardware = require('./hardware');
const engine = require('./engine');
const catalog = require('./catalog.json');

const bus = new EventEmitter();
const runs = new Map();
const uid = () => crypto.randomUUID().slice(0, 8);
const estTokens = (text) => Math.ceil(String(text).length / 3);
const KEEP_FULL = 8;

const emit = (sid, ev) => {
  const s = store.getSession(sid);
  if (s && s.hidden && ev.type === 'sessions') return;
  bus.emit('event', { sid, ...ev });
};
const isRunning = (sid) => runs.has(sid);

function publicState(s) {
  return {
    running: isRunning(s.id),
    title: s.title,
    cwd: s.cwd,
    mode: s.mode,
    model: s.model,
    effort: s.effort,
    preview: s.preview || '',
    checkpoints: s.checkpoints || [],
    plan: s.plan,
    planStep: s.planStep,
    changed: s.changed,
    agents: s.agents || {},
    ctxUsed: s.ctxUsed || 0,
    ctxMax: s.ctxMax || 0,
    activeModel: s.activeModel || '',
    phase: isRunning(s.id) ? s.phase || 'working' : '',
    speed: s.speed || 0,
  };
}
const pushState = (s) => emit(s.id, { type: 'state', state: publicState(s) });

function addItem(s, item) {
  item.id = item.id || uid();
  s.items.push(item);
  emit(s.id, { type: 'item', item });
  return item;
}
const updateItem = (s, item) => emit(s.id, { type: 'item', item });
function removeItem(s, item) {
  s.items = s.items.filter((i) => i !== item);
  emit(s.id, { type: 'remove', id: item.id });
}

const CODE_WORDS =
  /(код|скрипт|программ|приложен|сайт|функци|баг|ошибк|файл|html|css|python|javascript|java\b|kotlin|api|sql|code|script|app\b|bug|function|website|compile|собер|компил)/i;

function modelInfo(m) {
  const base = m.tag.replace(/:latest$/, '');
  const c = catalog.find((x) => x.tag === base || x.tag === m.tag);
  return {
    sizeGB: m.sizeGB || (c && c.sizeGB) || 0,
    cat: (c && c.cat) || (/coder|code|devstral/i.test(m.tag) ? 'code' : 'universal'),
    agent: (c && c.agent) || 2,
    thinking: !!(c && c.thinking),
    params: m.params || (c && c.params) || 0,
  };
}

const canSee = (m) =>
  m.provider === 'demo' ||
  VISION.test(m.tag) ||
  !!(catalog.find((c) => c.tag === m.tag.replace(/:latest$/, '')) || {}).vision;

function pickModel(session, installed, hw, userText, needVision) {
  if (session.model && session.model !== 'auto' && installed.models.some((m) => m.id === session.model))
    return session.model;
  let real = installed.models.filter((m) => m.provider !== 'demo');
  if (!real.length) return 'demo:demo';
  if (needVision && real.some(canSee)) real = real.filter(canSee);
  const wantCode = CODE_WORDS.test(userText);
  const speed = { fast: 3, ok: 2, slow: 1, no: 0 };
  const scored = real.map((m) => {
    const info = modelInfo(m);
    const level =
      m.provider === 'remote' ? 'fast' : info.sizeGB ? hardware.rate(info.sizeGB, hw).level : 'ok';
    const fit = info.cat === 'universal' ? 1 : (info.cat === 'code') === wantCode ? 2 : -1;
    const test = (store.getSettings().modelTests || {})[m.id];
    return {
      id: m.id,
      score:
        speed[level] * 10 +
        fit * 4 +
        info.agent * 3 +
        Math.min(info.params, 32) / 8 +
        (test ? test.score * 4 - 4 : 0),
    };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0].id;
}

function activeTools(planMode) {
  const web = store.getSettings().webAccess !== false;
  const ext = mcp.tools().length > 0;
  const memory = store.getSettings().memory !== false;
  return TOOLS.filter(
    (t) =>
      (t.name !== 'remember' || memory) &&
      (t.kind !== 'net' || web) &&
      (t.name !== 'use_tool' || (ext && !planMode)) &&
      (!planMode || t.kind === 'read' || t.kind === 'meta' || t.kind === 'net'),
  );
}
const VISION =
  /llava|vision|qwen2\.5vl|-vl\b|gemma3:(4|12|27)|minicpm-v|moondream|mistral-small3|pixtral|granite3\.2-vision/i;

function systemPrompt(s, { planMode, skills }) {
  const win = process.platform === 'win32';
  const tools = activeTools(planMode);
  const lines = [
    `You are Ember, an AI agent that works with files and programs on the user's computer.`,
    `Project folder: ${s.cwd}`,
    `System: ${win ? 'Windows, shell is cmd (use Windows commands: dir, type, python - not ls, cat, python3)' : os.platform() + ', shell is sh'}.`,
    ``,
    `You act by replying with ONE JSON object. After each action you get its RESULT, then you choose the next action.`,
    `Tools (put the name in "tool" and fill only the listed fields):`,
    ...tools.map((t) => `- ${t.name} {${t.fields.join(', ')}} - ${t.help}`),
    ``,
    `Rules:`,
    `1. One action per reply. Never write a RESULT yourself and never claim something you did not do.`,
    `2. All paths are relative to the project folder.`,
    `3. Never put file content inside the JSON. To create a file, use write_file with only "path": you are then asked to write the content as plain text. To change a file, use edit_file with "path" and "instruction" (one sentence: what to change).`,
    `4. When you are asked for file content, write the complete real file, every line, with no placeholders like "rest of code here".`,
    `5. After a FAILED result, read the message and fix the cause. Do not repeat the same action.`,
    `6. If a program needed to build or run something is missing, finish everything you can, then ask_user: offer to install it yourself or let the user install it. Installing always needs the user's consent.`,
    `7. Do not start servers or programs that wait for input. Tell the user how to start them.`,
    `8. When the work is done, or the user only asked a question, use finish. In "text" say briefly what you did, where the files are, and honestly what was not verified.`,
    `9. Write "text" and "question" in the language of the user.`,
  ];
  const me = store.getSettings();
  const known = me.memory !== false ? store.getMemory().trim() : '';
  if (known) lines.push(``, `What you remember about the user from earlier chats:`, clip(known, 1500));
  if (me.memory !== false)
    lines.push(
      `When the user tells you a lasting fact about themselves or how they like things done, save it with remember.`,
    );
  if (me.userName) lines.push(``, `The user's name is ${me.userName}. Address them by this name.`);
  if (planMode)
    lines.push(
      ``,
      `PLAN MODE: you may only read. Study the project, then use finish with a numbered step-by-step plan in "text". Do not change anything.`,
    );
  if (skills.length) {
    lines.push(
      ``,
      `Skills (ready instructions for common jobs). If one fits the task, load it first with use_skill:`,
    );
    for (const sk of skills) lines.push(`- ${sk.name}: ${sk.description}`);
  }
  const ext = planMode ? [] : mcp.tools().slice(0, 30);
  if (ext.length) {
    lines.push(``, `External tools (call one with use_tool and its "name"):`);
    for (const x of ext) lines.push(`- ${x.id}: ${x.description}`);
  }
  try {
    const mem = fs.readFileSync(path.join(s.cwd, 'EMBER.md'), 'utf8').trim();
    if (mem) lines.push(``, `Project notes from the user (EMBER.md):`, clip(mem, 1500));
  } catch {}
  if (s.plan.length && !planMode) {
    lines.push(``, `Plan for the current task:`);
    s.plan.forEach((p, i) => lines.push(`${i + 1}. ${p.done ? '[done] ' : ''}${p.text}`));
    lines.push(`Put the number of the plan step you are working on in "step".`);
  }
  return lines.join('\n');
}

const str = { type: 'string' };
function stepSchema(s, { planMode, effort }) {
  const tools = activeTools(planMode).map((t) => t.name);
  const props = {};
  const required = [];
  props.thought = str;
  required.push('thought');
  if (effort === 'extra' || effort === 'ultra') {
    props.check = str;
    required.push('check');
  }
  if (s.plan.length && !planMode) {
    props.step = { type: 'integer' };
    required.push('step');
  }
  props.tool = { type: 'string', enum: tools };
  required.push('tool');
  Object.assign(props, {
    path: str,
    name: str,
    pattern: str,
    line: { type: 'integer' },
    command: str,
    instruction: str,
    find: str,
    replace: str,
    question: str,
    options: { type: 'array', items: str },
    text: str,
  });
  return { type: 'object', properties: props, required };
}

const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    kind: { type: 'string', enum: ['chat', 'task'] },
    size: { type: 'string', enum: ['small', 'large'] },
    steps: { type: 'array', items: str },
  },
  required: ['kind', 'size', 'steps'],
};
const REVIEW_SCHEMA = {
  type: 'object',
  properties: { ok: { type: 'boolean' }, problems: { type: 'array', items: str } },
  required: ['ok', 'problems'],
};

function wireMessages(s, system) {
  const out = [{ role: 'system', content: system }];
  const cut = s.ctx.length - KEEP_FULL;
  s.ctx.forEach((e, i) => {
    const content = i < cut && e.short ? e.short : e.content;
    const images = e.images && i >= cut ? e.images : null;
    const last = out[out.length - 1];
    if (last.role === e.role) {
      last.content += '\n\n' + content;
      if (images) last.images = [...(last.images || []), ...images];
    } else out.push(images ? { role: e.role, content, images } : { role: e.role, content });
  });
  return out;
}

function shortAction(obj) {
  const o = { ...obj };
  for (const k of ['replace', 'find'])
    if (typeof o[k] === 'string' && o[k].length > 160) o[k] = `[${o[k].length} chars, omitted]`;
  return JSON.stringify(o);
}

async function compact(s, modelId, settings, { signal, manual } = {}) {
  if (s.ctx.length <= 4) return false;
  const keep = s.ctx.slice(-4);
  const old = s.ctx.slice(0, -4);
  const transcript = old
    .map((e) => `${e.role === 'assistant' ? 'AGENT' : 'USER/RESULT'}: ${e.short || clip(e.content, 600)}`)
    .join('\n');
  let summary = '';
  try {
    const res = await providers.chat(settings, modelId, {
      kind: 'compact',
      messages: [
        {
          role: 'system',
          content:
            'You compress the history of an AI agent session so that work can continue with a short memory. Write a summary under 250 words in the language of the user: the goal of the user, decisions made, every file created or changed and what it contains, problems met, and what is left to do. Plain text only.',
        },
        { role: 'user', content: clip(transcript, 14000) },
      ],
      numCtx: s.ctxMax,
      maxTokens: 700,
      signal,
      meta: {},
    });
    summary = res.text.trim();
  } catch (e) {
    if (e.name === 'AbortError') throw e;
  }
  if (!summary)
    summary =
      'Files changed so far: ' +
      (Object.keys(s.changed).join(', ') || 'none') +
      '. ' +
      clip(transcript, 1200);
  s.ctx = [
    { role: 'user', t: 'summary', content: '[Summary of the earlier conversation]\n' + summary },
    ...keep,
  ];
  addItem(s, {
    type: 'notice',
    kind: 'compact',
    text: manual ? 'Context compacted' : 'Context was almost full — compacted the history to continue',
    detail: summary,
  });
  return true;
}

function parseReply(text) {
  let t = String(text)
    .trim()
    .replace(/^<think>[\s\S]*?<\/think>/, '')
    .trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  const tries = [t, fence && fence[1], t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1)];
  for (const c of tries) {
    if (!c) continue;
    try {
      const o = JSON.parse(c);
      if (o && typeof o === 'object' && !Array.isArray(o)) return o;
    } catch {}
  }
  return null;
}

function liveThought(partial) {
  const m = partial.match(/"thought"\s*:\s*"((?:[^"\\]|\\.)*)/);
  if (!m) return '';
  return m[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
}

function needPermission(s, tool, args) {
  const kind = TOOL_MAP[tool].kind;
  const allow = s.allow || {};
  if (kind === 'edit') return s.mode === 'manual' && !allow.edit ? 'normal' : null;
  if (kind === 'net') return s.mode === 'manual' && !allow.net ? 'normal' : null;
  if (kind === 'exec') {
    const risk = commandRisk(String(args.command || ''));
    if (risk !== 'normal') return risk;
    return s.mode === 'auto' || allow.exec ? null : 'normal';
  }
  return null;
}

function askPermission(s, run, item) {
  return new Promise((resolve) => {
    run.waiting.set(item.id, resolve);
    emit(s.id, { type: 'item', item });
  });
}

function answerPermission(sid, itemId, decision) {
  const run = runs.get(sid);
  const resolve = run && run.waiting.get(itemId);
  if (!resolve) return false;
  run.waiting.delete(itemId);
  resolve(decision);
  return true;
}

async function planTask(s, ctx, refine) {
  const recent = s.ctx
    .slice(-5, -1)
    .filter((e) => e.t === 'user' || e.t === 'final' || e.t === 'summary')
    .map((e) => clip(e.content, 400))
    .join('\n');
  const res = await providers.chat(ctx.settings, ctx.modelId, {
    kind: 'plan',
    schema: PLAN_SCHEMA,
    messages: [
      {
        role: 'system',
        content:
          'You prepare work for an AI agent that can read, create and edit files, run shell commands and check installed programs in a project folder.\nDecide what the new user message is:\n- "chat": a question, greeting or discussion that needs no files and no commands. Then "steps" is empty.\n- "task": something to create, change, run or look up in files. Then give 2 to 6 short concrete steps, in the language of the user. The last step is always checking the result.\nAlso set "size". "large" means risky, hard to undo work: rewriting or restructuring many files, changing the architecture, migrations, mass renames, deleting things, upgrading dependencies. "small" is everything else: fixing one bug, adding a function, writing a few new files, answering a question.',
      },
      {
        role: 'user',
        content:
          (recent ? 'Earlier in the conversation:\n' + recent + '\n\n' : '') +
          'New user message:\n' +
          ctx.lastUser,
      },
    ],
    numCtx: s.ctxMax,
    maxTokens: 500,
    signal: ctx.signal,
    meta: { lastUser: ctx.lastUser },
  });
  const o = parseReply(res.text);
  if (!o || o.kind !== 'task' || !Array.isArray(o.steps) || !o.steps.length) return false;
  s.taskSize = o.size === 'large' ? 'large' : 'small';
  let steps = o.steps.slice(0, 7).map(String);
  if (refine) {
    const again = await providers.chat(ctx.settings, ctx.modelId, {
      kind: 'plan',
      schema: PLAN_SCHEMA,
      messages: [
        {
          role: 'system',
          content:
            'You review a work plan for an AI coding agent. Find missing steps, wrong order and vague steps, then return the improved plan: kind "task" and 2 to 7 short concrete steps in the language of the user. The last step is always checking the result.',
        },
        {
          role: 'user',
          content:
            'Task:\n' + ctx.lastUser + '\n\nPlan:\n' + steps.map((t, i) => i + 1 + '. ' + t).join('\n'),
        },
      ],
      numCtx: s.ctxMax,
      maxTokens: 500,
      signal: ctx.signal,
      meta: { lastUser: ctx.lastUser },
    });
    const better = parseReply(again.text);
    if (better && Array.isArray(better.steps) && better.steps.length >= 2)
      steps = better.steps.slice(0, 7).map(String);
  }
  s.plan = steps.map((t) => ({ text: t, done: false }));
  s.planStep = 1;
  return true;
}

async function reviewWork(s, ctx, files) {
  const parts = [];
  for (const rel of files.slice(0, 5)) {
    try {
      parts.push(`=== ${rel} ===\n` + clip(fs.readFileSync(path.join(s.cwd, rel), 'utf8'), 2500));
    } catch {}
  }
  if (!parts.length) return { ok: true, problems: [] };
  const res = await providers.chat(ctx.settings, ctx.modelId, {
    kind: 'review',
    schema: REVIEW_SCHEMA,
    messages: [
      {
        role: 'system',
        content:
          'You are a strict reviewer of work done by another AI agent. Check that the files do what the user asked and work together: no syntax errors, no missing functions, no references to files or ids that do not exist, no placeholder text instead of real code. Report only real problems that must be fixed, each in one sentence. If the work is acceptable, set ok to true and leave problems empty.',
      },
      {
        role: 'user',
        content: `The user asked:\n${ctx.lastUser}\n\nFiles written by the agent:\n${parts.join('\n\n')}`,
      },
    ],
    numCtx: s.ctxMax,
    maxTokens: 500,
    signal: ctx.signal,
    meta: {},
  });
  const o = parseReply(res.text);
  if (!o) return { ok: true, problems: [] };
  const problems = (Array.isArray(o.problems) ? o.problems : []).map(String).filter(Boolean).slice(0, 5);
  return { ok: !!o.ok || !problems.length, problems };
}

const HARD_CAP = 200;
const EFFORT = {
  low: { plan: false, think: false, reviews: 0 },
  medium: { plan: true, think: false, reviews: 0 },
  high: { plan: true, think: true, reviews: 1 },
  extra: { plan: true, think: true, reviews: 2 },
  ultra: { plan: true, think: true, reviews: 3 },
};

function stopLoop(s, why) {
  addItem(s, {
    type: 'notice',
    kind: 'loop',
    text: 'The model got stuck in a loop and was stopped. Rephrase the task or pick a larger model.',
    detail: why,
  });
}

async function runTurn(s, run) {
  const settings = store.getSettings();
  const hw = hardware.effective(settings);
  const installed = await providers.listInstalled(settings);
  const lastUser = clip([...s.ctx].reverse().find((e) => e.t === 'user').content, 3000);
  const needVision = s.ctx.slice(-KEEP_FULL).some((e) => e.images);
  const modelId = pickModel(s, installed, hw, lastUser, needVision);
  const picked = installed.models.find((m) => m.id === modelId);
  if (needVision && picked && !canSee(picked)) {
    const eye = installed.models.find((m) => m.provider !== 'demo' && canSee(m));
    if (!eye) {
      addItem(s, {
        type: 'error',
        text: 'This model cannot see images. Install a small one that can, for example Moondream (1.7 GB), and it will describe pictures for any model.',
      });
      return;
    }
    for (const e of s.ctx) {
      if (!e.images) continue;
      const seenText = [];
      for (const [k, b64] of e.images.entries()) {
        const r = await providers.chat(settings, eye.id, {
          kind: 'vision',
          messages: [
            {
              role: 'user',
              content:
                'Describe this image in detail for someone who cannot see it: every piece of text exactly as written, the layout, interface elements, colors, and anything that looks like an error.',
              images: [b64],
            },
          ],
          numCtx: 4096,
          maxTokens: 600,
          signal: run.abort.signal,
          meta: {},
        });
        seenText.push(`[Image ${k + 1}, described by another model]\n${r.text.trim()}`);
      }
      e.content += '\n\n' + seenText.join('\n\n');
      delete e.images;
    }
    addItem(s, { type: 'notice', kind: 'vision', text: 'Images were described by {0}', vars: [eye.name] });
  }
  await mcp.sync(settings.mcpServers).catch(() => {});
  const info = picked ? modelInfo(picked) : { sizeGB: 0, thinking: false };
  const effort = EFFORT[s.effort] ? s.effort : 'medium';
  const level = EFFORT[effort];
  const planMode = s.mode === 'plan';
  const skills = store.listSkills().filter((sk) => sk.enabled);
  const ctx = { settings, modelId, lastUser, signal: run.abort.signal, thinkable: !!info.thinking };

  s.activeModel = picked ? picked.name : modelId;
  const far = picked && picked.provider === 'remote';
  const fitsGpu = !far && info.sizeGB > 0 && hardware.rate(info.sizeGB, hw).level === 'fast';
  const ultra = s.effort === 'ultra';
  if (settings.numCtx) s.ctxMax = settings.numCtx;
  else if (ultra && picked && picked.provider === 'ollama')
    s.ctxMax = hardware.maxCtx(info.sizeGB, hw, await providers.ollama.contextLength(settings, picked.tag));
  else s.ctxMax = far ? 8192 : hardware.suggestCtx(info.sizeGB, hw);
  s.agents = { planner: 'idle', coder: 'idle', reviewer: 'idle' };
  const { provider, model: tag } = providers.split(modelId);
  const warm = provider !== 'ollama' || (await engine.loaded(settings)).includes(tag);
  s.phase = warm ? 'working' : 'loading';
  if (s.lastModel !== modelId) {
    addItem(s, {
      type: 'notice',
      kind: 'model',
      text: s.activeModel,
      auto: s.model === 'auto' && !!picked && picked.provider !== 'demo',
      ctx: s.ctxMax,
    });
    s.lastModel = modelId;
  }
  const loadedNow = () => {
    if (s.phase !== 'loading') return;
    s.phase = 'working';
    pushState(s);
  };
  pushState(s);

  const answering = s.ctx.length >= 2 && s.ctx[s.ctx.length - 2].t === 'question';
  if (!planMode && !answering && level.plan) {
    s.agents.planner = 'run';
    pushState(s);
    try {
      const made = await planTask(s, ctx, effort === 'ultra');
      if (!made && s.plan.every((p) => p.done)) s.plan = [];
    } catch (e) {
      if (e.name === 'AbortError' || e instanceof providers.ProviderError) throw e;
    }
    s.agents.planner = s.plan.length ? 'done' : 'skip';
    if (s.taskSize === 'large' && s.plan.length) {
      s.taskSize = 'small';
      const ref = gitx.checkpoint(s.cwd, lastUser);
      if (ref) {
        (s.checkpoints = s.checkpoints || []).unshift({ ref, at: Date.now(), label: clip(lastUser, 60) });
        s.checkpoints = s.checkpoints.slice(0, 10);
        addItem(s, {
          type: 'notice',
          kind: 'checkpoint',
          text: 'Large task — a checkpoint of the project was saved',
        });
      } else
        addItem(s, {
          type: 'notice',
          kind: 'checkpoint',
          text: 'Large task — changed files can be undone from the Files list',
        });
    }
  }
  s.agents.coder = 'run';
  pushState(s);

  const turnChanged = new Set();
  let bad = 0;
  let lastKey = '';
  let repeats = 0;
  let stepIndex = 0;
  let reviews = 0;
  const recent = [];
  let failStreak = 0;
  let verified = false;
  let tested = 0;
  let looked = false;
  const embedder = installed.models.find(
    (m) => m.provider === 'ollama' && /embed|minilm|bge-|nomic|\be5\b/i.test(m.tag),
  );
  const embed = embedder ? (texts) => providers.ollama.embed(settings, embedder.tag, texts) : null;
  let edits = 0;
  const failsByPath = new Map();

  for (let n = 0; ; n++) {
    if (n >= HARD_CAP) {
      addItem(s, {
        type: 'notice',
        kind: 'loop',
        text: 'Stopped after {0} steps. Write "continue" if the work is still on track.',
        vars: [HARD_CAP],
      });
      break;
    }
    const system = systemPrompt(s, { planMode, skills });
    let wire = wireMessages(s, system);
    let used = estTokens(wire.map((m) => m.content).join(''));
    if (used > s.ctxMax * 0.72) {
      if (await compact(s, modelId, settings, { signal: run.abort.signal })) {
        wire = wireMessages(s, system);
        used = estTokens(wire.map((m) => m.content).join(''));
      }
    }
    s.ctxUsed = used;
    pushState(s);

    const live = addItem(s, { type: 'thought', text: '', live: true });
    let lastEmit = 0;
    const res = await providers.chat(settings, modelId, {
      kind: 'step',
      schema: stepSchema(s, { planMode, effort }),
      messages: wire,
      numCtx: s.ctxMax,
      think: info.thinking ? level.think : undefined,
      gpuAll: ultra && fitsGpu,
      signal: run.abort.signal,
      meta: { stepIndex, lastUser },
      onDelta: ({ text, thinking }) => {
        loadedNow();
        const now = Date.now();
        if (now - lastEmit < 90) return;
        lastEmit = now;
        emit(s.id, { type: 'delta', id: live.id, text: liveThought(text) || thinking.slice(-600) });
      },
    });

    loadedNow();
    if (res.speed) s.speed = res.speed;
    const obj = parseReply(res.text);
    live.live = false;
    live.text = (obj && typeof obj.thought === 'string' && obj.thought.trim()) || res.thinking.trim();
    if (live.text) updateItem(s, live);
    else removeItem(s, live);

    if (!obj || !obj.tool) {
      if (
        !obj &&
        !res.truncated &&
        res.text.trim() &&
        !/^\s*[{[]/.test(res.text) &&
        bad === 0 &&
        !s.plan.some((p) => !p.done)
      ) {
        s.ctx.push({
          role: 'assistant',
          t: 'final',
          content: JSON.stringify({ tool: 'finish', text: res.text.trim() }),
        });
        addItem(s, { type: 'assistant', text: res.text.trim() });
        break;
      }
      if (++bad >= 3) {
        addItem(s, {
          type: 'error',
          text: 'The model answered in a broken format three times in a row. Rephrase the task or pick a larger model.',
        });
        break;
      }
      s.ctx.push({ role: 'assistant', t: 'action', content: clip(res.text, 400) });
      s.ctx.push({
        role: 'user',
        t: 'note',
        content: res.truncated
          ? 'Your reply was cut off because it was too long. Write long files in parts: write_file with the first 80 lines, then append_file for the rest.'
          : 'Your reply was not a valid JSON action. Reply with exactly one JSON object with the fields "tool" and its arguments.',
      });
      continue;
    }
    bad = 0;
    stepIndex++;

    const tool = String(obj.tool);
    const def = TOOL_MAP[tool];
    const args = {};
    if (def) for (const f of def.fields) if (obj[f] != null && obj[f] !== '') args[f] = obj[f];
    const action = { tool, ...args };
    if (obj.thought) action.thought = clip(String(obj.thought), 300);

    if (s.plan.length && Number.isInteger(obj.step)) {
      s.planStep = Math.max(1, Math.min(s.plan.length, obj.step));
      s.plan.forEach((p, i) => (p.done = p.done || i < s.planStep - 1));
    }

    const reject = (msg) => {
      s.ctx.push({
        role: 'assistant',
        t: 'action',
        content: JSON.stringify(action),
        short: shortAction(action),
      });
      s.ctx.push({ role: 'user', t: 'result', content: `RESULT of ${tool}: ${msg}` });
    };
    if (
      def &&
      !activeTools(planMode).includes(def) &&
      !(planMode && (def.kind === 'edit' || def.kind === 'exec'))
    ) {
      reject(
        `The tool ${tool} is not available now. Use one of: ${activeTools(planMode)
          .map((x) => x.name)
          .join(', ')}.`,
      );
      continue;
    }
    if (!def || (planMode && (def.kind === 'edit' || def.kind === 'exec'))) {
      reject(
        def
          ? 'Plan mode: you may only read. Put the plan in finish "text".'
          : `Unknown tool. Use one of: ${TOOLS.map((t) => t.name).join(', ')}.`,
      );
      continue;
    }
    const missing = def.required.filter((f) => args[f] == null);
    if (missing.length) {
      reject(
        `FAILED: missing field${missing.length > 1 ? 's' : ''} ${missing.map((m) => `"${m}"`).join(', ')}. ${tool} needs {${def.fields.join(', ')}}.`,
      );
      continue;
    }

    if (tool === 'finish') {
      const files = [...turnChanged].filter((f) => s.changed[f] && s.changed[f].status !== 'deleted');
      if (!verified && !planMode) {
        verified = true;
        const bad = files
          .map((f) => {
            const full = path.join(s.cwd, f);
            if (!fs.existsSync(full)) return `${f}: the file does not exist`;
            const r = checkSyntax(full);
            return /FAILED/.test(r) ? `${f}: ${clip(r, 400)}` : '';
          })
          .filter(Boolean);
        if (bad.length) {
          reject(
            'Not finished yet. These files are broken:\n- ' +
              bad.join('\n- ') +
              '\nFix them with edit_file, then use finish again.',
          );
          continue;
        }
      }
      if (tested < 3 && !planMode && files.length && settings.runTests !== false) {
        tested++;
        const command = checks.detect(s.cwd);
        if (command) {
          const item = addItem(s, {
            type: 'tool',
            tool: 'run_command',
            args: { command },
            status: 'running',
            result: '',
          });
          const risk = needPermission(s, 'run_command', { command });
          let ok = true;
          if (risk) {
            item.status = 'ask';
            item.risk = risk;
            ok = (await askPermission(s, run, item)) !== 'deny';
            item.status = 'running';
            updateItem(s, item);
          }
          const out = ok
            ? await execTool(
                'run_command',
                { command },
                { root: s.cwd, changed: s.changed, snapshots: s.snapshots, signal: run.abort.signal },
              )
            : '';
          const passed = !ok || /Exit code: 0\b/.test(out);
          item.status = !ok ? 'fail' : passed ? 'ok' : 'fail';
          item.denied = !ok;
          item.result = clip(out, 4000);
          updateItem(s, item);
          if (!passed) {
            reject(
              'Not finished yet. The project checks fail (' +
                command +
                '):\n' +
                clip(out, 1800) +
                '\nFix the cause, then use finish again.',
            );
            continue;
          }
        }
      }
      const page =
        files.find((f) => /(^|\/)index\.html?$/i.test(f)) || files.find((f) => /\.html?$/i.test(f));
      if (page) s.preview = page;
      if (page && capture && !looked && !planMode && level.reviews > 0) {
        looked = true;
        const eye =
          picked && canSee(picked) && picked.provider !== 'demo'
            ? picked
            : installed.models.find((m) => m.provider !== 'demo' && canSee(m));
        const shot = eye ? await capture(path.join(s.cwd, page)).catch(() => null) : null;
        if (shot) {
          const r = await providers
            .chat(settings, eye.id, {
              kind: 'review',
              schema: REVIEW_SCHEMA,
              messages: [
                {
                  role: 'user',
                  content:
                    'This is a screenshot of a web page that was just built for this request:\n' +
                    lastUser +
                    '\n\nLook for things that are visibly broken: an empty page, missing styles, overlapping or cut-off elements, unreadable text, error messages. Set ok to true if the page looks fine.',
                  images: [shot],
                },
              ],
              numCtx: 4096,
              maxTokens: 400,
              signal: run.abort.signal,
              meta: {},
            })
            .catch(() => null);
          const seen = r && parseReply(r.text);
          const problems =
            seen && !seen.ok && Array.isArray(seen.problems)
              ? seen.problems.map(String).filter(Boolean).slice(0, 4)
              : [];
          if (problems.length) {
            addItem(s, {
              type: 'notice',
              kind: 'review',
              text: 'The page was checked on a screenshot — fixing what looks wrong',
              detail: problems.map((p) => '• ' + p).join('\n'),
            });
            reject(
              'Not finished yet. A screenshot of ' +
                page +
                ' shows problems:\n- ' +
                problems.join('\n- ') +
                '\nFix them, then use finish again.',
            );
            continue;
          }
          addItem(s, {
            type: 'notice',
            kind: 'review-ok',
            text: 'The page was checked on a screenshot — it looks right',
          });
        }
      }
      if (reviews < level.reviews && files.length && !planMode) {
        reviews++;
        s.agents.coder = 'done';
        s.agents.reviewer = 'run';
        pushState(s);
        const verdict = await reviewWork(s, ctx, files).catch((e) => {
          if (e.name === 'AbortError') throw e;
          return { ok: true, problems: [] };
        });
        s.agents.reviewer = 'done';
        if (!verdict.ok) {
          addItem(s, {
            type: 'notice',
            kind: 'review',
            text: 'The reviewer found problems — fixing them',
            detail: verdict.problems.map((p) => '• ' + p).join('\n'),
          });
          reject(
            'Not finished yet. A reviewer checked your files and found problems:\n- ' +
              verdict.problems.join('\n- ') +
              '\nFix them with write_file or edit_file, then use finish again.',
          );
          s.agents.coder = 'run';
          pushState(s);
          continue;
        }
        addItem(s, {
          type: 'notice',
          kind: 'review-ok',
          text: 'The reviewer checked the files — no problems',
        });
      }
      s.ctx.push({
        role: 'assistant',
        t: 'final',
        content: JSON.stringify({ tool: 'finish', text: args.text }),
      });
      if (!planMode) s.plan.forEach((p) => (p.done = true));
      addItem(s, { type: 'assistant', text: String(args.text), planReady: planMode });
      break;
    }
    if (tool === 'ask_user') {
      const options = Array.isArray(args.options) ? args.options.map(String).filter(Boolean).slice(0, 4) : [];
      s.ctx.push({
        role: 'assistant',
        t: 'question',
        content: JSON.stringify({ tool, question: args.question, options }),
      });
      addItem(s, { type: 'question', text: String(args.question), options });
      break;
    }

    // Re-running a command after an edit is normal work, so reads and commands are keyed with the edit count.
    const key = tool + JSON.stringify(args) + (def.kind === 'edit' ? '' : '@' + edits);
    repeats = key === lastKey ? repeats + 1 : 0;
    lastKey = key;
    recent.push(key);
    if (recent.length > 8) recent.shift();
    if (recent.filter((k) => k === key).length >= 3) {
      stopLoop(s, 'It kept repeating the same actions.');
      break;
    }

    const item = addItem(s, { type: 'tool', tool, args: { ...args }, status: 'running', result: '' });
    const fileTool = tool === 'write_file' || tool === 'append_file' || tool === 'edit_file';
    let result;
    if (tool === 'remember') {
      result = store.addMemory(args.text)
        ? 'Saved. You will know this in future chats.'
        : 'You already remember this.';
    } else if (tool === 'use_skill') {
      const sk = skills.find((x) => x.name === String(args.name).trim());
      result = sk
        ? `Instructions of the skill "${sk.name}". Follow them:\n${clip(sk.body, 5000)}`
        : `There is no skill "${args.name}". Available: ${skills.map((x) => x.name).join(', ') || 'none'}.`;
    } else if (tool === 'use_tool') {
      const ext = mcp.tools().find((x) => x.id === String(args.name).trim());
      if (!ext)
        result = `There is no external tool "${args.name}". Available: ${
          mcp
            .tools()
            .map((x) => x.id)
            .join(', ') || 'none'
        }.`;
      else {
        const reply = await providers.chat(settings, modelId, {
          kind: 'args',
          schema: ext.inputSchema,
          messages: [
            ...wire,
            { role: 'assistant', content: JSON.stringify(action) },
            {
              role: 'user',
              content: `Give the arguments for the tool ${ext.id} as one JSON object.\nWhat the tool does: ${ext.description}`,
            },
          ],
          numCtx: s.ctxMax,
          maxTokens: 900,
          think: info.thinking ? false : undefined,
          signal: run.abort.signal,
          meta: {},
        });
        const input = parseReply(reply.text) || {};
        item.args.input = clip(JSON.stringify(input), 600);
        let decision = 'allow';
        if (s.mode !== 'auto' && !(s.allow && s.allow.mcp)) {
          item.status = 'ask';
          item.risk = 'normal';
          decision = await askPermission(s, run, item);
          if (decision === 'always') (s.allow = s.allow || {}).mcp = true;
        }
        if (decision === 'deny') {
          result =
            'The user did NOT allow this action. Do not retry it. Continue another way or use ask_user to find out what the user wants.';
          item.denied = true;
        } else {
          item.status = 'running';
          updateItem(s, item);
          result = await mcp.call(ext.id, input).then(
            (r) => clip(r, 6000),
            (e) => 'FAILED: ' + e.message,
          );
        }
      }
    } else {
      let drafted = null;
      if (fileTool) {
        let seen = 0;
        const progress = (text) => {
          const lines = text.split('\n').length;
          if (lines - seen < 4) return;
          seen = lines;
          item.lines = lines;
          updateItem(s, item);
        };
        try {
          drafted = await writer.draft(s, ctx, tool, args, wire, progress);
        } catch (e) {
          if (e.name === 'AbortError' || e instanceof providers.ProviderError) throw e;
          drafted = { error: e.message };
        }
        delete item.lines;
        if (drafted.error) result = 'FAILED: ' + drafted.error;
        else item.preview = { before: drafted.append ? '' : drafted.before, after: drafted.content };
      }
      const risk = result === undefined ? needPermission(s, tool, args) : null;
      let decision = 'allow';
      if (risk) {
        item.status = 'ask';
        item.risk = risk;
        decision = await askPermission(s, run, item);
        if (decision === 'always' && risk === 'normal') (s.allow = s.allow || {})[def.kind] = true;
      }
      delete item.preview;
      if (decision === 'deny') {
        result =
          'The user did NOT allow this action. Do not retry it. Continue another way or use ask_user to find out what the user wants.';
        item.denied = true;
      } else if (result === undefined) {
        item.status = 'running';
        updateItem(s, item);
        try {
          const env = {
            root: s.cwd,
            changed: s.changed,
            snapshots: s.snapshots,
            signal: run.abort.signal,
            embed,
          };
          if (drafted) {
            const rel = String(args.path).replace(/\\/g, '/').replace(/^\.\//, '');
            result = await execTool(
              tool === 'append_file' ? 'append_file' : 'write_file',
              { path: args.path, content: drafted.content },
              env,
            );
            const before = env.lastDiff ? env.lastDiff.before : '';
            for (let k = 0; k < 2 && /check FAILED/i.test(result); k++) {
              const current = fs.readFileSync(path.join(s.cwd, rel), 'utf8');
              const fixed = await writer
                .repair(s, ctx, rel, current, result.slice(result.indexOf('FAILED')), null)
                .catch((e) => {
                  if (e.name === 'AbortError') throw e;
                  return null;
                });
              if (!fixed) break;
              const again = await execTool('write_file', { path: args.path, content: fixed }, env);
              result = /check FAILED/i.test(again)
                ? again
                : again + ' A syntax error in the first version was repaired automatically.';
            }
            if (env.lastDiff) env.lastDiff = { before, after: env.lastDiff.after };
            turnChanged.add(rel);
            if (env.lastDiff && before.length + env.lastDiff.after.length < 80000) item.diff = env.lastDiff;
            delete item.args.find;
            delete item.args.replace;
          } else {
            result = await execTool(tool, args, env);
            if (def.kind === 'edit' && args.path)
              turnChanged.add(String(args.path).replace(/\\/g, '/').replace(/^\.\//, ''));
          }
        } catch (e) {
          if (e.name === 'AbortError') throw e;
          result = 'FAILED: ' + e.message;
        }
      }
    }
    if (run.abort.signal.aborted) {
      item.status = 'fail';
      item.result = 'Stopped';
      updateItem(s, item);
      const e = new Error('aborted');
      e.name = 'AbortError';
      throw e;
    }
    if (repeats === 1)
      result =
        'You already did exactly this and got the same result. Choose a different action or finish.\n' +
        result;
    const failed =
      item.denied ||
      /FAILED|does not exist|Refused|outside the project|NOT installed|not installed or not in PATH|timed out|Exit code: (?!0\b)/.test(
        result,
      );
    item.status = failed ? 'fail' : 'ok';
    item.result = clip(result, 4000);
    updateItem(s, item);
    failStreak = failed && !item.denied ? failStreak + 1 : 0;
    if (!failed && def.kind === 'edit') edits++;
    const pathFails = failed && args.path ? (failsByPath.get(args.path) || 0) + 1 : 0;
    if (pathFails) failsByPath.set(args.path, pathFails);

    s.ctx.push({
      role: 'assistant',
      t: 'action',
      content: JSON.stringify(action),
      short: shortAction(action),
    });
    s.ctx.push({
      role: 'user',
      t: 'result',
      content: `RESULT of ${tool}: ${result}`,
      short: `RESULT of ${tool}: ${clip(result, 300)}`,
    });
    pushState(s);
    store.saveSession(s);
    if (failStreak >= 6) {
      stopLoop(s, 'Six actions in a row ended with an error.');
      break;
    }
    if (pathFails >= 5) {
      stopLoop(s, 'It could not get this file right: ' + args.path);
      break;
    }
  }
}

async function expandMentions(cwd, text) {
  const out = [];
  const seen = new Set();
  for (const m of text.matchAll(/(?:^|\s)@([\w./\\-]+)/g)) {
    const rel = m[1].replace(/[.,;:]+$/, '');
    if (seen.has(rel) || out.length >= 5) continue;
    seen.add(rel);
    try {
      const full = path.resolve(cwd, rel);
      if (path.relative(cwd, full).startsWith('..') || !fs.existsSync(full)) continue;
      const st = fs.statSync(full);
      if (st.isDirectory()) out.push(`[Folder ${rel}]\n` + fs.readdirSync(full).slice(0, 60).join('\n'));
      else if (docs.isDocument(full) && st.size < 30000000)
        out.push(`[File ${rel}]\n` + clip(await docs.extract(full, fs.readFileSync(full)), 8000));
      else if (st.size < 300000) {
        const body = fs.readFileSync(full, 'utf8');
        if (!body.includes('\u0000')) out.push(`[File ${rel}]\n` + clip(body, 6000));
      }
    } catch {}
  }
  return out.length ? text + '\n\n' + out.join('\n\n') : text;
}

async function send(sid, text, images, attached) {
  const s = store.getSession(sid);
  if (!s) throw new Error('Chat not found');
  if (isRunning(sid)) throw new Error('The agent is still working');
  text = String(text).trim();
  const pics = (Array.isArray(images) ? images : [])
    .filter((d) => /^data:image\/(png|jpeg|webp|gif);base64,/.test(d))
    .slice(0, 4);
  const hasDocs = Array.isArray(attached) && attached.length > 0;
  if (!text && !pics.length && !hasDocs) return;
  if (!text)
    text = pics.length ? 'Look at the image.' : 'Read the attached document and tell me what is in it.';

  store.ensureCwd(s);
  if (!s.items.length) s.title = text.replace(/\s+/g, ' ').slice(0, 48);
  const names = (Array.isArray(attached) ? attached : []).slice(0, 4).map((d) => String(d.name).slice(0, 80));
  addItem(s, {
    type: 'user',
    text,
    ...(pics.length ? { images: pics } : {}),
    ...(names.length ? { docs: names } : {}),
  });
  store.saveSession(s);
  emit(sid, { type: 'sessions' });

  let content = text;
  const slash = text.match(/^\/([a-z0-9-]+)\s*([\s\S]*)$/i);
  if (slash) {
    const sk = store.listSkills().find((x) => x.name === slash[1].toLowerCase());
    if (sk)
      content = `${slash[2] || 'Use the skill.'}\n\n[The user chose the skill "${sk.name}". Follow its instructions:\n${clip(sk.body, 5000)}]`;
  }
  content = await expandMentions(s.cwd, content);
  for (const d of (Array.isArray(attached) ? attached : []).slice(0, 4))
    content += `\n\n[Attached document ${String(d.name).slice(0, 80)}]\n` + clip(String(d.text || ''), 12000);
  s.preview = '';
  s.ctx.push({
    role: 'user',
    t: 'user',
    content,
    ...(pics.length ? { images: pics.map((d) => d.slice(d.indexOf(',') + 1)) } : {}),
  });

  const run = { abort: new AbortController(), waiting: new Map() };
  runs.set(sid, run);
  pushState(s);
  try {
    await runTurn(s, run);
  } catch (e) {
    if (e.name === 'AbortError') addItem(s, { type: 'notice', kind: 'stop', text: 'Stopped' });
    else if (e instanceof providers.ProviderError)
      addItem(s, {
        type: 'error',
        text: e.message,
        hint: e.code === 'offline' ? 'Install the engine in the Library or choose the demo model.' : '',
      });
    else addItem(s, { type: 'error', text: 'Internal error: ' + e.message });
  } finally {
    for (const resolve of run.waiting.values()) resolve('deny');
    runs.delete(sid);
    for (const it of s.items) {
      if (it.live) it.live = false;
      if (it.type === 'tool' && (it.status === 'running' || it.status === 'ask')) it.status = 'fail';
    }
    s.items = s.items.filter((it) => !(it.type === 'thought' && !it.text));
    for (const k of Object.keys(s.agents || {})) if (s.agents[k] === 'run') s.agents[k] = 'done';
    store.saveSession(s);
    pushState(s);
    emit(sid, { type: 'sessions' });
  }
}

function stop(sid) {
  const run = runs.get(sid);
  if (!run) return;
  run.abort.abort();
  for (const [id, resolve] of run.waiting) {
    run.waiting.delete(id);
    resolve('deny');
  }
}

async function compactNow(sid) {
  const s = store.getSession(sid);
  if (!s || isRunning(sid)) return false;
  const settings = store.getSettings();
  const installed = await providers.listInstalled(settings);
  const modelId = pickModel(s, installed, hardware.effective(settings), '');
  runs.set(sid, { abort: new AbortController(), waiting: new Map() });
  pushState(s);
  try {
    const done = await compact(s, modelId, settings, { manual: true, signal: runs.get(sid).abort.signal });
    if (!done)
      addItem(s, { type: 'notice', kind: 'compact', text: 'Nothing to compact yet — the history is short' });
    s.ctxUsed = estTokens(s.ctx.map((e) => e.content).join(''));
  } catch (e) {
    addItem(s, { type: 'error', text: e.message });
  } finally {
    runs.delete(sid);
    store.saveSession(s);
    pushState(s);
  }
  return true;
}

function undo(sid, onlyPath) {
  const s = store.getSession(sid);
  if (!s || !s.cwd) throw new Error('Chat not found');
  if (isRunning(sid)) throw new Error('The agent is still working');
  const paths = Object.keys(s.changed).filter((p) => !onlyPath || p === onlyPath);
  for (const rel of paths) {
    const full = path.join(s.cwd, rel);
    const before = s.snapshots[rel];
    if (before == null) fs.rmSync(full, { force: true });
    else {
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, before, 'utf8');
    }
    delete s.changed[rel];
    delete s.snapshots[rel];
  }
  if (paths.length) {
    s.ctx.push({
      role: 'user',
      t: 'note',
      content: `[The user reverted your changes to: ${paths.join(', ')}. These files are back to their earlier state.]`,
    });
    addItem(s, {
      type: 'notice',
      kind: 'undo',
      text: paths.length === 1 ? 'Changes to {0} reverted' : 'Changes to {0} files reverted',
      vars: [paths.length === 1 ? paths[0] : paths.length],
    });
    store.saveSession(s);
    pushState(s);
  }
  return paths.length;
}

module.exports = {
  setCapture,
  bus,
  send,
  stop,
  undo,
  compactNow,
  answerPermission,
  publicState,
  isRunning,
  pickModel,
  parseReply,
};
