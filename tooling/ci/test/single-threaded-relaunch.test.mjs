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
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
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

const run = (file, args = [], execArgv = []) => {
  const r = spawnSync(process.execPath, [...execArgv, file, ...args], { encoding: 'utf8', timeout: 60_000 });
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
