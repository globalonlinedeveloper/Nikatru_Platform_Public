// ─────────────────────────────────────────────────────────────────────────────
// lib/mor/cancel-executor.ts — QUEUED CANCELS ARE CARRIED OUT, NOT JUST COUNTED
// (refund-finish; O-CANCEL-EXECUTOR-UNBUILT).
//
// POST /v1/plan/cancel (routes/cancellation.ts) asks the rail once and records
// the request; a request the rail did not confirm sat with `executed_at` NULL
// until a human acted, and the nightly census only counted it. This is the
// executor: on the nightly firing, BEFORE the census (so the census counts what
// is still left), every recorded, unexecuted request on a rail our Worker can
// cancel is retried through the payments port — `cancelThrough`, at the period
// end, the ONLY cancel this platform makes (INV-514) — with a backoff, and the
// owner is paged ONCE per request after CANCEL_ALERT_AFTER_ATTEMPTS failures.
//
//   · idempotent: a cancel at the period end is idempotent at every rail (the
//     payments conformance suite), and the UPDATE stamps only a row still
//     `executed_at IS NULL`;
//   · bounded: MAX_CANCEL_RETRIES_PER_RUN rows a run, oldest first;
//   · a row with no provider or no subscription reference is a human's (it is
//     never selected), and a STORE row is never recorded (the route answers 409);
//   · tolerant: before migration 0028 has run, the SELECT names columns that do
//     not exist; that is caught, logged, and nothing is done.
// The account-deletion half needs nothing here: DELETE /v1/account cancels
// first or does not delete (lib/mor/cancel-on-delete.ts).
// ─────────────────────────────────────────────────────────────────────────────
import { cancelThrough, railCan } from '../../../../_shared/src/ports/payments';
import { isMoneyEnvironment } from './contract';
import { cancelPathFor } from './registry';
import { railFor } from '../../ports';
import type { Env } from '../../types';

/**
 * Queued cancels retried per nightly run: one SELECT plus one UPDATE each, inside
 * the census job's LIGHT_LIMB_STATEMENT_BUDGET with the census's own statements.
 *
 * @ceiling d1.queriesPerInvocation lte
 */
export const MAX_CANCEL_RETRIES_PER_RUN = 5;

/** @ceiling none — an operator alert threshold we chose, not a platform resource. */
export const CANCEL_ALERT_AFTER_ATTEMPTS = 3;

/** @ceiling none — a retry interval we chose, not a platform resource. */
export const CANCEL_BACKOFF_MAX_DAYS = 7;

/** @ceiling none — a unit conversion (milliseconds in a day), not a limit. */
const DAY_MS = 86_400_000;

/** When the next attempt may run after `attempts` failures: 1, 2, 4 … days, capped. */
export function nextAttemptAt(nowIso: string, attempts: number): string {
  const days = Math.min(2 ** Math.max(0, attempts - 1), CANCEL_BACKOFF_MAX_DAYS);
  return new Date(Date.parse(nowIso) + days * DAY_MS).toISOString();
}

interface QueuedRow {
  request_id: string;
  provider: string;
  provider_subscription_id: string;
  attempts: number;
  alerted_at: string | null;
}

export interface ExecutorReport {
  tried: number;
  executed: number;
  failed: number;
  alerted: number;
  skipped?: string;
}

export async function executeQueuedCancels(
  env: Env,
  now: string = new Date().toISOString(),
  page?: (subject: string, lines: string[]) => Promise<unknown>,
): Promise<ExecutorReport> {
  const report: ExecutorReport = { tried: 0, executed: 0, failed: 0, alerted: 0 };
  const environment = env.MONEY_ENVIRONMENT;
  if (!isMoneyEnvironment(environment)) return { ...report, skipped: 'money_rail_not_configured' };
  const db = env.PLATFORM_DB;
  let rows: QueuedRow[];
  try {
    rows =
      (
        await db
          .prepare(
            `SELECT request_id, provider, provider_subscription_id, attempts, alerted_at
               FROM cancellation_requests
              WHERE executed_at IS NULL AND environment = ?
                AND provider IS NOT NULL AND provider_subscription_id IS NOT NULL
                AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
              ORDER BY requested_at
              LIMIT ?`,
          )
          .bind(environment, now, MAX_CANCEL_RETRIES_PER_RUN)
          .all<QueuedRow>()
      ).results ?? [];
  } catch (err) {
    console.error(`[cancel-executor] queue unreadable (migration 0028 not applied?): ${err instanceof Error ? err.message : 'error'}`);
    return { ...report, skipped: 'queue_unreadable' };
  }

  const stuck: string[] = [];
  for (const row of rows) {
    report.tried++;
    const rail = cancelPathFor(row.provider) === 'api' ? railFor(row.provider, env) : null;
    let reason: 'provider_not_configured' | 'provider_error' | null = 'provider_not_configured';
    if (rail !== null && railCan(rail, 'cancel')) {
      const done = await cancelThrough(rail, { subscriptionRef: row.provider_subscription_id, when: 'period_end', environment });
      reason = done.ok ? null : done.sent ? 'provider_error' : 'provider_not_configured';
      if (!done.ok) console.error(`[cancel-executor] ${row.provider} request ${row.request_id} not executed: ${done.detail}`);
    }
    if (reason === null) {
      report.executed++;
      await db
        .prepare(`UPDATE cancellation_requests SET executed_at = ?, not_executed_reason = NULL, attempts = attempts + 1 WHERE request_id = ? AND executed_at IS NULL`)
        .bind(now, row.request_id)
        .run();
      continue;
    }
    report.failed++;
    const attempts = (Number(row.attempts) || 0) + 1;
    const alert = attempts >= CANCEL_ALERT_AFTER_ATTEMPTS && row.alerted_at === null;
    if (alert) {
      report.alerted++;
      stuck.push(`${row.provider} cancellation request ${row.request_id}: ${attempts} attempts, last ${reason}`);
    }
    await db
      .prepare(
        `UPDATE cancellation_requests
            SET attempts = ?, next_attempt_at = ?, not_executed_reason = ?, alerted_at = COALESCE(alerted_at, ?)
          WHERE request_id = ? AND executed_at IS NULL`,
      )
      .bind(attempts, nextAttemptAt(now, attempts), reason, alert ? now : null, row.request_id)
      .run();
  }
  if (stuck.length > 0 && page) {
    await page(`${stuck.length} cancellation(s) the rail would not carry out`, [
      ...stuck,
      'Each is retried with a backoff; a person is still billed until it is cancelled. Cancel it at the rail by hand if this persists.',
    ]);
  }
  return report;
}
