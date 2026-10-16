'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, call, login, sleep } = require('./helpers');

const visit = async (srv, body) => { await sleep(1150); return call(srv, 'POST', '/api/visit', body); };
const setForm = (srv, tok, values) => call(srv, 'POST', '/api/form-settings', { values }, tok);

test('the visitor form: defaults stay as they were, and the admin can make things compulsory per button', async (t) => {
  const srv = await startServer({ patch: true });
  t.after(() => srv.stop());
  const tok = await login(srv);
  await call(srv, 'POST', '/api/settings', { visitors: { reasons: false, doorbell: true, bellWhenBlocked: false, appointments: true, messages: true, callback: true } }, tok); // the callback button is off by default

  await t.test('defaults', async () => {
    assert.equal((await visit(srv, { type: 'bell' })).status, 200, 'one tap, no name');
    assert.equal((await visit(srv, { type: 'callback', phone: '0612345678' })).status, 400, 'a callback needs a name');
    assert.equal((await visit(srv, { type: 'callback', name: 'Sam', phone: '0612345678' })).status, 200);
    assert.equal((await visit(srv, { type: 'appointment', at: Date.now() + 36e5 * 5 })).status, 400, 'an appointment needs a name');
  });

  await t.test('the description of the settings is sent to the apps', async () => {
    const r = await call(srv, 'GET', '/api/form-schema', undefined, tok);
    assert.equal(r.status, 200);
    const keys = r.json.groups.flatMap((g) => g.fields.map((f) => f.key));
    for (const k of ['form.name.bell', 'form.email.message', 'form.phone.callback', 'form.consent', 'form.maxMessageLength', 'form.thanksText']) assert.ok(keys.includes(k), k);
    const f = r.json.groups[0].fields.find((x) => x.key === 'form.name.bell');
    assert.equal(f.value, 'hidden'); assert.ok(f.options.length >= 3);
  });

  await t.test('a name is compulsory for the doorbell', async () => {
    assert.equal((await setForm(srv, tok, { 'form.name.bell': 'required', 'form.bellCooldownSec': 5 })).status, 200);
    await sleep(5200); // the bell of the first test has to be over
    const no = await visit(srv, { type: 'bell' });
    assert.equal(no.status, 400); assert.match(no.text, /naam/i);
    assert.equal((await call(srv, 'GET', '/api/state')).json.settings.form.name.bell, 'required', 'the door screen gets the rule');
  });

  await t.test('an e-mail address is compulsory for a question', async () => {
    await setForm(srv, tok, { 'form.email.message': 'required' });
    assert.equal((await visit(srv, { type: 'message', message: 'Hoi' })).status, 400);
    assert.equal((await visit(srv, { type: 'message', message: 'Hoi', email: 'geen-mail' })).status, 400);
    assert.equal((await visit(srv, { type: 'message', message: 'Hoi', email: 'sam@example.com' })).status, 200);
  });

  await t.test('consent has to be ticked when personal data is given', async () => {
    await setForm(srv, tok, { 'form.consent': true, 'form.email.message': 'optional' });
    assert.equal((await visit(srv, { type: 'message', message: 'Hoi', name: 'Sam' })).status, 400);
    assert.equal((await visit(srv, { type: 'message', message: 'Hoi', name: 'Sam', consent: true })).status, 200);
    assert.equal((await visit(srv, { type: 'message', message: 'Hoi anoniem' })).status, 200, 'nothing personal: nothing to agree to');
    await setForm(srv, tok, { 'form.consent': false });
  });

  await t.test('a message is cut at the chosen length', async () => {
    await setForm(srv, tok, { 'form.maxMessageLength': 60 });
    assert.equal((await visit(srv, { type: 'message', message: 'x'.repeat(200) })).status, 200);
    const st = (await call(srv, 'GET', '/api/admin-state', undefined, tok)).json;
    assert.equal(st.requests[0].message.length, 60);
  });

  await t.test('wrong values are refused or clamped', async () => {
    assert.equal((await setForm(srv, tok, { 'form.name.bell': 'banaan' })).status, 400);
    await setForm(srv, tok, { 'form.bellCooldownSec': 99999, 'form.visitCooldownSec': -5 });
    const f = (await call(srv, 'GET', '/api/state')).json.settings.form;
    assert.equal(f.bellCooldownSec, 600); assert.equal(f.visitCooldownSec, 1);
    // garbage through the general settings route is cleaned too
    await call(srv, 'POST', '/api/settings', { form: { name: { bell: 'xxx' }, maxMessageLength: 'abc' } }, tok);
    const g = (await call(srv, 'GET', '/api/state')).json.settings.form;
    assert.equal(g.name.bell, 'hidden'); assert.equal(g.maxMessageLength, 500);
  });
});

test('only people who may change settings can change the visitor form', async (t) => {
  const srv = await startServer({ patch: true });
  t.after(() => srv.stop());
  const tok = await login(srv);
  await call(srv, 'POST', '/api/users/save', { username: 'kijker1', name: 'Kijker', role: 'kijker', password: 'Zeer-goed-wachtwoord-77' }, tok);
  const vt = (await call(srv, 'POST', '/api/login', { username: 'kijker1', password: 'Zeer-goed-wachtwoord-77' })).json.token;
  assert.equal((await setForm(srv, vt, { 'form.consent': true })).status, 403);
  assert.equal((await call(srv, 'GET', '/api/form-schema', undefined, vt)).status, 403);
});

test('a logged-in device can log in another one with a one-time code', async (t) => {
  const srv = await startServer({ patch: true });
  t.after(() => srv.stop());
  const tok = await login(srv);
  assert.equal((await call(srv, 'POST', '/api/login/ticket', {})).status, 401, 'not without being logged in');
  const t1 = (await call(srv, 'POST', '/api/login/ticket', {}, tok)).json;
  assert.match(t1.ticket, /^[0-9a-f]{32}$/); assert.equal(t1.expiresIn, 120);
  const use = await call(srv, 'POST', '/api/login/ticket/use', { ticket: t1.ticket });
  assert.equal(use.status, 200, use.text);
  assert.match(use.json.token, /^s_/);
  assert.equal((await call(srv, 'GET', '/api/me', undefined, use.json.token)).status, 200, 'the new device is logged in');
  assert.equal((await call(srv, 'POST', '/api/login/ticket/use', { ticket: t1.ticket })).status, 401, 'a code works once');
  assert.equal((await call(srv, 'POST', '/api/login/ticket/use', { ticket: 'verzonnen' })).status, 401);
});
