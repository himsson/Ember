'use strict';

const S = {
  boot: null,
  view: 'chat',
  session: null,
  sessions: [],
  lib: null,
  rightOpen: true,
  engineInstall: null,
  lf: { cat: 'all', auto: true, size: 'all', speed: 'all', company: 'all', q: '', tab: 'catalog' },
  els: new Map(),
  tests: {},
  panes: { term: false, files: false, web: false, info: true },
  attach: [],
  queue: [],
  term: { log: '', cwd: '', busy: false },
  tree: { open: new Set(['.']), cache: new Map() },
  web: { url: '' },
  git: null,
  mcp: [],
  docs: [],
  chatQuery: '',
  voice: { rec: null, busy: false },
  templates: [],
  share: null,
};

const MODES = {
  auto: ['Auto', 'Edits files and runs commands on its own'],
  acceptEdits: ['Accept edits', 'Edits on its own, asks before commands'],
  manual: ['Manual', 'Asks before every action'],
  plan: ['Plan', 'Only reads and makes a plan'],
};
const EFFORT_KEYS = ['low', 'medium', 'high', 'extra', 'ultra'];
const EFFORTS = { low: 'Low', medium: 'Medium', high: 'High', extra: 'Extra', ultra: 'Ultra' };
const TOOL_LABEL = {
  list_dir: ['List folder', 'folder'],
  read_file: ['Read', 'file'],
  search_text: ['Search', 'search'],
  check_tool: ['Check program', 'cpu'],
  write_file: ['Write', 'file'],
  append_file: ['Append', 'file'],
  edit_file: ['Edit', 'edit'],
  make_dir: ['New folder', 'folder'],
  delete_file: ['Delete', 'trash'],
  run_command: ['Command', 'term'],
  use_skill: ['Skill', 'bolt'],
  find_code: ['Project search', 'search'],
  remember: ['Memory', 'pin'],
  web_search: ['Web search', 'globe'],
  web_fetch: ['Read page', 'globe'],
  use_tool: ['External tool', 'plug'],
};
const RATE = { fast: 'Fast', ok: 'OK', slow: 'Slow', no: 'Won’t run' };
const CATS = [
  ['all', 'All models', 'grid', () => true],
  ['universal', 'Universal', 'globe', (m) => m.cat === 'universal'],
  ['code', 'Coding', 'code', (m) => m.cat === 'code'],
  ['text', 'Text and chat', 'pen', (m) => m.cat === 'text'],
  ['agent', 'Best for agents', 'robot', (m) => m.agent === 3],
  ['reasoning', 'Reasoning', 'brain', (m) => m.thinking],
  ['vision', 'Understands images', 'eye', (m) => m.vision],
  ['small', 'For weak PCs', 'feather', (m) => m.params <= 4],
  ['tiny', 'Tiny, under 1 GB', 'atom', (m) => m.sizeGB < 1],
  ['big', 'Big, for 24 GB and more', 'box', (m) => m.sizeGB >= 17],
  ['uncensored', 'Uncensored', 'unlock', (m) => m.uncensored],
];
const SIZES = [
  ['all', 'Any', () => true],
  ['xs', 'Under 2B', (p) => p < 2],
  ['s', '2–4B', (p) => p >= 2 && p <= 4],
  ['m', '5–9B', (p) => p > 4 && p < 10],
  ['l', '10–16B', (p) => p >= 10 && p <= 16],
  ['xl', '17–34B', (p) => p > 16 && p <= 34],
  ['xxl', '35B and up', (p) => p > 34],
];
const PURPOSES = ['Coding', 'Writing', 'Study', 'Work', 'Just exploring'];
const st = () => (S.session ? S.session.state : {});
const baseName = (p) =>
  String(p || '')
    .split(/[\\/]/)
    .filter(Boolean)
    .pop() || '';
const num = (n) => Number(n || 0).toLocaleString(LANG);
const effortLevel = () => Math.max(0, EFFORT_KEYS.indexOf(st().effort || 'medium'));
const hwLine = (hw) =>
  hw.vramGB ? t('{0} GB video · {1} GB RAM', hw.vramGB, hw.ramGB) : t('{0} GB RAM · no video card', hw.ramGB);

function applyLook() {
  const s = S.boot.settings;
  const root = document.documentElement;
  root.dataset.theme =
    s.theme === 'system'
      ? matchMedia('(prefers-color-scheme: light)').matches
        ? 'light'
        : 'dark'
      : s.theme || 'dark';
  root.dataset.scale = s.fontScale || 'm';
  setLang(s.lang || 'en');
  if (window.emberDesktop) {
    root.classList.add('desktop');
    window.emberDesktop.setTheme(root.dataset.theme);
  }
}
async function saveSettings(patch) {
  Object.assign(S.boot.settings, patch);
  applyLook();
  const r = await api('/api/settings', S.boot.settings);
  Object.assign(S.boot.settings, r.settings);
  S.boot.hardware = r.hardware;
  if (r.gpuPlan) S.boot.gpuPlan = r.gpuPlan;
}

function closePop() {
  $('#layer')
    .querySelectorAll('.pop')
    .forEach((p) => p.remove());
}
function placePop(pop, anchor, above) {
  $('#layer').append(pop);
  const r = anchor.getBoundingClientRect();
  const pr = pop.getBoundingClientRect();
  pop.style.left = Math.max(8, Math.min(r.left, innerWidth - pr.width - 8)) + 'px';
  pop.style.top =
    (above && r.top - pr.height - 8 > 8
      ? r.top - pr.height - 8
      : Math.min(r.bottom + 8, innerHeight - pr.height - 8)) + 'px';
  return pop;
}
function openPop(anchor, items, { above = true } = {}) {
  closePop();
  const pop = h('div', { class: 'pop', role: 'menu' });
  for (const it of items) {
    if (it === '-') pop.append(h('div', { class: 'sep' }));
    else if (it.label) pop.append(h('div', { class: 'lbl' }, it.label));
    else
      pop.append(
        h(
          'button',
          { class: 'mi', role: 'menuitem', title: it.tip, onclick: () => (closePop(), it.run()) },
          it.icon && ic(it.icon),
          h('span', { class: 't' }, it.title),
          it.meta && h('span', { class: 'm' }, it.meta),
          it.on && ic('check', 'ck'),
        ),
      );
  }
  return placePop(pop, anchor, above);
}
document.addEventListener('mousedown', (e) => {
  if (!e.target.closest('.pop') && !e.target.closest('[data-pop]')) closePop();
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const o = $('.overlay');
  if ($('.pop')) closePop();
  else if (o) o.remove();
  else if (S.view === 'chat' && st().running) api('/api/stop', { id: S.session.id });
});
function modal(title, body, footer) {
  document.querySelectorAll('.overlay').forEach((o) => o.remove());
  const close = () => ov.remove();
  const ov = h(
    'div',
    { class: 'overlay', onmousedown: (e) => e.target === ov && close() },
    h(
      'div',
      { class: 'modal', role: 'dialog', 'aria-label': title },
      h(
        'header',
        {},
        h('h3', {}, title),
        h('button', { class: 'iconbtn', 'aria-label': t('Close'), onclick: close }, ic('x')),
      ),
      h('div', { class: 'mbody' }, body),
      footer && h('footer', {}, footer(close)),
    ),
  );
  $('#layer').append(ov);
  const f = ov.querySelector('input, textarea');
  if (f) f.focus();
  return close;
}

function inline(text) {
  return text.split(/(`[^`\n]+`|\*\*[^*\n]+\*\*)/).map((p) => {
    if (p.length > 2 && p.startsWith('`') && p.endsWith('`')) return h('code', {}, p.slice(1, -1));
    if (p.length > 4 && p.startsWith('**') && p.endsWith('**')) return h('strong', {}, p.slice(2, -2));
    return p;
  });
}
function md(text) {
  const root = h('div', {});
  String(text)
    .split('```')
    .forEach((chunk, i) => {
      if (i % 2)
        return root.append(h('pre', {}, h('code', {}, chunk.replace(/^[\w+-]*\n/, '').replace(/\n$/, ''))));
      let list = null;
      let para = [];
      const flush = () => {
        if (para.length)
          root.append(h('p', {}, ...para.flatMap((l, j) => (j ? [h('br'), ...inline(l)] : inline(l)))));
        para = [];
      };
      for (const line of chunk.split('\n')) {
        const li = line.match(/^\s*(?:[-*•]|(\d+)[.)])\s+(.*)$/);
        const hd = line.match(/^#{1,4}\s+(.*)$/);
        if (li) {
          flush();
          const tag = li[1] ? 'ol' : 'ul';
          if (!list || list.tagName.toLowerCase() !== tag) root.append((list = h(tag, {})));
          list.append(h('li', {}, ...inline(li[2])));
          continue;
        }
        list = null;
        if (hd) {
          flush();
          root.append(h('h3', {}, ...inline(hd[1])));
        } else if (!line.trim()) flush();
        else para.push(line);
      }
      flush();
    });
  return root;
}

function diffLines(a, b) {
  const A = a ? a.split('\n') : [];
  const B = b ? b.split('\n') : [];
  if (A.length * B.length > 1500000) return null;
  const dp = Array.from({ length: A.length + 1 }, () => new Uint16Array(B.length + 1));
  for (let i = A.length - 1; i >= 0; i--)
    for (let j = B.length - 1; j >= 0; j--)
      dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out = [];
  let i = 0;
  let j = 0;
  while (i < A.length || j < B.length) {
    if (i < A.length && j < B.length && A[i] === B[j]) (out.push([' ', A[i++]]), j++);
    else if (j < B.length && (i >= A.length || dp[i][j + 1] >= dp[i + 1][j])) out.push(['+', B[j++]]);
    else out.push(['-', A[i++]]);
  }
  return out;
}
function diffView(before, after, { full } = {}) {
  const box = h('div', { class: 'diff' });
  const d = diffLines(before || '', after || '');
  if (!d) {
    box.append(h('div', {}, h('span', {}, t('File is too large to compare'))));
    return { el: box, added: 0, removed: 0 };
  }
  const keep = new Uint8Array(d.length);
  d.forEach(([k], i) => {
    if (k !== ' ') for (let n = Math.max(0, i - 3); n <= Math.min(d.length - 1, i + 3); n++) keep[n] = 1;
  });
  let skipped = 0;
  let shown = 0;
  const limit = full ? 5000 : 400;
  d.forEach(([k, line], i) => {
    if (!keep[i] && !full) return void skipped++;
    if (skipped) box.append(h('div', { class: 'gap' }, '⋯ ' + t('{0} unchanged lines', skipped)));
    skipped = 0;
    if (shown++ < limit)
      box.append(
        h(
          'div',
          { class: k === '+' ? 'a' : k === '-' ? 'd' : '' },
          h('i', {}, k === '+' ? '+' : k === '-' ? '−' : ''),
          h('span', {}, line || ' '),
        ),
      );
  });
  if (shown > limit) box.append(h('div', { class: 'gap' }, '⋯ ' + t('{0} more lines', shown - limit)));
  return {
    el: box,
    added: d.filter((x) => x[0] === '+').length,
    removed: d.filter((x) => x[0] === '-').length,
  };
}
