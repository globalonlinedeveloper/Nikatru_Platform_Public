import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../types';

// CORS for the SHARED platform Worker.
//
// Since [ADR 020] a client-only stamped app has no Worker of its own and calls
// this host for config, analytics, entitlements and account deletion. So the
// method list must cover writes — `GET, OPTIONS` alone would preflight-block
// `DELETE /v1/account` from every web build, and the failure would look like a
// browser bug rather than a config bug.
//
// ⏱ 2026-09-22 — IT HAPPENED AGAIN, ONE METHOD OVER. `PUT /v1/account/apple-token`
// was live while this list read `GET, POST, DELETE, OPTIONS`, so every web sign-in
// with Apple had its token refused at preflight and the revoke-on-delete path never
// had anything to revoke. The list is what the MOUNTED routes answer — GET, POST,
// PUT, DELETE; no platform route answers PATCH, so PATCH is not offered. It is no
// longer a hand-kept promise: test/cors.test.ts reads the real app's route table
// and preflights every mounted route with its own method, so a route mounted with
// a method missing here is red in CI before it is refused in a browser.
//
// ── ORIGIN POLICY: an EXACT allowlist (owner decision 2026-07-25) ────────────
// `ALLOWED_ORIGINS` is a comma-separated list of exact origins. Nothing is
// pattern-matched and nothing is inferred: an origin is either on the list or it
// gets no CORS headers, and the browser blocks it.
//
// ⚠️ THE OPERATIONAL COST IS REAL — every new app's web origin must be added to
// `ALLOWED_ORIGINS` in this Worker's wrangler.jsonc and redeployed, or that app
// silently loses config resolution and analytics in the browser. The brick's
// post_gen checklist prints this as a required step for exactly that reason. An
// earlier revision suffix-matched `*.nikatru.com` to avoid the redeploy; the
// owner chose the explicit list, so the redeploy is the accepted trade.
//
// ⚠️ AN EMPTY LIST NOW DENIES EVERY BROWSER ORIGIN — it no longer falls back to
// `*`. Clearing this var takes every web build offline for config + analytics.
//
// WHAT THIS DOES AND DOES NOT BUY: `/v1/events` and `/v1/consent` are
// deliberately unauthenticated and carry no cookies, so CORS is NOT their
// security boundary — anyone can POST from curl, and the rate limiter plus the
// hard batch caps are what actually protect them. The allowlist is hygiene: it
// keeps a write-capable host from advertising `Access-Control-Allow-Origin: *`.
// Treat it as such, and do not let it stand in for auth on any future route.

/** Exact origins, parsed from the comma-separated `ALLOWED_ORIGINS` var. */
function allowlist(env: AppEnv['Bindings']): string[] {
  return (env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export const corsMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  const origin = c.req.header('Origin') ?? '';
  const allow = allowlist(c.env);

  // No Origin header ⇒ a non-browser caller (server-to-server, curl, the Flutter
  // desktop/mobile HTTP stack). CORS is a browser mechanism and there is nothing
  // to reflect, so this is unaffected — and was never protected by CORS anyway.
  const allowed = origin === '' ? '*' : allow.includes(origin) ? origin : '';

  if (allowed) {
    c.header('Access-Control-Allow-Origin', allowed);
    c.header('Vary', 'Origin');
    c.header('Access-Control-Allow-Headers', 'Authorization, Content-Type, x-request-id');
    c.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  }
  if (c.req.method === 'OPTIONS') {
    return c.body(null, 204);
  }
  await next();
  return;
};
