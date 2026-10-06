'use strict';
// Exposed to the door screen and control panel pages (they come from the server, so this stays small):
// show a notification, tell the app how many requests are open, save/open backup files, open the app settings.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('doorApp', {
  isApp: true,
  notify: (title, body) => ipcRenderer.send('notify', { title: String(title), body: String(body || '') }),
  report: (info) => ipcRenderer.send('app:report', { open: Number(info?.open) || 0, mode: String(info?.mode || ''), label: String(info?.label || '') }),
  info: () => ipcRenderer.invoke('app:info'),
  openSettings: () => ipcRenderer.send('app:openSettings'),
  revealData: () => ipcRenderer.send('app:revealData'),
  saveFile: (name, text) => ipcRenderer.invoke('app:saveFile', { name: String(name), text: String(text) }),
  openFile: () => ipcRenderer.invoke('app:openFile'),
  // the tray menu and the global shortcuts ask the page to change the status (with the person's own login)
  onTrayStatus: (cb) => { if (typeof cb === 'function') ipcRenderer.on('tray-status', (_e, mode) => cb(String(mode))); },
});
