'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const QR = require('../public/qr.js');
const writePng = require('./png.js');

const CASES = [
  'http://192.168.1.50:8080/visit',
  'https://deur-7f3k2q.trycloudflare.com/visit?from=qr&t=a-rather-long-address-to-need-a-bigger-code-version-0123456789',
  'Saga Techbox — één bezoekje ☺',
  'x'.repeat(150),
];

test('QR code: shape and svg', () => {
  const m = QR.matrix(CASES[0]);
  assert.equal(m.length, 29); // version 3
  assert.ok(m.every((r) => r.length === m.length));
  // the three big squares in the corners
  for (const [x, y] of [[0, 0], [m.length - 7, 0], [0, m.length - 7]]) {
    assert.ok(m[y][x] && m[y][x + 6] && m[y + 6][x] && m[y + 6][x + 6] && m[y + 3][x + 3]);
    assert.ok(!m[y + 1][x + 1] && !m[y + 5][x + 5]);
  }
  assert.match(QR.svg(CASES[0]), /^<svg [^>]*viewBox="0 0 37 37"/);
  assert.throws(() => QR.matrix('x'.repeat(300)), /te lang/);
});

const haveSwift = process.platform === 'darwin' && spawnSync('swift', ['--version']).status === 0;
test('QR code: the scanner on a Mac reads every version back', { skip: !haveSwift && 'needs the Swift scanner of macOS' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qr-'));
  const files = CASES.map((t, i) => { const f = path.join(dir, `c${i}.png`); writePng(f, QR.matrix(t)); return f; });
  const r = spawnSync('swift', [path.join(__dirname, 'decode-qr.swift'), ...files], { encoding: 'utf8', timeout: 180000 });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.stdout.trim().split('\n'), CASES);
});
