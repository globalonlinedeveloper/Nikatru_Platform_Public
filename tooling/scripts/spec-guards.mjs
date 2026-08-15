#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// spec-guards.mjs — run the spec-integrity guards, from a git hook or by hand.
//
// WHY THIS EXISTS. The spec lives under `Private/`, which is gitignored, so no CI
// job can read it. Its four guards were therefore run by a human who remembered
// SESSION_BOOTSTRAP step 7 — which is to say the corpus's own integrity was the
// one thing in this repo that was NOT a build-failing assertion, in a house whose
// stated doctrine is that a preventable mistake becomes a guard rather than a
// note. Decision 2026-08-15: a LOCAL HOOK is the enforcement surface, because it
// is free, instant, and needs nothing to be published. A private-repo CI run is
// the intended backstop LATER, once the spec has been standardised.
//
// TWO SPEEDS, AND THE SPLIT IS MEASURED, NOT GUESSED:
//   assert-status-honest    271 ms
//   assert-req-ids          273 ms
//   check-dod-sync          252 ms   →  --fast total ≈ 0.8 s   (pre-commit)
//   assert-enforcers-exist 10854 ms  →  --full adds this       (pre-push)
// 🔴 The split is the whole design. This corpus already recorded that "a blocking
// 10-minute hook gets bypassed within a week", and the same instinct kills an
// 11-second pre-commit. A guard that is skipped is worth less than no guard,
// because it also carries the belief that something was checked.
//
// EXIT CODES:  0 = every guard run passed · 1 = a guard reported a finding
//              2 = could not run (a guard is missing, or node cannot reach it)
//
// Usage:  node tooling/scripts/spec-guards.mjs --fast
//         node tooling/scripts/spec-guards.mjs --full
//         node tooling/scripts/spec-guards.mjs --full --verbose
// ─────────────────────────────────────────────────────────────────────────────
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');          // tooling/scripts -> repo root

const argv = process.argv.slice(2);
const FULL = argv.includes('--full');
const VERBOSE = argv.includes('--verbose');

/* The guards live in two trees and this script may be invoked from EITHER — the
   public repo's hook, or Private/company/'s own hook, whose repo root is a
   different directory entirely. So each guard is resolved by trying both
   locations rather than by assuming one. A hook that silently finds no guards
   would report success over an empty set, which is precisely the defect class
   this whole session has been closing. */
const CANDIDATE_ROOTS = [
  REPO,                                  // invoked from the public repo
  resolve(REPO, '..', '..'),             // invoked from Private/company (…/Private/company -> repo)
  resolve(REPO, '..'),                   // one level, for safety
];

function locate(...relCandidates) {
  for (const root of CANDIDATE_ROOTS) {
    for (const rel of relCandidates) {
      const p = join(root, rel);
      if (existsSync(p)) return p;
    }
  }
  return null;
}

const GUARDS = [
  { name: 'assert-status-honest', speed: 'fast',
    rel: ['Private/company/tooling/assert-status-honest.mjs', 'tooling/assert-status-honest.mjs'],
    what: 'each requirement’s status agrees with itself in all three places' },
  { name: 'assert-req-ids', speed: 'fast',
    rel: ['Private/company/tooling/assert-req-ids.mjs', 'tooling/assert-req-ids.mjs'],
    what: 'every stage-qualified citation resolves' },
  { name: 'check-dod-sync', speed: 'fast',
    rel: ['tooling/scripts/check-dod-sync.mjs'],
    what: 'the DoD page, the register and MASTER_PLAN §4 agree' },
  { name: 'assert-enforcers-exist', speed: 'slow',
    rel: ['Private/company/tooling/assert-enforcers-exist.mjs', 'tooling/assert-enforcers-exist.mjs'],
    what: 'every “Enforced by” names something that exists' },
];

const selected = GUARDS.filter((g) => FULL || g.speed === 'fast');

/* 🔴 COVERAGE FLOOR. A hook that resolves zero guards and prints "ok" is the
   vacuous pass this corpus keeps finding. Refuse instead. */
const resolved = selected.map((g) => ({ ...g, path: locate(...g.rel) }));
const missing = resolved.filter((g) => !g.path);
if (missing.length) {
  console.error(`\n  CANNOT RUN — ${missing.length} of ${selected.length} spec guard(s) not found:`);
  for (const m of missing) console.error(`    ${m.name}   looked for: ${m.rel.join(' , ')}`);
  console.error('  A hook that cannot find its guards has checked nothing. Refusing rather than passing.\n');
  process.exit(2);
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
