'use strict';
// Exposed only to the app's own settings window.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('setup', {
  get: () => ipcRenderer.invoke('setup:get'),
  test: (url) => ipcRenderer.invoke('setup:test', url),
  save: (config) => ipcRenderer.invoke('setup:save', config),
  reveal: () => ipcRenderer.invoke('setup:reveal'),
  forgetLogin: () => ipcRenderer.invoke('setup:forgetLogin'),
  update: {
    get: () => ipcRenderer.invoke('update:get'),
    check: () => ipcRenderer.invoke('update:check'),
    download: () => ipcRenderer.invoke('update:download'),
    saveToken: (t) => ipcRenderer.invoke('update:saveToken', String(t || '')),
    onProgress: (cb) => { if (typeof cb === 'function') ipcRenderer.on('update:progress', (_e, pct) => cb(Number(pct))); },
  },
});
