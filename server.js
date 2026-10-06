'use strict';
// Door Display server — zero dependencies.
// Three states: Open, Closed, Busy — each optionally "until" a time, plus planned "busy during" blocks
// and optional opening hours. The server computes what the door should show; screens just render it.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 8080;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const ADMIN_PIN = process.env.ADMIN_PIN || '';
const PUBLIC_DIR = path.join(__dirname, 'public');
const BUILD = crypto.randomBytes(4).toString('hex'); // screens reload themselves when this changes
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
  quickReplies: ['Kom binnen', 'Momentje', 'Over 5 minuten', 'Ik kom naar je toe', 'Nu even niet — probeer het later', 'Laat een bericht achter'],
  slotMinutes: 30,
  autoReplyMinutes: 5,
  autoReplyText: 'Nog geen reactie — je verzoek is opgeslagen.',
  closedReply: 'We zijn nu gesloten — je verzoek is opgeslagen.',
  note: '',
  layout: { orientation: 'auto', rotate: 0, hour12: false, keyboard: true },
  dim: { enabled: false, from: '22:00', to: '07:00', level: 0.2 },
  ntfyServer: 'https://ntfy.sh',
  ntfyTopic: '',
  webhookUrl: '',
};
const PRIVATE_SETTINGS = ['ntfyServer', 'ntfyTopic', 'webhookUrl', 'quickReplies', 'autoReplyText', 'closedReply', 'autoReplyMinutes'];

const freshState = () => ({
  version: 2,
  settings: structuredClone(DEFAULT_SETTINGS),
  manual: null, // { mode, until, message, setAt, expiresAt }
  busy: [], // planned busy blocks { id, from, to, note }
  appointments: [], // { id, at, name, reason }
  requests: [],
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
function load() {
  const d = freshState();
  try {
    const raw = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    if (raw.version !== 2) {
      // older version: keep what still applies
      d.settings.name = str(raw.settings?.name, 60) || d.settings.name;
      for (const k of ['ntfyTopic', 'ntfyServer', 'webhookUrl']) if (raw.settings?.[k]) d.settings[k] = str(raw.settings[k], 300);
      return d;
    }
    return { ...d, ...raw, settings: toDutch(coerce(DEFAULT_SETTINGS, raw.settings)) };
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
      fs.renameSync(STATE_FILE + '.tmp', STATE_FILE);
    } catch (e) { console.error('save failed:', e.message); }
  }, 150);
}
function log(type, text) {
  state.history.unshift({ at: Date.now(), type, text: str(text, 300) });
  state.history.length = Math.min(state.history.length, 300);
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
  const now = Date.now();
  return {
    build: BUILD,
    settings,
    view: computeView(now),
    replies: state.requests.filter((r) => r.reply && now - r.repliedAt < 15 * 60e3).map((r) => ({ id: r.id, reply: r.reply })),
    bellReadyAt: lastBellAt + BELL_COOLDOWN,
    serverTime: now,
  };
}
function adminState() {
  return {
    build: BUILD,
    settings: state.settings,
    manual: state.manual,
    view: computeView(),
    busy: [...state.busy].sort((a, b) => a.from - b.from),
    appointments: [...state.appointments].sort((a, b) => a.at - b.at),
    requests: state.requests,
    history: state.history,
    serverTime: Date.now(),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    pinRequired: !!ADMIN_PIN,
  };
}
function write(c, event, data) {
  try { c.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch { clients.delete(c); }
}
function broadcast() {
  const pub = publicState(), adm = adminState();
  for (const c of clients) write(c, 'state', c.role === 'admin' ? adm : pub);
}
let lastView = '';
function changed() { save(); lastView = JSON.stringify(computeView()); broadcast(); }
setInterval(() => { for (const c of clients) write(c, 'ping', { t: Date.now() }); }, 20000);

// ---------- outside notifications ----------
const TYPE_LABEL = { bell: 'Aangebeld', reason: 'Verzoek', appointment: 'Afspraakverzoek', message: 'Vraagje' };
function describe(r) {
  const parts = [`${TYPE_LABEL[r.type]} — ${r.name || 'Iemand'} bij ${state.settings.name}`];
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
function authed(req, url) {
  if (!ADMIN_PIN) return true;
  const a = Buffer.from(String(req.headers['x-pin'] || url.searchParams.get('pin') || '')), b = Buffer.from(ADMIN_PIN);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
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
  'GET /api/admin-state': () => adminState(),

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

  'POST /api/settings': (b) => {
    const merged = { ...state.settings };
    for (const k of Object.keys(DEFAULT_SETTINGS)) if (k in b) merged[k] = coerce(DEFAULT_SETTINGS[k], b[k]);
    if (![0, 90, 180, 270].includes(merged.layout.rotate)) merged.layout.rotate = 0;
    if (!['auto', 'portrait', 'landscape'].includes(merged.layout.orientation)) merged.layout.orientation = 'auto';
    for (const m of MODES) if (!merged.texts[m].label) merged.texts[m].label = DEFAULT_SETTINGS.texts[m].label;
    state.settings = merged;
  },

  'POST /api/requests/reply': (b) => {
    const r = findReq(b.id);
    const reply = str(b.reply, 200);
    if (!reply) throw bad('Typ eerst een antwoord');
    Object.assign(r, { reply, repliedAt: Date.now(), autoReplied: false, state: 'replied' });
    log('reply', `→ ${r.name || 'bezoeker'}: ${reply}`);
  },
  'POST /api/requests/accept': (b) => {
    const r = findReq(b.id);
    const at = ts(b.at) || r.at;
    if (!at) throw bad('Kies een datum en tijd');
    state.appointments.push({ id: newId(), at, name: r.name || 'Bezoeker', reason: r.reason || '' });
    const when = new Date(at).toLocaleString('nl-NL', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
    Object.assign(r, { reply: `Bevestigd: ${when}`, repliedAt: Date.now(), autoReplied: false, state: 'replied' });
    log('appointment', `Afspraak met ${r.name || 'bezoeker'} — ${when}`);
  },
  'POST /api/requests/done': (b) => { const r = state.requests.find((x) => x.id === b.id); if (r) r.state = 'done'; },
  'POST /api/requests/seen': () => { for (const r of state.requests) if (r.state === 'new') r.state = 'seen'; },
  'POST /api/requests/clear': () => { state.requests = state.requests.filter((r) => r.state !== 'done'); },
  'POST /api/appointments/remove': (b) => { state.appointments = state.appointments.filter((a) => a.id !== b.id); },

  'POST /api/test-notify': async () => ({ results: await notifyExternal(null, `Testmelding van ${state.settings.name}`) }),
  'GET /api/export': () => state,
  'POST /api/import': (b) => {
    if (!b || b.version !== 2 || !b.settings) throw bad('Dit is geen back-up van deze versie');
    const d = freshState();
    state = { ...d, ...b, settings: coerce(DEFAULT_SETTINGS, b.settings) };
    log('system', 'Back-up teruggezet');
  },
};

const lastVisit = new Map();
const BELL_COOLDOWN = 45 * 1000; // the doorbell can ring at most once every 45 seconds (for everyone)
let lastBellAt = 0;
function handleVisit(req, b) {
  const ip = req.socket.remoteAddress || '';
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
  if (b.type === 'message' && !str(b.message)) throw bad('Typ eerst je vraag');
  if (b.type === 'appointment' && !str(b.name)) throw bad('Vul je naam in');
  if (b.type === 'appointment' && !(ts(b.at) > now)) throw bad('Kies een tijd');

  const r = {
    id: newId(), type: b.type, name: str(b.name, 60), reason: str(b.reason, 80), message: str(b.message, 500),
    at: b.type === 'appointment' ? ts(b.at) : null,
    statusAtTime: view.label, createdAt: now, state: 'new', reply: '', repliedAt: 0,
  };
  if (view.mode === 'closed' && state.settings.closedReply) Object.assign(r, { reply: state.settings.closedReply, repliedAt: now, autoReplied: true });
  lastVisit.set(ip, now);
  if (r.type === 'bell') lastBellAt = now;
  state.requests.unshift(r);
  state.requests.length = Math.min(state.requests.length, 300);
  log('visit', describe(r).replace(/\n/g, ' · '));
  notifyExternal(r).catch(() => {});
  for (const c of clients) if (c.role === 'admin') write(c, 'visit', r);
  // the doorbell rings on every screen at once: door screens, phones and the control panel
  if (r.type === 'bell') for (const c of clients) write(c, 'ring', { id: r.id, at: now });
  changed();
  return { id: r.id, reply: r.reply };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  try {
    if (p === '/healthz') return send(res, 200, { ok: true });
    if (p === '/events') {
      const role = url.searchParams.get('role') === 'admin' ? 'admin' : 'display';
      if (role === 'admin' && !authed(req, url)) return send(res, 401, { error: 'Pincode nodig' });
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.write('retry: 2000\n\n');
      const c = { res, role };
      clients.add(c);
      write(c, 'state', role === 'admin' ? adminState() : publicState());
      req.on('close', () => clients.delete(c));
      return;
    }
    if (req.method === 'GET' && p === '/api/state') return send(res, 200, publicState());
    if (req.method === 'GET' && p === '/api/slots') return send(res, 200, { slots: freeSlots() });
    if (req.method === 'POST' && p === '/api/visit') return send(res, 200, handleVisit(req, await readBody(req)));

    const route = adminRoutes[`${req.method} ${p}`];
    if (route) {
      if (!authed(req, url)) return send(res, 401, { error: 'pin required' });
      const out = await route(req.method === 'POST' ? await readBody(req) : {});
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
    send(res, e.code === 429 ? 429 : 400, { error: e.message });
  }
});

lastView = JSON.stringify(computeView());
server.listen(PORT, () => {
  console.log(`Deurscherm draait op http://localhost:${PORT}  (deur: /  bediening: /admin  telefoon: /visit)${ADMIN_PIN ? '' : '  — geen ADMIN_PIN ingesteld'}`);
});
