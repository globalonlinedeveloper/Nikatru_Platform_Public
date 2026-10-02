// ─────────────────────────────────────────────────────────────────────────────
// identity-change.ts — POST /v1/account/identity-change: MAY THIS SESSION ADD
// OR REMOVE A WAY INTO THE ACCOUNT?
//
// ⏱ 2026-10-02 · review of #1155, finding 3. Settings › Connected accounts
// links a new OAuth identity and unlinks one. A new identity is a PERSISTENT
// way in that survives a password change, so the change is held to the
// deletion path's recency rule (O-OAUTH-DELETE-REAUTH): the token's own newest
// `amr` timestamp — when this person last PROVED who they are, never `iat` —
// must be inside RECENT_AUTH_SECONDS. Unlike deletion it applies to EVERY
// account: a password account proves it by typing the password again, which
// writes a fresh `amr` entry the same way a provider sheet does.
//
// The app asks this BEFORE it calls GoTrue's link or unlink, and a refusal is
// 403 `reauth_required`, never 401 (the client signs out on a 401; a person
// asked to confirm must stay signed in to do so).
//
// Mounted behind `platformAuth` by the `/v1/account/*` line in index.ts, which
// sets `authRecency` on every admitted request.
// ─────────────────────────────────────────────────────────────────────────────
import { Hono } from 'hono';
import type { AppEnv } from '../types';
import {
  CLOCK_SKEW_SECONDS,
  REAUTH_REQUIRED_BODY,
  REAUTH_REQUIRED_STATUS,
  RECENT_AUTH_SECONDS,
  type AuthRecency,
} from '../../../_shared/src/auth';

/** `null` = proceed; otherwise why the session is not fresh enough. A missing
 *  recency is a refusal: the middleware that sets it was bypassed. */
export function identityChangeRecencyRefusal(
  recency: AuthRecency | undefined,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): string | null {
  if (recency === undefined) return 'no sign-in recency was read from the token';
  const at = recency.lastAuthenticatedAt;
  if (at === null) return 'the token carries no amr timestamp';
  if (nowSeconds - at > RECENT_AUTH_SECONDS) {
    return `no sign-in in the last ${RECENT_AUTH_SECONDS}s (amr=${nowSeconds - at}s ago)`;
  }
  if (at - nowSeconds > CLOCK_SKEW_SECONDS) {
    return `amr timestamp ${at - nowSeconds}s in the future (skew allowance ${CLOCK_SKEW_SECONDS}s)`;
  }
  return null;
}

const identityChange = new Hono<AppEnv>();

identityChange.post('/account/identity-change', (c) => {
  const rid = c.get('requestId') ?? '-';
  const stale = identityChangeRecencyRefusal(c.get('authRecency'));
  if (stale !== null) {
    console.warn(`[account] rid=${rid} app=${c.env.APP_ID} refused a sign-in method change: ${stale}`);
    return c.json(REAUTH_REQUIRED_BODY, REAUTH_REQUIRED_STATUS);
  }
  return c.json({ ok: true });
});

export default identityChange;
