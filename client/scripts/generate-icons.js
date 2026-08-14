// Generates the PWA icons with no image dependencies: raw pixels, zlib, PNG.
// Run with: npm run icons (the build script runs it automatically).

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, '..', 'public', 'icons');

const BG = [13, 13, 13];
const RING = [57, 135, 229]; // series blue, dark step
const CHEVRON = [255, 255, 255];

function crc32(buf) {
  let c;
  const table = [];
  for (let n = 0; n < 256; n += 1) {
    c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePng(size, pixels) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolor
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const raw = Buffer.alloc(size * (size * 3 + 1));
  let p = 0;
  for (let y = 0; y < size; y += 1) {
    raw[p] = 0; // no filter
    p += 1;
    for (let x = 0; x < size; x += 1) {
      const idx = (y * size + x) * 3;
      raw[p] = pixels[idx];
      raw[p + 1] = pixels[idx + 1];
      raw[p + 2] = pixels[idx + 2];
      p += 3;
    }
  }

  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function mix(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

// A ring with an upward chevron inside: progress plus forward movement.
function draw(size, { padding = 0.12 } = {}) {
  const pixels = Buffer.alloc(size * size * 3);
  const cx = (size - 1) / 2;
  const cy = (size - 1) / 2;
  const outer = size * (0.5 - padding);
  const inner = outer * 0.78;
  const chevronHalf = outer * 0.42;
  const chevronThickness = size * 0.075;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);

      let color = BG;

      // Ring, with a gap at the bottom so it reads as a progress arc.
      const angle = Math.atan2(dy, dx); // -pi..pi, positive is down
      const inGap = angle > 0.55 * Math.PI || angle < -0.95 * Math.PI;
      if (dist <= outer && dist >= inner && !inGap) {
        const edge = Math.min(dist - inner, outer - dist);
        color = mix(BG, RING, Math.min(1, edge / 1.5 + 0.35));
      }

      // Chevron pointing up: two arms meeting at the top center.
      const armY = -chevronHalf * 0.35;
      const t = Math.abs(dx) / chevronHalf;
      if (t <= 1) {
        const targetY = armY + t * chevronHalf * 0.85;
        if (Math.abs(dy - targetY) <= chevronThickness / 2) {
          color = CHEVRON;
        }
      }

      const idx = (y * size + x) * 3;
      pixels[idx] = color[0];
      pixels[idx + 1] = color[1];
      pixels[idx + 2] = color[2];
    }
  }
  return pixels;
}

fs.mkdirSync(outDir, { recursive: true });

const targets = [
  { name: 'icon-192.png', size: 192, padding: 0.12 },
  { name: 'icon-512.png', size: 512, padding: 0.12 },
  { name: 'apple-touch-icon.png', size: 180, padding: 0.1 },
  // Maskable icons need extra room so the safe zone is never clipped.
  { name: 'maskable-512.png', size: 512, padding: 0.22 },
];

for (const target of targets) {
  const png = encodePng(target.size, draw(target.size, { padding: target.padding }));
  fs.writeFileSync(path.join(outDir, target.name), png);
  console.log(`Wrote ${target.name} (${target.size}x${target.size}, ${png.length} bytes)`);
}
