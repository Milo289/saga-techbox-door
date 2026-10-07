'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const BIN = Buffer.alloc(200000, 7);
let wantToken = null, version = '9.9.9', declaredSize = BIN.length;
const server = http.createServer((req, res) => {
  if (wantToken && req.headers.authorization !== `Bearer ${wantToken}`) { res.writeHead(404); return res.end('{}'); }
  const base = `http://127.0.0.1:${server.address().port}`;
  if (req.url === '/release') {
    res.writeHead(200, { 'content-type': 'application/json' });
    const files = ['mac-arm64.pkg', 'mac-x64.pkg', 'windows-setup.exe', 'linux-x86_64.AppImage', 'linux-amd64.deb', 'linux-arm64.deb'];
    return res.end(JSON.stringify({ tag_name: `v${version}`, body: 'Nieuw', html_url: `${base}/page`, assets: files.map((f) => ({ name: `Saga-Techbox-Deur-${version}-${f}`, size: declaredSize, url: `${base}/dl`, browser_download_url: `${base}/dl` })) }));
  }
  if (req.url === '/dl') { res.writeHead(200, { 'content-length': BIN.length }); return res.end(BIN); }
  res.writeHead(404); res.end();
});

let updater;
test.before(async () => {
  await new Promise((r) => server.listen(0, r));
  process.env.DOOR_UPDATE_API = `http://127.0.0.1:${server.address().port}/release`;
  updater = require('../app/updater.js');
});
test.after(() => server.close());

test('version comparison', () => {
  assert.ok(updater.isNewer('1.10.0', '1.9.9'));
  assert.ok(!updater.isNewer('1.5.0', '1.5.0'));
  assert.ok(!updater.isNewer('1.4.0', 'v1.5.0'));
});

test('picks the right installer for each system', async () => {
  const want = [
    [{ platform: 'darwin', arch: 'arm64' }, /mac-arm64\.pkg$/], [{ platform: 'darwin', arch: 'x64' }, /mac-x64\.pkg$/],
    [{ platform: 'win32', arch: 'x64' }, /windows-setup\.exe$/], [{ platform: 'linux', arch: 'x64', appImage: true }, /x86_64\.AppImage$/],
    [{ platform: 'linux', arch: 'x64' }, /amd64\.deb$/], [{ platform: 'linux', arch: 'arm64' }, /linux-arm64\.deb$/],
  ];
  for (const [env, re] of want) { const r = await updater.check('1.0.0', '', env); assert.match(r.asset.name, re); }
});

test('downloads completely, refuses incomplete files and path tricks', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'upd-'));
  const r = await updater.check('1.0.0', '', { platform: 'darwin', arch: 'arm64' });
  const pcts = [];
  const file = await updater.download(r.asset, '', dir, (p) => pcts.push(p));
  assert.equal(fs.statSync(file).size, BIN.length);
  assert.equal(pcts.at(-1), 100);
  assert.ok(!fs.existsSync(`${file}.part`));
  await assert.rejects(updater.download({ ...r.asset, size: BIN.length + 5 }, '', dir), /niet compleet/);
  await assert.rejects(updater.download({ name: '../evil', size: 1, url: 'x' }, '', dir));
});

test('up to date, private repositories and wrong tokens are explained', async () => {
  version = '1.0.0';
  assert.ok((await updater.check('1.0.0', '', { platform: 'darwin', arch: 'arm64' })).upToDate);
  version = '9.9.9'; wantToken = 'sekret';
  await assert.rejects(updater.check('1.0.0', '', { platform: 'darwin', arch: 'arm64' }), /toegangssleutel/);
  assert.ok(!(await updater.check('1.0.0', 'sekret', { platform: 'darwin', arch: 'arm64' })).upToDate);
  await assert.rejects(updater.check('1.0.0', 'wrong', { platform: 'darwin', arch: 'arm64' }), /weigert/);
  wantToken = null;
});

test('only GitHub may hand out downloads (official address)', () => {
  const { spawnSync } = require('node:child_process');
  const out = spawnSync(process.execPath, ['-e', `
    process.env.DOOR_UPDATE_API='';
    const u=require('./app/updater.js');
    console.log(JSON.stringify([u.trusted('https://api.github.com/x'), u.trusted('https://objects.githubusercontent.com/a'), u.trusted('https://evil.example.com/a'), u.trusted('http://github.com/a')]));`], { cwd: path.join(__dirname, '..'), encoding: 'utf8' });
  assert.equal(out.stdout.trim(), '[true,true,false,false]');
});
