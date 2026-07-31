'use strict';

// Generates the PWA icons with zero image dependencies.
// Run: node tools/make-icons.js   (only needed if you change the mark)

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const NAVY = [31, 56, 100];
const NAVY_DEEP = [18, 32, 60];
const ORANGE = [255, 102, 0];
const WHITE = [255, 255, 255];

function crc32(buf) {
  let c;
  const table = crc32.table || (crc32.table = (() => {
    const t = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c;
    }
    return t;
  })());
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function writePng(file, size, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 2;   // colour type: truecolour
  const raw = Buffer.alloc(size * (size * 3 + 1));
  let o = 0;
  for (let y = 0; y < size; y++) {
    raw[o++] = 0; // no filter
    for (let x = 0; x < size; x++) {
      const p = (y * size + x) * 3;
      raw[o++] = pixels[p];
      raw[o++] = pixels[p + 1];
      raw[o++] = pixels[p + 2];
    }
  }
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  fs.writeFileSync(file, png);
  return png.length;
}

function draw(size, { radius, inset }) {
  const px = Buffer.alloc(size * size * 3);
  const put = (x, y, rgb, alpha = 1) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const p = (y * size + x) * 3;
    for (let i = 0; i < 3; i++) px[p + i] = Math.round(px[p + i] * (1 - alpha) + rgb[i] * alpha);
  };

  // Background: rounded square with a soft vertical gradient.
  const r = radius * size;
  for (let y = 0; y < size; y++) {
    const t = y / (size - 1);
    const bg = NAVY.map((c, i) => Math.round(c + (NAVY_DEEP[i] - c) * t));
    for (let x = 0; x < size; x++) {
      const dx = Math.max(r - x, x - (size - 1 - r), 0);
      const dy = Math.max(r - y, y - (size - 1 - r), 0);
      const dist = Math.hypot(dx, dy);
      const alpha = dist <= r ? 1 : Math.max(0, 1 - (dist - r));
      put(x, y, bg, alpha);
    }
  }

  // Mark: an "L" monogram over an orange baseline, kept inside the safe zone.
  const pad = inset * size;
  const box = size - pad * 2;
  const stroke = Math.round(box * 0.17);
  const top = Math.round(pad + box * 0.16);
  const bottom = Math.round(pad + box * 0.70);
  const left = Math.round(pad + box * 0.26);
  const footRight = Math.round(pad + box * 0.74);

  const rect = (x0, y0, x1, y1, rgb) => {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) put(x, y, rgb, 1);
  };

  rect(left, top, left + stroke, bottom, WHITE);              // vertical stroke
  rect(left, bottom - stroke, footRight, bottom, WHITE);      // foot
  const baseTop = Math.round(pad + box * 0.80);
  rect(left, baseTop, footRight, baseTop + Math.round(box * 0.10), ORANGE); // accent bar

  return px;
}

const out = path.join(__dirname, '..', 'public', 'icons');
fs.mkdirSync(out, { recursive: true });

const jobs = [
  ['icon-192.png', 192, { radius: 0.22, inset: 0.14 }],
  ['icon-512.png', 512, { radius: 0.22, inset: 0.14 }],
  ['maskable-512.png', 512, { radius: 0.5, inset: 0.24 }],
  ['apple-touch-icon.png', 180, { radius: 0.0001, inset: 0.16 }],
];

for (const [name, size, opts] of jobs) {
  const bytes = writePng(path.join(out, name), size, draw(size, opts));
  console.log(`${name.padEnd(22)} ${size}x${size}  ${bytes} bytes`);
}
