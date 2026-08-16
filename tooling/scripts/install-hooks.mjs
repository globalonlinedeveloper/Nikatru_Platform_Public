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
//   ·  Private/                   (the spec, the ADRs and the session log — the
//                                  guards' actual subject; ONE repo since the
//                                  2026-08-15 flatten merged company/ + knowledge/)
// ⚠️ This header said THREE, naming `Private/company/` and `Private/knowledge/` (deleted
// 2026-08-15), for two days after the flatten — while the code below
// declared two and explained why. A comment cannot go red, so the code was right
// and the paragraph a reader starts from was wrong. Corrected 2026-08-17.
//
// `Private/` is gitignored, so it is absent from every public clone and every
// agent worktree. That is NOT a failure — see the three-state branch below.
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
const REPOS = [
  { name: 'public repo', path: REPO, expected: true },
  { name: 'Private', path: join(REPO, 'Private'), expected: true },
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
       print n/a and exit 0; moving `Private/.git` out of the way — tree present,
       repo gone — still prints RED and exits 1. (Said in prose rather than as a second `mv` with its destination spelled out: `assert-public-citations` reads every `Private/…` in the tree as a citation, and an example's invented destination is indistinguishable from a real one.) */
    if (r.expected && existsSync(r.path)) {
      console.log(`  RED  ${r.name.padEnd(20)} DIRECTORY IS HERE BUT HAS NO .git — not skipped, failed`);
      failures++;
    } else if (r.expected) {
      console.log(`  n/a  ${r.name.padEnd(20)} not in this checkout — gitignored, so absent from every clone`);
    } else {
      console.log(`  --   ${r.name.padEnd(20)} no .git here — skipped`);
    }
    continue;
  }
  // Each repo needs a path RELATIVE TO ITSELF, because Private/ is its
  // own repository whose root is not this one. An absolute path would work today
  // and break the moment the tree moves — which it did, this very session.
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
