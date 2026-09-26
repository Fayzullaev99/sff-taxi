/* global require, process, console, Buffer */
/* eslint-disable @typescript-eslint/no-require-imports */
// Usage: node scripts/make-icons.cjs assets
// Generates the SFF Taxi app icons (taxi yellow #FFC400 with a black checker roof sign).
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const out = process.argv[2];

const table = [];
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  table[n] = c >>> 0;
}
function crc32(buf) {
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function png(size, pixel) {
  const stride = size * 4 + 1;
  const raw = Buffer.alloc(size * stride);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel((x + 0.5) / size, (y + 0.5) / size);
      const o = y * stride + 1 + x * 4;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
      raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const YELLOW = [0xff, 0xc4, 0x00, 255];
const INK = [0x11, 0x11, 0x11, 255];
const WHITE = [255, 255, 255, 255];
const CLEAR = [0, 0, 0, 0];

/** A taxi roof sign: rounded frame with a 2 x 5 checker, inside [x0,y0,x1,y1]. */
function sign(u, v, box, on, off, frame) {
  const [x0, y0, x1, y1] = box;
  if (u < x0 || u > x1 || v < y0 || v > y1) return null;
  const w = x1 - x0;
  const h = y1 - y0;
  const r = Math.min(w, h) * 0.22;
  const cx = Math.min(Math.max(u, x0 + r), x1 - r);
  const cy = Math.min(Math.max(v, y0 + r), y1 - r);
  if ((u - cx) ** 2 + (v - cy) ** 2 > r * r) return null;
  const border = Math.min(w, h) * 0.1;
  if (u - x0 < border || x1 - u < border || v - y0 < border || y1 - v < border) return frame;
  const iu = Math.floor(((u - x0 - border) / (w - 2 * border)) * 5);
  const iv = Math.floor(((v - y0 - border) / (h - 2 * border)) * 2);
  return (iu + iv) % 2 === 0 ? on : off;
}

const files = {
  'icon.png': [1024, (u, v) => sign(u, v, [0.18, 0.37, 0.82, 0.63], INK, YELLOW, INK) ?? YELLOW],
  'adaptive-icon.png': [
    1024,
    (u, v) => sign(u, v, [0.25, 0.4, 0.75, 0.6], INK, YELLOW, INK) ?? CLEAR,
  ],
  'splash-icon.png': [512, (u, v) => sign(u, v, [0.06, 0.3, 0.94, 0.7], INK, YELLOW, INK) ?? CLEAR],
  'notification-icon.png': [
    96,
    (u, v) => sign(u, v, [0.08, 0.3, 0.92, 0.7], WHITE, CLEAR, WHITE) ?? CLEAR,
  ],
};

for (const [name, [size, fn]] of Object.entries(files)) {
  fs.writeFileSync(path.join(out, name), png(size, fn));
  console.log(name, size);
}
