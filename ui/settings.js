'use strict';

function renderSkills() {
  const field = (label, el) => h('div', { class: 'field' }, h('label', {}, t(label)), el);
  const edit = (sk) => {
    const f = {
      name: h('input', { class: 'input', value: sk ? sk.name : '', placeholder: 'my-skill', disabled: !!sk }),
      title: h('input', { class: 'input', value: sk ? sk.title : '' }),
      description: h('input', { class: 'input', value: sk ? sk.description : '' }),
      body: h('textarea', { class: 'input mono', rows: 14 }),
    };
    f.body.value = sk ? sk.body : '';
    modal(
      sk ? sk.title : t('New skill'),
      h(
        'div',
        { class: 'form' },
        h('div', { class: 'grid2' }, field('Command (latin letters)', f.name), field('Name', f.title)),
        field('When to use', f.description),
        field('Instructions for the model', f.body),
      ),
      (close) => [
        sk &&
          !sk.builtin &&
          h(
            'button',
            {
              class: 'btn danger',
              style: 'margin-right:auto',
              onclick: guard(async () => {
                S.boot.skills = await api('/api/skills/delete', { name: sk.name });
                close();
                renderSkills();
              }),
            },
            t('Delete'),
          ),
        h('button', { class: 'btn', onclick: close }, t('Cancel')),
        h(
          'button',
          {
            class: 'btn primary',
            onclick: guard(async () => {
              if (!f.body.value.trim()) return toast('Add instructions');
              S.boot.skills = await api('/api/skills/save', {
                name: f.name.value,
                title: f.title.value,
                description: f.description.value,
                body: f.body.value,
              });
              close();
              renderSkills();
            }),
          },
          t('Save'),
        ),
      ],
    );
  };
  $('#main').className = '';
  fill(
    $('#main'),
    h(
      'div',
      { class: 'page' },
      h(
        'div',
        { class: 'page-in' },
        h(
          'div',
          { class: 'page-head' },
          h('h2', {}, t('Skills')),
          h('button', { class: 'btn primary', onclick: () => edit(null) }, ic('plus'), t('Create')),
        ),
        h(
          'div',
          { class: 'cards' },
          S.boot.skills.map((sk) =>
            h(
              'div',
              { class: 'card', title: sk.description },
              h(
                'div',
                { class: 'hd' },
                h(
                  'div',
                  {},
                  h('div', { class: 'nm' }, sk.title),
                  h('div', { class: 'co mono' }, '/' + sk.name),
                ),
                h(
                  'label',
                  { class: 'switch', style: 'margin-left:auto' },
                  h('input', {
                    type: 'checkbox',
                    checked: sk.enabled,
                    'aria-label': sk.title,
                    onchange: guard(async (e) => {
                      S.boot.skills = await api('/api/skills/toggle', {
                        name: sk.name,
                        enabled: e.target.checked,
                      });
                    }),
                  }),
                  h('i'),
                ),
              ),
              h(
                'div',
                { class: 'foot' },
                h('span', { class: 'grow' }, t(sk.builtin ? 'Built-in' : 'Yours')),
                h('button', { class: 'btn sm', onclick: () => edit(sk) }, t('Open')),
              ),
            ),
          ),
        ),
      ),
    ),
  );
}

function renderSettings() {
  const s = S.boot.settings;
  let timer;
  const save = (patch, redraw) => {
    Object.assign(s, patch);
    applyLook();
    if (redraw) {
      renderSide();
      renderSettings();
    }
    clearTimeout(timer);
    timer = setTimeout(
      guard(async () => {
        const cards = JSON.stringify(S.boot.gpuPlan);
        await saveSettings({});
        S.lib = null;
        renderSide();
        const before = JSON.stringify(S.mcp);
        S.mcp = await api('/api/mcp');
        if (
          S.view === 'settings' &&
          (JSON.stringify(S.mcp) !== before || JSON.stringify(S.boot.gpuPlan) !== cards)
        )
          renderSettings();
      }),
      400,
    );
  };
  const field = (label, el) => h('div', { class: 'field' }, h('label', {}, t(label)), el);
  const text = (key, ph, type) =>
    h('input', {
      class: 'input',
      type: type || 'text',
      value: s[key] == null ? '' : s[key],
      placeholder: ph || '',
      oninput: (e) => save({ [key]: type === 'number' ? Number(e.target.value) : e.target.value }),
    });
  const select = (key, opts) => {
    const cur = opts.find(([v]) => String(v) === String(s[key])) || opts[0];
    return h(
      'button',
      {
        class: 'input select',
        'data-pop': 1,
        'aria-haspopup': 'menu',
        onclick: (e) => {
          const width = e.currentTarget.offsetWidth;
          const pop = openPop(
            e.currentTarget,
            opts.map(([v, label]) => ({
              title: label,
              on: v === cur[0],
              run: () => save({ [key]: v }, true),
            })),
            { above: false },
          );
          pop.style.minWidth = width + 'px';
        },
      },
      h('span', {}, cur[1]),
      ic('chev'),
    );
  };
  const seg = (key, opts) =>
    h(
      'div',
      { class: 'seg', role: 'group' },
      opts.map(([v, label]) =>
        h(
          'button',
          {
            class: s[key] === v ? 'on' : '',
            'aria-pressed': String(s[key] === v),
            onclick: () => save({ [key]: v }, true),
          },
          t(label),
        ),
      ),
    );
  const sw = (checked, onchange, label) =>
    h(
      'label',
      { class: 'swrow' },
      h('span', { class: 'switch' }, h('input', { type: 'checkbox', checked, onchange }), h('i')),
      h('span', {}, t(label)),
    );
  const o = s.hardwareOverride;
  const d = S.boot.detected;
  $('#main').className = '';
  fill(
    $('#main'),
    h(
      'div',
      { class: 'page' },
      h(
        'div',
        { class: 'page-in' },
        h('div', { class: 'page-head' }, h('h2', {}, t('Settings'))),
        h(
          'div',
          { class: 'group' },
          h('h3', {}, t('App')),
          h(
            'div',
            { class: 'grid2' },
            field('Language', select('lang', Object.entries(LANGS))),
            field(
              'Theme',
              seg('theme', [
                ['dark', 'Dark'],
                ['light', 'Light'],
                ['system', 'System'],
              ]),
            ),
          ),
          h(
            'div',
            { class: 'grid2' },
            field(
              'Text size',
              seg('fontScale', [
                ['s', 'Small'],
                ['m', 'Normal'],
                ['l', 'Large'],
              ]),
            ),
            field(
              'Send message with',
              seg('sendKey', [
                ['enter', 'Enter'],
                ['ctrl', 'Ctrl + Enter'],
              ]),
            ),
          ),
          sw(
            s.notify,
            guard(async (e) => {
              if (e.target.checked && 'Notification' in window && Notification.permission !== 'granted')
                await Notification.requestPermission();
              save({ notify: e.target.checked });
            }),
            'Notify when the agent finishes',
          ),
        ),
        h('div', { class: 'group' }, h('h3', {}, t('Profile')), field('Your name', text('userName'))),
        h(
          'div',
          { class: 'group' },
          h('h3', {}, t('Agent')),
          h(
            'div',
            { class: 'grid2' },
            field(
              'Mode for new chats',
              select(
                'defaultMode',
                Object.entries(MODES).map(([k, v]) => [k, t(v[0])]),
              ),
            ),
            field(
              'Reasoning for new chats',
              select(
                'defaultEffort',
                Object.entries(EFFORTS).map(([k, v]) => [k, t(v)]),
              ),
            ),
          ),
          h(
            'div',
            { class: 'grid2' },
            field(
              'Context window',
              select('numCtx', [
                [0, t('Auto')],
                [4096, '4 096'],
                [8192, '8 192'],
                [16384, '16 384'],
                [32768, '32 768'],
                [65536, '65 536'],
              ]),
            ),
            field('Folder for new projects', text('projectsDir', S.boot.projectsDir)),
          ),
        ),
        h(
          'div',
          { class: 'group' },
          h('h3', {}, t('Models')),
          h(
            'div',
            { class: 'grid2' },
            field(
              'Keep model in memory',
              select('keepAlive', [
                [2, t('{0} minutes', 2)],
                [5, t('{0} minutes', 5)],
                [10, t('{0} minutes', 10)],
                [30, t('{0} minutes', 30)],
                [60, t('1 hour')],
              ]),
            ),
            field('Engine address', text('ollamaUrl', 'http://127.0.0.1:11434')),
          ),
          sw(
            s.openaiEnabled,
            (e) => save({ openaiEnabled: e.target.checked }),
            'Own server: LM Studio, llama.cpp, KoboldCpp',
          ),
          h(
            'div',
            { class: 'grid2' },
            field('Server address', text('openaiUrl', 'http://127.0.0.1:1234/v1')),
            field('Key', text('openaiKey', '', 'password')),
          ),
        ),
        h(
          'div',
          { class: 'group' },
          h('h3', {}, t('Memory')),
          sw(
            s.memory !== false,
            (e) => save({ memory: e.target.checked }, true),
            'Remember facts about me between chats',
          ),
          s.memory !== false &&
            (() => {
              const box = h('textarea', { class: 'input', rows: 5, 'aria-label': t('Memory') });
              box.value = S.memoryText || '';
              box.addEventListener(
                'change',
                guard(async () => {
                  S.memoryText = (await api('/api/memory', { text: box.value })).text;
                  toast('Saved');
                }),
              );
              return box;
            })(),
        ),
        h(
          'div',
          { class: 'group' },
          h('h3', {}, t('Checks')),
          sw(
            s.runTests !== false,
            (e) => save({ runTests: e.target.checked }),
            'Run the project tests before finishing',
          ),
          sw(
            s.autoPreview !== false,
            (e) => save({ autoPreview: e.target.checked }),
            'Open a finished page in the browser pane',
          ),
        ),
        h(
          'div',
          { class: 'group' },
          h('h3', {}, t('Another computer')),
          sw(
            (s.remote || {}).enabled,
            (e) => save({ remote: { ...(s.remote || {}), enabled: e.target.checked } }, true),
            'Use the models of another computer',
          ),
          (s.remote || {}).enabled &&
            h(
              'div',
              { class: 'grid2' },
              field(
                'Address',
                h('input', {
                  class: 'input',
                  value: (s.remote || {}).url || '',
                  placeholder: 'http://192.168.1.20:11500',
                  oninput: (e) => save({ remote: { ...(s.remote || {}), url: e.target.value } }),
                }),
              ),
              field(
                'Access key',
                h('input', {
                  class: 'input',
                  type: 'password',
                  value: (s.remote || {}).key || '',
                  oninput: (e) => save({ remote: { ...(s.remote || {}), key: e.target.value } }),
                }),
              ),
            ),
          sw(
            (s.share || {}).enabled,
            guard(async (e) => {
              const on = e.target.checked;
              if (on && !(s.share || {}).key)
                Object.assign(S.boot.settings, (await api('/api/share/key', {})).settings);
              save({ share: { ...(S.boot.settings.share || {}), enabled: on } }, true);
              setTimeout(
                guard(async () => {
                  S.share = await api('/api/share');
                  if (S.view === 'settings') renderSettings();
                }),
                700,
              );
            }),
            'Let another computer use the models of this one',
          ),
          (s.share || {}).enabled &&
            h(
              'div',
              {},
              h(
                'div',
                { class: 'kv' },
                t('Address'),
                h(
                  'b',
                  { class: 'mono' },
                  S.share && S.share.addresses.length
                    ? S.share.addresses.map((a) => 'http://' + a + ':' + (S.share.port || 11500)).join('  ')
                    : '…',
                ),
              ),
              h(
                'div',
                { class: 'kv' },
                t('Access key'),
                h('b', { class: 'mono' }, (s.share || {}).key || ''),
              ),
            ),
        ),
        h(
          'div',
          { class: 'group' },
          h('h3', {}, t('Internet and tools')),
          sw(
            s.webAccess !== false,
            (e) => save({ webAccess: e.target.checked }),
            'Let the agent search and read the web',
          ),
          h('h4', { class: 'subhead' }, t('External tools (MCP)')),
          (s.mcpServers || []).map((m, i) => {
            const live = S.mcp.find((x) => x.name === m.name);
            return h(
              'div',
              { class: 'mcprow' },
              h('b', {}, m.name),
              h('code', {}, m.command),
              h(
                'span',
                {
                  class: 'tag' + (live && live.state === 'running' ? ' hot' : ''),
                  title: live && live.error,
                },
                live
                  ? live.state === 'running'
                    ? t('{0} tools', live.tools)
                    : live.state === 'error'
                      ? t('not running')
                      : '…'
                  : '…',
              ),
              h(
                'button',
                {
                  class: 'iconbtn',
                  'aria-label': t('Delete'),
                  onclick: () => save({ mcpServers: s.mcpServers.filter((x, k) => k !== i) }, true),
                },
                ic('x'),
              ),
            );
          }),
          (() => {
            const name = h('input', { class: 'input', placeholder: t('Name'), style: 'width:130px' });
            const cmd = h('input', {
              class: 'input',
              placeholder: 'npx -y @modelcontextprotocol/server-filesystem C:\\path',
              style: 'flex:1;min-width:200px',
            });
            return h(
              'div',
              { class: 'row' },
              name,
              cmd,
              h(
                'button',
                {
                  class: 'btn',
                  onclick: () => {
                    const n = name.value.trim().replace(/[^\w-]/g, '');
                    if (!n || !cmd.value.trim()) return toast('Enter a name and a command');
                    save(
                      {
                        mcpServers: [
                          ...(s.mcpServers || []).filter((x) => x.name !== n),
                          { name: n, command: cmd.value.trim(), enabled: true },
                        ],
                      },
                      true,
                    );
                  },
                },
                ic('plus'),
                t('Add server'),
              ),
            );
          })(),
        ),
        ...gpuGroups(s, save, sw),
        h(
          'div',
          { class: 'group' },
          h('h3', {}, t('Computer')),
          h('div', { class: 'kv' }, t('Processor'), h('b', {}, d.cpu || '—')),
          h('div', { class: 'kv' }, t('RAM'), h('b', {}, d.ramGB + ' GB')),
          h(
            'div',
            { class: 'kv' },
            t('Video card'),
            h('b', {}, d.vramGB ? `${d.gpu} · ${d.vramGB} GB` : d.gpu || t('none')),
          ),
          sw(
            o.enabled,
            (e) => save({ hardwareOverride: { ...s.hardwareOverride, enabled: e.target.checked } }),
            'Set manually',
          ),
          h(
            'div',
            { class: 'grid2' },
            field(
              'RAM, GB',
              h('input', {
                class: 'input',
                type: 'number',
                value: o.ramGB,
                oninput: (e) =>
                  save({ hardwareOverride: { ...s.hardwareOverride, ramGB: Number(e.target.value) } }),
              }),
            ),
            field(
              'Video memory, GB',
              h('input', {
                class: 'input',
                type: 'number',
                value: o.vramGB,
                oninput: (e) =>
                  save({ hardwareOverride: { ...s.hardwareOverride, vramGB: Number(e.target.value) } }),
              }),
            ),
          ),
        ),
      ),
    ),
  );
}

// Video cards: which ones the engine may use, in what order, and the memory options for large models.
function gpuGroups(s, save, sw) {
  const plan = S.boot.gpuPlan;
  const perf = s.perf || {};
  const perfGroup = h(
    'div',
    { class: 'group' },
    h('h3', {}, t('Large models')),
    sw(
      !!perf.flash,
      (e) => save({ perf: { ...perf, flash: e.target.checked } }),
      'Faster attention (flash attention)',
    ),
    sw(
      !!perf.kv,
      (e) => save({ perf: { ...perf, kv: e.target.checked } }),
      'Compress context memory (about half the video memory per token)',
    ),
    sw(
      !!perf.oneModel,
      (e) => save({ perf: { ...perf, oneModel: e.target.checked } }),
      'Keep only one model in memory',
    ),
    sw(
      !!perf.single,
      (e) => save({ perf: { ...perf, single: e.target.checked } }),
      'One request at a time (less memory for context)',
    ),
  );
  if (!plan || !plan.cards.length) return [perfGroup];
  const conf = { mode: 'auto', off: [], order: [], spread: null, reserveGB: 0, ...(s.gpu || {}) };
  const manual = conf.mode === 'manual';
  const set = (patch) => save({ gpu: { ...conf, ...patch } }, true);
  // manual order starts from whatever is shown now
  const shown = plan.active
    .map((id) => plan.cards.find((c) => c.id === id))
    .concat(plan.cards.filter((c) => !plan.active.includes(c.id)));
  const move = (id, step) => {
    const order = plan.active.slice();
    const i = order.indexOf(id);
    if (i < 0 || i + step < 0 || i + step >= order.length) return;
    [order[i], order[i + step]] = [order[i + step], order[i]];
    set({ mode: 'manual', order });
  };
  const rows = shown.map((c) => {
    const on = plan.active.includes(c.id);
    const place = plan.active.indexOf(c.id);
    return h(
      'div',
      { class: 'gpurow' + (on ? '' : ' off') },
      h(
        'span',
        { class: 'switch' },
        h('input', {
          type: 'checkbox',
          checked: on,
          disabled: !manual,
          'aria-label': c.name,
          onchange: (e) =>
            set({ off: e.target.checked ? conf.off.filter((x) => x !== c.id) : [...conf.off, c.id] }),
        }),
        h('i'),
      ),
      h(
        'span',
        { class: 'gpuname' },
        on && plan.active.length > 1 ? h('b', { class: 'place' }, place + 1) : null,
        c.name,
      ),
      h('span', { class: 'tag' + (c.headless ? ' hot' : '') }, t(c.headless ? 'AI card' : 'Display')),
      h('span', { class: 'gpumem' }, c.vramGB + ' GB'),
      manual && on && plan.active.length > 1
        ? h(
            'span',
            { class: 'gpumove' },
            h(
              'button',
              {
                class: 'iconbtn',
                'aria-label': t('Move up'),
                disabled: place === 0,
                onclick: () => move(c.id, -1),
              },
              ic('up'),
            ),
            h(
              'button',
              {
                class: 'iconbtn down',
                'aria-label': t('Move down'),
                disabled: place === plan.active.length - 1,
                onclick: () => move(c.id, 1),
              },
              ic('up'),
            ),
          )
        : null,
    );
  });
  const external = S.lib && S.lib.engine && S.lib.engine.online && !S.lib.engine.managed;
  return [
    h(
      'div',
      { class: 'group' },
      h('h3', {}, t('Video cards')),
      h(
        'div',
        { class: 'seg', role: 'group' },
        [
          ['auto', 'Auto'],
          ['manual', 'Manual'],
        ].map(([v, label]) =>
          h(
            'button',
            {
              class: conf.mode === v ? 'on' : '',
              'aria-pressed': String(conf.mode === v),
              onclick: () =>
                set(
                  v === 'manual'
                    ? { mode: 'manual', order: plan.active }
                    : { mode: 'auto', off: [], order: [] },
                ),
            },
            t(label),
          ),
        ),
      ),
      rows,
      h('div', { class: 'kv' }, t('Memory for models'), h('b', {}, plan.vramGB + ' GB')),
      plan.cards.length > 1 &&
        sw(
          plan.spread,
          (e) => set({ spread: e.target.checked }),
          'Spread one model across all selected cards',
        ),
      h(
        'div',
        { class: 'field' },
        h('label', {}, t('Keep free on each card, GB')),
        h('input', {
          class: 'input',
          type: 'number',
          min: 0,
          step: 0.5,
          value: conf.reserveGB || 0,
          style: 'width:120px',
          onchange: (e) => set({ reserveGB: Math.max(0, Number(e.target.value) || 0) }),
        }),
      ),
      external &&
        h(
          'div',
          { class: 'warn' },
          t('The engine was started outside Ember. Close Ollama and restart Ember to apply these settings.'),
        ),
    ),
    perfGroup,
  ];
}
