'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startServer, call, login, sleep } = require('./helpers');
const schedule = require('../schedule.js');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'feat-'));

test('buttons: every kind is kept, wrong values are cleaned, the note schedule picks the right day', () => {
  const l = schedule.cleanCustomButtons([
    { label: 'Wifi', kind: 'wifi', ssid: 'Techbox', wifiPass: 'geheim', wifiType: 'WPA', icon: '📶', color: '#0a84ff', when: 'open' },
    { label: 'Bel mij', kind: 'phone', phone: '06 12345678', when: 'nonsense', color: 'rood' },
    { label: 'Info', kind: 'wat', text: 'x'.repeat(900) },
    { label: '' },
  ]);
  assert.equal(l.length, 3);
  assert.equal(l[0].kind, 'wifi'); assert.equal(l[0].color, '#0a84ff'); assert.equal(l[0].when, 'open');
  assert.equal(l[1].when, 'always'); assert.equal(l[1].color, ''); assert.equal(l[2].kind, 'form'); assert.equal(l[2].text.length, 600);
  const notes = schedule.cleanNoteSchedule([{ from: '2026-12-24', to: '2026-12-26', text: 'Kerst: gesloten' }, { from: 'x', text: 'weg' }, { from: '2026-10-01', text: 'Een dag' }]);
  assert.equal(notes.length, 2);
  assert.equal(schedule.noteFor(notes, '2026-12-25'), 'Kerst: gesloten'); assert.equal(schedule.noteFor(notes, '2026-12-27'), '');
  assert.equal(schedule.noteFor(notes, '2026-10-01'), 'Een dag', 'without an end date it is one day');
});

test('the new look options are kept inside their limits and the apps get the fields', async (t) => {
  const srv = await startServer({ patch: true, system: true, dir: tmp() });
  t.after(() => srv.stop());
  const a = await login(srv);
  await call(srv, 'POST', '/api/settings', { look: { buttons: { place: 'side', size: 'large', columns: 99 }, slides: { enabled: true, seconds: 1, items: ['Een', '', 'Twee'] }, event: { enabled: true, label: 'Vakantie', date: '2027-07-10' }, greeting: true, bellFlash: 'zap', dot: 'bar', align: 'right', margin: 50, reloadAt: '25:61', mirror: true, glow: false } }, a);
  const l = (await call(srv, 'GET', '/api/state')).json.settings.look;
  assert.deepEqual(l.buttons, { place: 'side', size: 'large', columns: 4 });
  assert.equal(l.slides.seconds, 3); assert.deepEqual(l.slides.items, ['Een', 'Twee']);
  assert.equal(l.event.date, '2027-07-10'); assert.equal(l.bellFlash, 'none'); assert.equal(l.dot, 'bar'); assert.equal(l.align, 'right'); assert.equal(l.margin, 12); assert.equal(l.reloadAt, ''); assert.equal(l.mirror, true); assert.equal(l.glow, false);
  const sch = (await call(srv, 'GET', '/api/settings-schema', undefined, a)).json.groups;
  assert.ok(sch.find((g) => g.id === 'weergave').fields.length >= 40, 'forty look fields');
  assert.ok(sch.find((g) => g.id === 'share'), 'the share group'); assert.ok(sch.find((g) => g.id === 'buttons').fields.some((f) => f.key === 'noteSchedule'));
  // a button of every kind, saved the way the apps do it
  const rec = [{ icon: '📶', label: 'Wifi', kind: 'wifi', when: 'open', color: '#30d158', ssid: 'Techbox', wifiPass: 'pw', wifiType: 'WPA', ask: false, askLabel: '', reply: '', text: '', url: '', phone: '' }];
  assert.equal((await call(srv, 'POST', '/api/settings-schema/save', { values: { customButtons: rec, 'quiet.enabled': true, 'quiet.from': '19:00', 'quiet.to': '07:00' } }, a)).status, 200);
  const st = (await call(srv, 'GET', '/api/state')).json.settings;
  assert.equal(st.customButtons[0].kind, 'wifi'); assert.equal(st.customButtons[0].ssid, 'Techbox');
  assert.equal(st.quiet, undefined, 'the quiet hours are not shown to the door screen');
});

test('the door shows the planned note of today and nothing of the planning itself', async (t) => {
  const srv = await startServer({ patch: true, system: true, dir: tmp() });
  t.after(() => srv.stop());
  const a = await login(srv);
  const d = new Date(), day = (n) => { const x = new Date(d.getTime() + n * 864e5); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
  await call(srv, 'POST', '/api/settings', { note: 'Gewoon bericht', noteSchedule: [{ from: day(-1), to: day(1), text: 'Vandaag geen spreekuur' }, { from: day(5), to: day(6), text: 'Later' }] }, a);
  const pub = (await call(srv, 'GET', '/api/state')).json.settings;
  assert.equal(pub.note, 'Vandaag geen spreekuur'); assert.equal(pub.noteSchedule, undefined);
  assert.equal((await call(srv, 'GET', '/api/admin-state', undefined, a)).json.settings.note, 'Gewoon bericht', 'the panel keeps your own note');
});

test('statistics, the spreadsheet export and the privacy search and erase', async (t) => {
  const srv = await startServer({ patch: true, system: true, dir: tmp() });
  t.after(() => srv.stop());
  const a = await login(srv);
  assert.equal((await call(srv, 'GET', '/api/stats')).status === 200, false, 'not for visitors');
  await call(srv, 'POST', '/api/visit', { type: 'message', name: 'Jantje Jansen', message: 'Hallo daar', email: 'jantje@example.com', topic: 'Printer' });
  await sleep(1300);
  assert.equal((await call(srv, 'POST', '/api/visit', { type: 'bell', name: 'Pietje Puk' })).status, 200);
  const stats = (await call(srv, 'GET', '/api/stats?days=30', undefined, a)).json;
  assert.equal(stats.total, 2); assert.equal(stats.byHour.length, 24); assert.equal(stats.byDay.length, 30); assert.equal(stats.byType.bell, 1);
  assert.equal(JSON.stringify(stats).includes('Jantje'), false, 'counts only, no names');
  const csv = await call(srv, 'GET', '/api/requests/export', undefined, a);
  assert.equal(csv.status, 200); assert.match(csv.text, /Tijd,Soort,Naam/); assert.match(csv.text, /Jantje Jansen/);
  assert.equal((await call(srv, 'POST', '/api/privacy/search', { q: 'j' }, a)).status, 400, 'too short');
  const found = (await call(srv, 'POST', '/api/privacy/search', { q: 'jantje@example' }, a)).json;
  assert.equal(found.requests.length, 1); assert.equal(found.requests[0].name, 'Jantje Jansen');
  const gone = (await call(srv, 'POST', '/api/privacy/erase', { q: 'jantje jansen' }, a)).json;
  assert.equal(gone.requests, 1); assert.ok(gone.logMentions >= 1, 'the log still mentions the name and says so');
  const after = (await call(srv, 'GET', '/api/admin-state', undefined, a)).json;
  assert.equal(after.requests.some((r) => r.name === 'Jantje Jansen'), false); assert.equal(after.requests.some((r) => r.name === 'Pietje Puk'), true);
  const hist = (await call(srv, 'GET', '/api/audit/export?format=json', undefined, a)).text;
  assert.equal(hist.includes('Erased'), false); assert.equal(/wiste de gegevens van één persoon/.test(hist), true); assert.equal(hist.toLowerCase().includes('wiste') && hist.includes('jantje jansen'), false, 'the search word is not written down by the erase');
});

test('the public status: off by default, then json, badge and widget; poster and widget pages exist; a rollback needs a guarded server', async (t) => {
  const srv = await startServer({ patch: true, system: true, dir: tmp() });
  t.after(() => srv.stop());
  const a = await login(srv);
  assert.equal((await call(srv, 'GET', '/status.json')).status, 404); assert.equal((await call(srv, 'GET', '/badge.svg')).status, 404);
  await call(srv, 'POST', '/api/settings', { publicStatus: { enabled: true }, name: 'Deur <b>1' }, a);
  const j = await call(srv, 'GET', '/status.json');
  assert.equal(j.status, 200); assert.ok(['open', 'closed', 'busy'].includes(j.json.mode)); assert.equal(j.json.label.length > 0, true);
  const svg = await call(srv, 'GET', '/badge.svg');
  assert.equal(svg.status, 200); assert.match(svg.text, /^<svg/); assert.equal(svg.text.includes('<b>'), false, 'no markup from the name');
  for (const p of ['/widget', '/poster']) { const r = await call(srv, 'GET', p); assert.equal(r.status, 200, p); assert.match(r.text, /<html/); }
  const rb = await call(srv, 'POST', '/api/update/rollback', {}, a);
  assert.equal(rb.status, 400); assert.match(rb.json.error, /bewaakt/);
});

test('rollback: back to the version before the update, or to the disk when there was none', () => {
  const U = require('../updates.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rb-')), root = path.join(dir, 'app');
  for (const v of ['1.0.0-beta.1', '1.0.0-beta.2']) { fs.mkdirSync(path.join(root, v), { recursive: true }); fs.writeFileSync(path.join(root, v, 'server.js'), ''); }
  const u = U.create({ dataDir: dir, appDir: dir, currentVersion: '1.0.0-beta.2', getToken: () => '', getChannel: () => 'beta', fetchJson: async () => [], fetchFile: async () => Buffer.alloc(0) });
  assert.equal(u.canRollback(), false); assert.throws(() => u.rollback(), /geen update/);
  fs.writeFileSync(path.join(root, 'current.json'), JSON.stringify({ version: '1.0.0-beta.2', dir: '1.0.0-beta.2', previous: { version: '1.0.0-beta.1', dir: '1.0.0-beta.1' } }));
  assert.equal(u.canRollback(), true);
  assert.equal(u.rollback().version, '1.0.0-beta.1');
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'current.json'), 'utf8')).dir, '1.0.0-beta.1');
  assert.equal(u.rollback().version, '', 'then to the disk'); assert.equal(fs.existsSync(path.join(root, 'current.json')), false);
});
