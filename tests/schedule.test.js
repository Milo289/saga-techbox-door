'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const s = require('../schedule.js');

const base = { enabled: true, days: [1, 2, 3, 4, 5], from: '09:00', to: '17:00' };
const at = (y, m, d, hh, mm) => new Date(y, m - 1, d, hh, mm).getTime();

test('opening hours: plain weekdays still work', () => {
  assert.equal(s.hoursState(base, at(2026, 10, 12, 10, 0)).open, true); // Monday
  const sat = s.hoursState(base, at(2026, 10, 17, 10, 0));
  assert.equal(sat.open, false); assert.equal(sat.changeAt, at(2026, 10, 19, 9, 0));
  assert.equal(s.hoursState({ ...base, enabled: false }, Date.now()), null);
});
test('opening hours: other times per day, a day off, a break and a holiday', () => {
  const h = { ...base, ...s.cleanHoursExtra({ perDay: { 3: { from: '08:00', to: '12:00' }, 5: { off: true }, 6: { from: '10:00', to: '14:00' } }, breaks: [{ from: '12:00', to: '13:00' }], holidays: [{ date: '2026-10-14', label: 'Studiedag' }] }) };
  assert.equal(s.hoursState(h, at(2026, 10, 12, 11, 59)).open, true);
  const lunch = s.hoursState(h, at(2026, 10, 12, 12, 30));
  assert.equal(lunch.open, false); assert.equal(lunch.changeAt, at(2026, 10, 12, 13, 0));
  assert.equal(s.hoursState(h, at(2026, 10, 12, 13, 0)).open, true);
  const holiday = s.hoursState(h, at(2026, 10, 14, 10, 0)); // a Wednesday, but a holiday
  assert.equal(holiday.open, false); assert.equal(holiday.changeAt, at(2026, 10, 15, 9, 0));
  const fri = s.hoursState(h, at(2026, 10, 16, 10, 0)); // Friday is off
  assert.equal(fri.open, false); assert.equal(fri.changeAt, at(2026, 10, 17, 10, 0)); // Saturday has its own hours
  assert.equal(s.hoursState(h, at(2026, 10, 17, 10, 0)).open, true);
});
test('opening hours: nonsense is cleaned away', () => {
  const x = s.cleanHoursExtra({ perDay: { 1: { from: '25:00', to: '26:00' }, 9: { off: true }, 2: 'x' }, breaks: [{ from: '13:00', to: '12:00' }, null], holidays: [{ date: 'morgen' }, { date: '2026-12-25', label: 'Kerst' }] });
  assert.deepEqual(x.perDay, {}); assert.deepEqual(x.breaks, []); assert.equal(x.holidays.length, 1);
});
test('notification rules: first match decides, quiet hours, mute, default is everything', () => {
  const rules = s.cleanNotifyRules([{ type: 'bell', quietFrom: '22:00', quietTo: '07:00' }, { person: 'jan', mute: true }, { type: 'message', mail: false }]);
  assert.deepEqual(s.notifyPlan([], { type: 'bell' }), { ntfy: true, webhook: true, mail: true, rule: '' });
  assert.equal(s.notifyPlan(rules, { type: 'bell' }, new Date(2026, 9, 12, 23, 0)).ntfy, false);
  assert.equal(s.notifyPlan(rules, { type: 'bell' }, new Date(2026, 9, 12, 12, 0)).ntfy, true);
  assert.equal(s.notifyPlan(rules, { type: 'reason', name: 'Jan de Vries' }, new Date(2026, 9, 12, 12, 0)).ntfy, false);
  const m = s.notifyPlan(rules, { type: 'message', name: 'Piet' }, new Date(2026, 9, 12, 12, 0));
  assert.equal(m.mail, false); assert.equal(m.ntfy, true);
});
test('automatic replies: by status, type, days and time', () => {
  const rules = s.cleanAutoReplies([{ status: 'closed', type: 'bell', text: 'We zijn dicht.' }, { status: 'busy', from: '09:00', to: '12:00', days: [1], text: 'In overleg tot twaalf.' }, { text: 'Standaard' }]);
  assert.equal(s.pickAutoReply(rules, { mode: 'closed', type: 'bell' }), 'We zijn dicht.');
  assert.equal(s.pickAutoReply(rules, { mode: 'busy', type: 'message' }, new Date(2026, 9, 12, 10, 0)), 'In overleg tot twaalf.');
  assert.equal(s.pickAutoReply(rules, { mode: 'busy', type: 'message' }, new Date(2026, 9, 12, 14, 0)), 'Standaard');
  assert.equal(s.pickAutoReply([], { mode: 'open', type: 'bell' }), '');
});
test('custom buttons are cleaned', () => {
  const b = s.cleanCustomButtons([{ label: ' Pakketje ', ask: 1 }, { label: '' }, null]);
  assert.equal(b.length, 1); assert.equal(b[0].label, 'Pakketje'); assert.equal(b[0].ask, true);
});
test('the calendar file is valid and escapes text', () => {
  const t = s.ics({ name: 'Deur; test', appointments: [{ id: 'a1', at: Date.UTC(2026, 9, 12, 8, 0), name: 'Jan, de Vries', reason: 'Vraag\nover cijfers' }], holidays: [{ date: '2026-12-25', label: 'Kerst' }] });
  assert.ok(t.startsWith('BEGIN:VCALENDAR\r\n') && t.endsWith('END:VCALENDAR\r\n'));
  assert.match(t, /DTSTART:20261012T080000Z/); assert.match(t, /DTEND:20261012T082000Z/);
  assert.match(t, /SUMMARY:Afspraak: Jan\\, de Vries/); assert.match(t, /DESCRIPTION:Vraag\\nover cijfers/);
  assert.match(t, /DTSTART;VALUE=DATE:20261225/); assert.match(t, /DTEND;VALUE=DATE:20261226/);
  assert.ok(t.split('\r\n').every((l) => Buffer.byteLength(l) <= 75));
});
