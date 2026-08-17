#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-workflow-hardening.mjs — CI's own inputs are pinned and least-privilege.
//
// `@v4` is a LABEL, not an address. The action's owner can re-point it at
// different code tomorrow and nothing in this repository changes. A 40-character
// SHA is content-addressed: it can only ever be that exact code.
//
// This is not theoretical. The tj-actions/changed-files compromise (March 2025)
// reached ~23,000 repositories by exactly this mechanism — a moved tag. Our
// `e2e.yml` runs nightly, unattended, holding SUPABASE_SERVICE_ROLE_KEY (full
// database access, bypasses RLS) and CLOUDFLARE_API_TOKEN, and it calls a
// third-party action maintained by an individual.
//
// Asserts four things:
//   1. every `uses:` resolves to a 40-hex commit SHA
//   2. every workflow declares an explicit `permissions:` block
//   3. …and that block is not `write-all`. Until 2026-08-01 limb 2 was
//      PRESENCE-ONLY — `/^permissions:/m` — while ci.yml's own step name claimed
//      "SHA-pinned and least-privilege". `permissions: write-all` satisfied a
//      presence test perfectly, so the strictly worst possible block passed the
//      check named after the property it violates. Corpus triage 2026-08-01
//      (#29); mutation-proven on ci.yml before the fix and after it.
//   4. every JOB bounds its own runtime with `timeout-minutes`. A job that omits
//      it inherits GitHub's default of 360 minutes — SIX HOURS — and that
//      default is what an unattended hang costs: `e2e.yml` runs nightly holding
//      SUPABASE_SERVICE_ROLE_KEY and CLOUDFLARE_API_TOKEN, so an unbounded job
//      is a live credentialed runner sitting on a stuck read until morning, and
//      an unbounded REQUIRED job holds every merge behind `ci-gate` for the same
//      six hours. 29 of this tree's 42 jobs were unbounded before this limb
//      landed — re-measured 2026-08-17 against the committed workflows at HEAD:
//      42 jobs, 29 of them with no job-level `timeout-minutes:`. The limb is
//      what stops the next 29.
//
// ⚠️ TRADE-OFF ON RECORD: a pinned action stops receiving updates, including
// security fixes. That is the deliberate exchange — "silently gets new code"
// for "must be updated deliberately". The thing that normally makes it
// sustainable is Renovate raising bump PRs, which is stage 14. Until that
// exists, these pins go stale; that is a known cost, not an oversight.
//
// Pipeline requirement: Private/requirements/ → F-11.
// (Stage 1's prose, pipeline/01-foundation.md, was folded into that JSON spec
// 2026-08-15; the id still resolves against an `origin` field there.)
//
// ⚠️ F-11 IS TWO INVARIANTS AND LIMB 4 IS NEITHER OF THEM — that gap was real for
// a day and is closed rather than narrated. `Private/requirements/invariants.json`
// carries INV-122 (limb 1, SHA pinning) and INV-123 (workflow scanning), and
// until 2026-08-17 NOTHING in the spec stated the runtime bound this file's limb
// 4 enforces: the limb was a rule the guard had invented for itself while the
// header above cited a requirement id for it. INV-124 now states it, names this
// script as its guard, and limb 4 answers to that. A guard enforcing a property
// no requirement declares is unreviewable — nobody can say whether it is right.
//
// Usage:  node tooling/ci/assert-workflow-hardening.mjs [repoRoot]
// Exit 0 = hardened. 1 = a real defect (a movable reference, a missing or
// over-broad permissions block, an unbounded job) or a lost coverage
// relationship. 2 = REFUSED: the scan could not answer the question at all — no
// workflow, no job, a job shape it cannot classify, or two independent counts of
// this tree's job ids that disagree. Those are deliberately DIFFERENT codes: "I
// looked and found nothing wrong" and "I could not look" are the same exit
// status in most guards, and that is precisely how a scan over an empty subject
// comes to read as a pass. EITHER stop first prints every finding the limbs had
// already established — see `printPending`; a stop used to delete them.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { listDir } from './tree-walk.mjs';
import { parseWorkflow, WORKFLOW_DIR } from './workflow-scan.mjs';

const repoRoot = process.argv[2] ?? process.cwd();
/** No argument means CI's own invocation — the real repository, where the git
 *  manifest below MUST be readable. A caller pointing this at a fixture root is
 *  a different, weaker situation and says so out loud. */
const scanningRealRepo = process.argv[2] === undefined;
const wfDir = join(repoRoot, '.github', 'workflows');

/** ⚠️ A FLOOR OF LAST RESORT, and deliberately NOT the thing that protects the
 *  real repository.
 *
 *  🔴 It used to be `MIN_WORKFLOWS = 3` / `MIN_USES = 10` against a tree of NINE
 *  workflows and FIFTY-SEVEN `uses:` references. Corpus triage 2026-08-01 (#29)
 *  moved six of the nine workflows aside — every deploy and every store
 *  submission — and this guard printed `ok  workflow hardening — 3 workflow(s),
 *  30 action(s) all SHA-pinned` and exited 0. Two thirds of CI's attack surface
 *  left the scan without a word, which is the same "coverage silently subtracts"
 *  shape as the 15/4/140 guard-coverage floors and the wrangler floor of 5.
 *
 *  Re-pinning at 9/57 would be the wrong repair: a floor AT reality goes red on
 *  the next honest merge and teaches people to raise floors reflexively. So the
 *  real repository is anchored by two RELATIONSHIPS instead, both computed from
 *  the tree on every run and therefore incapable of going stale:
 *
 *    · SCAN vs MANIFEST — every workflow file `git ls-files` tracks must be one
 *      this scan opened. Directly answers "did my scan reach the tree", which is
 *      the only question a count was ever standing in for.
 *    · USES ACCOUNTING — every `uses:` line found by a loose, independent
 *      matcher must be accounted for by the strict one below. If USES ever stops
 *      matching, the two disagree and this fails, instead of `usesCount` quietly
 *      falling to zero and every action reading as pinned.
 *
 *  This number survives only for roots with no git manifest (the test fixtures),
 *  where neither relationship can be computed. It is a fallback, not the guard. */
const MIN_WORKFLOWS_WITHOUT_MANIFEST = 3;

if (!existsSync(wfDir)) {
  console.error(`✗ no .github/workflows under ${repoRoot}`);
  process.exit(1);
}

const files = listDir(wfDir).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'));

/** `uses:` referencing a repository action. Local (`./…`) and container
 *  (`docker://…`) forms are not tag-pinnable and are deliberately skipped.
 *
 *  ANCHORED TO LINE START ON PURPOSE — that anchor is what stops a commented-out
 *  step (`# - uses: actions/checkout@v4`) being reported as a live violation. An
 *  earlier draft also stripped `#…` from each line "for safety"; that was dead
 *  code, because the anchor already made it impossible to reach, and the test
 *  covering it could not fail. Removed rather than kept — by this repo's own
 *  rule, an assertion that cannot fail is worse than none. The comment case is
 *  still tested; it now exercises the anchor, which is the real protection. */
const USES = /^\s*-?\s*uses:\s*([A-Za-z0-9._-]+\/[A-Za-z0-9._/-]+)@([A-Za-z0-9._-]+)/;

/** THE LOOSE COUNTERPART, and it exists only to disagree with USES. Deliberately
 *  written a different way — no anchor, no shape for the value — so the two
 *  cannot break together. Every `uses:` this sees must end up in exactly one of
 *  the three accounted buckets; anything left over means the strict matcher has
 *  stopped matching something that is really there. */
const ANY_USES = /^\s*-?\s*uses:\s*(\S+)/;
/** Deliberately tolerant of `uses : x` (YAML-legal, and GitHub accepts it) and
 *  of a `uses:` whose value is on the next line — the two shapes ANY_USES cannot
 *  read. Still key-shaped, so prose inside a `run:` block is not miscounted. */
const LOOSE_USES = /^\s*-?\s*uses\s*:/;
/** Local (`./…`) and container (`docker://…`) forms are not tag-pinnable. They
 *  are ACCOUNTED FOR rather than skipped — a skip is invisible, a bucket is not. */
const NOT_PINNABLE = /^(\.{1,2}[/\\]|docker:\/\/)/;

const problems = [];
const notes = [];
let usesCount = 0;
let notPinnable = 0;
let unparsedUses = 0;
let looseSeen = 0;

/** The workflow-level `permissions:` block: either `permissions: <value>` inline
 *  or a mapping of `scope: level` lines under it. Parsed, never grepped — a
 *  presence test is what let `write-all` through. */
function workflowPermissions(text) {
  const lines = text.split('\n');
  const at = lines.findIndex((l) => /^permissions:/.test(l));
  if (at === -1) return null;
  const inline = lines[at].slice('permissions:'.length).replace(/#.*$/, '').trim();
  if (inline !== '') return { inline, scopes: [] };
  const scopes = [];
  for (const l of lines.slice(at + 1)) {
    if (l.trim() === '' || /^\s*#/.test(l)) continue;
    const m = l.match(/^\s+([a-z-]+):\s*([a-z-]+)\s*(#.*)?$/);
    if (!m) break;
    scopes.push([m[1], m[2]]);
  }
  return { inline: null, scopes };
}

for (const f of files) {
  const text = readFileSync(join(wfDir, f), 'utf8');

  // ── limb 2: an explicit block, at the workflow level ──────────────────────
  const perms = workflowPermissions(text);
  if (perms === null) {
    problems.push(`${f} declares no \`permissions:\` — every job runs at the repository-default scope`);
  } else if (perms.inline !== null && perms.inline !== 'read-all' && perms.scopes.length === 0 && perms.inline !== '{}') {
    // an inline value: only `read-all` (and the empty map) are least-privilege.
    problems.push(
      `${f} sets \`permissions: ${perms.inline}\` at the workflow level. ` +
        'Anything other than `read-all`/`{}` handed to every job at once is the opposite of least-privilege, and this step is named after that property.',
    );
  } else {
    for (const [scope, level] of perms.scopes) {
      if (level === 'write') {
        notes.push(`${f} grants \`${scope}: write\` at the WORKFLOW level, so every job in it holds that token. Job-level \`permissions:\` is where a write scope belongs.`);
      }
    }
  }

  // ── limb 3: `write-all` blocks, at ANY level ──────────────────────────────
  // Job-level too: a job that grants itself write-all is exactly the blast
  // radius the workflow-level rule exists to stop, one indent further in.
  text.split('\n').forEach((line, i) => {
    if (/^\s*#/.test(line)) return;
    const m = line.match(/^\s*permissions:\s*write-all\b/);
    if (m) {
      problems.push(
        `${f}:${i + 1} \`permissions: write-all\` grants every scope — contents, packages, id-token, the lot — to code this repo does not own. ` +
          'This is the single worst value the key can take, and a presence-only check accepted it for months.',
      );
    }
  });

  text.split('\n').forEach((line, i) => {
    const nc = /^\s*#/.test(line) ? '' : line.replace(/\s#.*$/, '');
    if (LOOSE_USES.test(nc)) looseSeen++;
    const any = ANY_USES.exec(nc);
    if (!any) return;
    if (NOT_PINNABLE.test(any[1])) {
      notPinnable++;
      return;
    }
    const m = USES.exec(nc);
    if (!m) {
      unparsedUses++;
      problems.push(
        `${f}:${i + 1} \`uses: ${any[1]}\` is a reference this scan cannot parse, so it cannot be proven pinned. ` +
          'An unreadable reference is not a safe one — either it is a repository action (owner/name@ref) or this scan needs teaching.',
      );
      return;
    }
    usesCount++;
    const [, action, ref] = m;
    if (!/^[0-9a-f]{40}$/.test(ref)) {
      problems.push(`${f}:${i + 1} \`${action}@${ref}\` is a movable reference — pin it to a 40-char commit SHA`);
    }
  });
}

// ── limb 4: every job bounds its own runtime ─────────────────────────────────
// PARSED THROUGH THE SHARED READER, NEVER GREPPED. `rg -c timeout-minutes`
// returns the same number whether those lines sit on jobs, on steps, or inside a
// comment explaining that a job has none — so the count it gives back answers a
// different question from the one asked here. This corpus has already paid for
// exactly that mistake once (`grep '"r2_buckets"'` matched the template comment
// explaining why there is no `r2_buckets`; see assert-clone-contract.mjs).
// `parseWorkflow` attributes every line to the job it belongs to and BLANKS
// comments while preserving line numbers, so a commented-out declaration cannot
// satisfy this limb and a reported line still points into the real file.
//
// 🔴 THE ` {4}` ANCHOR IS THE WHOLE CHECK, not a tidiness detail. Job ids sit at
// 2 spaces, a job's own keys at 4, a step's at 6/8. A STEP-level
// `timeout-minutes:` bounds one step and leaves the other forty in the job
// unbounded — it is the single most likely thing to be mistaken for a bounded
// job, and a matcher without the anchor would accept it.
const JOB_TIMEOUT = /^ {4}timeout-minutes:\s*(\S.*?)\s*$/;
const JOB_RUNS_ON = /^ {4}runs-on:/;
/** A declaration that bounds nothing is not a declaration. `timeout-minutes: 0`
 *  and an empty value are both rejected; `${{ matrix.timeout }}` is accepted
 *  because GitHub resolves it before the job starts and this scan cannot. */
const BOUNDED = /^([1-9][0-9]*|\$\{\{.+\}\})$/;

/** 🔴 THE SECOND DERIVATION OF "HOW MANY JOBS ARE IN THIS FILE", AND IT EXISTS
 *  ONLY TO DISAGREE WITH `parseWorkflow` — the same two-derivations doctrine as
 *  ANY_USES above, applied to the number limb 4 reports.
 *
 *  Until 2026-08-17 `jobsChecked` was a printed integer with NO relationship to
 *  anything: a number a reader could compare against yesterday's build log and
 *  nothing else. Demonstrated on the real tree, not argued — quote ONE job id in
 *  ops-watch.yml (`  "digest":`, which is legal YAML resolving to the identical
 *  job GitHub already runs), and `parseWorkflow`'s ` {2}<id>:` matcher stops
 *  seeing it. The guard printed `41 job(s) all bounded` and exited 0. A job left
 *  the scan entirely — unbounded, unread, silently — and the only trace was a
 *  digit nobody diffs. That is the identical shape as the 3-workflow/30-action
 *  pass this file's MIN_WORKFLOWS note describes, one nesting level in.
 *
 *  So the id inventory is derived TWICE, deliberately differently:
 *    · `parseWorkflow` — the shared reader, comment-blanked, bare ids only,
 *      requiring the line to END at the colon.
 *    · the matcher below — a separate read of the raw bytes, its own boundary
 *      logic (`/^jobs\s*:/` rather than an exact-match line), tolerant of quoted
 *      ids, of dots in the id, and of anything trailing the colon.
 *  Neither is "the right one". The point is that a change breaking one is
 *  overwhelmingly unlikely to break the other in the same direction, so the pair
 *  cannot fall silent together — which is the only property a bare count lacked.
 *
 *  ⚠️ THE COMPARISON IS PER FILE, AND THE HONEST REASON IS ATTRIBUTION, NOT
 *  CANCELLATION. As the two are written TODAY the loose matcher accepts a strict
 *  superset of what the reader accepts, so an offsetting pair of errors summing
 *  to zero cannot be constructed — I tried to fixture one and could not, which is
 *  this repo's own test for whether an assertion can fail. What per-file buys is
 *  real all the same: the report NAMES the file, where `41 vs 42` would say only
 *  that a job vanished somewhere; and the superset relation is a property of two
 *  regexes somebody may edit, not a guarantee, so a check that does not lean on
 *  it stays correct after they are edited. */
const JOB_ID_LOOSE = /^ {2}(?:(['"])[^'"]+\1|[A-Za-z_][A-Za-z0-9_.-]*)\s*:/;

/** Job-id lines this file's raw text shows, counted without the shared reader.
 *
 *  🔴 THE COMMENT SKIP COMES BEFORE THE BLOCK-END TEST, and the order is the
 *  whole correctness of this function. A comment written flush at column 0
 *  between two jobs — `# ── deploy lane ──`, ordinary YAML house style — is
 *  `/^\S/`, so testing the block end first ENDS THE SCAN THERE and every job
 *  below it goes uncounted. The shared reader does not have this problem: it
 *  blanks comments to `''` before looking, so a column-0 comment is simply an
 *  empty line to it. Written the wrong way round first and caught by the
 *  per-file test below, which refused on a workflow GitHub runs happily — a
 *  guard that reddens correct input is one that gets switched off. */
function looseJobIds(rel) {
  const raw = readFileSync(join(wfDir, rel), 'utf8').split('\n');
  const at = raw.findIndex((l) => /^jobs\s*:/.test(l));
  if (at === -1) return 0;
  let n = 0;
  for (let i = at + 1; i < raw.length; i++) {
    if (/^\s*#/.test(raw[i])) continue;            // a comment is not a job, at any indent
    if (/^\S/.test(raw[i])) break;                 // the `jobs:` block ended
    if (JOB_ID_LOOSE.test(raw[i].replace(/\s#.*$/, ''))) n++;
  }
  return n;
}

/** 🔴 EVERY STOP PRINTS WHAT WAS ALREADY FOUND, AND THAT IS NOT A COSMETIC
 *  DETAIL. Until 2026-08-17 both stop paths below called `process.exit` with
 *  `problems` still sitting unread in memory — the report block is at the BOTTOM
 *  of this file, so anything that exits earlier throws away every finding the
 *  limbs had already established. Demonstrated, not reasoned about: a fixture
 *  with `actions/checkout@v4` in b.yml (limb 1, a movable reference — the exact
 *  class this whole guard exists for) and a `runs-on`-less job in c.yml printed
 *  ONLY the limb-4 refusal, exit 2, not one word about the unpinned action.
 *
 *  A REFUSAL IS A STATEMENT ABOUT WHAT COULD NOT BE READ. It says nothing about
 *  what WAS read, so it has no business deleting it — least of all here, where
 *  the thing deleted is a live supply-chain finding and the thing printed is a
 *  parse complaint. Worse, the two travel together: the same edit that renames a
 *  job key is the sort of edit that also touches a `uses:` line, so the refusal
 *  arrives exactly when the finding matters most.
 *
 *  The list is printed as INCOMPLETE, because it is: the scan stopped, so the
 *  limbs below the stop never ran and the coverage relationships were never
 *  evaluated. "Here is what I found before I stopped" is a true sentence; "here
 *  is what is wrong with your workflows" would not be. */
function printPending() {
  if (!problems.length) return;
  console.error(`✗ ${problems.length} workflow hardening problem(s) were ALREADY established before this stop:`);
  for (const p of problems) console.error(`    ${p}`);
  console.error('  These stand on their own — the stop below says what could NOT be read, not that these are');
  console.error('  in doubt. The list is INCOMPLETE: the scan stopped, so nothing after this point ran.');
  console.error('');
}

/** Exit 2, and it is a different code from `coverageLost` on purpose — see the
 *  Usage note. A refusal says the SUBJECT could not be read, which is not the
 *  same claim as "a workflow is unhardened" and must not be mistaken for it. */
const refuse = (lines) => {
  printPending();
  console.error(`✗ REFUSING TO REPORT — ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(`  ${l}`);
  process.exit(2);
};

let jobsChecked = 0;
const jobless = [];
const unclassifiable = [];
const jobCountMismatch = [];
let jobIdsSeen = 0;
let looseJobIdsSeen = 0;

for (const f of files) {
  const parsed = parseWorkflow(repoRoot, `${WORKFLOW_DIR}/${f}`);
  // BOTH derivations run on EVERY file, including one that parsed to zero jobs —
  // that case is the loudest disagreement there is (`jobless` alone cannot tell a
  // workflow with no `jobs:` from one whose ids the reader stopped matching), and
  // computing it inside the early-continue below would have skipped exactly it.
  const loose = looseJobIds(f);
  const strict = parsed === null ? 0 : parsed.jobs.size;
  jobIdsSeen += strict;
  looseJobIdsSeen += loose;
  if (strict !== loose) {
    jobCountMismatch.push(
      `${f}: the shared reader found ${strict} job id(s), an independent scan of the same file found ${loose}`,
    );
  }
  if (parsed === null || parsed.jobs.size === 0) {
    // Every GitHub workflow has jobs, so zero is never a fact about the tree —
    // it is `jobs:` renamed, an indent this parse does not read, or a file that
    // is not a workflow at all. Reported as a refusal rather than a pass,
    // because a workflow contributing no jobs contributes no checked jobs and
    // would otherwise subtract itself from this limb without a word.
    jobless.push(f);
    continue;
  }
  for (const job of parsed.jobs.values()) {
    if (!job.lines.some((l) => JOB_RUNS_ON.test(l.text))) {
      // NOT AN EXEMPTION — there is no exemption list here, and there must not
      // be one while every job in the tree is a runner job (42 of 42 measured
      // 2026-08-17). This is the limb saying it cannot classify what it found.
      // The shape it is braced for is a job that DELEGATES to a reusable
      // workflow (`jobs.<id>.uses:`), where GitHub REJECTS `timeout-minutes`
      // outright — demanding one there would be an unsatisfiable red, and
      // silently skipping it would be an unadvertised hole. Refuse, name the
      // job, and let a human decide which of the two it is.
      unclassifiable.push(`${f} job \`${job.name}\` declares no \`runs-on:\``);
      continue;
    }
    jobsChecked++;
    const line = job.lines.find((l) => JOB_TIMEOUT.test(l.text));
    if (!line) {
      problems.push(
        `${f} job \`${job.name}\` declares no \`timeout-minutes:\` — it inherits GitHub's 360-minute default, ` +
          'so a hung step holds a runner (and everything gated behind this job) for six hours.',
      );
      continue;
    }
    const value = line.text.match(JOB_TIMEOUT)[1];
    if (!BOUNDED.test(value)) {
      problems.push(
        `${f}:${line.n} job \`${job.name}\` sets \`timeout-minutes: ${value}\`, which bounds nothing. ` +
          'A positive integer of minutes, or an expression GitHub resolves to one.',
      );
    }
  }
}

if (files.length === 0) {
  refuse([
    `not one workflow file under ${wfDir}.`,
    'Zero workflows is zero jobs is zero findings, and this limb would have printed ok over all of them.',
  ]);
}
// JOB ACCOUNTING — the two derivations, per file. Deliberately BEFORE the
// `jobless` refusal: a file whose ids the reader stopped matching trips both, and
// "0 found where an independent scan finds 9" is the diagnosis, while "parsed to
// zero jobs" is only the symptom.
if (jobCountMismatch.length) {
  refuse([
    `${jobCountMismatch.length} workflow(s) where two independent job-id counts disagree:`,
    ...jobCountMismatch.map((m) => `  · ${m}`),
    `Totals: ${jobIdsSeen} vs ${looseJobIdsSeen} across ${files.length} workflow(s).`,
    'Every job the shared reader misses leaves limb 4 without a word — unbounded, unread, and subtracted',
    'from the count this guard prints, which is the one number a reviewer has. A quoted job id (`  "x":`)',
    'is legal YAML and does exactly that. Until both readings agree, the job total is not a fact.',
  ]);
}
if (jobless.length) {
  refuse([
    `${jobless.length} workflow(s) parsed to ZERO jobs: ${jobless.join(', ')}.`,
    'A workflow with no jobs is not a hardened workflow — it is a parse that stopped reading `jobs:`.',
  ]);
}
if (unclassifiable.length) {
  refuse([
    `${unclassifiable.length} job(s) this limb cannot classify:`,
    ...unclassifiable.map((u) => `  · ${u}`),
    'A runner job must bound itself; a reusable-workflow call cannot carry `timeout-minutes` at all.',
    'Until this scan can tell them apart it is not entitled to report either way.',
  ]);
}
// ⚠️ THERE IS DELIBERATELY NO `if (jobsChecked === 0)` FLOOR HERE, and it was
// written and then deleted rather than left in. It reads like the obvious
// empty-subject guard, but nothing can reach it: a workflow that yields no jobs
// is already `jobless`, a job whose shape cannot be read is already
// `unclassifiable`, and no workflows at all is already the check above — so
// `jobsChecked` can only be 0 after one of the four has exited. An assertion
// nobody can make fail is worse than none, because it inflates apparent
// coverage. The four refusals above each have a recorded failing input.
//
// ⚠️ AND FOR THE SAME REASON THERE IS NO `jobsChecked + unclassifiable.length ===
// jobIdsSeen` ASSERTION. It is arithmetically true by construction of the loop
// and, past the refusal above, `unclassifiable.length` is always 0 — so no input
// exists that makes it fire. The relationship that CAN fail is the per-file one
// between two independent readings, which is the check that was actually added.

// ── coverage self-checks, BEFORE reporting clean ─────────────────────────────
const coverageLost = (lines) => {
  printPending();
  console.error(`✗ COVERAGE LOST — ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(`  ${l}`);
  process.exit(1);
};

// (1) SCAN vs MANIFEST. `git ls-files` is the committed truth about which
//     workflows exist; `files` is what this scan opened. They must agree.
const ls = spawnSync('git', ['-C', repoRoot, 'ls-files', '--', '.github/workflows'], { encoding: 'utf8' });
const tracked =
  ls.status === 0
    ? [...new Set(ls.stdout.split('\n').map((l) => l.trim()).filter((l) => /\.ya?ml$/.test(l)).map((l) => l.split('/').pop()))]
    : [];

if (tracked.length === 0) {
  // No manifest. On the real repository that is itself the failure — the whole
  // anchor is missing and only a fallback number would remain.
  if (scanningRealRepo) {
    coverageLost([
      `\`git ls-files -- .github/workflows\` returned no tracked workflow under ${repoRoot}.`,
      'The manifest that anchors this scan is unreadable, so "did I reach every workflow" cannot be',
      'answered at all — and the fallback floor is a number, which is what got us here.',
    ]);
  }
  if (files.length < MIN_WORKFLOWS_WITHOUT_MANIFEST) {
    coverageLost([
      `scanned ${files.length} workflow(s) under a root with no git manifest; the fallback floor is ${MIN_WORKFLOWS_WITHOUT_MANIFEST}.`,
      'The scan is broken, not the tree.',
    ]);
  }
} else {
  const unscanned = tracked.filter((t) => !files.includes(t));
  if (unscanned.length) {
    coverageLost([
      `git tracks ${tracked.length} workflow(s) and this scan opened ${files.length}; it never saw: ${unscanned.join(', ')}.`,
      'The scan and the committed tree have diverged — a filter that stopped matching, a directory that',
      'moved, or a checkout that did not happen. Every unseen workflow is unpinned and unscoped as far as',
      'this guard knows, and it would have printed ok over them.',
    ]);
  }
}

// (2) USES ACCOUNTING. Two independent matchers must agree on how many `uses:`
//     lines exist. This is what replaces `MIN_USES`: it fails when the strict
//     matcher under-reads, at ANY size of tree, rather than only below a number.
const accounted = usesCount + notPinnable + unparsedUses;
if (looseSeen !== accounted) {
  coverageLost([
    `${looseSeen} \`uses:\` line(s) are present but only ${accounted} were accounted for (${usesCount} pinnable, ${notPinnable} local/container, ${unparsedUses} unreadable).`,
    'The strict `uses:` matcher has stopped seeing references the loose one still finds, so some actions',
    'were never checked for a movable ref — and an unchecked action reads exactly like a pinned one.',
  ]);
}
if (looseSeen === 0) {
  coverageLost([
    `not one \`uses:\` reference in ${files.length} workflow(s).`,
    'A workflow set that calls no action at all means the matcher is dead, not that CI stopped using actions.',
  ]);
}

if (problems.length) {
  console.error(`✗ ${problems.length} workflow hardening problem(s):`);
  for (const p of problems) console.error(`    ${p}`);
  process.exit(1);
}

if (notes.length) {
  console.log('⬜ workflow-level write scopes (reported, not blocking — they are legitimate today):');
  for (const n of notes) console.log(`    ${n}`);
}
console.log(
  `ok  workflow hardening — ${files.length} workflow(s) (${tracked.length ? `all ${tracked.length} git tracks` : 'no git manifest'}), ` +
    `${usesCount} action(s) all SHA-pinned, every \`uses:\` accounted for, all declare permissions and none is write-all, ` +
    `${jobsChecked} job(s) all bounded by \`timeout-minutes\` ` +
    `(two independent job-id counts agree per file, ${jobIdsSeen} = ${looseJobIdsSeen})`,
);
