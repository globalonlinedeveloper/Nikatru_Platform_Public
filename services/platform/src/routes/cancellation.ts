// ─────────────────────────────────────────────────────────────────────────────
// POST /v1/plan/cancel — the ROSCA path's server half. [pipeline 5]M-9.
//
// "A user can cancel in-app as easily as they bought." Buying is one tap that
// opens a hosted checkout; cancelling therefore has to be one tap that DOES
// something, not a mailto: link and not a support form. This is the something.
//
// ── 🔴 WHAT THIS ROUTE HONESTLY IS, AND WHAT IT IS NOT ───────────────────────
// The merchant of record owns the buyer relationship ([ADR 004]) — it holds the
// payment method, and only its API can stop a subscription. That API's endpoint
// shape has never been read against a primary source in this repo.
//
// ⚠️ CORRECTED 2026-08-28: that sentence read "That API needs a seller
// credential which DOES NOT EXIST (OWNER_QUEUE A-1, PENDING), and its endpoint
// shape has never been read…". THE CREDENTIAL EXISTS — [ADR 044], LOCKED
// 2026-08-11, evidences a live production seller key. The UNREAD ENDPOINT SHAPE
// is what remains, and it is the half that actually decides this route's design,
// so nothing below changes.
// Encoding a guessed cancel call would ship a button that 404s at the vendor for
// the first real subscriber, and nothing would go red.
//
// ⏱ 2026-09-29 · AB-M4-03: THE SHAPE IS READ, AND A PADDLE ROW IS NOW CANCELLED.
// lib/mor/paddle-cancel.ts carries the call; lib/mor/registry.ts `RAIL_CANCEL_PATH`
// says which rail can be cancelled by whom. What follows is what the route did
// before that day, and is still what it does for a rail with no executor:
//
// So the route does the half that is real and says so precisely:
//   1 · RECORD the request in `cancellation_requests`, ours, append-only. This
//       is what makes "I cancelled and you kept billing me" a checkable claim
//       rather than one person's word.
//   2 · ASK the rail to execute it. No registered adapter can today, so nothing
//       is executed and the reason is stored as an enumerable code.
//   3 · ANSWER 202 with `{recorded: true, executed: false}`.
//
// A 200 with `{ok:true}` would be the lie: it reads as "cancelled" to every
// client that does not inspect the body, and the client would then tell a paying
// user their subscription is over. The three booleans are separate because they
// are separately true.
//
// ── WHO COUNTS THE ROWS NOBODY DRAINS (added 2026-08-21) ─────────────────────
// Recording without a drain is a queue that grows in silence, and until this
// date nothing anywhere counted it. Measured on the tree that day: this INSERT
// was the table's ONLY writer, and `executed_at` occurred in FIVE code sites in
// the whole repository, NONE of them a reader — the INSERT below (grep
// `requested_at, executed_at, not_executed_reason`, :175 as of 2026-08-24, :168
// as of 2026-08-22 and :151 before the paragraph you are reading grew), three
// lines of migrations/0005_cancellation_requests.sql (:20, :25, :59) and one
// assertion at test/cancellation.test.ts:156. There was no UPDATE of the table
// anywhere and nothing in tooling/ops listed a pending row. FIVE is the count
// BEFORE this change, which adds ten of its own — five in ../scheduled.ts, four
// in test/cancellation-drain.test.ts, one here — so the same repository-wide
// grep run today returns FIFTEEN, not six.
// ⚠️ CORRECTED 2026-08-22, NOT REWRITTEN: the FIFTEEN was re-taken today and is
// now TWENTY.  `grep -ron executed_at .` (node_modules and .git excluded) —
// test/cancellation-drain.test.ts 6, ../scheduled.ts 6, this file 4,
// migrations/0005_cancellation_requests.sql 3, test/cancellation.test.ts 1. The
// FIVE and the FIFTEEN above were both true when written; the 2026-08-22 pass
// added two assertions naming the column to the new test and one grep recipe
// to each of this file and ../scheduled.ts. The point is unchanged — a reader
// must not read the count as evidence of readers at all, because the number of
// CODE PATHS THAT READ the column is still ONE, the census in ../scheduled.ts.
// ⚠️ CORRECTED AGAIN 2026-08-24, AND AGAIN NOT REWRITTEN: the TWENTY is now
// TWENTY-ONE. The pin-or-delete pass added ONE more mention of the drain column,
// in the SELECT of the new case that reads the fixture's own rows back, so
// test/cancellation-drain.test.ts goes 6 -> 7 and no other file moves. NOT ONE
// of the seven lines of this correction spells the column, so the correction
// cannot appear in its own count. The point survives all three numbers: the
// number of CODE PATHS THAT READ the column is STILL ONE.
// The drain-census limb in ../scheduled.ts now writes the queue's depth to
// `cron_heartbeat` under a job name THIS FILE DELIBERATELY DOES NOT SPELL, on
// every nightly cron run. Two different spellings disarm two different limbs of
// `deriveWatchedJobs` (tooling/ops/check-heartbeats.mjs), which reads the RAW
// bytes of services/platform/src with comments included: the CONSTANT name
// disarms "declared and NEVER USED", and the JOB NAME IN SINGLE OR DOUBLE QUOTES
// disarms "COVERAGE LOST". Measured 2026-08-24 — see that constant's doc in
// ../scheduled.ts for both before/afters; one of the two had to be fixed there.
//
// ⚠️ IT CHANGES NOTHING ABOUT THIS ROUTE, and it drains nothing. The census
// counts; executing is still owner-gated on the seller credential above, no
// heartbeat goes red as the backlog grows, and on a healthy night the number is
// only in the table — check-heartbeats.mjs prints a job's detail only when that
// job is RED. It makes the depth a number instead of a silence, so the owner
// half starts from a count rather than from an unknown.
//
// ── WHY THE SUBSCRIPTION IS RESOLVED FROM THE SESSION ────────────────────────
// The body carries an app id and NOTHING ELSE. A route that accepted a
// subscription id would let anyone cancel anyone's subscription — the id is not
// a secret, it appears on receipts. `user_id` comes from the verified JWT and
// from nowhere else.
// ─────────────────────────────────────────────────────────────────────────────
import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { allRows, nowIso, run } from '../lib/d1';
import { isKnownApp, isSellableExtension } from '../config';
import { isMoneyEnvironment } from '../lib/mor/contract';
import { readBoundedBody } from '../lib/body';
import { cancelPathFor, storeCancelPage } from '../lib/mor/registry';
import { cancelThrough, railCan, type RailOutbound } from '../../../_shared/src/ports/payments';
import { railFor } from '../ports';

const cancellation = new Hono<AppEnv>();

/**
 * An app id and nothing else. 1 KiB is generous for that.
 *
 * @ceiling workers.maxRequestBodySize lte
 */
export const MAX_CANCEL_BODY_BYTES = 1024;

/**
 * Why a recorded request was not executed on the rail. ENUMERABLE — this value
 * is read by support and by CI, and a free-text error string in a column is a
 * value nobody can query and occasionally a value that leaks a URL or a key.
 */
export type NotExecutedReason = 'provider_not_configured' | 'no_provider_on_row' | 'provider_error';

interface LiveRow {
  entitlement: string;
  provider: string | null;
  provider_subscription_id: string | null;
  store: string | null;
}

cancellation.post('/plan/cancel', async (c) => {
  const userId = c.get('userId');
  const rid = c.get('requestId') ?? '-';

  const read = await readBoundedBody(c.req.raw, MAX_CANCEL_BODY_BYTES);
  if (!read.ok) return c.json({ error: read.error }, read.status);

  let body: unknown;
  try {
    body = JSON.parse(read.text);
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }
  const appId =
    typeof body === 'object' && body !== null
      ? (body as Record<string, unknown>).app_id
      : undefined;
  // ⏱ 2026-10-01 · #1117 review 1: what /v1/checkout sells, this route
  // cancels — an app, or an extension with a committed paywall. Held by
  // test/sell-cancel-parity.test.ts, which reads both routes' answers.
  if (typeof appId !== 'string' || !(isKnownApp(appId) || isSellableExtension(appId))) {
    return c.json({ error: 'unknown_app' }, 404);
  }
  c.set('appId', appId); // [pipeline B-16] attribution, post-validation.

  // Same refusal as every other money surface: there is no safe default for
  // which money world this deploy is, so an undeclared one answers 503 rather
  // than recording a request against a world nobody named. [5]M-12.
  const environment = c.env.MONEY_ENVIRONMENT;
  if (!isMoneyEnvironment(environment)) {
    console.error(
      `[cancel] rid=${rid} MONEY_ENVIRONMENT is ${JSON.stringify(environment)} — refusing.`,
    );
    return c.json({ error: 'money_rail_not_configured' }, 503);
  }

  // 🔴 BOTH PREDICATES AND THE ENVIRONMENT. `user_id` alone spans every app;
  // `app_id` alone spans every user; and a row from the other money world is not
  // this deploy's subscription to cancel.
  const rows = await allRows<LiveRow>(
    c.env.PLATFORM_DB.prepare(
      `SELECT entitlement, provider, provider_subscription_id, store
         FROM entitlements
        WHERE user_id = ? AND app_id = ? AND is_active = 1
          AND provider_environment = ?
          AND revoked_at IS NULL`,
    ).bind(userId, appId, environment),
  );

  if (rows.length === 0) {
    // 404 rather than a recorded no-op: recording a cancellation of nothing
    // manufactures evidence of a subscription that never existed, and support
    // would then have to disprove it.
    return c.json({ has_active_plan: false, recorded: false, executed: false }, 404);
  }

  const row = rows[0];

  // ⏱ 2026-09-29 · AB-M4-03 · A STORE ROW IS THE STORE'S TO CANCEL. Apple and
  // Google bill through their own accounts and expose no cancel to a seller, so
  // the honest answer is WHERE, not a recorded row nothing can ever execute
  // (which read `provider_not_configured`, untrue for these rows). 409, and
  // nothing written.
  if (row.provider !== null && cancelPathFor(row.provider) === 'store') {
    const page = storeCancelPage(row.store);
    return c.json(
      {
        has_active_plan: true,
        recorded: false,
        executed: false,
        cancel_at: page.cancelAt,
        manage_url: page.manageUrl,
      },
      409,
    );
  }

  // Executing on the rail. `no_provider_on_row` means the row predates the rail
  // knowing which provider wrote it; `provider_not_configured` that the rail has
  // no executor (Razorpay, MF-9) or this deploy holds no key for it;
  // `provider_error` that the rail was asked and did not confirm. All three are
  // recoverable by a human; none is an error the user caused.
  let notExecutedReason: NotExecutedReason | null;
  let effectiveAt: string | null = null;
  let rail: RailOutbound | null = null;
  if (row.provider === null) {
    notExecutedReason = 'no_provider_on_row';
  } else if (cancelPathFor(row.provider) === 'api' && (rail = railFor(row.provider, c.env)) !== null && railCan(rail, 'cancel')) {
    // ⏱ 2026-10-01 · port-pay-core: through the row's rail (src/ports.ts), never a named vendor.
    const done = await cancelThrough(rail, {
      subscriptionRef: row.provider_subscription_id ?? '',
      when: 'period_end',
      environment,
    });
    if (done.ok) {
      notExecutedReason = null;
      effectiveAt = done.effectiveAt;
    } else {
      console.error(`[cancel] rid=${rid} app=${appId} ${row.provider} cancel not executed: ${done.detail}`);
      notExecutedReason = done.sent ? 'provider_error' : 'provider_not_configured';
    }
  } else {
    notExecutedReason = 'provider_not_configured';
  }

  const requestedAt = nowIso();
  await run(
    c.env.PLATFORM_DB.prepare(
      `INSERT INTO cancellation_requests
         (request_id, user_id, app_id, environment, provider,
          provider_subscription_id, requested_at, executed_at, not_executed_reason, backlog)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    ).bind(
      crypto.randomUUID(),
      userId,
      appId,
      environment,
      row.provider,
      row.provider_subscription_id,
      requestedAt,
      notExecutedReason === null ? requestedAt : null,
      notExecutedReason,
    ),
  );

  if (notExecutedReason === null) {
    // 200 ONLY HERE: the rail confirmed the cancel. Access continues to the end
    // of the paid period (`effective_at`), and the terminal webhook ends it.
    return c.json(
      { has_active_plan: true, recorded: true, executed: true, effective_at: effectiveAt },
      200,
    );
  }

  // 202 ACCEPTED, and the status code is part of the honesty: the request has
  // been recorded and has NOT been carried out. A 200 would say it is done.
  return c.json(
    {
      has_active_plan: true,
      recorded: true,
      executed: false,
      not_executed_reason: notExecutedReason,
    },
    202,
  );
});

export default cancellation;
