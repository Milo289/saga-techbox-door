'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers');
const { discover } = require('../discover.js');

test('a server can be found on the network without typing its address', async (t) => {
  const udp = 42000 + Math.floor(Math.random() * 2000);
  const srv = await startServer({ env: { DOOR_DISCOVERY_PORT: String(udp) } });
  t.after(() => srv.stop());
  const found = await discover({ address: '127.0.0.1', port: udp, timeout: 800 });
  assert.equal(found.length, 1);
  assert.equal(found[0].port, srv.port);
  assert.equal(found[0].host, '127.0.0.1');
  assert.equal(found[0].name, 'Saga Techbox');
  assert.match(found[0].version, /^\d+\.\d+\.\d+$/);
  assert.deepEqual(await discover({ address: '127.0.0.1', port: udp + 1, timeout: 400 }), [], 'nothing answers on another port');
});

test('discovery can be switched off', async (t) => {
  const udp = 44000 + Math.floor(Math.random() * 2000);
  const srv = await startServer({ env: { DOOR_DISCOVERY_PORT: String(udp), DOOR_DISCOVERY: 'off' } });
  t.after(() => srv.stop());
  assert.deepEqual(await discover({ address: '127.0.0.1', port: udp, timeout: 500 }), []);
});
