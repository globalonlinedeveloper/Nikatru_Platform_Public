// ─────────────────────────────────────────────────────────────────────────────
// supabaseAuth — verifies the Supabase JWT on the Authorization header. This is
// the ONLY file that knows we use Supabase (the provider seam). To move to
// Firebase/Auth0/Clerk, rewrite the verification block; the rest of the app just
// reads c.get('userId') / c.get('userEmail').
//   PRIMARY  — asymmetric ES256 via Supabase JWKS, with a KV-cached key set as
//              the second attempt when, and ONLY when, the key set could not be
//              fetched at all.
//   FALLBACK — legacy HS256 shared secret, if SUPABASE_JWT_SECRET is set, and
//              the result is LABELLED `symmetric` so an irreversible route can
//              refuse it.
//
// ── 🔴 TWO AUTH BOUNDARIES, AND THE DIFFERENCE IS THE POINT ──────────────────
// [supabaseAuth] may fall back to the shared secret. [erasureAuth] does only the
// asymmetric half, with the secret out of scope entirely, and `index.ts` mounts
// DELETE /v1/account behind it. `routes/account.ts` then RE-CHECKS the assurance
// label — two independent limbs, because the mounting is one line somebody can
// move and the route-level check is not.
//
// ── 🔴 PORTED FROM services/subscriptiontracker-api 2026-09-04, AND THE HISTORY IS THE POINT —
// this template shipped the ORIGINAL shape until then: `catch (primaryErr)` fell
// through to HS256 on ANY primary failure. So an outage did not 401, it
// **silently downgraded every request from a signature to a shared string**, and
// every app ever stamped from this brick inherited that. The fix landed in
// `services/platform` (#433) and `services/subscriptiontracker-api` (#435) and was never
// propagated here, which is precisely the class of gap the 2026-09-04
// inherit-everything-generic audit exists to close.
//
// ── 🔴 …AND SINCE [ADR 067] decision 2 IT CANNOT HAPPEN THAT WAY AGAIN ───────
// The DECIDING now lives ONCE, at `services/_shared/src/auth.ts`, and this
// template imports it exactly as `services/platform` and `services/subscriptiontracker-api`
// do: the ES256 pin (`verifyOptions`), the twice-corrected `isKeySetUnavailable`
// predicate, `JWKS_KV_KEY`, `JWKS_TTL_SECONDS`, `bearer`, and the refusal to
// treat an empty JWKS document as a usable cache. A correction to any of those
// reaches a stamped app by being made once. What stays here is the `jose`/`hono`
// plumbing and the shared-secret fallback — `services/_shared/` can carry no
// bare import (that file's header holds the measurement), and collapsing the
// fallback would be a security change rather than a refactor.
//
// ⚠️ #435 RECORDS THAT THE FIRST VERSION OF THE PREDICATE WAS WRONG TWICE — too
// narrow to fire in production (it keyed on `TypeError`, undici's shape, while
// these Workers run on workerd) and simultaneously too wide to be safe (it
// accepted `ERR_JWKS_NO_MATCHING_KEY`, so a token signed by a ROTATED-OUT key
// would have been served from the stale cache). It is not restated below
// because it is not copied below; it is imported, and its cases are in
// `services/_shared/test/auth-core.test.ts`.
// ─────────────────────────────────────────────────────────────────────────────
import type { MiddlewareHandler } from 'hono';
import {
  createLocalJWKSet,
  createRemoteJWKSet,
  jwtVerify,
  type JWTPayload,
  type JWTVerifyGetKey,
} from 'jose';
import {
  JWKS_KV_KEY,
  JWKS_TTL_SECONDS,
  bearer,
  isKeySetUnavailable,
  usableJwksDocument,
  verifyOptions,
  authRecencyOf,
} from '../../../_shared/src/auth';
import type { AppEnv, Env, TokenAssurance } from '../types';

const remoteSetCache = new Map<string, JWTVerifyGetKey>();

function getRemoteJWKS(supabaseUrl: string): JWTVerifyGetKey {
  let set = remoteSetCache.get(supabaseUrl);
  if (!set) {
    set = createRemoteJWKSet(
      new URL(`${supabaseUrl}/auth/v1/.well-known/jwks.json`),
    );
    remoteSetCache.set(supabaseUrl, set);
  }
  return set;
}

async function warmJwksCache(env: Env): Promise<void> {
  try {
    const cached = await env.JWKS_CACHE.get(JWKS_KV_KEY);
    if (cached) return;
    const res = await fetch(`${env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`);
    if (!res.ok) return;
    await env.JWKS_CACHE.put(JWKS_KV_KEY, await res.text(), {
      expirationTtl: JWKS_TTL_SECONDS,
    });
  } catch {
    // Non-fatal: jose manages its own fetch.
  }
}

/**
 * The KV-cached key set, or null.
 *
 * 🔴 THIS IS WHAT MADE `warmJwksCache` MORE THAN A WASTE OF A KV WRITE. Until
 * 2026-09-04 this template WROTE the cache on every request and never read it,
 * so a JWKS outage went straight to the shared secret rather than to the copy
 * of the public keys already sitting in KV.
 *
 * The parse and the empty-key-set refusal are `usableJwksDocument` in the shared
 * home; only the key-set construction, which needs `jose`, is here.
 */
async function localSetFromCache(
  jwksCache: KVNamespace | undefined,
): Promise<JWTVerifyGetKey | null> {
  try {
    if (!jwksCache) return null;
    const doc = usableJwksDocument(await jwksCache.get(JWKS_KV_KEY));
    if (doc === null) return null;
    return createLocalJWKSet(doc as Parameters<typeof createLocalJWKSet>[0]);
  } catch {
    // A corrupt cache, or a KV read that threw, is no cache. Fail closed.
    return null;
  }
}

/**
 * ⚠️ IT TAKES `supabaseUrl`, NOT `Env`, AND THAT IS NOT A STYLE CHOICE.
 * "This path cannot fall back to a shared secret" is thereby a property of the
 * SIGNATURE — checkable by reading four lines — rather than a claim about a body
 * a later edit could quietly falsify. Handing it `Env` to reach `JWKS_CACHE`
 * would destroy exactly that guarantee.
 */
async function verifyAsymmetric(
  token: string,
  supabaseUrl: string,
  jwksCache?: KVNamespace,
): Promise<JWTPayload> {
  const opts = verifyOptions(supabaseUrl);
  try {
    const { payload } = await jwtVerify(token, getRemoteJWKS(supabaseUrl), opts);
    return payload;
  } catch (err) {
    // ONLY a key-set acquisition failure earns a second attempt, and it uses the
    // SAME `opts` object. A bad token still fails here and now.
    if (!isKeySetUnavailable(err)) throw err;
    const local = await localSetFromCache(jwksCache);
    if (!local) throw err;
    const { payload } = await jwtVerify(token, local, opts);
    return payload;
  }
}

async function verifySupabaseToken(
  token: string,
  env: Env,
): Promise<{ payload: JWTPayload; assurance: TokenAssurance }> {
  const issuer = `${env.SUPABASE_URL}/auth/v1`;

  try {
    // Fire-and-forget KV warm; verification does not block on it.
    void warmJwksCache(env);
    return {
      payload: await verifyAsymmetric(token, env.SUPABASE_URL, env.JWKS_CACHE),
      assurance: 'asymmetric',
    };
  } catch (primaryErr) {
    // FALLBACK: legacy HS256 shared-secret verification, if configured. Issuer
    // and alg are still enforced, so a token from any OTHER Supabase project
    // fails. The asymmetric path now survives a mere outage, so this branch is
    // reached far more rarely than it used to be.
    if (env.SUPABASE_JWT_SECRET) {
      const key = new TextEncoder().encode(env.SUPABASE_JWT_SECRET);
      const { payload } = await jwtVerify(token, key, {
        issuer,
        audience: 'authenticated',
        algorithms: ['HS256'],
      });
      // ⚠️ `'symmetric'` IS THE POINT OF THIS RETURN. The route that must never
      // run on it reads exactly this value.
      return { payload, assurance: 'symmetric' };
    }
    throw primaryErr;
  }
}

export const supabaseAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const token = bearer(c.req.header('Authorization') ?? '');
  if (token === null) {
    return c.json({ error: 'unauthorized' }, 401);
  }

  try {
    const { payload, assurance } = await verifySupabaseToken(token, c.env);
    if (!payload.sub) {
      return c.json({ error: 'unauthorized' }, 401);
    }
    c.set('userId', payload.sub);
    c.set('tokenAssurance', assurance);
    c.set('authRecency', authRecencyOf(payload as Record<string, unknown>));
    const email = (payload as { email?: unknown }).email;
    if (typeof email === 'string') {
      c.set('userEmail', email);
    }
    await next();
    return;
  } catch {
    return c.json({ error: 'unauthorized' }, 401);
  }
};

/**
 * THE STRICTER BOUNDARY — ES256 only, with the shared secret out of scope.
 *
 * 🔴 IT EXISTS BECAUSE A FALLBACK THAT TRIGGERS ON ANY PRIMARY FAILURE TRIGGERS
 * WHEN SUPABASE IS MERELY UNREACHABLE. Behind a read, being admitted on a shared
 * string is a data leak. Behind `DELETE /v1/account` it is an unauthenticated
 * remote wipe of anybody's account, because whoever learns that one environment
 * variable can mint a token for any user.
 *
 * ⚠️ IT PASSES `c.env.SUPABASE_URL` AND `c.env.JWKS_CACHE` INDIVIDUALLY rather
 * than handing over `Env`. The whole guarantee is that no code path reachable
 * from here can see `SUPABASE_JWT_SECRET`, and that is only inspectable if the
 * secret never enters scope in the first place.
 *
 * ⚠️ NOTE THE CACHE IS STILL USED HERE. That is deliberate and is not a
 * weakening: the cache holds Supabase's own PUBLIC keys, so verifying against it
 * is still asymmetric proof. Without it a JWKS outage would stop account
 * deletion outright, which is how the erasure path broke before.
 */
export const erasureAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const token = bearer(c.req.header('Authorization') ?? '');
  if (token === null) {
    return c.json({ error: 'unauthorized' }, 401);
  }

  try {
    void warmJwksCache(c.env);
    const payload = await verifyAsymmetric(
      token,
      c.env.SUPABASE_URL,
      c.env.JWKS_CACHE,
    );
    // `sub` IS the user id. A verified token with no subject authenticates
    // nobody, and letting it through would hand every `WHERE user_id = ?` an
    // undefined — which on a DELETE is the difference between erasing nothing
    // and being asked to erase everything.
    if (typeof payload.sub !== 'string' || payload.sub === '') {
      return c.json({ error: 'unauthorized' }, 401);
    }
    c.set('userId', payload.sub);
    c.set('tokenAssurance', 'asymmetric');
    // O-APP-API-DELETE-NO-RECENCY: read from the SAME verified payload, by the shared reader.
    c.set('authRecency', authRecencyOf(payload as Record<string, unknown>));
    const email = (payload as { email?: unknown }).email;
    if (typeof email === 'string') c.set('userEmail', email);
    await next();
    return;
  } catch (err) {
    // Logged, unlike the permissive boundary's silent 401: a refusal on the
    // erasure path is the one a user is most likely to report as "the delete
    // button does nothing", and the reason must be recoverable from the tail.
    // The token itself is never logged.
    console.error(
      `[erasure-auth] rid=${c.get('requestId') ?? '-'} app=${c.env.APP_ID} refused: the bearer token did not verify against the JWKS (ES256). There is NO shared-secret fallback on this boundary.`,
      err instanceof Error ? err.message : err,
    );
    return c.json({ error: 'unauthorized' }, 401);
  }
};
