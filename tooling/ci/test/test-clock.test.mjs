// ─────────────────────────────────────────────────────────────────────────────
// test-clock.test.mjs — NIKATRU_TEST_NOW moves the clock of EVERY node process
// of a run, children and grandchildren included, and moves nothing else.
//
// The class this pins: a date fuse fires on a day nobody chose (#1101: fx.test.ts
// went red on every PR at 2026-10-01 00:00Z). The weekly time-travel run finds
// the next one first by running every suite with the clock moved forward —
// which is evidence only if the clock moved IN THE PROCESS THAT READ IT. The
// #1101 lane faked the clock in one process and its child kept the real one.
//
//   C1 unset or empty → the preload does nothing; `Date` is the real one
//   C2 set → `new Date()` and `Date.now()` start at the instant and ADVANCE
//   C3 set → a dated `new Date(x)`, Date.parse, Date.UTC are untouched; only
//      the no-argument forms move, and `instanceof Date` still holds
//   C4 the shift crosses a spawn: a GRANDCHILD of a preloaded process reads it
//   C5 a typo is a refusal at startup, never a quiet run on today
//   C6 loaded twice (NODE_OPTIONS and a vitest setup file) it shifts ONCE
//   C7 the time-travel workflow sets both variables on the tooling suite, so
//      the shift this file proves is the one the scheduled run gets
//   C8 ONE clock per run: a child started later reads its parent's clock, not
//      a fresh one started at the instant (heavy-lock.test.mjs read a lock
//      planted 10 min ago as 9.7 min old when each process had its own)
//
// Mutations run against tooling/scripts/test-clock.mjs (predictions first):
//   · `args.length === 0 ? [now()] : args` → `args`             → C2 RED
//   · `if (prop === 'now') return now;` dropped                  → C2 RED
//   · the MARK check before installing dropped                   → C6 RED
//   · parseTestNow returns null instead of throwing              → C5 RED
//   · `anchoredOffset(process.env) ??` dropped                   → C8 RED
//   · the INSTANT zone group made optional                       → C5 RED
//
// Run:  node --test tooling/ci/test/test-clock.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { ANCHOR_VAR, anchoredOffset, parseTestNow, shiftedDate, TEST_NOW_VAR } from '../../scripts/test-clock.mjs';
import { githubEnvWrites, parseResolvedWorkflows, workflowSteps } from '../workflow-scan.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const PRELOAD = join(ROOT, 'tooling', 'scripts', 'test-clock.mjs');
const TARGET = '2027-11-05T00:00:00Z';
const TARGET_MS = Date.parse(TARGET);
const DAY = 86_400_000;
/** The REAL clock, whatever `Date` says: this file itself runs under the shift
 *  in the time-travel workflow, and `performance` is never moved. */
const realNow = () => performance.timeOrigin + performance.now();

/** Runs `code` in a fresh node with the preload in NODE_OPTIONS; returns its stdout. */
function runNode(code, opts = {}) {
  // `'testNow' in opts`, not a destructuring default: C1 passes `undefined` on purpose.
  const testNow = 'testNow' in opts ? opts.testNow : TARGET;
  const env = { ...process.env };
  delete env[TEST_NOW_VAR];
  delete env[ANCHOR_VAR];
  delete env.NODE_OPTIONS;
  if (testNow !== undefined) env[TEST_NOW_VAR] = testNow;
  env.NODE_OPTIONS = `--import=${pathToFileURL(PRELOAD).href}`;
  return spawnSync(process.execPath, ['--input-type=module', '-e', code], {
    env,
    encoding: 'utf8',
    timeout: 30_000,
  });
}

describe('the test-time clock (tooling/scripts/test-clock.mjs)', () => {
  test('C1 unset or empty: nothing moves', () => {
    for (const testNow of [undefined, '', '   ']) {
      const r = runNode('console.log(Date.now())', { testNow });
      assert.equal(r.status, 0, r.stderr);
      const read = Number(r.stdout.trim());
      assert.ok(Math.abs(read - realNow()) < DAY, `${JSON.stringify(testNow)} moved the clock to ${read}`);
    }
  });

  test('C2 set: the no-argument forms start at the instant and advance in real time', () => {
    const r = runNode(
      [
        'const a = Date.now();',
        'const b = new Date().getTime();',
        'await new Promise((ok) => setTimeout(ok, 60));',
        'const c = Date.now();',
        'console.log(JSON.stringify({ a, b, c, s: Date() }));',
      ].join('\n'),
    );
    assert.equal(r.status, 0, r.stderr);
    const { a, b, c, s } = JSON.parse(r.stdout);
    assert.ok(a >= TARGET_MS && a - TARGET_MS < 30_000, `Date.now() read ${new Date(a).toISOString()}`);
    assert.ok(b >= a && b - a < 30_000, `new Date() read ${new Date(b).toISOString()}`);
    // A REAL timer ran (timers are not faked) and the shifted clock moved with it.
    assert.ok(c - a >= 50, `the clock did not advance across a real 60 ms timer: ${c - a} ms`);
    assert.match(s, /2027/, `Date() as a function read ${s}`);
  });

  test('C3 set: dated forms are untouched and instanceof holds', () => {
    const r = runNode(
      [
        'const d = new Date("2020-02-29T12:00:00Z");',
        'console.log(JSON.stringify({',
        '  iso: d.toISOString(), parse: Date.parse("2020-01-01T00:00:00Z"), utc: Date.UTC(2020, 0, 1),',
        '  inst: new Date() instanceof Date && d instanceof Date, proto: Object.getPrototypeOf(new Date()) === Date.prototype,',
        '}));',
      ].join('\n'),
    );
    assert.equal(r.status, 0, r.stderr);
    const got = JSON.parse(r.stdout);
    assert.equal(got.iso, '2020-02-29T12:00:00.000Z');
    assert.equal(got.parse, Date.UTC(2020, 0, 1));
    assert.equal(got.utc, Date.UTC(2020, 0, 1));
    assert.equal(got.inst, true);
    assert.equal(got.proto, true);
  });

  test('C4 the shift crosses a spawn: a grandchild reads the moved clock', () => {
    // The child spawns a grandchild with the env it inherited — the shape every
    // tooling test that spawns a guard has. No variable is passed explicitly.
    const grandchild = [
      'import { spawnSync } from "node:child_process";',
      'const r = spawnSync(process.execPath, ["-e", "console.log(Date.now())"], { encoding: "utf8" });',
      'process.stdout.write(r.stdout);',
    ].join('\n');
    const r = runNode(grandchild);
    assert.equal(r.status, 0, r.stderr);
    const read = Number(r.stdout.trim());
    assert.ok(read >= TARGET_MS && read - TARGET_MS < 30_000, `the grandchild read ${new Date(read).toISOString()}`);
  });

  test('C5 a typo is a refusal at startup, naming the value', () => {
    for (const bad of ['2027-11-05', '2027-11-05T00:00:00', 'next tuesday', '2027-13-45T00:00:00Z']) {
      assert.throws(() => parseTestNow(bad), /not an ISO-8601 instant with a zone/, `${bad} was accepted`);
      const r = runNode('console.log("ran")', { testNow: bad });
      assert.notEqual(r.status, 0, `${bad}: the process ran on the real clock`);
      assert.match(r.stderr, /NIKATRU_TEST_NOW/);
    }
    assert.equal(parseTestNow('2027-11-05T00:00:00+05:30'), Date.parse('2027-11-05T00:00:00+05:30'));
  });

  test('C6 loaded twice, it shifts once', () => {
    const r = runNode(
      `await import(${JSON.stringify(pathToFileURL(PRELOAD).href + '?again')}); console.log(Date.now());`,
    );
    assert.equal(r.status, 0, r.stderr);
    const read = Number(r.stdout.trim());
    assert.ok(read - TARGET_MS < 30_000, `a second load moved the clock again, to ${new Date(read).toISOString()}`);
    // and the pure function agrees with the process.
    const D = shiftedDate(Date, 1000);
    assert.ok(D.now() - Date.now() >= 999);
  });

  test('C8 one clock per run: a child started later reads its parent\'s clock', () => {
    const r = runNode(
      [
        'import { spawnSync } from "node:child_process";',
        'await new Promise((ok) => setTimeout(ok, 1500));',
        'const before = Date.now();',
        'const c = spawnSync(process.execPath, ["-e", "console.log(Date.now())"], { encoding: "utf8" });',
        'const after = Date.now();',
        'console.log(JSON.stringify({ before, child: Number(c.stdout.trim()), after }));',
      ].join('\n'),
    );
    assert.equal(r.status, 0, r.stderr);
    const { before, child, after } = JSON.parse(r.stdout);
    // A child with its own clock would read ~TARGET, 1.5 s BEHIND `before`.
    assert.ok(child >= before - 50 && child <= after + 50, `the child read ${child - before} ms from its parent's clock`);
    assert.equal(anchoredOffset({ [TEST_NOW_VAR]: TARGET, [ANCHOR_VAR]: `${TARGET}|1234` }), 1234);
    assert.equal(anchoredOffset({ [TEST_NOW_VAR]: '2030-01-01T00:00:00Z', [ANCHOR_VAR]: `${TARGET}|1234` }), null, 'another instant\'s anchor is not this run\'s');
  });

  test('C7 the time-travel workflow puts both variables on the tooling suites', () => {
    const wf = readFileSync(join(ROOT, '.github', 'workflows', 'time-travel.yml'), 'utf8');
    assert.match(wf, /NIKATRU_TEST_NOW: \$\{\{ matrix\.instant \}\}/, 'the workflow no longer sets NIKATRU_TEST_NOW');
    // ⏱ 2026-10-02 · the preload is an absolute file URL in $TEST_CLOCK (#1160's
    // spawn-ceiling-cwd rule refuses a relative --import), written to GITHUB_ENV in
    // the tooling job from this path, and both suites export and load it.
    const { workflows } = parseResolvedWorkflows(ROOT);
    const job = workflows.find((w) => w.rel === '.github/workflows/time-travel.yml')?.jobs.get('tooling');
    assert.ok(job, 'time-travel.yml has no tooling job');
    const steps = workflowSteps(job);
    const writes = githubEnvWrites(job).filter((w) => w.name === 'TEST_CLOCK');
    assert.equal(writes.length, 1, 'the tooling job no longer writes TEST_CLOCK to GITHUB_ENV');
    assert.match(
      steps[writes[0].stepIndex].run.text,
      /pathToFileURL\(require\('path'\)\.resolve\(process\.env\.GITHUB_WORKSPACE, 'tooling\/scripts\/test-clock\.mjs'\)\)\.href/,
      'TEST_CLOCK is no longer the file URL of tooling/scripts/test-clock.mjs',
    );
    for (const glob of ['tooling/ci/test/*.test.mjs', 'tooling/content_pipeline/test/*.test.mjs']) {
      const step = steps.find((st) => st.run?.text.includes(`--test "${glob}"`));
      assert.ok(step, `the tooling job no longer runs --test "${glob}"`);
      assert.ok(step.index > writes[0].stepIndex, `the ${glob} suite runs before TEST_CLOCK is written`);
      assert.equal(step.env.get('NIKATRU_TEST_NOW')?.value, '${{ matrix.instant }}', `the ${glob} suite lost NIKATRU_TEST_NOW`);
      assert.equal(step.env.has('NODE_OPTIONS'), false, `the ${glob} suite sets NODE_OPTIONS in step env, which is not shell-expanded`);
      const [exp, run] = step.run.text.split(' ; ');
      assert.equal(exp, 'export NODE_OPTIONS="--import=$TEST_CLOCK"', `the ${glob} suite no longer exports NODE_OPTIONS before its runner`);
      assert.match(run ?? '', /^node (?:--import "\$[A-Z_]+" )*--import "\$TEST_CLOCK" /, `the ${glob} suite's runner no longer loads $TEST_CLOCK`);
    }
    assert.match(wf, / --test "tooling\/ci\/test\/\*\.test\.mjs"/, 'the tooling suite is not the one ci.yml runs');
  });
});
