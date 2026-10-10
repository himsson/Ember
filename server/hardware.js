const os = require('os');
const { spawnSync } = require('child_process');

const GB = 1024 ** 3;
const round1 = (n) => Math.round(n * 10) / 10;

// Cards sold without video outputs. Anything matching is treated as a compute card even if the
// driver reports nothing about displays.
const COMPUTE_ONLY =
  /\btesla\b|\b(a100|a10g?|a16|a2|a30|a40|h100|h200|l4|l40s?|l20|p4|p40|p100|v100s?|m40|m60|k80|t4)\b/i;
const INTEGRATED = /intel|uhd|iris|radeon\(tm\) graphics|radeon graphics|vega \d|microsoft basic/i;

function run(cmd, args) {
  try {
    const r = spawnSync(cmd, args, { encoding: 'utf8', windowsHide: true, timeout: 8000 });
    return r.status === 0 ? r.stdout : '';
  } catch {
    return '';
  }
}

function describe(g) {
  const integrated = INTEGRATED.test(g.name) && g.vramGB < 3;
  return {
    ...g,
    integrated,
    // "AI card": no monitor attached, or a model that has no outputs at all
    headless: !integrated && (!g.display || COMPUTE_ONLY.test(g.name)),
  };
}

function nvidiaGpus() {
  const out = run('nvidia-smi', [
    '--query-gpu=index,uuid,name,memory.total,display_active,display_mode',
    '--format=csv,noheader,nounits',
  ]);
  return out
    .split(/\r?\n/)
    .map((line) => line.split(',').map((s) => s.trim()))
    .filter((f) => f.length >= 4 && f[2])
    .map(([index, uuid, name, mb, active, mode]) => ({
      id: uuid || 'gpu' + index,
      index: Number(index),
      vendor: 'nvidia',
      name,
      vramGB: round1(Number(mb) / 1024),
      display: active === 'Enabled' || mode === 'Enabled',
    }));
}

function windowsGpus() {
  // AdapterRAM in WMI is capped at 4 GB, so the 64-bit value comes from the registry.
  // A controller with a current resolution is driving a monitor.
  const ps = `$live=@{}; Get-CimInstance Win32_VideoController | ForEach-Object { if($_.CurrentHorizontalResolution){ $live[$_.Name]=$true } }; $r=@(); Get-ItemProperty 'HKLM:\\SYSTEM\\ControlSet001\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}\\0*' -ErrorAction SilentlyContinue | ForEach-Object { if($_.DriverDesc){ $r += [pscustomobject]@{n=$_.DriverDesc; m=[double]($_.'HardwareInformation.qwMemorySize'); d=[bool]$live[$_.DriverDesc]} } }; if(-not $r){ Get-CimInstance Win32_VideoController | ForEach-Object { $r += [pscustomobject]@{n=$_.Name; m=[double]$_.AdapterRAM; d=[bool]$_.CurrentHorizontalResolution} } }; ConvertTo-Json -Compress -InputObject @($r)`;
  try {
    const list = JSON.parse(run('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps]).trim());
    return (Array.isArray(list) ? list : [list])
      .filter((g) => g && g.n)
      .map((g, i) => ({
        id: 'gpu' + i,
        index: i,
        vendor: /amd|radeon/i.test(g.n)
          ? 'amd'
          : /nvidia|geforce|quadro|rtx|gtx/i.test(g.n)
            ? 'nvidia'
            : 'other',
        name: g.n,
        vramGB: round1((g.m || 0) / GB),
        display: !!g.d,
      }));
  } catch {
    return [];
  }
}

function listGpus() {
  if (process.env.EMBER_GPUS) {
    try {
      return JSON.parse(process.env.EMBER_GPUS).map((g, i) =>
        describe({ id: 'gpu' + i, index: i, vendor: 'nvidia', display: false, ...g }),
      );
    } catch {}
  }
  let gpus = nvidiaGpus();
  if (!gpus.length && process.platform === 'win32') gpus = windowsGpus();
  if (!gpus.length && process.platform === 'darwin' && os.arch() === 'arm64')
    gpus = [
      {
        id: 'gpu0',
        index: 0,
        vendor: 'apple',
        name: 'Apple Silicon',
        vramGB: round1((os.totalmem() / GB) * 0.7),
        display: true,
        unified: true,
      },
    ];
  return gpus.map(describe);
}

let cached = null;
function detect() {
  if (cached) return cached;
  const cpus = os.cpus();
  const gpus = listGpus();
  const usable = gpus.filter((g) => !g.integrated);
  const best = usable.slice().sort((a, b) => b.vramGB - a.vramGB)[0];
  cached = {
    ramGB: Math.round(os.totalmem() / GB),
    cpu: cpus[0] ? cpus[0].model.trim() : '',
    cores: cpus.length,
    gpus,
    gpu: best ? best.name : gpus[0] ? gpus[0].name : '',
    vramGB: best ? best.vramGB : 0,
    unified: !!(best && best.unified),
  };
  return cached;
}

// Which cards the engine should use and in what order.
// Auto: every dedicated card, compute cards first so the one driving the monitor fills up last.
function plan(settings) {
  const conf = (settings && settings.gpu) || {};
  const all = detect().gpus.filter((g) => !g.integrated);
  let active;
  if (conf.mode === 'manual') {
    const order = Array.isArray(conf.order) ? conf.order : [];
    const off = new Set(conf.off || []);
    const rank = (g) => (order.includes(g.id) ? order.indexOf(g.id) : order.length + g.index);
    active = all.filter((g) => !off.has(g.id)).sort((a, b) => rank(a) - rank(b));
  } else {
    active = all.slice().sort((a, b) => Number(b.headless) - Number(a.headless) || b.vramGB - a.vramGB);
  }
  const reserve = Math.max(0, Number(conf.reserveGB) || 0);
  // the desktop itself needs some memory on the card that draws it
  const free = (g) => Math.max(0, g.vramGB - reserve - (g.display ? 0.8 : 0));
  const spread = conf.spread === true || (conf.spread == null && active.length > 1);
  return { all, active, spread, reserveGB: reserve, vramGB: round1(active.reduce((n, g) => n + free(g), 0)) };
}

function effective(settings) {
  const hw = { ...detect() };
  const o = (settings && settings.hardwareOverride) || {};
  if (o.enabled) {
    hw.ramGB = Number(o.ramGB) || hw.ramGB;
    hw.vramGB = Number(o.vramGB) || 0;
    hw.gpu = o.vramGB ? 'GPU' : '';
    hw.manual = true;
    return hw;
  }
  const p = plan(settings);
  if (p.active.length > 1) {
    hw.vramGB = p.vramGB;
    hw.gpu = p.active.map((g) => g.name.replace(/^NVIDIA |^AMD /, '')).join(' + ');
    hw.multi = p.active.length;
  } else if (p.active.length === 1) {
    hw.vramGB = p.all.length > 1 || p.reserveGB ? p.vramGB : p.active[0].vramGB;
    hw.gpu = p.active[0].name;
  } else if (p.all.length) {
    hw.vramGB = 0;
    hw.gpu = '';
  }
  return hw;
}

function rate(sizeGB, hw) {
  const need = sizeGB * 1.1 + 1;
  const ram = hw.unified ? 0 : hw.ramGB;
  if (hw.vramGB >= need) return { level: 'fast', need: round1(need) };
  if (hw.vramGB >= 4 && need <= hw.vramGB + ram * 0.5) return { level: 'slow', need: round1(need) };
  if (need <= ram * 0.6) return { level: sizeGB <= 3 ? 'ok' : 'slow', need: round1(need) };
  return { level: 'no', need: round1(need) };
}

function suggestCtx(sizeGB, hw) {
  const free = Math.max(hw.vramGB, hw.unified ? 0 : hw.ramGB * 0.5) - sizeGB * 1.05;
  if (free >= 6) return 16384;
  if (free >= 2) return 8192;
  if (free >= 1) return 6144;
  return 4096;
}

// Weights can't grow, but the context window can: that is what Ultra spends spare memory on.
function maxCtx(sizeGB, hw, trained) {
  const free = Math.max(hw.vramGB, hw.unified ? 0 : hw.ramGB * 0.5) - sizeGB * 1.05 - 0.5;
  const perThousand = 0.13 * Math.max(0.5, sizeGB / 5);
  const fit = (free / perThousand) * 1000;
  const cap = trained || 32768;
  const tiers = [131072, 65536, 49152, 32768, 24576, 16384, 8192];
  return Math.max(suggestCtx(sizeGB, hw), tiers.find((t) => t <= fit && t <= cap) || 0);
}

module.exports = { detect, effective, plan, rate, suggestCtx, maxCtx };
