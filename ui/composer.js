'use strict';

async function undo(path) {
  const r = await api('/api/undo', { id: S.session.id, path });
  if (!r.count) toast('Nothing to undo');
}
async function viewFile(p) {
  const f = await api(`/api/file?id=${encodeURIComponent(S.session.id)}&path=${encodeURIComponent(p)}`);
  modal(f.path, diffView(f.before, f.after, { full: f.before == null }).el, (close) => [
    h(
      'button',
      {
        class: 'btn danger',
        onclick: guard(async () => {
          close();
          await undo(f.path);
        }),
      },
      ic('undo'),
      t('Undo changes'),
    ),
    h('button', { class: 'btn', onclick: close }, t('Close')),
  ]);
}

async function doCompact() {
  if (st().running) return toast('The agent is still working');
  await api('/api/compact', { id: S.session.id });
}
function contextMenu(anchor) {
  closePop();
  const s = st();
  const pct = ctxPct();
  const pop = h(
    'div',
    { class: 'pop' },
    h(
      'div',
      { class: 'pad', style: `--heat:${heat(pct)}` },
      h('div', { class: 'slider-head' }, h('b', {}, t('Context')), h('span', {}, pct + '%')),
      h('div', { class: 'bar' }, h('i', { style: `width:${pct}%` })),
      h('div', { class: 'kv' }, t('Used'), h('b', {}, num(s.ctxUsed))),
      h('div', { class: 'kv' }, t('Left'), h('b', {}, num(Math.max(0, (s.ctxMax || 0) - (s.ctxUsed || 0))))),
      h('div', { class: 'kv' }, t('Total'), h('b', {}, s.ctxMax ? num(s.ctxMax) : '—')),
    ),
    h('div', { class: 'sep' }),
    h(
      'button',
      { class: 'mi', onclick: () => (closePop(), guard(doCompact)()) },
      ic('shrink'),
      h('span', { class: 't' }, t('Compact context')),
    ),
    h(
      'button',
      {
        class: 'mi',
        onclick: () => (
          closePop(),
          guard(async () => {
            const r = await api('/api/engine/unload', {});
            toast(r.unloaded.length ? 'Model unloaded from memory' : 'No models in memory');
          })()
        ),
      },
      ic('cpu'),
      h('span', { class: 't' }, t('Unload model from memory')),
    ),
  );
  placePop(pop, anchor, true);
}

function send(text, images, docs) {
  return guard(async () => {
    if (st().running) return toast('The agent is still working');
    await api('/api/send', {
      id: S.session.id,
      text,
      images: images && images.length ? images : undefined,
      docs: docs && docs.length ? docs : undefined,
    });
  })();
}
const COMMANDS = {
  compact: ['Compact context', 'shrink', () => guard(doCompact)()],
  clear: ['New chat', 'plus', () => guard(newChat)()],
  undo: ['Undo file changes', 'undo', () => guard(() => undo())()],
  init: [
    'Create project notes EMBER.md',
    'file',
    () =>
      send(
        t(
          'Study this project folder and create EMBER.md: briefly what the project is, how it is organised, how to run and check it.',
        ),
      ),
  ],
};
function submit() {
  const ta = $('#ta');
  const text = ta.value.trim();
  const images = S.attach;
  const docs = S.docs;
  if (!text && !images.length && !docs.length) return;
  closePop();
  ta.value = '';
  ta.style.height = 'auto';
  const cmd = text.match(/^\/([a-z]+)$/);
  if (cmd && COMMANDS[cmd[1]] && !st().running) return COMMANDS[cmd[1]][2]();
  S.attach = [];
  S.docs = [];
  if (st().running) S.queue.push({ text, images, docs });
  else send(text, images, docs);
  renderTray();
}

function addFiles(files) {
  addImages(files.filter((f) => f.type.startsWith('image/')));
  for (const file of files.filter((f) => !f.type.startsWith('image/')).slice(0, 4 - S.docs.length)) {
    const reader = new FileReader();
    reader.onload = guard(async () => {
      const r = await api('/api/extract', {
        name: file.name,
        data: String(reader.result).split(',')[1] || '',
      });
      S.docs.push({ name: r.name, text: r.text });
      renderTray();
    });
    reader.readAsDataURL(file);
  }
}
function addImages(files) {
  for (const file of files.slice(0, 4 - S.attach.length)) {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, 1280 / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k);
      c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      S.attach.push(c.toDataURL('image/jpeg', 0.86));
      URL.revokeObjectURL(url);
      renderTray();
    };
    img.src = url;
  }
}
function renderTray() {
  const tray = $('#tray');
  if (!tray) return;
  fill(
    tray,
    S.attach.map((src, i) =>
      h(
        'span',
        { class: 'thumb' },
        h('img', { src, alt: '' }),
        h(
          'button',
          {
            'aria-label': t('Delete'),
            onclick: () => {
              S.attach.splice(i, 1);
              renderTray();
            },
          },
          ic('x'),
        ),
      ),
    ),
    S.docs.map((d, i) =>
      h(
        'span',
        { class: 'queued doc', title: d.name },
        ic('file'),
        h('span', {}, d.name),
        h(
          'button',
          {
            'aria-label': t('Delete'),
            onclick: () => {
              S.docs.splice(i, 1);
              renderTray();
            },
          },
          ic('x'),
        ),
      ),
    ),
    S.queue.map((q, i) =>
      h(
        'span',
        { class: 'queued', title: q.text },
        ic('load'),
        h('span', {}, q.text || t('Images')),
        h(
          'button',
          {
            'aria-label': t('Delete'),
            onclick: () => {
              S.queue.splice(i, 1);
              renderTray();
            },
          },
          ic('x'),
        ),
      ),
    ),
  );
  tray.style.display = S.attach.length || S.queue.length || S.docs.length ? '' : 'none';
}
let mentionTimer;
function mentionMenu(ta) {
  const m = ta.value.slice(0, ta.selectionStart).match(/(?:^|\s)@([\w./\\-]*)$/);
  clearTimeout(mentionTimer);
  if (!m) return;
  mentionTimer = setTimeout(
    guard(async () => {
      const list = await api(
        '/api/files?id=' + encodeURIComponent(S.session.id) + '&q=' + encodeURIComponent(m[1]),
      );
      if (!list.length || document.activeElement !== ta) return closePop();
      openPop(
        $('#composer'),
        list.map((p) => ({
          icon: 'file',
          title: p,
          run: () => {
            const at = ta.selectionStart;
            const start = at - m[1].length;
            ta.value = ta.value.slice(0, start) + p + ' ' + ta.value.slice(at);
            ta.focus();
            ta.selectionStart = ta.selectionEnd = start + p.length + 1;
          },
        })),
      );
    }),
    120,
  );
}

function slashMenu(ta) {
  const m = ta.value.match(/^\/([a-z0-9-]*)$/i);
  if (!m) return closePop();
  const q = m[1].toLowerCase();
  const put = (name, space) => () => {
    ta.value = '/' + name + (space ? ' ' : '');
    ta.focus();
  };
  const items = [
    ...Object.entries(COMMANDS)
      .filter(([k]) => k.startsWith(q))
      .map(([k, [label, i]]) => ({ icon: i, title: '/' + k, meta: t(label), run: put(k) })),
    ...S.boot.skills
      .filter((s) => s.enabled && s.name.startsWith(q))
      .map((s) => ({ icon: 'bolt', title: '/' + s.name, meta: s.title, run: put(s.name, true) })),
  ];
  if (items.length) openPop($('#composer'), items);
  else closePop();
}

function modelMenu(e) {
  const cur = st().model;
  const items = [
    {
      icon: 'bolt',
      title: t('Auto'),
      tip: t('Picks the best installed model for each task'),
      on: cur === 'auto',
      run: () => guard(patchSession)({ model: 'auto' }),
    },
  ];
  for (const m of S.lib ? S.lib.installed : [])
    items.push({
      icon: 'cpu',
      title: m.name,
      meta: m.rate ? t(RATE[m.rate.level]) : '',
      on: cur === m.id,
      run: () => guard(patchSession)({ model: m.id }),
    });
  items.push('-', { icon: 'book', title: t('Library'), run: () => setView('library') });
  openPop(e.currentTarget, items);
}
function modeMenu(e) {
  openPop(
    e.currentTarget,
    Object.entries(MODES).map(([k, [label, tip]]) => ({
      title: t(label),
      tip: t(tip),
      on: st().mode === k,
      run: () => guard(patchSession)({ mode: k }),
    })),
  );
}
function fireCanvas(pop) {
  const cv = h('canvas', { class: 'firebg', 'aria-hidden': 'true' });
  pop.prepend(cv);
  const ctx = cv.getContext('2d');
  const css = getComputedStyle(document.documentElement);
  const colors = ['--hot', '--accent', '--accent-2'].map((v) => css.getPropertyValue(v).trim());
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const CELL = 6;
  let power = 0;
  let shown = 0;
  const loop = (now) => {
    if (!cv.isConnected) return;
    shown += (power - shown) * 0.14;
    const w = cv.clientWidth;
    const hgt = cv.clientHeight;
    if (cv.width !== w || cv.height !== hgt) {
      cv.width = w;
      cv.height = hgt;
    }
    ctx.clearRect(0, 0, w, hgt);
    if (shown > 0.01) {
      const tt = still ? 0 : now / 1000;
      for (let y = 0; y < hgt; y += CELL) {
        for (let x = 0; x < w; x += CELL) {
          const flick =
            0.5 +
            0.5 *
              Math.sin(x * 0.31 + tt * 5.1 + Math.sin(y * 0.23 - tt * 7.3) * 2.1) *
              Math.sin(y * 0.17 - tt * 6.2 + x * 0.05);
          const heat = Math.pow(x / w, 2.3) * (0.5 + 0.5 * (y / hgt)) * (0.4 + 0.8 * flick) * shown * 1.7;
          if (heat < 0.04) continue;
          ctx.globalAlpha = Math.min(0.92, heat);
          ctx.fillStyle = heat > 0.8 ? colors[2] : heat > 0.36 ? colors[1] : colors[0];
          ctx.fillRect(x + 1, y + 1, CELL - 2, CELL - 2);
        }
      }
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  return (p) => (power = p);
}

function effortMenu(e) {
  closePop();
  const top = EFFORT_KEYS.length - 1;
  const name = h('b', {});
  const ticks = h(
    'div',
    { class: 'ticks' },
    EFFORT_KEYS.map((k, i) => h('button', { onclick: () => settle(i) }, t(EFFORTS[k]))),
  );
  const range = h('input', {
    type: 'range',
    min: 0,
    max: top,
    step: 0.001,
    value: effortLevel(),
    'aria-label': t('Reasoning'),
  });
  const pop = h(
    'div',
    { class: 'pop effort', style: 'width:340px;max-width:none' },
    h(
      'div',
      { class: 'pad' },
      h('div', { class: 'slider-head' }, h('span', {}, t('Reasoning')), name),
      h('div', { class: 'track' }, range),
      ticks,
    ),
  );
  const setFire = fireCanvas(pop);
  const paint = () => {
    const v = Number(range.value);
    const near = Math.round(v);
    range.style.setProperty('--fill', (v / top) * 100 + '%');
    name.textContent = t(EFFORTS[EFFORT_KEYS[near]]);
    [...ticks.children].forEach((c, i) => c.classList.toggle('on', i === near));
    pop.classList.toggle('ultra', near === top);
    setFire(Math.max(0, v - (top - 1)));
  };
  let raf = 0;
  const settle = (target) => {
    cancelAnimationFrame(raf);
    const from = Number(range.value);
    const start = performance.now();
    const tick = (now) => {
      const p = Math.min(1, (now - start) / 160);
      range.value = from + (target - from) * (1 - Math.pow(1 - p, 3));
      paint();
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    if (EFFORT_KEYS[target] !== st().effort) guard(patchSession)({ effort: EFFORT_KEYS[target] });
  };
  range.addEventListener('input', paint);
  range.addEventListener('change', () => settle(Math.round(Number(range.value))));
  paint();
  placePop(pop, e.currentTarget, true);
  range.focus();
}
function folderMenu(e) {
  const items = [{ icon: 'folder', title: t('Choose folder'), run: guard(pickFolder) }];
  if (st().cwd)
    items.push({
      icon: 'right',
      title: t('Open in file manager'),
      run: guard(() => api('/api/open-folder', { id: S.session.id })),
    });
  openPop(e.currentTarget, items, { above: false });
}
async function pickFolder() {
  if (window.emberDesktop) {
    const dir = await window.emberDesktop.pickFolder();
    if (dir) await patchSession({ cwd: dir });
    return;
  }
  const input = h('input', {
    class: 'input',
    style: 'width:100%',
    placeholder: 'C:\\Projects\\my-app',
    value: st().cwd || '',
    'aria-label': t('Project folder'),
  });
  const go = (close) =>
    guard(async () => {
      await patchSession({ cwd: input.value });
      close();
    })();
  const close = modal(t('Project folder'), input, (c) => [
    h('button', { class: 'btn', onclick: c }, t('Cancel')),
    h('button', { class: 'btn primary', onclick: () => go(c) }, t('Choose')),
  ]);
  input.addEventListener('keydown', (ev) => ev.key === 'Enter' && go(close));
}

async function newChat() {
  Object.assign(S, {
    attach: [],
    queue: [],
    term: { log: '', cwd: '', busy: false },
    tree: { open: new Set(['.']), cache: new Map() },
    git: null,
  });
  S.session = await api('/api/session/new', {});
  setView('chat');
}
async function openSession(id) {
  Object.assign(S, {
    attach: [],
    queue: [],
    term: { log: '', cwd: '', busy: false },
    tree: { open: new Set(['.']), cache: new Map() },
    git: null,
  });
  S.session = await api('/api/session?id=' + encodeURIComponent(id));
  setView('chat');
}
