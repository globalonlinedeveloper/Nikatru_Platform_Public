#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-workflow-hardening.mjs — CI's own inputs are pinned and least-privilege.
//
// `@v4` is a LABEL, not an address. The action's owner can re-point it at
// different code tomorrow and nothing in this repository changes. A 40-character
// SHA is content-addressed: it can only ever be that exact code.
//
// This is not theoretical. The tj-actions/changed-files compromise (March 2025)
// reached ~23,000 repositories by exactly this mechanism — a moved tag. Our
// `e2e.yml` runs nightly, unattended, holding SUPABASE_SERVICE_ROLE_KEY (full
// database access, bypasses RLS) and CLOUDFLARE_API_TOKEN, and it calls a
// third-party action maintained by an individual.
//
// Asserts two things:
//   1. every `uses:` resolves to a 40-hex commit SHA
//   2. every workflow declares an explicit `permissions:` block
//
// ⚠️ TRADE-OFF ON RECORD: a pinned action stops receiving updates, including
// security fixes. That is the deliberate exchange — "silently gets new code"
// for "must be updated deliberately". The thing that normally makes it
// sustainable is Renovate raising bump PRs, which is stage 14. Until that
// exists, these pins go stale; that is a known cost, not an oversight.
//
// Pipeline requirement: company/pipeline/01-foundation.md → F-11.
//
// Usage:  node tooling/ci/assert-workflow-hardening.mjs [repoRoot]
// Exit 0 = hardened, 1 = a movable reference or a missing permissions block.
// ─────────────────────────────────────────────────────────────────────────────
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = process.argv[2] ?? process.cwd();
const wfDir = join(repoRoot, '.github', 'workflows');

/** A scan that quietly matches nothing reports "clean" forever. */
const MIN_WORKFLOWS = 3;
const MIN_USES = 10;

if (!existsSync(wfDir)) {
  console.error(`✗ no .github/workflows under ${repoRoot}`);
  process.exit(1);
}

const files = readdirSync(wfDir).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'));

/** `uses:` referencing a repository action. Local (`./…`) and container
 *  (`docker://…`) forms are not tag-pinnable and are deliberately skipped.
 *
 *  ANCHORED TO LINE START ON PURPOSE — that anchor is what stops a commented-out
 *  step (`# - uses: actions/checkout@v4`) being reported as a live violation. An
 *  earlier draft also stripped `#…` from each line "for safety"; that was dead
 *  code, because the anchor already made it impossible to reach, and the test
 *  covering it could not fail. Removed rather than kept — by this repo's own
 *  rule, an assertion that cannot fail is worse than none. The comment case is
 *  still tested; it now exercises the anchor, which is the real protection. */
const USES = /^\s*-?\s*uses:\s*([A-Za-z0-9._-]+\/[A-Za-z0-9._/-]+)@([A-Za-z0-9._-]+)/;

const problems = [];
let usesCount = 0;

for (const f of files) {
  const text = readFileSync(join(wfDir, f), 'utf8');

  if (!/^permissions:/m.test(text)) {
    problems.push(`${f} declares no \`permissions:\` — every job runs at the repository-default scope`);
  }

  text.split('\n').forEach((line, i) => {
    const m = USES.exec(line);
    if (!m) return;
    usesCount++;
    const [, action, ref] = m;
    if (!/^[0-9a-f]{40}$/.test(ref)) {
      problems.push(`${f}:${i + 1} \`${action}@${ref}\` is a movable reference — pin it to a 40-char commit SHA`);
    }
  });
}

// ── coverage self-check, BEFORE reporting clean ──────────────────────────────
if (files.length < MIN_WORKFLOWS || usesCount < MIN_USES) {
  console.error(
    `✗ COVERAGE LOST — scanned ${files.length} workflow(s) and ${usesCount} \`uses:\` reference(s);` +
      ` expected at least ${MIN_WORKFLOWS} and ${MIN_USES}.`,
  );
  console.error('  The scan is broken, not the tree.');
  process.exit(1);
}

if (problems.length) {
  console.error(`✗ ${problems.length} workflow hardening problem(s):`);
  for (const p of problems) console.error(`    ${p}`);
  process.exit(1);
}

console.log(
  `ok  workflow hardening — ${files.length} workflow(s), ${usesCount} action(s) all SHA-pinned, all declare permissions`,
);
