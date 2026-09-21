// ─────────────────────────────────────────────────────────────────────────────
// listing-assets-ink.test.mjs — THE INK limb of assert-listing-assets.mjs must
// be able to fail, and must be able to fail for the ONE defect it was added for:
// a frame of a text-bearing screen with no text in it.
//
// ── THE DEFECT THIS GRADES ──────────────────────────────────────────────────
// From #567 to #854 this listing carried four screenshots with NO GLYPHS IN
// THEM AT ALL. The capture fetched its fallback fonts at run time, CI never
// received them, and Flutter drew none — while the layout, the cards, the
// bundled icons and the colours all came out correct. Every limb in that guard
// passed them: right size, right colour type, posture "live", worst top band
// 0.009. #847 bundled the fonts and closed the CAUSE; the row it belongs to
// (O-STORE-FRAMES-CARRY-NO-TEXT) says the blindness is the other half, because
// "fixing only the instance leaves the next one equally invisible".
//
// ── WHY A SEPARATE FILE FROM listing-assets.test.mjs ────────────────────────
// That file's fixture is the pre-ink shape — flat frames, a register with no
// `inkFloor` — and 79 cases there assert other limbs against it. The ink limb
// needs the opposite fixture: frames carrying glyph-shaped strokes and a
// register that records a floor for each. Folding the two together would make
// an ink-floor change fail cases that assert the alpha limb or the provenance
// limb, for a reason that has nothing to do with what they assert — which is
// how a check gets switched off by whoever hits it next.
//
// ⚠️ THE GUARD MAKES THE SAME SPLIT AND IT IS LOAD-BEARING HERE: a FIXTURE root
// with frames and no `inkFloor` block PRINTS that it was not judged, while the
// REAL repository in that state is COVERAGE LOST. That is what keeps the older
// fixtures in the neighbouring file honest rather than red.
//
// ── 🔴 REAL-TREE MUTATIONS FIRST, FIXTURES SECOND ──────────────────────────
// Run against the ACTUAL repository on 2026-09-21 at origin/main 9f548515,
// predictions written first, everything restored byte-exact afterwards:
//
//   · the tree as it stands
//       ⇒ exit 0, "8 committed frame(s) measured", tightest margin
//         screenshots-tablet/03-insights.png at 0.00530 against a floor of
//         0.00371 — 1.43x
//   · screenshots/01-home.png replaced by a TEXTLESS build of ITSELF — the same
//     frame with its glyphs removed by a 9x9 mode filter, so the layout, the
//     cards, the bundled icons and the colours all survive, which is what the
//     fonts-never-loaded capture actually produced
//       ⇒ exit 1, FAIL "…/01-home.png measures 0.01307 ink and the floor
//         recorded for it is 0.01781"
//   · restored (sha256 equal), then screenshots-tablet/02-calendar.png given
//     the same treatment. The tablet set is walked by NO OTHER LIMB in that
//     file, so a limb reading only `screenshots.dir` would have judged four
//     frames of the eight while printing a healthy-looking count
//       ⇒ exit 1, FAIL "…/screenshots-tablet/02-calendar.png measures 0.00104
//         ink and the floor recorded for it is 0.00385"
//   · restored (sha256 equal); guard green again; `git status` clean.
//
// ⚠️ WHICH CASE CATCHES WHICH EDIT, because a limb with one defence has exactly
// one way to be switched off:
//   · the comparison deleted (`if (ink < floor)` made unreachable)  -> I1
//   · one frame's floor pushed under the reading it must catch      -> I5
//   · every floor flattened at once                                 -> I5b
//   · the metric itself replaced by a constant                      -> I13, I14
//   · the floors deleted, or a frame moved out of their reach       -> I8, I3
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
// The same encoder the capture path and the Linux icons use, so a fixture
// cannot disagree with production about what a PNG is.
import { encodeRgba } from '../../store/png-codec.mjs';
// 🔴 THE SAME READING OF "INK" THE GUARD ENFORCES, NOT A SECOND ONE. A fixture
// painting its own idea of a text-bearing frame would grade the guard against a
// definition the guard does not hold — the failure recorded against
// assert-seams-wired.mjs, whose six fixture tests all passed a broken check.
// `inkFixtureFrame` is what the metric self-tests itself with.
import { inkFixtureFrame } from '../../store/frame-ink.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..');
const GUARD = join(REPO, 'tooling', 'ci', 'assert-listing-assets.mjs');

/** The fixture frame's own readings at 1080x1920, measured 2026-09-21 with
 *  tooling/store/frame-ink.mjs. They are the FIXTURE's numbers, never the real
 *  set's: a fixture carrying the repository's floors would pass or fail on
 *  pixels it does not have. */
const FIXTURE_INK = 0.007933;
const FIXTURE_INK_TEXTLESS = 0.000276;

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
 * A screenshot fixture with REAL COMPRESSED PIXELS.
 *
 * `glyphs: false` is the whole point of this file: the SAME layout, the same
 * cards, the same filled icon blocks, with the strokes gone. A fixture that was
 * an empty canvas would be separated by any metric at all and would prove
 * nothing about this one.
 *
 * `opaque: true` because Google states "JPEG or 24-bit PNG (no alpha)" for
 * screenshots; a colour-type-6 fixture would trip the alpha limb and every case
 * here would be asserting the wrong failure.
 */
function shotAt(width, height, glyphs = true) {
  return encodeRgba(inkFixtureFrame({ width, height, glyphs }), { opaque: true });
}

const SOURCE = 'https://support.google.com/googleplay/android-developer/answer/9866151 (fetched 2026-08-04) — fixture';

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
              inkFloor: {
                metric: 'local-contrast-ink-v1',
                minFractionOfMeasured: 0.7,
                source: `${SOURCE} — ink measured 2026-09-21 with tooling/store/frame-ink.mjs against this file's own shotAt() at 1080x1920: ${FIXTURE_INK} with its strokes, ${FIXTURE_INK_TEXTLESS} without`,
                frames: {
                  'screenshots/01.png': { measured: FIXTURE_INK, textlessControl: FIXTURE_INK_TEXTLESS },
                  'screenshots/02.png': { measured: FIXTURE_INK, textlessControl: FIXTURE_INK_TEXTLESS },
                },
              },
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
    'apps/subscriptiontracker/store/android-play/feature-graphic.png': png({ width: 1024, height: 500, colourType: 2 }),
    'apps/subscriptiontracker/store/android-play/store-icon-512.png': png({ width: 512, height: 512, colourType: 6 }),
    'apps/subscriptiontracker/store/android-play/screenshots/README.md': Buffer.from('# slot\n'),
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

/** Two frames plus the provenance record they need to reach the ink limb at
 *  all — a set with no CAPTURE.json fails earlier, and the case would then be
 *  asserting the provenance limb while claiming to assert this one. */
const twoShots = (s, opts = {}) => {
  const w = opts.width ?? 1080;
  const h = opts.height ?? 1920;
  s.files['apps/subscriptiontracker/store/android-play/screenshots/01.png'] = shotAt(w, h);
  s.files['apps/subscriptiontracker/store/android-play/screenshots/02.png'] = shotAt(w, h, opts.glyphs !== false);
  s.files['apps/subscriptiontracker/store/android-play/screenshots/CAPTURE.json'] = Buffer.from(
    JSON.stringify({ posture: 'live', ...(opts.record ?? {}) }),
  );
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

describe('assert-listing-assets.mjs — THE INK, and a frame with no text in it', () => {
  test('I0 · GREEN CONTROL — two frames carrying glyph-shaped strokes pass, and the count is printed', () => {
    const r = run(build((s) => twoShots(s)));
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /2 committed frame\(s\) measured against the floor recorded for THAT frame/);
    assert.match(r.out, /metric "local-contrast-ink-v1" \(per-channel delta 24\) SELF-TESTED this run/);
  });

  test('I1 · a TEXTLESS frame FAILS and is named — same layout, same icons, no strokes', () => {
    const r = run(build((s) => twoShots(s, { glyphs: false })));
    assert.equal(r.code, 1);
    assert.match(r.out, /02\.png measures 0\.00028 ink and the floor recorded for it is 0\.00555/);
    // The other half, without which the limb is a constant somebody will delete:
    // the frame that DID keep its strokes must not be named.
    assert.doesNotMatch(r.out, /01\.png measures/);
  });

  test('I2 · the ink FAIL says what the frame looks like, so a reader can act on it', () => {
    const r = run(build((s) => twoShots(s, { glyphs: false })));
    assert.match(r.out, /at the level of a capture with no glyphs at all/);
    assert.match(r.out, /Open the frame before assuming a false alarm/);
  });

  test('I3 · a committed frame with NO floor row FAILS rather than being skipped', () => {
    const r = run(build((s) => {
      twoShots(s, { record: { count: 3 } });
      s.files['apps/subscriptiontracker/store/android-play/screenshots/03.png'] = shotAt(1080, 1920);
    }));
    assert.equal(r.code, 1);
    assert.match(r.out, /03\.png is committed and .* records NO ink floor for "screenshots\/03\.png"/);
  });

  test('I4 · a floor row naming a frame that is not there FAILS', () => {
    const r = run(build((s) => {
      twoShots(s);
      s.register.storeMetadataContract.perChannel['android-play'].graphicAssets.screenshots.inkFloor.frames['screenshots/99-gone.png'] = {
        measured: 0.02,
        textlessControl: 0.001,
      };
    }));
    assert.equal(r.code, 1);
    assert.match(r.out, /records an ink floor for "screenshots\/99-gone\.png" and no such frame is committed/);
  });

  test('I5 · a floor pushed under its own TEXTLESS control FAILS — it could not have fired', () => {
    // The shape of "edited into something that never matches": every number is
    // still there, the row still looks measured, and the floor now sits below
    // the reading it has to be able to catch. ONE frame only, so the case is not
    // being carried by the self-test that catches I5b.
    const r = run(build((s) => {
      twoShots(s);
      s.register.storeMetadataContract.perChannel['android-play'].graphicAssets.screenshots.inkFloor.frames['screenshots/01.png'].measured = 0.0003;
    }));
    assert.equal(r.code, 1);
    assert.match(r.out, /screenshots\/01\.png"\] puts the floor at 0\.00021/);
    assert.match(r.out, /could not have caught the frames this listing carried from #567 to #854/);
    // …and the frame that kept its honest floor is still judged, not skipped.
    assert.doesNotMatch(r.out, /screenshots\/02\.png"\] puts the floor/);
  });

  test('I5b · flattening EVERY floor at once is caught a layer earlier, by the self-test', () => {
    // 🔴 THE TWO DEFENCES ARE NOT THE SAME DEFENCE. I5 is the per-frame row
    // carrying its own disproof; this is the metric's self-test, which measures
    // the SAME fraction against a synthetic pair before any real frame is read.
    const r = run(build((s) => {
      twoShots(s);
      s.register.storeMetadataContract.perChannel['android-play'].graphicAssets.screenshots.inkFloor.minFractionOfMeasured = 0.001;
    }));
    assert.equal(r.code, 2);
    assert.match(r.out, /the ink metric FAILED ITS OWN SELF-TEST and no frame was measured/);
  });

  test('I6 · a fraction of 0 is COVERAGE LOST — every floor would be 0 and a blank frame would clear it', () => {
    const r = run(build((s) => {
      twoShots(s);
      s.register.storeMetadataContract.perChannel['android-play'].graphicAssets.screenshots.inkFloor.minFractionOfMeasured = 0;
    }));
    assert.equal(r.code, 2);
    assert.match(r.out, /COVERAGE LOST/);
    assert.match(r.out, /which is not a fraction strictly between 0 and 1/);
  });

  test('I7 · floors recorded against a metric this guard does not compute are COVERAGE LOST', () => {
    const r = run(build((s) => {
      twoShots(s);
      s.register.storeMetadataContract.perChannel['android-play'].graphicAssets.screenshots.inkFloor.metric = 'byte-size-v0';
    }));
    assert.equal(r.code, 2);
    assert.match(r.out, /records ink floors against metric "byte-size-v0" and this guard computes "local-contrast-ink-v1"/);
  });

  test('I8 · frames committed with NO inkFloor block PRINTS on a fixture root, and says the real tree is worse', () => {
    // 🔴 THE SPLIT IS DELIBERATE AND IT IS WHY THE OLDER FIXTURES NEXT DOOR ARE
    // STILL HONEST. On the real repository this combination is COVERAGE LOST —
    // measured by hand on 2026-09-21, see this file's header — and a fixture
    // root is the weaker situation the guard already names for its brick limb
    // and its capture limb.
    const r = run(build((s) => {
      twoShots(s);
      delete s.register.storeMetadataContract.perChannel['android-play'].graphicAssets.screenshots.inkFloor;
    }));
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /NO INK FLOOR \(fixture root, NOT JUDGED\): channel "android-play" has 2 committed frame\(s\)/);
    assert.match(r.out, /On the real repository this is COVERAGE LOST/);
    // …and it must NOT claim to have measured anything.
    assert.doesNotMatch(r.out, /committed frame\(s\) measured against the floor/);
  });

  test('I9 · an empty `frames` map is COVERAGE LOST', () => {
    const r = run(build((s) => {
      twoShots(s);
      s.register.storeMetadataContract.perChannel['android-play'].graphicAssets.screenshots.inkFloor.frames = {};
    }));
    assert.equal(r.code, 2);
    assert.match(r.out, /declares an EMPTY `frames` map/);
  });

  test('I10 · an inkFloor block with no `source` fails rather than being enforced', () => {
    const r = run(build((s) => {
      twoShots(s);
      delete s.register.storeMetadataContract.perChannel['android-play'].graphicAssets.screenshots.inkFloor.source;
    }));
    assert.equal(r.code, 1);
    assert.match(r.out, /graphicAssets\.screenshots\.inkFloor declares dimensions with NO `source`/);
  });

  test('I11 · the metric self-tests even with no frame committed at all', () => {
    const r = run(build());
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /SELF-TESTED this run: a synthetic frame carrying glyph-shaped strokes measured/);
    assert.match(r.out, /0 committed frame\(s\) measured/);
  });

  test('I12 · a frame that cannot be DECODED is a finding, never a frame that was measured', () => {
    const r = run(build((s) => {
      twoShots(s);
      s.files['apps/subscriptiontracker/store/android-play/screenshots/02.png'] = png({ width: 1080, height: 1920, colourType: 2 });
    }));
    assert.equal(r.code, 1);
    assert.match(r.out, /02\.png could not be decoded, so its ink was never measured/);
    // …and the run reports no count at all, because a failing run prints no ok
    // lines. "I could not look" must never reach a reader as a measurement.
    assert.doesNotMatch(r.out, /committed frame\(s\) measured/);
  });

  // 🔴 THE MUTATION THE FIXTURES ABOVE CANNOT REACH. A floor is DATA, so I5 and
  // I6 catch it being edited. The metric is CODE, resolved relative to the
  // guard, and the failure that costs everything is it being edited into
  // something that never fires — at which point every frame clears every floor
  // forever and this limb prints ok having measured nothing. The same argument
  // the guard's header already makes about its account-address expression.
  test('I13 · a metric edited to return a constant is COVERAGE LOST before a frame is read', () => {
    const guard = mutatedGuard('tooling/store/frame-ink.mjs', (src) =>
      src.replace('export function inkFraction(img) {', 'export function inkFraction(img) {\n  return 1; // MUTANT: clears every floor'),
    );
    const r = result('mutant', spawnSync(process.execPath, [guard, build((s) => twoShots(s))], { encoding: 'utf8', ...BOUND }));
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /the ink metric FAILED ITS OWN SELF-TEST and no frame was measured/);
  });

  test('I14 · a metric edited to measure nothing is COVERAGE LOST too', () => {
    const guard = mutatedGuard('tooling/store/frame-ink.mjs', (src) =>
      src.replace('export function inkFraction(img) {', 'export function inkFraction(img) {\n  return 0; // MUTANT: measures nothing'),
    );
    const r = result('mutant', spawnSync(process.execPath, [guard, build((s) => twoShots(s))], { encoding: 'utf8', ...BOUND }));
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /FAILED ITS OWN SELF-TEST/);
  });

  test('I15 · GREEN CONTROL for the copy itself — unmutated, it behaves exactly like the guard', () => {
    // Without this, I13 and I14 prove only that a copied tree fails somehow.
    const guard = mutatedGuard('tooling/store/frame-ink.mjs', (src) => `${src}\n// untouched behaviour\n`);
    const r = result('copy', spawnSync(process.execPath, [guard, build((s) => twoShots(s))], { encoding: 'utf8', ...BOUND }));
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /2 committed frame\(s\) measured/);
  });

  test('I16 · the working guard still runs with V8 background tasks OFF — this limb decodes MORE', () => {
    // The ink limb adds a full decode of every frame in every declared device
    // set to a process that already needed the relaunch (nodejs/node#54918).
    const r = run(build((s) => twoShots(s)));
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /V8 background tasks: OFF \(--single-threaded\)/);
  });
});
