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
//   default   requires a LIVE build (SUPABASE_URL + SUPABASE_ANON_KEY +
//             API_BASE_URL + a confirmed account) and writes into the listing
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
//   node tooling/store/capture-play-screenshots.mjs --app subly --out BASE
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
import { scanCaptureSuite, selfTestAccountAddressDetector } from './capture-suite-scan.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(join(HERE, '..', '..'));

const argv = process.argv.slice(2);
const PROOF = argv.includes('--proof');
const arg = (name, dflt) => {
  const i = argv.indexOf(name);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : dflt;
};
const app = arg('--app', 'subly');

/** The channel whose listing this captures. The register's contract is keyed by
 *  it, and so is the set map every directory below is read from. */
const CHANNEL = 'android-play';
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

/** One entry per DEVICE TYPE. The `type` key must name a set in the register,
 *  and the register is where that set's directory lives — never here. */
export const CAPTURES = [
  { type: 'phone', cssWidth: 360, cssHeight: 640, dpr: 3, rules: PLAY_SCREENSHOTS },
  { type: 'tablet', cssWidth: 900, cssHeight: 1600, dpr: 2, rules: PLAY_TABLET_SCREENSHOTS },
];

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
const need = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'API_BASE_URL', 'E2E_EMAIL', 'E2E_PASSWORD'];
const missing = need.filter((k) => !process.env[k]);
if (!PROOF && missing.length) {
  fail([
    `a live capture needs ${missing.join(', ')} and they are not set.`,
    '',
    'THIS IS NOT A CONFIGURATION NAG — a demo build is a different app on screen. AppConfig.isBackendLive',
    'is a compile-time constant over exactly these defines, and with them absent the app runs MockAuth +',
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
// frame read `subly-e2e+…@nikatru.com` — an internal test address on a Play
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
  const scan = scanCaptureSuite({ root: ROOT, app });
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

// 🔴 CHROMEDRIVER IS RESOLVED BEFORE ANY BYTES ARE DELETED. It used to be
// resolved after, which meant a machine without chromedriver — the owner's, as
// measured 2026-08-21: not on PATH, CHROMEDRIVER unset — EMPTIED THE PUBLISHED
// LISTING DIRECTORY and then refused. The refusal was correct and the tree was
// left worse than before it ran. Every check that can be made without
// destroying anything belongs above the line that destroys something.
const driver = chromedriverPath();
console.log(`chromedriver: ${driver}`);

for (const cap of CAPTURES) {
  const dir = join(baseDir, SET_DIRS[cap.type]);
  mkdirSync(dir, { recursive: true });
  // Start from an empty directory. A stale PNG from a previous UI would otherwise
  // survive a run that no longer captures that screen, and the guard downstream
  // would happily certify its dimensions — a screenshot of a screen the app no
  // longer has, correctly sized.
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.png'))) unlinkSync(join(dir, f));
}

const cd = spawn(driver, ['--port=4444', '--silent'], { stdio: 'pipe' });
let cdErr = '';
cd.stderr.on('data', (d) => (cdErr += d.toString()));

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
if (PROOF) defines.push('--dart-define', 'STORE_CAPTURE_ALLOW_DEMO=true');

/** ONE chromedriver, one drive PER VIEWPORT. The browser dimension is a launch
 *  argument, so a second size is a second drive — there is no mid-run resize
 *  that `binding.takeScreenshot` would honour. The driver process is started
 *  once and reused, because the handshake is the slow part and a second
 *  chromedriver on the same port would simply fail to bind. */
let exitCode = 1;
try {
  if (!(await waitForDriver())) {
    fail([`chromedriver did not become ready on port 4444.`, cdErr.trim() || '(no stderr)']);
  }
  for (const cap of CAPTURES) {
    const dir = join(baseDir, SET_DIRS[cap.type]);
    const args = [
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
    console.log(`flutter ${args.filter((a) => !/=(?:ey|https?:\/\/|.*password)/i.test(a)).join(' ')}`);
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
      env: { ...process.env, STORE_SHOT_DIR: dir.replace(/\\/g, '/') },
    });
    exitCode = run.status ?? 1;
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
      ]);
    }
  }
} finally {
  cd.kill();
}

// ── flatten and verify, per device type ─────────────────────────────────────
// WebDriver hands back RGBA. Google requires "24-bit PNG (no alpha)", so every
// capture is re-emitted opaque at its own size before anything checks it.
const problems = [];
const measured = [];

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
  const minSide = Math.max(PLAY_SCREENSHOTS.minSide, cap.rules.minSide ?? 0);
  const maxSide = Math.min(PLAY_SCREENSHOTS.maxSide, cap.rules.maxSide ?? Infinity);
  const aspect = cap.rules.portraitAspect ?? null;

  /** Every frame in a set is one capture at one viewport, so they must all be
   *  the same size. `CAPTURE.json` records ONE `pixels` string and
   *  assert-listing-assets.mjs compares every frame to it — a set with two
   *  sizes in it produces a provenance record that is wrong about some of the
   *  bytes it sits next to. */
  const sizes = new Set();

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
    if (max > min * PLAY_SCREENSHOTS.maxAspect) problems.push(`${rel}${name} is ${h.width}x${h.height}; Play: "The maximum dimension of your screenshot can't be more than twice as long as the minimum dimension"`);
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
    console.log(`   ${rel}${name} — ${h.width}x${h.height}, colour type ${h.colourType}, ${h.bytes} bytes`);
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
  const floor = Math.max(PLAY_SCREENSHOTS.minToPublish, cap.rules.minCount ?? 0);
  if (shots.length < floor) {
    problems.push(
      `${rel} holds ${shots.length} screenshot(s) and the "${cap.type}" set needs at least ${floor}. ` +
        `Source: ${cap.rules.source} (fetched ${cap.rules.fetched})` +
        (cap.rules.verbatim ? ` — verbatim: "${cap.rules.verbatim}"` : ''),
    );
  }
  if (shots.length > PLAY_SCREENSHOTS.maxPerDeviceType) {
    problems.push(`${rel} holds ${shots.length} screenshots; Play accepts "up to 8 screenshots for each supported device type"`);
  }

  measured.push({ cap, dir, rel, shots, pixels: sizes.size === 1 ? [...sizes][0] : null });
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
      `${MIN_DISTINCT_TYPES}. Source: ${COVERAGE_SOURCE ?? PLAY_SCREENSHOTS.source}`,
  );
}

if (problems.length) {
  console.error('');
  for (const p of problems) console.error(`FAIL ${p}`);
  console.error(`\nSource for every number: ${PLAY_SCREENSHOTS.source} (general, fetched ${PLAY_SCREENSHOTS.fetched}; tablet paragraph re-fetched ${PLAY_TABLET_SCREENSHOTS.fetched})`);
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
}
console.log(`   device types covered: ${typesWithPixels.length}${MIN_DISTINCT_TYPES !== null ? ` of the ${MIN_DISTINCT_TYPES} Play requires across different device types` : ''}`);
console.log(`   posture: ${PROOF ? 'DEMO — MECHANISM PROOF ONLY, these bytes must not be uploaded' : 'LIVE'}`);
console.log(`   Play requirements: ${PLAY_SCREENSHOTS.source} (general fetched ${PLAY_SCREENSHOTS.fetched}, tablet paragraph ${PLAY_TABLET_SCREENSHOTS.fetched})`);
for (const m of measured) {
  if (m.shots.length < PLAY_SCREENSHOTS.recommendedCount) {
    console.log(`   ⬜ ${m.cap.type}: ${m.shots.length} of the ${PLAY_SCREENSHOTS.recommendedCount} Google recommends for large-format recommendation surfaces`);
  }
}
console.log('   ⚠️ this script proves SIZE, FORMAT, COUNT and POSTURE. It cannot judge whether the set is');
console.log('      REPRESENTATIVE — that the screens chosen are the ones worth showing is a human call.');
console.log('   ⚠️ NOR CAN IT SEE WHICH PHYSICAL DEVICE A VIEWPORT IS. A browser at 900 CSS px lays the app out');
console.log('      the way a tablet does; nothing in the bytes says it is a tablet, and Play files a screenshot');
console.log('      by the console slot it is uploaded to. The set is a promise about where a type\'s shots live.');
console.log('\ncapture-play-screenshots: ok');
