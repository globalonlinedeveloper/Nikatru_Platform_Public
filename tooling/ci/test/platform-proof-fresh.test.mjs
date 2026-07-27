// ─────────────────────────────────────────────────────────────────────────────
// platform-proof-fresh.test.mjs — the freshness guard must be able to FAIL.
//
// [pipeline F-4 / F-10] guards.test.mjs notes that the two API-backed guards are
// covered "for argument and decision handling only". This one is deliberately
// built so the DECISION half is testable for real: the guard accepts a fixture
// run-list and a fixed clock, so every branch below exercises the same code path
// CI runs, with no network and no stubbing of the thing under test.
//
// The coverage self-check is exercised against a REAL mutated tree (a temp copy
// of the workflow with its schedule removed / commented out), not a hand-written
// fixture — assert-seams-wired.mjs shipped broken while all six of its fixture
// tests passed, because a fixture you write encodes the same misunderstanding as
// the guard you write.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, cpSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { evaluateFreshness, assertWatchedWorkflowIntact } from '../assert-platform-proof-fresh.mjs';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(CI_DIR, '..', '..');
const GUARD = join(CI_DIR, 'assert-platform-proof-fresh.mjs');
const NOW = '2026-07-27T12:00:00Z';
const NOW_MS = Date.parse(NOW);

let TMP;
before(() => {
  TMP = mkdtempSync(join(tmpdir(), 'nikatru-f4-'));
});
after(() => {
  rmSync(TMP, { recursive: true, force: true });
});

const run = (name, ...args) => {
  const file = join(TMP, name);
  return spawnSync(process.execPath, [GUARD, '--runs-file', file, '--now', NOW, ...args], {
    cwd: REPO,
    encoding: 'utf8',
  });
};
const fixture = (name, runs) => {
  writeFileSync(join(TMP, name), JSON.stringify(runs));
  return name;
};
const daysAgo = (n) => new Date(NOW_MS - n * 86_400_000).toISOString();

describe('evaluateFreshness — the decision', () => {
  test('a run inside the ceiling passes', () => {
    const v = evaluateFreshness([{ id: 1, conclusion: 'success', event: 'schedule', updated_at: daysAgo(3) }], NOW_MS);
    assert.equal(v.ok, true);
    assert.ok(Math.abs(v.ageDays - 3) < 0.01);
  });

  test('a run past the ceiling FAILS — this is the whole requirement', () => {
    const v = evaluateFreshness([{ id: 1, conclusion: 'success', event: 'schedule', updated_at: daysAgo(15) }], NOW_MS);
    assert.equal(v.ok, false);
    assert.match(v.reason, /15\.0 days old/);
  });

  test('exactly at the ceiling passes — the boundary is inclusive and pinned', () => {
    const v = evaluateFreshness([{ id: 1, conclusion: 'success', event: 'schedule', updated_at: daysAgo(14) }], NOW_MS);
    assert.equal(v.ok, true);
  });

  test('failed runs do not count as proof, however recent', () => {
    const v = evaluateFreshness(
      [
        { id: 1, conclusion: 'failure', updated_at: daysAgo(0) },
        { id: 2, conclusion: 'cancelled', updated_at: daysAgo(0) },
      ],
      NOW_MS,
    );
    assert.equal(v.ok, false);
    assert.match(v.reason, /no successful/);
  });

  test('the NEWEST success wins, not the first in the list', () => {
    const v = evaluateFreshness(
      [
        { id: 1, conclusion: 'success', event: 'schedule', updated_at: daysAgo(40) },
        { id: 2, conclusion: 'success', event: 'schedule', updated_at: daysAgo(2) },
      ],
      NOW_MS,
    );
    assert.equal(v.ok, true);
    assert.equal(v.runId, 2);
  });

  test('an empty history FAILS CLOSED — "never proven" is not "fine"', () => {
    const v = evaluateFreshness([], NOW_MS);
    assert.equal(v.ok, false);
  });

  test('a non-array answer FAILS CLOSED rather than throwing', () => {
    const v = evaluateFreshness(undefined, NOW_MS);
    assert.equal(v.ok, false);
    assert.match(v.reason, /not an array/);
  });

  test('an unparseable timestamp FAILS CLOSED', () => {
    const v = evaluateFreshness([{ id: 1, conclusion: 'success', event: 'schedule', updated_at: 'yesterday-ish' }], NOW_MS);
    assert.equal(v.ok, false);
  });
});

describe('the guard as CI runs it', () => {
  test('fresh proof exits 0 and names the run', () => {
    const f = fixture('fresh.json', [{ id: 999, conclusion: 'success', event: 'schedule', updated_at: daysAgo(1) }]);
    const r = run(f);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /platform proof fresh/);
    assert.match(r.stdout, /999/);
  });

  test('stale proof exits 1 and REFUSES to recommend a manual run', () => {
    const f = fixture('stale.json', [{ id: 1, conclusion: 'success', event: 'schedule', updated_at: daysAgo(30) }]);
    const r = run(f);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /not fresh/);
    // This used to assert the remedy was `gh workflow run` — advice that would
    // paper over the exact defect F-4 exists to catch, because a hand-press
    // resets the clock without proving the timer works. The guard must now say
    // the opposite, and the test has to move with it.
    assert.match(r.stderr, /MANUAL RUN NO LONGER SATISFIES THIS/);
    assert.doesNotMatch(r.stderr, /Refresh it with ONE command/);
  });

  test('a manual run cannot mask a STALE scheduled run — the live defect', () => {
    // All five real runs to date were workflow_dispatch, so the newest success
    // was always ~today and freshness always passed, whether or not the cron
    // had fired since March.
    const f = fixture('masked.json', [
      { id: 1, conclusion: 'success', event: 'schedule', updated_at: daysAgo(60) },
      { id: 2, conclusion: 'success', event: 'workflow_dispatch', updated_at: daysAgo(1) },
    ]);
    const r = run(f);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /60\.0 days old/);
  });

  test('no scheduled run at all is announced, not silently passed', () => {
    const f = fixture('manual-only.json', [
      { id: 1, conclusion: 'success', event: 'workflow_dispatch', updated_at: daysAgo(1) },
    ]);
    const r = run(f);
    // Before the dated deadline this is "not proven yet", not a regression —
    // but it must be impossible to miss, and it must not stay a warning forever.
    assert.equal(r.status, 0);
    assert.match(r.stdout, /NEVER run on its schedule/);
    assert.match(r.stdout, /hard failure on 2026-08-10/);
  });

  test('a missing fixture file fails rather than passing silently', () => {
    const r = run('does-not-exist.json');
    assert.equal(r.status, 1);
    assert.match(r.stderr, /could not read fixture/);
  });

  test('offline mode announces itself so it cannot hide in a CI log', () => {
    const f = fixture('announce.json', [{ id: 1, conclusion: 'success', event: 'schedule', updated_at: daysAgo(1) }]);
    const r = run(f);
    assert.match(r.stdout, /OFFLINE FIXTURE MODE/);
  });

  test('a bad --now is rejected, not silently treated as epoch 0', () => {
    const f = fixture('now.json', [{ id: 1, conclusion: 'success', event: 'schedule', updated_at: daysAgo(1) }]);
    const r = spawnSync(process.execPath, [GUARD, '--runs-file', join(TMP, f), '--now', 'not-a-date'], {
      cwd: REPO,
      encoding: 'utf8',
    });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /not a parseable date/);
  });
});

describe('coverage self-check — against a MUTATED REAL workflow, not a fixture', () => {
  const mutate = (transform) => {
    const root = mkdtempSync(join(tmpdir(), 'nikatru-f4-wf-'));
    const dir = join(root, '.github', 'workflows');
    mkdirSync(dir, { recursive: true });
    const real = readFileSync(join(REPO, '.github/workflows/build-platforms.yml'), 'utf8');
    writeFileSync(join(dir, 'build-platforms.yml'), transform(real));
    return root;
  };

  test('the real workflow, unmodified, passes', () => {
    const root = mutate((s) => s);
    assert.equal(assertWatchedWorkflowIntact(root), null);
    rmSync(root, { recursive: true, force: true });
  });

  test('workflow deleted -> COVERAGE LOST, not a silent pass', () => {
    const root = mkdtempSync(join(tmpdir(), 'nikatru-f4-empty-'));
    mkdirSync(join(root, '.github', 'workflows'), { recursive: true });
    assert.match(assertWatchedWorkflowIntact(root), /COVERAGE LOST.*does not exist/s);
    rmSync(root, { recursive: true, force: true });
  });

  test('schedule removed -> caught at the CAUSE, not 14 days later at the symptom', () => {
    const root = mutate((s) => s.replace(/\n\s+schedule:\n\s+- cron:[^\n]*/, ''));
    assert.match(assertWatchedWorkflowIntact(root), /declares no 'schedule:' trigger/);
    rmSync(root, { recursive: true, force: true });
  });

  test('schedule COMMENTED OUT is not mistaken for a live one', () => {
    // The F-6 trap in miniature: a scan that greps prose matches the comment
    // explaining the thing rather than the thing.
    const root = mutate((s) => s.replace(/(\n\s+)(schedule:)/, '$1# $2').replace(/(\n\s+)(- cron:)/, '$1# $2'));
    assert.match(assertWatchedWorkflowIntact(root), /COVERAGE LOST/);
    rmSync(root, { recursive: true, force: true });
  });
});
