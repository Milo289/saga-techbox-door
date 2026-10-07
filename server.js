'use strict';
// Door Display server — zero dependencies.
// Three states: Open, Closed, Busy — each optionally "until" a time, plus planned "busy during" blocks
// and optional opening hours. The server computes what the door should show; screens just render it.
const http = require('http');
const fs = require('fs');
const path = require('path');
const net = require('net');
const tls = require('tls');
const os = require('os');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 8080;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const ADMIN_PIN = process.env.ADMIN_PIN || '';
const PUBLIC_DIR = path.join(__dirname, 'public');
const BUILD = crypto.randomBytes(4).toString('hex'); // screens reload themselves when this changes
let APP_VERSION = '—';
try { APP_VERSION = require('./package.json').version; } catch {}
const MODES = ['open', 'closed', 'busy'];

// ---------- defaults ----------
const DEFAULT_SETTINGS = {
  name: 'Saga Techbox',
  subtitle: '',
  texts: {
    open: { label: 'Open', message: 'Kom gerust binnen' },
    closed: { label: 'Gesloten', message: 'Graag niet binnenkomen' },
    busy: { label: 'Bezet', message: 'Er wordt gewerkt — even niet storen' },
  },
  hours: { enabled: false, days: [1, 2, 3, 4, 5], from: '09:00', to: '17:00' },
  visitors: { reasons: false, doorbell: true, bellWhenBlocked: false, appointments: true, messages: true },
  reasons: ['Korte vraag', 'Bezorging', 'Ophalen', 'Handtekening nodig'],
  topics: ['Laptop', 'Wachtwoord / inloggen', 'Printer', 'Wifi / internet', 'Iets anders'],
  quickReplies: ['Kom binnen', 'Momentje', 'Over 5 minuten', 'Ik kom naar je toe', 'Nu even niet — probeer het later', 'Laat een bericht achter'],
  slotMinutes: 30,
  autoReplyMinutes: 5,
  autoReplyText: 'Nog geen reactie — je verzoek is opgeslagen.',
  closedReply: 'We zijn nu gesloten — je verzoek is opgeslagen.',
  note: '',
  theme: 'dark', // dark | light
  layout: { orientation: 'auto', rotate: 0, hour12: false, keyboard: true },
  ui: {}, // filled in below from UI_TEXTS (one empty text per key)
  colors: { open: '', closed: '', busy: '' }, // status colours; empty = the standard colour
  dim: { enabled: false, from: '22:00', to: '07:00', level: 0.2 },
  ntfyServer: 'https://ntfy.sh',
  ntfyTopic: '',
  webhookUrl: '',
  // e-mail (optional): confirmation + answer to visitors who leave an address, and/or a mail to you per request
  mail: { enabled: false, host: '', port: 587, user: '', pass: '', from: '', adminTo: '', confirm: true, reply: true, notifyAdmin: false },
};
// System settings: only the main account can change these (see the Systeem tab).
const DEFAULT_SYSTEM = { maintenance: false, maintenanceMessage: '', sessionDays: 30, rememberDays: 365, maxAttempts: 20, blockMinutes: 10, allowedIps: [], retentionDays: 0, autoBackup: true, backupKeep: 14 };
function normIp(ip) { ip = String(ip || '').replace(/^::ffff:/, ''); return ip === '::1' ? '127.0.0.1' : ip; } // "this computer" is one address, in IPv4 or IPv6
function ipv4ToInt(ip) { const m = String(ip).match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/); return m && m.slice(1).every((x) => Number(x) <= 255) ? ((Number(m[1]) << 24) | (Number(m[2]) << 16) | (Number(m[3]) << 8) | Number(m[4])) >>> 0 : null; }
function validIpRule(r) { const [ip, bits] = String(r).split('/'); return (ipv4ToInt(ip) !== null && (bits === undefined || (/^\d{1,2}$/.test(bits) && Number(bits) <= 32))) || (/^[0-9a-f:]+$/i.test(ip) && ip.includes(':') && bits === undefined); }
function ipInList(ip, list) {
  ip = normIp(ip);
  const n = ipv4ToInt(ip);
  return list.some((rule) => {
    const [base, bits] = String(rule).split('/');
    if (n === null) return ip.toLowerCase() === base.toLowerCase();
    const b = ipv4ToInt(base); if (b === null) return false;
    const mask = bits === undefined ? 0xffffffff : Number(bits) === 0 ? 0 : (0xffffffff << (32 - Number(bits))) >>> 0;
    return ((n & mask) >>> 0) === ((b & mask) >>> 0);
  });
}
// Where does a request really come from? Behind a tunnel or proxy the connection itself always looks local, so a visitor from the
// internet would pass for "this computer". Therefore: if a proxy header is present it is only believed when TRUST_PROXY=1 is set
// (do that only when the server can be reached through the tunnel alone, see HOST); otherwise such a request counts as "from outside".
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
function clientIp(req) {
  const remote = normIp(req.socket.remoteAddress);
  const fwd = String(req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || '').split(',')[0].trim();
  if (!fwd) return remote;
  return TRUST_PROXY ? normIp(fwd) : 'proxied';
}
function cleanSystem(b = {}) {
  const num = (v, min, max, d) => { const n = Number(v); return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : d; };
  return {
    maintenance: !!b.maintenance, maintenanceMessage: str(b.maintenanceMessage, 200),
    sessionDays: num(b.sessionDays, 1, 365, DEFAULT_SYSTEM.sessionDays), rememberDays: num(b.rememberDays, 1, 730, DEFAULT_SYSTEM.rememberDays),
    maxAttempts: num(b.maxAttempts, 3, 200, DEFAULT_SYSTEM.maxAttempts), blockMinutes: num(b.blockMinutes, 1, 1440, DEFAULT_SYSTEM.blockMinutes),
    allowedIps: (Array.isArray(b.allowedIps) ? b.allowedIps : []).map((x) => str(x, 50)).filter(validIpRule).slice(0, 40),
    retentionDays: num(b.retentionDays, 0, 3650, 0), autoBackup: b.autoBackup === undefined ? true : !!b.autoBackup, backupKeep: num(b.backupKeep, 1, 90, DEFAULT_SYSTEM.backupKeep),
  };
}

const PRIVATE_SETTINGS = ['ntfyServer', 'ntfyTopic', 'webhookUrl', 'quickReplies', 'autoReplyText', 'closedReply', 'autoReplyMinutes', 'mail'];
const PASS_MASK = '••••••••'; // the mail password is never sent back to the browser

const freshState = () => ({
  version: 2,
  settings: structuredClone(DEFAULT_SETTINGS),
  manual: null, // { mode, until, message, setAt, expiresAt }
  busy: [], // planned busy blocks { id, from, to, note }
  appointments: [], // { id, at, name, reason }
  requests: [],
  people: [], // { id, nr, name, email, note, self } — visitors type their number or username and everything is filled in (self = made by the visitor)
  peopleRev: 0,
  system: { ...DEFAULT_SYSTEM },
  lastBackupDay: '',
  lastVersion: '', // the program version that last used this data (a backup is made before the first start of a new version)
  positions: {}, // door-screen layout per screen type (see cleanPositions)
  blocks: [], // extra texts / logos on the door screen (see cleanBlocks)
  rootLock: '', // 6-digit screen-lock code hash of the main account (never exported)
  seededAdmin: false,
  users: [], // { id, username, name, role, perms[], hash, disabled, createdAt, lastLogin }
  apiKeys: [], // { id, name, prefix, hash, perms[], createdAt, lastUsed, by }
  sessions: [], // { id, hash, userId, createdAt, lastSeen, ip, ua }
  history: [],
});

// ---------- helpers ----------
const newId = () => crypto.randomBytes(6).toString('hex');
const str = (v, max = 200) => (v == null ? '' : String(v)).trim().slice(0, max);
const pad = (n) => String(n).padStart(2, '0');
const isHM = (v) => /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
const hm = (t) => { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const atTime = (day, hhmm) => { const [h, m] = hhmm.split(':').map(Number); return new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m, 0, 0); };
const flip = (mode) => (mode === 'open' ? 'closed' : 'open');
const ts = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; };
const isEmail = (v) => /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(String(v || ''));
const addrOf = (v) => { const m = String(v || '').match(/<([^>]+)>/); return (m ? m[1] : String(v || '')).trim(); };
const maskEmail = (e) => { const [u, d] = String(e).split('@'); return d ? `${u.slice(0, 1)}${'•'.repeat(Math.max(2, Math.min(6, u.length - 1)))}@${d}` : ''; };

// ----- every word on the door screen can be changed (empty = the standard text) -----
// key: [group, what it is, standard text]. {…} are filled in by the screen.
const UI_TEXTS = {
  askTitle: ['Hoofdscherm', 'Titel boven de knoppen', 'Niet kloppen'],
  bell: ['Hoofdscherm', 'Knop deurbel', 'Deurbel'],
  bellOff: ['Hoofdscherm', 'Knop deurbel als de bel uit staat', 'Deurbel uit'],
  bellWait: ['Hoofdscherm', 'Knop deurbel tijdens de wachttijd ({s} = seconden)', 'Deurbel · {s}s'],
  book: ['Hoofdscherm', 'Knop om een tijd te boeken', 'Tijd booken'],
  question: ['Hoofdscherm', 'Knop voor een vraagje', 'Vraagje'],
  todayOpen: ['Hoofdscherm', 'Regel met openingstijden ({from} en {to})', 'Vandaag open {from}–{to}'],
  todayClosed: ['Hoofdscherm', 'Regel als het vandaag dicht is', 'Vandaag gesloten'],
  over: ['Tot-tekst', 'Aftelzin ({time} = bijv. 30 minuten)', 'Over {time}'],
  closeSoon: ['Tot-tekst', 'Als we bijna sluiten ({over} = de aftelzin)', '{over} gaan we sluiten'],
  closeLater: ['Tot-tekst', 'Sluiten, later vandaag of verder weg', 'We sluiten'],
  openSoon: ['Tot-tekst', 'Als we bijna weer open zijn', '{over} zijn we weer open'],
  openLater: ['Tot-tekst', 'Weer open, verder weg', 'Weer open'],
  busySoon: ['Tot-tekst', 'Als we bijna bezet zijn', '{over} zijn we bezet'],
  busyLater: ['Tot-tekst', 'Bezet vanaf, verder weg', 'Bezet vanaf'],
  cancel: ['Knoppen', 'Annuleren', 'Annuleren'],
  back: ['Knoppen', 'Terug', 'Terug'],
  next: ['Knoppen', 'Volgende', 'Volgende'],
  send: ['Knoppen', 'Versturen', 'Versturen'],
  request: ['Knoppen', 'Aanvragen', 'Aanvragen'],
  close: ['Knoppen', 'Sluiten', 'Sluiten'],
  aboutWhat: ['Vraagje', 'Titel', 'Waarover gaat het?'],
  tellMore: ['Vraagje', 'Tekstveld', 'Vertel er iets meer over (optioneel)'],
  typeOwn: ['Vraagje', 'Eigen tekst toevoegen', '+ Typ er zelf iets bij'],
  pickTopic: ['Vraagje', 'Foutmelding zonder onderwerp', 'Kies een onderwerp of typ je vraag'],
  bookHint: ['Tijd booken', 'Uitleg', 'Kies een dag en een tijd.'],
  bookLoading: ['Tijd booken', 'Tijden laden', 'Tijden laden…'],
  who: ['Wie ben je?', 'Titel', 'Wie ben je?'],
  whoHint: ['Wie ben je?', 'Uitleg bij het nummerpaneel', 'Tik je nummer in — dan vullen we de rest voor je in.'],
  yourNumber: ['Wie ben je?', 'Leeg nummerveld', 'Je nummer'],
  typeUsername: ['Wie ben je?', 'Link: gebruikersnaam typen', 'Typ een gebruikersnaam'],
  makeProfile: ['Wie ben je?', 'Profiel maken', 'Profiel maken'],
  noNumber: ['Wie ben je?', 'Zonder nummer verder', 'Geen nummer'],
  notYou: ['Wie ben je?', 'Als het niet de juiste persoon is', 'Niet jij?'],
  hi: ['Wie ben je?', 'Begroeting ({name} = voornaam)', 'Hoi {name}!'],
  mailAlso: ['Wie ben je?', 'Schakelaar antwoord mailen ({email})', 'Antwoord ook mailen naar {email}'],
  yourNameOpt: ['Wie ben je?', 'Naamveld (mag leeg)', 'Je naam (optioneel)'],
  yourName: ['Wie ben je?', 'Naamveld (verplicht)', 'Je naam'],
  sentBell: ['Na het versturen', 'Titel na aanbellen', 'Er is aangebeld'],
  sentAppt: ['Na het versturen', 'Titel na een afspraakverzoek', 'Aanvraag verstuurd'],
  sent: ['Na het versturen', 'Titel na een vraagje', 'Verstuurd'],
  forTime: ['Na het versturen', 'Gevraagde tijd ({at})', 'Voor {at}'],
  mailNote: ['Na het versturen', 'Melding antwoord per mail ({mail})', 'Je krijgt het antwoord ook per mail ({mail}).'],
  waiting: ['Na het versturen', 'Wachten op antwoord', 'Even wachten op antwoord…'],
  toastBellOff: ['Meldingen', 'Als de bel uit staat', 'De deurbel staat nu uit — stel een vraagje'],
  toastRang: ['Meldingen', 'Als er aangebeld is (ook op andere schermen)', 'Er is aangebeld'],
  toastWait: ['Meldingen', 'Als de bel nog wacht ({s} = seconden)', 'Er is net aangebeld — nog {s} s'],
};
const resolveUi = (over) => Object.fromEntries(Object.entries(UI_TEXTS).map(([k, v]) => [k, (over && String(over[k] || '').trim()) || v[2]]));
const UI_DEFAULTS = Object.fromEntries(Object.keys(UI_TEXTS).map((k) => [k, '']));
DEFAULT_SETTINGS.ui = UI_DEFAULTS;

// ----- extra things on the door screen: your own text or logo, moved with "Indeling aanpassen" -----
const cleanBlocks = (raw) => (Array.isArray(raw) ? raw : []).slice(0, 12).map((b) => {
  if (!b || typeof b !== 'object') return null;
  const type = b.type === 'image' ? 'image' : 'text';
  const num = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, Math.round(n * 10) / 10)) : d; };
  const out = { id: /^[a-z0-9]{4,12}$/.test(String(b.id)) ? String(b.id) : newId().replace(/[^a-z0-9]/g, '').slice(0, 10) || 'blk' + Math.random().toString(36).slice(2, 8), type, size: num(b.size, 1, 40, 4), color: /^#[0-9a-f]{6}$/i.test(String(b.color)) ? String(b.color) : '', bold: !!b.bold, text: '', src: '', w: num(b.w, 4, 120, 24) };
  if (type === 'text') out.text = str(b.text, 300);
  else {
    const src = String(b.src || '');
    out.src = (/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+\/=]+$/.test(src) && src.length <= 300000) || (/^https:\/\/[^\s"'<>]{4,290}$/.test(src)) ? src : '';
    if (!out.src) return null;
  }
  return out;
}).filter(Boolean);

// ----- layout: where each part of the door screen sits (moved by hand in "Indeling aanpassen") -----
const LAYOUT_KEYS = ['portrait', 'landscape', 'phone'];
const LAYOUT_ITEMS = ['name', 'time', 'ring', 'label', 'until', 'untilAt', 'message', 'note', 'extra', 'askTitle', 'reasons', 'actions'];
const layoutId = (id) => LAYOUT_ITEMS.includes(id) || /^blk_[a-z0-9]{4,12}$/.test(id);
function cleanPositions(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  const num = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, Math.round(n * 10) / 10)) : d; };
  for (const key of LAYOUT_KEYS) {
    const items = raw[key];
    if (!items || typeof items !== 'object') continue;
    const clean = {};
    for (const id of Object.keys(items).filter(layoutId)) {
      const it = items[id];
      if (!it || typeof it !== 'object') continue;
      const r = { x: num(it.x, -100, 100, 0), y: num(it.y, -100, 100, 0), s: num(it.s, 0.4, 2.5, 1), hide: !!it.hide };
      if (r.x || r.y || r.s !== 1 || r.hide) clean[id] = r;
    }
    if (Object.keys(clean).length) out[key] = clean;
  }
  return out;
}
function coerce(def, val) {
  if (val === undefined || val === null) return structuredClone(def);
  if (typeof def === 'boolean') return !!val;
  if (typeof def === 'number') { const n = Number(val); return Number.isFinite(n) ? n : def; }
  if (typeof def === 'string') return isHM(def) ? (isHM(val) ? val : def) : str(val, 500);
  if (Array.isArray(def)) {
    if (!Array.isArray(val)) return structuredClone(def);
    if (typeof def[0] === 'number') return [...new Set(val.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))];
    return val.map((x) => str(x, 60)).filter(Boolean).slice(0, 24);
  }
  const out = {};
  for (const k of Object.keys(def)) out[k] = coerce(def[k], typeof val === 'object' ? val[k] : undefined);
  return out;
}

// ---------- persistence ----------
// Earlier versions were in English: swap any untouched English default texts for the Dutch ones.
const OLD_EN = {
  name: 'My Office',
  texts: { open: ['Open', 'Come on in'], closed: ['Closed', 'Please do not enter'], busy: ['Busy', 'People are working — please don’t come in'] },
  reasons: ['Quick question', 'Delivery', 'Appointment', 'Signature needed', 'Pick-up', 'Just saying hi'],
  quickReplies: ['Come in', 'One minute please', 'Give me 5 minutes', 'I’ll come out to you', 'Not now — try later', 'Please leave a message'],
  autoReplyText: 'No answer yet — your request is saved.',
  closedReply: 'We’re closed right now — your request is saved.',
};
function toDutch(s) {
  const D = DEFAULT_SETTINGS;
  if (s.name === OLD_EN.name) s.name = D.name;
  for (const m of MODES) {
    const [label, message] = OLD_EN.texts[m];
    if (s.texts[m].label === label) s.texts[m].label = D.texts[m].label;
    if (s.texts[m].message === message) s.texts[m].message = D.texts[m].message;
  }
  for (const k of ['reasons', 'quickReplies']) if (JSON.stringify(s[k]) === JSON.stringify(OLD_EN[k])) s[k] = [...D[k]];
  for (const k of ['autoReplyText', 'closedReply']) if (s[k] === OLD_EN[k]) s[k] = D[k];
  return s;
}
// Reads the saved settings. A damaged file never means "start empty and overwrite it": we fall back to the copy made
// before the last save, then to the newest nightly/manual backup, and the damaged file is kept next to it.
function readSavedState() {
  if (!fs.existsSync(STATE_FILE)) return null;
  const backupDir = path.join(DATA_DIR, 'backups');
  let newest = [];
  try { newest = fs.readdirSync(backupDir).filter((n) => /^state-.*\.json$/.test(n)).map((n) => path.join(backupDir, n)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs); } catch {}
  for (const f of [STATE_FILE, STATE_FILE + '.bak', ...newest]) {
    try {
      const raw = JSON.parse(fs.readFileSync(f, 'utf8'));
      if (!raw || typeof raw !== 'object') continue;
      if (f !== STATE_FILE) {
        try { fs.renameSync(STATE_FILE, `${STATE_FILE}.corrupt-${Date.now()}`); } catch {}
        console.error(`Het opslagbestand was beschadigd — hersteld uit ${path.basename(f)}`);
        setTimeout(() => save(), 500); // write the recovered settings back as the main file straight away
      }
      return raw;
    } catch {}
  }
  try { fs.renameSync(STATE_FILE, `${STATE_FILE}.corrupt-${Date.now()}`); } catch {}
  console.error('Het opslagbestand was beschadigd en er is geen back-up — er wordt opnieuw begonnen (het oude bestand is bewaard).');
  return null;
}
function load() {
  const d = freshState();
  try {
    const raw = readSavedState();
    if (!raw) return d;
    if (raw.version !== 2) {
      // older version: keep what still applies
      d.settings.name = str(raw.settings?.name, 60) || d.settings.name;
      for (const k of ['ntfyTopic', 'ntfyServer', 'webhookUrl']) if (raw.settings?.[k]) d.settings[k] = str(raw.settings[k], 300);
      return d;
    }
    return { ...d, ...raw, positions: cleanPositions(raw.positions), blocks: cleanBlocks(raw.blocks), system: cleanSystem(raw.system || {}), people: Array.isArray(raw.people) ? raw.people : [], users: Array.isArray(raw.users) ? raw.users : [], apiKeys: Array.isArray(raw.apiKeys) ? raw.apiKeys : [], sessions: Array.isArray(raw.sessions) ? raw.sessions : [], settings: toDutch(coerce(DEFAULT_SETTINGS, raw.settings)) };
  } catch {
    return d;
  }
}
let state = load();
let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(STATE_FILE + '.tmp', JSON.stringify(state, null, 2));
      try { if (fs.existsSync(STATE_FILE)) fs.copyFileSync(STATE_FILE, STATE_FILE + '.bak'); } catch {} // the last good copy, in case anything goes wrong
      fs.renameSync(STATE_FILE + '.tmp', STATE_FILE);
    } catch (e) { console.error('save failed:', e.message); }
  }, 150);
}
let actor = ''; // who is doing the current action (shown in the activity log)
let actorRoot = false;
function log(type, text, by, root) {
  state.history.unshift({ at: Date.now(), type, text: str(text, 300), by: by ?? actor, r: !!(root ?? actorRoot) });
  state.history.length = Math.min(state.history.length, 500);
}

// ---------- what should the door show? ----------
function hoursState(now) {
  const h = state.settings.hours;
  if (!h.enabled || !h.days.length || h.from >= h.to) return null;
  const d = new Date(now);
  for (let i = 0; i < 8; i++) {
    const day = new Date(d.getFullYear(), d.getMonth(), d.getDate() + i);
    if (!h.days.includes(day.getDay())) continue;
    const o = atTime(day, h.from).getTime(), c = atTime(day, h.to).getTime();
    if (now < o) return { open: false, changeAt: o };
    if (now < c) return { open: true, changeAt: c };
  }
  return { open: false, changeAt: null };
}

function manualActiveAt(t) {
  const m = state.manual;
  return m && !(m.until && t >= m.until) && !(m.expiresAt && t >= m.expiresAt) ? m : null;
}

// The status without planned busy blocks, at time t.
function baseModeAt(t) {
  const m = manualActiveAt(t);
  if (m) return m.mode;
  const hs = hoursState(t);
  if (hs) return hs.open ? 'open' : 'closed';
  if (state.manual?.until) return state.manual.mode === 'busy' ? 'open' : flip(state.manual.mode);
  return 'open';
}

function computeView(now = Date.now()) {
  const hs = hoursState(now);
  const m = manualActiveAt(now);
  let v;
  if (m) v = { mode: m.mode, until: m.until || null, message: m.message || '', source: 'manual' };
  else if (hs) v = { mode: hs.open ? 'open' : 'closed', until: hs.changeAt, message: '', source: 'hours' };
  else v = { mode: 'open', until: null, message: '', source: 'default' };

  const blocks = [...state.busy].sort((a, b) => a.from - b.from);
  // a planned block wins, unless you changed the status by hand after it started
  const active = blocks.find((b) => b.from <= now && now < b.to && !(m && m.setAt > b.from));
  if (active) {
    let end = active.to;
    for (const b of blocks) if (b.from <= end && b.to > end) end = b.to;
    v = { mode: 'busy', until: end, message: active.note || '', source: 'planned' };
  }
  const t = state.settings.texts[v.mode];
  const then = v.until ? baseModeAt(v.until) : null;
  return {
    mode: v.mode,
    label: t.label,
    message: v.message || t.message,
    until: v.until,
    then: then && then !== v.mode ? then : null,
    thenLabel: then && then !== v.mode ? state.settings.texts[then].label : null,
    source: v.source,
    upcoming: blocks.filter((b) => b.from > now && b.from < now + 24 * 3600e3).slice(0, 3).map(({ from, to, note }) => ({ from, to, note })),
  };
}

// Free appointment times over the next few open days.
function freeSlots(now = Date.now()) {
  const h = state.settings.hours;
  const days = h.enabled && h.days.length ? h.days : [1, 2, 3, 4, 5];
  const from = h.enabled ? h.from : '09:00', to = h.enabled ? h.to : '17:00';
  const step = Math.max(10, Math.min(240, state.settings.slotMinutes || 30)) * 60e3;
  const taken = state.appointments.map((a) => a.at);
  const out = [];
  let used = 0;
  for (let i = 0; i < 21 && used < 3; i++) {
    const d = new Date(now); const day = new Date(d.getFullYear(), d.getMonth(), d.getDate() + i);
    if (!days.includes(day.getDay())) continue;
    const start = atTime(day, from).getTime(), end = atTime(day, to).getTime();
    let any = false;
    for (let t = start; t + step <= end; t += step) {
      if (t < now + 15 * 60e3) continue;
      if (taken.some((a) => Math.abs(a - t) < step)) continue;
      if (state.busy.some((b) => t < b.to && t + step > b.from)) continue;
      out.push(t); any = true;
    }
    if (any) used++;
  }
  return out;
}

// ---------- live updates ----------
const clients = new Set();

function publicState() {
  const s = state.settings;
  const settings = {};
  for (const k of Object.keys(s)) if (!PRIVATE_SETTINGS.includes(k)) settings[k] = s[k];
  settings.ui = resolveUi(s.ui); // the door screen gets the words ready to use
  const now = Date.now();
  return {
    build: BUILD,
    settings,
    view: computeView(now),
    replies: state.requests.filter((r) => r.reply && now - r.repliedAt < 15 * 60e3).map((r) => ({ id: r.id, reply: r.reply })),
    bellReadyAt: lastBellAt + BELL_COOLDOWN,
    mailOn: mailOn(),
    hasPeople: state.people.length > 0,
    positions: state.positions || {},
    blocks: state.blocks || [],
    serverTime: now,
  };
}
// ---------- accounts, permissions, sessions, API keys ----------
const PERM_LABELS = {
  view: 'Status zien', status: 'Status, bericht en bezet-tijden wijzigen', inbox: 'Bezoekers zien en beantwoorden', people: 'Personenlijst beheren',
  settings: 'Instellingen wijzigen', mail: 'E-mail en meldingen instellen', export: 'Back-up maken en terugzetten', audit: 'Activiteitenlog zien',
  users: 'Gebruikers en rechten beheren', api: 'API-sleutels beheren', system: 'Systeeminstellingen',
};
const PUBLIC_PERM_LABELS = Object.fromEntries(Object.entries(PERM_LABELS).filter(([k]) => k !== 'system')); // 'system' belongs to the main account only
const ALL_PERMS = Object.keys(PERM_LABELS);
const ROLE_PRESETS = {
  root: ALL_PERMS,
  beheerder: ['view', 'status', 'inbox', 'people', 'settings', 'mail', 'export', 'audit'],
  medewerker: ['view', 'status', 'inbox'],
  kijker: ['view'],
};
// The main account lives in access.js, sealed. Without a valid file the program does not start (like a protected system file).
let ACCESS;
try {
  ACCESS = require('./access.js');
  if (!require('./seal.js').verifyAccess(ACCESS)) throw new Error('het zegel klopt niet');
} catch (e) {
  const msg = `Het beveiligingsbestand (access.js) ontbreekt of is beschadigd (${e.code === 'MODULE_NOT_FOUND' ? 'niet gevonden' : e.message}) — het programma start niet.`;
  if (require.main === module) { console.error(msg); process.exit(1); }
  throw new Error(msg);
}
const ROOT_USER = String(ACCESS.username).trim().toLowerCase();
const ROOT_HASH = String(ACCESS.hash); // fixed in the code: there is no way to change it from the program
const ASSIGNABLE = Object.fromEntries(Object.entries(ROLE_PRESETS).filter(([k]) => k !== 'root')); // roles you can give to others
function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  return `scrypt$${salt.toString('hex')}$${crypto.scryptSync(String(pw), salt, 64).toString('hex')}`;
}
function verifyPassword(pw, stored) {
  try {
    const [alg, salt, hash] = String(stored).split('$');
    if (alg !== 'scrypt') return false;
    const want = Buffer.from(hash, 'hex');
    return crypto.timingSafeEqual(crypto.scryptSync(String(pw), Buffer.from(salt, 'hex'), want.length), want);
  } catch { return false; }
}
// The START account: "admin". While the server is being set up (no other account exists yet) it may create accounts.
// As soon as another account exists it becomes an EMERGENCY account with only the essentials (see and change the status).
// It is created once. The main account can change or remove it under Beheer (saving it there turns it into an ordinary account).
// While it still has its start password it only works from your own network.
const START_PERMS = ['view', 'status', 'inbox', 'users'], EMERGENCY_PERMS = ['view', 'status'];
const inSetup = () => !state.users.some((x) => !x.starter);
const effectivePerms = (u) => (u.starter ? (inSetup() ? START_PERMS : EMERGENCY_PERMS) : permsOf(u.perms));
if (!state.seededAdmin) {
  if (!state.users.some((u) => u.username === 'admin') && ROOT_USER !== 'admin') {
    state.users.push({ id: newId(), username: 'admin', name: 'Admin', role: 'medewerker', perms: [...EMERGENCY_PERMS], hash: hashPassword('admin-start-123'), factory: true, starter: true, disabled: false, createdAt: Date.now() });
  }
  state.seededAdmin = true;
  save();
}
const DUMMY_HASH = hashPassword(crypto.randomBytes(8).toString('hex')); // so an unknown user takes as long as a wrong password
function isPrivateIp(ip) {
  ip = normIp(ip).toLowerCase();
  if (ip === '127.0.0.1' || ip.startsWith('fe80:') || ip.startsWith('fc') || ip.startsWith('fd')) return true;
  return ipv4ToInt(ip) !== null && ipInList(ip, ['127.0.0.0/8', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '169.254.0.0/16']);
}
const sha = (v) => crypto.createHash('sha256').update(String(v)).digest('hex');
const authMode = () => 'login'; // there is always a main account, so the control panel always needs a login
const permsOf = (list) => [...new Set((Array.isArray(list) ? list : []).filter((x) => ALL_PERMS.includes(x) && x !== 'system'))];
const can = (id, perm) => !!id && id.perms.includes(perm);
const rootIdentity = () => ({ kind: 'user', userId: 'root', username: ROOT_USER, name: ROOT_USER, role: 'beheerder', perms: ALL_PERMS, root: true }); // ALL_PERMS includes 'system'

function identifyFrom(tok, pin) {
  tok = String(tok || '');
  if (tok.startsWith('door_')) {
    const h = sha(tok), k = state.apiKeys.find((x) => x.hash === h);
    if (!k) return null;
    if (Date.now() - (k.lastUsed || 0) > 60e3) { k.lastUsed = Date.now(); save(); }
    return { kind: 'key', keyId: k.id, name: `API: ${k.name}`, role: 'api', perms: permsOf(k.perms) };
  }
  if (tok) {
    const h = sha(tok), ss = state.sessions.find((x) => x.hash === h);
    if (!ss || Date.now() - ss.lastSeen > (ss.ttl || state.system.sessionDays) * 864e5) return null;
    if (Date.now() - ss.lastSeen > 60e3) { ss.lastSeen = Date.now(); save(); }
    if (ss.userId === 'root') return { ...rootIdentity(), sessionId: ss.id };
    const u = state.users.find((x) => x.id === ss.userId);
    return u && !u.disabled ? { kind: 'user', userId: u.id, username: u.username, name: u.name || u.username, role: u.role, perms: effectivePerms(u), sessionId: ss.id } : null;
  }
  if (pin && ADMIN_PIN) {
    const a = Buffer.from(String(pin)), b = Buffer.from(ADMIN_PIN);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) return { kind: 'pin', name: 'Pincode', role: 'medewerker', perms: ROLE_PRESETS.medewerker };
  }
  if (authMode() === 'open') return { kind: 'open', name: 'Open toegang', role: 'beheerder', perms: ROLE_PRESETS.beheerder };
  return null;
}
function identify(req, url) {
  const auth = String(req.headers.authorization || '');
  const tok = auth.startsWith('Bearer ') ? auth.slice(7).trim() : String(req.headers['x-session'] || url.searchParams.get('token') || '');
  return identifyFrom(tok, req.headers['x-pin'] || url.searchParams.get('pin'));
}
const failures = new Map();
const recentFails = (ip) => (failures.get(ip) || []).filter((t) => Date.now() - t < state.system.blockMinutes * 60e3);
const authFail = (ip) => failures.set(ip, [...recentFails(ip), Date.now()]);
const authBlocked = (ip) => recentFails(ip).length >= state.system.maxAttempts;
// maintenance mode and the allowed-networks list apply to everybody except the main account
function gate(id, ip) {
  if (!id || id.root) return null;
  if (state.system.maintenance) return { code: 503, error: state.system.maintenanceMessage || 'Het bedieningspaneel staat tijdelijk in onderhoud.' };
  if (state.system.allowedIps.length && !ipInList(ip, state.system.allowedIps)) return { code: 403, error: 'Je kunt vanaf dit netwerk niet inloggen.' };
  return null;
}
const publicUser = (u) => ({ factory: !!u.factory, starter: !!u.starter, phase: u.starter ? (inSetup() ? 'setup' : 'emergency') : '', id: u.id, username: u.username, name: u.name, role: u.role, perms: effectivePerms(u), disabled: !!u.disabled, createdAt: u.createdAt, lastLogin: u.lastLogin || 0 });
// ----- screen lock: a 6-digit code per account; a locked session can do nothing but unlock or log out -----
const lockHashOf = (id) => (id.root ? state.rootLock : (state.users.find((x) => x.id === id.userId) || {}).lockHash) || '';
const sessionOf = (id) => state.sessions.find((x) => x.id === id.sessionId);
const MAX_LOCK_FAILS = 5;
function kick(match) { for (const c of [...clients]) if (match(c)) { try { c.res.end(); } catch {} clients.delete(c); } }
function newSession(userId, req, remember) {
  const token = 's_' + crypto.randomBytes(32).toString('hex');
  state.sessions.push({ id: newId(), hash: sha(token), userId, ttl: remember ? state.system.rememberDays : state.system.sessionDays, createdAt: Date.now(), lastSeen: Date.now(), ip: clientIp(req), ua: str(req.headers['user-agent'], 120) });
  state.sessions = state.sessions.filter((x) => Date.now() - x.lastSeen < (x.ttl || state.system.sessionDays) * 864e5).slice(-200);
  return token;
}

function adminState(id) {
  const full = (perm) => can(id, perm);
  const settings = { ...state.settings, mail: { ...state.settings.mail, pass: state.settings.mail.pass ? PASS_MASK : '' } };
  if (!full('mail')) { settings.mail = { enabled: settings.mail.enabled }; settings.ntfyTopic = ''; settings.ntfyServer = ''; settings.webhookUrl = ''; }
  return {
    build: BUILD,
    settings,
    uiTexts: UI_TEXTS,
    blocks: state.blocks || [],
    people: full('people') ? state.people : [],
    peopleRev: state.peopleRev || 0,
    mailOn: mailOn(),
    manual: state.manual,
    view: computeView(),
    busy: [...state.busy].sort((a, b) => a.from - b.from),
    appointments: [...state.appointments].sort((a, b) => a.at - b.at),
    requests: full('inbox') ? state.requests : [],
    history: full('audit') ? (full('system') ? state.history : state.history.filter((h) => !h.r && h.type !== 'systeem')) : [],
    me: { name: id.name, role: id.role, perms: id.perms, kind: id.kind, noPw: !!id.root, canLock: !!id.sessionId, hasLock: !!lockHashOf(id) },
    permLabels: PUBLIC_PERM_LABELS, rolePresets: ASSIGNABLE,
    users: full('users') ? state.users.map(publicUser) : undefined,
    sessions: full('users') ? state.sessions.filter((x) => x.userId !== 'root' || id.root).map((x) => ({ id: x.id, userId: x.userId === 'root' ? '' : x.userId, who: x.userId === 'root' ? ROOT_USER : (state.users.find((u) => u.id === x.userId)?.name || '?'), createdAt: x.createdAt, lastSeen: x.lastSeen, ip: x.ip, ua: x.ua, current: x.id === id.sessionId })).sort((a, b) => b.lastSeen - a.lastSeen) : undefined,
    apiKeys: full('api') ? state.apiKeys.map(({ id: kid, name, prefix, perms, createdAt, lastUsed, by }) => ({ id: kid, name, prefix, perms, createdAt, lastUsed, by })) : undefined,
    server: full('users') ? { version: APP_VERSION, uptime: Math.round(process.uptime()), node: process.version, platform: `${process.platform} ${process.arch}`, dataDir: DATA_DIR, clients: clients.size, authMode: authMode(), pin: !!ADMIN_PIN } : undefined,
    system: full('system') ? state.system : undefined,
    serverTime: Date.now(),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    authMode: authMode(),
  };
}
function write(c, event, data) {
  try { c.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch { clients.delete(c); }
}
function broadcast() {
  const pub = publicState();
  for (const c of [...clients]) {
    if (c.role !== 'admin') { write(c, 'state', pub); continue; }
    const id = identifyFrom(c.tok, c.pin); // still allowed? (session ended, rights changed, maintenance, network) (session ended, user disabled, rights changed)
    if (!id || gate(id, c.ip)) { try { c.res.end(); } catch {} clients.delete(c); continue; }
    write(c, 'state', adminState(id));
  }
}
let lastView = '';
function changed() { save(); lastView = JSON.stringify(computeView()); broadcast(); }
setInterval(() => { for (const c of clients) write(c, 'ping', { t: Date.now() }); }, 20000);

// ---------- outside notifications ----------
const TYPE_LABEL = { bell: 'Aangebeld', reason: 'Verzoek', appointment: 'Afspraakverzoek', message: 'Vraagje' };
function describe(r) {
  const parts = [`${TYPE_LABEL[r.type]} — ${r.name || 'Iemand'} bij ${state.settings.name}`];
  if (r.nr) parts.push(`Nummer: ${r.nr}`);
  if (r.topic) parts.push(`Onderwerp: ${r.topic}`);
  if (r.reason) parts.push(`Reden: ${r.reason}`);
  if (r.at) parts.push(`Wil: ${new Date(r.at).toLocaleString('nl-NL', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`);
  if (r.message) parts.push(`"${r.message}"`);
  return parts.join('\n');
}
async function notifyExternal(r, textOverride) {
  const s = state.settings;
  const text = textOverride || describe(r);
  const jobs = [];
  if (s.ntfyTopic) {
    jobs.push(fetch(`${(s.ntfyServer || 'https://ntfy.sh').replace(/\/$/, '')}/${encodeURIComponent(s.ntfyTopic)}`, {
      method: 'POST', body: text, headers: { Title: `${s.name}: ${r ? TYPE_LABEL[r.type] : 'Deur'}`, Priority: r?.type === 'bell' ? '5' : '4', Tags: 'door' },
      signal: AbortSignal.timeout(8000),
    }));
  }
  if (s.webhookUrl) {
    jobs.push(fetch(s.webhookUrl, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, content: text, request: r || null }), signal: AbortSignal.timeout(8000),
    }));
  }
  const results = await Promise.allSettled(jobs);
  return results.map((x) => (x.status === 'fulfilled' ? `verstuurd (${x.value.status})` : `mislukt: ${x.reason?.message}`));
}

// ---------- e-mail: a tiny SMTP client (no dependencies) ----------
// plain Dutch for the errors people actually run into
function friendlySmtp(code, line) {
  const raw = String(line || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  if (/^53[045]/.test(code)) return `Inloggen bij de mailserver lukt niet — vul je gebruikersnaam in (je e-mailadres) en gebruik een app-wachtwoord, geen gewoon wachtwoord. (${raw})`;
  if (/^5[05][0-9]/.test(code)) return `De mailserver weigert dit bericht — controleer het afzenderadres en het adres van de ontvanger. (${raw})`;
  if (/^4/.test(code)) return `De mailserver is tijdelijk bezet of weigert te veel mail — probeer het zo opnieuw. (${raw})`;
  return `Mailserver: ${raw}`;
}
const NET_ERRORS = { ENOTFOUND: 'De mailserver bestaat niet — controleer de naam (bijv. smtp.gmail.com)', EAI_AGAIN: 'Geen internet of de mailserver is niet te vinden', ECONNREFUSED: 'De mailserver neemt geen verbinding aan — controleer de poort (meestal 587)', ETIMEDOUT: 'De mailserver reageert niet — controleer de poort en je internet', ECONNRESET: 'De verbinding met de mailserver werd verbroken — probeer poort 587 of 465' };
function smtpSend(cfg, { to, subject, text }) {
  return new Promise((resolve, reject) => {
    const port = Number(cfg.port) || 587;
    const fromAddr = addrOf(cfg.from);
    let sock = port === 465 ? tls.connect({ host: cfg.host, port, servername: cfg.host }) : net.connect({ host: cfg.host, port });
    let buf = '', waiting = null, finished = false;
    const fail = (e) => { if (finished) return; finished = true; try { sock.destroy(); } catch {} reject(e instanceof Error ? (NET_ERRORS[e.code] ? new Error(NET_ERRORS[e.code]) : e) : new Error(String(e))); };
    const onData = (d) => { buf += d.toString('utf8'); pump(); };
    const attach = (s) => { s.setTimeout(20000, () => fail(new Error('Geen antwoord van de mailserver'))); s.on('error', fail); s.on('data', onData); };
    const pump = () => {
      if (!waiting) return;
      const i = buf.search(/^\d{3} [^\n]*\n/m); // the last line of an SMTP reply has a space after the code
      if (i < 0) return;
      const end = buf.indexOf('\n', i) + 1;
      const reply = buf.slice(0, end); buf = buf.slice(end);
      const w = waiting; waiting = null; w(reply);
    };
    const cmd = async (line, expect) => {
      if (line != null) sock.write(line + '\r\n');
      const reply = await new Promise((r) => { waiting = r; pump(); });
      const code = reply.match(/^(\d{3}) /m)[1];
      if (!code.startsWith(expect)) throw new Error(friendlySmtp(code, reply.trim().split('\n').pop().replace(/^\d{3}[ -]/, '')));
      return reply;
    };
    const b64 = (x) => Buffer.from(x, 'utf8').toString('base64');
    const helo = (os.hostname() || 'localhost').replace(/[^a-zA-Z0-9.-]/g, '') || 'localhost';
    attach(sock);
    (async () => {
      await cmd(null, '2');
      let ehlo = await cmd(`EHLO ${helo}`, '2');
      if (port !== 465 && /STARTTLS/i.test(ehlo)) {
        await cmd('STARTTLS', '2');
        sock.removeListener('data', onData);
        sock = tls.connect({ socket: sock, servername: cfg.host });
        attach(sock);
        await new Promise((r) => sock.once('secureConnect', r));
        ehlo = await cmd(`EHLO ${helo}`, '2');
      }
      if (cfg.user) {
        await cmd('AUTH LOGIN', '3');
        await cmd(b64(cfg.user), '3');
        await cmd(b64(cfg.pass || ''), '2');
      }
      await cmd(`MAIL FROM:<${fromAddr}>`, '2');
      await cmd(`RCPT TO:<${to}>`, '2');
      await cmd('DATA', '3');
      const fromName = String(state.settings.name).replace(/["\r\n]/g, '');
      const msg = [
        `From: =?UTF-8?B?${b64(fromName)}?= <${fromAddr}>`, `To: <${to}>`, `Subject: =?UTF-8?B?${b64(subject)}?=`,
        `Date: ${new Date().toUTCString().replace('GMT', '+0000')}`, `Message-ID: <${newId()}.${Date.now()}@${fromAddr.split('@')[1] || 'localhost'}>`,
        'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '',
        b64(text).replace(/.{76}/g, '$&\r\n'),
      ].join('\r\n');
      sock.write(msg + '\r\n.\r\n');
      await cmd(null, '2');
      finished = true;
      sock.write('QUIT\r\n'); sock.end();
      resolve();
    })().catch(fail);
  });
}
function mailOn() { const m = state.settings.mail; return !!(m.enabled && m.host && isEmail(addrOf(m.from))); }
const sendMail = (to, subject, text) => smtpSend(state.settings.mail, { to, subject, text });
const sign = () => `\n\nMet vriendelijke groet,\n${state.settings.name}`;
function quoteOf(r) { return [r.topic && `Onderwerp: ${r.topic}`, r.message && `"${r.message}"`, r.at && `Gevraagde tijd: ${new Date(r.at).toLocaleString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', hour12: false })}`].filter(Boolean).join('\n'); }
// kind: confirm | reply. Never throws: the result is stored on the request and shown in the control panel.
async function mailVisitor(r, kind) {
  const m = state.settings.mail;
  if (!r.email || !mailOn() || !(kind === 'confirm' ? m.confirm : m.reply)) return;
  const hi = r.name ? `Hoi ${r.name.split(' ')[0]},` : 'Hoi,';
  const what = r.type === 'appointment' ? 'je afspraakverzoek' : 'je vraag';
  const subject = kind === 'confirm' ? `We hebben ${what} ontvangen` : `Antwoord op ${what}`;
  const text = kind === 'confirm'
    ? `${hi}\n\nWe hebben ${what} ontvangen:\n\n${quoteOf(r)}\n\n${r.reply ? r.reply + '\n\n' : ''}Je krijgt een mail zodra we antwoorden.${sign()}`
    : `${hi}\n\nEr is geantwoord op ${what}:\n\n    ${r.reply}\n\n${quoteOf(r) ? 'Je vroeg:\n' + quoteOf(r) : ''}${sign()}`;
  r.mail = r.mail || {};
  try { await sendMail(r.email, subject, text); r.mail[kind] = 'sent'; }
  catch (e) { r.mail[kind] = 'failed'; log('mail', `Mail naar ${r.email} mislukt: ${e.message}`); }
  changed();
}
async function mailAdmin(r) {
  const m = state.settings.mail;
  if (!mailOn() || !m.notifyAdmin || !isEmail(m.adminTo)) return;
  try { await sendMail(m.adminTo, `${TYPE_LABEL[r.type]}${r.name ? ' — ' + r.name : ''}`, `${describe(r)}${r.email ? `\nE-mail: ${r.email}` : ''}\n\nBeantwoorden: open het bedieningspaneel.`); }
  catch (e) { log('mail', `Mail naar ${m.adminTo} mislukt: ${e.message}`); changed(); }
}

// ---------- timers ----------
function tick() {
  const now = Date.now();
  let dirty = false;
  const m = state.manual;
  if (m && ((m.until && now >= m.until) || (m.expiresAt && now >= m.expiresAt))) {
    if (m.until && !hoursState(now)) {
      const next = m.mode === 'busy' ? 'open' : flip(m.mode);
      state.manual = { mode: next, until: null, message: '', setAt: m.until, expiresAt: null };
      log('status', `Tijd verstreken → ${state.settings.texts[next].label}`);
    } else {
      state.manual = null;
      log('status', 'Terug naar openingstijden');
    }
    dirty = true;
  }
  if (state.system.retentionDays > 0) { // privacy: forget old visitor requests
    const n = state.requests.length;
    state.requests = state.requests.filter((r) => r.createdAt > now - state.system.retentionDays * 864e5);
    if (state.requests.length !== n) dirty = true;
  }
  if (state.system.autoBackup) {
    const d = new Date(), day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    if (state.lastBackupDay !== day && d.getHours() >= 3) {
      state.lastBackupDay = day; dirty = true;
      try { writeBackup(''); } catch (e) { log('systeem', `Automatische back-up mislukt: ${e.message}`, 'systeem'); }
    }
  }
  const before = state.busy.length + state.appointments.length;
  state.busy = state.busy.filter((b) => b.to > now - 3600e3);
  state.appointments = state.appointments.filter((a) => a.at > now - 24 * 3600e3);
  if (state.busy.length + state.appointments.length !== before) dirty = true;

  const mins = state.settings.autoReplyMinutes;
  if (mins > 0 && state.settings.autoReplyText) {
    for (const r of state.requests) {
      if (!r.reply && r.state !== 'done' && now - r.createdAt > mins * 60e3 && now - r.createdAt < 3600e3) {
        r.reply = state.settings.autoReplyText; r.repliedAt = now; r.autoReplied = true; dirty = true;
      }
    }
  }
  if (dirty) return changed();
  const v = JSON.stringify(computeView(now));
  if (v !== lastView) { lastView = v; broadcast(); } // e.g. a busy block or opening hours just started
}
setInterval(tick, 5000);

// ---------- HTTP ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
function send(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > 1024 * 1024) { reject(new Error('Te groot')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch { reject(new Error('Ongeldig verzoek')); } });
    req.on('error', reject);
  });
}
function serveFile(res, file) {
  const full = path.normalize(path.join(PUBLIC_DIR, file));
  if (!full.startsWith(PUBLIC_DIR + path.sep)) return send(res, 404, { error: 'Niet gevonden' });
  fs.readFile(full, (err, buf) => {
    if (err) return send(res, 404, { error: 'not found' });
    res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(buf);
  });
}
const bad = (msg) => Object.assign(new Error(msg), { code: 400 });
const findReq = (id) => { const r = state.requests.find((x) => x.id === id); if (!r) throw bad('Dat verzoek bestaat niet meer'); return r; };

const adminRoutes = {
  'GET /api/admin-state': (b, id) => adminState(id),
  'GET /api/me': (b, id) => adminState(id).me,

  // ----- people with accounts (permission: users) -----
  'POST /api/users/save': (b, id) => {
    const username = str(b.username, 32).toLowerCase().replace(/[^a-z0-9._-]/g, '');
    if (username.length < 3) throw bad('Gebruikersnaam: minstens 3 tekens (letters, cijfers, punt, streepje)');
    if (username === ROOT_USER) throw bad('Die gebruikersnaam is al in gebruik');
    const existing = b.id ? state.users.find((u) => u.id === b.id) : null;
    if (b.id && !existing) throw bad('Die gebruiker bestaat niet meer');
    if (state.users.some((u) => u.username === username && u !== existing)) throw bad('Die gebruikersnaam is al in gebruik');
    const role = ASSIGNABLE[b.role] ? b.role : 'medewerker';
    const perms = Array.isArray(b.perms) ? permsOf(b.perms) : ROLE_PRESETS[role];
    if (!perms.every((x) => can(id, x))) throw bad('Je kunt geen rechten geven die je zelf niet hebt');
    if (existing && !permsOf(existing.perms).every((x) => can(id, x))) throw bad('Deze gebruiker heeft meer rechten dan jij');
    const password = typeof b.password === 'string' ? b.password : '';
    if (!existing && password.length < 8) throw bad('Wachtwoord: minstens 8 tekens');
    if (password && password.length < 8) throw bad('Wachtwoord: minstens 8 tekens');
    const u = existing || { id: newId(), createdAt: Date.now(), hash: '' };
    if (existing && id.userId === existing.id && (b.disabled || !perms.includes('users'))) throw bad('Je kunt jezelf niet uitschakelen of je beheerrechten afnemen');
    Object.assign(u, { username, name: str(b.name, 60) || username, role, perms, disabled: !!b.disabled });
    if (u.starter) delete u.starter; // edited by the main account: now an ordinary account
    if (password) { u.hash = hashPassword(password); delete u.factory; }
    if (!existing) state.users.push(u);
    // new password, disabled or changed rights: end that person's sessions (they log in again)
    if (existing && (password || u.disabled)) { state.sessions = state.sessions.filter((x) => x.userId !== u.id); kick((c) => c.userId === u.id); }
    log('gebruikers', `${existing ? 'Gebruiker gewijzigd' : 'Gebruiker aangemaakt'}: ${u.username} (${u.role})`);
    return { ok: true, user: publicUser(u) };
  },
  'POST /api/users/remove': (b, id) => {
    const u = state.users.find((x) => x.id === b.id);
    if (!u) return;
    if (id.userId === u.id) throw bad('Je kunt jezelf niet verwijderen');
    if (!permsOf(u.perms).every((x) => can(id, x))) throw bad('Deze gebruiker heeft meer rechten dan jij');
    state.users = state.users.filter((x) => x !== u);
    state.sessions = state.sessions.filter((x) => x.userId !== u.id);
    kick((c) => c.userId === u.id);
    log('gebruikers', `Gebruiker verwijderd: ${u.username}`);
  },
  'POST /api/sessions/revoke': (b, id) => {
    const sel = (x) => (b.all ? true : b.userId ? x.userId === b.userId : x.id === b.id);
    const gone = state.sessions.filter((x) => sel(x) && x.id !== id.sessionId);
    state.sessions = state.sessions.filter((x) => !gone.includes(x));
    kick((c) => gone.some((g) => g.id === c.sessionId));
    log('gebruikers', `${gone.length} sessie(s) beëindigd`);
  },
  'POST /api/lock/set': (b, id) => {
    if (id.kind !== 'user' || !id.sessionId) throw bad('Alleen voor gebruikers met een account');
    const u = id.root ? null : state.users.find((x) => x.id === id.userId);
    if (!verifyPassword(b.password, id.root ? ROOT_HASH : (u && u.hash))) throw bad('Je wachtwoord klopt niet');
    if (!/^\d{6}$/.test(String(b.code || ''))) throw bad('De code moet uit precies 6 cijfers bestaan');
    const h = hashPassword(b.code);
    if (id.root) state.rootLock = h; else u.lockHash = h;
    log('gebruikers', `${id.name} heeft een schermcode ingesteld`);
  },
  'POST /api/lock/remove': (b, id) => {
    if (id.kind !== 'user' || !id.sessionId) throw bad('Alleen voor gebruikers met een account');
    const u = id.root ? null : state.users.find((x) => x.id === id.userId);
    if (!verifyPassword(b.password, id.root ? ROOT_HASH : (u && u.hash))) throw bad('Je wachtwoord klopt niet');
    if (id.root) state.rootLock = ''; else delete u.lockHash;
    log('gebruikers', `${id.name} heeft de schermcode verwijderd`);
  },
  'POST /api/lock': (b, id) => {
    const ss = id.sessionId && sessionOf(id);
    if (!ss) throw bad('Alleen voor gebruikers met een account');
    if (!lockHashOf(id)) throw bad('Stel eerst een code van 6 cijfers in');
    ss.locked = true; ss.lockFails = 0;
    kick((c) => c.sessionId === id.sessionId); // the live connection of this session ends; it comes back only after unlocking
    log('login', `${id.name} heeft het scherm vergrendeld`, id.name, !!id.root);
  },
  'POST /api/lock/unlock': async (b, id) => {
    const ss = id.sessionId && sessionOf(id);
    if (!ss || !ss.locked) return { ok: true };
    if (verifyPassword(String(b.code || '').slice(0, 12), lockHashOf(id))) { ss.locked = false; ss.lockFails = 0; log('login', `${id.name} heeft het scherm ontgrendeld`, id.name, !!id.root); return { ok: true }; }
    await new Promise((r) => setTimeout(r, 500));
    ss.lockFails = (ss.lockFails || 0) + 1;
    log('login', `Verkeerde schermcode voor ${id.name} (${ss.lockFails}/${MAX_LOCK_FAILS})`, id.name, !!id.root);
    if (ss.lockFails >= MAX_LOCK_FAILS) {
      state.sessions = state.sessions.filter((x) => x.id !== ss.id); kick((c) => c.sessionId === ss.id);
      save();
      throw Object.assign(bad('Te vaak een verkeerde code — je bent uitgelogd'), { logout: true });
    }
    save();
    throw bad(`Verkeerde code (${MAX_LOCK_FAILS - ss.lockFails} pogingen over)`);
  },
  'POST /api/layout': (b) => {
    if (!LAYOUT_KEYS.includes(b.key)) throw bad('Onbekend schermtype');
    const next = { ...(state.positions || {}) };
    const clean = cleanPositions({ [b.key]: b.items })[b.key];
    if (clean) next[b.key] = clean; else delete next[b.key]; // nothing moved = back to the standard layout
    state.positions = next;
    log('system', `Indeling ${clean ? 'aangepast' : 'hersteld'} (${{ portrait: 'verticaal', landscape: 'horizontaal', phone: 'telefoon' }[b.key]})`);
  },
  'POST /api/blocks': (b) => {
    state.blocks = cleanBlocks(b.blocks);
    const keep = new Set(state.blocks.map((x) => 'blk_' + x.id)); // positions of removed blocks go with them
    const pos = {};
    for (const [k, items] of Object.entries(state.positions || {})) { const kept = Object.fromEntries(Object.entries(items).filter(([id]) => !id.startsWith('blk_') || keep.has(id))); if (Object.keys(kept).length) pos[k] = kept; }
    state.positions = pos;
    log('system', `Eigen onderdelen op het scherm opgeslagen (${state.blocks.length})`);
  },
  'POST /api/password': (b, id) => {
    if (id.kind !== 'user') throw bad('Alleen voor gebruikers met een account');
    if (id.root) throw bad('Het wachtwoord van dit account kun je niet wijzigen');
    const u = state.users.find((x) => x.id === id.userId);
    if (!u || !verifyPassword(b.current, u.hash)) throw bad('Je huidige wachtwoord klopt niet');
    if (String(b.next || '').length < 8) throw bad('Nieuw wachtwoord: minstens 8 tekens');
    u.hash = hashPassword(b.next); delete u.factory;
    state.sessions = state.sessions.filter((x) => x.userId !== u.id || x.id === id.sessionId);
    log('gebruikers', `${u.username} heeft het wachtwoord gewijzigd`);
  },

  // ----- API keys (permission: api) -----
  'POST /api/keys/create': (b, id) => {
    const name = str(b.name, 60);
    if (!name) throw bad('Geef de sleutel een naam');
    const perms = permsOf(b.perms);
    if (!perms.length) throw bad('Kies minstens één recht');
    if (!perms.every((x) => can(id, x))) throw bad('Je kunt geen rechten geven die je zelf niet hebt');
    const key = 'door_' + crypto.randomBytes(24).toString('hex');
    state.apiKeys.push({ id: newId(), name, prefix: key.slice(0, 10), hash: sha(key), perms, createdAt: Date.now(), lastUsed: 0, by: id.name });
    log('api', `API-sleutel aangemaakt: ${name}`);
    return { ok: true, key }; // shown once, never again
  },
  'POST /api/keys/remove': (b) => {
    const k = state.apiKeys.find((x) => x.id === b.id);
    if (!k) return;
    state.apiKeys = state.apiKeys.filter((x) => x !== k);
    log('api', `API-sleutel verwijderd: ${k.name}`);
  },

  // Set Open / Closed / Busy, optionally until a time
  'POST /api/status': (b) => {
    if (!MODES.includes(b.mode)) throw bad('Onbekende status');
    const now = Date.now();
    const until = b.minutes > 0 ? now + b.minutes * 60e3 : ts(b.until) > now ? ts(b.until) : null;
    const hs = hoursState(now);
    // with opening hours on, a status without an end lasts until the next opening/closing time
    state.manual = { mode: b.mode, until, message: str(b.message, 140), setAt: now, expiresAt: !until && hs ? hs.changeAt : null };
    log('status', `${state.settings.texts[b.mode].label}${until ? ' tot ' + hm(until) : ''}${state.manual.message ? ' — ' + state.manual.message : ''}`);
  },
  'POST /api/status/auto': () => { state.manual = null; log('status', 'Volgt openingstijden'); },

  // "Busy during" — planned blocks
  'POST /api/busy/add': (b) => {
    const now = Date.now();
    let from = ts(b.from), to = ts(b.to);
    if (!from || !to || to <= from) throw bad('De eindtijd moet na de begintijd liggen');
    if (to <= now) throw bad('Die tijd is al voorbij');
    if (from < now) from = now;
    state.busy.push({ id: newId(), from, to, note: str(b.note, 100) });
    log('busy', `Bezet ${hm(from)}–${hm(to)}${b.note ? ' — ' + str(b.note, 100) : ''}`);
  },
  'POST /api/busy/remove': (b) => { state.busy = state.busy.filter((x) => x.id !== b.id); },
  'POST /api/busy/end': () => {
    const now = Date.now();
    state.busy = state.busy.map((x) => (x.from <= now && now < x.to ? { ...x, to: now } : x)).filter((x) => x.to > x.from);
    if (state.manual?.mode === 'busy') state.manual = null;
    log('busy', 'Bezet eerder beëindigd');
  },

  'POST /api/settings': (b, id) => {
    if (!can(id, 'mail')) { delete b.mail; delete b.ntfyTopic; delete b.ntfyServer; delete b.webhookUrl; }
    if (!can(id, 'settings')) for (const k of Object.keys(b)) if (!['mail', 'ntfyTopic', 'ntfyServer', 'webhookUrl', 'note'].includes(k)) delete b[k];
    if (b.mail && b.mail.pass === PASS_MASK) b.mail = { ...b.mail, pass: state.settings.mail.pass };
    const merged = { ...state.settings };
    for (const k of Object.keys(DEFAULT_SETTINGS)) if (k in b) merged[k] = coerce(DEFAULT_SETTINGS[k], b[k]);
    if (![0, 90, 180, 270].includes(merged.layout.rotate)) merged.layout.rotate = 0;
    if (!['auto', 'portrait', 'landscape'].includes(merged.layout.orientation)) merged.layout.orientation = 'auto';
    if (!['dark', 'light'].includes(merged.theme)) merged.theme = 'dark';
    for (const m of MODES) if (!merged.texts[m].label) merged.texts[m].label = DEFAULT_SETTINGS.texts[m].label;
    for (const k of Object.keys(UI_TEXTS)) merged.ui[k] = str(merged.ui[k], 120).trim();
    for (const m of MODES) if (!/^#[0-9a-f]{6}$/i.test(String(merged.colors[m]))) merged.colors[m] = '';
    // tidy the mail settings so a small slip does not break sending
    const mm = merged.mail;
    for (const k of ['host', 'user', 'from', 'adminTo']) mm[k] = String(mm[k] || '').trim();
    mm.pass = String(mm.pass || '').trim();
    if (/^[a-z]{4}( [a-z]{4}){3}$/i.test(mm.pass)) mm.pass = mm.pass.replace(/ /g, ''); // Google shows app passwords with spaces
    if (mm.pass && !mm.user) mm.user = addrOf(mm.from); // almost every provider logs in with the e-mail address
    if (mm.notifyAdmin && !mm.adminTo) mm.adminTo = addrOf(mm.from);
    state.settings = merged;
  },

  'POST /api/requests/reply': (b) => {
    const r = findReq(b.id);
    const reply = str(b.reply, 200);
    if (!reply) throw bad('Typ eerst een antwoord');
    Object.assign(r, { reply, repliedAt: Date.now(), autoReplied: false, state: 'replied' });
    log('reply', `→ ${r.name || 'bezoeker'}: ${reply}`);
    mailVisitor(r, 'reply');
  },
  'POST /api/requests/accept': (b) => {
    const r = findReq(b.id);
    const at = ts(b.at) || r.at;
    if (!at) throw bad('Kies een datum en tijd');
    state.appointments.push({ id: newId(), at, name: r.name || 'Bezoeker', reason: r.reason || '' });
    const when = new Date(at).toLocaleString('nl-NL', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
    Object.assign(r, { reply: `Bevestigd: ${when}`, repliedAt: Date.now(), autoReplied: false, state: 'replied' });
    log('appointment', `Afspraak met ${r.name || 'bezoeker'} — ${when}`);
    mailVisitor(r, 'reply');
  },
  'POST /api/requests/done': (b) => { const r = state.requests.find((x) => x.id === b.id); if (r) r.state = 'done'; },
  'POST /api/requests/seen': () => { for (const r of state.requests) if (r.state === 'new') r.state = 'seen'; },
  'POST /api/requests/clear': () => { state.requests = state.requests.filter((r) => r.state !== 'done'); },
  'POST /api/appointments/remove': (b) => { state.appointments = state.appointments.filter((a) => a.id !== b.id); },

  'POST /api/people': (b) => {
    if (b.rev !== undefined && Number(b.rev) !== (state.peopleRev || 0)) throw bad('Er is net een nieuw profiel bijgekomen — de lijst is bijgewerkt, probeer het nog eens');
    const seen = new Set();
    state.people = (Array.isArray(b.people) ? b.people : []).slice(0, 2000).map((x) => ({
      id: str(x.id, 20) || newId(), nr: str(x.nr, 20), name: str(x.name, 60), email: isEmail(str(x.email, 120)) ? str(x.email, 120) : '', note: str(x.note, 100), ...(x.self ? { self: true } : {}),
    })).filter((x) => x.nr && x.name && !seen.has(x.nr.toLowerCase()) && seen.add(x.nr.toLowerCase()));
    log('system', `Personenlijst opgeslagen (${state.people.length})`);
  },
  'POST /api/mail/test': async (b) => {
    if (!mailOn()) throw bad('Zet e-mail aan en vul de mailserver en het afzenderadres in');
    const to = str(b.to, 120);
    if (!isEmail(to)) throw bad('Vul een geldig e-mailadres in');
    try { await sendMail(to, `Testmail van ${state.settings.name}`, `Het werkt! Mails vanaf het deurscherm komen zo bij je aan.${sign()}`); }
    catch (e) { throw bad(e.message); }
    return { ok: true };
  },
  'POST /api/test-notify': async () => ({ results: await notifyExternal(null, `Testmelding van ${state.settings.name}`) }),
  'GET /api/export': () => { const { users, apiKeys, sessions, rootLock, ...rest } = state; return rest; }, // accounts and keys never leave the server
  'POST /api/import': (b) => {
    if (!b || b.version !== 2 || !b.settings) throw bad('Dit is geen back-up van deze versie');
    const d = freshState();
    state = { ...d, ...b, positions: cleanPositions(b.positions), blocks: cleanBlocks(b.blocks), users: state.users, apiKeys: state.apiKeys, sessions: state.sessions, rootLock: state.rootLock, settings: coerce(DEFAULT_SETTINGS, b.settings) }; // accounts are never imported
    log('system', 'Back-up teruggezet');
  },
};

// ----- system (only the main account) -----
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const BACKUP_RE = /^state-\d{4}-\d{2}-\d{2}(_[a-z0-9-]{1,20})?\.json$/;
function listBackups() {
  try { return fs.readdirSync(BACKUP_DIR).filter((n) => BACKUP_RE.test(n)).map((n) => { const st = fs.statSync(path.join(BACKUP_DIR, n)); return { name: n, size: st.size, at: st.mtimeMs }; }).sort((a, b) => b.at - a.at); } catch { return []; }
}
function writeBackup(label) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true, mode: 0o700 });
  const d = new Date();
  const name = `state-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}${label ? '_' + label : ''}.json`;
  const { sessions, ...rest } = state; // sessions are never written to a backup
  fs.writeFileSync(path.join(BACKUP_DIR, name), JSON.stringify(rest), { mode: 0o600 });
  for (const old of listBackups().slice(state.system.backupKeep)) { try { fs.unlinkSync(path.join(BACKUP_DIR, old.name)); } catch {} }
  return name;
}
Object.assign(adminRoutes, {
  'GET /api/system': (b, id) => ({ system: state.system, backups: listBackups(), yourIp: id.ip || '', serverTime: Date.now() }),
  'POST /api/system/settings': (b) => { state.system = cleanSystem(b); log('systeem', `Systeeminstellingen gewijzigd${state.system.maintenance ? ' (onderhoudsmodus aan)' : ''}`); },
  'POST /api/system/backups/create': () => { const name = writeBackup('handmatig'); log('systeem', `Back-up gemaakt: ${name}`); return { ok: true, name }; },
  'GET /api/system/backups/download': (b, id, url) => {
    const name = str(url.searchParams.get('name'), 80);
    if (!BACKUP_RE.test(name)) throw bad('Onbekende back-up');
    return { __file: { name, text: fs.readFileSync(path.join(BACKUP_DIR, name), 'utf8') } };
  },
  'POST /api/system/backups/restore': (b) => {
    const name = str(b.name, 80);
    if (!BACKUP_RE.test(name)) throw bad('Onbekende back-up');
    let data; try { data = JSON.parse(fs.readFileSync(path.join(BACKUP_DIR, name), 'utf8')); } catch { throw bad('Die back-up kan niet gelezen worden'); }
    if (!data || data.version !== 2 || !data.settings) throw bad('Dit is geen geldige back-up');
    writeBackup('vor-herstel'); // so a restore can be undone
    state = { ...freshState(), ...data, settings: coerce(DEFAULT_SETTINGS, data.settings), system: state.system, sessions: state.sessions, lastBackupDay: state.lastBackupDay };
    log('systeem', `Back-up teruggezet: ${name}`);
  },
  'POST /api/system/lockdown': (b, id) => {
    const now = Date.now();
    state.manual = { mode: 'closed', until: null, message: 'Tijdelijk gesloten', setAt: now, expiresAt: null };
    state.system = { ...state.system, maintenance: true, maintenanceMessage: state.system.maintenanceMessage || 'Het bedieningspaneel is tijdelijk vergrendeld.' };
    state.sessions = state.sessions.filter((x) => x.id === id.sessionId);
    kick((c) => c.sessionId !== id.sessionId);
    log('systeem', 'NOODSTOP: deur gesloten, paneel vergrendeld, alle andere sessies beëindigd');
  },
  'POST /api/system/unlock': () => { state.system = { ...state.system, maintenance: false }; log('systeem', 'Paneel weer ontgrendeld'); },
  'POST /api/system/revoke-all': (b, id) => { state.sessions = state.sessions.filter((x) => x.id === id.sessionId); kick((c) => c.sessionId !== id.sessionId); log('systeem', 'Alle andere sessies beëindigd'); },
  'POST /api/system/wipe-requests': () => { const n = state.requests.length; state.requests = []; log('systeem', `${n} bezoekersverzoeken gewist`); },
  'POST /api/system/wipe-history': () => { state.history = []; log('systeem', 'Activiteitenlog gewist'); },
});

// Public API for scripts and other programs (use an API key: Authorization: Bearer door_…)
adminRoutes['GET /api/v1/status'] = () => { const v = computeView(); return { mode: v.mode, label: v.label, message: v.message, until: v.until, then: v.then, source: v.source }; };
adminRoutes['POST /api/v1/status'] = adminRoutes['POST /api/status'];
adminRoutes['GET /api/v1/requests'] = (b, id, url) => {
  const stateF = url.searchParams.get('state');
  const list = state.requests.filter((r) => !stateF || (stateF === 'open' ? r.state === 'new' || r.state === 'seen' : r.state === stateF));
  return { requests: list.slice(0, Math.min(200, Number(url.searchParams.get('limit')) || 50)).map(({ id: rid, type, name, nr, topic, message, reason, at, email, state: st, createdAt, reply, repliedAt }) => ({ id: rid, type, name, nr, topic, message, reason, at, email, state: st, createdAt, reply, repliedAt })) };
};
adminRoutes['POST /api/v1/requests/reply'] = adminRoutes['POST /api/requests/reply'];
adminRoutes['GET /api/v1/users'] = (b, id) => ({ users: state.users.map(publicUser), roles: ASSIGNABLE, permissions: PUBLIC_PERM_LABELS });
adminRoutes['POST /api/v1/users'] = adminRoutes['POST /api/users/save'];
adminRoutes['POST /api/v1/users/remove'] = adminRoutes['POST /api/users/remove'];
adminRoutes['GET /api/v1/people'] = () => ({ people: state.people });
adminRoutes['POST /api/v1/people'] = adminRoutes['POST /api/people'];
adminRoutes['POST /api/v1/people/upsert'] = (b) => {
  const items = Array.isArray(b.people) ? b.people : [b];
  const next = [...state.people];
  for (const x of items) {
    const nr = str(x.nr, 20), name = str(x.name, 60);
    if (!nr || !name) continue;
    const row = next.find((y) => y.nr.toLowerCase() === nr.toLowerCase());
    const rec = { nr, name, email: isEmail(str(x.email, 120)) ? str(x.email, 120) : '', note: str(x.note, 100) };
    if (row) Object.assign(row, rec); else next.push({ id: newId(), ...rec });
  }
  return adminRoutes['POST /api/people']({ people: next });
};
adminRoutes['GET /api/v1/audit'] = () => ({ history: state.history.slice(0, 200) });

const NEED = {
  'GET /api/admin-state': 'view', 'GET /api/me': 'view', 'POST /api/password': 'view', 'POST /api/layout': 'settings', 'POST /api/blocks': 'settings', 'POST /api/lock': 'view', 'POST /api/lock/set': 'view', 'POST /api/lock/remove': 'view', 'POST /api/lock/unlock': 'view',
  'POST /api/status': 'status', 'POST /api/status/auto': 'status', 'POST /api/busy/add': 'status', 'POST /api/busy/remove': 'status', 'POST /api/busy/end': 'status',
  'POST /api/settings': (b) => { const ks = Object.keys(b); return ks.every((k) => k === 'note') ? 'status' : ks.every((k) => ['mail', 'ntfyTopic', 'ntfyServer', 'webhookUrl'].includes(k)) ? 'mail' : 'settings'; }, // the door message needs only the status right; mail fields only the mail right
  'POST /api/test-notify': 'mail', 'POST /api/mail/test': 'mail',
  'POST /api/requests/reply': 'inbox', 'POST /api/requests/accept': 'inbox', 'POST /api/requests/done': 'inbox', 'POST /api/requests/seen': 'inbox', 'POST /api/requests/clear': 'inbox', 'POST /api/appointments/remove': 'inbox',
  'POST /api/people': 'people',
  'GET /api/export': 'export', 'POST /api/import': 'export',
  'POST /api/users/save': 'users', 'POST /api/users/remove': 'users', 'POST /api/sessions/revoke': 'users',
  'POST /api/keys/create': 'api', 'POST /api/keys/remove': 'api',
  'GET /api/system': 'system', 'POST /api/system/settings': 'system', 'POST /api/system/backups/create': 'system', 'GET /api/system/backups/download': 'system', 'POST /api/system/backups/restore': 'system',
  'POST /api/system/revoke-all': 'system', 'POST /api/system/lockdown': 'system', 'POST /api/system/unlock': 'system', 'POST /api/system/wipe-requests': 'system', 'POST /api/system/wipe-history': 'system',
  'GET /api/v1/status': 'view', 'POST /api/v1/status': 'status', 'GET /api/v1/requests': 'inbox', 'POST /api/v1/requests/reply': 'inbox',
  'GET /api/v1/users': 'users', 'POST /api/v1/users': 'users', 'POST /api/v1/users/remove': 'users',
  'GET /api/v1/people': 'people', 'POST /api/v1/people': 'people', 'POST /api/v1/people/upsert': 'people', 'GET /api/v1/audit': 'audit',
};

const lastVisit = new Map();
const lookups = new Map();
const profileHits = new Map();
const BELL_COOLDOWN = 45 * 1000; // the doorbell can ring at most once every 45 seconds (for everyone)
let lastBellAt = 0;
function handleVisit(req, b) {
  const ip = clientIp(req);
  const now = Date.now();
  // light flood protection (the door screen is one device, so keep this short)
  if (now - (lastVisit.get(ip) || 0) < 1200) throw Object.assign(new Error('Een moment…'), { code: 429 });

  const v = state.settings.visitors;
  const view = computeView(now);
  const allowed = { bell: v.doorbell, reason: v.reasons, appointment: v.appointments, message: v.messages };
  if (!allowed[b.type]) throw bad('Die optie staat uit');
  if (b.type === 'bell' && view.mode !== 'open' && !v.bellWhenBlocked) throw bad('De bel staat nu uit — kies een reden');
  if (b.type === 'bell' && now - lastBellAt < BELL_COOLDOWN) {
    const wait = Math.ceil((lastBellAt + BELL_COOLDOWN - now) / 1000);
    throw Object.assign(new Error(`Er is net aangebeld — over ${wait} s kun je weer bellen`), { code: 429 });
  }
  if (b.type === 'message' && !str(b.message) && !str(b.topic)) throw bad('Kies een onderwerp of typ je vraag');
  if (b.type === 'appointment' && !(ts(b.at) > now)) throw bad('Kies een tijd');

  // a known number fills in name and e-mail (looked up here, never trusted from the browser)
  const person = b.nr ? state.people.find((x) => x.nr.toLowerCase() === str(b.nr, 20).toLowerCase()) : null;
  if (b.nr && !person) throw bad('Dat nummer kennen we niet');
  const typedEmail = str(b.email, 120);
  if (typedEmail && !isEmail(typedEmail)) throw bad('Dat e-mailadres klopt niet');
  const r = {
    id: newId(), type: b.type, name: person ? person.name : str(b.name, 60), reason: str(b.reason, 80), message: str(b.message, 500),
    topic: str(b.topic, 60), nr: person ? person.nr : '',
    email: b.mail === false ? '' : person ? person.email : typedEmail,
    at: b.type === 'appointment' ? ts(b.at) : null,
    statusAtTime: view.label, createdAt: now, state: 'new', reply: '', repliedAt: 0,
  };
  if (b.type === 'appointment' && !r.name) throw bad('Vul je naam in');
  if (view.mode === 'closed' && state.settings.closedReply) Object.assign(r, { reply: state.settings.closedReply, repliedAt: now, autoReplied: true });
  lastVisit.set(ip, now);
  if (r.type === 'bell') lastBellAt = now;
  state.requests.unshift(r);
  state.requests.length = Math.min(state.requests.length, 300);
  log('visit', describe(r).replace(/\n/g, ' · '));
  notifyExternal(r).catch(() => {});
  mailVisitor(r, 'confirm');
  mailAdmin(r);
  for (const c of clients) if (c.role === 'admin' && can(identifyFrom(c.tok, c.pin), 'inbox')) write(c, 'visit', r);
  // the doorbell rings on every screen at once: door screens, phones and the control panel
  if (r.type === 'bell') for (const c of clients) write(c, 'ring', { id: r.id, at: now });
  changed();
  return { id: r.id, reply: r.reply, mailTo: r.email && mailOn() ? maskEmail(r.email) : '' };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  try {
    if (p === '/healthz') return send(res, 200, { ok: true });
    if (p === '/events') {
      const role = url.searchParams.get('role') === 'admin' ? 'admin' : 'display';
      const eid = role === 'admin' ? identify(req, url) : null;
      if (role === 'admin' && !eid) return send(res, 401, { error: 'Inloggen is nodig' });
      if (eid?.sessionId && sessionOf(eid)?.locked) return send(res, 423, { error: 'Vergrendeld', locked: true });
      const sgate = role === 'admin' ? gate(eid, clientIp(req)) : null;
      if (sgate) return send(res, sgate.code, { error: sgate.error });
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.write('retry: 2000\n\n');
      const c = { res, role, ip: clientIp(req), tok: String(url.searchParams.get('token') || ''), pin: String(url.searchParams.get('pin') || ''), userId: eid?.userId, sessionId: eid?.sessionId };
      clients.add(c);
      write(c, 'state', role === 'admin' ? adminState(eid) : publicState());
      req.on('close', () => clients.delete(c));
      return;
    }
    if (req.method === 'GET' && p === '/api/state') return send(res, 200, publicState());
    if (req.method === 'GET' && p === '/api/auth-info') return send(res, 200, { mode: authMode(), pin: !!ADMIN_PIN, version: APP_VERSION });
    if (req.method === 'POST' && p === '/api/login') {
      const ip = clientIp(req);
      if (authBlocked(ip)) return send(res, 429, { error: 'Te veel pogingen — probeer het over een paar minuten opnieuw' });
      const b = await readBody(req);
      const username = str(b.username, 40).toLowerCase(), password = typeof b.password === 'string' ? b.password.slice(0, 200) : '';
      let user = null, ok = false;
      if (username === ROOT_USER) { ok = verifyPassword(password, ROOT_HASH); user = rootIdentity(); }
      else { const u = state.users.find((x) => x.username === username && !x.disabled); ok = verifyPassword(password, u ? u.hash : DUMMY_HASH) && !!u; if (ok && u.factory && !isPrivateIp(ip)) ok = false; /* the factory password never works from the internet */ if (ok) { u.lastLogin = Date.now(); user = { kind: 'user', userId: u.id, username: u.username, name: u.name || u.username, role: u.role, perms: effectivePerms(u) }; } }
      if (!ok) { authFail(ip); log('login', `Mislukte inlogpoging voor “${username}” (${ip})`, 'onbekend'); save(); await new Promise((r) => setTimeout(r, 400)); return send(res, 401, { error: 'Gebruikersnaam of wachtwoord klopt niet' }); }
      const lg = gate(user, ip);
      if (lg) return send(res, lg.code, { error: lg.error });
      const token = newSession(user.userId, req, !!b.remember);
      log('login', `${user.name} ingelogd (${ip})`, user.name, !!user.root);
      save();
      return send(res, 200, { token, user: { name: user.name, role: user.role, perms: user.perms } });
    }
    if (req.method === 'POST' && p === '/api/logout') {
      const id = identify(req, url);
      if (id?.sessionId) { state.sessions = state.sessions.filter((x) => x.id !== id.sessionId); kick((c) => c.sessionId === id.sessionId); log('login', `${id.name} uitgelogd`, id.name, !!id.root); save(); }
      return send(res, 200, { ok: true });
    }
    if (req.method === 'GET' && p === '/api/slots') return send(res, 200, { slots: freeSlots() });
    if (req.method === 'POST' && p === '/api/lookup') {
      const ip = clientIp(req);
      const hits = (lookups.get(ip) || []).filter((t) => Date.now() - t < 60e3);
      if (hits.length >= 15) return send(res, 429, { error: 'Even wachten en opnieuw proberen' });
      lookups.set(ip, [...hits, Date.now()]);
      const nr = str((await readBody(req)).nr, 20).toLowerCase();
      const x = state.people.find((y) => y.nr.toLowerCase() === nr);
      return send(res, 200, x ? { found: true, name: x.name, email: mailOn() && x.email ? maskEmail(x.email) : '' } : { found: false });
    }
    if (req.method === 'POST' && p === '/api/profile') {
      // visitors make their own profile: username + name + e-mail, so every question can be filled in with one tap
      const ip = clientIp(req);
      const hits = (profileHits.get(ip) || []).filter((t) => Date.now() - t < 3600e3);
      if (hits.length >= 5) return send(res, 429, { error: 'Je hebt net al een paar profielen gemaakt — probeer het later nog eens' });
      const b = await readBody(req);
      const nr = str(b.nr, 20).toLowerCase(), name = str(b.name, 60), email = str(b.email, 120);
      if (!/^[a-z0-9._-]{3,20}$/.test(nr)) throw bad('Gebruikersnaam: 3 tot 20 tekens (letters, cijfers, punt, streepje)');
      if (!name) throw bad('Vul je naam in');
      if (email && !isEmail(email)) throw bad('Dat e-mailadres klopt niet');
      if (state.people.some((x) => x.nr.toLowerCase() === nr)) throw bad('Die gebruikersnaam is al bezet — kies een andere');
      if (state.people.length >= 2000) throw bad('De lijst met profielen is vol');
      state.people.push({ id: newId(), nr, name, email, note: 'Zelf aangemaakt', self: true });
      state.peopleRev = (state.peopleRev || 0) + 1;
      profileHits.set(ip, [...hits, Date.now()]);
      log('visit', `Nieuw profiel: ${name} (${nr})`);
      changed();
      return send(res, 200, { ok: true, nr });
    }
    if (req.method === 'POST' && p === '/api/visit') return send(res, 200, handleVisit(req, await readBody(req)));

    const routeKey = `${req.method} ${p}`;
    const route = adminRoutes[routeKey];
    if (route) {
      const ip = clientIp(req);
      if (authBlocked(ip)) return send(res, 429, { error: 'Te veel pogingen — probeer het over een paar minuten opnieuw' });
      const id = identify(req, url);
      if (!id) { authFail(ip); return send(res, 401, { error: 'Inloggen is nodig' }); }
      id.ip = ip;
      const g = gate(id, ip);
      if (g) return send(res, g.code, { error: g.error });
      if (id.sessionId && routeKey !== 'POST /api/lock/unlock' && sessionOf(id)?.locked) return send(res, 423, { error: 'Het scherm is vergrendeld', locked: true });
      const body = req.method === 'POST' ? await readBody(req) : {};
      let need = NEED[routeKey];
      if (typeof need === 'function') need = need(body);
      if (!need) return send(res, 403, { error: 'Niet toegestaan' }); // a route without a declared right is never reachable
      if (!can(id, need) && need === 'system') return send(res, 404, { error: 'Niet gevonden' }); // for everybody else these features do not exist
      if (!can(id, need)) { log('toegang', `${id.name}: geen recht (${need}) voor ${routeKey}`); return send(res, 403, { error: `Je hebt hier geen rechten voor (${PERM_LABELS[need]})` }); }
      actor = id.name; actorRoot = !!id.root;
      let out;
      try { out = await route(body, id, url); } finally { actor = ''; actorRoot = false; }
      if (out && out.__file) {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename="${out.__file.name}"` });
        return res.end(out.__file.text);
      }
      if (p === '/api/export') {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Disposition': 'attachment; filename="door-backup.json"' });
        return res.end(JSON.stringify(out, null, 2));
      }
      if (req.method === 'POST') changed();
      return send(res, 200, out || { ok: true });
    }
    if (req.method === 'GET') {
      if (p === '/' || p === '/display' || p === '/visit') return serveFile(res, 'display.html');
      if (p === '/admin') return serveFile(res, 'admin.html');
      if (p === '/sw.js') res.setHeader('Service-Worker-Allowed', '/admin');
      return serveFile(res, p.slice(1));
    }
    send(res, 404, { error: 'not found' });
  } catch (e) {
    send(res, e.logout ? 401 : e.code === 429 ? 429 : 400, { error: e.message });
  }
});

// after an update: take a safe copy of everything first, then carry on
if (state.lastVersion && state.lastVersion !== APP_VERSION) {
  try { writeBackup('voor-update'); log('systeem', `Bijgewerkt van ${state.lastVersion} naar ${APP_VERSION} — een back-up is gemaakt`, 'systeem'); } catch {}
}
if (state.lastVersion !== APP_VERSION) { state.lastVersion = APP_VERSION; save(); }
lastView = JSON.stringify(computeView());
// `ready` lets the desktop app wait for the server (or show why it couldn't start)
const ready = new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(PORT, process.env.HOST || undefined, () => {
    console.log(`Deurscherm draait op http://localhost:${PORT}  (deur: /  bediening: /admin  telefoon: /visit)  — inloggen met account`);
    resolve(PORT);
  });
});
ready.catch((e) => {
  console.error(e.code === 'EADDRINUSE' ? `Poort ${PORT} is al in gebruik — draait de deurserver misschien al?` : `Server kon niet starten: ${e.message}`);
  if (require.main === module) process.exit(1);
});

module.exports = { ready, server };
