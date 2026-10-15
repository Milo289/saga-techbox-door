'use strict';
// Connections to the outside world, all opt-in:
//   • microcontrollers (ESP32, Raspberry Pi Pico W, …) report buttons/sensors and read the door status
//   • a door lock + NFC tags: a tag is scanned (by a reader, via the API) and the lock's own web address is called
//   • cameras: an AI program next to the cameras reports "person X seen"; the server keeps names only (never pictures)
//   • automations: "when this happens, do that" tying the three above to the door status
// No dependencies, no Electron: everything here can be tested on its own.
const MODES = ['open', 'closed', 'busy'];
const str = (v, max = 200) => (v == null ? '' : String(v)).trim().slice(0, max);
const bool = (v) => v === true || v === 'true' || v === 1;
const id = () => Math.random().toString(36).slice(2, 10);
const HM = /^([01]\d|2[0-3]):[0-5]\d$/;

// a tag number written in any way ("04:a2:3b", "04 A2 3B", "04a23b") becomes 04A23B
const normUid = (u) => String(u || '').replace(/[^0-9a-f]/gi, '').toUpperCase().slice(0, 32);
const httpUrl = (u) => { try { const x = new URL(String(u)); return x.protocol === 'http:' || x.protocol === 'https:' ? x.toString() : ''; } catch { return ''; } };

function defaults() {
  return {
    lock: { enabled: false, url: '', method: 'POST', body: '', headerName: '', headerValue: '', tags: [] },
    cameras: [],
    faces: { enabled: false, minConfidence: 0.8, retentionDays: 7, people: [] },
    automations: [],
  };
}

function cleanTags(list) {
  const out = [], seen = new Set();
  for (const t of Array.isArray(list) ? list : []) {
    const uid = normUid(t && t.uid);
    if (uid.length < 4 || seen.has(uid)) continue;
    seen.add(uid);
    out.push({
      id: str(t.id, 16) || id(), uid, name: str(t.name, 60),
      enabled: t.enabled !== false,
      days: [...new Set((Array.isArray(t.days) ? t.days : [0, 1, 2, 3, 4, 5, 6]).map(Number).filter((d) => d >= 0 && d <= 6))],
      from: HM.test(t.from) ? t.from : '00:00', to: HM.test(t.to) ? t.to : '23:59',
    });
    if (out.length >= 300) break;
  }
  return out;
}

function cleanAction(a) {
  a = a || {};
  const out = {};
  if (MODES.includes(a.status)) out.status = a.status;
  const min = Math.round(Number(a.minutes) || 0);
  if (min > 0) out.minutes = Math.min(min, 1440);
  const msg = str(a.message, 140); if (msg) out.message = msg;
  if (bool(a.bell)) out.bell = true;
  if (bool(a.notify)) out.notify = true;
  if (bool(a.unlock)) out.unlock = true;
  return out;
}

function clean(raw) {
  const d = defaults(), r = raw && typeof raw === 'object' ? raw : {};
  const l = r.lock || {};
  const lock = {
    enabled: bool(l.enabled), url: httpUrl(l.url), method: ['GET', 'POST', 'PUT'].includes(String(l.method).toUpperCase()) ? String(l.method).toUpperCase() : 'POST',
    body: str(l.body, 500), headerName: /^[\w-]{1,40}$/.test(l.headerName || '') ? l.headerName : '', headerValue: str(l.headerValue, 300), tags: cleanTags(l.tags),
  };
  const cameras = (Array.isArray(r.cameras) ? r.cameras : []).slice(0, 20).map((c) => ({ id: str(c && c.id, 16) || id(), name: str(c && c.name, 60) || 'Camera', snapshotUrl: httpUrl(c && c.snapshotUrl) })).filter((c) => c.name);
  const f = r.faces || {};
  const faces = {
    enabled: bool(f.enabled), minConfidence: Math.min(0.99, Math.max(0.3, Number(f.minConfidence) || d.faces.minConfidence)),
    retentionDays: Math.min(90, Math.max(1, Math.round(Number(f.retentionDays) || d.faces.retentionDays))),
    // only people who agreed (consent) are ever acted on
    people: (Array.isArray(f.people) ? f.people : []).slice(0, 200).map((p) => ({ name: str(p && p.name, 60), consent: bool(p && p.consent), action: cleanAction(p && p.action) })).filter((p) => p.name),
  };
  const automations = (Array.isArray(r.automations) ? r.automations : []).slice(0, 100).map((a) => {
    const w = (a && a.when) || {};
    return {
      id: str(a && a.id, 16) || id(), name: str(a && a.name, 60) || 'Regel', enabled: !a || a.enabled !== false,
      when: { source: ['device', 'tag', 'camera'].includes(w.source) ? w.source : 'device', key: str(w.key, 60), event: str(w.event, 40) },
      do: cleanAction(a && a.do),
    };
  }).filter((a) => a.when.key || a.when.source === 'tag');
  return { lock, cameras, faces, automations };
}

// may this tag open the door right now?
function tagVerdict(cfg, uid, now = new Date()) {
  if (!cfg.lock.enabled) return { ok: false, why: 'Ontgrendelen staat uit' };
  if (!cfg.lock.url) return { ok: false, why: 'Er is nog geen slot ingesteld' };
  const tag = cfg.lock.tags.find((t) => t.uid === normUid(uid));
  if (!tag) return { ok: false, why: 'Onbekende tag', unknown: true };
  if (!tag.enabled) return { ok: false, why: 'Deze tag staat uit', tag };
  if (!tag.days.includes(now.getDay())) return { ok: false, why: 'Vandaag mag deze tag niet naar binnen', tag };
  const hm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  if (hm < tag.from || hm > tag.to) return { ok: false, why: 'Op dit tijdstip mag deze tag niet naar binnen', tag };
  return { ok: true, tag };
}

// calls the lock's own web address; DOOR_LOCK_DRYRUN=1 only records the call (tests)
const sent = [];
async function unlock(cfg) {
  const l = cfg.lock;
  if (process.env.DOOR_LOCK_DRYRUN) { sent.push({ url: l.url, method: l.method, body: l.body }); return { ok: true, dry: true }; }
  const headers = {};
  if (l.headerName) headers[l.headerName] = l.headerValue;
  if (l.body) headers['Content-Type'] = /^\s*[{[]/.test(l.body) ? 'application/json' : 'text/plain';
  const res = await fetch(l.url, { method: l.method, headers, body: l.method === 'GET' ? undefined : l.body || undefined, signal: AbortSignal.timeout(6000) });
  if (!res.ok) throw new Error(`Het slot antwoordde met fout ${res.status}`);
  return { ok: true };
}

// which automation rules fire for this happening?
function matching(cfg, source, key, event) {
  return cfg.automations.filter((a) => a.enabled && a.when.source === source && (!a.when.key || a.when.key.toLowerCase() === String(key).toLowerCase()) && (!a.when.event || a.when.event === event));
}

module.exports = { MODES, defaults, clean, cleanAction, normUid, tagVerdict, unlock, matching, sent, httpUrl };
