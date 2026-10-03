// ─────────────────────────────────────────────────────────────────────────────
// The two nightly writes an app's `subscriptions` table needs besides the
// renewals roll (train T11): trials that end on their own (AD-13), and the
// 30-day purge of soft-deleted rows, moved OFF the list read (SV-01).
//
// Both run inside the renewals fan-out (scheduled.ts `renewalsFanOut`), per app
// and in this order: `endTrials` → `recomputeRenewals` → `purgeSoftDeleted`.
//   · a trial ends BEFORE the roll, so a charge on the day it ends is written at
//     the post-trial price the row now carries, never the trial's;
//   · the purge goes last: it is the only one of the three that destroys rows.
// Their outcomes are folded into the app's ONE `renewals` heartbeat row
// (`housekeepingDetail`), so `cron_heartbeat` keeps one row per (job, app) and
// tooling/ops/check-heartbeats.mjs needs no new job to watch.
//
// 🔴 A FIXED STATEMENT BUDGET, WHATEVER THE DATA. Each step is SET-BASED — one
// INSERT … SELECT and one UPDATE for every trial ending tonight, three DELETEs
// for every expired row — never a statement per row, so the count below is a
// property of this file, not of the night. The rows each step may touch are
// capped per run (MAX_TRIAL_ENDS_PER_RUN, MAX_PURGE_PER_RUN); what a cap leaves
// is tomorrow's, and the detail says `capped`.
//
// Like renewals.ts this is generic over any app database: every column a step
// names is PROBED first, and a step whose columns are missing is skipped with a
// detail that says so — never a throw that costs the app its renewals tonight.
// ─────────────────────────────────────────────────────────────────────────────
import { allRows, nowIso, uuid } from './lib/d1';

/**
 * How long a soft-deleted row stays restorable before `purgeSoftDeleted`
 * removes it with its history. The app's Undo is a snackbar, so the window only
 * has to outlast a mis-tap noticed later; 30 days is the recovery window the
 * data inventory declares for it (tooling/legal/data-inventory.json).
 *
 * Moved here from subscriptiontracker-api's routes/subscriptions.ts with the
 * purge itself (train T11, SV-01).
 *
 * @ceiling none — a retention PERIOD in days, not a platform resource.
 */
export const SOFT_DELETE_PURGE_DAYS = 30;

/**
 * The most subscriptions one night's purge removes. Each takes its own row and
 * every payment_history and price_change row under it, so the night's row
 * writes are this times (1 + its history): at the fan-out's own crossing guard
 * (240 payments) plus as many price steps that is under 50,000 even in the
 * worst case, inside the 100,000 daily row-write ceiling, and a real removed
 * subscription carries a few dozen. A backlog past it is tomorrow's (`capped`).
 *
 * @ceiling d1.rowsWrittenPerDay lte
 */
export const MAX_PURGE_PER_RUN = 100;

/**
 * The most trials one night ends. Each costs one UPDATE row and at most one
 * price_change row; a night that reaches it says `capped` and ends the rest
 * tomorrow, each still dated by its own `trial_ends_on`.
 *
 * @ceiling d1.rowsWrittenPerDay lte
 */
export const MAX_TRIAL_ENDS_PER_RUN = 1000;

/**
 * Statements ONE app's housekeeping sends, per night, whatever the data: the
 * column probe (1), `endTrials` (2 — the price_change INSERT … SELECT and the
 * UPDATE) and `purgeSoftDeleted` (3 — payment_history, price_change,
 * subscriptions). test/subscription-housekeeping.test.ts counts them.
 *
 * @ceiling d1.queriesPerInvocation lte
 */
export const HOUSEKEEPING_STATEMENTS_PER_APP = 6;

/** What one app database has, read in ONE statement. */
export interface HousekeepingSchema {
  subscriptions: Set<string>;
  paymentHistory: Set<string>;
  priceChange: Set<string>;
}

/**
 * Every column the two steps may name, in ONE statement: `pragma_table_info`
 * with a LITERAL argument per table, three terms of one UNION ALL. A table that
 * does not exist yields no rows rather than an error.
 *
 * 🔴 NEVER `sqlite_master` IN THE SAME STATEMENT. D1 refuses a statement that
 * names sqlite_master AND calls a pragma function (SQLITE_AUTH, measured against
 * both production databases — tooling/ci/assert-d1-sql-inventory.mjs R1), which
 * is the obvious way to write this and the way that failed every in-app account
 * deletion for months. Three literal terms are far inside the five D1 accepts
 * in one compound SELECT (services/_shared/src/erasure.ts `everyColumn`).
 */
export async function probeHousekeepingSchema(db: D1Database): Promise<HousekeepingSchema> {
  const rows = await allRows<{ tbl: string; col: string }>(
    db.prepare(
      `SELECT 'subscriptions' AS tbl, name AS col FROM pragma_table_info('subscriptions')
       UNION ALL SELECT 'payment_history' AS tbl, name AS col FROM pragma_table_info('payment_history')
       UNION ALL SELECT 'price_change' AS tbl, name AS col FROM pragma_table_info('price_change')`,
    ),
  );
  const of = (table: string) => new Set(rows.filter((r) => r.tbl === table).map((r) => r.col));
  return { subscriptions: of('subscriptions'), paymentHistory: of('payment_history'), priceChange: of('price_change') };
}

// ── THE STATEMENTS, EVERY ONE A LITERAL AT ITS `.prepare(` ──────────────────
// D1 cannot bind an identifier, and a hand-built statement is one nobody audits
// (tooling/ci/assert-d1-sql-inventory.mjs R2/R3), so no statement here is
// assembled: each variant a step may send is written out whole, where it is
// sent. Each binds the same tail: `today` and the per-run cap for a trial,
// `cutoff` and the cap for a purge.
//
// THE TRIALS ENDING TONIGHT, in every trial statement: still `trialing`, not
// removed, `trial_ends_on` today or earlier, oldest first, at most the cap. The
// first two terms are the partial index `idx_subscriptions_trial_end`'s WHERE
// (subscriptiontracker-api migrations/0010), term for term, so the scan reads
// only trialing rows (test/renewals-index.test.ts).
//
// THE DECIMAL A MINOR AMOUNT MEANS, `minor / 10^digits` by the row's currency,
// is the CASE written into the statements that convert: each currency whose
// exponent is not two, by its digits, and 100 for the rest. It is
// src/lib/reminders.ts MINOR_DIGITS_NOT_TWO spelled as SQL, and
// test/subscription-housekeeping.test.ts reads the code lists back out of this
// file and holds them equal to that table.
//
// A row with no currency is never converted (`currency IS NOT NULL`): an exact
// amount with no unit has no decimal, and the API never stores one that way.

export interface StepOutcome {
  ok: boolean;
  detail: string;
}

/**
 * TRIALS END ON THEIR OWN (train T11, AD-13). Before this nothing ever moved a
 * row out of `trialing`: the app said "Trial" for ever, and the renewals roll
 * wrote the trial's price as the first real charge.
 *
 * On `trial_ends_on` — the day the trial converts and the first charge lands —
 * the row becomes `active`, and when `price_after_trial_minor` (0010) is set,
 * `price` and `price_minor` move to it and it is cleared, with ONE price_change
 * row when the price actually moved (the PATCH route's rule: a different
 * `price`). The price_change INSERT … SELECT runs FIRST in the batch, so it
 * reads the trial price the UPDATE is about to replace; one batch is one
 * transaction, so the log can never hold a step the row does not.
 */
export async function endTrials(
  db: D1Database,
  schema: HousekeepingSchema,
  nowMs: number = Date.now(),
): Promise<StepOutcome> {
  const cols = schema.subscriptions;
  if (!['status', 'trial_ends_on', 'deleted_at'].every((c) => cols.has(c))) {
    return { ok: true, detail: 'trials=skipped(no lifecycle columns)' };
  }
  const today = new Date(nowMs).toISOString().slice(0, 10);
  const ts = nowIso();
  try {
    const statements: D1PreparedStatement[] = [];
    const reprices = cols.has('price_after_trial_minor') && cols.has('currency') && cols.has('price_minor');
    const logs =
      reprices && ['subscription_id', 'user_id', 'new_price_minor'].every((c) => schema.priceChange.has(c));
    if (logs) {
      // One price_change row per trial whose post-trial price differs from its price.
      statements.push(
        db
          .prepare(
            `INSERT INTO price_change
               (id, subscription_id, user_id, old_price, new_price, old_price_minor,
                new_price_minor, old_currency, new_currency, changed_at)
             SELECT ? || '-' || id, id, user_id, price,
                    price_after_trial_minor * 1.0 / (CASE
                   WHEN currency IN ('BIF','CLP','DJF','GNF','ISK','JPY','KMF','KRW','PYG','RWF','UGX','UYI','VND','VUV','XAF','XOF','XPF') THEN 1
                   WHEN currency IN ('BHD','IQD','JOD','KWD','LYD','OMR','TND') THEN 1000
                   WHEN currency IN ('CLF','UYW') THEN 10000
                   ELSE 100 END),
                    price_minor, price_after_trial_minor, currency, currency, ?
               FROM subscriptions
              WHERE id IN (SELECT id FROM subscriptions
                            WHERE status = 'trialing' AND deleted_at IS NULL
                              AND trial_ends_on IS NOT NULL AND trial_ends_on <= ?
                            ORDER BY trial_ends_on LIMIT ?)
                AND price_after_trial_minor IS NOT NULL AND currency IS NOT NULL
                AND price_after_trial_minor * 1.0 / (CASE
                   WHEN currency IN ('BIF','CLP','DJF','GNF','ISK','JPY','KMF','KRW','PYG','RWF','UGX','UYI','VND','VUV','XAF','XOF','XPF') THEN 1
                   WHEN currency IN ('BHD','IQD','JOD','KWD','LYD','OMR','TND') THEN 1000
                   WHEN currency IN ('CLF','UYW') THEN 10000
                   ELSE 100 END) IS NOT price`,
          )
          .bind(uuid(), ts, today, MAX_TRIAL_ENDS_PER_RUN),
      );
    }
    if (reprices) {
      // The trial ends: `active`, and at its post-trial price where it has one.
      statements.push(
        db
          .prepare(
            `UPDATE subscriptions
                SET status = 'active',
                    updated_at = ?,
                    price = CASE WHEN price_after_trial_minor IS NOT NULL AND currency IS NOT NULL
                                 THEN price_after_trial_minor * 1.0 / (CASE
                   WHEN currency IN ('BIF','CLP','DJF','GNF','ISK','JPY','KMF','KRW','PYG','RWF','UGX','UYI','VND','VUV','XAF','XOF','XPF') THEN 1
                   WHEN currency IN ('BHD','IQD','JOD','KWD','LYD','OMR','TND') THEN 1000
                   WHEN currency IN ('CLF','UYW') THEN 10000
                   ELSE 100 END)
                                 ELSE price END,
                    price_minor = CASE WHEN price_after_trial_minor IS NOT NULL AND currency IS NOT NULL
                                       THEN price_after_trial_minor ELSE price_minor END,
                    price_after_trial_minor = CASE WHEN price_after_trial_minor IS NOT NULL AND currency IS NOT NULL
                                                   THEN NULL ELSE price_after_trial_minor END
              WHERE id IN (SELECT id FROM subscriptions
                            WHERE status = 'trialing' AND deleted_at IS NULL
                              AND trial_ends_on IS NOT NULL AND trial_ends_on <= ?
                            ORDER BY trial_ends_on LIMIT ?)`,
          )
          .bind(ts, today, MAX_TRIAL_ENDS_PER_RUN),
      );
    } else {
      // A database with no post-trial price column (before 0010): status only.
      statements.push(
        db
          .prepare(
            `UPDATE subscriptions
                SET status = 'active', updated_at = ?
              WHERE id IN (SELECT id FROM subscriptions
                            WHERE status = 'trialing' AND deleted_at IS NULL
                              AND trial_ends_on IS NOT NULL AND trial_ends_on <= ?
                            ORDER BY trial_ends_on LIMIT ?)`,
          )
          .bind(ts, today, MAX_TRIAL_ENDS_PER_RUN),
      );
    }
    const results = await db.batch(statements);
    const repriced = logs ? (results[0]?.meta.changes ?? 0) : 0;
    const ended = results[results.length - 1]?.meta.changes ?? 0;
    return {
      ok: true,
      detail:
        `trials_ended=${ended} repriced=${repriced}` +
        (ended >= MAX_TRIAL_ENDS_PER_RUN ? ' capped' : '') +
        (reprices ? '' : ' (no post-trial price column)'),
    };
  } catch (err) {
    return { ok: false, detail: `trials failed: ${String(err)}` };
  }
}

// THE EXPIRED SET, in every purge statement: soft-deleted before the cutoff,
// oldest first, at most the cap. Its first term is the partial index
// `idx_subscriptions_deleted`'s WHERE (0010), so the night reads only removed
// rows. The history DELETEs match on (subscription_id, user_id), as the per-user
// purge did, so a history row only ever goes with the row of the SAME user.

/**
 * THE 30-DAY PURGE, OFF THE READ PATH (train T11, SV-01). This was
 * subscriptiontracker-api's `purgeExpired`, run by GET /v1/subscriptions ahead
 * of every list: three DELETEs for one SELECT, per user, per app open.
 *
 * Removes every row soft-deleted more than SOFT_DELETE_PURGE_DAYS ago, oldest
 * first and at most MAX_PURGE_PER_RUN a night, WITH the payment_history and
 * price_change rows that belong to it, in ONE batch (one transaction): a row
 * never goes without its history or the history without its row.
 *
 * 🔴 THIS IS THE ONE PLACE A SUBSCRIPTION IS EVER HARD-DELETED outside account
 * erasure. The expired set is the same subquery in all three statements; the
 * first two do not touch `subscriptions`, so inside the transaction it selects
 * the same rows three times.
 */
export async function purgeSoftDeleted(
  db: D1Database,
  schema: HousekeepingSchema,
  nowMs: number = Date.now(),
): Promise<StepOutcome> {
  if (!schema.subscriptions.has('deleted_at')) return { ok: true, detail: 'purged=skipped(no deleted_at)' };
  const cutoff = new Date(nowMs - SOFT_DELETE_PURGE_DAYS * 86_400_000).toISOString();
  const history = (cols: Set<string>) => cols.has('subscription_id') && cols.has('user_id');
  try {
    const statements: D1PreparedStatement[] = [];
    if (history(schema.paymentHistory)) {
      statements.push(
        db
          .prepare(
            `DELETE FROM payment_history
              WHERE (subscription_id, user_id) IN (SELECT id, user_id FROM subscriptions
                      WHERE deleted_at IS NOT NULL AND deleted_at < ? ORDER BY deleted_at LIMIT ?)`,
          )
          .bind(cutoff, MAX_PURGE_PER_RUN),
      );
    }
    if (history(schema.priceChange)) {
      statements.push(
        db
          .prepare(
            `DELETE FROM price_change
              WHERE (subscription_id, user_id) IN (SELECT id, user_id FROM subscriptions
                      WHERE deleted_at IS NOT NULL AND deleted_at < ? ORDER BY deleted_at LIMIT ?)`,
          )
          .bind(cutoff, MAX_PURGE_PER_RUN),
      );
    }
    statements.push(
      db
        .prepare(
          `DELETE FROM subscriptions
            WHERE (id, user_id) IN (SELECT id, user_id FROM subscriptions
                    WHERE deleted_at IS NOT NULL AND deleted_at < ? ORDER BY deleted_at LIMIT ?)`,
        )
        .bind(cutoff, MAX_PURGE_PER_RUN),
    );
    const results = await db.batch(statements);
    const purged = results[results.length - 1]?.meta.changes ?? 0;
    return { ok: true, detail: `purged=${purged}` + (purged >= MAX_PURGE_PER_RUN ? ' capped' : '') };
  } catch (err) {
    return { ok: false, detail: `purge failed: ${String(err)}` };
  }
}

/**
 * One app's renewals heartbeat row: the housekeeping tokens FIRST, because
 * recordHeartbeat keeps 200 characters and the renewals detail is the one that
 * can run long. ok only when all three steps were.
 */
export function housekeepingDetail(trials: StepOutcome, renewals: StepOutcome, purge: StepOutcome): StepOutcome {
  return {
    ok: trials.ok && renewals.ok && purge.ok,
    detail: `${trials.detail}; ${purge.detail}; ${renewals.detail}`,
  };
}
