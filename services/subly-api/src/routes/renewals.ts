// ─────────────────────────────────────────────────────────────────────────────
// /v1/renewals — subscriptions renewing within N days, ascending, with days_left.
// ─────────────────────────────────────────────────────────────────────────────

import { Hono } from 'hono';
import type { AppEnv, Subscription } from '../types';
import { allRows, todayYmd } from '../lib/d1';

const app = new Hono<AppEnv>();

/** Whole-day difference between two 'YYYY-MM-DD' dates (b - a), UTC. */
function daysBetween(a: string, b: string): number {
  const ms =
    Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

// ─────────────────────────────────────────────────────────────────────────────
// `withinDays` had a FLOOR and no CEILING: `Math.max(0, Math.trunc(Number(raw)))`
// clamps the bottom and lets the top run to 1e308. The window is then turned into
// a date — `new Date(today + withinDays * 86_400_000).toISOString()` — and past
// roughly 1e11 days that Date is Invalid and `.toISOString()` THROWS a RangeError,
// which index.ts serves as a generic 500. `?withinDays=1e15` is a one-character
// typo away from a normal request, so this needs no attacker.
//
// A bound also has to exist for the query to mean anything: `next_renewal <= ?`
// with a year-275760 upper bound is "every row this user has", which is not a
// renewals view.
//
// Default (absent or empty) stays 7. Anything present but unusable is a 400 that
// NAMES the problem rather than a silent coercion to 0 or 7 — a garbage window
// answered with a plausible-looking list is the same class of quiet wrongness
// the rest of this change is about.
// ─────────────────────────────────────────────────────────────────────────────

/** ~10 years. Far past any renewal horizon; bounds the date arithmetic. */
const MAX_WITHIN_DAYS = 3660;
const DEFAULT_WITHIN_DAYS = 7;

// GET /?withinDays=7
app.get('/', async (c) => {
  const userId = c.get('userId');
  const withinDaysRaw = c.req.query('withinDays');

  let withinDays = DEFAULT_WITHIN_DAYS;
  if (withinDaysRaw !== undefined && withinDaysRaw !== '') {
    const n = Number(withinDaysRaw);
    if (!Number.isFinite(n)) {
      return c.json(
        { error: 'invalid_query', detail: 'withinDays must be a number' },
        400,
      );
    }
    const days = Math.trunc(n);
    if (days < 0 || days > MAX_WITHIN_DAYS) {
      return c.json(
        {
          error: 'invalid_query',
          detail: `withinDays must be between 0 and ${MAX_WITHIN_DAYS}`,
        },
        400,
      );
    }
    withinDays = days;
  }

  const today = todayYmd();
  const until = new Date(Date.parse(`${today}T00:00:00Z`) + withinDays * 86_400_000)
    .toISOString()
    .slice(0, 10);

  const rows = await allRows<Subscription>(
    c.env.APP_DB.prepare(
      `SELECT * FROM subscriptions
         WHERE user_id = ?
           AND next_renewal IS NOT NULL
           AND next_renewal >= ?
           AND next_renewal <= ?
         ORDER BY next_renewal ASC`,
    ).bind(userId, today, until),
  );

  const out = rows.map((row) => ({
    id: row.id,
    user_id: row.user_id,
    name: row.name,
    category: row.category,
    price: row.price,
    cycle: row.cycle,
    next_renewal: row.next_renewal,
    plan: row.plan,
    glyph: row.glyph,
    used_pct: row.used_pct,
    usage_note: row.usage_note,
    unused: row.unused === 1,
    created_at: row.created_at,
    updated_at: row.updated_at,
    days_left: row.next_renewal ? daysBetween(today, row.next_renewal) : null,
  }));

  return c.json(out);
});

export default app;
