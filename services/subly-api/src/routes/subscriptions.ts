// ─────────────────────────────────────────────────────────────────────────────
// /v1/subscriptions — user-scoped CRUD. All rows are keyed by c.get('userId').
// JSON is snake_case matching the DB columns; `unused` (0/1) serializes to bool.
// ─────────────────────────────────────────────────────────────────────────────

import { Hono } from 'hono';
import type { AppEnv, Payment, Subscription } from '../types';
import { allRows, firstRow, nowIso, run, uuid } from '../lib/d1';
import {
  isBoundedString,
  isCalendarDate,
  isFiniteNumber,
  isPlainObject,
  type Invalid,
} from '../lib/validate';

const app = new Hono<AppEnv>();

/** DB row -> API JSON (0/1 `unused` becomes a real boolean). */
function serializeSubscription(row: Subscription) {
  return {
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
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// VALIDATION — same shape as routes/budget.ts's `validate`: check the WHOLE body
// and return a 400 `detail`, never throw, and never let an unchecked value reach
// a bind.
//
// The `CreateBody` interface that used to stand here was deleted, not updated:
// it was the whole "validation" this route had, and a TS interface is erased
// before the request exists. Keeping it next to a real validator would only
// invite the next reader to trust it again.
//
// What was actually reachable before, all of it a 500 with no useful message:
//
//   · `JSON.parse('null')`/`'"x"'`/`'[]'` — a non-object body. `body.unused`
//     threw a TypeError on null before any check ran.
//   · `{"price":{}}` / `{"name":[]}` — an object bound straight into D1, which
//     answers D1_TYPE_ERROR. On PATCH that happens AFTER the ownership read, so
//     the caller cannot tell "not yours" from "bad value".
//   · `{"cycle":"weekly"}` — violates the `CHECK (cycle IN ('monthly','yearly'))`
//     in 0001_init.sql, so the DATABASE rejected it as a 500 rather than the
//     route rejecting it as a 400.
//   · `{"next_renewal":"soon"}` — accepted and stored. /v1/renewals compares
//     next_renewal as a STRING, so the row silently never appears in any renewal
//     window: a subscription the user is still paying for, invisible forever.
//   · unbounded strings — a megabyte `usage_note` per row, per user.
// ─────────────────────────────────────────────────────────────────────────────

/** Bounds. Generous enough for any real subscription, small enough to bound a row.
 *
 *  All five are COLUMN WIDTHS on one row of one INSERT — input shapes, not
 *  platform resources. The resource they touch is D1's maximum row size, whose
 *  ceiling is 2 MB; their sum is under 1.6 KB, three orders of magnitude below
 *  it, so none of them can ever be the binding constraint. */
/** @ceiling none — column width; see the block above. */
const MAX_NAME = 200;
/** @ceiling none — column width; see the block above. */
const MAX_CATEGORY = 120;
/** @ceiling none — column width; see the block above. */
const MAX_PLAN = 200;
/** @ceiling none — column width; an emoji or short token, not a field. */
const MAX_GLYPH = 32;
/** @ceiling none — column width; see the block above. */
const MAX_NOTE = 1000;
/**
 * Upper bound on `price`. Deliberately generous: Subly stores a bare number with
 * NO currency, and the app ships to six platforms worldwide — a real yearly
 * subscription is ~2 600 000 in VND and ~1 800 000 in IDR, so a "sensible"
 * 1 000 000 cap would 400 legitimate first-party traffic in those markets. The
 * bound exists to keep a typo out of a REAL column and to keep the value well
 * inside exact-integer range, not to police what a subscription may cost.
 *
 * @ceiling none — a VALUE bound on one numeric column, not a resource bound. Its
 * real right-hand side is Number.MAX_SAFE_INTEGER, a language limit.
 */
const MAX_PRICE = 1_000_000_000;

/** Columns this route will write, and the checked value for each. */
type Column =
  | 'name'
  | 'category'
  | 'price'
  | 'cycle'
  | 'next_renewal'
  | 'plan'
  | 'glyph'
  | 'used_pct'
  | 'usage_note'
  | 'unused';

/** Only the keys the body actually carried — PATCH must not touch the others. */
type Fields = Partial<Record<Column, string | number | null>>;

type ValidatedSubscription = { ok: true; fields: Fields } | Invalid;

/** Nullable free-text columns and their length caps. */
const TEXT_COLUMNS: ReadonlyArray<readonly [Column, number]> = [
  ['name', MAX_NAME],
  ['category', MAX_CATEGORY],
  ['plan', MAX_PLAN],
  ['glyph', MAX_GLYPH],
  ['usage_note', MAX_NOTE],
];

/**
 * Full-body validation shared by POST and PATCH. Returns the CHECKED value for
 * every key the body carried (explicit `null` is kept — it clears the column),
 * or a 400 detail string. Absent keys are absent from the result, which is what
 * lets PATCH stay a partial update without re-deriving the rules.
 */
function validate(body: unknown): ValidatedSubscription {
  if (!isPlainObject(body)) {
    return { ok: false, detail: 'body must be a JSON object' };
  }
  const fields: Fields = {};

  for (const [col, max] of TEXT_COLUMNS) {
    const v = body[col];
    if (v === undefined) continue;
    if (v === null) {
      fields[col] = null;
      continue;
    }
    if (!isBoundedString(v, max)) {
      return {
        ok: false,
        detail: `${col} must be a string of at most ${max} characters`,
      };
    }
    fields[col] = v;
  }

  const price = body.price;
  if (price !== undefined) {
    if (price === null) {
      fields.price = null;
    } else if (!isFiniteNumber(price) || price < 0 || price > MAX_PRICE) {
      return {
        ok: false,
        detail: `price must be a finite number between 0 and ${MAX_PRICE}`,
      };
    } else {
      fields.price = price;
    }
  }

  const cycle = body.cycle;
  if (cycle !== undefined) {
    if (cycle === null) {
      fields.cycle = null;
    } else if (cycle !== 'monthly' && cycle !== 'yearly') {
      // 0001_init.sql: CHECK (cycle IN ('monthly','yearly')). Enforced here so
      // the caller gets a 400 that names the field instead of a D1 500.
      return { ok: false, detail: "cycle must be 'monthly' or 'yearly'" };
    } else {
      fields.cycle = cycle;
    }
  }

  const renewal = body.next_renewal;
  if (renewal !== undefined) {
    if (renewal === null) {
      fields.next_renewal = null;
    } else if (!isCalendarDate(renewal)) {
      return {
        ok: false,
        detail: 'next_renewal must be a real calendar date as YYYY-MM-DD',
      };
    } else {
      fields.next_renewal = renewal;
    }
  }

  const usedPct = body.used_pct;
  if (usedPct !== undefined) {
    if (usedPct === null) {
      fields.used_pct = null;
    } else if (!isFiniteNumber(usedPct) || usedPct < 0 || usedPct > 100) {
      return { ok: false, detail: 'used_pct must be a number between 0 and 100' };
    } else {
      // The column is INTEGER and the client sends an int; truncating keeps a
      // stray float out of an integer column rather than relying on affinity.
      fields.used_pct = Math.trunc(usedPct);
    }
  }

  const unused = body.unused;
  if (unused !== undefined) {
    // `null` clears, exactly as it does for every other nullable column above —
    // an explicit null meaning "clear" for `price` but 400 for `unused` would be
    // a rule nobody can remember. The column is nullable with DEFAULT 0.
    if (unused === null) {
      fields.unused = null;
    } else if (typeof unused !== 'boolean' && unused !== 0 && unused !== 1) {
      return { ok: false, detail: 'unused must be a boolean' };
    } else {
      fields.unused = unused === true || unused === 1 ? 1 : 0;
    }
  }

  return { ok: true, fields };
}

// GET / — list, most expensive first.
app.get('/', async (c) => {
  const userId = c.get('userId');
  const rows = await allRows<Subscription>(
    c.env.APP_DB.prepare(
      'SELECT * FROM subscriptions WHERE user_id = ? ORDER BY price DESC',
    ).bind(userId),
  );
  return c.json(rows.map(serializeSubscription));
});

// POST / — create.
app.post('/', async (c) => {
  const userId = c.get('userId');
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }

  // ── VALIDATE FIRST — nothing below this line may touch a row otherwise ──────
  const checked = validate(body);
  if (!checked.ok) {
    return c.json({ error: 'invalid_body', detail: checked.detail }, 400);
  }
  const f = checked.fields;

  const id = uuid();
  const ts = nowIso();

  await run(
    c.env.APP_DB.prepare(
      `INSERT INTO subscriptions
         (id, user_id, name, category, price, cycle, next_renewal, plan, glyph,
          used_pct, usage_note, unused, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      id,
      userId,
      f.name ?? null,
      f.category ?? null,
      f.price ?? null,
      f.cycle ?? null,
      f.next_renewal ?? null,
      f.plan ?? null,
      f.glyph ?? null,
      f.used_pct ?? 0,
      f.usage_note ?? null,
      f.unused ?? 0,
      ts,
      ts,
    ),
  );

  const row = await firstRow<Subscription>(
    c.env.APP_DB.prepare('SELECT * FROM subscriptions WHERE id = ?').bind(id),
  );
  return c.json(row ? serializeSubscription(row) : { error: 'not_found' }, 201);
});

// GET /:id — one subscription (must be owned) + its payment history.
app.get('/:id', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');

  const row = await firstRow<Subscription>(
    c.env.APP_DB.prepare(
      'SELECT * FROM subscriptions WHERE id = ? AND user_id = ?',
    ).bind(id, userId),
  );
  if (!row) return c.json({ error: 'not_found' }, 404);

  const payments = await allRows<Payment>(
    c.env.APP_DB.prepare(
      `SELECT * FROM payment_history
         WHERE subscription_id = ? AND user_id = ?
         ORDER BY paid_at DESC`,
    ).bind(id, userId),
  );

  return c.json({
    ...serializeSubscription(row),
    payment_history: payments,
  });
});

// PATCH /:id — update a whitelisted set of fields.
app.patch('/:id', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }

  // ── VALIDATE BEFORE THE OWNERSHIP READ ─────────────────────────────────────
  // Order matters for the CALLER, not for safety: a bad value that only failed
  // at the bind produced a 500 after the 404 check, so "not yours" and "bad
  // value" were indistinguishable from the outside.
  const checked = validate(body);
  if (!checked.ok) {
    return c.json({ error: 'invalid_body', detail: checked.detail }, 400);
  }

  // Ownership check up front.
  const existing = await firstRow<Subscription>(
    c.env.APP_DB.prepare(
      'SELECT id FROM subscriptions WHERE id = ? AND user_id = ?',
    ).bind(id, userId),
  );
  if (!existing) return c.json({ error: 'not_found' }, 404);

  const sets: string[] = [];
  const values: unknown[] = [];
  const put = (col: string, val: unknown) => {
    sets.push(`${col} = ?`);
    values.push(val);
  };

  // Only the columns the body actually carried — `validate` drops the rest, so
  // this cannot widen to a column the validator has not checked.
  for (const [col, val] of Object.entries(checked.fields)) put(col, val);

  put('updated_at', nowIso());

  values.push(id, userId);
  await run(
    c.env.APP_DB.prepare(
      `UPDATE subscriptions SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`,
    ).bind(...values),
  );

  const row = await firstRow<Subscription>(
    c.env.APP_DB.prepare('SELECT * FROM subscriptions WHERE id = ?').bind(id),
  );
  return c.json(row ? serializeSubscription(row) : { error: 'not_found' });
});

// DELETE /:id — cancel/remove.
app.delete('/:id', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  await run(
    c.env.APP_DB.prepare(
      'DELETE FROM subscriptions WHERE id = ? AND user_id = ?',
    ).bind(id, userId),
  );
  return c.json({ ok: true });
});

export default app;
