// ─────────────────────────────────────────────────────────────────────────────
// ports/sql.ts — THE SQL PORT. tooling/ports/sql.json is its registry;
// tooling/ports/README.md is the standard.
//
// ⏱ 2026-10-02 · O-CLOUDFLARE-BINDINGS-SCATTERED (port-sql), the D1 limb.
// Every handler, route, lib and middleware that reads or writes PLATFORM_DB,
// SUBSCRIPTIONTRACKER_DB or APP_DB takes a `SqlDb`, never a `D1Database`
// (assert-ports limb 12). The Cloudflare binding satisfies this interface
// STRUCTURALLY — no wrapper sits on the hot path; adapters/cloudflare.ts is a
// compile-time proof, not a shim. The second engine is fakes/sql.ts: the
// `node:sqlite` engine every Worker suite already ran its SQL through.
//
// THE SURFACE IS WHAT THIS PORTFOLIO CALLS, AND NO MORE, derived 2026-10-02 from
// every `.prepare(` site of services/*/src and the brick's Worker: `prepare`,
// `bind`, `first()` (never `first(column)`), `all`, `run` and `batch`. No `raw`,
// no `exec`, no `dump`, no `withSession` — nothing calls them, so a second engine
// owes none of them. A result carries `results` and `meta.changes`, the two
// fields any caller reads. A new verb is added here deliberately, with its
// conformance case (services/_shared/test/conformance/sql.ts), never reached for
// on the binding.
//
// ⚠️ NOT THE README'S OUTCOME SHAPE, for the reason ports/kv.ts gives: a
// statement that fails REJECTS, as the binding does, and each caller's
// try/catch (and `withD1Retry` below) stays the one place its policy is
// written. The rejection is CLASSIFIED by the predicates re-exported at the
// foot of this file, and their wording is workerd's: the engine behind the port
// must reject in words they read the same way (conformance cases
// `unique-violation-is-classified` and `deterministic-error-is-not-retried`).
//
// THE SQL IS PLAIN SQLITE, and so is every migration (services/*/migrations).
// The nightly export (services/platform/src/backup/) writes every table as
// gzipped JSON lines to R2; `node tooling/ops/port-switch.mjs sql --to sqlite
// --dry-run --export <file>` replays the migrations and loads one such export
// into a node:sqlite file, so the export duty is rehearsed, not asserted.
// ─────────────────────────────────────────────────────────────────────────────

/** What a statement's `meta` carries. `changes` is the one field a caller reads;
 *  an engine may add its own (D1 adds timing and size fields). */
export interface SqlMeta {
  changes: number;
  [field: string]: unknown;
}

/** The answer to `all`, `run` and each statement of a `batch`: the rows the
 *  statement returned (none for a write) and its meta. */
export interface SqlResult<T = unknown> {
  results: T[];
  meta: SqlMeta;
}

/** One prepared statement. `bind` returns a NEW statement — one prepared
 *  statement bound many times in a single batch is how the events route and the
 *  budget replace write — and an `undefined` bind REJECTS (D1_TYPE_ERROR). */
export interface SqlStatement {
  bind(...values: unknown[]): SqlStatement;
  /** The first row, or null when there is none. */
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<SqlResult<T>>;
  run<T = Record<string, unknown>>(): Promise<SqlResult<T>>;
}

/** The SQL port. A `D1Database` is one; `fakes/sql.ts` is another. */
export interface SqlDb {
  prepare(query: string): SqlStatement;
  /** ONE implicit transaction: every statement commits, or none does. One
   *  result per statement, in order. */
  batch<T = unknown>(statements: SqlStatement[]): Promise<SqlResult<T>[]>;
}

// The error classification and the retry are the port's, and their one home
// stays services/_shared/src/d1.ts, whose header holds the production stack
// trace that named the transient reset and the caller contracts `run` and
// `batchIdempotent` rest on. Re-exported here so a caller of the port reaches
// them from the port.
export { isTransientD1Error, isUniqueViolation, withD1Retry, batchIdempotent } from '../d1';
