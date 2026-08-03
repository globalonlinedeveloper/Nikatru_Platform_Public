// ─────────────────────────────────────────────────────────────────────────────
// release-lane-generic.test.mjs — assert-release-lane-generic.mjs must be able
// to FAIL, and must fail for the RIGHT reason.
//
// ⚠️ THE REAL TREE IS THE FIRST NEGATIVE TEST, not these fixtures.
// Mutation-proven 2026-08-03 against the working tree:
//   · adding `- apps/second` to the root pubspec `workspace:` list makes limb A
//     exit 1 naming build-platforms.yml AND e2e.yml as MISSING apps/second;
//   · deleting the `// LANE-BOUND:` line from assert-platform-proof-fresh.mjs
//     makes limb B exit 1 naming that file and build-platforms.yml;
//   · re-introducing `const DEPLOY = 'deploy-web.yml';` into
//     assert-seams-wired.mjs — the exact line [pipeline 9]R-1 was written about
//     — makes limb B exit 1 for that file.
// Each was restored from memory and byte-compared, and the guard returned to
// exit 0. A fixture the guard's author wrote encodes the same misunderstanding
// as the guard, so it can only ever be the second line of evidence.
//
// The cases below cover what the real tree cannot show without breaking it: the
// `env:` hoist bypass the original criterion invited, a matrix over two apps, a
// parameterised path, the comment bypass, an unowned workflow, and every way a
// LANE-BOUND declaration can be wrong.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, copyFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GUARD = join(CI_DIR, 'assert-release-lane-generic.mjs');

let TMP;
before(() => { TMP = mkdtempSync(join(tmpdir(), 'nikatru-lane-')); });
after(() => { rmSync(TMP, { recursive: true, force: true }); });

let seq = 0;

const GATE_STUB = "const GATE = 'ci-gate';\n";

const CI_YML = `name: CI
on:
  push:
    branches: [main]
jobs:
  ci-gate:
    name: ci-gate
    runs-on: ubuntu-24.04
    steps:
      - run: echo gate
`;

/** The two lanes R-1 owns, plus whatever else a case needs. Every fixture root
 *  carries a `tooling/ci` so limb B has a corpus, and the real modules the guard
 *  imports are NOT copied — the guard is run from its own location, so its
 *  imports resolve against the real tree while the ROOT it grades is the
 *  fixture. */
function fixture({ workspace = ['apps/subly'], workflows = {}, guards = {} } = {}) {
  const root = join(TMP, `f${seq++}`);
  mkdirSync(join(root, '.github', 'workflows'), { recursive: true });
  mkdirSync(join(root, 'tooling', 'ci'), { recursive: true });
  writeFileSync(
    join(root, 'pubspec.yaml'),
    `name: ws\nworkspace:\n${workspace.map((w) => `  - ${w}\n`).join('')}\ndev_dependencies:\n  melos: ^8.2.2\n`,
  );
  const all = { 'ci.yml': CI_YML, ...workflows };
  for (const [name, body] of Object.entries(all)) writeFileSync(join(root, '.github', 'workflows', name), body);
  writeFileSync(join(root, 'tooling', 'ci', 'assert-gate-passed.mjs'), GATE_STUB);
  for (const [name, body] of Object.entries(guards)) writeFileSync(join(root, 'tooling', 'ci', name), body);
  return root;
}

const run = (root) => {
  const r = spawnSync(process.execPath, [GUARD, root], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
};

/** build-platforms.yml, in the shape the real one has: a literal app path. */
const platforms = (body) => `name: Build all 6 platforms
on:
  workflow_dispatch:
jobs:
  linux_web_android:
    runs-on: ubuntu-24.04
    steps:
${body}
`;

const literalLane = (app) => `      - name: Build web
        working-directory: ${app}
        run: flutter build web --release
`;

const E2E = platforms(literalLane('apps/subly')).replace('Build all 6 platforms', 'E2E (live)');

describe('assert-release-lane-generic.mjs — limb A (the lanes cover the workspace)', () => {
  test('one app, both R-1 lanes name it: ok', () => {
    const r = run(fixture({ workflows: { 'build-platforms.yml': platforms(literalLane('apps/subly')), 'e2e.yml': E2E } }));
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /build-platforms\.yml — covers exactly the workspace app set/);
    assert.match(r.out, /e2e\.yml — covers exactly the workspace app set/);
  });

  test('THE RECORDED FAILING CASE — a second workspace app no lane covers', () => {
    const r = run(
      fixture({
        workspace: ['apps/subly', 'apps/second'],
        workflows: { 'build-platforms.yml': platforms(literalLane('apps/subly')), 'e2e.yml': E2E },
      }),
    );
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /build-platforms\.yml covers \{apps\/subly\}.*MISSING apps\/second/s);
    assert.match(r.out, /e2e\.yml covers .*MISSING apps\/second/s);
  });

  test('THE BYPASS THE ORIGINAL CRITERION INVITED — hoisting the literal into `env:` changes nothing', () => {
    // A string ban is satisfied by moving the string. This resolves `${{ env.APP }}`
    // first, so the hoisted form and the inline form give the SAME answer — and
    // the same failure when a second app is not covered.
    const hoisted = `name: Build all 6 platforms
on:
  workflow_dispatch:
env:
  APP: apps/subly
jobs:
  linux_web_android:
    runs-on: ubuntu-24.04
    steps:
      - name: Build web
        working-directory: \${{ env.APP }}
        run: flutter build web --release
`;
    const okRun = run(fixture({ workflows: { 'build-platforms.yml': hoisted, 'e2e.yml': E2E } }));
    assert.equal(okRun.code, 0, okRun.out);
    assert.match(okRun.out, /build-platforms\.yml — covers exactly the workspace app set \{apps\/subly\}/);

    const badRun = run(
      fixture({ workspace: ['apps/subly', 'apps/second'], workflows: { 'build-platforms.yml': hoisted, 'e2e.yml': E2E } }),
    );
    assert.equal(badRun.code, 1, badRun.out);
    assert.match(badRun.out, /build-platforms\.yml covers \{apps\/subly\}/);
  });

  test('a matrix over both apps is the CORRECT generic shape and passes', () => {
    const matrixed = `name: Build all 6 platforms
on:
  workflow_dispatch:
jobs:
  build:
    runs-on: ubuntu-24.04
    strategy:
      matrix:
        app: [subly, second]
    steps:
      - name: Build web
        working-directory: apps/\${{ matrix.app }}
        run: flutter build web --release
`;
    const r = run(
      fixture({
        workspace: ['apps/subly', 'apps/second'],
        workflows: { 'build-platforms.yml': matrixed, 'e2e.yml': matrixed },
      }),
    );
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /covers exactly the workspace app set \{apps\/second, apps\/subly\}/);
  });

  test('a run-time parameterised app path is a lane that serves any app', () => {
    const called = `name: Build all 6 platforms
on:
  workflow_call:
    inputs:
      app:
        type: string
jobs:
  build:
    runs-on: ubuntu-24.04
    steps:
      - working-directory: apps/\${{ inputs.app }}
        run: flutter build web --release
`;
    const r = run(fixture({ workspace: ['apps/subly', 'apps/second'], workflows: { 'build-platforms.yml': called, 'e2e.yml': called } }));
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /the app segment of its paths is a run-time parameter/);
  });

  test('a comment naming the second app is NOT coverage', () => {
    // build-platforms.yml really does name `apps/subly/android/app/build.gradle.kts`
    // in prose. A raw text match would read a lane's own explanation as its
    // behaviour — the defect this repo has shipped twice.
    const commented = platforms(`      # also builds apps/second one day
${literalLane('apps/subly')}`);
    const r = run(
      fixture({ workspace: ['apps/subly', 'apps/second'], workflows: { 'build-platforms.yml': commented, 'e2e.yml': E2E } }),
    );
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /MISSING apps\/second/);
  });

  test('a workflow no stage owns fails rather than being silently ungraded', () => {
    const r = run(
      fixture({
        workflows: { 'build-platforms.yml': platforms(literalLane('apps/subly')), 'e2e.yml': E2E, 'mystery.yml': E2E },
      }),
    );
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /belong to no declared owner: mystery\.yml/);
  });

  test('COVERAGE LOST when the workspace holds no app at all', () => {
    const r = run(fixture({ workspace: ['packages/core'], workflows: { 'build-platforms.yml': platforms(literalLane('apps/subly')), 'e2e.yml': E2E } }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /COVERAGE LOST.*no `workspace:` entry under apps\//s);
  });

  test('COVERAGE LOST when neither R-1 lane is present', () => {
    const r = run(fixture({ workflows: {} }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /COVERAGE LOST/);
  });
});

describe('assert-release-lane-generic.mjs — limb B (no guard hides a lane)', () => {
  const lanes = { 'build-platforms.yml': platforms(literalLane('apps/subly')), 'e2e.yml': E2E };

  test('a guard binding ONE lane with no declaration fails', () => {
    const r = run(fixture({ workflows: lanes, guards: { 'assert-thing.mjs': "const DEPLOY = 'e2e.yml';\n" } }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /assert-thing\.mjs names exactly one workflow — e2e\.yml — and carries no `\/\/ LANE-BOUND: e2e\.yml/);
  });

  test('…and passes once it declares the binding with a real reason', () => {
    const decl = `// LANE-BOUND: e2e.yml — the subject is the one nightly live proof and there is exactly one of it, so a derived set would be a set of one.\nconst DEPLOY = 'e2e.yml';\n`;
    const r = run(fixture({ workflows: lanes, guards: { 'assert-thing.mjs': decl } }));
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /lane bindings — 1 guard\(s\) bind exactly one lane, 1 declaration\(s\)/);
  });

  test('a declaration too short to say WHY is not a declaration', () => {
    const decl = `// LANE-BOUND: e2e.yml — because\nconst DEPLOY = 'e2e.yml';\n`;
    const r = run(fixture({ workflows: lanes, guards: { 'assert-thing.mjs': decl } }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /gives a \d+-character reason, under the 60 this asks for/);
  });

  test('a declaration for a lane the guard no longer names is a standing waiver and fails', () => {
    const decl = `// LANE-BOUND: e2e.yml — this guard used to read the nightly workflow and the declaration outlived the code that did.\nconst NOTHING = 1;\n`;
    const r = run(fixture({ workflows: lanes, guards: { 'assert-thing.mjs': decl } }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /declares `LANE-BOUND: e2e\.yml` but its code no longer names that workflow/);
  });

  test('a workflow filename inside PROSE is not a binding', () => {
    // assert-guard-coverage.mjs names e2e.yml inside a sentence in an exemption
    // reason. Demanding a declaration from a file that binds nothing is the
    // false red that gets a guard switched off.
    const prose = "const REASON = 'is the e2e harness: e2e.yml runs it nightly against a live Supabase, so it is exercised for real.';\n";
    const r = run(fixture({ workflows: lanes, guards: { 'assert-thing.mjs': prose } }));
    assert.equal(r.code, 0, r.out);
  });

  test('a filename in a COMMENT is not a binding either', () => {
    const commented = '// this used to read deploy-web.yml and no longer does\nconst X = 1;\n';
    const r = run(fixture({ workflows: { ...lanes, 'deploy-web.yml': E2E }, guards: { 'assert-thing.mjs': commented } }));
    assert.equal(r.code, 0, r.out);
  });

  test('binding to the GATE is not binding to a lane — ci.yml is excluded, derived from `const GATE`', () => {
    const r = run(fixture({ workflows: lanes, guards: { 'assert-thing.mjs': "const CI = '.github/workflows/ci.yml';\n" } }));
    assert.equal(r.code, 0, r.out);
  });

  test('…but naming the gate does NOT buy silence for a real lane binding', () => {
    const both = "const CI = 'ci.yml';\nconst DEPLOY = 'e2e.yml';\n";
    const r = run(fixture({ workflows: lanes, guards: { 'assert-thing.mjs': both } }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /names exactly one workflow — e2e\.yml/);
  });

  test('a guard naming TWO lanes is covering two lanes and needs no declaration', () => {
    const two = "const A = 'e2e.yml';\nconst B = 'build-platforms.yml';\n";
    const r = run(fixture({ workflows: lanes, guards: { 'assert-thing.mjs': two } }));
    assert.equal(r.code, 0, r.out);
  });
});
