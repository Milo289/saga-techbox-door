#!/usr/bin/env node
'use strict';
// Saga Techbox: test everything on THIS computer, take screenshots, and put the result in ONE folder (and a zip) you can hand over.
//
//   node tools/zelftest/run.js              the usual test (a few minutes)
//   node tools/zelftest/run.js --volledig   also runs all the program tests (a few minutes more)
//   node tools/zelftest/run.js --ja         downloads a test browser (Chrome for Testing, ~150 MB) without asking, if none is found
//   node tools/zelftest/run.js --geen-browser   no screenshots, only the checks
//
// It starts its own copy of the server on a free port with an empty data folder (your real data is never touched),
// opens it in a hidden browser, clicks through the panel and the door screen, and writes everything to a folder.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline');
const { spawn, spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..', '..');
const { startServer, call, login, sleep } = require(path.join(ROOT, 'tests', 'helpers'));
const { CdpClient } = require('./cdp');

const args = new Set(process.argv.slice(2));
const sayNow = (t) => console.log(t);
const stamp = new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', '');
const home = os.homedir();
const base = fs.existsSync(path.join(home, 'Desktop')) ? path.join(home, 'Desktop') : process.cwd();
const OUT = path.join(base, `Saga-testrapport-${stamp}`);
const SHOTS = path.join(OUT, 'schermafbeeldingen');
fs.mkdirSync(SHOTS, { recursive: true });

const results = [];            // { name, ok, detail, ms, group }
const consoleErrors = [];      // what the pages complained about
const shotList = [];
let group = '';
const section = (t) => { group = t; sayNow(`\n== ${t}`); };
async function check(name, fn) {
  const t0 = Date.now();
  try { const detail = await fn(); results.push({ group, name, ok: true, detail: detail || '', ms: Date.now() - t0 }); sayNow(`  ok     ${name}`); }
  catch (e) { results.push({ group, name, ok: false, detail: String(e && e.message || e), ms: Date.now() - t0 }); sayNow(`  FOUT   ${name}\n         ${String(e && e.message || e).split('\n')[0]}`); }
}
const must = (cond, msg) => { if (!cond) throw new Error(msg); };
const quiet = () => sleep(1500); // a visitor may not press twice within a second (the door's own rule)

// ---------- find a browser (Chrome, Edge, Brave, Chromium) or fetch Chrome for Testing ----------
function browserCandidates() {
  const e = process.env;
  if (e.SAGA_BROWSER) return [e.SAGA_BROWSER];
  if (process.platform === 'darwin') {
    const apps = ['Google Chrome', 'Microsoft Edge', 'Brave Browser', 'Chromium', 'Arc', 'Google Chrome for Testing'];
    return apps.flatMap((a) => [`/Applications/${a}.app/Contents/MacOS/${a}`, path.join(home, `Applications/${a}.app/Contents/MacOS/${a}`)]);
  }
  if (process.platform === 'win32') {
    const pf = [e['ProgramFiles'], e['ProgramFiles(x86)'], e['LOCALAPPDATA']].filter(Boolean);
    return pf.flatMap((d) => [path.join(d, 'Microsoft/Edge/Application/msedge.exe'), path.join(d, 'Google/Chrome/Application/chrome.exe'), path.join(d, 'BraveSoftware/Brave-Browser/Application/brave.exe')]);
  }
  return ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge'].flatMap((n) => (e.PATH || '').split(':').map((d) => path.join(d, n)));
}
const cacheDir = path.join(home, '.saga-test-browser');
function cachedBrowser() {
  const rels = { darwin: ['chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing', 'chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'], win32: ['chrome-win64/chrome.exe'], linux: ['chrome-linux64/chrome'] }[process.platform] || [];
  return rels.map((r) => path.join(cacheDir, r)).find((f) => fs.existsSync(f)) || '';
}
async function ask(question) {
  if (args.has('--ja')) return true;
  if (!process.stdin.isTTY) return false;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const a = await new Promise((r) => rl.question(question + ' (j/n) ', r));
  rl.close(); return /^j/i.test(a.trim());
}
async function downloadBrowser() {
  const plat = { darwin: process.arch === 'arm64' ? 'mac-arm64' : 'mac-x64', win32: 'win64', linux: 'linux64' }[process.platform];
  const meta = await (await fetch('https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json')).json();
  const item = meta.channels.Stable.downloads.chrome.find((d) => d.platform === plat);
  sayNow(`  Chrome for Testing ${meta.channels.Stable.version} downloaden…`);
  fs.mkdirSync(cacheDir, { recursive: true });
  const zip = path.join(cacheDir, 'chrome.zip');
  const res = await fetch(item.url); must(res.ok, 'download mislukt: ' + res.status);
  fs.writeFileSync(zip, Buffer.from(await res.arrayBuffer()));
  const r = process.platform === 'win32'
    ? spawnSync('powershell', ['-NoProfile', '-Command', `Expand-Archive -Force -LiteralPath '${zip}' -DestinationPath '${cacheDir}'`], { encoding: 'utf8' })
    : spawnSync('unzip', ['-q', '-o', zip, '-d', cacheDir], { encoding: 'utf8' });
  must(r.status === 0, 'uitpakken mislukt: ' + (r.stderr || r.stdout));
  fs.rmSync(zip, { force: true });
  const f = cachedBrowser(); must(f, 'de browser staat niet waar verwacht na het uitpakken');
  if (process.platform !== 'win32') fs.chmodSync(f, 0o755);
  return f;
}
async function findBrowser() {
  const found = browserCandidates().find((f) => { try { return fs.existsSync(f); } catch { return false; } }) || cachedBrowser();
  if (found) return found;
  if (await ask('Er is geen Chrome of Edge gevonden voor de schermafbeeldingen. Een testbrowser (Chrome for Testing, ongeveer 150 MB) downloaden van Google?')) return downloadBrowser();
  return '';
}

// ---------- the browser: headless, driven over the DevTools protocol ----------
async function launchBrowser(exe) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'saga-browser-'));
  const child = spawn(exe, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1', 'about:blank'], { stdio: 'ignore' });
  let port = 0;
  for (let i = 0; i < 100 && !port; i++) {
    await sleep(150);
    try { port = Number(fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]); } catch {}
  }
  must(port, 'de browser startte niet (geen DevTools-poort)');
  let target = null;
  for (let i = 0; i < 50 && !target; i++) {
    try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page'); } catch {}
    if (!target) await sleep(100);
  }
  must(target, 'de browser heeft geen pagina geopend');
  const cdp = await CdpClient.connect(target.webSocketDebuggerUrl);
  for (const m of ['Page.enable', 'Runtime.enable', 'Log.enable']) await cdp.send(m);
  let current = '';
  cdp.on('Runtime.exceptionThrown', (e) => consoleErrors.push({ page: current, text: (e.exceptionDetails.exception && e.exceptionDetails.exception.description) || e.exceptionDetails.text }));
  cdp.on('Runtime.consoleAPICalled', (e) => { if (e.type === 'error') consoleErrors.push({ page: current, text: e.args.map((a) => a.value || a.description || '').join(' ') }); });
  cdp.on('Log.entryAdded', (e) => { if (e.entry.level === 'error' && !/favicon|401/.test(e.entry.text + (e.entry.url || ''))) consoleErrors.push({ page: current, text: `${e.entry.text} ${e.entry.url || ''}` }); });
  const api = {
    async shot(name, url, { width = 1280, height = 800, mobile = false, storage = {}, run = '', wait = 900, full = false } = {}) {
      current = name;
      await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
      await cdp.send('Page.navigate', { url: 'about:blank' });
      const origin = new URL(url).origin;
      await cdp.send('Page.navigate', { url: origin + '/healthz' }); await sleep(250);
      await cdp.send('Runtime.evaluate', { expression: `try { localStorage.clear(); ${Object.entries(storage).map(([k, v]) => `localStorage.setItem(${JSON.stringify(k)}, ${JSON.stringify(v)});`).join(' ')} } catch (e) {}` });
      await cdp.send('Page.navigate', { url });
      await sleep(wait + 600);
      if (run) { const r = await cdp.send('Runtime.evaluate', { expression: run, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) consoleErrors.push({ page: name, text: 'script: ' + r.exceptionDetails.text }); await sleep(500); }
      const junk = await cdp.send('Runtime.evaluate', { expression: `(/(^|\\n)\\s*(null|undefined|NaN|\\[object Object\\])\\s*($|\\n)|undefined|\\[object Object\\]/).test(document.body.innerText)`, returnByValue: true });
      if (junk.result && junk.result.value === true) consoleErrors.push({ page: name, text: 'er staat een vreemd woord op de pagina (null, undefined of [object Object])' });
      let clip;
      if (full) { const m = await cdp.send('Page.getLayoutMetrics'); clip = { x: 0, y: 0, width, height: Math.min(Math.ceil(m.cssContentSize.height), 4000), scale: 1 }; }
      const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip, captureBeyondViewport: true } : {}) });
      const file = `${String(shotList.length + 1).padStart(2, '0')}-${name}.png`;
      fs.writeFileSync(path.join(SHOTS, file), Buffer.from(data, 'base64'));
      shotList.push({ file, name, url: url.replace(origin, '') });
      sayNow(`  foto   ${file}`);
    },
    async eval(expression) { const r = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); return r.result && r.result.value; },
    async close() { try { cdp.close(); } catch {} child.kill(); await sleep(300); try { fs.rmSync(profile, { recursive: true, force: true }); } catch {} },
  };
  return api;
}

// ---------- the report ----------
function systemInfo() {
  const lines = [`Datum: ${new Date().toString()}`, `Besturingssysteem: ${os.type()} ${os.release()} (${process.platform}/${process.arch})`, `Computer: ${os.hostname()}, ${os.cpus().length} processor(en), ${Math.round(os.totalmem() / 1073741824)} GB geheugen`, `Node: ${process.version}`];
  try { lines.push(`Programmaversie: ${JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version}`); } catch {}
  try { const g = spawnSync('git', ['log', '-1', '--format=%h %s'], { cwd: ROOT, encoding: 'utf8' }); if (g.status === 0) lines.push(`Laatste wijziging: ${g.stdout.trim()}`); } catch {}
  return lines.join('\n') + '\n';
}
function writeReport(extra) {
  const fails = results.filter((r) => !r.ok);
  const md = [];
  md.push(`# Saga Techbox: testrapport`, '', `**Uitkomst: ${fails.length ? `${fails.length} van ${results.length} controles mislukt` : `alle ${results.length} controles geslaagd`}**` + (consoleErrors.length ? `, ${consoleErrors.length} foutmelding(en) in de browser` : ''), '', '```', systemInfo().trim(), '```', '');
  let g = '';
  for (const r of results) { if (r.group !== g) { g = r.group; md.push('', `## ${g}`, ''); } md.push(`- ${r.ok ? 'OK ' : '**FOUT**'} ${r.name}${r.detail ? ` (${r.detail})` : ''}${r.ok ? '' : ''}`); }
  if (consoleErrors.length) { md.push('', '## Foutmeldingen uit de browser', ''); for (const c of consoleErrors.slice(0, 60)) md.push(`- ${c.page}: ${String(c.text).split('\n')[0].slice(0, 300)}`); }
  if (shotList.length) { md.push('', '## Schermafbeeldingen', ''); for (const s of shotList) md.push(`- ${s.file}  (${s.url})`); }
  if (extra) md.push('', '## Opmerkingen', '', extra);
  fs.writeFileSync(path.join(OUT, 'RAPPORT.md'), md.join('\n') + '\n');
  fs.writeFileSync(path.join(OUT, 'resultaten.json'), JSON.stringify({ version: 1, results, consoleErrors, shots: shotList }, null, 2));
  fs.writeFileSync(path.join(OUT, 'systeem.txt'), systemInfo());
  fs.writeFileSync(path.join(OUT, 'LEESMIJ.txt'), 'Geef deze hele map (of het zip-bestand ernaast) aan Claude.\nRAPPORT.md is de samenvatting, schermafbeeldingen/ bevat de foto\'s, server.log is wat de server zei.\nEr staat geen wachtwoord of persoonlijke gegevens in: de test draait op een lege, tijdelijke server.\n');
}
function zipIt() {
  const zip = OUT + '.zip';
  try { fs.rmSync(zip, { force: true }); } catch {}
  const r = process.platform === 'win32'
    ? spawnSync('powershell', ['-NoProfile', '-Command', `Compress-Archive -Force -Path '${OUT}\\*' -DestinationPath '${zip}'`], { encoding: 'utf8' })
    : spawnSync('zip', ['-q', '-r', zip, path.basename(OUT)], { cwd: path.dirname(OUT), encoding: 'utf8' });
  return r.status === 0 ? zip : '';
}
function openFolder() {
  try {
    if (process.platform === 'darwin') spawn('open', [OUT], { detached: true, stdio: 'ignore' }).unref();
    else if (process.platform === 'win32') spawn('explorer', [OUT], { detached: true, stdio: 'ignore' }).unref();
    else spawn('xdg-open', [OUT], { detached: true, stdio: 'ignore' }).unref();
  } catch {}
}

// ---------- the checks ----------
async function main() {
  sayNow('Saga Techbox: alles testen op deze computer\nDe test gebruikt een eigen, lege, tijdelijke server; jouw echte gegevens blijven ongemoeid.');
  const srv = await startServer({ patch: true, system: true, rootPassword: 'zelftest-wachtwoord-1' });
  let browser = null, notes = '';
  const R = (method, p, body, token) => call(srv, method, p, body, token);
  const raw = async (method, p, body) => { const r = await fetch(srv.url + p, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, json: await r.json().catch(() => ({})), text: '' }; };
  let me = '';            // the token of the account made by the first-start check
  let milo = '';          // the token of the main account
  try {
    section('Server');
    await check('de server draait', async () => { const r = await R('GET', '/healthz'); must(r.status === 200, 'status ' + r.status); return srv.url; });
    await check('deurscherm, paneel en bezoekerspagina laden', async () => { for (const p of ['/', '/admin', '/visit']) { const r = await R('GET', p); must(r.status === 200 && /<html/i.test(r.text), `${p}: ${r.status}`); } });
    await check('voorwaarden en privacy staan er', async () => { for (const p of ['/voorwaarden', '/privacy']) { const r = await R('GET', p); must(r.status === 200 && r.text.length > 500, `${p}: ${r.status}`); } });
    await check('downloadpagina /get is aan en toont de officiële link', async () => { const r = await R('GET', '/get'); must(r.status === 200 && /github\.com/.test(r.text), 'status ' + r.status); });

    section('Eerste keer: eigen account');
    await check('de inlogpagina biedt “eerste keer” aan', async () => { must((await R('GET', '/api/auth-info')).json.setup === true, 'setup staat niet open'); });
    await check('een te kort of te makkelijk wachtwoord wordt geweigerd', async () => { must((await raw('POST', '/api/setup', { name: 'Anna', password: 'kort' })).status === 400, 'kort wachtwoord geaccepteerd'); must((await raw('POST', '/api/setup', { name: 'Anna', password: 'password' })).status === 400, 'makkelijk wachtwoord geaccepteerd'); });
    await check('je eigen account maken en meteen ingelogd zijn', async () => { const r = await raw('POST', '/api/setup', { name: 'Anna Test', password: 'eigen-wachtwoord-zelftest-1' }); must(r.status === 200 && r.json.token, JSON.stringify(r.json)); me = r.json.token; must((await R('GET', '/api/admin-state', undefined, me)).status === 200, 'het nieuwe account mag het paneel niet openen'); });
    await check('de eerste installatie kan maar één keer', async () => { must((await raw('POST', '/api/setup', { name: 'Bert', password: 'ander-wachtwoord-zelftest-2' })).status === 403, 'tweede keer werkte nog'); must((await R('GET', '/api/auth-info')).json.setup === false, 'setup staat nog open'); });
    await check('opnieuw inloggen met het eigen wachtwoord', async () => { const r = await raw('POST', '/api/login', { username: 'annatest', password: 'eigen-wachtwoord-zelftest-1' }); must(r.status === 200, 'status ' + r.status); });
    milo = await login(srv, 'milo', 'zelftest-wachtwoord-1').catch(() => '');

    section('Instellingen');
    const tok = () => milo || me;
    await check('naam, openingstijden en stijl opslaan en terugvinden', async () => {
      const cur = (await R('GET', '/api/admin-state', undefined, tok())).json.settings;
      const r = await R('POST', '/api/settings', { name: 'Zelftest-deur', theme: 'forest', hours: { ...cur.hours, enabled: true, days: [0, 1, 2, 3, 4, 5, 6], from: '00:00', to: '23:59' } }, tok());
      must(r.status === 200, r.text);
      const s = (await R('GET', '/api/admin-state', undefined, tok())).json.settings;
      must(s.name === 'Zelftest-deur' && s.theme === 'forest' && s.hours.to === '23:59', 'niet teruggevonden');
    });
    await check('kant-en-klare knoppen aanzetten (doel: school)', async () => {
      const cur = (await R('GET', '/api/admin-state', undefined, tok())).json.settings;
      const r = await R('POST', '/api/settings', { quickButtons: ['help', 'laptop', 'wifi'], visitors: { ...cur.visitors, accounts: true, deleteAccount: true, cancel: true, pinLength: 4 } }, tok());
      must(r.status === 200, r.text);
      const pub = (await R('GET', '/api/state')).json;
      must((pub.settings.customButtons || []).length >= 3, 'de knoppen staan niet op het deurscherm');
    });
    await check('alle instellingen worden beschreven (voor “Alle instellingen” en de apps)', async () => { const r = await R('GET', '/api/settings-schema', undefined, tok()); must(r.status === 200 && JSON.stringify(r.json).length > 5000, 'status ' + r.status); });

    section('Bezoekers');
    let pin = '';
    await check('aanbellen', async () => { await quiet(); const r = await raw('POST', '/api/visit', { type: 'bell', name: 'Zelftest' }); must(r.status === 200, JSON.stringify(r.json)); });
    await check('een account maken geeft een pincode', async () => { const r = await raw('POST', '/api/profile', { name: 'Zelftest Bezoeker' }); must(r.status === 200 && /^\d{4}$/.test(r.json.pin), JSON.stringify(r.json)); pin = r.json.pin; });
    await check('met die pincode een vraag stellen (naam komt vanzelf)', async () => { await quiet(); const r = await raw('POST', '/api/visit', { type: 'message', message: 'Zelftest-vraag', nr: pin }); must(r.status === 200, JSON.stringify(r.json)); const l = (await R('GET', '/api/admin-state', undefined, tok())).json.requests; must(l.some((x) => x.message === 'Zelftest-vraag' && x.name === 'Zelftest Bezoeker'), 'naam niet ingevuld'); });
    await check('de pincode staat in de lijst met personen', async () => { const p = (await R('GET', '/api/admin-state', undefined, tok())).json.people; must(p.some((x) => x.nr === pin && x.self), 'persoon niet gevonden'); });
    await check('account verwijderen vraagt eerst en wist dan echt', async () => {
      const ask = await raw('POST', '/api/profile/delete', { nr: pin }); must(ask.json.deletable === true, 'geen vraag vooraf');
      must((await raw('POST', '/api/profile/delete', { nr: pin, confirm: true })).json.ok === true, 'verwijderen mislukt');
      const st = (await R('GET', '/api/admin-state', undefined, tok())).json;
      must(!st.people.some((x) => x.nr === pin), 'persoon bestaat nog'); must(!st.requests.some((x) => x.nr === pin), 'verzoeken horen nog bij het nummer');
    });
    await check('een vraag annuleren met het nummer', async () => {
      await quiet(); const made = await raw('POST', '/api/visit', { type: 'message', message: 'Annuleer mij', name: 'Cancel Test' }); must(made.status === 200, JSON.stringify(made.json));
      const code = made.json.cancelCode; must(code, 'geen annuleernummer in het antwoord');
      { const l = (await raw('POST', '/api/cancel/lookup', { code })).json; must(l.found === true && l.cancellable !== false, 'het nummer wordt niet gevonden'); }
      const out = await raw('POST', '/api/cancel', { code, confirm: true }); must(out.status === 200, JSON.stringify(out.json));
    });

    section('Paneel en beheer');
    await check('statistiek, checklist en privacy-zoeken antwoorden', async () => { for (const p of ['/api/stats', '/api/checklist']) { const r = await R('GET', p, undefined, tok()); must(r.status < 400, `${p}: ${r.status}`); } });
    await check('een back-up maken en terugvinden', async () => { const r = await R('POST', '/api/system/backups/create', {}, milo || tok()); must(r.status === 200, r.status + ' ' + r.text.slice(0, 100)); const l = await R('GET', '/api/system', undefined, milo || tok()); must(l.status === 200, 'systeem ' + l.status); });
    await check('zoeken naar updates werkt (internet nodig)', async () => { const r = await R('POST', '/api/update/check', {}, milo || tok()); must(r.status === 200, r.status + ' ' + r.text.slice(0, 120)); return r.json && r.json.version ? `nieuwste: ${r.json.version}` : ''; });

    // ---- the browser part ----
    section('Schermafbeeldingen en foutmeldingen in de browser');
    const exe = args.has('--geen-browser') ? '' : await findBrowser().catch((e) => { notes += `Browser zoeken mislukt: ${e.message}\n`; return ''; });
    if (!exe) { results.push({ group, name: 'schermafbeeldingen', ok: false, detail: 'geen browser gevonden: installeer Chrome of Edge, of start met --ja om een testbrowser te laten downloaden', ms: 0 }); }
    else {
      try {
        browser = await launchBrowser(exe);
        notes += `Browser: ${exe}\n`;
        const token = milo || me, S = { doorToken: token };
        const W = 1280, H = 800;
        await check('inlogpagina met “eerste keer”? (na installatie niet meer)', async () => { await browser.shot('inloggen', srv.url + '/admin', { width: 900, height: 700 }); });
        await check('deurscherm', async () => { await browser.shot('deurscherm', srv.url + '/', { width: 1280, height: 720 }); await browser.shot('deurscherm-staand', srv.url + '/', { width: 600, height: 1000 }); });
        await check('deurscherm: elk soort knop opent een scherm', async () => {
          await browser.shot('deurscherm-annuleren-cijfers', srv.url + '/', { width: 1280, height: 800, run: `(async()=>{const t=[...document.querySelectorAll('.tile')].find(x=>x.textContent.trim()=='Annuleren');t.click();await new Promise(r=>setTimeout(r,400));for(const d of ['1','2','3','4','5','6']){[...document.querySelectorAll('#sheet .kb button')].find(x=>x.textContent.trim()==d).dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true}));await new Promise(r=>setTimeout(r,80))}})()` });
          const armed = await browser.eval(`(()=>{const b=[...document.querySelectorAll('#sheet button')].find(x=>x.textContent.trim()=='Volgende');return !!b && !b.disabled && b.classList.contains('arm')})()`);
          must(armed === true, 'de knop “Volgende” wordt niet actief bij 6 cijfers');
          const names = ['Account verwijderen', 'Account maken', 'Vraagje', 'Tijd booken'];
          for (const n of names) await browser.shot('deurscherm-' + n.toLowerCase().replace(/\s+/g, '-'), srv.url + '/', { width: 1280, height: 800, run: `(async()=>{const t=[...document.querySelectorAll('.tile')].find(x=>x.textContent.trim()==${JSON.stringify(n)});t.click();await new Promise(r=>setTimeout(r,500))})()` });
        });
        await check('bezoekerspagina op een telefoon', async () => { await browser.shot('bezoekerspagina-telefoon', srv.url + '/visit', { width: 390, height: 844, mobile: true }); });
        await check('paneel: elke pagina, makkelijke versie', async () => {
          for (const t of ['now', 'inbox', 'settings', 'design']) await browser.shot(`paneel-makkelijk-${t}`, `${srv.url}/admin#${t}`, { storage: { ...S, doorSimple: '1', doorWizard: 'done' }, width: W, height: H, full: true });
        });
        await check('paneel: elke pagina met alles', async () => {
          for (const t of ['all', 'admin', 'security', 'system']) await browser.shot(`paneel-alles-${t}`, `${srv.url}/admin#${t}`, { storage: { ...S, doorSimple: '0', doorWizard: 'done', ['doorCat-' + t]: '*' }, width: W, height: H, full: true });
        });
        await check('paneel op een telefoon: nergens breder dan het scherm', async () => {
          for (const t of ['now', 'settings', 'design']) {
            await browser.shot(`paneel-telefoon-${t}`, `${srv.url}/admin#${t}`, { storage: { ...S, doorSimple: '1', doorWizard: 'done' }, width: 390, height: 844, mobile: true, full: true });
            const wide = await browser.eval('document.documentElement.scrollWidth > innerWidth + 2');
            must(!wide, `pagina “${t}” is breder dan het telefoonscherm`);
          }
        });
        await check('de installatie met de keuze van het doel', async () => { await browser.shot('installatie-doel', `${srv.url}/admin#now`, { storage: { ...S, doorWizard: 'start', doorWizardStep: '0' }, width: W, height: H }); const t = await browser.eval(`document.body.innerText.includes('Waarvoor gebruik je deze deur')`); must(t === true, 'de vraag naar het doel staat er niet'); });
        await check('geen foutmeldingen in de browser', async () => { must(consoleErrors.length === 0, `${consoleErrors.length} foutmelding(en); zie RAPPORT.md`); });
      } catch (e) {
        results.push({ group, name: 'browser', ok: false, detail: e.message, ms: 0 }); sayNow('  FOUT   browser: ' + e.message);
      } finally { if (browser) await browser.close(); }
    }

    if (args.has('--volledig')) {
      section('Alle programmatests');
      await check('tests/*.test.js', async () => {
        const r = spawnSync(process.execPath, ['--test', '--test-timeout=240000', 'tests/*.test.js'], { cwd: ROOT, encoding: 'utf8', timeout: 900000, shell: process.platform === 'win32' });
        fs.writeFileSync(path.join(OUT, 'programmatests.log'), (r.stdout || '') + (r.stderr || ''));
        const pass = /# pass (\d+)/.exec(r.stdout || '') || /ℹ pass (\d+)/.exec(r.stdout || ''), fail = /# fail (\d+)/.exec(r.stdout || '') || /ℹ fail (\d+)/.exec(r.stdout || '');
        must(fail && Number(fail[1]) === 0, `${fail ? fail[1] : '?'} mislukt (zie programmatests.log)`);
        return `${pass ? pass[1] : '?'} geslaagd`;
      });
    }
  } finally {
    try { fs.writeFileSync(path.join(OUT, 'server.log'), srv.log()); } catch {}
    await srv.stop();
  }
  writeReport(notes);
  const zip = zipIt();
  const fails = results.filter((r) => !r.ok);
  sayNow(`\n${fails.length ? `${fails.length} van ${results.length} controles mislukt.` : `Alle ${results.length} controles geslaagd.`}`);
  sayNow(`\nGeef deze map aan Claude:\n  ${OUT}` + (zip ? `\nof dit zip-bestand:\n  ${zip}` : ''));
  openFolder();
  process.exit(fails.length ? 1 : 0);
}
main().catch((e) => { console.error('\nDe test kon niet worden afgemaakt:', e); try { fs.writeFileSync(path.join(OUT, 'FOUT.txt'), String(e && e.stack || e)); writeReport('De test stopte onverwacht: ' + (e && e.message)); } catch {} process.exit(2); });
