const { app, BrowserWindow, dialog, ipcMain, shell, Menu, nativeTheme, session } = require('electron');
const fs = require('fs');
const path = require('path');
const { start, shutdown, setCapture } = require('./server/index.js');

let win;
const OVERLAY = {
  dark: { color: '#151413', symbolColor: '#aaa49a', height: 38 },
  light: { color: '#fbf9f5', symbolColor: '#5f5a50', height: 38 },
};

setCapture(async (file) => {
  const shot = new BrowserWindow({
    width: 1100,
    height: 800,
    show: false,
    webPreferences: { offscreen: true, javascript: true },
  });
  try {
    await shot.loadFile(file);
    await new Promise((r) => setTimeout(r, 1200));
    return (await shot.webContents.capturePage()).resize({ width: 900 }).toJPEG(80).toString('base64');
  } finally {
    shot.destroy();
  }
});

async function createWindow() {
  const { url } = await start(0);
  session.defaultSession.setPermissionRequestHandler((contents, permission, done) =>
    done(permission === 'media' && contents.getURL().startsWith(url)),
  );
  win = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 820,
    minHeight: 560,
    backgroundColor: '#262523',
    title: 'Ember',
    icon: path.join(__dirname, 'build', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: OVERLAY.dark,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
    },
  });
  Menu.setApplicationMenu(null);
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    if (/^https?:\/\//.test(target)) shell.openExternal(target);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, target) => {
    if (!target.startsWith(url)) e.preventDefault();
  });
  // 'ready-to-show' is not reliable in packaged builds, so the window is also revealed once the page
  // has loaded, and after a short delay as a last resort.
  const reveal = () => {
    if (win && !win.isDestroyed() && !win.isVisible()) win.show();
  };
  win.once('ready-to-show', reveal);
  win.webContents.once('did-finish-load', reveal);
  setTimeout(reveal, 4000);
  win.loadURL(url);
  // a self-check used while developing; installed copies ignore it
  if (!app.isPackaged && process.env.EMBER_SMOKE) {
    win.webContents.once('did-finish-load', async () => {
      await new Promise((r) => setTimeout(r, 2500));
      if (process.env.EMBER_SMOKE_SCRIPT)
        await win.webContents.executeJavaScript(fs.readFileSync(process.env.EMBER_SMOKE_SCRIPT, 'utf8'));
      const text = await win.webContents.executeJavaScript(
        "document.querySelector('.empty h2, #welcome h1, .step') ? 'UI OK' : 'NO UI'",
      );
      fs.writeFileSync(process.env.EMBER_SMOKE, (await win.webContents.capturePage()).toPNG());
      console.log(
        'SMOKE:',
        text,
        '|',
        win.webContents.getTitle(),
        '| desktop bridge:',
        await win.webContents.executeJavaScript('typeof window.emberDesktop.pickFolder'),
      );
      app.quit();
    });
  }
}

ipcMain.on('theme', (e, theme) => {
  nativeTheme.themeSource = theme === 'light' ? 'light' : 'dark';
  if (win && process.platform === 'win32')
    win.setTitleBarOverlay(OVERLAY[theme === 'light' ? 'light' : 'dark']);
});

ipcMain.on('open-external', (e, url) => {
  if (/^https?:\/\//.test(String(url))) shell.openExternal(url);
});

app.on('web-contents-created', (e, contents) => {
  contents.on('will-attach-webview', (ev, prefs) => {
    delete prefs.preload;
    prefs.nodeIntegration = false;
    prefs.contextIsolation = true;
  });
  if (contents.getType() === 'webview') {
    contents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//.test(url)) contents.loadURL(url);
      return { action: 'deny' };
    });
  }
});

ipcMain.handle('pick-folder', async () => {
  const r = await dialog.showOpenDialog(win, {
    properties: ['openDirectory', 'createDirectory'],
    title: 'Project folder',
  });
  return r.canceled ? null : r.filePaths[0];
});

nativeTheme.themeSource = 'dark';
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });
  app.whenReady().then(createWindow);
}
app.on('window-all-closed', () => app.quit());

let closed = false;
app.on('before-quit', (e) => {
  if (closed) return;
  e.preventDefault();
  closed = true;
  shutdown().finally(() => app.quit());
});
