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
const OK_TRIGGERS = ['services/subly-api/**', 'services/platform/**', SELF];
const OK_FILTERS = {
  subly_api: ['services/subly-api/**', SELF],
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
      { subly_api: ['services/subly-api/**'], platform: ['services/platform/**'] },
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
      { subly_api: ['services/subly-api/**', SELF], platform: ['services/platform/**'] },
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
