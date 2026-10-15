'use strict';
// Attacks against our own server, written as tests: each one must keep failing.
const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('net');
const fs = require('fs');
const path = require('path');
const { startServer, call, login, sleep, ROOT } = require('./helpers');
const integ = require('../integrations.js');

const raw = (port, data, ms = 1500) => new Promise((res) => {
  const s = net.connect(port, '127.0.0.1'); let out = '';
  s.on('data', (d) => { out += d; }); s.on('close', () => res(out)); s.on('error', () => res(out));
  s.write(data); setTimeout(() => { s.destroy(); res(out); }, ms);
});

test('path tricks never reach the source code', async (t) => {
  const srv = await startServer({ patch: true });
  t.after(() => srv.stop());
  for (const p of ['/..%2f..%2fserver.js', '/%2e%2e/%2e%2e/server.js', '/..%5cserver.js', '//etc/passwd', '/public/../server.js', '/%00', '/..%252fserver.js', '/./../server.js', '/access.js', '/data/state.json']) {
    const r = await raw(srv.port, `GET ${p} HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`);
    assert.match(r.split('\r\n')[0], /404/, p);
    assert.ok(!/use strict|require\(|scrypt\$/.test(r), `${p} leaked something`);
  }
});

test('poisoned JSON keys are dropped; broken and huge requests are refused', async (t) => {
  const srv = await startServer({ patch: true });
  t.after(() => srv.stop());
  const tok = await login(srv);
  const r = await call(srv, 'POST', '/api/settings', JSON.parse('{"__proto__":{"polluted":"yes"},"constructor":{"prototype":{"p":1}},"name":"Veilig"}'), tok);
  assert.equal(r.status, 200);
  const st = (await call(srv, 'GET', '/api/admin-state', undefined, tok)).json;
  assert.equal(st.settings.name, 'Veilig');
  assert.equal(Object.prototype.polluted, undefined);
  assert.equal(({}).polluted, undefined);
  assert.equal((await call(srv, 'POST', '/api/visit', '{broken')).status >= 400, true);
  const big = await raw(srv.port, `POST /api/visit HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\nContent-Length: 5000000\r\nConnection: close\r\n\r\n${'a'.repeat(1200000)}`, 2500);
  assert.ok(!/^HTTP\/1.1 200/.test(big));
  assert.equal((await call(srv, 'GET', '/healthz')).status, 200, 'still alive');
});

test('a connection that sends its request a byte at a time is closed (slowloris)', async (t) => {
  const srv = await startServer({ env: { DOOR_HEADER_TIMEOUT_MS: '1500' } });
  t.after(() => srv.stop());
  const t0 = Date.now();
  const out = await new Promise((res) => { const s = net.connect(srv.port, '127.0.0.1'); let o = ''; s.on('data', (d) => { o += d; }); s.on('close', () => res(o)); s.write('GET / HTTP/1.1\r\nHost: x\r\nX-a: '); setTimeout(() => { s.destroy(); res('OPEN'); }, 9000); });
  assert.notEqual(out, 'OPEN', 'the connection was still open after 9 seconds');
  assert.ok(Date.now() - t0 < 9000);
});

test('flood protection: a flood is answered with 429 and then banned, other addresses are unaffected', async (t) => {
  const srv = await startServer({ env: { DOOR_RATE_TEST: '1', DOOR_RATE_BURST: '40', DOOR_RATE_PER_SEC: '5', TRUST_PROXY: '1' } });
  t.after(() => srv.stop());
  const hit = (ip) => fetch(`${srv.url}/api/state`, { headers: { 'X-Forwarded-For': ip } }).then((r) => r.status);
  const codes = await Promise.all(Array.from({ length: 220 }, () => hit('10.1.1.1')));
  assert.ok(codes.includes(200), 'the first requests are fine (a page needs a burst)');
  assert.ok(codes.filter((c) => c === 429).length > 100, 'the flood is slowed down');
  const banned = await fetch(`${srv.url}/api/state`, { headers: { 'X-Forwarded-For': '10.1.1.1' } });
  assert.equal(banned.status, 429);
  assert.ok(Number(banned.headers.get('retry-after')) > 0);
  assert.equal(await hit('10.2.2.2'), 200, 'someone else is not affected');
  const log = (await call(srv, 'GET', '/healthz')).status;
  assert.ok(log === 200 || log === 429);
});

test('open live connections per address are capped', async (t) => {
  const srv = await startServer({ env: { DOOR_RATE_TEST: '1', DOOR_MAX_SSE: '3' } });
  t.after(() => srv.stop());
  const open = []; const codes = [];
  for (let i = 0; i < 6; i++) { const r = await fetch(`${srv.url}/events?role=display`); codes.push(r.status); open.push(r); }
  for (const r of open) try { r.body.cancel(); } catch {}
  assert.equal(codes.filter((c) => c === 200).length, 3);
  assert.equal(codes.filter((c) => c === 429).length, 3);
});

test('the start password is random, kept on disk, and shown only to this computer', async (t) => {
  const srv = await startServer({ env: { DOOR_STARTER_PASSWORD: '' } });
  t.after(() => srv.stop());
  assert.equal((await call(srv, 'POST', '/api/login', { username: 'admin', password: 'admin-start-123' })).status, 401, 'the old well-known password is gone');
  const file = path.join(srv.dataDir, 'starter-password.txt');
  assert.ok(fs.existsSync(file));
  const pw = fs.readFileSync(file, 'utf8').trim();
  assert.ok(pw.length >= 10);
  const local = (await call(srv, 'GET', '/api/where')).json;
  assert.equal(local.starter.password, pw, 'shown on the screen of this computer');
  const remote = (await call(srv, 'GET', '/api/where', undefined, undefined, { 'X-Forwarded-For': '192.168.1.9' })).json;
  assert.equal(remote.starter, undefined, 'never over the network');
  assert.equal((await call(srv, 'POST', '/api/login', { username: 'admin', password: pw })).status, 200);
});

test('very weak passwords are refused for new accounts', async (t) => {
  const srv = await startServer({ patch: true });
  t.after(() => srv.stop());
  const tok = await login(srv);
  for (const pw of ['password', 'wachtwoord', '12345678', 'aaaaaaaaaa', 'admin-start-123']) {
    const r = await call(srv, 'POST', '/api/users/save', { username: 'jan', name: 'Jan', role: 'kijker', password: pw }, tok);
    assert.equal(r.status, 400, pw);
  }
  assert.equal((await call(srv, 'POST', '/api/users/save', { username: 'jan', name: 'Jan', role: 'kijker', password: 'Zeer-goed-wachtwoord-77' }, tok)).status, 200);
});

test('guessing the same account from many places gets slower and slower', async (t) => {
  const srv = await startServer({});
  t.after(() => srv.stop());
  const times = [];
  for (let i = 0; i < 5; i++) { const t0 = Date.now(); await call(srv, 'POST', '/api/login', { username: 'milo', password: 'fout' + i }); times.push(Date.now() - t0); }
  assert.ok(times[4] > times[0] + 700, `the fifth wrong try took ${times[4]} ms against ${times[0]} ms for the first`);
});

test('security headers are set on every page', async (t) => {
  const srv = await startServer({});
  t.after(() => srv.stop());
  const r = await fetch(`${srv.url}/admin`);
  assert.match(r.headers.get('content-security-policy'), /default-src 'self'/);
  assert.match(r.headers.get('content-security-policy'), /object-src 'none'/);
  assert.equal(r.headers.get('x-frame-options'), 'SAMEORIGIN');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.match(r.headers.get('permissions-policy'), /camera=\(\)/);
});

test('outgoing addresses cannot point at the cloud secrets address', () => {
  assert.equal(integ.clean({ lock: { url: 'http://169.254.169.254/latest/meta-data' } }).lock.url, '');
  assert.equal(integ.clean({ cameras: [{ name: 'x', snapshotUrl: 'http://metadata.google.internal/' }] }).cameras[0].snapshotUrl, '');
  assert.notEqual(integ.clean({ lock: { url: 'http://192.168.1.50/open' } }).lock.url, '', 'your own network is fine');
});

test('every protected route refuses an account that may only look', async (t) => {
  const srv = await startServer({ patch: true });
  t.after(() => srv.stop());
  const tok = await login(srv);
  assert.equal((await call(srv, 'POST', '/api/users/save', { username: 'kijker1', name: 'Kijker', role: 'kijker', password: 'Zeer-goed-wachtwoord-77' }, tok)).status, 200);
  const vt = (await call(srv, 'POST', '/api/login', { username: 'kijker1', password: 'Zeer-goed-wachtwoord-77' })).json.token;
  const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  const block = src.slice(src.indexOf('const NEED = {'), src.indexOf('// ----- moderation:'));
  const routes = [...block.matchAll(/'(GET|POST) (\/api\/[^']+)': '(\w+)'/g)].filter((m) => m[3] !== 'view');
  assert.ok(routes.length > 40, `found ${routes.length} routes`);
  for (const [, method, p, need] of routes) {
    if (['POST /api/lock', 'POST /api/lock/set'].includes(`${method} ${p}`)) continue;
    const r = await call(srv, method, p, method === 'POST' ? {} : undefined, vt);
    assert.ok([403, 404, 423].includes(r.status), `${method} ${p} (needs ${need}) gave ${r.status} to a viewer`);
  }
});
