'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startServer, call, login, sleep } = require('./helpers');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'schema-'));

test('the settings of the server are described for the apps, and saved from them', async (t) => {
  const srv = await startServer({ patch: true, dir: tmp() });
  t.after(() => srv.stop());
  const tok = await login(srv);
  const schema = (await call(srv, 'GET', '/api/settings-schema', undefined, tok)).json;
  const ids = schema.groups.map((g) => g.id);
  for (const want of ['deur', 'hours', 'visitors', 'buttons', 'replies', 'mail', 'screen', 'colors']) assert.ok(ids.includes(want), want);
  assert.ok(!ids.includes('system'), 'system settings are for the main account only');
  const field = (key) => schema.groups.flatMap((g) => g.fields).find((f) => f.key === key);
  assert.equal(field('name').value, 'Saga Techbox');
  assert.equal(field('mail.pass').type, 'password');

  const save = (values) => call(srv, 'POST', '/api/settings-schema/save', { values }, tok);
  const r = await save({
    name: 'Lokaal 2.14', 'texts.open.message': 'Kom maar', 'hours.enabled': true, 'hours.days': ['1', '2', '3'], 'hours.from': '08:30', 'hours.to': '16:00',
    'hours.perDay.3': { from: '09:00', to: '12:00' }, 'hours.perDay.5': { off: true }, 'hours.breaks': [{ from: '12:00', to: '12:30', label: 'Lunch' }], 'hours.holidays': [{ date: '2026-12-25', label: 'Kerst' }],
    reasons: ['Pakketje', ' ', 'Handtekening'], 'visitors.callback': true, 'layout.rotate': '90', 'dim.level': '0.3', 'sound.bell': 'chime', accent: '#0a84ff',
    customButtons: [{ label: 'Pakketje bezorgd', ask: false, askLabel: '', reply: 'Leg maar neer' }],
    autoReplies: [{ status: 'closed', type: 'bell', from: '', to: '', text: 'We zijn dicht' }],
    notifyRules: [{ type: 'bell', person: '', mute: false, ntfy: true, mail: false, webhook: true, quietFrom: '22:00', quietTo: '07:00' }],
  });
  assert.equal(r.status, 200, r.text);
  const s = (await call(srv, 'GET', '/api/admin-state', undefined, tok)).json.settings;
  assert.equal(s.name, 'Lokaal 2.14'); assert.equal(s.texts.open.message, 'Kom maar');
  assert.equal(s.hours.enabled, true); assert.deepEqual(s.hours.days, [1, 2, 3]); assert.equal(s.hours.from, '08:30');
  assert.deepEqual(s.hours.perDay['3'], { from: '09:00', to: '12:00' }); assert.deepEqual(s.hours.perDay['5'], { off: true });
  assert.equal(s.hours.breaks[0].label, 'Lunch'); assert.equal(s.hours.holidays[0].date, '2026-12-25');
  assert.deepEqual(s.reasons, ['Pakketje', 'Handtekening']); assert.equal(s.visitors.callback, true);
  assert.equal(s.layout.rotate, 90); assert.equal(s.dim.level, 0.3); assert.equal(s.sound.bell, 'chime'); assert.equal(s.accent, '#0a84ff');
  assert.equal(s.customButtons[0].reply, 'Leg maar neer'); assert.equal(s.autoReplies[0].text, 'We zijn dicht'); assert.equal(s.notifyRules[0].mail, false);
  // the day with its own times can be taken back
  assert.equal((await save({ 'hours.perDay.3': null })).status, 200);
  assert.equal((await call(srv, 'GET', '/api/admin-state', undefined, tok)).json.settings.hours.perDay['3'], undefined);
  // the mail password that comes back masked is not saved as the mask
  await call(srv, 'POST', '/api/settings', { mail: { ...s.mail, enabled: false, pass: 'geheim-wachtwoord-1' } }, tok);
  assert.equal((await save({ 'mail.pass': (await call(srv, 'GET', '/api/settings-schema', undefined, tok)).json.groups.find((g) => g.id === 'mail').fields.find((f) => f.key === 'mail.pass').value, 'mail.host': 'smtp.example.com' })).status, 200);
  await sleep(700);
  const raw = fs.readFileSync(path.join(srv.dataDir, 'state.json'), 'utf8');
  assert.ok(!raw.includes('geheim-wachtwoord-1'), 'still encrypted on disk');
  // wrong values and unknown settings are refused, nothing is changed halfway
  for (const bad of [{ 'hours.from': '25:99' }, { 'dim.level': '9' }, { accent: 'red' }, { 'nope.nothing': 1 }, { 'system.sessionDays': 5 }, { reasons: 'niet een lijst' }, { 'hours.perDay.2': { from: '10:00', to: '09:00' } }]) {
    assert.equal((await save(bad)).status, 400, JSON.stringify(bad));
  }
  assert.equal((await call(srv, 'GET', '/api/admin-state', undefined, tok)).json.settings.name, 'Lokaal 2.14');
});

test('an account that may only look sees no settings and can change none', async (t) => {
  const srv = await startServer({ patch: true, dir: tmp() });
  t.after(() => srv.stop());
  const tok = await login(srv);
  await call(srv, 'POST', '/api/users/save', { username: 'kijker', name: 'Kijker', role: 'kijker', password: 'Kijk-wachtwoord-77' }, tok);
  const k = await login(srv, 'kijker', 'Kijk-wachtwoord-77');
  assert.equal((await call(srv, 'GET', '/api/settings-schema', undefined, k)).json.groups.length, 0);
  assert.equal((await call(srv, 'POST', '/api/settings-schema/save', { values: { name: 'Gehackt' } }, k)).status, 400);
  assert.equal((await call(srv, 'GET', '/api/state')).json.settings.name, 'Saga Techbox');
});
