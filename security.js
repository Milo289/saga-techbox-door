'use strict';
// The building blocks of the security features, without any link to the server, so each one can be tested on its own:
// encrypted secrets, two-step codes (TOTP), a log whose lines hang together, and password-protected backups.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// ---------- secrets at rest: AES-256-GCM with a key that lives in its own file (data/secret.key, only readable by this user) ----------
function keyStore(dir) {
  const file = path.join(dir, 'secret.key');
  let key;
  try { key = Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'hex'); } catch { key = null; }
  if (!key || key.length !== 32) {
    key = crypto.randomBytes(32);
    try { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(file, key.toString('hex') + '\n', { mode: 0o600 }); } catch { /* read-only: the key then lives only in memory */ }
  }
  const PREFIX = 'enc:v1:';
  return {
    isEnc: (t) => typeof t === 'string' && t.startsWith(PREFIX),
    encrypt(text) {
      if (!text || typeof text !== 'string' || text.startsWith(PREFIX)) return text;
      const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', key, iv);
      const ct = Buffer.concat([c.update(text, 'utf8'), c.final()]);
      return PREFIX + Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64');
    },
    decrypt(text) {
      if (typeof text !== 'string' || !text.startsWith(PREFIX)) return text;
      try {
        const raw = Buffer.from(text.slice(PREFIX.length), 'base64');
        const d = crypto.createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12)); d.setAuthTag(raw.subarray(12, 28));
        return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8');
      } catch { return ''; } // another key or damaged: better empty than a crash
    },
  };
}

// ---------- base32 and TOTP (RFC 4648 and RFC 6238; the codes of Google Authenticator, the iCloud keychain, 1Password, ...) ----------
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const base32 = {
  encode(buf) { let bits = 0, v = 0, out = ''; for (const b of buf) { v = (v << 8) | b; bits += 8; while (bits >= 5) { out += B32[(v >>> (bits - 5)) & 31]; bits -= 5; } } if (bits > 0) out += B32[(v << (5 - bits)) & 31]; return out; },
  decode(s) { let bits = 0, v = 0; const out = []; for (const ch of String(s).toUpperCase().replace(/[^A-Z2-7]/g, '')) { v = (v << 5) | B32.indexOf(ch); bits += 5; if (bits >= 8) { out.push((v >>> (bits - 8)) & 255); bits -= 8; } } return Buffer.from(out); },
};
const totp = {
  newSecret: () => base32.encode(crypto.randomBytes(20)),
  code(secret, now = Date.now(), digits = 6, step = 30) {
    const counter = Math.floor(now / 1000 / step), buf = Buffer.alloc(8);
    buf.writeBigUInt64BE(BigInt(counter));
    const h = crypto.createHmac('sha1', base32.decode(secret)).update(buf).digest();
    const o = h[h.length - 1] & 15;
    const n = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
    return String(n % 10 ** digits).padStart(digits, '0');
  },
  // → the time step that matched (so the same code cannot be used twice), or 0
  verify(secret, code, lastStep = 0, now = Date.now(), window = 1) {
    const c = String(code || '').replace(/\s+/g, '');
    if (!/^\d{6}$/.test(c)) return 0;
    const cur = Math.floor(now / 1000 / 30);
    for (let d = -window; d <= window; d++) {
      const step = cur + d;
      if (step <= lastStep) continue;
      const expect = totp.code(secret, step * 30000);
      if (crypto.timingSafeEqual(Buffer.from(expect), Buffer.from(c))) return step;
    }
    return 0;
  },
  uri: (label, issuer, secret) => `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(label)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`,
};
// one-time recovery codes: shown once, stored only as hashes
const sha = (v) => crypto.createHash('sha256').update(String(v)).digest('hex');
function recoveryCodes(n = 8) { return Array.from({ length: n }, () => { const h = crypto.randomBytes(5).toString('hex'); return `${h.slice(0, 5)}-${h.slice(5)}`; }); }
const normRecovery = (c) => String(c || '').toLowerCase().replace(/[^0-9a-f]/g, '');

// ---------- a log in which every line contains the fingerprint of the previous one: a changed or removed line shows ----------
function hashEntry(prev, e) { return crypto.createHash('sha256').update(`${prev}|${e.at}|${e.type}|${e.text}|${e.by}|${e.r ? 1 : 0}`).digest('hex').slice(0, 32); }
// history is newest first; lines from before this feature have no fingerprint and are skipped
function verifyChain(history) {
  let checked = 0;
  for (let i = 0; i < history.length; i++) {
    const e = history[i];
    if (!e.h) continue;
    if (hashEntry(e.prev || '', e) !== e.h) return { ok: false, checked, brokenAt: i, why: 'Deze regel is aangepast.' };
    checked++;
    const older = history[i + 1];
    if (older && older.h && e.prev !== older.h) return { ok: false, checked, brokenAt: i + 1, why: 'Er ontbreekt een regel of de volgorde klopt niet.' };
  }
  return { ok: true, checked };
}

// ---------- backups protected with a password ----------
const BK = 'SAGABKP1:';
function encryptBackup(text, password) {
  const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12);
  const key = crypto.scryptSync(String(password), salt, 32);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  return BK + Buffer.concat([salt, iv, c.getAuthTag(), ct]).toString('base64');
}
const isEncryptedBackup = (text) => typeof text === 'string' && text.startsWith(BK);
function decryptBackup(text, password) {
  const raw = Buffer.from(String(text).slice(BK.length), 'base64');
  const key = crypto.scryptSync(String(password), raw.subarray(0, 16), 32);
  const d = crypto.createDecipheriv('aes-256-gcm', key, raw.subarray(16, 28)); d.setAuthTag(raw.subarray(28, 44));
  try { return Buffer.concat([d.update(raw.subarray(44)), d.final()]).toString('utf8'); } catch { throw new Error('Het wachtwoord van de back-up klopt niet.'); }
}

// ---------- passkeys (WebAuthn): only what is needed, ES256 (P-256) and "none" attestation ----------
function cborDecode(buf) {
  let o = 0;
  const read = () => {
    if (o >= buf.length) throw new Error('cbor');
    const ib = buf[o++], major = ib >> 5, add = ib & 31;
    let n = add;
    if (add === 24) n = buf[o++]; else if (add === 25) { n = buf.readUInt16BE(o); o += 2; } else if (add === 26) { n = buf.readUInt32BE(o); o += 4; } else if (add > 26) throw new Error('cbor');
    switch (major) {
      case 0: return n;
      case 1: return -1 - n;
      case 2: { const b = buf.subarray(o, o + n); o += n; return b; }
      case 3: { const t = buf.subarray(o, o + n).toString('utf8'); o += n; return t; }
      case 4: { const a = []; for (let i = 0; i < n; i++) a.push(read()); return a; }
      case 5: { const m = new Map(); for (let i = 0; i < n; i++) { const k = read(); m.set(k, read()); } return m; }
      case 7: return add === 20 ? false : add === 21 ? true : null;
      default: throw new Error('cbor');
    }
  };
  return { value: read(), used: o };
}
const b64u = (b) => Buffer.from(b).toString('base64url');
const fromB64u = (s) => Buffer.from(String(s || ''), 'base64url');
const SPKI_P256 = Buffer.from('3059301306072a8648ce3d020106082a8648ce3d030107034200', 'hex');
function coseToSpki(m) {
  if (!(m instanceof Map) || m.get(1) !== 2 || m.get(3) !== -7 || m.get(-1) !== 1) throw new Error('Deze passkey gebruikt een soort sleutel die niet wordt ondersteund.');
  const x = m.get(-2), y = m.get(-3);
  if (!Buffer.isBuffer(x) || !Buffer.isBuffer(y) || x.length !== 32 || y.length !== 32) throw new Error('De sleutel van de passkey is ongeldig.');
  return Buffer.concat([SPKI_P256, Buffer.from([4]), x, y]);
}
function parseAuthData(ad) {
  if (ad.length < 37) throw new Error('De gegevens van de passkey zijn te kort.');
  const out = { rpIdHash: ad.subarray(0, 32), flags: ad[32], signCount: ad.readUInt32BE(33) };
  if (out.flags & 64) {
    if (ad.length < 55) throw new Error('De gegevens van de passkey zijn te kort.');
    const idLen = ad.readUInt16BE(53);
    out.credentialId = ad.subarray(55, 55 + idLen);
    out.publicKey = cborDecode(ad.subarray(55 + idLen)).value;
  }
  return out;
}
function checkClient(clientDataJSON, type, challenge, origins) {
  let c; try { c = JSON.parse(Buffer.from(clientDataJSON).toString('utf8')); } catch { throw new Error('Onleesbare gegevens van de passkey.'); }
  if (c.type !== type) throw new Error('Dit is niet het goede soort passkey-antwoord.');
  if (c.challenge !== challenge) throw new Error('Deze passkey-poging is verlopen. Probeer opnieuw.');
  if (!origins.includes(c.origin)) throw new Error('De passkey hoort bij een ander adres dan waar je nu bent.');
  return c;
}
const rpHash = (rpId) => crypto.createHash('sha256').update(rpId).digest();
// a new passkey: returns the credential id and the public key (SPKI, base64url)
function verifyRegistration({ clientDataJSON, attestationObject }, { challenge, rpId, origins }) {
  checkClient(fromB64u(clientDataJSON), 'webauthn.create', challenge, origins);
  const att = cborDecode(fromB64u(attestationObject)).value;
  const ad = att instanceof Map && att.get('authData');
  if (!Buffer.isBuffer(ad)) throw new Error('De passkey miste gegevens.');
  const p = parseAuthData(ad);
  if (!p.rpIdHash.equals(rpHash(rpId))) throw new Error('De passkey hoort bij een ander adres.');
  if (!(p.flags & 1) || !(p.flags & 4)) throw new Error('De passkey moet met je vingerafdruk, gezicht of toestelcode worden bevestigd.');
  if (!p.credentialId) throw new Error('De passkey miste een sleutel.');
  return { id: b64u(p.credentialId), publicKey: b64u(coseToSpki(p.publicKey)), signCount: p.signCount };
}
// logging in: checks the signature; returns the new counter
function verifyAssertion({ clientDataJSON, authenticatorData, signature }, { challenge, rpId, origins, publicKey, signCount }) {
  const cd = fromB64u(clientDataJSON), ad = fromB64u(authenticatorData);
  checkClient(cd, 'webauthn.get', challenge, origins);
  const p = parseAuthData(ad);
  if (!p.rpIdHash.equals(rpHash(rpId))) throw new Error('De passkey hoort bij een ander adres.');
  if (!(p.flags & 1) || !(p.flags & 4)) throw new Error('De passkey is niet bevestigd met vingerafdruk, gezicht of toestelcode.');
  const key = crypto.createPublicKey({ key: fromB64u(publicKey), format: 'der', type: 'spki' });
  const ok = crypto.verify('sha256', Buffer.concat([ad, crypto.createHash('sha256').update(cd).digest()]), key, fromB64u(signature));
  if (!ok) throw new Error('De handtekening van de passkey klopt niet.');
  if ((signCount || p.signCount) && p.signCount <= (signCount || 0)) throw new Error('Deze passkey lijkt gekopieerd te zijn en wordt geweigerd.');
  return { signCount: p.signCount };
}

// The Content-Security-Policy of one HTML page: inline scripts and styles are allowed only by their fingerprint.
// The browser reads line endings as a single line feed before it fingerprints, so the file's Windows line endings must be treated the same way.
function pageCsp(html) {
  const hashes = (tag) => [...html.matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'gi'))]
    .filter((m) => !/\ssrc=/i.test(m[0].slice(0, m[0].indexOf('>'))))
    .map((m) => `'sha256-${crypto.createHash('sha256').update(m[1].replace(/\r\n?/g, '\n')).digest('base64')}'`);
  return `default-src 'self'; script-src 'self' ${hashes('script').join(' ')}; style-src 'self' ${hashes('style').join(' ')}; style-src-attr 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'self'; object-src 'none'`;
}
const passkey = { cborDecode, coseToSpki, parseAuthData, verifyRegistration, verifyAssertion, b64u };

module.exports = { pageCsp, passkey, keyStore, base32, totp, sha, recoveryCodes, normRecovery, hashEntry, verifyChain, encryptBackup, decryptBackup, isEncryptedBackup };
