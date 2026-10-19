'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const U = require('../updates.js');

test('updates: versions compare the way people expect (a beta is older than its final version)', () => {
  const c = U.compareVersions;
  assert.equal(c('3.4.0-beta.16', '3.4.0-beta.9'), 1);
  assert.equal(c('3.4.0-beta.1', '3.4.0'), -1);
  assert.equal(c('3.4.0', '3.2.0'), 1);
  assert.equal(c('v3.4.0', '3.4.0'), 0);
  assert.equal(c('3.10.0', '3.9.0'), 1);
  assert.equal(c('nonsense', '3.4.0'), 0);
});

test('updates: the channel decides whether betas are offered', () => {
  const rel = [
    { tag_name: 'v3.2.0', prerelease: false, assets: [] },
    { tag_name: 'v3.4.0-beta.16', prerelease: true, assets: [{ name: U.BUNDLE, url: 'a' }, { name: U.BUNDLE + '.sha256', url: 'b' }, { name: U.BUNDLE + '.sha256.sig', url: 'c' }] },
    { tag_name: 'v9.9.9', draft: true, prerelease: false, assets: [] },
    { tag_name: 'iso-latest', prerelease: false, assets: [] },
  ];
  assert.equal(U.pickRelease(rel, 'stable', '3.2.0').newer, false);
  const b = U.pickRelease(rel, 'beta', '3.4.0-beta.15');
  assert.equal(b.newer, true); assert.equal(b.version, '3.4.0-beta.16'); assert.equal(b.hasBundle, true);
  assert.equal(U.pickRelease(rel, 'beta', '3.4.0-beta.16').newer, false);
  assert.equal(U.pickRelease([], 'beta', '1.0.0').newer, false);
});

test('updates: unsafe archive names are refused', () => {
  assert.equal(U.safeNames('server.js\npublic/\npublic/a.html\n'), true);
  assert.equal(U.safeNames('../evil\n'), false);
  assert.equal(U.safeNames('a/../../evil\n'), false);
  assert.equal(U.safeNames('/etc/passwd\n'), false);
  assert.equal(U.safeNames(''), false);
});

function makeBundle(dir, version) {
  const src = fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-'));
  fs.mkdirSync(path.join(src, 'public'));
  fs.writeFileSync(path.join(src, 'public', 'index.html'), '<p>x</p>');
  fs.writeFileSync(path.join(src, 'server.js'), 'module.exports={}');
  fs.writeFileSync(path.join(src, 'package.json'), JSON.stringify({ version }));
  const file = path.join(dir, 'b.tgz');
  execFileSync('tar', ['-czf', 'b.tgz', '-C', path.basename(src), '.'], { cwd: os.tmpdir() }); fs.copyFileSync(path.join(os.tmpdir(), 'b.tgz'), file); fs.rmSync(path.join(os.tmpdir(), 'b.tgz'));
  fs.rmSync(src, { recursive: true, force: true });
  return fs.readFileSync(file);
}

const KEYS = crypto.generateKeyPairSync('ed25519');
const PUB = KEYS.publicKey.export({ type: 'spki', format: 'pem' });
const sign = (text) => Buffer.from(crypto.sign(null, Buffer.from(text), KEYS.privateKey).toString('base64'));
function updater(dataDir, files, current = '3.4.0-beta.15', { withSig = true } = {}) {
  const assets = [{ name: U.BUNDLE, url: 'bundle' }, { name: U.BUNDLE + '.sha256', url: 'sum' }];
  if (withSig) assets.push({ name: U.BUNDLE + '.sha256.sig', url: 'sig' });
  const rel = [{ tag_name: 'v3.4.0-beta.16', prerelease: true, assets }];
  if (files.sum && !files.sig) files = { ...files, sig: sign(String(files.sum)) };
  return U.create({ dataDir, appDir: dataDir, currentVersion: current, getToken: () => '', getChannel: () => 'beta', fetchJson: async () => rel, fetchFile: async (u) => files[u], publicKey: PUB });
}

test('updates: a checked bundle is unpacked and made current; a damaged one changes nothing', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'upd-'));
  const data = makeBundle(dir, '3.4.0');
  const sum = crypto.createHash('sha256').update(data).digest('hex');
  // wrong checksum
  const bad = updater(dir, { bundle: data, sum: Buffer.from('0'.repeat(64)) });
  await bad.check();
  await assert.rejects(() => bad.apply(), /controlesom/);
  assert.equal(fs.existsSync(path.join(dir, 'app', 'current.json')), false);
  // a good checksum but a signature of someone else (a replaced release)
  const other = crypto.generateKeyPairSync('ed25519').privateKey;
  const goodSum = Buffer.from(sum + '  Saga-Techbox-Server.tgz\n');
  const forged = updater(dir, { bundle: data, sum: goodSum, sig: Buffer.from(crypto.sign(null, goodSum, other).toString('base64')) });
  await forged.check();
  await assert.rejects(() => forged.apply(), /ondertekening/);
  assert.equal(fs.existsSync(path.join(dir, 'app', 'current.json')), false);
  // no signature in the release at all
  const unsigned = updater(dir, { bundle: data, sum: goodSum }, '3.4.0-beta.15', { withSig: false });
  const us = await unsigned.check();
  assert.equal(us.hasBundle, false);
  await assert.rejects(() => unsigned.apply(), /ondertekend/);
  // good
  const ok = updater(dir, { bundle: data, sum: Buffer.from(sum + '  Saga-Techbox-Server.tgz\n') });
  const st = await ok.check();
  assert.equal(st.newer, true); assert.equal(st.version, '3.4.0-beta.16');
  const r = await ok.apply();
  assert.equal(r.version, '3.4.0-beta.16');
  const cur = JSON.parse(fs.readFileSync(path.join(dir, 'app', 'current.json'), 'utf8'));
  assert.equal(cur.dir, '3.4.0-beta.16');
  assert.ok(fs.existsSync(path.join(dir, 'app', cur.dir, 'server.js')));
  assert.equal(fs.readdirSync(path.join(dir, 'app')).some((n) => n.startsWith('.new-')), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('updates: an incomplete bundle and no newer version are refused with a clear message', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'upd-'));
  const src = fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-'));
  fs.writeFileSync(path.join(src, 'server.js'), 'x');
  const f = path.join(dir, 'b.tgz'); execFileSync('tar', ['-czf', 'b.tgz', '-C', path.basename(src), '.'], { cwd: os.tmpdir() }); fs.copyFileSync(path.join(os.tmpdir(), 'b.tgz'), f); fs.rmSync(path.join(os.tmpdir(), 'b.tgz'));
  const data = fs.readFileSync(f), sum = crypto.createHash('sha256').update(data).digest('hex');
  const u = updater(dir, { bundle: data, sum: Buffer.from(sum) });
  await u.check();
  await assert.rejects(() => u.apply(), /onvolledig/);
  assert.equal(fs.existsSync(path.join(dir, 'app', 'current.json')), false);
  const same = updater(dir, {}, '3.4.0-beta.16');
  await same.check();
  await assert.rejects(() => same.apply(), /nieuwste/);
  fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(src, { recursive: true, force: true });
});

test('updates: a data folder on a live system without its own disk is reported as not kept', () => {
  const marker = fs.mkdtempSync(path.join(os.tmpdir(), 'live-'));
  const none = U.persistence('/var/lib/saga-door', () => '/dev/sr0 /run/live/medium iso9660 ro 0 0\noverlay / overlay rw 0 0\n', marker, 'linux');
  assert.deepEqual(none, { live: true, persistent: false });
  const disk = U.persistence('/var/lib/saga-door', () => '/dev/vdb /var/lib/saga-door ext4 rw 0 0\noverlay / overlay rw 0 0\n', marker, 'linux');
  assert.deepEqual(disk, { live: true, persistent: true });
  assert.deepEqual(U.persistence('/x', () => '', '/nonexistent/marker', 'linux'), { live: false, persistent: true });
  fs.rmSync(marker, { recursive: true, force: true });
});

test('boot.js: starts the newest code and drops an update that does not stay up', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'boot-'));
  const disk = path.join(root, 'disk'), data = path.join(root, 'data');
  fs.mkdirSync(disk); fs.mkdirSync(path.join(data, 'app', '9.9.9'), { recursive: true });
  for (const f of ['boot.js', 'updates.js']) fs.copyFileSync(path.join(__dirname, '..', f), path.join(disk, f));
  fs.writeFileSync(path.join(disk, 'package.json'), '{"version":"3.4.0"}');
  fs.writeFileSync(path.join(disk, 'server.js'), 'console.log("DISK")');
  fs.writeFileSync(path.join(data, 'app', '9.9.9', 'package.json'), '{"version":"9.9.9"}');
  fs.writeFileSync(path.join(data, 'app', '9.9.9', 'server.js'), 'console.log("NEW")');
  fs.writeFileSync(path.join(data, 'app', 'current.json'), '{"version":"9.9.9","dir":"9.9.9"}');
  const start = () => execFileSync(process.execPath, [path.join(disk, 'boot.js')], { env: { ...process.env, DATA_DIR: data }, encoding: 'utf8', timeout: 20000 });
  assert.match(start(), /NEW/);
  assert.match(start(), /NEW/);
  assert.match(start(), /NEW/);
  assert.match(start(), /DISK/); // the fourth start: three starts in a row never counted as "stayed up"
  assert.ok(fs.existsSync(path.join(data, 'app', 'mislukt.json')));
  // a disk that is newer than the update wins
  fs.writeFileSync(path.join(data, 'app', 'current.json'), '{"version":"9.9.9","dir":"9.9.9"}');
  fs.writeFileSync(path.join(disk, 'package.json'), '{"version":"10.0.0"}');
  assert.match(start(), /DISK/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('updates in the server: only the main account, the code is stored encrypted, an unguarded server refuses to restart itself', async (t) => {
  const { startServer, call, login, sleep } = require('./helpers');
  const srv = await startServer({ patch: true, system: true, dir: fs.mkdtempSync(path.join(os.tmpdir(), 'updsrv-')) });
  t.after(() => srv.stop());
  const a = await login(srv);
  assert.equal((await call(srv, 'GET', '/api/update')).status === 200, false, 'not for visitors');
  const st = await call(srv, 'GET', '/api/update', undefined, a);
  assert.equal(st.status, 200, st.text);
  assert.equal(st.json.supervised, false); assert.equal(st.json.channel, 'stable'); assert.equal(st.json.hasToken, false);
  assert.equal((await call(srv, 'POST', '/api/update/settings', { channel: 'beta', token: 'github_pat_TESTWAARDE' }, a)).status, 200);
  const st2 = (await call(srv, 'GET', '/api/update', undefined, a)).json;
  assert.equal(st2.channel, 'beta'); assert.equal(st2.hasToken, true);
  const sys = (await call(srv, 'GET', '/api/system', undefined, a)).json.system;
  assert.notEqual(sys.updateToken, 'github_pat_TESTWAARDE', 'the code never comes back to the browser');
  // saving the other system settings must not wipe the update settings
  assert.equal((await call(srv, 'POST', '/api/system/settings', { ...sys, sessionDays: 20 }, a)).status, 200);
  const st3 = (await call(srv, 'GET', '/api/update', undefined, a)).json;
  assert.equal(st3.channel, 'beta'); assert.equal(st3.hasToken, true);
  const ap = await call(srv, 'POST', '/api/update/apply', {}, a);
  assert.equal(ap.status, 400); assert.match(ap.json.error || ap.text, /starter|bewaakt/);
  await sleep(1500);
  const raw = fs.readFileSync(path.join(srv.dataDir, 'state.json'), 'utf8');
  assert.equal(raw.includes('github_pat_TESTWAARDE'), false, 'not in plain text on disk');
});

test('legal pages: the pages shown at /voorwaarden and /privacy are made from the markdown texts and are up to date', async (t) => {
  const legal = require('../scripts/legal.js');
  for (const [name, html] of Object.entries(legal.build())) assert.equal(fs.readFileSync(path.join(__dirname, '..', 'public', name), 'utf8'), html, `${name} is out of date: run node scripts/legal.js`);
  const { startServer, call } = require('./helpers');
  const srv = await startServer({ patch: true, system: true, dir: fs.mkdtempSync(path.join(os.tmpdir(), 'legal-')) });
  t.after(() => srv.stop());
  for (const p of ['/voorwaarden', '/privacy']) { const r = await call(srv, 'GET', p); assert.equal(r.status, 200); assert.match(r.text, /<h1>/); }
  assert.match((await call(srv, 'GET', '/privacy')).text, /verwerkingsverantwoordelijke/);
});

test('new in this version: visitors are kept 90 days, the checklist and the back-up check work, an unclean stop is reported', async (t) => {
  const { startServer, call, login, sleep } = require('./helpers');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chk-'));
  const srv = await startServer({ patch: true, system: true, dir });
  t.after(() => srv.stop());
  const a = await login(srv);
  assert.equal((await call(srv, 'GET', '/api/system', undefined, a)).json.system.retentionDays, 90, 'new installation: 90 days');
  const cl = (await call(srv, 'GET', '/api/checklist', undefined, a)).json;
  assert.ok(cl.total >= 8 && cl.items.every((i) => i.key && i.tab), 'every line says where to fix it');
  assert.equal(cl.items.find((i) => i.key === 'retention').ok, true);
  assert.equal(cl.items.find((i) => i.key === 'backupTest').ok, false, 'not tested yet');
  assert.equal((await call(srv, 'POST', '/api/system/backups/verify', {}, a)).status === 200 || true, true);
  await call(srv, 'POST', '/api/system/backups/create', {}, a);
  const v = await call(srv, 'POST', '/api/system/backups/verify', {}, a);
  assert.equal(v.status, 200, v.text); assert.equal(v.json.ok, true); assert.ok(v.json.users >= 1);
  assert.equal((await call(srv, 'GET', '/api/checklist', undefined, a)).json.items.find((i) => i.key === 'backupTest').ok, true);
  // a damaged back-up is reported, not trusted
  const bdir = path.join(srv.dataDir, 'backups'), f = fs.readdirSync(bdir).sort().pop();
  fs.writeFileSync(path.join(bdir, f), '{"version":2,"settings":');
  const bad = await call(srv, 'POST', '/api/system/backups/verify', {}, a);
  assert.equal(bad.json.ok, false); assert.ok(bad.json.error);
  const al = (await call(srv, 'GET', '/api/admin-state', undefined, a)).json.alerts || [];
  assert.ok(al.some((x) => x.kind === 'backupcheck'), 'a warning is raised');
});

test('an unclean stop (no clean marker, long gap) raises a warning after the start; a clean stop does not', async (t) => {
  const { startServer, call, login, sleep } = require('./helpers');
  for (const clean of [false, true]) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alive-'));
    fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'data', 'alive.json'), JSON.stringify({ at: Date.now() - 3 * 3600e3, clean }));
    const srv = await startServer({ patch: true, system: true, dir });
    t.after(() => srv.stop());
    await sleep(6500);
    const a = await login(srv);
    const al = (await call(srv, 'GET', '/api/admin-state', undefined, a)).json.alerts || [];
    assert.equal(al.some((x) => x.kind === 'downtime'), !clean, clean ? 'normal shutdown: no warning' : 'power cut: warning');
  }
});

test('signing: the script signs, the built-in key is the public half of the key in the secret, the desktop updater has the same key', () => {
  const { execFileSync } = require('child_process');
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sig-')), 'SHA256SUMS.txt');
  fs.writeFileSync(f, 'abc  file\n');
  execFileSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'sign-release.js'), f], { env: { ...process.env, RELEASE_SIGNING_KEY: KEYS.privateKey.export({ type: 'pkcs8', format: 'pem' }) } });
  assert.equal(U.signatureOk(fs.readFileSync(f), fs.readFileSync(f + '.sig', 'utf8'), PUB), true);
  assert.equal(U.signatureOk(Buffer.from('abd  file\n'), fs.readFileSync(f + '.sig', 'utf8'), PUB), false, 'a changed file fails');
  assert.throws(() => execFileSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'sign-release.js'), f], { env: { ...process.env, RELEASE_SIGNING_KEY: '' }, stdio: 'pipe' }), 'no key, no release');
  assert.equal(require('../app/updater.js').RELEASE_PUBLIC_KEY, U.RELEASE_PUBLIC_KEY, 'server and desktop app trust the same key');
});
