/* png.mjs — read and write 8-bit PNG, with no dependency and no browser.
   =====================================================================

   BUILD-TIME MODULE. NEVER SHIPPED.

   WHY THIS EXISTS WHEN TWO PNG MODULES ALREADY DO. Measured 2026-09-20 with a
   `find` over the tree for `png*.mjs`, excluding installed packages — and note
   that the exclusion pattern a reader would reach for cannot be written inside
   a block comment at all, because it contains the two characters that close
   one. Two modules answered:

     Extension/Full_Screen_Shot/test/e2e/png.mjs   decode only, and it lives
       inside the e2e ISLAND — the one directory in `extensions/` that is
       allowed a package.json and a node_modules (assert-extensions-build-free
       refuses one anywhere else). `scripts/` may not reach into it: a gate that
       imports out of a test island only runs where that island was installed.
     tooling/store/png-codec.mjs                   the PLATFORM repo's codec, on
       the other side of the extensions/ boundary, and owned by the Play lane.

   So this is the third PNG module in the tree and that is a cost stated rather
   than hidden. It is the smallest of the three on purpose: enough to read the
   committed icon and to write a listing asset at an exact size and an exact
   colour type, and nothing else.

   🔴 COLOUR TYPE IS THE WHOLE POINT, NOT AN INCIDENTAL. Chrome's 128x128 store
   icon is specified with "16 pixels per side ... transparent padding", which is
   unrepresentable in colour type 2; a promotional tile is a filled rectangle
   for which an alpha channel is dead weight. Getting it backwards produces a
   file that looks perfect in a viewer and is wrong in the listing, which is
   exactly the failure `tooling/store/render-play-graphics.mjs` records for
   Play's opposite pair. `encode()` therefore takes the colour type as a
   REQUIRED argument — there is no default to get wrong.

   Supports: bit depth 8, colour type 2 (RGB) and 6 (RGBA), non-interlaced.
   Anything else THROWS rather than guessing — a decoder that silently mangles
   a palette image would hand a renderer plausible-looking wrong pixels. */
import zlib from 'node:zlib';

const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/* CRC-32, the PNG flavour (IEEE 802.3, reflected). Built once. */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

/* ── the header alone, which is all a guard needs ─────────────────────────
   A guard that decoded every pixel to learn a width would be slower and would
   fail on a file it could not decode for a reason unrelated to its size. This
   reads the IHDR and nothing else, and it THROWS with the byte it objected to
   rather than returning a shape with zeroes in it. */
export function readHeader(buf) {
  if (buf.length < 33 || !buf.subarray(0, 8).equals(SIG)) {
    throw new Error('not a PNG (the 8-byte signature is absent)');
  }
  if (buf.toString('ascii', 12, 16) !== 'IHDR') {
    throw new Error('the first chunk is not IHDR, so this is not a well-formed PNG');
  }
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
    bitDepth: buf[24],
    colorType: buf[25],
    interlace: buf[28],
    bytes: buf.length,
  };
}

/* ── full decode, to RGBA regardless of the source colour type ───────────── */
export function decode(buf) {
  const h = readHeader(buf);
  if (h.bitDepth !== 8) throw new Error('bit depth ' + h.bitDepth + ' is unsupported; this module reads 8 only');
  if (h.colorType !== 2 && h.colorType !== 6) {
    throw new Error('colour type ' + h.colorType + ' is unsupported; this module reads 2 (RGB) and 6 (RGBA) only');
  }
  if (h.interlace !== 0) throw new Error('interlaced PNG is unsupported');

  const idat = [];
  let off = 8;
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    if (type === 'IDAT') idat.push(buf.subarray(off + 8, off + 8 + len));
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (!idat.length) throw new Error('the PNG carries no IDAT chunk, so it holds no pixels');

  const bpp = h.colorType === 6 ? 4 : 3;
  const stride = h.width * bpp;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  if (raw.length < (stride + 1) * h.height) {
    throw new Error('the inflated stream is ' + raw.length + ' bytes and ' +
      ((stride + 1) * h.height) + ' were needed for ' + h.width + 'x' + h.height);
  }
  const rgba = new Uint8ClampedArray(h.width * h.height * 4);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < h.height; y++) {
    const filter = raw[y * (stride + 1)];
    const row = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? row[x - bpp] : 0;
      const b = prev[x];
      const c = x >= bpp ? prev[x - bpp] : 0;
      let v = row[x];
      if (filter === 1) v = (v + a) & 255;
      else if (filter === 2) v = (v + b) & 255;
      else if (filter === 3) v = (v + ((a + b) >> 1)) & 255;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
      } else if (filter !== 0) throw new Error('unknown PNG row filter ' + filter + ' on row ' + y);
      row[x] = v;
    }
    for (let x = 0; x < h.width; x++) {
      const s = x * bpp, d = (y * h.width + x) * 4;
      rgba[d] = row[s]; rgba[d + 1] = row[s + 1]; rgba[d + 2] = row[s + 2];
      rgba[d + 3] = bpp === 4 ? row[s + 3] : 255;
    }
    prev = row;
  }
  return { width: h.width, height: h.height, rgba };
}

/* ── encode, at a colour type the caller NAMES ────────────────────────────
   Every row is written with filter 0. A filter heuristic would shrink the file
   and would make the output depend on the heuristic's tie-breaks; these assets
   are tens of kilobytes and the store's only size limit that anybody could
   source is Play's 1024 KB, which is two orders away. Determinism is worth more
   here than bytes: `--check` in render-extension-graphics.mjs compares the
   DECODED PIXELS for that reason, but a stable encoder means the committed file
   also stops churning in every diff. */
export function encode({ width, height, rgba, colorType }) {
  if (colorType !== 2 && colorType !== 6) {
    throw new Error('encode() needs colorType 2 (RGB, no alpha) or 6 (RGBA); got ' + JSON.stringify(colorType));
  }
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error('encode() needs positive integer width/height; got ' + width + 'x' + height);
  }
  if (rgba.length !== width * height * 4) {
    throw new Error('encode() was given ' + rgba.length + ' RGBA bytes and ' +
      (width * height * 4) + ' were needed for ' + width + 'x' + height);
  }
  const bpp = colorType === 6 ? 4 : 3;
  const stride = width * bpp;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const base = y * (stride + 1);
    raw[base] = 0;
    for (let x = 0; x < width; x++) {
      const s = (y * width + x) * 4, d = base + 1 + x * bpp;
      raw[d] = rgba[s]; raw[d + 1] = rgba[s + 1]; raw[d + 2] = rgba[s + 2];
      if (bpp === 4) raw[d + 3] = rgba[s + 3];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = colorType; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    SIG,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ── area-average resample ────────────────────────────────────────────────
   Used for one job: the committed 128x128 icon down to the 96x96 artwork box
   Chrome asks for. 128 -> 96 is a ratio of 4:3, so no output pixel maps onto a
   whole number of input pixels and a nearest-neighbour shrink would drop every
   fourth column of a mark whose whole design is straight edges. Alpha is
   premultiplied before averaging and divided back out afterwards, because
   averaging colour and alpha independently is what produces a dark halo around
   a transparent edge. */
export function resample(src, sw, sh, dw, dh) {
  const out = new Uint8ClampedArray(dw * dh * 4);
  const xr = sw / dw, yr = sh / dh;
  for (let dy = 0; dy < dh; dy++) {
    const y0 = dy * yr, y1 = (dy + 1) * yr;
    for (let dx = 0; dx < dw; dx++) {
      const x0 = dx * xr, x1 = (dx + 1) * xr;
      let r = 0, g = 0, b = 0, a = 0, area = 0;
      for (let sy = Math.floor(y0); sy < Math.ceil(y1); sy++) {
        const fy = Math.min(y1, sy + 1) - Math.max(y0, sy);
        if (fy <= 0) continue;
        for (let sx = Math.floor(x0); sx < Math.ceil(x1); sx++) {
          const fx = Math.min(x1, sx + 1) - Math.max(x0, sx);
          if (fx <= 0) continue;
          const w = fx * fy, o = (sy * sw + sx) * 4, al = src[o + 3] / 255;
          r += src[o] * al * w; g += src[o + 1] * al * w; b += src[o + 2] * al * w;
          a += src[o + 3] * w; area += w;
        }
      }
      const d = (dy * dw + dx) * 4;
      const alpha = area ? a / area : 0;
      const un = alpha > 0 ? area * (alpha / 255) : 0;
      out[d] = un ? Math.round(r / un) : 0;
      out[d + 1] = un ? Math.round(g / un) : 0;
      out[d + 2] = un ? Math.round(b / un) : 0;
      out[d + 3] = Math.round(alpha);
    }
  }
  return out;
}
