#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// land-next.mjs — the merge orchestrator's decisions: which pull request lands
// next, whether main may take a merge at all, and what main's pipeline said
// after the last one. `.github/workflows/land.yml` is the thin shell around it.
//
// ⏱ 2026-10-02 · row O-MERGES-DEPEND-ON-THE-LAPTOP. Every merge used to be made by
// a laptop script (`land-vNN.sh`) run by local daemons: when the laptop was off,
// rebooting, out of memory or switching accounts, nothing landed. This runs on
// GitHub, on a schedule and on the events that can change a decision, with the
// workflow's own GITHUB_TOKEN — NO new secret, NO PAT, NO GitHub App.
//
// ── THE CONSTRAINT THE DESIGN ANSWERS ───────────────────────────────────────
// A push made with GITHUB_TOKEN starts no workflow run, so a squash merge made
// here would never start `CI on main`, its deploy call jobs or CodeQL. A
// `workflow_dispatch` made with that token DOES start a run (GitHub's one
// exception, with repository_dispatch; measured in this repository: run
// 35829064154, Deploy workers, event workflow_dispatch, actor
// github-actions[bot], dispatched by redeploy-stranded.yml with GITHUB_TOKEN).
// So after a merge this dispatches ci.yml and codeql.yml on main (and ops-watch.yml,
// as the laptop lander did), and every reader that keyed on a push to main now
// takes a dispatch of main too: POST_GATE_IF / POST_GATE_EVENTS in workflow-scan.mjs.
//
// ── WHAT IT PORTS (land-v23.sh, the laptop lander; not in this repository) ──
//   eligible  open, not draft, base main, label `land-ok:<sha8>`, the NEWEST ci-gate run
//             on the head GREEN (land-rules.mjs rule a — the newest RUN decides,
//             never the first rollup entry), mergeable.
//   bound     `land-ok:<sha8>` approves exactly the head whose sha starts with those
//             8 hex. A GitHub update-branch merge of it (committer web-flow,
//             verified, FIRST PARENT the bound sha, second parent on main) carries
//             the binding forward when its changes against main are the approved
//             ones; any other new head WAITS naming `land-ok:<its sha8>`. A bare
//             `land-ok` binds to nothing and WAITS (`bindingOf`).
//   freeze    an OPEN issue labelled `land-freeze` stops every merge.
//   skew      a head behind main is updated (update-branch) and re-tested, UNLESS
//             its changes are disjoint from main's new changes (`skewVerdict`).
//             OVERLAP and UNKNOWN fail closed: a same-repository head is updated,
//             a fork's is left to a person (this token cannot start its CI).
//   re-test   an update-branch made with GITHUB_TOKEN starts no CI, so a head with
//             no CI run past MAIN_RUN_GRACE_MS gets ci.yml DISPATCHED on its
//             branch; at HEAD_DISPATCH_CAP runs that never reported, it is SKIPPED
//             for a person to re-run — never a wait without end.
//   E2E       a head touching apps/*/(lib|integration_test|web|assets) or
//             packages/*/lib needs a green `E2E live` run on that head; one with
//             none is dispatched on the PR's branch (same repository only).
//   merge     squash, with the head sha the decision read (`sha`, GitHub's
//             --match-head-commit); then main's pipeline is dispatched.
//   watch     main's newest CI run at main's head: running → no merge; red with a
//             failing job that was NOT failing on the parent's run → a
//             `land-freeze` issue naming the run and the job. A CANCELLED run with
//             any failed job is red (fail-fast cancels a red run); one whose jobs
//             cannot be read is red too (land-v24's v15.3 rule). Only ci.yml and
//             codeql.yml are judged, so the attended dispatches (Rollback, Native
//             auth proof, Store submit) never count.
//   review    ⏱ 2026-10-02 (O-REVIEWS-DEPEND-ON-THE-LAPTOP) a `land-hold` label waits; a
//             `needs-review` PR — or one whose OWN file list is review-classed or
//             unreadable (`reviewRequired`: the label is a display, never the only
//             input) — waits until the NEWEST owner verdict review (line 1
//             `VERDICT: APPROVE`) is on the current head, with `review:approve`
//             (`reviewVerdict`); any other `VERDICT:` line 1 is CHANGES. Labels set by
//             review-gate.yml; verdicts posted by tooling/autopilot/post-verdict.mjs.
//   fix-first ⏱ 2026-10-02 (O-FREEZE-FIX-NEEDS-THE-LAPTOP) the freeze issue carries each
//             new failing job's first failing step and log tail (`freezeLogSection`);
//             while it is open, a PR labelled `fix-first` whose body says
//             `Fixes-freeze: #<it>` may merge (every other rule still applies), and a
//             later pass CLOSES it once main's newest ci.yml AND codeql.yml runs at the
//             head (`unionFreezeChecks`) have every
//             named job green and no red that was not already red on the parent
//             (`freezeCloseVerdict`). The fixer routine is docs/autopilot/fixer.prompt.md.
//   one       ONE write per run (a merge, an update-branch, an E2E or CI dispatch,
//             a main dispatch, a freeze or a freeze close), in order of land-ok label time, then
//             PR number. A pull request whose write is REFUSED is skipped with the
//             reason and the next one is tried. `concurrency: land` makes the run
//             itself the one actor.
//   budget    the run reads /rate_limit first and refuses to start below
//             API_BUDGET_FLOOR; it prints what it spent.
//
// ── DRY RUN IS THE DEFAULT ──────────────────────────────────────────────────
// LAND_DRY_RUN is anything but the exact string `false` → print every open PR's
// decision and reason, and write NOTHING. The cut-over (the lead's) runs it dry
// beside the laptop landers for a day, then sets the repository variable. A
// dispatch's own `dry_run` (LAND_DISPATCH_DRY_RUN) can only make a run drier: a
// `dry_run=false` dispatch while the repository is still dry is REFUSED (exit 1).
//
// Usage:
//   node tooling/ci/land-next.mjs                      live: GITHUB_TOKEN/GH_TOKEN, GITHUB_REPOSITORY
//   node tooling/ci/land-next.mjs --snapshot <file>    decide from a recorded snapshot, write nothing
//   env  LAND_DRY_RUN  `false` to act; anything else (or unset) is a dry run
//   env  LAND_DISPATCH_DRY_RUN  a dispatch's `dry_run` input; empty on any other event
// Exit 0 = decided (and, live, acted or had nothing to do).
//      1 = a write was refused (merge, update, dispatch, issue), or a live dispatch
//          was refused during the dry-run period — the reason is printed.
//      2 = COULD NOT LOOK: a read failed, the snapshot is unreadable, or the API
//          budget is below its floor. Nothing was written.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gateVerdict, newReds, MAIN_WORKFLOW, MAIN_WORKFLOW_PATH } from '../ops/land-rules.mjs';
import { fetchWithBoundedRetry } from '../ops/bounded-retry.mjs';
import { anchoredRunRead, githubRead } from './anchored-run-read.mjs';
import { globClaims } from './deploy-globs.mjs';
import { POST_GATE_EVENTS } from '../ops/post-gate.mjs';
import { CONTRACT } from '../autopilot/cli.mjs';
import { classify as classifyReview } from '../autopilot/review-paths.mjs';

const ROOT = resolve(join(dirname(fileURLToPath(import.meta.url)), '..', '..'));

export const LAND_LABEL = 'land-ok';
/** The approval: `land-ok:<sha8>`, bound to the ONE head whose sha starts with those 8 hex. */
export const BOUND_LABEL = /^land-ok:([0-9a-f]{8})$/;
/** Either form wakes and queues a PR; only the bound form can approve a head. */
export const isLandLabel = (name) => name === LAND_LABEL || BOUND_LABEL.test(String(name ?? ''));
export const boundLabelFor = (sha) => `${LAND_LABEL}:${String(sha ?? '').slice(0, 8)}`;
/** GitHub's own committer on an update-branch (and web-UI) commit. */
export const UPDATE_COMMITTER = 'web-flow';
/** Update-branch merges the binding is carried across, at most. */
export const UPDATE_HOPS_CAP = 5;
/** GitHub's pull-request commits API returns at most this many commits. */
export const PR_COMMIT_CAP = 250;
export const FREEZE_LABEL = 'land-freeze';
// ⏱ 2026-10-02 · O-REVIEWS-DEPEND-ON-THE-LAPTOP. The review gate's labels are the
// autopilot contract's (tooling/autopilot/contract.json), never spelled twice.
const PR_LABELS = CONTRACT.publicLabels.pr;
export const HOLD_LABEL = PR_LABELS[1];
export const NEEDS_REVIEW_LABEL = PR_LABELS[2];
export const APPROVE_LABEL = PR_LABELS[3];
/** ⏱ 2026-10-02 · O-FREEZE-FIX-NEEDS-THE-LAPTOP. During a freeze only a PR with this
 *  label AND a `Fixes-freeze: #<the open freeze>` line in its body may merge. */
export const FIX_FIRST_LABEL = PR_LABELS[5];
export const FIXES_FREEZE_LINE = /^Fixes-freeze: #(\d+)\s*$/m;
/** The freeze issue's log section: each failing job's last lines, capped in total. */
export const FREEZE_LOG_LINES = 60;
export const FREEZE_LOG_CAP = 20_000;
/** Line 1 of a verdict review's body. A verdict is a COMMENT review (GitHub refuses
 *  APPROVE from a PR's author, and every PR here has one author). ANY line 1 that
 *  starts `VERDICT:` is a verdict, and only exactly `VERDICT: APPROVE` approves:
 *  `VERDICT: CHANGES REQUIRED`, `VERDICT: APPROVE WITH NITS` or a typo is CHANGES
 *  here (fail closed). post-verdict.mjs maps `APPROVE WITH NITS` to the canonical
 *  `VERDICT: APPROVE` before posting (nits never block), so a NITS line reaching
 *  this gate was posted by hand and is read as CHANGES. */
export const VERDICT_LINE = /^VERDICT:/;
export const APPROVE_LINE = /^VERDICT: APPROVE\s*$/;
/** Line 1 → 'APPROVE' | 'CHANGES' | null (not a verdict). */
export function verdictOf(line1) {
  const l = String(line1 ?? '');
  if (!VERDICT_LINE.test(l)) return null;
  return APPROVE_LINE.test(l) ? 'APPROVE' : 'CHANGES';
}
export const BASE_BRANCH = 'main';
export const E2E_WORKFLOW_PATH = '.github/workflows/e2e.yml';
/** The workflows whose run on main's head is main's verdict after a merge. */
export const WATCHED_PATHS = Object.freeze([MAIN_WORKFLOW_PATH, '.github/workflows/codeql.yml']);
/** Dispatched on main after every merge, in this order. ci.yml first: it is the gate
 *  and the deploys. ops-watch.yml is the laptop lander's post-merge dispatch, kept. */
export const POST_MERGE_DISPATCH = Object.freeze(['ci.yml', 'codeql.yml', 'ops-watch.yml']);
/** A main head with no CI run this long after its commit is a pipeline nobody
 *  started (a push by this token, or a run lost between merge and dispatch). */
export const MAIN_RUN_GRACE_MS = 3 * 60_000;
/** Runs of CI on ONE main sha beyond which a cancelled or missing run is not
 *  re-dispatched again: a person must read why it keeps not finishing. */
export const MAIN_DISPATCH_CAP = 2;
/** CI runs on ONE PR head that never reported a ci-gate, beyond which the lander stops
 *  dispatching ci.yml on it: the head is SKIPPED for a person (or the laptop) to re-run. */
export const HEAD_DISPATCH_CAP = 2;
/** The API requests a run must have left before it starts. A run reads 2 when no open
 *  PR carries `land-ok` (it stops there), else about 8 + 12 per `land-ok` pull request.
 *  GITHUB_TOKEN's budget is 1,000 an hour per REPOSITORY, shared with CI's own
 *  API-reading guards; below this floor a run could be cut off between its reads and
 *  its write. The floor protects this run only, never CI's share (docs/ci/land.md). */
export const API_BUDGET_FLOOR = 200;
/** GitHub's compare API returns at most this many files; a list that long may be cut. */
export const COMPARE_FILE_CAP = 300;
/** GitHub's pull-request files API returns at most this many files. */
export const PR_FILE_CAP = 3000;
/** A failed job's conclusions that are red. A cancelled job is never a finding. */
const RED_JOB = new Set(['failure', 'timed_out', 'startup_failure', 'action_required']);

// ── PURE: what a path list needs ────────────────────────────────────────────

/** Does this change need a green `E2E live` run on its head before it merges? */
export const E2E_PATH = /^(?:apps\/[^/]+\/(?:lib|integration_test|web|assets)|packages\/[^/]+\/lib)\//;
export function needsE2E(files) {
  return (files ?? []).some((f) => E2E_PATH.test(f));
}

/** The refusal when tooling/ci/lane-map.json names no deploy unit. */
export const NO_UNITS = 'COVERAGE LOST — tooling/ci/lane-map.json declares no deployUnits';

/** A lockfile at the repository root (pubspec.lock, package-lock.json, …). */
export const ROOT_LOCKFILE = /^(?:[^/]*\.lock|[^/]*-lock\.(?:json|yaml)|[^/]*\.lockb)$/;

/**
 * The deploy units (tooling/ci/lane-map.json deployUnits) a path list reaches.
 * `unknown` lists every glob whose shape globClaims cannot decide — the caller
 * turns that into UNKNOWN, never into "claims nothing".
 */
export function deployUnitsOf(files, units) {
  const hit = new Set();
  const unknown = new Set();
  for (const [unit, globs] of Object.entries(units ?? {})) {
    for (const g of Array.isArray(globs) ? globs : []) {
      for (const f of files) {
        const c = globClaims(g, f);
        if (c === null) unknown.add(`${unit}: ${g}`);
        else if (c) hit.add(unit);
      }
    }
  }
  return { units: hit, unknown: [...unknown] };
}

/**
 * THE MERGE-SKEW RULE (port of skew-disjoint.mjs). `prFiles` are the PR's changes
 * against its merge base; `mainFiles` are main's changes since that merge base.
 * DISJOINT lets a head that is behind main merge without a re-test; OVERLAP and
 * UNKNOWN fail closed (the head is updated and re-tested).
 *   · main changed .github/** or a root lockfile          → OVERLAP
 *   · either side changed services/_shared/**             → OVERLAP
 *   · the same path changed on both sides                 → OVERLAP
 *   · a packages/** change against an apps/packages change → OVERLAP
 *   · both sides reach one deploy unit                    → OVERLAP
 *   · a list unreadable or cut at the API's cap, or a deploy glob of a shape
 *     globClaims cannot decide                            → UNKNOWN
 */
export function skewVerdict({ prFiles, mainFiles, units, mainComplete = true, prComplete = true }) {
  if (!Array.isArray(prFiles) || !prComplete) return { verdict: 'UNKNOWN', why: "the PR's file list is unreadable or cut at the API's cap" };
  if (!Array.isArray(mainFiles) || !mainComplete) return { verdict: 'UNKNOWN', why: "main's changes since the merge base are unreadable or cut at the API's cap" };
  if (mainFiles.length === 0) return { verdict: 'DISJOINT', why: 'main has changed no file since the merge base' };
  // An empty unit map would make every pair of changes disjoint on the deploy-unit limb.
  if (!units || typeof units !== 'object' || !Object.keys(units).length) return { verdict: 'UNKNOWN', why: `${NO_UNITS}, so no deploy unit could be compared` };
  const overlap = (why) => ({ verdict: 'OVERLAP', why });
  const gh = mainFiles.find((f) => f.startsWith('.github/'));
  if (gh) return overlap(`main changed ${gh}: the workflows that graded this head are not the ones main runs`);
  const lock = mainFiles.find((f) => ROOT_LOCKFILE.test(f));
  if (lock) return overlap(`main changed the root lockfile ${lock}`);
  const shared = [...prFiles, ...mainFiles].find((f) => f.startsWith('services/_shared/'));
  if (shared) return overlap(`${shared} is services/_shared, which every Worker imports`);
  const mainSet = new Set(mainFiles);
  const both = prFiles.find((f) => mainSet.has(f));
  if (both) return overlap(`${both} changed on both sides`);
  const isPkg = (f) => f.startsWith('packages/');
  const isAppOrPkg = (f) => f.startsWith('apps/') || isPkg(f);
  if (mainFiles.some(isPkg) && prFiles.some(isAppOrPkg)) return overlap('main changed packages/ and this PR changes apps/ or packages/');
  if (prFiles.some(isPkg) && mainFiles.some(isAppOrPkg)) return overlap('this PR changes packages/ and main changed apps/ or packages/');
  const pr = deployUnitsOf(prFiles, units);
  const mn = deployUnitsOf(mainFiles, units);
  const unknown = [...pr.unknown, ...mn.unknown];
  if (unknown.length) return { verdict: 'UNKNOWN', why: `deploy glob pattern(s) of a shape globClaims cannot decide: ${unknown.slice(0, 3).join(' · ')}` };
  const unit = [...pr.units].find((u) => mn.units.has(u));
  if (unit) return overlap(`both sides reach the deploy unit ${unit}`);
  return { verdict: 'DISJOINT', why: `${mainFiles.length} file(s) on main, none in this PR's paths, deploy units or shared roots` };
}

// ── PURE: what a run list says ──────────────────────────────────────────────

const pathOf = (r) => String(r?.path ?? '').split('@')[0];
const newestFirst = (a, b) => Number(b?.id ?? 0) - Number(a?.id ?? 0);

/** The newest `E2E live` run on exactly this head: GREEN, RED, PENDING or NONE. */
export function e2eVerdict(runs, headSha) {
  const mine = (runs ?? []).filter((r) => pathOf(r) === E2E_WORKFLOW_PATH && r?.head_sha === headSha).sort(newestFirst);
  if (!mine.length) return { verdict: 'NONE', why: `no E2E live run on ${String(headSha).slice(0, 8)}` };
  const r = mine[0];
  const at = `E2E live run ${r.id} on ${String(headSha).slice(0, 8)}`;
  if (r.status !== 'completed') return { verdict: 'PENDING', why: `${at} is ${r.status}`, run: r };
  if (r.conclusion === 'success') return { verdict: 'GREEN', why: `${at} is success`, run: r };
  if (r.conclusion === 'cancelled') return { verdict: 'NONE', why: `${at} was cancelled: not a verdict`, run: r };
  return { verdict: 'RED', why: `${at} is ${r.conclusion}`, run: r };
}

/** The ci.yml runs of a head, in the shape land-rules' gateVerdict reads (a REST
 *  run's `name` is its run-name, so the workflow name is put back). */
export function gateRuns(runs) {
  return (runs ?? []).filter((r) => pathOf(r) === MAIN_WORKFLOW_PATH).map((r) => ({ id: r.id, name: MAIN_WORKFLOW, status: r.status, conclusion: r.conclusion }));
}

/**
 * MAIN, AFTER THE LAST MERGE. `runs` are the workflow runs on main's head sha;
 * `failedJobs` maps a run id to its failed job names; `baseline` maps a workflow
 * path to the failed job names of its newest completed run on the parent sha
 * (null when that run could not be read or does not exist — then every red is
 * new: fail closed). Returns { state, why, act?, freeze? }:
 *   GREEN    every watched workflow's newest run here is green
 *   RUNNING  main's newest ci.yml run has not completed — no merge (one at a time)
 *   NO_RUN   no CI run here yet; past the grace, act = dispatch ci.yml
 *   RED      a red with NO new failing job (pre-existing): merges continue
 *   FREEZE   a NEW failing job: freeze = { run, jobs, title, marker }
 *   HOLD     CI here was cancelled (no failed job) or missing MAIN_DISPATCH_CAP times: a person reads it
 */
export function mainWatch({ main, runs, failedJobs = {}, baseline = {}, now = Date.now() }) {
  const sha = String(main?.sha ?? '');
  if (!/^[0-9a-f]{40}$/.test(sha)) return { state: 'HOLD', why: `main's head sha is unreadable (${sha.slice(0, 12)})` };
  const at = sha.slice(0, 8);
  const onHead = (runs ?? []).filter((r) => r?.head_sha === sha && r?.head_branch === BASE_BRANCH && POST_GATE_EVENTS.includes(String(r?.event ?? '')));
  const ci = onHead.filter((r) => pathOf(r) === MAIN_WORKFLOW_PATH).sort(newestFirst);
  if (!ci.length) {
    const age = now - Date.parse(main?.committedAt ?? '');
    if (!(age >= MAIN_RUN_GRACE_MS)) return { state: 'RUNNING', why: `main ${at} has no CI run yet and is ${Number.isFinite(age) ? Math.round(age / 1000) : '?'} s old: waiting for its push run` };
    return { state: 'NO_RUN', why: `main ${at} has no CI run ${Math.round(age / 60_000)} min after its commit: its pipeline was never started`, act: { kind: 'dispatch-main' } };
  }
  const top = ci[0];
  if (top.status !== 'completed') return { state: 'RUNNING', why: `main ${at}: ci.yml run ${top.id} is ${top.status}` };
  // ci.yml decides whether main may take the next merge. CodeQL is judged once it has
  // completed and never holds the queue while it runs (a red it reports later still freezes).
  const newest = new Map();
  for (const r of onHead.filter((x) => WATCHED_PATHS.includes(pathOf(x)) && x.status === 'completed').sort(newestFirst)) if (!newest.has(pathOf(r))) newest.set(pathOf(r), r);
  // A red main ends `cancelled`: fail-fast cancels the rest of the run once a job fails.
  // So a cancelled run is a verdict when ANY job failed, and fails closed (red) when
  // its jobs could not be read; only a cancel with no failed job is "not a verdict".
  const failedIn = (r) => failedJobs[String(r.id)] ?? null;
  const isRed = (r) => {
    const c = String(r.conclusion);
    if (['success', 'skipped', 'neutral'].includes(c)) return false;
    if (c !== 'cancelled') return true;
    const f = failedIn(r);
    return f === null || f.length > 0;
  };
  if ((top.conclusion === 'cancelled' && !isRed(top)) || top.conclusion === 'skipped') {
    if (ci.length >= MAIN_DISPATCH_CAP) return { state: 'HOLD', why: `main ${at}: CI run ${top.id} is ${top.conclusion} and ${ci.length} CI runs here already — re-run it by hand once the cause is read` };
    return { state: 'NO_RUN', why: `main ${at}: CI run ${top.id} is ${top.conclusion} with no failed job, not a verdict`, act: { kind: 'dispatch-main' } };
  }
  const reds = [...newest.values()].filter(isRed);
  if (!reds.length) return { state: 'GREEN', why: `main ${at}: ${[...newest.values()].map((r) => `${pathOf(r).split('/').pop()} run ${r.id} success`).join(', ')}` };
  const fresh = [];
  for (const r of reds) {
    const wf = pathOf(r);
    const failing = failedIn(r) === null ? [`${wf.split('/').pop()} (its jobs could not be read)`] : failedIn(r);
    const base = baseline[wf];
    const added = base === null || base === undefined ? [...new Set(failing)].sort() : newReds(base, failing);
    if (added.length) fresh.push({ run: r, jobs: added });
  }
  if (!fresh.length) return { state: 'RED', why: `main ${at} is red only on job(s) that were already red on its parent: ${reds.map((r) => `run ${r.id}`).join(', ')}` };
  const first = fresh[0];
  const marker = `<!-- land-freeze run=${first.run.id} -->`;
  return {
    state: 'FREEZE',
    why: `main ${at}: NEW red ${fresh.map((f) => `run ${f.run.id} (${f.jobs.join(', ')})`).join('; ')}`,
    freeze: {
      run: first.run,
      jobs: first.jobs,
      marker,
      title: `land-freeze: main ${at} red after a merge — ${first.jobs[0]}`.slice(0, 200),
      body: freezeBody({ sha, fresh, marker }),
    },
    act: { kind: 'freeze' },
  };
}

function freezeBody({ sha, fresh, marker }) {
  const lines = [
    marker,
    `<!-- land-freeze-jobs ${JSON.stringify([...new Set(fresh.flatMap((f) => f.jobs))])} -->`,
    `land.yml found main \`${sha}\` red on job(s) that were not red on its parent, so it stops merging until this issue is closed.`,
    '',
    ...fresh.map((f) => `- run ${f.run.id} (${pathOf(f.run).split('/').pop()}): ${f.run.html_url ?? ''}\n  failing job(s) new against the parent: ${f.jobs.map((j) => `\`${j}\``).join(', ')}`),
    '',
    'Fix main (a pull request labelled `land-ok` waits like every other until this is closed), or close this issue once the red is read and judged not to block.',
  ];
  return lines.join('\n');
}

// ── PURE: which head `land-ok:<sha8>` approved ──────────────────────────────

/**
 * Is this PR commit a GitHub update-branch merge from main? Committer `web-flow` and
 * `verified` are server-stamped; two parents; the SECOND parent is not a commit of this
 * PR, so (the list being complete) it is reachable from main. `bySha` maps the PR's
 * commits (GET /pulls/N/commits, normalised) by sha.
 */
export function isUpdateCommit(c, bySha) {
  const parents = Array.isArray(c?.parents) ? c.parents : [];
  return c?.committer === UPDATE_COMMITTER && c?.verified === true && parents.length === 2 && bySha.has(parents[0]) && !bySha.has(parents[1]);
}

/**
 * THE BINDING. Which head the PR's `land-ok:<sha8>` label(s) approved, walking from the
 * current head back across GitHub update-branch merges (isUpdateCommit) by FIRST parent.
 *   pr.labels        label names; pr.labelTimes { name: newest labeled time }
 *   pr.forcePushes   times of `head_ref_force_pushed` events
 *   pr.commits       [{ sha, parents: [sha], committer: login, verified }], complete
 * Returns { sha, hops, label, why }: sha null → no approved head (the PR waits, and
 * `why` names the `land-ok:<sha8>` that would approve the current head). A bare
 * `land-ok` binds to nothing: the head at label time is not the reviewed head.
 */
export function bindingOf(pr) {
  const head = String(pr?.headSha ?? '');
  const want = `apply \`${boundLabelFor(head)}\` once ${head.slice(0, 8)} is the reviewed head`;
  const labels = pr?.labels ?? [];
  const bound = labels.map((n) => BOUND_LABEL.exec(String(n))?.[1]).filter(Boolean);
  const none = (why) => ({ sha: null, hops: 0, label: null, why });
  if (!bound.length) return none(labels.includes(LAND_LABEL) ? `a bare \`${LAND_LABEL}\` binds to no head: ${want}` : `no \`${LAND_LABEL}:<sha8>\` label: ${want}`);
  const commits = Array.isArray(pr?.commits) ? pr.commits : null;
  if (!commits || pr?.commitsComplete === false || commits.length >= PR_COMMIT_CAP) return none(`the PR's commit list is unreadable or cut at the API's cap, so no head can be bound: land it by hand`);
  const bySha = new Map(commits.map((c) => [c.sha, c]));
  let cur = head;
  for (let hops = 0; ; hops++) {
    const b8 = bound.find((b) => cur.startsWith(b));
    if (b8) {
      const label = `${LAND_LABEL}:${b8}`;
      // 8 hex is a prefix: it must name ONE commit of this PR, and no force-push may
      // have replaced the history since the label (a crafted commit with that prefix).
      const named = commits.filter((c) => String(c.sha).startsWith(b8)).length;
      if (named !== 1) return none(`\`${label}\` names ${named} commits of this PR, not one: ${want}`);
      const at = Date.parse(pr?.labelTimes?.[label] ?? '');
      if (!Number.isFinite(at)) return none(`the time \`${label}\` was applied is unreadable: ${want}`);
      if ((pr?.forcePushes ?? []).some((t) => !(Date.parse(t) < at))) return none(`the branch was force-pushed after \`${label}\` was applied: ${want}`);
      return { sha: cur, hops, label, why: hops ? `\`${label}\` carried across ${hops} update-branch merge(s) from main` : `\`${label}\` names this head` };
    }
    const c = bySha.get(cur);
    if (hops >= UPDATE_HOPS_CAP || !isUpdateCommit(c, bySha)) break;
    cur = c.parents[0];
  }
  return none(`head ${head.slice(0, 8)} is not ${bound.map((b) => `\`${LAND_LABEL}:${b}\``).join(', ')} nor a GitHub update-branch merge of it: ${want}`);
}

/**
 * The CHANGES' fingerprint, from a compare `main...<sha>` answer: one entry per changed
 * file (status, old name, name, and only its added/removed lines — or its blob when
 * GitHub sends no patch). Hunk headers and context lines are left out: an update from
 * main moves them (a coverage-manifest.json hunk shifted by main's lines) without
 * changing what the PR changes. null when unreadable or cut at the cap (fail closed).
 */
export function diffPrint(cmp) {
  const files = cmp?.files;
  if (!Array.isArray(files) || files.length >= COMPARE_FILE_CAP) return null;
  const changes = (patch) => String(patch).split('\n').filter((l) => /^[-+\\]/.test(l)).join('\n');
  return files.map((f) => [f.status, f.previous_filename ?? '', f.filename, f.patch === undefined || f.patch === null ? `blob:${f.sha ?? '?'}` : changes(f.patch)].join('\t')).sort();
}

/** Are the moved head's changes against main the approved ones, exactly? Unreadable → no. */
export function sameDiff(reviewed, head) {
  if (!Array.isArray(reviewed) || !Array.isArray(head)) return false;
  return reviewed.length === head.length && reviewed.every((l, i) => l === head[i]);
}

// ── PURE: the freeze a fixer works from, and its end ───────────────────────

/** ANSI colour / cursor sequences out of a job log. */
export const stripAnsi = (text) => String(text ?? '').replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/\u001b\][^\u0007]*\u0007/g, '');

/**
 * The freeze issue's log section. `jobs` = [{ name, step, log }] (log null when it
 * could not be read). Each job gets its first failing step and its last
 * FREEZE_LOG_LINES lines, ANSI stripped (GitHub has already masked secrets); the
 * whole section is at most `cap` characters, cut from each tail's oldest lines.
 */
export function freezeLogSection(jobs, { lines = FREEZE_LOG_LINES, cap = FREEZE_LOG_CAP } = {}) {
  const tails = (jobs ?? []).map((j) => ({ ...j, tail: j.log === null || j.log === undefined ? null : stripAnsi(j.log).replace(/\r\n?/g, '\n').replace(/\n+$/, '').split('\n').slice(-lines) }));
  const render = (t) => [
    '## The failing jobs (for the fixer)',
    '',
    ...t.flatMap((j) => [
      `### \`${j.name}\` — first failing step: ${j.step ? `\`${j.step}\`` : 'not named by the API'}`,
      '',
      ...(j.tail === null ? ['_the log could not be read_'] : ['```text', ...j.tail.map((l) => l.replace(/```/g, "'''")), '```']),
      '',
    ]),
  ].join('\n');
  let out = render(tails);
  while (out.length > cap && tails.some((t) => t.tail?.length)) {
    const longest = tails.filter((t) => t.tail?.length).sort((a, b) => b.tail.length - a.tail.length)[0];
    longest.tail = longest.tail.slice(Math.ceil(longest.tail.length / 4) || 1);
    out = render(tails);
  }
  return out.slice(0, cap);
}

/** The job names a freeze issue named (its marker; or, for an older body, the backticked list). */
export function freezeJobs(body) {
  const m = /<!-- land-freeze-jobs (\[.*?\]) -->/.exec(String(body ?? ''));
  if (m) {
    try {
      const j = JSON.parse(m[1]);
      if (Array.isArray(j)) return j.map(String);
    } catch {
      /* fall through to the prose */
    }
  }
  const p = /failing job\(s\) new against the parent: (.+)/.exec(String(body ?? ''));
  return p ? [...p[1].matchAll(/`([^`]+)`/g)].map((x) => x[1]) : [];
}

/**
 * MAY THE FREEZE CLOSE? `check` = { runId, url, status, conclusion, jobs: [{name, conclusion}],
 * baseline: [failed job names on the parent] | null } for main's newest ci.yml run at the
 * head. Closes only when every job the freeze named is in that run and green, and every
 * red job in it was already red on the parent (baseline-aware, like the opening).
 */
/**
 * The newest run of EACH watched workflow at main's head (`parts`, one per workflow
 * that has one) → ONE check for freezeCloseVerdict: completed only when every part
 * is, their jobs unioned, each part's baseline unioned (a part with no baseline adds
 * none, so its reds stay new: fail closed). null when no part was read.
 */
export function unionFreezeChecks(parts) {
  const ps = (parts ?? []).filter(Boolean);
  if (!ps.length) return null;
  const pending = ps.find((p) => p.status !== 'completed');
  return {
    runId: ps.map((p) => p.runId).join('+'),
    url: ps.map((p) => p.url).filter(Boolean).join(' · ') || null,
    status: pending ? pending.status : 'completed',
    conclusion: ps.every((p) => p.conclusion === 'success') ? 'success' : (ps.find((p) => p.conclusion !== 'success')?.conclusion ?? null),
    jobs: ps.flatMap((p) => p.jobs ?? []),
    baseline: ps.flatMap((p) => p.baseline ?? []),
  };
}

export function freezeCloseVerdict({ freeze, check }) {
  const named = freezeJobs(freeze?.body);
  const stay = (why) => ({ close: false, why: `#${freeze?.number} stays open: ${why}` });
  if (!check) return stay("main's newest watched run (ci.yml, codeql.yml) at the head was not read");
  if (check.status !== 'completed') return stay(`run ${check.runId} is ${check.status}`);
  if (!named.length) return stay('it names no job this can check');
  const by = new Map((check.jobs ?? []).map((j) => [String(j.name), String(j.conclusion)]));
  const notGreen = named.filter((n) => by.get(n) !== 'success');
  if (notGreen.length) return stay(`named job(s) not green in run ${check.runId}: ${notGreen.map((n) => `${n} (${by.get(n) ?? 'absent'})`).join(', ')}`);
  const reds = [...by].filter(([, c]) => RED_JOB.has(c)).map(([n]) => n);
  const fresh = check.baseline === null || check.baseline === undefined ? reds : newReds(check.baseline, reds);
  if (fresh.length) return stay(`run ${check.runId} has red job(s) that were not red on the parent: ${fresh.join(', ')}`);
  return { close: true, why: `#${freeze.number}: run ${check.runId} has every named job green (${named.join(', ')})${reds.length ? `; ${reds.length} red job(s) were already red on the parent` : ''}`, comment: `Main is green again on the named job(s) — ${check.url ?? `run ${check.runId}`}. Closed by land.yml; merges resume.` };
}

/** Does this PR name an OPEN freeze as the one it fixes? */
export function fixesOpenFreeze(pr, freezes) {
  if (!(pr?.labels ?? []).includes(FIX_FIRST_LABEL)) return null;
  const m = FIXES_FREEZE_LINE.exec(String(pr?.body ?? ''));
  return m && (freezes ?? []).some((f) => f.number === Number(m[1])) ? Number(m[1]) : null;
}

// ── PURE: the independent review ────────────────────────────────────────────

/**
 * THE REVIEW GATE (owner rule 2026-09-29; lane autopilot-reviews). `reviews` are the
 * PR's reviews from the REST API. Only a review by the repository OWNER
 * (`author_association`) whose body's first line is `VERDICT: APPROVE|CHANGES` is a
 * verdict — anyone may post a COMMENT review on a public repository, so nobody
 * else's text can approve or block. The NEWEST owner verdict decides, and it must be
 * an APPROVE whose `commit_id` is the current head, with the `review:approve` label.
 * Returns { ok, why }.
 */
export function reviewVerdict({ reviews, headSha, labels }) {
  const verdicts = (reviews ?? [])
    .map((r) => {
      const v = verdictOf(String(r?.body ?? '').split(/\r?\n/)[0]);
      return { r, m: v && [null, v] };
    })
    .filter(({ r, m }) => m && r?.author_association === 'OWNER')
    .sort((a, b) => (Date.parse(b.r.submitted_at ?? '') || 0) - (Date.parse(a.r.submitted_at ?? '') || 0) || Number(b.r.id ?? 0) - Number(a.r.id ?? 0));
  const at = String(headSha).slice(0, 8);
  if (!verdicts.length) {
    const others = (reviews ?? []).filter((r) => VERDICT_LINE.test(String(r?.body ?? '').split(/\r?\n/)[0])).length;
    return { ok: false, why: `needs-review: no owner verdict yet${others ? ` (${others} verdict-shaped review(s) by a non-owner ignored)` : ''}` };
  }
  const { r, m } = verdicts[0];
  if (r.commit_id !== headSha) return { ok: false, why: `needs-review: the newest verdict (${m[1]}, review ${r.id}) is on ${String(r.commit_id).slice(0, 8)}, not the head ${at}` };
  if (m[1] !== 'APPROVE') return { ok: false, why: `needs-review: the newest verdict on ${at} is CHANGES (review ${r.id})` };
  if (!(labels ?? []).includes(APPROVE_LABEL)) return { ok: false, why: `needs-review: APPROVE on ${at} (review ${r.id}) but no \`${APPROVE_LABEL}\` label` };
  return { ok: true, why: `owner APPROVE on ${at} (review ${r.id})` };
}

/**
 * Does this PR need the independent review? Re-derived HERE from its own file list
 * (tooling/autopilot/review-paths.mjs `classify`), not trusted to the `needs-review`
 * label: that label is set by one review-gate.yml run that can fail, never ran for a
 * PR opened before the cut-over or by a workflow token, and its ABSENCE is the
 * default. The label still counts; it is now a display, never the only input. A file
 * list that is unreadable or cut at the API's cap needs review (fail closed).
 * Returns the reason, or null.
 */
export function reviewRequired(pr) {
  if ((pr?.labels ?? []).includes(NEEDS_REVIEW_LABEL)) return `\`${NEEDS_REVIEW_LABEL}\``;
  if (!Array.isArray(pr?.files) || pr.filesComplete === false) return 'the file list is unreadable or cut (fail closed)';
  const c = classifyReview(pr.files);
  return c.classes.length ? `review-classed: ${c.classes.join(', ')}` : null;
}

// ── PURE: one pull request ──────────────────────────────────────────────────

/**
 * What to do with one open pull request. `pr` is the snapshot's PR entry; `repo`
 * the owner/name. Returns { action, why } with action one of
 *   MERGE · UPDATE · DISPATCH_E2E · DISPATCH_CI  (writes)
 *   WAIT   (pending: CI, mergeability, E2E running, a head moved after review)
 *   SKIP   (not eligible, or a person must act).
 * `now` is the decision's clock (a head's age for the CI grace).
 */
export function decidePr(pr, { repo, units, now = Date.now() }) {
  const skip = (why) => ({ action: 'SKIP', why });
  const wait = (why) => ({ action: 'WAIT', why });
  if (pr.state !== 'open') return skip(`state ${pr.state}`);
  if (pr.draft) return skip('draft');
  if (!(pr.labels ?? []).some(isLandLabel)) return skip(`no \`${LAND_LABEL}\` label`);
  if (pr.baseRef !== BASE_BRANCH) return skip(`base is ${pr.baseRef}, not ${BASE_BRANCH}`);
  if (!/^[0-9a-f]{40}$/.test(String(pr.headSha ?? ''))) return skip('no readable head sha');
  if ((pr.labels ?? []).includes(HOLD_LABEL)) return wait(`\`${HOLD_LABEL}\`: held by the lead`);
  // BOUND TO THE REVIEWED HEAD: `land-ok:<sha8>` approves that head, and a GitHub
  // update-branch merge of it (the lander's own) carries the approval forward when the
  // changes against main are the approved ones. Any other head is content nobody approved.
  const head8 = pr.headSha.slice(0, 8);
  const bind = bindingOf(pr);
  if (!bind.sha) return wait(bind.why);
  let moved = '';
  if (bind.sha !== pr.headSha) {
    const rev8 = bind.sha.slice(0, 8);
    if (!sameDiff(pr.reviewedDiff, pr.headDiff)) {
      const unread = !Array.isArray(pr.reviewedDiff) || !Array.isArray(pr.headDiff);
      return wait(`head ${head8} is an update-branch merge of the approved ${rev8}, but its changes against main ${unread ? 'could not be compared' : 'are not the approved ones'}: review ${head8} and apply \`${boundLabelFor(pr.headSha)}\``);
    }
    moved = `, ${bind.why} with the approved changes unchanged`;
  }
  // Before the review gate: an unreadable list is never landed by this tool at all
  // (and reviewRequired would fail closed on it anyway).
  if (!Array.isArray(pr.files) || pr.filesComplete === false) return skip("the PR's file list is unreadable or cut at the API's cap: land it by hand");
  let reviewed = '';
  if (reviewRequired(pr)) {
    const rv = reviewVerdict({ reviews: pr.reviews, headSha: pr.headSha, labels: pr.labels });
    if (!rv.ok) return wait(rv.why);
    reviewed = `, ${rv.why}`;
  }
  const g = gateVerdict(pr.checks ?? [], { runs: gateRuns(pr.runs) });
  if (g.verdict === 'RED') return skip(`ci-gate RED — ${g.why}`);
  if (g.verdict !== 'GREEN') {
    // NEVER A WAIT WITHOUT END: a head no CI run will ever grade (an update-branch made
    // with GITHUB_TOKEN starts none, or its run was cancelled) gets ci.yml dispatched on
    // its branch, up to HEAD_DISPATCH_CAP runs; past that a person re-runs it.
    const ci = gateRuns(pr.runs).sort(newestFirst);
    const idle = ci.every((r) => r.status === 'completed');
    const noVerdictComing = idle && (g.verdict === 'NONE' || (g.verdict === 'PENDING' && ci[0]?.conclusion === 'cancelled'));
    if (!noVerdictComing) return wait(`ci-gate ${g.verdict} — ${g.why}`);
    if (ci.length >= HEAD_DISPATCH_CAP) return skip(`ci-gate ${g.verdict} after ${ci.length} CI run(s) on ${head8}, none of which will report: re-run its CI by hand (a person or the laptop)`);
    if (!ci.length) {
      const age = now - Date.parse(pr.headCommittedAt ?? '');
      if (!(age >= MAIN_RUN_GRACE_MS)) return wait(`no CI run on ${head8} yet (${Number.isFinite(age) ? `${Math.round(age / 1000)} s old` : 'age unreadable'}): waiting for its push run`);
    }
    if (pr.headRepo !== repo) return skip(`ci-gate ${g.verdict} on ${head8} and a fork's branch cannot be dispatched here: a person re-runs its CI`);
    return { action: 'DISPATCH_CI', why: `ci-gate ${g.verdict} on ${head8} and no CI run will report one (${ci.length} run(s) here): ci.yml is dispatched on its branch` };
  }
  if (pr.mergeable === false || pr.mergeableState === 'dirty') return skip('merge conflict with main');
  if (pr.mergeable !== true) return wait('GitHub has not computed mergeability yet');
  if (Number(pr.behindBy) > 0) {
    const s = skewVerdict({ prFiles: pr.files, mainFiles: pr.mainFiles, mainComplete: pr.mainFilesComplete !== false, units });
    if (s.verdict !== 'DISJOINT') {
      const why = `${pr.behindBy} commit(s) behind main, skew ${s.verdict}: ${s.why}`;
      // An updated fork head would get no CI from this token: a person updates it.
      if (pr.headRepo !== repo) return skip(`${why} — a fork's head cannot be re-tested by this token: update it by hand`);
      return { action: 'UPDATE', why };
    }
  }
  if (needsE2E(pr.files)) {
    const e = e2eVerdict(pr.e2eRuns, pr.headSha);
    if (e.verdict === 'RED') return skip(`needs E2E: ${e.why}`);
    if (e.verdict === 'PENDING') return wait(`needs E2E: ${e.why}`);
    if (e.verdict === 'NONE') {
      if (pr.headRepo !== repo) return wait(`needs E2E: ${e.why}, and a fork's branch cannot be dispatched here`);
      return { action: 'DISPATCH_E2E', why: `needs E2E: ${e.why}` };
    }
  }
  const skew = Number(pr.behindBy) > 0 ? `, ${pr.behindBy} behind but DISJOINT` : '';
  return { action: 'MERGE', why: `ci-gate GREEN, mergeable${skew}${needsE2E(pr.files) ? ', E2E green' : ''}${moved}${reviewed}` };
}

/** Queue order: land-ok label time, then PR number. A PR with no label time sorts last. */
export function queueOrder(prs) {
  const t = (p) => {
    const v = Date.parse(p?.labeledAt ?? '');
    return Number.isFinite(v) ? v : Number.POSITIVE_INFINITY;
  };
  return [...(prs ?? [])].sort((a, b) => t(a) - t(b) || a.number - b.number);
}

/**
 * THE RUN'S DECISION, from one snapshot. Returns
 *   { watch, freezes, decisions: [{ number, action, why }], act, candidates }
 * `act` is the ONE write this run makes, or null: { kind: 'freeze' | 'dispatch-main' | 'close-freeze'
 * | 'merge' | 'update' | 'dispatch-e2e' | 'dispatch-ci', pr?, why }. `candidates`
 * are the pull-request writes in queue order (act first): a REFUSED one is skipped
 * and the next is tried (performQueue). A dry run prints `act` and does nothing else.
 */
export function plan(snap) {
  // IDLE: no open PR carries `land-ok`, so main was not read (readSnapshot stops early to
  // spare the repository's shared API budget); nothing can be merged, nothing is written.
  if (snap.idle) {
    const decisions = queueOrder(snap.prs).map((pr) => ({ number: pr.number, title: pr.title ?? '', ...decidePr(pr, { repo: snap.repo, units: {} }) }));
    return { watch: { state: 'IDLE', why: `no open pull request carries \`${LAND_LABEL}\`: main's runs were not read` }, freezes: [], decisions, act: null, candidates: [], blocked: null };
  }
  const units = snap.units ?? {};
  const watch = mainWatch({ main: snap.main, runs: snap.mainRuns, failedJobs: snap.failedJobs, baseline: snap.baseline, now: Date.parse(snap.now ?? '') || Date.now() });
  const freezes = (snap.freezes ?? []).filter((i) => i?.state === 'open');
  const now = Date.parse(snap.now ?? '') || Date.now();
  const openFreezes = (snap.freezes ?? []).filter((i) => i?.state === 'open');
  const decisions = queueOrder(snap.prs).map((pr) => {
    const d = { number: pr.number, title: pr.title ?? '', ...decidePr(pr, { repo: snap.repo, units, now }) };
    // FIX-FIRST: during a freeze only the PR that names it may merge.
    if (openFreezes.length && d.action === 'MERGE') {
      const fixes = fixesOpenFreeze(pr, openFreezes);
      if (fixes === null) return { ...d, action: 'WAIT', why: `frozen by ${openFreezes.map((f) => `#${f.number}`).join(', ')}: only a \`${FIX_FIRST_LABEL}\` PR whose body says \`Fixes-freeze: #<n>\` merges (${d.why})`, fix: false };
      return { ...d, why: `FIX-FIRST for #${fixes}: ${d.why}`, fix: true };
    }
    return d;
  });
  // A NEW red whose run already has a land-freeze issue — open, or CLOSED by the lead to
  // lift it — is not frozen again: closed means "read, and judged not to block".
  const lifted = watch.state === 'FREEZE' && (snap.freezeMarkers ?? []).includes(watch.freeze.marker);
  const state = lifted ? 'RED' : watch.state;
  const mainBlocked = ['FREEZE', 'RUNNING', 'NO_RUN', 'HOLD'].includes(state) ? `main is ${state} — no merge this run` : null;
  const blocked = freezes.length
    ? `FROZEN by ${freezes.map((i) => `#${i.number}`).join(', ')} — only its fix-first PR merges until it closes`
    : mainBlocked;
  // AUTO-CLOSE: the first open freeze whose named jobs are green again on main.
  const closing = freezes.map((f) => ({ f, v: freezeCloseVerdict({ freeze: f, check: snap.freezeCheck ?? null }) }));
  const toClose = state === 'RUNNING' ? null : closing.find((c) => c.v.close) ?? null;
  let candidates = [];
  if (state === 'FREEZE') {
    candidates = [{ kind: 'freeze', why: watch.why, freeze: watch.freeze }];
  } else if (state === 'NO_RUN') {
    candidates = [{ kind: 'dispatch-main', why: watch.why }];
  } else if (toClose) {
    candidates = [{ kind: 'close-freeze', issue: toClose.f.number, comment: toClose.v.comment, why: toClose.v.why }];
  } else {
    // A merge needs main settled; during a freeze only a fix-first PR's MERGE survived
    // above. An update-branch or a CI/E2E dispatch only readies a head, so it may go
    // ahead while main's run is still going.
    const writes = mainBlocked ? ['UPDATE', 'DISPATCH_E2E', 'DISPATCH_CI'] : ['MERGE', 'UPDATE', 'DISPATCH_E2E', 'DISPATCH_CI'];
    candidates = decisions
      .filter((d) => writes.includes(d.action))
      .map((d) => {
        const pr = snap.prs.find((p) => p.number === d.number);
        const kind = { MERGE: 'merge', UPDATE: 'update', DISPATCH_E2E: 'dispatch-e2e', DISPATCH_CI: 'dispatch-ci' }[d.action];
        return { kind, pr: { number: pr.number, headSha: pr.headSha, headRef: pr.headRef }, why: d.why };
      });
  }
  return { watch, freezes, decisions, act: candidates[0] ?? null, candidates, blocked, closing: closing.map((c) => c.v.why) };
}

/** The lines a run prints: main, the freeze, every PR's decision, the act. */
export function report(p, { dryRun }) {
  const out = [`main: ${p.watch.state} — ${p.watch.why}`];
  if (p.blocked) out.push(`blocked: ${p.blocked}`);
  for (const c of p.closing ?? []) out.push(`freeze: ${c}`);
  for (const d of p.decisions) out.push(`#${d.number} ${d.action} — ${d.why}`);
  if (!p.decisions.length) out.push('no open pull request into main');
  const act = p.act ? `${p.act.kind}${p.act.pr ? ` #${p.act.pr.number}` : ''}${p.act.issue ? ` #${p.act.issue}` : ''} — ${p.act.why}` : 'nothing to do';
  out.push(`${dryRun ? 'DRY RUN, would act' : 'act'}: ${act}`);
  return out;
}

/**
 * The run's mode. The repository variable (LAND_DRY_RUN) is the floor; a dispatch's
 * own `dry_run` (LAND_DISPATCH_DRY_RUN, empty on every other event) can make a run
 * drier, never wetter: a `dry_run=false` dispatch while the repository is dry is
 * REFUSED — it runs dry and says so. Returns { dry, refusal }.
 */
export function runMode(env = process.env) {
  const repoDry = String(env.LAND_DRY_RUN ?? '').trim() !== 'false';
  const asked = String(env.LAND_DISPATCH_DRY_RUN ?? '').trim();
  if (asked === '') return { dry: repoDry, refusal: null };
  if (asked !== 'false') return { dry: true, refusal: null };
  if (repoDry) {
    return {
      dry: true,
      refusal: 'a `dry_run=false` dispatch is REFUSED while the repository is in its dry-run period (vars.LAND_DRY_RUN is not `false`): this run was dry. The cut-over in docs/ci/land.md ends that period.',
    };
  }
  return { dry: false, refusal: null };
}

export const isDryRun = (env = process.env) => runMode(env).dry;

/** The API budget a run may start with, from GET /rate_limit's `resources.core`.
 *  null = enough; otherwise the refusal. Unreadable is a refusal (fail closed). */
export function budgetProblem(core, floor = API_BUDGET_FLOOR) {
  const remaining = Number(core?.remaining);
  if (!Number.isFinite(remaining)) return 'the API budget (GET /rate_limit) is unreadable';
  if (remaining < floor) return `the API budget is ${remaining}/${core?.limit ?? '?'} requests, below the floor of ${floor}; it resets at ${core?.reset ? new Date(Number(core.reset) * 1000).toISOString() : '?'}`;
  return null;
}

/**
 * Perform the run's ONE write: the candidates in order until one WRITES. A refused
 * pull-request write (nothing written) is printed, that PR skipped, and the next tried;
 * a refused main write (freeze, dispatch-main) stops the run — nothing may pass it.
 * `perform(act)` returns { code, lines, wrote }. Returns { code, lines }.
 */
export async function performQueue(candidates, perform) {
  const lines = [];
  let code = 0;
  for (const act of candidates ?? []) {
    const r = await perform(act);
    lines.push(...r.lines);
    if (r.wrote) return { code: Math.max(code, r.code), lines };
    code = 1;
    if (!act.pr) return { code, lines };
    lines.push(`skipped #${act.pr.number}: its ${act.kind} was refused; trying the next pull request`);
  }
  return { code, lines };
}

// ── PURE: is a dispatch of main the same pipeline as a push to main? ─────────

/**
 * THE PARITY THE WHOLE DESIGN RESTS ON, read off the workflow files. `read(rel)`
 * returns a workflow's text, or null. Every problem is one sentence; [] is parity.
 *   P1  ci.yml declares `workflow_dispatch`, with no `inputs:` (land sends a bare one);
 *   P2  ci.yml and every local workflow it calls: no expression that admits a
 *       `push` and not a `workflow_dispatch` (`github.event_name == 'push'` alone);
 *   P3  …and no read of `github.event.before`/`.after` whose step does not say what
 *       a dispatch uses instead (a dispatch payload carries neither);
 *   P4  every post-merge dispatch target declares `workflow_dispatch` with no
 *       REQUIRED input, and e2e.yml declares one too.
 */
export function dispatchParityProblems(read) {
  const problems = [];
  const ci = read(MAIN_WORKFLOW_PATH);
  if (ci === null) return [`${MAIN_WORKFLOW_PATH} is unreadable — parity cannot be judged`];
  const dispatchBlock = (text) => {
    const lines = text.split('\n');
    const at = lines.findIndex((l) => /^ {2}workflow_dispatch:\s*$/.test(l));
    if (at === -1) return null;
    const body = [];
    for (let i = at + 1; i < lines.length && (/^ {4}/.test(lines[i]) || lines[i].trim() === '' || /^\s*#/.test(lines[i])); i++) body.push(lines[i]);
    return body.join('\n');
  };
  const ciDispatch = dispatchBlock(ci);
  if (ciDispatch === null) problems.push(`P1: ${MAIN_WORKFLOW_PATH} declares no \`workflow_dispatch\`, so a GITHUB_TOKEN merge starts no main pipeline at all`);
  else if (/^ {4}inputs:/m.test(ciDispatch)) problems.push(`P1: ${MAIN_WORKFLOW_PATH}'s \`workflow_dispatch\` declares inputs; land.yml dispatches it bare`);
  const callees = [...ci.matchAll(/^ {4}uses:\s*\.\/(\.github\/workflows\/[^\s#]+)/gm)].map((m) => m[1]);
  // Refuses blind: the deploy calls live in those callees, so a ci.yml whose call lines this
  // no longer recognises would leave them unread while the parity still printed clean.
  if (!callees.length) problems.push(`${MAIN_WORKFLOW_PATH} names no local \`uses: ./.github/workflows/…\` call this reads, so its callees went unread — parity cannot be judged`);
  for (const rel of [MAIN_WORKFLOW_PATH, ...new Set(callees)]) {
    const text = read(rel);
    if (text === null) {
      problems.push(`${rel} is called by ${MAIN_WORKFLOW_PATH} and unreadable`);
      continue;
    }
    const lines = text.split('\n');
    lines.forEach((l, i) => {
      if (/^\s*#/.test(l)) return;
      if (/github\.event_name\s*==\s*'push'/.test(l) && !/github\.event_name\s*==\s*'workflow_dispatch'/.test(l)) {
        problems.push(`P2: ${rel}:${i + 1} admits a push and not a dispatch of main: ${l.trim()}`);
      }
      if (/github\.event\.(?:before|after)\b/.test(l)) {
        // The line falls back to github.sha itself, or its step (the next lines) names the dispatch case.
        const window = lines.slice(i + 1, i + 8).join('\n');
        if (!/\|\|\s*github\.sha\b/.test(l) && !/workflow_dispatch/.test(window)) problems.push(`P3: ${rel}:${i + 1} reads a push-only payload field and its step says nothing for a dispatch: ${l.trim()}`);
      }
    });
  }
  for (const wf of [...POST_MERGE_DISPATCH, E2E_WORKFLOW_PATH.split('/').pop()]) {
    const rel = `.github/workflows/${wf}`;
    const text = read(rel);
    const block = text === null ? null : dispatchBlock(text);
    if (block === null) problems.push(`P4: ${rel} declares no \`workflow_dispatch\`; land.yml dispatches it`);
    else if (/^ {8}required:\s*true\b/m.test(block)) problems.push(`P4: ${rel}'s \`workflow_dispatch\` has a REQUIRED input; land.yml dispatches it with none`);
  }
  return problems;
}

// ── I/O: the snapshot and the one write ─────────────────────────────────────

const API = process.env.GITHUB_API_URL || 'https://api.github.com';

/** Every request a run makes, and the budget GitHub last reported (x-ratelimit-remaining). */
export const budget = { requests: 0, remaining: null };

function client(repo, token) {
  const headers = { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'user-agent': 'nikatru-land-next', 'x-github-api-version': '2022-11-28' };
  const seen = (res) => {
    budget.requests++;
    const left = Number(res.headers?.get?.('x-ratelimit-remaining'));
    if (Number.isFinite(left)) budget.remaining = left;
    return res;
  };
  const getAt = async (url, path) => {
    const res = await fetchWithBoundedRetry(({ signal }) => fetch(url, { headers, signal }).then(seen), { describe: (s) => `GET ${path} — ${s}` });
    if (!res.ok) throw new Error(`GET ${path} → HTTP ${res.status}`);
    return res.json();
  };
  const get = (path) => getAt(`${API}/repos/${repo}${path}`, path);
  // GET /rate_limit is not counted against the budget it reports.
  const rateLimit = async () => (await getAt(`${API}/rate_limit`, '/rate_limit'))?.resources?.core ?? null;
  // A write gets ONE attempt: a re-ask after a lost answer could merge or dispatch twice.
  const write = async (method, path, body) => {
    const res = await fetchWithBoundedRetry(
      ({ signal }) => fetch(`${API}/repos/${repo}${path}`, { method, headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(body), signal }).then(seen),
      { attempts: 1, describe: (s) => `${method} ${path} — ${s}` },
    );
    const text = await res.text().catch(() => '');
    return { ok: res.ok, status: res.status, text };
  };
  // The run-list reads go through anchoredRunRead (its ceiling, its stale-page anchor);
  // this is the one GET it is handed, counted like every other.
  const readUrl = (url, opts) => {
    budget.requests++;
    return githubRead(token, { label: url.replace(API, ''), userAgent: 'nikatru-land-next' })(url, opts);
  };
  return { get, write, rateLimit, readUrl };
}

async function paged(get, path, key = null, cap = 10) {
  const out = [];
  for (let page = 1; page <= cap; page++) {
    const body = await get(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
    const rows = key ? body?.[key] : body;
    if (!Array.isArray(rows)) throw new Error(`${path}: no ${key ?? 'array'} in the answer`);
    out.push(...rows);
    if (rows.length < 100) return { rows: out, complete: true };
  }
  return { rows: out, complete: false };
}

const failedJobNames = (jobs) => (jobs ?? []).filter((j) => RED_JOB.has(String(j?.conclusion))).map((j) => String(j.name));

/**
 * One workflow's runs on one sha, from THAT workflow's listing — never page 1 of every
 * run on the sha, which land.yml's own runs (and any other workflow's) can flood. Read
 * through anchoredRunRead (the shared ceiling and stale-page anchor; a page proven
 * stale is COULD NOT LOOK), graded on its union. Every row must be on the sha asked
 * for, or the read throws (COULD NOT LOOK). `read` is the one GET `(url, { signal })`.
 */
export async function workflowRunsOn(read, { repo, workflowPath, sha, branch = null, nowMs = Date.now() }) {
  const file = workflowPath.split('/').pop();
  const url = `${API}/repos/${repo}/actions/workflows/${file}/runs?head_sha=${sha}${branch ? `&branch=${encodeURIComponent(branch)}` : ''}&per_page=100`;
  const r = await anchoredRunRead({ workflow: file, url, read, nowMs, what: `${file} runs on ${sha.slice(0, 8)}`, label: `${file} runs on ${sha.slice(0, 8)}` });
  if (r.stale) throw new Error(`${r.query}: ${r.verdict.why}`);
  const off = r.union.find((x) => x?.head_sha !== sha);
  if (off) throw new Error(`${r.query} answered run ${off.id} on ${String(off.head_sha).slice(0, 12)}, not ${sha.slice(0, 12)}`);
  return r.union.map((x) => ({ ...x, path: x.path ?? workflowPath }));
}

/**
 * The baseline a red on main is judged against: the failed jobs of the parent's newest
 * COMPLETED run that is a verdict, by mainWatch's own rule — a cancelled run counts when
 * a job in it failed (fail-fast cancels a red run), and is passed over only when none
 * did. null when no such run exists (then every red is new: fail closed).
 * `jobsOf(run)` returns its failed job names.
 */
export async function parentBaseline(runs, jobsOf, cap = 5) {
  const done = (runs ?? []).filter((x) => x.status === 'completed' && x.conclusion !== 'skipped').sort(newestFirst).slice(0, cap);
  for (const r of done) {
    const failed = await jobsOf(r);
    if (r.conclusion !== 'cancelled' || failed.length) return failed;
  }
  return null;
}

const prCommitOf = (c) => ({
  sha: String(c?.sha ?? ''),
  parents: (c?.parents ?? []).map((x) => String(x?.sha ?? '')),
  committer: c?.committer?.login ?? null,
  verified: c?.commit?.verification?.verified === true,
});

/** Read everything one decision needs. Reads only; throws on any unreadable answer.
 *  When no open PR carries `land-ok`, it stops after the PR list (`idle`): main's runs,
 *  the freeze issues and every per-PR read are spared from the shared API budget. */
export async function readSnapshot({ repo, token, now = new Date() }) {
  const { get, readUrl } = client(repo, token);
  const runsOn = (workflowPath, sha, branch = null) => workflowRunsOn(readUrl, { repo, workflowPath, sha, branch, nowMs: now.getTime() });
  const open = (await paged(get, `/pulls?state=open&base=${BASE_BRANCH}`)).rows;
  const entryOf = (p) => ({ number: p.number, title: p.title, body: p.body ?? '', state: p.state, draft: Boolean(p.draft), labels: (p.labels ?? []).map((l) => l.name), baseRef: p.base?.ref, headSha: p.head?.sha, headRef: p.head?.ref, headRepo: p.head?.repo?.full_name ?? null });
  const queued = (e) => !e.draft && e.labels.some(isLandLabel);
  if (!open.map(entryOf).some(queued)) return { repo, now: now.toISOString(), idle: true, prs: open.map(entryOf) };
  const head = await get(`/commits/${BASE_BRANCH}`);
  const main = { sha: head.sha, parentSha: head.parents?.[0]?.sha ?? null, committedAt: head.commit?.committer?.date ?? null };
  const mainRuns = [];
  for (const wf of WATCHED_PATHS) mainRuns.push(...(await runsOn(wf, main.sha, BASE_BRANCH)));
  const failedJobs = {};
  const baseline = {};
  const jobsOf = async (r) => failedJobNames((await get(`/actions/runs/${r.id}/jobs?filter=latest&per_page=100`)).jobs);
  for (const r of mainRuns) {
    // A cancelled run's jobs are read too: fail-fast cancels a red run (mainWatch).
    if (r.status === 'completed' && WATCHED_PATHS.includes(pathOf(r)) && !['success', 'skipped', 'neutral'].includes(String(r.conclusion))) {
      failedJobs[String(r.id)] = await jobsOf(r);
      const wf = pathOf(r);
      if (main.parentSha && !(wf in baseline)) baseline[wf] = await parentBaseline(await runsOn(wf, main.parentSha, BASE_BRANCH), jobsOf);
    }
  }
  const issues = (await paged(get, `/issues?labels=${FREEZE_LABEL}&state=all`)).rows.filter((i) => !i.pull_request);
  const freezes = issues.filter((i) => i.state === 'open').map((i) => ({ number: i.number, title: i.title, state: i.state, body: i.body ?? '' }));
  // The auto-close input, read only while a freeze is open: each watched workflow's
  // newest run at the head, its jobs, and the parent's failed jobs (the baseline).
  // One part per WATCHED workflow (ci.yml AND codeql.yml), unioned by unionFreezeChecks:
  // a freeze naming a CodeQL job closes on codeql's own run, never waits on ci.yml's.
  let freezeCheck = null;
  if (freezes.length) {
    const parts = [];
    for (const wf of WATCHED_PATHS) {
      const top = mainRuns.filter((r) => r?.head_sha === main.sha && r?.head_branch === BASE_BRANCH && POST_GATE_EVENTS.includes(String(r?.event ?? '')) && pathOf(r) === wf).sort(newestFirst)[0];
      if (!top) continue;
      const jobs = top.status === 'completed' ? ((await get(`/actions/runs/${top.id}/jobs?filter=latest&per_page=100`)).jobs ?? []).map((j) => ({ name: j.name, conclusion: j.conclusion })) : [];
      let base = baseline[wf];
      if (base === undefined && main.parentSha && jobs.some((j) => RED_JOB.has(String(j.conclusion)))) base = await parentBaseline(await runsOn(wf, main.parentSha, BASE_BRANCH), jobsOf);
      parts.push({ runId: top.id, url: top.html_url, status: top.status, conclusion: top.conclusion, jobs, baseline: base ?? null });
    }
    freezeCheck = unionFreezeChecks(parts);
  }
  const freezeMarkers = issues.map((i) => (/<!-- land-freeze run=\d+ -->/.exec(String(i.body ?? '')) ?? [null])[0]).filter(Boolean);
  const units = JSON.parse(readFileSync(join(ROOT, 'tooling/ci/lane-map.json'), 'utf8')).deployUnits ?? {};
  if (!Object.keys(units).length) throw new Error(`${NO_UNITS}: the skew rule cannot tell one deploy unit from another`);
  const prs = [];
  for (const p of open) {
    const entry = entryOf(p);
    if (!queued(entry)) {
      prs.push(entry);
      continue;
    }
    const full = await get(`/pulls/${p.number}`);
    const events = (await paged(get, `/issues/${p.number}/events`)).rows;
    const labelTimes = {};
    for (const e of events) if (e.event === 'labeled' && isLandLabel(e.label?.name) && !(labelTimes[e.label.name] >= e.created_at)) labelTimes[e.label.name] = e.created_at;
    const forcePushes = events.filter((e) => e.event === 'head_ref_force_pushed').map((e) => e.created_at);
    const checks = (await get(`/commits/${p.head.sha}/check-runs?check_name=ci-gate&per_page=100`)).check_runs ?? [];
    const commitList = await paged(get, `/pulls/${p.number}/commits`, null, Math.ceil(PR_COMMIT_CAP / 100));
    const commits = commitList.rows.map(prCommitOf);
    const headCommit = commits.find((c) => c.sha === p.head.sha);
    const headRaw = commitList.rows.find((c) => c?.sha === p.head.sha);
    const runs = [...(await runsOn(MAIN_WORKFLOW_PATH, p.head.sha)), ...(await runsOn(E2E_WORKFLOW_PATH, p.head.sha))];
    const files = await paged(get, `/pulls/${p.number}/files`, null, PR_FILE_CAP / 100);
    const cmp = await get(`/compare/${p.head.sha}...${BASE_BRANCH}`);
    // Queue order: the newest land-ok label currently on the PR.
    const labeledAt = entry.labels.filter(isLandLabel).map((n) => labelTimes[n]).filter(Boolean).sort().at(-1) ?? null;
    const snapPr = { ...entry, labeledAt, labelTimes, forcePushes, commits, commitsComplete: commitList.complete && commits.length < PR_COMMIT_CAP && Boolean(headCommit) };
    // Which head the label approved, and — when an update-branch moved the head since —
    // whether the changes against main are still the approved ones. A compare that
    // cannot be read is null, and the PR waits (decidePr); it never blocks the queue.
    const bind = bindingOf(snapPr);
    let reviewedDiff = null;
    let headDiff = null;
    if (bind.sha && bind.sha !== p.head.sha) {
      const print = async (sha) => {
        try {
          return diffPrint(await get(`/compare/${BASE_BRANCH}...${sha}`));
        } catch {
          return null;
        }
      };
      reviewedDiff = await print(bind.sha);
      headDiff = await print(p.head.sha);
    }
    // The review gate's input, read for every PR reviewRequired names: the label OR
    // its own file list (re-derived here, never trusted to the label alone).
    const reviews = reviewRequired({ labels: entry.labels, files: files.rows.map((f) => f.filename), filesComplete: files.complete }) ? (await paged(get, `/pulls/${p.number}/reviews`)).rows.map((r) => ({ id: r.id, author_association: r.author_association, body: r.body, commit_id: r.commit_id, submitted_at: r.submitted_at, state: r.state })) : [];
    prs.push({
      reviews,
      ...snapPr,
      // The head's age is its COMMITTER date: author-controlled, not the push time. An
      // old-dated push is dispatched at once beside its own pull_request run (one wasted
      // run toward HEAD_DISPATCH_CAP), never merged on it (docs/ci/land.md).
      headCommittedAt: headRaw?.commit?.committer?.date ?? null,
      reviewedDiff,
      headDiff,
      mergeable: full.mergeable,
      mergeableState: full.mergeable_state,
      checks,
      runs,
      e2eRuns: runs.filter((r) => pathOf(r) === E2E_WORKFLOW_PATH),
      files: files.rows.map((f) => f.filename),
      filesComplete: files.complete,
      behindBy: cmp.ahead_by,
      mainFiles: (cmp.files ?? []).map((f) => f.filename),
      mainFilesComplete: (cmp.files ?? []).length < COMPARE_FILE_CAP,
    });
  }
  return { repo, now: now.toISOString(), main, mainRuns, failedJobs, baseline, freezes, freezeMarkers, freezeCheck, units, prs };
}

/** Each named failing job of `run`: its first failing step and its raw log (null when unreadable). */
async function freezeJobLogs({ repo, token, run, names }) {
  const { get } = client(repo, token);
  const jobs = (await get(`/actions/runs/${run.id}/jobs?filter=latest&per_page=100`)).jobs ?? [];
  const out = [];
  for (const name of names) {
    const j = jobs.find((x) => x.name === name);
    const step = j?.steps?.find((s) => RED_JOB.has(String(s.conclusion)))?.name ?? null;
    let log = null;
    if (j) {
      // The logs endpoint answers 302 to a short-lived signed URL; fetch follows it and
      // drops the authorization header on the cross-origin hop.
      const res = await fetchWithBoundedRetry(({ signal }) => fetch(`${API}/repos/${repo}/actions/jobs/${j.id}/logs`, { headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'user-agent': 'nikatru-land-next' }, signal }), { describe: (s) => `GET job ${j.id} logs — ${s}` });
      if (res.ok) log = await res.text();
    }
    out.push({ name, step, log });
  }
  return out;
}

const DISPATCH_REFUSED = (wf, r) => `dispatch ${wf} answered HTTP ${r.status} ${r.text.slice(0, 200)}`;

/** The ONE write. Returns { code, lines, wrote } — `wrote` false when nothing was written. */
export async function perform(act, { repo, token }) {
  const r = await performOne(act, { repo, token });
  return { ...r, wrote: r.wrote ?? r.code === 0 };
}

async function performOne(act, { repo, token }) {
  const { write } = client(repo, token);
  const dispatch = async (wf, ref, inputs) => write('POST', `/actions/workflows/${wf}/dispatches`, inputs ? { ref, inputs } : { ref });
  if (act.kind === 'freeze') {
    // The fixer's input: each new failing job's first failing step and log tail. A read
    // that fails leaves that job's tail out ("could not be read"); the issue still opens.
    let logs = '';
    try {
      logs = `\n\n${freezeLogSection(await freezeJobLogs({ repo, token, run: act.freeze.run, names: act.freeze.jobs }))}`;
    } catch (e) {
      logs = `\n\n_The failing jobs' logs could not be read (${String(e.message).slice(0, 120)})._`;
    }
    const r = await write('POST', '/issues', { title: act.freeze.title, body: `${act.freeze.body}${logs}`, labels: [FREEZE_LABEL] });
    return r.ok ? { code: 0, lines: [`opened the ${FREEZE_LABEL} issue for run ${act.freeze.run.id}`] } : { code: 1, lines: [`opening the ${FREEZE_LABEL} issue answered HTTP ${r.status} ${r.text.slice(0, 200)}`] };
  }
  if (act.kind === 'close-freeze') {
    const c = await write('POST', `/issues/${act.issue}/comments`, { body: act.comment });
    if (!c.ok) return { code: 1, lines: [`commenting on ${FREEZE_LABEL} #${act.issue} answered HTTP ${c.status} ${c.text.slice(0, 200)}`] };
    const r = await write('PATCH', `/issues/${act.issue}`, { state: 'closed', state_reason: 'completed' });
    return r.ok ? { code: 0, lines: [`closed ${FREEZE_LABEL} #${act.issue}: ${act.why}`] } : { code: 1, lines: [`closing ${FREEZE_LABEL} #${act.issue} answered HTTP ${r.status} ${r.text.slice(0, 200)}`] };
  }
  if (act.kind === 'dispatch-main') {
    const r = await dispatch('ci.yml', BASE_BRANCH);
    return r.status === 204 ? { code: 0, lines: [`dispatched ci.yml on ${BASE_BRANCH}`] } : { code: 1, lines: [DISPATCH_REFUSED('ci.yml', r)] };
  }
  if (act.kind === 'update') {
    const r = await write('PUT', `/pulls/${act.pr.number}/update-branch`, { expected_head_sha: act.pr.headSha });
    // GITHUB_TOKEN's update starts no CI: a later run dispatches ci.yml on the new head
    // once it is MAIN_RUN_GRACE_MS old with no run (decidePr, DISPATCH_CI).
    return r.status === 202
      ? { code: 0, lines: [`updated #${act.pr.number} from ${BASE_BRANCH}; a later run dispatches ci.yml on its new head`] }
      : { code: 1, lines: [`update-branch #${act.pr.number} answered HTTP ${r.status} ${r.text.slice(0, 200)}`] };
  }
  if (act.kind === 'dispatch-ci') {
    const r = await dispatch('ci.yml', act.pr.headRef);
    return r.status === 204 ? { code: 0, lines: [`dispatched ci.yml on ${act.pr.headRef} for #${act.pr.number}`] } : { code: 1, lines: [DISPATCH_REFUSED('ci.yml', r)] };
  }
  if (act.kind === 'dispatch-e2e') {
    const r = await dispatch('e2e.yml', act.pr.headRef);
    return r.status === 204 ? { code: 0, lines: [`dispatched e2e.yml on ${act.pr.headRef} for #${act.pr.number}`] } : { code: 1, lines: [DISPATCH_REFUSED('e2e.yml', r)] };
  }
  if (act.kind === 'merge') {
    const m = await write('PUT', `/pulls/${act.pr.number}/merge`, { merge_method: 'squash', sha: act.pr.headSha });
    if (!m.ok) return { code: 1, lines: [`merge #${act.pr.number} at ${act.pr.headSha.slice(0, 8)} answered HTTP ${m.status} ${m.text.slice(0, 200)}`] };
    // Merged: whatever a dispatch below answers, this run has made its write.
    const wrote = true;
    const lines = [`merged #${act.pr.number} (squash, head ${act.pr.headSha.slice(0, 8)})`];
    let code = 0;
    // A GITHUB_TOKEN merge starts no run: main's pipeline is started here, ci.yml first.
    for (const wf of POST_MERGE_DISPATCH) {
      const r = await dispatch(wf, BASE_BRANCH);
      if (r.status === 204) lines.push(`dispatched ${wf} on ${BASE_BRANCH}`);
      else {
        lines.push(`${DISPATCH_REFUSED(wf, r)} — the next run re-dispatches ci.yml once main's head is ${MAIN_RUN_GRACE_MS / 60_000} min old with no run`);
        code = 1;
      }
    }
    return { code, lines, wrote };
  }
  return { code: 1, lines: [`unknown act ${JSON.stringify(act.kind)}`] };
}

async function main(argv) {
  const say = (lines) => {
    for (const l of lines) console.log(l);
  };
  const mode = runMode();
  const dryRun = mode.dry;
  const at = argv.indexOf('--snapshot');
  let snap;
  if (at !== -1) {
    try {
      snap = JSON.parse(readFileSync(argv[at + 1], 'utf8'));
    } catch (e) {
      say([`COULD NOT LOOK — the snapshot could not be read (${e.message})`]);
      return 2;
    }
    say(report(plan(snap), { dryRun: true }));
    return 0;
  }
  const repo = process.env.GITHUB_REPOSITORY ?? '';
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo) || !token) {
    say(['COULD NOT LOOK — GITHUB_REPOSITORY and GITHUB_TOKEN (or GH_TOKEN) are required']);
    return 2;
  }
  const spent = () => `API budget: this run made ${budget.requests} request(s); ${budget.remaining ?? '?'} remaining`;
  try {
    const core = await client(repo, token).rateLimit();
    const low = budgetProblem(core);
    if (low) {
      say([`COULD NOT LOOK — ${low}. Nothing was read or written.`]);
      return 2;
    }
    say([`API budget: ${core.remaining}/${core.limit} remaining at the start (floor ${API_BUDGET_FLOOR})`]);
    snap = await readSnapshot({ repo, token });
  } catch (e) {
    say([`COULD NOT LOOK — ${e.message}. Nothing was written.`, spent()]);
    return 2;
  }
  const p = plan(snap);
  say(report(p, { dryRun }));
  if (mode.refusal) {
    say([`REFUSED — ${mode.refusal}`, spent()]);
    return 1;
  }
  if (dryRun || !p.act) {
    say([spent()]);
    return 0;
  }
  const r = await performQueue(p.candidates, (act) => perform(act, { repo, token }));
  say([...r.lines, spent()]);
  return r.code;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
