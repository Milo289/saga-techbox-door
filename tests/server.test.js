'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, call, login, sleep } = require('./helpers');

test('accounts, rights and the screen lock', async (t) => {
  const srv = await startServer();
  t.after(() => srv.stop());

  await t.test('health and public state', async () => {
    assert.equal((await call(srv, 'GET', '/healthz')).status, 200);
    const s = (await call(srv, 'GET', '/api/state')).json;
    assert.equal(s.settings.ui.askTitle, 'Niet kloppen');
    assert.deepEqual(s.blocks, []);
    assert.equal(s.settings.mail, undefined, 'mail settings are private');
    assert.equal(s.view.mode, 'open');
  });

  await t.test('wrong password is refused, right one works', async () => {
    assert.equal((await call(srv, 'POST', '/api/login', { username: 'admin', password: 'nope' })).status, 401);
    assert.ok(await login(srv));
  });

  await t.test('nothing works without a login, and the main account does not exist for others', async () => {
    assert.equal((await call(srv, 'GET', '/api/admin-state')).status, 401);
    const tok = await login(srv);
    assert.equal((await call(srv, 'GET', '/api/system', undefined, tok)).status, 404, 'system routes are invisible to others');
    assert.equal((await call(srv, 'POST', '/api/settings', { note: 'x' }, tok)).status, 200, 'the door message only needs the status right');
    assert.equal((await call(srv, 'POST', '/api/settings', { theme: 'light' }, tok)).status, 403, 'other settings need the settings right');
  });

  await t.test('status with an end time shows what happens next', async () => {
    const tok = await login(srv);
    const r = await call(srv, 'POST', '/api/status', { mode: 'closed', minutes: 30 }, tok);
    assert.equal(r.status, 200);
    const v = (await call(srv, 'GET', '/api/state')).json.view;
    assert.equal(v.mode, 'closed');
    assert.ok(v.until > Date.now());
    assert.equal((await call(srv, 'POST', '/api/status', { mode: 'banana' }, tok)).status, 400);
    await call(srv, 'POST', '/api/status', { mode: 'open' }, tok);
  });

  await t.test('screen lock: 6 digits, enforced by the server, 5 wrong codes log you out', async () => {
    const tok = await login(srv);
    assert.equal((await call(srv, 'POST', '/api/lock', {}, tok)).status, 400, 'no code yet');
    assert.equal((await call(srv, 'POST', '/api/lock/set', { password: 'admin-start-123', code: '12345' }, tok)).status, 400);
    assert.equal((await call(srv, 'POST', '/api/lock/set', { password: 'wrong', code: '123456' }, tok)).status, 400);
    assert.equal((await call(srv, 'POST', '/api/lock/set', { password: 'admin-start-123', code: '246810' }, tok)).status, 200);
    assert.equal((await call(srv, 'POST', '/api/lock', {}, tok)).status, 200);
    assert.equal((await call(srv, 'GET', '/api/admin-state', undefined, tok)).status, 423);
    assert.equal((await call(srv, 'POST', '/api/status', { mode: 'busy' }, tok)).status, 423);
    assert.equal((await call(srv, 'POST', '/api/lock/unlock', { code: '000000' }, tok)).status, 400);
    assert.equal((await call(srv, 'POST', '/api/lock/unlock', { code: '246810' }, tok)).status, 200);
    assert.equal((await call(srv, 'GET', '/api/admin-state', undefined, tok)).status, 200);
    await call(srv, 'POST', '/api/lock', {}, tok);
    let last;
    for (let i = 0; i < 5; i++) last = await call(srv, 'POST', '/api/lock/unlock', { code: '111111' }, tok);
    assert.equal(last.status, 401, 'fifth wrong code ends the session');
    assert.equal((await call(srv, 'GET', '/api/admin-state', undefined, tok)).status, 401);
  });
});

test('visitors: bell, questions, profiles', async (t) => {
  const srv = await startServer();
  t.after(() => srv.stop());
  const tok = await login(srv);

  await t.test('the doorbell has a 45 second cooldown', async () => {
    assert.equal((await call(srv, 'POST', '/api/visit', { type: 'bell' })).status, 200);
    assert.equal((await call(srv, 'POST', '/api/visit', { type: 'bell' })).status, 429, 'two requests within 1.2 s are held back');
    await sleep(1400);
    assert.notEqual((await call(srv, 'POST', '/api/visit', { type: 'bell' })).status, 200, 'still cooling down');
    await sleep(1400);
  });

  await t.test('a question reaches the control panel and the answer reaches the door', async () => {
    const v = await call(srv, 'POST', '/api/visit', { type: 'message', topic: 'Wifi / internet', message: 'valt weg', name: 'Sam' });
    assert.equal(v.status, 200);
    const st = (await call(srv, 'GET', '/api/admin-state', undefined, tok)).json;
    const req = st.requests.find((r) => r.id === v.json.id);
    assert.equal(req.name, 'Sam');
    assert.equal((await call(srv, 'POST', '/api/requests/reply', { id: req.id, reply: 'Ik kom eraan' }, tok)).status, 200);
    const pub = (await call(srv, 'GET', '/api/state')).json;
    assert.ok(pub.replies.some((r) => r.reply === 'Ik kom eraan'));
  });

  await t.test('profiles: create, no duplicates, lookup, limit per hour', async () => {
    assert.equal((await call(srv, 'POST', '/api/profile', { nr: 'A!', name: 'x' })).status, 400);
    assert.equal((await call(srv, 'POST', '/api/profile', { nr: 'anna', name: 'Anna', email: 'anna@x.nl' })).status, 200);
    assert.equal((await call(srv, 'POST', '/api/profile', { nr: 'ANNA', name: 'Other' })).status, 400);
    const look = (await call(srv, 'POST', '/api/lookup', { nr: 'Anna' })).json;
    assert.equal(look.found, true);
    assert.equal(look.name, 'Anna');
    for (const n of ['b1', 'b2', 'b3', 'b4']) assert.equal((await call(srv, 'POST', '/api/profile', { nr: `user${n}`, name: n })).status, 200);
    assert.equal((await call(srv, 'POST', '/api/profile', { nr: 'toomany', name: 'x' })).status, 429);
  });
});

test('design: texts, colours, layout and own blocks', async (t) => {
  const srv = await startServer({ patch: true });
  t.after(() => srv.stop());
  const tok = await login(srv);
  const pub = async () => (await call(srv, 'GET', '/api/state')).json;

  await t.test('own texts replace the standard ones, empty goes back', async () => {
    assert.equal((await call(srv, 'POST', '/api/settings', { ui: { askTitle: 'Hier niet kloppen', bell: '' } }, tok)).status, 200);
    let s = await pub();
    assert.equal(s.settings.ui.askTitle, 'Hier niet kloppen');
    assert.equal(s.settings.ui.bell, 'Deurbel');
    await call(srv, 'POST', '/api/settings', { ui: { askTitle: '' } }, tok);
    s = await pub();
    assert.equal(s.settings.ui.askTitle, 'Niet kloppen');
  });

  await t.test('colours: only real hex colours are kept', async () => {
    await call(srv, 'POST', '/api/settings', { colors: { open: '#00aaff', closed: 'red', busy: '' } }, tok);
    const c = (await pub()).settings.colors;
    assert.equal(c.open, '#00aaff');
    assert.equal(c.closed, '');
  });

  await t.test('layout positions are cleaned and clamped', async () => {
    const r = await call(srv, 'POST', '/api/layout', { key: 'portrait', items: { label: { x: 9999, y: -3.14159, s: 99 }, hacker: { x: 1 }, note: { x: 0, y: 0, s: 1 } } }, tok);
    assert.equal(r.status, 200);
    const p = (await pub()).positions.portrait;
    assert.deepEqual(Object.keys(p), ['label']);
    assert.equal(p.label.x, 100);
    assert.equal(p.label.y, -3.1);
    assert.equal(p.label.s, 2.5);
    assert.equal((await call(srv, 'POST', '/api/layout', { key: 'nonsense', items: {} }, tok)).status, 400);
    await call(srv, 'POST', '/api/layout', { key: 'portrait', items: {} }, tok);
    assert.equal((await pub()).positions.portrait, undefined, 'empty = standard layout');
  });

  await t.test('own blocks: unsafe sources dropped, sizes clamped, positions follow', async () => {
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    await call(srv, 'POST', '/api/blocks', { blocks: [
      { id: 'logo1234', type: 'image', src: png, w: 30 },
      { id: 'bad12345', type: 'image', src: 'javascript:alert(1)' },
      { id: 'bad22222', type: 'image', src: 'http://x.nl/a.png' },
      { id: 'txt12345', type: 'text', text: '<b>hoi</b>', size: 999, color: 'red' },
    ] }, tok);
    const b = (await pub()).blocks;
    assert.deepEqual(b.map((x) => x.id), ['logo1234', 'txt12345']);
    assert.equal(b[1].size, 40);
    assert.equal(b[1].color, '');
    await call(srv, 'POST', '/api/layout', { key: 'phone', items: { blk_txt12345: { x: 5 }, blk_logo1234: { y: 2 } } }, tok);
    await call(srv, 'POST', '/api/blocks', { blocks: [{ id: 'logo1234', type: 'image', src: png }] }, tok);
    assert.deepEqual(Object.keys((await pub()).positions.phone), ['blk_logo1234'], 'removed block takes its position with it');
  });

  await t.test('mail settings are tidied (username, app password, admin address)', async () => {
    await call(srv, 'POST', '/api/settings', { mail: { enabled: true, host: ' smtp.gmail.com ', port: 587, pass: 'abcd efgh ijkl mnop', from: 'me@gmail.com', notifyAdmin: true } }, tok);
    const m = (await call(srv, 'GET', '/api/admin-state', undefined, tok)).json.settings.mail;
    assert.equal(m.host, 'smtp.gmail.com');
    assert.equal(m.user, 'me@gmail.com');
    assert.equal(m.adminTo, 'me@gmail.com');
    assert.notEqual(m.pass, 'abcd efgh ijkl mnop', 'the password is never sent back');
  });
});

test('saving: survives restarts and damage', async (t) => {
  const srv1 = await startServer({ patch: true });
  const dir = srv1.dir;
  let tok = await login(srv1);
  await call(srv1, 'POST', '/api/settings', { ui: { askTitle: 'Bewaar mij' } }, tok);
  await sleep(400); // saves close together are merged into one
  await call(srv1, 'POST', '/api/settings', { note: 'tweede opslag' }, tok); // a second save: now there is a .bak
  await sleep(600);
  await srv1.stop();
  const state = path.join(srv1.dataDir, 'state.json');
  assert.ok(fs.existsSync(state));

  await t.test('settings are still there after a restart', async () => {
    const srv = await startServer({ patch: true, dir });
    try { assert.equal((await call(srv, 'GET', '/api/state')).json.settings.ui.askTitle, 'Bewaar mij'); } finally { await srv.stop(); }
  });

  await t.test('a damaged file is restored from the last good copy, never wiped', async () => {
    fs.writeFileSync(state, '{"broken');
    const srv = await startServer({ patch: true, dir });
    try {
      const s = (await call(srv, 'GET', '/api/state')).json;
      assert.equal(s.settings.ui.askTitle, 'Bewaar mij');
      await sleep(900);
      assert.ok(fs.readdirSync(srv.dataDir).some((f) => f.startsWith('state.json.corrupt-')), 'the damaged file is kept');
      assert.doesNotThrow(() => JSON.parse(fs.readFileSync(state, 'utf8')), 'the recovered settings are written back');
    } finally { await srv.stop(); }
  });

  await t.test('a backup is made before the first start of a new version', async () => {
    const s = JSON.parse(fs.readFileSync(state, 'utf8'));
    s.lastVersion = '0.0.1';
    fs.writeFileSync(state, JSON.stringify(s));
    const srv = await startServer({ patch: true, dir });
    try { assert.ok(fs.readdirSync(path.join(srv.dataDir, 'backups')).some((f) => f.includes('voor-update'))); } finally { await srv.stop(); }
  });
});

test('live connection (SSE) delivers state and the doorbell', async (t) => {
  const srv = await startServer();
  t.after(() => srv.stop());
  const tok = await login(srv);
  const ctl = new AbortController();
  const res = await fetch(`${srv.url}/events?role=admin&token=${tok}`, { signal: ctl.signal });
  assert.equal(res.status, 200);
  const reader = res.body.getReader();
  let seen = '';
  const read = async (needle, ms = 4000) => {
    const end = Date.now() + ms;
    while (!seen.includes(needle) && Date.now() < end) {
      const { value, done } = await Promise.race([reader.read(), sleep(500).then(() => ({ value: null, done: false }))]);
      if (done) break;
      if (value) seen += new TextDecoder().decode(value);
    }
    return seen.includes(needle);
  };
  assert.ok(await read('event: state'), 'first message is the full state');
  await call(srv, 'POST', '/api/visit', { type: 'bell' });
  assert.ok(await read('event: ring'), 'the bell rings on every connected screen');
  ctl.abort();
  assert.equal((await call(srv, 'GET', '/events?role=admin')).status, 401, 'no stream without a login');
});

test('safety: headers and the last change survives a stop', async (t) => {
  const srv = await startServer({ patch: true });
  t.after(() => srv.stop()); // (a no-op when the test below already stopped it)
  const dir = srv.dir;
  const tok = await login(srv);

  await t.test('security headers are set', async () => {
    const r = await fetch(`${srv.url}/api/state`);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(r.headers.get('referrer-policy'), 'no-referrer');
    assert.match(r.headers.get('content-security-policy'), /frame-ancestors 'self'/);
    const page = await fetch(`${srv.url}/`);
    assert.equal(page.headers.get('x-content-type-options'), 'nosniff');
  });

  // Windows has no SIGTERM to catch (stopping always ends the program at once), so this only makes sense elsewhere
  await t.test('a change made just before the program is stopped is still saved', { skip: process.platform === 'win32' }, async () => {
    await call(srv, 'POST', '/api/settings', { note: 'net voor het afsluiten' }, tok);
    srv.child.kill('SIGTERM'); // no waiting: the normal save would still be 150 ms away
    await new Promise((r) => srv.child.once('exit', r));
    const again = await startServer({ patch: true, dir });
    try { assert.equal((await call(again, 'GET', '/api/state')).json.settings.note, 'net voor het afsluiten'); } finally { await again.stop(); }
  });
});
