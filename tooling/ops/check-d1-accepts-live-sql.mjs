#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// check-d1-accepts-live-sql.mjs — THE STATEMENTS THIS REPOSITORY SENDS TO D1
// ARE EXECUTED AGAINST THE REAL DATABASES, BY THE REAL AUTHORIZER.
//
// [pipeline K-7] · the credentialled half of tooling/ci/assert-d1-sql-inventory
// .mjs, which is the secretless half and runs in ci.yml.
//
// ── WHY A LIVE CHECK EXISTS AT ALL, AND WHY NO STATIC ONE CAN REPLACE IT ────
// 🔴 EVERY IN-APP ACCOUNT DELETION IN PRODUCTION FAILED FROM THE DAY THE ROUTES
// SHIPPED UNTIL 2026-08-09, AND EVERY CHECK IN THIS REPOSITORY WAS GREEN. The
// erasure routes derived their table set from
// `FROM sqlite_master m JOIN pragma_table_info(m.name) p`; D1's authorizer
// refuses that statement at RUNTIME (7500, `not authorized: SQLITE_AUTH`), so
// the route threw before reading a row and answered 503. The unit suite runs
// real SQL through `node:sqlite`, which has no authorizer and ACCEPTS the join.
// assert-erasure-reach.mjs proves reachability by parsing migration files, so a
// statement D1 refuses looks perfectly reachable to it. A statement's legality
// is a property of the ENGINE, and the only way to learn it is to send it.
//
// ⚠️ `EXPLAIN` IS NOT A SHORTCUT AND WAS MEASURED NOT TO BE. EXPLAIN of the
// rejected join returns 200 and 19 rows of bytecode: the authorizer does not run
// for it. A checker built on EXPLAIN would have reported the outage query
// healthy, which is worse than no checker.
//
// ── THE FOUR STEPS, AND STEP 0 IS THE ONE THAT MAKES THE OTHERS MEAN ANYTHING ─
//   0. NEGATIVE CONTROL, FIRST, PER DATABASE. The statement that caused the
//      outage is sent verbatim and MUST come back refused with 7500. Every
//      "accepted" below is evidence only if something known-refused is refused
//      on the same connection, in the same run, against the same database.
//      A wrong-account token, a stubbed endpoint, or a D1 that stopped enforcing
//      all produce a clean sweep otherwise. Control fails ⇒ exit 2, and nothing
//      else is believed.
//   1. THE INTROSPECTIVE STATEMENTS, VERBATIM. The `sqlite_master` read as
//      written; then the per-table pragma once for each table that read returns
//      — which is exactly the two-step walk the routes perform.
//      🔄 APPENDED 2026-08-25 — the candidate tables come from the SCHEMA READ
//      ALONE, not from every introspective answer. Every one of them returns a
//      `name` column and a pragma's is the COLUMNS OF ONE TABLE, so when a route
//      shipped a hole-free `pragma_table_info('payment_history')` this step took
//      that table's six columns for the schema of subly_db, tried to erase a
//      table called `updated_at`, and reported step 2 as not-instantiable. The
//      probe is still SENT and still counted; what narrowed is what its answer
//      is allowed to mean. See [yieldsTableNames] in the shared inventory.
//   2. THE MUTATING DYNAMIC-IDENTIFIER STATEMENTS, EXECUTED, with identifiers
//      taken from the live schema and the bound key set to `d1guard-<uuid>`.
//      `meta.changes` must be 0.
//   3. COVERAGE. Zero statements executed, or zero tables seen, is exit 2 — not
//      a pass. A sweep over nothing is the failure this whole family exists for.
//
// ── A DECISION TAKEN, RECORDED WHERE IT IS EXECUTED ─────────────────────────
// ⚠️ THIS SENDS REAL `DELETE` AND `UPDATE` STATEMENTS TO PRODUCTION. Read-only
// verification was considered and rejected: the outage was in a statement's
// SHAPE, and a DELETE's shape is not exercised by reading. The safety is
// structural rather than promised — the bound key is a fresh UUID that matches
// no row, and `meta.changes === 0` is ASSERTED on every one, so a run that
// touched a row fails (exit 1) rather than passing quietly. Precedent: the e2e
// harness's purge.mjs sends real DELETEs against the same databases as a matter
// of routine. The owner may narrow this to read-only later; the argument for
// doing so is that no shape check is worth any write risk, and the argument
// against is that the shape which broke every deletion in production was a
// write path nothing executed.
//
// ── EXIT CODES ──────────────────────────────────────────────────────────────
//   0 = executed, and D1 accepted every statement (and refused the control).
//   1 = D1 REFUSED a statement this repository sends, or a mutating statement
//       changed a row. A real failure.
//   2 = COULD NOT LOOK — no credential, an unreadable inventory, an API answer
//       this script cannot interpret, or a negative control that was ACCEPTED.
//   1 BEATS 2 when both happen: "I could not look" must never bury "the thing
//   you deploy is refused". Same contract as tooling/e2e/verify_purged.mjs.
//
// 🔴 `process.exit()` IS BANNED BELOW THE FIRST fetch. Calling it with an undici
// keep-alive open crashes libuv on Windows (`Assertion failed: !(handle->flags &
// UV_HANDLE_CLOSING), src/win/async.c:94`) and the process then reports 127,
// which collapses 1 and 2 into each other. Set `process.exitCode` and RETURN.
// The argument and credential checks run before any request, so `process.exit`
// is correct there and only there.
//
// Usage:  node tooling/ops/check-d1-accepts-live-sql.mjs [--root <repoRoot>]
//                                                       [--fixture <json>]
// Env:    CLOUDFLARE_API_TOKEN (D1 read+write), CLOUDFLARE_ACCOUNT_ID
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

import {
  REJECTED_FIXTURE,
  REJECTION_CODE,
  REJECTION_MESSAGE,
  holePlaceholder,
  identifierRole,
  inventoryServices,
  isBareIdentifierExpression,
  yieldsTableNames,
} from '../ci/d1-sql-inventory.mjs';

const flag = (name) => {
  const i = process.argv.indexOf(name);
  return i === -1 || i + 1 >= process.argv.length ? null : process.argv[i + 1];
};

const ROOT = resolve(flag('--root') ?? process.cwd());
const FIXTURE_PATH = flag('--fixture');

/** How many live tables a single statement's instantiation may try before it is
 *  declared not-executable. Bounded so a wide schema cannot turn one statement
 *  into a hundred production writes. */
const CANDIDATE_LIMIT = 8;

// ── two findings, resolved at the end ───────────────────────────────────────
let refused = false; // D1 rejected something we ship, or a write changed a row
let blind = false; // a limb could not be read at all
const worse = (code) => {
  if (code === 1) refused = true;
  else if (code === 2) blind = true;
};

const norm = (sql) => String(sql).replace(/\s+/g, ' ').trim();

// ── the inventory, BEFORE any request ───────────────────────────────────────
let services;
try {
  services = inventoryServices(ROOT);
} catch (e) {
  console.error(`COULD NOT LOOK: the SQL inventory could not be built from ${ROOT} (${e.message}).`);
  process.exit(2); // safe: no fetch has happened
}
const withDatabases = services.filter((s) => s.databases.length > 0 && s.statements.length > 0);
if (withDatabases.length === 0) {
  console.error(
    'COULD NOT LOOK: no services/* Worker was found that both binds a D1 database and sends a statement.',
  );
  console.error(
    '  The domain is derived from services/*/wrangler.jsonc; an empty one means this check would execute ' +
      'nothing and report success, which is the exact state it exists to end.',
  );
  process.exit(2);
}

let fixture = null;
if (FIXTURE_PATH) {
  console.log('!!  OFFLINE FIXTURE MODE — --fixture is set. This must NEVER appear in a real CI or ops log.');
  try {
    fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));
  } catch (e) {
    console.error(`COULD NOT LOOK: could not read fixture ${FIXTURE_PATH}: ${e.message}`);
    process.exit(2);
  }
} else {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!token || !account) {
    console.error(
      'COULD NOT LOOK: CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID are not both in the environment.',
    );
    console.error(
      '  Exit 2, deliberately distinct from 1: a credential this step could not read must never be ' +
        'reported as a set of statements that verified.',
    );
    process.exit(2); // safe: no fetch has happened
  }
}

const KEY = `d1guard-${randomUUID()}`;

/**
 * One D1 query. Never throws: a thrown error here would end the run before the
 * findings already gathered had been reported.
 *
 * Returns `{ body }` for ANY answer D1 itself produced — including a refusal,
 * which arrives as HTTP 400 with `success: false` and is a RESULT, not a
 * transport failure — or `{ blind, why }` when nothing interpretable came back.
 * One retry on a network-level throw, because a single dropped socket must not
 * read as a schema finding.
 */
async function d1(dbId, sql, params = []) {
  if (fixture) {
    const body = fixture[norm(sql)] ?? fixture['*'];
    if (body === undefined) return { blind: true, why: `the fixture has no entry for \`${norm(sql).slice(0, 80)}\`` };
    return { body };
  }
  const url = `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/d1/database/${dbId}/query`;
  const send = () =>
    fetch(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ sql, params }),
    });
  let res;
  try {
    res = await send();
  } catch (first) {
    try {
      res = await send();
    } catch (second) {
      return { blind: true, why: `the D1 HTTP API was unreachable twice (${first.message}; ${second.message})` };
    }
  }
  let body;
  try {
    body = await res.json();
  } catch (e) {
    return { blind: true, why: `D1 answered HTTP ${res.status} with a body that is not JSON (${e.message})` };
  }
  if (typeof body?.success !== 'boolean') {
    return { blind: true, why: `D1 answered HTTP ${res.status} with no \`success\` field: ${JSON.stringify(body).slice(0, 200)}` };
  }
  return { body };
}

const accepted = (r) => r.body?.success === true;
const errorsOf = (r) => (Array.isArray(r.body?.errors) ? r.body.errors : []);
/**
 * 🔴 THE MESSAGE, NOT THE CODE. D1 returns 7500 for a syntax error and for
 * `no such column` as well as for the authorizer (measured 2026-08-09) — so the
 * first version of this predicate, which accepted the code alone, reported this
 * script's OWN bad substitution as "D1's authorizer will not run your deployed
 * statement". A guard whose loudest finding can be its own bug is a guard
 * nobody believes twice. The code is kept as a corroborating conjunct.
 */
const isAuthorizerRefusal = (r) =>
  !accepted(r) &&
  errorsOf(r).some(
    (e) => String(e?.message ?? '').includes(REJECTION_MESSAGE) && (e?.code === undefined || e.code === REJECTION_CODE),
  );
const rowsOf = (r) => r.body?.result?.[0]?.results ?? [];
const changesOf = (r) => Number(r.body?.result?.[0]?.meta?.changes ?? 0);

/** Fill a statement's `${…}` holes with real identifiers. */
const instantiate = (st, table, column) =>
  st.holes.reduce((sql, _expr, i) => {
    const role = identifierRole(st.sql, i);
    const value = role === 'table' ? table : role === 'column' ? column : null;
    return value === null ? sql : sql.split(holePlaceholder(i)).join(value);
  }, st.sql);

/** Every hole has a role this reader can name AND an expression that is a bare
 *  identifier. Both halves are required — see [isBareIdentifierExpression]. */
const fullyInstantiable = (st) =>
  st.holes.every((expr, i) => identifierRole(st.sql, i) !== null && isBareIdentifierExpression(expr));

// ── the sweep ───────────────────────────────────────────────────────────────
let databasesChecked = 0;

for (const svc of withDatabases) {
  const introspective = svc.statements.filter((s) => s.kind === 'introspective');
  const mutating = svc.statements.filter((s) => s.kind === 'dynamic-identifier' && s.mutating);

  for (const db of svc.databases) {
    console.log(`\n── services/${svc.id} → ${db.name} (${db.binding}) ──`);

    // ── STEP 0 · THE NEGATIVE CONTROL, BEFORE ANYTHING IS BELIEVED ──────────
    const control = await d1(db.id, REJECTED_FIXTURE);
    if (control.blind) {
      console.error(`COULD NOT LOOK: the negative control could not be sent — ${control.why}`);
      worse(2);
      continue;
    }
    if (!isAuthorizerRefusal(control)) {
      console.error(
        `COULD NOT LOOK: the NEGATIVE CONTROL WAS NOT REFUSED by ${db.name}. The statement that broke every ` +
          `account deletion in production came back ${accepted(control) ? 'ACCEPTED' : JSON.stringify(errorsOf(control)).slice(0, 160)}.`,
      );
      console.error(
        '  Nothing else in this run may be read as evidence: a harness that is not talking to a real ' +
          'authorizer would wave every statement through, and that is indistinguishable from a healthy sweep. ' +
          'Check the account id, the database id and the token scope before reading this as good news.',
      );
      worse(2);
      continue;
    }
    console.log(`ok  step 0 — the known-refused statement IS refused (${REJECTION_CODE} ${REJECTION_MESSAGE})`);
    databasesChecked++;

    // ── STEP 1 · THE INTROSPECTIVE STATEMENTS, VERBATIM ─────────────────────
    let tables = [];
    let executed = 0;
    // 🔴 DID ANYTHING THIS RUN ACTUALLY LIST THE DATABASE'S TABLES? Tracked
    // separately from `tables.length` because the two empty cases have opposite
    // causes and opposite fixes — a schema read that came back empty is a broken
    // read of a real database, and no schema read at all is an inventory that
    // never asked. Reporting the second as the first sent a reader looking for a
    // credential problem that was not there.
    let sawTableListing = false;
    for (const st of introspective.filter((s) => s.holes.length === 0)) {
      const r = await d1(db.id, st.sql);
      if (r.blind) {
        console.error(`COULD NOT LOOK: ${st.file}:${st.line} — ${r.why}`);
        worse(2);
        continue;
      }
      if (!accepted(r)) {
        console.error(
          `REFUSED: ${st.file}:${st.line} — D1 will not run \`${norm(st.sql).slice(0, 100)}\` against ${db.name}: ` +
            `${JSON.stringify(errorsOf(r)).slice(0, 200)}`,
        );
        worse(1);
        continue;
      }
      executed++;
      // 🔴 ONLY A SCHEMA-TABLE READ NAMES TABLES — see [yieldsTableNames]. Every
      // introspective answer has a `name` column; a pragma's is the COLUMNS of
      // one table. Harvesting candidates from all of them read
      // `SELECT name FROM pragma_table_info(<one table>)` as the schema of the
      // database and cost this check both erasure statements on 2026-08-25.
      if (yieldsTableNames(st.sql)) {
        sawTableListing = true;
        const names = rowsOf(r)
          .map((row) => row?.name)
          .filter((n) => typeof n === 'string' && /^[A-Za-z_][A-Za-z0-9_$]*$/.test(n) && !/^(sqlite_|d1_|_cf_)/.test(n));
        if (names.length > tables.length) tables = names;
      }
      console.log(`ok  step 1 — ${st.file}:${st.line} accepted, ${rowsOf(r).length} row(s)`);
    }

    if (tables.length === 0) {
      if (sawTableListing) {
        console.error(
          `COULD NOT LOOK: no table name came back from ${db.name}, so the per-table pragma and every mutating ` +
            'statement below had nothing real to be instantiated with. An empty schema read is a broken read, not ' +
            'an empty database — the erasure routes refuse (503) on exactly this condition.',
        );
      } else {
        console.error(
          `COULD NOT LOOK: nothing this check executed against ${db.name} LISTS THE DATABASE'S TABLES. Every ` +
            'hole-free introspective statement services/' +
            `${svc.id} sends is a pragma, which names one table's COLUMNS — so there is no candidate to ` +
            'instantiate a dynamic identifier with, and inventing one would prove nothing about the deployed ' +
            'statement. A schema read (sqlite_master/sqlite_schema) is what this step needs.',
        );
      }
      worse(2);
      continue;
    }

    for (const st of introspective.filter((s) => s.holes.length > 0)) {
      if (!fullyInstantiable(st)) {
        console.log(`⬜  step 1 — ${st.file}:${st.line} has a hole this reader will not guess a role for; not executed`);
        continue;
      }
      let ok = 0;
      for (const table of tables) {
        const sql = instantiate(st, table, null);
        const r = await d1(db.id, sql);
        if (r.blind) {
          console.error(`COULD NOT LOOK: ${st.file}:${st.line} for ${table} — ${r.why}`);
          worse(2);
          break;
        }
        if (!accepted(r)) {
          console.error(
            `REFUSED: ${st.file}:${st.line} — D1 will not run \`${norm(sql).slice(0, 100)}\` against ${db.name}: ` +
              `${JSON.stringify(errorsOf(r)).slice(0, 200)}`,
          );
          worse(1);
          break;
        }
        ok++;
      }
      if (ok > 0) {
        executed++;
        console.log(`ok  step 1 — ${st.file}:${st.line} accepted for all ${ok} table(s)`);
      }
    }

    // ── STEP 2 · THE MUTATING STATEMENTS, EXECUTED, changes === 0 ───────────
    // Identifiers come from the live schema. Tables that carry a user id are
    // tried first because that is what these statements are really written
    // against; a candidate that fails for a reason OTHER than the authorizer
    // (`no such column`) is a bad substitution by this reader, not a finding
    // about the route, so the next candidate is tried. An authorizer refusal on
    // ANY candidate is the finding, and it stops the loop.
    let mutated = 0;
    for (const st of mutating) {
      if (!fullyInstantiable(st)) {
        console.log(
          `⬜  step 2 — ${st.file}:${st.line} interpolates \`${st.holes.join('`, `')}\`, which is a SQL fragment ` +
            'rather than a bare identifier; it cannot be sent verbatim and is not executed here (R1 still covers it).',
        );
        continue;
      }
      const needsColumn = st.holes.some((_e, i) => identifierRole(st.sql, i) === 'column');
      let done = false;
      let lastError = null;
      for (const table of tables.slice(0, CANDIDATE_LIMIT)) {
        const cols = await columnsOf(db.id, table);
        if (cols === null) { worse(2); break; }
        const column = cols.find((c) => /_user_id$/.test(c)) ?? cols.find((c) => /user_id$/i.test(c)) ?? null;
        if (needsColumn && column === null) continue;
        const params = new Array((instantiate(st, table, column).match(/\?/g) ?? []).length).fill(KEY);
        const sql = instantiate(st, table, column);
        const r = await d1(db.id, sql, params);
        if (r.blind) {
          console.error(`COULD NOT LOOK: ${st.file}:${st.line} — ${r.why}`);
          worse(2);
          done = true;
          break;
        }
        if (isAuthorizerRefusal(r)) {
          console.error(
            `REFUSED: ${st.file}:${st.line} — D1's authorizer will not run \`${norm(sql).slice(0, 100)}\` against ` +
              `${db.name}. This is the outage class: the statement is deployed and cannot execute.`,
          );
          worse(1);
          done = true;
          break;
        }
        if (!accepted(r)) {
          lastError = JSON.stringify(errorsOf(r)).slice(0, 160);
          continue; // a bad substitution by this reader; try the next table
        }
        const changes = changesOf(r);
        if (changes !== 0) {
          console.error(
            `FAIL: ${st.file}:${st.line} was executed against ${db.name} with the key \`${KEY}\` — which matches no ` +
              `row by construction — and reported ${changes} change(s). Either the key leaked into a real row or ` +
              'this statement does not filter on the bound parameter at all. Both are worse than a refused query.',
          );
          worse(1);
          done = true;
          break;
        }
        mutated++;
        console.log(`ok  step 2 — ${st.file}:${st.line} executed on ${table}, changes=0`);
        done = true;
        break;
      }
      if (!done) {
        console.error(
          `COULD NOT LOOK: ${st.file}:${st.line} could not be instantiated against ${db.name} from the live schema ` +
            `(tried ${Math.min(tables.length, CANDIDATE_LIMIT)} table(s)${lastError ? `; last answer ${lastError}` : ''}). ` +
            'The statement is deployed and this check did not execute it.',
        );
        worse(2);
      }
    }

    // ── STEP 3 · COVERAGE ──────────────────────────────────────────────────
    if (executed === 0 || (mutating.length > 0 && mutated === 0)) {
      console.error(
        `COULD NOT LOOK: ${db.name} — ${executed} introspective and ${mutated} mutating statement(s) actually ran, ` +
          `out of ${introspective.length} and ${mutating.length} in the inventory. A sweep that executes nothing ` +
          'prints the same "ok" as a sweep that executes everything, which is the failure this file exists for.',
      );
      worse(2);
    } else {
      console.log(`ok  ${db.name} — ${executed} introspective and ${mutated} mutating statement(s) executed`);
    }
  }
}

if (databasesChecked === 0) {
  console.error(
    'COULD NOT LOOK: not one database passed the negative control, so nothing above is evidence about D1.',
  );
  worse(2);
}

if (refused) {
  console.error(
    '\nD1 REFUSES A STATEMENT THIS REPOSITORY DEPLOYS, or a guarded write touched a row. The last time this was ' +
      'true, every in-app account deletion in production had been failing for months and every check was green. ' +
      '[pipeline K-7]',
  );
} else if (blind) {
  console.error(
    '\nThis check COULD NOT COMPLETE, so nothing above may be read as proof that the deployed SQL runs. Exit 2 is ' +
      'deliberately not 1: fix the access, then re-run.',
  );
} else {
  console.log(
    `\nPASS: every introspective and mutating statement in ${databasesChecked} live database(s) was EXECUTED and ` +
      'accepted, each database having first refused the known-bad control. [pipeline K-7]',
  );
}

// `exitCode`, not `exit()` — see the header. Undici keep-alives are open by now.
process.exitCode = refused ? 1 : blind ? 2 : 0;

/** Column names of one live table, or `null` after printing why. The pragma is
 *  fed a LITERAL, which is the form D1 was measured to accept. */
async function columnsOf(dbId, table) {
  if (!/^[A-Za-z_][A-Za-z0-9_$]*$/.test(table)) return [];
  const r = await d1(dbId, `SELECT name FROM pragma_table_info('${table}')`);
  if (r.blind) {
    console.error(`COULD NOT LOOK: the columns of ${table} — ${r.why}`);
    return null;
  }
  if (!accepted(r)) {
    console.error(`COULD NOT LOOK: the columns of ${table} — ${JSON.stringify(errorsOf(r)).slice(0, 160)}`);
    return null;
  }
  return rowsOf(r).map((row) => row?.name).filter((n) => typeof n === 'string');
}
