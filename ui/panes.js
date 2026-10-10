'use strict';

async function refreshGit() {
  if (!S.session) return;
  try {
    S.git = (await api('/api/git?id=' + encodeURIComponent(S.session.id))).git;
  } catch {
    S.git = null;
  }
  if (S.view === 'chat') renderRight();
}

function renderRight() {
  const s = st();
  const right = $('#right');
  if (!$('#pane-info')) return;
  const agents = s.agents || {};
  const files = Object.entries(s.changed || {});
  const active = Object.values(agents).some((v) => v && v !== 'idle');
  const hasInfo =
    active || (s.plan && s.plan.length) || files.length || S.git || (s.checkpoints || []).length;
  const shown = {
    files: S.panes.files,
    term: S.panes.term,
    web: S.panes.web,
    info: S.panes.info && !!hasInfo,
  };
  for (const k of Object.keys(shown)) {
    $('#pane-' + k).style.display = shown[k] ? '' : 'none';
    $('#pb-' + k).classList.toggle('on', !!S.panes[k]);
  }
  const any = Object.values(shown).some(Boolean);
  right.classList.toggle('hidden', !any);
  right.classList.toggle('wide', shown.files || shown.term || shown.web);
  document.body.classList.toggle('right-open', any);
  if (shown.files && !$('#pane-files').firstChild) renderFilesPane();
  if (shown.term && !$('#pane-term').firstChild) renderTermPane();
  if (shown.web && !$('#pane-web').firstChild) renderWebPane();
  if (!shown.info) return;
  const AG = { planner: 'Planner', coder: 'Worker', reviewer: 'Reviewer' };
  fill(
    $('#pane-info'),
    active &&
      h(
        'div',
        { class: 'sec' },
        h('h3', {}, t('Agents')),
        Object.keys(AG).map((k) => {
          const v = agents[k] || 'idle';
          return h(
            'div',
            { class: 'agent ' + v },
            v === 'run' ? ic('load', 'lead spin') : ic(v === 'done' ? 'check' : 'dot', 'lead'),
            t(AG[k]),
          );
        }),
      ),
    s.plan && s.plan.length
      ? h(
          'div',
          { class: 'sec' },
          h('h3', {}, t('Plan')),
          s.plan.map((p, i) => {
            const cur = !p.done && i === s.planStep - 1 && s.running;
            return h(
              'div',
              { class: 'pstep' + (p.done ? ' done' : cur ? ' cur' : '') },
              ic(p.done ? 'check' : cur ? 'right' : 'dot', 'lead'),
              h('span', {}, p.text),
            );
          }),
        )
      : null,
    files.length
      ? h(
          'div',
          { class: 'sec' },
          h(
            'h3',
            {},
            t('Files'),
            h('button', { onclick: guard(() => api('/api/open-folder', { id: S.session.id })) }, t('Folder')),
            h('button', { onclick: guard(() => undo()) }, t('Undo all')),
          ),
          files.map(([p, f]) =>
            h(
              'button',
              { class: 'frow', title: p, onclick: guard(() => viewFile(p)) },
              ic(f.status === 'deleted' ? 'trash' : 'file', 'lead'),
              h('span', { class: 'n' }, p),
              f.added ? h('span', { class: 'plus' }, '+' + f.added) : null,
              f.removed ? h('span', { class: 'minus' }, '−' + f.removed) : null,
            ),
          ),
        )
      : null,
    S.git || (s.checkpoints || []).length
      ? h(
          'div',
          { class: 'sec' },
          h(
            'h3',
            {},
            'Git',
            S.git && S.git.changed ? h('button', { onclick: commitDialog }, t('Commit')) : null,
          ),
          S.git &&
            h(
              'div',
              { class: 'agent' },
              ic('branch', 'lead'),
              S.git.branch,
              h('span', { class: 'sub2' }, t('{0} changed', S.git.changed)),
            ),
          (s.checkpoints || []).map((c) =>
            h(
              'button',
              { class: 'frow', title: c.label, onclick: () => restoreDialog(c) },
              ic('undo', 'lead'),
              h(
                'span',
                { class: 'n' },
                new Date(c.at).toLocaleTimeString(LANG, { hour: '2-digit', minute: '2-digit' }) +
                  ' · ' +
                  c.label,
              ),
            ),
          ),
        )
      : null,
  );
}

function commitDialog() {
  const input = h('input', {
    class: 'input',
    style: 'width:100%',
    placeholder: t('Commit message'),
    'aria-label': t('Commit message'),
  });
  const go = (close) =>
    guard(async () => {
      S.git = (await api('/api/git/commit', { id: S.session.id, message: input.value })).git;
      close();
      renderRight();
      toast('Committed');
    })();
  const close = modal(
    t('Commit'),
    h(
      'div',
      { class: 'form' },
      input,
      h(
        'div',
        { class: 'out', style: 'margin:0' },
        (S.git.files || []).map((f) => f.code + '  ' + f.path).join('\n'),
      ),
    ),
    (c) => [
      h('button', { class: 'btn', onclick: c }, t('Cancel')),
      h('button', { class: 'btn primary', onclick: () => go(c) }, t('Commit')),
    ],
  );
  input.addEventListener('keydown', (e) => e.key === 'Enter' && go(close));
}
function restoreDialog(c) {
  modal(t('Restore the files to this checkpoint?'), h('p', { style: 'margin:0' }, c.label), (close) => [
    h('button', { class: 'btn', onclick: close }, t('Cancel')),
    h(
      'button',
      {
        class: 'btn danger',
        onclick: guard(async () => {
          close();
          S.git = (await api('/api/git/restore', { id: S.session.id, ref: c.ref })).git;
          S.tree.cache.clear();
          renderRight();
          toast('Restored');
        }),
      },
      ic('undo'),
      t('Restore checkpoint'),
    ),
  ]);
}

async function renderFilesPane() {
  const pane = $('#pane-files');
  if (!pane) return;
  const load = async (dir) => {
    if (!S.tree.cache.has(dir))
      S.tree.cache.set(
        dir,
        await api(
          '/api/tree?id=' + encodeURIComponent(S.session.id) + '&path=' + encodeURIComponent(dir),
        ).catch(() => []),
      );
    return S.tree.cache.get(dir);
  };
  const rows = [];
  const walk = async (dir, depth) => {
    for (const e of await load(dir)) {
      const p = dir === '.' ? e.name : dir + '/' + e.name;
      const open = S.tree.open.has(p);
      rows.push(
        h(
          'button',
          {
            class: 'trow',
            style: 'padding-left:' + (10 + depth * 14) + 'px',
            title: p,
            onclick: guard(async () => {
              if (!e.dir) return openFile(p);
              if (open) S.tree.open.delete(p);
              else S.tree.open.add(p);
              renderFilesPane();
            }),
          },
          ic(e.dir ? (open ? 'chev' : 'right') : 'file'),
          h('span', {}, e.name),
        ),
      );
      if (e.dir && open) await walk(p, depth + 1);
    }
  };
  await walk('.', 0);
  fill(
    pane,
    h(
      'div',
      { class: 'phead' },
      ic('folder'),
      h('b', {}, t('Files')),
      h('span', { class: 'sp' }),
      h(
        'button',
        {
          class: 'iconbtn',
          'aria-label': t('Check'),
          onclick: () => {
            S.tree.cache.clear();
            renderFilesPane();
          },
        },
        ic('reload'),
      ),
      h(
        'button',
        {
          class: 'iconbtn',
          'aria-label': t('Close'),
          onclick: () => {
            S.panes.files = false;
            syncChrome();
          },
        },
        ic('x'),
      ),
    ),
    h('div', { class: 'pbody tree' }, rows),
  );
}
async function openFile(p) {
  const f = await api('/api/file?id=' + encodeURIComponent(S.session.id) + '&path=' + encodeURIComponent(p));
  const text = f.after == null ? '' : f.after;
  const body = text.includes('\u0000')
    ? h('p', { style: 'margin:0' }, p)
    : h('pre', { class: 'out', style: 'max-height:none;margin:0' }, text.slice(0, 120000));
  modal(p, body, (close) => [
    /\.html?$/i.test(p) &&
      h(
        'button',
        {
          class: 'btn',
          onclick: () => {
            close();
            openBrowser('file:///' + (st().cwd + '/' + p).replace(/\\/g, '/'));
          },
        },
        ic('globe'),
        t('Open in browser'),
      ),
    h(
      'button',
      {
        class: 'btn',
        onclick: () => {
          close();
          const ta = $('#ta');
          ta.value += (ta.value && !/\s$/.test(ta.value) ? ' ' : '') + '@' + p + ' ';
          ta.focus();
        },
      },
      '@ ',
      t('Mention file'),
    ),
    h('button', { class: 'btn', onclick: close }, t('Close')),
  ]);
}

function renderTermPane() {
  const pane = $('#pane-term');
  if (!pane) return;
  const had = document.activeElement && document.activeElement.id === 'term-in';
  const typed = $('#term-in') ? $('#term-in').value : '';
  const out = h('pre', { class: 'termout' }, S.term.log);
  const input = h('input', {
    id: 'term-in',
    class: 'termin',
    value: typed,
    spellcheck: 'false',
    autocomplete: 'off',
    placeholder: t('Type a command'),
    'aria-label': t('Type a command'),
    disabled: S.term.busy,
  });
  input.addEventListener(
    'keydown',
    guard(async (e) => {
      if (e.key !== 'Enter' || !input.value.trim()) return;
      const command = input.value;
      input.value = '';
      S.term.log += '> ' + command + '\n';
      try {
        const r = await api('/api/term/run', { id: S.session.id, command });
        S.term.cwd = r.cwd;
        S.term.busy = !!r.started;
      } catch (err) {
        S.term.log += err.message + '\n';
      }
      renderTermPane();
    }),
  );
  fill(
    pane,
    h(
      'div',
      { class: 'phead' },
      ic('term'),
      h('b', {}, t('Terminal')),
      h('span', { class: 'sub2', title: S.term.cwd }, baseName(S.term.cwd || st().cwd)),
      h('span', { class: 'sp' }),
      S.term.busy &&
        h(
          'button',
          {
            class: 'iconbtn',
            'aria-label': t('Stop'),
            onclick: guard(() => api('/api/term/stop', { id: S.session.id })),
          },
          ic('stop'),
        ),
      h(
        'button',
        {
          class: 'iconbtn',
          'aria-label': t('Close'),
          onclick: () => {
            S.panes.term = false;
            syncChrome();
          },
        },
        ic('x'),
      ),
    ),
    h(
      'div',
      { class: 'pbody term' },
      out,
      h('div', { class: 'termline' }, S.term.busy ? ic('load', 'spin') : h('span', {}, '>'), input),
    ),
  );
  out.scrollTop = out.scrollHeight;
  if (had || !S.term.busy) input.focus();
}

function openBrowser(url) {
  S.web.url = url;
  S.panes.web = true;
  syncChrome();
  renderWebPane();
}
function renderWebPane() {
  const pane = $('#pane-web');
  if (!pane) return;
  const desktop = !!window.emberDesktop;
  const view = S.web.url
    ? h(desktop ? 'webview' : 'iframe', { class: 'webview', src: S.web.url })
    : h('div', { class: 'webview blank' }, ic('globe'));
  const bar = h('input', {
    class: 'input',
    value: S.web.url,
    placeholder: t('Type a URL'),
    'aria-label': t('Type a URL'),
    spellcheck: 'false',
  });
  const go = (raw) => {
    let u = raw.trim();
    if (!u) return;
    if (!/^[a-z]+:/i.test(u))
      u =
        /^[^\s]+\.[^\s]+$/.test(u) || u.startsWith('localhost')
          ? 'https://' + u
          : 'https://duckduckgo.com/?q=' + encodeURIComponent(u);
    if (u.startsWith('https://localhost')) u = u.replace('https://', 'http://');
    openBrowser(u);
  };
  bar.addEventListener('keydown', (e) => e.key === 'Enter' && go(bar.value));
  if (desktop && S.web.url) {
    view.addEventListener('did-navigate', (e) => ((S.web.url = e.url), (bar.value = e.url)));
    view.addEventListener(
      'did-navigate-in-page',
      (e) => e.isMainFrame && ((S.web.url = e.url), (bar.value = e.url)),
    );
  }
  const nav = (fn) => () => desktop && S.web.url && view[fn] && view[fn]();
  fill(
    pane,
    h(
      'div',
      { class: 'phead' },
      h('button', { class: 'iconbtn', 'aria-label': t('Back'), onclick: nav('goBack') }, ic('left')),
      h(
        'button',
        {
          class: 'iconbtn',
          'aria-label': t('Check'),
          onclick: () => (desktop && S.web.url ? view.reload() : renderWebPane()),
        },
        ic('reload'),
      ),
      bar,
      h(
        'button',
        {
          class: 'iconbtn',
          'aria-label': t('Open in your browser'),
          title: t('Open in your browser'),
          onclick: () => {
            if (!/^https?:/.test(S.web.url)) return;
            if (desktop) window.emberDesktop.openExternal(S.web.url);
            else window.open(S.web.url, '_blank', 'noopener');
          },
        },
        ic('ext'),
      ),
      h(
        'button',
        {
          class: 'iconbtn',
          'aria-label': t('Close'),
          onclick: () => {
            S.panes.web = false;
            syncChrome();
          },
        },
        ic('x'),
      ),
    ),
    h('div', { class: 'pbody web' }, view),
  );
}
