/* hang-guard.mjs — put a ceiling on a step, and bring back evidence when it hits.
   =====================================================================

   BUILD-TIME MODULE. NEVER SHIPPED.

     node scripts/lib/hang-guard.mjs --seconds 180 --retries 1 --report-dir diag \
       -- node scripts/check-store-packages.mjs fullshot --dir dist

   🔴 WHY THIS EXISTS — A JOB THAT HAS PRINTED ITS LAST LINE CAN STILL HANG,
   AND GITHUB'S DEFAULT JOB TIMEOUT IS SIX HOURS.

   Measured 2026-09-06 on this repository, the `package · fullshot · firefox ·
   ubuntu-24.04` leg, twice in 40 minutes:

     run 34007402189 attempt 1   step started 02:51:53Z, cancelled 03:17:00Z   25 min
     run 34015605278 attempt 1   same step, same leg, cancelled after          13 min

   In both the step printed its ENTIRE output, ending in the `3 passed` summary
   line that `lib/report.mjs` writes immediately before `process.exit()`, and
   then returned nothing. The other three legs of the same matrix ran the same
   command in ≤ 1 second in the same runs, and every re-run of the hung leg
   finished in ~20 s. ~15 other executions that day took 17–26 s.

   WHAT WAS RULED OUT, BY READING THE SUBJECT RATHER THAN GUESSING

   `scripts/check-store-packages.mjs` and everything it imports were read for
   anything that can keep a Node event loop alive past the last statement:

     imports, whole transitive set   node:fs, node:path, node:crypto, node:url,
                                     node:zlib. Nothing else, no dependency.
     sockets / http / net            none
     child processes                 none
     workers                         none
     fs.watch / fs.watchFile         none
     timers                          none — no setTimeout, no setInterval,
                                     so no unref-less timer to leak
     process.on(...) handlers        none — no 'exit', no 'beforeExit'
     zlib                            inflateRawSync only (lib/zip.mjs:168);
                                     the async zlib API, which does take a
                                     threadpool slot, is never used
     file descriptors                readFileSync only; no fs.open, so no
                                     descriptor is held open across a call

   The script is synchronous end to end and ends `process.exit(r.finish())`
   (check-store-packages.mjs:585). There is nothing in it to fix. That is the
   finding, not a shrug: the defect is real and reproducible at the JOB level
   while the SCRIPT is exonerated, so the correct response is a bounded wait
   that captures the process's own state instead of another blind re-run.

   ⚠️ SO THIS FILE DOES NOT PRETEND TO KNOW THE CAUSE. It bounds the wait and
   it collects the one artefact that can name the cause next time: Node's
   diagnostic report, which prints the JavaScript stack of every thread and
   every open libuv handle. `--report-on-signal` is injected into the child
   rather than requested of it, so the subject needs no code change and the
   report exists for the run that hangs, not for the run after it.

   HOW IT BEHAVES

     - spawns the command with stdio inherited, so the step's log is unchanged
       and this wrapper is invisible on a normal run;
     - when the command is `node`, injects `--report-on-signal
       --report-signal=SIGUSR1 --report-directory=<dir>` directly after it;
     - at the ceiling, sends SIGUSR1 on POSIX to make the child write that
       report, waits UP TO --grace-seconds (default 10) for it to be COMPLETE —
       its size has stopped changing and it parses as JSON — then kills the
       whole process TREE — SIGKILL on POSIX, `taskkill /T /F` on Windows,
       because a plain kill(pid) leaves grandchildren holding the pipe and the
       runner keeps waiting on them. A report still being written when the
       grace runs out is named INCOMPLETE in a `::warning::`, never listed as
       collected: half a report is not evidence;
     - prints a `::warning::` naming the attempt and the elapsed time, then
       retries;
     - exits with the child's own code the moment an attempt COMPLETES — a
       genuine failure is not retried, only a hang is — and 124 when every
       attempt hung, the code `timeout(1)` uses for exactly this.

   🔴 EXIT 124 IS A FAILURE AND IS MEANT TO BE. The point of the ceiling is
   that the job goes RED in minutes with an artefact attached, instead of AMBER
   for six hours with nothing. Never widen --seconds to make a hang green.

   Its own red/green pairs are in scripts/test/hang-guard.test.mjs, run by the
   `selftest` job. They are NOT in scripts/test/selftest.node.js: that file's
   run() helper appends `--repo-root <root>`, this wrapper forwards everything
   after `--` to the child verbatim, and node answers `bad option: --repo-root`
   and exits 9 — so a case there would grade node's argument parser rather than
   the ceiling. Both files are recorded in that suite's NO_CASE_RECORDED with
   that reason, which is what keeps the gate-coverage ratchet honest. */

'use strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const EXIT_HUNG = 124;          /* timeout(1)'s code for "the ceiling was hit" */
const EXIT_CANNOT_RUN = 2;      /* same meaning as lib/report.mjs: never 0 */

/* ---------------- argv ----------------
   Split at the FIRST bare `--`. Everything before it is this wrapper's, and
   everything after it is the command VERBATIM — including its own `--flags`,
   which is the whole reason the separator is required rather than inferred. */
function parse(argv) {
  const sep = argv.indexOf('--');
  if (sep === -1) {
    return { error: 'no `--` separator. The command to guard must come after a bare `--`, ' +
      'so that its own flags cannot be mistaken for this wrapper\'s.' };
  }
  const mine = argv.slice(0, sep);
  const command = argv.slice(sep + 1);
  if (command.length === 0) return { error: 'nothing follows the `--` separator, so there is no command to guard.' };

  const opts = { seconds: 180, retries: 1, graceSeconds: 10, reportDir: 'diag' };
  const known = ['seconds', 'retries', 'report-dir', 'grace-seconds'];
  for (let i = 0; i < mine.length; i++) {
    const a = mine[i];
    if (!a.startsWith('--')) return { error: 'unexpected argument before `--`: ' + a };
    const eq = a.indexOf('=');
    const key = eq === -1 ? a.slice(2) : a.slice(2, eq);
    /* 🔴 EVERY FLAG HERE TAKES A VALUE, so a value that looks like another flag
       is a typo, never a value. The alternative — `args.set(k, argv[++i])` with
       no check — binds `undefined` when the flag is last and SWALLOWS the next
       option when it is not; that exact shape once let a `--dry-run` written at
       the end of a line be silently ignored and the script uploaded. */
    let val = eq === -1 ? mine[++i] : a.slice(eq + 1);
    if (!known.includes(key)) {
      return { error: 'unknown option --' + key + '. Known: ' + known.map(k => '--' + k).join(', ') };
    }
    if (val === undefined || String(val).startsWith('--')) {
      return { error: '--' + key + ' needs a value; got ' + (val === undefined ? 'nothing (it was last)' : val) };
    }
    if (key === 'report-dir') { opts.reportDir = String(val); continue; }
    const n = Number(val);
    if (!Number.isFinite(n) || n < 0) return { error: '--' + key + ' must be a non-negative number; got ' + val };
    if (key === 'seconds') opts.seconds = n;
    else if (key === 'retries') opts.retries = n;
    else opts.graceSeconds = n;
  }
  return { opts, command };
}

/* Is argv[0] the node binary? Covers `node`, `node.exe`, and an absolute
   process.execPath, which is how a spawned child usually spells it. */
function isNode(bin) {
  const base = path.basename(String(bin)).toLowerCase();
  return base === 'node' || base === 'node.exe';
}

/* The report flags go straight AFTER the binary so they are node's own options
   and not the script's arguments — node stops reading options at the first
   non-option, so appending them at the end would hand them to the script. */
function withReportFlags(command, dir) {
  if (!isNode(command[0])) return command.slice();
  return [
    command[0],
    '--report-on-signal',
    '--report-signal=SIGUSR1',
    '--report-directory=' + dir,
    ...command.slice(1)
  ];
}

/* 🔴 KILL THE TREE, NOT THE PROCESS. The runner waits on the step's pipe, and a
   grandchild that inherited it keeps the pipe open after its parent dies — so
   killing only the pid we spawned can leave the step hanging for the same
   reason we are trying to end. On Windows there is no process group to signal
   at all, hence taskkill /T. */
function killTree(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    return;
  }
  /* detached:true put the child in its own group, so -pid reaches the group. */
  try { process.kill(-child.pid, 'SIGKILL'); }
  catch (_) { try { child.kill('SIGKILL'); } catch (__) {} }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------------- the report, and when it is COMPLETE ----------------
   🔴 A REPORT FILE THAT EXISTS IS NOT A REPORT THAT HAS BEEN WRITTEN.
   ⏱ 2026-09-26 00:19Z, PR #965, run 36204413291, job 108297753995: the
   `selftest` job's hang case failed with `SyntaxError: Unexpected end of JSON
   input` reading the report this guard had just reported as collected. Node
   creates the file EMPTY, then fills it through an ~8 KiB stream buffer —
   measured on node 22 (WSL, 8 cores): the file appears 1-49 ms after the
   signal at 0 bytes, and is complete 5-16 ms after it idle (n=8) or
   16-141 ms after it under an 8-way CPU load (n=32). It is written by a
   `process.on(signal)` listener on the child's MAIN thread, so anything that
   stalls the child in that window (CPU steal, a writeback stall on the
   runner's disk) stretches it. The old code slept the grace BLIND and killed,
   so a stall longer than the grace left 0 or 8192 bytes on disk, and the log
   still said "diagnostic report(s) collected". Freezing the child for 3 s the
   moment its report appears reproduced it 10 times in 10 against a 2 s grace,
   9 of them with the exact CI message.

   So the grace is now an UPPER BOUND on a wait for completion: every report
   that appeared after the signal must hold the same size across two polls
   AND parse as JSON. A healthy report ends the wait in tens of milliseconds,
   which is why the grace can stay generous at no cost. Same 3 s freeze, this
   code, 10 s grace: 10 of 10 reports complete. A freeze LONGER than the grace
   is still cut off — the wait is bounded, or this file would hang — and is
   then named INCOMPLETE rather than collected. */
const REPORT_POLL_MS = 50;

function listReports(dir) {
  try { return fs.readdirSync(dir).filter(f => f.endsWith('.json')); }
  catch (_) { return []; }
}

/* One read of one report: its size and whether it parses. Read once and
   judged from the bytes read, so the size and the verdict describe the same
   content. */
function readReport(dir, name) {
  let buf;
  try { buf = fs.readFileSync(path.join(dir, name)); }
  catch (_) { return { name, size: -1, parses: false }; }
  let parses = false;
  try { JSON.parse(buf.toString('utf8')); parses = true; } catch (_) {}
  return { name, size: buf.length, parses };
}

/* Split every report in `dir` into complete and incomplete. Used after the
   kill, when nothing can grow any more, so "parses" alone is the verdict. */
function classifyReports(dir) {
  const complete = [], incomplete = [];
  for (const name of listReports(dir)) {
    const r = readReport(dir, name);
    (r.parses ? complete : incomplete).push(r);
  }
  return { complete, incomplete };
}

/* Wait until every report that was not in `before` is COMPLETE, bounded by
   `graceMs`. Stops early, too, once `childGone()` says the child has exited:
   a dead process writes nothing more, so waiting on it would only burn the
   grace. Resolves { complete, incomplete, waitedMs, timedOut }. */
async function awaitReports(dir, before, graceMs, childGone = () => false) {
  const started = Date.now();
  const deadline = started + graceMs;
  const lastSize = new Map();
  for (;;) {
    const gone = childGone();
    const complete = [], incomplete = [];
    const fresh = listReports(dir).filter(f => !before.has(f));
    for (const name of fresh) {
      const r = readReport(dir, name);
      /* Settled = same size as the previous poll. When the child is gone the
         size cannot move again, so it is settled by definition. */
      const settled = gone || lastSize.get(name) === r.size;
      lastSize.set(name, r.size);
      (settled && r.parses ? complete : incomplete).push(r);
    }
    const waitedMs = Date.now() - started;
    if (fresh.length > 0 && incomplete.length === 0) return { complete, incomplete, waitedMs, timedOut: false };
    if (gone) return { complete, incomplete, waitedMs, timedOut: false };
    if (Date.now() >= deadline) return { complete, incomplete, waitedMs, timedOut: true };
    await sleep(Math.min(REPORT_POLL_MS, Math.max(1, deadline - Date.now())));
  }
}

/* One attempt. Resolves { hung, code } — `code` is meaningless when hung. */
function runOnce(command, opts, attempt, reportDir) {
  return new Promise((resolve) => {
    const started = Date.now();
    const argv = withReportFlags(command, reportDir);
    const child = spawn(argv[0], argv.slice(1), {
      stdio: 'inherit',
      /* POSIX only: its own process group, so killTree can reach the whole
         tree. On Windows `detached` opens a console window instead, which is
         not what is wanted and is not needed — taskkill /T walks the tree. */
      detached: process.platform !== 'win32',
      shell: false
    });

    let settled = false;
    /* 🔴 THE CEILING CLAIMS THE VERDICT THE INSTANT IT FIRES, AND THIS FLAG IS
       WHY. Without it the `exit` event raised by our OWN kill arrives while the
       ceiling handler is still awaiting the report, `settled` is still false, so
       the exit handler resolves FIRST and the run is graded by the code the kill
       produced — measured on Windows 2026-09-06 before this line existed: a
       `setInterval` that never drains came back as exit 1 (taskkill's code)
       rather than 124, i.e. a hang reported as an ordinary gate failure, which
       is the one answer that would send the next reader back to the script. */
    let ceilingFired = false;
    const finish = (v) => { if (!settled) { settled = true; clearTimeout(timer); resolve(v); } };

    child.on('error', (e) => {
      console.error('CANNOT RUN — hang-guard could not spawn ' + argv[0] + ': ' + e.message);
      finish({ hung: false, code: EXIT_CANNOT_RUN });
    });

    child.on('exit', (code, signal) => {
      if (settled || ceilingFired) return;      /* the ceiling owns this attempt */
      const elapsed = ((Date.now() - started) / 1000).toFixed(1);
      console.log('hang-guard: attempt ' + attempt + ' finished in ' + elapsed + 's with ' +
        (signal ? 'signal ' + signal : 'code ' + code));
      /* A child killed by a signal has no exit code. 128+n is the shell's
         convention and keeps a non-zero, non-124 answer for the caller. */
      finish({ hung: false, code: signal ? 128 + (({ SIGKILL: 9, SIGTERM: 15, SIGINT: 2 })[signal] || 0) : code });
    });

    const timer = setTimeout(async () => {
      if (settled) return;
      ceilingFired = true;
      const elapsed = ((Date.now() - started) / 1000).toFixed(1);
      console.log('::warning::hang-guard: attempt ' + attempt + ' passed its ' + opts.seconds +
        's ceiling (elapsed ' + elapsed + 's). Asking the child for a diagnostic report, then killing its process tree.');
      if (process.platform !== 'win32') {
        /* SIGUSR1 is what --report-signal was set to. Node answers it with a
           `process.on(signal)` listener on the child's MAIN thread (read out of
           node v24.18.0's internal/process/report with --expose-internals), so
           a loop that never drains still writes one; a main thread wedged in a
           synchronous loop does not, and the NO-report line below says so.
           The files present BEFORE the signal are set aside, so an earlier
           attempt's report neither ends this wait nor extends it. */
        const before = new Set(listReports(reportDir));
        try { process.kill(child.pid, 'SIGUSR1'); }
        catch (e) { console.log('hang-guard: could not signal the child (' + e.message + ')'); }
        const waited = await awaitReports(reportDir, before, opts.graceSeconds * 1000,
          () => child.exitCode !== null || child.signalCode !== null);
        if (waited.complete.length && !waited.incomplete.length) {
          /* The number this incident lacked: how long the report took on the
             machine that hung. */
          console.log('hang-guard: diagnostic report(s) complete ' + waited.waitedMs +
            ' ms after the signal; killing the process tree now.');
        }
      } else {
        console.log('hang-guard: on Windows Node cannot be signalled for a report, so the tree is killed without one.');
      }
      killTree(child);
      /* Give the exit event a moment; if the tree is unkillable, do not hang
         HERE, which would be this file committing the defect it exists for. */
      await sleep(2000);
      /* 🔴 SAY IN THE LOG WHETHER THE EVIDENCE ACTUALLY LANDED. A retry that
         succeeds makes the step GREEN, and a green step is where nobody looks —
         so the one line that tells a reader an artifact is waiting has to be in
         the log of the run that collected it, not in the run that went red. */
      /* 🔴 ONLY A REPORT THAT PARSES IS "COLLECTED". The tree is dead by now,
         so no file can grow again and parsing is the whole verdict. A file
         that does not parse is named on its own line with its size — a reader
         who downloads the artifact must not find half a report that the log
         called evidence. */
      const { complete, incomplete } = classifyReports(reportDir);
      const landed = complete.map(r => r.name);
      for (const r of incomplete) {
        console.log('::warning::hang-guard: diagnostic report ' + r.name + ' in ' + reportDir +
          ' is INCOMPLETE (' + r.size + ' bytes, does not parse as JSON): the child was still writing it when the ' +
          opts.graceSeconds + 's grace ran out and its tree was killed. It is not evidence; a longer ' +
          '--grace-seconds gives the next hang room to finish it.');
      }
      if (landed.length) {
        console.log('hang-guard: diagnostic report(s) collected in ' + reportDir + ': ' + landed.join(', ') +
          ' — the `javascriptStack` and `libuv` sections name what was still holding the process. ' +
          'Download the hang-report-* artifact; a re-run does not reproduce this.');
      } else if (!incomplete.length) {
        /* An INCOMPLETE one was named above; this line is for none at all. */
        console.log('hang-guard: NO diagnostic report was written to ' + reportDir + '. On Windows that is expected ' +
          '(Node cannot be signalled for one); on POSIX it means the process was too wedged even for the report thread.');
      }
      finish({ hung: true, code: EXIT_HUNG });
    }, opts.seconds * 1000);
  });
}

async function main() {
  const parsed = parse(process.argv.slice(2));
  if (parsed.error) {
    console.error('CANNOT RUN — ' + parsed.error);
    console.error('usage: node scripts/lib/hang-guard.mjs --seconds 180 --retries 1 --report-dir diag -- <command...>');
    process.exit(EXIT_CANNOT_RUN);
  }
  const { opts, command } = parsed;

  const reportDir = path.resolve(opts.reportDir);
  try { fs.mkdirSync(reportDir, { recursive: true }); }
  catch (e) {
    console.error('CANNOT RUN — hang-guard could not create the report directory ' + reportDir + ': ' + e.message);
    process.exit(EXIT_CANNOT_RUN);
  }

  const attempts = opts.retries + 1;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const r = await runOnce(command, opts, attempt, reportDir);
    if (!r.hung) process.exit(r.code);
    if (attempt < attempts) {
      console.log('::warning::hang-guard: retrying (attempt ' + (attempt + 1) + ' of ' + attempts + ').');
    }
  }
  console.log('::error::hang-guard: all ' + attempts + ' attempt(s) exceeded the ' + opts.seconds +
    's ceiling. Any diagnostic report Node managed to write is under ' + reportDir +
    ' — the stack and the open-handle list in it are the evidence a re-run destroys.');
  process.exit(EXIT_HUNG);
}

main();
