#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-deploy-triggers.mjs — a path-filtered deploy must list every input that
// changes what it ships.
//
// 🔴 THE FAILURE IS A DEPLOY THAT DOES NOT HAPPEN, and nothing anywhere goes
// red. deploy-web.yml's `paths:` named `apps/subly/**` and `packages/**` — the
// SOURCE — and stopped there (2026-08-01 full-corpus review, #30). Its build
// step is `flutter pub get --enforce-lockfile` inside a Melos 8 workspace, so
// the root `pubspec.yaml` (the `workspace:` list) and the single root
// `pubspec.lock` decide every dependency version that reaches build/web. A
// dependency bump — a transitive security patch landing in the lockfile with no
// source change at all — therefore produced a green main commit that builds
// differently and deploys nothing. subly.nikatru.com keeps serving the old
// bytes, `record-deployment.mjs` is never called so the deployment marker still
// names the previous SHA, and the only symptom is an absence.
//
// This is the F-9 shape one level in: assert-lane-coverage.mjs proves every
// deployable unit is CLAIMED by a lane. A claim is worth what the lane's trigger
// is worth, and a trigger that omits a build input is a claim over a lane that
// will not run.
//
// WHAT IT CHECKS. For every workflow that (a) builds Flutter and (b) filters its
// push trigger by path, the filter must reach:
//   · pubspec.yaml         — the workspace list: which packages resolve at all
//   · pubspec.lock         — the one resolved dependency set the build compiles
//   · tooling/versions.json — the single declaration this lane's pins are held
//                             to [pipeline F-2]
//   · its own file          — or editing the build steps deploys nothing
//   · every tooling/ci/*.mjs script the lane RUNS — DERIVED from the workflow
//     text rather than hand-listed, so it extends itself when a step is added.
//     This is not bookkeeping: deploy-web.yml runs assert-app-versioning.mjs
//     --emit and bakes its output into --build-name AND the APP_VERSION define
//     that stamps every analytics row and consent artifact. Editing that script
//     changes what ships. (Same technique assert-guard-coverage.mjs already uses
//     to hold ci.yml's invocation list to the guard set.)
//
// ⚠️ COMMENTS ARE NOT CLAIMS, and this guard was written knowing its own subject
// carries a prose block naming all three files. The scan strips comments before
// looking, so the explanation above a `paths:` list can never satisfy the check
// it explains — the same lesson assert-lane-coverage.mjs and check-site-
// integrity.mjs each learned the hard way. `!`-negations and `paths-ignore:` are
// honoured in the other direction: a required file EXCLUDED is not covered.
//
// SCOPE, stated rather than implied: TS/Worker lanes are not checked, because a
// Worker's dependency inputs (`services/<x>/package.json`, its lockfile) live
// inside the directory its filter already names. Flutter is the odd one out
// precisely because the workspace resolves from the repository ROOT.
//
// LANE-BOUND: deploy-web.yml — but ONLY as a REQUIRED_COVERAGE floor, not as the subject set. The scan
// grades every path-filtered workflow that builds a Flutter artifact; naming this one is what stops the
// grade being computed over an empty set when the lane is renamed or its trigger restructured, which is
// the failure this repo has hit more often than a broken check. A second path-filtered Flutter deploy is
// graded automatically the day it lands and needs no edit here. [pipeline 9]R-1 limb B.
//
// Usage:  node tooling/ci/assert-deploy-triggers.mjs [repoRoot]
// Exit 0 = every path-filtered Flutter deploy lane lists its real inputs.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { listDir } from './tree-walk.mjs';

const ROOT = resolve(process.argv[2] ?? process.cwd());
const WF_DIR = join(ROOT, '.github', 'workflows');
const scanningRealRepo = process.argv[2] === undefined;

/** The repository-root inputs a Flutter build resolves from, with the reason
 *  each one is load-bearing. The reason is not decoration: it is what a future
 *  reader needs in order to decide whether an entry still belongs. */
const REQUIRED = [
  ['pubspec.yaml', 'the Melos 8 `workspace:` list — which packages resolve at all'],
  ['pubspec.lock', 'the single resolved dependency set every member compiles against'],
  // ⚠️ WEAKER THAN THE OTHER TWO, said plainly. Today every value this lane
  // takes from versions.json (the Flutter and wrangler pins) is ALSO written as
  // a literal in the workflow, which is already in the filter and which
  // assert-version-consistency.mjs forces to move in lockstep — so on the
  // current tree a versions.json edit cannot reach the artifact alone. It is
  // required anyway because that coupling is a property of today's steps, not
  // of the declaration: the first value consumed without a local literal would
  // otherwise change the build silently. Belt and braces, on the record as such.
  ['tooling/versions.json', 'the one declaration this lane\'s SDK/tool pins are held to [pipeline F-2]'],
];

/** Scripts the lane executes, pulled out of its own text. */
const invokedScripts = (text) =>
  [...new Set([...text.matchAll(/tooling\/ci\/([A-Za-z0-9._-]+\.mjs)/g)].map((m) => `tooling/ci/${m[1]}`))];

/** Lanes that must still be graded. A guard whose subject was renamed or
 *  restructured out of scope reports "ok" over an empty set, and this repo has
 *  been caught by that more than by any broken check. */
const REQUIRED_COVERAGE = ['deploy-web.yml'];

if (!existsSync(WF_DIR)) {
  console.error(`✗ COVERAGE LOST — no .github/workflows under ${ROOT}, so this scan read nothing.`);
  process.exit(1);
}

/** Strip YAML comments. A `#` that starts a line or follows whitespace begins a
 *  comment; anything else (a fragment in a URL, say) is left alone. */
const stripComments = (raw) =>
  raw
    .split('\n')
    .map((l) => l.replace(/(^|\s)#.*$/, '$1'))
    .join('\n');

/** The line range [lo,hi) of the block under `key:`, searched at the shallowest
 *  indentation present in `range` — i.e. this descends one YAML level. */
function descend(lines, [lo, hi], key) {
  let base = Infinity;
  for (let i = lo; i < hi; i++) {
    if (lines[i].trim() === '') continue;
    base = Math.min(base, lines[i].match(/^\s*/)[0].length);
  }
  if (base === Infinity) return null;
  const re = new RegExp(`^\\s{${base}}(['"]?)${key}\\1\\s*:`);
  for (let i = lo; i < hi; i++) {
    if (!re.test(lines[i])) continue;
    let j = i + 1;
    for (; j < hi; j++) {
      if (lines[j].trim() === '') continue;
      if (lines[j].match(/^\s*/)[0].length <= base) break;
    }
    return [i + 1, j];
  }
  return null;
}

/** The `- item` entries in a range, unquoted. */
function items(lines, range) {
  if (!range) return [];
  const out = [];
  for (let i = range[0]; i < range[1]; i++) {
    const m = lines[i].match(/^\s*-\s*(.+?)\s*$/);
    if (m) out.push(m[1].replace(/^['"]|['"]$/g, ''));
  }
  return out;
}

/** GitHub path-filter glob → RegExp. `**` crosses `/`, `*` does not. */
function globToRe(pattern) {
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        re += '.*';
        i++;
        if (pattern[i + 1] === '/') i++; // `a/**/b` also matches `a/b`
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

const matches = (pattern, file) => globToRe(pattern).test(file);

/** Is `file` reached by this filter? Later `!`-negations win, as GitHub does. */
function covers(paths, file) {
  let hit = false;
  for (const p of paths) {
    if (p.startsWith('!')) {
      if (matches(p.slice(1), file)) hit = false;
    } else if (matches(p, file)) hit = true;
  }
  return hit;
}

const files = listDir(WF_DIR).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'));
const problems = [];
const graded = [];
let checks = 0;

for (const name of files) {
  const text = stripComments(readFileSync(join(WF_DIR, name), 'utf8'));
  const lines = text.split('\n');

  // Only lanes that actually resolve the Dart workspace are in scope.
  if (!/flutter\s+(build|pub\s+get)/.test(text)) continue;

  const on = descend(lines, [0, lines.length], 'on');
  if (!on) continue;
  const push = descend(lines, on, 'push');
  if (!push) continue;

  const paths = items(lines, descend(lines, push, 'paths'));
  const ignored = items(lines, descend(lines, push, 'paths-ignore'));

  // 🔴 A FILTER THE PARSER CANNOT READ MUST BE LOUD, NOT SKIPPED. `paths:` in
  // YAML flow style (`paths: ['a/**']`) yields zero entries from items(), which
  // is indistinguishable from "no filter" — so a second lane written that way
  // would drop out of scope while this still printed ok over the first.
  if (/^\s*(['"]?)paths(-ignore)?\1\s*:/m.test(lines.slice(push[0], push[1]).join('\n'))
      && paths.length === 0 && ignored.length === 0) {
    console.error(`✗ COVERAGE LOST — ${name} declares a push path filter this scan parsed as EMPTY.`);
    console.error('  Only block-style `- entry` lists are understood. An unparsed filter reads exactly');
    console.error('  like an unfiltered lane, which is the one thing this guard must never assume.');
    process.exit(1);
  }
  // No filter at all = runs on every push. Nothing to under-reach.
  if (paths.length === 0 && ignored.length === 0) continue;

  graded.push(name);
  const required = [
    ...REQUIRED,
    [`.github/workflows/${name}`, 'the lane\'s own definition — its build steps and pins'],
    ...invokedScripts(text).map((s) => [
      s,
      'a script this lane RUNS — it decides whether the deploy proceeds, what version it '
        + 'stamps, or what it records, none of which is visible in the source tree it filters on',
    ]),
  ];
  for (const [file, why] of required) {
    checks++;
    const reached =
      paths.length > 0 ? covers(paths, file) : !ignored.some((p) => matches(p, file));
    if (!reached) {
      problems.push(`${name} — the push filter never reaches \`${file}\`: ${why}.`);
    }
  }
}

// ── coverage self-check, BEFORE reporting clean ──────────────────────────────
if (graded.length === 0) {
  console.error(`✗ COVERAGE LOST — no path-filtered Flutter deploy lane found under ${WF_DIR}.`);
  console.error('  This guard graded nothing. Either the lane was renamed/retired and this scan');
  console.error('  was not taught, or the trigger shape changed out from under the parser.');
  process.exit(1);
}
// Deliberately NOT gated on scanningRealRepo: a self-check that cannot fire
// against a fixture is a self-check with no recorded failing case.
{
  const dropped = REQUIRED_COVERAGE.filter((n) => !graded.includes(n));
  if (dropped.length) {
    console.error(`✗ COVERAGE LOST — named lane(s) no longer graded: ${dropped.join(', ')}`);
    console.error('  They are the reason this guard exists. Point REQUIRED_COVERAGE at their new');
    console.error('  names in the same change that renames them — never delete the entry.');
    process.exit(1);
  }
}
// The comparison is only meaningful against files that exist. On a fixture root
// they legitimately do not, so this applies to the real repository.
if (scanningRealRepo) {
  const missing = REQUIRED.map(([f]) => f).filter((f) => !existsSync(join(ROOT, f)));
  if (missing.length) {
    console.error(`✗ COVERAGE LOST — required input(s) do not exist at ${ROOT}: ${missing.join(', ')}`);
    console.error('  A trigger checked against a phantom file passes for the wrong reason.');
    process.exit(1);
  }
}

if (problems.length) {
  console.error(`✗ deploy triggers — ${problems.length} unlisted build input(s):`);
  for (const p of problems) console.error(`    ${p}`);
  console.error('');
  console.error('  A build input outside the filter means a commit that changes what gets built');
  console.error('  deploys NOTHING, with every check green and no error anywhere. Add the path.');
  process.exit(1);
}

console.log(
  `ok  deploy triggers — ${graded.length} path-filtered Flutter lane(s) (${graded.join(', ')}), ` +
    `${checks} build input(s) all reachable`,
);
