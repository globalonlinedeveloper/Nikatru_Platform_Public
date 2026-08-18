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
// EXIT CODES:  0 = every applicable guard passed
//              1 = a guard reported a finding
//              2 = could not run — either the corpus could not be located at all,
//                  or it IS present and a guard inside it is missing. Both are
//                  refusals: neither one checked the thing it claims to check.
//
// Usage:  node tooling/scripts/spec-guards.mjs --fast
//         node tooling/scripts/spec-guards.mjs --full
//         node tooling/scripts/spec-guards.mjs --full --verbose
// ─────────────────────────────────────────────────────────────────────────────
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');          // tooling/scripts -> repo root

const argv = process.argv.slice(2);
const FULL = argv.includes('--full');
const VERBOSE = argv.includes('--verbose');

/* The guards live in two trees and this script may be invoked from EITHER — the
   public repo's hook, or Private/'s own hook, whose repo root is a
   different directory entirely. So each guard is resolved by trying both
   locations rather than by assuming one. A hook that silently finds no guards
   would report success over an empty set, which is precisely the defect class
   this whole session has been closing. */
const CANDIDATE_ROOTS = [
  REPO,                                  // invoked from the public repo
  resolve(REPO, '..', '..'),             // the pre-flatten depth: `Private/company` (deleted 2026-08-15)
                                         // sat two levels below this repo root
  resolve(REPO, '..'),                   // one level — where `Private/` sits since the flatten
];

/* WHERE THE PRIVATE CORPUS ITSELF LIVES — its own list, ordered newest-first, because
   after 2026-08-18 the corpus is no longer a `Private/` child of anything. It is a
   SIBLING of this repo, so the old "root + 'Private'" shape cannot express it: there
   is no parent directory whose child is the corpus and whose other child is a root we
   already search. Kept as a list rather than a constant so the pre-move layouts still
   resolve — this file has to be correct on both sides of the move, and it is the same
   file that runs during it. */
const PRIVATE_ROOT_CANDIDATES = [
  resolve(REPO, '..', `${basename(REPO)}_Private`),  // 🔴 2026-08-18: the sibling, and the answer from here on
  resolve(REPO, 'Private'),               // pre-move: the corpus nested inside this repo
  resolve(REPO, '..', 'Private'),         // the flatten-era one-level-up layout
  resolve(REPO, '..', '..', 'Private'),   // the pre-flatten depth, same two levels as CANDIDATE_ROOTS
  REPO,                                   // invoked from the corpus's OWN hook, where it IS the repo root
];

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
const CORPUS_MARKER = 'requirements';
const PRIVATE_ROOT = PRIVATE_ROOT_CANDIDATES.find(
  (root) => existsSync(root) && existsSync(join(root, CORPUS_MARKER))
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

   Where each property went (full reasoning: Private/notes/RETIREMENT-PLAN.md, and
   the four are readable in Private/requirements/tooling/retired/ — `company/tooling/` until the flatten):
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
   MASTER_PLAN.md and requirements/definition-of-done.md) and is deliberately
   untouched — it is the control that proves the deletion broke nothing it did not
   model. If it ever goes red for this reason, the deletion touched something the
   plan did not model. */
const GUARDS = [
  { name: 'check-dod-sync', speed: 'fast', needsPrivate: true,
    rel: ['tooling/scripts/check-dod-sync.mjs'],
    what: 'the DoD page, the register and MASTER_PLAN §4 agree' },
  { name: 'assert-spec', speed: 'fast', needsPrivate: true,
    rel: ['requirements/tooling/assert-spec.mjs', 'Private/requirements/tooling/assert-spec.mjs', 'Private/spec/tooling/assert-spec.mjs', 'tooling/assert-spec.mjs'],  // fallback chain — `locate` takes the FIRST that exists, so only one candidate need resolve. 🔴 2026-08-18: the LEADING entry is now corpus-RELATIVE, which is what survives the move — `locate` joins it onto PRIVATE_ROOT, so it resolves to `Private/requirements/…` before the move and `..._Private/requirements/…` after it, with no second edit on the day. The `Private/…` spelling is demoted to a fallback rather than deleted because it is still how the path resolves from the OTHER candidate roots. The `spec/` entry names the pre-flatten layout (retired 2026-08-16, when spec/ dissolved into requirements/) and is kept on purpose. Same shape as the four entries below it.
    what: 'the JSON spec is schema-valid, id-unique, origin-locked, and every enforcer it names exists' },
  /* ADDED 2026-08-15 with the flatten. `Private/README.md` is the index the
     flatten exists to deliver, and an index is a hand-kept second copy of the
     tree — the exact artefact this repository has twice watched go stale in
     silence. The README it replaced still read as authoritative while pointing
     at `../knowledge/decisions/`, a directory that had not existed for days.
     Prose cannot announce its own staleness, so the index is asserted instead. */
  { name: 'assert-index-complete', speed: 'fast', needsPrivate: true,
    rel: ['requirements/tooling/assert-index-complete.mjs', 'Private/requirements/tooling/assert-index-complete.mjs', 'Private/spec/tooling/assert-index-complete.mjs', 'tooling/assert-index-complete.mjs'],  // same fallback chain, corpus-relative leading entry added 2026-08-18 (retired 2026-08-16 layout in the third slot) — see the assert-spec entry above
    what: 'Private/README.md names every directory and every navigable file, and its links resolve' },
  /* ADDED 2026-08-16 with the streamline. `assert-index-complete` deliberately
     does NOT enumerate `research/` — 51 filenames in the corpus index would bury
     the sixteen runbooks that index exists to surface — and the cost of that
     judgement was measured on the day: `research/README.md` named 8 of its 51
     files, and carried a link to `../../company/MASTER_PLAN.md` for a day after
     that path stopped existing. So the directory gets its own register and its
     own guard, at its own depth. Same doctrine, one level down. */
  { name: 'assert-research-archive', speed: 'fast', needsPrivate: true,
    rel: ['requirements/tooling/assert-research-archive.mjs', 'Private/requirements/tooling/assert-research-archive.mjs', 'Private/spec/tooling/assert-research-archive.mjs', 'tooling/assert-research-archive.mjs'],  // same fallback chain, corpus-relative leading entry added 2026-08-18 (retired 2026-08-16 layout in the third slot) — see the assert-spec entry above
    what: 'research/index.json, the files on disk and research/README.md are in bijection, and no successor pointer dangles' },
  /* ADDED 2026-08-16 with the decisions/ streamline. The ADR set had ONE property
     nothing could check and nothing structurally could: whether a cited number is
     a decision at all. Three — 012, 014, 018 — were pre-allocated as headings in
     `research/29-SYNTHESIS-A-S.md`, never written, and are cited 63 times today
     from 17 files, one of them in the PUBLIC tree. A bare `[ADR 012]` is not a
     markdown link, so `assert-index-complete`'s link limb cannot see it, and the
     README table lists only files that exist, so a number with no file is
     invisible to any check that walks files. Existing phantoms are DECLARED and
     printed on every run rather than banned — the citations sit inside the
     finished spec, which must not be restructured — so what this ratchets is the
     NEXT one: an ADR cited before it lands fails the commit that writes it. */
  { name: 'assert-adr-citations', speed: 'fast', needsPrivate: true,
    rel: ['requirements/tooling/assert-adr-citations.mjs', 'Private/requirements/tooling/assert-adr-citations.mjs', 'Private/spec/tooling/assert-adr-citations.mjs', 'tooling/assert-adr-citations.mjs'],  // same fallback chain, corpus-relative leading entry added 2026-08-18 (retired 2026-08-16 layout in the third slot) — see the assert-spec entry above
    what: 'decisions/index.json matches the ADRs on disk, and every `ADR NNN` under Private/ resolves' },
  /* ADDED 2026-08-17 with the session-log index. `session-notes.md` is 11k lines
     and 149 entries, APPEND-ONLY and correct that way — the log is the durable
     memory, and truncating it would destroy what the corpus is for. What it had
     no map, so in practice nobody read past the top: every finding after the
     first week was on disk and effectively unreachable. `notes/session-notes-index.json`
     is that map. ⚠️ It is also the FOURTH hand-kept second copy of a tree in this
     corpus, and the other three each went stale in silence — so it gets the same
     treatment as the other three registers rather than a promise. The drift here
     is not hypothetical or slow: appending an entry IS the ritual of that file,
     and the row is forgotten the first time somebody appends in a hurry. The
     title limb is the sharp one — it catches an INSERTION, which shifts every
     line below it and would otherwise leave each row pointing confidently at
     somebody else's entry, exactly the `ci.yml:NNNN` failure one file over. */
  /* ADDED 2026-08-17. THE PUBLIC HALF OF ST-3, AND NOTHING HAD EVER CHECKED IT.
     `assert-spec` limb 3 checks the spec's own `guard` fields, and
     `assert-adr-citations` is scoped to `Private/` — so between them a file in
     the PUBLIC tree could cite anything at all and no build would notice. Its
     first run found 241 unresolved citations across 101 files.

     It resolves two classes, and the split between them reversed the obvious
     read: 362 `Private/...` path references, of which 189 were dead, against
     1,464 `[pipeline X-N]` tags yielding 1,020 requirement ids, of which only 18
     were. So the tags were NOT rot — each still resolves to an `origin` field in
     `Private/requirements/*.json` — and rewriting them would have been a large
     edit that destroyed working pointers. The paths were the damage.

     It belongs in this set rather than in CI for the same reason every other
     guard here does: the resolution target is private, so a CI run would answer
     NOT APPLICABLE every time, which is a check that always passes. */
  { name: 'assert-public-citations', speed: 'fast', needsPrivate: true,
    rel: ['tooling/scripts/assert-public-citations.mjs'],
    what: 'every `Private/` path and every `[pipeline]` requirement id cited in the PUBLIC tree resolves' },
  { name: 'assert-session-index', speed: 'fast', needsPrivate: true,
    rel: ['requirements/tooling/assert-session-index.mjs', 'Private/requirements/tooling/assert-session-index.mjs', 'Private/spec/tooling/assert-session-index.mjs', 'tooling/assert-session-index.mjs'],  // same fallback chain, corpus-relative leading entry added 2026-08-18 (retired 2026-08-16 layout in the third slot) — see the assert-spec entry above
    what: 'every `## ` entry in session-notes.md has an index row, every row resolves, and the titles are byte-identical' },
];

const selected = GUARDS.filter((g) => FULL || g.speed === 'fast');

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
  console.error(`\n  CANNOT RUN — the private corpus was not found, so all ${selected.length} spec guard(s) have no subject.`);
  console.error(`  Searched ${PRIVATE_ROOT_CANDIDATES.length} root(s), each required to contain \`${CORPUS_MARKER}/\`:`);
  for (const root of PRIVATE_ROOT_CANDIDATES) {
    const mark = existsSync(root) ? `exists, but no \`${CORPUS_MARKER}/\` inside` : 'no such directory';
    console.error(`    --   ${root}`);
    console.error(`         ${mark}`);
  }
  console.error('  These guard(s) were therefore not run:');
  for (const g of selected) console.error(`    --   ${g.name.padEnd(24)} ${g.what}`);
  console.error('  A runner that cannot find its subject has checked nothing, and nothing is not a pass.');
  console.error('  If the corpus moved, add its new home to PRIVATE_ROOT_CANDIDATES in this file — that');
  console.error('  list is the single place this runner learns where the corpus lives.\n');
  process.exit(2);
}

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

const t0 = Date.now();
const results = [];
for (const g of resolved) {
  const started = Date.now();
  // spawnSync, never a shell pipeline: `$?` after a pipe is the LAST stage's
  // status, which is how a failing guard reads as 0. This corpus has been bitten
  // by that twice, once while testing a guard against exactly that trap.
  const r = spawnSync(process.execPath, [g.path], { encoding: 'utf8' });
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
  console.error(`\n  ${broke.length} guard(s) could not run. Treating as a refusal, not a pass.\n`);
  process.exit(2);
}
if (red.length) {
  console.error(`\n  ${red.length} guard(s) reported a finding. Fix it, or commit with --no-verify` +
    ' and say why in the message.\n');
  process.exit(1);
}
process.exit(0);
