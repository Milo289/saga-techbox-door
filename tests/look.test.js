'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startServer, call, login } = require('./helpers');

test('the door screen look: standard values, wrong values are cleaned, every choice is accepted, the apps get the fields', async (t) => {
  const srv = await startServer({ patch: true, system: true, dir: fs.mkdtempSync(path.join(os.tmpdir(), 'look-')) });
  t.after(() => srv.stop());
  const a = await login(srv);
  const look = async () => (await call(srv, 'GET', '/api/state')).json.settings.look; // the door screen itself reads this
  const d = await look();
  assert.equal(d.mode, 'standard'); assert.equal(d.textScale, 100); assert.equal(d.motion, true); assert.equal(d.background, 'glow');
  // garbage becomes the standard, numbers are kept inside their range
  assert.equal((await call(srv, 'POST', '/api/settings', { look: { mode: 'hacked', font: '<script>', textScale: 9999, agenda: -4, ticker: { enabled: true, text: 'x'.repeat(500) }, idle: { enabled: true, minutes: 0 }, footer: 'f'.repeat(500) } }, a)).status, 200);
  const l = await look();
  assert.equal(l.mode, 'standard'); assert.equal(l.font, 'system'); assert.equal(l.textScale, 160); assert.equal(l.agenda, 0);
  assert.equal(l.ticker.text.length, 200); assert.equal(l.idle.minutes, 1); assert.equal(l.footer.length, 120); assert.equal(l.ticker.enabled, true);
  // every offered choice is accepted
  const choices = { mode: ['status', 'clock', 'agenda', 'strip', 'minimal'], font: ['rounded', 'serif', 'mono', 'readable'], weight: ['light', 'bold'], clock: ['analog', 'none'], date: ['short', 'long'], transition: ['none', 'fade', 'zoom'], cards: ['flat', 'outline', 'glass'], corners: ['sharp', 'soft'], background: ['plain', 'gradient', 'dots', 'aurora'], border: ['thin', 'thick', 'pulse'], icons: ['none'] };
  for (const [k, list] of Object.entries(choices)) for (const v of list) {
    await call(srv, 'POST', '/api/settings', { look: { [k]: v } }, a);
    assert.equal((await look())[k], v, `${k}=${v}`);
  }
  // the settings description (used by the apps) has the group, and saving through it works
  const sch = (await call(srv, 'GET', '/api/settings-schema', undefined, a)).json;
  const grp = sch.groups.find((g) => g.id === 'weergave');
  assert.ok(grp && grp.fields.length >= 20, 'at least twenty fields');
  const save = await call(srv, 'POST', '/api/settings-schema/save', { values: { 'look.mode': 'strip', 'look.textScale': 120, 'look.ticker.enabled': true, 'look.ticker.text': 'Hallo' } }, a);
  assert.equal(save.status, 200, save.text);
  const l2 = await look();
  assert.equal(l2.mode, 'strip'); assert.equal(l2.textScale, 120); assert.equal(l2.ticker.text, 'Hallo');
  assert.equal((await call(srv, 'POST', '/api/settings-schema/save', { values: { 'look.mode': 'niks' } }, a)).status, 400, 'a wrong choice is refused');
});

test('the door screen and the panel scripts are valid JavaScript and carry the new look parts', () => {
  for (const f of ['display.html', 'admin.html']) {
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');
    for (const m of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) assert.doesNotThrow(() => new Function(m[1]), f);
  }
  const door = fs.readFileSync(path.join(__dirname, '..', 'public', 'display.html'), 'utf8');
  for (const part of ['id="bigclock"', 'id="bar"', 'id="agenda"', 'id="ticker"', 'id="foot"', 'function applyLook', 'function paintClock', 'function paintSaver', 'data-mode="strip"'.replace('data-mode="strip"', '#app.strip')]) assert.ok(door.includes(part), part);
});
