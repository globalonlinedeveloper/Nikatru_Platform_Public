#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-guard-coverage.mjs — F-10 enforcing itself.
//
// [pipeline F-10] "Every guard carries a recorded failing case and a self-check
// that its own scan still reaches everything it claims to cover." Until now that
// was a rule people followed, and the accounting lived in prose that went stale:
// the spec said "5 of 6 guards" while the tree had SEVENTEEN. A count nobody
// computes is a count that drifts, and every requirement in all fourteen stages
// rests on the guards actually still working.
//
// So this is the F-9 idea — every deployable unit is claimed by a lane — applied
// to the guards themselves. Two properties, checked mechanically:
//
//   1. NEGATIVE TEST. Every guard is named by at least one file in test/. A
//      guard nobody feeds known-bad input to has only ever run against the real
//      repository, which is valid input by definition, so only its passing path
//      is exercised.
//   2. COVERAGE SELF-CHECK. Every guard that SCANS something asserts its scan
//      still reaches the tree. A scan over nothing prints "ok" — this repo's
//      single most repeated failure. `check-migrations.mjs` silently dropped
//      from 5 files to 4 and reported PASS; `assert-clone-contract.mjs`
//      reported "no per-app D1 name appears" whether it had read 200 files or 0.
//
// ⚠️ THE EXCEPTIONS ARE NAMED AND REASONED, never a silent skip. Two guards do
// not scan a tree at all — they take arguments and call an API — so "did my scan
// reach everything" is not a question that applies to them. That is a real
// distinction, not a waiver, and it is written here where it is enforced rather
// than in a doc nobody reads. Adding to this list should feel expensive.
//
// ⏱ APPENDED 2026-08-26 — the paragraph above is left EXACTLY as written; this
// corpus appends dated corrections rather than rewriting them. "Two guards" is
// now the smaller HALF of that list, not its size. COUNTED TODAY by reading the
// map's own keys — not by running this guard, which rewrites the ratchet:
// NOT_A_SCANNER holds ELEVEN entries. TWO are the API shape the sentence above
// describes (assert-gate-passed and record-deployment, both .mjs under
// tooling/ci/); the other NINE are the second shape the map's own header already
// names — a shared pure-function module whose every caller carries its own
// COVERAGE LOST — namely tree-walk, deployment-record, workflow-scan,
// channel-arming, d1-sql-inventory, text-reductions, read-identity,
// migration-tables and flutter-stock-assets, all .mjs under tooling/ci/. The
// number is prose and prose rots; the map itself is what is enforced, and the
// passing line prints the live exempt count on every run.
//
// It also self-checks, because a guard-coverage guard that stopped finding
// guards would report perfect coverage over an empty set.
//
// ─────────────────────────────────────────────────────────────────────────────
// 🔴 2026-08-01 — THE THREE HAND-RATCHETED FLOORS ARE GONE. THIS FILE NO LONGER
//    CONTAINS A SINGLE HAND-MAINTAINED NUMBER.
//
// What was here: `MIN_GUARDS = 42`, `MIN_TEST_FILES = 37`, `MIN_TEST_CASES =
// 1068`, against a tree measuring 44/39/1106. Every increment that added a guard
// or a test file had to raise all three AND move its own fixtures in the same
// commit, so the floors were a THREE-LINE SHARED MUTABLE that every branch wrote
// to. With several agents working in parallel that is a guaranteed collision, and
// it collided on PR #112, #113 and #114 — three consecutive merges in one day.
//
// Each time, both branches had ratcheted HONESTLY against their own tree, and
// neither number described the merged result, because neither branch could see
// the other's new test files. The correct resolution was always "re-measure the
// merged tree"; the tempting one — take the higher of the two — is the same
// mistake wearing a disguise, and it was a manual step a human had to remember.
// A rule that depends on remembering will eventually be resolved wrongly, and
// the wrong resolution here is SILENT: a floor set too low guards nothing and
// still prints ok.
//
// 🔴 IT COLLIDED A FOURTH TIME WHILE THIS VERY FIX WAS IN REVIEW. PR #115 landed
// mid-flight carrying the fourth ratchet — 43/38/1108, with a comment of its own
// noting it was "the fourth consecutive merge, the fourth number neither branch
// could have predicted". Merging main in produced a conflict on exactly these
// three lines for the fourth time in one day. The resolution this time was not a
// re-measurement: the numbers were gone, #115's whole change to this file WAS
// the ratchet, and the branch that added a guard and a test file was absorbed by
// running the guard once — `+ ceiling-budget.test.mjs (34)`, `↑ guards.test.mjs
// 211 → 217`, identity 45 == 45. No hand edit, no number, no third occurrence of
// the judgement call that had to be got right from memory. That is the proof the
// rest of this header is arguing for, and it arrived unprompted.
//
// The header used to record an honest limitation: "nothing but a directory
// listing can derive a directory listing's size". That is true of an ABSOLUTE
// COUNT, so this file no longer tries to derive one. It derives the
// RELATIONSHIPS instead — the same repair already made in
// `assert-vendor-portability.mjs` (every `services/*` dir must contribute ≥1
// wrangler surface) and `assert-workflow-hardening.mjs` (the scanned set must
// equal what `git ls-files` tracks, plus an accounting identity between two
// deliberately different `uses:` matchers).
//
//   ┌ WHAT REPLACED WHAT ────────────────────────────────────────────────────┐
//   │ MIN_GUARDS       →  THE INVOCATION IDENTITY (R1 + R2 below).           │
//   │                     The set of `.mjs` in tooling/ci must EQUAL the set │
//   │                     of tooling/ci guards the tracked workflows invoke. │
//   │                     Deleting a guard leaves the workflow naming a file │
//   │                     that is gone → fail. Adding a guard is fine the    │
//   │                     moment it is wired into a workflow, which is what  │
//   │                     "a guard exists" was always supposed to mean.      │
//   │                     Both directions, so neither set can shrink alone.  │
//   │                                                                        │
//   │ MIN_TEST_FILES   →  THE RATCHET MANIFEST'S KEY SET (R6).               │
//   │ MIN_TEST_CASES   →  THE RATCHET MANIFEST'S VALUES (R6).                │
//   │                     `tooling/ci/test/coverage-manifest.json` records   │
//   │                     the measured declaration count PER TEST FILE. A    │
//   │                     DROP — a file gone, or fewer cases in it — FAILS.  │
//   │                     A RISE rewrites the manifest and never fails.      │
//   └────────────────────────────────────────────────────────────────────────┘
//
// WHY PER-FILE IS THE WHOLE TRICK, AND NOT JUST "ONE NUMBER IN A FILE INSTEAD OF
// IN THE SOURCE": a single total is one line that every branch must write, which
// is exactly the collision being removed. Keyed by test file, two branches adding
// two different test files touch two different lines and git merges them without
// a word. And a per-file floor is STRICTLY STRONGER than the total ever was —
// under `MIN_TEST_CASES = 1068` against 1106, thirty-eight cases could be deleted
// from one file with nothing said; under the ratchet, one can not.
//
// THE LIMIT, STATED PLAINLY RATHER THAN PAPERED OVER: a ratchet has state, and
// state can be reset. Emptying or deleting the manifest is caught (both are
// COVERAGE LOST on the real repo), but LOWERING one recorded value by hand is
// not distinguishable from a test file that legitimately shrank. That exposure
// is not new — it is exactly what `MIN_TEST_CASES = 1068` already had — except
// that it is now one line per file in a diff instead of one line for the whole
// suite, and every automatic rise is PRINTED, so a reviewer sees the ratchet move.
// ─────────────────────────────────────────────────────────────────────────────
//
// Usage:  node tooling/ci/assert-guard-coverage.mjs [repoRoot]
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listDir } from './tree-walk.mjs';
import { stripSourceComments } from './text-reductions.mjs';

const ROOT = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
const CI = join(ROOT, 'tooling', 'ci');
const TESTS = join(CI, 'test');
const WORKFLOWS = join(ROOT, '.github', 'workflows');
/** The ratchet's state. Committed, because a floor nobody can see is not a floor. */
const MANIFEST = join(TESTS, 'coverage-manifest.json');
const MANIFEST_REL = 'tooling/ci/test/coverage-manifest.json';

/** No argument means CI's own invocation — the real repository, where the git
 *  manifest and the ratchet state MUST both be readable. A caller pointing this
 *  at a fixture root is a different, weaker situation and says so out loud. */
const scanningRealRepo = process.argv[2] === undefined;

/** The marker every scanning guard uses when its own reach falls short. Chosen
 *  because it is already this repo's idiom, so the check enforces the existing
 *  convention rather than inventing a second one. */
const COVERAGE_MARKER = 'COVERAGE LOST';

/**
 * 🔴 THE MARKER IS LOOKED FOR IN CODE, NEVER IN PROSE — comments are stripped
 * first. Until 2026-08-17 limb 2 below was `source.includes(COVERAGE_MARKER)`
 * over the RAW file, so a guard satisfied "has a coverage self-check" by
 * MENTIONING coverage loss in a comment. That is this repository's most-repeated
 * defect wearing the costume of the check that exists to catch it — the same
 * class as the `grep '"r2_buckets"'` that matched the template comment
 * explaining why there are no r2_buckets, which `assert-clone-contract.mjs`
 * records as the reason it parses instead of greps.
 *
 * It was not hypothetical. THREE files passed on prose alone, and all three say
 * in their own headers that they are not scanners:
 *   · read-identity.mjs      — "IT SCANS NOTHING AND OWNS NO COVERAGE CLAIM …
 *                              the caller must report COVERAGE LOST"
 *   · migration-tables.mjs   — "Callers own the COVERAGE LOST decision"
 *   · flutter-stock-assets.mjs — "it reports its own coverage failures to them
 *                              by throwing", the thrown `lines` being "a
 *                              ready-to-print COVERAGE LOST explanation"
 * Each was counted in the `scanners` total while carrying no floor at all, and
 * the sentence that earned the pass was the sentence disclaiming the duty. They
 * are now in NOT_A_SCANNER, where they always belonged; the prose grep is what
 * kept them out of it, because it saw no problem to report.
 *
 * The marker legitimately lives in a STRING LITERAL (`console.error('✗ COVERAGE
 * LOST — …')`), so only comments are removed — stripping literals too would
 * delete every real self-check and invert the check.
 */
const markerInCode = (source) => stripSourceComments(source, '.mjs').includes(COVERAGE_MARKER);

/** Files under tooling/ci that do not scan a tree, with the reason. NOT a waiver
 *  list — each entry is a claim that the coverage question does not apply, and
 *  the reason has to survive being read aloud. (Two shapes qualify: a guard that
 *  calls an API instead of walking a tree, and a shared pure-function module
 *  that every caller's own self-check already covers. Both still owe a negative
 *  test, which limb 1 above enforces regardless of this map.) */
const NOT_A_SCANNER = new Map([
  [
    'assert-gate-passed.mjs',
    'takes a SHA and asks the GitHub API one question about it. There is no tree to under-reach; its failure mode is argument handling, which is where the real off-by-one lived and which its tests cover.',
  ],
  [
    'record-deployment.mjs',
    'writes a GitHub Deployment record. It performs an action rather than scanning anything, so there is no scope for it to silently cover less.',
  ],
  [
    'tree-walk.mjs',
    'is not a guard: it is the ONE directory listing — `listDir`, `boundedGlob` and the `.git`/`.claude` rule that decides what is not part of the tree under test — imported by every guard in tooling/ci that reads a directory. It scans nothing of its own, so "did my scan still reach the tree" belongs to those importers, each of which carries its own COVERAGE LOST over what it reads. What it CAN lose is its refusal, and that is not left to prose: assert-walks-bounded.mjs builds a real nested checkout in a temp directory on every run and fails if listDir or boundedGlob returns anything from inside it.',
  ],
  [
    'deployment-record.mjs',
    'is not a guard: it is the ONE declaration of [10]D-9\'s record shape — the `nk1 state=… sha=… listing=…` encoding, its decode (in which a LEGACY `live at <sha>` reads as UNPARSEABLE rather than as `live`), the environment→channel resolution against the register, and the `readSubmissions` reader that D-6\'s cadence limb and D-10 limb (iii) both consume. Pure functions, text in, text out, no filesystem — so "did my scan still reach the tree" belongs to record-deployment.mjs and to assert-submission-safety.mjs, which read real data through it. Its own failing cases are in test/deployment-record.test.mjs, including the legacy-form one that the version tag exists for. It sits flat in tooling/ci because the stray-.mjs check above (correctly) treats a subdirectory as a guard escaping the scan.',
  ],
  [
    'workflow-scan.mjs',
    'is not a guard: it is the ONE parse of a GitHub workflow into jobs, `needs` edges and LOGICAL lines (a `run: >` block folded with spaces, a `run: |` block joined with ` ; `, comments blanked so line numbers survive). It was extracted from assert-release-provenance.mjs on 2026-08-03, unchanged, when a fourth guard needed it — four copies of a workflow parser drift in the one way that reports "clean", which is WHICH LINES THEY CAN SEE. It reads only the path its caller hands it and asserts nothing about the tree, so "did my scan still reach the tree" belongs to the four importers, each of which carries its own COVERAGE LOST over what it read — and assert-no-secret-defines.mjs specifically re-scans the same files FLAT and fails when a define is in the text but outside the parsed set, which is a negative test of THIS module reaching the file. It sits flat in tooling/ci because the stray-.mjs check above (correctly) treats a subdirectory as a guard escaping the scan.',
  ],
  [
    'channel-arming.mjs',
    'is not a guard: it is the ONE reading of "does tooling/channel-register.json say this channel can reach a user today?" — `served: true`, or `submittable: true` with a real `lane` — imported by the three signing seams (windows-signing, apple-signing, appimage-signing) that must decide whether a missing credential FAILS a release or is PRINTED as an owner-gated gap. Pure functions: register rows in, verdict out, no filesystem, no environment and deliberately no channel name, so it cannot carry a stale copy of the register to drift from. "Did my scan still reach the tree" belongs to those three importers, each of which already exits COVERAGE LOST when its own row is absent from the register — the case where this module would otherwise be asked about nothing. Its own failing cases are in test/channel-arming.test.mjs, including a positive control against the REAL register (the served `web` row must come out ARMED) without which every negative result there would be consistent with a derivation that returns false always. It sits flat in tooling/ci because the stray-.mjs check above (correctly) treats a subdirectory as a guard escaping the scan.',
  ],
  [
    'd1-sql-inventory.mjs',
    'is not a guard: it is the ONE reading of "what SQL does this repository send to D1, and what shape is it" — the comment-stripped literal walk, the `.prepare(`/`.exec(`/`.batch(` walk that reports the statements it could NOT read, the introspective/dynamic-identifier/static classification, the narrower reading of WHICH introspective answer names TABLES rather than the columns of one table (yieldsTableNames, added 2026-08-25 after the live half read a pragma_table_info answer as the schema of subly_db and could then instantiate neither erasure statement), and the measured prohibition itself. Pure functions plus one directory walk it is handed; it asserts nothing and exits nowhere. Two guards consume it — tooling/ci/assert-d1-sql-inventory.mjs (static, ci.yml) and tooling/ops/check-d1-accepts-live-sql.mjs (live, the deploy jobs and ops-watch) — and the coverage question belongs to those two, each of which carries its own COVERAGE LOST over what it read. It also carries the REJECTED_FIXTURE the live check sends as its negative control, which is why the static guard skips the files that import it (derived from the imports, printed on every run) and asserts instead that the detector FLAGS that fixture and CLEARS the four shapes production D1 was measured to accept. Its own failing cases are in test/d1-sql-inventory.test.mjs. It sits flat in tooling/ci because the stray-.mjs check above (correctly) treats a subdirectory as a guard escaping the scan.',
  ],
  [
    'text-reductions.mjs',
    'is not a guard at all: it is the ONE HTML→visible-text and source→code-without-comments reduction, pure functions with no filesystem and no tree. MEASURED 2026-08-17: 39 files import it — 37 non-test (35 flat in tooling/ci, plus tooling/ops/check-prod-provenance.mjs and tooling/store/capture-suite-scan.mjs) and 2 test files — of which 36 take stripSourceComments. The coverage question belongs to those importers, each of which carries its own COVERAGE LOST over what IT reads, and giving this file a self-check it could not honestly make is exactly the assertion-that-cannot-fail this repo keeps deleting. 🔴 THE COUNT ABOVE IS PROSE AND IT HAS NOW BEEN WRONG TWICE: it said "five" until 2026-08-02, then "NINE guards … of which seven take stripSourceComments" until 2026-08-17, by which time the true figures were 39 and 36 — an entry that undercounted the blast radius by a factor of four while claiming, in the same sentence, that "the list is now derived from the actual import statements". It was not derived; it was typed, and nothing re-reads it. Re-measure rather than trust it — the ripgrep recipe, with the two flags it cannot be run without, is written out beside the markerInCode canary further down this file; run it with the specifier alone for the 39 and with the stripSourceComments brace-clause in front for the 36. Both flags are load-bearing: without `-a` the answers come back 38 and 35, because assert-release-lane-generic.mjs carries NUL bytes and ripgrep skips it as binary without a word. It sits flat in tooling/ci because the stray-.mjs check above (correctly) treats a subdirectory as a guard escaping the scan. ⏱ APPENDED 2026-08-25 — the paragraph above is left exactly as written; this corpus appends dated corrections rather than rewriting them. Re-measured today with the recipe beside markerInCode further down this file, both flags kept: the bare-specifier form answers 47 and the stripSourceComments brace-clause form answers 44. On 2026-08-17 they were 39 and 36 — so the entry has not gone wrong a third time, but it had rotted by eight in eight days, which is exactly why the paragraph above tells you to re-measure rather than read. Breakdown of the 47: 4 test files, 41 flat in tooling/ci, and 2 elsewhere (tooling/ops/check-prod-provenance.mjs and tooling/store/capture-suite-scan.mjs) = 43 non-test; 4 of the 44 stripSourceComments importers are test files. Pipe the file list through tr to turn Windows separators into forward slashes before anchoring a count on tooling/ci, or the anchor matches nothing and the breakdown reads as zero. 🔴 AND THE -a CLAUSE ABOVE NO LONGER REPRODUCES: the two literal NUL bytes in assert-release-lane-generic.mjs were rewritten as escape sequences in the same change as this append, so both queries now answer 47 and 44 WITH -a and WITHOUT it. Measured immediately before that rewrite, without -a they answered 46 and 43 — one short each, and the one missing file was exactly assert-release-lane-generic.mjs. Keep -a anyway: three .mjs files under tooling still carry NUL bytes today (tooling/ci/assert-update-coverage.mjs, tooling/ci/flutter-stock-assets.mjs, tooling/scripts/assert-public-citations.mjs). None of the three imports text-reductions, so none of them moves these two counts, but any other un-flagged sweep of tooling can still lose them without a word. --multiline-dotall is untouched and still load-bearing.',
  ],
  // ── the three the PROSE GREP hid until 2026-08-17 ──────────────────────────
  // None of these is a new judgement. Each file's own header already said it was
  // not a scanner; what was missing was any mechanism that noticed they were
  // absent from this map, because `source.includes('COVERAGE LOST')` was
  // satisfied by the very sentence disclaiming the duty. See markerInCode above.
  [
    'read-identity.mjs',
    'is not a guard: it is the ONE reading of "what identity does this app declare on this platform" — the [10]D-3 readers that tooling/ci/assert-store-identity.mjs (`resolveIdentity`), tooling/release/submit-appstore.mjs (`readAppleBundleId`) and tooling/release/submit-play.mjs (`readGradleApplicationId`) all share, so that a duplicated reader cannot report agreement between two things it read wrongly. It reads the one path it is handed and answers one of exactly three ways — `{ value }`, `{ missing }` for a file that declares no identity, and `{ lost }` for a reader that cannot see what it is meant to see. That third channel IS the coverage report, raised to the caller instead of exited on, and it exists because Windows was green for weeks while having no identity at all read exactly like having the right one. The file each identity lives in is declared once in tooling/channel-register.json, never here. Its own failing cases are in test/store-identity.test.mjs. It sits flat in tooling/ci because the stray-.mjs check above (correctly) treats a subdirectory as a guard escaping the scan.',
  ],
  [
    'migration-tables.mjs',
    'is not a guard: it is the ONE reading of "what tables does this database have, and what columns does each carry" — a comment-stripped, string-literal-stripped DDL parse (0004_money_rail.sql carries the literal text `CREATE TABLE` inside a comment at :52, which a grep-based enumerator reads as a table). It exists so that [pipeline B-17]\'s two limbs range over the SAME derived table set: the secretless gate tooling/ci/assert-prod-provenance.mjs and the credentialled monitor tooling/ops/check-prod-provenance.mjs both call `enumerateMigrationTables`, and two hand-kept copies of "the tables" drift in the one way that reports clean. It reports what it read (`filesRead`, `tables.size`) and never exits, so the COVERAGE LOST decision is the callers\' — each carries its own over that count. Its own failing cases are in test/prod-provenance.test.mjs. It sits flat in tooling/ci because the stray-.mjs check above (correctly) treats a subdirectory as a guard escaping the scan.',
  ],
  [
    'flutter-stock-assets.mjs',
    'is not a guard: it is the ONE answer to "what bytes does `flutter create` write for this asset", obtained by actually running `flutter create` into a cache and reading the result, because all three cheaper approximations were wrong SILENTLY — reading the SDK template directory compared two of five assets against zero-byte `.img.tmpl` placeholders that could never have matched, while printing `5 stock asset(s) compared` and exiting 0, with six fixture tests green throughout. It scans nothing of its own and asserts nothing about any tree; it is the shared reader consumed by tooling/ci/assert-launcher-icons.mjs and tooling/ci/assert-stamp-brand-assets.mjs (`flutterSdkRoot`, `readStockAssets`, `StockAssetsUnavailable`). It reports its own coverage failures to those two by THROWING — `StockAssetsUnavailable.lines` is a ready-to-print COVERAGE LOST explanation the caller frames and exits on — which is why the marker appears in its prose and not in its code. Its own failing cases are in test/launcher-icons.test.mjs. It sits flat in tooling/ci because the stray-.mjs check above (correctly) treats a subdirectory as a guard escaping the scan.',
  ],
]);

/** [pipeline S-12r] (absent from origins.lock.json by construction — S-12r is a residual of S-12, raised by Private/plans/03-stamper-plan.md after the pipeline harvest was frozen) EXECUTABLES OUTSIDE tooling/ci THAT A WORKFLOW RUNS, and
 *  which are NOT required to carry a negative test — with the reason.
 *
 *  🔴 This used to be the opposite list: `COVERED_SCRIPTS`, a hand-written map
 *  naming the ONE script outside tooling/ci that had to have a test. A hand list
 *  of things to cover only ever covers what somebody remembered to add, which is
 *  the same shape as a hand-ratcheted floor — so the subject set is now DERIVED
 *  (every `tooling/**` script the tracked workflows actually invoke) and this map
 *  holds the exceptions instead. A new release script acquires the requirement by
 *  being wired into a workflow, not by somebody remembering this file exists.
 *
 *  The three entries are the e2e harness itself. They are exercised end-to-end
 *  every night by e2e.yml against a live Supabase — a stronger signal than a
 *  fixture, and the reason their absence from test/ is a recorded exception
 *  rather than an oversight. Naming them here is what makes the gap VISIBLE; the
 *  passing line counts them out loud.
 *
 *  ⏱ APPENDED 2026-08-26 — "The three entries" above is left EXACTLY as written;
 *  this corpus appends dated corrections rather than rewriting them. COUNTED
 *  TODAY from the map's own keys, not by running this guard (it rewrites the
 *  ratchet): there are FIVE — provision_user, verify_row, purge, verify_purged
 *  and verify_consent, all .mjs under tooling/e2e/. The last two were added
 *  after that sentence was written and nothing re-counted it, which is the same
 *  shape as the hand-ratcheted floors this file's header argues against.
 *  Everything else the paragraph claims holds for all five unchanged; only the
 *  number had rotted, and the passing line prints the live figure anyway. */
const NO_NEGATIVE_TEST_NEEDED = new Map([
  [
    'tooling/e2e/provision_user.mjs',
    'is the e2e harness, not a guard: e2e.yml runs it nightly against a live Supabase, so it is exercised against the real system rather than a fixture.',
  ],
  [
    'tooling/e2e/verify_row.mjs',
    'is the e2e harness, not a guard: its whole purpose is the live assertion, which e2e.yml performs nightly against real data.',
  ],
  [
    'tooling/e2e/purge.mjs',
    'is the e2e harness teardown, run nightly by e2e.yml against the live project; a fixture cannot model the thing it exists to clean up.',
  ],
  [
    'tooling/e2e/verify_purged.mjs',
    'is the e2e harness assertion for golden-path leg 6, run nightly by e2e.yml: it re-reads live D1 and the live GoTrue admin API AFTER the app has deleted a real account from inside the running build. A fixture would have to model a deletion that already happened, i.e. encode the very belief the file exists to check — the assert-seams-wired failure shape, where all six fixtures passed against a broken guard. Its negative case is the live one: the run it audits is the only place a server that answered `{ ok: true }` while deleting nothing can be caught.',
  ],
  [
    'tooling/e2e/verify_consent.mjs',
    'is the e2e harness assertion for the DPDP consent trail, run nightly by e2e.yml: it re-reads live platform_db for the artifact the running build uploaded when the suite answered its own consent prompt. Its subject is a fire-and-forget POST, so the only input that can distinguish "the record landed" from "the prompt merely closed" is a real one — a fixture would assert that a row somebody wrote is a row that was written. The half of it that IS fixture-testable was deliberately split out: tooling/e2e/consent_anon_id.mjs parses the run\'s exported install id, and tooling/ci/test/consent-anon-id.test.mjs exercises every way that parse can fail.',
  ],
]);

/** ─────────────────────────────────────────────────────────────────────────────
 *  THE ONE EXEMPTION R2 HAS — guards NO INVOCATION A CI RUNNER CAN MAKE IS
 *  CAPABLE OF EXITING 0. Added 2026-08-18, under the licence R2 wrote for itself:
 *  "if a guard ever genuinely needs to exist unrun, the mechanism gets added
 *  THEN, with a reason and a failing case of its own."
 *
 *  🔴 IT IS NOT A LIST OF NAMES, AND A NAME ALONE BUYS NOTHING. The whole reason
 *  R2 refused an exemption map the first time is that a hand-maintained list is
 *  satisfied by typing in it. So every entry states a CLAIM — "a runner cannot
 *  make this guard pass" — and THE CLAIM IS RE-RUN ON EVERY INVOCATION, three
 *  ways, all of them able to fail:
 *
 *    (a) the file must still be there;
 *    (b) it must still be UNREACHED — the moment a workflow invokes it, or
 *        something a workflow runs imports it, the entry describes a state the
 *        tree has left and this FAILS. Derived from the same graph R2 uses, so
 *        it cannot disagree with R2 about what "reached" means;
 *    (c) THE GUARD IS ACTUALLY SPAWNED, with the argv a runner would have, and
 *        must exit NON-ZERO. If it exits 0 the entry's premise is false — it
 *        CAN pass in a checkout, so wire it in — or it has grown the vacuous
 *        pass this whole corpus exists to eliminate. Either way the exemption
 *        stops applying and the run fails.
 *
 *  (c) is what makes this different in kind from a waiver. `assert-guards-refuse-
 *  empty.mjs` learned the same lesson on 2026-08-18 and its header states it:
 *  "a waiver that outlives its reason is the thing being guarded against" — two
 *  of its entries were DELETED that day, not reworded, when the files they
 *  described started refusing instead of declaring. An entry here cannot outlive
 *  its reason, because its reason is measured rather than read.
 *
 *  ⚠️ WHAT THIS DOES NOT EXCUSE. Nothing else. A guard listed here still owes a
 *  recorded failing case (limb 1) and still owes a COVERAGE LOST self-check in
 *  CODE (limb 2) — both run over the full guard set below, this map untouched by
 *  either. The only thing it answers is "why is this not wired into a workflow".
 *
 *  Fields: `since` (dated, because an undated exemption cannot be audited),
 *  `probe` (the argv a CI runner would use — the mode being claimed unrunnable),
 *  `why` (the reason, which has to survive being read aloud). */
const NOT_CI_RUNNABLE = new Map([
  [
    'assert-copy-parity.mjs',
    {
      since: '2026-08-18',
      probe: [],
      why:
        'its subject is the slot directories declared live in catalog/store-matrix.json, which sit OUTSIDE ' +
        'any single checkout: it walks UP for the ancestor holding both Projects/ and nikatru/ and reads that ' +
        "ancestor's siblings (30 slot directories across the workspace today). A runner clones ONE repository, " +
        'so the anchor is not there and this guard REFUSES — exit 2, naming every directory it walked. On the ' +
        'workspace, where the anchor IS reachable, it exits 3 NOT PROVEN instead: the registry marks exactly ' +
        'one slot `live` and that one is the origin itself, so a parity check has nothing to compare against. ' +
        'It becomes CI-runnable only when a second slot carries a real source copy AND the runner can see both. ' +
        'Neither is true today, so a CI step could only be permanently non-zero, or tolerate the refusal by ' +
        'number — and a job that swallows "I compared nothing" is the green tick over an empty set that ' +
        'check-migrations.mjs and assert-clone-contract.mjs already cost this repo.',
    },
  ],
  [
    'assert-github-matrix.mjs',
    {
      since: '2026-08-18',
      probe: ['--offline'],
      why:
        // ⚠️ The command is described, not spelled. assert-github-matrix.mjs's own LIMB 1b greps
        // tooling/ci for files that name that command and requires each to read `github.org` from the
        // registry or carry the declared org literally — a rule about SECOND COPIES OF THE ORG NAME.
        // This file holds no copy of it and queries nothing; spelling the command here would put it in
        // that population and produce a finding about a sentence.
        'its network limb asks GitHub for the org repository listing through an authenticated `gh`, which needs ' +
        'credentials scoped to the ORGANISATION. ' +
        'CI has no such credential — GITHUB_TOKEN is an installation token scoped to one repository and has no ' +
        'org dimension to grant, which tooling/channel-register.json already records one entry over for the ' +
        'billing endpoint. The only mode a runner could invoke is `--offline`, which SKIPS the org entirely and ' +
        'exits 3 ON PURPOSE so that an offline run can never be read in a log as a clean one; and without the ' +
        'Projects/ + nikatru/ anchor it does not reach even that, dying exit 2 "could not look". There is no ' +
        'invocation of this guard available to a runner that is capable of exiting 0, so a CI step could only ' +
        'be permanent red or a tolerated exit code that verified nothing about GitHub.',
    },
  ],
]);

const problems = [];
const notes = [];

/** Structural failure — the scan itself is broken, so nothing below it means
 *  anything. Exits immediately rather than joining the problem list. */
const coverageLost = (lines) => {
  console.error(`✗ COVERAGE LOST — ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(`  ${l}`);
  process.exit(1);
};

if (!existsSync(CI) || !existsSync(TESTS)) {
  coverageLost([
    `expected ${CI} and ${TESTS} to exist.`,
    'The scan is broken, not the tree.',
  ]);
}

// ── the detector's OWN negative test, run on every invocation ───────────────
// `markerInCode` is only worth anything if it can still tell a comment from
// code. If `stripSourceComments` ever regressed to a no-op — a plausible edit,
// it is imported by 36 FILES (measured 2026-08-17, see the recipe below) — this
// check would silently become the raw prose grep it replaced, and go on
// printing a healthy scanner count. That is the exact failure this whole file
// exists to catch, so it is not left to the suite: two synthetic sources, one
// marker in a comment and one in a string literal, must come out FALSE and TRUE
// on every run.
//
// 🔴 THAT NUMBER SAID "ten" WHEN THIS COMMENT WAS FIRST WRITTEN, hours earlier,
// and nobody had counted. Writing a fresh false count inside the very check that
// exists to stop prose being trusted is the defect eating its own tail, so the
// re-measurement recipe travels with the number:
//
//     rg -laU --multiline-dotall "import\s*\{[^}]*stripSourceComments[^}]*\}\s*from\s*'[^']*text-reductions\.mjs'" tooling
//
// ⚠️ `-a` IS LOAD-BEARING, not tidiness. Without it ripgrep answers 35: it
// classifies tooling/ci/assert-release-lane-generic.mjs as binary (that file
// carries two NUL bytes, both on line 379, at byte offsets 22908 and 22916) and
// SKIPS it silently — the same false-negative shape as searching this repo from
// the root and never opening the gitignored trees. Those NUL bytes are in HEAD
// and predate this change; they are worth removing on their own, in whichever
// change owns that file. `--multiline-dotall` is load-bearing too: two importers
// (assert-ads-declarations, assert-policy-claims) spread the braces over
// several lines, and a line-anchored pattern misses both.
//
// ⏱ APPENDED 2026-08-25 — the ⚠️ paragraph above is left EXACTLY as written; this
// corpus appends dated corrections rather than rewriting them. Four of its
// claims are now HISTORICAL and the removal it books is DISCHARGED. Every
// number below was measured in this tree today, after that removal landed:
//
//   (a) THE NUL BYTES ARE GONE. tooling/ci/assert-release-lane-generic.mjs
//       scans to ZERO NUL bytes today — a byte scan of the whole file returns
//       count 0. The 2026-08-17 reading still reproduces AT THE SHA IT WAS
//       TAKEN ON: byte-scan `git show 57e6e10:tooling/ci/assert-release-lane-generic.mjs`
//       and you get count 2, offsets 22908 and 22916, both on line 379. So
//       read that sentence as a statement about 57e6e10, not about this tree.
//       The sentinel is now written with BACKSLASH-u ESCAPES rather than
//       raw bytes, which is why this file can describe it without
//       acquiring the same problem; find it with
//       `grep -n '^const DYNAMIC' tooling/ci/assert-release-lane-generic.mjs`,
//       which answers 421 today and not 379 — grep for it rather than trusting
//       either number, since every edit above it moves the line. Its doc
//       comment there records the rewrite and that the VALUE is byte-identical
//       to what the line evaluated to at 57e6e10.
//
//   (b) THE OWED REMOVAL IS DISCHARGED. "worth removing on their own, in
//       whichever change owns that file" was a booking, not a description.
//       The change that owns that file made the removal on 2026-08-25, and
//       this append closes the booking. Nothing is still owed here.
//
//   (c) "Without it ripgrep answers 35" AND "SKIPS it silently" NO LONGER
//       REPRODUCE. Run the recipe above today and it answers 44 WITH `-a` and
//       44 WITHOUT it; the bare-specifier form (drop the stripSourceComments
//       brace clause, keep the module specifier) answers 47 both ways. No file
//       in this sweep's domain is rescued by `-a` any more.
//
//   (d) KEEP `-a` ANYWAY — it is still load-bearing for OTHER sweeps of
//       tooling, just not for this one. Three .mjs files under tooling carry
//       literal NUL bytes today: tooling/ci/assert-update-coverage.mjs (2),
//       tooling/ci/flutter-stock-assets.mjs (1), and
//       tooling/scripts/assert-public-citations.mjs (2). None of the three
//       imports text-reductions, so none of them moves the two counts above,
//       but an un-flagged sweep of tooling still drops them without a word.
//
//   (e) `--multiline-dotall` is still load-bearing, and the count beside it
//       has rotted from two to THREE. Measured today: 44 with the multiline
//       flags and 41 without them. The three the line-anchored pattern misses
//       are assert-ads-declarations.mjs, assert-policy-claims.mjs and
//       test/text-reductions.test.mjs.
//
// The count is prose and prose rots; the check below does not. It fails on the
// BEHAVIOUR, whatever the blast radius turns out to be on the day.
const CANARY_COMMENT_ONLY = `// the caller must report ${COVERAGE_MARKER} rather than pass\nconst x = 1;\n`;
const CANARY_IN_CODE = `console.error('✗ ${COVERAGE_MARKER} — nothing was scanned');\n`;
if (markerInCode(CANARY_COMMENT_ONLY) || !markerInCode(CANARY_IN_CODE)) {
  coverageLost([
    'the coverage-self-check DETECTOR no longer distinguishes code from comments.',
    `A marker in a comment read as ${markerInCode(CANARY_COMMENT_ONLY)} (must be false) and a marker in a`,
    `string literal read as ${markerInCode(CANARY_IN_CODE)} (must be true).`,
    'Until this holds, every "carries a coverage self-check" verdict below is the prose grep that let',
    'read-identity.mjs, migration-tables.mjs and flutter-stock-assets.mjs pass on the very sentence in',
    'which they disclaimed being scanners. Fix stripSourceComments before trusting anything this prints.',
  ]);
}

const guards = listDir(CI).filter((f) => f.endsWith('.mjs')).sort();
const testFiles = listDir(TESTS).filter((f) => f.endsWith('.test.mjs')).sort();

// ── the scan is FLAT by design, so a subfolder must be LOUD, not a leak ──────
// listDir(CI) does not recurse. Triage 2026-07-31 (mutation-proven): a
// "tidy into tooling/ci/guards/" refactor moved 22 guards into a subfolder and
// this guard printed its intended pass message over the 15 that remained —
// every moved guard silently left BOTH per-guard checks. Guards live flat in
// tooling/ci on purpose; any .mjs in a subdirectory (test/ excepted — that is
// the suite, audited separately below) is either a guard this scan can no
// longer see or a new layout this guard was never taught.
const strayMjs = [];
const findStray = (dir, rel) => {
  for (const e of listDir(dir, { withFileTypes: true })) {
    if (e.isDirectory()) findStray(join(dir, e.name), `${rel}${e.name}/`);
    else if (e.name.endsWith('.mjs')) strayMjs.push(`${rel}${e.name}`);
  }
};
for (const e of listDir(CI, { withFileTypes: true })) {
  if (e.isDirectory() && e.name !== 'test') findStray(join(CI, e.name), `${e.name}/`);
}
if (strayMjs.length) {
  console.error(`✗ COVERAGE LOST — ${strayMjs.length} .mjs file(s) sit in subdirectories of tooling/ci this scan does not reach:`);
  for (const s of strayMjs) console.error(`    tooling/ci/${s}`);
  console.error('  A guard moved into a subfolder leaves BOTH checks (negative test + self-check) silently.');
  console.error('  Move it back to tooling/ci/, or teach this guard the new layout in the same change.');
  process.exit(1);
}

// ─────────────────────────────────────────────────────────────────────────────
// THE INVOCATION IDENTITY — what replaced MIN_GUARDS.
//
// A floor could only ever say "not zero-ish", and it said it against a number
// somebody had to keep raising. What is actually TRUE, and stays true at any
// size of tree, is that a guard exists in order to be RUN: every `.mjs` under
// tooling/ci is invoked by a workflow, and every tooling/ci invocation in a
// workflow names a file that is there. Two set inclusions, computed from the
// tree on every run, which together pin the guard set exactly.
//
// This is strictly stronger than the floor it replaces. Under `MIN_GUARDS = 42`
// against 44 guards, TWO guards could be deleted outright with nothing said —
// and `assert-gate-passed.mjs` and `record-deployment.mjs` were not even
// anchored, because the old cross-check read ci.yml alone and those two are
// invoked by the deploy workflows. Under the identity, deleting ANY guard fails,
// however many there are — the identity is COMPUTED FROM THE TREE on every run
// and carries no number at all. That is precisely what replaced MIN_GUARDS: a
// floor is a number somebody has to keep raising, and a number in prose is the
// thing this file exists to distrust. The two deploy-only guards are anchored
// like the rest.
//
// (Orientation only, dated because it rots — 2026-08-25 the tree held 144:
//     git ls-files ':(glob)tooling/ci/*.mjs' | wc -l        -> 144
//     find tooling/ci -maxdepth 1 -name '*.mjs' | wc -l     -> 144
//  The `:(glob)` MAGIC PATHSPEC is load-bearing, not decoration: a bare
//  `tooling/ci/*.mjs` lets `*` cross `/`, so it sweeps test/ in as well and
//  answers 288 on that same tree — double, and confidently. Nothing below
//  reads either figure; they are here so a reader knows the order of
//  magnitude, and the run prints the live count on its own `ok` line anyway.
//  This paragraph said "the forty-four" in the present tense until 2026-08-25,
//  by which time the tree held 144.
//  ⏱ APPENDED 2026-08-26 — RE-MEASURED, and the 144 has NOT rotted in a day:
//  both commands above still answer 144 on this tree. The bare-pathspec figure
//  HAS moved — it answers 289 today, not 288, because one more test file now
//  sits under tooling/ci/test/ and the naive `*` sweeps the suite in as guards.
//  That is the sentence working, not a defect in it. Nothing below reads either
//  number; measured with git ls-files and find, never by running this guard.)
// ─────────────────────────────────────────────────────────────────────────────
if (!existsSync(WORKFLOWS)) {
  coverageLost([
    `${WORKFLOWS} does not exist, so the invocation identity ranged over nothing.`,
    'The workflows are the committed manifest of what CI actually runs — they are what anchors the',
    'guard set now that the floors are gone. Without them every guard below could vanish unremarked.',
  ]);
}

const workflowFiles = listDir(WORKFLOWS).filter((f) => /\.ya?ml$/.test(f)).sort();

// (i) SCAN vs MANIFEST, the assert-workflow-hardening pattern. `git ls-files` is
//     the committed truth about which workflows exist; `workflowFiles` is what
//     this scan opened. If a workflow the repo tracks never got read, its
//     invocations are invisible and the identity below silently shrinks.
const ls = spawnSync('git', ['-C', ROOT, 'ls-files', '--', '.github/workflows'], { encoding: 'utf8' });
const trackedWorkflows =
  ls.status === 0
    ? [...new Set(ls.stdout.split('\n').map((l) => l.trim()).filter((l) => /\.ya?ml$/.test(l)).map((l) => l.split('/').pop()))]
    : [];
if (trackedWorkflows.length === 0) {
  if (scanningRealRepo) {
    coverageLost([
      `\`git ls-files -- .github/workflows\` returned no tracked workflow under ${ROOT}.`,
      'The manifest that anchors the guard set is unreadable, so "did I see every workflow" cannot be',
      'answered — and there is no floor left to fall back on, deliberately.',
    ]);
  }
} else {
  const unseen = trackedWorkflows.filter((t) => !workflowFiles.includes(t));
  if (unseen.length) {
    coverageLost([
      `git tracks ${trackedWorkflows.length} workflow(s) and this scan opened ${workflowFiles.length}; it never saw: ${unseen.join(', ')}.`,
      'Every unseen workflow takes its guard invocations with it, so the identity below would be computed',
      'over a smaller set and still print ok — which is the exact shape of the floors this replaced.',
    ]);
  }
}

// Comment lines are stripped so a commented-out step is not read as a live
// invocation — the same reason assert-workflow-hardening anchors its matcher.
const invokedGuards = new Set();
const invokedOutside = new Set();
const nestedInvocations = [];
for (const wf of workflowFiles) {
  const text = readFileSync(join(WORKFLOWS, wf), 'utf8')
    .split('\n')
    .filter((l) => !l.trim().startsWith('#'))
    .join('\n');
  // Deliberately broad — `/` is inside the class — so a nested invocation is
  // SEEN and reported rather than quietly failing to match. (`node --test
  // "tooling/ci/test/*.test.mjs"` cannot match: `*` is outside the class.)
  for (const m of text.matchAll(/tooling\/([A-Za-z0-9._/-]+\.mjs)/g)) {
    const rel = `tooling/${m[1]}`;
    if (rel.startsWith('tooling/ci/')) {
      const tail = rel.slice('tooling/ci/'.length);
      if (tail.includes('/')) nestedInvocations.push(`${wf} → ${rel}`);
      else invokedGuards.add(tail);
    } else {
      invokedOutside.add(rel);
    }
  }
}
if (nestedInvocations.length) {
  coverageLost([
    `${nestedInvocations.length} workflow step(s) invoke a tooling/ci path this FLAT scan cannot audit:`,
    ...nestedInvocations.map((n) => `    ${n}`),
    'Guards live flat in tooling/ci so both per-guard checks reach them. A nested one is run by CI and',
    'audited by nobody.',
  ]);
}

// (ii) R1 — INVOKED ⊆ FOUND. A workflow naming a guard this scan cannot find
//      means the two have diverged: the guard was deleted or moved while CI
//      still calls it, or this scan is reading the wrong directory.
const unfound = [...invokedGuards].filter((g) => !guards.includes(g)).sort();
if (unfound.length) {
  coverageLost([
    `the workflows invoke ${unfound.length} guard(s) this scan did not find: ${unfound.join(', ')}.`,
    'The manifest CI runs and the set this guard audits have diverged. Either the guard was',
    'deleted/moved while a workflow still calls it, or this scan reads the wrong directory.',
  ]);
}

// (iii) R2 — FOUND ⊆ REACHED. The other half, and the half that never existed
//       before. A guard nothing runs is a guard that cannot fail a build; it is
//       covered on paper and inert in practice.
//
//       🔴 "REACHED", NOT "INVOKED", AND THE DIFFERENCE IS A MECHANISM RATHER
//       THAN AN EXEMPTION LIST. This check originally read FOUND ⊆ INVOKED and
//       said so with a note: "there is no exemption list here on purpose… if a
//       guard ever genuinely needs to exist unrun, the mechanism gets added
//       THEN, with a reason and a failing case of its own." That case arrived
//       one merge later, with `tooling/ci/text-reductions.mjs` — the single
//       HTML→visible-text and source→code-without-comments reduction that five
//       guards IMPORT and no workflow calls. It is not inert: every one of those
//       five fails the moment it breaks.
//
//       An exemption map would have been the wrong repair, for exactly the
//       reason this file's own header gives about hand-ratcheted floors: it is a
//       hand-maintained list, and it grows by somebody remembering. So the
//       relation is DERIVED instead. A file is reached if a workflow invokes it,
//       or if something reached imports it — transitively, from the import
//       statements in the tooling/ci sources themselves. Delete the last import
//       of a shared module and it becomes unreached and FAILS, which is exactly
//       when it has stopped being covered. Nothing can be added to a list to
//       silence it; the only way to satisfy it is to be genuinely reachable.
//
//       🔴 2026-08-18 — THE LAST SENTENCE ABOVE IS NO LONGER THE WHOLE TRUTH,
//       AND IT IS LEFT STANDING RATHER THAN REWRITTEN BECAUSE IT RECORDS WHY THE
//       BAR IS WHERE IT IS. A second genuinely different case arrived, and it is
//       not the shared-module shape: assert-copy-parity.mjs and
//       assert-github-matrix.mjs are guards with mains, whose SUBJECTS ARE NOT IN
//       A CHECKOUT — thirty slot directories across the workspace, and an
//       organisation only an authenticated `gh` can see. Neither is importable by
//       anything, so the derived relation cannot reach them, and neither has ANY
//       invocation a runner could make that is capable of exiting 0. The three
//       ways to satisfy R2 all failed for a reason that was not the guard's
//       fault, and the fourth — a CI step run with a flag that makes the guard
//       vacuous, so the count comes out right — is the precise defect this file
//       exists to catch.
//
//       So NOT_CI_RUNNABLE was added, and it is a list of NAMES ONLY IN ITS
//       SHAPE. Every entry states a claim that is RE-RUN on every invocation:
//       the file must still be there, must still be unreached, AND MUST STILL
//       REFUSE WHEN SPAWNED. Typing a name in it buys nothing; the guard has to
//       go on failing to be excused for not being run. See the map's own header.
//
//       ⏱ APPENDED 2026-08-26 — both paragraphs above are left EXACTLY as
//       written; this corpus appends dated corrections rather than rewriting
//       them. ONE COUNT IN THEM HAS ROTTED, and it is the one in the first:
//       "the single HTML→visible-text and source→code-without-comments
//       reduction that five guards IMPORT and no workflow calls", followed by
//       "every one of those five fails the moment it breaks". FIVE was true on
//       the day that case arrived and nothing has re-derived it since.
//       MEASURED TODAY with the ripgrep recipe that travels beside markerInCode
//       further up this file (both flags kept), and NOT by running this guard,
//       which rewrites the ratchet: 47 files under tooling/ name the
//       text-reductions module as a specifier — 41 of them flat .mjs in
//       tooling/ci, 4 test files under tooling/ci/test/, and 2 elsewhere
//       (check-prod-provenance under tooling/ops/ and capture-suite-scan under
//       tooling/store/). So the blast radius is 41 guards, not five, which makes
//       the argument the paragraph is making STRONGER rather than weaker.
//       "AND NO WORKFLOW CALLS" STILL HOLDS, re-checked today: the only mention
//       of that module anywhere under .github/workflows/ is a comment line in
//       ci.yml, and the invocation scan below strips comment lines before it
//       matches — so it is not an invocation and the module is still reached
//       only through the derived import graph. The same rot hit the "nine
//       guards import it" figure in the importsOf note directly below; read 41
//       there too, and re-measure rather than trust either number.
const importsOf = (file) => {
  // Comments out first. A `// import { x } from './shared.mjs'` in a TODO must
  // not make a module reachable — the same prose-satisfies-a-check rule the
  // commented-out-invocation case above already enforces on the workflow side.
  // Stripped inline rather than by importing tooling/ci/text-reductions.mjs:
  // this is the guard that audits which modules are reachable, and having it
  // depend on one of its own subjects is a circularity nobody should have to
  // reason about at 2am.
  //
  // 🔴 THAT DECISION WAS RE-TAKEN 2026-08-02, when text-reductions.mjs's
  // stripSourceComments was fixed for the identical defect and "one declaration,
  // not two" became the obvious tidy-up. It is still NOT unified, and the reason
  // is stronger than tidiness. Measured on the tree that day: the two reducers
  // already agree — over all 76 files in tooling/ci they derive the SAME import
  // graph, 0 differences — so unifying buys no correctness. What it COSTS is the
  // property the derivation exists for. text-reductions.mjs is reached today
  // only because nine guards import it; delete the last of those and it becomes
  // unreached and this guard FAILS, which is exactly when it has stopped being
  // covered. An import HERE would make its auditor one of its consumers, so it
  // would be reported reachable on the day nothing else reaches it. Verified by
  // mutation on a clone: with all nine real imports deleted the guard names
  // text-reductions.mjs as unreached; with this file importing it, it does not.
  // The duplication is the price of the invariant, and it is worth it.
  //
  // ⏱ APPENDED 2026-08-26 — the 2026-08-02 paragraph above is left EXACTLY as
  // written; this corpus appends dated corrections rather than rewriting them.
  // TWO OF ITS READINGS ARE HISTORICAL and nothing re-derives either:
  //   · "nine guards import it", and "with all nine real imports deleted", were
  //     that day's tree. MEASURED TODAY by ripgrep — not by running this guard,
  //     which rewrites the ratchet: 41 flat .mjs in tooling/ci name the
  //     text-reductions module, 47 files under tooling/ in all.
  //   · "over all 76 files in tooling/ci" was likewise that day's tree. Flat
  //     .mjs in tooling/ci today: 144, per the orientation note further up.
  // 🔴 AND ONE SENTENCE IN IT IS NO LONGER HYPOTHETICAL. "An import HERE would
  // make its auditor one of its consumers" was written of a thing that had not
  // happened; since the markerInCode repair of 2026-08-17 THIS FILE IMPORTS
  // stripSourceComments at the top, so the auditor already IS a consumer, and
  // "with this file importing it, it does not" now describes the tree's actual
  // state rather than the rejected branch of a mutation. What survives intact is
  // the NARROWER claim the paragraph opens with: importsOf still strips inline
  // and is still not unified with that module. FLAGGED, NOT REPAIRED — removing
  // that import is a change to this guard's LOGIC, not to its prose.
  //
  // 🔴 2026-08-02 — THIS WAS `.replace(/\/\*[\s\S]*?\*\//g, ' ')` AND IT ATE THIS
  // FILE'S OWN IMPORTS. Line 70 of this very file is a LINE comment containing
  // the text `services/*`; a block-comment regex reads that as an opening
  // delimiter and deletes everything up to the next `*/` — here, sixty lines
  // including the entire import block. `importsOf` therefore returned NOTHING
  // for assert-guard-coverage.mjs, and every module reachable only through it
  // was reported as reached by nobody. It surfaced the day a second shared
  // module (tree-walk.mjs) was imported by this guard alone in a fixture; until
  // then the graph had been quietly missing edges and printing ok.
  //
  // The repair is to stop reducing and filter by LINE: a line is discounted only
  // if it OPENS with a comment marker, which no real import statement does. That
  // can over-discount (a `*`-prefixed continuation line) but cannot silently
  // miss an edge — and a missing edge here reports MORE coverage than exists,
  // which is the only direction that matters.
  const src = readFileSync(join(CI, file), 'utf8')
    .split('\n')
    .filter((l) => {
      const t = l.trim();
      return !(t.startsWith('//') || t.startsWith('*') || t.startsWith('/*'));
    })
    .join('\n');
  const out = new Set();
  // Static `import … from './x.mjs'` and dynamic `import('./x.mjs')`. Relative
  // and flat: a nested path is already COVERAGE LOST above.
  for (const m of src.matchAll(/from\s*['"]\.\/([A-Za-z0-9._-]+\.mjs)['"]/g)) out.add(m[1]);
  for (const m of src.matchAll(/import\(\s*['"]\.\/([A-Za-z0-9._-]+\.mjs)['"]\s*\)/g)) out.add(m[1]);
  return [...out];
};
const reached = new Set([...invokedGuards].filter((g) => guards.includes(g)));
for (const queue = [...reached]; queue.length > 0; ) {
  for (const dep of importsOf(queue.pop())) {
    if (guards.includes(dep) && !reached.has(dep)) {
      reached.add(dep);
      queue.push(dep);
    }
  }
}
// ── NOT_CI_RUNNABLE, RE-VERIFIED BEFORE IT IS HONOURED ──────────────────────
// Order matters and is deliberate: every entry is re-checked HERE, above R2, so
// that a stale exemption produces its own precise diagnosis instead of being
// silently downgraded into the generic "nothing runs this" message — or, worse,
// silencing R2 on a claim that is no longer true.
const SELF_NAME = fileURLToPath(import.meta.url).split(/[\\/]/).pop();
/** The probe must not inherit credentials or CI markers. A guard that finds a
 *  token takes a different path (and may reach the network); a guard that finds
 *  GITHUB_* believes it is in CI. Either makes the verdict depend on where this
 *  ran, and the claim under test is specifically about a runner that has none of
 *  them. Same prefixes assert-guards-refuse-empty.mjs scrubs, same reason. */
const probeEnv = () => {
  const env = { ...process.env };
  for (const k of Object.keys(env)) {
    if (/^(GITHUB_|GH_|CF_|CLOUDFLARE_|SUPABASE_|AWS_|NPM_|PADDLE_|GLITCHTIP_)/.test(k)) delete env[k];
  }
  return env;
};
/** honoured this run → observed exit code. A Map, not a Set, so the passing line
 *  can print the MEASUREMENT rather than repeat the claim. */
const notCiRunnable = new Map();
const staleExemptions = [];
for (const [g, entry] of NOT_CI_RUNNABLE) {
  const shown = `node tooling/ci/${g}${entry.probe.length ? ` ${entry.probe.join(' ')}` : ''}`;
  // Structural, before anything else: probing THIS file would spawn a copy of
  // this scan, which would spawn another. The recursion has no base case, so it
  // is refused by name rather than left to whoever adds the entry.
  if (g === SELF_NAME) {
    staleExemptions.push(`${g} — this guard cannot exempt itself: limb (c) would spawn a copy of this scan, which would spawn another.`);
    continue;
  }
  // (a) STALE BY ABSENCE. Real-repo only, for the same reason the
  //     NO_NEGATIVE_TEST_NEEDED self-check is: this map names THIS repository's
  //     files, and a fixture root legitimately holds none of them.
  if (!guards.includes(g)) {
    if (scanningRealRepo) {
      staleExemptions.push(
        `${g} — recorded as not CI-runnable on ${entry.since}, and tooling/ci no longer holds it. ` +
          'Either it moved and the entry did not follow, or it is retired and the entry should have gone with ' +
          'it. An exemption for something that is not there reports judgement over nothing.',
      );
    }
    continue;
  }
  // (b) STALE BY REACHABILITY, derived from the same graph R2 uses.
  if (reached.has(g)) {
    staleExemptions.push(
      `${g} — recorded as not CI-runnable on ${entry.since}, but it IS reached now: a workflow invokes it, or ` +
        'something a workflow runs imports it. The entry describes a state the tree has left. Delete it — the ' +
        'guard is covered by being run, which is what the exemption existed to stand in for.',
    );
    continue;
  }
  // (c) THE CLAIM ITSELF, RE-RUN. This is the limb that makes the entry cost
  //     something: the guard is spawned with the argv a runner would have and
  //     must refuse. A `why` is prose and prose rots; an observed exit code does
  //     not.
  const probe = spawnSync(process.execPath, [join(CI, g), ...entry.probe], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 120_000,
    env: probeEnv(),
  });
  if (typeof probe.status !== 'number') {
    staleExemptions.push(
      `${g} — \`${shown}\` produced no exit code (${probe.error?.message ?? `signal ${probe.signal}`}). The ` +
        'claim could not be re-verified, and an exemption that cannot be re-verified is not honoured: that is ' +
        'the difference between this map and a waiver.',
    );
    continue;
  }
  if (probe.status === 0) {
    staleExemptions.push(
      `${g} — \`${shown}\` EXITED 0. The entry claims no invocation available to a runner can make this guard ` +
        'pass, and one just did. Either it is CI-runnable now — wire it into a workflow and delete this entry — ' +
        'or it has grown a vacuous pass over a subject it never reached, which is the defect this file exists ' +
        'to catch and would now be hiding behind an exemption.',
    );
    continue;
  }
  notCiRunnable.set(g, probe.status);
}
if (staleExemptions.length) {
  console.error(`✗ COVERAGE LOST — ${staleExemptions.length} NOT_CI_RUNNABLE entr${staleExemptions.length === 1 ? 'y no longer describes' : 'ies no longer describe'} this tree:`);
  for (const s of staleExemptions) console.error(`    ${s}`);
  console.error('');
  console.error('  Every entry in that map is a claim that is RE-RUN here, not a name that is trusted. A waiver');
  console.error('  describing behaviour a file no longer has is a lie that reads as diligence — the reason two');
  console.error('  stale entries were deleted from assert-guards-refuse-empty.mjs on 2026-08-18 rather than reworded.');
  process.exit(1);
}

const uninvoked = guards.filter((g) => !reached.has(g) && !notCiRunnable.has(g));
if (uninvoked.length) {
  console.error(
    `✗ COVERAGE LOST — ${uninvoked.length} file(s) in tooling/ci are neither invoked by a workflow nor imported by one that is:`,
  );
  for (const g of uninvoked) console.error(`    ${g}`);
  console.error('  A guard nothing runs cannot fail a build. It is covered on paper and inert in practice,');
  console.error('  and it inflates every count taken over this directory.');
  console.error('  Wire it into a workflow in the same change, delete it, or — if it is a shared module —');
  console.error('  make something a workflow DOES run import it. Reachability is derived, not declared.');
  console.error('  The ONE other way out is NOT_CI_RUNNABLE, and only for a guard NO invocation available to a');
  console.error('  runner can make exit 0: that entry is re-run on every pass — spawned, and required to refuse —');
  console.error('  so it cannot be satisfied by typing a name into a list.');
  process.exit(1);
}

const rawCorpus = testFiles.map((f) => readFileSync(join(TESTS, f), 'utf8')).join('\n');

// Only EXECUTABLE lines count as evidence. `includes()` over the raw text was
// satisfied by a guard's name sitting in a comment — so a test file could be
// gutted down to its header comment and still "cover" every guard it names.
const executable = (text) =>
  text
    .split('\n')
    .filter((line) => {
      const t = line.trim();
      return !(t.startsWith('//') || t.startsWith('*') || t.startsWith('/*'));
    })
    .join('\n');

const testCorpus = executable(rawCorpus);
/** The same corpus KEPT SPLIT, comments stripped. The concatenation above can
 *  say a name appears somewhere in test/; only the per-file map can say WHICH
 *  file claims a subject, and an unattributable credit is how a test of one
 *  guard came to be the recorded failing case of another file entirely. */
const testSource = new Map(testFiles.map((f) => [f, executable(readFileSync(join(TESTS, f), 'utf8'))]));
const countCases = (text) => (text.match(/^\s*(test|it)\s*\(/gm) ?? []).length;

// A test file carrying no declaration is a file that runs nothing while still
// holding a manifest entry, so it must be caught before the ratchet records it.
const perFile = new Map(
  testFiles.map((f) => [f, countCases(executable(readFileSync(join(TESTS, f), 'utf8')))]),
);
const hollow = [...perFile.entries()].filter(([, n]) => n === 0).map(([f]) => f);
if (hollow.length) {
  console.error(`✗ COVERAGE LOST — ${hollow.length} test file(s) declare no tests: ${hollow.join(', ')}`);
  console.error('  The file is present so the ratchet would record a floor of zero for it, and it asserts nothing.');
  process.exit(1);
}

// ─────────────────────────────────────────────────────────────────────────────
// THE RATCHET — what replaced MIN_TEST_FILES and MIN_TEST_CASES.
//
// One number per test file, kept in a committed manifest THIS GUARD MAINTAINS.
//   · a recorded file that is gone      → FAIL (the test file was deleted)
//   · measured < recorded               → FAIL (cases were deleted from it)
//   · measured > recorded, or a new key → rewrite the manifest, print, PASS
//
// The asymmetry is the entire point. A rise is what an honest increment does, so
// it must never cost anything and must never need a hand edit; a drop is
// coverage leaving the tree, so it must be loud. Because the state is keyed by
// file, two branches that each add a test file write two different lines and
// merge without conflict — which is what the single shared MIN_TEST_CASES line
// could not do, and what cost three merges in one day.
// ─────────────────────────────────────────────────────────────────────────────
let recorded = {};
if (existsSync(MANIFEST)) {
  const text = readFileSync(MANIFEST, 'utf8');
  try {
    recorded = JSON.parse(text);
  } catch (e) {
    coverageLost([
      `${MANIFEST_REL} could not be parsed (${e.message}).`,
      'This file is the ratchet: unreadable means every per-file floor is gone at once, which would',
      'otherwise look exactly like a tree that had never recorded one.',
    ]);
  }
  if (typeof recorded !== 'object' || recorded === null || Array.isArray(recorded)) {
    coverageLost([`${MANIFEST_REL} is not a JSON object of "<test file>": <count>.`]);
  }
} else if (scanningRealRepo) {
  coverageLost([
    `${MANIFEST_REL} does not exist.`,
    'It is the ratchet state that replaced MIN_TEST_FILES and MIN_TEST_CASES — deleting it resets every',
    'per-file floor to nothing at once. On a fixture root this guard creates it; on the real repository',
    'its absence is the floor being removed, which is precisely what must not pass quietly.',
  ]);
}
if (scanningRealRepo && Object.keys(recorded).length === 0 && existsSync(MANIFEST)) {
  coverageLost([
    `${MANIFEST_REL} is empty.`,
    'An empty ratchet accepts any suite at all, including none — every file below would read as new and',
    'be recorded without complaint. Emptying it is deleting the floor, not resetting a cache.',
  ]);
}

const dropped = [];
for (const [f, was] of Object.entries(recorded)) {
  if (!perFile.has(f)) {
    dropped.push(`${f} — recorded with ${was} test case(s) and the file is GONE. Deleting a test file deletes a guard's only recorded failing case; if the retirement is deliberate, remove its entry here in the same change.`);
    continue;
  }
  const now = perFile.get(f);
  if (now < was) {
    dropped.push(`${f} — ${was} test case(s) recorded, ${now} found. ${was - now} case(s) left the suite.`);
  }
}
if (dropped.length) {
  console.error(`✗ COVERAGE LOST — the test-coverage ratchet went BACKWARDS in ${dropped.length} place(s):`);
  for (const d of dropped) console.error(`    ${d}`);
  console.error('');
  console.error(`  ${MANIFEST_REL} records the measured declaration count per test file. It rises by itself`);
  console.error('  and never needs a hand edit; it only ever fails when coverage LEAVES the tree, which is');
  console.error('  the one direction a floor was ever for.');
  process.exit(1);
}

// Rises and new files: rewrite, print, never fail. Written only when the bytes
// actually change, so an unchanged tree is never dirtied by running this guard.
const ratcheted = [];
const next = {};
for (const f of testFiles) {
  const now = perFile.get(f);
  const was = Object.prototype.hasOwnProperty.call(recorded, f) ? recorded[f] : null;
  if (was === null) ratcheted.push(`+ ${f} (${now})`);
  else if (now > was) ratcheted.push(`↑ ${f} ${was} → ${now}`);
  next[f] = now;
}
const serialised = `${JSON.stringify(Object.fromEntries(Object.keys(next).sort().map((k) => [k, next[k]])), null, 2)}\n`;
if (!existsSync(MANIFEST) || readFileSync(MANIFEST, 'utf8') !== serialised) {
  try {
    writeFileSync(MANIFEST, serialised);
    if (ratcheted.length) {
      notes.push(`ratchet raised in ${MANIFEST_REL} — commit it with this change:`);
      for (const r of ratcheted) notes.push(`    ${r}`);
    }
  } catch (e) {
    notes.push(`could-not-establish — ${MANIFEST_REL} is not writable (${e.message}), so the ratchet could not rise. The floors it already records still hold.`);
  }
}

const totalCases = [...perFile.values()].reduce((a, b) => a + b, 0);

let scanners = 0;
let exempt = 0;
for (const guard of guards) {
  // 1. a recorded failing case
  if (!testCorpus.includes(guard)) {
    problems.push(
      `${guard} — no test file mentions it. It has only ever run against the real repo, ` +
        'which is valid input by definition, so nothing exercises its failing path.',
    );
  }

  // 2. a coverage self-check, unless it genuinely has nothing to scan
  const source = readFileSync(join(CI, guard), 'utf8');
  const hasMarker = markerInCode(source);
  const reason = NOT_A_SCANNER.get(guard);
  if (hasMarker) {
    scanners++;
  } else if (reason) {
    exempt++;
  } else {
    problems.push(
      `${guard} — no "${COVERAGE_MARKER}" self-check. A scan that silently stops reaching the tree ` +
        'prints ok forever. Add one, or add this file to NOT_A_SCANNER with a reason that survives ' +
        'being read aloud.',
    );
  }
  // An exempt guard that later grows a scan should lose its exemption, not keep
  // it. Flag the contradiction rather than quietly preferring one signal.
  if (hasMarker && reason) {
    problems.push(
      `${guard} — listed in NOT_A_SCANNER but now contains a "${COVERAGE_MARKER}" check. ` +
        'It scans something after all; remove the exemption.',
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// WHAT "HAS A NEGATIVE TEST" MEANS FOR A SCRIPT — and why `includes(basename)`
// did not mean it.
//
// 🔴 2026-08-26. tooling/e2e/verify_purged.mjs was COUNTED AS COVERED, and the
// only file naming it was tooling/ci/test/d1-sql-inventory.test.mjs, which edits
// A COMMENT inside it: `edit(root, 'tooling/e2e/verify_purged.mjs', (s) =>
// s.replace('any single statement that names sqlite_master/sqlite_schema', 'the
// query'))`. That is a test of assert-d1-sql-inventory.mjs's R4 limb. It uses
// the file as MATERIAL and asserts on that guard's stderr; nothing there ever
// runs verify_purged.mjs, and assert-d1-sql-inventory.mjs spawns nothing at all
// (it is a static read), so no behaviour of verify_purged.mjs can move that
// assertion either way. A byte inside the file was touched; the file was never
// run.
//
// The credit outranks the exemption map, so the consequence was silent in the
// direction that matters: verify_purged.mjs's entry in NO_NEGATIVE_TEST_NEEDED
// STOPPED BEING WHAT COVERED IT — the recorded reason went unread and unprinted
// while a false one held, and the ⬜ line that exists to make that gap visible
// never mentioned it. It is the golden-path leg-6 assertion: it re-reads live D1
// and the live GoTrue admin API after the app deletes a real account, and it is
// the only thing that can catch a server answering `{ ok: true }` over a row
// that is still there.
//
// ⚠️ STRIPPING COMMENTS WOULD NOT HAVE CAUGHT IT, and neither would asking for a
// behavioural mutation. That edit IS executable code, and a foreign test's side
// effect on a file covers nothing however deep it cuts. What was missing is
// ATTRIBUTION: some test file has to put the script in the position of the thing
// being RUN.
//
// So the credit requires EXERCISED, not MENTIONED. A test file exercises a
// script when it
//   · IMPORTS it, statically or dynamically — its behaviour is under test; or
//   · SPAWNS it — the script is the executable of a child process, named at the
//     head of the argv either directly or through a runner defined in the same
//     file (`function run(script) { spawnSync(process.execPath, [join(OPS,
//     script), …]) }`, which is how tooling/ops/verify-*.mjs are exercised).
// A path inside an assertion, a regex, a fixture edit or a workflow string built
// for some other guard's fixture is the script being TALKED ABOUT, and is not
// evidence about its failing path.
//
// THE LIMIT, IN ONE SENTENCE: this is a static reading of the test source, so it
// establishes that the script is executed under test, not that some assertion
// would go red if it stopped working.
// ─────────────────────────────────────────────────────────────────────────────

/** Depth-0, quote-aware elements of a bracketed argument list. `text` starts
 *  just INSIDE the bracket; scanning stops at the matching `close`. Written out
 *  rather than regexed because the two shapes that matter here — `[join(OPS,
 *  script), ...args]` and `(root, { workflow: '…' })` — both put commas inside
 *  nested brackets, and a split on `,` reads `join(OPS` as the executable. */
const argElements = (text, close) => {
  const out = [];
  let depth = 0;
  let cur = '';
  let quote = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      cur += c;
      if (c === quote && text[i - 1] !== '\\') quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; cur += c; continue; }
    if (c === '(' || c === '[' || c === '{') { depth++; cur += c; continue; }
    if (c === close && depth === 0) { out.push(cur); return out; }
    if (c === ')' || c === ']' || c === '}') { depth--; cur += c; continue; }
    if (c === ',' && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  out.push(cur);
  return out;
};

// ── which BYTES are code, by OFFSET ─────────────────────────────────────────
// ⏱ 2026-08-27. Every rule below matches a shape — `from '…'`, `spawnSync(`,
// `const X =` — and a shape spelled INSIDE a string literal is the same bytes as
// one spelled in code. A fixture body carrying `"import p from './x.mjs';"`
// credited x.mjs with being imported by a test that only ever wrote it into a
// temp file. So each match is now asked WHERE IT STARTS.
//
// Not `stripStringLiterals` composed onto the matcher: the path in a GENUINE
// import lives inside the literal too, so matching the blanked text deletes
// every real credit with the fake one. Only the offsets are taken from here;
// the regexes still read the original bytes.
//
// Same length as its input by construction — replacement, never deletion — so
// `mask[i]` describes `text[i]`. NUL marks a byte that is inside a string
// literal or a comment; a template literal's `${…}` is code again, because it
// is. Regex literals are recognised so a `/[^'"]/` cannot open a string that
// never closes and blank the rest of the file.
const NON_CODE = '\u0000';
const REGEX_MAY_START = /(?:[([{,;:=!&|?+\-*%~^<>\n]|\b(?:return|typeof|case|in|of|do|else|yield|await|new|delete|void|instanceof))\s*$/;
const maskCache = new Map();
const codeMask = (text) => {
  const hit = maskCache.get(text);
  if (hit !== undefined) return hit;
  const m = text.split('');
  const blank = (a, b) => { for (let k = a; k < b; k++) m[k] = NON_CODE; };
  const tpl = [];
  let brace = 0;
  let i = 0;
  const scanString = (start, q) => {
    let k = start + 1;
    while (k < text.length) {
      const c = text[k];
      if (c === '\\') { k += 2; continue; }
      if (c === q) { blank(start, k + 1); return k + 1; }
      if (q === '`' && c === '$' && text[k + 1] === '{') {
        blank(start, k + 2);
        tpl.push(brace);
        brace = 0;
        return k + 2;
      }
      if (q !== '`' && c === '\n') { blank(start, k); return k; }
      k++;
    }
    blank(start, text.length);
    return text.length;
  };
  while (i < text.length) {
    const c = text[i];
    if (c === '/' && text[i + 1] === '/') {
      const nl = text.indexOf('\n', i);
      const end = nl < 0 ? text.length : nl;
      blank(i, end);
      i = end;
      continue;
    }
    if (c === '/' && text[i + 1] === '*') {
      const close = text.indexOf('*/', i + 2);
      const end = close < 0 ? text.length : close + 2;
      blank(i, end);
      i = end;
      continue;
    }
    if (c === '/' && REGEX_MAY_START.test(text.slice(Math.max(0, i - 12), i))) {
      let k = i + 1;
      let cls = false;
      while (k < text.length && text[k] !== '\n') {
        const d = text[k];
        if (d === '\\') { k += 2; continue; }
        if (d === '[') cls = true;
        else if (d === ']') cls = false;
        else if (d === '/' && !cls) { k++; break; }
        k++;
      }
      blank(i, k);
      i = k;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { i = scanString(i, c); continue; }
    if (c === '{') { brace++; i++; continue; }
    if (c === '}') {
      if (brace === 0 && tpl.length) {
        brace = tpl.pop();
        m[i] = NON_CODE;
        i = scanString(i, '`');
        continue;
      }
      if (brace > 0) brace--;
      i++;
      continue;
    }
    i++;
  }
  const out = m.join('');
  if (maskCache.size > 400) maskCache.clear();
  maskCache.set(text, out);
  return out;
};

/** Every child-process call in `text`, reduced to the EXECUTABLE it runs: the
 *  first argv element when the binary is node itself, the first argument
 *  otherwise. Position is the whole point — a path in argv[1] is an ARGUMENT to
 *  some other program, which is how a guard's own fixture path shows up.
 *  `isCode(i)` rejects a call that is only being QUOTED, never made — and it is
 *  REQUIRED, not defaulted, so a future call site that forgets it throws rather
 *  than quietly crediting every quoted spawn in the corpus. */
const SPAWN_CALL = /(?:spawnSync|spawn|execFileSync|execFile|fork)\(/g;
const spawnedExecutables = (text, isCode) => {
  const heads = [];
  for (const m of text.matchAll(SPAWN_CALL)) {
    if (!isCode(m.index)) continue;
    const args = argElements(text.slice(m.index + m[0].length), ')');
    if (!args.length) continue;
    const first = (args[0] ?? '').trim();
    if (!/execPath/.test(first)) { heads.push(first); continue; }
    const argv = (args[1] ?? '').trim();
    heads.push(argv.startsWith('[') ? (argElements(argv.slice(1), ']')[0] ?? '') : argv);
  }
  return heads;
};

const reEscape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Does this ONE test file exercise `base` — or does it merely name it?
 * Returns a short phrase naming HOW (so the credit can be attributed out loud)
 * or null. Comments are already stripped by the caller.
 */
const exercisedBy = (text, base) => {
  const mask = codeMask(text);
  const isCode = (i) => mask[i] !== NON_CODE;
  /** The first match whose FIRST BYTE is code — a match that starts inside a
   *  string literal is a shape being quoted, not one being run. */
  const inCode = (re) => {
    for (const m of text.matchAll(re)) if (isCode(m.index)) return m;
    return null;
  };
  const b = reEscape(base);
  const literal = new RegExp(`['"\`][^'"\`]*${b}['"\`]`);
  if (inCode(new RegExp(`from\\s*['"\`][^'"\`]*${b}['"\`]`, 'g'))) return 'imports it';
  if (inCode(new RegExp(`import\\(\\s*['"\`][^'"\`]*${b}['"\`]`, 'g'))) return 'imports it';

  // Identifiers bound to a PATH ENDING IN the file — `const SCRIPT = resolve(
  // CI_DIR, '..', 'scripts', 'provision-backend.mjs');`. The literal must be the
  // last thing in the expression: `const root2 = seeded({ workflow: '… node
  // tooling/scripts/provision-backend.mjs …' })` also mentions the name, and
  // binding that identifier would credit a fixture root for being a script.
  const bound = new Set();
  for (const m of text.matchAll(new RegExp(`(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*=([^;]*?);`, 'g'))) {
    if (!isCode(m.index)) continue;
    if (new RegExp(`['"\`][^'"\`]*${b}['"\`][\\s)]*$`).test(m[2].trim())) bound.add(m[1]);
  }
  const namesFile = (expr) => literal.test(expr) || [...bound].some((i) => new RegExp(`\\b${reEscape(i)}\\b`).test(expr));

  for (const head of spawnedExecutables(text, isCode)) if (namesFile(head)) return 'runs it';
  if ([...bound].some((i) => inCode(new RegExp(`import\\(\\s*${reEscape(i)}`, 'g')))) return 'imports it';

  // A runner defined in this file whose EXECUTABLE is built from one of its own
  // parameters. The script is then handed to it at that position — as a bare
  // literal or a bound identifier, never as one string inside a larger one.
  const runners = new Map();
  for (const re of [/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(/g, /function\s+([A-Za-z_$][\w$]*)\s*\(/g]) {
    for (const m of text.matchAll(re)) {
      if (!isCode(m.index)) continue;
      const at = m.index + m[0].length;
      const after = text.slice(at);
      const params = argElements(after, ')').map((p) => p.trim().split(/[\s=:]/)[0]).filter((p) => /^[A-Za-z_$][\w$]*$/.test(p));
      if (!params.length) continue;
      for (const head of spawnedExecutables(after.slice(0, 1200), (i) => isCode(at + i))) {
        const idx = params.findIndex((p) => new RegExp(`\\b${reEscape(p)}\\b`).test(head));
        if (idx >= 0) runners.set(m[1], idx);
      }
    }
  }
  const exactly = new RegExp(`^['"\`][^'"\`]*${b}['"\`]$`);
  for (const [name, idx] of runners) {
    for (const m of text.matchAll(new RegExp(`\\b${reEscape(name)}\\(`, 'g'))) {
      if (!isCode(m.index)) continue;
      const arg = (argElements(text.slice(m.index + m[0].length), ')')[idx] ?? '').trim();
      if (arg && (exactly.test(arg) || bound.has(arg))) return `runs it via ${name}()`;
    }
  }
  return null;
};

// ── the detector's OWN negative test, run on every invocation ───────────────
// Same reason markerInCode carries one: if `exercisedBy` ever regressed to the
// `includes(basename)` it replaced, this file would go back to crediting a
// script for being named by a test of something else, and go on printing a
// healthy covered count while doing it. The first canary is the SHAPE THAT
// CAUSED THIS — a fixture edit naming the file, in executable code — and it must
// come out uncovered; the second is a real spawn and must come out covered.
//
// ⏱ APPENDED 2026-08-27 — a THIRD and FOURTH, the pair codeMask exists for: the
// same import statement, once inside a string literal and once as code. The two
// above differ in SHAPE, so a matcher with no notion of string context would
// still tell them apart; these two do not differ in shape, so nothing but the
// offsets can separate them. The quoted one also carries an astral character —
// that is what gives the length check below something to fail on.
const CANARY_NAMED_ONLY = [
  "edit(root, 'tooling/e2e/canary_subject.mjs', (s) => s.replace('one sentence', 'another'));",
  "assert.match(r.stderr, /tooling\\/e2e\\/canary_subject\\.mjs/);",
  '',
].join('\n');
const CANARY_RUNS_IT = [
  "const r = spawnSync(process.execPath, [join(E2E, 'canary_subject.mjs'), '--check'], { encoding: 'utf8' });",
  'assert.equal(r.status, 1);',
  '',
].join('\n');
const CANARY_IMPORT_QUOTED = [
  'const fixture = "\u{1F534} import subject from \'#e2e/canary_subject.mjs\';";',
  'writeFileSync(join(root, generated), fixture);',
  '',
].join('\n');
const CANARY_IMPORT_REAL = [
  "import subject from '#e2e/canary_subject.mjs';",
  'assert.equal(subject.check(), 1);',
  '',
].join('\n');
const canary = (t) => exercisedBy(t, 'canary_subject.mjs');
const maskLen = codeMask(CANARY_IMPORT_QUOTED).length;
if (canary(CANARY_NAMED_ONLY) || !canary(CANARY_RUNS_IT) || canary(CANARY_IMPORT_QUOTED) || !canary(CANARY_IMPORT_REAL) || maskLen !== CANARY_IMPORT_QUOTED.length) {
  coverageLost([
    'the negative-test DETECTOR no longer distinguishes a script that is RUN from one that is merely NAMED.',
    `A fixture edit naming the file read as ${canary(CANARY_NAMED_ONLY) ?? 'null'} (must be null) and a`,
    `spawn of it read as ${canary(CANARY_RUNS_IT) ?? 'null'} (must not be null).`,
    `An import written INSIDE A STRING read as ${canary(CANARY_IMPORT_QUOTED) ?? 'null'} (must be null) and the`,
    `same import written as code read as ${canary(CANARY_IMPORT_REAL) ?? 'null'} (must not be null).`,
    `The mask measured ${maskLen} over a ${CANARY_IMPORT_QUOTED.length}-char fixture (must be EQUAL — it carries an`,
    'astral character, and a mask built per CODE POINT is shorter than its input, so every offset past it is wrong).',
    'Until this holds, every "has a negative test" verdict for a script outside tooling/ci is the basename',
    'grep that credited tooling/e2e/verify_purged.mjs to a test of assert-d1-sql-inventory.mjs, which edits a',
    'COMMENT inside it and asserts on another guard entirely.',
  ]);
}

// ── [pipeline S-12r] the workflow-invoked executables OUTSIDE tooling/ci ───── (absent from origins.lock.json by construction — S-12r is a residual id, never a pipeline heading)
// DERIVED, not hand-listed: whatever the tracked workflows run under tooling/
// that is not a guard must still carry a negative test, or appear in
// NO_NEGATIVE_TEST_NEEDED with a reason. `tooling/scripts/provision-backend.mjs`
// — the one command the stamp's printed checklist tells the owner to run — had
// neither F-10 property purely because it sits one directory away from the set
// this scan reads. A filing accident was deciding what got covered.
let covered = 0;
const scriptExempt = [];
const creditOverridesException = [];
for (const rel of [...invokedOutside].sort()) {
  if (!existsSync(join(ROOT, rel))) {
    problems.push(
      `COVERAGE LOST — a workflow invokes ${rel}, which does not exist. CI runs a path that is not there, ` +
        'so the step either never runs or fails for a reason nobody reads as coverage loss.',
    );
    continue;
  }
  const reason = NO_NEGATIVE_TEST_NEEDED.get(rel);
  const base = rel.split('/').pop();
  // ⚠️ THERE IS DELIBERATELY NO "excused but a test names it after all" CHECK
  // here, though NOT_A_SCANNER carries the equivalent contradiction check above
  // and the symmetry is tempting. The signal is not strong enough to invert:
  // "the basename appears somewhere in the suite" is a WEAK proxy read as
  // positive evidence everywhere else in this file, and reading the same proxy
  // as negative evidence makes it fire on the one file that must name these
  // paths — THIS guard's own test, which has to model the exemption list to
  // test anything about it. Written, it failed immediately on its first real
  // run, and the only ways to satisfy it were to obfuscate the fixture or to
  // stop modelling the tree. An assertion that cannot tell its failure from a
  // false positive is worse than none, for the same reason as one that cannot
  // fail at all. The exemption is still self-checked below, against the DERIVED
  // signal — a workflow either invokes the script or it does not.
  //
  // ⏱ APPENDED 2026-08-26 — the paragraph above is left EXACTLY as written; this
  // corpus appends dated corrections rather than rewriting them. The weak proxy
  // it describes is no longer what credits a script HERE: the credit below is
  // EXERCISED (spawned or imported), attributed to the test file that makes it.
  // The excused-but-covered state is still not asserted on, for the reason the
  // paragraph gives — it is PRINTED instead.
  const claims = [];
  const namesOnly = [];
  for (const [f, text] of testSource) {
    const how = exercisedBy(text, base);
    if (how) claims.push(`${f} ${how}`);
    else if (text.includes(base)) namesOnly.push(f);
  }
  if (claims.length) {
    covered++;
    // The state this file was in for as long as nobody looked: a credit standing
    // OVER a recorded exception, so the exception silently stopped being what
    // covered the script and the ⬜ line that exists to make that gap visible
    // never mentioned it again. Printed now, both ways round.
    if (reason) {
      creditOverridesException.push(
        `${rel} — exercised by ${claims.join(', ')}, so its NO_NEGATIVE_TEST_NEEDED entry is no longer ` +
          'what covers it. Delete the entry, or check the credit is not incidental.',
      );
    }
  } else if (reason) {
    scriptExempt.push(`${rel} — ${reason}`);
  } else {
    problems.push(
      `${rel} — a workflow runs it and no test file EXERCISES it: nothing spawns it and nothing imports ` +
        'it, so nothing has ever run its failing path' +
        (namesOnly.length
          ? `. ${namesOnly.join(', ')} name${namesOnly.length === 1 ? 's' : ''} it without running it — the ` +
            'file used as MATERIAL by a test whose subject is something else, which is a byte touched and ' +
            'not a behaviour exercised. '
          : '. ') +
        'Give it a negative test that spawns or imports it, or record an exception in ' +
        'NO_NEGATIVE_TEST_NEEDED with a reason that survives being read aloud.',
    );
  }
}
// The exemption map's own self-check: an entry naming a script no workflow runs
// any more sits there looking like a considered exception while covering
// nothing — this guard's failure mode applied to itself.
//
// REAL-REPO ONLY, because the map names THIS repository's paths: a fixture root
// legitimately has none of them, and firing there would mean every fixture had
// to model the e2e harness to say anything about anything else. Its own failing
// case is in `describe('real-repo mode')`, reached by invoking a copy of this
// guard inside a fixture with no argument — the same way ci.yml calls it.
for (const rel of scanningRealRepo ? NO_NEGATIVE_TEST_NEEDED.keys() : []) {
  if (!invokedOutside.has(rel)) {
    problems.push(
      `${rel} is excused in NO_NEGATIVE_TEST_NEEDED but no workflow invokes it. Either it moved and the ` +
        'entry did not follow, or it is retired and the entry should have gone with it. An exception ' +
        'for something that is not there reports judgement over nothing.',
    );
  }
}

if (problems.length) {
  console.error(`✗ guard coverage — ${problems.length} problem(s):`);
  for (const p of problems) console.error(`    ${p}`);
  console.error('');
  console.error('  [pipeline F-10] Every guard needs a recorded failing case AND a self-check that');
  console.error('  its own scan still reaches everything it claims to cover. This is the mechanism');
  console.error('  every other requirement in all fourteen stages rests on.');
  process.exit(1);
}

if (notCiRunnable.size) {
  console.log('⬜ tooling/ci guards recorded NOT CI-RUNNABLE, printed not hidden — each claim RE-RUN just now:');
  for (const [g, status] of notCiRunnable) {
    const e = NOT_CI_RUNNABLE.get(g);
    const shown = `node tooling/ci/${g}${e.probe.length ? ` ${e.probe.join(' ')}` : ''}`;
    console.log(`    ${g} — since ${e.since}. \`${shown}\` exited ${status} on this run (non-zero is the exemption's price of admission).`);
    console.log(`        ${e.why}`);
  }
}
if (scriptExempt.length) {
  console.log('⬜ workflow-invoked scripts outside tooling/ci with a recorded exception, printed not hidden:');
  for (const s of scriptExempt) console.log(`    ${s}`);
}
if (creditOverridesException.length) {
  console.log('⬜ a real negative test now stands over a recorded exception — the entry has stopped being what covers the file:');
  for (const c of creditOverridesException) console.log(`    ${c}`);
}
if (notes.length) {
  console.log('⬜ notes:');
  for (const n of notes) console.log(`    ${n}`);
}

console.log(
  `ok  guard coverage — ${guards.length} file(s) in tooling/ci, all accounted for: ${invokedGuards.size} invoked by ` +
    `${workflowFiles.length} workflow(s), ${reached.size - invokedGuards.size} imported by one that is, and ` +
    `${notCiRunnable.size} recorded not CI-runnable and re-verified refusing ` +
    '(identity holds, no floor involved); all named in ' +
    `${testFiles.length} test file(s); ${scanners} carry a coverage self-check, ${exempt} exempt with a ` +
    `recorded reason; ${covered} workflow-invoked script(s) outside tooling/ci also covered, ` +
    `${scriptExempt.length} excused; ratchet holds at ${totalCases} test case(s) across ${testFiles.length} file(s)`,
);
