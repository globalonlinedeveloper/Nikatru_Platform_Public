#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-failfast-coverage.mjs — a gate run cancels ITSELF at its first red job
// (FF-1), and a job that deploys, publishes, releases, submits or migrates never
// carries the cancel.
//
// Lead ruling FF-1, 2026-09-27, on the owner's words that day: "you always
// cancel it if it's going to fail … it will waste of time for failing
// deployments". Until then a laptop script polled every 90 s and cancelled
// doomed runs: it ran only while the laptop was awake, and every poll spent the
// per-repository API limit the guards also spend. The rule now lives in the
// workflows. The LAST step of every gate job is
//
//     - name: A red job cancels the rest of this run (FF-1)
//       if: failure()
//       uses: ./.github/actions/cancel-run-on-red
//
// — ONE API call, made only on failure, and no watcher job. It is safe on main
// because ci.yml's ci-gate needs every job, runs `always()` and treats
// `cancelled` as red, and deploy-web / deploy-workers need ci-gate: once any job
// is red, no deploy can start in that run anyway. docs/ci/README.md §2.1.
//
// Asserts, over SCOPE below and over every other workflow in the tree:
//   C1 every in-scope job ends with the cancel step, under its scope's exact
//      condition — `failure()`, or `failure() && github.event_name ==
//      'pull_request'` in a workflow that publishes on its other events — unless
//      it is deploy-type, a call job, or a declared EXCEPTION. A job with a
//      checkout uses the composite; a job without one runs the command inline.
//   C2 a job carrying the step grants `actions: write` at JOB level and keeps
//      every scope the workflow-level block grants. A job-level block REPLACES
//      the workflow-level one, so a block that forgot `contents: read` would
//      leave the checkout unable to read the repository.
//   C3 a call job whose callee carries the step grants `actions: write`. A
//      callee job cannot hold more than its call job grants, and GitHub refuses
//      the WHOLE run at startup when one asks: no job runs and no check reports.
//   C4 no deploy-type job anywhere carries a cancel, and no workflow outside
//      SCOPE carries one. A half-finished deploy is worse than a red one.
//   C5 every EXCEPTION names a real in-scope job, says why, and its kind still
//      holds on the tree (an aggregator still runs `always()` over its needs, a
//      sole job is still alone, a not-on-pull-request job still says so).
//   C6 the composite still cancels: the command, `|| true`, GH_TOKEN from
//      `github.token`, and the notice naming the job.
//   C7 `actions: write` goes only where the step needs it: never at the
//      workflow level of an in-scope file, never on an in-scope job that neither
//      carries the step nor calls a callee that does.
//
// DEPLOY-TYPE IS DERIVED, NEVER LISTED: a job whose ID matches DEPLOY_TYPE, a
// call into a workflow whose file name matches it, a job that declares
// `environment:`, or a job whose steps publish (workflow-scan.mjs
// classifyPublishes). The ID, not the display `name:` — guards-store's display
// name says "release" and it releases nothing.
//
// ⚠️ WHAT THIS DOES NOT COVER, stated rather than implied. A job that hits its
// `timeout-minutes` is marked cancelled, so `failure()` is false and it cancels
// nothing; ci-gate still reads it red. And the cancel itself is proved only by
// the first real red run after this lands: the owner's rule is no deliberately
// red pull request, so the tests below prove the WIRING, on a copy of the tree.
//
// Usage:  node tooling/ci/assert-failfast-coverage.mjs [repoRoot]
// Exit 0 = covered. 1 = a finding. 2 = COVERAGE LOST: no workflow directory, a
//      SCOPE workflow missing or jobless, the composite missing, a local call
//      this scan cannot follow, or the step reader and an independent line count
//      disagreeing about how many cancels the tree holds.
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  WORKFLOW_DIR,
  parseAllWorkflows,
  parseWorkflow,
  resolveLocalCalls,
  workflowEvents,
  workflowSteps,
  jobEnvironment,
  classifyPublishes,
} from './workflow-scan.mjs';

export const ACTION_REF = './.github/actions/cancel-run-on-red';
export const ACTION_REL = '.github/actions/cancel-run-on-red/action.yml';
export const CANCEL_COMMAND = 'gh run cancel "$GITHUB_RUN_ID" --repo "$GITHUB_REPOSITORY"';
export const TOKEN_EXPR = '${{ github.token }}';
export const CONDITION = {
  every: 'failure()',
  pull_request: "failure() && github.event_name == 'pull_request'",
};
export const DEPLOY_TYPE = /deploy|publish|release|submit|migrat|upload/i;

/** The workflows FF-1 covers, and on which runs. `every`: the step fires on any
 *  event the workflow (or, for a callee, its caller) runs on. `pull_request`: the
 *  workflow publishes on its other events, so the step fires on a pull_request
 *  run only. Everything else in .github/workflows is out of scope and must carry
 *  no cancel at all (C4) — ops-watch, e2e, every deploy-*, submit-*,
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

/** In-scope jobs that carry no step, each with the kind C5 re-checks on the tree. */
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
  { rel: '.github/workflows/extensions.yml', job: 'cws-token-keepalive', kind: 'not-on-pull-request', why: 'schedule only: it is never in the one kind of extensions.yml run FF-1 may cancel' },
  { rel: '.github/workflows/extensions.yml', job: 'store-key-keepalive', kind: 'not-on-pull-request', why: 'schedule only: it is never in the one kind of extensions.yml run FF-1 may cancel' },
];

const LEVEL = { none: 0, read: 1, write: 2 };

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

/** What kind of cancel a step is: 'action' (the composite), 'inline' (a `run:`
 *  that cancels), 'foreign' (some other action named for cancelling), or null. */
export function cancelKind(step) {
  const uses = unquote(step.uses);
  if (uses === ACTION_REF) return 'action';
  if (uses !== '' && /cancel/i.test(uses.split('@')[0])) return 'foreign';
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
    return ref === ACTION_REF || (ref.startsWith('./.github/workflows/') ? false : /cancel/i.test(ref.split('@')[0]));
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

/** The composite's own lines, graded (C6). Returns `{ lost, problems }`. */
export function gradeAction(root) {
  const parsed = parseWorkflow(root, ACTION_REL);
  if (parsed === null) return { lost: `${ACTION_REL} is not in the tree, so every step that names it cancels nothing.`, problems: [] };
  const text = parsed.lines.map((l) => l.text);
  const problems = [];
  const want = (ok, what) => {
    if (!ok) problems.push(`${ACTION_REL}: ${what}`);
  };
  want(text.some((t) => /^ {2}using:\s*['"]?composite['"]?\s*$/.test(t)), 'is no longer a composite action (`runs: using: composite`)');
  const cmd = CANCEL_COMMAND.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  want(text.some((t) => new RegExp(`(?:^|\\s)${cmd}\\s*\\|\\|\\s*true\\s*$`).test(t)), `no longer runs \`${CANCEL_COMMAND} || true\` — a cancel that can fail the job, or no cancel at all`);
  want(text.some((t) => /^\s+GH_TOKEN:\s*\$\{\{\s*github\.token\s*\}\}\s*$/.test(t)), `no longer maps \`GH_TOKEN: ${TOKEN_EXPR}\`, so gh has no credential and the cancel is a no-op`);
  want(text.some((t) => /::notice[^\n]*GITHUB_JOB/.test(t)), 'no longer prints the ::notice naming the job that went red — after the cancel, that job is the only pointer to the culprit');
  return { lost: null, problems };
}

/**
 * The whole grading, as data. `{ findings, lost, stats }`: `lost` non-empty is
 * COVERAGE LOST (exit 2), `findings` non-empty is exit 1.
 */
export function gradeFailfast(root, { scope = SCOPE, exceptions = EXCEPTIONS } = {}) {
  const findings = [];
  const lost = [];
  const stats = { workflows: 0, graded: 0, carriers: 0, exceptions: 0, deployType: 0, calls: 0, inactive: 0 };
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

  const action = gradeAction(root);
  if (action.lost) lost.push(action.lost);
  findings.push(...action.problems);

  const callsOf = new Map();
  for (const wf of all) {
    const r = resolveLocalCalls(wf, all);
    if (r.refusal) lost.push(`${wf.rel}:${r.refusal.n} job \`${r.refusal.job}\` makes a local call this scan cannot follow (${r.refusal.kind}: ${r.refusal.callee}).`);
    callsOf.set(wf.rel, r.calls);
  }
  if (lost.length) return out;

  // ── the census: every cancel in the tree, read twice, independently ────────
  const carried = new Map(); // `${rel}#${job}` -> [{ step, kind, index, count }]
  let structured = 0;
  let raw = 0;
  for (const wf of all) {
    raw += wf.lines.filter((l) => rawCancelLine(l.text)).length;
    for (const job of wf.jobs.values()) {
      const steps = workflowSteps(job);
      steps.forEach((step, index) => {
        const kind = cancelKind(step);
        if (kind === null) return;
        structured += 1;
        const key = `${wf.rel}#${job.name}`;
        if (!carried.has(key)) carried.set(key, []);
        carried.get(key).push({ step, kind, index, count: steps.length });
      });
    }
  }
  if (raw !== structured) {
    lost.push(
      `the step reader found ${structured} cancel step(s) and a line count found ${raw}. They must agree: ` +
        'a cancel the reader cannot see is a cancel C4 cannot refuse, in a deploy job or anywhere else.',
    );
    return out;
  }
  stats.carriers = structured;

  const callOf = (wf, job) => (callsOf.get(wf.rel) ?? []).find((c) => c.job === job.name) ?? null;

  // ── C4: no cancel outside SCOPE, none in a deploy-type job anywhere ─────────
  for (const [key, list] of carried) {
    const [rel, jobName] = key.split('#');
    const wf = byRel.get(rel);
    const job = wf.jobs.get(jobName);
    const why = deployReason(job, callOf(wf, job));
    for (const c of list) {
      if (why !== null) {
        findings.push(`${rel}:${c.step.first} job \`${jobName}\` is deploy-type (${why}) and carries a cancel. A half-finished deploy is worse than a red one: remove the step.`);
      } else if (!scopeOf.has(rel)) {
        findings.push(`${rel}:${c.step.first} job \`${jobName}\` carries a cancel, and ${rel} is not in FF-1's SCOPE. Remove it, or scope the workflow in this guard with a why.`);
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

  // ── C1, C2, C3, C7 over the in-scope workflows ─────────────────────────────
  for (const s of scope) {
    const wf = byRel.get(s.rel);
    const header = wf.lines.slice(0, (wf.jobsAt ?? wf.lines.length + 1) - 1);
    const wfPerms = readPermissions(header, 0);
    if (levelOf(wfPerms, 'actions') === 'write') {
      findings.push(`${s.rel}:${wfPerms.n} grants \`actions: write\` at the WORKFLOW level, so every job holds it. Grant it on the jobs that carry the step, and only there.`);
    }
    const inactive = s.runs === 'pull_request' && !workflowEvents(wf).has('pull_request');
    for (const job of wf.jobs.values()) {
      // job.lines starts BELOW the job key, so the key's own line is one above it.
      const at = `${s.rel}:${(job.lines[0]?.n ?? wf.jobsAt + 1) - 1} job \`${job.name}\``;
      const call = callOf(wf, job);
      const list = carried.get(`${s.rel}#${job.name}`) ?? [];
      const perms = readPermissions(job.lines, 4);
      const writes = levelOf(perms, 'actions') === 'write';
      if (deployReason(job, call) !== null) {
        stats.deployType += 1;
        continue; // C4 above has already refused a cancel here
      }
      if (call) {
        stats.calls += 1;
        const calleeCarries = [...call.callee.jobs.values()].some((cj) => (carried.get(`${call.callee.rel}#${cj.name}`) ?? []).length > 0);
        if (!scopeOf.has(call.callee.rel)) {
          findings.push(`${at} calls ${call.callee.rel}, whose jobs run inside this run and are not in FF-1's SCOPE. Scope it here, or say why it is out.`);
        }
        if (calleeCarries && !writes) {
          findings.push(
            `${at} calls ${call.callee.rel}, whose jobs carry the FF-1 step, and grants ${perms === null ? 'no job-level permissions' : `\`actions: ${levelOf(perms, 'actions')}\``}. ` +
              'A callee job cannot hold more than its call job grants, and GitHub refuses the whole run at startup when one asks.',
          );
        }
        if (!calleeCarries && writes) findings.push(`${at} grants \`actions: write\` and its callee carries no FF-1 step — a write scope nothing uses.`);
        continue;
      }
      const exception = exceptions.find((e) => e.rel === s.rel && e.job === job.name);
      if (exception || inactive) {
        if (exception) stats.exceptions += 1;
        else stats.inactive += 1;
        const what = exception ? `a declared exception (${exception.kind})` : `in ${s.rel}, which has no pull_request trigger — the only run FF-1 may cancel there`;
        for (const c of list) findings.push(`${s.rel}:${c.step.first} job \`${job.name}\` is ${what} and still carries a cancel. Remove the step, or the exception.`);
        if (writes && list.length === 0) findings.push(`${at} is ${what} and grants \`actions: write\` — a write scope nothing uses.`);
        continue;
      }

      stats.graded += 1;
      const want = CONDITION[s.runs];
      const steps = workflowSteps(job);
      const hasCheckout = steps.some((st) => /^actions\/checkout@/.test(unquote(st.uses)));
      if (list.length === 0) {
        findings.push(
          `${at} does not end with the FF-1 step. Append \`- if: ${want}\` + \`uses: ${ACTION_REF}\` as its LAST step` +
            `${hasCheckout ? '' : ' (it has no checkout, so the inline `run:` form)'}, and grant \`actions: write\` on the job.`,
        );
        continue;
      }
      if (list.length > 1) findings.push(`${at} carries ${list.length} cancel steps; one, the last, is the rule.`);
      const c = list.at(-1);
      if (c.index !== c.count - 1) {
        findings.push(`${s.rel}:${c.step.first} job \`${job.name}\`: the FF-1 step is step ${c.index + 1} of ${c.count}, not the last. Every step after it (a failure upload, a !cancelled() guard) must finish before the run is cancelled.`);
      }
      if ((c.step.cond ?? '') !== want) {
        findings.push(`${s.rel}:${c.step.first} job \`${job.name}\`: the FF-1 step's \`if:\` is \`${c.step.cond ?? '(none)'}\`; in ${s.rel} it must be exactly \`${want}\` (${s.why}).`);
      }
      if (c.kind === 'foreign') findings.push(`${s.rel}:${c.step.first} job \`${job.name}\` cancels through \`${c.step.uses}\`; the rule is ${ACTION_REF}, one reviewed command.`);
      if (c.kind === 'action' && !hasCheckout) findings.push(`${s.rel}:${c.step.first} job \`${job.name}\` has no checkout, so \`${ACTION_REF}\` is not on disk when the step runs. Use the inline \`run:\` form.`);
      if (c.kind === 'inline') {
        if (hasCheckout) findings.push(`${s.rel}:${c.step.first} job \`${job.name}\` has a checkout and cancels inline; use \`${ACTION_REF}\`, so the command has one home.`);
        const text = c.step.run.text;
        const token = unquote(c.step.env.get('GH_TOKEN')?.value);
        if (!text.includes(CANCEL_COMMAND) || !/\|\|\s*true\b/.test(text) || token.replace(/\s+/g, '') !== TOKEN_EXPR.replace(/\s+/g, '')) {
          findings.push(`${s.rel}:${c.step.first} job \`${job.name}\`: the inline cancel must be \`${CANCEL_COMMAND} || true\` with \`GH_TOKEN: ${TOKEN_EXPR}\` in the step's env.`);
        }
      }
      // C2
      if (perms === null) {
        findings.push(`${at} carries the FF-1 step and declares no job-level \`permissions:\`, so it cancels with the workflow's token, which cannot. Grant \`actions: write\` on the job.`);
        continue;
      }
      if (!writes) findings.push(`${s.rel}:${perms.n} job \`${job.name}\` carries the FF-1 step and grants \`actions: ${levelOf(perms, 'actions')}\`; the cancel needs \`actions: write\`.`);
      for (const [scopeName, level] of wfPerms?.scopes ?? []) {
        const mine = levelOf(perms, scopeName);
        if ((LEVEL[mine] ?? 0) < (LEVEL[level] ?? 0)) {
          findings.push(`${s.rel}:${perms.n} job \`${job.name}\`: its job-level block drops \`${scopeName}: ${level}\`, which the workflow grants. A job-level block REPLACES the workflow's; restate it.`);
        }
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
    console.error(`✗ fail-fast coverage (FF-1) — ${findings.length} problem(s):`);
    for (const f of findings) console.error(`  · ${f}`);
    console.error(`  The rule: every gate job ends with \`- if: failure()\` + \`uses: ${ACTION_REF}\`; no deploy-type job carries it. docs/ci/README.md §2.1.`);
    process.exit(1);
  }
  console.log(
    `ok  fail-fast coverage (FF-1) — ${stats.workflows} workflow(s), ${SCOPE.length} in scope; ${stats.graded} gate job(s) end with ` +
      `the cancel step (${stats.carriers} in the tree); ${stats.calls} call job(s) grant their callee the scope; ` +
      `${stats.deployType} deploy-type job(s), ${stats.exceptions} declared exception(s) and ${stats.inactive} job(s) of a ` +
      'workflow with no pull_request trigger carry none',
  );
}
