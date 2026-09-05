#!/usr/bin/env node
/* SKELETON — icon and store-asset generator. Real PNGs from two constants.

     node icons/make-icons.mjs             write icon16/32/48/128.png
     node icons/make-icons.mjs --check     read the four files back and print
                                           the dimensions parsed out of their
                                           IHDR, plus the content box of each
     node icons/make-icons.mjs --promo "My Tool"
                                           write the store's 440x280 promotional
                                           tile to publish/store/. Items without
                                           one rank poorly in browse. The text
                                           is optional and defaults to MARK.

   No dependencies, no node_modules, nothing downloaded: the PNG writer is the
   same 45-line encoder the reference implementation uses in its pixel sims
   (8-bit RGBA, filter 0, zlib from node's own standard library), and the letters
   come from a 5x7 bitmap font defined below. Everything is drawn at 4x and
   box-averaged down, which is where the smooth corners and edges come from.

   TO MAKE THIS YOUR TOOL'S ICON: change MARK and ACCENT. That is the whole job.
   Keep ACCENT in step with --accent in pages/common.css and BADGE_COLOR in
   background.js. */

import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* ================= PLACEHOLDER(icon) — the two constants ================= */
const MARK = 'SK';          // one or two characters: A-Z 0-9 (lowercase is upcased)
const ACCENT = '#4f46e5';   // background colour
const INK = '#ffffff';      // the mark's colour
/* ======================================================================== */

const SIZES = [16, 32, 48, 128];
const OUT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SS = 4;               // supersample factor -> antialiasing on the way down

/* TRANSPARENT PADDING, PER SIZE — and it is not a matter of taste.

   Chrome's own icon guidance for the Web Store is a 96x96 graphic centred in a
   128x128 canvas: 16px of transparent margin on every side, which is 0.125 of
   the tile. Every well-behaved item in the store grid is drawn to that, so an
   icon that fills its canvas edge to edge renders VISIBLY LARGER than all of
   its neighbours — in the grid, in the install prompt and in the extensions
   page. It comes back as a listing-quality note rather than a clean pass, and
   it is wrong in four places at once.

   The small sizes are a different job. A 16px toolbar icon has 256 pixels to
   work with and the browser already surrounds it with chrome; spending 4 of
   its 16 rows on margin makes the mark unreadable. So padding is a LOOKUP, not
   a constant, and the effective content box is printed in --check so the
   decision is visible rather than buried in arithmetic. */
const PAD = { 16: 0, 32: 0.0625, 48: 0.0833, 128: 0.125 };

/* ---------------- PNG writer (8-bit RGBA, filter 0) ---------------- */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function chunk(type, data) {
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
function encodePng(w, h, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;    // bit depth
  ihdr[9] = 6;    // colour type 6 = truecolour + alpha
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;   // deflate / adaptive filtering / no interlace
  const stride = w * 4;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0;   // per-scanline filter: none
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/* Read a PNG's own IHDR back — the proof that what was written is a PNG that
   says what we think it says. Used by --check and after every write. */
function readPngHeader(buf) {
  const sig = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
  for (let i = 0; i < 8; i++) if (buf[i] !== sig[i]) throw new Error('not a PNG (bad signature)');
  if (buf.toString('ascii', 12, 16) !== 'IHDR') throw new Error('not a PNG (no IHDR first)');
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
    bitDepth: buf[24],
    colorType: buf[25],
    bytes: buf.length
  };
}

/* ---------------- 5x7 bitmap font ---------------- */
const FONT = {
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  C: ['.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.'],
  D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  F: ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
  G: ['.###.', '#...#', '#....', '#.###', '#...#', '#...#', '.###.'],
  H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  I: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '#####'],
  J: ['..###', '...#.', '...#.', '...#.', '...#.', '#..#.', '.##..'],
  K: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  M: ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
  N: ['#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#', '#...#'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  Q: ['.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  V: ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  W: ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '##.##', '#...#'],
  X: ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
  Y: ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'],
  Z: ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'],
  0: ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'],
  1: ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  2: ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
  3: ['#####', '...#.', '..#..', '...#.', '....#', '#...#', '.###.'],
  4: ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
  5: ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
  6: ['..##.', '.#...', '#....', '####.', '#...#', '#...#', '.###.'],
  7: ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
  8: ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
  9: ['.###.', '#...#', '#...#', '.####', '....#', '...#.', '.##..'],
  '?': ['.###.', '#...#', '....#', '...#.', '..#..', '.....', '..#..']
};
const GLYPH_W = 5, GLYPH_H = 7, GAP = 1;

function glyphsFor(mark) {
  const chars = String(mark || '?').toUpperCase().slice(0, 2).split('');
  return chars.map(c => FONT[c] || FONT['?']);
}

/* ---------------- drawing ---------------- */
function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!m) throw new Error('ACCENT/INK must be #rrggbb, got: ' + hex);
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const mix = (a, b, t) => Math.round(a + (b - a) * t);

/* Inside a rounded square INSET BY `pad` supersampled pixels on every side?
   Both coordinates are in supersampled pixels. The inset is what produces the
   transparent margin the store expects; everything outside it stays alpha 0. */
function inRoundedSquare(x, y, size, radius, pad) {
  const p = pad || 0;
  const lo = p, hi = size - p;
  if (x < lo || x > hi || y < lo || y > hi) return false;
  const r = radius;
  const cx = Math.min(Math.max(x, lo + r), hi - r);
  const cy = Math.min(Math.max(y, lo + r), hi - r);
  const dx = x - cx, dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

function renderIcon(size, mark, accent, ink) {
  const [ar, ag, ab] = hexToRgb(accent);
  const [ir, ig, ib] = hexToRgb(ink);
  const S = size * SS;
  const big = new Uint8ClampedArray(S * S * 4);

  /* The CONTENT BOX: the tile minus its transparent margin. Everything below
     is measured against `box`, not against `S`, so the mark keeps exactly the
     same proportion of the visible square at every size — padding changes how
     big the tile is, never how big the letters are inside it. */
  const pad = Math.round(S * (PAD[size] == null ? 0 : PAD[size]));
  const box = S - pad * 2;

  const radius = Math.round(box * 0.22);
  const glyphs = glyphsFor(mark);
  const cols = glyphs.length * GLYPH_W + (glyphs.length - 1) * GAP;

  // Fit the mark inside the CONTENT BOX with generous margins, then centre it.
  const unit = Math.min((box * 0.70) / cols, (box * 0.52) / GLYPH_H);
  const textW = unit * cols, textH = unit * GLYPH_H;
  const textX = (S - textW) / 2;
  const textY = (S - textH) / 2;

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const o = (y * S + x) * 4;
      if (!inRoundedSquare(x + 0.5, y + 0.5, S, radius, pad)) continue;   // stays transparent
      // A whisper of a vertical gradient so the tile does not read as flat.
      const t = y / S;
      big[o] = mix(ar, Math.round(ar * 0.82), t);
      big[o + 1] = mix(ag, Math.round(ag * 0.82), t);
      big[o + 2] = mix(ab, Math.round(ab * 0.82), t);
      big[o + 3] = 255;

      const gx = (x + 0.5 - textX) / unit;
      const gy = (y + 0.5 - textY) / unit;
      if (gx < 0 || gy < 0 || gx >= cols || gy >= GLYPH_H) continue;
      const col = Math.floor(gx), row = Math.floor(gy);
      const gi = Math.floor(col / (GLYPH_W + GAP));
      const inGlyph = col - gi * (GLYPH_W + GAP);
      if (gi >= glyphs.length || inGlyph >= GLYPH_W) continue;       // the gap column
      if (glyphs[gi][row][inGlyph] !== '#') continue;
      big[o] = ir; big[o + 1] = ig; big[o + 2] = ib; big[o + 3] = 255;
    }
  }

  // Box-average SSxSS blocks down to the real size, premultiplied so that
  // transparent corners do not drag colour into the edge pixels.
  const out = new Uint8ClampedArray(size * size * 4);
  const n = SS * SS;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const o = (((y * SS + sy) * S) + (x * SS + sx)) * 4;
          const al = big[o + 3] / 255;
          r += big[o] * al; g += big[o + 1] * al; b += big[o + 2] * al; a += al;
        }
      }
      const o = (y * size + x) * 4;
      out[o] = a ? Math.round(r / a) : 0;
      out[o + 1] = a ? Math.round(g / a) : 0;
      out[o + 2] = a ? Math.round(b / a) : 0;
      out[o + 3] = Math.round((a / n) * 255);
    }
  }
  return out;
}

/* ---------------- the store's promo tile ----------------
   The Chrome Web Store's "small promotional tile" is 440x280, and it is not
   decoration: items without one rank poorly in browse, which is the difference
   between being findable and not. Edge and AMO want comparable artwork.

   It is generated here rather than made by hand for the same reason the icons
   are — an asset drawn once at v0.1 and never regenerated becomes a
   description-vs-behaviour mismatch by v1.2, which the store penalises
   specifically, and 67 of them is an afternoon of cropping in an image editor
   plus some number of upload rejections for being 436 pixels wide.

   The whole tile is drawn with the same PNG writer and the same 5x7 font: an
   opaque accent field (a promo tile must not be transparent — it is composited
   on white in one surface and on dark in another), the mark in a rounded
   square on the left, and the tool name to its right. */
const PROMO_W = 440, PROMO_H = 280;

function renderPromo(text, accent, ink) {
  const [ar, ag, ab] = hexToRgb(accent);
  const [ir, ig, ib] = hexToRgb(ink);
  const W = PROMO_W * SS, H = PROMO_H * SS;
  const big = new Uint8ClampedArray(W * H * 4);

  // Opaque background, with the same vertical fade the icons have.
  for (let y = 0; y < H; y++) {
    const t = y / H;
    const r = mix(ar, Math.round(ar * 0.78), t);
    const g = mix(ag, Math.round(ag * 0.78), t);
    const b = mix(ab, Math.round(ab * 0.78), t);
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4;
      big[o] = r; big[o + 1] = g; big[o + 2] = b; big[o + 3] = 255;
    }
  }

  const glyphs = glyphsFor(String(text || MARK).toUpperCase().slice(0, 22));
  const cols = glyphs.length * GLYPH_W + (glyphs.length - 1) * GAP;
  // Fit the wordmark across the middle, leaving a clear margin either side.
  const unit = Math.min((W * 0.80) / cols, (H * 0.22) / GLYPH_H);
  const textW = unit * cols, textH = unit * GLYPH_H;
  const textX = (W - textW) / 2, textY = (H - textH) / 2;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const gx = (x + 0.5 - textX) / unit;
      const gy = (y + 0.5 - textY) / unit;
      if (gx < 0 || gy < 0 || gx >= cols || gy >= GLYPH_H) continue;
      const col = Math.floor(gx), row = Math.floor(gy);
      const gi = Math.floor(col / (GLYPH_W + GAP));
      const inGlyph = col - gi * (GLYPH_W + GAP);
      if (gi >= glyphs.length || inGlyph >= GLYPH_W) continue;
      if (glyphs[gi][row][inGlyph] !== '#') continue;
      const o = (y * W + x) * 4;
      big[o] = ir; big[o + 1] = ig; big[o + 2] = ib; big[o + 3] = 255;
    }
  }

  // Box-average down, exactly as the icons do.
  const out = new Uint8ClampedArray(PROMO_W * PROMO_H * 4);
  const n = SS * SS;
  for (let y = 0; y < PROMO_H; y++) {
    for (let x = 0; x < PROMO_W; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const o = (((y * SS + sy) * W) + (x * SS + sx)) * 4;
          const al = big[o + 3] / 255;
          r += big[o] * al; g += big[o + 1] * al; b += big[o + 2] * al; a += al;
        }
      }
      const o = (y * PROMO_W + x) * 4;
      out[o] = a ? Math.round(r / a) : 0;
      out[o + 1] = a ? Math.round(g / a) : 0;
      out[o + 2] = a ? Math.round(b / a) : 0;
      out[o + 3] = Math.round((a / n) * 255);
    }
  }
  return out;
}

/* ---------------- main ---------------- */
function contentBox(size) {
  const pad = Math.round(size * (PAD[size] == null ? 0 : PAD[size]));
  return (size - pad * 2) + 'x' + (size - pad * 2) + ' in ' + size + 'x' + size;
}

function write() {
  const written = [];
  for (const size of SIZES) {
    const rgba = renderIcon(size, MARK, ACCENT, INK);
    const png = encodePng(size, size, rgba);
    const file = path.join(OUT_DIR, 'icon' + size + '.png');
    fs.writeFileSync(file, png);
    const hdr = readPngHeader(fs.readFileSync(file));   // read it back, always
    if (hdr.width !== size || hdr.height !== size) {
      throw new Error('wrote ' + file + ' but its IHDR says ' + hdr.width + 'x' + hdr.height);
    }
    written.push({ file: path.basename(file), box: contentBox(size), ...hdr });
  }
  return written;
}

function check() {
  return SIZES.map(size => {
    const file = path.join(OUT_DIR, 'icon' + size + '.png');
    const hdr = readPngHeader(fs.readFileSync(file));
    return { file: path.basename(file), expected: size + 'x' + size, box: contentBox(size), ...hdr };
  });
}

/* --promo writes into publish/store/, which is where every store asset lands
   and which is NEVER packaged (publish/ is on the packaging never-list). */
function promo() {
  const arg = process.argv[process.argv.indexOf('--promo') + 1];
  const text = (arg && arg[0] !== '-') ? arg : MARK;
  const dir = path.join(OUT_DIR, '..', 'publish', 'store');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'promo-tile-440x280.png');
  fs.writeFileSync(file, encodePng(PROMO_W, PROMO_H, renderPromo(text, ACCENT, INK)));
  const hdr = readPngHeader(fs.readFileSync(file));
  if (hdr.width !== PROMO_W || hdr.height !== PROMO_H) {
    throw new Error('wrote ' + file + ' but its IHDR says ' + hdr.width + 'x' + hdr.height);
  }
  return [{ file: 'publish/store/' + path.basename(file), expected: PROMO_W + 'x' + PROMO_H, box: 'opaque, no padding', ...hdr }];
}

const MODE = process.argv.includes('--promo') ? 'promo'
  : process.argv.includes('--check') ? 'check' : 'write';
const rows = MODE === 'promo' ? promo() : MODE === 'check' ? check() : write();
for (const r of rows) {
  console.log(r.file.padEnd(36) +
    String(r.width) + 'x' + String(r.height) +
    '  depth=' + r.bitDepth + ' colorType=' + r.colorType + ' (RGBA)' +
    '  ' + r.bytes + ' bytes' +
    '  content ' + r.box +
    (r.expected && r.expected !== r.width + 'x' + r.height ? '  MISMATCH, expected ' + r.expected : ''));
}
console.log(MODE === 'check' ? 'checked ' + rows.length + ' icons from ' + OUT_DIR
  : MODE === 'promo' ? 'wrote the 440x280 store promo tile'
  : 'wrote ' + rows.length + ' icons (mark "' + MARK.toUpperCase() + '", accent ' + ACCENT + ') to ' + OUT_DIR);
