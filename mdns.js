'use strict';
// Makes the server findable by name on the local network ("saga-deur.local"), the way a printer is, without any extra program.
// Apple devices, Windows 10+, Linux (with avahi) and most browsers then find it. Only answers questions about its own name.
const dgram = require('dgram');
const os = require('os');

const GROUP = '224.0.0.251', TTL = 120;
// what is going on, for the test page: did the lookups for our names arrive, and did we answer
const stats = { running: false, names: [], ips: [], queries: 0, answered: 0, lastQuery: 0, error: '', avahi: false };

const labels = (name) => Buffer.concat([...name.split('.').map((l) => Buffer.concat([Buffer.from([l.length]), Buffer.from(l)])), Buffer.from([0])]);
const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16BE(n); return b; };
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };

// reads the names asked in a query (no answers inside): [{ name, type }]
function questions(buf) {
  try {
    if (buf.length < 12 || (buf.readUInt16BE(2) & 0x8000)) return []; // too short, or a response
    const n = buf.readUInt16BE(4), out = [];
    let o = 12;
    for (let i = 0; i < n; i++) {
      const parts = [];
      for (;;) {
        const len = buf[o++];
        if (len === undefined || len > 63) return out; // compression or damage: stop
        if (len === 0) break;
        parts.push(buf.subarray(o, o + len).toString('latin1')); o += len;
      }
      out.push({ name: parts.join('.').toLowerCase(), type: buf.readUInt16BE(o), unicast: !!(buf.readUInt16BE(o + 2) & 0x8000) });
      o += 4;
    }
    return out;
  } catch { return []; }
}

function record(name, type, rdata) { return Buffer.concat([labels(name), u16(type), u16(0x8001), u32(TTL), u16(rdata.length), rdata]); }

// the answer to a query about one of our names: the address, or "no such record" for IPv6; null when the question is not for us
function answerFor(query, names, ips, forceUnicast, nsec = true) {
  const mine = new Set(names.map((n) => n.toLowerCase()));
  const answers = [], asked = [];
  for (const q of questions(query)) {
    if (!mine.has(q.name)) continue;
    if (q.type === 1 || q.type === 255) { for (const ip of ips) answers.push(record(q.name, 1, Buffer.from(ip.split('.').map(Number)))); asked.push(q); }
    else if (q.type === 28 && nsec) { answers.push(record(q.name, 47, Buffer.concat([labels(q.name), Buffer.from([0, 1, 0x40])]))); asked.push(q); } // only an A record exists
  }
  if (!answers.length) return null;
  const header = Buffer.concat([forceUnicast ? query.subarray(0, 2) : u16(0), u16(0x8400), u16(0), u16(answers.length), u16(0), u16(0)]);
  return Buffer.concat([header, ...answers]);
}

const lanIps = () => Object.values(os.networkInterfaces()).flat().filter((a) => a && a.family === 'IPv4' && !a.internal).map((a) => a.address);

function start(names, log = () => {}, opts = {}) {
  const PORT = opts.port || 5353; // another port only in tests
  let sock;
  // on the Linux disk avahi already answers for IPv6; then only the IPv4 address is answered here (two "no such record" answers would fight)
  const avahi = require('fs').existsSync('/run/avahi-daemon/socket');
  Object.assign(stats, { names, avahi });
  try { sock = dgram.createSocket({ type: 'udp4', reuseAddr: true }); } catch (e) { log(`naam in het netwerk: ${e.message}`); return null; }
  const announce = () => { const ips = lanIps(); if (!ips.length) return; const a = names.map((n) => answerFor(Buffer.concat([u16(0), u16(0), u16(1), u16(0), u16(0), u16(0), labels(n), u16(1), u16(1)]), [n], ips, false)).filter(Boolean); for (const m of a) sock.send(m, PORT, GROUP, () => {}); };
  sock.on('error', (e) => { stats.error = e.message; stats.running = false; log(`naam in het netwerk gestopt: ${e.message}`); try { sock.close(); } catch {} });
  sock.on('message', (msg, rinfo) => {
    const ips = lanIps();
    if (!ips.length) return;
    const legacy = rinfo.port !== PORT; // an old-style question gets its answer back at the sender
    const asked = questions(msg).some((q) => names.includes(q.name));
    if (asked) { stats.queries++; stats.lastQuery = Date.now(); }
    const reply = answerFor(msg, names, ips, legacy, !avahi);
    if (!reply) return;
    stats.answered++;
    if (legacy || questions(msg).some((q) => q.unicast)) sock.send(reply, rinfo.port, rinfo.address, () => {});
    else sock.send(reply, PORT, GROUP, () => {});
  });
  sock.bind(PORT, () => {
    try { for (const ip of lanIps()) { try { sock.addMembership(GROUP, ip); } catch {} } sock.setMulticastTTL(255); sock.setMulticastLoopback(true); } catch {}
    stats.running = true; stats.ips = lanIps();
    announce();
    sock.unref();
    sock.timer = setInterval(announce, 60 * 1000); sock.timer.unref();
    log(`bereikbaar met de naam ${names.join(', ')}`);
  });
  return sock;
}

module.exports = { start, answerFor, questions, labels, stats };
