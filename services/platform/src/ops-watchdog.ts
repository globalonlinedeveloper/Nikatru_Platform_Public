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
//   (b) main's latest COMPLETED ci.yml and ops-watch.yml conclusions — and,
//       since 2026-10-01, how OLD ops-watch's is (`gradeOpsWatchFreshness`);
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
// ⏱ 2026-09-24 (O-OPS-WATCHDOG-STUCK-RUNS-HOURLY): (a) LEFT THE 6-HOURLY GRID. It
// runs on its own hourly cron (`OPS_HOURLY_CRON`, scheduled.ts `opsStuckRunsJob`)
// through `scanStuckRuns`, and is no longer part of `runOpsWatchdogChecks`. Its
// ROW keeps the rule above — a finding is still ok=1 — but its BEAT, a separate
// GlitchTip monitor, is the page: it is sent only when the scan read every
// active run and no stuck run is left unhandled, so a stuck run stops the beat.
// That is the one beat here a finding withholds, and it is a different signal
// from this job's rows, which ops-watch.yml reads.
//
// ⚠️ NOTHING HERE LOGS OR RECORDS A CREDENTIAL. Tokens go into headers only, and
// no URL that carries one is ever printed (see the heartbeat URL in scheduled.ts).
// ─────────────────────────────────────────────────────────────────────────────
import type { Env } from './types';

/** `page`, when set, asks scheduled.ts `opsWatchdogJob` to mail the owner
 *  directly (lib/owner-page.ts). It is never recorded. */
export type HeartbeatRow = { target: string; ok: boolean; detail: string; page?: string };

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
 *   1  main's HEAD commit (the branch-head anchor, read once per pass)
 * + 8  main conclusions: per OPS_MAIN_WORKFLOWS entry, OPS_MAIN_READ_ATTEMPTS
 *      attempts of (one page + one cross-read) — see "THE STALE PAGE" below; a
 *      cross-read that answers for a stale page spends nothing more
 * + 1  the head_sha second path, per OPS_PUSH_TRIGGERED_ON_MAIN entry, read
 *      only when every attempt was refused — see "THE SECOND PATH" below
 * + 2  GlitchTip monitor reads (OPS_GLITCHTIP_MONITORS)
 * + 1  the watchdog's own heartbeat POST (scheduled.ts, opsWatchdogJob)
 * + 1  the owner page (lib/owner-page.ts), only when the ops-watch freshness row
 *      finds main's newest completed run past OPS_WATCH_MAX_AGE_HOURS
 * = 14. test/ops-watchdog.test.ts recomputes this from the arrays above.
 * ⏱ 2026-10-01: 13 -> 14 for the owner page (PB-10).
 * ⏱ 2026-09-24: it was 18 while the pass also read the two run lists and made up
 * to three cancels; those moved to the hourly firing (OPS_STUCK_RUNS_MAX_SUBREQUESTS).
 * On the 06:00 firing it sits beside keep-alive (1+), Box B (3), Box A (N),
 * the dispatcher (≤3) and the cron beat (1): far inside 50 (Free) and 10,000 (Paid).
 * Since 2026-10-01 Box B and Box A ride every grid firing, each with at most one
 * owner page of its own (lib/owner-page.ts) — still far inside both.
 * @ceiling workers.externalSubrequests lte
 */
export const OPS_WATCHDOG_MAX_SUBREQUESTS = 14;

/**
 * THE EXTERNAL SUBREQUESTS ONE HOURLY STUCK-RUN FIRING CAN SPEND, COUNTED:
 *   2  run lists (status=in_progress, status=queued)
 * + 3  cancels at most (OPS_MAX_CANCELS_PER_RUN), only behind the owner's flag
 * + 1  its own heartbeat POST (scheduled.ts, opsStuckRunsJob)
 * = 6. The firing runs nothing else. test/ops-watchdog.test.ts recomputes this
 * and drives the worst case against it.
 * @ceiling workers.externalSubrequests lte
 */
export const OPS_STUCK_RUNS_MAX_SUBREQUESTS = 6;

/** The cron_heartbeat target the stuck-run scan writes, on every path. */
export const OPS_STUCK_RUNS_TARGET = 'actions-stuck-runs';

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

/**
 * One stuck-run scan: the ROW it records, and the two facts the hourly beat is
 * decided on. `unhandled` counts the stuck runs NOT cancelled on this pass
 * (every one of them while the owner's flag is off); `truncated` says a run list
 * held more than one page, so a stuck run may exist that was never seen.
 */
export type StuckRunScan = { row: HeartbeatRow; unhandled: number; truncated: boolean };

/** (a) Flag stuck runs; cancel them only when the owner's flag allows it. */
export async function scanStuckRuns(env: Env, nowMs: number = Date.now()): Promise<StuckRunScan> {
  const target = OPS_STUCK_RUNS_TARGET;
  const token = env.GITHUB_DISPATCH_TOKEN;
  if (!token) {
    return { row: { target, ok: false, detail: 'not configured: GITHUB_DISPATCH_TOKEN is not set on this Worker' }, unhandled: 0, truncated: false };
  }
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
    return { row: { target, ok: false, detail: `unreadable: ${String(err).slice(0, 150)}` }, unhandled: 0, truncated: false };
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
  if (stuck.length > 0) console.log(`[cron] ops stuck-runs: ${summary}`);
  // A refused cancel IS a failure of the check's own action — most likely the
  // token lacks actions:write — so it is ok=0 rather than a finding.
  return {
    row: {
      target,
      ok: refused === 0,
      detail: [summary, truncated ? 'more runs than one page, first page only' : '', ...notes].filter(Boolean).join('; '),
    },
    unhandled: stuck.length - cancelled,
    truncated,
  };
}

/** (a) as a row alone — `scanStuckRuns` without the facts the hourly beat reads. */
export async function checkStuckRuns(env: Env, nowMs: number = Date.now()): Promise<HeartbeatRow> {
  return (await scanStuckRuns(env, nowMs)).row;
}

// ─────────────────────────────────────────────────────────────────────────────
// 🔴 THE STALE PAGE — (b) is ANCHORED, not believed. Added 2026-09-18.
//
// MEASURED: this job's 12:00Z firing on 2026-09-18 read ci.yml's newest
// completed run on main as 35117703012 (2026-09-16) while 35340873024 of 11:41Z
// existed. GitHub's runs-list sometimes answers from a replica days behind, and
// a second read of the same URL can be served the same old page. So a page is
// believed only when it satisfies an anchor a stale page cannot:
//   · BRANCH HEAD — for a workflow every push to main runs
//     (OPS_PUSH_TRIGGERED_ON_MAIN), main's HEAD, read from the COMMITS endpoint
//     (git storage, not the Actions replica), must have a run on the page once
//     it is older than OPS_HEAD_RUN_GRACE_MS. Measured 2026-09-18: all 60
//     newest main commits carry a ci.yml push run.
//   · CROSS-READ — a page whose newest run is older than OPS_CROSS_READ_AFTER_MS
//     is asked again by creation date (`created=>=<its newest>`): a different
//     cache key and filter path. A newer run there, outside the race window,
//     proves the page behind. One-way: a staler cross-read cannot fail a fresh page.
// A violated anchor is retried ONCE at a different page size (a real parameter,
// so a different cache key). Then, for a push-triggered workflow, main HEAD's
// own run is asked through THE SECOND PATH below; failing that, the row is ok=0
// "unreadable: stale page" — the check could not read its subject, which is
// exactly what ok=0 means here; it is never a FINDING. The node guards share the same three anchors
// through tooling/ci/run-page-anchor.mjs; this is the Worker's copy of the two
// that apply off-runner (the self-run anchor needs GITHUB_RUN_ID).
//
// ⏱ APPENDED 2026-09-28 · A PAGE PROVEN STALE IS REPLACED BY ITS CROSS-READ,
// not thrown away — the #1041 rule (run-page-anchor.mjs `spliceFreshWindows`),
// Worker copy. MEASURED: Ops watch 36464466131 (18:20Z) went red on this job's
// 18:00Z row "target main:ops-watch.yml: ok=0, detail: unreadable: stale page:
// the page ends at run 35477612056 but a cross-read by creation date answered
// run 36455387316 (after 2 reads)". GitHub's `branch=main` listings had been
// days behind since 2026-09-26; the cross-read HELD the answer (36455387316,
// success, 17:06Z), and ops-watch.yml has no HEAD to ask, so it was discarded.
// A replica can only OMIT runs, never invent one, and a window is complete
// between its oldest row and its newest. So when the cross-read proves the page
// behind (a newer run outside OPS_ANCHOR_RACE_MS), its rows ARE the fresh page
// (`spliceCrossRead`): joined to the page when they reach back to it, alone when
// they do not. That fresh page must still hold main HEAD's run for a
// push-triggered workflow, and must hold a COMPLETED run — a newest-completed
// question it cannot answer is not answered from the stale page below the gap.
// Its newest completed run is graded as any page's is: a red one is a FINDING.
// Otherwise the attempt is refused exactly as before (retry, then THE SECOND
// PATH, then ok=0 "unreadable"). One-way, as ever: a cross-read holding nothing
// newer than the page proves nothing. It costs no request: the cross-read was
// already read. tooling/ci/test/run-page-anchor.test.mjs holds this copy and the
// helper to the same answers ("the Worker copy").
// ─────────────────────────────────────────────────────────────────────────────

/** Workflows EVERY push to main runs — `on.push.branches: [main]`, no path
 *  filter. ops-watch.yml is schedule/dispatch only, so it is not here.
 *  test/ops-watchdog.test.ts re-derives this from .github/workflows. */
export const OPS_PUSH_TRIGGERED_ON_MAIN: readonly string[] = ['ci.yml'];

/** @ceiling none — a GitHub API PAGE SIZE, not a platform resource. The retry
 *  asks for one more, which is a different cache key for the same question. */
export const OPS_MAIN_PAGE_SIZE = 20;

/** @ceiling none — attempts per workflow; each attempt is a page and a cross-read. */
export const OPS_MAIN_READ_ATTEMPTS = 2;

/** @ceiling none — how long a fresh main HEAD may lack its push run (ms). */
export const OPS_HEAD_RUN_GRACE_MS = 10 * 60_000;

/** @ceiling none — a run this recent (ms) may have landed between two reads. */
export const OPS_ANCHOR_RACE_MS = 120_000;

/** @ceiling none — a page whose newest run is younger than this (ms) is not cross-read. */
export const OPS_CROSS_READ_AFTER_MS = 3 * 3_600_000;

export type MainRun = {
  id: number;
  head_sha?: string;
  head_branch?: string;
  status?: string;
  conclusion?: string | null;
  created_at?: string;
  updated_at?: string;
};

const isRunId = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) > 0;

function newestRun(runs: MainRun[]): MainRun | null {
  let best: MainRun | null = null;
  for (const r of runs) if (isRunId(r?.id) && (!best || r.id > best.id)) best = r;
  return best;
}

/** PURE. The anchor verdict for one page of main's history. A refusal carries
 *  `beyond`: the newest cross-read run that proves the page behind (as
 *  run-page-anchor.mjs `judgeRunPage` picks it), or null when only the HEAD
 *  anchor refused — only a proving cross-read is a fresh page to grade instead. */
export function judgeMainPage(
  runs: MainRun[],
  opts: { headSha?: string | null; cross?: MainRun[] | null; nowMs: number },
): { ok: true } | { ok: false; why: string; beyond: MainRun | null } {
  const top = newestRun(runs);
  const ends = top ? `ends at run ${top.id}` : 'holds no run';
  let beyond: MainRun | null = null;
  for (const c of opts.cross ?? []) {
    if (!isRunId(c?.id) || (top && c.id <= top.id)) continue;
    const at = Date.parse(c.updated_at ?? c.created_at ?? '');
    if (!Number.isNaN(at) && opts.nowMs - at <= OPS_ANCHOR_RACE_MS) continue; // a real race, not staleness
    if (!beyond || c.id > beyond.id) beyond = c;
  }
  if (opts.headSha && !runs.some((r) => r?.head_sha === opts.headSha)) {
    return { ok: false, why: `stale page: the page ${ends} and holds no run of main HEAD ${opts.headSha.slice(0, 8)}`, beyond };
  }
  if (beyond) return { ok: false, why: `stale page: the page ${ends} but a cross-read by creation date answered run ${beyond.id}`, beyond };
  return { ok: true };
}

/**
 * PURE. The Worker's copy of run-page-anchor.mjs `spliceFreshWindows`, for its
 * one fresh window: the creation-date cross-read that proved the page stale.
 * The window's rows are the present, de-duplicated by id (a run read twice
 * keeps its later `updated_at`). When the window reaches back to the page's
 * newest run the two are ONE contiguous history and the page's rows join it
 * (`gapBelow: null`); when it does not, only the window's rows are known and
 * `gapBelow` is its oldest run id: an answer below it is in neither read.
 * THROWS on a window with no run id — an unread window is not an empty one.
 */
export function spliceCrossRead(page: MainRun[], cross: MainRun[]): { runs: MainRun[]; gapBelow: number | null } {
  const window = (cross ?? []).filter((r) => isRunId(r?.id));
  if (window.length === 0) throw new Error('stale page: the page was proven stale, and no fresh window came back to grade instead');
  const lo = Math.min(...window.map((r) => r.id));
  const byId = new Map<number, MainRun>();
  const keep = (r: MainRun) => {
    const had = byId.get(r.id);
    if (!had || Date.parse(r.updated_at ?? '') > Date.parse(had.updated_at ?? '')) byId.set(r.id, r);
  };
  for (const r of window) keep(r);
  const top = newestRun(page ?? []);
  if (top && top.id >= lo) {
    for (const r of page) if (isRunId(r?.id)) keep(r);
    return { runs: [...byId.values()], gapBelow: null };
  }
  return { runs: [...byId.values()], gapBelow: lo };
}

/** PURE. The newest COMPLETED run by id — what a main row grades — or null. */
export function newestCompletedRun(runs: MainRun[]): MainRun | null {
  return newestRun(runs.filter((r) => r?.status === 'completed'));
}

/** PURE. The HEAD sha a page must hold, or null when the anchor does not apply
 *  yet (HEAD younger than the grace, or carrying a GitHub skip marker). THROWS
 *  on a body without a 40-hex sha and a date — an unread anchor is not absent. */
export function mainHeadAnchor(body: unknown, nowMs: number): string | null {
  const c = body as { sha?: string; commit?: { message?: string; committer?: { date?: string } } } | null;
  const sha = String(c?.sha ?? '');
  const at = Date.parse(c?.commit?.committer?.date ?? '');
  if (!/^[0-9a-f]{40}$/.test(sha) || Number.isNaN(at)) throw new Error('main HEAD came back without a 40-hex sha and a committer date');
  if (/\[(?:skip ci|ci skip|no ci|skip actions|actions skip)\]/i.test(String(c?.commit?.message ?? ''))) return null;
  return nowMs - at < OPS_HEAD_RUN_GRACE_MS ? null : sha;
}

// ─────────────────────────────────────────────────────────────────────────────
// 🔴 THE SECOND PATH — a refused list is not an unreadable verdict. Added
// 2026-09-22 (O-OPS-WATCHDOG-STALE-PAGE-REDDENS-THE-RAIL).
//
// MEASURED: on 2026-09-21 the 12:00Z firing read a ci.yml page ending at run
// 35422354427 with no run of main HEAD 42e2645e. The anchor refused it, as it
// should, and the ok=0 row paged three Ops watch runs red as "says the job
// FAILED" (35597069314, 35623035343, 35627468681) though nothing on main had
// failed. The lag was per QUERY that day: per_page=1 answered fresh within
// minutes of a stale per_page=5.
//
// So when every attempt at the branch=main list is refused, main's verdict for
// a push-triggered workflow is asked ONCE through a different query:
// `runs?head_sha=<HEAD>`, with the HEAD sha the commits endpoint already gave
// the anchor (no extra read of it). It needs only the Actions read the token
// already carries. Only a run OF HEAD ON MAIN answers; the list is still never
// believed, the anchor and OPS_MAIN_PAGE_SIZE are unchanged, and a second path
// that is unreadable or holds no run of HEAD leaves the row ok=0 "unreadable:
// stale page" exactly as before. ops-watch.yml is schedule-only, so it has no
// HEAD to ask about and no second path (⏱ 2026-09-28: its stale page is answered
// by a proving cross-read instead — "A PAGE PROVEN STALE" above).
// ─────────────────────────────────────────────────────────────────────────────

/** PURE. The second path's answer: the newest run of main HEAD in a
 *  `runs?head_sha=` body, or why there is none. A run of the same sha on
 *  another branch is not main's verdict, so it does not count. */
export function headRunOf(body: unknown, headSha: string): { run: MainRun } | { why: string } {
  const list = (body as { workflow_runs?: unknown } | null)?.workflow_runs;
  const runs = Array.isArray(list) ? (list as MainRun[]) : [];
  const run = newestRun(runs.filter((r) => r?.head_sha === headSha && r?.head_branch === 'main'));
  return run ? { run } : { why: `the head_sha path holds no run of main HEAD ${headSha.slice(0, 8)} either (${runs.length} run(s) answered)` };
}

/** PURE. One run of main graded into its row; `via` names the path that
 *  answered. A COMPLETED run's conclusion is the verdict, and anything but
 *  success is a FINDING. A run still going is ok=1 with no FINDING: the check
 *  read its subject, and the subject has not concluded yet. */
export function gradeMainRun(wf: string, run: MainRun, via: string): HeartbeatRow {
  const target = `main:${wf}`;
  if (run.status !== 'completed') {
    return { target, ok: true, detail: `${wf} on main: run ${run.id} is ${run.status ?? '?'}, not concluded yet ${via}` };
  }
  const conclusion = run.conclusion ?? 'null';
  const tag = conclusion === 'success' ? '' : 'FINDING: ';
  return { target, ok: true, detail: `${tag}${wf} on main: ${conclusion} (run ${run.id}, ${run.updated_at ?? '?'}) ${via}` };
}

async function githubGet(token: string, path: string): Promise<unknown> {
  const res = await fetch(`https://api.github.com/repos/${OPS_REPO.owner}/${OPS_REPO.repo}${path}`, {
    headers: githubHeaders(token),
    signal: AbortSignal.timeout(OPS_FETCH_TIMEOUT_MS),
  });
  if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** One anchored read of a workflow's history on main: the page; the newest
 *  completed run of the fresh page a proving cross-read replaced it with; main
 *  HEAD's run from the second path when every page was refused; or an
 *  `unreadable: …` reason. Never a verdict about the workflow itself. */
async function readMainPage(
  token: string,
  wf: string,
  head: () => Promise<string | null>,
  nowMs: number,
): Promise<
  | { runs: MainRun[] }
  | { freshRun: MainRun; pageTop: number | null; beyond: number }
  | { headRun: MainRun; headSha: string }
  | { unreadable: string }
> {
  let last = '';
  for (let attempt = 0; attempt < OPS_MAIN_READ_ATTEMPTS; attempt++) {
    const base = `/actions/workflows/${wf}/runs?branch=main`;
    const body = (await githubGet(token, `${base}&per_page=${OPS_MAIN_PAGE_SIZE + attempt}`)) as { workflow_runs?: MainRun[] };
    const runs = Array.isArray(body?.workflow_runs) ? body.workflow_runs : [];
    const headSha = OPS_PUSH_TRIGGERED_ON_MAIN.includes(wf) ? await head() : null;
    let cross: MainRun[] | null = null;
    const top = newestRun(runs);
    const topAt = Date.parse(top?.updated_at ?? top?.created_at ?? '');
    if (top?.created_at && (Number.isNaN(topAt) || nowMs - topAt > OPS_CROSS_READ_AFTER_MS)) {
      const c = (await githubGet(token, `${base}&created=${encodeURIComponent(`>=${top.created_at}`)}&per_page=5`)) as { workflow_runs?: MainRun[] };
      cross = Array.isArray(c?.workflow_runs) ? c.workflow_runs : [];
    }
    const verdict = judgeMainPage(runs, { headSha, cross, nowMs });
    if (verdict.ok) return { runs };
    last = verdict.why;
    // The cross-read PROVED the page behind: its rows are the fresh page (see
    // "⏱ APPENDED 2026-09-28" above), held to the same HEAD anchor.
    if (!verdict.beyond || !cross) continue;
    const fresh = spliceCrossRead(runs, cross);
    if (headSha && !fresh.runs.some((r) => r?.head_sha === headSha)) {
      last += `; its cross-read (run ${verdict.beyond.id}) holds no run of HEAD either`;
      continue;
    }
    const run = newestCompletedRun(fresh.runs);
    if (run) return { freshRun: run, pageTop: top?.id ?? null, beyond: verdict.beyond.id };
    last +=
      fresh.gapBelow === null
        ? `; its cross-read (run ${verdict.beyond.id}) and the page hold no completed run`
        : `; its cross-read (run ${verdict.beyond.id}) holds no completed run and reaches back only to run ${fresh.gapBelow}`;
  }
  const refused = `${last} (after ${OPS_MAIN_READ_ATTEMPTS} reads)`;
  // THE SECOND PATH. head() is memoised, so HEAD costs no second read here.
  const headSha = OPS_PUSH_TRIGGERED_ON_MAIN.includes(wf) ? await head() : null;
  if (!headSha) return { unreadable: refused };
  let body: unknown;
  try {
    body = await githubGet(token, `/actions/workflows/${wf}/runs?head_sha=${headSha}&per_page=5`);
  } catch (err) {
    return { unreadable: `${refused}; the head_sha path was unreadable too: ${String(err).slice(0, 80)}` };
  }
  const found = headRunOf(body, headSha);
  return 'run' in found ? { headRun: found.run, headSha } : { unreadable: `${refused}; ${found.why}` };
}

/** (b) main's latest COMPLETED run per declared workflow, from an ANCHORED page.
 *  `graded`, when given, receives the run each row was graded from, keyed by
 *  workflow — what the freshness limb ages, so it spends no read of its own. */
export async function checkMainConclusions(
  env: Env,
  nowMs: number = Date.now(),
  graded?: Map<string, MainRun>,
): Promise<HeartbeatRow[]> {
  const token = env.GITHUB_DISPATCH_TOKEN;
  const rows: HeartbeatRow[] = [];
  let headRead: Promise<string | null> | null = null;
  const head = () => (headRead ??= githubGet(token ?? '', '/commits/main').then((b) => mainHeadAnchor(b, nowMs)));
  for (const wf of OPS_MAIN_WORKFLOWS) {
    const target = `main:${wf}`;
    if (!token) { rows.push({ target, ok: false, detail: 'not configured: GITHUB_DISPATCH_TOKEN is not set on this Worker' }); continue; }
    try {
      const page = await readMainPage(token, wf, head, nowMs);
      if ('unreadable' in page) { rows.push({ target, ok: false, detail: `unreadable: ${page.unreadable}`.slice(0, 300) }); continue; }
      let row: HeartbeatRow;
      if ('headRun' in page) {
        row = gradeMainRun(wf, page.headRun, `via head_sha=${page.headSha.slice(0, 8)} (the branch=main list was a stale page)`);
        graded?.set(wf, page.headRun);
      } else if ('freshRun' in page) {
        row = gradeMainRun(
          wf,
          page.freshRun,
          `via the creation-date cross-read (the branch=main list was a stale page ending at run ${page.pageTop ?? 'none'}; the cross-read answered run ${page.beyond})`,
        );
        graded?.set(wf, page.freshRun);
      } else {
        const run = newestCompletedRun(page.runs);
        if (!run) { rows.push({ target, ok: false, detail: `unreadable: no completed ${wf} run on main in the newest ${OPS_MAIN_PAGE_SIZE}` }); continue; }
        row = gradeMainRun(wf, run, 'via the branch=main list');
        graded?.set(wf, run);
      }
      rows.push(row);
      if (row.detail.startsWith('FINDING: ')) console.log(`[cron] ops watchdog: ${row.detail}`);
    } catch (err) {
      rows.push({ target, ok: false, detail: `unreadable: ${String(err).slice(0, 150)}` });
    }
  }
  return rows;
}

/** (c) GlitchTip monitor status, when a token exists. */
export async function checkGlitchtipMonitors(env: Env): Promise<HeartbeatRow[]> {
  const token = env.GLITCHTIP_TOKEN;
  // Trailing slashes trimmed with a loop, not /\/+$/ — CodeQL js/polynomial-redos.
  let base = (env.GLITCHTIP_URL ?? 'https://glitchtip.nikatru.com').trim();
  while (base.endsWith('/')) base = base.slice(0, -1);
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

// ─────────────────────────────────────────────────────────────────────────────
// ⏱ 2026-10-01 · PB-10, O-OPS-WATCH-GRADES-ITS-OWN-FRESHNESS — WHO NOTICES IF
// OPS-WATCH STOPS? Until today, nothing outside GitHub. ops-watch.yml is what
// reads every heartbeat in this file and files the issue, so a GitHub that stops
// running it (a disabled workflow, a revoked dispatch token, an Actions outage,
// a scheduler that delivers nothing) silences every alarm it carries — and its
// own freshness was graded only by readers that run on GitHub too.
//
// So the age of main's newest COMPLETED ops-watch run is graded here, off
// GitHub, from the run (b) already read: no extra request. Past
// OPS_WATCH_MAX_AGE_HOURS it is a FINDING (ok=1, the rule this file opens with)
// AND a page, sent by scheduled.ts `opsWatchdogJob` straight to Resend
// (lib/owner-page.ts), once per streak. No GlitchTip console step is needed for
// this duty — the Private owner-queue's S-8 retires for it in the next Private
// pass — because the watcher of ops-watch must not be Box B either.
// ─────────────────────────────────────────────────────────────────────────────

/** The workflow whose own freshness is graded. */
export const OPS_WATCH_WORKFLOW = 'ops-watch.yml';

/** The cron_heartbeat target the freshness limb writes, on every pass. */
export const OPS_WATCH_FRESHNESS_TARGET = 'ops-watch-freshness';

/**
 * @ceiling none — an ALERTING THRESHOLD, not a platform resource. DERIVED: the
 *   dispatcher fires ops-watch.yml on EVERY 6-hourly firing (scheduled.ts
 *   GITHUB_DISPATCH_TARGETS, no `everyHours`), and this check runs right after
 *   it on the same firing. So a newest completion older than one grid interval
 *   means the previous firing's dispatch produced no completed run AND none of
 *   the twelve `schedule:` slots in between landed either.
 */
export const OPS_WATCH_MAX_AGE_HOURS = 6;

/** PURE. The freshness row for main's newest completed ops-watch run, or the
 *  honest ok=0 when (b) could not read one — the age was then not judged. */
export function gradeOpsWatchFreshness(run: MainRun | null | undefined, nowMs: number): HeartbeatRow {
  const target = OPS_WATCH_FRESHNESS_TARGET;
  if (!run) {
    return { target, ok: false, detail: `not judged: main:${OPS_WATCH_WORKFLOW} was not read on this pass (its own row says why)` };
  }
  const at = Date.parse(run.updated_at ?? run.created_at ?? '');
  if (Number.isNaN(at)) {
    return { target, ok: false, detail: `not judged: ${OPS_WATCH_WORKFLOW} run ${run.id} carries no date to age` };
  }
  const hours = (nowMs - at) / 3_600_000;
  const facts = `newest completed run ${run.id} on main finished ${new Date(at).toISOString()}, ${hours.toFixed(1)}h ago (ceiling ${OPS_WATCH_MAX_AGE_HOURS}h)`;
  if (hours <= OPS_WATCH_MAX_AGE_HOURS) return { target, ok: true, detail: `${OPS_WATCH_WORKFLOW}: ${facts}` };
  return {
    target,
    ok: true,
    detail: `FINDING: ${OPS_WATCH_WORKFLOW} has STOPPED: ${facts}`,
    page:
      `ops-watch.yml has completed no run on main for ${hours.toFixed(1)}h (ceiling ${OPS_WATCH_MAX_AGE_HOURS}h; ` +
      `newest: run ${run.id}). Every alarm it reads is silent until it runs again - check Actions, the dispatch token and ` +
      `githubstatus.com.`,
  };
}

/** (b), its freshness and (c), in order — (a) runs hourly on its own firing since
 *  2026-09-24 (`scanStuckRuns`). Each limb contains its own errors; a throw out of
 *  here is a bug. */
export async function runOpsWatchdogChecks(env: Env, nowMs: number = Date.now()): Promise<HeartbeatRow[]> {
  const graded = new Map<string, MainRun>();
  const main = await checkMainConclusions(env, nowMs, graded);
  return [
    ...main,
    gradeOpsWatchFreshness(graded.get(OPS_WATCH_WORKFLOW), nowMs),
    ...(await checkGlitchtipMonitors(env)),
  ];
}
