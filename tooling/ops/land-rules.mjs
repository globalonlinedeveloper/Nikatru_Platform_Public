// ─────────────────────────────────────────────────────────────────────────────
// land-rules.mjs — the THREE rules the laptop landers relearned, in one tested
// place: (a) what a pull request's ci-gate says, (b) whether main is healthy,
// (c) what the landing freeze means.
//
// NOT A GUARD and NOT A LANDER. Pure functions: a check rollup, a run, a status
// list or a file's text in; a verdict out. No network, no filesystem, no exit.
// tooling/ops/land-gate.mjs is the I/O around them (the laptop lander's reads,
// and main-healthy.yml's commit status), and tooling/ci/test/land-rules.test.mjs
// holds every rule against recorded rollups.
//
// ── WHY IT EXISTS (rv2-pipe-a P-1, 2026-09-29) ──────────────────────────────
// The lander lived only as land-v15.sh in one session's scratchpad, with no
// test and no review. Its gate read was rewritten FOUR times for one class:
//   · v12 took the FIRST ci-gate in the rollup. #1031 (2026-09-28): a body edit
//     started a second CI run on the same head; the older run's FAILED gate is
//     listed first, so the lander exited 5 twice on a PR whose newest gate was
//     green (fixture: test/fixtures/land-rollup/pr-1031.json).
//   · v14.2 had to learn that a failed check of a SUPERSEDED run is not red.
//   · v15 took the gate of the newest RUN — but a newer run whose ci-gate has
//     not reported yet is not in the rollup as a gate, so the OLD gate still
//     read as the verdict. v15.1 (2026-09-29): Renovate's rebase cancelled the
//     first run, its always() ci-gate concluded FAILURE, and all three rebased
//     PRs (#1029, #1030, #1040) exited 5 (fixture: pr-1029.json).
// Rule (a) below is v15.1, stated once: the gate is the ci-gate check-run of the
// NEWEST run of its workflow on the head; a gate from an OLDER run than the
// workflow's newest is STALE, which is pending, never a verdict.
// ─────────────────────────────────────────────────────────────────────────────
import { POST_GATE_EVENTS } from './post-gate.mjs';

/** The one required check on main (docs/ci/README.md §4). */
export const GATE_CHECK = 'ci-gate';

/** The workflow whose run on a main push decides main's health: ci.yml's `name:`
 *  (what a check rollup calls `workflowName`, and what main-healthy.yml's
 *  `workflow_run.workflows` names). */
export const MAIN_WORKFLOW = 'CI';

/** The same workflow as a run object names it. A run's `name` is NOT the
 *  workflow's: ci.yml sets `run-name:` ("CI on main by @…"), and the REST run
 *  and the workflow_run payload both carry that as `name`. Only `path` is
 *  stable, so run objects are matched on it. */
export const MAIN_WORKFLOW_PATH = '.github/workflows/ci.yml';

/** Does this run object belong to MAIN_WORKFLOW_PATH? (`path` may carry an
 *  `@<ref>` suffix.) */
export const isMainWorkflowRun = (r) => String(r?.path ?? '').split('@')[0] === MAIN_WORKFLOW_PATH;

/** The commit-status context main-healthy.yml writes on each main commit. */
export const MAIN_HEALTH_CONTEXT = 'main-healthy';

/** Merges whose core CI on main has not reported yet, beyond which no lander
 *  merges (land-v14: ci.yml on main runs one and queues one; a third push
 *  CANCELS the queued run, and its commit is then verified by nobody). */
export const INFLIGHT_CAP = 2;

/** Completed conclusions of a check that are red. CANCELLED is not here: a
 *  cancelled check is a superseded or interrupted run, never a finding. */
export const RED_CONCLUSIONS = new Set(['FAILURE', 'TIMED_OUT', 'STARTUP_FAILURE', 'ACTION_REQUIRED', 'ERROR']);

/** Runs on a main commit that are judged elsewhere, never as main's health
 *  (land-v15.2): a store submission and the native auth proof are dispatched
 *  by hand and own their verdicts; Ops watch is judged against its own
 *  pre-merge baseline (`newReds`). */
export const MAIN_RUN_EXEMPT = [
  { prefix: 'Store submit:', event: 'workflow_dispatch' },
  { prefix: 'Native auth proof', event: 'workflow_dispatch' },
  { prefix: 'Ops watch', event: null },
];

/** The Actions run id inside a check's or a status's URL
 *  (`…/actions/runs/<id>/job/<job>`), or 0 when the URL names no run — a
 *  third-party check, or a status posted without one. */
export function runIdOf(url) {
  const m = /\/actions\/runs\/(\d{1,20})(?:[/?#]|$)/.exec(String(url ?? ''));
  return m ? Number(m[1]) : 0;
}

/**
 * One entry of a check rollup in one shape. Takes the GraphQL rollup
 * (`gh pr view --json statusCheckRollup`: CheckRun with status/conclusion,
 * StatusContext with state) and the REST check-run (lowercase, `details_url`).
 */
export function normaliseCheck(c) {
  const isStatus = c?.__typename === 'StatusContext' || (c?.context !== undefined && c?.name === undefined);
  if (isStatus) {
    const state = String(c.state ?? '').toUpperCase();
    return {
      name: String(c.context ?? ''),
      workflow: null,
      run: runIdOf(c.targetUrl ?? c.target_url),
      status: state === 'PENDING' || state === 'EXPECTED' || state === '' ? 'PENDING' : 'COMPLETED',
      conclusion: state === 'PENDING' || state === 'EXPECTED' ? null : state || null,
      startedAt: String(c.startedAt ?? c.createdAt ?? c.created_at ?? ''),
    };
  }
  return {
    name: String(c?.name ?? ''),
    workflow: c?.workflowName ? String(c.workflowName) : null,
    run: runIdOf(c?.detailsUrl ?? c?.details_url),
    status: String(c?.status ?? '').toUpperCase() || 'PENDING',
    conclusion: c?.conclusion ? String(c.conclusion).toUpperCase() : null,
    startedAt: String(c?.startedAt ?? c?.started_at ?? ''),
  };
}

/** workflow name → the highest run id seen for it, from the rollup and from an
 *  optional run list (`/actions/runs?head_sha=`), which also knows a newer run
 *  that has not created a single check yet. */
export function newestRunByWorkflow(checks, runs = []) {
  const top = new Map();
  const see = (wf, id) => {
    if (!wf || !(id > 0)) return;
    if (!(top.get(wf) >= id)) top.set(wf, id);
  };
  for (const c of checks) see(c.workflow, c.run);
  for (const r of runs ?? []) see(r?.name ?? r?.workflowName, Number(r?.id));
  return top;
}

const byNewestRun = (a, b) => b.run - a.run || b.startedAt.localeCompare(a.startedAt);

/**
 * RULE (a) — what a head's ci-gate says.
 *
 *   rollup  the head's check entries (either shape; see normaliseCheck)
 *   runs    optional: the head's workflow runs [{ id, name, status, conclusion }]
 *
 * Returns { verdict, why, gate, newestRun }, verdict one of
 *   GREEN    the newest run's ci-gate completed SUCCESS
 *   RED      the newest run's ci-gate completed anything else
 *   PENDING  the newest run's ci-gate has not completed
 *   STALE    the only ci-gate is from an OLDER run than the workflow's newest:
 *            that run's gate has not reported. Pending, never a verdict.
 *   NONE     no ci-gate on the head at all
 * Only GREEN may merge and only RED may stop a lander.
 */
export function gateVerdict(rollup, { runs = [], gate = GATE_CHECK } = {}) {
  const checks = (rollup ?? []).map(normaliseCheck);
  const gates = checks.filter((c) => c.name === gate).sort(byNewestRun);
  if (!gates.length) return { verdict: 'NONE', why: `no ${gate} check-run on the head yet`, gate: null, newestRun: 0 };
  const g = gates[0];
  // A REST check-run carries no workflow name; its newest is then the newest
  // gate itself, and only a `runs` list can say a newer run exists.
  const newest = Math.max(g.run, newestRunByWorkflow(checks, runs).get(g.workflow ?? MAIN_WORKFLOW) ?? 0);
  const at = `${gate} of run ${g.run || '(no run id)'} (${g.workflow ?? 'workflow unnamed'})`;
  if (g.run < newest) {
    return {
      verdict: 'STALE',
      why: `${at} is from an OLDER run than the workflow's newest run ${newest} on this head, whose ${gate} has not reported — pending, never a verdict`,
      gate: g,
      newestRun: newest,
    };
  }
  const cancelled = (runs ?? []).find((r) => Number(r?.id) === g.run && String(r?.conclusion ?? '').toLowerCase() === 'cancelled');
  if (g.status !== 'COMPLETED') return { verdict: 'PENDING', why: `${at} is ${g.status}`, gate: g, newestRun: newest };
  if (g.conclusion === 'SUCCESS') return { verdict: 'GREEN', why: `${at} is SUCCESS`, gate: g, newestRun: newest };
  if (cancelled) {
    return { verdict: 'PENDING', why: `${at} is ${g.conclusion}, but run ${g.run} itself was CANCELLED — an interrupted run is not a verdict; it needs a re-run`, gate: g, newestRun: newest };
  }
  return { verdict: 'RED', why: `${at} is ${g.conclusion}`, gate: g, newestRun: newest };
}

/**
 * The red checks that count (land-v14.2): a failed check of a SUPERSEDED run —
 * an older run of the same workflow on the same head — is history, not red.
 * A check with no run id (a status, a third-party check) always counts.
 */
export function redChecks(rollup, { runs = [] } = {}) {
  const checks = (rollup ?? []).map(normaliseCheck);
  const newest = newestRunByWorkflow(checks, runs);
  return checks
    .filter((c) => c.status === 'COMPLETED' && RED_CONCLUSIONS.has(String(c.conclusion)))
    .filter((c) => !(c.workflow && c.run > 0) || c.run >= (newest.get(c.workflow) ?? 0))
    .map((c) => c.name);
}

// ── RULE (b) — main is healthy ──────────────────────────────────────────────

/**
 * What main-healthy.yml posts for one completed workflow_run of CI, or null
 * when the run is not main's: not a post-gate run (a push, or since 2026-10-02
 * the dispatch land.yml starts after its GITHUB_TOKEN merge — POST_GATE_EVENTS),
 * not on main, or from another repository (a fork's branch can be called
 * `main`). A cancelled run posts
 * nothing — superseded by a newer main push, whose own run verifies it; a
 * cancel on the newest commit leaves main PENDING until someone re-runs it.
 */
export function statusForRun(run, { repo }) {
  if (!run || typeof run !== 'object') return { post: null, why: 'no workflow_run in the event' };
  const from = run.head_repository?.full_name ?? run.repository?.full_name ?? null;
  if (!POST_GATE_EVENTS.includes(run.event)) return { post: null, why: `run ${run.id} is a ${run.event} run, not a push or dispatch of main` };
  if (run.head_branch !== 'main') return { post: null, why: `run ${run.id} is on ${run.head_branch}, not main` };
  if (from !== repo) return { post: null, why: `run ${run.id} is from ${from}, not ${repo}` };
  if (!isMainWorkflowRun(run)) return { post: null, why: `run ${run.id} is ${run.path}, not ${MAIN_WORKFLOW_PATH}` };
  if (!/^[0-9a-f]{40}$/.test(String(run.head_sha))) return { post: null, why: `run ${run.id} carries no 40-hex head_sha` };
  if (run.status !== 'completed') return { post: null, why: `run ${run.id} is ${run.status}, not completed` };
  const c = String(run.conclusion ?? '');
  if (c === 'cancelled' || c === 'skipped' || c === 'neutral') {
    return { post: null, why: `run ${run.id} concluded ${c}: not a verdict on ${run.head_sha.slice(0, 8)}` };
  }
  const state = c === 'success' ? 'success' : 'failure';
  return {
    post: {
      sha: run.head_sha,
      body: {
        state,
        context: MAIN_HEALTH_CONTEXT,
        target_url: run.html_url,
        description: `${MAIN_WORKFLOW} run ${run.id} attempt ${run.run_attempt ?? 1} on main: ${c}`.slice(0, 140),
      },
    },
    why: `${MAIN_WORKFLOW} run ${run.id} on ${run.head_sha.slice(0, 8)} concluded ${c}`,
  };
}

/**
 * RULE (b) — is main healthy? From the commit statuses of main's NEWEST sha
 * (GET /repos/{r}/commits/{sha}/statuses). The newest RUN's status decides —
 * by the run id in its target_url, not by when it was posted — so an older
 * run finishing late cannot overwrite a newer one's verdict. No status yet on
 * the newest sha is PENDING: main moved and its CI has not finished.
 */
export function mainHealth({ mainSha, statuses }) {
  if (!/^[0-9a-f]{40}$/.test(String(mainSha))) return { verdict: 'PENDING', why: `main's sha is unreadable (${String(mainSha).slice(0, 12)})` };
  const mine = (statuses ?? []).filter((s) => s?.context === MAIN_HEALTH_CONTEXT);
  if (!mine.length) return { verdict: 'PENDING', why: `no ${MAIN_HEALTH_CONTEXT} status on main ${mainSha.slice(0, 8)} yet` };
  const s = [...mine].sort((a, b) => runIdOf(b.target_url) - runIdOf(a.target_url) || Number(b.id ?? 0) - Number(a.id ?? 0))[0];
  const at = `${MAIN_HEALTH_CONTEXT} on ${mainSha.slice(0, 8)} from run ${runIdOf(s.target_url) || '(none)'}`;
  if (s.state === 'success') return { verdict: 'GREEN', why: `${at} is success` };
  if (s.state === 'failure' || s.state === 'error') return { verdict: 'RED', why: `${at} is ${s.state}` };
  return { verdict: 'PENDING', why: `${at} is ${s.state}` };
}

// ── RULE (c) — the landing freeze ───────────────────────────────────────────

/** A freeze file's text (null when there is no file). ANY file freezes, an
 *  empty one included: the file is the switch, its first line is the reason. */
export function readFreeze(text) {
  if (text === null || text === undefined) return { frozen: false, reason: null };
  const first = String(text).split(/\r?\n/).find((l) => l.trim() !== '');
  return { frozen: true, reason: first ? first.trim() : '(the freeze file names no reason)' };
}

/**
 * May a lander with a green gate take the landing lock and merge?
 *   · a lander ALREADY holding the lock finishes: a freeze never strands a
 *     landing half-way (it is set by a red AFTER some merge, not before this one);
 *   · a freeze stops every other lander — it waits, it does not exit — except a
 *     fix-first PR, which is how a freeze is lifted by a fix (land-v15, #1067);
 *   · INFLIGHT_CAP merges whose core CI has not reported stop a new merge.
 */
export function mayTakeLock({ freezeText = null, holdsLock = false, fixFirst = false, inflight = 0 } = {}) {
  if (holdsLock) return { ok: true, why: 'this lander already holds the lock' };
  const f = readFreeze(freezeText);
  if (f.frozen && !fixFirst) return { ok: false, why: `FROZEN: ${f.reason} (fix first)` };
  if (inflight >= INFLIGHT_CAP) return { ok: false, why: `${inflight} merge(s) await core CI on main (cap ${INFLIGHT_CAP})` };
  return { ok: true, why: f.frozen ? `fix-first under the freeze (${f.reason})` : 'not frozen' };
}

const exempt = (r) => MAIN_RUN_EXEMPT.some((e) => String(r?.name ?? '').startsWith(e.prefix) && (e.event === null || r?.event === e.event));

/**
 * The freeze line for main after a merge, or null when main is not red:
 * the COMPLETED runs on the merge sha that are neither green nor exempt.
 * Cancelled-only is not red when main has moved on (`newerMainSha`): the newer
 * push's own runs verify the merged commit too (land-v14.3).
 */
export function mainRunsFreeze(runs, { pr, mainSha, newerMainSha = null }) {
  const red = (runs ?? [])
    .filter((r) => r?.head_sha === mainSha && r?.status === 'completed')
    .filter((r) => !['success', 'skipped', 'neutral'].includes(String(r.conclusion)))
    .filter((r) => !exempt(r))
    .map((r) => `${r.name}=${r.conclusion}`);
  if (!red.length) return null;
  const onlyCancelled = red.every((x) => x.endsWith('=cancelled'));
  if (onlyCancelled && newerMainSha && newerMainSha !== mainSha) return null;
  return `main red after #${pr} on ${String(mainSha).slice(0, 8)}: ${red.join(';')}`;
}

/** Failing job names in `now` that were not failing in the pre-merge
 *  `baseline` — only these are this merge's red (land-v14, Ops watch). */
export function newReds(baseline, now) {
  const before = new Set(baseline ?? []);
  return [...new Set(now ?? [])].filter((j) => !before.has(j)).sort();
}

// ── P-3 — the serial minutes each landing costs ─────────────────────────────

/** Nearest-rank percentile of a list of numbers, or null for an empty list. */
export function percentile(xs, p) {
  const v = (xs ?? []).filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  return v[Math.min(v.length - 1, Math.max(0, Math.ceil((p / 100) * v.length) - 1))];
}

/**
 * The serial part of landing one PR, from timestamps GitHub already holds:
 *   gateToMerge       its newest ci-gate completing → the merge
 *   mergeToMainGreen  the merge → the push CI run on its merge sha completing
 *                     green (the lock was held until then; land-v13/v14)
 * `samples` [{ pr, gateGreenAt, mergedAt, mainGreenAt }]; a sample missing a
 * timestamp is left out of that measure, never counted as zero. The serial
 * minutes per PR is p50 gateToMerge + p50 mergeToMainGreen.
 */
export function serialTiming(samples) {
  const mins = (a, b) => (Date.parse(b) - Date.parse(a)) / 60_000;
  const g = [];
  const m = [];
  for (const s of samples ?? []) {
    const x = mins(s.gateGreenAt, s.mergedAt);
    const y = mins(s.mergedAt, s.mainGreenAt);
    if (Number.isFinite(x) && x >= 0) g.push(x);
    if (Number.isFinite(y) && y >= 0) m.push(y);
  }
  const round = (x) => (x === null ? null : Math.round(x * 10) / 10);
  const gateToMerge = { n: g.length, p50: round(percentile(g, 50)), p90: round(percentile(g, 90)) };
  const mergeToMainGreen = { n: m.length, p50: round(percentile(m, 50)), p90: round(percentile(m, 90)) };
  const serialP50 = gateToMerge.p50 === null || mergeToMainGreen.p50 === null ? null : round(gateToMerge.p50 + mergeToMainGreen.p50);
  return { gateToMerge, mergeToMainGreen, serialP50 };
}
