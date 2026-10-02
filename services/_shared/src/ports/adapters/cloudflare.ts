// ─────────────────────────────────────────────────────────────────────────────
// adapters/cloudflare.ts — THE CLOUDFLARE ADAPTERS OF THE STORAGE PORTS, AND THE
// ONLY MODULE OUTSIDE A `types.ts` THAT NAMES A CLOUDFLARE BINDING TYPE.
//
// ⏱ 2026-10-01 · O-CLOUDFLARE-BINDINGS-SCATTERED (port-storage). The impl rows of
// tooling/ports/{kv,objects,ratelimit}.json. Each function is the IDENTITY: the
// binding already satisfies its port STRUCTURALLY, so nothing wraps the hot path
// and nothing here runs per request. What each one buys is the COMPILE-TIME
// proof — `tsc --noEmit` in every Worker that type-checks services/_shared/src
// fails the day `@cloudflare/workers-types` drifts from the port — which is what
// lets every `Env` declare its bindings as `KvStore`, `ObjectStore` and
// `RateLimiter` and every handler see the port and nothing more.
//
// The binding types are ambient (`@cloudflare/workers-types`, each Worker's
// `compilerOptions.types`); there is no import, so this module carries no bare
// specifier (shared-home.test.ts).
// ─────────────────────────────────────────────────────────────────────────────
import type { KvStore } from '../kv';
import type { ObjectStore } from '../objects';
import type { RateLimiter } from '../ratelimit';

/** tooling/ports/kv.json adapter `cloudflare-kv`. */
export function cloudflareKv(binding: KVNamespace): KvStore {
  return binding;
}

/** tooling/ports/objects.json adapter `cloudflare-r2`. */
export function cloudflareR2(bucket: R2Bucket): ObjectStore {
  return bucket;
}

/** tooling/ports/ratelimit.json adapter `cloudflare-ratelimit`. */
export function cloudflareRateLimiter(binding: RateLimit): RateLimiter {
  return binding;
}
