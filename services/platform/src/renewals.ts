// ─────────────────────────────────────────────────────────────────────────────
// Renewals recompute — relocated from subly-api's cron into the platform
// scheduler's per-app fan-out. The date math is a PURE core (unit tested); the
// D1 pass wraps it. Generic over any app DB with subscriptions + payment_history.
// ─────────────────────────────────────────────────────────────────────────────
import type { Subscription } from './types';
import { allRows, nowIso, todayYmd, uuid } from './lib/d1';

/** Days in a UTC month. Day 0 of month+1 IS the last day of `month0`. */
function daysInUtcMonth(year: number, month0: number): number {
  return new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
}

const pad = (n: number, w = 2): string => String(n).padStart(w, '0');

/** Parse the leading 'YYYY-MM-DD' of a stored date. Throws on anything else. */
function parseYmd(dateYmd: string): { year: number; month0: number; day: number } {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateYmd);
  if (!m) throw new RangeError(`renewals: not a YYYY-MM-DD date: ${JSON.stringify(dateYmd)}`);
  const year = Number(m[1]);
  const month0 = Number(m[2]) - 1;
  const day = Number(m[3]);
  if (month0 < 0 || month0 > 11 || day < 1 || day > 31) {
    throw new RangeError(`renewals: out-of-range date: ${JSON.stringify(dateYmd)}`);
  }
  return { year, month0, day };
}

/**
 * Advance a 'YYYY-MM-DD' date by one billing cycle, staying in UTC.
 *
 * 🔴 CLAMPS AT MONTH END — it does NOT use `setUTCMonth`, and that is the whole
 * point. `setUTCMonth` OVERFLOWS: Jan 31 + 1 month is "Feb 31", which JS
 * normalises to Mar 3. That silently (a) skips February entirely, so the
 * payment_history row for that cycle is never written and the user's spend total
 * is permanently short one charge, and (b) moves the renewal day from the 31st
 * to the 3rd, for good, because the next pass starts from the corrupted value.
 * Every 29th/30th/31st anchor was affected — i.e. every "last day of the month"
 * subscription. Fixed 2026-08-01; the old behaviour had been ASSERTED AS THE SPEC
 * by a test, so nothing could go red.
 *
 * `anchorDay` is the original day-of-month the subscription is billed on. It MUST
 * be threaded through a chain of calls rather than re-derived from each clamped
 * result, or Jan 31 → Feb 28 → Mar 28 still loses the 31st. Defaults to the day
 * of `dateYmd` for a single standalone step.
 */
export function advance(dateYmd: string, cycle: 'monthly' | 'yearly', anchorDay?: number): string {
  const { year, month0, day } = parseYmd(dateYmd);
  const anchor = Math.min(Math.max(Math.trunc(anchorDay ?? day), 1), 31);

  const targetMonth0 = cycle === 'yearly' ? month0 : (month0 + 1) % 12;
  const targetYear = cycle === 'yearly' ? year + 1 : month0 === 11 ? year + 1 : year;
  // Feb 29 yearly → Feb 28 in a common year (not Mar 1); Jan 31 → Feb 28/29.
  const targetDay = Math.min(anchor, daysInUtcMonth(targetYear, targetMonth0));

  return `${pad(targetYear, 4)}-${pad(targetMonth0 + 1)}-${pad(targetDay)}`;
}

/**
 * PURE core: roll `next` forward one cycle at a time until it is today-or-later.
 * Returns the new next-renewal date and the list of cycle-boundary dates crossed
 * (one payment_history row each). A guard caps pathological backlogs.
 *
 * The anchor day is taken from `next` ONCE and carried through the whole loop,
 * so a 31st subscription reads 31 → Feb 28 → 31 → 30 → 31 … rather than
 * ratcheting down to the shortest month it has ever passed through.
 *
 * ⬜ KNOWN RESIDUAL, documented rather than silent: the anchor cannot survive
 * BETWEEN cron runs, because `subscriptions` stores only `next_renewal` and no
 * anchor column (services/subly-api/migrations/0001_init.sql:7-22) — so a 31st
 * subscription whose stored value is the clamped 2026-02-28 comes back as a 28th
 * anchor on the next night's pass. That costs at most three days once a year and
 * never skips a cycle; recovering it fully needs an additive `renewal_anchor_day`
 * column in subly_db, which platform does not own (no `migrations_dir` for
 * SUBLY_DB in wrangler.jsonc). Pinned by a test so it stays a known limit.
 */
export function rollForward(
  next: string,
  cycle: 'monthly' | 'yearly',
  today: string,
): { next: string; crossings: string[] } {
  const crossings: string[] = [];
  let cur = next;
  const anchorDay = parseYmd(next).day;
  let guard = 0;
  while (cur < today && guard < 240) {
    crossings.push(cur);
    cur = advance(cur, cycle, anchorDay);
    guard++;
  }
  return { next: cur, crossings };
}

/**
 * For every subscription whose next_renewal is in the past, roll it forward and
 * record a payment_history row per crossed charge. Batched per DB. Errors are
 * contained so one app never aborts the others in the fan-out.
 *
 * 🔴 RETURNS ITS OUTCOME AS OF 2026-08-03 ([pipeline B-11]) — IT USED TO RETURN
 * `void`, AND THAT WAS THE WHOLE DEFECT. Every failure path here ended at
 * `console.log`, and `wrangler tail` is a live stream that Free keeps no
 * searchable history of. So the second of the portfolio's two cron jobs could
 * fail every night — a missing table, a schema drift, a D1 outage — and the
 * ONLY instrument that outlives the invocation, `cron_heartbeat`, would carry
 * not one row about it. `check-heartbeats.mjs` would still report clean, because
 * it can only grade rows that exist.
 *
 * ⚠️ THE SUBTLE HALF: "nothing due" is a SUCCESS, not a silence. A night with no
 * renewals to advance and a night where the query threw must produce DIFFERENT
 * rows, or the heartbeat means "the code got this far" rather than "the job
 * worked". Both land `ok`, with a `detail` that distinguishes them.
 *
 * Still never throws: the caller is a `for` loop over every app, and one app's
 * broken database must not take the rest of the fan-out down with it.
 */
export async function recomputeRenewals(
  db: D1Database,
  appId: string,
): Promise<{ ok: boolean; detail: string }> {
  const today = todayYmd();
  try {
    const due = await allRows<Subscription>(
      db
        .prepare(
          `SELECT id, user_id, price, cycle, next_renewal FROM subscriptions
             WHERE next_renewal IS NOT NULL
               AND cycle IS NOT NULL
               AND next_renewal < ?`,
        )
        .bind(today),
    );

    if (due.length === 0) {
      console.log(`[cron] renewals(${appId}): nothing due`);
      return { ok: true, detail: 'nothing due' };
    }

    const ts = nowIso();
    const updateStmt = db.prepare(
      'UPDATE subscriptions SET next_renewal = ?, updated_at = ? WHERE id = ?',
    );
    // ── payment_history.updated_at — THE ONLY WRITER, FINALLY WRITING IT ──────
    // 🔴 THIS INSERT IS THE TABLE'S ONLY WRITER ANYWHERE IN THE TREE, and until
    // 2026-08-25 its column list ended at `paid_at`. subly_db's migration
    // 0002_schema_debt.sql had added `updated_at` and seeded the rows that
    // existed at the time from `paid_at`; every row written SINCE carried NULL
    // forever, so the one-shot backfill was the only value the column would ever
    // hold and "tell a stale row from a fresh one" was undecidable for exactly
    // the rows the cron creates. It is seeded from `paid_at` for the same reason
    // the migration's backfill was: a row that has just been created has never
    // been modified since creation, and the column should mean one thing.
    //
    // ⚠️ THE COLUMN IS PROBED, NOT ASSUMED, and that is not defensiveness — this
    // function's own header says it is "generic over any app DB with
    // subscriptions + payment_history", and the fan-out is a `for` loop over
    // every app whose one rule is that one app's broken database must not take
    // the rest down. `updated_at` is subly_db's 0002; the brick's starter schema
    // has no payment_history at all, so a future app's table may legitimately
    // predate the column. An unconditional six-column INSERT would fail the whole
    // nightly batch for that app — every renewal missed, every payment row lost —
    // to write one timestamp. Where the column is missing the write is the same
    // five columns it always was and the heartbeat SAYS SO, so the gap is a
    // number an operator can see rather than a silence.
    const paymentColumns = await allRows<{ name: string }>(
      db.prepare("SELECT name FROM pragma_table_info('payment_history')"),
    );
    const hasUpdatedAt = paymentColumns.some((col) => col.name === 'updated_at');
    const paymentStmt = hasUpdatedAt
      ? db.prepare(
          `INSERT INTO payment_history (id, subscription_id, user_id, amount, paid_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
        )
      : db.prepare(
          `INSERT INTO payment_history (id, subscription_id, user_id, amount, paid_at)
       VALUES (?, ?, ?, ?, ?)`,
        );

    const ops: D1PreparedStatement[] = [];
    for (const sub of due) {
      const cycle = sub.cycle as 'monthly' | 'yearly';
      const { next, crossings } = rollForward(sub.next_renewal as string, cycle, today);
      for (const when of crossings) {
        const paidAt = `${when}T00:00:00Z`;
        ops.push(
          hasUpdatedAt
            ? paymentStmt.bind(uuid(), sub.id, sub.user_id, sub.price ?? null, paidAt, paidAt)
            : paymentStmt.bind(uuid(), sub.id, sub.user_id, sub.price ?? null, paidAt),
        );
      }
      ops.push(updateStmt.bind(next, ts, sub.id));
    }

    await db.batch(ops);
    console.log(`[cron] renewals(${appId}): advanced ${due.length} subscription(s)`);
    return {
      ok: true,
      // The counts are the point: "advanced 0 subscription(s)" would be a
      // contradiction against a non-empty `due`, and a night that suddenly
      // advances thousands is worth seeing in the same table as a night that
      // advances three.
      detail:
        `advanced ${due.length} subscription(s), ${ops.length} statement(s)` +
        (hasUpdatedAt
          ? ''
          : ' — WITHOUT updated_at: this app database has no such column on payment_history, so every row written tonight carries none'),
    };
  } catch (err) {
    console.log(`[cron] renewals(${appId}) failed: ${String(err)}`);
    return { ok: false, detail: String(err) };
  }
}
