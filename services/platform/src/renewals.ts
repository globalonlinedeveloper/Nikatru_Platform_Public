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
 * swallowed so one app never aborts the others in the fan-out.
 */
export async function recomputeRenewals(db: D1Database, appId: string): Promise<void> {
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
      return;
    }

    const ts = nowIso();
    const updateStmt = db.prepare(
      'UPDATE subscriptions SET next_renewal = ?, updated_at = ? WHERE id = ?',
    );
    const paymentStmt = db.prepare(
      `INSERT INTO payment_history (id, subscription_id, user_id, amount, paid_at)
       VALUES (?, ?, ?, ?, ?)`,
    );

    const ops: D1PreparedStatement[] = [];
    for (const sub of due) {
      const cycle = sub.cycle as 'monthly' | 'yearly';
      const { next, crossings } = rollForward(sub.next_renewal as string, cycle, today);
      for (const when of crossings) {
        ops.push(
          paymentStmt.bind(uuid(), sub.id, sub.user_id, sub.price ?? null, `${when}T00:00:00Z`),
        );
      }
      ops.push(updateStmt.bind(next, ts, sub.id));
    }

    await db.batch(ops);
    console.log(`[cron] renewals(${appId}): advanced ${due.length} subscription(s)`);
  } catch (err) {
    console.log(`[cron] renewals(${appId}) failed: ${String(err)}`);
  }
}
