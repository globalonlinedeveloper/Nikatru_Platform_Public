// ─────────────────────────────────────────────────────────────────────────────
// apple-token.ts — PUT /v1/account/apple-token, ON ITS OWN, AND THE SEPARATION IS
// A CONTRACT RATHER THAN TIDINESS.
//
// tooling/ci/assert-analytics-contract.mjs pins DELETE /v1/account by its STATUS
// SET: every status routes/account.ts can answer must be one the released client
// models (`AccountDeletionFailure.forStatus`), because an unmodelled status
// reaches the user as "we cannot tell how much of it was removed". This route
// answers 400 and 503, which mean nothing to that mapping — left in the same file
// they would silently widen the deletion's wire contract. One route, one contract.
//
// It is mounted behind `platformAuth` by the `/v1/account/*` line in index.ts.
// ─────────────────────────────────────────────────────────────────────────────
import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { putAppleToken } from '../lib/apple-revoke';

const appleToken = new Hono<AppEnv>();

/**
 * ⏱ 2026-09-16 · O-SIWA-TOKEN-NOT-REVOKED-ON-DELETE — KEEP THE ONE THING A
 * DELETION CANNOT BE DONE WITHOUT.
 *
 * Apple requires an app offering Sign in with Apple to revoke the user's tokens
 * when their account is deleted, and the revoke call takes a token. Supabase
 * returns `provider_refresh_token` to the CLIENT once, in the session that
 * completes the OAuth redirect, and stores none of it; supabase/auth#1308 is
 * closed as not planned. So the app posts it here, once per Apple sign-in.
 *
 * 🔴 THE BODY IS A CREDENTIAL AND IS NEVER LOGGED, NEVER ECHOED AND NEVER READ
 * BACK BY ANY ROUTE. The only reader is the revoke path. The response says how
 * many rows were written and nothing else.
 */
appleToken.put('/account/apple-token', async (c) => {
  const userId = c.get('userId');
  const rid = c.get('requestId') ?? '-';
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_body' }, 400);
  }
  const token = (body as { refreshToken?: unknown } | null)?.refreshToken;
  const appId = (body as { appId?: unknown } | null)?.appId;
  // The provenance marker, not an authorisation: which app's sign-in produced
  // this token. A slug shape is all the server can check — the monitor resolves
  // it against the shipped catalogue, so a value naming no app reads as
  // unattributed rather than as a row nobody counted.
  if (typeof appId !== 'string' || !/^[a-z0-9][a-z0-9-]{1,39}$/.test(appId)) {
    return c.json({ error: 'invalid_app_id' }, 400);
  }
  // Bounded on both sides: an empty string would store a token that can never be
  // revoked, and an unbounded one is a write amplifier on a table keyed by user.
  if (typeof token !== 'string' || token.trim().length < 8 || token.length > 4096) {
    return c.json({ error: 'invalid_token' }, 400);
  }
  try {
    await putAppleToken(c.env.PLATFORM_DB, userId, appId, token.trim(), new Date().toISOString());
  } catch (err) {
    console.error(`[account] rid=${rid} app=${c.env.APP_ID} could not store the Apple token`, err);
    return c.json({ error: 'apple_token_store_failed' }, 503);
  }
  console.log(`[account] rid=${rid} app=${c.env.APP_ID} stored 1 Sign in with Apple token for a subject`);
  return c.json({ ok: true, stored: 1 });
});

export default appleToken;
