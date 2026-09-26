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
// Re-proven 2026-08-06 against the MATRIX lanes, in a `git archive HEAD` copy
// with `- apps/probe` appended to the workspace list:
//   · the matrix lanes exit 0 at two apps — the state the literal lanes could
//     not reach, and the first run in which limb A's `parameterised` branch was
//     ever taken by the real tree;
//   · restoring ONE `working-directory: apps/subscriptiontracker` beside the matrix makes
//     limb A′ exit 1 as MIXED — the case that used to be excused, because
//     `parameterised` returns ok before the equality is reached;
//   · deleting the `strategy.matrix` block from e2e.yml while leaving
//     `apps/${{ matrix.app }}` in place makes limb A′ exit 1 for an undeclared
//     dimension. That mutant is the exact "guard measuring a stand-in" this
//     refactor was warned about: GitHub expands the missing context to the empty
//     string, so the lane runs against `apps/` and reports success.
//
// Re-proven 2026-09-26 against THE GATE (O-CI-AND-WORKER-LANES-NAME-ONE-APP), on
// the real tree, NEW guard against the guard as it stood before (checked out in
// place, then restored and byte-compared):
//   · `--app subscriptiontracker` back in app-dryrun's Google Play dry run: NEW
//     exit 1 naming ci.yml and the line, OLD exit 0 — the gate was graded by nothing;
//   · `working-directory: services/subscriptiontracker-api` in lane-workers.yml's
//     `worker` job: NEW exit 1 naming lane-workers.yml, read as the gate's; OLD exit 0;
//   · `matrix.ap` in app-dryrun: NEW exit 1 (limb A′, per job), OLD exit 0;
//   · keeping the post-gate call jobs in the gate's view reds the real tree on
//     deploy-workers.yml's own literals, which are the service-kit row's
//     (O-SERVICE-KIT-UNBUILT): the post-gate line is load-bearing.
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
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(CI_DIR, '..', '..');
const GUARD = join(CI_DIR, 'assert-release-lane-generic.mjs');

let TMP;
before(() => { TMP = mkdtempSync(join(tmpdir(), 'nikatru-lane-')); });
after(() => { rmSync(TMP, { recursive: true, force: true }); });

let seq = 0;

// ─────────────────────────────────────────────────────────────────────────────
// 🔴 THE APP ID IS READ OFF THE DECLARATION, NEVER SPELLED INTO A FIXTURE.
//
// Every case in this file writes an app id into a synthetic workspace and then
// asserts that the guard NAMED that id. When both halves were literals they moved
// together under a global find-and-replace — which is what made the sweep of
// 2026-09-09 safe by accident, and what would have made a HALF-done sweep silent.
//
// It did not stay safe. `https://subly.nikatru.com` in the limb-D hostname case is
// a REAL retired host (a live DNS label with a zone Redirect Rule 301ing it), so
// the sweep could not touch it — while the assertion beside it was rewritten. The
// fixture then said one id and the assertion demanded another, and a control that
// exists to prove "the app id in a URL still counts" was asserting nothing about
// the id the tree actually carries.
//
// So the id is DERIVED, once, from `catalog/apps.json` — the published declaration
// — and every fixture body, every workspace entry and every expected message is
// built from it. A rename now moves all of them at once and can reach none of them
// by hand.
// ─────────────────────────────────────────────────────────────────────────────
const APP = (() => {
  const rows = JSON.parse(readFileSync(join(REPO, 'catalog', 'apps.json'), 'utf8'));
  const slugs = (Array.isArray(rows) ? rows : [])
    .map((r) => r?.slug)
    .filter((t) => typeof t === 'string' && t !== '');
  assert.ok(slugs.length > 0, 'catalog/apps.json declares no slug — this test can derive nothing');
  return slugs[0];
})();
/** The workspace path the id lives at — `apps/<id>`, the shape limb A grades. */
const APP_PATH = `apps/${APP}`;
/** Escape a derived value for use inside `new RegExp`. */
const rx = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Limb D's finding, for one workflow field. Built from the SAME `APP` the
 *  fixture writes, so the two can never be swept apart again. */
const literally = (field) =>
  new RegExp(`names the app id "${rx(APP)}" literally in \`${rx(field)}\``);


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

/** [10]D-2b's lane, in the shape the real one has: a matrix over the workspace,
 *  a wildcard path filter, and no app id in any field. Written as a DEFAULT
 *  every fixture carries — like `ci.yml` — because GRADED_LANES names it and a
 *  root without it is a COVERAGE LOST rather than a case. Individual limb-D
 *  tests override it. */
const DEPLOY_WEB = `name: Deploy Web
on:
  push:
    branches: [main]
    paths:
      - 'apps/**'
jobs:
  deploy-web:
    runs-on: ubuntu-24.04
    strategy:
      matrix:
        app: \${{ fromJSON(needs.prepare.outputs.apps) }}
    defaults:
      run:
        working-directory: apps/\${{ matrix.app }}
    steps:
      - run: flutter build web --release
      - uses: cloudflare/wrangler-action@0000000000000000000000000000000000000000
        with:
          command: pages deploy build/web --project-name=\${{ matrix.app }}
`;

/** The two lanes R-1 owns, plus whatever else a case needs. Every fixture root
 *  carries a `tooling/ci` so limb B has a corpus, and the real modules the guard
 *  imports are NOT copied — the guard is run from its own location, so its
 *  imports resolve against the real tree while the ROOT it grades is the
 *  fixture. */
function fixture({ workspace = [APP_PATH], workflows = {}, guards = {} } = {}) {
  const root = join(TMP, `f${seq++}`);
  mkdirSync(join(root, '.github', 'workflows'), { recursive: true });
  mkdirSync(join(root, 'tooling', 'ci'), { recursive: true });
  writeFileSync(
    join(root, 'pubspec.yaml'),
    `name: ws\nworkspace:\n${workspace.map((w) => `  - ${w}\n`).join('')}\ndev_dependencies:\n  melos: ^8.2.2\n`,
  );
  const all = { 'ci.yml': CI_YML, 'deploy-web.yml': DEPLOY_WEB, ...workflows };
  for (const [name, body] of Object.entries(all)) writeFileSync(join(root, '.github', 'workflows', name), body);
  writeFileSync(join(root, 'tooling', 'ci', 'assert-gate-passed.mjs'), GATE_STUB);
  for (const [name, body] of Object.entries(guards)) writeFileSync(join(root, 'tooling', 'ci', name), body);
  return root;
}

const run = (root) => {
  const r = spawnSync(process.execPath, [GUARD, root], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
};

const emit = (root) => {
  const r = spawnSync(process.execPath, [GUARD, '--emit-apps', root], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}`, stdout: r.stdout.trim() };
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

const E2E = platforms(literalLane(APP_PATH)).replace('Build all 6 platforms', 'E2E (live)');

describe('assert-release-lane-generic.mjs — limb A (the lanes cover the workspace)', () => {
  test('one app, both R-1 lanes name it: ok', () => {
    const r = run(fixture({ workflows: { 'build-platforms.yml': platforms(literalLane(APP_PATH)), 'e2e.yml': E2E } }));
    assert.equal(r.code, 0, r.out);
    // The owner tag is part of the line on purpose: three lanes are graded and
    // two stages own them, so a report that cannot say which requirement a lane
    // answers to routes its failures to the wrong person.
    assert.match(r.out, /build-platforms\.yml \(\[pipeline 9\]R-1\) — covers exactly the workspace app set/);
    assert.match(r.out, /e2e\.yml \(\[pipeline 9\]R-1\) — covers exactly the workspace app set/);
    assert.match(r.out, /deploy-web\.yml \(\[pipeline 10\]D-2b\)/);
  });

  // ⏱ 2026-09-24 · RC6 of O-GUARDS-READ-A-HAND-LISTED-APP-SET: tooling/ci/app-set.mjs
  // is the one reader of the app set, and a guard that parses `workspace:` itself
  // is the second reader limb A refuses.
  const SECOND_READER =
    "const text = readFileSync(join(ROOT, 'pubspec.yaml'), 'utf8');\n" +
    'const at = text.split(\'\\n\').findIndex((l) => /^workspace:\\s*$/.test(l));\n';
  const lanesA = { 'build-platforms.yml': platforms(literalLane(APP_PATH)), 'e2e.yml': E2E };

  test('RC6 · a guard that reads `workspace:` itself is a second reader, and fails naming it', () => {
    const r = run(fixture({ workflows: lanesA, guards: { 'assert-thing.mjs': SECOND_READER } }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /tooling\/ci\/assert-thing\.mjs reads the root pubspec `workspace:` block itself/);
  });

  test('…the same read inside a COMMENT is prose, not a reader', () => {
    const commented = SECOND_READER.split('\n').map((l) => (l ? `// ${l}` : l)).join('\n');
    const r = run(fixture({ workflows: lanesA, guards: { 'assert-thing.mjs': commented } }));
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /single reader — no new `workspace:` reader/);
  });

  test('THE RECORDED FAILING CASE — a second workspace app no lane covers', () => {
    const r = run(
      fixture({
        workspace: [APP_PATH, 'apps/second'],
        workflows: { 'build-platforms.yml': platforms(literalLane(APP_PATH)), 'e2e.yml': E2E },
      }),
    );
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, new RegExp(`build-platforms\\.yml covers \\{${rx(APP_PATH)}\\}.*MISSING apps/second`, 's'));
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
  APP: ${APP_PATH}
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
    assert.match(
      okRun.out,
      new RegExp(
        `build-platforms\\.yml \\(\\[pipeline 9\\]R-1\\) — covers exactly the workspace app set \\{${rx(APP_PATH)}\\}`,
      ),
    );

    const badRun = run(
      fixture({ workspace: [APP_PATH, 'apps/second'], workflows: { 'build-platforms.yml': hoisted, 'e2e.yml': E2E } }),
    );
    assert.equal(badRun.code, 1, badRun.out);
    assert.match(badRun.out, new RegExp(`build-platforms\\.yml covers \\{${rx(APP_PATH)}\\}`));
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
        app: [${APP}, second]
    steps:
      - name: Build web
        working-directory: apps/\${{ matrix.app }}
        run: flutter build web --release
`;
    const r = run(
      fixture({
        workspace: [APP_PATH, 'apps/second'],
        workflows: { 'build-platforms.yml': matrixed, 'e2e.yml': matrixed },
      }),
    );
    assert.equal(r.code, 0, r.out);
    assert.match(
      r.out,
      new RegExp(`covers exactly the workspace app set \\{apps/second, ${rx(APP_PATH)}\\}`),
    );
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
    const r = run(fixture({ workspace: [APP_PATH, 'apps/second'], workflows: { 'build-platforms.yml': called, 'e2e.yml': called } }));
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /the app segment of its paths is a run-time parameter/);
  });

  test('a comment naming the second app is NOT coverage', () => {
    // build-platforms.yml really does name `apps/subscriptiontracker/android/app/build.gradle.kts`
    // in prose. A raw text match would read a lane's own explanation as its
    // behaviour — the defect this repo has shipped twice.
    const commented = platforms(`      # also builds apps/second one day
${literalLane(APP_PATH)}`);
    const r = run(
      fixture({ workspace: [APP_PATH, 'apps/second'], workflows: { 'build-platforms.yml': commented, 'e2e.yml': E2E } }),
    );
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /MISSING apps\/second/);
  });

  test('a workflow no stage owns fails rather than being silently ungraded', () => {
    const r = run(
      fixture({
        workflows: { 'build-platforms.yml': platforms(literalLane(APP_PATH)), 'e2e.yml': E2E, 'mystery.yml': E2E },
      }),
    );
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /belong to no declared owner: mystery\.yml/);
  });

  test('COVERAGE LOST when the workspace holds no app at all', () => {
    const r = run(fixture({ workspace: ['packages/core'], workflows: { 'build-platforms.yml': platforms(literalLane(APP_PATH)), 'e2e.yml': E2E } }));
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /COVERAGE LOST.*no `workspace:` entry under apps\//s);
  });

  test('COVERAGE LOST when neither R-1 lane is present', () => {
    const r = run(fixture({ workflows: {} }));
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /COVERAGE LOST/);
  });
});

describe("assert-release-lane-generic.mjs — limb A′ (the parameter is real)", () => {
  /** A lane in the shape the real ones now have: a matrix whose VALUE is a
   *  run-time expression, and whose KEY is right there in the file. */
  const dynamicMatrix = `name: Build all 6 platforms
on:
  workflow_dispatch:
jobs:
  prepare:
    runs-on: ubuntu-24.04
    outputs:
      apps: \${{ steps.workspace.outputs.apps }}
    steps:
      - run: node tooling/ci/assert-release-lane-generic.mjs --emit-apps
  build:
    runs-on: ubuntu-24.04
    needs: prepare
    strategy:
      matrix:
        app: \${{ fromJSON(needs.prepare.outputs.apps) }}
    steps:
      - name: Build web
        working-directory: apps/\${{ matrix.app }}
        run: flutter build web --release
`;

  test('a matrix whose value is a run-time expression passes — the KEY is what must exist', () => {
    const r = run(
      fixture({
        workspace: [APP_PATH, 'apps/second'],
        workflows: { 'build-platforms.yml': dynamicMatrix, 'e2e.yml': dynamicMatrix },
      }),
    );
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /the app segment of its paths is a run-time parameter over a declared dimension/);
  });

  test('THE STAND-IN — `apps/${{ matrix.app }}` with no matrix declared anywhere fails', () => {
    // GitHub does not error on an undefined matrix context: it expands to the
    // empty string and the lane builds `apps/`. Before limb A′ this read as the
    // most generic lane in the tree.
    const bare = dynamicMatrix.replace(/    strategy:\n      matrix:\n        app: [^\n]*\n/, '');
    const r = run(
      fixture({ workspace: [APP_PATH, 'apps/second'], workflows: { 'build-platforms.yml': bare, 'e2e.yml': dynamicMatrix } }),
    );
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /build-platforms\.yml addresses its apps as .*but declares no `app:` key/);
  });

  test('MIXED — one literal path beside the matrix is not a generic lane', () => {
    const mixed = dynamicMatrix.replace(
      '        run: flutter build web --release\n',
      `        run: flutter build web --release\n      - name: Package\n        working-directory: ${APP_PATH}\n        run: dart run msix:create\n`,
    );
    const r = run(
      fixture({ workspace: [APP_PATH, 'apps/second'], workflows: { 'build-platforms.yml': mixed, 'e2e.yml': dynamicMatrix } }),
    );
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, new RegExp(`build-platforms\\.yml is MIXED.*${rx(APP_PATH)}`, 's'));
  });

  test('--emit-apps prints the workspace app IDS, which is what a matrix iterates', () => {
    const r = emit(fixture({ workspace: ['packages/core', APP_PATH, 'apps/second'] }));
    assert.equal(r.code, 0, r.out);
    assert.deepEqual(JSON.parse(r.stdout), [APP, 'second']);
  });

  test('--emit-apps REFUSES an empty set rather than emitting `[]`', () => {
    // A `matrix: []` runs zero jobs and the workflow reports success. Emitting
    // one would put the green-over-nothing shape into the lane itself.
    const r = emit(fixture({ workspace: ['packages/core'] }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /declares no `workspace:` entry under apps\//);
  });

  test('the emitter and the grader read ONE workspace — the ids round-trip to the paths limb A expects', () => {
    const root = fixture({
      workspace: [APP_PATH, 'apps/second'],
      workflows: { 'build-platforms.yml': dynamicMatrix, 'e2e.yml': dynamicMatrix },
    });
    const ids = JSON.parse(emit(root).stdout);
    const graded = run(root);
    for (const id of ids) assert.match(graded.out, new RegExp(`apps/${id}`));
  });
});

// ⏱ 2026-09-25 — O-TAG-BUILDS-EVERY-APP. build-platforms.yml's `prepare` built its
// matrix from `--emit-apps` alone, so a tag for ONE app built and staged EVERY app,
// each renamed after that one tag. On a tag ref it now passes `--tag`, and the
// matrix is the app the tag names. Measured on BASE a9bb8ef0 with the two-app
// workspace below: `--emit-apps <root> --tag <APP>-v1.0.0` printed
// `["<APP>","second"]` and exited 0, and so did `second-v1.0.0`, `nosuch-v1.0.0`
// and `garbage` (--tag was never read). `--emit-apps --tag <t> <root>` exited 1,
// because `--tag` itself was read as the root.
describe('assert-release-lane-generic.mjs — `--emit-apps --tag` (a tag builds its own app)', () => {
  const emitWith = (...args) => {
    const r = spawnSync(process.execPath, [GUARD, ...args], { encoding: 'utf8' });
    return { code: r.status, out: `${r.stdout}${r.stderr}`, stdout: r.stdout.trim() };
  };
  const twoApps = () => fixture({ workspace: ['packages/core', APP_PATH, 'apps/second'] });

  test('R1 · the first app\'s tag emits that app alone', () => {
    const r = emitWith('--emit-apps', twoApps(), '--tag', `${APP}-v1.0.0`);
    assert.equal(r.code, 0, r.out);
    assert.deepEqual(JSON.parse(r.stdout), [APP]);
  });

  test('R2 · the second app\'s tag emits the second app alone', () => {
    const r = emitWith('--emit-apps', twoApps(), '--tag', 'second-v1.0.0');
    assert.equal(r.code, 0, r.out);
    assert.deepEqual(JSON.parse(r.stdout), ['second']);
  });

  test('R3 · no --tag, which is every run that is not a tag push, emits the whole set', () => {
    const r = emitWith('--emit-apps', twoApps());
    assert.equal(r.code, 0, r.out);
    assert.deepEqual(JSON.parse(r.stdout), [APP, 'second']);
  });

  test('R4 · a tag naming no workspace app exits 1 and names the ids the workspace declares', () => {
    const r = emitWith('--emit-apps', twoApps(), '--tag', 'nosuch-v1.0.0');
    assert.equal(r.code, 1, r.out);
    assert.equal(r.stdout, '', 'a refused tag prints no matrix');
    assert.match(r.out, new RegExp(`the tag names app "nosuch", and the workspace declares ${rx(APP)}, second`));
  });

  test('R4 · a tag with no -v<version> names no app and exits 1', () => {
    const r = emitWith('--emit-apps', twoApps(), '--tag', 'garbage');
    assert.equal(r.code, 1, r.out);
    assert.equal(r.stdout, '', 'a refused tag prints no matrix');
    assert.match(r.out, /"garbage" is not <app>-v<version>, so it names no app to build/);
  });

  test('--tag before the root parses the same as after it', () => {
    const r = emitWith('--emit-apps', '--tag', 'second-v1.0.0', twoApps());
    assert.equal(r.code, 0, r.out);
    assert.deepEqual(JSON.parse(r.stdout), ['second']);
  });

  test('--tag with no value is refused, never read as "no tag"', () => {
    const r = emitWith('--emit-apps', twoApps(), '--tag');
    assert.equal(r.code, 1, r.out);
    assert.equal(r.stdout, '', 'a refused tag prints no matrix');
    assert.match(r.out, /--emit-apps --tag was passed with no value/);
  });

  test('--tag without --emit-apps is refused, never dropped while the grader runs', () => {
    const r = emitWith('--tag', `${APP}-v1.0.0`, twoApps());
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /--tag narrows --emit-apps and nothing else/);
  });

  test('a tag still meets the whole-set refusal first: an empty workspace emits nothing', () => {
    const r = emitWith('--emit-apps', fixture({ workspace: ['packages/core'] }), '--tag', `${APP}-v1.0.0`);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /declares no `workspace:` entry under apps\//);
  });
});

describe('assert-release-lane-generic.mjs — limb D (no literal app id on the deploy path)', () => {
  const R1 = { 'build-platforms.yml': platforms(literalLane(APP_PATH)), 'e2e.yml': E2E };
  const deployWeb = (field) => DEPLOY_WEB.replace('- run: flutter build web --release', field);

  test('the generic deploy lane passes and the report says how much it read', () => {
    const r = run(fixture({ workflows: R1 }));
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /deploy-web\.yml \(\[pipeline 10\]D-2b\).*deploy-path field\(s\) name no app id/);
  });

  test('THE RECORDED FAILING CASE — a literal app id in `working-directory`', () => {
    const r = run(fixture({ workflows: { ...R1, 'deploy-web.yml': DEPLOY_WEB.replace('apps/${{ matrix.app }}', APP_PATH) } }));
    assert.equal(r.code, 1, r.out);
    assert.match(
      r.out,
      new RegExp(`\\[pipeline 10\\]D-2b · deploy-web\\.yml:\\d+ ${literally('working-directory').source}`),
    );
  });

  test('…in a step `run:` — the field limbs A/A′ are blind to', () => {
    // `record-deployment.mjs <id>-web` carries no `apps/` prefix at all, so
    // the app-path limbs resolve it to NOTHING and report the lane generic.
    const r = run(fixture({ workflows: { ...R1, 'deploy-web.yml': deployWeb(`- run: node tooling/ci/record-deployment.mjs ${APP}-web`) } }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, literally('run'));
  });

  test('…in a `with:` value — `--project-name=<id>`', () => {
    const r = run(
      fixture({
        workflows: {
          ...R1,
          'deploy-web.yml': DEPLOY_WEB.replace('--project-name=${{ matrix.app }}', `--project-name=${APP}`),
        },
      }),
    );
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, literally('with.command'));
  });

  test('…and in the `paths:` filter, which is the one field a matrix cannot reach', () => {
    const r = run(fixture({ workflows: { ...R1, 'deploy-web.yml': DEPLOY_WEB.replace("- 'apps/**'", `- '${APP_PATH}/**'`) } }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, literally('paths'));
  });

  test('the hostname counts — the app id in a URL is still the app id', () => {
    // ⚠️ THE HOST IS BUILT FROM `APP`, NOT SPELLED. It used to read
    // `https://subly.nikatru.com` — which is a REAL retired host, so the rename
    // sweep correctly left it alone and incorrectly rewrote the assertion beside
    // it. What this case is about is a HYPOTHETICAL url that happens to carry the
    // CURRENT app id as a DNS label, so the label is derived like everything else.
    const r = run(
      fixture({
        workflows: {
          ...R1,
          'deploy-web.yml': deployWeb(`- run: node smoke.mjs --url https://${APP}.nikatru.com/version.json`),
        },
      }),
    );
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, literally('run'));
  });

  test('the `env:` hoist does not launder it either', () => {
    const hoisted = DEPLOY_WEB.replace(
      'jobs:',
      `env:\n  APP: ${APP}\njobs:`,
    ).replace('- run: flutter build web --release', '- run: node deploy.mjs --project ${{ env.APP }}');
    const r = run(fixture({ workflows: { ...R1, 'deploy-web.yml': hoisted } }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, literally('run'));
  });

  test('a SUBSTRING of an app id is not the app id — no false red on `re<id>x`', () => {
    const r = run(
      fixture({
        workflows: { ...R1, 'deploy-web.yml': deployWeb(`- run: node tool.mjs --flag re${APP}x`) },
      }),
    );
    assert.equal(r.code, 0, r.out);
  });

  test('R-1\'s own lanes are NOT held to limb D — the literal-equality shape is their criterion', () => {
    // build-platforms.yml and e2e.yml name apps/subscriptiontracker literally and pass. Limb D
    // would overturn limb A's decided design from inside this file.
    const r = run(fixture({ workflows: R1 }));
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /build-platforms\.yml \(\[pipeline 9\]R-1\) — covers exactly the workspace app set/);
  });
});

// ⏱ 2026-09-25 — O-E2E-LANE-WIRED-TO-ONE-APP. Limb D-all reads EVERY graded lane,
// whatever `deployPath` says, and refuses an env key or output name that names an
// app, and a UUID literal. Measured on BASE 779f2e1f with the three real-tree
// mutations RC1-RC3 (the closes' control is RC1): each exited 0 there, because
// limb D reads the deploy path only and its `idToken` is case-sensitive.
//
// Every UUID below is SYNTHETIC. The app-named key is BUILT from `APP`, like every
// other fixture in this file, so no real key or id is spelled here.
describe('assert-release-lane-generic.mjs — limb D-all (every graded lane: no app-named key, no UUID literal)', () => {
  const SYN_UUID = '00000000-0000-4000-8000-0000000000b2';
  const SYN_UUID_UPPER = '0000ABCD-0000-4000-8000-0000000000B2';
  /** The key e2e.yml carried before the resolver: the app id upper-cased, then `_D1_DATABASE_ID`. */
  const APP_KEY = `${APP.toUpperCase().replace(/-/g, '_')}_D1_DATABASE_ID`;
  const R1 = { 'build-platforms.yml': platforms(literalLane(APP_PATH)), 'e2e.yml': E2E };
  /** 1-based line of the first line of `body` holding `needle`; fails the case when absent. */
  const lineOf = (body, needle) => {
    const n = body.split('\n').findIndex((l) => l.includes(needle)) + 1;
    assert.ok(n > 0, `fixture anchor absent: ${needle}`);
    return n;
  };
  const keyHit = (file, n, key, id = APP) =>
    new RegExp(`${rx(file)}:${n} — limb D-all: the [^\\n]*\`${rx(key)}\` names the app "${rx(id)}"`);
  const uuidHit = (file, n, field) => new RegExp(`${rx(file)}:${n} — limb D-all: a UUID literal in \`${rx(field)}\``);
  /** e2e.yml with one verify step whose `env:` ends with `extra`. */
  const e2eWith = (extra) => `name: E2E (live)
on:
  workflow_dispatch:
jobs:
  e2e:
    runs-on: ubuntu-24.04
    steps:
      - name: Build web
        working-directory: ${APP_PATH}
        run: flutter build web --release
      - name: Verify the in-app deletion really purged (leg 6)
        env:
          E2E_APP_ID: ${APP}
${extra}        run: node tooling/e2e/verify_purged.mjs
`;
  /** build-platforms.yml with `steps` appended after the literal build step. */
  const platformsWith = (steps) => platforms(`${literalLane(APP_PATH)}${steps}`);

  test('every graded lane is read, deploy path or not, and the report says how much', () => {
    const r = run(fixture({ workflows: R1 }));
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /build-platforms\.yml \(\[pipeline 9\]R-1\) — limb D-all: \d+ env\/output key\(s\) name no app and \d+ run\/with\/env value\(s\) carry no UUID literal/);
    assert.match(r.out, /e2e\.yml \(\[pipeline 9\]R-1\) — limb D-all: /);
    assert.match(r.out, /deploy-web\.yml \(\[pipeline 10\]D-2b\) — limb D-all: /);
    assert.match(r.out, /limb D-all read \d+ key\(s\) and \d+ value\(s\) across 3 lane\(s\)/);
  });

  test('RC1 · THE CLOSES\' CONTROL — the app-named key with a UUID, back in e2e.yml, fails naming both hits', () => {
    const body = e2eWith(`          ${APP_KEY}: ${SYN_UUID}\n`);
    const n = lineOf(body, APP_KEY);
    const r = run(fixture({ workflows: { ...R1, 'e2e.yml': body } }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, keyHit('e2e.yml', n, APP_KEY));
    assert.match(r.out, uuidHit('e2e.yml', n, `env.${APP_KEY}`));
    assert.ok(!r.out.includes(SYN_UUID), 'a finding names the field, never the id it refuses');
  });

  test('RC2 · a lower-case app-named env key in build-platforms.yml fails, with no UUID in sight', () => {
    const key = `${APP}_db`;
    const body = platformsWith(`      - name: Read the database\n        env:\n          ${key}: x\n        run: echo read\n`);
    const r = run(fixture({ workflows: { ...R1, 'build-platforms.yml': body } }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, keyHit('build-platforms.yml', lineOf(body, key), key));
    assert.doesNotMatch(r.out, /a UUID literal/);
  });

  test('RC3 · a UUID literal in a deploy-web.yml `env:` value fails — a field limb D never read', () => {
    const body = DEPLOY_WEB.replace(
      '      - run: flutter build web --release\n',
      `      - name: Build\n        env:\n          WEB_DB_ID: ${SYN_UUID}\n        run: flutter build web --release\n`,
    );
    const r = run(fixture({ workflows: { ...R1, 'deploy-web.yml': body } }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, uuidHit('deploy-web.yml', lineOf(body, 'WEB_DB_ID'), 'env.WEB_DB_ID'));
    assert.doesNotMatch(r.out, /names the app/);
  });

  test('…a UUID literal in a `run:` line of a lane that is not a deploy path', () => {
    const body = platformsWith(`      - run: node tooling/tool.mjs --database ${SYN_UUID}\n`);
    const r = run(fixture({ workflows: { ...R1, 'build-platforms.yml': body } }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, uuidHit('build-platforms.yml', lineOf(body, '--database'), 'run'));
  });

  test('…an UPPER-CASE UUID in a `with:` value', () => {
    const body = e2eWith('').replace(
      '        run: node tooling/e2e/verify_purged.mjs\n',
      `        run: node tooling/e2e/verify_purged.mjs\n      - uses: some/action@0123456789abcdef0123456789abcdef01234567\n        with:\n          database: ${SYN_UUID_UPPER}\n`,
    );
    const r = run(fixture({ workflows: { ...R1, 'e2e.yml': body } }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, uuidHit('e2e.yml', lineOf(body, 'database:'), 'with.database'));
  });

  test('…a UUID hoisted into workflow `env:` is refused where it sits AND where a `run:` expands it', () => {
    const body = platformsWith('      - run: node tooling/tool.mjs --database ${{ env.DB }}\n').replace(
      'jobs:',
      `env:\n  DB: ${SYN_UUID}\njobs:`,
    );
    const r = run(fixture({ workflows: { ...R1, 'build-platforms.yml': body } }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, uuidHit('build-platforms.yml', lineOf(body, '  DB: '), 'env.DB'));
    assert.match(r.out, uuidHit('build-platforms.yml', lineOf(body, '--database'), 'run'));
  });

  test('…a step whose FIRST key is `env:` (`- env:`) is read', () => {
    const key = `${APP.toUpperCase()}_TOKEN`;
    const body = platformsWith(`      - env:\n          ${key}: x\n        run: echo read\n`);
    const r = run(fixture({ workflows: { ...R1, 'build-platforms.yml': body } }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, keyHit('build-platforms.yml', lineOf(body, key), key));
  });

  test('…the one-line flow form `env: { … }` is read', () => {
    const key = `${APP.toUpperCase()}_URL`;
    const body = platformsWith(`      - name: Flow\n        env: { ${key}: x, OTHER: y }\n        run: echo read\n`);
    const r = run(fixture({ workflows: { ...R1, 'build-platforms.yml': body } }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, keyHit('build-platforms.yml', lineOf(body, key), key));
  });

  test('an app-named OUTPUT name fails where it is declared, written and read', () => {
    const out = `${APP}_db`;
    const body = `name: E2E (live)
on:
  workflow_dispatch:
jobs:
  e2e:
    runs-on: ubuntu-24.04
    outputs:
      ${out}: \${{ steps.backend.outputs.${out} }}
    steps:
      - name: Build web
        working-directory: ${APP_PATH}
        run: flutter build web --release
      - name: Resolve
        id: backend
        run: echo "${out}=1" >> "$GITHUB_OUTPUT"
`;
    const r = run(fixture({ workflows: { ...R1, 'e2e.yml': body } }));
    assert.equal(r.code, 1, r.out);
    const declared = lineOf(body, `      ${out}: `);
    assert.match(r.out, new RegExp(`e2e\\.yml:${declared} — limb D-all: the output name \\(outputs\\) \`${rx(out)}\``));
    assert.match(r.out, new RegExp(`e2e\\.yml:${declared} — limb D-all: the output name \\(output reference\\) \`${rx(out)}\``));
    assert.match(r.out, new RegExp(`e2e\\.yml:${lineOf(body, 'GITHUB_OUTPUT')} — limb D-all: the output name \\(\\$GITHUB_OUTPUT\\) \`${rx(out)}\``));
  });

  test('a hyphenated app id is matched as its whole run of tokens', () => {
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
    const body = `${called}      - name: Token\n        env:\n          SECOND_APP_TOKEN: x\n        run: echo read\n`;
    const r = run(
      fixture({ workspace: [APP_PATH, 'apps/second-app'], workflows: { 'build-platforms.yml': body, 'e2e.yml': called } }),
    );
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, keyHit('build-platforms.yml', lineOf(body, 'SECOND_APP_TOKEN'), 'SECOND_APP_TOKEN', 'second-app'));
  });

  test('NO FALSE RED on keys — a substring of the id, `E2E_APP_ID`, and the app id as a VALUE all pass', () => {
    const body = platformsWith(
      `      - name: Keys\n        env:\n          RE${APP.toUpperCase()}X_DB: x\n          E2E_APP_ID: ${APP}\n        run: echo read\n`,
    );
    const r = run(fixture({ workflows: { ...R1, 'build-platforms.yml': body } }));
    assert.equal(r.code, 0, r.out);
  });

  test('NO FALSE RED on UUIDs — a COMMENT, a 40-hex commit sha in `run:` and a longer hex run all pass', () => {
    const body = platformsWith(
      `      # the old database was ${SYN_UUID}\n` +
        '      - run: git checkout 0123456789abcdef0123456789abcdef01234567\n' +
        `      - run: echo f${SYN_UUID}\n`,
    );
    const r = run(fixture({ workflows: { ...R1, 'build-platforms.yml': body } }));
    assert.equal(r.code, 0, r.out);
  });

  test('COVERAGE LOST — a graded lane limb D-all reads no value from', () => {
    const bare = `name: E2E (live)
on:
  workflow_dispatch:
jobs:
  e2e:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@0123456789abcdef0123456789abcdef01234567
`;
    const r = run(fixture({ workflows: { ...R1, 'e2e.yml': bare } }));
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /COVERAGE LOST — limb D-all read ZERO values from e2e\.yml, a graded lane/);
  });
});

// ⏱ 2026-09-26 — O-CI-AND-WORKER-LANES-NAME-ONE-APP (the ci.yml half). The gate is
// graded under limbs D, D-all and A′, read with the callees its constituents run.
// RC1-RC3 are the closes' controls; the real-tree mutations are in the PR text.
describe('assert-release-lane-generic.mjs — the gate (limbs D, D-all and A′ over ci.yml and its callees)', () => {
  const SYN_UUID = '00000000-0000-4000-8000-0000000000c3';
  const R1 = { 'build-platforms.yml': platforms(literalLane(APP_PATH)), 'e2e.yml': E2E };
  /** 1-based line of the first line of `body` holding `needle`; fails the case when absent. */
  const lineOf = (body, needle) => {
    const n = body.split('\n').findIndex((l) => l.includes(needle)) + 1;
    assert.ok(n > 0, `fixture anchor absent: ${needle}`);
    return n;
  };
  const WF = '.github/workflows';
  /** The gate in the shape the real one has: prepare's app set, a dry-run matrix over it,
   *  a call to the Workers lane, and a post-gate deploy call. `dryRun` is the matrix job's `run:`. */
  const gate = ({ dryRun = 'node tooling/release/submit-play.mjs --dry-run --app ${{ matrix.app }} --allow-missing-artifact', extraStep = '', deployIf = "    if: github.event_name == 'push' && github.ref == 'refs/heads/main'\n", deployNeededByGate = false } = {}) => `name: CI
on:
  push:
    branches: [main]
jobs:
  lane-workers:
    uses: ./.github/workflows/lane-workers.yml
  prepare:
    runs-on: ubuntu-24.04
    outputs:
      apps: \${{ steps.workspace.outputs.apps }}
    steps:
      - id: workspace
        run: echo "apps=[]" >> "$GITHUB_OUTPUT"
  app-dryrun:
    needs: prepare
    runs-on: ubuntu-24.04
    strategy:
      fail-fast: false
      matrix:
        app: \${{ fromJSON(needs.prepare.outputs.apps) }}
    steps:
      - name: The Google Play submission path still walks (dry run)
        run: ${dryRun}
${extraStep}  ci-gate:
    name: ci-gate
    needs: [lane-workers, prepare, app-dryrun${deployNeededByGate ? ', deploy-workers' : ''}]
    if: always()
    runs-on: ubuntu-24.04
    steps:
      - run: echo gate
  deploy-workers:
${deployNeededByGate ? '' : '    needs: [ci-gate]\n'}${deployIf}    uses: ./.github/workflows/deploy-workers.yml
`;
  /** The Workers lane callee: detect emits the set, one matrix job runs each Worker. */
  const laneWorkers = (workDir = 'services/${{ matrix.worker }}', extra = '') => `name: Lane — workers
on:
  workflow_call:
jobs:
  detect:
    runs-on: ubuntu-24.04
    outputs:
      workers: \${{ steps.workers.outputs.workers }}
    steps:
      - id: workers
        run: echo "workers=[]" >> "$GITHUB_OUTPUT"
  worker:
    needs: detect
    runs-on: ubuntu-24.04
    strategy:
      matrix:
        worker: \${{ fromJSON(needs.detect.outputs.workers) }}
    defaults:
      run:
        working-directory: ${workDir}
    steps:
      - run: npm test
${extra}`;
  /** The post-gate Workers deploy: it names app #1's Worker directory, the service-kit row's literal. */
  const DEPLOY_WORKERS = `name: Deploy Workers
on:
  workflow_call:
jobs:
  api:
    runs-on: ubuntu-24.04
    defaults:
      run:
        working-directory: services/${APP}-api
    steps:
      - run: npx wrangler deploy
`;
  const gateTree = ({ ci = gate(), lane = laneWorkers(), deploy = DEPLOY_WORKERS } = {}) =>
    fixture({ workflows: { ...R1, 'ci.yml': ci, 'lane-workers.yml': lane, 'deploy-workers.yml': deploy } });

  test('the gate in its generic shape passes, and the report names its callee and the post-gate job it left out', () => {
    const r = run(gateTree());
    assert.equal(r.code, 0, r.out);
    // lane-workers, lane-workers/detect, lane-workers/worker, prepare, app-dryrun, ci-gate:
    // deploy-workers and its callee job are post-gate and are not among them.
    assert.match(r.out, /ci\.yml \(the gate\) — 6 job\(s\), 2 of them from 1 callee\(s\) \(lane-workers\.yml\): \d+ run\/with\/working-directory\/paths field\(s\) name no app id/);
    assert.match(r.out, /Post-gate, not read here: deploy-workers/);
    assert.match(r.out, /lane-workers\.yml — resolves to \(none\); owned by another stage: not graded by limb A, and read below as the gate's callee/);
  });

  test("RC1 · THE CLOSES' CONTROL — `--app <id>` back in the gate's dry run fails, naming ci.yml and the line", () => {
    const ci = gate({ dryRun: `node tooling/release/submit-play.mjs --dry-run --app ${APP} --allow-missing-artifact` });
    const r = run(gateTree({ ci }));
    assert.equal(r.code, 1, r.out);
    const n = lineOf(ci, `--app ${APP}`);
    assert.match(r.out, new RegExp(`the gate · ${rx(WF)}/ci\\.yml:${n} names the app id "${rx(APP)}" literally in \`run\``));
  });

  test("RC2 · a Worker directory written into the Workers lane callee fails as the gate's, naming lane-workers.yml", () => {
    const lane = laneWorkers(`services/${APP}-api`);
    const r = run(gateTree({ lane }));
    assert.equal(r.code, 1, r.out);
    const n = lineOf(lane, `services/${APP}-api`);
    assert.match(r.out, new RegExp(`the gate · ${rx(WF)}/lane-workers\\.yml:${n} names the app id "${rx(APP)}" literally in \`working-directory\``));
  });

  test("…and the same directory hoisted to the callee's OWN workflow-level `defaults:` or `env:` fails too — the callee's head is the gate's", () => {
    const hoisted = laneWorkers().replace('jobs:\n', `defaults:\n  run:\n    working-directory: services/${APP}-api\njobs:\n`);
    const r = run(gateTree({ lane: hoisted }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, new RegExp(`the gate · ${rx(WF)}/lane-workers\\.yml:${lineOf(hoisted, `services/${APP}-api`)} names the app id "${rx(APP)}" literally in \`working-directory\``));
    const viaEnv = laneWorkers('${{ env.WORKER_DIR }}').replace('jobs:\n', `env:\n  WORKER_DIR: services/${APP}-api\njobs:\n`);
    const r2 = run(gateTree({ lane: viaEnv }));
    assert.equal(r2.code, 1, r2.out);
    assert.match(r2.out, new RegExp(`the gate · ${rx(WF)}/lane-workers\\.yml:${lineOf(viaEnv, 'env.WORKER_DIR')} names the app id "${rx(APP)}" literally in \`working-directory\``));
  });

  test('RC3 · a matrix key the job never declared (`matrix.ap`) fails limb A′, naming the job and what it declares', () => {
    const ci = gate({ dryRun: 'node tooling/release/submit-play.mjs --dry-run --app ${{ matrix.ap }} --allow-missing-artifact' });
    const r = run(gateTree({ ci }));
    assert.equal(r.code, 1, r.out);
    const n = lineOf(ci, 'matrix.ap }}');
    assert.match(r.out, new RegExp(`the gate · ${rx(WF)}/ci\\.yml:${n} — job "app-dryrun" reads \`matrix\\.ap\` and its strategy\\.matrix declares app\\.`));
  });

  test('…and an `if:` is read too — it is an expression with or without the braces, so `matrix.os` there must be declared', () => {
    const extraStep = "  other:\n    runs-on: ubuntu-24.04\n    steps:\n      - if: matrix.os == 'windows-2022'\n        run: echo windows\n";
    const ci = gate({ extraStep }).replace('needs: [lane-workers, prepare, app-dryrun]', 'needs: [lane-workers, prepare, app-dryrun, other]');
    const r = run(gateTree({ ci }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, new RegExp(`the gate · ${rx(WF)}/ci\\.yml:${lineOf(ci, 'matrix.os')} — job "other" reads \`matrix\\.os\` and its strategy\\.matrix declares no key`));
  });

  test('…and a key declared by ANOTHER job is still undeclared here — GitHub scopes a matrix to its job', () => {
    const extraStep = '  other:\n    runs-on: ubuntu-24.04\n    steps:\n      - run: echo ${{ matrix.app }}\n';
    const ci = gate({ extraStep }).replace('needs: [lane-workers, prepare, app-dryrun]', 'needs: [lane-workers, prepare, app-dryrun, other]');
    const r = run(gateTree({ ci }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /job "other" reads `matrix\.app` and its strategy\.matrix declares no key/);
  });

  test('THE POST-GATE LINE IS A CLASS, NOT A FILENAME — the same deploy call as a gate constituent is read, and fails', () => {
    const ci = gate({ deployIf: '', deployNeededByGate: true });
    const r = run(gateTree({ ci }));
    assert.equal(r.code, 1, r.out);
    const n = lineOf(DEPLOY_WORKERS, `services/${APP}-api`);
    assert.match(r.out, new RegExp(`the gate · ${rx(WF)}/deploy-workers\\.yml:${n} names the app id "${rx(APP)}" literally in \`working-directory\``));
  });

  test('limb D-all over the gate — an app-named env key in ci.yml and a UUID in the callee both fail, and no id is printed', () => {
    const key = `${APP.toUpperCase().replace(/-/g, '_')}_DB`;
    const ci = gate({ extraStep: '' }).replace(
      '      - run: echo gate\n',
      `      - run: echo gate\n      - name: Read\n        env:\n          ${key}: x\n        run: echo read\n`,
    );
    const lane = laneWorkers(undefined, `      - run: npx wrangler d1 execute --database-id ${SYN_UUID}\n`);
    const r = run(gateTree({ ci, lane }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, new RegExp(`the gate · ${rx(WF)}/ci\\.yml:${lineOf(ci, key)} — limb D-all: the env key \`${rx(key)}\` names the app "${rx(APP)}"`));
    assert.match(r.out, new RegExp(`the gate · ${rx(WF)}/lane-workers\\.yml:${lineOf(lane, SYN_UUID)} — limb D-all: a UUID literal in \`run\``));
    assert.ok(!r.out.includes(SYN_UUID), 'a finding names the field, never the id it refuses');
  });

  test('a composite action the gate runs is read as the gate: `--app <id>` inside it fails, naming action.yml', () => {
    const ci = gate({ extraStep: '' }).replace('      - run: echo gate\n', '      - uses: ./.github/actions/walk\n      - run: echo gate\n');
    const root = gateTree({ ci });
    const action = `name: walk
runs:
  using: composite
  steps:
    - shell: bash
      run: node tooling/release/submit-snap.mjs --dry-run --app ${APP}
`;
    mkdirSync(join(root, '.github', 'actions', 'walk'), { recursive: true });
    writeFileSync(join(root, '.github', 'actions', 'walk', 'action.yml'), action);
    const r = run(root);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, new RegExp(`the gate · \\.github/actions/walk/action\\.yml:${lineOf(action, `--app ${APP}`)} names the app id "${rx(APP)}" literally in \`run\``));
  });

  test('NO FALSE RED — a comment naming the app, a declared key in an `if:`, `matrix.json` in a shell line and a longer word all pass', () => {
    const extraStep = [
      '  shape:',
      '    runs-on: ubuntu-24.04',
      '    strategy:',
      '      matrix:',
      '        os: [ubuntu-24.04]',
      '        include:',
      '          - flavour: plain',
      '    steps:',
      `      # --app ${APP} is how the old step read`,
      "      - if: matrix.os == 'ubuntu-24.04' && matrix.flavour == 'plain'",
      '        run: cat matrix.json',
      `      - run: echo re${APP}x`,
      '',
    ].join('\n');
    const ci = gate({ extraStep }).replace('needs: [lane-workers, prepare, app-dryrun]', 'needs: [lane-workers, prepare, app-dryrun, shape]');
    const r = run(gateTree({ ci }));
    assert.equal(r.code, 0, r.out);
  });

  test('COVERAGE LOST — the gate calls a workflow that is not in the tree', () => {
    const ci = gate().replace('uses: ./.github/workflows/lane-workers.yml', 'uses: ./.github/workflows/lane-gone.yml');
    const r = run(gateTree({ ci }));
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /COVERAGE LOST — workflow-scan could not resolve a local reference \(missing\)/);
  });

  test('COVERAGE LOST — a job reads a matrix key and its matrix is one expression, so its keys cannot be read', () => {
    const ci = gate().replace(
      '      matrix:\n        app: ${{ fromJSON(needs.prepare.outputs.apps) }}\n',
      '      matrix: ${{ fromJSON(needs.prepare.outputs.matrix) }}\n',
    );
    const r = run(gateTree({ ci }));
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /COVERAGE LOST — the gate's job "app-dryrun" reads `matrix\.app` \(.*ci\.yml:\d+\), and its matrix is ONE expression/);
  });

  test('COVERAGE LOST — a gate with no run, with or env value anywhere reads as nothing, never as clean', () => {
    const bare = `name: CI
on:
  push:
    branches: [main]
jobs:
  ci-gate:
    name: ci-gate
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@0123456789abcdef0123456789abcdef01234567
`;
    const r = run(fixture({ workflows: { ...R1, 'ci.yml': bare } }));
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /COVERAGE LOST — limb D-all read ZERO values from the gate \(\.github\/workflows\/ci\.yml\) and its callees/);
  });
});

describe('assert-release-lane-generic.mjs — limb B (no guard hides a lane)', () => {
  const lanes = { 'build-platforms.yml': platforms(literalLane(APP_PATH)), 'e2e.yml': E2E };

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
    // deploy-web.yml is a fixture DEFAULT now that GRADED_LANES names it, so
    // the case no longer supplies one. It used to override it with a literal
    // lane, which limb D correctly fails — and a limb-B case failing on limb D
    // proves nothing about limb B.
    const commented = '// this used to read deploy-web.yml and no longer does\nconst X = 1;\n';
    const r = run(fixture({ workflows: lanes, guards: { 'assert-thing.mjs': commented } }));
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
