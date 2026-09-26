#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-workflow-timeouts.mjs — every job is BOUNDED, bounded ONCE, and bounded
// at a number somebody chose.
//
// Pipeline requirement: Private/requirements/ → F-11.
// Owner rule, 2026-09-06 (`platform-state/constraints.json` C-EXPECTED-DURATION):
// "Every waiting thing carries an EXPECTED DURATION and an ACTION ON OVERRUN."
// Charter [ADR 067] decision 4 puts every one of those waits on a GitHub-hosted
// runner. A `platform-state/open.json` row is what this
// file closes.
//
// ⚠️ THE PRESENCE HALF IS NOT NEW AND THIS FILE DOES NOT PRETEND IT IS.
// assert-workflow-hardening.mjs limb 4 has asserted "every job carries
// timeout-minutes" since 2026-08-17, and INV-124 declares that rule and names
// that guard. What NOTHING in this tree asserted is the other three halves, and
// each of them has a measurement behind it:
//
//   1. EXACTLY ONCE. A second `timeout-minutes:` key in one job is merged
//      silently by every loader that read this tree locally — PyYAML,
//      @action-validator/cli and zizmor all called the file clean — and REFUSED
//      by GitHub, which answers with ZERO JOBS and no message any API returns
//      (traps ci-33, measured 2026-09-05 on the extensions merge, where a
//      scripted edit inserted a second key at :1538). A presence check is
//      satisfied by the FIRST key and therefore cannot see the defect at all:
//      the workflow it just called bounded is a workflow GitHub will not run.
//      This limb is LINE-LEVEL on purpose — see `timeoutLines` — because the
//      shared reader is free to collapse duplicates and a limb that asks a
//      parsed object how many times a key appeared can only ever be told once.
//   2. AN INTEGER >= 1. `timeout-minutes: 0` and `timeout-minutes: abc` are both
//      present, so both pass a presence check, and neither bounds anything.
//   3. A CEILING. GitHub's default is 360 minutes — SIX HOURS — and a job that
//      declares 360 is exactly as unbounded in practice as one that declares
//      nothing, while satisfying limb 4 of the hardening guard perfectly. Two
//      ceilings, because a job that blocks a merge and a job that does not are
//      different kinds of wait: a job in the `needs` closure of ci.yml `ci-gate`
//      (followed one level into a local reusable-workflow call, which is how
//      extensions-ci.yml's jobs hold a merge) is capped at 30; every other job
//      at 60. The closure is DERIVED by walking `needs`,
//      never listed — a list is a second copy of the graph and it goes stale in
//      the direction of admitting a job nobody meant to admit.
//
// 🔴 THE CAP IS A CEILING, NOT A TARGET, AND LOWERING A JOB UNDER ITS REAL NEED
// IS THE OPPOSITE DEFECT: a hang re-read as a timeout, which is a green-looking
// red that teaches everyone to re-run rather than to read. A job that genuinely
// needs more than its cap is a MEASUREMENT to take and then a cap to move for
// every job, never a per-job exemption — there is deliberately no exemption map
// in this file, because a map is where the next unbounded job would hide.
//
// Usage:  node tooling/ci/assert-workflow-timeouts.mjs [repoRoot]
// Exit 0 = every job bounded exactly once, at an integer >= 1, within its cap.
//      1 = a finding: an unbounded job, a duplicate key, a non-integer or
//          non-positive value, or a job over its cap.
//      2 = COVERAGE LOST — no workflow directory, no workflow file, no job, a
//          file with a `jobs:` block this scan read as empty, a gate anchor this
//          scan could not find, or a self-canary that stopped telling one key
//          from two. "I looked and found nothing wrong" and "I could not look"
//          are different answers and are deliberately different codes.
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseAllWorkflows, resolveLocalCalls, WORKFLOW_DIR } from './workflow-scan.mjs';

/** The two ceilings, in minutes. Named rather than inlined so the numbers this
 *  guard enforces can be read in one place and cited in a report. */
export const GATING_CAP = 30;
export const DEFAULT_CAP = 60;

/** The gate a job has to be reachable from to count as merge-blocking: ci.yml
 *  `ci-gate`, the one required check, so this guard follows the branch-protection
 *  shape instead of restating it. ⏱ 2026-09-24: extensions.yml `ci-required` was
 *  a second anchor until the extensions CI lane became extensions-ci.yml, called by
 *  ci.yml's `extensions` job; its jobs now reach this closure THROUGH that call
 *  (gatingThroughCalls below), which is the only way they hold a merge. */
export const GATE_ANCHORS = [
  { rel: `${WORKFLOW_DIR}/ci.yml`, job: 'ci-gate' },
];

/**
 * EVERY job-level `timeout-minutes:` LINE in one job, not the value of the key.
 *
 * The anchor is exactly four spaces because that is where a job's own keys sit
 * (`jobs:` at 0, a job id at 2, its keys at 4, a step's keys at 6+) — so a
 * `timeout-minutes:` on a STEP, which GitHub honours and which is not this
 * guard's subject, is not counted, and neither is one inside a `strategy:`
 * block. Comments are already blanked by the shared reader with their line
 * numbers preserved, so a commented-out key counts as zero and a reported line
 * still points into the real file.
 */
export const timeoutLines = (jobLines) =>
  jobLines.filter((l) => /^ {4}timeout-minutes:/.test(l.text));

/** The raw text after `timeout-minutes:`, as written. Returned unparsed on
 *  purpose: `abc`, `0`, `1.5` and `${{ inputs.t }}` are all things a job can
 *  say, and the caller decides what each one means. */
export const timeoutValue = (line) => line.text.replace(/^ {4}timeout-minutes:\s*/, '').trim();

/** A value this guard accepts: a decimal integer of at least 1. Deliberately not
 *  `Number.parseInt`, which reads `30min` as 30 and stops at the first letter. */
export const isBoundedValue = (raw) => /^[0-9]+$/.test(raw) && Number(raw) >= 1;

/** Every job reachable from `anchor` by `needs`, anchor included. The shared
 *  reader resolves all three `needs:` forms and strips quotes; this walk adds
 *  nothing to that but the transitive closure. */
export function needsClosure(wf, anchor) {
  const seen = new Set();
  const queue = [anchor];
  while (queue.length) {
    const name = queue.shift();
    if (seen.has(name)) continue;
    const job = wf.jobs.get(name);
    if (!job) continue;
    seen.add(name);
    for (const dep of job.needs) queue.push(dep);
  }
  return seen;
}

/**
 * ⏱ 2026-09-24 — THE CLOSURE, FOLLOWED THROUGH A LOCAL CALL. A job in an anchor's
 * `needs` closure that calls `./.github/workflows/<callee>.yml` runs EVERY job of
 * the callee inside the anchor's run, and the anchor's verdict reads the call's
 * result — so every callee job holds the merge exactly as a direct need does.
 * Returns `{ gating: Map(rel -> Set(job)), refusal }`; `refusal` is
 * workflow-scan.resolveLocalCalls' own, for a call job IN the closure, and the
 * caller turns it into COVERAGE LOST. One level, as the resolver follows.
 */
export function gatingThroughCalls(workflows, anchor) {
  const gating = new Map();
  const wf = workflows.find((w) => w.rel === anchor.rel);
  if (!wf) return { gating, refusal: null };
  const closure = needsClosure(wf, anchor.job);
  gating.set(anchor.rel, closure);
  const { calls, refusal } = resolveLocalCalls(wf, workflows);
  for (const c of calls) {
    if (!closure.has(c.job)) continue;
    const into = gating.get(c.callee.rel) ?? new Set();
    for (const name of c.callee.jobs.keys()) into.add(name);
    gating.set(c.callee.rel, into);
  }
  return { gating, refusal: refusal !== null && closure.has(refusal.job) ? refusal : null };
}

/** A job whose own key `uses:` makes it a reusable-workflow CALL: GitHub rejects
 *  `timeout-minutes` on it, so it is bounded by its callee's jobs instead. */
export const callRef = (jobLines) => {
  const hit = jobLines.find((l) => /^ {4}uses:\s*\S/.test(l.text));
  return hit ? hit.text.replace(/^ {4}uses:\s*/, '').trim() : null;
};

// ─────────────────────────────────────────────────────────────────────────────
// 🔴 EVERYTHING BELOW RUNS ONLY WHEN THIS FILE IS THE ENTRY POINT.
// tooling/ci/test/workflow-timeouts.test.mjs imports the pure functions above,
// and at module scope a guard that calls process.exit takes the whole suite down
// with it — the defect assert-platform-register.mjs records in its own header,
// where one line of attribution replaced 1200 lines of cases exactly when the
// tree went red. The SPAWNED path is unchanged: every case in that suite runs
// this file through `spawnSync(node, [GUARD, root])`, the shipping invocation.
// The comparison is `import.meta.url` against `pathToFileURL(process.argv[1])`
// rather than a string compare: on win32 argv[1] carries backslashes while
// import.meta.url is a `file:///C:/…` URL, and `?? ''` keeps pathToFileURL from
// throwing under `node -e`, where argv[1] does not exist at all.
// ─────────────────────────────────────────────────────────────────────────────
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const root = resolve(process.argv[2] ?? '.');
  const findings = [];
  const finding = (line) => findings.push(line);

  const coverageLost = (lines) => {
    console.error(`✗ COVERAGE LOST — ${lines[0]}`);
    for (const l of lines.slice(1)) console.error(`  ${l}`);
    if (findings.length) {
      console.error('  Findings established before the refusal, printed rather than dropped:');
      for (const f of findings) console.error(`    ${f}`);
    }
    process.exit(2);
  };

  // ── THE DUPLICATE-KEY CANARY ──────────────────────────────────────────────
  // Limb 1 is the whole reason this file exists, and it is the one limb whose
  // failure mode is silence: a `timeoutLines` that stopped seeing the second key
  // would report every job bounded exactly once, for ever, over a tree GitHub
  // refuses. So it is exercised on every run against three shapes whose answers
  // are not a matter of opinion — and the negative shape (a step-level key at
  // six spaces) is here because widening the anchor to `\s*` is the obvious
  // "fix" somebody reaches for, and it would count a step's bound as the job's.
  const asLines = (text) => text.split('\n').map((t, i) => ({ n: i + 1, text: t }));
  const CANARY_ONE = asLines('    runs-on: ubuntu-24.04\n    timeout-minutes: 5');
  const CANARY_TWO = asLines('    timeout-minutes: 5\n    runs-on: ubuntu-24.04\n    timeout-minutes: 9');
  const CANARY_STEP = asLines('    steps:\n      - name: x\n        timeout-minutes: 5');
  if (
    timeoutLines(CANARY_ONE).length !== 1 ||
    timeoutLines(CANARY_TWO).length !== 2 ||
    timeoutLines(CANARY_STEP).length !== 0
  ) {
    coverageLost([
      'the duplicate-key DETECTOR no longer tells one job-level key from two.',
      `One key read as ${timeoutLines(CANARY_ONE).length} (must be 1), two read as ${timeoutLines(CANARY_TWO).length} (must be 2),`,
      `a step-level key read as ${timeoutLines(CANARY_STEP).length} (must be 0).`,
      'Until this holds, every "bounded exactly once" verdict below is a presence check wearing',
      'the name of the check that exists to catch what a presence check cannot see.',
    ]);
  }

  // ── the tree ──────────────────────────────────────────────────────────────
  const dir = join(root, WORKFLOW_DIR);
  if (!existsSync(dir)) {
    coverageLost([
      `there is no ${WORKFLOW_DIR} under ${root}.`,
      'A workflow-timeout guard with no workflows to read has checked nothing at all.',
    ]);
  }

  const workflows = parseAllWorkflows(root);
  if (workflows.length === 0) {
    coverageLost([
      `${WORKFLOW_DIR} holds no .yml/.yaml file.`,
      'An empty workflow directory is the shape this guard must never call green: it is the same',
      'output a scan that lost its subject produces.',
    ]);
  }

  // A file that declares `jobs:` and yields none is the reader having lost the
  // file, not a workflow without jobs — GitHub refuses a jobless workflow, so
  // the tree cannot legitimately contain one.
  for (const wf of workflows) {
    if (wf.jobs.size === 0) {
      coverageLost([
        `${wf.rel} parsed to 0 jobs.`,
        wf.jobsAt === null
          ? 'It declares no `jobs:` key at all, which GitHub refuses — so either the file is not a workflow'
          : `Its \`jobs:\` key is at line ${wf.jobsAt} and this scan read no job under it.`,
        'Either way this scan is reading something other than the workflow it opened.',
      ]);
    }
  }

  // ── the merge-blocking closure, derived ───────────────────────────────────
  const gating = new Map(); // rel -> Set(job)
  for (const anchor of GATE_ANCHORS) {
    const wf = workflows.find((w) => w.rel === anchor.rel);
    if (!wf) {
      coverageLost([
        `${anchor.rel} is not in the parsed workflow set.`,
        `The ${anchor.job} closure is how this guard tells a merge-blocking job from a background one.`,
        'With the anchor file gone, every job in this tree would be graded against the looser cap',
        `of ${DEFAULT_CAP} — a silent widening, which is the failure this exit code exists for.`,
      ]);
    }
    if (!wf.jobs.has(anchor.job)) {
      coverageLost([
        `${anchor.rel} has no job \`${anchor.job}\`.`,
        'The required aggregate was renamed or removed. Re-point GATE_ANCHORS at whatever now holds the',
        `merge, or every job in ${anchor.rel} silently drops to the ${DEFAULT_CAP}-minute cap.`,
      ]);
    }
    const through = gatingThroughCalls(workflows, anchor);
    if (through.refusal !== null) {
      coverageLost([
        `${anchor.rel} job \`${through.refusal.job}\` (line ${through.refusal.n}) is in the ${anchor.job} closure and calls ` +
          `${through.refusal.callee}, which this scan cannot follow (${through.refusal.kind}).`,
        'A call job has no timeout of its own; its callee\'s jobs are what hold the merge. With the callee',
        'unread, those jobs would be graded against nothing — so this guard does not report.',
      ]);
    }
    const closure = through.gating.get(anchor.rel);
    if (closure.size < 2) {
      coverageLost([
        `the \`needs\` closure of ${anchor.rel} \`${anchor.job}\` is ${closure.size} job(s).`,
        'An aggregate that needs nothing is an aggregate this scan failed to read the `needs:` of —',
        'the shared reader resolves flow, scalar and block forms, so a closure of one means the walk,',
        'not the workflow, has gone wrong.',
      ]);
    }
    for (const [rel, jobs] of through.gating) {
      const into = gating.get(rel) ?? new Set();
      for (const name of jobs) into.add(name);
      gating.set(rel, into);
    }
  }

  // ── the limbs ─────────────────────────────────────────────────────────────
  let jobCount = 0;
  let unbounded = 0;
  let overCap = 0;

  let callJobs = 0;
  for (const wf of workflows) {
    const closure = gating.get(wf.rel) ?? new Set();
    const anchorName = GATE_ANCHORS.find((a) => a.rel === wf.rel)?.job ?? `${GATE_ANCHORS[0].job}, through a call`;
    const calls = resolveLocalCalls(wf, workflows);
    for (const job of wf.jobs.values()) {
      jobCount++;
      const hits = timeoutLines(job.lines);

      // ⏱ 2026-09-24 — a reusable-workflow CALL is exempt from its own timeout and
      // inherits its callee's: the callee's jobs are graded where that file is read,
      // at the gating cap when the call sits in a gate's closure. A call this scan
      // cannot follow is not graded at all, so it is COVERAGE LOST, not a pass.
      const ref = callRef(job.lines);
      if (ref !== null) {
        if (calls.calls.some((c) => c.job === job.name) && hits.length === 0) {
          callJobs++;
          continue;
        }
        coverageLost([
          `${wf.rel} job \`${job.name}\` calls \`${ref}\`, which this scan cannot follow one level into ` +
            (calls.refusal !== null && calls.refusal.job === job.name ? `(${calls.refusal.kind})` : hits.length ? '(a call carries `timeout-minutes`, which GitHub rejects)' : '(not a local workflow)') +
            '.',
          'Its callee\'s jobs are what bound it; with them unread there is nothing to grade it against.',
        ]);
      }

      if (hits.length === 0) {
        unbounded++;
        finding(
          `${wf.rel} job \`${job.name}\` declares no job-level \`timeout-minutes:\` — it inherits ` +
            "GitHub's 360-minute default, which is six hours of a credentialed runner nobody is watching.",
        );
        continue;
      }

      if (hits.length > 1) {
        unbounded++;
        finding(
          `${wf.rel} job \`${job.name}\` declares \`timeout-minutes:\` ${hits.length} times ` +
            `(lines ${hits.map((h) => h.n).join(', ')}). A duplicate mapping key is merged in silence by ` +
            'every loader that reads this file locally and REFUSED by GitHub, which runs ZERO jobs and ' +
            'reports no reason (traps ci-33). The workflow is not bounded twice; it does not run.',
        );
        continue;
      }

      const raw = timeoutValue(hits[0]);
      if (!isBoundedValue(raw)) {
        unbounded++;
        finding(
          `${wf.rel}:${hits[0].n} job \`${job.name}\` sets \`timeout-minutes: ${raw}\`, which is not a ` +
            'positive integer. A key that is present and unreadable bounds nothing while satisfying every ' +
            'check that only asks whether the key is there.',
        );
        continue;
      }

      const cap = closure.has(job.name) ? GATING_CAP : DEFAULT_CAP;
      if (Number(raw) > cap) {
        overCap++;
        const why = closure.has(job.name)
          ? `it is in the \`needs\` closure of ${anchorName}, so it holds every merge behind it`
          : 'it blocks no merge, so it is graded against the default ceiling';
        finding(
          `${wf.rel}:${hits[0].n} job \`${job.name}\` sets \`timeout-minutes: ${raw}\`, over its cap of ` +
            `${cap} — ${why}. Take the measurement and set the smallest value that covers it; if the real ` +
            `need is above ${DEFAULT_CAP}, move DEFAULT_CAP for every job and write the measurement down. ` +
            'There is no per-job exemption here on purpose.',
        );
      }
    }
  }

  if (jobCount === 0) {
    coverageLost([
      `${workflows.length} workflow(s) parsed to 0 jobs between them.`,
      'Nothing was graded, so nothing about this tree has been established.',
    ]);
  }

  if (findings.length) {
    console.error(
      `✗ workflow timeouts — ${findings.length} finding(s) across ${workflows.length} workflow(s), ${jobCount} job(s):`,
    );
    for (const f of findings) console.error(`  · ${f}`);
    console.error(
      `  Caps: ${GATING_CAP} minutes for a job in the \`needs\` closure of ci.yml ci-gate, followed ` +
        `through a local reusable-workflow call, ${DEFAULT_CAP} for every other job.`,
    );
    process.exit(1);
  }

  const gatingCount = [...gating.values()].reduce((n, s) => n + s.size, 0);
  console.log(
    `ok  workflow timeouts — ${workflows.length} workflow(s), ${jobCount} job(s), ${unbounded} unbounded, ` +
      `${overCap} over cap; every job carries exactly one job-level timeout-minutes at an integer >= 1; ` +
      `${gatingCount} merge-blocking job(s) capped at ${GATING_CAP}, the rest at ${DEFAULT_CAP}` +
      `${callJobs ? `; ${callJobs} reusable-workflow call job(s) bounded by their callee's jobs` : ''}`,
  );
}
