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

import {
  evaluateFreshness,
  evaluateProvenance,
  changedProofInputs,
  gitAncestry,
  assertWatchedWorkflowIntact,
  platformProofCoverage,
  impliedIntervalDays,
  cronFieldValues,
  reportProvenance,
  blankStringLiterals,
  flutterBuildTargets,
  requiredTargets,
  PLATFORM_BUILD_TARGETS,
  PROOF_INPUT_PATHS,
} from '../assert-platform-proof-fresh.mjs';
import { parseWorkflow } from '../workflow-scan.mjs';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(CI_DIR, '..', '..');
const GUARD = join(CI_DIR, 'assert-platform-proof-fresh.mjs');
const NOW = '2026-07-27T12:00:00Z';
const NOW_MS = Date.parse(NOW);

/** The commit under test, read from the repository rather than typed, so these
 *  cases keep meaning the same thing after every merge. */
const HEAD_SHA = spawnSync('git', ['-C', REPO, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
const UNKNOWN_SHA = 'f'.repeat(40);

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
/** Every run object the API returns carries `head_sha`, and the provenance
 *  clause refuses a list that does not — so the default is stamped here and the
 *  cases that are ABOUT the sha write their own. Without this every case below
 *  would be testing two things at once and reporting the wrong one. */
const fixture = (name, runs) => {
  writeFileSync(join(TMP, name), JSON.stringify(runs.map((r) => ({ head_sha: HEAD_SHA, ...r }))));
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

// ─────────────────────────────────────────────────────────────────────────────
// 🔴 THE PROOF'S COMMIT, NOT ONLY ITS TIMESTAMP.
//
// THE RECORDED LIVE DEFECT (2026-08-11): the only six-platform proof was
// produced on 255265b, SEVENTEEN commits behind main and behind both the Flutter
// pin bump and the auth reversal — and every clause in this file passed, because
// that commit's own date was one day old. Age grades the run; nothing graded the
// code. The stale commit below is DERIVED from the repository (the parent of the
// newest commit that touched a build input) rather than typed, so this case
// keeps describing a genuinely stale proof after any number of merges.
// ─────────────────────────────────────────────────────────────────────────────
const gitOut = (...args) => spawnSync('git', ['-C', REPO, ...args], { encoding: 'utf8' }).stdout.trim();

/** A commit that predates a change to the build's own inputs — the exact shape
 *  of the live defect, taken from the real history. */
const STALE_SHA = (() => {
  const newestInputChange = gitOut('log', '-1', '--format=%H', '--', 'tooling/versions.json', '.github/workflows/build-platforms.yml');
  return newestInputChange ? gitOut('rev-parse', `${newestInputChange}^`) : '';
})();

describe('the proof COMMIT is graded, not only its age', () => {
  test('the derived stale commit really is stale — otherwise every case below is vacuous', () => {
    assert.match(STALE_SHA, /^[0-9a-f]{40}$/, 'no commit in this history has ever changed a build input');
    const rel = gitAncestry(STALE_SHA, HEAD_SHA, REPO);
    assert.equal(rel.decidable, true);
    assert.equal(rel.ancestor, true, 'the derived commit must be on this history');
    assert.ok(rel.drift >= 1, 'the derived commit must be BEHIND HEAD');
    assert.ok(rel.inputs.length >= 1, `nothing classifies as a build input between ${STALE_SHA} and HEAD`);
  });

  describe('changedProofInputs — which changes make a proof stale', () => {
    test('the three input families are recognised', () => {
      const hits = changedProofInputs([
        '.github/workflows/build-platforms.yml',
        'tooling/versions.json',
        'apps/subly/pubspec.yaml',
        'packages/core/pubspec.lock',
      ]);
      assert.equal(hits.length, 4);
      for (const h of hits) assert.ok(h.why.length > 0, 'every input names why its change matters');
    });

    test('ordinary source drift is NOT an input change — a rule that fires on every commit gets switched off', () => {
      assert.deepEqual(
        changedProofInputs(['apps/subly/lib/features/home/home_screen.dart', 'docs/architecture.md', 'sites/nikatru/index.html']),
        [],
      );
    });

    // The exclusion is load-bearing: no lane in build-platforms.yml compiles the
    // brick's pubspec, so counting it would red the build for editing a file the
    // proof never read.
    test('the brick TEMPLATE pubspec is excluded — the proof never compiles it', () => {
      assert.deepEqual(changedProofInputs(['tooling/bricks/app/__brick__/apps/{{app_id}}/pubspec.yaml']), []);
    });

    test('backslash paths are normalised, so a Windows caller is not silently exempt', () => {
      assert.equal(changedProofInputs(['tooling\\versions.json']).length, 1);
    });

    test('every declared input pattern has an input that reaches it', () => {
      for (const { re } of PROOF_INPUT_PATHS) {
        const sample = ['.github/workflows/build-platforms.yml', 'tooling/versions.json', 'apps/subly/pubspec.yaml'].find((p) => re.test(p));
        assert.ok(sample, `no sample path reaches ${re} — an exemption or a matcher nobody can write the input for`);
      }
    });
  });

  describe('gitAncestry — the three-state answer', () => {
    test('the graded commit is its own ancestor, with zero drift and no input change', () => {
      const rel = gitAncestry(HEAD_SHA, HEAD_SHA, REPO);
      assert.deepEqual({ decidable: rel.decidable, ancestor: rel.ancestor, drift: rel.drift, inputs: rel.inputs }, {
        decidable: true,
        ancestor: true,
        drift: 0,
        inputs: [],
      });
    });

    test('a commit AHEAD of the graded one is not an ancestor', () => {
      const rel = gitAncestry(HEAD_SHA, STALE_SHA, REPO);
      assert.equal(rel.decidable, true);
      assert.equal(rel.ancestor, false);
    });

    // The shallow-clone case, which is the one that must never read as a pass.
    test('a commit this clone has never seen is UNDECIDABLE, not "no"', () => {
      const rel = gitAncestry(UNKNOWN_SHA, HEAD_SHA, REPO);
      assert.equal(rel.decidable, false);
      assert.match(rel.why, /object store/);
    });

    test('a directory that is not a repository is UNDECIDABLE', () => {
      const rel = gitAncestry(HEAD_SHA, HEAD_SHA, TMP);
      assert.equal(rel.decidable, false);
    });
  });

  describe('evaluateProvenance — the decision', () => {
    const decidable = (over) => (sha) => ({ decidable: true, ancestor: true, drift: 0, inputs: [], ...(over?.[sha] ?? {}) });
    const never = () => ({ decidable: false, why: 'a shallow clone' });
    const success = (over = {}) => ({ id: 1, conclusion: 'success', updated_at: '2026-08-11T00:00:00Z', head_sha: 'a'.repeat(40), ...over });

    test('a run on the graded commit passes', () => {
      const v = evaluateProvenance([success()], 'a'.repeat(40), decidable());
      assert.equal(v.kind, 'current');
    });

    // 🔴 THE LIVE DEFECT, as a decision. Age said fresh; the commit was 17 behind.
    test('a proof behind a build-input change is NOT current', () => {
      const v = evaluateProvenance([success()], 'b'.repeat(40), decidable({ ['a'.repeat(40)]: { drift: 17, inputs: [{ file: 'tooling/versions.json', why: 'x' }] } }));
      assert.equal(v.kind, 'inputsChanged');
      assert.equal(v.drift, 17);
    });

    test('source drift alone is still current — the proof is behind, not invalid', () => {
      const v = evaluateProvenance([success()], 'b'.repeat(40), decidable({ ['a'.repeat(40)]: { drift: 9, inputs: [] } }));
      assert.equal(v.kind, 'current');
      assert.equal(v.drift, 9);
    });

    test('a proof on another history is FOREIGN, not merely behind', () => {
      const v = evaluateProvenance([success()], 'b'.repeat(40), () => ({ decidable: true, ancestor: false, drift: 0, inputs: [] }));
      assert.equal(v.kind, 'foreign');
      assert.match(v.reason, /not in this history/);
    });

    // The whole reason a run list without shas cannot be waved through: it is
    // exactly what a proof pinned to an old ref looks like from the outside.
    test('no head_sha anywhere FAILS CLOSED', () => {
      const v = evaluateProvenance([{ id: 1, conclusion: 'success', updated_at: '2026-08-11T00:00:00Z' }], 'b'.repeat(40), decidable());
      assert.equal(v.kind, 'unreadable');
      assert.match(v.reason, /NOT ONE carries a 40-hex/);
    });

    test('a short sha is refused rather than resolved', () => {
      const v = evaluateProvenance([success({ head_sha: '255265b' })], 'b'.repeat(40), decidable());
      assert.equal(v.kind, 'unreadable');
    });

    test('an empty history FAILS CLOSED', () => {
      assert.equal(evaluateProvenance([], 'b'.repeat(40), decidable()).kind, 'unreadable');
      assert.equal(evaluateProvenance(undefined, 'b'.repeat(40), decidable()).kind, 'unreadable');
    });

    // The fallback the requirement names: when ancestry is underivable, equality
    // with the graded commit is the strictest thing left.
    test('undecidable + a sha EQUAL to the graded commit still passes', () => {
      const v = evaluateProvenance([success({ head_sha: 'c'.repeat(40) })], 'c'.repeat(40), never);
      assert.equal(v.kind, 'current');
      assert.equal(v.viaEquality, true);
    });

    test('undecidable + no equality PRINTS THE GAP rather than passing or failing', () => {
      const v = evaluateProvenance([success()], 'c'.repeat(40), never);
      assert.equal(v.kind, 'undecidable');
      assert.match(v.why, /shallow clone/);
    });

    // A dispatch on the branch that changed the inputs is the remedy, so it has
    // to be a candidate. Counting only `schedule` here would leave the failure
    // with nothing that can discharge it.
    test('a workflow_dispatch run counts for provenance, unlike for freshness', () => {
      const v = evaluateProvenance([success({ event: 'workflow_dispatch' })], 'a'.repeat(40), decidable());
      assert.equal(v.kind, 'current');
    });

    // Fewest gaps wins, and here that is the newest run — an older proof can
    // only have MORE input changes behind it, so the two orderings agree except
    // across a revert, where "some green build compiled exactly these inputs" is
    // true and passing is the right answer.
    test('the candidate with the fewest input gaps wins', () => {
      const stale = 'a'.repeat(40);
      const older = 'd'.repeat(40);
      const v = evaluateProvenance(
        [success({ id: 2, head_sha: stale, updated_at: '2026-08-11T00:00:00Z' }), success({ id: 1, head_sha: older, updated_at: '2026-08-01T00:00:00Z' })],
        'b'.repeat(40),
        decidable({
          [stale]: { drift: 17, inputs: [{ file: 'tooling/versions.json', why: 'x' }] },
          [older]: { drift: 40, inputs: [{ file: 'apps/subly/pubspec.yaml', why: 'y' }, { file: 'tooling/versions.json', why: 'x' }] },
        }),
      );
      assert.equal(v.kind, 'inputsChanged');
      assert.equal(v.run.id, 2, 'the fewest-gaps candidate is the newest one here');
    });
  });

  describe('the commit clause as CI runs it, against the REAL repository', () => {
    const at = (name, runs, now, ...extra) => {
      const f = fixture(name, runs);
      return spawnSync(process.execPath, [GUARD, '--runs-file', join(TMP, f), '--now', now, ...extra], { cwd: REPO, encoding: 'utf8' });
    };
    const green = (over = {}) => ({ id: 700, conclusion: 'success', event: 'schedule', updated_at: '2026-08-11T00:00:00Z', ...over });

    test('a proof on HEAD passes and SAYS which commit it compiled', () => {
      const r = at('prov-head.json', [green()], '2026-08-11T12:00:00Z');
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stdout, /platform proof provenance — run 700 compiled/);
      assert.match(r.stdout, new RegExp(HEAD_SHA.slice(0, 7)));
    });

    // 🔴 THE INPUT-CURRENCY CLAUSE PRINTS AND DOES NOT FAIL — ON ANY DATE.
    //
    // It shipped as a dated tripwire (print until 2026-08-25, hard failure
    // after) and the date was removed on review. Measured reason, on the real
    // history since 2026-07-01: 38 of 592 commits touched
    // versions.json/build-platforms.yml and 38 touched a tracked pubspec, so
    // roughly one PR in eight would have started failing on a day nobody chose
    // — and the only remedy is a six-platform dispatch, i.e. owner runner
    // budget. This repo's rule for an owner-gated gap is to PRINT it on every
    // run rather than block CI on it.
    //
    // The date is the thing under test here: the two cases differ ONLY in the
    // clock, and both must be exit 0 with the same ⬜ line. Restoring the
    // deadline turns the second one red, which is what makes this pair a check
    // rather than a description.
    for (const [label, now] of [
      ['before the old grace date', '2026-08-11T12:00:00Z'],
      ['long after it', '2026-12-01T12:00:00Z'],
    ]) {
      test(`a stale-SHA proof PRINTS ${label}, naming the inputs and the remedy`, () => {
        const r = at(`prov-stale-${now.slice(0, 10)}.json`, [green({ head_sha: STALE_SHA, updated_at: now })], now);
        assert.equal(r.status, 0, `the input-currency clause must never fail the build:\n${r.stderr}`);
        assert.match(r.stdout, /⬜ {2}platform proof PREDATES a change to the build's own inputs/);
        assert.match(r.stdout, /gh workflow run build-platforms\.yml/);
        assert.match(r.stdout, /OPEN DECISION/);
        assert.doesNotMatch(r.stdout, /becomes a hard failure/);
        // …and freshness said fine, which is the whole point of the clause
        // existing separately from it.
        assert.match(r.stdout, /platform proof fresh/);
      });
    }

    test('a run list with no head_sha at all is refused', () => {
      const f = join(TMP, 'prov-nosha.json');
      writeFileSync(f, JSON.stringify([{ id: 701, conclusion: 'success', event: 'schedule', updated_at: '2026-08-11T00:00:00Z' }]));
      const r = spawnSync(process.execPath, [GUARD, '--runs-file', f, '--now', '2026-08-11T12:00:00Z'], { cwd: REPO, encoding: 'utf8' });
      assert.equal(r.status, 1);
      assert.match(r.stderr, /provenance unreadable/);
    });

    test('a proof from outside the graded history is refused immediately, with no grace', () => {
      const r = at('prov-foreign.json', [green()], '2026-08-11T12:00:00Z', '--graded', STALE_SHA);
      assert.equal(r.status, 1);
      assert.match(r.stderr, /NOT produced on this history/);
    });

    // ⚠️ `--graded` must not be a way to retarget a REAL run. It is honoured only
    // alongside `--runs-file`, which already announces itself in the log.
    //
    // 🔴 THIS PAIR REPLACES A CASE THAT COULD NOT FAIL. It used to clear
    // GITHUB_TOKEN / GH_TOKEN and assert the process exited 1 with "no
    // GITHUB_TOKEN" — but `main()` dies at `fetchRuns()`'s token check BEFORE
    // `reportProvenance` is ever called, so no `--graded` code path ran at all.
    // Proven: `GITHUB_TOKEN= GH_TOKEN= node assert-platform-proof-fresh.mjs
    // --graded <sha>` prints only the token line and no provenance line, and the
    // case passed identically with the `offline ?` guard DELETED — i.e. it
    // passed with the safety it claimed to prove removed. Its own assertion
    // message ("the flag was read before the fetch") described a mechanism the
    // code does not have.
    //
    // `reportProvenance` is exported so the branch can be reached with no token
    // and no network, and BOTH directions of the conditional are exercised —
    // one case alone would be satisfied by a function that ignores `offline`.
    const captureProvenance = (runs, offline) => {
      const lines = [];
      const log = console.log;
      const error = console.error;
      const argv = process.argv;
      const exitCode = process.exitCode;
      console.log = (...a) => lines.push(a.join(' '));
      console.error = (...a) => lines.push(a.join(' '));
      // The flag is read off the real `process.argv`, exactly as CI's invocation
      // supplies it — so this drives the same `flag('--graded')` call the guard
      // uses rather than a parameter invented for the test.
      process.argv = [process.argv[0], GUARD, '--graded', STALE_SHA];
      try {
        reportProvenance(runs, Date.parse('2026-08-11T12:00:00Z'), offline);
      } finally {
        console.log = log;
        console.error = error;
        process.argv = argv;
        // `fail()` sets process.exitCode; left set, it would fail this whole
        // test FILE rather than the case, which is the loudest possible way to
        // be confusing.
        process.exitCode = exitCode;
      }
      return lines.join('\n');
    };
    const greenRuns = (sha) => [
      { id: 700, conclusion: 'success', event: 'schedule', updated_at: '2026-08-11T00:00:00Z', head_sha: sha },
    ];

    test('--graded RETARGETS the graded commit when --runs-file is set', () => {
      // The run compiled HEAD; `--graded` points the clause at a commit HEAD is
      // not a descendant of, so the run becomes foreign. This is the direction
      // the flag exists for, and it is what makes the case below meaningful.
      const out = captureProvenance(greenRuns(HEAD_SHA), true);
      assert.match(out, /NOT produced on this history/);
      assert.match(out, new RegExp(`Graded commit: *${STALE_SHA.slice(0, 7)}`));
    });

    test('--graded is INERT without --runs-file — a live run is graded against HEAD', () => {
      // Same argv, same run history, only `offline` differs. If the `offline ?`
      // guard is removed this goes red, because the clause would grade against
      // STALE_SHA and refuse a run that compiled HEAD.
      const out = captureProvenance(greenRuns(HEAD_SHA), false);
      assert.doesNotMatch(
        out,
        /NOT produced on this history/,
        'a flag on the command line must not be able to retarget — or silence — the clause in a REAL CI run',
      );
      assert.match(out, /platform proof provenance — run 700 compiled/);
      assert.match(out, new RegExp(HEAD_SHA.slice(0, 7)));
    });

    // Two independent claims about one run history. Returning early on the first
    // would let a stale timer hide the commit clause behind it forever.
    test('the commit clause still runs when freshness has already failed', () => {
      const r = at('prov-both.json', [green({ head_sha: STALE_SHA, updated_at: '2026-07-01T00:00:00Z' })], '2026-08-26T12:00:00Z');
      assert.equal(r.status, 1);
      assert.match(r.stderr, /platform proof is not fresh/);
      // On STDOUT, because the input-currency clause prints rather than fails —
      // and it is still reported behind a failed freshness clause, which is the
      // whole reason `main()` no longer returns early on the first red.
      assert.match(r.stdout, /PREDATES a change to the build's own inputs/);
    });
  });
});

describe('coverage self-check — against a MUTATED REAL workflow, not a fixture', () => {
  /** The mutated workflow AND the real channel register, because the required
   *  platform set is now DERIVED from that register rather than typed in the
   *  guard. A fixture root without it is testing a guard that cannot know what
   *  it is supposed to cover — which is itself one of the COVERAGE LOST cases
   *  below, so it is exercised deliberately rather than by accident. */
  // 🔴 A MUTATION THAT STOPPED MUTATING IS THE FAILURE MODE OF THIS WHOLE FILE.
  // Every negative test below builds its fixture by string-surgery on the REAL
  // workflow, so a transform is only a test for as long as its pattern still
  // matches. On 2026-08-20 two of them stopped: `run: flutter build ios
  // --release --no-codesign` became a folded `run: >` block when the lane gained
  // its --dart-defines, and both transforms silently became the IDENTITY. They
  // failed loudly here only because the guard returns `null` on a healthy tree
  // and `assert.match(null, ...)` throws — luck, not design. Had either asserted
  // something weaker they would have gone on passing over an UNMUTATED tree,
  // certifying that the guard catches a defect nobody had actually introduced.
  //
  // So an unchanged result is now a REFUSAL, with an `identity` knob for the two
  // cases that legitimately want the real file verbatim. This is the standing
  // rule of this repository applied to its own fixtures: derive it, derive it
  // AFTER the mutation, and keep the new limb negative-testable.
  const mutate = (transform, { register = 'real', identity = false } = {}) => {
    const root = mkdtempSync(join(tmpdir(), 'nikatru-f4-wf-'));
    const dir = join(root, '.github', 'workflows');
    mkdirSync(dir, { recursive: true });
    mkdirSync(join(root, 'tooling'), { recursive: true });
    const real = readFileSync(join(REPO, '.github/workflows/build-platforms.yml'), 'utf8');
    const after = transform(real);
    if (!identity && after === real) {
      rmSync(root, { recursive: true, force: true });
      throw new Error(
        'mutate(): the transform returned the workflow UNCHANGED. Its pattern no longer matches the real ' +
          'build-platforms.yml, so this test would have run against a healthy tree and reported the guard ' +
          'as catching something it was never shown. Repoint the pattern, or pass { identity: true }.',
      );
    }
    writeFileSync(join(dir, 'build-platforms.yml'), after);
    if (register === 'real') {
      writeFileSync(join(root, 'tooling', 'channel-register.json'), readFileSync(join(REPO, 'tooling', 'channel-register.json')));
    } else if (register !== null) {
      writeFileSync(join(root, 'tooling', 'channel-register.json'), typeof register === 'string' ? register : JSON.stringify(register));
    }
    return root;
  };

  // ── the refusal above, exercised ──────────────────────────────────────────
  // A guard that refuses is only a guard while something watches it refuse.
  // This is the 2026-08-20 rot in miniature: a pattern handed to mutate() that
  // no longer matches the file. Before the refusal existed this produced an
  // unmutated fixture and a test that graded a healthy tree.
  test('mutate() REFUSES a transform that changed nothing — the rot that started this', () => {
    assert.throws(
      () => mutate((s) => s.replace('a literal that build-platforms.yml does not contain', 'x')),
      /returned the workflow UNCHANGED/,
    );
  });

  test('the real workflow, unmodified, passes', () => {
    const root = mutate((s) => s, { identity: true });
    assert.equal(assertWatchedWorkflowIntact(root), null);
    rmSync(root, { recursive: true, force: true });
  });

  test('a pass REPORTS what it covered — a green tick that names nothing is the defect this file is about', () => {
    const root = mutate((s) => s, { identity: true });
    const { problem, summary } = platformProofCoverage(root);
    assert.equal(problem, null);
    assert.match(summary, /REQUIRED_COVERAGE — 6 platform\(s\)/);
    for (const p of ['android', 'ios', 'linux', 'macos', 'web', 'windows']) assert.match(summary, new RegExp(p));
    assert.match(summary, /aggregator "all_platforms"/);
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

  // ── 🔴 THE RECORDED FAILING CASE FOR THE STRUCTURAL BUILD CLAUSE ───────────
  // Every one of these was run against the PREVIOUS version of the guard first
  // and returned null — PASS. They are the measurement, not the illustration.
  test('THE ECHO DISGUISE — a step that only SAYS `flutter build ios` is not a build', () => {
    // Measured against the pre-2026-08-08 guard: this returned null. The clause
    // was `new RegExp('flutter build ios\\b').test(yaml)`, and an echo about a
    // disabled build contains exactly that string. Only iOS is disguised here,
    // so the failure has to name iOS specifically and leave the other five alone
    // — a guard that goes red for the wrong reason is a guard nobody believes.
    // Matches the build command whether it sits inline after `run:` or on its own
    // line inside a folded `run: >` block — both shapes are live in this repo
    // today. mutate() refuses an unchanged result, so if BOTH stop matching, this
    // test says so instead of quietly grading a healthy tree.
    const root = mutate((s) =>
      s.replace(
        /^([ \t]*)(run:[ \t]*)?flutter build ios\b([^\n]*)$/m,
        (_m, pad, run, rest) => `${pad}${run ?? ''}echo "flutter build ios${rest} is disabled"`,
      ),
    );
    const problem = assertWatchedWorkflowIntact(root);
    assert.match(problem, /COVERAGE LOST/);
    assert.match(problem, /no longer builds: ios \(needs `flutter build ios`\)/);
    assert.doesNotMatch(problem, /macos \(needs/, 'the other five platforms still build and must not be blamed');
    rmSync(root, { recursive: true, force: true });
  });

  test('the ENTIRE Apple half deleted -> both platforms named, not one summary shrug', () => {
    // `run:` is OPTIONAL for the same reason as above: inside a folded `run: >`
    // block the command sits on its own line. Comments naming these commands
    // start with `#`, so the line anchor leaves them alone.
    const root = mutate((s) => s.split('\n').filter((l) => !/^\s*(?:run:\s*)?flutter build (macos|ios)\b/.test(l)).join('\n'));
    const problem = assertWatchedWorkflowIntact(root);
    assert.match(problem, /COVERAGE LOST/);
    assert.match(problem, /ios/);
    assert.match(problem, /macos/);
    rmSync(root, { recursive: true, force: true });
  });

  test('EVERY build disguised as an echo is caught as a classifier failure, not a clean tree', () => {
    const root = mutate((s) => s.replace(/flutter build (web|linux|apk|appbundle|windows|macos|ios)/g, (m) => `echo "${m} disabled"`));
    const problem = assertWatchedWorkflowIntact(root);
    assert.match(problem, /COVERAGE LOST/);
    assert.match(problem, /NONE of them is a `flutter build` command/);
    rmSync(root, { recursive: true, force: true });
  });

  test('Android is proven by EITHER target — dropping the .apk leaves the appbundle', () => {
    // The register claims the PLATFORM; which artifact its lane emits is
    // assert-channel-register.mjs's question. This guard must not go red for a
    // lane that still compiles Android through the other target.
    const root = mutate((s) => s.replace('flutter build apk --release', 'flutter build appbundle --release'));
    assert.equal(assertWatchedWorkflowIntact(root), null);
    rmSync(root, { recursive: true, force: true });
  });

  // ── 🔴 THE RECORDED FAILING CASE FOR THE AGGREGATOR CLAUSE ─────────────────
  test('A DECOY `needs: [...]` ABOVE THE AGGREGATOR no longer answers for it', () => {
    // Measured against the pre-2026-08-08 guard: null — PASS. It read the FIRST
    // flow-form `needs:` list ANYWHERE in the file and asked whether each job
    // name was a SUBSTRING of it, so a list that merely mentions the three
    // platform jobs satisfied a wiring question about a different job entirely.
    // Two comments inside build-platforms.yml exist solely to warn editors about
    // that fragility; the fragility is now gone instead of documented.
    const root = mutate((s) =>
      s
        .replace(
          '  linux_web_android:\n    name: Linux + Web + Android\n',
          '  linux_web_android:\n    name: Linux + Web + Android\n    outputs: { decoy: "needs: [linux_web_android, windows, apple]" }\n',
        )
        .replace('    needs: [gate, prepare, linux_web_android, windows, apple, release]', '    needs: [gate, prepare]'),
    );
    const problem = assertWatchedWorkflowIntact(root);
    assert.match(problem, /COVERAGE LOST/);
    assert.match(problem, /aggregator "all_platforms" does not depend on: apple, linux_web_android, windows/);
    assert.match(problem, /Its `needs` reads \[gate, prepare\]/);
    rmSync(root, { recursive: true, force: true });
  });

  test('the aggregator written in BLOCK form is read correctly — no false red on a legal spelling', () => {
    const root = mutate((s) =>
      s.replace(
        '    needs: [gate, prepare, linux_web_android, windows, apple, release]',
        '    needs:\n      - gate\n      - prepare\n      - "linux_web_android"\n      - windows\n      - apple\n      - release',
      ),
    );
    assert.equal(assertWatchedWorkflowIntact(root), null);
    rmSync(root, { recursive: true, force: true });
  });
});

describe('coverage self-check — the DERIVED platform set can itself go missing', () => {
  const mutate = (transform, register) => {
    const root = mkdtempSync(join(tmpdir(), 'nikatru-f4-reg-'));
    mkdirSync(join(root, '.github', 'workflows'), { recursive: true });
    mkdirSync(join(root, 'tooling'), { recursive: true });
    const real = readFileSync(join(REPO, '.github/workflows/build-platforms.yml'), 'utf8');
    writeFileSync(join(root, '.github', 'workflows', 'build-platforms.yml'), transform(real));
    if (register !== null) {
      writeFileSync(join(root, 'tooling', 'channel-register.json'), typeof register === 'string' ? register : JSON.stringify(register));
    }
    return root;
  };
  const real = () => JSON.parse(readFileSync(join(REPO, 'tooling', 'channel-register.json'), 'utf8'));

  test('no register at all -> COVERAGE LOST, never an empty platform set that certifies anything', () => {
    const root = mutate((s) => s, null);
    assert.match(assertWatchedWorkflowIntact(root), /COVERAGE LOST.*channel-register\.json does not exist/s);
    rmSync(root, { recursive: true, force: true });
  });

  test('an unreadable register -> COVERAGE LOST', () => {
    const root = mutate((s) => s, '{ not json');
    assert.match(assertWatchedWorkflowIntact(root), /COVERAGE LOST.*not valid JSON/s);
    rmSync(root, { recursive: true, force: true });
  });

  test('a register whose rows declare NO platforms -> COVERAGE LOST, not a vacuous pass', () => {
    const reg = real();
    for (const c of reg.channels) delete c.platforms;
    const root = mutate((s) => s, reg);
    assert.match(assertWatchedWorkflowIntact(root), /declares a `platforms` array/);
    rmSync(root, { recursive: true, force: true });
  });

  test('A SEVENTH PLATFORM with no build command is a FAILURE, never a silent skip', () => {
    // The whole point of deriving the list: adding a platform to the register
    // must not be able to widen the claim without widening the proof.
    const reg = real();
    reg.channels.push({ id: 'fuchsia-store', kind: 'store', served: false, platforms: ['fuchsia'], artifactFormats: ['.far'] });
    const root = mutate((s) => s, reg);
    const problem = assertWatchedWorkflowIntact(root);
    assert.match(problem, /no build command for: fuchsia/);
    assert.match(problem, /PLATFORM_BUILD_TARGETS/);
    rmSync(root, { recursive: true, force: true });
  });

  test('an aggregatingJob naming a job nobody wrote -> COVERAGE LOST', () => {
    const reg = real();
    reg.aggregatingJob = { workflow: '.github/workflows/build-platforms.yml', job: 'a_job_nobody_wrote' };
    const root = mutate((s) => s, reg);
    assert.match(assertWatchedWorkflowIntact(root), /a_job_nobody_wrote.*did not resolve/s);
    rmSync(root, { recursive: true, force: true });
  });

  test('an aggregatingJob that has moved to another workflow -> COVERAGE LOST, not a grade of the wrong file', () => {
    const reg = real();
    reg.aggregatingJob = { workflow: '.github/workflows/ci.yml', job: 'ci-gate' };
    const root = mutate((s) => s, reg);
    assert.match(assertWatchedWorkflowIntact(root), /have come apart/);
    rmSync(root, { recursive: true, force: true });
  });

  test('no aggregatingJob declared at all -> COVERAGE LOST', () => {
    const reg = real();
    delete reg.aggregatingJob;
    const root = mutate((s) => s, reg);
    assert.match(assertWatchedWorkflowIntact(root), /declares no `aggregatingJob`/);
    rmSync(root, { recursive: true, force: true });
  });
});

describe('the structural pieces, unit by unit', () => {
  test('blankStringLiterals leaves no command word inside a quoted string', () => {
    assert.equal(blankStringLiterals('echo "flutter build ios"'), 'echo ""');
    assert.equal(blankStringLiterals("echo 'flutter build ios'"), "echo ''");
    // A `;` inside a string must not be able to split one command into two.
    assert.equal(blankStringLiterals('echo "a ; flutter build ios"'), 'echo ""');
    assert.equal(blankStringLiterals('flutter build web --release'), 'flutter build web --release');
  });

  test('flutterBuildTargets reads the COMMAND WORD, through both block-scalar forms', () => {
    const root = mkdtempSync(join(tmpdir(), 'nikatru-f4-unit-'));
    mkdirSync(join(root, '.github', 'workflows'), { recursive: true });
    writeFileSync(
      join(root, '.github', 'workflows', 'w.yml'),
      `name: w
on:
  workflow_dispatch:
jobs:
  a:
    runs-on: ubuntu-24.04
    steps:
      - name: folded — ONE command over several lines
        run: >
          flutter build web
          --release
      - name: literal — each line its OWN command
        run: |
          echo "flutter build macos is disabled"
          flutter build linux --release
      - name: a leading env assignment does not hide the command word
        run: FLUTTER_ROOT=/x flutter build windows --release
      - name: and a comment about one is not one
        # flutter build ios --release
        run: echo done
`,
    );
    const wf = parseWorkflow(root, '.github/workflows/w.yml');
    const { found, runBlocks } = flutterBuildTargets(wf);
    assert.ok(runBlocks >= 4);
    assert.deepEqual([...found.keys()].sort(), ['linux', 'web', 'windows']);
    assert.ok(!found.has('macos'), 'an echo about a build is not a build');
    assert.ok(!found.has('ios'), 'a comment about a build is not a build');
    assert.equal(found.get('web')[0].job, 'a');
    rmSync(root, { recursive: true, force: true });
  });

  test('requiredTargets is the register union, and every mapped platform names a real subcommand', () => {
    const { platforms, required, unmapped } = requiredTargets({
      channels: [{ platforms: ['web', 'android'] }, { platforms: ['android', 'ios'] }, { platforms: ['plan9'] }],
    });
    assert.deepEqual(platforms, ['android', 'ios', 'plan9', 'web']);
    assert.deepEqual(unmapped, ['plan9']);
    assert.deepEqual([...required.keys()], ['android', 'ios', 'web']);
    assert.deepEqual(required.get('android'), ['apk', 'appbundle']);
    for (const [p, targets] of PLATFORM_BUILD_TARGETS) {
      assert.ok(targets.length > 0, `${p} must name at least one build target`);
      for (const t of targets) assert.match(t, /^[a-z]+$/);
    }
  });

  test('an empty register yields no requirement — which is why the caller treats it as COVERAGE LOST', () => {
    const { platforms, required } = requiredTargets({ channels: [] });
    assert.deepEqual(platforms, []);
    assert.equal(required.size, 0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE CEILING vs THE TIMER.
//
// Measured against the version of the guard BEFORE this clause existed: a single
// `0 6 1 * *` (monthly) cron and a literal `not a cron` BOTH returned null —
// PASS. MAX_AGE_DAYS = 14 was a bare constant nothing compared against the
// cadence that has to renew the proof inside it. These are the measurement.
//
// 🔴 THE VACUITY THIS SET EXISTS TO FORBID: an unreadable cron falling through
// to "interval unknown, therefore acceptable". Every unreadable form below must
// be RED. A parser that silently passes what it cannot read makes the whole
// clause inert the first time someone writes `@weekly`.
// ─────────────────────────────────────────────────────────────────────────────
describe('the declared cadence must be able to reach MAX_AGE_DAYS', () => {
  const MON = "    - cron: '0 6 * * 1'   # Mondays 06:00 UTC\n";
  const THU = "    - cron: '0 6 * * 4'   # Thursdays 06:00 UTC\n";

  /** The REAL workflow with its cron block replaced, written out with the given
   *  line endings. An unchanged file is a refusal, for the reason mutate() gives
   *  above: a transform whose pattern stopped matching grades a healthy tree. */
  const withCrons = (block, { eol = '\n' } = {}) => {
    const root = mkdtempSync(join(tmpdir(), 'nikatru-f4-cron-'));
    mkdirSync(join(root, '.github', 'workflows'), { recursive: true });
    mkdirSync(join(root, 'tooling'), { recursive: true });
    const real = readFileSync(join(REPO, '.github/workflows/build-platforms.yml'), 'utf8');
    // 🔴 BOTH patterns must still match, checked BEFORE the replace. A transform
    // that silently stopped transforming is what makes a negative test grade a
    // healthy tree — the rot mutate() above was rewritten to refuse.
    if (!real.includes(MON) || !real.includes(THU)) {
      rmSync(root, { recursive: true, force: true });
      throw new Error('withCrons(): build-platforms.yml no longer contains both cron lines verbatim — repoint them.');
    }
    const after = real.replace(MON, block).replace(THU, '');
    writeFileSync(join(root, '.github/workflows/build-platforms.yml'), after.split('\n').join(eol));
    writeFileSync(join(root, 'tooling/channel-register.json'), readFileSync(join(REPO, 'tooling/channel-register.json')));
    return root;
  };
  const verdict = (block, opts) => {
    const root = withCrons(block, opts);
    const problem = platformProofCoverage(root).problem;
    rmSync(root, { recursive: true, force: true });
    return problem;
  };
  const cron = (expr) => "    - cron: '" + expr + "'\n";

  // ⚠️ DERIVED, NOT TYPED. Writing today's two crons in here would make the
  // owner's next cadence edit a red ci-gate on every developer's push, which is
  // the same mistake as encoding the cron set in the guard.
  test('the real tree passes, and SAYS the interval it derived', () => {
    const real = readFileSync(join(REPO, '.github/workflows/build-platforms.yml'), 'utf8');
    const declared = [...real.matchAll(/^\s+-\s*cron:\s*['"]([^'"]+)['"]/gm)].map((m) => m[1].trim());
    assert.ok(declared.length >= 1, 'build-platforms.yml declares no cron — repoint this test');
    const days = impliedIntervalDays(declared);
    assert.ok(days !== null && days < 14, `the shipped schedule ${JSON.stringify(declared)} must renew inside 14 days, got ${days}`);
    const { problem, summary } = platformProofCoverage(REPO);
    assert.equal(problem, null);
    assert.match(summary, new RegExp(`renews it every ${days} day\\(s\\) against a 14-day ceiling`));
  });

  test('deleting ONE of two weekly crons still passes — a cadence edit is the owner\'s to make', () => {
    assert.equal(verdict(MON), null);
  });

  // ── RECORDED FAILING CASES. Each returned null against the previous guard. ──
  test('a MONTHLY cron cannot renew inside 14 days -> COVERAGE LOST at the cause', () => {
    assert.match(verdict(cron('0 6 1 * *')), /renews the proof only every 31 day\(s\).*MAX_AGE_DAYS is 14/s);
  });

  test('a YEARLY cron -> COVERAGE LOST', () => {
    assert.match(verdict(cron('0 6 1 1 *')), /renews the proof only every 366 day\(s\)/);
  });

  test('twice a month is SLOWER than the ceiling — 1st to 15th is 14, but 15th to the 1st is 17', () => {
    assert.match(verdict(cron('0 6 1,15 * *')), /renews the proof only every 17 day\(s\)/);
  });

  // ── THE VACUITY, ONE FORM PER ROW ─────────────────────────────────────────
  for (const [label, expr] of [
    ['@weekly macro (GitHub does not accept it either)', '@weekly'],
    ['prose where a cron should be', 'not a cron'],
    ['six fields', '0 0 6 * * 1'],
    ['four fields', '6 * * 1'],
    ['an empty expression', ''],
    ['whitespace only', '   '],
    ['day-of-week 8', '0 6 * * 8'],
    ['day-of-month 32', '0 6 32 * *'],
    ['a zero step', '0 6 * * */0'],
    ['the L form', '0 6 L * *'],
    ['the nth-weekday form', '0 6 * * 5#2'],
    ['a ? placeholder', '0 6 ? * 1'],
    ['a day name nothing defines', '0 6 * * XYZ'],
    ['day-of-month AND day-of-week both restricted (cron ORs them)', '0 6 1 * 1'],
    ['a cron too rare to establish an interval at all (Feb 29)', '0 6 29 2 *'],
  ]) {
    test(`UNREADABLE cron — ${label} — is RED, never "interval unknown therefore fine"`, () => {
      assert.match(verdict(cron(expr)), /COVERAGE LOST/);
    });
  }

  test('an unterminated quote leaves NO readable cron -> RED, not an empty pass', () => {
    assert.match(verdict("    - cron: '0 6 * * 1\n"), /COVERAGE LOST/);
  });

  test('ONE unreadable cron poisons a set that also holds a healthy one', () => {
    assert.match(verdict(cron('0 6 * * 1') + cron('@weekly')), /cannot read/);
  });

  test('a healthy cron in a COMMENT does not rescue a monthly real one', () => {
    assert.match(verdict("    # - cron: '0 6 * * 1'\n" + cron('0 6 1 * *')), /renews the proof only every 31 day\(s\)/);
  });

  test('`schedule:` with no cron at all keeps its OWN older message', () => {
    assert.match(verdict("\n"), /'schedule:' block with no cron entry/);
  });

  // ── forms that are legitimate and must NOT go red ─────────────────────────
  for (const [label, expr, days] of [
    ['a single weekly cron', '0 6 * * 1', 7],
    ['Sunday written as 7', '0 6 * * 7', 7],
    ['a list of two weekdays', '0 6 * * 1,4', 4],
    ['a named range', '0 6 * * MON-FRI', 3],
    ['a day-of-month step', '0 6 */5 * *', 5],
  ]) {
    test(`a legitimate cadence is not a false red — ${label} = ${days} day(s)`, () => {
      assert.equal(verdict(cron(expr)), null);
      assert.equal(impliedIntervalDays([expr]), days);
    });
  }

  test('CRLF is not a second answer — the same four verdicts under \\r\\n', () => {
    assert.equal(verdict(MON + THU, { eol: '\r\n' }), null);
    assert.equal(verdict(MON, { eol: '\r\n' }), null);
    assert.match(verdict(cron('0 6 1 * *'), { eol: '\r\n' }), /every 31 day\(s\)/);
    assert.match(verdict(cron('@weekly'), { eol: '\r\n' }), /cannot read/);
  });

  test('the derivation reads NO clock — a fixed window, so no host and no date can move it', () => {
    // The 2026-08 "Linux flake" was a local-midnight rollover. A ceiling that
    // re-derived itself from `Date.now()` would be that bug with a new name.
    const src = readFileSync(join(CI_DIR, 'assert-platform-proof-fresh.mjs'), 'utf8');
    const derivation = src.slice(src.indexOf('const DERIVATION_EPOCH_MS'), src.indexOf('// COVERAGE SELF-CHECK'));
    assert.ok(derivation.length > 500, 'the derivation block was not located — repoint these anchors');
    assert.doesNotMatch(derivation, /Date\.now|new Date\(\)|getFullYear|process\.platform/);
    assert.match(derivation, /Date\.UTC\(2024, 0, 1\)/);
    // and the UTC accessors, not the local ones, are what make that true
    assert.doesNotMatch(derivation, /\.getDate\(\)|\.getDay\(\)|\.getMonth\(\)/);
  });

  test('impliedIntervalDays refuses rather than guesses', () => {
    assert.equal(impliedIntervalDays([]), null);
    assert.equal(impliedIntervalDays(null), null);
    assert.equal(impliedIntervalDays(['0 6 29 2 *']), null, 'one fire in 800 days establishes no interval');
    assert.equal(impliedIntervalDays(['0 6 * * 1', '0 6 * * 4']), 4);
    assert.equal(impliedIntervalDays(['17 3 * * *']), 1, "the sibling's daily cron, read by this parser");
  });

  test('a field name is read in ITS OWN field — MAY is not Friday', () => {
    const DAYS = 'SUN MON TUE WED THU FRI SAT'.split(' ');
    assert.equal(cronFieldValues('MAY', 0, 7, DAYS), null);
    assert.deepEqual([...cronFieldValues('FRI', 0, 7, DAYS)], [5]);
    assert.deepEqual([...cronFieldValues('MAY', 1, 12, 'JAN FEB MAR APR MAY JUN JUL AUG SEP OCT NOV DEC'.split(' '))], [5]);
    assert.equal(cronFieldValues('MON', 1, 31), null, 'day-of-month has no names');
  });
});
