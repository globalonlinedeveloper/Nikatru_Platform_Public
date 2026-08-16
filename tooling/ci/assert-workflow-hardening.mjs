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
// Asserts three things:
//   1. every `uses:` resolves to a 40-hex commit SHA
//   2. every workflow declares an explicit `permissions:` block
//   3. …and that block is not `write-all`. Until 2026-08-01 limb 2 was
//      PRESENCE-ONLY — `/^permissions:/m` — while ci.yml's own step name claimed
//      "SHA-pinned and least-privilege". `permissions: write-all` satisfied a
//      presence test perfectly, so the strictly worst possible block passed the
//      check named after the property it violates. Corpus triage 2026-08-01
//      (#29); mutation-proven on ci.yml before the fix and after it.
//
// ⚠️ TRADE-OFF ON RECORD: a pinned action stops receiving updates, including
// security fixes. That is the deliberate exchange — "silently gets new code"
// for "must be updated deliberately". The thing that normally makes it
// sustainable is Renovate raising bump PRs, which is stage 14. Until that
// exists, these pins go stale; that is a known cost, not an oversight.
//
// Pipeline requirement: Private/requirements/ → F-11.
// (Stage 1's prose, pipeline/01-foundation.md, was folded into that JSON spec
// 2026-08-15; the id still resolves against an `origin` field there.)
//
// Usage:  node tooling/ci/assert-workflow-hardening.mjs [repoRoot]
// Exit 0 = hardened, 1 = a movable reference or a missing permissions block.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { listDir } from './tree-walk.mjs';

const repoRoot = process.argv[2] ?? process.cwd();
/** No argument means CI's own invocation — the real repository, where the git
 *  manifest below MUST be readable. A caller pointing this at a fixture root is
 *  a different, weaker situation and says so out loud. */
const scanningRealRepo = process.argv[2] === undefined;
const wfDir = join(repoRoot, '.github', 'workflows');

/** ⚠️ A FLOOR OF LAST RESORT, and deliberately NOT the thing that protects the
 *  real repository.
 *
 *  🔴 It used to be `MIN_WORKFLOWS = 3` / `MIN_USES = 10` against a tree of NINE
 *  workflows and FIFTY-SEVEN `uses:` references. Corpus triage 2026-08-01 (#29)
 *  moved six of the nine workflows aside — every deploy and every store
 *  submission — and this guard printed `ok  workflow hardening — 3 workflow(s),
 *  30 action(s) all SHA-pinned` and exited 0. Two thirds of CI's attack surface
 *  left the scan without a word, which is the same "coverage silently subtracts"
 *  shape as the 15/4/140 guard-coverage floors and the wrangler floor of 5.
 *
 *  Re-pinning at 9/57 would be the wrong repair: a floor AT reality goes red on
 *  the next honest merge and teaches people to raise floors reflexively. So the
 *  real repository is anchored by two RELATIONSHIPS instead, both computed from
 *  the tree on every run and therefore incapable of going stale:
 *
 *    · SCAN vs MANIFEST — every workflow file `git ls-files` tracks must be one
 *      this scan opened. Directly answers "did my scan reach the tree", which is
 *      the only question a count was ever standing in for.
 *    · USES ACCOUNTING — every `uses:` line found by a loose, independent
 *      matcher must be accounted for by the strict one below. If USES ever stops
 *      matching, the two disagree and this fails, instead of `usesCount` quietly
 *      falling to zero and every action reading as pinned.
 *
 *  This number survives only for roots with no git manifest (the test fixtures),
 *  where neither relationship can be computed. It is a fallback, not the guard. */
const MIN_WORKFLOWS_WITHOUT_MANIFEST = 3;

if (!existsSync(wfDir)) {
  console.error(`✗ no .github/workflows under ${repoRoot}`);
  process.exit(1);
}

const files = listDir(wfDir).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'));

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

/** THE LOOSE COUNTERPART, and it exists only to disagree with USES. Deliberately
 *  written a different way — no anchor, no shape for the value — so the two
 *  cannot break together. Every `uses:` this sees must end up in exactly one of
 *  the three accounted buckets; anything left over means the strict matcher has
 *  stopped matching something that is really there. */
const ANY_USES = /^\s*-?\s*uses:\s*(\S+)/;
/** Deliberately tolerant of `uses : x` (YAML-legal, and GitHub accepts it) and
 *  of a `uses:` whose value is on the next line — the two shapes ANY_USES cannot
 *  read. Still key-shaped, so prose inside a `run:` block is not miscounted. */
const LOOSE_USES = /^\s*-?\s*uses\s*:/;
/** Local (`./…`) and container (`docker://…`) forms are not tag-pinnable. They
 *  are ACCOUNTED FOR rather than skipped — a skip is invisible, a bucket is not. */
const NOT_PINNABLE = /^(\.{1,2}[/\\]|docker:\/\/)/;

const problems = [];
const notes = [];
let usesCount = 0;
let notPinnable = 0;
let unparsedUses = 0;
let looseSeen = 0;

/** The workflow-level `permissions:` block: either `permissions: <value>` inline
 *  or a mapping of `scope: level` lines under it. Parsed, never grepped — a
 *  presence test is what let `write-all` through. */
function workflowPermissions(text) {
  const lines = text.split('\n');
  const at = lines.findIndex((l) => /^permissions:/.test(l));
  if (at === -1) return null;
  const inline = lines[at].slice('permissions:'.length).replace(/#.*$/, '').trim();
  if (inline !== '') return { inline, scopes: [] };
  const scopes = [];
  for (const l of lines.slice(at + 1)) {
    if (l.trim() === '' || /^\s*#/.test(l)) continue;
    const m = l.match(/^\s+([a-z-]+):\s*([a-z-]+)\s*(#.*)?$/);
    if (!m) break;
    scopes.push([m[1], m[2]]);
  }
  return { inline: null, scopes };
}

for (const f of files) {
  const text = readFileSync(join(wfDir, f), 'utf8');

  // ── limb 2: an explicit block, at the workflow level ──────────────────────
  const perms = workflowPermissions(text);
  if (perms === null) {
    problems.push(`${f} declares no \`permissions:\` — every job runs at the repository-default scope`);
  } else if (perms.inline !== null && perms.inline !== 'read-all' && perms.scopes.length === 0 && perms.inline !== '{}') {
    // an inline value: only `read-all` (and the empty map) are least-privilege.
    problems.push(
      `${f} sets \`permissions: ${perms.inline}\` at the workflow level. ` +
        'Anything other than `read-all`/`{}` handed to every job at once is the opposite of least-privilege, and this step is named after that property.',
    );
  } else {
    for (const [scope, level] of perms.scopes) {
      if (level === 'write') {
        notes.push(`${f} grants \`${scope}: write\` at the WORKFLOW level, so every job in it holds that token. Job-level \`permissions:\` is where a write scope belongs.`);
      }
    }
  }

  // ── limb 3: `write-all` blocks, at ANY level ──────────────────────────────
  // Job-level too: a job that grants itself write-all is exactly the blast
  // radius the workflow-level rule exists to stop, one indent further in.
  text.split('\n').forEach((line, i) => {
    if (/^\s*#/.test(line)) return;
    const m = line.match(/^\s*permissions:\s*write-all\b/);
    if (m) {
      problems.push(
        `${f}:${i + 1} \`permissions: write-all\` grants every scope — contents, packages, id-token, the lot — to code this repo does not own. ` +
          'This is the single worst value the key can take, and a presence-only check accepted it for months.',
      );
    }
  });

  text.split('\n').forEach((line, i) => {
    const nc = /^\s*#/.test(line) ? '' : line.replace(/\s#.*$/, '');
    if (LOOSE_USES.test(nc)) looseSeen++;
    const any = ANY_USES.exec(nc);
    if (!any) return;
    if (NOT_PINNABLE.test(any[1])) {
      notPinnable++;
      return;
    }
    const m = USES.exec(nc);
    if (!m) {
      unparsedUses++;
      problems.push(
        `${f}:${i + 1} \`uses: ${any[1]}\` is a reference this scan cannot parse, so it cannot be proven pinned. ` +
          'An unreadable reference is not a safe one — either it is a repository action (owner/name@ref) or this scan needs teaching.',
      );
      return;
    }
    usesCount++;
    const [, action, ref] = m;
    if (!/^[0-9a-f]{40}$/.test(ref)) {
      problems.push(`${f}:${i + 1} \`${action}@${ref}\` is a movable reference — pin it to a 40-char commit SHA`);
    }
  });
}

// ── coverage self-checks, BEFORE reporting clean ─────────────────────────────
const coverageLost = (lines) => {
  console.error(`✗ COVERAGE LOST — ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(`  ${l}`);
  process.exit(1);
};

// (1) SCAN vs MANIFEST. `git ls-files` is the committed truth about which
//     workflows exist; `files` is what this scan opened. They must agree.
const ls = spawnSync('git', ['-C', repoRoot, 'ls-files', '--', '.github/workflows'], { encoding: 'utf8' });
const tracked =
  ls.status === 0
    ? [...new Set(ls.stdout.split('\n').map((l) => l.trim()).filter((l) => /\.ya?ml$/.test(l)).map((l) => l.split('/').pop()))]
    : [];

if (tracked.length === 0) {
  // No manifest. On the real repository that is itself the failure — the whole
  // anchor is missing and only a fallback number would remain.
  if (scanningRealRepo) {
    coverageLost([
      `\`git ls-files -- .github/workflows\` returned no tracked workflow under ${repoRoot}.`,
      'The manifest that anchors this scan is unreadable, so "did I reach every workflow" cannot be',
      'answered at all — and the fallback floor is a number, which is what got us here.',
    ]);
  }
  if (files.length < MIN_WORKFLOWS_WITHOUT_MANIFEST) {
    coverageLost([
      `scanned ${files.length} workflow(s) under a root with no git manifest; the fallback floor is ${MIN_WORKFLOWS_WITHOUT_MANIFEST}.`,
      'The scan is broken, not the tree.',
    ]);
  }
} else {
  const unscanned = tracked.filter((t) => !files.includes(t));
  if (unscanned.length) {
    coverageLost([
      `git tracks ${tracked.length} workflow(s) and this scan opened ${files.length}; it never saw: ${unscanned.join(', ')}.`,
      'The scan and the committed tree have diverged — a filter that stopped matching, a directory that',
      'moved, or a checkout that did not happen. Every unseen workflow is unpinned and unscoped as far as',
      'this guard knows, and it would have printed ok over them.',
    ]);
  }
}

// (2) USES ACCOUNTING. Two independent matchers must agree on how many `uses:`
//     lines exist. This is what replaces `MIN_USES`: it fails when the strict
//     matcher under-reads, at ANY size of tree, rather than only below a number.
const accounted = usesCount + notPinnable + unparsedUses;
if (looseSeen !== accounted) {
  coverageLost([
    `${looseSeen} \`uses:\` line(s) are present but only ${accounted} were accounted for (${usesCount} pinnable, ${notPinnable} local/container, ${unparsedUses} unreadable).`,
    'The strict `uses:` matcher has stopped seeing references the loose one still finds, so some actions',
    'were never checked for a movable ref — and an unchecked action reads exactly like a pinned one.',
  ]);
}
if (looseSeen === 0) {
  coverageLost([
    `not one \`uses:\` reference in ${files.length} workflow(s).`,
    'A workflow set that calls no action at all means the matcher is dead, not that CI stopped using actions.',
  ]);
}

if (problems.length) {
  console.error(`✗ ${problems.length} workflow hardening problem(s):`);
  for (const p of problems) console.error(`    ${p}`);
  process.exit(1);
}

if (notes.length) {
  console.log('⬜ workflow-level write scopes (reported, not blocking — they are legitimate today):');
  for (const n of notes) console.log(`    ${n}`);
}
console.log(
  `ok  workflow hardening — ${files.length} workflow(s) (${tracked.length ? `all ${tracked.length} git tracks` : 'no git manifest'}), ` +
    `${usesCount} action(s) all SHA-pinned, every \`uses:\` accounted for, all declare permissions and none is write-all`,
);
