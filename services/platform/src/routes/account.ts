import { Hono } from 'hono';
import type { AppEnv } from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /v1/account — the shared server's erasure route.
//
// [pipeline B-5] "One authenticated request erases a person from app D1 +
//                 platform_db + the identity provider."
//
// WHY IT LIVES HERE. The brick's default stamp is CLIENT-ONLY: it deploys no
// Worker of its own and talks to platform.nikatru.com for everything shared.
// The brick TEMPLATE has had a working three-limb deletion route since 2026-07,
// but only an OPT-IN backend stamp ever gets one — so the apps that actually
// need this route most were the ones without it, and the Dart seam says so
// verbatim (`packages/core/lib/src/auth/auth_repository.dart`: "DELETE
// /v1/account is stage 4's route and does not exist yet").
//
// ── THE UPGRADE OVER THE TEMPLATE: THE TABLE LIST IS DERIVED, NOT REMEMBERED ──
// 🔴 The brick's version carries `const appTables = ['records'];` and a comment
// warning "missing a table here = orphaned PII". That is a correctness property
// resting on somebody remembering to edit two files in the same change — and the
// failure is SILENT and permanent: the route returns `{ ok: true }` and the rows
// stay. Here the set is derived from the database's own schema at request time —
// every table carrying a `user_id` column is user-owned by definition — so a
// migration that adds a user-owned table is covered by that migration alone.
//
// ── THE SECOND DERIVED SET: A REFERENCE IS NOT AN OWNERSHIP ──────────────────
// 🔴 A table can hold the erased user's id without the ROW being theirs, and the
// sweep above would leave it there forever. `unclaimed_payments.claimed_user_id`
// (0004 section D) is the case: the row is the record of money that arrived and
// could not be attributed — evidence that belongs to a support ticket, not to a
// person — and deleting it destroys the only thing that could ever resolve that
// ticket. But the COLUMN is the erased person's account id, and after erasure
// that id must not survive anywhere: a dangling identifier is a row still
// addressable by the person who asked to be forgotten.
//
// So the second rule is derived from the schema the same way the first is:
//   ·  user_id   → the row IS this person's        → DELETE the row
//   · *_user_id  → the row REFERENCES this person  → NULL the column
// No list, no per-table knowledge. A future `linked_user_id` or
// `resolved_by_user_id` is unlinked by this migration-free rule the day it is
// created, and tooling/ci/assert-data-inventory.mjs is what refuses to let a new
// table land with no erasure story at all.
//
// ⚠️ THE SIBLING TIMESTAMP IS DELIBERATELY LEFT. `claimed_at` stays set: "this
// payment was claimed" remains true and is what stops it being re-claimed by
// somebody else. What is erased is WHO. Nulling both would rewrite the money
// record rather than unlink the person from it.
//
// ⚠️ WHY `events` AND `consent_artifacts` ARE CORRECTLY ABSENT FROM BOTH SETS,
// and why "zero rows for this user" is a VACUOUS assertion about them: neither
// table has a `user_id` column at all. That is deliberate and permanent —
// [ADR 020] forbids ever writing an `anon_id -> user_id` map, because that map
// is the thing that would convert pseudonymous analytics into erasure-subject
// personal data. The derivation gets this right for the right reason rather
// than by a hardcoded exclusion someone could "fix".
//
// ── THREE LIMBS, AND THE THIRD IS THE ONE ROW COUNTS CANNOT FAKE ─────────────
//   1. every user-owned table in platform_db, emptied for this user_id — and
//      every `*_user_id` REFERENCE to them nulled, so no dangling identifier of
//      an erased person survives in a row that is not theirs
//   2. entitlements specifically (it is one of the above; named because
//      master §0.1 G2 names it)
//   3. THE IDENTITY RECORD — after which the same credentials no longer sign in.
//      A deletion that leaves a working login is one the user cannot detect as
//      incomplete, which is exactly the failure the client half refuses to fake.
//
// Deleting the identity needs the SERVICE ROLE key. Until the owner sets it this
// route answers 501 and says so — it ships HONEST rather than not at all.
// ─────────────────────────────────────────────────────────────────────────────

const account = new Hono<AppEnv>();

/** Tables SQLite/D1 own, which must never be a delete target even if some
 *  future column there were named `user_id`. */
const RESERVED = /^(sqlite_|d1_|_cf_)/;

/**
 * Every table in the bound database that carries a `user_id` column.
 *
 * Derived from `sqlite_master` joined to `pragma_table_info`, so it is the
 * SCHEMA THAT ANSWERS, not a list in this file. D1 speaks SQLite, so this is the
 * same query locally, in the test harness and in production.
 */
async function userOwnedTables(db: D1Database): Promise<string[]> {
  const res = await db
    .prepare(
      `SELECT m.name AS name
         FROM sqlite_master m
         JOIN pragma_table_info(m.name) p
        WHERE m.type = 'table' AND p.name = 'user_id'
        ORDER BY m.name`,
    )
    .all<{ name: string }>();
  return (res.results ?? [])
    .map((r) => r.name)
    .filter((n) => typeof n === 'string' && !RESERVED.test(n));
}

/**
 * Every (table, column) in the bound database where the column NAMES a user but
 * does not make the row theirs — the `*_user_id` form.
 *
 * `LIKE '%\_user\_id' ESCAPE '\'` rather than a client-side filter, for the same
 * reason [userOwnedTables] pushes its predicate into SQL: the schema answers.
 * `user_id` itself cannot match (there is nothing before the first `_`), so the
 * two sets are disjoint by construction rather than by a subtraction somebody
 * could forget.
 */
async function userReferencingColumns(
  db: D1Database,
): Promise<Array<{ table: string; column: string }>> {
  const res = await db
    .prepare(
      `SELECT m.name AS name, p.name AS col
         FROM sqlite_master m
         JOIN pragma_table_info(m.name) p
        WHERE m.type = 'table' AND p.name LIKE '%\\_user\\_id' ESCAPE '\\'
        ORDER BY m.name, p.name`,
    )
    .all<{ name: string; col: string }>();
  return (res.results ?? [])
    .filter(
      (r) =>
        typeof r.name === 'string' &&
        typeof r.col === 'string' &&
        !RESERVED.test(r.name) &&
        // Identifier hygiene: the column name is interpolated into the UPDATE
        // below (D1 cannot bind an identifier), so anything that is not a plain
        // identifier is refused rather than quoted. Nothing user-controlled can
        // reach here — it comes from the schema — but the string still gets
        // built, and a schema is not a trust boundary anyone audits.
        /^[A-Za-z_][A-Za-z0-9_$]*$/.test(r.col),
    )
    .map((r) => ({ table: r.name, column: r.col }));
}

// Mounted as `app.route('/v1', account)`, so the path declared HERE is the leaf.
// Declaring it as `'/'` under `app.route('/v1/account', …)` produced the route
// `/v1/account/` — with a trailing slash — which is a different path from the one
// the Dart seam builds and the register declares.
account.delete('/account', async (c) => {
  const userId = c.get('userId');
  const rid = c.get('requestId') ?? '-';

  // PRECONDITION, CHECKED BEFORE ANYTHING IS DESTROYED. Discovering halfway
  // through that the identity cannot be removed leaves a user with no data and a
  // working login — strictly worse than refusing up front. Set it once with:
  //   wrangler secret put SUPABASE_SERVICE_ROLE_KEY
  const serviceRoleKey = c.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    console.error(
      `[account] rid=${rid} app=${c.env.APP_ID} refusing deletion: SUPABASE_SERVICE_ROLE_KEY is not set, so the identity record cannot be removed`,
    );
    return c.json({ error: 'account_deletion_unconfigured' }, 501);
  }

  const deleted: Record<string, number> = {};
  const unlinked: Record<string, number> = {};

  let tables: string[];
  let references: Array<{ table: string; column: string }>;
  try {
    tables = await userOwnedTables(c.env.PLATFORM_DB);
    references = await userReferencingColumns(c.env.PLATFORM_DB);
  } catch (err) {
    console.error(`[account] rid=${rid} app=${c.env.APP_ID} schema read failed`, err);
    return c.json({ error: 'account_deletion_failed' }, 503);
  }

  // 🔴 AN EMPTY SET IS A FAILURE, NOT A FAST PATH. If the derivation ever stops
  // finding tables — a schema change, a driver that does not support
  // pragma_table_info — this route would delete NOTHING, report `ok: true`, and
  // then delete the identity, leaving the user's rows behind forever with no
  // login able to reach them. Refuse instead.
  if (tables.length === 0) {
    console.error(
      `[account] rid=${rid} app=${c.env.APP_ID} refusing deletion: no user-owned table was found in platform_db, so this request would erase the identity and orphan every row`,
    );
    return c.json({ error: 'account_deletion_failed' }, 503);
  }

  for (const table of tables) {
    // The name comes from sqlite_master, not from the request — there is no
    // caller-controlled value in this string, and D1 cannot bind an identifier.
    const res = await c.env.PLATFORM_DB.prepare(`DELETE FROM ${table} WHERE user_id = ?`)
      .bind(userId)
      .run();
    deleted[table] = res.meta.changes ?? 0;
  }

  // Then the REFERENCES. After this no `*_user_id` column anywhere in
  // platform_db holds this person's id — which is what "erased" has to mean for
  // a row that is evidence about a payment rather than a record about a person.
  // Table and column both come from sqlite_master; there is no caller-controlled
  // value in this string, and D1 cannot bind an identifier.
  for (const { table, column } of references) {
    const res = await c.env.PLATFORM_DB.prepare(
      `UPDATE ${table} SET ${column} = NULL WHERE ${column} = ?`,
    )
      .bind(userId)
      .run();
    unlinked[`${table}.${column}`] = res.meta.changes ?? 0;
  }

  // The IDENTITY record, LAST — the row that decides whether the login still
  // works. 404 counts as done: the user is gone, which is what was asked for,
  // and a retry after a partial failure must not fail on the second pass. The
  // key is never echoed, logged, or returned.
  const identityRes = await fetch(
    `${c.env.SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(userId)}`,
    {
      method: 'DELETE',
      headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` },
    },
  );
  if (!identityRes.ok && identityRes.status !== 404) {
    console.error(
      `[account] rid=${rid} app=${c.env.APP_ID} identity delete failed with ${identityRes.status}`,
    );
    // NOT ok:true. The data is gone and the login is not — the user must be told,
    // and the client turns this into a visible failure rather than a "deleted"
    // they cannot verify. The purges above are idempotent, so a retry is safe.
    return c.json({ error: 'identity_delete_failed' }, 502);
  }
  deleted['identity'] = 1;

  return c.json({ ok: true, deleted, unlinked });
});

export default account;
