#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// capture-play-screenshots.mjs — the Play phone screenshot set, produced by a
// COMMAND rather than by somebody with a phone and a cropping tool.
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
// ── WHY THE DIMENSIONS ARE WHAT THEY ARE ────────────────────────────────────
// Every number below is from ONE primary page, fetched 2026-08-04:
//   https://support.google.com/googleplay/android-developer/answer/9866151
//
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
// 1080x1920 satisfies all of it: 9:16, ratio 1.78 (inside the ×2 ceiling), both
// sides inside 320..3840, and it is exactly the recommended portrait minimum.
// It is reached as CSS 360x640 at a device pixel ratio of 3 — `flutter drive`
// takes `--browser-dimension=WxH@dpr` and its own help says that "will affect
// screenshot dimensions". 360 CSS px is a real phone width, so the app lays out
// as a phone; capturing at 1080 CSS px would photograph the TABLET layout at
// phone dimensions, which is a lie that looks like a screenshot.
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
// The two are not a preference. `--proof` REFUSES to write to the listing
// directory even if asked, and the Dart suite refuses to run against a demo
// build unless the proof define is set, so neither half can be bypassed alone.
//
// Usage:
//   node tooling/store/capture-play-screenshots.mjs            # live → listing
//   node tooling/store/capture-play-screenshots.mjs --proof    # demo → temp
//   node tooling/store/capture-play-screenshots.mjs --app subly --out DIR
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync, unlinkSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
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

/** Play's screenshot rules. Sourced, or absent. */
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

/** The viewport that yields the recommended portrait size. */
const CAPTURE = { cssWidth: 360, cssHeight: 640, dpr: 3 };

const fail = (lines) => {
  console.error(`capture-play-screenshots: REFUSING — ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(`  ${l}`);
  process.exit(1);
};

// ── where the bytes go ──────────────────────────────────────────────────────
const listingDir = join(ROOT, 'apps', app, 'store', 'android-play', 'screenshots');
const proofDir = join(tmpdir(), `nk-shot-proof-${randomBytes(4).toString('hex')}`);
const outDir = resolve(arg('--out', PROOF ? proofDir : listingDir));

if (PROOF && outDir.startsWith(listingDir)) {
  fail([
    '--proof was asked to write into the live listing directory.',
    `${listingDir.replace(ROOT, '.')} is what gets uploaded to Google Play. A proof run captures a DEMO`,
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

mkdirSync(outDir, { recursive: true });
// Start from an empty directory. A stale PNG from a previous UI would otherwise
// survive a run that no longer captures that screen, and the guard downstream
// would happily certify its dimensions — a screenshot of a screen the app no
// longer has, correctly sized.
for (const f of readdirSync(outDir).filter((f) => f.endsWith('.png'))) unlinkSync(join(outDir, f));

const driver = chromedriverPath();
console.log(`chromedriver: ${driver}`);
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

let exitCode = 1;
try {
  if (!(await waitForDriver())) {
    fail([`chromedriver did not become ready on port 4444.`, cdErr.trim() || '(no stderr)']);
  }
  const args = [
    'drive',
    '--driver=test_driver/store_screenshots.dart',
    '--target=integration_test/store_screenshots_test.dart',
    '-d', 'web-server',
    '--browser-name=chrome',
    // THE DIMENSION LEVER. `flutter drive --help`: "The dimension of the browser
    // when running a Flutter Web test … This will affect screenshot dimensions".
    `--browser-dimension=${CAPTURE.cssWidth}x${CAPTURE.cssHeight}@${CAPTURE.dpr}`,
    '--driver-port=4444',
    ...defines,
  ];
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
    env: { ...process.env, STORE_SHOT_DIR: outDir.replace(/\\/g, '/') },
  });
  exitCode = run.status ?? 1;
} finally {
  cd.kill();
}

if (exitCode !== 0) {
  fail([
    `flutter drive exited ${exitCode} — no screenshot set was produced.`,
    'The suite drives the real app, so this is usually the APP failing rather than the harness: a modal',
    'over the tree, a sign-in that did not complete, or a backend that is down.',
  ]);
}

// ── flatten and verify ──────────────────────────────────────────────────────
// WebDriver hands back RGBA. Google requires "24-bit PNG (no alpha)", so every
// capture is re-emitted opaque at its own size before anything checks it.
const shots = readdirSync(outDir).filter((f) => f.endsWith('.png')).sort();
if (shots.length === 0) {
  fail([
    'the drive succeeded and produced ZERO screenshots.',
    'Every check below would range over nothing and report a compliant set. Either the driver never',
    'received a takeScreenshot call, or STORE_SHOT_DIR did not reach it.',
  ]);
}

const problems = [];
for (const name of shots) {
  const file = join(outDir, name);
  const before = pngHeader(readFileSync(file));
  if (!before) {
    problems.push(`${name} is not a readable PNG`);
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
  if (h.hasAlpha) problems.push(`${name} still carries an alpha channel (colour type ${h.colourType}) — Play requires "24-bit PNG (no alpha)"`);
  if (min < PLAY_SCREENSHOTS.minSide) problems.push(`${name} is ${h.width}x${h.height}; Play's "Minimum dimension" is ${PLAY_SCREENSHOTS.minSide}px`);
  if (max > PLAY_SCREENSHOTS.maxSide) problems.push(`${name} is ${h.width}x${h.height}; Play's "Maximum dimension" is ${PLAY_SCREENSHOTS.maxSide}px`);
  if (max > min * PLAY_SCREENSHOTS.maxAspect) problems.push(`${name} is ${h.width}x${h.height}; Play: "The maximum dimension of your screenshot can't be more than twice as long as the minimum dimension"`);
  console.log(`   ${name} — ${h.width}x${h.height}, colour type ${h.colourType}, ${h.bytes} bytes`);
}

if (shots.length < PLAY_SCREENSHOTS.minToPublish) {
  problems.push(`only ${shots.length} screenshot(s); Play requires "a minimum of two screenshots across different device types to publish your store listing"`);
}
if (shots.length > PLAY_SCREENSHOTS.maxPerDeviceType) {
  problems.push(`${shots.length} screenshots; Play accepts "up to 8 screenshots for each supported device type"`);
}

if (problems.length) {
  console.error('');
  for (const p of problems) console.error(`FAIL ${p}`);
  console.error(`\nSource for every number: ${PLAY_SCREENSHOTS.source} (fetched ${PLAY_SCREENSHOTS.fetched})`);
  process.exit(1);
}

// A capture that reached here is compliant. Record HOW it was made next to it,
// because a PNG carries no evidence of its own posture and "was this the demo
// build?" is the one question that matters about a listing screenshot.
if (!PROOF) {
  writeFileSync(
    join(outDir, 'CAPTURE.json'),
    `${JSON.stringify(
      {
        capturedBy: 'tooling/store/capture-play-screenshots.mjs',
        posture: 'live',
        viewport: `${CAPTURE.cssWidth}x${CAPTURE.cssHeight}@${CAPTURE.dpr}`,
        pixels: `${PLAY_SCREENSHOTS.recommendedPortrait.width}x${PLAY_SCREENSHOTS.recommendedPortrait.height}`,
        count: shots.length,
        requirements: { source: PLAY_SCREENSHOTS.source, fetched: PLAY_SCREENSHOTS.fetched },
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
}

console.log('');
console.log(`   ${shots.length} screenshot(s) in ${outDir.replace(ROOT, '.')}`);
console.log(`   posture: ${PROOF ? 'DEMO — MECHANISM PROOF ONLY, these bytes must not be uploaded' : 'LIVE'}`);
console.log(`   Play requirements: ${PLAY_SCREENSHOTS.source} (fetched ${PLAY_SCREENSHOTS.fetched})`);
if (shots.length < PLAY_SCREENSHOTS.recommendedCount) {
  console.log(`   ⬜ ${shots.length} of the ${PLAY_SCREENSHOTS.recommendedCount} Google recommends for large-format recommendation surfaces`);
}
console.log('   ⚠️ this script proves SIZE, FORMAT, COUNT and POSTURE. It cannot judge whether the set is');
console.log('      REPRESENTATIVE — that the screens chosen are the ones worth showing is a human call.');
console.log('\ncapture-play-screenshots: ok');
