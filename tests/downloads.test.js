'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { startServer, call, login } = require('./helpers');

test('the download page is on by default, can be switched off, and serves only listed files', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'saga-dl-'));
  fs.mkdirSync(path.join(dir, 'data', 'downloads'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'data', 'downloads', 'app-1.0.exe'), 'hello');
  const srv = await startServer({ dir, patch: true });
  t.after(() => srv.stop());
  assert.equal((await call(srv, 'GET', '/get')).status, 200, 'on by default');
  const token = await login(srv);
  assert.equal((await call(srv, 'POST', '/api/settings', { downloads: { enabled: false } }, token)).status, 200);
  assert.equal((await call(srv, 'GET', '/get')).status, 404, 'can be switched off');
  const r = await call(srv, 'POST', '/api/settings', { downloads: { enabled: true } }, token);
  assert.equal(r.status, 200, r.text);
  const page = await call(srv, 'GET', '/get');
  assert.equal(page.status, 200);
  assert.match(page.text, /app-1\.0\.exe/);
  assert.equal((await call(srv, 'GET', '/get/app-1.0.exe')).text, 'hello');
  assert.equal((await call(srv, 'GET', '/get/..%2Fstate.json')).status, 404, 'no escaping the folder');
  assert.equal((await call(srv, 'GET', '/get/nope.exe')).status, 404);
});
