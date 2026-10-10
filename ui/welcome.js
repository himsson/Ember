'use strict';

const WELCOME_PLACES = {
  us: { lang: 'en', lat: 39.5, lon: -98, code: 8, off: [0, -40] },
  en: { lat: 53.5, lon: -1.5, code: 1, off: [-40, -34] },
  ru: { lat: 57, lon: 40, code: 2, off: [44, -30] },
  de: { lat: 51.2, lon: 10.4, code: 3, off: [8, -48] },
  zh: { lat: 35.5, lon: 104, code: 4, off: [0, -40] },
  fr: { lat: 46.6, lon: 2.4, code: 5, off: [-52, 2] },
  it: { lat: 42.8, lon: 12.6, code: 6, off: [34, 30] },
  es: { lat: 40.2, lon: -3.6, code: 7, off: [-36, 34] },
};
// Windows has no flag emoji.
const FLAGS = {
  en: '<rect width="30" height="20" fill="#1f3a8a"/><path d="M0 0l30 20M30 0L0 20" stroke="#fff" stroke-width="4"/><path d="M0 0l30 20M30 0L0 20" stroke="#d22" stroke-width="1.6"/><path d="M15 0v20M0 10h30" stroke="#fff" stroke-width="6"/><path d="M15 0v20M0 10h30" stroke="#d22" stroke-width="3.2"/>',
  ru: '<rect width="30" height="7" fill="#fff"/><rect y="6.67" width="30" height="7" fill="#1c57c9"/><rect y="13.33" width="30" height="7" fill="#d52b1e"/>',
  de: '<rect width="30" height="7" fill="#111"/><rect y="6.67" width="30" height="7" fill="#d00"/><rect y="13.33" width="30" height="7" fill="#ffce00"/>',
  zh: '<rect width="30" height="20" fill="#de2910"/><path d="M6 3l1 3h3.2L7.6 7.9l1 3L6 9l-2.6 1.9 1-3L1.8 6H5z" fill="#ffde00"/><circle cx="12" cy="3" r="1" fill="#ffde00"/><circle cx="14" cy="5.5" r="1" fill="#ffde00"/><circle cx="14" cy="8.5" r="1" fill="#ffde00"/><circle cx="12" cy="11" r="1" fill="#ffde00"/>',
  fr: '<rect width="10" height="20" fill="#0b3ea8"/><rect x="10" width="10" height="20" fill="#fff"/><rect x="20" width="10" height="20" fill="#e1000f"/>',
  it: '<rect width="10" height="20" fill="#0a9246"/><rect x="10" width="10" height="20" fill="#fff"/><rect x="20" width="10" height="20" fill="#ce2b37"/>',
  us: '<rect width="30" height="20" fill="#fff"/><path d="M0 1.5h30M0 4.6h30M0 7.7h30M0 10.8h30M0 13.9h30M0 17h30M0 19.6h30" stroke="#b22234" stroke-width="1.55"/><rect width="13" height="10.8" fill="#3c3b6e"/><path d="M2 2.2h9M2 5.4h9M2 8.6h9" stroke="#fff" stroke-width="1" stroke-dasharray="1 1.6"/>',
  es: '<rect width="30" height="20" fill="#c60b1e"/><rect y="5" width="30" height="10" fill="#ffc400"/>',
};
function flagSvg(lang) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 30 20');
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = FLAGS[lang];
  return s;
}

function logoSvg() {
  const C = { x: -0.015, y: 0.085 };
  const R = 0.205;
  const A = { x: 0.085, y: -0.33 };
  const base = Math.atan2(A.y - C.y, A.x - C.x);
  const spread = Math.acos(R / Math.hypot(A.x - C.x, A.y - C.y));
  const p = (a) => `${(C.x + R * Math.cos(a)).toFixed(4)} ${(C.y + R * Math.sin(a)).toFixed(4)}`;
  const drop = `M${A.x} ${A.y}L${p(base + spread)}A${R} ${R} 0 1 1 ${p(base - spread)}Z`;
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '-0.5 -0.5 1 1');
  s.setAttribute('class', 'intro-logo');
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = `<defs><linearGradient id="wg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffbe54"/><stop offset="1" stop-color="#ff541c"/></linearGradient></defs>
    <path class="fillp" d="${drop}M${(-0.015 + 0.078).toFixed(3)} 0.1a0.078 0.078 0 1 0 -0.156 0a0.078 0.078 0 1 0 0.156 0Z" fill="url(#wg)" fill-rule="evenodd"/>
    <path class="line" pathLength="1" d="${drop}" fill="none" stroke="url(#wg)" stroke-width="0.012" stroke-linejoin="round"/>
    <circle class="line core" pathLength="1" cx="-0.015" cy="0.1" r="0.078" fill="none" stroke="url(#wg)" stroke-width="0.012"/>`;
  return s;
}

function makeGlobe(onPick) {
  const SIZE = 440;
  const R = 170;
  const canvas = h('canvas', { width: SIZE * 2, height: SIZE * 2, 'aria-hidden': 'true' });
  const wrap = h('div', { class: 'globe' }, canvas);
  const ctx = canvas.getContext('2d');
  const rad = Math.PI / 180;
  const view = { lon: 38, lat: 34, zoom: 1 };
  let target = null;
  let picked = LANG;
  let hover = false;
  let vel = 0.06;
  let drag = null;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const langOf = (id) => WELCOME_PLACES[id].lang || id;
  const flags = Object.keys(WELCOME_PLACES).map((lang) => {
    const b = h(
      'button',
      {
        class: 'flag',
        'aria-label': LANGS[langOf(lang)],
        title: LANGS[langOf(lang)],
        onclick: () => pick(lang),
      },
      flagSvg(lang),
    );
    wrap.append(b);
    return [lang, b];
  });

  function project(lat, lon) {
    const f = lat * rad;
    const l = (lon - view.lon) * rad;
    const f0 = view.lat * rad;
    const cf = Math.cos(f);
    return [
      cf * Math.sin(l),
      Math.cos(f0) * Math.sin(f) - Math.sin(f0) * cf * Math.cos(l),
      Math.sin(f0) * Math.sin(f) + Math.cos(f0) * cf * Math.cos(l),
    ];
  }
  function pick(lang) {
    picked = lang;
    const p = WELCOME_PLACES[lang];
    let lon = p.lon;
    while (lon - view.lon > 180) lon -= 360;
    while (lon - view.lon < -180) lon += 360;
    target = {
      lon,
      lat: Math.max(-60, Math.min(60, p.lat - 4)),
      zoom: p.code === 2 || p.code === 4 || p.code === 8 ? 1.7 : 2.5,
    };
    if (reduce) Object.assign(view, target);
    vel = 0;
    onPick(langOf(lang));
  }
  function frame() {
    if (!canvas.isConnected) return;
    if (target) {
      for (const k of ['lon', 'lat', 'zoom']) view[k] += (target[k] - view[k]) * 0.085;
      if (Math.abs(target.lon - view.lon) < 0.02 && Math.abs(target.zoom - view.zoom) < 0.002) target = null;
    } else if (!drag && !reduce && !hover) {
      view.lon += vel;
    }
    const c = SIZE;
    const r = R * 2 * view.zoom;
    const css = getComputedStyle(document.documentElement);
    const accent = css.getPropertyValue('--accent').trim() || '#ff7a2f';
    const light = document.documentElement.dataset.theme === 'light';
    ctx.clearRect(0, 0, c * 2, c * 2);
    const g = ctx.createRadialGradient(c - r * 0.3, c - r * 0.35, r * 0.1, c, c, r);
    g.addColorStop(0, light ? '#ffffff' : '#262422');
    g.addColorStop(1, light ? '#e7e3da' : '#0d0c0b');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(c, c, r, 0, 7);
    ctx.fill();
    ctx.strokeStyle = light ? 'rgba(0,0,0,.14)' : 'rgba(255,255,255,.12)';
    ctx.lineWidth = 2;
    ctx.stroke();
    const code = picked && WELCOME_PLACES[picked] ? WELCOME_PLACES[picked].code : 0;
    const D = GLOBE_DOTS;
    for (let i = 0; i < D.length; i += 3) {
      const [x, y, z] = project(D[i] / 10, D[i + 1] / 10);
      if (z <= 0) continue;
      const hot = code && D[i + 2] === code;
      ctx.globalAlpha = hot ? 1 : 0.18 + 0.62 * z;
      ctx.fillStyle = hot ? accent : light ? '#3a362f' : '#efeae2';
      const s = (hot ? 2.6 : 1.9) * (0.55 + 0.45 * z) * Math.sqrt(view.zoom) * 2;
      ctx.beginPath();
      ctx.arc(c + x * r, c - y * r, s / 2, 0, 7);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    for (const [lang, el] of flags) {
      const p = WELCOME_PLACES[lang];
      const [x, y, z] = project(p.lat, p.lon);
      const px = SIZE / 2 + x * (r / 2);
      const py = SIZE / 2 - y * (r / 2);
      const fx = px + p.off[0];
      const fy = py + p.off[1];
      const show = z > 0.32 && fx > 16 && fx < SIZE - 16 && fy > 12 && fy < SIZE - 12;
      el.style.opacity = show ? 1 : 0;
      el.style.pointerEvents = show ? '' : 'none';
      el.tabIndex = show ? 0 : -1;
      el.style.left = fx - 17 + 'px';
      el.style.top = fy - 12 + 'px';
      el.classList.toggle('on', lang === picked);
      if (!show) continue;
      ctx.strokeStyle = lang === picked ? accent : light ? 'rgba(0,0,0,.35)' : 'rgba(255,255,255,.4)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(px * 2, py * 2);
      ctx.lineTo(fx * 2, fy * 2);
      ctx.stroke();
      ctx.fillStyle = ctx.strokeStyle;
      ctx.beginPath();
      ctx.arc(px * 2, py * 2, 5, 0, 7);
      ctx.fill();
    }
    requestAnimationFrame(frame);
  }
  wrap.addEventListener('pointerenter', () => (hover = true));
  wrap.addEventListener('pointerleave', () => (hover = false));
  canvas.addEventListener('pointerdown', (e) => {
    drag = { x: e.clientX, y: e.clientY };
    target = null;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const k = 0.32 / view.zoom;
    vel = -(e.clientX - drag.x) * k * 0.2;
    view.lon -= (e.clientX - drag.x) * k;
    view.lat = Math.max(-70, Math.min(70, view.lat + (e.clientY - drag.y) * k));
    drag = { x: e.clientX, y: e.clientY };
  });
  const release = () => {
    drag = null;
    vel = Math.max(-1.5, Math.min(1.5, vel)) || 0.06;
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      target = null;
      view.zoom = Math.max(1, Math.min(3, view.zoom * (e.deltaY < 0 ? 1.12 : 0.89)));
    },
    { passive: false },
  );
  requestAnimationFrame(frame);
  return { el: wrap, pick, reset: () => (target = { lon: view.lon, lat: 30, zoom: 1 }) };
}

function startWelcome(finish) {
  const s = S.boot.settings;
  const draft = { name: s.userName || '', purpose: s.purpose || '' };
  const root = h('div', { id: 'welcome' }, h('div', { class: 'dragbar' }));
  const stage = h('div', { class: 'stage' });
  const footer = h('div', { class: 'wfoot' });
  root.append(stage, footer);
  document.body.append(root);
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let step = -1;
  let globe = null;

  const show = (el) => {
    el.classList.add('enter');
    fill(stage, el);
  };
  const foot = (next, canNext, last) => {
    fill(
      footer,
      step > 0 ? h('button', { class: 'btn ghost', onclick: () => go(step - 1) }, t('Back')) : h('span', {}),
      h(
        'div',
        { class: 'wdots', 'aria-hidden': 'true' },
        [0, 1, 2].map((i) => h('i', { class: i === step ? 'on' : '' })),
      ),
      h(
        'button',
        { class: 'btn primary', id: 'wnext', disabled: !canNext, onclick: next },
        t(last ? 'Get started' : 'Continue'),
        ic('right'),
      ),
    );
  };

  function intro() {
    const title = h('h1', { class: 'intro-title' }, 'Welcome to ', h('em', {}, 'Ember'));
    const box = h('div', { class: 'intro' }, logoSvg(), title);
    fill(stage, box);
    fill(footer);
    const next = () => step === -1 && go(0);
    const timer = setTimeout(next, reduce ? 900 : 4600);
    box.addEventListener('click', () => {
      clearTimeout(timer);
      next();
    });
  }

  function language() {
    const name = h('h2', { class: 'wbig' }, LANGS[LANG]);
    if (!globe) {
      globe = makeGlobe(
        guard(async (lang) => {
          await saveSettings({ lang });
          name.textContent = LANGS[lang];
          document.querySelector('#welcome .wq').textContent = t('Choose your language');
          foot(() => go(1), true);
        }),
      );
    }
    show(h('div', { class: 'wstep' }, h('p', { class: 'wq' }, t('Choose your language')), globe.el, name));
    foot(() => go(1), true);
  }

  function who() {
    const hello = h('h2', { class: 'wbig hello', 'aria-live': 'polite' });
    const input = h('input', {
      class: 'wname',
      value: draft.name,
      autocomplete: 'off',
      spellcheck: 'false',
      maxlength: 40,
      'aria-label': t('What is your name?'),
    });
    const paint = () => {
      const n = draft.name.trim();
      const chars = n ? [...t('Hello, {0}', n)] : [];
      const spans = [...hello.children];
      chars.forEach((ch, k) => {
        const text = ch === ' ' ? ' ' : ch;
        if (spans[k]) {
          if (spans[k].textContent !== text) spans[k].textContent = text;
        } else hello.append(h('span', {}, text));
      });
      spans.slice(chars.length).forEach((el) => el.remove());
      const btn = document.querySelector('#wnext');
      if (btn) btn.disabled = !n;
    };
    input.addEventListener('input', () => {
      draft.name = input.value;
      paint();
    });
    input.addEventListener('keydown', (e) => e.key === 'Enter' && draft.name.trim() && go(2));
    show(h('div', { class: 'wstep' }, h('p', { class: 'wq' }, t('What is your name?')), input, hello));
    foot(() => go(2), !!draft.name.trim());
    paint();
    input.focus();
  }

  function purpose() {
    const tiles = [
      ['Coding', 'code'],
      ['Writing', 'pen'],
      ['Study', 'book'],
      ['Work', 'grid'],
      ['Just exploring', 'globe'],
    ];
    const done = guard(async () => {
      await saveSettings({
        userName: draft.name.trim(),
        userAddress: '',
        purpose: draft.purpose,
        onboarded: true,
      });
      root.classList.add('leave');
      setTimeout(() => root.remove(), reduce ? 0 : 500);
      finish();
    });
    const grid = h(
      'div',
      { class: 'wtiles' },
      tiles.map(([key, icon], i) =>
        h(
          'button',
          {
            class: 'wtile' + (draft.purpose === key ? ' on' : ''),
            style: `animation-delay:${i * 60}ms`,
            'aria-pressed': String(draft.purpose === key),
            onclick: (e) => {
              draft.purpose = key;
              grid.querySelectorAll('.wtile').forEach((b) => b.classList.toggle('on', b === e.currentTarget));
              document.querySelector('#wnext').disabled = false;
            },
            onpointermove: (e) => {
              const r = e.currentTarget.getBoundingClientRect();
              e.currentTarget.style.setProperty('--rx', ((e.clientY - r.top) / r.height - 0.5) * -14 + 'deg');
              e.currentTarget.style.setProperty('--ry', ((e.clientX - r.left) / r.width - 0.5) * 14 + 'deg');
            },
            onpointerleave: (e) => {
              e.currentTarget.style.setProperty('--rx', '0deg');
              e.currentTarget.style.setProperty('--ry', '0deg');
            },
          },
          ic(icon),
          h('span', {}, t(key)),
        ),
      ),
    );
    show(h('div', { class: 'wstep' }, h('p', { class: 'wq' }, t('What will you use Ember for?')), grid));
    foot(done, !!draft.purpose, true);
  }

  function go(n) {
    step = n;
    [language, who, purpose][n]();
  }
  intro();
}
