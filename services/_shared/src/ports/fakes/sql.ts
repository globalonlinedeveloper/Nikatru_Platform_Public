// ─────────────────────────────────────────────────────────────────────────────
// fakes/sql.ts — THE SQL PORT OVER `node:sqlite`: A REAL ENGINE, NOT A DOUBLE.
// tooling/ports/sql.json adapter `sqlite` (test and sandbox, never live); it
// passes the same conformance suite as the binding is held to
// (services/_shared/test/conformance/sql.ts).
//
// ⏱ 2026-10-02 · port-sql. PROMOTED, not written: this is services/platform's
// test-harness `RealDb` (ported 2026-08-01 from subscriptiontracker-api's
// `SqliteD1`, [pipeline B-9]), moved here verbatim in behaviour so both Worker
// harnesses import ONE engine. Each harness keeps its migration list and
// re-exports this class under its old name for one PR.
//
// 🔴 WHY A REAL ENGINE REPLACED `class FakeDb`. A recorder that answers
// `{ changes: 1 }` to everything cannot tell an INSERT naming a column no
// migration created from a correct one, proves `ON CONFLICT … DO NOTHING` by
// grep rather than by two rows becoming one, cannot show "the route wrote zero
// rows", and never exercises `batch()` being ONE TRANSACTION.
//
// EXECUTES AND RECORDS, IN ONE OBJECT, ON PURPOSE. Some suites assert WHAT SQL
// a route chose (the conflict clause, the exact bound tuple) and WHAT LANDED
// (row counts, dedup, rollback), often in the same test; one object grading one
// execution cannot disagree with itself.
//
// 🔴 NO BARE IMPORT (services/_shared/test/shared-home.test.ts), so `node:sqlite`
// is reached through `process.getBuiltinModule`, LAZILY in the constructor — a
// Worker bundle never constructs this, and Vite's builtin list does not know
// the module ("Failed to load url sqlite"). Its surface is declared below,
// structurally, rather than imported.
//
// What it does NOT model, and the registry says so: D1's authorizer (a
// statement D1 refuses with SQLITE_AUTH, this engine accepts —
// tooling/ops/check-d1-accepts-live-sql.mjs is the live answer), D1's limits
// (tooling/ceilings.json) and the transient Durable Object reset (injected by
// a test, never produced by this engine).
// ─────────────────────────────────────────────────────────────────────────────
import type { SqlDb, SqlResult, SqlStatement } from '../sql';

/** A value node:sqlite binds. */
export type SqliteValue = string | number | bigint | null | Uint8Array;

/** The part of node:sqlite's `StatementSync` this engine and its callers use. */
export interface SqliteStatementSync {
  all(...params: SqliteValue[]): Array<Record<string, unknown>>;
  get(...params: SqliteValue[]): Record<string, unknown> | undefined;
  run(...params: SqliteValue[]): { changes: number | bigint; lastInsertRowid: number | bigint };
  /** The result columns a statement WOULD return — empty for a write. */
  columns(): Array<{ name: string }>;
}

/** The part of node:sqlite's `DatabaseSync` this engine and its callers use. */
export interface SqliteDatabaseSync {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatementSync;
  close(): void;
}

type SqliteCtor = new (path: string) => SqliteDatabaseSync;

function sqliteCtor(): SqliteCtor {
  const proc = (globalThis as unknown as { process?: { getBuiltinModule?(id: 'node:sqlite'): { DatabaseSync: SqliteCtor } } }).process;
  const mod = proc?.getBuiltinModule?.('node:sqlite');
  if (!mod) throw new Error('fakes/sql: node:sqlite is not available — this engine runs under Node (tests, the dry run), never in a Worker');
  return mod.DatabaseSync;
}

/**
 * One prepared statement over node:sqlite. `bind` returns a NEW statement, as
 * D1's does — the events route binds ONE prepared statement up to 100 times and
 * batches the results, so a `bind` that mutated in place would collapse the
 * whole batch onto the last row and every per-row assertion would still pass.
 */
export class SqliteStatement implements SqlStatement {
  constructor(
    private readonly owner: SqliteDb,
    private readonly sql: string,
    private readonly params: unknown[] = [],
  ) {}

  bind(...params: unknown[]): SqliteStatement {
    this.owner.bound.push(params);
    return new SqliteStatement(this.owner, this.sql, params);
  }

  private args(): SqliteValue[] {
    return this.params.map((p) => {
      if (p === undefined) {
        // D1 rejects undefined binds (D1_TYPE_ERROR). node:sqlite throws too;
        // this makes the message recognisable in a failing test.
        throw new TypeError('D1_TYPE_ERROR: undefined is not a supported bind value');
      }
      if (typeof p === 'boolean') return p ? 1 : 0;
      return p as SqliteValue;
    });
  }

  /** Runs a write against the real engine. Kept separate so `run` can reuse it. */
  exec(): SqlResult<never> {
    const r = this.owner.db.prepare(this.sql).run(...this.args());
    return { results: [], meta: { changes: Number(r.changes) } };
  }

  /**
   * What ONE statement contributes to a `batch()` answer — D1's shape, not a
   * convenient subset of it.
   *
   * ⏱ 2026-09-18 · O-ERASURE-WALK-ROUND-TRIPS. MEASURED against workerd's own D1
   * through a Worker's wrangler.jsonc binding (getPlatformProxy): a batch of
   * SELECTs answers one result per statement, IN ORDER, each carrying its rows;
   * a write answers `results: []` with `meta.changes`. `columns()` decides which,
   * so no SQL is pattern-matched.
   */
  batchResult(): SqlResult {
    const stmt = this.owner.db.prepare(this.sql);
    if (stmt.columns().length > 0) return { results: stmt.all(...this.args()), meta: { changes: 0 } };
    const r = stmt.run(...this.args());
    return { results: [], meta: { changes: Number(r.changes) } };
  }

  async all<T = Record<string, unknown>>(): Promise<SqlResult<T>> {
    return { results: this.owner.db.prepare(this.sql).all(...this.args()) as T[], meta: { changes: 0 } };
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    return (this.owner.db.prepare(this.sql).get(...this.args()) as T) ?? null;
  }

  async run<T = Record<string, unknown>>(): Promise<SqlResult<T>> {
    if (this.owner.throwOnWrite) throw new Error('d1 down');
    return this.exec();
  }
}

/**
 * The SQL port over node:sqlite, which ALSO records every prepared statement and
 * every bound tuple. `batch` is ONE transaction, as D1's is.
 */
export class SqliteDb implements SqlDb {
  readonly db: SqliteDatabaseSync;
  /** Every SQL string the caller asked to prepare, in order. */
  readonly sql: string[] = [];
  /** Every bound tuple, in order. Index `n` is the nth `.bind(...)` call. */
  readonly bound: unknown[][] = [];
  /** Total statements handed to `batch()`, summed across calls. */
  batched = 0;
  /**
   * Force the DB layer to fail. A route must answer 503 and the CLIENT must
   * keep its batch — a 200 here would lose the events. Named `throwOnWrite`
   * rather than `throwOnBatch`: /v1/consent writes with `.run()`, not `.batch()`,
   * and a flag that only covered one of the two write paths is a flag whose name
   * over-promises.
   */
  throwOnWrite = false;

  /** A fresh in-memory database with `schema` (each a whole migration) applied, in order. */
  constructor(schema: readonly string[] = [], path = ':memory:') {
    const Ctor = sqliteCtor();
    this.db = new Ctor(path);
    for (const sql of schema) this.db.exec(sql);
  }

  prepare(sql: string): SqliteStatement {
    this.sql.push(sql);
    return new SqliteStatement(this, sql);
  }

  async batch<T = unknown>(statements: SqlStatement[]): Promise<SqlResult<T>[]> {
    if (this.throwOnWrite) throw new Error('d1 down');
    for (const s of statements) {
      if (!(s instanceof SqliteStatement)) throw new TypeError('D1_TYPE_ERROR: batch() takes statements prepared on this database');
    }
    this.batched += statements.length;
    this.db.exec('BEGIN');
    try {
      const out: SqlResult<T>[] = [];
      for (const s of statements as SqliteStatement[]) out.push(s.batchResult() as SqlResult<T>);
      this.db.exec('COMMIT');
      return out;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  /** Direct read, bypassing the Worker — for asserting what actually landed. */
  rows(sql: string, ...params: SqliteValue[]): Array<Record<string, unknown>> {
    return this.db.prepare(sql).all(...params);
  }

  /**
   * `SELECT COUNT(*)` as a number. "Wrote zero rows" is a QUERY rather than an
   * inference from which methods the route happened to call, so the query gets
   * a first-class helper.
   */
  count(table: string, where = '1=1', ...params: SqliteValue[]): number {
    const row = this.db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).get(...params);
    return Number((row as { n: number }).n);
  }
}

/** tooling/ports/sql.json adapter `sqlite`: a fresh engine with `schema` applied. */
export function sqliteDb(schema: readonly string[] = []): SqliteDb {
  return new SqliteDb(schema);
}
