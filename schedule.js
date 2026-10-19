'use strict';
// The rules that need no server: opening hours per day with breaks and holidays, extra door buttons,
// who gets which notification, automatic replies per time and status, and the calendar file.
const HM = /^([01]\d|2[0-3]):[0-5]\d$/;
const str = (v, max = 200) => (v == null ? '' : String(v)).trim().slice(0, max);
const id = () => Math.random().toString(36).slice(2, 10);
const TYPES = ['bell', 'reason', 'message', 'appointment', 'callback'];
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const atTime = (day, hm) => { const [h, m] = hm.split(':').map(Number); return new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m, 0, 0); };

// ---------- opening hours ----------
function cleanHoursExtra(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const perDay = {};
  if (r.perDay && typeof r.perDay === 'object') for (const d of [0, 1, 2, 3, 4, 5, 6]) {
    const x = r.perDay[d];
    if (!x || typeof x !== 'object') continue;
    if (x.off === true) perDay[d] = { off: true };
    else if (HM.test(x.from) && HM.test(x.to) && x.from < x.to) perDay[d] = { from: x.from, to: x.to };
  }
  const breaks = (Array.isArray(r.breaks) ? r.breaks : []).filter((b) => b && HM.test(b.from) && HM.test(b.to) && b.from < b.to).slice(0, 6).map((b) => ({ from: b.from, to: b.to, label: str(b.label, 40) }));
  const holidays = (Array.isArray(r.holidays) ? r.holidays : []).filter((x) => x && /^\d{4}-\d{2}-\d{2}$/.test(x.date)).slice(0, 80).map((x) => ({ date: x.date, label: str(x.label, 60) })).sort((a, b) => a.date.localeCompare(b.date));
  return { perDay, breaks, holidays };
}
// the open stretches of one day, as [from, to] in milliseconds
function segmentsFor(h, day) {
  if ((h.holidays || []).some((x) => x.date === ymd(day))) return [];
  let from = h.from, to = h.to;
  const pd = (h.perDay || {})[day.getDay()];
  if (pd) { if (pd.off) return []; from = pd.from; to = pd.to; } else if (!(h.days || []).includes(day.getDay())) return [];
  if (!(from < to)) return [];
  let segs = [[from, to]];
  for (const br of h.breaks || []) segs = segs.flatMap(([a, b]) => (br.to <= a || br.from >= b ? [[a, b]] : [...(br.from > a ? [[a, br.from]] : []), ...(br.to < b ? [[br.to, b]] : [])]));
  return segs.map(([a, b]) => [atTime(day, a).getTime(), atTime(day, b).getTime()]);
}
function hoursState(h, now) {
  if (!h || !h.enabled) return null;
  const perDay = Object.keys(h.perDay || {}).length;
  if (!(h.days || []).length && !perDay) return null;
  if (!perDay && !(h.from < h.to)) return null;
  const d = new Date(now);
  for (let i = 0; i < 15; i++) {
    const day = new Date(d.getFullYear(), d.getMonth(), d.getDate() + i);
    for (const [o, c] of segmentsFor(h, day)) { if (now < o) return { open: false, changeAt: o }; if (now < c) return { open: true, changeAt: c }; }
  }
  return { open: false, changeAt: null };
}

// ---------- extra buttons on the door screen ----------
function cleanCustomButtons(list) {
  const kinds = ['form', 'info', 'link', 'phone', 'wifi'], whens = ['always', 'open', 'closed', 'busy'], hex = /^#[0-9a-f]{6}$/i;
  return (Array.isArray(list) ? list : []).slice(0, 12).map((b) => ({
    id: str(b && b.id, 16) || id(), label: str(b && b.label, 40), ask: !!(b && b.ask), askLabel: str(b && b.askLabel, 60), reply: str(b && b.reply, 140), whenClosed: !!(b && b.whenClosed),
    kind: kinds.includes(b && b.kind) ? b.kind : 'form',   // form = a request to the person behind the door; info = a text; link = a web address as a code; phone = a number; wifi = a wifi code
    text: str(b && b.text, 600), url: str(b && b.url, 300), phone: str(b && b.phone, 30), ssid: str(b && b.ssid, 60), wifiPass: str(b && b.wifiPass, 80), wifiType: ['WPA', 'nopass'].includes(b && b.wifiType) ? b.wifiType : 'WPA',
    color: hex.test(b && b.color) ? b.color : '', icon: str(b && b.icon, 4), when: whens.includes(b && b.when) ? b.when : 'always',
  })).filter((b) => b.label);
}
// a note on the door for a period of time (from and to are dates YYYY-MM-DD, both included)
function cleanNoteSchedule(list) {
  const D = /^\d{4}-\d{2}-\d{2}$/;
  return (Array.isArray(list) ? list : []).slice(0, 30).map((n) => ({ id: str(n && n.id, 16) || id(), from: D.test(n && n.from) ? n.from : '', to: D.test(n && n.to) ? n.to : '', text: str(n && n.text, 140) })).filter((n) => n.text && n.from);
}
const noteFor = (list, today) => { const hit = (list || []).find((n) => n.from <= today && (n.to || n.from) >= today); return hit ? hit.text : ''; };

// ---------- who is told what ----------
function cleanNotifyRules(list) {
  return (Array.isArray(list) ? list : []).slice(0, 30).map((r) => ({
    id: str(r && r.id, 16) || id(), enabled: !r || r.enabled !== false,
    type: TYPES.includes(r && r.type) ? r.type : 'any', person: str(r && r.person, 60),
    mute: !!(r && r.mute), ntfy: !r || r.ntfy !== false, webhook: !r || r.webhook !== false, mail: !r || r.mail !== false,
    quietFrom: HM.test(r && r.quietFrom) ? r.quietFrom : '', quietTo: HM.test(r && r.quietTo) ? r.quietTo : '',
  }));
}
const inQuiet = (from, to, hm) => (from && to ? (from <= to ? hm >= from && hm < to : hm >= from || hm < to) : false);
// the first matching rule decides; no rule = everything goes out like before
function notifyPlan(rules, r, now = new Date()) {
  const hm = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const who = `${r.name || ''} ${r.nr || ''}`.toLowerCase();
  for (const x of rules || []) {
    if (!x.enabled) continue;
    if (x.type !== 'any' && x.type !== r.type) continue;
    if (x.person && !who.includes(x.person.toLowerCase())) continue;
    if (x.mute) return { ntfy: false, webhook: false, mail: false, rule: x.id };
    if (inQuiet(x.quietFrom, x.quietTo, hm)) return { ntfy: false, webhook: false, mail: false, rule: x.id, quiet: true };
    return { ntfy: x.ntfy, webhook: x.webhook, mail: x.mail, rule: x.id };
  }
  return { ntfy: true, webhook: true, mail: true, rule: '' };
}

// ---------- automatic replies ----------
function cleanAutoReplies(list) {
  return (Array.isArray(list) ? list : []).slice(0, 20).map((r) => ({
    id: str(r && r.id, 16) || id(), enabled: !r || r.enabled !== false,
    status: ['any', 'open', 'closed', 'busy'].includes(r && r.status) ? r.status : 'any', type: TYPES.includes(r && r.type) ? r.type : 'any',
    from: HM.test(r && r.from) ? r.from : '', to: HM.test(r && r.to) ? r.to : '',
    days: [...new Set((Array.isArray(r && r.days) ? r.days : []).map(Number).filter((d) => d >= 0 && d <= 6))],
    text: str(r && r.text, 140),
  })).filter((r) => r.text);
}
function pickAutoReply(rules, ctx, now = new Date()) {
  const hm = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  for (const x of rules || []) {
    if (!x.enabled) continue;
    if (x.status !== 'any' && x.status !== ctx.mode) continue;
    if (x.type !== 'any' && x.type !== ctx.type) continue;
    if (x.days.length && !x.days.includes(now.getDay())) continue;
    if ((x.from || x.to) && !inQuiet(x.from || '00:00', x.to || '23:59', hm) && !(x.from <= hm && hm < (x.to || '23:59'))) continue;
    return x.text;
  }
  return '';
}

// ---------- the calendar file (appointments and holidays), for Apple/Google/Outlook calendars ----------
const icsText = (t) => String(t || '').replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const icsDate = (ms) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
function ics({ name, appointments = [], holidays = [], minutes = 20 }) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Saga Techbox//Deur//NL', 'CALSCALE:GREGORIAN', `X-WR-CALNAME:${icsText(name)}`];
  const stamp = icsDate(Date.now());
  for (const a of appointments) lines.push('BEGIN:VEVENT', `UID:afspraak-${a.id}@saga-techbox`, `DTSTAMP:${stamp}`, `DTSTART:${icsDate(a.at)}`, `DTEND:${icsDate(a.at + minutes * 60e3)}`, `SUMMARY:${icsText('Afspraak: ' + (a.name || 'Bezoeker'))}`, ...(a.reason ? [`DESCRIPTION:${icsText(a.reason)}`] : []), 'END:VEVENT');
  for (const h of holidays) {
    const next = new Date(h.date + 'T12:00:00Z'); next.setUTCDate(next.getUTCDate() + 1);
    lines.push('BEGIN:VEVENT', `UID:vrij-${h.date}@saga-techbox`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${h.date.replace(/-/g, '')}`, `DTEND;VALUE=DATE:${next.toISOString().slice(0, 10).replace(/-/g, '')}`, `SUMMARY:${icsText(h.label || 'Gesloten')}`, 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  const fold = (l) => { const out = []; let s = l; while (Buffer.byteLength(s) > 74) { let n = 74; while (Buffer.byteLength(s.slice(0, n)) > 74) n--; out.push(s.slice(0, n)); s = ' ' + s.slice(n); } out.push(s); return out.join('\r\n'); };
  return lines.map(fold).join('\r\n') + '\r\n';
}

module.exports = { cleanNoteSchedule, noteFor, cleanHoursExtra, segmentsFor, hoursState, cleanCustomButtons, cleanNotifyRules, notifyPlan, cleanAutoReplies, pickAutoReply, ics, TYPES };
