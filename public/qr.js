/* A small QR-code maker (no libraries). Text in, matrix or SVG out.
 * Byte mode, error correction level M, versions 1–10 (up to 213 characters) — plenty for a web address.
 * Follows ISO/IEC 18004; the steps are the usual ones: encode, add error correction, place, mask, add format information. */
(function (root) {
  'use strict';
  const ECC_PER_BLOCK = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];      // level M, index = version
  const BLOCKS = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];                       // level M, index = version
  const FORMAT_M = 0;                                                      // the two format bits for level M

  function rawModules(ver) {
    let n = (16 * ver + 128) * ver + 64;
    if (ver >= 2) { const a = Math.floor(ver / 7) + 2; n -= (25 * a - 10) * a - 55; if (ver >= 7) n -= 36; }
    return n;
  }
  const dataCodewords = (ver) => Math.floor(rawModules(ver) / 8) - ECC_PER_BLOCK[ver] * BLOCKS[ver];

  function gfMul(x, y) { let z = 0; for (let i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11d); z ^= ((y >>> i) & 1) * x; } return z; }
  function rsDivisor(degree) {
    const r = new Array(degree).fill(0); r[degree - 1] = 1;
    let root = 1;
    for (let i = 0; i < degree; i++) { for (let j = 0; j < r.length; j++) { r[j] = gfMul(r[j], root); if (j + 1 < r.length) r[j] ^= r[j + 1]; } root = gfMul(root, 2); }
    return r;
  }
  function rsRemainder(data, divisor) {
    const r = new Array(divisor.length).fill(0);
    for (const b of data) { const f = b ^ r.shift(); r.push(0); divisor.forEach((c, i) => { r[i] ^= gfMul(c, f); }); }
    return r;
  }

  function utf8(text) { return Array.from(new TextEncoder().encode(String(text))); }

  function encodeData(bytes, ver) {
    const bits = [];
    const put = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
    put(0b0100, 4); put(bytes.length, ver >= 10 ? 16 : 8);
    for (const b of bytes) put(b, 8);
    const cap = dataCodewords(ver) * 8;
    put(0, Math.min(4, cap - bits.length));
    while (bits.length % 8) bits.push(0);
    for (let pad = 0xec; bits.length < cap; pad ^= 0xec ^ 0x11) put(pad, 8);
    const out = [];
    for (let i = 0; i < bits.length; i += 8) { let v = 0; for (let j = 0; j < 8; j++) v = (v << 1) | bits[i + j]; out.push(v); }
    return out;
  }

  function interleave(data, ver) {
    const nb = BLOCKS[ver], eccLen = ECC_PER_BLOCK[ver], raw = Math.floor(rawModules(ver) / 8);
    const shortCount = nb - (raw % nb), shortLen = Math.floor(raw / nb);
    const div = rsDivisor(eccLen), blocks = [];
    for (let i = 0, k = 0; i < nb; i++) {
      const dat = data.slice(k, k + shortLen - eccLen + (i < shortCount ? 0 : 1)); k += dat.length;
      const ecc = rsRemainder(dat, div);
      if (i < shortCount) dat.push(0); // keeps the columns aligned; skipped again below
      blocks.push(dat.concat(ecc));
    }
    const out = [];
    for (let i = 0; i < blocks[0].length; i++) blocks.forEach((b, j) => { if (i !== shortLen - eccLen || j >= shortCount) out.push(b[i]); });
    return out;
  }

  function alignPositions(ver) {
    if (ver === 1) return [];
    const n = Math.floor(ver / 7) + 2, size = ver * 4 + 17;
    const step = Math.ceil((ver * 4 + 4) / (n * 2 - 2)) * 2;
    const res = [6];
    for (let pos = size - 7; res.length < n; pos -= step) res.splice(1, 0, pos);
    return res;
  }

  function build(codewords, ver, mask) {
    const size = ver * 4 + 17;
    const m = Array.from({ length: size }, () => new Array(size).fill(false));
    const fn = Array.from({ length: size }, () => new Array(size).fill(false));
    const set = (x, y, dark) => { m[y][x] = dark; fn[y][x] = true; };
    for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
    const finder = (cx, cy) => {
      for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
        const d = Math.max(Math.abs(dx), Math.abs(dy)), x = cx + dx, y = cy + dy;
        if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, d !== 2 && d !== 4);
      }
    };
    finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
    const ap = alignPositions(ver), na = ap.length;
    for (let i = 0; i < na; i++) for (let j = 0; j < na; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === na - 1) || (i === na - 1 && j === 0)) continue;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(ap[i] + dx, ap[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
    // format information (two copies) and the dark module
    const data = (FORMAT_M << 3) | mask;
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const fmt = ((data << 10) | rem) ^ 0x5412;
    const bit = (i) => ((fmt >>> i) & 1) !== 0;
    for (let i = 0; i <= 5; i++) set(8, i, bit(i));
    set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
    set(8, size - 8, true);
    if (ver >= 7) { // version information
      let r = ver;
      for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1f25);
      const v = (ver << 12) | r;
      for (let i = 0; i < 18; i++) { const b = ((v >>> i) & 1) !== 0, a = size - 11 + (i % 3), c = Math.floor(i / 3); set(a, c, b); set(c, a, b); }
    }
    // data, zigzag from the bottom right
    let i = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < size; vert++) for (let j = 0; j < 2; j++) {
        const x = right - j, up = ((right + 1) & 2) === 0, y = up ? size - 1 - vert : vert;
        if (!fn[y][x] && i < codewords.length * 8) { m[y][x] = ((codewords[i >>> 3] >>> (7 - (i & 7))) & 1) !== 0; i++; }
      }
    }
    // mask
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      if (fn[y][x]) continue;
      let inv;
      switch (mask) {
        case 0: inv = (x + y) % 2 === 0; break;
        case 1: inv = y % 2 === 0; break;
        case 2: inv = x % 3 === 0; break;
        case 3: inv = (x + y) % 3 === 0; break;
        case 4: inv = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
        case 5: inv = ((x * y) % 2) + ((x * y) % 3) === 0; break;
        case 6: inv = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0; break;
        default: inv = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
      }
      if (inv) m[y][x] = !m[y][x];
    }
    return m;
  }

  // lower is better: long runs, 2x2 blocks and an unbalanced dark/light ratio make a code harder to scan
  function penalty(m) {
    const size = m.length; let p = 0;
    for (let a = 0; a < size; a++) for (const get of [(i) => m[a][i], (i) => m[i][a]]) {
      let run = 1;
      for (let i = 1; i < size; i++) { if (get(i) === get(i - 1)) { run++; if (run === 5) p += 3; else if (run > 5) p += 1; } else run = 1; }
    }
    for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) if (m[y][x] === m[y][x + 1] && m[y][x] === m[y + 1][x] && m[y][x] === m[y + 1][x + 1]) p += 3;
    const dark = m.reduce((s, r) => s + r.filter(Boolean).length, 0);
    p += Math.floor(Math.abs(dark * 20 - size * size * 10) / (size * size)) * 10;
    return p;
  }

  function matrix(text) {
    const bytes = utf8(text);
    let ver = 1;
    while (ver <= 10 && dataCodewords(ver) * 8 < 4 + (ver >= 10 ? 16 : 8) + bytes.length * 8) ver++;
    if (ver > 10) throw new Error('De tekst is te lang voor een QR-code');
    const words = interleave(encodeData(bytes, ver), ver);
    let best = null, bestP = Infinity;
    for (let mask = 0; mask < 8; mask++) { const m = build(words, ver, mask); const p = penalty(m); if (p < bestP) { bestP = p; best = m; } }
    return best;
  }

  // an SVG with a white quiet zone of 4 modules (required for scanning); the dark colour can be changed
  function svg(text, { dark = '#000', light = '#fff', border = 4 } = {}) {
    const m = matrix(text), n = m.length + border * 2;
    let d = '';
    m.forEach((row, y) => { let x = 0; while (x < row.length) { if (!row[x]) { x++; continue; } let w = 1; while (x + w < row.length && row[x + w]) w++; d += `M${x + border} ${y + border}h${w}v1h-${w}z`; x += w; } });
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges"><rect width="${n}" height="${n}" fill="${light}"/><path d="${d}" fill="${dark}"/></svg>`;
  }

  const api = { matrix, svg };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.QR = api;
})(typeof window !== 'undefined' ? window : globalThis);
