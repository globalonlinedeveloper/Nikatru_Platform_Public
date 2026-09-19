// ─────────────────────────────────────────────────────────────────────────────
// assert-deploy-triggers-deploy.test.mjs — the guard must be able to FAIL, and
// must fail on the EXACT shape that shipped.
//
// 🔴 A FIXTURE PASSING IS NOT A GUARD WORKING. This repo has a recorded case
// where all six of a guard's fixture tests passed against a provably broken
// guard, because the fixtures encoded the same misunderstanding as the guard.
// So the second suite runs the parser over the REAL workflow tree and asserts
// on what it finds there — if those files are reformatted such that the parser
// stops seeing the blocks, this test goes red instead of quietly passing over
// an empty set.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  judge,
  parseTriggerPaths,
  parseFilters,
  workflowFiles,
  usesPathsFilter,
  WORKFLOW_DIR,
  MIN_TRIGGER_PATHS,
  MIN_FILTERS,
  MIN_FILTERED_WORKFLOWS,
} from '../assert-deploy-triggers-deploy.mjs';

// Built, not imported: the guard deliberately exports no workflow filename, and
// a test that imported one would reintroduce the lane binding that
// assert-release-lane-generic.mjs limb B exists to reject.
const SELF = '.github/workflows/example-deploy.yml';
const OK_TRIGGERS = ['services/subscriptiontracker-api/**', 'services/platform/**', SELF];
const OK_FILTERS = {
  subscriptiontracker_api: ['services/subscriptiontracker-api/**', SELF],
  platform: ['services/platform/**', SELF],
};

describe('assert-deploy-triggers-deploy — the decision', () => {
  test('PASSES when every trigger is claimed and both filters include the workflow', () => {
    assert.deepEqual(judge(OK_TRIGGERS, OK_FILTERS, SELF), []);
  });

  test('🔴 THE BUG THAT SHIPPED: the workflow triggers but no filter claims it', () => {
    // deploy-workers.yml as it stood on 2026-08-04. `on.push.paths` listed the
    // workflow; the paths-filter did not. Run 30933229005 skipped both deploy
    // jobs and reported SUCCESS.
    const problems = judge(
      OK_TRIGGERS,
      { subscriptiontracker_api: ['services/subscriptiontracker-api/**'], platform: ['services/platform/**'] },
      SELF,
    );
    assert.ok(problems.length >= 1, 'the pre-fix state must not pass');
    assert.ok(
      problems.some((p) => p.includes(SELF) && p.includes('NO filter')),
      `expected a "triggers but appears in NO filter" problem, got:\n${problems.join('\n')}`,
    );
  });

  test('🔴 FAILS when only ONE filter includes the workflow — half a proof is not a proof', () => {
    const problems = judge(
      OK_TRIGGERS,
      { subscriptiontracker_api: ['services/subscriptiontracker-api/**', SELF], platform: ['services/platform/**'] },
      SELF,
    );
    assert.ok(problems.some((p) => p.includes('filter `platform` does not include')));
  });

  test('🔴 FAILS on any unclaimed trigger path, not just the workflow one', () => {
    // A third service added to the trigger list and forgotten in the filter is
    // the same defect wearing a different name.
    const problems = judge([...OK_TRIGGERS, 'services/newapp-api/**'], OK_FILTERS, SELF);
    assert.ok(problems.some((p) => p.includes('services/newapp-api/**') && p.includes('NO filter')));
  });

  test('the subject workflow is a PARAMETER, so the same decision serves any lane', () => {
    // The guard names no workflow in code. Proving the decision works for a
    // path it has never seen is what makes that real rather than cosmetic.
    const other = '.github/workflows/some-other-lane.yaml';
    assert.deepEqual(judge(['pkg/**', other], { only: ['pkg/**', other] }, other), []);
    assert.ok(judge(['pkg/**', other], { only: ['pkg/**'] }, other).length >= 1);
  });

  // ── REQUIRED_COVERAGE — the guard must refuse to pass over an empty set ────
  test('🔴 COVERAGE LOST when the trigger list cannot be parsed', () => {
    for (const bad of [null, []]) {
      const problems = judge(bad, OK_FILTERS, SELF);
      assert.ok(
        problems.some((p) => p.includes('COVERAGE LOST')),
        `parsing ${JSON.stringify(bad)} trigger paths must be COVERAGE LOST, not a pass`,
      );
    }
  });

  test('🔴 COVERAGE LOST when the filters cannot be parsed', () => {
    for (const bad of [null, {}]) {
      assert.ok(judge(OK_TRIGGERS, bad, SELF).some((p) => p.includes('COVERAGE LOST')));
    }
  });

  test('the floor detects a parse that read NOTHING — it does not mandate a count', () => {
    // A single trigger path and a single filter is a legitimate one-service
    // workflow, not a broken parse. The floors were 2 when this guard named one
    // workflow, and generalising it made that an invented limit that would have
    // failed a correct input — the shape that gets a check deleted.
    assert.deepEqual(judge([SELF], { only: [SELF] }, SELF), []);
  });

  test('COVERAGE LOST short-circuits — it never reports a comparison it could not make', () => {
    // Reporting "every trigger is claimed" alongside "I parsed nothing" is the
    // exact shape of a guard that has stopped checking and still prints OK.
    assert.ok(judge([], {}, SELF).every((p) => p.includes('COVERAGE LOST')));
  });
});

describe('assert-deploy-triggers-deploy — against the REAL workflow tree', () => {
  const files = workflowFiles();

  test('the tree has workflows, and at least one gates jobs behind a paths-filter', () => {
    assert.ok(files.length > 0, 'no workflow files discovered — the guard would scan nothing');
    const filtered = files.filter((f) => usesPathsFilter(readFileSync(resolve(WORKFLOW_DIR, f), 'utf8')));
    assert.ok(
      filtered.length >= MIN_FILTERED_WORKFLOWS,
      `expected >= ${MIN_FILTERED_WORKFLOWS} filtered workflow(s), found ${filtered.length}`,
    );
  });

  test('every filtered workflow parses, and currently satisfies the guard', () => {
    let asserted = 0;
    for (const f of files) {
      const text = readFileSync(resolve(WORKFLOW_DIR, f), 'utf8');
      if (!usesPathsFilter(text)) continue;
      const triggerPaths = parseTriggerPaths(text);
      if (triggerPaths === null) continue; // dispatch-only: no trigger path to strand
      const filters = parseFilters(text);

      assert.ok(
        triggerPaths.length >= MIN_TRIGGER_PATHS,
        `${f}: expected >= ${MIN_TRIGGER_PATHS} trigger paths, got ${triggerPaths.length}`,
      );
      assert.ok(filters && Object.keys(filters).length >= MIN_FILTERS, `${f}: filters parsed empty`);
      // The header comment and this guard's own name both mention workflow
      // files; a grep-based reader would count those as coverage.
      for (const [name, list] of Object.entries(filters)) {
        assert.ok(Array.isArray(list) && list.length > 0, `${f}: filter ${name} parsed empty`);
        for (const p of list) assert.ok(!p.startsWith('#'), `${f}: filter ${name} picked up a comment: ${p}`);
      }
      assert.deepEqual(judge(triggerPaths, filters, `.github/workflows/${f}`), [], `${f} does not satisfy the guard`);
      asserted += 1;
    }
    assert.ok(asserted >= MIN_FILTERED_WORKFLOWS, `asserted over ${asserted} workflow(s) — the loop ran dry`);
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
const spawnIn = (workflows) => {
  const root = mkdtempSync(joinPath(tmpdir(), 'dtd-exit-'));
  mkdirSync(joinPath(root, 'tooling', 'ci'), { recursive: true });
  for (const f of ['assert-deploy-triggers-deploy.mjs', 'tree-walk.mjs']) cpSync(joinPath(CI_SRC, f), joinPath(root, 'tooling', 'ci', f));
  mkdirSync(joinPath(root, '.github', 'workflows'), { recursive: true });
  for (const [name, text] of Object.entries(workflows)) writeFixture(joinPath(root, '.github', 'workflows', name), text);
  const r = spawnSync(process.execPath, [joinPath(root, 'tooling', 'ci', 'assert-deploy-triggers-deploy.mjs')], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
};

describe('assert-deploy-triggers-deploy — exit codes', () => {
  test('🔴 a workflow directory with nothing in it is COVERAGE LOST — exit 2, not a finding', () => {
    const { code, out } = spawnIn({});
    assert.match(out, /COVERAGE LOST: no workflow files/);
    assert.equal(code, 2, out);
  });

  test('a real finding keeps exit 1 even with a COVERAGE LOST stop beside it', () => {
    const wf = [
      'on:',
      '  push:',
      '    paths:',
      "      - 'services/a/**'",
      "      - '.github/workflows/d.yml'",
      'jobs:',
      '  changes:',
      '    steps:',
      '      - uses: dorny/paths-filter@v3',
      '        with:',
      '          filters: |',
      '            a:',
      "              - 'services/a/**'",
      '',
    ].join('\n');
    const { code, out } = spawnIn({ 'd.yml': wf });
    assert.match(out, /does not include `\.github\/workflows\/d\.yml`|NO filter/);
    assert.equal(code, 1, out);
  });
});

// ── LIMB 3 · judgeImports, on a planted tree ─────────────────────────────────
// The header says limb 3 reads its subject off the tree: the tree under every `X/**`
// glob is READ, and each relative import resolving OUTSIDE `X` must be claimed
// by that same filter AND by `on.push.paths`. Nothing above reached it — the
// real-tree case calls `judge` (limbs 1-2) only. These cases plant a tree the
// guard has never seen, so a typed list of today's imports cannot pass them.
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
  test('🔴 an import escaping a claimed tree, claimed by NEITHER the filter nor on.push.paths, is TWO findings', () => {
    const root = plantTree(PLANTED);
    const r = judgeImports(root, ['svc/alpha/**', 'svc/beta/**'], {
      alpha: ['svc/alpha/**'],
      beta: ['svc/beta/**'],
    });
    assert.ok(r.scanned >= 2, `the walk read ${r.scanned} file(s) — it must read the planted tree`);
    assert.deepEqual(
      r.external.map((e) => [e.name, e.from, e.target]),
      [['alpha', 'svc/alpha/src/index.ts', 'svc/shared/chassis-zq.ts']],
    );
    assert.equal(r.problems.length, 2, r.problems.join('\n'));
    assert.ok(r.problems.some((p) => p.includes('filter `alpha`') && p.includes('svc/shared/chassis-zq.ts')));
    assert.ok(r.problems.some((p) => p.includes('`on.push.paths` claims it') && p.includes('svc/shared/chassis-zq.ts')));
  });

  test('claimed by the filter but NOT by on.push.paths is still a finding — both limbs are required', () => {
    const root = plantTree(PLANTED);
    const r = judgeImports(root, ['svc/alpha/**', 'svc/beta/**'], {
      alpha: ['svc/alpha/**', 'svc/shared/chassis-zq.ts'],
      beta: ['svc/beta/**'],
    });
    assert.equal(r.problems.length, 1, r.problems.join('\n'));
    assert.match(r.problems[0], /NO path in `on\.push\.paths`/);
  });

  test('the asymmetry is DERIVED: the carrier that imports nothing external is not asked to claim the shared file', () => {
    const root = plantTree(PLANTED);
    const r = judgeImports(root, ['svc/alpha/**', 'svc/beta/**', 'svc/shared/*.ts'], {
      alpha: ['svc/alpha/**', 'svc/shared/*.ts'],
      beta: ['svc/beta/**'],
    });
    assert.deepEqual(r.problems, []);
    assert.equal(r.external.length, 1);
  });

  test('an escape from a test/ directory, and a specifier that resolves to nothing, demand nothing', () => {
    const root = plantTree({
      ...PLANTED,
      'svc/beta/test/x.test.ts': "import '../../shared/chassis-zq.ts';\n",
      'svc/beta/src/ghost.ts': "import { g } from '../../nowhere/ghost.ts';\n",
    });
    const r = judgeImports(root, ['svc/alpha/**', 'svc/beta/**', 'svc/shared/**'], {
      alpha: ['svc/alpha/**', 'svc/shared/**'],
      beta: ['svc/beta/**'],
    });
    assert.deepEqual(r.problems, []);
    assert.deepEqual(r.external.map((e) => e.name), ['alpha']);
  });

  test('a glob shape the reader cannot decide is COVERAGE LOST, never a silent "not claimed"', () => {
    const root = plantTree(PLANTED);
    const r = judgeImports(root, ['svc/alpha/**', 'svc/beta/**', 'svc/sha?ed/*.ts'], {
      alpha: ['svc/alpha/**', 'svc/sha?ed/*.ts'],
      beta: ['svc/beta/**'],
    });
    assert.ok(r.problems.length >= 1);
    assert.ok(r.problems.every((p) => p.startsWith('COVERAGE LOST')), r.problems.join('\n'));
  });
});
