// ─────────────────────────────────────────────────────────────────────────────
// /app/connect — sign a Nikatru DESKTOP app in, through this browser.
//
// ⏱ 2026-10-01 · ADR draft `native-sign-in-per-target` (amends ADR no.084), row
// O-DESKTOP-EMAIL-SIGN-IN-HAS-NO-ATTESTED-PATH. Windows, macOS and Linux builds
// cannot attest, so they never take a password: the app opens this page with
//   ?app=<id>&redirect_uri=<loopback or deep link>&code_challenge=<S256>
//   &code_challenge_method=S256&state=…
// The user signs in HERE, reads which app is asking, and presses Continue.
// SIGN IN WITH APPLE ONLY: GoTrue gates the password grant with Turnstile, and a
// per-path CSP override may not widen where script comes from
// (tooling/ci/assert-web-cache-policy.mjs), so this page carries no widget and
// no password form (app/connect.html says where an email account goes). The page asks the platform for a 120-second,
// single-use, PKCE-bound code (POST /v1/auth/handoff/<app>/code) and hands it
// back by navigating to the redirect the SERVER returned, with `nk_code` and
// `state` (services/platform/src/lib/native-attest/handoff.ts has every rule).
//
// 🔴 NO OPEN REDIRECT. The only URL this page navigates to with a code is the
// `redirect_uri` in the mint's ANSWER, which the server holds to the app's own
// loopback (`http://127.0.0.1:<port>/nk-auth-callback`) or deep link
// (`com.nikatru.<app>://auth-callback?nk_auth=handoff`). `returnUrl` re-checks
// both shapes, so even a wrong server answer navigates nowhere else.
//
// Nothing is auto-submitted: Continue is the consent. The session is held in
// this module's memory only and dropped the moment the code is minted; the app
// gets a session of its OWN, never this one. `state` is passed back untouched.
// ─────────────────────────────────────────────────────────────────────────────
import {
  startAppleSignIn,
  completeAppleSignIn,
  hasPendingAppleSignIn,
} from '../js/signin.js';

const PLATFORM = 'https://platform.nikatru.com';

/** The apps a desktop build of which may hand off — the native app set (services/platform/src/generated/app-targets.ts). */
const APPS = { subscriptiontracker: 'Nikatru Subscription Tracker' };

const LOOPBACK = /^http:\/\/127\.0\.0\.1:([0-9]{4,5})\/nk-auth-callback$/;

/** Whether `uri` is one of `app`'s own return addresses — the server's rule, restated. */
export function isReturnAddress(app, uri) {
  if (typeof uri !== 'string') return false;
  if (uri === `com.nikatru.${app}://auth-callback?nk_auth=handoff`) return true;
  const m = LOOPBACK.exec(uri);
  if (!m) return false;
  const port = Number(m[1]);
  return port >= 1024 && port <= 65535 && String(port) === m[1];
}

/**
 * THE NAVIGATION, AS ONE PURE FUNCTION. `serverRedirectUri` is the value the
 * platform returned. Returns the URL to navigate to, or null when it is not one
 * of `app`'s own return addresses or there is no code.
 */
export function returnUrl(app, serverRedirectUri, code, state) {
  if (!isReturnAddress(app, serverRedirectUri) || typeof code !== 'string' || code === '') return null;
  const q = new URLSearchParams();
  q.set('nk_code', code);
  if (typeof state === 'string') q.set('state', state);
  return `${serverRedirectUri}${serverRedirectUri.includes('?') ? '&' : '?'}${q.toString()}`;
}

/** What the page says when the mint is refused. */
export function mintFailure(status, body) {
  if (status === 401 && body !== null && typeof body === 'object' && body.error === 'handoff_needs_fresh_signin') {
    return { signInAgain: true, message: 'For your security, sign in again to continue.' };
  }
  return { signInAgain: false, message: 'The app could not be signed in. Close this tab and start again from the app.' };
}

/** The app's request, validated for display. Null when it is unusable. */
export function readRequest(search) {
  const q = new URLSearchParams(search);
  const r = {
    app: q.get('app'),
    redirect_uri: q.get('redirect_uri'),
    code_challenge: q.get('code_challenge'),
    code_challenge_method: q.get('code_challenge_method'),
    state: q.get('state'),
  };
  if (!Object.prototype.hasOwnProperty.call(APPS, r.app)) return null;
  if (!isReturnAddress(r.app, r.redirect_uri)) return null;
  if (!/^[A-Za-z0-9_-]{43}$/.test(r.code_challenge ?? '')) return null;
  if (r.code_challenge_method !== null && r.code_challenge_method !== 'S256') return null;
  if (r.state === null || r.state.length === 0 || r.state.length > 512) return null;
  return r;
}

// ── the page ─────────────────────────────────────────────────────────────────
if (typeof document !== 'undefined') {
  const $ = (id) => document.getElementById(id);
  let session = null; // in memory only
  let request = readRequest(location.search);
  const pageUrl = `${location.origin}${location.pathname}`;

  const show = (id, on) => {
    $(id).hidden = !on;
  };
  const say = (text) => {
    $('status').textContent = text;
  };

  const render = () => {
    show('bad-request', request === null);
    show('connect-flow', request !== null);
    if (request === null) return;
    for (const el of document.querySelectorAll('.app-name')) el.textContent = APPS[request.app];
    show('signin', session === null);
    show('consent', session !== null);
  };

  const onSignedIn = (s) => {
    session = s;
    say('');
    render();
    $('continue').focus();
  };

  $('apple').addEventListener('click', () => {
    void startAppleSignIn(pageUrl, request);
  });

  $('continue').addEventListener('click', async () => {
    if (session === null || request === null) return;
    $('continue').disabled = true;
    say('Signing the app in…');
    let res;
    try {
      res = await fetch(`${PLATFORM}/v1/auth/handoff/${request.app}/code`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          redirect_uri: request.redirect_uri,
          code_challenge: request.code_challenge,
          code_challenge_method: 'S256',
        }),
      });
    } catch {
      res = null;
    }
    let body = null;
    try {
      body = res ? await res.json() : null;
    } catch {
      body = null;
    }
    // The session has done its one job. Drop it whatever happened next.
    session = null;
    const to = res && res.ok && body ? returnUrl(request.app, body.redirect_uri, body.code, request.state) : null;
    if (to === null) {
      $('continue').disabled = false;
      render();
      say(mintFailure(res ? res.status : 0, res && res.ok ? null : body).message);
      return;
    }
    say('Done. You can close this tab and return to the app.');
    location.assign(to);
  });

  $('cancel').addEventListener('click', () => {
    session = null;
    render();
    say('The app was not signed in. You can close this tab.');
  });

  // The return leg of Sign in with Apple: GoTrue appends `?code=` to this page.
  const authCode = new URLSearchParams(location.search).get('code');
  if (authCode !== null && hasPendingAppleSignIn()) {
    history.replaceState(null, '', pageUrl);
    completeAppleSignIn(authCode)
      .then(({ session: s, carry }) => {
        const kept = carry && typeof carry === 'object' ? Object.entries(carry).filter(([, v]) => typeof v === 'string') : [];
        request = kept.length ? readRequest(new URLSearchParams(kept).toString()) : null;
        onSignedIn(s);
      })
      .catch(() => {
        request = null;
        render();
        say('Sign in with Apple did not complete. Close this tab and start again from the app.');
      });
  }
  render();
}
