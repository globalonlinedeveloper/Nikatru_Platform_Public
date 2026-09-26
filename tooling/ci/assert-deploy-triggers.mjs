#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-deploy-triggers.mjs — a Flutter deploy's unit must claim every input that
// changes what it ships.
//
// 🔴 THE FAILURE IS A DEPLOY THAT DOES NOT HAPPEN, and nothing anywhere goes
// red. deploy-web.yml's `paths:` named `apps/subscriptiontracker/**` and `packages/**` — the
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
// WHAT IT CHECKS [ADR 095 §4]. The deploy no longer decides on its own push
// trigger: ci.yml calls it after ci-gate, and its plan step publishes a unit only
// when a changed path matches that unit's globs in tooling/ci/lane-map.json
// `deployUnits`. The miss above is the same miss one list over, so for every
// workflow that (a) builds Flutter and (b) plans a unit
// (`plan-deploy.mjs <environment>`), the unit's globs must claim — by
// `globClaims`, the matcher the plan itself publishes on:
//   · pubspec.yaml         — the workspace list: which packages resolve at all
//   · pubspec.lock         — the one resolved dependency set the build compiles
//   · tooling/versions.json — the single declaration this lane's pins are held
//                             to [pipeline F-2]
//   · catalog/apps.json    — the address the build is compiled for [ADR 075]
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
// carries prose naming these files. The scan strips comments before looking, so
// an explanation in the workflow can never satisfy the check it explains, and a
// script or a plan named only in a comment is neither demanded nor graded — the
// same lesson assert-lane-coverage.mjs and check-site-integrity.mjs each learned
// the hard way. The unit is JSON, which carries no comments to mistake.
//
// SCOPE, stated rather than implied: TS/Worker lanes are not checked, because a
// Worker's dependency inputs (`services/<x>/package.json`, its lockfile) live
// inside the directory its unit already names. Flutter is the odd one out
// precisely because the workspace resolves from the repository ROOT.
//
// ⏱ 2026-09-25 · O-DEPLOY-TRIGGERS-MISS-IMPORTED-MODULES — AND WHAT THOSE
// SCRIPTS PULL IN. A script in the unit is a promise about one file; the
// modules it imports change what the lane runs just as much. deploy-web.yml
// listed tooling/ops/create-glitchtip-release.mjs and not the bounded retry it
// imports. So the "script this lane RUNS" read above now takes any
// `tooling/**` .mjs or .json the lane text names, and an IMPORT LIMB runs over
// EVERY workflow that plans a deploy unit (deploy-web.yml and
// deploy-workers.yml, REQUIRED_IMPORT_COVERAGE): it expands the `tooling/`
// entries of the units it plans against the tree and walks each listed .mjs, following
//   · static relative imports, transitively, through
//     assert-deploy-triggers-deploy.mjs's `relativeSpecifiersOf` and
//     `resolveSpecifier` (one specifier reading, not a third);
//   · a `'tooling/….json'` string literal on a code line;
//   · `join(HERE, '<seg>', …, '<x>.json')`, resolved from the module.
// Each reached `tooling/**` file the unit does not claim is refused, naming
// the file and the module that reads it. A read OUTSIDE tooling/** is out of
// scope — counted in the ok line, never graded. Reads by any other shape (a
// computed path, a `require` of a variable) are not seen. deploy-workers.yml is
// graded on the tooling files its units LIST; the scripts it only RUNS are not held
// to its units here. On the real repo a listed tooling file that does not
// exist, zero reads followed, or a REQUIRED_IMPORT_COVERAGE workflow not graded
// is COVERAGE LOST.
//
// LANE-BOUND: deploy-web.yml — but ONLY as a REQUIRED_COVERAGE floor, not as the subject set. The scan
// grades every workflow that builds a Flutter artifact and plans a deploy unit; naming this one is what
// stops the grade being computed over an empty set when the lane is renamed or its plan restructured,
// which is the failure this repo has hit more often than a broken check. A second Flutter deploy is
// graded automatically the day it plans a unit and needs no edit here. [pipeline 9]R-1 limb B.
//
// Usage:  node tooling/ci/assert-deploy-triggers.mjs [repoRoot]
// Exit 0 = every Flutter deploy's unit claims its real inputs, and every planned
// unit claims what its listed tooling modules read.  Exit 1 = a finding.
// Exit 2 = COVERAGE LOST: the units or the lanes could not be read.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, posix } from 'node:path';
import { listDir } from './tree-walk.mjs';
import {
  UNITS_REL, readUnits, plannedEnvironments, unitKeyFor, globClaims,
  relativeSpecifiersOf, resolveSpecifier, bundledFilesUnder, claimedTree,
} from './assert-deploy-triggers-deploy.mjs';
import { parseWorkflow, flutterBuilds } from './workflow-scan.mjs';

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
  // a literal in the workflow, which is already in the unit and which
  // assert-version-consistency.mjs forces to move in lockstep — so on the
  // current tree a versions.json edit cannot reach the artifact alone. It is
  // required anyway because that coupling is a property of today's steps, not
  // of the declaration: the first value consumed without a local literal would
  // otherwise change the build silently. Belt and braces, on the record as such.
  ['tooling/versions.json', 'the one declaration this lane\'s SDK/tool pins are held to [pipeline F-2]'],
  // 🔴 ADDED 2026-09-09 [ADR 075], AND IT IS NOT BELT AND BRACES. Since the app's
  // public address became a path on the apex, this lane resolves `--base-href`
  // from `catalog/apps.json` (`assert-catalog-reachable.mjs --emit-base-href`),
  // and the catalogue is where a RENAME lands: `apps/<id>/app.yaml` renders the
  // row, and the row is what says the app is served at `/<id>/`.
  //
  // ⚠️ THE FAILURE THIS CLOSES IS SILENT AND TOTAL. Without the catalogue in this
  // unit, a commit that changed only the address would deploy the ROUTER (the
  // `nikatru` Pages project is Git-connected and redeploys on every push to main)
  // while the app kept the base href of the PREVIOUS address. index.html would
  // answer 200 and every asset would 404 — a white page, with a green lane and a
  // green post-deploy smoke behind it, because `version.json` is a static file
  // that answers whatever the base href says.
  ['catalog/apps.json', 'the address and therefore the `--base-href` this lane compiles with [ADR 075]'],
];

/** Tooling files the lane executes or reads, pulled out of its own text: every
 *  `tooling/**` `.mjs` or `.json` path it names (⏱ 2026-09-25,
 *  O-DEPLOY-TRIGGERS-MISS-IMPORTED-MODULES — this read `tooling/ci/*.mjs` only, so
 *  `node -p "require('./tooling/ops/glitchtip-project.json')…"` was a read no
 *  unit was held to). A `tooling/` inside a longer path is not one. */
const invokedScripts = (text) =>
  [...new Set([...text.matchAll(/(?<![A-Za-z0-9_-]\/)(?<![A-Za-z0-9._-])tooling\/[A-Za-z0-9._/-]+\.(?:mjs|json)\b/g)].map((m) => m[0]))];

/** Lanes that must still be graded. A guard whose subject was renamed or
 *  restructured out of scope reports "ok" over an empty set, and this repo has
 *  been caught by that more than by any broken check. */
const REQUIRED_COVERAGE = ['deploy-web.yml'];

if (!existsSync(WF_DIR)) {
  console.error(`✗ COVERAGE LOST — no .github/workflows under ${ROOT}, so this scan read nothing.`);
  coverageLost();
}

const units = readUnits(ROOT);
if (units === null) {
  console.error(`✗ COVERAGE LOST — ${UNITS_REL} under ${ROOT} holds no readable \`deployUnits\`.`);
  console.error('  The units are what the plan step publishes on; with none read there is nothing to grade.');
  coverageLost();
}

/** Strip YAML comments. A `#` that starts a line or follows whitespace begins a
 *  comment; anything else (a fragment in a URL, say) is left alone. */
const stripComments = (raw) =>
  raw
    .split('\n')
    .map((l) => l.replace(/(^|\s)#.*$/, '$1'))
    .join('\n');

/** Every `flutter build` workflow-scan's census finds in one workflow file. */
function laneBuilds(name) {
  const wf = parseWorkflow(ROOT, `.github/workflows/${name}`);
  return wf === null ? [] : flutterBuilds(ROOT, [wf]);
}

const files = listDir(WF_DIR).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'));
const problems = [];
const undecidable = [];
const graded = [];
let checks = 0;

for (const name of files) {
  const text = stripComments(readFileSync(join(WF_DIR, name), 'utf8'));

  // Only lanes that actually resolve the Dart workspace are in scope: one that
  // runs `flutter pub get`, or one workflow-scan's census finds a build in.
  // ⏱ CHANGED 2026-09-25 (O-FLUTTER-BUILD-TYPED-PER-LINE, part 2 of 3): the build half was
  // `/flutter\s+build/` on this text, which a lane building only through
  // tooling/ci/flutter-release-build.mjs never matches. The census composes
  // that call into its `flutter build`, in every mode, so that lane stays a
  // build lane and its filter is still graded.
  if (!/flutter\s+pub\s+get/.test(text) && laneBuilds(name).length === 0) continue;

  // A Flutter workflow that plans no unit publishes nothing through a plan, so
  // there is no unit to under-claim. An environment with NO unit is
  // assert-deploy-triggers-deploy.mjs's finding (limb 1), not a skip here.
  const keys = [...new Set(plannedEnvironments(text).map((e) => unitKeyFor(units, e)).filter((k) => k !== null))];
  if (keys.length === 0) continue;

  graded.push(`${keys.join(', ')} by ${name}`);
  const globs = keys.flatMap((k) => units[k]);
  const required = [
    ...REQUIRED,
    [`.github/workflows/${name}`, 'the lane\'s own definition — its build steps and pins'],
    ...invokedScripts(text)
      .filter((s) => !REQUIRED.some(([f]) => f === s))
      .map((s) => [
        s,
        'a script this lane RUNS, or a file it reads — it decides whether the deploy proceeds, what version it '
          + 'stamps, or what it records, none of which is visible in the source tree it claims',
      ]),
  ];
  for (const [file, why] of required) {
    checks++;
    let reached = false;
    for (const g of globs) {
      const c = globClaims(g, file);
      if (c === null && !undecidable.includes(g)) undecidable.push(g);
      if (c) reached = true;
    }
    if (!reached) {
      problems.push(`${name} — deployUnits[${keys.map((k) => `"${k}"`).join(', ')}] never claims \`${file}\`: ${why}.`);
    }
  }
}

// ── coverage self-check, BEFORE reporting clean ──────────────────────────────
if (undecidable.length) {
  console.error(`✗ COVERAGE LOST — deployUnits glob pattern(s) of a shape globClaims cannot decide: ${undecidable.join(', ')}`);
  console.error('  plan-deploy.mjs refuses these at run time; judging them here would be a guess.');
  coverageLost();
}
if (graded.length === 0) {
  console.error(`✗ COVERAGE LOST — no Flutter workflow under ${WF_DIR} plans a deploy unit.`);
  console.error('  This guard graded nothing. Either the lane was renamed/retired and this scan');
  console.error('  was not taught, or the plan step changed out from under the reader.');
  coverageLost();
}
// Deliberately NOT gated on scanningRealRepo: a self-check that cannot fire
// against a fixture is a self-check with no recorded failing case.
{
  const dropped = REQUIRED_COVERAGE.filter((n) => !graded.some((g) => g.endsWith(` by ${n}`)));
  if (dropped.length) {
    console.error(`✗ COVERAGE LOST — named lane(s) no longer graded: ${dropped.join(', ')}`);
    console.error('  They are the reason this guard exists. Point REQUIRED_COVERAGE at their new');
    console.error('  names in the same change that renames them — never delete the entry.');
    coverageLost();
  }
}
// The comparison is only meaningful against files that exist. On a fixture root
// they legitimately do not, so this applies to the real repository.
if (scanningRealRepo) {
  const missing = REQUIRED.map(([f]) => f).filter((f) => !existsSync(join(ROOT, f)));
  if (missing.length) {
    console.error(`✗ COVERAGE LOST — required input(s) do not exist at ${ROOT}: ${missing.join(', ')}`);
    console.error('  A unit checked against a phantom file passes for the wrong reason.');
    coverageLost();
  }
}

// ── THE IMPORT LIMB · O-DEPLOY-TRIGGERS-MISS-IMPORTED-MODULES ────────────────
// The read shapes it follows and its COVERAGE LOST conditions are in the header.
// A read outside tooling/** is counted, never graded: a Worker's tree is limb 3
// of assert-deploy-triggers-deploy.mjs, and apps/ and packages/ are their own
// unit entries.
const REQUIRED_IMPORT_COVERAGE = ['deploy-web.yml', 'deploy-workers.yml'];
const importProblems = [];
const importGraded = [];
const importLost = [];
const importUnreadable = [];
let importWalked = 0;
let importFollowed = 0;
let importReached = 0;
const importOutOfScope = new Set();
{
  const isCodeLine = (l) => !/^\s*(\/\/|\/\*|\*)/.test(l);
  /** Every tooling file one module reads, as repo-relative paths, by the three shapes above. */
  const readsOf = (rel) => {
    const src = readFileSync(join(ROOT, ...rel.split('/')), 'utf8');
    const out = [];
    for (const spec of relativeSpecifiersOf(src)) {
      const hit = resolveSpecifier(ROOT, rel, spec);
      if (hit !== null) out.push(hit);
    }
    for (const line of src.split('\n').filter(isCodeLine)) {
      for (const m of line.matchAll(/['"`](tooling\/[A-Za-z0-9._/-]+\.json)['"`]/g)) {
        if (existsSync(join(ROOT, ...m[1].split('/')))) out.push(m[1]);
      }
      for (const m of line.matchAll(/\bjoin\(\s*HERE\s*,\s*((?:['"][^'"]+['"]\s*,\s*)*['"][^'"]+\.json['"])\s*\)/g)) {
        const segs = [...m[1].matchAll(/['"]([^'"]+)['"]/g)].map((s) => s[1]);
        const hit = posix.normalize(`${posix.dirname(rel)}/${segs.join('/')}`);
        if (!hit.startsWith('..') && existsSync(join(ROOT, ...hit.split('/')))) out.push(hit);
      }
    }
    return [...new Set(out)];
  };

  for (const name of files) {
    const text = stripComments(readFileSync(join(WF_DIR, name), 'utf8'));
    const keys = [...new Set(plannedEnvironments(text).map((e) => unitKeyFor(units, e)).filter((k) => k !== null))];
    if (keys.length === 0) continue;
    const paths = keys.flatMap((k) => units[k]);
    if (paths.length === 0) continue;
    importGraded.push(name);
    const unitNames = `deployUnits[${keys.map((k) => `"${k}"`).join(', ')}]`;

    // The unit's own tooling entries, expanded against the tree.
    const listed = new Set();
    for (const p of paths.filter((x) => x.startsWith('tooling/'))) {
      if (!/[*?[\]]/.test(p)) {
        if (existsSync(join(ROOT, ...p.split('/')))) listed.add(p);
        else importLost.push(`${name} — ${unitNames} lists \`${p}\`, which does not exist — a unit entry checked against a phantom file passes for the wrong reason`);
        continue;
      }
      const tree = claimedTree(p);
      const dir = tree ?? /^([^*?[\]]+)\/\*(\.[A-Za-z0-9.]+)?$/.exec(p)?.[1];
      if (!dir) {
        importUnreadable.push(`${name} — ${unitNames} lists \`${p}\`, a glob shape this limb cannot expand (it reads \`X/**\`, \`X/*\`, \`X/*.ext\` and literal paths)`);
        continue;
      }
      for (const f of bundledFilesUnder(ROOT, dir)) if (globClaims(p, f)) listed.add(f);
    }

    const reached = (file) => paths.some((g) => globClaims(g, file) === true);
    const queue = [...listed].filter((f) => f.endsWith('.mjs'));
    const seen = new Set();
    while (queue.length) {
      const file = queue.shift();
      if (seen.has(file)) continue;
      seen.add(file);
      importWalked++;
      for (const hit of readsOf(file)) {
        importFollowed++;
        if (!hit.startsWith('tooling/')) {
          importOutOfScope.add(hit);
          continue;
        }
        importReached++;
        if (!reached(hit)) {
          const line = `${name} — \`${file}\` reads \`${hit}\`, and ${unitNames} never claims it: an edit to it changes what this lane runs and deploys nothing.`;
          if (!importProblems.includes(line)) importProblems.push(line);
        }
        if (hit.endsWith('.mjs') && !seen.has(hit)) queue.push(hit);
      }
    }
  }
}
// Not gated: a glob this limb cannot expand is unread on any tree.
if (importUnreadable.length) {
  for (const l of importUnreadable) console.error(`✗ COVERAGE LOST — ${l}.`);
  coverageLost();
}
// Gated, as the REQUIRED inputs above are: a fixture holds neither the listed
// files nor the second deploy workflow.
if (scanningRealRepo) {
  const dropped = REQUIRED_IMPORT_COVERAGE.filter((n) => !importGraded.includes(n));
  if (dropped.length) importLost.push(`named workflow(s) no longer graded by the import limb: ${dropped.join(', ')}`);
  if (importFollowed === 0) importLost.push('the import limb followed ZERO reads out of every listed tooling module, so "every module they pull in is listed" was asserted over nothing');
  if (importLost.length) {
    for (const l of importLost) console.error(`✗ COVERAGE LOST — ${l}.`);
    coverageLost();
  }
}

if (problems.length) {
  console.error(`✗ deploy triggers — ${problems.length} unclaimed build input(s):`);
  for (const p of problems) console.error(`    ${p}`);
  console.error('');
  console.error('  A build input outside the unit means a commit that changes what gets built');
  console.error(`  deploys NOTHING, with every check green and no error anywhere. Add the path to ${UNITS_REL}.`);
}
if (importProblems.length) {
  console.error(`✗ deploy-trigger imports — ${importProblems.length} unclaimed tooling module(s) or file(s):`);
  for (const p of importProblems) console.error(`    ${p}`);
  console.error('');
  console.error(`  Add each named file to that workflow's unit in ${UNITS_REL} as its exact path.`);
}
if (problems.length || importProblems.length) process.exit(1);

console.log(
  `ok  deploy triggers — ${graded.length} Flutter deploy unit(s) (${graded.join('; ')}), ` +
    `${checks} build input(s) all claimed`,
);
console.log(
  `ok  deploy-trigger imports — ${importGraded.length} unit-planning workflow(s) graded (${importGraded.join(', ')}): ` +
    `${importWalked} tooling module(s) walked, ${importFollowed} read(s) followed, ${importReached} tooling file(s) reached, ` +
    `all claimed by their unit (${importOutOfScope.size} read(s) outside tooling/ out of scope)`,
);

/** The one COVERAGE LOST stop: each could-not-look branch above prints its own reason and ends
 *  here, so the run exits 2 — never 1, which would read as a finding (AGENTS.md exit-code
 *  convention, O-EXIT2-CONVENTION-GAP). Declared LAST (hoisted) so every `assert-deploy-triggers.mjs:NNN`
 *  citation above keeps pointing at the line it names. */
function coverageLost() {
  process.exit(2);
}
