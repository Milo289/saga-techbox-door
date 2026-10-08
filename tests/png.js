const zlib = require('zlib'), fs = require('fs');
const crcT = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
module.exports = function writePng(file, m, scale = 10, border = 4) {
  const n = (m.length + border * 2) * scale, rows = [];
  for (let y = 0; y < n; y++) { const row = Buffer.alloc(n + 1, 255); row[0] = 0; for (let x = 0; x < n; x++) { const mx = Math.floor(x / scale) - border, my = Math.floor(y / scale) - border; if (mx >= 0 && my >= 0 && mx < m.length && my < m.length && m[my][mx]) row[x + 1] = 0; } rows.push(row); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(n, 0); ihdr.writeUInt32BE(n, 4); ihdr[8] = 8; ihdr[9] = 0;
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]));
};
