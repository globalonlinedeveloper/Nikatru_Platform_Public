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
// `apps/subscriptiontracker/store/android-play/screenshots/README.md` carried a six-row table
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
//   a frame under the ink floor recorded for IT   -> FAIL
//   a committed frame with no ink floor recorded  -> FAIL
//   an ink floor at or under its textless control -> FAIL   ← it could not fire
//   frames committed and no `inkFloor` declared   -> COVERAGE LOST
//   ink floors recorded and NO frame found        -> COVERAGE LOST  ← see below
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
//   · 🔴 ANY TEXT AT ALL, IN ANY FRAME — AMENDED 2026-09-21, AND THE HALF THAT
//     WENT FALSE IS KEPT HERE RATHER THAN DELETED, because a reader who only
//     saw the correction would not know what this guard used to certify.
//
//     WHAT IT SAID, VERBATIM, AND WHY IT WAS WRITTEN: "ANY TEXT AT ALL, IN ANY
//     FRAME. This is not a gap to close later" — because "a text detector that
//     reads some fonts and not others would report 'clean' for the frames it
//     cannot read, which is worse than saying this". The day it mattered is
//     recorded: on 2026-08-05 `05-settings.png` carried the end-to-end
//     account's address, `subscriptiontracker-e2e+…@nikatru.com`, and every
//     check here passed it — right size, right format, live posture, top band
//     0.009. A human found it by opening the file.
//
//     WHAT IS STILL TRUE, AND IS THE WHOLE OF THAT ARGUMENT: nothing here READS
//     A WORD. No OCR, no font, no glyph, no script. An address, a wrong label
//     or a truncated headline in a frame is invisible to this guard, and the
//     redirection below is still where that question is answered.
//
//     WHAT STOPPED BEING TRUE ON 2026-09-21, and the cost of leaving it
//     standing: from #567 to #854 this listing carried four frames with NO
//     GLYPHS IN THEM AT ALL. The capture fetched its fallback fonts at run
//     time, CI never received them, and Flutter drew none — while the layout,
//     the cards, the bundled icons and the colours all came out correct. Every
//     check in this file passed them. The sentence above had turned a real
//     limitation into a standing exemption, which is the same move this header
//     already records itself making once before ("No static guard can read a
//     banner out of a PNG"), and the correction is the same shape: the property
//     that actually changes is measured, without reading anything. See THE INK
//     limb near the end of this file — a frame whose ink coverage collapses
//     against the floor recorded for THAT FRAME in the register fails, and the
//     metric self-tests on every run, exactly as the banner detector does.
//
//     🔴 AND THE REDIRECTION BELOW IS NOT THE ANSWER TO THIS ONE, WHICH IS HOW
//     THE GAP SURVIVED. THE CAPTURE limb near the end of this file reads the
//     capture suite rather than its output, and
//     `apps/subscriptiontracker/integration_test/store_capture_guard.dart`
//     refuses the shutter while the session's own identity is anywhere in the
//     widget tree. Both answer "does a frame leak the signed-in account". A
//     textless set leaks nothing, so both pass it — as they did, for six weeks.
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
// The ONE reading of "this app root was emptied into the chassis package" - see
// that module's header for why it is a module and not eleven copies.
import { delegationOf as resolveChassisDelegation } from './chassis-delegation.mjs';
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
// 🔴 THE THING THE HEADER USED TO SAY COULD NOT BE SEEN — see THE INK limb at
// the end of this file, and that module's header for the measurement table that
// chose its threshold. It is a module for the same reason png-codec.mjs is one:
// the guard and its tests must hold ONE reading of "there is text on this
// screen", or the fixture ends up encoding a different definition from the
// check it is meant to exercise.
import { METRIC_ID as INK_METRIC, INK_DELTA, inkFraction, selfTestInkMetric } from '../store/frame-ink.mjs';
// The ONE relaunch with V8 background tasks off — see that module's header.
import { backgroundTasksNote, relaunchSingleThreaded } from './single-threaded-relaunch.mjs';

// ── the process that does the work runs with V8 background tasks OFF ────────
// 🔴 THE SAME EXPOSURE THAT HUNG assert-launcher-icons.mjs IN CI, measured here
// on 2026-09-11 before this guard ever hung: its banner detector DECODES every
// screenshot and walks the pixels, and on this file's own fixtures V8's worker
// threads burned CPU in 39 of 55 runs (up to 16 ticks) by default and in 0 of 55
// with --single-threaded. Work on a worker thread is what Node's shutdown can
// deadlock on after the verdict is printed (nodejs/node#54918). `coverageLost`
// is a hoisted function declaration, so handing it over before its text is safe.
const relaunched = relaunchSingleThreaded(import.meta.url, process.argv.slice(2), coverageLost);
if (relaunched !== null) process.exit(relaunched);

const ROOT = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
/** No argument means CI's own invocation against the real repository, where a
 *  capture suite MUST exist. A caller pointing this at a fixture root is a
 *  different, weaker situation — most fixtures model a listing tree and no app
 *  source — and it says so out loud rather than failing every fixture. The same
 *  split assert-guard-coverage.mjs makes, for the same reason. */
const scanningRealRepo = process.argv[2] === undefined;
const REGISTER = 'tooling/channel-register.json';
const APPS = 'catalog/apps.json';

const problems = [];
const prints = [];
const abs = (rel) => join(ROOT, rel);
const read = (rel) => (existsSync(abs(rel)) ? readFileSync(abs(rel)) : null);

/** The chassis file(s) a repo-relative file delegates to, resolved ONE level. */
const delegationOf = (rel) => resolveChassisDelegation(ROOT, rel, { describe: () => '' });
const isDir = (rel) => existsSync(abs(rel)) && statSync(abs(rel)).isDirectory();

/** Structural failure: every check below quantifies over the missing thing, so
 *  continuing would report "clean" over nothing — the exact defect this guard
 *  exists to remove, in the guard itself. */
function coverageLost(lines) {
  console.error('');
  console.error(`FAIL COVERAGE LOST — ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(`     ${l}`);
  console.error('\nassert-listing-assets: FAILED');
  // 2, never 1: "I could not look" must never read as "I looked and found a
  // problem", any more than as "I looked and it was fine".
  process.exit(2);
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
 * `apps/subscriptiontracker/store/android-play/screenshots/` currently holds no PNGs — the set
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
//
// 🔴 AND THE BRICK, WHICH IS WHERE THE FLAG ACTUALLY LIVES — 2026-09-14,
// O-LISTING-ASSETS-DEBUG-RIBBON-DOMAIN. Until this date the domain was
// catalog/apps.json alone, and the catalogue's one app sets the flag INLINE in
// its own lib/app.dart and imports nothing from the chassis ([ADR 065]). So the
// delegation branch below was fixture-tested and vacuous on every tree CI ran:
// measured on origin/main fcdfafb8, deleting `debugShowCheckedModeBanner:
// false` from packages/chassis_screens/lib/shell/app_shell.dart (grep -c 1 -> 0)
// left this guard at EXIT 0 printing `1 app(s) … all set`. The brick template's
// lib/app.dart is the file that delegates to that shell, and every app stamped
// from today onward inherits whatever the shell says — so the brick is judged
// here beside the catalogue, through the same delegation, by the same regexes.
//
// On the real tree the brick is REQUIRED, and a brick that is not found
// building a MaterialApp is COVERAGE LOST rather than the quiet `continue` a
// catalogue row with no app tree gets: a renamed brick path would otherwise
// drop the one caller that reaches the shell and leave the count at 1, which is
// the silent shape this limb exists against. A fixture root with no brick is
// the weaker situation `scanningRealRepo` names, and is skipped out loud.
const BRICK_APP_DART = 'tooling/bricks/app/__brick__/apps/{{app_id}}/lib/app.dart';
let debugBannerBrickChecked = false;
{
  const brickPresent = read(BRICK_APP_DART) !== null;
  if (!brickPresent && scanningRealRepo) {
    coverageLost([
      `${BRICK_APP_DART} does not exist.`,
      'It is the brick\'s composition root, and the only file in the tree that delegates to the chassis app',
      'shell where `debugShowCheckedModeBanner: false` now lives. Without it the DEBUG-ribbon limb judges',
      'the catalogue apps alone, and the shell every future app is stamped with is held by nothing.',
    ]);
  }
  const targets = [
    ...apps
      .filter((app) => typeof app.slug === 'string' && app.slug !== '')
      .map((app) => ({ rel: `apps/${app.slug}/lib/app.dart`, brick: false })),
    ...(brickPresent ? [{ rel: BRICK_APP_DART, brick: true }] : []),
  ];
  for (const { rel, brick } of targets) {
    const buf = read(rel);
    if (buf === null) continue; // an entry in the catalogue with no app tree here
    // 🔴 AND WHAT THAT FILE DELEGATES TO — [ADR 067] decision 2, unit app-shell.
    // `MaterialApp.router` moved into
    // `package:nikatru_chassis_screens/shell/app_shell.dart` as `NikatruApp`,
    // and the flag went with it, because it is a property of the app SHELL and
    // not of any one app. Read at the adapter alone a stamped app no longer
    // matches `\bMaterialApp\b`, so it would be SKIPPED — silently, by the
    // `continue` below — and this limb would be judging apps/subscriptiontracker alone while
    // reporting a healthy count. That is not the loud failure the COVERAGE LOST
    // beneath it catches: `debugBannerAppsChecked` would still be 1.
    //
    // The union only ever ADDS text, so an app that set the flag itself still
    // passes; a delegation that cannot be FOLLOWED is a problem, never a quiet
    // skip.
    const dg = delegationOf(rel);
    if (dg && dg.lost) {
      // COVERAGE LOST rather than a `problems.push`, and the difference is
      // measured: the `debugBannerAppsChecked === 0` limb below EXITS before
      // the problem list is ever printed, so a pushed finding here was
      // swallowed by a message about a different fact. Reported where it
      // belongs — the scan could not see this app's shell.
      coverageLost([
        `${rel} ${dg.lost}`,
        'The DEBUG-ribbon check reads that file plus whatever it delegates to, so a delegation this scan',
        'cannot follow is a MaterialApp it cannot see — and an unseen shell is skipped by the very branch',
        'below that exists to skip catalogue rows with no app tree.',
      ]);
    }
    // Comment-stripped: the file explains the flag directly above it in several
    // apps, and prose satisfying a structural check is the trap this repo has
    // been caught by twice.
    const code = [rel, ...((dg && dg.files) || [])]
      .map((f) => (read(f) ?? Buffer.from('')).toString('utf8'))
      .join('\n')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .map((l) => l.replace(/\/\/.*$/, ''))
      .join('\n');
    if (!/\bMaterialApp\b/.test(code)) {
      if (brick) {
        coverageLost([
          `${rel} was read, with what it delegates to, and no MaterialApp was found in either.`,
          'The brick always builds the app shell. Not finding one means the shell moved somewhere this scan',
          'does not follow, and the flag that keeps the DEBUG ribbon off every stamped app\'s store',
          'screenshots is no longer held by anything.',
        ]);
      }
      continue; // nothing here builds the app shell
    }
    if (brick) debugBannerBrickChecked = true;
    else debugBannerAppsChecked++;
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
// account, so the frame read `subscriptiontracker-e2e+…@nikatru.com` — an internal test
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
//     directions by apps/subscriptiontracker/test/store_capture_guard_test.dart);
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

// ── 🔴 THE INK: A FRAME OF A TEXT-BEARING SCREEN WITH NO TEXT IN IT ────────
//
// Added 2026-09-21, for row O-STORE-FRAMES-CARRY-NO-TEXT, after the second
// defect this guard's own header said it could not see. Between #567 and #854
// the four committed frames carried NO GLYPHS AT ALL — the capture fetched its
// fallback fonts at run time and CI never received them — while the layout, the
// cards, the bundled icons and the colours were all correct. Every limb above
// passed them: right size, right colour type, posture "live", worst top band
// 0.009. #847 bundled the fonts and closed the cause. The blindness is what let
// it run for six weeks, and fixing only the instance would leave the next one
// equally invisible.
//
// ⚠️ THIS STILL DOES NOT READ A WORD, AND THE HEADER'S ARGUMENT AGAINST AN OCR
// PASS IS NOT BEING WAVED AWAY. A detector that reads some fonts and not others
// reports "clean" for the frames it cannot read. Nothing here asks what was
// drawn: `inkFraction` counts the pixels standing in local contrast to the
// pixel right of them or below them, and glyphs are thousands of such
// transitions where a card, a flat background and a gradient are none. When the
// glyphs go and the icons stay, the number collapses — in any script.
//
// 🔴 THE FLOOR IS THE REGISTER'S, PER NAMED FRAME, AND IT CARRIES ITS OWN
// DISPROOF. Each row records what the committed frame measured and what the
// TEXTLESS control of that same frame measured, so a floor that would sit at or
// under its own control is refused here rather than enforced: such a floor
// could not have caught the set that actually shipped, which is the one thing
// this limb has to be able to do. A per-class floor was measured first and does
// not separate — the textless 01-home frame reads 0.0131, above the
// text-bearing 03-insights frame at 0.0168 × 0.7 — and that measurement is in
// the register's `_why` beside the numbers.
//
// A frame with no floor row FAILS. Committing a frame nobody measured is
// exactly how the set that shipped got here, and a silent skip would let the
// next rename take a frame out of this limb's reach with nothing going red.
let inkBlocksRead = 0;
let inkFramesMeasured = 0;
let inkSelfTest = null;
let tightestInk = null;
{
  for (const row of withGraphics) {
    const g = contract.perChannel[row.id].graphicAssets;
    const s = g?.screenshots;
    if (!s || typeof s !== 'object') continue;
    const template = row.storeMetadataDir;
    // Already reported by the scan above; repeating it would be one fault with
    // two verdicts.
    if (typeof template !== 'string' || !template.includes('{app}')) continue;

    // WHERE THE FRAMES ARE. The screenshot directory plus every device-type set
    // the register declares, taken from the register itself: the phone set and
    // the tablet set are the same pixels captured at two viewports, and a limb
    // that read only `screenshots.dir` would judge four frames of the eight
    // while printing a healthy-looking count.
    const dirs = [s.dir ?? 'screenshots'];
    const sets = s.deviceTypeCoverage?.sets;
    if (sets !== null && typeof sets === 'object') {
      for (const [name, spec] of Object.entries(sets)) {
        if (name === '_why') continue;
        if (spec && typeof spec.dir === 'string' && !dirs.includes(spec.dir)) dirs.push(spec.dir);
      }
    }

    /** Every committed frame, keyed the way the register keys a floor: the path
     *  INSIDE the metadata tree, so one map covers both device types. */
    const frames = [];
    for (const app of apps) {
      if (typeof app.slug !== 'string' || app.slug === '') continue;
      const dir = template.replace('{app}', app.slug);
      if (!isDir(dir)) continue;
      for (const sub of dirs) {
        const shotDir = posix.join(dir, sub);
        if (!isDir(shotDir)) continue;
        for (const f of listDir(abs(shotDir))
          .filter((x) => x.toLowerCase().endsWith('.png'))
          .sort()) {
          frames.push({ key: posix.join(sub, f), rel: posix.join(shotDir, f) });
        }
      }
    }

    const floors = s.inkFloor;
    if (floors === null || typeof floors !== 'object' || Array.isArray(floors)) {
      // 🔴 FRAMES COMMITTED AND NO FLOOR DECLARED IS THE STATE THIS LISTING WAS
      // IN FROM #567 TO #854, so on the real repository it is COVERAGE LOST. A
      // caller pointing this at a FIXTURE root is the weaker situation named at
      // the top of this file — most fixtures model a listing tree written before
      // this limb existed — and it says so out loud rather than failing every
      // fixture, the same split the capture limb and the brick limb already make.
      if (frames.length > 0 && scanningRealRepo) {
        coverageLost([
          `channel "${row.id}" has ${frames.length} committed screenshot(s) and ${REGISTER} declares no \`graphicAssets.screenshots.inkFloor\`.`,
          'That block IS the right-hand side of "these frames carry text". Without it this limb ranges over',
          'nothing and every frame is certified by never being measured — which is the state the listing was',
          'in from #567 to #854, when four frames with no glyphs in them passed every other check here.',
        ]);
      }
      prints.push(
        frames.length > 0
          ? `NO INK FLOOR (fixture root, NOT JUDGED): channel "${row.id}" has ${frames.length} committed frame(s) and declares no \`graphicAssets.screenshots.inkFloor\`. On the real repository this is COVERAGE LOST, not this line.`
          : `NO INK FLOOR: channel "${row.id}" declares no \`graphicAssets.screenshots.inkFloor\`, and no frame is committed for it either, so nothing could be measured. The floor arrives with the frames.`,
      );
      continue;
    }
    if (typeof floors.source !== 'string' || floors.source.trim() === '') {
      problems.push(unsourced(`storeMetadataContract.perChannel["${row.id}"].graphicAssets.screenshots.inkFloor`));
      continue;
    }
    // 🔴 A FLOOR RECORDED AGAINST A DIFFERENT METRIC IS A NUMBER WHOSE MEANING
    // CHANGED UNDERNEATH IT. Comparing today's reading to a threshold measured
    // by another definition is worse than not comparing: it looks like a check.
    if (floors.metric !== INK_METRIC) {
      coverageLost([
        `${REGISTER} records ink floors against metric ${JSON.stringify(floors.metric ?? null)} and this guard computes "${INK_METRIC}".`,
        'Each floor is a number MEASURED by one definition of ink. Enforcing it with another compares two',
        'different quantities and reports a verdict about neither. Re-measure the set with the metric this',
        'guard computes, or restore the one those numbers were taken with.',
      ]);
    }
    const fraction = floors.minFractionOfMeasured;
    if (!Number.isFinite(fraction) || fraction <= 0 || fraction >= 1) {
      coverageLost([
        `${REGISTER} …inkFloor.minFractionOfMeasured is ${JSON.stringify(fraction ?? null)}, which is not a fraction strictly between 0 and 1.`,
        'At 0 or below, every floor is 0 and every frame clears it — including a blank one. At 1 or above,',
        'every floor sits at or over the reading it was taken from and fires on the frame that defined it.',
        'Either way the comparison below stops being a comparison, which is the failure this limb exists to',
        'remove rather than to become.',
      ]);
    }
    const rows = floors.frames;
    if (rows === null || typeof rows !== 'object' || Array.isArray(rows) || Object.keys(rows).filter((k) => k !== '_why').length === 0) {
      coverageLost([
        `${REGISTER} …inkFloor declares an EMPTY \`frames\` map.`,
        'The loop below iterates it. Empty, no committed frame has a floor, every frame is reported as',
        'carrying no recorded floor, and a set that was never measured reads exactly like a set that was.',
      ]);
    }
    inkBlocksRead++;

    // 🔴 THE METRIC PROVES ITSELF BEFORE A SINGLE REAL FRAME IS READ, for the
    // reason the banner detector does and the account-address matcher does: the
    // failure that costs everything is not the threshold being slightly wrong,
    // it is `inkFraction` being edited into something that returns a constant,
    // at which point every frame clears every floor forever and this limb prints
    // ok having measured nothing. See that module's `selfTestInkMetric`.
    const st = selfTestInkMetric(fraction);
    inkSelfTest = st;
    if (!st.ok) {
      coverageLost([
        'the ink metric FAILED ITS OWN SELF-TEST and no frame was measured.',
        `a synthetic frame carrying glyph-shaped strokes measured ${st.withText.toFixed(5)} (needs >= ${st.floor.toFixed(5)}),`,
        `and the same layout with the strokes removed measured ${st.textless.toFixed(5)} (needs < ${st.floor.toFixed(5)}).`,
        `The floor in that pair is ${fraction} of the text-bearing reading — the same relationship every row`,
        'in the register encodes. The metric can no longer tell a frame with text from one without, so it',
        'would pass every real frame for the same reason, silently.',
      ]);
    }

    // A floor row matching no committed frame describes a set that is not here.
    // Only asked when frames exist: a channel whose screenshots have not landed
    // yet is the gap the limb above already PRINTS, not a stale register.
    if (frames.length > 0) {
      const present = new Set(frames.map((f) => f.key));
      for (const k of Object.keys(rows)) {
        if (k === '_why') continue;
        if (!present.has(k)) {
          problems.push(
            `${REGISTER} records an ink floor for "${k}" and no such frame is committed for channel "${row.id}". The measurement describes a frame that is not there, so it holds nothing — and the frame that replaced it is measured against a floor nobody took from it.`,
          );
        }
      }
    }

    for (const fr of frames) {
      const spec = rows[fr.key];
      if (spec === undefined || spec === null || typeof spec !== 'object') {
        problems.push(
          `${fr.rel} is committed and ${REGISTER} records NO ink floor for "${fr.key}". A frame nobody measured is a frame this limb cannot judge, and passing it would certify it by never looking — which is how four frames with no glyphs in them stayed in this listing from #567 to #854. Measure it and add the row with its date and the command.`,
        );
        continue;
      }
      const measured = spec.measured;
      const control = spec.textlessControl;
      if (!Number.isFinite(measured) || !Number.isFinite(control)) {
        problems.push(
          `${REGISTER} …inkFloor.frames["${fr.key}"] declares ${JSON.stringify({ measured: measured ?? null, textlessControl: control ?? null })}, and both must be numbers. The floor is ${fraction} of \`measured\`, and \`textlessControl\` is the reading that proves such a floor can fire at all; a row missing either enforces a limit nobody took.`,
        );
        continue;
      }
      const floor = measured * fraction;
      // 🔴 THE ROW CARRIES ITS OWN DISPROOF, AND IT IS CHECKED. A floor at or
      // under the textless reading of the same frame is a floor that would have
      // passed the set that shipped — an assertion that cannot fail, wearing the
      // appearance of one that can.
      if (!(control < floor)) {
        problems.push(
          `${REGISTER} …inkFloor.frames["${fr.key}"] puts the floor at ${floor.toFixed(5)} (${fraction} of ${measured}) and records its own TEXTLESS control at ${control}. A floor at or below the textless reading of the same frame could not have caught the frames this listing carried from #567 to #854, which is the one thing it exists to do.`,
        );
        continue;
      }
      const buf = read(fr.rel);
      if (buf === null) {
        problems.push(`${fr.rel} was listed in the tree and could not be read back, so its ink was never measured.`);
        continue;
      }
      let img;
      try {
        img = decodeRgba(buf);
      } catch (e) {
        if (!(e instanceof PngUnreadable)) throw e;
        problems.push(
          `${fr.rel} could not be decoded, so its ink was never measured: ${e.lines[0]}. A frame this guard cannot look at must not be reported as one it looked at.`,
        );
        continue;
      }
      const ink = inkFraction(img);
      inkFramesMeasured++;
      const ratio = ink / floor;
      if (tightestInk === null || ratio < tightestInk.ratio) tightestInk = { rel: fr.rel, ink, floor, ratio };
      if (ink < floor) {
        problems.push(
          `${fr.rel} measures ${ink.toFixed(5)} ink and the floor recorded for it is ${floor.toFixed(5)} (${fraction} of the ${measured} this frame measured when it was captured with its text). The textless control for the same frame reads ${control}, so this frame is ${ink < control * 1.2 ? 'at the level of a capture with no glyphs at all' : 'well down towards one'}. Between #567 and #854 this listing carried four frames whose fonts never loaded: correct layout, correct icons, correct colours, no title, label, amount or nav caption anywhere. Open the frame before assuming a false alarm; if the screen legitimately changed, re-measure it and update the row with the date.`,
        );
      }
    }
  }

  // 🔴 "NOTHING TO MEASURE" IS NOT A PASS ON THE REAL TREE. A fixture root with
  // no screenshots is the weaker situation `scanningRealRepo` names elsewhere in
  // this file and it prints; the repository CI runs against has eight committed
  // frames, and a run of it that measured none of them has lost the limb, not
  // found it satisfied.
  if (scanningRealRepo && inkBlocksRead === 0) {
    coverageLost([
      `no channel in ${REGISTER} declares \`graphicAssets.screenshots.inkFloor\`, so no frame's ink was measured.`,
      'That block is the only declaration of what a frame carrying text looks like. Without it a textless set',
      'passes every remaining check in this file, exactly as one did from #567 to #854.',
    ]);
  }
  if (scanningRealRepo && inkFramesMeasured === 0) {
    coverageLost([
      `${inkBlocksRead} ink floor block(s) were read and ZERO frames were measured against them.`,
      'Either the frames moved out of the directories the register declares, or every one of them failed to',
      'decode. Both report every committed frame full of text by never reading one.',
      '',
      '⚠️ THIS IS STRICTER THAN THE "screenshots absent, row deferred -> PRINT" LINE ABOVE, DELIBERATELY.',
      'That line is about a set that has never been captured, which is owner- and secret-gated work. A',
      'register that RECORDS a floor for eight named frames is a register describing a set somebody did',
      'capture, and finding none of them is a different fact. If the set is being withdrawn on purpose,',
      'withdraw its floors in the same change and this limb goes quiet with it.',
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
    debugBannerBrickChecked
      ? `ok   DEBUG RIBBON — the brick template (${BRICK_APP_DART}, with what it delegates to) sets it too, ` +
          'so every app stamped from it does.'
      : '   ⬜ DEBUG RIBBON — no brick template in this tree (a fixture root); the brick half was not judged.',
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
  if (inkSelfTest !== null) {
    console.log(
      `ok   THE INK — metric "${INK_METRIC}" (per-channel delta ${INK_DELTA}) SELF-TESTED this run: a synthetic frame ` +
        `carrying glyph-shaped strokes measured ${inkSelfTest.withText.toFixed(5)}, the same layout with none measured ` +
        `${inkSelfTest.textless.toFixed(5)}, floor ${inkSelfTest.floor.toFixed(5)}. ${inkFramesMeasured} committed frame(s) ` +
        'measured against the floor recorded for THAT frame in the register.',
    );
    if (tightestInk !== null) {
      console.log(
        `     tightest margin: ${tightestInk.rel} at ${tightestInk.ink.toFixed(5)} against a floor of ` +
          `${tightestInk.floor.toFixed(5)} — ${tightestInk.ratio.toFixed(2)}x. Nothing here READS a word; it measures ` +
          'how much of the frame stands in local contrast, which is what collapses when glyphs vanish and icons stay.',
      );
    }
  } else {
    console.log('   ⬜ THE INK — no `inkFloor` block was read, so the metric never self-tested and no frame was');
    console.log('      measured; the printed line above names the channel. On the real repository, frames with no');
    console.log('      floor declared for them are COVERAGE LOST rather than this line.');
  }
  console.log('   ⚠️ CANNOT SEE: whether a screenshot is REPRESENTATIVE of the app, or whether the feature');
  console.log('      graphic is any good. Size, format, count, recorded posture, the ABSENCE OF THE DEMO BANNER');
  console.log('      and the PRESENCE OF INK are what this proves. "Demonstrates the actual in-app experience"');
  console.log('      is a human call, which is why the capture workflow opens a pull request, not a commit.');
  console.log('   ⚠️ CANNOT SEE: WHAT THE WORDS SAY. The ink limb measures how much of a frame stands in local');
  console.log('      contrast — it never reads a glyph, a font or a script. A frame whose labels are present and');
  console.log('      WRONG, truncated, or in the wrong language measures exactly like a correct one.');
  console.log('   ⚠️ CANNOT SEE: whether a committed graphic is still what its generator renders. That needs');
  console.log('      a browser: `node tooling/store/render-play-graphics.mjs --check`, in the lane that has one.');
  // Read from this process's own start-up flags: remove the relaunch above and
  // this says ON, and listing-assets.test.mjs fails.
  console.log(`   ${backgroundTasksNote()}`);
  console.log('\nassert-listing-assets: ok');
}
