'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const net = require('node:net');
const { startServer, call, login, sleep } = require('./helpers');

// every visitor gets an address of their own (the server trusts the header in this test setup)
const visit = (srv, body, ip, token) => call(srv, 'POST', '/api/visit', body, token, { 'X-Forwarded-For': ip });
const profile = (srv, body, ip) => call(srv, 'POST', '/api/profile', body, undefined, { 'X-Forwarded-For': ip });
let n = 0; const ipN = () => `10.1.${Math.floor(n / 200)}.${(n++ % 200) + 1}`;

test('moderation', async (t) => {
  const srv = await startServer({ patch: true, env: { TRUST_PROXY: '1' } });
  t.after(() => srv.stop());
  const tok = await login(srv);
  const requests = async () => (await call(srv, 'GET', '/api/admin-state', undefined, tok)).json.requests;
  const setMod = (m) => call(srv, 'POST', '/api/settings', { moderation: { filter: true, defaultList: true, words: '', action: 'mask', maxPerHour: 20, profileApproval: false, ...m } }, tok);

  await t.test('bad words are hidden and the visit is marked', async () => {
    const r = await visit(srv, { type: 'message', message: 'Je bent een kut en een lul!', name: 'Piet' }, ipN());
    assert.equal(r.status, 200);
    const req = (await requests()).find((x) => x.id === r.json.id);
    assert.equal(req.message, 'Je bent een *** en een ***!');
    assert.deepEqual([...req.flagged].sort(), ['kut', 'lul']);
  });

  await t.test('a disguised spelling is caught and the whole text hidden', async () => {
    const r = await visit(srv, { type: 'message', message: 'k4nker zooi' }, ipN());
    const req = (await requests()).find((x) => x.id === r.json.id);
    assert.equal(req.message, '[bericht verborgen]');
    assert.ok(req.flagged.includes('kanker'));
  });

  await t.test('innocent words are left alone', async () => {
    const r = await visit(srv, { type: 'message', message: 'Ik wil graag een afspraak, lulverhaal is geen woord, 5 minuten', name: 'Anna' }, ipN());
    const req = (await requests()).find((x) => x.id === r.json.id);
    assert.equal(req.flagged, undefined);
    assert.match(req.message, /afspraak/);
  });

  await t.test('flag keeps the text, block refuses it, own words work', async () => {
    await setMod({ action: 'flag' });
    let r = await visit(srv, { type: 'message', message: 'wat een shit' }, ipN());
    let req = (await requests()).find((x) => x.id === r.json.id);
    assert.equal(req.message, 'wat een shit'); assert.deepEqual([...req.flagged], ['shit']);
    await setMod({ action: 'block' });
    assert.equal((await visit(srv, { type: 'message', message: 'wat een shit' }, ipN())).status, 400);
    await setMod({ action: 'mask', words: 'bananenschil, gemeen' });
    r = await visit(srv, { type: 'message', message: 'jij bananenschil' }, ipN());
    req = (await requests()).find((x) => x.id === r.json.id);
    assert.equal(req.message, 'jij ' + '*'.repeat('bananenschil'.length));
    await setMod({ filter: false });
    r = await visit(srv, { type: 'message', message: 'wat een shit' }, ipN());
    assert.equal((await requests()).find((x) => x.id === r.json.id).message, 'wat een shit', 'filter off = untouched');
    await setMod({});
  });

  await t.test('profiles with bad words are refused', async () => {
    assert.equal((await profile(srv, { nr: 'fuckjoe', name: 'Joe' }, ipN())).status, 400);
    assert.equal((await profile(srv, { nr: 'kut', name: 'Joe' }, ipN())).status, 400);
    assert.equal((await profile(srv, { nr: 'lulu', name: 'Lulu' }, ipN())).status, 200, 'a harmless name that starts like a bad word is fine');
    assert.equal((await profile(srv, { nr: 'joe1', name: 'Joe lul' }, ipN())).status, 400);
  });

  await t.test('a phone may only do so much per hour; the door screen is not limited', async () => {
    await setMod({ maxPerHour: 2 });
    const ip = ipN();
    assert.equal((await visit(srv, { type: 'message', message: 'een', via: 'phone' }, ip)).status, 200); await sleep(1300);
    assert.equal((await visit(srv, { type: 'message', message: 'twee', via: 'phone' }, ip)).status, 200); await sleep(1300);
    assert.equal((await visit(srv, { type: 'message', message: 'drie', via: 'phone' }, ip)).status, 429);
    const door = '10.9.9.9';
    for (let i = 0; i < 3; i++) { assert.equal((await visit(srv, { type: 'message', message: 'deur ' + i, via: 'door' }, door)).status, 200); await sleep(1300); }
    await setMod({});
  });

  await t.test('blocking a phone address works, and it can be lifted', async () => {
    const ip = ipN();
    const r = await visit(srv, { type: 'message', message: 'hallo', via: 'phone' }, ip);
    assert.equal((await call(srv, 'POST', '/api/moderation/block', { id: r.json.id, minutes: 60 }, tok)).status, 200);
    await sleep(1300);
    assert.equal((await visit(srv, { type: 'message', message: 'weer', via: 'phone' }, ip)).status, 429);
    assert.equal((await visit(srv, { type: 'message', message: 'andere', via: 'phone' }, ipN())).status, 200, 'other phones are not affected');
    const blocked = (await call(srv, 'GET', '/api/admin-state', undefined, tok)).json.blocked;
    assert.equal(blocked.length, 1); assert.equal(blocked[0].kind, 'ip');
    assert.equal((await call(srv, 'POST', '/api/moderation/unblock', { id: blocked[0].id }, tok)).status, 200);
    await sleep(1300);
    assert.equal((await visit(srv, { type: 'message', message: 'weer terug', via: 'phone' }, ip)).status, 200);
  });

  await t.test('the door screen itself can never be blocked', async () => {
    const r = await visit(srv, { type: 'message', message: 'anoniem', via: 'door' }, ipN());
    const res = await call(srv, 'POST', '/api/moderation/block', { id: r.json.id, minutes: 0 }, tok);
    assert.equal(res.status, 400);
    assert.match(res.json.error, /deurscherm/);
    // a shared address (no real address known) is never blocked either
    const local = await call(srv, 'POST', '/api/visit', { type: 'message', message: 'lokaal', via: 'phone' });
    assert.equal((await call(srv, 'POST', '/api/moderation/block', { id: local.json.id }, tok)).status, 400);
  });

  await t.test('a visitor with a profile is blocked by profile', async () => {
    assert.equal((await profile(srv, { nr: 'bob', name: 'Bob' }, ipN())).status, 200);
    const r = await visit(srv, { type: 'message', message: 'hoi', nr: 'bob' }, ipN());
    assert.equal(r.status, 200);
    assert.equal((await call(srv, 'POST', '/api/moderation/block', { id: r.json.id, minutes: 0 }, tok)).status, 200);
    await sleep(1300);
    assert.equal((await visit(srv, { type: 'message', message: 'weer', nr: 'bob' }, ipN())).status, 429);
  });

  await t.test('profiles can need approval first', async () => {
    await setMod({ profileApproval: true });
    const created = await profile(srv, { nr: 'carl', name: 'Carl' }, ipN());
    assert.equal(created.json.pending, true);
    assert.deepEqual((await call(srv, 'POST', '/api/lookup', { nr: 'carl' })).json, { found: false, pending: true });
    assert.equal((await visit(srv, { type: 'message', message: 'hoi', nr: 'carl' }, ipN())).status, 400);
    const pend = (await call(srv, 'GET', '/api/admin-state', undefined, tok)).json.pendingProfiles;
    assert.equal(pend.length, 1);
    assert.equal((await call(srv, 'POST', '/api/moderation/profile', { id: pend[0].id, approve: true }, tok)).status, 200);
    assert.equal((await call(srv, 'POST', '/api/lookup', { nr: 'carl' })).json.found, true);
    await profile(srv, { nr: 'dora', name: 'Dora' }, ipN());
    const p2 = (await call(srv, 'GET', '/api/admin-state', undefined, tok)).json.pendingProfiles;
    await call(srv, 'POST', '/api/moderation/profile', { id: p2[0].id, approve: false }, tok);
    assert.equal((await call(srv, 'POST', '/api/lookup', { nr: 'dora' })).json.found, false);
    await setMod({});
  });

  await t.test('a message can be deleted', async () => {
    const r = await visit(srv, { type: 'message', message: 'weg ermee' }, ipN());
    assert.equal((await call(srv, 'POST', '/api/requests/delete', { id: r.json.id }, tok)).status, 200);
    assert.ok(!(await requests()).some((x) => x.id === r.json.id));
  });
});

test('callback requests, absence mode and the receptionist role', async (t) => {
  const srv = await startServer({ patch: true, env: { TRUST_PROXY: '1' } });
  t.after(() => srv.stop());
  const tok = await login(srv);

  await t.test('callback: off by default, needs a real phone number', async () => {
    assert.equal((await visit(srv, { type: 'callback', name: 'Sam', phone: '0612345678' }, ipN())).status, 400, 'off by default');
    await call(srv, 'POST', '/api/settings', { visitors: { reasons: false, doorbell: true, bellWhenBlocked: false, appointments: true, messages: true, callback: true } }, tok);
    assert.equal((await visit(srv, { type: 'callback', name: 'Sam', phone: 'abc' }, ipN())).status, 400);
    assert.equal((await visit(srv, { type: 'callback', phone: '0612345678' }, ipN())).status, 400, 'a name is needed');
    const r = await visit(srv, { type: 'callback', name: 'Sam', phone: '06 1234 5678', when: 'Vanmiddag' }, ipN());
    assert.equal(r.status, 200);
    const req = (await call(srv, 'GET', '/api/admin-state', undefined, tok)).json.requests.find((x) => x.id === r.json.id);
    assert.equal(req.phone, '06 1234 5678'); assert.equal(req.when, 'Vanmiddag');
  });

  await t.test('absence mode closes the door until the end of that day', async () => {
    const d = new Date(Date.now() + 2 * 864e5), day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    await call(srv, 'POST', '/api/settings', { away: { enabled: true, until: day, message: 'Op vakantie' } }, tok);
    const v = (await call(srv, 'GET', '/api/state')).json.view;
    assert.equal(v.mode, 'closed'); assert.equal(v.source, 'away'); assert.equal(v.message, 'Op vakantie');
    assert.ok(v.until > Date.now() + 864e5);
    await call(srv, 'POST', '/api/settings', { away: { enabled: false, until: day, message: '' } }, tok);
    assert.equal((await call(srv, 'GET', '/api/state')).json.view.mode, 'open');
    await call(srv, 'POST', '/api/settings', { away: { enabled: true, until: 'ooit', message: '' } }, tok);
    assert.equal((await call(srv, 'GET', '/api/state')).json.settings.away.until, '', 'a bad date is dropped');
    await call(srv, 'POST', '/api/settings', { away: { enabled: false, until: '', message: '' } }, tok);
  });

  await t.test('receptionist: answers visitors, nothing else', async () => {
    const mk = await call(srv, 'POST', '/api/users/save', { username: 'ria', name: 'Ria', password: 'receptie-123', role: 'receptionist' }, tok);
    assert.equal(mk.status, 200);
    const rt = await login(srv, 'ria', 'receptie-123');
    const st = (await call(srv, 'GET', '/api/admin-state', undefined, rt)).json;
    assert.deepEqual([...st.me.perms].sort(), ['inbox', 'view']);
    assert.equal((await call(srv, 'POST', '/api/status', { mode: 'busy' }, rt)).status, 403);
    assert.equal((await call(srv, 'POST', '/api/settings', { note: 'x' }, rt)).status, 403);
    const r = await visit(srv, { type: 'message', message: 'hallo' }, ipN());
    assert.equal((await call(srv, 'POST', '/api/requests/reply', { id: r.json.id, reply: 'Ik kom' }, rt)).status, 200);
  });
});

test('weather, own bell sound, evening summary', async (t) => {
  // a pretend weather service and a pretend mail server
  const wx = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    if (req.url.startsWith('/geo')) return res.end(JSON.stringify({ results: [{ name: 'Utrecht', latitude: 52.09, longitude: 5.12 }] }));
    res.end(JSON.stringify({ current: { temperature_2m: 12.4, weather_code: 3 } }));
  });
  await new Promise((r) => wx.listen(0, '127.0.0.1', r));
  const mails = [];
  const smtp = net.createServer((s) => {
    let data = '', inData = false;
    s.write('220 fake\r\n');
    s.on('data', (d) => {
      data += d.toString();
      while (true) {
        if (inData) { const i = data.indexOf('\r\n.\r\n'); if (i < 0) return; mails.push(data.slice(0, i)); data = data.slice(i + 5); inData = false; s.write('250 ok\r\n'); continue; }
        const i = data.indexOf('\r\n'); if (i < 0) return;
        const line = data.slice(0, i); data = data.slice(i + 2);
        if (/^DATA/i.test(line)) { inData = true; s.write('354 go\r\n'); } else if (/^QUIT/i.test(line)) { s.write('221 bye\r\n'); s.end(); } else s.write('250 ok\r\n');
      }
    });
  });
  await new Promise((r) => smtp.listen(0, '127.0.0.1', r));
  const srv = await startServer({ patch: true, env: { DOOR_WEATHER_API: `http://127.0.0.1:${wx.address().port}/wx`, DOOR_GEOCODE_API: `http://127.0.0.1:${wx.address().port}/geo` } });
  t.after(async () => { await srv.stop(); wx.close(); smtp.close(); });
  const tok = await login(srv);

  await t.test('weather: look up a place, then the screen gets the temperature', async () => {
    const r = await call(srv, 'POST', '/api/weather/lookup', { city: 'utrecht' }, tok);
    assert.equal(r.status, 200); assert.equal(r.json.city, 'Utrecht');
    await call(srv, 'POST', '/api/settings', { weather: { enabled: true, city: 'Utrecht', lat: 52.09, lon: 5.12 } }, tok);
    let w = null;
    for (let i = 0; i < 30 && !w; i++) { await sleep(100); w = (await call(srv, 'GET', '/api/state')).json.weather; }
    assert.deepEqual(w, { temp: 12, code: 3, city: 'Utrecht' });
  });

  await t.test('own bell sound: upload, play, remove; the browser cannot fake it', async () => {
    assert.equal((await call(srv, 'POST', '/api/settings', { sound: { bell: 'custom', reply: 'soft', custom: true } }, tok)).status, 200);
    let s = (await call(srv, 'GET', '/api/state')).json.settings.sound;
    assert.equal(s.custom, false); assert.equal(s.bell, 'classic', 'no upload, no custom bell');
    const bytes = Buffer.from('RIFF....WAVEfmt this is a pretend sound file for the test');
    assert.equal((await call(srv, 'POST', '/api/sound', { mime: 'audio/wav', data: bytes.toString('base64') }, tok)).status, 200);
    s = (await call(srv, 'GET', '/api/state')).json.settings.sound;
    assert.equal(s.custom, true); assert.equal(s.bell, 'custom');
    const got = await fetch(`${srv.url}/api/bell-sound`);
    assert.equal(got.status, 200); assert.equal(got.headers.get('content-type'), 'audio/wav');
    assert.deepEqual(Buffer.from(await got.arrayBuffer()), bytes);
    assert.equal((await call(srv, 'POST', '/api/sound', { mime: 'text/html', data: bytes.toString('base64') }, tok)).status, 400);
    assert.equal((await call(srv, 'POST', '/api/sound/remove', {}, tok)).status, 200);
    assert.equal((await fetch(`${srv.url}/api/bell-sound`)).status, 404);
    assert.equal((await call(srv, 'GET', '/api/state')).json.settings.sound.bell, 'classic');
  });

  await t.test('evening summary arrives by mail', async () => {
    await call(srv, 'POST', '/api/settings', { mail: { enabled: true, host: '127.0.0.1', port: smtp.address().port, from: 'deur@example.nl', adminTo: 'ik@example.nl', digest: true, digestAt: '99:99' } }, tok);
    assert.equal((await call(srv, 'GET', '/api/admin-state', undefined, tok)).json.settings.mail.digestAt, '18:00', 'a bad time falls back');
    await call(srv, 'POST', '/api/visit', { type: 'message', message: 'hoi', name: 'Sam' });
    const r = await call(srv, 'POST', '/api/mail/digest-test', {}, tok);
    assert.equal(r.status, 200, r.text);
    assert.equal(mails.length, 1);
    assert.match(mails[0], /Subject: =\?UTF-8\?B\?/);
    const body = Buffer.from(mails[0].split('\r\n\r\n').slice(1).join('').replace(/\s+/g, ''), 'base64').toString('utf8');
    assert.match(body, /1 bezoek in totaal/);
    assert.match(body, /1 vraagjes/);
  });
});
