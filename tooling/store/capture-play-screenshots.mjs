#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// capture-play-screenshots.mjs — the Play screenshot sets, one per DEVICE TYPE,
// produced by a COMMAND rather than by somebody with a phone, a tablet and a
// cropping tool.
//
// A screenshot set nobody can regenerate goes stale the first time the UI
// changes, and it goes stale SILENTLY: the store keeps showing last year's
// design and nothing in this repository knows. That is the same failure this
// tree removes everywhere else — a hand-maintained artefact drifting from the
// thing it describes — so the screenshots are an OUTPUT, and this is the
// mechanism a future app inherits by having an `integration_test` at all.
//
// ── HOW THE PIXELS ARE MADE ─────────────────────────────────────────────────
// `flutter drive` + `integration_test` against `-d web-server --browser-name=
// chrome`, exactly the harness `.github/workflows/e2e.yml` has driven nightly
// since 2026-07. It drives the REAL widget tree — real router, real providers,
// real network client — and `binding.takeScreenshot()` on web is serviced by
// WebDriver, so the bytes are a photograph of a real browser rendering the real
// app. Flutter web renders to a canvas, which is why Playwright cannot do this
// and integration_test can: there is no DOM to query, only the widget tree.
//
// 🔴 ANDROID CANNOT BE BUILT ON THE OWNER'S MACHINE and that is not a Flutter
// problem — `java.nio.channels.Selector.open()` fails for ALL Java there, a
// Windows socket-layer defect. So "just run the app on a phone" is not an
// option this repo has, and the web target is the same widget tree.
//
// ── 🔴 WHY THERE IS MORE THAN ONE VIEWPORT, ADDED 2026-08-21 ────────────────
// This script captured ONE viewport — `const CAPTURE = {360, 640, 3}`, a
// constant with no override — and one viewport is one device type. Google's
// sentence is "You must provide a minimum of two screenshots ACROSS DIFFERENT
// DEVICE TYPES to publish your store listing", so a set of four phone frames
// satisfies every count in the tree and still cannot be published:
// `tooling/ci/assert-play-device-coverage.mjs` prints that shortfall on the
// shared lane and FAILS the submission lane on it.
//
// A second viewport is the whole fix, because the device type is not a property
// of the pixels — Play files a screenshot by the console SLOT it is uploaded to,
// and 1080x1920 is a perfectly ordinary tablet portrait size. What a repository
// can do is capture each type into its OWN DIRECTORY and declare which
// directory is which, which is exactly what
// `channel-register.json → …screenshots.deviceTypeCoverage.sets` is. So the
// directories below are READ FROM THAT DECLARATION rather than named here:
// two declarations of where a set lives is one more than can stay correct, and
// the guard grades the register's copy.
//
// ── WHY THE DIMENSIONS ARE WHAT THEY ARE ────────────────────────────────────
// Every number below is from ONE primary page:
//   https://support.google.com/googleplay/android-developer/answer/9866151
//
// GENERAL — applies to every device type. Fetched 2026-08-04:
//   REQUIRED   "You must provide a minimum of two screenshots across different
//               device types to publish your store listing"
//              "JPEG or 24-bit PNG (no alpha)"
//              "Minimum dimension: 320px" · "Maximum dimension: 3840px"
//              "The maximum dimension of your screenshot can't be more than
//               twice as long as the minimum dimension."
//              "You can add up to 8 screenshots for each supported device type."
//   RECOMMENDED (gates eligibility for Play's large-format recommendation
//               surfaces, not the listing itself)
//              "For apps, you must provide at least four screenshots with
//               minimum 1080px resolution. These should be … 9:16 for portrait
//               screenshots (minimum 1080x1920px)."
//
// PHONE. 1080x1920 satisfies all of it: 9:16, ratio 1.78 (inside the ×2
// ceiling), both sides inside 320..3840, and it is exactly the recommended
// portrait minimum. It is reached as CSS 360x640 at a device pixel ratio of 3 —
// `flutter drive` takes `--browser-dimension=WxH@dpr` and its own help says that
// "will affect screenshot dimensions". 360 CSS px is a real phone width, so the
// app lays out as a phone; capturing at 1080 CSS px would photograph the TABLET
// layout at phone dimensions, which is a lie that looks like a screenshot.
//
// TABLET / CHROMEBOOK. The same page, RE-FETCHED 2026-08-21 for this increment
// because the register's own rule is that a form-factor row arrives WITH its
// dimension rule and a re-read source. Verbatim, from the Screenshots section:
//
//   "For Chromebook and tablets, you can add a minimum of 4 screenshots to
//    demonstrate your in-app experience. Upload screenshots between 1,080 and
//    7,680px Use a 16:9 aspect ratio for landscape and a 9:16 aspect ratio for
//    portrait"
//
// and, from the line that enumerates the slots:
//
//   "Supported device types include phones, tablets (7-inch and 10-inch),
//    Chromebooks"
//
// ⚠️ THE PAGE STATES TWO MAXIMA AND DOES NOT RECONCILE THEM — a general
// "Maximum dimension: 3840px" and a tablet range ending at 7,680px. This script
// does not decide which governs: it obeys the STRICTER (3840) so that the
// capture is inside both readings and nothing here depends on resolving it. The
// looser number is recorded next to it rather than dropped, because a number
// that was fetched and then discarded looks identical to one nobody looked for.
//
// The tablet viewport is CSS 900x1600 at DPR 2 → 1800x3200, and every term of
// that is derived rather than picked:
//   · 900 CSS px is inside this repo's EXPANDED window class — `AppBreakpoints`
//     measures medium 600, expanded 840, large 1200 — so the widget tree lays
//     out in its tablet configuration rather than its phone one. It sits INSIDE
//     the band [840, 1200) rather than on its edge, so a few px of breakpoint
//     movement cannot silently flip the capture back to a phone layout. Same
//     reasoning as "360 CSS px is a real phone width" above.
//   · 900x1600 is exactly 9:16, which the page requires verbatim for portrait.
//   · ×2 → 1800x3200: the short side is above the 1,080 floor, the long side is
//     below BOTH stated maxima, and 3200 ≤ 2 × 1800 keeps the general ×2 aspect
//     ceiling. Every bound is cleared with margin rather than on the line.
//
// 🔴 WHAT IS *NOT* CLAIMED: that 900 CSS px is a 7-inch or a 10-inch tablet. The
// page states ONE dimension rule for "Chromebook and tablets" and no per-inch
// dimensions, and nothing in a browser viewport carries a physical size. So one
// tablet set is declared, named `tablet`, at the granularity of the sentence
// that was actually fetched. Which console slot it is uploaded to is a human
// step, and the guard says out loud that it cannot see the difference.
//
// 🔴 A NUMBER HERE THAT NOBODY FETCHED WOULD FIRE ON CORRECT INPUT. This repo
// has already rejected its own fixture at 129 characters against a made-up "120
// or fewer". Google publishes no maximum FILE SIZE for a phone screenshot on
// that page — only for the app icon (1024KB) and for Android XR (8MB) — so none
// is enforced here and none is written down. See the register's
// `graphicAssets._unverified`.
//
// ── ⚠️ THE POSTURE GATE — READ THIS BEFORE ADDING `--proof` TO A CI JOB ──────
// A DEMO build of this app is a different app on screen: `app_shell.dart`
// paints "Demo data - sample subscriptions, not your account" across every
// screen, and `demo_data.dart` seeds twelve third-party trademarks. So:
//
//   default   requires a LIVE build (SUPABASE_URL + SUPABASE_ANON_KEY + a
//             confirmed account, and the sandbox API host this script computes
//             from the wrangler configs) and writes into the listing
//             directory. This is the only output that may be uploaded.
//   --proof   allows a demo build, and writes to a THROWAWAY directory. It
//             exercises the mechanism end to end — chromedriver, the drive, the
//             capture, the flatten, the dimension check — without producing
//             anything that could be mistaken for a listing asset.
//
// The two are not a preference. `--proof` REFUSES to write anywhere under the
// listing directory even if asked, and the Dart suite refuses to run against a
// demo build unless the proof define is set, so neither half can be bypassed
// alone.
//
// Usage:
//   node tooling/store/capture-play-screenshots.mjs            # live → listing
//   node tooling/store/capture-play-screenshots.mjs --proof    # demo → temp
//   node tooling/store/capture-play-screenshots.mjs --app subscriptiontracker --out BASE
//
// ⚠️ `--out` NAMES THE CHANNEL DIRECTORY, NOT A SCREENSHOT DIRECTORY, and that
// changed on 2026-08-21 when the second viewport arrived. Each device type is
// written to `<BASE>/<the register's sets.<type>.dir>` — the same join
// `assert-play-device-coverage.mjs` makes from `storeMetadataDir`, so the
// directory this writes and the directory that guard grades cannot diverge.
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, unlinkSync } from 'node:fs';
import { join, resolve, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { pngHeader, flattenToOpaque, RasterUnavailable } from './chrome-raster.mjs';
import { decodeRgba, PngUnreadable } from './png-codec.mjs';
import { foldsOf, foldFor, foldLineProblems, selfTestFoldLineDetector, FOLD_ROWS, FOLD_TOLERANCE } from './capture-row-edge.mjs';
import { scanCaptureSuite, selfTestAccountAddressDetector, storeViewDefineArgs } from './capture-suite-scan.mjs';
import { stageFallbackFonts, unstageFallbackFonts } from './capture-fallback-fonts.mjs';
import { boardFileFor, boardOf, boardParityProblems, boardProvenance } from './capture-board-parity.mjs';
import { appVersionDefine, StampRefused } from '../e2e/app-version-stamp.mjs';
import {
  launchDefineArgs,
  scanTopBand,
  selfTestOfflineBannerDetector,
  BAND_ROW_FRACTION,
} from './capture-network-posture.mjs';
import { backendDefinesForRun, assertCaptureDefines, CaptureBackendRefused } from './capture-backend.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(join(HERE, '..', '..'));

const argv = process.argv.slice(2);
const PROOF = argv.includes('--proof');
const arg = (name, dflt) => {
  const i = argv.indexOf(name);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : dflt;
};
const app = arg('--app', 'subscriptiontracker');

/** The channel whose listing this captures. The register's contract is keyed by
 *  it, and so is the set map every directory below is read from.
 *
 *  🔴 IT BECAME AN ARGUMENT ON 2026-09-22 (O-STORE-SCREENSHOTS PR 2), and the
 *  default is the value it was a constant of, so every existing caller, every
 *  workflow line and every test that imports this file keeps exactly the
 *  behaviour it had. The alternative was a second copy of this file per store,
 *  which is how five listings come apart: the Play copy would get the next fix
 *  and the other four would not, and nothing would say so. What is genuinely
 *  per-channel — the directory, the sizes, the counts, the viewport geometry —
 *  is read from the register row below, not written here. */
const CHANNEL = arg('--channel', 'android-play');
const REGISTER = join('tooling', 'channel-register.json');

/** Play's screenshot rules that apply to EVERY device type. Sourced, or absent. */
export const PLAY_SCREENSHOTS = {
  source: 'https://support.google.com/googleplay/android-developer/answer/9866151',
  fetched: '2026-08-04',
  minSide: 320,
  maxSide: 3840,
  maxAspect: 2,
  minToPublish: 2,
  maxPerDeviceType: 8,
  recommendedCount: 4,
  recommendedPortrait: { width: 1080, height: 1920 },
  alpha: false,
};

/** Play's ADDITIONAL rules for the tablet / Chromebook slots, re-fetched on the
 *  day the tablet set was declared. Same page, different paragraph.
 *
 *  `minCount: 4` is the strict reading of a sentence that is genuinely
 *  ambiguous — "you can add a minimum of 4 screenshots" can be read as a floor
 *  or as an allowance. The corpus rule for exactly this shape is already
 *  written down in the register's `_unverified`: of two readings, take the one
 *  that cannot accept a listing Play might refuse. The capture suite produces
 *  four frames, so the strict reading costs this lane nothing today. */
export const PLAY_TABLET_SCREENSHOTS = {
  source: 'https://support.google.com/googleplay/android-developer/answer/9866151',
  fetched: '2026-08-21',
  verbatim:
    'For Chromebook and tablets, you can add a minimum of 4 screenshots to demonstrate your in-app ' +
    'experience. Upload screenshots between 1,080 and 7,680px Use a 16:9 aspect ratio for landscape ' +
    'and a 9:16 aspect ratio for portrait',
  minSide: 1080,
  // The stricter of the two maxima the page states. 7,680 is kept beside it
  // because it WAS fetched — see the header. Neither is invented here.
  maxSide: 3840,
  statedMaxSideForTablets: 7680,
  portraitAspect: { w: 9, h: 16 },
  minCount: 4,
};

/** The register row for THIS channel's screenshots, read once. `deviceTypeSets()`
 *  below reads the same file again for its own refusals; that is deliberate —
 *  this read is allowed to come back empty (a channel may legitimately not be
 *  declared yet, and the message for that belongs to the function that refuses),
 *  whereas the one below must stop the run. */
function readRegister() {
  const abs = join(ROOT, REGISTER);
  if (!existsSync(abs)) return null;
  try {
    return JSON.parse(readFileSync(abs, 'utf8'));
  } catch {
    return null;
  }
}
const REG = readRegister();
const SHOTS = REG?.storeMetadataContract?.perChannel?.[CHANNEL]?.graphicAssets?.screenshots ?? null;

/** "2:1" → 2. The register writes an aspect as WIDTH:HEIGHT, the same way
 *  assert-listing-assets.mjs reads it; a second spelling here is how the two
 *  files would grade the same frame differently. */
const ratioOf = (v) => {
  const m = typeof v === 'string' ? /^(\d+):(\d+)$/.exec(v) : null;
  return m && +m[1] > 0 && +m[2] > 0 ? +m[1] / +m[2] : null;
};

/** One entry per DEVICE TYPE. The `type` key must name a set in the register,
 *  and the register is where that set's directory lives — never here.
 *
 *  🔴 PLAY'S TWO VIEWPORTS ARE READ FROM THE REGISTER SINCE 2026-09-24, and
 *  this comment used to argue the opposite. It said 360x640@3 and 900x1600@2
 *  should stay written here, because re-deriving them through a second file
 *  risked a set that silently changes size. Two things changed that. The ink
 *  limb of `assert-listing-assets.mjs` now judges each frame at its CSS width,
 *  so it needs the SAME geometry, and a guard cannot import this file — it
 *  drives a browser from its top level. And the size can no longer change
 *  silently: that limb refuses (exit 2) any committed frame that is not
 *  exactly `logicalWidth*dpr x logicalHeight*dpr`. So the two viewports live in
 *  `android-play`'s `deviceTypeCoverage.sets.{phone,tablet}.capture`, the shape
 *  every other channel already declares, with the numbers they had here; this
 *  file keeps its own `rules` objects, and `deviceTypeSets()` refuses the run
 *  if either block is missing or unreadable. */
const PLAY_SETS = REG?.storeMetadataContract?.perChannel?.['android-play']?.graphicAssets?.screenshots?.deviceTypeCoverage?.sets ?? null;
const playCapture = (type, rules) => {
  const c = PLAY_SETS?.[type]?.capture ?? null;
  return { type, cssWidth: c?.logicalWidth, cssHeight: c?.logicalHeight, dpr: c?.dpr, rules };
};
export const PLAY_CAPTURES = [playCapture('phone', PLAY_SCREENSHOTS), playCapture('tablet', PLAY_TABLET_SCREENSHOTS)];

/** The viewport list for a channel that declares its own capture geometry.
 *  A set with NO `capture` limb is skipped rather than guessed at, and
 *  `deviceTypeSets()` then refuses the run by name — a declared set with no
 *  viewport is a device type the register promises and nothing can produce. */
function registerCaptures() {
  const sets = SHOTS?.deviceTypeCoverage?.sets;
  if (sets === null || typeof sets !== 'object' || Array.isArray(sets)) return [];
  const out = [];
  for (const [type, set] of Object.entries(sets)) {
    const c = set?.capture;
    if (!c || typeof c !== 'object') continue;
    out.push({
      type,
      cssWidth: c.logicalWidth,
      cssHeight: c.logicalHeight,
      dpr: c.dpr,
      // Present ⇒ this is a NATIVE drive (`flutter drive -d linux|windows|macos|<simulator>`),
      // absent ⇒ the web harness with chromedriver. See NATIVE below.
      flutterDevice: c.flutterDevice ?? null,
      runner: c.runner ?? null,
      rules: set,
    });
  }
  return out;
}

export const CAPTURES = CHANNEL === 'android-play' ? PLAY_CAPTURES : registerCaptures();

/** 🔴 NATIVE vs WEB, decided by the register and not by a flag. The Play set is
 *  captured through `flutter drive -d web-server` with chromedriver, because a
 *  phone-shaped browser window is the only way this machine can photograph an
 *  Android listing. A desktop or Apple listing is the opposite case: the real
 *  platform IS available on its runner, so it drives the real binary and
 *  chromedriver, the fallback-font staging and the Turnstile site key — all
 *  three of which are web-build concerns — do not apply and must not be
 *  required. A channel is native when EVERY one of its viewports names a
 *  Flutter device; a mixed list would mean one chromedriver shared with a
 *  native drive, so it is not allowed to arise. */
const NATIVE = CAPTURES.length > 0 && CAPTURES.every((c) => typeof c.flutterDevice === 'string' && c.flutterDevice);

/** The store this run is captured for, for the messages below. The guards use
 *  `storeName(row)` against the same register; this is the same answer reached
 *  from the channel id, because this file has the id and not the row. */
const STORE_LABEL = CHANNEL === 'android-play' ? 'Play' : (REG?.channels?.[CHANNEL]?.name ?? CHANNEL);

/** The rules that apply to EVERY device type of THIS channel. For Play it IS
 *  `PLAY_SCREENSHOTS` — the same object, so nothing about a Play run changes.
 *  For any other channel it is assembled from the register row, in the same
 *  shape, so every `GENERAL.*` reading below is answered from one place. */
const GENERAL =
  CHANNEL === 'android-play'
    ? PLAY_SCREENSHOTS
    : {
        source: SHOTS?.source ?? `${REGISTER} → storeMetadataContract.perChannel["${CHANNEL}"]`,
        fetched: null,
        minSide: SHOTS?.minSide ?? 0,
        maxSide: SHOTS?.maxSide ?? Infinity,
        maxAspect: ratioOf(SHOTS?.aspectRange?.max) ?? Infinity,
        minToPublish: SHOTS?.minCount ?? 0,
        maxPerDeviceType: SHOTS?.maxCount ?? Infinity,
        recommendedCount: SHOTS?.recommendedCount ?? SHOTS?.minCount ?? 0,
        alpha: SHOTS?.alpha ?? false,
      };

const fail = (lines) => {
  console.error(`capture-play-screenshots: REFUSING — ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(`  ${l}`);
  process.exit(1);
};

// ── where the bytes go ──────────────────────────────────────────────────────
// `listingBase` is the CHANNEL directory, and the per-type directories are its
// children. The proof refusal is on the whole subtree rather than on one
// directory: a demo frame is no less a demo frame for landing in the tablet set.
const listingBase = join(ROOT, 'apps', app, 'store', CHANNEL);
const proofDir = join(tmpdir(), `nk-shot-proof-${randomBytes(4).toString('hex')}`);
const baseDir = resolve(arg('--out', PROOF ? proofDir : listingBase));

if (PROOF && (baseDir === listingBase || baseDir.startsWith(listingBase + sep))) {
  fail([
    '--proof was asked to write into the live listing directory.',
    `${listingBase.replace(ROOT, '.')} is what gets uploaded to Google Play. A proof run captures a DEMO`,
    'build, whose every screen carries the "Demo data - sample subscriptions, not your account" banner and',
    'whose board is twelve third-party trademarks. Those bytes must never be reachable from the listing.',
  ]);
}

// ── the posture gate ────────────────────────────────────────────────────────
// API_BASE_URL left this list on 2026-09-25 (O-STORE-CAPTURE-WRITES-UNATTRIBUTED-ROWS):
// the capture computes its API host from the wrangler configs (see "THE BACKEND
// IS COMPUTED" below), and a caller that still sets it is REFUSED there.
const need = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'E2E_EMAIL', 'E2E_PASSWORD'];
const missing = need.filter((k) => !process.env[k]);
if (!PROOF && missing.length) {
  fail([
    `a live capture needs ${missing.join(', ')} and they are not set.`,
    '',
    'THIS IS NOT A CONFIGURATION NAG — a demo build is a different app on screen. AppConfig.isBackendLive',
    'is a compile-time constant over these defines and the API host this script computes from the wrangler',
    'configs (tooling/store/capture-backend.mjs), and with them absent the app runs MockAuth +',
    'SeedApiClient, which means:',
    '  · app_shell.dart paints "Demo data - sample subscriptions, not your account" over every screen;',
    '  · demo_data.dart fills the board with Netflix, Spotify, Disney+, Adobe CC, 1Password and friends.',
    'A listing built from that advertises the product as a demo AND puts third-party trademarks on a',
    'public store page — which Google\'s own preview-asset page tells developers to avoid and which',
    '[ADR 019] forbids for any generated asset.',
    '',
    'Run the live lane (.github/workflows/store-screenshots.yml provisions a throwaway confirmed user),',
    'or run `--proof` to exercise the mechanism into a throwaway directory.',
  ]);
}

// ── ⬜ COVERAGE LOST ON `--proof`, PRINTED RATHER THAN LEFT TO BE DEDUCED ────
// The seeding block in store_screenshots_test.dart is wrapped in
// `if (AppConfig.isBackendLive)`, and a proof run is a demo build by
// definition, so on `--proof` NONE of it executes: the create flow itself, and
// every guard added around it on 2026-08-26 (the FAB reachable before each row,
// the sheet actually open, the submit button hit-testable after
// `ensureVisible`, the per-row receipt that the sheet closed, and the final
// round-trip read-back). A green `--proof` run therefore says the capture
// MECHANISM works — drive, dimension, shutter, identity guard, flatten, verify
// — and says NOTHING about whether a subscription can be created, or whether
// any of those guards would fire if it could not.
//
// The skip predates the guards and stays: SeedApiClient already holds twelve
// rows, and adding to them proves nothing about the shipping app. What changes
// is that the loss is ANNOUNCED. This lane runs a handful of times a year, and
// a reader who sees `--proof` come back green and infers the add flow was
// exercised is making exactly the inference this notice exists to block.
//
// Printed on stdout, not thrown: a proof run is a legitimate mode and failing
// it would only delete the mode. Printed HERE — above the chromedriver probe,
// the first thing that can refuse for an environmental reason — so the notice
// survives a run that never reaches a browser. Printed by the RUNNER rather
// than by the suite, because the suite's own `debugPrint` under
// `flutter drive -d web-server` goes to the browser console and not to this
// log; that is the same channel gap that hid the missed tap in run 32961461714.
if (PROOF) {
  console.log('');
  console.log('⬜ COVERAGE LOST (--proof): demo build ⇒ AppConfig.isBackendLive is false, so the');
  console.log('   seeding block in store_screenshots_test.dart does NOT run. The add-flow guards');
  console.log('   (FAB reachable · sheet open · submit hit-testable · per-row receipt · round-trip');
  console.log('   read-back) are SKIPPED. This run exercises the capture mechanism only.');
}

// ── chromedriver ────────────────────────────────────────────────────────────
function chromedriverPath() {
  const fromEnv = process.env.CHROMEDRIVER;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  const probe = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['chromedriver'], { encoding: 'utf8' });
  const found = (probe.stdout ?? '').split(/\r?\n/).map((s) => s.trim()).find((s) => s && existsSync(s));
  if (found) return found;
  fail([
    'chromedriver was not found on PATH and CHROMEDRIVER is not set.',
    'It must MATCH the installed Chrome major version or the session handshake fails with a version',
    'mismatch that reads like a Flutter error. CI installs it with nanasess/setup-chromedriver; locally:',
    '  npx @puppeteer/browsers install chromedriver@<your Chrome major>',
    'then export CHROMEDRIVER=<the printed path>.',
  ]);
}

// ── run the drive ───────────────────────────────────────────────────────────
const appDir = join(ROOT, 'apps', app);
if (!existsSync(join(appDir, 'integration_test', 'store_screenshots_test.dart'))) {
  fail([
    `apps/${app} carries no integration_test/store_screenshots_test.dart.`,
    'That suite IS the capture. Without it this script would start a browser, drive nothing and report a',
    'clean run over zero screenshots — a scan over nothing printing ok, which is this repo\'s single most',
    'repeated failure.',
  ]);
}

// ── 🔴 THE SECOND POSTURE GATE: WHOSE ACCOUNT WOULD BE IN THE FRAME ─────────
//
// The gate above asks WHICH BUILD is photographed. This one asks WHO IS SIGNED
// IN, and it exists because the answer reached a public listing once already.
//
// 2026-08-05: this script produced five frames and the fifth, `05-settings.png`,
// rendered the signed-in account at the top of the settings card in large
// legible type. The live lane signs in as a throwaway end-to-end account, so the
// frame read `subscriptiontracker-e2e+…@nikatru.com` — an internal test address on a Play
// marketing asset. It was pulled from the published set by hand, and THAT FIXED
// NOTHING: the address is not baked into the PNG, it is whoever signed in, so
// every re-run reproduced it. Worse, the leak was never bounded by the CI
// account — `E2E_EMAIL` comes from the environment, so an owner running this
// lane locally would photograph their OWN address.
//
// ⚠️ AND NO CHECK DOWNSTREAM CAN SEE IT. `assert-listing-assets.mjs` decoded all
// five frames and passed them; it measures size, colour type, aspect and a
// full-width band of one colour. Nothing in this tree reads TEXT out of a PNG.
//
// So the capture refuses to START if the suite could photograph the account:
// `store_capture_guard.dart` refuses the shutter at capture time, and this
// checks statically that every frame still goes through it and that no captured
// screen reads `.email` off the session. Refusing here costs seconds; refusing
// after the drive costs a browser, a provisioned Supabase user and a CI run.
//
// 🔴 THE SECOND VIEWPORT DOES NOT GET A SECOND PATH. Every viewport below drives
// the SAME suite, so every tablet frame goes through the same `captureFrame`
// shutter as every phone frame, and this one scan vets both. A capture lane that
// reached the pixels by another route would be a second implementation of the
// refusal, and the two would eventually disagree silently — which is the exact
// argument `capture-suite-scan.mjs` makes for being imported by both callers.
{
  const detector = selfTestAccountAddressDetector();
  if (!detector.ok) {
    fail([
      'the account-address detector failed its own self-test, so the capture was not vetted at all.',
      `a synthetic settings screen reading \`user?.email\` measured ${detector.onLeaking} (needs true), and the`,
      `same screen with the row removed measured ${detector.onClean} (needs false). The matcher can no longer`,
      'tell the two apart, so it would clear every captured screen for the same reason — silently.',
    ]);
  }
  const scan = scanCaptureSuite({ root: ROOT, app, devices: CAPTURES.map((c) => c.flutterDevice).filter(Boolean) });
  if (!scan.present) {
    fail([`apps/${app} carries no store capture suite for this scan to vet.`]);
  }
  if (scan.problems.length) {
    fail([
      `apps/${app}'s capture suite could put the signed-in account on a store listing.`,
      '',
      ...scan.problems.flatMap((p) => [p, '']),
      'Fix the suite. A frame that carries the account is not something curation can repair afterwards —',
      'removing it from the published set leaves the NEXT run producing it again, which is exactly what',
      'happened on 2026-08-05.',
    ]);
  }
  console.log(
    `   account check: ${scan.frames.length} frame(s) vetted — ${scan.frames
      .map((f) => `${f.frame}→${f.screen}`)
      .join(', ')}`,
  );
}

// ── 🔴 THE OFFLINE-BANNER DETECTOR PROVES ITSELF BEFORE THE BROWSER STARTS ──
// Same placement and same reason as the account-address self-test above: a
// detector that can no longer tell a banded frame from a clean one would clear
// every captured frame for that reason, silently, and the whole run would be
// wasted producing a set nobody may upload. Refusing here costs milliseconds.
{
  const t = selfTestOfflineBannerDetector();
  if (!t.ok) {
    fail([
      'the offline-banner detector failed its own self-test, so no frame would have been examined for it.',
      `a synthetic frame carrying a full-width errorContainer band measured ${t.withBanner.fraction.toFixed(3)} of a ` +
        `row with a red lead of ${t.withBanner.redLead} (banner=${t.withBanner.banner}, needs true), and a clean ` +
        `frame measured ${t.without.fraction.toFixed(3)} of a row with a red lead of ${t.without.redLead} ` +
        `(banner=${t.without.banner}, needs false).`,
      'Either the decoder, the row threshold or the red-lead threshold changed such that this limb can no',
      'longer separate the two — which is the state every frame committed before 2026-09-20 was captured in.',
    ]);
  }
  console.log(
    `   offline-banner detector: banded ${t.withBanner.fraction.toFixed(3)}/red+${t.withBanner.redLead}, ` +
      `clean ${t.without.fraction.toFixed(3)}/red${t.without.redLead}, threshold ${BAND_ROW_FRACTION}`,
  );
}

// ── 🔴 THE ROW-EDGE DETECTOR PROVES ITSELF TOO (⏱ 2026-09-22) ──────────────
// Same placement, same reason. Three synthetic frames through the real codec:
// a card the fold cuts must read RED, a gap and a faded edge GREEN. The shell
// below the fold is painted a different colour, so a band that slipped one row
// down fails here instead of passing every real frame.
{
  const t = selfTestFoldLineDetector();
  if (!t.ok) {
    fail([
      'the row-edge detector failed its own self-test, so no frame would have been examined for a card cut by the fold.',
      `straddling card: edge=${t.straddle.edge} (needs true, ${t.straddle.off} px off); gap: edge=${t.gap.edge} ` +
        `(needs false, ${t.gap.off} px off); faded: edge=${t.faded.edge} (needs false, ${t.faded.off} px off).`,
      'See tooling/store/capture-row-edge.mjs and tooling/ci/test/capture-row-edge.test.mjs.',
    ]);
  }
  console.log(
    `   row-edge detector: straddle ${t.straddle.off} px off, gap ${t.gap.off}, faded ${t.faded.off}, ` +
      `${FOLD_ROWS} rows, tolerance ${FOLD_TOLERANCE}`,
  );
}

// ── 🔴 WHERE EACH DEVICE TYPE'S SET LIVES IS THE REGISTER'S TO SAY ──────────
// Not this file's. `assert-play-device-coverage.mjs` counts the directories the
// register names; if this script named its own, the two would be a pair of
// declarations, and the day they drift the guard grades a directory the capture
// has never written while both keep printing ok. That is the same failure the
// guard already checks for BETWEEN `screenshots.dir` and `sets.phone.dir`.
//
// The relationship is required to be TOTAL in both directions: a viewport with
// no set is pixels nothing will count, and a set with no viewport is a device
// type the register promises and nothing can produce. Either way the run stops
// here rather than producing a set that is short in a way only CI will notice.
function deviceTypeSets() {
  const abs = join(ROOT, REGISTER);
  if (!existsSync(abs)) {
    fail([
      `${REGISTER} does not exist, so there is no declaration of where each device type's set lives.`,
      'The capture would have to invent the directory names, and an invented directory is one the guard',
      'downstream never looks in — a set that is captured, written and then counted as absent.',
    ]);
  }
  let reg;
  try {
    reg = JSON.parse(readFileSync(abs, 'utf8'));
  } catch (e) {
    fail([`${REGISTER} could not be parsed (${e.message}).`]);
  }
  const cov = reg.storeMetadataContract?.perChannel?.[CHANNEL]?.graphicAssets?.screenshots?.deviceTypeCoverage;
  const sets = cov?.sets;
  if (sets === null || typeof sets !== 'object' || Array.isArray(sets) || Object.keys(sets).length === 0) {
    fail([
      `${REGISTER} declares no \`…perChannel["${CHANNEL}"].graphicAssets.screenshots.deviceTypeCoverage.sets\`.`,
      'That map is what names the device types and where their screenshots go. Without it this capture has',
      'nowhere to write that anything downstream will read.',
    ]);
  }

  const viewportTypes = CAPTURES.map((c) => c.type);
  const declaredTypes = Object.keys(sets);
  const noSet = viewportTypes.filter((t) => !declaredTypes.includes(t));
  const noViewport = declaredTypes.filter((t) => !viewportTypes.includes(t));
  if (noSet.length || noViewport.length) {
    fail([
      'the viewports this script captures and the device-type sets the register declares do not match.',
      noSet.length
        ? `  captured with no set declared: ${noSet.join(', ')} — these pixels would land somewhere no guard reads.`
        : '',
      noViewport.length
        ? `  declared with no viewport here: ${noViewport.join(', ')} — the register promises a device type this ` +
          'script cannot produce, and assert-play-device-coverage.mjs fails on a declared set with no directory.'
        : '',
      'Add the viewport and the set in the same increment, with the page re-fetched — that is the rule the',
      "register's own `deviceTypeCoverage._why` states.",
    ].filter(Boolean));
  }

  const dirs = {};
  for (const t of viewportTypes) {
    const d = sets[t]?.dir;
    if (typeof d !== 'string' || d.trim() === '') {
      fail([`${REGISTER} declares set "${t}" with no \`dir\`, so there is no directory to capture into.`]);
    }
    dirs[t] = d;
  }
  // 🔴 THE VIEWPORT IS THE REGISTER'S, SO AN UNREADABLE ONE STOPS THE RUN HERE,
  // before anything is deleted. Without this a missing `capture` block would
  // reach flutter drive as `--browser-dimension=undefinedxundefined@undefined`,
  // and a DPR that does not land on whole device pixels would produce a frame
  // the ink limb then refuses for its size, after a full capture.
  for (const c of CAPTURES) {
    const okSide = (v) => Number.isInteger(v) && v > 0;
    const whole = okSide(c.cssWidth) && okSide(c.cssHeight) && Number.isFinite(c.dpr) && c.dpr > 0 &&
      Number.isInteger(c.cssWidth * c.dpr) && Number.isInteger(c.cssHeight * c.dpr);
    if (!whole) {
      fail([
        `${REGISTER} …perChannel["${CHANNEL}"]…deviceTypeCoverage.sets["${c.type}"].capture is ` +
          `${JSON.stringify(sets[c.type]?.capture ?? null)}, not {logicalWidth, logicalHeight, dpr} in whole device pixels.`,
        'That block is the viewport this set is captured at and the size assert-listing-assets.mjs holds its',
        'frames to. Restore it before capturing; do not guess a viewport here.',
      ]);
    }
  }
  const minDistinct = Number.isInteger(cov.minDistinctTypes) ? cov.minDistinctTypes : null;
  // 🔴 REFUSE BEFORE THE BROWSER STARTS IF THE RUN CANNOT SUCCEED. Viewports and
  // sets are one-to-one by the check above, so a minimum higher than the number
  // of viewports is a run that will drive a browser, provision an account, write
  // a compliant-looking set and STILL leave a listing Play refuses. That is a
  // knowable-in-advance failure, and a capture lane that spends a CI run
  // discovering it is the shape of waste this file already refuses twice above.
  if (minDistinct !== null && minDistinct > CAPTURES.length) {
    fail([
      `the register requires ${minDistinct} distinct device types and this script has ${CAPTURES.length} viewport(s).`,
      `Viewports: ${CAPTURES.map((c) => `${c.type} (${c.cssWidth}x${c.cssHeight}@${c.dpr})`).join(', ')}.`,
      'No arrangement of this run can satisfy that minimum, so it stops here rather than after a browser, a',
      'provisioned account and a set that looks complete. Add the viewport and its register row together,',
      "with the page re-fetched — the rule in the register's own `deviceTypeCoverage._why`.",
    ]);
  }
  return { dirs, minDistinct, coverageSource: cov.source ?? null };
}

const { dirs: SET_DIRS, minDistinct: MIN_DISTINCT_TYPES, coverageSource: COVERAGE_SOURCE } = deviceTypeSets();

// ── 🔴 THE STAMP AND THE CONSENT LEDGER (pipeline B-17, 2026-09-23) ──────────
// A live drive answers the consent prompt, and the app uploads that answer to
// production platform_db `consent_artifacts` stamped with the build's
// APP_VERSION. Before this limb the capture passed no APP_VERSION, so the build
// fell back to `dev`, and the Linux job of run 35818960378 left two `dev`
// consent rows in production: no provenance resolver can attribute `dev`, and
// the purge after the capture had no id to delete them by.
//
// So a live run needs two things, and REFUSES here without either — below the
// checks that read only the tree, above chromedriver, the PNG clean, the board
// directory and the font staging, so a refused run has touched nothing:
//   · APP_VERSION — `appVersionDefine` in tooling/e2e/app-version-stamp.mjs.
//     Inside store-screenshots.yml it is DERIVED from the Actions default env
//     (cap-<GITHUB_RUN_NUMBER>-<GITHUB_SHA::7>), which the monitor's
//     `store-capture` resolver witnesses against that workflow's runs. Outside
//     Actions only STORE_CAPTURE_APP_VERSION=rehearsal-<10-digit epoch> is
//     accepted, and the monitor refuses that shape on purpose.
//   · E2E_CONSENT_LEDGER — the file this run records each drive's consent
//     answer and install id in, which tooling/e2e/purge.mjs reads afterwards
//     (`resolveCaptureConsentIds` in tooling/e2e/consent_anon_id.mjs).
// `--proof` is a demo build that writes nothing to production and needs neither.
let STAMP_DEFINE = [];
try {
  STAMP_DEFINE = appVersionDefine({ lane: 'store-capture', live: !PROOF });
} catch (e) {
  if (!(e instanceof StampRefused)) throw e;
  fail([
    'a live capture needs an APP_VERSION stamp and none can be derived.',
    e.message,
    '',
    'Without it the build stamps APP_VERSION=dev on every consent row it uploads to production, and',
    'tooling/ops/check-prod-provenance.mjs can attribute no `dev` row to any run.',
  ]);
}
const STAMP = STAMP_DEFINE.length ? STAMP_DEFINE[1].slice('APP_VERSION='.length) : null;
const LEDGER = PROOF ? null : process.env.E2E_CONSENT_LEDGER || null;
if (!PROOF && !LEDGER) {
  fail([
    'a live capture needs E2E_CONSENT_LEDGER and it is not set.',
    '',
    'Each drive answers the consent prompt and uploads a row to production platform_db. The ledger is',
    'where this run records the install id each row is keyed by, and tooling/e2e/purge.mjs deletes by',
    "it after the capture (the purge step's env names the same path). Without it the rows stay behind.",
  ]);
}
/** The ledger is rewritten WHOLE and SYNCHRONOUSLY at every change, so a job
 *  cancelled mid-drive still leaves a readable file naming the board record to
 *  read the id from. */
const ledger = { stamp: STAMP, drives: [] };
const writeLedger = () => {
  if (LEDGER) writeFileSync(LEDGER, `${JSON.stringify(ledger, null, 2)}\n`);
};

// 🔴 THE BACKEND IS COMPUTED, NEVER HANDED IN (O-STORE-CAPTURE-WRITES-UNATTRIBUTED-ROWS,
// 2026-09-25). Until this limb API_BASE_URL came from a repository secret that
// named the production API, so every live drive's consent answer and seeded
// subscriptions landed in production platform_db and subscriptiontracker_db.
// A live capture now drives the two Workers' `env.sandbox` scripts on their
// workers.dev hosts, computed from services/*/wrangler.jsonc by
// tooling/store/capture-backend.mjs, and passes PIN_BACKEND_HOSTS=true so the
// app takes the API host from the define rather than from its seed config
// document (F1 in that file's header). The refusals — a caller-supplied host, a
// production or foreign host, a SUPABASE_URL the sandbox does not verify
// against, a malformed `env.sandbox` — run here, among the checks that read
// only the tree, so a refused run has touched nothing. `--proof` gets `[]`.
let BACKEND_DEFINE = [];
try {
  BACKEND_DEFINE = backendDefinesForRun({ proof: PROOF });
} catch (e) {
  if (!(e instanceof CaptureBackendRefused)) throw e;
  fail([
    `a live capture must drive the sandbox Workers, and the backend was refused on limb ${e.limb}.`,
    e.message,
    '',
    'A capture that reached production would write its consent answer and seeded subscriptions into',
    'production platform_db and subscriptiontracker_db. See tooling/store/capture-backend.mjs.',
  ]);
}

// 🔴 CHROMEDRIVER IS RESOLVED BEFORE ANY BYTES ARE DELETED. It used to be
// resolved after, which meant a machine without chromedriver — the owner's, as
// measured 2026-08-21: not on PATH, CHROMEDRIVER unset — EMPTIED THE PUBLISHED
// LISTING DIRECTORY and then refused. The refusal was correct and the tree was
// left worse than before it ran. Every check that can be made without
// destroying anything belongs above the line that destroys something.
// A NATIVE channel never asks. chromedriverPath() is a REFUSAL when it cannot
// resolve, which is right for a web capture and wrong for a Linux, Windows,
// macOS or simulator drive that has no browser in it at all: it would stop a
// run that needs nothing from Chrome.
const driver = NATIVE ? null : chromedriverPath();
console.log(NATIVE ? `native drive: ${CAPTURES.map((c) => `${c.type} → ${c.flutterDevice}`).join(', ')}` : `chromedriver: ${driver}`);

for (const cap of CAPTURES) {
  const dir = join(baseDir, SET_DIRS[cap.type]);
  mkdirSync(dir, { recursive: true });
  // Start from an empty directory. A stale PNG from a previous UI would otherwise
  // survive a run that no longer captures that screen, and the guard downstream
  // would happily certify its dimensions — a screenshot of a screen the app no
  // longer has, correctly sized.
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.png'))) unlinkSync(join(dir, f));
}

// ── WHERE EACH DRIVE LEAVES ITS BOARD RECORD ────────────────────────────────
// A throwaway directory, one file per device type, created fresh for THIS
// process. Not the listing directory (the driver's header says why), and not a
// fixed path (a record left by yesterday's run must not be read as today's —
// which is the same class of mistake as the stale-PNG one the clean above
// exists for, in a file the clean cannot see because it is not a `.png`).
// The file NAME inside it is `boardFileFor` in capture-board-parity.mjs, which
// the parity suite proves is distinct per viewport.
const boardDir = join(tmpdir(), `nk-shot-board-${randomBytes(4).toString('hex')}`);
mkdirSync(boardDir, { recursive: true });

const cd = NATIVE ? null : spawn(driver, ['--port=4444', '--silent'], { stdio: 'pipe' });
let cdErr = '';
cd?.stderr.on('data', (d) => (cdErr += d.toString()));

/** chromedriver needs a moment before it answers on 4444; polling its own HTTP
 *  status endpoint is the only signal that it is really ready. Sleeping a fixed
 *  interval is how this class of harness becomes intermittently red. */
async function waitForDriver(timeoutMs = 20000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try {
      const r = await fetch('http://127.0.0.1:4444/status');
      if (r.ok && (await r.json())?.value?.ready !== undefined) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

const defines = [];
const pass = (k) => {
  if (process.env[k]) defines.push('--dart-define', `${k}=${process.env[k]}`);
};
for (const k of need) pass(k);
// The stamp resolved above ([] on `--proof`). See "THE STAMP AND THE CONSENT LEDGER".
defines.push(...STAMP_DEFINE);

// 🔴 THE CAPTCHA SITE KEY, BECAUSE A LIVE WEB BUILD WITHOUT IT IS AN ERROR —
// AND RUN 35488534460 RAISED EXACTLY THAT ERROR, AS THE SECOND OF ITS TWO.
//
//   Exception caught by turnstile_gate
//   Bad state: TURNSTILE_SITE_KEY is empty in a WEB build with a live backend.
//   The identity provider refuses sign-in, sign-up, recover and resend without
//   a captcha token, so this build cannot authenticate anyone. (ADR 084)
//
// `TurnstileGate.postureFor` calls that state `misconfigured`, and
// `_TurnstileGateState.initState` reports it through FlutterError on mount.
//
// ⚠️ IT IS A REPOSITORY *VARIABLE*, NOT A SECRET, and that is the whole reason
// this is a fix rather than a waiver: a Turnstile SITE key is public by
// construction — it ships inside every web bundle — and only the secret half
// lives on the auth box. `deploy-web.yml` passes `vars.TURNSTILE_SITE_KEY` to
// the shipping web build and `e2e.yml` passes the same one to the nightly
// drive, where it FAILS CLOSED if unset, for this stated reason: "an empty
// vars.TURNSTILE_SITE_KEY makes TurnstileGate render nothing, and this run
// would prove the suite passes WITHOUT the captcha gate".
//
// This lane omitted it, so the capture was the one lane driving the app through
// an auth posture the shipping build does not have. The nightly is the evidence
// that a driven browser signs in WITH the gate rendered, so passing it here
// moves this lane onto the posture every other lane already uses.
//
// 🔴 AND IT IS A WEB POSTURE, so a native drive is exempt rather than excused.
// TurnstileGate renders in the WEB build; the desktop and Apple builds sign in
// without it, so requiring the key there would refuse a run over a gate that
// build does not have — the mirror image of the defect this limb was added for.
// The posture claim stays true either way: each capture drives the auth flow
// its own shipping build has.
if (process.env.TURNSTILE_SITE_KEY) pass('TURNSTILE_SITE_KEY');
else if (!PROOF && !NATIVE) {
  fail([
    'a live capture needs TURNSTILE_SITE_KEY and it is not set.',
    '',
    'Without it AppConfig.isTurnstileConfigured is false, TurnstileGate.posture is `misconfigured`,',
    'and the gate reports a StateError through FlutterError the moment it mounts — which is the',
    'second of the two exceptions run 35488534460 failed on. It also means this capture drives the',
    'app through an auth path the shipping web build does not have.',
    '',
    'It is a repository VARIABLE, not a secret (a Turnstile SITE key is public — it ships inside the',
    'web bundle). deploy-web.yml and e2e.yml both already pass `vars.TURNSTILE_SITE_KEY`, and e2e.yml',
    'fails closed on it exactly like this. If it is unset in the repository, set it the way that',
    "workflow's error message describes; do not paste a value here.",
    '',
    '`--proof` does not need it: a demo build is not backend-live, so the posture is',
    '`notOnThisChannel` and the gate is inert by design.',
  ]);
}
if (PROOF) defines.push('--dart-define', 'STORE_CAPTURE_ALLOW_DEMO=true');

// 🔴 THE APP MUST NOT ANNOUNCE ITSELF OFFLINE ON A STORE PAGE. Every frame
// captured before 2026-09-20 carries a full-width "Could not reach the network"
// band, because the launch-time config fetch is cross-origin from the random
// localhost port this harness serves on and the platform Worker has no
// localhost regex. The whole diagnosis, the measurements and the rejected
// alternative are in capture-network-posture.mjs; the lever is app_config.dart's
// own, documented for exactly this caller and wired to nothing until now.
defines.push(...launchDefineArgs());
// The sandbox hosts and the pin, computed above ([] on `--proof`). See "THE BACKEND IS COMPUTED".
defines.push(...BACKEND_DEFINE);

// Every define KEY this run passes, each capture's STORE_CAPTURE_VIEW included,
// against CAPTURE_DEFINE_ALLOWLIST (tooling/store/capture-backend.mjs): a key
// outside it — GLITCHTIP_DSN, REVENUECAT_KEY or a new one — is refused by name,
// on `--proof` too. It runs before the fonts are staged into the app directory.
try {
  for (const cap of CAPTURES) assertCaptureDefines([...defines, ...(NATIVE ? storeViewDefineArgs(cap) : [])]);
} catch (e) {
  if (!(e instanceof CaptureBackendRefused)) throw e;
  fail([`a dart-define this run would pass is outside the capture allowlist.`, e.message]);
}

// 🔴 THE APP MUST HAVE A FONT TO DRAW TEXT WITH, AND SINCE 2026-09-12 IT HAD
// NONE. `web/flutter_bootstrap.js` sends the engine's fallback fonts — ROBOTO
// included, and this app declares no fonts of its own — to the relative path
// `fallback-fonts/`, which only `deploy-web.yml` ever fills, on a `build/web`
// this lane never produces. The dev server answers that path with `index.html`
// (200 text/html, not a 404), so the engine got HTML where a woff2 should be and
// drew nothing: every frame captured since is textless while the ICONS, which
// are a real bundled asset under `assets/`, render fine. The full diagnosis, the
// byte sizes and the dev-server branch that does it are in capture-fallback-fonts.mjs.
//
// Staging is a hard requirement, not best-effort: the failure it prevents is
// SILENT, so a font that could not be placed must stop the run rather than
// produce a listing asset with no text on it.
//
// 🔴 WEB ONLY. The bug is a WEB bug — the engine fetching `fallback-fonts/` from
// a dev server that answers it with `index.html`. A native build carries its
// fonts in the bundle and never makes that request, so staging 23 MB into a
// tracked app directory would be 23 MB of risk bought for nothing.
if (!NATIVE) await stageFallbackFonts({ appDir, log: (m) => console.log(m) });

/** ONE chromedriver, one drive PER VIEWPORT. The browser dimension is a launch
 *  argument, so a second size is a second drive — there is no mid-run resize
 *  that `binding.takeScreenshot` would honour. The driver process is started
 *  once and reused, because the handshake is the slow part and a second
 *  chromedriver on the same port would simply fail to bind. */
try {
  if (!NATIVE && !(await waitForDriver())) {
    fail([`chromedriver did not become ready on port 4444.`, cdErr.trim() || '(no stderr)']);
  }
  writeLedger();
  for (const cap of CAPTURES) {
    const dir = join(baseDir, SET_DIRS[cap.type]);
    // ⚠️ THE DIMENSION LEVER IS NOT THE SAME LEVER ON A NATIVE DRIVE, and that
    // is the one thing this branch must say out loud. On web, the frame size is
    // an ARGUMENT to this process: `--browser-dimension` sets it and the number
    // in the register is a prediction this script then verifies. On Linux,
    // Windows and macOS there is no such flag and the window is whatever the
    // runner's desktop allows, so the lever is `STORE_CAPTURE_VIEW`:
    // `storeViewDefineArgs(cap)` builds it from this capture's register
    // geometry, the suite imposes it on the view, and its layer shutter
    // (integration_test/store_frame_shutter.dart) refuses a root layer of any
    // other size. It is per capture, so it is spread here rather than pushed
    // into `defines`, which is built once for every capture. A simulator gets
    // `[]`: its model is its size, and it photographs through the plugin.
    // `acceptedSizes` on the set is still what makes a wrong size a RED run.
    const args = NATIVE
      ? [
          'drive',
          '--driver=test_driver/store_screenshots.dart',
          '--target=integration_test/store_screenshots_test.dart',
          '-d', cap.flutterDevice,
          ...defines,
          ...storeViewDefineArgs(cap),
        ]
      : [
          'drive',
          '--driver=test_driver/store_screenshots.dart',
          '--target=integration_test/store_screenshots_test.dart',
          '-d', 'web-server',
          '--browser-name=chrome',
          // THE DIMENSION LEVER. `flutter drive --help`: "The dimension of the browser
          // when running a Flutter Web test … This will affect screenshot dimensions".
          `--browser-dimension=${cap.cssWidth}x${cap.cssHeight}@${cap.dpr}`,
          '--driver-port=4444',
          ...defines,
        ];
    console.log('');
    console.log(`── ${cap.type}: ${cap.cssWidth}x${cap.cssHeight}@${cap.dpr} → ${dir.replace(ROOT, '.')}`);
    // 🔴 THE VALUE IS REDACTED, THE KEY IS NOT — AND THAT USED TO BE THE OTHER
    // WAY ROUND, WHICH COST A DIAGNOSIS ON 2026-08-26 AND PRINTED A PASSWORD.
    // This line was
    // `args.filter((a) => !/=(?:ey|https?:\/\/|.*password)/i.test(a))`. It
    // dropped a whole `KEY=value` TOKEN whenever the VALUE began `ey` or
    // `http(s)://`, or contained the string "password" — and left the bare
    // `--dart-define` that preceded it. Re-run against this script's own
    // `defines` array (measured, not remembered — the real values stand in for
    // themselves), that filter emits:
    //
    //   flutter drive … --driver-port=4444 --dart-define --dart-define
    //   --dart-define --dart-define E2E_EMAIL=subscriptiontracker-e2e+7@nikatru.com
    //   --dart-define E2E_PASSWORD=<the password, in clear>
    //
    // TWO defects in one line, and the second is the serious one:
    //
    //   1. DIAGNOSTIC. SUPABASE_URL, SUPABASE_ANON_KEY and API_BASE_URL vanish
    //      from a line that still shows four of their flags. That reads exactly
    //      like a lane launched with API_BASE_URL missing — a real and very
    //      different failure (an app that signs in and can reach no API) — and
    //      it was chased as one before `need` above was re-read: this script
    //      refused to start without all five, so they could not be absent
    //      here. (Since 2026-09-25 `need` holds four, and API_BASE_URL is the
    //      sandbox host this script computes or refuses to run without — see
    //      "THE BACKEND IS COMPUTED".) A redaction whose output is
    //      indistinguishable from a bug is worse than no line at all.
    //   2. SECRET. `.*password` can only match text that follows an `=`, so the
    //      KEY name in `E2E_PASSWORD=…` never triggered it — the VALUE was
    //      printed in full, into a CI step log, on every live run. It was
    //      redacted only by accident, on the runs where the password happened
    //      to start with `ey`. E2E_EMAIL was printed in full for the same
    //      reason. So the mapper below is a leak fix, not only a legibility
    //      one.
    //
    // ⬜ WHAT THE MAPPER COVERS, EXACTLY, AND WHAT IT DOES NOT. It rewrites a
    // token that is `KEY=value`, and a token that is `--dart-define=KEY=value`.
    // Those are the two shapes Flutter accepts for a define: this script builds
    // only the first today (`pass()` pushes the flag and the pair as SEPARATE
    // argv entries), and the second is handled.
    // It does NOT cover a secret carried in any other shape: a bare positional,
    // or a flag whose value is a SEPARATE token (`--flag secret`), which is
    // indistinguishable here from `web-server`. Nothing in `args` is built that
    // way; a future one must be redacted where it is added, not here.
    // `true`/`false` values are left visible so STORE_CAPTURE_ALLOW_DEMO reads.
    // APP_VERSION is left visible too: the stamp is not a secret, and this line
    // is where a reader of the log sees what the drive's rows are stamped with.
    const redactDefine = (a) => {
      const m = /^(--dart-define=)?([A-Za-z_][A-Za-z0-9_]*)=([\s\S]*)$/.exec(a);
      if (!m) return a;
      return m[2] === 'APP_VERSION' || m[3] === 'true' || m[3] === 'false' ? a : `${m[1] ?? ''}${m[2]}=<redacted>`;
    };
    console.log(`flutter ${args.map(redactDefine).join(' ')}`);
    // Recorded BEFORE the drive: if the job is cancelled mid-drive, the ledger
    // still names the board record the purge must read the install id from.
    const record = boardFileFor(boardDir, cap);
    const drive = { viewport: cap.type, record, state: 'driving' };
    if (LEDGER) {
      ledger.drives.push(drive);
      writeLedger();
    }
    // `shell: true` on Windows is REQUIRED, not sloppiness, and Node prints a
    // deprecation warning about it that invites exactly the wrong fix. `flutter`
    // on Windows is `flutter.bat`, and Node has refused to spawn `.bat`/`.cmd`
    // without a shell since 20.12.2 (CVE-2024-27980) — dropping the flag makes
    // this throw EINVAL on the owner's only machine. The arguments are built here
    // from a fixed list, not from user input.
    const run = spawnSync('flutter', args, {
      cwd: appDir,
      stdio: 'inherit',
      shell: process.platform === 'win32',
      env: {
        ...process.env,
        STORE_SHOT_DIR: dir.replace(/\\/g, '/'),
        // 🔴 ONE PATH PER VIEWPORT, AND NOT INSIDE THE LISTING DIRECTORY. The
        // driver's default writes ONE build/integration_response_data.json,
        // which the second drive overwrites — two viewports sharing one output
        // file, the exact shape of the bug this record was added to catch. And
        // the listing directory is wrong for a second reason: the pre-drive
        // clean above deletes `*.png` from it and nothing else, so a stale
        // record would survive a run that produced none and be read as that
        // run's. See capture-board-parity.mjs.
        STORE_BOARD_FILE: boardFileFor(boardDir, cap).replace(/\\/g, '/'),
      },
    });
    // BEFORE the status check below, which `fail()`s out at the first failing
    // viewport: a failed drive may still have answered the prompt, and its
    // board record (written on failure too) is the only copy of the id.
    if (LEDGER) {
      let rec = null;
      try {
        rec = JSON.parse(readFileSync(record, 'utf8'));
      } catch {
        rec = null;
      }
      Object.assign(drive, {
        state: 'done',
        exit: run.status,
        consent_prompt: rec?.consent_prompt ?? null,
        consent_anon_id: rec?.consent_anon_id ?? null,
      });
      writeLedger();
    }
    const exitCode = run.status ?? 1;
    // Stop at the FIRST failing viewport. Continuing would leave a half-captured
    // listing whose later sets look complete, and the failure below names the
    // viewport rather than "the capture".
    if (exitCode !== 0) {
      fail([
        `flutter drive exited ${exitCode} for the "${cap.type}" viewport ` +
          `(${cap.cssWidth}x${cap.cssHeight}@${cap.dpr}) — no complete screenshot set was produced.`,
        'The suite drives the real app, so this is usually the APP failing rather than the harness: a modal',
        'over the tree, a sign-in that did not complete, or a backend that is down. A failure on ONE viewport',
        'and not the other is the interesting case — it means the app behaves differently at that width, which',
        'is precisely what a second device type was added to photograph.',
        '',
        'THE THIRD ANSWER, ADDED AFTER RUN 32961461714 (2026-08-26): the SUITE, tapping a control that is in',
        'the tree and off the screen. That run typed six subscriptions into the add sheet and submitted none',
        'of them, because at 360x640 the sheet submit button lays out 160 px below the bottom of the screen.',
        'The phone viewport is the SHORTEST geometry anything in this repository drives (the nightly E2E runs',
        'Chrome at 430x932), so this lane is where that class surfaces first.',
        '',
        'That run produced no error because `tester.tap` only WARNS on a miss, and the warning goes to the',
        'app-side console (browser) rather than to this log — it is not that the framework said nothing, it',
        'is that it did not say it here. Two things changed after it: the suite now sets',
        '`WidgetController.hitTestWarningShouldBeFatal = true`, so a missed tap THROWS at the tap, and the',
        'add flow carries explicit reachability limbs. Note `tester.enterText` still does not tap at all, so',
        'an off-screen FIELD accepts text silently either way — that is the half that let six rows be typed.',
        'Read the failing assertion for a control that was FOUND: `findsOneWidget` on a finder and',
        '`hitTestable()` on the same finder are different questions, and only the second one is about a finger.',
      ]);
    }
  }
} finally {
  cd?.kill();
  // The staged fonts are ~23 MB of upstream bytes inside a tracked app
  // directory. They exist only for the drives above, so they are removed
  // whether those succeeded or not — a crashed capture must not leave them.
  // Unconditional even on a native run, where nothing staged them: the whole
  // point of this limb is that it cleans a directory it did not have to trust.
  unstageFallbackFonts(appDir);
}

// ── flatten and verify, per device type ─────────────────────────────────────
// WebDriver hands back RGBA. Google requires "24-bit PNG (no alpha)", so every
// capture is re-emitted opaque at its own size before anything checks it.
const problems = [];
const measured = [];
// ⏱ 2026-09-22 · A `--proof` run that could not run a check it should have.
// Not a failure of the set (exit 1), a hole in what was examined (exit 2), the
// same split capture-fallback-fonts.mjs makes with its `CoverageLost`.
const coverageLost = [];

for (const cap of CAPTURES) {
  const dir = join(baseDir, SET_DIRS[cap.type]);
  const rel = `${SET_DIRS[cap.type]}/`;
  const shots = readdirSync(dir).filter((f) => f.endsWith('.png')).sort();
  if (shots.length === 0) {
    // 🔴 RECORDED, NOT THROWN — and that changed with the second viewport. This
    // used to `fail()` on the spot, which was right while there was one set and
    // wrong the moment there were two: dying here means the OTHER set is never
    // examined, so a run with two broken viewports reports one. It is no less
    // fatal (`problems` is checked before a single byte of provenance is
    // written), and it still says why an empty set is the dangerous case rather
    // than merely a small one.
    problems.push(
      `the drive succeeded and produced ZERO screenshots for the "${cap.type}" viewport (${rel}). Every ` +
        'per-frame check would range over nothing and report a compliant set. Either the driver never ' +
        'received a takeScreenshot call, or STORE_SHOT_DIR did not reach it.',
    );
    measured.push({ cap, dir, rel, shots, pixels: null });
    continue;
  }

  // The rules that govern THIS set: the general ones always, tightened by
  // whatever the device type's own paragraph states. `Math.max`/`Math.min`
  // rather than a choice, so a set is inside BOTH readings and this file never
  // has to decide which of two published numbers wins.
  const minSide = Math.max(GENERAL.minSide, cap.rules.minSide ?? 0);
  const maxSide = Math.min(GENERAL.maxSide, cap.rules.maxSide ?? Infinity);
  const aspect = cap.rules.portraitAspect ?? null;

  /** Every frame in a set is one capture at one viewport, so they must all be
   *  the same size. `CAPTURE.json` records ONE `pixels` string and
   *  assert-listing-assets.mjs compares every frame to it — a set with two
   *  sizes in it produces a provenance record that is wrong about some of the
   *  bytes it sits next to. */
  const sizes = new Set();

  // WHAT WAS ON SCREEN, read back from the file this viewport's driver wrote.
  // A record that is absent or unparseable is recorded as `null` and NOT as an
  // empty board: `boardParityProblems` names absence as its own problem, and
  // "the drive wrote no record" must never reduce to "the board was empty",
  // which is a sentence about the app that nothing here observed.
  //
  // ⏱ 2026-09-22 · READ BEFORE THE FRAMES, NOT AFTER THEM. The record now also
  // carries `folds`, the per-frame geometry the row-edge check below needs
  // inside the loop. Nothing else about the read changed.
  let record = null;
  const boardFile = boardFileFor(boardDir, cap);
  if (existsSync(boardFile)) {
    try {
      record = JSON.parse(readFileSync(boardFile, 'utf8'));
    } catch (e) {
      problems.push(`the "${cap.type}" viewport's board record at ${boardFile} is not readable JSON: ${e.message}`);
    }
  }
  const folds = foldsOf(record);
  if (!folds) {
    const why =
      `the "${cap.type}" viewport's drive published no fold geometry (\`folds\` in ${boardFile}), so NO frame ` +
      'of this set was examined for a card cut by the page edge. The suite records it on both postures ' +
      '(`recordFold` in store_screenshots_test.dart), so its absence is a regression, not a demo-build gap.';
    if (PROOF) coverageLost.push(why);
    else problems.push(why);
  }

  for (const name of shots) {
    const file = join(dir, name);
    const before = pngHeader(readFileSync(file));
    if (!before) {
      problems.push(`${rel}${name} is not a readable PNG`);
      continue;
    }
    if (before.hasAlpha) {
      try {
        flattenToOpaque({ src: readFileSync(file), out: file, width: before.width, height: before.height });
      } catch (e) {
        if (e instanceof RasterUnavailable) fail(e.lines);
        throw e;
      }
    }
    const h = pngHeader(readFileSync(file));
    const min = Math.min(h.width, h.height);
    const max = Math.max(h.width, h.height);
    sizes.add(`${h.width}x${h.height}`);
    if (h.hasAlpha) problems.push(`${rel}${name} still carries an alpha channel (colour type ${h.colourType}) — Play requires "24-bit PNG (no alpha)"`);
    if (min < minSide) problems.push(`${rel}${name} is ${h.width}x${h.height}; the minimum side for the "${cap.type}" set is ${minSide}px. Source: ${cap.rules.source} (fetched ${cap.rules.fetched})`);
    if (max > maxSide) problems.push(`${rel}${name} is ${h.width}x${h.height}; the maximum side for the "${cap.type}" set is ${maxSide}px. Source: ${cap.rules.source} (fetched ${cap.rules.fetched})`);
    if (max > min * GENERAL.maxAspect) problems.push(`${rel}${name} is ${h.width}x${h.height}; ${
          CHANNEL === 'android-play'
            ? `Play: "The maximum dimension of your screenshot can't be more than twice as long as the minimum dimension"`
            : `${STORE_LABEL} accepts a long side at most ${GENERAL.maxAspect}x the short side`
        }`);
    // An exact ratio is only asserted where the page states one. The viewport is
    // chosen to produce it exactly (900x1600 → 1800x3200 is 9:16), so this fires
    // on a geometry change rather than on rounding — and if `--browser-dimension`
    // ever returns something a pixel off, that is a fact worth learning loudly
    // rather than absorbing into a tolerance nobody sourced.
    if (aspect && h.width * aspect.h !== h.height * aspect.w) {
      problems.push(
        `${rel}${name} is ${h.width}x${h.height}, which is not ${aspect.w}:${aspect.h}. Play, verbatim: ` +
          `"${cap.rules.verbatim}". The viewport ${cap.cssWidth}x${cap.cssHeight}@${cap.dpr} is chosen to land ` +
          `exactly on that ratio, so a frame off it means the drive did not honour the dimension.`,
      );
    }
    // ── 🔴 NO ALARM BANNER ACROSS THE TOP OF THE FRAME ────────────────────
    // Measured in the PIXELS, after the flatten, so no CAPTURE.json and no
    // define can talk it away — and deliberately NOT a check that the define
    // above was passed. The define is the cause-side fix and this is the
    // effect-side one; a future banner from some other source would walk past
    // a check that only asked about the flag.
    let band = null;
    let img = null;
    try {
      img = decodeRgba(readFileSync(file));
      band = scanTopBand(img);
    } catch (e) {
      if (e instanceof PngUnreadable) {
        problems.push(
          `${rel}${name} could not be decoded, so it was never examined for an offline banner: ${e.lines?.[0] ?? e.message}. ` +
            'A frame this capture cannot look at must not be reported as one it looked at.',
        );
      } else throw e;
    }
    if (band?.banner) {
      problems.push(
        `${rel}${name} carries a FULL-WIDTH ${band.colour} BAND across the top of the frame ` +
          `(${(band.fraction * 100).toFixed(1)}% of a row, red lead ${band.redLead}, threshold ` +
          `${(BAND_ROW_FRACTION * 100).toFixed(0)}%). That is an ALARM surface on a store listing. The one this ` +
          'lane has produced since it began is `OfflineNotice` reading "Could not reach the network. Some ' +
          'things may be out of date." — the app telling a prospective customer the product does not work, in ' +
          'the first thing their eye lands on. Its cause and the lever that removes it are in ' +
          'tooling/store/capture-network-posture.mjs; a band of a DIFFERENT colour is a different banner and ' +
          'needs reading before it is dismissed.',
      );
    }
    // ── 🔴 NO CARD CUT BY THE FOLD WITH NOTHING OVER IT (⏱ 2026-09-22) ─────
    // O-STORE-FRAME-FAB, measured in the flattened pixels like the banner. The
    // fold comes from the suite's record; a frame the record does not name is
    // a frame nobody examined, and is said so.
    let edge = null;
    if (img && folds) {
      const fold = foldFor(folds, name);
      if (!fold) {
        problems.push(
          `${rel}${name} has no entry in the drive's fold geometry, so it was NOT examined for a card cut by the ` +
            'page edge. Every frame written must be followed by `recordFold` in store_screenshots_test.dart.',
        );
      } else {
        const r = foldLineProblems(img, fold, `${rel}${name}`);
        edge = r.scan;
        problems.push(...r.problems);
      }
    }
    console.log(
      `   ${rel}${name} — ${h.width}x${h.height}, colour type ${h.colourType}, ${h.bytes} bytes` +
        (band ? `, top band ${band.colour} ${(band.fraction * 100).toFixed(1)}%/red${band.redLead >= 0 ? '+' : ''}${band.redLead}` : '') +
        (edge ? `, fold rows ${edge.rows[0]}..${edge.rows[1] - 1} ${edge.off}/${edge.examined} off (worst ${edge.worst})` : ''),
    );
  }

  if (sizes.size > 1) {
    problems.push(
      `${rel} holds frames at ${sizes.size} different sizes (${[...sizes].join(', ')}). One capture at one ` +
        'viewport produces one size, so this set was not produced by a single run — and its CAPTURE.json can ' +
        'only ever be right about some of it.',
    );
  }

  // Counts are PER DEVICE TYPE: Google's "up to 8 screenshots for each supported
  // device type", and the per-type floor each paragraph states.
  const floor = Math.max(GENERAL.minToPublish, cap.rules.minCount ?? 0);
  if (shots.length < floor) {
    problems.push(
      `${rel} holds ${shots.length} screenshot(s) and the "${cap.type}" set needs at least ${floor}. ` +
        `Source: ${cap.rules.source} (fetched ${cap.rules.fetched})` +
        (cap.rules.verbatim ? ` — verbatim: "${cap.rules.verbatim}"` : ''),
    );
  }
  if (shots.length > GENERAL.maxPerDeviceType) {
    problems.push(`${rel} holds ${shots.length} screenshots; Play accepts "up to 8 screenshots for each supported device type"`);
  }

  measured.push({ cap, dir, rel, shots, pixels: sizes.size === 1 ? [...sizes][0] : null, record });
}

// ── 🔴 THE TWO VIEWPORTS PHOTOGRAPHED THE SAME BOARD ────────────────────────
//
// THE CHECK THAT CATCHES THE CLASS, AND THE ONE THIS LANE DID NOT HAVE.
// Every frame merged as 9f548515 (#854) satisfied every check above and below:
// four per set, right size, right aspect, 24-bit, no demo band, enough ink. And
// the tablet set showed `12 active` and `$186.94` against the phone set's
// `6 active` and `$93.47` — the same six illustrative rows, seeded a second
// time because each viewport is its own `flutter drive` against one account and
// nothing cleared the board between them.
//
// It was caught by a human opening the PNGs. It could not have been caught here:
// no guard in this tree reads TEXT out of an image, and CAPTURE.json recorded
// nothing about what was on the screen. Re-capturing fixes the instance; this
// limb is what fails the NEXT divergence without anybody counting rows.
//
// ⬜ SKIPPED ON `--proof`, AND SAID RATHER THAN LEFT TO BE DEDUCED. A proof run
// is a demo build, so the suite's seeding block — and the board record it
// publishes at the end of it — never execute. Comparing two absent boards would
// red the mechanism lane forever over a record that cannot exist, and a check
// that blocks correct work is a check somebody deletes.
if (PROOF) {
  console.log('');
  console.log('⬜ COVERAGE LOST (--proof): the demo build publishes no board record, so the two-viewport');
  console.log('   board-parity check did not run. A proof run cannot tell you whether the phone and tablet');
  console.log('   sets photograph the same board — that is the live lane\'s answer and only the live lane\'s.');
} else {
  problems.push(...boardParityProblems(measured.map((m) => ({ type: m.cap.type, record: m.record }))));
}

// ── 🔴 THE CHECK THE OLD ONE-VIEWPORT SCRIPT COULD NOT MAKE ─────────────────
// "a minimum of two screenshots ACROSS DIFFERENT DEVICE TYPES". A single set of
// eight phone frames satisfies every per-set count above and cannot be
// published. The number is the register's `minDistinctTypes`, read rather than
// re-declared, so this script and assert-play-device-coverage.mjs enforce one
// number from one citation.
//
// ⚠️ WHAT THIS LIMB ADDS, STATED PLAINLY SO NOBODY MISTAKES IT FOR DETECTION.
// A set can only be uncovered here by being empty, and an empty set already
// pushed a problem above — so this cannot change a green run into a red one.
// What it adds is the CONSEQUENCE: "one viewport wrote nothing" and "this
// listing cannot be published" are different sentences, and only the second one
// says why the run mattered. The limb that CAN change the verdict on its own is
// the pre-flight in `deviceTypeSets()`, which refuses before the browser starts
// if the register asks for more device types than this script has viewports.
const typesWithPixels = measured.filter((m) => m.shots.length > 0);
if (MIN_DISTINCT_TYPES !== null && typesWithPixels.length < MIN_DISTINCT_TYPES) {
  problems.push(
    `this run produced pixels for ${typesWithPixels.length} device type(s) — ` +
      `${typesWithPixels.map((m) => m.cap.type).join(', ') || 'none'} — and Play requires at least ` +
      `${MIN_DISTINCT_TYPES}. Source: ${COVERAGE_SOURCE ?? GENERAL.source}`,
  );
}

if (problems.length) {
  console.error('');
  for (const p of problems) console.error(`FAIL ${p}`);
  console.error(
    `\nSource for every number: ${GENERAL.source}${
      CHANNEL === 'android-play'
        ? ` (general, fetched ${GENERAL.fetched}; tablet paragraph re-fetched ${PLAY_TABLET_SCREENSHOTS.fetched})`
        : ` (read from ${REGISTER}, which carries its own dated source beside every number)`
    }`,
  );
  process.exit(1);
}

// A capture that reached here is compliant. Record HOW it was made next to it,
// because a PNG carries no evidence of its own posture and "was this the demo
// build?" is the one question that matters about a listing screenshot.
//
// ⚠️ ONE RECORD PER SET, IN THE SET'S OWN DIRECTORY. `assert-listing-assets.mjs`
// compares a record's `count` and `pixels` to the bytes beside it, so a single
// shared record at the channel root would be right about one set and wrong about
// the other — provenance that passes the guard and lies about the run, which the
// register's `_provenanceWhy` calls worse than no record at all.
if (!PROOF) {
  for (const m of measured) {
    writeFileSync(
      join(m.dir, 'CAPTURE.json'),
      `${JSON.stringify(
        {
          capturedBy: 'tooling/store/capture-play-screenshots.mjs',
          posture: 'live',
          deviceType: m.cap.type,
          viewport: `${m.cap.cssWidth}x${m.cap.cssHeight}@${m.cap.dpr}`,
          // MEASURED off the frames, not computed from the viewport. The two
          // agree today; if `--browser-dimension` ever stops honouring the dpr,
          // a record that reported the intent would hide it and a record that
          // reports the pixels puts it in front of the next reader.
          pixels: m.pixels,
          count: m.shots.length,
          // 🔴 WHAT WAS ON THE SCREEN, WHICH THIS RECORD DID NOT SAY UNTIL
          // TODAY. Every field above is about the BYTES — how many, how big,
          // built by what. Two records could describe two completely different
          // boards and agree in all of them, and on 9f548515 two of them did:
          // the phone set's `6 active` / `$93.47` and the tablet set's
          // `12 active` / `$186.94` produced identical CAPTURE.json bodies but
          // for the device type and the viewport.
          //
          // The parity check above has already refused a run whose viewports
          // disagree, so this is provenance rather than a gate — it is here so
          // the next reader can ask what a COMMITTED set shows without opening
          // a PNG and counting rows, which is the only way #854 was ever found.
          board: boardProvenance(boardOf(m.record)),
          requirements: { source: m.cap.rules.source, fetched: m.cap.rules.fetched },
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
  }
}

console.log('');
for (const m of measured) {
  console.log(`   ${m.cap.type}: ${m.shots.length} screenshot(s) at ${m.pixels ?? '(mixed)'} in ${m.dir.replace(ROOT, '.')}`);
  // Printed per viewport rather than once, because the two lines standing
  // beside each other is the whole point: on the run that produced #854 they
  // would have read `6 active` and `12 active`, in the step log, at the moment
  // of capture.
  const b = boardOf(m.record);
  if (b) {
    const money = Object.entries(b.monthlyTotalMinorUnits ?? {})
      .map(([code, units]) => `${code} ${units} minor units`)
      .join(' + ');
    console.log(
      `      board: ${b.activeCount} subscription(s), ${money || '(no total recorded)'}` +
        ` — ${b.seededThisDrive} seeded by this drive, ${b.alreadyPresent} already present`,
    );
  } else {
    console.log('      board: (no record — the drive wrote none, which is normal only on --proof)');
  }
}
console.log(`   device types covered: ${typesWithPixels.length}${MIN_DISTINCT_TYPES !== null ? ` of the ${MIN_DISTINCT_TYPES} ${STORE_LABEL} requires across different device types` : ''}`);
console.log(`   posture: ${PROOF ? 'DEMO — MECHANISM PROOF ONLY, these bytes must not be uploaded' : 'LIVE'}`);
console.log(`   ${STORE_LABEL} requirements: ${GENERAL.source}${
    CHANNEL === 'android-play' ? ` (general fetched ${GENERAL.fetched}, tablet paragraph ${PLAY_TABLET_SCREENSHOTS.fetched})` : ''
  }`);
for (const m of measured) {
  if (m.shots.length < GENERAL.recommendedCount) {
    console.log(`   ⬜ ${m.cap.type}: ${m.shots.length} of the ${GENERAL.recommendedCount} ${
        CHANNEL === 'android-play' ? 'Google recommends for large-format recommendation surfaces' : `recommended for the ${STORE_LABEL} listing`
      }`);
  }
}
console.log('   ⚠️ this script proves SIZE, FORMAT, COUNT and POSTURE. It cannot judge whether the set is');
console.log('      REPRESENTATIVE — that the screens chosen are the ones worth showing is a human call.');
console.log('   ⚠️ NOR CAN IT SEE WHICH PHYSICAL DEVICE A VIEWPORT IS. A browser at 900 CSS px lays the app out');
console.log('      the way a tablet does; nothing in the bytes says it is a tablet, and Play files a screenshot');
console.log('      by the console slot it is uploaded to. The set is a promise about where a type\'s shots live.');
if (coverageLost.length) {
  console.error('');
  for (const c of coverageLost) console.error(`COVERAGE LOST (--proof): ${c}`);
  process.exit(2);
}
console.log('\ncapture-play-screenshots: ok');
