'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const power = require('../power.js');

const sample = (over = {}) => {
  const p = power.clean({ enabled: true, how: 'computer', days: {} });
  for (const k of ['1', '2', '3', '4', '5']) p.days[k] = { screenOff: '17:00', screenOn: '07:15', off: '17:30', on: '07:30' };
  return Object.assign(p, over);
};

test('settings are cleaned', () => {
  const c = power.clean({ enabled: 1, how: 'nonsense', warnMinutes: 999, watts: 'x', pauseUntil: 'soon', days: { 1: { off: '25:99', on: '07:30', screenOff: 'abc', screenOn: '' } }, wol: [{ name: 'Pi', mac: 'AA-BB-CC-DD-EE-FF' }, { name: 'bad', mac: 'nope' }] });
  assert.equal(c.enabled, true); assert.equal(c.how, 'computer');
  assert.equal(c.warnMinutes, 30); assert.equal(c.watts, 50); assert.equal(c.pauseUntil, '');
  assert.deepEqual(c.days['1'], { screenOff: '', screenOn: '', off: '', on: '07:30' });
  assert.deepEqual(c.wol, [{ name: 'Pi', mac: 'aa:bb:cc:dd:ee:ff' }]);
  assert.equal(power.clean({ warnMinutes: 0 }).warnMinutes, 0);
  assert.equal(power.clean(null).enabled, false);
});

test('schedule: events fire once, in a two-minute window, on the right days, and not while paused', () => {
  const p = sample();
  const mon = (h, m, s = 0) => new Date(2026, 9, 12, h, m, s).getTime(); // Monday 12 October 2026
  assert.deepEqual(power.dueEvents(p, mon(17, 0, 30)), ['screenOff']);
  assert.deepEqual(power.dueEvents(p, mon(17, 30, 1)), ['off']);
  assert.deepEqual(power.dueEvents(p, mon(17, 33)), [], 'too late: not fired after a restart');
  assert.deepEqual(power.dueEvents(p, mon(17, 29)), [], 'too early');
  assert.deepEqual(power.dueEvents(p, mon(17, 30, 5), { off: '2026-10-12' }), [], 'already done today');
  assert.deepEqual(power.dueEvents(p, new Date(2026, 9, 17, 17, 30, 5).getTime()), [], 'Saturday has no schedule');
  assert.deepEqual(power.dueEvents({ ...p, pauseUntil: '2026-10-12' }, mon(17, 30, 5)), [], 'paused until and including that day');
  assert.deepEqual(power.dueEvents({ ...p, pauseUntil: '2026-10-11' }, mon(17, 30, 5)), ['off']);
  assert.deepEqual(power.dueEvents({ ...p, enabled: false }, mon(17, 30, 5)), []);
});

test('energy estimate', () => {
  const p = sample({ watts: 100 });
  // Mon-Thu: 17:30 -> 07:30 next day = 14 h; Friday 17:30 -> Monday 07:30 = 62 h
  assert.equal(power.offHoursPerWeek(p), 14 * 4 + 62);
  assert.equal(power.kwhPerWeek(p), 11.8);
  assert.equal(power.offHoursPerWeek(power.clean({})), 0);
});

test('commands for every system', () => {
  assert.deepEqual(power.commandFor('computer', 'win32'), { cmd: 'shutdown', args: ['/s', '/t', '0'] });
  assert.deepEqual(power.commandFor('hibernate', 'win32'), { cmd: 'shutdown', args: ['/h'] });
  assert.deepEqual(power.commandFor('restart', 'win32'), { cmd: 'shutdown', args: ['/r', '/t', '0'] });
  assert.equal(power.commandFor('screenOff', 'win32').cmd, 'powershell');
  assert.match(power.commandFor('screenOff', 'win32').args[2], /0xF170, \[IntPtr\]2/);
  assert.match(power.commandFor('screenOn', 'win32').args[2], /0xF170, \[IntPtr\]-1/);
  assert.match(power.commandFor('computer', 'darwin').args[1], /shut down/);
  assert.deepEqual(power.commandFor('screenOff', 'darwin'), { cmd: 'pmset', args: ['displaysleepnow'] });
  assert.deepEqual(power.commandFor('hibernate', 'darwin'), { cmd: 'pmset', args: ['sleepnow'] });
  assert.deepEqual(power.commandFor('computer', 'linux'), { cmd: 'systemctl', args: ['poweroff'] });
  assert.match(power.commandFor('screenOff', 'linux').args[1], /vcgencmd display_power 0/);
  assert.throws(() => power.commandFor('explode', 'linux'));
});

test('dry run records instead of executing', () => {
  process.env.DOOR_POWER_DRYRUN = '1';
  try {
    const r = power.run('computer');
    assert.equal(r.dry, true);
    assert.equal(power.log[0].action, 'computer'); assert.equal(power.log[0].dry, true);
  } finally { delete process.env.DOOR_POWER_DRYRUN; }
});

test('wake: macOS uses one repeating time when all days agree, otherwise the next two weeks', () => {
  const p = sample();
  assert.deepEqual(power.macWakeCommands(p), ['pmset repeat wakeorpoweron MTWRF 07:30:00']);
  const q = sample(); q.days['3'].on = '08:15';
  const cmds = power.macWakeCommands(q, new Date(2026, 9, 12, 12, 0).getTime());
  assert.equal(cmds[0], 'pmset repeat cancel');
  assert.ok(cmds.length > 5 && cmds.every((c, i) => i === 0 || /^pmset schedule wakeorpoweron "\d\d\/\d\d\/26 \d\d:\d\d:00"$/.test(c)));
  assert.ok(cmds.some((c) => c.includes('10/14/26 08:15:00')), 'Wednesday has its own time');
  assert.throws(() => power.macWakeCommands(power.clean({})), /aanzet-tijd/);
});

test('wake: Windows task script', () => {
  const script = power.winWakeScript(sample(), 'C:\\Program Files\\Saga Techbox Deur\\Saga Techbox Deur.exe');
  assert.match(script, /New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday -At '07:30'/);
  assert.match(script, /-DaysOfWeek Friday/);
  assert.doesNotMatch(script, /Saturday|Sunday/);
  assert.match(script, /-WakeToRun/);
  assert.match(script, /Saga Techbox Deur\.exe/);
  assert.match(power.linuxWakeText(sample()), /rtcwake -m off/);
});

test('wake: dry-run apply and the Raspberry Pi message', () => {
  process.env.DOOR_POWER_DRYRUN = '1';
  try {
    process.env.DOOR_POWER_PLATFORM = 'win32';
    assert.match(power.applyWake(sample(), 'C:\\x.exe').script, /Register-ScheduledTask/);
    process.env.DOOR_POWER_PLATFORM = 'darwin';
    assert.deepEqual(power.applyWake(sample(), '').commands, ['pmset repeat wakeorpoweron MTWRF 07:30:00']);
    process.env.DOOR_POWER_PLATFORM = 'linux';
    const l = power.applyWake(sample(), '');
    assert.equal(l.ok, false); assert.match(l.manual, /rtcwake/);
  } finally { delete process.env.DOOR_POWER_DRYRUN; delete process.env.DOOR_POWER_PLATFORM; }
});

test('Wake-on-LAN magic packet', async () => {
  const pk = power.magicPacket('aa:bb:cc:dd:ee:ff');
  assert.equal(pk.length, 102);
  assert.deepEqual([...pk.subarray(0, 6)], [255, 255, 255, 255, 255, 255]);
  assert.deepEqual([...pk.subarray(6, 12)], [0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff]);
  assert.deepEqual([...pk.subarray(96, 102)], [0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff]);
  assert.throws(() => power.magicPacket('nope'));
  // really send one to ourselves
  const dgram = require('node:dgram');
  const rx = dgram.createSocket('udp4');
  const got = new Promise((res) => rx.once('message', res));
  await new Promise((r) => rx.bind(0, '127.0.0.1', r));
  process.env.DOOR_POWER_DRYRUN = '1'; process.env.DOOR_WOL_REAL = '1';
  try {
    await power.sendWol('aa:bb:cc:dd:ee:ff', { address: '127.0.0.1', port: rx.address().port });
    assert.deepEqual(await got, pk);
  } finally { rx.close(); delete process.env.DOOR_POWER_DRYRUN; delete process.env.DOOR_WOL_REAL; }
});

// On a Windows machine with administrator rights: the generated script really creates (and removes) the task.
const isWinAdmin = process.platform === 'win32' && spawnSync('net', ['session'], { stdio: 'ignore' }).status === 0;
test('Windows: the wake task can really be created and removed', { skip: !isWinAdmin && 'needs Windows with administrator rights' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wake-'));
  const file = path.join(dir, 'w.ps1');
  fs.writeFileSync(file, `${power.winWakeScript(sample(), '')}\n(Get-ScheduledTask -TaskName 'SagaTechboxDeur-Wake').Settings.WakeToRun\n${'Write-Output ("triggers:" + @((Get-ScheduledTask -TaskName \'SagaTechboxDeur-Wake\').Triggers).Count)'}\n`, 'utf8');
  const r = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', file], { encoding: 'utf8' });
  try {
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /True/); assert.match(r.stdout, /triggers:5/);
    assert.equal(power.wakeStatus().installed, true);
  } finally { spawnSync('powershell', ['-NoProfile', '-Command', "Unregister-ScheduledTask -TaskName 'SagaTechboxDeur-Wake' -Confirm:$false -ErrorAction SilentlyContinue"]); }
  assert.equal(power.wakeStatus().installed, false);
});

test('screen-on is still done when the computer woke up a few minutes late, but shutting down is never late', () => {
  const p = power.clean({ enabled: true, days: Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [d, { screenOff: '17:00', screenOn: '07:30', off: '17:30', on: '07:00' }])) });
  const at = (h, m) => new Date(2026, 9, 14, h, m, 30).getTime(); // a Wednesday
  assert.deepEqual(power.dueEvents(p, at(7, 36), {}), ['screenOn'], 'six minutes late: still switched on');
  assert.deepEqual(power.dueEvents(p, at(8, 5), {}), [], 'half an hour late: too late');
  assert.deepEqual(power.dueEvents(p, at(17, 33), {}), [], 'a shutdown three minutes late is not done');
  assert.deepEqual(power.dueEvents(p, at(17, 3), {}), ['screenOff']);
});
