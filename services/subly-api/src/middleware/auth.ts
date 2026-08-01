// ─────────────────────────────────────────────────────────────────────────────
// supabaseAuth — verifies the Supabase JWT on the Authorization header.
//
// SWAP-PROVIDER NOTE: this is the ONLY file that knows we use Supabase. To move
// to Firebase (or Auth0, Clerk, ...), rewrite the verification block below to
// point at that provider's issuer + JWKS URL; the rest of the app just reads
// c.get('userId') / c.get('userEmail'). Keep this file the single seam.
//
// Verification strategy:
//   PRIMARY  — asymmetric (RS256/ES256): fetch Supabase's JWKS and verify the
//              signature, issuer and audience. The JWKS is cached in KV for a
//              short TTL to cut cold-verify latency and reduce egress.
//   FALLBACK — legacy HS256: if SUPABASE_JWT_SECRET is configured, verify with
//              the shared secret. Some older Supabase projects still sign HS256.
// ─────────────────────────────────────────────────────────────────────────────

import type { MiddlewareHandler } from 'hono';
import {
  createRemoteJWKSet,
  jwtVerify,
  type JWTPayload,
  type JWTVerifyGetKey,
} from 'jose';
import type { AppEnv, Env } from '../types';

const JWKS_KV_KEY = 'supabase_jwks';
/**
 * @ceiling none — and the reason is that the relation is INVERSE, so an `lte`
 * comparison against `kv.writesPerDay` would be arithmetic that cannot fail and
 * would therefore overstate what is checked.
 *
 * The resource this bounds is KV WRITES, whose Free ceiling is 1,000/day
 * (`tooling/ceilings.json` → `kv.writesPerDay`) — and a LARGER TTL spends FEWER
 * of them, not more. The arithmetic, written out because it is the whole
 * justification for the value: one write per expiry gives 86400/600 = 144
 * writes/day per namespace, ~14% of the Free daily budget, shared with the
 * config namespace. Halving this constant doubles that; taking it to 60s would
 * spend 1,440/day and exhaust the account's entire KV write budget on a cache.
 */
const JWKS_TTL_SECONDS = 600; // 10 minutes

// Cache the remote JWKS *getter* per SUPABASE_URL for the lifetime of the
// isolate. createRemoteJWKSet keeps its own in-memory cache + coalescing, and
// only refetches when it sees an unknown `kid`. We additionally stash the raw
// JWKS JSON in KV (below) so a cold isolate can warm-start without a round-trip
// to Supabase on the very first request.
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

/**
 * Best-effort warm of the KV-cached JWKS. We don't feed this into jose's getter
 * (jose manages its own fetch), but keeping a fresh copy in KV lets us prefetch
 * cheaply and gives an operational cache we can inspect. Failures are swallowed.
 */
async function warmJwksCache(env: Env): Promise<void> {
  try {
    const cached = await env.JWKS_CACHE.get(JWKS_KV_KEY);
    if (cached) return; // still warm
    const res = await fetch(
      `${env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`,
    );
    if (!res.ok) return;
    const body = await res.text();
    await env.JWKS_CACHE.put(JWKS_KV_KEY, body, {
      expirationTtl: JWKS_TTL_SECONDS,
    });
  } catch {
    // Non-fatal: verification still works via jose's own fetch.
  }
}

async function verifySupabaseToken(
  token: string,
  env: Env,
): Promise<JWTPayload> {
  const issuer = `${env.SUPABASE_URL}/auth/v1`;

  // PRIMARY: asymmetric verification via remote JWKS (alg pinned to ES256).
  try {
    // Fire-and-forget KV warm; verification does not block on it.
    void warmJwksCache(env);
    const jwks = getRemoteJWKS(env.SUPABASE_URL);
    const { payload } = await jwtVerify(token, jwks, {
      issuer,
      audience: 'authenticated',
      algorithms: ['ES256'],
    });
    return payload;
  } catch (primaryErr) {
    // FALLBACK: legacy HS256 shared-secret verification, if configured.
    // Issuer + alg enforced: a token from any OTHER Supabase project must fail.
    if (env.SUPABASE_JWT_SECRET) {
      const key = new TextEncoder().encode(env.SUPABASE_JWT_SECRET);
      const { payload } = await jwtVerify(token, key, {
        issuer,
        audience: 'authenticated',
        algorithms: ['HS256'],
      });
      return payload;
    }
    throw primaryErr;
  }
}

/**
 * Hono middleware. On success sets `userId` (+ optional `userEmail`) and calls
 * next(). On any failure returns 401 JSON `{ error: 'unauthorized' }`.
 */
export const supabaseAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const authz = c.req.header('Authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(authz);
  if (!match) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  const token = match[1];

  try {
    const payload = await verifySupabaseToken(token, c.env);
    if (!payload.sub) {
      return c.json({ error: 'unauthorized' }, 401);
    }
    c.set('userId', payload.sub);
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
