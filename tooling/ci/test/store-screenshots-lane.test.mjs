// ─────────────────────────────────────────────────────────────────────────────
// THE STORE-SCREENSHOT LANE'S NETWORK POSTURE.
//
// Subject: `tooling/store/capture-network-posture.mjs` and the two places
// `tooling/store/capture-play-screenshots.mjs` has to use it. The defect these
// cover is not hypothetical — every one of the EIGHT frames committed under
// `apps/subscriptiontracker/store/android-play/` carries a full-width
// "Could not reach the network. Some things may be out of date." band across
// the top, and `tooling/ci/assert-listing-assets.mjs` passed all eight, because
// its banner limb hunts `AppColors.warn` (#f59e0b) and this band is
// `errorContainer` (#ffdad6). Measured 2026-09-20: maxWARNRow 0.000 on seven of
// the eight and 0.003 on the last.
//
// ⚠️ NO LIMB HERE READS THE COMMITTED FRAMES. It would be red today and could
// only be made green by a workflow run this machine cannot perform — the live
// capture needs SUPABASE_SERVICE_ROLE_KEY, a CI-only secret. A guard over those
// bytes has to land in the SAME change as the re-captured bytes, which is this
// repo's standing rule for a floor and its subject; until then the refusal
// lives at capture time, where it stops the bad set being produced at all.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { stripSourceComments } from '../text-reductions.mjs';
import { decodeRgba, encodeRgba } from '../../store/png-codec.mjs';
import {
  LAUNCH_DEFINES,
  launchDefineArgs,
  scanTopBand,
  selfTestOfflineBannerDetector,
  BAND_ROW_FRACTION,
  RED_LEAD,
} from '../../store/capture-network-posture.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..');
const RUNNER = join(REPO, 'tooling', 'store', 'capture-play-screenshots.mjs');

/** A frame with `bandRows` of `bandRgb` on top of the app background, round-
 *  tripped through the real PNG encoder and decoder — the detector's true input
 *  is bytes, so a codec regression must be able to red these. */
function frame({ w = 200, h = 200, bandRgb, bandRows, bandWidth = w }) {
  const rgba = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const inBand = y < bandRows && x < bandWidth;
      const c = inBand ? bandRgb : [0xf4, 0xf4, 0xf8];
      rgba[i] = c[0];
      rgba[i + 1] = c[1];
      rgba[i + 2] = c[2];
      rgba[i + 3] = 0xff;
    }
  }
  return decodeRgba(encodeRgba({ width: w, height: h, rgba }));
}

/** The measured colours the thresholds were placed between. */
const OFFLINE = [0xff, 0xda, 0xd6]; // ColorScheme.fromSeed(...).errorContainer
const WARN = [0xf5, 0x9e, 0x0b]; // AppColors.warn — the demo banner
const BG = [0xf4, 0xf4, 0xf8]; // AppColors.bg

describe('capture-network-posture — the offline-banner detector', () => {
  test('separates a banded frame from a clean one, in both directions', () => {
    const t = selfTestOfflineBannerDetector();
    assert.equal(t.ok, true);
    assert.equal(t.withBanner.banner, true);
    assert.equal(t.without.banner, false);
  });

  test('flags the offline banner actually found on the committed frames', () => {
    const r = scanTopBand(frame({ bandRgb: OFFLINE, bandRows: 14 }));
    assert.equal(r.banner, true);
    assert.equal(r.colour, '#ffdad6');
    assert.equal(r.fraction, 1);
    // 255 - max(218, 214) = 37, comfortably over the threshold.
    assert.equal(r.redLead, 37);
    assert.ok(r.redLead >= RED_LEAD);
  });

  test('flags the DEMO banner too — the same defect in another colour', () => {
    const r = scanTopBand(frame({ bandRgb: WARN, bandRows: 14 }));
    assert.equal(r.banner, true);
    assert.equal(r.redLead, 87);
  });

  test('clears a frame whose top is the app background', () => {
    const r = scanTopBand(frame({ bandRgb: BG, bandRows: 0 }));
    assert.equal(r.banner, false);
    // The clean case is FULL WIDTH too — it is the red lead that separates
    // them, not the coverage. A threshold on coverage alone would fail here.
    assert.equal(r.fraction, 1);
    assert.equal(r.redLead, -4);
  });

  test('clears a NARROW accent bar of an alarm colour — the false-positive direction', () => {
    // The live UI does paint AppColors.warn, as an accent a few px wide. 8 of
    // 200 columns is 4% of a row, two orders of magnitude under the threshold.
    const r = scanTopBand(frame({ bandRgb: WARN, bandRows: 14, bandWidth: 8 }));
    assert.equal(r.banner, false);
    assert.ok(r.fraction < BAND_ROW_FRACTION);
  });

  test('a band below the top window is not read as a top banner', () => {
    // 10% of 200 is 20 rows; a band starting at row 0 is what OfflineNotice
    // produces. A frame whose FIRST pixel is background cannot be banded.
    const r = scanTopBand(frame({ w: 200, h: 200, bandRgb: OFFLINE, bandRows: 0 }));
    assert.equal(r.banner, false);
  });
});

describe('capture-network-posture — the launch defines', () => {
  test('SKIP_REMOTE_CONFIG is declared true, with the reason it is there', () => {
    assert.equal(LAUNCH_DEFINES.SKIP_REMOTE_CONFIG?.value, 'true');
    // The reason is the whole entry: a define with no stated cause is one the
    // next reader deletes to "simplify the command line".
    assert.match(LAUNCH_DEFINES.SKIP_REMOTE_CONFIG.why, /cross-origin/i);
  });

  test('launchDefineArgs emits the argv pair flutter drive accepts', () => {
    assert.deepEqual(launchDefineArgs(), ['--dart-define', 'SKIP_REMOTE_CONFIG=true']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE RUNNER HAS TO USE BOTH HALVES.
//
// Structural, over the runner's CODE with comments stripped — this file's
// subject is a module whose whole failure mode is being present and unused, and
// that module's name appears a dozen times in the runner's prose. A grep that
// counted those would pass on a runner that imports nothing (grep-02).
// ─────────────────────────────────────────────────────────────────────────────
describe('capture-play-screenshots.mjs uses the network posture it declares', () => {
  const code = stripSourceComments(readFileSync(RUNNER, 'utf8'), '.mjs');

  test('imports the module rather than re-implementing it', () => {
    assert.match(code, /from\s+'\.\/capture-network-posture\.mjs'/);
  });

  test('pushes the launch defines onto the drive command line', () => {
    assert.match(code, /defines\.push\(\s*\.\.\.launchDefineArgs\(\)\s*\)/);
  });

  test('self-tests the detector before it starts a browser', () => {
    const selfTest = code.indexOf('selfTestOfflineBannerDetector(');
    // 🔴 THE CALL SITE, NOT THE DECLARATION — and the difference reddened this
    // test on its first run. `function chromedriverPath()` is declared near the
    // top of the runner and INVOKED 180 lines later, so `indexOf('chromedriverPath(')`
    // measured the declaration and reported the self-test as late when it is
    // early. An ordering assertion has to name the thing that happens, not the
    // thing that is defined.
    const browser = code.search(/=\s*chromedriverPath\(\)/);
    assert.ok(selfTest !== -1, 'the runner never calls selfTestOfflineBannerDetector');
    assert.ok(browser !== -1, 'the runner never invokes chromedriverPath()');
    // Refusing after the drive costs a browser, a provisioned Supabase user and
    // a CI run — the same argument the account-address self-test already makes.
    assert.ok(selfTest < browser, 'the detector self-test runs AFTER chromedriver is resolved');
  });

  test('scans every captured frame and records a banner as a problem', () => {
    assert.match(code, /scanTopBand\(\s*decodeRgba\(/);
    assert.match(code, /band\?\.banner/);
    assert.match(code, /problems\.push\(/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE WORKFLOW HAS TO REACH THE DRIVE THROUGH THE RUNNER.
//
// The defines and the pixel scan both live in `capture-play-screenshots.mjs`,
// so a workflow that called `flutter drive` for itself would walk straight past
// every limb above while still producing files in the listing directory. This
// is the one limb that is about the YAML, and it is the honest version of
// "assert the network flags are present in the workflow": there is no emulator
// in this lane to pin a status bar on — `-d web-server --browser-name=chrome`
// is a headless Chrome viewport — so the network posture is carried by the
// runner, and what the workflow owes is to use it.
// ─────────────────────────────────────────────────────────────────────────────
describe('store-screenshots.yml captures through the runner', () => {
  const yml = readFileSync(join(REPO, '.github', 'workflows', 'store-screenshots.yml'), 'utf8');
  /** Comment lines dropped: this file is mostly prose, and it names the runner
   *  in it. A grep over the raw YAML would pass on a workflow that only talks
   *  about the script (grep-02). */
  const steps = yml
    .split(/\r?\n/)
    .filter((l) => !/^\s*#/.test(l))
    .join('\n');

  test('invokes capture-play-screenshots.mjs rather than flutter drive directly', () => {
    assert.match(steps, /node tooling\/store\/capture-play-screenshots\.mjs/);
    assert.doesNotMatch(steps, /flutter\s+drive/);
  });
});
