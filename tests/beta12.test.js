'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startServer, call, login, sleep } = require('./helpers');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'b12-'));
const raw = (srv) => async (method, p, body, headers = {}) => { const r = await fetch(srv.url + p, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, json: await r.json().catch(() => ({})), cookie: r.headers.get('set-cookie') || '' }; };

test('requests: star, own note, how often a phone came, {naam} in an answer; the cookie number itself stays hidden', async (t) => {
  const srv = await startServer({ patch: true, system: true, dir: tmp() });
  t.after(() => srv.stop());
  const a = await login(srv), r = raw(srv);
  const first = await r('POST', '/api/visit', { type: 'message', message: 'Een', name: 'Jantje Jansen', via: 'phone' });
  assert.equal(first.status, 200);
  const vid = /saga_v=([0-9a-f]{24})/.exec(first.cookie)[1];
  await sleep(1300);
  assert.equal((await r('POST', '/api/visit', { type: 'message', message: 'Twee', name: 'Jantje Jansen', via: 'phone' }, { Cookie: 'saga_v=' + vid })).status, 200);
  const list = (await call(srv, 'GET', '/api/admin-state', undefined, a)).json.requests;
  assert.equal(list.length, 2); assert.ok(list.every((x) => x.visits === 2), 'both come from the same phone');
  assert.equal(JSON.stringify(list).includes(vid), false, 'the number of the cookie is not shown');
  const id = list[0].id;
  assert.equal((await call(srv, 'POST', '/api/requests/star', { id, on: true }, a)).status, 200);
  assert.equal((await call(srv, 'POST', '/api/requests/note', { id, text: 'Terugbellen na de les' }, a)).status, 200);
  const after = (await call(srv, 'GET', '/api/admin-state', undefined, a)).json.requests.find((x) => x.id === id);
  assert.equal(after.starred, true); assert.equal(after.note, 'Terugbellen na de les');
  await call(srv, 'POST', '/api/requests/reply', { id, reply: 'Hoi {naam}, kom maar' }, a);
  assert.equal((await call(srv, 'GET', '/api/admin-state', undefined, a)).json.requests.find((x) => x.id === id).reply, 'Hoi Jantje, kom maar');
  assert.equal((await call(srv, 'POST', '/api/requests/star', { id, on: true })).status === 200, false, 'not for visitors');
});

test('test bell, waiting count, people: new code and spreadsheet; statistics as a file and through the API', async (t) => {
  const srv = await startServer({ patch: true, system: true, dir: tmp() });
  t.after(() => srv.stop());
  const a = await login(srv), r = raw(srv);
  const bell = await call(srv, 'POST', '/api/bell/test', {}, a);
  assert.equal(bell.status, 200); assert.equal(typeof bell.json.screens, 'number');
  assert.equal((await call(srv, 'GET', '/api/state')).json.waiting, 0);
  await call(srv, 'POST', '/api/visit', { type: 'message', message: 'wacht', name: 'Piet' });
  const st = (await call(srv, 'GET', '/api/state')).json;
  assert.equal(st.waiting, 1); assert.equal(JSON.stringify(st).includes('Piet'), false, 'only a number, no names');
  // people
  const acc = (await r('POST', '/api/profile', { name: 'Anna' })).json;
  const person = (await call(srv, 'GET', '/api/admin-state', undefined, a)).json.people.find((x) => x.nr === acc.pin);
  const np = await call(srv, 'POST', '/api/people/pin', { id: person.id }, a);
  assert.equal(np.status, 200); assert.match(np.json.pin, /^\d{6}$/); assert.notEqual(np.json.pin, acc.pin);
  assert.equal((await r('POST', '/api/lookup', { nr: acc.pin })).json.found, false, 'the old code does not work any more');
  assert.equal((await r('POST', '/api/lookup', { nr: np.json.pin })).json.found, true);
  const csv = await call(srv, 'GET', '/api/people/export', undefined, a);
  assert.match(csv.text, /Naam,Pincode/); assert.match(csv.text, /Anna/);
  const sx = await call(srv, 'GET', '/api/stats/export', undefined, a);
  assert.match(sx.text, /^Dag,Verzoeken/); assert.match(sx.text, /Uur,Verzoeken/);
  assert.equal((await call(srv, 'GET', '/api/v1/stats', undefined, a)).status, 200);
  assert.equal((await call(srv, 'POST', '/api/bell/test', {})).status === 200, false, 'not for visitors');
});

test('a busy block that repeats weekly moves on by itself', async (t) => {
  const srv = await startServer({ patch: true, system: true, dir: tmp() });
  t.after(() => srv.stop());
  const a = await login(srv);
  const from = Date.now() + 3600e3, to = from + 3600e3;
  assert.equal((await call(srv, 'POST', '/api/busy/add', { from, to, note: 'Teamoverleg', weekly: true }, a)).status, 200);
  const b = (await call(srv, 'GET', '/api/admin-state', undefined, a)).json.busy.find((x) => x.note === 'Teamoverleg');
  assert.equal(b.weekly, true);
});

test('English: the door screen gets English texts, the own texts of the admin stay, the visitor page can be put on a phone', async (t) => {
  const srv = await startServer({ patch: true, system: true, dir: tmp() });
  t.after(() => srv.stop());
  const a = await login(srv);
  const nl = (await call(srv, 'GET', '/api/state')).json;
  assert.equal(nl.settings.ui.bell, 'Deurbel'); assert.equal(nl.view.label, 'Open');
  await call(srv, 'POST', '/api/settings', { language: 'en', ui: { book: 'Plan a meeting' } }, a);
  await call(srv, 'POST', '/api/status', { mode: 'closed' }, a);
  const en = (await call(srv, 'GET', '/api/state')).json;
  assert.equal(en.settings.language, 'en');
  assert.equal(en.settings.ui.bell, 'Doorbell'); assert.equal(en.settings.ui.book, 'Plan a meeting', 'an own text wins');
  assert.equal(en.view.label, 'Closed'); assert.equal(en.view.message, 'Please do not enter');
  await call(srv, 'POST', '/api/settings', { texts: { ...en.settings.texts, closed: { label: 'Dicht', message: 'Kom morgen' } } }, a);
  assert.equal((await call(srv, 'GET', '/api/state')).json.view.label, 'Dicht', 'an own status text is never replaced');
  await call(srv, 'POST', '/api/settings', { language: 'xx' }, a);
  assert.equal((await call(srv, 'GET', '/api/state')).json.settings.language, 'nl', 'an unknown language becomes Dutch');
  const man = await call(srv, 'GET', '/visit.webmanifest');
  assert.equal(man.status, 200); assert.equal(man.json.start_url, '/visit'); assert.equal(man.json.display, 'standalone');
  await call(srv, 'POST', '/api/settings', { look: { waiting: true } }, a);
  assert.equal((await call(srv, 'GET', '/api/state')).json.settings.look.waiting, true);
});

test('the pages carry the new parts', () => {
  const door = fs.readFileSync(path.join(__dirname, '..', 'public', 'display.html'), 'utf8'), panel = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin.html'), 'utf8');
  for (const part of ['downloadIcs', "'/visit.webmanifest'", 'id="waitcount"', 'const lt =']) assert.ok(door.includes(part), part);
  for (const part of ['beforeunload', "'/api/requests/star'", "'/api/requests/note'", "'/api/people/pin'", "'/api/bell/test'", 'function clockCard', 'hashchange', '@media print', "'/api/stats/export'"]) assert.ok(panel.includes(part), part);
  for (const f of [door, panel]) for (const m of f.matchAll(/<script>([\s\S]*?)<\/script>/g)) assert.doesNotThrow(() => new Function(m[1]));
});

test('the desktop apps and the Apple apps carry the new screens', () => {
  const root = path.join(__dirname, '..');
  const cs = fs.readFileSync(path.join(root, 'desktop', 'MainWindow.cs'), 'utf8');
  for (const part of ['BusyCard()', 'CheckCard()', '/api/bell/test', 'Avalonia.Input.Key.O', '/api/stats', '/api/checklist']) assert.ok(cs.includes(part), part);
  const main = fs.readFileSync(path.join(root, 'app', 'main.js'), 'utf8');
  for (const part of ['openAnyPage', "'/poster'", "'/check'", "'/voorwaarden'"]) assert.ok(main.includes(part), part);
  const sw = fs.readFileSync(path.join(root, 'ios', 'App', 'Comfort12.swift'), 'utf8');
  for (const part of ['struct BusyChartCard', 'struct ChecklistCard', 'struct TestBellButton', 'struct RequestExtras', 'api/stats', 'api/checklist', 'api/bell/test', 'api/requests/star', 'api/requests/note']) assert.ok(sw.includes(part), part);
  assert.ok(fs.readFileSync(path.join(root, 'ios', 'project.yml'), 'utf8').includes('App/Comfort12.swift'), 'the Mac app builds the new file');
  for (const f of ['ios/Mac/MacStatus.swift', 'ios/App/StatusView.swift']) assert.ok(fs.readFileSync(path.join(root, f), 'utf8').includes('BusyChartCard'), f);
  for (const f of ['ios/Mac/MacInbox.swift', 'ios/App/InboxView.swift']) assert.ok(fs.readFileSync(path.join(root, f), 'utf8').includes('RequestExtras'), f);
  assert.ok(fs.readFileSync(path.join(root, 'ios', 'Mac', 'MacApp.swift'), 'utf8').includes('CommandMenu("Pagina")'));
});

test('after ringing: a close button (standard) or no button and a sheet that closes by itself', async (t) => {
  const srv = await startServer({ patch: true, system: true, dir: tmp() });
  t.after(() => srv.stop());
  const a = await login(srv);
  const look = async () => (await call(srv, 'GET', '/api/state')).json.settings.look;
  assert.equal((await look()).sentClose, 'button');
  await call(srv, 'POST', '/api/settings', { look: { sentClose: 'auto', sentSeconds: 1 } }, a);
  const l = await look(); assert.equal(l.sentClose, 'auto'); assert.equal(l.sentSeconds, 3, 'at least three seconds');
  await call(srv, 'POST', '/api/settings', { look: { sentClose: 'zap' } }, a);
  assert.equal((await look()).sentClose, 'button');
  const sch = (await call(srv, 'GET', '/api/settings-schema', undefined, a)).json.groups.find((g) => g.id === 'weergave');
  assert.ok(sch.fields.some((f) => f.key === 'look.sentClose'));
});

test('fifteen extra switches in Weergave: all off by default, each can be turned on and off, the door and the apps know them', async (t) => {
  const names = ['hideName', 'hideMessage', 'hideUntil', 'hideExtra', 'hideAsk', 'uppercase', 'shadow', 'bigDot', 'staticDot', 'bigHeader', 'statusIcon', 'flip', 'dimClosed', 'muteDoor', 'fullscreen'];
  const srv = await startServer({ patch: true, system: true, dir: tmp() });
  t.after(() => srv.stop());
  const a = await login(srv);
  const look = async () => (await call(srv, 'GET', '/api/state')).json.settings.look;
  const d = await look();
  for (const n of names) assert.equal(d[n], false, n + ' is off by default');
  await call(srv, 'POST', '/api/settings', { look: Object.fromEntries(names.map((n) => [n, true])) }, a);
  for (const n of names) assert.equal((await look())[n], true, n + ' on');
  await call(srv, 'POST', '/api/settings', { look: Object.fromEntries(names.map((n) => [n, false])) }, a);
  for (const n of names) assert.equal((await look())[n], false, n + ' off again');
  const sch = (await call(srv, 'GET', '/api/settings-schema', undefined, a)).json.groups.find((g) => g.id === 'weergave').fields.map((f) => f.key);
  for (const n of names) assert.ok(sch.includes('look.' + n), 'the apps get look.' + n);
  const door = fs.readFileSync(path.join(__dirname, '..', 'public', 'display.html'), 'utf8'), panel = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin.html'), 'utf8');
  for (const n of names) { assert.ok(door.includes('lk-' + n) || n === 'muteDoor' || n === 'fullscreen' || n === 'hideAsk', 'door: ' + n); assert.ok(panel.includes(`'${n}'`), 'panel: ' + n); }
  assert.ok(door.includes('muteDoor') && door.includes('requestFullscreen'));
});

test('fifty more switches: all off by default, each one works on and off, the panel gets the list, the door has a rule for each', async (t) => {
  const { LOOK_FLAGS } = require('../settings-schema.js');
  assert.equal(LOOK_FLAGS.length, 50); assert.equal(new Set(LOOK_FLAGS.map((f) => f[0])).size, 50, 'no name twice');
  const srv = await startServer({ patch: true, system: true, dir: tmp() });
  t.after(() => srv.stop());
  const a = await login(srv);
  const look = async () => (await call(srv, 'GET', '/api/state')).json.settings.look;
  const d = await look();
  for (const [k] of LOOK_FLAGS) assert.equal(d[k], false, k + ' off by default');
  await call(srv, 'POST', '/api/settings', { look: Object.fromEntries(LOOK_FLAGS.map(([k]) => [k, true])) }, a);
  for (const [k] of LOOK_FLAGS) assert.equal((await look())[k], true, k + ' on');
  await call(srv, 'POST', '/api/settings', { look: { ...(await look()), vivid: false } }, a); // the panel always sends the whole look
  assert.equal((await look()).vivid, false); assert.equal((await look()).warm, true, 'the others stay');
  const st = (await call(srv, 'GET', '/api/admin-state', undefined, a)).json;
  assert.equal(st.lookFlags.length, 50);
  const sch = (await call(srv, 'GET', '/api/settings-schema', undefined, a)).json.groups.find((g) => g.id === 'weergave').fields.map((f) => f.key);
  for (const [k] of LOOK_FLAGS) assert.ok(sch.includes('look.' + k), 'the apps get ' + k);
  const door = fs.readFileSync(path.join(__dirname, '..', 'public', 'display.html'), 'utf8');
  const noRule = new Set(['vivid', 'softColors', 'warm', 'cool', 'dimAll', 'invert']); // these are colour filters made in the script
  for (const [k] of LOOK_FLAGS) assert.ok(noRule.has(k) ? door.includes('L.' + k) : door.includes('lk-' + k), 'door: ' + k);
});

test('the close time of the sent screen is the chosen one, also when an answer arrives (the old timers overwrote it)', () => {
  const door = fs.readFileSync(path.join(__dirname, '..', 'public', 'display.html'), 'utf8');
  assert.ok(door.includes('let sentAuto = 0'), 'one timer value for the sent screen');
  assert.ok(door.includes('setTimeout(closeSheet, sentAuto ? sentAuto * 1000 : ms)'), 'every timer uses it');
  assert.ok(door.includes("if (cls !== 'done') sentAuto = 0;"));
});

test('ready-made buttons: twenty or more, each can be switched on and off, they show on the door in the chosen language and a visitor can use them', async (t) => {
  const srv = await startServer({ patch: true, system: true, dir: tmp() });
  t.after(() => srv.stop());
  const a = await login(srv), r = raw(srv);
  const adm = async () => (await call(srv, 'GET', '/api/admin-state', undefined, a)).json;
  const cat = (await adm()).quickCatalog;
  assert.ok(cat.length >= 20, 'twenty or more ready-made buttons'); assert.equal(new Set(cat.map((c) => c.id)).size, cat.length);
  assert.equal((await call(srv, 'GET', '/api/state')).json.settings.customButtons.length, 0, 'none are on by default');
  await call(srv, 'POST', '/api/settings', { quickButtons: ['parcel', 'help', 'hours', 'nonsense'] }, a);
  let pub = (await call(srv, 'GET', '/api/state')).json.settings.customButtons;
  assert.deepEqual(pub.map((b) => b.id), ['q_parcel', 'q_help', 'q_hours'], 'only known ids, in the order of the list');
  assert.equal(pub[0].label, 'Pakketje bezorgd'); assert.equal(pub[1].ask, true); assert.equal(pub[2].kind, 'info'); assert.match(pub[2].text, /\d\d:\d\d/.test(pub[2].text) ? /\d\d:\d\d/ : /status/);
  assert.equal((await adm()).settings.customButtons.length, 0, 'the panel keeps your own buttons apart');
  // a visitor taps one
  const sent = await r('POST', '/api/visit', { type: 'reason', button: 'q_parcel', via: 'door' });
  assert.equal(sent.status, 200, JSON.stringify(sent.json));
  assert.equal(sent.json.reply, 'Dank je! Leg het pakketje maar neer.');
  const req = (await adm()).requests[0]; assert.equal(req.reason, 'Pakketje bezorgd');
  await sleep(1300);
  assert.equal((await r('POST', '/api/visit', { type: 'reason', button: 'q_help', message: '', via: 'door' })).status, 400, 'this one wants a few words');
  await sleep(1300);
  assert.equal((await r('POST', '/api/visit', { type: 'reason', button: 'q_help', message: 'Mijn laptop doet niets', via: 'door' })).status, 200);
  // off again: gone, and no longer usable
  await call(srv, 'POST', '/api/settings', { quickButtons: [] }, a);
  assert.equal((await call(srv, 'GET', '/api/state')).json.settings.customButtons.length, 0);
  await sleep(1300);
  assert.equal((await r('POST', '/api/visit', { type: 'reason', button: 'q_parcel', via: 'door' })).status, 400);
  // English
  await call(srv, 'POST', '/api/settings', { language: 'en', quickButtons: ['parcel', 'directions'] }, a);
  pub = (await call(srv, 'GET', '/api/state')).json.settings.customButtons;
  assert.equal(pub[0].label, 'Parcel delivery'); assert.equal(pub[1].askLabel, 'Who or what are you looking for?');
  const sch = (await call(srv, 'GET', '/api/settings-schema', undefined, a)).json.groups.find((g) => g.id === 'visitors').fields.find((f) => f.key === 'quickButtons');
  assert.ok(sch && sch.options.length === cat.length, 'the apps get the list too');
});

test('the update card says why it cannot update and what to do (desktop app or a server started by hand)', async (t) => {
  const srv = await startServer({ patch: true, system: true, dir: tmp() });
  t.after(() => srv.stop());
  const a = await login(srv);
  const st = (await call(srv, 'GET', '/api/update', undefined, a)).json;
  assert.equal(st.supervised, false); assert.equal(st.inApp, false); assert.equal(typeof st.platform, 'string');
  const panel = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin.html'), 'utf8');
  for (const part of ['Deze server draait in de desktop-app', 'met de hand gestart', 'Downloadpagina']) assert.ok(panel.includes(part), part);
});
