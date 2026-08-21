#!/usr/bin/env node
/**
 * Draws the app icons.
 *
 * Hand-rolled rather than pulled from a graphics library: the mark is a flat
 * two-tone shape — the anodised blue and red an AN fitting comes in — so a
 * pixel buffer and node's own zlib are enough, and the project keeps its
 * dependency list to React and Vite.
 *
 *   node scripts/make-icons.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public', 'icons');

const BLUE = [30, 111, 217];
const RED = [207, 58, 47];
const DARK = [15, 18, 22];
const WHITE = [255, 255, 255];

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([length, typeAndData, crc]);
}

/** @param {Uint8Array} rgba @param {number} size */
function encodePng(rgba, size) {
  const stride = size * 4;
  // One filter byte (0 = none) in front of every scanline.
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(rgba.buffer, y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * The mark: a hex-nut silhouette — the shape every AN fitting is tightened by —
 * split diagonally into anodised blue and red, with the bore knocked out.
 *
 * @param {number} size
 * @param {boolean} maskable leaves the safe-area padding Android expects
 */
function drawIcon(size, maskable) {
  const px = new Uint8Array(size * size * 4);
  const cx = size / 2;
  const cy = size / 2;
  // Maskable icons get cropped to a circle inscribed in the middle 80%.
  const outer = size * (maskable ? 0.34 : 0.44);
  const bore = outer * 0.42;

  const set = (i, [r, g, b], a = 255) => {
    px[i] = r;
    px[i + 1] = g;
    px[i + 2] = b;
    px[i + 3] = a;
  };

  // Distance from centre to the edge of a regular hexagon at angle `theta`.
  const hexRadius = (theta) => {
    const a = ((theta % (Math.PI / 3)) + Math.PI / 3) % (Math.PI / 3);
    return Math.cos(Math.PI / 6) / Math.cos(a - Math.PI / 6);
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const dist = Math.hypot(dx, dy);
      const theta = Math.atan2(dy, dx);

      set(i, DARK, maskable ? 255 : 0);

      const edge = outer * hexRadius(theta);
      if (dist > edge) continue;
      if (dist < bore) {
        set(i, DARK, 255);
        continue;
      }

      // Split on the leading diagonal, the way two-tone fittings are sold.
      set(i, dx + dy < 0 ? BLUE : RED, 255);
    }
  }

  // A light chamfer on the bore so the mark reads at 48px.
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dist = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      if (dist > bore && dist < bore + Math.max(1, size * 0.012)) {
        const i = (y * size + x) * 4;
        if (px[i + 3] === 255) set(i, WHITE, 200);
      }
    }
  }

  return encodePng(px, size);
}

fs.mkdirSync(OUT, { recursive: true });
const written = [
  ['icon-192.png', drawIcon(192, false)],
  ['icon-512.png', drawIcon(512, false)],
  ['icon-maskable-512.png', drawIcon(512, true)],
];
for (const [name, buffer] of written) {
  fs.writeFileSync(path.join(OUT, name), buffer);
  console.log(`${name}  ${(buffer.length / 1024).toFixed(1)} kB`);
}
