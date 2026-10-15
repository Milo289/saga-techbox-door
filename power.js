'use strict';
// Energy management: switch the screen or the whole computer off on a schedule, and wake it up again.
// Everything here is opt-in (off until switched on in the control panel) and can be tried safely: with DOOR_POWER_DRYRUN=1 nothing is
// executed, the commands are only recorded. DOOR_POWER=off turns the whole feature off (for example in Docker).
const fs = require('fs');
const os = require('os');
const path = require('path');
const dgram = require('dgram');
const { spawn, spawnSync } = require('child_process');

const HM = /^([01]\d|2[0-3]):[0-5]\d$/;
const DAY_KEYS = ['0', '1', '2', '3', '4', '5', '6']; // 0 = Sunday, like JavaScript's Date.getDay()
const DAY_NAMES = ['zondag', 'maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag'];
const WIN_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MAC_DAYS = ['U', 'M', 'T', 'W', 'R', 'F', 'S']; // pmset: M T W R F S U (R = Thursday, U = Sunday)

const available = () => process.env.DOOR_POWER !== 'off';
const dryRun = () => !!process.env.DOOR_POWER_DRYRUN;
const platform = () => process.env.DOOR_POWER_PLATFORM || process.platform; // overridable so every system can be tested everywhere
const isPi = () => { try { return /raspberry/i.test(fs.readFileSync('/proc/device-tree/model', 'utf8')); } catch { return false; } };

// ---------- settings ----------
function defaults() {
  const days = {};
  for (const k of DAY_KEYS) days[k] = { screenOff: '', screenOn: '', off: '', on: '' };
  return { enabled: false, how: 'computer', warnMinutes: 2, skipIfBusy: true, pauseUntil: '', watts: 50, days, wol: [] };
}
const hm = (v) => (HM.test(String(v || '')) ? String(v) : '');
function clean(raw) {
  const d = defaults();
  if (!raw || typeof raw !== 'object') return d;
  d.enabled = !!raw.enabled;
  d.how = ['computer', 'hibernate'].includes(raw.how) ? raw.how : 'computer';
  d.warnMinutes = Math.max(0, Math.min(30, Math.round(Number(raw.warnMinutes)) || 0)) || (Number(raw.warnMinutes) === 0 ? 0 : 2);
  d.skipIfBusy = raw.skipIfBusy !== false;
  d.pauseUntil = /^\d{4}-\d{2}-\d{2}$/.test(String(raw.pauseUntil || '')) ? raw.pauseUntil : '';
  d.watts = Math.max(1, Math.min(2000, Math.round(Number(raw.watts)) || 50));
  for (const k of DAY_KEYS) {
    const x = (raw.days && raw.days[k]) || {};
    d.days[k] = { screenOff: hm(x.screenOff), screenOn: hm(x.screenOn), off: hm(x.off), on: hm(x.on) };
  }
  d.wol = (Array.isArray(raw.wol) ? raw.wol : []).slice(0, 10)
    .map((t) => ({ name: String((t && t.name) || '').slice(0, 40), mac: /^([0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/i.test(String((t && t.mac) || '')) ? String(t.mac).toLowerCase().replace(/-/g, ':') : '' }))
    .filter((t) => t.mac);
  return d;
}

// ---------- the schedule ----------
const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
// which events are due right now (within 2 minutes of their time, once per day). `fired` remembers what already happened today.
function dueEvents(power, now, fired = {}) {
  if (!power.enabled) return [];
  const d = new Date(now), key = dayKey(d);
  if (power.pauseUntil && key <= power.pauseUntil) return [];
  const cfg = power.days[String(d.getDay())];
  const out = [];
  for (const kind of ['screenOff', 'screenOn', 'off']) {
    if (!cfg[kind]) continue;
    const [h, m] = cfg[kind].split(':').map(Number);
    const at = new Date(d); at.setHours(h, m, 0, 0);
    if (now >= at.getTime() && now - at.getTime() < 120000 && fired[kind] !== key) out.push(kind);
  }
  return out;
}
// roughly how many hours a week the computer is off (from "off" until the next "on"), for the savings estimate
function offHoursPerWeek(power) {
  let total = 0;
  for (let i = 0; i < 7; i++) {
    const off = power.days[String(i)].off;
    if (!off) continue;
    const [oh, om] = off.split(':').map(Number);
    for (let step = 1; step <= 7; step++) {
      const on = power.days[String((i + step) % 7)].on;
      if (!on) continue;
      const [nh, nm] = on.split(':').map(Number);
      total += (step * 24 * 60 + nh * 60 + nm - (oh * 60 + om)) / 60;
      break;
    }
  }
  return Math.round(total * 10) / 10;
}
const kwhPerWeek = (power) => Math.round(offHoursPerWeek(power) * power.watts / 10) / 100;

// ---------- commands per system ----------
const PS_MONITOR = (arg) => `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class Mon { [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h, int m, IntPtr w, IntPtr l); [DllImport("user32.dll")] public static extern void mouse_event(int f, int x, int y, int d, int e); }'; [void][Mon]::SendMessage([IntPtr]0xffff, 0x0112, [IntPtr]0xF170, [IntPtr]${arg}); ${arg === -1 ? '[Mon]::mouse_event(1, 1, 0, 0, 0); [Mon]::mouse_event(1, -1, 0, 0, 0)' : ''}`;
function commandFor(action, plat = platform()) {
  const win = plat === 'win32', mac = plat === 'darwin';
  switch (action) {
    case 'computer': return win ? { cmd: 'shutdown', args: ['/s', '/t', '0'] } : mac ? { cmd: 'osascript', args: ['-e', 'tell application "System Events" to shut down'] } : { cmd: 'systemctl', args: ['poweroff'] };
    case 'hibernate': return win ? { cmd: 'shutdown', args: ['/h'] } : mac ? { cmd: 'pmset', args: ['sleepnow'] } : { cmd: 'systemctl', args: ['suspend'] };
    case 'restart': return win ? { cmd: 'shutdown', args: ['/r', '/t', '0'] } : mac ? { cmd: 'osascript', args: ['-e', 'tell application "System Events" to restart'] } : { cmd: 'systemctl', args: ['reboot'] };
    case 'screenOff': return win ? { cmd: 'powershell', args: ['-NoProfile', '-Command', PS_MONITOR(2)] } : mac ? { cmd: 'pmset', args: ['displaysleepnow'] } : { cmd: 'sh', args: ['-c', 'xset dpms force off 2>/dev/null || vcgencmd display_power 0 2>/dev/null || true'] };
    case 'screenOn': return win ? { cmd: 'powershell', args: ['-NoProfile', '-Command', PS_MONITOR(-1)] } : mac ? { cmd: 'caffeinate', args: ['-u', '-t', '2'] } : { cmd: 'sh', args: ['-c', 'xset dpms force on 2>/dev/null || vcgencmd display_power 1 2>/dev/null || true'] };
    default: throw new Error('Onbekende actie');
  }
}
const log = [];
function record(entry) { log.unshift({ at: Date.now(), ...entry }); log.length = Math.min(log.length, 30); }
// runs an action; in dry-run mode only records it
function run(action) {
  if (!available()) throw new Error('Energiebeheer staat uit op deze server (DOOR_POWER=off)');
  const c = commandFor(action);
  record({ action, platform: platform(), command: [c.cmd, ...c.args].join(' ').slice(0, 200), dry: dryRun() });
  if (dryRun()) return { ok: true, dry: true };
  const child = spawn(c.cmd, c.args, { detached: true, stdio: 'ignore', windowsHide: true });
  child.on('error', (e) => record({ action, error: e.message }));
  child.unref();
  return { ok: true };
}

// ---------- waking up again ----------
// Windows: a scheduled task that wakes the computer from sleep/hibernate (WakeToRun) and starts the app.
function winWakeScript(power, exe) {
  const triggers = [];
  for (const k of DAY_KEYS) { const t = power.days[k].on; if (t) triggers.push(`(New-ScheduledTaskTrigger -Weekly -DaysOfWeek ${WIN_DAYS[Number(k)]} -At '${t}')`); }
  if (!triggers.length) throw new Error('Vul bij minstens één dag een aanzet-tijd in');
  const action = exe ? `New-ScheduledTaskAction -Execute '${String(exe).replace(/'/g, "''")}'` : "New-ScheduledTaskAction -Execute 'cmd.exe' -Argument '/c exit'";
  return [
    "$ErrorActionPreference = 'Stop'",
    "$name = 'SagaTechboxDeur-Wake'",
    'Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction SilentlyContinue',
    `$triggers = @(${triggers.join(', ')})`,
    `$action = ${action}`,
    '$settings = New-ScheduledTaskSettingsSet -WakeToRun -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries',
    'Register-ScheduledTask -TaskName $name -Trigger $triggers -Action $action -Settings $settings -RunLevel Highest -Force | Out-Null',
  ].join('\n');
}
const winRemoveScript = () => "Unregister-ScheduledTask -TaskName 'SagaTechboxDeur-Wake' -Confirm:$false -ErrorAction SilentlyContinue";

// macOS: pmset can keep ONE repeating wake time for a set of days; different times per day become one-off events for the next two weeks
function macWakeCommands(power, now = Date.now()) {
  const withOn = DAY_KEYS.filter((k) => power.days[k].on);
  if (!withOn.length) throw new Error('Vul bij minstens één dag een aanzet-tijd in');
  const times = new Set(withOn.map((k) => power.days[k].on));
  if (times.size === 1) return [`pmset repeat wakeorpoweron ${withOn.map((k) => MAC_DAYS[Number(k)]).join('')} ${[...times][0]}:00`];
  const cmds = ['pmset repeat cancel'];
  for (let i = 0; i < 14; i++) {
    const d = new Date(now + i * 864e5), t = power.days[String(d.getDay())].on;
    if (!t) continue;
    const [h, m] = t.split(':').map(Number);
    const at = new Date(d); at.setHours(h, m, 0, 0);
    if (at.getTime() <= now) continue;
    cmds.push(`pmset schedule wakeorpoweron "${String(at.getMonth() + 1).padStart(2, '0')}/${String(at.getDate()).padStart(2, '0')}/${String(at.getFullYear()).slice(2)} ${t}:00"`);
  }
  return cmds;
}
// Linux: rtcwake sets the alarm just before the computer goes off (a Raspberry Pi has no clock to do this)
function linuxWakeText(power) {
  const lines = DAY_KEYS.filter((k) => power.days[k].on).map((k) => `${DAY_NAMES[Number(k)]} ${power.days[k].on}`);
  return `sudo rtcwake -m off -l -t "$(date -d 'tomorrow ${(power.days['1'].on || '07:30')}' +%s)"   # per dag: ${lines.join(', ')}`;
}

function elevate(plat, script, exeHint) {
  // asks the system for the administrator's permission (a normal password or UAC window on the screen)
  if (plat === 'darwin') {
    const r = spawnSync('osascript', ['-e', `do shell script ${JSON.stringify(script)} with administrator privileges`], { encoding: 'utf8', timeout: 120000 });
    return { ok: r.status === 0, message: r.status === 0 ? '' : (r.stderr || 'Geannuleerd').trim().slice(0, 200) };
  }
  if (plat === 'win32') {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'saga-wake-'));
    const file = path.join(dir, 'wake.ps1'), result = path.join(dir, 'result.txt');
    fs.writeFileSync(file, `try {\n${script}\n'ok' | Out-File -Encoding ascii '${result}'\n} catch { $_.Exception.Message | Out-File -Encoding ascii '${result}' }\n`, 'utf8');
    spawnSync('powershell', ['-NoProfile', '-Command', `Start-Process powershell -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','${file}'`], { timeout: 180000 });
    let text = '';
    try { text = fs.readFileSync(result, 'utf8').trim(); } catch {}
    return { ok: text === 'ok', message: text === 'ok' ? '' : (text || 'Geannuleerd of geen toestemming gegeven') };
  }
  return { ok: false, message: 'Dit systeem kan dat niet zelf doen' };
}

function applyWake(power, exe, now = Date.now()) {
  const plat = platform();
  if (!available()) throw new Error('Energiebeheer staat uit op deze server');
  if (plat === 'win32') {
    const script = winWakeScript(power, exe);
    record({ action: 'wake-apply', platform: plat, command: 'Register-ScheduledTask SagaTechboxDeur-Wake', dry: dryRun() });
    return dryRun() ? { ok: true, dry: true, script } : elevate(plat, script);
  }
  if (plat === 'darwin') {
    const cmds = macWakeCommands(power, now);
    record({ action: 'wake-apply', platform: plat, command: cmds[0].slice(0, 120), dry: dryRun() });
    return dryRun() ? { ok: true, dry: true, commands: cmds } : elevate(plat, cmds.join(' && '));
  }
  return { ok: false, manual: linuxWakeText(power), message: isPi() ? 'Een Raspberry Pi heeft geen klok om zichzelf aan te zetten. Gebruik een stekkerdoos met timer, of een RTC-module.' : 'Voer dit commando zelf uit (het heeft beheerdersrechten nodig):' };
}
function removeWake() {
  const plat = platform();
  record({ action: 'wake-remove', platform: plat, dry: dryRun() });
  if (dryRun()) return { ok: true, dry: true };
  if (plat === 'win32') return elevate(plat, winRemoveScript());
  if (plat === 'darwin') return elevate(plat, 'pmset repeat cancel');
  return { ok: false, message: 'Op Linux haal je het zelf weg met: sudo rtcwake -m disable' };
}
function wakeStatus() {
  const plat = platform();
  try {
    if (plat === 'darwin') { const r = spawnSync('pmset', ['-g', 'sched'], { encoding: 'utf8', timeout: 8000 }); const t = r.stdout || ''; return { installed: /wakepoweron|wake at|poweron/i.test(t), detail: t.trim().split('\n').slice(0, 6).join('\n') }; }
    if (plat === 'win32') { const r = spawnSync('powershell', ['-NoProfile', '-Command', "(Get-ScheduledTask -TaskName 'SagaTechboxDeur-Wake' -ErrorAction SilentlyContinue | Select-Object -First 1).State"], { encoding: 'utf8', timeout: 15000 }); const t = (r.stdout || '').trim(); return { installed: !!t, detail: t }; }
  } catch { /* fall through */ }
  return { installed: false, detail: '' };
}

// ---------- Wake-on-LAN: wake another computer on this network ----------
function magicPacket(mac) {
  const m = Buffer.from(String(mac).replace(/[:-]/g, ''), 'hex');
  if (m.length !== 6) throw new Error('Dat MAC-adres klopt niet');
  return Buffer.concat([Buffer.alloc(6, 0xff), ...Array.from({ length: 16 }, () => m)]);
}
function sendWol(mac, { address = '255.255.255.255', port = 9 } = {}) {
  const packet = magicPacket(mac);
  record({ action: 'wol', command: mac, dry: dryRun() });
  if (dryRun() && !process.env.DOOR_WOL_REAL) return Promise.resolve({ ok: true, dry: true, bytes: packet.length });
  return new Promise((resolve, reject) => {
    const s = dgram.createSocket('udp4');
    s.once('error', (e) => { try { s.close(); } catch {} reject(e); });
    s.bind(() => { s.setBroadcast(true); s.send(packet, port, address, (e) => { s.close(); if (e) reject(e); else resolve({ ok: true, bytes: packet.length }); }); });
  });
}

module.exports = { available, dryRun, defaults, clean, dueEvents, offHoursPerWeek, kwhPerWeek, commandFor, run, log, winWakeScript, macWakeCommands, linuxWakeText, applyWake, removeWake, wakeStatus, magicPacket, sendWol, isPi, DAY_NAMES, dayKey };
