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
  unitKeyFor,
  plannedEnvironments,
  readUnits,
  workflowFiles,
  REPO_ROOT,
  WORKFLOW_DIR,
  MIN_UNITS,
  MIN_PLANNING_WORKFLOWS,
  expandPlans,
  judgeLegUnits,
  judgeWorkerMatrix,
  relativeSpecifiersOf,
  resolveSpecifier,
} from '../assert-deploy-triggers-deploy.mjs';
import { globClaims as movedGlobClaims, claimedTree as movedClaimedTree } from '../deploy-globs.mjs';
import { parseAllWorkflows } from '../workflow-scan.mjs';
import { appWorkerMatrix } from '../worker-set.mjs';

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
    // ⏱ 2026-09-26: the app Worker matrix's plan argument is read as its legs' Workers (limb 4).
    const m = appWorkerMatrix(REPO_ROOT);
    assert.equal(m.lost, null, `the real app Worker matrix could not be read: ${m.lost}`);
    const { problems, owners } = judgeUnits(units, expandPlans(plans, m.entries.map((e) => e.worker)));
    assert.deepEqual(problems, []);
    for (const [key, by] of owners) assert.ok(by.length > 0, `${key} planned by nothing`);
  });

  test('limb 4 on the real tree: at least one app Worker leg, one matrix job, and every leg in the safety order', () => {
    const m = appWorkerMatrix(REPO_ROOT);
    assert.ok(m.entries.length >= 1, 'no app Worker leg read — limb 4 would grade nothing');
    const wm = judgeWorkerMatrix(parseAllWorkflows(REPO_ROOT), m.entries);
    assert.deepEqual(wm.problems, []);
    assert.deepEqual(wm.jobs, ['.github/workflows/deploy-workers.yml:app-worker']);
    assert.deepEqual(judgeLegUnits(units, m.entries), []);
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

/** The guard and every module it imports, transitively — read off the files with the
 *  guard's own specifier reader, so a new import is copied without an edit here. */
const guardClosure = () => {
  const seen = new Set();
  const walk = (rel) => {
    if (seen.has(rel)) return;
    seen.add(rel);
    for (const spec of relativeSpecifiersOf(readFileSync(resolve(REPO_ROOT, rel), 'utf8'))) {
      const target = resolveSpecifier(REPO_ROOT, rel, spec);
      if (target !== null) walk(target);
    }
  };
  walk('tooling/ci/assert-deploy-triggers-deploy.mjs');
  return [...seen];
};
const spawnIn = (workflows, units) => {
  const root = mkdtempSync(joinPath(tmpdir(), 'dtd-exit-'));
  mkdirSync(joinPath(root, 'tooling', 'ci'), { recursive: true });
  for (const rel of guardClosure()) {
    mkdirSync(dirOf(joinPath(root, ...rel.split('/'))), { recursive: true });
    cpSync(joinPath(REPO_ROOT, ...rel.split('/')), joinPath(root, ...rel.split('/')));
  }
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

// ── LIMB 4 · the app Worker matrix, graded leg by leg (⏱ 2026-09-26, O-SERVICE-KIT-UNBUILT E-a2) ──
// Each case writes the REAL deploy-workers.yml, mutated by one replace, into a tmpdir root
// ([ADR 072]) and grades it against legs made here. RC4 is the design's control (RC5 left with R-3).
const REAL_DEPLOY = readFileSync(resolve(WORKFLOW_DIR, 'deploy-workers.yml'), 'utf8');
const LEG = { worker: 'zz-api', dir: 'services/zz-api', migrations: 'APP_DB', smokeUrl: 'https://zz-api.example.test/v1/health', origin: 'https://zz-api.example.test', dsnSecret: 'GLITCHTIP_DSN_ZZ' };
const LEG_NO_DB = { ...LEG, worker: 'yy-api', dir: 'services/yy-api', migrations: null };
const gradeDeploy = (text, entries = [LEG]) => {
  const root = plantTree({ '.github/workflows/deploy-workers.yml': text });
  return judgeWorkerMatrix(parseAllWorkflows(root), entries);
};
const swap = (text, from, to) => {
  assert.ok(text.includes(from), `fixture anchor absent: ${from.slice(0, 60)}`);
  return text.replace(from, to);
};
const MIGRATE_STEP = REAL_DEPLOY.slice(
  REAL_DEPLOY.indexOf('      # why: MIGRATIONS BEFORE DEPLOY. The schema standard'),
  REAL_DEPLOY.indexOf('      # why: [pipeline K-7] a statement'),
);
const DEPLOY_ANCHOR = '      # why: `id: deploy` is the only step';
const SMOKE_ANCHOR = '      # why: `build` is a separate field';

describe('assert-deploy-triggers-deploy — limb 4 (judgeWorkerMatrix) on the real workflow, mutated', () => {
  test('the real deploy-workers.yml grades clean for a leg with a D1 and a leg without one', () => {
    assert.ok(MIGRATE_STEP.includes('d1 migrations apply') && REAL_DEPLOY.includes(DEPLOY_ANCHOR), 'fixture slices lost their steps');
    const r = gradeDeploy(REAL_DEPLOY, [LEG, LEG_NO_DB]);
    assert.deepEqual(r.problems, []);
    assert.deepEqual(r.jobs, ['.github/workflows/deploy-workers.yml:app-worker']);
  });

  test('🔴 RC4 · the migrations step removed from the matrix template fails, naming the leg whose Worker migrates a D1', () => {
    const r = gradeDeploy(swap(REAL_DEPLOY, MIGRATE_STEP, ''), [LEG, LEG_NO_DB]);
    assert.equal(r.problems.length, 1, r.problems.join('\n'));
    assert.match(r.problems[0], /the zz-api leg: its Worker migrates APP_DB .* no step runs `d1 migrations apply/);
  });

  test('🔴 a second deploy BEFORE `id: deploy` fails — a leg deploys its Worker exactly ONCE (R-3 dropped, #981)', () => {
    const r = gradeDeploy(swap(REAL_DEPLOY, DEPLOY_ANCHOR, `      - run: npx wrangler deploy\n${DEPLOY_ANCHOR}`));
    assert.equal(r.problems.length, 1, r.problems.join('\n'));
    assert.match(r.problems[0], /the zz-api leg: 1 step\(s\) deploy before `id: deploy`/);
  });

  test('🔴 a plain wrangler-action deploy planted before the vars deploy fails — the #155 shape moved first', () => {
    const planted =
      '      - uses: cloudflare/wrangler-action@9acf94ace14e7dc412b076f2c5c20b8ce93c79cd # v3\n' +
      '        with:\n' +
      '          workingDirectory: ${{ matrix.worker.dir }}\n';
    const r = gradeDeploy(swap(REAL_DEPLOY, DEPLOY_ANCHOR, `${planted}${DEPLOY_ANCHOR}`));
    assert.ok(r.problems.some((p) => /the zz-api leg: 1 step\(s\) deploy before `id: deploy`/.test(p)), r.problems.join('\n'));
  });

  test('🔴 a second unqualified deploy after `id: deploy` fails — the vars deploy is the LAST one (#155)', () => {
    const r = gradeDeploy(swap(REAL_DEPLOY, SMOKE_ANCHOR, `      - run: npx wrangler deploy\n${SMOKE_ANCHOR}`));
    assert.equal(r.problems.length, 1, r.problems.join('\n'));
    assert.match(r.problems[0], /1 step\(s\) deploy after `id: deploy`/);
  });

  test('🔴 the record conditioned on the smoke, not the deploy, fails', () => {
    const recordIf = "        if: always() && steps.deploy.outcome == 'success'\n        env:\n          GH_TOKEN: ${{ github.token }}\n          # why: the deploy's own output";
    const r = gradeDeploy(swap(REAL_DEPLOY, recordIf, recordIf.replace("always() && steps.deploy.outcome == 'success'", 'success()')));
    assert.equal(r.problems.length, 1, r.problems.join('\n'));
    assert.match(r.problems[0], /the record step is conditioned `success\(\)`/);
  });

  test('🔴 a matrix written into the workflow, not read from worker-set.mjs, fails', () => {
    const r = gradeDeploy(swap(REAL_DEPLOY, 'worker: ${{ fromJSON(needs.workers.outputs.workers) }}', 'worker: [{"worker": "zz-api"}]'));
    assert.equal(r.problems.length, 1, r.problems.join('\n'));
    assert.match(r.problems[0], /its `strategy\.matrix\.worker` is not/);
  });

  test('🔴 a matrix read from a job that does not run worker-set.mjs --app-workers fails', () => {
    const r = gradeDeploy(swap(REAL_DEPLOY, 'node tooling/ci/worker-set.mjs --for-deploy --json --app-workers', 'node tooling/ci/worker-set.mjs --for-deploy --json'));
    assert.equal(r.problems.length, 1, r.problems.join('\n'));
    assert.match(r.problems[0], /job `workers` does not write that output from `node tooling\/ci\/worker-set\.mjs --for-deploy --json --app-workers`/);
  });

  test('a leg whose Worker migrates nothing is not asked for a migrations step', () => {
    const r = gradeDeploy(swap(REAL_DEPLOY, MIGRATE_STEP, ''), [LEG_NO_DB]);
    assert.deepEqual(r.problems, []);
  });

  test('🔴 app Workers and no job planning a matrix leg fails: a job written for one Worker is what app #2 is missing from', () => {
    const r = gradeDeploy('name: x\non:\n  workflow_call:\njobs:\n  api:\n    runs-on: ubuntu-24.04\n    steps:\n      - run: node tooling/ci/plan-deploy.mjs zz-api\n');
    assert.equal(r.problems.length, 1, r.problems.join('\n'));
    assert.match(r.problems[0], /worker-set\.mjs names 1 app Worker\(s\) \(zz-api\) and no workflow job plans a leg/);
  });
});

describe('assert-deploy-triggers-deploy — limb 1 reads each matrix leg as its Worker (limb 1b: its unit claims its tree)', () => {
  test('expandPlans: a leg argument becomes the legs; unreadable legs leave it as written for limb 1 to name', () => {
    const plans = [{ workflow: WF, environments: ['${{ matrix.worker.worker }}', 'platform'] }];
    assert.deepEqual(expandPlans(plans, ['a-api', 'b-api'])[0].environments, ['a-api', 'b-api', 'platform']);
    assert.deepEqual(expandPlans(plans, null)[0].environments, ['${{ matrix.worker.worker }}', 'platform']);
    const { problems } = judgeUnits({ platform: ['services/platform/**', SELF] }, expandPlans(plans, null));
    assert.ok(problems.some((p) => p.includes('plan-deploy.mjs ${{ matrix.worker.worker }}')), problems.join('\n'));
  });

  test("🔴 a leg with no unit of its own is limb 1's finding — app #2 needs its deployUnits entry", () => {
    const plans = expandPlans([{ workflow: WF, environments: ['${{ matrix.worker.worker }}'] }], ['zz-api']);
    const { problems } = judgeUnits({ other: ['services/other/**', SELF] }, plans);
    assert.ok(problems.some((p) => p.includes('`plan-deploy.mjs zz-api`, and tooling/ci/lane-map.json deployUnits names no unit')), problems.join('\n'));
  });

  test("🔴 RC7′ · a leg's unit that does not claim the Worker's own tree fails (limb 1b); claiming it passes", () => {
    const bad = judgeLegUnits({ 'zz-api': ['services/_shared/**', SELF] }, [LEG]);
    assert.equal(bad.length, 1);
    assert.match(bad[0], /deployUnits\["zz-api"\] is the unit of the app Worker zz-api, and no glob of it claims `services\/zz-api\/\*\*`/);
    assert.deepEqual(judgeLegUnits({ 'zz-api': ['services/zz-api/**', SELF] }, [LEG]), []);
  });

  test('globClaims and claimedTree moved to deploy-globs.mjs and are re-exported unchanged', () => {
    assert.equal(movedGlobClaims('services/zz-api/**', 'services/zz-api/src/index.ts'), true);
    assert.equal(movedGlobClaims('services/zz-api/**', 'services/zz-apix/src/index.ts'), false);
    assert.equal(movedClaimedTree('services/zz-api/**'), 'services/zz-api');
    assert.equal(movedGlobClaims('a/*.js', 'a/b.js'), true);
    assert.equal(movedGlobClaims('a/b?c', 'a/bxc'), null);
  });
});

// ── LIMB 5 · PLATFORM_DB migrates before every deploy that binds it (⏱ 2026-10-01, PB-03) ──
// Row O-APP-WORKERS-DEPLOY-BEFORE-THE-MIGRATION. The REAL ci.yml and the three callees are
// written into a tmpdir root, mutated by one replace, and graded against the real binding
// configs and app Worker legs, so a fixture cannot encode the guard's own reading.
import { judgePlatformDbOrder, platformDbConfigs } from '../assert-deploy-triggers-deploy.mjs';

const REAL_FLOW = Object.fromEntries(
  ['ci.yml', 'deploy-workers.yml', 'deploy-web.yml', 'migrate-platform-db.yml'].map((f) => [
    `.github/workflows/${f}`,
    readFileSync(resolve(WORKFLOW_DIR, f), 'utf8'),
  ]),
);
const REAL_ENTRIES = appWorkerMatrix(REPO_ROOT).entries;
const REAL_CONFIGS = platformDbConfigs(REPO_ROOT);
const gradeOrder = (mutate = (files) => files, configs = REAL_CONFIGS, entries = REAL_ENTRIES) => {
  const files = mutate({ ...REAL_FLOW });
  return judgePlatformDbOrder(parseAllWorkflows(plantTree(files)), configs, entries);
};
const swapIn = (rel, from, to) => (files) => ({ ...files, [`.github/workflows/${rel}`]: swap(files[`.github/workflows/${rel}`], from, to) });

describe('assert-deploy-triggers-deploy — limb 5 (judgePlatformDbOrder)', () => {
  test('the REAL tree: three configs bind PLATFORM_DB, and each one\'s production deploy needs the one migration', () => {
    assert.deepEqual(REAL_CONFIGS, ['services/platform', 'services/subscriptiontracker-api', 'tooling/sites/nikatru-apex']);
    const r = judgePlatformDbOrder(parseAllWorkflows(REPO_ROOT), REAL_CONFIGS, REAL_ENTRIES);
    assert.deepEqual(r.problems, []);
    assert.equal(r.applier, '.github/workflows/migrate-platform-db.yml:migrate');
    assert.deepEqual(r.deployers, [
      '.github/workflows/deploy-web.yml:site (tooling/sites/nikatru-apex)',
      '.github/workflows/deploy-workers.yml:app-worker (services/subscriptiontracker-api)',
      '.github/workflows/deploy-workers.yml:platform (services/platform)',
    ]);
  });

  test('GREEN CONTROL — the real four workflows, planted', () => {
    assert.deepEqual(gradeOrder().problems, []);
  });

  test('🔴 RED CONTROL — deploy-workers no longer needs platform-db-migrate: every Worker deploy in it is a finding', () => {
    const r = gradeOrder(swapIn('ci.yml', '    needs: [ci-gate, platform-db-migrate]\n', '    needs: [ci-gate]\n'));
    assert.equal(r.problems.length, 2, r.problems.join('\n'));
    assert.match(r.problems[0], /deploy-workers\.yml:app-worker deploys services\/subscriptiontracker-api, whose wrangler\.jsonc binds PLATFORM_DB, and does not transitively need/);
    assert.match(r.problems[1], /deploy-workers\.yml:platform deploys services\/platform/);
  });

  test('🔴 RED CONTROL — neither deploy call needs it: the apex site\'s Function is a finding too', () => {
    const r = gradeOrder((files) =>
      swapIn('ci.yml', '    needs: [ci-gate, platform-db-migrate, deploy-workers]\n', '    needs: [ci-gate, deploy-workers]\n')(
        swapIn('ci.yml', '    needs: [ci-gate, platform-db-migrate]\n', '    needs: [ci-gate]\n')(files),
      ),
    );
    assert.ok(r.problems.some((p) => /deploy-web\.yml:site deploys tooling\/sites\/nikatru-apex/.test(p)), r.problems.join('\n'));
  });

  test('deploy-web needing it only THROUGH deploy-workers is still "transitively needs" — green', () => {
    const r = gradeOrder(swapIn('ci.yml', '    needs: [ci-gate, platform-db-migrate, deploy-workers]\n', '    needs: [ci-gate, deploy-workers]\n'));
    assert.deepEqual(r.problems, []);
  });

  test('🔴 RED CONTROL — THE SHAPE THAT SHIPPED: the migration back inside the platform job, after every app Worker', () => {
    // A sibling of the applier is NOT ordered after it by the call that encloses them both.
    const r = gradeOrder((files) => {
      const out = { ...files };
      delete out['.github/workflows/migrate-platform-db.yml'];
      out['.github/workflows/deploy-workers.yml'] = swap(
        out['.github/workflows/deploy-workers.yml'],
        '      # why: NO PLATFORM_DB MIGRATION HERE ANY MORE (PB-03).',
        "      - name: Apply PLATFORM_DB migrations (before deploy)\n        if: steps.plan.outputs.deploy == 'true'\n" +
          '        uses: cloudflare/wrangler-action@953926a2e2182532811c01a25e53647d93bf07c0 # v4.1.3\n' +
          '        with:\n          workingDirectory: services/platform\n          command: d1 migrations apply PLATFORM_DB --remote\n' +
          '      # why: NO PLATFORM_DB MIGRATION HERE ANY MORE (PB-03).',
      );
      return out;
    });
    assert.equal(r.applier, '.github/workflows/deploy-workers.yml:platform');
    // Every app Worker went live before the platform job migrated: the finding PB-03 names.
    // (The site waits on the whole deploy-workers call, and the platform job migrates what it
    // then deploys, so neither is one here.)
    assert.equal(r.problems.length, 1, r.problems.join('\n'));
    assert.match(r.problems[0], /deploy-workers\.yml:app-worker deploys services\/subscriptiontracker-api, whose wrangler\.jsonc binds PLATFORM_DB, and does not transitively need \.github\/workflows\/deploy-workers\.yml:platform/);
  });

  test('🔴 two appliers, or none, is a finding naming the count', () => {
    const none = gradeOrder(swapIn('migrate-platform-db.yml', 'command: d1 migrations apply PLATFORM_DB --remote', 'command: d1 migrations list PLATFORM_DB --remote'));
    assert.match(none.problems[0], /^0 job\(s\) run `d1 migrations apply PLATFORM_DB --remote`/);
    const two = gradeOrder((files) => ({
      ...files,
      '.github/workflows/zz-second.yml': files['.github/workflows/migrate-platform-db.yml'],
    }));
    assert.match(two.problems[0], /^2 job\(s\) run `d1 migrations apply PLATFORM_DB --remote`/);
  });

  test('a SANDBOX migration or deploy (`--env sandbox`) is neither the applier nor a production deploy', () => {
    const sandbox = readFileSync(resolve(WORKFLOW_DIR, 'deploy-sandbox.yml'), 'utf8');
    const r = gradeOrder((files) => ({ ...files, '.github/workflows/deploy-sandbox.yml': sandbox }));
    assert.deepEqual(r.problems, []);
    assert.equal(r.applier, '.github/workflows/migrate-platform-db.yml:migrate');
  });

  test('🔴 a config that binds PLATFORM_DB and that no job deploys is named, not skipped', () => {
    const r = gradeOrder(undefined, [...REAL_CONFIGS, 'tooling/sites/zz-nowhere']);
    assert.match(r.problems.join('\n'), /tooling\/sites\/zz-nowhere\/wrangler\.jsonc binds PLATFORM_DB and no workflow job deploys it/);
  });

  test('platformDbConfigs reads bindings, not comments that name one', () => {
    const root = plantTree({
      'services/a/wrangler.jsonc': '{\n  // "binding": "PLATFORM_DB" is owned by services/platform\n  "name": "a"\n}\n',
      'services/b/wrangler.jsonc': '{ "d1_databases": [{ "binding": "PLATFORM_DB", "database_name": "platform_db" }] }\n',
      'tooling/sites/c/wrangler.jsonc': '{ "d1_databases": [{ "binding" : "PLATFORM_DB" }] }\n',
    });
    assert.deepEqual(platformDbConfigs(root), ['services/b', 'tooling/sites/c']);
  });
});
