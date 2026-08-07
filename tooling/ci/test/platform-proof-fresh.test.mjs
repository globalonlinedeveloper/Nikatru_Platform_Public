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
  assertWatchedWorkflowIntact,
  platformProofCoverage,
  blankStringLiterals,
  flutterBuildTargets,
  requiredTargets,
  PLATFORM_BUILD_TARGETS,
} from '../assert-platform-proof-fresh.mjs';
import { parseWorkflow } from '../workflow-scan.mjs';

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
  /** The mutated workflow AND the real channel register, because the required
   *  platform set is now DERIVED from that register rather than typed in the
   *  guard. A fixture root without it is testing a guard that cannot know what
   *  it is supposed to cover — which is itself one of the COVERAGE LOST cases
   *  below, so it is exercised deliberately rather than by accident. */
  const mutate = (transform, { register = 'real' } = {}) => {
    const root = mkdtempSync(join(tmpdir(), 'nikatru-f4-wf-'));
    const dir = join(root, '.github', 'workflows');
    mkdirSync(dir, { recursive: true });
    mkdirSync(join(root, 'tooling'), { recursive: true });
    const real = readFileSync(join(REPO, '.github/workflows/build-platforms.yml'), 'utf8');
    writeFileSync(join(dir, 'build-platforms.yml'), transform(real));
    if (register === 'real') {
      writeFileSync(join(root, 'tooling', 'channel-register.json'), readFileSync(join(REPO, 'tooling', 'channel-register.json')));
    } else if (register !== null) {
      writeFileSync(join(root, 'tooling', 'channel-register.json'), typeof register === 'string' ? register : JSON.stringify(register));
    }
    return root;
  };

  test('the real workflow, unmodified, passes', () => {
    const root = mutate((s) => s);
    assert.equal(assertWatchedWorkflowIntact(root), null);
    rmSync(root, { recursive: true, force: true });
  });

  test('a pass REPORTS what it covered — a green tick that names nothing is the defect this file is about', () => {
    const root = mutate((s) => s);
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
    const root = mutate((s) => s.replace('run: flutter build ios --release --no-codesign', 'run: echo "flutter build ios --release --no-codesign is disabled"'));
    const problem = assertWatchedWorkflowIntact(root);
    assert.match(problem, /COVERAGE LOST/);
    assert.match(problem, /no longer builds: ios \(needs `flutter build ios`\)/);
    assert.doesNotMatch(problem, /macos \(needs/, 'the other five platforms still build and must not be blamed');
    rmSync(root, { recursive: true, force: true });
  });

  test('the ENTIRE Apple half deleted -> both platforms named, not one summary shrug', () => {
    const root = mutate((s) => s.split('\n').filter((l) => !/^\s*run:\s*flutter build (macos|ios)\b/.test(l)).join('\n'));
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
