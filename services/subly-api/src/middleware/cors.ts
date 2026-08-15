// ─────────────────────────────────────────────────────────────────────────────
// CORS — an EXACT allowlist, FAIL CLOSED. One rule across the whole portfolio.
//
// `[vars].ALLOWED_ORIGINS` is a comma-separated list of exact browser origins
// (e.g. "https://subly.nikatru.com,https://subly-9cp.pages.dev"). An origin is
// either on that list or it gets no CORS headers and the browser blocks it.
// Nothing is pattern-matched, nothing is inferred.
//
// ⚠️ AN EMPTY OR ABSENT LIST DENIES EVERY NON-LOCALHOST BROWSER ORIGIN — it does
// NOT fall back to '*'. It used to, and that was a THREE-WAY FORK of one seam:
// this Worker and the brick template fell open to '*' on empty while the shared
// platform Worker fell closed, and `assert-cors-allowlist.mjs` read only the
// platform config — so emptying THIS var turned a live user-data API into an
// answer-everyone API with CI fully green. The guard now iterates every
// services/*/wrangler.jsonc, and the fail-closed rule is identical in all three
// implementations. (The exposure was bounded — every /v1 data route is Bearer
// gated and hono/cors is invoked without credentials — so treat this as the
// hygiene ADR 020 calls it, and never as a substitute for auth on a new route.)
//
// LOCALHOST IS A RECORDED EXCEPTION, NOT AN OVERSIGHT. Localhost origins (any
// port, http/https) are allowed on top of the list because `flutter drive -d
// web-server` serves the app on http://localhost:<random-port>, which is a
// cross-origin caller to api.nikatru.com — the CI integration_test harness
// cannot name its own port in advance. Documented in
// Private/company/requirements/master-requirements.md ("CORS scoped to the app's
// origins + localhost") and as the INC13 fix. It is a PER-APP trade: the shared
// platform Worker deliberately does not carry it.
//
// Non-browser clients (mobile/desktop apps, curl, server-to-server) send no
// Origin header. CORS is a browser mechanism and there is nothing to reflect,
// so they are unaffected — and were never gated by this.
// ─────────────────────────────────────────────────────────────────────────────

import { cors } from 'hono/cors';
import type { Context, Next } from 'hono';
import type { AppEnv } from '../types';

const LOCALHOST = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

/** Exact origins, parsed from the comma-separated `ALLOWED_ORIGINS` var. */
export function allowlist(allowedOrigins: string | undefined): string[] {
  return (allowedOrigins ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * The origin decision, split out so it is testable on its own and so the rule
 * reads in one place: on the list, or localhost, or nothing.
 */
export function resolveOrigin(
  origin: string,
  list: string[],
): string | null {
  if (list.includes(origin)) return origin;
  if (LOCALHOST.test(origin)) return origin; // recorded per-app trade, see header
  return null; // FAIL CLOSED — never '*'
}

export const corsMiddleware = (c: Context<AppEnv>, next: Next) => {
  const list = allowlist(c.env.ALLOWED_ORIGINS);
  return cors({
    origin: (origin) => resolveOrigin(origin, list),
    // PUT was missing while `PUT /v1/budget` was live, so a browser preflight
    // for the budget save was rejected before the request was ever made — a
    // config bug that presents as a browser bug. The brick template already
    // listed it; this is the fork closing in the other direction.
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Authorization', 'Content-Type'],
    maxAge: 86400,
  })(c, next);
};
