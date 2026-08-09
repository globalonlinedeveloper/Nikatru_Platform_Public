// ─────────────────────────────────────────────────────────────────────────────
// verify_purged.mjs — the SERVER-SIDE half of N-6's leg 6, "account delete
// purges". Node 20+ global fetch only, no SDK.
//
// `integration_test/app_test.dart` taps Delete account inside the running web
// app, watches the deployed erasure route answer, and asserts the app says
// "Account deleted". That is the app's own account of what happened, and a
// client can only ever report what it was told: a server that deleted nothing
// and returned `{ ok: true }` produces exactly the same green screen. That
// failure is invisible from inside the app and permanent for the user, which is
// why this file exists as a SEPARATE step with no app in the loop.
//
// It re-reads the two stores the deletion is supposed to have emptied:
//
//   A. THE IDENTITY — GoTrue's admin API, with the service-role key. The user
//      must be unresolvable (404). A 200 means the login still works, which is
//      the 502 case the platform route is written to report and the one thing a
//      user is told is impossible.
//   B. THE APP'S ROWS — live D1 (subly_db), through the same Cloudflare HTTP API
//      `verify_row.mjs` uses. Every user-owned table must hold ZERO rows for the
//      deleted id.
//
// ── THE TABLE SET IS DERIVED, NEVER LISTED ──────────────────────────────────
// 🔴 `purge.mjs` carries `['payment_history', 'subscriptions', 'budget_categories',
// 'budgets']` — a hand list, correct today. A verifier built on a hand list
// checks the tables somebody remembered, so the day a migration adds a
// user-owned table this file would report "fully purged" over rows it never
// looked at, and would go on doing so forever. So the SCHEMA answers: the same
// `sqlite_master ⋈ pragma_table_info` query the route itself derives its DELETE
// targets from. If the route's derivation and this one ever disagree, they
// disagree loudly rather than silently — which is the only useful relationship
// between an eraser and its auditor.
//
// ── EXIT CODES, AND WHY THERE ARE THREE ─────────────────────────────────────
//   0 = looked, and both stores are empty.
//   1 = looked, and something SURVIVED the deletion. A real failure.
//   2 = COULD NOT LOOK — a missing credential, an unreadable schema, an API
//       that answered something this script cannot interpret. Deliberately
//       distinct from 1, because "I could not look" must never be readable as
//       "I looked and it was fine". Same contract as
//       tooling/ops/verify-alarm-chains.mjs.
//   1 BEATS 2 when both happen, and that ordering is chosen rather than
//   inherited: `Math.max` over the codes would report a blind D1 read OVER a
//   confirmed survivor, burying the one finding that names a real bug under the
//   one that names an access problem. Both fail the step, so the code decides
//   only what a human reads first.
//
// 🔴 `process.exit()` IS BANNED BELOW THE FIRST fetch, AND THAT IS A BUG FIX
// SOMEBODY ELSE ALREADY PAID FOR. Calling it while an undici keep-alive handle
// is open crashes libuv on Windows —
// `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), src/win/async.c:94` —
// and the process then reports 127 instead of the code documented above, which
// collapses 1 and 2 into each other. Set `process.exitCode` and RETURN; Node
// drains its handles and exits with that code on its own. The env-var checks at
// the top run before any request, so `process.exit(2)` is safe there and only
// there — exactly the shape `verify_row.mjs` terminates with.
//
// Env: E2E_DELETE_USER_ID, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
//      CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, SUBLY_D1_DATABASE_ID
// NOTE: CLOUDFLARE_API_TOKEN needs D1 READ access for this account.
// ─────────────────────────────────────────────────────────────────────────────

/** The route whose EFFECT this file audits — the in-app "Delete account" tap
 *  reaches the shared platform Worker's `DELETE /v1/account`, which sweeps
 *  platform_db, relays to subly-api's own `/v1/account` for subly_db, and
 *  deletes the identity last. Named as a value rather than in prose because
 *  tooling/ci/assert-e2e-legs.mjs reads this harness COMMENT-STRIPPED: a
 *  sentence describing the step is exactly what a nightly that does not run it
 *  would also contain. */
const ERASURE_ROUTE = '/v1/account';

/** Tables SQLite/D1 own. Never a user-data target, whatever they are called. */
const RESERVED = /^(sqlite_|d1_|_cf_)/;

const userId = need('E2E_DELETE_USER_ID');
const supaUrl = need('SUPABASE_URL').replace(/\/+$/, '');
const serviceKey = need('SUPABASE_SERVICE_ROLE_KEY');
const acct = need('CLOUDFLARE_ACCOUNT_ID');
const dbId = need('SUBLY_D1_DATABASE_ID');
const token = need('CLOUDFLARE_API_TOKEN');

console.log(
  `Auditing the effect of DELETE ${ERASURE_ROUTE} for user ${userId} — ` +
    'the identity record and every user-owned row in subly_db.',
);

// TWO INDEPENDENT FINDINGS, RESOLVED AT THE END — not one number raised as it
// goes. `Math.max` would order the codes 0 < 1 < 2 and report "could not look"
// over a CONFIRMED SURVIVOR, which is the loudest thing this script can find and
// the only one that names a real bug. Both codes fail the step in CI, so the
// difference is entirely what a human reads first, and a blind D1 read must not
// bury "the deleted account still signs in".
let survived = false; // something the deletion should have erased is still there
let blind = false; // a limb could not be read at all
const worse = (code) => {
  if (code === 1) survived = true;
  else if (code === 2) blind = true;
};

// ── A · THE IDENTITY ────────────────────────────────────────────────────────
// 404 is the goal state. 200 is the failure the user cannot see. Anything else
// is "could not look" — a 401 here says the key is wrong, not that the account
// survived, and reporting that as a survivor would send somebody hunting a
// deletion bug that is not there.
let identity;
try {
  identity = await fetch(
    `${supaUrl}/auth/v1/admin/users/${encodeURIComponent(userId)}`,
    { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } },
  );
} catch (e) {
  console.error(`COULD NOT LOOK: the GoTrue admin API was unreachable (${e.message}).`);
  identity = null;
  worse(2);
}

if (identity && identity.status === 404) {
  console.log('PASS: the identity record is gone (GoTrue admin read → 404).');
} else if (identity && identity.ok) {
  console.error(
    `FAIL: the auth user ${userId} STILL RESOLVES (HTTP ${identity.status}) after the in-app ` +
      'deletion reported success. The same email and password can still sign in — this is the ' +
      'exact "your data is gone and your login is not" outcome the platform route reports as 502, ' +
      'and the app told the user their account was deleted.',
  );
  worse(1);
} else if (identity) {
  console.error(
    `COULD NOT LOOK: the GoTrue admin read answered HTTP ${identity.status}, which is neither ` +
      '404 (gone) nor 2xx (still there). Check SUPABASE_SERVICE_ROLE_KEY before reading this as ' +
      'a deletion failure.',
  );
  worse(2);
}

// ── B · THE APP'S ROWS, over a schema-derived table set ─────────────────────
const tables = await userOwnedTables();

if (tables === null) {
  // The schema read itself failed; d1() has already said why.
  worse(2);
} else if (tables.length === 0) {
  // 🔴 AN EMPTY SET IS NOT A CLEAN BILL OF HEALTH. Zero user-owned tables means
  // this audit has nothing to look at, and every count below would trivially be
  // "0 rows, all clear". The erasure route itself refuses (503) on exactly this
  // condition for the mirror-image reason.
  console.error(
    'COULD NOT LOOK: no user-owned table was found in subly_db, so this audit would report ' +
      '"nothing survived" without reading a single row. The route derives its DELETE targets from ' +
      'the same query, so an empty set here means the derivation is broken, not that the database ' +
      'is clean.',
  );
  worse(2);
} else {
  console.log(`Schema-derived user-owned tables in subly_db: ${tables.join(', ')}`);
  for (const table of tables) {
    // eslint-disable-next-line no-await-in-loop
    const rows = await countFor(table);
    if (rows === null) {
      worse(2);
      continue;
    }
    if (rows > 0) {
      console.error(
        `FAIL: ${table} still holds ${rows} row(s) for the deleted user. The in-app deletion ` +
          'reported success and this data survived it.',
      );
      worse(1);
    } else {
      console.log(`ok  ${table}: 0 row(s)`);
    }
  }
}

if (survived) {
  console.error(
    "The golden path's delete leg is BROKEN against production: the app told a user their account " +
      'was deleted, and the stores disagree.',
  );
  if (blind) {
    console.error(
      '  (Another limb of this audit also could not be read, so the damage above may be the ' +
        'smaller half of it.)',
    );
  }
} else if (blind) {
  console.error(
    'This audit COULD NOT COMPLETE, so nothing above may be read as proof that the deletion ' +
      'worked. Exit 2 is deliberately not 1: fix the access, then re-run.',
  );
} else {
  console.log(
    'PASS: the in-app account deletion really erased this user — the identity is unresolvable and ' +
      'every user-owned table in subly_db is empty for it. [pipeline N-6 leg 6]',
  );
}

// `exitCode`, not `exit()` — see the header. Undici keep-alives are open by now.
process.exitCode = survived ? 1 : blind ? 2 : 0;

// ── helpers ─────────────────────────────────────────────────────────────────

/** Every table in subly_db carrying a `user_id` column, straight from the
 *  schema. `null` = the read failed.
 *
 * 🔴 IT IS TWO STEPS BECAUSE D1 REFUSES THE ONE-STEP FORM. This used to be the
 * single correlated join the erasure routes use:
 *
 *     FROM sqlite_master m JOIN pragma_table_info(m.name) p
 *
 * D1 rejects that with `not authorized: SQLITE_AUTH` (code 7500), and the rule
 * is about one statement naming both things rather than about where the pragma's
 * argument came from: any single statement that names sqlite_master/sqlite_schema
 * AND calls a pragma_* table-valued function is rejected — join, subquery, CTE
 * and correlated scalar subquery alike (measured 2026-08-09 against both
 * production databases). The same pragma fed a literal, a bound parameter or a
 * VALUES list is accepted, and so is a plain sqlite_master read. So the
 * derivation is: list the tables, then ask each one for its columns.
 *
 * ⚠️ THE WORDING HERE WAS WRONG UNTIL THE SAME MEASUREMENT WAS RE-READ. It said
 * "a table-valued function whose argument is a column from another table is not
 * allowed" — falsified by the accepted VALUES and bound-parameter forms, and it
 * would have licensed a CTE rewrite that is refused too. Both erasure routes
 * carried the identical sentence, so the three copies corroborated each other.
 * It now lives once, as `MEASURED_CAUSE` in tooling/ci/d1-sql-inventory.mjs, and
 * tooling/ci/assert-d1-sql-inventory.mjs pins all three against it.
 *
 * ⚠️ THIS IS THE SAME DEFECT THAT BROKE THE ROUTES THEMSELVES. They were fixed
 * in #256 (both now walk the schema in two steps); this file was fixed first, so
 * that leg 6 would not fail again here for the identical reason on the day they
 * landed. The property is unchanged: the SCHEMA still answers, so a migration
 * that adds a user-owned table is covered with no edit. */
async function userOwnedTables() {
  const listed = await d1(
    `SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`,
    [],
  );
  if (listed === null) return null;
  const candidates = (listed?.[0]?.results ?? [])
    .map((r) => r.name)
    .filter(
      (n) =>
        typeof n === 'string' &&
        !RESERVED.test(n) &&
        // The name is interpolated into the pragma below (D1 cannot bind an
        // identifier), so anything that is not a plain identifier is refused
        // rather than quoted. It comes from sqlite_master, never from an
        // argument — but the string still gets built.
        /^[A-Za-z_][A-Za-z0-9_$]*$/.test(n),
    );

  const owned = [];
  for (const table of candidates) {
    // eslint-disable-next-line no-await-in-loop
    const cols = await d1(
      `SELECT name FROM pragma_table_info('${table}') WHERE name = 'user_id'`,
      [],
    );
    if (cols === null) return null; // a failed read is not "no user_id"
    if ((cols?.[0]?.results ?? []).length > 0) owned.push(table);
  }
  return owned;
}

/** Surviving rows for the deleted user in one table. `null` = the read failed.
 *
 *  The table name is interpolated because D1 cannot bind an identifier — it
 *  comes from sqlite_master, never from an argument, and RESERVED has already
 *  filtered the engine's own tables. The USER ID is bound. */
async function countFor(table) {
  if (!/^[A-Za-z_][A-Za-z0-9_$]*$/.test(table)) {
    console.error(`COULD NOT LOOK: refusing to query the non-identifier table name ${JSON.stringify(table)}.`);
    return null;
  }
  const result = await d1(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id = ?`, [userId]);
  if (result === null) return null;
  return Number(result?.[0]?.results?.[0]?.n ?? 0);
}

/** One D1 HTTP query. Returns `json.result`, or `null` after printing why —
 *  never throws, because a thrown error here would end the run before the
 *  identity finding above had been reported. */
async function d1(sql, params) {
  let res;
  try {
    res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${acct}/d1/database/${dbId}/query`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ sql, params }),
      },
    );
  } catch (e) {
    console.error(`COULD NOT LOOK: the D1 HTTP API was unreachable (${e.message}).`);
    return null;
  }
  let json;
  try {
    json = await res.json();
  } catch (e) {
    console.error(`COULD NOT LOOK: D1 answered HTTP ${res.status} with a body that is not JSON (${e.message}).`);
    return null;
  }
  if (!res.ok || !json.success) {
    console.error(
      `COULD NOT LOOK: D1 query failed — HTTP ${res.status} ${JSON.stringify(json.errors ?? json)}`,
    );
    return null;
  }
  return json.result;
}

function need(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`COULD NOT LOOK: missing required env var ${name}.`);
    console.error(
      '  Exit code 2, deliberately distinct from 1: a credential this step could not read must ' +
        'never be reported as a deletion that verified.',
    );
    process.exit(2); // safe: this runs BEFORE any fetch, so no undici handle is open
  }
  return v;
}
