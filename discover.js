'use strict';
// Finds door servers on the local network without typing an address: sends a small broadcast message and collects the answers.
// The server answers on UDP port 41234 (see server.js). Used by the desktop app; the iPhone/iPad app does the same in Swift.
const dgram = require('dgram');
const os = require('os');

const PORT = 41234;
const QUESTION = 'SAGA-DOOR?';

// the broadcast address of every network this computer is on (192.168.1.255, …) plus the general one
function broadcasts() {
  const out = new Set(['255.255.255.255']);
  for (const list of Object.values(os.networkInterfaces())) for (const i of list || []) {
    if (i.family !== 'IPv4' || i.internal) continue;
    const ip = i.address.split('.').map(Number), mask = i.netmask.split('.').map(Number);
    out.add(ip.map((b, k) => (b | (~mask[k] & 255))).join('.'));
  }
  return [...out];
}

// returns [{ name, host, port, version }] after `timeout` ms
function discover({ address, port = PORT, timeout = 1500 } = {}) {
  return new Promise((resolve) => {
    const found = new Map();
    let sock;
    try { sock = dgram.createSocket({ type: 'udp4', reuseAddr: true }); } catch { return resolve([]); }
    const done = () => { try { sock.close(); } catch {} resolve([...found.values()]); };
    sock.on('error', done);
    sock.on('message', (msg, rinfo) => {
      try {
        const j = JSON.parse(msg.toString('utf8'));
        if (j && j.app === 'saga-techbox-door' && Number(j.port) > 0) found.set(`${rinfo.address}:${j.port}`, { name: String(j.name || 'Deurserver').slice(0, 60), host: rinfo.address, port: Number(j.port), version: String(j.version || '') });
      } catch { /* not ours */ }
    });
    sock.bind(0, () => {
      try { sock.setBroadcast(true); for (const a of address ? [address] : broadcasts()) sock.send(Buffer.from(QUESTION), port, a, () => {}); } catch { return done(); }
      setTimeout(done, timeout);
    });
  });
}

module.exports = { discover, PORT, QUESTION };
