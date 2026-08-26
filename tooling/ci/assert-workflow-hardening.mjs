#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-workflow-hardening.mjs — CI's own inputs are pinned and least-privilege.
//
// Pipeline requirement: Private/requirements/ → F-11.
// (Stage 1's prose, pipeline/01-foundation.md, was folded into that JSON spec
// 2026-08-15; the id still resolves against an `origin` field there.)
// ⚠️ MOVED TO THE TOP 2026-08-26, and the move is the point. build-enforcement-
// index.mjs reads only the first HEADER_LINES (60) lines, so a CLAIM is a claim
// only while it sits inside that window. Adding limb 6's paragraph to the list
// below pushed this line to 64 and the tree stopped deriving F-11 at all —
// assert-enforcement-index.mjs caught it as a disagreement with the committed
// index. A citation that a later edit can silently evict is not a citation, so
// it now sits above everything that grows. ⛔ The fix is NOT to raise
// HEADER_LINES: that window governs every guard's derivation in this tree, and
// widening it to rescue one file would silently re-derive all of them.
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
// Asserts six things:
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
//   5. …and, WHEN A LIVE WORKFLOW LIST IS SUPPLIED, that GitHub knows about no
//      workflow this scan never opened. See "limb 5" below for the measurement
//      and, just as important, for what it does not catch.
//   6. every GitHub Actions expression outside a `run:` body opens with TWO
//      braces. Added 2026-08-26, and unlike the five above it is not a
//      hypothetical: `.github/workflows/submit-snap.yml:352` read
//      `flutter-version: ${ env.FLUTTER_VERSION }` — ONE brace — while line 142
//      of the same file, the dry-run lane's identical step, read `${{ … }}`.
//      GitHub does not interpolate a single brace, so the Snap Store PUBLISH
//      job asked `subosito/flutter-action` to install a Flutter whose version
//      is the 24-character literal `${ env.FLUTTER_VERSION }`. Nothing in
//      this tree looked at Actions expression syntax, which is how a
//      one-character typo passed review and five days of green CI: limbs 1-5
//      read `uses:`, `permissions:`, `timeout-minutes:` and job ids, and a
//      `with:` value is none of those. See "limb 6" below for why this cannot
//      be a grep and for what it does not catch.
//      ⚠️ AND NO REQUIREMENT ID DECLARES IT YET, said here rather than left for
//      a reader to discover, because limb 4 spent a day in exactly this state
//      and the paragraph below records how that went. `invariants.json` lives in
//      `Private/requirements/`, which is not in this public checkout, so the
//      INV row cannot be written from here — it is the one part of this change
//      that is owed and outstanding, and limb 6 is unreviewable until it exists:
//      nobody can say whether a rule the guard invented for itself is right.
//
// ⚠️ TRADE-OFF ON RECORD: a pinned action stops receiving updates, including
// security fixes. That is the deliberate exchange — "silently gets new code"
// for "must be updated deliberately". The thing that normally makes it
// sustainable is Renovate raising bump PRs, which is stage 14. Until that
// exists, these pins go stale; that is a known cost, not an oversight.
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
// Usage:  node tooling/ci/assert-workflow-hardening.mjs [repoRoot] [--live-workflows=<file>]
//   …where <file> is the body of `gh api repos/OWNER/REPO/actions/workflows`.
//   Without it limbs 1-4 run exactly as before and limb 5 reports NOT CONSULTED.
// Exit 0 = hardened. 1 = a real defect (a movable reference, a missing or
// over-broad permissions block, an unbounded job, a single-brace expression) or
// a lost coverage relationship — including a workflow GitHub holds that this
// checkout does not.
// 2 = REFUSED: the scan could not answer the question at all — no
// workflow, no job, a job shape it cannot classify, two independent counts of
// this tree's job ids that disagree, an unreadable or truncated live list, an
// unrecognised argument, or limb 5's or limb 6's own canaries failing. Those are
// deliberately DIFFERENT codes: "I
// looked and found nothing wrong" and "I could not look" are the same exit
// status in most guards, and that is precisely how a scan over an empty subject
// comes to read as a pass. EITHER stop first prints every finding the limbs had
// already established — see `printPending`; a stop used to delete them.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { listDir } from './tree-walk.mjs';
import { parseWorkflow, joinBlockScalars, WORKFLOW_DIR } from './workflow-scan.mjs';

/** Positionals and flags are separated so `--live-workflows=` (limb 5) can be
 *  passed alongside a fixture root. AN UNKNOWN `--flag` IS A REFUSAL, NOT A
 *  SHRUG: the only thing limb 5 can do wrong is not run, and `--live-workflow=`
 *  (singular, the obvious typo) silently not running is exactly the shape of
 *  hole this guard's own header spends forty lines on. */
const argv = process.argv.slice(2);
const LIVE_FLAG = '--live-workflows=';
const liveArg = argv.find((a) => a.startsWith(LIVE_FLAG))?.slice(LIVE_FLAG.length) ?? null;
const unknownFlags = argv.filter((a) => a.startsWith('-') && !a.startsWith(LIVE_FLAG));
if (unknownFlags.length) {
  console.error(`✗ REFUSING TO REPORT — unrecognised argument(s): ${unknownFlags.join(', ')}.`);
  console.error(`  Usage: node tooling/ci/assert-workflow-hardening.mjs [repoRoot] [${LIVE_FLAG}<file>]`);
  process.exit(2);
}
const positional = argv.filter((a) => !a.startsWith('-'));
const repoRoot = positional[0] ?? process.cwd();
/** No positional argument means CI's own invocation — the real repository, where
 *  the git manifest below MUST be readable. A caller pointing this at a fixture
 *  root is a different, weaker situation and says so out loud.
 *
 *  ⚠️ REWRITTEN 2026-08-21 (it read `process.argv[2] === undefined` before the
 *  flag existed) AND UNCOVERED EITHER WAY, stated because this pass counted the
 *  conditions rather than trusting the count. Pinned to `false` and re-run:
 *  EXIT 0 both directly and as the suite (tests 30 / pass 30 / fail 0), because
 *  every case in guards.test.mjs passes a fixture root, so `scanningRealRepo` is
 *  already false in all thirty. What it would cost is the COVERAGE LOST at the
 *  `git ls-files` branch below: a real-repo run whose manifest went unreadable
 *  would fall through to the fallback floor and print `no git manifest` in the
 *  ok line instead of stopping. Closing it needs the same thing limb 5 needs — a
 *  guards.test.mjs case, run with no positional root.
 *
 *  🔴 CORRECTED 2026-08-22, FOURTH PASS — "UNCOVERED EITHER WAY" WAS FALSE, AND
 *  IT WAS FALSE IN THE DIRECTION THAT MATTERS. The paragraph above measured one
 *  pin and generalised to both. Re-measured, both pins, each against
 *    node --test --test-reporter=tap --test-name-pattern='assert-workflow-hardening' \
 *         tooling/ci/test/guards.test.mjs
 *  in a scratchpad copy, exit code captured on its own line:
 *    · pinned `false` -> SUITE EXIT 0, tests 30 / pass 30 / fail 0  (as above)
 *    · pinned `true`  -> SUITE EXIT 1, tests 30 / pass 20 / FAIL 10
 *  So the `true` direction is ALREADY HELD by the committed suite: the thirty
 *  fixture roots are not the real repository, and claiming one on them makes ten
 *  of them demand a `git ls-files` manifest that a temp dir has not got. Only
 *  the `false` direction is open, and closing it needs the no-positional case
 *  the sentence above names — which is still a guards.test.mjs case, still not
 *  this change's file. The correction is that this is HALF uncovered, not
 *  uncovered, and half is the number a reader would have acted on.
 *
 *  🔴 CLOSED 2026-08-24, FIFTH PASS — THE OTHER HALF IS HELD NOW, and the
 *  premise both paragraphs above rest on ("every case in guards.test.mjs passes
 *  a fixture root") is no longer true of the tree. guards.test.mjs gained
 *  `treats NO positional root as the real repository, where the manifest must
 *  be readable`: it runs this script with cwd set to a three-workflow fixture
 *  and NO arguments, so `scanningRealRepo` is TRUE, `git ls-files` finds no
 *  manifest under a temp dir, and the run must exit 1 saying
 *  `returned no tracked workflow`. Re-measured in a scratchpad copy, exit code
 *  on its own line, against a green baseline of SUITE EXIT 0 / 38 / 38 / 0:
 *    · pinned `false` -> SUITE EXIT 1, tests 38 / pass 37 / FAIL 1
 *      (without it the run falls through to the fallback floor, 3 workflows
 *       clears 3, and a real repository with an unreadable manifest reads clean)
 *    · pinned `true`  -> SUITE EXIT 1, tests 38 / pass 22 / FAIL 16
 *  The same case holds `positional[0] ?? process.cwd()` in the direction the
 *  thirty could not: with the fallback DROPPED, `repoRoot` is `undefined` and
 *  the run dies before it can say `returned no tracked workflow` — SUITE EXIT 1,
 *  38 / 37 / FAIL 1. Pinned to `process.cwd()` it was already held at 38 / 2 /
 *  FAIL 36. */
const scanningRealRepo = positional.length === 0;
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
 *  where neither relationship can be computed. It is a fallback, not the guard.
 *
 *  ⚠️ AND BOTH RELATIONSHIPS DESCRIBE THIS CHECKOUT ONLY — `listDir` and
 *  `git ls-files` are two readings of the same working tree, so neither can see
 *  a workflow that exists on another branch. That is limb 5's subject; it needs
 *  an input from outside and says so on every run. */
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

// ── limb 6: an Actions expression opens with TWO braces ──────────────────────
// 🔴 THE WHOLE DIFFICULTY IS THAT `${VAR}` IS ALSO CORRECT — just in a different
// language. Inside a `run:` body the text is SHELL, where `${deps}`,
// `${RUNNER_TEMP}` and `${GITHUB_SHA::7}` are ordinary parameter expansion;
// outside one it is YAML that GitHub interpolates, and there the only expression
// syntax that exists is `${{ … }}`. Measured on this tree 2026-08-26, over all
// twelve workflows, comments already blanked: SEVENTY lines carry a `${` that is
// not `${{`, and SIXTY-NINE of them are shell inside a `run:` body. A
// `rg '\$\{[^{]'` reddens all seventy — which is the false red that gets a guard
// switched off before it has ever caught anything — and the seventieth was the
// live defect. (After `joinBlockScalars` folds each `run:` body up into its own
// key those sixty-nine become 25 logical lines; the seventy is the raw count, so
// the two numbers are the same measurement read before and after the fold.)
//
// SO THE `run:` BODIES ARE SEPARATED BY THE SHARED READER, NEVER BY A RIVAL
// PARSER. `parseWorkflow` blanks comments (a `${SNAP}` written in prose at
// submit-snap.yml:259 and :456 explains a trap and must not be a finding) while
// PRESERVING line numbers, and `joinBlockScalars` folds `run: |` / `run: >`
// bodies up into the `run:` line they belong to — so after that fold a body line
// is not a line any more, and every line that IS one can be judged by its own
// key. Both come from workflow-scan.mjs for the reason that file's header gives:
// the first thing a second workflow parser gets wrong is WHICH LINES IT CAN SEE,
// and that failure reports "clean".
//
// ⚠️ WHAT THIS LIMB DOES NOT CATCH, stated plainly because an overclaiming check
// is the failure this file was written against:
//   · IT DOES NOT READ INSIDE A `run:` BODY AT ALL. `${{ github.event… }}`
//     interpolated into shell is a real class of defect and a single-brace typo
//     there is indistinguishable from correct shell, so nothing here can decide
//     it. Sixty-nine of this tree's seventy hits live there.
//   · IT IS THE OPENING BRACE ONLY. `${{ env.X }` — the same typo at the closing
//     end — reads as two braces to this limb and passes. Naming it is cheaper
//     than a matcher that would have to balance YAML quoting to be right.
//   · `run:` IS THE ONLY FOREIGN-LANGUAGE KEY IT KNOWS. A `script: |` body
//     (actions/github-script) is JavaScript, where `${x}` is a template literal,
//     and this limb would report it. There is not one in this tree today — the
//     only non-`run:` block scalars are `path:`, `filters:` and `secrets:`,
//     whose bodies are paths and names — so the case is documented rather than
//     coded for, and it would fail LOUDLY on the first one rather than silently.
const SINGLE_BRACE = /\$\{(?!\{)/g;
/** A `run:` line, INCLUDING the folded form `joinBlockScalars` produces (the
 *  `run:` key with its whole body appended) and the inline form `run: echo "$X"`.
 *  Everything past this point is YAML GitHub interpolates. */
const RUN_LINE = /^\s*(?:-\s+)?run:/;

/** PURE, and separated from the file walk for the same reason `orphanWorkflows`
 *  is: the canaries below drive the engine the real scan uses, rather than a
 *  second one written to agree with it. `lines` is `parseWorkflow(...).lines` —
 *  the WHOLE comment-blanked file, header and jobs alike, because `env:` and
 *  `with:` values live in both regions and a single-brace expression is a defect
 *  wherever it sits. Returns the count of lines actually JUDGED, so the caller
 *  can tell "nothing wrong" from "nothing read". */
function expressionDefects(rel, lines) {
  const defects = [];
  let scanned = 0;
  let shellLines = 0;
  for (const l of joinBlockScalars(lines)) {
    if (RUN_LINE.test(l.text)) {
      shellLines++;
      continue;
    }
    scanned++;
    for (const m of l.text.matchAll(SINGLE_BRACE)) {
      // THE LITERAL IS QUOTED BACK, not just the line, because that string is
      // exactly what the step receives. `flutter-version: ${ env.FLUTTER_VERSION }`
      // reads as a near-miss; `the literal text "${ env.FLUTTER_VERSION }"` reads
      // as what actually reached subosito/flutter-action.
      const close = l.text.indexOf('}', m.index);
      const literal = close === -1 ? l.text.slice(m.index).trimEnd() : l.text.slice(m.index, close + 1);
      defects.push(
        `${rel}:${l.n} \`${literal}\` opens with ONE brace. GitHub interpolates \`\${{ … }}\` and nothing else, ` +
          `so this reaches the step as the literal text \`${literal}\` — not as a value. ` +
          'Outside a `run:` body there is no shell to expand it.',
      );
    }
  }
  return { scanned, shellLines, defects };
}

/** THE NEGATIVE HALF, RUN ON EVERY INVOCATION — the same in-file canary pattern
 *  as `liveLimbSelfTest` below, and here for the same reason limb 5 needed it:
 *  the two directions this limb must get right are OPPOSITES, so a break in
 *  either one is silent. A `RUN_LINE` that matches too much swallows the whole
 *  file and certifies it; a `RUN_LINE` that matches too little reddens sixty-nine
 *  correct shell lines. Neither shows up on a tree that is clean.
 *
 *  MEASURED 2026-08-26, one mutation at a time, in a copy of tooling/ci AND
 *  .github/workflows under the scratchpad and never in the repository, each run
 *  twice — this script directly against the copied tree (a fixture root, so the
 *  no-manifest fallback applies), and
 *    node --test --test-reporter=tap --test-name-pattern='assert-workflow-hardening' \
 *         tooling/ci/test/guards.test.mjs
 *  Baselines: EXIT 0, and SUITE EXIT 0 at tests 43 / pass 43 / fail 0. Exit codes
 *  captured on their own line, and the canary list read off the refusal's own
 *  output rather than predicted — the first draft of this table named the wrong
 *  canaries in ALL FOUR rows, which is why the numbers below are read off a run
 *  and not reasoned about.
 *    · `RUN_LINE` -> `/^/` (every line is shell)     -> E1 + E3 fire, EXIT 2;
 *      SUITE EXIT 1, pass 1 / FAIL 42.
 *    · `RUN_LINE` -> `/(?!)/` (no line is shell)     -> E2 + E3 fire, EXIT 2;
 *      SUITE EXIT 1, pass 1 / FAIL 42. Without the canary this is the
 *      sixty-nine-false-red build, and every one of those reds is correct shell.
 *    · `SINGLE_BRACE` -> `/\$\{/g` (the naive grep)  -> E1 + E3 fire, EXIT 2;
 *      SUITE EXIT 1, pass 1 / FAIL 42.
 *    · the `matchAll` loop emptied                   -> E1 + E3 fire, EXIT 2;
 *      SUITE EXIT 1, pass 1 / FAIL 42.
 *    · E1, E2 or E4 alone -> `if (false)`            -> SUITE EXIT 0, 43/43/0.
 *      Recorded rather than hidden: that is the negative half being switched
 *      off, not a subject, and what makes each load-bearing is the row above it.
 *    · E3 alone -> `if (false)`                      -> SUITE EXIT 1, pass 42 /
 *      FAIL 1 — guards.test.mjs's canary-wiring case names E3 by hand, which is
 *      what makes THAT canary the one the suite can speak for.
 *    · the dispatch below -> `if (false)`            -> SUITE EXIT 1, pass 42 /
 *      FAIL 1. All four canaries reach the process through that one line.
 *
 *  AND THE ROW THE OTHERS EXIST FOR, measured the same day against the same
 *  copied tree with limb 6 UNMUTATED and the workflow put back the way it was —
 *  `.github/workflows/submit-snap.yml`'s publish lane returned to
 *  `flutter-version: ${ env.FLUTTER_VERSION }`:
 *    · EXIT 1, `submit-snap.yml:352 \`${ env.FLUTTER_VERSION }\` opens with ONE
 *      brace`. Fixed back: EXIT 0. The limb catches the live defect on the real
 *      bytes, at the real line, and clears the same file once repaired.
 *
 *  ⚠️ AND THE CANARIES CANNOT REACH THE `coverageLost` DISPATCH, which is the
 *  one condition on this limb they do not hold — a canary returns a value, it
 *  cannot take a `process.exit` path. That is limb 5's recorded lesson repeated
 *  rather than rediscovered, and it is why guards.test.mjs carries a case that
 *  copies this file and cuts the `exprWorkflowsScanned++;` line out of it. */
function expressionLimbSelfTest() {
  const failures = [];
  const at = (n, text) => ({ n, text });

  // E1 THE REAL DEFECT, IN THE SHAPE IT WAS FOUND IN. Two `with:` values, the
  // dry-run lane's correct one and the publish lane's broken one, exactly as
  // submit-snap.yml carried them at 142 and 352 until 2026-08-26.
  // ⚠️ The LABEL is synthetic (`canary-expr.yml`), the LINES are real. It named
  // the live workflow until 2026-08-26, which made this generic limb look
  // LANE-BOUND: assert-release-lane-generic.mjs reads STRING LITERALS naming a
  // real workflow, so the canary's own label — not any clause of this limb —
  // was the whole binding, and it failed asking for a `LANE-BOUND:` declaration
  // that would have been FALSE. The limb ranges over every workflow; only the
  // fixture was ever about one. The provenance stays in the comments above,
  // where a literal cannot be mistaken for a binding.
  const e1 = expressionDefects('canary-expr.yml', [
    at(142, '          flutter-version: ${{ env.FLUTTER_VERSION }}'),
    at(352, '          flutter-version: ${ env.FLUTTER_VERSION }'),
  ]);
  if (!(e1.defects.length === 1 && /352/.test(e1.defects[0]) && /\$\{ env\.FLUTTER_VERSION \}/.test(e1.defects[0]))) {
    failures.push(`E1 THE LIVE DEFECT: the single-brace \`with:\` value that shipped to the Snap Store lane was not reported at its line — got ${JSON.stringify(e1.defects)}. This limb exists for that one line and would have printed ok over it.`);
  }

  // E2 SHELL INSIDE A `run:` BODY IS NOT A DEFECT. Both block forms, because
  // `joinBlockScalars` folds them differently (` ` for `>`, ` ; ` for `|`) and a
  // fold that stops working leaves the body lines standing as findings. Sixty-
  // nine lines of this tree look like this; a limb that reddens them is one
  // nobody keeps.
  const e2 = expressionDefects('canary-expr.yml', [
    at(158, '        run: |'),
    at(160, '          echo "installing: ${deps}"'),
    at(162, '          sudo apt-get install -y ${deps}'),
    at(275, '        run: >'),
    at(276, '          project="${RUNNER_TEMP}/snapcraft-subly"'),
    at(300, '        - run: echo "${GITHUB_SHA::7}"'),
  ]);
  if (e2.defects.length !== 0) {
    failures.push(`E2 SHELL IN A run: BODY: legal shell parameter expansion was reported as an Actions defect — got ${JSON.stringify(e2.defects)}. Sixty-nine lines of this tree are exactly this, and a guard that reddens correct input is one that gets switched off.`);
  }

  // E3 THE OVER-FIRING CONTROL'S OPPOSITE — a detector that fires on nothing.
  // A single-brace value OUTSIDE any `run:` must still be found when correct
  // `${{ … }}` sits beside it, which is what separates this from `rg '\$\{'`.
  const e3 = expressionDefects('a.yml', [
    at(1, '  X: ${{ env.A }}'),
    at(2, '  Y: ${ env.B }'),
    at(3, '        run: echo "${Z}"'),
  ]);
  if (!(e3.defects.length === 1 && /a\.yml:2/.test(e3.defects[0]) && e3.scanned === 2 && e3.shellLines === 1)) {
    failures.push(`E3 MIXED FILE: a file holding one correct expression, one broken one and one shell line produced ${JSON.stringify(e3)}. The two braces, the one brace and the run: body must be told apart in the SAME file or this limb reads a different question from the one asked.`);
  }

  // E4 A SCAN THAT READ NOTHING SAYS SO. `scanned` is what the coverage
  // self-check below stands on, and a zero it cannot report is a zero the
  // caller certifies over.
  const e4 = expressionDefects('empty.yml', []);
  if (!(e4.scanned === 0 && e4.shellLines === 0 && e4.defects.length === 0)) {
    failures.push(`E4 EMPTY SUBJECT: an empty line set reported ${JSON.stringify(e4)} instead of scanning nothing. "No defects" over nothing read is the sentence this whole file exists to stop.`);
  }

  return failures;
}

const exprSelfTestFailures = expressionLimbSelfTest();
if (exprSelfTestFailures.length) {
  refuse([
    `limb 6's own canaries failed (${exprSelfTestFailures.length}), so its findings — including "no single-brace expressions" — are worthless:`,
    ...exprSelfTestFailures.map((f) => `  · ${f}`),
    'This is a statement about the detector, not about the tree. Nothing below was compared.',
  ]);
}

let jobsChecked = 0;
let exprWorkflowsScanned = 0;
let exprLinesScanned = 0;
let exprShellLines = 0;
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
  // ── limb 6, over the WHOLE file ────────────────────────────────────────────
  // Deliberately BEFORE the `jobless` continue below, and over `parsed.lines`
  // rather than the per-job arrays: a workflow's `env:` and `with:` blocks are
  // where this defect actually lives, and the header region above `jobs:` is in
  // none of the per-job line sets. A file that parses to zero jobs still gets
  // read here, because "I could not find its jobs" is not a reason to stop
  // looking at its expressions — and that refusal fires below anyway, printing
  // whatever limb 6 already found.
  if (parsed !== null) {
    const expr = expressionDefects(f, parsed.lines);
    exprWorkflowsScanned++;
    exprLinesScanned += expr.scanned;
    exprShellLines += expr.shellLines;
    for (const d of expr.defects) problems.push(d);
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

// (3) EXPRESSION SCAN REACH. Limb 6's whole finding is a NEGATIVE — "no
//     single-brace expression anywhere" — and a negative is worth exactly what
//     the subject behind it is worth. Both counters must be non-zero before that
//     sentence may be printed: zero workflows means the walk never reached a
//     file, zero lines means every line in every file was taken for a `run:`
//     body and judged by nothing.
//
// ⚠️ WHICH DIRECTION IS INPUT-REACHABLE, MEASURED RATHER THAN ASSUMED. A truly
// empty workflow set never arrives here: `files.length === 0` REFUSES at exit 2
// further up, and that stop has its own committed case. So on real input both
// counters are non-zero, and this check fires only when limb 6 itself has
// stopped reading — a `RUN_LINE` that swallows the file, a walk that stops
// incrementing. That is not a reason to leave it out: it is the same shape as
// the `uses:` accounting above, which also cannot fire on a healthy tree, and
// this file's rule is that an assertion needs a failing INPUT, which
// guards.test.mjs supplies by copying this script and cutting the
// `exprWorkflowsScanned++;` line out of the copy. Without it, a limb that
// reached nothing would contribute its silence to the ok line as agreement.
if (exprWorkflowsScanned === 0 || exprLinesScanned === 0) {
  coverageLost([
    `limb 6 judged ${exprLinesScanned} line(s) across ${exprWorkflowsScanned} of ${files.length} workflow(s) — it reached nothing.`,
    'A scan that read no line found no single-brace expression for the same reason an unplugged smoke alarm',
    'reports no fire. Either the walk stopped opening files, or every line was taken for a `run:` body and',
    'judged by nothing at all — and both of those print as agreement in the ok line below.',
  ]);
}

// ── limb 5: SCAN vs THE LIVE WORKFLOW LIST — the orphan blind spot ───────────
// 🔴 CHECK (1) ABOVE ANSWERS "DID I REACH THE TREE", AND THAT IS A SMALLER
// QUESTION THAN "DID I REACH EVERY WORKFLOW GITHUB WILL RUN". Both of its inputs
// — `listDir` and `git ls-files` — describe THIS checkout, so a workflow that
// exists only on some other branch is outside both, and this guard printed ok
// over it while GitHub kept it dispatchable.
//
// MEASURED 2026-08-21, on this tree, in this order:
//   · node tooling/ci/assert-workflow-hardening.mjs -> EXIT 0,
//     "11 workflow(s) (all 11 git tracks), 92 action(s) all SHA-pinned, …
//      43 job(s) all bounded" — a completely clean report.
//   · gh api repos/globalonlinedeveloper/Nikatru_Platform_Public/actions/workflows
//     -> THIRTEEN, every one of them `state: active`.
//   · The two the report never mentioned: `.github/workflows/media-probe.yml`
//     (id 320102035, "media-probe (throwaway)") and
//     `.github/workflows/repro-macos-aot.yml` (id 324571883, "REPRO macOS AOT").
//     `git ls-files -- .github/workflows` does not list either.
//
// LIVE, NOT LATENT — and the distinction is the point. Those two are `active` on
// GitHub TODAY: they can be dispatched, they hold whatever `permissions:` their
// own bytes declare, and not one of limbs 1-4 has ever read a line of them. 11
// of 13 is 85% of the workflow surface, reported as 100%.
//
// ⚠️ WHAT THIS LIMB DOES NOT CATCH, stated plainly because an overclaiming
// coverage check is the exact failure this file was written against:
//   · IT DOES NOT RUN UNLESS IT IS GIVEN THE LIST. `ci.yml` invokes this guard
//     with no arguments and is not part of this change, so on every CI run today
//     limb 5 reports NOT CONSULTED — in the ok line, out loud. That is a bucket,
//     not a gate; the hole is now named on every run instead of being absent.
//   · IT CANNOT DERIVE THE LIST LOCALLY. The obvious alternative — walk
//     `refs/remotes/origin` and union the workflow files — fails twice: 155 refs
//     here made it too slow to run in a gate, and `actions/checkout` fetches a
//     single branch, so in CI those refs do not exist at all.
//   · IT READS NAMES, NOT BYTES. An orphan is reported as EXISTING; whether its
//     actions are pinned, its permissions scoped or its jobs bounded is
//     unanswerable from this checkout, because the file is on another branch.
//   · IT CANNOT SEE A NEVER-RUN ORPHAN. GitHub lists a workflow once it has run
//     or once it is on the default branch; a workflow file sitting on a stale
//     branch that has never run appears in neither the API list nor the tree.
//   · IT DELETES NOTHING. Removing the two probe branches is a write to a remote
//     and is operator work, deliberately not done from here.
//   · IT IS ONE-DIRECTIONAL, AND THIS BULLET IS ADDED 2026-08-21 BECAUSE A
//     REPORT CLAIMED IT WAS ALREADY HERE AND IT WAS NOT. `orphanWorkflows` walks
//     the LIVE list and asks whether the scan saw each entry; it never walks the
//     scan and asks whether GitHub lists it. A workflow file present in THIS
//     checkout that GitHub does not list — the ordinary state of any pull
//     request that adds one — is not reported by this limb at all. Both counts
//     are printed in the ok line so a reader can compare them; nothing fails on
//     the difference. Verified by reading the loop: `live` is the only thing
//     iterated, and `scanned` is only ever a `Set` membership is tested against.
const WF_PREFIX = '.github/workflows/';

/** PURE, and separated from the reading of the list so the self-test below can
 *  drive the same engine the real comparison uses. `live` is the array GitHub
 *  returns under `.workflows`; `scanned` is the basenames this run opened. */
function orphanWorkflows(live, scanned) {
  const seen = new Set(scanned);
  const orphans = [];
  let considered = 0;
  for (const w of live) {
    // `w.path` IS READ DIRECTLY, AND THE FALLBACK THAT USED TO STAND HERE WAS
    // DELETED 2026-08-22. It read `typeof w?.path === 'string' ? w.path : ''`,
    // and an '' fails the prefix test below, so a pathless entry was skipped:
    // not considered, not an orphan, gone. `readLiveList` now REFUSES such a
    // body before this function is ever reached, which leaves the fallback
    // unreachable from the one caller that matters — and by this file's own
    // rule an unreachable fallback is deleted, not kept for safety.
    const path = w.path;
    // GitHub also lists workflows it generates itself, e.g. the Pages builder at
    // `dynamic/pages/pages-build-deployment`. There is no file for those in any
    // branch of any repository, so counting them would manufacture an orphan on
    // the first run — a check that cries wolf is one that gets switched off.
    if (!path.startsWith(WF_PREFIX)) continue;
    considered++;
    const base = path.slice(WF_PREFIX.length);
    if (!seen.has(base)) {
      // 🔴 THE THREE `w?.` CHAINS ARE DELETED 2026-08-24 AND THE THREE `??`
      // FALLBACKS ARE KEPT. They are not one row and they do not have the same
      // answer. `const path = w.path;` above dereferences `w` with NO chain, so
      // a nullish `w` has already thrown by the time this line runs and the
      // short-circuit half of `w?.id` could never once have been taken — the
      // identical unreachable-fallback the `path` ternary was deleted for one
      // pass ago, and this file deletes those rather than keeping them for
      // safety. The `??` halves DO have an input: `readLiveList` refuses only on
      // a non-string `path`, so an entry with a path and no `id` reaches here.
      // C14 below drives all three, and pinning any of them the other way (to
      // the fallback) fires C2/C9. Measured, exit codes in the table on
      // `liveLimbSelfTest`.
      orphans.push({ base, id: w.id ?? null, name: w.name ?? '', state: w.state ?? 'unknown' });
    }
  }
  return { considered, orphans };
}

/** PURE, AND SPLIT OUT OF THE CALLER 2026-08-21 FOR ONE REASON: as inline `if`s
 *  on a `process.exit` path, these three refusals had NOTHING in the committed
 *  tree that could exercise them. Measured, domain stated:
 *  `grep -rn "live-workflows" --exclude-dir=.git --exclude-dir=.bundles .` over
 *  the whole repository returns FOUR hits, every one of them inside this file
 *  (this sentence is one of them) — zero in tooling/ci/test/, zero in
 *  .github/workflows/, zero in docs — so no committed input ever
 *  supplies the flag and every branch behind it was unreachable by the suite.
 *  CORRECTED 2026-08-21, THIRD PASS: that same grep now returns FIVE, not four
 *  — the third pass added exactly one more mention, in the sentence naming what
 *  would close the uncovered dispatch below. Still all five inside this file
 *  (:57, :79, :85, this line, and that one), still zero in tooling/ci/test/,
 *  .github/workflows/ and docs, so the conclusion is unchanged — but the number
 *  is not, and a count in a comment that stops reproducing is how this round's
 *  defects were found.
 *  Each of the three DOES bite when given a bad page — the difference between
 *  an untested check and a decorative one — and returning the refusal instead
 *  of taking it is what lets the canaries below drive all three on EVERY
 *  invocation. Proof, not reasoning: with each one disabled in turn,
 *  guards.test.mjs went from pass 30 / fail 0 to pass 12 / FAIL 18. The three
 *  mutations and their exact results are listed on `liveLimbSelfTest` below.
 *
 *  🔴 CORRECTED 2026-08-22, FOURTH PASS — "THESE THREE REFUSALS" IS NOW FOUR, AND
 *  A COUNT IN A COMMENT IS A CLAIM LIKE ANY OTHER. The paragraphs above are left
 *  as the dated third-pass record; what changed is below them. This function now
 *  holds FOUR refusals — unreadable JSON, no `workflows` array, a page that does
 *  not account for itself, and an entry with no string `path` — because the
 *  fourth was a SKIP inside `orphanWorkflows` until this pass and a skip is how
 *  an orphan leaves a finding without leaving a trace. Six canaries drive them:
 *  C4-C7, C12 and C13. Re-measured, not remembered.
 *
 *  🔴 CORRECTED 2026-08-24, FIFTH PASS — THE GREP ABOVE NO LONGER RETURNS WHAT
 *  IT SAYS, AND THE REASON IS THE GOOD ONE. `grep -rn "live-workflows"
 *  --exclude-dir=.git --exclude-dir=.bundles --exclude-dir=node_modules .` now
 *  returns TWELVE, not five: FIVE still in this file (:57, :79, :85, :673 —
 *  this sentence's own paragraph — and :995), and SEVEN in
 *  tooling/ci/test/guards.test.mjs, which is where every sentence above says
 *  the count had to change before this limb's dispatch could be held. Still
 *  zero in .github/workflows/ and zero in docs. The paragraphs above are left
 *  as the dated third- and fourth-pass record of a tree where the flag had no
 *  caller; that tree no longer exists.
 *  NINE canary calls reach this function now, not six — C4, C5, C6, C7, C12a,
 *  C12b, C13, and C15/C16 added this pass — and the count was taken by
 *  `grep -c "= readLiveList(" ` (10, of which one is `liveVerdict`'s own call),
 *  not remembered.
 *
 *  Returns `{ body }` or `{ refusal: [lines] }` — never both, never neither. */
function readLiveList(label, raw) {
  let body;
  try {
    body = JSON.parse(raw);
  } catch (e) {
    return { refusal: [`${label} is not readable JSON (${e.message}).`, 'Expected the body of `gh api repos/OWNER/REPO/actions/workflows`.'] };
  }
  if (!Array.isArray(body?.workflows)) {
    return { refusal: [`${label} has no \`workflows\` array.`, 'Expected the body of `gh api repos/OWNER/REPO/actions/workflows`, not a filtered projection of it.'] };
  }
  // A TRUNCATED PAGE IS A SHORTER LIST IS FEWER ORPHANS. `total_count` is in the
  // same body, so the truncation can be caught rather than believed.
  //
  // 🔴 CORRECTED 2026-08-22, FOURTH PASS. This read
  // `typeof body.total_count === 'number' && body.total_count !== body.workflows.length`
  // and the `typeof` conjunct made the refusal OPT-IN ON THE VERY FIELD IT
  // REFUSES BY: a body carrying `workflows` and no `total_count` skipped the
  // comparison entirely. That is not a hypothetical shape — dropping
  // `total_count` while keeping `workflows` is exactly what a `--jq` projection
  // does, and C6 below already calls a `--jq` projection "the easy mistake".
  // MEASURED 2026-08-22 against the real 13-entry page with the two orphans
  // (media-probe.yml, repro-macos-aot.yml) removed and the remaining 11 written
  // back three ways, this script run directly, exit code captured on its own
  // line:
  //   · `total_count: 13`      -> EXIT 2, PARTIAL page. Correct.
  //   · `total_count` ABSENT   -> EXIT 0, "11 on GitHub …, 0 of them absent".
  //   · `total_count: '13'`    -> EXIT 0, the same line.
  // Both real orphans vanished and the gate opened — verbatim the answer the
  // sentence above says this limb must never give by accident.
  //
  // THE REPAIR IS A DELETION, NOT A SECOND CONDITION, and that is deliberate.
  // `!==` is strict and `workflows.length` is always a number, so a non-number
  // `total_count` — absent, null, string — already fails this one comparison.
  // A separate `typeof body.total_count !== 'number'` refusal above it would
  // refuse nothing this does not, at the same exit code, differing only in
  // wording: the `existsSync` shape recorded twice below, and this file deletes
  // that shape rather than shipping it. The wording is carried instead by
  // `JSON.stringify`, which prints `undefined` for the absent field and `"13"`
  // for the string, so the message tells the two apart with no branch. C12
  // below pins both shapes; C7 pins the numeric one.
  if (body.total_count !== body.workflows.length) {
    return {
      refusal: [
        `${label} is a PARTIAL page — it reports total_count ${JSON.stringify(body.total_count)} and carries ${body.workflows.length} entr(ies).`,
        'Every workflow past the page boundary would read as absent from GitHub, which is the opposite of the',
        'finding this limb exists for. A page with no numeric `total_count` at all is the same failure with the',
        'evidence removed. Re-fetch the WHOLE body with `?per_page=100`, and without a `--jq` projection.',
      ],
    };
  }
  // 🔴 THE SAME SHAPE ONE FIELD OVER, AND IT WAS FOUND 2026-08-22 BY WALKING
  // THE OTHER FALLBACKS ON THIS LIMB RATHER THAN BY BEING TOLD ABOUT IT. The
  // `total_count` conjunct above let an ABSENT field skip a refusal;
  // `orphanWorkflows` used to do the same with an ABSENT `path`, defaulting it
  // to '' so the entry failed the prefix test and vanished — not considered, not
  // an orphan. MEASURED 2026-08-22 against the real 13-entry page with `path`
  // deleted from the media-probe.yml entry only, this script run directly:
  // EXIT 1 but "GitHub lists 12 workflow(s) … it never saw: repro-macos-aot.yml"
  // — the OTHER real orphan silently subtracted from the finding. And measured
  // the same way with `path` stripped from BOTH orphan entries, against a build
  // carrying the old ternary and no C13: EXIT 0, "11 on GitHub …, 0 of them
  // absent". The gate opens over both, which is the `total_count` false green
  // arriving a second time through a different field.
  // A `--jq` projection is again exactly how a body keeps `workflows` and loses
  // `path`. So an entry that cannot be matched against a file is a REFUSAL here
  // rather than a skip there, and C13 below drives it.
  const pathless = body.workflows.findIndex((w) => typeof w?.path !== 'string');
  if (pathless !== -1) {
    return {
      refusal: [
        `${label} entry ${pathless} of ${body.workflows.length} has no string \`path\` (got ${JSON.stringify(body.workflows[pathless]?.path)}).`,
        'An entry with no path cannot be matched against a file in this checkout, so the comparison would drop',
        'it — one fewer entry considered is one fewer orphan, which is the finding of this limb running backwards.',
        'Fetch the whole body, without a `--jq` projection.',
      ],
    };
  }
  return { body };
}

/** THE TWO STOPS `liveVerdict` MAY ASK FOR, BY NAME, so the choice between them
 *  is data a canary can read rather than a branch nothing in the committed tree
 *  reaches. `refuse` exits 2 (the subject could not be read); `coverageLost`
 *  exits 1 (the subject was read and something is missing from it) — the
 *  distinction the Usage note at the top of this file turns on. */
const LIVE_STOPS = { refuse, coverageLost };

/** PURE, AND SPLIT OUT OF THE CALLER 2026-08-21 IN A THIRD PASS, FOR THE ONE
 *  CONDITION THE SECOND PASS LEFT DECORATIVE. `if (orphans.length)` — the line
 *  that turns "GitHub lists a workflow this scan never opened" into a non-zero
 *  exit — sat on the caller's `process.exit` path, which no committed input can
 *  reach, exactly like the three refusals moved into `readLiveList` above. And
 *  unlike those three it was not even written down as uncovered.
 *
 *  It was the most dangerous of the set: disabling it neither crashes nor
 *  refuses. MEASURED 2026-08-21 with it disabled, against a page carrying two
 *  orphans — EXIT 0, and the ok line printed `13 on GitHub …, 2 of them absent`.
 *  The finding is on the screen and the gate is open, which is the exact shape
 *  of "a green tick over a capability that went dark" this file's header spends
 *  forty lines on.
 *
 *  Composing the whole decision here — read the page, compare it, choose the
 *  stop — puts it under C8-C11 below, which run on EVERY invocation of this
 *  script. What is left at the caller is one dispatch line, and that line is
 *  named in the uncovered list on `liveLimbSelfTest`: moving a hole is not
 *  closing one, and this file may not claim otherwise.
 *
 *  Returns `{ stop, liveLine }`. `stop` is `{ kind, lines }` or absent;
 *  `liveLine` is absent exactly when the page could not be read. `scanned` is
 *  the basenames this run opened. */
function liveVerdict(label, raw, scanned) {
  const parsed = readLiveList(label, raw);
  if (parsed.refusal) return { stop: { kind: 'refuse', lines: parsed.refusal } };
  const { considered, orphans } = orphanWorkflows(parsed.body.workflows, scanned);
  const liveLine = `live workflow list consulted — ${considered} on GitHub under ${WF_PREFIX}, ${orphans.length} of them absent from this checkout`;
  // EVERY ORPHAN BLOCKS, WHATEVER ITS `state`. A first draft failed only on
  // `state: 'active'` and filed the rest as a note; all 13 entries measured
  // 2026-08-21 are active, so that branch had no input in the world and could
  // not be exercised — and its premise was wrong anyway, since `disabled` is one
  // click from active and is unscanned either way. The state is PRINTED, so a
  // reader can still tell the two apart; it just does not change the verdict.
  if (orphans.length) {
    return {
      stop: {
        kind: 'coverageLost',
        lines: [
          `GitHub lists ${considered} workflow(s) under ${WF_PREFIX} and this scan opened ${scanned.length}; it never saw: ${orphans.map((o) => `${o.base} (id ${o.id}, "${o.name}", state \`${o.state}\`)`).join(', ')}.`,
          'GitHub will run these — dispatchable, schedulable, holding whatever permissions their own bytes',
          'declare — and no limb above has read one line of them, because they are not in this checkout. They',
          'live on branches; deleting those branches is the repair, and it is a write to the remote.',
        ],
      },
      liveLine,
    };
  }
  return { liveLine };
}

/** THE NEGATIVE HALF, RUN ON EVERY INVOCATION — the same in-file canary pattern
 *  as `assert-copy-parity.mjs`'s self-test, and here for a specific reason: the
 *  comparison this limb performs needs an input CI does not supply today, so
 *  without these canaries the detector would ship with nothing ever exercising
 *  its failing path. They run against every root this guard is ever pointed at,
 *  fixtures included — guards.test.mjs alone invokes this script THIRTY-SEVEN
 *  times (`grep -c "run('assert-workflow-hardening.mjs'"` -> 37, re-measured
 *  2026-08-24 after the last edit of BOTH files; it read THIRTY below until this
 *  pass added seven live-list cases, and a count in prose that stops reproducing
 *  is how three of this file's defects were found) — the older wording and its
 *  own measurement are kept verbatim on the next two lines as the dated record:
 *  guards.test.mjs alone invokes this script THIRTY times
 *  (`grep -c "run('assert-workflow-hardening.mjs'" tooling/ci/test/guards.test.mjs`
 *  -> 30, re-measured 2026-08-21 after the last edit of this file) —
 *  so a canary failure turns that file red many times over.
 *
 *  ⚠️ EXACTLY WHAT THAT COVERS, AND WHAT IT DOES NOT, corrected 2026-08-21. An
 *  earlier wording here said "any condition below", an unscoped absolute of the
 *  kind this corpus keeps being caught by. MEASURED INSTEAD, one mutation at a
 *  time, each against
 *    node --test --test-name-pattern='assert-workflow-hardening' \
 *         tooling/ci/test/guards.test.mjs
 *  whose green baseline that day was tests 30, pass 30, fail 0, EXIT 0:
 *    · non-JSON refusal neutered            -> C5 fires, pass 12 / FAIL 18, EXIT 1
 *    · `workflows`-array test -> `if (false)` -> pass 12 / FAIL 18, EXIT 1
 *    · truncated-page test  -> `if (false)`   -> C7 fires, pass 12 / FAIL 18
 *    · `readLiveList` forced to refuse EVERY input -> C4 fires, pass 12 / FAIL 18
 *  (C1-C3, over `orphanWorkflows`, were measured the same way when they landed.)
 *
 *  THREE conditions on this limb still have NO committed negative half. They are
 *  named, with what disabling each one actually costs, measured the same day by
 *  running this script directly rather than reasoned about:
 *    · `if (parsed.refusal)` below, disabled, given a non-JSON page -> uncaught
 *      TypeError, EXIT 1. Loud. It cannot produce a false "zero orphans".
 *    · the `readFileSync` catch below, disabled, given a missing file -> still
 *      REFUSES, EXIT 2, because `JSON.parse(undefined)` lands on C5's refusal
 *      instead. Same exit, different wording — which is the `existsSync`
 *      argument recorded below, arriving a second time.
 *    · 🔴 the unknown-flag refusal at the TOP of this file, disabled, given
 *      `--live-workflow=` (the singular typo it exists for) -> EXIT 0 printing
 *      "live workflow list NOT CONSULTED". That one IS a silent false green, and
 *      it is the only uncovered condition on this limb that is. Closing it wants
 *      a guards.test.mjs case, a file this change does not own.
 *      [SUPERSEDED 2026-08-24 — that case exists; see THE COUNT IS NOW ZERO at
 *      the foot of this comment. The bullet is kept as the dated record.]
 *
 *  APPENDED 2026-08-21, SAME SESSION, THIRD PASS — THAT LIST WAS SHORT, AND THE
 *  CONDITION IT OMITTED WAS THE WORST ONE. Re-derived by walking every `if` on
 *  this limb rather than from recollection: SIX conditions had no committed
 *  negative half, not three, and the missing entry was `if (orphans.length)` —
 *  the line that decides whether an orphan is a FINDING or a printed remark.
 *  That one is now covered: it moved into `liveVerdict` and C8/C9 drive both of
 *  its directions.
 *  `if (parsed.refusal)` moved with it and is covered too, which retires the
 *  first bullet of the three-item list above. IT ALSO RETIRES THAT LIST'S
 *  CLOSING CLAIM — "it is the only uncovered condition on this limb that is" a
 *  silent false green. THREE of the five below are, measured one at a time; the
 *  sentence was true of the three conditions that list knew about and false of
 *  the set, and correcting one line while its contradiction survives further
 *  down the same file is the defect this pass exists to stop repeating.
 *
 *  RE-MEASURED AFTER THAT MOVE, one mutation at a time, in a copy of tooling/ci
 *  under the scratchpad and never in the repository — each mutation run twice,
 *  once as this script directly and once as the suite above, exit codes captured
 *  on their own line. Baseline both ways: EXIT 0, and tests 30 / pass 30 /
 *  fail 0.
 *    · `if (orphans.length)` -> `if (false)`  -> C9+C11 fire,     pass 12/FAIL 18
 *    · `if (orphans.length)` -> `if (true)`   -> C8 fires,        pass 12/FAIL 18
 *    · `kind: 'coverageLost'` -> a typo       -> C9+C11 fire,     pass 12/FAIL 18
 *    · `if (parsed.refusal)` -> `if (false)`  -> the canary's own call throws a
 *      TypeError, EXIT 1,                                        pass 12/FAIL 18
 *      — red by crash rather than by message, which is still red.
 *  And the second pass's FOUR rows re-run rather than inherited, all four still
 *  EXIT 1 at pass 12 / FAIL 18: the JSON catch (C5+C10+C11 fire), the
 *  `workflows`-array test (a TypeError one line further down, before C6 can be
 *  reached — C6 is what holds that refusal's WORDING, not its existence), the
 *  truncated-page test (C7), and `readLiveList` forced to refuse EVERY input
 *  (C4 through C9 all fire). The C1-C3 rows re-run too: the prefix filter (C3),
 *  and the membership test both ways — `if (false)` trips C2+C9+C11, `if (true)`
 *  trips C1+C2+C3+C8+C9 — at the same counts.
 *
 *  AND THE FIELDS THE FINDING IS MADE OF, each pinned to its fallback one at a
 *  time in the same harness: `path` -> '' (C1+C2+C3+C9+C11), `state` ->
 *  'unknown' (C2+C9), `name` -> '' (C9), `id` -> null (C9). All four EXIT 2 at
 *  pass 12 / FAIL 18. The last of them fires ONLY because C9 was strengthened
 *  this pass to pin the whole `base (id N, "name", state s)` triple: under the
 *  earlier base-name-only regex, `id: null` survived every canary at EXIT 0 —
 *  a decoration on the one line an operator actually acts on.
 *
 *  APPENDED 2026-08-22, FOURTH PASS — ONE CONDITION ON THIS LIMB WAS A SILENT
 *  FALSE GREEN AND NO PASS ABOVE HAD EVER MUTATED IT. The accounting refusal in
 *  `readLiveList` carried a `typeof body.total_count === 'number' &&` conjunct,
 *  which made it opt-in on the very field it refuses by; the deletion, the three
 *  real-page measurements behind it, and why the repair is a deletion rather
 *  than a second condition are all recorded on that function. Every row below
 *  was re-run this pass — none inherited — in a copy of tooling/ci under the
 *  scratchpad and never in the repository, one mutation at a time, against
 *    node --test --test-reporter=tap --test-name-pattern='assert-workflow-hardening' \
 *         tooling/ci/test/guards.test.mjs
 *  whose green baseline is SUITE EXIT 0, tests 30 / pass 30 / fail 0.
 *  THE NEW ROWS:
 *    · the accounting comparison -> `if (false)` -> C7 + C12a + C12b fire,
 *      SUITE EXIT 1, pass 12 / FAIL 18.
 *    · 🔴 the `typeof` conjunct RESTORED — the regression this pass removed,
 *      run as a mutation like any other -> C12a + C12b fire and C7 DOES NOT,
 *      SUITE EXIT 1, pass 12 / FAIL 18. That row is the entire reason C12 is
 *      not a second canary on C7's condition: C7's page reports 13 and carries
 *      2, a number either way, so the conjunct is invisible to it and the
 *      defect could come back under a green C7.
 *    · C12a -> `if (false)`, and C12b -> `if (false)`, each alone -> SUITE EXIT
 *      0, pass 30 / fail 0. Recorded rather than hidden: that is the negative
 *      half being switched off, not a subject, and what makes each load-bearing
 *      is the two rows above, where the subject is broken and the canary fires.
 *  AND EVERY OLDER ROW ON THIS LIMB WAS RE-RUN, not carried forward, each at
 *  SUITE EXIT 1 / tests 30 / pass 12 / FAIL 18: the prefix filter, the
 *  membership test both ways, the `id` / `name` / `state` fallbacks pinned, the
 *  JSON catch neutered, the `workflows`-array test, `if (parsed.refusal)`,
 *  `if (orphans.length)` both ways, and the `coverageLost` kind mistyped.
 *
 *  🔴 AND ONE MORE OF THE SAME DEFECT WAS FOUND BY LOOKING FOR IT RATHER THAN
 *  BY BEING TOLD. The review named the `total_count` conjunct. Walking the other
 *  defaulted fields on this limb found the identical shape one field over: the
 *  `path` ternary in `orphanWorkflows` turned an entry with NO `path` into '',
 *  which fails the prefix test, so the entry was skipped — not considered, not
 *  an orphan. Measured against the real page with `path` deleted from the
 *  media-probe.yml entry: EXIT 1 naming only repro-macos-aot.yml, the OTHER
 *  real orphan subtracted in silence. That ternary is DELETED, the case is a
 *  refusal in `readLiveList`, and C13 drives it:
 *    · `if (pathless !== -1)` -> `if (false)` -> C13 fires, SUITE EXIT 1,
 *      pass 12 / FAIL 18.
 *    · C13 -> `if (false)` alone -> SUITE EXIT 0, pass 30 / fail 0 — the
 *      negative half switched off, recorded for the same reason C12's row is.
 *  ⚠️ THIS RETIRES ONE ROW OF THE THIRD PASS'S FIELD LIST ABOVE: `path` -> ''
 *  (C1+C2+C3+C9+C11) no longer exists as a mutation, because the fallback it
 *  mutated is gone. The other three rows of that list — `state`, `name`, `id` —
 *  were re-run this pass and still hold. The dated text is left as written.
 *
 *  THE CANARIES' OWN `if`s ARE NOT IN THAT LIST BY DESIGN: they are the negative
 *  half, not a subject. What proves each one load-bearing is the mutation above
 *  that makes it fire. Several mutations trip more than one canary — that is
 *  recorded in the rows rather than tidied away, and it is why C1 is described
 *  further down as a stated control rather than an independent assertion.
 *
 *  FIVE CONDITIONS ON THIS LIMB STILL HAVE NO COMMITTED NEGATIVE HALF. All five
 *  are DISPATCH — the TAKING of a decision rather than the making of one — and
 *  each was measured with the condition disabled, against the real 13-entry
 *  `gh api` page, with the suite confirmed still at tests 30 / pass 30 / fail 0:
 *    · 🔴 `if (unknownFlags.length)` at the TOP of this file, given
 *      `--live-workflow=` (the singular typo it exists for) -> EXIT 0, "limb 5 —
 *      live workflow list NOT CONSULTED". A SILENT FALSE GREEN.
 *    · 🔴 `if (liveArg === null)` forced to the NOT-CONSULTED branch, given the
 *      same page under the CORRECT flag -> EXIT 0, "NOT CONSULTED". Silent.
 *    · 🔴 `if (verdict.stop)` below -> `if (false)`, same page -> EXIT 0 with
 *      "13 on GitHub …, 2 of them absent" printed in the ok block. Both real
 *      orphans named on screen, and the gate open. Silent.
 *    · `if (selfTestFailures.length)` -> `if (false)`, with C3's subject broken
 *      as well -> EXIT 0. Every canary above becomes decoration — this file's
 *      own doctrine turned on itself.
 *    · the `readFileSync` catch below, given a missing file -> still REFUSES,
 *      EXIT 2, because `JSON.parse(undefined)` lands on C5's refusal instead
 *      (`… is not readable JSON ("undefined" is not valid JSON)`). Same exit,
 *      different wording — the `existsSync` argument, arriving a third time.
 *  ONE THING CLOSES ALL FIVE: guards.test.mjs cases that invoke this script with
 *  `--live-workflows=<fixture>` and with a mistyped flag. That file is not owned
 *  by this change, and saying so is the only honest place to stop.
 *  [SUPERSEDED 2026-08-24 — those cases were written; see THE COUNT IS NOW ZERO
 *  below. Kept as the dated record of where the fourth pass stopped.]
 *
 *  RE-MEASURED 2026-08-22, FOURTH PASS, AND THE COUNT IS STILL FIVE — checked
 *  because this pass added a canary and a comment that adds one is how a count
 *  in prose stops reproducing. The condition the fourth pass repaired did NOT
 *  join this list: it lives inside `readLiveList`, where C12 reaches it on every
 *  invocation. All five above were re-run with the suite confirmed still at
 *  tests 30 / pass 30 / fail 0, and the three marked SILENT are still silent.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  🔴 THE COUNT IS NOW ZERO. 2026-08-24, FIFTH PASS — THE LIST ABOVE IS CLOSED,
 *  AND IT WAS CLOSED BY THE ONE THING IT SAID WOULD CLOSE IT. Every paragraph
 *  above is left exactly as written, as the dated record of the tree it
 *  described; what follows replaces its conclusion, not its history.
 *
 *  `tooling/ci/test/guards.test.mjs` gained a `limb 5 — the live workflow list`
 *  block: eight cases that invoke this script through the flag rather than
 *  around it. `grep -c "run('assert-workflow-hardening.mjs'"` -> 37 (was 30),
 *  and the suite over this describe is tests 38 / pass 38 / fail 0, SUITE EXIT
 *  0, re-measured after the last edit of both files.
 *
 *  EVERY ROW OF THE FIVE, RE-RUN AS A MUTATION AGAINST THAT SUITE in a copy of
 *  tooling/ci under the scratchpad and never in the repository, one at a time,
 *  `node --check`-clean, each anchor required to match exactly once, exit code
 *  captured on its own line. Green baseline both ways: EXIT 0, 38/38/0.
 *    · `if (unknownFlags.length)` -> `if (false)`  SUITE EXIT 1, pass 37 / FAIL 1
 *      (the mistyped-flag case; it was EXIT 0 / 30 / 30 / 0 before this pass)
 *    · `if (liveArg === null)` -> `if (true)`      SUITE EXIT 1, pass 33 / FAIL 5
 *      …and -> `if (false)`                        SUITE EXIT 1, pass 19 / FAIL 19
 *    · `if (verdict.stop)` -> `if (false)`         SUITE EXIT 1, pass 36 / FAIL 2
 *    · `if (selfTestFailures.length)` -> `if (false)`
 *                                                  SUITE EXIT 1, pass 37 / FAIL 1
 *    · the `readFileSync` catch neutered           SUITE EXIT 1, pass 37 / FAIL 1
 *  All five were SUITE EXIT 0 / 30 / 30 / 0 on the same mutations before this
 *  pass — measured, not inferred: the fourth-pass sweep is in the same harness.
 *
 *  ⚠️ THE FOURTH ONE NEEDED A DIFFERENT KIND OF CASE AND IS WORTH NAMING. Every
 *  canary in this function reaches the process through that single
 *  `if (selfTestFailures.length)`, so disabling it turns all sixteen into
 *  decoration and no ordinary case could tell. The case that holds it copies
 *  THIS FILE and its two local imports into a temp dir, turns limb 5's prefix
 *  filter — the line C3 holds, `orphanWorkflows`' early `continue` — into
 *  `if (false)` in the copy, and asserts the copy exits 2 naming C3, with an
 *  unmutated copy run first as the control so a broken copy mechanism cannot
 *  make it pass. The repository is never mutated; the copy is built under the
 *  test's own temp root.
 *  ⚠️ AND IT FINDS THAT LINE THROUGH `stripSourceComments`, NOT THROUGH A RAW
 *  SUBSTRING SEARCH, WHICH IS A DEFECT THIS FILE CAUSED AND MEASURED RATHER THAN
 *  FORESAW. The first draft asserted the anchor appeared exactly once in the
 *  bytes; the moment the paragraph above quoted the line it mutates, the count
 *  became 2 and the case went red — SUITE EXIT 1, tests 384 / pass 383 / FAIL 1,
 *  over the whole of guards.test.mjs. That is the loud failure the assertion was
 *  written to produce, and the repair is that a QUOTATION IS NOT A SUBJECT: the
 *  count and the offset are taken from the comment-blanked copy, the cut is made
 *  in the real bytes at that same offset (the blanker preserves them), and this
 *  paragraph may therefore say the line out loud. 384 / 384 / 0 after.
 *
 *  AND THE ARGUMENT VECTOR IS HELD TOO, which no pass before this one claimed.
 *  Same harness, same baseline: the `find` predicate pinned false -> 33/FAIL 5;
 *  dropping either conjunct of `unknownFlags` -> FAIL 5 and FAIL 37; the
 *  `positional` predicate pinned true -> FAIL 1 (the case that passes the flag
 *  BEFORE the root) and pinned false -> FAIL 36; `positional[0] ?? process.cwd()`
 *  pinned to cwd -> FAIL 36 and with the fallback dropped -> FAIL 1;
 *  `positional.length === 0` pinned false -> FAIL 1 (the no-positional case) and
 *  pinned true -> FAIL 16.
 *
 *  WHAT IS STILL NOT HELD, so the list does not silently become an absolute:
 *  the canaries' OWN `if`s. C14, C15 and C16 each set to `if (false)` alone ->
 *  SUITE EXIT 0, 38/38/0, exactly as recorded for C12 and C13 above. That is the
 *  negative half being switched off, not a subject going unguarded; what makes
 *  each load-bearing is the subject mutation above that fires it. */
function liveLimbSelfTest() {
  const failures = [];
  const scanned = ['a.yml', 'b.yml'];
  const agreeing = [
    { id: 1, name: 'A', path: `${WF_PREFIX}a.yml`, state: 'active' },
    { id: 2, name: 'B', path: `${WF_PREFIX}b.yml`, state: 'active' },
  ];

  // C1 AGREEMENT -> zero orphans. A detector that fires on everything is as
  // useless as one that fires on nothing, and it is the easier mistake to ship.
  // ⚠️ STATED HONESTLY: C1 OVERLAPS C2 AND C3 AND I COULD NOT BUILD AN INPUT IT
  // ALONE CATCHES. Every break of `orphanWorkflows` that makes C1 fire — the
  // membership test inverted, the push unguarded — trips one of the other two as
  // well; measured by mutating this function six ways 2026-08-21. It is kept as
  // a stated control on over-firing, not sold as an independent assertion.
  const c1 = orphanWorkflows(agreeing, scanned);
  if (!(c1.considered === 2 && c1.orphans.length === 0)) {
    failures.push(`C1 AGREEMENT: a live list identical to the scan produced ${c1.orphans.length} orphan(s) over ${c1.considered} considered — the detector fires on correct input.`);
  }

  // C2 ONE EXTRA -> exactly that one, named, with its state. This is the literal
  // shape measured on this repository 2026-08-21.
  const c2 = orphanWorkflows(
    [...agreeing, { id: 320102035, name: 'media-probe (throwaway)', path: `${WF_PREFIX}media-probe.yml`, state: 'active' }],
    scanned,
  );
  if (!(c2.orphans.length === 1 && c2.orphans[0].base === 'media-probe.yml' && c2.orphans[0].state === 'active')) {
    failures.push(`C2 ONE EXTRA: a live workflow absent from the scan was NOT reported — got ${JSON.stringify(c2.orphans)}. The detector has stopped detecting.`);
  }

  // C3 A NON-WORKFLOW PATH -> neither considered nor an orphan. Guards the
  // prefix filter in both directions at once.
  const c3 = orphanWorkflows(
    [...agreeing, { id: 9, name: 'pages build and deployment', path: 'dynamic/pages/pages-build-deployment', state: 'active' }],
    scanned,
  );
  if (!(c3.considered === 2 && c3.orphans.length === 0)) {
    failures.push(`C3 NON-WORKFLOW PATH: a GitHub-generated entry outside ${WF_PREFIX} was counted — ${c3.considered} considered, ${c3.orphans.length} orphan(s). Every repo would report a false orphan.`);
  }

  // C14 AN ORPHAN CARRYING NOTHING BUT A `path` -> still reported, and the three
  // `??` fallbacks are what keep the operator's line readable. ADDED 2026-08-24
  // in the same edit that deleted the three `w?.` chains beside them: the CHAINS
  // were unreachable (a nullish `w` throws on `w.path` eleven lines earlier), the
  // FALLBACKS are not — GitHub sends id/name/state on every entry, a `--jq`
  // projection need not, and `readLiveList` refuses only on a non-string `path`.
  // Without them the one line an operator acts on reads
  // `ghost.yml (id undefined, "undefined", state \`undefined\`)`, so the three
  // literals are the assertion, not the orphan count.
  const c14 = orphanWorkflows([{ path: `${WF_PREFIX}ghost.yml` }], scanned);
  if (!(c14.orphans.length === 1 && c14.orphans[0].id === null && c14.orphans[0].name === '' && c14.orphans[0].state === 'unknown')) {
    failures.push(`C14 SPARSE ORPHAN: an entry with a \`path\` and no id/name/state produced ${JSON.stringify(c14.orphans)}. The finding line an operator pastes into \`gh api\` is built out of those three fields, and an absent one must read as null/""/unknown rather than as \`undefined\`.`);
  }
  // C4-C7, C12 AND C13 DRIVE `readLiveList` — the refusals that decide whether
  // "zero orphans" is a finding or an accident, plus the control that stops it
  // refusing everything. (This line read "C4-C6" until 2026-08-21, third pass:
  // FOUR canaries call `readLiveList`, and C7 is one of them. Corrected rather
  // than left, because a range in a comment is a claim like any other.
  // CORRECTED AGAIN 2026-08-22, FOURTH PASS: SIX canaries call it now, and it
  // holds FOUR refusals, not three. C12 (below C7) holds the accounting
  // refusal's reach over a page with no numeric `total_count` at all; C13 holds
  // the fourth refusal, which is new this pass — an entry with no `path` used to
  // be silently skipped by `orphanWorkflows` instead. Both numbers in the lead
  // line were re-derived by counting the calls, not remembered.
  // CORRECTED A THIRD TIME 2026-08-24, FIFTH PASS: NINE canary calls reach
  // `readLiveList` — C4, C5, C6, C7, C12a, C12b, C13, and C15/C16 added this
  // pass for the two optional chains nothing drove. It still holds FOUR
  // refusals. Counted with `grep -c "= readLiveList("` -> 10, one of which is
  // `liveVerdict`'s own call.) They are here AND ALSO in a test file now: the
  // flag that reaches the dispatch has eight callers in guards.test.mjs since
  // this pass, and the canaries keep holding the pure engine behind it, which
  // is a different job — see the note on `readLiveList` and the closing block
  // on `liveLimbSelfTest`.
  const goodPage = JSON.stringify({ total_count: 2, workflows: agreeing });

  // C4 A WELL-FORMED PAGE -> no refusal, and the array comes back intact. The
  // over-firing control for the three below: a reader that refuses everything
  // reports zero orphans on nothing, which is the same silence by another route.
  const c4 = readLiveList('good.json', goodPage);
  if (c4.refusal || c4.body?.workflows?.length !== 2) {
    failures.push(`C4 WELL-FORMED PAGE: a valid \`gh api\` body was REFUSED (${JSON.stringify(c4.refusal ?? null)}). The limb would refuse on every correct input.`);
  }

  // C5 NOT JSON -> refused, naming JSON. `gh` writing an error page or half a
  // response into the file is the live shape of this.
  const c5 = readLiveList('broken.json', '{not json');
  if (!c5.refusal || !/JSON/.test(c5.refusal[0])) {
    failures.push(`C5 NOT JSON: unparseable bytes were accepted — got ${JSON.stringify(c5)}. Unreadable is not empty, and empty is zero orphans.`);
  }

  // C6 NO `workflows` ARRAY -> refused. A filtered projection (`--jq`) is the
  // easy mistake, and it reads as a list with nothing in it.
  const c6 = readLiveList('projection.json', '{"total_count":1,"foo":[]}');
  if (!c6.refusal || !/workflows/.test(c6.refusal[0])) {
    failures.push(`C6 NO WORKFLOWS ARRAY: a body with no \`workflows\` array was accepted — got ${JSON.stringify(c6)}. Every live workflow would read as absent from GitHub's own list.`);
  }

  // C7 TRUNCATED PAGE -> refused, and it must say PARTIAL. Without `?per_page`,
  // `gh api` returns thirty of thirteen-plus and every entry past the boundary
  // silently stops being an orphan.
  const c7 = readLiveList('short.json', JSON.stringify({ total_count: 13, workflows: agreeing }));
  if (!c7.refusal || !/PARTIAL/.test(c7.refusal[0])) {
    failures.push(`C7 TRUNCATED PAGE: a page reporting total_count 13 while carrying 2 entries was accepted — got ${JSON.stringify(c7)}. Truncation reads as "absent from GitHub", the inverse of this limb's finding.`);
  }

  // C12 A PAGE THAT DOES NOT ACCOUNT FOR ITSELF -> refused, in BOTH the shapes
  // C7 cannot reach. ADDED 2026-08-22, FOURTH PASS, with the deletion it pins:
  // the accounting refusal above carried a `typeof total_count === 'number' &&`
  // conjunct, so a page that simply LACKED the field skipped the refusal, and a
  // `--jq` projection is precisely how a body keeps `workflows` and loses
  // `total_count` — the same mistake C6 covers, arriving one field later.
  //
  // WHY THIS IS NOT A SECOND CANARY ON C7'S CONDITION. Both drive the one
  // comparison, so `if (false)` on it reddens both. What separates them is the
  // regression this pass exists to stop: RESTORE the `typeof` conjunct and C7
  // still passes (its page reports 13 and carries 2, a number either way) while
  // C12 fires on both of its inputs. Measured, not reasoned — the row is in the
  // mutation list above.
  //
  // THE WORDING IS PART OF THE ASSERTION. `undefined` and `"2"` are what
  // `JSON.stringify` prints for the absent and the string field, and they are
  // what tells an operator whether the page was truncated or projected. A test
  // for the refusal alone would pass on a message that named neither.
  const c12absent = readLiveList('projection.json', '{"workflows":[]}');
  const c12string = readLiveList('stringy.json', JSON.stringify({ total_count: '2', workflows: agreeing }));
  if (!/total_count undefined and carries 0 entr/.test(c12absent.refusal?.[0] ?? '')) {
    failures.push(`C12a NO total_count: a body with \`workflows\` and NO \`total_count\` was not refused by name — got ${JSON.stringify(c12absent)}. Truncation becomes unfalsifiable on the one field that could falsify it, and a shorter list is fewer orphans.`);
  }
  if (!/total_count "2" and carries 2 entr/.test(c12string.refusal?.[0] ?? '')) {
    failures.push(`C12b STRING total_count: a body whose \`total_count\` is a string was not refused by name — got ${JSON.stringify(c12string)}. A quoted count never equals a length, and reading it as agreement is the same silence.`);
  }

  // C13 AN ENTRY WITH NO `path` -> refused, and the entry is named by index.
  // ADDED 2026-08-22 with the fallback it replaces: `orphanWorkflows` defaulted a
  // missing `path` to '', which fails the prefix test, so the entry was skipped
  // rather than reported — the `total_count` defect one field over. The index
  // and the total are part of the assertion because "some entry is malformed" is
  // not something an operator can act on; "entry 2 of 3" is.
  const c13 = readLiveList(
    'pathless.json',
    JSON.stringify({ total_count: 3, workflows: [...agreeing, { id: 7, name: 'no path at all', state: 'active' }] }),
  );
  if (!/entry 2 of 3 has no string `path`/.test(c13.refusal?.[0] ?? '')) {
    failures.push(`C13 PATHLESS ENTRY: a live entry with no \`path\` was not refused by index — got ${JSON.stringify(c13)}. An entry that cannot be matched against a file is dropped from the comparison, and one fewer entry considered is one fewer orphan.`);
  }

  // C15 A BODY THAT IS JSON `null` -> refused, not crashed. ADDED 2026-08-24
  // because the `body?.` chain in the `workflows`-array refusal had no input:
  // `null` is valid JSON, so `JSON.parse` hands it back and `body.workflows`
  // would throw, while C6's body is an object and short-circuits the chain
  // without ever exercising it. A chain nothing drives is a chain that can be
  // deleted by accident, and the accident here is a TypeError where a refusal
  // belongs.
  const c15 = readLiveList('null.json', 'null');
  if (!c15.refusal || !/workflows/.test(c15.refusal[0])) {
    failures.push(`C15 NULL BODY: a page whose entire body is JSON \`null\` produced ${JSON.stringify(c15)} instead of a refusal naming \`workflows\`. A body that is not an object is not an empty list, and an empty list is zero orphans.`);
  }

  // C16 AN ENTRY THAT IS `null` -> refused BY INDEX, not crashed. ADDED
  // 2026-08-24. C13's entry is an object missing `path`; this one is not an
  // object at all, which is the only input that drives BOTH the `w?.path` chain
  // in the finder and the `[pathless]?.path` chain in the message it prints.
  // With either chain dropped this case became a TypeError, and a crash inside
  // the canaries is not the refusal an operator needs to read.
  const c16 = readLiveList('nullentry.json', '{"total_count":1,"workflows":[null]}');
  if (!/entry 0 of 1 has no string `path` \(got undefined\)/.test(c16.refusal?.[0] ?? '')) {
    failures.push(`C16 NULL ENTRY: a live entry that is \`null\` was not refused by index — got ${JSON.stringify(c16)}. An entry that cannot be matched against a file is dropped from the comparison, and one fewer entry considered is one fewer orphan.`);
  }

  // C8-C11 DRIVE `liveVerdict` — the ORPHAN VERDICT, which is a DIFFERENT
  // condition from the engine C2 covers. C2 proves an absent workflow is FOUND;
  // these prove the run STOPS on one and says which stop it is. Until the third
  // pass only the first half had a negative half, and it is the second half
  // that decides the exit code.
  const c8 = liveVerdict('good.json', goodPage, scanned);
  if (c8.stop || !/0 of them absent/.test(c8.liveLine ?? '')) {
    failures.push(`C8 AGREEING PAGE: a live list identical to the scan produced ${JSON.stringify(c8)} instead of a plain consulted line. A verdict that stops on correct input is one that gets switched off.`);
  }

  // C9 ONE ORPHAN -> a COVERAGE LOST stop that NAMES it, over a line that counts
  // it. The literal shape measured against this repository 2026-08-21.
  // THE ID IS PART OF THE ASSERTION, not decoration: it is what an operator
  // pastes into `gh api /repos/…/actions/workflows/<id>` to find the thing.
  // Added 2026-08-21, third pass, because `id: w?.id ?? null` pinned to `null`
  // was measured surviving every canary — EXIT 0, nothing fired — while
  // `name` and `state` were already held by C2 and by the base-name test here.
  const c9 = liveVerdict(
    'orphan.json',
    JSON.stringify({
      total_count: 3,
      workflows: [...agreeing, { id: 320102035, name: 'media-probe (throwaway)', path: `${WF_PREFIX}media-probe.yml`, state: 'active' }],
    }),
    scanned,
  );
  if (c9.stop?.kind !== 'coverageLost' || !/media-probe\.yml \(id 320102035, "media-probe \(throwaway\)", state `active`\)/.test(c9.stop?.lines?.[0] ?? '') || !/1 of them absent/.test(c9.liveLine ?? '')) {
    failures.push(`C9 ORPHAN VERDICT: a live workflow absent from the scan did not produce a COVERAGE LOST stop naming it — got ${JSON.stringify(c9)}. The orphan would be counted, printed, and exited 0 over.`);
  }

  // C10 AN UNREADABLE PAGE -> a REFUSE stop and NO consulted line. A refusal
  // that reaches the comparison compares nothing and reports zero orphans,
  // which is the one answer this limb must never give by accident.
  const c10 = liveVerdict('broken.json', '{not json', scanned);
  if (c10.stop?.kind !== 'refuse' || c10.liveLine !== undefined) {
    failures.push(`C10 REFUSAL PASSTHROUGH: an unreadable page produced ${JSON.stringify(c10)} instead of a refusal alone. "I could not read it" would print as an account of the tree.`);
  }

  // C11 BOTH STOP KINDS RESOLVE. The caller takes the stop BY NAME, so a kind
  // with no entry in `LIVE_STOPS` is a TypeError at the one moment this guard
  // has a finding to report — the worst possible moment to discover it.
  for (const k of [c9.stop?.kind, c10.stop?.kind]) {
    if (typeof LIVE_STOPS[k] !== 'function') {
      failures.push(`C11 STOP KIND: \`${k}\` is not one of ${Object.keys(LIVE_STOPS).join(', ')} — the caller would throw instead of reporting.`);
    }
  }

  return failures;
}

const selfTestFailures = liveLimbSelfTest();
if (selfTestFailures.length) {
  refuse([
    `limb 5's own canaries failed (${selfTestFailures.length}), so its findings — including "no orphans" — are worthless:`,
    ...selfTestFailures.map((f) => `  · ${f}`),
    'This is a statement about the detector, not about the tree. Nothing below was compared.',
  ]);
}

let liveLine;
if (liveArg === null) {
  liveLine =
    'live workflow list NOT CONSULTED — a workflow on a branch this checkout does not have is invisible here. ' +
    `Compare with: gh api 'repos/OWNER/REPO/actions/workflows?per_page=100' > live.json && node ${'tooling/ci/assert-workflow-hardening.mjs'} ${LIVE_FLAG}live.json`;
} else {
  // ⚠️ NO SEPARATE `existsSync` CHECK, AND IT WAS WRITTEN AND THEN DELETED.
  // `readFileSync` already refuses on a missing file, with ENOENT in the
  // message; the extra branch changed the wording and nothing else — same exit,
  // same refusal — so no input could tell the two apart. That is the `#…`-strip
  // in the USES note above, one limb further down, and it goes the same way.
  let raw;
  try {
    raw = readFileSync(liveArg, 'utf8');
  } catch (e) {
    refuse([
      `${LIVE_FLAG}${liveArg} could not be read (${e.message}).`,
      'A missing or unreadable list is not an empty list, and an empty list is zero orphans — which is the',
      'one answer this limb must never give by accident.',
    ]);
  }
  // ONE DISPATCH LINE, AND IT IS ALL THAT IS LEFT HERE. Reading the page,
  // comparing it against the scan, and choosing between the two stops all
  // happen inside `liveVerdict`, where C8-C11 drive them on every invocation.
  // This line only TAKES the stop the verdict already decided on.
  // 🔴 IT WAS UNCOVERED UNTIL 2026-08-24 AND IT IS NOT ANY MORE, which is
  // written here because the sentence this replaced said the opposite and a
  // reader arrives at this line, not at the block that qualifies it. Set to
  // `if (false)` it was the worst row on the limb: SUITE EXIT 0, 30 / 30 / 0,
  // while a page carrying two real orphans printed `2 of them absent` in the ok
  // block and exited 0. Measured again after the guards.test.mjs case landed:
  // SUITE EXIT 1, tests 38 / pass 36 / FAIL 2. A hole moved is not a hole
  // closed — this one was closed where it was moved to.
  const verdict = liveVerdict(liveArg, raw, files);
  if (verdict.stop) LIVE_STOPS[verdict.stop.kind](verdict.stop.lines);
  liveLine = verdict.liveLine;
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
// PRINTED WHETHER IT RAN OR NOT, and that is the whole repair. The line above
// has always read as a complete account of this repository's workflows; on
// 2026-08-21 it was an account of 11 of the 13 GitHub would run, and nothing in
// it said so.
//
// ⚠️ LIMB 6'S LINE IS PRINTED BELOW THIS ONE, NOT ABOVE IT, and the order is not
// cosmetic: "the line above" in the paragraph you are reading names the `ok`
// line, and a first draft of limb 6 slid its own line into that gap and quietly
// made a dated sentence point at the wrong subject.
console.log(`    limb 5 — ${liveLine}`);
// THE SHELL COUNT IS PRINTED BESIDE THE JUDGED COUNT ON PURPOSE. It is the one
// number that moves when limb 6's `run:` separation drifts: every line it stops
// judging becomes a line it calls shell, so the two counts trade against each
// other in a diff while their SUM stays put. A single total would hide exactly
// that, which is the `41 vs 42` lesson one limb up.
console.log(
  `    limb 6 — no single-brace \`\${ … }\` expression in ${exprLinesScanned} judged line(s) ` +
    `across ${exprWorkflowsScanned} workflow(s) (${exprShellLines} \`run:\` line(s) left to the shell, unjudged)`,
);
