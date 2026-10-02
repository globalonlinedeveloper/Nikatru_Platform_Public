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
//   eligible  open, not draft, base main, label `land-ok`, the NEWEST ci-gate run
//             on the head GREEN (land-rules.mjs rule a — the newest RUN decides,
//             never the first rollup entry), mergeable.
//   freeze    an OPEN issue labelled `land-freeze` stops every merge.
//   skew      a head behind main is updated (update-branch) and re-tested, UNLESS
//             its changes are disjoint from main's new changes (`skewVerdict`).
//             OVERLAP and UNKNOWN fail closed: they update.
//   E2E       a head touching apps/*/(lib|integration_test|web|assets) or
//             packages/*/lib needs a green `E2E live` run on that head; one with
//             none is dispatched on the PR's branch (same repository only).
//   merge     squash, with the head sha the decision read (`sha`, GitHub's
//             --match-head-commit); then main's pipeline is dispatched.
//   watch     main's newest CI run at main's head: running → no merge; red with a
//             failing job that was NOT failing on the parent's run → a
//             `land-freeze` issue naming the run and the job. Only ci.yml and
//             codeql.yml are judged, so the attended dispatches (Rollback, Native
//             auth proof, Store submit) never count.
//   review    ⏱ 2026-10-02 (O-REVIEWS-DEPEND-ON-THE-LAPTOP) a `land-hold` label waits; a
//             `needs-review` PR waits until the NEWEST owner verdict review (line 1
//             `VERDICT: APPROVE`) is on the current head, with `review:approve`
//             (`reviewVerdict`). Labels set by review-gate.yml; verdicts posted by
//             tooling/autopilot/post-verdict.mjs.
//   fix-first ⏱ 2026-10-02 (O-FREEZE-FIX-NEEDS-THE-LAPTOP) the freeze issue carries each
//             new failing job's first failing step and log tail (`freezeLogSection`);
//             while it is open, a PR labelled `fix-first` whose body says
//             `Fixes-freeze: #<it>` may merge (every other rule still applies), and a
//             later pass CLOSES it once main's newest ci.yml run at the head has every
//             named job green and no red that was not already red on the parent
//             (`freezeCloseVerdict`). The fixer routine is docs/autopilot/fixer.prompt.md.
//   one       ONE write per run (a merge, an update-branch, an E2E dispatch, a
//             main dispatch or a freeze), in order of land-ok label time, then
//             PR number. `concurrency: land` makes the run itself the one actor.
//
// ── DRY RUN IS THE DEFAULT ──────────────────────────────────────────────────
// LAND_DRY_RUN is anything but the exact string `false` → print every open PR's
// decision and reason, and write NOTHING. The cut-over (the lead's) runs it dry
// beside the laptop landers for a day, then sets the repository variable.
//
// Usage:
//   node tooling/ci/land-next.mjs                      live: GITHUB_TOKEN/GH_TOKEN, GITHUB_REPOSITORY
//   node tooling/ci/land-next.mjs --snapshot <file>    decide from a recorded snapshot, write nothing
//   env  LAND_DRY_RUN  `false` to act; anything else (or unset) is a dry run
// Exit 0 = decided (and, live, acted or had nothing to do).
//      1 = a write was refused (merge, update, dispatch, issue) — the reason is printed.
//      2 = COULD NOT LOOK: a read failed or the snapshot is unreadable. Nothing was written.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gateVerdict, newReds, MAIN_WORKFLOW, MAIN_WORKFLOW_PATH } from '../ops/land-rules.mjs';
import { fetchWithBoundedRetry } from '../ops/bounded-retry.mjs';
import { globClaims } from './deploy-globs.mjs';
import { POST_GATE_EVENTS } from '../ops/post-gate.mjs';
import { CONTRACT } from '../autopilot/cli.mjs';

const ROOT = resolve(join(dirname(fileURLToPath(import.meta.url)), '..', '..'));

export const LAND_LABEL = 'land-ok';
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
 *  APPROVE from a PR's author, and every PR here has one author). */
export const VERDICT_LINE = /^VERDICT: (APPROVE|CHANGES)\s*$/;
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
 *   HOLD     CI here was cancelled or missing MAIN_DISPATCH_CAP times: a person reads it
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
  if (top.conclusion === 'cancelled' || top.conclusion === 'skipped') {
    if (ci.length >= MAIN_DISPATCH_CAP) return { state: 'HOLD', why: `main ${at}: CI run ${top.id} is ${top.conclusion} and ${ci.length} CI runs here already — re-run it by hand once the cause is read` };
    return { state: 'NO_RUN', why: `main ${at}: CI run ${top.id} is ${top.conclusion}, not a verdict`, act: { kind: 'dispatch-main' } };
  }
  const reds = [...newest.values()].filter((r) => !['success', 'skipped', 'neutral', 'cancelled'].includes(String(r.conclusion)));
  if (!reds.length) return { state: 'GREEN', why: `main ${at}: ${[...newest.values()].map((r) => `${pathOf(r).split('/').pop()} run ${r.id} success`).join(', ')}` };
  const fresh = [];
  for (const r of reds) {
    const wf = pathOf(r);
    const failing = (failedJobs[String(r.id)] ?? null) === null ? [`${wf.split('/').pop()} (its jobs could not be read)`] : failedJobs[String(r.id)];
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
export function freezeCloseVerdict({ freeze, check }) {
  const named = freezeJobs(freeze?.body);
  const stay = (why) => ({ close: false, why: `#${freeze?.number} stays open: ${why}` });
  if (!check) return stay("main's newest ci.yml run at the head was not read");
  if (check.status !== 'completed') return stay(`ci.yml run ${check.runId} is ${check.status}`);
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
    .map((r) => ({ r, m: VERDICT_LINE.exec(String(r?.body ?? '').split(/\r?\n/)[0]) }))
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

// ── PURE: one pull request ──────────────────────────────────────────────────

/**
 * What to do with one open pull request. `pr` is the snapshot's PR entry; `repo`
 * the owner/name. Returns { action, why } with action one of
 *   MERGE · UPDATE · DISPATCH_E2E  (writes, in that preference)
 *   WAIT   (pending: CI, mergeability, E2E running) · SKIP (not eligible).
 */
export function decidePr(pr, { repo, units }) {
  const skip = (why) => ({ action: 'SKIP', why });
  const wait = (why) => ({ action: 'WAIT', why });
  if (pr.state !== 'open') return skip(`state ${pr.state}`);
  if (pr.draft) return skip('draft');
  if (!(pr.labels ?? []).includes(LAND_LABEL)) return skip(`no \`${LAND_LABEL}\` label`);
  if (pr.baseRef !== BASE_BRANCH) return skip(`base is ${pr.baseRef}, not ${BASE_BRANCH}`);
  if (!/^[0-9a-f]{40}$/.test(String(pr.headSha ?? ''))) return skip('no readable head sha');
  if ((pr.labels ?? []).includes(HOLD_LABEL)) return wait(`\`${HOLD_LABEL}\`: held by the lead`);
  let reviewed = '';
  if ((pr.labels ?? []).includes(NEEDS_REVIEW_LABEL)) {
    const rv = reviewVerdict({ reviews: pr.reviews, headSha: pr.headSha, labels: pr.labels });
    if (!rv.ok) return wait(rv.why);
    reviewed = `, ${rv.why}`;
  }
  const g = gateVerdict(pr.checks ?? [], { runs: gateRuns(pr.runs) });
  if (g.verdict === 'RED') return skip(`ci-gate RED — ${g.why}`);
  if (g.verdict !== 'GREEN') return wait(`ci-gate ${g.verdict} — ${g.why}`);
  if (pr.mergeable === false || pr.mergeableState === 'dirty') return skip('merge conflict with main');
  if (pr.mergeable !== true) return wait('GitHub has not computed mergeability yet');
  if (!Array.isArray(pr.files) || pr.filesComplete === false) return skip("the PR's file list is unreadable or cut at the API's cap: land it by hand");
  if (Number(pr.behindBy) > 0) {
    const s = skewVerdict({ prFiles: pr.files, mainFiles: pr.mainFiles, mainComplete: pr.mainFilesComplete !== false, units });
    if (s.verdict !== 'DISJOINT') return { action: 'UPDATE', why: `${pr.behindBy} commit(s) behind main, skew ${s.verdict}: ${s.why}` };
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
  return { action: 'MERGE', why: `ci-gate GREEN, mergeable${skew}${needsE2E(pr.files) ? ', E2E green' : ''}${reviewed}` };
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
 *   { watch, freezes, decisions: [{ number, action, why }], act }
 * `act` is the ONE write this run makes, or null: { kind: 'freeze' | 'dispatch-main'
 * | 'merge' | 'update' | 'dispatch-e2e', pr?, why }. A dry run prints it and does
 * nothing else.
 */
export function plan(snap) {
  const units = snap.units ?? {};
  const watch = mainWatch({ main: snap.main, runs: snap.mainRuns, failedJobs: snap.failedJobs, baseline: snap.baseline, now: Date.parse(snap.now ?? '') || Date.now() });
  const freezes = (snap.freezes ?? []).filter((i) => i?.state === 'open');
  const openFreezes = (snap.freezes ?? []).filter((i) => i?.state === 'open');
  const decisions = queueOrder(snap.prs).map((pr) => {
    const d = { number: pr.number, title: pr.title ?? '', ...decidePr(pr, { repo: snap.repo, units }) };
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
  let act = null;
  if (state === 'FREEZE') {
    act = { kind: 'freeze', why: watch.why, freeze: watch.freeze };
  } else if (state === 'NO_RUN') {
    act = { kind: 'dispatch-main', why: watch.why };
  } else if (toClose) {
    act = { kind: 'close-freeze', issue: toClose.f.number, comment: toClose.v.comment, why: toClose.v.why };
  } else {
    // A merge needs main settled; during a freeze only a fix-first PR's MERGE survived
    // above. An update-branch or an E2E dispatch only readies a head, so it may go
    // ahead while main's run is still going.
    const writes = mainBlocked ? ['UPDATE', 'DISPATCH_E2E'] : ['MERGE', 'UPDATE', 'DISPATCH_E2E'];
    const next = decisions.find((d) => writes.includes(d.action));
    if (next) {
      const pr = snap.prs.find((p) => p.number === next.number);
      const kind = { MERGE: 'merge', UPDATE: 'update', DISPATCH_E2E: 'dispatch-e2e' }[next.action];
      act = { kind, pr: { number: pr.number, headSha: pr.headSha, headRef: pr.headRef }, why: next.why };
    }
  }
  return { watch, freezes, decisions, act, blocked, closing: closing.map((c) => c.v.why) };
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

export const isDryRun = (env = process.env) => String(env.LAND_DRY_RUN ?? '').trim() !== 'false';

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

function client(repo, token) {
  const headers = { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'user-agent': 'nikatru-land-next', 'x-github-api-version': '2022-11-28' };
  const get = async (path) => {
    const res = await fetchWithBoundedRetry(({ signal }) => fetch(`${API}/repos/${repo}${path}`, { headers, signal }), { describe: (s) => `GET ${path} — ${s}` });
    if (!res.ok) throw new Error(`GET ${path} → HTTP ${res.status}`);
    return res.json();
  };
  // A write gets ONE attempt: a re-ask after a lost answer could merge or dispatch twice.
  const write = async (method, path, body) => {
    const res = await fetchWithBoundedRetry(
      ({ signal }) => fetch(`${API}/repos/${repo}${path}`, { method, headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(body), signal }),
      { attempts: 1, describe: (s) => `${method} ${path} — ${s}` },
    );
    const text = await res.text().catch(() => '');
    return { ok: res.ok, status: res.status, text };
  };
  return { get, write };
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

/** Read everything one decision needs. Reads only; throws on any unreadable answer. */
export async function readSnapshot({ repo, token, now = new Date() }) {
  const { get } = client(repo, token);
  const head = await get(`/commits/${BASE_BRANCH}`);
  const main = { sha: head.sha, parentSha: head.parents?.[0]?.sha ?? null, committedAt: head.commit?.committer?.date ?? null };
  const mainRuns = (await get(`/actions/runs?head_sha=${main.sha}&per_page=100`)).workflow_runs ?? [];
  const failedJobs = {};
  const baseline = {};
  for (const r of mainRuns) {
    if (r.status === 'completed' && WATCHED_PATHS.includes(pathOf(r)) && !['success', 'skipped', 'neutral', 'cancelled'].includes(String(r.conclusion))) {
      failedJobs[String(r.id)] = failedJobNames((await get(`/actions/runs/${r.id}/jobs?filter=latest&per_page=100`)).jobs);
      const wf = pathOf(r);
      if (main.parentSha && !(wf in baseline)) {
        const prev = ((await get(`/actions/runs?head_sha=${main.parentSha}&per_page=100`)).workflow_runs ?? [])
          .filter((x) => pathOf(x) === wf && x.status === 'completed' && x.conclusion !== 'cancelled')
          .sort(newestFirst)[0];
        baseline[wf] = prev ? failedJobNames((await get(`/actions/runs/${prev.id}/jobs?filter=latest&per_page=100`)).jobs) : null;
      }
    }
  }
  const issues = (await paged(get, `/issues?labels=${FREEZE_LABEL}&state=all`)).rows.filter((i) => !i.pull_request);
  const freezes = issues.filter((i) => i.state === 'open').map((i) => ({ number: i.number, title: i.title, state: i.state, body: i.body ?? '' }));
  // The auto-close input, read only while a freeze is open: main's newest COMPLETED
  // ci.yml run at the head, its jobs, and the parent's failed jobs (the baseline).
  let freezeCheck = null;
  if (freezes.length) {
    const top = mainRuns.filter((r) => r?.head_sha === main.sha && r?.head_branch === BASE_BRANCH && POST_GATE_EVENTS.includes(String(r?.event ?? '')) && pathOf(r) === MAIN_WORKFLOW_PATH).sort(newestFirst)[0];
    if (top) {
      const jobs = top.status === 'completed' ? ((await get(`/actions/runs/${top.id}/jobs?filter=latest&per_page=100`)).jobs ?? []).map((j) => ({ name: j.name, conclusion: j.conclusion })) : [];
      let base = baseline[MAIN_WORKFLOW_PATH];
      if (base === undefined && main.parentSha && jobs.some((j) => RED_JOB.has(String(j.conclusion)))) {
        const prev = ((await get(`/actions/runs?head_sha=${main.parentSha}&per_page=100`)).workflow_runs ?? []).filter((x) => pathOf(x) === MAIN_WORKFLOW_PATH && x.status === 'completed' && x.conclusion !== 'cancelled').sort(newestFirst)[0];
        base = prev ? failedJobNames((await get(`/actions/runs/${prev.id}/jobs?filter=latest&per_page=100`)).jobs) : null;
      }
      freezeCheck = { runId: top.id, url: top.html_url, status: top.status, conclusion: top.conclusion, jobs, baseline: base ?? null };
    }
  }
  const freezeMarkers = issues.map((i) => (/<!-- land-freeze run=\d+ -->/.exec(String(i.body ?? '')) ?? [null])[0]).filter(Boolean);
  const units = JSON.parse(readFileSync(join(ROOT, 'tooling/ci/lane-map.json'), 'utf8')).deployUnits ?? {};
  if (!Object.keys(units).length) throw new Error(`${NO_UNITS}: the skew rule cannot tell one deploy unit from another`);
  const open = (await paged(get, `/pulls?state=open&base=${BASE_BRANCH}`)).rows;
  const prs = [];
  for (const p of open) {
    const labels = (p.labels ?? []).map((l) => l.name);
    const entry = { number: p.number, title: p.title, body: p.body ?? '', state: p.state, draft: Boolean(p.draft), labels, baseRef: p.base?.ref, headSha: p.head?.sha, headRef: p.head?.ref, headRepo: p.head?.repo?.full_name ?? null };
    if (!labels.includes(LAND_LABEL) || p.draft) {
      prs.push(entry);
      continue;
    }
    const full = await get(`/pulls/${p.number}`);
    const events = (await paged(get, `/issues/${p.number}/events`)).rows;
    const labeled = events.filter((e) => e.event === 'labeled' && e.label?.name === LAND_LABEL).map((e) => e.created_at).sort();
    const checks = (await get(`/commits/${p.head.sha}/check-runs?check_name=ci-gate&per_page=100`)).check_runs ?? [];
    const runs = (await get(`/actions/runs?head_sha=${p.head.sha}&per_page=100`)).workflow_runs ?? [];
    const files = await paged(get, `/pulls/${p.number}/files`, null, PR_FILE_CAP / 100);
    const cmp = await get(`/compare/${p.head.sha}...${BASE_BRANCH}`);
    // The review gate's input, read only for a PR that carries `needs-review`.
    const reviews = labels.includes(NEEDS_REVIEW_LABEL) ? (await paged(get, `/pulls/${p.number}/reviews`)).rows.map((r) => ({ id: r.id, author_association: r.author_association, body: r.body, commit_id: r.commit_id, submitted_at: r.submitted_at, state: r.state })) : [];
    prs.push({
      reviews,
      ...entry,
      labeledAt: labeled.at(-1) ?? null,
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

/** The ONE write. Returns { code, lines }. */
export async function perform(act, { repo, token }) {
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
    return r.status === 202 ? { code: 0, lines: [`updated #${act.pr.number} from ${BASE_BRANCH}; its CI re-runs`] } : { code: 1, lines: [`update-branch #${act.pr.number} answered HTTP ${r.status} ${r.text.slice(0, 200)}`] };
  }
  if (act.kind === 'dispatch-e2e') {
    const r = await dispatch('e2e.yml', act.pr.headRef);
    return r.status === 204 ? { code: 0, lines: [`dispatched e2e.yml on ${act.pr.headRef} for #${act.pr.number}`] } : { code: 1, lines: [DISPATCH_REFUSED('e2e.yml', r)] };
  }
  if (act.kind === 'merge') {
    const m = await write('PUT', `/pulls/${act.pr.number}/merge`, { merge_method: 'squash', sha: act.pr.headSha });
    if (!m.ok) return { code: 1, lines: [`merge #${act.pr.number} at ${act.pr.headSha.slice(0, 8)} answered HTTP ${m.status} ${m.text.slice(0, 200)}`] };
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
    return { code, lines };
  }
  return { code: 1, lines: [`unknown act ${JSON.stringify(act.kind)}`] };
}

async function main(argv) {
  const say = (lines) => {
    for (const l of lines) console.log(l);
  };
  const dryRun = isDryRun();
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
  try {
    snap = await readSnapshot({ repo, token });
  } catch (e) {
    say([`COULD NOT LOOK — ${e.message}. Nothing was written.`]);
    return 2;
  }
  const p = plan(snap);
  say(report(p, { dryRun }));
  if (dryRun || !p.act) return 0;
  const r = await perform(p.act, { repo, token });
  say(r.lines);
  return r.code;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
