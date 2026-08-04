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
  };
  const state = { register, files };
  mutate(state);
  write(root, 'sites/_shared/_data/apps.json', Buffer.from(JSON.stringify([{ slug: 'subly' }])));
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

describe('assert-listing-assets.mjs — screenshots and their provenance', () => {
  const twoShots = (s, opts = {}) => {
    const w = opts.width ?? 1080;
    const h = opts.height ?? 1920;
    s.files['apps/subly/store/android-play/screenshots/01.png'] = png({ width: w, height: h, colourType: 2 });
    s.files['apps/subly/store/android-play/screenshots/02.png'] = png({ width: w, height: h, colourType: 2 });
    if (opts.posture !== null) {
      s.files['apps/subly/store/android-play/screenshots/CAPTURE.json'] = Buffer.from(JSON.stringify({ posture: opts.posture ?? 'live' }));
    }
  };

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
      s.files['apps/subly/store/android-play/screenshots/01.png'] = png({ width: 1080, height: 1920, colourType: 2 });
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
    writeFileSync(join(root, 'sites', '_shared', '_data', 'apps.json'), '[]');
    const r = run(root);
    assert.equal(r.code, 1);
    assert.match(r.out, /COVERAGE LOST.*carries no app entries/s);
  });
});
