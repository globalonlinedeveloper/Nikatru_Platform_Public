#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-stamp-brand-assets.mjs — a stamped app carries ITS brand, not Flutter's.
//
// [pipeline S-14] Private/requirements/ (was pipeline/03-stamper.md, folded into
// that JSON spec 2026-08-15)
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
// own recorded rule, happening again.
//
// `flutter-stock-assets.mjs` is now the one place that answers "what does
// `flutter create` write?", and it answers by RUNNING IT rather than by reading
// a template directory and hoping. It also refuses to return an empty stock
// asset at all, so neither guard can regain this hole independently. (The
// intermediate fix — overlaying the `flutter_template_images` package — was
// correct locally and failed in CI, where a prebuilt SDK has no package config
// to resolve it from; that history is in its header.)
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
// Usage:  node tooling/ci/assert-stamp-brand-assets.mjs [appDir] [--seed RRGGBB]
//         appDir  an app directory, or the checkout root to grade every
//                 catalogued app in it. Defaults to the working directory.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
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
// The ONE relaunch with V8 background tasks off — see that module's header.
import { backgroundTasksNote, relaunchSingleThreaded } from './single-threaded-relaunch.mjs';

// ── the process that does the work runs with V8 background tasks OFF ────────
// 🔴 THE SAME SHUTDOWN DEADLOCK THAT HUNG assert-launcher-icons.mjs IN CI
// (nodejs/node#54918), reproduced here 2026-09-11 before this guard ever hung:
// on brick-shaped assets at their real sizes (16, 192 and 512 px truecolour),
// V8's worker threads burned CPU in 7 of 8 runs by default and in 0 of 8 with
// --single-threaded, and amplified with --stress-concurrent-allocation a run
// printed its verdict and did not exit. The dominant-colour loop walks every
// pixel of every icon — exactly the hot code a background compile is for.
// `coverageLost` is a hoisted function declaration, so handing it over here,
// before its text, is safe.
const relaunched = relaunchSingleThreaded(import.meta.url, process.argv.slice(2), (lines) =>
  coverageLost([`✗ COVERAGE LOST — ${lines[0]}`, ...lines.slice(1).map((l) => `  ${l}`)]),
);
if (relaunched !== null) process.exit(relaunched);

const args = process.argv.slice(2);
const seedIdx = args.indexOf('--seed');
const seedArg = seedIdx > -1 ? (args[seedIdx + 1] ?? '').replace('#', '').toLowerCase() : null;
// ⚠️ THE SEED'S VALUE IS NOT A POSITIONAL ARGUMENT. `args.find(a => !a.startsWith('--'))`
// took the first non-flag token, so `--seed 6459f5 apps/probe` resolved `6459f5`
// as the directory to grade — shell-13, a hand-rolled argv loop that does not
// know which flags carry a value. The one flag that does is excluded by index.
const positional = args.filter((a, i) => !a.startsWith('--') && !(seedIdx > -1 && i === seedIdx + 1));
/** The path this guard was pointed at: an app directory, or a checkout root. */
const target = resolve(positional[0] ?? '.');

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

/** The scan itself could not see its subject. Exit 2, never 1: "I could not
 *  look" must never read as "I looked and found a problem", any more than as
 *  "I looked and it was fine". A function declaration, so it is hoisted and the
 *  relaunch above may hand it on before this text. */
function coverageLost(lines) {
  for (const l of lines) console.error(l);
  process.exit(2);
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
    keep: (rel) => rel.endsWith('.png'),
  });
  // Re-keyed on the stamped path so the map keys match WEB_ASSETS directly.
  stock = new Map([...stock].map(([k, v]) => [`web/${k}`, v]));
} catch (e) {
  if (!(e instanceof StockAssetsUnavailable)) throw e;
  coverageLost([
    '✗ COVERAGE LOST — could not establish the Flutter SDK\'s stock web assets.',
    ...e.lines.map((l) => `  ${l}`),
    '  This guard compares the stamp against the SDK that builds it. Without those bytes it can only',
    '  check that files EXIST, and reporting that as a pass would mean "I could not check" reads as',
    '  "nothing was wrong" — the failure [pipeline S-14] exists to prevent. Run it in a lane that',
    '  has Flutter (app_brick), not beside the static guards.',
  ]);
}
if (stock.size === 0) {
  coverageLost([
    "✗ COVERAGE LOST — a freshly created app has a web/ directory holding NO PNGs.",
    '  Every identity comparison below would range over nothing and pass, which is indistinguishable',
    '  from every asset being correct.',
  ]);
}

// ── which tree is being graded, and which of its directories are APPS ───────
// 🔴 AN APP ID IS NOT A DIRECTORY NAME, AND THE FILESYSTEM CANNOT ANSWER THE
// QUESTION. Until 2026-09-21 this read `basename(appDir)` and
// `appDir/../../catalog/apps.json` — two guesses about where the checkout sits,
// in place of one question put to the checkout. Run with NO argument from a git
// worktree, which is exactly how `tooling/scripts/guard-sweep.mjs` runs it (its
// only ci.yml invocation carries `apps/probe` and `--seed "$SEED"`; the probe
// does not exist outside the app_brick job and `$SEED` is a runner variable, so
// every invocation is refused and the bare-invocation fallback runs it from the
// repo root), it graded THE FOLDER THE LANE WAS SITTING IN:
//
//     .worktrees/donut           ✗ COVERAGE LOST — no platform claim found for "donut"
//     .worktrees/replay-fixture  ✗ COVERAGE LOST — … for "replay-fixture"
//
// observed 2026-09-20 by two independent lanes. Those are branch workspaces, not
// apps; no catalogue entry for them exists or ever should. The `../..` walked
// OUT of the worktree in the same step and read the MAIN checkout's catalogue —
// so the guard answered a question about one tree out of another tree's facts.
//
// 🔴 THE COST WAS NEVER THE RED. `preflight.mjs` files it ENVIRONMENTAL because
// the merge-base reproduces it, so it blocks nothing — and a guard that cannot
// run where the work happens has a PERMANENT coverage loss that every lane is
// trained to scroll past. That is precisely how a real [S-14] finding — a
// shipped app wearing Flutter's icon — would be waved through.
//
// So the catalogue decides, and the catalogue is the one belonging to the tree
// we were pointed at: the nearest ancestor holding `catalog/apps.json`, itself
// included, which inside a worktree IS the worktree. Pointed at an app
// directory, grade that app. Pointed at the checkout root — the no-argument
// case — grade every catalogued app that exists in it. Pointed at anything
// else, say so and refuse: a branch that quietly grades nothing is the failure
// this whole file is made of.
//
// ⚠️ Adding the worktree names to `catalog/apps.json` was considered and is
// WRONG (O-STAMP-GUARD-READS-THE-DIRECTORY-NAME-AS-AN-APP-ID's own note). A
// directory name is not an app and never will be.

/** The nearest ancestor of `from`, itself included, that holds `catalog/apps.json`.
 *  Bounded twice — by the filesystem root and by a step limit — so a mount loop
 *  cannot spin. `existsSync` only: no directory is ENUMERATED here, which is why
 *  this file still imports no `listDir` (assert-walks-bounded R3). */
function checkoutRootFor(from) {
  let dir = from;
  for (let i = 0; i < 64; i++) {
    if (existsSync(join(dir, 'catalog', 'apps.json'))) return dir;
    const up = dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
  return null;
}

/** Windows compares paths case-insensitively and POSIX does not; comparing raw
 *  strings would miss `C:\…\Apps\probe` against `C:\…\apps\probe`. */
const samePath = (a, b) =>
  process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;

const repoRoot = checkoutRootFor(target);
if (repoRoot === null) {
  coverageLost([
    `✗ COVERAGE LOST — no catalog/apps.json at or above ${target}, so nothing here can say which directories are apps.`,
    '  The asset set is derived from a platform claim and the claim lives in the catalogue. Point this guard at',
    '  an app directory inside a checkout, or run it from the checkout root.',
  ]);
}
const catalogue = join(repoRoot, 'catalog', 'apps.json');
let entries;
try {
  const parsed = JSON.parse(readFileSync(catalogue, 'utf8'));
  if (!Array.isArray(parsed)) throw new Error('the catalogue is not a JSON array');
  entries = parsed.filter((e) => e && typeof e.slug === 'string');
} catch (e) {
  // NOT a silent fall-through to "no platform claim", which is what this did
  // until 2026-09-21: a BROKEN CATALOGUE and a MISSING CLAIM are two different
  // repairs, and one sentence for both sends the reader to the wrong file.
  coverageLost([
    `✗ COVERAGE LOST — ${catalogue} is not a readable catalogue (${e.message}).`,
    '  Every platform claim below would be read out of it, so nothing can be required and nothing checked.',
  ]);
}

/** The catalogue carries a `slug` and the tree carries `apps/<slug>` — one
 *  convention, held by assert-catalog-contract.mjs, not re-derived here. */
const appDirFor = (slug) => join(repoRoot, 'apps', slug);

const pointedAt = entries.find((e) => samePath(appDirFor(e.slug), target));
let graded;
if (pointedAt) {
  graded = [pointedAt];
} else if (samePath(target, repoRoot)) {
  graded = entries.filter((e) => existsSync(appDirFor(e.slug)));
  if (graded.length === 0) {
    coverageLost([
      `✗ COVERAGE LOST — ${catalogue} lists ${entries.length} app(s) and NOT ONE has a directory under ${join(repoRoot, 'apps')}.`,
      '  Every check below would range over nothing, which is indistinguishable from every asset being correct.',
    ]);
  }
} else {
  coverageLost([
    `✗ COVERAGE LOST — ${target} is neither a catalogued app directory of ${repoRoot} nor that checkout's own root.`,
    `  ${catalogue} knows ${entries.length} app(s): ${entries.map((e) => e.slug).join(', ') || '(none)'}.`,
    '  A directory name is not an app id. Name an app directory, or the checkout root to grade every app in it.',
  ]);
}

if (seedArg && graded.length > 1) {
  fail([
    `✗ --seed names ONE app's brand and ${graded.length} apps were selected (${graded.map((e) => e.slug).join(', ')}).`,
    '  A single seed asserted across several apps would pass whichever one happens to share it and fail the rest.',
    '  Name the app directory whose seed this is.',
  ]);
}

// ── the claimed platforms, per app, from the catalogue the app wrote ────────
// Claim-driven, exactly as [3]S-3 is: the guard checks what the app SAYS it
// ships, so it scales when a native platform is added without being reworded.
for (const entry of graded) {
  const claimed = Array.isArray(entry.platforms) ? entry.platforms : null;
  if (!claimed || claimed.length === 0) {
    coverageLost([
      `✗ COVERAGE LOST — no platform claim found for "${entry.slug}" in ${catalogue}.`,
      '  The asset set is derived from the claim; with no claim there is nothing to require, and an',
      '  empty requirement passes. [pipeline S-3] owns the claim itself.',
    ]);
  }
  if (!claimed.includes('web')) {
    fail([
      `✗ "${entry.slug}" claims [${claimed.join(', ')}] and NOT web, which this guard is the whole of today.`,
      '  If a native platform claim landed, this guard needs its asset list before the claim ships.',
    ]);
  }
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

const expected = WEB_ASSETS.length * graded.length;

for (const entry of graded) {
  const appDir = appDirFor(entry.slug);
  for (const rel of WEB_ASSETS) {
    // The app is named on every line: with more than one graded, `Icon-192.png —
    // MISSING` on its own does not say whose.
    const where = `${entry.slug}: ${rel}`;
    const p = join(appDir, rel);
    if (!existsSync(p)) {
      problems.push(`${where} — MISSING. The stamp claims web and a PWA needs this asset.`);
      continue;
    }
    const bytes = readFileSync(p);
    const png = readPng(bytes);
    if (!png) {
      problems.push(`${where} — is not a readable PNG (${bytes.length} bytes). Present is not the same as valid.`);
      continue;
    }
    checked++;

    const stockBytes = stock.get(rel);
    if (!stockBytes) {
      notes.push(`${where} — no stock counterpart in this SDK; identity check skipped for it.`);
    } else if (stockBytes.length === bytes.length && stockBytes.equals(bytes)) {
      problems.push(
        `${where} — is BYTE-IDENTICAL to Flutter's stock asset. [S-14] This is the default icon, ` +
          'shipped under the app\'s name. In the template it is not one app with the wrong icon, it is ' +
          'every app the factory stamps.',
      );
      continue;
    }

    if (seedArg) {
      const dom = dominantColour(png);
      if (dom === null) {
        notes.push(`${where} — dominant colour unreadable (not 8-bit truecolour/filter-0); colour limb skipped.`);
      } else {
        colourChecked++;
        if (dom !== seedArg) {
          problems.push(
            `${where} — dominant colour is #${dom}, but the spec's seed is #${seedArg}. "Not Flutter's" is ` +
              'not the same as "the app\'s": a blank square would pass the identity check alone.',
          );
        }
      }
    }
  }
}

if (checked === 0) {
  coverageLost([
    `✗ COVERAGE LOST — none of the ${expected} expected web assets was readable under ` +
      `${graded.map((e) => appDirFor(e.slug)).join(', ')}.`,
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
  `ok  stamp brand assets — ${checked}/${expected} asset(s) present, valid PNG, and none ` +
    `identical to the SDK's stock (${stock.size} stock asset(s) compared) across ${graded.length} ` +
    `catalogued app(s) [${graded.map((e) => e.slug).join(', ')}] in ${repoRoot}` +
    (seedArg ? `; ${colourChecked} carry seed #${seedArg}` : '; colour limb not requested'),
);
// Read from this process's own start-up flags: remove the relaunch above and this
// says ON, and stamp-brand-assets.test.mjs fails.
console.log(`    ${backgroundTasksNote()}`);
