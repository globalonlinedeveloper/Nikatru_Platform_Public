// ─────────────────────────────────────────────────────────────────────────────
// android-target-sdk.test.mjs — assert-android-target-sdk.mjs must be able to FAIL.
//
// The guard exists because `targetSdk = flutter.targetSdkVersion` met Google
// Play's floor BY ACCIDENT OF WHICH FLUTTER SDK WAS INSTALLED, and nothing in
// the tree asserted it. Every fixture below is therefore aimed at one question:
// can this guard tell "pinned and compliant" from "compliant today because of
// something outside the repository"?
//
// ⚠️ A FIXTURE PASSING IS NOT A GUARD WORKING. assert-seams-wired.mjs shipped
// with a check that could not fail while all six of its fixture tests passed —
// a fixture you wrote encodes the same misunderstanding as the guard you wrote.
// So these were paired with REAL-TREE MUTATIONS, recorded in the guard's PR:
//
//   R1  targetSdk reverted to `flutter.targetSdkVersion`  -> "is NOT PINNED"
//   R2  targetSdk = 35                                    -> "below Google Play's floor of 36"
//   R3  compileSdk = 35 beside targetSdk = 36             -> "is below `targetSdk`"
//   R4  enforced.targetSdkAtLeast deleted from the row    -> COVERAGE LOST
//   R5  source.url deleted from the row                   -> COVERAGE LOST
//   R6  '.kts' removed from COMMENT_STYLES                -> COVERAGE LOST (reduction did not reduce)
//   R7  the app module file renamed away                  -> COVERAGE LOST (android/ with no module)
//   R8  the real targetSdk line commented out             -> COVERAGE LOST (declares no targetSdk)
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, renameSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { matchBrace, blockBody, assignment } from '../assert-android-target-sdk.mjs';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GUARD = join(CI_DIR, 'assert-android-target-sdk.mjs');

let TMP;
before(() => { TMP = mkdtempSync(join(tmpdir(), 'nikatru-tsdk-')); });
after(() => { rmSync(TMP, { recursive: true, force: true }); });

let seq = 0;

/** The duty row that carries the floor and its citation. */
function baseMatrix() {
  return {
    sourceHosts: { allowed: ['developer.android.com'] },
    statuses: { implemented: 'x' },
    verificationKinds: { 'primary-source': 'x' },
    requirements: { 'K-13': 'x' },
    duties: [
      {
        id: 'play-target-api-level',
        requirement: 'K-13',
        duty: 'target API level floor',
        status: 'implemented',
        artefact: 'apps/demo/android/app/build.gradle.kts',
        trigger: 'upload',
        verification: 'primary-source',
        enforced: { targetSdkAtLeast: 36, inForceFrom: '2026-08-31', extensionAvailableTo: '2026-11-01' },
        source: {
          url: 'https://developer.android.com/google/play/requirements/target-sdk',
          fetched: '2026-08-04',
          quote: 'target API level 36 from 31 August 2026',
        },
      },
    ],
  };
}

/** A module that PASSES, so every mutation fails for its own reason rather than
 *  for a defect inherited from the fixture. */
const baseGradle = `
// A header comment mentioning targetSdk = 1 so prose cannot satisfy the check.
plugins { id("com.android.application") }

android {
    namespace = "com.example.demo"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.example.demo"
        minSdk = flutter.minSdkVersion
        targetSdk = 36
    }
}
`;

/** Writes a fixture root and returns its path. */
function root({ gradle = baseGradle, matrix = baseMatrix(), apps = { demo: true } } = {}) {
  const dir = join(TMP, `r${seq++}`);
  mkdirSync(join(dir, 'tooling', 'legal'), { recursive: true });
  if (matrix !== null) writeFileSync(join(dir, 'tooling', 'legal', 'duty-matrix.json'), JSON.stringify(matrix, null, 2));
  for (const [name, withModule] of Object.entries(apps)) {
    mkdirSync(join(dir, 'apps', name, 'android', 'app'), { recursive: true });
    if (withModule) writeFileSync(join(dir, 'apps', name, 'android', 'app', 'build.gradle.kts'), gradle);
  }
  return dir;
}

const run = (dir) => {
  const r = spawnSync(process.execPath, [GUARD, dir], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
};

describe('the pure parse — braces and assignments', () => {
  test('matchBrace finds the end of a block', () => {
    const t = 'a { b { c } d } e';
    assert.equal(matchBrace(t, 2), 15);
  });

  test('a brace inside a string does not close the block', () => {
    const t = 'a { s = "}" ; b = 1 } e';
    assert.equal(t.slice(2, matchBrace(t, 2)), '{ s = "}" ; b = 1 }');
  });

  test('a brace inside a Kotlin raw string does not close the block', () => {
    const t = 'a { s = """}""" ; b = 1 } e';
    assert.equal(t.slice(2, matchBrace(t, 2)), '{ s = """}""" ; b = 1 }');
  });

  test('an unclosed block is reported rather than guessed', () => {
    assert.equal(matchBrace('a { b', 2), -1);
  });

  test('blockBody returns the body of a named block', () => {
    assert.match(blockBody('android {\n  compileSdk = 36\n}', 'android'), /compileSdk = 36/);
  });

  test('blockBody does not match a block whose name merely ends with the target', () => {
    assert.equal(blockBody('notandroid {\n x = 1\n}', 'android'), null);
  });

  test('blockBody does not match a dotted receiver', () => {
    assert.equal(blockBody('foo.android {\n x = 1\n}', 'android'), null);
  });

  test('assignment reads an integer literal', () => {
    assert.deepEqual(assignment('targetSdk = 36', 'targetSdk'), { literal: 36, raw: '36' });
  });

  test('assignment reports a NON-LITERAL as an expression, not as absent', () => {
    // The distinction is the whole guard: absent is COVERAGE LOST, an
    // expression is the defect. Collapsing them hides an unpinned module.
    assert.deepEqual(assignment('targetSdk = flutter.targetSdkVersion', 'targetSdk'), {
      expression: 'flutter.targetSdkVersion',
      raw: 'flutter.targetSdkVersion',
    });
  });

  test('assignment returns null when the key is absent', () => {
    assert.equal(assignment('minSdk = 24', 'targetSdk'), null);
  });

  test('assignment does not match a longer key ending in the target', () => {
    assert.equal(assignment('myTargetSdk = 1', 'TargetSdk'), null);
  });
});

describe('the guard end to end', () => {
  test('a pinned, compliant module PASSES', () => {
    const r = run(root());
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /1 Android module\(s\) pin targetSdk at or above 36/);
  });

  test('an UNPINNED targetSdk FAILS — this is the state the guard was written against', () => {
    const r = run(root({ gradle: baseGradle.replace('targetSdk = 36', 'targetSdk = flutter.targetSdkVersion') }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /is NOT PINNED/);
  });

  test('a pinned value BELOW the floor FAILS and cites the source', () => {
    const r = run(root({ gradle: baseGradle.replace('targetSdk = 36', 'targetSdk = 35') }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /below Google Play's floor of 36/);
    assert.match(r.out, /developer\.android\.com/);
    assert.match(r.out, /read 2026-08-04/);
  });

  test('a pinned value ABOVE the floor passes — the floor is a minimum, not an equality', () => {
    // compileSdk moves with it: AGP requires compileSdk >= targetSdk, and the
    // guard checks that relationship, so raising only one is a real defect.
    const r = run(root({
      gradle: baseGradle.replace('targetSdk = 36', 'targetSdk = 37').replace('compileSdk = 36', 'compileSdk = 37'),
    }));
    assert.equal(r.code, 0, r.out);
  });

  test('compileSdk below targetSdk FAILS — AGP rejects that combination', () => {
    const r = run(root({ gradle: baseGradle.replace('compileSdk = 36', 'compileSdk = 35') }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /is below `targetSdk = 36`/);
  });

  test('a toolchain-resolved compileSdk PRINTS the blind spot instead of inventing a rule', () => {
    const r = run(root({ gradle: baseGradle.replace('compileSdk = 36', 'compileSdk = flutter.compileSdkVersion') }));
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /CANNOT be checked statically/);
  });

  test('a targetSdk that exists ONLY in a comment does not satisfy the check', () => {
    // Prose satisfying a check about behaviour is this repo's recurring defect —
    // a grep for '"r2_buckets"' once matched the comment explaining there is none.
    const r = run(root({ gradle: baseGradle.replace('targetSdk = 36', '// targetSdk = 36') }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /COVERAGE LOST/);
    assert.match(r.out, /declares no `targetSdk`/);
  });

  test('a floor with NO source url is COVERAGE LOST, not an enforced number', () => {
    const m = baseMatrix();
    delete m.duties[0].source.url;
    const r = run(root({ matrix: m }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /COVERAGE LOST/);
    assert.match(r.out, /no https `source\.url`/);
  });

  test('a floor with no fetch DATE is COVERAGE LOST — a policy read at an unknown time', () => {
    const m = baseMatrix();
    m.duties[0].source.fetched = 'last week';
    const r = run(root({ matrix: m }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /no ISO `source\.fetched` date/);
  });

  test('a source url that is not https is refused', () => {
    const m = baseMatrix();
    m.duties[0].source.url = 'http://developer.android.com/x';
    const r = run(root({ matrix: m }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /no https `source\.url`/);
  });

  test('a missing enforced value is COVERAGE LOST rather than a vacuous pass', () => {
    const m = baseMatrix();
    delete m.duties[0].enforced.targetSdkAtLeast;
    const r = run(root({ matrix: m }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /no integer `enforced\.targetSdkAtLeast`/);
  });

  test('a floor stated only in the human-readable quote does NOT count', () => {
    // The structured field is the assertion; the quote is evidence for a reader.
    const m = baseMatrix();
    delete m.duties[0].enforced;
    m.duties[0].source.quote = 'apps must target API level 36 or higher';
    const r = run(root({ matrix: m }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /no integer `enforced\.targetSdkAtLeast`/);
  });

  test('a missing inForceFrom date is COVERAGE LOST — no deadline, no lead time', () => {
    const m = baseMatrix();
    delete m.duties[0].enforced.inForceFrom;
    const r = run(root({ matrix: m }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /no ISO `enforced\.inForceFrom`/);
  });

  test('deleting the duty row deletes the floor, and that is COVERAGE LOST', () => {
    const m = baseMatrix();
    m.duties = [];
    const r = run(root({ matrix: m }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /no duty row `play-target-api-level`/);
  });

  test('an absent duty matrix is COVERAGE LOST', () => {
    const r = run(root({ matrix: null }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /does not exist/);
  });

  test('an unparseable duty matrix is COVERAGE LOST', () => {
    const dir = root();
    writeFileSync(join(dir, 'tooling', 'legal', 'duty-matrix.json'), '{ not json');
    const r = run(dir);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /could not be parsed/);
  });

  test('an android/ directory whose app module is missing is COVERAGE LOST', () => {
    // Deriving the set only from files that MATCH would make moving the module
    // the way to pass, and "not found" prints identically to "compliant".
    const r = run(root({ apps: { demo: true, ghost: false } }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /android\/ directory whose app module this scan did not find/);
  });

  test('no Android module at all is COVERAGE LOST, never a clean pass', () => {
    const dir = root();
    renameSync(
      join(dir, 'apps', 'demo', 'android'),
      join(dir, 'apps', 'demo', 'android-was-here'),
    );
    const r = run(dir);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /no Android app module found/);
  });

  test('a module with no android { } block is COVERAGE LOST, not zero problems', () => {
    const r = run(root({ gradle: 'plugins { id("x") }\n' }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /no `android \{/);
  });

  test('a module with no defaultConfig block is COVERAGE LOST', () => {
    const r = run(root({ gradle: 'android {\n  compileSdk = 36\n}\n' }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /no `defaultConfig/);
  });

  test('EVERY module is checked, not just the first', () => {
    const dir = root({ apps: { good: true } });
    mkdirSync(join(dir, 'apps', 'bad', 'android', 'app'), { recursive: true });
    writeFileSync(
      join(dir, 'apps', 'bad', 'android', 'app', 'build.gradle.kts'),
      baseGradle.replace('targetSdk = 36', 'targetSdk = 30'),
    );
    const r = run(dir);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /apps\/bad\/android\/app\/build\.gradle\.kts/);
  });

  test('the deadline is reported with the days remaining, so it has lead time', () => {
    const r = run(root());
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /IN FORCE (in \d+ day\(s\), on 2026-08-31|since 2026-08-31)/);
  });

  test('what the guard cannot see is PRINTED on every passing run', () => {
    const r = run(root());
    assert.match(r.out, /NOT CHECKED HERE: Gradle is never run/);
  });
});
