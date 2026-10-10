'use strict';

async function setView(view) {
  S.view = view;
  closePop();
  document.querySelectorAll('.overlay').forEach((o) => o.remove());
  renderSide();
  $('#right').classList.add('hidden');
  document.body.classList.remove('right-open');
  if (view === 'chat') renderChat();
  if (view === 'library') {
    await guard(loadLib)();
    if (S.view === 'library' && S.lib) renderLibrary();
  }
  if (view === 'skills') renderSkills();
  if (view === 'settings') {
    renderSettings();
    guard(async () => {
      S.mcp = await api('/api/mcp');
      S.memoryText = (await api('/api/memory')).text;
      S.share = await api('/api/share');
      if (S.view === 'settings') renderSettings();
    })();
  }
  if (view === 'chat' && !S.templates.length)
    guard(async () => {
      S.templates = await api('/api/templates');
      if (S.view === 'chat' && !S.session.items.length) renderEmpty();
    })();
  if (view === 'chat' && !S.lib)
    guard(loadLib)().then(
      () => S.view === 'chat' && (syncChrome(), !S.session.items.length && renderEmpty()),
    );
}

function onEvent(ev) {
  if (ev.type === 'pull') {
    if (!S.lib) return;
    if (ev.done) {
      delete S.lib.pulls[ev.tag];
      toast(ev.error || t('{0} installed', ev.tag));
      guard(loadLib)().then(() => S.view === 'library' && renderLibrary());
    } else {
      S.lib.pulls[ev.tag] = { percent: ev.percent, status: ev.status };
      if (S.view === 'library' && document.activeElement.id !== 'lib-q') renderLibrary();
    }
    return;
  }
  if (ev.type === 'engine') {
    S.engineInstall = ev.done ? null : ev;
    if (ev.done) {
      toast(ev.error || 'Engine installed');
      guard(loadLib)().then(() => S.view === 'library' && renderLibrary());
    } else if (S.view === 'library' && S.lib) renderLibrary();
    return;
  }
  if (ev.type === 'modeltest') {
    if (ev.done) {
      delete S.tests[ev.id];
      if (ev.total) toast(t('File test {0}/{1}', ev.score, ev.total));
      guard(loadLib)().then(() => S.view === 'library' && renderLibrary());
    } else {
      S.tests[ev.id] = ev;
      if (S.view === 'library' && S.lib) renderLibrary();
    }
    return;
  }
  if (ev.type === 'voice') {
    if (ev.done) toast(ev.error || 'Voice input is ready');
    return;
  }
  if (ev.type === 'term') {
    if (!S.session || ev.sid !== S.session.id) return;
    if (ev.data) S.term.log = (S.term.log + ev.data).slice(-60000);
    if (ev.done) {
      S.term.busy = false;
      S.term.cwd = ev.cwd || S.term.cwd;
    }
    if (S.view === 'chat' && S.panes.term) renderTermPane();
    return;
  }
  if (ev.type === 'sessions') return void guard(loadSessions)();
  if (!S.session || ev.sid !== S.session.id) return;
  if (ev.type === 'item') {
    const i = S.session.items.findIndex((x) => x.id === ev.item.id);
    if (i >= 0) S.session.items[i] = ev.item;
    else S.session.items.push(ev.item);
    if (S.view === 'chat') renderItem(ev.item);
  } else if (ev.type === 'remove') {
    S.session.items = S.session.items.filter((x) => x.id !== ev.id);
    const el = S.els.get(ev.id);
    if (el) el.remove();
    S.els.delete(ev.id);
  } else if (ev.type === 'delta') {
    const el = S.els.get(ev.id);
    const feed = $('#feed');
    if (el && ev.text) {
      const stick = feed && feed.scrollHeight - feed.scrollTop - feed.clientHeight < 140;
      el.querySelector('.body').textContent = ev.text.split('\n').pop().slice(-140) || ev.text.slice(-140);
      if (stick) feed.scrollTop = feed.scrollHeight;
    }
  } else if (ev.type === 'state') {
    const was = st().running;
    const filesBefore = Object.keys(st().changed || {}).length;
    S.session.state = ev.state;
    if (Object.keys(ev.state.changed || {}).length !== filesBefore) {
      S.tree.cache.clear();
      if (S.panes.files && S.view === 'chat') renderFilesPane();
    }
    if (S.view === 'chat') syncChrome();
    if (was && !ev.state.running) {
      if (ev.state.preview && S.boot.settings.autoPreview !== false && S.view === 'chat')
        openBrowser('file:///' + (ev.state.cwd + '/' + ev.state.preview).replace(/\\/g, '/'));
      refreshGit();
      S.tree.cache.clear();
      if (S.panes.files && S.view === 'chat') renderFilesPane();
      if (S.queue.length)
        setTimeout(() => {
          if (st().running || !S.queue.length) return;
          const next = S.queue.shift();
          renderTray();
          send(next.text, next.images, next.docs);
        }, 400);
    }
    if (
      was &&
      !ev.state.running &&
      document.hidden &&
      S.boot.settings.notify &&
      'Notification' in window &&
      Notification.permission === 'granted'
    )
      new Notification('Ember', { body: (ev.state.title || 'Ember') + ' — ' + t('done') });
  }
}

async function listen() {
  for (;;) {
    try {
      const res = await fetch('/api/events', { headers: { 'x-ember-token': TOKEN } });
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i);
          buf = buf.slice(i + 1);
          if (line) onEvent(JSON.parse(line));
        }
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 1500));
  }
}

(async function init() {
  try {
    S.boot = await api('/api/boot');
    applyLook();
    matchMedia('(prefers-color-scheme: light)').addEventListener('change', applyLook);
    S.sessions = S.boot.sessions;
    listen();
    await newChat();
    if (!S.boot.settings.onboarded)
      startWelcome(() => {
        renderSide();
        if (S.view === 'chat') renderChat();
      });
  } catch (e) {
    document.body.textContent = t('Could not start Ember') + ': ' + e.message;
  }
})();
