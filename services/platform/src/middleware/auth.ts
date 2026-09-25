// ─────────────────────────────────────────────────────────────────────────────
// platformAuth — the ONE authentication boundary of the shared Worker.
//
// [pipeline B-3] "The shared server can verify an identity token at the edge and
// expose a user id."
//
// ── WHAT MOVED, AND WHAT DELIBERATELY DID NOT ────────────────────────────────
// The DECIDING is in `services/_shared/src/auth.ts` and is carried by every
// Worker: the ES256 pin (`verifyOptions`), the twice-corrected
// `isKeySetUnavailable` predicate, `JWKS_KV_KEY`, `JWKS_TTL_SECONDS`, `bearer`
// and `usableJwksDocument`. What stays HERE is the `jose`/`hono` plumbing that
// binds those decisions to this Worker's context type — because
// `services/_shared/` can carry no bare import at all (the measurement is in
// that file's header). [ADR 067] decision 2.
//
// SWAP-PROVIDER NOTE: this is the only file in services/platform that knows we
// use Supabase. To move to another identity provider, rewrite the verification
// below to point at that provider's issuer + JWKS URL; every route just reads
// `c.get('userId')`. Keep this file the single seam.
//
// ── 🔴 WHY THERE IS NO HS256 FALLBACK, AND WHY THAT IS A DELIBERATE DIVERGENCE ─
// `services/subscriptiontracker-api/src/middleware/auth.ts` — the file this is ported from —
// falls back to verifying with a shared secret (`SUPABASE_JWT_SECRET`) when the
// asymmetric path fails. That fallback is NOT carried across, on purpose:
//
//   · This Worker is the shared server for the WHOLE portfolio. Its auth
//     boundary guards account deletion and (with stage 5) entitlements for every
//     app, including apps that do not exist yet. A symmetric secret accepted
//     there is one leaked environment variable away from anyone minting a token
//     for any user of any app.
//   · A fallback that triggers on ANY primary failure is a fallback that
//     triggers when Supabase is merely unreachable — so a network blip silently
//     downgrades the portfolio's only auth boundary from asymmetric to shared-
//     secret. That is the failure mode, not the recovery.
//   · The asymmetric path needs no secret at all: the JWKS is public. So the
//     fallback buys nothing here that is worth what it costs.
//
// A token signed with the legacy HS256 secret is therefore a 401, and that case
// is a recorded failing input in test/auth.test.ts rather than a claim.
//
// 📌 AND SINCE [ADR 067] THAT IS A PROPERTY OF THIS FILE'S IMPORTS, NOT ONLY OF
// ITS BODY. `services/_shared/src/auth.ts` names no secret, and it is the only
// non-library module this file imports, so "nothing reachable from here can read
// SUPABASE_JWT_SECRET" is checkable by reading four import lines.
// `tooling/ci/assert-erasure-reach.mjs` limb 3 walks exactly that.
//
// ── THE CACHE, AND THE ROTATION IT MUST SURVIVE ──────────────────────────────
// ⚠️ The project has exactly ONE ES256 key today, which means a stale JWKS cache
// is invisible until the day it rotates — and on that day every authenticated
// request across every app fails at once. So the cache is TTL'd *and*
// refresh-on-unknown-kid: `createRemoteJWKSet` refetches when it sees a `kid` it
// does not hold, and the KV copy is the warm-start for a cold isolate rather
// than the source of truth. The two together mean a rotation costs one extra
// fetch, not an outage.
//
// The KV write is gated on the cached copy being ABSENT rather than issued on
// every miss: KV Free allows 1,000 writes/day account-wide
// (`tooling/ceilings.json` → `kv.writesPerDay`), shared with CONFIG_KV, and a
// cache that re-put on every cold isolate would spend that budget on itself.
// ─────────────────────────────────────────────────────────────────────────────

import type { MiddlewareHandler } from 'hono';
import { createLocalJWKSet, createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import {
  JWKS_KV_KEY,
  JWKS_TTL_SECONDS,
  bearer,
  isKeySetUnavailable,
  usableJwksDocument,
  verifyOptions,
  authRecencyOf,
} from '../../../_shared/src/auth';
import type { AppEnv, Env } from '../types';

/** The remote JWKS *getter*, cached per SUPABASE_URL for the isolate's life.
 *  `createRemoteJWKSet` keeps its own in-memory cache with request coalescing
 *  and refetches on an unknown `kid` — which is the half that survives a key
 *  rotation. Rebuilding it per request would throw that away and turn every
 *  verify into a fetch. */
const remoteSets = new Map<string, JWTVerifyGetKey>();

function jwks(supabaseUrl: string): JWTVerifyGetKey {
  let set = remoteSets.get(supabaseUrl);
  if (!set) {
    set = createRemoteJWKSet(new URL(`${supabaseUrl}/auth/v1/.well-known/jwks.json`));
    remoteSets.set(supabaseUrl, set);
  }
  return set;
}

/**
 * 🔴 THE JWKS USED TO FAIL CLOSED, AND THAT WAS A PORTFOLIO-WIDE OUTAGE WAITING
 * ON ONE BOX.
 *
 * Read from jose's own source (`src/jwks/remote.ts`): `createRemoteJWKSet`
 * keeps a per-isolate in-memory cache, and **on a failed fetch the error
 * propagates — there is no fallback to a previously cached key set.** At this
 * portfolio's user count isolates are almost always cold, so an unreachable
 * JWKS endpoint meant a cold isolate fetched, failed, and 401'd EVERY
 * authenticated request — not just logins, every read in every app.
 *
 * The KV copy already existed and was already written by `warmCache`, but its
 * own comment called it "the warm-start for a cold isolate rather than the
 * source of truth" and NOTHING READ IT ON THE FAILURE PATH. It does now.
 *
 * ⚠️ WHAT THIS DELIBERATELY DOES NOT DO. It does not widen what is accepted:
 * both paths take the same `verifyOptions`, so a token refused by the remote
 * path is refused by this one. It does not extend `JWKS_TTL_SECONDS` to make
 * the fallback last longer — the TTL is what lets a rotated key propagate, and
 * lengthening it to paper over an outage would trade a short outage for a
 * silent stale-key window. And it is reached ONLY when the key set could not be
 * obtained: an invalid token still 401s immediately, without a second attempt.
 *
 * ⚠️ IT TAKES THE ONE BINDING IT NEEDS, NOT `Env`, AND THAT IS NOT A STYLE
 * CHOICE. A function that never receives the environment cannot read
 * `SUPABASE_JWT_SECRET`. This Worker has no such secret to read, but the
 * signature is the shape the whole portfolio's erasure boundaries rest on and
 * writing it differently here is how the two would drift. The cached JWKS is a
 * PUBLIC document, so caching it adds no secret to this scope. (Converged with
 * `services/subscriptiontracker-api` on 2026-09-06; this file previously took `Env` and
 * reached `env.JWKS_CACHE`, which is the same value by a weaker route.)
 *
 * The parse and the empty-key-set refusal live in
 * `services/_shared/src/auth.ts`'s `usableJwksDocument` — the decision every
 * carrier makes identically; only the key-set construction, which needs `jose`,
 * is here.
 */
async function localSetFromCache(jwksCache: KVNamespace | undefined): Promise<JWTVerifyGetKey | null> {
  try {
    if (!jwksCache) return null;
    const doc = usableJwksDocument(await jwksCache.get(JWKS_KV_KEY));
    if (doc === null) return null;
    return createLocalJWKSet(doc as Parameters<typeof createLocalJWKSet>[0]);
  } catch {
    // A corrupt cache, or a KV read that threw, is no cache. Fail closed, as
    // before — the one `try` covers the same span the three copies always did.
    return null;
  }
}

/** Best-effort warm of the KV copy. Never awaited on the request path and never
 *  fatal: `jose` does its own fetching, so a KV failure costs latency on a cold
 *  isolate and nothing else. */
async function warmCache(env: Env): Promise<void> {
  try {
    if (!env.JWKS_CACHE) return;
    if (await env.JWKS_CACHE.get(JWKS_KV_KEY)) return; // still warm
    const res = await fetch(`${env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`);
    if (!res.ok) return;
    await env.JWKS_CACHE.put(JWKS_KV_KEY, await res.text(), {
      expirationTtl: JWKS_TTL_SECONDS,
    });
  } catch {
    // Non-fatal by construction. See the header note.
  }
}

// ⏱ 2026-09-16 · O-APP-API-DELETE-NO-RECENCY — `authRecencyOf` (how the verified
// token's user signs in, and when they last AUTHENTICATED — `amr`, never `iat`) moved
// VERBATIM to services/_shared/src/auth.ts, so every erasure door reads one
// implementation. Re-exported here so this Worker's callers and tests are unchanged.
export { authRecencyOf } from '../../../_shared/src/auth';

/**
 * ⏱ 2026-09-24 · O-GOOGLE-SIGN-IN-NOT-BUILT. The identity providers the VERIFIED
 * token says this account has linked: `app_metadata.providers`, the claim
 * `authRecencyOf` reads too. GoTrue writes `app_metadata` and a user cannot, so it
 * is the server's word, not the caller's. Strings only; an absent or malformed
 * claim is the empty list, which links nothing — so a route that cross-checks a
 * body against it refuses rather than guesses.
 */
export function linkedProvidersOf(payload: Record<string, unknown>): string[] {
  const meta = payload.app_metadata;
  const providers = meta && typeof meta === 'object' ? (meta as { providers?: unknown }).providers : undefined;
  return Array.isArray(providers) ? providers.filter((p): p is string => typeof p === 'string') : [];
}

/**
 * Hono middleware. On success sets `userId` (+ `userEmail` when the token
 * carries one) and calls next(). On ANY failure it answers 401 with
 * `{ error: 'unauthorized' }` and nothing else — the reason a token was refused
 * is a fact about our verification, not information a caller is owed.
 */
export const platformAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const token = bearer(c.req.header('Authorization') ?? '');
  if (token === null) return c.json({ error: 'unauthorized' }, 401);

  try {
    void warmCache(c.env);
    const opts = verifyOptions(c.env.SUPABASE_URL);
    let payload;
    try {
      ({ payload } = await jwtVerify(token, jwks(c.env.SUPABASE_URL), opts));
    } catch (err) {
      // ⚠️ ONLY a key-set acquisition failure earns a second attempt. jose
      // raises JWKSNoMatchingKey / JOSEError subclasses for a bad token, and a
      // TypeError("fetch failed") — or a JWKSTimeout — when it could not reach
      // the endpoint at all. Retrying a BAD TOKEN against the cache would be a
      // second bite at verification, which is not what this exists for.
      if (!isKeySetUnavailable(err)) throw err;
      const local = await localSetFromCache(c.env.JWKS_CACHE);
      // No usable cache ⇒ behave exactly as before: fail closed.
      if (!local) throw err;
      ({ payload } = await jwtVerify(token, local, opts));
    }
    // `sub` IS the user id. A verified token with no subject authenticates
    // nobody, and letting it through would set `userId` to undefined and hand
    // every `WHERE user_id = ?` a null — which matches no row on a read and, on
    // a DELETE, is the difference between deleting nothing and being asked to.
    if (typeof payload.sub !== 'string' || payload.sub === '') {
      return c.json({ error: 'unauthorized' }, 401);
    }
    c.set('userId', payload.sub);
    const email = (payload as { email?: unknown }).email;
    if (typeof email === 'string') c.set('userEmail', email);
    c.set('authRecency', authRecencyOf(payload as Record<string, unknown>));
    c.set('linkedProviders', linkedProvidersOf(payload as Record<string, unknown>));
    await next();
    return;
  } catch {
    return c.json({ error: 'unauthorized' }, 401);
  }
};
