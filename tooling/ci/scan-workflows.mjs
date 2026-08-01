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
// THRESHOLD: MEDIUM severity AND high confidence — raised from `high` on
// 2026-07-27, which is the whole point of having started lower.
//
// It began at high/high because the unfiltered run returned 77 findings and a
// guard that cries wolf 77 times is one somebody switches off. All 15 mediums
// were the SAME rule, `artipacked`: every actions/checkout left GITHUB_TOKEN in
// .git/config for the rest of the job, so any step that later packaged the
// workspace would ship the token inside a publicly downloadable artifact. None
// did — verified, every artifact path is a build-output subdirectory — so what
// protected us was that nobody had yet written a broad enough path. A convention,
// not a mechanism.
//
// Fixing all 15 (`persist-credentials: false`; nothing here does git push/tag/
// commit, so none needed the credential) cleared medium to ZERO, which is what
// made raising the gate free. The next one now FAILS THE BUILD instead of joining
// a printed list nobody reads.
//
// Everything below the gate is still printed on every run. What remains is 4
// informational and 2 LOW-confidence cache-poisoning notes about setup-node's
// default cache — deliberately not blocking.
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

const MIN_SEVERITY = 'medium';
const MIN_CONFIDENCE = 'high';
// A scan pointed at the wrong directory finds nothing and exits 0, which is
// indistinguishable from a clean repo — so the count is asserted before any
// result is believed. [pipeline F-10] The tree carried five workflows when this
// was written and carries NINE as of 2026-08-01; the floor deliberately keeps
// headroom below the measurement rather than being re-pinned at reality, which
// is the shape that teaches people to raise floors reflexively. What actually
// anchors "the scan reached the right tree" is that this number is a FLOOR on a
// directory the fixtures can also produce — the real repository's reach is
// additionally proven by assert-workflow-hardening.mjs, which cross-checks the
// scanned set against `git ls-files`.
/** RULES BLOCKED REGARDLESS OF CONFIDENCE.
 *
 *  The severity/confidence gate above is a blunt instrument, and relying on it
 *  alone produced a guard that did not guard. `artipacked` is medium severity but
 *  LOW confidence, so `--min-confidence high` excluded the whole rule: after
 *  fixing all 15 occurrences, REINTRODUCING one still exited 0. The gate would
 *  have looked stricter while catching nothing new — caught by mutating the real
 *  tree rather than trusting the threshold change.
 *
 *  Dropping the confidence floor instead would sweep in `cache-poisoning`, which
 *  there are no honest grounds to dismiss just to make this list tidy. So a rule
 *  that has been cleaned up gets named here and blocks on its own terms.
 *
 *  ADD A RULE HERE ONLY AFTER THE TREE IS CLEAN OF IT — otherwise the build is
 *  red on arrival and the entry gets deleted rather than fixed. */
const BLOCKING_RULES = ['artipacked'];

const MIN_WORKFLOWS = 5;
// zizmor's documented exit code for "audit completed, findings present".
const FINDINGS_EXIT = 14;

const args = process.argv.slice(2);
const zIdx = args.indexOf('--zizmor');
const zizmor = zIdx >= 0 ? args[zIdx + 1] : 'zizmor';
// 🔴 `i !== zIdx + 1` ALONE EATS THE FIRST POSITIONAL WHEN THE FLAG IS ABSENT.
// indexOf returns -1 when `--zizmor` is not passed, and -1 + 1 is 0 — which is
// exactly the index the documented no-flag form `node scan-workflows.mjs
// <repoRoot>` puts repoRoot at. So that form silently fell back to
// process.cwd(): pointed at an empty directory it scanned the repo it happened
// to be standing in, printed "9 workflow(s)" for a root that has 2, and exited
// 0. Not a crash — a confident, wrong, PASSING answer, which is this repo's
// signature failure. Corpus triage 2026-08-01 (#28); scan-secrets.mjs carried
// the identical line. The flag's value index is only excluded when there IS a
// flag. Negative-tested: with the -1 restored, the no-flag case reports on the
// wrong tree again.
const flagValueIdx = zIdx >= 0 ? zIdx + 1 : -1;
const positional = args.filter((a, i) => !a.startsWith('--') && i !== flagValueIdx);
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

// ── 0. COVERAGE: the scan must actually reach the workflows ──────────────────
// MOVED AHEAD OF THE BINARY CHECK on 2026-08-01. "You are not pointed at a
// workflow directory" is the most basic failure here and the only one checkable
// without a scanner at all — which is what makes the argument handling
// negative-testable in a CI job that installs no binary. The corpus-triage
// defect (#28) was exactly that `<repoRoot>` was silently dropped in the no-flag
// form, and nothing could reach far enough into this file to observe it.
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

// ── 1. the scanner must exist at all ─────────────────────────────────────────
const version = spawnSync(exe, [...lead, '--version'], { encoding: 'utf8' });
if (version.error || version.status !== 0) {
  console.error(`✗ zizmor not runnable at "${zizmor}" — ${version.error?.message ?? `exit ${version.status}`}`);
  console.error('  Install it in the job, or pass --zizmor <path>.');
  process.exit(1);
}
console.log((version.stdout ?? '').trim());

// ── 2. SELF-TEST: prove the scanner still detects, at the gate's threshold ────
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

// ── 3. VISIBILITY: print everything, including what the gate lets through ────
// "No silent caps" — a gate that hides what it chose not to block reads as full
// coverage when it is not. This pass never fails the build; it only reports.
const full = runZizmor(wfDir, { gated: false });
// Strip ANSI before matching. This line read "could not read a summary line" on
// the very first real CI run while working locally, because zizmor colourises
// its summary on the Linux runner and the count is not at the start of the line
// once the escape sequence is there. The gate was unaffected — but the header
// promises "nothing is hidden", and a visibility line that quietly stops being
// able to see is the same silent-degradation failure this repo keeps hitting.
const ANSI = /\[[0-9;]*[A-Za-z]/g;
const combined = `${full.stdout ?? ''}\n${full.stderr ?? ''}`.replace(ANSI, '');
const lines = combined.split('\n').map((l) => l.trim()).filter(Boolean);
const summary =
  lines.find((l) => /\b\d+ findings?\b/.test(l)) ?? lines.find((l) => /No findings to report/.test(l));
if (summary) {
  console.log(`    below the gate (reported, not blocking): ${summary}`);
} else {
  // Do not print a bare "could not read" and move on — say what WAS there, so the
  // next person can see why rather than guessing.
  console.log('    below the gate: no summary line matched. Last output line was:');
  console.log(`      ${lines.at(-1) ?? '(no output at all)'}`);
}

// ── 4. THE GATE ──────────────────────────────────────────────────────────────
const gated = runZizmor(wfDir);
if (gated.status === 0) {
  // The threshold gate passed. Now the rules we have explicitly cleaned up, which
  // may sit below it — `full` is the UNGATED pass already run above.
  const fullText = `${full.stdout ?? ''}
${full.stderr ?? ''}`.replace(ANSI, '');
  const reintroduced = BLOCKING_RULES.filter((rule) =>
    new RegExp(`\\[${rule}\\]`).test(fullText),
  );
  if (reintroduced.length) {
    console.error(`✗ a rule this repo has already cleaned up is back: ${reintroduced.join(', ')}`);
    console.error('');
    for (const line of fullText.split('\n')) {
      if (reintroduced.some((r) => line.includes(`[${r}]`)) || /^\s*-->/.test(line)) {
        console.error(`    ${line.trim()}`);
      }
    }
    console.error('');
    console.error('  These are BLOCKING_RULES in this script: below the severity/confidence');
    console.error('  gate, but blocked by name because the tree was made clean of them and');
    console.error('  regressing is a choice, not an accident. Fix it, or remove the rule from');
    console.error('  BLOCKING_RULES with a reason — never widen the threshold to hide it.');
    process.exit(1);
  }
  console.log(`ok  workflow static analysis — ${workflows.length} workflow(s), no ${MIN_SEVERITY}-severity/${MIN_CONFIDENCE}-confidence findings, and none of: ${BLOCKING_RULES.join(', ')}`);
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
