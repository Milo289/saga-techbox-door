#!/usr/bin/env node
'use strict';
// Smoke test of a BUILT app: starts it (once as control panel, once as door screen), checks that the server inside the app answers,
// that the login refuses a wrong password, that the page appears (a screenshot is taken) and that the app closes itself again.
//   node scripts/smoke.js "<path to the app executable>" [extra args…]
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const exe = process.argv[2];
const extra = process.argv.slice(3);
if (!exe || !fs.existsSync(exe)) { console.error(`App niet gevonden: ${exe}`); process.exit(2); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const ok = (name, cond, info = '') => { if (!cond) failed++; console.log(`${cond ? '✓' : '✗ FOUT'} ${name}${info ? '  ' + info : ''}`); };

async function runOnce(role, port) {
  console.log(`\n== app als ${role === 'door' ? 'deurscherm' : 'bedieningspaneel'} (poort ${port})`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'door-smoke-'));
  const shot = path.join(dir, 'scherm.png');
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ role, serverMode: 'here', port, pin: '', autostart: false, tray: false, windowed: true }));
  const env = { ...process.env, DOOR_USER_DATA: dir, DOOR_SNAPSHOT: shot, DOOR_SNAPSHOT_DELAY: '9000', DOOR_WINDOWED: '1' };
  const child = spawn(exe, [...extra], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  let exited = null;
  child.on('exit', (code) => { exited = code; });

  // 1) the server inside the app comes up
  let up = false;
  for (let i = 0; i < 120 && exited === null; i++) { try { if ((await fetch(`http://localhost:${port}/healthz`)).ok) { up = true; break; } } catch {} await sleep(500); }
  ok('de server in de app start', up);
  if (up) {
    const base = `http://localhost:${port}`;
    const state = await fetch(`${base}/api/state`).then((r) => r.json()).catch(() => null);
    ok('het deurscherm krijgt zijn gegevens', !!state?.view?.label, state ? `status: ${state.view.label}` : '');
    const bad = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'zeker-fout' }) });
    ok('een fout wachtwoord wordt geweigerd (401)', bad.status === 401);
    ok('het bedieningspaneel is niet zonder inlog te lezen', (await fetch(`${base}/api/admin-state`)).status === 401);
    const page = await fetch(`${base}/admin`).then((r) => r.text()).catch(() => '');
    ok('de pagina’s worden geleverd uit het pakket', page.includes('Deurbediening'));
  }
  // 2) the window appears and the app closes itself
  for (let i = 0; i < 90 && exited === null; i++) await sleep(500);
  ok('de app sluit zichzelf af (code 0)', exited === 0, `code: ${exited}`);
  if (exited === null) child.kill();
  ok('er is een schermafbeelding van het venster gemaakt', fs.existsSync(shot) && fs.statSync(shot).size > 4000, fs.existsSync(shot) ? `${Math.round(fs.statSync(shot).size / 1024)} kB` : 'ontbreekt');
  const snapLine = out.split('\n').find((l) => l.includes('[snapshot]')) || '';
  ok('het juiste scherm is geladen', snapLine.includes(role === 'door' ? `:${port}/ ` : `:${port}/admin`), snapLine.trim());
  if (failed) console.log('--- uitvoer van de app ---\n' + out.slice(-2500));
}

(async () => {
  await runOnce('control', 8197);
  await runOnce('door', 8198);
  console.log(failed ? `\n${failed} FOUT(EN)` : '\nALLES GESLAAGD');
  process.exit(failed ? 1 : 0);
})();
