'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { answerFor, questions, labels } = require('../mdns.js');

const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16BE(n); return b; };
const query = (name, type, qu = false) => Buffer.concat([u16(0x1234), u16(0), u16(1), u16(0), u16(0), u16(0), labels(name), u16(type), u16(qu ? 0x8001 : 1)]);

test('a question about our name gets the address', () => {
  const q = query('saga-deur.local', 1);
  assert.deepEqual(questions(q).map((x) => [x.name, x.type]), [['saga-deur.local', 1]]);
  const a = answerFor(q, ['saga-deur.local'], ['192.168.2.41'], false);
  assert.ok(a);
  assert.equal(a.readUInt16BE(2), 0x8400, 'a response that is authoritative');
  assert.equal(a.readUInt16BE(6), 1, 'one answer');
  assert.deepEqual([...a.subarray(a.length - 4)], [192, 168, 2, 41]);
  assert.ok(a.includes(labels('saga-deur.local')));
});
test('the name is matched without regard to capitals, other names and answers are ignored', () => {
  assert.ok(answerFor(query('SAGA-Deur.LOCAL', 1), ['saga-deur.local'], ['10.0.0.5'], false));
  assert.equal(answerFor(query('printer.local', 1), ['saga-deur.local'], ['10.0.0.5'], false), null);
  const response = Buffer.from(query('saga-deur.local', 1)); response.writeUInt16BE(0x8400, 2);
  assert.equal(answerFor(response, ['saga-deur.local'], ['10.0.0.5'], false), null, 'we do not answer answers');
});
test('IPv6 questions get a "no such record" so the computer does not wait', () => {
  const a = answerFor(query('saga-deur.local', 28), ['saga-deur.local'], ['10.0.0.5'], false);
  assert.ok(a);
  assert.equal(a.readUInt16BE(a.indexOf(labels('saga-deur.local')) + labels('saga-deur.local').length), 47);
});
test('an old-style question gets the same id back; broken data does not crash', () => {
  const a = answerFor(query('saga-deur.local', 1), ['saga-deur.local'], ['10.0.0.5'], true);
  assert.equal(a.readUInt16BE(0), 0x1234);
  assert.deepEqual(questions(Buffer.from([1, 2, 3])), []);
  assert.deepEqual(questions(Buffer.alloc(40, 0xff)), []);
});

test('when avahi already answers for IPv6, only the IPv4 address is answered here', () => {
  assert.equal(answerFor(query('saga-deur.local', 28), ['saga-deur.local'], ['10.0.0.5'], false, false), null);
  assert.ok(answerFor(query('saga-deur.local', 1), ['saga-deur.local'], ['10.0.0.5'], false, false));
});
