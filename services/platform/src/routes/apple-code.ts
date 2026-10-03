// ─────────────────────────────────────────────────────────────────────────────
// apple-code.ts — PUT /v1/account/apple-code: THE NATIVE SIGN IN WITH APPLE
// SHEET'S HALF OF O-SIWA-TOKEN-NOT-REVOKED-ON-DELETE.
//
// ⏱ 2026-10-02 · review of #1155, finding 1. On iOS and macOS the app signs in
// through Apple's own sheet and `signInWithIdToken`, and that session carries
// NO provider refresh token — so an account made there had nothing for a
// deletion to revoke, and `revokeAppleToken` answered `none` while Apple still
// listed the app under the user's "Apps using Apple ID". The sheet does return
// a one-time `authorizationCode`; the app posts it here once, and the Worker
// exchanges it at Apple (the Sign in with Apple key lives only in its secrets)
// and keeps the refresh token exactly where the browser door's token goes,
// `provider_tokens` under `apple`, with the bundle id it was issued to.
//
// A route of its own for the reason provider-token.ts gives: the DELETE
// /v1/account status set is a pinned contract, and this answers 400/502/503.
// Mounted behind `platformAuth` by the `/v1/account/*` line in index.ts.
//
// 🔴 THE CODE AND THE TOKEN ARE CREDENTIALS: never logged, never echoed, and
// the response says how many rows were written and nothing else.
// ─────────────────────────────────────────────────────────────────────────────
import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { exchangeAppleAuthorizationCode, putProviderToken } from '../lib/provider-revoke';

const appleCode = new Hono<AppEnv>();

appleCode.put('/account/apple-code', async (c) => {
  const userId = c.get('userId');
  const rid = c.get('requestId') ?? '-';
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_body' }, 400);
  }
  const code = (body as { authorizationCode?: unknown } | null)?.authorizationCode;
  const appId = (body as { appId?: unknown } | null)?.appId;
  // The app id names the bundle the code was issued to (`com.nikatru.<appId>`),
  // so it is held to the same slug shape as the provider-token route.
  if (typeof appId !== 'string' || !/^[a-z0-9][a-z0-9-]{1,39}$/.test(appId)) {
    return c.json({ error: 'invalid_app_id' }, 400);
  }
  // Apple's codes are opaque dot-separated base64url-ish strings; anything else,
  // or anything unbounded, is not one and is never sent to Apple.
  if (typeof code !== 'string' || code.length < 8 || code.length > 2048 || !/^[A-Za-z0-9._-]+$/.test(code)) {
    return c.json({ error: 'invalid_code' }, 400);
  }
  // The same cross-check as a stored token: a code for an account that has not
  // linked Apple would be revoked at the wrong provider on deletion.
  if (!(c.get('linkedProviders') ?? []).includes('apple')) {
    console.warn(`[account] rid=${rid} app=${c.env.APP_ID} refused an apple code: the account has not linked apple`);
    return c.json({ error: 'provider_not_linked' }, 400);
  }
  const exchanged = await exchangeAppleAuthorizationCode(c.env, appId, code);
  if (exchanged.kind !== 'ok') {
    console.error(`[account] rid=${rid} app=${c.env.APP_ID} apple code not exchanged (${exchanged.kind}): ${exchanged.why}`);
    if (exchanged.kind === 'refused') return c.json({ error: 'apple_code_refused' }, 400);
    return c.json({ error: 'apple_code_exchange_failed' }, exchanged.kind === 'blocked' ? 503 : 502);
  }
  try {
    await putProviderToken(c.env, userId, 'apple', appId, exchanged.refreshToken, new Date().toISOString(), exchanged.clientId);
  } catch (err) {
    console.error(`[account] rid=${rid} app=${c.env.APP_ID} could not store the apple token`, err);
    return c.json({ error: 'apple_token_store_failed' }, 503);
  }
  console.log(`[account] rid=${rid} app=${c.env.APP_ID} stored 1 apple provider token from a native sheet code`);
  return c.json({ ok: true, stored: 1 });
});

export default appleCode;
