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
  id: string | null;
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

/**
 * Enough headroom for any real budget; low enough to bound one batch.
 *
 * @ceiling d1.queriesPerInvocation lte
 * @ceiling-exceeds SURFACED 2026-08-01 BY [4]B-6, NOT INTRODUCED BY IT. The replace below is one DELETE plus one INSERT per category in a single `APP_DB.batch()`, so a full body asks for MAX_CATEGORIES + 1 = 201 statements against D1's documented Free ceiling of 50 queries per Worker invocation — under the per-statement reading of that ceiling's recorded ambiguity. It has never fired: no real budget carries 200 categories, and the atomic-replace shape this cap protects is itself a fix for a worse defect (a non-atomic DELETE-then-INSERT that could empty the table on a duplicate name). Lowering it is a PRODUCT decision about Subly's budget screen, not a platform one, and making it here would silently change a user-facing limit inside a ceilings-register change; chunking the batch instead needs a partial-failure policy that would be the second one in this repo. Routed rather than decided, and printed on every run so it cannot go quiet again. 🔄 APPENDED 2026-08-25 — the invocation now issues ONE further statement BEFORE the batch: a `SELECT id, name, cap FROM budget_categories WHERE user_id = ?` that lets each category keep its surrogate id across a replace. The BATCH is unchanged at MAX_CATEGORIES + 1; the full-body invocation is 202 queries rather than 201, against the same recorded ambiguity in the same ceiling. The count moved by one and the argument above did not move at all.
 */
const MAX_CATEGORIES = 200;
/** @ceiling none — one category name's width. An input shape, not a resource. */
const MAX_NAME_LENGTH = 120;
/** @ceiling none — one surrogate id's width. A UUIDv7 is 36 characters; the
 *  headroom is for the hex ids 0002_schema_debt.sql backfilled legacy rows with.
 *  An input shape, not a platform resource. */
const MAX_ID_LENGTH = 64;

type ValidatedCategory = { id: string | null; name: string; cap: number };
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
  const seenIds = new Set<string>();
  for (let i = 0; i < list.length; i++) {
    const item = list[i] as unknown;
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      return { ok: false, detail: `categories[${i}] must be an object` };
    }
    const { name, cap, id } = item as { name?: unknown; cap?: unknown; id?: unknown };
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

    // ── THE SURROGATE id, WHEN THE CALLER ROUND-TRIPS ONE ─────────────────────
    // Optional: no released client sends one yet (apps/subly's BudgetCap.toJson
    // emits name + cap only), so requiring it would break the shipped app. When
    // it IS sent it is what makes a rename an EDIT instead of a delete+create,
    // which is the whole thing 0002_schema_debt.sql bought.
    let categoryId: string | null = null;
    if (id !== undefined && id !== null) {
      if (typeof id !== 'string' || id.trim() === '') {
        return { ok: false, detail: `categories[${i}].id must be a non-empty string when present` };
      }
      if (id.length > MAX_ID_LENGTH) {
        return { ok: false, detail: `categories[${i}].id exceeds ${MAX_ID_LENGTH} characters` };
      }
      // `idx_budget_categories_id` is a UNIQUE index. Left to the database a
      // repeated id fails the INSERT *inside the batch* — which rolls back
      // correctly, but answers 500 and says nothing about which value was wrong.
      // Same argument as the duplicate-name check above, same place.
      if (seenIds.has(id)) {
        return { ok: false, detail: `categories[${i}].id duplicates "${id}"` };
      }
      seenIds.add(id);
      categoryId = id;
    }

    categories.push({ id: categoryId, name, cap });
  }

  return { ok: true, monthlyBudget, categories };
}

// GET / — returns defaults when nothing is stored yet.
app.get('/', async (c) => {
  const userId = c.get('userId');

  const budget = await firstRow<BudgetRow>(
    c.env.APP_DB.prepare('SELECT * FROM budgets WHERE user_id = ?').bind(userId),
  );
  // ── `id` IS SELECTED, AND THAT IS THE POINT ────────────────────────────────
  // 0002_schema_debt.sql added this column, backfilled it and put a partial
  // UNIQUE index on it so "the row is unaddressable as (entity, row_id)" would
  // stop being true. Until 2026-08-25 this SELECT named `name, cap` only, so the
  // id never left the database: a column paid for by a migration, maintained by
  // an index, written on every save, and read by NOTHING in any language. A
  // caller cannot address a row it has never been told the address of.
  const categories = await allRows<CategoryRow>(
    c.env.APP_DB.prepare(
      'SELECT id, name, cap FROM budget_categories WHERE user_id = ? ORDER BY name ASC',
    ).bind(userId),
  );

  return c.json({
    monthly_budget: budget?.monthly_budget ?? 0,
    categories: categories.map((r) => ({ id: r.id, name: r.name, cap: r.cap })),
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

  // ── THE ADDRESS SURVIVES THE REPLACE ───────────────────────────────────────
  // 🔴 A FRESH uuid() PER CATEGORY PER SAVE MADE THE COLUMN MEANINGLESS. This
  // route is a REPLACE — one DELETE-all plus one INSERT per category — so before
  // 2026-08-25 every category got a brand-new id on every PUT, including a PUT
  // that changed nothing. 0002_schema_debt.sql's stated purpose is that
  // "renaming a category would read as delete+create rather than an edit"; an id
  // that is rotated on every write reads as delete+create for a rename AND for a
  // no-op, which is the same state the migration was written to leave.
  //
  // So the id is resolved, in this order:
  //   1. the id the CALLER round-tripped for that category — the only thing that
  //      can survive a RENAME, because after a rename the name is gone;
  //   2. the id the row with that name already has — which keeps an unchanged
  //      category at a stable address for the clients that send no id yet;
  //   3. a new uuid, for a category that genuinely did not exist before.
  // (1) is why GET returns `id` at all; without a read there is nothing to
  // round-trip and only (3) can ever apply.
  const existing = await allRows<CategoryRow>(
    c.env.APP_DB.prepare(
      'SELECT id, name, cap FROM budget_categories WHERE user_id = ?',
    ).bind(userId),
  );
  const idByName = new Map<string, string>();
  for (const row of existing) if (row.id) idByName.set(row.name, row.id);
  const resolved = categories.map((cat) => ({
    ...cat,
    id: cat.id ?? idByName.get(cat.name) ?? uuid(),
  }));

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
    ...resolved.map((cat) => insert.bind(userId, cat.name, cat.cap, cat.id)),
  ]);

  return c.json({
    monthly_budget: monthlyBudget,
    categories: resolved,
  });
});

export default app;
