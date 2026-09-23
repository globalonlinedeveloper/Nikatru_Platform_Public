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
    // ⚠️ AND NOT `=\s*chromedriverPath\(\)` EITHER, since 2026-09-22: the call
    // site became conditional (`NATIVE ? null : chromedriverPath()`) when the
    // runner learned to drive a native binary, and an assertion tied to the
    // shape of the assignment reddened on a change that did not move it. The
    // SEMICOLON is what separates the call from the declaration, which is the
    // distinction this test was written to make.
    const browser = code.search(/chromedriverPath\(\);/);
    assert.ok(selfTest !== -1, 'the runner never calls selfTestOfflineBannerDetector');
    assert.ok(browser !== -1, 'the runner never invokes chromedriverPath()');
    // Refusing after the drive costs a browser, a provisioned Supabase user and
    // a CI run — the same argument the account-address self-test already makes.
    assert.ok(selfTest < browser, 'the detector self-test runs AFTER chromedriver is resolved');
  });

  test('scans every captured frame and records a banner as a problem', () => {
    // ⏱ 2026-09-22 · WAS /scanTopBand\(\s*decodeRgba\(/ — one expression. The
    // decoded frame is now HELD, because the row-edge check below reads the
    // same pixels and decoding a 1080x1920 frame twice per check is the kind
    // of waste that gets a check removed. Both halves are still pinned: the
    // frame is decoded, and the banner scan is what reads it.
    assert.match(code, /img = decodeRgba\(/);
    assert.match(code, /band = scanTopBand\(img\)/);
    assert.match(code, /band\?\.banner/);
    assert.match(code, /problems\.push\(/);
  });

  // ⏱ 2026-09-22 (store-frame-followup) · O-STORE-FRAME-FAB's no-human-eye
  // half. A frame whose fold geometry the drive never published is a frame
  // nobody examined, which is the failure mode this whole file exists for.
  test('reads the fold line of every frame, and proves the detector first', () => {
    const selfTest = code.search(/selfTestFoldLineDetector\(\)/);
    // ⏱ 2026-09-23 · WAS /=\s*chromedriverPath\(\)/. Rebased onto the store-
    // screenshots stack, the call site is `NATIVE ? null : chromedriverPath();`,
    // which that regex never matched (-1), so `selfTest < browser` read false on
    // an order that had not moved. Same call-site anchor as the offline-banner
    // limb above: the semicolon separates the call from the declaration.
    const browser = code.search(/chromedriverPath\(\);/);
    assert.ok(selfTest !== -1, 'the runner never calls selfTestFoldLineDetector');
    assert.ok(browser !== -1, 'the runner never invokes chromedriverPath()');
    assert.ok(selfTest < browser, 'the row-edge self-test runs AFTER chromedriver is resolved');
    assert.match(code, /foldLineProblems\(img, fold/);
    // Absent geometry is named, never silently skipped: a problem on a live
    // run, COVERAGE LOST (exit 2) on --proof.
    assert.match(code, /coverageLost\.push\(why\)/);
    assert.match(code, /process\.exit\(2\)/);
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

// ─────────────────────────────────────────────────────────────────────────────
// THE CAPTURE SUITE'S OWN CONTRACT — run 35483690951 (2026-09-20).
//
// That run captured all four phone frames and created all six subscriptions,
// then failed with "Multiple exceptions (2) were detected" and NOT ONE WORD of
// either exception in the 601-line step log. The cause is the channel gap the
// suite documents three times: FlutterError dumps through `debugPrint`, which
// under `flutter drive -d web-server` is the BROWSER's console. `reportData` is
// the one channel that reaches the host, so these limbs hold the suite to
// using it — and to chaining rather than swallowing, because a handler that
// ate the errors would turn that red run GREEN.
// ─────────────────────────────────────────────────────────────────────────────
describe('store_screenshots_test.dart reports its framework errors to the host', () => {
  const SUITE = join(
    REPO, 'apps', 'subscriptiontracker', 'integration_test', 'store_screenshots_test.dart',
  );
  const dart = stripSourceComments(readFileSync(SUITE, 'utf8'), '.dart');

  test('collects FlutterError details into binding.reportData', () => {
    assert.match(dart, /FlutterError\.onError\s*=/);
    assert.match(dart, /binding\.reportData\s*=/);
    assert.match(dart, /'flutterErrors'/);
  });

  test('CHAINS to the previous handler instead of swallowing the error', () => {
    // Without this call flutter_test never accumulates the details, the test
    // passes, and an unexamined set reaches a store listing.
    assert.match(dart, /previous\?\.call\(details\)/);
  });

  test('installs the reporter inside the test body, not in main()', () => {
    // TestWidgetsFlutterBinding.runTest ASSIGNS FlutterError.onError when the
    // test starts, so a handler installed in main() is overwritten before the
    // first widget builds and would report an empty list on a run with two
    // exceptions in it.
    const install = dart.indexOf('installErrorReporter()');
    const appMain = dart.indexOf('await app.main()');
    assert.ok(install !== -1, 'the suite never installs the error reporter');
    assert.ok(appMain !== -1, 'the suite never calls app.main()');
    assert.ok(install < appMain, 'the reporter is installed after app.main()');
  });

  test('restores the handler, as flutter_test requires of any changed global', () => {
    assert.match(dart, /restoreErrorReporter\(\)/);
  });
});

describe('store_screenshots_test.dart seeds a category per subscription', () => {
  const SUITE = join(
    REPO, 'apps', 'subscriptiontracker', 'integration_test', 'store_screenshots_test.dart',
  );
  const src = readFileSync(SUITE, 'utf8');
  const dart = stripSourceComments(src, '.dart');

  /** The seed table, parsed out of the source rather than grepped for: the
   *  category names also appear in the prose above it. */
  // ⏱ 2026-09-22 · THREE OR FOUR COLUMNS. The fourth is the renewal offset in
  // days, added so the six rows stop tying in `SubMath.upcoming`; the filter
  // takes either shape so this reader could re-base before the column landed.
  const rows = [...dart.matchAll(/<String>\[([^\]]*)\]/g)]
    .map((m) => m[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')))
    .filter((r) => (r.length === 3 || r.length === 4) && /^\d+\.\d{2}$/.test(r[1]));

  test('every illustrative row carries a name, a price and a category', () => {
    assert.equal(rows.length, 6);
    for (const [name, price, category] of rows) {
      assert.ok(name.length > 0, `row ${name} has no name`);
      assert.ok(Number(price) > 0, `row ${name} has no price`);
      assert.ok(category.length > 0, `row ${name} has no category`);
    }
  });

  test('no row is left in the Other bucket the old listing showed', () => {
    // Insights rendered one slice reading "Other $93" on every published frame
    // because all six rows fell through to the sheet's _uncategorised fallback.
    for (const [name, , category] of rows) {
      assert.notEqual(category, 'Other', `${name} would still group as Other`);
    }
    assert.equal(new Set(rows.map((r) => r[2])).size, 6, 'categories are not distinct');
  });

  test('the renewal offsets are distinct, so the upcoming block never ties', () => {
    // ⏱ 2026-09-22. Every row used to keep the sheet's default renewal, so all
    // six tied on `daysUntil` and the order on screen was input order: append
    // order on phone, the server's order on tablet. The two viewports could
    // therefore list the same board differently, which is a listing defect no
    // count or total can see. Distinct offsets are what remove the tie.
    const offsets = rows.filter((r) => r.length === 4).map((r) => r[3]);
    assert.equal(offsets.length, 6, 'not every illustrative row carries a renewal offset');
    for (const o of offsets) assert.match(o, /^\d+$/, `offset "${o}" is not a whole number of days`);
    const days = offsets.map(Number);
    assert.equal(new Set(days).size, 6, 'two rows renew on the same day, so they tie in upcoming');
    // Nothing at 0 or 1: "Due today"/"tomorrow" are states this set does not
    // mean to photograph, and a 0 would also expire mid-drive.
    assert.ok(Math.min(...days) >= 2, 'an offset of 0 or 1 puts a Due today/tomorrow label in the frame');
    assert.ok(Math.min(...days) <= 5, 'no row is inside the accent window, so the frame shows only the muted state');
  });

  test('every category exists in the sheet vocabulary, which is DERIVED from the budget caps', () => {
    // add_subscription_sheet.dart builds its dropdown from
    // DemoData.budget().categories — so a cap rename silently removes a value
    // the suite still asks for, and the run fails at the dropdown.
    const demo = readFileSync(
      join(REPO, 'apps', 'subscriptiontracker', 'lib', 'data', 'seed', 'demo_data.dart'), 'utf8',
    );
    const vocabulary = [...demo.matchAll(/BudgetCap\('([^']+)'/g)].map((m) => m[1]);
    assert.ok(vocabulary.length >= 10, `read only ${vocabulary.length} budget caps`);
    for (const [name, , category] of rows) {
      assert.ok(vocabulary.includes(category), `"${category}" (${name}) is not an offered category`);
    }
  });

  test('the suite actually chooses the category in the sheet, with a reachability limb', () => {
    assert.match(dart, /DropdownButtonFormField<String>/);
    assert.match(dart, /find\.text\(row\[2\]\)\.hitTestable\(\)/);
    assert.match(dart, /ensureVisible\(categoryField\)/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE VERDICT, AND THE ALLOWLIST THAT MUST NEVER BECOME A MUTE BUTTON.
//
// Run 35488534460 raised two exceptions and the reporter printed both. One is
// harness-side (a focus-traversal sort reading `rect` off an inactive Focus
// element during a flutter_test-synthesised didChangeViewFocus dispatch); the
// other was a REAL lane defect — TURNSTILE_SITE_KEY absent from a live web
// build (ADR 084) — and is fixed at the cause rather than allowlisted.
//
// These limbs hold the allowlist narrow: every entry carries a date, a why, and
// MORE THAN the assertion text, because "Cannot get renderObject of inactive
// element" is a real defect almost anywhere else in the tree.
// ─────────────────────────────────────────────────────────────────────────────
describe('store_screenshots_test.dart classifies exceptions instead of ignoring them', () => {
  const SUITE = join(
    REPO, 'apps', 'subscriptiontracker', 'integration_test', 'store_screenshots_test.dart',
  );
  const raw = readFileSync(SUITE, 'utf8');
  const dart = stripSourceComments(raw, '.dart');

  /** The allowlist, parsed out of the source as entries rather than grepped:
   *  every id and needle also appears in the prose that justifies it. */
  /** Every allowlist entry, read out of the typed `_Benign` list. Sliced by
   *  index rather than matched across fields: `stripSourceComments` blanks the
   *  long `why` comments between them, and a regex spanning that failed to
   *  match text that reads fine by eye. */
  const entryIds = [...dart.matchAll(/id: '([^']+)'/g)].map((m) => m[1]);
  const fieldAfter = (id, field) => {
    const at = dart.indexOf(`id: '${id}'`);
    const m = new RegExp(`${field}: '([^']*)'`).exec(dart.slice(at));
    return m ? m[1] : null;
  };
  const needlesOfEntry = (id) => {
    const at = dart.indexOf(`id: '${id}'`);
    const from = dart.indexOf('needles: <String>[', at);
    const to = dart.indexOf(']', from);
    if (from === -1 || to === -1) return [];
    return [...dart.slice(from, to).matchAll(/'([^']*)'/g)].map((m) => m[1]);
  };
  const entries = entryIds.map((id) => ({
    id,
    dated: fieldAfter(id, 'dated'),
    seenIn: fieldAfter(id, 'seenIn'),
    needles: needlesOfEntry(id),
  }));

  test('the allowlist is small and every entry is dated to a real run', () => {
    assert.ok(entries.length >= 1, 'the allowlist parsed as empty — the regex or the shape moved');
    assert.ok(entries.length <= 3, `${entries.length} benign entries is no longer an allowlist`);
    for (const e of entries) {
      assert.match(e.dated, /^\d{4}-\d{2}-\d{2}$/, `${e.id} has no ISO date`);
      assert.match(e.seenIn, /run \d+/, `${e.id} does not name the run it was seen in`);
    }
  });

  test('no entry matches on the assertion text alone', () => {
    // A signature of one sentence would suppress that sentence everywhere. Each
    // entry must also pin the framework PATH that makes it benign.
    for (const e of entries) {
      assert.ok(e.needles.length >= 3, `${e.id} has only ${e.needles.length} needle(s)`);
      assert.ok(
        e.needles.some((n) => n.includes('package:flutter')),
        `${e.id} pins no framework frame, so it would match the same words raised anywhere`,
      );
    }
  });

  test('the focus-traversal entry pins the harness frame that makes it harness-side', () => {
    const focus = entries.find((e) => e.id === 'focus-traversal-inactive-element');
    assert.ok(focus, 'the entry for run 35488534460 exception 1 is gone');
    // flutter_test/src/window.dart in the stack IS the claim: the view-focus
    // event is synthesised by the test binding, not by the app.
    assert.ok(focus.needles.includes('package:flutter_test/src/window.dart'));
    assert.ok(focus.needles.includes('WidgetsBindingObserver.didChangeViewFocus'));
    assert.ok(focus.needles.includes('Cannot get renderObject of inactive element'));
  });

  test('an UNMATCHED exception is still forwarded, and still fails the run', () => {
    // The forward is the whole verdict mechanism; a blanket suppression would
    // be this line without the condition.
    assert.match(dart, /if\s*\(id == null\)\s*previous\?\.call\(details\)/);
    assert.match(dart, /expect\(\s*unmatched,\s*isEmpty/);
  });

  test('a benign match is recorded and reported, never merely dropped', () => {
    assert.match(dart, /flutterErrors\.add\(text\)/);
    assert.match(dart, /'verdict'/);
  });

  test('the timeline marks every captured frame, so WHEN an error fired is readable', () => {
    // Order alone cannot say whether an exception preceded a capture; that is
    // the question run 35488534460's report could not answer about itself.
    assert.equal((dart.match(/markFrame\('/g) ?? []).length, 4);
    assert.match(dart, /FRAME \$frame written/);
  });
});

describe('the capture lane passes the captcha site key ADR 084 requires', () => {
  const runner = stripSourceComments(
    readFileSync(join(REPO, 'tooling', 'store', 'capture-play-screenshots.mjs'), 'utf8'), '.mjs',
  );
  const yml = readFileSync(
    join(REPO, '.github', 'workflows', 'store-screenshots.yml'), 'utf8',
  ).split(/\r?\n/).filter((l) => !/^\s*#/.test(l)).join('\n');

  test('the runner refuses a LIVE WEB capture with no TURNSTILE_SITE_KEY', () => {
    assert.match(runner, /pass\('TURNSTILE_SITE_KEY'\)/);
    // 🔴 `&& !NATIVE` SINCE 2026-09-22, AND THE TEST SAYS SO RATHER THAN
    // LOOSENING. TurnstileGate renders in the WEB build; the desktop and Apple
    // builds sign in without it, so requiring the variable on a native drive
    // would refuse a run over a gate that build does not have — the mirror of
    // the defect this refusal was added for. Written as the exact condition, so
    // widening the exemption to, say, every non-Play channel is still red.
    assert.match(runner, /else if \(!PROOF && !NATIVE\)/);
  });

  test('--proof is exempt, because a demo build has no captcha posture to get wrong', () => {
    // TurnstileGate.postureFor: not backend-live => notOnThisChannel, inert.
    assert.match(runner, /if \(process\.env\.TURNSTILE_SITE_KEY\) pass\('TURNSTILE_SITE_KEY'\)/);
  });

  test('the workflow supplies it as a VARIABLE and fails closed, like e2e.yml', () => {
    // 🔴 BOTH OCCURRENCES, COUNTED — AND A MUTATION PROVED WHY. The first
    // version of this limb was `assert.match(...)`, which passes on ANY one
    // hit. The variable is referenced twice on purpose: once by the preflight
    // step that fails closed, and once by the `Capture the set` step whose env
    // actually reaches the build. Blanking only the second leaves a run whose
    // preflight says the key is present and whose build never receives it —
    // exactly the state this whole increment exists to remove — and the
    // `match` form went GREEN on that mutation.
    const refs = yml.match(/TURNSTILE_SITE_KEY: \$\{\{ vars\.TURNSTILE_SITE_KEY \}\}/g) ?? [];
    assert.equal(refs.length, 2, `expected the preflight and capture steps to reference it; found ${refs.length}`);
    assert.match(yml, /if \[ -z "\$TURNSTILE_SITE_KEY" \]; then/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE SIGNATURE, RUN AGAINST THE REAL BYTES IT WAS WRITTEN FROM.
//
// The limbs above assert the allowlist's SHAPE. These run its actual needles
// over the two exceptions run 35488534460 really raised, captured verbatim from
// that run's `flutterErrors` into fixtures/. That is the difference between "the
// entry has enough needles" and "the entry matches the thing it names and
// nothing else" — and it is the closest a Node test can get to the Dart
// classifier without driving a browser.
//
// ⚠️ WHAT IT STILL CANNOT PROVE: that the handler FORWARDS the unmatched one at
// runtime. That limb is structural (`if (id == null) previous?.call(details)`)
// and its real proof is the next capture run.
// ─────────────────────────────────────────────────────────────────────────────
describe('the benign signature separates the two exceptions run 35488534460 raised', () => {
  const SUITE = join(
    REPO, 'apps', 'subscriptiontracker', 'integration_test', 'store_screenshots_test.dart',
  );
  const dart = stripSourceComments(readFileSync(SUITE, 'utf8'), '.dart');
  const FIX = join(REPO, 'tooling', 'ci', 'test', 'fixtures', 'store-shots-run-35488534460');
  const focusText = readFileSync(join(FIX, 'exception-1-focus-traversal.txt'), 'utf8');
  const turnstileText = readFileSync(join(FIX, 'exception-2-turnstile.txt'), 'utf8');

  /** The classifier, in the one form a Node test can apply: every needle must
   *  appear. Mirrors `benignId` in the suite. */
  const needlesOf = (id) => {
    const at = dart.indexOf(`id: '${id}'`);
    assert.notEqual(at, -1, `no allowlist entry with id ${id}`);
    const from = dart.indexOf('needles: <String>[', at);
    const to = dart.indexOf(']', from);
    assert.ok(from !== -1 && to !== -1, `entry ${id} has no needles list`);
    return [...dart.slice(from, to).matchAll(/'([^']*)'/g)].map((m) => m[1]);
  };
  const matches = (needles, text) => needles.every((n) => text.includes(n));

  test('it MATCHES the focus-traversal exception it was written for', () => {
    assert.equal(matches(needlesOf('focus-traversal-inactive-element'), focusText), true);
  });

  test('it does NOT match the turnstile exception — that one was fixed at the cause', () => {
    // ADR 084's misconfiguration is a real lane defect, not framework noise:
    // the fix is passing vars.TURNSTILE_SITE_KEY, not an allowlist entry.
    assert.equal(matches(needlesOf('focus-traversal-inactive-element'), turnstileText), false);
  });

  test('the fixture really is the harness path, not an app path', () => {
    // The two frames that carry the whole "cannot reach the pixels" argument.
    assert.match(focusText, /flutter_test\/src\/window\.dart .* \[_handleViewFocusChanged\]/);
    assert.match(focusText, /focus_traversal\.dart .* findFirstFocus/);
    // And it is reported, not rethrown: the widgets library caught it.
    assert.match(focusText, /^Exception caught by widgets library/);
  });

  test('no allowlist entry matches the turnstile exception at all', () => {
    const ids = [...dart.matchAll(/id: '([^']+)'/g)].map((m) => m[1]);
    for (const id of ids) {
      assert.equal(
        matches(needlesOf(id), turnstileText), false,
        `entry ${id} would suppress the ADR 084 misconfiguration, which is a real defect`,
      );
    }
  });
});

describe('a failed capture keeps its frames for diagnosis', () => {
  const yml = readFileSync(
    join(REPO, '.github', 'workflows', 'store-screenshots.yml'), 'utf8',
  );
  const steps = yml.split(/\r?\n/).filter((l) => !/^\s*#/.test(l)).join('\n');

  test('failure() uploads the frames under a name that cannot be mistaken for the set', () => {
    assert.match(steps, /if: failure\(\)/);
    assert.match(steps, /name: FAILED-not-a-listing-set-/);
    // The success artifact keeps its own name, so nothing downstream that
    // looks for the real set can ever be handed unvetted bytes.
    assert.match(steps, /name: play-screenshots-subscriptiontracker/);
  });

  test('the diagnostic upload never masks an earlier failure with its own', () => {
    // A run that died before the drive has no frames; `error` there would
    // replace the real cause with "no files found".
    assert.match(steps, /if-no-files-found: ignore/);
    // The real set still fails closed when it is empty.
    assert.match(steps, /if-no-files-found: error/);
  });
});
