'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, call, login, sleep } = require('./helpers');

const env = { DOOR_POWER_DRYRUN: '1', DOOR_POWER_PLATFORM: 'win32' };
const nowHM = (plusMin = 0) => { const d = new Date(Date.now() + plusMin * 60000); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const weekSchedule = (cfg) => { const days = {}; for (let i = 0; i < 7; i++) days[i] = { screenOff: '', screenOn: '', off: '', on: '', ...cfg }; return days; };
const adminPower = async (srv, tok) => (await call(srv, 'GET', '/api/admin-state', undefined, tok)).json.power;

test('energy: rights, settings, manual actions, countdown', async (t) => {
  const srv = await startServer({ patch: true, env });
  t.after(() => srv.stop());
  const tok = await login(srv);

  await t.test('only people with the power right can see or change it', async () => {
    const plain = await startServer({ env }); // starter account without the right
    try {
      const pt = await login(plain);
      assert.equal((await call(plain, 'POST', '/api/power/settings', { enabled: true }, pt)).status, 403);
      assert.equal((await call(plain, 'GET', '/api/admin-state', undefined, pt)).json.power, undefined);
    } finally { await plain.stop(); }
    const p = await adminPower(srv, tok);
    assert.equal(p.enabled, false); assert.equal(p.available, true); assert.equal(p.dry, true);
  });

  await t.test('nothing happens until it is switched on', async () => {
    assert.equal((await call(srv, 'POST', '/api/power/now', { action: 'computer' }, tok)).status, 400);
    const r = await call(srv, 'POST', '/api/power/settings', { enabled: true, how: 'hibernate', warnMinutes: 5, watts: 80, days: weekSchedule({ off: '17:30', on: '07:30' }) }, tok);
    assert.equal(r.status, 200);
    const p = await adminPower(srv, tok);
    assert.equal(p.enabled, true); assert.equal(p.how, 'hibernate'); assert.equal(p.watts, 80);
    assert.equal(p.offHours, 14 * 7);
  });

  await t.test('screen off/on run at once', async () => {
    assert.equal((await call(srv, 'POST', '/api/power/now', { action: 'screenOff' }, tok)).status, 200);
    let p = await adminPower(srv, tok);
    assert.equal(p.log[0].action, 'screenOff'); assert.equal(p.log[0].platform, 'win32'); assert.equal(p.log[0].dry, true);
    assert.equal((await call(srv, 'POST', '/api/power/now', { action: 'screenOn' }, tok)).status, 200);
    assert.equal((await call(srv, 'POST', '/api/power/now', { action: 'explode' }, tok)).status, 400);
  });

  await t.test('computer off starts a countdown the door screen can show, and it can be cancelled', async () => {
    assert.equal((await call(srv, 'POST', '/api/power/cancel', {}, tok)).status, 400, 'nothing to cancel');
    assert.equal((await call(srv, 'POST', '/api/power/now', { action: 'computer' }, tok)).status, 200);
    const pub = (await call(srv, 'GET', '/api/state')).json.power;
    assert.equal(pub.action, 'computer');
    assert.ok(pub.at > Date.now() + 4 * 60000 && pub.at <= Date.now() + 5 * 60000 + 1000);
    assert.equal((await call(srv, 'POST', '/api/power/now', { action: 'restart' }, tok)).status, 400, 'one countdown at a time');
    assert.equal((await call(srv, 'POST', '/api/power/cancel', {}, tok)).status, 200);
    assert.equal((await call(srv, 'GET', '/api/state')).json.power, null);
    assert.ok(!(await adminPower(srv, tok)).log.some((l) => l.action === 'computer'), 'cancelled: nothing was executed');
  });

  await t.test('without a warning time it happens at once, with the right command', async () => {
    await call(srv, 'POST', '/api/power/settings', { enabled: true, how: 'computer', warnMinutes: 0, days: weekSchedule({}) }, tok);
    assert.equal((await call(srv, 'POST', '/api/power/now', { action: 'computer' }, tok)).status, 200);
    const log = (await adminPower(srv, tok)).log;
    assert.equal(log[0].action, 'computer'); assert.equal(log[0].command, 'shutdown /s /t 0');
    assert.equal((await call(srv, 'GET', '/api/state')).json.power, null);
  });

  await t.test('wake-up schedule: apply and remove (practice run)', async () => {
    await call(srv, 'POST', '/api/power/settings', { enabled: true, days: weekSchedule({ on: '07:30' }) }, tok);
    const r = await call(srv, 'POST', '/api/power/wake/apply', {}, tok);
    assert.equal(r.status, 200); assert.match(r.json.script, /Register-ScheduledTask/);
    assert.ok((await adminPower(srv, tok)).wakeApplied > 0);
    assert.equal((await call(srv, 'POST', '/api/power/wake/remove', {}, tok)).status, 200);
    assert.equal((await adminPower(srv, tok)).wakeApplied, 0);
    await call(srv, 'POST', '/api/power/settings', { enabled: true, days: weekSchedule({}) }, tok);
    assert.equal((await call(srv, 'POST', '/api/power/wake/apply', {}, tok)).status, 400, 'needs at least one wake time');
  });

  await t.test('Wake-on-LAN list', async () => {
    await call(srv, 'POST', '/api/power/settings', { enabled: true, days: weekSchedule({}), wol: [{ name: 'Deur-Pi', mac: 'AA:BB:CC:DD:EE:FF' }, { name: 'kapot', mac: 'x' }] }, tok);
    assert.equal((await adminPower(srv, tok)).wol.length, 1);
    assert.equal((await call(srv, 'POST', '/api/power/wol', { index: 0 }, tok)).status, 200);
    assert.equal((await call(srv, 'POST', '/api/power/wol', { index: 3 }, tok)).status, 400);
  });
});

test('energy: the schedule runs by itself', async (t) => {
  await t.test('screen off at the planned time', async () => {
    const srv = await startServer({ patch: true, env });
    try {
      const tok = await login(srv);
      await call(srv, 'POST', '/api/power/settings', { enabled: true, warnMinutes: 5, days: weekSchedule({ screenOff: nowHM() }) }, tok);
      let log = [];
      for (let i = 0; i < 40 && !log.some((l) => l.action === 'screenOff'); i++) { await sleep(250); log = (await adminPower(srv, tok)).log; }
      assert.ok(log.some((l) => l.action === 'screenOff' && l.dry), 'the schedule fired within one tick');
    } finally { await srv.stop(); }
  });

  await t.test('computer off at the planned time (with a warning), skipped while visitors wait, paused on holiday', async () => {
    const srv = await startServer({ patch: true, env });
    try {
      const tok = await login(srv);
      const d = new Date(); const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      // paused today: nothing happens
      await call(srv, 'POST', '/api/power/settings', { enabled: true, warnMinutes: 5, pauseUntil: today, days: weekSchedule({ off: nowHM() }) }, tok);
      await sleep(6500);
      assert.equal((await call(srv, 'GET', '/api/state')).json.power, null, 'paused');
      // someone is waiting at the door: skipped
      await call(srv, 'POST', '/api/visit', { type: 'message', message: 'help' });
      await call(srv, 'POST', '/api/power/settings', { enabled: true, warnMinutes: 5, pauseUntil: '', skipIfBusy: true, days: weekSchedule({ off: nowHM() }) }, tok);
      await sleep(6500);
      assert.equal((await call(srv, 'GET', '/api/state')).json.power, null, 'skipped because of an open request');
      const hist = (await call(srv, 'GET', '/api/admin-state', undefined, tok)).json.history;
      assert.ok(hist.some((h) => /niet uitgezet/.test(h.text)));
    } finally { await srv.stop(); }
    const srv2 = await startServer({ patch: true, env });
    try {
      const tok = await login(srv2);
      await call(srv2, 'POST', '/api/power/settings', { enabled: true, warnMinutes: 5, days: weekSchedule({ off: nowHM() }) }, tok);
      let pub = null;
      for (let i = 0; i < 40 && !pub; i++) { await sleep(250); pub = (await call(srv2, 'GET', '/api/state')).json.power; }
      assert.ok(pub && pub.action === 'computer', 'the countdown started by itself');
      assert.equal((await call(srv2, 'POST', '/api/power/cancel', {}, tok)).status, 200);
    } finally { await srv2.stop(); }
  });
});
