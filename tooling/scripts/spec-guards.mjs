#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// spec-guards.mjs — run the spec-integrity guards, from a git hook or by hand.
//
// WHY THIS EXISTS. The spec lives under `Private/`, which is gitignored, so no CI
// job can read it. Its guards were therefore run by a human who remembered
// SESSION_BOOTSTRAP step 7 — which is to say the corpus's own integrity was the
// one thing in this repo that was NOT a build-failing assertion, in a house whose
// stated doctrine is that a preventable mistake becomes a guard rather than a
// note. Decision 2026-08-15: a LOCAL HOOK is the enforcement surface, because it
// is free, instant, and needs nothing to be published. A private-repo CI run is
// the intended backstop LATER, once the spec has been standardised.
//
// TWO SPEEDS, AND THE SPLIT IS MEASURED, NOT GUESSED:
//   check-dod-sync          252 ms
//   assert-spec             ~700 ms  →  --fast total ≈ 1 s     (pre-commit)
//                                       --full is the SAME SET today (pre-push)
// 🔴 The split is the whole design and is kept even though nothing is slow right
// now. This corpus already recorded that "a blocking 10-minute hook gets bypassed
// within a week", and the same instinct kills an 11-second pre-commit. A guard
// that is skipped is worth less than no guard, because it also carries the belief
// that something was checked.
//
// ⚠️ 2026-08-15 — THE SLOW TIER IS CURRENTLY EMPTY, and that is a real change, not
// an oversight. `assert-enforcers-exist` was the only `slow` entry at 10,854 ms —
// 94% of the whole suite — and it spent that time parsing 384,000 words of prose
// and walking the tree to build a symbol index. Its successor (assert-spec limb 3)
// resolves the same citations out of parsed JSON. So `--full` and `--fast` select
// the same two guards, `--full` remains a superset by construction, and a future
// slow guard needs no change to the hooks to be picked up.
//
// 🔴 2026-08-17 — AND THE HOOK MADE THE PUBLIC REPO UNCOMMITTABLE BY ANYONE WHO
// CLONED IT. Every guard below has its subject under `Private/`, which is
// gitignored and therefore absent from every public clone by design. The coverage
// floor then fired on all six, exited 2, and `.githooks/pre-commit` refused the
// commit. Reproduced end to end: clone the public repo, run the documented
// `install-hooks.mjs`, `git commit` → `CANNOT RUN — 5 of 6 spec guard(s) not
// found` … `Commit refused`. That is not a hypothetical contributor: it is also
// every agent worktree, which is a fresh checkout with no `Private/` in it.
//
// THE FLOOR WAS RIGHT AND ITS TEST WAS TOO COARSE. It could not tell
//   (a) the corpus is here and a guard has gone missing   — a real defect, refuse
// from
//   (b) the corpus is not here at all                     — the subject is absent
//                                                           by design, so there is
//                                                           nothing to check
// and it treated (b) as (a). The distinguishing fact is checkable and is now
// checked: does a `Private/` DIRECTORY exist under any candidate root? On the
// owner's machine it does, so (a) still refuses exactly as before — verified by
// renaming a guard and confirming exit 2. In a clone it does not, so the guards
// are reported NOT APPLICABLE, by name, and the commit proceeds.
//
// ⚠️ Exiting 0 having checked nothing is the vacuous pass this file exists to
// eliminate, so it is allowed here on ONE condition, the same one `guard-sweep.mjs`
// uses for LIBRARY / MUTATES / NEEDS-CI: the skip is DERIVED from a mechanism and
// PRINTED every run. A silent skip would be the defect; a declared one is a fact.
//
// 🔴 2026-08-18 — THE CORPUS MOVED OUT OF THIS REPO, AND THAT TURNED THE PARAGRAPH
// ABOVE INTO A LOADED GUN. `Private/` is becoming the SIBLING directory
// `../Project_Cross_Platform_Apps_Private`. The locator asked exactly one question —
// is there a `Private/` DIRECTORY under a candidate root — so on the day of the move
// the answer flips to no, all seven guards are declared NOT APPLICABLE by name, and
// the runner exits 0. Every printed word of that is true and the conclusion is
// still false: the subject did not cease to exist, it moved, and the mechanism the
// skip was DERIVED from had quietly stopped modelling reality. That is the failure
// mode this repo keeps re-finding under a new coat — "a check that silently stopped
// checking" — and being printed does not save it, because what gets printed is a
// confident sentence about an absence that is not real.
//
// SO TWO THINGS CHANGED HERE, AND ONLY THE SECOND IS A REVERSAL:
//   1. The corpus is now located by its own candidate list, sibling FIRST, and a
//      candidate only counts if it CONTAINS `requirements/` — see PRIVATE_ROOT
//      below for why the marker is load-bearing rather than belt-and-braces.
//   2. 🔴 CORPUS-NOT-FOUND NOW EXITS 2 INSTEAD OF 0. A runner that cannot find its
//      subject has checked nothing, and nothing is not a pass. It now names every
//      root it searched, which is the output that would have made the 2026-08-17
//      diagnosis take minutes instead of a session.
//
// ⚠️ THE 2026-08-17 CLONE PROBLEM IS REAL AND THIS RE-OPENS IT — SAID OUT LOUD
// RATHER THAN DISCOVERED LATER. A public clone has no corpus, so it now takes exit 2
// and `.githooks/pre-commit` refuses the commit, which is precisely the breakage the
// 2026-08-17 entry above records fixing. The judgement is that the two cases are not
// symmetrical and were only ever conflated because one cheap test happened to answer
// both: "this checkout never had the corpus" is a property of the CHECKOUT and
// belongs to whatever decides that a hook should be installed at all, whereas "the
// corpus is not where I look" is a property of THIS FILE and is the one thing it
// must never answer with silence. Putting the clone escape back HERE would restore a
// skip path that a future move re-arms exactly as this one did. It is left to the
// installer on purpose; until that lands, a clone runs the hook and is refused.
// ⚠️ Unfixed as of this dated line, and named so it is not mistaken for handled.
//
// 🔴 2026-08-18 (SECOND ENTRY THAT DAY — THE TREE MOVED TWICE). The entry above is
// correct about WHY the corpus is a sibling and wrong about HOW to find it, and the
// reason is worth more than the fix. It spelled the sibling `${basename(REPO)}_Private`
// and reached the rest of the world by counting `..` from this repo. Then the owner
// reorganised everything into a Store × Platform × Type tree: this repo became
// `Projects/Google_Store/Google_Play_Store/Google_Play_Store_Apps/…_Android_Apps_Public`,
// three levels deeper than it was that morning, and BOTH derivations broke in the same
// commit. The name derivation computed `…_Android_Apps_Public_Private` against an actual
// `…_Android_Apps_Private` (the `_Public` suffix is new and was not stripped), and every
// `resolve(REPO, '..', '..')` landed on a store directory instead of a workspace.
//
// ⚠️ THE REFUSAL WORKED, AND THAT IS THE ONLY REASON THIS WAS CHEAP. The run exited 2
// and printed all five roots it had tried, so the wrong path was on screen rather than
// inferred. That behaviour is UNCHANGED here — this entry fixes the derivation and
// touches no exit code.
//
// 🔴 THE FIX IS AN ANCHOR, NOT ANOTHER `..`. Adding one more level is what broke today,
// twice, and it is a bet that the repo never moves again — a bet already lost twice in
// one day, with ~20 more repos coming at VARYING depths, so a fixed level count is wrong
// the moment any one of them moves. Depth is now never counted. This file SEARCHES
// UPWARD from its own location for the workspace root: the directory that contains BOTH
// `Projects/` and `nikatru/`. That pair is the anchor because neither exists alone at any
// other level of the tree, and because the two together are what the whole layout is
// FOR — the products and the shared brain, side by side. From the anchor:
//     <anchor>/nikatru      the shared business brain
//     <anchor>/Projects     the products root
// and this repo's own corpus is its SIBLING, addressed by NAME rather than by depth:
// take the repo's directory name, swap a trailing `_Public` for `_Private` (or append
// `_Private` when there is no such suffix), and look for it beside the repo. A repo at
// any depth resolves by the same rule, because the rule never mentions depth.
//
// ⚠️ AND THE SIBLING MUST BE NON-EMPTY BEFORE IT IS SELECTED. This is not caution, it is
// the trap the 2026-08-18 entry above already measured once, and it is LIVE in the new
// tree: `Apple_IOS_Store_Apps/…_Apple_IOS_Apps_Private` and
// `Linux_Store_Apps/…_Linux_Apps_Private` are both pre-created shells with ZERO entries
// today. Selecting an empty shell makes every guard under it "not found" and kills the
// run at the coverage floor, blaming missing guards while the real corpus sits one
// directory over. So a candidate must be a DIRECTORY, be NON-EMPTY, and contain the
// `requirements/` marker — three tests, because the empty shell passes the first.
//
// 🔴 ANCHOR-NOT-FOUND IS A REFUSAL, WITH EVERY DIRECTORY WALKED NAMED. There is no
// fallback guess, deliberately: a guessed root is how a runner ends up confidently
// checking the wrong tree, and every fallback in this file's history has been the thing
// that later needed removing. If the anchor is gone, the layout changed in a way this
// file cannot infer, and saying so with the full walk on screen is the honest answer.
//
// EXIT CODES:  0 = every applicable guard passed
//              1 = a guard reported a finding
//              2 = could not run — the workspace anchor could not be found, or the
//                  corpus could not be located at all, or it IS present and a guard
//                  inside it is missing. All three are refusals: not one of them
//                  checked the thing it claims to check.
//                  ⏱ 2026-09-24: and a fourth — the corpus is present and its
//                  declared guard set (requirements/tooling/guards.json) cannot be
//                  read, parsed, or lacks a pinned guard. See guard-declaration.mjs.
//
// Usage:  node tooling/scripts/spec-guards.mjs --fast
//         node tooling/scripts/spec-guards.mjs --full
//         node tooling/scripts/spec-guards.mjs --full --verbose
// ─────────────────────────────────────────────────────────────────────────────
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
/* 🔴 git EXPORTS `GIT_DIR` into every hook process and it BEATS `-C`, so the one
   `git` read this runner makes goes through the helper that deletes the six
   redirecting variables from the child environment. See repo-git.mjs.

   ⏱ APPENDED 2026-09-09 — "the one `git` read this runner makes" was true of the
   runner and FALSE of everything it spawns, and the gap had teeth. See CHILD_ENV
   below. */
import { cleanGitEnv, repoGit, RepoGitError, strippedNote } from './repo-git.mjs';
/* The corpus's own guards are not typed in this file. They are entries in the corpus's
   declaration, `Private/requirements/tooling/guards.json`, read through this loader out
   of a git blob; see the DECLARED SET block below and the loader's header. */
import { DECLARATION_REL, GuardDeclarationError, loadGuardDeclaration } from './guard-declaration.mjs';
import { invokingCheckout, runnerDrift, sameDir } from './hook-runner-pin.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');          // tooling/scripts -> repo root
/* ⚠️ THIS `..`/`..` IS NOT THE DEPTH-COUNTING THE 2026-08-18 SECOND ENTRY BANS, and the
   difference is the whole distinction. It walks up INSIDE this repo, from a file whose
   position relative to the repo root is fixed by the repo's own layout — move the repo
   anywhere and `tooling/scripts/` is still two below its root. Everything OUTSIDE the
   repo is what moves independently, and none of it is reached by counting any more. */

const argv = process.argv.slice(2);
const FULL = argv.includes('--full');
const VERBOSE = argv.includes('--verbose');

const isDir = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };
/* Non-empty, not merely present. See the 2026-08-18 second entry: the empty pre-created
   shell is a real directory that answers `true` to every existence test and holds nothing. */
const isNonEmptyDir = (p) => { try { return readdirSync(p).length > 0; } catch { return false; } };

/* 🔴 THE ANCHOR. Everything outside this repo is addressed from here, and this is the one
   place the tree's shape is learned. Walk UP from this file until a directory holds BOTH
   `Projects/` and `nikatru/` — the products root and the shared business brain, which are
   siblings by design and are that pair nowhere else. No level is counted, so a repo that
   moves three levels deeper (as this one did on 2026-08-18) resolves unchanged. */
const ANCHOR_MARKERS = ['Projects', 'nikatru'];
const WALKED = [];
function findWorkspaceRoot(start) {
  let dir = resolve(start);
  for (;;) {
    WALKED.push(dir);
    if (ANCHOR_MARKERS.every((m) => isDir(join(dir, m)))) return dir;
    const up = dirname(dir);
    if (up === dir) return null;                 // hit the filesystem root; stop, do not guess
    dir = up;
  }
}
const WORKSPACE_ROOT = findWorkspaceRoot(HERE);

/* 🔴 NO ANCHOR, NO GUESS. Refusing here rather than falling back to a plausible root is
   the same rule the corpus-not-found branch below follows, for the same reason: a runner
   pointed at the wrong tree still prints confident sentences. Name every directory walked
   so the reader can see whether the layout changed or the marker pair did. */
if (!WORKSPACE_ROOT) {
  console.error('\n  CANNOT RUN — the workspace anchor was not found, so nothing outside this repo is addressable.');
  console.error(`  Walked ${WALKED.length} directory(ies) upward from this file, each required to contain ALL of: ${ANCHOR_MARKERS.map((m) => `\`${m}/\``).join(' + ')}`);
  for (const dir of WALKED) {
    const have = ANCHOR_MARKERS.filter((m) => isDir(join(dir, m)));
    console.error(`    --   ${dir}`);
    console.error(`         ${have.length ? `has only: ${have.join(' , ')}` : 'has neither'}`);
  }
  console.error('  The anchor is the directory holding the products root and the shared brain side by side.');
  console.error('  If the layout changed, fix ANCHOR_MARKERS in this file — it is the single place this');
  console.error('  runner learns the shape of the tree. Refusing rather than guessing a root.\n');
  process.exit(2);
}

const BRAIN = join(WORKSPACE_ROOT, 'nikatru');       // the shared business brain
const PRODUCTS_ROOT = join(WORKSPACE_ROOT, 'Projects'); // the products root

/* 🔴 A LINKED WORKTREE HAS NO CREDENTIAL VAULT, AND THAT MADE EVERY WORKTREE COMMIT AN
   `--no-verify` COMMIT (2026-09-08). This runner does not read `CLAUDE.md` or
   `.claude/scripts/backup-offsite.ps1` itself, and that is exactly why the failure was
   hard to see: `assert-spec` derives the public repo from the corpus it lives in, walks
   it, and requires FOUR top-level anchors — `pubspec.yaml`, `CLAUDE.md`, `mason.yaml`,
   `pnpm-workspace.yaml` — before it will resolve the eight `invariants.json` and
   `gates.json` ENFORCEMENT rows that name `.claude/scripts/…`. `.claude/` is gitignored
   IN FULL and is the local credential vault, and `CLAUDE.md` is gitignored too, so
   NEITHER exists in a worktree: only tracked files are checked out there.

   MEASURED 2026-09-07 and recorded in Private research/full-read-2026-09-08/
   S2-structure-apply-2026-09-08.md sections 9 and 12: three agents committed with
   `--no-verify` on that date, and a fourth abandoned a finished, staged, guard-green
   branch in a worktree and re-applied it as a patch in the main checkout. A guard that
   cannot run inside a worktree teaches people to bypass it, and `--no-verify` is a
   root-`AGENTS.md` prohibition. So the fix is to RESOLVE, never to skip.

   HOW, AND WHAT IS DELIBERATELY NOT DONE. `git rev-parse --git-common-dir` answers
   `.git` in a main checkout and `<main checkout>/.git` in a linked worktree, so the
   PARENT of the common dir IS the main worktree — asked of git rather than derived from
   the directory name, because a worktree may be called anything and may live anywhere.
   When this tree lacks an anchor and git names a DIFFERENT main checkout, the main
   checkout becomes the root everything outside this repo is addressed from: the private
   sibling is named from IT, so `assert-spec` resolves the pair `<main>_Private` ↔
   `<main>_Public` and walks the main checkout, where the vault and `CLAUDE.md` really
   are. Nothing is copied. Copying a credential vault into a second directory to satisfy
   a guard is not a trade this repo makes, and a guard reading a COPIED vault would be
   asserting about the copy.

   AND IT WEAKENS NOTHING. No floor moves, no enforcement row is dropped, no exit code
   becomes friendlier, and no limb learns to skip: if the MAIN checkout is also missing
   the file, the anchors are still absent, `assert-spec` still refuses, and this runner
   still exits 2. The only change is which directory the question is asked about — from
   one that structurally cannot answer it to the one that can. In a main checkout
   `--git-common-dir` resolves to this very repo and every line below behaves exactly as
   it did before. */
const HOST_ANCHORS = ['CLAUDE.md', '.claude/scripts/backup-offsite.ps1'];
const absentHostAnchors = (root) => HOST_ANCHORS.filter((rel) => !existsSync(join(root, ...rel.split('/'))));

/* Two spellings of one directory must compare equal: git answers with forward slashes
   and whichever drive-letter case it found, `path.resolve` does not. Same normalisation
   the git helper applies for the same reason. */
const sameRoot = (a, b) => {
  const norm = (p) => {
    const s = resolve(String(p)).replace(/\\/g, '/').replace(/\/+$/, '');
    return process.platform === 'win32' ? s.toLowerCase() : s;
  };
  return norm(a) === norm(b);
};

/** The MAIN worktree of the repository checked out at `root`, or `{ main: null, why }`
 *  when there is no answer to be had. Read through `repo-git.mjs`, never with a bare
 *  `spawnSync('git', …)`: this file runs INSIDE a pre-commit hook, git exports `GIT_DIR`
 *  into every hook process, and `GIT_DIR` beats `-C`. Asking the wrong repository which
 *  checkout is its main one is precisely the class of answer this runner must not
 *  produce confidently. A refusal here is not fatal — it leaves `HOST_ROOT` as this
 *  tree, which is what every run before 2026-09-08 used. */
function mainWorktreeOf(root) {
  let out;
  try {
    out = repoGit(root, 'rev-parse', '--git-common-dir').trim();
  } catch (e) {
    if (e instanceof RepoGitError) return { main: null, why: `${e.message}` };
    throw e;
  }
  if (!out) return { main: null, why: '`git rev-parse --git-common-dir` printed nothing' };
  const common = resolve(root, out);
  if (basename(common) !== '.git') {
    return { main: null, why: `the common dir is ${common}, whose basename is not \`.git\`, so its parent is not a work tree` };
  }
  return { main: dirname(common), why: null };
}

const ABSENT_HERE = absentHostAnchors(REPO);
let HOST_ROOT = REPO;
let WORKTREE = null;
let WORKTREE_REFUSED = null;
if (ABSENT_HERE.length) {
  const { main, why } = mainWorktreeOf(REPO);
  if (main && !sameRoot(main, REPO)) {
    HOST_ROOT = main;
    WORKTREE = { main, absentHere: ABSENT_HERE, absentThere: absentHostAnchors(main) };
  } else if (!main) {
    WORKTREE_REFUSED = why;
  }
}
if (WORKTREE) {
  console.log(`  worktree mode — this tree is missing ${WORKTREE.absentHere.join(' , ')}, which the ENFORCEMENT rows need.`);
  console.log(`    this tree     : ${REPO}`);
  console.log(`    main checkout : ${WORKTREE.main}   (parent of \`git rev-parse --git-common-dir\`)`);
  console.log(WORKTREE.absentThere.length
    ? `    ⚠️ the main checkout is missing them too: ${WORKTREE.absentThere.join(' , ')}. Nothing is skipped for that — the guards below still refuse.`
    : '    Resolved there, and nothing is copied: the gitignored vault stays in the one checkout that has it.');
} else if (WORKTREE_REFUSED && ABSENT_HERE.length) {
  console.log(`  note — ${ABSENT_HERE.join(' , ')} absent here and the main checkout could not be asked for: ${WORKTREE_REFUSED}`);
  console.log('    Continuing against this tree, which is what every run before 2026-09-08 did.');
}

/* The guards live in two trees and this script may be invoked from EITHER — the
   public repo's hook, or Private/'s own hook, whose repo root is a
   different directory entirely. So each guard is resolved by trying both
   locations rather than by assuming one. A hook that silently finds no guards
   would report success over an empty set, which is precisely the defect class
   this whole session has been closing.

   🔴 2026-08-18 (second entry): the two DEPTH-COUNTED entries that stood here — `..` and
   `../..` from this repo, named for the flatten-era and pre-flatten layouts — are gone.
   After the Store × Platform × Type reorg they resolved to `Google_Play_Store_Apps/` and
   `Google_Play_Store/`, which are store directories that have never held a guard, so they
   had stopped being fallbacks and become two chances to find the wrong file. Their history
   is preserved in the dated entries above, which is where a dead layout belongs; a live
   candidate list is not a museum. What replaces them is anchor-derived and cannot drift. */
const CANDIDATE_ROOTS = [
  REPO,                                  // invoked from the public repo
  HOST_ROOT,                             // 🔴 2026-09-08: the MAIN checkout when this tree is a worktree; === REPO otherwise, and deduplicated below
  PRODUCTS_ROOT,                         // anchor-derived: the products root
  WORKSPACE_ROOT,                        // anchor-derived: products root + brain, side by side
].filter((root, i, all) => all.findIndex((other) => sameRoot(other, root)) === i);

/* WHERE THE PRIVATE CORPUS ITSELF LIVES — its own list, ordered newest-first, because
   after 2026-08-18 the corpus is no longer a `Private/` child of anything. It is a
   SIBLING of this repo, so the old "root + 'Private'" shape cannot express it: there
   is no parent directory whose child is the corpus and whose other child is a root we
   already search. Kept as a list rather than a constant so the pre-move layouts still
   resolve — this file has to be correct on both sides of the move, and it is the same
   file that runs during it.

   🔴 2026-08-18 (second entry) — THE SIBLING IS NOW DERIVED BY NAME, NOT BY SPELLING.
   `${basename(REPO)}_Private` was a literal that happened to be right for one afternoon.
   The reorg renamed this repo to end in `_Public`, so the literal produced
   `…_Android_Apps_Public_Private` against an actual `…_Android_Apps_Private`, and the run
   refused — correctly, loudly, with the bad path printed, which is the only reason this
   was a five-minute diagnosis instead of the session the 2026-08-17 entry cost. The rule
   that replaces it is: swap a trailing `_Public` for `_Private`, or append `_Private` when
   there is no such suffix. That covers both naming eras with one expression and needs no
   edit when the next repo is created under either convention.

   The two depth-counted `Private/` entries are dropped for the same reason as their twins
   in CANDIDATE_ROOTS above. What is KEPT is repo-RELATIVE and therefore depth-immune:
   `REPO/Private` (the pre-move nested corpus) and REPO itself (the corpus's own hook,
   where the corpus IS the repo root). Neither one counts a level outside this repo. */
/* 🔴 2026-09-08 — NAMED FROM `HOST_ROOT`, NOT FROM `REPO`. In a main checkout the two
   are one directory and nothing changes. In a linked worktree they differ, and the
   worktree's own name is the wrong input: `Projects/structure_Public` composes
   `Projects/structure_Private`, a corpus that has never existed, and the run then
   refused with CANNOT RUN on a machine where the real corpus was sitting one
   directory over. Measured 2026-09-07; S2 section 9 records the whole afternoon it
   cost, including the throwaway private worktree that was created to satisfy this
   very line and then broke a relative link two levels down. The main checkout's name
   is the stable half of the pair, so it is the half the sibling is derived from. */
const REPO_NAME = basename(HOST_ROOT);
const PRIVATE_SIBLING_NAME = REPO_NAME.endsWith('_Public')
  ? `${REPO_NAME.slice(0, -'_Public'.length)}_Private`
  : `${REPO_NAME}_Private`;
const PRIVATE_ROOT_CANDIDATES = [
  join(dirname(HOST_ROOT), PRIVATE_SIBLING_NAME),  // 🔴 the sibling, addressed by name at whatever depth the repo sits
  join(HOST_ROOT, 'Private'),             // pre-move: the corpus nested inside this repo
  join(REPO, 'Private'),                  // the same, from a worktree of it
  REPO,                                   // invoked from the corpus's OWN hook, where it IS the repo root
].filter((root, i, all) => all.findIndex((other) => sameRoot(other, root)) === i);

/* 🔴 THE MARKER IS LOAD-BEARING, NOT A BELT-AND-BRACES EXISTENCE CHECK, AND THIS WAS
   MEASURED ON 2026-08-18 RATHER THAN REASONED ABOUT. On that date the sibling
   `../Project_Cross_Platform_Apps_Private` ALREADY EXISTED ON DISK AND WAS EMPTY —
   the move had been staged and not performed. A bare `existsSync` on the sibling
   therefore selects it, every guard under it is then "not found", and the run dies at
   the coverage floor with a message blaming missing guards while the real corpus sits
   untouched one directory over. Refusing for the wrong reason is better than passing,
   but it is still a wrong answer, and it costs whoever reads it the same hour.
   `requirements/` is the marker because it is the corpus's spine: five of the seven
   guards below are files INSIDE it, and `check-dod-sync` reads
   `requirements/definition-of-done.md`. It also cleanly separates the corpus from
   this repo — the public tree has no top-level `requirements/`, verified on the day —
   which is what makes the last candidate above (REPO itself) safe to list. */
/* 🔴 2026-08-18 (second entry) — AND THE EMPTY SHELL IS NOW ITS OWN NAMED TEST, because
   the trap the paragraph above measured once is now MULTIPLIED. The reorg pre-created a
   `_Private` sibling for every product it anticipates, and most are still empty: on this
   date `…_Apple_IOS_Apps_Private` and `…_Linux_Apps_Private` each hold ZERO entries. The
   marker test alone already rejects them, so this is not new coverage — it is a distinct
   DIAGNOSIS. "exists, but is EMPTY" tells the reader the shell was pre-created and the
   move has not happened; "exists, but no `requirements/` inside" tells them they are
   looking at some other directory entirely. Collapsing the two costs the reader the hour
   this file keeps trying to give back. Three tests, in widening order: is it a directory,
   does it hold anything, does it hold the corpus's spine. */
const CORPUS_MARKER = 'requirements';
const PRIVATE_ROOT = PRIVATE_ROOT_CANDIDATES.find(
  (root) => isDir(root) && isNonEmptyDir(root) && isDir(join(root, CORPUS_MARKER))
) ?? null;

/* Guards resolve against the corpus FIRST and the public repo second. Two of the
   seven live in the public tree and read the corpus; the other five live inside it.
   Trying both keeps that split out of the call sites, and keeps the old `Private/…`
   spellings in the fallback chains working from either invocation root. */
function locate(...relCandidates) {
  const roots = PRIVATE_ROOT ? [PRIVATE_ROOT, ...CANDIDATE_ROOTS] : CANDIDATE_ROOTS;
  for (const root of roots) {
    for (const rel of relCandidates) {
      const p = join(root, rel);
      if (existsSync(p)) return p;
    }
  }
  return null;
}

/* 🔴 THREE GUARDS WERE REMOVED FROM THIS ARRAY ON 2026-08-15, NOT LEFT TO FAIL.
   `assert-status-honest`, `assert-req-ids` and `assert-enforcers-exist` all read
   the 26-file `pipeline/` prose corpus — 384,000 words that the JSON spec under
   `Private/requirements/` replaced and that the same commit deleted. Their entries
   are gone rather than red because a permanently red guard trains people to pass
   `--no-verify`, and a hook that is routinely bypassed is worth less than no hook:
   it also carries the belief that something was checked.

   🔎 HOW TO READ THE DELETED PROSE, AND THE ONLY PLACE THAT SAYS SO. All 26 stage
   files are still in the private repo’s history and read back with, for example,
   `git -C Private show 35d13bd^:pipeline/09-release-engineering.md` — 35d13bd being
   the commit that deleted them (2026-08-15, "retire the four prose readers and
   delete pipeline/"). Public files that used to cite a stage now name
   `Private/requirements/` and keep their `[pipeline X-N]` id, which still resolves
   against an `origin` field there; the recovery command lives HERE rather than in
   each of them, so that sixty-odd citations do not carry sixty copies of it.

   Where each property went (full reasoning: Private/pre-minimal-2026-09-08:notes/RETIREMENT-PLAN.md, and
   the four are readable in Private/pre-minimal-2026-09-08:requirements/tooling/retired/ — `company/tooling/` until the flatten):
     assert-status-honest   → assert-spec limbs 4 + 6. The markdown format kept a
                              status in three places that could disagree; the JSON
                              format has no status on an invariant at all, and limb
                              4 is the ratchet that stops one being re-added.
     assert-req-ids         → assert-spec limb 9. Its citation half could not be
                              repointed — after the deletion every `origin` cites a
                              file that is gone — so the declarations were frozen
                              into Private/requirements/origins.lock.json FIRST, and limb
                              9 checks both directions against that lock.
     assert-enforcers-exist → assert-spec limb 3, which is the same check over the
                              same citations, 10,854 ms → ~700 ms. That is why
                              assert-spec is `fast` and pre-push no longer carries a
                              slow guard.

   `check-dod-sync` never read the pipeline (its subjects are tooling/dod-register.json,
   requirements/dod-master-items.md — MASTER_PLAN.md §4, moved verbatim on 2026-09-08 — and
   requirements/definition-of-done.md) and is deliberately
   untouched — it is the control that proves the deletion broke nothing it did not
   model. If it ever goes red for this reason, the deletion touched something the
   plan did not model. */
/* 🔴 2026-09-08 — THREE ROWS REMOVED, AND EACH ONE WENT WITH ITS OWN SUBJECT.
   `assert-session-index`, `assert-research-archive` and `assert-plans-archive` are retiring in
   the private corpus’s minimal-corpus pass: `notes/session-notes-index.json`, `research/` and
   `plans/` are all being deleted, and a guard whose only subject is gone passes VACUOUSLY, which
   is the one result this runner exists to refuse. The private guards stay green in the corpus’s
   own sweep until the commit that deletes their subject retires them in the same commit.
   The plan and its measurements: `Private/pre-minimal-2026-09-08:research/full-read-2026-09-08/P2-minimal-corpus-2026-09-08.md`.
   The runner’s fast set drops from 10 to 7. No surviving guard lost a limb and no floor moved. */
const GUARDS = [
  // The 15 corpus rows that stood here are entries in Private/requirements/tooling/guards.json, read by guard-declaration.mjs; their comment blocks moved there verbatim (pinned source: 7f5d0bfd:tooling/scripts/spec-guards.mjs).

  /* ADDED 2026-09-09. THE FIRST ENTRY IN THIS ARRAY WHOSE SUBJECT IS PUBLIC, and
     `needsPrivate: false` is that fact declared rather than assumed: every other
     row here guards a file under the corpus, which is why the hook is their only
     enforcement surface. This one's subject is `apps/<app>/name-clearance.json`,
     `apps/<app>/app.yaml` and `tooling/channel-register.json` — all tracked, all
     present in a fresh clone and in every agent worktree — so it runs in CI TOO
     (`ci.yml#guards-store`) and is registered there. It is in this runner as
     well, and the reason is the cost of finding out late: a rename is ONE field
     and a re-render today (`tooling/app-yaml/render.mjs` line 252 is
     `'title.txt': doc.name`), and after listings exist it is store records,
     install bases, backlinks and a reservation clock, none of which come back.
     The check that costs 0.3 s at commit time is the same check that costs a
     product name at submission time.

     🔴 THE NETWORK PROBE IS NOT HERE AND MUST NEVER BE. `tooling/store/name-clearance.mjs`
     measured 15,365 / 13,726 ms on this machine over ~20 external calls; this
     guard measured 297 / 285 / 269 ms and dials out zero times. A blocking hook
     with fourteen seconds of network in it gets bypassed inside a week, and a
     guard that is skipped is worth less than no guard because it also carries the
     belief that something was checked. The probe is a routine; the record it
     writes is what this reads. One `rel` candidate, repo-relative: this guard has
     never existed under any earlier layout, so a legacy spelling would be a path
     that does not resolve — the same reasoning as the three entries above.

     ⚠️ NOTE ON AGE. It carries `assert-platform-state`'s staleness mechanism
     verbatim — `{value, asOf, verify, verifyKind}` with a 30-day ceiling — and
     therefore its rule about WHERE age speaks: a WARNING here, a FINDING under
     `--execute`. Every clearance record shares a birthday, and a hook that
     refuses every commit on the day the window closes is a hook this corpus has
     recorded itself skipping. It is deliberately invoked here WITHOUT `--execute`. */
  { name: 'assert-name-clearance', speed: 'fast', needsPrivate: false,
    rel: ['tooling/ci/assert-name-clearance.mjs'],
    what: 'every declared app name carries a current, non-blocked clearance record' },

  /* 🔴 `args: ['--self-test']` IS THE ONLY WAY THIS GUARD CAN RUN HERE, and it is
     not a loosening. The guard grades a staged release directory; outside a
     release run there is no such directory, so invoking it bare would be a guard
     that reports nothing on every commit — the shape this corpus has twice found
     and deleted. `--self-test` builds real release directories in os.tmpdir()
     from the real register and the real tool.json, breaks exactly one thing in
     each, and requires the guard to name it. It exits 1 the moment a limb stops
     failing, which is the property a sweep can actually check. */
  { name: 'assert-release-json', speed: 'fast', needsPrivate: false,
    rel: ['tooling/ci/assert-release-json.mjs'],
    args: ['--self-test'],
    what: 'the guard that grades a release record against its own bytes can still fail' },
];

/* The rows typed in this file. The corpus's own rows join them below, once the corpus
   is located and its declaration read; until then these are all this runner can name. */
const STATIC_SELECTED = GUARDS.filter((g) => FULL || g.speed === 'fast');

/* 🔴 CORPUS NOT LOCATED — REFUSE. Changed 2026-08-18 from exit 0; the header carries
   the reasoning and the cost. This branch used to be "case (b)" and printed NOT
   APPLICABLE over the whole set. The distinction it rested on — corpus absent BY
   DESIGN versus a guard gone missing — was sound, but it inferred "absent by design"
   from "not at the one path I know", and those are the same observation whenever the
   corpus MOVES. A locator is not a witness to absence. It only ever reports its own
   reach, so the honest output is the reach itself: every root tried, spelled out
   absolutely, so the reader can see at a glance whether the list is wrong or the
   corpus is genuinely gone. Nothing downstream of here can run, so this is terminal
   rather than a skip — there is no partial answer to give. */
if (!PRIVATE_ROOT) {
  console.error(`\n  CANNOT RUN — the private corpus was not found, so all ${STATIC_SELECTED.length} spec guard(s) have no subject.`);
  console.error(`  Searched ${PRIVATE_ROOT_CANDIDATES.length} root(s), each required to be a NON-EMPTY directory containing \`${CORPUS_MARKER}/\`:`);
  for (const root of PRIVATE_ROOT_CANDIDATES) {
    const mark = !isDir(root) ? 'no such directory'
      : !isNonEmptyDir(root) ? 'exists, but is EMPTY — a pre-created shell, not the corpus'
      : `exists and is non-empty, but no \`${CORPUS_MARKER}/\` inside`;
    console.error(`    --   ${root}`);
    console.error(`         ${mark}`);
  }
  // Anchor-derived context (added 2026-08-18, second entry). If the sibling name is right
  // and the anchor is wrong, or vice versa, this is the line that separates them — without
  // it "not found" is one message covering two unrelated causes.
  console.error(`  Workspace anchor: ${WORKSPACE_ROOT}   (brain: ${BRAIN} , products: ${PRODUCTS_ROOT})`);
  console.error(`  This repo: ${REPO_NAME}   ->   expected private sibling: ${PRIVATE_SIBLING_NAME}`);
  if (WORKTREE) console.error(`  This tree is a linked worktree of ${WORKTREE.main}, and the sibling above is named from THAT checkout.`);
  console.error('  These guard(s) were therefore not run:');
  for (const g of STATIC_SELECTED) console.error(`    --   ${g.name.padEnd(24)} ${g.what}`);
  console.error(`    --   ${'(every declared guard)'.padEnd(24)} the corpus declares them in ${DECLARATION_REL}, which is inside it`);
  console.error('  A runner that cannot find its subject has checked nothing, and nothing is not a pass.');
  console.error('  If the corpus moved, add its new home to PRIVATE_ROOT_CANDIDATES in this file — that');
  console.error('  list is the single place this runner learns where the corpus lives.\n');
  process.exit(2);
}

/* 🔴 THE DRIFT LIMB — THE FIRST CHECK ONCE THE CORPUS IS LOCATED, AND IT RUNS ONLY WHEN
   THE CORPUS INVOKED US (⏱ 2026-09-24, O-PRIVATE-HOOK-RUNNER-FOLLOWS-A-LIVE-BRANCH).
   The corpus's hooks are this repository's hooks, so a corpus commit is judged by
   whichever copy of THIS file its `core.hooksPath` reaches. Until today that was the
   main checkout on whatever branch it held, or a lane worktree: measured in a scratch
   pair, a corpus commit through a checkout on branch `live-feature` exited 0, graded by
   that branch's guards. Every guard below would have run and printed ok; what was wrong
   was the rules, and no guard can see its own rules. So before any guard runs, this asks
   the one question none of them can: is the runner that loaded me the pinned runner,
   detached at origin/main, with no edits? A no is a finding (exit 1) that names the tree
   that loaded it; "cannot tell" is COVERAGE LOST (exit 2).
   "Invoked by the corpus" is the repository `cwd` sits in — git runs every hook from the
   top of the committing work tree — whose main checkout is the corpus this run elected.
   From this repository's own hooks, and from a hand run here, the limb does not apply and
   costs one walk up to `.git` plus one `git rev-parse --git-common-dir`. */
const INVOKED_FROM = invokingCheckout(process.cwd());
if (INVOKED_FROM && sameDir(INVOKED_FROM, PRIVATE_ROOT)) {
  const drift = runnerDrift(REPO);
  if (drift.code !== 0) {
    console.error(`\n  ${drift.code === 1 ? 'RUNNER DRIFT' : 'CANNOT RUN — COVERAGE LOST'} — a corpus commit, judged by ${REPO}:`);
    for (const line of drift.lines) console.error(`  ${line}`);
    console.error(drift.code === 1
      ? '  No guard below was run: their verdict would have been this tree\'s, not origin/main\'s.\n'
      : '  No guard below was run: which rules they would apply is unknown.\n');
    process.exit(drift.code);
  }
  console.log(`  runner — the pinned runner at origin/main: ${REPO}`);
}

/* 🔴 THE DECLARED SET (2026-09-24, O-GUARD-SET-DECLARED-NOWHERE). The corpus's own
   guards are entries in its declaration, read through guard-declaration.mjs out of a
   git blob and never out of a working tree:
     · a commit OUTSIDE the corpus (this repo, or a worktree of it) reads the
       declaration at the corpus's HEAD, so it is judged against what the corpus
       committed and not against a half-edited file;
     · a commit IN the corpus reads the STAGED declaration, the one it is recording.
   WHICH SIDE A RUN IS ON. `REPO` is the corpus only when this runner sits inside it.
   The corpus's own hook runs THIS repository's copy (its `core.hooksPath` points at
   this repo's `.githooks/`), so there `REPO` is this repo and what names the corpus is
   the working directory: git runs a hook from the root of the work tree being
   committed (githooks(5)). Both are asked.
   An entry runs iff its `hook` array names the side, with its `args` verbatim. A
   declaration that cannot be read or parsed, an entry without `id`, `file` or `hook`,
   and a pinned guard absent are all COVERAGE LOST, printed with the blob tried in the
   shape of the corpus-not-found refusal above. */
const SIDE = sameRoot(REPO, PRIVATE_ROOT) || sameRoot(process.cwd(), PRIVATE_ROOT) ? 'private' : 'public';
let DECLARED;
try {
  DECLARED = loadGuardDeclaration(PRIVATE_ROOT, SIDE);
} catch (e) {
  if (!(e instanceof GuardDeclarationError)) throw e;
  console.error(`\n  CANNOT RUN — the corpus's declared guard set could not be used (limb: ${e.limb}), so the guards it declares have no list.`);
  console.error(`  ${e.message}`);
  for (const line of e.detail) console.error(`    --   ${line}`);
  console.error(`  Side: ${SIDE} — ${SIDE === 'public'
    ? 'a commit outside the corpus reads the declaration as the corpus COMMITTED it (HEAD)'
    : 'a commit in the corpus reads the declaration as STAGED (the index)'}.`);
  console.error(`  Tried ${e.tried.length} blob(s):`);
  for (const t of e.tried) {
    console.error(`    --   ${t.blob}   in ${t.root}`);
    console.error(`         ${t.command}`);
    for (const line of String(t.why ?? 'read; refused on its content, above').split('\n')) console.error(`         ${line}`);
  }
  console.error(`  Not read, by design: the working-tree copy ${join(PRIVATE_ROOT, ...DECLARATION_REL.split('/'))}`);
  console.error(`  Corpus root in use: ${PRIVATE_ROOT}   (searched: ${PRIVATE_ROOT_CANDIDATES.join(' , ')})`);
  console.error('  These guard(s) were therefore not run:');
  for (const g of STATIC_SELECTED) console.error(`    --   ${g.name.padEnd(24)} ${g.what}`);
  console.error(`    --   ${'(every declared guard)'.padEnd(24)} ${DECLARATION_REL}`);
  console.error('  A runner that cannot read its guard list has checked nothing, and nothing is not a pass.\n');
  process.exit(2);
}
console.log(`  declared set — ${DECLARED.rows.length} of ${DECLARED.entries.length} entries hook the ${SIDE} side, read from ${DECLARED.blob} in ${PRIVATE_ROOT}`);

const selected = [...DECLARED.rows, ...GUARDS].filter((g) => FULL || g.speed === 'fast');

/* Per-guard NOT APPLICABLE survives, and ONLY at this granularity: a guard whose own
   subject is legitimately absent while the corpus is present. Every entry today sets
   `needsPrivate: true` and the corpus is present by the time we reach this line, so
   the list is empty on every current run — it is the seam for a future guard with an
   optional subject, not a live skip path. The whole-corpus case above can no longer
   reach it, which is the entire point of the 2026-08-18 change. */
const inapplicable = [];

/* 🔴 COVERAGE FLOOR — CASE (a). The corpus IS here (or some guards do not need it),
   so a guard that cannot be found is a real defect. A hook that resolves zero
   guards and prints "ok" is the vacuous pass this corpus keeps finding. Refuse
   instead. Note this still fires when `Private/` exists and a guard inside it has
   been renamed or deleted — the property the floor was written for is unchanged. */
const applicable = selected.filter((g) => !inapplicable.includes(g));
const resolved = applicable.map((g) => ({ ...g, path: locate(...g.rel) }));
const missing = resolved.filter((g) => !g.path);
if (missing.length) {
  console.error(`\n  CANNOT RUN — ${missing.length} of ${applicable.length} spec guard(s) not found:`);
  for (const m of missing) console.error(`    ${m.name}   looked for: ${m.rel.join(' , ')}`);
  // Print the corpus root that WAS located (added 2026-08-18). Without it this
  // message is ambiguous in exactly the way that costs an hour: "guard not found"
  // reads as a deleted guard when the real cause can be a corpus root resolved one
  // directory off, which is a live risk for as long as two plausible roots exist.
  console.error(`  Corpus root in use: ${PRIVATE_ROOT}`);
  console.error(`  Also searched, relative to: ${CANDIDATE_ROOTS.join(' , ')}`);
  console.error('  A hook that cannot find its guards has checked nothing. Refusing rather than passing.\n');
  process.exit(2);
}
if (inapplicable.length) {
  console.log(`\n  ${inapplicable.length} guard(s) skipped — the corpus is present at ${PRIVATE_ROOT},`);
  console.log('  but these have no subject of their own inside it:');
  for (const g of inapplicable) console.log(`    --   ${g.name}`);
}

/* 🔴 THE CHILDREN ARE TOLD WHICH CORPUS WAS ELECTED (2026-09-08), and only when this
   tree is a worktree. `assert-public-citations.mjs` and `assert-spec.mjs` each resolve
   the logical `Private/` prefix for themselves, by the same convention this file uses —
   which lands on the same directory from a main checkout and on nothing at all from a
   worktree, because the sibling of `<worktree>` is not the corpus. `NIKATRU_PRIVATE_ROOT`
   is their documented override and it is set to the root THIS runner already elected by
   the non-empty + `requirements/` probes, so the runner and its guards cannot disagree
   about what they are checking. An override the caller set by hand is never overwritten.
   It is not a loosening: `assert-spec` still refuses if the corpus it is handed is not
   the corpus it lives in, which is the round-trip its own header describes. */
/* 🔴 THE CHILD ENVIRONMENT IS SCRUBBED, and until 2026-09-09 it was a bare
   `{ ...process.env }`. Git exports `GIT_DIR` into every hook process and it BEATS
   both `-C` and the child's cwd, so the two `--index` guards — whose subject is the
   PRIVATE corpus's staged index — read the index of whichever repository the commit
   was being made in. From the main checkout that is the same repository twice and
   nothing looks wrong. From a WORKTREE it is not, and the failure was silent in the
   worst available way: the guard printed the private repo's NAME above the public
   worktree's NUMBERS.

   MEASURED, both halves, on 2026-09-09:
     cd <private> && node requirements/tooling/check-agent-docs.mjs --index
       → EXIT 0 · 263 tracked file(s), 22 instruction doc(s)
     cd <private> && GIT_DIR=<public worktree>/.git node …/check-agent-docs.mjs --index
       → EXIT 2 · 2065 tracked file(s), 2 instruction doc(s) · `docsScanned 2 < 3`
   The second is byte-identical to what this runner printed from a worktree, which is
   what identifies the exported variable as the cause rather than a candidate for it.

   ⚠️ IT PRESENTED AS A COVERAGE FLOOR, WHICH IS THE POINT. `docsScanned 2 < 3` is the
   floor working: two instruction docs is what the PUBLIC tree has, so the run really
   had stopped being evidence about the corpus. A floor is the only thing between that
   and a green — and the tempting reading, that a floor tripping from a worktree is a
   floor set too high, is how this would have been "fixed" by lowering it to 2.

   `cleanGitEnv` is repo-git.mjs's own list of the six redirecting variables, reused
   rather than re-spelled: a second copy of that list is the first one to drift, and
   the one place it must not drift is the one that decides which repository a guard
   is looking at. Nothing here needs the exported variables — every guard anchors its
   own root from `import.meta.url` and a worktree's `.git` FILE resolves on its own. */
const CHILD_ENV = cleanGitEnv().env;
console.log(`    ${strippedNote()}`);
if (WORKTREE && !process.env.NIKATRU_PRIVATE_ROOT) {
  CHILD_ENV.NIKATRU_PRIVATE_ROOT = PRIVATE_ROOT;
  console.log(`    NIKATRU_PRIVATE_ROOT=${PRIVATE_ROOT} passed to every guard below.`);
}

const t0 = Date.now();
const results = [];
for (const g of resolved) {
  const started = Date.now();
  // spawnSync, never a shell pipeline: `$?` after a pipe is the LAST stage's
  // status, which is how a failing guard reads as 0. This corpus has been bitten
  // by that twice, once while testing a guard against exactly that trap.
  const r = spawnSync(process.execPath, [g.path, ...(g.args ?? [])], { encoding: 'utf8', env: CHILD_ENV });
  const code = r.status === null ? 2 : r.status;
  results.push({ ...g, code, ms: Date.now() - started, out: (r.stdout ?? '') + (r.stderr ?? '') });
}

const red = results.filter((r) => r.code === 1);
const broke = results.filter((r) => r.code !== 0 && r.code !== 1);

for (const r of results) {
  const mark = r.code === 0 ? 'ok  ' : r.code === 1 ? 'FAIL' : 'ERR ';
  console.log(`  ${mark} ${r.name.padEnd(24)} ${String(r.ms).padStart(6)} ms   ${r.what}`);
  if (VERBOSE || r.code !== 0) {
    const tail = r.out.trim().split('\n').slice(-12);
    for (const line of tail) console.log(`         ${line}`);
  }
}

const total = Date.now() - t0;
console.log(`  ${results.length} guard(s) in ${total} ms` +
  (FULL ? '' : '   (fast set — pre-push runs the full set)'));

if (broke.length) {
  console.error(`\n  ${broke.length} guard(s) could not run. Treating as a refusal, not a pass.`);
  console.error('  Read the first ERR line above: it names the guard that refused. A refusal is about where');
  console.error('  this ran (the anchor, the corpus, a worktree), not a finding in the change.\n');
  process.exit(2);
}
if (red.length) {
  console.error(`\n  ${red.length} guard(s) reported a finding. Read the first FAIL line above and fix what it`);
  console.error('  names; a red hook is fixed, never skipped.\n');
  process.exit(1);
}
process.exit(0);
