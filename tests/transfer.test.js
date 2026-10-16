'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startServer, call, login, sleep } = require('./helpers');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'transfer-'));

test('everything of an old server can be pulled into a new one, with the accounts', async (t) => {
  const oldSrv = await startServer({ patch: true, system: true, dir: tmp() });
  const newSrv = await startServer({ patch: true, system: true, dir: tmp() });
  t.after(() => Promise.all([oldSrv.stop(), newSrv.stop()]));
  const o = await login(oldSrv), n = await login(newSrv);
  await call(oldSrv, 'POST', '/api/settings', { name: 'Oude deur', reasons: ['Eén', 'Twee'], mail: { enabled: false, host: 'smtp.example.com', port: 587, user: 'u@example.com', pass: 'Geheim-oud-wachtwoord', from: 'u@example.com', adminTo: '', confirm: true, reply: true, notifyAdmin: false, digest: false, digestAt: '18:00' }, customButtons: [{ label: 'Pakketje', reply: 'Leg maar neer' }] }, o);
  assert.equal((await call(oldSrv, 'POST', '/api/visit', { type: 'message', message: 'Een bericht van vroeger' })).status, 200);

  const bad = (body) => call(newSrv, 'POST', '/api/transfer/pull', body, n);
  assert.equal((await bad({ url: '', username: 'admin', password: 'x' })).status, 400, 'an address is needed');
  assert.equal((await bad({ url: oldSrv.url, username: 'admin', password: 'fout-wachtwoord' })).status, 400, 'a wrong password');
  assert.equal((await bad({ url: 'http://127.0.0.1:9', username: 'admin', password: 'x' })).status, 400, 'nobody there');
  assert.equal((await call(newSrv, 'GET', '/api/state')).json.settings.name, 'Saga Techbox', 'nothing changed by the failures');

  const r = await bad({ url: oldSrv.url, username: 'admin', password: 'admin-start-123' });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.full, true); assert.equal(r.json.accounts, true);
  const st = (await call(newSrv, 'GET', '/api/admin-state', undefined, await login(newSrv))).json; // the accounts changed: log in again
  assert.equal(st.settings.name, 'Oude deur'); assert.deepEqual(st.settings.reasons, ['Eén', 'Twee']);
  assert.equal(st.settings.customButtons[0].reply, 'Leg maar neer');
  assert.ok(st.requests.some((x) => x.message === 'Een bericht van vroeger'), 'the visitors come along');
  // the accounts of the old server come along (here only the start account)
  assert.equal(r.json.users, 1);
  // secrets are stored encrypted on the new server
  await sleep(700);
  assert.ok(!fs.readFileSync(path.join(newSrv.dataDir, 'state.json'), 'utf8').includes('Geheim-oud-wachtwoord'));
  // and the mail password still works there (it comes back masked, not lost)
  assert.equal(st.settings.mail.pass, '••••••••');
});

test('only the main account can move data, and the old server keeps working', async (t) => {
  const srv = await startServer({ patch: true, dir: tmp() }); // admin without the system right
  t.after(() => srv.stop());
  const tok = await login(srv);
  assert.equal((await call(srv, 'POST', '/api/transfer/pull', { url: 'http://127.0.0.1:1', username: 'a', password: 'b' }, tok)).status, 404);
  assert.equal((await call(srv, 'GET', '/api/transfer/export', undefined, tok)).status, 404);
});

test('the data can also travel as a file: download here, put it back there', async (t) => {
  const a = await startServer({ patch: true, system: true, dir: tmp() });
  const b = await startServer({ patch: true, system: true, dir: tmp() });
  t.after(() => Promise.all([a.stop(), b.stop()]));
  const ta = await login(a), tb = await login(b);
  await call(a, 'POST', '/api/settings', { name: 'Uit een bestand', reasons: ['Alleen hier'] }, ta);
  const file = await fetch(`${a.url}/api/transfer/export`, { headers: { Authorization: `Bearer ${ta}` } }).then((r) => r.text());
  const data = JSON.parse(file);
  assert.equal(data.transfer, true); assert.equal(data.sessions, undefined, 'sessions never travel'); assert.equal(data.rootLock, undefined);
  assert.equal((await call(b, 'POST', '/api/transfer/import', { version: 1, settings: {} }, tb)).status, 400, 'a file of another kind is refused');
  const r = await call(b, 'POST', '/api/transfer/import', data, tb);
  assert.equal(r.status, 200, r.text);
  assert.equal((await call(b, 'GET', '/api/state')).json.settings.name, 'Uit een bestand');
  // an ordinary back-up of an older server (without accounts) works too
  const old = (await call(a, 'GET', '/api/export', undefined, ta)).json;
  const r2 = await call(b, 'POST', '/api/transfer/import', old, await login(b));
  assert.equal(r2.status, 200, r2.text); assert.equal(r2.json.full, false);
});
