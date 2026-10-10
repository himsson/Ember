const fs = require('fs');
const path = require('path');
const providers = require('./providers');
const { resolveSafe, applyEdit } = require('./tools');

const SMALL_FILE = { lines: 260, chars: 14000 };
const PLACEHOLDER =
  /^[ \t]*(?:\/\/|#|\/\*|<!--|--|;)?[ \t]*(?:\.\.\.|…)[ \t]*(?:the[ \t]+)?(?:rest|existing|remaining|previous|other|same|unchanged)\b[^\n]*$|\b(?:rest|remainder) of (?:the |your )?(?:code|file|function|content|implementation)s?\b[^\n]{0,24}(?:here|remains?|stays?|unchanged|as before|goes)/im;
const ONLY =
  'Output ONLY the file content, from its first line to its last line. No explanations before or after it, no JSON, no markdown fences.';

function cleanRaw(text) {
  let t = String(text)
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .replace(/\r\n/g, '\n');
  if (/^\s*\{/.test(t)) {
    try {
      const o = JSON.parse(t);
      if (o && typeof o.content === 'string' && (o.tool || o.path || o.thought)) t = o.content;
    } catch {}
  }
  const fences = [...t.matchAll(/```[\w+.-]*\n([\s\S]*?)\n```/g)];
  if (fences.length) {
    const biggest = fences.reduce((a, b) => (b[1].length > a[1].length ? b : a));
    const outside = t.length - fences.reduce((n, f) => n + f[0].length, 0);
    if (fences.length === 1 || outside < 300) t = biggest[1];
  } else {
    t = t.replace(/^\s*```[\w+.-]*\n/, '').replace(/\n```\s*$/, '');
  }
  return t.replace(/^\n+/, '').replace(/\s+$/, '') + '\n';
}

async function rawReply(ctx, s, messages, onProgress) {
  let text = '';
  let msgs = messages;
  for (let part = 0; part < 4; part++) {
    const res = await providers.chat(ctx.settings, ctx.modelId, {
      kind: 'file',
      messages: msgs,
      numCtx: s.ctxMax,
      maxTokens: 4096,
      temperature: 0.1,
      think: ctx.thinkable ? false : undefined,
      signal: ctx.signal,
      meta: { lastUser: ctx.lastUser },
      onDelta: ({ text: partial }) => onProgress && onProgress(text + partial),
    });
    text += res.text;
    if (!res.truncated) break;
    msgs = [
      ...msgs,
      { role: 'assistant', content: res.text },
      {
        role: 'user',
        content:
          'Your output was cut off. Continue exactly from the character where you stopped. Do not repeat anything and do not add explanations.',
      },
    ];
  }
  return cleanRaw(text);
}

const lineCount = (t) => (t ? t.split('\n').length : 0);

// File content is asked for as plain text: small models fall apart when they must escape a whole file inside JSON.
async function draft(s, ctx, tool, args, wire, onProgress) {
  const full = resolveSafe(s.cwd, args.path);
  const rel = path.relative(s.cwd, full).split(path.sep).join('/');
  const exists = fs.existsSync(full) && fs.statSync(full).isFile();
  const old = exists ? fs.readFileSync(full, 'utf8') : '';
  const action = {
    role: 'assistant',
    content: JSON.stringify({
      tool,
      path: rel,
      ...(args.instruction ? { instruction: args.instruction } : {}),
    }),
  };

  const ask = async (prompt, check) => {
    let messages = [...wire, action, { role: 'user', content: prompt }];
    for (let attempt = 0; attempt < 2; attempt++) {
      const content = await rawReply(ctx, s, messages, onProgress);
      const problem = !content.trim()
        ? 'You returned nothing.'
        : PLACEHOLDER.test(content)
          ? 'You left a placeholder instead of real content. Every line of the file must be written out.'
          : check
            ? check(content)
            : '';
      if (!problem) return { content };
      if (attempt) return { error: problem + ' The file was not saved.' };
      messages = [
        ...messages,
        { role: 'assistant', content },
        { role: 'user', content: problem + ' ' + ONLY },
      ];
    }
  };

  if (tool === 'write_file') {
    const r = await ask(`Now write the file "${rel}". ${ONLY}`);
    return r.error ? r : { content: r.content, before: old };
  }
  if (tool === 'append_file') {
    const r = await ask(
      `Now write the text to add at the end of "${rel}". Output ONLY that text, nothing else, no markdown fences.`,
    );
    return r.error ? r : { content: r.content, before: old, append: true };
  }

  if (!exists) return { error: `File "${args.path}" does not exist. Create it with write_file.` };
  let why = '';
  if (args.find != null && args.replace != null) {
    const direct = applyEdit(old, String(args.find), String(args.replace));
    if (!direct.error) return { content: direct.text, before: old };
    why = direct.error;
  }
  const small = lineCount(old) <= SMALL_FILE.lines && old.length <= SMALL_FILE.chars;
  if (!small)
    return {
      error:
        why ||
        'This file is long, so it cannot be rewritten whole. Use read_file to see the part to change, then edit_file with "find" (exact lines copied from the file) and "replace".',
    };
  const instruction =
    args.instruction || (args.find != null ? `Replace this text:\n${args.find}\nwith:\n${args.replace}` : '');
  if (!instruction)
    return { error: 'edit_file needs "instruction": one sentence saying what to change in the file.' };
  const removing = /\b(remove|delete|drop|strip|shorten|clean|simplif)|удал|убер|сократ/i.test(instruction);
  const r = await ask(
    `Current content of "${rel}":\n<file>\n${old}</file>\n\nChange to make: ${instruction}\n\nWrite the complete updated file. Keep every line that does not need to change exactly as it is. ${ONLY}`,
    (content) => {
      if (content.trim() === old.trim()) return 'You returned the file without any change.';
      if (!removing && lineCount(old) > 20 && lineCount(content) < lineCount(old) * 0.5)
        return `You returned only ${lineCount(content)} of ${lineCount(old)} lines, so most of the file would be lost. Return the whole file with the change applied.`;
      return '';
    },
  );
  return r.error ? r : { content: r.content, before: old };
}

async function repair(s, ctx, rel, content, error, onProgress) {
  if (content.length > SMALL_FILE.chars * 1.5) return null;
  const fixed = await rawReply(
    ctx,
    s,
    [
      {
        role: 'system',
        content:
          'You fix syntax errors in files. You change as little as possible and keep everything else exactly as it is.',
      },
      {
        role: 'user',
        content: `File "${rel}":\n<file>\n${content}</file>\n\nIt fails with this error:\n${error}\n\nWrite the complete corrected file. ${ONLY}`,
      },
    ],
    onProgress,
  );
  if (!fixed.trim() || PLACEHOLDER.test(fixed) || lineCount(fixed) < lineCount(content) * 0.6) return null;
  return fixed;
}

module.exports = { draft, repair, cleanRaw, PLACEHOLDER };
