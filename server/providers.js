const engine = require('./engine');
const usage = require('./usage');

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

const PROVIDERS = { ollama, remote, openai };

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
  return out;
}

async function chat(settings, modelId, opts) {
  const { provider, model } = split(modelId);
  const p = PROVIDERS[provider];
  if (!p) throw new ProviderError('Unknown model source: ' + provider, 'config');
  const res = await p.chat(settings, { ...opts, model });
  const sent = (opts.messages || []).reduce((n, m) => n + String(m.content || '').length, 0);
  usage.tokens(
    modelId,
    Math.ceil(sent / 3),
    Math.ceil(((res.text || '').length + (res.thinking || '').length) / 3),
  );
  return res;
}

module.exports = { ollama, remote, openai, chat, listInstalled, split, ProviderError };
