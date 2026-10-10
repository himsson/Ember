const engine = require('./engine');

class ProviderError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

async function readLines(res, onLine) {
  const dec = new TextDecoder();
  let buf = '';
  for await (const chunk of res.body) {
    buf += dec.decode(chunk, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line) onLine(line);
    }
  }
  if (buf.trim()) onLine(buf.trim());
}

async function request(url, opts, what) {
  let res;
  try {
    res = await fetch(url, opts);
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new ProviderError('The model engine is not responding. Check that it is running.', 'offline');
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    let msg = body;
    try {
      const j = JSON.parse(body);
      msg = (j.error && (j.error.message || j.error)) || body;
    } catch {}
    throw new ProviderError(`${what}: ${String(msg).slice(0, 300) || res.status}`, 'http');
  }
  return res;
}

const ollama = {
  base: (s) => (s.ollamaUrl || 'http://127.0.0.1:11434').replace(/\/+$/, ''),
  headers: () => ({ 'content-type': 'application/json' }),

  async status(s) {
    try {
      const res = await fetch(this.base(s) + '/api/version', {
        headers: this.headers(s),
        signal: AbortSignal.timeout(2500),
      });
      return res.ok ? { online: true, version: (await res.json()).version } : { online: false };
    } catch {
      return { online: false };
    }
  },

  async list(s) {
    const res = await request(
      this.base(s) + '/api/tags',
      { headers: this.headers(s), signal: AbortSignal.timeout(5000) },
      'Ollama',
    );
    const data = await res.json();
    return (data.models || []).map((m) => ({
      id: 'ollama:' + m.name,
      tag: m.name,
      provider: 'ollama',
      name: m.name,
      sizeGB: Math.round((m.size / 1024 ** 3) * 10) / 10,
      params: parseFloat((m.details && m.details.parameter_size) || '') || null,
      quant: (m.details && m.details.quantization_level) || '',
    }));
  },

  async chat(s, { model, messages, schema, numCtx, think, temperature, maxTokens, gpuAll, onDelta, signal }) {
    const body = {
      model,
      messages,
      stream: true,
      options: {
        num_ctx: numCtx || 8192,
        temperature: temperature == null ? 0.2 : temperature,
        num_predict: maxTokens || 4096,
      },
      keep_alive: (Number(s.keepAlive) || 10) + 'm',
    };
    if (gpuAll) body.options.num_gpu = 999;
    if (schema) body.format = schema;
    if (think != null) body.think = think;
    let res;
    try {
      res = await request(
        this.base(s) + '/api/chat',
        { method: 'POST', headers: this.headers(s), body: JSON.stringify(body), signal },
        'Ollama',
      );
    } catch (e) {
      if (think && e instanceof ProviderError && /think/i.test(e.message))
        return this.chat(s, { model, messages, schema, numCtx, temperature, maxTokens, onDelta, signal });
      throw e;
    }
    let text = '';
    let thinking = '';
    let truncated = false;
    let speed = 0;
    await readLines(res, (line) => {
      let j;
      try {
        j = JSON.parse(line);
      } catch {
        return;
      }
      if (j.error) throw new ProviderError('Ollama: ' + j.error, 'http');
      if (j.done && j.eval_count && j.eval_duration)
        speed = Math.round((j.eval_count / (j.eval_duration / 1e9)) * 10) / 10;
      if (j.message) {
        if (j.message.thinking) thinking += j.message.thinking;
        if (j.message.content) text += j.message.content;
        if (onDelta) onDelta({ text, thinking });
      }
      if (j.done && j.done_reason === 'length') truncated = true;
    });
    return { text, thinking, truncated, speed };
  },

  async contextLength(s, tag) {
    try {
      const res = await fetch(this.base(s) + '/api/show', {
        method: 'POST',
        headers: this.headers(s),
        body: JSON.stringify({ model: tag }),
        signal: AbortSignal.timeout(4000),
      });
      const info = (await res.json()).model_info || {};
      const key = Object.keys(info).find((k) => k.endsWith('.context_length'));
      return key ? Number(info[key]) || 0 : 0;
    } catch {
      return 0;
    }
  },

  async embed(s, model, texts) {
    const res = await request(
      this.base(s) + '/api/embed',
      {
        method: 'POST',
        headers: this.headers(s),
        body: JSON.stringify({ model, input: texts }),
        signal: AbortSignal.timeout(60000),
      },
      'Ollama',
    );
    return (await res.json()).embeddings;
  },

  async pull(s, tag, onProgress, signal) {
    const res = await request(
      this.base(s) + '/api/pull',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: tag, stream: true }),
        signal,
      },
      'Ollama',
    );
    await readLines(res, (line) => {
      const j = JSON.parse(line);
      if (j.error) throw new ProviderError('Ollama: ' + j.error, 'http');
      onProgress({ status: j.status, total: j.total || 0, completed: j.completed || 0 });
    });
  },

  async remove(s, tag) {
    await request(
      this.base(s) + '/api/delete',
      {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: tag }),
      },
      'Ollama',
    );
  },
};

const remote = {
  ...ollama,
  base: (s) =>
    String((s.remote || {}).url || '')
      .trim()
      .replace(/\/+$/, ''),
  headers: (s) => ({
    'content-type': 'application/json',
    authorization: 'Bearer ' + String((s.remote || {}).key || '').trim(),
  }),
  async list(s) {
    return (await ollama.list.call(this, s)).map((m) => ({
      ...m,
      id: 'remote:' + m.tag,
      provider: 'remote',
    }));
  },
};

const openai = {
  base: (s) => (s.openaiUrl || 'http://127.0.0.1:1234/v1').replace(/\/+$/, ''),
  headers: (s) => ({
    'content-type': 'application/json',
    ...(s.openaiKey ? { authorization: 'Bearer ' + s.openaiKey } : {}),
  }),

  async list(s) {
    if (!s.openaiEnabled) return [];
    const res = await request(
      this.base(s) + '/models',
      { headers: this.headers(s), signal: AbortSignal.timeout(3000) },
      'Model server',
    );
    const data = await res.json();
    return (data.data || []).map((m) => ({
      id: 'openai:' + m.id,
      tag: m.id,
      provider: 'openai',
      name: m.id,
      sizeGB: null,
      params: null,
      quant: '',
    }));
  },

  async chat(s, { model, messages, schema, temperature, maxTokens, onDelta, signal }) {
    const msgs = messages.map((m) =>
      m.images
        ? {
            role: m.role,
            content: [
              { type: 'text', text: m.content },
              ...m.images.map((b64) => ({
                type: 'image_url',
                image_url: { url: 'data:image/jpeg;base64,' + b64 },
              })),
            ],
          }
        : m,
    );
    const body = {
      model,
      messages: msgs,
      stream: true,
      temperature: temperature == null ? 0.2 : temperature,
      max_tokens: maxTokens || 4096,
    };
    if (schema)
      body.response_format = { type: 'json_schema', json_schema: { name: 'reply', strict: true, schema } };
    const res = await request(
      this.base(s) + '/chat/completions',
      { method: 'POST', headers: this.headers(s), body: JSON.stringify(body), signal },
      'Model server',
    );
    let text = '';
    let thinking = '';
    let truncated = false;
    await readLines(res, (line) => {
      if (!line.startsWith('data:')) return;
      const payload = line.slice(5).trim();
      if (payload === '[DONE]') return;
      let j;
      try {
        j = JSON.parse(payload);
      } catch {
        return;
      }
      const c = j.choices && j.choices[0];
      if (!c) return;
      if (c.delta) {
        if (c.delta.reasoning_content) thinking += c.delta.reasoning_content;
        if (c.delta.content) text += c.delta.content;
        if (onDelta) onDelta({ text, thinking });
      }
      if (c.finish_reason === 'length') truncated = true;
    });
    return { text, thinking, truncated };
  },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const DEMO_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Notes</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 520px; margin: 40px auto; padding: 0 16px; }
    form { display: flex; gap: 8px; }
    input { flex: 1; padding: 8px; }
    li { padding: 8px 0; border-bottom: 1px solid #ddd; display: flex; justify-content: space-between; }
  </style>
</head>
<body>
  <h1>Notes</h1>
  <form id="form"><input id="text" placeholder="New note" required><button>Add</button></form>
  <ul id="list"></ul>
  <script src="app.js"></script>
</body>
</html>
`;

const DEMO_JS = `const KEY = 'notes';
const list = document.getElementById('list');
const form = document.getElementById('form');
const input = document.getElementById('text');

let notes = JSON.parse(localStorage.getItem(KEY) || '[]');

function render() {
  list.innerHTML = '';
  notes.forEach((note, i) => {
    const li = document.createElement('li');
    li.textContent = note;
    const del = document.createElement('button');
    del.textContent = 'Delete';
    del.onclick = () => { notes.splice(i, 1); save(); };
    li.appendChild(del);
    list.appendChild(li);
  });
}

function save() {
  localStorage.setItem(KEY, JSON.stringify(notes));
  render();
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  notes.push(input.value.trim());
  input.value = '';
  save();
});

render();
`;

const DEMO_TASK =
  /(make|create|build|write|fix|find|app\b|site|script|сдела|созда|напиш|найди|исправ|приложен|сайт|скрипт|erstell|mach|schreib|finde|crée|créer|fais|écris|trouve|crea|haz|escribe|encuentra|scrivi|trova|fai\b|做|写|创建|制作|找|应用|网站|脚本)/i;
const DEMO_MOBILE = /(android|андроид|телефон|phone|apk|handy|téléphone|teléfono|telefono|手机|安卓)/i;

const demo = {
  async list() {
    return [
      {
        id: 'demo:demo',
        tag: 'demo',
        provider: 'demo',
        name: 'Demo model',
        sizeGB: 0,
        params: null,
        quant: '',
      },
    ];
  },

  script(kind, meta) {
    const user = meta.lastUser || '';
    const isTask = DEMO_TASK.test(user);
    const mobile = DEMO_MOBILE.test(user);
    if (kind === 'plan') {
      return isTask
        ? {
            kind: 'task',
            size: 'small',
            steps: [
              'Look at what is already in the folder',
              'Create the page index.html',
              'Write the logic in app.js',
              mobile ? 'Check what is needed to build the app' : 'Check the code',
              'Report the result',
            ],
          }
        : { kind: 'chat', size: 'small', steps: [] };
    }
    if (kind === 'review') return { ok: true, problems: [] };
    if (kind === 'compact')
      return 'The user asked for a notes app. index.html and app.js were created and the syntax was checked.';
    if (!isTask) {
      if (meta.answering === 'Install it for me')
        return {
          thought: 'The user allowed the install, but this is the demo.',
          tool: 'finish',
          text: 'The demo does not install anything. A real model would start the install here and ask for your confirmation before downloading.',
        };
      if (meta.answering)
        return {
          thought: 'The user will install it themselves.',
          tool: 'finish',
          text: 'Okay. Tell me when it is installed and I will build and check the project.',
        };
      return {
        thought: 'This is a plain question, no tools needed.',
        tool: 'finish',
        text: 'Hi! I am the demo model: I show how the agent works in this app without a real neural network.\n\nTry **make a notes app** or **make a notes app for Android**. For real work, install a model in the Library.',
      };
    }
    const steps = [
      {
        step: 1,
        thought: 'First I will look at what is already in the project folder.',
        check: 'The folder may not be empty.',
        tool: 'list_dir',
        path: '.',
      },
      {
        step: 2,
        thought: 'The folder is clear. Creating the page with a form and a list of notes.',
        check: 'Every id used in app.js must exist here.',
        tool: 'write_file',
        path: 'index.html',
      },
      {
        step: 3,
        thought: 'Now the logic: add, delete and save to localStorage.',
        check: 'The first render must be called at the end.',
        tool: 'write_file',
        path: 'app.js',
      },
      mobile
        ? {
            step: 4,
            thought: 'Building a phone app needs Android Studio. Checking whether it is installed.',
            check: 'It may be missing.',
            tool: 'check_tool',
            name: 'android-studio',
          }
        : {
            step: 4,
            thought: 'Checking the code for syntax errors.',
            check: 'node may be missing.',
            tool: 'run_command',
            command: 'node --check app.js',
          },
      mobile
        ? /NOT installed/.test(meta.lastResult || '')
          ? {
              step: 5,
              thought: 'Android Studio is missing. I will say so honestly and offer options.',
              check: 'Do not claim the app is built.',
              tool: 'ask_user',
              question:
                'The app code is ready: index.html and app.js. Building an APK for the phone needs Android Studio, and it is not on this computer. What should we do?',
              options: ['Install it for me', 'I will install it myself'],
            }
          : {
              step: 5,
              thought: 'Android Studio is here, the project can be built.',
              check: 'The demo does not run the build.',
              tool: 'finish',
              text: 'The app code is ready: `index.html` and `app.js`. Android Studio is installed on this computer, so the project can be built into an APK. The demo does not run the build; with a real model that would be the next step.',
            }
        : {
            step: 5,
            thought: 'Everything is done and checked.',
            check: 'Nothing left unverified.',
            tool: 'finish',
            text: 'Done. I created a notes app:\n\n- `index.html` — the page with a form and a list\n- `app.js` — adding, deleting and saving notes\n\nThe syntax of `app.js` is checked. Open `index.html` in a browser to try it.',
          },
    ];
    return steps[Math.min(meta.stepIndex || 0, steps.length - 1)];
  },

  async chat(s, { kind, meta, messages, onDelta, signal }) {
    const m = meta || {};
    const prev = messages.length >= 2 ? messages[messages.length - 2].content : '';
    const answering = /"tool":"ask_user"/.test(prev) ? m.lastUser : '';
    const last = messages[messages.length - 1].content;
    const reply =
      kind === 'args'
        ? {}
        : kind === 'file'
          ? /app\.js/.test(last)
            ? DEMO_JS
            : DEMO_HTML
          : this.script(kind, { ...m, answering, lastResult: last });
    const text = typeof reply === 'string' ? reply : JSON.stringify(reply);
    for (let i = 0; i < text.length; i += 14) {
      if (signal && signal.aborted) {
        const e = new Error('aborted');
        e.name = 'AbortError';
        throw e;
      }
      if (onDelta) onDelta({ text: text.slice(0, i + 14), thinking: '' });
      await sleep(18);
    }
    return { text, thinking: '', truncated: false };
  },
};

const PROVIDERS = { ollama, remote, openai, demo };

function split(modelId) {
  const i = String(modelId).indexOf(':');
  return { provider: modelId.slice(0, i), model: modelId.slice(i + 1) };
}

async function listInstalled(settings) {
  await engine.ensure(settings);
  const out = {
    models: [],
    ollama: await ollama.status(settings),
    engine: await engine.status(settings),
    errors: [],
  };
  if (out.ollama.online) {
    try {
      out.models.push(...(await ollama.list(settings)));
    } catch (e) {
      out.errors.push(e.message);
    }
  }
  try {
    out.models.push(...(await openai.list(settings)));
  } catch (e) {
    out.errors.push(e.message);
  }
  const rem = settings.remote || {};
  if (rem.enabled && rem.url) {
    try {
      out.models.push(...(await remote.list(settings)));
      out.remote = 'online';
    } catch (e) {
      out.remote = 'offline';
    }
  }
  out.models.push(...(await demo.list()));
  return out;
}

async function chat(settings, modelId, opts) {
  const { provider, model } = split(modelId);
  const p = PROVIDERS[provider];
  if (!p) throw new ProviderError('Unknown model source: ' + provider, 'config');
  return p.chat(settings, { ...opts, model });
}

module.exports = { ollama, remote, openai, demo, chat, listInstalled, split, ProviderError };
