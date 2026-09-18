// ─────────────────────────────────────────────────────────────────────────────
// [O-LAPTOP-ROUTINES-DIE-OVERNIGHT] THE OPS WATCHDOG'S PORTABLE WORK, OFF THE LAPTOP.
//
// Owner decision 2026-09-18: the laptop routines `nikatru-ops-check` and
// `nikatru-watchdog` fire only while the desktop app is open, so a closed lid
// was indistinguishable from a dead watchdog (register rows
// duty.laptop.nikatru-ops-check / -watchdog tolerate 1 and 4 missed runs for
// exactly that reason). The checks that need nothing but HTTP move here, onto
// the platform Worker's existing 6-hourly cron grid:
//
//   (a) Actions runs on the Public repo that are queued / in progress past a
//       declared age are FLAGGED, and CANCELLED only when the owner's flag
//       OPS_WATCHDOG_CANCEL_STUCK === "true" (default OFF — the token needs
//       `actions:write`, which the owner widens separately);
//   (b) main's latest COMPLETED ci.yml and ops-watch.yml conclusions;
//   (c) GlitchTip monitors 6 and 22, when GLITCHTIP_TOKEN is set.
//
// What stays on the laptop (design note research/session-2026-09-18/
// worker-cron-ops-design.md): Task Scheduler polls, SSH per-service checks,
// Drive-bundle tags, dirty worktrees, knowledge-set asserts. PRs are NEVER
// merged from here.
//
// 🔴 `ok` ON THESE ROWS MEANS "THE CHECK RAN AND READ ITS SUBJECT", NOT "THE
// SUBJECT IS HEALTHY". This is load-bearing, not a softening. The rows land in
// cron_heartbeat, which ops-watch.yml reads, and ops-watch red freezes the merge
// queue through ci-gate. If a red ci.yml on main wrote ok=0 here, ops-watch
// would go red, ci-gate would block the very PR that fixes main, and ops-watch's
// OWN failure would latch this row red forever. Findings therefore travel in
// `detail` (prefixed FINDING:) and in the Worker log; ok=0 is reserved for the
// honest failures of the check itself — not configured, refused, unreadable.
// That is the same line the laptop routine drew: findings never withheld its beat.
//
// ⚠️ NOTHING HERE LOGS OR RECORDS A CREDENTIAL. Tokens go into headers only, and
// no URL that carries one is ever printed (see the heartbeat URL in scheduled.ts).
// ─────────────────────────────────────────────────────────────────────────────
import type { Env } from './types';

export type HeartbeatRow = { target: string; ok: boolean; detail: string };

/** The repository whose runs are watched. Same owner/repo the dispatcher fires. */
export const OPS_REPO = { owner: 'globalonlinedeveloper', repo: 'Nikatru_Platform_Public' } as const;

/** Workflows whose latest completed run on main is reported. */
export const OPS_MAIN_WORKFLOWS = ['ci.yml', 'ops-watch.yml'] as const;

/** GlitchTip monitors whose status is read: 6 (laptop daily backup heartbeat)
 *  and 22, as named by the owner's design note. Declared, not discovered. */
export const OPS_GLITCHTIP_MONITORS = ['6', '22'] as const;

/** The GlitchTip organisation slug — the same one every register row names. */
export const OPS_GLITCHTIP_ORG = 'nikatru';

/**
 * @ceiling none — an ALERTING THRESHOLD, not a platform resource. DERIVED: the
 *   longest `timeout-minutes` any job in .github/workflows declares is 60, so a
 *   run twice that old is past what its own workflow permits. ⚠️ A job that
 *   declares NO timeout may legitimately run to GitHub's 360-minute default; it
 *   is FLAGGED here, and cancelled only when the owner's flag is on.
 */
export const OPS_STUCK_RUN_MINUTES = 120;

/** @ceiling workers.externalSubrequests lte — each cancel is one external POST;
 *  bounded so a pile-up of stuck runs cannot spend the firing's budget. */
export const OPS_MAX_CANCELS_PER_RUN = 3;

/** @ceiling none — a GitHub API PAGE SIZE (its documented maximum), not a
 *  platform resource; one page per status is read, and the detail says so if
 *  more exist. */
export const OPS_RUNS_PAGE_SIZE = 100;

/** @ceiling none — a per-request TIMEOUT in milliseconds, not a platform cap. */
export const OPS_FETCH_TIMEOUT_MS = 10_000;

/**
 * THE EXTERNAL SUBREQUESTS ONE WATCHDOG PASS CAN SPEND, COUNTED, not estimated:
 *   2  run lists (status=in_progress, status=queued)
 * + 3  cancels at most (OPS_MAX_CANCELS_PER_RUN)
 * + 2  main conclusions (OPS_MAIN_WORKFLOWS)
 * + 2  GlitchTip monitor reads (OPS_GLITCHTIP_MONITORS)
 * + 1  the watchdog's own heartbeat POST (scheduled.ts, opsWatchdogJob)
 * = 10. test/ops-watchdog.test.ts recomputes this from the arrays above.
 * On the 06:00 firing it sits beside keep-alive (1+), Box B (3), Box A (N),
 * the dispatcher (≤3) and the cron beat (1): far inside 50 (Free) and 10,000 (Paid).
 * @ceiling workers.externalSubrequests lte
 */
export const OPS_WATCHDOG_MAX_SUBREQUESTS = 10;

function githubHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    // GitHub answers 403 to a request with no User-Agent — see the dispatcher.
    'User-Agent': 'nikatru-platform-cron',
  };
}

type RunSummary = { id: number; name?: string; status?: string; created_at?: string; run_started_at?: string; html_url?: string };

/** Minutes since the run started (or was created, if it never started). NaN if undatable. */
export function runAgeMinutes(run: RunSummary, nowMs: number): number {
  const at = Date.parse(run.run_started_at ?? run.created_at ?? '');
  return Number.isNaN(at) ? NaN : (nowMs - at) / 60_000;
}

async function listRuns(token: string, status: 'in_progress' | 'queued'): Promise<{ runs: RunSummary[]; total: number }> {
  const res = await fetch(
    `https://api.github.com/repos/${OPS_REPO.owner}/${OPS_REPO.repo}/actions/runs?status=${status}&per_page=${OPS_RUNS_PAGE_SIZE}`,
    { headers: githubHeaders(token), signal: AbortSignal.timeout(OPS_FETCH_TIMEOUT_MS) },
  );
  if (res.status !== 200) throw new Error(`HTTP ${res.status} listing ${status} runs`);
  const body = (await res.json()) as { total_count?: number; workflow_runs?: RunSummary[] };
  const runs = Array.isArray(body.workflow_runs) ? body.workflow_runs : [];
  return { runs, total: typeof body.total_count === 'number' ? body.total_count : runs.length };
}

/** (a) Flag stuck runs; cancel them only when the owner's flag allows it. */
export async function checkStuckRuns(env: Env, nowMs: number = Date.now()): Promise<HeartbeatRow> {
  const target = 'actions-stuck-runs';
  const token = env.GITHUB_DISPATCH_TOKEN;
  if (!token) return { target, ok: false, detail: 'not configured: GITHUB_DISPATCH_TOKEN is not set on this Worker' };
  const allowCancel = env.OPS_WATCHDOG_CANCEL_STUCK === 'true';
  let examined = 0;
  let truncated = false;
  const stuck: RunSummary[] = [];
  try {
    for (const status of ['in_progress', 'queued'] as const) {
      const { runs, total } = await listRuns(token, status);
      examined += runs.length;
      if (total > runs.length) truncated = true;
      for (const r of runs) if (runAgeMinutes(r, nowMs) >= OPS_STUCK_RUN_MINUTES) stuck.push(r);
    }
  } catch (err) {
    return { target, ok: false, detail: `unreadable: ${String(err).slice(0, 150)}` };
  }
  const notes: string[] = [];
  let cancelled = 0;
  let refused = 0;
  if (allowCancel) {
    for (const r of stuck.slice(0, OPS_MAX_CANCELS_PER_RUN)) {
      try {
        const res = await fetch(
          `https://api.github.com/repos/${OPS_REPO.owner}/${OPS_REPO.repo}/actions/runs/${r.id}/cancel`,
          { method: 'POST', headers: githubHeaders(token), signal: AbortSignal.timeout(OPS_FETCH_TIMEOUT_MS) },
        );
        // 202 Accepted is GitHub's documented success for a cancel request.
        if (res.status === 202) cancelled++;
        else { refused++; notes.push(`cancel ${r.id} HTTP ${res.status}`); }
      } catch (err) {
        refused++;
        notes.push(`cancel ${r.id} failed: ${String(err).slice(0, 60)}`);
      }
    }
  }
  const ids = stuck.map((r) => `${r.id}(${Math.round(runAgeMinutes(r, nowMs))}m ${r.status ?? '?'})`).join(' ');
  const summary = stuck.length === 0
    ? `none stuck: ${examined} active run(s) examined, threshold ${OPS_STUCK_RUN_MINUTES}m`
    : `FINDING: ${stuck.length} run(s) past ${OPS_STUCK_RUN_MINUTES}m: ${ids}; ` +
      (allowCancel ? `cancelled=${cancelled} refused=${refused}` : 'flag-only (OPS_WATCHDOG_CANCEL_STUCK is not "true")');
  if (stuck.length > 0) console.log(`[cron] ops watchdog: ${summary}`);
  // A refused cancel IS a failure of the check's own action — most likely the
  // token lacks actions:write — so it is ok=0 rather than a finding.
  return {
    target,
    ok: refused === 0,
    detail: [summary, truncated ? 'more runs than one page, first page only' : '', ...notes].filter(Boolean).join('; '),
  };
}

/** (b) main's latest COMPLETED run per declared workflow. */
export async function checkMainConclusions(env: Env): Promise<HeartbeatRow[]> {
  const token = env.GITHUB_DISPATCH_TOKEN;
  const rows: HeartbeatRow[] = [];
  for (const wf of OPS_MAIN_WORKFLOWS) {
    const target = `main:${wf}`;
    if (!token) { rows.push({ target, ok: false, detail: 'not configured: GITHUB_DISPATCH_TOKEN is not set on this Worker' }); continue; }
    try {
      const res = await fetch(
        `https://api.github.com/repos/${OPS_REPO.owner}/${OPS_REPO.repo}/actions/workflows/${wf}/runs?branch=main&status=completed&per_page=1`,
        { headers: githubHeaders(token), signal: AbortSignal.timeout(OPS_FETCH_TIMEOUT_MS) },
      );
      if (res.status !== 200) { rows.push({ target, ok: false, detail: `unreadable: HTTP ${res.status}` }); continue; }
      const body = (await res.json()) as { workflow_runs?: { id: number; conclusion?: string | null; updated_at?: string }[] };
      const run = body.workflow_runs?.[0];
      if (!run) { rows.push({ target, ok: false, detail: `unreadable: no completed ${wf} run on main` }); continue; }
      const conclusion = run.conclusion ?? 'null';
      const tag = conclusion === 'success' ? '' : 'FINDING: ';
      rows.push({ target, ok: true, detail: `${tag}${wf} on main: ${conclusion} (run ${run.id}, ${run.updated_at ?? '?'})` });
      if (tag) console.log(`[cron] ops watchdog: ${wf} on main concluded ${conclusion} (run ${run.id})`);
    } catch (err) {
      rows.push({ target, ok: false, detail: `unreadable: ${String(err).slice(0, 150)}` });
    }
  }
  return rows;
}

/** (c) GlitchTip monitor status, when a token exists. */
export async function checkGlitchtipMonitors(env: Env): Promise<HeartbeatRow[]> {
  const token = env.GLITCHTIP_TOKEN;
  const base = (env.GLITCHTIP_URL ?? 'https://glitchtip.nikatru.com').trim().replace(/\/+$/, '');
  const rows: HeartbeatRow[] = [];
  for (const id of OPS_GLITCHTIP_MONITORS) {
    const target = `glitchtip-monitor-${id}`;
    if (!token) { rows.push({ target, ok: false, detail: 'not configured: GLITCHTIP_TOKEN is not set on this Worker' }); continue; }
    try {
      const res = await fetch(`${base}/api/0/organizations/${OPS_GLITCHTIP_ORG}/monitors/${id}/`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(OPS_FETCH_TIMEOUT_MS),
      });
      if (res.status === 404) { rows.push({ target, ok: false, detail: `monitor ${id} does not exist (HTTP 404)` }); continue; }
      if (res.status !== 200) { rows.push({ target, ok: false, detail: `unreadable: HTTP ${res.status}` }); continue; }
      const m = (await res.json()) as { name?: string; isUp?: boolean | null; lastChange?: string };
      const up = m.isUp === true;
      const detail = `${up ? '' : 'FINDING: '}monitor ${id} ${m.name ? `"${String(m.name).slice(0, 40)}" ` : ''}isUp=${String(m.isUp)}${m.lastChange ? ` since ${m.lastChange}` : ''}`;
      rows.push({ target, ok: true, detail });
      if (!up) console.log(`[cron] ops watchdog: ${detail}`);
    } catch (err) {
      rows.push({ target, ok: false, detail: `unreadable: ${String(err).slice(0, 150)}` });
    }
  }
  return rows;
}

/** (a)–(c) in order. Each limb contains its own errors; a throw out of here is a bug. */
export async function runOpsWatchdogChecks(env: Env): Promise<HeartbeatRow[]> {
  return [
    await checkStuckRuns(env),
    ...(await checkMainConclusions(env)),
    ...(await checkGlitchtipMonitors(env)),
  ];
}
