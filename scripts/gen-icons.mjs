// Generates PWA / apple-touch icons into public/. Run: node scripts/gen-icons.mjs
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
};

function png(size, px) {
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) px(x, y).forEach((v, i) => (raw[y * (size * 3 + 1) + 1 + x * 3 + i] = v));
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
// Shapes in a 100x100 design space: [x, y, w, h, radius, color]
const SHAPES = [
  [16, 20, 68, 64, 9, '#ffffff'],
  [16, 20, 68, 16, 9, '#e8590c'],
  [16, 29, 68, 7, 0, '#e8590c'],
  [24, 46, 14, 14, 3, '#3a3a3c'],
  [43, 46, 14, 14, 3, '#ffd400'],
  [62, 46, 14, 14, 3, '#3a3a3c'],
  [24, 64, 14, 14, 3, '#e8590c'],
  [43, 64, 14, 14, 3, '#3a3a3c'],
  [62, 64, 14, 14, 3, '#ffd400'],
];
const BG = hex('#1a73e8');

function inRound(u, v, [x, y, w, h, r]) {
  if (u < x || v < y || u >= x + w || v >= y + h) return false;
  const cx = Math.min(Math.max(u, x + r), x + w - r);
  const cy = Math.min(Math.max(v, y + r), y + h - r);
  return (u - cx) ** 2 + (v - cy) ** 2 <= r * r;
}

function icon(size, inset = 0) {
  const scale = (100 + inset * 2) / size;
  return png(size, (x, y) => {
    // 3x3 supersampling for smooth edges
    let acc = [0, 0, 0];
    for (let sy = 0; sy < 3; sy++)
      for (let sx = 0; sx < 3; sx++) {
        const u = (x + (sx + 0.5) / 3) * scale - inset;
        const v = (y + (sy + 0.5) / 3) * scale - inset;
        let col = BG;
        for (const s of SHAPES) if (inRound(u, v, s)) col = hex(s[5]);
        acc = acc.map((a, i) => a + col[i]);
      }
    return acc.map((a) => Math.round(a / 9));
  });
}

writeFileSync('public/apple-touch-icon.png', icon(180));
writeFileSync('public/icon-192.png', icon(192));
writeFileSync('public/icon-512.png', icon(512, 10)); // padding for maskable safe zone
console.log('icons written');
