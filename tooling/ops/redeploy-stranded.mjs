#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// redeploy-stranded.mjs — a deploy lane that died on "Require ci-gate to have
// passed for this commit" is re-entered once ci-gate is green again, and only
// then, and only once.
//
// 🔴 THE INSTANCE, 2026-09-22 (O-CI-GATE-CASCADE-STRANDS-THE-DEPLOY-LANES).
// PR #875 merged as 2c4540fa. `CI on main` #3667 went red on a sitemap
// <lastmod> date. `Deploy web` #426 and `Deploy workers` #168 both started on
// 2c4540fa at 18:44:29Z and both FAILED on the gate step — a consequence of the
// red gate, not a defect of their own. The site-drift repair then merged
// 35147514, which changed ONLY sites/nikatru/sitemap.xml; `CI on main` #3669 was
// green. But that path matches neither lane's `push: paths:`, and neither lane
// declared any other trigger, so nothing re-entered them. The app bundle and
// both Workers stayed on the previous build while every merge-path rail read
// green, until a scheduled Ops watch noticed ~17 minutes later.
//
// ⚠️ NOTE WHAT THE INSTANCE WAS NOT: A SAME-SHA CASE. ci-gate NEVER went green on
// 2c4540fa; it went green on the NEXT commit. So "re-run the deploy run for the
// SHA CI just passed" would have done nothing tonight — the run to re-run was on
// a SHA whose gate is red for ever. This tool therefore reasons about the lane's
// NEWEST run against main's CURRENT head, and has two ways back in:
//
//   · the stranded run IS at head → re-run its failed jobs, through
//     tooling/ops/safe-rerun.mjs, the sanctioned concurrency-aware re-run path.
//     Same event, same SHA, so deploy-workers' per-service path filter decides
//     exactly as it did the first time.
//   · the stranded run is at an ANCESTOR of head → dispatch the lane on main.
//     WHY THAT IS SAFE DEPENDS ON WHAT STARTS THE LANE, and there are two kinds:
//     - a PUSH lane (deploy-web, deploy-workers): every commit between the two
//       matched none of the lane's `push: paths:` (else the lane would have a
//       NEWER run and that would be the one read), so head's lane inputs ARE the
//       stranded commit's lane inputs: dispatching deploys exactly the payload
//       that was stranded, gated on a green ci-gate. (deploy-workers on dispatch
//       deploys BOTH Workers — its own `decide` step has no diff to filter on.
//       Redeploying an unchanged Worker is idempotent; that is what the hand
//       remedy did on 2026-09-22 too.)
//     - a CADENCE lane (build-platforms: a GitHub schedule, and the Worker's
//       84-hour dispatch): the paths argument does not exist — the lane has no
//       push trigger — and is not needed. The lane's job is to build main's head
//       each slot, so the dispatch at head is exactly what the next slot would
//       do; nothing at the stranded SHA is recoverable anyway (ci-gate there
//       stays red, so a re-run fails its gate again); and on a branch ref the
//       lane publishes nothing, every publish step being tag-only
//       (CANONICAL_PUBLISH_IF in tooling/ci/assert-release-durable.mjs).
//
// 🔴 THE SECOND INSTANCE, 2026-09-23 (O-REDEPLOY-STRANDED-MISSES-THE-BUILD-LANE).
// Build apps #102 (run 35800063831, the Worker's 00:00Z dispatch at c1cdb241)
// failed on the gate step, and this tool never looked: it derived only lanes
// that push on main. And had it looked, it would still have refused — the run
// had a SECOND failed job, "all-platforms", an `if: always()` aggregate that
// needs the gate and so fails whenever the gate does. Both are fixed together:
// the derivation admits cadence lanes, and `decide` treats such an aggregate as
// a CONSEQUENCE of the gate, never as a real failure and never as a strand on
// its own.
//
// 🔴 WHAT IT MUST NEVER DO — the red controls in the test, each a fixture:
//   · re-enter a run that failed on a REAL deploy step. A recovery that re-runs a
//     genuine deploy failure is worse than no recovery at all. Every FAILED job
//     of the run must have failed FIRST on the gate step, by name — except the
//     lane's CONSEQUENCE jobs (job-level `if: always()` downstream of the gate),
//     which fail because the gate did. At least one job must have failed on the
//     gate step itself: a consequence job alone is never a strand.
//   · act when the lane has no run on main, or its newest run is live, green or
//     cancelled. Nothing is stranded.
//   · act while ci-gate at head is anything but completed/success. The gate step
//     would only fail again; the next CI completion fires this again.
//   · re-run an OLD run after a newer one exists. Only the NEWEST run (by
//     run_number) is read, so a stale failure behind a later deploy is history,
//     and re-running it would roll production BACK.
//   · loop. A same-SHA run already on attempt > 1 is not re-run again: a gate
//     step that fails twice over a green ci-gate is not a cascade, it is a fault
//     somebody must read.
//
// THE LANE SET IS DERIVED, NEVER LISTED. A workflow whose jobs run
// tooling/ci/assert-gate-passed.mjs in a NAMED step is a lane when ALL FOUR hold:
//   L1 it runs on main unprompted — `workflow_dispatch` AND (`push` listing
//      `main` OR a `schedule`);
//   L2 a bare dispatch reproduces it — `workflow_dispatch` declares NO `inputs:`.
//      The re-entry POSTs `{ref:'main'}` and nothing else, and inputs are how
//      every store publish takes the owner's word, so L2 alone keeps every
//      publisher out, now and later;
//   L3 the gate is reached on every event — no job holding the gate step has a
//      job-level `if:`;
//   L4 it is not a store-submission workflow — no `channels[].submission.workflow`
//      in tooling/channel-register.json names it. This closes the one hole L2
//      leaves: an input-less dry-run submitter that someone gives a schedule.
// Today that is build-platforms.yml, deploy-web.yml and deploy-workers.yml.
// extensions.yml fails L2, L3 and L4; every submit-*.yml fails L1 and L4; and
// symbolication-proof.yml fails L1 alone (a test pins that giving it a schedule
// derives it). The recovery workflow's `on: workflow_run: workflows:` must name
// exactly CI plus the lanes; `triggerProblem` compares the two and
// tooling/ci/test/redeploy-stranded.test.mjs holds it, so a new lane added
// without a recovery trigger goes red instead of being stranded silently.
//
// ── EXIT CONTRACT ────────────────────────────────────────────────────────────
//   0 = every lane was read; each was re-entered or had nothing stranded.
//   1 = a lane WAS stranded and the re-entry was refused or rejected (safe-rerun
//       refused, or GitHub answered the dispatch with an error).
//   2 = I COULD NOT LOOK — no credential, an unreadable API answer, an unreadable
//       channel register, a lane set that derived to nothing, or a trigger that
//       no longer matches the lanes.
//       Never readable as "nothing was stranded".
//
// ⚠️ NO `process.exit()` once a fetch has been made — the Windows libuv abort
// documented in safe-rerun.mjs and assert-gate-passed.mjs. `process.exitCode`.
//
// ── USAGE ────────────────────────────────────────────────────────────────────
//   node tooling/ops/redeploy-stranded.mjs [--dry-run] [--root <dir>]
//     --dry-run  read and decide; never re-run, never dispatch.
//     --root     the tree whose .github/workflows are read (tests).
//   env: GH_TOKEN / GITHUB_TOKEN, GITHUB_REPOSITORY.
//   Test seam: REDEPLOY_STRANDED_FIXTURE=<json> replaces every API answer and
//   has NO network path; each action it would take is appended to
//   REDEPLOY_STRANDED_FIXTURE_LOG, whose ABSENCE is the evidence a refusal
//   refused (the same rule as safe-rerun's fixture log).
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync, appendFileSync } from 'node:fs';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  parseAllWorkflows,
  parseWorkflow,
  workflowEvents,
  pushBranches,
  workflowRunSources,
  dispatchInputs,
} from '../ci/workflow-scan.mjs';
import { fetchWithBoundedRetry } from './bounded-retry.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');

export const GATE_SCRIPT = 'tooling/ci/assert-gate-passed.mjs';
export const RECOVERY_WORKFLOW = '.github/workflows/redeploy-stranded.yml';
export const CI_WORKFLOW = '.github/workflows/ci.yml';
/** L4's subject: every `channels[].submission.workflow` in it is never a lane. */
export const CHANNEL_REGISTER = 'tooling/channel-register.json';
/** The job key in ci.yml whose check-run the gate step polls. Its DISPLAY name
 *  is read from the file (it is the required status check's name). */
export const GATE_JOB = 'ci-gate';

// ═══════════════════════════════════════════════════════════════════════════
// THE DERIVATION — structure read from the workflow files
// ═══════════════════════════════════════════════════════════════════════════

/** The top-level `name:` of a parsed workflow, or null. */
export function workflowName(wf) {
  for (const l of wf.lines.slice(0, wf.jobsAt ?? wf.lines.length)) {
    const m = l.text.match(/^name:\s*(\S.*?)\s*$/);
    if (m) return m[1].replace(/^['"]|['"]$/g, '');
  }
  return null;
}

/** The `name:` of the step whose `run:` invokes the gate script, per job. A
 *  step is the block from its `- ` line to the next `- ` at the same indent. */
function gateSteps(wf) {
  const out = [];
  for (const job of wf.jobs.values()) {
    const lines = job.lines;
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].text.includes(`node ${GATE_SCRIPT}`)) continue;
      let start = i;
      while (start >= 0 && !/^\s*-\s/.test(lines[start].text)) start--;
      if (start < 0) continue;
      const indent = lines[start].text.match(/^(\s*)-/)[1].length;
      let name = null;
      for (let j = start; j <= i; j++) {
        const t = lines[j].text;
        const m = t.match(/^\s*(?:-\s+)?name:\s*(\S.*?)\s*$/);
        const at = t.match(/^(\s*)/)[1].length;
        if (m && (j === start || at === indent + 2)) { name = m[1].replace(/^['"]|['"]$/g, ''); break; }
      }
      out.push({ job: job.name, step: name, line: lines[i].n });
    }
  }
  return out;
}

/** Every `channels[].submission.workflow` in the channel register, as repo-
 *  relative paths. Throws when the register cannot be read: L4 unread is a lane
 *  set nobody vouched for, and that is exit 2, never a quieter derivation. */
function submissionWorkflows(root) {
  const reg = JSON.parse(readFileSync(join(root, CHANNEL_REGISTER), 'utf8'));
  if (!Array.isArray(reg.channels)) throw new Error('no `channels` array');
  return new Set(reg.channels.map((c) => c.submission?.workflow).filter(Boolean));
}

/** The display names of the jobs that fail BECAUSE the gate did: a job-level
 *  `if:` holding `always()` whose transitive `needs` reach a gate job. Such a
 *  job runs after a red gate and reports it again; it is never a second fault. */
function consequenceJobs(wf, gateJobs) {
  const reaches = (key, seen = new Set()) => {
    if (seen.has(key)) return false;
    seen.add(key);
    const job = wf.jobs.get(key);
    return (job?.needs ?? []).some((n) => gateJobs.has(n) || reaches(n, seen));
  };
  const out = [];
  for (const [key, job] of wf.jobs) {
    if (gateJobs.has(key) || !job.jobIf || !/\balways\(\)/.test(job.jobIf.cond)) continue;
    if (reaches(key)) out.push(job.displayName ?? key);
  }
  return out;
}

/**
 * Every lane a red ci-gate can strand, by the four limbs in the header (L1–L4).
 * Returns `{ lanes, problems }`; a gate step with no `name:` is a PROBLEM,
 * because the failed-step match below is by name and an unnamed step would make
 * every gate failure read as "a real deploy step failed" — silently switching
 * the recovery off for that lane. An unreadable channel register is a problem
 * too: without L4 the set is not derived.
 */
export function deployLanes(root) {
  const lanes = [];
  const problems = [];
  let submissions;
  try {
    submissions = submissionWorkflows(root);
  } catch (e) {
    return { lanes, problems: [`${CHANNEL_REGISTER} is unreadable (${e.message}), so L4 cannot exclude a store-submission workflow`] };
  }
  for (const wf of parseAllWorkflows(root)) {
    if (wf.rel === RECOVERY_WORKFLOW) continue;
    const ev = workflowEvents(wf);
    // L1: dispatchable, and runs on main unprompted (a push to main or a schedule).
    if (!ev.has('workflow_dispatch')) continue;
    const pushesMain = ev.has('push') && (pushBranches(wf)?.items.some((b) => b.pattern === 'main') ?? false);
    if (!pushesMain && !ev.has('schedule')) continue;
    // L2: a bare `{ref:'main'}` dispatch reproduces the run.
    if (dispatchInputs(wf) !== null) continue;
    // L4: never a store-submission workflow.
    if (submissions.has(wf.rel)) continue;
    const gates = gateSteps(wf);
    if (gates.length === 0) continue;
    // L3: the gate is reached on every event.
    if (gates.some((g) => wf.jobs.get(g.job)?.jobIf)) continue;
    const names = new Set(gates.map((g) => g.step));
    if (names.has(null)) {
      problems.push(`${wf.rel}: the step running ${GATE_SCRIPT} has no \`name:\` (line ${gates.find((g) => g.step === null).line}), so a gate failure cannot be told from a deploy failure`);
      continue;
    }
    if (names.size !== 1) {
      problems.push(`${wf.rel}: the gate step is named ${[...names].map((n) => `"${n}"`).join(' and ')} in different jobs; one name, or the failed-step match below is ambiguous`);
      continue;
    }
    const name = workflowName(wf);
    if (!name) {
      problems.push(`${wf.rel}: no top-level \`name:\`, and \`workflow_run.workflows\` matches by name`);
      continue;
    }
    lanes.push({
      file: basename(wf.rel),
      rel: wf.rel,
      name,
      gateStep: [...names][0],
      consequenceJobs: consequenceJobs(wf, new Set(gates.map((g) => g.job))),
    });
  }
  return { lanes, problems };
}

/** The ci-gate check-run's display name, read from ci.yml's `ci-gate` job. */
export function gateCheckName(root) {
  const wf = parseWorkflow(root, CI_WORKFLOW);
  const job = wf?.jobs.get(GATE_JOB);
  return job ? (job.displayName ?? GATE_JOB) : null;
}

/**
 * The recovery workflow must hear exactly CI plus every derived lane, on main,
 * on completion. Returns a problem string, or null. Compared as SETS both ways:
 * a missing lane is a lane nobody re-enters, and an extra name is a trigger for
 * a workflow this tool will never read.
 */
export function triggerProblem(root, lanes) {
  const wf = parseWorkflow(root, RECOVERY_WORKFLOW);
  if (!wf) return `${RECOVERY_WORKFLOW} does not exist`;
  const ci = parseWorkflow(root, CI_WORKFLOW);
  const ciName = ci && workflowName(ci);
  if (!ciName) return `${CI_WORKFLOW} has no top-level name: to listen for`;
  const sources = workflowRunSources(wf);
  if (!sources) return `${RECOVERY_WORKFLOW} declares no \`on: workflow_run: workflows:\``;
  const want = new Set([ciName, ...lanes.map((l) => l.name)]);
  const got = new Set(sources.items.map((i) => i.pattern));
  const missing = [...want].filter((n) => !got.has(n));
  const extra = [...got].filter((n) => !want.has(n));
  if (missing.length || extra.length) {
    return (
      `${RECOVERY_WORKFLOW}:${sources.line} workflow_run.workflows is [${[...got].join(', ')}], ` +
      `the derived set is [${[...want].join(', ')}]` +
      (missing.length ? `; MISSING ${missing.join(', ')} — a lane nobody re-enters` : '') +
      (extra.length ? `; EXTRA ${extra.join(', ')} — a workflow this tool never reads` : '')
    );
  }
  const branches = (() => {
    // `branches:` under workflow_run, read by the same walk as push's.
    const lines = wf.lines.slice(0, wf.jobsAt ?? wf.lines.length);
    const at = lines.findIndex((l) => /^\s*workflow_run:\s*$/.test(l.text));
    if (at < 0) return null;
    const indent = lines[at].text.match(/^\s*/)[0].length;
    for (let j = at + 1; j < lines.length; j++) {
      const t = lines[j].text;
      if (t.trim() === '') continue;
      if (t.match(/^ */)[0].length <= indent) break;
      const m = t.match(/^\s*branches:\s*\[([^\]]*)\]\s*$/);
      if (m) return m[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, ''));
    }
    return null;
  })();
  if (!branches || branches.length !== 1 || branches[0] !== 'main') {
    return `${RECOVERY_WORKFLOW} workflow_run must be filtered to \`branches: [main]\` — a deploy lane only ever runs there`;
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// THE JUDGEMENT — pure, and the only thing the red controls need to reach
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The lane's newest push, dispatch or schedule run on main (highest
 * run_number), or null. ONE definition: `main` uses it to decide what to fetch
 * and `decide` to judge, so the two can never disagree about which run is "the
 * newest". `schedule` is in the set so that a cron run which went green AFTER a
 * failed Worker dispatch supersedes it — else the old failure reads as newest
 * and an old run is re-entered.
 */
const LANE_EVENTS = new Set(['push', 'workflow_dispatch', 'schedule']);
export function newestRun(runs) {
  const mine = (runs ?? []).filter((r) => LANE_EVENTS.has(r.event));
  return mine.length ? mine.reduce((a, b) => (b.run_number > a.run_number ? b : a)) : null;
}

/**
 * @param lane      { file, gateStep, consequenceJobs? }
 * @param head      main's current head SHA
 * @param gate      the NEWEST ci-gate check-run at head, or null
 * @param runs      the lane's runs on main (any order); event push/workflow_dispatch/schedule
 * @param jobs      jobs of the newest run (filter=latest), each with `steps`
 * @param relation  compare(newest.head_sha...head).status, when they differ
 * @returns { action: 'none'|'rerun'|'dispatch', runId?, why }
 */
export function decide({ lane, head, gate, runs, jobs, relation }) {
  const none = (why) => ({ action: 'none', why });
  if (!gate || gate.status !== 'completed' || gate.conclusion !== 'success') {
    return none(`ci-gate at head ${short(head)} is ${gate ? `${gate.status}/${gate.conclusion ?? '-'}` : 'absent'}, not green — a re-entry would fail on the gate again; the next CI completion re-asks`);
  }
  const newest = newestRun(runs);
  if (!newest) return none('no push, dispatch or schedule run of this lane on main — nothing is stranded');
  const tag = `run ${newest.id} (#${newest.run_number}, attempt ${newest.run_attempt ?? 1}, ${newest.event}) at ${short(newest.head_sha)}`;
  if (newest.status !== 'completed') return none(`newest ${tag} is ${newest.status} — it will read ci-gate itself`);
  if (newest.conclusion !== 'failure') return none(`newest ${tag} concluded ${newest.conclusion} — nothing is stranded`);

  const failed = (jobs ?? []).filter((j) => j.conclusion === 'failure');
  if (failed.length === 0) return none(`newest ${tag} failed but no job reads failure — not a gate strand this tool can recognise`);
  // A consequence job (job-level `if: always()` downstream of the gate) fails
  // because the gate did; it is judged by the gate job beside it, never alone.
  const conseq = new Set(lane.consequenceJobs ?? []);
  let onGate = 0;
  for (const j of failed) {
    if (conseq.has(j.name)) continue;
    const first = (j.steps ?? []).find((s) => s.conclusion === 'failure');
    if (!first) return none(`job "${j.name}" of ${tag} failed with no failed step — a runner or timeout failure, not the gate; left for a human`);
    if (first.name !== lane.gateStep) {
      return none(`job "${j.name}" of ${tag} failed on "${first.name}", a REAL step, not "${lane.gateStep}" — a genuine deploy failure is never re-entered`);
    }
    onGate++;
  }
  if (onGate === 0) {
    return none(`only consequence job(s) ${failed.map((j) => `"${j.name}"`).join(', ')} of ${tag} failed, and no job failed on "${lane.gateStep}" — a consequence job alone is never a strand`);
  }

  if (newest.head_sha === head) {
    if ((newest.run_attempt ?? 1) > 1) {
      return none(`${tag} already failed the gate on a re-run while ci-gate at that SHA is green — not a cascade; read its log`);
    }
    return { action: 'rerun', runId: newest.id, why: `${tag} failed on the gate step and ci-gate at that SHA is now green — re-run its failed jobs` };
  }
  if (relation !== 'ahead') {
    return none(`${tag} is not an ancestor of head ${short(head)} (compare: ${relation ?? 'unread'}) — not this lane's history`);
  }
  return {
    action: 'dispatch',
    why: `${tag} failed on the gate step; head ${short(head)} is ahead of it, green, and changed none of this lane's paths since — dispatch the lane on main`,
  };
}

const short = (s) => (s ? String(s).slice(0, 8) : '(none)');

/** The argv the rerun branch hands to safe-rerun.mjs. Exported so the test pins
 *  that the reuse is `--failed` — a whole-run rerun would redo green jobs. */
export const rerunArgv = (runId) => [join(ROOT, 'tooling', 'ops', 'safe-rerun.mjs'), String(runId), '--failed'];

// ═══════════════════════════════════════════════════════════════════════════
// TRANSPORT — live, or a fixture with no network path at all
// ═══════════════════════════════════════════════════════════════════════════

const API = 'https://api.github.com';

function liveApi(repo, tok) {
  const headers = {
    authorization: `Bearer ${tok}`,
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    'user-agent': 'nikatru-redeploy-stranded',
  };
  // Every GET is a READ: the shared rule gives each attempt the per-request
  // ceiling and re-asks a dropped wire or a 429/5xx, so one silent socket cannot
  // hold this job to timeout-minutes. What survives the retry reaches main()'s
  // catch as COULD NOT LOOK — exit 2, never a verdict.
  const get = async (path) => {
    const res = await fetchWithBoundedRetry(({ signal }) => fetch(`${API}${path}`, { headers, signal }), {
      describe: (what) => `GET ${path}: ${what}`,
    });
    if (!res.ok) throw new Error(`GET ${path} → HTTP ${res.status}`);
    return res.json();
  };
  return {
    head: async () => (await get(`/repos/${repo}/git/ref/heads/main`)).object.sha,
    gate: async (sha, name) => {
      const body = await get(`/repos/${repo}/commits/${sha}/check-runs?check_name=${encodeURIComponent(name)}&per_page=100`);
      const all = (body.check_runs ?? []).filter((c) => c.name === name);
      return all.length ? all.reduce((a, b) => (b.id > a.id ? b : a)) : null;
    },
    runs: async (file) => {
      const body = await get(`/repos/${repo}/actions/workflows/${file}/runs?branch=main&per_page=20`);
      if (!Array.isArray(body.workflow_runs)) throw new Error(`${file}: no workflow_runs array`);
      return body.workflow_runs;
    },
    // A short page is not an answer: a clearance over a partial job list could
    // miss the one job that failed on a real step. Same rule as safe-rerun.
    jobs: async (id) => {
      const body = await get(`/repos/${repo}/actions/runs/${id}/jobs?filter=latest&per_page=100`);
      if (!Array.isArray(body.jobs) || body.total_count !== body.jobs.length) {
        throw new Error(`run ${id}: ${body.total_count} job(s) reported, ${body.jobs?.length} read`);
      }
      return body.jobs;
    },
    compare: async (base, head) => (await get(`/repos/${repo}/compare/${base}...${head}?per_page=1`)).status,
    rerun: (runId) => {
      const r = spawnSync(process.execPath, rerunArgv(runId), { stdio: 'inherit', env: process.env });
      return r.status === 0 ? { ok: true } : { ok: false, code: r.status === 1 ? 1 : 2, why: `safe-rerun exited ${r.status}` };
    },
    // A dispatch is a WRITE, so it gets ONE attempt (a re-ask after a lost
    // answer could start the lane twice), still under the shared per-request
    // ceiling. A dispatch that never answered, or answered 429/5xx, is COULD NOT
    // LOOK (exit 2), not "refused": it may have landed.
    dispatch: async (file) => {
      let res;
      try {
        res = await fetchWithBoundedRetry(
          ({ signal }) =>
            fetch(`${API}/repos/${repo}/actions/workflows/${file}/dispatches`, {
              method: 'POST',
              headers: { ...headers, 'content-type': 'application/json' },
              body: JSON.stringify({ ref: 'main' }),
              signal,
            }),
          { attempts: 1, describe: (what) => `dispatch ${file}: ${what}` },
        );
      } catch (e) {
        return { ok: false, code: 2, why: `${e?.message ?? e} — it may have landed; read the lane's runs before re-dispatching` };
      }
      if (res.status !== 204) return { ok: false, code: 1, why: `dispatch answered HTTP ${res.status} ${await res.text().catch(() => '')}` };
      return { ok: true };
    },
  };
}

function fixtureApi(path) {
  const fx = JSON.parse(readFileSync(path, 'utf8'));
  const log = process.env.REDEPLOY_STRANDED_FIXTURE_LOG;
  const need = (v, what) => {
    if (v === undefined) throw new Error(`fixture declares no ${what}`);
    return v;
  };
  return {
    head: async () => need(fx.head, 'head'),
    gate: async () => need(fx.gate, 'gate'),
    runs: async (file) => need(fx.runs?.[file], `runs for ${file}`),
    jobs: async (id) => need(fx.jobs?.[String(id)], `jobs for run ${id}`),
    compare: async (base, head) => need(fx.compare?.[`${base}...${head}`], `compare ${base}...${head}`),
    rerun: (runId) => {
      if (log) appendFileSync(log, `rerun ${rerunArgv(runId).slice(1).join(' ')}\n`);
      return { ok: true };
    },
    dispatch: async (file) => {
      if (log) appendFileSync(log, `dispatch ${file} ref=main\n`);
      return { ok: true };
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
export async function main(argv, env = process.env) {
  let root = ROOT;
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--dry-run') dryRun = true;
    else if (argv[i] === '--root') root = resolve(argv[++i]);
    else {
      console.error(`✗ unrecognised argument \`${argv[i]}\`. Usage: redeploy-stranded.mjs [--dry-run] [--root <dir>]`);
      return 2;
    }
  }

  const { lanes, problems } = deployLanes(root);
  for (const p of problems) console.error(`✗ ${p}`);
  if (problems.length) return 2;
  if (lanes.length === 0) {
    console.error('✗ I COULD NOT LOOK — no lane derived (push on main or a schedule, an input-less workflow_dispatch, an unconditional named gate step, not a store submission). COVERAGE LOST, not "nothing stranded".');
    return 2;
  }
  const trig = triggerProblem(root, lanes);
  if (trig) {
    console.error(`✗ ${trig}`);
    return 2;
  }
  const gateName = gateCheckName(root);
  if (!gateName) {
    console.error(`✗ I COULD NOT LOOK — ${CI_WORKFLOW} has no \`${GATE_JOB}\` job to read the check name from.`);
    return 2;
  }

  let api;
  if (env.REDEPLOY_STRANDED_FIXTURE) {
    if (!existsSync(env.REDEPLOY_STRANDED_FIXTURE)) {
      console.error(`✗ REDEPLOY_STRANDED_FIXTURE points at ${env.REDEPLOY_STRANDED_FIXTURE}, which does not exist.`);
      return 2;
    }
    api = fixtureApi(env.REDEPLOY_STRANDED_FIXTURE);
    console.log(`⚠️  FIXTURE TRANSPORT — no network. Reading ${env.REDEPLOY_STRANDED_FIXTURE}`);
  } else {
    const repo = env.GITHUB_REPOSITORY?.trim();
    const tok = env.GH_TOKEN?.trim() || env.GITHUB_TOKEN?.trim();
    if (!repo || !tok) {
      console.error('✗ I COULD NOT LOOK — GITHUB_REPOSITORY and GH_TOKEN/GITHUB_TOKEN are both required. Exit 2, not a pass.');
      return 2;
    }
    api = liveApi(repo, tok);
  }

  let head;
  let gate;
  try {
    head = await api.head();
    gate = await api.gate(head, gateName);
  } catch (e) {
    console.error(`✗ I COULD NOT LOOK — main's head or its ${gateName}: ${e.message}`);
    return 2;
  }
  console.log(`main at ${short(head)}; ${gateName} ${gate ? `${gate.status}/${gate.conclusion ?? '-'}` : 'absent'}`);
  console.log(`lanes (derived): ${lanes.map((l) => `${l.file} ← "${l.gateStep}"`).join('; ')}`);

  let code = 0;
  for (const lane of lanes) {
    let verdict;
    try {
      let runs = [];
      let jobs = [];
      let relation = null;
      if (gate?.status === 'completed' && gate.conclusion === 'success') {
        runs = await api.runs(lane.file);
        const newest = newestRun(runs);
        if (newest && newest.status === 'completed' && newest.conclusion === 'failure') {
          jobs = await api.jobs(newest.id);
          if (newest.head_sha !== head) relation = await api.compare(newest.head_sha, head);
        }
      }
      verdict = decide({ lane, head, gate, runs, jobs, relation });
    } catch (e) {
      console.error(`✗ ${lane.file}: I COULD NOT LOOK — ${e.message}`);
      code = Math.max(code, 2);
      continue;
    }
    console.log(`${lane.file}: ${verdict.action.toUpperCase()} — ${verdict.why}`);
    if (verdict.action === 'none') continue;
    if (dryRun) {
      console.log('   --dry-run: nothing was requested.');
      continue;
    }
    const res = verdict.action === 'rerun' ? await api.rerun(verdict.runId) : await api.dispatch(lane.file);
    if (res.ok) console.log(`ok ${lane.file}: ${verdict.action} requested.`);
    else {
      console.error(`✗ ${lane.file}: the ${verdict.action} was decided but not taken — ${res.why}`);
      code = Math.max(code, res.code);
    }
  }
  return code;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  process.exitCode = await main(process.argv.slice(2));
}
