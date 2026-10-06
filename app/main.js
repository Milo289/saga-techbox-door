'use strict';
// Saga Techbox Deur — desktop app (macOS, Windows, Linux).
// One app, two roles:
//   • Deurscherm: shows the door screen full screen (kiosk) and keeps it there.
//   • Bedieningspaneel: the control panel in its own window, with system notifications.
// The door server can run inside the app ("op deze computer") or elsewhere (Docker, Raspberry Pi, …).
//
// Extras that only the app has (a browser can't do these): tray icon with quick status, global shortcuts,
// badge with the number of open requests, choose the monitor, always on top, zoom, daily refresh,
// native save/open dialogs for backups and start at login.
const { app, BrowserWindow, ipcMain, powerMonitor, Menu, Notification, powerSaveBlocker, shell, dialog, Tray, nativeImage, screen, globalShortcut, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

app.setName('Saga Techbox Deur');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required'); // doorbell sound without a tap first
if (process.env.DOOR_SNAPSHOT) app.disableHardwareAcceleration(); // automatic tests run on machines without a graphics card

// testing aids: DOOR_USER_DATA = separate settings folder, DOOR_SNAPSHOT = save a picture of the window and quit
if (process.env.DOOR_USER_DATA) app.setPath('userData', process.env.DOOR_USER_DATA);
function snapshot(w) {
  if (!process.env.DOOR_SNAPSHOT) return;
  w.webContents.once('did-finish-load', () => setTimeout(async () => {
    fs.writeFileSync(process.env.DOOR_SNAPSHOT, (await w.webContents.capturePage()).toPNG());
    console.log(`[snapshot] ${w.webContents.getURL()} — ${w.getTitle()}`);
    app.quit();
  }, Number(process.env.DOOR_SNAPSHOT_DELAY) || 2500));
}

if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }

// ---------- settings of this computer ----------
const CONFIG_FILE = path.join(app.getPath('userData'), 'config.json');
const DEFAULTS = {
  role: null, serverMode: 'here', url: 'http://localhost:8080', port: 8080, pin: '', autostart: true,
  zoom: 1, alwaysOnTop: false, tray: true, closeToTray: false, hotkeys: false,
  display: '', windowed: false, reloadAt: '',          // door screen: which monitor, window instead of kiosk, daily refresh time
};
function loadConfig() {
  try { return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) }; } catch { return { ...DEFAULTS }; }
}
function saveConfig(c) {
  fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(c, null, 2), { mode: 0o600 });
}
let config = loadConfig();

// the icon is unpacked from the app archive (asarUnpack), because the operating system itself has to read it
const ICON = path.join(__dirname, '..', 'public', 'icon-512.png').replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
const WINDOWED = !!process.env.DOOR_WINDOWED; // for testing: door screen in a normal window
const DATA_DIR = path.join(app.getPath('userData'), 'data');
let win = null;       // the door screen or control panel window
let setupWin = null;
let tray = null;
let displayBlocker = null;
let localServerUrl = null;
let quitting = false;
let baseOrigin = ''; // the server this window shows; only pages from there may ask for the stored login
let report = { open: 0, mode: '', label: '' }; // what the control panel tells us (for the tray and the badge)

// ---------- the door server ----------
async function isDoorServer(url) {
  try { const r = await fetch(`${url.replace(/\/$/, '')}/healthz`, { signal: AbortSignal.timeout(2500) }); return r.ok; } catch { return false; }
}
async function startLocalServer() {
  if (localServerUrl) return localServerUrl;
  const url = `http://localhost:${config.port}`;
  if (await isDoorServer(url)) return (localServerUrl = url); // one is already running here (e.g. Docker): use it
  process.env.PORT = String(config.port);
  process.env.DATA_DIR = DATA_DIR;
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
  w.webContents.on('did-finish-load', () => { if (!w.isDestroyed() && config.zoom !== 1) w.webContents.setZoomFactor(config.zoom); });
  w.loadURL(url).catch(() => {});
}

function webPrefs() {
  return { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false };
}

// Ctrl/Cmd+Shift+S = settings, Ctrl/Cmd+Shift+Q = quit (handy on the door screen, which has no menu)
function shortcuts(w) {
  w.webContents.on('before-input-event', (e, input) => {
    if (hardLocked) return; // locked: no settings, no quit
    if (input.type !== 'keyDown' || !(input.control || input.meta) || !input.shift) return;
    const k = input.key.toLowerCase();
    if (k === 's') { e.preventDefault(); openSetup(); }
    if (k === 'q') { e.preventDefault(); app.quit(); }
  });
}

function displayFor(id) {
  const all = screen.getAllDisplays();
  return all.find((d) => String(d.id) === String(id)) || screen.getPrimaryDisplay();
}

function openDoor(base) {
  const d = displayFor(config.display);
  const windowed = WINDOWED || config.windowed;
  const w = new BrowserWindow({
    title: 'Saga Techbox Deur', icon: ICON, backgroundColor: '#000000', autoHideMenuBar: true,
    x: d.bounds.x + (windowed ? 60 : 0), y: d.bounds.y + (windowed ? 60 : 0), width: windowed ? 540 : d.bounds.width, height: windowed ? 960 : d.bounds.height,
    fullscreen: !windowed, kiosk: !windowed, alwaysOnTop: config.alwaysOnTop, webPreferences: webPrefs(),
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
    width: 1180, height: 880, minWidth: 380, minHeight: 520, autoHideMenuBar: process.platform !== 'darwin',
    alwaysOnTop: config.alwaysOnTop, webPreferences: webPrefs(),
  });
  keepOnOrigin(w, base);
  shortcuts(w);
  // closing the window keeps the app running in the tray, so you never miss a visitor
  w.on('close', (e) => { if (hardLocked) { e.preventDefault(); return; } if (!quitting && config.closeToTray && tray) { e.preventDefault(); w.hide(); } });
  loadWithRetry(w, `${base}/admin`);
  return w;
}

function openSetup() {
  if (setupWin && !setupWin.isDestroyed()) { setupWin.focus(); return; }
  if (win && !win.isDestroyed() && win.isKiosk()) win.setKiosk(false); // so the settings window can come to the front
  setupWin = new BrowserWindow({
    title: 'Instellingen — Saga Techbox Deur', icon: ICON, width: 660, height: 840, resizable: true, minWidth: 520, minHeight: 600,
    backgroundColor: '#f3f4f7', autoHideMenuBar: true, parent: win && !win.isDestroyed() && win.isVisible() ? win : undefined,
    webPreferences: { preload: path.join(__dirname, 'preload-setup.js'), contextIsolation: true, sandbox: true },
  });
  snapshot(setupWin);
  setupWin.loadFile(path.join(__dirname, 'setup.html'));
  setupWin.on('closed', () => {
    setupWin = null;
    if (win && !win.isDestroyed() && config.role === 'door' && !WINDOWED && !config.windowed) win.setKiosk(true);
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
  baseOrigin = new URL(base).origin;
  win = config.role === 'door' ? openDoor(base) : openControl(base);
  snapshot(win);
  win.on('closed', () => { if (win && win.isDestroyed()) win = null; });
  if (old) old.destroy();
  if (config.role !== 'door' && displayBlocker !== null) { powerSaveBlocker.stop(displayBlocker); displayBlocker = null; }
  applyAutostart();
  updateTray();
  registerHotkeys();
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

// ---------- tray icon: quick status, open requests, show/quit ----------
const MODE_NAMES = { open: 'Open', closed: 'Gesloten', busy: 'Bezet' };
function sendStatus(mode) {
  if (!win || win.isDestroyed() || config.role !== 'control' || !MODE_NAMES[mode]) return;
  win.webContents.send('tray-status', mode); // the page does the change itself, with your own login
}
function showWindow() { if (win && !win.isDestroyed()) { if (!win.isVisible()) win.show(); if (win.isMinimized()) win.restore(); win.focus(); } }
function updateTray() {
  if (!config.tray || !config.role) { if (tray) { tray.destroy(); tray = null; } return; }
  if (!tray) {
    try {
      const img = nativeImage.createFromPath(ICON).resize({ width: process.platform === 'darwin' ? 18 : 22, height: process.platform === 'darwin' ? 18 : 22 });
      tray = new Tray(img);
      tray.on('click', showWindow);
    } catch { tray = null; return; }
  }
  const control = config.role === 'control';
  tray.setToolTip(`Saga Techbox Deur${report.label ? ` — ${report.label}` : ''}${report.open ? ` · ${report.open} open` : ''}`);
  tray.setContextMenu(Menu.buildFromTemplate([
    ...(control ? [
      { label: report.label ? `Nu: ${report.label}` : 'Saga Techbox Deur', enabled: false },
      ...Object.entries(MODE_NAMES).map(([mode, label]) => ({ label: `Zet op ${label}`, type: 'radio', checked: report.mode === mode, click: () => sendStatus(mode) })),
      { type: 'separator' },
      { label: report.open ? `${report.open} open verzoek${report.open === 1 ? '' : 'en'} bekijken` : 'Geen open verzoeken', enabled: !!report.open, click: showWindow },
    ] : []),
    { label: control ? 'Venster tonen' : 'Deurscherm tonen', click: showWindow },
    { label: 'Instellingen…', enabled: !hardLocked, click: openSetup },
    { type: 'separator' },
    { label: 'Afsluiten', enabled: !hardLocked, click: () => app.quit() },
  ]));
}

// ---------- global shortcuts (work from any program) ----------
function registerHotkeys() {
  globalShortcut.unregisterAll();
  if (!config.hotkeys || config.role !== 'control') return;
  for (const [key, mode] of [['O', 'open'], ['G', 'closed'], ['B', 'busy']]) {
    try { globalShortcut.register(`CommandOrControl+Alt+${key}`, () => sendStatus(mode)); } catch {}
  }
}

// ---------- daily refresh of the door screen (keeps a screen that runs for months fresh) ----------
let lastRefresh = '';
setInterval(() => {
  if (!config.reloadAt || !win || win.isDestroyed()) return;
  const d = new Date(), hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const key = `${d.toDateString()} ${hm}`;
  if (hm === config.reloadAt && key !== lastRefresh) { lastRefresh = key; win.webContents.reloadIgnoringCache(); }
}, 20000);

// ---------- hard lock: the screen lock of the control panel also takes over the whole computer screen ----------
// While locked the window is full screen (kiosk), on top of everything, shown on every desktop/Space (so a
// three-finger swipe to another desktop still shows it), and every other monitor is covered with black.
// The web page asks for this each time its lock screen is shown, so a restart of the app keeps it locked.
let hardLocked = false, systemShutdown = false, coverWins = [];
function applyHardLock(on) {
  if (on === hardLocked || !win || win.isDestroyed() || config.role !== 'control') return;
  hardLocked = on;
  if (on) {
    if (!win.isVisible()) win.show();
    win.setClosable(false); win.setMinimizable(false);
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setKiosk(true);
    win.focus();
    const mine = screen.getDisplayMatching(win.getBounds()).id;
    coverWins = screen.getAllDisplays().filter((d) => d.id !== mine).map((d) => {
      const c = new BrowserWindow({ x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height, frame: false, show: false, focusable: false, skipTaskbar: true, resizable: false, movable: false, backgroundColor: '#000000', webPreferences: { sandbox: true } });
      c.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
      c.setAlwaysOnTop(true, 'screen-saver');
      c.setBounds(d.bounds);
      c.showInactive();
      return c;
    });
  } else {
    for (const c of coverWins) { try { c.destroy(); } catch {} }
    coverWins = [];
    win.setKiosk(false);
    win.setVisibleOnAllWorkspaces(false, { skipTransformProcessType: true });
    win.setAlwaysOnTop(!!config.alwaysOnTop);
    win.setClosable(true); win.setMinimizable(true);
  }
  updateTray();
}
ipcMain.on('app:hardLock', (e, on) => { if (fromServerPage(e)) applyHardLock(!!on); });

// ---------- messages from the pages ----------
const fromWin = (e) => win && !win.isDestroyed() && e.sender === win.webContents;
ipcMain.on('notify', (e, { title, body }) => {
  if (!fromWin(e) || !Notification.isSupported()) return;
  const n = new Notification({ title: String(title).slice(0, 120), body: String(body || '').slice(0, 300), icon: ICON, silent: true });
  n.on('click', showWindow);
  n.show();
  if (!win.isFocused()) { win.flashFrame(true); if (process.platform === 'darwin') app.dock?.bounce('informational'); }
});
ipcMain.on('app:report', (e, info) => {
  if (!fromWin(e) || !info) return;
  report = { open: Math.max(0, Math.min(999, Number(info.open) || 0)), mode: MODE_NAMES[info.mode] ? info.mode : '', label: String(info.label || '').slice(0, 40) };
  try { app.setBadgeCount(report.open); } catch {}
  updateTray();
});
ipcMain.handle('app:info', (e) => (fromWin(e) ? {
  version: app.getVersion(), platform: process.platform, arch: process.arch, role: config.role, serverMode: config.serverMode,
  dataDir: config.serverMode === 'here' ? DATA_DIR : '', lan: config.serverMode === 'here' ? lanAddresses(config.port) : [],
  tray: !!tray, hotkeys: !!config.hotkeys && config.role === 'control', closeToTray: !!config.closeToTray, alwaysOnTop: !!config.alwaysOnTop, zoom: config.zoom,
} : null));
ipcMain.on('app:openSettings', (e) => { if (fromWin(e)) openSetup(); });
ipcMain.on('app:revealData', (e) => { if (fromWin(e) && config.serverMode === 'here' && fs.existsSync(DATA_DIR)) shell.openPath(DATA_DIR); });
ipcMain.handle('app:saveFile', async (e, { name, text }) => {
  if (!fromWin(e)) return { ok: false };
  const r = await dialog.showSaveDialog(win, { title: 'Opslaan', defaultPath: path.join(app.getPath('documents'), String(name || 'bestand.json').replace(/[\\/:*?"<>|]/g, '-')), filters: [{ name: 'JSON', extensions: ['json'] }] });
  if (r.canceled || !r.filePath) return { ok: false, canceled: true };
  fs.writeFileSync(r.filePath, String(text), { mode: 0o600 });
  return { ok: true, path: r.filePath };
});
ipcMain.handle('app:openFile', async (e) => {
  if (!fromWin(e)) return { ok: false };
  const r = await dialog.showOpenDialog(win, { title: 'Back-up kiezen', defaultPath: app.getPath('documents'), properties: ['openFile'], filters: [{ name: 'JSON', extensions: ['json'] }] });
  if (r.canceled || !r.filePaths[0]) return { ok: false, canceled: true };
  const st = fs.statSync(r.filePaths[0]);
  if (st.size > 8 * 1024 * 1024) return { ok: false, error: 'Dat bestand is te groot voor een back-up' };
  return { ok: true, text: fs.readFileSync(r.filePaths[0], 'utf8') };
});

// Stored login: encrypted by the operating system's secure storage, readable only by this app, only by the control panel of the server in use.
const LOGIN_FILE = path.join(app.getPath('userData'), 'login.bin');
const fromServerPage = (e) => fromWin(e) && !!e.senderFrame && (() => { try { return new URL(e.senderFrame.url).origin === baseOrigin; } catch { return false; } })();
function secureStorageOk() {
  try {
    if (!safeStorage.isEncryptionAvailable()) return false;
    if (process.platform === 'linux' && safeStorage.getSelectedStorageBackend?.() === 'basic_text') return false; // no keyring: that would not really be encrypted
    return true;
  } catch { return false; }
}
ipcMain.handle('app:saveLogin', (e, { username, password }) => {
  if (!fromServerPage(e)) return { ok: false };
  if (!secureStorageOk()) return { ok: false, error: 'Dit systeem heeft geen veilige opslag (sleutelhanger) — je inlog is niet bewaard' };
  fs.writeFileSync(LOGIN_FILE, safeStorage.encryptString(JSON.stringify({ username: String(username).slice(0, 80), password: String(password).slice(0, 200), origin: baseOrigin })), { mode: 0o600 });
  return { ok: true };
});
ipcMain.handle('app:loadLogin', (e) => {
  if (!fromServerPage(e) || !fs.existsSync(LOGIN_FILE) || !secureStorageOk()) return null;
  try { const d = JSON.parse(safeStorage.decryptString(fs.readFileSync(LOGIN_FILE))); return d.origin === baseOrigin ? { username: d.username, password: d.password } : null; } catch { return null; }
});
ipcMain.handle('app:clearLogin', (e) => { if (fromServerPage(e)) { try { fs.unlinkSync(LOGIN_FILE); } catch {} } return { ok: true }; });

// settings API: only for the settings window, never for pages from the server
const fromSetup = (e) => setupWin && e.sender === setupWin.webContents;
ipcMain.handle('setup:get', (e) => {
  if (!fromSetup(e)) return null;
  return {
    config: { ...config }, platform: process.platform, version: app.getVersion(), lan: lanAddresses(config.port), running: !!localServerUrl, dataDir: DATA_DIR,
    displays: screen.getAllDisplays().map((d, i) => ({ id: String(d.id), label: `Scherm ${i + 1} — ${d.bounds.width}×${d.bounds.height}${d.id === screen.getPrimaryDisplay().id ? ' (hoofdscherm)' : ''}` })),
  };
});
ipcMain.handle('setup:test', async (e, url) => (fromSetup(e) ? isDoorServer(String(url)) : false));
ipcMain.handle('setup:reveal', (e) => { if (fromSetup(e) && fs.existsSync(DATA_DIR)) shell.openPath(DATA_DIR); });
ipcMain.handle('setup:save', async (e, next) => {
  if (!fromSetup(e)) return { ok: false };
  const c = {
    ...config,
    role: next.role === 'door' ? 'door' : 'control',
    serverMode: next.serverMode === 'remote' ? 'remote' : 'here',
    url: String(next.url || DEFAULTS.url).trim(),
    port: Math.max(1024, Math.min(65535, parseInt(next.port, 10) || 8080)),
    pin: String(next.pin || '').trim().slice(0, 32),
    autostart: !!next.autostart,
    zoom: Math.max(0.5, Math.min(2.5, Number(next.zoom) || 1)),
    alwaysOnTop: !!next.alwaysOnTop, tray: !!next.tray, closeToTray: !!next.closeToTray, hotkeys: !!next.hotkeys,
    display: String(next.display || ''), windowed: !!next.windowed,
    reloadAt: /^([01]\d|2[0-3]):[0-5]\d$/.test(next.reloadAt) ? next.reloadAt : '',
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

app.on('before-quit', (e) => { if (hardLocked && !systemShutdown) { e.preventDefault(); return; } quitting = true; });
powerMonitor.on('shutdown', () => { systemShutdown = true; }); // never block the computer from shutting down
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('second-instance', () => { const w = setupWin || win; if (w && !w.isDestroyed()) { if (!w.isVisible()) w.show(); if (w.isMinimized()) w.restore(); w.focus(); } });
app.on('window-all-closed', () => { if (!config.closeToTray || !tray) app.quit(); });
// Like a protected system file: without a valid access.js the app does not start at all.
function accessIntact() {
  try { return require('../seal.js').verifyAccess(require('../access.js')); } catch { return false; }
}
app.whenReady().then(() => {
  if (!accessIntact()) {
    dialog.showErrorBox('Saga Techbox Deur kan niet starten', 'Een beveiligd bestand van het programma ontbreekt of is beschadigd. Installeer het programma opnieuw.');
    app.quit();
    return;
  }
  buildMenu();
  launch();
});
