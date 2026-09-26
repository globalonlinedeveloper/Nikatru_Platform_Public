// ─────────────────────────────────────────────────────────────────────────────
// heavy-work-done.mjs — the preload heavy.mjs puts on its node child's
// NODE_OPTIONS, so the machine-wide lock is released when the child's WORK ends,
// not when its process finally does.
//
// 🔴 WHY. A node process can reach its exit — the verdict printed, every 'exit'
// listener called — and then never end (nodejs#54918). On 2026-09-20 preflight
// pid 24176 did exactly that and held the heavy-run lock for 85.8 min, its
// children gone and its CPU flat. preflight now releases at the end of its own
// work; a runner WRAPPED by heavy.mjs did not, because heavy.mjs released on its
// child's 'exit' event, and a hung child never delivers one.
//
// ── THE CHANNEL ─────────────────────────────────────────────────────────────
//   heavy.mjs sets NIKATRU_HEAVY_DONE_FILE (a path beside the lock) and
//   NIKATRU_HEAVY_DONE_PARENT (its own pid). On import, before any user code:
//   · it ALWAYS deletes both variables and its own exact `--import=<this URL>`
//     token from NODE_OPTIONS, armed or not, so nothing the child spawns inherits
//     the channel. (The URL heavy.mjs writes is built from heavy.mjs's own
//     import.meta.url, a realpath, as this module's is — the two spellings match.)
//   · it arms ONLY when process.ppid is heavy.mjs's pid: the DIRECT child, never
//     "the first node to see the variable". A node started by a script or a shim
//     is not the process heavy.mjs waits on, and its exit says nothing about the
//     command's.
//   · armed, it PREPENDS an 'exit' listener, so the record is written before any
//     listener that might block, and writes it to <file>.tmp and renames it into
//     place, so heavy.mjs never reads half of it.
//   It exports nothing, never prints as a preload, and swallows every error: a
//   preload that fails must leave the child to run exactly as it would have
//   without it. RUN AS A COMMAND it has nothing to do, so it refuses (exit 2)
//   rather than exit 0 having done nothing.
//
// ── WHAT THIS DOES NOT COVER ────────────────────────────────────────────────
//   · a command that is not node (flutter, a .bat, sh): heavy.mjs does not arm,
//     and the lock is held until the whole command exits, as before;
//   · a node that hangs BEFORE its exit — a deadlock inside the work never reaches
//     the listener. Only `heavy.mjs --timeout` bounds that;
//   · a hard kill (SIGKILL, TerminateProcess): no listener runs, no record;
//   · CI: heavy.mjs takes no lock there, so there is nothing to release early.
// ─────────────────────────────────────────────────────────────────────────────
import { writeFileSync, renameSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

let asCommand = false;
try { asCommand = Boolean(process.argv[1]) && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url); } catch {}
if (asCommand) {
  console.error('✗ heavy-work-done.mjs is a preload, not a command: heavy.mjs puts it on its node child\'s NODE_OPTIONS. Run the command as `node tooling/scripts/heavy.mjs -- node …`.');
  process.exitCode = 2;
} else try {
  const file = process.env.NIKATRU_HEAVY_DONE_FILE;
  const parent = process.env.NIKATRU_HEAVY_DONE_PARENT;
  delete process.env.NIKATRU_HEAVY_DONE_FILE;
  delete process.env.NIKATRU_HEAVY_DONE_PARENT;
  const mine = `--import=${import.meta.url}`;
  const rest = (process.env.NODE_OPTIONS ?? '').split(' ').filter((t) => t !== mine).join(' ').trim();
  if (rest) process.env.NODE_OPTIONS = rest;
  else delete process.env.NODE_OPTIONS;

  if (file && process.ppid === Number(parent)) {
    process.prependListener('exit', (code) => {
      try {
        writeFileSync(`${file}.tmp`, JSON.stringify({ code: process.exitCode ?? code, pid: process.pid, at: new Date().toISOString() }));
        renameSync(`${file}.tmp`, file);
      } catch {}
    });
  }
} catch {}
