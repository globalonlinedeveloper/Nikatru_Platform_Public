#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-listing-assets.mjs — a Play listing needs PICTURES, and until
// 2026-08-04 this repository had none of them and no number describing them.
//
// [pipeline D-5] "store listing metadata is generated from the spec and lives in
//                 the repo … and is never hand-typed into a store console as the
//                 only copy."
//
// ── WHAT WAS ACTUALLY WRONG ──────────────────────────────────────────────────
// The listing TEXT has had a guard on every field for months. The two sworn
// declarations got theirs on 2026-08-04. The GRAPHICS — which Google requires to
// publish AT ALL — had neither an artefact nor a requirement:
// `apps/subly/store/android-play/screenshots/README.md` carried a six-row table
// in which every row read "⚠️ UNVERIFIED", under the honest instruction "do not
// fill a number in from memory". That instruction was right and it had been
// obeyed for weeks, which is the problem: an UNVERIFIED table is a placeholder
// that reports the same thing whether anyone is working on it or not.
//
// ── EVERY NUMBER IS THE REGISTER'S, AND EVERY NUMBER CARRIES ITS CITATION ────
// Nothing is declared in this file. The expectations live in
// `tooling/channel-register.json` → `storeMetadataContract.perChannel.<id>
// .graphicAssets`, read from there for the same reason `assert-store-metadata
// .mjs` reads `requiredFiles` from there: a private copy would be the second
// declaration and the first to drift. A dimension that arrives WITHOUT a
// `source` FAILS THE BUILD rather than being enforced — an invented limit fires
// on CORRECT input, and this repo has already rejected its own fixture at 129
// characters against a made-up "120 or fewer".
//
// ── THE PRINT/FAIL SPLIT IS A RELATIONSHIP, NOT A MOOD ──────────────────────
//   asset declared, file missing, row SERVED      -> FAIL
//   asset declared, file missing, row deferred    -> FAIL   ← see below
//   asset present but wrong size/format           -> FAIL
//   screenshots absent, row deferred              -> PRINT
//   screenshots absent, row SERVED                -> FAIL
//   screenshots present without provenance        -> FAIL
//   an asset the metadata contract does not name  -> FAIL
//   a declared limit with no `source`             -> FAIL
//   NOTHING evaluated                             -> COVERAGE LOST
//
// 🔴 THE SECOND LINE IS DELIBERATE AND IT IS WHERE THIS GUARD DIFFERS FROM ITS
// NEIGHBOURS. `assert-store-metadata.mjs` PRINTS a missing tree on a deferred
// row because CREATING a publisher account is owner work an agent must never do.
// The feature graphic and the store icon are not like that: they are produced by
// `node tooling/store/render-play-graphics.mjs` from brand art already in the
// tree, by anybody, in about four seconds, with no account and no secret. There
// is nothing owner-gated about them, so "deferred" would be an exemption
// borrowed from a different problem — and an owner-gated exemption applied where
// it does not belong is exactly how a check stops checking.
//
// SCREENSHOTS ARE GENUINELY DIFFERENT and that is why they print. They can only
// be captured against a LIVE build (see the posture note below), which needs a
// confirmed account, which needs `SUPABASE_SERVICE_ROLE_KEY` — a CI-only secret.
// Failing every build on work only a workflow run can do would block all other
// work and teach somebody to switch this off, so the gap PRINTS with the exact
// command that closes it. [pipeline C-6]'s standing rule.
//
// ── 🔴 THE PROVENANCE CHECK IS THIS GUARD'S TEETH ───────────────────────────
// A PNG carries no evidence of which build it photographed, and that is the only
// question that really matters about a listing screenshot. Until #150 every
// store build of this app was a DEMO build, and a demo build is a DIFFERENT APP
// ON SCREEN — measured 2026-08-04 by capturing one and looking at it:
//
//   · `app_shell.dart` paints an orange banner across every screen reading
//     "Demo data - sample subscriptions, not your account";
//   · `demo_data.dart` fills the board with Netflix, Spotify, Disney+, Adobe CC,
//     1Password and seven more real companies. Two of them are legible in the
//     first frame.
//
// A listing built from that advertises the product as a demo AND puts third-party
// trademarks on a public store page — which Google's own preview-asset page
// tells developers to avoid and which [ADR 019] forbids for any asset we
// produce. So a screenshot set must be accompanied by the capture script's
// `CAPTURE.json` saying `posture: "live"`.
//
// ── 🔴 AND FROM 2026-08-04 THE POSTURE IS MEASURED, NOT ONLY CLAIMED ─────────
// This header used to read "No static guard can read a banner out of a PNG."
// That was true of a guard that only reads PNG HEADERS, which is what this was,
// and it quietly turned a limitation into a policy. `CAPTURE.json` is written by
// the capture script and is good evidence — and it is a JSON file that anybody
// can write next to any five PNGs. The banner is what would actually be wrong
// with the picture, and nothing looked at the picture.
//
// It is detectable without a rasteriser precisely because it is not subtle:
// `app_shell.dart` paints a `width: double.infinity` bar of `AppColors.warn` at
// `top: 0` on every screen. The colour is read from the token file that paints
// it, never pinned here, and THE DETECTOR SELF-TESTS ON EVERY RUN against two
// frames built in memory — so it cannot silently stop detecting even while the
// screenshot directory is empty, which it is today.
//
// The DEBUG ribbon is a separate limb and a static one: `flutter drive` builds
// in debug, so `debugShowCheckedModeBanner: false` is the only thing keeping a
// red ribbon off every captured frame, and nothing was holding it.
//
// ⚠️ WHAT THIS GUARD CANNOT SEE, stated plainly so nobody reads green as safe:
//   · WHETHER A SCREENSHOT IS REPRESENTATIVE. It proves size, format, count,
//     recorded posture and the absence of the demo banner. It does not know
//     whether the screens chosen are the ones worth showing, whether the board
//     looks plausible, or whether the app regressed between the capture and
//     today. Google requires screenshots to "demonstrate the actual in-app or
//     in-game experience"; that is a human call and this guard does not make it.
//     It is why `store-screenshots.yml` opens a PULL REQUEST — a human looking
//     at the images in a diff is the check no assertion replaces.
//   · WHETHER THE FEATURE GRAPHIC IS ANY GOOD. Right size, right format, right
//     provenance — not "right".
//   · ANYTHING ELSE IN THE PIXELS. One band of one colour is decoded, plus the
//     header. Third-party marks inside the frame, a broken layout or an empty
//     board would all pass.
//   · ANY TEXT AT ALL, IN ANY FRAME. This is not a gap to close later, and the
//     day it mattered is recorded: on 2026-08-05 `05-settings.png` carried the
//     end-to-end account's address, `subly-e2e+…@nikatru.com`, and every check
//     here passed it — right size, right format, live posture, top band 0.009.
//     A human found it by opening the file. Glyphs are not a band of one colour,
//     and a text detector that reads some fonts and not others would report
//     "clean" for the frames it cannot read, which is worse than saying this.
//     🔴 SO THE QUESTION IS ANSWERED UPSTREAM OF THE PIXELS INSTEAD — see THE
//     CAPTURE limb near the end of this file, which reads the capture suite
//     rather than its output, and `apps/subly/integration_test/
//     store_capture_guard.dart`, which refuses the shutter while the session's
//     own identity is anywhere in the widget tree.
//   · WHETHER THE COMMITTED GRAPHIC IS STILL WHAT ITS GENERATOR RENDERS. That
//     needs Chrome, so it is a separate step —
//     `node tooling/store/render-play-graphics.mjs --check` — which runs in the
//     lane that has a browser rather than beside the static guards.
//
// Usage:  node tooling/ci/assert-listing-assets.mjs [repoRoot]
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve, dirname, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listDir } from './tree-walk.mjs';
// 🔴 THE PIXELS, and this import is the whole of what changed on 2026-08-04.
// Everything else here reads a PNG HEADER, which answers every question Google
// states and NONE of the question that actually matters: a demo capture is
// exactly the right size. The header above used to say plainly "No static guard
// can read a banner out of a PNG" — and that was true only for as long as
// nothing decoded one. See BANNER DETECTION below.
import { decodeRgba, encodeRgba, PngUnreadable } from '../store/png-codec.mjs';
// 🔴 THE OTHER THING THAT CANNOT BE READ OUT OF A PNG — see THE CAPTURE limb at
// the end of this file. Shared with the capture runner rather than reimplemented:
// two readings of "does this capture leak the account" would eventually differ,
// and the disagreement would be silent.
import { scanCaptureSuite, selfTestAccountAddressDetector, SUITE_FILE } from '../store/capture-suite-scan.mjs';

const ROOT = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
/** No argument means CI's own invocation against the real repository, where a
 *  capture suite MUST exist. A caller pointing this at a fixture root is a
 *  different, weaker situation — most fixtures model a listing tree and no app
 *  source — and it says so out loud rather than failing every fixture. The same
 *  split assert-guard-coverage.mjs makes, for the same reason. */
const scanningRealRepo = process.argv[2] === undefined;
const REGISTER = 'tooling/channel-register.json';
const APPS = 'sites/_shared/_data/apps.json';

const problems = [];
const prints = [];
const abs = (rel) => join(ROOT, rel);
const read = (rel) => (existsSync(abs(rel)) ? readFileSync(abs(rel)) : null);
const isDir = (rel) => existsSync(abs(rel)) && statSync(abs(rel)).isDirectory();

/** Structural failure: every check below quantifies over the missing thing, so
 *  continuing would report "clean" over nothing — the exact defect this guard
 *  exists to remove, in the guard itself. */
function coverageLost(lines) {
  console.error('');
  console.error(`FAIL COVERAGE LOST — ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(`     ${l}`);
  console.error('\nassert-listing-assets: FAILED');
  process.exit(1);
}

// ── the register: the only declaration of what a listing needs ──────────────
const registerRaw = read(REGISTER);
if (registerRaw === null) {
  coverageLost([
    `${REGISTER} does not exist.`,
    'It is the single declaration of every graphic requirement. With it gone this guard would have no',
    'right-hand side and would certify every listing complete forever.',
  ]);
}
let register;
try {
  register = JSON.parse(registerRaw.toString('utf8'));
} catch (e) {
  coverageLost([`${REGISTER} is not valid JSON — ${e.message}`]);
}

const contract = register.storeMetadataContract;
if (contract === null || typeof contract !== 'object') {
  coverageLost([`${REGISTER} declares no \`storeMetadataContract\`.`]);
}
const storeRows = (Array.isArray(register.channels) ? register.channels : []).filter((c) => c && c.kind === 'store');
if (storeRows.length === 0) {
  coverageLost([`${REGISTER} declares ZERO \`kind: "store"\` channels — there is no listing to have graphics for.`]);
}

// Which channels state graphic requirements at all. A channel with none is not
// a failure — only Play's requirements have been fetched — but if NO channel
// states any, this guard has nothing to enforce and must say so rather than pass.
const withGraphics = storeRows.filter((r) => contract.perChannel?.[r.id]?.graphicAssets);
if (withGraphics.length === 0) {
  coverageLost([
    `no \`kind: "store"\` channel in ${REGISTER} declares a \`graphicAssets\` block.`,
    'That block IS the requirement. Without one, "the listing graphics are correct" has no right-hand',
    'side and an empty store directory satisfies every check below. If Play\'s block was removed, this',
    'guard did not become unnecessary — it became blind.',
  ]);
}

const appsRaw = read(APPS);
if (appsRaw === null) coverageLost([`${APPS} does not exist — the expected set has no right-hand factor.`]);
let apps;
try {
  apps = JSON.parse(appsRaw.toString('utf8'));
} catch (e) {
  coverageLost([`${APPS} is not valid JSON — ${e.message}`]);
}
if (!Array.isArray(apps) || apps.length === 0) coverageLost([`${APPS} carries no app entries.`]);

// ── PNG header, read the same way the generator reads it ────────────────────
// Deliberately the same four fields `tooling/store/chrome-raster.mjs` exposes.
// Two readers with two ideas of "what this file is" is how one of them starts
// certifying the wrong thing.
function pngHeader(buf) {
  const SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (buf.length < 26 || !SIG.every((v, i) => buf[i] === v)) return null;
  if (buf.toString('ascii', 12, 16) !== 'IHDR') return null;
  const h = { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), depth: buf[24], colourType: buf[25], bytes: buf.length };
  if (h.width === 0 || h.height === 0) return null;
  let off = 8;
  let tRNS = false;
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    if (type === 'tRNS') tRNS = true;
    if (type === 'IEND') break;
    off += 12 + len;
  }
  // `tRNS` counts. A palette or greyscale PNG carries transparency through that
  // chunk with no alpha channel in the colour type at all — which is exactly
  // what Android's stock ic_launcher.png is, so it is not a theoretical shape.
  h.hasAlpha = h.colourType === 4 || h.colourType === 6 || tRNS;
  return h;
}

// ── BANNER DETECTION — posture measured, not merely claimed ─────────────────
// 🔴 WHY THIS EXISTS ALONGSIDE THE PROVENANCE CHECK, NOT INSTEAD OF IT.
// `CAPTURE.json` is a CLAIM. It is written by the capture script on a live run
// and is excellent evidence, and it is still a JSON file sitting next to some
// PNGs: anybody can write one, and a set assembled by hand with a plausible
// record passes every check above. The banner is the thing that would actually
// be wrong with the picture, and until now nothing looked at the picture.
//
// The demo banner is not subtle and that is what makes it detectable without a
// rasteriser or an OCR pass: `app_shell.dart` paints a `width: double.infinity`
// Container of `AppColors.warn` at `top: 0` on EVERY screen whenever
// `!AppConfig.isApiConfigured`. So a row of pixels through it is almost entirely
// one exact colour, edge to edge.
//
// ⚠️ THE COLOUR IS READ FROM THE TOKEN FILE THAT PAINTS IT, NEVER PINNED HERE.
// A hex literal in this file is a copy that rots the day the palette changes:
// the guard would go on scanning for a colour nothing draws any more and report
// every screenshot clean — a scanner that quietly stopped scanning, this repo's
// single most repeated failure, and one it has already paid for twice.
const TOKENS = 'packages/design_system/lib/src/tokens/app_colors.dart';

/**
 * The fraction of a row that must be the banner colour before that row IS a
 * banner.
 *
 * NOT an invented tolerance, and the margin either side is wide. The banner is
 * full-width with centred 12px white text, so its glyphs are a small minority of
 * any row crossing it — measured rows are ~85-95% warn. The other direction: the
 * live UI does use `AppColors.warn` (an accent bar on Home), but as a bar a few
 * pixels wide, i.e. low single-digit percent of a 1080px row. 0.60 sits between
 * two clusters an order of magnitude apart rather than being tuned to either,
 * and every run PRINTS the maximum actually measured so the margin is visible
 * instead of assumed.
 */
const BANNER_ROW_FRACTION = 0.6;

/** How far down to look. The banner is at `top: 0` under a SafeArea, and the web
 *  target has no safe-area inset, so it occupies the first ~90 device pixels of
 *  a 1920-tall capture. 15% is generous enough to survive a layout change and
 *  far short of the content area. */
const BANNER_BAND = 0.15;

/** `static const Color warn = Color(0xFFF59E0B);` → `[245,158,11]`. Parsed from
 *  the declaration, comments stripped first: this file's neighbours are full of
 *  prose naming colours, and a bare text match would read one of those. */
function readWarnColour(root) {
  const p = join(root, TOKENS);
  if (!existsSync(p)) return null;
  const code = readFileSync(p, 'utf8')
    .split('\n')
    .map((l) => l.replace(/\/\/.*$/, ''))
    .join('\n');
  const m = code.match(/static\s+const\s+Color\s+warn\s*=\s*Color\(\s*0x([0-9a-fA-F]{8})\s*\)/);
  if (!m) return null;
  const v = parseInt(m[1], 16);
  return [(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
}

/**
 * The largest fraction of any row in the top band that is exactly `rgb`.
 *
 * Returned as a NUMBER rather than a boolean so the caller can print the
 * measurement. A detector that only ever says yes/no gives a reader no way to
 * tell a comfortable pass from one that nearly fired.
 */
function maxBandRowFraction(img, rgb) {
  const rows = Math.max(1, Math.floor(img.height * BANNER_BAND));
  let best = 0;
  for (let y = 0; y < rows; y++) {
    let hits = 0;
    for (let x = 0; x < img.width; x++) {
      const i = (y * img.width + x) * 4;
      if (img.rgba[i] === rgb[0] && img.rgba[i + 1] === rgb[1] && img.rgba[i + 2] === rgb[2]) hits++;
    }
    if (hits / img.width > best) best = hits / img.width;
  }
  return best;
}

/**
 * 🔴 THE DETECTOR PROVES ITSELF ON EVERY RUN, and this is the only reason the
 * limb above is worth anything today.
 *
 * `apps/subly/store/android-play/screenshots/` currently holds no PNGs — the set
 * lives in an expiring CI artifact, which is the gap the `store-screenshots`
 * workflow now closes by opening a pull request. Until those bytes land, the
 * banner limb ranges over ZERO images and prints ok, which is EXACTLY the shape
 * this repository has been burned by: an assertion that cannot fail, inflating
 * apparent coverage. `assert-stamp-brand-assets.mjs` compared against empty
 * buffers for a week under a healthy-looking count.
 *
 * So the detector is run against two images built here, in memory, on every
 * invocation: one carrying a full-width band of the live token colour, one
 * carrying none. If it stops firing on the first or starts firing on the second,
 * the run is COVERAGE LOST — before any real screenshot is even looked at. That
 * makes it impossible for this limb to be silently disabled by a palette change,
 * a decoder regression, or a threshold edit, whether or not the set is committed.
 */
function selfTestBannerDetector(rgb) {
  const make = (banner) => {
    const w = 64;
    const h = 64;
    const rgba = Buffer.alloc(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      rgba[i * 4] = 0x11;
      rgba[i * 4 + 1] = 0x11;
      rgba[i * 4 + 2] = 0x11;
      rgba[i * 4 + 3] = 0xff;
    }
    if (banner) {
      // Full width, inside the band, with a couple of foreign pixels standing in
      // for the banner's own text so the fixture is not a trivially perfect row.
      for (let y = 0; y < 6; y++) {
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          rgba[i] = rgb[0];
          rgba[i + 1] = rgb[1];
          rgba[i + 2] = rgb[2];
        }
        rgba[(y * w + 30) * 4] = 0xff;
        rgba[(y * w + 31) * 4] = 0xff;
      }
    }
    // Round-tripped through the encoder and the decoder rather than tested as a
    // raw buffer: the limb's real input arrives as PNG bytes, so a decoder that
    // broke would otherwise pass its own self-test.
    return decodeRgba(encodeRgba({ width: w, height: h, rgba }));
  };
  const withBanner = maxBandRowFraction(make(true), rgb);
  const without = maxBandRowFraction(make(false), rgb);
  return { withBanner, without, ok: withBanner >= BANNER_ROW_FRACTION && without < BANNER_ROW_FRACTION };
}

/** A declared expectation with no citation. Enforcing it risks rejecting correct
 *  input on an invented number; ignoring it leaves the register claiming a
 *  constraint that does nothing. Fail, and say which. */
const unsourced = (where) =>
  `${REGISTER} ${where} declares dimensions with NO \`source\`. An invented limit fires on CORRECT input — a made-up "120 characters or fewer" once rejected this repo's own fixture at 129 — so this guard will not enforce a number nobody sourced, and will not let the register pretend to constrain an asset it does not. Add the URL and the date the page was read, or remove the expectation.`;

// ── the detector proves itself BEFORE anything is scanned ───────────────────
// Placed here rather than inside the loop on purpose: it must run whether or not
// a single screenshot exists, which is the entire point (see its header).
const WARN = readWarnColour(ROOT);
if (WARN === null) {
  coverageLost([
    `${TOKENS} does not exist, or declares no \`static const Color warn = Color(0x…)\`.`,
    'That token IS the demo banner\'s colour — app_shell.dart paints the "Demo data" bar with it — and it',
    'is read from there rather than pinned here so the detector cannot go on hunting a colour nothing',
    'draws any more. With it unreadable the banner limb would examine every screenshot for nothing and',
    'report all of them clean, which is the failure this limb exists to remove.',
  ]);
}
const selfTest = selfTestBannerDetector(WARN);
if (!selfTest.ok) {
  coverageLost([
    'the demo-banner detector FAILED ITS OWN SELF-TEST and no screenshot was examined.',
    `a synthetic frame carrying a full-width #${WARN.map((c) => c.toString(16).padStart(2, '0')).join('')} band measured ` +
      `${selfTest.withBanner.toFixed(3)} (needs >= ${BANNER_ROW_FRACTION}),`,
    `and a synthetic frame carrying none measured ${selfTest.without.toFixed(3)} (needs < ${BANNER_ROW_FRACTION}).`,
    'Either the decoder, the threshold or the band changed such that this limb can no longer tell the two',
    'apart — in which case it would pass every real screenshot for the same reason, silently.',
  ]);
}

// ── the scan ────────────────────────────────────────────────────────────────
let assetsChecked = 0;
let screenshotsChecked = 0;
let treesSeen = 0;
/** Screenshots whose PIXELS were examined, as distinct from those whose header
 *  was read. The two diverge exactly when a decode fails, and that difference is
 *  the one worth printing. */
let pixelsExamined = 0;
let debugBannerAppsChecked = 0;
let worstBandFraction = 0;
/** Capture suites read, and frames resolved to the screen they photograph. Both
 *  are printed: the second is what the account-address limb actually ranged
 *  over, and a limb that ranged over zero frames must not read as a pass. */
let captureSuitesScanned = 0;
let capturedFrames = 0;

for (const row of withGraphics) {
  const g = contract.perChannel[row.id].graphicAssets;
  const template = row.storeMetadataDir;
  if (typeof template !== 'string' || !template.includes('{app}')) {
    problems.push(
      `channel "${row.id}" declares \`graphicAssets\` but has no \`storeMetadataDir\` template, so it contributes ZERO expected directories and every graphic check for it ranges over nothing.`,
    );
    continue;
  }

  // The cross-reference. `additionalFiles`/`requiredFiles` is what makes
  // assert-store-metadata.mjs require a file to be present and non-empty; an
  // asset declared ONLY in graphicAssets has one guard holding it, and one guard
  // is how a listing asset gets deleted while the tree still reports complete.
  const named = new Set([
    ...(Array.isArray(contract.requiredFiles) ? contract.requiredFiles : []),
    ...(contract.perChannel[row.id].additionalFiles ?? []),
  ]);

  const assets = g.assets ?? {};
  if (Object.keys(assets).filter((k) => k !== '_why').length === 0) {
    coverageLost([
      `channel "${row.id}" declares a \`graphicAssets\` block with an EMPTY \`assets\` map.`,
      'The per-asset loop below iterates it. Empty, every listing graphic is "correct" in zero',
      'comparisons — and Play refuses to publish a listing without a feature graphic and an icon, so',
      'this would report ready while the submission could not be saved.',
    ]);
  }

  for (const app of apps) {
    if (typeof app.slug !== 'string' || app.slug === '') continue;
    const dir = template.replace('{app}', app.slug);
    if (!isDir(dir)) {
      // assert-store-metadata.mjs owns the "is there a tree at all" question and
      // already prints or fails on it. Repeating the verdict here would be two
      // guards reporting one fault; what matters HERE is that this app
      // contributes no graphic checks, which is recorded rather than silent.
      prints.push(`NO TREE: ${dir} — app "${app.slug}" has no metadata tree for channel "${row.id}", so no graphic could be checked for it. assert-store-metadata.mjs owns that verdict.`);
      continue;
    }
    treesSeen++;

    // ── the fixed-size assets ───────────────────────────────────────────────
    for (const [name, spec] of Object.entries(assets)) {
      if (name === '_why') continue;
      const rel = posix.join(dir, name);

      if (!named.has(name)) {
        problems.push(
          `${rel} is declared in graphicAssets but is NOT named in \`requiredFiles\` or perChannel["${row.id}"].additionalFiles. Only that list makes assert-store-metadata.mjs require the file to exist, so as declared it is held by this guard alone — delete it and one guard notices, which is one too few for an asset Play will not publish without.`,
        );
      }
      if (typeof spec.source !== 'string' || spec.source.trim() === '') {
        problems.push(unsourced(`storeMetadataContract.perChannel["${row.id}"].graphicAssets.assets["${name}"]`));
        continue;
      }
      // A contract naming a generator nobody wrote is a mechanism that fails on
      // first use, and its failure mode is the asset never being regenerated.
      // Same reasoning as assert-launcher-icons.mjs limb 6.
      if (typeof spec.generatedBy === 'string' && !existsSync(abs(spec.generatedBy))) {
        problems.push(`${REGISTER} says ${name} is generated by \`${spec.generatedBy}\`, and that file does not exist. The asset then has no way to be regenerated when the brand changes, which is the whole reason it is generated rather than drawn.`);
      }

      const buf = read(rel);
      if (buf === null) {
        problems.push(
          `${rel} is MISSING. Google: "${spec.source.split('verbatim:')[1]?.trim() ?? spec.source}". Nothing about this asset is owner-gated — it is produced from brand art already in this tree by \`node ${spec.generatedBy ?? 'tooling/store/render-play-graphics.mjs'}\` in seconds, with no account and no secret.`,
        );
        continue;
      }
      const h = pngHeader(buf);
      if (h === null) {
        problems.push(`${rel} is not a readable PNG (${buf.length} bytes). Present is not the same as valid: a truncated or empty file passes an existence check and is refused at upload.`);
        continue;
      }
      assetsChecked++;

      if (Number.isInteger(spec.width) && Number.isInteger(spec.height) && (h.width !== spec.width || h.height !== spec.height)) {
        problems.push(`${rel} is ${h.width}x${h.height} and Play requires exactly ${spec.width}x${spec.height}. Source: ${spec.source}`);
      }
      // 🔴 IN THE DIRECTION THIS ASSET DECLARES, not against a house rule. Play
      // wants the feature graphic WITHOUT alpha and the icon WITH it; a single
      // shared answer would be wrong for one of them every time.
      if (typeof spec.alpha === 'boolean' && h.hasAlpha !== spec.alpha) {
        problems.push(
          spec.alpha
            ? `${rel} has NO alpha channel (PNG colour type ${h.colourType}) and Play requires a "32-bit PNG (with alpha)". Source: ${spec.source}`
            : `${rel} HAS an alpha channel (PNG colour type ${h.colourType}) and Play requires a "24-bit PNG (no alpha)". Source: ${spec.source}`,
        );
      }
      if (Number.isInteger(spec.maxBytes) && h.bytes > spec.maxBytes) {
        problems.push(`${rel} is ${h.bytes} bytes and Play's maximum is ${spec.maxBytes}. Source: ${spec.source}`);
      }
    }

    // ── the screenshot set ──────────────────────────────────────────────────
    const s = g.screenshots;
    if (!s || typeof s !== 'object') continue;
    if (typeof s.source !== 'string' || s.source.trim() === '') {
      problems.push(unsourced(`storeMetadataContract.perChannel["${row.id}"].graphicAssets.screenshots`));
      continue;
    }
    const shotDir = posix.join(dir, s.dir ?? 'screenshots');
    if (typeof s.capturedBy === 'string' && !existsSync(abs(s.capturedBy))) {
      problems.push(`${REGISTER} says screenshots are captured by \`${s.capturedBy}\`, and that file does not exist. Without it the set cannot be regenerated, and a screenshot set nobody can regenerate is stale the first time the UI changes — silently, because no store console watches a repository.`);
    }
    if (!isDir(shotDir)) {
      problems.push(`${shotDir} does not exist. The slot itself is part of the listing contract — losing the directory loses the record that this channel needs screenshots at all.`);
      continue;
    }

    const shots = listDir(abs(shotDir)).filter((f) => f.toLowerCase().endsWith('.png')).sort();

    if (shots.length === 0) {
      const why =
        `${shotDir} holds NO screenshots, and Play will not publish a listing without at least ` +
        `${s.minCount}. This is the ONE listing asset that cannot be produced on the owner's machine: it ` +
        `must be captured against a LIVE build (a demo build paints "Demo data - sample subscriptions, ` +
        `not your account" over every screen and seeds twelve third-party trademarks), a live build needs ` +
        `a confirmed account, and that needs SUPABASE_SERVICE_ROLE_KEY — a CI-only secret. Close it with ` +
        `the \`store-screenshots\` workflow, or locally with those secrets: node ${s.capturedBy}`;
      if (row.served === true) {
        problems.push(`channel "${row.id}" is SERVED and ${why}`);
      } else {
        prints.push(`NO SCREENSHOTS (blocked on a CI run, OWNER_QUEUE ${row.ownerQueue ?? '(unnamed)'}): ${why}`);
      }
      continue;
    }

    /** The exact `WxH` the provenance record claims, if it carries one. Every
     *  frame in a set is one capture at one viewport, so a frame that differs
     *  from its own record was not produced by that run. */
    let expectedPixels = null;

    // 🔴 PROVENANCE FIRST. A screenshot with no recorded posture is the one
    // failure this guard exists to make impossible, and it must fail even when
    // every dimension is perfect — a demo capture is exactly the right size.
    if (typeof s.provenanceFile === 'string') {
      const provRel = posix.join(shotDir, s.provenanceFile);
      const provBuf = read(provRel);
      if (provBuf === null) {
        problems.push(
          `${shotDir} holds ${shots.length} screenshot(s) and no ${s.provenanceFile}. A PNG carries no evidence of which BUILD it photographed, and that is the only question that matters here: until #150 every store build of this app was a demo build, whose every screen carries a "Demo data" banner and whose board is twelve third-party trademarks. \`${s.capturedBy}\` writes this file on a live run and refuses to write demo output into this directory at all — so screenshots without it were put here by hand, and nobody can say what they show.`,
        );
      } else {
        let prov;
        try {
          prov = JSON.parse(provBuf.toString('utf8'));
        } catch (e) {
          problems.push(`${provRel} is not valid JSON — ${e.message}. The provenance record is unreadable, so the posture of these screenshots is unknown.`);
          prov = null;
        }
        if (prov && prov.posture !== 'live') {
          problems.push(
            `${provRel} records posture ${JSON.stringify(prov.posture ?? null)}, not "live". These screenshots photographed a build that is not the one users get. A demo capture is exactly the right SIZE, which is why size checks alone would pass it.`,
          );
        }
        // 🔴 THE RECORD MUST AGREE WITH THE BYTES IT SITS NEXT TO.
        // `CAPTURE.json` states a count and a pixel size; both are things this
        // guard can independently measure. A record that disagrees with the
        // directory means the two came from different runs — somebody added,
        // removed or replaced a frame and left the provenance describing the
        // set that used to be here, which is a screenshot with NO provenance
        // wearing the appearance of one. That is strictly worse than none,
        // because it satisfies the check above.
        if (prov && Number.isInteger(prov.count) && prov.count !== shots.length) {
          problems.push(
            `${provRel} records count ${prov.count} and ${shotDir} holds ${shots.length} screenshot(s). The record describes a different set from the one in this directory, so it is evidence about screenshots that are not these.`,
          );
        }
        if (prov && typeof prov.pixels === 'string') {
          expectedPixels = prov.pixels;
          // Cross-checked against the REGISTER's recommended portrait, so the
          // capture geometry cannot drift from the declared contract without one
          // of the two saying so. Neither number is invented here: one is
          // measured by the capture, the other is quoted from Google's page.
          const rp = s.recommendedPortrait;
          if (rp && Number.isInteger(rp.width) && Number.isInteger(rp.height) && prov.pixels !== `${rp.width}x${rp.height}`) {
            problems.push(
              `${provRel} records pixels "${prov.pixels}" and ${REGISTER} declares a recommended portrait of ${rp.width}x${rp.height}. The capture geometry and the declared contract disagree; the capture script derives ${rp.width}x${rp.height} from a ${rp.width / 3}x${rp.height / 3} viewport at DPR 3, so one of the two was changed alone.`,
            );
          }
        }
      }
    }

    if (Number.isInteger(s.minCount) && shots.length < s.minCount) {
      problems.push(`${shotDir} holds ${shots.length} screenshot(s) and Play requires at least ${s.minCount}. Source: ${s.source}`);
    }
    if (Number.isInteger(s.maxCount) && shots.length > s.maxCount) {
      problems.push(`${shotDir} holds ${shots.length} screenshot(s) and Play accepts at most ${s.maxCount} per device type. Source: ${s.source}`);
    }
    if (Number.isInteger(s.recommendedCount) && shots.length < s.recommendedCount) {
      prints.push(`${shotDir} holds ${shots.length} screenshot(s); Google recommends at least ${s.recommendedCount} at 1080px+ to be eligible for the large-format recommendation surfaces. Not a publish blocker — a reach one.`);
    }

    for (const f of shots) {
      const rel = posix.join(shotDir, f);
      const buf = read(rel);
      const h = pngHeader(buf);
      if (h === null) {
        problems.push(`${rel} is not a readable PNG (${buf.length} bytes).`);
        continue;
      }
      screenshotsChecked++;
      const min = Math.min(h.width, h.height);
      const max = Math.max(h.width, h.height);
      if (Number.isInteger(s.minSide) && min < s.minSide) {
        problems.push(`${rel} is ${h.width}x${h.height}; Play's "Minimum dimension" is ${s.minSide}px. Source: ${s.source}`);
      }
      if (Number.isInteger(s.maxSide) && max > s.maxSide) {
        problems.push(`${rel} is ${h.width}x${h.height}; Play's "Maximum dimension" is ${s.maxSide}px. Source: ${s.source}`);
      }
      // The constraint that is easy to miss and trivially violated by a tall
      // phone: a 1080x2400 capture (a 20:9 handset) is 2.22:1 and is REFUSED,
      // while 1080x1920 is 1.78:1 and is fine.
      if (Number.isFinite(s.maxAspectRatio) && max > min * s.maxAspectRatio) {
        problems.push(
          `${rel} is ${h.width}x${h.height} — a ratio of ${(max / min).toFixed(2)}:1. Play: "The maximum dimension of your screenshot can't be more than twice as long as the minimum dimension." Source: ${s.source}`,
        );
      }
      if (typeof s.alpha === 'boolean' && h.hasAlpha !== s.alpha && !s.alpha) {
        problems.push(`${rel} HAS an alpha channel (PNG colour type ${h.colourType}) and Play requires a "24-bit PNG (no alpha)". Source: ${s.source}`);
      }

      // ── the EXACT geometry, against the set's own record ──────────────────
      // Deliberately NOT "1080x1920 because Google says so" — Google does not:
      // 1080x1920 is a RECOMMENDATION on that page, and enforcing a
      // recommendation as a requirement is how a made-up "120 characters or
      // fewer" once rejected this repo's own fixture at 129. What IS mandatory
      // is internal consistency: the set was captured in one run at one
      // viewport, so a frame that does not match its own CAPTURE.json came from
      // somewhere else, and "somewhere else" is precisely what nobody can
      // account for.
      if (expectedPixels !== null && `${h.width}x${h.height}` !== expectedPixels) {
        problems.push(
          `${rel} is ${h.width}x${h.height} and the set's own ${s.provenanceFile} records ${expectedPixels}. One capture at one viewport produces one size, so this frame did not come from the run that wrote that record — and nothing else in the tree knows where it did come from.`,
        );
      }

      // ── THE PIXELS: no demo banner ────────────────────────────────────────
      let img;
      try {
        img = decodeRgba(buf);
      } catch (e) {
        if (!(e instanceof PngUnreadable)) throw e;
        problems.push(
          `${rel} could not be decoded, so it was never examined for the demo banner: ${e.lines[0]}. A screenshot this guard cannot look at must not be reported as one it looked at.`,
        );
        continue;
      }
      pixelsExamined++;
      const band = maxBandRowFraction(img, WARN);
      if (band > worstBandFraction) worstBandFraction = band;
      if (band >= BANNER_ROW_FRACTION) {
        problems.push(
          `${rel} carries a FULL-WIDTH BAND of the demo-banner colour across the top of the frame (${(band * 100).toFixed(1)}% of a row, threshold ${(BANNER_ROW_FRACTION * 100).toFixed(0)}%). app_shell.dart paints exactly that whenever the build is not backend-live, reading "Demo data - sample subscriptions, not your account" — and that build also seeds twelve third-party trademarks onto the board. A listing built from this advertises the product as a demo AND puts other companies' marks on a public store page. This is measured in the PIXELS, so no CAPTURE.json can talk it away.`,
        );
      }
    }
  }
}

// ── the DEBUG ribbon, which is a different banner and a different fix ───────
// 🔴 NOT DETECTABLE IN THE SAME WAY, AND NOT WORTH GUESSING AT. Flutter's
// checked-mode ribbon is a rotated translucent strip drawn by the framework in
// its own colour; matching it in pixels would need a colour taken from the SDK,
// and this guard runs in the lane that has no Flutter. What CAN be asserted is
// the thing that decides whether it appears at all.
//
// It matters here specifically: the capture runs through `flutter drive`, which
// builds in DEBUG by default. `MaterialApp(debugShowCheckedModeBanner: false)`
// is the only reason the current captures are clean, nothing was holding it, and
// deleting one identifier would put a red DEBUG ribbon in the corner of every
// store screenshot — the loudest possible "unfinished" signal, on the asset
// reviewers look at first.
{
  for (const app of apps) {
    if (typeof app.slug !== 'string' || app.slug === '') continue;
    const rel = `apps/${app.slug}/lib/app.dart`;
    const buf = read(rel);
    if (buf === null) continue; // an entry in the catalogue with no app tree here
    // Comment-stripped: the file explains the flag directly above it in several
    // apps, and prose satisfying a structural check is the trap this repo has
    // been caught by twice.
    const code = buf
      .toString('utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .map((l) => l.replace(/\/\/.*$/, ''))
      .join('\n');
    if (!/\bMaterialApp\b/.test(code)) continue; // nothing here builds the app shell
    debugBannerAppsChecked++;
    if (!/debugShowCheckedModeBanner\s*:\s*false/.test(code)) {
      problems.push(
        `${rel} builds a MaterialApp and does not set \`debugShowCheckedModeBanner: false\`. The store screenshot capture runs through \`flutter drive\`, which builds in DEBUG — so every captured frame would carry Flutter's red DEBUG ribbon, and the listing would advertise an unfinished build. It is one identifier, nothing else was holding it, and no size or format check can see it.`,
      );
    }
  }
  if (debugBannerAppsChecked === 0) {
    coverageLost([
      'not one app under apps/ was found building a MaterialApp, so the DEBUG-ribbon limb evaluated nothing.',
      'The capture builds in debug through `flutter drive`; with this limb vacuous, a deleted',
      '`debugShowCheckedModeBanner: false` would put a red DEBUG ribbon on every store screenshot and',
      'every other check here would still pass, because the frame would be exactly the right size.',
    ]);
  }
}

// ── 🔴 THE CAPTURE ITSELF: WHOSE ACCOUNT ENDS UP ON THE LISTING ─────────────
//
// Added 2026-08-05, after the one defect this guard's own header said it could
// not see arrived. The capture produced five frames and the fifth,
// `05-settings.png`, rendered the signed-in account at the top of the settings
// card in large legible type. CI captures signed in as the throwaway end-to-end
// account, so the frame read `subly-e2e+…@nikatru.com` — an internal test
// address on a public marketing asset. EVERY CHECK ABOVE PASSED IT: it is
// 1080x1920, colour type 2, aspect 1.78, provenance "live", worst top-band row
// 0.009. It was caught by a human opening the image.
//
// ⚠️ AND NOTHING HERE WILL EVER READ THAT ADDRESS OUT OF THE PIXELS. The banner
// limb works because the banner is a full-width band of ONE COLOUR; glyphs are
// not, and a text detector that reads some fonts and not others reports "clean"
// for the frames it cannot read — an assertion that cannot fail, wearing the
// appearance of one that can. So this limb does not look at the PNGs at all. It
// looks at the CAPTURE, which is where the answer is still knowable:
//
//   · every frame goes through the guarded shutter in store_capture_guard.dart,
//     which reads the live widget tree one instruction before the capture and
//     refuses a frame carrying the session's identity (unit-tested in both
//     directions by apps/subly/test/store_capture_guard_test.dart);
//   · every frame resolves to the SCREEN SOURCE it photographs, and that source
//     must not read `.email` off the session.
//
// The second half is why this runs on every push. The refusal is stronger — it
// sees shared widgets and screens nobody audited — but it can only fire during a
// live capture, which needs a CI-only secret, a provisioned Supabase user and a
// browser. Re-adding a settings frame must fail on the PUSH that does it.
{
  const detector = selfTestAccountAddressDetector();
  if (!detector.ok) {
    coverageLost([
      'the account-address detector FAILED ITS OWN SELF-TEST and no capture suite was examined.',
      `a synthetic settings screen reading \`user?.email\` measured ${detector.onLeaking} (needs true),`,
      `and the same screen with the row removed measured ${detector.onClean} (needs false).`,
      'The matcher is one regular expression, and the failure that costs everything is not it being',
      'wrong — it is it being edited into something that never matches, at which point every captured',
      'screen reads clean and this limb prints ok forever.',
    ]);
  }
  for (const app of apps) {
    if (typeof app.slug !== 'string' || app.slug === '') continue;
    const scan = scanCaptureSuite({ root: ROOT, app: app.slug });
    if (!scan.present) continue;
    captureSuitesScanned++;
    capturedFrames += scan.frames.length;
    problems.push(...scan.problems);
  }
  if (captureSuitesScanned === 0 && scanningRealRepo) {
    coverageLost([
      `not one app under apps/ carries ${SUITE_FILE}, so the capture limb examined nothing.`,
      'That suite IS the store screenshot set — it is what `tooling/store/capture-play-screenshots.mjs`',
      'drives, and the register names that script as `capturedBy`. With it gone the set cannot be',
      'regenerated at all, and this limb would report every capture free of the account by never reading',
      'one. The listing directory would go on looking complete while the pictures in it drifted from an',
      'app nobody can re-photograph.',
    ]);
  }
}

// ── the scan must still be reaching the tree ────────────────────────────────
if (treesSeen === 0) {
  coverageLost([
    'not one store metadata tree was found for any channel declaring graphic requirements.',
    'Every check above ranged over nothing. Either the trees moved or the register templates did.',
  ]);
}
if (assetsChecked === 0) {
  coverageLost([
    `${treesSeen} tree(s) were read and ZERO listing graphics were measured.`,
    'The register names assets the trees do not carry, or every asset lost its `source` and was skipped.',
    'Both report every listing graphic correct by never measuring one — and Play refuses to publish a',
    'listing with no feature graphic and no icon, so this would read ready while the submission could',
    'not be saved.',
  ]);
}

// ── report ──────────────────────────────────────────────────────────────────
if (prints.length) {
  console.log('');
  console.log('   ── printed, not failed (a gap nobody sees becomes permanent) ──');
  for (const p of prints) console.log(`   ⬜ ${p}`);
  console.log('');
}

if (problems.length) {
  console.error('');
  for (const p of problems) console.error(`FAIL ${p}`);
  console.error('');
  console.error('  Google requires a feature graphic, an app icon and at least two screenshots to publish a');
  console.error('  listing AT ALL. Regenerate the graphics with `node tooling/store/render-play-graphics.mjs`.');
  console.error('\nassert-listing-assets: FAILED');
  process.exitCode = 1;
} else {
  console.log(
    `ok   REQUIRED_COVERAGE — ${withGraphics.length} channel(s) declaring graphic requirements × ${apps.length} app(s); ` +
      `${treesSeen} tree(s) read, ${assetsChecked} fixed-size asset(s) measured, ${screenshotsChecked} screenshot(s) measured`,
  );
  console.log('ok   every dimension enforced came from the register WITH a citation; an unsourced one fails');
  console.log('     rather than being applied, and an unsourced one cannot be added without its URL and date');
  console.log(
    `ok   DEMO BANNER — detector SELF-TESTED this run against the live token #${WARN.map((c) => c.toString(16).padStart(2, '0')).join('')} ` +
      `read from ${TOKENS}: synthetic banded frame ${selfTest.withBanner.toFixed(3)}, clean frame ` +
      `${selfTest.without.toFixed(3)}, threshold ${BANNER_ROW_FRACTION}. ${pixelsExamined} screenshot(s) DECODED; ` +
      `worst top-band row measured ${worstBandFraction.toFixed(3)}.`,
  );
  if (pixelsExamined === 0) {
    console.log('   ⬜ …and 0 is why the self-test exists. With no screenshots committed the banner limb ranges');
    console.log('      over nothing; the self-test is what stops that reading as a working check. It closes when');
    console.log('      the `store-screenshots` workflow\'s pull request is merged.');
  }
  console.log(
    `ok   DEBUG RIBBON — ${debugBannerAppsChecked} app(s) building a MaterialApp all set ` +
      '`debugShowCheckedModeBanner: false`. The capture runs through `flutter drive`, which builds in DEBUG.',
  );
  console.log(
    `ok   THE ACCOUNT — ${captureSuitesScanned} capture suite(s) read, ${capturedFrames} frame(s) resolved to the ` +
      'screen they photograph, none of which reads `.email` off the session; every frame goes through the ' +
      'guarded shutter that refuses one carrying the signed-in account. Detector SELF-TESTED this run.',
  );
  if (captureSuitesScanned > 0 && capturedFrames === 0) {
    console.log('   ⬜ …and 0 frames resolved is not a pass. The suite captures nothing this scan can name;');
    console.log('      see the FAIL above, because a capture nobody can name is a frame nobody can vet.');
  }
  console.log('   ⚠️ CANNOT SEE: whether a screenshot is REPRESENTATIVE of the app, or whether the feature');
  console.log('      graphic is any good. Size, format, count, recorded posture and the ABSENCE OF THE DEMO');
  console.log('      BANNER are what this proves. "Demonstrates the actual in-app experience" is a human call,');
  console.log('      which is why the capture workflow opens a pull request rather than committing directly.');
  console.log('   ⚠️ CANNOT SEE: whether a committed graphic is still what its generator renders. That needs');
  console.log('      a browser: `node tooling/store/render-play-graphics.mjs --check`, in the lane that has one.');
  console.log('\nassert-listing-assets: ok');
}
