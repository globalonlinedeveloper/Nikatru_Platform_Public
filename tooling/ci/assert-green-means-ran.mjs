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
// Both are the house failure mode: "a check that silently stopped checking". The
// lesson is encoded here rather than in a session note, per CLAUDE.md.
//
// Usage:  node tooling/ci/assert-green-means-ran.mjs [repoRoot]
// Exit 0 = every aggregate verdict is complete and no job can green-skip.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

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
const abs = (rel) => join(ROOT, rel);
const read = (rel) => (existsSync(abs(rel)) ? readFileSync(abs(rel), 'utf8') : null);

/** COVERAGE LOST is fatal on the spot: every remaining check quantifies over the
 *  thing that just went missing, so continuing prints "clean" over nothing. */
function coverageLost(lines) {
  console.error('');
  console.error(`FAIL COVERAGE LOST — ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(`     ${l}`);
  console.error('\nassert-green-means-ran: FAILED');
  process.exit(1);
}

// ── parsing ──────────────────────────────────────────────────────────────────
// Hand-rolled and indentation-based, matching assert-channel-register.mjs and
// assert-release-provenance.mjs. Comments are stripped BOTH full-line and
// trailing, because the two parsers already in the tree diverged on exactly that
// once and an inline-commented job escaped a check that way (review 2026-07-31).
function parseWorkflow(rel) {
  const raw = read(rel);
  if (raw === null) return null;
  const stripped = raw.replace(/^\s*#.*$/gm, '').replace(/\s#.*$/gm, '');
  const lines = stripped.split('\n');
  const jobsAt = lines.findIndex((l) => /^jobs:\s*$/.test(l));
  const jobs = new Map();
  if (jobsAt !== -1) {
    let current = null;
    for (let i = jobsAt + 1; i < lines.length; i++) {
      const line = lines[i];
      if (/^\S/.test(line)) break; // back to top level — jobs: is over
      const m = line.match(/^ {2}([A-Za-z_][A-Za-z0-9_-]*):\s*$/);
      if (m) {
        current = m[1];
        jobs.set(current, []);
      } else if (current !== null) {
        jobs.get(current).push(line);
      }
    }
  }
  const rawTopLevel = (raw.match(/^[a-z]+:/gm) ?? []).length;
  return { rel, jobs, rawTopLevel };
}

/** `needs:` in either flow (`[a, b]`) or block (`- a`) form. */
function jobNeeds(body) {
  const flow = body.match(/^ {4}needs:\s*\[([^\]]*)\]/m);
  if (flow) return flow[1].split(',').map((s) => s.trim()).filter(Boolean);
  const lines = body.split('\n');
  const at = lines.findIndex((l) => /^ {4}needs:\s*$/.test(l));
  if (at === -1) return [];
  const out = [];
  for (const line of lines.slice(at + 1)) {
    const m = line.match(/^\s*-\s*([A-Za-z_][A-Za-z0-9_-]*)\s*$/);
    if (!m) break;
    out.push(m[1]);
  }
  return out;
}

/** The JOB-level `if:` (indent 4), never a step-level one (indent 8). */
function jobIf(body) {
  const m = body.match(/^ {4}if:\s*(.+)$/m);
  return m ? m[1].trim() : null;
}

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
  if (!cache.has(rel)) cache.set(rel, parseWorkflow(rel));
  return cache.get(rel);
}

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
  if (wf.rawTopLevel > 0 && wf.jobs.size === 0) {
    coverageLost([
      `${target.workflow} has ${wf.rawTopLevel} top-level key(s) and ZERO parsed jobs.`,
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

  const bodyLines = wf.jobs.get(target.job);
  const body = bodyLines.join('\n');
  const where = `${target.workflow}: job "${target.job}"`;
  const others = [...wf.jobs.keys()].filter((j) => j !== target.job);
  const needs = jobNeeds(body);

  // A1. `if: always()` — LOAD-BEARING. Without it the aggregate inherits the
  // default success(), reports SKIPPED whenever a lane fails, and GitHub counts
  // a skipped required check as satisfied: branch protection goes green over a
  // red tree and the verdict logic below never executes at all.
  const cond = jobIf(body);
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
    const c = jobIf(wf.jobs.get(j).join('\n'));
    if (c === null) continue;
    problems.push(
      `${target.workflow}: lane "${j}" carries a job-level \`if: ${c}\`, and "${target.job}" aggregates it. ` +
        'Whenever that condition is false the lane resolves to `skipped`, which the aggregate must treat as not-green — so this lane either always runs, or it is not a constituent of the gate. ' +
        'A lane that opts out of the gate on some events is a gate that means different things on different events.',
    );
  }
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
const wfFiles = readdirSync(wfDir).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml')).sort();

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
  for (const [jobName, bodyLines] of wf.jobs) {
    const steps = jobSteps(bodyLines);
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

// ─────────────────────────────────────────────────────────────────────────────
if (problems.length) {
  console.error('');
  for (const p of problems) console.error(`FAIL ${p}`);
  console.error('\nassert-green-means-ran: FAILED');
  process.exit(1);
}

const gates = [...secretGateFiles.values()].reduce((n, xs) => n + xs.length, 0);
console.log(
  `ok  green means ran — ${aggregatorsChecked} aggregating job(s) fail on failure/cancelled/skipped over every lane, ` +
    `${gates} secret-presence check(s) fail closed`,
);
