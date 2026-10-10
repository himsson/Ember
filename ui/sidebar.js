'use strict';

function renderSide() {
  const hw = S.boot.hardware;
  const nav = (view, icon, label) =>
    h('button', { class: S.view === view ? 'on' : '', onclick: () => setView(view) }, ic(icon), t(label));
  const menu = (e, s) => {
    e.preventDefault();
    openPop(
      e.currentTarget,
      [
        { icon: 'edit', title: t('Rename'), run: () => renameChat(s) },
        {
          icon: 'pin',
          title: t(s.pinned ? 'Unpin' : 'Pin'),
          run: guard(async () => {
            await api('/api/session/update', { id: s.id, patch: { pinned: !s.pinned } });
            await loadSessions();
          }),
        },
        {
          icon: 'trash',
          title: t('Delete'),
          run: guard(async () => {
            await api('/api/session/delete', { id: s.id });
            if (S.session && S.session.id === s.id) await newChat();
            await loadSessions();
          }),
        },
      ],
      { above: false },
    );
  };
  const row = (s) =>
    h(
      'div',
      {
        class: 'sess' + (S.view === 'chat' && S.session && S.session.id === s.id ? ' on' : ''),
        role: 'button',
        tabindex: 0,
        'data-pop': 1,
        onclick: guard(() => openSession(s.id)),
        oncontextmenu: (e) => menu(e, s),
        ondblclick: () => renameChat(s),
        onkeydown: (e) => e.key === 'Enter' && openSession(s.id),
      },
      s.pinned && ic('pin', 'pinned'),
      h('span', {}, s.title || t('New chat')),
      h(
        'button',
        {
          class: 'x',
          'aria-label': t('Delete chat'),
          onclick: guard(async (e) => {
            e.stopPropagation();
            await api('/api/session/delete', { id: s.id });
            if (S.session && S.session.id === s.id) await newChat();
            await loadSessions();
          }),
        },
        ic('x'),
      ),
    );
  const had = document.activeElement && document.activeElement.id === 'chat-q';
  fill(
    $('#side'),
    h(
      'div',
      { class: 'brand' },
      h('img', { class: 'logo', src: 'icon.png', alt: '', width: 26, height: 26 }),
      'Ember',
    ),
    h(
      'nav',
      { class: 'nav', 'aria-label': t('Sections') },
      h('button', { class: 'new', onclick: guard(newChat) }, ic('plus'), t('New chat')),
      nav('library', 'book', 'Library'),
      nav('skills', 'bolt', 'Skills'),
      nav('settings', 'gear', 'Settings'),
    ),
    S.sessions.length || S.chatQuery
      ? h(
          'div',
          { class: 'side-search' },
          ic('search'),
          h('input', {
            id: 'chat-q',
            value: S.chatQuery,
            placeholder: t('Search'),
            'aria-label': t('Search'),
            oninput: (e) => {
              S.chatQuery = e.target.value;
              clearTimeout(renderSide.timer);
              renderSide.timer = setTimeout(guard(loadSessions), 180);
            },
          }),
        )
      : null,
    h('div', { class: 'sessions' }, S.sessions.map(row)),
    h('div', { class: 'side-foot', title: hw.gpu || hw.cpu }, ic('cpu'), hwLine(hw)),
  );
  if (had) {
    const q = $('#chat-q');
    q.focus();
    q.setSelectionRange(q.value.length, q.value.length);
  }
}
function renameChat(s) {
  const input = h('input', {
    class: 'input',
    style: 'width:100%',
    value: s.title || '',
    'aria-label': t('Rename'),
  });
  const go = (close) =>
    guard(async () => {
      await api('/api/session/update', { id: s.id, patch: { title: input.value.trim() || s.title } });
      if (S.session && S.session.id === s.id) S.session.state.title = input.value.trim() || s.title;
      close();
      await loadSessions();
      if (S.view === 'chat') syncChrome();
    })();
  const close = modal(t('Rename'), input, (c) => [
    h('button', { class: 'btn', onclick: c }, t('Cancel')),
    h('button', { class: 'btn primary', onclick: () => go(c) }, t('Save')),
  ]);
  input.addEventListener('keydown', (e) => e.key === 'Enter' && go(close));
  input.select();
}
async function loadSessions() {
  S.sessions = await api('/api/sessions' + (S.chatQuery ? '?q=' + encodeURIComponent(S.chatQuery) : ''));
  renderSide();
}

async function toggleVoice() {
  const v = S.voice;
  if (v.rec) return v.rec.stop();
  if (v.busy) return;
  const status = await api('/api/voice');
  if (!status.installed) return voiceInstallDialog(status);
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const chunks = [];
  v.rec = new MediaRecorder(stream);
  v.rec.ondataavailable = (e) => chunks.push(e.data);
  v.rec.onstop = guard(async () => {
    stream.getTracks().forEach((tr) => tr.stop());
    v.rec = null;
    v.busy = true;
    syncVoice();
    try {
      const ctx = new AudioContext();
      const audio = await ctx.decodeAudioData(await new Blob(chunks).arrayBuffer());
      ctx.close();
      const off = new OfflineAudioContext(1, Math.ceil(audio.duration * 16000), 16000);
      const src = off.createBufferSource();
      src.buffer = audio;
      src.connect(off.destination);
      src.start();
      const pcm = (await off.startRendering()).getChannelData(0);
      const wav = new DataView(new ArrayBuffer(44 + pcm.length * 2));
      const str = (o, s) => [...s].forEach((c, i) => wav.setUint8(o + i, c.charCodeAt(0)));
      str(0, 'RIFF');
      wav.setUint32(4, 36 + pcm.length * 2, true);
      str(8, 'WAVEfmt ');
      wav.setUint32(16, 16, true);
      wav.setUint16(20, 1, true);
      wav.setUint16(22, 1, true);
      wav.setUint32(24, 16000, true);
      wav.setUint32(28, 32000, true);
      wav.setUint16(32, 2, true);
      wav.setUint16(34, 16, true);
      str(36, 'data');
      wav.setUint32(40, pcm.length * 2, true);
      for (let i = 0; i < pcm.length; i++)
        wav.setInt16(44 + i * 2, Math.max(-1, Math.min(1, pcm[i])) * 32767, true);
      let bin = '';
      const bytes = new Uint8Array(wav.buffer);
      for (let i = 0; i < bytes.length; i += 32768)
        bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 32768));
      const r = await api('/api/voice', { wav: btoa(bin), lang: LANG });
      const ta = $('#ta');
      if (ta && r.text) {
        ta.value += (ta.value && !/\s$/.test(ta.value) ? ' ' : '') + r.text;
        ta.dispatchEvent(new Event('input'));
        ta.focus();
      }
    } finally {
      v.busy = false;
      syncVoice();
    }
  });
  v.rec.start();
  syncVoice();
}
function syncVoice() {
  const b = $('#p-mic');
  if (!b) return;
  b.classList.toggle('rec', !!S.voice.rec);
  fill(b, S.voice.busy ? ic('load', 'spin') : ic(S.voice.rec ? 'stop' : 'mic'));
}
function voiceInstallDialog(status) {
  modal(
    t('Voice input'),
    h(
      'p',
      { style: 'margin:0' },
      t('Speech is recognised on this computer. A speech model of about 160 MB is downloaded once.'),
    ),
    (close) => [
      h('button', { class: 'btn', onclick: close }, t('Cancel')),
      status.canInstall &&
        h(
          'button',
          {
            class: 'btn primary',
            onclick: guard(async () => {
              await api('/api/voice/install', {});
              close();
              toast('Downloading speech recognition');
            }),
          },
          ic('down'),
          t('Install'),
        ),
    ],
  );
}
