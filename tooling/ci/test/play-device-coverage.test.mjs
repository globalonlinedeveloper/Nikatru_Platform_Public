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
// 🔬 2026-08-21 — THE SECOND DEVICE TYPE IS NOW DECLARED, so the M4/M5 pair
//    stopped being a model and became the shipping gate. `tablet` →
//    `screenshots-tablet` is in the register with its dimension rule and a
//    re-fetched source, and these mutations were added with predictions written
//    first:
//   M4b the tablet set carries a real PNG, PLAIN lane -> exit 0, nothing printed
//   M4c eight phone shots, no tablet                  -> STILL short. The
//       minimum counts TYPES; a bigger set of one type cannot buy a second.
//   M4d the mirror — tablet has pixels, phone is empty -> short, naming phone.
//       Without this the check could be satisfied by "some set is non-empty".
//   M8  the register's second row is asserted DIRECTLY (dir, dimension rule,
//       verbatim citation, fetch date). Every other test here proves the guard
//       can count two types; none of them proves the register declares two, and
//       the guard cannot — it counts whatever `sets` holds, so a row deleted
//       tomorrow reads to it as a listing that never had one.
//   +   `tree()` now creates a directory for EVERY declared set, because a
//       declared set with no directory is a hard failure and a fixture that
//       created only `screenshots` would have turned this whole file red for a
//       reason none of it is about.
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
//
// 🔴 EVERY DECLARED SET GETS A DIRECTORY, and that became load-bearing on
// 2026-08-21 when the register grew its second row. A declared set with NO
// directory is a hard failure at any served state — deliberately, it is a
// coverage claim over nothing — so a fixture that created only `screenshots`
// would have turned every test below red for a reason none of them is about.
// The directories are derived from the MUTATED register rather than listed
// here, so a test that adds a set gets its directory for free and the one test
// that needs a set with no directory says so by name.
function tree(
  mutate = () => {},
  { shots = ['01-home.png', '02-calendar.png'], extra = {}, omitSetDirs = [] } = {},
) {
  const dir = join(TMP, `r${seq++}`);
  const store = join(dir, 'apps', 'subly', 'store', 'android-play');
  mkdirSync(join(dir, 'tooling'), { recursive: true });
  mkdirSync(join(dir, 'catalog'), { recursive: true });
  mkdirSync(join(store, 'screenshots'), { recursive: true });

  const reg = JSON.parse(readFileSync(join(REPO, 'tooling', 'channel-register.json'), 'utf8'));
  mutate(reg, { dir, store });
  writeFileSync(join(dir, 'tooling', 'channel-register.json'), JSON.stringify(reg, null, 2));
  writeFileSync(join(dir, 'catalog', 'apps.json'), JSON.stringify([{ slug: 'subly' }], null, 2));

  // `?.` because several mutations below delete the coverage block outright, and
  // a fixture builder that throws turns a COVERAGE-LOST test into a crash.
  for (const [type, def] of Object.entries(cov(reg)?.sets ?? {})) {
    if (omitSetDirs.includes(type) || !def || typeof def.dir !== 'string') continue;
    mkdirSync(join(store, def.dir), { recursive: true });
  }

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
    // The tablet set is DECLARED and its directory exists and is empty, which is
    // a different fact from "not declared at all" and has to read differently in
    // the output — otherwise the day somebody captures into it there is no way to
    // tell from the shortfall whether the row was ever there.
    assert.match(out, /declared but empty: tablet/);
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
  //
  // 🔴 THESE NOW EXERCISE THE REAL SECOND ROW. Until 2026-08-21 they invented a
  // `tablet-10` set inside the mutation, because the register declared only
  // `phone` and there was nothing else to point at. The register now declares
  // `tablet` → `screenshots-tablet` with its dimension rule and a re-fetched
  // source, so the pair below is the actual submission gate rather than a model
  // of one: M4 is the tree that may be submitted, M5 is the tree that may not,
  // and the ONLY difference between them is whether that directory holds a real
  // PNG. A mutation that invents its own set can pass while the shipping
  // declaration is broken — which is the failure this file's own header is about.
  const TABLET = 'screenshots-tablet';
  // 1800x3200 is what the capture's tablet viewport produces (CSS 900x1600 at
  // DPR 2). The guard does not measure it; using the real geometry means a
  // reader of this fixture is not told a size the tree never makes.
  const tabletShot = () => png(1800, 3200);

  test('M4 the declared tablet set holding a real screenshot clears it', () => {
    const dir = tree(() => {}, { extra: { [`${TABLET}/01-home.png`]: tabletShot() } });
    const { code, out } = run(dir, ['--for-submission']);
    assert.equal(code, 0, out);
    assert.doesNotMatch(out, /SHORTFALL/);
    assert.match(out, /2 declared device-type set\(s\) measured/);
    assert.match(out, /--for-submission, so a shortfall would have been fatal/);
  });

  test('M4b the same tree also passes the PLAIN lane silently — no shortfall left to print', () => {
    const dir = tree(() => {}, { extra: { [`${TABLET}/01-home.png`]: tabletShot() } });
    const { code, out } = run(dir);
    assert.equal(code, 0, out);
    assert.doesNotMatch(out, /SHORTFALL/);
    assert.doesNotMatch(out, /declared but empty/);
  });

  test('M4c coverage is met by TYPES, not by files — eight phone shots and no tablet is still short', () => {
    const dir = tree(() => {}, {
      shots: ['01.png', '02.png', '03.png', '04.png', '05.png', '06.png', '07.png', '08.png'],
    });
    const { code, out } = run(dir, ['--for-submission']);
    assert.equal(code, 1, 'a bigger phone set must not buy a second device type');
    assert.match(out, /covers 1 device type\(s\) — phone \(8\)/);
  });

  test('M4d the mirror: a tablet set with pixels and an EMPTY phone set is one type too', () => {
    const dir = tree(() => {}, { shots: [], extra: { [`${TABLET}/01-home.png`]: tabletShot() } });
    const { code, out } = run(dir, ['--for-submission']);
    assert.equal(code, 1, 'the check must not be satisfiable by whichever set happens to be non-empty');
    assert.match(out, /covers 1 device type\(s\) — tablet \(1\)/);
    assert.match(out, /declared but empty: phone/);
  });

  test('M5 the tablet set holding a 0-byte .png does NOT count — the gate cannot be bought with touch', () => {
    const dir = tree(() => {}, { extra: { [`${TABLET}/01-home.png`]: Buffer.alloc(0) } });
    const { code, out } = run(dir, ['--for-submission']);
    assert.equal(code, 1, 'an empty file must not buy device-type coverage');
    assert.match(out, /covers 1 device type\(s\)/);
    assert.match(out, /declared but empty: tablet/);
  });

  test('a file that is not a PNG at all does not count either', () => {
    const dir = tree(() => {}, { extra: { [`${TABLET}/01-home.png`]: Buffer.from('this is not a png') } });
    const { code, out } = run(dir, ['--for-submission']);
    assert.equal(code, 1);
    assert.match(out, /declared but empty: tablet/);
  });

  test('a declared set with NO directory fails whatever the served state — it is a claim over nothing', () => {
    const dir = tree((reg) => { cov(reg).sets['tablet-10'] = { dir: 'screenshots-tablet-10' }; }, {
      omitSetDirs: ['tablet-10'],
    });
    const { code, out } = run(dir);
    assert.equal(code, 1, 'a declared device type with no directory is not a printable gap');
    assert.match(out, /screenshots-tablet-10 does not exist/);
    assert.match(out, /either capture the set or remove the row/);
  });

  test('the REAL tablet row with no directory fails too — the row and the directory are one increment', () => {
    // The same rule aimed at the shipping declaration rather than an invented
    // one. This is the state the tree is in between "the register declares a
    // tablet set" and "a tablet directory exists", and the guard is right to
    // refuse it: a device type the register promises and the repository cannot
    // show is worse than an honestly-declared gap, because it reads as coverage.
    const dir = tree(() => {}, { omitSetDirs: ['tablet'] });
    const { code, out } = run(dir);
    assert.equal(code, 1);
    assert.match(out, /screenshots-tablet does not exist/);
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
  test('the real register declares a sourced minimum of 2 and a phone set that agrees with screenshots.dir', () => {
    const reg = JSON.parse(readFileSync(join(REPO, 'tooling', 'channel-register.json'), 'utf8'));
    const c = cov(reg);
    assert.equal(c.minDistinctTypes, 2);
    assert.match(c.source, /^https:\/\/support\.google\.com\//);
    assert.match(c.source, /across different device types/);
    assert.equal(c.sets.phone.dir, reg.storeMetadataContract.perChannel['android-play'].graphicAssets.screenshots.dir);
  });

  // 🔬 M8 (2026-08-21) — THE ANTI-VACUITY TEST FOR THE SECOND ROW ITSELF.
  // Every test above proves the guard can count two device types. None of them
  // proves the shipping register declares a second one, and the guard cannot:
  // it counts whatever `sets` holds, so a row deleted tomorrow reads to it as a
  // listing that only ever had one type. The declaration is asserted here, with
  // its dimension rule, because the register's own `_why` makes that a
  // condition of the row existing at all: "a form-factor row arrives with its
  // dimension rule and a re-fetched source, or it does not arrive."
  test('M8 the real register declares a SECOND device type, sourced, with its dimension rule', () => {
    const reg = JSON.parse(readFileSync(join(REPO, 'tooling', 'channel-register.json'), 'utf8'));
    const sets = cov(reg).sets;
    const others = Object.keys(sets).filter((k) => k !== 'phone');
    assert.ok(others.length >= 1, 'a listing declaring only `phone` cannot satisfy minDistinctTypes 2');

    for (const type of others) {
      const s = sets[type];
      assert.notEqual(s.dir, sets.phone.dir, `set "${type}" must not share the phone directory — one directory is one device type`);
      assert.match(s.source ?? '', /^https:\/\/support\.google\.com\//, `set "${type}" carries a dimension rule with no primary source`);
      // The numbers must be the FETCHED ones, quoted in `source`, not remembered.
      // A row whose citation does not contain the sentence the numbers come from
      // is a limit this repository invented, which is the failure that rejected
      // its own fixture at 129 characters against a made-up "120 or fewer".
      assert.match(s.source, /Upload screenshots between 1,080 and 7,680px/, `set "${type}"'s source must quote the dimension sentence verbatim`);
      assert.match(s.source, /fetched 2026-08-21/, `set "${type}"'s source must record WHEN the page was read`);
      assert.equal(s.minSide, 1080);
      // 3840 is the stricter of the two maxima the page states, and the looser
      // one is kept beside it rather than dropped. Both are asserted so that
      // "we chose the strict reading" cannot quietly become "we forgot the other".
      assert.equal(s.maxSide, 3840);
      assert.equal(s.statedMaxSideForTablets, 7680);
      assert.equal(s.portraitAspect, '9:16');
    }
  });

  // ⚠️ 🔴 THIS TEST IS RED UNTIL ONE FILE LANDS, AND THAT IS DELIBERATE.
  // The register now declares `tablet` → `screenshots-tablet`, and the guard
  // fails a declared set with no directory at ANY served state (proved two
  // tests up, against both an invented row and the real one). The directory
  // does not exist in the working tree yet:
  //
  //     apps/subly/store/android-play/screenshots-tablet/.gitkeep
  //
  // Git cannot carry an empty directory, so that one placeholder is what turns
  // the real-tree verdict from "a declared set with no directory" (FAIL, both
  // lanes) back into "declared but empty" (PRINT on the shared lane, FATAL only
  // on submission) — which is the state M1/M2 describe and the state this test
  // asserts. The pixels arrive later, from `.github/workflows/store-screenshots
  // .yml`, as a pull request.
  //
  // The assertion is left pointing at the CORRECT end state rather than
  // rewritten to pin the intermediate one: a test that codifies a half-landed
  // increment goes green now and has to be edited back the moment the increment
  // completes, which is how a suite stops describing what the tree should do.
  test('M1/M2 hold against the REAL repository, not only the fixtures', () => {
    const plain = spawnSync(process.execPath, [GUARD], { cwd: REPO, encoding: 'utf8' });
    assert.equal(plain.status, 0, `${plain.stdout}${plain.stderr}`);
    assert.match(plain.stdout, /DEVICE-TYPE SHORTFALL/);

    const submitting = spawnSync(process.execPath, [GUARD, '--for-submission'], { cwd: REPO, encoding: 'utf8' });
    assert.equal(submitting.status, 1, 'the real listing must not be submittable while it covers one device type');
    assert.match(`${submitting.stdout}${submitting.stderr}`, /SUBMITTING and/);
  });
});
