'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startServer, call, login, sleep } = require('./helpers');

test('the checklist says what is missing and clears when it is done', async (t) => {
  const srv = await startServer({ patch: true });
  t.after(() => srv.stop());
  const tok = await login(srv);
  const health = async () => (await call(srv, 'GET', '/api/admin-state', undefined, tok)).json.health;
  let h = await health();
  assert.ok(h.find((x) => x.id === 'name' && !x.ok && x.tip), 'default name is a tip');
  await call(srv, 'POST', '/api/settings', { name: 'Techbox 3', ntfyTopic: 'mijn-deur' }, tok);
  h = await health();
  assert.equal(h.find((x) => x.id === 'name').ok, true);
  assert.equal(h.find((x) => x.id === 'notify').ok, true);
});

test('the RFID address works like the tag address', async (t) => {
  const srv = await startServer({ patch: true, env: { DOOR_LOCK_DRYRUN: '1' } });
  t.after(() => srv.stop());
  const tok = await login(srv);
  const key = (await call(srv, 'POST', '/api/keys/create', { name: 'lezer', perms: ['unlock'] }, tok)).json.key;
  await call(srv, 'POST', '/api/integrations/save', { lock: { enabled: true, url: 'http://lock.invalid/', tags: [{ uid: '1234ABCD', name: 'Sam' }] } }, tok);
  const r = await call(srv, 'POST', '/api/door/rfid', { uid: '12 34 ab cd' }, key);
  assert.equal(r.json.allowed, true);
  assert.equal(r.json.name, 'Sam');
});

test('the start-up status is applied when the server starts', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'saga-start-'));
  let srv = await startServer({ patch: true, dir });
  let tok = await login(srv);
  await call(srv, 'POST', '/api/settings', { startup: { status: 'closed', message: 'Zo terug' } }, tok);
  await call(srv, 'POST', '/api/status', { mode: 'open' }, tok);
  await srv.stop(); await sleep(300);
  srv = await startServer({ patch: true, dir });
  t.after(() => srv.stop());
  tok = await login(srv);
  const v = (await call(srv, 'GET', '/api/v1/status', undefined, tok)).json;
  assert.equal(v.mode, 'closed');
  assert.match(JSON.stringify(v), /Zo terug/);
});
