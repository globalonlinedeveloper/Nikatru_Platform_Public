// ─────────────────────────────────────────────────────────────────────────────
// spawn-ceiling.mjs — a default timeout for every synchronous child process a
// `node --test` run starts. A PRELOAD, not a test: every `node --test` in
// .github/workflows/ and preflight.mjs loads it with
//
//   node --import ./tooling/scripts/spawn-ceiling.mjs --test-timeout=600000 --test ...
//
// 🔴 WHY. ⏱ 2026-09-25 · main CI for #934 (run 36106900356, sha c02e6d33) was
// CANCELLED, not red: job 107981386553's `node --test "tooling/ci/test/*.test.mjs"`
// step hung from 07:18:34Z until the job's 25-minute timeout killed it at
// 07:42:59Z, naming nothing. The hung file (assert-frames-carry-text.test.mjs)
// spawns its guard with `spawnSync` and no timeout; so did 189 of the 250 test
// files that spawn at all. `--test-timeout` does NOT stop a hung `spawnSync`:
// the event loop is blocked, so the runner's timer never fires (measured on
// node v24.18.0 the same morning). A default `timeout` on the spawn itself does.
//
// WHAT IT DOES. It wraps `spawnSync`, `execSync` and `execFileSync` from
// node:child_process. A call that passed no `timeout` gets CEILING_MS; a call
// that passed one — any value, 0 included — keeps it, never overridden. Then
// `syncBuiltinESMExports()` (from node:module, NOT node:child_process) makes the
// ESM named exports see the wrapped functions, so a test's
// `import { spawnSync } from 'node:child_process'` gets the ceiling too. The
// test runner passes `--import` to each file's child process, so every file is
// covered, not only the runner.
//
// THE NUMBER. 240 s. The slowest test FILE per step in the last green main run
// (36104371801, the sum of its top-level suites in the spec log): guard-meta
// 40.7 s (launcher-icons.test.mjs), content-gate 0.5 s, extensions core 1.6 s,
// extensions selftest 6.0 s. 240 s is at least 3x each, and a single spawn is
// shorter than the file that holds it. `NIKATRU_SPAWN_CEILING_MS` overrides it
// (a positive integer of milliseconds) for a slower host.
//
// A timed-out spawnSync returns `error.code === 'ETIMEDOUT'` and `status: null`;
// execSync / execFileSync throw it. Either way the test fails, naming its file,
// instead of the job dying at its timeout. tooling/ci/test/spawn-ceiling.test.mjs
// holds the three properties: the ceiling fires, an explicit timeout is kept,
// and every workflow `node --test` loads this file.
// ─────────────────────────────────────────────────────────────────────────────
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';

export const CEILING_ENV = 'NIKATRU_SPAWN_CEILING_MS';
export const DEFAULT_CEILING_MS = 240_000;

const raw = process.env[CEILING_ENV];
export const CEILING_MS = raw === undefined || raw === '' ? DEFAULT_CEILING_MS : Number(raw);
if (!Number.isInteger(CEILING_MS) || CEILING_MS <= 0) {
  throw new Error(`${CEILING_ENV}=${JSON.stringify(raw)} is not a positive integer of milliseconds`);
}

/** The caller's options with a timeout added only when the caller set none. */
const withCeiling = (options) => {
  if (options == null) return { timeout: CEILING_MS };
  if (options.timeout !== undefined) return options;
  return { ...options, timeout: CEILING_MS };
};

/** (file[, args][, options]) — `spawnSync` and `execFileSync`. */
const wrapFileForm = (original) =>
  function withSpawnCeiling(file, args, options) {
    if (Array.isArray(args) || args == null) return original.call(this, file, args ?? [], withCeiling(options));
    // args omitted: the second argument IS the options object.
    return original.call(this, file, [], withCeiling(args));
  };

/** (command[, options]) — `execSync`. */
const wrapCommandForm = (original) =>
  function withSpawnCeiling(command, options) {
    return original.call(this, command, withCeiling(options));
  };

if (!childProcess.spawnSync.name.startsWith('withSpawnCeiling')) {
  childProcess.spawnSync = wrapFileForm(childProcess.spawnSync);
  childProcess.execFileSync = wrapFileForm(childProcess.execFileSync);
  childProcess.execSync = wrapCommandForm(childProcess.execSync);
  syncBuiltinESMExports();
}
