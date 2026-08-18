#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// install-hooks.mjs — point every repo in this tree at .githooks/, and prove it.
//
// 🔴 WHY AN INSTALLER IS NEEDED AT ALL, AND WHY IT IS NOT OPTIONAL.
// `core.hooksPath` is LOCAL config. It is not committed, it is not cloned, and
// nothing in git will ever set it for you. A hooks directory sitting in the repo
// with nobody pointed at it is DOCUMENTATION, not a guard — measured in the
// sibling extension repo on 2026-08-14, where `.githooks/pre-commit` had been
// committed and pushed while `core.hooksPath` was set on exactly one machine.
//
// TWO repos need it, because two repos take commits:
//   ·  the public repo            (code, tooling, CI)
//   ·  the private corpus         (the spec, the ADRs and the session log — the
//                                  guards' actual subject; ONE repo since the
//                                  2026-08-15 flatten merged company/ + knowledge/)
// ⚠️ This header said THREE, naming `Private/company/` and `Private/knowledge/` (deleted
// 2026-08-15), for two days after the flatten — while the code below
// declared two and explained why. A comment cannot go red, so the code was right
// and the paragraph a reader starts from was wrong. Corrected 2026-08-17.
//
// 📍 2026-08-18 — THE PRIVATE CORPUS LEFT THIS TREE, AND THE REASON ITS ABSENCE IS
// TOLERATED CHANGED WITH IT. Until today it was the gitignored subdirectory
// `<repo>/Private`, and this paragraph said so: "gitignored, so it is absent from
// every public clone and every agent worktree". It is now the SIBLING directory
// `Project_Cross_Platform_Apps_Private` — OUTSIDE this repo, so gitignore has
// nothing to do with it any more. It is simply a different repository, and a
// public clone still does not get one. So absence is STILL not a failure and the
// three-state branch below is unchanged in shape — but a reader who went looking
// for the old reason would not find it, which is why the old wording is quoted
// here rather than overwritten. The declaration that moved is `PRIVATE`, below.
//
// 📍 2026-08-18, LATER THE SAME DAY — AND THEN THE WHOLE TREE WAS REORGANISED INTO
// Store × Platform × Type. This repo now sits THREE LEVELS DEEPER
// (`Projects/Google_Store/Google_Play_Store/Google_Play_Store_Apps/…_Public`) and both it
// and its corpus were RENAMED along the way (`…_Cross_Platform_Android_Apps_Public` and
// `…_Cross_Platform_Android_Apps_Private`). The paragraph above still describes the SHAPE
// correctly — sibling corpus, three-state branch, absence tolerated — so it stands as the
// dated record of the morning; but every path written in it is stale by three levels, and
// that is TWICE IN ONE DAY that a path derived by counting `..` went wrong. What changed
// underneath it is HOW the corpus is found: by ANCHORING on the workspace root rather than
// counting levels from here. The reasoning is in the block above `PRIVATE`, below.
//
// Usage:  node tooling/scripts/install-hooks.mjs           install + verify
//         node tooling/scripts/install-hooks.mjs --check   verify only, exit 1 if not installed
// ─────────────────────────────────────────────────────────────────────────────
import { spawnSync } from 'node:child_process';
import { existsSync, statSync, readdirSync } from 'node:fs';
import { resolve, dirname, basename, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const HOOKS = join(REPO, '.githooks');
const CHECK_ONLY = process.argv.includes('--check');

/* 🔴 ONE PRIVATE REPO SINCE THE 2026-08-15 FLATTEN, NOT TWO — and the old list did
   not merely go stale, it went QUIET. `Private/company` and `Private/knowledge` (deleted
   2026-08-15) stopped existing as repos, this script printed "no .git here — skipped" for both,
   and then printed "every repo is pointed at .githooks/" and exited 0. Two of three
   subjects vanished and the check reported success: the exact vacuous pass this
   corpus exists to eliminate, in the installer written that same morning to prevent
   an uninstalled hook. The `expected` flag below is the fix — a repo declared here
   and absent on disk is now a FAILURE, not a skip. */
/* 🔴 2026-08-18 — THE PRIVATE CORPUS IS A SIBLING NOW, NOT A SUBDIRECTORY, AND THIS
   DECLARATION IS THE MACHINE-READ VALUE THAT HAD TO MOVE WITH IT. It was
   `join(REPO, 'Private')`. Left pointing there after the move it would have found
   nothing, taken the absent branch below, printed n/a and exited 0 — the corpus
   unreachable, its hooks uninstalled, and this installer reporting success. That is
   the same vacuous pass the `expected` flag above was written to end, arriving by a
   different road: not a repo that vanished, but a declaration that stayed put.

   Resolved from REPO rather than hardcoded, so it still tracks the pair if the whole
   tree is relocated again — the property the comment below the loop was written for.

   THE hooksPath ARITHMETIC WAS COMPUTED, NOT ASSUMED. `relative(PRIVATE, HOOKS)`
   from the sibling yields `../Project_Cross_Platform_Apps/.githooks`. The two
   directory names share a prefix, which is exactly the shape that invites a string
   bug, but they are two path SEGMENTS and nothing collapses into `../.githooks`;
   checked with node before landing, and `resolve(PRIVATE, want)` returns HOOKS
   exactly. */
/* 🔴 2026-08-18, SECOND MOVE OF THE DAY — LEVEL-COUNTING IS THE BUG, NOT THE DEPTH.
   This declaration was `resolve(REPO, '..', 'Project_Cross_Platform_Apps_Private')`,
   correct from this morning's move until this afternoon's reorg and wrong after it. A
   third `..` would buy one more afternoon: ~20 more repos are coming at VARYING depths,
   and any fixed level count is wrong again the moment one of them is nested differently.
   So nothing below counts levels. It ANCHORS.

   THE ANCHOR IS THE WORKSPACE ROOT: walk UP from this file until a directory holds BOTH
   `Projects/` and `nikatru/` — the products root and the shared business brain. Neither
   the depth nor the absolute path is written down anywhere here; that is the whole point.
   Nest this repo ten levels deeper and the walk takes ten more steps and still lands.

   IT IS NOT DECORATION, AND IT IS NOT USED TO BUILD THE CORPUS PATH — the corpus is this
   repo's SIBLING, so `dirname(REPO)` locates that. What the anchor buys is a TRUSTWORTHY
   ABSENT BRANCH, which is the thing this script has never had. Two states have looked
   identical from in here all day:
     anchor found, sibling absent   →  the corpus is not in this workspace. n/a, exit 0 —
                                       a public clone, the 2026-08-17 contributor fix intact.
     no anchor at all               →  this script does not know where it is. REFUSE (exit
                                       2), naming every directory walked.
   Treating the second as the first is precisely the vacuous pass this file is about: a
   wrong private path finds nothing, installs nothing, and reports success. There is no
   fallback and no default — a fallback here IS a guess, and a level count is a guess that
   has now been wrong twice in eight hours. */
const ANCHOR_MARKERS = ['Projects', 'nikatru'];
function findWorkspaceAnchor(from) {
  const walked = [];
  let dir = from;
  for (;;) {
    walked.push(dir);
    const holds = (n) => { try { return statSync(join(dir, n)).isDirectory(); } catch { return false; } };
    if (ANCHOR_MARKERS.every(holds)) return { anchor: dir, walked };
    const up = dirname(dir);
    if (up === dir) return { anchor: null, walked };   // filesystem root — stop, never wrap
    dir = up;
  }
}
const { anchor: ANCHOR, walked: WALKED } = findWorkspaceAnchor(HERE);
if (!ANCHOR) {
  console.error(`\n  CANNOT RUN — no workspace root above ${HERE}.`);
  console.error(`  Looked for ONE directory holding BOTH ${ANCHOR_MARKERS.map((m) => `${m}/`).join(' and ')}.`);
  console.error('  Walked, in order, and none of these qualified:');
  for (const d of WALKED) console.error(`    ${d}`);
  console.error('  Refusing rather than guessing: an unanchored private path installs nothing and reports success.\n');
  process.exit(2);
}

/* The corpus is this repo's SIBLING and is NAMED after it — `…_Public` → `…_Private`,
   or `_Private` appended when there is no `_Public` suffix to swap. Derived from the
   directory name rather than spelled out, so today's rename (`Project_Cross_Platform_Apps`
   → `Project_Cross_Platform_Android_Apps_Public`) needed no edit here and the next one
   will not either. */
const REPO_DIR = basename(REPO);
const PRIVATE_NAME = REPO_DIR.endsWith('_Public')
  ? `${REPO_DIR.slice(0, -'_Public'.length)}_Private`
  : `${REPO_DIR}_Private`;
const PRIVATE = join(dirname(REPO), PRIVATE_NAME);

/* 🔴 THE EMPTY-SHELL TRAP IS STILL LIVE AND IT GOT ELEVEN TIMES BIGGER TODAY. The note
   here used to read: "The sibling directory `Project_Cross_Platform_Apps_Private` ALREADY
   EXISTS AND IS EMPTY — pre-created before the move. Selecting on the DIRECTORY would pick
   that empty shell today and refuse while the corpus sat one directory over." The
   reasoning is unchanged and still load-bearing; only the census moved. Counted on
   2026-08-18 after the reorg: `find Projects -maxdepth 4 -type d -name '*_Private*'`
   returns THIRTEEN, and ELEVEN are empty pre-created shells (Apple iOS/macOS apps+games,
   Android games, Linux apps+games, Microsoft apps+games, Web apps+games). Exactly one is
   this repo's corpus, and a name-derived path lands on a shell for any repo whose corpus
   has not been filled yet.
   So EMPTINESS is the test, not existence:
     directory empty              →  never had the corpus. Absence, n/a — see the branch below.
     directory non-empty, no .git →  a real corpus that is BROKEN. Still RED, still a
                                     failure — the case the `expected` flag was written for. */
const isNonEmpty = (d) => { try { return readdirSync(d).length > 0; } catch { return false; } };

/* The pre-2026-08-18 locations, newest first. Kept ONLY as evidence for the leftover test
   in the absent branch below — nothing is installed into either. Both are real former
   homes from the SAME DAY: the flat sibling under `Projects/` that stood for a few hours
   this morning, and the in-repo subdirectory it replaced. The first is addressed off the
   anchor because it is not this repo's sibling any more. */
const PRIVATE_WAS = [
  join(ANCHOR, 'Projects', 'Project_Cross_Platform_Apps_Private'),
  join(REPO, 'Private'),
];

const REPOS = [
  { name: 'public repo', path: REPO, expected: true },
  { name: 'private corpus', path: PRIVATE, expected: true, movedFrom: PRIVATE_WAS },
];

function git(cwd, args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  return { code: r.status === null ? 2 : r.status, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() };
}

/* The hooks must exist before anything is pointed at them, or every repo ends up
   configured to run nothing — which reads exactly like a clean install. */
const required = ['pre-commit', 'pre-push'];
const absent = required.filter((h) => !existsSync(join(HOOKS, h)));
if (absent.length) {
  console.error(`\n  CANNOT RUN — ${HOOKS} is missing: ${absent.join(', ')}`);
  console.error('  Pointing a repo at an empty hooks directory installs silence, not a guard.\n');
  process.exit(2);
}

console.log(`\n  hooks directory: ${HOOKS}`);
for (const h of required) {
  const st = statSync(join(HOOKS, h));
  console.log(`    ${h.padEnd(12)} ${String(st.size).padStart(5)} bytes`);
}
console.log('');

let failures = 0;
for (const r of REPOS) {
  if (!existsSync(join(r.path, '.git'))) {
    /* 🔴 2026-08-17 — THREE STATES, NOT TWO, AND CONFLATING TWO OF THEM MADE THE
       PUBLIC REPO UNUSABLE. `Private/` is gitignored, so it is absent from EVERY
       public clone and from every agent worktree by design. This branch reported
       RED and exited 1 for all of them — a new contributor's first command failing
       on the deliberate absence of a directory they are never given.

       The `expected` flag was added to catch a real defect (a declared repo that
       silently vanished, which this script once passed over while printing "every
       repo is pointed at .githooks/"). That catch is KEPT and is unchanged — it
       just needed a sharper test than "no .git here":

         directory absent entirely   →  n/a. Never had the corpus. Not a failure.
         directory present, no .git  →  RED. It IS here and it is broken — the
                                        exact case the flag was written for.

       Verified both ways before landing: `mv Private Private.probe` makes this
       print n/a and exit 0; moving `Private/.git` out of the way — tree present,   ← (no longer exists after the 2026-08-18 move; that is the pre-move layout, and this paragraph is left saying what was actually run on 2026-08-17 rather than re-pointed at a path the run never touched)
       repo gone — still prints RED and exits 1. (Said in prose rather than as a second `mv` with its destination spelled out: `assert-public-citations` reads every `Private/…` in the tree as a citation, and an example's invented destination is indistinguishable from a real one.) */
    /* 2026-08-18: an EMPTY directory is not "here" — eleven empty pre-created shells now
       sit in this tree and the name-derived path lands on one for every product whose
       corpus has not been filled. See `isNonEmpty` above for the count and the rule. */
    const shellOnly = existsSync(r.path) && !isNonEmpty(r.path);
    const leftover = (r.movedFrom ?? []).find((p) => existsSync(p));
    if (r.expected && existsSync(r.path) && !shellOnly) {
      console.log(`  RED  ${r.name.padEnd(20)} DIRECTORY IS HERE BUT HAS NO .git — not skipped, failed`);
      failures++;
    } else if (r.expected && leftover) {
      /* 🔴 2026-08-18 — THE ONE PLACE "MOVED AWAY" AND "NEVER CLONED" ARE TELLABLE
         APART, so it is checked here rather than lamented in a comment. Absence by
         itself cannot distinguish them and never could: a public clone and a
         half-finished move both present an empty space where the corpus should be,
         and the n/a below would call each of them fine.
         But a move that did not finish leaves EVIDENCE — the old location still on
         disk — and a clone never has it. Old location present AND new location
         absent therefore means the move stalled, which is a FAILURE.
         This does not re-break what the 2026-08-17 note below fixed: a public clone
         has NEITHER directory, so it still falls through to n/a and still exits 0. */
      console.log(`  RED  ${r.name.padEnd(20)} not at ${r.path}`);
      console.log(`       — but a pre-move location is still on disk: ${leftover}`);
      console.log('       a stalled or unstarted move, not a clean checkout. Finish the move, then re-run.');
      failures++;
    } else if (r.expected && shellOnly) {
      /* Named rather than folded into the n/a below. Both are "no corpus here" and both
         exit 0, but only one of them has a directory sitting there looking like a corpus,
         and a reader who is mid-move needs to be told which one they are looking at. */
      console.log(`  n/a  ${r.name.padEnd(20)} only an EMPTY pre-created shell at ${r.path} — never held the corpus`);
    } else if (r.expected) {
      console.log(`  n/a  ${r.name.padEnd(20)} not in this checkout — a separate sibling repo, never cloned alongside`);
    } else {
      console.log(`  --   ${r.name.padEnd(20)} no .git here — skipped`);
    }
    continue;
  }
  // Each repo needs a path RELATIVE TO ITSELF, because the private corpus is its
  // own repository whose root is not this one. An absolute path would work today
  // and break the moment the tree moves — which it did, this very session.
  // 2026-08-18: since the corpus became a sibling, that relative path no longer
  // just climbs out of it (`../.githooks`) — it climbs out and back into a NAMED
  // peer, so the public repo's own directory name is now part of the value stored
  // in the corpus's git config. Rename the public repo directory and this string
  // goes stale in a config file that lives in the other repo; re-running fixes it.
  // 📍 2026-08-18, LATER — THAT HAZARD CAME DUE THE SAME AFTERNOON, AND IT IS THE ONE
  // FAILURE MODE NO ANCHOR CAN PREVENT, because the stale value lives in the OTHER repo's
  // config file where nothing in this tree reads it. The reorg renamed the public repo, so
  // the corpus was still carrying `../Project_Cross_Platform_Apps/.githooks` — a path with
  // no directory at the end of it, i.e. hooks silently not running — until this run
  // rewrote it to `../Project_Cross_Platform_Android_Apps_Public/.githooks`. Read back out
  // of `git -C <corpus> config --get core.hooksPath` and confirmed to reach the two real
  // hook files. RE-RUN THIS SCRIPT AFTER ANY RENAME OR RE-NEST; it is the only thing that
  // repairs the other repo's copy.
  const want = relative(r.path, HOOKS).split('\\').join('/');
  const cur = git(r.path, ['config', '--get', 'core.hooksPath']);

  if (cur.out === want) {
    console.log(`  ok   ${r.name.padEnd(20)} core.hooksPath = ${want}`);
    continue;
  }
  if (CHECK_ONLY) {
    console.log(`  RED  ${r.name.padEnd(20)} core.hooksPath = ${cur.out || '(unset)'}   want ${want}`);
    failures++;
    continue;
  }
  const set = git(r.path, ['config', 'core.hooksPath', want]);
  if (set.code !== 0) {
    console.log(`  ERR  ${r.name.padEnd(20)} could not set: ${set.err}`);
    failures++;
    continue;
  }
  const after = git(r.path, ['config', '--get', 'core.hooksPath']);
  // Verify by reading back, never by trusting the write. A config set that
  // reports success and stores nothing is indistinguishable from an install.
  if (after.out === want) console.log(`  SET  ${r.name.padEnd(20)} core.hooksPath = ${want}`);
  else { console.log(`  ERR  ${r.name.padEnd(20)} wrote ${want}, read back "${after.out}"`); failures++; }
}

console.log('');
if (failures) {
  console.error(`  ${failures} repo(s) not installed.` +
    (CHECK_ONLY ? '  Run without --check to install.\n' : '\n'));
  process.exit(1);
}
/* Say how many repos were actually reached. "every repo" over a set of one, with
   the other reported n/a two lines above, is the same overstatement this script
   was written to stop — it just fails in the flattering direction instead. */
const reached = REPOS.filter((r) => existsSync(join(r.path, '.git'))).length;
const suffix = reached === REPOS.length ? '' : ` (${REPOS.length - reached} not in this checkout)`;
console.log(CHECK_ONLY
  ? `  ${reached} of ${REPOS.length} repo(s) pointed at .githooks/${suffix}\n`
  : `  installed and verified in ${reached} of ${REPOS.length} repo(s)${suffix}.\n`);
process.exit(0);
