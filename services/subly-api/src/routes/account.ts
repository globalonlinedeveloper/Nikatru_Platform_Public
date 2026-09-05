import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { allRows } from '../lib/d1';

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /v1/account — SUBLY'S OWN ERASURE ROUTE, over subly_db (APP_DB).
//
// ── THE DEFECT THIS CLOSES ──────────────────────────────────────────────────
// 🔴 THE ONLY APP IN THE FIELD WAS THE ONE APP NO ERASURE ROUTE REACHED. The
// shared server's DELETE /v1/account (services/platform/src/routes/account.ts)
// sweeps PLATFORM_DB and deletes the identity record — and touches nothing in
// subly_db, because a route reads the database it reads and not the ones its
// Worker happens to bind. So a Subly user could press "Delete account", watch it
// succeed, lose their login, and leave every subscription, budget, budget
// category and payment they had ever entered sitting in a database no login could
// ever reach again. tooling/legal/data-inventory.json carried FOUR rows declaring
// `erasure: no-route` for exactly this reason.
//
// That is a DPDP obligation and a hard store requirement — Google Play and the
// App Store both require a working in-app deletion path wherever an account can
// be created — and it is worse than an absent feature, because the user is told
// their data is gone and stops asking.
//
// ── WHY IT IS HERE AND NOT IN services/platform ─────────────────────────────
// The shared Worker already BINDS subly_db (`SUBLY_DB`, for the nightly renewals
// fan-out), so it could have swept it directly in a dozen lines. That was
// considered and rejected:
//
//   · it would put one app's schema inside the portfolio's shared Worker, and
//     the schema is exactly what this route derives its behaviour from;
//   · the register (tooling/legal/data-inventory.json) names the hazard: an
//     irreversible route that erases every database its Worker binds makes any
//     FUTURE binding an erasure target the day it is added, silently;
//   · the brick's backend stamp already gives every app-api Worker its own
//     `DELETE /v1/account`. Subly predates the brick and is the one app without
//     one. Putting the route here makes Subly the same shape as app #2 rather
//     than a special case the shared Worker has to know about.
//
// ── WHAT THIS ROUTE DOES **NOT** DO, AND WHY THAT IS DELIBERATE ─────────────
// ⚠️ IT DOES NOT DELETE THE IDENTITY RECORD, AND IT DOES NOT TOUCH platform_db.
// The brick template's version does both; this one must not, because those rows
// are not Subly's. The identity is portfolio-wide and there must be exactly ONE
// piece of code that destroys it — two Workers racing to delete the same auth
// user is a partial-failure matrix nobody can reason about, and it would need
// this Worker to hold the Supabase SERVICE ROLE key, which is the most dangerous
// credential in the account and currently lives in one place. So the division is:
//
//   services/platform  — platform_db + the identity, and the ORDERING
//   services/subly-api — subly_db, and nothing else
//
// The shared route calls this one (relaying the caller's own bearer token) AFTER
// its service-role precondition and BEFORE it deletes the identity, so a failure
// here stops the erasure while the user still has a login to retry with. See the
// long note in services/platform/src/routes/account.ts.
//
// ⚠️ CONSEQUENCE, STATED RATHER THAN HIDDEN: `{ ok: true }` from THIS route means
// "subly_db no longer holds this user", NOT "the account is gone". The response
// says `scope: 'subly_db'` so no caller can read it as the latter.
//
// ── THE TABLE SET IS DERIVED FROM THE SCHEMA, NOT LISTED HERE ───────────────
// 🔴 The brick template carries `const appTables = ['records'];` with a comment
// warning that missing a table there means orphaned PII. That is a correctness
// property resting on somebody remembering to edit two files in one change, and
// the failure is SILENT and permanent: the route answers `{ ok: true }` and the
// rows stay. Here, as in the platform route, the database answers: every table
// carrying a `user_id` column is user-owned BY DEFINITION, so a migration that
// adds a user-owned table to subly_db is covered by that migration alone.
//
// The second rule is the same one, for the other spelling:
//   ·  user_id   → the row IS this person's        → DELETE the row
//   · *_user_id  → the row REFERENCES this person  → NULL the column
// subly_db has no `*_user_id` column today. The limb is still here, and it is not
// speculative: `payment_history.subscription_id` shows this schema already models
// cross-row references, and the day one of them names a user the rule covers it
// with no edit. Its emptiness is asserted (not assumed) by the test that plants a
// row in every table and sweeps for the id afterwards.
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
  const hits = await columnsMatching(db, (col) => col === 'user_id');
  return hits.map((h) => h.table);
}

/**
 * 🔴 THE TWO-STEP WALK EXISTS BECAUSE D1 REFUSES THE ONE-STEP FORM.
 *
 * Both derivations here used to be a single correlated join:
 *
 *     FROM sqlite_master m JOIN pragma_table_info(m.name) p
 *
 * D1 rejects that with `not authorized: SQLITE_AUTH` (error 7500), and the rule
 * is about the STATEMENT rather than about where the pragma's argument came
 * from: any single statement that names sqlite_master/sqlite_schema AND calls a
 * pragma_* table-valued function is rejected — join, subquery, CTE and
 * correlated scalar subquery alike (measured 2026-08-09 against both production
 * databases). The same pragma fed a literal, a bound parameter or a VALUES list
 * is accepted, and so is a plain sqlite_master read.
 *
 * ⚠️ THE FIRST VERSION OF THIS PARAGRAPH WAS WRONG, HERE AND IN TWO OTHER FILES
 * SIMULTANEOUSLY. It read "a table-valued function whose argument is a COLUMN of
 * another table is not allowed", which the accepted VALUES and bound-parameter
 * forms falsify, and which points the next reader at a CTE rewrite D1 also
 * refuses. The sentence now lives once — `MEASURED_CAUSE` in
 * tooling/ci/d1-sql-inventory.mjs — and assert-d1-sql-inventory.mjs pins this
 * paragraph against it.
 *
 * So the schema is asked in two steps instead of one, and the property this file
 * argues for is unchanged: the DATABASE still answers which tables are
 * user-owned, so a migration that adds one is covered by that migration alone.
 *
 * 🔬 MEASURED 2026-08-09, IN PRODUCTION, NOT REASONED ABOUT. A real ES256 user
 * token against the deployed platform Worker returned
 * `503 {"error":"account_deletion_failed"}` — the catch around this derivation —
 * and running the old query against both live databases through the D1 HTTP API
 * returned SQLITE_AUTH for the join while the literal-argument pragma returned
 * rows. Every in-app account deletion had been failing this way since the routes
 * shipped: the user was told "not deleted" with nothing wrong with the request.
 *
 * ⚠️ THE LOCAL SUITE CANNOT REPRODUCE THE REJECTION, AND THAT IS STATED RATHER
 * THAN PAPERED OVER. This harness runs real SQL through `node:sqlite`, which has
 * no D1 authorizer and ACCEPTS the correlated join — verified directly. So no
 * test here can go red on the old form, and the tests accompanying this change
 * pin the DERIVED SET against the real migrations instead. Only a query executed
 * against a live D1 can catch this class, and nothing in CI does that today.
 *
 * 🔴 BOTH READS GO THROUGH `allRows`, WHICH IS THE TRANSIENT-D1 RETRY. They used
 * to be bare `db.prepare(...).all()`, and that was the whole of a second defect:
 * `src/lib/d1.ts` has listed `storage operation exceeded timeout which caused
 * object to be reset` as retryable since 2026-09-02, but nothing on this path
 * called it — `src/index.ts` imports `nowIso` from that module and nothing else,
 * so the helper was not even in scope at the route. A D1 Durable Object reset
 * lasting milliseconds therefore came out of THIS preflight as
 * `503 account_deletion_failed`, i.e. a user told their data was not deleted for
 * a reason that had already stopped being true. A read is idempotent, so the
 * retry is safe here by construction rather than by argument.
 *
 * ⚠️ IT IS STILL THE NARROW RETRY, AND THAT MATTERS MORE THAN THE RETRY. The
 * SQLITE_AUTH rejection above is DETERMINISTIC: `isTransientD1Error` refuses it,
 * so the second attempt this change adds is never spent re-asking a question D1
 * has already answered. `test/d1-transient-preflight.test.ts` asserts both sides
 * — one reset survives, and a deterministic failure is sent exactly once.
 */
async function columnsMatching(
  db: D1Database,
  match: (column: string) => boolean,
): Promise<Array<{ table: string; column: string }>> {
  const listed = await allRows<{ name: string }>(
    db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`),
  );

  const tables = listed
    .map((r) => r.name)
    .filter(
      (n) =>
        typeof n === 'string' &&
        !RESERVED.test(n) &&
        // The name is interpolated into the pragma below — D1 cannot bind an
        // identifier — so anything that is not a plain identifier is refused
        // rather than quoted. It comes from sqlite_master, never from a request.
        /^[A-Za-z_][A-Za-z0-9_$]*$/.test(n),
    );

  const hits: Array<{ table: string; column: string }> = [];
  for (const table of tables) {
    // eslint-disable-next-line no-await-in-loop
    const cols = await allRows<{ name: string }>(
      db.prepare(`SELECT name FROM pragma_table_info('${table}')`),
    );
    for (const row of cols) {
      if (typeof row.name === 'string' && match(row.name)) {
        hits.push({ table, column: row.name });
      }
    }
  }
  return hits;
}

/**
 * Every (table, column) where the column NAMES a user without making the row
 * theirs — the `*_user_id` form.
 *
 * `LIKE '%\_user\_id' ESCAPE '\'` in SQL rather than a client-side filter, for
 * the same reason [userOwnedTables] pushes its predicate down: the schema
 * answers. `user_id` itself cannot match (nothing precedes the first `_`), so the
 * two sets are disjoint by construction rather than by a subtraction somebody
 * could forget.
 */
async function userReferencingColumns(
  db: D1Database,
): Promise<Array<{ table: string; column: string }>> {
  // `%_user_id` in SQL became this predicate when the correlated join went (see
  // [columnsMatching]). `user_id` itself cannot match — something must precede
  // the `_user_id` suffix — so the two sets stay disjoint BY CONSTRUCTION rather
  // than by a subtraction somebody could forget, exactly as the SQL did.
  const hits = await columnsMatching(
    db,
    (col) => col.endsWith('_user_id') && col.length > '_user_id'.length,
  );
  return hits.filter(
    // Identifier hygiene: the column name is interpolated into the UPDATE below
    // (D1 cannot bind an identifier), so anything that is not a plain identifier
    // is refused rather than quoted. Nothing user-controlled can reach here — it
    // comes from the schema — but the string still gets built, and a schema is
    // not a trust boundary anyone audits.
    (h) => /^[A-Za-z_][A-Za-z0-9_$]*$/.test(h.column),
  );
}

// Mounted as `app.route('/v1', account)`, so the path declared HERE is the leaf.
// Declaring it `'/'` under `app.route('/v1/account', …)` yields `/v1/account/` —
// a DIFFERENT path from the one every caller builds. That exact mistake is
// recorded in the platform route; it is repeated here because the fix is the
// shape of this line and nothing enforces it.
account.delete('/account', async (c) => {
  const rid = c.get('requestId') ?? '-';

  // ── LIMB 0 · THE PROOF IS ASYMMETRIC, OR THERE IS NO ERASURE ──────────────
  // 🔴 THE REASON THIS ROUTE DID NOT EXIST UNTIL NOW. `supabaseAuth` — the
  // middleware every other route on this Worker uses — falls back to verifying
  // with the shared `SUPABASE_JWT_SECRET` when the JWKS path fails. A previous
  // review refused to port an erasure route onto that boundary, and was right
  // about the risk: a symmetric secret is a string, and whoever learns it can
  // mint a token for any user. Behind a read that is a data leak; behind THIS
  // route it is an unauthenticated remote wipe of anybody's account.
  //
  // The conclusion drawn from that risk was wrong, though — the answer is not to
  // leave every Subly user with no way to delete their data. It is to give the
  // route a STRICTER boundary than the Worker's default: `erasureAuth`
  // (src/middleware/auth.ts) verifies ES256 against the public JWKS and has no
  // secret in scope at all, and index.ts mounts this route behind it.
  //
  // This check is the SECOND limb, and it is not redundant with the mounting.
  // The mounting is one line in another file; a tidy-up that moved this route
  // under the permissive group would silently put account deletion behind the
  // shared secret and every existing test would still pass. Re-checking here
  // means that edit produces a loud, logged 403 instead.
  //
  // ⚠️ FAIL-CLOSED ON `undefined`. A route reached with NO auth middleware reads
  // undefined, which is not 'asymmetric', which is a refusal. The dangerous
  // spelling would have been `!== 'symmetric'`.
  const assurance = c.get('tokenAssurance');
  if (assurance !== 'asymmetric') {
    console.error(
      `[account] rid=${rid} app=${c.env.APP_ID} REFUSING ERASURE: this request was admitted with tokenAssurance=${assurance ?? 'none'}, and account deletion requires an ES256/JWKS-verified token. A shared HS256 secret is one leaked environment variable away from letting anyone erase any account, so it is not an acceptable proof for an irreversible route. Mount DELETE /v1/account behind erasureAuth.`,
    );
    return c.json({ error: 'erasure_requires_asymmetric_auth' }, 403);
  }

  const userId = c.get('userId');

  const deleted: Record<string, number> = {};
  const unlinked: Record<string, number> = {};

  let tables: string[];
  let references: Array<{ table: string; column: string }>;
  try {
    tables = await userOwnedTables(c.env.APP_DB);
    references = await userReferencingColumns(c.env.APP_DB);
  } catch (err) {
    console.error(`[account] rid=${rid} app=${c.env.APP_ID} schema read failed`, err);
    return c.json({ error: 'account_deletion_failed' }, 503);
  }

  // 🔴 AN EMPTY SET IS A FAILURE, NOT A FAST PATH. If the derivation ever stops
  // finding tables — a schema change, a driver that does not support
  // pragma_table_info — this route would delete NOTHING and report `ok: true`.
  // The caller (the shared erasure route) would then take that as permission to
  // delete the identity, and every row here would be orphaned behind a login that
  // no longer exists. Refuse instead.
  if (tables.length === 0) {
    console.error(
      `[account] rid=${rid} app=${c.env.APP_ID} refusing deletion: no user-owned table was found in subly_db, so this request would report success while erasing nothing`,
    );
    return c.json({ error: 'account_deletion_failed' }, 503);
  }

  for (const table of tables) {
    // The name comes from sqlite_master, not from the request — there is no
    // caller-controlled value in this string, and D1 cannot bind an identifier.
    const res = await c.env.APP_DB.prepare(`DELETE FROM ${table} WHERE user_id = ?`)
      .bind(userId)
      .run();
    deleted[table] = res.meta.changes ?? 0;
  }

  // Then the REFERENCES: after this, no `*_user_id` column in subly_db holds this
  // person's id. Table and column both come from sqlite_master.
  for (const { table, column } of references) {
    const res = await c.env.APP_DB.prepare(
      `UPDATE ${table} SET ${column} = NULL WHERE ${column} = ?`,
    )
      .bind(userId)
      .run();
    unlinked[`${table}.${column}`] = res.meta.changes ?? 0;
  }

  // `scope` is not decoration. This Worker erases ONE database; the identity and
  // the shared tables are the platform Worker's, and a caller that read a bare
  // `{ ok: true }` as "the account is gone" would be wrong in the one direction
  // that matters. Naming the scope makes the partial result unmistakable.
  return c.json({ ok: true, scope: 'subly_db', deleted, unlinked });
});

export default account;
