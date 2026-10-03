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
// ⏱ 2026-10-03 — A DRAFT PULL REQUEST RUNS NOTHING (rules A1, A6, A10, A11).
// Stacked pull requests (body `STACKED ON: #a, #b`) cannot merge until their
// bases do, and every base merge used to re-run their full ~40-job CI, showing
// as red or cancelled runs that judged nothing. They now live as DRAFTS and are
// marked ready once every base has merged; GitHub refuses to merge a draft, so a
// draft needs no gate at all. ONE predicate carries that, byte for byte:
// DRAFT_SKIP_IF on a constituent, DRAFT_GATE_IF (`always() && DRAFT_SKIP_IF`) on
// the aggregator. It is the one `if:` A6 admits on a constituent, and only when
// the aggregator skips on the same predicate, so on a draft the gate is skipped
// WITH its lanes rather than reading them skipped, and on every other event the
// predicate is true and nothing changes. A10 proves it on the parsed graph: a
// draft run starts no job, and a ready_for_review run (and a push to main)
// starts every constituent and the gate. A11 holds every workflow that skips
// drafts to `ready_for_review` in its pull_request `types:`, the event that
// gives a readied draft its one run. Not in workflow-scan.mjs beside
// POST_GATE_IF because that file is claimed by two production deploy units
// (tooling/ci/lane-map.json deployUnits): a CI-only rule would redeploy them.
// ⚠️ The skipped ci-gate check of a draft run satisfies branch protection, so
// between `gh pr ready` and the ready run's ci-gate (created only once its needs
// finish) GitHub alone would allow a merge. land-rules.mjs gateVerdict reads only
// SUCCESS as GREEN, so the lander waits through it; a hand merge must too.
//
// Usage:  node tooling/ci/assert-green-means-ran.mjs [repoRoot]
// Exit 0 = every aggregate verdict is complete, no job can green-skip, and every
//          drift check proves its artifact was written.
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { parseWorkflow, parseAllWorkflows, resolveLocalCalls, workflowEvents, POST_GATE_IF, POST_GATE_EVENTS, postGateClass, failFastLane } from './workflow-scan.mjs';
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
    // A10: a draft pull request runs nothing in this workflow, gate included.
    draftSkips: true,
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

/** THE DRAFT PREDICATE, byte for byte (header, ⏱ 2026-10-03). False on a pull_request
 *  event whose PR is a draft, true on every other event: a push or a dispatch carries no
 *  `pull_request`, and `null != true` holds. The aggregator form keeps `always()` first,
 *  so a red lane is still read on every run that is not a draft. */
const DRAFT_SKIP_IF = 'github.event.pull_request.draft != true';
const DRAFT_GATE_IF = `always() && ${DRAFT_SKIP_IF}`;
const DRAFT_PREDICATES = new Set([DRAFT_SKIP_IF, DRAFT_GATE_IF]);

/**
 * A10's plan: which jobs of `wf` a run STARTS for `ctx` = { event, ref, draft } when
 * every job that starts succeeds. `{ starts: Set<id>, unread: [{ id, cond }] }`.
 * A job-level `if:` is read only in the shapes this file grades — none (success() over
 * its needs), the two draft predicates, `always()`, POST_GATE_IF, and an FF-2 follow-up
 * (`failure() && …`, which nothing red in this plan starts). Any other `if:` is UNREAD
 * and planned as starting, so a draft plan names it instead of passing over it. A call
 * job's callee jobs start only when the call job does, so the call job stands for them.
 */
function planRun(wf, ctx) {
  const memo = new Map();
  const unread = [];
  const draft = ctx.event === 'pull_request' && ctx.draft === true;
  const postGate = POST_GATE_EVENTS.includes(ctx.event) && ctx.ref === 'refs/heads/main';
  const starts = (id, stack) => {
    if (memo.has(id)) return memo.get(id);
    const job = wf.jobs.get(id);
    if (!job || stack.has(id)) return false; // a ghost need (A2 names it) or a cycle (GitHub refuses one)
    stack.add(id);
    const needsStart = job.needs.every((n) => starts(n, stack));
    stack.delete(id);
    const c = job.jobIf === null ? null : job.jobIf.cond;
    let v;
    if (c === null) v = needsStart;
    else if (c === DRAFT_SKIP_IF) v = needsStart && !draft;
    else if (c === DRAFT_GATE_IF) v = !draft;
    else if (c === 'always()') v = true;
    else if (c === POST_GATE_IF) v = needsStart && postGate;
    else if (/^failure\(\)/.test(c)) v = false;
    else {
      unread.push({ id, cond: c });
      v = needsStart;
    }
    memo.set(id, v);
    return v;
  };
  for (const id of wf.jobs.keys()) starts(id, new Set());
  return { starts: new Set([...memo].filter(([, v]) => v).map(([id]) => id)), unread };
}

/** The `types:` under `on: pull_request:`, or null when that trigger lists none (GitHub's
 *  defaults then apply, and they omit ready_for_review). Flow and block lists. */
function pullRequestTypes(wf) {
  const head = wf.lines.slice(0, wf.jobsAt ?? wf.lines.length);
  const at = head.findIndex((l) => /^ {2}pull_request:\s*$/.test(l.text));
  if (at === -1) return null;
  const unq = (s) => s.trim().replace(/^['"]|['"]$/g, '');
  for (let i = at + 1; i < head.length; i++) {
    const t = head[i].text;
    if (t.trim() === '') continue;
    if (!/^ {4}/.test(t)) break;
    const m = t.match(/^ {4}types:\s*(.*)$/);
    if (!m) continue;
    const rest = m[1].trim();
    if (rest.startsWith('[')) return rest.replace(/^\[/, '').replace(/\]$/, '').split(',').map(unq).filter(Boolean);
    if (rest !== '') return [unq(rest)];
    const items = [];
    for (const l of head.slice(i + 1)) {
      const b = l.text.match(/^ {6}-\s*(\S+)\s*$/);
      if (!b) break;
      items.push(unq(b[1]));
    }
    return items;
  }
  return null;
}

/* THE POST-GATE PREDICATE (rule A9) is POST_GATE_IF, and the class is postGateClass,
   both from workflow-scan.mjs [ADR 095 §4]: assert-ops-register admits its RED-SINCE
   rows by the same export, so both readers ask one definition which job is
   post-gate. It is the ONE `if:` that exempts a job from A2 and A6. */

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
/** A10's readings, one per draftSkips aggregator, for the passing line. */
const draftPlans = [];
/** aggregator target → the jobs A9 admits as post-gate (exempt from A2 and A6). */
const postGateJobs = new Map();

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
  // ⏱ 2026-09-28 — FF-2's follow-up jobs (`ff-<lane>`, workflow-scan failFastLane) are
  // not constituents: each is skipped on every green run and decides nothing, and the
  // lane it follows is the constituent. A2 and A6 range over the rest.
  const others = [...wf.jobs.keys()].filter((j) => j !== target.job && failFastLane(wf, j) === null);
  const needs = job.needs;

  // A9. ⏱ 2026-09-25 — THE POST-GATE CLASS. [ADR 095 §4] A deploy runs AFTER the gate,
  // in the same run: its job `needs` the aggregator, so a red gate yields a SKIPPED
  // deploy, and the aggregator cannot need it back (GitHub refuses a cycle). That job
  // is exempt from A2 and A6, and it is the ONLY job that is: only when its `if:` is
  // byte-equal to POST_GATE_IF. A wider `if:` publishes on an event the gate was never
  // asked about; the predicate without the aggregator in `needs` publishes whether the
  // gate is green or red.
  const postGate = [];
  for (const { id: j, kind, cond: c } of postGateClass(wf, target.job)) {
    if (kind === 'post') {
      postGate.push(j);
    } else if (kind === 'wide-if') {
      problems.push(
        `${target.workflow}: job "${j}" needs "${target.job}" and its job-level \`if:\` is ${c === null ? 'absent' : `\`${c}\``}, not exactly \`${POST_GATE_IF}\`. ` +
          'A job after the gate runs only on a push to main (the post-gate class, [ADR 095 §4]); anything wider runs it on events the gate never judged for a deploy.',
      );
    } else {
      problems.push(
        `${target.workflow}: job "${j}" carries the post-gate \`if:\` and does not need "${target.job}". ` +
          'A post-gate job whose needs omit the aggregator is red ([ADR 095 §4]): it would run on every push to main whether the gate is green or red. Put the aggregator in its `needs`; never the job in the aggregator\'s.',
      );
    }
  }
  postGateJobs.set(target, postGate);

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
  } else {
    // ⏱ 2026-10-03 — EXACTLY, not "mentions always()". `always() && <anything>` passed
    // the test above, and every conjunct is an event on which the gate is SKIPPED, which
    // branch protection reads as satisfied. The one conjunct admitted is the draft
    // predicate, and only on an aggregator declared draftSkips (A10 proves its plan).
    const want = target.draftSkips ? DRAFT_GATE_IF : 'always()';
    if (cond !== want) {
      problems.push(
        `${where} carries \`if: ${cond}\`; it must be exactly \`${want}\`. ` +
          (target.draftSkips
            ? 'This aggregator skips draft pull requests (draftSkips): the gate must skip on exactly the predicate its lanes skip on, and on nothing else, or a draft run reads every lane skipped and goes red, or some other event skips the gate, which branch protection reads as satisfied.'
            : 'Every conjunct after always() names events on which this job is SKIPPED, and a skipped required check satisfies branch protection.'),
      );
    }
  }

  // A2. needs-completeness. The failure channel is adding a lane and forgetting
  // it: the new lane can fail while the aggregate goes green. A job that needs the
  // aggregator is A9's to judge: the aggregator needing it back is a cycle, never the fix.
  const missing = others.filter((j) => !needs.includes(j) && !wf.jobs.get(j).needs.includes(target.job));
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
  // hole this file closes. A9's post-gate jobs are the one exemption.
  // ⏱ 2026-10-03 — THE ONE ADMITTED `if:` is DRAFT_SKIP_IF, and only while the
  // aggregator carries DRAFT_GATE_IF: the lane and the gate then skip on the same
  // event, a draft, which cannot merge, and both run on every other one (A10 proves it).
  const draftGate = cond === DRAFT_GATE_IF;
  let draftLanes = 0;
  for (const j of others.filter((o) => !postGate.includes(o))) {
    const laneIf = wf.jobs.get(j).jobIf;
    const c = laneIf === null ? null : laneIf.cond;
    if (c === null) continue;
    if (c === DRAFT_SKIP_IF && draftGate) {
      draftLanes++;
      continue;
    }
    if (c === DRAFT_SKIP_IF) {
      problems.push(
        `${target.workflow}: lane "${j}" skips draft pull requests (\`if: ${c}\`) and "${target.job}" does not (its \`if:\` is ${cond === null ? 'absent' : `\`${cond}\``}, not \`${DRAFT_GATE_IF}\`). ` +
          'On a draft the gate then runs, reads this lane skipped, and goes red over a pull request that cannot merge anyway. Skip the gate on the same predicate, or drop it from the lane.',
      );
      continue;
    }
    problems.push(
      `${target.workflow}: lane "${j}" carries a job-level \`if: ${c}\`, and "${target.job}" aggregates it. ` +
        'Whenever that condition is false the lane resolves to `skipped`, which the aggregate must treat as not-green — so this lane either always runs, or it is not a constituent of the gate. ' +
        'A lane that opts out of the gate on some events is a gate that means different things on different events.',
    );
  }

  // A10. ⏱ 2026-10-03 — A DRAFT RUNS NOTHING, A READIED ONE RUNS EVERYTHING. Proved on
  // the parsed graph (planRun), not on the predicate's spelling alone: a lane added
  // without the predicate starts on every draft push while its gate is skipped, which
  // is exactly the unaggregated work this rule removes; a constituent that needs a job
  // which never starts is skipped on the one run that has to judge the PR.
  if (!target.draftSkips) continue;
  const types = pullRequestTypes(wf);
  if (!workflowEvents(wf).has('pull_request') || types === null || !types.includes('ready_for_review')) {
    problems.push(
      `${target.workflow} skips draft pull requests (draftSkips) and its \`on: pull_request: types:\` is ${types === null ? 'absent (GitHub\'s defaults omit it)' : `[${types.join(', ')}]`}, without \`ready_for_review\`. ` +
        'Marking a draft ready is then no event at all: the pull request has no ci-gate until somebody pushes, and every stacked PR waits on a run that never starts.',
    );
  }
  const draftPlan = planRun(wf, { event: 'pull_request', draft: true });
  for (const u of draftPlan.unread) {
    problems.push(`${target.workflow}: job "${u.id}" carries \`if: ${u.cond}\`, a shape A10 cannot plan, so whether it runs on a draft pull request is unknown. Use one of the graded shapes (none, the draft predicates, always(), POST_GATE_IF, an FF-2 follow-up).`);
  }
  if (draftPlan.starts.size) {
    problems.push(
      `a draft pull_request run of ${target.workflow} would start ${draftPlan.starts.size} job(s): ${[...draftPlan.starts].map((j) => `"${j}"`).join(', ')}. ` +
        `A draft cannot merge and "${target.job}" is skipped on it, so that work is judged by nothing. Give each job with no \`needs\` \`if: ${DRAFT_SKIP_IF}\`; a job that needs one inherits the skip.`,
    );
  }
  const mustStart = [target.job, ...others.filter((o) => !postGate.includes(o))];
  for (const [label, ctx, also] of [
    ['a ready_for_review pull_request run', { event: 'pull_request', draft: false }, []],
    ['a push to main', { event: 'push', ref: 'refs/heads/main', draft: null }, postGate],
  ]) {
    const plan = planRun(wf, ctx);
    const dark = [...mustStart, ...also].filter((j) => !plan.starts.has(j));
    if (dark.length) {
      problems.push(
        `${label} of ${target.workflow} would not start ${dark.map((j) => `"${j}"`).join(', ')}. ` +
          'That is the run that judges the change; a constituent it skips is a lane that went dark under the gate.',
      );
    }
  }
  draftPlans.push({ target, jobs: wf.jobs.size, draftStarts: draftPlan.starts.size, readyStarts: mustStart.length - 1, draftLanes });
}

// A11. ⏱ 2026-10-03 — EVERY WORKFLOW THAT SKIPS DRAFTS HEARS ready_for_review. A10 asks it
// of the aggregators; codeql.yml skips drafts too, and ci.yml's CodeQL PR rule waits for
// its analysis on the run that readies the PR. A workflow with no pull_request trigger
// never sees a draft, so the predicate is true there and nothing is asked.
let draftWorkflows = 0;
for (const w of parseAllWorkflows(ROOT)) {
  const skipping = [...w.jobs.values()].filter((j) => j.jobIf !== null && DRAFT_PREDICATES.has(j.jobIf.cond));
  if (!skipping.length || !workflowEvents(w).has('pull_request')) continue;
  const types = pullRequestTypes(w);
  if (types === null || !types.includes('ready_for_review')) {
    problems.push(
      `${w.rel}: ${skipping.map((j) => `job "${j.name}"`).join(', ')} skip(s) draft pull requests, and \`on: pull_request: types:\` is ${types === null ? 'absent (GitHub\'s defaults omit ready_for_review)' : `[${types.join(', ')}]`}. ` +
        'Add `ready_for_review`: it is the one event a readied draft gets, so without it this workflow never runs on that pull request until its next push.',
    );
    continue;
  }
  draftWorkflows++;
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
  aggregatorCalls.push({ target, needs: wf.jobs.get(target.job).needs, postGate: postGateJobs.get(target) ?? [], resolved });
}
// A post-gate job (A9) gates its callee too, from the other side: the callee runs
// only after the aggregator is green. A callee called ONLY that way is a post-gate
// callee; no aggregator reads its result, so A8 below is not its rule, A9's is.
let calledOnlyGated = 0;
const postGateCallees = [];
for (const callee of calledOnly) {
  const gatedBy = [];
  const afterGate = [];
  for (const { target, needs, postGate, resolved } of aggregatorCalls) {
    for (const c of resolved.calls) {
      if (c.callee.rel !== callee.rel) continue;
      if (needs.includes(c.job)) gatedBy.push(`${target.workflow} "${c.job}" (a need of "${target.job}")`);
      else if (postGate.includes(c.job)) afterGate.push(`${target.workflow} "${c.job}" (after "${target.job}")`);
    }
  }
  if (gatedBy.length === 0 && afterGate.length === 0) {
    problems.push(
      `${callee.rel} can be started only by \`workflow_call\`, and no constituent of an aggregator (${AGGREGATORS.map((a) => `${a.workflow} "${a.job}"`).join(', ')}) calls it, nor a post-gate job after one. ` +
        'Its jobs report only through the job that calls them, so with no gated caller every red in it gates nothing.',
    );
    continue;
  }
  if (gatedBy.length === 0) postGateCallees.push(callee);
  else calledOnlyGated++;
}
const laneCallees = calledOnly.filter((c) => !postGateCallees.includes(c));

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
for (const callee of laneCallees) {
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
  // An FF-2 follow-up (failFastLane) is exempt here as in A2: its lane is the need.
  const missing = jobNames.filter((j) => j !== v && !job.needs.includes(j) && failFastLane(callee, j) === null);
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

// A9, inside the callee. ⏱ 2026-09-25 [ADR 095 §4] A post-gate callee has no verdict
// job: nothing aggregates a deploy's result, and lane-verdict.mjs licenses a skip only
// through a lane's detect job. The rule that keeps its green honest is A6's, applied
// inside it: no job-level `if:`. A job there can then be skipped only when one of its
// needs failed, which fails the callee, so a green call job means every job in it RAN.
// A deploy that decides not to publish decides at STEP level and prints why.
let postGateCalleesClean = 0;
for (const callee of postGateCallees) {
  const conditional = [...callee.jobs.values()].filter((j) => j.jobIf !== null);
  if (conditional.length) {
    problems.push(
      `${callee.rel} is a post-gate callee, and ${conditional.map((j) => `job "${j.name}" carries \`if: ${j.jobIf.cond}\``).join('; ')}. ` +
        'A skipped job does not fail a workflow, so the call job would report success over a deploy job that never ran. Decide inside a step (the plan step prints its decision) and leave every job unconditional.',
    );
    continue;
  }
  postGateCalleesClean++;
}
const postGateCount = [...postGateJobs.values()].reduce((n, xs) => n + xs.length, 0);

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
    `${laneCallees.length ? `, ${calledOnlyGated} of ${laneCallees.length} called-only workflow(s) called by an aggregator constituent` : ''}` +
    `${laneCallees.length ? `, ${calleeVerdicts} of ${laneCallees.length} ending in one always-run verdict job over every other job` : ''}` +
    `${postGateCount ? `, ${postGateCount} post-gate job(s) run only after their aggregator on a push to main` : ''}` +
    `${postGateCallees.length ? `, ${postGateCalleesClean} of ${postGateCallees.length} post-gate callee(s) with no job-level \`if:\`` : ''}` +
    draftPlans
      .map(
        (d) =>
          `, a draft pull_request run of ${d.target.workflow} starts ${d.draftStarts} of ${d.jobs} job(s) (${d.draftLanes} lane(s) skip drafts with "${d.target.job}") and a ready_for_review run starts all ${d.readyStarts} constituent(s) and the gate`,
      )
      .join('') +
    `${draftWorkflows ? `, ${draftWorkflows} workflow(s) skipping drafts hear ready_for_review` : ''}`,
);
