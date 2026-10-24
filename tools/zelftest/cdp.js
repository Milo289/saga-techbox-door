'use strict';
// A tiny WebSocket client and DevTools-protocol client with no dependencies (works on every Node version that has fetch).
const net = require('node:net');
const crypto = require('node:crypto');
const { URL } = require('node:url');

class CdpClient {
  static connect(wsUrl) {
    const u = new URL(wsUrl);
    return new Promise((resolve, reject) => {
      const sock = net.connect(Number(u.port || 80), u.hostname);
      const key = crypto.randomBytes(16).toString('base64');
      const c = new CdpClient(sock);
      let head = Buffer.alloc(0), upgraded = false;
      sock.on('connect', () => sock.write(`GET ${u.pathname}${u.search} HTTP/1.1\r\nHost: ${u.host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`));
      sock.on('data', (d) => {
        if (upgraded) return c._feed(d);
        head = Buffer.concat([head, d]);
        const end = head.indexOf('\r\n\r\n');
        if (end < 0) return;
        if (!/^HTTP\/1.1 101/.test(head.toString('latin1', 0, 20))) return reject(new Error('de browser weigerde de verbinding'));
        upgraded = true; const rest = head.subarray(end + 4); resolve(c); if (rest.length) c._feed(rest);
      });
      sock.on('error', reject);
      sock.on('close', () => { for (const p of c.pending.values()) p.reject(new Error('verbinding met de browser verbroken')); c.pending.clear(); });
    });
  }
  constructor(sock) { this.sock = sock; this.buf = Buffer.alloc(0); this.id = 0; this.pending = new Map(); this.handlers = new Map(); this.parts = []; }
  on(ev, fn) { (this.handlers.get(ev) || this.handlers.set(ev, []).get(ev)).push(fn); }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { this.pending.delete(id); reject(new Error(`${method}: geen antwoord van de browser`)); }, 30000);
      this.pending.set(id, { resolve: (v) => { clearTimeout(t); resolve(v); }, reject: (e) => { clearTimeout(t); reject(e); } });
      this._write(JSON.stringify({ id, method, params }));
    });
  }
  close() { try { this.sock.end(); } catch {} }
  _write(text) { // a client frame is always masked
    const payload = Buffer.from(text), len = payload.length, mask = crypto.randomBytes(4);
    const head = len < 126 ? Buffer.from([0x81, 0x80 | len]) : len < 65536 ? Buffer.from([0x81, 0x80 | 126, len >> 8, len & 255]) : (() => { const b = Buffer.alloc(10); b[0] = 0x81; b[1] = 0x80 | 127; b.writeBigUInt64BE(BigInt(len), 2); return b; })();
    const body = Buffer.alloc(len); for (let i = 0; i < len; i++) body[i] = payload[i] ^ mask[i & 3];
    this.sock.write(Buffer.concat([head, mask, body]));
  }
  _feed(d) {
    this.buf = Buffer.concat([this.buf, d]);
    for (;;) {
      const b = this.buf; if (b.length < 2) return;
      const fin = !!(b[0] & 0x80), op = b[0] & 15; let len = b[1] & 127, off = 2;
      if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (b.length < 10) return; len = Number(b.readBigUInt64BE(2)); off = 10; }
      if (b.length < off + len) return;
      const payload = b.subarray(off, off + len); this.buf = b.subarray(off + len);
      if (op === 8) { this.sock.end(); return; }
      if (op === 9) continue; // ping: the browser does not need an answer for a short test
      if (op === 1 || op === 2 || op === 0) { this.parts.push(payload); if (fin) { const text = Buffer.concat(this.parts).toString('utf8'); this.parts = []; this._message(text); } }
    }
  }
  _message(text) {
    let m; try { m = JSON.parse(text); } catch { return; }
    if (m.id && this.pending.has(m.id)) { const p = this.pending.get(m.id); this.pending.delete(m.id); return m.error ? p.reject(new Error(`${m.error.message}`)) : p.resolve(m.result || {}); }
    if (m.method) for (const fn of this.handlers.get(m.method) || []) { try { fn(m.params || {}); } catch {} }
  }
}
// exported for the self-test of the client itself
CdpClient.frameForTest = (text) => { const c = new CdpClient({ write() {} }); let out; c.sock = { write: (b) => { out = b; } }; c._write(text); return out; };
module.exports = { CdpClient };
