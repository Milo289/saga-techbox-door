#!/usr/bin/env node
'use strict';
// Runs the same checks as the test page (/check), but from the command line, without a browser.
//   node check-runner.js http://127.0.0.1:8080 --user milo --pass geheim [--code 123456] [--mail] [--json]
// It is also on the Linux disk, so a Proxmox script can run it inside the machine.
const core = require('./public/check-core.js');
const args = process.argv.slice(2);
const base = (args.find((a) => /^https?:\/\//.test(a)) || 'http://127.0.0.1:8080').replace(/\/+$/, '');
const opt = (name, d = '') => { const i = args.indexOf('--' + name); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d; };
const json = args.includes('--json'), testMode = args.includes('--test-mode');
const url = new URL(base);
const env = {
  fetch: (p, init) => fetch(base + p, init),
  hostname: url.hostname, port: url.port, origin: base, userAgent: 'check-runner (node ' + process.version + ')',
  creds: () => ({ user: opt('user', 'admin'), pass: opt('pass', ''), code: opt('code', '') }),
  mailtest: args.includes('--mail'), testMode,
  onResult: (r) => { if (!json && r.state !== 'run') console.log(`${{ ok: '✓', bad: '✗', warn: '!', skip: '–' }[r.state]} ${r.groupTitle} → ${r.name}${r.detail ? ' — ' + r.detail : ''}`); },
};
core.createRunner(env).run().then((s) => {
  if (json) console.log(JSON.stringify({ ok: s.ok, bad: s.bad, warn: s.warn, skip: s.skip, results: s.results.map((r) => ({ group: r.groupTitle, name: r.name, state: r.state, detail: r.detail })) }));
  else console.log(`\n${s.ok} gelukt, ${s.bad} mislukt, ${s.warn} aandachtspunt(en), ${s.skip} overgeslagen`);
  process.exit(s.bad ? 1 : 0);
}).catch((e) => { console.error('De test stopte: ' + e.message); process.exit(2); });
