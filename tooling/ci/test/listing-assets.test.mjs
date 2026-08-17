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
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, cpSync } from 'node:fs';
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
    'apps/subly/store/android-play/feature-graphic.png': png({ width: 1024, height: 500, colourType: 2 }),
    'apps/subly/store/android-play/store-icon-512.png': png({ width: 512, height: 512, colourType: 6 }),
    'apps/subly/store/android-play/screenshots/README.md': Buffer.from('# slot\n'),
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
    'apps/subly/lib/app.dart':
      Buffer.from('Widget build() => MaterialApp.router(\n  debugShowCheckedModeBanner: false,\n);\n'),
  };
  const state = { register, files };
  mutate(state);
  write(root, 'catalog/apps.json', Buffer.from(JSON.stringify([{ slug: 'subly' }])));
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

function run(root) {
  const r = spawnSync(process.execPath, [GUARD, root], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
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
});

describe('assert-listing-assets.mjs — the fixed-size assets', () => {
  test('a missing feature graphic fails', () => {
    const r = run(build((s) => delete s.files['apps/subly/store/android-play/feature-graphic.png']));
    assert.equal(r.code, 1);
    assert.match(r.out, /feature-graphic\.png is MISSING/);
  });

  test('wrong dimensions fail with the exact requirement', () => {
    const r = run(build((s) => {
      s.files['apps/subly/store/android-play/feature-graphic.png'] = png({ width: 1024, height: 512, colourType: 2 });
    }));
    assert.equal(r.code, 1);
    assert.match(r.out, /is 1024x512 and Play requires exactly 1024x500/);
  });

  test('a feature graphic WITH alpha fails — Play requires 24-bit no alpha', () => {
    const r = run(build((s) => {
      s.files['apps/subly/store/android-play/feature-graphic.png'] = png({ width: 1024, height: 500, colourType: 6 });
    }));
    assert.equal(r.code, 1);
    assert.match(r.out, /HAS an alpha channel.*24-bit PNG \(no alpha\)/s);
  });

  test('an icon WITHOUT alpha fails — Play requires 32-bit with alpha', () => {
    const r = run(build((s) => {
      s.files['apps/subly/store/android-play/store-icon-512.png'] = png({ width: 512, height: 512, colourType: 2 });
    }));
    assert.equal(r.code, 1);
    assert.match(r.out, /has NO alpha channel.*32-bit PNG \(with alpha\)/s);
  });

  test('a tRNS chunk counts as alpha even on a colour type without one', () => {
    // The shape Android's stock ic_launcher.png actually is: a palette/greyscale
    // image transparent through tRNS alone. A colour-type-only check passes it.
    const r = run(build((s) => {
      s.files['apps/subly/store/android-play/feature-graphic.png'] = png({ width: 1024, height: 500, colourType: 2, tRNS: true });
    }));
    assert.equal(r.code, 1);
    assert.match(r.out, /HAS an alpha channel/);
  });

  test('a truncated file fails — present is not the same as valid', () => {
    const r = run(build((s) => {
      s.files['apps/subly/store/android-play/feature-graphic.png'] = Buffer.from('not a png at all');
    }));
    assert.equal(r.code, 1);
    assert.match(r.out, /is not a readable PNG/);
  });

  test('an oversized icon fails against the sourced 1024KB ceiling', () => {
    const r = run(build((s) => {
      const base = png({ width: 512, height: 512, colourType: 6 });
      s.files['apps/subly/store/android-play/store-icon-512.png'] = Buffer.concat([base, Buffer.alloc(1048577)]);
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
  s.files['apps/subly/store/android-play/screenshots/01.png'] = shotAt(w, h);
  s.files['apps/subly/store/android-play/screenshots/02.png'] = shotAt(w, h, opts.banner === true);
  if (opts.posture !== null) {
    s.files['apps/subly/store/android-play/screenshots/CAPTURE.json'] = Buffer.from(
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
      s.files['apps/subly/store/android-play/screenshots/01.png'] = shotAt(1080, 1920);
      s.files['apps/subly/store/android-play/screenshots/CAPTURE.json'] = Buffer.from(JSON.stringify({ posture: 'live' }));
    }));
    assert.equal(r.code, 1);
    assert.match(r.out, /requires at least 2/);
  });

  test('nine screenshots exceed the per-device-type ceiling', () => {
    const r = run(build((s) => {
      for (let i = 1; i <= 9; i++) {
        s.files[`apps/subly/store/android-play/screenshots/0${i}.png`] = png({ width: 1080, height: 1920, colourType: 2 });
      }
      s.files['apps/subly/store/android-play/screenshots/CAPTURE.json'] = Buffer.from(JSON.stringify({ posture: 'live' }));
    }));
    assert.equal(r.code, 1);
    assert.match(r.out, /at most 8 per device type/);
  });

  test('a deleted screenshots directory fails — the slot is the contract', () => {
    const r = run(build((s) => delete s.files['apps/subly/store/android-play/screenshots/README.md']));
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
  // 🔴 REAL-TREE MUTATIONS FIRST, 2026-08-04, on apps/subly. The listing
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
  //   · `debugShowCheckedModeBanner: false` deleted from apps/subly/lib/app.dart
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
    assert.equal(r.code, 1);
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
      s.files['apps/subly/lib/app.dart'] = Buffer.from('Widget build() => MaterialApp.router();\n');
    }));
    assert.equal(r.code, 1);
    assert.match(r.out, /does not set `debugShowCheckedModeBanner: false`/);
  });

  // Comment-stripped, so prose mentioning the flag must NOT satisfy it. Prose
  // satisfying a structural check is the trap this repo has been caught by twice.
  test('the flag in a COMMENT does not satisfy it', () => {
    const r = run(build((s) => {
      s.files['apps/subly/lib/app.dart'] = Buffer.from(
        '// debugShowCheckedModeBanner: false, <- only in a comment\nWidget build() => MaterialApp.router();\n',
      );
    }));
    assert.equal(r.code, 1);
    assert.match(r.out, /does not set `debugShowCheckedModeBanner: false`/);
  });

  test('COVERAGE LOST when no app builds a MaterialApp at all', () => {
    const r = run(build((s) => {
      delete s.files['apps/subly/lib/app.dart'];
    }));
    assert.equal(r.code, 1);
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
  const LISTING = join(REPO, 'apps', 'subly', 'store', 'android-play', 'screenshots');

  /** Every variable the live path keys off, explicitly absent. */
  const scrubbed = () => {
    const env = { ...process.env };
    for (const k of ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'API_BASE_URL', 'E2E_EMAIL', 'E2E_PASSWORD']) delete env[k];
    return env;
  };

  const capture = (args, env = scrubbed()) => {
    const r = spawnSync(process.execPath, [CAPTURE, ...args], { encoding: 'utf8', env });
    return { code: r.status, out: `${r.stdout}${r.stderr}` };
  };

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
    for (const k of ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'API_BASE_URL', 'E2E_EMAIL', 'E2E_PASSWORD']) env[k] = 'x';
    const r = capture(['--app', 'no-such-app'], env);
    assert.equal(r.code, 1);
    assert.match(r.out, /carries no integration_test\/store_screenshots_test\.dart/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE CAPTURE ITSELF — WHOSE ACCOUNT ENDS UP ON THE LISTING.
//
// 🔴 REAL-TREE MUTATIONS FIRST, 2026-08-05, on apps/subly. Predictions written
// before each run; every one restored afterwards (`git status` clean).
//
//   A  the `05-settings` frame re-added to the real suite, WITH its import so
//      the file is valid Dart
//        ⇒ FAIL "the capture of \"05-settings\" photographs `SettingsScreen`,
//          and apps/subly/lib/features/settings/settings_screen.dart READS THE
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
// The fixtures below come after, and model the same shapes.
// ─────────────────────────────────────────────────────────────────────────────
describe('assert-listing-assets.mjs — the capture cannot photograph the account', () => {
  /** A capture suite in the shape the scan reads: one `find.byType` naming the
   *  screen, then one `captureFrame` for the frame it photographs. */
  const suite = (frames) =>
    Buffer.from(
      [
        "import 'store_capture_guard.dart';",
        '',
        'void main() {',
        "  testWidgets('captures the set', (WidgetTester tester) async {",
        ...frames.flatMap(([frame, screen]) => [
          `    expect(find.byType(${screen}), findsWidgets);`,
          '    await captureFrame(',
          '      take: binding.takeScreenshot,',
          `      frame: '${frame}',`,
          '      forbidden: forbidden,',
          '    );',
        ]),
        '  });',
        '}',
      ].join('\n'),
    );

  /** The refusal, reduced to the three things the scan requires of it. Its
   *  BEHAVIOUR is proven in apps/subly/test/store_capture_guard_test.dart, in a
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
    s.files['apps/subly/integration_test/store_capture_guard.dart'] = guardLib;
    s.files['apps/subly/integration_test/store_screenshots_test.dart'] = suite([
      ['01-home', 'HomeScreen'],
      ['02-settings', 'SettingsScreen'],
    ]);
    s.files['apps/subly/lib/features/home/home_screen.dart'] = cleanScreen('HomeScreen');
    s.files['apps/subly/lib/features/settings/settings_screen.dart'] = cleanScreen('SettingsScreen');
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
        t.files['apps/subly/lib/features/settings/settings_screen.dart'] = leakingScreen('SettingsScreen');
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
        t.files['apps/subly/lib/features/settings/settings_screen.dart'] = Buffer.from(
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
        t.files['apps/subly/integration_test/store_screenshots_test.dart'] = Buffer.from(
          [
            'void main() {',
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
        t.files['apps/subly/integration_test/store_screenshots_test.dart'] = Buffer.from(
          [
            'void main() {',
            '  expect(find.byType(HomeScreen), findsWidgets);',
            "  await captureFrame(frame: '01-home', forbidden: forbidden);",
            "  await captureFrame(frame: '02-mystery', forbidden: forbidden);",
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
        delete t.files['apps/subly/lib/features/settings/settings_screen.dart'];
      }),
    ));
    assert.equal(r.code, 1);
    assert.match(r.out, /no file under apps\/subly\/lib declares `class SettingsScreen`/);
  });

  test('a missing refusal library FAILS', () => {
    const r = run(build((s) =>
      withCapture(s, (t) => {
        delete t.files['apps/subly/integration_test/store_capture_guard.dart'];
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
        t.files['apps/subly/integration_test/store_capture_guard.dart'] = Buffer.from(
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
        t.files['apps/subly/integration_test/store_capture_guard.dart'] = Buffer.from(
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
        t.files['apps/subly/integration_test/store_screenshots_test.dart'] = Buffer.from(
          'void main() {\n  expect(find.byType(HomeScreen), findsWidgets);\n}\n',
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
        t.files['apps/subly/integration_test/store_screenshots_test.dart'] = Buffer.from(
          [
            'void main() {',
            '  expect(find.byType(HomeScreen), findsWidgets);',
            "  await captureFrame(frame: '01-home', forbidden: forbidden);",
            "  // await captureFrame(frame: '02-settings', forbidden: forbidden);",
            '}',
          ].join('\n'),
        );
      }),
    ));
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /1 frame\(s\) resolved/);
  });

  // The fixture roots below carry no capture suite at all, which is why every
  // other test in this file is unaffected by this limb. On the REAL repository
  // that same silence is COVERAGE LOST — mutation G above — because subly's
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
    assert.equal(r.code, 1);
    assert.match(r.out, /COVERAGE LOST.*EMPTY `assets` map/s);
  });

  test('no channel declaring graphicAssets at all is COVERAGE LOST', () => {
    const r = run(build((s) => {
      delete s.register.storeMetadataContract.perChannel['android-play'].graphicAssets;
    }));
    assert.equal(r.code, 1);
    assert.match(r.out, /COVERAGE LOST.*declares a `graphicAssets` block/s);
  });

  test('zero store rows is COVERAGE LOST', () => {
    const r = run(build((s) => {
      s.register.channels = [];
    }));
    assert.equal(r.code, 1);
    assert.match(r.out, /COVERAGE LOST.*ZERO `kind: "store"` channels/s);
  });

  test('an absent register is COVERAGE LOST, never a clean run', () => {
    const root = build();
    rmSync(join(root, 'tooling', 'channel-register.json'));
    const r = run(root);
    assert.equal(r.code, 1);
    assert.match(r.out, /COVERAGE LOST/);
  });

  test('an unparseable register is COVERAGE LOST', () => {
    const root = build();
    writeFileSync(join(root, 'tooling', 'channel-register.json'), '{ not json');
    const r = run(root);
    assert.equal(r.code, 1);
    assert.match(r.out, /COVERAGE LOST.*not valid JSON/s);
  });

  test('no apps is COVERAGE LOST', () => {
    const root = build();
    writeFileSync(join(root, 'catalog', 'apps.json'), '[]');
    const r = run(root);
    assert.equal(r.code, 1);
    assert.match(r.out, /COVERAGE LOST.*carries no app entries/s);
  });
});
