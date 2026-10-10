const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const C = { x: -0.015, y: 0.085 };
const R = 0.205;
const APEX = { x: 0.085, y: -0.33 };
const CORE = { x: -0.015, y: 0.1, r: 0.078 };

const dx = APEX.x - C.x;
const dy = APEX.y - C.y;
const dist = Math.hypot(dx, dy);
const base = Math.atan2(dy, dx);
const spread = Math.acos(R / dist);
const T1 = { x: C.x + R * Math.cos(base + spread), y: C.y + R * Math.sin(base + spread) };
const T2 = { x: C.x + R * Math.cos(base - spread), y: C.y + R * Math.sin(base - spread) };

const side = (p, a, b) => (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
function inTriangle(p, a, b, c) {
  const d1 = side(p, a, b);
  const d2 = side(p, b, c);
  const d3 = side(p, c, a);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
}
const inDrop = (p) => Math.hypot(p.x - C.x, p.y - C.y) <= R || inTriangle(p, APEX, T1, T2);
const inCore = (p) => Math.hypot(p.x - CORE.x, p.y - CORE.y) <= CORE.r;
function inPlate(p) {
  const r = 0.225;
  const qx = Math.abs(p.x) - (0.5 - r);
  const qy = Math.abs(p.y) - (0.5 - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) <= r;
}
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

function colorAt(p) {
  if (!inPlate(p)) return [0, 0, 0, 0];
  const t = p.y + 0.5;
  const plate = mix([36, 31, 27], [14, 13, 12], t);
  if (inDrop(p) && !inCore(p)) {
    const g = Math.min(1, Math.max(0, (p.y - APEX.y) / (C.y + R - APEX.y)));
    return [...mix([255, 190, 84], [255, 84, 28], g), 255];
  }
  return [...plate, 255];
}

function render(size) {
  const ss = 4;
  const px = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0,
        g = 0,
        b = 0,
        a = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const c = colorAt({ x: (x + (sx + 0.5) / ss) / size - 0.5, y: (y + (sy + 0.5) / ss) / size - 0.5 });
          r += c[0] * c[3];
          g += c[1] * c[3];
          b += c[2] * c[3];
          a += c[3];
        }
      }
      const i = (y * size + x) * 4;
      px[i] = a ? Math.round(r / a) : 0;
      px[i + 1] = a ? Math.round(g / a) : 0;
      px[i + 2] = a ? Math.round(b / a) : 0;
      px[i + 3] = Math.round(a / (ss * ss));
    }
  }
  return px;
}

function png(size) {
  const px = render(size);
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(zlib.crc32(body) >>> 0, body.length + 4);
    return out;
  };
  const head = Buffer.alloc(13);
  head.writeUInt32BE(size, 0);
  head.writeUInt32BE(size, 4);
  head.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', head),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function ico(sizes) {
  const images = sizes.map(png);
  const head = Buffer.alloc(6 + 16 * sizes.length);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(sizes.length, 4);
  let offset = head.length;
  sizes.forEach((s, i) => {
    const e = 6 + i * 16;
    head[e] = s === 256 ? 0 : s;
    head[e + 1] = s === 256 ? 0 : s;
    head.writeUInt16LE(1, e + 4);
    head.writeUInt16LE(32, e + 6);
    head.writeUInt32LE(images[i].length, e + 8);
    head.writeUInt32LE(offset, e + 12);
    offset += images[i].length;
  });
  return Buffer.concat([head, ...images]);
}

const root = path.join(__dirname, '..');
fs.mkdirSync(path.join(root, 'build'), { recursive: true });
fs.writeFileSync(path.join(root, 'build', 'icon.ico'), ico([16, 24, 32, 48, 64, 128, 256]));
fs.writeFileSync(path.join(root, 'build', 'icon.png'), png(512));
fs.writeFileSync(path.join(root, 'ui', 'icon.png'), png(128));
console.log('icon written');
