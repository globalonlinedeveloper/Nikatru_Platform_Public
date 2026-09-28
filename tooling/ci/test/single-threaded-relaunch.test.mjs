// ─────────────────────────────────────────────────────────────────────────────
// single-threaded-relaunch.test.mjs — the shared relaunch must pass the work
// through unchanged, and must never let "I could not look" read as a verdict.
//
// single-threaded-relaunch.mjs is how assert-launcher-icons.mjs,
// assert-elf-page-alignment.mjs, assert-listing-assets.mjs,
// assert-stamp-brand-assets.mjs, (since 2026-09-22) assert-apps-gov-in-media.mjs
// and (since 2026-09-25) tooling/e2e/assert-frames-carry-text.mjs and
// tooling/store/measure-frame-ink.mjs do their work with V8 background tasks OFF, so
// that their exit cannot deadlock (nodejs/node#54918 — the hang that cancelled CI
// runs 34442894882 and 34553250403). Each of those guards pins the relaunch in
// its own test file ("V8 background tasks: OFF"). THIS file pins what the five
// share, against tiny scripts that import the module exactly as a guard does:
//
//   R1 the working process is --single-threaded, and the parent is not doing the work
//   R2 argv, execArgv and the exit STATUS pass through unchanged (0, 1 and 7)
//   R3 already single-threaded → no second relaunch
//   R4 the relaunch cannot start          → the caller's reporter, exit 2
//   R5 the working process is KILLED      → the caller's reporter, exit 2 (POSIX)
//
// Mutations run against the module (2026-09-11, predictions written first):
//   · the `return 2` after a failed relaunch made `return null`           → R4b RED
//     (R4 stays green: its reporter exits by itself, which is why R4b exists)
//   · the `child.status === null` branch disabled                          → R5 RED
//   · `...process.argv.slice(2)` dropped from the relaunch                 → R2 RED
//
// Run:  node --test tooling/ci/test/single-threaded-relaunch.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseWorkflow, workflowSteps } from '../workflow-scan.mjs';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HELPER = join(CI_DIR, 'single-threaded-relaunch.mjs');
const HELPER_URL = pathToFileURL(HELPER).href;
const POSIX = process.platform !== 'win32';

let TMP;
let seq = 0;
before(() => {
  TMP = mkdtempSync(join(tmpdir(), 'nikatru-relaunch-'));
});
after(() => {
  rmSync(TMP, { recursive: true, force: true });
});

/** A guard-shaped script: imports the helper, relaunches, then does `body`.
 *  Its reporter prints COVERAGE LOST and exits 2, the way the guards' do —
 *  unless `returningReporter`, which models a reporter that forgets to exit. */
function script(body, { preamble = '', returningReporter = false } = {}) {
  const p = join(TMP, `s${seq++}.mjs`);
  writeFileSync(
    p,
    `import { relaunchSingleThreaded, isSingleThreaded } from ${JSON.stringify(HELPER_URL)};\n` +
      `function coverageLost(lines) {\n` +
      `  console.error('COVERAGE LOST: ' + lines.join(' | '));\n` +
      `  ${returningReporter ? '' : 'process.exit(2);'}\n` +
      `}\n` +
      `${preamble}\n` +
      `const relaunched = relaunchSingleThreaded(import.meta.url, process.argv.slice(2), coverageLost);\n` +
      `if (relaunched !== null) process.exit(relaunched);\n` +
      `${body}\n`,
  );
  return p;
}

// singleThreaded: false — R1-R5 test the relaunch itself, so the script must start WITHOUT
// the flag the spawn-ceiling preload adds (tooling/scripts/spawn-ceiling.mjs).
const run = (file, args = [], execArgv = []) => {
  const r = spawnSync(process.execPath, [...execArgv, file, ...args], { encoding: 'utf8', timeout: 60_000, singleThreaded: false });
  return { code: r.status, signal: r.signal, out: `${r.stdout ?? ''}${r.stderr ?? ''}`, error: r.error };
};

describe('single-threaded-relaunch', () => {
  test('R1 the work runs in a --single-threaded process, exactly once', () => {
    const f = script("console.log('WORK single=' + isSingleThreaded() + ' pid=' + process.pid);");
    const { code, out } = run(f);
    assert.equal(code, 0, out);
    const work = out.split('\n').filter((l) => l.startsWith('WORK'));
    assert.equal(work.length, 1, `the work must run once, in the child — got:\n${out}`);
    assert.match(work[0], /single=true/);
  });

  test('R2 argv, execArgv and the exit status pass through unchanged', () => {
    const f = script(
      "console.log('ARGS ' + JSON.stringify(process.argv.slice(2)));\n" +
        "console.log('EXECARGV ' + JSON.stringify(process.execArgv));\n" +
        'process.exit(Number(process.argv[2]));',
    );
    for (const status of [0, 1, 7]) {
      const { code, out } = run(f, [String(status), '--seed', 'a b'], ['--stack-size=900']);
      assert.equal(code, status, out);
      assert.match(out, new RegExp(`ARGS \\["${status}","--seed","a b"\\]`));
      assert.match(out, /EXECARGV \[[^\]]*"--single-threaded"[^\]]*"--stack-size=900"[^\]]*\]/);
    }
  });

  test('R3 a process that is already single-threaded is not relaunched again', () => {
    const f = script("console.log('WORK pid=' + process.pid);");
    const { code, out } = run(f, [], ['--single-threaded']);
    assert.equal(code, 0, out);
    assert.equal(out.split('\n').filter((l) => l.startsWith('WORK')).length, 1, out);
  });

  test('R4 a relaunch that cannot start is COVERAGE LOST, exit 2 — never 0, never 1', () => {
    // process.execPath is what the helper spawns; pointing it at nothing makes
    // the spawn itself fail, which is the case under test.
    const missing = JSON.stringify(join(TMP, 'no-such-node'));
    const f = script("console.log('WORK');", { preamble: `process.execPath = ${missing};` });
    const { code, out } = run(f);
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST: could not relaunch with --single-threaded/);
    assert.doesNotMatch(out, /WORK/);
  });

  test('R4b the exit is 2 even if the caller\'s reporter forgets to exit', () => {
    const missing = JSON.stringify(join(TMP, 'no-such-node'));
    const f = script("console.log('WORK');", { preamble: `process.execPath = ${missing};`, returningReporter: true });
    const { code, out } = run(f);
    assert.equal(code, 2, out);
    assert.doesNotMatch(out, /WORK/);
  });

  // POSIX only: Windows has no signals to die by, so a killed child there
  // reports an exit status and is passed through as one.
  test('R5 a working process killed before its verdict is COVERAGE LOST, exit 2', { skip: POSIX ? false : 'POSIX signals only' }, () => {
    const f = script("console.log('PARTIAL');\nprocess.kill(process.pid, 'SIGKILL');");
    const { code, out } = run(f);
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST: the working process was killed by SIGKILL before it delivered a verdict/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ⏱ 2026-09-11 · IN CI THE FLAG IS ON THE COMMAND LINE, SO NO RELAUNCH PARENT EXISTS.
//
// The relaunch leaves a parent process, and the parent is not immune: under
// `--stress-concurrent-allocation` it hung at exit AFTER its single-threaded
// child printed the whole verdict (elf 4 of 12, stamp 4 of 12; hang-class sweep,
// 2026-09-11). With default flags its worker ticks measured 0 — safe by
// measurement, not by construction. `node --single-threaded <guard>` in the
// workflow step makes `relaunchSingleThreaded` return null at once, so there is
// no parent to hang. The guards that need it are DERIVED — every tooling/ci file
// that imports this module — so a fifth importer is held to the same rule the
// day it lands, with no list to update.
//
// ⏱ 2026-09-22 · THE FIFTH IMPORTER LANDED: assert-apps-gov-in-media.mjs, which
// re-derives every apps.gov.in screenshot from its Play original pixel by pixel.
// Its two steps (ci.yml guards-store, build-platforms.yml) carry the flag, so
// the floors below are ratcheted to what the tree holds: five importers, nine
// flagged steps.
//
// ⏱ 2026-09-25 · THE DERIVATION STOPPED AT tooling/ci/, AND THE NEXT HANG WAS
// ONE DIRECTORY OVER. tooling/e2e/assert-frames-carry-text.mjs runs the same
// 9x9 mode-filter loop as assert-listing-assets.mjs and had no relaunch; CI run
// 36192015901 killed it at its test's 120 s ceiling where the same pages took
// 3.2 s. A list derived from one directory is a list somebody chose. So the
// importers are now derived from every tooling/ directory that holds a pixel
// program (ci, e2e, store), and a PROGRAM that imports the ink metric
// (frame-ink.mjs) must be one of them — the class, not the instance. Floors:
// seven importers, eleven flagged steps (e2e.yml's text check, and
// store-screenshots.yml's measure-frame-ink.mjs step now that it relaunches).
// ─────────────────────────────────────────────────────────────────────────────
describe('every workflow step that runs a relaunching guard runs it as node --single-threaded', () => {
  const HERE = new URL('.', import.meta.url);
  const REPO_ROOT = new URL('../../../', HERE);
  // The tooling/ directories a pixel or archive program lives in.
  const PROGRAM_DIRS = ['ci', 'e2e', 'store'];
  const RELAUNCH_IMPORT = /from '(?:\.|\.\.\/ci)\/single-threaded-relaunch\.mjs'/;

  /** `<dir>/<file>` of every tooling/<dir>/*.mjs whose source passes `keep`. */
  async function toolingFiles(keep) {
    const { readdirSync, readFileSync: read } = await import('node:fs');
    const out = [];
    for (const dir of PROGRAM_DIRS) {
      const at = new URL(`tooling/${dir}/`, REPO_ROOT);
      for (const f of readdirSync(at).filter((n) => n.endsWith('.mjs') && n !== 'single-threaded-relaunch.mjs')) {
        if (keep(read(new URL(f, at), 'utf8'))) out.push(`${dir}/${f}`);
      }
    }
    return out;
  }
  const relaunchImporters = () => toolingFiles((src) => RELAUNCH_IMPORT.test(src));
  // ⬜ NO DECLARED GAPS. There was one: store-screenshots.yml:81 ran
  // assert-listing-assets.mjs bare, because that file belonged to the Subly
  // rename wave on 2026-09-11 and the fix was written up in
  // HANDOFF-guards-remainder.md instead of made. The flag landed on 2026-09-12
  // and the entry went with it in the same commit — this map is a ratchet in
  // BOTH directions, and it already fails a gap that is no longer true, so a
  // stale entry could not have survived anyway. Leave it empty: a new gap has to
  // be declared deliberately, in writing, by whoever opens it.
  const PENDING = new Map();

  test('the importers are derived from the tree, and there are some', async () => {
    const importers = await relaunchImporters();
    assert.ok(importers.length >= 7, `expected the seven pixel programs to import the relaunch, found: ${importers.join(', ')}`);
    for (const g of [
      'ci/assert-launcher-icons.mjs',
      'ci/assert-elf-page-alignment.mjs',
      'ci/assert-listing-assets.mjs',
      'ci/assert-stamp-brand-assets.mjs',
      'ci/assert-apps-gov-in-media.mjs',
      'e2e/assert-frames-carry-text.mjs',
      'store/measure-frame-ink.mjs',
    ]) {
      assert.ok(importers.includes(g), `tooling/${g} no longer imports the relaunch`);
    }
  });

  test('every PROGRAM that runs the ink metric (frame-ink.mjs) relaunches single-threaded', async () => {
    // A program is a file that reads its arguments or exits — the line
    // assert-guards-refuse-empty draws. A library that imports the metric runs
    // inside a program that must relaunch itself; a program that imports it IS
    // that process, and its 9x9 mode-filter loop is the background-compile
    // bait that hung CI run 36192015901.
    const metricPrograms = await toolingFiles(
      (src) => /from '[./a-z]*\/?frame-ink\.mjs'/.test(src) && /process\.(argv|exit)\b/.test(src),
    );
    assert.ok(metricPrograms.length >= 3, `the derivation found too few ink programs to mean anything: ${metricPrograms.join(', ')}`);
    const importers = await relaunchImporters();
    const bare = metricPrograms.filter((p) => !importers.includes(p));
    assert.deepEqual(bare, [], `these programs run the ink metric with V8 background tasks ON (nodejs/node#54918):\n${bare.map((p) => `tooling/${p}`).join('\n')}`);
    // Importing is not calling: each must relaunch before it computes.
    const { readFileSync: read } = await import('node:fs');
    for (const p of metricPrograms) {
      assert.match(read(new URL(`tooling/${p}`, REPO_ROOT), 'utf8'), /relaunchSingleThreaded\(import\.meta\.url,/, `tooling/${p} imports the relaunch and never calls it`);
    }
  });

  test('no workflow invokes a relaunching guard without --single-threaded (declared gaps excepted, and still true)', async () => {
    const { readdirSync, readFileSync: read } = await import('node:fs');
    const importers = await relaunchImporters();
    const wfDir = new URL('.github/workflows/', REPO_ROOT);
    const bare = [];
    const flagged = [];
    const stillPending = new Map();
    for (const wf of readdirSync(wfDir).filter((f) => /\.ya?ml$/.test(f))) {
      read(new URL(wf, wfDir), 'utf8').split('\n').forEach((line, i) => {
        if (/^\s*#/.test(line)) return;
        for (const g of importers) {
          const m = line.match(new RegExp(`\\bnode((?:\\s+--[\\w-]+)*)\\s+tooling/${g.replace('.', '\\.')}\\b`));
          if (!m) continue;
          if (/(^|\s)--single-threaded(\s|$)/.test(m[1])) { flagged.push(`${wf}:${i + 1} ${g}`); continue; }
          if ((PENDING.get(wf) ?? []).includes(g)) { stillPending.set(`${wf}|${g}`, true); continue; }
          bare.push(`${wf}:${i + 1} runs ${g} without --single-threaded`);
        }
      });
    }
    assert.deepEqual(bare, [], `a relaunching guard runs under a relaunch parent in CI:\n${bare.join('\n')}`);
    assert.ok(flagged.length >= 11, `expected the eleven heavy-program steps (ci.yml ×4, build-platforms.yml ×2, submit-play.yml ×2, store-screenshots.yml ×2, e2e.yml) to carry the flag, found ${flagged.length}:\n${flagged.join('\n')}`);
    for (const [wf, gs] of PENDING) {
      for (const g of gs) {
        assert.ok(stillPending.has(`${wf}|${g}`), `the declared gap ${wf} → ${g} is closed: remove it from PENDING`);
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ⏱ 2026-09-26 · THE HANG LEFT THE PIXEL PROGRAMS. tooling/scripts/check-agent-docs.mjs
// reads blobs through `git cat-file --batch`, decodes nothing, imports no relaunch,
// and still printed `ok  no new finding.` and never exited: ci.yml guards-platform
// runs 36229452526 (PR #979) and 36232580493 (main) were cancelled at the job's 15
// minutes, with an orphan `(MainThread)` killed at cleanup, where 59 other runs
// took 0-1 s. So the steps in that job whose script spawns git synchronously, the
// shape that hung, run as `node --single-threaded`, and each carries a step-level
// `timeout-minutes` below the job's, so a hang the flag misses fails one named step.
//
// The set is DERIVED from each step's own script source, never listed. Its scope is
// the job the hang was measured in, and that is a declared limit, not a claim about
// the other jobs: their git-spawning guards have not hung, and this block does not
// grade them.
//
//   X1 the derivation finds the step that hung, and enough others to mean anything
//   X2 every such step runs --single-threaded and is bounded on its own, under the job
//
// Mutations run against ci.yml (2026-09-26, predictions written first):
//   · `--single-threaded` dropped from the check-agent-docs step    → X2 RED
//   · its `timeout-minutes: 2` dropped                              → X2 RED
//   · its `timeout-minutes` raised to the job's 15                  → X2 RED
// ─────────────────────────────────────────────────────────────────────────────
describe('a guards-platform step that spawns git runs single-threaded and bounded', () => {
  const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
  const JOB = 'guards-platform';
  const RUN = /\bnode((?:\s+--[\w-]+(?:=\S+)?)*)\s+(tooling\/[\w/.-]+\.mjs)\b/;
  const SPAWNS_GIT = /\b(?:spawnSync|execFileSync|execSync)\(\s*['"`]git['"`]/;
  const STEP_TIMEOUT = /^ {8}timeout-minutes:\s*(\S+)\s*$/;
  const JOB_TIMEOUT = /^ {4}timeout-minutes:\s*(\d+)\s*$/;

  const wf = parseWorkflow(REPO_ROOT, '.github/workflows/ci.yml');
  const job = wf?.jobs.get(JOB);
  const jobBound = Number(job?.lines.map((l) => l.text.match(JOB_TIMEOUT)?.[1]).find(Boolean));
  const gitSteps = [];
  for (const s of job ? workflowSteps(job) : []) {
    const m = s.run?.text.match(RUN);
    if (!m) continue;
    if (!SPAWNS_GIT.test(readFileSync(join(REPO_ROOT, m[2]), 'utf8'))) continue;
    const bound = job.lines.filter((l) => l.n >= s.first && l.n <= s.last).map((l) => l.text.match(STEP_TIMEOUT)?.[1]).find(Boolean) ?? null;
    gitSteps.push({ at: `ci.yml:${s.first}`, script: m[2], flags: m[1], bound });
  }

  test('X1 the derivation finds the step that hung, and enough others to mean anything', () => {
    assert.ok(job, `ci.yml has no job ${JOB}, so nothing below is graded`);
    assert.ok(Number.isInteger(jobBound) && jobBound > 0, `${JOB} declares no job-level timeout-minutes this block can compare a step bound with`);
    assert.ok(gitSteps.some((g) => g.script === 'tooling/scripts/check-agent-docs.mjs'), `the derivation no longer finds check-agent-docs.mjs, the step that hung:\n${gitSteps.map((g) => g.script).join('\n')}`);
    assert.ok(gitSteps.length >= 8, `expected the eight git-spawning steps of 2026-09-26, found ${gitSteps.length}:\n${gitSteps.map((g) => `${g.at} ${g.script}`).join('\n')}`);
  });

  test('X2 every such step runs --single-threaded and is bounded on its own, under the job', () => {
    const bad = [];
    for (const g of gitSteps) {
      if (!/(^|\s)--single-threaded(\s|$)/.test(g.flags)) bad.push(`${g.at} runs ${g.script} with V8 background tasks ON (nodejs/node#54918)`);
      if (g.bound === null) bad.push(`${g.at} ${g.script} has no step-level timeout-minutes, so a hang eats the job's ${jobBound}`);
      else if (!/^[0-9]+$/.test(g.bound) || Number(g.bound) < 2 || Number(g.bound) >= jobBound) bad.push(`${g.at} ${g.script} is bounded at ${g.bound}: a step bound is a whole number of minutes, at least 2 and under the job's ${jobBound}`);
    }
    assert.deepEqual(bad, [], bad.join('\n'));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ⏱ 2026-09-26 · THE HANG CROSSED INTO extensions-ci.yml (O-EXTENSIONS-CATALOGUE-HUNG-PAST-ITS-CAP).
// extensions/scripts/render-extension-graphics.mjs printed `3 passed` 0.17 s into its
// first run on main (run 36273003792 attempt 1) and never exited; the catalogue job's
// 10 minutes cancelled it and the runner killed an orphan `(MainThread)`. It is
// synchronous, spawns nothing and ends process.exit(r.finish()). Reproduced on Linux
// (node 22.22.1, 8 cores): under --stress-concurrent-allocation 3 of 24 runs printed
// the verdict and hung, the live process's every thread in futex_do_wait with no
// children; with --single-threaded added, 0 of 24. check-store-packages.mjs hung the
// same way twice on 2026-09-06 and was wrapped in hang-guard.mjs without the flag.
//
// The shared trait is a program whose own import graph reaches node:zlib — PNG and
// zip codecs, the hot loops background compiles exist for. So every extensions-ci.yml
// step that runs such a program runs it as `node --single-threaded` and carries a
// step-level timeout-minutes below its job's, and a step wrapped in hang-guard.mjs is
// bounded ABOVE that wrapper's own worst case, or the runner kills the wrapper before
// it collects the report it exists for. The set is DERIVED from each step's script
// and that script's relative imports, never listed.
//
// Declared limits, not claims: a program spawned by another (discover.mjs --run-gates,
// the `node --test` suites) is not a step's own script and is not graded here, and
// extensions.yml, the release lane, is not read by this block.
//
//   E1 the derivation finds the step that hung, and enough others to mean anything
//   E2 every such step runs --single-threaded and is bounded on its own, under the job
//
// Mutations run against extensions-ci.yml (2026-09-26, predictions written first):
//   · `--single-threaded` dropped from the render step                → E2 RED
//   · its `timeout-minutes: 2` dropped                                → E2 RED
//   · its `timeout-minutes` raised to the catalogue job's 10          → E2 RED
//   · a hang-guard step's bound lowered from 8 to 5                   → E2 RED
//   · `--single-threaded` dropped from a hang-guard step's inner node → E2 RED
//   · the render step removed entirely                                → E1 RED
// ─────────────────────────────────────────────────────────────────────────────
describe('an extensions-ci step that runs a zlib program runs single-threaded and bounded', () => {
  const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
  const WF = '.github/workflows/extensions-ci.yml';
  const RUN = /\bnode((?:\s+--[\w-]+(?:=\S+)?)*)\s+(?:\.\/)?((?:scripts|tooling)\/[\w/.-]+\.mjs)\b/g;
  const ZLIB = /^import\b[^\n]*\bfrom\s+['"](?:node:)?zlib['"]/m;
  const LOCAL_IMPORT = /^import\b[^\n]*?\bfrom\s+['"](\.{1,2}\/[^'"]+)['"]/gm;
  const HANG_GUARD = /hang-guard\.mjs\b[^\n]*?--seconds\s+(\d+)(?:[^\n]*?--retries\s+(\d+))?/;
  const STEP_TIMEOUT = /^ {8}timeout-minutes:\s*(\S+)\s*$/;
  const STEP_WD = /^ {8}working-directory:\s*(\S+)\s*$/;
  const JOB_TIMEOUT = /^ {4}timeout-minutes:\s*(\d+)\s*$/;
  const DEFAULT_WD = /^ {4}working-directory:\s*(\S+)\s*$/;

  /** True when `abs` or any file it imports by a relative path imports zlib. */
  function reachesZlib(abs, seen = new Set()) {
    if (seen.has(abs) || !existsSync(abs)) return false;
    seen.add(abs);
    const src = readFileSync(abs, 'utf8');
    if (ZLIB.test(src)) return true;
    for (const m of src.matchAll(LOCAL_IMPORT)) if (reachesZlib(join(dirname(abs), m[1]), seen)) return true;
    return false;
  }

  const wf = parseWorkflow(REPO_ROOT, WF);
  // `defaults.run.working-directory` sits above `jobs:`, which only `wf.lines` holds.
  const defaultWd = (wf?.lines ?? []).slice(0, (wf?.jobsAt ?? 1) - 1).map((l) => l.text.match(DEFAULT_WD)?.[1]).find(Boolean) ?? '.';
  const zlibSteps = [];
  for (const [jobName, job] of wf?.jobs ?? []) {
    const jobBound = Number(job.lines.map((l) => l.text.match(JOB_TIMEOUT)?.[1]).find(Boolean));
    for (const s of workflowSteps(job)) {
      if (!s.run) continue;
      const range = job.lines.filter((l) => l.n >= s.first && l.n <= s.last);
      const wd = range.map((l) => l.text.match(STEP_WD)?.[1]).find(Boolean) ?? defaultWd;
      const bound = range.map((l) => l.text.match(STEP_TIMEOUT)?.[1]).find(Boolean) ?? null;
      const guard = s.run.text.match(HANG_GUARD);
      for (const m of s.run.text.matchAll(RUN)) {
        const script = wd === '.' ? m[2] : `${wd}/${m[2]}`;
        if (!reachesZlib(join(REPO_ROOT, script))) continue;
        zlibSteps.push({
          at: `extensions-ci.yml:${s.first}`, job: jobName, jobBound, script, flags: m[1], bound,
          // Each hang-guard attempt is its --seconds plus up to ~30 s of report grace and tree kill.
          guardWorst: guard ? (Number(guard[2] ?? 0) + 1) * (Number(guard[1]) + 30) : 0,
        });
      }
    }
  }

  test('E1 the derivation finds the step that hung, and enough others to mean anything', () => {
    assert.ok(wf, `${WF} did not parse, so nothing below is graded`);
    assert.ok(zlibSteps.some((z) => z.job === 'catalogue' && z.script === 'extensions/scripts/render-extension-graphics.mjs'),
      `the derivation no longer finds the catalogue job's render step, the step that hung:\n${zlibSteps.map((z) => `${z.at} ${z.script}`).join('\n')}`);
    assert.ok(zlibSteps.length >= 8, `expected the eight zlib steps of 2026-09-26 (render, listing assets, pack x2, verify-refs x2, store packages x2), found ${zlibSteps.length}:\n${zlibSteps.map((z) => `${z.at} ${z.script}`).join('\n')}`);
    for (const z of zlibSteps) assert.ok(Number.isInteger(z.jobBound) && z.jobBound > 0, `${z.at}: job ${z.job} declares no job-level timeout-minutes to compare a step bound with`);
  });

  test('E2 every such step runs --single-threaded and is bounded on its own, under the job', () => {
    const bad = [];
    for (const z of zlibSteps) {
      if (!/(^|\s)--single-threaded(\s|$)/.test(z.flags)) bad.push(`${z.at} runs ${z.script} with V8 background tasks ON (nodejs/node#54918)`);
      if (z.bound === null) { bad.push(`${z.at} ${z.script} has no step-level timeout-minutes, so a hang eats the ${z.job} job's ${z.jobBound}`); continue; }
      const minutes = /^[0-9]+$/.test(z.bound) ? Number(z.bound) : NaN;
      if (!(minutes >= 2 && minutes < z.jobBound)) bad.push(`${z.at} ${z.script} is bounded at ${z.bound}: a step bound is a whole number of minutes, at least 2 and under the ${z.job} job's ${z.jobBound}`);
      else if (minutes * 60 < z.guardWorst) {
        bad.push(`${z.at} ${z.script} is bounded at ${minutes} min, under its hang-guard's own worst case of ${z.guardWorst} s: the runner would kill the wrapper before it collects its report`);
      }
    }
    assert.deepEqual(bad, [], bad.join('\n'));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ⏱ 2026-09-27 · THE HANG REACHED THE GATE SELF-TEST'S CHILDREN (FXH-2). Main run
// 36316375328 attempt 1, extensions-ci.yml job `selftest`: the case "the committed
// listing graphics are the renderer's own output" spawned render-extension-graphics.mjs,
// which printed its three `pixel-identical` PASS lines and never exited; the suite's
// 120 s spawn bound killed it and the case read `expected exit 0, got null` over a gate
// that had passed. E1/E2 put that program on --single-threaded as a STEP; here it was a
// CHILD, the declared limit of that block ("a program spawned by another ... is not
// graded"). This block grades that one spawner, extensions/scripts/test/selftest.node.js,
// and the step that runs it.
//
// The launches are DERIVED from the suite's source: every `process.execPath` in it is
// read as a launch, so prose that names one reads as a launch too and goes RED — a
// visible false red, never a silent skip. The one exception is a NO_CASE_RECORDED
// `why:` line, a single-quoted string by that list's construction (one quotes
// listing-assets.test.mjs's spawn). The async key stub is a server the suite kills, so
// it takes the flag and no bound; every synchronous launch takes both.
//
//   S1 the derivation finds every node launch in the suite, run()'s among them
//   S2 each runs --single-threaded, each synchronous one under CHILD_BOUND_MS, and the
//      step runs the suite --single-threaded, bounded above one child's bound and
//      under its job's
//
// Mutations run against the real tree (2026-09-27, predictions written first):
//   · SINGLE_THREADED dropped from run()'s spawn                        → S2 RED
//   · `timeout: CHILD_BOUND_MS` dropped from a policy-check spawn       → S2 RED
//   · SINGLE_THREADED dropped from the key stub's spawn                 → S2 RED
//   · a new `spawnSync('node', ...)` launch added                       → S2 RED
//   · `--single-threaded` dropped from the workflow step                → S2 RED
//   · the step's `timeout-minutes: 8` dropped                           → S2 RED
//   · run()'s spawn rewritten through `const NODE = process.execPath`   → S1 RED
// ─────────────────────────────────────────────────────────────────────────────
describe('the extensions gate self-test starts every node child single-threaded and bounded', () => {
  const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
  const SUITE = 'extensions/scripts/test/selftest.node.js';
  const WF = '.github/workflows/extensions-ci.yml';
  const JOB = 'selftest';
  const STEP_RUN = /\bnode((?:\s+--[\w-]+(?:=\S+)?)*)\s+(?:\.\/)?scripts\/test\/selftest\.node\.js\b/;
  const STEP_TIMEOUT = /^ {8}timeout-minutes:\s*(\S+)\s*$/;
  const JOB_TIMEOUT = /^ {4}timeout-minutes:\s*(\d+)\s*$/;
  const RECORDED_WHY = /^\s*why:\s*'/;
  const CALL_BEFORE = /\b(spawnSync|spawn)\(\s*$/;
  const FIRST_ARG = /^\s*,\s*\[\s*([^\s,\]]+)/;
  const OTHER_LAUNCH = /\b(?:spawnSync|spawn|execFileSync|execFile|execSync|exec)\(\s*['"`]node(?:\.exe)?\b|\bfork\(/;

  const suitePath = join(REPO_ROOT, SUITE);
  const src = existsSync(suitePath) ? readFileSync(suitePath, 'utf8') : '';
  const lines = src.split('\n');
  const lineOf = (i) => src.slice(0, i).split('\n').length;
  const flag = src.match(/^const SINGLE_THREADED = '(--single-threaded)';$/m)?.[1] ?? null;
  const childBoundMs = Number(src.match(/^const CHILD_BOUND_MS = (\d+);$/m)?.[1] ?? NaN);

  /** The call's text from its `(` to the matching `)`, or null past 2000 characters. */
  function callText(open) {
    let depth = 0;
    for (let i = open; i < src.length && i < open + 2000; i++) {
      if (src[i] === '(') depth++;
      else if (src[i] === ')' && --depth === 0) return src.slice(open, i + 1);
    }
    return null;
  }

  const launches = [];
  const unread = [];
  for (const m of src.matchAll(/\bprocess\.execPath\b/g)) {
    const n = lineOf(m.index);
    if (RECORDED_WHY.test(lines[n - 1])) continue;
    const call = src.slice(Math.max(0, m.index - 40), m.index).match(CALL_BEFORE);
    if (!call) {
      unread.push(`${SUITE}:${n} uses process.execPath outside a spawn/spawnSync(process.execPath, [...]) call, a launch this block cannot read`);
      continue;
    }
    const text = callText(m.index - call[0].length + call[0].indexOf('('));
    const first = src.slice(m.index + 'process.execPath'.length).match(FIRST_ARG)?.[1] ?? null;
    launches.push({ at: `${SUITE}:${n}`, index: m.index, sync: call[1] === 'spawnSync', text, first });
  }
  const runStart = src.indexOf('\nfunction run(');
  const runEnd = runStart === -1 ? -1 : src.indexOf('\n}\n', runStart);

  const wf = parseWorkflow(REPO_ROOT, WF);
  const job = wf?.jobs.get(JOB);
  const jobBound = Number(job?.lines.map((l) => l.text.match(JOB_TIMEOUT)?.[1]).find(Boolean));
  const steps = [];
  for (const s of job ? workflowSteps(job) : []) {
    const m = s.run?.text.match(STEP_RUN);
    if (!m) continue;
    const bound = job.lines.filter((l) => l.n >= s.first && l.n <= s.last).map((l) => l.text.match(STEP_TIMEOUT)?.[1]).find(Boolean) ?? null;
    steps.push({ at: `extensions-ci.yml:${s.first}`, flags: m[1], bound });
  }

  test('S1 the derivation finds every node launch in the suite, run()\'s among them', () => {
    assert.ok(src, `${SUITE} could not be read, so nothing below is graded`);
    assert.deepEqual(unread, [], unread.join('\n'));
    assert.ok(runStart !== -1 && runEnd !== -1 && launches.some((l) => l.index > runStart && l.index < runEnd),
      `the derivation no longer finds run()'s launch, the one the render case hung under:\n${launches.map((l) => l.at).join('\n')}`);
    assert.match(src, /script: 'render-extension-graphics\.mjs'/, 'the render case no longer goes through run(), so the launch that hung is not the one graded');
    assert.ok(launches.length >= 5, `expected the five node launches of 2026-09-27 (run, spied, policy-check x2, the key stub), found ${launches.length}:\n${launches.map((l) => l.at).join('\n')}`);
    assert.ok(launches.some((l) => !l.sync), 'the derivation no longer finds the async key-stub launch');
    assert.ok(job, `${WF} has no job ${JOB}, so its step is not graded`);
    assert.ok(Number.isInteger(jobBound) && jobBound > 0, `${JOB} declares no job-level timeout-minutes this block can compare a step bound with`);
    assert.equal(steps.length, 1, `expected exactly one ${JOB} step running scripts/test/selftest.node.js, found ${steps.length}`);
  });

  test('S2 every launch runs --single-threaded, every synchronous one under CHILD_BOUND_MS, and the step is single-threaded and bounded', () => {
    const bad = [];
    if (flag === null) bad.push(`${SUITE} no longer declares \`const SINGLE_THREADED = '--single-threaded';\``);
    if (!(Number.isInteger(childBoundMs) && childBoundMs > 0)) bad.push(`${SUITE} no longer declares \`const CHILD_BOUND_MS = <ms>;\``);
    for (const l of launches) {
      if (l.first !== 'SINGLE_THREADED') bad.push(`${l.at} starts node with ${l.first ?? 'an argument list this block cannot read'} first, not SINGLE_THREADED: V8 background tasks ON (nodejs/node#54918)`);
      if (l.sync && !(l.text && /\btimeout:\s*CHILD_BOUND_MS\b/.test(l.text))) bad.push(`${l.at} is a spawnSync without \`timeout: CHILD_BOUND_MS\`, so a child that hangs hangs the suite`);
    }
    lines.forEach((text, i) => {
      if (!RECORDED_WHY.test(text) && OTHER_LAUNCH.test(text)) {
        bad.push(`${SUITE}:${i + 1} starts node another way (a 'node' literal or fork), which this block cannot read: launch it as spawn(Sync)(process.execPath, [SINGLE_THREADED, ...])`);
      }
    });
    for (const s of steps) {
      if (!/(^|\s)--single-threaded(\s|$)/.test(s.flags)) bad.push(`${s.at} runs the suite with V8 background tasks ON (nodejs/node#54918)`);
      if (s.bound === null) { bad.push(`${s.at} has no step-level timeout-minutes, so a hang eats the ${JOB} job's ${jobBound}`); continue; }
      const minutes = /^[0-9]+$/.test(s.bound) ? Number(s.bound) : NaN;
      if (!(minutes >= 2 && minutes < jobBound)) bad.push(`${s.at} is bounded at ${s.bound}: a step bound is a whole number of minutes, at least 2 and under the ${JOB} job's ${jobBound}`);
      else if (minutes * 60000 <= childBoundMs) bad.push(`${s.at} is bounded at ${minutes} min, not above one child's ${childBoundMs} ms bound: the runner would stop the suite before a hung child's case could name it`);
    }
    assert.deepEqual(bad, [], bad.join('\n'));
  });
});
