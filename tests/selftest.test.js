'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { spawnSync } = require('child_process');

test('the self test (the program tries everything on a temporary copy) finds nothing wrong, and cleans up after itself', () => {
  const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'check-selftest.js'), '--json'], { encoding: 'utf8', timeout: 150000 });
  assert.equal(r.status, 0, (r.stderr || '') + (r.stdout || '').slice(-1500));
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.equal(out.bad, 0, JSON.stringify(out.results.filter((x) => x.state === 'bad')));
  assert.ok(out.ok >= 25, 'many checks ran: ' + out.ok);
  const twoStep = out.results.find((x) => /Tweestapsverificatie van begin tot eind/.test(x.name));
  assert.equal(twoStep.state, 'ok', 'the two-step flow ran as the main account of the copy');
});
