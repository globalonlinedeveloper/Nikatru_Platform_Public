#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// make-assets.mjs — how the two binary assets in this example were produced.
//
// Committed so the bytes are ACCOUNTABLE. This repository must be able to say,
// for every asset it ships, where it came from — and "a 1×1 image I found" is
// exactly the answer tooling/legal/asset-register.json exists to refuse.
//
// Both files are container structure and nothing else. Their contract in this
// pipeline is magic bytes and extension agreement (src/formats.mjs), so what
// matters is that the headers are real and that no third party owns them.
//
// Run:  node tooling/content_pipeline/examples/lingo-phrases/make-assets.mjs
// It is idempotent and writes only under this directory's assets/.
// ─────────────────────────────────────────────────────────────────────────────
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ASSETS = join(HERE, 'assets');

// ── badge/streak.webp — a minimal LOSSLESS WebP ──────────────────────────────
// RIFF container: "RIFF" <u32 payload size> "WEBP" then one chunk.
// The chunk is "VP8L" (lossless), whose payload begins with the 0x2F signature
// byte followed by the packed 14-bit width-1 / 14-bit height-1 / alpha / version
// bits. A 1×1 image with alpha, then a single literal pixel emitted with the
// simple-code path, is the smallest legal VP8L bitstream.
const vp8l = Buffer.from([
  0x2f, // VP8L signature
  0x00, 0x00, 0x00, 0x10, // width-1 = 0, height-1 = 0, alpha_is_used = 1, version = 0
  0x07, 0x10, 0x11, 0x11, 0x88, 0x88, 0xfe, 0x07, 0x00, // one literal ARGB pixel, simple codes
]);
const webpChunk = Buffer.concat([
  Buffer.from('VP8L', 'latin1'),
  u32(vp8l.length),
  vp8l,
  vp8l.length % 2 ? Buffer.from([0]) : Buffer.alloc(0), // RIFF chunks are even-padded
]);
const webp = Buffer.concat([
  Buffer.from('RIFF', 'latin1'),
  u32(4 + webpChunk.length), // "WEBP" + the chunk
  Buffer.from('WEBP', 'latin1'),
  webpChunk,
]);

// ── tone/confirm.mp3 — one MPEG-1 Layer III frame ────────────────────────────
// Header bytes FF FB 90 64:
//   FF F.        11-bit frame sync
//   .B  = 1011   MPEG Version 1 (11) · Layer III (01) · no CRC (1)
//   90  = 1001.. bitrate index 9 -> 128 kbps ; ..00.. sampling 00 -> 44100 Hz ;
//                no padding, not private
//   64  = 01...  joint stereo ; .10.. mode extension ; not copyright ; original ;
//                no emphasis
// Frame length = 144 × 128000 / 44100 = 417 bytes (integer part), so the frame is
// the 4-byte header plus 413 bytes of payload. The payload is zeroed: this is a
// structurally valid frame carrying no audio, which is all the format allowlist
// asks of it.
const FRAME_BYTES = Math.floor((144 * 128000) / 44100); // 417
const mp3 = Buffer.concat([Buffer.from([0xff, 0xfb, 0x90, 0x64]), Buffer.alloc(FRAME_BYTES - 4)]);

function u32(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n);
  return b;
}

for (const [rel, bytes] of [
  ['badge/streak.webp', webp],
  ['tone/confirm.mp3', mp3],
]) {
  const dest = join(ASSETS, rel);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, bytes);
  console.log(`wrote assets/${rel} (${bytes.length} bytes)`);
}
