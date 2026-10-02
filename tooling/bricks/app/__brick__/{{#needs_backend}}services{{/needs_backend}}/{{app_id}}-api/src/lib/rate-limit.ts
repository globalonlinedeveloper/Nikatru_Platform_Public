// rate-limit.ts — a RE-EXPORT. The one home is services/_shared/src/rate-limit.ts:
// the fail-open `withinRateLimit`, the fail-closed `strictRateLimit`, and the
// server-derived edge key no caller can vary. Bind a `ratelimits` entry in
// wrangler.jsonc before a route relies on it.
export * from '../../../_shared/src/rate-limit';
