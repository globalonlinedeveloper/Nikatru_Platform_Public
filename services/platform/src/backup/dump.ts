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
// ⚠️ AND IT HAS A CEILING THE REST PATH DOES NOT. Every page is one D1 query and
// `d1.queriesPerInvocation` is 50 on the plan of record's recorded value, so this
// path outgrows itself at some table size. It does NOT degrade quietly: the
// budget is counted, exhaustion sets `truncated`, and `truncated` turns the run
// RED (see index.ts). When that day comes the upgrade is the REST/Workflows
// export — recorded in runbooks/backup-restore.md, not left to be rediscovered.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Rows read per `SELECT` page.
 *
 * @ceiling none — bounds the size of ONE result set, not a platform resource.
 *   The resource this file spends is QUERIES (see MAX_D1_QUERIES_PER_RUN in
 *   index.ts, which derives from `d1.queriesPerInvocation`); a bigger page spends
 *   FEWER of them, so this number moving up is safer, not riskier. It is bounded
 *   above only by what fits in a Worker's memory, and the whole estate is under
 *   400 KB.
 */
export const D1_PAGE_ROWS = 5000;

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
  | { kind: 'table-end'; table: string; rows: number; truncated: boolean }
  | { kind: 'end'; tables: number; rows: number; truncated: boolean; queries: number };

export interface D1DumpResult {
  /** The dump itself, newline-delimited JSON. */
  jsonl: string;
  tables: string[];
  rows: number;
  queries: number;
  /** TRUE when the query budget ran out before the data did. Never green. */
  truncated: boolean;
}

/**
 * SQLite identifiers this dumper will quote into SQL.
 *
 * The names come from `sqlite_master` — the database's own catalogue, not from
 * any request — so injection is not the threat being defended against here. The
 * threat is a name this code cannot quote correctly producing a SILENTLY EMPTY
 * table in a backup. Refusing loudly is the only safe answer to that.
 */
const SAFE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Tables that are the vendor's bookkeeping, not the portfolio's data. */
function isInternalTable(name: string): boolean {
  return name.startsWith('sqlite_') || name.startsWith('_cf_');
}

/**
 * Dump every user table of one D1 database as JSON lines.
 *
 * `d1_migrations` is KEPT deliberately: a restore that recreates the rows but
 * not the applied-migration ledger looks correct and then re-applies 0001 on the
 * next deploy.
 */
export async function dumpD1Database(
  db: D1Database,
  databaseName: string,
  queryBudget: number,
  nowIso: string,
): Promise<D1DumpResult> {
  const lines: D1DumpLine[] = [];
  let queries = 0;
  let truncated = false;

  lines.push({
    kind: 'meta',
    database: databaseName,
    exportedAt: nowIso,
    generator: 'platform-worker-backup/1',
  });

  const catalogue = await db
    .prepare(
      "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE type IN ('table','index') ORDER BY type DESC, name",
    )
    .all<{ type: string; name: string; tbl_name: string; sql: string | null }>();
  queries += 1;

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

  let rows = 0;
  for (const table of tables) {
    let tableRows = 0;
    let tableTruncated = false;
    for (;;) {
      if (queries >= queryBudget) {
        tableTruncated = true;
        truncated = true;
        break;
      }
      const page = await db
        .prepare(`SELECT * FROM "${table}" LIMIT ?1 OFFSET ?2`)
        .bind(D1_PAGE_ROWS, tableRows)
        .all<Record<string, unknown>>();
      queries += 1;
      const batch = page.results ?? [];
      for (const data of batch) lines.push({ kind: 'row', table, data });
      tableRows += batch.length;
      if (batch.length < D1_PAGE_ROWS) break;
    }
    rows += tableRows;
    lines.push({ kind: 'table-end', table, rows: tableRows, truncated: tableTruncated });
  }

  lines.push({ kind: 'end', tables: tables.length, rows, truncated, queries });
  return { jsonl: lines.map((l) => JSON.stringify(l)).join('\n') + '\n', tables, rows, queries, truncated };
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
