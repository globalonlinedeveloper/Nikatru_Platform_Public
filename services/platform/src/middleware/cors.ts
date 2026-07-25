import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../types';

// CORS for the SHARED platform Worker.
//
// This is no longer a config-read-only endpoint: since [ADR 020] a client-only
// stamped app has no Worker of its own and calls this host for analytics,
// entitlements and account deletion. So the method list must cover writes —
// `GET, OPTIONS` alone would preflight-block `DELETE /v1/account` from every
// web build, and the failure would look like a browser bug, not a config bug.
//
// ORIGIN POLICY: ALLOWED_ORIGINS is a comma-separated exact allowlist. When it
// is empty we accept any `*.nikatru.com` origin over https rather than
// reflecting `*`, because every stamped app lives on such a subdomain — that
// keeps a new app working with no platform redeploy while still refusing
// arbitrary sites. A non-browser client (no Origin header) is unaffected: CORS
// is a browser mechanism and never a substitute for auth.
const kOriginSuffix = '.nikatru.com';

function isPortfolioOrigin(origin: string): boolean {
  try {
    const u = new URL(origin);
    return (
      u.protocol === 'https:' &&
      (u.hostname === 'nikatru.com' || u.hostname.endsWith(kOriginSuffix))
    );
  } catch {
    return false;
  }
}

export const corsMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  const origin = c.req.header('Origin') ?? '';
  const allow = (c.env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const allowed =
    allow.length === 0
      ? isPortfolioOrigin(origin)
        ? origin
        : origin === ''
          ? '*' // non-browser caller; nothing to reflect
          : ''
      : allow.includes(origin)
        ? origin
        : '';
  if (allowed) {
    c.header('Access-Control-Allow-Origin', allowed);
    c.header('Vary', 'Origin');
    c.header('Access-Control-Allow-Headers', 'Authorization, Content-Type, x-request-id');
    c.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  }
  if (c.req.method === 'OPTIONS') {
    return c.body(null, 204);
  }
  await next();
  return;
};
