// ─────────────────────────────────────────────────────────────────────────────
// play-device-coverage.test.mjs — assert-play-device-coverage.mjs must be able
// to FAIL, must refuse when it reaches nothing, and must NOT be satisfiable by
// an empty gesture.
//
// [pipeline D-5] The declaration is `…graphicAssets.screenshots
// .deviceTypeCoverage` in tooling/channel-register.json.
//
// 🔬 MUTATIONS RUN AGAINST THE REAL GUARD (2026-08-20, predictions written
//    first, all confirmed):
//   M1 the real tree, plain                     -> exit 0, shortfall PRINTED
//      (android-play is `served: false`; 4 phone shots, 1 of 2 types)
//   M2 the real tree, --for-submission          -> exit 1 on the same shortfall.
//      This pair IS the gate: the same fact, non-fatal on the shared lane and
//      fatal on the lane that would upload it.
//   M3 `served: true` on the channel, plain     -> exit 1 without the flag
//   M4 a second set declared, directory holds a real PNG -> exit 0, no print
//   M5 a second set declared, directory holds a 0-byte `.png` -> STILL short.
//      The check cannot be bought with `touch`, which is the failure mode every
//      placeholder in this corpus has had.
//   M6 `sets.phone.dir` changed to a directory `screenshots.dir` does not name
//                                               -> caught, naming the drift
//   M7 the `source` deleted                     -> COVERAGE LOST, not enforcement
//                                                  of the bare number
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
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
const GUARD = join(CI_DIR, 'assert-play-device-coverage.mjs');

let TMP;
let seq = 0;
before(() => { TMP = mkdtempSync(join(tmpdir(), 'nikatru-devcov-')); });
after(() => { rmSync(TMP, { recursive: true, force: true }); });

// ── a real PNG, built chunk by chunk ────────────────────────────────────────
// The same shape listing-assets.test.mjs uses. It must be a genuine PNG because
// the guard rejects anything whose IHDR does not read, which is the whole point
// of M5.
function chunk(type, body) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(body.length, 0);
  const typed = Buffer.concat([Buffer.from(type, 'ascii'), body]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed) >>> 0, 0);
  return Buffer.concat([len, typed, crc]);
}

function png(width, height) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // colour type 2 — 24-bit, no alpha, which is what Play wants
  const row = Buffer.alloc(1 + width * 3);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── a fixture tree carrying the REAL register, optionally mutated ───────────
// The real register is used rather than a hand-written one so that a change to
// the declaration's shape breaks these tests rather than passing them: a fixture
// that models the register is a second register, and the first to drift.
function tree(mutate = () => {}, { shots = ['01-home.png', '02-calendar.png'], extra = {} } = {}) {
  const dir = join(TMP, `r${seq++}`);
  const store = join(dir, 'apps', 'subly', 'store', 'android-play');
  mkdirSync(join(dir, 'tooling'), { recursive: true });
  mkdirSync(join(dir, 'catalog'), { recursive: true });
  mkdirSync(join(store, 'screenshots'), { recursive: true });

  const reg = JSON.parse(readFileSync(join(REPO, 'tooling', 'channel-register.json'), 'utf8'));
  mutate(reg, { dir, store });
  writeFileSync(join(dir, 'tooling', 'channel-register.json'), JSON.stringify(reg, null, 2));
  writeFileSync(join(dir, 'catalog', 'apps.json'), JSON.stringify([{ slug: 'subly' }], null, 2));

  for (const name of shots) writeFileSync(join(store, 'screenshots', name), png(1080, 1920));
  for (const [rel, bytes] of Object.entries(extra)) {
    mkdirSync(join(store, dirname(rel)), { recursive: true });
    writeFileSync(join(store, rel), bytes);
  }
  return dir;
}

const cov = (reg) => reg.storeMetadataContract.perChannel['android-play'].graphicAssets.screenshots.deviceTypeCoverage;
const playRow = (reg) => reg.channels.find((c) => c.id === 'android-play');

const run = (dir, args = []) => {
  const r = spawnSync(process.execPath, [GUARD, ...args, dir], { cwd: dir, encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
};

describe('assert-play-device-coverage', () => {
  // ── M1/M2 — the pair that IS the gate ─────────────────────────────────────
  test('M1 a phone-only set on an unserved channel PRINTS the shortfall and exits 0', () => {
    const { code, out } = run(tree());
    assert.equal(code, 0, out);
    assert.match(out, /DEVICE-TYPE SHORTFALL/);
    assert.match(out, /covers 1 device type\(s\) — phone \(2\)/);
    assert.match(out, /at least 2 ACROSS DIFFERENT DEVICE TYPES/);
    assert.match(out, /FATAL on the submission lane/);
  });

  test('M2 the SAME tree with --for-submission FAILS', () => {
    const { code, out } = run(tree(), ['--for-submission']);
    assert.equal(code, 1, 'the submission lane must refuse what the shared lane only prints');
    assert.match(out, /SUBMITTING and app "subly"/);
    assert.match(out, /assert-play-device-coverage: FAILED/);
  });

  test('the shortfall carries its primary source, so it can be re-checked from the output alone', () => {
    const { out } = run(tree());
    assert.match(out, /support\.google\.com\/googleplay\/android-developer\/answer\/9866151/);
    assert.match(out, /minimum of two screenshots across different device types/);
  });

  test('M3 a SERVED channel fails without the flag', () => {
    const dir = tree((reg) => { playRow(reg).served = true; });
    const { code, out } = run(dir);
    assert.equal(code, 1);
    assert.match(out, /channel "android-play" is SERVED and/);
  });

  // ── M4/M5 — what closes the gap, and what only looks like it does ─────────
  test('M4 a second declared set holding a real screenshot clears it', () => {
    const dir = tree(
      (reg) => { cov(reg).sets['tablet-10'] = { dir: 'screenshots-tablet-10' }; },
      { extra: { 'screenshots-tablet-10/01-home.png': png(1200, 1920) } },
    );
    const { code, out } = run(dir, ['--for-submission']);
    assert.equal(code, 0, out);
    assert.doesNotMatch(out, /SHORTFALL/);
    assert.match(out, /2 declared device-type set\(s\) measured/);
    assert.match(out, /--for-submission, so a shortfall would have been fatal/);
  });

  test('M5 a second set holding a 0-byte .png does NOT count — the gate cannot be bought with touch', () => {
    const dir = tree(
      (reg) => { cov(reg).sets['tablet-10'] = { dir: 'screenshots-tablet-10' }; },
      { extra: { 'screenshots-tablet-10/01-home.png': Buffer.alloc(0) } },
    );
    const { code, out } = run(dir, ['--for-submission']);
    assert.equal(code, 1, 'an empty file must not buy device-type coverage');
    assert.match(out, /covers 1 device type\(s\)/);
    assert.match(out, /declared but empty: tablet-10/);
  });

  test('a file that is not a PNG at all does not count either', () => {
    const dir = tree(
      (reg) => { cov(reg).sets['tablet-10'] = { dir: 'screenshots-tablet-10' }; },
      { extra: { 'screenshots-tablet-10/01-home.png': Buffer.from('this is not a png') } },
    );
    const { code, out } = run(dir, ['--for-submission']);
    assert.equal(code, 1);
    assert.match(out, /declared but empty: tablet-10/);
  });

  test('a declared set with NO directory fails whatever the served state — it is a claim over nothing', () => {
    const dir = tree((reg) => { cov(reg).sets['tablet-10'] = { dir: 'screenshots-tablet-10' }; });
    const { code, out } = run(dir);
    assert.equal(code, 1, 'a declared device type with no directory is not a printable gap');
    assert.match(out, /screenshots-tablet-10 does not exist/);
    assert.match(out, /either capture the set or remove the row/);
  });

  // ── M6 — the two declarations of where the phone set lives ────────────────
  test('M6 catches `sets.<type>.dir` drifting away from `screenshots.dir`', () => {
    const dir = tree((reg) => { cov(reg).sets.phone.dir = 'screenshots-phone'; });
    const { code, out } = run(dir);
    assert.equal(code, 1);
    assert.match(out, /0 declared set\(s\) name it/);
    assert.match(out, /grading different directories while both report ok/);
  });

  test('two sets both naming `screenshots.dir` is caught as well — the check is on exactly one', () => {
    const dir = tree(
      (reg) => { cov(reg).sets['tablet-10'] = { dir: 'screenshots' }; },
    );
    const { code, out } = run(dir);
    assert.equal(code, 1);
    assert.match(out, /2 declared set\(s\) name it/);
  });

  // ── anti-vacuity ──────────────────────────────────────────────────────────
  test('M7 COVERAGE LOST when the minimum arrives with no citation', () => {
    const dir = tree((reg) => { delete cov(reg).source; });
    const { code, out } = run(dir);
    assert.equal(code, 1, 'an uncited limit must not be enforced');
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /with no `source`/);
  });

  test('COVERAGE LOST when no channel declares a deviceTypeCoverage block', () => {
    const dir = tree((reg) => { delete reg.storeMetadataContract.perChannel['android-play'].graphicAssets.screenshots.deviceTypeCoverage; });
    const { code, out } = run(dir);
    assert.equal(code, 1, 'zero declarations must not read as "every listing is covered"');
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /declares a `screenshots\.deviceTypeCoverage` block/);
  });

  test('COVERAGE LOST when the set map is emptied', () => {
    const dir = tree((reg) => { cov(reg).sets = {}; });
    const { code, out } = run(dir);
    assert.equal(code, 1);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /\.sets is empty or is not an object/);
  });

  test('COVERAGE LOST when minDistinctTypes is not a positive integer', () => {
    const dir = tree((reg) => { cov(reg).minDistinctTypes = 'two'; });
    const { code, out } = run(dir);
    assert.equal(code, 1);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /not a positive integer/);
  });

  test('COVERAGE LOST when the register is absent', () => {
    const dir = join(TMP, `r${seq++}`);
    mkdirSync(dir, { recursive: true });
    const { code, out } = run(dir);
    assert.equal(code, 1);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /channel-register\.json does not exist/);
  });

  test('COVERAGE LOST when no app has a metadata tree, so zero listings were read', () => {
    const dir = tree();
    rmSync(join(dir, 'apps'), { recursive: true, force: true });
    const { code, out } = run(dir);
    assert.equal(code, 1, 'zero trees must not read as "all trees are fine"');
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /ZERO metadata trees to read/);
  });

  // ── the real tree ─────────────────────────────────────────────────────────
  test('the real register declares a sourced minimum of 2 and one phone set', () => {
    const reg = JSON.parse(readFileSync(join(REPO, 'tooling', 'channel-register.json'), 'utf8'));
    const c = cov(reg);
    assert.equal(c.minDistinctTypes, 2);
    assert.match(c.source, /^https:\/\/support\.google\.com\//);
    assert.match(c.source, /across different device types/);
    assert.equal(c.sets.phone.dir, reg.storeMetadataContract.perChannel['android-play'].graphicAssets.screenshots.dir);
  });

  test('M1/M2 hold against the REAL repository, not only the fixtures', () => {
    const plain = spawnSync(process.execPath, [GUARD], { cwd: REPO, encoding: 'utf8' });
    assert.equal(plain.status, 0, `${plain.stdout}${plain.stderr}`);
    assert.match(plain.stdout, /DEVICE-TYPE SHORTFALL/);

    const submitting = spawnSync(process.execPath, [GUARD, '--for-submission'], { cwd: REPO, encoding: 'utf8' });
    assert.equal(submitting.status, 1, 'the real listing must not be submittable while it covers one device type');
    assert.match(`${submitting.stdout}${submitting.stderr}`, /SUBMITTING and/);
  });
});
