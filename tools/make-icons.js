#!/usr/bin/env node
/* ══════════════════════════════════════════
   tools/make-icons.js — generate the PWA icons.

   Pure Node: rasterise into an RGBA buffer and encode a PNG with zlib, so
   the icons are reproducible from source with no image library and no
   binary blobs committed by hand.

   Run:  node tools/make-icons.js
   ══════════════════════════════════════════ */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const BG    = [0x0f, 0x1a, 0x2c];   // deep navy, matches --sidebar
const FROM  = [0x34, 0xc9, 0xb3];   // teal, matches --sidebar-accent
const TO    = [0x0a, 0x60, 0x6b];
const SS    = 3;                     // supersampling factor, for smooth edges

// ── Geometry helpers ────────────────────────────────────────────────
// Distance from point p to segment ab — the basis for round-capped strokes.
function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx, cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

// Signed distance to a rounded rectangle: negative inside.
function sdRoundRect(px, py, x, y, w, h, r) {
  const cx = Math.abs(px - (x + w / 2)) - (w / 2 - r);
  const cy = Math.abs(py - (y + h / 2)) - (h / 2 - r);
  const ax = Math.max(cx, 0), ay = Math.max(cy, 0);
  return Math.hypot(ax, ay) + Math.min(Math.max(cx, cy), 0) - r;
}

function render(size) {
  const S = size * SS;
  const buf = Buffer.alloc(S * S * 4);

  const pad = 0.1875 * S;            // 96/512
  const w   = S - pad * 2;
  const r   = 0.0898 * S;            // 46/512

  // Three checked rows, as fractions of the card.
  const rows = [0.32, 0.5, 0.68].map((f, i) => {
    const y = pad + w * f;
    return {
      check: [
        [pad + w * 0.16, y,             pad + w * 0.26, y + w * 0.08],
        [pad + w * 0.26, y + w * 0.08,  pad + w * 0.44, y - w * 0.10],
      ],
      rule: [pad + w * 0.56, y, pad + w * (i === 2 ? 0.74 : 0.86), y],
      checkW: 0.0254 * S / 2,        // 26/512 stroke, halved
      ruleW:  0.0215 * S / 2,        // 22/512
    };
  });

  for (let py = 0; py < S; py++) {
    for (let px = 0; px < S; px++) {
      const o = (py * S + px) * 4;
      let col = BG;

      if (sdRoundRect(px + 0.5, py + 0.5, pad, pad, w, w, r) < 0) {
        // Diagonal gradient across the card.
        const t = Math.min(1, Math.max(0, ((px - pad) + (py - pad)) / (2 * w)));
        col = [
          Math.round(FROM[0] + (TO[0] - FROM[0]) * t),
          Math.round(FROM[1] + (TO[1] - FROM[1]) * t),
          Math.round(FROM[2] + (TO[2] - FROM[2]) * t),
        ];

        // Punch the checklist back out in the background colour.
        for (const row of rows) {
          const onCheck = row.check.some(([ax, ay, bx, by]) =>
            distToSegment(px + 0.5, py + 0.5, ax, ay, bx, by) < row.checkW);
          const onRule = distToSegment(px + 0.5, py + 0.5, ...row.rule) < row.ruleW;
          if (onCheck || onRule) { col = BG; break; }
        }
      }

      buf[o] = col[0]; buf[o + 1] = col[1]; buf[o + 2] = col[2]; buf[o + 3] = 255;
    }
  }

  // Box-downsample the supersampled buffer to the target size.
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r0 = 0, g0 = 0, b0 = 0;
      for (let dy = 0; dy < SS; dy++) {
        for (let dx = 0; dx < SS; dx++) {
          const o = ((y * SS + dy) * S + (x * SS + dx)) * 4;
          r0 += buf[o]; g0 += buf[o + 1]; b0 += buf[o + 2];
        }
      }
      const n = SS * SS, o = (y * size + x) * 4;
      out[o] = Math.round(r0 / n);
      out[o + 1] = Math.round(g0 / n);
      out[o + 2] = Math.round(b0 / n);
      out[o + 3] = 255;
    }
  }
  return out;
}

// ── Minimal PNG encoder ─────────────────────────────────────────────
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
}

let CRC_TABLE = null;
function crc32(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c;
    }
  }
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return c ^ -1;
}

function encodePNG(rgba, size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;    // bit depth
  ihdr[9] = 6;    // colour type: RGBA
  // 10,11,12 = compression, filter, interlace — all 0

  // Each scanline is prefixed with filter type 0 (None).
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const dir = path.join(__dirname, '..', 'images');
fs.mkdirSync(dir, { recursive: true });
for (const size of [192, 512]) {
  const file = path.join(dir, 'icon-' + size + '.png');
  fs.writeFileSync(file, encodePNG(render(size), size));
  console.log('wrote', file, (fs.statSync(file).size / 1024).toFixed(1) + ' KB');
}
