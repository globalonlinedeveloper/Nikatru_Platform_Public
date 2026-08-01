// ─────────────────────────────────────────────────────────────────────────────
// scan-workflows.test.mjs — the workflow scanner must be able to FAIL.
//
// [pipeline F-11 / F-10] The behaviour that matters most here — "the wrapper
// fails when the scanner stops detecting" — CANNOT be exercised with the real
// binary, because a working zizmor always flags the canary. So these tests
// substitute stub scanners, exactly as scan-secrets.mjs's tests do.
//
// The stubs are the point. A test that only ever runs the real zizmor proves the
// happy path and nothing else, which is the same blind spot the guards themselves
// had before F-10 existed.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GUARD = join(CI_DIR, 'scan-workflows.mjs');

let TMP;
before(() => {
  TMP = mkdtempSync(join(tmpdir(), 'nikatru-zz-'));
});
after(() => {
  rmSync(TMP, { recursive: true, force: true });
});

/** A stub scanner. `exitFor` maps a call kind to an exit code:
 *   version -> always 0 unless `noVersion`
 *   any scan -> `findings` (14) or `clean` (0), chosen per invocation. */
function stub(name, { versionExit = 0, canaryExit = 14, realExit = 0, weirdExit = null, ansi = false } = {}) {
  const path = join(TMP, name);
  const esc = ansi ? "'\\u001b[1m' + " : "'' + ";
  writeFileSync(
    path,
    `
const argv = process.argv.slice(2);
if (argv.includes('--version')) { console.log('stub 0.0.0'); process.exit(${versionExit}); }
const target = argv[argv.length - 1];
const isCanary = target.includes('nikatru-wf-canary-');
if (${weirdExit !== null} && !isCanary) { process.exit(${weirdExit ?? 0}); }
const line = ${esc} (isCanary ? '1 findings: 0 informational, 0 low, 0 medium, 1 high' : '9 findings: 4 informational, 0 low, 5 medium, 0 high') + '\\u001b[0m';
console.log(line);
process.exit(isCanary ? ${canaryExit} : ${realExit});
`,
  );
  return path;
}

/** A repo skeleton with N workflow files, so the coverage floor can be exercised. */
function fakeRepo(name, workflowCount) {
  const root = join(TMP, name);
  const dir = join(root, '.github', 'workflows');
  mkdirSync(dir, { recursive: true });
  for (let i = 0; i < workflowCount; i++) {
    writeFileSync(join(dir, `w${i}.yml`), 'name: x\non: [push]\njobs: {}\n');
  }
  return root;
}

const run = (root, scanner) =>
  spawnSync(process.execPath, [GUARD, root, '--zizmor', scanner], { encoding: 'utf8' });

describe('scan-workflows wrapper', () => {
  test('clean workflows + a detecting scanner passes', () => {
    const r = run(fakeRepo('ok', 5), stub('ok.mjs'));
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /self-test — a deliberately vulnerable workflow is still detected/);
    // Matches whatever MIN_SEVERITY is set to, so raising the gate does not
    // silently turn this assertion into one that cannot fail.
    assert.match(r.stdout, /no \w+-severity\/\w+-confidence findings/);
  });

  test('THE ONE THAT MATTERS: a scanner that stopped detecting fails the SELF-TEST', () => {
    // Reports clean on everything, including the deliberately broken canary.
    // Without this check it would report the real workflows clean forever.
    const r = run(fakeRepo('blind', 5), stub('blind.mjs', { canaryExit: 0 }));
    assert.equal(r.status, 1);
    assert.match(r.stderr, /SELF-TEST FAILED/);
    assert.match(r.stderr, /reported these workflows "clean" while detecting nothing/);
  });

  test('a real finding in the real workflows fails the build', () => {
    const r = run(fakeRepo('dirty', 5), stub('dirty.mjs', { realExit: 14 }));
    assert.equal(r.status, 1);
    assert.match(r.stderr, /workflow static analysis found/);
    // The message must say where an exception belongs, or people invent one.
    assert.match(r.stderr, /zizmor: ignore/);
  });

  test('an unexpected exit code FAILS CLOSED rather than reading as clean', () => {
    const r = run(fakeRepo('weird', 5), stub('weird.mjs', { weirdExit: 2 }));
    assert.equal(r.status, 1);
    assert.match(r.stderr, /neither clean \(0\) nor findings \(14\)/);
  });

  test('a missing scanner fails rather than skipping the check', () => {
    const r = run(fakeRepo('nobin', 5), join(TMP, 'does-not-exist.mjs'));
    assert.equal(r.status, 1);
    assert.match(r.stderr, /not runnable/);
  });

  test('COVERAGE: too few workflows is "the scan is broken", not "the tree is clean"', () => {
    // A scan pointed at the wrong directory finds nothing and exits 0, which is
    // indistinguishable from a clean repo. This is the assertion that tells them
    // apart. [pipeline F-10]
    const r = run(fakeRepo('thin', 2), stub('thin.mjs'));
    assert.equal(r.status, 1);
    assert.match(r.stderr, /COVERAGE LOST — found 2 workflow\(s\)/);
  });

  test('COVERAGE: a missing workflows directory is caught', () => {
    const root = join(TMP, 'nowf');
    mkdirSync(root, { recursive: true });
    const r = run(root, stub('nowf.mjs'));
    assert.equal(r.status, 1);
    assert.match(r.stderr, /COVERAGE LOST/);
  });

  test('findings below the gate are PRINTED, not silently dropped', () => {
    // "No silent caps": a gate that hides what it chose not to block reads as
    // full coverage when it is not.
    const r = run(fakeRepo('vis', 5), stub('vis.mjs'));
    assert.match(r.stdout, /below the gate \(reported, not blocking\)/);
    assert.match(r.stdout, /9 findings/);
  });

  test('a COLOURISED summary is still read — the real CI regression', () => {
    // This exact case shipped: the visibility line worked locally and printed
    // "could not read a summary line" on the first real Linux CI run, because
    // zizmor colourises its summary there and the count is no longer at the
    // start of the line once the escape sequence is present.
    const r = run(fakeRepo('ansi', 5), stub('ansi.mjs', { ansi: true }));
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /below the gate \(reported, not blocking\).*9 findings/);
  });

  // 🔴 CORPUS TRIAGE 2026-08-01 (#28). `positional` excluded index `zIdx + 1`
  // unconditionally; with no `--zizmor` flag indexOf returns -1 and -1 + 1 is 0,
  // which is the repoRoot's own index. So the documented no-flag form scanned
  // process.cwd() instead and, run from the repository, reported "9 workflow(s)"
  // for a root holding 2 — a confident, wrong, PASSING answer.
  //
  // This is testable at all only because the coverage check now runs BEFORE the
  // binary check: no zizmor is installed in the guards lane, and against the
  // broken parsing this case reports on the wrong tree (or dies at "not
  // runnable"), never on the two workflows it was handed.
  test('the positional repoRoot is honoured with NO --zizmor flag', () => {
    const root = fakeRepo('argbare', 2);
    const r = spawnSync(process.execPath, [GUARD, root], { encoding: 'utf8' });
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
    assert.equal(r.status, 1, out);
    assert.match(out, /COVERAGE LOST — found 2 workflow\(s\)/, out);
  });

  test('…and both invocation forms reach the same root', () => {
    const root = fakeRepo('argsame', 2);
    const bare = spawnSync(process.execPath, [GUARD, root], { encoding: 'utf8' });
    const flagged = spawnSync(process.execPath, [GUARD, root, '--zizmor', stub('argsame.mjs')], { encoding: 'utf8' });
    const norm = (r) => `${r.stdout ?? ''}${r.stderr ?? ''}`.split('\n').find((l) => l.includes('COVERAGE LOST'));
    assert.equal(norm(bare), norm(flagged));
    assert.match(String(norm(bare)), /found 2 workflow\(s\)/);
  });

  test('when nothing matches, it says what WAS there instead of shrugging', () => {
    const path = join(TMP, 'silent.mjs');
    writeFileSync(
      path,
      `const a=process.argv.slice(2);
if(a.includes('--version')){console.log('stub');process.exit(0)}
const isCanary=a[a.length-1].includes('nikatru-wf-canary-');
console.log(isCanary?'x':'totally unexpected output shape');
process.exit(isCanary?14:0);`,
    );
    const r = run(fakeRepo('silent', 5), path);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /no summary line matched. Last output line was:/);
    assert.match(r.stdout, /totally unexpected output shape/);
  });
});
