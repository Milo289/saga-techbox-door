'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startServer, login } = require('./helpers');

// a tiny fake authenticator (what a phone or security key does)
const cbor = (v) => {
  if (Buffer.isBuffer(v)) return Buffer.concat([hdr(2, v.length), v]);
  if (typeof v === 'string') { const b = Buffer.from(v); return Buffer.concat([hdr(3, b.length), b]); }
  if (typeof v === 'number') return v >= 0 ? hdr(0, v) : hdr(1, -1 - v);
  if (v instanceof Map) return Buffer.concat([hdr(5, v.size), ...[...v].flatMap(([k, x]) => [cbor(k), cbor(x)])]);
  throw new Error('cbor');
};
const hdr = (major, n) => (n < 24 ? Buffer.from([(major << 5) | n]) : n < 256 ? Buffer.from([(major << 5) | 24, n]) : Buffer.from([(major << 5) | 25, n >> 8, n & 255]));
class Authenticator {
  constructor() { this.keys = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' }); this.credId = crypto.randomBytes(32); this.count = 0; }
  create(challenge, host, origin, flags = 0x45) {
    const jwk = this.keys.publicKey.export({ format: 'jwk' });
    const cose = cbor(new Map([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x, 'base64url')], [-3, Buffer.from(jwk.y, 'base64url')]]));
    const idLen = Buffer.alloc(2); idLen.writeUInt16BE(this.credId.length);
    const authData = Buffer.concat([crypto.createHash('sha256').update(host).digest(), Buffer.from([flags]), Buffer.alloc(4), Buffer.alloc(16), idLen, this.credId, cose]);
    return { clientDataJSON: Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge, origin })).toString('base64url'), attestationObject: cbor(new Map([['fmt', 'none'], ['attStmt', new Map()], ['authData', authData]])).toString('base64url') };
  }
  get(challenge, host, origin, flags = 0x05) {
    const c = Buffer.alloc(4); c.writeUInt32BE(++this.count);
    const authenticatorData = Buffer.concat([crypto.createHash('sha256').update(host).digest(), Buffer.from([flags]), c]);
    const cd = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge, origin }));
    const signature = crypto.sign('sha256', Buffer.concat([authenticatorData, crypto.createHash('sha256').update(cd).digest()]), this.keys.privateKey);
    return { id: this.credId.toString('base64url'), clientDataJSON: cd.toString('base64url'), authenticatorData: authenticatorData.toString('base64url'), signature: signature.toString('base64url') };
  }
}
const req = (srv, method, p, body, token, host) => new Promise((resolve, reject) => {
  const r = http.request({ host: '127.0.0.1', port: srv.port, method, path: p, headers: { 'Content-Type': 'application/json', Host: host, ...(token ? { Authorization: `Bearer ${token}` } : {}) } }, (res) => { let d = ''; res.on('data', (x) => (d += x)); res.on('end', () => { let json = null; try { json = JSON.parse(d); } catch {} resolve({ status: res.statusCode, json }); }); });
  r.on('error', reject); r.end(body === undefined ? undefined : JSON.stringify(body));
});

test('passkeys: add, log in without a password, and every wrong attempt fails', async (t) => {
  const srv = await startServer({ patch: true, dir: fs.mkdtempSync(path.join(os.tmpdir(), 'pk-')) });
  t.after(() => srv.stop());
  const tok = await login(srv);
  const host = `localhost:${srv.port}`, origin = `http://${host}`;
  // an IP address does not work for passkeys
  const ip = await req(srv, 'POST', '/api/passkeys/options', {}, tok, `127.0.0.1:${srv.port}`);
  assert.equal(ip.status, 400); assert.match(ip.json.error, /IP-adres/);
  const opt = (await req(srv, 'POST', '/api/passkeys/options', {}, tok, host)).json;
  assert.equal(opt.rpId, 'localhost');
  const au = new Authenticator();
  // a passkey that was not confirmed with a fingerprint is refused
  assert.equal((await req(srv, 'POST', '/api/passkeys/add', { challenge: opt.challenge, ...au.create(opt.challenge, 'localhost', origin, 0x41) }, tok, host)).status, 400);
  const opt2 = (await req(srv, 'POST', '/api/passkeys/options', {}, tok, host)).json;
  assert.equal((await req(srv, 'POST', '/api/passkeys/add', { challenge: opt2.challenge, ...au.create(opt2.challenge, 'localhost', 'http://evil.example', 0x45) }, tok, host)).status, 400, 'wrong address');
  const opt3 = (await req(srv, 'POST', '/api/passkeys/options', {}, tok, host)).json;
  const add = await req(srv, 'POST', '/api/passkeys/add', { challenge: opt3.challenge, name: 'Test', ...au.create(opt3.challenge, 'localhost', origin) }, tok, host);
  assert.equal(add.status, 200, JSON.stringify(add.json));
  assert.equal((await req(srv, 'GET', '/api/passkeys', undefined, tok, host)).json.passkeys.length, 1);
  // log in
  const ch = (await req(srv, 'GET', '/api/login/passkey', undefined, null, host)).json;
  assert.equal(ch.available, true);
  const ok = await req(srv, 'POST', '/api/login/passkey', { challenge: ch.challenge, ...au.get(ch.challenge, 'localhost', origin) }, null, host);
  assert.equal(ok.status, 200, JSON.stringify(ok.json)); assert.ok(ok.json.token);
  assert.equal((await req(srv, 'GET', '/api/me', undefined, ok.json.token, host)).status, 200);
  // the challenge works only once
  assert.equal((await req(srv, 'POST', '/api/login/passkey', { challenge: ch.challenge, ...au.get(ch.challenge, 'localhost', origin) }, null, host)).status, 401);
  // another key, a changed signature, a replayed counter
  const ch2 = (await req(srv, 'GET', '/api/login/passkey', undefined, null, host)).json;
  const other = new Authenticator(); other.credId = au.credId;
  assert.equal((await req(srv, 'POST', '/api/login/passkey', { challenge: ch2.challenge, ...other.get(ch2.challenge, 'localhost', origin) }, null, host)).status, 401, 'a different key');
  const ch3 = (await req(srv, 'GET', '/api/login/passkey', undefined, null, host)).json;
  au.count = 0; // the counter goes back: a copied passkey
  assert.equal((await req(srv, 'POST', '/api/login/passkey', { challenge: ch3.challenge, ...au.get(ch3.challenge, 'localhost', origin) }, null, host)).status, 401, 'counter back');
  const ch4 = (await req(srv, 'GET', '/api/login/passkey', undefined, null, host)).json;
  au.count = 10;
  assert.equal((await req(srv, 'POST', '/api/login/passkey', { challenge: ch4.challenge, ...au.get(ch4.challenge, 'localhost', origin, 0x01) }, null, host)).status, 401, 'no user verification');
  // remove
  const id = (await req(srv, 'GET', '/api/passkeys', undefined, tok, host)).json.passkeys[0].id;
  assert.equal((await req(srv, 'POST', '/api/passkeys/remove', { id }, tok, host)).status, 200);
  const ch5 = (await req(srv, 'GET', '/api/login/passkey', undefined, null, host)).json;
  au.count = 20;
  assert.equal((await req(srv, 'POST', '/api/login/passkey', { challenge: ch5.challenge, ...au.get(ch5.challenge, 'localhost', origin) }, null, host)).status, 401);
});
