'use strict';
// Exposed only to the app's own settings window.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('setup', {
  get: () => ipcRenderer.invoke('setup:get'),
  test: (url) => ipcRenderer.invoke('setup:test', url),
  save: (config) => ipcRenderer.invoke('setup:save', config),
});
