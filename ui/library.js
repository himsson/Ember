'use strict';

async function loadLib() {
  S.lib = await api('/api/library');
  S.boot.hardware = S.lib.hw;
  S.engineInstall = S.lib.engine.install;
}
function renameModel(m) {
  const input = h('input', {
    class: 'input',
    style: 'width:100%',
    value: m.name,
    maxlength: 60,
    placeholder: m.tag,
    'aria-label': t('Rename'),
  });
  const go = (close) =>
    guard(async () => {
      const names = { ...(S.boot.settings.modelNames || {}) };
      const name = input.value.trim();
      // an empty field brings the original name back
      if (name && name !== m.tag) names[m.id] = name;
      else delete names[m.id];
      await saveSettings({ modelNames: names });
      close();
      await loadLib();
      if (S.view === 'library') renderLibrary();
    })();
  const close = modal(t('Rename'), input, (c) => [
    h('button', { class: 'btn', onclick: c }, t('Cancel')),
    h('button', { class: 'btn primary', onclick: () => go(c) }, t('Save')),
  ]);
  input.addEventListener('keydown', (e) => e.key === 'Enter' && go(close));
  input.select();
}

function engineBanner() {
  const e = S.lib.engine;
  if (e.online) return null;
  const inst = S.engineInstall;
  // the engine installs itself with the first model, so there is nothing to ask for here
  if (!inst && !e.installed && e.canInstall) return null;
  if (inst)
    return h(
      'div',
      { class: 'banner' },
      h('b', {}, t(inst.status) + (inst.totalMB ? ` · ${num(inst.totalMB)} MB` : '')),
      h('span', {}, inst.percent + '%'),
      h('div', { class: 'bar' }, h('i', { style: `width:${inst.percent}%` })),
    );
  const retry = h(
    'button',
    {
      class: 'btn',
      onclick: guard(async () => {
        await loadLib();
        renderLibrary();
      }),
    },
    t('Check'),
  );
  if (e.installed) return h('div', { class: 'banner' }, h('b', {}, t('The engine did not start')), retry);
  return h(
    'div',
    { class: 'banner' },
    h('b', {}, t('An engine is needed to run models')),
    e.canInstall
      ? h(
          'button',
          {
            class: 'btn primary',
            onclick: guard(async () => {
              await api('/api/engine/install', {});
              S.engineInstall = { percent: 0, status: 'Downloading the engine' };
              renderLibrary();
            }),
          },
          ic('down'),
          t('Install'),
        )
      : h(
          'a',
          { class: 'btn primary', href: 'https://ollama.com/download', target: '_blank', rel: 'noopener' },
          t('Download Ollama'),
        ),
    retry,
  );
}
function renderLibrary() {
  const L = S.lib;
  const f = S.lf;
  const catFn = CATS.find((c) => c[0] === f.cat)[3];
  const sizeFn = SIZES.find((x) => x[0] === f.size)[2];
  const q = f.q.toLowerCase();
  const base = L.catalog.filter(
    (m) =>
      (f.company === 'all' || m.company === f.company) &&
      (f.speed === 'all' || m.rate.level === f.speed) &&
      (!q || (m.name + m.company + m.tag).toLowerCase().includes(q)) &&
      (f.auto ? m.rate.level !== 'no' : sizeFn(m.params)),
  );
  const list = base.filter(catFn);
  const order = { fast: 0, ok: 1, slow: 2, no: 3 };
  list.sort((a, b) => order[a.rate.level] - order[b.rate.level] || b.agent - a.agent || b.params - a.params);
  const companies = [...new Set(L.catalog.map((m) => m.company))].sort();
  const set = (key, val) => () => {
    f[key] = val;
    renderLibrary();
  };
  const best = f.auto && list.length ? list[0].tag : '';

  const card = (m) => {
    const pull = L.pulls[m.tag];
    let foot;
    if (m.installed)
      foot = [
        h('span', { class: 'grow' }, t('Installed')),
        h(
          'button',
          { class: 'btn sm', onclick: guard(() => patchOrNew({ model: 'ollama:' + m.tag })) },
          t('Chat'),
        ),
        h(
          'button',
          {
            class: 'btn sm ghost danger',
            'aria-label': t('Delete model'),
            onclick: () => confirmDelete(m.tag, m.name),
          },
          ic('trash'),
        ),
      ];
    else if (pull)
      foot = [
        h(
          'div',
          { class: 'grow' },
          h('div', { class: 'bar', style: 'margin:0 0 4px' }, h('i', { style: `width:${pull.percent}%` })),
          (/engine/.test(pull.status) ? t(pull.status) + ' · ' : '') + pull.percent + '%',
        ),
        h(
          'button',
          { class: 'btn sm', onclick: guard(() => api('/api/models/cancel', { tag: m.tag })) },
          t('Cancel'),
        ),
      ];
    else
      foot = [
        h('span', { class: 'grow' }, `${m.params}B · ${m.sizeGB} GB`),
        (L.ollama.online || (L.engine.canInstall && !L.engine.installed)) && m.rate.level !== 'no'
          ? h(
              'button',
              { class: 'btn sm primary', onclick: guard(() => startPull(m.tag)) },
              ic('down'),
              t('Install'),
            )
          : null,
      ];
    return h(
      'div',
      { class: 'card' + (m.tag === best ? ' best' : '') },
      h(
        'div',
        { class: 'hd' },
        h('div', {}, h('div', { class: 'nm' }, m.name), h('div', { class: 'co' }, m.company)),
        h('span', { class: 'badge ' + m.rate.level }, t(RATE[m.rate.level])),
      ),
      h(
        'div',
        { class: 'tags' },
        m.tag === best && h('span', { class: 'tag hot' }, t('Best pick')),
        h('span', { class: 'tag' }, t({ code: 'Coding', text: 'Text', universal: 'Universal model' }[m.cat])),
        m.thinking && h('span', { class: 'tag' }, t('Reasoning')),
        m.vision && h('span', { class: 'tag' }, t('Images')),
        m.agent === 3 && h('span', { class: 'tag' }, t('Agent')),
        m.uncensored && h('span', { class: 'tag' }, t('Uncensored')),
      ),
      h('div', { class: 'foot' }, foot),
    );
  };
  const mine = L.installed;
  const installedCard = (m) =>
    h(
      'div',
      { class: 'card' },
      h(
        'div',
        { class: 'hd' },
        h(
          'div',
          { style: 'min-width:0' },
          h('div', { class: 'nm', style: 'overflow-wrap:anywhere' }, m.name),
          h('div', { class: 'co' }, t(m.provider === 'ollama' ? 'Local' : 'Own server')),
        ),
        m.rate && h('span', { class: 'badge ' + m.rate.level }, t(RATE[m.rate.level])),
      ),
      h(
        'div',
        { class: 'tags' },
        m.params && h('span', { class: 'tag' }, m.params + 'B'),
        m.sizeGB && h('span', { class: 'tag' }, m.sizeGB + ' GB'),
        m.quant && h('span', { class: 'tag' }, m.quant),
        m.test &&
          h(
            'span',
            { class: 'tag' + (m.test.score === m.test.total ? ' hot' : '') },
            t('File test {0}/{1}', m.test.score, m.test.total),
          ),
      ),
      h(
        'div',
        { class: 'foot' },
        h(
          'span',
          { class: 'grow' },
          S.tests[m.id] ? t('Testing {0}/{1}', S.tests[m.id].step, S.tests[m.id].total) : '',
        ),
        !S.tests[m.id] &&
          h(
            'button',
            {
              class: 'btn sm',
              title: t('Runs three small file tasks to see whether this model can work as an agent'),
              onclick: guard(async () => {
                await api('/api/models/test', { id: m.id });
                S.tests[m.id] = { step: 1, total: 3 };
                renderLibrary();
              }),
            },
            t('Test'),
          ),
        h('button', { class: 'btn sm', onclick: guard(() => patchOrNew({ model: m.id })) }, t('Chat')),
        h(
          'button',
          {
            class: 'btn sm ghost',
            'aria-label': t('Rename'),
            title: t('Rename'),
            onclick: () => renameModel(m),
          },
          ic('edit'),
        ),
        m.provider === 'ollama' &&
          h(
            'button',
            {
              class: 'btn sm ghost danger',
              'aria-label': t('Delete model'),
              onclick: () => confirmDelete(m.tag, m.name),
            },
            ic('trash'),
          ),
      ),
    );
  const custom = h('input', {
    class: 'input',
    placeholder: 'qwen3:8b · hf.co/author/model',
    style: 'flex:1;min-width:200px',
    'aria-label': t('Install by name'),
  });
  const hw = L.hw;
  const fbtn = (key, val, label, icon, count) =>
    h(
      'button',
      { class: f[key] === val ? 'on' : '', onclick: set(key, val) },
      icon && ic(icon),
      label,
      count != null && h('small', {}, count),
    );

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
          h('h2', {}, t('Library')),
          h(
            'span',
            { class: 'chip' },
            ic('cpu'),
            h(
              'span',
              {},
              hw.vramGB ? t('{0} GB video · {1} GB RAM', hw.vramGB, hw.ramGB) : t('{0} GB RAM', hw.ramGB),
            ),
          ),
        ),
        engineBanner(),
        h(
          'div',
          { class: 'toolbar' },
          h(
            'div',
            { class: 'tabs', role: 'tablist' },
            [
              ['catalog', t('Picks') + ' · ' + L.catalog.length],
              ['hf', 'Hugging Face'],
              ['mine', t('Mine · {0}', mine.length)],
            ].map(([k, label]) =>
              h('button', { class: f.tab === k ? 'on' : '', role: 'tab', onclick: set('tab', k) }, label),
            ),
          ),
          f.tab === 'catalog' &&
            h('input', {
              class: 'input',
              id: 'lib-q',
              style: 'flex:1;min-width:180px',
              placeholder: t('Search'),
              value: f.q,
              'aria-label': t('Search'),
              oninput: (e) => {
                f.q = e.target.value;
                renderLibrary();
                const el = $('#lib-q');
                el.focus();
                el.setSelectionRange(el.value.length, el.value.length);
              },
            }),
        ),
        f.tab === 'hf'
          ? hfView()
          : f.tab === 'mine'
            ? h(
                'div',
                {},
                h('div', { class: 'cards' }, mine.map(installedCard)),
                h(
                  'div',
                  { class: 'group', style: 'margin-top:20px' },
                  h('h3', {}, t('Install by name')),
                  h(
                    'div',
                    { class: 'row' },
                    custom,
                    h(
                      'button',
                      {
                        class: 'btn',
                        onclick: guard(async () => {
                          if (!custom.value.trim()) return toast('Enter a model name');
                          if (!L.ollama.online) return toast('Install the engine first');
                          await startPull(custom.value.trim());
                        }),
                      },
                      ic('down'),
                      t('Install'),
                    ),
                  ),
                  Object.entries(L.pulls)
                    .filter(([tag]) => !L.catalog.some((c) => c.tag === tag))
                    .map(([tag, p]) =>
                      h(
                        'div',
                        {},
                        h('div', { class: 'bar' }, h('i', { style: `width:${p.percent}%` })),
                        `${tag} · ${p.percent}%`,
                      ),
                    ),
                ),
              )
            : h(
                'div',
                { class: 'lib' },
                h(
                  'div',
                  { class: 'filters' },
                  h(
                    'div',
                    { class: 'fgroup' },
                    h('h4', {}, t('What for')),
                    CATS.map(([k, label, i, fn]) => fbtn('cat', k, t(label), i, base.filter(fn).length)),
                  ),
                  h(
                    'div',
                    { class: 'fgroup' },
                    h(
                      'h4',
                      {},
                      t('Size'),
                      h(
                        'button',
                        {
                          class: 'auto' + (f.auto ? ' on' : ''),
                          'aria-pressed': String(f.auto),
                          title: t('Auto shows only models that will run on this PC'),
                          onclick: set('auto', !f.auto),
                        },
                        t('Auto'),
                      ),
                    ),
                    !f.auto && SIZES.map(([k, label]) => fbtn('size', k, t(label))),
                  ),
                  h(
                    'div',
                    { class: 'fgroup' },
                    h('h4', {}, t('Speed on this PC')),
                    fbtn('speed', 'all', t('Any')),
                    ['fast', 'ok', 'slow'].map((k) => fbtn('speed', k, t(RATE[k]))),
                  ),
                  h(
                    'div',
                    { class: 'fgroup' },
                    h('h4', {}, t('Company')),
                    fbtn('company', 'all', t('All')),
                    companies.map((c) => fbtn('company', c, c)),
                  ),
                ),
                h('div', { class: 'cards' }, list.map(card)),
              ),
      ),
    ),
  );
}

const HF = { q: '', sort: 'downloads', list: null, busy: false };
async function hfLoad() {
  HF.busy = true;
  if (S.view === 'library') renderLibrary();
  try {
    HF.list = await api('/api/hf/search?q=' + encodeURIComponent(HF.q) + '&sort=' + HF.sort);
  } catch (e) {
    HF.list = [];
    toast(e.message);
  }
  HF.busy = false;
  if (S.view === 'library') renderLibrary();
}
function hfView() {
  if (!HF.list && !HF.busy) setTimeout(hfLoad);
  const input = h('input', {
    class: 'input',
    style: 'flex:1;min-width:180px',
    placeholder: t('Search all models'),
    value: HF.q,
    'aria-label': t('Search all models'),
    onkeydown: (e) => {
      if (e.key !== 'Enter') return;
      HF.q = e.target.value.trim();
      hfLoad();
    },
  });
  const quick = (label, q) =>
    h(
      'button',
      {
        class: 'tag' + (HF.q === q ? ' hot' : ''),
        onclick: () => {
          HF.q = q;
          hfLoad();
        },
      },
      label,
    );
  const sorts = [
    ['downloads', 'Popular'],
    ['likes', 'Liked'],
    ['new', 'New'],
  ];
  const short = (n) =>
    new Intl.NumberFormat(LANG, { notation: 'compact', maximumFractionDigits: 1 }).format(n);
  return h(
    'div',
    {},
    h(
      'div',
      { class: 'toolbar' },
      input,
      h(
        'div',
        { class: 'tabs' },
        sorts.map(([k, label]) =>
          h(
            'button',
            {
              class: HF.sort === k ? 'on' : '',
              onclick: () => {
                HF.sort = k;
                hfLoad();
              },
            },
            t(label),
          ),
        ),
      ),
    ),
    h(
      'div',
      { class: 'tags', style: 'margin-bottom:16px;flex:none' },
      quick(t('All'), ''),
      quick('Qwen', 'qwen'),
      quick('Llama', 'llama'),
      quick('Gemma', 'gemma'),
      quick('Mistral', 'mistral'),
      quick('DeepSeek', 'deepseek'),
      quick('Phi', 'phi'),
      quick(t('Coding'), 'coder'),
      quick(t('Reasoning'), 'reasoning'),
      quick(t('Images'), 'vision'),
      quick(t('Uncensored'), 'abliterated'),
      quick(t('Russian language'), 'russian'),
    ),
    HF.busy || !HF.list
      ? h('div', { class: 'plain' }, ic('load', 'spin'), t('Loading'))
      : h(
          'div',
          { class: 'cards' },
          HF.list.map((m) =>
            h(
              'div',
              { class: 'card' },
              h(
                'div',
                { class: 'hd' },
                h(
                  'div',
                  { style: 'min-width:0' },
                  h('div', { class: 'nm', style: 'overflow-wrap:anywhere' }, m.name),
                  h('div', { class: 'co' }, m.author),
                ),
              ),
              h(
                'div',
                { class: 'tags' },
                h('span', { class: 'tag' }, t('{0} downloads', short(m.downloads))),
                m.code && h('span', { class: 'tag' }, t('Coding')),
                m.vision && h('span', { class: 'tag' }, t('Images')),
                m.uncensored && h('span', { class: 'tag' }, t('Uncensored')),
              ),
              h(
                'div',
                { class: 'foot' },
                h('span', { class: 'grow' }),
                h(
                  'button',
                  { class: 'btn sm primary', onclick: guard(() => hfVersions(m)) },
                  t('Choose version'),
                ),
              ),
            ),
          ),
        ),
  );
}
async function hfVersions(m) {
  const list = await api('/api/hf/versions?id=' + encodeURIComponent(m.id));
  if (!list.length) return toast('This model has no suitable files');
  modal(
    m.name,
    h(
      'div',
      {},
      list.map((v) =>
        h(
          'div',
          { class: 'vrow' },
          h('b', {}, v.quant),
          v.best && h('span', { class: 'tag hot' }, t('Best pick')),
          h('span', { class: 'grow' }, v.sizeGB + ' GB'),
          h('span', { class: 'badge ' + v.rate.level, style: 'margin:0' }, t(RATE[v.rate.level])),
          h(
            'button',
            {
              class: 'btn sm' + (v.best ? ' primary' : ''),
              onclick: guard(async () => {
                if (!S.lib.ollama.online) return toast('Install the engine first');
                await api('/api/models/pull', { tag: v.tag });
                S.lib.pulls[v.tag] = { percent: 0, status: '' };
                document.querySelectorAll('.overlay').forEach((o) => o.remove());
                S.lf.tab = 'mine';
                renderLibrary();
              }),
            },
            t('Install'),
          ),
        ),
      ),
    ),
  );
}

async function patchOrNew(patch) {
  if (!S.session || S.session.items.length) S.session = await api('/api/session/new', {});
  await api('/api/session/update', { id: S.session.id, patch });
  S.session = await api('/api/session?id=' + S.session.id);
  setView('chat');
}
async function startPull(tag) {
  await api('/api/models/pull', { tag });
  S.lib.pulls[tag] = { percent: 0, status: '' };
  renderLibrary();
}
function confirmDelete(tag, name) {
  modal(t('Delete model?'), h('p', { style: 'margin:0' }, name), (close) => [
    h('button', { class: 'btn', onclick: close }, t('Cancel')),
    h(
      'button',
      {
        class: 'btn danger',
        onclick: guard(async () => {
          close();
          await api('/api/models/delete', { tag });
          await loadLib();
          renderLibrary();
        }),
      },
      t('Delete'),
    ),
  ]);
}
