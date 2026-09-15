#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-mutation-proofs.mjs — the Dart side of "the guards can still fail".
//
// THE GAP THIS EXISTS FOR. `tooling/ci/` carries three meta-guards that police
// the JS guards: assert-guard-coverage.mjs proves every guard is TESTED,
// assert-guards-refuse-empty.mjs proves every guard REFUSES an empty subject,
// and assert-case-count-honest.mjs proves the recorded case floor is what
// actually RAN. Nothing anywhere did the equivalent for the Dart tests. The
// only mechanical clause about a Dart mutation was limb 3 of
// assert-app-dod.mjs, and it is a DATE COMPARISON — `mut.date < day` — which
// asks whether somebody typed a recent enough day, never whether the mutation
// still reddens the test. A date is a claim. This guard makes it a state.
//
// ── WHAT A ROW CLAIMS, AND WHAT WAS CHECKABLE BEFORE ─────────────────────────
// A `dod.json` feature row says: test T asserts effect E, and on date D somebody
// edited E and watched T go red. Three of those four were already machine-
// checkable — assert-app-dod.mjs resolves T to a real non-empty declaration and
// E to a symbol outside comments. The fourth, "and it went red", was prose with
// a date beside it. So a row could be true on the day it was written and be a
// fossil a week later, and the tree would print `ok` either way.
//
// ── THE MEASUREMENT THAT SETS THE SHAPE, 2026-09-09, THIS BOX ────────────────
// The obvious design is "re-run every mutation on every push". It was priced
// before it was rejected, on apps/subscriptiontracker/test/chassis_properties_test.dart,
// which is the file six of the fourteen rows name:
//
//   · GREEN CONTROL, COLD CACHE  `flutter test test/chassis_properties_test.dart`
//     exit 0 — 107 cases — 5m45s wall, of which 2m07s was test execution.
//   · GREEN CONTROL, WARM CACHE  the identical command immediately after:
//     exit 0 — 107 cases — 3m21s wall, of which 55s was test execution.
//
// So ~2m26s of every invocation is fixed tool overhead that no test selection
// can remove; `--plain-name` narrows the 55s, not the 2m26s. The fourteen rows
// resolve to SIX distinct test files, so the cheapest honest full sweep is 6
// controls + 14 mutants = 20 invocations. At the WARM number that is 67 minutes,
// and a mutant edits a `lib/` file — which invalidates the incremental kernel,
// so every mutant run pays nearer the cold number. Realistic full sweep: 90–140
// minutes, before `flutter pub get`.
//
// `guard-meta` is capped at `timeout-minutes: 25`. Sharding does not rescue it:
// each shard pays the COLD cost twice and adds a `setup-flutter` per shard, so
// fourteen shards buy ~12 minutes of wall clock for fourteen times the runner
// spend, against a repository whose CI runs on the free GitHub-hosted tier.
//
// 🔴 SO THIS GUARD IS TWO GUARDS IN ONE FILE, AND THE SPLIT IS THE MEASUREMENT:
//   · DEFAULT (no flag) — STATIC, and it is what runs on every push. It costs
//     milliseconds and needs neither Flutter nor a checkout deeper than one
//     commit. It proves each proof is still ADDRESSED AT THE CODE IT WAS RUN
//     AGAINST, and that it is still MECHANICALLY RE-RUNNABLE.
//   · `--execute` — DYNAMIC. Applies each recorded edit to the real tree, runs
//     the named test, and requires RED with the recorded message in the output,
//     green control first. It is for the nightly lane and for the terminal of
//     whoever re-earns a row. It is NOT wired into a per-push job, and the
//     paragraph above is why.
//
// ── LIMB 1 · THE HASH IS THE FRESHNESS CHECK, AND IT REPLACES A GIT WALK ─────
// assert-app-dod.mjs limb 3 dates each row against `lastCodeChangeDay`, which
// walks `git log -- <path>`. That function's own header names the stronger
// design — "a content hash of the stripped implementation recorded in the row
// itself — no git, no history walk, and it works on the shallow clone this
// guard currently calls COVERAGE LOST" — and this is it.
//
// 🔴 IT WAS NOT PREFERRED ON TASTE. THE GIT WALK WAS MEASURED BROKEN.
// Commit c92bfb80 (#567) moved `apps/subly/` to `apps/subscriptiontracker/`.
// `git log -- apps/subscriptiontracker/lib/features/auth/login_screen.dart`
// reports exactly ONE commit — the rename — because without `--follow` the path
// has no history before it existed. `lastCodeChangeDay` therefore never compares
// two blobs and returns the rename day for every effect file in the record.
// Measured 2026-09-09 against apps/subscriptiontracker/dod.json: ALL FOURTEEN
// rows read 2026-09-09 and ALL FOURTEEN expire.
//
// ⚠️ AND `--follow` ALONE IS A NO-OP, WHICH IS WHY IT IS NOT THE FIX. The walk
// reads each version with `git show <sha>:<relPath>` where `relPath` is fixed at
// the CURRENT path. At any pre-rename commit that path did not exist, so git
// exits 128 (`exists on disk, but not in <sha>`), `codeAt` returns null, and the
// walk stops and returns the newest commit's day — the rename day again.
// Measured, all fourteen rows, three ways:
//
//   row                 | recorded | as-is      | --follow   | rename-aware
//   sign in             | 08-10    | 2026-09-09 | 2026-09-09 | 2026-09-05
//   sign out            | 08-10    | 2026-09-09 | 2026-09-09 | 2026-09-04
//   finish onboarding   | 08-10    | 2026-09-09 | 2026-09-09 | 2026-09-09
//   edit profile        | 08-10    | 2026-09-09 | 2026-09-09 | 2026-09-05
//   consent prompt      | 08-10    | 2026-09-09 | 2026-09-09 | 2026-09-04
//   dark mode           | 08-10    | 2026-09-09 | 2026-09-09 | 2026-09-04
//   home                | 08-10    | 2026-09-09 | 2026-09-09 | 2026-08-25
//   calendar            | 08-08    | 2026-09-09 | 2026-09-09 | 2026-09-05
//   insights            | 08-08    | 2026-09-09 | 2026-09-09 | 2026-08-25
//   budget              | 08-10    | 2026-09-09 | 2026-09-09 | 2026-08-25
//   scan                | 08-08    | 2026-09-09 | 2026-09-09 | 2026-09-05
//   detail              | 08-08    | 2026-09-09 | 2026-09-09 | 2026-08-21
//   add subscription    | 08-08    | 2026-09-09 | 2026-09-09 | 2026-08-21
//   cancel subscription | 08-08    | 2026-09-09 | 2026-09-09 | 2026-08-21
//
// The `--follow` column is IDENTICAL to the as-is column, every row. And the
// third column is the finding that matters more than the bug: with a walk that
// resolves the path at each commit, every one of the fourteen rows is STILL
// expired, because the real last-code-change days (2026-08-21 … 2026-09-09) are
// all later than the recorded days (2026-08-08 … 2026-08-10). The rows are
// genuinely stale. What the missing `--follow` destroyed was not the verdict, it
// was the ability to tell a genuine expiry from a rename artefact: every row
// read the same wrong day, so the column carried no information at all.
//
// A hash is immune to all of this. It does not consult history, so a rename
// cannot blind it and a `fetch-depth: 1` checkout cannot starve it, and it is
// the same definition of "code" the two limbs above it already use —
// `stripDartComments`, imported from `dart-source.mjs` — where it moved today,
// verbatim, out of assert-app-dod.mjs — rather than grown a second time, because
// two strippers disagreeing about what a Dart file's code is is the defect that
// produced `lastCodeChangeDay` in the first place, when two limbs of that one
// guard disagreed with each other about it.
//
// ── LIMB 2 · A PROOF THAT CANNOT BE RE-RUN IS PROSE ──────────────────────────
// The schema before today recorded WHAT was mutated (`mutation.symbol`) and what
// was SEEN (`mutation.observedRed`), and never HOW. `lib/…/login_screen.dart:
// signInWithEmail` does not say what was done to it, so nobody — no person and
// no harness — can reproduce the run. This guard requires `mutation.edit`, a
// literal `{find, replace}` against the effect file, and checks that `find`
// occurs EXACTLY ONCE in that file today. Not "at least once": a mutation with
// two landing sites is two different experiments sharing one record.
//
// ── LIMB 3 · THE RATCHET, WHICH IS THE HONEST HALF ───────────────────────────
// Twenty rows exist and they cannot all be re-earned in one sitting, because
// re-earning one means RUNNING it — this file's whole argument is that a row may
// never be re-dated on the strength of an argument. So a row without an
// executable proof is not waived and is not silently tolerated: it is UNPROVEN,
// it is PRINTED BY NAME on every run, and the count is ratcheted. Adding an
// unproven row FAILS. Un-proving a proven one FAILS. The floor moves DOWN only,
// alone, in a commit carrying the transcript of the run that moved it.
//
// That is rule 10 of docs/verification-discipline.md applied to a gap that
// cannot be closed in a build: print it, name what would close it, and make the
// number that describes it unable to grow.
//
// ── WHY THIS GUARD DOES NOT INHERIT assert-app-dod.mjs's EXEMPTION ───────────
// `apps/subscriptiontracker` is exempt there BY NAME as the frozen rail-prover,
// which is why the fourteen richest proofs in this tree are graded by nothing
// while six brick rows are graded per push. That exemption is NOT copied here,
// and dropping it there is deliberately not attempted: assert-app-dod.mjs's
// lifecycle anchor fails on `catalog/apps.json` saying `"status": "live"` while
// the record says `"status": "stamped"`, so emptying that Set reddens the tree
// for a reason that has nothing to do with mutations. This guard's domain is
// RECORDS, not apps — every tracked `dod.json`, wherever it lives — so it grades
// all twenty rows today without touching the lifecycle question at all.
//
// ── WHAT --execute DOES, AND THE TWO WAYS IT REFUSES TO BE FOOLED ────────────
//   1. GREEN CONTROL FIRST. The named test file is run UNMUTATED and must exit
//      0. A red control means the tree is already broken and nothing can be
//      concluded from the mutant's red — rule 6.
//   2. A COMPILE ERROR IS NOT A CAUGHT MUTANT. Rule 8: they are identical from
//      the exit code. So a non-zero run must ALSO print `mutation.observedRed`,
//      and a run whose output carries a loader/analyzer failure is COVERAGE
//      LOST, never a pass.
//
// THE TREE IS RESTORED ON EVERY PATH — after each row, in a `finally`, and again
// from SIGINT/SIGTERM/uncaughtException handlers, because a harness that leaves
// a mutated `lib/` file behind poisons every sibling worktree's next run.
//
// Usage:
//   node tooling/ci/assert-mutation-proofs.mjs [repoRoot]
//   node tooling/ci/assert-mutation-proofs.mjs [repoRoot] --execute [--only <row name>]
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, existsSync, openSync, closeSync, mkdtempSync, rmSync, fstatSync, readSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listDir } from './tree-walk.mjs';
import { stripDartComments } from './dart-source.mjs';
import { reapProcessGroup } from './flutter-stock-assets.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flags = argv.filter((a) => a.startsWith('--'));
const positional = argv.filter((a) => !a.startsWith('--'));

// 🔴 AN EXPLICIT FLAG, NEVER `argv[2] === undefined`. assert-guards-refuse-empty
// carried exactly that shape until 2026-08-17, when it was found that any stray
// positional argument silently disabled every floor it had. The mode here is
// read from a named flag, and an unrecognised flag is a hard error rather than a
// silently-ignored word.
const KNOWN_FLAGS = new Set(['--execute', '--only']);
for (const f of flags) {
  if (!KNOWN_FLAGS.has(f)) {
    console.error(`FAIL unknown flag ${f} — this guard takes --execute and --only <row name> only.`);
    process.exit(1);
  }
}
const EXECUTE = flags.includes('--execute');
const onlyAt = argv.indexOf('--only');
const ONLY = onlyAt === -1 ? null : argv[onlyAt + 1];
if (onlyAt !== -1 && (!ONLY || ONLY.startsWith('--'))) {
  console.error('FAIL --only needs a row name.');
  process.exit(1);
}
if (ONLY && !EXECUTE) {
  console.error('FAIL --only is meaningless without --execute: the static limbs check every row or none.');
  process.exit(1);
}
const ROOT = resolve((ONLY ? positional.filter((p) => p !== ONLY) : positional)[0] ?? join(HERE, '..', '..'));

// ── THE RATCHET lives in tooling/dod-register.json, NOT in this file.
//    A floor compiled into the guard cannot be pointed somewhere smaller, so
//    every fixture would have to satisfy the REAL tree's count of twenty and no
//    negative test could describe a two-row tree. assert-case-count-honest.mjs
//    refuses a `--partial` flag for the same reason and gives the same remedy:
//    "point --manifest at a smaller manifest instead: that is a visible,
//    committed artefact, not an invisible argument." The register row carries
//    the number, the date it was measured, and the command that measures it.
const REGISTER_REL = 'tooling/dod-register.json';

// The record's own key for a machine-executable proof. A row carrying this is
// re-runnable by this guard; a row without it is UNPROVEN and printed.
const EDIT_KEY = 'edit';
const HASH_KEY = 'codeHash';

const problems = [];
const fail = (m) => problems.push(m);
const abs = (rel) => join(ROOT, rel);
const read = (rel) => readFileSync(abs(rel), 'utf8');
const has = (rel) => existsSync(abs(rel));

/** Structural failure: everything below quantifies over what just went missing,
 *  so continuing would print a clean sweep of nothing. */
function coverageLost(lines) {
  console.error(`FAIL COVERAGE LOST — ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(`     ${l}`);
  console.error('\nassert-mutation-proofs: FAILED');
  // ⏱ 2026-09-15 — exit 2, not 1: COVERAGE LOST is "did not check enough to be evidence", never a
  // finding (AGENTS.md exit-code convention; O-EXIT2-CONVENTION-GAP). This helper exited 1 until today.
  process.exit(2);
}

const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex');

/** A test name is user prose and goes into a RegExp, so it is escaped. Declared
 *  here rather than beside `testFileFor` because that function is hoisted and
 *  called from the row loop above it, which would reach this `const` in its
 *  temporal dead zone. */
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The hash a row must carry: the effect file's CODE, comments gone, trailing
 *  whitespace gone, blank lines gone. Identical normalisation to the one
 *  `lastCodeChangeDay` applies to each historical blob, and it uses that file's
 *  stripper rather than a second copy. */
function codeHashOf(relPath) {
  return sha256(
    stripDartComments(read(relPath))
      .split('\n')
      .map((l) => l.replace(/\s+$/, ''))
      .filter((l) => l !== '')
      .join('\n'),
  );
}

// ── THE DOMAIN: every `dod.json` in the tree, found by walking, then checked
//    against what git says is tracked. A directory listing alone can silently
//    shrink; the cross-check is a RELATIONSHIP to a set this guard does not
//    maintain, so it cannot be shrunk to make this pass.
function findRecords() {
  const out = [];
  const walk = (absDir, rel, depth) => {
    if (depth > 8) return;
    let entries;
    try {
      entries = listDir(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name === '.git' || e.name === 'node_modules' || e.name === 'build' || e.name === 'Private') continue;
      const p = join(absDir, e.name);
      const r = rel === '' ? e.name : `${rel}/${e.name}`;
      if (e.isDirectory()) walk(p, r, depth + 1);
      else if (e.name === 'dod.json') out.push(r);
    }
  };
  for (const top of ['apps', 'tooling']) {
    if (has(top)) walk(abs(top), top, 0);
  }
  return out.sort();
}

function trackedRecords() {
  const ls = spawnSync('git', ['-C', ROOT, 'ls-files', '*dod.json'], { encoding: 'utf8' });
  if (ls.status !== 0) return null;
  return ls.stdout.trim().split('\n').filter((l) => l !== '').sort();
}

// The floor is read BEFORE anything ranges over it: a missing or malformed row
// leaves limb 4 with no right-hand side, and an assertion with no right-hand
// side is an assertion that cannot fail.
if (!has(REGISTER_REL)) {
  coverageLost([
    `${REGISTER_REL} is not on disk, so the unproven ratchet has no floor to compare against.`,
    'Limb 4 would then be an assertion with no right-hand side, which this tree deletes rather than keeps.',
  ]);
}
let UNPROVEN_FLOOR;
try {
  const reg = JSON.parse(read(REGISTER_REL));
  UNPROVEN_FLOOR = reg?.mutationProofs?.unprovenFloor;
} catch (e) {
  coverageLost([`${REGISTER_REL} is not readable JSON: ${e && e.message ? e.message : e}`]);
}
if (!Number.isInteger(UNPROVEN_FLOOR) || UNPROVEN_FLOOR < 0) {
  coverageLost([
    `${REGISTER_REL} carries no integer \`mutationProofs.unprovenFloor\`, so the ratchet cannot fire in either direction.`,
    'That row is the entire mechanism by which the gap closes rather than becoming permanent.',
  ]);
}

const records = findRecords();
if (records.length === 0) {
  coverageLost([
    'no dod.json record was found under apps/ or tooling/, so every limb below would',
    'quantify over the empty set and print a clean sweep of nothing.',
    'This guard grades mutation proofs; with no record there are no proofs to grade.',
  ]);
}

const tracked = trackedRecords();
if (tracked !== null) {
  const missed = tracked.filter((t) => !records.includes(t));
  if (missed.length > 0) {
    coverageLost([
      `git tracks ${tracked.length} dod.json record(s); this walk found ${records.length} and MISSED ${missed.length}.`,
      ...missed.map((m) => `  · ${m}`),
      'A walk that cannot reach a tracked record grades a subset while reporting on the whole.',
    ]);
  }
}

// ── Read every record, and refuse a record whose rows cannot be found.
const rows = [];
for (const rel of records) {
  let rec;
  try {
    rec = JSON.parse(read(rel));
  } catch (e) {
    fail(`${rel} — is not readable JSON: ${e && e.message ? e.message : e}`);
    continue;
  }
  const appDir = dirname(rel);
  const feats = Array.isArray(rec.features) ? rec.features : [];
  if (feats.length === 0) {
    fail(`${rel} — carries no \`features\` array, so it records no proof at all.`);
    continue;
  }
  for (const f of feats) {
    rows.push({ record: rel, appDir, feature: f });
  }
}

if (rows.length === 0) {
  coverageLost([
    `${records.length} record(s) were read and not one carried a feature row.`,
    'Every limb below ranges over feature rows.',
  ]);
}

// ── LIMB 1 · SHAPE. A row without a mutation block records nothing to grade.
// ── LIMB 2 · EXECUTABILITY. `edit.find` must land exactly once, today.
// ── LIMB 3 · FRESHNESS BY CONTENT, not by date.
const unproven = [];
const executable = [];
const runnable = [];

for (const r of rows) {
  const f = r.feature;
  const where = `${r.record} · ${f.name ?? '(unnamed row)'}`;
  const mut = f.mutation;
  if (!mut || typeof mut !== 'object') {
    fail(`${where} — has no \`mutation\` block. Every feature row claims a proof; a row with no proof block claims one it cannot show.`);
    continue;
  }
  if (typeof mut.observedRed !== 'string' || mut.observedRed.trim() === '') {
    fail(`${where} — \`mutation.observedRed\` is missing or blank, so a red run has nothing to be matched against and any non-zero exit would read as a catch.`);
  }
  // 🔴 THE HOLLOW ANCHOR, CAUGHT STATICALLY. A row naming a test no file
  // declares records a proof that cannot have been run against this tree, and it
  // costs milliseconds to notice — so it is checked here rather than left to the
  // executed limb, which is not wired into any per-push job.
  //
  // MEASURED 2026-09-09, and it is why this limb exists rather than being a
  // precaution: TWO of the fourteen rows in apps/subscriptiontracker/dod.json
  // named tests that do not exist. `budget` cited "at 1920 the list stops at
  // AppBreakpoints.kMaxBodyWidth" and `detail` cited "at 1920 the header pane
  // caps its content at kMaxBodyWidth"; the declarations in the tree read
  // "…the body is still capped at exactly kMaxBodyWidth" and "…caps its content
  // at reading". The constant was renamed in the tests and the record was never
  // followed. Nothing said so, for one reason: assert-app-dod.mjs holds
  // `apps/subscriptiontracker` EXEMPT by name, so the only guard that resolves a
  // row's test never looked at these fourteen. That exemption is a domain
  // decision with a lifecycle anchor attached to it; this guard simply does not
  // inherit it, and these two rows are what that bought.
  if (typeof f.test !== 'string' || f.test.trim() === '') {
    fail(`${where} — carries no \`test\` name, so nothing identifies what the mutation was watched to redden.`);
  } else {
    const decls = testFileFor(r.appDir, f.test);
    if (decls.length === 0) {
      fail(
        `${where} — no test file under ${r.appDir}/test declares \`test('${f.test}'\`. ` +
          'The row records a proof against a test that is not in this tree, so the proof cannot be true as written ' +
          'and cannot be re-run. Point the row at the declaration that exists, or restore the one that was removed.',
      );
    } else if (decls.length > 1) {
      // ⚠️ TEST NAMES ARE NOT UNIQUE ACROSS FILES, and assuming they were is a
      // bug this limb found on its first run: "at 1920 the body is still capped
      // at exactly kMaxBodyWidth" is declared in BOTH width_budget_test.dart and
      // width_insights_test.dart, because the width suites assert the same
      // property of different screens under the same sentence. A row whose name
      // lands twice must SAY which file, in the record, where it is committed
      // and reviewable — the harness may not guess, because guessing wrong means
      // running a green test that has nothing to do with the mutation and
      // reporting the proof as intact.
      if (typeof f.testFile === 'string' && decls.includes(f.testFile)) {
        r.testRel = f.testFile;
      } else if (typeof f.testFile === 'string') {
        fail(
          `${where} — \`testFile\` says ${f.testFile}, but "${f.test}" is not declared there. ` +
            `It is declared in: ${decls.join(', ')}.`,
        );
      } else {
        fail(
          `${where} — "${f.test}" is declared in ${decls.length} files (${decls.join(', ')}) and the row carries no ` +
            '`testFile` saying which one the proof ran. Add it: a harness that guesses can run a green test that has ' +
            'nothing to do with the mutation and report the proof intact.',
        );
      }
    } else if (typeof f.testFile === 'string' && f.testFile !== decls[0]) {
      fail(`${where} — \`testFile\` says ${f.testFile}, but "${f.test}" is declared only in ${decls[0]}.`);
    } else {
      r.testRel = decls[0];
    }
  }

  const effRel = typeof f.effect === 'string' ? `${r.appDir}/${f.effect.split(':')[0]}` : null;
  if (!effRel || !has(effRel)) {
    fail(`${where} — the effect file ${effRel ?? '(unresolvable)'} is not on disk, so neither the hash nor the edit has a subject.`);
    continue;
  }
  r.effRel = effRel;

  const edit = mut[EDIT_KEY];
  if (!edit || typeof edit !== 'object' || typeof edit.find !== 'string' || typeof edit.replace !== 'string') {
    unproven.push({ where, why: `no \`mutation.${EDIT_KEY}\`, so the proof cannot be re-run by anything` });
    continue;
  }
  if (edit.find === '' || edit.find === edit.replace) {
    fail(`${where} — \`mutation.${EDIT_KEY}\` is empty or replaces the text with itself, which is a mutation that cannot change the program and therefore an experiment that cannot fail.`);
    continue;
  }
  const src = read(effRel);
  const hits = src.split(edit.find).length - 1;
  if (hits === 0) {
    fail(`${where} — \`mutation.${EDIT_KEY}.find\` no longer occurs in ${effRel}. The proof addresses code that is not there; re-run the mutation against the code that is.`);
    continue;
  }
  if (hits > 1) {
    fail(`${where} — \`mutation.${EDIT_KEY}.find\` occurs ${hits} times in ${effRel}. A mutation with more than one landing site is more than one experiment sharing one record; narrow the text until it is unique.`);
    continue;
  }
  // The edit is well-formed and lands exactly once, so this row can be RUN even
  // if it has never been run. That is the state a row passes through on its way
  // out of the unproven count, and --execute must be able to reach it — a limb
  // that only re-runs already-proven rows could never earn the first hash.
  runnable.push(r);
  if (typeof mut[HASH_KEY] !== 'string' || !/^[0-9a-f]{64}$/.test(mut[HASH_KEY])) {
    unproven.push({ where, why: `a \`mutation.${EDIT_KEY}\` that lands, but no \`mutation.${HASH_KEY}\` — so it is RUNNABLE and has not been RUN` });
    continue;
  }
  const actual = codeHashOf(effRel);
  if (actual !== mut[HASH_KEY]) {
    fail(
      `${where} — the CODE of ${effRel} has changed since this proof was run.\n` +
        `        recorded ${mut[HASH_KEY]}\n` +
        `        on disk  ${actual}\n` +
        '        This is the staleness clause. It is cleared by RE-RUNNING the mutation ' +
        '(`--execute --only "' + (f.name ?? '') + '"`) and recording the new hash, never by editing the hash.',
    );
    continue;
  }
  executable.push(r);
}

// ── LIMB 4 · THE RATCHET. The count of rows with no executable proof may fall,
//    never rise. This is the limb that makes the gap close monotonically instead
//    of becoming permanent, and it is the one an added row trips.
if (unproven.length > UNPROVEN_FLOOR) {
  fail(
    `${unproven.length} mutation row(s) carry no executable proof, and the recorded floor is ${UNPROVEN_FLOOR}. ` +
      'A row may only leave that count by being RUN. Raising the floor to accommodate a new unproven row is ' +
      'the move this guard exists to refuse.',
  );
}
if (unproven.length < UNPROVEN_FLOOR) {
  fail(
    `${unproven.length} mutation row(s) carry no executable proof but the recorded floor is still ${UNPROVEN_FLOOR}. ` +
      'Lower `mutationProofs.unprovenFloor` in tooling/dod-register.json to ' + unproven.length + ', alone, in a commit carrying the green-control ' +
      'and mutant exit codes of the run that earned the move.',
  );
}

// ── LIMB 5 · --execute. Everything above is a claim about the record; this is
//    the only limb that observes the program.
const LOAD_FAILURE = /Failed to load|Compilation failed|Error: .*\.dart:|Unhandled exception|Could not find a file named|error • /i;

// ⏱ 2026-09-11 · `flutter test` IS BOUNDED, IN ITS OWN PROCESS GROUP, WITH OUTPUT TO A FILE.
// It had a time-out and neither of the other two (hang-class sweep, HANDOFF item 1:
// "highest risk"). `flutter` starts dart and gradle daemons that inherit its pipes,
// and a pipe-reading spawnSync returns only when EVERY holder has closed them, so a
// daemon left behind kept this limb waiting for as long as it lived — the shape of
// the `flutter create` stall fixed in #619. The pattern is flutter-stock-assets.mjs's,
// and its reaper is imported rather than copied: output goes to a file (spawnSync
// waits for the child alone), the child leads its own group on POSIX, and after
// EVERY run — clean exit or time-out — whatever is left in that group is named and
// killed. Windows has no group: the time-out still fires, on the `cmd.exe` it runs.
// A run that times out is COVERAGE LOST at the call sites, never a red for some
// other reason. The bound is MUTATION_TEST_TIMEOUT_MS (default 20 min).
const POSIX = process.platform !== 'win32';
const DEFAULT_TEST_TIMEOUT_MS = 20 * 60 * 1000;
const testTimeoutMs = () => Math.max(1_000, Number(process.env.MUTATION_TEST_TIMEOUT_MS ?? DEFAULT_TEST_TIMEOUT_MS) || DEFAULT_TEST_TIMEOUT_MS);

/** Everything written to `fd`, read back THROUGH THE SAME DESCRIPTOR from byte 0.
 *  ⏱ 2026-09-11 — not by re-opening the path (CodeQL js/file-system-race on #655:
 *  the file may change between the open and a second open), and not with
 *  `readFileSync(fd)`, which reads from the CURRENT position: the child's inherited
 *  handle shares that position and leaves it at the end, so it would read nothing. */
function readWholeFd(fd) {
  const size = fstatSync(fd).size;
  const buf = Buffer.alloc(size);
  let off = 0;
  while (off < size) {
    const n = readSync(fd, buf, off, size - off, off);
    if (n === 0) break;
    off += n;
  }
  return buf.toString('utf8', 0, off);
}

/** A test path the harness will hand to a shell: relative, under the app, a .dart
 *  file, and nothing a shell could read as syntax. It is DERIVED from the tree
 *  (testFileFor), so anything else is a tree this harness does not understand. */
const SAFE_TEST_REL = /^[A-Za-z0-9_][A-Za-z0-9_./-]*\.dart$/;

function runTest(appDir, testRel, label) {
  const started = Date.now();
  const timeoutMs = testTimeoutMs();
  if (!SAFE_TEST_REL.test(testRel) || testRel.includes('..')) {
    console.error(`     ${label} REFUSED — ${JSON.stringify(testRel)} is not a plain relative .dart path`);
    return { status: null, out: '', secs: 0, timedOut: false, timeoutMs, error: new Error(`unsafe test path ${JSON.stringify(testRel)}`) };
  }
  const logDir = mkdtempSync(join(tmpdir(), 'nikatru-mutproof-run-'));
  const fd = openSync(join(logDir, 'flutter-test.log'), 'w+');
  let res;
  let out;
  try {
    const opts = { cwd: join(ROOT, appDir), stdio: ['ignore', fd, fd], timeout: timeoutMs, killSignal: 'SIGKILL', detached: POSIX };
    res = POSIX ? spawnSync('flutter', ['test', testRel], opts) : spawnSync('cmd.exe', ['/c', 'flutter', 'test', testRel], opts);
    out = readWholeFd(fd);
  } finally {
    closeSync(fd);
    rmSync(logDir, { recursive: true, force: true });
  }
  const survivors = POSIX && res.pid ? reapProcessGroup(res.pid) : [];
  const timedOut = res.error?.code === 'ETIMEDOUT';
  const secs = Math.round((Date.now() - started) / 1000);
  console.error(
    `     ${label} exit=${res.status}${timedOut ? ` — TIMED OUT after ${Math.round(timeoutMs / 1000)}s` : ''} (${secs}s)` +
      (survivors.length ? ` — still running in its process group, killed: ${survivors.join(', ')}` : ''),
  );
  return { status: res.status, out, secs, timedOut, timeoutMs, error: res.error ?? null };
}

/** Which test FILE declares the row's named test. The row records a test NAME,
 *  and the file is DERIVED from it rather than duplicated into the schema, so a
 *  renamed test file cannot silently point the harness at nothing.
 *
 *  🔴 RESOLVE, DO NOT MATCH (N-5). The match is a `test('…'` / `testWidgets('…'`
 *  DECLARATION in the comment-stripped source, never the name appearing
 *  somewhere in the file. A substring match is satisfied by the name sitting in
 *  a TODO or in a doc comment beside the thing it used to test, and this
 *  repository has already shipped a scanner that counted a name inside a
 *  comment. Comments are stripped for the same reason and string literals are
 *  NOT, because the test name IS a string literal. */
function testFileFor(appDir, testName) {
  const decl = new RegExp(`test(?:Widgets)?\\(\\s*(['"])${escapeRe(testName)}\\1`);
  const found = [];
  for (const sub of ['test', 'integration_test']) {
    const dir = join(ROOT, appDir, sub);
    if (!existsSync(dir)) continue;
    const walk = (d, rel) => {
      for (const e of listDir(d, { withFileTypes: true })) {
        const p = join(d, e.name);
        if (e.isDirectory()) walk(p, `${rel}/${e.name}`);
        else if (e.name.endsWith('.dart')) {
          if (decl.test(stripDartComments(readFileSync(p, 'utf8')))) found.push(`${rel}/${e.name}`);
        }
      }
    };
    walk(dir, sub);
  }
  return found;
}

if (EXECUTE) {
  const targets = ONLY ? runnable.filter((r) => r.feature.name === ONLY) : runnable;
  if (ONLY && targets.length === 0) {
    coverageLost([
      `--only "${ONLY}" matched no row with an executable proof.`,
      'Either the name is wrong or that row is UNPROVEN and has nothing to re-run.',
    ]);
  }
  if (targets.length === 0) {
    coverageLost([
      'every mutation row is UNPROVEN, so --execute has nothing to execute and would',
      'print a clean sweep of an empty set. That is the state this guard reports; it is',
      'not a state in which the executed limb may claim to have proven anything.',
    ]);
  }

  const restores = new Map();
  const restoreAll = () => {
    for (const [p, text] of restores) {
      try {
        writeFileSync(p, text);
      } catch {
        /* best effort: the message below is what the operator acts on */
      }
    }
    restores.clear();
  };
  const bail = (sig) => {
    console.error(`\n  interrupted by ${sig} — restoring the tree`);
    restoreAll();
    process.exit(1);
  };
  process.on('SIGINT', () => bail('SIGINT'));
  process.on('SIGTERM', () => bail('SIGTERM'));
  process.on('uncaughtException', (e) => {
    console.error(`\n  crashed — restoring the tree: ${e && e.message ? e.message : e}`);
    restoreAll();
    process.exit(1);
  });

  // The green control is per FILE, not per row: six of the fourteen rows in this
  // tree name one file, and running it six times proves the same thing six times
  // at 3m21s each.
  const greenControls = new Map();

  for (const r of targets) {
    const f = r.feature;
    const where = `${r.record} · ${f.name}`;
    const files = testFileFor(r.appDir, f.test);
    if (files.length === 0) {
      fail(`${where} — no test file declares "${f.test}", so the harness has nothing to run. A row naming a test that does not exist is the hollow anchor N-5 exists to prevent.`);
      continue;
    }
    if (files.length > 1) {
      fail(`${where} — "${f.test}" appears in ${files.length} test files (${files.join(', ')}); the harness cannot tell which one the proof ran.`);
      continue;
    }
    const testRel = files[0];
    console.error(`\n  ${where}`);
    console.error(`     effect ${r.effRel}`);
    console.error(`     test   ${r.appDir}/${testRel}`);

    const key = `${r.appDir}/${testRel}`;
    if (!greenControls.has(key)) {
      const control = runTest(r.appDir, testRel, 'green control');
      greenControls.set(key, control);
    }
    const control = greenControls.get(key);
    if (control.timedOut) {
      fail(`${where} — COVERAGE LOST: THE GREEN CONTROL did not finish within ${Math.round(control.timeoutMs / 1000)}s (MUTATION_TEST_TIMEOUT_MS), so nothing was observed. Its process group was killed.`);
      continue;
    }
    if (control.status !== 0) {
      fail(`${where} — THE GREEN CONTROL FAILED (exit ${control.status}). Nothing can be concluded from a mutant's red when the unmutated tree is already red.`);
      continue;
    }

    const absEff = abs(r.effRel);
    const original = readFileSync(absEff, 'utf8');
    restores.set(absEff, original);
    try {
      writeFileSync(absEff, original.replace(f.mutation[EDIT_KEY].find, f.mutation[EDIT_KEY].replace));
      const mutant = runTest(r.appDir, testRel, 'mutant      ');
      if (mutant.timedOut) {
        fail(`${where} — COVERAGE LOST: THE MUTANT did not finish within ${Math.round(mutant.timeoutMs / 1000)}s (MUTATION_TEST_TIMEOUT_MS). A run that never ended is not a caught mutation; its process group was killed.`);
      } else if (mutant.status === 0) {
        fail(`${where} — THE MUTANT DID NOT REDDEN THE TEST (exit 0). Either the proof is a fossil or, per rule 9, the mutated branch is dead code.`);
      } else if (LOAD_FAILURE.test(mutant.out) && !mutant.out.includes(f.mutation.observedRed)) {
        fail(
          `${where} — COVERAGE LOST: the mutant run failed to LOAD or COMPILE rather than failing an assertion. ` +
            'A compile error and a caught mutation are identical from the exit code (rule 8), and this one is a compile error.',
        );
      } else if (!mutant.out.includes(f.mutation.observedRed)) {
        fail(
          `${where} — the mutant went red but did NOT print the recorded message.\n` +
            `        expected to see: ${f.mutation.observedRed}\n` +
            '        A red for an unrelated reason is not the catch this row records.',
        );
      } else {
        console.error('     CAUGHT — green control 0, mutant non-zero, and the recorded message was printed.');
      }
    } finally {
      writeFileSync(absEff, original);
      restores.delete(absEff);
    }
  }
  restoreAll();
}

// ── Report.
if (unproven.length > 0) {
  console.error(`\n⚠️  ${unproven.length} mutation row(s) are UNPROVEN — recorded in prose, not re-runnable by anything:`);
  for (const u of unproven) console.error(`     · ${u.where} — ${u.why}`);
  console.error(
    '   Each is closed by RUNNING it: `node tooling/ci/assert-mutation-proofs.mjs . --execute --only "<row>"`,\n' +
      '   then recording the edit and the code hash and lowering UNPROVEN_FLOOR by one. There is no other way\n' +
      '   to close one, and a row re-dated on the strength of an argument is the defect this file exists for.',
  );
}

if (problems.length > 0) {
  console.error(`\n✗ ${problems.length} problem(s):`);
  for (const p of problems) console.error(`  · ${p}`);
  console.error('\nassert-mutation-proofs: FAILED');
  process.exit(1);
}

console.log(
  `ok  mutation proofs — ${records.length} record(s), ${rows.length} feature row(s); ` +
    `${executable.length} carry a re-runnable edit pinned to a content hash of the CODE they probed ` +
    `(no git history, so a rename cannot blind it and a shallow clone cannot starve it); ` +
    `${unproven.length} UNPROVEN and printed above, ratcheted at ${UNPROVEN_FLOOR} and falling only by a run` +
    (EXECUTE ? '; the executed limb ran green-control-then-mutant on every proof above' : '; --execute was not asked for, so nothing here was RUN — that limb is the nightly lane, priced in this file\'s header'),
);
