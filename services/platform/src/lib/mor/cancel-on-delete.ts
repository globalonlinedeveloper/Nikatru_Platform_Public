// ─────────────────────────────────────────────────────────────────────────────
// ⏱ 2026-09-29 · AB-A5-02 (moneyflows MF-4) · DELETING AN ACCOUNT STOPS ITS BILLING
// FIRST, OR DOES NOT DELETE.
//
// The defect: DELETE /v1/account erased the person and left their Paddle
// subscription billing. The next renewal then arrived for an account that no
// longer exists, landed in `unclaimed_payments`, and the only way the person
// could stop it was a chargeback.
//
// The rule, per live subscription row this deploy's rails wrote:
//   · a rail our Worker can cancel (Paddle, lib/mor/paddle-cancel.ts; since
//     ⏱ 2026-10-01 · fix-india-rail-tax-data also Razorpay, lib/mor/razorpay-rail.ts,
//     at the cycle end — MF-9) is cancelled at the period end BEFORE anything is
//     erased, and the confirmed cancel is recorded in `cancellation_requests`
//     (erased with the account);
//   · a rail with no executor, a cancel call that is not
//     confirmed, or a deploy with no key REFUSES the deletion with a sentence the
//     person can act on (503: the released client already says "not deleted,
//     nothing removed"). Nothing has been destroyed at that point, so a retry is
//     safe, and a retry after a confirmed cancel does not ask Paddle again;
//   · a STORE row (Apple, Google through RevenueCat) is the store's to cancel and
//     does not block: the store bills its own account, which the deletion does
//     not touch. Telling the person so is the delete dialog's copy (client).
// ─────────────────────────────────────────────────────────────────────────────
import type { SqlDb } from '../../../../_shared/src/ports/sql';
import { nowIso } from '../d1';
import { isMoneyEnvironment } from './contract';
import { cancelThrough, railCan } from '../../../../_shared/src/ports/payments';
import type { Env } from '../../types';
import { railFor } from '../../ports';
import { cancelPathFor } from './registry';

interface LiveSubscription {
  app_id: string;
  provider: string;
  provider_environment: string | null;
  provider_subscription_id: string;
}

export type CancelBeforeDeleteOutcome =
  | { ok: true; cancelled: number }
  | { ok: false; sentence: string; why: string };

/**
 * Cancel every live subscription on a rail our Worker can reach, or say why the
 * deletion must wait. Never throws for a rail answer; a D1 failure propagates
 * (the route answers it before anything is erased).
 */
export async function cancelBillingBeforeDelete(
  db: SqlDb,
  userId: string,
  env: Env,
): Promise<CancelBeforeDeleteOutcome> {
  const rows =
    (
      await db
        .prepare(
          `SELECT app_id, provider, provider_environment, provider_subscription_id
             FROM entitlements
            WHERE user_id = ? AND is_active = 1 AND revoked_at IS NULL
              AND provider IS NOT NULL AND provider_subscription_id IS NOT NULL`,
        )
        .bind(userId)
        .all<LiveSubscription>()
    ).results ?? [];

  let cancelled = 0;
  for (const row of rows) {
    const path = cancelPathFor(row.provider);
    if (path === 'store') continue;
    // ⏱ 2026-10-01 · port-pay-core: the rail is the composition root's (src/ports.ts), chosen by
    // the row's provider; a rail whose declared capabilities lack `cancel` has no executor here.
    const rail = path === 'api' ? railFor(row.provider, env) : null;
    if (rail === null || !railCan(rail, 'cancel')) {
      return {
        ok: false,
        why: `a live ${row.provider} subscription for ${row.app_id} has no cancel this server can carry out`,
        sentence: 'Your subscription is still active. Cancel it first, then delete your account.',
      };
    }
    const already = await db
      .prepare(
        `SELECT 1 AS done FROM cancellation_requests
          WHERE user_id = ? AND provider = ? AND provider_subscription_id = ? AND executed_at IS NOT NULL
          LIMIT 1`,
      )
      .bind(userId, row.provider, row.provider_subscription_id)
      .first<{ done: number }>();
    if (already !== null) continue;
    if (!isMoneyEnvironment(row.provider_environment ?? undefined)) {
      return {
        ok: false,
        why: `a live ${row.provider} row for ${row.app_id} names no money environment`,
        sentence: 'We could not stop your subscription billing, so your account was not deleted. Please try again later.',
      };
    }
    const environment = row.provider_environment as 'live' | 'sandbox';
    const done = await cancelThrough(rail, {
      subscriptionRef: row.provider_subscription_id,
      when: 'period_end',
      environment,
    });
    if (!done.ok) {
      return {
        ok: false,
        why: `${row.provider} cancel for ${row.app_id} not executed: ${done.detail}`,
        sentence: 'We could not stop your subscription billing, so your account was not deleted. Please try again later.',
      };
    }
    const at = nowIso();
    await db
      .prepare(
        `INSERT INTO cancellation_requests
           (request_id, user_id, app_id, environment, provider,
            provider_subscription_id, requested_at, executed_at, not_executed_reason)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      )
      .bind(crypto.randomUUID(), userId, row.app_id, environment, row.provider, row.provider_subscription_id, at, at)
      .run();
    cancelled += 1;
  }
  return { ok: true, cancelled };
}
