// ─────────────────────────────────────────────────────────────────────────────
// deploy-triggers.test.mjs — assert-deploy-triggers.mjs must be able to FAIL.
//
// The guard exists because deploy-web.yml's `paths:` listed the SOURCE and not
// the DEPENDENCIES (2026-08-01 full-corpus review, #30), so a lockfile-only bump
// built differently on main and deployed nothing, silently. Since [ADR 095 §4]
// the deploy decides on its unit in tooling/ci/lane-map.json `deployUnits`, not
// on a push trigger of its own, so the list graded is the unit.
//
// ⚠️ THE REAL TREE IS THE FIRST NEGATIVE TEST, not these fixtures. Dropping
// `pubspec.lock` from deployUnits["<app>-web"] makes the guard exit 1 naming it;
// restoring it returns "ok 1 Flutter deploy unit(s)". A fixture I wrote encodes
// the same misunderstanding as the guard I wrote, so it can only ever be the
// second line of evidence.
//
// The cases below cover what the real tree cannot show without breaking it: the
// comment bypass, a claim held by the WRONG unit, the exact-key-over-template
// rule, the non-Flutter planner that is deliberately out of scope, and the guard
// grading an empty set.
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

/** A repo root holding `.github/workflows/<name>` for each entry and, unless
 *  `units` is `undefined`, tooling/ci/lane-map.json carrying them as `deployUnits`. */
function fixture(workflows, units) {
  const root = join(TMP, `f${seq++}`);
  mkdirSync(join(root, '.github', 'workflows'), { recursive: true });
  for (const [name, body] of Object.entries(workflows)) {
    writeFileSync(join(root, '.github', 'workflows', name), body);
  }
  if (units !== undefined) {
    mkdirSync(join(root, 'tooling', 'ci'), { recursive: true });
    writeFileSync(join(root, 'tooling', 'ci', 'lane-map.json'), JSON.stringify({ deployUnits: units }, null, 2));
  }
  return root;
}

function run(root) {
  const r = spawnSync(process.execPath, [GUARD, root], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

/** The shape deploy-web.yml really has: a called workflow whose plan step
 *  decides, then a Flutter web build. */
const lane = ({ plan = 'node tooling/ci/plan-deploy.mjs ${{ matrix.app }}-web', extra = '' } = {}) => `name: Deploy Web
on:
  workflow_call:
permissions:
  contents: read
${extra}
jobs:
  deploy-web:
    runs-on: ubuntu-24.04
    steps:
      - run: ${plan}
      - run: flutter pub get --enforce-lockfile
      - run: flutter build web --release
`;

const ALL = [
  'apps/<app>/**',
  'packages/**',
  'pubspec.yaml',
  'pubspec.lock',
  'tooling/versions.json',
  'catalog/apps.json',
  '.github/workflows/deploy-web.yml',
  'tooling/ci/plan-deploy.mjs',
];
const without = (...drop) => ALL.filter((g) => !drop.includes(g));

describe('assert-deploy-triggers.mjs', () => {
  test('a unit claiming every build input passes', () => {
    const r = run(fixture({ 'deploy-web.yml': lane() }, { '<app>-web': ALL }));
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /ok {2}deploy triggers — 1 Flutter deploy unit\(s\) \(<app>-web by deploy-web\.yml\)/);
  });

  // 🔴 THE DEFECT ITSELF: source claimed, dependencies not.
  test('a source-only unit fails, naming each missing input', () => {
    const r = run(
      fixture(
        { 'deploy-web.yml': lane() },
        { '<app>-web': without('pubspec.yaml', 'pubspec.lock', 'tooling/versions.json', 'catalog/apps.json') },
      ),
    );
    assert.equal(r.code, 1);
    assert.match(r.out, /pubspec\.yaml/);
    assert.match(r.out, /pubspec\.lock/);
    assert.match(r.out, /tooling\/versions\.json/);
    assert.match(r.out, /catalog\/apps\.json/);
    assert.match(r.out, /deployUnits\["<app>-web"\] never claims/);
  });

  // `packages/**` must not be read as reaching a repository-root file. A glob
  // matcher where `**` swallowed the leading segment would pass the case above
  // for entirely the wrong reason.
  test('`packages/**` does not cover a root pubspec.lock', () => {
    const r = run(fixture({ 'deploy-web.yml': lane() }, { '<app>-web': without('pubspec.lock') }));
    assert.equal(r.code, 1);
    assert.match(r.out, /pubspec\.lock/);
  });

  // 🔴 COMMENTS ARE NOT CLAIMS. The workflow carries prose naming the inputs;
  // only the unit's globs count.
  test('inputs named only in a workflow COMMENT do not satisfy the unit', () => {
    const r = run(
      fixture(
        { 'deploy-web.yml': lane({ extra: '# The build also depends on pubspec.yaml, pubspec.lock and tooling/versions.json.\n' }) },
        { '<app>-web': without('pubspec.lock') },
      ),
    );
    assert.equal(r.code, 1);
    assert.match(r.out, /pubspec\.lock/);
  });

  // Editing the build steps must redeploy, or the fix ships to nobody.
  test('a unit that does not claim its workflow\'s OWN file fails', () => {
    const r = run(fixture({ 'deploy-web.yml': lane() }, { '<app>-web': without('.github/workflows/deploy-web.yml') }));
    assert.equal(r.code, 1);
    assert.match(r.out, /\.github\/workflows\/deploy-web\.yml/);
  });

  // The claim must sit in the unit the Flutter workflow PLANS. Another unit
  // holding the file publishes that other unit, never this one.
  test('a claim held by a different unit is not a claim', () => {
    const r = run(
      fixture(
        { 'deploy-web.yml': lane() },
        { '<app>-web': without('pubspec.lock'), platform: ['services/platform/**', 'pubspec.lock'] },
      ),
    );
    assert.equal(r.code, 1);
    assert.match(r.out, /pubspec\.lock/);
  });

  // The same resolution plan-deploy.mjs makes: an exact key before the template.
  test('an exact unit key is graded before the `<app>` template', () => {
    const r = run(
      fixture(
        { 'deploy-web.yml': lane({ plan: 'node tooling/ci/plan-deploy.mjs subscriptiontracker-web' }) },
        { 'subscriptiontracker-web': without('pubspec.lock'), '<app>-web': ALL },
      ),
    );
    assert.equal(r.code, 1);
    assert.match(r.out, /deployUnits\["subscriptiontracker-web"\] never claims `pubspec\.lock`/);
  });

  // Out of scope, deliberately: a Worker's dependency inputs live inside the
  // directory its unit already names. Grading it would make the guard cry wolf,
  // and a guard that cries wolf gets switched off.
  test('a non-Flutter planning workflow is not graded', () => {
    const r = run(
      fixture(
        {
          'deploy-web.yml': lane(),
          'deploy-workers.yml': `name: Deploy Workers
on:
  workflow_call:
permissions:
  contents: read
jobs:
  d:
    runs-on: ubuntu-24.04
    steps:
      - run: node tooling/ci/plan-deploy.mjs platform
      - run: npx wrangler deploy
`,
        },
        { '<app>-web': ALL, platform: ['services/platform/**'] },
      ),
    );
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /1 Flutter deploy unit\(s\)/);
  });

  // A Flutter workflow that plans nothing publishes nothing through a plan, so
  // there is no unit to under-claim.
  test('a Flutter workflow that plans no unit is not graded', () => {
    const r = run(
      fixture(
        {
          'deploy-web.yml': lane(),
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
        },
        { '<app>-web': ALL },
      ),
    );
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /1 Flutter deploy unit\(s\)/);
  });

  // A plan named only in a comment is not a step the workflow runs.
  test('a plan named only in a COMMENT is not graded', () => {
    const r = run(
      fixture(
        {
          'deploy-web.yml': lane(),
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
      # once: node tooling/ci/plan-deploy.mjs thin-web
      - run: flutter pub get
`,
        },
        { '<app>-web': ALL, 'thin-web': ['apps/thin/**'] },
      ),
    );
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /1 Flutter deploy unit\(s\)/);
  });

  // ── the DERIVED half: scripts the lane runs are inputs too ────────────────
  // Hand-listing them would go stale the first time a step is added. Deriving
  // them from the lane's own text is what makes the requirement self-extending —
  // and it caught three real omissions in deploy-web.yml the hand list missed
  // (assert-gate-passed, assert-app-versioning, record-deployment).
  const versioned = (text) =>
    text.replace(
      '      - run: flutter build web --release\n',
      '      - run: node tooling/ci/assert-app-versioning.mjs --emit apps/subscriptiontracker\n' +
        '      - run: flutter build web --release\n',
    );

  test('a tooling/ci script the lane RUNS must be claimed by its unit', () => {
    const r = run(fixture({ 'deploy-web.yml': versioned(lane()) }, { '<app>-web': ALL }));
    assert.equal(r.code, 1);
    assert.match(r.out, /tooling\/ci\/assert-app-versioning\.mjs/);
  });

  test('…and passes once the unit claims it, by literal or by `tooling/ci/*.mjs`', () => {
    const literal = run(
      fixture({ 'deploy-web.yml': versioned(lane()) }, { '<app>-web': [...ALL, 'tooling/ci/assert-app-versioning.mjs'] }),
    );
    assert.equal(literal.code, 0, literal.out);
    const star = run(fixture({ 'deploy-web.yml': versioned(lane()) }, { '<app>-web': [...ALL, 'tooling/ci/*.mjs'] }));
    assert.equal(star.code, 0, star.out);
  });

  // A script named only in a comment is not a step the lane runs, so demanding
  // its path would be the guard crying wolf at its own prose.
  test('a script named only in a COMMENT is not demanded', () => {
    const r = run(
      fixture({ 'deploy-web.yml': lane({ extra: '# historical: node tooling/ci/assert-retired.mjs\n' }) }, { '<app>-web': ALL }),
    );
    assert.equal(r.code, 0, r.out);
  });

  // ── the scan must be loud when it cannot decide, or grades nothing ────────
  // A glob of a shape the matcher cannot answer is neither a claim nor a miss;
  // plan-deploy.mjs refuses it at run time, and so does this.
  test('COVERAGE LOST on a unit glob globClaims cannot decide', () => {
    const r = run(fixture({ 'deploy-web.yml': lane() }, { '<app>-web': [...without('pubspec.lock'), 'apps/**/pubspec.lock'] }));
    assert.equal(r.code, 2);
    assert.match(r.out, /COVERAGE LOST/);
    assert.match(r.out, /apps\/\*\*\/pubspec\.lock/);
  });

  // The named lane is why this guard exists; renaming it out of scope must not
  // read as clean.
  test('COVERAGE LOST when the named lane is no longer graded', () => {
    const r = run(
      fixture({ 'deploy-anything-else.yml': lane() }, { '<app>-web': [...ALL, '.github/workflows/deploy-anything-else.yml'] }),
    );
    assert.equal(r.code, 2);
    assert.match(r.out, /COVERAGE LOST/);
    assert.match(r.out, /deploy-web\.yml/);
  });

  test('COVERAGE LOST when no Flutter workflow plans a unit', () => {
    const r = run(fixture({ 'deploy-web.yml': lane({ plan: 'echo nothing planned' }) }, { '<app>-web': ALL }));
    assert.equal(r.code, 2);
    assert.match(r.out, /COVERAGE LOST/);
  });

  test('COVERAGE LOST when lane-map.json carries no deployUnits', () => {
    const missing = run(fixture({ 'deploy-web.yml': lane() }));
    assert.equal(missing.code, 2);
    assert.match(missing.out, /COVERAGE LOST — tooling\/ci\/lane-map\.json/);
    const wrongShape = run(fixture({ 'deploy-web.yml': lane() }, ['pubspec.lock']));
    assert.equal(wrongShape.code, 2);
    assert.match(wrongShape.out, /COVERAGE LOST/);
  });

  test('COVERAGE LOST when there is no workflows directory', () => {
    const root = join(TMP, `f${seq++}`);
    mkdirSync(root, { recursive: true });
    const r = run(root);
    assert.equal(r.code, 2);
    assert.match(r.out, /COVERAGE LOST/);
  });
});
