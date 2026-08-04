#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-stamp-brand-assets.mjs — a stamped app carries ITS brand, not Flutter's.
//
// [pipeline S-14] company/pipeline/03-stamper.md
//
// WHY. Measured 2026-07-29: every one of the five icons the brick stamped was
// BYTE-IDENTICAL to stock `flutter create` output. DoD §4-G already records the
// same defect in the shipped app ("Subly ships default Flutter icon"), and in the
// TEMPLATE it is worse — it is not one app with the wrong icon, it is every app
// the factory will ever stamp, born wrong, and store reviewers see it first.
//
// ── THE COMPARISON IS AGAINST THE LIVE SDK, NOT PINNED HASHES ───────────────
// The obvious implementation is a list of known-bad sha256 values. It rots
// silently: Flutter changes its default assets, the pinned hashes stop matching
// anything, and the guard goes on reporting "ok" while stamping stock icons
// again — a scanner that quietly stopped scanning, which is this repo's single
// most repeated failure. Instead the stock bytes are read from the SDK that is
// building the app. That relationship cannot go stale, because it IS the thing
// being compared.
//
// 🔴 AND FOR TWO OF THE FIVE ASSETS IT HAD ALREADY STOPPED COMPARING — found
// 2026-08-04, while a sibling guard for the NATIVE icons was being written.
// This file used to read the template directory directly. Measured on the real
// Flutter 3.44.7 install that day:
//
//     favicon.png.copy.tmpl                917 bytes   real
//     icons/Icon-192.png.copy.tmpl        5292 bytes   real
//     icons/Icon-512.png.copy.tmpl        8252 bytes   real
//     icons/Icon-maskable-192.png.img.tmpl   0 bytes   EMPTY
//     icons/Icon-maskable-512.png.img.tmpl   0 bytes   EMPTY
//
// EVERY `.img.tmpl` IN THE SDK IS A ZERO-BYTE PLACEHOLDER; the real bytes are
// overlaid from the `flutter_template_images` package at `create` time. So the
// two maskable comparisons were against an empty buffer — they could never have
// matched, whatever the stamp shipped — while this guard printed
// `5 stock asset(s) compared` and exited 0. An assertion that cannot fail,
// inflating the count that made its coverage look real.
//
// 🔬 ITS SIX FIXTURE TESTS ALL PASSED THROUGHOUT, because the fixture writes
// REAL PNG BYTES into a file it names `.img.tmpl`. A fixture written by whoever
// wrote the guard encodes the same misunderstanding as the guard — this repo's
// own recorded rule, happening again. `flutter-stock-assets.mjs` is now the one
// place that knows about the overlay, and it REFUSES to return an empty stock
// asset at all, so neither guard can regain this hole independently.
//
// ⚠️ AND IT REFUSES TO RUN BLIND. If the SDK templates cannot be found, this
// exits COVERAGE LOST rather than skipping the comparison. "I could not check"
// must never be reported as "nothing was wrong" — which is why this guard runs
// in the `app_brick` lane (the one with Flutter on PATH) and not beside the
// other static guards.
//
// ── WHAT IS CHECKED, PER CLAIMED PLATFORM ───────────────────────────────────
//   1. every asset the platform requires EXISTS and is a real PNG (signature +
//      IHDR, so a 0-byte or truncated file cannot pass as "present");
//   2. none of them is byte-identical to the SDK's stock asset;
//   3. the icon's dominant colour is the spec's `seed_hex` — this is what makes
//      it the APP's brand rather than merely "not Flutter's". A guard that only
//      says "different from stock" is satisfied by a blank square.
//
// Usage:  node tooling/ci/assert-stamp-brand-assets.mjs <appDir> [--seed RRGGBB]
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { inflateSync } from 'node:zlib';
// ⚠️ NO `listDir` IMPORT ANY MORE, and that is deliberate rather than a
// leftover. This guard used to enumerate the SDK template directories itself;
// that walk now lives in flutter-stock-assets.mjs, which goes through `listDir`
// on this file's behalf. `assert-walks-bounded.mjs` R3 requires a file to import
// `listDir` IFF it calls it, so keeping a decorative import would fail the guard
// that keeps every directory listing bounded.
//
// The ONE answer to "what bytes does `flutter create` write for this asset?" —
// including the `flutter_template_images` overlay, without which the two
// maskable comparisons below range over empty buffers. See its header.
import { flutterSdkRoot, readStockAssets, StockAssetsUnavailable } from './flutter-stock-assets.mjs';

const args = process.argv.slice(2);
const appDir = resolve(args.find((a) => !a.startsWith('--')) ?? '.');
const seedIdx = args.indexOf('--seed');
const seedArg = seedIdx > -1 ? (args[seedIdx + 1] ?? '').replace('#', '').toLowerCase() : null;

/** The web asset set — the stamped path, which is ALSO the key
 *  `readStockAssets` returns for the SDK's counterpart. Deliberately explicit
 *  rather than globbed, because a glob over a missing directory finds nothing
 *  and reports success. */
const WEB_ASSETS = [
  'web/favicon.png',
  'web/icons/Icon-192.png',
  'web/icons/Icon-512.png',
  'web/icons/Icon-maskable-192.png',
  'web/icons/Icon-maskable-512.png',
];

function fail(lines) {
  for (const l of lines) console.error(l);
  process.exit(1);
}

// ── the SDK's stock bytes, overlay included ─────────────────────────────────
// Through the shared reader: it applies `flutter_template_images` over the SDK
// templates and THROWS rather than handing back a zero-byte placeholder. The
// two maskable assets are exactly the ones that need it — see this file's
// header for the measurement.
let stock;
try {
  stock = readStockAssets({
    sdkRoot: flutterSdkRoot(),
    relDir: 'web',
    // Keyed on the stamped path so the map keys match WEB_ASSETS directly.
    keep: (rel) => rel.endsWith('.png'),
  });
  stock = new Map([...stock].map(([k, v]) => [`web/${k}`, v]));
} catch (e) {
  if (!(e instanceof StockAssetsUnavailable)) throw e;
  fail([
    '✗ COVERAGE LOST — could not establish the Flutter SDK\'s stock web assets.',
    ...e.lines.map((l) => `  ${l}`),
    '  This guard compares the stamp against the SDK that builds it. Without those bytes it can only',
    '  check that files EXIST, and reporting that as a pass would mean "I could not check" reads as',
    '  "nothing was wrong" — the failure [pipeline S-14] exists to prevent. Run it in a lane that',
    '  has Flutter (app_brick), not beside the static guards.',
  ]);
}
if (stock.size === 0) {
  fail(['✗ COVERAGE LOST — found the SDK template directories but no stock PNGs inside them.']);
}

// ── read the stamp's claimed platforms from the catalogue it wrote ──────────
// Claim-driven, exactly as [3]S-3 is: the guard checks what the app SAYS it
// ships, so it scales when a native platform is added without being reworded.
const appId = basename(appDir);
let claimed = null;
const catalogue = join(appDir, '..', '..', 'sites', '_shared', '_data', 'apps.json');
if (existsSync(catalogue)) {
  try {
    const entry = JSON.parse(readFileSync(catalogue, 'utf8')).find((e) => e && e.slug === appId);
    if (entry && Array.isArray(entry.platforms)) claimed = entry.platforms;
  } catch {
    /* fall through to the default below */
  }
}
if (!claimed || claimed.length === 0) {
  fail([
    `✗ COVERAGE LOST — no platform claim found for "${appId}" in ${catalogue}.`,
    '  The asset set is derived from the claim; with no claim there is nothing to require, and an',
    '  empty requirement passes. [pipeline S-3] owns the claim itself.',
  ]);
}
if (!claimed.includes('web')) {
  fail([
    `✗ "${appId}" claims [${claimed.join(', ')}] and NOT web, which this guard is the whole of today.`,
    '  If a native platform claim landed, this guard needs its asset list before the claim ships.',
  ]);
}

// ── PNG reading, enough to prove it is one and to find its dominant colour ──
function readPng(buf) {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (buf.length < 8 || !sig.every((v, i) => buf[i] === v)) return null;
  let off = 8;
  let width = 0;
  let height = 0;
  let colourType = -1;
  let depth = 0;
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
    }
    if (type === 'IDAT') idat.push(data);
    if (type === 'IEND') break;
    off += 12 + len;
  }
  if (!width || !height) return null;
  return { width, height, depth, colourType, idat };
}

/** The most common pixel, as RRGGBB. Only 8-bit truecolour with filter 0 is
 *  handled — which is what this factory generates. Anything else returns null
 *  and the colour limb is SKIPPED WITH A PRINTED REASON rather than passed. */
function dominantColour(png) {
  if (png.colourType !== 2 || png.depth !== 8 || png.idat.length === 0) return null;
  let raw;
  try {
    raw = inflateSync(Buffer.concat(png.idat));
  } catch {
    return null;
  }
  const stride = 1 + png.width * 3;
  if (raw.length < stride * png.height) return null;
  const counts = new Map();
  for (let y = 0; y < png.height; y++) {
    if (raw[y * stride] !== 0) return null; // a filtered row needs a real decoder
    for (let x = 0; x < png.width; x++) {
      const i = y * stride + 1 + x * 3;
      const key = (raw[i] << 16) | (raw[i + 1] << 8) | raw[i + 2];
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  let best = -1;
  let bestN = -1;
  for (const [k, n] of counts) {
    if (n > bestN) {
      best = k;
      bestN = n;
    }
  }
  return best < 0 ? null : best.toString(16).padStart(6, '0');
}

const problems = [];
const notes = [];
let checked = 0;
let colourChecked = 0;

for (const rel of WEB_ASSETS) {
  const p = join(appDir, rel);
  if (!existsSync(p)) {
    problems.push(`${rel} — MISSING. The stamp claims web and a PWA needs this asset.`);
    continue;
  }
  const bytes = readFileSync(p);
  const png = readPng(bytes);
  if (!png) {
    problems.push(`${rel} — is not a readable PNG (${bytes.length} bytes). Present is not the same as valid.`);
    continue;
  }
  checked++;

  const stockBytes = stock.get(rel);
  if (!stockBytes) {
    notes.push(`${rel} — no stock counterpart in this SDK; identity check skipped for it.`);
  } else if (stockBytes.length === bytes.length && stockBytes.equals(bytes)) {
    problems.push(
      `${rel} — is BYTE-IDENTICAL to Flutter's stock asset. [S-14] This is the default icon, ` +
        'shipped under the app\'s name. In the template it is not one app with the wrong icon, it is ' +
        'every app the factory stamps.',
    );
    continue;
  }

  if (seedArg) {
    const dom = dominantColour(png);
    if (dom === null) {
      notes.push(`${rel} — dominant colour unreadable (not 8-bit truecolour/filter-0); colour limb skipped.`);
    } else {
      colourChecked++;
      if (dom !== seedArg) {
        problems.push(
          `${rel} — dominant colour is #${dom}, but the spec's seed is #${seedArg}. "Not Flutter's" is ` +
            'not the same as "the app\'s": a blank square would pass the identity check alone.',
        );
      }
    }
  }
}

if (checked === 0) {
  fail([
    `✗ COVERAGE LOST — none of the ${WEB_ASSETS.length} expected web assets was readable under ${appDir}.`,
    '  Every check below ranged over nothing.',
  ]);
}

if (problems.length) {
  console.error(`✗ stamp brand assets — ${problems.length} problem(s):`);
  for (const p of problems) console.error(`    ${p}`);
  console.error('');
  console.error('  [pipeline S-14] a stamp carries the app\'s brand assets, never Flutter\'s.');
  process.exit(1);
}

for (const n of notes) console.log(`⚠  ${n}`);
console.log(
  `ok  stamp brand assets — ${checked}/${WEB_ASSETS.length} asset(s) present, valid PNG, and none ` +
    `identical to the SDK's stock (${stock.size} stock asset(s) compared)` +
    (seedArg ? `; ${colourChecked} carry seed #${seedArg}` : '; colour limb not requested'),
);
