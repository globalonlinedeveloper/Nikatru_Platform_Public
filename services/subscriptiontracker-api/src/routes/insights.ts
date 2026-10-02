// ─────────────────────────────────────────────────────────────────────────────
// /v1/insights — the user's charges and price edits over the last 12 months,
// across every plan, in ONE read (ST-P6 trend, round-2 F23; ST-I4 price-rise
// alert, round-2 X09).
//
// GET /v1/subscriptions/:id already serves one plan's payment_history and
// price_history; a trend over every plan would be one request per plan. This
// route is the same two tables, by user and by window, with the same NAMED
// columns, the same currency rule and the same "removed means removed" rule
// (GET /:id 404s a soft-deleted row), so the two readers cannot disagree about
// what a charge was:
//   · payments      — payment_history rows with paid_at in the window, a NULL
//                     currency served in its subscription's (GET /:id's rule:
//                     the fan-out copies the row's price and writes no currency);
//   · price_changes — price_change rows with changed_at in the window.
// Both are of LIVE plans only (`deleted_at IS NULL`): a removed plan's charges
// would otherwise stay in the trend until purgeExpired hard-deleted them, and
// the same past month would show a different total weeks later.
//
// The window is the calendar month 11 months before today (UTC) to now, so a
// client drawing "the last 12 months" has every point it needs and no more.
// Ownership is in the SQL (`user_id = ?`), like every read on this Worker.
// ─────────────────────────────────────────────────────────────────────────────

import { Hono } from 'hono';
import type { AppEnv, Payment, PriceChange } from '../types';
import { allRows, todayYmd } from '../lib/d1';

const app = new Hono<AppEnv>();

/** @ceiling none — the trend's width in calendar months, a product rule and not
 *  a platform resource: two SELECTs run whatever the window is. */
export const INSIGHTS_MONTHS = 12;

/** The first instant of the calendar month `INSIGHTS_MONTHS - 1` months before
 *  [today] ('YYYY-MM-DD'), as the ISO prefix both tables' timestamps sort by. */
export function windowStart(today: string): string {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7)); // 1..12
  const first = new Date(Date.UTC(y, m - 1 - (INSIGHTS_MONTHS - 1), 1));
  return first.toISOString().slice(0, 10);
}

// GET /
app.get('/', async (c) => {
  const userId = c.get('userId');
  const since = windowStart(todayYmd());

  const payments = await allRows<Payment>(
    c.env.APP_DB.prepare(
      `SELECT p.id, p.subscription_id, p.user_id, p.amount, p.paid_at, p.updated_at,
              COALESCE(p.currency, s.currency) AS currency, p.source
         FROM payment_history p
         JOIN subscriptions s
           ON s.id = p.subscription_id AND s.user_id = p.user_id
          AND s.deleted_at IS NULL
         WHERE p.user_id = ? AND p.paid_at >= ?
         ORDER BY p.paid_at DESC`,
    ).bind(userId, since),
  );

  const priceChanges = await allRows<PriceChange>(
    c.env.APP_DB.prepare(
      `SELECT id, subscription_id, old_price, new_price, old_price_minor,
              new_price_minor, old_currency, new_currency, changed_at
         FROM price_change pc
         WHERE pc.user_id = ? AND pc.changed_at >= ?
           AND EXISTS (SELECT 1 FROM subscriptions s
                        WHERE s.id = pc.subscription_id AND s.user_id = pc.user_id
                          AND s.deleted_at IS NULL)
         ORDER BY changed_at DESC`,
    ).bind(userId, since),
  );

  return c.json({ since, payments, price_changes: priceChanges });
});

export default app;
