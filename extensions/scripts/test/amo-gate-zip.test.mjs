/* amo-gate-zip.test.mjs — do FullShot's two AMO zip wrappers still refuse what
   the workflow steps they replaced refused?
   =====================================================================

   BUILD-TIME MODULE. NEVER SHIPPED.

     node --test scripts/test/amo-gate-zip.test.mjs

   The subjects are Extension/Full_Screen_Shot/publish/amo-gate-built-zip.node.js
   (the package job, on CI's own build) and amo-gate-release-zip.node.js (the
   release job, on the bytes a tag uploads). Until 2026-09-25 each was a
   `shell: bash` step behind an `if:` naming the tool; they are the tool's
   tool.json gates now (O-EXTENSION-GATES-NAME-ONE-TOOL), and these cases are
   what the move is held to.

   Each case copies the REAL wrapper into a scratch directory beside a stand-in
   `verify-firefox-package.node.js`, because the wrapper finds its grader by
   `__dirname`. The stand-in's behaviour is chosen per case through the
   environment, so every outcome the wrapper distinguishes can be produced on
   demand — including the one the real grader only reaches on a source tree:
   exit 0 without ALL PASS. A mutation of either real wrapper reddens a case
   here, because the copy is taken on every run.

   selftest.node.js cannot host these: its run() helper resolves against
   scripts/ and appends `--repo-root`, and these wrappers take `--zip` only. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLISH = path.resolve(HERE, '..', '..', 'Extension', 'Full_Screen_Shot', 'publish');

/* The stand-in grader. It announces the zip it was handed, then writes to
   stdout and stderr ALTERNATELY with synchronous writes, so a wrapper that
   captured the two streams separately would print them out of order. */
const STUB = `'use strict';
const fs = require('fs');
const say = (fd, s) => fs.writeSync(fd, s + '\\n');
const mode = process.env.AMO_STUB || 'pass';
say(1, 'stub grader handed ' + process.argv.slice(2).join(' '));
say(2, 'stderr line between two stdout lines');
say(1, 'second stdout line');
if (mode === 'pass') { say(1, 'ALL PASS'); process.exitCode = 0; }
else if (mode === 'source') { say(1, 'SOURCE PASSES — NO PACKAGE WAS GRADED'); process.exitCode = 0; }
else if (mode === 'fail') { say(2, 'FAIL  something the store would reject'); process.exitCode = 5; }
`;

function sandbox(wrapper, { zip = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amo-gate-zip-'));
  fs.copyFileSync(path.join(PUBLISH, wrapper), path.join(dir, wrapper));
  fs.writeFileSync(path.join(dir, 'verify-firefox-package.node.js'), STUB);
  const zipPath = path.join(dir, 'fullshot-firefox.zip');
  if (zip) fs.writeFileSync(zipPath, 'not inspected by the stand-in');
  return { dir, zipPath };
}

function run(wrapper, mode, opts) {
  const { dir, zipPath } = sandbox(wrapper, opts);
  try {
    const res = spawnSync(process.execPath, [path.join(dir, wrapper), '--zip', zipPath], {
      encoding: 'utf8',
      env: { ...process.env, AMO_STUB: mode },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    return { code: res.status, out: res.stdout, err: res.stderr, zipPath };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const BUILT = 'amo-gate-built-zip.node.js';
const RELEASE = 'amo-gate-release-zip.node.js';

for (const wrapper of [BUILT, RELEASE]) {
  test(wrapper + ': a zip the grader passes with ALL PASS exits 0 and prints the grader\'s log, in write order', () => {
    const r = run(wrapper, 'pass');
    assert.equal(r.code, 0, r.out + r.err);
    assert.ok(r.out.includes('stub grader handed --zip ' + r.zipPath), 'the grader is handed the same --zip\n' + r.out);
    assert.ok(r.out.includes('stub grader handed --zip ' + r.zipPath + '\nstderr line between two stdout lines\nsecond stdout line\nALL PASS\n'),
      'stdout and stderr of the grader arrive merged, in the order it wrote them\n' + r.out);
    assert.ok(!r.out.includes('::error::'), r.out);
  });

  test(wrapper + ': no file at --zip exits 1 with an ::error:: and never runs the grader', () => {
    const r = run(wrapper, 'pass', { zip: false });
    assert.equal(r.code, 1, r.out + r.err);
    assert.ok(r.out.startsWith('::error::' + r.zipPath + ' does not exist'), r.out);
    assert.ok(!r.out.includes('stub grader handed'), 'the grader ran on a zip that is not there\n' + r.out);
  });

  test(wrapper + ': an exit 0 that never printed ALL PASS is exit 1, not a pass', () => {
    const r = run(wrapper, 'source');
    assert.equal(r.code, 1, r.out + r.err);
    assert.ok(r.out.includes('SOURCE PASSES — NO PACKAGE WAS GRADED\n::error::the AMO gate exited 0 but never printed ALL PASS.'),
      'the grader\'s log comes first and the verdict after it\n' + r.out);
  });

  test(wrapper + ': no --zip at all cannot run (exit 2), and is not a pass', () => {
    const { dir } = sandbox(wrapper);
    try {
      const res = spawnSync(process.execPath, [path.join(dir, wrapper)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      assert.equal(res.status, 2, res.stdout + res.stderr);
      assert.ok(res.stderr.includes('CANNOT RUN — usage: ' + wrapper + ' --zip'), res.stderr);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}

test(BUILT + ': a grader failure is passed through as its own code, after its log, with no verdict of its own', () => {
  const r = run(BUILT, 'fail');
  assert.equal(r.code, 5, r.out + r.err);
  assert.ok(r.out.endsWith('second stdout line\nFAIL  something the store would reject\n'), r.out);
  assert.ok(!r.out.includes('::error::'), r.out);
});

test(RELEASE + ': a grader failure is its own code, after its log, with an ::error:: naming the code and the zip', () => {
  const r = run(RELEASE, 'fail');
  assert.equal(r.code, 5, r.out + r.err);
  assert.ok(r.out.includes('FAIL  something the store would reject\n::error::the AMO gate exited 5 on ' + r.zipPath + '. These are the exact bytes this tag would upload'), r.out);
});

test('the two wrappers keep their own wording: the release one names the release', () => {
  assert.ok(run(RELEASE, 'source').out.includes('A pass that inspected no package must not clear a release.'));
  assert.ok(run(BUILT, 'source').out.includes('An empty subject must not print the same verdict as a verified one.'));
  assert.ok(run(RELEASE, 'pass', { zip: false }).out.includes('over a release that ships a Firefox package.'));
  assert.ok(run(BUILT, 'pass', { zip: false }).out.includes('though the pack step above reported success'));
});
