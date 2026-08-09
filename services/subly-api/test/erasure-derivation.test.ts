// ─────────────────────────────────────────────────────────────────────────────
// THE DERIVED DELETE SET — pinned against the REAL migrations.
//
// 🔬 WHY THIS FILE EXISTS, AND WHAT IT HONESTLY CANNOT DO.
//
// `DELETE /v1/account` carries no table list. It asks the database which tables
// are user-owned, and until 2026-08-09 it asked with ONE correlated join:
//
//     FROM sqlite_master m JOIN pragma_table_info(m.name) p
//
// D1 REJECTS THAT with `not authorized: SQLITE_AUTH` (error 7500). The route
// caught the throw and answered `503 account_deletion_failed`, so every in-app
// account deletion in production had been failing since the routes shipped —
// measured live that day against the deployed platform Worker with a real ES256
// user token, and reproduced against both live databases through the D1 HTTP
// API (the join rejected, the same pragma with a LITERAL argument fine).
//
// ⚠️ THE OBVIOUS REGRESSION TEST IS IMPOSSIBLE HERE, AND PRETENDING OTHERWISE
// WOULD BE WORSE THAN NOT TESTING IT. The natural guard is "run the old form and
// assert it is rejected" — but this harness executes real SQL through
// `node:sqlite`, which has no D1 authorizer. Verified directly: node:sqlite
// ACCEPTS the correlated join and returns the right rows. So a test written that
// way would go green against the very bug it claims to catch, on both the old
// and the new implementation, which is the assertion-that-cannot-fail this
// repository deletes on sight.
//
// What CAN be proven locally is the thing the route actually depends on: that
// the two-step walk derives the SAME SET the schema implies, over the real
// migrations, including the disjointness rule between `user_id` and `*_user_id`.
// That is what is pinned below. The rejection itself can only be caught by a
// query executed against a live D1, and nothing in CI does that today —
// `assert-erasure-reach.mjs` proves reachability by parsing MIGRATION FILES, so
// a query D1 refuses at runtime looks perfectly reachable to it. That gap is
// real, is named here, and is not closed by this file.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from 'vitest';
import account from '../src/routes/account';
import { Hono } from 'hono';
import type { AppEnv } from '../src/types';
import { realAppDb, TEST_ENV, type SqliteD1 } from './harness';

/** Drive the REAL route so the derivation under test is the one that ships —
 *  not a copy of the query re-typed into this file, which would pass while the
 *  route did something else entirely. */
async function deletedTablesFor(db: SqliteD1, userId = 'u-derive') {
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => {
    c.set('userId', userId);
    c.set('tokenAssurance', 'asymmetric');
    c.set('requestId', 'test');
    await next();
  });
  app.route('/v1', account);
  const res = await app.request(
    'http://x/v1/account',
    { method: 'DELETE' },
    { ...TEST_ENV, APP_DB: db },
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

describe('the delete set is derived from the real schema', () => {
  it('🔴 names EXACTLY subly_db’s four user-owned tables', async () => {
    // The number production has. If a migration adds a user-owned table this
    // goes red — which is the point: the new table must be a deliberate addition
    // to what erasure sweeps, not a silent one.
    const db = realAppDb();
    const { status, body } = await deletedTablesFor(db);
    expect(status).toBe(200);
    expect(Object.keys(body.deleted as Record<string, number>).sort()).toEqual([
      'budget_categories',
      'budgets',
      'payment_history',
      'subscriptions',
    ]);
    expect(body.scope).toBe('subly_db');
  });

  it('really deletes the rows it derived, and leaves other users alone', async () => {
    const db = realAppDb();
    db.db.exec(
      `INSERT INTO subscriptions (id, user_id, name, price, cycle, next_renewal)
         VALUES ('s-mine','u-derive','A',1,'monthly','2026-01-01'),
                ('s-theirs','u-other','B',1,'monthly','2026-01-01')`,
    );
    const { status } = await deletedTablesFor(db);
    expect(status).toBe(200);
    expect(db.rows('SELECT id FROM subscriptions').map((r) => r.id)).toEqual(['s-theirs']);
  });

  it('sqlite/d1 internal tables are never delete targets', async () => {
    // `_cf_KV` exists in the live databases. A derivation that swept it would be
    // deleting Cloudflare's own bookkeeping.
    const db = realAppDb(['CREATE TABLE _cf_KV (key TEXT PRIMARY KEY, user_id TEXT)']);
    const { body } = await deletedTablesFor(db);
    expect(Object.keys(body.deleted as Record<string, number>)).not.toContain('_cf_KV');
  });

  it('🔑 `*_user_id` is UNLINKED, never deleted — and the two sets stay disjoint', async () => {
    // The limb that has no instance in today's schema. `user_id` must land in
    // `deleted` and `owner_user_id` in `unlinked`, and neither may appear in the
    // other — the disjointness the old SQL got from `LIKE '%\_user\_id'`.
    const db = realAppDb([
      `CREATE TABLE shared_notes (id TEXT PRIMARY KEY, owner_user_id TEXT)`,
      `INSERT INTO shared_notes (id, owner_user_id) VALUES ('n1','u-derive'), ('n2','u-other')`,
    ]);
    const { status, body } = await deletedTablesFor(db);
    expect(status).toBe(200);

    const deleted = Object.keys(body.deleted as Record<string, number>);
    const unlinked = Object.keys(body.unlinked as Record<string, number>);
    expect(deleted).not.toContain('shared_notes');
    expect(unlinked).toEqual(['shared_notes.owner_user_id']);
    expect(deleted.filter((t) => unlinked.some((u) => u.startsWith(`${t}.`)))).toEqual([]);

    // NULLed, not removed — the row belongs to somebody else.
    expect(db.rows('SELECT id, owner_user_id FROM shared_notes ORDER BY id')).toEqual([
      { id: 'n1', owner_user_id: null },
      { id: 'n2', owner_user_id: 'u-other' },
    ]);
  });

  it('an empty derivation REFUSES rather than reporting a clean sweep', async () => {
    // The fail-closed limb. Over a schema with no user-owned table the route must
    // answer 503, because `{ ok: true }` here is what would let the caller delete
    // the identity and orphan every row.
    const db = new (realAppDb().constructor as new (s: string[]) => SqliteD1)([
      'CREATE TABLE unrelated (id TEXT PRIMARY KEY)',
    ]);
    const { status, body } = await deletedTablesFor(db);
    expect(status).toBe(503);
    expect(body.error).toBe('account_deletion_failed');
  });
});
