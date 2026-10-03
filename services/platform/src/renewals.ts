// ─────────────────────────────────────────────────────────────────────────────
// Renewals recompute — relocated from subscriptiontracker-api's cron into the platform
// scheduler's per-app fan-out. The date math is a PURE core (unit tested); the
// D1 pass wraps it. Generic over any app DB with subscriptions + payment_history.
// ─────────────────────────────────────────────────────────────────────────────
import type { SqlDb, SqlStatement } from '../../_shared/src/ports/sql';
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

/** The units a cadence is counted in ([ADR no.077] §5.1; 0003's `cycle_unit`). */
export type CycleUnit = 'day' | 'week' | 'month' | 'year';

/** "Every `every` `unit`s". The legacy `cycle` is (1, month) or (1, year). */
export interface Cadence {
  every: number;
  unit: CycleUnit;
}

const CYCLE_UNITS: readonly CycleUnit[] = ['day', 'week', 'month', 'year'];
/**
 * The API's own bound on `cycle_every` (subscriptiontracker-api `MAX_CYCLE_EVERY`).
 * @ceiling none — bounds an input SHAPE (how many units one cycle spans), not a
 * platform resource; the per-run query spend is bounded by the crossings cap.
 */
const MAX_EVERY = 366;

/** A legacy `cycle` value, or a cadence, as the cadence it means. */
function cadenceOfArg(cycle: Cadence | 'monthly' | 'yearly'): Cadence {
  if (cycle === 'monthly') return { every: 1, unit: 'month' };
  if (cycle === 'yearly') return { every: 1, unit: 'year' };
  if (!Number.isSafeInteger(cycle.every) || cycle.every < 1 || cycle.every > MAX_EVERY) {
    throw new RangeError(`renewals: every must be a whole number 1..${MAX_EVERY}: ${JSON.stringify(cycle.every)}`);
  }
  if (!CYCLE_UNITS.includes(cycle.unit)) {
    throw new RangeError(`renewals: not a cycle unit: ${JSON.stringify(cycle.unit)}`);
  }
  return cycle;
}

/**
 * The cadence a stored row bills on, or null when it has none this Worker can
 * roll. `cycle_every` + `cycle_unit` (0003) win; a row that predates them, or an
 * app database that has no such columns, falls back to the legacy `cycle`.
 * Anything else — a unit this build does not know, a zero — is null, and the
 * pass SKIPS the row rather than guessing a month.
 */
export function cadenceOfRow(row: {
  cycle?: string | null;
  cycle_every?: number | null;
  cycle_unit?: string | null;
}): Cadence | null {
  const every = row.cycle_every;
  const unit = row.cycle_unit;
  if (every !== undefined && every !== null && unit !== undefined && unit !== null) {
    if (!Number.isSafeInteger(every) || every < 1 || every > MAX_EVERY) return null;
    if (!(CYCLE_UNITS as readonly string[]).includes(unit)) return null;
    return { every, unit: unit as CycleUnit };
  }
  if (row.cycle === 'monthly') return { every: 1, unit: 'month' };
  if (row.cycle === 'yearly') return { every: 1, unit: 'year' };
  return null;
}

/**
 * Advance a 'YYYY-MM-DD' date by one billing cycle, staying in UTC.
 *
 * ONE RULE, TWO RUNTIMES: `packages/core`'s `RecurrenceSchedule.advance` is the
 * Dart twin, and both are tested against every vector in
 * `contracts/renewals/vectors.json`. Change one and that file reds the other.
 *
 * `day`/`week` add calendar days. `month`/`year` add months and CLAMP:
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
 * of `dateYmd` for a single standalone step. Ignored for `day` and `week`.
 */
export function advance(
  dateYmd: string,
  cycle: Cadence | 'monthly' | 'yearly',
  anchorDay?: number,
): string {
  const { year, month0, day } = parseYmd(dateYmd);
  const { every, unit } = cadenceOfArg(cycle);

  if (unit === 'day' || unit === 'week') {
    const days = unit === 'week' ? every * 7 : every;
    // Date.UTC normalises an overflowing day into the right month and year,
    // which is exactly what adding calendar days means — no clamp applies.
    const d = new Date(Date.UTC(year, month0, day + days));
    return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }

  const anchor = Math.min(Math.max(Math.trunc(anchorDay ?? day), 1), 31);
  const months = unit === 'year' ? every * 12 : every;
  const total = year * 12 + month0 + months;
  const targetYear = Math.floor(total / 12);
  const targetMonth0 = total % 12;
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
 * anchor column (services/subscriptiontracker-api/migrations/0001_init.sql:7-22) — so a 31st
 * subscription whose stored value is the clamped 2026-02-28 comes back as a 28th
 * anchor on the next night's pass. That costs at most three days once a year and
 * never skips a cycle; recovering it fully needs an additive `renewal_anchor_day`
 * column in subscriptiontracker_db, which platform does not own (no `migrations_dir` for
 * SUBSCRIPTIONTRACKER_DB in wrangler.jsonc). Pinned by a test so it stays a known limit.
 */
export function rollForward(
  next: string,
  cycle: Cadence | 'monthly' | 'yearly',
  today: string,
  anchor?: number,
): { next: string; crossings: string[] } {
  const crossings: string[] = [];
  let cur = next;
  const anchorDay = anchor ?? parseYmd(next).day;
  let guard = 0;
  while (cur < today && guard < 240) {
    crossings.push(cur);
    cur = advance(cur, cycle, anchorDay);
    guard++;
  }
  return { next: cur, crossings };
}

/** `payment_history.source` for a row this pass writes (0003's column). */
export const RENEWAL_SOURCE = 'renewal';

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
  db: SqlDb,
  appId: string,
): Promise<{ ok: boolean; detail: string }> {
  const today = todayYmd();
  try {
    // ── THE ROW'S OWN COLUMNS ARE PROBED, LIKE payment_history's BELOW ─────
    // This pass is "generic over any app DB with subscriptions +
    // payment_history", and only subscriptiontracker_db has 0003's cadence and
    // lifecycle columns. A SELECT naming a column the table lacks throws, and a
    // throw here is every renewal of that app missed tonight. So each 0003
    // column is read — and each 0003 filter applied — only where it exists.
    const subColumns = new Set(
      (
        await allRows<{ name: string }>(db.prepare("SELECT name FROM pragma_table_info('subscriptions')"))
      ).map((col) => col.name),
    );
    const hasCadence = subColumns.has('cycle_every') && subColumns.has('cycle_unit');
    const select = ['id', 'user_id', 'price', 'cycle', 'next_renewal'];
    if (hasCadence) select.push('cycle_every', 'cycle_unit');
    if (subColumns.has('currency')) select.push('currency');
    const where = ['next_renewal IS NOT NULL', 'next_renewal < ?'];
    // A row with no cadence at all has nothing to roll by: skipped, as before.
    where.push(
      hasCadence ? '(cycle IS NOT NULL OR (cycle_every IS NOT NULL AND cycle_unit IS NOT NULL))' : 'cycle IS NOT NULL',
    );
    // 🔴 ONLY A ROW THAT IS STILL CHARGING IS ROLLED ([ADR no.077] §5, ST-E3).
    // A paused or cancelled row keeps its history and stops accruing it: rolling
    // one would write a payment for a charge that never happens and move a date
    // the user froze. A soft-deleted row (`deleted_at`) is gone from every list
    // and must not keep "paying" behind the Undo window either.
    if (subColumns.has('status')) where.push("status IN ('active', 'trialing')");
    if (subColumns.has('deleted_at')) where.push('deleted_at IS NULL');
    const due = await allRows<Subscription>(
      db
        .prepare(`SELECT ${select.join(', ')} FROM subscriptions WHERE ${where.join(' AND ')}`)
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
    // 2026-08-25 its column list ended at `paid_at`. subscriptiontracker_db's migration
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
    // the rest down. `updated_at` is subscriptiontracker_db's 0002; the brick's starter schema
    // has no payment_history at all, so a future app's table may legitimately
    // predate the column. An unconditional six-column INSERT would fail the whole
    // nightly batch for that app — every renewal missed, every payment row lost —
    // to write one timestamp. Where the column is missing the write is the same
    // five columns it always was and the heartbeat SAYS SO, so the gap is a
    // number an operator can see rather than a silence.
    const paymentColumns = await allRows<{ name: string }>(
      db.prepare("SELECT name FROM pragma_table_info('payment_history')"),
    );
    const paymentHas = new Set(paymentColumns.map((col) => col.name));
    const hasUpdatedAt = paymentHas.has('updated_at');
    // 0003's `currency` + `source`, written where they exist (ST-E3): a payment
    // is a record of a real charge, so it carries the unit it was charged in
    // rather than borrowing its subscription's at read time — a later currency
    // correction on the row must not relabel the history under it.
    const hasProvenance = paymentHas.has('currency') && paymentHas.has('source');
    const paymentCols = ['id', 'subscription_id', 'user_id', 'amount', 'paid_at'];
    if (hasUpdatedAt) paymentCols.push('updated_at');
    if (hasProvenance) paymentCols.push('currency', 'source');
    const paymentStmt = db.prepare(
      `INSERT INTO payment_history (${paymentCols.join(', ')})
       VALUES (${paymentCols.map(() => '?').join(', ')})`,
    );

    const ops: SqlStatement[] = [];
    let rolled = 0;
    let skipped = 0;
    for (const sub of due) {
      const cadence = cadenceOfRow(sub);
      if (cadence === null) {
        // A unit or count this build cannot read. Left exactly as it is, and
        // COUNTED in the heartbeat detail, never guessed as a month.
        skipped++;
        continue;
      }
      const { next, crossings } = rollForward(sub.next_renewal as string, cadence, today);
      for (const when of crossings) {
        const paidAt = `${when}T00:00:00Z`;
        const values: unknown[] = [uuid(), sub.id, sub.user_id, sub.price ?? null, paidAt];
        if (hasUpdatedAt) values.push(paidAt);
        if (hasProvenance) values.push(sub.currency ?? null, RENEWAL_SOURCE);
        ops.push(paymentStmt.bind(...values));
      }
      ops.push(updateStmt.bind(next, ts, sub.id));
      rolled++;
    }

    // An empty batch is not a statement D1 accepts; a night whose every due
    // row was skipped has nothing to write, and says so in the detail.
    if (ops.length > 0) await db.batch(ops);
    console.log(`[cron] renewals(${appId}): advanced ${rolled} subscription(s)`);
    return {
      ok: true,
      // The counts are the point: "advanced 0 subscription(s)" would be a
      // contradiction against a non-empty `due`, and a night that suddenly
      // advances thousands is worth seeing in the same table as a night that
      // advances three.
      detail:
        `advanced ${rolled} subscription(s), ${ops.length} statement(s)` +
        (skipped > 0 ? ` — SKIPPED ${skipped} with a cadence this build cannot read` : '') +
        (hasUpdatedAt
          ? ''
          : ' — WITHOUT updated_at: this app database has no such column on payment_history, so every row written tonight carries none'),
    };
  } catch (err) {
    console.log(`[cron] renewals(${appId}) failed: ${String(err)}`);
    return { ok: false, detail: String(err) };
  }
}
