'use strict';

// The card on the empty chat screen: how much the app has been used.
const short = (n) =>
  n >= 1e9
    ? (n / 1e9).toFixed(1) + 'B'
    : n >= 1e6
      ? (n / 1e6).toFixed(1) + 'M'
      : n >= 1e3
        ? (n / 1e3).toFixed(1) + 'k'
        : String(Math.round(n));
const dayKey = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function statsCard() {
  const view = S.stats;
  const all = S.usage || {};
  const limit = view.range === 'all' ? null : dayKey(new Date(Date.now() - (view.range - 1) * 864e5));
  const keys = Object.keys(all)
    .filter((k) => !limit || k >= limit)
    .sort();
  const set = (patch) => {
    Object.assign(view, patch);
    const old = $('#stats');
    if (old) old.replaceWith(statsCard());
  };
  const seg = (items, cur, key) =>
    h(
      'div',
      { class: 'stabs' },
      items.map(([value, label]) =>
        h('button', { class: cur === value ? 'on' : '', onclick: () => set({ [key]: value }) }, t(label)),
      ),
    );

  const head = h(
    'div',
    { class: 'shead' },
    seg(
      [
        ['overview', 'Overview'],
        ['models', 'Models'],
      ],
      view.tab,
      'tab',
    ),
    seg(
      [
        ['all', 'All'],
        [30, '30d'],
        [7, '7d'],
      ],
      view.range,
      'range',
    ),
  );

  const models = {};
  let total = 0;
  let messages = 0;
  const chats = new Set();
  const hours = {};
  for (const k of keys) {
    const d = all[k];
    messages += d.messages;
    total += d.in + d.out;
    d.chats.forEach((c) => chats.add(c));
    for (const [hr, n] of Object.entries(d.hours)) hours[hr] = (hours[hr] || 0) + n;
    for (const [name, m] of Object.entries(d.models)) {
      const sum = models[name] || (models[name] = { in: 0, out: 0 });
      sum.in += m.in;
      sum.out += m.out;
    }
  }
  const ranked = Object.entries(models).sort((a, b) => b[1].in + b[1].out - (a[1].in + a[1].out));

  if (view.tab === 'models') {
    const peak = Math.max(1, ...keys.map((k) => all[k].in + all[k].out));
    const shown = keys.slice(-14);
    const tone = (name) =>
      1 -
      0.28 *
        Math.min(
          3,
          Math.max(
            0,
            ranked.findIndex((r) => r[0] === name),
          ),
        );
    return h(
      'div',
      { class: 'stats', id: 'stats' },
      head,
      shown.length
        ? h(
            'div',
            { class: 'sbars' },
            shown.map((k) =>
              h(
                'div',
                { class: 'sbar', title: k },
                h(
                  'div',
                  { class: 'col', style: `height:${((all[k].in + all[k].out) / peak) * 100}%` },
                  Object.entries(all[k].models).map(([name, m]) =>
                    h('i', { style: `flex:${m.in + m.out};opacity:${tone(name)}` }),
                  ),
                ),
                h(
                  'span',
                  {},
                  new Date(k + 'T12:00').toLocaleDateString(LANG, { month: 'short', day: 'numeric' }),
                ),
              ),
            ),
          )
        : h('div', { class: 'snone' }, t('Nothing here yet')),
      h(
        'div',
        { class: 'slegend' },
        ranked
          .slice(0, 4)
          .map(([name, m]) =>
            h(
              'div',
              {},
              h('i', { style: `opacity:${tone(name)}` }),
              h('b', {}, name.replace(/^[a-z]+:/, '')),
              h('span', {}, `${short(m.in)} ${t('in')} · ${short(m.out)} ${t('out')}`),
              h('em', {}, Math.round(((m.in + m.out) / Math.max(1, total)) * 100) + '%'),
            ),
          ),
      ),
    );
  }

  const peakHour = Object.entries(hours).sort((a, b) => b[1] - a[1])[0];
  const tile = (label, value) => h('div', { class: 'stile' }, h('span', {}, t(label)), h('b', {}, value));
  // forty weeks of squares, the newest week on the right
  const cells = [];
  const start = new Date();
  start.setDate(start.getDate() - start.getDay() - 39 * 7);
  const top = Math.max(1, ...Object.values(all).map((d) => d.in + d.out));
  for (let i = 0; i < 40 * 7; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const day = d > new Date() ? null : all[dayKey(d)];
    const used = day ? day.in + day.out : 0;
    cells.push(
      h('i', {
        title: dayKey(d),
        style: used ? `background:var(--accent);opacity:${0.35 + 0.65 * Math.sqrt(used / top)}` : '',
      }),
    );
  }
  // a paperback novel is roughly a hundred thousand tokens
  const books = total / 1e5;
  return h(
    'div',
    { class: 'stats', id: 'stats' },
    head,
    h(
      'div',
      { class: 'stiles' },
      tile('Chats', String(chats.size)),
      tile('Messages', messages.toLocaleString(LANG)),
      tile('Total tokens', short(total)),
      tile('Active days', String(keys.length)),
      tile('Peak hour', peakHour ? String(peakHour[0]).padStart(2, '0') + ':00' : '—'),
      tile('Favorite model', ranked.length ? ranked[0][0].replace(/^[a-z]+:/, '') : '—'),
    ),
    h('div', { class: 'sgrid' }, cells),
    books >= 1 ? h('p', { class: 'snote' }, t('About as much text as {0} novels.', Math.round(books))) : null,
  );
}
