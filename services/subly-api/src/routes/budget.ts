// ─────────────────────────────────────────────────────────────────────────────
// /v1/budget — monthly budget + per-category caps for the current user.
// ─────────────────────────────────────────────────────────────────────────────

import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { allRows, firstRow, nowIso, uuid } from '../lib/d1';

const app = new Hono<AppEnv>();

interface BudgetRow {
  user_id: string;
  monthly_budget: number | null;
  updated_at: string | null;
}
interface CategoryRow {
  user_id: string;
  name: string;
  cap: number | null;
}
// ─────────────────────────────────────────────────────────────────────────────
// PUT / is a REPLACE, so it deletes before it inserts. Two things that were
// wrong about that, both of which destroyed data:
//
//   1. NOTHING WAS VALIDATED. `body.categories` is *typed* as an array of
//      {name, cap}, but a type annotation is not a runtime check on a public
//      HTTP body. `{"categories":"abc"}` passes `.length > 0` and then throws on
//      `.map`; `[{"name":"Music"}]` binds `undefined`, which D1 rejects. Either
//      way the throw lands AFTER the DELETE, and index.ts turns it into a
//      generic 500 that says nothing about the loss.
//   2. THE REPLACE WAS NOT ATOMIC. `run(DELETE)` then `batch(INSERTs)` are two
//      independent D1 round-trips. Nothing rolls the DELETE back — including for
//      a perfectly well-typed body with a DUPLICATE category name, which
//      violates `PRIMARY KEY (user_id, name)` inside the batch and rolls back
//      only the inserts. That one is reachable from a first-party client.
//
// So: validate the whole body first and return 400 before touching a row, then
// issue the DELETE and every INSERT as ONE `APP_DB.batch([...])`, which D1 runs
// as a single implicit transaction. Duplicate names are rejected in validation
// rather than left to the primary key, so the caller gets a 400 that names the
// problem instead of a 500 plus an empty table.
// ─────────────────────────────────────────────────────────────────────────────

/** Enough headroom for any real budget; low enough to bound one batch. */
const MAX_CATEGORIES = 200;
const MAX_NAME_LENGTH = 120;

type ValidatedCategory = { name: string; cap: number };
type Validated =
  | { ok: true; monthlyBudget: number; categories: ValidatedCategory[] }
  | { ok: false; detail: string };

/** Full-body validation. Returns a 400 detail string instead of throwing, so no
 *  code path can reach a write with an unchecked value. */
function validate(body: unknown): Validated {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, detail: 'body must be a JSON object' };
  }
  const raw = body as { monthly_budget?: unknown; categories?: unknown };

  let monthlyBudget = 0;
  if (raw.monthly_budget !== undefined && raw.monthly_budget !== null) {
    if (typeof raw.monthly_budget !== 'number' || !Number.isFinite(raw.monthly_budget)) {
      return { ok: false, detail: 'monthly_budget must be a finite number' };
    }
    if (raw.monthly_budget < 0) {
      return { ok: false, detail: 'monthly_budget must not be negative' };
    }
    monthlyBudget = raw.monthly_budget;
  }

  const list = raw.categories;
  if (list === undefined || list === null) {
    return { ok: true, monthlyBudget, categories: [] };
  }
  if (!Array.isArray(list)) {
    return { ok: false, detail: 'categories must be an array' };
  }
  if (list.length > MAX_CATEGORIES) {
    return {
      ok: false,
      detail: `categories has ${list.length} entries, the maximum is ${MAX_CATEGORIES}`,
    };
  }

  const categories: ValidatedCategory[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < list.length; i++) {
    const item = list[i] as unknown;
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      return { ok: false, detail: `categories[${i}] must be an object` };
    }
    const { name, cap } = item as { name?: unknown; cap?: unknown };
    if (typeof name !== 'string' || name.trim() === '') {
      return { ok: false, detail: `categories[${i}].name must be a non-empty string` };
    }
    if (name.length > MAX_NAME_LENGTH) {
      return {
        ok: false,
        detail: `categories[${i}].name exceeds ${MAX_NAME_LENGTH} characters`,
      };
    }
    if (typeof cap !== 'number' || !Number.isFinite(cap)) {
      return { ok: false, detail: `categories[${i}].cap must be a finite number` };
    }
    if (cap < 0) {
      return { ok: false, detail: `categories[${i}].cap must not be negative` };
    }
    // (user_id, name) is the PRIMARY KEY. Left to the database this surfaces as
    // a failed batch AFTER the delete — the exact wipe this route is fixing.
    if (seen.has(name)) {
      return { ok: false, detail: `categories[${i}].name duplicates "${name}"` };
    }
    seen.add(name);
    categories.push({ name, cap });
  }

  return { ok: true, monthlyBudget, categories };
}

// GET / — returns defaults when nothing is stored yet.
app.get('/', async (c) => {
  const userId = c.get('userId');

  const budget = await firstRow<BudgetRow>(
    c.env.APP_DB.prepare('SELECT * FROM budgets WHERE user_id = ?').bind(userId),
  );
  const categories = await allRows<CategoryRow>(
    c.env.APP_DB.prepare(
      'SELECT name, cap FROM budget_categories WHERE user_id = ? ORDER BY name ASC',
    ).bind(userId),
  );

  return c.json({
    monthly_budget: budget?.monthly_budget ?? 0,
    categories: categories.map((r) => ({ name: r.name, cap: r.cap })),
  });
});

// PUT / — upsert monthly_budget and replace the category set.
app.put('/', async (c) => {
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
  const { monthlyBudget, categories } = checked;

  const ts = nowIso();

  // ── ONE BATCH = ONE IMPLICIT TRANSACTION ───────────────────────────────────
  // The DELETE must not be able to commit without its replacement inserts.
  const insert = c.env.APP_DB.prepare(
    // `id` is the surrogate addressing key added by 0002_schema_debt.sql; that
    // migration's contract is that NEW rows carry a client-generated id, so
    // writing NULL here would re-open the unaddressable-row gap it paid down.
    'INSERT INTO budget_categories (user_id, name, cap, id) VALUES (?, ?, ?, ?)',
  );
  await c.env.APP_DB.batch([
    c.env.APP_DB.prepare(
      `INSERT INTO budgets (user_id, monthly_budget, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         monthly_budget = excluded.monthly_budget,
         updated_at = excluded.updated_at`,
    ).bind(userId, monthlyBudget, ts),
    c.env.APP_DB.prepare(
      'DELETE FROM budget_categories WHERE user_id = ?',
    ).bind(userId),
    ...categories.map((cat) => insert.bind(userId, cat.name, cat.cap, uuid())),
  ]);

  return c.json({
    monthly_budget: monthlyBudget,
    categories,
  });
});

export default app;
