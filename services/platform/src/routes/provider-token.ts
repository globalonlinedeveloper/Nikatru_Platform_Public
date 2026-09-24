// ─────────────────────────────────────────────────────────────────────────────
// provider-token.ts — PUT /v1/account/provider-token (and its Apple-only alias
// PUT /v1/account/apple-token), ON THEIR OWN, AND THE SEPARATION IS A CONTRACT
// RATHER THAN TIDINESS.
//
// tooling/ci/assert-analytics-contract.mjs pins DELETE /v1/account by its STATUS
// SET: every status routes/account.ts can answer must be one the released client
// models (`AccountDeletionFailure.forStatus`), because an unmodelled status
// reaches the user as "we cannot tell how much of it was removed". These routes
// answer 400 and 503, which mean nothing to that mapping — left in the same file
// they would silently widen the deletion's wire contract. One route, one contract.
//
// ⏱ 2026-09-24 · O-GOOGLE-SIGN-IN-NOT-BUILT. Moved from apple-token.ts: the
// Apple-only keeper became a PROVIDER keeper. The new path names its provider in
// the body; the old path is kept, unchanged on the wire, because the web client
// that shipped on 2026-09-22 still sends to it — it writes `provider = 'apple'`.
//
// Both are mounted behind `platformAuth` by the `/v1/account/*` line in index.ts.
// ─────────────────────────────────────────────────────────────────────────────
import { Hono, type Context } from 'hono';
import type { AppEnv } from '../types';
import { isProviderName, putProviderToken, type ProviderName } from '../lib/provider-revoke';

const providerToken = new Hono<AppEnv>();

/**
 * ⏱ 2026-09-16 · O-SIWA-TOKEN-NOT-REVOKED-ON-DELETE — KEEP THE ONE THING A
 * DELETION CANNOT BE DONE WITHOUT.
 *
 * Apple requires an app offering Sign in with Apple to revoke the user's tokens
 * when their account is deleted, and the revoke call takes a token; deleting an
 * account must cut the app's Google grant the same way. Supabase returns
 * `provider_refresh_token` to the CLIENT once, in the session that completes the
 * OAuth redirect, and stores none of it; supabase/auth#1308 is closed as not
 * planned. So the app posts it here, once per OAuth sign-in.
 *
 * 🔴 THE SUBJECT IS THE JWT'S, NEVER THE BODY'S, and the provider the body names
 * must be one the JWT's `app_metadata.providers` lists. A token for a provider the
 * account has not linked is refused with 400: stored, it would be revoked at the
 * wrong provider on deletion, and a deletion kept pending on a revoke that can
 * never succeed is a deletion that never finishes.
 *
 * 🔴 THE BODY IS A CREDENTIAL AND IS NEVER LOGGED, NEVER ECHOED AND NEVER READ
 * BACK BY ANY ROUTE. The only reader is the revoke path. The response says how
 * many rows were written and nothing else.
 */
async function keepProviderToken(c: Context<AppEnv>, fixedProvider: ProviderName | null) {
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
  // The alias names no provider on the wire: its path IS the provider.
  const provider = fixedProvider ?? (body as { provider?: unknown } | null)?.provider;
  if (!isProviderName(provider)) {
    return c.json({ error: 'invalid_provider' }, 400);
  }
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
  if (!(c.get('linkedProviders') ?? []).includes(provider)) {
    console.warn(`[account] rid=${rid} app=${c.env.APP_ID} refused a ${provider} token: the account has not linked ${provider}`);
    return c.json({ error: 'provider_not_linked' }, 400);
  }
  try {
    await putProviderToken(c.env.PLATFORM_DB, userId, provider, appId, token.trim(), new Date().toISOString());
  } catch (err) {
    console.error(`[account] rid=${rid} app=${c.env.APP_ID} could not store the ${provider} token`, err);
    // `apple_token_store_failed` is the body the alias always answered here.
    return c.json({ error: `${provider}_token_store_failed` }, 503);
  }
  console.log(`[account] rid=${rid} app=${c.env.APP_ID} stored 1 ${provider} provider token for a subject`);
  return c.json({ ok: true, stored: 1 });
}

providerToken.put('/account/provider-token', (c) => keepProviderToken(c, null));

/** The 2026-09-22 web client's path: Apple's token, `{ refreshToken, appId }`. */
providerToken.put('/account/apple-token', (c) => keepProviderToken(c, 'apple'));

export default providerToken;
