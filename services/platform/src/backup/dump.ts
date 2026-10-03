// ─────────────────────────────────────────────────────────────────────────────
// The three primitives the nightly export is built from: read a D1 database
// through its BINDING, read a KV namespace through its BINDING, and turn either
// result into a gzipped, digested blob ready for R2.
//
// 🔴 WHY THE BINDING AND NOT `wrangler d1 export`. The CLI cannot run inside a
// Worker, and the REST export API (`POST /accounts/:a/d1/database/:id/export`)
// needs an account-scoped API token WITH D1 EDIT, held as a secret by the one
// Worker every app in the portfolio depends on, and polled asynchronously across
// invocations. That is a new long-lived credential and a new state machine, to
// back up 286 KB + 82 KB. The binding needs no credential at all, runs in one
// invocation, and — the part that decided it — can be tested against
// test/harness.ts's REAL sqlite engine with the REAL migrations, so "the dump
// round-trips" is a property this repo can prove rather than assert.
//
// ⚠️ AND IT HAS A CEILING THE REST PATH DOES NOT. Every statement is one D1
// query and `d1.queriesPerInvocation` is 50 on the plan of record's recorded
// value. It does NOT degrade quietly: the budget is counted, exhaustion sets
// `truncated`, and `truncated` turns the run RED (see index.ts), while
// `d1-budget` turns red first, once a night spends most of the pool. When that
// day comes, the known next step is the REST export named above, driven from a
// Workflow so its polling can span invocations, and paying for it with the
// credential this file was written to avoid. No runbook holds that procedure
// yet; this paragraph is where it is written down.
//
// ⏱ 2026-10-01 · ops-watch run 36810231743: `d1-budget` RED at 37 of 42 (88%),
// platform_db 29 + subscriptiontracker_db 8, export complete. THE COST WAS ONE
// QUERY PER TABLE, so every migration that added a table moved the night one
// query closer to a truncated backup — three did on the day it went red. IT IS
// NOW FLAT IN THE TABLE COUNT. A database costs three statements whatever its
// table count: the catalogue, ONE column read for every table, and ONE read
// that pages every table at once (columnsOf). That stays true up to
// TABLES_PER_READ tables a database; only a single table's volume past one
// page (D1_PAGE_ROWS rows or D1_PAGE_BYTES bytes) adds a round.
// MEASURED 2026-10-01 against both production databases (read-only, through
// this function, pages rewritten to LIMIT 0): the four shapes of that day
// ACCEPTED, the known-refused statement refused on the same connection, 4 + 4
// of 42.
//
// ⏱ 2026-10-01 · review of #1108 (fix-backup-d1-budget). TWO DEFECTS IN THE
// PAGE, BOTH FIXED HERE. (1) It paged by LIMIT … OFFSET with no ORDER BY, so a
// row deleted between two rounds shifted every later row down one place and
// the next page started one row late: the reviewer lost row 5001 of 10,000
// while the dump said complete. A page now starts AFTER THE LAST ROWID READ
// (keyset), so a row that exists for the whole night cannot be skipped. (2)
// Each table's page was sized by its WIDEST row, read in a fourth statement, so
// one 4,749-byte webhook body made every page of provider_notifications ~210
// rows: a round per 210 rows, the 80% line near 5.7k rows and a truncated night
// near 8k. A page now accumulates rows, in rowid order, until D1_PAGE_BYTES of
// UTF-8 — sized by what the rows ARE, not by the worst one — and the size
// statement is gone.
// MEASURED 2026-10-01 (review of #1118, finding 4) against both production
// databases, read-only, through this function, every page rewritten to LIMIT 0
// and asserted so before it was sent: the known-refused statement refused
// (SQLITE_AUTH) on the same connection first; then hex()/typeof(), the
// CAST … AS BLOB byte length, the nullif + `||` mask, count/row_number/sum
// OVER, the catalogue, the column read, the first page (28 tables of
// platform_db, 8 of subscriptiontracker_db, one statement each) and the keyset
// page (`WHERE rowid > n`, same tables) all ACCEPTED, every page answering the
// empty page. 3 + 3 queries.
//
// 🔴 NOT `db.batch()`, AND THIS IS WHY. tooling/ceilings.json records that the
// vendor does not say whether a batch of N statements spends one query or N, and
// mandates the worst-case reading for every derivation: N. Under that reading a
// batch of one page per table costs exactly what the old loop cost, so it would
// have turned `d1-budget` green by changing the accounting rather than the
// spend. Each read here is ONE statement, which is one query under either
// reading. And not one `UNION ALL` either: D1 refuses a compound SELECT past a
// handful of terms (measured, services/_shared/src/erasure.ts) — the scalar
// subqueries of columnsOf are not a compound SELECT.
// ─────────────────────────────────────────────────────────────────────────────
import type { SqlDb } from '../../../_shared/src/ports/sql';
import type { KvStore } from '../../../_shared/src/ports/kv';

/**
 * Rows read from ONE table per read round, at most.
 *
 * @ceiling none — bounds the size of ONE result set, not a platform resource;
 *   the platform resource a page can exhaust is bytes, which D1_PAGE_BYTES
 *   bounds. A bigger page spends FEWER queries, so this moving up is safer, not
 *   riskier.
 */
export const D1_PAGE_ROWS = 5000;

/**
 * Bytes of JSON (UTF-8) one table's page may carry in a read round.
 *
 * @ceiling none — half of D1's 2,000,000-byte "Maximum string, BLOB or table row
 *   size" (https://developers.cloudflare.com/d1/platform/limits/), which no row
 *   of tooling/ceilings.json records. A table's page arrives as ONE
 *   `json_group_array` string, so a fixed row count is not a safe page: rows
 *   here run from 71 bytes to 4,749 (provider_notifications' webhook bodies,
 *   measured 2026-10-01), and 1,000 of the widest would be 4.7 MB — SQLITE_TOOBIG,
 *   a RED night. So a page takes rows in rowid order while their running total
 *   of BYTES stays under this (tableReadSql), and its first row always — a row
 *   wider than this alone is the one page that can pass it, and is refused
 *   (PAGE_RETRY_SHRINK). The half left over is D1's own margin.
 *
 * 🔴 BYTES, NOT CHARACTERS. SQLite's `length()` of TEXT counts characters, so a
 *   page of three-byte characters sized by it is three times the cap it was
 *   sized to. Every size here is `length(CAST(… AS BLOB))`, the UTF-8 byte count.
 */
export const D1_PAGE_BYTES = 1_000_000;

/**
 * What one page that came back past D1_PAGE_BYTES, or one read that D1 refused,
 * divides its tables' byte target by for their ONE retry.
 *
 * @ceiling none — a retry policy, not a platform resource. A page can pass the
 *   cap only when the byte count in SQL and the bytes that arrived disagree, or
 *   when a single row is wider than the cap; a quarter absorbs the first, and
 *   nothing absorbs the second. So a table's page shrinks ONCE, and a second
 *   failure throws: a RED night that names the table, never a quiet one.
 */
export const PAGE_RETRY_SHRINK = 4;

/**
 * Bytes the page's own wrapper adds around its rows — `[<count>,[` and `]]`.
 * The rows' byte target is D1_PAGE_BYTES less this, so a full page meets the cap
 * exactly rather than passing it by the brackets.
 *
 * @ceiling none — an allowance carved out of D1_PAGE_BYTES for the wrapper's
 *   own brackets, not a platform resource; D1_PAGE_BYTES carries the bound.
 */
const PAGE_ENVELOPE_BYTES = 64;

/**
 * Tables read by ONE statement.
 *
 * @ceiling none — D1 caps a table, and a result set, at 100 columns
 *   (https://developers.cloudflare.com/d1/platform/limits/ "Maximum columns per
 *   table"), and no row of tooling/ceilings.json records it. Each table is one
 *   result column of one read (columnsOf), so half that cap leaves the margin, and a
 *   database past 50 tables costs one more statement per round, not one per table.
 */
export const TABLES_PER_READ = 50;

/**
 * Arguments one `json_array(...)` call may take.
 *
 * @ceiling none — D1's "Maximum arguments per SQL function" is 32
 *   (https://developers.cloudflare.com/d1/platform/limits/), and no row of
 *   tooling/ceilings.json records it. `node:sqlite` allows far more, so a row
 *   built as ONE json_array over a wide table would pass every test here and be
 *   refused at 02:30. Columns are therefore grouped by this many, and the groups
 *   wrapped in one more json_array: 32 × 32 covers D1's 100-column table cap.
 */
export const SQL_FUNCTION_ARGS = 32;

/**
 * Bytes one statement this file builds may reach before it is split.
 *
 * @ceiling none — under D1's 100,000-byte "Maximum SQL statement length"
 *   (https://developers.cloudflare.com/d1/platform/limits/), with a tenth left as
 *   margin; no row of tooling/ceilings.json records it. Today's widest read is a
 *   few kilobytes.
 */
export const MAX_STATEMENT_BYTES = 90_000;

/**
 * Keys listed per `KvStore.list()` call — the vendor's own page size.
 *
 * @ceiling none — this is the KV list API's maximum page, not a cap this code
 *   chooses. Asking for more returns 1000 anyway.
 */
export const KV_LIST_PAGE = 1000;

/**
 * The `generator` a D1 dump's meta line names: the dump FORMAT, read by
 * d1RestoreStatements.
 *
 * `/2` (2026-10-01): a BLOB value is written as `{"$blob": "<base64>"}` — the one
 * JSON object a row value can be, since every other value is a string, a number
 * or null — and rows are in rowid order. `/1` dumps held no BLOB (json_array
 * threw on one) and still restore.
 */
export const D1_DUMP_GENERATOR = 'platform-worker-backup/2';

/** One JSON-lines record in a D1 dump. Discriminated so a restore can stream. */
export type D1DumpLine =
  | { kind: 'meta'; database: string; exportedAt: string; generator: string }
  | { kind: 'schema'; table: string; sql: string }
  | { kind: 'index'; name: string; sql: string }
  | { kind: 'row'; table: string; data: Record<string, unknown> }
  | { kind: 'table-end'; table: string; rows: number; truncated: boolean; ephemeral?: true; withheld?: number }
  | { kind: 'end'; tables: number; rows: number; truncated: boolean; queries: number };

export interface D1DumpResult {
  /** The dump itself, newline-delimited JSON. */
  jsonl: string;
  tables: string[];
  rows: number;
  queries: number;
  /** TRUE when the query budget ran out before the data did. Never green. */
  truncated: boolean;
  /** Plain-text credential values written as '' instead (CREDENTIAL_COLUMNS). */
  withheld: number;
}

/**
 * The run's ONE D1 query pool, shared by every database the export reads.
 *
 * 🔴 `spent` IS CHARGED BEFORE EACH QUERY IS AWAITED, so a query that throws is
 * still a query spent. A number handed back only on success lost the spend of
 * a database whose dump threw, and the next database was then handed a budget
 * the invocation no longer had.
 */
export interface D1QueryPool {
  readonly budget: number;
  spent: number;
}

/**
 * SQLite identifiers this dumper will quote into SQL.
 *
 * The names come from `sqlite_master` — the database's own catalogue, not from
 * any request — so injection is not the threat being defended against here. The
 * threat is a name this code cannot quote correctly producing a SILENTLY EMPTY
 * table in a backup. Refusing loudly is the only safe answer to that.
 */
const SAFE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_$]*$/;

/**
 * ⏱ 2026-09-30 · ADR no.NNN (native sign-in attestation). Tables whose rows are
 * EPHEMERAL by design and worthless after a restore: a redeemed challenge nonce
 * guards a replay for the challenge's own 120 seconds, and a daily counter only
 * counts today. Their SCHEMA is exported (a restore recreates them, empty) and
 * their rows are not — they are left out of the column read and of every
 * table read (test/backup-export.test.ts).
 */
export const EPHEMERAL_TABLES: ReadonlySet<string> = new Set(['native_attest_redeemed', 'native_attest_counters']);

/**
 * ⏱ 2026-09-30 · review round 2 (security): "provider refresh tokens are plain
 * text in D1 and in every R2 backup". THE PLAIN-TEXT CREDENTIAL COLUMNS, which a
 * dump NEVER carries a value of. The token itself is backed up — as the
 * AES-256-GCM ciphertext in `provider_tokens.token_ct` (src/lib/token-crypto.ts),
 * which is useless without the Worker secret TOKEN_ENC_KEY_V1, held in no backup.
 * These columns are the legacy plain-text ones: every write since migration 0023
 * leaves them empty and the nightly `provider_token_backfill` empties the rest.
 *
 * 🔴 WITHHELD HERE TOO, AND NOT ONLY EMPTIED AT THE SOURCE, because the backup
 * runs at 02:30 and the backfill at 06:00: a deploy after 06:00 would otherwise
 * put one night of plain text in R2. A withheld value is written as '' (the
 * columns are NOT NULL, so a restore still loads) and counted as `withheld` on
 * the table's end line — never red: the row still holds the value in D1, and a
 * red export would cost the whole night's backup to keep one token out of it.
 * test/token-encryption.test.ts fails if a named column stops existing, since a
 * rename would leave this list withholding nothing.
 */
export const CREDENTIAL_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  provider_tokens: ['refresh_token'],
  apple_provider_tokens: ['refresh_token'],
};

/** Tables that are the vendor's bookkeeping, not the portfolio's data. */
function isInternalTable(name: string): boolean {
  return name.startsWith('sqlite_') || name.startsWith('_cf_');
}

/**
 * `items` in runs of at most `max`, each run's rendered SQL under
 * MAX_STATEMENT_BYTES. Every statement below is built from one run, so a long
 * schema costs one more statement, never one that D1 refuses for its length.
 */
function runsOf(items: readonly string[], max: number, bytes: (item: string) => number): string[][] {
  const out: string[][] = [];
  let run: string[] = [];
  let size = 0;
  for (const item of items) {
    const n = bytes(item);
    if (run.length > 0 && (run.length >= max || size + n > MAX_STATEMENT_BYTES)) {
      out.push(run);
      run = [];
      size = 0;
    }
    run.push(item);
    size += n;
  }
  if (run.length > 0) out.push(run);
  return out;
}

/**
 * The VALUES list that feeds the column read every table in a run at once.
 *
 * A pragma fed a VALUES list is one of the shapes D1 was measured to accept
 * (tooling/ci/d1-sql-inventory.mjs); the column read does not name the schema
 * table, which is the half of the refused shape it must never carry. The names
 * are SAFE_IDENTIFIER-checked before they reach here, so they quote as literals.
 */
function valuesOf(tables: readonly string[]): string {
  return tables.map((t) => `('${t}')`).join(', ');
}

/**
 * The names SQLite answers to for a rowid table's rowid, in the order this
 * dumper prefers them. A column of the same name hides one, so the first a
 * table does not shadow is its keyset (keyOf).
 */
const ROWID_ALIASES = ['rowid', '_rowid_', 'oid'] as const;

/**
 * The column one table is paged by: its rowid, under a name no column shadows.
 *
 * 🔴 A WITHOUT ROWID TABLE IS REFUSED, LOUDLY. It has no rowid to page after,
 * none exists in either database today, and its first migration turns every
 * round-trip test here red against the real schema — which is when its keyset
 * (its PRIMARY KEY) gets written, not guessed at now.
 */
function keyOf(databaseName: string, table: string, columns: readonly string[], sql: string): string {
  if (/\bWITHOUT\s+ROWID\b/i.test(sql.slice(sql.lastIndexOf(')')))) {
    throw new Error(
      `refusing to dump ${databaseName}: table ${table} is WITHOUT ROWID, and this dumper pages by rowid — it would have to page by a key it was never written for`,
    );
  }
  const taken = new Set(columns.map((c) => c.toLowerCase()));
  const key = ROWID_ALIASES.find((alias) => !taken.has(alias));
  if (key === undefined) {
    throw new Error(`refusing to dump ${databaseName}: every name of ${table}'s rowid (${ROWID_ALIASES.join(', ')}) is a column, so it cannot be paged`);
  }
  return key;
}

/**
 * One column's value as JSON can carry it. A BLOB becomes its hex — TEXT,
 * which rowElement's mask marks as a BLOB — because `json_array` throws on a
 * BLOB, and the old page would have turned one into a RED night.
 */
function columnValue(column: string): string {
  return `CASE WHEN typeof("${column}") = 'blob' THEN hex("${column}") ELSE "${column}" END`;
}

/**
 * One row as one JSON value: an array of column groups (SQL_FUNCTION_ARGS
 * columns a group), in column order.
 */
function rowJson(columns: readonly string[]): string {
  const groups: string[] = [];
  for (let i = 0; i < columns.length; i += SQL_FUNCTION_ARGS) {
    groups.push(`json_array(${columns.slice(i, i + SQL_FUNCTION_ARGS).map(columnValue).join(', ')})`);
  }
  return `json_array(${groups.join(', ')})`;
}

/**
 * One row of a page: `[rowid as TEXT, BLOB mask or null, rowJson]`.
 *
 * The rowid travels as TEXT because it is the next page's cursor, and a JSON
 * number loses an integer past 2^53. The mask has one `0`/`1` a column, `1`
 * where the value is a BLOB written as hex, and is NULL in a row with no BLOB.
 * It is built from `||`, not a function's arguments, so SQL_FUNCTION_ARGS does
 * not bound it; and it is a string, not a nested JSON object, so the BLOB marker
 * never depends on a JSON subtype surviving a CASE or a subquery.
 */
function rowElement(columns: readonly string[], key: string): string {
  // `'' ||` first, so a one-column table's mask is the TEXT '0', not the integer 0.
  const mask = ["''", ...columns.map((c) => `(typeof("${c}") = 'blob')`)].join(' || ');
  return `json_array(CAST(${key} AS TEXT), nullif(${mask}, '${'0'.repeat(columns.length)}'), ${rowJson(columns)})`;
}

/**
 * One page of one table as ONE JSON string, `[fetched, [rowElement…]]`.
 *
 * KEYSET, IN ROWID ORDER: the rows after the last rowid read (`after`, null on
 * the first page), at most D1_PAGE_ROWS of them (`fetched`). Of those, the page
 * keeps the first, and every following row while the running total of their
 * UTF-8 bytes — each with its separating comma — stays within `targetBytes`.
 * A table is finished when a page fetched fewer than D1_PAGE_ROWS rows and kept
 * them all.
 *
 * The inner LIMIT bounds the rows each round reads, so the windows run over one
 * page and never over the rest of the table. `json(r)` re-reads each element as
 * JSON: the subquery hands `r` up as plain TEXT, and json_group_array would
 * otherwise quote it as a string.
 */
function tableReadSql(table: string, columns: readonly string[], key: string, after: string | null, targetBytes: number): string {
  const where = after === null ? '' : ` WHERE ${key} > ${after}`;
  return (
    `SELECT json_array(coalesce(max(f), 0), json_group_array(json(r))) FROM (` +
    `SELECT r, count(*) OVER () AS f, row_number() OVER (ORDER BY k) AS n, sum(length(CAST(r AS BLOB)) + 1) OVER (ORDER BY k) AS run FROM (` +
    `SELECT ${key} AS k, ${rowElement(columns, key)} AS r FROM "${table}"${where} ORDER BY ${key} LIMIT ${D1_PAGE_ROWS})` +
    `) WHERE n = 1 OR run <= ${targetBytes}`
  );
}

/** UTF-8 bytes of a string, which is what D1's value cap counts. */
function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

/** A BLOB read as hex, as the dump carries it: base64 under a type marker. */
function blobOf(hex: unknown, where: string): { $blob: string } {
  if (typeof hex !== 'string' || hex.length % 2 !== 0 || !/^[0-9A-Fa-f]*$/.test(hex)) {
    throw new Error(`${where}: a value the mask marks as a BLOB is not hex`);
  }
  let binary = '';
  for (let i = 0; i < hex.length; i += 2) binary += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
  return { $blob: btoa(binary) };
}

/**
 * Many tables' reads as the result columns of ONE statement: one scalar
 * subquery, one column `t<i>`, a table. Scalar subqueries are not a compound
 * SELECT, so D1's cap on those does not apply.
 */
function columnsOf(reads: readonly string[]): string {
  return reads.map((read, i) => `(${read}) AS "t${i}"`).join(', ');
}

/**
 * Dump every user table of one D1 database as JSON lines.
 *
 * `d1_migrations` is KEPT deliberately: a restore that recreates the rows but
 * not the applied-migration ledger looks correct and then re-applies 0001 on the
 * next deploy.
 *
 * `queryBudget` is either a plain number (this dump's own allowance) or the
 * run's shared D1QueryPool, which this dump draws from and leaves charged.
 *
 * 🔴 THE CATALOGUE QUERY IS BUDGETED LIKE EVERY PAGE. It used to run first and
 * unconditionally, so a database handed a budget of 0 still spent one query:
 * the pool could be overspent by one per database, and the arithmetic in
 * index.ts that fits the pool and the heartbeat batch into
 * `d1.queriesPerInvocation` was one short for each of them. A budget of 0 now
 * spends 0 and reports `truncated`, which is RED.
 */
export async function dumpD1Database(
  db: SqlDb,
  databaseName: string,
  queryBudget: number | D1QueryPool,
  nowIso: string,
): Promise<D1DumpResult> {
  const pool: D1QueryPool = typeof queryBudget === 'number' ? { budget: queryBudget, spent: 0 } : queryBudget;
  const spentBefore = pool.spent;
  /** Charge one query to the pool, or answer false when it is exhausted. */
  const take = (): boolean => {
    if (pool.spent >= pool.budget) return false;
    pool.spent += 1;
    return true;
  };
  const lines: D1DumpLine[] = [];
  let truncated = false;

  lines.push({
    kind: 'meta',
    database: databaseName,
    exportedAt: nowIso,
    generator: D1_DUMP_GENERATOR,
  });

  if (!take()) {
    // Not even the catalogue fits: no schema, no rows, and a RED dump that says so.
    lines.push({ kind: 'end', tables: 0, rows: 0, truncated: true, queries: 0 });
    return { jsonl: lines.map((l) => JSON.stringify(l)).join('\n') + '\n', tables: [], rows: 0, queries: 0, truncated: true, withheld: 0 };
  }
  const catalogue = await db
    .prepare(
      "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE type IN ('table','index') ORDER BY type DESC, name",
    )
    .all<{ type: string; name: string; tbl_name: string; sql: string | null }>();

  const tables: string[] = [];
  const createSql = new Map<string, string>();
  for (const entry of catalogue.results ?? []) {
    if (isInternalTable(entry.name) || isInternalTable(entry.tbl_name ?? '')) continue;
    // An auto-created index has a NULL `sql` and cannot be replayed; the CREATE
    // TABLE that implies it carries it instead.
    if (entry.sql === null) continue;
    if (entry.type === 'table') {
      if (!SAFE_IDENTIFIER.test(entry.name)) {
        throw new Error(
          `refusing to dump ${databaseName}: table name ${JSON.stringify(entry.name)} is not a plain identifier, so this dumper cannot quote it and would export an empty table that looks complete`,
        );
      }
      tables.push(entry.name);
      createSql.set(entry.name, entry.sql);
      lines.push({ kind: 'schema', table: entry.name, sql: entry.sql });
    } else {
      lines.push({ kind: 'index', name: entry.name, sql: entry.sql });
    }
  }

  // ── The columns: ONE statement per run of tables, not one per table ───────
  const live = tables.filter((t) => !EPHEMERAL_TABLES.has(t));
  const columns = new Map<string, string[]>(live.map((t) => [t, []]));
  let columnsRead = true;
  for (const run of runsOf(live, Number.POSITIVE_INFINITY, (t) => t.length + 8)) {
    if (!take()) {
      columnsRead = false;
      truncated = true;
      break;
    }
    const listed = await db
      .prepare(`SELECT v.column1 AS tbl, p.cid AS cid, p.name AS name FROM (VALUES ${valuesOf(run)}) AS v JOIN pragma_table_info(v.column1) AS p`)
      .all<{ tbl: string; cid: number; name: string }>();
    const byTable = new Map<string, { cid: number; name: string }[]>();
    for (const c of listed.results ?? []) byTable.set(c.tbl, [...(byTable.get(c.tbl) ?? []), c]);
    for (const table of run) {
      const found = (byTable.get(table) ?? []).sort((a, b) => a.cid - b.cid).map((c) => c.name);
      // 🔴 A TABLE THE CATALOGUE NAMES AND THE PRAGMA DOES NOT KNOW IS GONE, and
      // every table has at least one column. Reading on would export it as an
      // empty table that looks complete, so the dump refuses — RED, not quiet.
      if (found.length === 0) {
        throw new Error(
          `refusing to dump ${databaseName}: table ${JSON.stringify(table)} is in the catalogue and has no columns — it is missing from the database, and its export would be an empty table that looks complete`,
        );
      }
      for (const column of found) {
        if (!SAFE_IDENTIFIER.test(column)) {
          throw new Error(
            `refusing to dump ${databaseName}: column ${JSON.stringify(column)} of ${table} is not a plain identifier, so this dumper cannot quote it`,
          );
        }
      }
      columns.set(table, found);
    }
  }

  // ── The rows: every unfinished table paged in ONE statement a round ───────
  const read = new Map(
    live.map((t) => [
      t,
      {
        rows: [] as Record<string, unknown>[],
        done: false,
        withheld: 0,
        key: columnsRead ? keyOf(databaseName, t, columns.get(t) ?? [], createSql.get(t) ?? '') : 'rowid',
        /** The last rowid read, as TEXT: the next page starts after it. */
        after: null as string | null,
        target: D1_PAGE_BYTES - PAGE_ENVELOPE_BYTES,
        /** Cut to a quarter, and no page has landed since. */
        shrunk: false,
        /** Refused for a reason other than size, and no page has landed since. */
        retried: false,
      },
    ]),
  );
  const page = (t: string): string => {
    const state = read.get(t)!;
    return tableReadSql(t, columns.get(t) ?? [], state.key, state.after, state.target);
  };
  /** Cut a table's page for its ONE retry; a table already cut fails the dump. */
  const shrink = (table: string, why: string): void => {
    const state = read.get(table)!;
    if (state.shrunk) {
      throw new Error(
        `dump of ${databaseName}: ${table}'s page failed again after it was cut to ${state.target} bytes — ${why}. A row wider than D1_PAGE_BYTES (${D1_PAGE_BYTES}) cannot be paged, and the export refuses rather than skip it`,
      );
    }
    state.shrunk = true;
    state.target = Math.floor(state.target / PAGE_RETRY_SHRINK);
  };
  let pending = columnsRead ? [...live] : [];
  while (pending.length > 0 && !truncated) {
    const more: string[] = [];
    for (const run of runsOf(pending, TABLES_PER_READ, (t) => page(t).length + 16)) {
      if (!take()) {
        truncated = true;
        break;
      }
      let answer: Record<string, unknown> | null;
      try {
        answer = await db.prepare(`SELECT ${columnsOf(run.map(page))}`).first<Record<string, unknown>>();
      } catch (err) {
        // 🔴 D1 REFUSED THE READ. SQLITE_TOOBIG is the one this file expects: every
        // table in it that has not been cut is cut, and the run is read again
        // next round; a run with nothing left to cut throws, naming the error.
        // ⏱ 2026-10-01 · review of #1118, finding 5: ANY OTHER refusal (a D1
        // reset, a timeout) says nothing about size, and cutting on it quartered
        // every page of those tables for the rest of the night. It is retried
        // ONCE at the same size; refused again, the night throws.
        if (/SQLITE_TOOBIG|too big/i.test(String(err))) {
          const fresh = run.filter((t) => !read.get(t)!.shrunk);
          if (fresh.length === 0) {
            throw new Error(`dump of ${databaseName}: the read of ${run.join(', ')} failed again after every page in it was cut — ${String(err)}`);
          }
          for (const table of fresh) shrink(table, String(err));
        } else {
          if (run.every((t) => read.get(t)!.retried)) {
            throw new Error(`dump of ${databaseName}: the read of ${run.join(', ')} failed again at the same size — ${String(err)}`);
          }
          for (const table of run) read.get(table)!.retried = true;
        }
        more.push(...run);
        continue;
      }
      for (const [i, table] of run.entries()) {
        const raw = answer?.[`t${i}`];
        if (typeof raw !== 'string') {
          throw new Error(`dump of ${databaseName}: the read of ${table} answered ${typeof raw}, not a JSON page`);
        }
        const state = read.get(table)!;
        const bytes = utf8Bytes(raw);
        if (bytes > D1_PAGE_BYTES) {
          // Nothing of this page is kept and the cursor does not move: the rows
          // come back next round, in a page a quarter the size.
          shrink(table, `a page of ${bytes} bytes came back, past D1_PAGE_BYTES (${D1_PAGE_BYTES})`);
          more.push(table);
          continue;
        }
        const names = columns.get(table) ?? [];
        const credentials = CREDENTIAL_COLUMNS[table] ?? [];
        const [fetched, elements] = JSON.parse(raw) as [number, [string, string | null, unknown[][]][]];
        // The page KEPT a rowid-ordered prefix whatever order json_group_array
        // hands it back in; sorted here, so the cursor is its true last rowid.
        const keyed = elements.map((element) => {
          if (typeof element[0] !== 'string' || !/^-?[0-9]+$/.test(element[0])) {
            throw new Error(`dump of ${databaseName}: a row of ${table} carried no integer rowid`);
          }
          return { rowid: BigInt(element[0]), element };
        });
        keyed.sort((a, b) => (a.rowid < b.rowid ? -1 : a.rowid > b.rowid ? 1 : 0));
        let last = state.after === null ? null : BigInt(state.after);
        for (const { rowid, element } of keyed) {
          // 🔴 THE KEYSET'S OWN INVARIANT: every row is past the last one read.
          // A rowid at or before it is a row this dump has already written, or
          // a page that did not start where it was told to.
          if (last !== null && rowid <= last) {
            throw new Error(`dump of ${databaseName}: ${table} answered rowid ${rowid} after rowid ${last} — the keyset did not hold`);
          }
          last = rowid;
          const [, mask, groups] = element;
          const values = groups.flat();
          if (values.length !== names.length) {
            throw new Error(`dump of ${databaseName}: a row of ${table} carried ${values.length} values for ${names.length} columns`);
          }
          if (mask !== null && (typeof mask !== 'string' || mask.length !== names.length || !/^[01]+$/.test(mask))) {
            throw new Error(`dump of ${databaseName}: a row of ${table} carried a BLOB mask that does not fit its ${names.length} columns`);
          }
          const data: Record<string, unknown> = {};
          names.forEach((name, n) => {
            data[name] = mask !== null && mask[n] === '1' ? blobOf(values[n], `dump of ${databaseName}, ${table}.${name}`) : values[n];
          });
          for (const column of credentials) {
            const value = data[column];
            if (value === undefined || value === null || value === '') continue;
            data[column] = '';
            state.withheld += 1;
          }
          state.rows.push(data);
        }
        if (last !== null) state.after = String(last);
        // A page landed: a cut page goes back to the full target (finding 5),
        // and the table's one retry is its own again.
        if (state.shrunk) {
          state.shrunk = false;
          state.target = D1_PAGE_BYTES - PAGE_ENVELOPE_BYTES;
        }
        state.retried = false;
        if (keyed.length === fetched && fetched < D1_PAGE_ROWS) {
          state.done = true;
        } else if (keyed.length === 0) {
          // A page that keeps nothing of what it fetched would read the same
          // rows forever; it never should (the first row is always kept).
          throw new Error(`dump of ${databaseName}: a page of ${table} fetched ${fetched} rows and kept none`);
        } else {
          more.push(table);
        }
      }
    }
    pending = more;
  }

  let rows = 0;
  let withheld = 0;
  for (const table of tables) {
    if (EPHEMERAL_TABLES.has(table)) {
      lines.push({ kind: 'table-end', table, rows: 0, truncated: false, ephemeral: true });
      continue;
    }
    const state = read.get(table)!;
    for (const data of state.rows) lines.push({ kind: 'row', table, data });
    rows += state.rows.length;
    withheld += state.withheld;
    lines.push({
      kind: 'table-end',
      table,
      rows: state.rows.length,
      truncated: !state.done,
      ...(state.withheld > 0 ? { withheld: state.withheld } : {}),
    });
  }

  const queries = pool.spent - spentBefore;
  lines.push({ kind: 'end', tables: tables.length, rows, truncated, queries });
  return { jsonl: lines.map((l) => JSON.stringify(l)).join('\n') + '\n', tables, rows, queries, truncated, withheld };
}

/** A value a restore binds: what SQLite stores, a BLOB as its bytes. */
export type D1RestoreValue = string | number | null | Uint8Array;

/** One statement of a restore, in the order it must run. */
export interface D1RestoreStatement {
  sql: string;
  params: D1RestoreValue[];
}

/** The dump formats d1RestoreStatements reads (D1_DUMP_GENERATOR). */
const RESTORABLE_GENERATORS: ReadonlySet<string> = new Set(['platform-worker-backup/1', D1_DUMP_GENERATOR]);

/**
 * One value of a dumped row as a restore binds it: `{"$blob": base64}` back to
 * its bytes, a string, number or null as itself. Anything else is a dump this
 * reader does not understand, and it says so rather than store it as text.
 */
export function decodeD1DumpValue(value: unknown): D1RestoreValue {
  if (value === null || typeof value === 'string' || typeof value === 'number') return value;
  if (typeof value === 'object' && !Array.isArray(value)) {
    const keys = Object.keys(value);
    const base64 = (value as { $blob?: unknown }).$blob;
    if (keys.length === 1 && typeof base64 === 'string') {
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return bytes;
    }
  }
  throw new Error(`a dumped value is neither a string, a number, null nor a {"$blob"} marker: ${typeof value}`);
}

/**
 * THE RESTORE'S READ OF A DUMP: the statements that rebuild the database it was
 * taken from, in order — every CREATE TABLE, every row as one INSERT with its
 * values bound, then every CREATE INDEX (indexes last, so the rows load once).
 *
 * 🔴 IT REFUSES A DUMP THAT IS NOT WHOLE: no `end` line (a cut-off transfer), a
 * table whose row lines do not add up to its `table-end`, or an export that says
 * it was truncated. A restore from any of those looks like a database and is
 * missing rows. `allowPartial` is the one deliberate way past the last.
 *
 * ⏱ 2026-10-01 · review of #1118, finding 1. A ROW CAN BE DUMPED TWICE, and the
 * restore keeps the NEWER copy. Keyset paging never skips a row that exists all
 * night, but a row deleted and re-inserted under the same TEXT key between two
 * rounds gets a new, higher rowid: its old copy was read before the cursor and
 * its new copy after it. Both are in the dump and in the counts. So every row
 * loads as INSERT OR REPLACE, and rows go out in rowid order, so the later copy
 * (the newer value) replaces the earlier. A UNIQUE index is created BEFORE the
 * rows, with the tables, so a key it declares resolves the same way; every
 * other index is still created last, so the rows load once.
 *
 * Foreign keys are the caller's: rows load table by table in catalogue order,
 * so a restore runs these with enforcement OFF and checks after
 * (test/backup-export.test.ts does, with `PRAGMA foreign_key_check`). OFF, not
 * deferred: a REPLACE deletes the older copy, and with enforcement on that
 * delete would fire the ON DELETE action of every child row already loaded.
 */
export function d1RestoreStatements(jsonl: string, opts: { allowPartial?: boolean } = {}): D1RestoreStatement[] {
  const lines = jsonl
    .split('\n')
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as D1DumpLine);
  const meta = lines[0];
  if (meta?.kind !== 'meta' || !RESTORABLE_GENERATORS.has(meta.generator)) {
    throw new Error(`not a D1 dump this restore reads: its first line is ${JSON.stringify(meta?.kind === 'meta' ? meta.generator : meta?.kind)}`);
  }
  const end = lines[lines.length - 1];
  if (end?.kind !== 'end') throw new Error(`${meta.database}: the dump has no end line — it was cut off`);
  if (end.truncated && !opts.allowPartial) throw new Error(`${meta.database}: the dump says it was TRUNCATED — a restore from it would be missing rows`);

  const tables: D1RestoreStatement[] = [];
  const rows: D1RestoreStatement[] = [];
  const indexes: D1RestoreStatement[] = [];
  const counted = new Map<string, number>();
  let total = 0;
  for (const line of lines) {
    if (line.kind === 'schema') {
      tables.push({ sql: line.sql, params: [] });
      counted.set(line.table, 0);
    } else if (line.kind === 'index') {
      (/^\s*CREATE\s+UNIQUE\s+INDEX\b/i.test(line.sql) ? tables : indexes).push({ sql: line.sql, params: [] });
    } else if (line.kind === 'row') {
      if (!counted.has(line.table)) throw new Error(`${meta.database}: a row of ${line.table} comes before, or without, its schema`);
      const names = Object.keys(line.data);
      for (const name of [line.table, ...names]) {
        if (!SAFE_IDENTIFIER.test(name)) throw new Error(`${meta.database}: ${JSON.stringify(name)} is not a plain identifier`);
      }
      rows.push({
        sql: `INSERT OR REPLACE INTO "${line.table}" (${names.map((n) => `"${n}"`).join(', ')}) VALUES (${names.map(() => '?').join(', ')})`,
        params: names.map((n) => decodeD1DumpValue(line.data[n])),
      });
      counted.set(line.table, counted.get(line.table)! + 1);
      total += 1;
    } else if (line.kind === 'table-end') {
      if (counted.get(line.table) !== line.rows) {
        throw new Error(`${meta.database}: ${line.table} ends at ${line.rows} rows and the dump holds ${counted.get(line.table) ?? 0}`);
      }
    }
  }
  if (total !== end.rows) throw new Error(`${meta.database}: the dump ends at ${end.rows} rows and holds ${total}`);
  return [...tables, ...rows, ...indexes];
}

export interface KvDumpResult {
  /** A single JSON document: metadata plus every key's value and metadata. */
  json: string;
  keys: number;
  truncated: boolean;
}

/**
 * Dump one KV namespace as a single JSON document.
 *
 * Values are read as TEXT. Everything this portfolio puts in KV is JSON or a
 * JWKS document, and a text read of a binary value would corrupt it silently —
 * so the dump records `type: 'text'` per key, and a future binary value is a
 * change that must be made deliberately here rather than absorbed.
 */
export async function dumpKvNamespace(
  ns: KvStore,
  namespaceName: string,
  maxKeys: number,
  nowIso: string,
): Promise<KvDumpResult> {
  const entries: { key: string; type: 'text'; value: string | null; metadata: unknown }[] = [];
  let cursor: string | undefined;
  let truncated = false;

  for (;;) {
    const listed = await ns.list({ limit: KV_LIST_PAGE, cursor });
    for (const k of listed.keys) {
      if (entries.length >= maxKeys) {
        truncated = true;
        break;
      }
      const value = await ns.get(k.name, 'text');
      entries.push({ key: k.name, type: 'text', value, metadata: k.metadata ?? null });
    }
    if (truncated) break;
    if (listed.list_complete) break;
    cursor = listed.cursor;
    if (!cursor) break;
  }

  const doc = {
    namespace: namespaceName,
    exportedAt: nowIso,
    generator: 'platform-worker-backup/1',
    keys: entries.length,
    truncated,
    entries,
  };
  return { json: JSON.stringify(doc), keys: entries.length, truncated };
}

export interface BackupBlob {
  body: ArrayBuffer;
  bytes: number;
  sha256: string;
}

/**
 * gzip a string and digest the COMPRESSED bytes.
 *
 * 🔴 THE DIGEST IS OF WHAT LANDS IN R2, not of the plaintext. Box B verifies the
 * file it downloaded without decompressing it, which is the only check that can
 * catch a truncated transfer — the failure this whole chain exists to notice.
 */
export async function gzipAndDigest(text: string): Promise<BackupBlob> {
  const plain = new Response(text).body;
  if (plain === null) throw new Error('gzipAndDigest: Response(text).body was null');
  const body = await new Response(plain.pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', body);
  const sha256 = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return { body, bytes: body.byteLength, sha256 };
}
