// ─────────────────────────────────────────────────────────────────────────────
// png-codec.mjs — THE ONE PNG DECODER, for the two questions that need PIXELS.
//
// Most of this tree reads only a PNG HEADER (`chrome-raster.mjs`'s `pngHeader`,
// and the readers inside assert-launcher-icons / assert-listing-assets): width,
// height, colour type, alpha. That answers everything the stores state, and it
// is deliberately all those readers do.
//
// Two checks cannot be answered that way, and both are about what is IN the
// picture rather than how big it is:
//
//   · a Linux hicolor icon must BE the app's mark, not merely a correctly-sized
//     PNG — `render-linux-icons.mjs` derives it and the guard re-derives it;
//   · a store screenshot must not carry the "Demo data" banner — which is a band
//     of a known colour and cannot be read out of a header.
//
// 🔴 ONE MODULE, NOT TWO, BECAUSE THE FAILURE THIS REPO KEEPS PAYING FOR IS TWO
// READERS WITH TWO IDEAS OF WHAT A FILE IS. `assert-stamp-brand-assets.mjs` and
// `assert-launcher-icons.mjs` disagreed about where stock bytes live and one of
// them compared against empty buffers for weeks while printing a healthy count.
// A second PNG decoder would be that shape again: the one with the subtler bug
// is the one nobody looks at.
//
// ⚠️ STRICT ON PURPOSE. 8-bit truecolour (colour type 2 or 6), non-interlaced,
// is what every generator in this repository emits and what WebDriver hands
// back. Anything else THROWS rather than being approximated — a picture quietly
// decoded by a fallback path is a picture nobody checked, reported as checked.
// ─────────────────────────────────────────────────────────────────────────────
import { deflateSync, inflateSync } from 'node:zlib';

export const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Raised instead of returning a half-decoded image. Carries printable lines so
 *  a caller can report WHY it could not look, which must never read as "I
 *  looked and it was fine". */
export class PngUnreadable extends Error {
  constructor(lines) {
    super(lines[0]);
    this.lines = lines;
  }
}

/**
 * Decode to straight (non-premultiplied) RGBA.
 *
 * All five PNG row filters are implemented. A decoder that handled only filter 0
 * would return garbage for a file it "read" successfully, which is the worst
 * possible outcome here: every check downstream would then be measuring noise
 * and reporting a verdict about it.
 */
export function decodeRgba(buf) {
  if (buf.length < 8 || !PNG_SIG.every((v, i) => buf[i] === v)) {
    throw new PngUnreadable(['not a PNG (bad signature)']);
  }
  let off = 8;
  let width = 0;
  let height = 0;
  let depth = 0;
  let colourType = -1;
  let interlace = 0;
  const idat = [];
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      depth = data[8];
      colourType = data[9];
      interlace = data[12];
    }
    if (type === 'IDAT') idat.push(data);
    if (type === 'IEND') break;
    off += 12 + len;
  }
  if (!width || !height) throw new PngUnreadable(['PNG has no IHDR, or zero dimensions']);
  if (depth !== 8 || (colourType !== 2 && colourType !== 6) || interlace !== 0) {
    throw new PngUnreadable([
      `PNG is depth ${depth}, colour type ${colourType}, interlace ${interlace}.`,
      'Only 8-bit truecolour (2) or truecolour+alpha (6), non-interlaced, is decoded. Approximating anything',
      'else would produce a verdict about pixels this never actually read.',
    ]);
  }
  const channels = colourType === 6 ? 4 : 3;
  const stride = width * channels;
  const raw = inflateSync(Buffer.concat(idat));
  if (raw.length < (stride + 1) * height) {
    throw new PngUnreadable([`PNG IDAT is short: ${raw.length} bytes where ${(stride + 1) * height} are needed`]);
  }

  const out = Buffer.alloc(width * height * 4);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? line[i - channels] : 0;
      const b = prev[i];
      const c = i >= channels ? prev[i - channels] : 0;
      let v = line[i];
      switch (filter) {
        case 0:
          break;
        case 1:
          v = (v + a) & 0xff;
          break;
        case 2:
          v = (v + b) & 0xff;
          break;
        case 3:
          v = (v + ((a + b) >> 1)) & 0xff;
          break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff;
          break;
        }
        default:
          throw new PngUnreadable([`PNG row ${y} uses unknown filter type ${filter}`]);
      }
      line[i] = v;
    }
    for (let x = 0; x < width; x++) {
      const s = x * channels;
      const d = (y * width + x) * 4;
      out[d] = line[s];
      out[d + 1] = line[s + 1];
      out[d + 2] = line[s + 2];
      out[d + 3] = channels === 4 ? line[s + 3] : 0xff;
    }
    prev = line;
  }
  return { width, height, rgba: out };
}

const u32 = (v) => Buffer.from([(v >> 24) & 0xff, (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff]);

let crcTable = null;
function crc32(bytes) {
  if (crcTable === null) {
    crcTable = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c;
    }
  }
  let crc = -1;
  for (const b of bytes) crc = crcTable[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}

const chunk = (type, data) => {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  return Buffer.concat([u32(data.length), body, u32(crc32(body))]);
};

/**
 * Encode RGBA: one IDAT, filter 0 on every row.
 *
 * `opaque` writes colour type 2 (24-bit, no alpha channel) by dropping the alpha
 * bytes rather than compositing them. It exists because the two consumers want
 * opposite things and BOTH are requirements, not preferences: a Linux hicolor
 * icon must keep its transparency, and Google states "JPEG or 24-bit PNG (no
 * alpha)" for a Play screenshot. One shared default would be wrong for one of
 * them every time — the same trap `assert-listing-assets.mjs` already avoids by
 * checking each asset's alpha in the direction that asset declares.
 *
 * ⚠️ DROPPING, NOT COMPOSITING. Callers passing `opaque` are expected to hand
 * over pixels that are already opaque; a partially transparent input would lose
 * its blend silently. `tooling/store/chrome-raster.mjs`'s `flattenToOpaque` is
 * the one that composites, and it needs a rasteriser to do it correctly.
 */
export function encodeRgba({ width, height, rgba }, { opaque = false } = {}) {
  const ch = opaque ? 3 : 4;
  const stride = width * ch;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    if (opaque) {
      for (let x = 0; x < width; x++) {
        const s = (y * width + x) * 4;
        const d = y * (stride + 1) + 1 + x * 3;
        raw[d] = rgba[s];
        raw[d + 1] = rgba[s + 1];
        raw[d + 2] = rgba[s + 2];
      }
    } else {
      rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
    }
  }
  return Buffer.concat([
    Buffer.from(PNG_SIG),
    chunk('IHDR', Buffer.concat([u32(width), u32(height), Buffer.from([8, opaque ? 2 : 6, 0, 0, 0])])),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
