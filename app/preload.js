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
  // login stored encrypted with the computer's own secure storage (keychain / credential vault / keyring)
  saveLogin: (username, password) => ipcRenderer.invoke('app:saveLogin', { username: String(username), password: String(password) }),
  loadLogin: () => ipcRenderer.invoke('app:loadLogin'),
  clearLogin: () => ipcRenderer.invoke('app:clearLogin'),
  // screen lock: take over the whole screen (kiosk, on every desktop, other monitors black) until unlocked
  setHardLock: (on) => ipcRenderer.send('app:hardLock', !!on),
  // the tray menu and the global shortcuts ask the page to change the status (with the person's own login)
  onTrayStatus: (cb) => { if (typeof cb === 'function') ipcRenderer.on('tray-status', (_e, mode) => cb(String(mode))); },
});
