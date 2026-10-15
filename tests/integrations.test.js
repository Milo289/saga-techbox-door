'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const integ = require('../integrations.js');
const { startServer, call, login } = require('./helpers');

test('tag numbers are normalised and the config is cleaned', () => {
  assert.equal(integ.normUid('04:a2:3b-9c'), '04A23B9C');
  const c = integ.clean({ lock: { enabled: true, url: 'javascript:alert(1)', tags: [{ uid: '04 a2 3b 9c', name: 'Milo' }, { uid: '04A23B9C' }, { uid: 'zz' }] }, automations: [{ when: { source: 'device', key: 'knop' }, do: { status: 'busy', minutes: 99999, unlock: true } }] });
  assert.equal(c.lock.url, '', 'only http(s) addresses');
  assert.equal(c.lock.tags.length, 1, 'duplicates and too-short numbers are dropped');
  assert.equal(c.automations[0].do.minutes, 1440);
});

test('a tag only opens the door at the allowed days and times', () => {
  const cfg = integ.clean({ lock: { enabled: true, url: 'http://lock.local/open', tags: [{ uid: '0A0B0C0D', name: 'Docent', days: [1], from: '08:00', to: '17:00' }] } });
  const mon = (h, m) => new Date(2026, 9, 12, h, m); // a Monday
  assert.equal(integ.tagVerdict(cfg, '0a0b0c0d', mon(9, 0)).ok, true);
  assert.equal(integ.tagVerdict(cfg, '0a0b0c0d', mon(18, 0)).ok, false);
  assert.equal(integ.tagVerdict(cfg, '0a0b0c0d', new Date(2026, 9, 13, 9, 0)).ok, false, 'Tuesday');
  assert.equal(integ.tagVerdict(cfg, 'FFFFFFFF', mon(9, 0)).unknown, true);
  cfg.lock.enabled = false;
  assert.equal(integ.tagVerdict(cfg, '0a0b0c0d', mon(9, 0)).ok, false);
});

test('devices, NFC unlock and camera events work through the API', async (t) => {
  const srv = await startServer({ patch: true, env: { DOOR_LOCK_DRYRUN: '1' } });
  t.after(() => srv.stop());
  const tok = await login(srv);
  const key = (await call(srv, 'POST', '/api/keys/create', { name: 'esp32', perms: ['devices', 'unlock', 'cameras', 'view'] }, tok)).json.key;
  assert.match(key, /^door_/);
  const save = (b) => call(srv, 'POST', '/api/integrations/save', b, tok);

  await t.test('a microcontroller reports and reads the door status; a rule changes the status', async () => {
    assert.equal((await save({ automations: [{ name: 'Knop = bezet', when: { source: 'device', key: 'deurknop', event: 'press' }, do: { status: 'busy', minutes: 10, message: 'Even bezig' } }] })).status, 200);
    const r = await call(srv, 'POST', '/api/device/report', { device: 'deurknop', event: 'press' }, key);
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.mode, 'busy');
    const poll = await call(srv, 'GET', '/api/device/poll?device=deurknop', undefined, key);
    assert.equal(poll.json.mode, 'busy'); assert.match(poll.json.color, /^#/);
    const st = (await call(srv, 'GET', '/api/admin-state', undefined, tok)).json;
    assert.equal(st.devices[0].name, 'deurknop');
  });

  await t.test('the lock stays shut until it is set up; then known tags open it and unknown ones do not', async () => {
    assert.equal((await call(srv, 'POST', '/api/door/tag', { uid: '04A23B9C' }, key)).json.allowed, false);
    await save({ lock: { enabled: true, url: 'http://lock.invalid/open', method: 'POST', body: '{"open":1}', tags: [{ uid: '04:a2:3b:9c', name: 'Milo' }] } });
    const ok = await call(srv, 'POST', '/api/door/tag', { uid: '04a23b9c' }, key);
    assert.equal(ok.json.allowed, true); assert.equal(ok.json.name, 'Milo');
    const no = await call(srv, 'POST', '/api/door/tag', { uid: 'DEADBEEF' }, key);
    assert.equal(no.json.allowed, false);
    const log = (await call(srv, 'GET', '/api/admin-state', undefined, tok)).json.history.map((h) => h.text).join('\n');
    assert.match(log, /Milo opende de deur/); assert.match(log, /geweigerd/);
  });

  await t.test('a key without the unlock right cannot open the door or touch the lock', async () => {
    const weak = (await call(srv, 'POST', '/api/keys/create', { name: 'alleen-sensor', perms: ['devices'] }, tok)).json.key;
    assert.equal((await call(srv, 'POST', '/api/door/tag', { uid: '04A23B9C' }, weak)).status, 403);
    assert.equal((await call(srv, 'POST', '/api/door/unlock', {}, weak)).status, 403);
    assert.equal((await call(srv, 'POST', '/api/camera/event', { camera: 'x', name: 'Milo' }, weak)).status, 403);
  });

  await t.test('camera: off by default; only people who agreed are acted on; a face never opens the door', async () => {
    assert.equal((await call(srv, 'POST', '/api/camera/event', { camera: 'voordeur', kind: 'face', name: 'Milo', confidence: 0.95 }, key)).status, 400, 'off by default');
    await save({ faces: { enabled: true, minConfidence: 0.8, people: [{ name: 'Milo', consent: true, action: { status: 'open', message: 'Welkom Milo', unlock: true } }, { name: 'Sam', consent: false, action: { status: 'closed' } }] } });
    await call(srv, 'POST', '/api/status', { mode: 'closed' }, tok);
    await call(srv, 'POST', '/api/camera/event', { camera: 'voordeur', kind: 'face', name: 'Sam', confidence: 0.99 }, key);
    assert.equal((await call(srv, 'GET', '/api/v1/status', undefined, tok)).json.mode, 'closed', 'no consent: nothing happens');
    await call(srv, 'POST', '/api/camera/event', { camera: 'voordeur', kind: 'face', name: 'Milo', confidence: 0.5 }, key);
    assert.equal((await call(srv, 'GET', '/api/v1/status', undefined, tok)).json.mode, 'closed', 'too unsure: nothing happens');
    await call(srv, 'POST', '/api/camera/event', { camera: 'voordeur', kind: 'face', name: 'Milo', confidence: 0.95 }, key);
    assert.equal((await call(srv, 'GET', '/api/v1/status', undefined, tok)).json.mode, 'open');
    const hist = (await call(srv, 'GET', '/api/admin-state', undefined, tok)).json.history.map((h) => h.text).join('\n');
    assert.ok(!/Milo bij voordeur: deur geopend/.test(hist), 'the unlock flag on a face is ignored');
    const st = (await call(srv, 'GET', '/api/admin-state', undefined, tok)).json;
    assert.ok(st.sightings.length >= 3);
    assert.ok(!JSON.stringify(st.sightings).includes('image'), 'only names are kept, never pictures');
  });

  await t.test('the lock secret is masked and left out of backups', async () => {
    await save({ lock: { enabled: true, url: 'http://lock.invalid/open', headerName: 'X-Key', headerValue: 'geheim', tags: [] } });
    const st = (await call(srv, 'GET', '/api/admin-state', undefined, tok)).json;
    assert.notEqual(st.integ.lock.headerValue, 'geheim');
    await save({ lock: { ...st.integ.lock, tags: [] } }); // saving the masked value must not overwrite the secret
    const exp = await call(srv, 'GET', '/api/export', undefined, tok);
    assert.ok(!exp.text.includes('geheim'));
  });
});
