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
// ── FOUR LIMBS, AND THE LAST TWO ARE THE ONES ROW COUNTS CANNOT FAKE ─────────
//   1. every user-owned table in platform_db, emptied for this user_id — and
//      every `*_user_id` REFERENCE to them nulled, so no dangling identifier of
//      an erased person survives in a row that is not theirs
//   2. entitlements specifically (it is one of the above; named because
//      master §0.1 G2 names it)
//   3. EVERY APP'S OWN DATABASE, through that app's own erasure route
//   4. THE IDENTITY RECORD — after which the same credentials no longer sign in.
//      A deletion that leaves a working login is one the user cannot detect as
//      incomplete, which is exactly the failure the client half refuses to fake.
//
// Deleting the identity needs the SERVICE ROLE key. Until the owner sets it this
// route answers 501 and says so — it ships HONEST rather than not at all.
//
// ── LIMB 3, AND WHY IT IS A RELAY RATHER THAN MORE SQL HERE ──────────────────
// 🔴 THE DEFECT IT CLOSES: A ROUTE READS THE DATABASES IT READS, NOT THE ONES ITS
// WORKER BINDS. Everything above operates on PLATFORM_DB. This Worker also binds
// `SUBLY_DB` (for the nightly renewals fan-out) — and bound is not swept. So the
// ONLY app in the field was the one app account deletion did not reach: a Subly
// user could press Delete account, watch it succeed, lose their login, and leave
// every subscription, budget, budget category and payment they had ever entered
// in a database no login could ever reach again. tooling/legal/data-inventory.json
// carried four `erasure: no-route` rows saying exactly that.
//
// Sweeping SUBLY_DB from here was the smaller diff and was rejected. It would put
// one app's schema inside the shared Worker, and — the hazard the register names —
// an irreversible route that erases every database its Worker binds makes any
// FUTURE binding an erasure target the day somebody adds it, silently. So each app
// owns its own erasure over its own database (the brick already stamps one for
// every app; Subly predates the brick and now has one too), and this route
// ORCHESTRATES rather than reaches in.
//
// ⚠️ THE ORDER IS THE WHOLE POINT, AND IT IS THE SAME DISCIPLINE AS THE 501 ABOVE:
//   precondition → platform_db → EVERY APP DB → identity.
// The identity is deleted LAST, so an app whose purge failed leaves the user with
// a WORKING LOGIN and a retryable request, instead of orphaned rows behind an
// account that no longer exists. Every limb is idempotent, so the retry is safe.
// This is also why the client still makes ONE call: two client-side calls in
// sequence could interleave with a 501 from here and destroy an app's data for an
// account that then survives — strictly worse than what shipped before.
//
// ⚠️ IT FORWARDS THE CALLER'S OWN BEARER TOKEN, and that is a deliberate choice
// over a service-to-service secret. The app route then verifies the SAME ES256
// signature against the SAME public JWKS, so tenancy is proved end to end by the
// user's own token and there is no shared secret anywhere in the erasure path —
// which is the property the app-side route (services/subly-api) exists to keep:
// its own `erasureAuth` refuses anything that is not asymmetrically verified,
// including the legacy HS256 token every other route on that Worker accepts.
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

/**
 * `"subly=https://api.nikatru.com,other=https://…"` → `[{ appId, origin }]`.
 *
 * REFUSES anything that is not an `https://` origin, rather than skipping it.
 * The relay forwards a live bearer token, so a plaintext or malformed entry is a
 * session token on the wire — and a malformed entry silently dropped would be an
 * app whose rows quietly stop being erased, which is the exact failure this whole
 * limb exists to remove. Throwing is what turns it into a refusal.
 */
export function parseErasureEndpoints(raw: string | undefined): Array<{ appId: string; origin: string }> {
  const out: Array<{ appId: string; origin: string }> = [];
  for (const entry of (raw ?? '').split(',').map((s) => s.trim()).filter(Boolean)) {
    const at = entry.indexOf('=');
    if (at <= 0) throw new RangeError(`APP_ERASURE_ENDPOINTS entry is not <appId>=<origin>: ${entry}`);
    const appId = entry.slice(0, at).trim();
    const origin = entry.slice(at + 1).trim().replace(/\/+$/, '');
    if (!appId) throw new RangeError(`APP_ERASURE_ENDPOINTS entry has an empty appId: ${entry}`);
    // A BARE ORIGIN: scheme, host, optional port. Nothing else. The first
    // version of this pattern was `^https:\/\/[^\s/]+$`, which accepted
    // `https://api.test?x=1` — the path is then built as
    // `https://api.test?x=1/v1/account`, i.e. the erasure DELETE goes to `/` with
    // a query string, gets whatever that answers, and an app's data is silently
    // never erased. Caught by the test below, not by reading this line.
    if (!/^https:\/\/[A-Za-z0-9.-]+(:\d+)?$/.test(origin)) {
      throw new RangeError(
        `APP_ERASURE_ENDPOINTS entry for ${appId} is not a bare https origin: ${JSON.stringify(origin)}`,
      );
    }
    out.push({ appId, origin });
  }
  return out;
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

  // THE SECOND PRECONDITION, CHECKED IN THE SAME BREATH AND FOR THE SAME REASON.
  // The per-app endpoints are parsed BEFORE anything is destroyed, so a
  // misconfigured list is a refusal rather than a half-finished erasure. Parsing
  // here also means the `https://` rule is applied before the caller's token can
  // be put on a wire.
  let endpoints: Array<{ appId: string; origin: string }>;
  try {
    endpoints = parseErasureEndpoints(c.env.APP_ERASURE_ENDPOINTS);
  } catch (err) {
    console.error(
      `[account] rid=${rid} app=${c.env.APP_ID} refusing deletion: APP_ERASURE_ENDPOINTS is malformed`,
      err instanceof Error ? err.message : err,
    );
    return c.json({ error: 'account_deletion_unconfigured' }, 501);
  }
  // 🔴 AN EMPTY LIST IS A REFUSAL, NOT "NO APPS TO CLEAN UP". Every app in this
  // portfolio keeps user rows in its own database; a deployment that has lost
  // this var would erase platform_db and the identity, report ok:true, and leave
  // every app's rows orphaned behind a login that no longer exists — the exact
  // shape of the defect this limb was added to fix, re-created by a config drift.
  // The day an app genuinely owns no database, this becomes a real judgement and
  // gets a written entry rather than an empty string.
  if (endpoints.length === 0) {
    console.error(
      `[account] rid=${rid} app=${c.env.APP_ID} refusing deletion: APP_ERASURE_ENDPOINTS names no app, so every app-owned row would survive this deletion`,
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

  // ── LIMB 3 · EVERY APP'S OWN DATABASE, THROUGH ITS OWN ROUTE ──────────────
  // Before the identity, so a failure here leaves the user a working login and a
  // retryable request. The caller's own Authorization header is forwarded
  // verbatim: the app route verifies the same ES256 signature against the same
  // public JWKS, so tenancy is the user's own token end to end and no shared
  // secret exists anywhere on this path.
  const authorization = c.req.header('Authorization');
  const apps: Record<string, string> = {};
  for (const { appId, origin } of endpoints) {
    let res: Response;
    try {
      res = await fetch(`${origin}/v1/account`, {
        method: 'DELETE',
        headers: {
          // Forwarded, never re-minted. This Worker holds no key that could sign
          // a token for this user, and it must not: the app route's refusal to
          // accept anything but an asymmetric proof is the property being kept.
          ...(authorization ? { Authorization: authorization } : {}),
          'x-request-id': rid,
        },
      });
    } catch (err) {
      console.error(
        `[account] rid=${rid} app=${c.env.APP_ID} app-data erasure for ${appId} could not be reached at ${origin}`,
        err instanceof Error ? err.message : err,
      );
      // NOT ok:true, and the identity is NOT deleted. The user keeps a login and
      // can retry; every limb above is idempotent.
      return c.json({ error: 'app_data_delete_failed', app: appId }, 502);
    }
    if (!res.ok) {
      // ⚠️ NO STATUS IS TREATED AS "CLOSE ENOUGH", and 404 in particular is NOT
      // forgiven the way the identity delete forgives it below. There, 404 means
      // the user is already gone — the goal state. Here it means the ROUTE is not
      // there, i.e. that app's rows were never erased by anyone, which is the
      // failure this limb exists to detect and is indistinguishable from success
      // if it is swallowed.
      console.error(
        `[account] rid=${rid} app=${c.env.APP_ID} app-data erasure for ${appId} answered ${res.status}`,
      );
      return c.json({ error: 'app_data_delete_failed', app: appId }, 502);
    }
    apps[appId] = 'deleted';
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

  return c.json({ ok: true, deleted, unlinked, apps });
});

export default account;
