#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// heavy.mjs — run ANY command under the machine-wide heavy-run lock.
//
// preflight.mjs takes the lock itself. Everything else heavy on this laptop — a
// full `node --test` suite, a Chromium e2e, a flutter build — goes through this,
// so it queues behind the same lock and the same backup wait instead of relying
// on a lane reading a brief (the 2026-09-19 fan-out; see heavy-lock.mjs).
//
// Usage:  node tooling/scripts/heavy.mjs [--lock-wait <min>] [--timeout <min>] -- <command> [args...]
//   e.g.  node tooling/scripts/heavy.mjs -- node --test "tooling/ci/test/*.test.mjs"
//   --lock-wait  ceiling on waiting for the lock AND the backup (default 90)
//   --timeout    ceiling on the command itself (default 240); past it the
//                command's process tree is killed
//   The command is spawned WITHOUT a shell, so its arguments arrive exactly as
//   written (a quoted glob stays one argument for node --test to expand).
//
//   🔴 NAME THE .cmd/.bat DIRECTLY — `-- flutter.bat build web`. Do NOT write
//   `-- cmd /c flutter …`: from the Bash tool on Windows, MSYS rewrites the bare
//   `/c` into the PATH `C:/` before node is even started, so cmd receives a path
//   where its switch should be, opens INTERACTIVELY, reads EOF and exits 0 —
//   having run nothing. Measured 2026-09-20 with the code captured on its own
//   line: `cmd /c "exit 7"` answered 0 and `cmd //c "exit 7"` answered 7. This
//   header used to recommend the broken form, and a lane's full app suite
//   "passed" in four seconds because of it. A .bat target is now wrapped here,
//   inside node, where nothing can rewrite the switch; the mangled form is
//   REFUSED rather than run.
//
//   🔓 THE LOCK IS RELEASED WHEN A NODE CHILD'S WORK ENDS, not when its process
//   does (O-PREFLIGHT-HANGS-HOLDING-THE-MACHINE-LOCK). A node process can run
//   its exit — verdict printed, 'exit' listeners called — and then never end
//   (nodejs#54918: preflight pid 24176 held the lock 85.8 min on 2026-09-20).
//   So when the command is node, it gets heavy-work-done.mjs on NODE_OPTIONS:
//   the DIRECT child reports its exit code to a file beside the lock, and this
//   runner releases the lock on that report. If the process has still not ended
//   NIKATRU_HEAVY_EXIT_GRACE_MS later (default 30 s), its tree is killed and the
//   REPORTED code is the answer — the work finished and graded itself; only the
//   process failed to go away. Not armed for a non-node command, nor in CI (no
//   lock there); a node that hangs BEFORE its exit is bounded by --timeout alone.
//
//   ⏱ BOUND EVERY HEAVY RUN WITH `--timeout N`, never an outer `timeout`.
//   --timeout kills the whole tree from in here and answers 2. An outer one ends
//   this runner from outside, and the tree under it dies only if that signal
//   reaches a handler — a hard kill (TerminateProcess) runs none, and leaves the
//   command running with no lock over it.
//
// Exit:   the command's own exit code, passed through — for a node child that
//             reported its exit and then hung past the grace, the REPORTED code ·
//         2 = COVERAGE LOST: the lock or the backup did not free up within
//             --lock-wait (the holder is named), or the command timed out,
//             could not be started, or died on a signal — no verdict either way ·
//         2 = a usage error.
// ─────────────────────────────────────────────────────────────────────────────
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { rmSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { machineFree, releaseOnExit, releaseHeavyLock, DEFAULT_WAIT_MIN } from './heavy-lock.mjs';
import { windowsCommand } from './windows-command.mjs';

const DEFAULT_TIMEOUT_MIN = 240;
const WORK_DONE_URL = pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), 'heavy-work-done.mjs')).href;
const GRACE_MS = Number(process.env.NIKATRU_HEAVY_EXIT_GRACE_MS) || 30_000;

const argv = process.argv.slice(2);
const sep = argv.indexOf('--');
const usage = (why) => {
  console.error(`✗ ${why}`);
  console.error('usage: node tooling/scripts/heavy.mjs [--lock-wait <min>] [--timeout <min>] -- <command> [args...]');
  process.exit(2);
};
if (sep === -1) usage('no `--` before the command: nothing to run.');
const own = argv.slice(0, sep);
const command = argv.slice(sep + 1);
if (command.length === 0) usage('no command after `--`.');

const minutes = (flag, fallback) => {
  const i = own.indexOf(flag);
  if (i === -1) return fallback;
  const v = Number(own[i + 1]);
  if (!Number.isFinite(v) || v < 0) usage(`${flag} needs a number of minutes (got ${own[i + 1] ?? 'nothing'}).`);
  return v;
};
const known = new Set(['--lock-wait', '--timeout']);
for (let i = 0; i < own.length; i += 2) if (!known.has(own[i])) usage(`unknown option ${own[i]}.`);
const waitMin = minutes('--lock-wait', DEFAULT_WAIT_MIN);
const timeoutMin = minutes('--timeout', DEFAULT_TIMEOUT_MIN);

// ⚠️ REFUSED BEFORE THE LOCK IS TAKEN, not after. A malformed invocation must
// not occupy the machine-wide lock while every other lane queues behind it —
// and it cannot be graded either way, so it is COVERAGE LOST rather than a
// failure of the command.
const spawnable = windowsCommand(command);
if (spawnable.refuse) {
  console.error(`🔴 COVERAGE LOST — ${spawnable.refuse}`);
  process.exit(2);
}

const free = machineFree({ waitMin, argv: ['heavy.mjs', ...command] });
if (!free.ok) {
  console.error(free.message);
  process.exit(2);
}

let child = null;
/** The whole tree: on Windows child.kill() ends only the direct child, and a
 *  `node --test` run is a tree of test processes. */
const killTree = () => {
  if (!child || child.exitCode !== null) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 30_000 });
  else child.kill('SIGKILL');
};
releaseOnExit(free.lock, (code) => process.exit(code), { beforeSignalExit: killTree });

// The work-done channel (see the header): only for a node DIRECT child, and never
// in CI, where no lock was taken. Re-entrant runs are armed: a hang still holds
// the machine, whoever owns the lock file.
let doneFile = null;
let env = process.env;
if (!free.lock.skipped && /^node(\.exe)?$/i.test(String(spawnable.file).split(/[\\/]/).pop())) {
  doneFile = join(dirname(free.lock.path), `heavy-done-${randomUUID()}.json`);
  env = {
    ...process.env,
    NIKATRU_HEAVY_DONE_FILE: doneFile,
    NIKATRU_HEAVY_DONE_PARENT: String(process.pid),
    NODE_OPTIONS: [process.env.NODE_OPTIONS, `--import=${WORK_DONE_URL}`].filter(Boolean).join(' '),
  };
  console.log(`🔗 work-done channel ARMED — the lock is released when \`${command[0]}\` reaches its exit, even if the process then never ends.`);
} else if (!free.lock.skipped) {
  console.log(`⬜ work-done channel not armed — \`${command[0]}\` is not node, so the lock is held until the whole command exits (bound it with --timeout).`);
}

child = spawn(spawnable.file, spawnable.args, { stdio: 'inherit', env, windowsHide: true });
let timedOut = false;
const timer = setTimeout(() => {
  timedOut = true;
  console.error(`🔴 COVERAGE LOST — \`${command.join(' ')}\` ran past --timeout ${timeoutMin} min; killing its process tree.`);
  killTree();
}, timeoutMin * 60_000);

let reported = null;
let grace = null;
let hungAfterDone = false;
const watch = doneFile
  ? setInterval(() => {
      if (reported || !existsSync(doneFile)) return;
      let r;
      try { r = JSON.parse(readFileSync(doneFile, 'utf8')); } catch { return; }
      if (r?.pid !== child.pid) return;
      reported = r;
      clearInterval(watch);
      releaseHeavyLock(free.lock);
      clearTimeout(timer);
      console.log(`🔓 heavy-run lock released — \`${command[0]}\` reached its exit with code ${r.code}; it has ${GRACE_MS / 1000}s to end.`);
      grace = setTimeout(() => {
        console.error(
          `⚠️ \`${command[0]}\` reported exit ${r.code} ${GRACE_MS / 1000}s ago and is still running — hung after its work ` +
            `(nodejs#54918). Killing its process tree; the answer is the reported ${r.code}.`,
        );
        hungAfterDone = true;
        killTree();
      }, GRACE_MS);
    }, 250)
  : null;
watch?.unref();
const endChannel = () => {
  clearInterval(watch);
  clearTimeout(grace);
  if (!doneFile) return;
  try { rmSync(doneFile, { force: true }); } catch {}
  try { rmSync(`${doneFile}.tmp`, { force: true }); } catch {}
};

child.on('error', (e) => {
  endChannel();
  clearTimeout(timer);
  const hint = e.code === 'ENOENT' && process.platform === 'win32' ? ' (name a .cmd/.bat directly — `-- flutter.bat test` — it is wrapped for you; never `-- cmd /c …`, which MSYS mangles into a run of nothing — or run it with `MSYS_NO_PATHCONV=1`)' : '';
  console.error(`🔴 COVERAGE LOST — could not start \`${command[0]}\`: ${e.code ?? e.message}${hint}`);
  releaseHeavyLock(free.lock);
  process.exit(2);
});
child.on('exit', (code, signal) => {
  endChannel();
  clearTimeout(timer);
  releaseHeavyLock(free.lock);
  if (hungAfterDone) process.exit(Number.isInteger(reported.code) ? reported.code : 2);
  if (timedOut) process.exit(2);
  if (code === null) {
    console.error(`🔴 COVERAGE LOST — \`${command[0]}\` died on ${signal}; it gave no exit code.`);
    process.exit(2);
  }
  process.exit(code);
});
