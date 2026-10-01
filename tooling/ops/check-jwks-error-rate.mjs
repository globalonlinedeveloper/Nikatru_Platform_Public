#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// check-jwks-error-rate.mjs — HOW MANY JWKS READS DID A CLIENT GET AS A 5xx?
//
// ⏱ 2026-09-30 · lane fix-auth-jwks-504. Every ES256 verification rests on
// GET https://auth-api.nikatru.com/auth/v1/.well-known/jwks.json, served by
// services/edge-shield from the edge cache in front of Box C. Nothing counted
// how often that read FAILED for a client: the shield probe
// (check-edge-shield.mjs) reads a header off one request, and /v1/health reads
// the JWKS from inside a Worker, which bypasses the shield entirely.
//
// 🔴 ONLY `requestSource: "eyeball"` IS COUNTED, AND THAT IS THE WHOLE LESSON.
// The zone's analytics also log each subrequest the shield makes on a client's
// behalf: its Cache API lookups (`edgeWorkerCacheAPI`) and its origin fetch
// (`edgeWorkerFetch`). Cloudflare logs a Cache API lookup of an expired entry
// with status 504. On 2026-09-30 a query over the whole host read "12.3% of
// auth-api requests are 504s, all on the JWKS path" (879 in 24 h). Every one of
// them was such a lookup, and no client received a single 5xx on that path. A
// rate taken over all request sources counts the shield's own bookkeeping as
// failures. The subrequest counts are printed for context and never judged.
//
// WHAT IS JUDGED: the last [WINDOW_DAYS] WHOLE UTC days, midnight to midnight,
// with today excluded so that no partial day is judged. The source is the zone's
// `httpRequestsAdaptiveGroups`, which is sampled, so the counts are estimates.
// There are two findings per day:
//   · the eyeball 5xx share is over [MAX_5XX_RATE]. A day with fewer than
//     [MIN_SAMPLE] eyeball reads is printed but not judged: one failure in twenty
//     reads is not a rate. The GlitchTip uptime monitor alone reads this path
//     ~1,400 times a day;
//   · the shield served a STALE copy more than [MAX_STALE_STARTS_PER_DAY] times.
//     A stale answer is a 200, so it never shows in the share above, and it can
//     hide a Box C outage for up to an hour (JWKS_MAX_STALE_SECONDS in
//     services/edge-shield/src/index.ts).
// The shield marks each stale answer with `x-edge-shield-stale`, but the zone
// analytics carry no response header. So stale serving is counted from the event
// that STARTS each stale-serve window: the shield's own origin read (User-Agent
// [REVALIDATE_UA]) failing with a 5xx, a 499 (its 5 s deadline) or no status, or
// answering a 200 whose content type is not JSON (an HTML maintenance page, or
// the tunnel landing on the wrong service). The shield refuses to store such a
// body and serves its stale copy instead. After each failure the shield serves
// the copy for a 60 s back-off without asking again, so one failed read stands
// for up to a minute of stale answers at one colo.
// ⚠️ NOT COUNTED: a 200 that IS JSON but is not a usable JWKS (`{"keys":[]}`).
// The analytics carry no body, and a JSON content type is all that tells this
// stale start apart. Monitor 17 (which expects "alg":"ES256") catches it once
// the one-hour bound has passed.
//
// TWO QUERIES, ON PURPOSE. The per-day client counts are grouped by date, source
// and status only: a grouping that included the User-Agent would let anyone
// with ~1,000 distinct User-Agents a week push the answer to the row limit,
// making every run exit 2. The stale starts are read by a second query that
// FILTERS on the shield's own User-Agent, so no client can add rows to it.
//
// EXIT CODES (AGENTS.md): 0 every judged day under both bounds · 1 a day over
// either · 2 COULD NOT LOOK: no token, a zone that does not resolve, a GraphQL
// error (a token without Zone → Analytics → Read is refused here, naming the
// field), an answer at the row limit (it may be truncated), or no day with
// enough reads to judge. 2 IS NOT A PASS. The CI token's scope was first proven by
// ops-watch run 36797307729 (workflow_dispatch, 2026-10-01). The run that proves
// the two-query shape (userAgent filter, content type) at the PR's final head is
// cited in PR #1096's body.
//
// Usage:  node tooling/ops/check-jwks-error-rate.mjs
//   env:  CLOUDFLARE_API_TOKEN (Zone → Zone → Read and Zone → Analytics → Read on nikatru.com)
// Run by .github/workflows/ops-watch.yml's weekly `edge-shield` job, over the
// seven whole days before the run.
// ─────────────────────────────────────────────────────────────────────────────
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CouldNotLook, classifyThrown, transientLook, isTransientStatus, retryAfterMs, readWithBoundedRetry } from './bounded-retry.mjs';
import { CF_API, zoneId } from './edge-ratelimit-rule.mjs';

export const ZONE = 'nikatru.com';
export const HOST = 'auth-api.nikatru.com';
export const JWKS_PATH = '/auth/v1/.well-known/jwks.json';
/** The lane's threshold: over 1% of a day's client reads answered 5xx. */
// @ceiling none — an alert threshold on an error share, not a platform resource
export const MAX_5XX_RATE = 0.01;
/** Below this many eyeball reads a day is shown, not judged. */
export const MIN_SAMPLE = 100;
/** One ops-watch `edge-shield` run a week, so each run reads the week behind it. */
export const WINDOW_DAYS = 7;
/**
 * The most failed shield revalidations a day may have before the stale serving
 * is reported. Each one opens up to a minute of stale answers at one colo. A
 * handful a day is the single-request blips measured on 2026-09-30; more is an
 * outage the stale copy was hiding.
 */
// @ceiling none — an alert threshold on a daily count, not a platform resource
export const MAX_STALE_STARTS_PER_DAY = 5;
/** The User-Agent of the shield's own JWKS read (REVALIDATE_UA in services/edge-shield/src/index.ts). */
export const REVALIDATE_UA = 'nikatru-edge-shield/jwks-revalidate';
/** The GraphQL row limit; an answer this long may be truncated. */
export const ROW_LIMIT = 1000;

/** Per day, source and status, with NO User-Agent: no client can add rows to it. */
export const DAILY_QUERY = `query($zone: String!, $since: Time!, $until: Time!, $host: String!, $path: String!) {
  viewer { zones(filter: { zoneTag: $zone }) {
    httpRequestsAdaptiveGroups(limit: ${ROW_LIMIT}, filter: {
      datetime_geq: $since, datetime_lt: $until, clientRequestHTTPHost: $host, clientRequestPath: $path
    }) { count dimensions { date requestSource edgeResponseStatus } }
  } }
}`;

/** Only the shield's own origin reads, FILTERED on its User-Agent, per day, status and content type. */
export const REVALIDATION_QUERY = `query($zone: String!, $since: Time!, $until: Time!, $host: String!, $path: String!, $ua: String!) {
  viewer { zones(filter: { zoneTag: $zone }) {
    httpRequestsAdaptiveGroups(limit: ${ROW_LIMIT}, filter: {
      datetime_geq: $since, datetime_lt: $until, clientRequestHTTPHost: $host, clientRequestPath: $path,
      requestSource: "edgeWorkerFetch", userAgent: $ua
    }) { count dimensions { date edgeResponseStatus edgeResponseContentTypeName } }
  } }
}`;

/**
 * PURE. Did this shield revalidation fail, and so start a stale-serve window? A
 * 5xx, a 499 (the deadline), no status, or a 200 that is not JSON.
 */
export function isStaleStart(status, contentType) {
  if ((status >= 500 && status <= 599) || status === 499 || status === 0) return true;
  return status === 200 && contentType !== 'json';
}

/**
 * PURE. Per-day tallies: from the daily rows `eyeball`, `eyeball5xx` and every
 * other subrequest 5xx (`sub5xx`, which includes the phantom Cache API 504s, and
 * is context only); from the revalidation rows the shield's failed reads
 * (`staleStarts`). A failed read that is a 5xx is also in the daily rows, so it
 * is taken back out of `sub5xx` rather than shown twice.
 */
export function tally(rows, revalidationRows = []) {
  const days = new Map();
  const day = (r) => {
    const d = r?.dimensions ?? {};
    if (typeof d.date !== 'string' || typeof r.count !== 'number') {
      throw new CouldNotLook(`an analytics row came back without a date or a count: ${JSON.stringify(r).slice(0, 200)}`);
    }
    const t = days.get(d.date) ?? { date: d.date, eyeball: 0, eyeball5xx: 0, staleStarts: 0, sub5xx: 0 };
    days.set(d.date, t);
    return { t, d };
  };
  for (const r of rows) {
    const { t, d } = day(r);
    const is5xx = d.edgeResponseStatus >= 500 && d.edgeResponseStatus <= 599;
    if (d.requestSource === 'eyeball') {
      t.eyeball += r.count;
      if (is5xx) t.eyeball5xx += r.count;
    } else if (is5xx) {
      t.sub5xx += r.count;
    }
  }
  for (const r of revalidationRows) {
    const { t, d } = day(r);
    if (!isStaleStart(d.edgeResponseStatus, d.edgeResponseContentTypeName)) continue;
    t.staleStarts += r.count;
    if (d.edgeResponseStatus >= 500 && d.edgeResponseStatus <= 599) t.sub5xx = Math.max(0, t.sub5xx - r.count);
  }
  return [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** PURE. The verdict over the tallies: `{ code, lines }`. */
export function judge(days, { maxRate = MAX_5XX_RATE, minSample = MIN_SAMPLE, maxStale = MAX_STALE_STARTS_PER_DAY } = {}) {
  const lines = [];
  let judged = 0;
  let over = 0;
  let staleDays = 0;
  for (const t of days) {
    const starts = t.staleStarts ?? 0;
    if (starts > maxStale) {
      staleDays++;
      lines.push(`  ✗ ${t.date}  ${starts} failed shield revalidations, each up to 60 s of STALE JWKS answers: over ${maxStale} a day`);
    } else if (starts > 0) {
      lines.push(`  · ${t.date}  ${starts} failed shield revalidation(s), each up to 60 s of STALE answers (up to ${maxStale} a day is not reported)`);
    }
    const rate = t.eyeball === 0 ? 0 : t.eyeball5xx / t.eyeball;
    const pct = `${(rate * 100).toFixed(2)}%`;
    const ctx = t.sub5xx > 0 ? `   (+${t.sub5xx} 5xx on the shield's own cache/origin subrequests, not client answers)` : '';
    if (t.eyeball < minSample) {
      lines.push(`  · ${t.date}  ${t.eyeball5xx}/${t.eyeball} client reads 5xx — under ${minSample} reads, not judged${ctx}`);
      continue;
    }
    judged++;
    if (rate > maxRate) {
      over++;
      lines.push(`  ✗ ${t.date}  ${t.eyeball5xx}/${t.eyeball} client reads 5xx = ${pct}, over ${(maxRate * 100).toFixed(0)}%${ctx}`);
    } else {
      lines.push(`  ✓ ${t.date}  ${t.eyeball5xx}/${t.eyeball} client reads 5xx = ${pct}${ctx}`);
    }
  }
  if (judged === 0) {
    lines.push(`✗ COULD NOT LOOK — no day in the window had ${minSample} client reads of ${JWKS_PATH}, so there is no rate to judge.`);
    lines.push('    The GlitchTip uptime monitor alone makes ~1,400 a day: an empty window means it, or the host, stopped. That is exit 2, never a pass.');
    return { code: 2, lines };
  }
  if (over > 0 || staleDays > 0) {
    if (over > 0) lines.push(`✗ ${over} of ${judged} day(s) served over ${(maxRate * 100).toFixed(0)}% of client JWKS reads as a 5xx.`);
    if (staleDays > 0) {
      lines.push(`✗ ${staleDays} day(s) served a STALE JWKS after more than ${maxStale} failed origin reads. Box C failed, and the stale copy hid it from the uptime monitor.`);
    }
    lines.push('    Every token verification rests on this read. Check Box C (runbooks/boxes/boxc.md: envoy and cloudflared logs at the failing hour)');
    lines.push("    and the edge-shield Worker's logs for `shield_jwks_stale` (a stale copy served) and exceptions.");
    return { code: 1, lines };
  }
  lines.push(`✓ ${judged} day(s) judged; no day over ${(maxRate * 100).toFixed(0)}% of client JWKS reads as a 5xx, and none over ${maxStale} stale-serve starts.`);
  return { code: 0, lines };
}

/** IMPURE. The GraphQL rows for the window, or CouldNotLook. */
export async function readRows(zone, token, { query = DAILY_QUERY, extra = {}, since, until, doFetch = fetch, sleep, note } = {}) {
  return readWithBoundedRetry(
    async (_attempt, { signal }) => {
      let res;
      try {
        res = await doFetch(`${CF_API}/graphql`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ query, variables: { zone, since, until, host: HOST, path: JWKS_PATH, ...extra } }),
          signal,
        });
      } catch (err) {
        throw classifyThrown(err, `the Cloudflare GraphQL API could not be reached (${err.message})`);
      }
      if (!res.ok) {
        const line = `the Cloudflare GraphQL API answered HTTP ${res.status}`;
        // A read-only query, so a transient status is safe to re-ask.
        throw isTransientStatus(res.status) ? transientLook(line, { retryAfterMs: retryAfterMs(res) }) : new CouldNotLook(line);
      }
      let body;
      try {
        body = await res.json();
      } catch (err) {
        throw classifyThrown(err, `the Cloudflare GraphQL answer was not JSON (${err.message})`);
      }
      if (Array.isArray(body?.errors) && body.errors.length > 0) {
        const msg = body.errors.map((e) => e?.message).join('; ').slice(0, 300);
        throw new CouldNotLook(`the Cloudflare GraphQL API refused the query: ${msg} (the token needs Zone → Analytics → Read on ${ZONE})`);
      }
      const zones = body?.data?.viewer?.zones;
      if (!Array.isArray(zones) || zones.length !== 1 || !Array.isArray(zones[0]?.httpRequestsAdaptiveGroups)) {
        throw new CouldNotLook('the Cloudflare GraphQL answer carried no httpRequestsAdaptiveGroups for the zone');
      }
      const rows = zones[0].httpRequestsAdaptiveGroups;
      if (rows.length >= ROW_LIMIT) {
        throw new CouldNotLook(`the answer carried ${rows.length} rows, the query's limit. It may be truncated, so no day's count can be trusted`);
      }
      return rows;
    },
    { sleep, note },
  );
}

/** The whole run; returns the exit code. `fetchImpl` and `now` are the test seams. */
export async function run({ env = process.env, fetchImpl = globalThis.fetch, sleep, now = new Date() } = {}) {
  console.log(`check-jwks-error-rate — client 5xx share and stale serves of GET ${HOST}${JWKS_PATH}, per UTC day, the last ${WINDOW_DAYS} whole days`);
  const lost = (why) => {
    console.error(`✗ COULD NOT LOOK — ${why}`);
    console.error('    Nothing about the JWKS error rate is known from this run. That is exit 2, never a pass.');
    return 2;
  };
  const token = env.CLOUDFLARE_API_TOKEN ?? '';
  if (token === '') return lost('CLOUDFLARE_API_TOKEN is not in the environment, so the zone analytics were not read.');
  // Whole UTC days only: from midnight WINDOW_DAYS ago to today's midnight.
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const until = new Date(midnight).toISOString();
  const since = new Date(midnight - WINDOW_DAYS * 86_400_000).toISOString();
  const opts = { doFetch: fetchImpl, sleep };
  try {
    const id = await zoneId(ZONE, token, opts);
    const daily = await readRows(id, token, { ...opts, since, until });
    const revalidations = await readRows(id, token, { ...opts, since, until, query: REVALIDATION_QUERY, extra: { ua: REVALIDATE_UA } });
    const days = tally(daily, revalidations);
    const v = judge(days);
    for (const line of v.lines) (v.code === 0 ? console.log : console.error)(line);
    return v.code;
  } catch (err) {
    return lost(err instanceof CouldNotLook ? err.message : `${err.name}: ${err.message}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const unknown = process.argv.slice(2);
  if (unknown.length) {
    console.error(`check-jwks-error-rate: unknown argument(s) ${unknown.join(' ')}. It takes none.`);
    process.exitCode = 2;
  } else {
    // The exit code is SET, never forced: process.exit() with the HTTPS socket
    // still open surfaces on Windows as a libuv assertion (check-turnstile-hosts.mjs).
    process.exitCode = await run();
  }
}
