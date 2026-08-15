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
// Three repos need it, because three repos take commits:
//   ·  the public repo            (code, tooling, CI)
//   ·  Private/company/           (the spec itself — the guards' actual subject)
//   ·  Private/knowledge/         (ADRs and session notes that cite the spec)
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

const REPOS = [
  { name: 'public repo', path: REPO },
  { name: 'Private/company', path: join(REPO, 'Private', 'company') },
  { name: 'Private/knowledge', path: join(REPO, 'Private', 'knowledge') },
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
    console.log(`  --   ${r.name.padEnd(20)} no .git here — skipped`);
    continue;
  }
  // Each repo needs a path RELATIVE TO ITSELF, because Private/company/ is its
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
console.log(CHECK_ONLY ? '  every repo is pointed at .githooks/\n' : '  installed and verified in every repo.\n');
process.exit(0);
