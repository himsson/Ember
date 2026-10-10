const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const store = require('./store');
const agent = require('./agent');
const providers = require('./providers');
const hardware = require('./hardware');
const engine = require('./engine');
const hf = require('./hf');
const selftest = require('./selftest');
const mcp = require('./mcp');
const gitx = require('./git');
const docs = require('./docs');
const voice = require('./voice');
const share = require('./share');
const TEMPLATES = path.join(__dirname, '..', 'templates');
const { decodeOutput, SKIP_DIRS } = require('./tools');
const { resolveSafe } = require('./tools');
const catalog = require('./catalog.json');

const UI = path.join(__dirname, '..', 'ui');
const TOKEN = crypto.randomBytes(24).toString('hex');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

const clients = new Set();
let idleTimer = null;
const pulls = new Map();
function broadcast(ev) {
  const line = JSON.stringify(ev) + '\n';
  for (const res of clients) res.write(line);
}
agent.bus.on('event', broadcast);
engine.bus.on('install', (ev) => broadcast({ type: 'engine', ...ev }));
voice.bus.on('progress', (ev) => broadcast({ type: 'voice', ...ev }));

function sessionView(s) {
  return { id: s.id, items: s.items, state: agent.publicState(s) };
}

async function library() {
  const settings = store.getSettings();
  const hw = hardware.effective(settings);
  const installed = await providers.listInstalled(settings);
  const have = new Set(
    installed.models.filter((m) => m.provider === 'ollama').map((m) => m.tag.replace(/:latest$/, '')),
  );
  return {
    hw,
    ollama: installed.ollama,
    engine: installed.engine,
    errors: installed.errors,
    installed: installed.models.map((m) => ({
      ...m,
      rate: m.sizeGB ? hardware.rate(m.sizeGB, hw) : null,
      test: (settings.modelTests || {})[m.id] || null,
      testing: selftest.isRunning(m.id),
    })),
    catalog: catalog.map((c) => ({ ...c, rate: hardware.rate(c.sizeGB, hw), installed: have.has(c.tag) })),
    pulls: Object.fromEntries([...pulls].map(([tag, p]) => [tag, { percent: p.percent, status: p.status }])),
  };
}

function startPull(tag) {
  if (pulls.has(tag)) return;
  const p = { percent: 0, status: '', abort: new AbortController() };
  pulls.set(tag, p);
  let last = 0;
  providers.ollama
    .pull(
      store.getSettings(),
      tag,
      (ev) => {
        p.status = ev.status || '';
        if (ev.total) p.percent = Math.round((ev.completed / ev.total) * 100);
        if (Date.now() - last > 300) {
          last = Date.now();
          broadcast({ type: 'pull', tag, percent: p.percent, status: p.status });
        }
      },
      p.abort.signal,
    )
    .then(() => broadcast({ type: 'pull', tag, done: true }))
    .catch((e) =>
      broadcast({
        type: 'pull',
        tag,
        done: true,
        error: e.name === 'AbortError' ? 'Download cancelled' : e.message,
      }),
    )
    .finally(() => pulls.delete(tag));
}

const terms = new Map();
function killTree(child) {
  if (process.platform === 'win32')
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
  else child.kill('SIGKILL');
}
function sessionDir(id) {
  const s = store.getSession(id);
  if (!s) throw new Error('Chat not found');
  return { s, dir: store.ensureCwd(s) };
}
function walkFiles(dir, q, out, rootDir, depth) {
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (out.length >= 400) return;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (depth < 6 && !SKIP_DIRS.has(e.name) && !e.name.startsWith('.'))
        walkFiles(full, q, out, rootDir, depth + 1);
    } else {
      const rel = path.relative(rootDir, full).split(path.sep).join('/');
      if (!q || rel.toLowerCase().includes(q)) out.push(rel);
    }
  }
}

function gpuView(s) {
  const p = hardware.plan(s);
  return { cards: p.all, active: p.active.map((g) => g.id), spread: p.spread, vramGB: p.vramGB };
}

const routes = {
  'GET /api/files': async (q) => {
    const { dir } = sessionDir(q.id);
    const out = [];
    const needle = String(q.q || '').toLowerCase();
    walkFiles(dir, needle, out, dir, 0);
    return out
      .sort(
        (a, b) =>
          Number(path.basename(b).toLowerCase().startsWith(needle)) -
            Number(path.basename(a).toLowerCase().startsWith(needle)) || a.length - b.length,
      )
      .slice(0, 20);
  },
  'GET /api/tree': async (q) => {
    const { dir } = sessionDir(q.id);
    const full = resolveSafe(dir, q.path || '.');
    return fs
      .readdirSync(full, { withFileTypes: true })
      .filter((e) => e.name !== '.git' && e.name !== '.ember-trash')
      .map((e) => ({ name: e.name, dir: e.isDirectory() }))
      .sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name))
      .slice(0, 400);
  },
  'POST /api/term/run': async (b) => {
    const { dir } = sessionDir(b.id);
    const t = terms.get(b.id) || { cwd: dir, child: null };
    terms.set(b.id, t);
    if (!fs.existsSync(t.cwd)) t.cwd = dir;
    const command = String(b.command || '').trim();
    if (!command) return { cwd: t.cwd };
    if (t.child) throw new Error('A command is still running');
    const cd = command.match(/^cd\s+(?:\/d\s+)?"?([^"]+?)"?$/i);
    if (cd) {
      const next = path.resolve(t.cwd, cd[1]);
      if (!fs.existsSync(next) || !fs.statSync(next).isDirectory())
        throw new Error('No such folder: ' + next);
      t.cwd = next;
      return { cwd: t.cwd };
    }
    t.child = spawn(command, {
      cwd: t.cwd,
      shell: true,
      windowsHide: true,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    });
    const out = (d) => broadcast({ type: 'term', sid: b.id, data: decodeOutput(d) });
    t.child.stdout.on('data', out);
    t.child.stderr.on('data', out);
    t.child.on('error', (e) => broadcast({ type: 'term', sid: b.id, data: e.message + '\n' }));
    t.child.on('close', (code) => {
      t.child = null;
      broadcast({ type: 'term', sid: b.id, done: true, code, cwd: t.cwd });
    });
    return { cwd: t.cwd, started: true };
  },
  'POST /api/term/stop': async (b) => {
    const t = terms.get(b.id);
    if (t && t.child) killTree(t.child);
    return { ok: true };
  },
  'GET /api/git': async (q) => {
    const s = store.getSession(q.id);
    return { git: s && s.cwd ? gitx.status(s.cwd) : null };
  },
  'POST /api/git/commit': async (b) => {
    const { dir } = sessionDir(b.id);
    gitx.commit(dir, b.message);
    return { git: gitx.status(dir) };
  },
  'POST /api/git/restore': async (b) => {
    const { s, dir } = sessionDir(b.id);
    if (agent.isRunning(s.id)) throw new Error('The agent is still working');
    gitx.restore(dir, String(b.ref || ''));
    return { git: gitx.status(dir) };
  },
  'POST /api/extract': async (b) => {
    const buf = Buffer.from(String(b.data || ''), 'base64');
    const text = await docs.extract(String(b.name || 'file'), buf);
    return { name: String(b.name || 'file'), text: text.slice(0, 40000), chars: text.length };
  },
  'GET /api/voice': async () => voice.status(),
  'POST /api/voice/install': async () => {
    voice.install();
    return { ok: true };
  },
  'POST /api/voice': async (b) => ({
    text: await voice.transcribe(
      Buffer.from(String(b.wav || ''), 'base64'),
      /^[a-z]{2}$/.test(b.lang) ? b.lang : 'auto',
    ),
  }),
  'GET /api/memory': async () => ({ text: store.getMemory() }),
  'POST /api/memory': async (b) => {
    store.setMemory(b.text || '');
    return { text: store.getMemory() };
  },
  'GET /api/templates': async () =>
    fs
      .readdirSync(TEMPLATES)
      .filter((d) => fs.existsSync(path.join(TEMPLATES, d, 'template.json')))
      .map((id) => ({
        id,
        ...JSON.parse(fs.readFileSync(path.join(TEMPLATES, id, 'template.json'), 'utf8')),
      })),
  'POST /api/template': async (b) => {
    const id = String(b.template || '').replace(/[^\w-]/g, '');
    const src = path.join(TEMPLATES, id, 'files');
    if (!id || !fs.existsSync(src)) throw new Error('Template not found');
    const { s, dir } = sessionDir(b.id);
    const copied = [];
    for (const name of fs.readdirSync(src)) {
      const to = path.join(dir, name);
      if (fs.existsSync(to)) continue;
      fs.writeFileSync(to, fs.readFileSync(path.join(src, name)));
      copied.push(name);
    }
    return {
      cwd: s.cwd,
      copied,
      prompt: JSON.parse(fs.readFileSync(path.join(TEMPLATES, id, 'template.json'), 'utf8')).prompt,
    };
  },
  'GET /api/share': async () => share.status(),
  'POST /api/share/key': async () => {
    const s = store.saveSettings({ share: { ...(store.getSettings().share || {}), key: share.newKey() } });
    share.start(s);
    return { settings: s, share: share.status() };
  },
  'GET /api/mcp': async () => {
    await mcp.sync(store.getSettings().mcpServers).catch(() => {});
    return mcp.status();
  },
  'GET /api/boot': async () => ({
    settings: store.getSettings(),
    hardware: hardware.effective(store.getSettings()),
    detected: hardware.detect(),
    gpuPlan: gpuView(store.getSettings()),
    sessions: store.listSessions(),
    skills: store.listSkills(),
    projectsDir: store.PROJECTS,
  }),
  'GET /api/library': library,
  'GET /api/sessions': async (q) => store.listSessions(q.q),
  'GET /api/session': async (q) => {
    const s = store.getSession(q.id);
    if (!s) throw new Error('Chat not found');
    return sessionView(s);
  },
  'POST /api/session/new': async (b) => sessionView(store.newSession(b.cwd ? { cwd: b.cwd } : {})),
  'POST /api/session/update': async (b) => {
    const s = store.getSession(b.id);
    if (!s) throw new Error('Chat not found');
    const patch = b.patch || {};
    if (patch.cwd != null) {
      const dir = path.resolve(String(patch.cwd).trim().replace(/^"|"$/g, ''));
      if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new Error('No such folder: ' + dir);
      if (agent.isRunning(s.id)) throw new Error('The folder cannot be changed while the agent is working');
      s.cwd = dir;
      s.changed = {};
      s.snapshots = {};
    }
    for (const k of ['mode', 'model', 'effort', 'title'])
      if (patch[k] != null) s[k] = String(patch[k]).slice(0, 200);
    if (patch.pinned != null) s.pinned = !!patch.pinned;
    if (s.items.length) store.saveSession(s);
    return sessionView(s);
  },
  'POST /api/session/delete': async (b) => {
    agent.stop(b.id);
    store.deleteSession(b.id);
    return { ok: true };
  },
  'POST /api/send': async (b) => {
    if (agent.isRunning(b.id)) throw new Error('The agent is still working');
    agent.send(b.id, b.text, b.images, b.docs).catch((e) =>
      broadcast({
        sid: b.id,
        type: 'item',
        item: { id: 'e' + Date.now(), type: 'error', text: e.message },
      }),
    );
    return { ok: true };
  },
  'POST /api/stop': async (b) => (agent.stop(b.id), { ok: true }),
  'POST /api/undo': async (b) => ({ count: agent.undo(b.id, b.path) }),
  'POST /api/engine/install': async () => {
    engine.installEngine(store.getSettings());
    return { ok: true };
  },
  'POST /api/engine/unload': async () => ({ unloaded: await engine.unloadModels(store.getSettings()) }),
  'GET /api/hf/search': async (q) => hf.search(String(q.q || '').slice(0, 80), q.sort),
  'GET /api/hf/versions': async (q) =>
    hf.versions(String(q.id || ''), hardware.effective(store.getSettings())),
  'POST /api/models/test': async (b) => {
    const id = String(b.id || '');
    selftest
      .run(id, (p) => broadcast({ type: 'modeltest', id, ...p }))
      .then((r) => broadcast({ type: 'modeltest', id, done: true, ...(r || {}) }))
      .catch((e) => broadcast({ type: 'modeltest', id, done: true, error: e.message }));
    return { ok: true };
  },
  'POST /api/compact': async (b) => (agent.compactNow(b.id), { ok: true }),
  'POST /api/permission': async (b) => ({ ok: agent.answerPermission(b.id, b.item, b.decision) }),
  'GET /api/file': async (q) => {
    const s = store.getSession(q.id);
    if (!s || !s.cwd) throw new Error('Chat not found');
    const full = resolveSafe(s.cwd, q.path);
    const rel = path.relative(s.cwd, full).split(path.sep).join('/');
    return {
      path: rel,
      after: fs.existsSync(full) ? fs.readFileSync(full, 'utf8').slice(0, 200000) : null,
      before: s.snapshots[rel] == null ? null : s.snapshots[rel],
    };
  },
  'POST /api/open-folder': async (b) => {
    const s = store.getSession(b.id);
    if (!s || !s.cwd || !fs.existsSync(s.cwd)) throw new Error('The folder does not exist yet');
    const cmd =
      process.platform === 'win32' ? 'explorer' : process.platform === 'darwin' ? 'open' : 'xdg-open';
    spawn(cmd, [s.cwd], { detached: true, stdio: 'ignore' }).unref();
    return { ok: true };
  },
  'POST /api/settings': async (b) => {
    const before = JSON.stringify(engine.engineEnv(store.getSettings()));
    const s = store.saveSettings(b);
    if (JSON.stringify(engine.engineEnv(s)) !== before) await engine.restart(s);
    await mcp.sync(s.mcpServers).catch(() => {});
    share.start(s);
    return { settings: s, hardware: hardware.effective(s), gpuPlan: gpuView(s), mcp: mcp.status() };
  },
  'POST /api/models/pull': async (b) => {
    const tag = String(b.tag || '').trim();
    if (!/^[\w.\-/]+(:[\w.\-]+)?$/.test(tag)) throw new Error('Invalid model name');
    startPull(tag);
    return { ok: true };
  },
  'POST /api/models/cancel': async (b) => {
    const p = pulls.get(b.tag);
    if (p) p.abort.abort();
    return { ok: true };
  },
  'POST /api/models/delete': async (b) => {
    await providers.ollama.remove(store.getSettings(), b.tag);
    return { ok: true };
  },
  'POST /api/skills/save': async (b) => {
    store.saveSkill(b);
    return store.listSkills();
  },
  'POST /api/skills/delete': async (b) => {
    store.deleteSkill(b.name);
    return store.listSkills();
  },
  'POST /api/skills/toggle': async (b) => {
    const off = new Set(store.getSettings().disabledSkills);
    if (b.enabled) off.delete(b.name);
    else off.add(b.name);
    store.saveSettings({ disabledSkills: [...off] });
    return store.listSkills();
  },
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 4e7) reject(new Error('Request too large'));
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        reject(new Error('Bad request'));
      }
    });
  });
}

async function handle(req, res) {
  // DNS rebinding guard.
  const host = String(req.headers.host || '').replace(/:\d+$/, '');
  if (!['127.0.0.1', 'localhost'].includes(host)) return res.writeHead(403).end();
  const url = new URL(req.url, 'http://127.0.0.1');

  if (url.pathname.startsWith('/api/')) {
    if (req.headers['x-ember-token'] !== TOKEN) return res.writeHead(401).end();
    if (url.pathname === '/api/events') {
      res.writeHead(200, { 'content-type': 'application/x-ndjson', 'cache-control': 'no-cache' });
      res.write('{"type":"hello"}\n');
      clients.add(res);
      const ping = setInterval(() => res.write('{"type":"ping"}\n'), 20000);
      clearTimeout(idleTimer);
      req.on('close', () => {
        clearInterval(ping);
        clients.delete(res);
        if (!clients.size) idleTimer = setTimeout(() => engine.unloadModels(store.getSettings()), 15000);
      });
      return;
    }
    const route = routes[`${req.method} ${url.pathname}`];
    if (!route) return res.writeHead(404).end();
    try {
      const arg = req.method === 'GET' ? Object.fromEntries(url.searchParams) : await readBody(req);
      const out = await route(arg);
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' }).end(JSON.stringify(out));
    } catch (e) {
      res
        .writeHead(400, { 'content-type': 'application/json; charset=utf-8' })
        .end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
  const file = path.join(UI, rel);
  if (!file.startsWith(UI) || !fs.existsSync(file) || !fs.statSync(file).isFile())
    return res.writeHead(404).end();
  let body = fs.readFileSync(file);
  if (rel === 'index.html') body = body.toString('utf8').replace('__EMBER_TOKEN__', TOKEN);
  res
    .writeHead(200, {
      'content-type': MIME[path.extname(file)] || 'application/octet-stream',
      'cache-control': 'no-store',
    })
    .end(body);
}

function start(port = 0) {
  share.start(store.getSettings());
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => handle(req, res).catch(() => res.writeHead(500).end()));
    server.on('error', reject);
    server.listen(port, '127.0.0.1', () =>
      resolve({ server, port: server.address().port, url: `http://127.0.0.1:${server.address().port}/` }),
    );
  });
}

if (require.main === module) {
  let closing = false;
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(sig, () => {
      if (closing) return;
      closing = true;
      shutdown().finally(() => process.exit(0));
    });
  }
  start(Number(process.env.PORT) || 4317).then(({ url }) => {
    console.log('Ember is running: ' + url);
    if (process.argv.includes('--open')) {
      const [cmd, args] =
        process.platform === 'win32'
          ? ['cmd', ['/c', 'start', '', url]]
          : process.platform === 'darwin'
            ? ['open', [url]]
            : ['xdg-open', [url]];
      spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref();
    }
  });
}

const shutdown = () => {
  mcp.stopAll();
  share.stop();
  for (const t of terms.values()) if (t.child) killTree(t.child);
  return engine.shutdown(store.getSettings());
};

module.exports = { start, shutdown, setCapture: agent.setCapture };
