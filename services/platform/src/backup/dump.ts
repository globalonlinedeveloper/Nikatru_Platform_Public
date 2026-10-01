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
// NOW FLAT IN THE TABLE COUNT. A database costs four statements whatever its
// table count: the catalogue, ONE column read for every table, ONE size read
// (each table's row count and widest row), and ONE read that pages every table
// at once (readTablesSql). That stays true up to TABLES_PER_READ tables a
// database; only a single table's volume past one page adds a round.
// MEASURED 2026-10-01 against both production databases (read-only, through
// this function, pages rewritten to LIMIT 0): all four shapes ACCEPTED, the
// known-refused statement refused on the same connection, 4 + 4 of 42.
//
// 🔴 NOT `db.batch()`, AND THIS IS WHY. tooling/ceilings.json records that the
// vendor does not say whether a batch of N statements spends one query or N, and
// mandates the worst-case reading for every derivation: N. Under that reading a
// batch of one page per table costs exactly what the old loop cost, so it would
// have turned `d1-budget` green by changing the accounting rather than the
// spend. Each read here is ONE statement, which is one query under either
// reading. And not one `UNION ALL` either: D1 refuses a compound SELECT past a
// handful of terms (measured, services/_shared/src/erasure.ts) — the scalar
// subqueries of readTablesSql are not a compound SELECT.
// ─────────────────────────────────────────────────────────────────────────────

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
 * Bytes of JSON one table's page may carry in a read round.
 *
 * @ceiling none — half of D1's 2,000,000-byte "Maximum string, BLOB or table row
 *   size" (https://developers.cloudflare.com/d1/platform/limits/), which no row
 *   of tooling/ceilings.json records. A table's page arrives as ONE
 *   `json_group_array` string, so a fixed row count is not a safe page: rows
 *   here run from 71 bytes to 4,749 (provider_notifications' webhook bodies,
 *   measured 2026-10-01), and 1,000 of the widest would be 4.7 MB — SQLITE_TOOBIG,
 *   a RED night. So each table's page is this divided by its widest row, read
 *   in the size statement; the half left over absorbs a wider row written
 *   between that read and the page.
 */
export const D1_PAGE_BYTES = 1_000_000;

/**
 * Tables read by ONE statement.
 *
 * @ceiling none — D1 caps a table, and a result set, at 100 columns
 *   (https://developers.cloudflare.com/d1/platform/limits/ "Maximum columns per
 *   table"), and no row of tooling/ceilings.json records it. Each table is one
 *   result column of readTablesSql, so half that cap leaves the margin, and a
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
 * Keys listed per `KVNamespace.list()` call — the vendor's own page size.
 *
 * @ceiling none — this is the KV list API's maximum page, not a cap this code
 *   chooses. Asking for more returns 1000 anyway.
 */
export const KV_LIST_PAGE = 1000;

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
 * Every column of every table in `tables`, in ONE statement.
 *
 * The pragma is fed a VALUES list, one of the shapes D1 was measured to accept
 * (tooling/ci/d1-sql-inventory.mjs); this statement does not name the schema
 * table, which is the half of the refused shape it must never carry. The names
 * are SAFE_IDENTIFIER-checked before they reach here, so they quote as literals.
 */
function columnsSql(tables: readonly string[]): string {
  const list = tables.map((t) => `('${t}')`).join(', ');
  return `SELECT v.column1 AS tbl, p.cid AS cid, p.name AS name FROM (VALUES ${list}) AS v JOIN pragma_table_info(v.column1) AS p`;
}

/**
 * One row as one JSON value: an array of column groups (SQL_FUNCTION_ARGS
 * columns a group), in column order. A BLOB would make `json_array` throw —
 * loud, and no production column held one when this was measured.
 */
function rowJson(columns: readonly string[]): string {
  const groups: string[] = [];
  for (let i = 0; i < columns.length; i += SQL_FUNCTION_ARGS) {
    groups.push(`json_array(${columns.slice(i, i + SQL_FUNCTION_ARGS).map((c) => `"${c}"`).join(', ')})`);
  }
  return `json_array(${groups.join(', ')})`;
}

/** One table's `[rows, widest row in bytes]`, which sizes its page. */
function tableSizeSql(table: string, columns: readonly string[]): string {
  return `SELECT json_array(count(*), coalesce(max(length(${rowJson(columns)})), 0)) FROM "${table}"`;
}

/** One page of one table as ONE JSON string: an array of rowJson values. */
function tableReadSql(table: string, columns: readonly string[], limit: number, offset: number): string {
  return `SELECT json_group_array(${rowJson(columns)}) FROM (SELECT * FROM "${table}" LIMIT ${limit} OFFSET ${offset})`;
}

/** Many tables' pages in ONE statement: one scalar subquery, one result column, a table. */
function readTablesSql(pages: readonly string[]): string {
  return `SELECT ${pages.map((page, i) => `(${page}) AS "t${i}"`).join(', ')}`;
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
  db: D1Database,
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
    generator: 'platform-worker-backup/1',
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
    const listed = await db.prepare(columnsSql(run)).all<{ tbl: string; cid: number; name: string }>();
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

  // ── The page sizes: ONE statement per run, each table's widest row ────────
  const read = new Map(
    live.map((t) => [t, { rows: [] as Record<string, unknown>[], done: false, withheld: 0, limit: D1_PAGE_ROWS }]),
  );
  let sized = columnsRead;
  if (sized) {
    const size = (t: string): string => tableSizeSql(t, columns.get(t) ?? []);
    for (const run of runsOf(live, TABLES_PER_READ, (t) => size(t).length + 16)) {
      if (!take()) {
        sized = false;
        truncated = true;
        break;
      }
      const answer = await db.prepare(readTablesSql(run.map(size))).first<Record<string, unknown>>();
      run.forEach((table, i) => {
        const raw = answer?.[`t${i}`];
        if (typeof raw !== 'string') {
          throw new Error(`dump of ${databaseName}: the size read of ${table} answered ${typeof raw}, not JSON`);
        }
        const [, widest] = JSON.parse(raw) as [number, number];
        read.get(table)!.limit = Math.max(1, Math.min(D1_PAGE_ROWS, Math.floor(D1_PAGE_BYTES / Math.max(1, widest))));
      });
    }
  }

  // ── The rows: every unfinished table paged in ONE statement a round ───────
  const page = (t: string): string => {
    const state = read.get(t)!;
    return tableReadSql(t, columns.get(t) ?? [], state.limit, state.rows.length);
  };
  let pending = sized ? [...live] : [];
  while (pending.length > 0 && !truncated) {
    const more: string[] = [];
    for (const run of runsOf(pending, TABLES_PER_READ, (t) => page(t).length + 16)) {
      if (!take()) {
        truncated = true;
        break;
      }
      const answer = await db.prepare(readTablesSql(run.map(page))).first<Record<string, unknown>>();
      run.forEach((table, i) => {
        const raw = answer?.[`t${i}`];
        if (typeof raw !== 'string') {
          throw new Error(`dump of ${databaseName}: the read of ${table} answered ${typeof raw}, not a JSON page`);
        }
        const names = columns.get(table) ?? [];
        const credentials = CREDENTIAL_COLUMNS[table] ?? [];
        const state = read.get(table)!;
        const pageRows = JSON.parse(raw) as unknown[][][];
        for (const groups of pageRows) {
          const values = groups.flat();
          if (values.length !== names.length) {
            throw new Error(`dump of ${databaseName}: a row of ${table} carried ${values.length} values for ${names.length} columns`);
          }
          const data: Record<string, unknown> = {};
          names.forEach((name, n) => {
            data[name] = values[n];
          });
          for (const column of credentials) {
            const value = data[column];
            if (value === undefined || value === null || value === '') continue;
            data[column] = '';
            state.withheld += 1;
          }
          state.rows.push(data);
        }
        if (pageRows.length < state.limit) state.done = true;
        else more.push(table);
      });
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
  ns: KVNamespace,
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
