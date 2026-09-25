#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-publish-steps-guarded.mjs — every publishing surface in a release job
// carries the dry-run guard, and every STORE publish in every workflow waits for
// the owner's typed word. Two limbs; the region is always the parsed YAML.
//
// Pipeline requirement: [10]D-9 / [9]R-4 — a rehearsal must not publish, and the
// check that proves it must not be able to grade nothing while reporting success.
// [ADR 031] class A — a store publish is owner-only, per instance, never inferred
// from a tag, a default or the agent holding the capability.
//
// 🔴 WHY THIS FILE EXISTS AT ALL, MEASURED 2026-09-07. The check it replaces was
// an inline bash step in `.github/workflows/extensions.yml` that bounded itself
// with two COMMENT lines:
//
//     sed -n '/^# >>> RELEASE LANE >>>/,/^# <<< RELEASE LANE <<</p' extensions.yml
//
// PR #500 stripped prose comments out of the workflows. Both sentinels were
// comment lines, so both were deleted, and the region became EMPTY: on `main` at
// b61f15b6 the file carried ZERO `^# >>> RELEASE LANE >>>` lines (`grep -c`
// answers 0; the commit before #500 answers 2). The step's own floor then fires
// — "matched only 0 step boundaries" — so the first real tag push would have
// gone red at the check rather than published something ungraded. Fail-closed,
// and still a defect: the check's SUBJECT was deletable by an edit that had
// nothing to do with publishing, and nothing in the tree compared the two.
//
// The repair is not a third sentinel. It is to bound the region by the thing the
// runner itself bounds a job by — the YAML — through the ONE workflow parse this
// repository has (`workflow-scan.mjs` `parseWorkflow`), so that the region can
// only be emptied by deleting the job.
//
// 🔴 LIMB 2, ADDED 2026-09-11 — A TAG PUSH PUBLISHED TO THREE STORES. Measured on
// `main` at d9d3579e: the Chrome Web Store, Edge Add-ons and Firefox AMO submit
// steps in extensions.yml were conditioned on `github.event_name == 'push' &&
// inputs.dry_run != true`. On a tag push `inputs` is empty, so a TAG ALONE
// published, with no typed word, no `environment:`, and an unarmed lane exiting 0
// — "published" and "not published" were both green. Limb 1 graded all three as
// GUARDED, correctly: it asks "can a rehearsal publish?", and the answer to "can
// a tag publish without the owner?" was a different question nobody asked. In the
// same review, submit-snap.yml and submit-windows-store.yml passed `--confirm` as
// a LITERAL, which made each script's own confirm check a tautology, and the
// Windows lane had no GITHUB_ACTIONS lane gate. Limb 2 asks that question of
// every workflow in the tree. See "LIMB 2" below.
//
// Usage:
//   node tooling/ci/assert-publish-steps-guarded.mjs
//   node tooling/ci/assert-publish-steps-guarded.mjs --workflow <rel> --job <name>
//   node tooling/ci/assert-publish-steps-guarded.mjs --limb dry-run|owner-word|all
//   node tooling/ci/assert-publish-steps-guarded.mjs --repo-root <path>
//
// EXIT CODES, the corpus convention: 0 every publishing surface is guarded and
// every store publish waits for the owner; 1 a finding; 2 COVERAGE LOST — the
// scan did not see enough to be evidence (no job, no register, zero store
// publish steps), which is deliberately NOT a pass.
//
// ── LIMB 1 — THE DRY-RUN GUARD, INSIDE ONE RELEASE JOB ──────────────────────
// Inside the named job, every step is read for two kinds of surface:
//   · a THIRD-PARTY ACTION (`uses:`) that is not on the exemption list, and
//   · a PUBLISHING COMMAND — a `run:` line that hands bytes to a store or to a
//     GitHub Release.
// Each such step must carry an `if:` CONTAINING the guard expression. The test
// is substring containment and can prove nothing about what the expression
// EVALUATES to, so the one shape that defeats containment is refused outright: a
// `||` anywhere in the `if:` is a disjunction that can satisfy it without the
// guard (`inputs.dry_run != true || true` was measured GUARDED, exit 0, in a
// scratch tree on 2026-08-27). No step in a release job legitimately needs one.
//
// Its own floors, because both zero-answers look exactly like a pass:
//   · fewer than MIN_STEPS step boundaries read → COVERAGE LOST. The job was
//     renamed, moved, or the parse stopped reaching it.
//   · zero publishing surfaces graded → COVERAGE LOST. A scan that found nothing
//     to grade has proved nothing about what the workflow publishes, and the
//     likely cause is a publishing command respelled past the pattern.
// An exemption that no step uses is also a failure: an exemption outlives the
// step it was written for and then pre-authorises whatever takes that name next.
//
// LANE-BOUND: extensions.yml — and the binding IS the repair rather than an oversight inside it.
// The check this file replaces was an inline step inside that one workflow, bounded by two comment
// lines in that one workflow, and the defect was precisely that its subject could be deleted by an
// unrelated edit. Binding it to the file it grades, by name, is what makes the subject
// undeletable-in-silence: point it at a workflow that is not there, or a job that is not there, and
// it exits COVERAGE LOST rather than clean. The binding is a DEFAULT and not a limit — the two
// options above take any lane, so the day a second release lane appears it is graded by this code
// and not by a second copy of it. Deriving the lane from tooling/channel-register.json was
// considered and refused: three channel rows name this workflow's `release` job, so a derivation
// would grade the same job three times and say nothing the default does not.
// ─────────────────────────────────────────────────────────────────────────────
import { resolve, join, dirname } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
// ⏱ 2026-09-24 — P-A1: both limbs read workflows through parseResolvedWorkflows, so
// a step behind `uses: ./.github/actions/<x>` or a local reusable workflow is
// graded where it lives, and labelled with that file's line.
import {
  parseWorkflow,
  parseAllWorkflows,
  parseResolvedWorkflows,
  placeOf,
  refusalText,
  workflowEvents,
  joinBlockScalars,
  shellSegments,
  WORKFLOW_DIR,
  STORE_HOST_PARTS,
  basenameSource,
  readSteps,
  envAt,
  storePublishSteps,
  publishBasenamesOf,
} from './workflow-scan.mjs';

const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i !== -1 && i + 1 < argv.length ? argv[i + 1] : fallback;
};

const ROOT = resolve(opt('repo-root', join(dirname(fileURLToPath(import.meta.url)), '..', '..')));
const WORKFLOW = opt('workflow', '.github/workflows/extensions.yml');
/** ⏱ 2026-09-24 (EXT-3): `--job` REPEATS. The store steps left the `release` job
 *  for the environment-bound `store-publish` job, so the lane is two jobs and the
 *  workflow passes both. Every named job is graded; the publish-script domain is
 *  derived over their union, so naming `release` alone derives nothing and is
 *  COVERAGE LOST rather than a pass over half the lane. */
const JOBS = (() => {
  const named = argv.flatMap((a, i) => (a === '--job' && i + 1 < argv.length ? [argv[i + 1]] : []));
  return named.length ? [...new Set(named)] : ['release', 'store-publish'];
})();
const LIMB = opt('limb', 'all');

/** COVERAGE LOST, the corpus exit code. Not 1: a finding is evidence of a defect,
 *  and this is the absence of evidence either way. */
const EXIT_COVERAGE_LOST = 2;

if (!['dry-run', 'owner-word', 'all'].includes(LIMB)) {
  console.error(`FAIL COVERAGE LOST — --limb ${JSON.stringify(LIMB)} names no limb; expected dry-run, owner-word or all.`);
  console.error('     A mistyped limb would otherwise run nothing and print nothing, which is a pass over nothing.');
  console.error('\nassert-publish-steps-guarded: FAILED');
  process.exit(EXIT_COVERAGE_LOST);
}

/** The guard expression a publishing step's `if:` must contain. One spelling,
 *  because two spellings is how a step ends up "guarded" by a condition nobody
 *  compared to the one the other steps use. */
const GUARD = 'inputs.dry_run != true';

/** The register the publishing-script domain is derived from. */
const REGISTER_REL = 'tooling/channel-register.json';

/** Third-party actions a release job may use without the guard. Both fetch code
 *  into the runner and neither hands anything out of it. Anything else is a
 *  publishing surface until somebody says otherwise here, in this file, with the
 *  requirement that the exemption is actually USED. */
const ALLOWED_ACTIONS = ['actions/checkout', 'actions/setup-node'];

/* The STORE hosts and the store-step classifier live in workflow-scan.mjs (moved
   2026-09-24, EXT-3); limb 1 reads STORE_HOST_PARTS from there. */

/** A `run:` line that hands bytes to something outside the run. Every alternative
 *  is a command or a host this repository actually reaches; a respelling that
 *  slips past it is what the "zero graded" floor below exists to catch. */
const PUBLISH_SURFACE_PARTS = [
    'gh release (create|upload|edit|delete)',
    'web-ext (sign|submit)',
    'chrome-webstore-(upload|api)',
    ...STORE_HOST_PARTS,
];

/** The step-count floor. The release job carried well over twenty steps when this
 *  guard was written; the floor is deliberately far below that, because its job
 *  is to catch a region that has COLLAPSED (a renamed job, a parse that stopped
 *  reaching the file), not to ratchet on every step somebody adds or removes. */
const MIN_STEPS = 10;

function coverageLost(lines) {
  console.error('');
  console.error(`FAIL COVERAGE LOST — ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(`     ${l}`);
  console.error('\nassert-publish-steps-guarded: FAILED');
  process.exit(EXIT_COVERAGE_LOST);
}

/** The register, read ONCE for both limbs. A missing or unparseable register is
 *  COVERAGE LOST for either: both derive their publish-script domain from it. */
let registerCache = null;
function readRegister(root) {
  if (registerCache !== null) return registerCache;
  const abs = join(root, REGISTER_REL);
  if (!existsSync(abs)) {
    coverageLost([
      `${REGISTER_REL} does not exist under ${root}.`,
      'The set of publish scripts this guard grades is DERIVED from it. Without the file this guard would',
      'grade an empty set of scripts and lean entirely on the host patterns, which is a narrower check',
      'wearing the same "ok" line.',
    ]);
  }
  try {
    registerCache = JSON.parse(readFileSync(abs, 'utf8'));
  } catch (e) {
    coverageLost([`${REGISTER_REL} is not valid JSON — ${e.message}`, 'The publish-script domain cannot be derived from a file that does not parse.']);
  }
  return registerCache;
}

/** The resolved tree, read ONCE for both limbs. A refusal is COVERAGE LOST for
 *  either: a step behind a reference this parse cannot follow is a step neither
 *  limb can grade, and an ungraded publish reads as a guarded one. */
let resolvedCache = null;
function resolvedTree() {
  if (resolvedCache !== null) return resolvedCache;
  resolvedCache = parseResolvedWorkflows(ROOT);
  if (resolvedCache.refusal !== null) {
    coverageLost([refusalText(resolvedCache.refusal), 'A publishing step behind that reference would go ungraded, and ungraded reads as guarded.']);
  }
  return resolvedCache;
}

// ═════════════════════════════════════════════════════════════════════════════
// LIMB 1 — the dry-run guard, inside one release job
// ═════════════════════════════════════════════════════════════════════════════

/** THE PUBLISH SCRIPTS THIS LANE RUNS, DERIVED FROM THE REGISTER — never
 *  enumerated here.
 *
 *  🔴 THE ENUMERATION WAS A MEASURED HOLE, 2026-09-07. This constant used to be
 *  the literal alternation `publish-(amo|cws|edge)` + `.mjs`, written by hand
 *  beside the hosts. A fourth store's `publish-<x>.mjs` tests FALSE against it;
 *  the `graded === 0` floor below cannot fire, because the three existing
 *  surfaces keep `graded` at three; so the new store's submit step would be
 *  UNGRADED, this guard would exit 0, and a `workflow_dispatch` rehearsal would
 *  EXECUTE it. A guard whose domain is a hand-written list grows a hole every
 *  time the tree grows, silently, and in the one direction that matters.
 *
 *  The register already knows the answer. Every extension channel row carries
 *  `lane: { workflow, job }` — which is how it declares WHICH job emits its
 *  artifact — and now `publishScript`, the script that submits it. So the domain
 *  of this scan is exactly: the publish scripts of the rows whose lane names the
 *  workflow and job being graded. A new store lane is graded by the act of
 *  declaring its channel, and declaring a channel is already mandatory
 *  (`record-deployment.mjs` refuses to record a release for a row that does not
 *  exist).
 *
 *  TWO WAYS THIS CAN STILL BE WRONG, AND BOTH FAIL RATHER THAN PASS:
 *    · a register with no `publishScript` for this lane at all → COVERAGE LOST.
 *      Not "no publishing surfaces, therefore clean" — that is the exact shape
 *      the `graded === 0` floor exists to refuse, one level up.
 *    · a `publish-*.mjs` the JOB invokes that NO row declares → a finding. It is
 *      still graded (the generic pattern below catches the spelling), and it is
 *      reported, because a publishing script outside the register is a
 *      submission nothing records.
 */
function derivePublishScripts(root, workflowRel, jobNames) {
  const register = readRegister(root);
  const rows = (register.channels ?? []).filter(
    (c) => c?.lane?.workflow === workflowRel && jobNames.includes(c?.lane?.job) && typeof c?.publishScript === 'string' && c.publishScript.trim() !== '',
  );
  const scripts = [...new Set(rows.map((c) => c.publishScript.trim()))].sort();
  if (scripts.length === 0) {
    coverageLost([
      `${REGISTER_REL} declares no channel with \`publishScript\` on lane ${workflowRel} · job(s) ${jobNames.map((j) => `"${j}"`).join(', ')}.`,
      'This guard derives its publishing-script domain from those rows, so an empty derivation means it',
      'would grade only the host and `gh release` patterns while the lane still runs store submissions.',
      'Declare the script on the channel row it publishes; do not re-enumerate it here.',
    ]);
  }
  return scripts;
}

/** A publish-script path whose basename this guard will not put in a pattern. */
function refuseUnpatternable(scripts) {
  for (const p of scripts) {
    if (!/^[A-Za-z0-9._-]+$/.test(p.split('/').pop())) {
      coverageLost([
        `${REGISTER_REL} declares publishScript ${JSON.stringify(p)}, whose basename carries a character this guard will not put in a pattern.`,
        'Rename the script to [A-Za-z0-9._-] or teach this guard the escape deliberately; silently escaping it',
        'is how a domain grows a member nobody can read back out of the pattern.',
      ]);
    }
  }
}

/** Scripts under `extensions/scripts/` whose name starts `publish-` and which
 *  publish NOTHING. Each is a preflight or a token exchange that must be able to
 *  run on a rehearsal, so it is not a publishing surface — and each is written
 *  here BY NAME, with the reason, rather than being caught by a looser pattern.
 *  A `publish-*.mjs` that is neither declared on a channel row nor on this list
 *  is a finding, not a silent pass: that is the whole repair. */
const NON_PUBLISHING_SCRIPTS = new Map([
  ['publish-arming.mjs', 'the register preflight — it reads names out of the environment and prints a verdict; it makes no store call'],
  ['publish-cws-token.mjs', 'the OAuth refresh-token exchange — it obtains an access token and uploads nothing'],
  ['publish-cws-keepalive.mjs', 'the weekly keep-alive — it exercises the refresh token so Google does not revoke it for non-use'],
]);

/** Any `publish-<x>.mjs` a run line invokes, declared or not. Deliberately wider
 *  than PUBLISH_SURFACE so the two can DISAGREE — and the disagreement is the
 *  finding. */
// ⚠ THE WORD BOUNDARY IS NOT ENOUGH, AND THIS GUARD'S OWN NAME PROVES IT:
// `assert-publish-steps-guarded.mjs` contains `publish-steps-guarded.mjs`, and a
// hyphen is a non-word character, so /\bpublish-/ matched the guard invocation
// itself and reported it as an undeclared publisher (measured, 2026-09-07). The
// lookbehind requires the name to START at a path separator or whitespace.
const ANY_PUBLISH_SCRIPT = /(?<![A-Za-z0-9._-])publish-[A-Za-z0-9._-]+[.]mjs/g;

function dryRunLimb(problems, summaries) {
  const wf = resolvedTree().workflows.find((w) => w.rel === WORKFLOW) ?? null;
  if (wf === null && parseWorkflow(ROOT, WORKFLOW) !== null) {
    coverageLost([
      `${WORKFLOW} is not a workflow the resolved parse returns: it runs only when another workflow calls it.`,
      'Point --workflow and --job at the caller and its call job; the callee is graded there, under the caller\'s triggers.',
    ]);
  }
  if (wf === null) {
    coverageLost([
      `${WORKFLOW} does not exist under ${ROOT}.`,
      'Every check below quantifies over that file’s steps. With it gone the grade would range over an',
      'empty set and print a pass over a workflow nobody read.',
    ]);
  }
  const jobs = JOBS.map((name) => {
    const job = wf.jobs.get(name);
    if (job === undefined) {
      coverageLost([
        `${WORKFLOW} declares no job "${name}" — it declares [${[...wf.jobs.keys()].join(', ')}].`,
        'The job IS the region this guard bounds. A job that is not there cannot be graded, and grading',
        'the rest of the file would sweep every CI step into a publishing check that has no business',
        'reading them.',
      ]);
    }
    return job;
  });

  // ⚠ THE DERIVATION RUNS AFTER THE JOB LOOKUP, ON PURPOSE. A `--job` that does
  // not exist would otherwise be diagnosed as "the register declares no publishScript
  // on that lane", which is true and useless: the precise cause is the missing job,
  // and a guard that names the wrong one of two simultaneous causes sends the next
  // reader to the wrong file.
  const PUBLISH_SCRIPTS = derivePublishScripts(ROOT, WORKFLOW, JOBS);
  // Every character class is a literal `[.]` rather than an escape, so this
  // construction carries no backslash at all and cannot be mis-quoted by whatever
  // writes it next; a basename with any other regex metacharacter is refused
  // rather than escaped, because a publish script named with one is a naming
  // mistake and not a case to support.
  refuseUnpatternable(PUBLISH_SCRIPTS);
  const PUBLISH_SURFACE = new RegExp([...PUBLISH_SURFACE_PARTS, ...PUBLISH_SCRIPTS.map(basenameSource)].join('|'));

  const mine = [];
  const usedExemptions = new Set();
  const declaredBasenames = new Set(PUBLISH_SCRIPTS.map((p) => p.split('/').pop()));
  let graded = 0;
  let guarded = 0;
  let boundaries = 0;

  for (const job of jobs) {
    const JOB = job.name;
    const steps = [];
    const invokedScripts = new Map(); // basename -> first line it appears on
    // A call job's steps live in its callees (`<job>/<calleeJob>`); the region is all of them.
    const region = [job, ...[...wf.jobs.values()].filter((j) => j.calledBy === job.name)];
    for (const raw of region.flatMap((j) => readSteps(j))) {
      const current = { n: raw.n, name: null, cond: null, uses: null, surface: null };
      steps.push(current);
      for (const line of raw.lines) {
        const bare = line.text.trim();
        if (bare === '') continue;
        let m;
        if (current.name === null && (m = bare.match(/^-?\s*name:\s*(.+)$/))) current.name = m[1].trim();
        if (current.cond === null && (m = bare.match(/^-?\s*if:\s*(.+)$/))) current.cond = m[1].trim();
        if (current.uses === null && (m = bare.match(/^-?\s*uses:\s*(\S+)/))) current.uses = m[1].split('@')[0];
        if (current.surface === null && PUBLISH_SURFACE.test(bare)) current.surface = bare;
        // Every publish-*.mjs the job invokes, whatever this guard's derived domain
        // says. Compared against the register below.
        for (const m2 of bare.matchAll(ANY_PUBLISH_SCRIPT)) if (!invokedScripts.has(m2[0])) invokedScripts.set(m2[0], line.n);
      }
    }
    boundaries += steps.length;

    if (steps.length < MIN_STEPS) {
      coverageLost([
        `${WORKFLOW} job "${JOB}" yielded ${steps.length} step boundaries and the floor is ${MIN_STEPS}.`,
        'The step bullet is the literal six-space "      - ", so a re-indent of the file, or a job that has',
        'been emptied into a reusable workflow, collapses this scan to nothing — which grades clean.',
        'Fix the boundary or point this guard at the job that now holds the steps; do not lower the floor.',
      ]);
    }

    for (const step of steps) {
      const why = [];
      if (step.uses !== null) {
        if (ALLOWED_ACTIONS.includes(step.uses)) usedExemptions.add(step.uses);
        else why.push(`third-party action  ${step.uses}`);
      }
      if (step.surface !== null) why.push(`publishing surface  ${step.surface}`);
      if (why.length === 0) continue;

      graded++;
      const label = `${placeOf(wf, step.n)} step ${JSON.stringify(step.name ?? '(unnamed)')}`;
      const cond = step.cond ?? '';
      if (cond.includes('||')) {
        mine.push(
          `UNGUARDED  ${why.join(' + ')}\n             ${label}\n             its if: carries a ||, a disjunction that can satisfy it without: ${GUARD}`,
        );
      } else if (cond.includes(GUARD)) {
        guarded++;
        console.log(`GUARDED    ${why.join(' + ')}\n             ${label}`);
      } else {
        mine.push(`UNGUARDED  ${why.join(' + ')}\n             ${label}`);
      }
    }

    // ── THE DOMAIN CHECK, IN THE DIRECTION THE ENUMERATION USED TO FAIL ─────────
    // The steps above were graded against a domain DERIVED from the register. This
    // limb asks the opposite question: does the job invoke a publish script the
    // register has never heard of? Before 2026-09-07 the answer was invisible — the
    // pattern was a hand-written alternation, a fourth store's script tested false,
    // and the `graded === 0` floor could not fire because the first three kept the
    // count non-zero. An undeclared publish script is not merely ungraded: it is a
    // submission `record-deployment.mjs` will have no channel row to record.
    for (const [basename, atLine] of invokedScripts) {
      if (declaredBasenames.has(basename)) continue;
      if (NON_PUBLISHING_SCRIPTS.has(basename)) continue;
      mine.push(
        `UNDECLARED publish script  ${basename}\n             ${placeOf(wf, atLine)}, job \"${JOB}\"\n` +
          `             no channel row in ${REGISTER_REL} names it as its \`publishScript\` on this lane, and it is not on this ` +
          'guard list of publish-named scripts that publish nothing (NON_PUBLISHING_SCRIPTS). Declare the channel it submits to, or ' +
          'add it there with the reason — an undeclared submission is one nothing records.',
      );
    }
  }

  const jobList = JOBS.map((j) => `"${j}"`).join(', ');
  for (const a of ALLOWED_ACTIONS) {
    if (usedExemptions.has(a)) continue;
    mine.push(
      `"${a}" is on this guard's exemption list and no step in ${WORKFLOW} job(s) ${jobList} uses it. ` +
        'An exemption outlives the step it was written for and then pre-authorises whatever takes that name next. Delete the line.',
    );
  }

  if (graded === 0) {
    console.error('');
    console.error(
      `FAIL COVERAGE LOST — ${WORKFLOW} job(s) ${jobList}: ${boundaries} step boundaries read and NO publishing surface graded at all.`,
    );
    console.error('     ZERO IS NOT A PASS: a scan that finds nothing to grade has proved nothing about what this');
    console.error('     job publishes, and the likely cause is a publishing command respelled past the pattern in');
    console.error('     this guard. Fix the pattern; do not delete this check while the lane still publishes.');
    console.error('\nassert-publish-steps-guarded: FAILED');
    process.exit(EXIT_COVERAGE_LOST);
  }

  if (mine.length) {
    problems.push(...mine);
    problems.push(`FAIL ${mine.length} dry-run finding(s) above. A workflow_dispatch rehearsal would EXECUTE an unguarded publishing step.`);
    return;
  }
  summaries.push(`${boundaries} step boundaries read; ${graded} publishing-surface step(s), all ${guarded} behind an if: — job(s) ${jobList}.`);
}

// ═════════════════════════════════════════════════════════════════════════════
// LIMB 2 — THE OWNER'S WORD, IN EVERY WORKFLOW
// ═════════════════════════════════════════════════════════════════════════════
//
// A STORE PUBLISH STEP is what workflow-scan.mjs `storePublishSteps()` returns —
// the one definition this limb, assert-release-provenance.mjs limb 4 and
// assert-publish-records.mjs rule 2b import (moved there 2026-09-24, EXT-3,
// unchanged): a `node … .mjs --submit` verb, a script some channel row declares
// as `publishScript`, or a store CLI verb or store host. A command segment
// carrying `--dry-run` publishes nothing and is not one.
//
// Each store publish step must be ALL FOUR of:
//   (a) UNREACHABLE FROM PUSH. Either its workflow's `on:` declares
//       workflow_dispatch and nothing else, or its own `if:` — or its job's —
//       carries `github.event_name == 'workflow_dispatch'` as a conjunct. An
//       `on:` this parse cannot read counts as "not dispatch-only", so the
//       conjunct is then required: unreadable is never permissive. An `if:`
//       that names the push event is a finding on its own.
//   (b) GATED ON A TYPED DISPATCH WORD. A conjunct `inputs.<name> == '<WORD>'`,
//       where <name> is a declared workflow_dispatch input of type string (a
//       choice or a checkbox is a click, not a word), its default is NOT the
//       word, and the word is a phrase (WORD_SHAPE). Every store has its OWN
//       word: two publish steps sharing one is a finding.
//   (c) HANDED THAT WORD FROM inputs.*. The step's (or job's) `env:` maps a
//       variable from `${{ inputs.<name> }}` for that same input and the `run:`
//       reads it — which is submit-play.yml's shape, `CONFIRM: ${{ inputs.confirm }}`
//       compared again where the publish runs. A `--confirm` given a LITERAL is
//       a finding: it turns the script's own check into a tautology, which is
//       exactly what submit-snap.yml and submit-windows-store.yml shipped.
//   (d) BEHIND A LANE GATE. The process that publishes refuses outside GitHub
//       Actions: either the script it runs reads process.env.GITHUB_ACTIONS and
//       GITHUB_REPOSITORY (submit-play.mjs, submit-snap.mjs), or the step's own
//       `run:` does. A gate that lives ONLY in the workflow is printed as a NOTE,
//       because the script can then still be run by hand; that is the script
//       owner's to close, and saying so is cheaper than pretending.
//
// ⚠️ WHAT THIS CANNOT PROVE. It is text containment over a parsed step, like
// limb 1. It cannot see the GitHub environment's protection rules (the scripts
// read those at run time, and assert-release-provenance.mjs holds the pairing),
// and it cannot tell that a `run:` which reads $CONFIRM compares it correctly.
// What it does prove is the SHAPE whose absence was measured: a tag push reaching
// a store, and a confirm value no human typed.
//
// Its own COVERAGE LOST (exit 2), because every property above is vacuously true
// of an empty set:
//   · no workflow under .github/workflows parsed;
//   · ZERO store publish steps found in the whole tree;
//   · a register `publishScript` that no store publish step invokes (respelled,
//     moved, or run through a variable this scan cannot read);
//   · a register `submission.workflow` whose job carries `environment:` — the
//     shape of a submit lane — with no store publish step invoking that row's
//     `submission.script`.

/** A typed owner word: an upper-case phrase of at least six characters. `yes`,
 *  `true` and `1` are a checkbox wearing a text field. */
const WORD_SHAPE = /^[A-Z0-9][A-Z0-9-]{5,}$/;

const DISPATCH_CONJUNCT = /github\.event_name\s*==\s*['"]workflow_dispatch['"]/;
const PUSH_NAMED = /github\.event_name\s*==\s*['"]push['"]/;
const WORD_CONJUNCT = /(?:github\.event\.)?inputs\.([A-Za-z_][A-Za-z0-9_-]*)\s*==\s*(['"])([^'"]*)\2/g;
const INPUT_EXPR = /^['"]?\$\{\{\s*(?:github\.event\.)?inputs\.([A-Za-z_][A-Za-z0-9_-]*)\s*\}\}['"]?$/;
const LITERAL_CONFIRM = /--confirm(?:=|\s+)(?!["']?\$)["']?([^\s"';]+)/;
const INLINE_CONFIRM_EXPR = /--confirm(?:=|\s+)["']?\$\{\{/;

/** `${{ x }}` → `x`, trimmed. */
const bareCond = (c) => String(c ?? '').trim().replace(/^\$\{\{\s*/, '').replace(/\s*\}\}$/, '').trim();
/** A condition whose every conjunct must hold: no `||`, no negated group. Only a
 *  conjunctive condition is EVIDENCE — `A || B` contains A and proves nothing. */
const conjunctive = (c) => c !== '' && !c.includes('||') && !/!\s*\(/.test(c);

/** The `workflow_dispatch` inputs a workflow declares, block form, from the
 *  comment-blanked lines `parseWorkflow` already returns. No workflow in this
 *  tree writes the flow form; an unreadable block yields no inputs, which makes
 *  (b) FAIL rather than pass. */
function dispatchInputs(wf) {
  const inputs = new Map();
  const L = wf.lines.map((l) => l.text);
  const onAt = L.findIndex((t) => /^on:\s*$/.test(t));
  if (onAt === -1) return inputs;
  let i = onAt + 1;
  while (i < L.length && !/^\S/.test(L[i]) && !/^ {2}workflow_dispatch:\s*$/.test(L[i])) i++;
  if (i >= L.length || !/^ {2}workflow_dispatch:\s*$/.test(L[i])) return inputs;
  let j = i + 1;
  for (; j < L.length; j++) {
    if (L[j].trim() === '') continue;
    if (!/^ {4}/.test(L[j])) return inputs;
    if (/^ {4}inputs:\s*$/.test(L[j])) break;
  }
  let cur = null;
  for (let k = j + 1; k < L.length; k++) {
    const t = L[k];
    if (t.trim() === '') continue;
    if (!/^ {6}/.test(t)) break;
    let m;
    if ((m = t.match(/^ {6}([A-Za-z_][A-Za-z0-9_-]*):\s*$/))) {
      cur = { name: m[1], type: null, default: null, n: k + 1 };
      inputs.set(m[1], cur);
    } else if (cur !== null && (m = t.match(/^ {8}(type|default):\s*(.*?)\s*$/))) {
      cur[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  }
  return inputs;
}

const refersTo = (run, name) => new RegExp(`\\$\\{?${name}\\b|\\$env:${name}\\b|%${name}%`).test(run);
const scriptCarriesLaneGate = (rel) => {
  const abs = join(ROOT, rel);
  if (!existsSync(abs)) return false;
  const text = readFileSync(abs, 'utf8');
  return /process\.env\.GITHUB_ACTIONS\b/.test(text) && /GITHUB_REPOSITORY\b/.test(text);
};

function ownerWordLimb(problems, summaries) {
  const register = readRegister(ROOT);
  const publishRows = (register.channels ?? []).filter((c) => typeof c?.publishScript === 'string' && c.publishScript.trim() !== '');
  refuseUnpatternable(publishRows.map((c) => c.publishScript.trim()));
  /** basename -> repo-relative path, derived from every row that declares one. */
  const publishBasenames = publishBasenamesOf(register);

  const workflows = resolvedTree().workflows;
  const coverage = [];
  if (workflows.length === 0) {
    coverageLost([
      `no workflow parsed under ${join(ROOT, WORKFLOW_DIR)}.`,
      'Every property this limb grades is true of an empty set of store publish steps. A tree with no',
      'workflows to read is not a tree that publishes nothing; it is a scan that looked nowhere.',
    ]);
  }

  const mine = [];
  const notes = [];
  const graded = [];
  const wordOwners = new Map(); // word -> [label]

  for (const { wf, job, step, hits, scripts } of storePublishSteps(workflows, register)) {
    const events = workflowEvents(wf);
    const onlyDispatch = events.size === 1 && events.has('workflow_dispatch');
    const inputs = dispatchInputs(wf);
    const jobEnv = envAt(job.lines, 4);
    const jobCond = bareCond(job.jobIf?.cond);
    const label = `${placeOf(wf, step.n)} job "${job.name}" step ${JSON.stringify(step.name ?? '(unnamed)')}`;
    const why = [];
    const stepCond = bareCond(step.cond);
    if (stepCond !== '' && !conjunctive(stepCond)) {
      why.push(`its own if: is not a plain conjunction (a || or a negated group), so nothing in it is evidence: ${stepCond}`);
    }
    const evidence = [stepCond, jobCond].filter(conjunctive);

    // (a)
    if (!onlyDispatch && !evidence.some((c) => DISPATCH_CONJUNCT.test(c))) {
      why.push(
        `(a) REACHABLE FROM PUSH — ${wf.rel} triggers on [${[...events].join(', ') || 'an on: this parse cannot read'}], and neither this step's if: ` +
          "nor its job's carries github.event_name == 'workflow_dispatch' as a conjunct. A tag push, a schedule or a caller would reach a store.",
      );
    }
    if ([stepCond, jobCond].some((c) => PUSH_NAMED.test(c))) {
      why.push("(a) NAMES THE PUSH EVENT — an if: on the path to a store says github.event_name == 'push'. A push is never the owner's word.");
    }

    // (b)
    const words = [];
    for (const c of evidence) for (const m of c.matchAll(WORD_CONJUNCT)) words.push({ input: m[1], word: m[3] });
    const refusals = [];
    const valid = words.filter((w) => {
      const d = inputs.get(w.input);
      if (d === undefined) return refusals.push(`inputs.${w.input} is not a declared workflow_dispatch input of ${wf.rel}`), false;
      if (d.type !== null && d.type !== 'string') return refusals.push(`inputs.${w.input} is type ${d.type}, a click rather than a typed word`), false;
      if (!WORD_SHAPE.test(w.word)) return refusals.push(`'${w.word}' is not a typed phrase (${WORD_SHAPE})`), false;
      if (d.default === w.word) return refusals.push(`inputs.${w.input} DEFAULTS to '${w.word}', so the word is typed by nobody`), false;
      return true;
    });
    if (valid.length === 0) {
      why.push(
        `(b) NO TYPED OWNER WORD — no conjunct inputs.<name> == '<WORD>' on a declared string dispatch input guards this step${refusals.length ? `: ${refusals.join('; ')}` : ''}.`,
      );
    }
    for (const w of valid) {
      if (!wordOwners.has(w.word)) wordOwners.set(w.word, []);
      wordOwners.get(w.word).push(label);
    }

    // (c)
    const env = new Map([...jobEnv, ...step.env]);
    const handed = [...env].filter(([name, value]) => {
      const m = value.match(INPUT_EXPR);
      return m !== null && valid.some((w) => w.input === m[1]) && refersTo(step.run, name);
    });
    if (handed.length === 0) {
      why.push(
        `(c) THE WORD IS NOT HANDED OVER FROM inputs.* — no env: variable mapped from \${{ inputs.${valid[0]?.input ?? '<name>'} }} is read by this step's run:, ` +
          'so the publish itself never sees what the owner typed. Pass it the way submit-play.yml does: CONFIRM: ${{ inputs.confirm }} and --confirm "$CONFIRM".',
      );
    }
    const literal = step.run.match(LITERAL_CONFIRM);
    if (literal !== null) {
      why.push(`(c) LITERAL CONFIRM — --confirm ${literal[1]} is written into the workflow, which makes the script's own confirm check a tautology.`);
    }
    if (INLINE_CONFIRM_EXPR.test(step.run)) {
      why.push('(c) INLINE EXPRESSION — --confirm ${{ … }} interpolates the input into the shell text; hand it over through env: instead.');
    }

    // (d)
    const inlineGate = /\bGITHUB_ACTIONS\b/.test(step.run) && /\bGITHUB_REPOSITORY\b/.test(step.run);
    const gatedScripts = scripts.filter(scriptCarriesLaneGate);
    if (!inlineGate && gatedScripts.length === 0) {
      why.push(
        `(d) NO LANE GATE — neither this step's run: nor the script it runs (${scripts.join(', ') || 'none resolved'}) refuses outside GitHub Actions ` +
          '(GITHUB_ACTIONS=true and GITHUB_REPOSITORY set), the check submit-play.mjs makes before it will submit.',
      );
    } else if (gatedScripts.length === 0 && scripts.length > 0) {
      notes.push(`NOTE  ${label}\n      the lane gate lives in the workflow step only; ${scripts.join(', ')} can still be run by hand outside Actions.`);
    }

    graded.push({ wf: wf.rel, label, scripts, words: valid.map((w) => w.word) });
    if (why.length) mine.push(`NOT OWNER-GATED  ${label}\n    ${hits[0]}\n    ${why.join('\n    ')}`);
    else console.log(`OWNER-WORD  ${label}\n            word ${valid.map((w) => `${w.word} via inputs.${w.input}`).join(', ')}`);
  }

  for (const [word, labels] of wordOwners) {
    if (labels.length > 1) {
      mine.push(`SHARED WORD  '${word}' gates ${labels.length} store publish steps:\n    ${labels.join('\n    ')}\n    Every store takes its OWN word; one phrase that publishes to two stores is one decision taken twice.`);
    }
  }

  // ── COVERAGE — zero is not a pass, and neither is a declared publisher nobody reached ──
  if (graded.length === 0) {
    coverage.push(
      `ZERO store publish steps found across ${workflows.length} workflow(s) under ${WORKFLOW_DIR}.`,
      'Every property this limb grades is vacuously true of an empty set. The tree has store lanes, so the',
      'likely cause is a submit command respelled past the patterns above. Fix the pattern; never read zero as clean.',
    );
  }
  const reachedScripts = new Set(graded.flatMap((g) => g.scripts.map((s) => s.split('/').pop())));
  for (const [base, rel] of publishBasenames) {
    if (!reachedScripts.has(base)) {
      coverage.push(`${REGISTER_REL} declares publishScript ${rel} and no store publish step in any workflow invokes it — respelled, moved, or run through a variable this scan cannot read.`);
    }
  }
  for (const c of register.channels ?? []) {
    const sub = c?.submission;
    if (typeof sub?.workflow !== 'string' || typeof sub?.script !== 'string') continue;
    const wf = workflows.find((w) => w.rel === sub.workflow);
    if (wf === undefined) continue;
    const submitLane = [...wf.jobs.values()].some((j) => j.lines.some((l) => /^ {4}environment:/.test(l.text)));
    if (!submitLane) continue;
    const base = sub.script.split('/').pop();
    if (!graded.some((g) => g.wf === sub.workflow && g.scripts.some((s) => s.split('/').pop() === base))) {
      coverage.push(`channel "${c.id}" submits through ${sub.script} in ${sub.workflow}, whose job carries environment:, and no store publish step there invokes it with --submit.`);
    }
  }

  for (const n of notes) console.log(n);
  if (mine.length) {
    problems.push(...mine);
    problems.push(`FAIL ${mine.length} owner-word finding(s) above. A store would be published to without the owner's typed word.`);
  }
  if (coverage.length) return coverage;
  if (!mine.length) {
    const wfCount = new Set(graded.map((g) => g.wf)).size;
    summaries.push(
      `owner-word: ${graded.length} store publish step(s) across ${wfCount} workflow(s) — each unreachable from push, gated on its own typed workflow_dispatch word, handed that word from inputs.*, and behind a lane gate.`,
    );
  }
  return [];
}

// ═════════════════════════════════════════════════════════════════════════════
const problems = [];
const summaries = [];
if (LIMB !== 'owner-word') dryRunLimb(problems, summaries);
const coverage = LIMB !== 'dry-run' ? ownerWordLimb(problems, summaries) : [];

if (problems.length || coverage.length) {
  console.error('');
  for (const p of problems) console.error(p);
  if (coverage.length) {
    console.error('');
    console.error(`FAIL COVERAGE LOST — ${coverage[0]}`);
    for (const l of coverage.slice(1)) console.error(`     ${l}`);
  }
  console.error('\nassert-publish-steps-guarded: FAILED');
  process.exit(coverage.length ? EXIT_COVERAGE_LOST : 1);
}

for (const s of summaries) console.log(s);
process.exit(0);
