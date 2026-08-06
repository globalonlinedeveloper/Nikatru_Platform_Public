// ─────────────────────────────────────────────────────────────────────────────
// Consolidated nightly cron (see triggers.crons in wrangler.jsonc). ONE cron for
// the whole portfolio (Free-tier 5-cron cap): a platform-wide Supabase keep-alive
// plus a per-app renewals fan-out. Each job contains its own errors.
// ─────────────────────────────────────────────────────────────────────────────
import type { AppTarget, Env } from './types';
import { recomputeRenewals } from './renewals';

/** The job name recorded in `cron_heartbeat`. */
export const KEEPALIVE_JOB = 'supabase_keepalive';

/** [pipeline 11]E-13 — the job that makes the analytics rail's own silence
 *  visible. Rows land in the same `cron_heartbeat` table, so "is anything
 *  broken" stays one query. */
export const ANALYTICS_LIVENESS_JOB = 'analytics_liveness';

/**
 * [pipeline B-11] The per-app renewals fan-out.
 *
 * 🔴 THIS JOB RAN EVERY NIGHT FROM THE DAY THE CRON SHIPPED AND WROTE NOTHING.
 * It is the reason "every configured target has a heartbeat row" was TRUE while
 * being worth nothing: the only job that wrote rows was the keep-alive, so the
 * assertion ranged over the keep-alive's targets and the renewals fan-out could
 * have been deleted outright without moving a single number.
 *
 * ⚠️ THE NAMING CONVENTION IS LOad-BEARING, not cosmetic. `deriveWatchedJobs`
 * in tooling/ops/check-heartbeats.mjs enumerates the portfolio's job set by
 * reading the `export const <NAME>_JOB = '<literal>'` declarations in THIS FILE
 * and requires the ops register to watch every one of them. A job added under
 * some other spelling is invisible to that derivation — which is exactly the
 * failure the derivation exists to prevent, so it also asserts that every
 * declared constant reaches `recordHeartbeat` at a REAL CALL SITE. See the
 * `_registerInWorkspace` lesson: a symbol that only ever matches its own
 * declaration proves nothing.
 */
export const RENEWALS_JOB = 'renewals';

/**
 * The trailing window the liveness limb counts over, in hours.
 *
 * 🔴 DERIVED, NOT CHOSEN. It is the interval between cron runs —
 * `triggers.crons` in wrangler.jsonc is `0 6 * * *`, once daily — so each run
 * reports on exactly the period since the last one and no period is counted
 * twice or missed. `test/analytics-liveness.test.ts` reads the deployed cron
 * expression and fails if the two stop agreeing.
 *
 * ⚠️ IT IS NOT A THRESHOLD AND THERE IS NO THRESHOLD HERE. Nothing in this file
 * decides that N events is too few. See the gap note in `analyticsLiveness`.
 *
 * @ceiling none — a REPORTING WINDOW, not a resource cap. Its right-hand side is
 *   this Worker's own cron cadence (`triggers.crons`), which no vendor limit
 *   moves with; the one query it bounds is a single GROUP BY, so the D1 ceilings
 *   are untouched whether the window is an hour or a year.
 */
export const ANALYTICS_LIVENESS_WINDOW_HOURS = 24;

/**
 * Apps the scheduler fans out to. Static today (subly only); as more apps ship,
 * add their APP_DB binding here (or drive it from a platform_db registry).
 */
export function appTargets(env: Env): AppTarget[] {
  return [{ appId: 'subly', db: env.SUBLY_DB }];
}

/**
 * Which Supabase projects to keep awake — CONFIG, not code.
 *
 * WHY GENERIC: the portfolio can hold more than one Supabase project (Free caps
 * at 2), and the previous version pinged exactly one hardcoded `SUPABASE_URL`.
 * Adding a project meant editing and redeploying the Worker — the kind of edit
 * nobody remembers, so a second project would idle and pause with nothing in the
 * repo explaining why.
 *
 * Set `SUPABASE_KEEPALIVE_URLS` to a comma-separated list to control it. Absent,
 * it falls back to the single `SUPABASE_URL`, so an existing deploy is unchanged.
 *
 * Deduped and trailing-slash-normalised: `…co` and `…co/` would otherwise be two
 * targets, doubling requests for no benefit.
 */
export function keepAliveTargets(env: Env): string[] {
  const configured = (env.SUPABASE_KEEPALIVE_URLS ?? '').trim();
  const raw =
    configured.length > 0 ? configured.split(',') : [env.SUPABASE_URL ?? ''];
  const cleaned = raw
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter((s) => s.length > 0);
  return [...new Set(cleaned)];
}

/** One heartbeat row per target per run. Best-effort: never breaks the cron. */
async function recordHeartbeat(
  env: Env,
  rows: { target: string; ok: boolean; detail: string }[],
  job: string = KEEPALIVE_JOB,
): Promise<void> {
  if (rows.length === 0) return;
  const ranAt = new Date().toISOString();
  try {
    await env.PLATFORM_DB.batch(
      rows.map((r) =>
        env.PLATFORM_DB.prepare(
          'INSERT INTO cron_heartbeat (job, target, ok, detail, ran_at) VALUES (?,?,?,?,?)',
        ).bind(job, r.target, r.ok ? 1 : 0, r.detail.slice(0, 200), ranAt),
      ),
    );
  } catch (err) {
    // The heartbeat failing must not undo the keep-alive that already happened.
    console.log(`[cron] heartbeat write failed: ${String(err)}`);
  }
}

/**
 * WHY: Supabase pauses a free-tier project after ~7 days idle, breaking sign-in
 * for a low-traffic portfolio. A cheap daily request keeps each project active.
 * The response body is irrelevant — only that a request happened.
 *
 * Errors are still contained (one dead project must not stop the others, or the
 * renewals fan-out that follows) but they are no longer INVISIBLE: every outcome,
 * success or failure, lands in `cron_heartbeat`. Before that, a keep-alive that
 * had been failing nightly for a month was indistinguishable from a working one,
 * and the first signal would have been a pause email for the live auth project.
 */
export async function keepAliveSupabase(env: Env): Promise<void> {
  const targets = keepAliveTargets(env);

  // Zero targets is the dangerous case, not a no-op: it means the config is empty
  // or misspelled and NOTHING is being kept awake. Recorded as a failure so it
  // surfaces in the same query as a dead endpoint.
  if (targets.length === 0) {
    console.log('[cron] supabase keep-alive: NO TARGETS CONFIGURED');
    await recordHeartbeat(env, [
      { target: '(none)', ok: false, detail: 'no targets configured' },
    ]);
    return;
  }

  const rows: { target: string; ok: boolean; detail: string }[] = [];
  for (const target of targets) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      // The anon key is what makes this a REAL request rather than a rejected
      // one. Without it Supabase answers 401 before touching anything, and a
      // rejected request is a poor candidate for "activity". Sent as both
      // `apikey` and `Authorization` because Supabase accepts either depending
      // on the service, and this endpoint should not be the place we find out
      // which. Absent key ⇒ the call still goes out (some activity is better
      // than none) but the row says so loudly.
      const key = env.SUPABASE_ANON_KEY;
      const res = await fetch(`${target}/auth/v1/health`, {
        signal: controller.signal,
        headers: key ? { apikey: key, Authorization: `Bearer ${key}` } : {},
      });
      console.log(`[cron] supabase keep-alive ${target}: ${res.status}`);
      // 🔴 `ok` MEANS 2xx. It used to mean `res.status < 500`, which recorded a
      // 401 as SUCCESS — and 401 is exactly what this call returned every night
      // (verified in production 2026-07-29: three rows, all ok=1, all
      // "HTTP 401"). So the one instrument standing between a low-traffic
      // project and the ~7-day auto-pause reported green while being rejected at
      // the door. `ratel` is already INACTIVE in the same organisation, so the
      // failure mode is demonstrated, not theoretical.
      // An explicit range rather than `res.ok`, deliberately: `.ok` is a real
      // Response property that hand-rolled test doubles routinely omit, and a
      // double missing it makes every success read as a failure. Depending on
      // the narrowest fact — the status number — keeps the rule true for both.
      const ok = res.status >= 200 && res.status < 300;
      const detail = ok
        ? `HTTP ${res.status}`
        : res.status === 401
          ? `HTTP 401 — REJECTED (unauthenticated${key ? ', key present but refused' : ', no SUPABASE_ANON_KEY configured'}). A rejected request is not proven activity.`
          : `HTTP ${res.status}`;
      rows.push({ target, ok, detail });
    } catch (err) {
      console.log(`[cron] supabase keep-alive ${target} FAILED: ${String(err)}`);
      rows.push({ target, ok: false, detail: String(err) });
    } finally {
      clearTimeout(timeout);
    }
  }
  await recordHeartbeat(env, rows);
}

/**
 * [pipeline 11]E-13 — THE RAIL'S OWN SILENCE IS DETECTABLE.
 *
 * 🔴 THE FAILURE THIS EXISTS FOR IS LIVE AND WAS DAYS OLD BEFORE ANYBODY
 * COUNTED. `SELECT COUNT(*) FROM events` = 0 and `consent_artifacts` = 0 in
 * production, measured 2026-07-29 and again 2026-08-01. The ingest route, the
 * dedup, the consent rail and the client queue were all built, tested and
 * green; the one thing nobody had built was the thing that would notice they
 * were producing nothing. An empty table looks exactly like a quiet week.
 *
 * ONE QUERY, GROUPED BY APP, INSIDE THE EXISTING CRON. There are five cron
 * triggers per account on Free and one is already spent, so this is a limb of
 * the nightly run rather than a second schedule.
 *
 * ⚠️ A ROW IS WRITTEN ON EVERY RUN, INCLUDING WHEN THE RESULT SET IS EMPTY —
 * and that is the whole design. A detector that only records when it found
 * something is silent in precisely the situation it exists to report. The
 * portfolio row below is unconditional for that reason.
 *
 * 🔴 `ok` MEANS THE DUTY IS REPORTING HEALTHY — AND ABSENCE IS NOT A GREEN
 * VALUE. Corrected 2026-08-06, and the previous rule is left here because it was
 * reasoned, written down, unit-tested, and wrong:
 *
 *   "`ok` means the work succeeded, never that a row was found. The query ran
 *    ⇒ ok=1, even at zero events; the query threw ⇒ ok=0."
 *
 * It sounds like the lesson `keepAliveSupabase` taught on 2026-07-30, and it is
 * its exact inversion. Under it this row returned `ok = 1` while its own
 * `detail` read "0 events from 0 app(s) in 24h — the rail is SILENT", three
 * consecutive nights running. `ok` is not a private note: it is the column
 * `duty.platform-cron` declares as its `failingValue`, and the ONLY column
 * tooling/ops/check-heartbeats.mjs asserts on. So the one job in this portfolio
 * whose entire purpose is to make silence visible was, by construction, unable
 * to make anything red. The detector reported that the thing it detects was
 * happening, in a green row.
 *
 * The tie-break is this repository's own, and it is already written down in
 * check-heartbeats.mjs's third failure kind: UNKNOWN FAILS CLOSED — "I could not
 * tell" must never read as "it is fine". Zero events is precisely "I could not
 * tell" (see the gap below: a broken rail and a quiet week are indistinguishable
 * here), so it is red. A red that stays red until the rail produces something is
 * the honest state, not a false alarm — and it is a state a person can close by
 * looking, which "green and silent" never was.
 *
 * The three outcomes stay distinguishable, which is what `ok` alone never did:
 *   events in the window ⇒ ok=1, detail counts them
 *   zero events          ⇒ ok=0, detail says "the rail is SILENT"
 *   the query threw      ⇒ ok=0, detail says "liveness query failed"
 *
 * ⚠️ AND THERE IS STILL NO THRESHOLD. Nothing here decides that N events is too
 * few; the only distinction drawn is between some and NONE, which is the one
 * distinction that does not need a number nobody can derive.
 *
 * 🔴 AND THE GAP, STATED IN THE DATA RATHER THAN IN A COMMENT NOBODY READS:
 * THIS CANNOT DISTINGUISH "THE RAIL IS BROKEN" FROM "NOBODY OPENED THE APP".
 * Doing so needs an independent liveness signal and this factory does not have
 * one:
 *   · Cloudflare's request analytics for the app hostname — UNVERIFIED whether
 *     the Free plan exposes it through the GraphQL Analytics API. Not assumed.
 *   · GlitchTip events for the same release — CONTAMINATED. The only issue on
 *     record (SUBLY-2) carries `browser: Electron`, a Claude desktop
 *     User-Agent and India Standard Time: it is the agent's own visits, not an
 *     external user. Built on that, this alarm would report "active, zero
 *     events" forever and be right for the wrong reason.
 *   · Counting the pre-consent `GET /config/:app` launch fetch server-side —
 *     workable, and a NEW COLLECTION POSTURE that needs a recorded owner
 *     decision, not an agent's.
 * So the honest form is this repository's established one for an unautomatable
 * limb: measure what is measurable, write it down every run, and PRINT THE GAP
 * rather than invent a threshold that would make the gap look closed.
 */
export async function analyticsLiveness(env: Env): Promise<void> {
  const since = new Date(
    Date.now() - ANALYTICS_LIVENESS_WINDOW_HOURS * 60 * 60 * 1000,
  ).toISOString();
  const rows: { target: string; ok: boolean; detail: string }[] = [];
  try {
    // ONE query for the whole portfolio. `server_ts` is the edge receipt clock —
    // the client's is untrusted and offline-queued, so grouping on it would put
    // an event in whichever window the device's clock felt like.
    const res = await env.PLATFORM_DB.prepare(
      'SELECT app_id, COUNT(*) AS n FROM events WHERE server_ts >= ? GROUP BY app_id',
    )
      .bind(since)
      .all<{ app_id: string; n: number }>();
    const counts = res.results ?? [];
    let total = 0;
    for (const r of counts) {
      total += Number(r.n) || 0;
      rows.push({
        target: r.app_id,
        ok: true,
        detail: `${r.n} event(s) in ${ANALYTICS_LIVENESS_WINDOW_HOURS}h`,
      });
    }
    // UNCONDITIONAL. This row is the detector's own proof of life, and it is
    // the ONLY row that exists when the answer is zero — which is exactly why
    // its `ok` had to stop being unconditional too. A row that always lands and
    // always says ok is a row that carries no information at all.
    rows.push({
      target: '(portfolio)',
      ok: total > 0,
      detail:
        total === 0
          ? `0 events from 0 app(s) in ${ANALYTICS_LIVENESS_WINDOW_HOURS}h — the rail is SILENT. Cannot yet distinguish a broken rail from no sessions: no independent liveness signal exists (see analyticsLiveness).`
          : `${total} event(s) from ${counts.length} app(s) in ${ANALYTICS_LIVENESS_WINDOW_HOURS}h`,
    });
  } catch (err) {
    // ok=0 means THE WORK FAILED. A query that could not run tells us nothing
    // about the rail, and must never be recorded as "nothing happened".
    rows.push({
      target: '(portfolio)',
      ok: false,
      detail: `liveness query failed: ${String(err)}`,
    });
  }
  await recordHeartbeat(env, rows, ANALYTICS_LIVENESS_JOB);
}

/**
 * [pipeline B-11] The renewals fan-out, with the row it never used to write.
 *
 * ONE ROW PER (job, target), where a target is an APP — matching the keep-alive's
 * one-row-per-Supabase-project shape, so `cron_heartbeat` stays one table with
 * one meaning and `check-heartbeats.mjs` needs no per-job special case.
 *
 * ⚠️ The fan-out is a `for` loop and not `Promise.all` on purpose, unchanged
 * from before: D1 Free bounds queries per invocation, and N apps advancing
 * concurrently against the shared connection is exactly the unbounded batch
 * this stage is trying to stop being surprised by. Sequential is also what makes
 * one app's failure containable — the loop continues, and every app gets a row
 * saying which of them it was.
 */
export async function renewalsFanOut(env: Env): Promise<void> {
  const targets = appTargets(env);
  // Zero targets is a failure, not a no-op — the same rule the keep-alive
  // already applies. An empty fan-out means the app list is broken, and the
  // renewals of every app in the portfolio silently stopped being computed.
  if (targets.length === 0) {
    await recordHeartbeat(
      env,
      [{ target: '(none)', ok: false, detail: 'no app targets configured' }],
      RENEWALS_JOB,
    );
    return;
  }
  const rows: { target: string; ok: boolean; detail: string }[] = [];
  for (const t of targets) {
    // A missing binding must not read as "ran fine, nothing due". `appTargets`
    // hands back whatever `env` holds, and an unbound APP_DB is `undefined`.
    if (!t.db) {
      rows.push({ target: t.appId, ok: false, detail: 'no database binding for this app' });
      continue;
    }
    const outcome = await recomputeRenewals(t.db, t.appId);
    rows.push({ target: t.appId, ok: outcome.ok, detail: outcome.detail });
  }
  await recordHeartbeat(env, rows, RENEWALS_JOB);
}

/** Cron entrypoint. `ctx.waitUntil` keeps the isolate alive for the async work. */
export const scheduled: ExportedHandlerScheduledHandler<Env> = async (_event, env, ctx) => {
  ctx.waitUntil(
    (async () => {
      await keepAliveSupabase(env);
      await analyticsLiveness(env);
      await renewalsFanOut(env);
    })(),
  );
};
