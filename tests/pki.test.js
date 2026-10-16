'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const pki = require('../pki.js');

test('the own certificate authority makes certificates that a real TLS stack accepts', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pki-'));
  const r = pki.ensure(dir, 'Saga Techbox');
  const ca = new crypto.X509Certificate(r.caPem), srv = new crypto.X509Certificate(r.cert);
  assert.equal(ca.ca, true);
  assert.equal(srv.ca, false);
  assert.ok(srv.checkIssued(ca), 'the server certificate is signed by the CA');
  assert.ok(srv.verify(ca.publicKey), 'the signature is valid');
  assert.ok(ca.verify(ca.publicKey), 'the CA is self-signed');
  assert.ok(srv.checkHost('saga-deur.local'), 'the name of the Linux image');
  assert.ok(srv.checkHost('localhost'));
  assert.ok(srv.checkIP('127.0.0.1'));
  assert.ok(Date.parse(srv.validTo) - Date.now() > 700 * 864e5 && Date.parse(srv.validTo) - Date.now() < 826 * 864e5, 'valid under 825 days (the limit of Apple devices)');
  assert.match(r.caFingerprint, /^[0-9A-F]{2}(:[0-9A-F]{2}){31}$/);
  // a second start reuses everything
  const again = pki.ensure(dir, 'Saga Techbox');
  assert.equal(again.caPem, r.caPem); assert.equal(again.cert, r.cert);
  // the profile for iPhones contains the CA
  const prof = pki.mobileconfig(r.caDer, 'Saga Techbox');
  assert.match(prof, /com\.apple\.security\.root/); assert.ok(prof.includes(r.caDer.toString('base64')));
});

test('openssl agrees (when it is installed)', (t) => {
  const have = spawnSync('openssl', ['version']);
  if (have.status !== 0) return t.skip('no openssl here');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pki-'));
  pki.ensure(dir, 'Saga Techbox');
  const v = spawnSync('openssl', ['verify', '-CAfile', path.join(dir, 'ca.crt'), path.join(dir, 'server.crt')], { encoding: 'utf8' });
  assert.match(v.stdout + v.stderr, /OK/, v.stdout + v.stderr);
  const text = spawnSync('openssl', ['x509', '-in', path.join(dir, 'server.crt'), '-noout', '-text'], { encoding: 'utf8' }).stdout;
  assert.match(text, /Subject Alternative Name/); assert.match(text, /saga-deur\.local/); assert.match(text, /TLS Web Server Authentication/);
});

test('a certificate is renewed when the names change', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pki-'));
  const a = pki.ensure(dir, 'Saga Techbox');
  const b = pki.ensure(dir, 'Saga Techbox', ['deur.school.example']);
  assert.notEqual(a.cert, b.cert);
  assert.ok(new crypto.X509Certificate(b.cert).checkHost('deur.school.example'));
  assert.equal(a.caPem, b.caPem, 'the CA stays, so devices that trust it keep trusting');
});
