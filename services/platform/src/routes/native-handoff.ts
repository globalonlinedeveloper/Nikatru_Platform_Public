// ─────────────────────────────────────────────────────────────────────────────
// native-handoff.ts — THE SIGNED-IN WEB PAGE MINTS A DESKTOP APP'S SIGN-IN CODE.
//
// ⏱ 2026-10-01 · ADR draft `native-sign-in-per-target` (amends ADR no.084), row
// O-DESKTOP-EMAIL-SIGN-IN-HAS-NO-ATTESTED-PATH. Windows, macOS and Linux cannot
// attest, so their sign-in happens in the SYSTEM BROWSER:
//
//   POST /v1/auth/handoff/:app/code   JWT (platformAuth), FROM A BROWSER.
//                       https://nikatru.com/app/connect, holding a session the
//                       user has just made there, mints a
//                       120-second code bound to {app, user, redirect_uri,
//                       code_challenge}. Answers {code, redirect_uri}, where
//                       redirect_uri is the value it was given AFTER the server
//                       held it to the app's own return addresses
//                       (lib/native-attest/handoff.ts isHandoffRedirect) — the page
//                       navigates only there.
//
// The app exchanges the code at POST /v1/auth/native/:app/handoff/token
// (routes/native-auth.ts), where a browser cannot follow.
//
// ── WHAT A CALLER MUST HOLD ─────────────────────────────────────────────────
//   · a verified access token (platformAuth, which also refuses a session
//     "sign out everywhere" ended);
//   · 🔴 A FRESH ONE: its newest `amr` timestamp inside RECENT_AUTH_SECONDS. A
//     code turns an access token into a NEW long-lived session, so a token lifted
//     from a page an hour ago must not be able to mint one. The connect page
//     signs in on the spot, so a real user always passes;
//   · its own SESSIONS_LIMITER budget, keyed `handoff:<user>` (fails open, as the
//     ext mint does: the caller is already authenticated).
//
// Nothing secret is logged: the request id and a fixed reason only.
// ─────────────────────────────────────────────────────────────────────────────
import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { NATIVE_AUTH_APPS } from '../generated/app-targets';
import { platformAuth } from '../middleware/auth';
import { withinRateLimit } from '../lib/edge-ceiling';
import { readBoundedBody } from '../lib/body';
import { CLOCK_SKEW_SECONDS, RECENT_AUTH_SECONDS } from '../../../_shared/src/auth';
import {
  handoffConfigured,
  isHandoffRedirect,
  isS256Challenge,
  mintHandoffCode,
  NATIVE_HANDOFF_CODE_TTL_SECONDS,
} from '../lib/native-attest/handoff';

/**
 * A redirect, a challenge and a method; 4 KiB holds them with room for the JSON.
 *
 * @ceiling workers.maxRequestBodySize lte
 */
export const MAX_HANDOFF_BODY_BYTES = 4096;

/** The answer to a session that did not sign in just now — the page shows its sign-in form again. */
export const HANDOFF_NEEDS_FRESH_SIGNIN = { error: 'handoff_needs_fresh_signin' } as const;

const SCHEME_SAFE_APP_ID = /^[a-z][a-z0-9]*$/;

/** Whether the token's user authenticated inside RECENT_AUTH_SECONDS (and not in the future). */
export function signedInJustNow(lastAuthenticatedAt: number | null | undefined, nowSeconds: number): boolean {
  if (typeof lastAuthenticatedAt !== 'number') return false;
  return nowSeconds - lastAuthenticatedAt <= RECENT_AUTH_SECONDS && lastAuthenticatedAt - nowSeconds <= CLOCK_SKEW_SECONDS;
}

/** The router for a given app set; the default export serves NATIVE_AUTH_APPS. */
export function createNativeHandoff(apps: readonly string[]): Hono<AppEnv> {
  const served = new Set(apps);
  const r = new Hono<AppEnv>();

  r.post('/auth/handoff/:app/code', platformAuth, async (c) => {
    c.header('Cache-Control', 'no-store');
    const app = c.req.param('app') ?? '';
    if (!SCHEME_SAFE_APP_ID.test(app) || !served.has(app)) return c.json({ error: 'unknown_app' }, 404);
    if (!signedInJustNow(c.get('authRecency')?.lastAuthenticatedAt, Math.floor(Date.now() / 1000))) {
      return c.json(HANDOFF_NEEDS_FRESH_SIGNIN, 401);
    }
    if (!(await withinRateLimit(c.env.SESSIONS_LIMITER, `handoff:${c.get('userId')}`, 'SESSIONS_LIMITER'))) {
      return c.json({ error: 'rate_limited' }, 429);
    }
    const bounded = await readBoundedBody(c.req.raw, MAX_HANDOFF_BODY_BYTES);
    if (!bounded.ok) return c.json({ error: 'invalid_body' }, bounded.status);
    let b: unknown;
    try {
      b = JSON.parse(bounded.text);
    } catch {
      return c.json({ error: 'invalid_body' }, 400);
    }
    if (typeof b !== 'object' || b === null || Array.isArray(b)) return c.json({ error: 'invalid_body' }, 400);
    const body = b as Record<string, unknown>;
    // Byte-for-byte against the app's own return addresses; nothing normalised.
    if (typeof body.redirect_uri !== 'string' || !isHandoffRedirect(app, body.redirect_uri)) {
      return c.json({ error: 'redirect_uri_mismatch' }, 400);
    }
    // S256 only. The method field is optional; when present it must say S256.
    if (body.code_challenge_method !== undefined && body.code_challenge_method !== 'S256') {
      return c.json({ error: 'unsupported_code_challenge_method' }, 400);
    }
    if (!isS256Challenge(body.code_challenge)) return c.json({ error: 'invalid_code_challenge' }, 400);
    if (!handoffConfigured(c.env)) {
      console.error(`[native-handoff] rid=${c.get('requestId') ?? '-'} NATIVE_ATTEST_CHALLENGE_KEY or PLATFORM_DB is not set`);
      return c.json({ error: 'service_unavailable' }, 503);
    }
    const code = await mintHandoffCode(c.env, {
      app,
      user: c.get('userId') as string,
      // sealed in, so a revoke of THIS session refuses the code (handoff.ts revokedSinceMint)
      sessionId: c.get('sessionId'),
      redirectUri: body.redirect_uri,
      codeChallenge: body.code_challenge,
      now: Date.now(),
    });
    console.log(`[native-handoff] rid=${c.get('requestId') ?? '-'} route=code app=${app} status=200`);
    return c.json({ code, redirect_uri: body.redirect_uri, expires_in: NATIVE_HANDOFF_CODE_TTL_SECONDS });
  });

  return r;
}

export default createNativeHandoff(NATIVE_AUTH_APPS);
