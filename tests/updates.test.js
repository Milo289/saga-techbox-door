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
    { tag_name: 'v3.4.0-beta.16', prerelease: true, assets: [{ name: U.BUNDLE, url: 'a' }, { name: U.BUNDLE + '.sha256', url: 'b' }] },
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

function updater(dataDir, files, current = '3.4.0-beta.15') {
  const rel = [{ tag_name: 'v3.4.0-beta.16', prerelease: true, assets: [{ name: U.BUNDLE, url: 'bundle' }, { name: U.BUNDLE + '.sha256', url: 'sum' }] }];
  return U.create({ dataDir, appDir: dataDir, currentVersion: current, getToken: () => '', getChannel: () => 'beta', fetchJson: async () => rel, fetchFile: async (u) => files[u] });
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
