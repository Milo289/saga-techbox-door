'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sec = require('../security.js');

test('base32 and the codes of the official TOTP test vectors', () => {
  const secret = sec.base32.encode(Buffer.from('12345678901234567890'));
  assert.equal(sec.base32.decode(secret).toString(), '12345678901234567890');
  // RFC 6238, appendix B (the 8-digit codes, here the last 6): time 59 → 94287082, 1111111109 → 07081804, 2000000000 → 69279037
  assert.equal(sec.totp.code(secret, 59000), '287082');
  assert.equal(sec.totp.code(secret, 1111111109000), '081804');
  assert.equal(sec.totp.code(secret, 2000000000000), '279037');
});

test('a code is accepted once, a little early or late, and never twice', () => {
  const s = sec.totp.newSecret();
  const now = 1700000000000;
  const code = sec.totp.code(s, now);
  const step = sec.totp.verify(s, code, 0, now);
  assert.ok(step > 0);
  assert.equal(sec.totp.verify(s, code, step, now), 0, 'the same code twice');
  assert.ok(sec.totp.verify(s, sec.totp.code(s, now - 30000), 0, now) > 0, 'one step late is fine');
  assert.equal(sec.totp.verify(s, sec.totp.code(s, now - 120000), 0, now), 0, 'two minutes old is not');
  assert.equal(sec.totp.verify(s, '12345', 0, now), 0);
  assert.equal(sec.totp.verify(s, 'abcdef', 0, now), 0);
});

test('secrets are encrypted with a key in its own file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ks-'));
  const k = sec.keyStore(dir);
  const e = k.encrypt('mijn-mailwachtwoord');
  assert.ok(k.isEnc(e)); assert.ok(!e.includes('mailwachtwoord'));
  assert.equal(k.decrypt(e), 'mijn-mailwachtwoord');
  assert.equal(k.decrypt('gewone tekst'), 'gewone tekst', 'old plain values still work');
  assert.equal(k.encrypt(''), '');
  assert.equal(sec.keyStore(dir).decrypt(e), 'mijn-mailwachtwoord', 'the same key is read again');
  assert.equal(sec.keyStore(fs.mkdtempSync(path.join(os.tmpdir(), 'ks-'))).decrypt(e), '', 'another key: empty, no crash');
  assert.notEqual(k.encrypt('x'), k.encrypt('x'), 'a new random number each time');
});

test('the log chain shows a changed, removed or reordered line', () => {
  const hist = []; let prev = '';
  for (let i = 0; i < 6; i++) { const e = { at: 1000 + i, type: 't', text: 'regel ' + i, by: 'x', r: false, prev }; e.h = sec.hashEntry(prev, e); prev = e.h; hist.unshift(e); }
  assert.deepEqual(sec.verifyChain(hist), { ok: true, checked: 6 });
  const edited = structuredClone(hist); edited[2].text = 'anders';
  assert.equal(sec.verifyChain(edited).ok, false); assert.equal(sec.verifyChain(edited).brokenAt, 2);
  const removed = structuredClone(hist); removed.splice(3, 1);
  assert.equal(sec.verifyChain(removed).ok, false);
  const legacy = [...structuredClone(hist), { at: 1, type: 'old', text: 'oud', by: '', r: false }];
  assert.equal(sec.verifyChain(legacy).ok, true, 'old lines without a fingerprint are skipped');
});

test('a backup with a password only opens with that password', () => {
  const t = JSON.stringify({ version: 2, settings: { name: 'Geheim' } });
  const enc = sec.encryptBackup(t, 'Zeer-goed-wachtwoord');
  assert.ok(sec.isEncryptedBackup(enc)); assert.ok(!enc.includes('Geheim'));
  assert.equal(sec.decryptBackup(enc, 'Zeer-goed-wachtwoord'), t);
  assert.throws(() => sec.decryptBackup(enc, 'fout'), /klopt niet/);
});

test('recovery codes look right and are matched without dashes or capitals', () => {
  const codes = sec.recoveryCodes(8);
  assert.equal(new Set(codes).size, 8);
  for (const c of codes) assert.match(c, /^[0-9a-f]{5}-[0-9a-f]{5}$/);
  assert.equal(sec.normRecovery(codes[0].toUpperCase()), sec.normRecovery(codes[0]));
});

test('the page policy fingerprints inline scripts the way a browser does, also with Windows line endings', () => {
  const lf = '<html><style>a { b: c; }\n</style><script src="/x.js"></script><script>\nlet a = 1;\nlet b = 2;\n</script></html>';
  const crlf = lf.replace(/\n/g, '\r\n');
  assert.equal(sec.pageCsp(crlf), sec.pageCsp(lf));
  const csp = sec.pageCsp(lf);
  const want = require('crypto').createHash('sha256').update('\nlet a = 1;\nlet b = 2;\n').digest('base64');
  assert.ok(csp.includes(`'sha256-${want}'`), 'the inline script is allowed by its fingerprint');
  assert.equal((csp.match(/sha256-/g) || []).length, 2, 'the script with a src is not fingerprinted');
  assert.ok(!/script-src[^;]*unsafe-inline/.test(csp));
});
