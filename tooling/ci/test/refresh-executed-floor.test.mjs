// ─────────────────────────────────────────────────────────────────────────────
// refresh-executed-floor.test.mjs — the only writer of executed-floor.json must
// keep MAX(old, new), refuse a vanished suite, lower ONLY on a named reason, and
// refuse any run that is not a green ci.yml push to main.
//
// Register row: O-COVERAGE-MANIFEST-LOOP-CASES, option (1).
// The network half (gh api / gh run download) is not exercised here; the pure
// functions it feeds are, and the CLI's argument rail is spawned for real.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  mergeExecutedFloor,
  parseRefreshArgs,
  runRefusals,
  WORKFLOW_PATH,
} from '../../scripts/refresh-executed-floor.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(HERE, '..', '..', 'scripts', 'refresh-executed-floor.mjs');

const GREEN_MAIN = {
  path: WORKFLOW_PATH,
  head_branch: 'main',
  event: 'push',
  status: 'completed',
  conclusion: 'success',
  head_repository: { full_name: 'o/r' },
  repository: { full_name: 'o/r' },
};

describe('refresh-executed-floor — the merge', () => {
  test('each floored suite keeps MAX(old, new) — a low run never lowers it', () => {
    const m = mergeExecutedFloor({ 'a.test.mjs': 10, 'b.test.mjs': 5 }, new Map([['a.test.mjs', 8], ['b.test.mjs', 7]]));
    assert.deepEqual(m.errors, []);
    assert.deepEqual(m.suites, { 'a.test.mjs': 10, 'b.test.mjs': 7 });
    assert.deepEqual(m.raised, [{ suite: 'b.test.mjs', from: 5, to: 7 }]);
  });

  test('a suite new to the report joins at its executed count', () => {
    const m = mergeExecutedFloor({}, new Map([['n.test.mjs', 4]]));
    assert.deepEqual(m.suites, { 'n.test.mjs': 4 });
    assert.deepEqual(m.joined, [{ suite: 'n.test.mjs', to: 4 }]);
  });

  test('a floored suite ABSENT from the run is refused, never silently dropped', () => {
    const m = mergeExecutedFloor({ 'gone.test.mjs': 3 }, new Map([['a.test.mjs', 1]]));
    assert.equal(m.errors.length, 1);
    assert.match(m.errors[0], /gone\.test\.mjs has floor 3 but is ABSENT/);
  });

  test('--lower changes ONLY the named suite, so the lowering is its own commit', () => {
    const m = mergeExecutedFloor(
      { 'a.test.mjs': 10, 'b.test.mjs': 5 },
      new Map([['a.test.mjs', 8], ['b.test.mjs', 9], ['new.test.mjs', 2]]),
      [{ suite: 'a.test.mjs', reason: 'two rows retired with the old host' }],
    );
    assert.deepEqual(m.errors, []);
    assert.deepEqual(m.suites, { 'a.test.mjs': 8, 'b.test.mjs': 5 });
    assert.deepEqual(m.lowered, [{ suite: 'a.test.mjs', from: 10, to: 8, reason: 'two rows retired with the old host' }]);
    assert.deepEqual(m.raised, []);
    assert.deepEqual(m.joined, []);
  });

  test('--lower of a suite the run no longer has REMOVES it', () => {
    const m = mergeExecutedFloor({ 'gone.test.mjs': 3, 'a.test.mjs': 1 }, new Map([['a.test.mjs', 1]]), [
      { suite: 'gone.test.mjs', reason: 'suite retired' },
    ]);
    assert.deepEqual(m.suites, { 'a.test.mjs': 1 });
    assert.equal(m.lowered[0].to, null);
  });

  test('--lower that lowers nothing, or names an unfloored suite, is refused', () => {
    const m = mergeExecutedFloor({ 'a.test.mjs': 5 }, new Map([['a.test.mjs', 6]]), [
      { suite: 'a.test.mjs', reason: 'x' },
      { suite: 'z.test.mjs', reason: 'y' },
    ]);
    assert.equal(m.errors.length, 2);
    assert.match(m.errors[0], /nothing to lower/);
    assert.match(m.errors[1], /no executed floor to lower/);
  });
});

describe('refresh-executed-floor — which runs may fill the floor', () => {
  test('a green ci.yml push to main in the same repository is accepted', () => {
    assert.deepEqual(runRefusals(GREEN_MAIN), []);
  });

  test('a failed run, a branch run, a PR event, another workflow and a fork are each refused', () => {
    assert.match(runRefusals({ ...GREEN_MAIN, conclusion: 'failure' }).join(), /conclusion/);
    assert.match(runRefusals({ ...GREEN_MAIN, head_branch: 'feat/x' }).join(), /branch/);
    assert.match(runRefusals({ ...GREEN_MAIN, event: 'pull_request' }).join(), /event/);
    assert.match(runRefusals({ ...GREEN_MAIN, path: '.github/workflows/deploy.yml' }).join(), /workflow/);
    assert.match(runRefusals({ ...GREEN_MAIN, head_repository: { full_name: 'fork/r' } }).join(), /head repository/);
    assert.match(runRefusals({ ...GREEN_MAIN, status: 'in_progress' }).join(), /status/);
    assert.deepEqual(runRefusals(null), ['the run metadata could not be read']);
  });
});

describe('refresh-executed-floor — arguments', () => {
  test('parseRefreshArgs reads a run id and --lower/--reason pairs', () => {
    assert.deepEqual(parseRefreshArgs(['123', '--lower', 'a.test.mjs', '--reason', 'retired rows']), {
      runId: 123,
      lowers: [{ suite: 'a.test.mjs', reason: 'retired rows' }],
      errors: [],
    });
  });

  test('--lower without --reason, a missing run id and a stray argument are errors', () => {
    assert.match(parseRefreshArgs(['123', '--lower', 'a.test.mjs']).errors.join(), /needs --reason/);
    assert.match(parseRefreshArgs([]).errors.join(), /no numeric <run-id>/);
    assert.match(parseRefreshArgs(['123', '--junit', 'x.xml']).errors.join(), /unrecognised argument/);
  });

  test('the CLI with no run id exits 2 and writes nothing', () => {
    const r = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' });
    assert.equal(r.status, 2);
    assert.match(`${r.stdout}${r.stderr}`, /COVERAGE LOST — no numeric <run-id>/);
    assert.match(`${r.stdout}${r.stderr}`, /nothing written/);
  });
});
