const { spawn, spawnSync } = require('child_process');

const servers = new Map();

class Server {
  constructor(conf) {
    this.conf = conf;
    this.tools = [];
    this.state = 'stopped';
    this.error = '';
    this.pending = new Map();
    this.nextId = 1;
  }

  start() {
    this.state = 'starting';
    this.error = '';
    try {
      this.child = spawn(this.conf.command, {
        shell: true,
        windowsHide: true,
        env: { ...process.env, ...(this.conf.env || {}) },
      });
    } catch (e) {
      this.fail(e.message);
      return Promise.resolve();
    }
    let buf = '';
    this.child.stdout.on('data', (d) => {
      buf += d.toString('utf8');
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line.startsWith('{')) continue;
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        const waiter = msg.id != null && this.pending.get(msg.id);
        if (!waiter) continue;
        this.pending.delete(msg.id);
        if (msg.error) waiter.reject(new Error(msg.error.message || 'MCP error'));
        else waiter.resolve(msg.result);
      }
    });
    let stderr = '';
    this.child.stderr.on('data', (d) => (stderr = (stderr + d.toString('utf8')).slice(-400)));
    this.child.on('error', (e) => this.fail(e.message));
    this.child.on('exit', (code) => {
      if (this.state !== 'stopped')
        this.fail(stderr.trim().split('\n').pop() || 'the program exited with code ' + code);
    });
    return this.request(
      'initialize',
      { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'ember', version: '0.1.0' } },
      30000,
    )
      .then(() => {
        this.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
        return this.request('tools/list', {}, 15000);
      })
      .then((r) => {
        this.tools = (r.tools || []).map((t) => ({
          name: t.name,
          description: String(t.description || '')
            .replace(/\s+/g, ' ')
            .slice(0, 160),
          inputSchema:
            t.inputSchema && t.inputSchema.type === 'object'
              ? t.inputSchema
              : { type: 'object', properties: {} },
        }));
        this.state = 'running';
      })
      .catch((e) => this.fail(e.message));
  }

  fail(message) {
    this.state = 'error';
    this.error = message;
    this.tools = [];
    for (const w of this.pending.values()) w.reject(new Error(message));
    this.pending.clear();
    this.kill();
  }

  send(msg) {
    if (this.child && this.child.stdin.writable) this.child.stdin.write(JSON.stringify(msg) + '\n');
  }

  request(method, params, timeout = 60000) {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('the tool server did not answer in time'));
      }, timeout);
      this.pending.set(id, {
        resolve: (v) => (clearTimeout(timer), resolve(v)),
        reject: (e) => (clearTimeout(timer), reject(e)),
      });
      this.send({ jsonrpc: '2.0', id, method, params });
    });
  }

  kill() {
    const c = this.child;
    this.child = null;
    if (!c || c.exitCode != null) return;
    if (process.platform === 'win32')
      spawnSync('taskkill', ['/pid', String(c.pid), '/T', '/F'], { windowsHide: true });
    else c.kill('SIGTERM');
  }

  stop() {
    this.state = 'stopped';
    this.kill();
  }
}

async function sync(list) {
  const wanted = new Map(
    (list || []).filter((c) => c && c.enabled !== false && c.name && c.command).map((c) => [c.name, c]),
  );
  for (const [name, srv] of servers) {
    const conf = wanted.get(name);
    if (!conf || conf.command !== srv.conf.command) {
      srv.stop();
      servers.delete(name);
    }
  }
  const starting = [];
  for (const [name, conf] of wanted) {
    if (servers.has(name)) continue;
    const srv = new Server(conf);
    servers.set(name, srv);
    starting.push(srv.start());
  }
  await Promise.all(starting);
}

const tools = () =>
  [...servers].flatMap(([name, srv]) =>
    srv.tools.map((t) => ({ ...t, id: `${name}.${t.name}`, server: name })),
  );
const status = () =>
  [...servers].map(([name, srv]) => ({ name, state: srv.state, error: srv.error, tools: srv.tools.length }));

async function call(id, args) {
  const tool = tools().find((t) => t.id === id);
  if (!tool) throw new Error(`There is no tool "${id}".`);
  const result = await servers
    .get(tool.server)
    .request('tools/call', { name: tool.name, arguments: args || {} });
  const text = (result.content || []).map((c) => (c.type === 'text' ? c.text : `[${c.type}]`)).join('\n');
  return (result.isError ? 'FAILED: ' : '') + (text || '(no output)');
}

function stopAll() {
  for (const srv of servers.values()) srv.stop();
  servers.clear();
}

module.exports = { sync, tools, status, call, stopAll };
