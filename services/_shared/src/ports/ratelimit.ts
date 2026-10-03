// ─────────────────────────────────────────────────────────────────────────────
// ports/ratelimit.ts — THE RATE-LIMITER PORT. tooling/ports/ratelimit.json is its
// registry; tooling/ports/README.md is the standard.
//
// ⏱ 2026-10-01 · O-CLOUDFLARE-BINDINGS-SCATTERED (port-storage). The ~18
// `*_LIMITER` bindings were already reached through ONE home,
// services/_shared/src/rate-limit.ts (`withinRateLimit`, `strictRateLimit` and
// the edge ceilings), against a structural `RateLimiterBinding`. This is that
// interface promoted to a port: rate-limit.ts now re-exports it under its old
// name, every carrier's `Env` names its limiters with it, and a Workers Rate
// Limiting binding satisfies it STRUCTURALLY (adapters/cloudflare.ts proves it at
// compile time; nothing wraps the hot path).
//
// The FAILURE POLICY IS NOT HERE. A limiter that is absent or rejects is the
// caller's to answer — fail OPEN (`withinRateLimit`, the edge shield) or fail
// CLOSED (`strictRateLimit`) — so `limit` rejects as the binding does, and the
// port carries no outcome type that would let a third policy grow beside them.
//
// Stateless as far as an exit is concerned: the counters are a burst bound that
// expires within one period, so nothing is exported on a switch.
// ─────────────────────────────────────────────────────────────────────────────

/** The rate-limiter port: one counted request against `key`. */
export interface RateLimiter {
  /** `success: false` = over budget for this period. */
  limit(options: { key: string }): Promise<{ success: boolean }>;
}
