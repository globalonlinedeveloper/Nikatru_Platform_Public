// ─────────────────────────────────────────────────────────────────────────────
// platformAuth — the ONE authentication boundary of the shared Worker.
//
// [pipeline B-3] "The shared server can verify an identity token at the edge and
//                 expose a user id."
//
// SWAP-PROVIDER NOTE: this is the only file in services/platform that knows we
// use Supabase. To move to another identity provider, rewrite `verify()` to
// point at that provider's issuer + JWKS URL; every route just reads
// `c.get('userId')`. Keep this file the single seam.
//
// ── 🔴 WHY THERE IS NO HS256 FALLBACK, AND WHY THAT IS A DELIBERATE DIVERGENCE ─
// `services/subly-api/src/middleware/auth.ts` — the file this is ported from —
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
import type { AppEnv, Env } from '../types';

const JWKS_KV_KEY = 'supabase_jwks';

/**
 * 🔴 THE VERIFY OPTIONS ARE DECLARED ONCE AND SHARED BY BOTH PATHS, AND THAT IS
 * THE WHOLE SAFETY ARGUMENT FOR THE FALLBACK BELOW.
 *
 * A fallback that accepts a token the primary path would reject is worse than
 * the outage it fixes. Writing the options twice is how the two drift — one
 * gets `algorithms` tightened and the other does not, and the weaker path is
 * the one an attacker reaches by making the JWKS endpoint unreachable. So there
 * is exactly one object, and both `jwtVerify` calls take it.
 *
 * `algorithms: ['ES256']` is INV-406 ("ES256 via JWKS only"): without it, a
 * token whose header says `alg: none` or a symmetric algorithm is decided by
 * the token itself — the caller choosing how they are verified.
 */
const verifyOptions = (supabaseUrl: string) => ({
  issuer: `${supabaseUrl}/auth/v1`,
  audience: 'authenticated',
  algorithms: ['ES256'],
});

/**
 * @ceiling none — a CACHE LIFETIME, and its relation to `kv.writesPerDay` is
 * INVERSE (a longer TTL spends FEWER writes), so an `lte` comparison against
 * that ceiling would be arithmetic that cannot fail. The arithmetic that
 * justifies the value, written out: one write per expiry is 86400/600 = 144
 * writes/day, ~14% of the Free daily budget this namespace shares with
 * CONFIG_KV. Taking it to 60s would spend 1,440/day and exhaust the account.
 */
const JWKS_TTL_SECONDS = 600; // 10 minutes

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
 */
/**
 * Could the KEY SET not be obtained, as distinct from the token being bad?
 *
 * Written as a positive test against the shapes jose actually raises when the
 * fetch fails, rather than as "not a JWT error" — a negative test would send
 * every future jose error class down the fallback path, which is the direction
 * that widens what is accepted.
 */
function isKeySetUnavailable(err: unknown): boolean {
  if (err instanceof TypeError) return true; // undici: "fetch failed"
  const code = (err as { code?: unknown })?.code;
  return (
    code === 'ERR_JWKS_TIMEOUT' ||
    code === 'ERR_JWKS_NO_MATCHING_KEY' ||
    code === 'ERR_JWKS_MULTIPLE_MATCHING_KEYS'
  );
}

async function localSetFromCache(env: Env): Promise<JWTVerifyGetKey | null> {
  try {
    if (!env.JWKS_CACHE) return null;
    const cached = await env.JWKS_CACHE.get(JWKS_KV_KEY);
    if (!cached) return null;
    const parsed = JSON.parse(cached) as { keys?: unknown[] };
    // An EMPTY key set is not a usable fallback — it is exactly what a
    // misconfigured GoTrue publishes, and treating it as one would turn a
    // configuration error into a silent, permanent 401 nobody could diagnose.
    if (!Array.isArray(parsed.keys) || parsed.keys.length === 0) return null;
    return createLocalJWKSet(parsed as Parameters<typeof createLocalJWKSet>[0]);
  } catch {
    // A corrupt or unparseable cache is no cache. Fail closed, as before.
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

/**
 * Hono middleware. On success sets `userId` (+ `userEmail` when the token
 * carries one) and calls next(). On ANY failure it answers 401 with
 * `{ error: 'unauthorized' }` and nothing else — the reason a token was refused
 * is a fact about our verification, not information a caller is owed.
 */
export const platformAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const match = /^Bearer\s+(.+)$/i.exec(c.req.header('Authorization') ?? '');
  if (!match) return c.json({ error: 'unauthorized' }, 401);

  try {
    void warmCache(c.env);
    const opts = verifyOptions(c.env.SUPABASE_URL);
    let payload;
    try {
      ({ payload } = await jwtVerify(match[1], jwks(c.env.SUPABASE_URL), opts));
    } catch (err) {
      // ⚠️ ONLY a key-set acquisition failure earns a second attempt. jose
      // raises JWKSNoMatchingKey / JOSEError subclasses for a bad token, and a
      // TypeError("fetch failed") — or a JWKSTimeout — when it could not reach
      // the endpoint at all. Retrying a BAD TOKEN against the cache would be a
      // second bite at verification, which is not what this exists for.
      if (!isKeySetUnavailable(err)) throw err;
      const local = await localSetFromCache(c.env);
      // No usable cache ⇒ behave exactly as before: fail closed.
      if (!local) throw err;
      ({ payload } = await jwtVerify(match[1], local, opts));
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
    await next();
    return;
  } catch {
    return c.json({ error: 'unauthorized' }, 401);
  }
};
