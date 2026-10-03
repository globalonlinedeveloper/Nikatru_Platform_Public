#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// check-cloudflare-usage.mjs — WHAT THE ACCOUNT SPENDS, AGAINST WHAT IT MAY
// (PB-17, row O-LIVE-DUTY-RED-BLOCKS-THE-FIX-DEPLOY, folding
// O-CLOUDFLARE-USAGE-READ-BY-NOBODY).
//
// ── THE MEASURED HOLE ────────────────────────────────────────────────────────
// tooling/ceilings.json records every ceiling this portfolio runs against, and
// its own `actualsReadFrom` block says what nobody reads: the account's daily
// USAGE. Its `whyNotAutomated` names the shape of the fix — Cloudflare's GraphQL
// Analytics API serves Workers, D1 and KV usage — and the reason it stayed
// human: a read-only Analytics token and a live call, which the PUSH GATE should
// not acquire. ops-watch is not the push gate; it already holds the read token.
//
// ── WHAT IS READ ─────────────────────────────────────────────────────────────
// ONE GraphQL query for the previous whole UTC day:
//   · workersInvocationsAdaptive  — requests per script, summed for the account
//   · d1AnalyticsAdaptiveGroups   — rows read and rows written
//   · kvOperationsAdaptiveGroups  — operations per action type
// Each metric is graded against the ceilings.json row named in METRICS below,
// by its `value`. A metric with no ceiling row, or a row whose `value` is null
// (unverified), is PRINTED with its number and graded against nothing — this
// file never invents a ceiling (ceilings.json's ONE RULE).
//
// ── THE VERDICT ──────────────────────────────────────────────────────────────
// Headroom = 1 - used / ceiling. Under 50% headroom is RED: half the day's
// allowance is gone, which is the point at which a growth week reaches the
// ceiling before anyone reads a digest.
//
// ⏱ 2026-10-01 · CLOUDFLARE_READ_TOKEN IS NOT MINTED YET. ops-watch maps it,
// and only it, into this step. Until the owner mints it the step runs with no
// credential, and `--cloudflare-read-pending-until <YYYY-MM-DD>` is #1095's
// dated deferral, narrow in the same ways: it applies ONLY with no token and no
// fixture; every metric then reads `unreadable` beside its declared ceiling, a
// ::warning:: says so, and the exit is 0; the day after the date it is COVERAGE
// LOST again, naming the secret; once a token is present it defers nothing.
//
// EXIT CODES (AGENTS.md): 0 every graded metric has at least 50% headroom (or
// the read is deferred, above) · 1 a metric is under 50% headroom · 2 COULD NOT
// LOOK — no token past the deferral, a non-200, GraphQL errors, an answer with
// no account, or a ceilings file that names no graded metric. 2 beats 1.
//
// Usage:  node tooling/ops/check-cloudflare-usage.mjs [--root DIR]
//           [--usage-file FILE] [--cloudflare-read-pending-until YYYY-MM-DD]
// Env:    CLOUDFLARE_API_TOKEN (ops-watch maps CLOUDFLARE_READ_TOKEN into it),
//         CLOUDFLARE_ACCOUNT_ID
// `--usage-file` answers the read from a file
// (`{ workers: { <script>: n }, d1: { rowsRead, rowsWritten }, kv: { <action>: n } }`)
// and touches no network: the red control.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CouldNotLook, transientLook, isTransientStatus, readWithBoundedRetry, classifyThrown } from './bounded-retry.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

export const CEILINGS_REL = 'tooling/ceilings.json';
export const GRAPHQL_URL = 'https://api.cloudflare.com/client/v4/graphql';
/** Under this much headroom a metric is RED. */
export const MIN_HEADROOM = 0.5;

/** Each metric read, and the ceilings.json row it is graded against (null:
 *  printed, never graded — there is no row, and one is never invented here). */
export const METRICS = Object.freeze([
  Object.freeze({ id: 'workers.requests', what: 'Workers invocations (all scripts)', ceiling: 'workers.requestsPerDay', pick: (u) => sumValues(u.workers) }),
  Object.freeze({ id: 'd1.rowsRead', what: 'D1 rows read', ceiling: null, pick: (u) => num(u.d1?.rowsRead) }),
  Object.freeze({ id: 'd1.rowsWritten', what: 'D1 rows written', ceiling: 'd1.rowsWrittenPerDay', pick: (u) => num(u.d1?.rowsWritten) }),
  Object.freeze({ id: 'kv.reads', what: 'KV reads', ceiling: 'kv.readsPerDay', pick: (u) => num(u.kv?.read) }),
  Object.freeze({ id: 'kv.writes', what: 'KV writes', ceiling: 'kv.writesPerDay', pick: (u) => num(u.kv?.write) }),
]);

function num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : v === undefined ? 0 : NaN;
}
function sumValues(o) {
  if (o === undefined) return 0;
  if (o === null || typeof o !== 'object') return NaN;
  return Object.values(o).reduce((a, b) => a + num(b), 0);
}

/** The previous whole UTC day, as GraphQL wants it. */
export function previousUtcDay(nowMs = Date.now()) {
  const today = new Date(nowMs);
  today.setUTCHours(0, 0, 0, 0);
  const start = new Date(today.getTime() - 86_400_000);
  return { date: start.toISOString().slice(0, 10), start: start.toISOString(), end: today.toISOString() };
}

export const QUERY = `query Usage($account: String!, $start: Time!, $end: Time!, $date: Date!) {
  viewer {
    accounts(filter: { accountTag: $account }) {
      workersInvocationsAdaptive(limit: 10000, filter: { datetime_geq: $start, datetime_lt: $end }) {
        sum { requests }
        dimensions { scriptName }
      }
      d1AnalyticsAdaptiveGroups(limit: 10000, filter: { date_geq: $date, date_leq: $date }) {
        sum { rowsRead rowsWritten }
      }
      kvOperationsAdaptiveGroups(limit: 10000, filter: { date_geq: $date, date_leq: $date }) {
        sum { requests }
        dimensions { actionType }
      }
    }
  }
}`;

/** PURE. A GraphQL answer folded into the usage shape `--usage-file` takes.
 *  Throws CouldNotLook on errors or an answer with no account. */
export function usageFromGraphql(body) {
  if (Array.isArray(body?.errors) && body.errors.length > 0) {
    throw new CouldNotLook(`the Analytics API answered with errors: ${body.errors.map((e) => e?.message ?? JSON.stringify(e)).join('; ').slice(0, 300)}`);
  }
  const acct = body?.data?.viewer?.accounts;
  if (!Array.isArray(acct) || acct.length !== 1) {
    throw new CouldNotLook(`the Analytics API answered ${Array.isArray(acct) ? acct.length : 'no'} account(s), not one — nothing was graded`);
  }
  const a = acct[0];
  const out = { workers: {}, d1: { rowsRead: 0, rowsWritten: 0 }, kv: {} };
  for (const g of a.workersInvocationsAdaptive ?? []) {
    const s = g?.dimensions?.scriptName ?? '(unnamed)';
    out.workers[s] = (out.workers[s] ?? 0) + num(g?.sum?.requests);
  }
  for (const g of a.d1AnalyticsAdaptiveGroups ?? []) {
    out.d1.rowsRead += num(g?.sum?.rowsRead);
    out.d1.rowsWritten += num(g?.sum?.rowsWritten);
  }
  for (const g of a.kvOperationsAdaptiveGroups ?? []) {
    const k = g?.dimensions?.actionType ?? '(unknown)';
    out.kv[k] = (out.kv[k] ?? 0) + num(g?.sum?.requests);
  }
  return out;
}

/** The ceilings rows by id, from the tree. */
export function readCeilings(root) {
  const p = join(root, CEILINGS_REL);
  if (!existsSync(p)) throw new CouldNotLook(`${CEILINGS_REL} is not in the tree`);
  const rows = JSON.parse(readFileSync(p, 'utf8'))?.ceilings;
  if (!Array.isArray(rows)) throw new CouldNotLook(`${CEILINGS_REL} has no \`ceilings\` list`);
  return new Map(rows.map((r) => [r.id, r]));
}

/** PURE. One metric's verdict: `{ code, line }`. `used` null = deferred. */
export function judgeMetric(m, used, ceilingRow) {
  const cap = ceilingRow?.value;
  const capText = m.ceiling === null ? 'no ceiling row' : typeof cap === 'number' ? `${cap} (${m.ceiling})` : `${m.ceiling} = null (unverified)`;
  if (used === null) return { code: 0, line: `…   ${m.what}: unreadable — ceiling ${capText}` };
  if (!Number.isFinite(used)) return { code: 2, line: `?   ${m.what}: the answer carried no number for it` };
  if (m.ceiling === null || typeof cap !== 'number' || cap <= 0) {
    return { code: 0, line: `⬜  ${m.what}: ${used} — not graded (${capText}; ${CEILINGS_REL} is the only place a ceiling is declared)` };
  }
  const headroom = 1 - used / cap;
  const pct = `${Math.round(headroom * 1000) / 10}%`;
  if (headroom < MIN_HEADROOM) {
    return { code: 1, line: `✗   ${m.what}: ${used} of ${capText} — headroom ${pct}, under ${MIN_HEADROOM * 100}%` };
  }
  return { code: 0, line: `ok  ${m.what}: ${used} of ${capText} — headroom ${pct}` };
}

/** Grade a usage object (or `null` = deferred) against the tree's ceilings. */
export function grade(usage, ceilings) {
  const results = [];
  let graded = 0;
  for (const m of METRICS) {
    const row = m.ceiling === null ? null : ceilings.get(m.ceiling) ?? null;
    if (m.ceiling !== null && row === null) {
      results.push({ code: 2, line: `?   ${m.what}: ${CEILINGS_REL} has no row \`${m.ceiling}\`, so this metric's ceiling is unknown` });
      continue;
    }
    if (m.ceiling !== null && typeof row.value === 'number') graded += 1;
    results.push(judgeMetric(m, usage === null ? null : m.pick(usage), row));
  }
  if (graded === 0) results.push({ code: 2, line: `?   ${CEILINGS_REL} declares no numeric ceiling for any metric read here, so nothing would be graded` });
  let code = 0;
  for (const r of results) {
    if (r.code === 2) code = 2;
    else if (r.code === 1 && code === 0) code = 1;
  }
  return { code, lines: results.map((r) => r.line) };
}

/** The live read, over an injected fetch. */
export async function readUsage({ fetchImpl = globalThis.fetch, env = process.env, nowMs = Date.now() } = {}) {
  const token = env.CLOUDFLARE_API_TOKEN;
  const account = env.CLOUDFLARE_ACCOUNT_ID;
  if (!token || !account) throw new CouldNotLook(`no ${!token ? 'CLOUDFLARE_API_TOKEN' : 'CLOUDFLARE_ACCOUNT_ID'}`);
  const day = previousUtcDay(nowMs);
  const body = await readWithBoundedRetry(
    async (_a, { signal }) => {
      let res;
      try {
        res = await fetchImpl(GRAPHQL_URL, {
          method: 'POST',
          signal,
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'User-Agent': 'nikatru-check-cloudflare-usage' },
          body: JSON.stringify({ query: QUERY, variables: { account, ...day } }),
        });
      } catch (e) {
        throw classifyThrown(e, `the Analytics API did not answer (${e?.message ?? e})`);
      }
      if (isTransientStatus(res.status)) throw transientLook(`the Analytics API returned ${res.status}`);
      if (res.status !== 200) throw new CouldNotLook(`the Analytics API returned ${res.status}`);
      try {
        return await res.json();
      } catch {
        throw new CouldNotLook('the Analytics API answer is not JSON');
      }
    },
    { note: (m) => console.log(`    ⟳   Analytics API — ${m}`) },
  );
  return { day, usage: usageFromGraphql(body) };
}

/** Decide the deferral. Returns `{ deferred, lost, note }`. */
export function pendingDecision(pendingFlag, { tokenPresent, fixture, nowMs = Date.now() }) {
  if (pendingFlag === undefined) return { deferred: false, lost: null, note: null };
  const endOfDay = Date.parse(`${pendingFlag}T23:59:59Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(pendingFlag)) || Number.isNaN(endOfDay)) {
    return { deferred: false, lost: `--cloudflare-read-pending-until is "${pendingFlag}", not a YYYY-MM-DD date, so the deferral it declares cannot be bounded.`, note: null };
  }
  if (fixture || tokenPresent) {
    return {
      deferred: false,
      lost: null,
      note: `note  --cloudflare-read-pending-until ${pendingFlag} is set and ${fixture ? 'a usage file is in use' : 'a Cloudflare token IS present'}, so it defers nothing. Once CLOUDFLARE_READ_TOKEN is minted, delete the flag from ops-watch.yml.`,
    };
  }
  if (nowMs > endOfDay) {
    return {
      deferred: false,
      lost:
        `the usage read's deferral expired on ${pendingFlag} and there is still no Cloudflare token here. ops-watch.yml maps ` +
        'CLOUDFLARE_READ_TOKEN (a read-only token with Account Analytics: Read) into this step, and it is not set: the owner mints it, ' +
        'or the deferral is re-dated in a reviewed change that says why.',
      note: null,
    };
  }
  return { deferred: true, lost: null, note: null };
}

async function main() {
  const argv = process.argv.slice(2);
  const opt = (name) => {
    const i = argv.indexOf(name);
    return i === -1 ? undefined : argv[i + 1];
  };
  const root = resolve(opt('--root') ?? join(HERE, '..', '..'));
  const usageFile = opt('--usage-file');
  const pending = opt('--cloudflare-read-pending-until');
  let ceilings;
  try {
    ceilings = readCeilings(root);
  } catch (e) {
    console.log(`?   COVERAGE LOST — ${e.message}`);
    process.exitCode = 2;
    return;
  }
  const tokenPresent = typeof process.env.CLOUDFLARE_API_TOKEN === 'string' && process.env.CLOUDFLARE_API_TOKEN.trim() !== '';
  const decision = pendingDecision(pending, { tokenPresent, fixture: usageFile !== undefined });
  if (decision.note) console.log(decision.note);
  if (decision.lost) {
    console.log(`?   COVERAGE LOST — ${decision.lost}`);
    process.exitCode = 2;
    return;
  }
  let usage = null;
  let window = null;
  if (decision.deferred) {
    console.log(
      `::warning title=Cloudflare usage NOT READ (deferred until ${pending})::CLOUDFLARE_READ_TOKEN is not set, so no metric was read. ` +
        'Each prints its declared ceiling beside the word unreadable; nothing here says the account is inside them.',
    );
  } else if (usageFile !== undefined) {
    try {
      usage = JSON.parse(readFileSync(resolve(usageFile), 'utf8'));
      window = 'the usage file';
    } catch (e) {
      console.log(`?   COVERAGE LOST — the usage file ${usageFile} did not read: ${e.message}`);
      process.exitCode = 2;
      return;
    }
  } else {
    try {
      const r = await readUsage();
      usage = r.usage;
      window = `${r.day.date} (UTC)`;
    } catch (e) {
      console.log(`?   COVERAGE LOST — ${e?.message ?? e}. Nothing about the account's usage was read, and that is never a pass.`);
      process.exitCode = 2;
      return;
    }
  }
  const { code, lines } = grade(usage, ceilings);
  console.log(`Cloudflare usage — ${decision.deferred ? `NOT READ, deferred until ${pending}` : window}:`);
  for (const l of lines) console.log(`  ${l}`);
  if (usage && usage.workers && typeof usage.workers === 'object') {
    for (const [s, n] of Object.entries(usage.workers).sort((a, b) => num(b[1]) - num(a[1]))) console.log(`      · ${s}: ${n} invocations`);
  }
  console.log(
    code === 0
      ? decision.deferred
        ? `…   usage DEFERRED until ${pending}: unreadable inside the declared ceilings, never a claim that it is inside them.`
        : `ok  every graded metric keeps at least ${MIN_HEADROOM * 100}% headroom.`
      : code === 1
        ? `✗   a metric is under ${MIN_HEADROOM * 100}% headroom (above).`
        : '?   COVERAGE LOST (above).',
  );
  process.exitCode = code;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.log(`?   check-cloudflare-usage threw: ${e?.stack ?? e}`);
    process.exitCode = 2;
  });
}
