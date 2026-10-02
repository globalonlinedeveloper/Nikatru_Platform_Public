#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// capture-ink-calibration.mjs — the served and glyphless calibration frames an
// ink class is judged against, captured at that class's own geometry.
//
//   node tooling/store/capture-ink-calibration.mjs --class ios-appstore/iphone \
//        [--class <channel>/<set> …] [--url <signed-out web app>] [--chrome-arg <flag> …]
//
// ── WHY THIS EXISTS, 2026-10-01 (row O-STORE-SCREENSHOTS) ───────────────────
// `tooling/ci/assert-listing-assets.mjs` judges every committed store frame
// against a floor computed from its class's calibration directory, and a frame
// whose set has no class is COVERAGE LOST. Each capture job in
// store-screenshots.yml runs that guard straight after it captures, so before
// this file the first iOS, macOS, Windows or Snap capture was certain to exit 2
// on a correct set: only the two Play classes had calibration frames, and those
// had been made by hand (Private/research/session-2026-09-23/frames-ink/) with
// no command in this tree that could make them again.
//
// ── WHAT IT CAPTURES, AND WHY THE WEB APP ───────────────────────────────────
// The register's `inkRule._why` fixes the method: the LIVE SIGNED-OUT web app at
// the class's geometry (`capture.logicalWidth` x `logicalHeight` at `dpr`), once
// as served and once with every font request answered 200 text/html — the
// defect of #567..#854, reproduced. Signed-in pages cannot be made glyphless
// without the E2E secrets, so the signed-out pages are walked: the consent
// prompt, the three onboarding pages, the sign-in page reached by Skip, and the
// reset-password and sign-up states behind it. The walk clicks through
// Flutter's semantics tree by button LABEL, and a label is the same string with
// or without a font, so both modes reach the same page. A page the app throws
// on without its fonts is dropped from both modes (see below); on 2026-10-01
// that was every sign-in page at every geometry, leaving four pairs.
//
// 🔴 IT WRITES NOTHING ANYWHERE BUT THE CALIBRATION DIRECTORY. Every request
// that is not GET, HEAD or OPTIONS is aborted before it leaves the browser, so
// declining the consent prompt cannot record a row in any backend, production or
// sandbox. The pages walked are the public signed-out ones; no account is used.
//
// ⚠️ CLASSES THAT SHARE A GEOMETRY MAY SHARE A DIRECTORY. The three desktop
// classes are all 1280x800 at DPR 2, and a calibration is a property of the
// geometry, not of the store that will show the frames. A directory named by
// two classes is captured once, and refused if their geometries differ.
//
// ⚠️ IT PRINTS A READING, NOT A VERDICT. The verdict on a calibration set — four
// frames per mode, the same names, the class's size, `minSeparation` — is
// assert-listing-assets.mjs's, which reads every declared class's calibration
// set whether or not frames have arrived. Run it after this.
//
// `--chrome-arg` passes a flag to Chromium unchanged; `CHROME_EXECUTABLE`
// names the browser (as in chrome-raster.mjs). Playwright is the fleet install
// at `_playwright/` (`cd _playwright && npm ci`).
// ─────────────────────────────────────────────────────────────────────────────
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

import { decodeRgba } from './png-codec.mjs';
import { measureFrameInk, removedInkRunMedian } from './frame-ink.mjs';
import { relaunchSingleThreaded } from '../ci/single-threaded-relaunch.mjs';

// The 9x9 mode filter hung a process at exit with V8 background tasks on
// (nodejs/node#54918, CI run 36192015901); every program that runs the ink
// metric relaunches single-threaded, as measure-frame-ink.mjs does.
const relaunched = relaunchSingleThreaded(import.meta.url, process.argv.slice(2), (lines) => {
  console.error(`capture-ink-calibration: REFUSING — ${lines[0]}`);
  for (const line of lines.slice(1)) console.error(`  ${line}`);
});
if (relaunched !== null) process.exit(relaunched);

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DEFAULT_URL = 'https://nikatru.com/subscriptiontracker/';
const MODES = ['served', 'glyphless'];

/** One walk per terminal branch: each step is [frame name, label to click
 *  BEFORE capturing it, label that proves the page arrived, { pass: true } for
 *  a page walked through and not captured]. */
const PASS = { pass: true };
const WALKS = [
  [
    ['00-consent', null, 'No thanks'],
    ['01-onboarding', 'No thanks', 'Next'],
    ['01b-onboarding-next', 'Next', 'Next'],
    ['01c-onboarding-last', 'Next', null],
  ],
  [
    ['00-consent', null, 'No thanks', PASS],
    ['01-onboarding', 'No thanks', 'Skip', PASS],
    ['02-after-skip', 'Skip', 'Forgot password?'],
    ['03-reset-password', 'Forgot password?', null],
  ],
  [
    ['00-consent', null, 'No thanks', PASS],
    ['01-onboarding', 'No thanks', 'Skip', PASS],
    ['02-after-skip', 'Skip', 'New here? Create account', PASS],
    ['03-sign-up', 'New here? Create account', null],
  ],
];
const CAPTURED = WALKS.flat().filter((s) => !s[3]?.pass).map((s) => s[0]);
/** The guard's own floor on calibration frames per mode. */
const MIN_PAIRS = 4;
const FONT_URL = /\.(ttf|otf|woff2?)(\?|#|$)/i;
const SETTLE_MS = 2500;

const fail = (lines) => {
  console.error(`capture-ink-calibration: REFUSING — ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(`  ${l}`);
  process.exit(1);
};

const argv = process.argv.slice(2);
const many = (flag) => argv.flatMap((a, i) => (a === flag && argv[i + 1] ? [argv[i + 1]] : []));
const keys = many('--class');
const url = many('--url')[0] ?? DEFAULT_URL;
const chromeArgs = many('--chrome-arg');
if (keys.length === 0) {
  fail(['no --class given.', 'usage: node tooling/store/capture-ink-calibration.mjs --class <channel>/<set> [--class …] [--url <url>] [--chrome-arg <flag> …]']);
}
if (!/^https:\/\/([a-z0-9-]+\.)*(nikatru\.com|pages\.dev)\//.test(url)) {
  fail([`--url ${url} is not one of our zones (nikatru.com or *.pages.dev).`]);
}

const contract = JSON.parse(readFileSync(join(ROOT, 'tooling', 'channel-register.json'), 'utf8')).storeMetadataContract;
const classes = contract?.inkRule?.classes ?? {};

/** calibration dir -> { lw, lh, dpr, keys } */
const targets = new Map();
for (const key of keys) {
  const spec = classes[key];
  if (!spec || typeof spec.calibration !== 'string') fail([`storeMetadataContract.inkRule.classes names no "${key}" with a calibration directory.`]);
  const [channel, set] = key.split('/');
  const c = contract.perChannel?.[channel]?.graphicAssets?.screenshots?.deviceTypeCoverage?.sets?.[set]?.capture;
  if (!c || !Number.isInteger(c.logicalWidth) || !Number.isInteger(c.logicalHeight) || !(c.dpr > 0)) {
    fail([`${key}: deviceTypeCoverage.sets["${set}"].capture is ${JSON.stringify(c ?? null)}, so there is no geometry to capture at.`]);
  }
  const dir = spec.calibration.replace(/\/+$/, '');
  const prev = targets.get(dir);
  if (prev && (prev.lw !== c.logicalWidth || prev.lh !== c.logicalHeight || prev.dpr !== c.dpr)) {
    fail([`${dir} is named by ${prev.keys.join(', ')} at ${prev.lw}x${prev.lh}@${prev.dpr} and by ${key} at ${c.logicalWidth}x${c.logicalHeight}@${c.dpr}.`, 'One calibration directory is one geometry; give the class its own.']);
  }
  if (prev) prev.keys.push(key);
  else targets.set(dir, { lw: c.logicalWidth, lh: c.logicalHeight, dpr: c.dpr, keys: [key] });
}

let chromium;
try {
  ({ chromium } = createRequire(join(ROOT, '_playwright', 'package.json'))('playwright'));
} catch {
  fail(['Playwright is not installed at _playwright/.', 'Run: cd _playwright && npm ci']);
}

const browser = await chromium.launch({
  ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {}),
  args: chromeArgs,
});

/** Console errors that are not the app's: the analytics beacon its CSP
 *  refuses, and the requests this walk aborts on purpose. */
const NOT_THE_APP = /Content Security Policy|^Failed to load resource/;

/** Walk the signed-out pages once, writing each step's frame into `out`.
 *  Returns the names of the frames captured after the app threw. */
async function walk(steps, geo, mode, out) {
  const threw = [];
  let errors = 0;
  const context = await browser.newContext({ viewport: { width: geo.lw, height: geo.lh }, deviceScaleFactor: geo.dpr });
  await context.route('**/*', (route) => {
    const req = route.request();
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method())) return route.abort();
    if (mode === 'glyphless' && (req.resourceType() === 'font' || FONT_URL.test(new URL(req.url()).pathname))) {
      return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>no font</title>' });
    }
    return route.continue();
  });
  const page = await context.newPage();
  page.on('pageerror', () => errors++);
  page.on('console', (m) => {
    if (m.type() === 'error' && !NOT_THE_APP.test(m.text())) errors++;
  });
  try {
    await page.goto(url, { waitUntil: 'load', timeout: 90_000 });
    await page.waitForSelector('flt-glass-pane, flutter-view', { state: 'attached', timeout: 90_000 });
    for (const [name, click, arrived, opts] of steps) {
      // Semantics: Flutter builds its accessibility tree only once asked, and the
      // walk finds every button through it.
      await page.evaluate(() => document.querySelector('flt-semantics-placeholder')?.click());
      // A DOM click, not a pointer one: with no font a text button can measure
      // zero wide and sit under a sibling's node, and Flutter acts on the
      // semantics node's click event either way.
      if (click) await page.getByRole('button', { name: click, exact: true }).first().evaluate((e) => e.click(), null, { timeout: 30_000 });
      if (arrived) await page.getByRole('button', { name: arrived, exact: true }).first().waitFor({ timeout: 60_000 });
      await page.waitForTimeout(SETTLE_MS);
      if (opts?.pass) continue;
      await page.screenshot({ path: join(out, `${name}.png`), type: 'png' });
      if (errors > 0) threw.push(name);
    }
  } finally {
    await context.close();
  }
  return threw;
}

let code = 0;
try {
  for (const [dir, geo] of targets) {
    const w = geo.lw * geo.dpr;
    const h = geo.lh * geo.dpr;
    console.log(`${dir}/ — ${geo.keys.join(', ')} — ${geo.lw}x${geo.lh}@${geo.dpr} = ${w}x${h}`);
    const outs = {};
    const crashed = new Map();
    for (const mode of MODES) {
      outs[mode] = join(ROOT, dir, mode);
      rmSync(outs[mode], { recursive: true, force: true });
      mkdirSync(outs[mode], { recursive: true });
      for (const steps of WALKS) for (const name of await walk(steps, geo, mode, outs[mode])) crashed.set(name, mode);
    }
    // 🔴 A PAGE THE APP THREW ON IS DROPPED FROM BOTH MODES. Measured
    // 2026-10-01 on the live app: with no font the sign-in page throws ("Null
    // check operator used on a null value") and paints a blank field — fully
    // flat at the phone geometries, a blank half beside the dark brand panel
    // at 1280x800. That is a crash, not the defect the glyphless mode
    // reproduces — the layout, cards and icons standing with no words in them
    // — and a blank frame reads almost no removed ink, which drags the
    // glyphless median and the floor down with it. So a frame captured after
    // the app logged an error, in either mode, takes its pair with it, and so
    // does a glyphless frame with no edge at all (the backstop for a page that
    // fails without saying so). The reason is printed.
    const imgs = { served: [], glyphless: [] };
    for (const name of CAPTURED) {
      const pair = {};
      for (const mode of MODES) {
        const img = decodeRgba(readFileSync(join(outs[mode], `${name}.png`)));
        if (img.width !== w || img.height !== h) {
          console.error(`  ${posix.join(dir, mode, name)}.png is ${img.width}x${img.height}, not ${w}x${h}.`);
          code = 1;
        }
        pair[mode] = img;
      }
      const why = crashed.has(name)
        ? `the app logged an error before its ${crashed.get(name)} frame was taken`
        : measureFrameInk(pair.glyphless).measured > 0
          ? null
          : 'its glyphless frame is a flat field (the page did not render without fonts)';
      if (why) {
        console.log(`  ${name}: DROPPED from both modes — ${why}`);
        for (const mode of MODES) rmSync(join(outs[mode], `${name}.png`));
        continue;
      }
      for (const mode of MODES) imgs[mode].push(pair[mode]);
    }
    if (imgs.served.length < MIN_PAIRS) {
      console.error(`  only ${imgs.served.length} page(s) rendered in both modes; a class needs at least ${MIN_PAIRS}. Nothing here is usable.`);
      code = 1;
    }
    const medians = {};
    for (const mode of MODES) {
      medians[mode] = removedInkRunMedian(imgs[mode], geo.lw);
      console.log(`  ${mode}: ${imgs[mode].length} frame(s), run median of removed ink ${medians[mode]} at ${geo.lw} CSS px`);
    }
    const sep = medians.glyphless > 0 ? medians.served / medians.glyphless : 0;
    console.log(`  separation ${sep.toFixed(2)}x, floor ${Math.sqrt(medians.served * medians.glyphless).toFixed(6)} — the verdict is assert-listing-assets.mjs's`);
  }
} finally {
  await browser.close();
}
writeFileSync(1, code === 0 ? 'done — now run: node tooling/ci/assert-listing-assets.mjs\n' : '');
process.exit(code);
