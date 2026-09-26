/* FullShot's AMO submission gate, on the exact Firefox zip a release tag uploads.

     node Extension/Full_Screen_Shot/publish/amo-gate-release-zip.node.js --zip dist/fullshot-firefox.zip

   Run from the extensions root by `node scripts/discover.mjs --run-gates
   --tool "$TOOL_ID" --stage release --zip ...` in extensions.yml's release
   job, after the pack step and before anything is uploaded. Three outcomes,
   and only one is a pass:

     · no file at --zip             ::error::, exit 1 — the grader would have
                                    graded the source tree and exited 0 over a
                                    release that ships a Firefox package;
     · the grader exits non-zero    its log, an ::error:: naming the code and
                                    the zip, then that code;
     · the grader exits 0 without   ::error::, exit 1 — its other exit-0 path is
       a line reading ALL PASS      'SOURCE PASSES — NO PACKAGE WAS GRADED'.

   ⏱ MOVED 2026-09-25 (O-EXTENSION-GATES-NAME-ONE-TOOL) out of extensions.yml's
   release job, where it was a `shell: bash` step behind an `if:` naming this
   tool. The outcomes and the ::error:: text are the step's, byte for byte.
   publish/amo-gate-built-zip.node.js is the same gate on CI's own build; its
   header records why the grader's log is printed before any verdict. */
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
  if (i < 0 || argv.length !== 2 || !argv[i + 1]) return cannotRun('usage: amo-gate-release-zip.node.js --zip <path to the Firefox zip this tag uploads>');
  const zip = argv[i + 1];
  let isFile = false;
  try { isFile = fs.statSync(zip).isFile(); } catch { isFile = false; }
  if (!isFile) {
    console.log('::error::' + zip + ' does not exist. The pack step above was supposed to write it, so this gate would have graded the source tree and exited 0 over a release that ships a Firefox package.');
    process.exitCode = 1;
    return;
  }
  const { out, code, error } = grade(zip);
  if (error) return cannotRun('could not start ' + GRADER + ': ' + error);
  process.stdout.write(out.replace(/\n+$/, '') + '\n');
  if (code !== 0) {
    console.log('::error::the AMO gate exited ' + code + ' on ' + zip + '. These are the exact bytes this tag would upload to addons.mozilla.org, and an accepted-but-wrong upload cannot be taken back.');
    process.exitCode = code;
    return;
  }
  if (!out.split('\n').includes('ALL PASS')) {
    console.log("::error::the AMO gate exited 0 but never printed ALL PASS. Its only other exit-0 path is 'SOURCE PASSES — NO PACKAGE WAS GRADED', i.e. it opened no zip and graded the source tree instead. A pass that inspected no package must not clear a release.");
    process.exitCode = 1;
  }
}

main(process.argv.slice(2));
