'use strict';

function modelName(id) {
  if (!id || id === 'auto') return t('Auto');
  const m = S.lib && S.lib.installed.find((x) => x.id === id);
  return m ? t(m.name) : id.replace(/^\w+:/, '');
}
const realModels = () => (S.lib ? S.lib.installed.filter((m) => m.provider !== 'demo') : []);

async function patchSession(patch) {
  const view = await api('/api/session/update', { id: S.session.id, patch });
  S.session.state = view.state;
  syncChrome();
}

function renderChat() {
  S.els.clear();
  const feed = h('div', { id: 'feed' }, h('div', { class: 'col', id: 'col' }));
  const ta = h('textarea', {
    id: 'ta',
    rows: 1,
    placeholder: t('What should I do?'),
    'aria-label': t('Message'),
  });
  const grow = () => {
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 220) + 'px';
  };
  ta.addEventListener('input', () => {
    grow();
    slashMenu(ta);
    mentionMenu(ta);
  });
  ta.addEventListener('paste', (e) => {
    const files = [...(e.clipboardData ? e.clipboardData.files : [])].filter((f) =>
      f.type.startsWith('image/'),
    );
    if (files.length) {
      e.preventDefault();
      addFiles(files);
    }
  });
  ta.addEventListener('keydown', (e) => {
    const ctrl = S.boot.settings.sendKey === 'ctrl';
    if (e.key === 'Enter' && !e.isComposing && (ctrl ? e.ctrlKey || e.metaKey : !e.shiftKey)) {
      e.preventDefault();
      submit();
    }
  });
  $('#main').className = 'chat';
  fill(
    $('#main'),
    h(
      'div',
      { class: 'top' },
      h('h1', { id: 'title' }),
      h('span', { class: 'sp' }),
      h('button', { class: 'chip', id: 'folder', 'data-pop': 1, onclick: folderMenu }),
      [
        ['term', 'term', 'Terminal'],
        ['files', 'folder', 'Files'],
        ['web', 'globe', 'Browser'],
        ['info', 'panel', 'Plan and files panel'],
      ].map(([key, icon, label]) =>
        h(
          'button',
          {
            class: 'iconbtn',
            id: 'pb-' + key,
            'aria-label': t(label),
            title: t(label),
            'aria-pressed': String(!!S.panes[key]),
            onclick: () => {
              S.panes[key] = !S.panes[key];
              syncChrome();
            },
          },
          ic(icon),
        ),
      ),
    ),
    feed,
    h(
      'div',
      { class: 'composer-wrap' },
      h(
        'div',
        { class: 'composer', id: 'composer' },
        h('div', { class: 'status', id: 'status', role: 'status' }),
        h('div', { class: 'tray', id: 'tray' }),
        ta,
        h(
          'div',
          { class: 'cbar' },
          h(
            'button',
            {
              class: 'pick',
              id: 'p-attach',
              'aria-label': t('Attach image'),
              title: t('Attach image'),
              onclick: () => $('#filepick').click(),
            },
            ic('clip'),
          ),
          h('input', {
            type: 'file',
            id: 'filepick',
            accept: 'image/*,.pdf,.docx,.xlsx,.pptx,.txt,.md,.csv,.json,.log',
            multiple: true,
            hidden: true,
            onchange: (e) => {
              addFiles([...e.target.files]);
              e.target.value = '';
            },
          }),
          h(
            'button',
            {
              class: 'pick',
              id: 'p-mic',
              'aria-label': t('Voice input'),
              title: t('Voice input'),
              onclick: guard(toggleVoice),
            },
            ic('mic'),
          ),
          h('button', {
            class: 'pick',
            id: 'p-model',
            'data-pop': 1,
            'aria-label': t('Model'),
            onclick: modelMenu,
          }),
          h('button', {
            class: 'pick',
            id: 'p-mode',
            'data-pop': 1,
            'aria-label': t('Mode'),
            onclick: modeMenu,
          }),
          h('button', {
            class: 'pick',
            id: 'p-effort',
            'data-pop': 1,
            'aria-label': t('Reasoning'),
            onclick: effortMenu,
          }),
          h('span', { class: 'sp' }),
          h(
            'button',
            {
              class: 'send',
              id: 'send',
              'data-pop': 1,
              onclick: () =>
                st().running && !$('#ta').value.trim() && !S.attach.length
                  ? api('/api/stop', { id: S.session.id })
                  : submit(),
              oncontextmenu: (e) => {
                e.preventDefault();
                contextMenu(e.currentTarget);
              },
            },
            h('span', {}),
          ),
        ),
      ),
    ),
  );
  for (const it of S.session.items) renderItem(it, true);
  if (!S.session.items.length) renderEmpty();
  fill(
    $('#right'),
    ['files', 'term', 'web', 'info'].map((k) => h('div', { class: 'pane', id: 'pane-' + k })),
  );
  syncChrome();
  renderTray();
  refreshGit();
  feed.scrollTop = feed.scrollHeight;
  ta.focus();
}

function renderEmpty() {
  const col = $('#col');
  if (!col) return;
  const suggest = (text) => {
    const ta = $('#ta');
    ta.value = text;
    ta.dispatchEvent(new Event('input'));
    ta.focus();
  };
  const hour = new Date().getHours();
  const hello = t(
    hour < 5 ? 'Good night' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening',
  );
  const who = S.boot.settings.userName;
  const noModels = S.lib && !realModels().length;
  fill(
    col,
    h(
      'div',
      { class: 'empty', id: 'empty' },
      h('h2', {}, hello + (who ? ', ' + who : '') + '. ', h('em', {}, t('What shall we make?'))),
      noModels &&
        h(
          'div',
          { class: 'callout' },
          h('b', {}, t('No models yet')),
          h('button', { class: 'btn primary', onclick: () => setView('library') }, ic('book'), t('Library')),
          h('button', { class: 'btn', onclick: () => suggest(t('make a notes app')) }, t('Demo')),
        ),
      S.templates.length
        ? h(
            'div',
            { class: 'tpls' },
            S.templates.map((tp) =>
              h(
                'button',
                {
                  class: 'tpl',
                  onclick: guard(async () => {
                    const r = await api('/api/template', { id: S.session.id, template: tp.id });
                    S.session.state.cwd = r.cwd;
                    S.tree.cache.clear();
                    S.panes.files = true;
                    syncChrome();
                    renderFilesPane();
                    suggest(r.prompt);
                  }),
                },
                ic(tp.icon || 'file'),
                t(tp.title),
              ),
            ),
          )
        : null,
      h(
        'div',
        { class: 'suggest' },
        [
          ['globe', 'Make a business-card site for a photographer'],
          ['code', 'Write a script that renames photos by date'],
          ['phone', 'Make a notes app for Android'],
          ['bug', 'Find and fix a bug in my project'],
        ].map(([i, text]) => h('button', { onclick: () => suggest(t(text)) }, ic(i), h('span', {}, t(text)))),
      ),
    ),
  );
}

const isWork = (it) => it.type === 'thought' || it.type === 'tool' || it.type === 'notice';
const toolTarget = (it) =>
  (it.args &&
    (it.args.path || it.args.command || it.args.pattern || it.args.name || it.args.query || it.args.url)) ||
  '';
const itemText = (it) => t(it.text, ...(it.vars || []));

function buildItem(it) {
  switch (it.type) {
    case 'user':
      return h(
        'div',
        { class: 'msg-user' },
        it.images &&
          h(
            'div',
            { class: 'thumbs' },
            it.images.map((src) => h('img', { src, alt: '' })),
          ),
        it.docs &&
          h(
            'div',
            { class: 'thumbs' },
            it.docs.map((n) => h('span', { class: 'queued doc' }, ic('file'), h('span', {}, n))),
          ),
        it.text,
      );
    case 'assistant': {
      const el = h('div', { class: 'msg-ai' }, md(it.text));
      if (it.planReady)
        el.append(
          h(
            'div',
            { class: 'row' },
            h(
              'button',
              {
                class: 'btn primary',
                onclick: guard(async () => {
                  await patchSession({ mode: 'acceptEdits' });
                  send(t('Plan approved. Carry it out step by step.'));
                }),
              },
              ic('check'),
              t('Run the plan'),
            ),
          ),
        );
      return el;
    }
    case 'question':
      return h(
        'div',
        { class: 'question msg-ai' },
        md(it.text),
        it.options && it.options.length
          ? h(
              'div',
              { class: 'opts' },
              it.options.map((o) => h('button', { class: 'btn', onclick: () => send(o) }, o)),
            )
          : null,
      );
    case 'thought':
      return h(
        'details',
        { class: 'step thought' + (it.live ? ' live' : '') },
        h('summary', {}, h('span', { class: 'body' }, it.text || t('Thinking…'))),
      );
    case 'tool': {
      const [label, icon] = TOOL_LABEL[it.tool] || [it.tool, 'dot'];
      const running = it.status === 'running';
      const head = [
        ic(icon),
        h('span', { class: 'lbl' }, t(label)),
        toolTarget(it) && h('span', { class: 'target' }, toolTarget(it)),
      ];
      if (it.status === 'ask') {
        const answer = (decision) =>
          guard(() => api('/api/permission', { id: S.session.id, item: it.id, decision }))();
        const risk = it.risk && it.risk !== 'normal';
        const a = it.args || {};
        const preview =
          it.tool === 'run_command'
            ? h('div', { class: 'out' }, a.command)
            : it.preview
              ? diffView(it.preview.before, it.preview.after).el
              : a.input
                ? h('div', { class: 'out' }, a.input)
                : a.query || a.url
                  ? h('div', { class: 'out' }, a.query || a.url)
                  : null;
        return h(
          'div',
          { class: 'step run' },
          h(
            'div',
            { class: 'perm' + (risk ? ' risk' : '') },
            h('h4', {}, it.tool === 'run_command' ? t('Run this command?') : `${t(label)}: ${a.path || ''}`),
            it.risk === 'dangerous' && h('div', { class: 'warn' }, t('This command may delete data')),
            it.risk === 'install' &&
              h('div', { class: 'warn' }, t('This command will download or install a program')),
            preview,
            h(
              'div',
              { class: 'row' },
              h('button', { class: 'btn primary sm', onclick: () => answer('allow') }, t('Allow')),
              !risk &&
                h('button', { class: 'btn sm', onclick: () => answer('always') }, t('Always in this chat')),
              h('button', { class: 'btn sm', onclick: () => answer('deny') }, t('Deny')),
            ),
          ),
        );
      }
      let body;
      let end = null;
      if (it.diff) {
        const v = diffView(it.diff.before, it.diff.after);
        body = it.status === 'fail' ? h('div', {}, v.el, h('div', { class: 'out' }, it.result)) : v.el;
        end = h(
          'span',
          { class: 'end' },
          v.added ? h('span', { class: 'plus' }, '+' + v.added) : null,
          v.removed ? h('span', { class: 'minus' }, '−' + v.removed) : null,
        );
      } else body = h('div', { class: 'out' }, it.result || '…');
      if (it.denied) end = h('span', { class: 'end minus' }, t('denied'));
      if (running && it.lines) end = h('span', { class: 'end plus' }, '+' + it.lines);
      return h(
        'details',
        { class: 'step ' + (running ? 'run' : it.status === 'ok' ? 'ok' : 'fail') },
        h('summary', {}, head, end, ic('chev', 'tw')),
        body,
      );
    }
    case 'notice': {
      if (it.kind === 'model')
        return h(
          'div',
          { class: 'step model' },
          h(
            'div',
            { class: 'plain' },
            ic('cpu'),
            h('b', {}, t(it.text)),
            [it.auto && t('chosen automatically'), it.ctx && t('context {0}', num(it.ctx))]
              .filter(Boolean)
              .map((x) => h('span', { class: 'sub' }, x)),
          ),
        );
      const icon =
        {
          'review-ok': 'check',
          review: 'search',
          compact: 'shrink',
          stop: 'stop',
          undo: 'undo',
          loop: 'stop',
          checkpoint: 'branch',
          vision: 'eye',
        }[it.kind] || 'dot';
      const cls = 'step' + (it.kind === 'review-ok' ? ' ok' : it.kind === 'loop' ? ' fail' : '');
      if (!it.detail) return h('div', { class: cls }, h('div', { class: 'plain' }, ic(icon), itemText(it)));
      return h(
        'details',
        { class: cls },
        h('summary', {}, ic(icon), h('span', { class: 'lbl wrap' }, itemText(it)), ic('chev', 'tw')),
        h('div', { class: 'out' }, t(it.detail)),
      );
    }
    case 'error':
      return h('div', { class: 'err', role: 'alert' }, itemText(it), it.hint ? ' ' + t(it.hint) : '');
    default:
      return h('div', {});
  }
}

function renderItem(it, initial) {
  const col = $('#col');
  if (!col) return;
  const empty = $('#empty');
  if (empty) empty.remove();
  const feed = $('#feed');
  const stick = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 140;
  const old = S.els.get(it.id);
  const el = buildItem(it);
  if (old && old.isConnected) {
    if (old.tagName === 'DETAILS' && el.tagName === 'DETAILS' && old.open) el.open = true;
    old.replaceWith(el);
  } else if (isWork(it)) {
    let work = col.lastElementChild;
    if (!work || !work.classList.contains('work')) col.append((work = h('div', { class: 'work' })));
    work.append(el);
  } else col.append(el);
  S.els.set(it.id, el);
  if (!initial && stick) feed.scrollTop = feed.scrollHeight;
}

function heat(pct) {
  return pct < 50
    ? `color-mix(in oklab, var(--accent) ${pct * 2}%, var(--calm))`
    : `color-mix(in oklab, var(--hot) ${(pct - 50) * 2}%, var(--accent))`;
}
const ctxPct = () => (st().ctxMax ? Math.min(100, Math.round((st().ctxUsed / st().ctxMax) * 100)) : 0);
const effortDots = (level) =>
  h(
    'span',
    { class: 'dots' },
    [4, 6, 8, 10, 12].map((px, i) => h('i', { class: i <= level ? 'on' : '', style: `height:${px}px` })),
  );

function syncChrome() {
  const s = st();
  if (S.view !== 'chat' || !S.session) {
    document.body.classList.remove('right-open');
    return $('#right').classList.add('hidden');
  }
  $('#title').textContent = s.title && S.session.items.length ? s.title : '';
  fill($('#folder'), ic('folder'), h('span', {}, s.cwd ? baseName(s.cwd) : t('Folder')), ic('chev', 'chev'));
  $('#folder').title = s.cwd || '';
  const pick = (id, lead, text) => fill($(id), lead || '', h('span', {}, text), ic('chev', 'chev'));
  pick('#p-model', ic('cpu'), modelName(s.model));
  pick('#p-mode', null, t((MODES[s.mode] || MODES.acceptEdits)[0]));
  const level = effortLevel();
  const ultra = EFFORT_KEYS[level] === 'ultra';
  pick('#p-effort', ultra ? ic('flame') : effortDots(level), t(EFFORTS[EFFORT_KEYS[level]]));
  $('#p-effort').classList.toggle('hot', ultra);

  const pct = ctxPct();
  const comp = $('#composer');
  comp.style.setProperty('--pct', pct);
  comp.style.setProperty('--heat', ultra && pct < 50 ? 'var(--accent)' : heat(pct));
  comp.classList.toggle('busy', !!s.running);
  comp.classList.toggle('ultra', ultra);
  $('#main').classList.toggle('ultra', ultra);
  const send = $('#send');
  send.setAttribute('aria-label', t(s.running ? 'Stop' : 'Send'));
  send.title = `${t('Context')} ${pct}%`;
  fill(send.firstChild, ic(s.running ? 'stop' : 'up'));
  const status = $('#status');
  status.style.display = s.running ? '' : 'none';
  if (s.running)
    fill(
      status,
      h('span', { class: 'pulse' }),
      h('b', {}, t(s.activeModel || modelName(s.model))),
      s.phase === 'loading'
        ? t('starting…')
        : t('working') + (s.speed ? ' · ' + t('{0} tok/s', s.speed) : ''),
      ultra && h('span', { class: 'tag hot' }, ic('flame'), t('full power')),
    );
  renderRight();
}
