'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startServer, call, login } = require('./helpers');
const nb = require('../netbridge');
const linuxOnly = { skip: process.platform === 'win32' ? 'the wifi bridge only exists on Linux (the stand-in commands are shell scripts)' : false };

// stand-ins for nmcli and nft: they answer like the real ones and write down every call (with what came in on stdin)
function stubs() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nbt-')), bin = path.join(dir, 'bin'), log = path.join(dir, 'calls.log'), state = path.join(dir, 'state');
  fs.mkdirSync(bin); fs.mkdirSync(path.join(dir, 'nm'));
  const w = (n, body) => fs.writeFileSync(path.join(bin, n), `#!/bin/bash\n${body}\n`, { mode: 0o755 });
  w('nmcli', `echo "nmcli $*" >> "${log}"
a="$*"
case "$a" in
  *"device status"*) if [ -f "${state}.shared" ]; then echo "eth0:ethernet:connected:saga-share"; else echo "eth0:ethernet:connected:Wired connection 1"; fi; echo "wlan0:wifi:connected:saga-wifi"; echo "lo:loopback:unmanaged:" ;;
  *"device show"*) echo "GENERAL.CONNECTION:saga-wifi"; echo "IP4.ADDRESS[1]:192.168.1.50/24" ;;
  *"wifi list"*) echo "*:Thuis net:80:WPA2"; echo " :Thuis net:40:WPA2"; echo " :Cafe\\\\:Gratis:55:"; echo " :Eduroam:70:WPA2 802.1X" ;;
  *"wifi rescan"*) ;;
  *"connection up saga-wifi"*) [ -f "${state}.failwifi" ] && { echo "Error: Connection activation failed: Secrets were required" >&2; exit 4; } ;;
  *"connection up saga-share"*) touch "${state}.shared" ;;
  *"connection delete saga-share"*|*"connection down saga-share"*) rm -f "${state}.shared" ;;
esac
exit 0`);
  w('nft', `echo "nft $*" >> "${log}"; if [ "$1" = "-f" ]; then cat >> "${log}"; fi
if [ "$1" = "list" ]; then exit 0; fi
exit 0`);
  const env = { PATH: bin + ':' + process.env.PATH, SAGA_NETBRIDGE_FORCE: '1', SAGA_NM_DIR: path.join(dir, 'nm'), SAGA_LEASES_FILE: path.join(dir, 'leases') };
  return { dir, bin, log, state, env, calls: () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '') };
}
const withEnv = async (env, fn) => { const old = {}; for (const k of Object.keys(env)) { old[k] = process.env[k]; process.env[k] = env[k]; } try { return await fn(); } finally { for (const k of Object.keys(env)) { if (old[k] === undefined) delete process.env[k]; else process.env[k] = old[k]; } } };

test('wifi bridge: nmcli lines with escaped colons are read correctly, and the NetworkManager file keeps the name as bytes', () => {
  assert.deepEqual(nb.fields('*:Cafe\\:Gratis:55:'), ['*', 'Cafe:Gratis', '55', '']);
  const k = nb.keyfile('Thuis', 'geheim\\wachtwoord');
  assert.match(k, /ssid=84;104;117;105;115;/); assert.match(k, /psk=geheim\\\\wachtwoord/); assert.match(k, /key-mgmt=wpa-psk/);
  assert.doesNotMatch(nb.keyfile('Open net', ''), /wifi-security/);
});

test('wifi bridge: status, scan (best signal per name, business networks marked), connect without the password in any command, share on and off', linuxOnly, async () => {
  const s = stubs();
  await withEnv(s.env, async () => {
    const st = await nb.status();
    assert.equal(st.available, true); assert.equal(st.wifi, 'wlan0'); assert.equal(st.ethernet, 'eth0');
    assert.equal(st.current.ssid, 'Thuis net'); assert.equal(st.current.address, '192.168.1.50'); assert.equal(st.sharing, false);
    const nets = await nb.scan();
    assert.equal(nets.length, 3); assert.equal(nets[0].ssid, 'Thuis net'); assert.equal(nets[0].signal, 80);
    assert.equal(nets.find((n) => n.ssid === 'Cafe:Gratis').open, true);
    assert.equal(nets.find((n) => n.ssid === 'Eduroam').enterprise, true);
    await assert.rejects(nb.connect('Thuis net', 'kort'), /8 tot 63/);
    await assert.rejects(nb.connect('', 'langgenoeg-wachtwoord'), /klopt niet/);
    await nb.connect('Thuis net', 'super-geheim-wachtwoord');
    const file = path.join(s.env.SAGA_NM_DIR, 'saga-wifi.nmconnection');
    assert.match(fs.readFileSync(file, 'utf8'), /psk=super-geheim-wachtwoord/);
    assert.equal(fs.statSync(file).mode & 0o777, 0o600, 'only the owner can read the file');
    assert.ok(!s.calls().includes('super-geheim'), 'the password is in no command and no input');
    // a wrong password: the old state comes back and the answer says why
    fs.writeFileSync(s.state + '.failwifi', '');
    await assert.rejects(nb.connect('Thuis net', 'verkeerd-wachtwoord-1'), /wachtwoord klopt waarschijnlijk niet/);
    assert.match(fs.readFileSync(file, 'utf8'), /psk=super-geheim-wachtwoord/, 'the working file is back');
    fs.rmSync(s.state + '.failwifi');
    const on = await nb.share(true);
    assert.equal(on.sharing, true);
    const calls = s.calls();
    assert.match(calls, /connection add type ethernet ifname eth0 con-name saga-share .*ipv4\.method shared ipv4\.addresses 10\.42\.0\.1\/24/);
    assert.match(calls, /add rule inet saga share_fwd iifname "eth0" oifname "wlan0" accept/);
    assert.match(calls, /oifname "wlan0" masquerade/);
    const off = await nb.share(false);
    assert.equal(off.sharing, false);
    assert.match(s.calls(), /connection delete saga-share/);
  });
});

test('wifi bridge: routes need the main account, report, scan, connect and share', linuxOnly, async (t) => {
  const s = stubs();
  const srv = await startServer({ patch: true, system: true, dir: path.join(s.dir, 'srv'), env: s.env });
  t.after(() => srv.stop());
  const a = await login(srv);
  assert.equal((await call(srv, 'GET', '/api/netbridge')).status, 401, 'not without logging in');
  const st = (await call(srv, 'GET', '/api/netbridge', undefined, a)).json;
  assert.equal(st.available, true); assert.equal(st.current.ssid, 'Thuis net');
  assert.equal((await call(srv, 'POST', '/api/netbridge/scan', {}, a)).json.networks.length, 3);
  assert.equal((await call(srv, 'POST', '/api/netbridge/connect', { ssid: 'Thuis net', password: 'kort' }, a)).status, 400);
  assert.equal((await call(srv, 'POST', '/api/netbridge/connect', { ssid: 'Thuis net', password: 'super-geheim-wachtwoord' }, a)).status, 200);
  const on = await call(srv, 'POST', '/api/netbridge/share', { on: true }, a);
  assert.equal(on.status, 200); assert.equal(on.json.sharing, true);
  const saved = (await call(srv, 'GET', '/api/admin-state', undefined, a)).json.settings;
  assert.equal(saved.netbridge.share, true);
  assert.ok(!JSON.stringify(saved).includes('super-geheim'), 'the password is not kept by the server');
  const log = (await call(srv, 'GET', '/api/audit/export', undefined, a)).text || '';
  assert.ok(!log.includes('super-geheim'), 'nor in the log');
  assert.equal((await call(srv, 'POST', '/api/netbridge/share', { on: false }, a)).json.sharing, false);
});

test('wifi bridge: where it cannot work it says why (no wifi card, no nmcli)', linuxOnly, async () => {
  const s = stubs();
  fs.writeFileSync(path.join(s.bin, 'nmcli'), '#!/bin/bash\nif [[ "$*" == *"device status"* ]]; then echo "eth0:ethernet:connected:x"; fi\nexit 0\n', { mode: 0o755 });
  await withEnv(s.env, async () => { const st = await nb.status(); assert.equal(st.available, false); assert.match(st.why, /geen wifi-kaart/); await assert.rejects(nb.scan(), /geen wifi-kaart/); });
  await withEnv({ ...s.env, PATH: '/usr/bin/nonexistent-dir', SAGA_NETBRIDGE_FORCE: '1' }, async () => { const st = await nb.status(); assert.equal(st.available, false); assert.match(st.why, /niet geïnstalleerd/); });
});
