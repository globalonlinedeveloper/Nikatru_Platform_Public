/* FullShot's AMO submission gate, on the Firefox zip CI just built.

     node Extension/Full_Screen_Shot/publish/amo-gate-built-zip.node.js --zip dist/fullshot-firefox.zip

   Run from the extensions root by `node scripts/discover.mjs --run-gates
   --tool fullshot --stage package ...`, which appends the --zip, on the leg
   tool.json `gates` names (target firefox, os ubuntu-24.04). Three outcomes,
   and only one is a pass:

     · no file at --zip             ::error::, exit 1 — the grader would have
                                    graded the source tree and exited 0 while
                                    inspecting no package at all;
     · the grader exits non-zero    its log, then its exit code;
     · the grader exits 0 without   ::error::, exit 1 — its other exit-0 path is
       a line reading ALL PASS      'SOURCE PASSES — NO PACKAGE WAS GRADED'.

   ⏱ MOVED 2026-09-25 (O-EXTENSION-GATES-NAME-ONE-TOOL) out of extensions-ci.yml's
   package job, where it was a `shell: bash` step behind an `if:` naming this
   tool. The outcomes and the ::error:: text are the step's, byte for byte.

   What the bash body had learned, and why this file keeps it: its output was
   CAPTURED before it was printed, and a capture that aborts on the grader's
   failure prints nothing. Measured 2026-08-22 on that body against a corrupt
   dist/fullshot-firefox.zip: under the runner's `bash -eo pipefail` it exited
   1 having printed 0 bytes, because `-e` killed the shell at the capture and
   the print after it never ran; with `|| code=$?` on the capture it exited 1
   and printed 3976 bytes, and against the real zip it exited 0 and printed
   4242 bytes ending `ALL PASS`. Here the grader's exit code is read from the
   spawn, never thrown, so the log is printed on every path before the verdict.
   Its stdout and stderr share one file, as `2>&1` did, so the two keep the
   order the grader wrote them in. */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const GRADER = path.join(__dirname, 'verify-firefox-package.node.js');

function cannotRun(msg) {
  console.error('CANNOT RUN — ' + msg);
  process.exitCode = 2;
}

/* The grader, with its stdout and stderr merged into one file in write order.
   Returns { out, code }, or { error } when node could not start it; `out` is
   what `$(... 2>&1)` would have held. */
function grade(zip) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amo-gate-'));
  const file = path.join(dir, 'out.log');
  const fd = fs.openSync(file, 'w+');
  try {
    const res = spawnSync(process.execPath, [GRADER, '--zip', zip], { stdio: ['inherit', fd, fd] });
    if (res.error) return { error: res.error.message };
    const code = res.status !== null ? res.status : 128 + (os.constants.signals[res.signal] || 0);
    const size = fs.fstatSync(fd).size;
    const buf = Buffer.alloc(size);
    fs.readSync(fd, buf, 0, size, 0);
    return { out: buf.toString('utf8'), code };
  } finally {
    fs.closeSync(fd);
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function main(argv) {
  const i = argv.indexOf('--zip');
  if (i < 0 || argv.length !== 2 || !argv[i + 1]) return cannotRun('usage: amo-gate-built-zip.node.js --zip <path to the built Firefox zip>');
  const zip = argv[i + 1];
  let isFile = false;
  try { isFile = fs.statSync(zip).isFile(); } catch { isFile = false; }
  if (!isFile) {
    console.log('::error::' + zip + ' does not exist, though the pack step above reported success — so this gate would have graded the source tree and exited 0 while inspecting no package at all.');
    process.exitCode = 1;
    return;
  }
  const { out, code, error } = grade(zip);
  if (error) return cannotRun('could not start ' + GRADER + ': ' + error);
  process.stdout.write(out.replace(/\n+$/, '') + '\n');
  if (code !== 0) { process.exitCode = code; return; }
  if (!out.split('\n').includes('ALL PASS')) {
    console.log("::error::the AMO gate exited 0 but never printed ALL PASS. Its only other exit-0 path is 'SOURCE PASSES — NO PACKAGE WAS GRADED', i.e. it graded the source tree and opened no zip. An empty subject must not print the same verdict as a verified one.");
    process.exitCode = 1;
  }
}

main(process.argv.slice(2));
