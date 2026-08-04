// ─────────────────────────────────────────────────────────────────────────────
// assert-deploy-triggers-deploy.test.mjs — the guard must be able to FAIL, and
// must fail on the EXACT shape that shipped.
//
// 🔴 A FIXTURE PASSING IS NOT A GUARD WORKING. This repo has a recorded case
// where all six of a guard's fixture tests passed against a provably broken
// guard, because the fixtures encoded the same misunderstanding as the guard.
// So the last test here runs the parser over the REAL workflow file and asserts
// on what it finds there — if that file is reformatted such that the parser
// stops seeing the blocks, this test goes red instead of quietly passing over
// an empty set.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  judge,
  parseTriggerPaths,
  parseFilters,
  WORKFLOW,
  SELF_PATH,
  MIN_TRIGGER_PATHS,
  MIN_FILTERS,
} from '../assert-deploy-triggers-deploy.mjs';

const OK_TRIGGERS = ['services/subly-api/**', 'services/platform/**', SELF_PATH];
const OK_FILTERS = {
  subly_api: ['services/subly-api/**', SELF_PATH],
  platform: ['services/platform/**', SELF_PATH],
};

describe('assert-deploy-triggers-deploy — the decision', () => {
  test('PASSES when every trigger is claimed and both filters include the workflow', () => {
    assert.deepEqual(judge(OK_TRIGGERS, OK_FILTERS), []);
  });

  test('🔴 THE BUG THAT SHIPPED: the workflow triggers but no filter claims it', () => {
    // deploy-workers.yml as it stood on 2026-08-04. `on.push.paths` listed the
    // workflow; the paths-filter did not. Run 30933229005 skipped both deploy
    // jobs and reported SUCCESS.
    const problems = judge(OK_TRIGGERS, {
      subly_api: ['services/subly-api/**'],
      platform: ['services/platform/**'],
    });
    assert.ok(problems.length >= 1, 'the pre-fix state must not pass');
    assert.ok(
      problems.some((p) => p.includes(SELF_PATH) && p.includes('NO filter')),
      `expected a "triggers but appears in NO filter" problem, got:\n${problems.join('\n')}`,
    );
  });

  test('🔴 FAILS when only ONE filter includes the workflow — half a proof is not a proof', () => {
    const problems = judge(OK_TRIGGERS, {
      subly_api: ['services/subly-api/**', SELF_PATH],
      platform: ['services/platform/**'],
    });
    assert.ok(problems.some((p) => p.includes('filter `platform` does not include')));
  });

  test('🔴 FAILS on any unclaimed trigger path, not just the workflow one', () => {
    // A third service added to the trigger list and forgotten in the filter is
    // the same defect wearing a different name.
    const problems = judge([...OK_TRIGGERS, 'services/newapp-api/**'], OK_FILTERS);
    assert.ok(problems.some((p) => p.includes('services/newapp-api/**') && p.includes('NO filter')));
  });

  // ── REQUIRED_COVERAGE — the guard must refuse to pass over an empty set ────
  test('🔴 COVERAGE LOST when the trigger list cannot be parsed', () => {
    for (const bad of [null, [], ['only-one']]) {
      const problems = judge(bad, OK_FILTERS);
      assert.ok(
        problems.some((p) => p.includes('COVERAGE LOST')),
        `parsing ${JSON.stringify(bad)} trigger paths must be COVERAGE LOST, not a pass`,
      );
    }
  });

  test('🔴 COVERAGE LOST when the filters cannot be parsed', () => {
    for (const bad of [null, {}, { only: [SELF_PATH] }]) {
      const problems = judge(OK_TRIGGERS, bad);
      assert.ok(problems.some((p) => p.includes('COVERAGE LOST')));
    }
  });

  test('COVERAGE LOST short-circuits — it never reports a comparison it could not make', () => {
    // Reporting "every trigger is claimed" alongside "I parsed nothing" is the
    // exact shape of a guard that has stopped checking and still prints OK.
    const problems = judge([], {});
    assert.ok(problems.every((p) => p.includes('COVERAGE LOST')));
  });
});

describe('assert-deploy-triggers-deploy — the parser, against the REAL workflow', () => {
  const text = readFileSync(WORKFLOW, 'utf8');

  test('parses on.push.paths structurally, not by matching text', () => {
    const paths = parseTriggerPaths(text);
    assert.ok(Array.isArray(paths), 'on.push.paths must be reachable by walking the nesting');
    assert.ok(
      paths.length >= MIN_TRIGGER_PATHS,
      `expected >= ${MIN_TRIGGER_PATHS} trigger paths in the real file, got ${paths.length}`,
    );
    assert.ok(paths.includes(SELF_PATH));
  });

  test('parses the filters block, and does NOT pick up the header comment', () => {
    // The header comment on line 3 and this guard's own name now both mention
    // `deploy-workers.yml`. A grep-based reader would count those as coverage.
    const filters = parseFilters(text);
    assert.ok(filters, 'the filters block scalar must be reachable');
    assert.ok(Object.keys(filters).length >= MIN_FILTERS);
    for (const [name, list] of Object.entries(filters)) {
      assert.ok(Array.isArray(list) && list.length > 0, `filter ${name} parsed empty`);
      for (const p of list) {
        assert.ok(!p.startsWith('#'), `filter ${name} picked up a comment line: ${p}`);
      }
    }
  });

  test('the REAL workflow currently satisfies the guard', () => {
    assert.deepEqual(judge(parseTriggerPaths(text), parseFilters(text)), []);
  });
});
