const http = require('http');
const os = require('os');
const crypto = require('crypto');

// Remote clients can list models and chat. Pulling and deleting stay local.
const ALLOWED = new Set([
  '/api/version',
  '/api/tags',
  '/api/ps',
  '/api/show',
  '/api/chat',
  '/api/generate',
  '/api/embed',
]);
let server = null;
let running = null;

function addresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces()))
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push(a.address);
  return out;
}

function stop() {
  if (server) server.close();
  server = null;
  running = null;
}

function start(settings) {
  const conf = settings.share || {};
  if (!conf.enabled || !conf.key) return stop();
  const port = Number(conf.port) || 11500;
  if (running && running.port === port && running.key === conf.key) return;
  stop();
  const target = new URL((settings.ollamaUrl || 'http://127.0.0.1:11434').replace(/\/+$/, ''));
  const key = Buffer.from(conf.key);
  server = http.createServer((req, res) => {
    const given = Buffer.from(String(req.headers.authorization || '').replace(/^Bearer\s+/i, ''));
    const ok = given.length === key.length && crypto.timingSafeEqual(given, key);
    const pathname = req.url.split('?')[0];
    if (!ok) return res.writeHead(401).end('wrong key');
    if (!ALLOWED.has(pathname)) return res.writeHead(403).end('not allowed');
    const up = http.request(
      {
        host: target.hostname,
        port: target.port || 80,
        path: req.url,
        method: req.method,
        headers: { 'content-type': req.headers['content-type'] || 'application/json' },
      },
      (r) => {
        res.writeHead(r.statusCode, { 'content-type': r.headers['content-type'] || 'application/json' });
        r.pipe(res);
      },
    );
    up.on('error', () => res.writeHead(502).end('{"error":"the model engine on the host is not running"}'));
    res.on('close', () => up.destroy());
    req.pipe(up);
  });
  server.on('error', () => stop());
  server.listen(port, '0.0.0.0');
  running = { port, key: conf.key };
}

const status = () => ({ running: !!running, port: running ? running.port : 0, addresses: addresses() });
const newKey = () => crypto.randomBytes(16).toString('hex');

module.exports = { start, stop, status, newKey };
