// ─────────────────────────────────────────────────────────────────────────────
// deploy-triggers.test.mjs — assert-deploy-triggers.mjs must be able to FAIL.
//
// The guard exists because deploy-web.yml's `paths:` listed the SOURCE and not
// the DEPENDENCIES (2026-08-01 full-corpus review, #30), so a lockfile-only bump
// built differently on main and deployed nothing, silently.
//
// ⚠️ THE REAL TREE IS THE FIRST NEGATIVE TEST, not these fixtures. Reverting
// .github/workflows/deploy-web.yml to its pre-fix `paths:` list makes the guard
// exit 1 naming pubspec.yaml, pubspec.lock and tooling/versions.json; restoring
// it returns "ok 1 path-filtered Flutter lane(s)". A fixture I wrote encodes the
// same misunderstanding as the guard I wrote, so it can only ever be the second
// line of evidence.
//
// The cases below cover what the real tree cannot show without breaking it: the
// comment bypass, the `!`-negation bypass, `paths-ignore:`, the non-Flutter lane
// that is deliberately out of scope, and the guard grading an empty set.
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

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GUARD = join(CI_DIR, 'assert-deploy-triggers.mjs');

let TMP;
before(() => {
  TMP = mkdtempSync(join(tmpdir(), 'nikatru-triggers-'));
});
after(() => {
  rmSync(TMP, { recursive: true, force: true });
});

let seq = 0;

/** A repo root holding `.github/workflows/<name>` for each entry. */
function fixture(workflows) {
  const root = join(TMP, `f${seq++}`);
  mkdirSync(join(root, '.github', 'workflows'), { recursive: true });
  for (const [name, body] of Object.entries(workflows)) {
    writeFileSync(join(root, '.github', 'workflows', name), body);
  }
  return root;
}

function run(root) {
  const r = spawnSync(process.execPath, [GUARD, root], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

/** The shape deploy-web.yml really has: a path-filtered push that builds web. */
const lane = (paths, { extra = '', dispatchOnly = false } = {}) => `name: Deploy Web
on:
${dispatchOnly ? '  workflow_dispatch:\n' : `  push:
    branches: [main]
${paths}`}
${extra}
permissions:
  contents: read

jobs:
  deploy-web:
    runs-on: ubuntu-24.04
    steps:
      - run: flutter pub get --enforce-lockfile
      - run: flutter build web --release
`;

const ALL_PATHS = `    paths:
      - 'apps/subly/**'
      - 'packages/**'
      - 'pubspec.yaml'
      - 'pubspec.lock'
      - 'tooling/versions.json'
      - '.github/workflows/deploy-web.yml'
`;

describe('assert-deploy-triggers.mjs', () => {
  test('a lane listing every build input passes', () => {
    const r = run(fixture({ 'deploy-web.yml': lane(ALL_PATHS) }));
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /ok {2}deploy triggers/);
  });

  // 🔴 THE DEFECT ITSELF: source listed, dependencies not.
  test('source-only paths fail, naming each missing input', () => {
    const r = run(
      fixture({
        'deploy-web.yml': lane(`    paths:
      - 'apps/subly/**'
      - 'packages/**'
      - '.github/workflows/deploy-web.yml'
`),
      }),
    );
    assert.equal(r.code, 1);
    assert.match(r.out, /pubspec\.yaml/);
    assert.match(r.out, /pubspec\.lock/);
    assert.match(r.out, /tooling\/versions\.json/);
  });

  // `packages/**` must not be read as reaching a repository-root file. A glob
  // matcher where `**` swallowed the leading segment would pass the case above
  // for entirely the wrong reason.
  test('`packages/**` does not cover a root pubspec.lock', () => {
    const r = run(
      fixture({
        'deploy-web.yml': lane(`    paths:
      - 'packages/**'
      - 'pubspec.yaml'
      - 'tooling/versions.json'
      - '.github/workflows/deploy-web.yml'
`),
      }),
    );
    assert.equal(r.code, 1);
    assert.match(r.out, /pubspec\.lock/);
  });

  // 🔴 COMMENTS ARE NOT CLAIMS. This guard's own subject carries a prose block
  // naming all three files directly above the list, so a raw substring scan
  // would report the pre-fix workflow as fixed.
  test('inputs named only in a COMMENT do not satisfy the filter', () => {
    const r = run(
      fixture({
        'deploy-web.yml': lane(`    # The build also depends on pubspec.yaml, pubspec.lock and
    # tooling/versions.json — the workspace resolution inputs.
    paths:
      - 'apps/subly/**'
      - 'packages/**'
      - '.github/workflows/deploy-web.yml'
`),
      }),
    );
    assert.equal(r.code, 1);
    assert.match(r.out, /pubspec\.lock/);
  });

  // A path named precisely so the lane does NOT run for it is the opposite of a
  // claim — the same inversion assert-lane-coverage.mjs was caught by.
  test('a `!` negation excluding an input is not coverage', () => {
    const r = run(
      fixture({ 'deploy-web.yml': lane(`${ALL_PATHS}      - '!pubspec.lock'\n`) }),
    );
    assert.equal(r.code, 1);
    assert.match(r.out, /pubspec\.lock/);
  });

  test('a paths-ignore filter that excludes an input fails', () => {
    const r = run(
      fixture({
        'deploy-web.yml': lane(`    paths-ignore:
      - 'tooling/versions.json'
`),
      }),
    );
    assert.equal(r.code, 1);
    assert.match(r.out, /tooling\/versions\.json/);
  });

  test('a paths-ignore filter that excludes nothing relevant passes', () => {
    const r = run(
      fixture({
        'deploy-web.yml': lane(`    paths-ignore:
      - 'docs/**'
`),
      }),
    );
    assert.equal(r.code, 0, r.out);
  });

  // Editing the build steps must redeploy, or the fix ships to nobody.
  test('a lane that does not list its OWN file fails', () => {
    const r = run(
      fixture({
        'deploy-web.yml': lane(`    paths:
      - 'apps/subly/**'
      - 'packages/**'
      - 'pubspec.yaml'
      - 'pubspec.lock'
      - 'tooling/versions.json'
`),
      }),
    );
    assert.equal(r.code, 1);
    assert.match(r.out, /deploy-web\.yml/);
  });

  // Out of scope, deliberately: a Worker lane's dependency inputs live inside
  // the directory its filter already names. Grading it would make the guard cry
  // wolf, and a guard that cries wolf gets switched off.
  test('a non-Flutter path-filtered lane is not graded', () => {
    const r = run(
      fixture({
        'deploy-web.yml': lane(ALL_PATHS),
        'deploy-workers.yml': `name: Deploy Workers
on:
  push:
    branches: [main]
    paths:
      - 'services/platform/**'
permissions:
  contents: read
jobs:
  d:
    runs-on: ubuntu-24.04
    steps:
      - run: npx wrangler deploy
`,
      }),
    );
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /1 path-filtered Flutter lane/);
  });

  // An unfiltered push runs for every commit, so there is nothing to under-reach.
  test('a Flutter lane with no path filter at all is not graded', () => {
    const r = run(
      fixture({
        'deploy-web.yml': lane(ALL_PATHS),
        'ci.yml': `name: CI
on:
  push:
    branches: [main]
permissions:
  contents: read
jobs:
  gate:
    runs-on: ubuntu-24.04
    steps:
      - run: flutter pub get
`,
      }),
    );
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /1 path-filtered Flutter lane/);
  });

  // ── the DERIVED half: scripts the lane runs are inputs too ────────────────
  // Hand-listing them would go stale the first time a step is added. Deriving
  // them from the lane's own text is what makes the requirement self-extending —
  // and it caught three real omissions in deploy-web.yml the hand list missed
  // (assert-gate-passed, assert-app-versioning, record-deployment).
  test('a tooling/ci script the lane RUNS must be in the filter', () => {
    const r = run(
      fixture({
        'deploy-web.yml': lane(ALL_PATHS, {
          extra: '',
        }).replace(
          '      - run: flutter build web --release\n',
          '      - run: node tooling/ci/assert-app-versioning.mjs --emit apps/subly\n' +
            '      - run: flutter build web --release\n',
        ),
      }),
    );
    assert.equal(r.code, 1);
    assert.match(r.out, /tooling\/ci\/assert-app-versioning\.mjs/);
  });

  test('…and passes once that script is listed', () => {
    const r = run(
      fixture({
        'deploy-web.yml': lane(`${ALL_PATHS}      - 'tooling/ci/assert-app-versioning.mjs'\n`)
          .replace(
            '      - run: flutter build web --release\n',
            '      - run: node tooling/ci/assert-app-versioning.mjs --emit apps/subly\n' +
              '      - run: flutter build web --release\n',
          ),
      }),
    );
    assert.equal(r.code, 0, r.out);
  });

  // A script named only in a comment is not a step the lane runs, so demanding
  // its path would be the guard crying wolf at its own prose.
  test('a script named only in a COMMENT is not demanded', () => {
    const r = run(
      fixture({
        'deploy-web.yml': lane(ALL_PATHS, {
          extra: '\n# historical: node tooling/ci/assert-retired.mjs\n',
        }),
      }),
    );
    assert.equal(r.code, 0, r.out);
  });

  // ── the scan must be loud when it grades nothing ──────────────────────────
  // 🔴 A FILTER THE PARSER CANNOT READ IS THE DANGEROUS CASE, not the absent
  // one: flow style parses to zero entries, which is byte-identical in effect to
  // "no filter", so a second lane written that way would leave scope in silence
  // while the guard still printed ok over the first.
  test('COVERAGE LOST on a push filter this parser reads as empty', () => {
    const r = run(
      fixture({
        'deploy-web.yml': lane(ALL_PATHS),
        'deploy-drift.yml': `name: Deploy Drift
on:
  push:
    branches: [main]
    paths: ['apps/drift/**']
permissions:
  contents: read
jobs:
  d:
    runs-on: ubuntu-24.04
    steps:
      - run: flutter build web --release
`,
      }),
    );
    assert.equal(r.code, 1);
    assert.match(r.out, /COVERAGE LOST/);
    assert.match(r.out, /deploy-drift\.yml/);
  });

  // The named lane is why this guard exists; renaming it out of scope must not
  // read as clean.
  test('COVERAGE LOST when the named lane is no longer graded', () => {
    const r = run(fixture({ 'deploy-anything-else.yml': lane(ALL_PATHS) }));
    assert.equal(r.code, 1);
    assert.match(r.out, /COVERAGE LOST/);
    assert.match(r.out, /deploy-web\.yml/);
  });

  test('COVERAGE LOST when no path-filtered Flutter lane exists', () => {
    const r = run(fixture({ 'deploy-web.yml': lane('', { dispatchOnly: true }) }));
    assert.equal(r.code, 1);
    assert.match(r.out, /COVERAGE LOST/);
  });

  test('COVERAGE LOST when there is no workflows directory', () => {
    const root = join(TMP, `f${seq++}`);
    mkdirSync(root, { recursive: true });
    const r = run(root);
    assert.equal(r.code, 1);
    assert.match(r.out, /COVERAGE LOST/);
  });
});
