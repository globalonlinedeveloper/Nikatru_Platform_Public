// ─────────────────────────────────────────────────────────────────────────────
// preflight-hung-leg.test.mjs — preflight never waits on a PIPE, and the
// machine-wide heavy-run lock is FREE while a hung descendant is still running.
//
// 🔴 THE DEFECT THIS PINS, MEASURED 2026-09-20 (O-PREFLIGHT-HANGS-HOLDING-THE-
// MACHINE-LOCK). `spawnSync` with stdio PIPES returns at pipe EOF, which is not
// process exit. Leg 1 is `run('node', ['--test', …])`, spawned with shell:true
// on Windows, so the shape is cmd.exe → node --test → whatever those tests
// spawn. Every descendant inherits the write end of preflight's stdout pipe. On
// 2026-09-20 preflight pid 24176 was alive for 85.8 min with BOTH its children
// (cmd.exe 23652 and node --test 2412) already exited and its CPU flat across a
// 25-second sample — holding the machine-wide lock, with three other lanes and
// a capture rehearsal queued behind a run that had finished. `pidAlive` cannot
// see that: a hung process is alive.
//
// #849 moved the release to the end of the WORK, which covers a hang at exit.
// It does not cover a process blocked INSIDE spawnSync, which never reaches the
// release at all. The fix is `captureSync`: stdout and stderr go to two temp
// FILES, which have no EOF to wait for, plus a per-leg timeout for the other
// case (a direct child that itself never exits).
//
// Every case here uses a temp NIKATRU_HEAVY_LOCK, never the machine's real lock
// at %LOCALAPPDATA%\nikatru\heavy-run.lock: this suite is itself run under that
// lock by preflight and by ci.yml.
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, copyFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run, captureSync, LEG_TIMEOUT_MS } from '../../scripts/preflight.mjs';

const SCRIPTS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'scripts');
const PREFLIGHT = join(SCRIPTS, 'preflight.mjs');
const LOCK_MODULE = join(SCRIPTS, 'heavy-lock.mjs');
const WIN = process.platform === 'win32';

const TMP = mkdtempSync(join(tmpdir(), 'preflight-hung-leg-'));
/** Pids of the deliberately hung processes each case leaves running. */
const ORPHANS = [];
after(() => {
  for (const pid of ORPHANS) { try { process.kill(pid, 'SIGKILL'); } catch {} }
  try { rmSync(TMP, { recursive: true, force: true }); } catch {}
});

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const write = (name, body) => { const p = join(TMP, name); writeFileSync(p, body, 'utf8'); return p; };

/** A script that spawns a DETACHED grandchild inheriting stdio, unrefs it, and
 *  exits 0 straight away. The grandchild holds whatever stdout it was given for
 *  `holdMs`. With pipes that blocks the parent's spawnSync for the full hold;
 *  with files there is nothing to hold. */
const parentThatLeavesAnOrphan = (holdMs, pidFile) => [
  "const { spawn } = require('node:child_process');",
  "const fs = require('node:fs');",
  `const kid = spawn(process.execPath, ['-e', 'setTimeout(()=>{}, ${holdMs})'], { detached: true, stdio: 'inherit' });`,
  'kid.unref();',
  `fs.writeFileSync(${JSON.stringify(pidFile)}, String(kid.pid));`,
  "console.log('parent-done ' + process.pid);",
  'process.exit(0);',
].join('\n');

describe('run()/captureSync(): the wait ends when the CHILD exits, not at pipe EOF', () => {
  test('a grandchild that inherited stdout and runs for 40 s does not hold the leg', () => {
    const pidFile = join(TMP, 'orphan-1.pid');
    const script = write('parent-1.cjs', parentThatLeavesAnOrphan(40_000, pidFile));
    const t0 = Date.now();
    const r = run('node', [script]);
    const elapsed = Date.now() - t0;
    if (existsSync(pidFile)) ORPHANS.push(Number(readFileSync(pidFile, 'utf8').trim()));

    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /parent-done \d+/);
    // 🔴 THE ASSERTION. With the pipe `run()` this is ~40 000 ms, because
    // spawnSync waits for the inherited write end to close. 15 s is generous
    // for a loaded Windows box and still an order of magnitude under the hold.
    assert.ok(elapsed < 15_000, `run() waited ${elapsed} ms for a child that exited at once — it is still waiting on a pipe`);
    assert.ok(ORPHANS.length > 0 && alive(ORPHANS[ORPHANS.length - 1]), 'the hung grandchild should still be running: this case is worthless if it is not');
  }, { timeout: 60_000 });

  test('a DIRECT child that never exits is killed at the timeout, and the leg reports COVERAGE LOST', () => {
    const script = write('hang-2.cjs', 'setTimeout(() => {}, 8000);');
    const r = run('node', [script], { timeout: 1500 });
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /COVERAGE LOST — `node .*hang-2\.cjs` did not exit within \d+ min and was killed/);
  }, { timeout: 30_000 });

  test('captureSync keeps stdout before stderr, and reports status and timedOut plainly', () => {
    const script = write('both-3.cjs', "process.stdout.write('OUT\\n'); process.stderr.write('ERR\\n'); process.exit(3);");
    const r = captureSync(process.execPath, [script]);
    assert.equal(r.status, 3);
    assert.equal(r.timedOut, false);
    assert.equal(r.out, 'OUT\nERR\n');
    assert.equal(r.timeout, LEG_TIMEOUT_MS);
  }, { timeout: 30_000 });

  // ⏱ ADDED 2026-09-23 (O-PREFLIGHT-HANGS-HOLDING-THE-MACHINE-LOCK). "Never
  // throw" covered the spawn, not the capture directory: with an unusable temp
  // directory mkdtempSync threw, and run() at module load (TREE_AT_START) took
  // preflight down as an uncaught crash before any leg could be graded.
  test('captureSync NEVER throws: an unusable temp directory is a null status with the reason, and nothing is run', () => {
    const keys = ['TEMP', 'TMP', 'TMPDIR'];
    const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
    const gone = join(TMP, 'no-such-temp-dir');
    const marker = join(TMP, 'ran-anyway.txt');
    for (const k of keys) process.env[k] = gone;
    let r;
    try {
      r = captureSync(process.execPath, ['-e', `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'x')`]);
    } finally {
      for (const k of keys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    }
    assert.equal(r.status, null);
    assert.equal(r.timedOut, false);
    assert.match(r.out, /COULD NOT CAPTURE — no capture file under .*no-such-temp-dir .*was NOT run/);
    assert.equal(existsSync(marker), false, 'the command ran with nowhere to capture its output');
  }, { timeout: 30_000 });
});

// ── the closes clause, end to end ────────────────────────────────────────────
// "a test that proves the lock is free while a deliberately hung process still
// runs". A PATH shim called `node` answers leg 1: on `--test` it leaves a
// detached, stdio-inherit orphan and exits 0, so the orphan holds PREFLIGHT'S
// OWN stdout on both OSes (win32 resolves `node` through cmd.exe because
// run() uses shell:true there; elsewhere execvp finds it).
describe('end to end: preflight releases the machine lock though a hung descendant survives it', () => {
  let root;
  let shimDir;
  const pidFile = join(TMP, 'orphan-e2e.pid');
  const git = (...args) => {
    const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...args], { cwd: root, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  };

  before(() => {
    root = mkdtempSync(join(TMP, 'repo-'));
    mkdirSync(join(root, 'tooling', 'scripts'), { recursive: true });
    copyFileSync(PREFLIGHT, join(root, 'tooling', 'scripts', 'preflight.mjs'));
    copyFileSync(LOCK_MODULE, join(root, 'tooling', 'scripts', 'heavy-lock.mjs'));
    // preflight.mjs imports the one workflow parse (ci-gate's needs, 2026-09-24).
    mkdirSync(join(root, 'tooling', 'ci'), { recursive: true });
    for (const f of ['workflow-scan.mjs', 'tree-walk.mjs']) copyFileSync(join(SCRIPTS, '..', 'ci', f), join(root, 'tooling', 'ci', f));
    git('init', '-q', '-b', 'main');
    git('add', '-A');
    git('commit', '-q', '-m', 'base');

    shimDir = join(TMP, 'shim');
    mkdirSync(shimDir, { recursive: true });
    const shimJs = join(shimDir, 'leave-an-orphan.cjs');
    writeFileSync(shimJs, parentThatLeavesAnOrphan(40_000, pidFile), 'utf8');
    if (WIN) {
      // cmd.exe finds node.cmd before node.exe on PATH (PATHEXT order).
      writeFileSync(join(shimDir, 'node.cmd'), [
        '@echo off',
        'if "%~1"=="--test" goto hung',
        '"%NIKATRU_REAL_NODE%" %*',
        'exit /b %errorlevel%',
        ':hung',
        '"%NIKATRU_REAL_NODE%" "%NIKATRU_SHIM_JS%"',
        'exit /b %errorlevel%',
      ].join('\r\n') + '\r\n', 'utf8');
    } else {
      const sh = join(shimDir, 'node');
      writeFileSync(sh, [
        '#!/bin/sh',
        'if [ "$1" = "--test" ]; then exec "$NIKATRU_REAL_NODE" "$NIKATRU_SHIM_JS"; fi',
        'exec "$NIKATRU_REAL_NODE" "$@"',
      ].join('\n') + '\n', 'utf8');
      chmodSync(sh, 0o755);
    }
  });

  test('the lock file is gone the moment preflight exits, while the orphan it spawned runs on', () => {
    const lock = join(TMP, 'e2e', 'heavy-run.lock');
    const env = {
      ...process.env,
      NIKATRU_HEAVY_LOCK: lock,
      NIKATRU_HEAVY_BACKUP_TASK: '',
      NIKATRU_HEAVY_LOCK_POLL_MS: '100',
      CI: '',
      NIKATRU_REAL_NODE: process.execPath,
      NIKATRU_SHIM_JS: join(shimDir, 'leave-an-orphan.cjs'),
      PATH: `${shimDir}${delimiter}${process.env.PATH ?? ''}`,
      Path: `${shimDir}${delimiter}${process.env.Path ?? process.env.PATH ?? ''}`,
    };
    delete env.NIKATRU_HEAVY_LOCK_TOKEN;

    const t0 = Date.now();
    const r = spawnSync(process.execPath, [join(root, 'tooling', 'scripts', 'preflight.mjs'), '--fast', '--lock-wait', '0.05'], {
      cwd: root, env, encoding: 'utf8', timeout: 120_000,
    });
    const elapsed = Date.now() - t0;
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
    if (existsSync(pidFile)) ORPHANS.push(Number(readFileSync(pidFile, 'utf8').trim()));

    // The skeleton has no guards, so later legs fail. What is judged here is
    // that preflight FINISHED and let go, never that it was green.
    assert.ok(elapsed < 25_000, `preflight took ${elapsed} ms while a 40 s orphan held its stdout — it waited on the pipe:\n${out.slice(-2000)}`);
    assert.equal((out.match(/heavy-run lock taken/g) ?? []).length, 1, `expected exactly one lock acquisition:\n${out.slice(-2000)}`);
    assert.equal(existsSync(lock), false, `preflight left the machine lock behind:\n${out.slice(-2000)}`);
    assert.ok(ORPHANS.length > 0, 'the shim never ran: leg 1 did not resolve `node` through the PATH shim');
    assert.ok(alive(ORPHANS[ORPHANS.length - 1]), 'the deliberately hung process must STILL BE RUNNING — that is the whole claim');
  }, { timeout: 180_000 });
});

// Not asserted here, deliberately: that the `finally` around the legs is what
// released the lock. `releaseOnExit` releases on the same path, so no case can
// tell the two apart from outside. The `finally` is proven by reading it.
