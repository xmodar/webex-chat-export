// Draws the toolbar icon (chat bubble with a download arrow) as PNGs.
//   node tools/make-icons.js
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) raw.set(pixel(x, y), y * (size * 4 + 1) + 1 + x * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

// shape in unit coordinates (0..1), sampled 4x4 per pixel for anti-aliasing
function inBubble(u, v) {
  const r = 0.16, x0 = 0.06, x1 = 0.94, y0 = 0.08, y1 = 0.74;
  const cx = Math.min(Math.max(u, x0 + r), x1 - r), cy = Math.min(Math.max(v, y0 + r), y1 - r);
  const body = u >= x0 && u <= x1 && v >= y0 && v <= y1 && (u - cx) ** 2 + (v - cy) ** 2 <= r * r;
  const tail = v >= 0.7 && v <= 0.95 && u >= 0.2 && u <= 0.42 && u - 0.2 <= (0.95 - v) * 0.9;
  return body || tail;
}
function inArrow(u, v) {
  const stem = Math.abs(u - 0.5) <= 0.07 && v >= 0.2 && v <= 0.46;
  const head = v >= 0.4 && v <= 0.62 && Math.abs(u - 0.5) <= (0.62 - v) * 1.1;
  return stem || head;
}

const BLUE = [11, 107, 203], WHITE = [255, 255, 255];
const out = path.join(__dirname, "..", "extension", "icons");
fs.mkdirSync(out, { recursive: true });
for (const size of [16, 32, 48, 96, 128]) {
  const buf = png(size, (x, y) => {
    let b = 0, a = 0;
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
      const u = (x + (i + 0.5) / 4) / size, v = (y + (j + 0.5) / 4) / size;
      if (inBubble(u, v)) { b++; if (inArrow(u, v)) a++; }
    }
    const t = a / Math.max(b, 1);
    const rgb = BLUE.map((c, k) => Math.round(c * (1 - t) + WHITE[k] * t));
    return [...rgb, Math.round((b / 16) * 255)];
  });
  fs.writeFileSync(path.join(out, `icon-${size}.png`), buf);
}
console.log("icons written to", out);
