// ─────────────────────────────────────────────────────────────────────────────
// spawn-ceiling.mjs — a default timeout for every synchronous child process a
// `node --test` run starts. A PRELOAD, not a test: every `node --test` in
// .github/workflows/ and preflight.mjs loads it with
//
//   node --import "$SPAWN_CEILING" --test-timeout=600000 --test ...
//
// SPAWN_CEILING is this file as an ABSOLUTE file URL, written to $GITHUB_ENV by
// .github/actions/setup-node; a relative `--import ./tooling/...` resolves against
// the step's cwd and works only from the repository root (PR #1160).
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
//
// 🔴 AND EVERY NODE CHILD STARTS --single-threaded (2026-09-28). ⏱ PR #1025's CI
// (run 36376688038 attempt 1, job guard-meta): no-hardcoded-strings.test.mjs:1033
// spawned its guard with `spawnSync(process.execPath, ...)`; the child never exited
// and the ceiling above killed it at 240 s (`null !== 2`) on a PR that touched no
// Dart. The same case took 6.3 s on main. It is nodejs/node#54918, the exit hang
// tooling/ci/single-threaded-relaunch.mjs documents: Node's shutdown joins the V8
// worker threads while a background compile on one waits for the main thread.
// FXH-2 (#1015) fixed it for extensions/scripts/test/selftest.node.js by starting
// every node child `--single-threaded`, and single-threaded-relaunch.test.mjs S1/S2
// hold that one file to it. It never reached the 291 files under tooling/**/test/
// that start node ~540 times between them. A ceiling only turns the hang into a
// red; the flag removes the deadlock's second party. So the same flag goes here,
// once, where every one of those launches already passes:
//
//   spawnSync, execFileSync, spawn and execFile (its promisified form too) whose
//   program is node (`process.execPath`, or `node` / `node.exe` by name) get
//   --single-threaded as their first argument; execSync and exec get it after a
//   command whose first word is node; fork gets it in execArgv. A launch that
//   already carries the flag is left alone.
//
// OPTING OUT is `singleThreaded: false` in the call's options; the key is removed
// before node sees it. It exists for the tests that PROVE a guard relaunches itself
// single-threaded: started with the flag, the relaunch never runs, and "V8
// background tasks: OFF" would still pass with the relaunch deleted. Every opt-out
// is declared in spawn-ceiling.test.mjs (OPT_OUTS); an undeclared one is RED.
//
// THE LIMIT. Only the children a test process starts itself. A node that child
// starts in turn (a guard's own child, `sh -c "node ..."`) is that program's
// business: the relaunch, or a workflow step's own --single-threaded.
// ─────────────────────────────────────────────────────────────────────────────
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { promisify } from 'node:util';

export const CEILING_ENV = 'NIKATRU_SPAWN_CEILING_MS';
export const DEFAULT_CEILING_MS = 240_000;
export const SINGLE_THREADED = '--single-threaded';
/** The options key that keeps V8 background tasks ON for one launch. */
export const OPT_OUT_KEY = 'singleThreaded';

const raw = process.env[CEILING_ENV];
export const CEILING_MS = raw === undefined || raw === '' ? DEFAULT_CEILING_MS : Number(raw);
if (!Number.isInteger(CEILING_MS) || CEILING_MS <= 0) {
  throw new Error(`${CEILING_ENV}=${JSON.stringify(raw)} is not a positive integer of milliseconds`);
}

/** True when `file` starts node: this process's own binary, or `node` by name. */
export const isNode = (file) =>
  typeof file === 'string' && (file === process.execPath || /^node(\.exe)?$/i.test(file.split(/[\\/]/).pop()));

const optedOut = (options) => options != null && options[OPT_OUT_KEY] === false;

/** The caller's options without the opt-out key, which is ours and not node's. */
const withoutKey = (options) => {
  if (options == null || !Object.hasOwn(options, OPT_OUT_KEY)) return options;
  const { [OPT_OUT_KEY]: _, ...rest } = options;
  return rest;
};

/** `args` with --single-threaded first, when `file` is node and the call did not opt out. */
export const singleThreadedArgs = (file, args, options) =>
  isNode(file) && !optedOut(options) && !args.includes(SINGLE_THREADED) ? [SINGLE_THREADED, ...args] : args;

/** A shell `command` with --single-threaded after its first word, when that word is node. */
export const singleThreadedCommand = (command, options) => {
  if (typeof command !== 'string' || optedOut(options) || command.includes(SINGLE_THREADED)) return command;
  const m = command.match(/^\s*(?:"([^"]+)"|'([^']+)'|([^\s"']+))(?=\s|$)/);
  if (!m || !isNode(m[1] ?? m[2] ?? m[3])) return command;
  return `${m[0]} ${SINGLE_THREADED}${command.slice(m[0].length)}`;
};

/** The caller's options with a timeout added only when the caller set none. */
const withCeiling = (options) => {
  if (options == null) return { timeout: CEILING_MS };
  if (options.timeout !== undefined) return options;
  return { ...options, timeout: CEILING_MS };
};

/** (file[, args][, options]) → [args, options]; with args omitted, the second argument IS the options. */
const fileForm = (args, options) => (Array.isArray(args) || args == null ? [args ?? [], options] : [[], args]);

/** (file[, args][, options]) — `spawnSync` and `execFileSync`: the flag and the ceiling. */
const wrapFileForm = (original) =>
  function withSpawnCeiling(file, a, o) {
    const [args, options] = fileForm(a, o);
    return original.call(this, file, singleThreadedArgs(file, args, options), withCeiling(withoutKey(options)));
  };

/** (command[, options]) — `execSync`: the flag and the ceiling. */
const wrapCommandForm = (original) =>
  function withSpawnCeiling(command, options) {
    return original.call(this, singleThreadedCommand(command, options), withCeiling(withoutKey(options)));
  };

/** (file[, args][, options]) — `spawn`: the flag only. It is async, so a ceiling cannot help it. */
const wrapAsyncFileForm = (original) =>
  function withSpawnCeiling(file, a, o) {
    const [args, options] = fileForm(a, o);
    return original.call(this, file, singleThreadedArgs(file, args, options), withoutKey(options));
  };

/** Wrap a callback form and its promisified form alike, so `promisify(execFile)`
 *  still resolves to { stdout, stderr }, and still gets the flag. */
const withPromisified = (original, rewrite) => {
  const wrapped = function withSpawnCeiling(first, ...rest) {
    const cb = typeof rest.at(-1) === 'function' ? rest.pop() : undefined;
    return original.call(this, ...rewrite(first, rest), ...(cb ? [cb] : []));
  };
  const custom = original[promisify.custom];
  if (typeof custom === 'function') {
    Object.defineProperty(wrapped, promisify.custom, {
      value: function withSpawnCeiling(first, ...rest) { return custom.call(this, ...rewrite(first, rest)); },
    });
  }
  return wrapped;
};

/** execFile(file[, args][, options]) */
const rewriteExecFile = (file, [a, o]) => {
  const [args, options] = fileForm(a, o);
  return [file, singleThreadedArgs(file, args, options), withoutKey(options) ?? {}];
};

/** exec(command[, options]) */
const rewriteExec = (command, [options]) => [singleThreadedCommand(command, options), withoutKey(options) ?? {}];

/** fork(modulePath[, args][, options]) — the child is node by definition, so the flag goes in execArgv. */
const wrapFork = (original) =>
  function withSpawnCeiling(modulePath, a, o) {
    const [args, options] = fileForm(a, o);
    const rest = withoutKey(options) ?? {};
    const execArgv = rest.execArgv ?? process.execArgv;
    const keep = optedOut(options) || execArgv.includes(SINGLE_THREADED);
    return original.call(this, modulePath, args, keep ? rest : { ...rest, execArgv: [SINGLE_THREADED, ...execArgv] });
  };

if (!childProcess.spawnSync.name.startsWith('withSpawnCeiling')) {
  childProcess.spawnSync = wrapFileForm(childProcess.spawnSync);
  childProcess.execFileSync = wrapFileForm(childProcess.execFileSync);
  childProcess.execSync = wrapCommandForm(childProcess.execSync);
  childProcess.spawn = wrapAsyncFileForm(childProcess.spawn);
  childProcess.execFile = withPromisified(childProcess.execFile, rewriteExecFile);
  childProcess.exec = withPromisified(childProcess.exec, rewriteExec);
  childProcess.fork = wrapFork(childProcess.fork);
  syncBuiltinESMExports();
}
