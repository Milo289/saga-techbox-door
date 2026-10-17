'use strict';
// A tiny certificate authority, without any program or library: it makes its own CA and a server certificate for this door server,
// so the connection can be https without buying a domain. The CA is put on a device once (Mac, iPhone, ...) and then every
// certificate it issues is trusted, with no warning in the browser. Only what is needed is built: ECDSA P-256, X.509 v3.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');

// ---------- DER (the binary format of certificates) ----------
const len = (n) => (n < 128 ? Buffer.from([n]) : n < 256 ? Buffer.from([0x81, n]) : Buffer.from([0x82, n >> 8, n & 255]));
const der = (tag, ...parts) => { const body = Buffer.concat(parts); return Buffer.concat([Buffer.from([tag]), len(body.length), body]); };
const seq = (...p) => der(0x30, ...p);
const set = (...p) => der(0x31, ...p);
const octet = (b) => der(0x04, b);
const bitString = (b, unused = 0) => der(0x03, Buffer.from([unused]), b);
const utf8 = (t) => der(0x0c, Buffer.from(t, 'utf8'));
const bool = (v) => der(0x01, Buffer.from([v ? 0xff : 0]));
const int = (n) => {
  const b = Buffer.isBuffer(n) ? n : Buffer.from(n.toString(16).padStart(2, '0').replace(/^(.)$/, '0$1'), 'hex');
  return der(0x02, b[0] & 0x80 ? Buffer.concat([Buffer.from([0]), b]) : b);
};
const oid = (s) => {
  const p = s.split('.').map(Number), out = [p[0] * 40 + p[1]];
  for (const n of p.slice(2)) { const stack = [n & 127]; let v = n >> 7; while (v > 0) { stack.unshift((v & 127) | 128); v >>= 7; } out.push(...stack); }
  return der(0x06, Buffer.from(out));
};
const ctx = (n, ...p) => der(0xa0 | n, ...p);
const time = (d) => { const p = (x) => String(x).padStart(2, '0'); const y = d.getUTCFullYear(); const body = `${p(y % 100)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`; return y < 2050 ? der(0x17, Buffer.from(body)) : der(0x18, Buffer.from(String(y) + body.slice(2))); };
const name = (cn, org) => seq(...(org ? [set(seq(oid('2.5.4.10'), utf8(org)))] : []), set(seq(oid('2.5.4.3'), utf8(cn))));
const ECDSA_SHA256 = () => seq(oid('1.2.840.10045.4.3.2'));

function ipBytes(ip) {
  if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return Buffer.from(ip.split('.').map(Number));
  return null; // IPv6 is left out: not needed for a door sign
}
function ext(id, critical, value) { return seq(oid(id), ...(critical ? [bool(true)] : []), octet(value)); }

function certificate({ subjectCn, org, issuerCn, issuerKey, subjectPublicKey, issuerPublicKey, days, ca, sans = [] }) {
  const spki = subjectPublicKey.export({ type: 'spki', format: 'der' });
  const keyBits = (k) => { const s = k.export({ type: 'spki', format: 'der' }); return s.subarray(s.length - 65); };
  const ski = crypto.createHash('sha1').update(keyBits(subjectPublicKey)).digest();
  const aki = crypto.createHash('sha1').update(keyBits(issuerPublicKey)).digest();
  const extensions = [
    ext('2.5.29.19', true, seq(...(ca ? [bool(true), int(0)] : []))),                                  // basicConstraints
    ext('2.5.29.15', true, ca ? bitString(Buffer.from([0x06]), 1) : bitString(Buffer.from([0x80]), 7)), // keyUsage: CA = keyCertSign + cRLSign, server = digitalSignature
    ext('2.5.29.14', false, octet(ski)),                                                               // subjectKeyIdentifier
    ext('2.5.29.35', false, seq(der(0x80, aki))),                                                      // authorityKeyIdentifier
  ];
  if (!ca) {
    extensions.push(ext('2.5.29.37', false, seq(oid('1.3.6.1.5.5.7.3.1'))));                           // extKeyUsage: serverAuth
    const names = sans.map((s) => { const ip = ipBytes(s); return ip ? der(0x87, ip) : der(0x82, Buffer.from(s)); });
    extensions.push(ext('2.5.29.17', false, seq(...names)));                                           // subjectAltName
  }
  const nb = new Date(Date.now() - 3600e3), na = new Date(Date.now() + days * 864e5);
  const tbs = seq(
    ctx(0, int(2)),                                  // version 3
    int(crypto.randomBytes(16).map((b, i) => (i === 0 ? (b & 0x7f) || 0x11 : b))), // a DER number may not start with a zero byte (that was a 1 in 128 chance of an invalid certificate)
    ECDSA_SHA256(), name(issuerCn, org), seq(time(nb), time(na)), name(subjectCn, org),
    spki, ctx(3, seq(...extensions)),
  );
  const sig = crypto.sign('sha256', tbs, issuerKey); // ECDSA, DER encoded
  return seq(tbs, ECDSA_SHA256(), bitString(sig));
}
const pem = (der, label) => `-----BEGIN ${label}-----\n${der.toString('base64').match(/.{1,64}/g).join('\n')}\n-----END ${label}-----\n`;

function makeCa(orgName) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const cn = `${orgName} Certificaat-autoriteit`;
  const cert = certificate({ subjectCn: cn, org: orgName, issuerCn: cn, issuerKey: privateKey, subjectPublicKey: publicKey, issuerPublicKey: publicKey, days: 3650, ca: true });
  return { keyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }), certPem: pem(cert, 'CERTIFICATE'), certDer: cert };
}
function makeServerCert(ca, orgName, sans, days = 800) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const caKey = crypto.createPrivateKey(ca.keyPem), caPub = new crypto.X509Certificate(ca.certPem).publicKey;
  const cert = certificate({ subjectCn: sans[0] || 'saga-deur.local', org: orgName, issuerCn: `${orgName} Certificaat-autoriteit`, issuerKey: caKey, subjectPublicKey: publicKey, issuerPublicKey: caPub, days, ca: false, sans });
  return { keyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }), certPem: pem(cert, 'CERTIFICATE') };
}

// every name and address this server answers to
function namesFor(extra = []) {
  const host = os.hostname().replace(/\.local$/, '');
  const names = ['saga-deur.local', `${host}.local`, host, 'localhost', '127.0.0.1'];
  for (const list of Object.values(os.networkInterfaces())) for (const a of list || []) if (a.family === 'IPv4' && !a.internal) names.push(a.address);
  return [...new Set([...names, ...extra].filter(Boolean))];
}

// the files live in DATA_DIR/tls; the CA is made once, the server certificate again when it gets old or the names change
function ensure(dir, orgName, extraNames = []) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const f = (n) => path.join(dir, n);
  let ca;
  try { ca = { keyPem: fs.readFileSync(f('ca.key'), 'utf8'), certPem: fs.readFileSync(f('ca.crt'), 'utf8') }; new crypto.X509Certificate(ca.certPem); } catch { ca = null; }
  if (!ca) { ca = makeCa(orgName); fs.writeFileSync(f('ca.key'), ca.keyPem, { mode: 0o600 }); fs.writeFileSync(f('ca.crt'), ca.certPem); try { fs.rmSync(f('server.crt')); } catch {} }
  const names = namesFor(extraNames);
  let srv = null;
  try {
    const certPem = fs.readFileSync(f('server.crt'), 'utf8'), x = new X509(certPem);
    const left = Date.parse(x.validTo) - Date.now();
    const same = names.every((n) => (ipBytes(n) ? x.checkIP(n) : x.checkHost(n)));
    if (left > 30 * 864e5 && same && x.checkIssued(new crypto.X509Certificate(ca.certPem))) srv = { certPem, keyPem: fs.readFileSync(f('server.key'), 'utf8') };
  } catch { srv = null; }
  if (!srv) { srv = makeServerCert(ca, orgName, names); fs.writeFileSync(f('server.key'), srv.keyPem, { mode: 0o600 }); fs.writeFileSync(f('server.crt'), srv.certPem); }
  const cx = new crypto.X509Certificate(ca.certPem), sx = new crypto.X509Certificate(srv.certPem);
  return { caPem: ca.certPem, caDer: cx.raw, caFingerprint: cx.fingerprint256, key: srv.keyPem, cert: srv.certPem, names, expires: sx.validTo };
}
const X509 = crypto.X509Certificate;

// an iPhone or iPad installs the CA from a "profile" (then: Settings → General → About → Certificate Trust Settings)
function mobileconfig(caDer, orgName) {
  const uuid = () => crypto.randomUUID().toUpperCase();
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>PayloadContent</key><array><dict>
    <key>PayloadCertificateFileName</key><string>ca.crt</string>
    <key>PayloadContent</key><data>${caDer.toString('base64')}</data>
    <key>PayloadDescription</key><string>Zodat jouw apparaten de verbinding met de deurserver vertrouwen</string>
    <key>PayloadDisplayName</key><string>${esc(orgName)} Certificaat-autoriteit</string>
    <key>PayloadIdentifier</key><string>nl.sagatechbox.ca.cert</string>
    <key>PayloadType</key><string>com.apple.security.root</string>
    <key>PayloadUUID</key><string>${uuid()}</string>
    <key>PayloadVersion</key><integer>1</integer>
  </dict></array>
  <key>PayloadDisplayName</key><string>${esc(orgName)} deurserver</string>
  <key>PayloadIdentifier</key><string>nl.sagatechbox.ca</string>
  <key>PayloadRemovalDisallowed</key><false/>
  <key>PayloadType</key><string>Configuration</string>
  <key>PayloadUUID</key><string>${uuid()}</string>
  <key>PayloadVersion</key><integer>1</integer>
</dict></plist>
`;
}

module.exports = { ensure, makeCa, makeServerCert, namesFor, mobileconfig };
