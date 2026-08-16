#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-version-consistency.mjs — one declaration, and nothing may disagree.
//
// The Flutter version was written in SIX places and `node-version: 24` in EIGHT,
// across five workflows and a shell script whose comment read "keep in lockstep
// with *.yml" — a maintenance instruction addressed to a human. Bump one, miss
// another, and that lane silently builds on a different SDK while the code looks
// identical.
//
// `mason_cli` was pinned NOWHERE. Mason is what stamps apps, so an unpinned
// mason means the factory's product could differ run to run with nothing in the
// repo to explain it.
//
// GitHub Actions cannot interpolate a file into `with:`, so the values are still
// written at each call site. What this guard removes is the SILENT miss.
//
// Pipeline requirement: Private/requirements/ → F-2.
// (Stage 1's prose, pipeline/01-foundation.md, was folded into that JSON spec
// 2026-08-15; the id still resolves against an `origin` field there.)
//
// Usage:  node tooling/ci/assert-version-consistency.mjs [repoRoot]
// Exit 0 = every literal matches tooling/versions.json, 1 = drift.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { listDir } from './tree-walk.mjs';

const repoRoot = process.argv[2] ?? process.cwd();
const declPath = join(repoRoot, 'tooling', 'versions.json');

if (!existsSync(declPath)) {
  console.error(`✗ no tooling/versions.json under ${repoRoot} — nothing to check against`);
  process.exit(1);
}
const decl = JSON.parse(readFileSync(declPath, 'utf8'));

/** Each rule finds every occurrence of a versioned thing and reports the value
 *  it names, so the guard compares PARSED values rather than grepping for the
 *  expected string. Grepping for the right answer can only ever find sites that
 *  are already correct — it can never see the one that drifted. */
const RULES = [
  { key: 'flutter', label: 'Flutter', re: /flutter-version:\s*'?([0-9][^\s'"#]*)'?/g },
  { key: 'flutter', label: 'Flutter', re: /FLUTTER_VERSION[:=]\s*'?"?([0-9][^\s'"#]*)'?"?/g },
  { key: 'node', label: 'Node', re: /node-version:\s*'?([0-9][^\s'"#]*)'?/g },
  { key: 'java', label: 'Java', re: /java-version:\s*'?([0-9][^\s'"#]*)'?/g },
  { key: 'melos', label: 'Melos', re: /dart pub global activate melos\s+([0-9][^\s'"#]*)/g },
  { key: 'mason_cli', label: 'mason_cli', re: /dart pub global activate mason_cli\s*([^\s'"#]*)/g },
  // Runner images. A `-latest` label is a moving target in exactly the way a
  // floating action tag is: macos-latest rolling to a new Xcode changes what an
  // identical commit builds, with no diff in the repo. Matched per-OS so the
  // error can name the expected label rather than just "not pinned".
  { key: 'wrangler', label: 'Wrangler', re: /wranglerVersion:\s*'?([0-9][^\s'"#]*)'?/g },
  // A dependency SPEC, not a workflow input. 🔴 THE WHOLE STRING is captured —
  // review 2026-07-31 (mutation-proven): the first version put `\^?` OUTSIDE
  // the capture, so `"^4.114.0"` captured `4.114.0`, equalled the declared pin
  // and PASSED — a caret wrapping the current version floated silently, which
  // is the exact PR #79 incident reproduced green, while the comment here
  // claimed the opposite. Now any range operator makes the captured string
  // unequal to the exact pin and fails.
  { key: 'wrangler', label: 'Wrangler (brick dep)', re: /"wrangler":\s*"([^"]+)"/g },
  { key: 'runner_ubuntu', label: 'Ubuntu runner', re: /runs-on:\s*(ubuntu-[^\s'"#]+)/g },
  { key: 'runner_windows', label: 'Windows runner', re: /runs-on:\s*(windows-[^\s'"#]+)/g },
  { key: 'runner_macos', label: 'macOS runner', re: /runs-on:\s*(macos-[^\s'"#]+)/g },
];

/** Files that may name a build version. */
const TARGETS = [];
const wfDir = join(repoRoot, '.github', 'workflows');
if (existsSync(wfDir)) {
  for (const f of listDir(wfDir).filter((x) => x.endsWith('.yml') || x.endsWith('.yaml'))) {
    TARGETS.push(join('.github', 'workflows', f));
  }
}
for (const f of ['tooling/wsl-setup.sh']) {
  if (existsSync(join(repoRoot, f))) TARGETS.push(f);
}
// 🔴 THE BRICK'S STAMPED SERVICE, added 2026-07-31 after it took `main` red.
// Every real service here has a COMMITTED package-lock.json and is therefore
// immune to a bad upstream release. A STAMPED service has none by construction —
// it is generated in CI and `npm install`s fresh every run — so its `^4.0.0`
// floated onto wrangler 4.117.0, which depends on `miniflare@5.20260730.0-alpha`,
// and the install died with `notarget`. The repo pinned wrangler everywhere the
// guard looked and nowhere the factory's own product looked.
// Pinning it EXACTLY (no caret) is the point: a stamped app must resolve the same
// way tomorrow, and this rule is what stops the caret coming back.
// 🔴 The path is REQUIRED, never existsSync-gated — triage 2026-07-31
// (mutation-proven): the first version pushed this target only `if (existsSync)`,
// so renaming one brick directory segment silently deleted the rule's ONLY
// target while a live `^9.9.9` drift sat on disk — and MIN_OCCURRENCES is a
// GLOBAL floor the workflows' 41 other matches satisfy alone, so the guard
// printed "ok". A scan whose target vanished must say so, not shrink.
const BRICK_PKG = 'tooling/bricks/app/__brick__/{{#needs_backend}}services{{/needs_backend}}/{{app_id}}-api/package.json';
if (!existsSync(join(repoRoot, BRICK_PKG))) {
  console.error(`✗ COVERAGE LOST — the brick's stamped-service package.json is gone from ${BRICK_PKG}.`);
  console.error('  The "Wrangler (brick dep)" rule now scans NOTHING, and the global MIN_OCCURRENCES floor');
  console.error('  is satisfied by the workflows alone — the caret this rule exists to block would come back');
  console.error('  unseen. If the brick moved, update this path in the same change.');
  process.exit(1);
}
TARGETS.push(BRICK_PKG);

/** A scan that quietly matches nothing reports "clean" forever. */
const MIN_OCCURRENCES = 10;

const problems = [];
let found = 0;

for (const rel of TARGETS) {
  const text = readFileSync(join(repoRoot, rel), 'utf8');
  text.split('\n').forEach((line, i) => {
    const code = line.replace(/#.*$/, '');
    for (const rule of RULES) {
      rule.re.lastIndex = 0;
      let m;
      while ((m = rule.re.exec(code)) !== null) {
        found++;
        const actual = (m[1] ?? '').trim();
        const expected = String(decl[rule.key] ?? '');
        if (actual === '') {
          problems.push(
            `${rel}:${i + 1} ${rule.label} is UNPINNED — it takes whatever is newest on every run` +
              ` (declare ${expected})`,
          );
        } else if (actual !== expected) {
          problems.push(`${rel}:${i + 1} ${rule.label} is "${actual}" but versions.json declares "${expected}"`);
        }
      }
    }
  });
}

// ── REQUIRED COVERAGE: a rule that matches nothing is not "clean" ────────────
// MIN_OCCURRENCES is a GLOBAL total, so a single rule silently matching zero
// stays invisible behind the other rules' matches. That matters most here:
// deleting the `wranglerVersion:` line does not produce an unpinned literal for
// the loop above to catch — it produces NO literal, and the deploy quietly falls
// back to the version compiled into cloudflare/wrangler-action's own bundle.
// That is exactly how production ended up on 3.90.0 while the repo used 4.114.0.
for (const rel of TARGETS) {
  const text = readFileSync(join(repoRoot, rel), 'utf8');
  const code = text.replace(/^\s*#.*$/gm, '');
  if (!/uses:\s*cloudflare\/wrangler-action/.test(code)) continue;
  if (!/wranglerVersion:/.test(code)) {
    problems.push(
      `${rel} uses cloudflare/wrangler-action WITHOUT a wranglerVersion: — the action will install ` +
        `whatever version is hardcoded in its own bundle, not the ${decl.wrangler} this repo declares. ` +
        'An unpinned deploy tool holds the account API token and writes to production.',
    );
  }
}

// ── coverage self-check, BEFORE reporting clean ──────────────────────────────
if (found < MIN_OCCURRENCES) {
  console.error(
    `✗ COVERAGE LOST — matched ${found} version reference(s), expected at least ${MIN_OCCURRENCES}.`,
  );
  console.error('  The scan is broken, not the tree.');
  process.exit(1);
}

if (problems.length) {
  console.error(`✗ ${problems.length} version drift problem(s):`);
  for (const p of problems) console.error(`    ${p}`);
  console.error('  Fix the call site, or change tooling/versions.json if the new value is intended.');
  process.exit(1);
}

console.log(`ok  version consistency — ${found} reference(s) across ${TARGETS.length} file(s), all match versions.json`);
