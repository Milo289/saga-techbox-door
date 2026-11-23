'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPT = path.join(__dirname, '..', 'tools', 'proxmox-update.sh');

// the update script with stand-ins for Proxmox' own commands; "wget" is a stand-in that fails, as without internet
function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pmx-')), bin = path.join(dir, 'bin'), log = path.join(dir, 'calls.log');
  fs.mkdirSync(bin); fs.mkdirSync(path.join(dir, 'vz')); fs.mkdirSync(path.join(dir, 'usb'));
  const w = (n, body) => { fs.writeFileSync(path.join(bin, n), `#!/bin/bash\n${body}\n`, { mode: 0o755 }); };
  w('qm', `echo "qm $*" >> "${log}"\ncase "$1" in\n config) echo "name: saga-deur"; echo "ide2: none,media=cdrom"; echo "scsi0: local:vm-100-disk-0,size=4G" ;;\n list) echo "VMID NAME"; echo "100 saga-deur" ;;\n status) echo "status: stopped" ;;\n guest) echo '[{"name":"eth0","ip-addresses":[{"ip-address-type":"ipv4","ip-address":"10.0.0.5"}]}]' ;;\nesac\nexit 0`);
  w('pvesm', `echo "NAME TYPE STATUS"; echo "local dir active"`);
  w('wget', `echo "wget $*" >> "${log}"; case "$*" in *healthz*|*auth-info*) echo '{"ok":true,"version":"3.5.0"}'; exit 0 ;; esac; exit 4`);
  fs.writeFileSync(path.join(dir, 'storage.cfg'), `dir: local\n\tpath ${path.join(dir, 'vz')}\n\tcontent iso\n`);
  const iso = path.join(dir, 'usb', 'Saga-Techbox-Deur-OS-amd64.iso'); fs.writeFileSync(iso, Buffer.alloc(3 * 1048576, 1));
  const run = (args) => spawnSync('bash', [SCRIPT, ...args], { encoding: 'utf8', timeout: 60000, env: { ...process.env, PATH: bin + ':' + process.env.PATH, SAGA_TEST: '1', SAGA_ISO_STORE: 'local', SAGA_STORAGE_CFG: path.join(dir, 'storage.cfg'), SAGA_MIN_ISO_MB: '1' } });
  return { dir, iso, log, run, isoDir: path.join(dir, 'vz', 'template', 'iso') };
}

test('proxmox update without internet: the disk comes from a file on a usb stick', () => {
  const s = setup();
  const r = s.run(['100', '--ja', '--bestand', s.iso]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /geen internet nodig/);
  assert.ok(fs.readdirSync(s.isoDir).some((f) => /^Saga-Techbox-Deur-OS-amd64.*\.iso$/.test(f)), 'the iso was copied to the ISO storage');
  const calls = fs.readFileSync(s.log, 'utf8');
  assert.match(calls, /qm set 100 --ide2 local:iso\/Saga-Techbox-Deur-OS-amd64/);
  assert.doesNotMatch(calls, /api\.github\.com/, 'GitHub is not asked');
});

test('proxmox update: --usb finds the file itself, and a too small file is refused before anything changes', () => {
  const s = setup();
  const small = path.join(s.dir, 'usb', 'Saga-Techbox-Deur-OS-amd64-klein.iso'); fs.writeFileSync(small, Buffer.alloc(10));
  fs.rmSync(s.iso);
  const r = spawnSync('bash', [SCRIPT, '100', '--ja', '--bestand', small], { encoding: 'utf8', env: { ...process.env, PATH: path.join(s.dir, 'bin') + ':' + process.env.PATH, SAGA_TEST: '1', SAGA_ISO_STORE: 'local', SAGA_STORAGE_CFG: path.join(s.dir, 'storage.cfg'), SAGA_MIN_ISO_MB: '1' } });
  assert.notEqual(r.status, 0); assert.match(r.stderr, /maar 0 MB|onvolledige kopie/);
  assert.ok(!fs.existsSync(s.log) || !/qm set/.test(fs.readFileSync(s.log, 'utf8')), 'nothing was changed');
  const gone = s.run(['100', '--ja', '--bestand', path.join(s.dir, 'bestaat-niet.iso')]);
  assert.notEqual(gone.status, 0); assert.match(gone.stderr, /bestaat niet/);
});
