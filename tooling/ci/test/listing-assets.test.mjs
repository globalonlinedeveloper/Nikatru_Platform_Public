// ─────────────────────────────────────────────────────────────────────────────
// listing-assets.test.mjs — assert-listing-assets.mjs must be able to FAIL.
//
// ⚠️ REAL-TREE MUTATIONS FIRST, FIXTURES SECOND. This repo has shipped a guard
// whose SIX fixture tests all passed against a broken version
// (assert-seams-wired.mjs), so a fixture written by whoever wrote the guard is
// the weaker evidence — it encodes the same misunderstanding. Every case below
// was run against the ACTUAL repository on 2026-08-04, predictions written
// first, and the fixtures come after.
//
//   M0  the repository as it stands       -> exit 0, screenshot gap PRINTED
//   M1  feature-graphic.png deleted       -> FAIL "is MISSING"
//   M2  feature graphic replaced by the   -> FAIL "is 512x512 and Play requires
//       512x512 icon                          exactly 1024x500"
//   M3  store icon replaced by the        -> FAIL "is 1024x500 and Play requires
//       1024x500 feature graphic              exactly 512x512"
//   M4  both PNGs dropped from            -> FAIL "declared in graphicAssets but
//       additionalFiles                       is NOT named in requiredFiles"
//   M5  an asset's `source` removed       -> FAIL "declares dimensions with NO
//                                             `source`"
//   M6  a correctly-sized DEMO screenshot -> FAIL "holds 1 screenshot(s) and no
//       dropped in, no CAPTURE.json           CAPTURE.json"
//   M7  the same with posture: "demo"     -> FAIL "records posture \"demo\", not
//                                             \"live\""
//   M8  a real 1080x2400 capture          -> FAIL "a ratio of 2.22:1"
//   M9  graphicAssets.assets emptied      -> COVERAGE LOST "EMPTY `assets` map"
//   M10 graphicAssets deleted             -> COVERAGE LOST "no kind:\"store\"
//                                             channel … declares a graphicAssets"
//   M11 screenshots/ deleted              -> FAIL "does not exist. The slot
//                                             itself is part of the contract"
//
// 🔴 M2 AND M3 CAUGHT THE WRONG LIMB, AND THAT IS WHY M2b/M3b EXIST. Copying one
// asset over the other changes the SIZE and the ALPHA at once, and both were
// caught by the dimension check — so after twelve green mutations the
// colour-type check had still never fired. This repo has recorded the identical
// trap before (three "caught" mutations that were really compile errors), so the
// alpha limb was isolated with fixtures that are the RIGHT size and the WRONG
// format:
//
//   M2b 1024x500 WITH an alpha channel    -> FAIL "HAS an alpha channel (PNG
//                                             colour type 6) … requires a
//                                             \"24-bit PNG (no alpha)\""
//   M3b 512x512 WITHOUT an alpha channel  -> FAIL "has NO alpha channel (PNG
//                                             colour type 2) … requires a
//                                             \"32-bit PNG (with alpha)\""
//
// ⚠️ AND THE FIRST ATTEMPT AT M2b WAS NOT A MUTATION AT ALL. It rendered a
// 1024x500 SVG whose opaque `<rect>` covered the canvas, so Chrome emitted
// colour type 2 — a CORRECT feature graphic — and the guard passed. Read
// quickly that looks like "the alpha limb does not work"; it actually means the
// fixture was valid input. The working version draws a circle on a transparent
// canvas. Recorded because the failure mode (a mutation that mutates nothing)
// is invisible unless the fixture itself is checked, which is why the script
// prints the fixture's own colour type before using it.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
// Real compressed pixels for the screenshot fixtures — the guard DECODES those now.
// The same encoder the capture path and the Linux icons use, so a fixture cannot
// disagree with production about what a PNG is.
import { encodeRgba } from '../../store/png-codec.mjs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..');
const GUARD = join(REPO, 'tooling', 'ci', 'assert-listing-assets.mjs');

/**
 * A structurally valid PNG of the given size and colour type.
 *
 * The guard reads the IHDR and walks the chunk list — nothing decodes pixels —
 * so a header plus a well-formed IDAT/IEND is exactly the input it consumes.
 * This is deliberately NOT a hand-typed byte blob: `tRNS` has to be reachable
 * for the transparency limb, and the chunk walk has to hit real lengths, so the
 * chunks are built properly with correct CRCs.
 */
function png({ width, height, colourType = 2, tRNS = false }) {
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
  ihdr[8] = 8; // bit depth
  ihdr[9] = colourType;
  const parts = [
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
  ];
  if (tRNS) parts.push(chunk('tRNS', Buffer.from([0x00])));
  parts.push(chunk('IDAT', deflateSync(Buffer.alloc(1))));
  parts.push(chunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(parts);
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
 * A screenshot fixture with REAL COMPRESSED PIXELS, unlike `png()` above.
 *
 * 🔴 THE ASYMMETRY IS THE POINT. Until 2026-08-04 this guard read PNG HEADERS
 * only, so `png()` emits a valid header over a one-byte IDAT — exactly the input
 * it consumed. The demo-banner limb DECODES, and against those fixtures it
 * reported "could not be decoded" for every frame: the fixture had encoded the
 * guard's old assumption, which is this repository's own recorded rule about
 * fixtures written by whoever wrote the check, arriving on schedule. The
 * fixed-size assets are still never decoded and still use `png()`; inflating
 * them would buy nothing but slower tests.
 *
 * `opaque: true` because Google states "JPEG or 24-bit PNG (no alpha)" for
 * screenshots. A colour-type-6 fixture would trip the alpha limb and every test
 * here would be asserting the wrong failure.
 */
function shotAt(width, height, banner = false) {
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    rgba[i * 4] = 0xf7;
    rgba[i * 4 + 1] = 0xf7;
    rgba[i * 4 + 2] = 0xfb;
    rgba[i * 4 + 3] = 0xff;
  }
  if (banner) {
    // Full-width, at the top: the shape app_shell.dart paints, in the exact
    // colour the fixture's own token file declares. 90 rows is what 30 logical
    // pixels comes to at the DPR 3 the capture uses.
    for (let y = 0; y < Math.min(90, height); y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        rgba[i] = 0xf5;
        rgba[i + 1] = 0x9e;
        rgba[i + 2] = 0x0b;
      }
    }
  }
  return encodeRgba({ width, height, rgba }, { opaque: true });
}

const SOURCE = 'https://support.google.com/googleplay/android-developer/answer/9866151 (fetched 2026-08-04) — fixture';

/** A minimal but STRUCTURALLY HONEST fixture: the same shapes the real register
 *  and the real tree use, so a change in either breaks these tests rather than
 *  leaving them passing against a world that no longer exists. */
function fixture(mutate = () => {}) {
  const root = mkdtempSync(join(tmpdir(), 'nk-listing-'));
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
              // Present because the REAL register declares it and the guard
              // cross-checks CAPTURE.json's recorded size against it. A fixture
              // register missing a key the guard reads makes that limb skip —
              // and a skipped limb under a passing test is the empty-domain
              // failure wearing a green tick.
              recommendedPortrait: { width: 1080, height: 1920 },
              source: SOURCE,
            },
          },
        },
      },
    },
  };
  const files = {
    'apps/subscriptiontracker/store/android-play/feature-graphic.png': png({ width: 1024, height: 500, colourType: 2 }),
    'apps/subscriptiontracker/store/android-play/store-icon-512.png': png({ width: 512, height: 512, colourType: 6 }),
    'apps/subscriptiontracker/store/android-play/screenshots/README.md': Buffer.from('# slot\n'),
    // 🔴 THE TWO FILES THE 2026-08-04 PIXEL LIMBS READ, AND THEY ARE NOT
    // OPTIONAL FIXTURE FURNITURE. Both are the subject of a COVERAGE LOST:
    //
    //   · the design-system token is where the demo banner's COLOUR is read
    //     from, live, rather than pinned in the guard — a pinned hex rots the
    //     day the palette changes and the detector goes on hunting a colour
    //     nothing draws, reporting every screenshot clean;
    //   · `lib/app.dart` is where `debugShowCheckedModeBanner: false` lives, and
    //     the capture runs through `flutter drive`, which builds in DEBUG.
    //
    // A fixture without them models a repository this factory does not have, and
    // every unrelated test would fail for a reason that has nothing to do with
    // what it asserts — which is how a check gets switched off by whoever hits
    // it next. Same correction the launcher-icons fixture needed for `linux/`.
    'packages/design_system/lib/src/tokens/app_colors.dart':
      Buffer.from('class AppColors {\n  static const Color warn = Color(0xFFF59E0B);\n}\n'),
    'apps/subscriptiontracker/lib/app.dart':
      Buffer.from('Widget build() => MaterialApp.router(\n  debugShowCheckedModeBanner: false,\n);\n'),
  };
  const state = { register, files };
  mutate(state);
  write(root, 'catalog/apps.json', Buffer.from(JSON.stringify([{ slug: 'subscriptiontracker' }])));
  write(root, 'tooling/channel-register.json', Buffer.from(JSON.stringify(state.register)));
  // The guard imports ./tree-walk.mjs relative to ITSELF, so the fixture only
  // needs the data tree, not a copy of tooling/ci.
  for (const [rel, buf] of Object.entries(state.files)) write(root, rel, buf);
  return root;
}

function write(root, rel, buf) {
  const p = join(root, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, buf);
}

// BOUNDED, so a spawned script that hangs at exit (nodejs/node#54918 — the class
// swept 2026-09-11) fails its case BY NAME instead of holding the job open until
// CI cancels it with no name at all. `status null` beside the complete output
// means the process was still alive when the bound fired: an exit hang.
// Each spawn stays written out as `spawnSync(process.execPath, [SCRIPT, …])`:
// assert-guard-coverage.mjs credits a test with EXERCISING a script by reading
// that shape, and a wrapper taking the argument list hides the script from it.
const RUN_TIMEOUT_MS = 120_000;
const BOUND = { timeout: RUN_TIMEOUT_MS, killSignal: 'SIGKILL' };
function result(label, r) {
  const died =
    r.error || r.signal
      ? `\n[listing-assets.test] ${label} did not finish — ${r.error ? r.error.message : 'no spawn error'} · ` +
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

describe('assert-listing-assets.mjs — the passing path', () => {
  test('a complete tree with no screenshots yet exits 0 and PRINTS the gap', () => {
    const r = run(build());
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /NO SCREENSHOTS/);
    assert.match(r.out, /2 fixed-size asset\(s\) measured/);
  });

  test('it says out loud what it cannot see', () => {
    const r = run(build());
    assert.match(r.out, /CANNOT SEE: whether a screenshot is REPRESENTATIVE/);
  });

  // 🔴 THE EXIT HANG, PINNED. Spawned exactly as CI runs it — plain `node <guard>`,
  // no flags — the process that does the work must have started with
  // --single-threaded, so no V8 worker thread runs a background compile or GC
  // that Node's shutdown can deadlock on (nodejs/node#54918). Measured
  // 2026-09-11 on this file's fixtures: worker threads burned CPU in 39 of 55
  // runs by default and in 0 of 55 with the flag. Deterministic, unlike the hang:
  // delete the relaunch and this line says ON.
  test('the working guard runs with V8 background tasks OFF, so its exit cannot deadlock', () => {
    const r = run(build());
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /V8 background tasks: OFF \(--single-threaded\)/);
  });
});

describe('assert-listing-assets.mjs — the fixed-size assets', () => {
  test('a missing feature graphic fails', () => {
    const r = run(build((s) => delete s.files['apps/subscriptiontracker/store/android-play/feature-graphic.png']));
    assert.equal(r.code, 1);
    assert.match(r.out, /feature-graphic\.png is MISSING/);
  });

  test('wrong dimensions fail with the exact requirement', () => {
    const r = run(build((s) => {
      s.files['apps/subscriptiontracker/store/android-play/feature-graphic.png'] = png({ width: 1024, height: 512, colourType: 2 });
    }));
    assert.equal(r.code, 1);
    assert.match(r.out, /is 1024x512 and Play requires exactly 1024x500/);
  });

  test('a feature graphic WITH alpha fails — Play requires 24-bit no alpha', () => {
    const r = run(build((s) => {
      s.files['apps/subscriptiontracker/store/android-play/feature-graphic.png'] = png({ width: 1024, height: 500, colourType: 6 });
    }));
    assert.equal(r.code, 1);
    assert.match(r.out, /HAS an alpha channel.*24-bit PNG \(no alpha\)/s);
  });

  test('an icon WITHOUT alpha fails — Play requires 32-bit with alpha', () => {
    const r = run(build((s) => {
      s.files['apps/subscriptiontracker/store/android-play/store-icon-512.png'] = png({ width: 512, height: 512, colourType: 2 });
    }));
    assert.equal(r.code, 1);
    assert.match(r.out, /has NO alpha channel.*32-bit PNG \(with alpha\)/s);
  });

  test('a tRNS chunk counts as alpha even on a colour type without one', () => {
    // The shape Android's stock ic_launcher.png actually is: a palette/greyscale
    // image transparent through tRNS alone. A colour-type-only check passes it.
    const r = run(build((s) => {
      s.files['apps/subscriptiontracker/store/android-play/feature-graphic.png'] = png({ width: 1024, height: 500, colourType: 2, tRNS: true });
    }));
    assert.equal(r.code, 1);
    assert.match(r.out, /HAS an alpha channel/);
  });

  test('a truncated file fails — present is not the same as valid', () => {
    const r = run(build((s) => {
      s.files['apps/subscriptiontracker/store/android-play/feature-graphic.png'] = Buffer.from('not a png at all');
    }));
    assert.equal(r.code, 1);
    assert.match(r.out, /is not a readable PNG/);
  });

  test('an oversized icon fails against the sourced 1024KB ceiling', () => {
    const r = run(build((s) => {
      const base = png({ width: 512, height: 512, colourType: 6 });
      s.files['apps/subscriptiontracker/store/android-play/store-icon-512.png'] = Buffer.concat([base, Buffer.alloc(1048577)]);
    }));
    assert.equal(r.code, 1);
    assert.match(r.out, /Play's maximum is 1048576/);
  });
});

describe('assert-listing-assets.mjs — no number without a citation', () => {
  test('an asset expectation with no `source` fails rather than being enforced', () => {
    const r = run(build((s) => {
      delete s.register.storeMetadataContract.perChannel['android-play'].graphicAssets.assets['feature-graphic.png'].source;
    }));
    assert.equal(r.code, 1);
    assert.match(r.out, /declares dimensions with NO `source`/);
    assert.match(r.out, /invented limit fires on CORRECT input/);
  });

  test('a screenshot block with no `source` fails the same way', () => {
    const r = run(build((s) => {
      delete s.register.storeMetadataContract.perChannel['android-play'].graphicAssets.screenshots.source;
    }));
    assert.equal(r.code, 1);
    assert.match(r.out, /graphicAssets\.screenshots declares dimensions with NO `source`/);
  });
});

describe('assert-listing-assets.mjs — the cross-reference to the metadata contract', () => {
  test('an asset the contract does not name fails, because one guard is too few', () => {
    const r = run(build((s) => {
      s.register.storeMetadataContract.perChannel['android-play'].additionalFiles = [];
    }));
    assert.equal(r.code, 1);
    assert.match(r.out, /NOT named in `requiredFiles`/);
  });

  test('a generator the register names but nobody wrote fails', () => {
    const r = run(build((s) => {
      s.register.storeMetadataContract.perChannel['android-play'].graphicAssets.assets['feature-graphic.png'].generatedBy = 'tooling/store/does-not-exist.mjs';
    }));
    assert.equal(r.code, 1);
    assert.match(r.out, /does-not-exist\.mjs.*does not exist/s);
  });
});

/** Two frames plus their provenance record. Module scope because more than one
 *  describe needs it — the banner detector's tests build the same set. */
const twoShots = (s, opts = {}) => {
  const w = opts.width ?? 1080;
  const h = opts.height ?? 1920;
  s.files['apps/subscriptiontracker/store/android-play/screenshots/01.png'] = shotAt(w, h);
  s.files['apps/subscriptiontracker/store/android-play/screenshots/02.png'] = shotAt(w, h, opts.banner === true);
  if (opts.posture !== null) {
    s.files['apps/subscriptiontracker/store/android-play/screenshots/CAPTURE.json'] = Buffer.from(
      JSON.stringify({ posture: opts.posture ?? 'live', ...(opts.record ?? {}) }),
    );
  }
};

describe('assert-listing-assets.mjs — screenshots and their provenance', () => {

  test('two live 1080x1920 screenshots pass', () => {
    const r = run(build((s) => twoShots(s)));
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /2 screenshot\(s\) measured/);
  });

  test('screenshots with NO provenance file fail even when perfectly sized', () => {
    const r = run(build((s) => twoShots(s, { posture: null })));
    assert.equal(r.code, 1);
    assert.match(r.out, /and no CAPTURE\.json/);
  });

  test('provenance recording a DEMO posture fails', () => {
    const r = run(build((s) => twoShots(s, { posture: 'demo' })));
    assert.equal(r.code, 1);
    assert.match(r.out, /records posture "demo", not "live"/);
  });

  test('a 20:9 handset capture fails the x2 ceiling', () => {
    const r = run(build((s) => twoShots(s, { width: 1080, height: 2400 })));
    assert.equal(r.code, 1);
    assert.match(r.out, /ratio of 2\.22:1/);
  });

  test('a capture below the 320px floor fails', () => {
    const r = run(build((s) => twoShots(s, { width: 180, height: 320 })));
    assert.equal(r.code, 1);
    assert.match(r.out, /"Minimum dimension" is 320px/);
  });

  test('a capture above the 3840px ceiling fails', () => {
    const r = run(build((s) => twoShots(s, { width: 2400, height: 4000 })));
    assert.equal(r.code, 1);
    assert.match(r.out, /"Maximum dimension" is 3840px/);
  });

  test('one screenshot is below Play\'s publish minimum', () => {
    const r = run(build((s) => {
      s.files['apps/subscriptiontracker/store/android-play/screenshots/01.png'] = shotAt(1080, 1920);
      s.files['apps/subscriptiontracker/store/android-play/screenshots/CAPTURE.json'] = Buffer.from(JSON.stringify({ posture: 'live' }));
    }));
    assert.equal(r.code, 1);
    assert.match(r.out, /requires at least 2/);
  });

  test('nine screenshots exceed the per-device-type ceiling', () => {
    const r = run(build((s) => {
      for (let i = 1; i <= 9; i++) {
        s.files[`apps/subscriptiontracker/store/android-play/screenshots/0${i}.png`] = png({ width: 1080, height: 1920, colourType: 2 });
      }
      s.files['apps/subscriptiontracker/store/android-play/screenshots/CAPTURE.json'] = Buffer.from(JSON.stringify({ posture: 'live' }));
    }));
    assert.equal(r.code, 1);
    assert.match(r.out, /at most 8 per device type/);
  });

  test('a deleted screenshots directory fails — the slot is the contract', () => {
    const r = run(build((s) => delete s.files['apps/subscriptiontracker/store/android-play/screenshots/README.md']));
    assert.equal(r.code, 1);
    assert.match(r.out, /screenshots does not exist/);
  });

  test('a SERVED channel with no screenshots FAILS instead of printing', () => {
    const r = run(build((s) => {
      s.register.channels[0].served = true;
    }));
    assert.equal(r.code, 1);
    assert.match(r.out, /is SERVED and .*holds NO screenshots/s);
  });

  // ── THE PIXELS: the demo banner, measured rather than claimed ─────────────
  // 🔴 REAL-TREE MUTATIONS FIRST, 2026-08-04, on apps/subscriptiontracker. The listing
  // directory holds no screenshots yet, so these were run by writing real
  // 1080x1920 PNGs INTO the actual directory, observing, and removing them:
  //   · a clean frame + a frame with a full-width #f59e0b band across the top,
  //     CAPTURE.json posture "live", count 2
  //       ⇒ FAIL "carries a FULL-WIDTH BAND of the demo-banner colour … (100.0%
  //         of a row, threshold 60%)" — on the banded frame ONLY. The clean
  //         frame drew no banner complaint, which is the half that proves the
  //         detector is not simply always-on.
  //   · then the banded frame deleted, leaving CAPTURE.json claiming 2
  //       ⇒ FAIL "records count 2 and … holds 1 screenshot(s)"
  //   · `warn` renamed to `warning` in the REAL packages/design_system token file
  //       ⇒ COVERAGE LOST "declares no `static const Color warn = Color(0x…)`"
  //   · BANNER_ROW_FRACTION set to 1.1 in the REAL guard
  //       ⇒ COVERAGE LOST "FAILED ITS OWN SELF-TEST … banded frame measured
  //         0.969 (needs >= 1.1)"
  //   · `debugShowCheckedModeBanner: false` deleted from apps/subscriptiontracker/lib/app.dart
  //       ⇒ FAIL "builds a MaterialApp and does not set …", and `dart analyze`
  //         on the mutated file reported "No issues found!" — so the guard caught
  //         a REAL defect and not a compile error, which this repo has mistaken
  //         for a caught mutation three times in one session before.
  // All restored; `git diff --stat` empty afterwards for each.
  test('a screenshot carrying the demo banner FAILS on its pixels', () => {
    const r = run(build((s) => twoShots(s, { banner: true })));
    assert.equal(r.code, 1);
    assert.match(r.out, /02\.png carries a FULL-WIDTH BAND of the demo-banner colour/);
  });

  // The other half, and the one that stops the assertion above from being a
  // constant: a clean frame must NOT be reported, or the limb is just noise that
  // somebody will eventually delete.
  test('a clean screenshot is decoded and reported clean', () => {
    const r = run(build((s) => twoShots(s)));
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /2 screenshot\(s\) DECODED/);
    assert.doesNotMatch(r.out, /FULL-WIDTH BAND/);
  });

  test('the provenance record must agree with how many frames are there', () => {
    const r = run(build((s) => twoShots(s, { record: { count: 5 } })));
    assert.equal(r.code, 1);
    assert.match(r.out, /records count 5 and .* holds 2 screenshot\(s\)/);
  });

  // NOT "1080x1920 because Google says so" — Google recommends it, and enforcing
  // a recommendation as a requirement is the invented-limit failure. What is
  // mandatory is that one capture at one viewport produced one size.
  test('a frame that disagrees with its own CAPTURE.json size fails', () => {
    const r = run(build((s) => twoShots(s, { record: { pixels: '1080x1920' }, width: 1080, height: 1440 })));
    assert.equal(r.code, 1);
    assert.match(r.out, /is 1080x1440 and the set's own CAPTURE\.json records 1080x1920/);
  });

  test('a recorded size that contradicts the register fails', () => {
    const r = run(build((s) => twoShots(s, { record: { pixels: '720x1280' }, width: 720, height: 1280 })));
    assert.equal(r.code, 1);
    assert.match(r.out, /records pixels "720x1280" and .* declares a recommended portrait of 1080x1920/);
  });
});

describe('assert-listing-assets.mjs — the banner detector cannot go dark', () => {
  // 🔴 THIS IS THE LIMB THAT MATTERS MOST TODAY, because the real listing
  // directory is EMPTY: with no screenshots committed the banner check ranges
  // over nothing and would print ok forever. An assertion that cannot fail is
  // worse than none — it inflates apparent coverage — so the detector proves
  // itself against two in-memory frames on every single run, whether or not any
  // screenshot exists.
  test('the self-test runs and is reported even with no screenshots at all', () => {
    const r = run(build());
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /detector SELF-TESTED this run/);
    assert.match(r.out, /0 screenshot\(s\) DECODED/);
    assert.match(r.out, /and 0 is why the self-test exists/);
  });

  test('COVERAGE LOST when the token file no longer declares `warn`', () => {
    const r = run(build((s) => {
      s.files['packages/design_system/lib/src/tokens/app_colors.dart'] =
        Buffer.from('class AppColors {\n  static const Color warning = Color(0xFFF59E0B);\n}\n');
    }));
    assert.equal(r.code, 2);
    assert.match(r.out, /COVERAGE LOST/);
    assert.match(r.out, /declares no `static const Color warn = Color\(0x…\)`/);
  });

  // The colour is read live rather than pinned, so a palette change must move
  // the detector with it. If the token says something else, a band of the OLD
  // colour must no longer register — proving the guard follows the token instead
  // of a memory of it.
  test('the detector follows the token, not a pinned hex', () => {
    const r = run(build((s) => {
      twoShots(s, { banner: true });
      s.files['packages/design_system/lib/src/tokens/app_colors.dart'] =
        Buffer.from('class AppColors {\n  static const Color warn = Color(0xFF00FF00);\n}\n');
    }));
    assert.doesNotMatch(r.out, /FULL-WIDTH BAND/);
    assert.match(r.out, /#00ff00/);
  });
});

describe('assert-listing-assets.mjs — the DEBUG ribbon', () => {
  test('an app that does not disable the checked-mode banner fails', () => {
    const r = run(build((s) => {
      s.files['apps/subscriptiontracker/lib/app.dart'] = Buffer.from('Widget build() => MaterialApp.router();\n');
    }));
    assert.equal(r.code, 1);
    assert.match(r.out, /does not set `debugShowCheckedModeBanner: false`/);
  });

  // Comment-stripped, so prose mentioning the flag must NOT satisfy it. Prose
  // satisfying a structural check is the trap this repo has been caught by twice.
  test('the flag in a COMMENT does not satisfy it', () => {
    const r = run(build((s) => {
      s.files['apps/subscriptiontracker/lib/app.dart'] = Buffer.from(
        '// debugShowCheckedModeBanner: false, <- only in a comment\nWidget build() => MaterialApp.router();\n',
      );
    }));
    assert.equal(r.code, 1);
    assert.match(r.out, /does not set `debugShowCheckedModeBanner: false`/);
  });

  // ── THE SHELL MOVED INTO THE PACKAGE, AND THE LIMB FOLLOWED IT ──────────
  //
  // 🔴 THE SILENT SKIP THIS CLOSES, 2026-09-07 ([ADR 067] phase 2, unit
  // app-shell). `MaterialApp.router` is now `NikatruApp` in
  // `package:nikatru_chassis_screens/shell/app_shell.dart`, and the flag went
  // with it because it is a property of the app SHELL. Read at the adapter
  // alone a stamped app no longer matches `MaterialApp`, so it is skipped by
  // the `continue` that exists for catalogue rows with no app tree — and
  // `debugBannerAppsChecked` still counts every OTHER app, so the COVERAGE LOST
  // beneath never fires. A limb judging nothing while printing a healthy count
  // is the exact shape this guard's neighbours have been bitten by.
  test('D1 · GREEN CONTROL — the flag is found in the chassis file the app delegates to', () => {
    const r = run(build((s) => {
      s.files['apps/subscriptiontracker/lib/app.dart'] = Buffer.from(
        "import 'package:nikatru_chassis_screens/shell/app_shell.dart';\n" +
          'Widget build() => const NikatruApp();\n',
      );
      s.files['packages/chassis_screens/lib/shell/app_shell.dart'] = Buffer.from(
        'class NikatruApp extends StatelessWidget {\n' +
          '  Widget build(BuildContext c) => MaterialApp.router(\n' +
          '    debugShowCheckedModeBanner: false,\n  );\n}\n',
      );
    }));
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /1 app\(s\) building a MaterialApp all set `debugShowCheckedModeBanner: false`/);
  });

  test('D2 · FAILS when the chassis shell does not set the flag either', () => {
    const r = run(build((s) => {
      s.files['apps/subscriptiontracker/lib/app.dart'] = Buffer.from(
        "import 'package:nikatru_chassis_screens/shell/app_shell.dart';\n" +
          'Widget build() => const NikatruApp();\n',
      );
      s.files['packages/chassis_screens/lib/shell/app_shell.dart'] = Buffer.from(
        'class NikatruApp extends StatelessWidget {\n' +
          '  Widget build(BuildContext c) => MaterialApp.router();\n}\n',
      );
    }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /does not set `debugShowCheckedModeBanner: false`/);
  });

  test('D3 · a delegation that cannot be followed is a problem, never a quiet skip', () => {
    const r = run(build((s) => {
      s.files['apps/subscriptiontracker/lib/app.dart'] = Buffer.from(
        "import 'package:nikatru_chassis_screens/shell/gone.dart';\n" +
          'Widget build() => const NikatruApp();\n',
      );
    }));
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /COVERAGE LOST — apps\/subscriptiontracker\/lib\/app\.dart/);
  });

  // ── THE BRICK IS IN THE DOMAIN — 2026-09-14, O-LISTING-ASSETS-DEBUG-RIBBON-DOMAIN ──
  //
  // 🔴 D1-D3 PROVED THE DELEGATION BRANCH ON A FIXTURE AND NOTHING ELSE. The
  // catalogue's one real app sets the flag inline and does not delegate, so on
  // every tree CI ran that branch judged nothing: deleting the flag from
  // packages/chassis_screens/lib/shell/app_shell.dart left the guard at EXIT 0.
  // The file that DOES delegate is the brick's lib/app.dart. B1 is the green
  // control; B2 is that exact deletion with the catalogue app still clean, so
  // only the brick half can turn it red.
  const BRICK_APP = 'tooling/bricks/app/__brick__/apps/{{app_id}}/lib/app.dart';
  const brickAdapter = () =>
    Buffer.from(
      "import 'package:nikatru_chassis_screens/shell/app_shell.dart';\n" +
        'class BrickApp {\n  Widget build() => const NikatruApp();\n}\n',
    );

  test('B1 · GREEN CONTROL — the brick delegates to a chassis shell that sets the flag', () => {
    const r = run(build((s) => {
      s.files[BRICK_APP] = brickAdapter();
      s.files['packages/chassis_screens/lib/shell/app_shell.dart'] = Buffer.from(
        'class NikatruApp extends StatelessWidget {\n' +
          '  Widget build(BuildContext c) => MaterialApp.router(\n' +
          '    debugShowCheckedModeBanner: false,\n  );\n}\n',
      );
    }));
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /1 app\(s\) building a MaterialApp all set `debugShowCheckedModeBanner: false`/);
    assert.match(r.out, /the brick template \(tooling\/bricks\/app\/__brick__\/apps\/\{\{app_id\}\}\/lib\/app\.dart/);
  });

  test('B2 · FAILS when the flag is deleted from the chassis shell the brick delegates to', () => {
    const r = run(build((s) => {
      s.files[BRICK_APP] = brickAdapter();
      s.files['packages/chassis_screens/lib/shell/app_shell.dart'] = Buffer.from(
        'class NikatruApp extends StatelessWidget {\n' +
          '  Widget build(BuildContext c) => MaterialApp.router(\n  );\n}\n',
      );
    }));
    assert.equal(r.code, 1, r.out);
    assert.match(
      r.out,
      /tooling\/bricks\/app\/__brick__\/apps\/\{\{app_id\}\}\/lib\/app\.dart builds a MaterialApp and does not set `debugShowCheckedModeBanner: false`/,
    );
  });

  test('B3 · a brick whose shell no longer builds a MaterialApp is COVERAGE LOST, not a skip', () => {
    const r = run(build((s) => {
      s.files[BRICK_APP] = brickAdapter();
      s.files['packages/chassis_screens/lib/shell/app_shell.dart'] = Buffer.from(
        'class NikatruApp extends StatelessWidget {\n  Widget build(BuildContext c) => const Placeholder();\n}\n',
      );
    }));
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /COVERAGE LOST — tooling\/bricks\/app\/__brick__\/apps\/\{\{app_id\}\}\/lib\/app\.dart was read/);
  });

  test('B4 · a fixture root with no brick says the brick half was not judged', () => {
    const r = run(build());
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /no brick template in this tree \(a fixture root\); the brick half was not judged/);
  });

  test('COVERAGE LOST when no app builds a MaterialApp at all', () => {
    const r = run(build((s) => {
      delete s.files['apps/subscriptiontracker/lib/app.dart'];
    }));
    assert.equal(r.code, 2);
    assert.match(r.out, /not one app under apps\/ was found building a MaterialApp/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// tooling/store/capture-play-screenshots.mjs — THE POSTURE GATE MUST BE ABLE TO
// REFUSE.
//
// That script is what stands between a demo capture and the Play listing, and
// it is the half of the arrangement the guard cannot see: by the time
// assert-listing-assets.mjs runs, the bytes are already in the tree. Both
// refusals below happen before chromedriver or Flutter is touched, so these
// tests are hermetic and fast — and both were added because
// assert-guard-coverage.mjs failed the build for their absence, which is that
// guard doing exactly its job.
//
// The environment is scrubbed on purpose. Inheriting a real SUPABASE_URL from
// the shell would send the second test down the live path and turn a negative
// test into a hang — an assertion that cannot fail, wearing a green tick.
// ─────────────────────────────────────────────────────────────────────────────
describe('capture-play-screenshots.mjs — the posture gate', () => {
  const CAPTURE = join(REPO, 'tooling', 'store', 'capture-play-screenshots.mjs');
  const LISTING = join(REPO, 'apps', 'subscriptiontracker', 'store', 'android-play', 'screenshots');

  /** Every variable the live path keys off, explicitly absent. */
  const scrubbed = () => {
    const env = { ...process.env };
    for (const k of ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'E2E_EMAIL', 'E2E_PASSWORD']) delete env[k];
    return env;
  };

  const capture = (args, env = scrubbed()) =>
    result('capture runner', spawnSync(process.execPath, [CAPTURE, ...args], { encoding: 'utf8', env, ...BOUND }));

  test('--proof REFUSES to write into the live listing directory', () => {
    const r = capture(['--proof', '--out', LISTING]);
    assert.equal(r.code, 1);
    assert.match(r.out, /asked to write into the live listing directory/);
    // The refusal has to say WHY, or the next person deletes the check.
    assert.match(r.out, /Demo data - sample subscriptions, not your account/);
  });

  test('a live capture with no credentials REFUSES, and explains the posture', () => {
    const r = capture([]);
    assert.equal(r.code, 1);
    assert.match(r.out, /a live capture needs .*and they are not set/);
    assert.match(r.out, /THIS IS NOT A CONFIGURATION NAG/);
    assert.match(r.out, /third-party trademarks/);
  });

  test('an app with no capture suite REFUSES rather than driving nothing', () => {
    // Past the posture gate on purpose — the point is that a missing suite is
    // caught instead of producing a clean run over zero screenshots.
    const env = scrubbed();
    for (const k of ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'E2E_EMAIL', 'E2E_PASSWORD']) env[k] = 'x';
    const r = capture(['--app', 'no-such-app'], env);
    assert.equal(r.code, 1);
    assert.match(r.out, /carries no integration_test\/store_screenshots_test\.dart/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE CAPTURE ITSELF — WHOSE ACCOUNT ENDS UP ON THE LISTING.
//
// 🔴 REAL-TREE MUTATIONS FIRST, 2026-08-05, on apps/subscriptiontracker. Predictions written
// before each run; every one restored afterwards (`git status` clean).
//
//   A  the `05-settings` frame re-added to the real suite, WITH its import so
//      the file is valid Dart
//        ⇒ FAIL "the capture of \"05-settings\" photographs `SettingsScreen`,
//          and apps/subscriptiontracker/lib/features/settings/settings_screen.dart READS THE
//          SIGNED-IN ACCOUNT'S ADDRESS". `flutter analyze` on the mutated tree
//          reported the SAME 21 pre-existing infos and nothing in either changed
//          file — so the guard caught a real defect and not a compile error,
//          which this repo has mistaken for a caught mutation three times.
//   B  one `captureFrame(…)` replaced by `binding.takeScreenshot('04-budget')`
//        ⇒ FAIL "calls `takeScreenshot(` directly"
//   C  the `expect(find.byType(BudgetScreen), …)` line deleted
//        ⇒ FAIL "not preceded by a `find.byType(...)` naming the screen"
//   D  integration_test/store_capture_guard.dart moved away
//        ⇒ FAIL "does not exist. That file is the refusal…"
//   E  `textContaining` swapped for `text` inside the refusal
//        ⇒ FAIL "no longer looks for the account in the widget tree"
//   E2 `if (forbidden.isEmpty)` swapped for `if (false)`
//        ⇒ FAIL "no longer refuses on an EMPTY set of forbidden strings"
//   F  ACCOUNT_ADDRESS_READ edited to /\.emailAddress\b/ in the REAL module
//        ⇒ COVERAGE LOST "FAILED ITS OWN SELF-TEST … measured false (needs
//          true)", and `capture-play-screenshots.mjs --proof` refused with the
//          same reason before touching chromedriver
//   G  integration_test/store_screenshots_test.dart moved away
//        ⇒ COVERAGE LOST "not one app under apps/ carries
//          integration_test/store_screenshots_test.dart"
//   H  A, plus the account-card `Text(user?.email)` deleted from the REAL
//      settings screen
//        ⇒ still FAIL — and that is the guard's OVER-APPROXIMATION showing
//          itself, not a bug: `_deleteAccount` re-authenticates with
//          `signInWithEmail(email: user.email, …)`, a read that never reaches a
//          pixel. Recorded in `readsAccountAddress`'s own doc comment rather
//          than discovered again later. A regex cannot follow a value from a
//          read to a pixel; the narrow version would miss `Text(_label(user))`
//          and pass a leaking frame, which is the direction that costs
//          something. The exact question is answered at capture time.
//
// ⏱ 2026-09-24, limbs 4 and 5 (O-DESKTOP-CAPTURE-HAS-NO-SHUTTER), the same way,
// each restored afterwards and the tree diff compared byte for byte:
//
//   I  the real suite's `01-home` frame put back to `take: binding.takeScreenshot`
//        ⇒ FAIL "store_screenshots_test.dart:1483 — limb 4 (one shutter): a
//          frame is handed `take: binding.takeScreenshot`", the first and only
//          finding. Before limb 4, every frame took exactly that tear-off and
//          this guard exited 0.
//   J  the real shutter file's `TargetPlatform.windows => StoreShutterKind.layer,`
//      arm set to `…plugin,`
//        ⇒ FAIL "store_frame_shutter.dart — limb 5 (desktop shutter): the
//          register captures on `windows` and the shutter file's code has no
//          `TargetPlatform.windows => StoreShutterKind.layer,` arm"
//
// The fixtures below come after, and model the same shapes.
// ─────────────────────────────────────────────────────────────────────────────
describe('assert-listing-assets.mjs — the capture cannot photograph the account', () => {
  /** A capture suite in the shape the scan reads: ONE `storeShutter(` binding,
   *  then per frame one `find.byType` naming the screen and one `captureFrame`
   *  that takes the bound `shutter`. */
  const SHUTTER_BINDING = [
    '    final StoreShutter shutter = storeShutter(',
    '      tester: tester,',
    '      sink: BindingScreenshotSink(binding),',
    '      kind: currentStoreShutterKind(),',
    '    );',
  ];
  const suite = (frames) =>
    Buffer.from(
      [
        "import 'store_capture_guard.dart';",
        "import 'store_frame_shutter.dart';",
        '',
        'void main() {',
        "  testWidgets('captures the set', (WidgetTester tester) async {",
        ...SHUTTER_BINDING,
        ...frames.flatMap(([frame, screen]) => [
          `    expect(find.byType(${screen}), findsWidgets);`,
          '    await captureFrame(',
          '      take: shutter,',
          `      frame: '${frame}',`,
          '      forbidden: forbidden,',
          '    );',
        ]),
        '  });',
        '}',
      ].join('\n'),
    );

  /** The shutter file, reduced to what limb 5 reads: one arm per platform, the
   *  windows arm's kind (and whether it is commented out) chosen by the case. */
  const shutterLib = ({ windows = 'layer', windowsCommented = false } = {}) =>
    Buffer.from(
      [
        'StoreShutterKind storeShutterKindFor({',
        '  required bool isWeb,',
        '  required TargetPlatform platform,',
        '}) {',
        '  if (isWeb) {',
        '    return StoreShutterKind.plugin;',
        '  }',
        '  return switch (platform) {',
        '    TargetPlatform.android => StoreShutterKind.plugin,',
        '    TargetPlatform.iOS => StoreShutterKind.plugin,',
        '    TargetPlatform.linux => StoreShutterKind.layer,',
        `    ${windowsCommented ? '// ' : ''}TargetPlatform.windows => StoreShutterKind.${windows},`,
        '    TargetPlatform.macOS => StoreShutterKind.layer,',
        "    TargetPlatform.fuchsia => throw ArgumentError.value(platform),",
        '  };',
        '}',
      ].join('\n'),
    );

  /** The fixture register's android-play screenshots gain a capture set per
   *  device, in the real register's shape: this is how the guard learns which
   *  devices limb 5 must judge. `dir` is the channel's own screenshot dir, so
   *  no other limb gains a directory to read. */
  const captureOn = (s, devices) => {
    const sets = {};
    devices.forEach((flutterDevice, i) => {
      sets[`set${i}`] = { dir: 'screenshots', capture: { flutterDevice, logicalWidth: 1280, logicalHeight: 800, dpr: 2 } };
    });
    s.register.storeMetadataContract.perChannel['android-play'].graphicAssets.screenshots.deviceTypeCoverage = { sets };
  };
  const SHUTTER_REL = 'apps/subscriptiontracker/integration_test/store_frame_shutter.dart';
  const SUITE_REL = 'apps/subscriptiontracker/integration_test/store_screenshots_test.dart';

  /** The refusal, reduced to the three things the scan requires of it. Its
   *  BEHAVIOUR is proven in apps/subscriptiontracker/test/store_capture_guard_test.dart, in a
   *  real widget tree; what is checked here is that the suite still routes
   *  through it and that it still contains its own two limbs. */
  const guardLib = Buffer.from(
    [
      'Future<void> captureFrame({',
      '  required Future<void> Function(String frame) take,',
      '  required String frame,',
      '  required Set<String> forbidden,',
      '}) async {',
      "  if (forbidden.isEmpty) { fail('nothing to look for'); }",
      '  final List<String> onScreen = forbidden',
      '      .where((String n) => find.textContaining(n).evaluate().isNotEmpty)',
      '      .toList();',
      "  if (onScreen.isNotEmpty) { fail('the account is on screen'); }",
      '  await take(frame);',
      '}',
    ].join('\n'),
  );

  const cleanScreen = (name) =>
    Buffer.from(`class ${name} extends ConsumerWidget {\n  Widget build(_, __) => const Text('Subscriptions');\n}\n`);

  const leakingScreen = (name) =>
    Buffer.from(
      `class ${name} extends ConsumerWidget {\n` +
        '  Widget build(BuildContext context, WidgetRef ref) {\n' +
        '    final AuthUser? user = ref.watch(authRepositoryProvider).currentUser;\n' +
        "    return Text(user?.email ?? '');\n" +
        '  }\n}\n',
    );

  /** A tree that captures two clean frames through the guarded shutter. */
  const withCapture = (s, mutate = () => {}) => {
    s.files['apps/subscriptiontracker/integration_test/store_capture_guard.dart'] = guardLib;
    s.files[SHUTTER_REL] = shutterLib();
    s.files['apps/subscriptiontracker/integration_test/store_screenshots_test.dart'] = suite([
      ['01-home', 'HomeScreen'],
      ['02-settings', 'SettingsScreen'],
    ]);
    s.files['apps/subscriptiontracker/lib/features/home/home_screen.dart'] = cleanScreen('HomeScreen');
    s.files['apps/subscriptiontracker/lib/features/settings/settings_screen.dart'] = cleanScreen('SettingsScreen');
    mutate(s);
  };

  test('a suite whose frames photograph no account passes, and says how many', () => {
    const r = run(build((s) => withCapture(s)));
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /THE ACCOUNT — 1 capture suite\(s\) read, 2 frame\(s\) resolved/);
  });

  // 🔴 THE DEFECT ITSELF, AS A FIXTURE. This is `05-settings.png`.
  test('a frame of a screen that reads the account address FAILS', () => {
    const r = run(build((s) =>
      withCapture(s, (t) => {
        t.files['apps/subscriptiontracker/lib/features/settings/settings_screen.dart'] = leakingScreen('SettingsScreen');
      }),
    ));
    assert.equal(r.code, 1);
    assert.match(r.out, /the capture of "02-settings" photographs `SettingsScreen`/);
    assert.match(r.out, /READS THE SIGNED-IN ACCOUNT'S ADDRESS/);
    // The message has to carry the history, or the next person deletes the check.
    assert.match(r.out, /no guard in this tree can read text out of an image/);
  });

  // Comment- and string-stripped, both directions. A screen whose only mention
  // of the address is prose or a label is NOT a leak, and a guard that said
  // otherwise would fire on correct input — this repo has already rejected its
  // own fixture at 129 characters against a made-up "120 or fewer".
  test('the word `email` in a comment or a label is not a read of the session', () => {
    const r = run(build((s) =>
      withCapture(s, (t) => {
        t.files['apps/subscriptiontracker/lib/features/settings/settings_screen.dart'] = Buffer.from(
          'class SettingsScreen extends ConsumerWidget {\n' +
            '  // The account row used to read user?.email here.\n' +
            "  Widget build(_, __) => const Text('Email preferences');\n}\n",
        );
      }),
    ));
    assert.equal(r.code, 0, r.out);
    assert.doesNotMatch(r.out, /READS THE SIGNED-IN ACCOUNT/);
  });

  test('a direct takeScreenshot( call bypasses the refusal and FAILS', () => {
    const r = run(build((s) =>
      withCapture(s, (t) => {
        t.files['apps/subscriptiontracker/integration_test/store_screenshots_test.dart'] = Buffer.from(
          [
            'void main() {',
            ...SHUTTER_BINDING,
            '  expect(find.byType(HomeScreen), findsWidgets);',
            "  await binding.takeScreenshot('01-home');",
            '  expect(find.byType(SettingsScreen), findsWidgets);',
            "  await captureFrame(frame: '02-settings', forbidden: forbidden);",
            '}',
          ].join('\n'),
        );
      }),
    ));
    assert.equal(r.code, 1);
    assert.match(r.out, /calls `takeScreenshot\(` directly/);
  });

  test('a capture that names no screen FAILS rather than being skipped', () => {
    const r = run(build((s) =>
      withCapture(s, (t) => {
        t.files['apps/subscriptiontracker/integration_test/store_screenshots_test.dart'] = Buffer.from(
          [
            'void main() {',
            ...SHUTTER_BINDING,
            '  expect(find.byType(HomeScreen), findsWidgets);',
            "  await captureFrame(take: shutter, frame: '01-home', forbidden: forbidden);",
            "  await captureFrame(take: shutter, frame: '02-mystery', forbidden: forbidden);",
            '}',
          ].join('\n'),
        );
      }),
    ));
    assert.equal(r.code, 1);
    assert.match(r.out, /the capture of "02-mystery" is not preceded by a `find\.byType/);
  });

  test('a captured screen whose class is nowhere in lib/ FAILS', () => {
    const r = run(build((s) =>
      withCapture(s, (t) => {
        delete t.files['apps/subscriptiontracker/lib/features/settings/settings_screen.dart'];
      }),
    ));
    assert.equal(r.code, 1);
    assert.match(r.out, /no file under apps\/subscriptiontracker\/lib declares `class SettingsScreen`/);
  });

  test('a missing refusal library FAILS', () => {
    const r = run(build((s) =>
      withCapture(s, (t) => {
        delete t.files['apps/subscriptiontracker/integration_test/store_capture_guard.dart'];
      }),
    ));
    assert.equal(r.code, 1);
    assert.match(r.out, /store_capture_guard\.dart does not exist/);
  });

  // A refusal that is still called and can no longer refuse is STRICTLY WORSE
  // than none: the suite reads as guarded.
  test('a refusal that stopped reading the widget tree FAILS', () => {
    const r = run(build((s) =>
      withCapture(s, (t) => {
        t.files['apps/subscriptiontracker/integration_test/store_capture_guard.dart'] = Buffer.from(
          [
            'Future<void> captureFrame({',
            '  required Future<void> Function(String frame) take,',
            '  required String frame,',
            '  required Set<String> forbidden,',
            '}) async {',
            "  if (forbidden.isEmpty) { fail('nothing to look for'); }",
            '  await take(frame);',
            '}',
          ].join('\n'),
        );
      }),
    ));
    assert.equal(r.code, 1);
    assert.match(r.out, /no longer looks for the account in the widget tree/);
  });

  test('a refusal that no longer refuses an EMPTY needle set FAILS', () => {
    const r = run(build((s) =>
      withCapture(s, (t) => {
        t.files['apps/subscriptiontracker/integration_test/store_capture_guard.dart'] = Buffer.from(
          [
            'Future<void> captureFrame({',
            '  required Future<void> Function(String frame) take,',
            '  required String frame,',
            '  required Set<String> forbidden,',
            '}) async {',
            '  final List<String> onScreen = forbidden',
            '      .where((String n) => find.textContaining(n).evaluate().isNotEmpty)',
            '      .toList();',
            "  if (onScreen.isNotEmpty) { fail('the account is on screen'); }",
            '  await take(frame);',
            '}',
          ].join('\n'),
        );
      }),
    ));
    assert.equal(r.code, 1);
    assert.match(r.out, /no longer refuses on an EMPTY set/);
  });

  test('a suite that captures nothing at all FAILS', () => {
    const r = run(build((s) =>
      withCapture(s, (t) => {
        t.files['apps/subscriptiontracker/integration_test/store_screenshots_test.dart'] = Buffer.from(
          ['void main() {', ...SHUTTER_BINDING, '  expect(find.byType(HomeScreen), findsWidgets);', '}', ''].join('\n'),
        );
      }),
    ));
    assert.equal(r.code, 1);
    assert.match(r.out, /contains no `captureFrame\(` call/);
  });

  // The scan reads CODE, not prose — in both directions. A commented-out capture
  // is not a capture, and this repo has shipped a guard satisfied by its own
  // explanatory comment.
  test('a commented-out capture is not counted as a frame', () => {
    const r = run(build((s) =>
      withCapture(s, (t) => {
        t.files['apps/subscriptiontracker/integration_test/store_screenshots_test.dart'] = Buffer.from(
          [
            'void main() {',
            ...SHUTTER_BINDING,
            '  expect(find.byType(HomeScreen), findsWidgets);',
            "  await captureFrame(take: shutter, frame: '01-home', forbidden: forbidden);",
            "  // await captureFrame(take: shutter, frame: '02-settings', forbidden: forbidden);",
            '}',
          ].join('\n'),
        );
      }),
    ));
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /1 frame\(s\) resolved/);
  });

  // ── limbs 4 and 5 · ⏱ 2026-09-24 · O-DESKTOP-CAPTURE-HAS-NO-SHUTTER ────────
  // Limb 4: the suite binds ONE `storeShutter(` and every frame takes it. Limb 5:
  // every desktop device the register captures on has a layer arm in the shutter
  // file's code. The devices reach the guard the way the real ones do, through a
  // capture block in the fixture register (`captureOn`), never through an argument.

  test('🔴 limb 4 — a frame handed the binding\'s tear-off FAILS, naming the suite line', () => {
    const r = run(build((s) =>
      withCapture(s, (t) => {
        t.files[SUITE_REL] = Buffer.from(
          [
            'void main() {',
            ...SHUTTER_BINDING,
            '  expect(find.byType(HomeScreen), findsWidgets);',
            "  await captureFrame(take: binding.takeScreenshot, frame: '01-home', forbidden: forbidden);",
            '}',
          ].join('\n'),
        );
      }),
    ));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /store_screenshots_test\.dart:8 — limb 4 \(one shutter\): a frame is handed `take: binding\.takeScreenshot`/);
  });

  test('🔴 limb 4 — a second `storeShutter(` binding FAILS', () => {
    const r = run(build((s) =>
      withCapture(s, (t) => {
        t.files[SUITE_REL] = Buffer.from(
          [
            'void main() {',
            ...SHUTTER_BINDING,
            '  final StoreShutter other = storeShutter(tester: tester, sink: sink, kind: kind);',
            '  expect(find.byType(HomeScreen), findsWidgets);',
            "  await captureFrame(take: shutter, frame: '01-home', forbidden: forbidden);",
            '}',
          ].join('\n'),
        );
      }),
    ));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /store_screenshots_test\.dart:7 — limb 4 \(one shutter\): the suite binds 2 `storeShutter\(` shutter\(s\)/);
  });

  test('🔴 limb 4 — a direct call of the shutter skips the refusal and FAILS', () => {
    const r = run(build((s) =>
      withCapture(s, (t) => {
        t.files[SUITE_REL] = Buffer.from(
          [
            'void main() {',
            ...SHUTTER_BINDING,
            '  expect(find.byType(HomeScreen), findsWidgets);',
            "  await captureFrame(take: shutter, frame: '01-home', forbidden: forbidden);",
            '  expect(find.byType(SettingsScreen), findsWidgets);',
            "  await shutter('02-settings');",
            '}',
          ].join('\n'),
        );
      }),
    ));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /store_screenshots_test\.dart:10 — limb 4 \(one shutter\): the shutter is called directly/);
  });

  test('🔴 limb 4 still fires on a suite with ZERO `captureFrame(` calls — it sits before limb 3\'s early return', () => {
    const r = run(build((s) =>
      withCapture(s, (t) => {
        t.files[SUITE_REL] = Buffer.from('void main() {\n  expect(find.byType(HomeScreen), findsWidgets);\n}\n');
      }),
    ));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /contains no `captureFrame\(` call/);
    assert.match(r.out, /limb 4 \(one shutter\): the suite binds 0 `storeShutter\(` shutter\(s\)/);
  });

  test('🔴 limb 5 — the register captures on windows and the windows arm is the PLUGIN: FAILS', () => {
    const r = run(build((s) =>
      withCapture(s, (t) => {
        captureOn(t, ['windows']);
        t.files[SHUTTER_REL] = shutterLib({ windows: 'plugin' });
      }),
    ));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /store_frame_shutter\.dart — limb 5 \(desktop shutter\): the register captures on `windows` and the shutter file's code has no `TargetPlatform\.windows => StoreShutterKind\.layer,` arm/);
  });

  test('🔴 limb 5 — the register captures on a desktop and the shutter file is absent: FAILS', () => {
    const r = run(build((s) =>
      withCapture(s, (t) => {
        captureOn(t, ['linux']);
        delete t.files[SHUTTER_REL];
      }),
    ));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /store_frame_shutter\.dart does not exist, and the register captures on linux — limb 5 \(desktop shutter\)/);
  });

  test('🔴 limb 5 — a windows arm that exists only inside a comment maps nothing: FAILS', () => {
    const r = run(build((s) =>
      withCapture(s, (t) => {
        captureOn(t, ['windows']);
        t.files[SHUTTER_REL] = shutterLib({ windowsCommented: true });
      }),
    ));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /limb 5 \(desktop shutter\): the register captures on `windows`/);
  });

  test('limbs 4 and 5 — all three desktop devices with the right shutter file PASS, and the count is printed', () => {
    const r = run(build((s) =>
      withCapture(s, (t) => {
        captureOn(t, ['linux', 'windows', 'macos']);
      }),
    ));
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /THE SHUTTER — every capture suite binds ONE shutter and hands it to every frame; 3 desktop capture device\(s\) in the register \(linux, windows, macos\)/);
  });

  test('limb 5 — no desktop device in the register and no shutter file PASSES: a phone capture needs no layer', () => {
    const r = run(build((s) =>
      withCapture(s, (t) => {
        captureOn(t, ['iPhone 17 Pro Max']);
        delete t.files[SHUTTER_REL];
      }),
    ));
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /THE SHUTTER — .*; 0 desktop capture device\(s\) in the register, each mapped/);
  });

  // The fixture roots below carry no capture suite at all, which is why every
  // other test in this file is unaffected by this limb. On the REAL repository
  // that same silence is COVERAGE LOST — mutation G above — because subscriptiontracker's
  // suite is what the register names as `capturedBy`.
  test('a fixture with no capture suite is not treated as a failure', () => {
    const r = run(build());
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /THE ACCOUNT — 0 capture suite\(s\) read/);
  });
});

describe('assert-listing-assets.mjs — COVERAGE LOST, not a pass', () => {
  test('an empty assets map is COVERAGE LOST', () => {
    const r = run(build((s) => {
      s.register.storeMetadataContract.perChannel['android-play'].graphicAssets.assets = {};
    }));
    assert.equal(r.code, 2);
    assert.match(r.out, /COVERAGE LOST.*EMPTY `assets` map/s);
  });

  test('no channel declaring graphicAssets at all is COVERAGE LOST', () => {
    const r = run(build((s) => {
      delete s.register.storeMetadataContract.perChannel['android-play'].graphicAssets;
    }));
    assert.equal(r.code, 2);
    assert.match(r.out, /COVERAGE LOST.*declares a `graphicAssets` block/s);
  });

  test('zero store rows is COVERAGE LOST', () => {
    const r = run(build((s) => {
      s.register.channels = [];
    }));
    assert.equal(r.code, 2);
    assert.match(r.out, /COVERAGE LOST.*ZERO `kind: "store"` channels/s);
  });

  test('an absent register is COVERAGE LOST, never a clean run', () => {
    const root = build();
    rmSync(join(root, 'tooling', 'channel-register.json'));
    const r = run(root);
    assert.equal(r.code, 2);
    assert.match(r.out, /COVERAGE LOST/);
  });

  test('an unparseable register is COVERAGE LOST', () => {
    const root = build();
    writeFileSync(join(root, 'tooling', 'channel-register.json'), '{ not json');
    const r = run(root);
    assert.equal(r.code, 2);
    assert.match(r.out, /COVERAGE LOST.*not valid JSON/s);
  });

  test('no apps is COVERAGE LOST', () => {
    const root = build();
    writeFileSync(join(root, 'catalog', 'apps.json'), '[]');
    const r = run(root);
    assert.equal(r.code, 2);
    assert.match(r.out, /COVERAGE LOST.*carries no app entries/s);
  });
});

// ── store-screenshots lane 1: the rule kinds Play does not use ──────────────
// Apple states a short list of EXACT pixel sizes per device set, Microsoft a
// minimum width and height, Snap a byte ceiling and an aspect RANGE. None of
// them asks for a feature graphic or an icon in this block, so their
// `graphicAssets` carries `screenshots` and no `assets` key at all.
//
// 🔬 PREDICTIONS WRITTEN FIRST (2026-09-22), each case below names its own:
//   S1 a screenshots-only block with a compliant frame           -> exit 0
//   S2 iOS 1284x2777 against Apple's 6.9" list                   -> exit 1
//   S3 Mac 2560x1440 against Apple's Mac list                    -> exit 1
//   S4 Windows 1365x768 against minWidth 1366                    -> exit 1
//   S5 Snap frame of 2.1 MB against maxBytes 2 MB                -> exit 1
//   S6 Snap 1000x2100 outside aspectRange 1:2..2:1               -> exit 1
//   S7 an iOS frame WITH alpha                                   -> exit 1, not worded as Play
//   S8 `assets: {}` on a screenshots-only channel                -> exit 2 (COVERAGE LOST kept)
//   S9 a block with neither `assets` nor `screenshots`           -> exit 2
//   S10 Play's `assets` deleted while additionalFiles names PNGs -> exit 1, never a quiet pass
//   S11 an unreadable rule kind                                  -> exit 2
//   S12 Play's own messages are unchanged                        -> "Play requires at least 2"
// Fixture frames are GENERATED here; a 2 MB file is never committed.
const APPLE = 'https://developer.apple.com/help/app-store-connect/reference/screenshot-specifications (fetched 2026-09-20) — fixture';
const IPHONE_69 = ['1260x2736', '1290x2796', '1320x2868'];
const MAC = ['1280x800', '1440x900', '2560x1600', '2880x1800'];

/** Add a screenshots-only store channel and one live frame per `frames` entry. */
function shotsOnly(s, { id, name, rules, frames = [], extraFiles = {} }) {
  s.register.channels.push({ id, name, kind: 'store', served: false, ownerQueue: 'X-1', storeMetadataDir: `apps/{app}/store/${id}` });
  s.register.storeMetadataContract.perChannel[id] = {
    additionalFiles: [],
    graphicAssets: { screenshots: { dir: 'screenshots', provenanceFile: 'CAPTURE.json', alpha: false, minCount: 1, maxCount: 10, source: APPLE, ...rules } },
  };
  const base = `apps/subscriptiontracker/store/${id}/screenshots`;
  s.files[`${base}/README.md`] = Buffer.from('# slot\n');
  frames.forEach((buf, i) => {
    s.files[`${base}/0${i + 1}.png`] = buf;
  });
  if (frames.length) s.files[`${base}/CAPTURE.json`] = Buffer.from(JSON.stringify({ posture: 'live' }));
  Object.assign(s.files, extraFiles);
}

/** A real, opaque, decodable frame padded to `bytes` with a private ancillary
 *  chunk. The decoder skips unknown ancillary chunks, so the pixels still read. */
function paddedTo(buf, bytes) {
  const iend = buf.length - 12;
  const need = bytes - buf.length - 12;
  const data = Buffer.alloc(Math.max(0, need));
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from('zpAd', 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([buf.subarray(0, iend), len, body, crc, buf.subarray(iend)]);
}

describe('assert-listing-assets.mjs — non-Play rule kinds (store-screenshots lane 1)', () => {
  test('S1 a screenshots-only block with a compliant iPhone frame passes', () => {
    const r = run(build((s) => shotsOnly(s, { id: 'ios-appstore', name: 'Apple App Store (iOS)', rules: { acceptedSizes: IPHONE_69 }, frames: [shotAt(1290, 2796)] })));
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /2 channel\(s\) declaring graphic requirements/);
    assert.match(r.out, /2 fixed-size asset\(s\) measured, 1 screenshot\(s\) measured/);
  });

  test('S2 iOS 1284x2777 is not on Apple\'s 6.9" list', () => {
    const r = run(build((s) => shotsOnly(s, { id: 'ios-appstore', name: 'Apple App Store (iOS)', rules: { acceptedSizes: IPHONE_69 }, frames: [shotAt(1284, 2777)] })));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /01\.png is 1284x2777, which is not one of the 3 size\(s\) Apple App Store \(iOS\) accepts for this set \(1260x2736, 1290x2796, 1320x2868\)/);
    assert.doesNotMatch(r.out, /01\.png[^\n]*Play/);
  });

  test('S3 Mac 2560x1440 is 16:9 and Apple lists only 16:10 sizes', () => {
    const r = run(build((s) => shotsOnly(s, { id: 'macos-appstore', name: 'Apple App Store (macOS)', rules: { acceptedSizes: MAC }, frames: [shotAt(2560, 1440)] })));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /01\.png is 2560x1440, which is not one of the 4 size\(s\) Apple App Store \(macOS\) accepts/);
  });

  test('S4 Windows 1365x768 is one pixel under "1366 x 768 pixels or larger"', () => {
    const r = run(build((s) => shotsOnly(s, { id: 'windows-store', name: 'Microsoft Store', rules: { minWidth: 1366, minHeight: 768 }, frames: [shotAt(1365, 768)] })));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /01\.png is 1365x768; Microsoft Store requires a width of at least 1366px/);
    assert.doesNotMatch(r.out, /requires a height of at least/);
  });

  test('S4b Windows 1366x768 passes the same rule', () => {
    const r = run(build((s) => shotsOnly(s, { id: 'windows-store', name: 'Microsoft Store', rules: { minWidth: 1366, minHeight: 768 }, frames: [shotAt(1366, 768)] })));
    assert.equal(r.code, 0, r.out);
  });

  test('S5 a 2.1 MB Snap frame is over the 2 MB ceiling', () => {
    const big = paddedTo(shotAt(1280, 800), Math.round(2.1 * 1024 * 1024));
    const r = run(build((s) => shotsOnly(s, { id: 'linux-snap', name: 'Snap Store', rules: { maxBytes: 2 * 1024 * 1024, aspectRange: { min: '1:2', max: '2:1' } }, frames: [big] })));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /01\.png is 2202010 bytes and Snap Store accepts at most 2097152 per screenshot/);
  });

  test('S5b the same frame unpadded passes, so S5 is the byte rule and nothing else', () => {
    const r = run(build((s) => shotsOnly(s, { id: 'linux-snap', name: 'Snap Store', rules: { maxBytes: 2 * 1024 * 1024, aspectRange: { min: '1:2', max: '2:1' } }, frames: [shotAt(1280, 800)] })));
    assert.equal(r.code, 0, r.out);
  });

  test('S6 a Snap frame taller than 1:2 is outside the aspect range', () => {
    const r = run(build((s) => shotsOnly(s, { id: 'linux-snap', name: 'Snap Store', rules: { aspectRange: { min: '1:2', max: '2:1' } }, frames: [shotAt(500, 1100)] })));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /01\.png is 500x1100 — width:height 0\.455 — outside the 1:2 to 2:1 range Snap Store accepts/);
  });

  test('S7 an iOS frame with alpha fails, worded for Apple and not for Play', () => {
    const rgba = Buffer.alloc(1290 * 2796 * 4, 0xff);
    const withAlpha = encodeRgba({ width: 1290, height: 2796, rgba });
    const r = run(build((s) => shotsOnly(s, { id: 'ios-appstore', name: 'Apple App Store (iOS)', rules: { acceptedSizes: IPHONE_69 }, frames: [withAlpha] })));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /01\.png HAS an alpha channel \(PNG colour type 6\) and Apple App Store \(iOS\)'s rule for this set is no alpha/);
    assert.doesNotMatch(r.out, /ios-appstore[^\n]*24-bit PNG/);
  });

  test('S8 `assets: {}` on a screenshots-only channel is still COVERAGE LOST', () => {
    const r = run(build((s) => {
      shotsOnly(s, { id: 'ios-appstore', name: 'Apple App Store (iOS)', rules: { acceptedSizes: IPHONE_69 } });
      s.register.storeMetadataContract.perChannel['ios-appstore'].graphicAssets.assets = {};
    }));
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /COVERAGE LOST — channel "ios-appstore" declares a `graphicAssets` block with an EMPTY `assets` map/);
  });

  test('S9 a block with neither assets nor screenshots is COVERAGE LOST', () => {
    const r = run(build((s) => {
      shotsOnly(s, { id: 'ios-appstore', name: 'Apple App Store (iOS)', rules: {} });
      delete s.register.storeMetadataContract.perChannel['ios-appstore'].graphicAssets.screenshots;
    }));
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /COVERAGE LOST — channel "ios-appstore" declares a `graphicAssets` block with NEITHER an `assets` map NOR a `screenshots` set/);
  });

  test('S10 deleting Play\'s `assets` key while its listing still requires the PNGs FAILS', () => {
    const r = run(build((s) => {
      delete s.register.storeMetadataContract.perChannel['android-play'].graphicAssets.assets;
    }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /additionalFiles names feature-graphic\.png, and graphicAssets\.assets declares no size for it/);
    assert.match(r.out, /additionalFiles names store-icon-512\.png, and graphicAssets\.assets declares no size for it/);
  });

  // One declaration per case, never a loop: assert-no-loop-cases.mjs counts a
  // loop-wrapped `test(` as one case however many rows it runs.
  const unreadable = (rules, pattern) => {
    const r = run(build((s) => shotsOnly(s, { id: 'ios-appstore', name: 'Apple App Store (iOS)', rules, frames: [shotAt(1290, 2796)] })));
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /COVERAGE LOST/);
    assert.match(r.out, pattern);
  };

  test('S11 acceptedSizes not "WxH" is COVERAGE LOST, never a rule that grades nothing', () => {
    unreadable({ acceptedSizes: ['1290 x 2796'] }, /\.acceptedSizes is \["1290 x 2796"\], not a non-empty list of "WxH" strings/);
  });

  test('S11 an empty acceptedSizes is COVERAGE LOST, never a rule that grades nothing', () => {
    unreadable({ acceptedSizes: [] }, /\.acceptedSizes is \[\], not a non-empty list/);
  });

  test('S11 minWidth as a string is COVERAGE LOST, never a rule that grades nothing', () => {
    unreadable({ minWidth: '1366' }, /\.minWidth is "1366", not a positive integer/);
  });

  test('S11 maxBytes of zero is COVERAGE LOST, never a rule that grades nothing', () => {
    unreadable({ maxBytes: 0 }, /\.maxBytes is 0, not a positive integer/);
  });

  test('S11 an inverted aspectRange is COVERAGE LOST, never a rule that grades nothing', () => {
    unreadable({ aspectRange: { min: '2:1', max: '1:2' } }, /\.aspectRange is .*with min <= max/);
  });

  test('S12 Play\'s own wording is unchanged when a non-Play channel sits beside it', () => {
    const r = run(build((s) => {
      s.files['apps/subscriptiontracker/store/android-play/screenshots/01.png'] = shotAt(1080, 1920);
      s.files['apps/subscriptiontracker/store/android-play/screenshots/CAPTURE.json'] = Buffer.from(JSON.stringify({ posture: 'live' }));
      shotsOnly(s, { id: 'ios-appstore', name: 'Apple App Store (iOS)', rules: { acceptedSizes: IPHONE_69 }, frames: [shotAt(1290, 2796)] });
    }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /holds 1 screenshot\(s\) and Play requires at least 2\. Source: https:\/\/support\.google\.com/);
    assert.doesNotMatch(r.out, /ios-appstore[^\n]*Play/);
  });
});
