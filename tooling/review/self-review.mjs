#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// self-review.mjs — the factory measuring how it works, once a week, and
// proposing its top three improvements as queue items it never applies.
//
// Row O-NO-WEEKLY-SELF-REVIEW. Every metric's definition, source and the ways it
// can lie are in docs/ops/self-review.md; tooling/ci/test/self-review.test.mjs
// holds the doc to the METRICS list below, so a metric without a definition is
// red.
//
// ── WHAT IT READS ───────────────────────────────────────────────────────────
//   · GitHub, through `gh api -i` only (never fetch, never a token in this file):
//     the pulls list, the Actions runs list (a week at a time, split to days when
//     a week passes the 1000-result list ceiling), `commits/<sha>/check-runs`
//     for ci-gate on each PR's FIRST pushed head — runs are picked by commit SHA
//     and the answer's head_sha is asserted, never "the latest run" — the jobs of
//     every re-run attempt (`filter=all`), and the inline PR review comments.
//   · `--lanes <file>`: the lead's lane ledger (schema: LANE_LEDGER_SCHEMA).
//   · `--reviews <dir>`: the lead's review rulings (*.json, *.md).
//   · guard-yield and the failed-run ledger are CONSUMED, never written:
//     tooling/guard-yield.json (unattributed runs, zero-catch guards) and
//     tooling/ops/failed-run-causes.json (recurring causes) feed the report as
//     they stand. Re-fetching them is triage-failed-runs.mjs --yield's job.
//
// ── WHAT IT WRITES, AND NOTHING ELSE ────────────────────────────────────────
//   <out>/report.md, <out>/report.json, <out>/proposals.json, and the ETag cache
//   under <out>/.cache (or --cache-dir). The cache holds TRIMMED bodies (trimBody):
//   never a raw API answer, never an e-mail address, a login or a name. Every write goes through one `io` seam
//   that refuses a path outside --out (or the cache dir), so the script cannot
//   edit a queue, a brief or a register: the three proposals are data for the
//   lead, ranked by measured cost, and applying one is a person's decision.
//
// ── THE REQUEST BUDGET ──────────────────────────────────────────────────────
//   `--budget N` (default DEFAULT_BUDGET) is a HARD ceiling on requests SENT, a
//   304 included. The request past it is not sent: collection stops, and the
//   report is written INCOMPLETE — `status: "INCOMPLETE"`, `partial: true`,
//   `stopReason: "budget"` in report.json, an INCOMPLETE banner on report.md's
//   first line, every number that WAS measured, no proposals — and the exit is
//   2. Never a silent full report, and never silently nothing: a stop of any
//   kind, an unexpected error included, still writes all three files. The
//   trend's ci-gate reads are best-effort (collect, step 5): a stop there leaves
//   the week complete. A 5xx is retried RETRY_5XX times, each retry counted. Each response's
//   x-ratelimit-remaining is read: under `--rate-floor` (default RATE_FLOOR), a
//   429, or a 403 carrying a spent quota or retry-after, stops the same way with `stopReason: "rate-limit"` and the reset
//   time. The script never sleeps to wait a quota out.
//   ETag: each GET carries If-None-Match from the cache; a 304 is served from it.
//
// ── EXIT ────────────────────────────────────────────────────────────────────
//   0 = report written, every metric over the whole window.
//   2 = COVERAGE LOST: INCOMPLETE (budget, rate limit, http, a list past its ceiling), or
//       an input refused (bad argument, a lane ledger off its schema or carrying
//       an e-mail address, an unreadable reviews dir). A partial report is still
//       written, and says so on its first line.
//
// ── WINDOWS ─────────────────────────────────────────────────────────────────
//   `gh` is spawned as a program with an argv array and no shell (gh.exe on the
//   owner's laptop); `gh api` paths carry no leading slash (trap git-01). Path
//   containment uses the platform's own path module, case-insensitive on win32.
//
// Usage:  node tooling/review/self-review.mjs --out DIR [--repo owner/name]
//           [--since ISO] [--until ISO] [--budget N] [--rate-floor N]
//           [--lanes FILE] [--reviews DIR] [--cache-dir DIR] [--fixture FILE]
//   `--fixture FILE` replays recorded API responses ({"<path>": {status, headers,
//   body}}) instead of spawning gh: the tests' transport, no network at all.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
export const YIELD_REL = 'tooling/guard-yield.json';
export const CAUSES_REL = 'tooling/ops/failed-run-causes.json';
export const DEFAULT_REPO = 'globalonlinedeveloper/Nikatru_Platform_Public';
/** One real week, MEASURED, not estimated: the requests a full run at the defaults sent for the week to `asOf`
 *  (`--until asOf`). DEFAULT_BUDGET is sized from it with headroom (the test holds it at 1.5× or more), so the
 *  documented defaults complete a real week. Re-measure when the factory's volume moves. */
export const MEASURED_WEEK = Object.freeze({ requests: 975, asOf: '2026-10-02' });
export const DEFAULT_BUDGET = 1500;
export const RATE_FLOOR = 100;
export const DAY_MS = 86_400_000;
export const WINDOW_DAYS = 7;
export const TREND_WEEKS = 4;
export const CI_PATH = '.github/workflows/ci.yml';
export const OPS_WATCH_PATH = '.github/workflows/ops-watch.yml';
export const GATE_CHECK = 'ci-gate';
/** GitHub stops paging a filtered runs list at 1000 results. */
export const LIST_CEILING = 1000;
const PER_PAGE = 100;
const RED = new Set(['failure', 'timed_out']);
const LOST = new Set(['failure', 'timed_out', 'cancelled', 'startup_failure']);
/** A gate with one of these conclusions gave no verdict on the change (cancelled by a newer run, or skipped). */
const SUPERSEDED = new Set(['cancelled', 'skipped']);
/** Runs started by these events watch live state; a red→green between their attempts is the state, not a flake. */
const WATCHER_EVENTS = new Set(['schedule', 'workflow_dispatch']);

/** The metrics, in report order. docs/ops/self-review.md carries one `## <id>` section per entry. */
export const METRICS = Object.freeze([
  'first-push-green',
  'time-to-merge',
  'review-findings',
  'flaky',
  'mttr',
  'cost-per-lane',
]);

export const LANE_LEDGER_SCHEMA = Object.freeze({
  lanes: '[ { lane: string (required), branch?: string, prs?: [int], costUsd?: number, tokens?: int, agentMinutes?: number } ]',
});

export class BudgetStop extends Error {
  constructor(reason, msg) {
    super(msg);
    this.name = 'STOP';
    this.reason = reason;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// PURE HELPERS
// ═══════════════════════════════════════════════════════════════════════════

const ms = (iso) => (iso ? Date.parse(iso) : NaN);
const minutes = (a, b) => (Number.isFinite(ms(a)) && Number.isFinite(ms(b)) ? Math.max(0, (ms(b) - ms(a)) / 60_000) : 0);
const round = (x, d = 1) => (Number.isFinite(x) ? Math.round(x * 10 ** d) / 10 ** d : null);
const inWin = (iso, w) => Number.isFinite(ms(iso)) && ms(iso) >= w.since && ms(iso) < w.until;
export const isoDay = (t) => new Date(t).toISOString().slice(0, 10);

/** Nearest-rank percentile; null over an empty set. */
export function percentile(values, p) {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return null;
  return v[Math.min(v.length - 1, Math.max(0, Math.ceil((p / 100) * v.length) - 1))];
}

/** True when `child` is `parent` or below it, by the given path module (path.win32 compares case-insensitively
 *  and treats `/` and `\\` alike, so the owner's laptop spelling `c:/users/...` is the same directory). */
export function isInside(parent, child, p = path) {
  const rel = p.relative(p.resolve(parent), p.resolve(child));
  return rel === '' || (!rel.startsWith('..') && !p.isAbsolute(rel));
}

/** The `gh` argv for one GET: no shell, no leading slash on the path (git-01). */
export function ghArgs(apiPath, etag) {
  if (typeof apiPath !== 'string' || apiPath.startsWith('/') || /\s/.test(apiPath)) {
    throw new Error(`refusing api path ${JSON.stringify(String(apiPath)).slice(0, 120)}`);
  }
  const a = ['api', '-i', '--method', 'GET', apiPath, '-H', 'Accept: application/vnd.github+json'];
  if (etag) a.push('-H', `If-None-Match: ${etag}`);
  return a;
}

/** `gh api -i` output: a status line, headers, a blank line, the body. CRLF or LF. */
export function parseHttp(text) {
  const s = String(text ?? '');
  const m = /^HTTP\/[\d.]+\s+(\d{3})[^\n]*\n/.exec(s);
  if (!m) return null;
  const sep = s.search(/\r?\n\r?\n/);
  const head = sep === -1 ? s : s.slice(0, sep);
  const body = sep === -1 ? '' : s.slice(sep).replace(/^\r?\n\r?\n/, '');
  const headers = {};
  for (const line of head.split(/\r?\n/).slice(1)) {
    const i = line.indexOf(':');
    if (i > 0) headers[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
  }
  return { status: Number(m[1]), headers, body };
}

/** The `rel="next"` URL of a Link header, as a gh path (no host, no leading slash). */
export function nextLink(link) {
  const m = /<([^>]+)>;\s*rel="next"/.exec(String(link ?? ''));
  if (!m) return null;
  return m[1].replace(/^https?:\/\/[^/]+\//, '');
}

// ═══════════════════════════════════════════════════════════════════════════
// TRANSPORT + CLIENT — budget, ETag cache, rate-limit headers
// ═══════════════════════════════════════════════════════════════════════════

/** Live: one `gh api -i` per request. Returns {status, headers, body}. */
export function ghTransport({ spawn = spawnSync } = {}) {
  return (apiPath, etag) => {
    const r = spawn('gh', ghArgs(apiPath, etag), { encoding: 'utf8', timeout: 60_000, maxBuffer: 64 * 1024 * 1024, shell: false });
    const parsed = parseHttp(r.stdout);
    if (parsed) return parsed;
    const why = r.error ? r.error.code || r.error.message : `exit ${r.status}`;
    throw new BudgetStop('transport', `gh api ${apiPath} returned no HTTP response (${why})`);
  };
}

/** Offline: replays {"<path>": {status, headers, body}} recorded responses. */
export function fixtureTransport(responses) {
  return (apiPath) => {
    const r = responses[apiPath];
    if (!r) return { status: 404, headers: {}, body: '{"message":"Not Found (no fixture)"}' };
    return { status: r.status ?? 200, headers: r.headers ?? {}, body: typeof r.body === 'string' ? r.body : JSON.stringify(r.body) };
  };
}

/** True when a 403 is GitHub's rate limit (quota spent, or a secondary limit's retry-after), not a permission
 *  refusal: a "Resource not accessible" 403 is an `http` stop, never reported as a quota with a reset time. */
export function isRateLimited(status, headers = {}) {
  if (status === 429) return true;
  if (status !== 403) return false;
  return headers['retry-after'] !== undefined || (headers['x-ratelimit-remaining'] !== undefined && Number(headers['x-ratelimit-remaining']) === 0);
}

// ── DATA MINIMISATION ───────────────────────────────────────────────────────
// Every body is cut to the fields the report reads THE MOMENT IT IS PARSED, before
// it is cached or kept: a runs page carries head_commit (author and committer
// e-mails), actor and triggering_actor (logins) and a run name that can carry a
// login ("CI on PR #1 by @x"); a pulls page carries user; a review comment carries
// its author and free text. None of that is a field below, so none of it reaches
// --out, the cache or the report. An endpoint not listed keeps nothing.
const pick = (o, keys) => (o && typeof o === 'object' ? Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]])) : null);
const RUN_KEYS = ['id', 'path', 'event', 'head_branch', 'head_sha', 'status', 'conclusion', 'created_at', 'run_started_at', 'updated_at', 'run_attempt'];
const PR_KEYS = ['number', 'created_at', 'updated_at', 'closed_at', 'merged_at'];
const JOB_KEYS = ['id', 'name', 'head_sha', 'run_attempt', 'status', 'conclusion', 'started_at', 'completed_at'];
const CHECK_KEYS = ['name', 'head_sha', 'status', 'conclusion', 'started_at', 'completed_at'];

/** The run id of a check run, from its Actions details_url (`…/actions/runs/<id>/job/<job>`); null otherwise. */
export function runIdOfCheck(c) {
  const m = /\/actions\/runs\/(\d+)(?:\/|$)/.exec(String(c?.details_url ?? ''));
  return m ? Number(m[1]) : (Number.isInteger(c?.runId) ? c.runId : null);
}

/** The body of one GET, cut to what the report reads. The path decides the shape. */
export function trimBody(apiPath, body) {
  const p = String(apiPath).split('?')[0];
  if (/\/actions\/runs$/.test(p)) {
    return { total_count: body?.total_count, workflow_runs: (body?.workflow_runs ?? []).map((r) => ({ ...pick(r, RUN_KEYS), pull_requests: (r.pull_requests ?? []).map((x) => ({ number: x?.number })) })) };
  }
  if (/\/actions\/runs\/\d+\/jobs$/.test(p)) return { total_count: body?.total_count, jobs: (body?.jobs ?? []).map((j) => pick(j, JOB_KEYS)) };
  if (/\/commits\/[0-9a-f]{7,40}\/check-runs$/.test(p)) {
    return { total_count: body?.total_count, check_runs: (body?.check_runs ?? []).map((c) => ({ ...pick(c, CHECK_KEYS), runId: runIdOfCheck(c) })) };
  }
  if (/\/pulls\/comments$/.test(p)) {
    // The text is read for its class here and then dropped: a comment can quote an address or @-mention a person.
    return (body ?? []).map((c) => ({ id: c?.id, in_reply_to_id: c?.in_reply_to_id ?? null, created_at: c?.created_at, pull_request_url: c?.pull_request_url, class: c?.class ?? classOf(c?.body) }));
  }
  if (/\/pulls$/.test(p)) return (body ?? []).map((x) => ({ ...pick(x, PR_KEYS), head: { ref: x?.head?.ref } }));
  return null;
}

/** A 5xx is retried this many times (each retry a request against the budget) before the walk stops with `http`:
 *  the jobs endpoint answers 502 on large `filter=all` pages routinely, and one of those ended a whole live run. */
export const RETRY_5XX = 2;

export function makeClient(transport, { budget = DEFAULT_BUDGET, rateFloor = RATE_FLOOR, cacheDir = null, io, trim = trimBody } = {}) {
  let sent = 0;
  let notModified = 0;
  let retried = 0;
  let lastRate = null;
  let pendingStop = null;
  const key = (p) => `etag-${createHash('sha256').update(p).digest('hex').slice(0, 32)}.json`;
  const readCache = (p) => {
    if (!cacheDir) return null;
    try {
      return JSON.parse(io.read(path.join(cacheDir, key(p))));
    } catch {
      return null;
    }
  };
  async function get(apiPath) {
    const cached = readCache(apiPath);
    let r;
    for (let attempt = 0; ; attempt++) {
      if (sent >= budget) {
        throw new BudgetStop('budget', `budget — ${sent} of ${budget} request(s) sent; GET ${apiPath} would be one more, so it was not sent`);
      }
      sent += 1;
      r = transport(apiPath, cached?.etag ?? null);
      if (r.status >= 500 && r.status < 600 && attempt < RETRY_5XX) {
        retried += 1;
        continue;
      }
      break;
    }
    const remaining = Number(r.headers['x-ratelimit-remaining']);
    const reset = Number(r.headers['x-ratelimit-reset']);
    if (Number.isFinite(remaining)) lastRate = { remaining, reset: Number.isFinite(reset) ? new Date(reset * 1000).toISOString() : null };
    if (isRateLimited(r.status, r.headers)) {
      throw new BudgetStop('rate-limit', `rate-limit — GET ${apiPath} answered ${r.status}${lastRate?.reset ? `; the quota resets at ${lastRate.reset}` : ''}${r.headers['retry-after'] ? `; retry-after ${r.headers['retry-after']}s` : ''}`);
    }
    let body;
    let headers = r.headers;
    if (r.status === 304 && cached) {
      notModified += 1;
      body = trim(apiPath, cached.body);
      headers = { ...cached.headers, ...r.headers };
    } else if (r.status >= 200 && r.status < 300) {
      body = trim(apiPath, r.body ? JSON.parse(r.body) : null);
      if (cacheDir && r.headers.etag) io.write(path.join(cacheDir, key(apiPath)), JSON.stringify({ etag: r.headers.etag, headers: { link: r.headers.link ?? null }, body }));
    } else {
      throw new BudgetStop('http', `GET ${apiPath} answered ${r.status}${r.status >= 500 ? ` after ${RETRY_5XX} retr${RETRY_5XX === 1 ? 'y' : 'ies'}` : ''}`);
    }
    if (Number.isFinite(remaining) && remaining < rateFloor) {
      // The answer in hand is kept; the NEXT request is the one refused.
      pendingStop = new BudgetStop('rate-limit', `rate-limit — x-ratelimit-remaining ${remaining} < floor ${rateFloor}${lastRate?.reset ? `; the quota resets at ${lastRate.reset}` : ''}`);
    }
    return { body, headers };
  }
  async function guardedGet(p) {
    if (pendingStop) throw pendingStop;
    return get(p);
  }
  /** Every page of a list, following Link rel=next. `pick` extracts the items of one page; each page lands in
   *  `into` as it is read, so a stop part-way keeps the pages before it. */
  async function all(first, pick = (b) => b, { last = () => false, into = [] } = {}) {
    let p = first;
    let total = null;
    while (p) {
      const { body, headers } = await guardedGet(p);
      if (total === null && body && Number.isInteger(body.total_count)) total = body.total_count;
      into.push(...(pick(body) ?? []));
      if (last(body)) break;
      p = nextLink(headers.link);
    }
    return { items: into, total };
  }
  return { get: guardedGet, all, stats: () => ({ sent, notModified, retried, budget, rate: lastRate }) };
}

// ═══════════════════════════════════════════════════════════════════════════
// COLLECTION — every request in a fixed order, so a budget stop is reproducible
// ═══════════════════════════════════════════════════════════════════════════

export function windows(sinceMs, untilMs) {
  const current = { since: sinceMs, until: untilMs };
  const trend = [];
  for (let i = TREND_WEEKS - 1; i >= 0; i--) {
    trend.push({ since: untilMs - (i + 1) * 7 * DAY_MS, until: untilMs - i * 7 * DAY_MS });
  }
  return { current, trend, fetchSince: Math.min(sinceMs, trend[0].since), until: untilMs };
}

/** The run's PR: pull_requests[0], else the one PR whose head branch is the run's and whose open span covers it. */
export function prOfRun(run, prs) {
  const n = run.pull_requests?.[0]?.number;
  if (Number.isInteger(n)) return n;
  const t = ms(run.created_at);
  const hits = prs.filter((p) => p.head?.ref === run.head_branch && ms(p.created_at) <= t && (!p.closed_at || ms(p.closed_at) >= t));
  return hits.length === 1 ? hits[0].number : null;
}

export const emptyData = () => ({ prs: [], runs: [], gateBySha: {}, attemptJobs: {}, reviewComments: [], phases: [], capped: [], trendStop: null });

/** De-duplicates the runs and names each ci.yml pull_request run's PR. Idempotent; safe over a partial read. */
export function tagRuns(data) {
  const seen = new Set();
  data.runs = data.runs.filter((r) => (seen.has(r.id) ? false : seen.add(r.id)));
  for (const r of data.runs) r._pr = r.path === CI_PATH && r.event === 'pull_request' ? prOfRun(r, data.prs) : null;
  return data;
}

/** Fills `data` in place, in a fixed order, so whatever was read before a stop is still there to report. */
export async function collect(client, { repo, win, reviews = true }, data = emptyData()) {
  const R = `repos/${repo}`;
  const range = (a, b) => `${new Date(a).toISOString().slice(0, 19)}Z..${new Date(b - 1000).toISOString().slice(0, 19)}Z`;
  const runsPath = (a, b) => `${R}/actions/runs?created=${encodeURIComponent(range(a, b))}&per_page=${PER_PAGE}`;
  // 1. PRs by update, newest first, until a page reaches past the fetch start (a PR merged in the window was updated in it).
  await client.all(`${R}/pulls?state=all&sort=updated&direction=desc&per_page=${PER_PAGE}`, (b) => (b ?? []).filter((p) => ms(p.updated_at) >= win.fetchSince), {
    last: (b) => (b ?? []).some((p) => ms(p.updated_at) < win.fetchSince),
    into: data.prs,
  });
  data.phases.push('prs');
  // 2. Runs, a week at a time; a week past the list ceiling is re-read a day at a time. Its first page says so
  //    (total_count), so the rest of that week is never paged: the days are read instead.
  const over = (b) => (b?.total_count ?? 0) > LIST_CEILING;
  for (let s = win.fetchSince; s < win.until; s += 7 * DAY_MS) {
    const e = Math.min(s + 7 * DAY_MS, win.until);
    const week = await client.all(runsPath(s, e), (b) => (over(b) ? [] : b?.workflow_runs), { into: data.runs, last: over });
    if ((week.total ?? 0) <= LIST_CEILING) continue;
    for (let d = s; d < e; d += DAY_MS) {
      const day = await client.all(runsPath(d, Math.min(d + DAY_MS, e)), (x) => x?.workflow_runs, { into: data.runs });
      if ((day.total ?? 0) > LIST_CEILING) data.capped.push(`runs created ${range(d, Math.min(d + DAY_MS, e))}: ${day.total} > ${LIST_CEILING}`);
    }
  }
  tagRuns(data);
  data.phases.push('runs');
  // 3. Re-run attempts in the current window: every attempt's jobs.
  for (const r of data.runs.filter((x) => x.run_attempt > 1 && inWin(x.created_at, win.current))) {
    data.attemptJobs[r.id] = [];
    await client.all(`${R}/actions/runs/${r.id}/jobs?filter=all&per_page=${PER_PAGE}`, (b) => b?.jobs, { into: data.attemptJobs[r.id] });
  }
  data.phases.push('attempts');
  // 4. Review comments in the current window.
  if (reviews) {
    const into = [];
    await client.all(`${R}/pulls/comments?sort=created&direction=asc&since=${encodeURIComponent(new Date(win.current.since).toISOString())}&per_page=${PER_PAGE}`, (b) => b, { into });
    data.reviewComments = into.filter((x) => inWin(x.created_at, win.current));
  }
  data.phases.push('reviews');
  // 5. ci-gate on each PR's FIRST pushed head: the current window first, then the trend weeks newest first.
  //    The trend's reads are BEST-EFFORT: a stop there (budget, rate limit, an http error) is kept in
  //    data.trendStop, the weeks it did not reach show first-push-green n/a, and the current window, already
  //    whole, still reports complete and still proposes. A stop before gate:current is a stop of the week.
  const order = [win.current, ...[...win.trend].reverse()];
  const done = new Set();
  const gate = async (w) => {
    for (const p of data.prs.filter((x) => inWin(x.created_at, w))) {
      const sha = firstHead(p.number, data.runs);
      if (!sha || done.has(sha)) continue;
      done.add(sha);
      const { body } = await client.get(`${R}/commits/${sha}/check-runs?check_name=${GATE_CHECK}&filter=all&per_page=${PER_PAGE}`);
      data.gateBySha[sha] = (body?.check_runs ?? []).filter((c) => c.head_sha === sha);
    }
  };
  for (const [i, w] of order.entries()) {
    if (i === 0) {
      await gate(w);
      data.phases.push('gate:current');
      continue;
    }
    try {
      await gate(w);
    } catch (e) {
      if (!(e instanceof BudgetStop)) throw e;
      data.trendStop = e;
      break;
    }
    data.phases.push(`gate:trend-${i}`);
  }
  return data;
}

/** A PR's first pushed head: the head SHA of its EARLIEST ci.yml pull_request run. */
export function firstHead(prNumber, runs) {
  const mine = runs.filter((r) => r._pr === prNumber).sort((a, b) => ms(a.created_at) - ms(b.created_at));
  return mine[0]?.head_sha ?? null;
}

// ═══════════════════════════════════════════════════════════════════════════
// METRICS — pure, over collected data
// ═══════════════════════════════════════════════════════════════════════════

export function firstPushGreen(data, w) {
  const opened = data.prs.filter((p) => inWin(p.created_at, w));
  const rows = [];
  for (const p of opened) {
    const sha = firstHead(p.number, data.runs);
    if (!sha) {
      rows.push({ pr: p.number, verdict: 'no-run' });
      continue;
    }
    const checks = data.gateBySha[sha];
    if (!checks) {
      rows.push({ pr: p.number, sha, verdict: 'unread' });
      continue;
    }
    const done = checks.filter((c) => c.status === 'completed').sort((a, b) => ms(a.started_at) - ms(b.started_at));
    // A cancelled or skipped gate passed no verdict on the change: a second push or an `edited` re-trigger cancels
    // the first (ci.yml's cancel-in-progress). The first gate that DID conclude is the one read; none is `superseded`.
    const firstDone = done.find((c) => !SUPERSEDED.has(c.conclusion));
    const verdict = !done.length ? 'pending' : !firstDone ? 'superseded' : firstDone.conclusion === 'success' ? 'green' : 'red';
    // Red first, then green on the SAME SHA in a RE-RUN of the same workflow run: still red here (the definition),
    // and priced as a flake. A green from another run on that SHA (an `edited` re-trigger, which also tests a newer
    // merge with main) is not a re-run, so the red stays red on the change.
    const rid = runIdOfCheck(firstDone);
    const greenLater = verdict === 'red' && rid !== null && checks.some((c) => c.conclusion === 'success' && runIdOfCheck(c) === rid && ms(c.started_at) > ms(firstDone.started_at));
    rows.push({ pr: p.number, sha, verdict, greenLater });
  }
  const green = rows.filter((r) => r.verdict === 'green').length;
  const red = rows.filter((r) => r.verdict === 'red').length;
  return {
    opened: opened.length,
    green,
    red,
    excluded: rows.filter((r) => !['green', 'red'].includes(r.verdict)).map((r) => ({ pr: r.pr, verdict: r.verdict })),
    rate: green + red ? round((100 * green) / (green + red)) : null,
    redPrs: rows.filter((r) => r.verdict === 'red').map((r) => r.pr),
    redThenGreenSameSha: rows.filter((r) => r.greenLater).map((r) => r.pr),
    complete: rows.every((r) => r.verdict !== 'unread'),
  };
}

export function timeToMerge(data, w) {
  const merged = data.prs.filter((p) => p.merged_at && inWin(p.merged_at, w));
  const open = [];
  const green = [];
  let noGreen = 0;
  for (const p of merged) {
    open.push(minutes(p.created_at, p.merged_at) / 60);
    const g = data.runs
      .filter((r) => r._pr === p.number && r.conclusion === 'success')
      .sort((a, b) => ms(a.updated_at) - ms(b.updated_at))[0];
    if (g && ms(g.updated_at) <= ms(p.merged_at)) green.push(minutes(g.updated_at, p.merged_at) / 60);
    else noGreen += 1;
  }
  return {
    merged: merged.length,
    openedToMergedHours: { median: round(percentile(open, 50)), p90: round(percentile(open, 90)) },
    firstGreenToMergedHours: { median: round(percentile(green, 50)), p90: round(percentile(green, 90)), n: green.length, noGreenInWindow: noGreen },
  };
}

export function flaky(data, w) {
  const instances = [];
  // ONLY a re-run: one job name with a red attempt and a later green attempt of the SAME run, on its one head SHA.
  // Two separate runs on one SHA are never a flake here: on main they are ops-watch's schedule and dispatches
  // watching a state recover (measured: 13 of 14 such pairs in a real week), and on a PR an `edited` re-trigger
  // that also tests a newer merge with main.
  for (const [runId, jobs] of Object.entries(data.attemptJobs)) {
    const run = data.runs.find((r) => String(r.id) === runId);
    // A watcher (cron or dispatch) re-run that turns green read the world again, and the world recovered.
    if (WATCHER_EVENTS.has(run?.event)) continue;
    const byName = new Map();
    for (const j of jobs) {
      if (j.head_sha && run && j.head_sha !== run.head_sha) continue;
      if (!byName.has(j.name)) byName.set(j.name, []);
      byName.get(j.name).push(j);
    }
    for (const [name, js] of byName) {
      // The gate is red because another job was: it is never the flake itself.
      if (name === GATE_CHECK) continue;
      js.sort((a, b) => (a.run_attempt ?? 0) - (b.run_attempt ?? 0));
      const redIdx = js.findIndex((j) => RED.has(j.conclusion));
      if (redIdx !== -1 && js.slice(redIdx + 1).some((j) => j.conclusion === 'success')) {
        const lost = js.slice(0, js.length - 1).reduce((s, j) => s + minutes(j.started_at, j.completed_at), 0);
        instances.push({ kind: 'rerun', workflow: run?.path ?? null, name, sha: run?.head_sha ?? null, runId: Number(runId), minutesLost: round(lost) });
      }
    }
  }
  const reruns = data.runs.filter((r) => inWin(r.created_at, w)).reduce((s, r) => s + Math.max(0, (r.run_attempt ?? 1) - 1), 0);
  const byName = {};
  for (const i of instances) {
    const k = i.name;
    byName[k] ??= { count: 0, minutesLost: 0 };
    byName[k].count += 1;
    byName[k].minutesLost = round(byName[k].minutesLost + (i.minutesLost ?? 0));
  }
  return { reruns, instances, byName };
}

/** Incidents of one workflow on main: the first red after green opens one, the next green closes it. */
export function incidents(runs, workflowPath, w) {
  const xs = runs
    .filter((r) => r.path === workflowPath && r.head_branch === 'main' && r.status === 'completed' && (RED.has(r.conclusion) || r.conclusion === 'success'))
    .sort((a, b) => ms(a.updated_at) - ms(b.updated_at));
  const out = [];
  let open = null;
  for (const r of xs) {
    if (RED.has(r.conclusion) && !open) open = { redRun: r.id, redAt: r.updated_at };
    else if (r.conclusion === 'success' && open) {
      out.push({ ...open, greenRun: r.id, greenAt: r.updated_at, hours: round(minutes(open.redAt, r.updated_at) / 60, 2), open: false });
      open = null;
    }
  }
  if (open) out.push({ ...open, greenRun: null, greenAt: null, hours: round(minutes(open.redAt, new Date(w.until).toISOString()) / 60, 2), open: true });
  return out.filter((i) => ms(i.redAt) < w.until && (i.open || ms(i.greenAt) >= w.since));
}

export function mttr(data, w) {
  const one = (p) => {
    const inc = incidents(data.runs, p, w);
    const closed = inc.filter((i) => !i.open).map((i) => i.hours);
    return { incidents: inc, median: round(percentile(closed, 50), 2), redHours: round(inc.reduce((s, i) => s + i.hours, 0), 2) };
  };
  return { main: one(CI_PATH), opsWatch: one(OPS_WATCH_PATH) };
}

export function ciMinutes(data, w) {
  const per = {};
  for (const r of data.runs.filter((x) => inWin(x.created_at, w) && x.status === 'completed')) {
    const k = r.path || 'unknown';
    per[k] ??= { runs: 0, minutes: 0, lostMinutes: 0 };
    const m = minutes(r.run_started_at ?? r.created_at, r.updated_at);
    per[k].runs += 1;
    per[k].minutes = round(per[k].minutes + m);
    if (LOST.has(r.conclusion)) per[k].lostMinutes = round(per[k].lostMinutes + m);
  }
  return per;
}

/** The median wall minutes of a completed ci.yml pull_request run: the price of one more CI cycle. */
export function ciCycleMinutes(data, w) {
  const xs = data.runs
    .filter((r) => r.path === CI_PATH && r.event === 'pull_request' && r.status === 'completed' && inWin(r.created_at, w))
    .map((r) => minutes(r.run_started_at ?? r.created_at, r.updated_at));
  return round(percentile(xs, 50) ?? 0);
}

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

/** The lane ledger, held to LANE_LEDGER_SCHEMA. Throws a message naming the first offence. */
export function validateLanes(doc) {
  if (!doc || !Array.isArray(doc.lanes)) throw new Error('lane ledger: expected {"lanes": [...]}');
  const text = JSON.stringify(doc);
  if (EMAIL.test(text)) throw new Error('lane ledger: carries an e-mail address; the report names lanes, never a person');
  doc.lanes.forEach((l, i) => {
    const at = `lane ledger: lanes[${i}]`;
    if (!l || typeof l.lane !== 'string' || !l.lane) throw new Error(`${at}.lane must be a non-empty string`);
    if (l.branch !== undefined && typeof l.branch !== 'string') throw new Error(`${at}.branch must be a string`);
    if (l.prs !== undefined && !(Array.isArray(l.prs) && l.prs.every(Number.isInteger))) throw new Error(`${at}.prs must be a list of PR numbers`);
    for (const f of ['costUsd', 'agentMinutes', 'tokens']) {
      if (l[f] !== undefined && !(typeof l[f] === 'number' && Number.isFinite(l[f]) && l[f] >= 0)) throw new Error(`${at}.${f} must be a non-negative number`);
    }
  });
  return doc.lanes;
}

export function costPerLane(data, w, lanes) {
  const rows = [];
  for (const l of lanes ?? []) {
    const prs = new Set(l.prs ?? []);
    const mine = data.runs.filter(
      (r) => inWin(r.created_at, w) && r.status === 'completed' && ((l.branch && r.head_branch === l.branch) || (r._pr !== null && prs.has(r._pr))),
    );
    const m = mine.reduce((s, r) => s + minutes(r.run_started_at ?? r.created_at, r.updated_at), 0);
    const lost = mine.filter((r) => LOST.has(r.conclusion)).reduce((s, r) => s + minutes(r.run_started_at ?? r.created_at, r.updated_at), 0);
    rows.push({
      lane: l.lane,
      runs: mine.length,
      ciMinutes: round(m),
      lostMinutes: round(lost),
      reruns: mine.reduce((s, r) => s + Math.max(0, (r.run_attempt ?? 1) - 1), 0),
      costUsd: l.costUsd ?? null,
      tokens: l.tokens ?? null,
      agentMinutes: l.agentMinutes ?? null,
    });
  }
  return rows.sort((a, b) => b.lostMinutes - a.lostMinutes || b.ciMinutes - a.ciMinutes);
}

/** A finding's class: `class: <tag>`, else a leading `[tag]`, else the review bot's circle, else `untagged`. */
export function classOf(text) {
  const s = String(text ?? '');
  const m = /\bclass:\s*`?([a-z0-9][a-z0-9_-]*)/i.exec(s) ?? /^\s*(?:[-*]\s*)?\**\[([a-z0-9][a-z0-9_-]*)\]/i.exec(s);
  if (m) return m[1].toLowerCase();
  if (s.includes('🔴')) return 'blocking';
  if (s.includes('🟡')) return 'nit';
  if (s.includes('🟣')) return 'pre-existing';
  return 'untagged';
}

/** Rulings from --reviews: *.json ({findings:[{class, pr?}]} or a bare list) and *.md (one finding per tagged list item). */
export function readRulings(dir, io) {
  const out = [];
  for (const f of io.list(dir).sort()) {
    const full = path.join(dir, f);
    if (f.endsWith('.json')) {
      const doc = JSON.parse(io.read(full));
      for (const x of Array.isArray(doc) ? doc : (doc.findings ?? [])) out.push({ source: 'ruling', file: f, pr: Number.isInteger(x?.pr) ? x.pr : null, class: x?.class ? String(x.class).toLowerCase() : 'untagged' });
    } else if (f.endsWith('.md')) {
      for (const line of io.read(full).split(/\r?\n/)) {
        if (!/^\s*[-*]\s+/.test(line)) continue;
        const c = classOf(line);
        if (c !== 'untagged') out.push({ source: 'ruling', file: f, pr: Number((/#(\d+)/.exec(line) ?? [])[1]) || null, class: c });
      }
    }
  }
  return out;
}

export function reviewFindings(data, rulings) {
  const findings = [
    ...data.reviewComments.filter((c) => !c.in_reply_to_id).map((c) => ({ source: 'pr-comment', pr: Number((/\/pulls\/(\d+)$/.exec(c.pull_request_url ?? '') ?? [])[1]) || null, class: classOf(c.body) })),
    ...(rulings ?? []),
  ];
  const byClass = {};
  for (const f of findings) byClass[f.class] = (byClass[f.class] ?? 0) + 1;
  return { total: findings.length, byClass };
}

/** What the existing ledgers already say: consumed as they stand, never rewritten. */
export function readLedgers(io, root = ROOT) {
  const out = {};
  try {
    const y = JSON.parse(io.read(path.join(root, YIELD_REL)));
    out.guardYield = { asOf: y.asOf, zeroCatch: y.zeroCatch, unattributed: y.unattributed, considered: y.runs?.considered ?? null };
  } catch {
    out.guardYield = null;
  }
  try {
    const c = JSON.parse(io.read(path.join(root, CAUSES_REL)));
    const byKind = {};
    for (const x of c.causes ?? []) byKind[x.fixedBy?.kind ?? 'untyped'] = (byKind[x.fixedBy?.kind ?? 'untyped'] ?? 0) + 1;
    out.failedRunCauses = { causes: (c.causes ?? []).length, byKind };
  } catch {
    out.failedRunCauses = null;
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
// PROPOSALS — the top three improvements, ranked by measured cost in minutes
// ═══════════════════════════════════════════════════════════════════════════

/** Every candidate is priced in MINUTES LOST, so one ranking can compare them. A rerun or a red first push
 *  costs its red minutes plus one CI cycle (the median ci.yml PR run) of lane time; a red main costs its red
 *  hours as minutes, since every lane waits on it; a review class costs one CI cycle per finding (a fix push). */
export function proposals(report, day) {
  const cyc = report.ciCycleMinutes ?? 0;
  const c = [];
  const fl = report.metrics.flaky;
  const topFlake = Object.entries(fl.byName).sort((a, b) => b[1].minutesLost - a[1].minutesLost || b[1].count - a[1].count)[0];
  if (fl.reruns > 0 || topFlake) {
    const lost = Object.values(fl.byName).reduce((s, x) => s + x.minutesLost, 0);
    c.push({
      kind: 'flake',
      cost: lost + fl.reruns * cyc,
      lane: `fix-flake-${slug(topFlake?.[0] ?? 'reruns')}`,
      brief: `Reruns dominate: ${fl.reruns} rerun(s) and ${fl.instances.length} flaky instance(s) cost ${round(lost)} red minutes plus ${fl.reruns} CI cycle(s) of ${cyc} min. The worst is "${topFlake?.[0] ?? 'n/a'}" (${topFlake?.[1].count ?? 0} flake(s), ${topFlake?.[1].minutesLost ?? 0} min). Root-cause it and make it deterministic; never retry or quarantine it.`,
    });
  }
  const fp = report.metrics['first-push-green'];
  // A first push that went green on a re-run of the same SHA is priced once, under the flake.
  const realRed = fp.redPrs.filter((n) => !fp.redThenGreenSameSha.includes(n));
  if (realRed.length) {
    const redMin = report.firstPushRedMinutes ?? 0;
    c.push({
      kind: 'first-push',
      cost: redMin + realRed.length * cyc,
      lane: 'fix-first-push-red',
      brief: `First-push-green is ${fp.rate}% (${fp.green} of ${fp.green + fp.red} PRs); ${realRed.length} first push(es) went red on the change itself (${fp.redThenGreenSameSha.length} more were flakes), ${round(redMin)} red CI minutes plus a CI cycle each. Make the pre-push affected-guards selection catch the jobs that failed first on PRs ${realRed.slice(0, 8).map((n) => `#${n}`).join(', ')}.`,
    });
  }
  for (const [k, label, p] of [['main', 'main', 'ci.yml on main'], ['opsWatch', 'ops-watch', 'ops-watch on main']]) {
    const m = report.metrics.mttr[k];
    if (m.redHours > 0) {
      c.push({
        kind: `mttr-${label}`,
        cost: m.redHours * 60,
        lane: `fix-${label}-mttr`,
        brief: `${p} was red ${m.redHours} h over ${m.incidents.length} incident(s) (median ${m.median ?? 'n/a'} h to green). Shorten red-to-green: page on the first red and name the owner of each incident's first failing job.`,
      });
    }
  }
  const lane = report.metrics['cost-per-lane'][0];
  if (lane && lane.lostMinutes > 0) {
    c.push({
      kind: 'lane',
      cost: lane.lostMinutes + lane.reruns * cyc,
      lane: `fix-lane-${slug(lane.lane)}`,
      brief: `Lane "${lane.lane}" lost ${lane.lostMinutes} CI minutes on red/cancelled runs (${lane.reruns} rerun(s)) of ${lane.ciMinutes} total${lane.costUsd !== null ? `, at a ledgered $${lane.costUsd}` : ''}. Find what its first pushes miss and fold the fix into its brief template.`,
    });
  }
  const rf = report.metrics['review-findings'];
  const top = Object.entries(rf.byClass).filter(([k]) => !['untagged', 'nit', 'pre-existing'].includes(k)).sort((a, b) => b[1] - a[1])[0];
  if (top) {
    c.push({
      kind: 'review-class',
      cost: top[1] * cyc,
      lane: `fix-review-${slug(top[0])}`,
      brief: `Independent reviews raised ${top[1]} "${top[0]}" finding(s) this window (${rf.total} in all), each a fix push of one CI cycle (${cyc} min). Turn the class into a guard so the next one is caught before review.`,
    });
  }
  return c
    .filter((x) => x.cost > 0)
    .sort((a, b) => b.cost - a.cost)
    .slice(0, 3)
    .map((x, i) => ({ lane: x.lane, brief: `${x.brief} Measured cost: ${round(x.cost)} min.`, priority: i + 1, deps: [], note: `self-review ${day}`, kind: x.kind, costMinutes: round(x.cost) }));
}

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'x';

// ═══════════════════════════════════════════════════════════════════════════
// REPORT
// ═══════════════════════════════════════════════════════════════════════════

/** The workflows this report reads runs of, by the Actions API's run.path. A path with no run in a window whose
 *  run list was read is a workflow that moved: refused, never computed on nothing. */
export const WATCHED_WORKFLOWS = Object.freeze([CI_PATH, OPS_WATCH_PATH]);

export function movedWorkflows(data, w) {
  if (!data.phases.includes('runs')) return [];
  const seen = new Set(data.runs.filter((r) => inWin(r.created_at, w)).map((r) => r.path));
  return WATCHED_WORKFLOWS.filter((p) => !seen.has(p));
}

export function buildReport(data, win, { lanes = [], rulings = [], ledgers = {}, stop = null, stats = {}, repo }) {
  tagRuns(data);
  const w = win.current;
  const moved = movedWorkflows(data, w);
  if (!stop && moved.length) {
    stop = new BudgetStop('workflow-moved', `no run of ${moved.join(', ')} in the window: the workflow moved or was renamed, so its metrics would be computed on nothing.`);
  }
  const fpg = firstPushGreen(data, w);
  const red = new Set(fpg.redPrs.filter((n) => !fpg.redThenGreenSameSha.includes(n)));
  const firstPushRedMinutes = data.runs
    .filter((r) => r._pr !== null && red.has(r._pr) && RED.has(r.conclusion) && inWin(r.created_at, w))
    .reduce((s, r) => s + minutes(r.run_started_at ?? r.created_at, r.updated_at), 0);
  const report = {
    repo,
    window: { since: new Date(w.since).toISOString(), until: new Date(w.until).toISOString() },
    status: stop || data.capped.length > 0 ? 'INCOMPLETE' : 'complete',
    partial: Boolean(stop) || data.capped.length > 0,
    stopReason: stop ? stop.reason : data.capped.length ? 'list-ceiling' : null,
    stopDetail: stop ? stop.message : data.capped.length ? data.capped.join('; ') : null,
    phasesComplete: data.phases,
    trendStop: data.trendStop ? { reason: data.trendStop.reason, detail: data.trendStop.message } : null,
    requests: stats,
    ciCycleMinutes: ciCycleMinutes(data, w),
    firstPushRedMinutes: round(firstPushRedMinutes),
    metrics: {
      'first-push-green': fpg,
      'time-to-merge': timeToMerge(data, w),
      'review-findings': reviewFindings(data, rulings),
      flaky: flaky(data, w),
      mttr: mttr(data, w),
      'cost-per-lane': costPerLane(data, w, lanes),
    },
    ciMinutesPerWorkflow: ciMinutes(data, w),
    trend: win.trend.map((t) => {
      const f = firstPushGreen(data, t);
      const tm = timeToMerge(data, t);
      const fl = flaky({ ...data, attemptJobs: {} }, t);
      const mt = mttr(data, t);
      const cm = Object.values(ciMinutes(data, t));
      return {
        since: new Date(t.since).toISOString(),
        until: new Date(t.until).toISOString(),
        firstPushGreen: f.complete ? f.rate : null,
        mergeMedianHours: tm.openedToMergedHours.median,
        reruns: fl.reruns,
        mainRedHours: mt.main.redHours,
        ciMinutes: round(cm.reduce((s, x) => s + x.minutes, 0)),
        lostMinutes: round(cm.reduce((s, x) => s + x.lostMinutes, 0)),
      };
    }),
    ledgers,
  };
  report.proposals = report.partial ? [] : proposals(report, isoDay(w.until));
  return report;
}

export function renderMarkdown(r) {
  const L = [];
  if (r.partial) L.push(`> **INCOMPLETE — ${r.stopReason}.** ${r.stopDetail} Phases complete: ${r.phasesComplete.join(', ') || 'none'}. Numbers below cover only what was read; no proposals are made from an incomplete week.`, '');
  L.push(`# Factory self-review — ${r.window.since.slice(0, 10)} to ${r.window.until.slice(0, 10)} (UTC)`, '');
  L.push(`Repo \`${r.repo}\` · requests ${r.requests.sent ?? 0}/${r.requests.budget ?? '?'} (${r.requests.notModified ?? 0} served by ETag) · one CI cycle = ${r.ciCycleMinutes} min (median ci.yml PR run). Definitions: docs/ops/self-review.md.`, '');
  const m = r.metrics;
  const f = m['first-push-green'];
  L.push('## first-push-green', '', `${f.rate ?? 'n/a'}% — ${f.green} green, ${f.red} red of ${f.opened} opened; excluded ${f.excluded.length} (${f.excluded.map((x) => `#${x.pr} ${x.verdict}`).join(', ') || 'none'}).`, '');
  const t = m['time-to-merge'];
  L.push('## time-to-merge', '', `${t.merged} merged. Opened→merged median ${t.openedToMergedHours.median ?? 'n/a'} h, p90 ${t.openedToMergedHours.p90 ?? 'n/a'} h. First green→merged median ${t.firstGreenToMergedHours.median ?? 'n/a'} h, p90 ${t.firstGreenToMergedHours.p90 ?? 'n/a'} h (${t.firstGreenToMergedHours.noGreenInWindow} with no green read).`, '');
  const rf = m['review-findings'];
  L.push('## review-findings', '', `${rf.total} finding(s): ${Object.entries(rf.byClass).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}.`, '');
  const fl = m.flaky;
  L.push('## flaky', '', `${fl.reruns} rerun(s); ${fl.instances.length} flaky instance(s).`, '');
  for (const [k, v] of Object.entries(fl.byName).sort((a, b) => b[1].minutesLost - a[1].minutesLost)) L.push(`- ${k}: ${v.count}× , ${v.minutesLost} min lost`);
  L.push('', '## mttr', '');
  for (const [k, v] of Object.entries(m.mttr)) L.push(`- ${k}: ${v.incidents.length} incident(s), ${v.redHours} h red, median ${v.median ?? 'n/a'} h to green${v.incidents.some((i) => i.open) ? ' (one still OPEN)' : ''}`);
  L.push('', '## cost-per-lane', '');
  if (!m['cost-per-lane'].length) L.push('No lane ledger (`--lanes`) given.');
  for (const l of m['cost-per-lane']) L.push(`- ${l.lane}: ${l.runs} run(s), ${l.ciMinutes} CI min (${l.lostMinutes} lost), ${l.reruns} rerun(s)${l.costUsd !== null ? `, $${l.costUsd}` : ''}${l.agentMinutes !== null ? `, ${l.agentMinutes} agent min` : ''}`);
  L.push('', '### CI minutes per workflow (wall clock)', '');
  for (const [k, v] of Object.entries(r.ciMinutesPerWorkflow).sort((a, b) => b[1].minutes - a[1].minutes)) L.push(`- ${k}: ${v.runs} run(s), ${v.minutes} min, ${v.lostMinutes} lost`);
  L.push('', '## Trend (4 weeks, UTC)', '');
  if (r.trendStop) L.push(`The trend's ci-gate reads stopped (${r.trendStop.reason}): ${r.trendStop.detail} First-push-green is n/a for the weeks it did not reach; the window above is whole.`, '');
  L.push('| week from | first-push-green % | merge median h | reruns | main red h | CI min | lost min |', '|---|---|---|---|---|---|---|');
  for (const w of r.trend) L.push(`| ${w.since.slice(0, 10)} | ${w.firstPushGreen ?? 'n/a'} | ${w.mergeMedianHours ?? 'n/a'} | ${w.reruns} | ${w.mainRedHours} | ${w.ciMinutes} | ${w.lostMinutes} |`);
  const g = r.ledgers?.guardYield;
  const c = r.ledgers?.failedRunCauses;
  L.push('', '## Existing ledgers (read, not rewritten)', '', `- guard-yield: ${g ? `asOf ${g.asOf}, ${g.zeroCatch} zero-catch guard(s), ${g.unattributed} unattributed run(s)` : 'unreadable'}`, `- failed-run causes: ${c ? `${c.causes} cause(s) — ${Object.entries(c.byKind).sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k} ${v}`).join(', ')}` : 'unreadable'}`);
  L.push('', '## Top 3 proposals (never applied; proposals.json)', '');
  if (!r.proposals.length) L.push(r.partial ? 'None: an incomplete week does not rank.' : 'None: nothing measured cost a minute.');
  for (const p of r.proposals) L.push(`${p.priority}. **${p.lane}** (${p.costMinutes} min) — ${p.brief}`);
  return `${L.join('\n')}\n`;
}

// ═══════════════════════════════════════════════════════════════════════════
// IO — the one place a file is touched; writes outside the allowed roots are refused
// ═══════════════════════════════════════════════════════════════════════════

export function makeIo(writeRoots, fs = { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync }, p = path) {
  const opened = [];
  return {
    opened,
    read: (f) => fs.readFileSync(f, 'utf8'),
    list: (d) => fs.readdirSync(d).filter((x) => fs.statSync(p.join(d, x)).isFile()),
    write: (f, text) => {
      if (!writeRoots.some((root) => isInside(root, f, p))) throw new Error(`refusing to write ${f}: outside ${writeRoots.join(', ')}`);
      opened.push(f);
      fs.mkdirSync(p.dirname(f), { recursive: true });
      fs.writeFileSync(f, text);
    },
  };
}

export function parseArgs(argv) {
  const a = { repo: DEFAULT_REPO, since: null, until: null, budget: DEFAULT_BUDGET, rateFloor: RATE_FLOOR, lanes: null, reviews: null, out: null, cacheDir: null, fixture: null };
  const num = (v, name) => {
    if (!/^\d+$/.test(String(v))) throw new Error(`${name} must be a whole number`);
    return Number(v);
  };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    const v = () => {
      const y = argv[++i];
      if (y === undefined) throw new Error(`${x} needs a value`);
      return y;
    };
    if (x === '--repo') a.repo = v();
    else if (x === '--since') a.since = v();
    else if (x === '--until') a.until = v();
    else if (x === '--budget') a.budget = num(v(), '--budget');
    else if (x === '--rate-floor') a.rateFloor = num(v(), '--rate-floor');
    else if (x === '--lanes') a.lanes = v();
    else if (x === '--reviews') a.reviews = v();
    else if (x === '--out') a.out = v();
    else if (x === '--cache-dir') a.cacheDir = v();
    else if (x === '--fixture') a.fixture = v();
    else throw new Error(`unknown argument ${x}`);
  }
  if (!a.out) throw new Error('--out DIR is required');
  if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9_.-]{1,100}$/.test(a.repo)) throw new Error('--repo must be owner/name');
  if (a.budget < 1) throw new Error('--budget must be at least 1');
  return a;
}

export async function run(argv, { transport = null, fs, now = Date.now(), log = console.log, root = ROOT } = {}) {
  let a;
  try {
    a = parseArgs(argv);
  } catch (e) {
    log(`self-review: COVERAGE LOST — ${e.message}`);
    return 2;
  }
  const out = path.resolve(a.out);
  const cacheDir = path.resolve(a.cacheDir ?? path.join(out, '.cache'));
  const io = makeIo([out, cacheDir], fs);
  const until = a.until ? Date.parse(a.until) : now;
  const since = a.since ? Date.parse(a.since) : until - WINDOW_DAYS * DAY_MS;
  if (!Number.isFinite(until) || !Number.isFinite(since) || since >= until) {
    log('self-review: COVERAGE LOST — --since/--until are not an ISO window with since < until');
    return 2;
  }
  let lanes = [];
  let rulings = [];
  try {
    if (a.lanes) lanes = validateLanes(JSON.parse(io.read(path.resolve(a.lanes))));
    if (a.reviews) rulings = readRulings(path.resolve(a.reviews), io);
  } catch (e) {
    log(`self-review: COVERAGE LOST — ${e.message}`);
    return 2;
  }
  const tr = transport ?? (a.fixture ? fixtureTransport(JSON.parse(io.read(path.resolve(a.fixture)))) : ghTransport());
  const client = makeClient(tr, { budget: a.budget, rateFloor: a.rateFloor, cacheDir, io });
  const win = windows(since, until);
  const data = emptyData();
  let stop = null;
  try {
    await collect(client, { repo: a.repo, win }, data);
  } catch (e) {
    // Whatever stopped the walk, what was read is still written, under an INCOMPLETE banner.
    stop = e instanceof BudgetStop ? e : new BudgetStop('error', `collection failed: ${e?.name ?? 'Error'} — ${String(e?.message ?? e).replace(/"[^"]*"/g, '"…"').slice(0, 200)}`);
  }
  const report = buildReport(data, win, { lanes, rulings, ledgers: readLedgers(io, root), stop, stats: client.stats(), repo: a.repo });
  io.write(path.join(out, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  io.write(path.join(out, 'report.md'), renderMarkdown(report));
  io.write(path.join(out, 'proposals.json'), `${JSON.stringify(report.proposals, null, 2)}\n`);
  const f = report.metrics['first-push-green'];
  log(`self-review ${report.window.since.slice(0, 10)}..${report.window.until.slice(0, 10)}: ${report.partial ? `INCOMPLETE (${report.stopReason})` : 'complete'}`);
  log(`  first-push-green ${f.rate ?? 'n/a'}% · reruns ${report.metrics.flaky.reruns} · main red ${report.metrics.mttr.main.redHours} h · requests ${client.stats().sent}/${a.budget}`);
  log(`  proposals: ${report.proposals.map((p) => p.lane).join(', ') || 'none'} → ${out}`);
  return report.partial ? 2 : 0;
}

/** True when `argv1` names this module. path.relative, not ===: on win32 `c:\\…` and `C:\\…` are one file, and a
 *  strict compare would make the CLI exit 0 having done nothing. */
export function isEntry(argv1, moduleFile, p = path) {
  return Boolean(argv1) && p.relative(p.resolve(argv1), p.resolve(moduleFile)) === '';
}

if (isEntry(process.argv[1], fileURLToPath(import.meta.url))) {
  run(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (e) => {
      console.log(`self-review: COVERAGE LOST — ${e.message}`);
      process.exitCode = 2;
    },
  );
}
