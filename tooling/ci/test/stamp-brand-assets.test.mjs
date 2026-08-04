// ─────────────────────────────────────────────────────────────────────────────
// stamp-brand-assets.test.mjs — assert-stamp-brand-assets.mjs must be able to FAIL.
//
// [pipeline S-14] A stamp carries the app's brand assets, never Flutter's.
//
// ⚠️ REAL-STAMP MUTATIONS FIRST (2026-07-29, six, against a freshly stamped
// `apps/probe` and the real Flutter 3.44.7 SDK, predictions written first):
//   M1 SDK stock Icon-192 copied over the generated one -> caught, byte-identical
//   M2 Icon-maskable-512.png deleted                    -> caught, MISSING
//   M3 an icon truncated to 10 bytes                    -> caught, not a valid PNG
//   M4 asserted against the wrong seed                  -> caught on all 5 assets
//   M5 the Flutter SDK hidden from PATH + FLUTTER_ROOT  -> COVERAGE LOST, exit 1
//   M6 the platform claim emptied in apps.json          -> COVERAGE LOST
//
// 🔬 M5 IS THE ONE THAT MATTERED AND IT FAILED ITS FIRST ATTEMPT — stripping
// PATH to hide Flutter also hid `node`, so the command produced NO output and
// "no failure message" briefly looked like a pass. A mutation that runs nothing
// proves nothing. Re-run with node's directory kept on PATH, it exits 1.
//
// These fixtures use a synthetic SDK layout (FLUTTER_ROOT is injected) so the
// stock-comparison path runs without a Flutter install.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GUARD = join(CI_DIR, 'assert-stamp-brand-assets.mjs');

let TMP;
before(() => { TMP = mkdtempSync(join(tmpdir(), 'nikatru-brand-')); });
after(() => { rmSync(TMP, { recursive: true, force: true }); });

let seq = 0;

// ── a minimal real PNG, so "valid PNG" is exercised rather than assumed ──────
function u32(v) { return Buffer.from([(v >> 24) & 255, (v >> 16) & 255, (v >> 8) & 255, v & 255]); }
function crc32(buf) {
  let c;
  const table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  return Buffer.concat([u32(data.length), body, u32(crc32(body))]);
}
/** Solid-colour 8-bit truecolour PNG, filter 0 — the shape the brick generates. */
function png(size, rgbHex) {
  const r = parseInt(rgbHex.slice(0, 2), 16);
  const g = parseInt(rgbHex.slice(2, 4), 16);
  const b = parseInt(rgbHex.slice(4, 6), 16);
  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 3);
    for (let x = 0; x < size; x++) { row[1 + x * 3] = r; row[2 + x * 3] = g; row[3 + x * 3] = b; }
    rows.push(row);
  }
  const ihdr = Buffer.concat([u32(size), u32(size), Buffer.from([8, 2, 0, 0, 0])]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const ASSETS = [
  ['web/favicon.png', 'favicon.png'],
  ['web/icons/Icon-192.png', 'Icon-192.png'],
  ['web/icons/Icon-512.png', 'Icon-512.png'],
  ['web/icons/Icon-maskable-192.png', 'Icon-maskable-192.png'],
  ['web/icons/Icon-maskable-512.png', 'Icon-maskable-512.png'],
];

const STOCK_COLOUR = '0175c2'; // Flutter's default blue, standing in for stock

function world({ appColour = '6459f5', omit = [], corrupt = [], useStock = [], platforms = ['web'], overlay = true } = {}) {
  const root = join(TMP, `r${seq++}`);
  const appDir = join(root, 'apps', 'probe');

  // ── a synthetic SDK: the REAL layout, including the part this fixture used to
  // get wrong ───────────────────────────────────────────────────────────────
  // 🔴 `.img.tmpl` FILES ARE ZERO BYTES IN A REAL FLUTTER INSTALL. This fixture
  // wrote real PNG bytes into them, which is why all six of its tests passed
  // while the guard's two maskable comparisons were against empty buffers and
  // could never have matched (measured on Flutter 3.44.7, 2026-08-04). The real
  // bytes live in the `flutter_template_images` package, which flutter_tools
  // resolves through its own package_config.json and overlays at `create` time.
  //
  // A fixture written by whoever wrote the guard encodes the same
  // misunderstanding as the guard — this repo's own rule, and this is it. The
  // fixture now models the SPLIT, so the maskable identity test below is a real
  // test rather than a restatement of the bug.
  const sdkRoot = join(root, 'sdk');
  const sdkWeb = join(sdkRoot, 'packages', 'flutter_tools', 'templates', 'app', 'web');
  mkdirSync(join(sdkWeb, 'icons'), { recursive: true });
  writeFileSync(join(sdkWeb, 'favicon.png.copy.tmpl'), png(8, STOCK_COLOUR));
  for (const n of ['Icon-192', 'Icon-512']) {
    writeFileSync(join(sdkWeb, 'icons', `${n}.png.copy.tmpl`), png(8, STOCK_COLOUR));
  }
  for (const n of ['Icon-maskable-192', 'Icon-maskable-512']) {
    writeFileSync(join(sdkWeb, 'icons', `${n}.png.img.tmpl`), Buffer.alloc(0));
  }

  const imagesRoot = join(root, 'template-images');
  if (overlay) {
    const od = join(imagesRoot, 'templates', 'app', 'web', 'icons');
    mkdirSync(od, { recursive: true });
    for (const n of ['Icon-maskable-192', 'Icon-maskable-512']) {
      writeFileSync(join(od, `${n}.png`), png(8, STOCK_COLOUR));
    }
  }
  const dartTool = join(sdkRoot, 'packages', 'flutter_tools', '.dart_tool');
  mkdirSync(dartTool, { recursive: true });
  writeFileSync(
    join(dartTool, 'package_config.json'),
    JSON.stringify({
      configVersion: 2,
      packages: overlay
        ? [{ name: 'flutter_template_images', rootUri: `file:///${imagesRoot.replace(/\\/g, '/')}`, packageUri: 'lib/' }]
        : [],
    }),
  );

  mkdirSync(join(appDir, 'web', 'icons'), { recursive: true });
  for (const [rel] of ASSETS) {
    if (omit.includes(rel)) continue;
    const p = join(appDir, rel);
    if (corrupt.includes(rel)) { writeFileSync(p, Buffer.from('not a png')); continue; }
    writeFileSync(p, useStock.includes(rel) ? png(8, STOCK_COLOUR) : png(8, appColour));
  }

  mkdirSync(join(root, 'sites', '_shared', '_data'), { recursive: true });
  writeFileSync(
    join(root, 'sites', '_shared', '_data', 'apps.json'),
    JSON.stringify([{ slug: 'probe', url: 'https://probe.nikatru.com', platforms, status: 'preview' }]),
  );
  return { root, appDir, sdkRoot: join(root, 'sdk') };
}

const run = ({ appDir, sdkRoot }, seed = '6459F5', env = {}) => {
  const r = spawnSync(process.execPath, [GUARD, appDir, '--seed', seed], {
    encoding: 'utf8',
    env: { ...process.env, FLUTTER_ROOT: sdkRoot, ...env },
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
};

describe('assert-stamp-brand-assets', () => {
  test('passes when every asset is present, valid, non-stock and on-seed', () => {
    const { code, out } = run(world());
    assert.equal(code, 0, out);
    assert.match(out, /5\/5 asset\(s\) present/);
    assert.match(out, /5 carry seed #6459f5/);
  });

  // 🔴 M1 — the defect S-14 exists for.
  test('FAILS when an asset is byte-identical to the SDK stock asset', () => {
    const { code, out } = run(world({ useStock: ['web/icons/Icon-192.png'] }));
    assert.equal(code, 1);
    assert.match(out, /Icon-192\.png — is BYTE-IDENTICAL to Flutter's stock asset/);
  });

  // 🔴 THE CASE THAT SILENTLY PASSED FOR THE WHOLE LIFE OF THIS GUARD, until
  // 2026-08-04. `Icon-maskable-*` comes from an `.img.tmpl`, which is EMPTY in
  // the SDK — so the comparison was against a zero-byte buffer and could not
  // match whatever the stamp shipped. Confirmed by counterfactual on the REAL
  // tree, not here: the stock maskable-512 copied over apps/subly's left the
  // guard AT HEAD printing `ok … 5 stock asset(s) compared`, exit 0.
  test('FAILS when a MASKABLE asset is byte-identical to stock (needs the overlay)', () => {
    const { code, out } = run(world({ useStock: ['web/icons/Icon-maskable-512.png'] }));
    assert.equal(code, 1, 'the maskable pair is exactly the one the SDK ships as an empty placeholder');
    assert.match(out, /Icon-maskable-512\.png — is BYTE-IDENTICAL to Flutter's stock asset/);
  });

  // The other half of the same rule: with no overlay every maskable stock asset
  // is zero bytes, and comparing against one is an assertion that cannot fail.
  // It must be COVERAGE LOST, never a quiet pass over a smaller set.
  test('COVERAGE LOST when stock assets resolve to zero bytes (no overlay)', () => {
    const { code, out } = run(world({ overlay: false }));
    assert.equal(code, 1);
    assert.match(out, /ZERO BYTES/);
    assert.match(out, /flutter_template_images/);
  });

  test('FAILS when a required asset is missing', () => {
    const { code, out } = run(world({ omit: ['web/icons/Icon-maskable-512.png'] }));
    assert.equal(code, 1);
    assert.match(out, /Icon-maskable-512\.png — MISSING/);
  });

  // Present is not the same as valid — a 0-byte file is "there".
  test('FAILS when an asset is not a readable PNG', () => {
    const { code, out } = run(world({ corrupt: ['web/favicon.png'] }));
    assert.equal(code, 1);
    assert.match(out, /favicon\.png — is not a readable PNG/);
  });

  // 🔴 "Not Flutter's" is not the same as "the app's" — a blank square passes
  // the identity check alone, which is why the colour limb exists.
  test('FAILS when the icons are non-stock but not the spec\'s seed colour', () => {
    const { code, out } = run(world({ appColour: '00ff00' }));
    assert.equal(code, 1, 'green icons are not Flutter\'s, and are not the app\'s either');
    assert.match(out, /dominant colour is #00ff00, but the spec's seed is #6459f5/);
  });

  // ── anti-vacuity: refusing to run blind ───────────────────────────────────
  // 🔴 M5. The tempting implementation skips the comparison when the SDK is
  // absent and prints ok, which turns "I could not check" into "nothing wrong".
  test('COVERAGE LOST when the Flutter SDK cannot be found', () => {
    const w = world();
    const { code, out } = run(w, '6459F5', { FLUTTER_ROOT: join(w.root, 'no-such-sdk'), PATH: '' });
    assert.equal(code, 1);
    assert.match(out, /COVERAGE LOST — could not establish the Flutter SDK's stock web assets/);
  });

  test('COVERAGE LOST when the SDK dirs exist but hold no stock PNGs', () => {
    const w = world();
    const emptySdk = join(w.root, 'emptysdk');
    mkdirSync(join(emptySdk, 'packages', 'flutter_tools', 'templates', 'app', 'web', 'icons'), { recursive: true });
    const { code, out } = run(w, '6459F5', { FLUTTER_ROOT: emptySdk, PATH: '' });
    assert.equal(code, 1);
    assert.match(out, /no stock PNGs inside them/);
  });

  // 🔴 M6 — the asset set is derived from the platform claim, so an empty claim
  // would require nothing. [3]S-3 owns the claim; this refuses to ride an empty one.
  test('COVERAGE LOST when the app claims no platform', () => {
    const { code, out } = run(world({ platforms: [] }));
    assert.equal(code, 1);
    assert.match(out, /COVERAGE LOST — no platform claim/);
  });

  test('FAILS loudly if a claim arrives that this guard has no asset list for', () => {
    const { code, out } = run(world({ platforms: ['windows'] }));
    assert.equal(code, 1, 'a native claim must not pass on the web asset list');
    assert.match(out, /claims \[windows\] and NOT web/);
  });
});
