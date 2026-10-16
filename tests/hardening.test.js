'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startServer, call, login, sleep } = require('./helpers');
const sec = require('../security.js');

const MASK = '••••••••';
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'hard-'));
const readState = (srv) => JSON.parse(fs.readFileSync(path.join(srv.dataDir, 'state.json'), 'utf8'));

test('secrets are encrypted on disk and still work after a restart', async (t) => {
  const dir = tmp();
  let srv = await startServer({ patch: true, dir });
  let tok = await login(srv);
  await call(srv, 'POST', '/api/settings', { mail: { enabled: false, host: 'smtp.example.com', port: 587, user: 'ik@example.com', pass: 'Heel-geheim-wachtwoord', from: 'ik@example.com', adminTo: '', confirm: true, reply: true, notifyAdmin: false, digest: false, digestAt: '18:00' }, ntfyTopic: 'mijn-geheime-onderwerp' }, tok);
  await sleep(700);
  const raw = fs.readFileSync(path.join(srv.dataDir, 'state.json'), 'utf8');
  assert.ok(!raw.includes('Heel-geheim-wachtwoord'), 'the mail password is not readable on disk');
  assert.ok(!raw.includes('mijn-geheime-onderwerp'));
  assert.ok(raw.includes('enc:v1:'));
  assert.ok(fs.existsSync(path.join(srv.dataDir, 'secret.key')), 'the key has its own file');
  await srv.stop();
  srv = await startServer({ patch: true, dir });
  t.after(() => srv.stop());
  tok = await login(srv);
  const st = (await call(srv, 'GET', '/api/admin-state', undefined, tok)).json;
  assert.equal(st.settings.mail.pass, MASK, 'after a restart the password is still there (decrypted in memory, masked for the browser)');
  assert.equal(st.settings.ntfyTopic, 'mijn-geheime-onderwerp');
});

test('the log has a chain: it verifies, exports, and shows tampering', async (t) => {
  const dir = tmp();
  let srv = await startServer({ patch: true, dir });
  let tok = await login(srv);
  for (let i = 0; i < 4; i++) await call(srv, 'POST', '/api/status', { mode: i % 2 ? 'open' : 'closed' }, tok);
  const v = (await call(srv, 'GET', '/api/audit/verify', undefined, tok)).json;
  assert.equal(v.ok, true); assert.ok(v.checked >= 5);
  const csv = await call(srv, 'GET', '/api/audit/export', undefined, tok);
  assert.equal(csv.status, 200); assert.match(csv.text, /^Tijd,Soort,Wat,Wie,Vingerafdruk/);
  assert.match((await call(srv, 'GET', '/api/audit/export?format=json', undefined, tok)).text, /"type"/);
  await sleep(700); await srv.stop();
  const s = readState(srv); s.history[2].text = 'Vervalst'; // someone edits the file by hand
  fs.writeFileSync(path.join(srv.dataDir, 'state.json'), JSON.stringify(s));
  srv = await startServer({ patch: true, dir });
  t.after(() => srv.stop());
  tok = await login(srv);
  const bad = (await call(srv, 'GET', '/api/audit/verify', undefined, tok)).json;
  assert.equal(bad.ok, false); assert.ok(bad.brokenAt >= 2, 'the edited line is found (new lines were added on top since)');
});

test('devices and sessions: listed per account, ended one by one or all others', async (t) => {
  const srv = await startServer({ patch: true });
  t.after(() => srv.stop());
  const a = (await call(srv, 'POST', '/api/login', { username: 'admin', password: 'admin-start-123' })).json.token;
  const b = (await call(srv, 'POST', '/api/login', { username: 'admin', password: 'admin-start-123' })).json.token;
  const list = (await call(srv, 'GET', '/api/my/sessions', undefined, a)).json.sessions;
  assert.equal(list.length, 2); assert.equal(list.filter((x) => x.current).length, 1); assert.ok(list[0].device);
  const r = await call(srv, 'POST', '/api/my/sessions/revoke', { others: true }, a);
  assert.equal(r.json.ended, 1);
  assert.equal((await call(srv, 'GET', '/api/me', undefined, b)).status, 401, 'the other device is logged out');
  assert.equal((await call(srv, 'GET', '/api/me', undefined, a)).status, 200);
});

test('two-step verification: set up, needed at login, once per code, recovery codes', async (t) => {
  const srv = await startServer({ patch: true });
  t.after(() => srv.stop());
  const tok = await login(srv);
  const setup = (await call(srv, 'POST', '/api/2fa/setup', {}, tok)).json;
  assert.match(setup.secret, /^[A-Z2-7]{32}$/); assert.match(setup.uri, /^otpauth:\/\/totp\//);
  assert.equal((await call(srv, 'POST', '/api/2fa/enable', { code: '000000' }, tok)).status, 400, 'a wrong code does not turn it on');
  const en = await call(srv, 'POST', '/api/2fa/enable', { code: sec.totp.code(setup.secret) }, tok);
  assert.equal(en.status, 200, en.text);
  assert.equal(en.json.recovery.length, 8);
  assert.equal((await call(srv, 'GET', '/api/2fa/status', undefined, tok)).json.enabled, true);

  const step1 = (await call(srv, 'POST', '/api/login', { username: 'admin', password: 'admin-start-123' })).json;
  assert.equal(step1.needs2fa, true); assert.ok(step1.mfa); assert.ok(!step1.token, 'no session before the code');
  const wrong = await call(srv, 'POST', '/api/login/2fa', { mfa: step1.mfa, code: '123456' });
  assert.equal(wrong.status, 401);
  const right = await call(srv, 'POST', '/api/login/2fa', { mfa: step1.mfa, code: sec.totp.code(setup.secret, Date.now() + 30000) });
  assert.equal(right.status, 200, right.text);
  assert.equal((await call(srv, 'GET', '/api/me', undefined, right.json.token)).status, 200);

  // the same code never works twice
  const again = (await call(srv, 'POST', '/api/login', { username: 'admin', password: 'admin-start-123' })).json;
  assert.equal((await call(srv, 'POST', '/api/login/2fa', { mfa: again.mfa, code: sec.totp.code(setup.secret, Date.now() + 30000) })).status, 401, 'replay of a used code');

  // a recovery code works once
  const third = (await call(srv, 'POST', '/api/login', { username: 'admin', password: 'admin-start-123' })).json;
  const rc = en.json.recovery[0];
  assert.equal((await call(srv, 'POST', '/api/login/2fa', { mfa: third.mfa, code: rc.toUpperCase() })).status, 200);
  const fourth = (await call(srv, 'POST', '/api/login', { username: 'admin', password: 'admin-start-123' })).json;
  assert.equal((await call(srv, 'POST', '/api/login/2fa', { mfa: fourth.mfa, code: rc })).status, 401, 'a recovery code only once');
  assert.equal((await call(srv, 'GET', '/api/2fa/status', undefined, tok)).json.recoveryLeft, 7);

  // turning it off needs the password and a code
  assert.equal((await call(srv, 'POST', '/api/2fa/disable', { password: 'fout', code: sec.totp.code(setup.secret, Date.now() + 60000) }, tok)).status, 400);

  // too many wrong codes on one login moment
  const fifth = (await call(srv, 'POST', '/api/login', { username: 'admin', password: 'admin-start-123' })).json;
  let last = 0; for (let i = 0; i < 7; i++) last = (await call(srv, 'POST', '/api/login/2fa', { mfa: fifth.mfa, code: '000000' })).status;
  assert.ok([401, 429].includes(last));
  assert.ok([401, 429].includes((await call(srv, 'POST', '/api/login/2fa', { mfa: fifth.mfa, code: sec.totp.code(setup.secret, Date.now() + 30000) })).status), 'that login moment is closed');

});

test('when the admin demands it, an account without two-step codes can only set it up', async (t) => {
  const dir = tmp();
  let srv = await startServer({ patch: true, dir });
  await login(srv); await sleep(700); await srv.stop();
  const s = readState(srv); s.system.require2fa = 'privileged';
  fs.writeFileSync(path.join(srv.dataDir, 'state.json'), JSON.stringify(s));
  srv = await startServer({ patch: true, dir });
  t.after(() => srv.stop());
  const tok = await login(srv);
  const r = await call(srv, 'POST', '/api/people', { people: [] }, tok);
  assert.equal(r.status, 403); assert.equal(r.json.setup2fa, true);
  assert.equal((await call(srv, 'GET', '/api/admin-state', undefined, tok)).status, 200, 'the panel itself still opens, to show what to do');
  const setup = (await call(srv, 'POST', '/api/2fa/setup', {}, tok)).json;
  assert.equal((await call(srv, 'POST', '/api/2fa/enable', { code: sec.totp.code(setup.secret) }, tok)).status, 200);
  assert.equal((await call(srv, 'POST', '/api/people', { people: [] }, tok)).status, 200, 'after setting it up everything works again');
});

test('temporary rights run out and cannot exceed your own', async (t) => {
  const srv = await startServer({ patch: true });
  t.after(() => srv.stop());
  const start = await login(srv);
  // the start account loses its rights as soon as another account exists, so a second manager is made first
  assert.equal((await call(srv, 'POST', '/api/users/save', { username: 'beheer1', name: 'Beheer', role: 'beheerder', perms: ['view', 'users', 'inbox'], password: 'Zeer-goed-wachtwoord-77' }, start)).status, 200);
  const tok = await login(srv, 'beheer1', 'Zeer-goed-wachtwoord-77');
  const r = await call(srv, 'POST', '/api/users/save', { username: 'invaller', name: 'Invaller', role: 'kijker', password: 'Zeer-goed-wachtwoord-77', grants: [{ perm: 'inbox', minutes: 30 }, { perm: 'system', minutes: 30 }, { perm: 'power', minutes: 30 }] }, tok);
  assert.equal(r.status, 400, 'power is not held by the manager: refused');
  const r2 = await call(srv, 'POST', '/api/users/save', { username: 'invaller', name: 'Invaller', role: 'kijker', password: 'Zeer-goed-wachtwoord-77', grants: [{ perm: 'inbox', minutes: 30 }, { perm: 'system', minutes: 30 }] }, tok);
  assert.equal(r2.status, 200, r2.text);
  assert.deepEqual(r2.json.user.grants.map((g) => g.perm), ['inbox'], 'system can never be handed out');
  const lt = (await call(srv, 'POST', '/api/login', { username: 'invaller', password: 'Zeer-goed-wachtwoord-77' })).json.token;
  assert.ok((await call(srv, 'GET', '/api/me', undefined, lt)).json.perms.includes('inbox'));
  await call(srv, 'POST', '/api/users/save', { id: r2.json.user.id, username: 'invaller', name: 'Invaller', role: 'kijker', grants: [] }, tok);
  assert.ok(!(await call(srv, 'GET', '/api/me', undefined, lt)).json.perms.includes('inbox'), 'taken away at once');
});

test('the block list can be seen, lifted and extended', async (t) => {
  const srv = await startServer({ patch: true, env: { DOOR_RATE_TEST: '1', DOOR_RATE_BURST: '20', DOOR_RATE_PER_SEC: '2', TRUST_PROXY: '1' } });
  t.after(() => srv.stop());
  const H = { 'X-Forwarded-For': '10.9.9.9' };
  const tok = (await call(srv, 'POST', '/api/login', { username: 'admin', password: 'admin-start-123' }, undefined, H)).json.token;
  await Promise.all(Array.from({ length: 160 }, () => fetch(`${srv.url}/api/state`, { headers: { 'X-Forwarded-For': '10.7.7.7' } })));
  await sleep(300);
  const bans = (await call(srv, 'GET', '/api/security/bans', undefined, tok, H)).json;
  assert.ok(bans.bans.some((b) => b.ip === '10.7.7.7'), 'the flooder is on the list');
  assert.equal((await call(srv, 'POST', '/api/security/unban', { ip: '10.7.7.7' }, tok, H)).status, 200);
  assert.equal((await fetch(`${srv.url}/api/state`, { headers: { 'X-Forwarded-For': '10.7.7.7' } })).status, 200, 'lifted');
  assert.equal((await call(srv, 'POST', '/api/security/ban', { ip: '10.9.9.9', minutes: 5 }, tok, H)).status, 400, 'you cannot block yourself');
  assert.equal((await call(srv, 'POST', '/api/security/ban', { ip: '10.5.5.5', minutes: 5 }, tok, H)).status, 200);
  assert.equal((await fetch(`${srv.url}/api/state`, { headers: { 'X-Forwarded-For': '10.5.5.5' } })).status, 429);
});

test('backups with a password and a second copy; restart from the panel', async (t) => {
  const dir = tmp(), copy = path.join(tmp(), 'kopie');
  const srv = await startServer({ patch: true, system: true, dir });
  const tok = await login(srv);
  const set = await call(srv, 'POST', '/api/system/settings', { backupPassword: 'Back-up-wachtwoord-1', backupCopyDir: copy, backupKeep: 14 }, tok);
  assert.equal(set.status, 200, set.text);
  assert.equal((await call(srv, 'GET', '/api/system', undefined, tok)).json.system.backupPassword, MASK, 'the password is never sent back');
  await call(srv, 'POST', '/api/settings', { name: 'Zichtbare-naam-in-test' }, tok);
  const made = await call(srv, 'POST', '/api/system/backups/create', {}, tok);
  assert.equal(made.status, 200, made.text);
  assert.match(made.json.name, /\.sbk$/);
  const file = path.join(srv.dataDir, 'backups', made.json.name);
  assert.ok(!fs.readFileSync(file, 'utf8').includes('Zichtbare-naam-in-test'), 'the backup is unreadable without the password');
  assert.ok(fs.existsSync(path.join(copy, made.json.name)), 'a second copy was made');
  assert.equal((await call(srv, 'GET', '/api/system', undefined, tok)).json.backups.find((b) => b.name === made.json.name).encrypted, true);
  await call(srv, 'POST', '/api/settings', { name: 'Anders' }, tok);
  assert.equal((await call(srv, 'POST', '/api/system/backups/restore', { name: made.json.name, password: 'fout' }, tok)).status, 400, 'wrong password');
  assert.equal((await call(srv, 'POST', '/api/system/backups/restore', { name: made.json.name, password: 'Back-up-wachtwoord-1' }, tok)).status, 200);
  assert.equal((await call(srv, 'GET', '/api/state')).json.settings.name, 'Zichtbare-naam-in-test', 'restored');
  // restart
  const exited = new Promise((r) => srv.child.once('exit', r));
  assert.equal((await call(srv, 'POST', '/api/system/restart', {}, tok)).status, 200);
  const code = await Promise.race([exited, sleep(4000).then(() => 'still running')]);
  assert.equal(code, 0, 'the server stopped by itself (a supervisor starts it again)');
});

test('the security check gives a score with a plain explanation, and errors say what to do next', async (t) => {
  const srv = await startServer({ patch: true });
  t.after(() => srv.stop());
  const tok = await login(srv);
  const sc = (await call(srv, 'GET', '/api/admin-state', undefined, tok)).json.security;
  assert.ok(sc.score >= 0 && sc.score <= 100);
  const by = Object.fromEntries(sc.items.map((i) => [i.id, i]));
  assert.equal(by.twoStep.ok, false); assert.ok(by.twoStep.tip.length > 10);
  assert.equal(by.rateLimit.ok, true); assert.equal(by.secrets.ok, true); assert.equal(by.audit.ok, true);
  assert.equal(by.https.ok, false);
  assert.equal((await call(srv, 'POST', '/api/security/fix', { id: 'rateLimit' }, tok)).status, 200);
  assert.equal((await call(srv, 'POST', '/api/security/fix', { id: 'twoStep' }, tok)).status, 400, 'what cannot be fixed with one tap says where to go');
  const noLogin = await call(srv, 'GET', '/api/admin-state');
  assert.equal(noLogin.status, 401); assert.match(noLogin.json.hint, /opnieuw/i);
});
