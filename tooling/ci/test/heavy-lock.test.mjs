// ─────────────────────────────────────────────────────────────────────────────
// heavy-lock.test.mjs — the machine-wide heavy-run lock (tooling/scripts/
// heavy-lock.mjs), its CLI (tooling/scripts/heavy.mjs) and preflight's use of it.
//
// 🔴 THE DEFECT THIS PINS, MEASURED 2026-09-19. "One heavy run at a time" was a
// sentence in the helper briefs, and check-then-start is not atomic: three lanes
// checked at 21:11-21:12, saw nothing, and ran the full suite and preflight at
// once (~1 h each instead of ~25 min). The same fan-out starved the offsite backup
// earlier that day until it was killed, missed its beat, and turned CI red.
//
// Every case below runs REAL processes against a lock file in a temp directory
// (NIKATRU_HEAVY_LOCK), never the machine's real lock: the suite itself is run
// under that lock by preflight. The backup query is stubbed in-process, and the
// child processes get NIKATRU_HEAVY_BACKUP_TASK='' so none of them asks the real
// scheduler (a powershell round trip is ~4.6 s here) or waits on the real backup.
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  acquireHeavyLock, releaseHeavyLock, reclaim, staleReason, readHolder, pidAlive, waitForBackup, queryBackupState,
  machineFree, defaultLockPath, TOKEN_ENV, LOCK_PATH_ENV,
} from '../../scripts/heavy-lock.mjs';

const SCRIPTS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'scripts');
const HEAVY = join(SCRIPTS, 'heavy.mjs');
const LOCK_MODULE = join(SCRIPTS, 'heavy-lock.mjs');
const PREFLIGHT = join(SCRIPTS, 'preflight.mjs');

const TMP = mkdtempSync(join(tmpdir(), 'heavy-lock-test-'));
after(() => { try { rmSync(TMP, { recursive: true, force: true }); } catch {} });
let n = 0;
/** A fresh lock path per case, so no case can see another's lock. */
const freshLock = () => join(TMP, `case-${++n}`, 'heavy-run.lock');

/** The environment every child gets: the temp lock, no backup task, not CI,
 *  fast polling, and NO inherited token (this suite may itself run under the
 *  real lock, through preflight — a child must not think it is re-entrant). */
const childEnv = (lockPath, extra = {}) => {
  const env = { ...process.env, [LOCK_PATH_ENV]: lockPath, NIKATRU_HEAVY_BACKUP_TASK: '', NIKATRU_HEAVY_LOCK_POLL_MS: '100', CI: '', ...extra };
  delete env[TOKEN_ENV];
  return env;
};
const node = (args, env, opts = {}) => {
  const r = spawnSync(process.execPath, args, { encoding: 'utf8', env, timeout: 60_000, ...opts });
  return { status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
};
const nodeAsync = (args, env) =>
  new Promise((settle) => {
    const c = spawn(process.execPath, args, { env });
    let out = '';
    c.stdout.on('data', (d) => { out += d; });
    c.stderr.on('data', (d) => { out += d; });
    c.on('close', (status) => settle({ status, out }));
  });
const waitFor = async (pred, ms = 20_000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (pred()) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return false;
};
/** A pid that WAS a process and is not any more. */
const deadPid = () => Number(spawnSync(process.execPath, ['-e', 'console.log(process.pid)'], { encoding: 'utf8' }).stdout.trim());
/** Write a lock record by hand, as a holder would have. */
const plant = (lockPath, record) => {
  mkdirSync(dirname(lockPath), { recursive: true });
  const full = { pid: process.pid, argv: ['planted-holder', '--by-test'], startedAt: new Date().toISOString(), host: 'test-host', token: `planted-${n}`, ...record };
  writeFileSync(lockPath, JSON.stringify(full));
  return full;
};
/** A critical section: appends S, holds for `ms`, appends E, to one shared log. */
const section = (log, id, ms = 250) =>
  `const fs=require('fs');fs.appendFileSync(${JSON.stringify(log)},'S ${id}\\n');` +
  `Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,${ms});` +
  `fs.appendFileSync(${JSON.stringify(log)},'E ${id}\\n');`;

/** A preload that reproduces the 2026-09-20 hang: the work is done, then the
 *  process never exits and runs NO exit handler — process.exit and an uncaught
 *  error both write a marker and block forever at 0 % CPU (pid 24176: 85.8 min,
 *  CPU flat, children gone). Passed with --import on the process under test only;
 *  NODE_OPTIONS would carry it into the command heavy.mjs runs. */
const HANG_AT_EXIT = (() => {
  const file = join(TMP, 'hang-at-exit.mjs');
  writeFileSync(file, [
    `import { writeFileSync } from 'node:fs';`,
    `const hang = (why) => { writeFileSync(process.env.HANG_MARKER, why); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0); };`,
    `process.exit = (code) => hang('exit ' + code);`,
    `process.on('uncaughtException', (e) => hang('uncaught ' + (e && e.message)));`,
  ].join('\n'));
  return pathToFileURL(file).href;
})();
/** Run `args` under HANG_AT_EXIT; once it hangs, record whether it is alive and
 *  whether the lock exists, then kill it. */
const hungRun = async (args, env, { cwd, lock }) => {
  const marker = join(dirname(lock), `hung-${++n}.marker`);
  mkdirSync(dirname(lock), { recursive: true });
  const c = spawn(process.execPath, ['--import', HANG_AT_EXIT, ...args], { env: { ...env, HANG_MARKER: marker }, cwd });
  let out = '';
  c.stdout.on('data', (d) => { out += d; });
  c.stderr.on('data', (d) => { out += d; });
  const closed = new Promise((settle) => c.on('close', settle));
  const hung = await waitFor(() => existsSync(marker) || c.exitCode !== null, 30_000);
  const state = {
    marker: existsSync(marker) ? readFileSync(marker, 'utf8') : null,
    alive: c.exitCode === null && c.signalCode === null,
    lockHeld: existsSync(lock),
  };
  c.kill('SIGKILL');
  await closed;
  return { ...state, hung, out };
};

describe('a process HUNG after its work holds no lock (O-PREFLIGHT-HANGS-HOLDING-THE-MACHINE-LOCK)', () => {
  test('control: releasing only in the exit handler KEEPS the lock while hung — the harness sees the 2026-09-20 shape', async () => {
    const lock = freshLock();
    const script = join(dirname(lock), 'exit-handler-only.mjs');
    mkdirSync(dirname(lock), { recursive: true });
    writeFileSync(script, [
      `import { machineFree, releaseOnExit } from ${JSON.stringify(pathToFileURL(LOCK_MODULE).href)};`,
      `const f = machineFree({ argv: ['exit-handler-only'] });`,
      `releaseOnExit(f.lock, (c) => process.exit(c));`,
      `process.exit(0);`,
    ].join('\n'));
    const r = await hungRun([script], childEnv(lock), { lock });
    assert.equal(r.marker, 'exit 0', r.out);
    assert.ok(r.alive);
    assert.equal(r.lockHeld, true, 'if this goes false the preload no longer simulates a hang and every case below is vacuous');
  });

  test('heavy.mjs: the command finished, heavy.mjs hangs at exit — the lock is already free, and the code was 3', async () => {
    const lock = freshLock();
    const r = await hungRun([HEAVY, '--', process.execPath, '-e', 'process.exit(3)'], childEnv(lock), { lock });
    assert.equal(r.marker, 'exit 3', r.out);
    assert.ok(r.alive);
    assert.equal(r.lockHeld, false, `heavy.mjs hung at exit still HOLDS the machine lock\n${r.out}`);
  });

  test('heavy.mjs: a command that cannot start, then a hang — COVERAGE LOST and the lock free', async () => {
    const lock = freshLock();
    const r = await hungRun([HEAVY, '--', 'no-such-command-nikatru-heavy-test'], childEnv(lock), { lock });
    assert.equal(r.marker, 'exit 2', r.out);
    assert.match(r.out, /COVERAGE LOST — could not start/);
    assert.ok(r.alive);
    assert.equal(r.lockHeld, false, r.out);
  });
});

describe('heavy.mjs — mutual exclusion between real processes', () => {
  test('control: a free lock is taken, the command runs, and the lock is gone afterwards', () => {
    const lock = freshLock();
    const r = node([HEAVY, '--', process.execPath, '-e', 'console.log("ran under lock")'], childEnv(lock));
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /heavy-run lock taken/);
    assert.match(r.out, /ran under lock/);
    assert.equal(existsSync(lock), false, 'the lock must be released after the command');
  });

  test('the lock records pid, argv, startedAt and host while it is held', async () => {
    const lock = freshLock();
    const holder = nodeAsync([HEAVY, '--', process.execPath, '-e', 'setTimeout(()=>{},1500)'], childEnv(lock));
    assert.ok(await waitFor(() => existsSync(lock)), 'the holder never created the lock');
    const read = readHolder(lock);
    assert.ok(read.holder, JSON.stringify(read));
    assert.ok(Number.isInteger(read.holder.pid) && read.holder.pid !== process.pid);
    assert.ok(read.holder.argv.includes('heavy.mjs'));
    assert.ok(Number.isFinite(Date.parse(read.holder.startedAt)));
    assert.equal(typeof read.holder.host, 'string');
    assert.equal((await holder).status, 0);
  });

  test('a second acquirer WAITS, names the holder, and runs only after the first released', async () => {
    const lock = freshLock();
    const log = join(dirname(lock), 'sections.log');
    mkdirSync(dirname(lock), { recursive: true });
    // ⏱ 6000, not 1500, and the reason is a REAL RED on 2026-09-20.
    //
    // 🔴 THE `after waiting` SUFFIX HAS A ONE-SECOND FLOOR. heavy-lock.mjs:244
    // appends it only when `waited > 1000`, so this assertion is not about
    // waiting at all — it is about waiting for MORE THAN A SECOND, and nothing
    // in the shape below guaranteed that. `waitFor` returns the moment the first
    // holder's section BEGINS, and the second acquirer is only spawned after
    // that: its wait is the hold MINUS however long waitFor took to notice the
    // file and Node took to start another process. At 1500ms that margin is
    // about a second, and on a loaded laptop spawning a child costs more than
    // that — so the run exited 0, printed `🔒 heavy-run lock taken` with NO
    // suffix, and the case failed on a machine, not on a change:
    //
    //     actual:   🔒 heavy-run lock taken — …\case-3\heavy-run.lock
    //     expected: /heavy-run lock taken .*after waiting/
    //
    // The busy line it printed in the same run said `for 0 min … Waited 0 min`,
    // which is the same sub-minute wait seen from the other side. It reddened a
    // lane whose change touched only the ops register.
    //
    // 6000 leaves ~5s of margin over the one-second floor instead of ~1s, on a
    // machine that also runs the backup and several parallel lanes. That is a
    // bigger margin, not a proof — so the two assertions BELOW carry the
    // property on their own: the busy line proves the second acquirer saw the
    // first holding, and the strict ordering of the sections log proves it ran
    // only after the first released. Neither depends on a clock.
    const first = nodeAsync([HEAVY, '--', process.execPath, '-e', section(log, 'first', 6000)], childEnv(lock));
    assert.ok(await waitFor(() => existsSync(log)), 'the first holder never started its section');
    const second = await nodeAsync([HEAVY, '--', process.execPath, '-e', section(log, 'second', 10)], childEnv(lock));
    const firstDone = await first;
    assert.equal(firstDone.status, 0, firstDone.out);
    assert.equal(second.status, 0, second.out);
    assert.match(second.out, /heavy-run lock busy — held by pid \d+ .*heavy\.mjs/);
    assert.match(second.out, /heavy-run lock taken .*after waiting/);
    assert.deepEqual(readFileSync(log, 'utf8').trim().split(/\r?\n/), ['S first', 'E first', 'S second', 'E second']);
  });

  test('SIX processes at once: their critical sections never overlap (the O_EXCL property itself)', async () => {
    const lock = freshLock();
    const log = join(dirname(lock), 'race.log');
    mkdirSync(dirname(lock), { recursive: true });
    const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
    const runs = await Promise.all(ids.map((id) => nodeAsync([HEAVY, '--', process.execPath, '-e', section(log, id, 150)], childEnv(lock))));
    for (const r of runs) assert.equal(r.status, 0, r.out);
    const lines = readFileSync(log, 'utf8').trim().split(/\r?\n/);
    assert.equal(lines.length, 12, lines.join(' | '));
    for (let i = 0; i < lines.length; i += 2) {
      const id = lines[i].slice(2);
      assert.deepEqual([lines[i], lines[i + 1]], [`S ${id}`, `E ${id}`], `two holders at once: ${lines.join(' | ')}`);
    }
    assert.equal(existsSync(lock), false);
  });

  test('the command\'s exit code is passed through, and the lock is still released', () => {
    const lock = freshLock();
    const r = node([HEAVY, '--', process.execPath, '-e', 'process.exit(7)'], childEnv(lock));
    assert.equal(r.status, 7, r.out);
    assert.equal(existsSync(lock), false);
  });

  test('re-entrant: a heavy run INSIDE a heavy run proceeds at once instead of waiting on its parent', () => {
    const lock = freshLock();
    const r = node([HEAVY, '--lock-wait', '0.05', '--', process.execPath, HEAVY, '--lock-wait', '0.05', '--', process.execPath, '-e', 'console.log("inner ran")'], childEnv(lock));
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /re-entrant/);
    assert.match(r.out, /inner ran/);
    assert.equal(existsSync(lock), false);
  });

  test('usage: no `--`, no command, a bad number → exit 2, nothing run', () => {
    const lock = freshLock();
    for (const args of [[], ['--'], ['--lock-wait', 'x', '--', 'node'], ['--bogus', '1', '--', 'node']]) {
      const r = node([HEAVY, ...args], childEnv(lock));
      assert.equal(r.status, 2, `${args.join(' ')}: ${r.out}`);
      assert.match(r.out, /usage:/);
    }
    assert.equal(existsSync(lock), false);
  });
});

describe('stale locks are reclaimed LOUDLY; a live one is waited for, up to the ceiling', () => {
  test('a holder pid that is not running → reclaimed, naming the dead holder', () => {
    const lock = freshLock();
    const pid = deadPid();
    assert.equal(pidAlive(pid), false, `control: pid ${pid} should be gone`);
    plant(lock, { pid });
    const r = node([HEAVY, '--lock-wait', '0.05', '--', process.execPath, '-e', 'console.log("ran")'], childEnv(lock));
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, new RegExp(`RECLAIMED — holder pid ${pid} is not running.*planted-holder`));
    assert.match(r.out, /ran/);
  });

  test('a holder KILLED outright (no handler runs) leaves the file, and the next run reclaims it', async () => {
    const lock = freshLock();
    const c = spawn(process.execPath, [HEAVY, '--', process.execPath, '-e', 'setTimeout(()=>{},60000)'], { env: childEnv(lock) });
    assert.ok(await waitFor(() => existsSync(lock)), 'the holder never took the lock');
    const holderPid = readHolder(lock).holder.pid;
    // kill heavy.mjs itself; its child is orphaned, the lock file stays behind
    const grandchildren = spawnSync('taskkill', ['/pid', String(holderPid), '/T', '/F']);
    if (grandchildren.error) process.kill(holderPid, 'SIGKILL');
    await new Promise((r) => (c.exitCode !== null ? r() : c.on('exit', r)));
    assert.ok(existsSync(lock), 'control: a hard kill must leave the lock file behind');
    const r = node([HEAVY, '--lock-wait', '0.05', '--', process.execPath, '-e', 'console.log("after")'], childEnv(lock));
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, new RegExp(`RECLAIMED — holder pid ${holderPid} is not running`));
  });

  test('a LIVE pid older than the age ceiling → reclaimed (a reused pid, or a hung run)', () => {
    const lock = freshLock();
    plant(lock, { startedAt: new Date(Date.now() - 10 * 60_000).toISOString() });
    const r = node([HEAVY, '--lock-wait', '0.05', '--', process.execPath, '-e', '0'], childEnv(lock, { NIKATRU_HEAVY_LOCK_MAX_AGE_MIN: '5' }));
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /RECLAIMED — held for 10 min, past the 5 min age ceiling/);
  });

  test('a LIVE, fresh holder past the --lock-wait ceiling → exit 2 COVERAGE LOST naming it, and its lock untouched', () => {
    const lock = freshLock();
    const planted = plant(lock, {});
    const t0 = Date.now();
    const r = node([HEAVY, '--lock-wait', '0.05', '--', process.execPath, '-e', 'console.log("MUST NOT RUN")'], childEnv(lock));
    assert.equal(r.status, 2, r.out);
    assert.match(r.out, /COVERAGE LOST — the heavy-run lock .* is held by pid \d+ on test-host .*planted-holder --by-test; waited/);
    assert.ok(r.out.includes(`pid ${process.pid}`));
    assert.doesNotMatch(r.out, /MUST NOT RUN/);
    assert.ok(Date.now() - t0 >= 2_500, 'it must have WAITED about --lock-wait (3 s) before giving up');
    assert.equal(readHolder(lock).holder.token, planted.token, 'the live holder\'s lock must be left alone');
  });

  test('an empty (torn) lock file is waited for while fresh, and never reclaimed within the grace', () => {
    const lock = freshLock();
    mkdirSync(dirname(lock), { recursive: true });
    writeFileSync(lock, '');
    const r = node([HEAVY, '--lock-wait', '0.03', '--', process.execPath, '-e', '0'], childEnv(lock));
    assert.equal(r.status, 2, r.out);
    assert.match(r.out, /unreadable lock record \(empty/);
    assert.ok(existsSync(lock));
  });

  test('staleReason: the three verdicts, with a stubbed liveness probe', () => {
    const now = Date.parse('2026-09-19T12:00:00Z');
    const holder = { pid: 42, token: 't', startedAt: '2026-09-19T11:50:00Z' };
    assert.equal(staleReason({ holder }, { now, maxAgeMs: 60 * 60_000, alive: () => true }), null);
    assert.match(staleReason({ holder }, { now, maxAgeMs: 60 * 60_000, alive: () => false }), /pid 42 is not running/);
    assert.match(staleReason({ holder }, { now, maxAgeMs: 5 * 60_000, alive: () => true }), /past the 5 min age ceiling/);
  });
});

describe('release on crash, and CI mode', () => {
  test('an uncaught error after acquiring still releases the lock (the exit handler)', () => {
    const lock = freshLock();
    const script = join(dirname(lock), 'crash.mjs');
    mkdirSync(dirname(lock), { recursive: true });
    writeFileSync(script, [
      `import { machineFree, releaseOnExit } from ${JSON.stringify(pathToFileURL(LOCK_MODULE).href)};`,
      `import { existsSync } from 'node:fs';`,
      `const f = machineFree({ argv: ['crash-test'] });`,
      `releaseOnExit(f.lock, (c) => process.exit(c));`,
      `console.log('HELD ' + existsSync(${JSON.stringify(lock)}));`,
      `throw new Error('boom after acquiring');`,
    ].join('\n'));
    const r = node([script], childEnv(lock));
    assert.equal(r.status, 1, r.out);
    assert.match(r.out, /HELD true/);
    assert.match(r.out, /boom after acquiring/);
    assert.equal(existsSync(lock), false, 'the crash left the lock behind');
  });

  test('without releaseOnExit the same crash LEAVES the lock (control: the handler is what releases)', () => {
    const lock = freshLock();
    const script = join(dirname(lock), 'crash-nohandler.mjs');
    mkdirSync(dirname(lock), { recursive: true });
    writeFileSync(script, [
      `import { machineFree } from ${JSON.stringify(pathToFileURL(LOCK_MODULE).href)};`,
      `machineFree({ argv: ['crash-test'] });`,
      `throw new Error('boom');`,
    ].join('\n'));
    const r = node([script], childEnv(lock));
    assert.equal(r.status, 1, r.out);
    assert.equal(existsSync(lock), true);
  });

  test('CI set: no lock taken and no wait, even with a live holder; the line says so', () => {
    const lock = freshLock();
    const planted = plant(lock, {});
    const r = node([HEAVY, '--lock-wait', '0.05', '--', process.execPath, '-e', 'console.log("ci ran")'], childEnv(lock, { CI: 'true' }));
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /CI is set — heavy-run lock and backup wait SKIPPED/);
    assert.match(r.out, /ci ran/);
    assert.equal(readHolder(lock).holder.token, planted.token);
  });

  test('releaseHeavyLock never deletes a lock that is no longer ours', () => {
    const lock = freshLock();
    const env = {};
    const mine = acquireHeavyLock({ path: lock, waitMs: 0, env, log: () => {} });
    assert.ok(mine.ok);
    const theirs = plant(lock, { token: 'someone-else' });
    const lines = [];
    releaseHeavyLock(mine, { log: (l) => lines.push(l) });
    assert.equal(readHolder(lock).holder.token, theirs.token);
    assert.match(lines.join('\n'), /no longer ours/);
  });
});

describe('reclaim takes atomically and never destroys a fresh lock', () => {
  const rec = (token, pid = 999999) => JSON.stringify({ pid, argv: ['x'], startedAt: new Date().toISOString(), host: 'h', token });

  test('the stale lock that was judged is removed, and nothing is left behind', () => {
    const lock = freshLock();
    mkdirSync(dirname(lock), { recursive: true });
    writeFileSync(lock, rec('stale-token'));
    const judged = readHolder(lock);
    assert.equal(reclaim(lock, judged, () => {}), true);
    assert.equal(existsSync(lock), false);
  });

  test('a FRESH lock taken between the judgement and the rename is handed back intact', () => {
    const lock = freshLock();
    mkdirSync(dirname(lock), { recursive: true });
    writeFileSync(lock, rec('stale-token'));
    const judged = readHolder(lock);
    writeFileSync(lock, rec('fresh-token', process.pid)); // another waiter reclaimed and re-acquired
    const logs = [];
    assert.equal(reclaim(lock, judged, (l) => logs.push(l)), false);
    assert.equal(readHolder(lock).holder?.token, 'fresh-token', 'the fresh holder lost its lock record');
    assert.deepEqual(logs, []);
  });
});

describe('the backup wait (stubbed scheduler)', () => {
  const noSleep = () => {};
  test('Running, Running, Ready → waits two polls, then goes', () => {
    const states = ['Running', 'Running', 'Ready'];
    const slept = [];
    const lines = [];
    const r = waitForBackup({ query: () => ({ state: states.shift() }), deadline: Date.now() + 3_600_000, log: (l) => lines.push(l), sleep: (ms) => slept.push(ms) });
    assert.equal(r.ok, true);
    assert.equal(r.state, 'Ready');
    assert.equal(slept.length, 2);
    assert.equal(lines.filter((l) => /is Running/.test(l)).length, 2);
  });
  test('Ready at once → no wait at all (control)', () => {
    const slept = [];
    const r = waitForBackup({ query: () => ({ state: 'Ready' }), deadline: Date.now() + 1000, log: () => {}, sleep: (ms) => slept.push(ms) });
    assert.equal(r.ok, true);
    assert.equal(slept.length, 0);
  });
  test('Running past the deadline → not ok', () => {
    let t = 0;
    const r = waitForBackup({ query: () => ({ state: 'Running' }), deadline: 1000, now: () => t, sleep: (ms) => { t += ms; }, log: () => {}, pollMs: 400 });
    assert.equal(r.ok, false);
    assert.equal(r.state, 'Running');
  });
  test('a query that cannot answer is PRINTED and the run continues', () => {
    const lines = [];
    const r = waitForBackup({ query: () => ({ error: 'no powershell' }), deadline: Date.now() + 1000, log: (l) => lines.push(l), sleep: noSleep });
    assert.equal(r.ok, true);
    assert.match(lines.join('\n'), /could not read the task state — no powershell\. Continuing/);
  });
  test('queryBackupState: powershell EXITS 0 on an unknown task — the text decides, not the exit code', () => {
    const unknown = queryBackupState({ platform: 'win32', run: () => ({ status: 0, stdout: '', stderr: "Get-ScheduledTask : No MSFT_ScheduledTask objects found with property 'TaskName'" }) });
    assert.ok(unknown.error, JSON.stringify(unknown));
    assert.deepEqual(queryBackupState({ platform: 'win32', run: () => ({ status: 0, stdout: 'Running\r\n', stderr: '' }) }), { state: 'Running' });
    assert.ok(queryBackupState({ platform: 'win32', run: () => ({ status: null, stdout: '', stderr: '' }) }).error.includes('timed out'));
    assert.ok(queryBackupState({ platform: 'linux' }).error.includes('not Windows'));
  });
  test('machineFree: backup Running past the ceiling → COVERAGE LOST, and the lock it took is released', () => {
    const lock = freshLock();
    const env = { [LOCK_PATH_ENV]: lock, NIKATRU_HEAVY_BACKUP_TASK: 'stub' };
    const r = machineFree({ waitMin: 0, env, log: () => {}, query: () => ({ state: 'Running' }) });
    assert.equal(r.ok, false);
    assert.match(r.message, /COVERAGE LOST — the backup task 'stub' was still Running/);
    assert.equal(existsSync(lock), false);
  });
  test('defaultLockPath: LOCALAPPDATA on Windows, never os.tmpdir(); the override wins', () => {
    assert.equal(defaultLockPath({ env: { LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local' }, platform: 'win32' }), join('C:\\Users\\u\\AppData\\Local', 'nikatru', 'heavy-run.lock'));
    assert.equal(defaultLockPath({ env: { [LOCK_PATH_ENV]: '/x/y.lock', LOCALAPPDATA: 'C:\\L' }, platform: 'win32' }), '/x/y.lock');
    assert.ok(!defaultLockPath({ env: {}, platform: 'linux' }).startsWith(tmpdir()));
  });
});

describe('preflight takes the lock after the untracked leg, and only then', () => {
  let root;
  const git = (...args) => {
    const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...args], { cwd: root, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  };
  before(() => {
    root = mkdtempSync(join(TMP, 'repo-'));
    mkdirSync(join(root, 'tooling', 'scripts'), { recursive: true });
    copyFileSync(PREFLIGHT, join(root, 'tooling', 'scripts', 'preflight.mjs'));
    copyFileSync(LOCK_MODULE, join(root, 'tooling', 'scripts', 'heavy-lock.mjs'));
    git('init', '-q', '-b', 'main');
    git('add', '-A');
    git('commit', '-q', '-m', 'base');
  });
  const cli = (lock, ...args) => node([join(root, 'tooling', 'scripts', 'preflight.mjs'), ...args], childEnv(lock), { cwd: root });

  test('lock held by a live process: --sweep-only runs the untracked leg, then STOPS with exit 2 naming the holder', () => {
    const lock = freshLock();
    plant(lock, {});
    const r = cli(lock, '--sweep-only', '--lock-wait', '0.03');
    assert.equal(r.status, 2, r.out);
    assert.match(r.out, /ok {3}no untracked files/);
    assert.match(r.out, /COVERAGE LOST — the heavy-run lock .* held by pid \d+ on test-host .*planted-holder/);
    assert.match(r.out, /STOPPED before the first heavy leg/);
    assert.doesNotMatch(r.out, /… guard sweep/);
  });

  test('--untracked-only never touches the lock, even while it is held', () => {
    const lock = freshLock();
    plant(lock, {});
    const r = cli(lock, '--untracked-only', '--lock-wait', '0.03');
    assert.equal(r.status, 0, r.out);
    assert.doesNotMatch(r.out, /heavy-run lock/);
  });

  test('a free lock is taken before the sweep leg, and released when preflight exits', () => {
    const lock = freshLock();
    const r = cli(lock, '--sweep-only', '--lock-wait', '0.03');
    // the sweep itself cannot run in this skeleton repo (no guard-sweep.mjs); what
    // matters is the ORDER of the lines and the lock's absence afterwards
    assert.match(r.out, /heavy-run lock taken[\s\S]*… guard sweep/);
    assert.equal(existsSync(lock), false, 'preflight left the lock behind');
  });

  test('the lock is released ONCE and cleanly, though two paths release it', () => {
    // ⏱ 2026-09-20. preflight now releases at the END OF THE WORK — before the
    // verdict is printed — so the lock no longer depends on an exit that may
    // never arrive: three preflights were found that day hung AFTER their
    // verdict, holding the machine-wide lock (pid 24176 for 85.8 min with both
    // children exited and its CPU flat across a 25-second sample). `pidAlive`
    // cannot see that, so the stale ceiling was the only backstop.
    //
    // 🔴 WHAT THIS CASE ACTUALLY PROVES is the part that is observable from
    // outside: the explicit release and the `process.on('exit')` handler BOTH
    // run, and the second one is a clean no-op. If it were not idempotent, the
    // second would find the lock gone and print `at release the lock was no
    // longer ours … someone reclaimed it as stale` — a warning that would send
    // the next reader hunting a reclaim that never happened.
    const lock = freshLock();
    const r = cli(lock, '--sweep-only', '--lock-wait', '0.03');
    assert.doesNotMatch(
      r.out,
      /no longer ours/,
      'the double release must be silent; a warning here means releaseHeavyLock stopped being idempotent',
    );
    assert.equal(existsSync(lock), false);
    // Exactly one "lock taken" line: the release must not make it re-acquire.
    assert.equal((r.out.match(/heavy-run lock taken/g) ?? []).length, 1, r.out);
  });

  test('🔴 a preflight HUNG after its work holds NO lock — observed while the process is still alive', async () => {
    // The closes clause of O-PREFLIGHT-HANGS-HOLDING-THE-MACHINE-LOCK, literally:
    // "a test proving the lock is free while a deliberately hung process still
    // runs". The hang is injected at process.exit (see hangAtExit), so no exit
    // handler can have released it: only the release at the end of the WORK can.
    const lock = freshLock();
    const r = await hungRun([join(root, 'tooling', 'scripts', 'preflight.mjs'), '--sweep-only', '--lock-wait', '0.03'], childEnv(lock), { cwd: root, lock });
    assert.equal(r.marker, 'exit 1', `preflight must reach its verdict and then hang in exit\n${r.out}`);
    assert.ok(r.alive, 'the process must still be running when the lock is inspected, or this proves nothing');
    assert.match(r.out, /heavy-run lock taken/);
    assert.equal(r.lockHeld, false, `a finished preflight hung at exit still HOLDS the machine lock\n${r.out}`);
  });

  test('🔴 a leg that THROWS is graded FAIL and the lock is still freed before a hang', async () => {
    // A leg's throw used to escape step(), skip the release at the verdict and
    // leave the lock to the exit handler — the path a hung process never runs.
    // Injected: a preload makes the sweep leg's own mkdtempSync throw, AFTER the
    // lock is taken. ⏱ 2026-09-23 — an unusable temp directory was the first
    // injection; since every command's output goes through a capture FILE
    // (captureSync), that stops the untracked leg before the lock and never
    // reaches the sweep leg, so the throw is aimed at the one call instead.
    const lock = freshLock();
    mkdirSync(dirname(lock), { recursive: true });
    const preload = join(dirname(lock), 'sweep-leg-throws.mjs');
    writeFileSync(preload, [
      `import fs from 'node:fs';`,
      `import { syncBuiltinESMExports } from 'node:module';`,
      `const real = fs.mkdtempSync;`,
      `fs.mkdtempSync = (prefix, ...rest) => {`,
      `  if (String(prefix).includes('nikatru-preflight-')) throw new Error('injected: the sweep leg cannot make its temp dir');`,
      `  return real(prefix, ...rest);`,
      `};`,
      `syncBuiltinESMExports();`,
    ].join('\n'));
    const env = childEnv(lock);
    const r = await hungRun(['--import', pathToFileURL(preload).href, join(root, 'tooling', 'scripts', 'preflight.mjs'), '--sweep-only', '--lock-wait', '0.03'], env, { cwd: root, lock });
    assert.ok(r.alive, 'the process must still be running when the lock is inspected');
    assert.equal(r.lockHeld, false, `a leg that threw left the lock to an exit that never came (${r.marker})\n${r.out}`);
    assert.equal(r.marker, 'exit 1', `the throw must become a FAIL leg and a verdict, not an uncaught crash\n${r.out}`);
    assert.match(r.out, /THE LEG THREW/);
    assert.match(r.out, /injected: the sweep leg cannot make its temp dir/, 'the leg must have thrown the INJECTED error, not some other');
  });

  test('--lock-wait with no number is a usage error (exit 2)', () => {
    const r = cli(freshLock(), '--lock-wait', 'soon');
    assert.equal(r.status, 2, r.out);
    assert.match(r.out, /--lock-wait needs a number/);
  });
});
