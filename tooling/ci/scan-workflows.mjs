#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// scan-workflows.mjs — static analysis of CI's own workflows, proving itself first.
//
// [pipeline F-11] SHA-pinning closed the "a tag is a movable label" hole. It does
// nothing about the other ways a workflow leaks: a `${{ }}` expansion of
// attacker-controlled text into a `run:` block, a `pull_request_target` that
// checks out the PR head, or a permission granted workflow-wide that only one job
// needs. `zizmor` reads for exactly those. `39-CHASSIS` §4 cut 14 keeps only two
// things out of G-47 — SHA-pinning (shipped) and this.
//
// ⚠️ THE SELF-TEST IS THE POINT, same as scan-secrets.mjs. Before scanning the
// real workflows it writes a deliberately vulnerable one to a temp directory and
// asserts zizmor flags it AT THE GATE'S OWN THRESHOLD. Without that, a wrong
// binary, a renamed flag, or a threshold that silently stopped matching would
// report "clean" forever — this repo's single most repeated failure mode.
//
// THRESHOLD: high severity AND high confidence, and that is a deliberate choice
// rather than laziness. The unfiltered run on this repo returns 76 findings, most
// of them low-confidence `cache-poisoning` notes about setup-node's default cache.
// A guard that cries wolf 76 times is a guard somebody switches off — the same
// reasoning recorded in assert-lane-coverage.mjs about the eight Dart packages.
// Everything BELOW the gate is still printed on every run, so nothing is hidden;
// it just does not block. Raise the gate deliberately when the mediums are dealt
// with, and delete this paragraph when you do.
//
// The canary is MULTI-JOB on purpose: zizmor suppresses `excessive-permissions`
// on a single-job workflow, because there workflow-level and job-level scope are
// the same thing. A single-job canary passes clean and the self-test would prove
// nothing — found by trying it.
//
// Usage:  node tooling/ci/scan-workflows.mjs [repoRoot] [--zizmor <path>]
// Exit 0 = clean at the gate, 1 = a finding, a broken scanner, or a failed self-test.
// ─────────────────────────────────────────────────────────────────────────────
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const MIN_SEVERITY = 'high';
const MIN_CONFIDENCE = 'high';
// The real tree carries five workflows. A scan pointed at the wrong directory
// finds nothing and exits 0, which is indistinguishable from a clean repo — so
// the count is asserted before any result is believed. [pipeline F-10]
const MIN_WORKFLOWS = 5;
// zizmor's documented exit code for "audit completed, findings present".
const FINDINGS_EXIT = 14;

const args = process.argv.slice(2);
const zIdx = args.indexOf('--zizmor');
const zizmor = zIdx >= 0 ? args[zIdx + 1] : 'zizmor';
const positional = args.filter((a, i) => !a.startsWith('--') && i !== zIdx + 1);
const repoRoot = positional[0] ?? process.cwd();

/** TESTABILITY SEAM, and the only reason it exists: the behaviour that matters
 *  most is "this wrapper FAILS when the scanner stops detecting", which cannot be
 *  exercised with the real binary — a working zizmor always flags the canary. A
 *  .mjs/.js value is executed with node so tests can substitute a scanner that
 *  finds nothing. Real CI passes a real binary and never takes this branch. */
const asJs = /\.m?js$/.test(zizmor);
const exe = asJs ? process.execPath : zizmor;
const lead = asJs ? [zizmor] : [];

function runZizmor(target, { gated = true } = {}) {
  const thresholds = gated ? ['--min-severity', MIN_SEVERITY, '--min-confidence', MIN_CONFIDENCE] : [];
  return spawnSync(exe, [...lead, '--no-online-audits', '--format', 'plain', ...thresholds, target], {
    encoding: 'utf8',
    cwd: repoRoot,
  });
}

/** A workflow that is wrong in three independent ways: a permission granted
 *  workflow-wide that only one job could need, attacker-controlled text expanded
 *  straight into a shell, and an unpinned action reference. Structural rather
 *  than rule-name-specific, so it survives zizmor's audits being renamed. */
const CANARY = [
  'name: canary',
  'on:',
  '  pull_request_target:',
  'permissions: write-all',
  'jobs:',
  '  a:',
  '    runs-on: ubuntu-24.04',
  '    steps:',
  '      - uses: actions/checkout@v4',
  '        with:',
  '          ref: ${{ github.event.pull_request.head.sha }}',
  '      - run: echo "title is ${{ github.event.pull_request.title }}"',
  '  b:',
  '    runs-on: ubuntu-24.04',
  '    steps:',
  '      - run: echo second job',
].join('\n');

// ── 0. the scanner must exist at all ─────────────────────────────────────────
const version = spawnSync(exe, [...lead, '--version'], { encoding: 'utf8' });
if (version.error || version.status !== 0) {
  console.error(`✗ zizmor not runnable at "${zizmor}" — ${version.error?.message ?? `exit ${version.status}`}`);
  console.error('  Install it in the job, or pass --zizmor <path>.');
  process.exit(1);
}
console.log((version.stdout ?? '').trim());

// ── 1. SELF-TEST: prove the scanner still detects, at the gate's threshold ────
const canaryRoot = mkdtempSync(join(tmpdir(), 'nikatru-wf-canary-'));
const canaryDir = join(canaryRoot, '.github', 'workflows');
try {
  mkdirSync(canaryDir, { recursive: true });
  writeFileSync(join(canaryDir, 'canary.yml'), `${CANARY}\n`);
  const probe = runZizmor(canaryDir);
  if (probe.status === 0) {
    console.error('✗ SELF-TEST FAILED — zizmor did not flag a deliberately vulnerable workflow.');
    console.error(`  At --min-severity ${MIN_SEVERITY} --min-confidence ${MIN_CONFIDENCE} it found nothing in a file that`);
    console.error('  grants write-all across two jobs, checks out a PR head under pull_request_target,');
    console.error('  expands a PR title into a shell, AND uses an unpinned action.');
    console.error('  It would have reported these workflows "clean" while detecting nothing.');
    process.exit(1);
  }
  console.log('ok  self-test — a deliberately vulnerable workflow is still detected');
} finally {
  rmSync(canaryRoot, { recursive: true, force: true });
}

// ── 2. COVERAGE: the scan must actually reach the workflows ──────────────────
const wfDir = join(repoRoot, '.github', 'workflows');
if (!existsSync(wfDir)) {
  console.error(`✗ COVERAGE LOST — ${wfDir} does not exist. zizmor would scan nothing and exit 0.`);
  process.exit(1);
}
const workflows = readdirSync(wfDir).filter((f) => /\.ya?ml$/.test(f));
if (workflows.length < MIN_WORKFLOWS) {
  console.error(`✗ COVERAGE LOST — found ${workflows.length} workflow(s), expected at least ${MIN_WORKFLOWS}.`);
  console.error('  The scan is broken, not the tree. An empty scan reports clean.');
  process.exit(1);
}

// ── 3. VISIBILITY: print everything, including what the gate lets through ────
// "No silent caps" — a gate that hides what it chose not to block reads as full
// coverage when it is not. This pass never fails the build; it only reports.
const full = runZizmor(wfDir, { gated: false });
const summary = `${full.stdout ?? ''}\n${full.stderr ?? ''}`
  .split('\n')
  .map((l) => l.trim())
  .find((l) => /^\d+ findings?\b/.test(l) || /^No findings to report/.test(l));
console.log(`    below the gate (reported, not blocking): ${summary ?? 'could not read a summary line'}`);

// ── 4. THE GATE ──────────────────────────────────────────────────────────────
const gated = runZizmor(wfDir);
if (gated.status === 0) {
  console.log(`ok  workflow static analysis — ${workflows.length} workflow(s), no ${MIN_SEVERITY}-severity/${MIN_CONFIDENCE}-confidence findings`);
  process.exit(0);
}
if (gated.status !== FINDINGS_EXIT) {
  // Fail closed. An unexpected exit code means the scan did not complete, and
  // "I could not tell" must never be reported as "it is fine".
  console.error(`✗ zizmor exited ${gated.status}, which is neither clean (0) nor findings (${FINDINGS_EXIT}).`);
  console.error((gated.stderr ?? '').trim());
  process.exit(1);
}
console.error(`✗ workflow static analysis found ${MIN_SEVERITY}-severity/${MIN_CONFIDENCE}-confidence issue(s):`);
console.error('');
console.error((gated.stdout ?? '').trim());
console.error('');
console.error('  These are CI\'s own workflows, which hold CLOUDFLARE_API_TOKEN and');
console.error('  SUPABASE_SERVICE_ROLE_KEY. Fix them, or justify a `# zizmor: ignore[rule]`');
console.error('  comment in the workflow itself so the exception is visible where it applies.');
process.exit(1);
