const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const { unpack } = require('./unpack');

const HOME = process.env.EMBER_HOME || path.join(os.homedir(), '.ember');
const DIR = path.join(HOME, 'voice');
const MODEL = path.join(DIR, 'ggml-base.bin');
const MODEL_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin';
const bus = new EventEmitter();
const win = process.platform === 'win32';
let progress = null;

function findBinary(dir = DIR, depth = 0) {
  if (!fs.existsSync(dir) || depth > 3) return null;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      const hit = findBinary(full, depth + 1);
      if (hit) return hit;
    } else if (/^whisper-cli(\.exe)?$/.test(e.name)) return full;
  }
  return null;
}

const status = () => ({
  installed: !!findBinary() && fs.existsSync(MODEL),
  install: progress,
  canInstall: win || (process.platform === 'linux' && os.arch() === 'x64'),
});

async function download(url, file, label, share, offset) {
  const res = await fetch(url, { redirect: 'follow', headers: { 'user-agent': 'ember-app' } });
  if (!res.ok) throw new Error('Download failed: ' + res.status);
  const total = Number(res.headers.get('content-length')) || 0;
  const out = fs.createWriteStream(file + '.part');
  let got = 0;
  let last = 0;
  for await (const chunk of res.body) {
    if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
    got += chunk.length;
    if (total && Date.now() - last > 300) {
      last = Date.now();
      progress = { status: label, percent: Math.round(offset + (got / total) * share) };
      bus.emit('progress', progress);
    }
  }
  await new Promise((r) => out.end(r));
  fs.renameSync(file + '.part', file);
}

async function install() {
  if (progress) return;
  progress = { status: 'Downloading speech recognition', percent: 0 };
  try {
    fs.mkdirSync(DIR, { recursive: true });
    if (!findBinary()) {
      const want = win ? 'whisper-bin-x64.zip' : 'whisper-bin-ubuntu-x64.tar.gz';
      const releases = await (
        await fetch('https://api.github.com/repos/ggml-org/whisper.cpp/releases?per_page=12', {
          headers: { 'user-agent': 'ember-app' },
        })
      ).json();
      const asset = (Array.isArray(releases) ? releases : [])
        .flatMap((r) => r.assets || [])
        .find((a) => a.name === want);
      if (!asset) throw new Error('Could not find a speech recognition build for this system');
      const file = path.join(DIR, want);
      await download(asset.browser_download_url, file, 'Downloading speech recognition', 8, 0);
      await unpack(file, DIR);
      fs.rmSync(file, { force: true });
      if (!win) fs.chmodSync(findBinary(), 0o755);
    }
    if (!fs.existsSync(MODEL)) await download(MODEL_URL, MODEL, 'Downloading speech recognition', 92, 8);
    progress = null;
    bus.emit('progress', { done: true });
  } catch (e) {
    progress = null;
    bus.emit('progress', { done: true, error: e.message });
  }
}

function transcribe(wav, lang, model = MODEL) {
  const bin = findBinary();
  if (!bin || !fs.existsSync(model)) return Promise.reject(new Error('Speech recognition is not installed'));
  const file = path.join(os.tmpdir(), `ember-voice-${process.pid}-${Date.now()}.wav`);
  fs.writeFileSync(file, wav);
  return new Promise((resolve, reject) => {
    const p = spawn(bin, ['-m', model, '-f', file, '-l', lang || 'auto', '-nt', '-np'], {
      windowsHide: true,
      cwd: path.dirname(bin),
    });
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => (out += d.toString('utf8')));
    p.stderr.on('data', (d) => (err = (err + d.toString('utf8')).slice(-300)));
    const timer = setTimeout(() => p.kill(), 120000);
    p.on('error', (e) => reject(e));
    p.on('close', (code) => {
      clearTimeout(timer);
      fs.rmSync(file, { force: true });
      if (code !== 0)
        return reject(
          new Error('Speech recognition failed' + (err ? ': ' + err.trim().split('\n').pop() : '')),
        );
      resolve(
        out
          .replace(/\[[^\]]*\]/g, ' ')
          .replace(/\s+/g, ' ')
          .trim(),
      );
    });
  });
}

module.exports = { bus, status, install, transcribe, findBinary, DIR };
