// ─────────────────────────────────────────────────────────────────────────────
// assert-deploy-triggers-deploy.test.mjs — the guard must be able to FAIL, and
// must fail on the EXACT shape that shipped.
//
// 🔴 A FIXTURE PASSING IS NOT A GUARD WORKING. This repo has a recorded case
// where all six of a guard's fixture tests passed against a provably broken
// guard, because the fixtures encoded the same misunderstanding as the guard.
// So the second suite runs the readers over the REAL tree — the units in
// tooling/ci/lane-map.json and the workflows that plan them — and asserts on
// what it finds there: if either is reshaped such that the reader stops seeing
// it, this test goes red instead of quietly passing over an empty set.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  judgeUnits,
  judgeEquality,
  unitKeyFor,
  plannedEnvironments,
  readUnits,
  parseTriggerPaths,
  parseFilters,
  workflowFiles,
  usesPathsFilter,
  REPO_ROOT,
  WORKFLOW_DIR,
  MIN_UNITS,
  MIN_PLANNING_WORKFLOWS,
} from '../assert-deploy-triggers-deploy.mjs';

// Built, not imported: the guard deliberately exports no workflow filename, and
// a test that imported one would reintroduce the lane binding that
// assert-release-lane-generic.mjs limb B exists to reject.
const WF = 'example-deploy.yml';
const SELF = `.github/workflows/${WF}`;
const OK_UNITS = {
  'subscriptiontracker-api': ['services/subscriptiontracker-api/**', SELF],
  platform: ['services/platform/**', SELF],
};
const OK_PLANS = [{ workflow: WF, environments: ['subscriptiontracker-api', 'platform'] }];

describe('assert-deploy-triggers-deploy — the decision (limbs 1-2)', () => {
  test('PASSES when every planned environment has a unit and every unit claims its workflow', () => {
    const { problems, owners } = judgeUnits(OK_UNITS, OK_PLANS);
    assert.deepEqual(problems, []);
    assert.deepEqual([...owners], [['subscriptiontracker-api', [WF]], ['platform', [WF]]]);
  });

  test('🔴 THE BUG THAT SHIPPED: the unit does not claim the workflow that deploys it', () => {
    // deploy-workers.yml as it stood on 2026-08-04: a change to the workflow
    // itself matched no filter. Run 30933229005 skipped both deploy jobs and
    // reported SUCCESS. Under the plan, the same miss is a unit without its
    // workflow — a repair to the deploy publishes nothing.
    const { problems } = judgeUnits(
      { 'subscriptiontracker-api': ['services/subscriptiontracker-api/**'], platform: ['services/platform/**'] },
      OK_PLANS,
    );
    assert.equal(problems.length, 2, problems.join('\n'));
    assert.ok(problems.every((p) => p.includes(`does not claim \`${SELF}\``)), problems.join('\n'));
  });

  test('🔴 FAILS when only ONE unit claims the workflow — half a proof is not a proof', () => {
    const { problems } = judgeUnits(
      { 'subscriptiontracker-api': OK_UNITS['subscriptiontracker-api'], platform: ['services/platform/**'] },
      OK_PLANS,
    );
    assert.equal(problems.length, 1, problems.join('\n'));
    assert.match(problems[0], /deployUnits\["platform"\] does not claim/);
  });

  test('🔴 FAILS on an environment no unit answers — the plan would refuse it at run time', () => {
    const { problems } = judgeUnits(OK_UNITS, [{ workflow: WF, environments: [...OK_PLANS[0].environments, 'newapp-api'] }]);
    assert.ok(problems.some((p) => p.includes('plan-deploy.mjs newapp-api') && p.includes('names no unit')), problems.join('\n'));
  });

  test('🔴 FAILS on a unit no workflow plans — a claim nothing acts on', () => {
    const { problems } = judgeUnits({ ...OK_UNITS, orphan: ['services/orphan/**'] }, OK_PLANS);
    assert.equal(problems.length, 1, problems.join('\n'));
    assert.match(problems[0], /deployUnits\["orphan"\] is planned by no workflow/);
  });

  test('a unit glob the reader cannot decide is COVERAGE LOST, never a silent "not claimed"', () => {
    const { problems } = judgeUnits({ ...OK_UNITS, platform: ['services/platform/**', '.github/*/example-*.yml'] }, OK_PLANS);
    assert.equal(problems.length, 1, problems.join('\n'));
    assert.match(problems[0], /^COVERAGE LOST: deployUnits\["platform"\]/);
  });

  test('the subject workflow is a PARAMETER, so the same decision serves any lane', () => {
    // The guard names no workflow in code. Proving the decision works for a
    // file it has never seen is what makes that real rather than cosmetic.
    const other = 'some-other-lane.yaml';
    const plans = [{ workflow: other, environments: ['only'] }];
    assert.deepEqual(judgeUnits({ only: ['pkg/**', `.github/workflows/${other}`] }, plans).problems, []);
    assert.equal(judgeUnits({ only: ['pkg/**'] }, plans).problems.length, 1);
  });
});

describe('assert-deploy-triggers-deploy — reading a plan the way plan-deploy.mjs does', () => {
  test('unitKeyFor: an exact key first, then the `<app>` template; an expression reads as `<app>`', () => {
    const units = { 'subscriptiontracker-web': [], '<app>-web': [], platform: [] };
    assert.equal(unitKeyFor(units, 'subscriptiontracker-web'), 'subscriptiontracker-web');
    assert.equal(unitKeyFor(units, 'drift-web'), '<app>-web');
    assert.equal(unitKeyFor(units, '${{ matrix.app }}-web'), '<app>-web');
    assert.equal(unitKeyFor(units, 'platform'), 'platform');
    assert.equal(unitKeyFor(units, 'newapp-api'), null);
    assert.equal(unitKeyFor(units, 'Not_An_App-web'), null);
  });

  test('plannedEnvironments: an expression argument survives its spaces; a commented plan runs nothing', () => {
    const text = [
      'jobs:',
      '  a:',
      '    steps:',
      '      - run: node tooling/ci/plan-deploy.mjs ${{ matrix.app }}-web',
      '      - run: |',
      '          node tooling/ci/plan-deploy.mjs platform >> "$GITHUB_OUTPUT"',
      '      # node tooling/ci/plan-deploy.mjs retired-api',
      '',
    ].join('\n');
    assert.deepEqual(plannedEnvironments(text), ['${{ matrix.app }}-web', 'platform']);
  });
});

describe('assert-deploy-triggers-deploy — limb 4 (⏳ transitional equality)', () => {
  const keys = ['subscriptiontracker-api', 'platform'];
  const paths = ['services/subscriptiontracker-api/**', 'services/platform/**', SELF];
  const filters = { subscriptiontracker_api: OK_UNITS['subscriptiontracker-api'], platform: OK_UNITS.platform };

  test('PASSES when on.push.paths is the union of the units and each filter equals its unit', () => {
    assert.deepEqual(judgeEquality(OK_UNITS, WF, keys, paths, filters), []);
    assert.deepEqual(judgeEquality(OK_UNITS, WF, keys, paths, null), []);
  });

  test('🔴 FAILS both ways on a trigger that differs from the units', () => {
    const extra = judgeEquality(OK_UNITS, WF, keys, [...paths, 'catalog/**'], null);
    assert.equal(extra.length, 1, extra.join('\n'));
    assert.match(extra[0], /`catalog\/\*\*` is in .* on\.push\.paths and not in its unit/);
    const short = judgeEquality(OK_UNITS, WF, keys, paths.slice(1), null);
    assert.equal(short.length, 1, short.join('\n'));
    assert.match(short[0], /`services\/subscriptiontracker-api\/\*\*` is in its unit/);
  });

  test('🔴 FAILS on a filter that differs from its unit, a unit with no filter, and a filter with no unit', () => {
    const drift = judgeEquality(OK_UNITS, WF, keys, null, { ...filters, platform: ['services/platform/**'] });
    assert.equal(drift.length, 1, drift.join('\n'));
    assert.match(drift[0], /is in deployUnits\["platform"\] and not in .* filter `platform`/);
    const missing = judgeEquality(OK_UNITS, WF, keys, null, { platform: OK_UNITS.platform });
    assert.ok(missing.some((p) => p.includes('plans deployUnits["subscriptiontracker-api"] and carries no filter')));
    const stray = judgeEquality(OK_UNITS, WF, keys, null, { ...filters, newapp_api: ['services/newapp-api/**'] });
    assert.ok(stray.some((p) => p.includes('filter `newapp_api` spells no unit')));
  });
});

describe('assert-deploy-triggers-deploy — against the REAL tree', () => {
  const files = workflowFiles();
  const units = readUnits(REPO_ROOT);
  const plans = files
    .map((workflow) => ({ workflow, environments: plannedEnvironments(readFileSync(resolve(WORKFLOW_DIR, workflow), 'utf8')) }))
    .filter((p) => p.environments.length > 0);

  test('the tree has workflows, deployUnits, and at least one workflow that runs the plan', () => {
    assert.ok(files.length > 0, 'no workflow files discovered — the guard would scan nothing');
    assert.ok(units && Object.keys(units).length >= MIN_UNITS, 'tooling/ci/lane-map.json deployUnits read as empty');
    assert.ok(plans.length >= MIN_PLANNING_WORKFLOWS, `expected >= ${MIN_PLANNING_WORKFLOWS} planning workflow(s), found ${plans.length}`);
  });

  test('every real unit is planned, and claims the workflow that deploys it', () => {
    const { problems, owners } = judgeUnits(units, plans);
    assert.deepEqual(problems, []);
    for (const [key, by] of owners) assert.ok(by.length > 0, `${key} planned by nothing`);
  });

  // ⏳ Goes with limb 4, in the commit that removes the deploy workflows' own triggers.
  test('every real deploy trigger still carried equals its units (limb 4)', () => {
    let asserted = 0;
    for (const { workflow } of plans) {
      const text = readFileSync(resolve(WORKFLOW_DIR, workflow), 'utf8');
      const triggerPaths = parseTriggerPaths(text);
      const filters = usesPathsFilter(text) ? parseFilters(text) : null;
      if (triggerPaths === null && filters === null) continue;
      const keys = [...judgeUnits(units, plans).owners].filter(([, by]) => by.includes(workflow)).map(([k]) => k);
      // The header comment and the guard's own name both mention workflow
      // files; a grep-based reader would count those as coverage.
      for (const list of [triggerPaths ?? [], ...Object.values(filters ?? {})]) {
        for (const p of list) assert.ok(!p.startsWith('#'), `${workflow}: picked up a comment: ${p}`);
      }
      assert.deepEqual(judgeEquality(units, workflow, keys, triggerPaths, filters), [], `${workflow} does not equal its units`);
      asserted += 1;
    }
    assert.ok(asserted >= 1, `asserted over ${asserted} workflow(s) — the loop ran dry`);
  });
});

// ── the EXIT CODE, spawned (O-EXIT2-CONVENTION-GAP) ──────────────────────────
// 0 green · 1 a finding · 2 COVERAGE LOST. The guard resolves its root from its
// own location, so it is COPIED into a temp tree rather than run with a cwd —
// spawning the repository's copy would grade the repository.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, cpSync, writeFileSync as writeFixture } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as joinPath, dirname as dirOf } from 'node:path';
import { fileURLToPath as toPath } from 'node:url';

const CI_SRC = resolve(dirOf(toPath(import.meta.url)), '..');
const spawnIn = (workflows, units) => {
  const root = mkdtempSync(joinPath(tmpdir(), 'dtd-exit-'));
  mkdirSync(joinPath(root, 'tooling', 'ci'), { recursive: true });
  for (const f of ['assert-deploy-triggers-deploy.mjs', 'tree-walk.mjs']) cpSync(joinPath(CI_SRC, f), joinPath(root, 'tooling', 'ci', f));
  if (units !== undefined) writeFixture(joinPath(root, 'tooling', 'ci', 'lane-map.json'), JSON.stringify({ deployUnits: units }));
  mkdirSync(joinPath(root, '.github', 'workflows'), { recursive: true });
  for (const [name, text] of Object.entries(workflows)) writeFixture(joinPath(root, '.github', 'workflows', name), text);
  const r = spawnSync(process.execPath, [joinPath(root, 'tooling', 'ci', 'assert-deploy-triggers-deploy.mjs')], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
};
const PLANNER = ['on:', '  workflow_call:', 'jobs:', '  d:', '    steps:', '      - run: node tooling/ci/plan-deploy.mjs a', ''].join('\n');

describe('assert-deploy-triggers-deploy — exit codes', () => {
  test('🔴 a workflow directory with nothing in it is COVERAGE LOST — exit 2, not a finding', () => {
    const { code, out } = spawnIn({}, { a: ['services/a/**'] });
    assert.match(out, /COVERAGE LOST: no workflow files/);
    assert.equal(code, 2, out);
  });

  test('🔴 no readable deployUnits is COVERAGE LOST — exit 2', () => {
    const { code, out } = spawnIn({ 'd.yml': PLANNER });
    assert.match(out, /COVERAGE LOST: tooling\/ci\/lane-map\.json holds no readable `deployUnits`/);
    assert.equal(code, 2, out);
  });

  test('a real finding keeps exit 1 even with a COVERAGE LOST stop beside it', () => {
    // The planted tree is far below the limb-3 floor; the finding still decides the code.
    const { code, out } = spawnIn({ 'd.yml': PLANNER }, { a: ['services/a/**'] });
    assert.match(out, /does not claim `\.github\/workflows\/d\.yml`/);
    assert.equal(code, 1, out);
  });
});

// ── LIMB 3 · judgeImports, on a planted tree ─────────────────────────────────
// The header says limb 3 reads its subject off the tree: the tree under every `X/**`
// glob of a unit is READ, and each relative import resolving OUTSIDE `X` must be
// claimed by that same unit. These cases plant a tree the guard has never seen,
// so a typed list of today's imports cannot pass them.
import { judgeImports } from '../assert-deploy-triggers-deploy.mjs';

const plantTree = (files) => {
  const root = mkdtempSync(joinPath(tmpdir(), 'dtd-imports-'));
  for (const [rel, text] of Object.entries(files)) {
    const abs = joinPath(root, ...rel.split('/'));
    mkdirSync(dirOf(abs), { recursive: true });
    writeFixture(abs, text);
  }
  return root;
};

// One carrier that reaches a shared file by a bare relative import, one that
// reaches nothing. The shared file's name exists nowhere in the guard.
const PLANTED = {
  'svc/alpha/src/index.ts': "import { chassis } from '../../shared/chassis-zq.ts';\nexport default chassis;\n",
  'svc/beta/src/index.ts': "export default 1;\n",
  'svc/shared/chassis-zq.ts': 'export const chassis = 1;\n',
};

describe('assert-deploy-triggers-deploy — limb 3 (judgeImports) on a planted tree', () => {
  test('🔴 an import escaping a claimed tree, claimed by no glob of its unit, is a finding', () => {
    const root = plantTree(PLANTED);
    const r = judgeImports(root, { alpha: ['svc/alpha/**'], beta: ['svc/beta/**'] });
    assert.ok(r.scanned >= 2, `the walk read ${r.scanned} file(s) — it must read the planted tree`);
    assert.deepEqual(
      r.external.map((e) => [e.name, e.from, e.target]),
      [['alpha', 'svc/alpha/src/index.ts', 'svc/shared/chassis-zq.ts']],
    );
    assert.equal(r.problems.length, 1, r.problems.join('\n'));
    assert.ok(r.problems[0].includes('unit `alpha`') && r.problems[0].includes('svc/shared/chassis-zq.ts'));
    assert.match(r.problems[0], /deployUnits\["alpha"\] in tooling\/ci\/lane-map\.json/);
  });

  test('🔴 a claim in ANOTHER unit is not a claim — that unit is the one the plan would publish', () => {
    const root = plantTree(PLANTED);
    const r = judgeImports(root, { alpha: ['svc/alpha/**'], beta: ['svc/beta/**', 'svc/shared/chassis-zq.ts'] });
    assert.equal(r.problems.length, 1, r.problems.join('\n'));
    assert.match(r.problems[0], /unit `alpha`/);
  });

  test('the asymmetry is read off the tree: the carrier that imports nothing external is not asked to claim the shared file', () => {
    const root = plantTree(PLANTED);
    const r = judgeImports(root, { alpha: ['svc/alpha/**', 'svc/shared/*.ts'], beta: ['svc/beta/**'] });
    assert.deepEqual(r.problems, []);
    assert.equal(r.external.length, 1);
  });

  test('an escape from a test/ directory, and a specifier that resolves to nothing, demand nothing', () => {
    const root = plantTree({
      ...PLANTED,
      'svc/beta/test/x.test.ts': "import '../../shared/chassis-zq.ts';\n",
      'svc/beta/src/ghost.ts': "import { g } from '../../nowhere/ghost.ts';\n",
    });
    const r = judgeImports(root, { alpha: ['svc/alpha/**', 'svc/shared/**'], beta: ['svc/beta/**'] });
    assert.deepEqual(r.problems, []);
    assert.deepEqual(r.external.map((e) => e.name), ['alpha']);
  });

  test('a glob shape the reader cannot decide is COVERAGE LOST, never a silent "not claimed"', () => {
    const root = plantTree(PLANTED);
    const r = judgeImports(root, { alpha: ['svc/alpha/**', 'svc/sha?ed/*.ts'], beta: ['svc/beta/**'] });
    assert.ok(r.problems.length >= 1);
    assert.ok(r.problems.every((p) => p.startsWith('COVERAGE LOST')), r.problems.join('\n'));
  });
});
