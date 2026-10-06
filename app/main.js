'use strict';
// Saga Techbox Deur — desktop app (macOS, Windows, Linux).
// One app, two roles:
//   • Deurscherm: shows the door screen full screen (kiosk) and keeps it there.
//   • Bedieningspaneel: the control panel in its own window, with system notifications.
// The door server can run inside the app ("op deze computer") or elsewhere (Docker, Raspberry Pi, …).
const { app, BrowserWindow, ipcMain, Menu, Notification, powerSaveBlocker, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

app.setName('Saga Techbox Deur');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required'); // doorbell sound without a tap first

// testing aids: DOOR_USER_DATA = separate settings folder, DOOR_SNAPSHOT = save a picture of the window and quit
if (process.env.DOOR_USER_DATA) app.setPath('userData', process.env.DOOR_USER_DATA);
function snapshot(w) {
  if (!process.env.DOOR_SNAPSHOT) return;
  w.webContents.once('did-finish-load', () => setTimeout(async () => {
    fs.writeFileSync(process.env.DOOR_SNAPSHOT, (await w.webContents.capturePage()).toPNG());
    console.log(`[snapshot] ${w.webContents.getURL()} — ${w.getTitle()}`);
    app.quit();
  }, 2500));
}

if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }

// ---------- settings of this computer ----------
const CONFIG_FILE = path.join(app.getPath('userData'), 'config.json');
const DEFAULTS = { role: null, serverMode: 'here', url: 'http://localhost:8080', port: 8080, pin: '', autostart: true };
function loadConfig() {
  try { return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) }; } catch { return { ...DEFAULTS }; }
}
function saveConfig(c) {
  fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(c, null, 2));
}
let config = loadConfig();

const ICON = path.join(__dirname, '..', 'public', 'icon-512.png');
const WINDOWED = !!process.env.DOOR_WINDOWED; // for testing: door screen in a normal window
let win = null;       // the door screen or control panel window
let setupWin = null;
let displayBlocker = null;
let localServerUrl = null;

// ---------- the door server ----------
async function isDoorServer(url) {
  try { const r = await fetch(`${url.replace(/\/$/, '')}/healthz`, { signal: AbortSignal.timeout(2500) }); return r.ok; } catch { return false; }
}
async function startLocalServer() {
  if (localServerUrl) return localServerUrl;
  const url = `http://localhost:${config.port}`;
  if (await isDoorServer(url)) return (localServerUrl = url); // one is already running here (e.g. Docker): use it
  process.env.PORT = String(config.port);
  process.env.DATA_DIR = path.join(app.getPath('userData'), 'data');
  process.env.ADMIN_PIN = config.pin || '';
  const { ready } = require('../server.js');
  await ready;
  return (localServerUrl = url);
}
function lanAddresses(port) {
  return Object.values(os.networkInterfaces()).flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => `http://${i.address}:${port}`);
}

// ---------- windows ----------
function keepOnOrigin(w, base) {
  const origin = new URL(base).origin;
  w.webContents.on('will-navigate', (e, url) => { if (new URL(url).origin !== origin) { e.preventDefault(); shell.openExternal(url); } });
  w.webContents.setWindowOpenHandler(({ url }) => {
    if (new URL(url).origin === origin && config.role === 'control') {
      return { action: 'allow', overrideBrowserWindowOptions: { width: 600, height: 960, backgroundColor: '#000', autoHideMenuBar: true } };
    }
    if (!url.startsWith(origin)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

// Keep trying until the server answers (after power-on the server may still be starting)
function loadWithRetry(w, url) {
  const waiting = `data:text/html;charset=utf-8,${encodeURIComponent(`<body style="margin:0;height:100vh;display:grid;place-items:center;background:#000;color:#6b6b73;font:500 18px system-ui,sans-serif">Verbinden met de deurserver…</body>`)}`;
  w.webContents.on('did-fail-load', (_e, code, _desc, failedUrl, isMain) => {
    if (!isMain || code === -3 || failedUrl.startsWith('data:')) return; // -3 = aborted by a newer load
    w.loadURL(waiting).catch(() => {});
    setTimeout(() => { if (!w.isDestroyed()) w.loadURL(url).catch(() => {}); }, 3000);
  });
  w.webContents.on('render-process-gone', () => setTimeout(() => { if (!w.isDestroyed()) w.loadURL(url).catch(() => {}); }, 1000));
  w.loadURL(url).catch(() => {});
}

function webPrefs() {
  return { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false };
}

// Ctrl/Cmd+Shift+S = settings, Ctrl/Cmd+Shift+Q = quit (handy on the door screen, which has no menu)
function shortcuts(w) {
  w.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown' || !(input.control || input.meta) || !input.shift) return;
    const k = input.key.toLowerCase();
    if (k === 's') { e.preventDefault(); openSetup(); }
    if (k === 'q') { e.preventDefault(); app.quit(); }
  });
}

function openDoor(base) {
  const w = new BrowserWindow({
    title: 'Saga Techbox Deur', icon: ICON, backgroundColor: '#000000', autoHideMenuBar: true,
    width: 1080 / 2, height: 1920 / 2, fullscreen: !WINDOWED, kiosk: !WINDOWED, webPreferences: webPrefs(),
  });
  keepOnOrigin(w, base);
  shortcuts(w);
  loadWithRetry(w, `${base}/`);
  if (!displayBlocker) displayBlocker = powerSaveBlocker.start('prevent-display-sleep');
  return w;
}

function openControl(base) {
  const w = new BrowserWindow({
    title: 'Saga Techbox Deur — Bediening', icon: ICON, backgroundColor: '#000000',
    width: 1180, height: 880, minWidth: 380, minHeight: 520, autoHideMenuBar: process.platform !== 'darwin', webPreferences: webPrefs(),
  });
  keepOnOrigin(w, base);
  shortcuts(w);
  loadWithRetry(w, `${base}/admin`);
  return w;
}

function openSetup() {
  if (setupWin && !setupWin.isDestroyed()) { setupWin.focus(); return; }
  if (win && !win.isDestroyed() && win.isKiosk()) win.setKiosk(false); // so the settings window can come to the front
  setupWin = new BrowserWindow({
    title: 'Instellingen — Saga Techbox Deur', icon: ICON, width: 640, height: 780, resizable: true, minWidth: 520, minHeight: 600,
    backgroundColor: '#f3f4f7', autoHideMenuBar: true, parent: win && !win.isDestroyed() ? win : undefined,
    webPreferences: { preload: path.join(__dirname, 'preload-setup.js'), contextIsolation: true, sandbox: true },
  });
  snapshot(setupWin);
  setupWin.loadFile(path.join(__dirname, 'setup.html'));
  setupWin.on('closed', () => {
    setupWin = null;
    if (win && !win.isDestroyed() && config.role === 'door' && !WINDOWED) win.setKiosk(true);
    if (!win && !config.role) app.quit(); // closed the first-time setup without choosing
  });
}

async function launch() {
  const old = win;
  win = null;
  // always open the next window before closing the old one, otherwise the app would quit in between
  if (!config.role) { openSetup(); if (old) old.destroy(); return; }
  let base;
  try {
    base = config.serverMode === 'here' ? await startLocalServer() : config.url.replace(/\/$/, '');
  } catch (e) {
    dialog.showErrorBox('De deurserver kon niet starten',
      e.code === 'EADDRINUSE' ? `Poort ${config.port} wordt al door een ander programma gebruikt. Kies een andere poort in de instellingen.` : e.message);
    openSetup();
    if (old) old.destroy();
    return;
  }
  win = config.role === 'door' ? openDoor(base) : openControl(base);
  snapshot(win);
  win.on('closed', () => { if (win && win.isDestroyed()) win = null; });
  if (old) old.destroy();
  if (config.role !== 'door' && displayBlocker !== null) { powerSaveBlocker.stop(displayBlocker); displayBlocker = null; }
  applyAutostart();
}

// ---------- start at login ----------
function applyAutostart() {
  const on = !!config.autostart && !!config.role;
  if (process.platform === 'linux') {
    const dir = path.join(os.homedir(), '.config', 'autostart');
    const file = path.join(dir, 'saga-techbox-deur.desktop');
    try {
      if (on) {
        fs.mkdirSync(dir, { recursive: true });
        const exe = process.env.APPIMAGE || process.execPath;
        fs.writeFileSync(file, `[Desktop Entry]\nType=Application\nName=Saga Techbox Deur\nExec="${exe}"\nX-GNOME-Autostart-enabled=true\n`);
      } else if (fs.existsSync(file)) fs.unlinkSync(file);
    } catch {}
  } else if (app.isPackaged) {
    app.setLoginItemSettings({ openAtLogin: on });
  }
}

// ---------- messages from the pages ----------
ipcMain.on('notify', (e, { title, body }) => {
  if (!win || e.sender !== win.webContents || !Notification.isSupported()) return;
  const n = new Notification({ title: String(title).slice(0, 120), body: String(body || '').slice(0, 300), icon: ICON, silent: true });
  n.on('click', () => { if (win && !win.isDestroyed()) { win.show(); win.focus(); } });
  n.show();
  if (!win.isFocused()) { win.flashFrame(true); if (process.platform === 'darwin') app.dock?.bounce('informational'); }
});

// settings API: only for the settings window, never for pages from the server
const fromSetup = (e) => setupWin && e.sender === setupWin.webContents;
ipcMain.handle('setup:get', (e) => (fromSetup(e) ? { config, platform: process.platform, version: app.getVersion(), lan: lanAddresses(config.port), running: !!localServerUrl } : null));
ipcMain.handle('setup:test', async (e, url) => (fromSetup(e) ? isDoorServer(String(url)) : false));
ipcMain.handle('setup:save', async (e, next) => {
  if (!fromSetup(e)) return { ok: false };
  const c = {
    role: next.role === 'door' ? 'door' : 'control',
    serverMode: next.serverMode === 'remote' ? 'remote' : 'here',
    url: String(next.url || DEFAULTS.url).trim(),
    port: Math.max(1024, Math.min(65535, parseInt(next.port, 10) || 8080)),
    pin: String(next.pin || '').trim().slice(0, 32),
    autostart: !!next.autostart,
  };
  if (c.serverMode === 'remote' && !/^https?:\/\/[^\s/]+/.test(c.url)) return { ok: false, error: 'Vul een geldig adres in, bijv. http://192.168.1.50:8080' };
  const restartServer = localServerUrl && (c.serverMode !== 'here' || c.port !== config.port || c.pin !== config.pin);
  config = c;
  saveConfig(c);
  if (restartServer) { app.relaunch(); app.exit(0); return { ok: true }; } // the built-in server needs a fresh start
  const s = setupWin;
  await launch();
  if (s && !s.isDestroyed()) s.close();
  return { ok: true };
});

// ---------- menu ----------
function buildMenu() {
  const mod = process.platform === 'darwin' ? 'Cmd' : 'Ctrl';
  const template = [
    ...(process.platform === 'darwin' ? [{ label: app.name, submenu: [{ role: 'about', label: 'Over Saga Techbox Deur' }, { type: 'separator' }, { label: 'Instellingen…', accelerator: 'Cmd+,', click: openSetup }, { type: 'separator' }, { role: 'hide', label: 'Verberg' }, { role: 'quit', label: 'Stop' }] }] : []),
    { label: 'Bestand', submenu: [{ label: 'Instellingen…', accelerator: `${mod}+Shift+S`, click: openSetup }, { type: 'separator' }, { role: 'quit', label: 'Afsluiten', accelerator: `${mod}+Shift+Q` }] },
    { label: 'Bewerken', submenu: [{ role: 'undo', label: 'Ongedaan maken' }, { role: 'redo', label: 'Opnieuw' }, { type: 'separator' }, { role: 'cut', label: 'Knippen' }, { role: 'copy', label: 'Kopiëren' }, { role: 'paste', label: 'Plakken' }, { role: 'selectAll', label: 'Alles selecteren' }] },
    { label: 'Weergave', submenu: [{ role: 'reload', label: 'Opnieuw laden' }, { role: 'togglefullscreen', label: 'Volledig scherm' }, { type: 'separator' }, { role: 'resetZoom', label: 'Ware grootte' }, { role: 'zoomIn', label: 'Inzoomen' }, { role: 'zoomOut', label: 'Uitzoomen' }] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.on('second-instance', () => { const w = setupWin || win; if (w && !w.isDestroyed()) { if (w.isMinimized()) w.restore(); w.focus(); } });
app.on('window-all-closed', () => app.quit());
app.whenReady().then(() => {
  buildMenu();
  launch();
});
