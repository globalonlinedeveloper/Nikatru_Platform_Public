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
// ── 🔴 PORTED FROM services/subly-api 2026-09-04, AND THE HISTORY IS THE POINT —
// this template shipped the ORIGINAL shape until then: `catch (primaryErr)` fell
// through to HS256 on ANY primary failure. So an outage did not 401, it
// **silently downgraded every request from a signature to a shared string**, and
// every app ever stamped from this brick inherited that. The fix landed in
// `services/platform` (#433) and `services/subly-api` (#435) and was never
// propagated here, which is precisely the class of gap the 2026-09-04
// inherit-everything-generic audit exists to close.
//
// ⚠️ AND #435 RECORDS THAT THE FIRST VERSION OF THE PREDICATE WAS WRONG TWICE —
// too narrow to fire in production (it keyed on `TypeError`, undici's shape,
// while these Workers run on workerd) and simultaneously too wide to be safe (it
// accepted `ERR_JWKS_NO_MATCHING_KEY`, so a token signed by a ROTATED-OUT key
// would have been served from the stale cache). The corrected predicate is what
// is ported below; do not "simplify" it back.
// ─────────────────────────────────────────────────────────────────────────────
import type { MiddlewareHandler } from 'hono';
import {
  createLocalJWKSet,
  createRemoteJWKSet,
  jwtVerify,
  type JWTPayload,
  type JWTVerifyGetKey,
} from 'jose';
import type { AppEnv, Env, TokenAssurance } from '../types';

const JWKS_KV_KEY = 'supabase_jwks';
const JWKS_TTL_SECONDS = 600; // 10 minutes

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

/** One declaration, both verification paths, so the two cannot drift into a
 *  weaker one an attacker reaches by making the JWKS endpoint unreachable. */
const verifyOptions = (supabaseUrl: string) => ({
  issuer: `${supabaseUrl}/auth/v1`,
  audience: 'authenticated',
  algorithms: ['ES256'],
});

/**
 * Did the KEY SET fail to arrive, as opposed to the TOKEN failing to verify?
 *
 * Only the first earns a second attempt against the cache. The distinction is
 * the whole security property: a bad token must fail here and now, and must not
 * get a second bite against an older key set.
 *
 * WHAT IT KEYS ON: `ERR_JWKS_TIMEOUT`; `ERR_JOSE_GENERIC` (which jose's
 * `fetch_jwks` raises for a NON-200 — the likeliest outage shape when Supabase
 * is reached through a tunnel, since a tunnel with no origin answers 502/530);
 * and an error carrying NO jose `code`, which can only have come from the
 * runtime `fetch`.
 *
 * ⚠️ IT DELIBERATELY DOES NOT ACCEPT `ERR_JWKS_NO_MATCHING_KEY` or
 * `ERR_JWKS_MULTIPLE_MATCHING_KEYS`. Those are raised AFTER a key set was
 * obtained and are facts about the TOKEN — accepting them would serve a token
 * signed by a rotated-out key from the stale cache.
 *
 * ⚠️ Every jose class sets a `code` in its constructor, so a FUTURE jose class
 * arrives WITH one and is excluded by the last clause rather than swept in.
 */
function isKeySetUnavailable(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const code = (err as { code?: unknown }).code;
  // No jose code at all => the runtime fetch failed. Not a verification outcome.
  if (typeof code !== 'string') return true;
  if (code === 'ERR_JWKS_TIMEOUT' || code === 'ERR_JOSE_GENERIC') return true;
  // A non-jose code such as ECONNREFUSED / ENOTFOUND is still a transport
  // failure; every jose code is prefixed `ERR_`.
  return !code.startsWith('ERR_');
}

/**
 * The KV-cached key set, or null.
 *
 * 🔴 THIS IS WHAT MADE `warmJwksCache` MORE THAN A WASTE OF A KV WRITE. Until
 * 2026-09-04 this template WROTE the cache on every request and never read it,
 * so a JWKS outage went straight to the shared secret rather than to the copy
 * of the public keys already sitting in KV.
 */
async function localSetFromCache(
  jwksCache: KVNamespace | undefined,
): Promise<JWTVerifyGetKey | null> {
  try {
    if (!jwksCache) return null;
    const cached = await jwksCache.get(JWKS_KV_KEY);
    if (!cached) return null;
    const parsed = JSON.parse(cached) as { keys?: unknown[] };
    // An EMPTY key set is not a usable fallback — it is exactly what a
    // misconfigured GoTrue publishes, and treating it as one would turn a
    // configuration error into a silent, permanent 401 nobody could diagnose.
    if (!Array.isArray(parsed.keys) || parsed.keys.length === 0) return null;
    return createLocalJWKSet(parsed as Parameters<typeof createLocalJWKSet>[0]);
  } catch {
    // A corrupt or unparseable cache is no cache. Fail closed.
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

/** The `Bearer <token>` part of an Authorization header, or null. */
const bearer = (authz: string): string | null =>
  /^Bearer\s+(.+)$/i.exec(authz)?.[1] ?? null;

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
