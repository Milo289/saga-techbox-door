'use strict';
// Exposed to the door screen and control panel pages: only "show a system notification".
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('doorApp', {
  isApp: true,
  notify: (title, body) => ipcRenderer.send('notify', { title: String(title), body: String(body || '') }),
});
