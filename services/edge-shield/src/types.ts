// ─────────────────────────────────────────────────────────────────────────────
// The edge shield's bindings. Every one but RELEASE is a Workers Rate Limiting binding
// declared in ../wrangler.jsonc, and every one is OPTIONAL here on purpose: an
// absent binding FAILS OPEN (src/limit.ts), because the shield must never be the
// reason sign-in or crash intake is down. test/wrangler-config.test.ts asserts
// the DEPLOYED config declares all of them, so "optional in the type" never
// becomes "absent in production" unseen.
//
// ONE limiter per class, keyed `global:<class>`, and no per-client one: LEAD
// RULING SHIELD-R3 (2026-09-26) — this Worker never reads the client's address.
// The per-IP limit on the credential endpoints is the nikatru.com zone's own
// rate-limiting rule (tooling/edge-ratelimit-rule.json).
// ─────────────────────────────────────────────────────────────────────────────

/** The Workers Rate Limiting binding surface this Worker uses. */
export interface RateLimiterBinding {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface Env {
  /** The commit SHA, supplied at deploy time (`--var RELEASE:${{ github.sha }}`, never in
   *  wrangler.jsonc) and echoed as the shield header's value (src/index.ts shieldMark). */
  RELEASE?: string;
  AUTH_CREDENTIAL_GLOBAL_LIMITER?: RateLimiterBinding;
  AUTH_REFRESH_GLOBAL_LIMITER?: RateLimiterBinding;
  AUTH_OTHER_GLOBAL_LIMITER?: RateLimiterBinding;
  INTAKE_GLOBAL_LIMITER?: RateLimiterBinding;
}
