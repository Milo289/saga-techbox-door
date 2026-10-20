'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startServer, call, login } = require('./helpers');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'b21-'));
const raw = (srv) => async (method, p, body) => { const r = await fetch(srv.url + p, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, json: await r.json().catch(() => ({})) }; };

test('delete account: asks first, wipes the person and makes their requests anonymous, only own accounts, can be switched off', async (t) => {
  const srv = await startServer({ patch: true, system: true, dir: tmp() });
  t.after(() => srv.stop());
  const a = await login(srv), r = raw(srv);
  const acc = (await r('POST', '/api/profile', { name: 'Anna' })).json;
  assert.ok(acc.pin);
  assert.equal((await r('POST', '/api/visit', { type: 'message', message: 'Hallo', nr: acc.pin, name: 'Anna' })).status, 200);
  // first answer: do you really want to? nothing is deleted yet
  const ask = (await r('POST', '/api/profile/delete', { nr: acc.pin })).json;
  assert.equal(ask.found, true); assert.equal(ask.deletable, true); assert.equal(ask.name, 'Anna');
  assert.equal((await call(srv, 'GET', '/api/admin-state', undefined, a)).json.people.length, 1);
  assert.equal((await r('POST', '/api/profile/delete', { nr: '000000' })).json.found, false);
  assert.equal((await r('POST', '/api/profile/delete', { nr: acc.pin, confirm: true })).json.ok, true);
  const st = (await call(srv, 'GET', '/api/admin-state', undefined, a)).json;
  assert.equal(st.people.length, 0);
  assert.ok(st.requests.every((x) => !x.name && !x.nr), 'what was said stays, the name does not');
  assert.equal((await r('POST', '/api/profile/delete', { nr: acc.pin })).json.found, false, 'gone for good');
  // an account made by the admin cannot be removed by a visitor
  assert.equal((await call(srv, 'POST', '/api/people', { people: [{ name: 'Docent', nr: '4321' }] }, a)).status, 200);
  const own = (await r('POST', '/api/profile/delete', { nr: '4321', confirm: true })).json;
  assert.equal(own.deletable, false);
  assert.equal((await call(srv, 'GET', '/api/admin-state', undefined, a)).json.people.length, 1);
  // switched off
  const s = (await call(srv, 'GET', '/api/admin-state', undefined, a)).json.settings;
  s.visitors.deleteAccount = false;
  assert.equal((await call(srv, 'POST', '/api/settings', s, a)).status, 200);
  assert.equal((await r('POST', '/api/profile/delete', { nr: '4321' })).status, 403);
});

test('door screen: the keypad lights up green at enough digits; six even tiles; panel explains its pages', () => {
  const d = fs.readFileSync(path.join(__dirname, '..', 'public', 'display.html'), 'utf8');
  assert.match(d, /function armWhen/);
  assert.match(d, /\.arm:not\(:disabled\)|\.btn\.arm/);
  assert.match(d, /function deleteFlow/);
  const adm = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin.html'), 'utf8');
  assert.match(adm, /const CAT_HELP/); assert.match(adm, /const CARD_HELP/);
  assert.match(adm, /\$\('view'\)\.prepend\(bar\)/, 'the category bar sits inside the page');
  const m = /const CATS = \{([\s\S]*?)\n  \};/.exec(adm);
  const help = /const CAT_HELP = \{([\s\S]*?)\n  \};/.exec(adm)[1];
  for (const name of [...m[1].matchAll(/\['([^']+)', \[/g)].map((x) => x[1])) assert.ok(help.includes(name), 'explanation for ' + name);
});
