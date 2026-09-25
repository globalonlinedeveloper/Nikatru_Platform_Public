// ─────────────────────────────────────────────────────────────────────────────
// xcode-floor.test.mjs — assert-xcode-floor.mjs must be able to FAIL.
//
// Pipeline requirement: Private/requirements/ → C-6.
//
// 🔴 THE DEFECT THIS GUARD REMOVES IS A DECLARATION MISTAKEN FOR AN ENFORCEMENT.
// tooling/versions.json has declared `xcode: "26"` since the key landed, and
// nothing compared it to anything. Adding the key made things WORSE than
// nothing: submit-appstore.mjs decided whether to warn about the unpinned floor
// with `hasOwnProperty('xcode')`, so writing the pin down silenced the sentence
// that named the hazard while the hazard stayed exactly where it was.
//
// The verdict functions are PURE so both directions are exercised on Windows and
// Linux against captured `xcodebuild -version` output. The only part of the job
// that needs a Mac is running the tool — the same split
// assert-artifact-signed-apple.mjs uses, for the same reason.
//
// ⚠️ 26.6 PASSES A FLOOR OF 26 AND IS MEANT TO. Apple's sentence is "Xcode 26 or
// later"; $xcode_comment records why the pin is a MAJOR and not a full version.
// A test that demanded equality would turn the floor back into the image.
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
import { parseXcodeMajor, parseFloor, meetsFloor, main, VERSIONS_REL, FLOOR_KEY } from '../assert-xcode-floor.mjs';

const GUARD = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'assert-xcode-floor.mjs');
// REAL `xcodebuild -version` output from run 35741818599 — the citation is in that directory's README.md.
const CAPTURED_VERSION = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'apple-run-35741818599', 'xcodebuild-version.txt'),
  'utf8',
);

let TMP;
before(() => { TMP = mkdtempSync(join(tmpdir(), 'nikatru-xcfloor-')); });
after(() => { rmSync(TMP, { recursive: true, force: true }); });
let seq = 0;

/** A root carrying whatever versions.json body is under test. `null` writes none. */
function fixture(versions) {
  const root = join(TMP, `f${seq++}`);
  mkdirSync(join(root, 'tooling'), { recursive: true });
  if (versions !== null) {
    writeFileSync(
      join(root, VERSIONS_REL),
      typeof versions === 'string' ? versions : JSON.stringify(versions, null, 2),
    );
  }
  return root;
}

const run = (root) => {
  const r = spawnSync(process.execPath, [GUARD, root], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
};

// ── the reading ──────────────────────────────────────────────────────────────
describe('assert-xcode-floor — reading what xcodebuild reported', () => {
  // The real two-line shape, captured from a macos-26 runner as recorded in
  // tooling/channel-register.json's ios-appstore notes ("Xcode 26.6 / 17F113").
  // HAND-WRITTEN SHAPE — not captured output; the captured fixtures are fixtures/apple-run-35741818599/.
  const REAL = 'Xcode 26.6\nBuild version 17F113\n';

  test('the real two-line report yields the MAJOR', () => {
    assert.deepEqual(parseXcodeMajor(REAL), { major: 26, reported: 'Xcode 26.6' });
  });

  test('a bare major, with no dotted part', () => {
    // HAND-WRITTEN SHAPE — not captured output; the captured fixtures are fixtures/apple-run-35741818599/.
    assert.equal(parseXcodeMajor('Xcode 27\nBuild version 19A1\n').major, 27);
  });

  test('a three-part version still yields the major', () => {
    // HAND-WRITTEN SHAPE — not captured output; the captured fixtures are fixtures/apple-run-35741818599/.
    assert.equal(parseXcodeMajor('Xcode 26.1.1\nBuild version 17B55\n').major, 26);
  });

  // 🔴 THE LINE ANCHOR IS LOAD-BEARING. `Build version 17F113` carries digits,
  // and a matcher that scanned anywhere could read a build number as a version.
  test('the BUILD VERSION line is never read as the answer', () => {
    // HAND-WRITTEN SHAPE — not captured output; the captured fixtures are fixtures/apple-run-35741818599/.
    assert.equal(parseXcodeMajor('Build version 17F113\n'), null);
  });

  test('prose that merely mentions Xcode is not a reading', () => {
    // HAND-WRITTEN SHAPE — not captured output; the captured fixtures are fixtures/apple-run-35741818599/.
    assert.equal(parseXcodeMajor('note: install Xcode 26 from the App Store\n'), null);
    assert.equal(parseXcodeMajor('xcode-select: error: tool not installed\n'), null);
  });

  test('empty and non-string output are refusals, not zeroes', () => {
    for (const bad of ['', '   ', null, undefined, 42, {}]) assert.equal(parseXcodeMajor(bad), null);
  });
});

// ── the floor ────────────────────────────────────────────────────────────────
describe('assert-xcode-floor — reading the declared floor', () => {
  test('the string major this repository actually declares', () => {
    assert.equal(parseFloor('26'), 26);
  });

  test('a number is accepted too — JSON allows both and the pin is hand-edited', () => {
    assert.equal(parseFloor(26), 26);
  });

  // A full version here would silently become "whatever the image carried the
  // day somebody looked", which $xcode_comment records as the thing a floor
  // must not be. Refusing it is louder than truncating it.
  test('a DOTTED version is refused, not truncated to its major', () => {
    assert.equal(parseFloor('26.6'), null);
  });

  test('nonsense, empty and missing all refuse', () => {
    for (const bad of ['', '  ', 'twenty-six', null, undefined, {}, [], '0', '-3']) {
      assert.equal(parseFloor(bad), null, `parseFloor(${JSON.stringify(bad)})`);
    }
  });
});

// ── the comparison ───────────────────────────────────────────────────────────
describe('assert-xcode-floor — the verdict is a FLOOR, not an equality', () => {
  test('exactly the floor passes', () => assert.equal(meetsFloor(26, 26), true));
  test('above the floor passes — a later Xcode is allowed and is meant to be', () => {
    assert.equal(meetsFloor(27, 26), true);
    assert.equal(meetsFloor(31, 26), true);
  });
  test('below the floor FAILS — the whole point', () => {
    assert.equal(meetsFloor(25, 26), false);
    assert.equal(meetsFloor(15, 26), false);
  });
});

// ── the CLI: every way the question cannot be asked ──────────────────────────
describe('assert-xcode-floor — a question that could not be asked is never a pass', () => {
  // ⚠️ THESE RUN WHEREVER THE SUITE RUNS. On Linux and Windows there is no
  // `xcodebuild`, so the guard exits COVERAGE LOST before reaching the
  // comparison — which is itself the assertion being made here, and is why this
  // guard is wired into build-platforms.yml's `apple` job and not into ci.yml.
  test('no versions.json at all', () => {
    const { code, out } = run(fixture(null));
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /does not exist/);
  });

  test('an unparseable versions.json', () => {
    const { code, out } = run(fixture('{ not json'));
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /not valid JSON/);
  });

  // 🔴 THE KEY VANISHING MUST BE LOUD. Its ABSENCE is what silenced the warning
  // in submit-appstore.mjs; the same absence must never quietly disarm this.
  test('versions.json with no `xcode` key — the pin deleted', () => {
    const { code, out } = run(fixture({ flutter: '3.44.9', runner_macos: 'macos-26' }));
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, new RegExp(`declares no \\\`${FLOOR_KEY}\\\` key`));
    assert.match(out, /Xcode 26 or later/);
  });

  test('an `xcode` key that is not a major', () => {
    const { code, out } = run(fixture({ xcode: '26.6', runner_macos: 'macos-26' }));
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /is not a major version/);
  });

  test('COVERAGE LOST on a subject-free tree — the shape assert-guards-refuse-empty spawns', () => {
    const root = join(TMP, `bare${seq++}`);
    mkdirSync(root, { recursive: true });
    const { code, out } = run(root);
    assert.notEqual(code, 0);
    assert.match(out, /COVERAGE LOST/);
  });

  test('the REAL repository is never graded by a guard that could not run', () => {
    // Whatever this machine is, the guard must not exit 0 without an actual
    // reading. On a Mac it reads one and may pass; anywhere else it refuses.
    // Either way a zero exit REQUIRES the ok line naming both numbers.
    const r = spawnSync(process.execPath, [GUARD], { encoding: 'utf8' });
    const out = `${r.stdout}${r.stderr}`;
    if (r.status === 0) assert.match(out, /ok {2}xcode floor — the runner reports .* floor of \d+/);
    else assert.match(out, /COVERAGE LOST|assert-xcode-floor: FAILED/);
  });
});

// ── the captured output, through main({ run }) ───────────────────────────────
// REAL `xcodebuild -version` output from run 35741818599, fed through the guard's one seam against the REAL
// tooling/versions.json: the same probe, parse, verdict and exit CI runs. Only the tool call is replayed.
describe('assert-xcode-floor — the captured output of run 35741818599', () => {
  test('T4: the real report on stdout meets the real floor — exit 0, reading "Xcode 26.6"', () => {
    const calls = [];
    const run = (cmd, args) => {
      calls.push([cmd, ...args]);
      return cmd === 'xcodebuild' ? { status: 0, stdout: CAPTURED_VERSION, stderr: '' } : { status: 1, stdout: '', stderr: '' };
    };
    const r = main({ argv: [], run });
    assert.equal(r.code, 0, `${r.stdout}${r.stderr}`);
    assert.match(r.stdout, /ok {2}xcode floor — the runner reports "Xcode 26\.6" and tooling\/versions\.json declares a floor of 26; 26 >= 26/);
    assert.deepEqual(calls, [['xcodebuild', '-version']]);
    // The hand-typed REAL above agrees with the capture byte for byte.
    assert.equal(CAPTURED_VERSION, 'Xcode 26.6\nBuild version 17F113\n');
  });

  test('T5: COVERAGE LOST prints what xcodebuild returned — path, version, exit, the first 20 of 25 lines', () => {
    const lines25 = `${Array.from({ length: 25 }, (_, i) => `garbled ${i}`).join('\n')}\n`;
    // Made-up answers, not captured ones: the stop is what is under test.
    const run = (cmd, args) => {
      if (cmd === 'xcodebuild') return { status: 1, stdout: lines25, stderr: '' };
      if (cmd === 'which') return { status: 0, stdout: `/usr/bin/${args[0]}\n`, stderr: '' };
      if (cmd === 'xcode-select') return { status: 0, stdout: '/Applications/Xcode_26.6.app/Contents/Developer\n', stderr: '' };
      return { status: null, stdout: '', stderr: '', error: Object.assign(new Error(`spawn ${cmd} ENOENT`), { code: 'ENOENT' }) };
    };
    const r = main({ argv: [], run });
    assert.equal(r.code, 2, `${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /✗ COVERAGE LOST — `xcodebuild -version` could not be run \(exit 1\)/);
    assert.match(r.stderr, /tool: \/usr\/bin\/xcodebuild/);
    assert.match(r.stderr, /version: unread .*xcode-select -p: \/Applications\/Xcode_26\.6\.app\/Contents\/Developer/);
    assert.match(r.stderr, /exit: 1\n/);
    assert.match(r.stderr, /stdout: 25 line\(s\), \d+ bytes, first 20 shown/);
    const shown = r.stderr.split('\n').filter((l) => /^\s*stdout\| /.test(l)).map((l) => l.trim());
    assert.deepEqual(shown, Array.from({ length: 20 }, (_, i) => `stdout| garbled ${i}`));
    assert.equal(r.stdout, '');
  });
});
