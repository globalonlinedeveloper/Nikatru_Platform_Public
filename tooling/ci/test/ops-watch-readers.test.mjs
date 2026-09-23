// ─────────────────────────────────────────────────────────────────────────────
// ops-watch-readers.test.mjs — ONE READER'S RED MAY NEVER SILENCE ANOTHER.
// `checkReaderIndependence` in tooling/ci/assert-ops-register.mjs, over
// .github/workflows/ops-watch.yml.
//
// A sibling of ops-register.test.mjs, not a section of it: that file was already
// ~6,000 lines when these cases were written (2026-09-23).
//
// 🔴 WHY THESE EXIST. ops-watch.yml's heartbeats job runs the ops register
// first and `node tooling/ops/check-heartbeats.mjs` second, and the second step
// carried no `if:`. A step with no condition runs only when every step above it
// succeeded, so every red register run SKIPPED the heartbeat read — ops watch run
// 35843108090 (2026-09-23 09:28Z): step 4, the register, failure; step 5, the
// heartbeat table, skipped (O-OPS-WATCH-HEARTBEAT-READER-SKIPPED). Its two
// siblings in the same job already carried `!cancelled()`. Nothing in the tree
// could say that one line was missing.
//
// THE RULE the guard now holds: in every ops-watch job, every step that runs a
// reader (`node tooling/….mjs`) after the job's first reader carries
// `!cancelled()` or `always()`, or names the earlier step it genuinely needs as
// `steps.<id>.…` of a step above it. `failure()` alone is refused.
//
// RED CONTROL, in this file and by hand: the committed ops-watch.yml with the
// heartbeat step's `if:` removed is exactly one error, naming that step.
//
// Everything here is OFFLINE: fixtures written to a temp directory and the
// committed workflow read from disk. Nothing reads or writes production.
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { parseWorkflow } from '../workflow-scan.mjs';
import { checkReaderIndependence, jobSteps, READER_WORKFLOW, RUNS_REGARDLESS } from '../assert-ops-register.mjs';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(CI_DIR, '..', '..');
const REL = '.github/workflows/ops-watch.yml';
const GUARD = join(CI_DIR, 'assert-ops-register.mjs');
const HEARTBEAT_STEP = 'Read the heartbeat table from OUTSIDE Cloudflare';
const REGISTER_STEP = 'The whole ops register — every duty, not just the heartbeat-backed ones';

let TMP;
let seq = 0;
before(() => {
  TMP = mkdtempSync(join(tmpdir(), 'ops-watch-readers-'));
});
after(() => {
  rmSync(TMP, { recursive: true, force: true });
});

/** Parse `text` as ops-watch.yml through the ONE parser the guard uses. */
function parseText(text) {
  const root = join(TMP, `r${seq++}`);
  mkdirSync(join(root, '.github', 'workflows'), { recursive: true });
  writeFileSync(join(root, REL), text);
  return parseWorkflow(root, REL);
}

const REAL_TEXT = () => readFileSync(join(REPO, REL), 'utf8');

/** The committed workflow with ONE line removed: the heartbeat step's `if:`. */
function withoutHeartbeatIf() {
  const text = REAL_TEXT();
  const re = new RegExp(`(\\n {6}- name: ${HEARTBEAT_STEP}\\r?\\n) {8}if: \\$\\{\\{ !cancelled\\(\\) \\}\\}\\r?\\n`);
  assert.match(text, re, 'the committed heartbeat step must carry `if: ${{ !cancelled() }}` directly under its name');
  return text.replace(re, '$1');
}

/** A one-job workflow: a checkout, a FIRST reader, then `rest` (step items). */
const wf = (rest, first = '      - name: First\n        id: reg\n        run: node tooling/ci/a.mjs\n') =>
  'name: t\non: workflow_dispatch\njobs:\n  j:\n    runs-on: ubuntu-24.04\n    steps:\n' +
  '      - uses: actions/checkout@v4\n' +
  first +
  rest;
const second = (cond) =>
  `      - name: Second\n${cond == null ? '' : `        if: ${cond}\n`}        run: node tooling/ops/b.mjs\n`;
const verdict = (text) => checkReaderIndependence(parseText(text));

describe("checkReaderIndependence — one reader's red may never silence another", () => {
  test('GREEN: the committed ops-watch.yml holds — every later reader runs whatever the readers above it concluded', () => {
    const r = checkReaderIndependence(parseWorkflow(REPO, REL));
    assert.deepEqual(r.errors, [], r.errors.join('\n'));
    assert.equal(r.lost, null);
    assert.equal(r.prints.length, 1);
    const m = /^\[READERS\] ops-watch\.yml — (\d+) reader step\(s\) after the first, in (\d+) job\(s\) \(([^)]+)\)/.exec(r.prints[0]);
    assert.ok(m, r.prints[0]);
    const jobs = m[3].split(' · ');
    assert.ok(jobs.includes('heartbeats'), `the heartbeats job must be graded: ${r.prints[0]}`);
    assert.equal(Number(m[2]), jobs.length);
    // The census is measured, never assumed: the heartbeats job alone puts three
    // readers after its first (heartbeat table, live D1, analytics liveness).
    assert.ok(Number(m[1]) >= 3, r.prints[0]);
  });

  test('the committed heartbeats job reads the way the defect needs it read: the register first, the heartbeat table after it', () => {
    const steps = jobSteps(parseWorkflow(REPO, REL).jobs.get('heartbeats')).filter((s) => s.reads.length > 0);
    assert.equal(steps[0].name, REGISTER_STEP);
    assert.deepEqual(steps[0].reads, ['tooling/ci/assert-ops-register.mjs']);
    const hb = steps.find((s) => s.name === HEARTBEAT_STEP);
    assert.ok(hb, 'the heartbeat step must be a reader step');
    assert.deepEqual(hb.reads, ['tooling/ops/check-heartbeats.mjs']);
    assert.match(hb.cond, RUNS_REGARDLESS, 'O-OPS-WATCH-HEARTBEAT-READER-SKIPPED: the heartbeat read must run after a red register');
  });

  test('🔴 RED CONTROL: the committed ops-watch.yml with the heartbeat `if:` removed is exactly ONE error, naming that step', () => {
    const text = withoutHeartbeatIf();
    const r = checkReaderIndependence(parseText(text));
    assert.equal(r.lost, null);
    assert.equal(r.errors.length, 1, r.errors.join('\n'));
    const [e] = r.errors;
    const line = text.split('\n').findIndex((l) => l.includes(`- name: ${HEARTBEAT_STEP}`)) + 1;
    assert.ok(e.startsWith(`${REL}:${line} — job heartbeats, step "${HEARTBEAT_STEP}" runs tooling/ops/check-heartbeats.mjs`), e);
    assert.match(e, new RegExp(`after the reader step "${REGISTER_STEP}"`));
    assert.match(e, /carries no `if:`/);
    assert.match(e, /GitHub SKIPS it whenever a step above it fails/);
    assert.match(e, /O-OPS-WATCH-HEARTBEAT-READER-SKIPPED/);
    assert.match(e, /Give it `if: \$\{\{ !cancelled\(\) \}\}`/);
    assert.equal(r.prints.length, 1);
    assert.match(r.prints[0], /, 1 of them SKIPPED by any red step above \(refused below\)$/, 'the census must not say "each" about a set it refused part of');
    assert.doesNotMatch(r.prints[0], /each running/);
  });

  test('`failure()` ALONE is refused — it would skip the read on every GREEN run instead', () => {
    for (const cond of ['${{ failure() }}', 'failure()', '${{ success() }}', "${{ github.event_name == 'schedule' }}"]) {
      const r = verdict(wf(second(cond)));
      assert.equal(r.errors.length, 1, `${cond}: ${r.errors.join('\n')}`);
      assert.match(r.errors[0], /which is neither `!cancelled\(\)`\/`always\(\)` nor a named dependency/);
      assert.match(r.errors[0], /step "Second" runs tooling\/ops\/b\.mjs after the reader step "First"/);
    }
  });

  test('a step with no `if:` after the first reader is refused', () => {
    const r = verdict(wf(second(null)));
    assert.equal(r.errors.length, 1, r.errors.join('\n'));
    assert.match(r.errors[0], /^\.github\/workflows\/ops-watch\.yml:\d+ — job j, step "Second" .* carries no `if:`/);
  });

  test('`!cancelled()`, `always()`, and either one inside a longer condition, are accepted — quoted or not', () => {
    for (const cond of [
      '${{ !cancelled() }}',
      '${{ always() }}',
      '${{ ! cancelled() }}',
      "${{ !cancelled() && github.event_name == 'schedule' }}",
      '"${{ !cancelled() }}"',
      "'${{ always() }}'",
    ]) {
      const r = verdict(wf(second(cond)));
      assert.deepEqual(r.errors, [], `${cond}: ${r.errors.join('\n')}`);
      assert.equal(r.lost, null);
      assert.match(r.prints[0], /1 reader step\(s\) after the first, in 1 job\(s\) \(j\)/);
    }
  });

  test('a NAMED dependency on a step ABOVE it is accepted; an unknown or a LATER id is refused, and named', () => {
    assert.deepEqual(verdict(wf(second("${{ steps.reg.outcome == 'success' }}"))).errors, []);
    assert.deepEqual(verdict(wf(second('${{ failure() && steps.reg.outcome == \'failure\' }}'))).errors, [], 'failure() WITH a named dependency is that dependency, stated');

    const unknown = verdict(wf(second("${{ steps.nope.outcome == 'success' }}"))).errors;
    assert.equal(unknown.length, 1);
    assert.match(unknown[0], /which names steps\.nope — no step above it in this job has that `id:`/);

    const mixed = verdict(wf(second("${{ steps.reg.outcome == 'success' && steps.nope.conclusion == 'success' }}"))).errors;
    assert.equal(mixed.length, 1, 'every id it names must resolve, not just one');
    assert.match(mixed[0], /, which names steps\.nope — no step above it/, 'only the id that does not resolve is named as the fault');

    const later = verdict(
      wf(second("${{ steps.third.outcome == 'success' }}") + '      - name: Third\n        id: third\n        run: echo later\n'),
    ).errors;
    assert.equal(later.length, 1, 'a step BELOW it has not run yet, so naming it is no dependency');
    assert.match(later[0], /names steps\.third — no step above it/);
  });

  test('the FIRST reader needs no condition; `uses:` steps, gh-only steps and commented-out calls are not readers', () => {
    const rest =
      '      - uses: ./.github/actions/setup-node\n' +
      '      - name: Just gh\n        run: gh issue list --limit 5\n' +
      '      - name: Commented\n        run: |\n          echo hi # node tooling/ops/hidden.mjs\n          # node tooling/ops/also-hidden.mjs\n' +
      second('${{ !cancelled() }}');
    const r = verdict(wf(rest));
    assert.deepEqual(r.errors, []);
    assert.match(r.prints[0], /1 reader step\(s\) after the first/, 'only "Second" is graded');
    const steps = jobSteps(parseText(wf(rest)).jobs.get('j'));
    assert.deepEqual(steps.find((s) => s.name === 'Commented').reads, [], 'parseWorkflow blanks comments, so a commented call reads nothing');
    assert.deepEqual(steps.find((s) => s.name === 'Just gh').reads, []);
  });

  test('an unnamed step and an `if:` written as the first key of the item are both read', () => {
    const unnamed = verdict(wf('      - run: node tooling/ops/b.mjs\n')).errors;
    assert.equal(unnamed.length, 1);
    assert.match(unnamed[0], /job j, step #3 runs tooling\/ops\/b\.mjs .* carries no `if:`/);
    const inlineIf = verdict(wf('      - if: ${{ !cancelled() }}\n        name: Second\n        run: node tooling/ops/b.mjs\n'));
    assert.deepEqual(inlineIf.errors, [], inlineIf.errors.join('\n'));
  });

  test('every graded job is checked, and the census sums them', () => {
    const two =
      wf(second('${{ !cancelled() }}')) +
      '  k:\n    runs-on: ubuntu-24.04\n    steps:\n' +
      '      - name: K1\n        run: node tooling/ops/k1.mjs\n' +
      '      - name: K2\n        run: node tooling/ops/k2.mjs\n' +
      '      - name: K3\n        if: ${{ always() }}\n        run: node tooling/ops/k3.mjs\n';
    const r = verdict(two);
    assert.equal(r.errors.length, 1);
    assert.match(r.errors[0], /job k, step "K2" runs tooling\/ops\/k2\.mjs after the reader step "K1"/);
    assert.match(r.prints[0], /3 reader step\(s\) after the first, in 2 job\(s\) \(j · k\)/);
  });

  test('FLOOR: a workflow in which no job holds two readers is COVERAGE LOST, never a clean pass', () => {
    const r = verdict(wf(''));
    assert.deepEqual(r.errors, []);
    assert.deepEqual(r.prints, []);
    assert.ok(Array.isArray(r.lost) && r.lost.length > 0);
    assert.match(r.lost[0], /parsed to no job with two reader steps, so "one reader's red never silences another" ranged over nothing/);
    // Every reader commented out is the same nothing.
    assert.ok(verdict(wf('      - name: Second\n        run: echo # node tooling/ops/b.mjs\n')).lost);
  });

  test('an ABSENT workflow renders no verdict here — the rows anchored at it go COVERAGE LOST in main', () => {
    assert.deepEqual(checkReaderIndependence(null), { errors: [], prints: [], lost: null });
    assert.equal(READER_WORKFLOW, 'ops-watch.yml');
  });

  test('WIRED: main runs it over the parsed ops-watch.yml, pushes its errors, and goes COVERAGE LOST on its floor', () => {
    const src = readFileSync(GUARD, 'utf8');
    const main = src.slice(src.indexOf('async function main'));
    assert.ok(main.length < src.length, 'main() must exist');
    const at = main.indexOf('checkReaderIndependence(parsedByFile.get(READER_WORKFLOW)');
    assert.ok(at > 0, 'main must call checkReaderIndependence over the parsed READER_WORKFLOW');
    const tail = main.slice(at, at + 400);
    assert.match(tail, /errors\.push\(\.\.\.readerSteps\.errors\)/);
    assert.match(tail, /if \(readerSteps\.lost\) coverageLost\(readerSteps\.lost\)/);
    // Structural, so it decides before a socket opens.
    const live = main.indexOf('probeRunRecords(');
    assert.ok(live > at, 'the check must run before the first live read');
  });
});
