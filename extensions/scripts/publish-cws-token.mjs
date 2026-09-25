#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// publish-cws-token.mjs — the ONE Chrome Web Store access-token mint.
//
// 🔴 IT IS ITS OWN MODULE SO EVERY CWS CALLER MINTS THE SAME WAY. A scheduled
// check that exercises a credential adjacent to the one the release uses keeps
// the wrong thing alive and reports success, which is the worst possible shape
// for a credential whose failure mode is silent.
//
// ── CONVERTED 2026-09-09 FROM refresh_token TO A SERVICE ACCOUNT ─────────────
// This module used to hold `exchangeRefreshToken()`: client_id + client_secret +
// refresh_token against https://oauth2.googleapis.com/token. That shape was a
// STALE ASSUMPTION, not a requirement. Google now documents service accounts for
// the Chrome Web Store API —
//   https://developer.chrome.com/docs/webstore/service-accounts (fetched 2026-09-09)
// — "Grant your service account access to the Chrome Web Store API by adding the
// service account email in the Developer Dashboard, under the Account section",
// with the scope `https://www.googleapis.com/auth/chromewebstore`, and the
// standing limit that "At this time, you can only add one service account to
// your publisher."
//
// WHY THAT IS THE BETTER SHAPE AND NOT MERELY A DIFFERENT ONE. The three OAuth
// values had to be minted by a human through the OAuth playground, and the
// refresh token then carried a NON-USE CLOCK: unused long enough, Google revokes
// it, and nothing in this tree would say so until a tag push. A service-account
// key has no non-use clock and no playground step — the same key the Play lane
// already uses (PLAY_SERVICE_ACCOUNT_JSON, ADR 031) authenticates here, so this
// repository now has ONE way of authenticating to Google rather than two.
//
// ⚠️ AUTHENTICATION IS NOT AUTHORISATION, AND THE DIFFERENCE IS THE WHOLE RISK.
// A minted token proves the KEY is alive. It does NOT prove the service account
// was added to the publisher in the Developer Dashboard. Measured 2026-09-09:
// `:fetchStatus` answers 403 PERMISSION_DENIED with the message "Permission
// denied on resource '…' (or it might not exist)" for the REAL publisher and for
// a BOGUS publisher ALIKE, byte for byte apart from the echoed id — so with no
// item in the account, linkage cannot be read out of this API at all. It becomes
// readable the moment a real listing id exists: see publish-cws-keepalive.mjs.
//
// ⚠️ NOTHING HERE PRINTS A TOKEN, AN ASSERTION, OR ONE BYTE OF THE PRIVATE KEY.
// The caller receives the access token as a value; what is ever printed is its
// lifetime and its scope.
// ─────────────────────────────────────────────────────────────────────────────
import { createSign } from 'node:crypto';

export const TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const CWS_API_DOC = 'https://developer.chrome.com/docs/webstore/using-api';
export const CWS_SA_DOC = 'https://developer.chrome.com/docs/webstore/service-accounts';
export const CWS_SCOPE = 'https://www.googleapis.com/auth/chromewebstore';

/** The env var carrying the service-account key JSON. Named once, here:
 *  publish-cws.mjs, publish-cws-keepalive.mjs and publish-arming.mjs's Chrome
 *  preflight import it, so the preflight and both callers cannot drift apart
 *  on it. .github/workflows/extensions.yml cannot import a constant and spells
 *  the name; tooling/ci/test/extensions-shared-constants.test.mjs requires the
 *  workflow's CWS_* secret names to equal the preflight's, so a rename here
 *  that the workflow does not follow goes red. */
export const CWS_SA_ENV = 'CWS_SERVICE_ACCOUNT_JSON';

/** The fields a Google service-account key JSON must carry for the JWT-bearer
 *  grant. A secret pasted with a wrapping quote or a lost newline looks EXACTLY
 *  like a present one to a bare presence check, which is why the shape is
 *  validated rather than the length. Mirrors the Play lane's SA_REQUIRED_KEYS. */
const SA_REQUIRED_KEYS = ['type', 'client_email', 'private_key'];

/**
 * Parse and shape-check a service-account key.
 * Never returns, logs or embeds the private key.
 * @returns {{ok:true, sa:object} | {ok:false, detail:string}}
 */
export function readServiceAccount(raw) {
  const text = String(raw ?? '').trim();
  if (text === '') {
    return { ok: false, detail: `${CWS_SA_ENV} is absent or empty.` };
  }
  let sa;
  try {
    sa = JSON.parse(text);
  } catch (e) {
    return {
      ok: false,
      detail: `${CWS_SA_ENV} is set but does not parse as JSON (${e.message}). A truncated or quote-wrapped paste looks exactly like a present secret.`,
    };
  }
  for (const field of SA_REQUIRED_KEYS) {
    if (typeof sa?.[field] !== 'string' || sa[field] === '') {
      return { ok: false, detail: `${CWS_SA_ENV} parses but carries no \`${field}\`. The key material is never printed.` };
    }
  }
  return { ok: true, sa };
}

/**
 * Mint an access token with the JWT-bearer grant.
 *
 * Source: ${CWS_SA_DOC} and Google's service-account grant — header
 * {"alg":"RS256","typ":"JWT"}; claims iss (service-account email), scope
 * (space-delimited), aud (always https://oauth2.googleapis.com/token), exp
 * (at most one hour after iat), iat; grant_type
 * "urn:ietf:params:oauth:grant-type:jwt-bearer"; response
 * {access_token, scope, token_type, expires_in}.
 *
 * `tokenUrl` is TOKEN_URL except under the CWS_OAUTH_TOKEN_URL loopback seam,
 * which the caller has already held to store-poll.mjs's `loopbackBase` rule
 * (EXT-6, 2026-09-25); `aud` follows it, since the audience is the endpoint.
 *
 * @returns {Promise<{ok:true, accessToken:string, expiresIn:(number|null), scope:(string|null), clientEmail:string}
 *                  | {ok:false, status:number, detail:string}>}
 */
export async function mintAccessToken({ serviceAccountJson, scope = CWS_SCOPE, fetchImpl = fetch, tokenUrl = TOKEN_URL }) {
  const parsed = readServiceAccount(serviceAccountJson);
  if (!parsed.ok) return { ok: false, status: 0, detail: parsed.detail };
  const sa = parsed.sa;

  const b64 = (v) => Buffer.from(v).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const signingInput = `${b64(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64(
    JSON.stringify({ iss: sa.client_email, scope, aud: tokenUrl, exp: now + 3600, iat: now }),
  )}`;
  let signature;
  try {
    signature = createSign('RSA-SHA256').update(signingInput).sign(sa.private_key);
  } catch (e) {
    // The message is about the KEY'S SHAPE and never quotes it.
    return {
      ok: false,
      status: 0,
      detail: `the service-account private_key could not sign an RS256 assertion (${e.message}). The key material is never printed; check that ${CWS_SA_ENV} carries the JSON exactly as Google issued it, newlines included.`,
    };
  }

  const r = await fetchImpl(tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${signingInput}.${b64(signature)}`,
    }).toString(),
  });
  const text = await r.text();
  if (!r.ok) {
    // A token error body names the reason (`invalid_grant` for a disabled or
    // deleted service account) and carries no secret of ours, so it is safe to
    // print and it is the only thing that tells an operator WHICH way the
    // credential died.
    return { ok: false, status: r.status, detail: text.slice(0, 500) };
  }
  let json;
  try {
    json = JSON.parse(text);
  } catch (e) {
    return { ok: false, status: r.status, detail: `the token endpoint answered 200 with non-JSON — ${e.message}` };
  }
  if (typeof json.access_token !== 'string' || json.access_token === '') {
    return { ok: false, status: r.status, detail: 'the token endpoint answered 200 with no access_token' };
  }
  return {
    ok: true,
    accessToken: json.access_token,
    expiresIn: json.expires_in ?? null,
    // ⚠️ Google's JWT-bearer response OMITS `scope` (measured 2026-09-09: the
    // field is absent, not empty). Fall back to the scope we ASKED for rather
    // than printing "undefined", which reads as "no scope was granted".
    scope: json.scope ?? scope,
    // An identifier, not a credential — and the only thing that lets an operator
    // see WHICH account a run authenticated as.
    clientEmail: sa.client_email,
  };
}
