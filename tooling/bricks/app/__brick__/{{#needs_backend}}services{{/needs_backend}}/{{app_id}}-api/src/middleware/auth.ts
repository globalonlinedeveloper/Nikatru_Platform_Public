// ─────────────────────────────────────────────────────────────────────────────
// supabaseAuth — verifies the Supabase JWT on the Authorization header. This is
// the ONLY file that knows we use Supabase (the provider seam). To move to
// Firebase/Auth0/Clerk, rewrite the verification block; the rest of the app just
// reads c.get('userId') / c.get('userEmail').
//   PRIMARY  — asymmetric ES256 via Supabase JWKS (cached in KV).
//   FALLBACK — legacy HS256 shared secret, if SUPABASE_JWT_SECRET is set.
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

async function verifySupabaseToken(
  token: string,
  env: Env,
): Promise<JWTPayload> {
  const issuer = `${env.SUPABASE_URL}/auth/v1`;
  try {
    void warmJwksCache(env);
    const jwks = getRemoteJWKS(env.SUPABASE_URL);
    const { payload } = await jwtVerify(token, jwks, {
      issuer,
      audience: 'authenticated',
      algorithms: ['ES256'],
    });
    return payload;
  } catch (primaryErr) {
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

export const supabaseAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const authz = c.req.header('Authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(authz);
  if (!match) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  try {
    const payload = await verifySupabaseToken(match[1], c.env);
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
