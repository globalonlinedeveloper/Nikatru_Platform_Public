// ─────────────────────────────────────────────────────────────────────────────
// heavy-lock.mjs — ONE heavy local run at a time on this machine, enforced by a
// lock file, not by a sentence in a brief.
//
// 🔴 WHY THIS EXISTS, MEASURED 2026-09-19. "One heavy run at a time" was advisory
// text in every helper brief: "check the backup task is not Running and no other
// preflight is running, then start". Check-then-start is not atomic. At 21:11-21:12
// three lanes each checked, each saw nothing, and each started the full
// tooling/ci suite plus preflight at once; every one took ~1 h instead of ~25 min.
// Earlier the same day the laptop's offsite backup (Windows task 'NIKATRU daily
// backup', BelowNormal priority) was CPU-starved by the same kind of fan-out,
// killed at its 2 h limit, missed its heartbeat, and turned ops-watch AND main CI
// red. A rule that depends on every agent reading it at the right moment is a
// race, and it lost twice in one day.
//
// ── THE MECHANISM ────────────────────────────────────────────────────────────
//   · The lock is a FILE created with the O_EXCL flag (`openSync(path, 'wx')`).
//     The create either makes the file or fails EEXIST, in one system call, so
//     two acquirers can never both succeed. That is the whole point: the test
//     suite runs six real processes at once through this and asserts their
//     critical sections never overlap, and it goes red when 'wx' becomes 'w'.
//   · The file holds { pid, argv, startedAt, host, token }. `token` is random per
//     acquisition, so a holder only ever deletes ITS OWN lock.
//   · STALE = the holder pid is not alive (`process.kill(pid, 0)`: MEASURED on this
//     host 2026-09-19 — ESRCH for a dead or unknown pid, EPERM for a live process
//     we may not signal, which still means alive), or the lock is older than the
//     age ceiling (a Windows pid can be reused by an unrelated process, and then it
//     looks alive forever). A stale lock is reclaimed LOUDLY, naming the holder.
//   · Reclaim goes through a second O_EXCL file (`<lock>.reclaim`), re-reads the
//     lock under it and removes it only if it still carries the SAME stale token.
//     Without that, waiter A could reclaim and re-create, and waiter B — who read
//     the stale content a moment earlier — would delete A's fresh lock.
//   · RE-ENTRANT for descendants: the holder puts its token in the environment
//     (NIKATRU_HEAVY_LOCK_TOKEN). A child that finds its inherited token in the
//     lock file is running UNDER the holder and proceeds; otherwise a preflight
//     wrapped in heavy.mjs would wait 90 minutes on its own parent.
//   · Released on every exit the process gets to run code for: normal exit, an
//     uncaught error (both emit 'exit'), SIGINT, SIGHUP (a closed console window),
//     SIGBREAK and SIGTERM. A hard kill (TerminateProcess) runs nothing — that is what the
//     dead-pid rule is for.
//
// ── WHERE THE LOCK LIVES, AND WHY THERE ──────────────────────────────────────
//   %LOCALAPPDATA%\nikatru\heavy-run.lock on Windows, ~/.cache/nikatru/heavy-run.lock
//   elsewhere. NOT os.tmpdir(): TRAPS "/tmp differs between Bash and node" — on this
//   host MSYS bash's /tmp is not node's %TEMP%, `$TMPDIR` is empty in the Bash
//   tool, and %TEMP% itself appears both as a short (LOCALU~1) and a long path.
//   Two lanes that computed two different lock paths would each hold "the" lock.
//   LOCALAPPDATA is set by Windows per user, inherited unchanged by PowerShell,
//   MSYS bash and node alike (MEASURED 2026-09-19: all three print
//   C:\Users\localuserwin11\AppData\Local), and is not a temp directory anything
//   cleans. Override: NIKATRU_HEAVY_LOCK=<file> (the tests use a temp path).
//
// ── CI ───────────────────────────────────────────────────────────────────────
//   With process.env.CI set, both the lock and the backup wait are SKIPPED, and a
//   line says so. A GitHub-hosted job is its own ephemeral VM: there is no backup
//   task and no sibling lane on it, so the lock could only ever be uncontended —
//   and a lock file restored by a cache, or left by a cancelled step on a reused
//   runner, would block a job for 90 minutes over nothing. The contention this
//   exists for is a property of the laptop.
//
// This module has no main: it is imported by tooling/scripts/preflight.mjs and
// tooling/scripts/heavy.mjs, which own the exit codes. It never ends the process
// itself — the caller hands in its `exit` function.
// ─────────────────────────────────────────────────────────────────────────────
import { openSync, writeSync, closeSync, readFileSync, unlinkSync, mkdirSync, fstatSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { homedir, hostname } from 'node:os';
import { randomUUID } from 'node:crypto';

export const LOCK_PATH_ENV = 'NIKATRU_HEAVY_LOCK';
export const TOKEN_ENV = 'NIKATRU_HEAVY_LOCK_TOKEN';
export const MAX_AGE_ENV = 'NIKATRU_HEAVY_LOCK_MAX_AGE_MIN';
export const BACKUP_TASK_ENV = 'NIKATRU_HEAVY_BACKUP_TASK';
export const POLL_ENV = 'NIKATRU_HEAVY_LOCK_POLL_MS';
export const BACKUP_TASK = 'NIKATRU daily backup';
/** Default wait ceiling, minutes: a full preflight is ~25 min alone and was ~60
 *  under the 2026-09-19 three-way contention; 90 covers one full holder ahead. */
export const DEFAULT_WAIT_MIN = 90;
/** Age ceiling, minutes. The backup is killed at 2 h; no legitimate heavy run on
 *  this machine has come near 4 h, so a lock that old is a reused pid or a hang. */
export const DEFAULT_MAX_AGE_MIN = 240;
/** A lock file that is unreadable is being written right now — or was left
 *  half-written by a crash. Past this many seconds it is the second. */
const TORN_GRACE_MS = 30_000;
/** A reclaim marker older than this belongs to a reclaimer that died mid-step. */
const RECLAIM_GRACE_MS = 60_000;
const BACKUP_POLL_MS = 120_000;
const BACKUP_QUERY_TIMEOUT_MS = 30_000;

/** Synchronous sleep: preflight's legs are synchronous and so is this module. */
export function sleepSync(ms) {
  if (ms > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function defaultLockPath({ env = process.env, platform = process.platform } = {}) {
  if (env[LOCK_PATH_ENV]) return env[LOCK_PATH_ENV];
  if (platform === 'win32' && env.LOCALAPPDATA) return join(env.LOCALAPPDATA, 'nikatru', 'heavy-run.lock');
  return join(homedir(), '.cache', 'nikatru', 'heavy-run.lock');
}

/** true = the pid names a live process. EPERM means it exists and we may not
 *  signal it — alive. Anything but ESRCH is treated as alive: a wrong "dead"
 *  would steal a live lock, a wrong "alive" only waits for the age ceiling. */
export function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e?.code !== 'ESRCH';
  }
}

/** { holder } for a well-formed lock, { torn, ageMs } for an unreadable one,
 *  { absent: true } for none. Never throws. */
export function readHolder(path) {
  let text;
  let mtimeMs;
  let fd;
  try {
    // ONE open, then fstat + read through that descriptor: the age and the bytes
    // are of the same file even if another process replaces the path meanwhile
    // (CodeQL js/file-system-race, 2026-09-20).
    fd = openSync(path, 'r');
    mtimeMs = fstatSync(fd).mtimeMs;
    text = readFileSync(fd, 'utf8');
  } catch (e) {
    if (e?.code === 'ENOENT') return { absent: true };
    return { torn: `unreadable (${e?.code ?? e?.message})`, ageMs: mtimeMs === undefined ? 0 : Date.now() - mtimeMs };
  } finally {
    if (fd !== undefined) { try { closeSync(fd); } catch {} }
  }
  try {
    const h = JSON.parse(text);
    if (h && typeof h === 'object' && Number.isInteger(h.pid) && typeof h.token === 'string') return { holder: h, mtimeMs };
    return { torn: 'not a heavy-run lock record', ageMs: Date.now() - mtimeMs };
  } catch {
    return { torn: text.length === 0 ? 'empty (being written, or left by a crash mid-write)' : 'not JSON', ageMs: Date.now() - mtimeMs };
  }
}

const mins = (ms) => `${Math.round(ms / 6000) / 10} min`;

/** One line naming who holds the lock and for how long. */
export function describeHolder(h, now = Date.now()) {
  const started = Date.parse(h.startedAt);
  const age = Number.isFinite(started) ? mins(now - started) : 'an unknown time';
  const argv = Array.isArray(h.argv) ? h.argv.join(' ') : String(h.argv ?? '?');
  return `pid ${h.pid} on ${h.host ?? '?'} for ${age} — ${argv.slice(0, 200)}`;
}

/** Is this record stale? Returns the reason, or null for a live holder. */
export function staleReason(read, { now = Date.now(), maxAgeMs, alive = pidAlive } = {}) {
  if (read.torn) return read.ageMs > TORN_GRACE_MS ? `the lock file is ${read.torn} and ${mins(read.ageMs)} old` : null;
  const h = read.holder;
  if (!alive(h.pid)) return `holder pid ${h.pid} is not running`;
  const started = Date.parse(h.startedAt);
  if (!Number.isFinite(started)) return `holder pid ${h.pid} recorded no readable startedAt`;
  if (now - started > maxAgeMs) return `held for ${mins(now - started)}, past the ${mins(maxAgeMs)} age ceiling (a reused pid, or a hung run)`;
  return null;
}

/** One O_EXCL create. { ok: true, token } or { ok: false } on EEXIST. */
export function tryCreate(path, record) {
  mkdirSync(dirname(path), { recursive: true });
  let fd;
  try {
    fd = openSync(path, 'wx');
  } catch (e) {
    if (e?.code === 'EEXIST') return { ok: false };
    throw e;
  }
  try {
    writeSync(fd, JSON.stringify(record));
  } finally {
    closeSync(fd);
  }
  return { ok: true, token: record.token };
}

/** Remove a stale lock, but only the stale one that was judged. */
function reclaim(path, judged, log) {
  const marker = `${path}.reclaim`;
  // CREATE FIRST, inspect only on failure: the O_EXCL create is the atomic step, and
  // no check precedes it (CodeQL js/file-system-race, 2026-09-20).
  let fd;
  try {
    fd = openSync(marker, 'wx');
  } catch (e) {
    if (e?.code !== 'EEXIST') throw e;
    // Another waiter holds the marker — or one died holding it. Age read through a
    // descriptor; a dead reclaimer's marker is cleared and the NEXT poll retries.
    let mfd;
    try {
      mfd = openSync(marker, 'r');
      const ageMs = Date.now() - fstatSync(mfd).mtimeMs;
      if (ageMs > RECLAIM_GRACE_MS) {
        log(`⚠️ heavy-run lock: removing a reclaim marker ${mins(ageMs)} old — its reclaimer died mid-step`);
        try { unlinkSync(marker); } catch {}
      }
    } catch {
      // vanished or unreadable: the next poll decides
    } finally {
      if (mfd !== undefined) { try { closeSync(mfd); } catch {} }
    }
    return false; // poll again
  }
  closeSync(fd);
  try {
    const again = readHolder(path);
    const same = judged.torn ? Boolean(again.torn) : again.holder?.token === judged.holder?.token;
    if (!same) return false;
    try { unlinkSync(path); } catch (e) { if (e?.code !== 'ENOENT') throw e; }
    return true;
  } finally {
    try { unlinkSync(marker); } catch {}
  }
}

/**
 * Wait for, and take, the machine-wide heavy-run lock.
 *
 *   waitMs    ceiling on the wait (0 = one attempt)
 *   argv      recorded in the lock so a waiter can say what it waits for
 *   log       line printer
 *   sleep     injectable (tests)
 *
 * Returns { ok: true, path, token, reentrant } or
 *         { ok: false, path, holder, waitedMs, reason }. Never ends the process.
 */
export function acquireHeavyLock({
  env = process.env,
  path = defaultLockPath({ env }),
  waitMs = DEFAULT_WAIT_MIN * 60_000,
  maxAgeMs = (Number(env[MAX_AGE_ENV]) || DEFAULT_MAX_AGE_MIN) * 60_000,
  argv = [],
  log = (l) => console.log(l),
  sleep = sleepSync,
} = {}) {
  const started = Date.now();
  const record = { pid: process.pid, argv, startedAt: new Date().toISOString(), host: hostname(), token: randomUUID() };
  // First poll interval, doubling to 30 s (or 20x the first, if that is less). NIKATRU_HEAVY_LOCK_POLL_MS shortens it
  // for the test suite, whose holders run for a fraction of a second.
  let delay = Math.min(30_000, Math.max(10, Number(env[POLL_ENV]) || 2_000));
  const maxDelay = Math.min(30_000, delay * 20);
  let lastLog = 0;
  for (;;) {
    if (tryCreate(path, record).ok) {
      env[TOKEN_ENV] = record.token;
      const waited = Date.now() - started;
      log(`🔒 heavy-run lock taken — ${path}${waited > 1000 ? ` (after waiting ${mins(waited)})` : ''}`);
      return { ok: true, path, token: record.token, reentrant: false };
    }
    const read = readHolder(path);
    if (read.absent) continue; // released between the create and the read — try again at once
    if (read.holder && env[TOKEN_ENV] && read.holder.token === env[TOKEN_ENV]) {
      log(`🔒 heavy-run lock: re-entrant — this process runs under the holder (${describeHolder(read.holder)})`);
      return { ok: true, path, token: null, reentrant: true };
    }
    const stale = staleReason(read, { maxAgeMs });
    if (stale) {
      if (reclaim(path, read, log)) {
        log(`⚠️ heavy-run lock RECLAIMED — ${stale}. The stale holder was: ${read.holder ? describeHolder(read.holder) : '(no readable record)'}`);
      }
      continue;
    }
    const waited = Date.now() - started;
    if (waited >= waitMs) {
      const who = read.holder ? describeHolder(read.holder) : `an unreadable lock record (${read.torn})`;
      return { ok: false, path, holder: read.holder ?? null, waitedMs: waited, reason: `held by ${who}; waited ${mins(waited)}, the ceiling` };
    }
    if (lastLog === 0 || Date.now() - lastLog >= 60_000) {
      log(`⏳ heavy-run lock busy — held by ${read.holder ? describeHolder(read.holder) : `(record ${read.torn})`}. Waited ${mins(waited)} of ${mins(waitMs)}.`);
      lastLog = Date.now();
    }
    sleep(Math.min(delay, Math.max(0, waitMs - waited) + 50));
    delay = Math.min(delay * 2, maxDelay);
  }
}

/** Delete the lock if and only if it is still ours. Idempotent. */
export function releaseHeavyLock(lock, { log = (l) => console.log(l) } = {}) {
  if (!lock?.ok || lock.reentrant || lock.skipped || !lock.token || lock.released) return;
  lock.released = true;
  const read = readHolder(lock.path);
  if (read.holder?.token === lock.token) {
    try { unlinkSync(lock.path); } catch {}
    return;
  }
  log(`⚠️ heavy-run lock: at release the lock was no longer ours (${read.absent ? 'gone' : read.holder ? describeHolder(read.holder) : 'unreadable'}) — someone reclaimed it as stale.`);
}

/** Release on every exit this process gets to run code for. `exit` is the
 *  caller's own process-ending function; `beforeSignalExit` runs first on a
 *  signal (heavy.mjs kills its child there). */
export function releaseOnExit(lock, exit, { beforeSignalExit = () => {} } = {}) {
  if (!lock?.ok || lock.reentrant || lock.skipped) return;
  process.on('exit', () => releaseHeavyLock(lock));
  for (const [sig, code] of [['SIGINT', 130], ['SIGHUP', 129], ['SIGBREAK', 149], ['SIGTERM', 143]]) {
    try {
      process.on(sig, () => {
        try { beforeSignalExit(sig); } catch {}
        releaseHeavyLock(lock);
        exit(code);
      });
    } catch {}
  }
}

// ── the offsite backup ───────────────────────────────────────────────────────

/** State of the backup's scheduled task, through a bounded powershell child.
 *  { state } or { error }. Get-ScheduledTask on an unknown name prints an error
 *  and powershell still EXITS 0 (measured 2026-09-19), so the answer is judged
 *  by its text: exactly one known state word, or it is an error. */
export function queryBackupState({
  taskName = BACKUP_TASK,
  platform = process.platform,
  run = (cmd, args) => spawnSync(cmd, args, { encoding: 'utf8', timeout: BACKUP_QUERY_TIMEOUT_MS, windowsHide: true }),
} = {}) {
  if (platform !== 'win32') return { error: `not Windows (${platform}) — no scheduled task to ask` };
  const quoted = `'${taskName.replace(/'/g, "''")}'`;
  const r = run('powershell', ['-NoProfile', '-NonInteractive', '-Command', `$ErrorActionPreference='Stop'; (Get-ScheduledTask -TaskName ${quoted}).State`]);
  if (r.error) return { error: `powershell did not answer (${r.error.code ?? r.error.message})` };
  if (r.status === null) return { error: `powershell timed out after ${BACKUP_QUERY_TIMEOUT_MS / 1000}s` };
  const out = String(r.stdout ?? '').trim();
  if (r.status !== 0 || !/^(Ready|Running|Disabled|Queued|Unknown)$/.test(out)) {
    const why = String(r.stderr ?? '').trim().split(/\r?\n/)[0] || out.split(/\r?\n/)[0] || `exit ${r.status}`;
    return { error: `Get-ScheduledTask '${taskName}' gave no state (${why.slice(0, 160)})` };
  }
  return { state: out };
}

/** Wait while the backup task is Running, up to `deadline` (epoch ms).
 *  A query that cannot answer is PRINTED and the run continues: a missing
 *  powershell must not stop a guard run. Returns { ok, waitedMs, state }. */
export function waitForBackup({
  query = () => queryBackupState(),
  deadline,
  log = (l) => console.log(l),
  sleep = sleepSync,
  pollMs = BACKUP_POLL_MS,
  now = () => Date.now(),
} = {}) {
  const started = now();
  for (;;) {
    const q = query();
    if (q.error) {
      log(`⬜ backup check: could not read the task state — ${q.error}. Continuing without it.`);
      return { ok: true, waitedMs: now() - started, state: null };
    }
    if (q.state !== 'Running') {
      if (now() - started > 1000) log(`✓ backup task is ${q.state} — after waiting ${mins(now() - started)}`);
      return { ok: true, waitedMs: now() - started, state: q.state };
    }
    if (now() >= deadline) {
      return { ok: false, waitedMs: now() - started, state: q.state };
    }
    log(`⏳ backup task '${BACKUP_TASK}' is Running — this laptop shares it; waiting (${mins(now() - started)} so far).`);
    sleep(Math.max(0, Math.min(pollMs, deadline - now())));
  }
}

/** GitHub sets CI=true; 'false' and '0' are read as not-CI. */
export const isCI = (env = process.env) => Boolean(env.CI) && env.CI !== 'false' && env.CI !== '0';

/**
 * Everything a heavy run needs before it starts: the lock, then the backup.
 * The backup wait happens WHILE HOLDING the lock, so the lanes queue on the
 * lock and only one of them polls powershell. One ceiling covers both waits.
 *
 * Returns { ok: true, lock } or { ok: false, lock, message } — `message` starts
 * with COVERAGE LOST and names the holder; the caller exits 2 with it.
 */
export function machineFree({
  waitMin = DEFAULT_WAIT_MIN,
  argv = [],
  env = process.env,
  log = (l) => console.log(l),
  path = defaultLockPath({ env }),
  query,
} = {}) {
  if (isCI(env)) {
    log('⬜ CI is set — heavy-run lock and backup wait SKIPPED: a hosted runner is one job on its own VM, with no backup and no sibling lane.');
    return { ok: true, lock: { ok: true, skipped: true } };
  }
  const deadline = Date.now() + waitMin * 60_000;
  const lock = acquireHeavyLock({ path, waitMs: waitMin * 60_000, argv, env, log });
  if (!lock.ok) {
    return { ok: false, lock, message: `🔴 COVERAGE LOST — the heavy-run lock (${lock.path}) is ${lock.reason}. Nothing heavy ran. Re-run when it is free, or raise --lock-wait.` };
  }
  const taskName = env[BACKUP_TASK_ENV] ?? BACKUP_TASK;
  if (taskName === '') {
    log(`⬜ backup check: ${BACKUP_TASK_ENV} is empty — no backup task to wait for.`);
    return { ok: true, lock };
  }
  const b = waitForBackup({ query: query ?? (() => queryBackupState({ taskName })), deadline, log });
  if (!b.ok) {
    releaseHeavyLock(lock, { log });
    return { ok: false, lock, message: `🔴 COVERAGE LOST — the backup task '${taskName}' was still Running after ${mins(b.waitedMs)} (the --lock-wait ceiling). Nothing heavy ran; the backup gets the machine.` };
  }
  return { ok: true, lock };
}
