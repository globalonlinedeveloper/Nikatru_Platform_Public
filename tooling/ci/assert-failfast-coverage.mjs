#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-failfast-coverage.mjs — a gate run cancels ITSELF at its first red job,
// the red job KEEPS ITS OWN `failure` (FF-2), and a job that deploys, publishes,
// releases, submits or migrates never carries the cancel.
//
// Lead ruling FF-1, 2026-09-27, on the owner's words that day: "you always
// cancel it if it's going to fail … it will waste of time for failing
// deployments". FF-1 (#1010) put the cancel in the LAST step of every gate job,
// `if: failure()`. That step ran while its own job was still in progress, so
// GitHub cancelled the red job along with the rest: measured 2026-09-28 on six
// PR runs (36385207366, 36385190242, 36385455698, 36384843524, 36381560476,
// 36383273759), every job read `cancelled` except the aggregators, the real red
// jobs were found only by reading annotations, and `gh run view --log-failed`
// returned nothing.
//
// FF-2 (lead ruling 2026-09-28) moves the cancel OUT of the red job. Every gate
// job `<lane>` has a follow-up job right after it:
//
//     ff-<lane>:
//       needs: <lane>
//       if: failure() && needs.<lane>.result == 'failure'
//       permissions: { actions: write }
//       steps: one `run:` — the ::notice naming <lane>, then
//              gh run cancel "$GITHUB_RUN_ID" --repo "$GITHUB_REPOSITORY" || true
//
// GitHub starts a job only after every job it `needs` has CONCLUDED, so the
// lane's `failure` is recorded before the cancel is sent: the lane reads failure
// and only the jobs still running read cancelled. The `needs.<lane>.result`
// clause keeps a follow-up quiet when an ANCESTOR of its lane failed (`failure()`
// alone is true then, and every follow-up downstream would cancel again, naming
// a lane that only skipped). A matrix lane runs `fail-fast: true`: the follow-up
// needs the WHOLE matrix, so without it the siblings of a red leg would run to
// the end before anything cancels (FF-1 cancelled them at once; so does this).
//
// WHY NOT ONE fail-fast JOB OVER EVERY LANE: a job starts only after ALL of its
// `needs` have concluded, so `needs: [every lane]` + `if: failure()` would start
// when the slowest lane ends — exactly the minutes FF-1 exists to save. WHY NOT A
// DETACHED CANCEL FROM THE RED JOB: the runner kills a job's orphan processes and
// the hosted VM is discarded after the job, so a delayed cancel is a race with an
// unmeasured deadline. docs/ci/README.md §2.1.
//
// It is safe on main because ci.yml's ci-gate needs every lane, runs `always()`
// and treats `cancelled` as red, and deploy-web / deploy-workers need ci-gate.
//
// Asserts, over SCOPE below and over every other workflow in the tree:
//   C1 every in-scope gate job has exactly one follow-up `ff-<lane>` in the
//      FF-2 class (workflow-scan failFastLane), under its scope's exact `if:`,
//      whose step exports GH_TOKEN from `github.token` and RED_JOB = the lane,
//      prints the ::notice, and runs where a job with no checkout can.
//   C2 a follow-up grants exactly `actions: write` at JOB level. It checks
//      nothing out, so it needs no other scope.
//   C3 a call job whose callee holds a follow-up grants `actions: write`. A
//      callee job cannot hold more than its call job grants, and GitHub refuses
//      the WHOLE run at startup when one asks: no job runs and no check reports.
//   C4 no cancel runs INSIDE a job that is not a follow-up — the FF-1 shape,
//      which reports the red job cancelled — no deploy-type job anywhere carries
//      a cancel, and no workflow outside SCOPE carries one.
//   C5 every EXCEPTION names a real in-scope job, says why, and its kind still
//      holds on the tree (an aggregator still runs `always()` over its needs, a
//      sole job is still alone, a not-on-pull-request job still says so).
//   C6 every `ff-` job is in the FF-2 class and follows a lane C1 grades: a
//      follow-up of a deploy job or an exception is a cancel nothing licensed.
//   C7 `actions: write` goes only where the cancel needs it: never at the
//      workflow level of an in-scope file, never on a lane, never on a job that
//      is neither a follow-up nor a call into a callee that holds one.
//   C8 a matrix lane runs `fail-fast` under its scope's condition (above).
//   C9 THE RUN, SIMULATED: for every graded lane, simulateRedRun() plays the
//      run in which that lane goes red, by GitHub's ordering (a job's own steps
//      run before it concludes; a job that needs it starts after). The lane must
//      conclude `failure`, a follow-up must send the cancel, and every other
//      running job must read cancelled. The FF-1 shape concludes `cancelled`.
//
// DEPLOY-TYPE IS DERIVED, NEVER LISTED: a job whose ID matches DEPLOY_TYPE, a
// call into a workflow whose file name matches it, a job that declares
// `environment:`, or a job whose steps publish (workflow-scan.mjs
// classifyPublishes). The ID, not the display `name:` — guards-store's display
// name says "release" and it releases nothing.
//
// ⚠️ WHAT THIS DOES NOT COVER, stated rather than implied. A job that hits its
// `timeout-minutes` is marked cancelled, so its follow-up's `if:` is false and it
// cancels nothing; ci-gate still reads it red. And C9 simulates GitHub's
// documented ordering on the committed tree; that GitHub keeps that ordering is
// proved by a real red run, which the FF-2 pull request carries (docs/ci/README.md
// §2.1 names it).
//
// Usage:  node tooling/ci/assert-failfast-coverage.mjs [repoRoot]
// Exit 0 = covered. 1 = a finding. 2 = COVERAGE LOST: no workflow directory, a
//      SCOPE workflow missing or jobless, a local call this scan cannot follow,
//      or the step reader and an independent line count disagreeing about how
//      many cancels the tree holds.
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  WORKFLOW_DIR,
  parseAllWorkflows,
  resolveLocalCalls,
  workflowEvents,
  workflowSteps,
  jobEnvironment,
  classifyPublishes,
  failFastLane,
  FAILFAST_CANCEL,
  FAILFAST_IF,
} from './workflow-scan.mjs';

export const CANCEL_COMMAND = FAILFAST_CANCEL;
export const TOKEN_EXPR = '${{ github.token }}';
export const FOLLOW_UP = (lane) => `ff-${lane}`;
/** The follow-up's exact job-level `if:` for `lane` in a workflow of scope `runs`. */
export const CONDITION = {
  every: (lane) => FAILFAST_IF(lane),
  pull_request: (lane) => `${FAILFAST_IF(lane)} && github.event_name == 'pull_request'`,
};
/** A matrix lane's exact `fail-fast:` value in a workflow of scope `runs`. */
export const MATRIX_FAIL_FAST = {
  every: 'true',
  pull_request: "${{ github.event_name == 'pull_request' }}",
};
export const DEPLOY_TYPE = /deploy|publish|release|submit|migrat|upload/i;

/** The workflows FF-2 covers, and on which runs. `every`: the follow-ups fire on
 *  any event the workflow (or, for a callee, its caller) runs on. `pull_request`:
 *  the workflow publishes on its other events, so they fire on a pull_request run
 *  only. Everything else in .github/workflows is out of scope and must carry no
 *  cancel at all (C4) — ops-watch, e2e, every deploy-*, submit-*,
 *  redeploy-stranded and renovate among them. */
export const SCOPE = [
  { rel: '.github/workflows/ci.yml', runs: 'every', why: 'the merge gate: ci-gate needs every job and reads cancelled as red, and the deploys need ci-gate' },
  { rel: '.github/workflows/lane-workers.yml', runs: 'every', why: "called by ci.yml `lane-workers`; its jobs report inside ci.yml's run" },
  {
    rel: '.github/workflows/extensions-ci.yml',
    runs: 'every',
    why: "called by ci.yml `extensions`, and by extensions.yml `ci` on a lane=ci dispatch, whose `if:` excludes the release and store-publish lanes, so no publish job is ever in a run this step cancels",
  },
  { rel: '.github/workflows/codeql.yml', runs: 'every', why: 'a gate-shaped lane on pull_request and push' },
  { rel: '.github/workflows/build-platforms.yml', runs: 'pull_request', why: 'it publishes on push, tag and dispatch; a pull_request run publishes nothing' },
  { rel: '.github/workflows/extensions.yml', runs: 'pull_request', why: 'it releases and store-publishes on tag and dispatch; a pull_request run publishes nothing' },
];

/** In-scope jobs that have no follow-up, each with the kind C5 re-checks on the tree. */
export const EXCEPTIONS = [
  { rel: '.github/workflows/ci.yml', job: 'ci-gate', kind: 'aggregator', why: 'the verdict: it starts after every constituent has finished, so nothing is left to cancel, and after a cancel it is the job that must still run and go red' },
  { rel: '.github/workflows/lane-workers.yml', job: 'lane-verdict', kind: 'aggregator', why: "the lane's verdict, read by ci-gate through the call job" },
  { rel: '.github/workflows/extensions-ci.yml', job: 'ci-required', kind: 'aggregator', why: "the lane's verdict, read by ci-gate through the call job" },
  { rel: '.github/workflows/extensions.yml', job: 'extensions-lane-accounting', kind: 'aggregator', why: "the workflow's verdict over every lane" },
  {
    rel: '.github/workflows/codeql.yml',
    job: 'analyze',
    kind: 'sole-job',
    why: 'the only job in its run, with no matrix: a cancel from it reaches no other job, and would put actions: write beside security-events: write for no minute saved',
  },
  { rel: '.github/workflows/extensions.yml', job: 'cws-token-keepalive', kind: 'not-on-pull-request', why: 'schedule only: it is never in the one kind of extensions.yml run FF-2 may cancel' },
  { rel: '.github/workflows/extensions.yml', job: 'store-key-keepalive', kind: 'not-on-pull-request', why: 'schedule only: it is never in the one kind of extensions.yml run FF-2 may cancel' },
  { rel: '.github/workflows/extensions.yml', job: 'attest', kind: 'not-on-pull-request', why: 'needs `release`, which runs only on a tag or a lane=release dispatch: never in the one kind of extensions.yml run FF-2 may cancel (O-RELEASES-HAVE-NO-PROVENANCE)' },
];

/** A `permissions:` key at `indent` spaces in `lines`, as `{ n, all, scopes }`
 *  (`all` is 'read' | 'write' for read-all / write-all, else null), or null when
 *  the key is absent. The flow form `{ contents: read }` and the block form are
 *  both read; `{}` is an empty map. */
export function readPermissions(lines, indent) {
  const head = new RegExp(`^ {${indent}}permissions:\\s*(.*?)\\s*$`);
  const at = lines.findIndex((l) => head.test(l.text));
  if (at === -1) return null;
  const inline = lines[at].text.match(head)[1];
  const out = { n: lines[at].n, all: null, scopes: new Map() };
  if (inline === 'read-all') out.all = 'read';
  else if (inline === 'write-all') out.all = 'write';
  else if (inline.startsWith('{')) {
    for (const e of inline.replace(/^\{|\}$/g, '').split(',')) {
      const m = e.match(/^\s*([a-z-]+)\s*:\s*([a-z]+)\s*$/);
      if (m) out.scopes.set(m[1], m[2]);
    }
  } else if (inline === '') {
    const child = new RegExp(`^ {${indent + 2}}([a-z-]+):\\s*([a-z]+)\\s*$`);
    for (const l of lines.slice(at + 1)) {
      if (l.text.trim() === '') continue;
      const m = l.text.match(child);
      if (!m) break;
      out.scopes.set(m[1], m[2]);
    }
  }
  return out;
}

/** The level `p` grants `scope`, or null when there is no block at all. */
export const levelOf = (p, scope) => (p === null ? null : (p.all ?? p.scopes.get(scope) ?? 'none'));

const CANCEL_RUN = /(?:^|[\s;&|(])gh\s+run\s+cancel\b|\/actions\/runs\/\S*\/(?:force-)?cancel\b/;
const unquote = (s) => String(s ?? '').replace(/^['"]|['"]$/g, '');

/** What kind of cancel a step is: 'inline' (a `run:` that cancels), 'foreign'
 *  (an action named for cancelling — FF-1's retired composite among them), or null. */
export function cancelKind(step) {
  const uses = unquote(step.uses);
  if (uses !== '' && !uses.startsWith('./.github/workflows/') && /cancel/i.test(uses.split('@')[0])) return 'foreign';
  if (step.run !== null && CANCEL_RUN.test(step.run.text)) return 'inline';
  return null;
}

/** The same question asked of ONE raw (comment-blanked) line, independently of
 *  the step reader. Summed over the tree it must equal the reader's count, or
 *  the reader has stopped seeing a shape and C4 would pass over it in silence. */
export function rawCancelLine(text) {
  const m = text.match(/^\s*(?:-\s+)?uses:\s*(\S+)/);
  if (m) {
    const ref = unquote(m[1]);
    return ref.startsWith('./.github/workflows/') ? false : /cancel/i.test(ref.split('@')[0]);
  }
  return CANCEL_RUN.test(text);
}

/** Why `job` is deploy-type, or null. See the header: derived, never listed. */
export function deployReason(job, call) {
  if (DEPLOY_TYPE.test(job.name)) return `its id matches ${DEPLOY_TYPE}`;
  if (call && DEPLOY_TYPE.test(basename(call.callee.rel))) return `it calls ${call.callee.rel}`;
  const env = jobEnvironment(job);
  if (env !== null) return `it declares \`environment: ${env.name}\``;
  const pub = classifyPublishes(job);
  if (pub.length) return `it runs ${pub[0].what} at :${pub[0].n}`;
  return null;
}

/** Does exception `e` still hold on `wf` / `job`? A reason string when it does not. */
function exceptionBroken(e, wf, job, scope) {
  if (e.kind === 'aggregator') {
    if (!/\balways\(\)/.test(job.jobIf?.cond ?? '') || job.needs.length === 0) {
      return 'an aggregator runs `if: always()` over its needs, and this job no longer does';
    }
    return null;
  }
  if (e.kind === 'sole-job') {
    if (wf.jobs.size !== 1) return `a sole job is alone in its run, and ${wf.rel} now has ${wf.jobs.size} jobs — every other one is a job the cancel would reach`;
    if (job.lines.some((l) => /^ {4}strategy:/.test(l.text))) return 'a sole job has no matrix, and this one now has a `strategy:` — its legs are jobs the cancel would reach';
    return null;
  }
  if (e.kind === 'not-on-pull-request') {
    if (scope?.runs !== 'pull_request') return 'this kind exists only in a workflow scoped to pull_request runs';
    if (job.jobIf === null || /pull_request/.test(job.jobIf.cond)) {
      return `its \`if:\` (${job.jobIf?.cond ?? 'none'}) no longer keeps it out of a pull_request run`;
    }
    return null;
  }
  return `unknown kind "${e.kind}" (aggregator, sole-job, not-on-pull-request)`;
}

/** The `fail-fast:` value of a matrix job, `null` when it declares none (GitHub's
 *  default is true), or undefined when the job has no `strategy:`. */
export function matrixFailFast(job) {
  const at = job.lines.findIndex((l) => /^ {4}strategy:\s*$/.test(l.text));
  if (at === -1) return undefined;
  for (const l of job.lines.slice(at + 1)) {
    if (l.text.trim() === '') continue;
    if (!/^ {6}/.test(l.text)) break;
    const m = l.text.match(/^ {6}fail-fast:\s*(.*?)\s*$/);
    if (m) return m[1];
  }
  return null;
}

const runsOnFailure = (cond) => /\b(?:failure|always)\s*\(\s*\)/.test(cond ?? '');

/**
 * C9. The run in which job `lane` of `wf` goes red at its first step, played by
 * GitHub's ordering, as `{ conclusion, canceller, others }`:
 *   · the lane's remaining steps run while the lane is IN PROGRESS; one that
 *     cancels the run (a failure()/always() step — the FF-1 shape) cancels the
 *     lane with everything else, so the lane concludes `cancelled`;
 *   · otherwise the lane concludes `failure`, and only THEN may a job that needs
 *     it start: its follow-up (failFastLane) sends the cancel;
 *   · once a cancel is sent, every other job reads `cancelled`, except an
 *     aggregator (`always()`), which still runs and reads the red, and another
 *     lane's follow-up, which is skipped.
 * `canceller` is the job that sent the cancel, or null (the rest runs to the end).
 */
export function simulateRedRun(wf, lane) {
  const job = wf.jobs.get(lane);
  const selfCancels = workflowSteps(job)
    .slice(1)
    .some((s) => cancelKind(s) !== null && runsOnFailure(s.cond));
  let canceller = selfCancels ? lane : null;
  const conclusion = selfCancels ? 'cancelled' : 'failure';
  if (canceller === null) {
    for (const [id] of wf.jobs) {
      if (failFastLane(wf, id) === lane) {
        canceller = id;
        break;
      }
    }
  }
  const others = new Map();
  for (const [id, j] of wf.jobs) {
    if (id === lane) continue;
    if (canceller === null) others.set(id, 'unaffected');
    else if (id === canceller) others.set(id, 'success');
    else if (failFastLane(wf, id) !== null) others.set(id, 'skipped');
    else if (/\balways\(\)/.test(j.jobIf?.cond ?? '')) others.set(id, 'failure');
    else others.set(id, 'cancelled');
  }
  return { conclusion, canceller, others };
}

/**
 * The whole grading, as data. `{ findings, lost, stats }`: `lost` non-empty is
 * COVERAGE LOST (exit 2), `findings` non-empty is exit 1.
 */
export function gradeFailfast(root, { scope = SCOPE, exceptions = EXCEPTIONS } = {}) {
  const findings = [];
  const lost = [];
  const stats = { workflows: 0, graded: 0, followUps: 0, cancels: 0, exceptions: 0, deployType: 0, calls: 0, inactive: 0, simulated: 0 };
  const out = { findings, lost, stats };

  if (!existsSync(join(root, WORKFLOW_DIR))) {
    lost.push(`there is no ${WORKFLOW_DIR} under ${root}; a fail-fast guard with no workflows has checked nothing.`);
    return out;
  }
  const all = parseAllWorkflows(root);
  stats.workflows = all.length;
  if (all.length === 0) {
    lost.push(`${WORKFLOW_DIR} holds no workflow file — the same output a scan that lost its subject produces.`);
    return out;
  }
  const byRel = new Map(all.map((w) => [w.rel, w]));
  const scopeOf = new Map(scope.map((s) => [s.rel, s]));

  for (const s of scope) {
    const wf = byRel.get(s.rel);
    if (!wf) lost.push(`${s.rel} is in SCOPE and not in the tree. Re-point SCOPE at what now runs that gate, or the jobs it held are graded by nothing.`);
    else if (wf.jobs.size === 0) lost.push(`${s.rel} parsed to 0 jobs; this scan is reading something other than the workflow it opened.`);
  }

  const callsOf = new Map();
  for (const wf of all) {
    const r = resolveLocalCalls(wf, all);
    if (r.refusal) lost.push(`${wf.rel}:${r.refusal.n} job \`${r.refusal.job}\` makes a local call this scan cannot follow (${r.refusal.kind}: ${r.refusal.callee}).`);
    callsOf.set(wf.rel, r.calls);
  }
  if (lost.length) return out;

  // ── the census: every cancel in the tree, read twice, independently ────────
  const carried = new Map(); // `${rel}#${job}` -> [{ step, kind }]
  let structured = 0;
  let raw = 0;
  for (const wf of all) {
    raw += wf.lines.filter((l) => rawCancelLine(l.text)).length;
    for (const job of wf.jobs.values()) {
      for (const step of workflowSteps(job)) {
        const kind = cancelKind(step);
        if (kind === null) continue;
        structured += 1;
        const key = `${wf.rel}#${job.name}`;
        if (!carried.has(key)) carried.set(key, []);
        carried.get(key).push({ step, kind });
      }
    }
  }
  if (raw !== structured) {
    lost.push(
      `the step reader found ${structured} cancel step(s) and a line count found ${raw}. They must agree: ` +
        'a cancel the reader cannot see is a cancel C4 cannot refuse, in a deploy job, in a red job, or anywhere else.',
    );
    return out;
  }
  stats.cancels = structured;

  const callOf = (wf, job) => (callsOf.get(wf.rel) ?? []).find((c) => c.job === job.name) ?? null;

  // ── C4: no cancel inside a red job, outside SCOPE, or in a deploy-type job ──
  for (const [key, list] of carried) {
    const [rel, jobName] = key.split('#');
    const wf = byRel.get(rel);
    const job = wf.jobs.get(jobName);
    const why = deployReason(job, callOf(wf, job));
    for (const c of list) {
      if (why !== null) {
        findings.push(`${rel}:${c.step.first} job \`${jobName}\` is deploy-type (${why}) and carries a cancel. A half-finished deploy is worse than a red one: remove the step.`);
      } else if (!scopeOf.has(rel)) {
        findings.push(`${rel}:${c.step.first} job \`${jobName}\` carries a cancel, and ${rel} is not in FF-2's SCOPE. Remove it, or scope the workflow in this guard with a why.`);
      } else if (failFastLane(wf, jobName) === null) {
        findings.push(
          `${rel}:${c.step.first} job \`${jobName}\` cancels the run from INSIDE itself — the FF-1 shape. The cancel lands while the job is still running, so GitHub reports ` +
            `THIS job cancelled too and the run names no red job. Remove the step; the cancel belongs to its follow-up \`${FOLLOW_UP(jobName)}\` (FF-2).`,
        );
      }
    }
  }

  // ── C5: every exception is real, reasoned, and still true ──────────────────
  for (const e of exceptions) {
    const wf = byRel.get(e.rel);
    const job = wf?.jobs.get(e.job);
    if (!scopeOf.has(e.rel)) findings.push(`EXCEPTION ${e.rel}#${e.job} names a workflow outside SCOPE; it excuses nothing and must go.`);
    else if (!job) findings.push(`EXCEPTION ${e.rel}#${e.job} names a job that no longer exists — a stale licence nobody is watching. Remove it.`);
    else {
      if (!String(e.why ?? '').trim()) findings.push(`EXCEPTION ${e.rel}#${e.job} carries no why.`);
      const broken = exceptionBroken(e, wf, job, scopeOf.get(e.rel));
      if (broken) findings.push(`EXCEPTION ${e.rel}#${e.job} (${e.kind}) no longer holds: ${broken}.`);
    }
  }

  // ── C1, C2, C3, C6, C7, C8, C9 over the in-scope workflows ─────────────────
  for (const s of scope) {
    const wf = byRel.get(s.rel);
    const header = wf.lines.slice(0, (wf.jobsAt ?? wf.lines.length + 1) - 1);
    const wfPerms = readPermissions(header, 0);
    if (levelOf(wfPerms, 'actions') === 'write') {
      findings.push(`${s.rel}:${wfPerms.n} grants \`actions: write\` at the WORKFLOW level, so every job holds it. Grant it on the follow-up jobs, and only there.`);
    }
    // A job with no checkout has an empty workspace: a workflow-level run
    // directory other than `.` does not exist there, and the step would die on it.
    const wfDir = (() => {
      const at = header.findIndex((l) => /^defaults:\s*$/.test(l.text));
      if (at === -1) return null;
      const m = header.slice(at + 1).find((l) => /^ {4}working-directory:/.test(l.text));
      return m ? unquote(m.text.replace(/^ {4}working-directory:\s*/, '').trim()) : null;
    })();
    const inactive = s.runs === 'pull_request' && !workflowEvents(wf).has('pull_request');
    const gradedLanes = new Set();

    for (const job of wf.jobs.values()) {
      // job.lines starts BELOW the job key, so the key's own line is one above it.
      const at = `${s.rel}:${(job.lines[0]?.n ?? wf.jobsAt + 1) - 1} job \`${job.name}\``;
      const call = callOf(wf, job);
      const perms = readPermissions(job.lines, 4);
      const writes = levelOf(perms, 'actions') === 'write';
      if (/^ff-/.test(job.name)) continue; // follow-ups are graded below, from their lane
      if (deployReason(job, call) !== null) {
        stats.deployType += 1;
        continue; // C4 above has already refused a cancel here; C6 refuses a follow-up
      }
      if (call) {
        stats.calls += 1;
        const calleeHolds = [...call.callee.jobs.keys()].some((id) => failFastLane(call.callee, id) !== null);
        if (!scopeOf.has(call.callee.rel)) {
          findings.push(`${at} calls ${call.callee.rel}, whose jobs run inside this run and are not in FF-2's SCOPE. Scope it here, or say why it is out.`);
        }
        if (calleeHolds && !writes) {
          findings.push(
            `${at} calls ${call.callee.rel}, whose jobs have FF-2 follow-ups, and grants ${perms === null ? 'no job-level permissions' : `\`actions: ${levelOf(perms, 'actions')}\``}. ` +
              'A callee job cannot hold more than its call job grants, and GitHub refuses the whole run at startup when one asks.',
          );
        }
        if (!calleeHolds && writes) findings.push(`${at} grants \`actions: write\` and its callee holds no FF-2 follow-up — a write scope nothing uses.`);
        continue;
      }
      // C7 — a lane never cancels, so it never needs the scope.
      if (writes) {
        findings.push(`${s.rel}:${perms.n} job \`${job.name}\` grants \`actions: write\`. Under FF-2 no lane cancels anything; its follow-up does, and holds the scope. Remove it.`);
      }
      const exception = exceptions.find((e) => e.rel === s.rel && e.job === job.name);
      if (exception || inactive) {
        if (exception) stats.exceptions += 1;
        else stats.inactive += 1;
        continue; // C6 below refuses a follow-up of this job
      }

      stats.graded += 1;
      gradedLanes.add(job.name);
      // C8
      const failFast = matrixFailFast(job);
      if (failFast !== undefined && failFast !== null && failFast !== MATRIX_FAIL_FAST[s.runs]) {
        findings.push(
          `${at} is a matrix with \`fail-fast: ${failFast}\`; in ${s.rel} it must be \`${MATRIX_FAIL_FAST[s.runs]}\`. Its follow-up needs the WHOLE matrix, so with fail-fast off ` +
            'the siblings of a red leg run to the end before the cancel is sent — the minutes FF-1 exists to save.',
        );
      }
      // C1 — exactly one follow-up
      const ups = [...wf.jobs.keys()].filter((id) => failFastLane(wf, id) === job.name);
      if (ups.length === 0) {
        findings.push(
          `${at} has no FF-2 follow-up. Add job \`${FOLLOW_UP(job.name)}\` after it: \`needs: ${job.name}\`, \`if: ${CONDITION[s.runs](job.name)}\`, ` +
            `\`permissions: { actions: write }\`, and one \`run:\` step — the ::notice, then \`${CANCEL_COMMAND} || true\` with GH_TOKEN and RED_JOB in its env.`,
        );
        continue;
      }
      if (ups.length > 1) findings.push(`${at} has ${ups.length} follow-ups (${ups.join(', ')}); one cancel per lane is the rule.`);
      // C9 — the run in which this lane goes red
      const sim = simulateRedRun(wf, job.name);
      stats.simulated += 1;
      const stillRunning = [...sim.others].filter(([, c]) => c === 'unaffected').map(([id]) => id);
      if (sim.conclusion !== 'failure') {
        findings.push(`${at}: a run in which it goes red reports it \`${sim.conclusion}\`, not \`failure\` — the run would name no red job (FF-2).`);
      } else if (sim.canceller === null || stillRunning.length) {
        findings.push(`${at}: a run in which it goes red is never cancelled, so ${stillRunning.length} job(s) run on to the end (FF-1's saving lost).`);
      }
    }

    // ── C1 form, C2, C6: every `ff-` job ──────────────────────────────────────
    for (const job of wf.jobs.values()) {
      if (!/^ff-/.test(job.name)) continue;
      const at = `${s.rel}:${(job.lines[0]?.n ?? wf.jobsAt + 1) - 1} job \`${job.name}\``;
      const lane = failFastLane(wf, job.name);
      if (lane === null) {
        findings.push(
          `${at} is named as an FF-2 follow-up and is not one (workflow-scan failFastLane): it must need exactly \`${job.name.slice(3)}\`, ` +
            `open its \`if:\` with \`${FAILFAST_IF(job.name.slice(3))}\`, and hold ONE \`run:\` step of the ::notice and the cancel — nothing a verdict could need.`,
        );
        continue;
      }
      if (!gradedLanes.has(lane)) {
        findings.push(`${at} follows \`${lane}\`, which FF-2 does not grade (deploy-type, a call, a declared exception, or a workflow with no pull_request trigger). A cancel nothing licensed: remove it.`);
        continue;
      }
      stats.followUps += 1;
      const want = CONDITION[s.runs](lane);
      if (job.jobIf.cond !== want) findings.push(`${at}: its \`if:\` is \`${job.jobIf.cond}\`; in ${s.rel} it must be exactly \`${want}\` (${s.why}).`);
      const [step] = workflowSteps(job);
      const token = unquote(step.env.get('GH_TOKEN')?.value);
      if (token.replace(/\s+/g, '') !== TOKEN_EXPR.replace(/\s+/g, '')) findings.push(`${at}: the step must map \`GH_TOKEN: ${TOKEN_EXPR}\`, or gh has no credential and the cancel is a no-op.`);
      if (unquote(step.env.get('RED_JOB')?.value) !== lane) findings.push(`${at}: the step must map \`RED_JOB: ${lane}\` — the notice is the run's pointer to the red job.`);
      if (!/::notice[^\n]*\$\{?RED_JOB\b/.test(step.run.text)) findings.push(`${at}: the step no longer prints the ::notice naming \$RED_JOB — after the cancel, it is the run summary's pointer to the red job.`);
      const stepLines = wf.lines.filter((l) => l.n >= step.first && l.n <= step.last).map((l) => l.text);
      const dir = stepLines.map((t) => t.match(/^ {8}working-directory:\s*(.*?)\s*$/)).find(Boolean)?.[1] ?? wfDir;
      if (dir !== null && unquote(dir) !== '.') {
        findings.push(`${at}: its step runs in \`${unquote(dir)}\`, which a job with no checkout does not have. Set \`working-directory: .\` on the step.`);
      }
      // C2
      const perms = readPermissions(job.lines, 4);
      const scopes = perms === null ? [] : perms.all ? [`${perms.all}-all`] : [...perms.scopes].map(([k, v]) => `${k}: ${v}`);
      if (scopes.length !== 1 || scopes[0] !== 'actions: write') {
        findings.push(`${at} grants ${scopes.length ? `\`${scopes.join(', ')}\`` : 'no job-level permissions'}; a follow-up grants exactly \`actions: write\` — it checks nothing out and cancels with the job's own token.`);
      }
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Everything below runs only when this file is the entry point: the test suite
// imports the pure functions above, and a module-scope process.exit would take
// it down (the pattern assert-workflow-timeouts.mjs records).
// ─────────────────────────────────────────────────────────────────────────────
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const root = resolve(process.argv[2] ?? '.');
  const { findings, lost, stats } = gradeFailfast(root);
  if (lost.length) {
    console.error(`✗ COVERAGE LOST — ${lost[0]}`);
    for (const l of lost.slice(1)) console.error(`  ${l}`);
    if (findings.length) {
      console.error('  Findings established before the refusal, printed rather than dropped:');
      for (const f of findings) console.error(`    ${f}`);
    }
    process.exit(2);
  }
  if (findings.length) {
    console.error(`✗ fail-fast coverage (FF-2) — ${findings.length} problem(s):`);
    for (const f of findings) console.error(`  · ${f}`);
    console.error('  The rule: every gate job `<lane>` has a follow-up `ff-<lane>` that needs it and cancels the run; no job cancels from inside itself, and no deploy-type job cancels at all. docs/ci/README.md §2.1.');
    process.exit(1);
  }
  console.log(
    `ok  fail-fast coverage (FF-2) — ${stats.workflows} workflow(s), ${SCOPE.length} in scope; ${stats.graded} gate job(s), each with one ` +
      `follow-up (${stats.followUps}; ${stats.cancels} cancel(s) in the tree, none inside a red job); ${stats.simulated} red run(s) simulated, each ` +
      `concluding its lane \`failure\` and cancelling the rest; ${stats.calls} call job(s) grant their callee the scope; ${stats.deployType} deploy-type ` +
      `job(s), ${stats.exceptions} declared exception(s) and ${stats.inactive} job(s) of a workflow with no pull_request trigger carry none`,
  );
}
