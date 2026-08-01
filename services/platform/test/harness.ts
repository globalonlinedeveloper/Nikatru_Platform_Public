// ─────────────────────────────────────────────────────────────────────────────
// Test harness for services/platform — A REAL SQL ENGINE, NOT A DOUBLE.
//
// Ported from services/subly-api/test/harness.ts (2026-08-01, [pipeline B-9]).
// The mechanism is the same and deliberately so: `node:sqlite` with THE REAL
// MIGRATIONS applied, wrapped in D1's interface. What changed is the shape of
// the double this Worker needed.
//
// 🔴 WHY THIS REPLACED `class FakeDb`. events.test.ts used to run against a
// hand-written recorder that pushed every prepared SQL string onto an array and
// answered `{ changes: 1 }` to everything. Against that object:
//
//   · an INSERT naming a column no migration ever created is indistinguishable
//     from a correct one — nothing parses the statement;
//   · `ON CONFLICT(event_id) DO NOTHING` was asserted as a SUBSTRING of the SQL,
//     so the dedup guarantee was proven by grep, not by two rows becoming one;
//   · "the route wrote zero rows" was unprovable in principle. The suite could
//     only say "the route did not call batch()", which is a different claim and
//     the one [pipeline B-4a] cannot be built on;
//   · `batch()` being ONE TRANSACTION was never exercised, so a partial write
//     under a constraint violation would have looked exactly like a clean one.
//
// TWO CAPABILITIES IN ONE OBJECT, ON PURPOSE. subly-api splits `realDb()` from
// `RecordingDb` because its questions split cleanly. This Worker's do not: the
// events route has assertions about WHAT SQL IT CHOSE (the conflict clause, the
// absence of an `ip` column, the exact bound tuple) *and* assertions about WHAT
// LANDED (row counts, dedup, rollback), frequently in the same test. Handing the
// route a recorder for one and an engine for the other would mean two runs of the
// same request that could disagree, which is how a "verified" contract drifts. So
// `RealDb` executes AND records, and every assertion in the file grades the same
// single execution.
//
// The migrations are imported with `?raw` rather than read with node:fs, so the
// schema under test is the schema that ships. Inlining a copy here would let the
// tests keep passing after a migration changed the tree — and platform_db is the
// one database the whole portfolio shares, so that drift is every app's.
// ─────────────────────────────────────────────────────────────────────────────
import type { DatabaseSync as DatabaseSyncCtor } from 'node:sqlite';
import entitlements0001 from '../migrations/0001_entitlements.sql?raw';
import analytics0002 from '../migrations/0002_analytics.sql?raw';
import cronHeartbeat0003 from '../migrations/0003_cron_heartbeat.sql?raw';
import moneyRail0004 from '../migrations/0004_money_rail.sql?raw';

type SQLValue = string | number | bigint | null | Uint8Array;

/**
 * platform_db's migration set, IN APPLICATION ORDER, exactly as
 * `wrangler d1 migrations apply PLATFORM_DB` would apply it.
 *
 * Exported rather than kept private because "this set re-applies cleanly" is
 * itself a property under test ([pipeline B-8]) and a replay test must be able
 * to name the set without re-listing it — a second list is a second thing to
 * forget to extend when 0004 lands.
 */
export const PLATFORM_MIGRATIONS: readonly string[] = [
  entitlements0001,
  analytics0002,
  cronHeartbeat0003,
  moneyRail0004,
];

/**
 * The subset of [PLATFORM_MIGRATIONS] that is safe to APPLY TWICE.
 *
 * SQLite has no `ALTER TABLE … ADD COLUMN IF NOT EXISTS`, so 0004's entitlement
 * contract is inherently once-only. D1's ledger records migration FILE NAMES, so
 * wrangler applies each file exactly once and this is not a production hazard —
 * but it does mean "the whole set re-applies" stopped being true on 2026-08-01
 * and pretending otherwise would have meant weakening the replay test into
 * something vacuous. migrations-replay.test.ts instead CLASSIFIES every statement
 * in the whole set and proves that ALTER … ADD COLUMN is the ONLY non-replay-safe
 * form present anywhere, then replays this subset in full.
 */
export const REPLAY_SAFE_MIGRATIONS: readonly string[] = [
  entitlements0001,
  analytics0002,
  cronHeartbeat0003,
];

// `node:sqlite` is fetched through `process.getBuiltinModule` rather than a
// static import: Vite's builtin list does not yet know the module, so
// `import ... from 'node:sqlite'` fails to resolve at transform time ("Failed to
// load url sqlite"). This bypasses module resolution entirely and needs no
// vitest config. The TYPES still come from the ambient declaration in
// node-sqlite.d.ts, so this stays type-checked.
type DatabaseSync = DatabaseSyncCtor;
const SqliteCtor = (
  globalThis as unknown as {
    process: {
      getBuiltinModule(id: 'node:sqlite'): {
        DatabaseSync: new (path: string) => DatabaseSync;
      };
    };
  }
).process.getBuiltinModule('node:sqlite').DatabaseSync;

/**
 * D1PreparedStatement over node:sqlite. `bind` returns a NEW statement, as D1's
 * does — the events route binds ONE prepared statement up to 100 times and
 * batches the results, so a `bind` that mutated in place would collapse the
 * whole batch onto the last row and every per-row assertion would still pass.
 */
class SqliteStatement {
  constructor(
    private readonly owner: RealDb,
    private readonly sql: string,
    private readonly params: unknown[] = [],
  ) {}

  bind(...params: unknown[]): SqliteStatement {
    this.owner.bound.push(params);
    return new SqliteStatement(this.owner, this.sql, params);
  }

  private args(): SQLValue[] {
    return this.params.map((p) => {
      if (p === undefined) {
        // D1 rejects undefined binds (D1_TYPE_ERROR). node:sqlite throws too;
        // this makes the message recognisable in a failing test.
        throw new TypeError('D1_TYPE_ERROR: undefined is not a supported bind value');
      }
      if (typeof p === 'boolean') return p ? 1 : 0;
      return p as SQLValue;
    });
  }

  /** Runs against the real engine. Kept internal so `batch` can reuse it. */
  exec(): { meta: { changes: number } } {
    const r = this.owner.db.prepare(this.sql).run(...this.args());
    return { meta: { changes: r.changes } };
  }

  async all<T = Record<string, unknown>>(): Promise<{ results: T[] }> {
    return { results: this.owner.db.prepare(this.sql).all(...this.args()) as T[] };
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    return (this.owner.db.prepare(this.sql).get(...this.args()) as T) ?? null;
  }

  async run(): Promise<{ meta: { changes: number } }> {
    if (this.owner.throwOnWrite) throw new Error('d1 down');
    return this.exec();
  }
}

/**
 * D1Database over node:sqlite, which ALSO records every prepared statement and
 * every bound tuple. `batch` is ONE transaction, as D1's is.
 */
export class RealDb {
  readonly db: DatabaseSync;
  /** Every SQL string the route asked to prepare, in order. */
  readonly sql: string[] = [];
  /** Every bound tuple, in order. Index `n` is the nth `.bind(...)` call. */
  readonly bound: unknown[][] = [];
  /** Total statements handed to `batch()`, summed across calls. */
  batched = 0;
  /**
   * Force the DB layer to fail. The route must answer 503 and the CLIENT must
   * keep its batch — a 200 here would lose the events. Named `throwOnWrite`
   * rather than `throwOnBatch`: /v1/consent writes with `.run()`, not `.batch()`,
   * and a flag that only covered one of the two write paths is a flag whose name
   * over-promises.
   */
  throwOnWrite = false;

  constructor(schema: readonly string[] = PLATFORM_MIGRATIONS) {
    this.db = new SqliteCtor(':memory:');
    for (const sql of schema) this.db.exec(sql);
  }

  prepare(sql: string): SqliteStatement {
    this.sql.push(sql);
    return new SqliteStatement(this, sql);
  }

  async batch(statements: SqliteStatement[]): Promise<unknown[]> {
    if (this.throwOnWrite) throw new Error('d1 down');
    this.batched += statements.length;
    this.db.exec('BEGIN');
    try {
      const out: unknown[] = [];
      for (const s of statements) out.push(s.exec());
      this.db.exec('COMMIT');
      return out;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  /** Direct read, bypassing the Worker — for asserting what actually landed. */
  rows(sql: string, ...params: SQLValue[]): Array<Record<string, unknown>> {
    return this.db.prepare(sql).all(...params);
  }

  /**
   * `SELECT COUNT(*)` as a number. The whole point of this harness is that
   * "wrote zero rows" is a QUERY rather than an inference from which methods the
   * route happened to call, so the query gets a first-class helper.
   */
  count(table: string, where = '1=1', ...params: SQLValue[]): number {
    const row = this.db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).get(...params);
    return Number((row as { n: number }).n);
  }
}

/** platform_db with the real migrations applied, in order. */
export function realPlatformDb(extraSchema: readonly string[] = []): RealDb {
  return new RealDb([...PLATFORM_MIGRATIONS, ...extraSchema]);
}

// ── one Workers-runtime API Node's WebCrypto does not have ───────────────────
// `crypto.subtle.timingSafeEqual` is a Cloudflare Workers extension, and the MoR
// signature comparison (src/lib/mor/paddle.ts) uses it. Without this shim the
// money route THROWS in Node and every test reports a 500 — which is
// indistinguishable from a request the handler deliberately rejected, i.e. the
// suite would look like it was testing rejection while testing a crash. On a
// money route that failure mode is worse than usual: "the tampered body was
// refused" and "the tampered body crashed the Worker" print the same red, and
// only one of them means the rail is safe.
//
// Ported verbatim from services/subly-api/test/harness.ts:180-208.
// Constant-time-ness is a property of the deployed runtime, not of this shim;
// what is being restored here is PRESENCE.
{
  const subtle = (
    globalThis as unknown as {
      crypto?: {
        subtle?: {
          timingSafeEqual?: (a: ArrayBufferView, b: ArrayBufferView) => boolean;
        };
      };
    }
  ).crypto?.subtle;
  if (subtle && typeof subtle.timingSafeEqual !== 'function') {
    subtle.timingSafeEqual = (a, b) => {
      const x = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
      const y = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
      if (x.byteLength !== y.byteLength) {
        throw new TypeError('timingSafeEqual: inputs must have the same length');
      }
      let diff = 0;
      for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
      return diff === 0;
    };
  }
}
