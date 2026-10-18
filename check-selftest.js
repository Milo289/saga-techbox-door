#!/usr/bin/env node
'use strict';
// Tries everything on a copy: it copies this program to a temporary folder, gives the copy its own main account with a password made up
// just now, starts it on a spare port with an empty data folder, runs all the checks of the test page against it, and removes it again.
// Nothing of the real data or the real accounts is touched, and nothing about the real program is made weaker: only the temporary copy differs.
//   node check-selftest.js [--json]
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const net = require('net');
const { spawn } = require('child_process');
const core = require('./public/check-core.js');
const json = process.argv.includes('--json');

const FILES = ['server.js', 'power.js', 'integrations.js', 'security.js', 'pki.js', 'schedule.js', 'mdns.js', 'updates.js', 'settings-schema.js', 'discover.js', 'seal.js', 'access.js', 'package.json'];
const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); s.on('error', rej); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'saga-selftest-'));
  const app = path.join(dir, 'app'), data = path.join(dir, 'data');
  let child = null;
  const cleanup = () => { try { if (child && child.exitCode === null) child.kill(); } catch {} try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} };
  process.on('exit', cleanup);
  try {
    fs.mkdirSync(app, { recursive: true });
    for (const f of FILES) fs.copyFileSync(path.join(__dirname, f), path.join(app, f));
    fs.cpSync(path.join(__dirname, 'public'), path.join(app, 'public'), { recursive: true });
    // the copy gets its own main account (the real one stays as it is)
    const pw = 'T' + crypto.randomBytes(9).toString('base64url') + '1!', salt = crypto.randomBytes(16);
    const hash = `scrypt$${salt.toString('hex')}$${crypto.scryptSync(pw, salt, 64).toString('hex')}`;
    fs.writeFileSync(path.join(app, 'access.js'), `module.exports = ${JSON.stringify({ username: 'milo', hash, check: require('./seal.js').seal('milo', hash) })};\n`);
    const port = await freePort();
    let log = '';
    child = spawn(process.execPath, [path.join(app, 'server.js')], { env: { ...process.env, PORT: String(port), DATA_DIR: data, HOST: '127.0.0.1', DOOR_MDNS: 'off', DOOR_STARTER_PASSWORD: 'selftest-' + crypto.randomBytes(6).toString('hex') }, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', (d) => { log += d; }); child.stderr.on('data', (d) => { log += d; });
    const base = `http://127.0.0.1:${port}`;
    let up = false;
    for (let i = 0; i < 100 && !up; i++) { try { up = (await fetch(base + '/healthz')).ok; } catch {} if (!up) await sleep(100); }
    if (!up) throw new Error('de testkopie startte niet:\n' + log.slice(-600));
    const env = {
      fetch: (p, init) => fetch(base + p, init), hostname: '127.0.0.1', port: String(port), origin: base, userAgent: 'selftest (node ' + process.version + ')',
      creds: () => ({ user: 'milo', pass: pw, code: '' }), mailtest: false,
      onResult: (r) => { if (!json && r.state !== 'run') console.log(`${{ ok: '✓', bad: '✗', warn: '!', skip: '–' }[r.state]} ${r.groupTitle} → ${r.name}${r.detail ? ' — ' + r.detail : ''}`); },
    };
    const s = await core.createRunner(env).run();
    if (json) console.log(JSON.stringify({ ok: s.ok, bad: s.bad, warn: s.warn, skip: s.skip, results: s.results.map((r) => ({ group: r.groupTitle, name: r.name, state: r.state, detail: r.detail })) }));
    else console.log(`\n${s.ok} gelukt, ${s.bad} mislukt, ${s.warn} aandachtspunt(en), ${s.skip} overgeslagen`);
    cleanup();
    process.exit(s.bad ? 1 : 0);
  } catch (e) { console.error('De test stopte: ' + e.message); cleanup(); process.exit(2); }
})();
