#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-green-means-ran.mjs — a green tick must mean the work RAN.
//
// Two shapes of the same defect, both found on 2026-08-01, both of which produce
// a fully green run over work that never happened:
//
//   A. AN AGGREGATING JOB THAT TREATS `skipped` AS GREEN. `ci-gate` is the root
//      of trust: assert-gate-passed.mjs reads that one check-run conclusion and
//      deploy-web, deploy-workers and build-platforms all refuse to run until it
//      says success — and branch protection reads the same check, which GitHub
//      counts as SATISFIED when it is skipped. ci-gate tested only 'failure' and
//      'cancelled', so one added job-level `if:` on any lane (a paths filter to
//      shave the ~6-minute app_brick lane is the realistic one) would report that
//      lane `skipped`, fire neither clause, and hand both production deploys a
//      green verdict over a commit whose lane never ran. build-platforms.yml's
//      `all_platforms` got the third clause on 2026-07-31; ci-gate did not.
//
//      That fix WAS structurally guarded — for exactly one job.
//      assert-channel-register.mjs §6 does the aggregator checks, but its subject
//      is `tooling/channel-register.json`'s single `aggregatingJob` pointer,
//      pinned to {build-platforms.yml, all_platforms}. Widening that pointer into
//      a list was the alternative considered and rejected: the channel register
//      is the RELEASE-CHANNEL declaration ([9]R-5, "never a partial artifact
//      set"), and ci-gate ships no artifact and serves no channel — filing the CI
//      root of trust under release channels buries it where nobody editing ci.yml
//      would look, and it would have to pass that guard's channel schema. So the
//      contract moves here, where BOTH aggregators are named as first-class
//      targets, and the checks are strictly stronger than §6's (it asserts
//      needs-completeness, the three verdicts and `exit 1`; this adds `always()`
//      survival, the human-readable echo, and the no-conditional-constituent rule
//      that makes the `skipped` clause safe to enforce). §6 stays as it is: two
//      independent guards over one job is redundancy, not a conflict.
//
//   B. A JOB THAT GREEN-SKIPS ITS OWN BODY WHEN A SECRET IS ABSENT. e2e.yml
//      gated all nine of its real steps on a preflight that merely CHECKED
//      whether SUPABASE_SERVICE_ROLE_KEY was set. With the secret rotated,
//      renamed or expired, the nightly run executed one `echo`, concluded
//      SUCCESS, and its `alert` job — `if: failure() && … 'schedule'` — could not
//      fire by construction. The workflow whose own header memorialises six
//      consecutive unattended red nights ("Silence is not success") carried a
//      second, quieter silence path. Absence of a required secret is now a
//      failure; this guard is what stops the green-skip growing back.
//
//   C. A DRIFT CHECK THAT PASSES BECAUSE NOTHING WAS BUILT. `npm run build`
//      followed by `git diff --exit-code -- <artifact>` reads as "the generated
//      file is up to date". It is not. An empty diff means the working copy
//      equals HEAD, and a generator that emitted ZERO FILES leaves the
//      checked-out copy exactly where it was — so "identical output" and "no
//      output at all" are the same green tick. Corpus triage 2026-08-01 (#27)
//      proved it on the real tree: emptying `platforms` in
//      packages/tokens/style-dictionary.config.mjs makes `npm run build` produce
//      nothing, and the lane guarding the CSS every site serves still went green.
//      There is exactly one mechanical repair — DELETE the artifact before
//      building, so the build has to write it back and the same diff catches its
//      absence — and this section is what stops it being quietly removed as a
//      redundant-looking `rm`.
//
// All three are the house failure mode: "a check that silently stopped checking".
// The lesson is encoded here rather than in a session note, per CLAUDE.md.
//
// Usage:  node tooling/ci/assert-green-means-ran.mjs [repoRoot]
// Exit 0 = every aggregate verdict is complete, no job can green-skip, and every
//          drift check proves its artifact was written.
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { parseWorkflow, parseAllWorkflows, resolveLocalCalls, workflowEvents } from './workflow-scan.mjs';
import { fileURLToPath } from 'node:url';
import { listDir } from './tree-walk.mjs';

const ROOT = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));

/** THE AGGREGATORS. Named here, not derived — a derived list ("any job called
 *  *-gate") would quietly shrink to zero the day someone renames one, which is
 *  the failure this file exists to remove. Adding an aggregating job means
 *  adding it here in the same change. */
const AGGREGATORS = [
  {
    workflow: '.github/workflows/ci.yml',
    job: 'ci-gate',
    why: 'the root of trust — assert-gate-passed.mjs polls this check run and both production deploys plus branch protection ride on it',
  },
  {
    workflow: '.github/workflows/build-platforms.yml',
    job: 'all_platforms',
    why: 'the "all six platforms built" claim — [9]R-5, a release produces the complete artifact set or nothing',
  },
];

/** Workflows that MUST still contain a secret-presence check for section B to be
 *  checking anything. Not a list of files to scan (every workflow is scanned) —
 *  a list of places the pattern is known to live, so that the day the detector
 *  stops matching, this guard says so instead of reporting a clean sweep of
 *  nothing. Removing a preflight entirely is a deliberate act; it should cost an
 *  edit here. */
const REQUIRED_SECRET_GATES = ['.github/workflows/e2e.yml'];

const problems = [];

/** COVERAGE LOST is fatal on the spot: every remaining check quantifies over the
 *  thing that just went missing, so continuing prints "clean" over nothing. */
function coverageLost(lines) {
  console.error('');
  console.error(`FAIL COVERAGE LOST — ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(`     ${l}`);
  console.error('\nassert-green-means-ran: FAILED');
  // ⏱ 2026-09-15 — exit 2, not 1: COVERAGE LOST is "did not check enough to be evidence", never a
  // finding (AGENTS.md exit-code convention; O-EXIT2-CONVENTION-GAP). This helper exited 1 until today.
  process.exit(2);
}

// ── parsing ──────────────────────────────────────────────────────────────────
// ⏱ 2026-09-08 — THE HAND-ROLLED PARSER IS GONE; THIS READS `workflow-scan.mjs`.
//
// What stood here was a private `parseWorkflow`, `jobNeeds` and `jobIf`, beside a
// comment recording that "the two parsers already in the tree diverged on exactly
// that once and an inline-commented job escaped a check that way (review
// 2026-07-31)". The module it now imports was extracted for precisely that reason
// and says so in its own header: "the alternative is four copies that drift, and
// the FIRST thing that drifts in a workflow parser is which lines it can see at
// all — a failure that reports 'clean'." This file and assert-app-dod.mjs were the
// last two holdouts; 21 guards and 3 release scripts already read the module.
//
// 🔴 THE SWAP IS NOT NEUTRAL, IT IS A BUG FIX, and that is worth saying plainly
// rather than burying under "consolidation". The local `jobNeeds` knew two of the
// three `needs:` forms and stripped no quotes. The shared one knows all three and
// strips quotes, because both gaps were found the hard way:
//   · `needs: detect` — the SCALAR form, which `deploy-workers.yml` uses — made a
//     correctly-gated production workflow read as ungated;
//   · `needs: ["gate"]` read the dependency as `"gate"`, quotes included, so the
//     graph walk silently dropped the edge.
// Every aggregator this file grades happens to use the flow form today, so the
// answers are unchanged on this tree — which is exactly the kind of luck a shared
// parser exists to stop depending on.
//
// ⚠️ WHAT IS DELIBERATELY *NOT* TAKEN FROM THE MODULE: `job.logical`.
// `joinBlockScalars` collapses a `run: |` block onto one line joined with ` ; `,
// and §C below reads `step.run` with `[^\n]*` and `run.split('\n')`. Feeding it a
// joined line would let the DRIFT pattern run across what were separate commands
// and would turn "some LINE has `rm` and names the artifact" into "the block has
// `rm` somewhere and the artifact somewhere" — a real weakening dressed as reuse.
// `jobSteps` below therefore keeps its own newline-delimited step model, built
// over `job.lines` exactly as `assert-publish-steps-guarded.mjs` builds its own
// (see its note at :266 about anchoring the step bullet at six spaces).
//
// ⚠️ AND THE COVERAGE CANARY MOVED FROM `rawTopLevel` TO `rawStepCount`. The old
// one counted top-level keys in the raw text; the module counts step bullets. Both
// answer the same question — "the file has content and the parse found no jobs" —
// and the module's is the stricter of the two, since a workflow with steps but no
// parsed jobs is a parser that has stopped reaching the file whether or not `on:`
// and `env:` survived.

/** Steps of one job, each as { id, if, run, env: Map }. */
function jobSteps(bodyLines) {
  const at = bodyLines.findIndex((l) => /^ {4}steps:\s*$/.test(l));
  if (at === -1) return [];
  const blocks = [];
  for (const line of bodyLines.slice(at + 1)) {
    if (line.trim() === '') {
      if (blocks.length) blocks[blocks.length - 1].push(line);
      continue;
    }
    const indent = line.search(/\S/);
    if (indent < 6) break; // back out of steps:
    if (/^ {6}-/.test(line)) blocks.push([line.replace(/^( {6})-\s?/, '$1  ')]);
    else if (blocks.length) blocks[blocks.length - 1].push(line);
  }
  return blocks.map((block) => {
    const text = block.join('\n');
    const id = text.match(/^ {8}id:\s*(\S+)/m)?.[1] ?? null;
    const cond = text.match(/^ {8}if:\s*(.+)$/m)?.[1]?.trim() ?? null;
    const env = new Map();
    const envAt = block.findIndex((l) => /^ {8}env:\s*$/.test(l));
    if (envAt !== -1) {
      for (const l of block.slice(envAt + 1)) {
        const m = l.match(/^ {10}([A-Za-z_][A-Za-z0-9_]*):\s*(.+)$/);
        if (!m) break;
        env.set(m[1], m[2].trim());
      }
    }
    let run = '';
    const runAt = block.findIndex((l) => /^ {8}run:/.test(l));
    if (runAt !== -1) {
      const rest = block[runAt].replace(/^ {8}run:\s*/, '');
      if (rest !== '' && !/^[|>]/.test(rest)) run = rest;
      else {
        for (const l of block.slice(runAt + 1)) {
          if (l.trim() === '') continue;
          if (l.search(/\S/) <= 8) break;
          run += `${l}\n`;
        }
      }
    }
    return { id, cond, env, run, text };
  });
}

const cache = new Map();
function workflow(rel) {
  if (!cache.has(rel)) cache.set(rel, parseWorkflow(ROOT, rel));
  return cache.get(rel);
}

/** The lines of one job as plain strings, which is what `jobSteps` above and the
 *  `needs`/`if` reads below were written against. `workflow-scan` carries a line
 *  NUMBER with every line — a strict improvement this file does not yet spend —
 *  so the shape is narrowed here, in one place, rather than at nine call sites. */
const bodyOf = (job) => job.lines.map((l) => l.text);

// ═════ A. every aggregating job's verdict set is complete ════════════════════
let aggregatorsChecked = 0;

for (const target of AGGREGATORS) {
  const wf = workflow(target.workflow);
  if (wf === null) {
    coverageLost([
      `${target.workflow} does not exist, and it is a named aggregator target (${target.why}).`,
      'Every check below quantifies over its jobs, so this guard would have reported a clean',
      'sweep of a workflow it never opened. Re-point AGGREGATORS in the same change that moved it.',
    ]);
  }
  if (wf.rawStepCount > 0 && wf.jobs.size === 0) {
    coverageLost([
      `${target.workflow} has ${wf.rawStepCount} raw step bullet(s) and ZERO parsed jobs.`,
      'The parser has stopped reaching the file, so "does this job exist" would be asked of an',
      'empty map and every aggregate check below would pass by having nothing to check.',
    ]);
  }
  if (!wf.jobs.has(target.job)) {
    coverageLost([
      `${target.workflow} declares [${[...wf.jobs.keys()].join(', ')}] and none of them is "${target.job}".`,
      `That job is ${target.why}.`,
      'A renamed or deleted aggregator must be LOUD here — silently checking the six jobs that',
      'remain is how the aggregate stops requiring anything while this guard still prints ok.',
    ]);
  }
  aggregatorsChecked++;

  const job = wf.jobs.get(target.job);
  /* The job's text, joined the way this file has always joined it: raw lines with
     newlines kept. NOT `job.logical` — see the ⚠️ in the parsing note above. */
  const body = bodyOf(job).join('\n');
  const where = `${target.workflow}: job "${target.job}"`;
  const others = [...wf.jobs.keys()].filter((j) => j !== target.job);
  const needs = job.needs;

  // A1. `if: always()` — LOAD-BEARING. Without it the aggregate inherits the
  // default success(), reports SKIPPED whenever a lane fails, and GitHub counts
  // a skipped required check as satisfied: branch protection goes green over a
  // red tree and the verdict logic below never executes at all.
  const cond = job.jobIf === null ? null : job.jobIf.cond;
  if (cond === null || !/\balways\s*\(\s*\)/.test(cond)) {
    problems.push(
      `${where} has no job-level \`if: always()\` (found ${cond === null ? 'no `if:` at all' : `\`${cond}\``}). ` +
        'Without it the aggregate inherits the default success() and reports SKIPPED the moment any lane fails — and a skipped required check SATISFIES branch protection. ' +
        'The verdict tests below only mean anything because this job runs no matter what its lanes did.',
    );
  }

  // A2. needs-completeness. The failure channel is adding a lane and forgetting
  // it: the new lane can fail while the aggregate goes green.
  const missing = others.filter((j) => !needs.includes(j));
  const ghost = needs.filter((j) => !wf.jobs.has(j));
  if (missing.length) {
    problems.push(
      `${where} does not \`need\` ${missing.map((j) => `"${j}"`).join(', ')}. ` +
        'Those job(s) can fail while the aggregate reports success — a lane added to the workflow and forgotten in the aggregator is checked by nothing.',
    );
  }
  if (ghost.length) {
    problems.push(`${where} needs ${ghost.map((j) => `"${j}"`).join(', ')}, which ${target.workflow} does not declare.`);
  }

  // A3. THE VERDICT SET. Structural, never a substring: an earlier version of
  // this check elsewhere in the tree did body.includes("'failure'"), which an
  // `echo` merely MENTIONING the verdicts satisfied. The expression must be
  // there, so prose about the check cannot be the check.
  for (const verdict of ['failure', 'cancelled', 'skipped']) {
    const expr = new RegExp(`contains\\(\\s*needs\\.\\*\\.result\\s*,\\s*['"]${verdict}['"]\\s*\\)`);
    if (expr.test(body)) continue;
    problems.push(
      `${where} never evaluates contains(needs.*.result, '${verdict}'). ` +
        `A ${verdict} lane is not a green one, and with \`if: always()\` this job runs anyway and reports success over it. ` +
        (verdict === 'skipped'
          ? 'One job-level `if:` on any lane — a paths filter, an event filter — is all it takes to turn a lane that never ran into a green gate. '
          : '') +
        `(A line merely SAYING '${verdict}' does not count — the \`contains(needs.*.result, '${verdict}')\` expression must be there.)`,
    );
  }

  // A4. …and it must actually fail the job.
  if (!/\bexit\s+[1-9]\d*\b/.test(body)) {
    problems.push(
      `${where} tests verdicts but never exits non-zero. An aggregate that detects a dead lane and exits 0 anyway is a green tick over a broken tree.`,
    );
  }

  // A5. THE HUMAN-READABLE LINE. contains(needs.*.result, …) is invisible in the
  // log — the echo is the only place a person can see WHICH lane died, and
  // ci.yml's enumerated six of its seven lanes for months. A line that
  // under-reports coverage is how a missing lane stays unnoticed.
  const unecho = needs.filter((j) => !new RegExp(`needs\\.${j.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.result`).test(body));
  if (unecho.length) {
    problems.push(
      `${where} never prints ${unecho.map((j) => `needs.${j}.result`).join(', ')}. ` +
        'The contains() tests see every lane but say nothing about which one died; the echo is the only line a human reads, and one that names 6 of 7 lanes reports coverage it does not have.',
    );
  }

  // A6. NO CONDITIONAL CONSTITUENTS. This is what makes A3's `skipped` clause
  // safe to enforce rather than a tripwire: a lane carrying a job-level `if:`
  // resolves to `skipped` on every run the condition is false, which now fails
  // the aggregate. Better to say so here, at authoring time, than at 03:00 in a
  // red CI run — and the alternative (letting the lane opt out) is precisely the
  // hole this file closes.
  for (const j of others) {
    const laneIf = wf.jobs.get(j).jobIf;
    const c = laneIf === null ? null : laneIf.cond;
    if (c === null) continue;
    problems.push(
      `${target.workflow}: lane "${j}" carries a job-level \`if: ${c}\`, and "${target.job}" aggregates it. ` +
        'Whenever that condition is false the lane resolves to `skipped`, which the aggregate must treat as not-green — so this lane either always runs, or it is not a constituent of the gate. ' +
        'A lane that opts out of the gate on some events is a gate that means different things on different events.',
    );
  }
}

// A7. ⏱ 2026-09-24 — A WORKFLOW ONLY `workflow_call` CAN START IS GATED ONLY
// THROUGH ITS CALLER. It has no check run of its own that branch protection could
// name; its jobs reach a verdict only as the result of the job that calls it. So a
// called-only workflow must be called by a CONSTITUENT of an aggregator (a job in
// that aggregator's `needs`), or every red in it is advisory. The call job itself is
// an ordinary job of the caller, so A2, A5 and A6 already judge it as a constituent:
// forgotten in `needs`, unechoed, or given an `if:`.
const everyWorkflow = parseAllWorkflows(ROOT);
const calledOnly = everyWorkflow.filter((w) => {
  const ev = workflowEvents(w);
  return ev.size === 1 && ev.has('workflow_call');
});
const aggregatorCalls = [];
for (const target of AGGREGATORS) {
  const wf = workflow(target.workflow);
  if (wf === null || !wf.jobs.has(target.job)) continue;
  const resolved = resolveLocalCalls(wf, everyWorkflow);
  if (resolved.refusal !== null) {
    coverageLost([
      `${target.workflow} job "${resolved.refusal.job}" calls ${resolved.refusal.callee}, which this scan cannot follow (${resolved.refusal.kind}).`,
      'Rule A7 asks which aggregator constituent calls each called-only workflow; with a call unread,',
      'the answer "none" would be a guess.',
    ]);
  }
  aggregatorCalls.push({ target, needs: wf.jobs.get(target.job).needs, resolved });
}
let calledOnlyGated = 0;
for (const callee of calledOnly) {
  const gatedBy = [];
  for (const { target, needs, resolved } of aggregatorCalls) {
    for (const c of resolved.calls) {
      if (c.callee.rel === callee.rel && needs.includes(c.job)) gatedBy.push(`${target.workflow} "${c.job}" (a need of "${target.job}")`);
    }
  }
  if (gatedBy.length === 0) {
    problems.push(
      `${callee.rel} can be started only by \`workflow_call\`, and no constituent of an aggregator (${AGGREGATORS.map((a) => `${a.workflow} "${a.job}"`).join(', ')}) calls it. ` +
        'Its jobs report only through the job that calls them, so with no gated caller every red in it gates nothing.',
    );
    continue;
  }
  calledOnlyGated++;
}

// A7/A8's canary. Both rules range over `calledOnly`, which is only as good as
// `workflowEvents`: it reads the flow and block forms of `on:`, not the scalar
// `on: workflow_call`. A callee written that way would leave both rules checking
// nothing while this guard printed ok, so a header that SAYS workflow_call and an
// event set that lacks it is COVERAGE LOST.
for (const w of everyWorkflow) {
  const head = [];
  for (const l of w.lines) {
    if (/^jobs:\s*$/.test(l.text)) break;
    head.push(l.text);
  }
  const says = head.some((t) => /^\s+workflow_call\s*:?\s*$/.test(t) || /^on:.*\bworkflow_call\b/.test(t));
  if (says && !workflowEvents(w).has('workflow_call')) {
    coverageLost([
      `${w.rel} names workflow_call above \`jobs:\`, and the event reader did not read it as a trigger.`,
      'Rules A7 and A8 range over the workflows only workflow_call can start; with this one unread,',
      'both would pass over a callee they never judged.',
    ]);
  }
}

// A8. ⏱ 2026-09-24 — INSIDE A CALLEE, `skipped` IS STILL NOT GREEN. [ADR 095]
// ci-gate sees a called-only workflow as ONE call job whose result is the callee's
// conclusion, and a callee whose jobs were skipped concludes success. So A3's
// `skipped` clause cannot see a lane callee whose work jobs skipped themselves; only
// a job INSIDE the callee can. Every called-only workflow therefore has exactly one
// verdict job: it `needs` every other job in its file, carries `if: always()` (or
// the first red need would skip it too, and a skipped job fails nothing), and runs
// tooling/ci/lane-verdict.mjs with `toJSON(needs)` in env LANE_NEEDS. That script's
// only licence to skip is the detect job's affected=false. A callee written before
// the script existed is accepted by its verdict job's NAME below; it still has to
// need every other job and run always().
const VERDICT_BY_NAME = new Map([
  // slot 7's in-callee aggregator; it licenses a skip only under discover's count=0.
  ['.github/workflows/extensions-ci.yml', 'ci-required'],
]);
const LANE_VERDICT_RUN = /(^|[\s;&|])node\s+tooling\/ci\/lane-verdict\.mjs(\s|$)/m;
const NEEDS_AS_JSON = /^(['"]?)\$\{\{\s*toJSON\(\s*needs\s*\)\s*\}\}\1$/;
let calleeVerdicts = 0;
for (const callee of calledOnly) {
  const jobNames = [...callee.jobs.keys()];
  const named = VERDICT_BY_NAME.get(callee.rel) ?? null;
  if (named !== null && !callee.jobs.has(named)) {
    problems.push(
      `${callee.rel} is accepted by its verdict job's name, "${named}", and declares no such job (jobs: ${jobNames.join(', ')}). ` +
        'Re-point it, or give the callee a job that runs tooling/ci/lane-verdict.mjs.',
    );
    continue;
  }
  const verdictJobs = jobNames.filter(
    (j) => j === named || jobSteps(bodyOf(callee.jobs.get(j))).some((s) => LANE_VERDICT_RUN.test(s.run)),
  );
  if (verdictJobs.length !== 1) {
    problems.push(
      `${callee.rel} can be started only by \`workflow_call\` and has ${verdictJobs.length === 0 ? 'NO' : `${verdictJobs.length}`} verdict job(s)` +
        `${verdictJobs.length ? ` (${verdictJobs.join(', ')})` : ''}; it needs exactly one, running tooling/ci/lane-verdict.mjs. ` +
        'Its caller sees the callee as one job whose result is the callee conclusion, and a callee whose work jobs were all skipped concludes success: only a verdict job inside it can refuse an unlicensed skip.',
    );
    continue;
  }
  const v = verdictJobs[0];
  const job = callee.jobs.get(v);
  const where = `${callee.rel}: verdict job "${v}"`;
  const before = problems.length;
  const missing = jobNames.filter((j) => j !== v && !job.needs.includes(j));
  if (missing.length) {
    problems.push(
      `${where} does not \`need\` ${missing.map((j) => `"${j}"`).join(', ')}. ` +
        'A job outside the verdict can fail or skip while the verdict, the call job and ci-gate all report green.',
    );
  }
  const cond = job.jobIf === null ? null : job.jobIf.cond;
  if (cond === null || !/\balways\s*\(\s*\)/.test(cond)) {
    problems.push(
      `${where} has no job-level \`if: always()\` (found ${cond === null ? 'no `if:` at all' : `\`${cond}\``}). ` +
        'Without it the first red need SKIPS the verdict, and a skipped job fails nothing, so the callee concludes on whatever else ran.',
    );
  }
  if (v !== named) {
    const step = jobSteps(bodyOf(job)).find((s) => LANE_VERDICT_RUN.test(s.run));
    const given = step.env.get('LANE_NEEDS') ?? null;
    if (given === null || !NEEDS_AS_JSON.test(given)) {
      problems.push(
        `${where} runs lane-verdict.mjs without \`LANE_NEEDS: \${{ toJSON(needs) }}\` in that step's env (found ${given === null ? 'none' : `\`${given}\``}). ` +
          'The script judges exactly the object it is handed.',
      );
    }
  }
  if (problems.length === before) calleeVerdicts++;
}

if (aggregatorsChecked !== AGGREGATORS.length) {
  coverageLost([
    `${aggregatorsChecked} of ${AGGREGATORS.length} declared aggregator(s) were checked.`,
    'Section A ranged over a shrunken set — the remainder passed by not being looked at.',
  ]);
}

// ═════ B. no job green-skips its own body when a secret is absent ════════════
// A step that reads a secret into `env:` and then branches on whether it is
// empty is making a decision about whether the run means anything. There are
// exactly two honest endings to that branch: run, or fail. "Set an output and
// let every real step skip itself" is the third, and it produces a green run
// that tested nothing — indistinguishable, from the outside, from a passing
// suite.
const wfDir = join(ROOT, '.github', 'workflows');
if (!existsSync(wfDir)) {
  coverageLost([`no .github/workflows under ${ROOT}.`, 'Section B scanned nothing and would have reported clean.']);
}
const wfFiles = listDir(wfDir).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml')).sort();

/** Reads a secret into an env var? Returns the var names bound to `secrets.*`. */
const secretVars = (step) => [...step.env.entries()].filter(([, v]) => /\$\{\{\s*secrets\./.test(v)).map(([k]) => k);

/** Does this run body branch on that var being empty (or non-empty)? Both
 *  spellings, because `if [ -n "$KEY" ]; then <set the output> fi` is the same
 *  green-skip written the other way round. */
function testsEmptiness(run, v) {
  const name = v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`-[zn]\\s+"?\\$\\{?${name}\\}?"?`).test(run) || new RegExp(`"\\$\\{?${name}\\}?"?\\s*[=!]=?\\s*""`).test(run);
}

const secretGateFiles = new Map(); // workflow rel → [step descriptions]
for (const f of wfFiles) {
  const rel = `.github/workflows/${f}`;
  const wf = workflow(rel);
  if (wf === null) continue;
  for (const [jobName, job] of wf.jobs) {
    const steps = jobSteps(bodyOf(job));
    const gateIds = new Set();
    for (const step of steps) {
      if (step.run === '') continue;
      const gated = secretVars(step).filter((v) => testsEmptiness(step.run, v));
      if (gated.length === 0) continue;
      const label = `${rel}: job "${jobName}", step${step.id ? ` "${step.id}"` : ''}`;
      if (!secretGateFiles.has(rel)) secretGateFiles.set(rel, []);
      secretGateFiles.get(rel).push(label);
      if (step.id) gateIds.add(step.id);

      // B1. the absent branch must END the job.
      if (!/\bexit\s+[1-9]\d*\b/.test(step.run)) {
        problems.push(
          `${label} branches on whether ${gated.map((v) => `\`${v}\``).join(', ')} (a repo secret) is set, and never exits non-zero. ` +
            'A run that discovers it cannot do its job and then reports success is a green tick over an untested tree — and a `failure()`-gated alert job cannot fire on it. ' +
            'Either the secret is required (exit 1 and say which secret) or the branch is pointless.',
        );
      }
    }
    // B2. …and nothing may make the REST of the job conditional on that check.
    // This is the exact mechanism e2e.yml shipped: nine steps carrying
    // `if: steps.pre.outputs.run == 'true'`, so the job concluded SUCCESS having
    // executed one echo.
    if (gateIds.size === 0) continue;
    for (const id of gateIds) {
      const gated = steps.filter((s) => s.cond !== null && new RegExp(`steps\\.${id}\\.outputs\\.`).test(s.cond));
      if (gated.length === 0) continue;
      problems.push(
        `${rel}: job "${jobName}" has ${gated.length} step(s) gated on an output of the secret-presence step "${id}" (e.g. \`${gated[0].cond}\`). ` +
          'That is the green-skip: with the secret absent the job runs the preflight, skips everything real, and concludes SUCCESS having tested nothing — and a `failure()`-gated alert job cannot fire on it. ' +
          'Make the preflight fail instead — a missing required secret is a broken run, not a passing one.',
      );
    }
  }
}

for (const rel of REQUIRED_SECRET_GATES) {
  if (secretGateFiles.has(rel)) continue;
  coverageLost([
    `${rel} contains no secret-presence check this scan can see, and it is listed in REQUIRED_SECRET_GATES.`,
    'Either the detector stopped matching the shape (in which case section B just swept every',
    'workflow and found nothing, which looks exactly like clean), or the preflight was removed —',
    'a deliberate act that has to be recorded here rather than inferred from a silent pass.',
  ]);
}

// ═════ C. a drift check must prove its artifact was actually written ═════════
// `git diff --exit-code -- <path>` answers "does the working copy equal HEAD".
// After a build, people read that as "the generator is up to date" — but a
// generator that wrote NOTHING leaves the working copy equal to HEAD too, so the
// vacuous pass and the real pass are the same exit code. The only way to tell
// them apart is to remove the artifact first: then an empty diff can only mean
// the build put it back byte-for-byte.
const DRIFT = /git\s+diff\s+[^\n]*--exit-code[^\n]*?--\s+(\S+)/g;
/** Workflows that MUST still contain a drift check for section C to be checking
 *  anything — same contract as REQUIRED_SECRET_GATES. If the detector stops
 *  matching, this says so instead of sweeping every workflow and finding nothing. */
const REQUIRED_DRIFT_CHECKS = ['.github/workflows/ci.yml'];

const driftFiles = new Map(); // workflow rel → [artifact paths]
for (const f of wfFiles) {
  const rel = `.github/workflows/${f}`;
  const wf = workflow(rel);
  if (wf === null) continue;
  for (const [jobName, job] of wf.jobs) {
    const steps = jobSteps(bodyOf(job));
    for (let i = 0; i < steps.length; i++) {
      for (const m of steps[i].run.matchAll(DRIFT)) {
        const artifact = m[1];
        if (!driftFiles.has(rel)) driftFiles.set(rel, []);
        driftFiles.get(rel).push(artifact);
        // Some EARLIER step in the same job must delete it. Earlier matters: a
        // deletion after the diff proves nothing and would be a plain bug.
        const removed = steps
          .slice(0, i)
          .some((s) => s.run.split('\n').some((l) => /\brm\b/.test(l) && l.includes(artifact)));
        if (removed) continue;
        problems.push(
          `${rel}: job "${jobName}" diffs \`${artifact}\` against HEAD, but no earlier step in that job deletes it first. ` +
            'An empty diff then means EITHER "the build reproduced the file exactly" OR "the build emitted nothing and you are diffing the checkout against itself" — the same exit code for a working generator and a dead one. ' +
            `Add \`rm -f ${artifact}\` before the build (and a \`test -s\` after it for a readable message); the diff then also fails on the absence.`,
        );
      }
    }
  }
}
for (const rel of REQUIRED_DRIFT_CHECKS) {
  if (driftFiles.has(rel)) continue;
  coverageLost([
    `${rel} contains no \`git diff --exit-code -- <path>\` drift check this scan can see, and it is listed in REQUIRED_DRIFT_CHECKS.`,
    'Either the detector stopped matching the shape — in which case section C just swept every workflow',
    'and found nothing, which looks exactly like clean — or the drift check was removed, which is a',
    'deliberate act that has to be recorded here rather than inferred from a silent pass.',
  ]);
}

// ─────────────────────────────────────────────────────────────────────────────
if (problems.length) {
  console.error('');
  for (const p of problems) console.error(`FAIL ${p}`);
  console.error('\nassert-green-means-ran: FAILED');
  process.exit(1);
}

const gates = [...secretGateFiles.values()].reduce((n, xs) => n + xs.length, 0);
const drifts = [...driftFiles.values()].reduce((n, xs) => n + xs.length, 0);
console.log(
  `ok  green means ran — ${aggregatorsChecked} aggregating job(s) fail on failure/cancelled/skipped over every lane, ` +
    `${gates} secret-presence check(s) fail closed, ${drifts} drift check(s) delete their artifact before rebuilding it` +
    `${calledOnly.length ? `, ${calledOnlyGated} of ${calledOnly.length} called-only workflow(s) called by an aggregator constituent` : ''}` +
    `${calledOnly.length ? `, ${calleeVerdicts} of ${calledOnly.length} ending in one always-run verdict job over every other job` : ''}`,
);
