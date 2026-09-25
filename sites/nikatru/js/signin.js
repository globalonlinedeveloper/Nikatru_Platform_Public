// ─────────────────────────────────────────────────────────────────────────────
// signin.js — a small, hand-written GoTrue (Supabase Auth) REST client for the
// nikatru.com pages that need a signed-in user. An ES module: no CDN, no vendored
// bundle, no npm, because this site has no build step (sites/nikatru/README.md).
//
// ⏱ 2026-09-24 · O-EXTENSION-ACCOUNT-CHECK-UNBUILT — first used by /ext/connect;
// written once so the pricing page's sign-in can reuse it.
//
// ── THE ENDPOINTS, READ FROM SOURCE ─────────────────────────────────────────
// Read 2026-09-24 from supabase/auth-js src/GoTrueClient.ts
// (https://raw.githubusercontent.com/supabase/auth-js/master/src/GoTrueClient.ts)
// and supabase/auth README.md (https://github.com/supabase/auth):
//   · email + password — POST {AUTH}/token?grant_type=password
//       body { email, password, gotrue_meta_security: { captcha_token } }
//   · Sign in with Apple, PKCE — GET {AUTH}/authorize?provider=apple
//       &redirect_to=…&code_challenge=…&code_challenge_method=s256
//     GoTrue returns to redirect_to with `?code=<auth_code>`, then
//       POST {AUTH}/token?grant_type=pkce  body { auth_code, code_verifier }
//   · every call carries the publishable key in the `apikey` header.
//
// ── WHAT IS KEPT, AND WHERE ─────────────────────────────────────────────────
// The session lives IN MEMORY ONLY, in the caller's variable; nothing here
// writes it anywhere. `sessionStorage` holds just what must survive the Apple
// round trip — the GoTrue verifier and the page's own query parameters — and
// `completeAppleSignIn` clears it on return, whatever the outcome. Sign-in
// only: this file creates no account.
//
// ⚠️ SELF-HOSTED GoTrue GATES `grant_type=password` WITH A CAPTCHA
// (tooling/ci/assert-captcha-gated-call-sites.mjs). `signInWithPassword` passes
// a captcha token through when the caller has one; a page without a captcha
// widget will be refused by that gate.
// ─────────────────────────────────────────────────────────────────────────────

/** The GoTrue host. Self-hosted since 2026-09-24; never a *.supabase.co host. */
export const SUPABASE_URL = 'https://auth-api.nikatru.com';

/** The PUBLISHABLE key of the self-hosted GoTrue — public by design. Filled
 *  2026-09-25; .gitleaks.toml records why and allows exactly this one. */
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_QNEBX6oUcWllQVU212e41A_Axpy1gmh';

const AUTH = `${SUPABASE_URL}/auth/v1`;
const STASH_KEY = 'nikatru.signin.pkce';

function b64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** A GoTrue call. Resolves to the parsed session, or throws an Error whose
 *  message is a fixed phrase — never the response body, which can echo input. */
async function tokenCall(grant, body) {
  let res;
  try {
    res = await fetch(`${AUTH}/token?grant_type=${grant}`, {
      method: 'POST',
      headers: { apikey: SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error('network');
  }
  if (!res.ok) throw new Error(res.status === 400 || res.status === 401 ? 'credentials' : 'unavailable');
  const session = await res.json();
  if (!session || typeof session.access_token !== 'string') throw new Error('unavailable');
  return session;
}

/** Email + password. Returns the session; the caller keeps it in memory. */
export function signInWithPassword(email, password, { captchaToken } = {}) {
  return tokenCall('password', {
    email,
    password,
    ...(captchaToken ? { gotrue_meta_security: { captcha_token: captchaToken } } : {}),
  });
}

/**
 * Sign in with Apple — the outbound half. Stores the verifier and `carry` (the
 * page's own parameters, which the round trip would otherwise lose) in
 * sessionStorage, then navigates to GoTrue. `returnTo` must be this page's own
 * URL WITHOUT a query string; GoTrue appends `?code=…` to it.
 */
export async function startAppleSignIn(returnTo, carry) {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  sessionStorage.setItem(STASH_KEY, JSON.stringify({ verifier, carry }));
  const q = new URLSearchParams({
    provider: 'apple',
    redirect_to: returnTo,
    code_challenge: challenge,
    code_challenge_method: 's256',
  });
  location.assign(`${AUTH}/authorize?${q.toString()}`);
}

/**
 * Sign in with Apple — the return half. Exchanges GoTrue's `code` for a session
 * and returns `{ session, carry }`. The stash is cleared FIRST, so a failed
 * exchange cannot be retried with a stale verifier.
 */
export async function completeAppleSignIn(authCode) {
  const raw = sessionStorage.getItem(STASH_KEY);
  sessionStorage.removeItem(STASH_KEY);
  let stash = null;
  try {
    stash = raw === null ? null : JSON.parse(raw);
  } catch {
    stash = null;
  }
  if (!stash || typeof stash.verifier !== 'string') throw new Error('stale');
  const session = await tokenCall('pkce', { auth_code: authCode, code_verifier: stash.verifier });
  return { session, carry: stash.carry ?? null };
}

/** Whether a return from GoTrue is pending for this tab — read without clearing. */
export function hasPendingAppleSignIn() {
  return sessionStorage.getItem(STASH_KEY) !== null;
}
