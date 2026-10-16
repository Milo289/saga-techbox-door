'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startServer, call, login } = require('./helpers');

const get = (port, p, ca) => new Promise((resolve, reject) => {
  https.get({ host: '127.0.0.1', port, path: p, ca, servername: 'localhost' }, (res) => { let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => resolve({ status: res.statusCode, body: d, headers: res.headers })); }).on('error', reject);
});

test('https with the own CA: off by default, on by setting, trusted only with the CA', async (t) => {
  const srv = await startServer({ patch: true, dir: fs.mkdtempSync(path.join(os.tmpdir(), 'https-')) });
  t.after(() => srv.stop());
  const tok = await login(srv);
  const st = (await call(srv, 'GET', '/api/https', undefined, tok)).json;
  assert.equal(st.enabled, false);
  assert.equal((await call(srv, 'GET', '/ca.crt')).status, 404);
  const port = 20000 + Math.floor(Math.random() * 20000);
  const on = (await call(srv, 'POST', '/api/https/settings', { enabled: true, port }, tok)).json;
  assert.equal(on.enabled, true);
  await new Promise((r) => setTimeout(r, 600));
  const ca = await call(srv, 'GET', '/ca.crt');
  assert.equal(ca.status, 200);
  const caPem = ca.text;
  const ok = await get((await call(srv, 'GET', '/api/https', undefined, tok)).json.port, '/api/where', caPem);
  assert.equal(ok.status, 200);
  await assert.rejects(get((await call(srv, 'GET', '/api/https', undefined, tok)).json.port, '/api/where'), /self.signed|unable to verify|certificate/i);
  // the server sends its authority after its own certificate, so an app can show the fingerprint
  const sent = await new Promise((resolve, reject) => { const s = require('tls').connect({ host: '127.0.0.1', port: (srv.https || port), rejectUnauthorized: false }, () => { const c = s.getPeerCertificate(true); s.end(); resolve(c); }); s.on('error', reject); });
  assert.ok(sent.issuerCertificate && sent.issuerCertificate.fingerprint256, 'the chain has the authority');
  assert.equal(sent.issuerCertificate.fingerprint256, (await call(srv, 'GET', '/api/https', undefined, tok)).json.fingerprint);
  const prof = await call(srv, 'GET', '/ca.mobileconfig');
  assert.equal(prof.status, 200);
  const ren = await call(srv, 'POST', '/api/https/renew', {}, tok);
  assert.equal(ren.status, 200);
  const sc = (await call(srv, 'GET', '/api/admin-state', undefined, tok)).json.security;
  assert.ok(JSON.stringify(sc).includes('https'));
});

test('strict CSP: pages allow only their own scripts by fingerprint, never unsafe-inline scripts', async (t) => {
  const srv = await startServer({ patch: true, dir: fs.mkdtempSync(path.join(os.tmpdir(), 'csp-')) });
  t.after(() => srv.stop());
  for (const p of ['/', '/admin', '/start', '/help', '/visit']) {
    const r = await fetch(srv.url + p);
    const csp = r.headers.get('content-security-policy') || '';
    const script = csp.split(';').find((x) => x.trim().startsWith('script-src')) || '';
    assert.ok(!script.includes('unsafe-inline') && !script.includes('unsafe-eval'), p + ': ' + script);
    if (p !== '/help') assert.match(script, /sha256-/);
  }
});
