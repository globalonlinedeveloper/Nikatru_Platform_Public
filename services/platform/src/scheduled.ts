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
 *
 * ✅ AND THE FOURTH SIGNAL, WHICH THE THREE ABOVE NEVER CONSIDERED: THIS SAME
 * DATABASE'S `consent_artifacts`. A consent artifact is written by `POST
 * /v1/consent` — a DIFFERENT ROUTE, a DIFFERENT CLIENT TRANSPORT (an immediate
 * single write, not the offline batch queue) and a DIFFERENT TABLE — so no
 * break anywhere in the events path can silence it, which is precisely the
 * independence the three rejected candidates were being judged on. It needs no
 * vendor API, no new collection posture and no credential this cron does not
 * already hold, because it is a second table in the D1 binding already bound
 * here. It is NOT contaminated the way GlitchTip's Electron visits are: a
 * consent row exists only because a human answered a consent prompt in a
 * shipped build.
 *
 * ⚠️ IT NARROWS THE GAP, IT DOES NOT CLOSE IT, and the counts are written down
 * rather than graded here. `consents>0 && events=0` is REACH PROVEN WITH ZERO
 * ARRIVALS — a person used the app and the events rail produced nothing.
 * `consents=0 && events=0` is still exactly as ambiguous as it always was, so
 * the paragraph above stands unstruck. Which of the two happened is a JUDGEMENT,
 * and [ADR 035] puts judgement in a separate reader
 * (tooling/ops/check-analytics-liveness.mjs) rather than in a second boolean
 * here: `ok` keeps answering the one question every writer's `ok` answers.
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

    // ── THE INDEPENDENT SIGNAL, same cron, same window, same DB ──────────────
    // Same shape as the query above (one GROUP BY, no row bodies) and bounded by
    // the same `since`, so the two numbers describe the SAME period and are
    // comparable without anybody aligning windows by hand.
    //
    // `granted = 1` only: a withdrawal is appended as a NEW row with granted=0
    // (the table is append-only by design), and counting a withdrawal as reach
    // would let a user turning analytics OFF look like evidence that events
    // should be arriving.
    //
    // ⚠️ NO PER-APP ROW IS WRITTEN FOR THIS. The portfolio row carries the
    // aggregate and the reader judges the aggregate; adding per-app consent rows
    // would change this job's row cardinality, and check-heartbeats.mjs picks
    // "the newest row" for a job by `ran_at` across ALL targets — every row in
    // one run shares a `ran_at`, so a new target class would change which row
    // that reduction lands on for reasons unrelated to health.
    const consentRes = await env.PLATFORM_DB.prepare(
      'SELECT app_id, COUNT(*) AS n FROM consent_artifacts WHERE server_ts >= ? AND granted = 1 GROUP BY app_id',
    )
      .bind(since)
      .all<{ app_id: string; n: number }>();
    const consentCounts = consentRes.results ?? [];
    let consentTotal = 0;
    for (const r of consentCounts) consentTotal += Number(r.n) || 0;

    // UNCONDITIONAL. This row is the detector's own proof of life, and it is the
    // ONLY row that exists when the answer is zero.
    //
    // 🔴 `ok` IS `true` HERE EVEN AT ZERO EVENTS, AND THAT IS [ADR 035], NOT A
    // REGRESSION. It was `total > 0` for one day (2026-08-06 → 08-07) and the
    // first real cron run after that shipped proved the cost: `analytics_liveness`
    // wrote ok=0, `tooling/ops/check-heartbeats.mjs` went exit 1, and it would
    // have done so EVERY DAY — for the owner-gated reason that no app has shipped.
    // A daily red nobody can act on is how an alarm gets muted.
    //
    // `ok` answers exactly one question, the same one for every writer: DID THE
    // WORK SUCCEED. A query that ran and correctly found nothing has succeeded.
    // Whether that silence is a FAULT is a different question, owned by [11]E-13
    // (a baseline the events rail cannot silence) — and judged by a different
    // reader. The `catch` below keeps ok=0 for its real meaning: the query could
    // not run.
    //
    // ⚠️ The zero-events fact is NOT lost, and it is deliberately not left as
    // prose: `events=` and `apps=` lead the detail so a reader can parse the
    // count without interpreting a sentence. [ADR 035] requires that — matching
    // on the English would be asserting by grepping prose, which this repo has a
    // rule against and a scar from. `consented_apps=` and `consents=` join them
    // for the same reason and in the same leading run: THE JUDGEMENT LIVES IN
    // tooling/ops/check-analytics-liveness.mjs AND IT READS THESE TOKENS, so a
    // reworded sentence must never be able to change a verdict.
    //
    // ⚠️ recordHeartbeat slices `detail` to 200 chars. Every branch below is
    // under that with the window at its declared 24 — asserted in
    // test/analytics-liveness.test.ts, because a truncated tail would silently
    // eat the last token if the token order were ever rearranged.
    rows.push({
      target: '(portfolio)',
      ok: true,
      detail:
        total === 0
          ? consentTotal > 0
            ? // 🔴 REACH PROVEN, ZERO ARRIVALS. Somebody answered a consent
              // prompt in a shipped build inside this same window and the events
              // rail still produced nothing. This is the state the three
              // rejected baselines were being sought for, and the one the
              // reader turns red on.
              `events=0 apps=0 consented_apps=${consentCounts.length} consents=${consentTotal} window=${ANALYTICS_LIVENESS_WINDOW_HOURS}h — the rail is SILENT while consent artifacts landed in the same window — reach is PROVEN, so the events path is what produced nothing.`
            : // Unchanged, and deliberately so: with no consent either, a broken
              // rail and a quiet week are still indistinguishable here.
              `events=0 apps=0 consented_apps=0 consents=0 window=${ANALYTICS_LIVENESS_WINDOW_HOURS}h — the rail is SILENT. Cannot yet distinguish a broken rail from no sessions: no independent liveness signal exists (see analyticsLiveness).`
          : `events=${total} apps=${counts.length} consented_apps=${consentCounts.length} consents=${consentTotal} window=${ANALYTICS_LIVENESS_WINDOW_HOURS}h`,
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

// ─────────────────────────────────────────────────────────────────────────────
// [pipeline 5]M-9 · THE CANCELLATION DRAIN CENSUS — A DEPTH, NOT A DRAIN.
//
// 🔴 THE DEFECT, RE-MEASURED ON THIS TREE 2026-08-21. `cancellation_requests`
// had exactly ONE writer and NO reader outside the test suite. `executed_at`
// occurred in FIVE code sites in the whole repository and NONE was a reader:
// the INSERT in src/routes/cancellation.ts that binds it as the literal NULL
// (grep `requested_at, executed_at, not_executed_reason` — :151 the day this
// paragraph was written, :168 since that file's header grew on 2026-08-22, which
// is why the anchor and not the number is the durable pointer), three lines of
// migrations/0005_cancellation_requests.sql (:20, :25,
// :59), and one assertion at test/cancellation.test.ts:156. There is no UPDATE
// of the table anywhere in the tree, no cron limb touched it, and none of the
// 16 files in tooling/ops/ listed a pending row. So every recorded request sat
// at `executed_at IS NULL` for as long as it existed and NOTHING COUNTED THEM.
//
// LATENT, NOT LIVE, and that distinction is why this is a census and not an
// alarm: the route answers 404 without an active entitlement and no
// subscription has been sold, so the depth is zero today. What was live is the
// depth being UNKNOWN — "nobody has drained this" was a silence, and a silence
// gives the owner half no number to start from on the day the credential lands.
//
// ⚠️ IT DRAINS NOTHING. Executing against the merchant of record needs a seller
// credential that does not exist (OWNER_QUEUE A-1) and is deliberately not
// designed around here.
//
// ⚠️ AND `ok` STAYS 1 WHILE THE BACKLOG GROWS — [ADR 035] applied, not an
// oversight. Nothing in this Worker can drain a row, so `ok = undrained === 0`
// would go red on the first real cancellation and stay red every night until an
// owner-gated credential landed: the muted-alarm shape `analytics_liveness`
// already paid for once (its `ok` was `total > 0` for one day, 2026-08-06 →
// 08-07). `ok` keeps answering the one question every writer's `ok` answers —
// DID THE WORK SUCCEED, i.e. did the query run.
//
// ⚠️ WHAT THIS DOES NOT CATCH, said plainly because a census that reads as a
// monitor is worse than no census:
//   · NOTHING TURNS RED ON A GROWING BACKLOG, and nothing prints the number on
//     a healthy night either. tooling/ops/check-heartbeats.mjs prints a job's
//     `detail` only when that job is RED (main() logs `verdict.reason`, and the
//     green reason names the occurrence, not the detail). So today the depth is
//     read by querying `cron_heartbeat` — there is no judging reader for this
//     job the way tooling/ops/check-analytics-liveness.mjs judges the liveness
//     one, and writing one is the next increment, not this one.
//   · NO PER-REASON SPLIT. `not_executed_reason` stays on the row for whoever
//     drains it; putting that enum in this SQL would copy `NotExecutedReason`
//     (src/routes/cancellation.ts) into a second place nothing keeps in step.
//   · IT SAYS NOTHING ABOUT WHETHER A REQUEST SHOULD HAVE BEEN EXECUTED. Every
//     row is undrained today for a reason the row itself records.
//   · AND PART OF THE `detail` CONTRACT IS PINNED BY NO TEST. A 13-mutant sweep
//     of this function against test/cancellation-drain.test.ts, 2026-08-21:
//     FOUR go red — both `CASE WHEN ... IS NULL` limbs of the query below, the
//     `Number.isFinite` branch, and `ok = false` in the catch. NINE survive.
//     Deleting the ` oldest=${oldest}` token, and forcing either the
//     `recorded === 0` or the `undrained === 0` prose limb, are all invisible:
//     the test's helper parses every token, but its assertions read only
//     `undrained`, `recorded` and `oldest_age_h`. Five more are normalisations
//     no input in that file reaches (`?? 0`, `|| 0`, `== null`, the
//     `oldest === null` guard, `Math.max(0, …)`) — kept, because a count that is
//     correct by coincidence breaks the first time the shape moves, but nothing
//     measures them. The ninth is the call site itself:
//   · THE CALL SITE IS HELD BY NOTHING. No file in test/ imports the `scheduled`
//     handler — every import from this module is of a named function or
//     constant — so removing `await cancellationDrainCensus(env)` from the
//     handler leaves test/cancellation-drain.test.ts at 6/6 green, and
//     `deriveWatchedJobs` still passes because it only needs the drain job
//     constant — 🔴 SPELT OUT HERE ON 2026-08-21 AND DE-SPELT ON 2026-08-22,
//     because spelling it in a comment is itself what switched that check off;
//     the constant's own doc below carries the measurement — to appear beside a
//     `recordHeartbeat` call, which it does whether or not anything calls this
//     function. NOT NEW, and not caused here: all five pre-existing cron limbs
//     are wired exactly this way.
//
// ⚠️ THE TWO BULLETS ABOVE ARE THE 2026-08-21 MEASUREMENT AND ARE LEFT AS
// WRITTEN — they were true that day and a dated record that is renumbered stops
// being one. RE-MEASURED 2026-08-22, after SEVEN cases were added to
// test/cancellation-drain.test.ts, they are no longer the state of the tree:
//   · THE SWEEP IS NOW 20 MUTANTS, NOT 13 — the FOURTEEN mutation points in
//     this function (every condition it contains, its two SQL `CASE` limbs, the
//     catch's `ok = false`, and the ` oldest=` token), `recordHeartbeat`'s one
//     row-count guard, the handler call site, and the four conditions the test
//     file's own helper and stubs contain, each set to its `if (false)`
//     equivalent ONE AT A TIME against a baseline of
//     `vitest run test/cancellation-drain.test.ts` EXIT 0, 13 passed. 17 go red
//     in vitest, 2 go red in `tsc --noEmit` (EXIT 2) and in no test, and ONE
//     survives.
//   · THE SURVIVOR IS NOT IN THIS FUNCTION: `if (rows.length === 0) return;` in
//     `recordHeartbeat` above, which predates this change and which no limb here
//     can reach — this census always passes exactly one row. Reported rather
//     than deleted because it is not in a block this change touches.
//   · THE NINE THE BULLET ABOVE NAMES ARE CLOSED. ` oldest=` is read by "carries
//     the oldest UNDRAINED row verbatim"; `Math.max(0, …)` by "never reports a
//     NEGATIVE age"; both `|| 0` fallbacks by the two "non-numeric" cases; the
//     `row?.` chains and the `== null` guard by "survives first() returning
//     null"; and BOTH zero-branches by "an empty table and a fully drained one
//     are NOT the same sentence" — which grades the ENGLISH, because those two
//     branches emit byte-identical tokens and no token assertion can ever tell
//     them apart. The call site is read by "writes a cancellation_drain beat
//     when the SCHEDULED HANDLER runs", the only test in the tree that runs the
//     real handler; it also asserts the whole six-job set the register watches.
//   · TWO WERE DELETED RATHER THAN PINNED: the `?? 0` that sat inside the
//     `recorded` normalisation below, and an `i === -1` fallback in the test
//     file's `prose` helper. Measured before deleting, on a green baseline:
//     forcing either to `false` left the file at EXIT 0, 13 passed. No input
//     distinguished either from its own absence, and the rule is pin or delete,
//     never "obviously correct".
//   · TWO ARE HELD BY THE TYPECHECKER AND BY NO TEST, SAID PLAINLY RATHER THAN
//     COUNTED AS COVERAGE: `row?.oldest ?? null` and the `oldest === null`
//     guard. Disabling either leaves the suite 13/13 green and exits
//     `tsc --noEmit` 2, because `.first()` is typed `T | null` and `Date.parse`
//     does not take one. They cannot be deleted — their absence does not
//     compile — so "no test reddens" is a fact about them, not a hole.
// ─────────────────────────────────────────────────────────────────────────────

/** The job name recorded in `cron_heartbeat` for the drain census.
 *
 *  ⚠️ Same load-bearing `<NAME>_JOB` spelling as the other five constants in
 *  this file (grep `^export const [A-Z_]*_JOB`) — see the keep-alive one's doc
 *  at the top for why. `duty.platform-cron.watchedJobs` in
 *  tooling/ops/register.json names this literal, and the constant reaches
 *  `recordHeartbeat` at a real call site below; `deriveWatchedJobs` fails both
 *  directions without those two.
 *
 *  🔴 AND THE SYMBOL IS DELIBERATELY NOT SPELT ANYWHERE IN A COMMENT, HERE OR IN
 *  routes/cancellation.ts. `deriveWatchedJobs` builds its "declared and NEVER
 *  USED" limb by stripping the declaration out of the concatenated source and
 *  regex-matching `\b<NAME>\b` over what is left — and `readSourceTree` in
 *  tooling/ops/check-heartbeats.mjs concatenates RAW bytes, with no
 *  `stripSourceComments`. So a comment that names the constant IS a usage to
 *  that guard, and prose written to explain the check is what turns it off.
 *  Measured 2026-08-22, driving the real `deriveWatchedJobs` over a copy of this
 *  tree: with the names spelt out, replacing EVERY non-comment use of any ONE of
 *  the six constants with a literal — 1, 1, 2, 1, 2 and 2 uses respectively, in
 *  declaration order — left PROBLEMS=0 in all six cases. Six live limbs reading
 *  as green. With the names de-spelt as they are now, the same six mutations
 *  give PROBLEMS=1 each. Both directions this doc claims are real, same run:
 *  removing "cancellation_drain" from `watchedJobs` gives JOBS=5 PROBLEMS=1
 *  ("COVERAGE LOST"), and pointing the call site below at the bare literal gives
 *  JOBS=6 PROBLEMS=1 ("declared … and NEVER USED"). Re-run both before writing
 *  any of these constant names into a comment anywhere under src/. */
export const CANCELLATION_DRAIN_JOB = 'cancellation_drain';

/**
 * ONE query, three aggregates, no row bodies — the same shape and the same
 * reason as the liveness limb's GROUP BY: D1 Free bounds queries per
 * invocation, and a census must never be the limb that costs the sweep its
 * budget.
 *
 * 🔴 `recorded` IS COUNTED ALONGSIDE `undrained` ON PURPOSE. `undrained=0`
 * alone is ambiguous in exactly the way an empty `events` table was: it reads
 * identically for "every request was executed" and "nobody ever asked". Today
 * the second is true, and the token pair is what will say so when it stops
 * being.
 *
 * 🔴 `oldest` IS THE OLDEST UNDRAINED ROW, NOT THE OLDEST ROW. `MIN(requested_at)`
 * over the whole table would be pinned by the first request ever made and would
 * keep reporting a huge age after every request had been executed — an age that
 * only ever grows is not a queue depth, it is a clock.
 *
 * A row is written UNCONDITIONALLY, including at zero. A detector that records
 * only when it found something is silent in precisely the case it exists for.
 */
export async function cancellationDrainCensus(env: Env): Promise<void> {
  let detail: string;
  let ok = true;
  try {
    const row = await env.PLATFORM_DB.prepare(
      `SELECT COUNT(*) AS recorded,
              SUM(CASE WHEN executed_at IS NULL THEN 1 ELSE 0 END) AS undrained,
              MIN(CASE WHEN executed_at IS NULL THEN requested_at END) AS oldest
         FROM cancellation_requests`,
    ).first<{ recorded: number | null; undrained: number | null; oldest: string | null }>();
    // ⚠️ `?? 0` USED TO SIT INSIDE THIS `Number(…)` AND IS DELETED, 2026-08-22.
    // No input could distinguish it: `Number(undefined)` is NaN and the `|| 0`
    // already catches NaN, so the nullish arm and its absence produced the same
    // byte on every path. It read as a guard and was not one. `|| 0` IS held —
    // test/cancellation-drain.test.ts, "survives a non-numeric `recorded`".
    const recorded = Number(row?.recorded) || 0;
    // ⚠️ `SUM` over zero rows is NULL in SQLite, not 0. `Number(null)` happens
    // to be 0, but a count that is correct by coincidence is a count that goes
    // wrong the first time the shape changes, so it is normalised explicitly.
    // The `row?.` chain is not decoration either: `.first()` is typed `T | null`
    // and "survives first() returning null" goes red without it.
    const undrained = row?.undrained == null ? 0 : Number(row.undrained) || 0;
    const oldest = row?.oldest ?? null;
    const oldestMs = oldest === null ? Number.NaN : Date.parse(oldest);
    // `unknown`, never a silent 0. `requested_at` is written by `nowIso()` and
    // is therefore parseable on every row this rail wrote — but the column is a
    // bare TEXT with no CHECK, so an unparseable value is reachable, and an
    // unparseable timestamp reported as `oldest_age_h=0` would read as "the
    // queue is brand new" at exactly the moment nobody can tell how old it is.
    const age = Number.isFinite(oldestMs)
      ? Math.max(0, (Date.now() - oldestMs) / 3_600_000).toFixed(1)
      : 'unknown';
    detail =
      recorded === 0
        ? 'undrained=0 recorded=0 oldest=none oldest_age_h=0 — nothing has ever been recorded, so the queue depth is zero rather than unknown.'
        : undrained === 0
          ? `undrained=0 recorded=${recorded} oldest=none oldest_age_h=0 — every recorded request carries executed_at.`
          : `undrained=${undrained} recorded=${recorded} oldest=${oldest} oldest_age_h=${age} — UNDRAINED: nothing here executes a cancellation; this falls only when a human acts. [5]M-9`;
  } catch (err) {
    // ok=0 means THE WORK FAILED. A query that could not run tells us nothing
    // about the queue, and must never be recorded as "nothing is waiting".
    ok = false;
    detail = `undrained=unknown recorded=unknown oldest=none oldest_age_h=unknown — the drain census query FAILED: ${String(err)}`;
  }
  await recordHeartbeat(env, [{ target: '(portfolio)', ok, detail }], CANCELLATION_DRAIN_JOB);
}

// ─────────────────────────────────────────────────────────────────────────────
// [pipeline 14]O-17 · THE RETENTION SWEEP — BUILT DORMANT, ARMED BY ONE VALUE.
//
// 🔴 THE STATE THIS REPLACES. tooling/ops/register.json carries two rows at
// `rule: "period-undeclared"` — retention.d1.platform_db.events and
// retention.d1.platform_db.provider_notifications — and assert-ops-register.mjs
// requires a `deletingJob` THE MOMENT either becomes `rule: "period"`. No such
// job existed anywhere in the portfolio, so the owner's decision cost a decision
// PLUS an increment, and the increment was the half nobody had time for. That is
// exactly where the signup KV stood until 2026-08-09, and it is closed the same
// way: build the engineering half first and leave the policy half as ONE VALUE.
// (retention.kv.nikatru-signups.signup's own `response` field is the record of
// that day; this section is its D1 twin.)
//
// ⚠️ WHY THE PERIOD IS NOT PICKED HERE. The published privacy policy says data
// is kept "as long as necessary", which is not a number a guard can check, and an
// agent choosing 180 or 365 would be WRITING POLICY under the appearance of
// fixing a bug — while silently destroying the only analytics history the
// portfolio has. So the number stays owner-gated and the gap PRINTS: on every CI
// run (assert-retention-coverage.mjs, assert-ops-register.mjs) and on every cron
// run, in this job's own heartbeat detail.
//
// 🔴 INERT MEANS NO STATEMENT, NOT A STATEMENT THAT MATCHES NOTHING. With no
// declared period this limb prepares nothing and binds nothing — there is no
// DELETE anywhere near the shared database until a number exists. A "harmless"
// DELETE with an impossible cutoff would still be a deployed DELETE, one typo
// away from being a real one.
// ─────────────────────────────────────────────────────────────────────────────

/** The job name recorded in `cron_heartbeat` for the retention sweep.
 *
 *  ⚠️ THE `<NAME>_JOB` SPELLING IS LOAD-BEARING — the same convention the
 *  renewals constant documents above. `deriveWatchedJobs` in
 *  tooling/ops/check-heartbeats.mjs reads these declarations out of THIS source
 *  and fails BOTH directions: unless `duty.platform-cron.watchedJobs` names the
 *  literal, and unless the constant reaches `recordHeartbeat` at a REAL call
 *  site (a symbol matching only its own declaration proves nothing). Both are
 *  satisfied below and in tooling/ops/register.json. */
export const RETENTION_SWEEP_JOB = 'retention_sweep';

/** The platform_db stores whose retention is a PERIOD rather than a reasoned
 *  `keep`. Each name is also the store suffix of its register row id. */
export type RetentionStore = 'events' | 'events_daily' | 'provider_notifications';

/** Days-to-keep per store. `null` is UNDECLARED, and undeclared is INERT. */
export type RetentionPeriods = Record<RetentionStore, number | null>;

// 🔒 DECLARED — 400 DAYS. [ADR 045], owner-delegated 2026-08-12 ("whichever is
// best approach, do deep research and lock"). Register row:
// retention.d1.platform_db.events.
//
// 400 sits inside a corridor with a floor and a ceiling, and both ends matter:
//   · FLOOR 365 — DPDP Rules 2025 (Rule 8(3), Rule 6(1)(e)) require a minimum of
//     one year. ⚠️ NOT IN FORCE YET: notified 14 Nov 2025 with an 18-month
//     phase-in, so ~14 May 2027. THIS IS THE TRAP — a 90- or 180-day period
//     feels privacy-forward today and becomes non-compliant then, with the rows
//     it should have kept already deleted and UNRECOVERABLE. Choosing short now
//     creates a future failure that cannot be repaired retroactively.
//   · CEILING 425 — 14 months, the hard maximum Google Analytics 4 allows a
//     standard property. If the most-deployed analytics product treats that as
//     the outer edge of "necessary", 400 is not unusual.
//   · PRODUCT FLOOR 60 — a D30 figure needs a cohort's first_launch row and its
//     day-30 return_visit row alive at the same instant (31 absolute), doubled
//     so a D30 number exists on ANY given day rather than one frozen cohort.
// 400 clears the statutory floor by ~5 weeks without sitting on the ceiling.
//
// ✅ THE ROLLUP NOW EXISTS (0007_events_rollup.sql, `eventsRollup` below), so
// this delete is NO LONGER irreversible for the metrics — and the cutoff for
// this store is bounded by the rollup's watermark, not by age alone. See
// `rollupBoundedCutoff`.
//
// 📌 THIS COMMENT PREVIOUSLY SAID "THERE IS NO ROLLUP TABLE" AND CITED
// 11-measurement.md:1540-1543 for the claim that all five funnel numbers "are
// counts and ratios by day/app/event" and so "survive aggregation losslessly".
// The first half is now false because the table exists. THE SECOND HALF WAS
// ALWAYS FALSE: zero of the five are computable at (day, app, event) grain —
// every one is an install-level DISTINCT count and three are per-install joins
// across different event types. They do survive aggregation, but only at a grain
// that keeps `anon_id`. A rollup built to the grain that sentence describes
// would have destroyed four of five numbers while reporting success.
// @ceiling none — a RETENTION PERIOD is a policy number, not a platform resource; nothing in tooling/ceilings.json bounds how long rows may be kept.
export const EVENTS_RETENTION_DAYS = 400;

// 🔒 DECLARED — 1100 DAYS (~3 years). Register row:
// retention.d1.platform_db.events_daily.
//
// The corridor, in [ADR 045]'s own idiom:
//   · FLOOR 400 — below EVENTS_RETENTION_DAYS the rollup would destroy history
//     the RAW table still holds, which is absurd by construction.
//   · FLOOR 1095 — three calendar years, the minimum for TWO year-over-year
//     comparisons (Y3 vs Y2 vs Y1). This is the first thing 400 days cannot buy
//     and it is the whole reason the rollup exists.
//   · CEILING — none statutory. GA4's 425-day cap governs raw, event-level,
//     device-and-geo-bearing data; this table has none of that. DPDP purpose
//     limitation (s.6(1)) still binds, and "portfolio seasonality across three
//     years" is a stated, bounded purpose.
// 1100 = 1095 + 5 days' margin — the same shape as 400 = 365 + 35.
//
// ⚠️ THIS IS A POLICY NUMBER, NOT A MEASUREMENT, and it is the one value in this
// increment an owner may want to move. It is locked rather than deferred because
// tooling/ops/register.json caps undeclared periods at `_maxUndeclared: 0`, so
// shipping it undeclared is not an option. Moving it is a one-line change here
// plus `periodDays` in the register.
// @ceiling none — a RETENTION PERIOD is a policy number, not a platform resource; nothing in tooling/ceilings.json bounds how long rows may be kept.
export const EVENTS_DAILY_RETENTION_DAYS = 1100;

// 🔒 DECLARED — 730 DAYS (2 years). [ADR 045]. This table holds the buyer's
// name, email and billing country VERBATIM (0004_money_rail.sql §B). Register
// row: retention.d1.platform_db.provider_notifications.
//
// ⚠️ THE OBVIOUS JUSTIFICATION IS FALSE AND IS NOT USED HERE. "We need it to
// fight chargebacks" does not survive Paddle's own documentation: Paddle is
// MERCHANT OF RECORD, the dispute is raised against Paddle, its help centre
// says seller evidence is "not required or accepted", and it retains the
// transaction for 5 years. A number defended on a false reason is worse than no
// number, because the next reader inherits the reason.
// The real reasons for keeping a copy at all:
//   · Paddle will NOT replay notifications older than 90 days — from day 91
//     ours is the SOLE surviving copy of the raw payload;
//   · Visa's outer dispute window is 540 calendar days from the transaction
//     processing date (Visa Core Rules 18 Apr 2026, Table 11-92, ID# 0030316
//     fn.4). 730 clears it with margin. Mastercard's outer cap is unread (403),
//     so nothing rules out longer.
// And the reason NOT to go further: DPDP s.8(7) wants the raw payload gone once
// its purpose is served, and the statutory books-of-account duty is carried by
// the DERIVED record, deliberately — see the derivation guard below.
//
// 📌 CORRECTION TO THIS FILE'S OWN EARLIER COMMENT: this table DOES carry a
// `user_id` column (0006_erasure_reach.sql:63) and the account-deletion route
// reaches it dynamically (routes/account.ts:122,352). Age is therefore not the
// only exit. The residual gap is narrower: `user_id` stays NULL until
// derivation resolves an account, so an underived row is unreachable by erasure
// — which is the other half of why the guard below refuses to sweep one.
// @ceiling none — a RETENTION PERIOD is a policy number, not a platform resource; nothing in tooling/ceilings.json bounds how long rows may be kept.
export const PROVIDER_NOTIFICATIONS_RETENTION_DAYS = 730;

// The per-store, per-run delete bound. A sweep is a CATCH-UP job, not a one
// shot: hitting the bound leaves the remainder for tomorrow and says `capped=1`
// rather than pretending the store is clean. Worst case per night is 2 × 1000
// base rows plus their index rows (events carries 4 indexes,
// provider_notifications 2) ≈ 8,000 of the 100,000 daily row-write budget — and
// that is the CATCH-UP peak, not the steady state.
// @ceiling d1.rowsWrittenPerDay lte
export const MAX_ROWS_PER_SWEEP = 1000;

// @ceiling none — a unit conversion (milliseconds in a day), not a cap on any platform resource.
const MS_PER_DAY = 86400000;

/**
 * The cutoff instant for a store, or `null` when no period is declared.
 *
 * 🔴 `0`, NEGATIVES AND NON-NUMBERS FALL TO `null` DELIBERATELY, and this is the
 * most important line in the section. A cutoff computed from `0` is NOW, and a
 * sweep whose cutoff is now deletes the WHOLE TABLE. Same rule and same reason
 * as `signupPutOptions` in sites/nikatru/functions/api/subscribe.js: a
 * fat-fingered zero must mean NO RETENTION, never "delete everything".
 *
 * ISO-8601 UTC because both columns store exactly that (`events.server_ts`,
 * `provider_notifications.received_at`), and lexicographic order on a
 * fixed-width Z-suffixed timestamp IS chronological order — so `<` in SQL needs
 * no date function whose D1 support this repo has not measured.
 */
export function retentionCutoff(days: number | null, nowMs: number = Date.now()): string | null {
  return typeof days === 'number' && Number.isFinite(days) && days > 0
    ? new Date(nowMs - days * MS_PER_DAY).toISOString()
    : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// THE EVENTS ROLLUP — [11]E-11, [ADR 045]
// ─────────────────────────────────────────────────────────────────────────────

/** Heartbeat job name. Same `<NAME>_JOB` convention and same two-directional
 *  check by `deriveWatchedJobs` as the retention-sweep constant above — it must
 *  also appear in `duty.platform-cron.watchedJobs` in tooling/ops/register.json.
 *
 *  ⚠️ The neighbouring constant is named in words, not spelt: see the drain
 *  census constant's doc for the measurement that says why. */
export const EVENTS_ROLLUP_JOB = 'events_rollup';

/** The rollup's identity in `rollup_state`. One string, one place. */
export const EVENTS_DAILY_ROLLUP = 'events_daily';

// Days consumed per run. A rollup is a CATCH-UP job like the sweep: falling
// behind is SAFE (the watermark simply stops advancing and the sweep stops
// deleting with it), so this can be lowered freely if catch-up ever competes
// with ingest for the row-write budget.
//
// Worst case query budget per run: 1 (read watermark) + 1 (gap skip) + 14 × 2
// (rollup + watermark advance, in one batch each) + 1 (heartbeat) = 31, against
// d1.queriesPerInvocation = 50. This takes the WORST reading of an unresolved
// question — Cloudflare does not document whether a batch() of N spends 1 query
// or N — and 31 ≤ 50 holds either way.
// @ceiling d1.queriesPerInvocation lte
export const MAX_DAYS_PER_ROLLUP_RUN = 14;

/** 'YYYY-MM-DD' for an epoch-ms instant, UTC. */
function dayOf(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Calendar-day arithmetic on a 'YYYY-MM-DD' string, UTC, no DST to worry about. */
function addDays(day: string, n: number): string {
  return dayOf(Date.parse(`${day}T00:00:00.000Z`) + n * MS_PER_DAY);
}

/** The last COMPLETE day fully consumed, or `null` if nothing has been. */
export async function rolledThrough(env: Env): Promise<string | null> {
  const row = await env.PLATFORM_DB.prepare('SELECT rolled_through FROM rollup_state WHERE rollup = ?')
    .bind(EVENTS_DAILY_ROLLUP)
    .first<{ rolled_through: string | null }>();
  // A MISSING row and a NULL value mean the same thing — nothing consumed — so
  // the caller never has to distinguish them. 0007 seeds the row for this reason.
  return row?.rolled_through ?? null;
}

/**
 * 🔴 THE FAIL-CLOSED INTERLOCK. The `events` sweep's cutoff, bounded by what the
 * rollup has actually consumed.
 *
 * `min(age_cutoff, rolled_through + 1 day)`, and **NULL when the rollup has
 * consumed nothing at all** — which makes the sweep INERT rather than letting it
 * delete on age alone.
 *
 * Every `events` row with `server_ts < rolled_through+1d` is provably in
 * `events_daily`, because `eventsRollup` consumes days WHOLE AND ATOMICALLY: the
 * aggregate and the watermark advance travel in one `D1.batch()`, which is one
 * transaction, so a day is consumed and marked or neither.
 *
 * ⚠️ THIS FUNCTION IS THE GUARANTEE. Ordering `eventsRollup` before
 * `retentionSweep` is an optimisation, not a safety property — both limbs
 * swallow their own exceptions so they can write ok=0 heartbeats, so a failed
 * rollup does not stop a sweep that runs a second later. Delete this call and
 * the sweep silently reverts to deleting on age, destroying unrolled-up history.
 * `test/events-rollup.test.ts` drives exactly that mutation.
 *
 * If the rollup fails, the sweep deletes NOTHING NEW: failure degrades to
 * "events grows", which is recoverable, never to "history destroyed", which is
 * not.
 */
export function rollupBoundedCutoff(ageCutoff: string | null, watermark: string | null): string | null {
  if (watermark === null) return null;
  const consumedThrough = `${addDays(watermark, 1)}T00:00:00.000Z`;
  if (ageCutoff === null) return null;
  return ageCutoff < consumedThrough ? ageCutoff : consumedThrough;
}

/**
 * The nightly rollup. Consumes whole UTC days from `events` into `events_daily`
 * and advances the watermark.
 *
 * 🔴 THE AGGREGATION NEVER SHIPS A ROW TO THE WORKER. `INSERT … SELECT … GROUP
 * BY` executes entirely inside D1; the isolate holds one watermark string, one
 * day string per iteration and `meta.changes`. Peak allocation is O(1) in the
 * number of events, so the 128 MB isolate limit is not a constraint on this
 * design rather than something it has to manage. Reading rows out and grouping
 * in TypeScript would have made it one.
 *
 * ⚠️ TODAY IS NEVER CONSUMED. It is still accumulating, and rolling up a partial
 * day would write an `n_rows` a later run has to correct — which the watermark's
 * meaning ("fully consumed") would then be lying about.
 *
 * GAP SKIP. After a dormant period the first unconsumed day carrying data is
 * found with ONE query rather than by walking empty days. Days strictly between
 * the watermark and that result are provably empty, so advancing past them
 * consumes nothing and loses nothing — catch-up is O(days-with-data), not
 * O(calendar-days). Without it a 90-day dormancy costs seven nights of empty
 * iterations.
 */
export async function eventsRollup(env: Env, nowMs: number = Date.now()): Promise<void> {
  const lastCompleteDay = addDays(dayOf(nowMs), -1); // yesterday, UTC
  let days = 0;
  let rows = 0;
  let watermark: string | null = null;
  let lag = 0;

  try {
    watermark = await rolledThrough(env);
    const from = watermark === null ? '' : `${addDays(watermark, 1)}T00:00:00.000Z`;

    // 🔴 THE DAYS TO CONSUME, ENUMERATED IN ONE QUERY — not discovered by
    // walking the calendar. This is what makes catch-up O(days-with-data)
    // instead of O(calendar-days), and the difference is not academic: the first
    // version of this loop advanced one day per D1 batch, so a fixture with 5
    // days of data inside a 14-day window spent 14 batches to write 5 days'
    // rows and reported `days=14 rows=5`. After a dormant month it would have
    // burned an entire run's query budget on days containing nothing.
    //
    // LIMIT is MAX+1 so the result distinguishes "this is all of them" from
    // "there are more" — which decides how far the watermark may advance below.
    const dayRows = await env.PLATFORM_DB.prepare(
      'SELECT DISTINCT substr(server_ts, 1, 10) AS d FROM events WHERE server_ts >= ?1 AND server_ts < ?2 ORDER BY d LIMIT ?3',
    )
      .bind(from, `${addDays(lastCompleteDay, 1)}T00:00:00.000Z`, MAX_DAYS_PER_ROLLUP_RUN + 1)
      .all<{ d: string }>();
    const withData = (dayRows.results ?? []).map((r) => r.d).filter((d) => typeof d === 'string');
    const more = withData.length > MAX_DAYS_PER_ROLLUP_RUN;
    const todo = more ? withData.slice(0, MAX_DAYS_PER_ROLLUP_RUN) : withData;

    for (const day of todo) {
      const res = await env.PLATFORM_DB.batch([
        // 🔴 `DO UPDATE SET n_rows = excluded.n_rows` IS ASSIGNMENT, NEVER
        // `n_rows + excluded.n_rows`. Accumulating would double every count on a
        // re-run; assignment makes re-running a RECOMPUTATION, which is what
        // makes a partially-failed night safe to repeat.
        //
        // 🔴 `CAST(… AS TEXT)` IS LOAD-BEARING. `json_extract` returns an INTEGER
        // for `{"name": 42}`, and an INTEGER and its TEXT form are DISTINCT keys
        // in the unique index — the same duplicate-row failure as a NULL
        // sentinel, reached by a different route.
        //
        // The `''` sentinel (never NULL) is why ON CONFLICT fires at all for the
        // ~90% of rows that are not `feature_used`. See 0007's header.
        env.PLATFORM_DB.prepare(
          "INSERT INTO events_daily (day, app_id, anon_id, event, feature, n_rows) SELECT substr(server_ts, 1, 10), app_id, anon_id, event, CASE WHEN event = 'feature_used' AND json_valid(params) AND json_extract(params, '$.name') IS NOT NULL THEN CAST(json_extract(params, '$.name') AS TEXT) ELSE '' END, COUNT(*) FROM events WHERE server_ts >= ?1 AND server_ts < ?2 GROUP BY 1, 2, 3, 4, 5 ON CONFLICT (day, app_id, anon_id, event, feature) DO UPDATE SET n_rows = excluded.n_rows",
        ).bind(`${day}T00:00:00.000Z`, `${addDays(day, 1)}T00:00:00.000Z`),
        // IN THE SAME BATCH — one D1 transaction — so a day is consumed and
        // marked, or neither. That atomicity is exactly what lets
        // `rollupBoundedCutoff` treat the watermark as "fully consumed".
        env.PLATFORM_DB.prepare(
          'INSERT INTO rollup_state (rollup, rolled_through, updated_at) VALUES (?, ?, ?) ON CONFLICT (rollup) DO UPDATE SET rolled_through = excluded.rolled_through, updated_at = excluded.updated_at',
        ).bind(EVENTS_DAILY_ROLLUP, day, new Date(nowMs).toISOString()),
      ]);
      rows += Number(res[0]?.meta?.changes ?? 0);
      watermark = day;
      days++;
    }

    // 🔴 IF EVERY REMAINING DAY-WITH-DATA WAS CONSUMED, THE WATERMARK ADVANCES TO
    // `lastCompleteDay`, NOT TO THE LAST ROW'S DAY. The days in between are
    // PROVABLY EMPTY — the query above enumerated every day carrying a row in
    // that range — so marking them consumed loses nothing and is the honest
    // statement: "everything up to yesterday is in the rollup".
    //
    // It also matters for the SWEEP, which is the whole point of the watermark:
    // leaving it at the last row's day would pin the sweep's cutoff there
    // forever on a portfolio that goes quiet, so a gap in ingest would silently
    // become a permanent ceiling on retention. A quiet week is not a reason to
    // stop deleting.
    //
    // ⚠️ ONLY when `more` is false. If the run was capped there are unconsumed
    // days with data beyond it, and jumping the watermark past them would be
    // exactly the unrolled-up deletion this whole mechanism exists to prevent.
    if (!more && withData.length > 0 && lastCompleteDay > (watermark ?? '')) {
      await env.PLATFORM_DB.prepare(
        'INSERT INTO rollup_state (rollup, rolled_through, updated_at) VALUES (?, ?, ?) ON CONFLICT (rollup) DO UPDATE SET rolled_through = excluded.rolled_through, updated_at = excluded.updated_at',
      )
        .bind(EVENTS_DAILY_ROLLUP, lastCompleteDay, new Date(nowMs).toISOString())
        .run();
      watermark = lastCompleteDay;
    }

    // How far behind the rollup still is after this run. Reported, not escalated
    // — see the note on MAX_ROWS_PER_SWEEP; nothing yet fails a guard on N
    // consecutive lagging nights, and that belongs with the sweep's `capped`.
    lag =
      watermark === null
        ? 0
        : Math.max(0, Math.round((Date.parse(`${lastCompleteDay}T00:00:00.000Z`) - Date.parse(`${watermark}T00:00:00.000Z`)) / MS_PER_DAY));
  } catch (err) {
    await recordHeartbeat(
      env,
      [
        {
          target: '(portfolio)',
          ok: false,
          detail: `days=${days} rows=${rows} watermark=${watermark ?? 'null'} — events rollup FAILED: ${String(err)}`,
        },
      ],
      EVENTS_ROLLUP_JOB,
    );
    return;
  }

  await recordHeartbeat(
    env,
    [
      {
        target: '(portfolio)',
        ok: true,
        detail:
          watermark === null
            ? 'days=0 rows=0 watermark=null lag=0 — NOTHING TO ROLL UP: `events` holds no row older than today. The sweep is INERT while this is true, by design.'
            : `days=${days} rows=${rows} watermark=${watermark} lag=${lag}${days >= MAX_DAYS_PER_ROLLUP_RUN ? ' capped=1' : ''}`,
      },
    ],
    EVENTS_ROLLUP_JOB,
  );
}

/**
 * One bounded, filtered DELETE against one store. Returns rows removed.
 *
 * ⚠️ TWO LITERAL STATEMENTS, NOT ONE WITH `${table}` INTERPOLATED. D1 cannot
 * bind an identifier, so a shared statement would have to build the table name
 * by hand — which tooling/ci/assert-d1-sql-inventory.mjs [R3] then has to be
 * satisfied about, and which is the class both erasure routes already pay for.
 * Two fixed strings need no identifier discipline because there is no identifier
 * to discipline.
 *
 * ⚠️ AND THE SQL IS INLINE AT THE `.prepare(` CALL rather than hoisted to a
 * constant: [R2 iii] of that same guard reports any `.prepare(` whose argument
 * is not a single string literal as a statement NEITHER half of the D1 inventory
 * can read — a `.prepare` moved behind a name does not make the SQL safer, it
 * makes the scan smaller while every count still looks healthy.
 *
 * BOUNDED BY A SUBQUERY, not by `DELETE … LIMIT`: that form needs SQLite built
 * with SQLITE_ENABLE_UPDATE_DELETE_LIMIT and is not a property of D1 this
 * repository has measured. `rowid IN (SELECT rowid … ORDER BY … LIMIT ?)` is
 * plain SQL, and both tables are ROWID tables — 0002 and 0004 declare no PRIMARY
 * KEY and no WITHOUT ROWID, deliberately (0002's header records why).
 */
async function deleteOlderThan(env: Env, store: RetentionStore, cutoff: string): Promise<number> {
  const stmt =
    store === 'events'
      ? env.PLATFORM_DB.prepare(
          'DELETE FROM events WHERE rowid IN (SELECT rowid FROM events WHERE server_ts < ? ORDER BY server_ts LIMIT ?)',
        )
      : store === 'events_daily'
        ? env.PLATFORM_DB.prepare(
            // Deletes on AGE ALONE, and that asymmetry with `events` is
            // deliberate: nothing downstream consumes this table, so there is no
            // watermark for its cutoff to be bounded by. `events` needs one
            // because `events_daily` is derived FROM it; `events_daily` is the
            // end of the chain.
            //
            // `day` is 'YYYY-MM-DD' and the cutoff is a full ISO instant, so the
            // comparison is on `substr(cutoff,1,10)` — done by the CALLER, which
            // keeps this statement a plain string literal with no expression
            // around the bound parameter (assert-d1-sql-inventory [R2 iii]).
            'DELETE FROM events_daily WHERE rowid IN (SELECT rowid FROM events_daily WHERE day < ? ORDER BY day LIMIT ?)',
          )
        : env.PLATFORM_DB.prepare(
          // 🔴 `derived_at IS NOT NULL AND derive_error IS NULL` IS A LEGAL
          // CONDITION, NOT AN OPTIMISATION — [ADR 045] §4. The retention FLOOR on
          // this table is NONE *only because* a derived record independently
          // satisfies the books-of-account duty (CGST Rule 56(1), Income-tax
          // Rule 46(1)). If derivation never resolved, no derived record exists,
          // the raw payload IS the book of account BY FUNCTION, and it inherits
          // CGST s.36 — 72 months from the annual-return due date, roughly 2,698
          // days, suspended indefinitely by any appeal or reopened assessment.
          // Deleting such a row at 730 days destroys the only record of a
          // payment, and it cannot be recovered: Paddle will not replay a
          // notification older than 90 days.
          //
          // So the sweep's legality is a property of THIS PREDICATE, not of the
          // period above. An underived row is never swept; it is left to be
          // found. `retention-sweep.test.ts` drives the case with a row whose
          // `derived_at` is NULL and asserts it survives.
          //
          // ⚠️ It is also the erasure argument: `user_id` stays NULL until
          // derivation resolves an account (0006_erasure_reach.sql:35-38), so an
          // underived row is the one row the account-deletion route cannot reach
          // either. Sweeping it on age alone would be the ONLY thing that ever
          // touched it — which is precisely why age alone must not.
          //
          // 📌 The single row in production today has a non-null `derive_error`
          // ("unclaimed: no account is linked to paddle subscription sub_…"), so
          // the first real subject of this rule already exists and is refused.
          'DELETE FROM provider_notifications WHERE rowid IN (SELECT rowid FROM provider_notifications WHERE received_at < ? AND derived_at IS NOT NULL AND derive_error IS NULL ORDER BY received_at LIMIT ?)',
        );
  const res = await stmt.bind(cutoff, MAX_ROWS_PER_SWEEP).run();
  return Number(res.meta?.changes ?? 0);
}

/**
 * The nightly sweep. INERT until a period is declared.
 *
 * ⚠️ ONE HEARTBEAT ROW PER RUN, target `(portfolio)`, and that is not a
 * simplification. `evaluateJob` in tooling/ops/check-heartbeats.mjs reduces a
 * job's rows to "the newest by `ran_at`", and every row written in one run
 * shares a `ran_at` — so with one row per STORE, a failing store and a healthy
 * store would be tied and the reader could land on the healthy one. The same
 * reasoning `analyticsLiveness` records for its unconditional portfolio row.
 * The per-store detail travels in `detail`, which leads with parseable tokens
 * for the same reason [ADR 035] requires it there: a reworded sentence must
 * never be able to change a verdict.
 *
 * 🔴 `ok` ANSWERS ONE QUESTION — DID THE WORK SUCCEED — which is [ADR 035] and
 * not a softening. An inert run succeeded at doing nothing, so `ok = 1`: a
 * daily red on a number only the owner can supply is how an alarm gets muted
 * (CLAUDE.md C-6). `ok = 0` is reserved for a DELETE that threw, which cannot
 * happen while no period is declared because no statement is sent.
 *
 * `periods` and `nowMs` are parameters with the shipped values as DEFAULTS, so
 * both branches are testable without rewriting this module — and so the test
 * suite does not go red the day the owner changes one of the constants, which
 * would turn a one-line change into a two-line one.
 */
export async function retentionSweep(
  env: Env,
  periods: RetentionPeriods = {
    events: EVENTS_RETENTION_DAYS,
    events_daily: EVENTS_DAILY_RETENTION_DAYS,
    provider_notifications: PROVIDER_NOTIFICATIONS_RETENTION_DAYS,
  },
  nowMs: number = Date.now(),
): Promise<void> {
  const stores: RetentionStore[] = ['events', 'events_daily', 'provider_notifications'];
  const n_stores = stores.length;
  let declared = 0;
  let deleted = 0;
  let capped = 0;
  const per: string[] = [];
  const inert: string[] = [];

  try {
    // 🔴 READ THE WATERMARK ONCE, BEFORE THE LOOP. This is what bounds the
    // `events` cutoff below. If it is null the rollup has consumed nothing and
    // the `events` limb is INERT — see `rollupBoundedCutoff`.
    const watermark = await rolledThrough(env);

    for (const store of stores) {
      const ageCutoff = retentionCutoff(periods[store], nowMs);
      // 🔴 THE FAIL-CLOSED LINK. `events` never deletes on age alone; its cutoff
      // is min(age, rolled_through + 1d), null when nothing is rolled up.
      // Replacing this with bare `ageCutoff` reverts the sweep to destroying
      // history the rollup has not consumed — the mutation
      // test/events-rollup.test.ts drives (and which was run against the REAL
      // tree: with the bound removed, all 30 seeded rows are deleted).
      // ⬜ THIS COMMENT USED TO ALSO CITE `tooling/ci/assert-rollup-lossless.mjs
      // [R3]`, WHICH DOES NOT EXIST — it is PR-2 work. Removed rather than left,
      // because a citation to a guard that was never written is how a reader
      // concludes an invariant is protected when only a test holds it.
      const bounded = store === 'events' ? rollupBoundedCutoff(ageCutoff, watermark) : ageCutoff;
      // THE INERT PATH. Nothing is prepared, nothing is bound, nothing is sent.
      if (bounded === null) {
        inert.push(store === 'events' && ageCutoff !== null ? 'events(unrolled)' : store);
        continue;
      }
      declared++;
      // `events_daily.day` is 'YYYY-MM-DD'; every other store compares a full
      // ISO instant. Narrowing here keeps the DELETE a plain string literal.
      const n = await deleteOlderThan(env, store, store === 'events_daily' ? bounded.slice(0, 10) : bounded);
      deleted += n;
      if (n >= MAX_ROWS_PER_SWEEP) capped++;
      per.push(`${store}=${String(periods[store])}d:${n}`);
    }
  } catch (err) {
    // ok=0 means THE WORK FAILED. A sweep that could not run is a retention
    // promise not being kept, and must never be recorded as "nothing to do".
    await recordHeartbeat(
      env,
      [
        {
          target: '(portfolio)',
          ok: false,
          detail: `stores=${n_stores} declared=${declared} deleted=${deleted} capped=${capped} — retention sweep FAILED: ${String(err)}`,
        },
      ],
      RETENTION_SWEEP_JOB,
    );
    return;
  }

  await recordHeartbeat(
    env,
    [
      {
        target: '(portfolio)',
        ok: true,
        detail:
          declared === 0
            // ⚠️ `events(unrolled)` IS NOT THE SAME INERT AS THE OTHERS and the
            // token says so. Every other store is inert because no period is
            // declared — owner work. `events` is inert because the ROLLUP has
            // consumed nothing yet, which is the fail-closed interlock doing its
            // job, needs no owner, and resolves itself on the first rollup run.
            // One word, because a reader who cannot tell them apart will go
            // looking for a missing number that is not missing.
            ? `stores=${n_stores} declared=0 deleted=0 capped=0 — INERT: ${inert.join(', ')} (a bare store name = no period declared, owner: one value each in services/platform/src/scheduled.ts; \`events(unrolled)\` = the rollup watermark is null, which is the interlock refusing to delete unrolled-up history and needs no action).`
            : `stores=${n_stores} declared=${declared} deleted=${deleted} capped=${capped} ${per.join(' ')}${inert.length > 0 ? ` inert=${inert.join(',')}` : ''}`,
      },
    ],
    RETENTION_SWEEP_JOB,
  );
}

/** Cron entrypoint. `ctx.waitUntil` keeps the isolate alive for the async work. */
export const scheduled: ExportedHandlerScheduledHandler<Env> = async (_event, env, ctx) => {
  ctx.waitUntil(
    (async () => {
      await keepAliveSupabase(env);
      await analyticsLiveness(env);
      await renewalsFanOut(env);
      // READ-ONLY, so its position is NOT a safety property: it deletes nothing,
      // and `cancellation_requests` is a reasoned `keep` (tooling/ops/register.json
      // retention.d1.platform_db.cancellation_requests) that the sweep below never
      // touches. It sits ahead of the destructive limb only so a slow sweep cannot
      // delay a census that costs one query.
      await cancellationDrainCensus(env);
      // The rollup runs BEFORE the sweep so a day rolled up tonight is sweepable
      // tonight.
      //
      // 🔴 THIS ORDER IS AN OPTIMISATION, NOT THE SAFETY PROPERTY. Both limbs
      // catch their own errors so they can write ok=0 heartbeats, so they run
      // INDEPENDENTLY — a rollup that fails at 06:00:10 does nothing to stop a
      // sweep that deletes at 06:00:11. The safety property is the watermark the
      // sweep reads (`rollupBoundedCutoff`). Swap these two lines and nothing is
      // destroyed; delete the watermark read and everything is.
      await eventsRollup(env);
      // LAST, deliberately: the sweep is the only limb that destroys anything,
      // and a slow or failing sweep must not delay the keep-alive that stands
      // between a free-tier Supabase project and its ~7-day auto-pause.
      await retentionSweep(env);
    })(),
  );
};
