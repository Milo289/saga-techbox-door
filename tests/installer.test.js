'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');

test('Mac/Linux installer picks the right file for every kind of computer', { skip: process.platform === 'win32' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inst-'));
  // a fake `uname` so every kind of computer can be tried on this one
  fs.writeFileSync(path.join(dir, 'uname'), '#!/bin/sh\n[ "$1" = "-s" ] && echo "$FAKE_OS" || echo "$FAKE_ARCH"\n', { mode: 0o755 });
  fs.writeFileSync(path.join(dir, 'dpkg'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  const bash = fs.existsSync('/bin/bash') ? '/bin/bash' : 'bash';
  const run = (os_, arch, withDpkg) => {
    const shim = fs.mkdtempSync(path.join(os.tmpdir(), 'shim-'));
    fs.copyFileSync(path.join(dir, 'uname'), path.join(shim, 'uname')); fs.chmodSync(path.join(shim, 'uname'), 0o755);
    if (withDpkg) { fs.copyFileSync(path.join(dir, 'dpkg'), path.join(shim, 'dpkg')); fs.chmodSync(path.join(shim, 'dpkg'), 0o755); }
    const r = spawnSync(bash, [path.join(ROOT, 'install', 'Installeer.command'), '--dry-run'], { env: { PATH: shim, FAKE_OS: os_, FAKE_ARCH: arch }, encoding: 'utf8' });
    return r.stdout;
  };
  assert.match(run('Darwin', 'arm64'), /Bestand: \*mac-arm64\.pkg/);
  assert.match(run('Darwin', 'x86_64'), /Bestand: \*mac-x64\.pkg/);
  assert.match(run('Linux', 'x86_64', true), /Bestand: \*linux-amd64\.deb/);
  assert.match(run('Linux', 'aarch64', true), /Bestand: \*linux-arm64\.deb/);
  assert.match(run('Linux', 'x86_64', false), /Bestand: \*linux-x86_64\.AppImage/);
  assert.match(run('Linux', 'aarch64', false), /Bestand: \*linux-arm64\.AppImage/);
  assert.match(run('FreeBSD', 'amd64'), /niet ondersteund/);
});

test('Windows installer starts and names the right file', { skip: process.platform !== 'win32' }, () => {
  const r = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(ROOT, 'install', 'Installeer-Windows.ps1'), '-DryRun'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /windows-setup\.exe/);
});

test('every released installer name matches what the scripts and the updater look for', () => {
  const pick = require('../app/updater.js').pickAsset;
  const names = ['mac-arm64.pkg', 'mac-x64.pkg', 'windows-setup.exe', 'linux-amd64.deb', 'linux-arm64.deb', 'linux-x86_64.AppImage', 'linux-arm64.AppImage'].map((n) => ({ name: `Saga-Techbox-Deur-9.9.9-${n}` }));
  assert.ok(pick(names, { platform: 'darwin', arch: 'arm64' }));
  assert.ok(pick(names, { platform: 'win32', arch: 'x64' }));
  assert.ok(pick(names, { platform: 'linux', arch: 'x64', appImage: true }));
});
