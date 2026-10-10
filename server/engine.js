const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { EventEmitter } = require('events');
const { unpack } = require('./unpack');
const hardware = require('./hardware');

const HOME = process.env.EMBER_HOME || path.join(os.homedir(), '.ember');
const ENGINE_DIR = path.join(HOME, 'engine');
const bus = new EventEmitter();
const win = process.platform === 'win32';

let child = null;
let starting = null;
let install = null;

const base = (s) => (s.ollamaUrl || 'http://127.0.0.1:11434').replace(/\/+$/, '');

async function online(s) {
  try {
    const res = await fetch(base(s) + '/api/version', { signal: AbortSignal.timeout(1200) });
    return res.ok;
  } catch {
    return false;
  }
}

function findBinary() {
  const candidates = [
    path.join(ENGINE_DIR, win ? 'ollama.exe' : 'bin/ollama'),
    path.join(ENGINE_DIR, 'ollama'),
  ];
  const found = spawnSync(win ? 'where' : 'which', ['ollama'], { encoding: 'utf8', windowsHide: true });
  if (found.status === 0) candidates.push(found.stdout.split(/\r?\n/)[0].trim());
  if (win && process.env.LOCALAPPDATA)
    candidates.push(path.join(process.env.LOCALAPPDATA, 'Programs', 'Ollama', 'ollama.exe'));
  candidates.push(
    '/usr/local/bin/ollama',
    '/usr/bin/ollama',
    '/Applications/Ollama.app/Contents/Resources/ollama',
  );
  return candidates.find((c) => c && fs.existsSync(c)) || null;
}

// The engine reads its GPU and memory settings from the environment once, at start.
function engineEnv(s) {
  const env = { OLLAMA_HOST: new URL(base(s)).host };
  const p = hardware.plan(s);
  const manual = (s.gpu || {}).mode === 'manual';
  if (p.all.length > 1 || manual) {
    // Order matters: without spreading, the engine fills the first listed card first.
    const nvidia = p.active.filter((g) => g.vendor === 'nvidia');
    if (p.all.some((g) => g.vendor === 'nvidia'))
      env.CUDA_VISIBLE_DEVICES = nvidia.length
        ? nvidia.map((g) => (/^GPU-/.test(g.id) ? g.id : g.index)).join(',')
        : '-1';
    const amdAll = p.all.filter((g) => g.vendor === 'amd');
    if (amdAll.length) {
      const picked = p.active.filter((g) => g.vendor === 'amd').map((g) => amdAll.indexOf(g));
      env.ROCR_VISIBLE_DEVICES = picked.length ? picked.join(',') : '-1';
    }
  }
  if (p.spread && p.active.length > 1) env.OLLAMA_SCHED_SPREAD = '1';
  if (p.reserveGB) env.OLLAMA_GPU_OVERHEAD = String(Math.round(p.reserveGB * 1024 ** 3));
  const perf = s.perf || {};
  if (perf.flash || perf.kv) env.OLLAMA_FLASH_ATTENTION = '1';
  if (perf.kv) env.OLLAMA_KV_CACHE_TYPE = 'q8_0';
  if (perf.oneModel) env.OLLAMA_MAX_LOADED_MODELS = '1';
  if (perf.single) env.OLLAMA_NUM_PARALLEL = '1';
  return env;
}

// Starts the engine process only; no model is loaded until the first request.
async function ensure(s) {
  if (await online(s)) return true;
  if (process.env.EMBER_NO_ENGINE) return false;
  const bin = findBinary();
  if (!bin) return false;
  if (!starting) {
    starting = (async () => {
      child = spawn(bin, ['serve'], {
        env: { ...process.env, ...engineEnv(s) },
        windowsHide: true,
        stdio: 'ignore',
      });
      child.on('exit', () => (child = null));
      child.on('error', () => (child = null));
      for (let i = 0; i < 40 && child; i++) {
        if (await online(s)) return true;
        await new Promise((r) => setTimeout(r, 500));
      }
      return false;
    })().finally(() => (starting = null));
  }
  return starting;
}

async function status(s) {
  const on = await online(s);
  return {
    online: on,
    managed: !!child,
    installed: on || !!findBinary(),
    install,
    canInstall: win || process.platform === 'linux',
  };
}

async function loaded(s) {
  try {
    const res = await fetch(base(s) + '/api/ps', { signal: AbortSignal.timeout(1500) });
    return ((await res.json()).models || []).map((m) => m.name);
  } catch {
    return [];
  }
}

async function unloadModels(s) {
  const names = await loaded(s);
  await Promise.all(
    names.map((model) =>
      fetch(base(s) + '/api/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model, keep_alive: 0 }),
        signal: AbortSignal.timeout(4000),
      }).catch(() => {}),
    ),
  );
  return names;
}

async function shutdown(s) {
  await unloadModels(s);
  if (child) {
    const pid = child.pid;
    if (win) spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true });
    else child.kill('SIGTERM');
    child = null;
  }
}

async function installEngine(s) {
  if (install) return;
  const asset = win
    ? 'ollama-windows-amd64.zip'
    : process.platform === 'linux'
      ? os.arch() === 'arm64'
        ? 'ollama-linux-arm64.tar.zst'
        : 'ollama-linux-amd64.tar.zst'
      : null;
  if (!asset) throw new Error('On this system the engine is installed from ollama.com');
  install = { percent: 0, status: 'Downloading the engine' };
  const report = () => bus.emit('install', { ...install });
  const file = path.join(HOME, asset);
  try {
    fs.mkdirSync(ENGINE_DIR, { recursive: true });
    const res = await fetch('https://github.com/ollama/ollama/releases/latest/download/' + asset, {
      redirect: 'follow',
    });
    if (!res.ok) throw new Error('Could not download the engine: ' + res.status);
    const total = Number(res.headers.get('content-length')) || 0;
    install.totalMB = Math.round(total / 1048576);
    const out = fs.createWriteStream(file);
    let got = 0;
    let last = 0;
    for await (const chunk of res.body) {
      if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
      got += chunk.length;
      if (total && Date.now() - last > 400) {
        last = Date.now();
        install.percent = Math.round((got / total) * 100);
        report();
      }
    }
    await new Promise((r) => out.end(r));
    install = { ...install, percent: 100, status: 'Unpacking the engine' };
    report();
    await unpack(file, ENGINE_DIR);
    fs.rmSync(file, { force: true });
    install = null;
    const ok = await ensure(s);
    bus.emit('install', { done: true, error: ok ? '' : 'The engine is installed but did not start' });
  } catch (e) {
    fs.rmSync(file, { force: true });
    install = null;
    bus.emit('install', { done: true, error: e.message });
  }
}

// Settings that live in the environment only take effect on a fresh engine process.
async function restart(s) {
  if (!child) return false;
  await shutdown(s);
  for (let i = 0; i < 20 && (await online(s)); i++) await new Promise((r) => setTimeout(r, 250));
  return ensure(s);
}

module.exports = {
  engineEnv,
  restart,
  bus,
  ensure,
  status,
  loaded,
  unloadModels,
  shutdown,
  installEngine,
  findBinary,
};
