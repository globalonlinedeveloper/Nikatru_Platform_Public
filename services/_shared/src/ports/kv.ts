// ─────────────────────────────────────────────────────────────────────────────
// ports/kv.ts — THE KEY-VALUE PORT. tooling/ports/kv.json is its registry;
// tooling/ports/README.md is the standard.
//
// ⏱ 2026-10-01 · O-CLOUDFLARE-BINDINGS-SCATTERED (port-storage). Every handler
// that reads or writes CONFIG_KV, JWKS_CACHE, SESSION_REVOKED or SIGNUPS takes a
// `KvStore`, never a `KVNamespace` (assert-ports limb 9). The Cloudflare binding
// satisfies this interface STRUCTURALLY — no wrapper sits on the hot path; the
// adapter module (adapters/cloudflare.ts) is a compile-time proof, not a shim.
//
// THE SURFACE IS WHAT THIS PORTFOLIO CALLS, AND NO MORE: a text or JSON read, a
// string write with an optional TTL, a delete and a paged list. No metadata
// write, no `cacheTtl`, no binary value — a new verb is added here deliberately,
// with its conformance case, never reached for on the binding.
//
// ⚠️ NOT THE README'S OUTCOME SHAPE. KV is a cache and a revocation list, and
// each caller already owns its failure policy at the call (sessionRevoked fails
// OPEN, a revocation WRITE fails the request, the JWKS cache is best-effort).
// So a read that cannot be served REJECTS, as the binding does, and the caller's
// try/catch stays the one place its policy is written. A MISSING key is `null`,
// never a throw — conformance case `missing-is-null`.
//
// Nothing durable lives in KV (tooling/capability-register.json → cloudflare →
// exportPath): last-good config, a public JWKS document, short-lived revocation
// records and rate counters. Its export duty is "rebuildable".
// ─────────────────────────────────────────────────────────────────────────────

/** Options a write may carry. `expirationTtl` is in SECONDS (KV's floor is 60). */
export interface KvPutOptions {
  expirationTtl?: number;
}

/** One page request. `limit` defaults to the store's own page size. */
export interface KvListOptions {
  prefix?: string | null;
  cursor?: string | null;
  limit?: number;
}

/** One listed key. `metadata` is whatever the store recorded, or absent. */
export interface KvListKey {
  name: string;
  expiration?: number;
  metadata?: unknown;
}

/** One page of keys; `cursor` is present while `list_complete` is false. */
export interface KvListPage {
  keys: KvListKey[];
  list_complete: boolean;
  cursor?: string;
}

/** The key-value port. A `KVNamespace` is one; `fakes/kv.ts` is another. */
export interface KvStore {
  /** The value as text, or null when the key is absent or expired. */
  get(key: string, type?: 'text'): Promise<string | null>;
  /** The value parsed as JSON, or null when absent. A value that is not JSON REJECTS. */
  get<T = unknown>(key: string, type: 'json'): Promise<T | null>;
  put(key: string, value: string, options?: KvPutOptions): Promise<void>;
  /** Deleting an absent key is not an error. */
  delete(key: string): Promise<void>;
  /** Keys in lexicographic order, one page at a time. */
  list(options?: KvListOptions): Promise<KvListPage>;
}
