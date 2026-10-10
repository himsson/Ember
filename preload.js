const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('emberDesktop', {
  pickFolder: () => ipcRenderer.invoke('pick-folder'),
  setTheme: (theme) => ipcRenderer.send('theme', theme),
  openExternal: (url) => ipcRenderer.send('open-external', url),
});
