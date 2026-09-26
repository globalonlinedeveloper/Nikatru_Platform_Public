// ─────────────────────────────────────────────────────────────────────────────
// guard-sweep-invocations.test.mjs — the sweep must SEE an invocation that
// starts node with a flag.
//
// 🔴 THE DEFECT THIS PINS, MEASURED 2026-09-12 ON A CLEAN main (327f63ab).
// tooling/scripts/guard-sweep.mjs matched `node` then WHITESPACE then the path,
// so `node --single-threaded tooling/ci/assert-listing-assets.mjs` — which is
// how CI really starts four guards — matched nothing. preflight.mjs therefore
// exited 1 on a clean tree with five false "invoked by no workflow" findings.
// Nothing was wrong with the tree and nothing was wrong with CI: the CI-wired
// assert-guard-coverage.mjs reported the same 180 files fully accounted for. The
// damage was to the LOCAL gate, which cried wolf on every run.
//
// ⚠️ THE FLAG ARRIVED IN A FIX, WHICH IS WHY NOBODY LOOKED. `--single-threaded`
// went onto those invocations on 2026-09-11 so that a guard which prints its
// verdict and then deadlocks at exit (nodejs/node#54918) could finish. The
// scanner that parses those very lines was not re-read. `moved-code-silences-
// guards` records the mirror image of this — a refactor leaving a guard green
// over nothing; here a refactor made a scanner shout.
//
// THE FIXTURE IS DERIVED FROM THE REAL WORKFLOWS, never hand-typed. A
// hand-typed invocation line is one the author of a matcher gets right by
// construction, which is the whole reason this defect survived: the pattern was
// correct about every example its author had in mind.
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseWorkflow } from '../workflow-scan.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SWEEP = join(REPO, 'tooling', 'scripts', 'guard-sweep.mjs');
const WF_DIR = join(REPO, '.github', 'workflows');

/** The pattern as it stood BEFORE 2026-09-12, kept as a NEGATIVE CONTROL. It is
 *  not a restatement of the live matcher — it is the historical one, and the
 *  case below is only meaningful because this misses what the real lines say. */
const OLD_PATTERN = /node\s+tooling\/ci\/([a-z0-9._-]+\.mjs)([^|&;#\n]*)/i;

/** Every real workflow line that starts a tooling/ci guard with a node FLAG.
 *  Returns [{ wf, line, guard }]. */
function flaggedInvocations() {
  const out = [];
  for (const wf of readdirSync(WF_DIR).filter((f) => /\.ya?ml$/.test(f))) {
    for (const raw of readFileSync(join(WF_DIR, wf), 'utf8').split(/\r?\n/)) {
      const code = raw.replace(/^\s*#.*$/, '');
      const m = code.match(/node\s+(-[^\s]+(?:\s+-[^\s]+)*)\s+tooling\/ci\/([a-z0-9._-]+\.mjs)/i);
      if (m) out.push({ wf, line: code.trim(), guard: m[2], flags: m[1] });
    }
  }
  return out;
}

describe('guard-sweep sees a flagged node invocation', () => {
  test('the real workflows DO start guards with a node flag — the fixture, derived not typed', () => {
    const found = flaggedInvocations();
    // The floor is the point: if this derivation ever returns nothing, every case
    // below passes over an empty set and this file becomes decoration. That is
    // the shape TRAPS "Guards that pass vacuously" is about.
    assert.ok(
      found.length >= 3,
      `expected the real workflows to carry at least 3 flag-started guard invocations, found ${found.length}. ` +
        'If the --single-threaded fix was reverted or rewritten, this file is asserting nothing and must be ' +
        're-aimed rather than deleted.',
    );
    for (const f of found) assert.match(f.flags, /^-/);
  });

  test('🔴 THE OLD PATTERN MISSES EVERY ONE — the case that fails before the fix', () => {
    const found = flaggedInvocations();
    const missed = found.filter((f) => {
      const m = f.line.match(OLD_PATTERN);
      return !m || m[1] !== f.guard;
    });
    assert.equal(
      missed.length,
      found.length,
      'the pre-2026-09-12 pattern is supposed to miss every flag-started invocation; if it now matches some, ' +
        'this negative control has stopped controlling anything and the case above proves nothing.',
    );
  });

  test('and the sweep now classifies NONE of them UNREACHED, exiting 0', () => {
    const r = spawnSync(process.execPath, [SWEEP, '--scan-only'], { cwd: REPO, encoding: 'utf8' });
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
    assert.doesNotMatch(
      out,
      /UNREACHED/,
      `the sweep still reports an UNREACHED file:\n${out.split('\n').filter((l) => /UNREACHED/.test(l)).join('\n')}`,
    );
    assert.doesNotMatch(out, /invoked by no workflow/);
    assert.equal(r.status, 0, out.slice(-600));
  });

  // ⏱ 2026-09-14 — O-GUARD-SWEEP-HAS-A-RIVAL-PARSER. The sweep now reads through
  // tooling/ci/workflow-scan.mjs. The defect a private line loop cannot avoid is
  // a folded `run: >` whose arguments sit on the continuation lines: it recorded
  // those guards with EMPTY arguments. Derived from the real workflows, like the
  // cases above, so no author picks the example the matcher already handles.
  test('🔴 arguments folded onto a `run: >` continuation line are recorded', () => {
    const folded = [];
    for (const wf of readdirSync(WF_DIR).filter((f) => /\.ya?ml$/.test(f))) {
      const lines = readFileSync(join(WF_DIR, wf), 'utf8').split(/\r?\n/);
      for (let i = 0; i + 2 < lines.length; i++) {
        if (!/^\s*(?:-\s+)?run:\s*>\s*$/.test(lines[i])) continue;
        const first = lines[i + 1].match(/^\s*node\s+(?:-\S+\s+)*tooling\/ci\/([a-z0-9._-]+\.mjs)\s*$/i);
        const next = lines[i + 2].trim();
        if (first && next && !next.startsWith('#') && !/^[a-z-]+:/.test(next)) {
          folded.push({ wf, guard: first[1], firstArg: next.split(/\s+/)[0] });
        }
      }
    }
    assert.ok(folded.length >= 3, `expected at least 3 folded guard invocations with arguments on the next line, found ${folded.length}`);
    // The pre-2026-09-14 reader matched one physical line, so its argument
    // capture for every one of these was empty — the negative control.
    for (const f of folded) {
      const line = `node tooling/ci/${f.guard}`;
      const m = line.match(/node\s+((?:-[^\s]+\s+)*)tooling\/ci\/([a-z0-9._-]+\.mjs)([^|&;#\n]*)/i);
      assert.equal(m[3].trim(), '', 'the old one-line capture must see no argument here, or this control controls nothing');
    }
    const r = spawnSync(process.execPath, [SWEEP, '--invocations'], { cwd: REPO, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const recorded = JSON.parse(r.stdout);
    for (const f of folded) {
      const calls = (recorded[f.guard] ?? []).filter((c) => c.wf === f.wf);
      assert.ok(
        calls.some((c) => c.raw.split(/\s+/).includes(f.firstArg.replace(/^["']|["']$/g, '')) || c.raw.includes(f.firstArg)),
        `${f.wf} folds ${f.guard}'s arguments onto the next line (starting ${f.firstArg}) and the sweep recorded ${JSON.stringify(calls)}`,
      );
    }
  });

  // ⏱ 2026-09-25 — ONE DECLARED PER-GUARD CEILING (release train W3, the lead's
  // ruling 2 on ard2r). assert-listing-assets.mjs measured 298-316 s on the
  // laptop, above the flat 300 s, so it gets 600 s. Every other guard keeps the
  // flat 300 s. The source check is what catches a spawn that stopped reading
  // the map: `--ceilings` would still print the right numbers.
  test('🔴 a guard NOT in CEILINGS still gets the flat 300_000 ms', () => {
    const r = spawnSync(process.execPath, [SWEEP, '--ceilings'], { cwd: REPO, encoding: 'utf8' });
    assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
    const ceilings = JSON.parse(r.stdout);
    assert.equal(ceilings['assert-listing-assets.mjs'], 600_000);
    const unlisted = Object.entries(ceilings).filter(([n]) => n !== 'assert-listing-assets.mjs');
    assert.ok(unlisted.length >= 100, `expected the whole tooling/ci domain, got ${unlisted.length} unlisted file(s)`);
    for (const [n, ms] of unlisted) assert.equal(ms, 300_000, `${n} is not in CEILINGS and got ${ms}`);
    const src = readFileSync(SWEEP, 'utf8');
    assert.match(src, /timeout:\s*ceilingFor\(name\)/, 'the guard spawn no longer takes its timeout from ceilingFor(name)');
    assert.doesNotMatch(src, /timeout:\s*\d/, 'a literal timeout is back beside the ceiling map');
  });

  test('the node flags are CARRIED, not merely tolerated', () => {
    // If the flags were matched and then thrown away, the sweep would execute
    // those four guards in exactly the configuration the flag exists to avoid.
    // `--scan-only` prints what it captured, so this reads the capture rather
    // than trusting the comment beside it.
    const r = spawnSync(process.execPath, [SWEEP, '--scan-only'], { cwd: REPO, encoding: 'utf8' });
    const flags = [...new Set(flaggedInvocations().map((f) => f.flags.split(/\s+/)[0]))];
    for (const flag of flags) {
      assert.match(
        r.stdout,
        new RegExp(`node flag\\(s\\)[^\\n]*${flag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
        `the sweep never reports carrying ${flag}, so it is dropping the flag CI starts these guards with`,
      );
    }
  });
});

// ⏱ 2026-09-24 — O-PRE-PUSH-RUNS-NO-CI-GATE-LEG. `preflight.mjs --smoke` runs this
// sweep inside a time budget and must then say what the budget cut and which of
// ci-gate's needs it reached. That needs three things from the sweep, pinned here:
// the JOB behind every invocation, a budget that cuts only guards that would run,
// and per-row wall times.
describe('guard-sweep: job, --budget-ms and --times', () => {
  test('every recorded invocation names a job its own workflow really has', () => {
    const r = spawnSync(process.execPath, [SWEEP, '--invocations'], { cwd: REPO, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const calls = Object.values(JSON.parse(r.stdout)).flat();
    assert.ok(calls.length > 100, `the scan recorded only ${calls.length} invocation(s)`);
    const jobsIn = new Map();
    const unknown = calls.filter((c) => {
      if (!jobsIn.has(c.wf)) jobsIn.set(c.wf, parseWorkflow(REPO, `.github/workflows/${c.wf}`).jobs);
      return typeof c.job !== 'string' || !jobsIn.get(c.wf).has(c.job);
    });
    assert.deepEqual(unknown.map((c) => `${c.wf}:${c.job}`), [], 'an invocation carries no job, or one its workflow does not declare');
  });

  test('🔴 --budget-ms 0 over the REAL tree starts no guard, and cuts only the rows that would have run', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sweep-budget-'));
    try {
      const scanJson = join(dir, 'scan.json');
      const cutJson = join(dir, 'cut.json');
      const scan = spawnSync(process.execPath, [SWEEP, '--scan-only', '--json', scanJson], { cwd: REPO, encoding: 'utf8' });
      assert.equal(scan.status, 0, (scan.stdout + scan.stderr).slice(-600));
      const cut = spawnSync(process.execPath, [SWEEP, '--budget-ms', '0', '--json', cutJson], { cwd: REPO, encoding: 'utf8', timeout: 120_000 });
      assert.equal(cut.status, 0, (cut.stdout + cut.stderr).slice(-600));
      const a = JSON.parse(readFileSync(scanJson, 'utf8'));
      const b = JSON.parse(readFileSync(cutJson, 'utf8'));
      assert.equal(b.executed, 0, `a zero budget still executed ${b.executed} invocation(s)`);
      assert.equal(b.budgetMs, 0);
      const verdicts = (doc) => Object.fromEntries(doc.rows.map((row) => [row.name, row.verdict]));
      const va = verdicts(a);
      const vb = verdicts(b);
      // --scan-only files every would-run row and every NEEDS-CI row as SCAN. Under a
      // zero budget each of those must be BUDGET or NEEDS-CI, and nothing else moves.
      const moved = Object.keys(va).filter((n) => (va[n] === 'SCAN' ? !['BUDGET', 'NEEDS-CI'].includes(vb[n]) : va[n] !== vb[n]));
      assert.deepEqual(moved, [], 'a row changed class beyond SCAN -> BUDGET | NEEDS-CI');
      const count = (v) => Object.values(vb).filter((x) => x === v).length;
      assert.ok(count('BUDGET') > 100, `only ${count('BUDGET')} BUDGET row(s)`);
      assert.ok(count('NEEDS-CI') > 0, 'no NEEDS-CI row survived the cut, so this case cannot tell the two apart');
      assert.ok(count('MUTATES') > 0, 'no MUTATES row on the real tree, so this case cannot show one is never cut');
      assert.equal(b.budgetCut, count('BUDGET'));
      assert.ok(b.rows.filter((row) => row.verdict === 'BUDGET').every((row) => row.ms === null && row.tried.length === 0 && row.jobs.length > 0));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  describe('against a fixture tree with a slow guard', () => {
    let root;
    let run;
    let doc;
    before(() => {
      root = mkdtempSync(join(tmpdir(), 'sweep-fixture-'));
      const put = (rel, text) => {
        mkdirSync(dirname(join(root, rel)), { recursive: true });
        writeFileSync(join(root, rel), text, 'utf8');
      };
      mkdirSync(join(root, 'tooling', 'scripts'), { recursive: true });
      copyFileSync(SWEEP, join(root, 'tooling', 'scripts', 'guard-sweep.mjs'));
      mkdirSync(join(root, 'tooling', 'ci'), { recursive: true });
      copyFileSync(join(REPO, 'tooling', 'ci', 'workflow-scan.mjs'), join(root, 'tooling', 'ci', 'workflow-scan.mjs'));
      copyFileSync(join(REPO, 'tooling', 'ci', 'tree-walk.mjs'), join(root, 'tooling', 'ci', 'tree-walk.mjs'));
      // The sweep reads the exemption declaration out of this file by shape; with no
      // exit call in it, the stub itself is a LIBRARY row.
      put('tooling/ci/assert-guard-coverage.mjs', "const NOT_CI_RUNNABLE = new Map([\n  ['z-exempt.mjs',\n    'fixture'],\n]);\nexport default NOT_CI_RUNNABLE;\n");
      // ⏱ 2026-09-26 (F-W17-1): the sweep refuses, exit 1, a CEILINGS key that names no file
      // here (#945). Each key the copied sweep declares gets a stand-in with no entry point,
      // a LIBRARY row: never run, never budgeted, never red.
      {
        const src = readFileSync(SWEEP, 'utf8');
        const at = src.indexOf('const CEILINGS = {');
        const table = at === -1 ? '' : src.slice(at, src.indexOf('\n};', at));
        for (const m of table.matchAll(/^\s*'([^']+\.mjs)':/gm)) put(`tooling/ci/${m[1]}`, '// fixture stand-in: guard-sweep.mjs CEILINGS names this file\nexport {};\n');
      }
      put('tooling/ci/a-fast.mjs', "console.log('a ok'); process.exit(0);\n");
      put('tooling/ci/b-slow.mjs', "setTimeout(() => { console.log('b ok'); process.exit(0); }, 2000);\n");
      put('tooling/ci/c-late.mjs', "console.log('c ok'); process.exit(0);\n");
      put('tooling/ci/d-needs-ci.mjs', "console.log('d ok'); process.exit(0);\n");
      put('tooling/ci/e-late.mjs', "console.log('e ok'); process.exit(0);\n");
      put('.github/workflows/ci.yml', [
        'name: ci',
        'on: [push]',
        'jobs:',
        '  guards-a:',
        '    runs-on: ubuntu-24.04',
        '    steps:',
        '      - run: node tooling/ci/a-fast.mjs',
        '      - run: node tooling/ci/b-slow.mjs',
        '  guards-b:',
        '    runs-on: ubuntu-24.04',
        '    steps:',
        '      - run: node tooling/ci/a-fast.mjs',
        '      - run: node tooling/ci/c-late.mjs',
        '      - run: node tooling/ci/d-needs-ci.mjs ${{ secrets.TOKEN }}',
        '      - run: node tooling/ci/e-late.mjs',
        '',
      ].join('\n'));
      const out = join(root, 'sweep.json');
      // a-fast starts at once and b-slow before 1.5 s; b-slow ends after 2 s, so
      // c-late and e-late are due after the budget is spent.
      run = spawnSync(process.execPath, [join(root, 'tooling', 'scripts', 'guard-sweep.mjs'), '--budget-ms', '1500', '--times', '--json', out], { cwd: root, encoding: 'utf8', timeout: 60_000 });
      doc = JSON.parse(readFileSync(out, 'utf8'));
    });
    after(() => { try { rmSync(root, { recursive: true, force: true }); } catch {} });

    const verdictOf = (name) => doc.rows.find((row) => row.name === name)?.verdict;

    test('🔴 the budget cuts the guards due after it is spent, and a started guard finishes', () => {
      assert.equal(run.status, 0, (run.stdout + run.stderr).slice(-800));
      assert.equal(verdictOf('a-fast.mjs'), 'ok');
      assert.equal(verdictOf('b-slow.mjs'), 'ok');
      assert.equal(verdictOf('c-late.mjs'), 'BUDGET');
      assert.equal(verdictOf('e-late.mjs'), 'BUDGET');
      assert.equal(doc.budgetCut, 2);
      assert.equal(doc.executed, 2);
      assert.match(run.stdout, /--budget-ms 1500: 2 guard\(s\) that would have run were NOT started/);
    });

    test('a guard only CI can run stays NEEDS-CI after the budget is spent', () => {
      assert.equal(verdictOf('d-needs-ci.mjs'), 'NEEDS-CI');
    });

    test('a row carries every job that invokes it, one call made by two jobs included', () => {
      const a = doc.rows.find((row) => row.name === 'a-fast.mjs');
      assert.deepEqual(a.jobs, [{ wf: 'ci.yml', job: 'guards-a' }, { wf: 'ci.yml', job: 'guards-b' }]);
      assert.equal(a.tried.length, 1, 'the call both jobs make identically ran twice');
      assert.deepEqual(doc.rows.find((row) => row.name === 'e-late.mjs').jobs, [{ wf: 'ci.yml', job: 'guards-b' }]);
    });

    test('--times prints each executed row\'s wall time and the median / p90, and --json carries ms', () => {
      const b = doc.rows.find((row) => row.name === 'b-slow.mjs');
      assert.ok(b.ms >= 1900, `b-slow sleeps 2 s and recorded ${b.ms} ms`);
      assert.equal(doc.rows.find((row) => row.name === 'c-late.mjs').ms, null);
      assert.match(run.stdout, /b-slow\.mjs .*\(\d{4,} ms\)/);
      assert.match(run.stdout, /⏱ --times: 2 guard\(s\) executed in \d+ ms · median \d+ ms · p90 \d+ ms · slowest: b-slow\.mjs/);
      assert.equal(doc.p90Ms, b.ms);
    });
  });
});
