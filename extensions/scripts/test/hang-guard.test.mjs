/* hang-guard.test.mjs — does the ceiling actually fire, and does a normal run
   pass through untouched?
   =====================================================================

   BUILD-TIME MODULE. NEVER SHIPPED.

     node --test scripts/test/hang-guard.test.mjs

   🔴 THE PAIR THAT MATTERS IS (a) AND (b). A wrapper that never fires is
   indistinguishable from no wrapper at all, and a wrapper that fires on a
   healthy command turns every green run red — so both limbs are asserted, not
   just the interesting one. `scripts/lib/hang-guard.mjs` exists because a step
   that had printed its last line still hung for 25 minutes; a guard for that
   which was itself never proven to bite would be the same class of defect one
   level up.

   (c) is the limb that keeps the guard HONEST about failures: a command that
   exits 3 must come back as 3. If the wrapper collapsed every non-zero code to
   1 — or worse, to 124 — a real gate failure would arrive dressed as a hang and
   somebody would "fix" it by raising the ceiling.

   ON POSIX (b) also asserts that Node's diagnostic report LANDED. That file is
   the entire reason the guard signals before it kills: it carries the JS stack
   of every thread and the list of open libuv handles, which is the evidence a
   re-run destroys. Windows cannot be signalled for a report — Node's
   --report-on-signal is a no-op there — so the file assertion is skipped and
   only the 124 is required, which is exactly what the guard promises on that
   platform. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GUARD = path.resolve(HERE, '..', 'lib', 'hang-guard.mjs');
const POSIX = process.platform !== 'win32';

/* Each case gets its own report directory, so (b)'s assertion that a report
   exists cannot be satisfied by a file some earlier case left behind. */
function tmpdir(tag) {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'hang-guard-' + tag + '-'));
}

function runGuard(args, dir) {
  const res = spawnSync(process.execPath, [GUARD, '--report-dir', dir, ...args], {
    encoding: 'utf8',
    /* The guard inherits stdio, so its child's output arrives here as the
       guard's own. Captured rather than inherited: a case asserts on text. */
    stdio: ['ignore', 'pipe', 'pipe']
  });
  return { code: res.status, out: (res.stdout || '') + (res.stderr || '') };
}

test('a command that exits 0 passes through with code 0', () => {
  const dir = tmpdir('ok');
  const r = runGuard(
    ['--seconds', '60', '--retries', '0', '--', process.execPath, '-e', 'console.log("hello from the child")'],
    dir
  );
  assert.equal(r.code, 0, 'expected 0, got ' + r.code + '\n--- output ---\n' + r.out);
  assert.match(r.out, /hello from the child/, 'the child\'s stdout must reach the log unchanged');
  assert.doesNotMatch(r.out, /::warning::hang-guard/, 'a healthy run must not warn about a ceiling it never reached');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a command that never exits is killed at the ceiling and reported as 124', () => {
  const dir = tmpdir('hang');
  const r = runGuard(
    /* setInterval with no unref is the smallest honest hang: the process is
       healthy, the loop simply never drains. The grace is the production
       default, 10 s. It used to be cut to 2 s to save time, because the guard
       slept it blind — and 2 s was the margin that ran out on 2026-09-26 (PR
       #965, run 36204413291: `Unexpected end of JSON input` at the parse
       below). The guard now ends the grace the moment the report is complete,
       so the full margin costs this case nothing. */
    ['--seconds', '2', '--retries', '0', '--grace-seconds', '10', '--',
     process.execPath, '-e', 'console.log("child is up"); setInterval(() => {}, 1000);'],
    dir
  );
  assert.equal(r.code, 124, 'expected 124, got ' + r.code + '\n--- output ---\n' + r.out);
  assert.match(r.out, /::warning::hang-guard: attempt 1 passed its 2s ceiling/,
    'the warning must name the attempt and the ceiling, or the log does not say which leg hung');
  assert.match(r.out, /::error::hang-guard: all 1 attempt/,
    'a run where every attempt hung must end in an error line, not a silent 124');

  if (POSIX) {
    const reports = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
    assert.ok(reports.length > 0,
      'no diagnostic report was written to ' + dir + '. The report is the only evidence a hang leaves ' +
      'behind, and a guard that kills without collecting it has thrown away the reason it exists.\n' +
      '--- output ---\n' + r.out);
    /* The parse stays a hard assertion — a report that does not parse is not
       evidence — but its failure now carries the guard's own output, which
       names an INCOMPLETE report and its size. A bare SyntaxError did not. */
    let report;
    const text = fs.readFileSync(path.join(dir, reports[0]), 'utf8');
    try { report = JSON.parse(text); }
    catch (e) {
      assert.fail('the diagnostic report ' + reports[0] + ' does not parse (' + e.message + ', ' +
        Buffer.byteLength(text) + ' bytes)\n--- output ---\n' + r.out);
    }
    assert.ok(report.header, 'the report must parse as a Node diagnostic report');
    assert.ok(Array.isArray(report.libuv),
      'the report must carry the open-handle list — that is the half of it that names what kept the loop alive');
    assert.doesNotMatch(r.out, /INCOMPLETE/,
      'a report that parses must not also be called incomplete\n--- output ---\n' + r.out);
    assert.match(r.out, /diagnostic report\(s\) complete \d+ ms after the signal/,
      'the guard must end the grace when the report is complete, and say how long it took\n--- output ---\n' + r.out);
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

/* 🔴 (d) AND (e) ARE THE PAIR FOR THE 2026-09-26 DEFECT: A REPORT FILE THAT
   EXISTS IS NOT A REPORT THAT HAS BEEN WRITTEN. Node creates the file empty
   and fills it in ~8 KiB chunks, on the child's main thread; the guard used to
   sleep its grace blind, kill, and then list every `.json` it found as
   "collected" — so a child stalled mid-write left 0 bytes on disk and a log
   line calling it evidence. Freezing the child for 3 s the moment its report
   appeared reproduced that 10 times in 10 against the old 2 s grace.

   Both cases stand in for a slow writer with a SECOND listener on the same
   signal: it writes half a JSON document into the report directory at once and
   the rest later — or never. Node's own report still lands beside it, so each
   case also proves the guard waits for EVERY report, not the first. POSIX
   only, for the same reason as the report assertion above. */
function slowWriter(finishAfterMs) {
  return 'const fs = require("fs"), path = require("path");' +
    'process.on("SIGUSR1", () => {' +
    '  const f = path.join(process.report.directory, "slow-writer.json");' +
    '  fs.writeFileSync(f, "{\\"header\\": ");' +
    (finishAfterMs === null ? '' :
      '  setTimeout(() => fs.appendFileSync(f, "{\\"slow\\": true}}"), ' + finishAfterMs + ');') +
    '});' +
    'console.log("child is up"); setInterval(() => {}, 1000);';
}

test('a report still being written at the ceiling is WAITED FOR, then the tree is killed', { skip: !POSIX && 'no signals on Windows' }, () => {
  const dir = tmpdir('slow');
  const started = Date.now();
  const r = runGuard(
    ['--seconds', '2', '--retries', '0', '--grace-seconds', '10', '--',
     process.execPath, '-e', slowWriter(1500)],
    dir
  );
  const ms = Date.now() - started;
  assert.equal(r.code, 124, 'expected 124, got ' + r.code + '\n--- output ---\n' + r.out);
  let text = null;
  try { text = fs.readFileSync(path.join(dir, 'slow-writer.json'), 'utf8'); } catch (_) {}
  assert.ok(text !== null, 'the slow writer never started, so this case proved nothing\n--- output ---\n' + r.out);
  /* The child is SIGKILLed after the wait, so a document that parses here was
     finished BEFORE the kill: the guard waited the 1.5 s the writer needed. */
  assert.deepEqual(JSON.parse(text), { header: { slow: true } },
    'the guard killed the child before its report was complete\n--- output ---\n' + r.out);
  assert.match(r.out, /diagnostic report\(s\) collected in [^\n]*slow-writer\.json/,
    'a complete report must be listed as collected\n--- output ---\n' + r.out);
  assert.doesNotMatch(r.out, /INCOMPLETE/, 'nothing was incomplete\n--- output ---\n' + r.out);
  /* ...and it did NOT sleep the grace blind. Ceiling 2 s + write 1.5 s + the
     2 s exit settle is ~5.5 s; a blind 10 s grace makes it ~14 s. */
  assert.ok(ms < 10000, 'the guard took ' + ms + ' ms: it slept the whole grace instead of ending it when ' +
    'the report was complete\n--- output ---\n' + r.out);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a report the grace cannot wait out is named INCOMPLETE, never listed as collected', { skip: !POSIX && 'no signals on Windows' }, () => {
  const dir = tmpdir('trunc');
  const r = runGuard(
    ['--seconds', '2', '--retries', '0', '--grace-seconds', '1', '--',
     process.execPath, '-e', slowWriter(null)],
    dir
  );
  /* The exit contract does not move: a hang is 124 whatever the evidence. */
  assert.equal(r.code, 124, 'expected 124, got ' + r.code + '\n--- output ---\n' + r.out);
  assert.equal(fs.readFileSync(path.join(dir, 'slow-writer.json'), 'utf8'), '{"header": ',
    'the fixture must leave half a document behind, or this case proves nothing');
  assert.match(r.out, /::warning::hang-guard: diagnostic report slow-writer\.json in [^\n]* is INCOMPLETE \(11 bytes, does not parse as JSON\)/,
    'a half-written report must be named as such, with its size\n--- output ---\n' + r.out);
  assert.doesNotMatch(r.out, /collected in [^\n]*slow-writer\.json/,
    'the log called half a report evidence\n--- output ---\n' + r.out);
  /* Node's own report is complete and is still collected beside it. */
  assert.match(r.out, /diagnostic report\(s\) collected in [^\n]*report\.[^\n]*\.json/,
    'the complete report must still be listed\n--- output ---\n' + r.out);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a command that exits 3 returns 3, not 1 and not 124', () => {
  const dir = tmpdir('three');
  const r = runGuard(
    ['--seconds', '60', '--retries', '0', '--', process.execPath, '-e', 'process.exit(3)'],
    dir
  );
  assert.equal(r.code, 3, 'expected 3, got ' + r.code + '\n--- output ---\n' + r.out);
  assert.doesNotMatch(r.out, /::warning::hang-guard/,
    'a command that failed fast has not hung, so it must not be retried or warned about');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('no `--` separator refuses rather than guessing', () => {
  const dir = tmpdir('nosep');
  const r = runGuard(['--seconds', '60', process.execPath, '-e', 'process.exit(0)'], dir);
  assert.equal(r.code, 2, 'a wrapper that cannot tell its flags from the command\'s must refuse, never run');
  assert.match(r.out, /CANNOT RUN/);
  fs.rmSync(dir, { recursive: true, force: true });
});
