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
// Exit:   the command's own exit code, passed through ·
//         2 = COVERAGE LOST: the lock or the backup did not free up within
//             --lock-wait (the holder is named), or the command timed out,
//             could not be started, or died on a signal — no verdict either way ·
//         2 = a usage error.
// ─────────────────────────────────────────────────────────────────────────────
import { spawn, spawnSync } from 'node:child_process';
import { machineFree, releaseOnExit, releaseHeavyLock, DEFAULT_WAIT_MIN } from './heavy-lock.mjs';
import { windowsCommand } from './windows-command.mjs';

const DEFAULT_TIMEOUT_MIN = 240;

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

child = spawn(spawnable.file, spawnable.args, { stdio: 'inherit', env: process.env, windowsHide: true });
let timedOut = false;
const timer = setTimeout(() => {
  timedOut = true;
  console.error(`🔴 COVERAGE LOST — \`${command.join(' ')}\` ran past --timeout ${timeoutMin} min; killing its process tree.`);
  killTree();
}, timeoutMin * 60_000);
child.on('error', (e) => {
  clearTimeout(timer);
  const hint = e.code === 'ENOENT' && process.platform === 'win32' ? ' (name a .cmd/.bat directly — `-- flutter.bat test` — it is wrapped for you; never `-- cmd /c …`, which MSYS mangles into a run of nothing)' : '';
  console.error(`🔴 COVERAGE LOST — could not start \`${command[0]}\`: ${e.code ?? e.message}${hint}`);
  releaseHeavyLock(free.lock);
  process.exit(2);
});
child.on('exit', (code, signal) => {
  clearTimeout(timer);
  releaseHeavyLock(free.lock);
  if (timedOut) process.exit(2);
  if (code === null) {
    console.error(`🔴 COVERAGE LOST — \`${command[0]}\` died on ${signal}; it gave no exit code.`);
    process.exit(2);
  }
  process.exit(code);
});
