// ─────────────────────────────────────────────────────────────────────────────
// /v1/categories — categories by ID (ST-X8, round-2 F16 / B29 / C11, API half).
//
// Until 0005 a category was its English NAME: on the subscription row, and as
// budget_categories' primary key. So a rename lost its cap, and a built-in could
// not be shown in Tamil because the only thing on the wire was "Streaming".
//
// Two kinds of row, one table (0005_lifecycle_history_categories.sql):
//   · BUILT-IN — `user_id` NULL, `builtin` true, a stable slug id ('streaming').
//     A client translates by the id and falls back to `name`. Read-only here.
//   · THE USER'S OWN — their `user_id`, a random id, the name they typed.
//
// 🔴 THE NAME COLUMNS STAY IN STEP WITH THE ID. `subscriptions.category` and
// `budget_categories.name` are what every client before this change reads, so a
// rename rewrites them in the SAME batch as the category, and a delete clears
// them. That batch is what makes "renaming a category keeps its cap" true for
// an old client and a new one alike.
// ─────────────────────────────────────────────────────────────────────────────

import type { SqlDb } from '../../../_shared/src/ports/sql';
import { Hono } from 'hono';
import type { AppEnv, Category } from '../types';
import { allRows, firstRow, nowIso, run, uuid } from '../lib/d1';
import { isBoundedString, isPlainObject } from '../lib/validate';

const app = new Hono<AppEnv>();

/** @ceiling none — column width; the same width a subscription's `category` has
 *  (routes/subscriptions.ts MAX_CATEGORY) and a cap's name has (routes/budget.ts). */
const MAX_NAME = 120;
/**
 * How many categories of their own one user may have.
 *
 * @ceiling none — a per-user row count, not a platform resource: each request
 * touches at most one category row. It bounds a list, like budget.ts's
 * MAX_CATEGORIES, and sits at that same 200.
 */
const MAX_OWN = 200;
/**
 * The most statements any `.batch()` on this router sends: a rename and a
 * delete are three each (the category, its subscriptions, its cap). FIXED BY
 * THE CODE, not sized by input; test/categories.test.ts counts every batch.
 *
 * @ceiling d1.queriesPerInvocation lte
 */
export const MAX_CATEGORY_BATCH_STATEMENTS = 3;

export function serializeCategory(row: Category) {
  return {
    id: row.id,
    name: row.name,
    builtin: row.builtin === 1,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/** A category name: trimmed, non-empty, at most MAX_NAME characters. */
function nameOf(body: unknown): { ok: true; name: string } | { ok: false; detail: string } {
  if (!isPlainObject(body)) return { ok: false, detail: 'body must be a JSON object' };
  const raw = body.name;
  if (!isBoundedString(raw, MAX_NAME) || raw.trim() === '') {
    return { ok: false, detail: `name must be a non-empty string of at most ${MAX_NAME} characters` };
  }
  return { ok: true, name: raw.trim() };
}

/** The category this user may use under [id]: a built-in, or one of their own. */
export function visibleCategory(db: SqlDb, userId: string, id: string) {
  return firstRow<Category>(
    db.prepare('SELECT * FROM categories WHERE id = ? AND (user_id IS NULL OR user_id = ?)').bind(id, userId),
  );
}

/** Another category (not [exceptId]) this user already sees under [name]. */
function clash(db: SqlDb, userId: string, name: string, exceptId: string | null) {
  return firstRow<{ id: string }>(
    db
      .prepare(
        `SELECT id FROM categories
          WHERE (user_id IS NULL OR user_id = ?) AND name = ? AND id IS NOT ?`,
      )
      .bind(userId, name, exceptId),
  );
}

// GET / — the built-ins, then the user's own, each alphabetically.
app.get('/', async (c) => {
  const userId = c.get('userId');
  const rows = await allRows<Category>(
    c.env.APP_DB.prepare(
      `SELECT * FROM categories WHERE user_id IS NULL OR user_id = ?
        ORDER BY builtin DESC, name ASC`,
    ).bind(userId),
  );
  return c.json(rows.map(serializeCategory));
});

// POST / — a category of the user's own.
app.post('/', async (c) => {
  const userId = c.get('userId');
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }
  const checked = nameOf(body);
  if (!checked.ok) return c.json({ error: 'invalid_body', detail: checked.detail }, 400);
  if (await clash(c.env.APP_DB, userId, checked.name, null)) {
    return c.json({ error: 'name_taken', detail: `a category named "${checked.name}" already exists` }, 409);
  }
  const count = await firstRow<{ n: number }>(
    c.env.APP_DB.prepare('SELECT COUNT(*) AS n FROM categories WHERE user_id = ?').bind(userId),
  );
  if ((count?.n ?? 0) >= MAX_OWN) {
    return c.json({ error: 'invalid_body', detail: `at most ${MAX_OWN} categories of your own` }, 400);
  }
  const id = uuid();
  const ts = nowIso();
  await run(
    c.env.APP_DB.prepare(
      'INSERT INTO categories (id, user_id, name, builtin, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)',
    ).bind(id, userId, checked.name, ts, ts),
  );
  const row = await visibleCategory(c.env.APP_DB, userId, id);
  return c.json(row ? serializeCategory(row) : { error: 'not_found' }, 201);
});

// PATCH /:id — rename one of the user's own. The id, and so every cap and
// subscription that points at it, stays.
app.patch('/:id', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }
  const checked = nameOf(body);
  if (!checked.ok) return c.json({ error: 'invalid_body', detail: checked.detail }, 400);

  const existing = await visibleCategory(c.env.APP_DB, userId, id);
  if (!existing) return c.json({ error: 'not_found' }, 404);
  if (existing.builtin === 1) {
    return c.json({ error: 'builtin_category', detail: 'a built-in category cannot be renamed' }, 403);
  }
  const name = checked.name;
  if (await clash(c.env.APP_DB, userId, name, id)) {
    return c.json({ error: 'name_taken', detail: `a category named "${name}" already exists` }, 409);
  }
  // budget_categories' PRIMARY KEY is still (user_id, name): a legacy cap with
  // the new name and no id would collide inside the batch. Refused up front, so
  // the caller gets a 409 that names it rather than a rolled-back 500.
  const capClash = await firstRow<{ name: string }>(
    c.env.APP_DB.prepare(
      'SELECT name FROM budget_categories WHERE user_id = ? AND name = ? AND category_id IS NOT ?',
    ).bind(userId, name, id),
  );
  if (capClash) {
    return c.json({ error: 'name_taken', detail: `a budget cap named "${name}" already exists` }, 409);
  }

  const ts = nowIso();
  await c.env.APP_DB.batch([
    c.env.APP_DB.prepare('UPDATE categories SET name = ?, updated_at = ? WHERE id = ? AND user_id = ?').bind(
      name,
      ts,
      id,
      userId,
    ),
    c.env.APP_DB.prepare(
      'UPDATE subscriptions SET category = ?, updated_at = ? WHERE user_id = ? AND category_id = ?',
    ).bind(name, ts, userId, id),
    c.env.APP_DB.prepare('UPDATE budget_categories SET name = ? WHERE user_id = ? AND category_id = ?').bind(
      name,
      userId,
      id,
    ),
  ]);
  const row = await visibleCategory(c.env.APP_DB, userId, id);
  return c.json(row ? serializeCategory(row) : { error: 'not_found' });
});

// DELETE /:id — delete one of the user's own. Its subscriptions keep existing
// with no category (the client groups those as uncategorised), and its cap goes
// with it: a cap for a category that no longer exists caps nothing.
app.delete('/:id', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  const existing = await visibleCategory(c.env.APP_DB, userId, id);
  if (!existing) return c.json({ ok: true });
  if (existing.builtin === 1) {
    return c.json({ error: 'builtin_category', detail: 'a built-in category cannot be deleted' }, 403);
  }
  const ts = nowIso();
  await c.env.APP_DB.batch([
    c.env.APP_DB.prepare(
      'UPDATE subscriptions SET category_id = NULL, category = NULL, updated_at = ? WHERE user_id = ? AND category_id = ?',
    ).bind(ts, userId, id),
    c.env.APP_DB.prepare('DELETE FROM budget_categories WHERE user_id = ? AND category_id = ?').bind(userId, id),
    c.env.APP_DB.prepare('DELETE FROM categories WHERE id = ? AND user_id = ?').bind(id, userId),
  ]);
  return c.json({ ok: true });
});

export default app;
