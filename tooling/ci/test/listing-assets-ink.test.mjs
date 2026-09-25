// ─────────────────────────────────────────────────────────────────────────────
// listing-assets-ink.test.mjs — THE INK limb of assert-listing-assets.mjs must
// be able to fail, and must be able to fail for the ONE defect it was added for:
// a run of frames of text-bearing screens with no text in them.
//
// ── THE DEFECT THIS GRADES ──────────────────────────────────────────────────
// From #567 to #854 this listing carried four screenshots with NO GLYPHS IN
// THEM AT ALL. The capture fetched its fallback fonts at run time, CI never
// received them, and Flutter drew none — while the layout, the cards, the
// bundled icons and the colours all came out correct. Every limb in that guard
// passed them: right size, right colour type, posture "live", worst top band
// 0.009. #847 bundled the fonts and closed the CAUSE; the row it belongs to
// (O-STORE-FRAMES-CARRY-NO-TEXT) says the blindness is the other half.
//
// ── ⏱ REWRITTEN 2026-09-24 FOR ROW O-STORE-INK-FLOOR-HAND-PASTED ────────────
// The limb used to compare each named frame with a `{measured,
// textlessControl}` row pasted into the register. It now judges each device
// class's RUN median of removed ink, after each frame is area-averaged to the
// class's CSS width, against a floor it COMPUTES from that class's committed
// calibration frames: the geometric mean of the served and glyphless run
// medians, refused when they are under `inkRule.minSeparation` apart. The
// register's `storeMetadataContract.inkRule._why` has the measured table.
//
// 🔴 THE FRAMES IN THE CASES THAT MATTER MOST ARE REAL. `fixtures/
// frames-ink-2026-09-23/` holds five pages of the live app at 430x932, DPR 1,
// served and with every font request answered 200 text/html — the defect,
// reproduced. A class declared at that geometry and calibrated from those
// frames passes the served five (I1) and FAILS the glyphless five (I2). I2 is
// this limb's own red control on real glyphless frames; the old per-frame limb
// could not be pointed at a class, so it has no earlier reading to compare to.
// The other cases use the metric's own synthetic pair, `inkFixtureFrame`, at
// 360x640 declared as CSS 180x320 at DPR 2, so the downscale is exercised too.
//
// ── 🔴 REAL-TREE MUTATIONS FIRST, FIXTURES SECOND ──────────────────────────
// Run against the ACTUAL repository on 2026-09-24, BASE 7dd09500 and this
// change, each restored byte-exact before the next. At the time the class
// calibration directories were not yet committed, so "after" is the tree with
// no calibration set, where every class is COVERAGE LOST:
//
//   mutation                                             BASE  after
//   RC1 01-home.png replaced by one flat colour            1     2, and the
//       per-frame FAIL for 01-home.png is printed above the COVERAGE LOST
//   RC2 01-home.png one column wider (1081x1920)           1*    2, naming 1081x1920
//   RC3 sets.tablet.capture.dpr 2 -> 3                     —     2, 1800x3200 is not 2700x4800
//   RC4 inkRule.classes["android-play/tablet"] deleted     —     2, tablet frames with no class
//   RC5 inkRule.minSeparation 3 -> 1000                    —     2, no calibration to refuse
//   * the CAPTURE.json pixels limb; the old ink limb said nothing about the size.
//
// With the calibration set committed (the local writer, 2026-09-25, BASE
// ca7e500a), each restored byte-exact before the next:
//   RC1 1, the per-frame FAIL for 01-home.png (a flat field); the phone run
//       median alone stays above its floor, which is why the per-frame limb exists
//   RC2 2, naming 1081x1920
//   RC3 2, 1800x3200 is not 2700x4800
//   RC4 2, tablet frames with no class
//   RC5 1, both classes "does not separate". A refused calibration counts as
//       looked at (inkFramesRefused); the zero-judged limb runs only on the real
//       tree, so I3b, the fixture form, could not see that it once read 2.
//
// ⚠️ THE GUARD MAKES A SPLIT AND IT IS LOAD-BEARING HERE: a FIXTURE root with
// frames and no `inkRule` at all PRINTS that it was not judged, while the REAL
// repository in that state is COVERAGE LOST. That is what keeps the older
// fixtures in listing-assets.test.mjs honest rather than red. Once a rule IS
// declared, every refusal below is the same on a fixture root as on the tree.
//
// ⚠️ WHICH CASE CATCHES WHICH EDIT, because a limb with one defence has exactly
// one way to be switched off:
//   · the run comparison deleted or inverted                    -> I2, I1
//   · the separation refusal deleted                            -> I3
//   · the size gate deleted                                     -> I4
//   · the calibration checks relaxed                            -> I5, I6, I9
//   · the per-frame "any ink at all" check deleted              -> I7, I8
//   · the metric itself replaced by a constant                  -> I18, I19
//   · the rule deleted, or a set moved out of every class       -> I10, I11
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
// The same encoder the capture path and the Linux icons use, so a fixture
// cannot disagree with production about what a PNG is.
import { encodeRgba, decodeRgba } from '../../store/png-codec.mjs';
// 🔴 THE SAME READING OF "INK" THE GUARD ENFORCES, NOT A SECOND ONE. A fixture
// painting its own idea of a text-bearing frame would grade the guard against a
// definition the guard does not hold — the failure recorded against
// assert-seams-wired.mjs, whose six fixture tests all passed a broken check.
// `inkFixtureFrame` is what the metric self-tests itself with.
import { inkFixtureFrame, removedInkRunMedian } from '../../store/frame-ink.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..');
const GUARD = join(REPO, 'tooling', 'ci', 'assert-listing-assets.mjs');
const E2E_FRAMES = join(HERE, 'fixtures', 'frames-ink-2026-09-23');
const E2E_NAMES = ['00-consent.png', '01-onboarding.png', '03-reset-password.png', '03-sign-in.png', '03-sign-up.png'];

/** A structurally valid PNG whose pixels cannot be decoded — a correct header
 *  over a one-byte IDAT. Every size and format limb passes it; the ink limb must
 *  report that it could not look, which is neither a pass nor a measurement. */
function png({ width, height, colourType = 2 }) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = colourType;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.alloc(1))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

let CRC_TABLE = null;
function crc32(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c;
    }
  }
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return c ^ 0xffffffff;
}

/**
 * A screenshot fixture with REAL COMPRESSED PIXELS: the metric's own synthetic
 * pair. `glyphs: false` is the same layout, the same cards, the same filled
 * icon blocks, with the strokes gone — a fixture that was an empty canvas would
 * be separated by any metric at all and would prove nothing about this one.
 * `opaque: true` because Google states "JPEG or 24-bit PNG (no alpha)".
 */
function shotAt(width, height, glyphs = true) {
  return encodeRgba(inkFixtureFrame({ width, height, glyphs }), { opaque: true });
}

/** One flat colour, edge to edge: no ink at all, at any size. */
function flatAt(width, height) {
  const rgba = Buffer.alloc(width * height * 4, 0xf7);
  return encodeRgba({ width, height, rgba }, { opaque: true });
}

const SOURCE = 'https://support.google.com/googleplay/android-developer/answer/9866151 (fetched 2026-08-04) — fixture';
const LISTING = 'apps/subscriptiontracker/store/android-play';
/** The synthetic class: 360x640 frames, judged at 180 CSS px. */
const PHONE = { logicalWidth: 180, logicalHeight: 320, dpr: 2 };
/** The e2e geometry the committed real frames were captured at. */
const E2E = { logicalWidth: 430, logicalHeight: 932, dpr: 1 };

/** The same shapes the real register and the real tree use, so a change in
 *  either breaks these cases rather than leaving them passing against a world
 *  that no longer exists. */
function fixture(mutate = () => {}) {
  const root = mkdtempSync(join(tmpdir(), 'nk-ink-'));
  const register = {
    channels: [
      {
        id: 'android-play',
        kind: 'store',
        served: false,
        ownerQueue: 'A-3',
        storeMetadataDir: 'apps/{app}/store/android-play',
      },
    ],
    storeMetadataContract: {
      requiredFiles: ['README.md'],
      inkRule: {
        metric: 'local-contrast-ink-v1',
        normalise: 'area-average each frame to its capture logicalWidth',
        floorRule: "geometric mean of the calibration set's served and glyphless run medians",
        minSeparation: 3,
        classes: { 'android-play/phone': { calibration: 'cal/phone' } },
        source: `${SOURCE} — ink rule fixture: calibration frames are this file's own shotAt() pair`,
      },
      perChannel: {
        'android-play': {
          additionalFiles: ['feature-graphic.png', 'store-icon-512.png'],
          graphicAssets: {
            assets: {
              'feature-graphic.png': { width: 1024, height: 500, alpha: false, source: SOURCE },
              'store-icon-512.png': { width: 512, height: 512, alpha: true, maxBytes: 1048576, source: SOURCE },
            },
            screenshots: {
              dir: 'screenshots',
              provenanceFile: 'CAPTURE.json',
              alpha: false,
              minCount: 2,
              maxCount: 8,
              minSide: 320,
              maxSide: 3840,
              maxAspectRatio: 2,
              recommendedPortrait: { width: 1080, height: 1920 },
              source: SOURCE,
              deviceTypeCoverage: { sets: { phone: { dir: 'screenshots', capture: { ...PHONE } } } },
            },
          },
        },
      },
    },
  };
  // The two files the guard's pixel limbs read before any screenshot is looked
  // at: the design-system token the demo-banner colour is read from, and the
  // composition root where `debugShowCheckedModeBanner: false` lives. Without
  // them every case here would fail for a reason unrelated to the ink.
  const files = {
    [`${LISTING}/feature-graphic.png`]: png({ width: 1024, height: 500, colourType: 2 }),
    [`${LISTING}/store-icon-512.png`]: png({ width: 512, height: 512, colourType: 6 }),
    [`${LISTING}/screenshots/README.md`]: Buffer.from('# slot\n'),
    'packages/design_system/lib/src/tokens/app_colors.dart':
      Buffer.from('class AppColors {\n  static const Color warn = Color(0xFFF59E0B);\n}\n'),
    'apps/subscriptiontracker/lib/app.dart':
      Buffer.from('Widget build() => MaterialApp.router(\n  debugShowCheckedModeBanner: false,\n);\n'),
  };
  const state = { register, files };
  mutate(state);
  write(root, 'catalog/apps.json', Buffer.from(JSON.stringify([{ slug: 'subscriptiontracker' }])));
  write(root, 'tooling/channel-register.json', Buffer.from(JSON.stringify(state.register)));
  for (const [rel, buf] of Object.entries(state.files)) write(root, rel, buf);
  return root;
}

function write(root, rel, buf) {
  const p = join(root, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, buf);
}

const rule = (s) => s.register.storeMetadataContract.inkRule;
const shots = (s) => s.register.storeMetadataContract.perChannel['android-play'].graphicAssets.screenshots;

/** Two listing frames plus the provenance record they need to reach the ink
 *  limb at all — a set with no CAPTURE.json fails earlier, and the case would
 *  then be asserting the provenance limb while claiming to assert this one. */
const twoShots = (s, opts = {}) => {
  s.files[`${LISTING}/screenshots/01.png`] = shotAt(360, 640);
  s.files[`${LISTING}/screenshots/02.png`] = opts.second ?? shotAt(360, 640, opts.glyphs !== false);
  s.files[`${LISTING}/screenshots/CAPTURE.json`] = Buffer.from(JSON.stringify({ posture: 'live' }));
};

/** The synthetic class's calibration set: `names` in both modes by default. */
const calibration = (s, opts = {}) => {
  const served = opts.served ?? ['01.png', '02.png', '03.png', '04.png'];
  const glyphless = opts.glyphless ?? served;
  for (const n of served) s.files[`cal/phone/served/${n}`] = shotAt(360, 640, true);
  for (const n of glyphless) s.files[`cal/phone/glyphless/${n}`] = shotAt(360, 640, false);
};

/** The e2e geometry: the class declared at 430x932 DPR 1, calibrated from the
 *  committed real frames (glyphless from `glyphlessFrom`), and a listing of
 *  the five frames of `listingMode`. The aspect limb is dropped because a
 *  430x932 browser page is 2.17:1 and Play's 2:1 is not what these assert. */
const e2eClass = (s, { listingMode, glyphlessFrom = 'glyphless' }) => {
  shots(s).deviceTypeCoverage.sets.phone.capture = { ...E2E };
  delete shots(s).maxAspectRatio;
  rule(s).classes['android-play/phone'].calibration = 'cal/e2e';
  for (const n of E2E_NAMES) {
    s.files[`cal/e2e/served/${n}`] = readFileSync(join(E2E_FRAMES, 'served', n));
    s.files[`cal/e2e/glyphless/${n}`] = readFileSync(join(E2E_FRAMES, glyphlessFrom, n));
    s.files[`${LISTING}/screenshots/${n}`] = readFileSync(join(E2E_FRAMES, listingMode, n));
  }
  s.files[`${LISTING}/screenshots/CAPTURE.json`] = Buffer.from(JSON.stringify({ posture: 'live' }));
};

// BOUNDED, so a spawned script that hangs at exit (nodejs/node#54918 — and this
// guard decodes MORE pixels than it did before this limb) fails its case BY NAME
// instead of holding the job open until CI cancels it with no name at all.
// `status null` beside complete output means the process was still alive when
// the bound fired: an exit hang.
// The spawn stays written out as `spawnSync(process.execPath, [SCRIPT, …])`:
// assert-guard-coverage.mjs credits a test with EXERCISING a script by reading
// that shape, and a wrapper taking the argument list hides the script from it.
const RUN_TIMEOUT_MS = 120_000;
const BOUND = { timeout: RUN_TIMEOUT_MS, killSignal: 'SIGKILL' };
function result(label, r) {
  const died =
    r.error || r.signal
      ? `\n[listing-assets-ink.test] ${label} did not finish — ${r.error ? r.error.message : 'no spawn error'} · ` +
        `status ${r.status} · signal ${r.signal} · bound ${RUN_TIMEOUT_MS} ms`
      : '';
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}${died}` };
}

function run(root) {
  return result('guard', spawnSync(process.execPath, [GUARD, root], { encoding: 'utf8', ...BOUND }));
}

const roots = [];
const build = (m) => {
  const r = fixture(m);
  roots.push(r);
  return r;
};
after(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

/** The guard's closed set of imports. Copied so ONE of them can be mutated — the
 *  only way to prove that editing the METRIC is caught, since the guard resolves
 *  `../store/frame-ink.mjs` relative to itself and no fixture root can stand in
 *  for it. */
const INK_GUARD_FILES = [
  'tooling/ci/assert-listing-assets.mjs',
  'tooling/ci/tree-walk.mjs',
  'tooling/ci/chassis-delegation.mjs',
  'tooling/ci/text-reductions.mjs',
  'tooling/ci/single-threaded-relaunch.mjs',
  'tooling/store/png-codec.mjs',
  'tooling/store/capture-suite-scan.mjs',
  'tooling/store/frame-ink.mjs',
];

/** A copy of the real guard with one file mutated. The mutation is asserted to
 *  have CHANGED THE TEXT: a mutation that mutates nothing is invisible, and the
 *  neighbouring test file already records being caught by that once. */
function mutatedGuard(rel, mutate) {
  const dir = mkdtempSync(join(tmpdir(), 'nk-ink-guard-'));
  roots.push(dir);
  for (const f of INK_GUARD_FILES) {
    const src = readFileSync(join(REPO, f), 'utf8');
    const out = f === rel ? mutate(src) : src;
    if (f === rel) assert.notEqual(out, src, `the mutation of ${rel} changed nothing — the case would prove nothing`);
    write(dir, f, Buffer.from(out));
  }
  return join(dir, 'tooling', 'ci', 'assert-listing-assets.mjs');
}

describe('assert-listing-assets.mjs — THE INK, judged per device class against a computed floor', () => {
  test('I0 · GREEN CONTROL — two text-bearing frames clear the class floor, and the reading is printed', () => {
    const r = run(build((s) => {
      twoShots(s);
      calibration(s);
    }));
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /2 committed frame\(s\) judged per device class, each at its CSS width/);
    assert.match(r.out, /ink class "android-play\/phone" \(subscriptiontracker, 180x320@2\): n 2, run median of removed ink [\d.]+ at 180 CSS px, floor [\d.]+/);
    assert.match(r.out, /served median [\d.]+, glyphless median [\d.]+, separation [\d.]+x — headroom [\d.]+x/);
    assert.match(r.out, /metric "local-contrast-ink-v1" \(per-channel delta 24\) SELF-TESTED this run/);
  });

  test('I1 · RC6 — REAL served frames clear a class calibrated from real frames, headroom printed', () => {
    const r = run(build((s) => e2eClass(s, { listingMode: 'served' })));
    assert.equal(r.code, 0, r.out);
    // served median 0.032481, glyphless 0.003698: floor 0.010960, 2.96x.
    assert.match(r.out, /n 5, run median of removed ink 0\.032481 at 430 CSS px, floor 0\.01096\d/);
    assert.match(r.out, /served median 0\.032481, glyphless median 0\.003698, separation 8\.78x — headroom 2\.96x/);
  });

  test('I2 · RC7 — the SAME pages rendered with no fonts FAIL the class, exit 1', () => {
    // 🔴 THE RED CONTROL IS THE POINT OF THE LIMB. These are not filtered
    // estimates: they are the defect, reproduced on the real app.
    const r = run(build((s) => e2eClass(s, { listingMode: 'glyphless' })));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /FAIL class "android-play\/phone" \(subscriptiontracker, 430x932@1\): n 5, run median of removed ink 0\.003698/);
    assert.match(r.out, /headroom 0\.34x\. The run's frames carry no text/);
    assert.match(r.out, /do not lower the floor/);
    assert.doesNotMatch(r.out, /ok {3}THE INK/);
  });

  test('I3 · RC11 — a calibration set that does not separate is refused, never judged with', () => {
    const r = run(build((s) => e2eClass(s, { listingMode: 'served', glyphlessFrom: 'served' })));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /class "android-play\/phone": the calibration set does not separate — .*separation 1\.00x, and .*minSeparation needs >= 3x/);
    assert.match(r.out, /was NOT judged with it/);
    // …and no run verdict was reached with that floor, either way.
    assert.doesNotMatch(r.out, /headroom/);
  });

  test('I3b · RC5 shape — a raised minSeparation refuses a GOOD calibration (1), and is not read as a broken metric', () => {
    // The synthetic calibration separates about 41x at 180 CSS px. Held to
    // 1000x it must be refused as a calibration finding, exit 1 — never
    // reported as the metric failing its self-test (2), which it did not.
    const r = run(build((s) => {
      twoShots(s);
      calibration(s);
      rule(s).minSeparation = 1000;
    }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /the calibration set does not separate — .*minSeparation needs >= 1000x/);
    assert.doesNotMatch(r.out, /FAILED ITS OWN SELF-TEST/);
  });

  test('I4 · RC8 — a listing frame of a size the class was not calibrated for is COVERAGE LOST', () => {
    const r = run(build((s) => {
      twoShots(s, { second: shotAt(362, 640) });
      calibration(s);
    }));
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /COVERAGE LOST — THE INK — android-play\/phone could not be judged/);
    assert.match(r.out, /screenshots\/02\.png is 362x640, and the class captures 180x320 at DPR 2 = 360x640/);
  });

  test('I5 · RC9 — a calibration set with 3 frames per mode is COVERAGE LOST, naming the class', () => {
    const r = run(build((s) => {
      twoShots(s);
      calibration(s, { served: ['01.png', '02.png', '03.png'] });
    }));
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /android-play\/phone: the calibration set is too small — cal\/phone\/served\/ holds 3 frame\(s\) and a class needs at least 4 per mode/);
  });

  test('I6 · RC10 — served/ and glyphless/ naming different pages is COVERAGE LOST', () => {
    const r = run(build((s) => {
      twoShots(s);
      calibration(s, { glyphless: ['01.png', '02.png', '03.png', '05.png'] });
    }));
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /android-play\/phone: the calibration set's served\/ and glyphless\/ name different frames \(served only: 04\.png; glyphless only: 05\.png\)/);
  });

  test('I7 · a BLANK frame FAILS on its own, even when the run median of the class would pass', () => {
    // Three text-bearing frames and one flat one: the median of four still
    // clears the floor, which is exactly why each frame is held to SOME ink.
    const r = run(build((s) => {
      twoShots(s);
      s.files[`${LISTING}/screenshots/03.png`] = shotAt(360, 640);
      s.files[`${LISTING}/screenshots/04.png`] = flatAt(360, 640);
      calibration(s);
    }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /FAIL apps\/subscriptiontracker\/store\/android-play\/screenshots\/04\.png measures 0 ink at its native 360x640 and loses 0 of it/);
    assert.match(r.out, /It has no edge in it at all/);
    assert.doesNotMatch(r.out, /screenshots\/0[123]\.png measures/);
    // The class verdict itself passed: the one FAIL is the frame's.
    assert.doesNotMatch(r.out, /carry no text/);
  });

  test('I8 · RC1 shape — a blank frame is named even when the class then cannot be calibrated', () => {
    // 🔴 THE PRECEDENCE THE BRIEF FIXED: COVERAGE LOST still wins the exit code,
    // and the per-frame FAIL found before it is printed above it.
    const r = run(build((s) => twoShots(s, { second: flatAt(360, 640) })));
    assert.equal(r.code, 2, r.out);
    const fail = r.out.indexOf('FAIL apps/subscriptiontracker/store/android-play/screenshots/02.png measures 0 ink');
    const lost = r.out.indexOf('COVERAGE LOST — THE INK — android-play/phone could not be judged');
    assert.notEqual(fail, -1, r.out);
    assert.notEqual(lost, -1, r.out);
    assert.ok(fail < lost, 'the per-frame FAIL must be printed before the COVERAGE LOST that ends the run');
  });

  test('I9 · a class with NO calibration set is COVERAGE LOST, naming it', () => {
    const r = run(build((s) => twoShots(s)));
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /android-play\/phone: no calibration set — cal\/phone\/ does not exist/);
  });

  test('I10 · RC4 shape — a set with frames and no class is COVERAGE LOST, not skipped', () => {
    const r = run(build((s) => {
      twoShots(s);
      calibration(s);
      shots(s).deviceTypeCoverage.sets.tablet = { dir: 'screenshots-tablet', capture: { logicalWidth: 180, logicalHeight: 320, dpr: 2 } };
      s.files[`${LISTING}/screenshots-tablet/01.png`] = shotAt(360, 640);
    }));
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /android-play\/tablet: 1 committed frame\(s\) under .*screenshots-tablet\/ and storeMetadataContract\.inkRule\.classes names no "android-play\/tablet"/);
  });

  test('I11 · frames with NO inkRule PRINT on a fixture root, and say the real tree is worse', () => {
    const r = run(build((s) => {
      twoShots(s);
      delete s.register.storeMetadataContract.inkRule;
    }));
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /NO INK RULE \(fixture root, NOT JUDGED\): channel "android-play" has 2 committed frame\(s\)/);
    assert.match(r.out, /On the real repository this is COVERAGE LOST/);
    // …and it must NOT claim to have judged anything.
    assert.doesNotMatch(r.out, /judged per device class/);
  });

  test('I12 · an inkRule with no `source` fails rather than being enforced', () => {
    const r = run(build((s) => {
      twoShots(s);
      calibration(s);
      delete rule(s).source;
    }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /storeMetadataContract\.inkRule declares dimensions with NO `source`/);
  });

  test('I13 · a rule recorded against a metric this guard does not compute is COVERAGE LOST', () => {
    const r = run(build((s) => {
      twoShots(s);
      calibration(s);
      rule(s).metric = 'byte-size-v0';
    }));
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /is recorded against metric "byte-size-v0" and this guard computes "local-contrast-ink-v1"/);
  });

  test('I14 · a minSeparation of 1 is COVERAGE LOST — two identical modes would be accepted', () => {
    const r = run(build((s) => {
      twoShots(s);
      calibration(s);
      rule(s).minSeparation = 1;
    }));
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /inkRule\.minSeparation is 1, not a number above 1/);
  });

  test('I15 · a class whose set has no `capture` block is COVERAGE LOST — no size, no CSS width', () => {
    const r = run(build((s) => {
      twoShots(s);
      calibration(s);
      delete shots(s).deviceTypeCoverage.sets.phone.capture;
    }));
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /android-play\/phone: deviceTypeCoverage\.sets\["phone"\]\.capture is null, not \{logicalWidth, logicalHeight, dpr\} in whole device pixels/);
  });

  test('I16 · a class naming a set no channel declares FAILS — it calibrates nothing', () => {
    const r = run(build((s) => {
      twoShots(s);
      calibration(s);
      rule(s).classes['android-play/watch'] = { calibration: 'cal/watch' };
    }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /inkRule\.classes names "android-play\/watch", and no channel declares a device-type set of that name/);
  });

  test('I17 · a frame that cannot be DECODED is a finding, never a frame that was measured', () => {
    const r = run(build((s) => {
      twoShots(s, { second: png({ width: 360, height: 640, colourType: 2 }) });
      calibration(s);
    }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /02\.png could not be decoded, so its ink was never measured/);
    // …and the run reports no count at all, because a failing run prints no ok
    // lines. "I could not look" must never reach a reader as a measurement.
    assert.doesNotMatch(r.out, /judged per device class/);
  });

  // 🔴 THE MUTATION THE FIXTURES ABOVE CANNOT REACH. A calibration is DATA, and
  // I3/I5/I6 catch it being edited. The metric is CODE, resolved relative to
  // the guard, and the failure that costs everything is it being edited into
  // something that returns a constant — every calibration then reads the same
  // and every run is judged for the same wrong reason.
  test('I18 · a metric edited to return a constant is COVERAGE LOST before a frame is read', () => {
    const guard = mutatedGuard('tooling/store/frame-ink.mjs', (src) =>
      src.replace('export function inkFraction(img) {', 'export function inkFraction(img) {\n  return 1; // MUTANT: every frame full of ink'),
    );
    const root = build((s) => {
      twoShots(s);
      calibration(s);
    });
    const r = result('mutant', spawnSync(process.execPath, [guard, root], { encoding: 'utf8', ...BOUND }));
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /the ink metric FAILED ITS OWN SELF-TEST and no frame was measured/);
  });

  test('I19 · a metric edited to measure nothing is COVERAGE LOST too', () => {
    const guard = mutatedGuard('tooling/store/frame-ink.mjs', (src) =>
      src.replace('export function inkFraction(img) {', 'export function inkFraction(img) {\n  return 0; // MUTANT: measures nothing'),
    );
    const root = build((s) => {
      twoShots(s);
      calibration(s);
    });
    const r = result('mutant', spawnSync(process.execPath, [guard, root], { encoding: 'utf8', ...BOUND }));
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /FAILED ITS OWN SELF-TEST/);
  });

  test('I20 · GREEN CONTROL for the copy itself — unmutated, it behaves exactly like the guard', () => {
    // Without this, I18 and I19 prove only that a copied tree fails somehow.
    const guard = mutatedGuard('tooling/store/frame-ink.mjs', (src) => `${src}\n// untouched behaviour\n`);
    const root = build((s) => {
      twoShots(s);
      calibration(s);
    });
    const r = result('copy', spawnSync(process.execPath, [guard, root], { encoding: 'utf8', ...BOUND }));
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /2 committed frame\(s\) judged per device class/);
  });

  test('I21 · the working guard still runs with V8 background tasks OFF — this limb decodes MORE', () => {
    // The ink limb decodes every frame of every class AND its calibration set,
    // in a process that already needed the relaunch (nodejs/node#54918).
    const r = run(build((s) => {
      twoShots(s);
      calibration(s);
    }));
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /V8 background tasks: OFF \(--single-threaded\)/);
  });
});

describe('the rule the real register declares, and the one floor already on main', () => {
  test('I22 · R6 — the helpers reproduce the e2e floor from the committed e2e fixtures', () => {
    // 🔴 ONE CONSISTENCY CASE, NOT A UNIFICATION. framesCarryText's 0.011 was
    // measured as the geometric mean of these two run medians at 430 px, DPR 1.
    // Computing it here with the helpers the store classes are judged by proves
    // the two lanes read one quantity; the e2e guard keeps its own block.
    const frames = (mode) => E2E_NAMES.map((n) => decodeRgba(readFileSync(join(E2E_FRAMES, mode, n))));
    assert.deepEqual(readdirSync(join(E2E_FRAMES, 'served')).filter((f) => f.endsWith('.png')).sort(), E2E_NAMES);
    const served = removedInkRunMedian(frames('served'), 430);
    const glyphless = removedInkRunMedian(frames('glyphless'), 430);
    assert.equal(served, 0.032481);
    assert.equal(glyphless, 0.003698);
    const block = JSON.parse(readFileSync(join(REPO, 'tooling', 'e2e-leg-register.json'), 'utf8')).framesCarryText;
    assert.equal(block.calibratedWidth, 430);
    assert.equal(Number(Math.sqrt(served * glyphless).toFixed(3)), block.minMedianRemovedInk);
  });

  test('I23 · the real register carries the rule once, per class, and no per-frame number anywhere', () => {
    const text = readFileSync(join(REPO, 'tooling', 'channel-register.json'), 'utf8');
    const reg = JSON.parse(text);
    const inkRule = reg.storeMetadataContract.inkRule;
    assert.equal(inkRule.metric, 'local-contrast-ink-v1');
    assert.equal(inkRule.minSeparation, 3);
    assert.deepEqual(Object.keys(inkRule.classes).sort(), ['android-play/phone', 'android-play/tablet']);
    // R2: no per-channel `inkFloor`, no drift fraction, no pasted frame rows.
    assert.doesNotMatch(text, /"inkFloor"\s*:/);
    assert.doesNotMatch(text, /"minFractionOfMeasured"\s*:/);
    assert.doesNotMatch(text, /"textlessControl"\s*:/);
    // R3: each class takes its geometry from its set's own `capture` block.
    const sets = reg.storeMetadataContract.perChannel['android-play'].graphicAssets.screenshots.deviceTypeCoverage.sets;
    assert.deepEqual(sets.phone.capture, { logicalWidth: 360, logicalHeight: 640, dpr: 3 });
    assert.deepEqual(sets.tablet.capture, { logicalWidth: 900, logicalHeight: 1600, dpr: 2 });
  });
});
