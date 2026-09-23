// ─────────────────────────────────────────────────────────────────────────────
// single-threaded-relaunch.test.mjs — the shared relaunch must pass the work
// through unchanged, and must never let "I could not look" read as a verdict.
//
// single-threaded-relaunch.mjs is how assert-launcher-icons.mjs,
// assert-elf-page-alignment.mjs, assert-listing-assets.mjs,
// assert-stamp-brand-assets.mjs and (since 2026-09-22)
// assert-apps-gov-in-media.mjs do their work with V8 background tasks OFF, so
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
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

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
// ─────────────────────────────────────────────────────────────────────────────
describe('every workflow step that runs a relaunching guard runs it as node --single-threaded', () => {
  const HERE = new URL('.', import.meta.url);
  const REPO_ROOT = new URL('../../../', HERE);
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
    const { readdirSync, readFileSync: read } = await import('node:fs');
    const ci = new URL('tooling/ci/', REPO_ROOT);
    const importers = readdirSync(ci).filter((f) => f.endsWith('.mjs') && f !== 'single-threaded-relaunch.mjs' && /from '\.\/single-threaded-relaunch\.mjs'/.test(read(new URL(f, ci), 'utf8')));
    assert.ok(importers.length >= 5, `expected the five heavy guards to import the relaunch, found: ${importers.join(', ')}`);
    for (const g of ['assert-launcher-icons.mjs', 'assert-elf-page-alignment.mjs', 'assert-listing-assets.mjs', 'assert-stamp-brand-assets.mjs', 'assert-apps-gov-in-media.mjs']) {
      assert.ok(importers.includes(g), `${g} no longer imports the relaunch`);
    }
  });

  test('no workflow invokes a relaunching guard without --single-threaded (declared gaps excepted, and still true)', async () => {
    const { readdirSync, readFileSync: read } = await import('node:fs');
    const ci = new URL('tooling/ci/', REPO_ROOT);
    const importers = readdirSync(ci).filter((f) => f.endsWith('.mjs') && f !== 'single-threaded-relaunch.mjs' && /from '\.\/single-threaded-relaunch\.mjs'/.test(read(new URL(f, ci), 'utf8')));
    const wfDir = new URL('.github/workflows/', REPO_ROOT);
    const bare = [];
    const flagged = [];
    const stillPending = new Map();
    for (const wf of readdirSync(wfDir).filter((f) => /\.ya?ml$/.test(f))) {
      read(new URL(wf, wfDir), 'utf8').split('\n').forEach((line, i) => {
        if (/^\s*#/.test(line)) return;
        for (const g of importers) {
          const m = line.match(new RegExp(`\\bnode((?:\\s+--[\\w-]+)*)\\s+tooling/ci/${g.replace('.', '\\.')}\\b`));
          if (!m) continue;
          if (/(^|\s)--single-threaded(\s|$)/.test(m[1])) { flagged.push(`${wf}:${i + 1} ${g}`); continue; }
          if ((PENDING.get(wf) ?? []).includes(g)) { stillPending.set(`${wf}|${g}`, true); continue; }
          bare.push(`${wf}:${i + 1} runs ${g} without --single-threaded`);
        }
      });
    }
    assert.deepEqual(bare, [], `a relaunching guard runs under a relaunch parent in CI:\n${bare.join('\n')}`);
    assert.ok(flagged.length >= 9, `expected the nine heavy-guard steps (ci.yml ×4, build-platforms.yml ×2, submit-play.yml ×2, store-screenshots.yml) to carry the flag, found ${flagged.length}:\n${flagged.join('\n')}`);
    for (const [wf, gs] of PENDING) {
      for (const g of gs) {
        assert.ok(stillPending.has(`${wf}|${g}`), `the declared gap ${wf} → ${g} is closed: remove it from PENDING`);
      }
    }
  });
});
