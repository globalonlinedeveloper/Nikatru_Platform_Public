// ─────────────────────────────────────────────────────────────────────────────
// /v1/budget — monthly budget + per-category caps for the current user.
// ─────────────────────────────────────────────────────────────────────────────

import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { allRows, batchIdempotent, firstRow, nowIso, uuid } from '../lib/d1';
import { CURRENCY, MAX_PRICE } from './subscriptions';

const app = new Hono<AppEnv>();

interface BudgetRow {
  user_id: string;
  monthly_budget: number | null;
  updated_at: string | null;
  currency: string | null; // 0007: ISO 4217, upper case; NULL = the user's currency
}
interface CategoryRow {
  user_id: string;
  name: string;
  cap: number | null;
  id: string | null;
  category_id: string | null; // 0005 (ST-X8): the `categories` row this cap is for
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

type ValidatedCategory = { id: string | null; name: string; cap: number; categoryId: string | null };
/** `currency` as the body sent it: ABSENT leaves the stored code alone, `null`
 *  clears it back to "the user's currency", a code sets it. */
type CurrencyChange = { set: false } | { set: true; value: string | null };
type Validated =
  | { ok: true; monthlyBudget: number; currency: CurrencyChange; categories: ValidatedCategory[] }
  | { ok: false; detail: string };

/** Full-body validation. Returns a 400 detail string instead of throwing, so no
 *  code path can reach a write with an unchecked value. */
function validate(body: unknown): Validated {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, detail: 'body must be a JSON object' };
  }
  const raw = body as { monthly_budget?: unknown; currency?: unknown; categories?: unknown };

  // ── AN AMOUNT IS BOUNDED, NOT JUST FINITE (rv2-services 032) ──────────────
  // "Finite and ≥ 0" stored 1.7e308 in a REAL column and served it back to
  // every client that renders a budget. MAX_PRICE is the bound a subscription's
  // price already has (routes/subscriptions.ts): a budget is an amount of the
  // same money, so it gets the same ceiling rather than a second opinion.
  let monthlyBudget = 0;
  if (raw.monthly_budget !== undefined && raw.monthly_budget !== null) {
    if (typeof raw.monthly_budget !== 'number' || !Number.isFinite(raw.monthly_budget)) {
      return { ok: false, detail: 'monthly_budget must be a finite number' };
    }
    if (raw.monthly_budget < 0) {
      return { ok: false, detail: 'monthly_budget must not be negative' };
    }
    if (raw.monthly_budget > MAX_PRICE) {
      return { ok: false, detail: `monthly_budget must not exceed ${MAX_PRICE}` };
    }
    monthlyBudget = raw.monthly_budget;
  }

  // ── THE BUDGET'S CURRENCY (0007) ──────────────────────────────────────────
  // ⚠️ THE MINIMAL VALID-CODE CHECK, NOT THE ISO 4217 SET: three letters,
  // stored upper case — the rule subscriptions.ts `CURRENCY` applies to a
  // subscription's currency, imported so the two cannot disagree. Checking
  // membership of the assigned set is lane fix-st-api-bounds' contracts table;
  // when it lands, both routes move to it together.
  //
  // ABSENT IS NOT NULL. The app's BudgetInfo.toJson sends `currency` only when
  // it KNOWS the budget's unit, and omits it for a figure that arrived bare —
  // as does any build older than that field. Treating a missing `currency` as
  // "clear it" would let such a save wipe the code another device set. Absent
  // leaves the stored code alone; an explicit `null` clears it.
  let currency: CurrencyChange = { set: false };
  if (raw.currency !== undefined) {
    if (raw.currency === null) {
      currency = { set: true, value: null };
    } else if (typeof raw.currency !== 'string' || !CURRENCY.test(raw.currency)) {
      return { ok: false, detail: 'currency must be a three-letter ISO 4217 code, e.g. INR, or null' };
    } else {
      currency = { set: true, value: raw.currency.toUpperCase() };
    }
  }

  const list = raw.categories;
  if (list === undefined || list === null) {
    return { ok: true, monthlyBudget, currency, categories: [] };
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
  const seenCats = new Set<string>();
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
    // A cap is part of the budget, in the budget's currency: same bound.
    if (cap > MAX_PRICE) {
      return { ok: false, detail: `categories[${i}].cap must not exceed ${MAX_PRICE}` };
    }
    // (user_id, name) is the PRIMARY KEY. Left to the database this surfaces as
    // a failed batch AFTER the delete — the exact wipe this route is fixing.
    if (seen.has(name)) {
      return { ok: false, detail: `categories[${i}].name duplicates "${name}"` };
    }
    seen.add(name);

    // ── THE SURROGATE id, WHEN THE CALLER ROUND-TRIPS ONE ─────────────────────
    // Optional: no released client sends one yet (apps/subscriptiontracker's BudgetCap.toJson
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

    // ── THE CATEGORY THE CAP IS FOR, BY ID (0005, ST-X8) ──────────────────────
    // Optional, like `id`: the shipped app sends names only, and those resolve
    // by name in PUT. Its shape is checked here; that it names a category this
    // user can use needs the read PUT already makes.
    const catRef = (item as { category_id?: unknown }).category_id;
    let catId: string | null = null;
    if (catRef !== undefined && catRef !== null) {
      if (typeof catRef !== 'string' || catRef === '' || catRef.length > MAX_ID_LENGTH) {
        return { ok: false, detail: `categories[${i}].category_id must be a category id of at most ${MAX_ID_LENGTH} characters` };
      }
      if (seenCats.has(catRef)) {
        return { ok: false, detail: `categories[${i}].category_id duplicates "${catRef}": one cap per category` };
      }
      seenCats.add(catRef);
      catId = catRef;
    }

    categories.push({ id: categoryId, name, cap, categoryId: catId });
  }

  return { ok: true, monthlyBudget, currency, categories };
}

// GET / — returns defaults when nothing is stored yet. `currency` is NULL until
// a client sets one, and NULL means the user's own currency: the unit every
// budget saved before 0007 was typed in.
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
  // `category_id` (0005, ST-X8) is what a client keys a cap by, so a renamed
  // category keeps its cap and a built-in can be shown in the user's language.
  const categories = await allRows<CategoryRow>(
    c.env.APP_DB.prepare(
      'SELECT id, name, cap, category_id FROM budget_categories WHERE user_id = ? ORDER BY name ASC',
    ).bind(userId),
  );

  return c.json({
    monthly_budget: budget?.monthly_budget ?? 0,
    currency: budget?.currency ?? null,
    categories: categories.map((r) => ({ id: r.id, name: r.name, cap: r.cap, category_id: r.category_id })),
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
  const { monthlyBudget, currency, categories } = checked;

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
  //
  // ── …AND THE SAME READ RESOLVES EACH CAP'S CATEGORY (0005, ST-X8) ──────────
  // One UNION, not a second SELECT: the statement count this route's ceiling
  // note above measures (202 at a full body) does not move. `kind` says which
  // table a row came from; `cap` is NULL on a category row.
  //   · a cap that sends `category_id` must name a built-in or one of this
  //     user's own (400 otherwise), and is stored under THAT category's name —
  //     so a cap keyed by id survives a rename that changed the name;
  //   · a cap that sends only a name — the shipped app — is matched by name,
  //     a built-in first; a name no category has keeps no id, as before.
  const existing = await allRows<CategoryRow & { kind: 'cap' | 'category'; builtin: number | null }>(
    c.env.APP_DB.prepare(
      `SELECT 'cap' AS kind, id, name, cap, category_id, NULL AS builtin
         FROM budget_categories WHERE user_id = ?
       UNION ALL
       SELECT 'category' AS kind, id, name, NULL AS cap, NULL AS category_id, builtin
         FROM categories WHERE user_id IS NULL OR user_id = ?`,
    ).bind(userId, userId),
  );
  const idByName = new Map<string, string>();
  const nameByCategory = new Map<string, string>();
  const categoryByName = new Map<string, string>();
  for (const row of existing) {
    if (row.kind === 'cap') {
      if (row.id) idByName.set(row.name, row.id);
    } else {
      nameByCategory.set(row.id as string, row.name);
      // A built-in wins a name it shares with nothing else anyway; ordered so.
      if (row.builtin === 1 || !categoryByName.has(row.name)) categoryByName.set(row.name, row.id as string);
    }
  }
  const resolved: Array<{ id: string; name: string; cap: number; category_id: string | null }> = [];
  const names = new Set<string>();
  for (const cat of categories) {
    let name = cat.name;
    let categoryId: string | null;
    if (cat.categoryId !== null) {
      const known = nameByCategory.get(cat.categoryId);
      if (known === undefined) {
        return c.json(
          { error: 'invalid_body', detail: `category_id "${cat.categoryId}" is not a category you can use` },
          400,
        );
      }
      name = known;
      categoryId = cat.categoryId;
    } else {
      categoryId = categoryByName.get(name) ?? null;
    }
    // Re-checked AFTER resolution: a cap keyed by id takes its category's name,
    // which may be a name another cap in this body sent by hand.
    if (names.has(name)) {
      return c.json({ error: 'invalid_body', detail: `two caps resolve to the category "${name}"` }, 400);
    }
    names.add(name);
    resolved.push({ id: cat.id ?? idByName.get(name) ?? uuid(), name, cap: cat.cap, category_id: categoryId });
  }

  // ── ONE BATCH = ONE IMPLICIT TRANSACTION ───────────────────────────────────
  // The DELETE must not be able to commit without its replacement inserts.
  const insert = c.env.APP_DB.prepare(
    // `id` is the surrogate addressing key added by 0002_schema_debt.sql; that
    // migration's contract is that NEW rows carry a client-generated id, so
    // writing NULL here would re-open the unaddressable-row gap it paid down.
    'INSERT INTO budget_categories (user_id, name, cap, id, category_id) VALUES (?, ?, ?, ?, ?)',
  );
  // The upsert names `currency` only when the body did (see `validate`), and
  // RETURNs the stored code either way, so the answer below carries the unit
  // without a further statement: the count the ceiling note measures holds.
  const upsert = currency.set
    ? c.env.APP_DB.prepare(
        `INSERT INTO budgets (user_id, monthly_budget, updated_at, currency)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           monthly_budget = excluded.monthly_budget,
           updated_at = excluded.updated_at,
           currency = excluded.currency
         RETURNING currency`,
      ).bind(userId, monthlyBudget, ts, currency.value)
    : c.env.APP_DB.prepare(
        `INSERT INTO budgets (user_id, monthly_budget, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           monthly_budget = excluded.monthly_budget,
           updated_at = excluded.updated_at
         RETURNING currency`,
      ).bind(userId, monthlyBudget, ts);
  // `batchIdempotent` retries a transient reset (services-027): every statement
  // here is an upsert, the DELETE, or an INSERT of an id resolved above, after
  // that DELETE — so the whole batch run twice leaves what it leaves once.
  const [stored] = (await batchIdempotent(c.env.APP_DB, [
    upsert,
    c.env.APP_DB.prepare(
      'DELETE FROM budget_categories WHERE user_id = ?',
    ).bind(userId),
    ...resolved.map((cat) => insert.bind(userId, cat.name, cat.cap, cat.id, cat.category_id)),
  ])) as Array<{ results?: Array<{ currency?: string | null }> }>;

  return c.json({
    monthly_budget: monthlyBudget,
    currency: stored?.results?.[0]?.currency ?? null,
    categories: resolved,
  });
});

export default app;
