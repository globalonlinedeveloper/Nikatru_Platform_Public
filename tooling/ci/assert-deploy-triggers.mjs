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
// LANE-BOUND: deploy-web.yml — but ONLY as a REQUIRED_COVERAGE floor, not as the subject set. The scan
// grades every workflow that builds a Flutter artifact and plans a deploy unit; naming this one is what
// stops the grade being computed over an empty set when the lane is renamed or its plan restructured,
// which is the failure this repo has hit more often than a broken check. A second Flutter deploy is
// graded automatically the day it plans a unit and needs no edit here. [pipeline 9]R-1 limb B.
//
// Usage:  node tooling/ci/assert-deploy-triggers.mjs [repoRoot]
// Exit 0 = every Flutter deploy's unit claims its real inputs.  Exit 1 = a
// finding.  Exit 2 = COVERAGE LOST: the units or the lanes could not be read.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { listDir } from './tree-walk.mjs';
import { UNITS_REL, readUnits, plannedEnvironments, unitKeyFor, globClaims } from './assert-deploy-triggers-deploy.mjs';

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

/** Scripts the lane executes, pulled out of its own text. */
const invokedScripts = (text) =>
  [...new Set([...text.matchAll(/tooling\/ci\/([A-Za-z0-9._-]+\.mjs)/g)].map((m) => `tooling/ci/${m[1]}`))];

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

const files = listDir(WF_DIR).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'));
const problems = [];
const undecidable = [];
const graded = [];
let checks = 0;

for (const name of files) {
  const text = stripComments(readFileSync(join(WF_DIR, name), 'utf8'));

  // Only lanes that actually resolve the Dart workspace are in scope.
  if (!/flutter\s+(build|pub\s+get)/.test(text)) continue;

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
    ...invokedScripts(text).map((s) => [
      s,
      'a script this lane RUNS — it decides whether the deploy proceeds, what version it '
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
  console.error(`✗ COVERAGE LOST — deployUnits glob(s) of a shape globClaims cannot decide: ${undecidable.join(', ')}`);
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

if (problems.length) {
  console.error(`✗ deploy triggers — ${problems.length} unclaimed build input(s):`);
  for (const p of problems) console.error(`    ${p}`);
  console.error('');
  console.error('  A build input outside the unit means a commit that changes what gets built');
  console.error(`  deploys NOTHING, with every check green and no error anywhere. Add the path to ${UNITS_REL}.`);
  process.exit(1);
}

console.log(
  `ok  deploy triggers — ${graded.length} Flutter deploy unit(s) (${graded.join('; ')}), ` +
    `${checks} build input(s) all claimed`,
);

/** The one COVERAGE LOST stop: each could-not-look branch above prints its own reason and ends
 *  here, so the run exits 2 — never 1, which would read as a finding (AGENTS.md exit-code
 *  convention, O-EXIT2-CONVENTION-GAP). Declared LAST (hoisted) so every `assert-deploy-triggers.mjs:NNN`
 *  citation above keeps pointing at the line it names. */
function coverageLost() {
  process.exit(2);
}
