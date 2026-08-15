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

/* 🔴 THREE GUARDS WERE REMOVED FROM THIS ARRAY ON 2026-08-15, NOT LEFT TO FAIL.
   `assert-status-honest`, `assert-req-ids` and `assert-enforcers-exist` all read
   `Private/company/pipeline/` — 384,000 words of prose that the JSON spec under
   `Private/spec/` replaced and that the same commit deleted. Their entries
   are gone rather than red because a permanently red guard trains people to pass
   `--no-verify`, and a hook that is routinely bypassed is worth less than no hook:
   it also carries the belief that something was checked.

   Where each property went (full reasoning: Private/spec/staging/RETIREMENT-PLAN.md,
   and the four files themselves are readable in Private/company/tooling/retired/):
     assert-status-honest   → assert-spec limbs 4 + 6. The markdown format kept a
                              status in three places that could disagree; the JSON
                              format has no status on an invariant at all, and limb
                              4 is the ratchet that stops one being re-added.
     assert-req-ids         → assert-spec limb 9. Its citation half could not be
                              repointed — after the deletion every `origin` cites a
                              file that is gone — so the declarations were frozen
                              into spec/staging/00-ORIGINS.lock.json FIRST, and limb
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
  { name: 'check-dod-sync', speed: 'fast',
    rel: ['tooling/scripts/check-dod-sync.mjs'],
    what: 'the DoD page, the register and MASTER_PLAN §4 agree' },
  { name: 'assert-spec', speed: 'fast',
    rel: ['Private/spec/tooling/assert-spec.mjs', 'tooling/assert-spec.mjs'],
    what: 'the JSON spec is schema-valid, id-unique, origin-locked, and every enforcer it names exists' },
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
