'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startServer, call, login } = require('./helpers');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'extras-'));

test('extra door buttons: one tap, optional text, own automatic reply', async (t) => {
  const srv = await startServer({ patch: true, dir: tmp() });
  t.after(() => srv.stop());
  const tok = await login(srv);
  await call(srv, 'POST', '/api/settings', { customButtons: [{ id: 'pak', label: 'Pakketje bezorgd', reply: 'Leg het maar neer, dank!' }, { id: 'vraag', label: 'Ik moet iets inleveren', ask: true, askLabel: 'Wat lever je in?' }, { label: '' }] }, tok);
  const pub = (await call(srv, 'GET', '/api/state')).json;
  assert.equal(pub.settings.customButtons.length, 2);
  assert.equal(pub.settings.notifyRules, undefined, 'private settings stay private');
  const one = await call(srv, 'POST', '/api/visit', { button: 'pak' });
  assert.equal(one.status, 200, one.text); assert.equal(one.json.reply, 'Leg het maar neer, dank!');
  await new Promise((r) => setTimeout(r, 1200));
  assert.equal((await call(srv, 'POST', '/api/visit', { button: 'vraag' })).status, 400, 'text is compulsory when the button asks');
  await new Promise((r) => setTimeout(r, 1200));
  assert.equal((await call(srv, 'POST', '/api/visit', { button: 'vraag', message: 'Een werkstuk' })).status, 200);
  await new Promise((r) => setTimeout(r, 1200));
  assert.equal((await call(srv, 'POST', '/api/visit', { button: 'bestaatniet' })).status, 400);
  const inbox = (await call(srv, 'GET', '/api/admin-state', undefined, tok)).json.requests;
  assert.ok(inbox.some((r) => r.reason === 'Pakketje bezorgd'));
});

test('opening hours per day with a holiday change the status the door shows', async (t) => {
  const srv = await startServer({ patch: true, dir: tmp() });
  t.after(() => srv.stop());
  const tok = await login(srv);
  const d = new Date(), today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const all = { enabled: true, days: [0, 1, 2, 3, 4, 5, 6], from: '00:00', to: '23:59', holidays: [], breaks: [], perDay: {} };
  await call(srv, 'POST', '/api/settings', { hours: all }, tok);
  assert.equal((await call(srv, 'GET', '/api/state')).json.view.mode, 'open');
  await call(srv, 'POST', '/api/settings', { hours: { ...all, holidays: [{ date: today, label: 'Studiedag' }] } }, tok);
  assert.equal((await call(srv, 'GET', '/api/state')).json.view.mode, 'closed');
  const back = (await call(srv, 'GET', '/api/admin-state', undefined, tok)).json.settings.hours;
  assert.equal(back.holidays[0].label, 'Studiedag');
});

test('automatic reply per status and the calendar link', async (t) => {
  const srv = await startServer({ patch: true, dir: tmp() });
  t.after(() => srv.stop());
  const tok = await login(srv);
  await call(srv, 'POST', '/api/settings', { autoReplies: [{ status: 'open', type: 'message', text: 'Ik kom zo bij je.' }] }, tok);
  const r = await call(srv, 'POST', '/api/visit', { type: 'message', message: 'Hoi' });
  assert.equal(r.json.reply, 'Ik kom zo bij je.');
  assert.equal((await call(srv, 'GET', '/calendar.ics')).status, 404);
  const link = (await call(srv, 'POST', '/api/calendar/token', {}, tok)).json;
  assert.ok(link.enabled);
  const ics = await call(srv, 'GET', link.path);
  assert.equal(ics.status, 200); assert.match(ics.text, /BEGIN:VCALENDAR/);
  assert.equal((await call(srv, 'GET', '/calendar.ics?token=fout')).status, 404);
  await call(srv, 'POST', '/api/calendar/token', { off: true }, tok);
  assert.equal((await call(srv, 'GET', link.path)).status, 404, 'the old link stops working');
});

test('the name on the network reports what it hears, for the test page', async (t) => {
  const srv = await startServer({ patch: true, dir: tmp() }); // the tests switch the announcing off
  t.after(() => srv.stop());
  const tok = await login(srv);
  const r = await call(srv, 'GET', '/api/mdns', undefined, tok);
  assert.equal(r.status, 200); assert.equal(r.json.enabled, false);
  for (const k of ['running', 'queries', 'answered', 'names']) assert.ok(k in r.json, k);
  assert.equal((await call(srv, 'GET', '/api/mdns')).status, 401);
});
test('the firewall of the Linux disk lets the multicast membership questions through', () => {
  const rules = fs.readFileSync(path.join(__dirname, '..', 'linux-iso', 'config', 'includes.chroot', 'etc', 'nftables.conf'), 'utf8');
  assert.match(rules, /ip protocol igmp accept/); assert.match(rules, /5353/);
});
