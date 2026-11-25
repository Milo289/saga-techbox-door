'use strict';
// The wifi bridge: pick a wifi network, and the network port (Ethernet) of this computer hands that connection to other computers
// plugged into it, like a small router. Linux only (a Raspberry Pi, a mini-pc, the Saga Linux disk), through NetworkManager (nmcli).
//
//   status()                 what is there: wifi card, network port, the connected network, whether it is shared, who is connected
//   scan()                   the wifi networks nearby
//   connect(ssid, password)  join a network (WPA/WPA2 with a password, or an open network)
//   share(on)                the network port starts or stops sharing the wifi connection (own addresses, DHCP, NAT)
//   reapply()                after a restart: put the firewall rules back
//
// The password is written straight into NetworkManager's own protected file (root only); it is never put in a command line,
// never kept by the door server and never logged.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');

const NM_DIR = () => process.env.SAGA_NM_DIR || '/etc/NetworkManager/system-connections';
const LEASES = (dev) => process.env.SAGA_LEASES_FILE || `/var/lib/NetworkManager/dnsmasq-${dev}.leases`;
const WIFI_NAME = 'saga-wifi', SHARE_NAME = 'saga-share', SHARE_IP = '10.42.0.1/24';
const IFACE = /^[A-Za-z0-9_.:-]{1,15}$/;
const bad = (msg) => Object.assign(new Error(msg), { user: true });

// run a command without a shell; resolves { code, out, err }; never rejects (a missing program gives code 127)
function run(cmd, args, { input, timeout = 20000 } = {}) {
  return new Promise((resolve) => {
    const child = execFile(cmd, args, { timeout, encoding: 'utf8', maxBuffer: 4 << 20 }, (error, out, err) => {
      resolve({ code: error ? (typeof error.code === 'number' ? error.code : (error.code === 'ENOENT' ? 127 : 1)) : 0, out: out || '', err: (err || (error && error.code === 'ENOENT' ? 'niet gevonden' : '')) || '' });
    });
    if (input !== undefined) { try { child.stdin.end(input); } catch {} }
  });
}
// one line of `nmcli -t` output, split at the colons that are not escaped with a backslash
const fields = (line) => { const out = []; let cur = ''; for (let i = 0; i < line.length; i++) { const c = line[i]; if (c === '\\' && i + 1 < line.length) { cur += line[++i]; } else if (c === ':') { out.push(cur); cur = ''; } else cur += c; } out.push(cur); return out; };

const isLinux = () => process.platform === 'linux' || process.env.SAGA_NETBRIDGE_FORCE === '1';
const isRoot = () => (typeof process.getuid === 'function' ? process.getuid() === 0 : false) || process.env.SAGA_NETBRIDGE_FORCE === '1';

async function devices() {
  const r = await run('nmcli', ['-t', '-f', 'DEVICE,TYPE,STATE,CONNECTION', 'device', 'status']);
  if (r.code === 127) return { missing: true, list: [] };
  if (r.code !== 0) return { error: (r.err || r.out).trim().slice(0, 200), list: [] };
  return { list: r.out.split('\n').filter(Boolean).map((l) => { const [device, type, state, connection] = fields(l); return { device, type, state, connection }; }) };
}

async function status() {
  const s = { supported: isLinux(), available: false, why: '', root: isRoot(), wifi: '', ethernet: '', current: null, sharing: false, shareAddress: SHARE_IP.split('/')[0], clients: [], firewall: false };
  if (!s.supported) { s.why = 'Dit werkt alleen op een Linux-computer (zoals een Raspberry Pi of de Saga Linux-schijf).'; return s; }
  const d = await devices();
  if (d.missing) { s.why = 'NetworkManager (het programma nmcli) is niet geïnstalleerd op deze computer.'; return s; }
  if (d.error) { s.why = `NetworkManager antwoordt niet: ${d.error}`; return s; }
  const wifi = d.list.find((x) => x.type === 'wifi'), eth = d.list.find((x) => x.type === 'ethernet');
  s.wifi = wifi ? wifi.device : ''; s.ethernet = eth ? eth.device : '';
  if (!wifi) { s.why = 'Er is geen wifi-kaart gevonden. (Sommige kaarten hebben extra programma’s van de fabrikant nodig.)'; return s; }
  if (!eth) { s.why = 'Er is geen netwerkpoort (Ethernet) gevonden om te delen.'; return s; }
  s.available = true;
  if (!s.root) s.why = 'De deurserver draait niet als beheerder (root), dus hij mag het netwerk niet veranderen. Op de Saga Linux-schijf draait hij wel zo.';
  if (wifi.state === 'connected') {
    const info = await run('nmcli', ['-t', '-f', 'GENERAL.CONNECTION,IP4.ADDRESS', 'device', 'show', wifi.device]);
    const kv = {}; for (const l of info.out.split('\n').filter(Boolean)) { const i = l.indexOf(':'); kv[l.slice(0, i).replace(/\[\d+\]$/, '')] = l.slice(i + 1); }
    const sig = await run('nmcli', ['-t', '-f', 'IN-USE,SSID,SIGNAL', 'device', 'wifi', 'list', 'ifname', wifi.device]);
    const row = sig.out.split('\n').filter(Boolean).map(fields).find((f) => f[0] === '*');
    s.current = { ssid: row ? row[1] : (wifi.connection || ''), signal: row ? Number(row[2]) || 0 : 0, address: (kv['IP4.ADDRESS'] || '').split('/')[0] };
  }
  s.sharing = !!(eth.connection === SHARE_NAME && eth.state === 'connected') || eth.connection === SHARE_NAME;
  if (s.sharing) s.clients = leases(eth.device);
  const t = await run('nft', ['list', 'chain', 'inet', 'saga', 'share_fwd']);
  s.firewall = t.code === 0;
  return s;
}

function leases(dev) {
  try {
    return fs.readFileSync(LEASES(dev), 'utf8').split('\n').filter(Boolean).map((l) => { const [exp, mac, ip, name] = l.split(' '); return { ip, mac, name: name && name !== '*' ? name : '', until: Number(exp) * 1000 }; }).filter((c) => c.ip && (!c.until || c.until > Date.now()));
  } catch { return []; }
}

async function scan() {
  const s = await status();
  if (!s.available) throw bad(s.why);
  await run('nmcli', ['device', 'wifi', 'rescan', 'ifname', s.wifi], { timeout: 15000 });
  const r = await run('nmcli', ['-t', '-f', 'IN-USE,SSID,SIGNAL,SECURITY', 'device', 'wifi', 'list', 'ifname', s.wifi, '--rescan', 'no'], { timeout: 15000 });
  if (r.code !== 0) throw bad(`Zoeken lukte niet: ${(r.err || r.out).trim().slice(0, 160)}`);
  const best = new Map();
  for (const l of r.out.split('\n').filter(Boolean)) {
    const [use, ssid, sig, sec] = fields(l); if (!ssid) continue;
    const security = (sec || '').trim(), enterprise = /802\.1X|EAP/i.test(security);
    const net = { ssid, signal: Number(sig) || 0, security: security || 'open', open: !security || security === '--', enterprise, current: use === '*' };
    const had = best.get(ssid); if (!had || net.signal > had.signal) best.set(ssid, { ...net, current: net.current || (had && had.current) });
  }
  return [...best.values()].sort((a, b) => b.signal - a.signal);
}

const gkey = (t) => String(t).replace(/\\/g, '\\\\'); // a text in a NetworkManager file: the backslash is special
function keyfile(ssid, password) {
  const bytes = [...Buffer.from(ssid, 'utf8')].join(';') + ';';
  const lines = ['[connection]', `id=${WIFI_NAME}`, `uuid=${crypto.randomUUID()}`, 'type=wifi', 'autoconnect=true', 'autoconnect-priority=10', '', '[wifi]', 'mode=infrastructure', `ssid=${bytes}`];
  if (password) lines.push('', '[wifi-security]', 'key-mgmt=wpa-psk', `psk=${gkey(password)}`);
  lines.push('', '[ipv4]', 'method=auto', '', '[ipv6]', 'method=auto', '');
  return lines.join('\n');
}

async function connect(ssid, password) {
  ssid = String(ssid == null ? '' : ssid); password = String(password == null ? '' : password);
  if (!ssid || Buffer.byteLength(ssid, 'utf8') > 32 || /[\u0000-\u001f]/.test(ssid)) throw bad('De naam van het wifi-netwerk klopt niet (1 tot 32 tekens).');
  if (password) {
    if (/[\u0000-\u001f\u007f]/.test(password) || password !== password.trim()) throw bad('Het wachtwoord mag niet beginnen of eindigen met een spatie en geen speciale tekens bevatten.');
    if (password.length < 8 || password.length > 63) throw bad('Een wifi-wachtwoord heeft 8 tot 63 tekens.');
  }
  const s = await status();
  if (!s.available) throw bad(s.why);
  if (!s.root) throw bad(s.why);
  const file = path.join(NM_DIR(), `${WIFI_NAME}.nmconnection`);
  fs.mkdirSync(NM_DIR(), { recursive: true, mode: 0o755 });
  let old = null; try { old = fs.readFileSync(file, 'utf8'); } catch {}
  fs.writeFileSync(file, keyfile(ssid, password), { mode: 0o600 });
  try { fs.chmodSync(file, 0o600); } catch {}
  await run('nmcli', ['connection', 'reload']);
  const up = await run('nmcli', ['--wait', '40', 'connection', 'up', WIFI_NAME, 'ifname', s.wifi], { timeout: 60000 });
  if (up.code !== 0) {
    if (old !== null) fs.writeFileSync(file, old, { mode: 0o600 }); else { try { fs.unlinkSync(file); } catch {} }
    await run('nmcli', ['connection', 'reload']);
    const why = (up.err || up.out).trim();
    throw bad(/secrets|password|psk|802-11/i.test(why) ? 'Verbinden mislukt: het wachtwoord klopt waarschijnlijk niet.' : `Verbinden mislukt${why ? `: ${why.slice(0, 160)}` : '.'}`);
  }
  return status();
}

// the firewall of the Saga Linux disk drops everything that is forwarded; it has two empty chains that we fill while sharing
async function firewall(on, wifi, eth) {
  if (!IFACE.test(wifi) || !IFACE.test(eth)) throw bad('Vreemde naam van een netwerkkaart.');
  const have = await run('nft', ['list', 'chain', 'inet', 'saga', 'share_fwd']);
  if (have.code === 127) return false; // no nftables on this computer (Raspberry Pi OS has no firewall by default)
  const script = [];
  if (have.code === 0) {
    script.push('flush chain inet saga share_in', 'flush chain inet saga share_fwd');
    if (on) script.push(
      `add rule inet saga share_in iifname "${eth}" udp dport { 53, 67 } accept`,
      `add rule inet saga share_in iifname "${eth}" tcp dport 53 accept`,
      `add rule inet saga share_fwd iifname "${eth}" oifname "${wifi}" accept`,
      `add rule inet saga share_fwd iifname "${wifi}" oifname "${eth}" ct state established,related accept`);
  }
  script.push('add table ip saga_nat', 'delete table ip saga_nat');
  if (on) script.push(`table ip saga_nat { chain post { type nat hook postrouting priority 100; policy accept; oifname "${wifi}" masquerade; } }`);
  const r = await run('nft', ['-f', '-'], { input: script.join('\n') + '\n' });
  if (r.code !== 0) throw bad(`De firewall kon niet worden aangepast: ${(r.err || r.out).trim().slice(0, 160)}`);
  return have.code === 0;
}

async function share(on) {
  const s = await status();
  if (!s.available) throw bad(s.why);
  if (!s.root) throw bad(s.why);
  if (on) {
    if (!s.current) throw bad('Maak eerst verbinding met een wifi-netwerk: zonder internet via wifi valt er niets te delen.');
    await run('nmcli', ['connection', 'delete', SHARE_NAME]);
    const add = await run('nmcli', ['connection', 'add', 'type', 'ethernet', 'ifname', s.ethernet, 'con-name', SHARE_NAME, 'connection.autoconnect', 'yes', 'ipv4.method', 'shared', 'ipv4.addresses', SHARE_IP, 'ipv6.method', 'ignore']);
    if (add.code !== 0) throw bad(`Delen lukte niet: ${(add.err || add.out).trim().slice(0, 160)}`);
    const up = await run('nmcli', ['--wait', '30', 'connection', 'up', SHARE_NAME, 'ifname', s.ethernet], { timeout: 45000 });
    if (up.code !== 0) { await run('nmcli', ['connection', 'delete', SHARE_NAME]); throw bad(`Delen lukte niet: ${(up.err || up.out).trim().slice(0, 160)}`); }
    await firewall(true, s.wifi, s.ethernet);
  } else {
    await run('nmcli', ['connection', 'down', SHARE_NAME]);
    await run('nmcli', ['connection', 'delete', SHARE_NAME]);
    await firewall(false, s.wifi, s.ethernet);
  }
  return status();
}

// after a restart of the computer: NetworkManager brings the connection back by itself, the firewall rules are ours to put back
async function reapply() {
  try {
    const s = await status();
    if (s.available && s.root && s.sharing) await firewall(true, s.wifi, s.ethernet);
    return s.sharing;
  } catch { return false; }
}

module.exports = { status, scan, connect, share, reapply, fields, keyfile, _run: run };
