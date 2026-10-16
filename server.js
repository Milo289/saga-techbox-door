'use strict';
// Door Display server — zero dependencies.
// Three states: Open, Closed, Busy — each optionally "until" a time, plus planned "busy during" blocks
// and optional opening hours. The server computes what the door should show; screens just render it.
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const net = require('net');
const tls = require('tls');
const os = require('os');
const crypto = require('crypto');
const zlib = require('zlib');
const integ = require('./integrations.js'); // microcontrollers, door lock + NFC tags, camera events, automations (all opt-in)
const schedule = require('./schedule.js'); // hours per day, extra buttons, who is told what, auto replies, calendar
const pki = require('./pki.js'); // an own certificate authority, so https needs no domain
const security = require('./security.js'); // encrypted secrets, two-step codes, tamper-evident log, protected backups
const power = require('./power.js'); // switching the screen / computer off and on by a schedule (opt-in)

const PORT = Number(process.env.PORT) || 8080;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const keys = security.keyStore(DATA_DIR);
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
  hours: { enabled: false, days: [1, 2, 3, 4, 5], from: '09:00', to: '17:00', perDay: {}, breaks: [], holidays: [] },
  customButtons: [], notifyRules: [], autoReplies: [],
  visitors: { reasons: false, doorbell: true, bellWhenBlocked: false, appointments: true, messages: true, callback: false },
  moderation: { filter: true, defaultList: true, words: '', action: 'mask', maxPerHour: 20, profileApproval: false }, // action: flag | mask | block
  themeSchedule: { enabled: false, lightFrom: '07:00', darkFrom: '19:00' }, // the door screen is light by day and dark by night
  sound: { bell: 'classic', reply: 'soft', custom: false }, // custom = an own bell sound has been uploaded (the file itself is not in the settings)
  away: { enabled: false, until: '', message: '' }, // absence mode: closed until the end of this date (YYYY-MM-DD)
  weather: { enabled: false, city: '', lat: 0, lon: 0 },
  // what visitors must fill in, per button; plus consent, limits and texts of the visitor page (edited with the generic form below)
  form: {
    name: { bell: 'hidden', reason: 'optional', message: 'optional', appointment: 'required', callback: 'required' },
    email: { bell: 'hidden', reason: 'hidden', message: 'auto', appointment: 'auto', callback: 'hidden' },
    phone: { callback: 'required' },
    consent: false, consentText: 'Ik ga ermee akkoord dat mijn gegevens kort worden bewaard, zodat er geantwoord kan worden.', privacyNote: '',
    maxMessageLength: 500, visitCooldownSec: 1, bellCooldownSec: 45, thanksText: '',
  },
  watch: { screenMinutes: 0 }, // warn me when no door screen has been connected for this many minutes (0 = off)
  startup: { status: 'hours', message: '' }, // what the door shows after the server (re)starts: follow the opening hours, or open / closed / busy
  downloads: { enabled: false }, // a public page /get where people can download the apps you put in the data/downloads folder
  qr: { enabled: false, url: '' }, // a QR code on the door screen that opens the visitor page on the visitor's own phone
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
  colorsLight: { open: '', closed: '', busy: '' }, // the same for the light theme (empty = use the colours above)
  accent: '', // colour of the control panel and the apps (tabs, switches, buttons); empty = neutral
  palette: 'standard', // which colour theme was picked last (or 'custom')
  dim: { enabled: false, from: '22:00', to: '07:00', level: 0.2 },
  ntfyServer: 'https://ntfy.sh',
  ntfyTopic: '',
  webhookUrl: '',
  // e-mail (optional): confirmation + answer to visitors who leave an address, and/or a mail to you per request
  mail: { enabled: false, host: '', port: 587, user: '', pass: '', from: '', adminTo: '', confirm: true, reply: true, notifyAdmin: false, digest: false, digestAt: '18:00', weekly: false, weeklyDay: 5 },
};
// System settings: only the main account can change these (see the Systeem tab).
const DEFAULT_SYSTEM = { maintenance: false, maintenanceMessage: '', sessionDays: 30, rememberDays: 365, maxAttempts: 10, blockMinutes: 10, rateLimit: true, attack: { burst: 240, perSec: 30, strikes: 80, banMinutes: 10, maxSse: 30 }, require2fa: 'off', backupPassword: '', backupCopyDir: '', https: false, httpsPort: 8443, allowedIps: [], retentionDays: 0, autoBackup: true, backupKeep: 14 };
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
const maskSystem = (sys) => ({ ...sys, backupPassword: sys.backupPassword ? PASS_MASK : '' });
function cleanSystem(b = {}) {
  const num = (v, min, max, d) => { const n = Number(v); return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : d; };
  return {
    maintenance: !!b.maintenance, maintenanceMessage: str(b.maintenanceMessage, 200),
    sessionDays: num(b.sessionDays, 1, 365, DEFAULT_SYSTEM.sessionDays), rememberDays: num(b.rememberDays, 1, 730, DEFAULT_SYSTEM.rememberDays),
    maxAttempts: num(b.maxAttempts, 3, 200, DEFAULT_SYSTEM.maxAttempts), blockMinutes: num(b.blockMinutes, 1, 1440, DEFAULT_SYSTEM.blockMinutes), rateLimit: b.rateLimit === undefined ? true : !!b.rateLimit,
    allowedIps: (Array.isArray(b.allowedIps) ? b.allowedIps : []).map((x) => str(x, 50)).filter(validIpRule).slice(0, 40),
    attack: { burst: num(b.attack && b.attack.burst, 20, 5000, 240), perSec: num(b.attack && b.attack.perSec, 2, 500, 30), strikes: num(b.attack && b.attack.strikes, 10, 1000, 80), banMinutes: num(b.attack && b.attack.banMinutes, 1, 1440, 10), maxSse: num(b.attack && b.attack.maxSse, 3, 500, 30) },
    require2fa: ['off', 'root', 'privileged'].includes(b.require2fa) ? b.require2fa : 'off',
    backupPassword: str(b.backupPassword, 300), backupCopyDir: str(b.backupCopyDir, 300),
    https: !!b.https, httpsPort: num(b.httpsPort, 1024, 65535, 8443),
    retentionDays: num(b.retentionDays, 0, 3650, 0), autoBackup: b.autoBackup === undefined ? true : !!b.autoBackup, backupKeep: num(b.backupKeep, 1, 90, DEFAULT_SYSTEM.backupKeep),
  };
}

// ---------- the visitor form: what is asked, what is required ----------
const FORM_TYPES = [['bell', 'Aanbellen'], ['reason', 'Een reden kiezen'], ['message', 'Een vraagje'], ['appointment', 'Een tijd boeken'], ['callback', 'Terugbellen']];
const FORM_DEFAULT = { name: { bell: 'hidden', reason: 'optional', message: 'optional', appointment: 'required', callback: 'required' }, email: { bell: 'hidden', reason: 'hidden', message: 'auto', appointment: 'auto', callback: 'hidden' }, phone: { callback: 'required' } };
const FORM_OPTIONS = {
  name: [['hidden', 'Niet vragen'], ['optional', 'Mag leeg blijven'], ['required', 'Verplicht']],
  email: [['hidden', 'Niet vragen'], ['auto', 'Alleen vragen als e-mail aan staat'], ['optional', 'Mag leeg blijven'], ['required', 'Verplicht']],
  phone: [['optional', 'Mag leeg blijven'], ['required', 'Verplicht']],
};
function formMode(field, type) {
  const f = state.settings.form;
  const m = f && f[field] && f[field][type];
  if (FORM_OPTIONS[field] && FORM_OPTIONS[field].some((o) => o[0] === m)) return m;
  return (FORM_DEFAULT[field] && FORM_DEFAULT[field][type]) || 'hidden';
}
const clampInt = (v, min, max, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : d; };
const bellCooldown = () => clampInt(state.settings.form && state.settings.form.bellCooldownSec, 5, 600, 45) * 1000;
const visitCooldown = () => clampInt(state.settings.form && state.settings.form.visitCooldownSec, 1, 60, 1) * 1000;
const maxMessage = () => clampInt(state.settings.form && state.settings.form.maxMessageLength, 50, 1000, 500);
// the description of these settings is sent to every app, so each app can show them without being changed for new options
function formSchema() {
  const f = state.settings.form, groups = [];
  const req = { id: 'required', title: 'Wat moeten bezoekers invullen?', help: 'Per knop op het deurscherm en de bezoekerspagina. “Verplicht” betekent dat het niet verstuurd kan worden zonder.', fields: [] };
  for (const [t, label] of FORM_TYPES) {
    req.fields.push({ key: `form.name.${t}`, label: `${label}: naam`, type: 'choice', options: FORM_OPTIONS.name, value: formMode('name', t) });
    if (t !== 'bell' || true) req.fields.push({ key: `form.email.${t}`, label: `${label}: e-mailadres`, type: 'choice', options: FORM_OPTIONS.email, value: formMode('email', t) });
  }
  req.fields.push({ key: 'form.phone.callback', label: 'Terugbellen: telefoonnummer', type: 'choice', options: FORM_OPTIONS.phone, value: formMode('phone', 'callback') });
  groups.push(req);
  groups.push({ id: 'privacy', title: 'Privacy', help: 'Gezichten, namen en nummers zijn persoonsgegevens. Met toestemming vragen ben je netjes in orde.', fields: [
    { key: 'form.consent', label: 'Eerst toestemming laten aanvinken', type: 'toggle', value: !!f.consent },
    { key: 'form.consentText', label: 'Tekst van de toestemming', type: 'text', max: 200, value: f.consentText },
    { key: 'form.privacyNote', label: 'Korte privacytekst onder het formulier', type: 'text', max: 200, value: f.privacyNote },
  ] });
  groups.push({ id: 'limits', title: 'Grenzen', help: 'Tegen spam en per ongeluk aanbellen.', fields: [
    { key: 'form.maxMessageLength', label: 'Maximale lengte van een bericht (tekens)', type: 'number', min: 50, max: 1000, value: maxMessage() },
    { key: 'form.visitCooldownSec', label: 'Wachttijd tussen twee verzoeken van één apparaat (seconden)', type: 'number', min: 1, max: 60, value: visitCooldown() / 1000 },
    { key: 'form.bellCooldownSec', label: 'Wachttijd tussen twee keer aanbellen, voor iedereen (seconden)', type: 'number', min: 5, max: 600, value: bellCooldown() / 1000 },
  ] });
  groups.push({ id: 'texts', title: 'Teksten', fields: [{ key: 'form.thanksText', label: 'Tekst na het versturen (leeg = standaard)', type: 'text', max: 120, value: f.thanksText }] });
  return groups;
}
function sanitizeForm(f) {
  const out = structuredClone(DEFAULT_SETTINGS.form);
  for (const field of ['name', 'email', 'phone']) for (const t of Object.keys(FORM_DEFAULT[field])) { const m = f && f[field] && f[field][t]; out[field][t] = FORM_OPTIONS[field].some((o) => o[0] === m) ? m : FORM_DEFAULT[field][t]; }
  out.consent = !!(f && f.consent); out.consentText = str(f && f.consentText, 200) || DEFAULT_SETTINGS.form.consentText; out.privacyNote = str(f && f.privacyNote, 200);
  out.maxMessageLength = clampInt(f && f.maxMessageLength, 50, 1000, 500); out.visitCooldownSec = clampInt(f && f.visitCooldownSec, 1, 60, 1); out.bellCooldownSec = clampInt(f && f.bellCooldownSec, 5, 600, 45);
  out.thanksText = str(f && f.thanksText, 120);
  return out;
}
function applyFormValues(values) {
  const f = state.settings.form;
  const set = (path, v) => { const [, a, b] = path.split('.'); if (b) f[a][b] = v; else f[a] = v; };
  let n = 0;
  for (const g of formSchema()) for (const fld of g.fields) {
    if (!(fld.key in values)) continue;
    const v = values[fld.key];
    if (fld.type === 'choice') { if (!fld.options.some((o) => o[0] === v)) throw bad(`Ongeldige keuze voor “${fld.label}”`); set(fld.key, v); }
    else if (fld.type === 'toggle') set(fld.key, v === true || v === 'true');
    else if (fld.type === 'number') { const x = Math.round(Number(v)); if (!Number.isFinite(x)) throw bad(`“${fld.label}” moet een getal zijn`); set(fld.key, Math.max(fld.min, Math.min(fld.max, x))); }
    else set(fld.key, str(v, fld.max || 200));
    n++;
  }
  return n;
}

const PRIVATE_SETTINGS = ['notifyRules', 'autoReplies', 'ntfyServer', 'ntfyTopic', 'webhookUrl', 'quickReplies', 'autoReplyText', 'closedReply', 'autoReplyMinutes', 'mail'];
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
  blocked: [], // blocked visitors { id, kind: 'ip'|'nr', value, until (0 = for ever), reason, at, by }
  customBell: null, // an own bell sound { mime, b64, at }
  lastDigestDay: '', lastWeeklyDay: '', icsToken: '',
  power: power.defaults(), // energy management (see power.js)
  rootTotp: null, rootPasskeys: [], rootDevices: [], historyHead: '', // two-step codes of the main account, devices it logged in on, the fingerprint of the newest log line
  alerts: [], // warnings: { id, kind, text, at, count, resolvedAt }
  integ: integ.defaults(), devices: [], sightings: [], // see integrations.js
  wakeApplied: 0, // when the wake-up schedule was last put on this computer
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
  callback: ['Hoofdscherm', 'Knop om teruggebeld te worden', 'Terugbellen'],
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
  profilePending: ['Wie ben je?', 'Profiel moet nog goedgekeurd worden', 'Je profiel is gemaakt en wacht op goedkeuring.'],
  qrHint: ['Hoofdscherm', 'Tekst onder de QR-code', 'Scan en bel met je eigen telefoon'],
  callbackHint: ['Terugbellen', 'Uitleg', 'Laat je nummer achter, dan bellen we je terug.'],
  callbackPhone: ['Terugbellen', 'Telefoonnummerveld', 'Je telefoonnummer'],
  callbackSent: ['Na het versturen', 'Titel na een terugbelverzoek', 'We bellen je terug'],
  tryLater: ['Meldingen', 'Als iets even niet kan', 'Dit kan nu even niet — probeer het later nog eens.'],
  toastBellOff: ['Meldingen', 'Als de bel uit staat', 'De deurbel staat nu uit — stel een vraagje'],
  toastRang: ['Meldingen', 'Als er aangebeld is (ook op andere schermen)', 'Er is aangebeld'],
  toastWait: ['Meldingen', 'Als de bel nog wacht ({s} = seconden)', 'Er is net aangebeld — nog {s} s'],
};
// one-click colour themes: the three status colours (dark and light) and the accent of the panel and the apps
const PALETTES = [
  { id: 'standard', name: 'Standaard', open: '#30d158', closed: '#ff453a', busy: '#ff9f0a', accent: '#30d158', light: { open: '#1f9d55', closed: '#e0352b', busy: '#e8780c' } },
  { id: 'blue', name: 'Blauw', open: '#0a84ff', closed: '#ff453a', busy: '#ff9f0a', accent: '#0a84ff', light: { open: '#0a6cd8', closed: '#e0352b', busy: '#e8780c' } },
  { id: 'ocean', name: 'Oceaan', open: '#00c2d1', closed: '#5e5ce6', busy: '#ffd60a', accent: '#00c2d1', light: { open: '#00899a', closed: '#4a48c9', busy: '#c79a00' } },
  { id: 'purple', name: 'Paars', open: '#bf5af2', closed: '#ff375f', busy: '#ffd60a', accent: '#bf5af2', light: { open: '#9a3fd0', closed: '#e0194a', busy: '#c79a00' } },
  { id: 'pink', name: 'Roze', open: '#ff6ec7', closed: '#8e8e93', busy: '#ffb340', accent: '#ff6ec7', light: { open: '#e0449f', closed: '#6e6e73', busy: '#e0892a' } },
  { id: 'sunset', name: 'Zonsondergang', open: '#ffb340', closed: '#ff375f', busy: '#bf5af2', accent: '#ff9f0a', light: { open: '#e08a10', closed: '#e0194a', busy: '#9a3fd0' } },
  { id: 'mono', name: 'Zwart-wit', open: '#ffffff', closed: '#8e8e93', busy: '#636366', accent: '#ffffff', light: { open: '#1c1c1e', closed: '#8e8e93', busy: '#636366' } },
  { id: 'contrast', name: 'Hoog contrast', open: '#00ff6a', closed: '#ff2d2d', busy: '#ffe600', accent: '#ffe600', light: { open: '#007a33', closed: '#c40000', busy: '#8a7400' } },
  { id: 'cb', name: 'Kleurenblind-vriendelijk', open: '#0072b2', closed: '#d55e00', busy: '#f0e442', accent: '#0072b2', light: { open: '#005a8c', closed: '#b34b00', busy: '#a89c00' } },
];
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

// ----- blocked visitors and the own bell sound (cleaned when loaded, so they live up here) -----
const cleanBlocked = (raw) => (Array.isArray(raw) ? raw : []).slice(0, 500).map((b) => {
  if (!b || typeof b !== 'object' || !['ip', 'nr'].includes(b.kind) || !str(b.value, 60)) return null;
  return { id: str(b.id, 20) || newId(), kind: b.kind, value: str(b.value, 60).toLowerCase(), until: Number(b.until) > 0 ? Number(b.until) : 0, reason: str(b.reason, 100), at: Number(b.at) || Date.now(), by: str(b.by, 40) };
}).filter(Boolean);
const BELL_TYPES = ['audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/ogg', 'audio/mp4', 'audio/x-m4a', 'audio/webm'];
const cleanBell = (b) => (b && typeof b === 'object' && BELL_TYPES.includes(b.mime) && /^[A-Za-z0-9+/=]{20,}$/.test(String(b.b64 || '')) && String(b.b64).length <= 560000 ? { mime: b.mime, b64: String(b.b64), at: Number(b.at) || Date.now() } : null);

// ----- layout: where each part of the door screen sits (moved by hand in "Indeling aanpassen") -----
const LAYOUT_KEYS = ['portrait', 'landscape', 'phone'];
const LAYOUT_ITEMS = ['name', 'time', 'ring', 'label', 'until', 'untilAt', 'message', 'note', 'extra', 'askTitle', 'reasons', 'actions', 'weather', 'qr'];
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
    return { ...d, ...raw, positions: cleanPositions(raw.positions), blocks: cleanBlocks(raw.blocks), blocked: cleanBlocked(raw.blocked), customBell: cleanBell(raw.customBell), power: power.clean(raw.power), alerts: Array.isArray(raw.alerts) ? raw.alerts.slice(0, 30) : [], integ: integ.clean(raw.integ), devices: Array.isArray(raw.devices) ? raw.devices.slice(0, 50) : [], sightings: Array.isArray(raw.sightings) ? raw.sightings.slice(0, 500) : [], system: cleanSystem(raw.system || {}), people: Array.isArray(raw.people) ? raw.people : [], users: Array.isArray(raw.users) ? raw.users : [], apiKeys: Array.isArray(raw.apiKeys) ? raw.apiKeys : [], sessions: Array.isArray(raw.sessions) ? raw.sessions : [], settings: toDutch(coerce(DEFAULT_SETTINGS, raw.settings)) };
  } catch {
    return d;
  }
}
let state = load();
// values that are never written to disk in plain text
function secretSlots() {
  const s = state.settings, slots = [[state, 'icsToken'], [s.mail, 'pass'], [s, 'ntfyTopic'], [s, 'webhookUrl'], [state.system, 'backupPassword']];
  if (state.integ && state.integ.lock) slots.push([state.integ.lock, 'headerValue']);
  for (const u of state.users) if (u.totp) slots.push([u.totp, 'secret']);
  if (state.rootTotp) slots.push([state.rootTotp, 'secret']);
  return slots;
}
function serializeState(omitSessions) {
  const slots = secretSlots(), plain = slots.map(([o, k]) => o[k]), sess = state.sessions;
  slots.forEach(([o, k]) => { if (typeof o[k] === 'string' && o[k]) o[k] = keys.encrypt(o[k]); });
  if (omitSessions) state.sessions = [];
  try { return JSON.stringify(state); } finally { slots.forEach(([o, k], i) => { o[k] = plain[i]; }); state.sessions = sess; }
}
function decryptSecrets() { for (const [o, k] of secretSlots()) if (typeof o[k] === 'string') o[k] = keys.decrypt(o[k]); }
decryptSecrets();
let saveTimer = null, savePending = false, lastBak = 0, saveBroken = false;
function writeState() {
  savePending = false;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(STATE_FILE + '.tmp', serializeState()); // compact, with the secrets encrypted: much faster than indented, and nobody reads this file by hand
    // the last good copy, in case anything goes wrong (at most once a minute: copying the whole file at every change is slow)
    try { if (fs.existsSync(STATE_FILE) && Date.now() - lastBak > 60e3) { fs.copyFileSync(STATE_FILE, STATE_FILE + '.bak'); lastBak = Date.now(); } } catch {}
    fs.renameSync(STATE_FILE + '.tmp', STATE_FILE);
    if (saveBroken) { saveBroken = false; setImmediate(() => resolveAlert('save')); }
  } catch (e) {
    console.error('save failed:', e.message);
    saveBroken = true;
    setImmediate(() => raise('save', `Opslaan lukt niet (${e.message}). Wijzigingen gaan verloren bij een herstart!`, { cooldownMin: 10 }));
  }
}
function save() {
  clearTimeout(saveTimer);
  savePending = true;
  saveTimer = setTimeout(writeState, 150);
}
// the last change must never be lost because the program is stopped within a fraction of a second
function flushSave() { if (savePending) { clearTimeout(saveTimer); writeState(); } }
process.on('exit', flushSave);
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { flushSave(); process.exit(0); });
let actor = ''; // who is doing the current action (shown in the activity log)
let actorRoot = false;
function log(type, text, by, root) {
  const e = { at: Date.now(), type, text: str(text, 300), by: by ?? actor, r: !!(root ?? actorRoot) };
  e.prev = state.historyHead || ''; e.h = security.hashEntry(e.prev, e); state.historyHead = e.h; // every line carries the fingerprint of the one before it
  state.history.unshift(e);
  state.history.length = Math.min(state.history.length, 500);
}
// things the admin wants to hear about at once (the lock, the emergency stop, rights, two-step codes)
function securityEvent(text) {
  log('beveiliging', text);
  notifyExternal(null, `🔐 ${state.settings.name}: ${text}`).catch(() => {});
}

// ---------- warnings: when something is wrong it is recorded, shown in the control panel and sent to the admin ----------
const alertCooldown = new Map();
function raise(kind, text, { cooldownMin = 30, notify = true } = {}) {
  const now = Date.now();
  let a = state.alerts.find((x) => x.kind === kind && !x.resolvedAt);
  if (!a) {
    a = { id: newId(), kind, text: str(text, 240), at: now, count: 1 };
    state.alerts.unshift(a); state.alerts.length = Math.min(state.alerts.length, 30);
    log('waarschuwing', text, 'systeem');
    save(); setImmediate(broadcast);
  } else { a.count++; a.text = str(text, 240); }
  if (notify && now - (alertCooldown.get(kind) || 0) > cooldownMin * 60e3) {
    alertCooldown.set(kind, now);
    const msg = `⚠ ${state.settings.name}: ${text}`;
    notifyExternal(null, msg).catch(() => {});
    try { if (mailOn() && isEmail(state.settings.mail.adminTo)) sendMail(state.settings.mail.adminTo, `Waarschuwing — ${state.settings.name}`, msg + sign()).catch(() => {}); } catch {}
  }
}
function resolveAlert(kind, quiet) {
  const a = state.alerts.find((x) => x.kind === kind && !x.resolvedAt);
  if (!a) return;
  a.resolvedAt = Date.now();
  log('waarschuwing', `Opgelost: ${a.text}`, 'systeem');
  save(); setImmediate(broadcast);
  if (!quiet) notifyExternal(null, `✔ ${state.settings.name}: opgelost — ${a.text}`).catch(() => {});
}
// a crash somewhere must not take the door down: keep running, tell the admin, and only give up when it keeps happening
const crashes = [];
function onCrash(label, e) {
  console.error(label, e && e.stack || e);
  const now = Date.now(); crashes.push(now);
  while (crashes.length && now - crashes[0] > 60e3) crashes.shift();
  try { raise('crash', `Fout in de server: ${(e && e.message) || e}`, { cooldownMin: 15 }); } catch {}
  if (crashes.length > 15) { console.error('Too many errors in a minute: stopping so that it can restart cleanly.'); flushSave(); process.exit(1); }
}
process.on('uncaughtException', (e) => onCrash('uncaughtException', e));
process.on('unhandledRejection', (e) => onCrash('unhandledRejection', e));

// ---------- what should the door show? ----------
function hoursState(now) { return schedule.hoursState(state.settings.hours, now); }

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
  const away = state.settings.away;
  if (away.enabled && /^\d{4}-\d{2}-\d{2}$/.test(away.until)) { // absence mode: closed until the end of that day, whatever else is planned
    const end = new Date(`${away.until}T23:59:59`).getTime();
    if (Number.isFinite(end) && now <= end) v = { mode: 'closed', until: end + 1000, message: away.message, source: 'away' };
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
    bellReadyAt: lastBellAt + bellCooldown(),
    mailOn: mailOn(),
    hasPeople: state.people.length > 0,
    positions: state.positions || {},
    blocks: state.blocks || [],
    weather: state.settings.weather.enabled && weather.ok ? { temp: weather.temp, code: weather.code, city: state.settings.weather.city } : null,
    bellSoundV: state.customBell ? state.customBell.at : 0,
    power: powerPending ? { action: powerPending.action, at: powerPending.at } : null, // a countdown the door screens show
    serverTime: now,
  };
}
// ---------- accounts, permissions, sessions, API keys ----------
const PERM_LABELS = {
  view: 'Status zien', status: 'Status, bericht en bezet-tijden wijzigen', inbox: 'Bezoekers zien en beantwoorden', people: 'Personenlijst beheren',
  settings: 'Instellingen wijzigen', mail: 'E-mail en meldingen instellen', export: 'Back-up maken en terugzetten', audit: 'Activiteitenlog zien',
  users: 'Gebruikers en rechten beheren', api: 'API-sleutels beheren', system: 'Systeeminstellingen',
  power: 'Computer en scherm uit- en aanzetten',
  devices: 'Microcontrollers (ESP32, Pico) laten meepraten',
  unlock: 'Het slot en de NFC-tags beheren en de deur openen',
  cameras: 'Camera’s en herkenning van personen beheren',
};
const PUBLIC_PERM_LABELS = Object.fromEntries(Object.entries(PERM_LABELS).filter(([k]) => k !== 'system')); // 'system' belongs to the main account only
const ALL_PERMS = Object.keys(PERM_LABELS);
const ROLE_PRESETS = {
  root: ALL_PERMS,
  beheerder: ['view', 'status', 'inbox', 'people', 'settings', 'mail', 'export', 'audit'],
  medewerker: ['view', 'status', 'inbox'],
  receptionist: ['view', 'inbox'], // sees and answers visitors, nothing else
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
const activeGrants = (u) => (u.grants || []).filter((g) => g.until > Date.now() && ALL_PERMS.includes(g.perm) && g.perm !== 'system');
const effectivePerms = (u) => (u.starter ? (inSetup() ? START_PERMS : EMERGENCY_PERMS) : permsOf([...(u.perms || []), ...activeGrants(u).map((g) => g.perm)]));
// The start password is made up at random for every installation (a password that is the same everywhere is the first thing an attacker tries).
// It is printed once in the console, kept in data/starter-password.txt, and shown on the start screen of the Linux image (only on that screen itself).
const STARTER_FILE = path.join(DATA_DIR, 'starter-password.txt');
function starterPassword() {
  if (process.env.DOOR_STARTER_PASSWORD) return process.env.DOOR_STARTER_PASSWORD;
  try { const t = fs.readFileSync(STARTER_FILE, 'utf8').trim(); if (t) return t; } catch {}
  const pw = crypto.randomBytes(9).toString('base64url');
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(STARTER_FILE, pw + '\n', { mode: 0o600 }); } catch {}
  return pw;
}
if (!state.seededAdmin) {
  if (!state.users.some((u) => u.username === 'admin') && ROOT_USER !== 'admin') {
    const pw = starterPassword();
    state.users.push({ id: newId(), username: 'admin', name: 'Admin', role: 'medewerker', perms: [...EMERGENCY_PERMS], hash: hashPassword(pw), factory: true, starter: true, disabled: false, createdAt: Date.now() });
    if (!process.env.DOOR_STARTER_PASSWORD) console.log(`Startaccount: admin / ${pw}   (staat ook in ${STARTER_FILE})`);
  }
  state.seededAdmin = true;
  save();
}
{ // older installations still have the well-known start password: replace it
  const st = state.users.find((u) => u.starter && u.factory);
  if (st && !process.env.DOOR_STARTER_PASSWORD && verifyPassword('admin-start-123', st.hash)) {
    const pw = starterPassword();
    st.hash = hashPassword(pw); save();
    console.log(`Het bekende startwachtwoord is vervangen. Startaccount: admin / ${pw}   (staat ook in ${STARTER_FILE})`);
  }
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
    if (ss.userId === 'root') { const r = { ...rootIdentity(), sessionId: ss.id }; r.mustSetup2fa = mustSetup2fa(r); return r; }
    const u = state.users.find((x) => x.id === ss.userId);
    if (!u || u.disabled) return null;
    const ident = { kind: 'user', userId: u.id, username: u.username, name: u.name || u.username, role: u.role, perms: effectivePerms(u), sessionId: ss.id };
    ident.mustSetup2fa = mustSetup2fa(ident);
    return ident;
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
const publicUser = (u) => ({ factory: !!u.factory, starter: !!u.starter, phase: u.starter ? (inSetup() ? 'setup' : 'emergency') : '', id: u.id, username: u.username, name: u.name, role: u.role, perms: effectivePerms(u), disabled: !!u.disabled, createdAt: u.createdAt, lastLogin: u.lastLogin || 0, grants: activeGrants(u).map((g) => ({ perm: g.perm, until: g.until })), twoStep: !!(u.totp && u.totp.enabled) });
// ----- screen lock: a 6-digit code per account; a locked session can do nothing but unlock or log out -----
const lockHashOf = (id) => (id.root ? state.rootLock : (state.users.find((x) => x.id === id.userId) || {}).lockHash) || '';
const sessionOf = (id) => state.sessions.find((x) => x.id === id.sessionId);
const MAX_LOCK_FAILS = 5;
function kick(match) { for (const c of [...clients]) if (match(c)) { try { c.res.end(); } catch {} clients.delete(c); } }
function deviceName(ua) {
  ua = String(ua || '');
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac OS X|Macintosh|Darwin/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux|X11/.test(ua) ? 'Linux' : '';
  const app = /DeurBeheerDev/.test(ua) ? 'Deur Dev' : /DeurBeheer|SagaTechbox/.test(ua) ? 'Deur Beheer' : /Edg\//.test(ua) ? 'Edge' : /OPR\/|Opera/.test(ua) ? 'Opera' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : /Electron/.test(ua) ? 'Desktop-app' : /node|fetch|undici|curl/i.test(ua) ? 'Programma' : 'Onbekend';
  return os ? `${app} op ${os}` : app;
}
// the first login from a device is remembered; a later new device is reported to the admin
function noteDevice(user, req) {
  const ua = str(req.headers['user-agent'], 120), fp = sha(ua).slice(0, 16);
  const holder = user.root ? state : state.users.find((x) => x.id === user.userId);
  if (!holder) return;
  const key = user.root ? 'rootDevices' : 'devices';
  const list = holder[key] || (holder[key] = []);
  if (list.includes(fp)) return;
  list.push(fp); if (list.length > 30) list.shift();
  if (list.length > 1) securityEvent(`${user.name} is ingelogd op een nieuw apparaat: ${deviceName(ua)} (${clientIp(req)})`);
}
function newSession(userId, req, remember) {
  const token = 's_' + crypto.randomBytes(32).toString('hex');
  state.sessions.push({ id: newId(), hash: sha(token), userId, ttl: remember ? state.system.rememberDays : state.system.sessionDays, createdAt: Date.now(), lastSeen: Date.now(), ip: clientIp(req), ua: str(req.headers['user-agent'], 120), device: deviceName(req.headers['user-agent']) });
  state.sessions = state.sessions.filter((x) => Date.now() - x.lastSeen < (x.ttl || state.system.sessionDays) * 864e5).slice(-200);
  return token;
}

// ---------- two-step verification (TOTP) ----------
const mfaTickets = new Map(); // the moment between the password and the code: five minutes, five tries
const pending2fa = new Map(); // a secret that is being set up but not yet confirmed
const totpOf = (user) => (user.root ? state.rootTotp : (state.users.find((u) => u.id === user.userId) || {}).totp);
function identityOfId(userId) {
  if (userId === 'root') return rootIdentity();
  const u = state.users.find((x) => x.id === userId && !x.disabled);
  return u ? { kind: 'user', userId: u.id, username: u.username, name: u.name || u.username, role: u.role, perms: effectivePerms(u) } : null;
}
// a code from the app (each only once) or a recovery code (each only once)
function checkSecondStep(holder, code) {
  const step = security.totp.verify(holder.secret, code, holder.lastStep || 0);
  if (step) { holder.lastStep = step; return true; }
  const norm = security.normRecovery(code);
  if (norm.length === 10) { const h = security.sha(norm), i = (holder.recovery || []).indexOf(h); if (i >= 0) { holder.recovery.splice(i, 1); securityEvent('Er is een herstelcode gebruikt om in te loggen.'); return true; } }
  return false;
}
const PRIVILEGED = ['users', 'system', 'unlock', 'api', 'export'];
// the admin can demand two-step verification for the main account, or for everyone with powerful rights
function mustSetup2fa(user) {
  const pol = state.system.require2fa;
  if (pol === 'off' || !user || user.kind !== 'user') return false;
  const holder = totpOf(user);
  if (holder && holder.enabled) return false;
  if (user.root) return true;
  return pol === 'privileged' && PRIVILEGED.some((x) => (user.perms || []).includes(x));
}
const BEFORE_2FA = new Set(['POST /api/2fa/setup', 'POST /api/2fa/enable', 'GET /api/2fa/status', 'GET /api/admin-state', 'GET /api/me', 'POST /api/password']);

// ---------- passkeys: log in with fingerprint / face / device code, no password; needs https (or localhost) and a name, not an IP address ----------
const passChallenges = new Map(); // challenge -> { until, kind, userId }
const passkeysOf = (userId) => (userId === 'root' ? state.rootPasskeys : (state.users.find((u) => u.id === userId) || {}).passkeys) || [];
function passkeyHost(req) {
  const host = String(req.headers.host || '').toLowerCase();
  const name = host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : host.split(':')[0];
  if (/^\d+\.\d+\.\d+\.\d+$/.test(name) || name.startsWith('[')) throw bad('Passkeys werken niet met een IP-adres. Open de deurserver met de naam (bijvoorbeeld https://saga-deur.local) en probeer opnieuw.');
  const secure = !!req.socket.encrypted || name === 'localhost' || /\.localhost$/.test(name);
  if (!secure) throw bad('Passkeys werken alleen met een beveiligde verbinding (https). Zet https aan bij Systeem en installeer het certificaat.');
  return { rpId: name, origins: [`${req.socket.encrypted ? 'https' : 'http'}://${host}`] };
}
function newPassChallenge(kind, userId) {
  const challenge = crypto.randomBytes(32).toString('base64url');
  passChallenges.set(challenge, { until: Date.now() + 5 * 60e3, kind, userId });
  if (passChallenges.size > 500) for (const [k, v] of passChallenges) if (v.until < Date.now()) passChallenges.delete(k);
  return challenge;
}
const takeChallenge = (c, kind) => { const t = passChallenges.get(String(c || '')); passChallenges.delete(String(c || '')); if (!t || t.until < Date.now() || t.kind !== kind) throw bad('Deze passkey-poging is verlopen. Probeer opnieuw.'); return t; };

// one-time codes with which an already logged-in device logs in another one (a QR code): valid for two minutes, usable once
const loginTickets = new Map();

// plain-language checks shown as a checklist in the control panel
let httpsOn = false; // switched on by the https part (own certificate authority)
// a score for how well this installation is protected, with a plain explanation for every line
function securityChecks() {
  const items = [];
  const add = (id, weight, ok, text, tip, fix) => items.push({ id, weight, ok: !!ok, text, tip: ok ? '' : tip, fix: ok ? '' : (fix || '') });
  const starter = state.users.find((u) => u.starter);
  add('starter', 10, !starter || starter.disabled || !starter.factory, 'Het startaccount is uit of heeft een eigen wachtwoord', 'Zet het startaccount uit als je het niet nodig hebt (alleen het hoofdaccount kan dat).', 'starter');
  add('twoStep', 20, !!(state.rootTotp && state.rootTotp.enabled), 'Het hoofdaccount heeft tweestapsverificatie', 'Zet het aan: Account → Beveiliging → Tweestapsverificatie.');
  const powerful = state.users.filter((u) => !u.disabled && !u.starter && PRIVILEGED.some((x) => permsOf(u.perms).includes(x)));
  add('twoStepOthers', 10, powerful.every((u) => u.totp && u.totp.enabled), 'Accounts met veel rechten hebben tweestapsverificatie', `Dit geldt nog niet voor: ${powerful.filter((u) => !(u.totp && u.totp.enabled)).map((u) => u.username).join(', ')}. Je kunt het verplicht stellen bij Systeem.`);
  add('https', 10, httpsOn, 'De verbinding is versleuteld (https)', 'Zet https aan bij Beveiliging (eigen certificaat, geen domein nodig).');
  add('backupEnc', 10, !!state.system.backupPassword, 'Back-ups zijn versleuteld met een wachtwoord', 'Kies een back-upwachtwoord bij Systeem (alleen het hoofdaccount).');
  const last = state.lastBackupDay ? Date.parse(state.lastBackupDay) : 0;
  add('backupFresh', 5, last && Date.now() - last < 4 * 864e5, 'Er is de laatste dagen een back-up gemaakt', 'Zet automatische back-ups aan bij Systeem, of maak er nu een.');
  add('rateLimit', 10, state.system.rateLimit !== false, 'De aanvalsbeveiliging staat aan', 'Zet de aanvalsbeveiliging aan.', 'rateLimit');
  add('secrets', 5, true, 'Wachtwoorden en sleutels staan versleuteld op de schijf', '');
  add('audit', 5, security.verifyChain(state.history).ok, 'Het logboek is niet aangepast', 'Het logboek klopt niet meer: iemand heeft het bestand bewerkt. Kijk bij Beveiliging → Logboek.');
  add('keys', 5, state.apiKeys.every((k) => !k.lastUsed || Date.now() - k.lastUsed < 90 * 864e5), 'Alle API-sleutels worden gebruikt', 'Er zijn sleutels die al maanden niet gebruikt zijn. Verwijder ze bij API-sleutels.');
  const total = items.reduce((a, i) => a + i.weight, 0), got = items.filter((i) => i.ok).reduce((a, i) => a + i.weight, 0);
  return { score: Math.round((100 * got) / total), items };
}
function healthChecks(full) {
  const s = state.settings, out = [];
  const add = (id, ok, text, tip) => out.push({ id, ok, text, tip: ok ? '' : tip });
  add('name', s.name !== 'Saga Techbox', 'De naam van de deur is ingesteld', 'Geef de deur een eigen naam bij “Deur”.');
  add('hours', !!(s.hours && s.hours.enabled), 'Openingstijden staan aan', 'Zet openingstijden aan, dan wisselt de status zelf.');
  if (full('mail')) add('notify', !!(s.ntfyTopic || s.webhookUrl || mailOn()), 'Je krijgt een melding als iemand aanbelt', 'Zet meldingen op je telefoon aan (ntfy) of stel e-mail in.');
  add('screen', [...clients].some((c) => c.role !== 'admin'), 'Er is een deurscherm verbonden', 'Open het adres van de server op het scherm bij de deur.');
  if (full('export')) add('backup', !!state.lastBackupDay, 'Er is een automatische back-up gemaakt', 'Back-ups worden ’s nachts gemaakt; ze verschijnen na de eerste nacht.');
  if (full('power') && state.power.enabled) add('wake', !!state.wakeApplied || !state.power.days || !Object.values(state.power.days).some((d) => d.off && d.on), 'De computer weet wanneer hij weer aan moet', 'Druk bij Energie op “Wekschema zetten”.');
  if (full('unlock') && state.integ.lock.enabled) add('tags', state.integ.lock.tags.length > 0 && !!state.integ.lock.url, 'Het slot heeft een webadres en kaartjes', 'Vul bij Koppelingen het webadres van het slot en minstens één kaartje in.');
  for (const a of state.alerts.filter((x) => !x.resolvedAt)) out.unshift({ id: 'alert-' + a.kind, ok: false, text: '⚠ ' + a.text, tip: `Sinds ${new Date(a.at).toLocaleString('nl-NL', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })}${a.count > 1 ? `, ${a.count}×` : ''}. Verdwijnt vanzelf zodra het weer goed gaat.`, alert: a.id });
  return out;
}
function adminState(id) {
  const full = (perm) => can(id, perm);
  const settings = { ...state.settings, mail: { ...state.settings.mail, pass: state.settings.mail.pass ? PASS_MASK : '' } };
  if (!full('mail')) { settings.mail = { enabled: settings.mail.enabled }; settings.ntfyTopic = ''; settings.ntfyServer = ''; settings.webhookUrl = ''; }
  return {
    build: BUILD,
    settings,
    uiTexts: UI_TEXTS,
    palettes: PALETTES,
    blocks: state.blocks || [],
    bellSoundV: state.customBell ? state.customBell.at : 0,
    blocked: full('inbox') ? activeBlocks() : [],
    pendingProfiles: full('inbox') ? state.people.filter((x) => x.pending).map(({ id, nr, name, email }) => ({ id, nr, name, email })) : [],
    weatherNow: state.settings.weather.enabled && weather.ok ? { temp: weather.temp, code: weather.code } : null,
    power: full('power') ? { ...state.power, available: power.available(), dry: power.dryRun(), platform: power.dryRun() && process.env.DOOR_POWER_PLATFORM ? process.env.DOOR_POWER_PLATFORM : process.platform, pi: power.isPi(), pending: powerPending, log: power.log.slice(0, 10), offHours: power.offHoursPerWeek(state.power), kwh: power.kwhPerWeek(state.power), wakeApplied: state.wakeApplied } : undefined,
    integ: full('unlock') || full('cameras') ? { ...(full('unlock') ? { lock: { ...state.integ.lock, headerValue: state.integ.lock.headerValue ? PASS_MASK : '' }, automations: state.integ.automations } : {}), ...(full('cameras') ? { cameras: state.integ.cameras, faces: state.integ.faces } : {}) } : undefined,
    devices: full('settings') || full('unlock') || full('cameras') ? state.devices : [],
    sightings: full('cameras') ? state.sightings.slice(0, 50) : [],
    health: healthChecks(full),
    security: full('settings') ? securityChecks() : undefined,
    https: full('settings') ? httpsStatus() : undefined,
    alerts: state.alerts.slice(0, 10),
    people: full('people') ? state.people : [],
    peopleRev: state.peopleRev || 0,
    mailOn: mailOn(),
    manual: state.manual,
    view: computeView(),
    busy: [...state.busy].sort((a, b) => a.from - b.from),
    appointments: [...state.appointments].sort((a, b) => a.at - b.at),
    requests: full('inbox') ? state.requests : [],
    history: full('audit') ? (full('system') ? state.history : state.history.filter((h) => !h.r && h.type !== 'systeem')) : [],
    me: { name: id.name, role: id.role, perms: id.perms, mustSetup2fa: !!id.mustSetup2fa, twoStep: !!((totpOf(id) || {}).enabled), kind: id.kind, noPw: !!id.root, canLock: !!id.sessionId, hasLock: !!lockHashOf(id) },
    permLabels: PUBLIC_PERM_LABELS, rolePresets: ASSIGNABLE,
    users: full('users') ? state.users.map(publicUser) : undefined,
    sessions: full('users') ? state.sessions.filter((x) => x.userId !== 'root' || id.root).map((x) => ({ id: x.id, userId: x.userId === 'root' ? '' : x.userId, who: x.userId === 'root' ? ROOT_USER : (state.users.find((u) => u.id === x.userId)?.name || '?'), createdAt: x.createdAt, lastSeen: x.lastSeen, ip: x.ip, ua: x.ua, current: x.id === id.sessionId })).sort((a, b) => b.lastSeen - a.lastSeen) : undefined,
    apiKeys: full('api') ? state.apiKeys.map(({ id: kid, name, prefix, perms, createdAt, lastUsed, by }) => ({ id: kid, name, prefix, perms, createdAt, lastUsed, by })) : undefined,
    server: full('users') ? { version: APP_VERSION, uptime: Math.round(process.uptime()), node: process.version, platform: `${process.platform} ${process.arch}`, dataDir: DATA_DIR, clients: clients.size, authMode: authMode(), pin: !!ADMIN_PIN } : undefined,
    system: full('system') ? maskSystem(state.system) : undefined,
    serverTime: Date.now(),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    authMode: authMode(),
  };
}
function writeRaw(c, event, json) {
  try {
    if (c.res.writableLength > 2 * 1048576) { c.res.destroy(); clients.delete(c); return; } // a client that cannot keep up must not eat the memory of the server
    c.res.write(`event: ${event}\ndata: ${json}\n\n`);
  } catch { clients.delete(c); }
}
function write(c, event, data) { writeRaw(c, event, JSON.stringify(data)); }
function broadcast() {
  const pub = JSON.stringify(publicState()); // once, not once per screen
  for (const c of [...clients]) {
    if (c.role !== 'admin') { writeRaw(c, 'state', pub); continue; }
    const id = identifyFrom(c.tok, c.pin); // still allowed? (session ended, rights changed, maintenance, network) (session ended, user disabled, rights changed)
    if (!id || gate(id, c.ip)) { try { c.res.end(); } catch {} clients.delete(c); continue; }
    write(c, 'state', adminState(id));
  }
}
let lastView = '';
function changed() { save(); lastView = JSON.stringify(computeView()); broadcast(); }
setInterval(() => { for (const c of clients) write(c, 'ping', { t: Date.now() }); }, 20000);

// ---------- outside notifications ----------
const TYPE_LABEL = { bell: 'Aangebeld', reason: 'Verzoek', appointment: 'Afspraakverzoek', message: 'Vraagje', callback: 'Terugbelverzoek' };
function describe(r) {
  const parts = [`${TYPE_LABEL[r.type]} — ${r.name || 'Iemand'} bij ${state.settings.name}`];
  if (r.nr) parts.push(`Nummer: ${r.nr}`);
  if (r.topic) parts.push(`Onderwerp: ${r.topic}`);
  if (r.reason) parts.push(`Reden: ${r.reason}`);
  if (r.at) parts.push(`Wil: ${new Date(r.at).toLocaleString('nl-NL', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`);
  if (r.phone) parts.push(`Bel terug: ${r.phone}${r.when ? ` (${r.when})` : ''}`);
  if (r.message) parts.push(`"${r.message}"`);
  if (r.flagged && r.flagged.length) parts.push(`⚠ Gemarkeerd: ${r.flagged.join(', ')}`);
  return parts.join('\n');
}
async function notifyExternal(r, textOverride, plan = { ntfy: true, webhook: true }) {
  const s = state.settings;
  const text = textOverride || describe(r);
  const jobs = [];
  if (s.ntfyTopic && plan.ntfy) {
    jobs.push(fetch(`${(s.ntfyServer || 'https://ntfy.sh').replace(/\/$/, '')}/${encodeURIComponent(s.ntfyTopic)}`, {
      method: 'POST', body: text, headers: { Title: `${s.name}: ${r ? TYPE_LABEL[r.type] : 'Deur'}`, Priority: r?.type === 'bell' ? '5' : '4', Tags: 'door' },
      signal: AbortSignal.timeout(8000),
    }));
  }
  if (s.webhookUrl && plan.webhook && outboundOk(s.webhookUrl)) {
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

// ---------- being found: apps on the same network can ask "who is a door server?" (no typing of addresses) ----------
function startDiscovery() {
  if (process.env.DOOR_DISCOVERY === 'off') return;
  try {
    const sock = require('dgram').createSocket({ type: 'udp4', reuseAddr: true });
    sock.on('error', () => { try { sock.close(); } catch {} }); // port taken or no network: simply not discoverable
    sock.on('message', (msg, rinfo) => {
      if (msg.toString('utf8').trim() !== 'SAGA-DOOR?') return;
      sock.send(Buffer.from(JSON.stringify({ app: 'saga-techbox-door', name: state.settings.name, port: PORT, version: APP_VERSION })), rinfo.port, rinfo.address);
    });
    sock.bind(Number(process.env.DOOR_DISCOVERY_PORT) || 41234);
    sock.unref();
  } catch { /* ignore */ }
}
startDiscovery();

// ---------- timers ----------
// ----- energy: the schedule, the countdown, the actions -----
let powerPending = null, powerTimer = null;
const firedPower = {};
function execPower() {
  const a = powerPending && powerPending.action;
  powerPending = null; powerTimer = null;
  if (!a) return;
  try { power.run(a); log('energie', power.dryRun() ? `(proefdraaien) ${a}` : `Uitgevoerd: ${a}`, 'systeem'); } catch (e) { log('energie', `Mislukt: ${e.message}`, 'systeem'); }
  changed();
}
function startPower(action, by) {
  const warn = state.power.warnMinutes;
  clearTimeout(powerTimer);
  powerPending = { action, at: Date.now() + warn * 60000, by };
  log('energie', `${{ computer: 'Computer uit', hibernate: 'Slaapstand', restart: 'Herstart' }[action]} over ${warn} min (${by})`, by);
  if (warn <= 0) { execPower(); return; }
  powerTimer = setTimeout(execPower, warn * 60000);
  changed();
}
function cancelPower() {
  if (!powerPending) return false;
  clearTimeout(powerTimer); powerTimer = null; powerPending = null;
  log('energie', 'Afgebroken');
  changed();
  return true;
}
function runPowerSchedule(now) {
  const p = state.power;
  if (!p.enabled || !power.available() || powerPending) return;
  for (const kind of power.dueEvents(p, now, firedPower)) {
    firedPower[kind] = power.dayKey(new Date(now));
    if (kind === 'off') {
      if (p.skipIfBusy && state.requests.some((r) => (r.state === 'new' || r.state === 'seen') && !r.reply)) { log('energie', 'Vandaag niet uitgezet: er staan nog open verzoeken', 'systeem'); continue; }
      startPower(p.how, 'schema');
    } else {
      try { power.run(kind); log('energie', `${kind === 'screenOff' ? 'Scherm uit' : 'Scherm aan'} (schema)`, 'systeem'); } catch (e) { log('energie', `Mislukt: ${e.message}`, 'systeem'); }
    }
  }
}

// ----- weather (Open-Meteo: free, no key) -----
let weather = { ok: false, temp: null, code: null, at: 0 };
const WEATHER_API = process.env.DOOR_WEATHER_API || 'https://api.open-meteo.com/v1/forecast';
const GEOCODE_API = process.env.DOOR_GEOCODE_API || 'https://geocoding-api.open-meteo.com/v1/search';
async function refreshWeather(force) {
  const w = state.settings.weather;
  if (!w.enabled || !(w.lat || w.lon)) { weather.ok = false; return; }
  if (!force && Date.now() - weather.at < 25 * 60e3) return;
  weather.at = Date.now();
  try {
    const r = await fetch(`${WEATHER_API}?latitude=${w.lat}&longitude=${w.lon}&current=temperature_2m,weather_code`, { signal: AbortSignal.timeout(8000) });
    const c = (await r.json()).current;
    if (c && Number.isFinite(c.temperature_2m)) { weather = { ok: true, temp: Math.round(c.temperature_2m), code: Number(c.weather_code) || 0, at: Date.now() }; changed(); }
  } catch { /* offline: keep what we had */ }
}

// ----- the evening summary by e-mail -----
function digestText(now = Date.now()) {
  const d0 = new Date(now); d0.setHours(0, 0, 0, 0);
  const today = state.requests.filter((r) => r.createdAt >= d0.getTime());
  const n = (t) => today.filter((r) => r.type === t).length;
  const open = today.filter((r) => !r.reply && r.state !== 'done').length;
  const flagged = today.filter((r) => r.flagged && r.flagged.length).length;
  const next = state.appointments.filter((a) => a.at > now).sort((a, b) => a.at - b.at)[0];
  const lines = [
    `Vandaag bij ${state.settings.name}:`, '',
    `• ${today.length} ${today.length === 1 ? 'bezoek' : 'bezoeken'} in totaal`,
    `• ${n('bell')} keer aangebeld, ${n('message')} vraagjes, ${n('appointment')} afspraakverzoeken, ${n('callback')} terugbelverzoeken`,
    `• ${open} nog zonder antwoord of niet afgehandeld`,
  ];
  if (flagged) lines.push(`• ${flagged} gemarkeerd door het filter voor ongepaste woorden`);
  if (next) lines.push(`• Eerstvolgende afspraak: ${new Date(next.at).toLocaleString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', hour12: false })} met ${next.name}`);
  return { subject: `Samenvatting van vandaag — ${state.settings.name}`, text: lines.join('\n') + sign() };
}
async function sendDigest() {
  const m = state.settings.mail, d = digestText();
  await sendMail(m.adminTo, d.subject, d.text);
}

function weeklyText(now = Date.now()) {
  const from = now - 7 * 864e5, week = state.requests.filter((r) => r.createdAt >= from);
  const n = (t) => week.filter((r) => r.type === t).length;
  const byDay = [0, 0, 0, 0, 0, 0, 0]; for (const r of week) byDay[new Date(r.createdAt).getDay()]++;
  const names = ['zondag', 'maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag'], busiest = byDay.indexOf(Math.max(...byDay));
  const unanswered = week.filter((r) => !r.reply && r.state !== 'done').length;
  const upcoming = state.appointments.filter((a) => a.at > now && a.at < now + 7 * 864e5).sort((a, b) => a.at - b.at);
  const lines = [`De afgelopen week bij ${state.settings.name}:`, '', `• ${week.length} ${week.length === 1 ? 'bezoek' : 'bezoeken'} in totaal`, `• ${n('bell')} keer aangebeld, ${n('message')} vraagjes, ${n('appointment')} afspraakverzoeken, ${n('callback')} terugbelverzoeken, ${n('reason')} andere verzoeken`, `• ${unanswered} bleven zonder antwoord of zijn niet afgehandeld`];
  if (week.length) lines.push(`• Drukste dag: ${names[busiest]} (${byDay[busiest]})`);
  if (upcoming.length) lines.push('', 'Afspraken komende week:', ...upcoming.map((a) => `  - ${new Date(a.at).toLocaleString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', hour12: false })} — ${a.name}`));
  return { subject: `Weekoverzicht — ${state.settings.name}`, text: lines.join('\n') + sign() };
}
function tick() {
  try { tickInner(); resolveAlert('tick', true); } catch (e) { raise('tick', `De klok van de server liep vast: ${e.message}`, { cooldownMin: 15 }); }
}
let tickN = 0, lastScreenSeen = Date.now();
function tickInner() {
  const now = Date.now();
  if (tickN++ % 12 === 0) { try { pruneMaps(now); monitors(now); } catch (e) { onCrash('monitors', e); } } // about once a minute
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
  refreshWeather(false);
  runPowerSchedule(now);
  state.blocked = state.blocked.filter((b) => !b.until || b.until > now - 864e5); // forget old, expired blocks
  for (const u of state.users) if (u.grants && u.grants.some((g) => g.until <= now)) { u.grants = u.grants.filter((g) => g.until > now); dirty = true; }
  const dg = state.settings.mail;
  if (dg.digest && mailOn() && isEmail(dg.adminTo)) {
    const d = new Date(), day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    if (state.lastDigestDay !== day && `${pad(d.getHours())}:${pad(d.getMinutes())}` >= dg.digestAt) {
      state.lastDigestDay = day; dirty = true;
      sendDigest().catch((e) => { log('mail', `Samenvatting mislukt: ${e.message}`, 'systeem'); });
    }
  }
  if (dg.weekly && mailOn() && isEmail(dg.adminTo)) {
    const d = new Date(), day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    if (d.getDay() === dg.weeklyDay && state.lastWeeklyDay !== day && `${pad(d.getHours())}:${pad(d.getMinutes())}` >= dg.digestAt) {
      state.lastWeeklyDay = day; dirty = true;
      const w = weeklyText(); sendMail(dg.adminTo, w.subject, w.text).catch((e) => { log('mail', `Weekoverzicht mislukt: ${e.message}`, 'systeem'); });
    }
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
  if (mins > 0 && (state.settings.autoReplyText || (state.settings.autoReplies || []).length)) {
    for (const r of state.requests) {
      if (!r.reply && r.state !== 'done' && now - r.createdAt > mins * 60e3 && now - r.createdAt < 3600e3) {
        r.reply = state.settings.autoReplyText || ''; r.repliedAt = now; r.autoReplied = true; dirty = true;
      }
    }
  }
  if (dirty) return changed();
  const v = JSON.stringify(computeView(now));
  if (v !== lastView) { lastView = v; broadcast(); } // e.g. a busy block or opening hours just started
}
setInterval(tick, 5000);

// the per-address tables must not grow for ever (one entry per visitor address would be a slow memory leak)
function pruneMaps(now) {
  const cut = (m, ms) => { for (const [k, v] of m) { const arr = Array.isArray(v) ? v : [v]; if (!arr.some((t) => now - t < ms)) m.delete(k); } };
  cut(failures, state.system.blockMinutes * 60e3); cut(visitLog, 3600e3); cut(lastVisit, 3600e3); cut(lookups, 60e3); cut(profileHits, 3600e3);
  if (alertCooldown.size > 100) alertCooldown.clear();
  pruneSecurity(now);
  for (const [k, t] of loginTickets) if (t.until < now) loginTickets.delete(k);
  for (const [k, t] of mfaTickets) if (t.until < now) mfaTickets.delete(k);
}
// quiet self-checks: disk, memory, event-loop delay, and (if wanted) a door screen that has gone away
function monitors(now) {
  try {
    const st = fs.statfsSync(DATA_DIR);
    const free = st.bavail * st.bsize, pct = st.blocks ? st.bavail / st.blocks : 1;
    if (free < 200 * 1048576 || pct < 0.03) raise('disk', `De schijf is bijna vol (${Math.round(free / 1048576)} MB vrij). Opslaan en back-ups kunnen mislukken.`, { cooldownMin: 360 });
    else if (free > 400 * 1048576 && pct > 0.05) resolveAlert('disk');
  } catch { /* old Node or no access: skip */ }
  const rss = process.memoryUsage().rss;
  if (rss > 900 * 1048576) raise('memory', `De server gebruikt veel geheugen (${Math.round(rss / 1048576)} MB). Een herstart kan helpen.`, { cooldownMin: 360 });
  else if (rss < 650 * 1048576) resolveAlert('memory', true);
  if (httpsInfo && httpsServer && Date.parse(httpsInfo.expires) - Date.now() < 20 * 864e5) { try { httpsInfo = pki.ensure(path.join(DATA_DIR, 'tls'), 'Saga Techbox'); httpsServer.setSecureContext({ key: httpsInfo.key, cert: httpsInfo.cert + httpsInfo.caPem }); log('beveiliging', 'Het servercertificaat is vernieuwd', 'systeem'); } catch {} }
  if (maxLag > 2000) raise('lag', `De server reageerde ${Math.round(maxLag)} ms te laat. De computer is overbelast.`, { cooldownMin: 120, notify: false });
  else if (maxLag < 300) resolveAlert('lag', true);
  maxLag = 0;
  const screens = [...clients].filter((c) => c.role !== 'admin' && !c.visit).length;
  if (screens > 0) { lastScreenSeen = now; resolveAlert('screen'); }
  const mins = Number(state.settings.watch && state.settings.watch.screenMinutes) || 0;
  if (mins > 0 && now - lastScreenSeen > mins * 60e3) raise('screen', `Er is al ${Math.round((now - lastScreenSeen) / 60e3)} minuten geen deurscherm verbonden. Staat het scherm uit of is het netwerk weg?`, { cooldownMin: 120 });
}
let maxLag = 0, lagLast = Date.now();
setInterval(() => { const n = Date.now(); maxLag = Math.max(maxLag, n - lagLast - 1000); lagLast = n; }, 1000).unref();

// ---------- security: flood protection (DDoS), ban list, connection limits ----------
// Every address gets a bucket of requests that refills steadily. A burst is fine (a page loads a dozen files), a flood is answered with "429 slow down",
// and an address that keeps hammering is put on a ban list for ten minutes (answered in a few bytes, before anything else is done).
const RATE = {
  get burst() { return Number(process.env.DOOR_RATE_BURST) || state.system.attack.burst; },
  get perSec() { return Number(process.env.DOOR_RATE_PER_SEC) || state.system.attack.perSec; },
  get strikes() { return state.system.attack.strikes; },
  get banMs() { return state.system.attack.banMinutes * 60e3; },
  get maxSse() { return Number(process.env.DOOR_MAX_SSE) || state.system.attack.maxSse; },
};
const buckets = new Map(), bans = new Map(), strikes = new Map();
const isLoopback = (ip) => ip === '127.0.0.1' || ip === '::1';
function limited(ip, cost = 1) {
  if (state.system.rateLimit === false || process.env.DOOR_RATE_LIMIT === 'off') return 0;
  if ((isLoopback(ip) && process.env.DOOR_RATE_TEST !== '1') || ip === 'proxied') return 0; // this computer itself; behind a proxy without TRUST_PROXY every visitor looks the same, so no limiting is possible there
  const now = Date.now();
  const ban = bans.get(ip);
  if (ban) { if (now < ban) return Math.ceil((ban - now) / 1000); bans.delete(ip); }
  let b = buckets.get(ip);
  if (!b) { b = { tokens: RATE.burst, at: now }; buckets.set(ip, b); }
  b.tokens = Math.min(RATE.burst, b.tokens + ((now - b.at) / 1000) * RATE.perSec); b.at = now;
  if (b.tokens >= cost) { b.tokens -= cost; return 0; }
  const list = (strikes.get(ip) || []).filter((t) => now - t < 60e3); list.push(now); strikes.set(ip, list);
  if (list.length >= RATE.strikes) {
    bans.set(ip, now + RATE.banMs); strikes.delete(ip);
    log('beveiliging', `${ip} is voor ${Math.round(RATE.banMs / 60e3)} minuten geblokkeerd: te veel verzoeken`, 'systeem');
    raise('attack', `Een apparaat (${ip}) stuurde veel te veel verzoeken en is ${Math.round(RATE.banMs / 60e3)} minuten geblokkeerd. Dit lijkt op een aanval of een kapotte app.`, { cooldownMin: 60 });
    return Math.ceil(RATE.banMs / 1000);
  }
  return 2;
}
// failed logins per user name, from anywhere: slows down guessing by many addresses at once (without locking the real owner out)
const userFails = new Map();
function loginDelayMs(username) {
  const now = Date.now(), list = (userFails.get(username) || []).filter((t) => now - t < 10 * 60e3);
  return Math.min(5000, 400 + list.length * 300);
}
function noteUserFail(username) {
  const now = Date.now(), list = (userFails.get(username) || []).filter((t) => now - t < 10 * 60e3); list.push(now); userFails.set(username, list);
  if (list.length === 25) raise('guessing', `Iemand probeert veel wachtwoorden voor “${username}” (25 mislukte pogingen in 10 minuten).`, { cooldownMin: 60 });
}
// the most used passwords are refused for new accounts
const COMMON_PW = new Set(['password', 'wachtwoord', '12345678', '123456789', '1234567890', 'qwertyui', 'qwerty123', 'admin123', 'admin-start-123', 'welkom123', 'welkom01', 'password1', 'password123', 'iloveyou', 'letmein1', 'abcd1234', '11111111', '00000000', 'saga1234', 'techbox1']);
// outgoing calls (webhook, ntfy, lock, camera) may go to your own network, but never to the cloud “metadata” address that holds secrets
function outboundOk(u) {
  try { const x = new URL(u); const h = x.hostname.toLowerCase(); return (x.protocol === 'http:' || x.protocol === 'https:') && !/^169\.254\./.test(h) && h !== 'metadata.google.internal' && h !== '0.0.0.0' && !h.startsWith('fd00:ec2'); } catch { return false; }
}
function pruneSecurity(now) {
  for (const [ip, b] of buckets) if (now - b.at > 120e3) buckets.delete(ip);
  for (const [ip, t] of bans) if (now > t) bans.delete(ip);
  for (const [ip, l] of strikes) if (!l.some((t) => now - t < 60e3)) strikes.delete(ip);
  for (const [u, l] of userFails) if (!l.some((t) => now - t < 10 * 60e3)) userFails.delete(u);
}

// ---------- HTTP ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
// what to do next, in plain words, next to an error
function hintFor(code) {
  return ({ 401: 'Log opnieuw in.', 403: 'Vraag de beheerder om dit recht, of probeer het met een ander account.', 423: 'Ontgrendel eerst met je code.', 429: 'Wacht even en probeer het dan opnieuw.', 500: 'Probeer het opnieuw. Blijft het misgaan, kijk dan in het logboek of herstart de server.', 503: 'Het paneel staat in onderhoud. Probeer het later opnieuw.' })[code] || '';
}
function send(res, code, obj) {
  if (code >= 400 && obj && obj.error && !obj.hint) { const h = hintFor(code); if (h) obj = { ...obj, hint: h }; }
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > 1024 * 1024) { reject(new Error('Te groot')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8'), (k, v) => (k === '__proto__' || k === 'constructor' || k === 'prototype' ? undefined : v)) : {}); } catch { reject(new Error('Ongeldig verzoek')); } });
    req.on('error', reject);
  });
}
// pages are compressed once and kept in memory; the browser asks "has it changed?" and gets a tiny 304 answer (much faster on wifi and on a Pi)
const fileCache = new Map();
function serveFile(res, file, req) {
  const full = path.normalize(path.join(PUBLIC_DIR, file));
  if (!full.startsWith(PUBLIC_DIR + path.sep)) return send(res, 404, { error: 'Niet gevonden' });
  let st; try { st = fs.statSync(full); } catch { return send(res, 404, { error: 'not found' }); }
  if (!st.isFile()) return send(res, 404, { error: 'not found' });
  let e = fileCache.get(full);
  if (!e || e.mtime !== st.mtimeMs) {
    let buf; try { buf = fs.readFileSync(full); } catch { return send(res, 404, { error: 'not found' }); }
    const type = MIME[path.extname(full)] || 'application/octet-stream';
    const compress = /^(text\/|application\/(json|javascript)|image\/svg)/.test(type) && buf.length > 1024;
    let csp = '';
    if (type.startsWith('text/html')) csp = security.pageCsp(buf.toString('utf8')); // strict: only the scripts and styles that are in the file itself (by fingerprint) and our own files run; nothing injected can
    e = { csp, mtime: st.mtimeMs, type, etag: '"' + crypto.createHash('sha1').update(buf).digest('hex').slice(0, 16) + '"', raw: buf, gz: compress ? zlib.gzipSync(buf, { level: 6 }) : null };
    fileCache.set(full, e);
  }
  const headers = { 'Content-Type': e.type, 'Cache-Control': 'no-cache', ETag: e.etag, Vary: 'Accept-Encoding' };
  if (e.csp) headers['Content-Security-Policy'] = e.csp;
  if (req && req.headers['if-none-match'] === e.etag) { res.writeHead(304, headers); return res.end(); }
  const gz = e.gz && req && /\bgzip\b/.test(String(req.headers['accept-encoding'] || ''));
  if (gz) headers['Content-Encoding'] = 'gzip';
  res.writeHead(200, headers);
  res.end(gz ? e.gz : e.raw);
}
const bad = (msg) => Object.assign(new Error(msg), { code: 400 });
const findReq = (id) => { const r = state.requests.find((x) => x.id === id); if (!r) throw bad('Dat verzoek bestaat niet meer'); return r; };

// ---------- https with an own certificate authority ----------
let httpsServer = null, httpsInfo = null;
const HOSTLESS = process.env.HOST || undefined;
function tuneTimeouts(srv) { srv.headersTimeout = Number(process.env.DOOR_HEADER_TIMEOUT_MS) || 15000; srv.requestTimeout = Math.max(srv.headersTimeout, 30000); srv.keepAliveTimeout = 5000; srv.maxHeadersCount = 60; }
function applyHttps() {
  const want = state.system.https && process.env.DOOR_HTTPS !== 'off';
  if (!want) { if (httpsServer) { try { httpsServer.close(); httpsServer.closeAllConnections(); } catch {} } httpsServer = null; httpsOn = false; return; }
  if (httpsServer) return;
  try {
    httpsInfo = pki.ensure(path.join(DATA_DIR, 'tls'), 'Saga Techbox');
    const srv = https.createServer({ key: httpsInfo.key, cert: httpsInfo.cert + httpsInfo.caPem, connectionsCheckingInterval: 2000 }, handle);
    tuneTimeouts(srv);
    srv.on('error', (e) => { httpsOn = false; httpsServer = null; raise('https', e.code === 'EADDRINUSE' ? `Poort ${state.system.httpsPort} voor https is al in gebruik.` : `Https kon niet starten: ${e.message}`, { cooldownMin: 360 }); });
    srv.listen(state.system.httpsPort, HOSTLESS, () => { httpsOn = true; resolveAlert('https', true); console.log(`Veilig (https) op poort ${state.system.httpsPort}`); });
    httpsServer = srv;
  } catch (e) { raise('https', `Https kon niet starten: ${e.message}`, { cooldownMin: 360 }); }
}
function httpsStatus() {
  const on = !!httpsServer && httpsOn;
  const info = httpsInfo || (state.system.https ? null : null);
  return { enabled: !!state.system.https, running: on, port: state.system.httpsPort, fingerprint: info ? info.caFingerprint : '', names: info ? info.names : pki.namesFor(), expires: info ? info.expires : '', urls: on ? lanNames().map((h) => `https://${h}:${state.system.httpsPort}`) : [] };
}
const lanNames = () => [`saga-deur.local`, ...Object.values(os.networkInterfaces()).flat().filter((a) => a && a.family === 'IPv4' && !a.internal).map((a) => a.address)];

// the addresses at which this server can be reached (shown on the start screen of the Linux image)
function where(local) {
  const addresses = [];
  for (const list of Object.values(os.networkInterfaces())) for (const a of list || []) if (a.family === 'IPv4' && !a.internal) addresses.push(`http://${a.address}:${PORT}`);
  const out = { name: state.settings.name, hostname: os.hostname(), port: PORT, version: APP_VERSION, https: httpsOn ? { port: state.system.httpsPort, urls: lanNames().map((h) => `https://${h}:${state.system.httpsPort}`) } : null, addresses, mdns: `http://${os.hostname()}.local:${PORT}` };
  // the start password is only handed out to a screen on this computer itself (the start screen of the Linux image), never over the network
  if (local && state.users.some((u) => u.starter && u.factory && !u.disabled)) out.starter = { user: 'admin', password: starterPassword() };
  return out;
}
// what a small device needs to know about the door
function doorBrief() {
  const v = computeView();
  return { mode: v.mode, label: state.settings.texts[v.mode] ? state.settings.texts[v.mode].label : v.mode, message: v.message || '', color: ({ open: '#30d158', closed: '#ff453a', busy: '#ff9f0a' })[v.mode] || '#ffffff', until: v.until || null };
}
// one thing to do, from a rule or a person's settings
async function runAction(a, why, by) {
  if (a.status) {
    const now = Date.now(), until = a.minutes > 0 ? now + a.minutes * 60e3 : null;
    state.manual = { mode: a.status, until, message: a.message || '', setAt: now, expiresAt: null };
    log('koppeling', `${why}: status ${a.status}`, by);
  } else if (a.message) { log('koppeling', `${why}: ${a.message}`, by); }
  if (a.notify || a.bell) notifyExternal(null, `${why}${a.message ? ' — ' + a.message : ''}`).catch(() => {});
  if (a.unlock) { try { await integ.unlock(state.integ); log('slot', `${why}: deur geopend`, by); } catch (e) { log('slot', `${why}: slot opende niet (${e.message})`, by); } }
}
async function fireAutomations(source, key, event, by) {
  for (const rule of integ.matching(state.integ, source, key, event)) await runAction(source === 'camera' ? { ...rule.do, unlock: false } : rule.do, rule.name, by);
}

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
    if (password && (COMMON_PW.has(password.toLowerCase()) || password.toLowerCase() === username || /^(.)\1+$/.test(password))) throw bad('Dat wachtwoord is veel te makkelijk te raden. Kies iets anders.');
    if (password && password.length < 8) throw bad('Wachtwoord: minstens 8 tekens');
    const u = existing || { id: newId(), createdAt: Date.now(), hash: '' };
    if (existing && id.userId === existing.id && (b.disabled || !perms.includes('users'))) throw bad('Je kunt jezelf niet uitschakelen of je beheerrechten afnemen');
    Object.assign(u, { username, name: str(b.name, 60) || username, role, perms, disabled: !!b.disabled });
    if (Array.isArray(b.grants)) { // temporary rights: "this permission, for this many minutes"; nobody can hand out more than they have
      const list = [];
      for (const g of b.grants.slice(0, 20)) {
        const perm = str(g && g.perm, 20), minutes = Math.round(Number(g && g.minutes));
        if (!ALL_PERMS.includes(perm) || perm === 'system' || !(minutes > 0)) continue;
        if (!can(id, perm)) throw bad('Je kunt geen rechten geven die je zelf niet hebt');
        list.push({ perm, until: Date.now() + Math.min(minutes, 60 * 24 * 30) * 60e3 });
      }
      u.grants = list;
      if (list.length) securityEvent(`${id.name} gaf ${u.username} tijdelijk extra rechten: ${list.map((g) => g.perm).join(', ')}`);
    }
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
    for (const m of MODES) if (!/^#[0-9a-f]{6}$/i.test(String(merged.colorsLight[m]))) merged.colorsLight[m] = '';
    if (!/^#[0-9a-f]{6}$/i.test(String(merged.accent))) merged.accent = '';
    if (merged.palette !== 'custom' && !PALETTES.some((x) => x.id === merged.palette)) merged.palette = 'standard';
    merged.form = sanitizeForm(merged.form);
    merged.hours = { ...merged.hours, ...schedule.cleanHoursExtra('hours' in b ? b.hours : merged.hours) };
    for (const [k, fn] of [['customButtons', schedule.cleanCustomButtons], ['notifyRules', schedule.cleanNotifyRules], ['autoReplies', schedule.cleanAutoReplies]]) merged[k] = fn(k in b ? b[k] : state.settings[k]);
    merged.mail.weekly = !!merged.mail.weekly; merged.mail.weeklyDay = Math.max(0, Math.min(6, Math.round(Number(merged.mail.weeklyDay)) || 0));
    const mo = merged.moderation;
    if (!['flag', 'mask', 'block'].includes(mo.action)) mo.action = 'mask';
    mo.maxPerHour = Math.max(1, Math.min(500, Math.round(Number(mo.maxPerHour)) || 20));
    mo.words = str(mo.words, 500);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(merged.away.until)) merged.away.until = '';
    merged.away.message = str(merged.away.message, 140);
    const wx = merged.weather;
    wx.lat = Math.max(-90, Math.min(90, Number(wx.lat) || 0)); wx.lon = Math.max(-180, Math.min(180, Number(wx.lon) || 0)); wx.city = str(wx.city, 80);
    if (merged.qr.url && !/^https?:\/\/[^\s"'<>]{3,300}$/.test(merged.qr.url)) merged.qr.url = '';
    if (!BELL_TONES.includes(merged.sound.bell) || (merged.sound.bell === 'custom' && !state.customBell)) merged.sound.bell = 'classic';
    if (!REPLY_TONES.includes(merged.sound.reply)) merged.sound.reply = 'soft';
    merged.sound.custom = !!state.customBell; // set by uploading, never by the browser
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(merged.mail.digestAt)) merged.mail.digestAt = '18:00';
    // tidy the mail settings so a small slip does not break sending
    const mm = merged.mail;
    for (const k of ['host', 'user', 'from', 'adminTo']) mm[k] = String(mm[k] || '').trim();
    mm.pass = String(mm.pass || '').trim();
    if (/^[a-z]{4}( [a-z]{4}){3}$/i.test(mm.pass)) mm.pass = mm.pass.replace(/ /g, ''); // Google shows app passwords with spaces
    if (mm.pass && !mm.user) mm.user = addrOf(mm.from); // almost every provider logs in with the e-mail address
    if (mm.notifyAdmin && !mm.adminTo) mm.adminTo = addrOf(mm.from);
    state.settings = merged;
    if (merged.weather.enabled) { weather.at = 0; setTimeout(() => refreshWeather(true), 0); }
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
  'POST /api/requests/delete': (b) => { findReq(b.id); state.requests = state.requests.filter((r) => r.id !== b.id); log('moderatie', 'Een bericht verwijderd'); },

  // ----- moderation (permission: inbox) -----
  'POST /api/moderation/block': (b) => {
    const mins = Math.max(0, Math.min(525600, Number(b.minutes) || 0)); // 0 = for ever
    const until = mins ? Date.now() + mins * 60e3 : 0;
    const targets = [];
    let who = '';
    if (b.id) {
      const r = findReq(b.id);
      who = r.name || 'bezoeker';
      if (r.nr) targets.push(['nr', String(r.nr).toLowerCase()]);
      if (r.via === 'phone' && personalIp(r.ip)) targets.push(['ip', normIp(r.ip)]);
      if (!targets.length) throw bad('Dit bericht komt van het deurscherm zelf. Daar kun je niemand mee blokkeren, want iedereen gebruikt dat scherm. Je kunt het bericht wel verwijderen, of de bezoeker een profiel laten maken zodat je dat profiel kunt blokkeren.');
    } else if (b.nr) { who = str(b.nr, 20); targets.push(['nr', who.toLowerCase()]); }
    else throw bad('Er is niets om te blokkeren');
    for (const [kind, value] of targets) {
      state.blocked = state.blocked.filter((x) => !(x.kind === kind && x.value === value));
      state.blocked.push({ id: newId(), kind, value, until, reason: str(b.reason, 100) || who, at: Date.now(), by: actor });
    }
    log('moderatie', `${who} geblokkeerd${until ? ` tot ${hm(until)}` : ' voor altijd'}`);
  },
  'POST /api/moderation/unblock': (b) => { state.blocked = state.blocked.filter((x) => x.id !== b.id); log('moderatie', 'Blokkade opgeheven'); },
  'POST /api/moderation/profile': (b) => {
    const x = state.people.find((y) => y.id === b.id && y.pending);
    if (!x) throw bad('Dat profiel wacht niet meer op goedkeuring');
    if (b.approve) { delete x.pending; log('moderatie', `Profiel van ${x.name} goedgekeurd`); }
    else { state.people = state.people.filter((y) => y !== x); log('moderatie', `Profiel van ${x.name} afgewezen`); }
    state.peopleRev = (state.peopleRev || 0) + 1;
  },

  // ----- weather, own bell sound, evening summary -----
  // ----- energy (permission: power) -----
  'POST /api/power/settings': (b) => { state.power = power.clean(b); log('energie', state.power.enabled ? 'Energieschema opgeslagen' : 'Energiebeheer uit'); },
  'POST /api/power/now': (b) => {
    if (!state.power.enabled) throw bad('Zet energiebeheer eerst aan');
    if (!power.available()) throw bad('Energiebeheer staat uit op deze server');
    if (powerPending) throw bad('Er loopt al een afteltijd. Breek die eerst af.');
    if (b.action === 'screenOff' || b.action === 'screenOn') { try { power.run(b.action); } catch (e) { throw bad(e.message); } log('energie', b.action === 'screenOff' ? 'Scherm uit (handmatig)' : 'Scherm aan (handmatig)'); return; }
    if (!['computer', 'hibernate', 'restart'].includes(b.action)) throw bad('Onbekende actie');
    startPower(b.action, actor || 'beheerder');
  },
  'POST /api/power/cancel': () => { if (!cancelPower()) throw bad('Er loopt niets af'); },
  'POST /api/power/wake/apply': async () => {
    let r;
    try { r = power.applyWake(state.power, process.env.DOOR_APP_EXE || ''); } catch (e) { throw bad(e.message); }
    if (r.ok) { state.wakeApplied = Date.now(); log('energie', 'Wekschema op deze computer gezet'); }
    return r;
  },
  'POST /api/power/wake/remove': async () => { const r = power.removeWake(); if (r.ok) { state.wakeApplied = 0; log('energie', 'Wekschema van deze computer gehaald'); } return r; },
  'GET /api/power/wake-status': () => power.wakeStatus(),
  'POST /api/power/wol': async (b) => {
    const t = state.power.wol[Number(b.index)];
    if (!t) throw bad('Dat apparaat staat niet in de lijst');
    try { await power.sendWol(t.mac); } catch (e) { throw bad(`Versturen mislukt: ${e.message}`); }
    log('energie', `Wakker gemaakt via netwerk: ${t.name || t.mac}`);
    return { ok: true };
  },


  // ----- microcontrollers, door lock + NFC, cameras (permissions: devices, unlock, cameras) -----
  'POST /api/device/report': async (b, id) => {
    const name = str(b.device, 40) || id.name;
    let d = state.devices.find((x) => x.name === name);
    if (!d) { if (state.devices.length >= 50) throw bad('Te veel apparaten'); d = { id: newId(), name, first: Date.now() }; state.devices.push(d); log('koppeling', `Nieuw apparaat: ${name}`, id.name); }
    d.lastSeen = Date.now(); d.ip = id.ip || ''; d.last = { event: str(b.event, 40), value: b.value == null ? '' : str(b.value, 60) };
    if (b.battery != null) d.battery = Math.max(0, Math.min(100, Math.round(Number(b.battery)))) || 0;
    await fireAutomations('device', name, str(b.event, 40), id.name);
    return { ok: true, ...doorBrief() };
  },
  'GET /api/device/poll': (b, id, url) => {
    const name = str(url.searchParams.get('device'), 40);
    const d = name && state.devices.find((x) => x.name === name);
    if (d) d.lastSeen = Date.now();
    return { ok: true, ...doorBrief() };
  },
  'POST /api/door/tag': async (b, id) => {
    const uid = integ.normUid(b.uid);
    const v = integ.tagVerdict(state.integ, uid);
    if (!v.ok) { log('slot', `Tag ${uid.slice(0, 4)}… geweigerd: ${v.why}`, id.name); return { ok: true, allowed: false, why: v.why }; }
    try { await integ.unlock(state.integ); } catch (e) { log('slot', `Slot opende niet: ${e.message}`, id.name); throw bad(e.message); }
    log('slot', `${v.tag.name || 'Tag'} opende de deur`, id.name);
    await fireAutomations('tag', v.tag.name || uid, 'scan', id.name);
    return { ok: true, allowed: true, name: v.tag.name };
  },
  'POST /api/door/rfid': (b, id) => adminRoutes['POST /api/door/tag'](b, id),
  'POST /api/door/unlock': async (b, id) => {
    if (!state.integ.lock.enabled || !state.integ.lock.url) throw bad('Het slot is nog niet ingesteld');
    try { await integ.unlock(state.integ); } catch (e) { throw bad(e.message); }
    log('slot', 'Deur geopend vanuit het paneel', id.name);
    return { ok: true };
  },
  'POST /api/integrations/save': (b) => {
    const cur = state.integ, raw = { ...cur };
    if (b.lock) { raw.lock = { ...b.lock }; if (raw.lock.headerValue === PASS_MASK) raw.lock.headerValue = cur.lock.headerValue; }
    if (b.automations) raw.automations = b.automations;
    if (b.cameras) raw.cameras = b.cameras;
    if (b.faces) raw.faces = b.faces;
    state.integ = integ.clean(raw);
    log('koppeling', 'Koppelingen opgeslagen');
  },
  // ----- two-step verification, devices and security (everyone for their own account) -----
  'GET /api/2fa/status': (b, id) => { const h = totpOf(id) || {}; return { enabled: !!h.enabled, recoveryLeft: (h.recovery || []).length, required: state.system.require2fa !== 'off' && (id.root || state.system.require2fa === 'privileged') }; },
  'POST /api/2fa/setup': (b, id) => {
    if (id.kind !== 'user') throw bad('Dit kan alleen met een gewoon account.');
    if ((totpOf(id) || {}).enabled) throw bad('Tweestapsverificatie staat al aan.');
    const secret = security.totp.newSecret();
    pending2fa.set(id.userId, secret);
    return { secret, uri: security.totp.uri(id.username || id.name, state.settings.name || 'Saga Techbox', secret) };
  },
  'POST /api/2fa/enable': (b, id) => {
    const secret = pending2fa.get(id.userId);
    if (!secret) throw bad('Begin opnieuw met “Instellen”.');
    const step = security.totp.verify(secret, b.code, 0);
    if (!step) throw bad('Die code klopt niet. Let op: de code verandert elke 30 seconden.');
    const codes = security.recoveryCodes(8);
    const holder = { secret, enabled: true, lastStep: step, recovery: codes.map((c) => security.sha(security.normRecovery(c))) };
    if (id.root) state.rootTotp = holder; else state.users.find((u) => u.id === id.userId).totp = holder;
    pending2fa.delete(id.userId);
    securityEvent(`${id.name} heeft tweestapsverificatie aangezet.`);
    return { ok: true, recovery: codes };
  },
  'POST /api/2fa/disable': (b, id) => {
    const h = totpOf(id);
    if (!h || !h.enabled) throw bad('Tweestapsverificatie staat niet aan.');
    const pwOk = id.root ? verifyPassword(String(b.password || ''), ROOT_HASH) : verifyPassword(String(b.password || ''), (state.users.find((u) => u.id === id.userId) || {}).hash);
    if (!pwOk) throw bad('Je wachtwoord klopt niet.');
    if (!checkSecondStep(h, b.code)) throw bad('Die code klopt niet.');
    if (id.root) state.rootTotp = null; else delete state.users.find((u) => u.id === id.userId).totp;
    securityEvent(`${id.name} heeft tweestapsverificatie uitgezet.`);
  },
  'POST /api/2fa/recovery': (b, id) => {
    const h = totpOf(id);
    if (!h || !h.enabled) throw bad('Tweestapsverificatie staat niet aan.');
    if (!security.totp.verify(h.secret, b.code, h.lastStep || 0)) throw bad('Die code klopt niet.');
    const codes = security.recoveryCodes(8); h.recovery = codes.map((c) => security.sha(security.normRecovery(c)));
    log('beveiliging', `${id.name} maakte nieuwe herstelcodes`);
    return { ok: true, recovery: codes };
  },
  'GET /api/passkeys': (b, id) => ({ passkeys: passkeysOf(id.userId).map((k) => ({ id: k.id, name: k.name, created: k.created, lastUsed: k.lastUsed || 0 })) }),
  'POST /api/passkeys/options': (b, id) => {
    if (id.kind !== 'user') throw bad('Dit kan alleen met een gewoon account.');
    const { rpId } = passkeyHost(id.req);
    return { challenge: newPassChallenge('create', id.userId), rpId, rpName: state.settings.name || 'Saga Techbox', user: { id: crypto.createHash('sha256').update('saga:' + id.userId).digest().toString('base64url'), name: id.username, displayName: id.name }, exclude: passkeysOf(id.userId).map((k) => k.id) };
  },
  'POST /api/passkeys/add': (b, id) => {
    const host = passkeyHost(id.req); takeChallenge(b.challenge, 'create');
    let r; try { r = security.passkey.verifyRegistration(b, { challenge: b.challenge, ...host }); } catch (e) { throw bad(e.message); }
    const holder = id.root ? state : state.users.find((u) => u.id === id.userId);
    const list = id.root ? (state.rootPasskeys = state.rootPasskeys || []) : (holder.passkeys = holder.passkeys || []);
    if (list.length >= 10) throw bad('Je kunt maximaal 10 passkeys hebben.');
    if (state.users.some((u) => (u.passkeys || []).some((k) => k.id === r.id)) || state.rootPasskeys.some((k) => k.id === r.id)) throw bad('Deze passkey is al in gebruik.');
    list.push({ id: r.id, publicKey: r.publicKey, signCount: r.signCount, name: str(b.name, 40) || deviceName(id.req.headers['user-agent'] || ''), created: Date.now(), lastUsed: 0, rpId: host.rpId });
    securityEvent(`${id.name} heeft een passkey toegevoegd.`);
    return { ok: true };
  },
  'POST /api/passkeys/remove': (b, id) => {
    const list = passkeysOf(id.userId), i = list.findIndex((k) => k.id === b.id);
    if (i < 0) throw bad('Deze passkey bestaat niet.');
    list.splice(i, 1);
    securityEvent(`${id.name} heeft een passkey verwijderd.`);
    return { ok: true };
  },
  'GET /api/my/sessions': (b, id) => ({ sessions: state.sessions.filter((x) => x.userId === id.userId).sort((a, c) => c.lastSeen - a.lastSeen).map((x) => ({ id: x.id, device: x.device || deviceName(x.ua), ip: x.ip, createdAt: x.createdAt, lastSeen: x.lastSeen, current: x.id === id.sessionId })) }),
  'POST /api/my/sessions/revoke': (b, id) => {
    const gone = state.sessions.filter((x) => x.userId === id.userId && x.id !== id.sessionId && (b.others ? true : x.id === b.id));
    state.sessions = state.sessions.filter((x) => !gone.includes(x));
    kick((c) => gone.some((g) => g.id === c.sessionId));
    log('beveiliging', `${id.name} beëindigde ${gone.length} eigen sessie(s)`);
    return { ok: true, ended: gone.length };
  },
  'GET /api/security/bans': () => {
    const now = Date.now();
    return { bans: [...bans].filter(([, t]) => t > now).map(([ip, until]) => ({ ip, until })), lockouts: [...failures].map(([ip]) => ({ ip, tries: recentFails(ip).length })).filter((x) => x.tries >= state.system.maxAttempts), attack: state.system.attack };
  },
  'POST /api/security/unban': (b) => { const ip = str(b.ip, 60); bans.delete(ip); buckets.delete(ip); strikes.delete(ip); failures.delete(ip); log('beveiliging', `Blokkade van ${ip} opgeheven`); },
  'POST /api/security/ban': (b, id) => {
    const ip = str(b.ip, 60);
    if (!validIpRule(ip) || ip.includes('/')) throw bad('Dat is geen geldig adres.');
    if (ip === id.ip || isLoopback(ip)) throw bad('Je kunt jezelf niet blokkeren.');
    bans.set(ip, Date.now() + clampInt(b.minutes, 1, 1440 * 30, 60) * 60e3); log('beveiliging', `${ip} is handmatig geblokkeerd`);
  },
  'GET /api/audit/verify': () => ({ ...security.verifyChain(state.history), lines: state.history.length }),
  'GET /api/audit/export': (b, id, url) => {
    const rows = state.history.filter((h) => id.root || (!h.r && h.type !== 'systeem'));
    if (url.searchParams.get('format') === 'json') return { __file: { name: 'logboek.json', text: JSON.stringify(rows, null, 2) } };
    const q = (t) => '"' + String(t).replace(/"/g, '""') + '"';
    return { __file: { name: 'logboek.csv', text: 'Tijd,Soort,Wat,Wie,Vingerafdruk\n' + rows.map((h) => [new Date(h.at).toISOString(), h.type, h.text, h.by || '', h.h || ''].map(q).join(',')).join('\n') + '\n' } };
  },
  'POST /api/system/restart': (b, id) => {
    securityEvent(`${id.name} herstart de server`);
    setTimeout(() => { flushSave(); if (process.listenerCount('saga-restart') > 0) process.emit('saga-restart'); else process.exit(0); }, 400); // a supervisor (systemd, Docker, the desktop app) starts it again
    return { ok: true };
  },
  'POST /api/security/fix': (b, id) => {
    const what = str(b.id, 30);
    if (what === 'rateLimit') { state.system = cleanSystem({ ...state.system, rateLimit: true }); log('beveiliging', 'Aanvalsbeveiliging aangezet'); return { ok: true }; }
    if (what === 'starter') {
      const st = state.users.find((u) => u.starter);
      if (!st) return { ok: true };
      if (!id.root) throw bad('Alleen het hoofdaccount kan het startaccount uitzetten.');
      st.disabled = true; state.sessions = state.sessions.filter((x) => x.userId !== st.id); kick((c) => c.userId === st.id);
      securityEvent('Het startaccount is uitgezet.'); return { ok: true };
    }
    throw bad('Dit los je op in de instellingen zelf.');
  },
  'GET /api/calendar': (b, id) => ({ enabled: !!state.icsToken, path: state.icsToken ? `/calendar.ics?token=${state.icsToken}` : '' }),
  'POST /api/calendar/token': (b, id) => {
    state.icsToken = b.off ? '' : crypto.randomBytes(24).toString('base64url');
    securityEvent(`${id.name} ${b.off ? 'zette de agendalink uit' : 'maakte een nieuwe agendalink'}`);
    return { enabled: !!state.icsToken, path: state.icsToken ? `/calendar.ics?token=${state.icsToken}` : '' };
  },
  'POST /api/mail/weekly-test': async () => { const m = state.settings.mail; if (!mailOn() || !isEmail(m.adminTo)) throw bad('Stel eerst e-mail in en vul een adres in voor meldingen.'); const w = weeklyText(); await sendMail(m.adminTo, w.subject, w.text); return { ok: true }; },
  'GET /api/https': () => httpsStatus(),
  'POST /api/https/settings': (b, id) => {
    const wasOn = !!httpsServer, oldPort = state.system.httpsPort;
    state.system = cleanSystem({ ...state.system, https: !!b.enabled, ...(b.port ? { httpsPort: b.port } : {}) });
    if (wasOn && oldPort !== state.system.httpsPort) { try { httpsServer.close(); httpsServer.closeAllConnections(); } catch {} httpsServer = null; httpsOn = false; }
    applyHttps();
    securityEvent(`${id.name} zette https ${state.system.https ? 'aan' : 'uit'}`);
    return httpsStatus();
  },
  'POST /api/https/renew': (b, id) => {
    if (!state.system.https) throw bad('Zet https eerst aan.');
    try { fs.rmSync(path.join(DATA_DIR, 'tls', 'server.crt')); } catch {}
    httpsInfo = pki.ensure(path.join(DATA_DIR, 'tls'), 'Saga Techbox');
    if (httpsServer) httpsServer.setSecureContext({ key: httpsInfo.key, cert: httpsInfo.cert + httpsInfo.caPem });
    log('beveiliging', `${id.name} vernieuwde het servercertificaat`);
    return httpsStatus();
  },
  'GET /api/form-schema': () => ({ groups: formSchema() }),
  'POST /api/form-settings': (b) => { const n = applyFormValues(b && typeof b.values === 'object' && b.values ? b.values : {}); state.settings.form = sanitizeForm(state.settings.form); log('instellingen', `Bezoekersformulier aangepast (${n} ${n === 1 ? 'instelling' : 'instellingen'})`); return { ok: true, groups: formSchema() }; },
  'POST /api/login/ticket': (b, id) => {
    if (!id.userId) throw bad('Dit kan alleen met een gewoon account.');
    const ticket = crypto.randomBytes(16).toString('hex');
    loginTickets.set(ticket, { userId: id.userId, until: Date.now() + 120e3, by: id.name });
    log('login', `${id.name} maakte een code om een ander apparaat in te laten loggen`, id.name, !!id.root);
    return { ticket, expiresIn: 120 };
  },
  'POST /api/alerts/test': () => { raise('test', 'Dit is een testwaarschuwing. Als je dit leest, werken de waarschuwingen.', { cooldownMin: 0 }); },
  'POST /api/alerts/clear': () => { for (const a of state.alerts) if (!a.resolvedAt) a.resolvedAt = Date.now(); log('waarschuwing', 'Waarschuwingen gewist', undefined); },
  'POST /api/devices/remove': (b) => { state.devices = state.devices.filter((x) => x.id !== b.id); },
  'POST /api/camera/event': async (b, id) => {
    const f = state.integ.faces;
    if (!f.enabled) throw bad('Herkenning staat uit');
    const kind = ['person', 'face', 'motion'].includes(b.kind) ? b.kind : 'person';
    const name = str(b.name, 60), conf = Number(b.confidence);
    const cam = str(b.camera, 60);
    const entry = { at: Date.now(), camera: cam, kind, name: name || '', confidence: Number.isFinite(conf) ? Math.round(conf * 100) / 100 : null };
    state.sightings.unshift(entry);
    const cutoff = Date.now() - f.retentionDays * 864e5;
    state.sightings = state.sightings.filter((x) => x.at >= cutoff).slice(0, 500);
    const person = name && f.people.find((p) => p.name.toLowerCase() === name.toLowerCase());
    if (person && person.consent && (entry.confidence === null || entry.confidence >= f.minConfidence)) {
      await runAction({ ...person.action, unlock: false }, `${name} bij ${cam || 'camera'}`, id.name); // a face never opens the door: a photo could fool it
      await fireAutomations('camera', name, kind, id.name);
    } else if (kind !== 'motion') await fireAutomations('camera', name ? 'onbekend' : '', kind, id.name);
    return { ok: true };
  },
  'GET /api/camera/snapshot': async (b, id, url) => {
    const cam = state.integ.cameras.find((c) => c.id === url.searchParams.get('id'));
    if (!cam || !cam.snapshotUrl) throw bad('Camera niet gevonden');
    const res = await fetch(cam.snapshotUrl, { signal: AbortSignal.timeout(6000) }).catch(() => null);
    if (!res || !res.ok) throw bad('De camera geeft geen beeld');
    // only pictures are passed on: otherwise this would be a way to read other pages on the internal network (SSRF)
    if (!/^image\//i.test(res.headers.get('content-type') || '')) throw bad('Dit adres geeft geen afbeelding');
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 3e6) throw bad('Het beeld is te groot');
    return { type: res.headers.get('content-type') || 'image/jpeg', data: buf.toString('base64') };
  },

  'POST /api/weather/lookup': async (b) => {
    const q = str(b.city, 80);
    if (!q) throw bad('Vul een plaats in');
    let hit;
    try { const r = await fetch(`${GEOCODE_API}?name=${encodeURIComponent(q)}&count=1&language=nl`, { signal: AbortSignal.timeout(8000) }); hit = ((await r.json()).results || [])[0]; }
    catch { throw bad('Geen verbinding met de weerdienst — probeer het later nog eens'); }
    if (!hit) throw bad(`“${q}” is niet gevonden`);
    const w = state.settings.weather;
    Object.assign(w, { city: str(hit.name, 80), lat: Number(hit.latitude) || 0, lon: Number(hit.longitude) || 0 });
    weather.at = 0;
    refreshWeather(true);
    return { city: w.city, lat: w.lat, lon: w.lon };
  },
  'POST /api/sound': (b) => {
    const bell = cleanBell({ mime: String(b.mime || ''), b64: String(b.data || ''), at: Date.now() });
    if (!bell) throw bad('Dit geluid kan niet gebruikt worden. Kies een mp3-, wav-, ogg- of m4a-bestand van hooguit 400 kB.');
    state.customBell = bell;
    state.settings.sound = { ...state.settings.sound, bell: 'custom', custom: true };
    log('system', 'Eigen beltoon geüpload');
  },
  'POST /api/sound/remove': () => {
    state.customBell = null;
    state.settings.sound = { ...state.settings.sound, custom: false, bell: state.settings.sound.bell === 'custom' ? 'classic' : state.settings.sound.bell };
    log('system', 'Eigen beltoon verwijderd');
  },
  'POST /api/mail/digest-test': async () => {
    if (!mailOn() || !isEmail(state.settings.mail.adminTo)) throw bad('Zet e-mail aan en vul bij “Jij krijgt” je adres in');
    try { await sendDigest(); } catch (e) { throw bad(e.message); }
    return { ok: true };
  },
  'POST /api/appointments/remove': (b) => { state.appointments = state.appointments.filter((a) => a.id !== b.id); },

  'POST /api/people': (b) => {
    if (b.rev !== undefined && Number(b.rev) !== (state.peopleRev || 0)) throw bad('Er is net een nieuw profiel bijgekomen — de lijst is bijgewerkt, probeer het nog eens');
    const seen = new Set();
    state.people = (Array.isArray(b.people) ? b.people : []).slice(0, 2000).map((x) => ({
      id: str(x.id, 20) || newId(), nr: str(x.nr, 20), name: str(x.name, 60), email: isEmail(str(x.email, 120)) ? str(x.email, 120) : '', note: str(x.note, 100), ...(x.self ? { self: true } : {}), ...(x.pending ? { pending: true } : {}),
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
  'GET /api/export': () => { const { users, apiKeys, sessions, rootLock, ...rest } = state; return { ...rest, integ: { ...rest.integ, lock: { ...rest.integ.lock, headerValue: '' } } }; }, // accounts and keys never leave the server
  'POST /api/import': (b) => {
    if (!b || b.version !== 2 || !b.settings) throw bad('Dit is geen back-up van deze versie');
    const d = freshState();
    state = { ...d, ...b, positions: cleanPositions(b.positions), blocks: cleanBlocks(b.blocks), blocked: cleanBlocked(b.blocked), customBell: cleanBell(b.customBell), power: power.clean(b.power), alerts: state.alerts, integ: state.integ, devices: state.devices, sightings: state.sightings, users: state.users, apiKeys: state.apiKeys, sessions: state.sessions, rootLock: state.rootLock, settings: coerce(DEFAULT_SETTINGS, b.settings) }; // accounts are never imported
    log('system', 'Back-up teruggezet');
  },
};

// ----- system (only the main account) -----
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const BACKUP_RE = /^state-\d{4}-\d{2}-\d{2}(_[a-z0-9-]{1,20})?\.(json|sbk)$/;
function listBackups() {
  try { return fs.readdirSync(BACKUP_DIR).filter((n) => BACKUP_RE.test(n)).map((n) => { const st = fs.statSync(path.join(BACKUP_DIR, n)); return { name: n, encrypted: n.endsWith('.sbk'), size: st.size, at: st.mtimeMs }; }).sort((a, b) => b.at - a.at); } catch { return []; }
}
function writeBackup(label) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true, mode: 0o700 });
  const d = new Date();
  const pw = state.system.backupPassword;
  const name = `state-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}${label ? '_' + label : ''}.${pw ? 'sbk' : 'json'}`;
  let text = serializeState(true); // sessions are never written to a backup; secrets stay encrypted
  if (pw) text = security.encryptBackup(text, pw);
  fs.writeFileSync(path.join(BACKUP_DIR, name), text, { mode: 0o600 });
  const copyDir = state.system.backupCopyDir;
  if (copyDir) { // a second copy somewhere else (a usb stick, a network folder)
    try { fs.mkdirSync(copyDir, { recursive: true }); fs.copyFileSync(path.join(BACKUP_DIR, name), path.join(copyDir, name)); resolveAlert('backupcopy', true); }
    catch (e) { raise('backupcopy', `De kopie van de back-up naar “${copyDir}” lukte niet (${e.code || e.message}).`, { cooldownMin: 360 }); }
  }
  for (const old of listBackups().slice(state.system.backupKeep)) { try { fs.unlinkSync(path.join(BACKUP_DIR, old.name)); } catch {} }
  return name;
}
Object.assign(adminRoutes, {
  'GET /api/system': (b, id) => ({ system: maskSystem(state.system), backups: listBackups(), yourIp: id.ip || '', serverTime: Date.now() }),
  'POST /api/system/settings': (b) => { if (b.backupPassword === PASS_MASK) b.backupPassword = state.system.backupPassword; state.system = cleanSystem(b); log('systeem', `Systeeminstellingen gewijzigd${state.system.maintenance ? ' (onderhoudsmodus aan)' : ''}`); },
  'POST /api/system/backups/create': () => { const name = writeBackup('handmatig'); log('systeem', `Back-up gemaakt: ${name}`); return { ok: true, name }; },
  'GET /api/system/backups/download': (b, id, url) => {
    const name = str(url.searchParams.get('name'), 80);
    if (!BACKUP_RE.test(name)) throw bad('Onbekende back-up');
    return { __file: { name, text: fs.readFileSync(path.join(BACKUP_DIR, name), 'utf8') } }; // an encrypted backup stays encrypted
  },
  'POST /api/system/backups/restore': (b) => {
    const name = str(b.name, 80);
    if (!BACKUP_RE.test(name)) throw bad('Onbekende back-up');
    let text = fs.readFileSync(path.join(BACKUP_DIR, name), 'utf8');
    if (security.isEncryptedBackup(text)) { try { text = security.decryptBackup(text, str(b.password, 200) || state.system.backupPassword); } catch (e) { throw bad(e.message); } }
    let data; try { data = JSON.parse(text); } catch { throw bad('Die back-up kan niet gelezen worden'); }
    if (!data || data.version !== 2 || !data.settings) throw bad('Dit is geen geldige back-up');
    writeBackup('voor-herstel'); // so a restore can be undone
    state = { ...freshState(), ...data, settings: coerce(DEFAULT_SETTINGS, data.settings), system: state.system, sessions: state.sessions, lastBackupDay: state.lastBackupDay };
    decryptSecrets();
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
  'POST /api/requests/delete': 'inbox', 'POST /api/moderation/block': 'inbox', 'POST /api/moderation/unblock': 'inbox', 'POST /api/moderation/profile': 'inbox',
  'POST /api/power/settings': 'power', 'POST /api/power/now': 'power', 'POST /api/power/cancel': 'power', 'POST /api/power/wake/apply': 'power', 'POST /api/power/wake/remove': 'power', 'GET /api/power/wake-status': 'power', 'POST /api/power/wol': 'power',
  'POST /api/weather/lookup': 'settings', 'POST /api/sound': 'settings', 'POST /api/sound/remove': 'settings', 'POST /api/mail/digest-test': 'mail',
  'POST /api/device/report': 'devices', 'GET /api/device/poll': 'devices', 'POST /api/door/tag': 'unlock', 'POST /api/door/rfid': 'unlock', 'POST /api/door/unlock': 'unlock',
  'POST /api/integrations/save': (b) => (b.lock || b.automations ? 'unlock' : 'cameras'), 'POST /api/devices/remove': 'settings', 'POST /api/alerts/test': 'settings', 'GET /api/form-schema': 'settings', 'GET /api/https': 'settings', 'GET /api/calendar': 'settings', 'POST /api/calendar/token': 'settings', 'POST /api/mail/weekly-test': 'mail', 'POST /api/https/settings': 'settings', 'POST /api/https/renew': 'settings', 'GET /api/2fa/status': 'view', 'POST /api/2fa/setup': 'view', 'POST /api/2fa/enable': 'view', 'POST /api/2fa/disable': 'view', 'POST /api/2fa/recovery': 'view', 'GET /api/my/sessions': 'view', 'GET /api/passkeys': 'view', 'POST /api/passkeys/options': 'view', 'POST /api/passkeys/add': 'view', 'POST /api/passkeys/remove': 'view', 'POST /api/my/sessions/revoke': 'view', 'GET /api/security/bans': 'settings', 'POST /api/security/unban': 'settings', 'POST /api/security/ban': 'settings', 'GET /api/audit/verify': 'audit', 'GET /api/audit/export': 'audit', 'POST /api/system/restart': 'system', 'POST /api/security/fix': 'settings', 'POST /api/form-settings': 'settings', 'POST /api/login/ticket': 'view', 'POST /api/alerts/clear': 'settings',
  'POST /api/camera/event': 'cameras', 'GET /api/camera/snapshot': 'cameras',
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

// ----- moderation: filter for bad words, blocked visitors, limits -----
const DEFAULT_BAD = ['kut', 'kanker', 'tering', 'tyfus', 'klootzak', 'hoer', 'lul', 'eikel', 'debiel', 'fuck', 'fucking', 'shit', 'bitch', 'asshole', 'bastard', 'cunt', 'dick', 'slut', 'whore', 'idiot'];
const plainText = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[@4]/g, 'a').replace(/0/g, 'o').replace(/1/g, 'i').replace(/3/g, 'e').replace(/[$5]/g, 's').replace(/7/g, 't');
function badWords() {
  const m = state.settings.moderation;
  const own = String(m.words || '').split(/[,;\n]+/).map((w) => plainText(w).trim()).filter((w) => w.length >= 2).slice(0, 200);
  return [...new Set([...(m.defaultList ? DEFAULT_BAD : []), ...own])].map((w) => w.replace(/[^a-z0-9]/g, '')).filter(Boolean);
}
// returns the bad words found and a version with those words hidden behind stars
// a user name has no spaces, so a bad word can sit inside it ("fuckjoe"); short words only count when they are the whole name
function badUsername(nr) {
  const plain = plainText(nr).replace(/[^a-z0-9]/g, '');
  return !!plain && badWords().some((w) => plain === w || (w.length >= 4 && plain.includes(w)));
}
function moderate(text) {
  text = String(text || '');
  const list = badWords();
  if (!text || !list.length) return { hits: [], masked: text };
  const src = `(^|[^a-z0-9])(${list.join('|')})(s|en|je|jes)?(?=$|[^a-z0-9])`;
  const hits = [];
  plainText(text).replace(new RegExp(src, 'gi'), (all, pre, w) => { hits.push(w); return all; });
  if (!hits.length) return { hits: [], masked: text };
  // hide the words in the original text; a disguised spelling (k4nker, f u c k) is found above but cannot be located here: then hide it all
  let masked = text.replace(new RegExp(src, 'gi'), (all, pre, w, suf) => pre + '*'.repeat(w.length + (suf || '').length));
  if (masked === text) masked = '[bericht verborgen]';
  return { hits: [...new Set(hits)], masked };
}
const activeBlocks = () => { const now = Date.now(); return state.blocked.filter((b) => !b.until || b.until > now); };
const personalIp = (ip) => !!ip && ip !== 'proxied' && normIp(ip) !== '127.0.0.1'; // the door screen, a tunnel or a proxy shares one address: never block or limit on that
function isBlocked(ip, nr) {
  const nrv = nr ? String(nr).toLowerCase() : '';
  return activeBlocks().some((b) => (b.kind === 'ip' && personalIp(ip) && b.value === normIp(ip)) || (b.kind === 'nr' && nrv && b.value === nrv));
}
const BELL_TONES = ['classic', 'soft', 'double', 'chime', 'digital', 'custom'], REPLY_TONES = ['soft', 'classic', 'chime', 'none'];
const visitLog = new Map();

const lastVisit = new Map();
const lookups = new Map();
const profileHits = new Map();
let lastBellAt = 0;
function handleVisit(req, b) {
  const ip = clientIp(req);
  const now = Date.now();
  // light flood protection (the door screen is one device, so keep this short)
  if (now - (lastVisit.get(ip) || 0) < visitCooldown()) throw Object.assign(new Error('Een moment…'), { code: 429 });

  const via = b.via === 'phone' ? 'phone' : 'door'; // the door screen is one shared device; phones are one person each
  const mod = state.settings.moderation;
  if (isBlocked(ip, b.nr)) throw Object.assign(new Error('Dit kan nu even niet — probeer het later nog eens.'), { code: 429 });
  if (via === 'phone' && personalIp(ip)) {
    const recent = (visitLog.get(ip) || []).filter((t) => now - t < 3600e3);
    if (recent.length >= mod.maxPerHour) throw Object.assign(new Error('Je hebt het vaak geprobeerd — probeer het over een uurtje nog eens.'), { code: 429 });
  }
  const v = state.settings.visitors;
  const view = computeView(now);
  const allowed = { bell: v.doorbell, reason: v.reasons, appointment: v.appointments, message: v.messages, callback: v.callback };
  const custom = b.button ? (state.settings.customButtons || []).find((x) => x.id === b.button) : null;
  if (b.button && !custom) throw bad('Die knop bestaat niet meer');
  if (custom) { b.type = 'reason'; b.reason = custom.label; if (custom.ask && !str(b.message)) throw bad(`Typ eerst ${custom.askLabel ? custom.askLabel.toLowerCase() : 'een bericht'}`); if (!custom.ask) b.message = ''; }
  else if (!allowed[b.type]) throw bad('Die optie staat uit');
  if (b.type === 'bell' && view.mode !== 'open' && !v.bellWhenBlocked) throw bad('De bel staat nu uit — kies een reden');
  if (b.type === 'bell' && now - lastBellAt < bellCooldown()) {
    const wait = Math.ceil((lastBellAt + bellCooldown() - now) / 1000);
    throw Object.assign(new Error(`Er is net aangebeld — over ${wait} s kun je weer bellen`), { code: 429 });
  }
  if (b.type === 'message' && !str(b.message) && !str(b.topic)) throw bad('Kies een onderwerp of typ je vraag');
  if (b.type === 'appointment' && !(ts(b.at) > now)) throw bad('Kies een tijd');
  const phone = str(b.phone, 24).replace(/\s+/g, ' ');
  if (b.type === 'callback' && (formMode('phone', 'callback') === 'required' || phone) && !/^[0-9+\-() ]{6,20}$/.test(phone)) throw bad('Dat telefoonnummer klopt niet');

  // a known number fills in name and e-mail (looked up here, never trusted from the browser)
  const person = b.nr ? state.people.find((x) => x.nr.toLowerCase() === str(b.nr, 20).toLowerCase()) : null;
  if (b.nr && !person) throw bad('Dat nummer kennen we niet');
  if (person && person.pending) throw bad('Je profiel wacht nog op goedkeuring.');
  const typedEmail = str(b.email, 120);
  if (typedEmail && !isEmail(typedEmail)) throw bad('Dat e-mailadres klopt niet');
  // what the admin made compulsory for this button (a known number counts as name and e-mail)
  if (formMode('name', b.type) === 'required' && !(person ? person.name : str(b.name, 60)).trim()) throw bad('Vul je naam in');
  if (formMode('email', b.type) === 'required' && !(person ? person.email : typedEmail)) throw bad('Vul je e-mailadres in');
  if (state.settings.form.consent && (str(b.name, 60) || typedEmail || phone) && b.consent !== true) throw bad('Vink eerst aan dat je akkoord gaat.');
  const r = {
    id: newId(), type: b.type, name: person ? person.name : str(b.name, 60), reason: str(b.reason, 80), message: str(b.message, maxMessage()),
    topic: str(b.topic, 60), nr: person ? person.nr : '',
    email: b.mail === false ? '' : person ? person.email : typedEmail,
    at: b.type === 'appointment' ? ts(b.at) : null,
    phone: b.type === 'callback' ? phone : '', when: b.type === 'callback' ? str(b.when, 40) : '',
    ip, via,
    statusAtTime: view.label, createdAt: now, state: 'new', reply: '', repliedAt: 0,
  };
  if (mod.filter) { // the bad-word filter looks at everything a visitor typed
    const flags = [];
    for (const k of ['name', 'message', 'reason', 'when']) {
      const m = moderate(r[k]);
      if (!m.hits.length) continue;
      flags.push(...m.hits);
      if (mod.action === 'block') throw bad('Dit bericht kan niet verstuurd worden — zeg het iets vriendelijker.');
      if (mod.action === 'mask') r[k] = m.masked;
    }
    if (flags.length) r.flagged = [...new Set(flags)].slice(0, 10);
  }
  const smart = (custom && custom.reply) || schedule.pickAutoReply(state.settings.autoReplies, { mode: view.mode, type: r.type });
  if (smart) Object.assign(r, { reply: smart, repliedAt: now, autoReplied: true });
  else if (view.mode === 'closed' && state.settings.closedReply) Object.assign(r, { reply: state.settings.closedReply, repliedAt: now, autoReplied: true });
  lastVisit.set(ip, now);
  visitLog.set(ip, [...(visitLog.get(ip) || []).filter((t) => now - t < 3600e3), now]);
  if (r.type === 'bell') lastBellAt = now;
  state.requests.unshift(r);
  state.requests.length = Math.min(state.requests.length, 300);
  log('visit', describe(r).replace(/\n/g, ' · '));
  const plan = schedule.notifyPlan(state.settings.notifyRules, r);
  if (plan.ntfy || plan.webhook) notifyExternal(r, undefined, plan).catch(() => {});
  mailVisitor(r, 'confirm');
  if (plan.mail) mailAdmin(r);
  for (const c of clients) if (c.role === 'admin' && can(identifyFrom(c.tok, c.pin), 'inbox')) write(c, 'visit', r);
  // the doorbell rings on every screen at once: door screens, phones and the control panel
  if (r.type === 'bell') for (const c of clients) write(c, 'ring', { id: r.id, at: now });
  changed();
  return { id: r.id, reply: r.reply, mailTo: r.email && mailOn() ? maskEmail(r.email) : '' };
}

const handle = async (req, res) => {
  { // flood protection comes first, before anything else is looked at
    const wait = limited(clientIp(req), req.url && req.url.startsWith('/events') ? 5 : 1);
    if (wait) { res.writeHead(429, { 'Retry-After': String(wait), 'Content-Type': 'text/plain', Connection: 'close' }); return res.end('Te veel verzoeken — probeer het zo opnieuw'); }
  }
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  // only this server's own pages and scripts run; nothing is loaded from elsewhere; nobody can put the pages in a frame
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'self'; object-src 'none'");
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  if (TRUST_PROXY && String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https') res.setHeader('Strict-Transport-Security', 'max-age=31536000'); // only behind https
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  try {
    if (p === '/healthz') return send(res, 200, { ok: true });
    if (p === '/api/where') return send(res, 200, where(isLoopback(req.socket.remoteAddress && normIp(req.socket.remoteAddress)) && !req.headers['x-forwarded-for'] && !req.headers['x-real-ip'] && !req.headers['cf-connecting-ip'])); // for the start screen and for apps that look for the server
    if (p === '/start') return serveFile(res, 'start.html', req);
    if (p === '/calendar.ics') {
      const tok = url.searchParams.get('token') || '';
      if (!state.icsToken || tok.length !== state.icsToken.length || !crypto.timingSafeEqual(Buffer.from(tok), Buffer.from(state.icsToken))) { authFail(clientIp(req)); return send(res, 404, { error: 'Niet gevonden' }); }
      res.writeHead(200, { 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(schedule.ics({ name: state.settings.name, appointments: state.appointments, holidays: (state.settings.hours.holidays || []).filter((x) => x.date >= new Date(Date.now() - 864e5).toISOString().slice(0, 10)) }));
    }
    if ((p === '/ca.crt' || p === '/ca.mobileconfig') && httpsInfo) {
      const iphone = p === '/ca.mobileconfig';
      res.writeHead(200, { 'Content-Type': iphone ? 'application/x-apple-aspen-config' : 'application/x-x509-ca-cert', 'Content-Disposition': `attachment; filename="${iphone ? 'saga-techbox.mobileconfig' : 'saga-techbox-ca.crt'}"` });
      return res.end(iphone ? pki.mobileconfig(httpsInfo.caDer, 'Saga Techbox') : httpsInfo.caPem);
    }
    if (p === '/help' || p === '/handleiding') return serveFile(res, 'help.html', req);
    if (p === '/events') {
      const role = url.searchParams.get('role') === 'admin' ? 'admin' : 'display';
      const eid = role === 'admin' ? identify(req, url) : null;
      if (role === 'admin' && !eid) return send(res, 401, { error: 'Inloggen is nodig' });
      if (eid?.sessionId && sessionOf(eid)?.locked) return send(res, 423, { error: 'Vergrendeld', locked: true });
      const sgate = role === 'admin' ? gate(eid, clientIp(req)) : null;
      if (sgate) return send(res, sgate.code, { error: sgate.error });
      if ([...clients].filter((x) => x.ip === clientIp(req)).length >= RATE.maxSse && !(isLoopback(clientIp(req)) && process.env.DOOR_RATE_TEST !== '1') && clientIp(req) !== 'proxied') return send(res, 429, { error: 'Te veel open verbindingen vanaf dit apparaat' });
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.write('retry: 2000\n\n');
      const c = { res, role, visit: url.searchParams.get('visit') === '1', ip: clientIp(req), tok: String(url.searchParams.get('token') || ''), pin: String(url.searchParams.get('pin') || ''), userId: eid?.userId, sessionId: eid?.sessionId };
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
      if (!ok) { authFail(ip); noteUserFail(username); log('login', `Mislukte inlogpoging voor “${username}” (${ip})`, 'onbekend'); save(); await new Promise((r) => setTimeout(r, loginDelayMs(username))); return send(res, 401, { error: 'Gebruikersnaam of wachtwoord klopt niet' }); }
      const lg = gate(user, ip);
      if (lg) return send(res, lg.code, { error: lg.error });
      const holder = totpOf(user);
      if (holder && holder.enabled) { // the password was right; now the code from the app
        const mfa = crypto.randomBytes(16).toString('hex');
        mfaTickets.set(mfa, { userId: user.userId, until: Date.now() + 5 * 60e3, tries: 0, remember: !!b.remember });
        return send(res, 200, { needs2fa: true, mfa, recoveryPossible: true });
      }
      const token = newSession(user.userId, req, !!b.remember);
      log('login', `${user.name} ingelogd (${ip})`, user.name, !!user.root);
      noteDevice(user, req);
      save();
      return send(res, 200, { token, user: { name: user.name, role: user.role, perms: user.perms } });
    }
    if (req.method === 'POST' && p === '/api/login/2fa') {
      const ip = clientIp(req);
      if (authBlocked(ip)) return send(res, 429, { error: 'Te veel pogingen — probeer het over een paar minuten opnieuw' });
      const b = await readBody(req);
      const t = mfaTickets.get(String(b.mfa || ''));
      if (!t || t.until < Date.now()) { authFail(ip); return send(res, 401, { error: 'Dit inlogmoment is verlopen. Begin opnieuw met je wachtwoord.' }); }
      const user = identityOfId(t.userId);
      const holder = user && totpOf(user);
      if (!user || !holder || !holder.enabled) { mfaTickets.delete(String(b.mfa)); return send(res, 401, { error: 'Dit account bestaat niet meer.' }); }
      if (++t.tries > 5) { mfaTickets.delete(String(b.mfa)); authFail(ip); return send(res, 429, { error: 'Te veel foute codes. Begin opnieuw met je wachtwoord.' }); }
      if (!checkSecondStep(holder, b.code)) { authFail(ip); noteUserFail(user.username || 'root'); log('login', `Foute tweestapscode voor ${user.username} (${ip})`, 'onbekend'); save(); await new Promise((r) => setTimeout(r, loginDelayMs(user.username || 'root'))); return send(res, 401, { error: 'Die code klopt niet. Probeer de nieuwste code uit je app, of een herstelcode.' }); }
      mfaTickets.delete(String(b.mfa));
      const lg = gate(user, ip);
      if (lg) return send(res, lg.code, { error: lg.error });
      const token = newSession(user.userId, req, t.remember);
      log('login', `${user.name} ingelogd met tweestapscode (${ip})`, user.name, !!user.root);
      noteDevice(user, req);
      save();
      return send(res, 200, { token, user: { name: user.name, role: user.role, perms: user.perms } });
    }
    if (req.method === 'GET' && p === '/api/login/passkey') {
      let host; try { host = passkeyHost(req); } catch (e) { return send(res, 200, { available: false, why: e.message }); }
      return send(res, 200, { available: true, challenge: newPassChallenge('get', ''), rpId: host.rpId });
    }
    if (req.method === 'POST' && p === '/api/login/passkey') {
      const ip = clientIp(req);
      if (authBlocked(ip)) return send(res, 429, { error: 'Te veel pogingen — probeer het over een paar minuten opnieuw' });
      const b = await readBody(req);
      const fail = async (msg) => { authFail(ip); log('login', `Mislukte passkey-poging (${ip})`, 'onbekend'); save(); await new Promise((r) => setTimeout(r, 500)); return send(res, 401, { error: msg || 'Deze passkey werkt niet. Log in met je wachtwoord.' }); };
      let host; try { host = passkeyHost(req); takeChallenge(b.challenge, 'get'); } catch (e) { return fail(e.message); }
      let owner = null, key = null;
      for (const uid of ['root', ...state.users.map((u) => u.id)]) { const k = passkeysOf(uid).find((x) => x.id === b.id); if (k) { owner = uid; key = k; break; } }
      if (!key) return fail();
      const user = identityOfId(owner);
      if (!user) return fail('Dit account bestaat niet meer.');
      try { key.signCount = security.passkey.verifyAssertion(b, { challenge: b.challenge, ...host, publicKey: key.publicKey, signCount: key.signCount }).signCount; } catch (e) { return fail(e.message); }
      const lg = gate(user, ip);
      if (lg) return send(res, lg.code, { error: lg.error });
      key.lastUsed = Date.now();
      const token = newSession(user.userId, req, !!b.remember);
      log('login', `${user.name} ingelogd met een passkey (${ip})`, user.name, !!user.root);
      noteDevice(user, req);
      save();
      return send(res, 200, { token, user: { name: user.name, role: user.role, perms: user.perms } });
    }
    if (req.method === 'POST' && p === '/api/login/ticket/use') {
      const ip = clientIp(req);
      if (authBlocked(ip)) return send(res, 429, { error: 'Te veel pogingen — probeer het over een paar minuten opnieuw' });
      const b = await readBody(req);
      const t = loginTickets.get(String(b.ticket || ''));
      loginTickets.delete(String(b.ticket || '')); // once, whatever the outcome
      if (!t || t.until < Date.now()) { authFail(ip); await new Promise((r) => setTimeout(r, 400)); return send(res, 401, { error: 'Deze code is verlopen of al gebruikt. Maak een nieuwe.' }); }
      let user = null;
      if (t.userId === 'root') user = rootIdentity();
      else { const u = state.users.find((x) => x.id === t.userId && !x.disabled); if (u) user = { kind: 'user', userId: u.id, username: u.username, name: u.name || u.username, role: u.role, perms: effectivePerms(u) }; }
      if (!user) return send(res, 401, { error: 'Dit account bestaat niet meer.' });
      const lg = gate(user, ip);
      if (lg) return send(res, lg.code, { error: lg.error });
      const token = newSession(user.userId, req, true);
      noteDevice(user, req);
      log('login', `${user.name} ingelogd op een nieuw apparaat met een code (${ip}) — gemaakt door ${t.by}`, user.name, !!user.root);
      save();
      return send(res, 200, { token, user: { name: user.name, role: user.role, perms: user.perms } });
    }
    if (req.method === 'POST' && p === '/api/logout') {
      const id = identify(req, url);
      if (id?.sessionId) { state.sessions = state.sessions.filter((x) => x.id !== id.sessionId); kick((c) => c.sessionId === id.sessionId); log('login', `${id.name} uitgelogd`, id.name, !!id.root); save(); }
      return send(res, 200, { ok: true });
    }
    if (req.method === 'GET' && p === '/api/slots') return send(res, 200, { slots: freeSlots() });
    if (req.method === 'GET' && p === '/api/bell-sound') {
      const b = state.customBell;
      if (!b) return send(res, 404, { error: 'Geen eigen beltoon' });
      const buf = Buffer.from(b.b64, 'base64');
      res.writeHead(200, { 'Content-Type': b.mime, 'Content-Length': buf.length, 'Cache-Control': 'public, max-age=3600' });
      return res.end(buf);
    }
    if (req.method === 'POST' && p === '/api/lookup') {
      const ip = clientIp(req);
      const hits = (lookups.get(ip) || []).filter((t) => Date.now() - t < 60e3);
      if (hits.length >= 15) return send(res, 429, { error: 'Even wachten en opnieuw proberen' });
      lookups.set(ip, [...hits, Date.now()]);
      const nr = str((await readBody(req)).nr, 20).toLowerCase();
      const x = state.people.find((y) => y.nr.toLowerCase() === nr);
      if (x && x.pending) return send(res, 200, { found: false, pending: true });
      return send(res, 200, x ? { found: true, name: x.name, email: mailOn() && x.email ? maskEmail(x.email) : '' } : { found: false });
    }
    if (req.method === 'POST' && p === '/api/profile') {
      // visitors make their own profile: username + name + e-mail, so every question can be filled in with one tap
      const ip = clientIp(req);
      if (isBlocked(ip, '')) return send(res, 429, { error: 'Dit kan nu even niet — probeer het later nog eens.' });
      const hits = (profileHits.get(ip) || []).filter((t) => Date.now() - t < 3600e3);
      if (hits.length >= 5) return send(res, 429, { error: 'Je hebt net al een paar profielen gemaakt — probeer het later nog eens' });
      const b = await readBody(req);
      const nr = str(b.nr, 20).toLowerCase(), name = str(b.name, 60), email = str(b.email, 120);
      if (!/^[a-z0-9._-]{3,20}$/.test(nr)) throw bad('Gebruikersnaam: 3 tot 20 tekens (letters, cijfers, punt, streepje)');
      if (!name) throw bad('Vul je naam in');
      if (email && !isEmail(email)) throw bad('Dat e-mailadres klopt niet');
      if (state.settings.moderation.filter && (badUsername(nr) || moderate(name).hits.length)) throw bad('Kies een andere naam of gebruikersnaam.');
      if (state.people.some((x) => x.nr.toLowerCase() === nr)) throw bad('Die gebruikersnaam is al bezet — kies een andere');
      if (state.people.length >= 2000) throw bad('De lijst met profielen is vol');
      const pending = !!state.settings.moderation.profileApproval;
      state.people.push({ id: newId(), nr, name, email, note: 'Zelf aangemaakt', self: true, ...(pending ? { pending: true } : {}) });
      state.peopleRev = (state.peopleRev || 0) + 1;
      profileHits.set(ip, [...hits, Date.now()]);
      log('visit', `Nieuw profiel: ${name} (${nr})`);
      changed();
      return send(res, 200, { ok: true, nr, pending: !!state.settings.moderation.profileApproval });
    }
    if (req.method === 'POST' && p === '/api/visit') return send(res, 200, handleVisit(req, await readBody(req)));

    const routeKey = `${req.method} ${p}`;
    const route = adminRoutes[routeKey];
    if (route) {
      const ip = clientIp(req);
      if (authBlocked(ip)) return send(res, 429, { error: 'Te veel pogingen — probeer het over een paar minuten opnieuw' });
      const id = identify(req, url);
      if (!id) { authFail(ip); return send(res, 401, { error: 'Inloggen is nodig' }); }
      id.ip = ip; id.req = req;
      const g = gate(id, ip);
      if (g) return send(res, g.code, { error: g.error });
      if (id.mustSetup2fa && !BEFORE_2FA.has(routeKey)) return send(res, 403, { error: 'Stel eerst tweestapsverificatie in (Account → Beveiliging).', setup2fa: true });
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
      if (p === '/' || p === '/display' || p === '/visit') return serveFile(res, 'display.html', req);
      if (p === '/get' || p.startsWith('/get/')) return serveDownloads(req, res, p);
      if (p === '/admin') return serveFile(res, 'admin.html', req);
      if (p === '/sw.js') res.setHeader('Service-Worker-Allowed', '/admin');
      return serveFile(res, p.slice(1), req);
    }
    send(res, 404, { error: 'not found' });
  } catch (e) {
    // our own messages ("Dat verzoek bestaat niet meer") are shown; a real bug or a file-system error is not: that could give away paths and code
    const internal = e instanceof TypeError || e instanceof RangeError || e instanceof ReferenceError || e instanceof SyntaxError && !/JSON/.test(e.message) || (typeof e.code === 'string' && /^E[A-Z]+$/.test(e.code));
    if (internal) { console.error('internal error on', req.method, p, e && e.stack || e); log('fout', `Interne fout bij ${req.method} ${p}: ${e.message}`, 'systeem'); return send(res, 500, { error: 'Er ging iets mis in de server.' }); }
    send(res, e.logout ? 401 : e.code === 429 ? 429 : 400, { error: e.message });
  }
};
const server = http.createServer({ connectionsCheckingInterval: 2000 }, handle);

// Opt-in public download page: lists the files in data/downloads (put installers there yourself). Off unless switched on in Ontwerp.
function serveDownloads(req, res, p) {
  if (!state.settings.downloads.enabled) return send(res, 404, { error: 'not found' });
  const dir = path.join(DATA_DIR, 'downloads');
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => /^[\w.\-]+$/.test(f) && fs.statSync(path.join(dir, f)).isFile()); } catch {}
  if (p === '/get') {
    const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const items = files.map((f) => `<a href="/get/${encodeURIComponent(f)}">${esc(f)} <small>${(fs.statSync(path.join(dir, f)).size / 1048576).toFixed(1)} MB</small></a>`).join('') || '<p>Er staat nog niets klaar om te downloaden.</p>';
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Download de app</title><style>body{font:17px system-ui;background:#0e1417;color:#fff;max-width:560px;margin:0 auto;padding:24px 16px}a{display:block;background:#1c9d47;color:#fff;text-decoration:none;padding:16px;border-radius:14px;margin:10px 0}small{opacity:.8;float:right}</style><h1>Download de app</h1>${items}`);
  }
  const name = decodeURIComponent(p.slice(5));
  if (!files.includes(name)) return send(res, 404, { error: 'not found' });
  res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="${name}"` });
  fs.createReadStream(path.join(dir, name)).pipe(res);
}

// after an update: take a safe copy of everything first, then carry on
if (state.lastVersion && state.lastVersion !== APP_VERSION) {
  try { writeBackup('voor-update'); log('systeem', `Bijgewerkt van ${state.lastVersion} naar ${APP_VERSION} — een back-up is gemaakt`, 'systeem'); } catch {}
}
if (state.lastVersion !== APP_VERSION) { state.lastVersion = APP_VERSION; save(); }
if (['open', 'closed', 'busy'].includes(state.settings.startup.status)) { // chosen start-up behaviour
  state.manual = { mode: state.settings.startup.status, until: null, message: str(state.settings.startup.message, 140), setAt: Date.now(), expiresAt: null };
  log('status', `Na het opstarten: ${state.settings.texts[state.settings.startup.status].label}`, 'systeem');
}
lastView = JSON.stringify(computeView());
// `ready` lets the desktop app wait for the server (or show why it couldn't start)
// slow-connection attacks (a request that is sent a byte at a time to keep connections busy): the whole request has to arrive quickly
server.headersTimeout = Number(process.env.DOOR_HEADER_TIMEOUT_MS) || 15000;
server.requestTimeout = Math.max(server.headersTimeout, 30000);
server.keepAliveTimeout = 5000;
server.maxHeadersCount = 60;
const ready = new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(PORT, process.env.HOST || undefined, () => {
    applyHttps();
    console.log(`Deurscherm draait op http://localhost:${PORT}  (deur: /  bediening: /admin  telefoon: /visit)  — inloggen met account`);
    resolve(PORT);
  });
});
ready.catch((e) => {
  console.error(e.code === 'EADDRINUSE' ? `Poort ${PORT} is al in gebruik — draait de deurserver misschien al?` : `Server kon niet starten: ${e.message}`);
  if (require.main === module) process.exit(1);
});

module.exports = { ready, server };
