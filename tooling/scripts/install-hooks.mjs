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
// Usage:  node tooling/scripts/install-hooks.mjs           install + verify
//         node tooling/scripts/install-hooks.mjs --check   verify only, exit 1 if not installed
// ─────────────────────────────────────────────────────────────────────────────
import { spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { resolve, dirname, join, relative } from 'node:path';
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
// 🔴 LOCATION-TOLERANT, AND THE MARKER PROBE IS THE POINT. The sibling directory
// `Project_Cross_Platform_Apps_Private` ALREADY EXISTS AND IS EMPTY — pre-created before
// the move. Selecting on the DIRECTORY would pick that empty shell today and refuse while
// the corpus sat one directory over, which is a half-state between this edit and the move.
// Selecting on a FILE the corpus must contain tells the shell apart from the tree, so this
// is correct before the move and after it, with no second edit on the day.
const PRIVATE_CANDIDATES = [
  resolve(REPO, '..', 'Project_Cross_Platform_Apps_Private'),
  resolve(REPO, 'Private'),
];
const PRIVATE =
  PRIVATE_CANDIDATES.find((c) => existsSync(join(c, '.git'))) ?? PRIVATE_CANDIDATES[0];

/* The pre-2026-08-18 location. Kept ONLY as evidence for the leftover test in the
   absent branch below — nothing is installed into it. */
const PRIVATE_WAS = join(REPO, 'Private');

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
    if (r.expected && existsSync(r.path)) {
      console.log(`  RED  ${r.name.padEnd(20)} DIRECTORY IS HERE BUT HAS NO .git — not skipped, failed`);
      failures++;
    } else if (r.expected && r.movedFrom && existsSync(r.movedFrom)) {
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
      console.log(`       — but the pre-move location is still on disk: ${r.movedFrom}`);
      console.log('       a stalled or unstarted move, not a clean checkout. Finish the move, then re-run.');
      failures++;
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
