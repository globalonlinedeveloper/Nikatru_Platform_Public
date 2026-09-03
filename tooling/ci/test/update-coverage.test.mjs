// ─────────────────────────────────────────────────────────────────────────────
// update-coverage.test.mjs — assert-update-coverage.mjs must be able to FAIL.
//
// [pipeline 14]O-9 "Pinned inputs are advanced by a mechanism on a cadence,
// never by memory."
//
// ⚠️ REAL-TREE MUTATIONS FIRST, BEFORE THIS FILE EXISTED. Ten, run 2026-08-02
// against a robocopy of the worktree at 6f048a3 with the O-9 change applied.
// Each: baseline green → mutate → assert the intended message → restore FROM
// MEMORY → byte-compare → re-verify green. None crashed; all ten exited 1 with
// the intended message; all ten restores were byte-identical and re-verified.
//
//   U1  a customManager pattern written as a bare regex,
//       the HISTORIC BUG                                   → "match NO file in the tree"
//   U2  the pattern matches the file, the matchString
//       matches no line in it                              → "captured a `currentValue`"
//   U3  the matchString matches but names no capture group → "captured a `currentValue`"
//   U4  a new pin in versions.json, no manager, no waiver   → "and no customManager extracts it"
//   U5  a pin deleted while its exemption stays behind      → "A waiver outliving the thing it waived"
//   U6  an exemption whose `why` is whitespace              → "no `key` or no `why`"
//   U7  every customManager removed                         → "declares no `customManagers`"
//   U8  a manager with no `managerFilePatterns` at all      → "no `managerFilePatterns`"
//   U9  versions.json emptied of every pin                  → COVERAGE LOST
//   U10 renovate.json deleted                               → COVERAGE LOST
//
// A fixture you wrote encodes the same misunderstanding as the guard you wrote,
// which is why the order above is not negotiable: assert-seams-wired.mjs shipped
// with a check that could not fail while all six of its fixture tests passed.
//
// ⚠️ AND THEN THESE TESTS WERE NEGATIVE-TESTED IN TURN — ten limbs of the guard
// reverted one at a time in the real worktree, each required to turn this suite
// RED, each restored from memory and byte-compared. NINE did. THE TENTH DID NOT,
// and it is recorded here because it is the same lesson one level up: reverting
// the "renovate.json does not exist" check left the suite GREEN, because a
// missing file still fails through the JSON.parse catch and the test matched
// only /COVERAGE LOST/. It now asserts the sentence, not the marker. A test that
// accepts any failure is not testing the limb it names.
//
// 🔬 AND THE RED IT FOUND ON ITS FIRST REAL RUN, which no fixture would have
// produced: `wrangler` — the tool that PUBLISHES PRODUCTION, already caught once
// a full major version behind and holding the account API token — was pinned in
// tooling/versions.json and reached by no manager at all. Four pins were
// uncovered; one got a customManager, three got written exemptions.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { matchesPath, pinnedKeys, evaluate, candidatePaths } from '../assert-update-coverage.mjs';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(CI_DIR, '..', '..');
const GUARD = join(CI_DIR, 'assert-update-coverage.mjs');

let TMP;
before(() => { TMP = mkdtempSync(join(tmpdir(), 'nikatru-upd-')); });
after(() => { rmSync(TMP, { recursive: true, force: true }); });

let seq = 0;

const VERSIONS_PATH = 'tooling/versions.json';
const VERSIONS_TEXT = '{\n  "$comment": ["prose"],\n  "flutter": "3.44.8",\n  "runner_macos": "macos-26"\n}\n';

/** A configuration that PASSES, so every mutation below is proven to fail for
 *  its own reason rather than for one the fixture already had. */
function baseInputs(over = {}) {
  return {
    config: {
      customManagers: [
        {
          customType: 'regex',
          depNameTemplate: 'flutter',
          datasourceTemplate: 'flutter-version',
          matchStrings: ['"flutter":\\s*"(?<currentValue>[^"]+)"'],
          managerFilePatterns: ['/^tooling\\/versions\\.json$/'],
        },
      ],
    },
    versions: JSON.parse(VERSIONS_TEXT),
    exemptions: new Map([['runner_macos', 'a runner image label, not a package']]),
    fileContents: new Map([[VERSIONS_PATH, VERSIONS_TEXT]]),
    paths: [VERSIONS_PATH, 'renovate.json'],
    ...over,
  };
}

const errorsOf = (over) => evaluate(baseInputs(over)).errors.join(' | ');

describe('assert-update-coverage — the fixture must be green, or nothing below means anything', () => {
  test('a manager that reaches the file and captures the value passes', () => {
    const v = evaluate(baseInputs());
    assert.deepEqual(v.errors, []);
    assert.equal(v.covered.get('flutter').value, '3.44.8');
    assert.equal(v.exempted.size, 1);
  });
});

describe('assert-update-coverage — THE HISTORIC BUG: a manager that runs on nothing', () => {
  test('a bare regex where a glob is expected matches no path and FAILS', () => {
    const inputs = baseInputs();
    inputs.config.customManagers[0].managerFilePatterns = ['^tooling/versions\\.json$'];
    assert.match(evaluate(inputs).errors.join(' '), /match NO file in the tree/);
  });

  test('the failure message names the shape, so the next person recognises it', () => {
    const inputs = baseInputs();
    inputs.config.customManagers[0].managerFilePatterns = ['^tooling/versions\\.json$'];
    assert.match(evaluate(inputs).errors.join(' '), /five toolchain pins receiving no proposals/);
  });

  test('a glob that reaches the file is accepted — both syntaxes are APPLIED, not judged', () => {
    const inputs = baseInputs();
    inputs.config.customManagers[0].managerFilePatterns = ['tooling/*.json'];
    assert.deepEqual(evaluate(inputs).errors, []);
  });

  test('a manager with no file pattern at all FAILS', () => {
    const inputs = baseInputs();
    delete inputs.config.customManagers[0].managerFilePatterns;
    assert.match(evaluate(inputs).errors.join(' '), /no `managerFilePatterns`/);
  });

  test('no customManagers at all FAILS — npm and pub do not read a JSON file of version strings', () => {
    assert.match(errorsOf({ config: { customManagers: [] } }), /declares no `customManagers`/);
  });
});

describe('assert-update-coverage — matching the FILE but missing the LINE', () => {
  test('a matchString that matches nothing in the file FAILS', () => {
    const inputs = baseInputs();
    inputs.config.customManagers[0].matchStrings = ['"flutterr":\\s*"(?<currentValue>[^"]+)"'];
    assert.match(evaluate(inputs).errors.join(' '), /captured a `currentValue`/);
  });

  test('a matchString that matches but names no capture group FAILS', () => {
    const inputs = baseInputs();
    inputs.config.customManagers[0].matchStrings = ['"flutter":\\s*"[^"]+"'];
    assert.match(evaluate(inputs).errors.join(' '), /captured a `currentValue`/);
  });

  test('no matchStrings at all FAILS', () => {
    const inputs = baseInputs();
    delete inputs.config.customManagers[0].matchStrings;
    assert.match(evaluate(inputs).errors.join(' '), /no `matchStrings`/);
  });

  test('an invalid regex is reported as invalid rather than silently skipped', () => {
    const inputs = baseInputs();
    inputs.config.customManagers[0].matchStrings = ['"flutter":\\s*"(?<currentValue>[^"]+'];
    assert.match(evaluate(inputs).errors.join(' '), /is not a valid regex/);
  });
});

describe('assert-update-coverage — every pin has an owner, in both directions', () => {
  test('a pin with no manager and no exemption FAILS', () => {
    const versions = { ...JSON.parse(VERSIONS_TEXT), brand_new: '1.0.0' };
    assert.match(errorsOf({ versions }), /`brand_new` is pinned .* and no customManager extracts it/);
  });

  test('the message says why a rotting pin is worse than no pin', () => {
    const versions = { ...JSON.parse(VERSIONS_TEXT), brand_new: '1.0.0' };
    assert.match(errorsOf({ versions }), /strictly worse than not pinning it at all/);
  });

  test('an exemption for a pin that no longer exists FAILS', () => {
    const versions = JSON.parse(VERSIONS_TEXT);
    delete versions.runner_macos;
    assert.match(errorsOf({ versions }), /A waiver outliving the thing it waived/);
  });

  test('a `$`-prefixed key is prose, not a pin, and is not demanded of any manager', () => {
    const versions = { ...JSON.parse(VERSIONS_TEXT), $another_comment: ['words'] };
    assert.deepEqual(evaluate(baseInputs({ versions })).errors, []);
  });

  test('pinnedKeys excludes every `$` key and nothing else', () => {
    assert.deepEqual(pinnedKeys({ $a: 1, b: 2, $c: 3, d: 4 }), ['b', 'd']);
  });
});

describe('assert-update-coverage — the pattern matcher itself', () => {
  test('a slash-wrapped pattern is applied as a REGEX', () => {
    assert.equal(matchesPath('/^tooling\\/versions\\.json$/', 'tooling/versions.json'), true);
    assert.equal(matchesPath('/^tooling\\/versions\\.json$/', 'other/versions.json'), false);
  });

  test('an unwrapped pattern is applied as a GLOB, and `*` does not cross a separator', () => {
    assert.equal(matchesPath('tooling/*.json', 'tooling/versions.json'), true);
    assert.equal(matchesPath('tooling/*.json', 'tooling/deep/versions.json'), false);
  });

  test('`**` does cross separators', () => {
    assert.equal(matchesPath('tooling/**/versions.json', 'tooling/deep/versions.json'), true);
  });

  test('a dot in a glob is literal, not "any character"', () => {
    assert.equal(matchesPath('tooling/versions.json', 'tooling/versionsXjson'), false);
  });

  test('an unparseable regex matches nothing rather than throwing', () => {
    assert.equal(matchesPath('/^(unclosed/', 'anything'), false);
  });

  test('a bare regex string is treated as a glob and therefore matches nothing — the bug, isolated', () => {
    assert.equal(matchesPath('^tooling/versions\\.json$', 'tooling/versions.json'), false);
  });
});

describe('assert-update-coverage — end to end, against the real repository', () => {
  test('the committed configuration reaches every pin, or exempts it in writing', () => {
    const r = spawnSync(process.execPath, [GUARD], { cwd: REPO, encoding: 'utf8' });
    assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  });

  test('and it PRINTS each exemption, so a waiver cannot be invisible', () => {
    const r = spawnSync(process.execPath, [GUARD], { cwd: REPO, encoding: 'utf8' });
    assert.match(r.stdout, /EXEMPT runner_macos/);
  });

  test('the real path walk reaches tooling/versions.json — without it no pattern could ever match', () => {
    assert.ok(candidatePaths(REPO).includes(VERSIONS_PATH));
  });

  // ⚠️ ASSERTS THE SPECIFIC SENTENCE, not merely "COVERAGE LOST". A negative test
  // found the difference: with the existence check reverted, a missing file
  // still fails — through the JSON.parse catch — so a test matching only
  // /COVERAGE LOST/ STAYED GREEN while the limb it claimed to cover was gone.
  // The two paths are not equivalent to a reader: "does not exist" names the
  // remedy and "could not be parsed" points at the wrong problem entirely.
  test('a repo with no renovate.json says so BY NAME, and is COVERAGE LOST', () => {
    const root = join(TMP, `e${seq++}`);
    mkdirSync(join(root, 'tooling'), { recursive: true });
    writeFileSync(join(root, 'tooling/versions.json'), VERSIONS_TEXT);
    const r = spawnSync(process.execPath, [GUARD, root], { encoding: 'utf8' });
    assert.equal(r.status, 1);
    const out = `${r.stdout}\n${r.stderr}`;
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /renovate\.json does not exist under/);
  });

  test('a repo with no versions.json names THAT file instead — the two are distinguishable', () => {
    const root = join(TMP, `e${seq++}`);
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, 'renovate.json'), '{"customManagers":[]}');
    const r = spawnSync(process.execPath, [GUARD, root], { encoding: 'utf8' });
    assert.equal(r.status, 1);
    assert.match(`${r.stdout}\n${r.stderr}`, /tooling\/versions\.json does not exist under/);
  });

  test('a versions.json with no pins at all is COVERAGE LOST — the subject set would be empty', () => {
    const root = join(TMP, `e${seq++}`);
    mkdirSync(join(root, 'tooling'), { recursive: true });
    writeFileSync(join(root, 'renovate.json'), '{"customManagers":[]}');
    writeFileSync(join(root, 'tooling/versions.json'), '{"$comment":["nothing pinned"]}');
    const r = spawnSync(process.execPath, [GUARD, root], { encoding: 'utf8' });
    assert.equal(r.status, 1);
    assert.match(`${r.stdout}\n${r.stderr}`, /declares no pinned version at all/);
  });

  test('an exemption with a blank reason is refused by the real entry point', () => {
    const root = join(TMP, `e${seq++}`);
    mkdirSync(join(root, 'tooling'), { recursive: true });
    writeFileSync(join(root, 'renovate.json'), '{"customManagers":[]}');
    writeFileSync(
      join(root, 'tooling/versions.json'),
      JSON.stringify({ flutter: '1.0.0', $updateExemptions: [{ key: 'flutter', why: '  ' }] }),
    );
    const r = spawnSync(process.execPath, [GUARD, root], { encoding: 'utf8' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /no `key` or no `why`/);
  });
});

// ── U11/U12 · THE DATASOURCE THAT DOES NOT EXIST ────────────────────────────
// Added 2026-09-03, after `pub` (Renovate ships `dart`) stood in the real
// renovate.json and left `melos` and `mason_cli` advanced by nobody while every
// limb above reported green. Renovate does not fail on an unknown datasource —
// it logs `WARN: Missing datasource!` — so nothing outside this guard can tell.
describe('assert-update-coverage — a manager may only name a datasource somebody verified', () => {
  test('U11 · the historic value `pub` FAILS, and the message names the real id', () => {
    const inputs = baseInputs();
    inputs.config.customManagers[0].datasourceTemplate = 'pub';
    const errs = evaluate(inputs).errors.join(' ');
    assert.match(errs, /is not an id this repo has verified/);
    assert.match(errs, /dart/, 'the accepted set must be printed, or the reader cannot act on the failure');
    assert.match(errs, /melos.+mason_cli|mason_cli/, 'the message must carry the real incident, not a generic scold');
  });

  test('U12 · NO `datasourceTemplate` at all FAILS — an extracted version looked up nowhere', () => {
    const inputs = baseInputs();
    delete inputs.config.customManagers[0].datasourceTemplate;
    assert.match(evaluate(inputs).errors.join(' '), /no `datasourceTemplate`/);
  });

  test('every datasource the REAL renovate.json names is accepted — the guard must not redden the tree it ships with', () => {
    // Reads the committed config rather than a fixture: a fixture would only
    // prove the set matches itself.
    const real = JSON.parse(readFileSync(join(REPO, 'renovate.json'), 'utf8'));
    for (const m of real.customManagers ?? []) {
      const inputs = baseInputs();
      inputs.config.customManagers[0].datasourceTemplate = m.datasourceTemplate;
      assert.deepEqual(
        evaluate(inputs).errors,
        [],
        `the committed config names \`${m.datasourceTemplate}\`, which this guard refuses`,
      );
    }
  });
});
