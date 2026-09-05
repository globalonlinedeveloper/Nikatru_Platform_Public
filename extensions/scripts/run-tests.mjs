/* run-tests.mjs — run exactly the sims a tool declares.
   =====================================================================

   BUILD-TIME MODULE. NEVER SHIPPED.

     node scripts/run-tests.mjs fullshot                    (ci.yml, release.yml)
     node scripts/run-tests.mjs Extension/Full_Screen_Shot  (id or path, same tool)
     node scripts/run-tests.mjs fullshot --repo-root <dir>

   The subject set is `tests` in tool.json and nothing else. Each path is run on
   BARE NODE — no npm install, ever, not even a devDependency — because the sims
   load the real shipped source and anything a package manager adds is a
   difference between what the test exercises and what a user installs.

   RUN IN PLACE, IN THE WORKING TREE

   Never copy the tool somewhere else first and never tidy up afterwards.
   ci.yml's `sims` job step "Upload pixel-sim output on failure" uploads
   everything under `test/pixel-sim/out/`, at any depth, as an artifact
   `if: failure()` — and that directory is gitignored, so it
   exists on a runner only because a sim just wrote it where the glob can see
   it. A runner that packs the tool into a temp directory produces a
   green-looking upload step with nothing in it, on exactly the runs where the
   pixels are the evidence.

   (The sims themselves do not care about cwd: they are CommonJS and root
   themselves from __dirname, so `require('./fakedom')` resolves against the
   file. cwd is set to the tool directory as a convention, not as a fix.)

   WHY AN EMPTY `tests` ARRAY EXITS 2 AND NOT 0

   lib/toolinfo.mjs validates `tests` only when the key is present and defaults
   it to `[]` when it is not, so a tool.json that lists nothing passes every
   other gate in this directory. If that reached here as a cheerful "0 test(s),
   all passed", a job named `sims` would go green having simulated nothing —
   the failure this whole corpus is written against. A gate that cannot run
   never exits 0, so an empty list is a CANNOT RUN and says which file to edit.

   THE DECLARED LIST IS CROSS-CHECKED AGAINST THE DISK

   toolinfo.mjs already catches a listed test that does not exist ("it does not
   fail, it silently stops running"). The mirror image is not caught anywhere
   and is the same bug: a sim ON DISK that tool.json does not list is a sim that
   nothing ever runs, and it looks identical to a sim that passes. So every
   `.node.js` file anywhere under the tool's `test/` must appear in `tests`, and
   one that does not FAILS here by name. It is a derived floor rather than a
   number — a hardcoded "at least 11" is a second copy of the same fact, and the
   copy is the one that rots.

   (Neither glob above is written out in its real form, because a doubled star
   followed by a slash is a block-comment terminator and this is a block
   comment. templates/tool/TEMPLATE.md records that costing this family twice;
   it cost this file once, before the first run.)

   Exit codes: 0 every listed sim exited 0 · 1 one did not, or the declared set
   disagrees with the disk · 2 could not run — bad usage, unknown tool, an
   unparseable tool.json, an empty `tests` array, or a sim this gate could not
   carry to a verdict. */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { Report, parseArgs, die } from './lib/report.mjs';
import { repoRoot, resolveTool, walk } from './lib/toolinfo.mjs';

const args = parseArgs(process.argv.slice(2));
args.rejectUnknown(['repo-root']);
const root = repoRoot(args);

/* One tool, or none. Silently grading the first of two named tools is how a run
   reports on a smaller set than the one that was asked for. */
if (args.positional.length > 1) {
  die('more than one tool given: ' + args.positional.map(t => '"' + t + '"').join(', ') +
    '\nThis gate takes exactly ONE — a tool id ("fullshot") or a Category/Tool_Dir. It will not\n' +
    'pick one of them for you. The "Run tool sims" step in ci.yml and the "Sims" step in\n' +
    'release.yml each pass a single id.');
}

const tool = resolveTool(root, args.positional[0]);
const r = new Report('run-tests · ' + tool.id + ' (' + tool.rel + ')');

/* ---------------- the subject set ---------------- */
/* Declared, in tool.json order. Backslashes are normalised because a path typed
   on Windows into a JSON file still has to match a POSIX walk. */
const declared = tool.tests.map(t => String(t).replace(/\\/g, '/').replace(/^\.\//, ''));

/* Everything on disk that is a sim by the convention this family uses: a
   `.node.js` file under the tool's test/ tree is something you run with node.
   Libraries and fixtures beside them are plain `.js` (test/pixel-sim/png.js,
   test/harness.js) and are correctly invisible here. */
const RE_SIM_ON_DISK = /^test\/.*\.node\.js$/;
const onDisk = walk(tool.dirAbs, {
  skip: rel => {
    const name = rel.slice(rel.lastIndexOf('/') + 1);
    return name === 'node_modules' || name === '.git';
  }
}).filter(rel => RE_SIM_ON_DISK.test(rel));

if (declared.length === 0) {
  die(tool.rel + '/tool.json declares no "tests", so this gate has nothing to run.\n' +
    (onDisk.length
      ? 'That is not an empty tool: ' + onDisk.length + ' sim(s) sit on disk unlisted —\n' +
        onDisk.map(f => '  ' + tool.rel + '/' + f).join('\n') + '\n' +
        'Add them to "tests" in tool.json.'
      : 'There is no test/*.node.js in the tree either, so the sims have not been written yet.') + '\n' +
    'This is deliberately a CANNOT RUN and not a pass: "0 test(s), all passed" is the exact\n' +
    'shape of a check that stopped checking, and the job that calls this is named `sims`.');
}

/* A path listed twice runs twice and inflates the count the coverage assertion
   below rests on. An assertion measured against a padded number is worse than
   none. */
const seen = new Set();
const dupes = [...new Set(declared.filter(t => (seen.has(t) ? true : (seen.add(t), false))))];
if (dupes.length) {
  r.fail('every "tests" entry is listed once',
    tool.rel + '/tool.json lists ' + dupes.map(d => '"' + d + '"').join(', ') + ' more than once.\n' +
    'The duplicate runs twice and counts twice, so the suite looks broader than it is.');
}

/* THE FLOOR. Derived from the tree, so it rises the moment a sim is added and
   can never quietly fall behind the way a hardcoded count does. */
const unlisted = onDisk.filter(f => !declared.includes(f));
if (unlisted.length) {
  r.fail(onDisk.length + ' sim(s) on disk, ' + (onDisk.length - unlisted.length) + ' listed in tool.json',
    'these file(s) exist and nothing runs them:\n' +
    unlisted.map(f => '  ' + tool.rel + '/' + f).join('\n') + '\n' +
    'A sim that is never invoked reports exactly what a passing sim reports: nothing. Add each\n' +
    'to "tests" in ' + tool.rel + '/tool.json, or rename it off the .node.js convention if it is\n' +
    'a helper rather than something you run with node.');
} else {
  r.pass('every test/*.node.js on disk is listed in tool.json', onDisk.length + ' sim(s) cross-checked');
}

/* ---------------- run them ---------------- */
/* In declared order, and ALL of them even after one fails. fail-fast is off in
   the matrix -- `grep -n 'fail-fast' .github/workflows/ci.yml` finds it on
   every one of them -- for the same reason it is off here: the second failure
   is usually what tells you whether the first one is the cause or a
   symptom, and re-running a 6-minute matrix to find out is a poor trade.

   Output is captured and re-printed rather than inherited, so the banner always
   lands above the output it introduces. `process.stdout` is asynchronous to a
   pipe on Linux — which is what a runner gives it — so a banner written here
   and a child writing to the same fd interleave in whatever order they finish. */
const MAX_OUTPUT = 64 * 1024 * 1024;

for (const rel of declared) {
  const abs = path.join(tool.dirAbs, rel);

  /* loadTool() already refused a listed path that does not exist, so reaching
     this branch means the tree changed underneath the run. Say that, rather
     than letting node's "Cannot find module" exit 1 read as a failing test. */
  let st;
  try { st = fs.statSync(abs); } catch (e) {
    die('cannot run ' + tool.rel + '/' + rel + ': ' + e.code + ' — ' + e.message + '\n' +
      'tool.json lists it and lib/toolinfo.mjs confirmed it existed moments ago. This is the gate\n' +
      'failing to run a test, not a test failing.');
  }
  if (!st.isFile()) {
    die(tool.rel + '/' + rel + ' is not a file (tool.json "tests" lists it). Only a file can be run.');
  }

  r.blank();
  console.log('── ' + tool.rel + '/' + rel);

  /* The ambient environment is passed through unchanged and nothing is added to
     it. test/pixel-sim/run.js:30 reads FS_ROOT and falls back to a __dirname
     path — that fallback is the one that points at the tool being graded, so
     setting FS_ROOT here would let this gate aim a sim at a tree other than the
     one it is reporting on. */
  const res = spawnSync(process.execPath, [abs], {
    cwd: tool.dirAbs,
    encoding: 'utf8',
    maxBuffer: MAX_OUTPUT,
    env: process.env
  });

  const out = ((res.stdout || '') + (res.stderr || '')).trimEnd();
  if (out) console.log(out);

  /* Two of the three outcomes below are not verdicts about the code under test,
     and each has to be told apart from the one that is. A run that never
     happened or was cut off (ENOENT, EMFILE, output past maxBuffer) is this gate
     failing; a signal is the sim dying rather than deciding; only an exit code is
     an answer. `status` is null in both of the first two cases, which is why
     nothing here compares it to 0 before ruling them out.

     The signal arm looks unreachable if you only try it on Windows: measured
     here, a sim that does process.kill(process.pid, 'SIGKILL') comes back as
     status 1 with signal null, because Windows has no signals and node emulates
     the kill with TerminateProcess. It was negative-tested on Linux under node
     22 instead -- the platform the `sims` job actually runs on, `runs-on:
     ubuntu-latest` with `node: ['22', '24']` -- where the same sim comes back
     signal 'SIGKILL', status null. Do not delete this arm for failing
     to reproduce on the wrong OS. */
  if (res.error) {
    die('could not run ' + tool.rel + '/' + rel + ': ' + (res.error.code || '') + ' ' + res.error.message + '\n' +
      'The sim never started, or it outran the ' + (MAX_OUTPUT / 1024 / 1024) + ' MiB output buffer and was cut off\n' +
      'mid-run (ENOBUFS). Either way no verdict was reached: that is this gate failing, not the sim\n' +
      'failing, and the two must never share an exit code.');
  }
  if (res.signal) {
    r.fail(rel, 'killed by ' + res.signal + ' after ' + (out ? 'printing ' + out.split('\n').length + ' line(s)' : 'printing nothing') + '.\n' +
      'A sim that dies has not answered; reproduce with:\n' +
      '  node ' + tool.rel + '/' + rel);
    continue;
  }
  if (res.status !== 0) {
    r.fail(rel, 'exited ' + res.status + '. Its output is above. Reproduce with:\n' +
      '  node ' + tool.rel + '/' + rel);
    continue;
  }
  if (!out) {
    /* Not fatal, and deliberately not silent. A sim that exits 0 having printed
       nothing is indistinguishable from a sim whose assertions all got skipped. */
    r.warn(rel, 'exited 0 but printed nothing at all. Every other sim in this repo prints what it\n' +
      'checked; one that prints nothing cannot be audited, and an assertion that never ran looks\n' +
      'exactly like this.');
    continue;
  }
  r.pass(rel);
}

process.exit(r.finish());
