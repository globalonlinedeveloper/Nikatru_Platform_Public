/* SPDX-License-Identifier: MPL-2.0
   core/dev/png.js — NODE-SIDE TEST HELPER. NEVER SHIPPED.

   core/dev/ is OUTSIDE the vendored surface, and that is a rule rather than an
   accident: vendoring copies core/v1/** only, no package allowlist may include
   dev/, and nothing inside an extension may require this file.

   PROMOTED, NOT WRITTEN. Source: Extension/Full_Screen_Shot/test/pixel-sim/png.js
   sha256 of that source at promotion: 663c2f0e21999a78559b53942fbbdef52d2a0e124d20f39e60aeb0e9b9238337
   Promoted 2026-08-14. Everything below this header is that file byte for byte;
   the header is the only addition.

   THE ORIGINAL IS STILL THERE, AND THAT IS DELIBERATE. FullShot's sims require
   it by relative path (test/pixel-sim/run.js and five *.node.js suites), and
   FullShot's import contract is zero file moves and zero source changes. So two
   copies exist today. The sha256 above is the whole defence against them
   drifting — there is no CI check on it yet — and re-pointing FullShot's sims
   at this copy is what removes the second one.

   Licence: core/ is MPL-2.0 (core/LICENSE), which is not the licence on the
   tree this came from. Both are the same copyright holder, which is what makes
   that possible; the copy still under Extension/Full_Screen_Shot/ keeps that
   tool's licence.

   Exports: encodePng(w, h, rgba). Depends on node:zlib only.
*/
/* Minimal PNG writer (8-bit RGBA, filter 0) — zero dependencies. */
'use strict';
const zlib = require('zlib');

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

/* data: Uint8ClampedArray|Buffer RGBA, length w*h*4 */
function encodePng(w, h, data) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const stride = w * 4;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    Buffer.from(data.buffer, data.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

module.exports = { encodePng };
