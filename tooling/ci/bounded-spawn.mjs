// ─────────────────────────────────────────────────────────────────────────────
// bounded-spawn.mjs — THE ONE WAY tooling/ci runs an EXTERNAL tool: with a wall
// clock, killed with SIGKILL when it runs out, and "it never answered" raised as
// COVERAGE LOST rather than as a verdict.
//
// 🔴 WHY THIS EXISTS. A guard that asks an outside program a question and waits
// for ever has two failure modes, and both are silent:
//
//   · the job hits its own timeout-minutes and is CANCELLED, with the log
//     stopping mid-file and nothing naming the command. That is exactly how the
//     launcher-icons hang read for five runs (#616, #617, #618, #619 and one on
//     main) before `flutter create` was bounded in flutter-stock-assets.mjs;
//   · a hung child that a `spawnSync` reading its pipes waits on even after it
//     has exited, because a DESCENDANT still holds those pipes open.
//
// The bound converts both into a fast, named red. The pattern is
// flutter-stock-assets.mjs:271 — `{ timeout, killSignal: 'SIGKILL' }`, then
// `r.error?.code === 'ETIMEDOUT'` reported as COVERAGE LOST — lifted here
// UNCHANGED IN BEHAVIOUR the first time a second family of call sites needed it.
// Eleven inline copies of a bound drift in the one way a green run cannot show:
// WHICH OF THEM STILL TREATS A TIME-OUT AS "I COULD NOT LOOK" rather than as a
// tool that answered no.
//
// ⚠️ IT NEVER THROWS AND NEVER EXITS. The caller decides what a time-out means
// for ITS duty — every one of them already has a COVERAGE LOST reporter with the
// right wording, and a module that exited would take that choice away. What this
// module guarantees is that `timedOut` is TRUE only when the bound fired, and
// that a process which fired it is dead rather than detached.
//
// The bound is per call site and overridable by environment variable, because
// "how long may `gh repo list` take" and "how long may `signtool` take" are
// different questions with different answers, and a single constant would be
// tuned to the slowest of them — which is the same as no bound at all.
// ─────────────────────────────────────────────────────────────────────────────

import { spawnSync } from 'node:child_process';

/** When a call site names no bound. Two minutes: long enough that no healthy
 *  external tool in this repository reaches it, short enough that a job with a
 *  15-minute cap still reports rather than being cancelled. */
export const DEFAULT_TIMEOUT_MS = 120_000;

/**
 * Read a per-call-site bound from the environment, with a floor.
 *
 * A value that is absent, unparseable or <= 0 falls back — an override that
 * silently disables the bound is the defect this whole module exists to remove.
 * @param {string} name  e.g. 'GH_LIST_TIMEOUT_MS'
 */
export function timeoutFromEnv(name, fallback = DEFAULT_TIMEOUT_MS, env = process.env) {
  const raw = Number(env[name]);
  if (!Number.isFinite(raw) || raw <= 0) return fallback;
  return Math.max(1_000, raw);
}

/**
 * Run `exe args` with a wall clock.
 *
 * @returns {{
 *   ok: boolean,          // exit 0 and no error
 *   timedOut: boolean,    // the bound fired; the child was SIGKILLed
 *   startFailed: boolean, // the program could not be started at all (ENOENT …)
 *   status: number|null,
 *   stdout: string,
 *   stderr: string,
 *   detail: string,       // one line, safe to print in a COVERAGE LOST body
 *   timeoutMs: number,
 * }}
 */
export function boundedSpawn(exe, args, options = {}) {
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    cwd,
    env,
    encoding = 'utf8',
    maxBuffer,
    // The label names the command in `detail` without leaking an argument that
    // might carry a secret — apple-signing.mjs redacts its argv for exactly that
    // reason, and this module must not undo it.
    label = exe,
  } = options;

  const spawnOptions = { encoding, timeout: timeoutMs, killSignal: 'SIGKILL', stdio: ['ignore', 'pipe', 'pipe'] };
  if (cwd !== undefined) spawnOptions.cwd = cwd;
  if (env !== undefined) spawnOptions.env = env;
  if (maxBuffer !== undefined) spawnOptions.maxBuffer = maxBuffer;

  const r = spawnSync(exe, args, spawnOptions);
  const stdout = typeof r.stdout === 'string' ? r.stdout : '';
  const stderr = typeof r.stderr === 'string' ? r.stderr : '';

  if (r.error?.code === 'ETIMEDOUT') {
    return {
      ok: false,
      timedOut: true,
      startFailed: false,
      status: null,
      stdout,
      stderr,
      timeoutMs,
      detail: `\`${label}\` did not answer within ${Math.round(timeoutMs / 1000)} s and was killed — the question was never asked, not answered no.`,
    };
  }
  if (r.error) {
    return {
      ok: false,
      timedOut: false,
      startFailed: true,
      status: null,
      stdout,
      stderr,
      timeoutMs,
      detail: `\`${label}\` could not be started (${r.error.code ?? r.error.message}).`,
    };
  }
  // ⚠️ A SIGNAL IS NOT AN EXIT CODE. A child killed by something other than our
  // own bound (the runner reclaiming memory, a parent process group teardown)
  // reports status null — reading that as "exit 0 is falsy, so it failed" would
  // be right by accident; naming it keeps the caller able to tell the difference.
  if (r.signal) {
    return {
      ok: false,
      timedOut: false,
      startFailed: false,
      status: null,
      stdout,
      stderr,
      timeoutMs,
      detail: `\`${label}\` was killed by ${r.signal} before it answered.`,
    };
  }
  return {
    ok: r.status === 0,
    timedOut: false,
    startFailed: false,
    status: r.status,
    stdout,
    stderr,
    timeoutMs,
    detail: r.status === 0 ? `\`${label}\` exit 0` : `\`${label}\` exit ${r.status}`,
  };
}
