'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const crypto = require('node:crypto');
const { CdpClient } = require('../tools/zelftest/cdp');

// a minimal WebSocket server: answers every command with the same text, in pieces, and sends one event first
function fakeBrowser() {
  return new Promise((resolve) => {
    const server = net.createServer((s) => {
      let buf = Buffer.alloc(0), up = false;
      const frame = (op, fin, payload) => { const len = payload.length; const head = len < 126 ? Buffer.from([(fin ? 0x80 : 0) | op, len]) : len < 65536 ? Buffer.from([(fin ? 0x80 : 0) | op, 126, len >> 8, len & 255]) : (() => { const b = Buffer.alloc(10); b[0] = (fin ? 0x80 : 0) | op; b[1] = 127; b.writeBigUInt64BE(BigInt(len), 2); return b; })(); return Buffer.concat([head, payload]); };
      s.on('data', (d) => {
        buf = Buffer.concat([buf, d]);
        if (!up) {
          const end = buf.indexOf('\r\n\r\n'); if (end < 0) return;
          const key = /Sec-WebSocket-Key: (.+)\r\n/.exec(buf.toString())[1];
          s.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64')}\r\n\r\n`);
          buf = buf.subarray(end + 4); up = true;
        }
        for (;;) {
          if (buf.length < 2) return;
          let len = buf[1] & 127, off = 2;
          if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; } else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
          if (buf.length < off + 4 + len) return;
          const mask = buf.subarray(off, off + 4), body = Buffer.from(buf.subarray(off + 4, off + 4 + len)); for (let i = 0; i < len; i++) body[i] ^= mask[i & 3];
          buf = buf.subarray(off + 4 + len);
          const msg = JSON.parse(body.toString());
          s.write(frame(1, true, Buffer.from(JSON.stringify({ method: 'Test.event', params: { n: 1 } }))));
          const answer = Buffer.from(JSON.stringify({ id: msg.id, result: { echo: msg.params.text } }));
          const cut = Math.floor(answer.length / 2); // two frames: the first one not final
          s.write(Buffer.concat([frame(1, false, answer.subarray(0, cut)), frame(0, true, answer.subarray(cut))]));
        }
      });
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

test('the test-run script talks to a browser: small, 70 KB and 300 KB messages, pieces and events', async (t) => {
  const server = await fakeBrowser();
  t.after(() => server.close());
  const c = await CdpClient.connect(`ws://127.0.0.1:${server.address().port}/devtools/page/x`);
  t.after(() => c.close());
  let events = 0; c.on('Test.event', () => { events++; });
  for (const size of [5, 70000, 300000]) {
    const text = 'a'.repeat(size);
    assert.equal((await c.send('Echo', { text })).echo, text);
  }
  assert.ok(events >= 3);
});
