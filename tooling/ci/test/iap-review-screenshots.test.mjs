// ─────────────────────────────────────────────────────────────────────────────
// iap-review-screenshots.test.mjs — assert-iap-review-screenshots.mjs must be
// able to FAIL, must refuse when it reaches nothing, and must not be satisfiable
// by an empty gesture.
//
// [pipeline F-10] Every guard needs a recorded failing case and a self-check
// that its own scan still reaches what it claims to cover.
//
// THE ONE THING WORTH PROVING HERE, above every individual bound, is that the
// expected file list is DERIVED. Every other guard in this directory grades a
// set the register names; this one grades one file per auto-renewable product,
// and the products live in services/platform/src/app-config-data.json. D3 below
// adds a subscription term to a fixture and asserts the obligation appears with
// no rule edited anywhere — which is the whole reason this reader exists rather
// than another row under assert-listing-assets.mjs.
//
// 🔬 MUTATIONS RUN AGAINST THE REAL GUARD (2026-09-22, predictions written
//    first, all confirmed):
//   T1  the real tree, plain            -> exit 0, both products PRINTED
//                                          (ios-appstore is `served: false`)
//   T2  the real tree, --for-submission -> exit 1 on the same two facts.
//       This pair IS the gate: one fact, non-fatal on the shared lane and fatal
//       on the lane that would upload it.
//   D1  a fixture with both frames + CAPTURE.json      -> exit 0, nothing printed
//   D2  the same, one frame deleted, channel SERVED    -> exit 1 without the flag
//   D3  a THIRD subscription term added to the config  -> the new obligation
//       appears with no register edit. THE DERIVATION TEST.
//   D4  a `one_time` offering added                    -> NO obligation for it.
//       Apple asks for no review screenshot for a non-consumable, and inventing
//       one is the failure mode this contract exists to avoid.
//   S1  a frame at the wrong size                      -> exit 1 naming the size
//   S2  a frame carrying an alpha channel              -> exit 1 naming alpha
//   S3  a 0-byte `.png`                                -> exit 1. The check cannot
//       be bought with `touch`, which is the failure mode every placeholder in
//       this corpus has had.
//   S4  frames present, CAPTURE.json deleted           -> exit 1. A screenshot
//       with no provenance is evidence about nothing.
//   S5  a frame for a product nobody sells             -> exit 1, unaccounted
//   C1  the `iapReview` limb deleted                   -> COVERAGE LOST (2)
//   C2  the product file deleted                       -> COVERAGE LOST (2)
//   C3  every offering is `one_time`                   -> COVERAGE LOST (2), NOT
//       a clean pass. It may be true, and it is also exactly what a broken read
//       of the offerings list looks like.
//   C4  the rule's `source` deleted                    -> exit 1, refusing rather
//       than enforcing a number with no citation.
// ─────────────────────────────────────────────────────────────────────────────

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { deflateSync, crc32 } from 'node:zlib';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(CI_DIR, '..', '..');
const GUARD = join(CI_DIR, 'assert-iap-review-screenshots.mjs');

let TMP;
before(() => {
  TMP = mkdtempSync(join(tmpdir(), 'nikatru-iapshot-'));
});
after(() => {
  if (TMP) rmSync(TMP, { recursive: true, force: true });
});

// ── a real PNG, built here rather than checked in ───────────────────────────
// A fixture that reads a committed image proves nothing about the sizes it does
// not commit, and a 0-byte file with a .png name is the placeholder S3 exists to
// refuse. These are small on purpose: the fixture register declares its OWN
// accepted size, so nothing here has to allocate a 1320x2868 frame.
const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td) >>> 0, 0);
  return Buffer.concat([len, td, crc]);
};
const png = (w, h, { alpha = false } = {}) => {
  const bpp = alpha ? 4 : 3;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = alpha ? 6 : 2;
  const raw = Buffer.alloc(h * (1 + w * bpp));
  return Buffer.concat([
    SIG,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
};

// ── the fixture repository ──────────────────────────────────────────────────
const SIZE = [8, 16];
let seq = 0;

const tree = ({
  offerings = [
    { product_id: 'sub_monthly', term: 'month' },
    { product_id: 'sub_yearly', term: 'year' },
  ],
  served = false,
  rule = {},
  dropRule = false,
  dropProducts = false,
  frames = ['sub_monthly.png', 'sub_yearly.png'],
  provenance = true,
  frameSize = SIZE,
  alpha = false,
  emptyFrames = [],
} = {}) => {
  const dir = join(TMP, `case-${++seq}`);
  mkdirSync(join(dir, 'tooling'), { recursive: true });
  mkdirSync(join(dir, 'services', 'platform', 'src'), { recursive: true });
  const shots = join(dir, 'apps', 'fixture', 'store', 'ios-appstore', 'iap-review');
  mkdirSync(shots, { recursive: true });

  const iapReview = {
    dir: 'iap-review',
    provenanceFile: 'CAPTURE.json',
    format: 'png',
    alpha: false,
    acceptedSizes: [`${SIZE[0]}x${SIZE[1]}`],
    source: 'FIXTURE — a size this fixture captures, recorded 2026-09-22',
    ...rule,
  };
  const graphicAssets = dropRule ? {} : { iapReview };
  writeFileSync(
    join(dir, 'tooling', 'channel-register.json'),
    JSON.stringify(
      {
        channels: { 'ios-appstore': { id: 'ios-appstore', name: 'Apple App Store', served } },
        storeMetadataContract: { perChannel: { 'ios-appstore': { graphicAssets } } },
      },
      null,
      2,
    ),
  );
  if (!dropProducts) {
    writeFileSync(
      join(dir, 'services', 'platform', 'src', 'app-config-data.json'),
      JSON.stringify({ apps: { fixture: { paywall: { offerings } } } }, null, 2),
    );
  }
  for (const f of frames) writeFileSync(join(shots, f), png(frameSize[0], frameSize[1], { alpha }));
  for (const f of emptyFrames) writeFileSync(join(shots, f), Buffer.alloc(0));
  if (provenance) writeFileSync(join(shots, 'CAPTURE.json'), '{"build":"fixture"}');
  return dir;
};

const run = (dir, args = []) => {
  const r = spawnSync(process.execPath, [GUARD, ...args], { cwd: dir, encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
};

describe('assert-iap-review-screenshots', () => {
  // ── the real tree ─────────────────────────────────────────────────────────
  test('T1/T2: the real tree PRINTS the gap on the shared lane and FAILS on the submission lane', () => {
    const plain = run(REPO);
    assert.equal(plain.code, 0, plain.out);
    assert.match(plain.out, /pro_monthly\.png is missing/);
    assert.match(plain.out, /pro_yearly\.png is missing/);
    // and the one-time product is NOT named — Apple asks for no review
    // screenshot for a non-consumable, and its name may not reach store text.
    assert.doesNotMatch(plain.out, /pro_lifetime/);

    const submitting = run(REPO, ['--for-submission']);
    assert.equal(submitting.code, 1, submitting.out);
    assert.match(submitting.out, /FAIL .*pro_monthly\.png is missing/);
    assert.match(submitting.out, /FAIL .*pro_yearly\.png is missing/);
  });

  // ── the derivation, which is the whole design ─────────────────────────────
  test('D1: both frames present with provenance — clean, and nothing printed', () => {
    const r = run(tree());
    assert.equal(r.code, 0, r.out);
    assert.doesNotMatch(r.out, /missing/);
  });

  test('D2: a frame missing on a SERVED channel fails without the flag', () => {
    const r = run(tree({ served: true, frames: ['sub_monthly.png'] }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /FAIL .*sub_yearly\.png is missing/);
    assert.doesNotMatch(r.out, /FAIL .*sub_monthly\.png is missing/);
  });

  test('D3: a THIRD subscription term creates the obligation with no rule edited', () => {
    const dir = tree({
      served: true,
      offerings: [
        { product_id: 'sub_monthly', term: 'month' },
        { product_id: 'sub_yearly', term: 'year' },
        { product_id: 'sub_weekly', term: 'week' },
      ],
    });
    const r = run(dir);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /FAIL .*sub_weekly\.png is missing/);
    // the two that DO have frames are silent — the new row is the only finding
    assert.doesNotMatch(r.out, /sub_monthly\.png is missing/);
  });

  test('D4: a one_time offering creates NO obligation', () => {
    const dir = tree({
      served: true,
      offerings: [
        { product_id: 'sub_monthly', term: 'month' },
        { product_id: 'sub_yearly', term: 'year' },
        { product_id: 'sub_forever', term: 'one_time' },
      ],
    });
    const r = run(dir);
    assert.equal(r.code, 0, r.out);
    assert.doesNotMatch(r.out, /sub_forever/);
  });

  // ── the pixels ────────────────────────────────────────────────────────────
  test('S1: a frame at the wrong size fails, naming the size and the source', () => {
    const r = run(tree({ served: true, frameSize: [9, 16] }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /is 9x16 and the register accepts 8x16/);
    assert.match(r.out, /Source: FIXTURE/);
  });

  test('S2: a frame carrying an alpha channel fails', () => {
    const r = run(tree({ served: true, alpha: true }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /carries transparency/);
  });

  test('S3: a 0-byte .png cannot buy the check', () => {
    const r = run(tree({ served: true, frames: ['sub_monthly.png'], emptyFrames: ['sub_yearly.png'] }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /sub_yearly\.png is not a readable PNG/);
  });

  test('S4: frames with no CAPTURE.json fail — provenance is not decoration', () => {
    const r = run(tree({ served: true, provenance: false }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /CAPTURE\.json does not\./);
    assert.match(r.out, /evidence about nothing/);
  });

  test('S5: a frame for a product nobody sells is a finding', () => {
    const r = run(tree({ served: true, frames: ['sub_monthly.png', 'sub_yearly.png', 'sub_gone.png'] }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /sub_gone\.png is a review screenshot for a product that is not an auto-renewable/);
  });

  test('S5b: the directory missing entirely names every product it owes', () => {
    const dir = tree({ served: true });
    rmSync(join(dir, 'apps', 'fixture', 'store', 'ios-appstore', 'iap-review'), {
      recursive: true,
      force: true,
    });
    const r = run(dir);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /does not exist, and fixture declares 2 auto-renewable product\(s\)/);
    assert.match(r.out, /sub_monthly, sub_yearly/);
  });

  // ── coverage loss is exit 2, and is never a clean pass ─────────────────────
  test('C1: the iapReview limb deleted is COVERAGE LOST, not a clean run', () => {
    const r = run(tree({ dropRule: true }));
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /COVERAGE LOST/);
    assert.match(r.out, /graphicAssets\.iapReview is absent/);
  });

  test('C2: the product file deleted is COVERAGE LOST', () => {
    const r = run(tree({ dropProducts: true }));
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /COVERAGE LOST/);
    assert.match(r.out, /app-config-data\.json/);
  });

  test('C3: every offering one_time is COVERAGE LOST, not a pass over an empty domain', () => {
    const r = run(
      tree({ offerings: [{ product_id: 'sub_forever', term: 'one_time' }], frames: [] }),
    );
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /no app declares an auto-renewable offering/);
  });

  test('C4: a rule with no `source` is refused rather than enforced', () => {
    const dir = tree({ served: true });
    const reg = join(dir, 'tooling', 'channel-register.json');
    const parsed = JSON.parse(readFileSync(reg, 'utf8'));
    delete parsed.storeMetadataContract.perChannel['ios-appstore'].graphicAssets.iapReview.source;
    writeFileSync(reg, JSON.stringify(parsed, null, 2));
    const r = run(dir);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /declares dimensions with no `source`/);
  });

  // ── the self-check: this file must still be pointed at the real guard ──────
  test('the guard this file grades exists and is the one CI runs', () => {
    const ci = readFileSync(join(REPO, '.github', 'workflows', 'ci.yml'), 'utf8');
    assert.match(ci, /tooling\/ci\/assert-iap-review-screenshots\.mjs/);
  });
});
