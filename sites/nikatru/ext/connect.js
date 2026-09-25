// ─────────────────────────────────────────────────────────────────────────────
// /ext/connect — link a Nikatru browser extension to the signed-in account.
//
// ⏱ 2026-09-24 · O-EXTENSION-ACCOUNT-CHECK-UNBUILT (design §3.2). The extension
// opens this page with
//   ?product=fullshot&channel=<chrome-webstore|edge-addons|amo>
//   &redirect_uri=…&code_challenge=<S256>&state=…
// The user signs in, reads what is being connected, and presses Connect. The
// page asks the platform for a 120-second one-time code and hands it back to
// the extension by navigating to the redirect the SERVER returned.
//
// 🔴 NO OPEN REDIRECT. The only URL this page ever navigates to with a code is
// the `redirect_uri` in POST /v1/ext/codes's ANSWER — the channel register's
// value (tooling/channel-register.json `extensionRedirectUri`), never the one in
// this page's query string, which only has to match it for the server to mint
// at all. The navigation is built by one pure function, `returnUrl`, below.
//
// Nothing is auto-submitted: the Connect button is the consent. The Supabase
// session is held in this module's memory only, and dropped the moment the code
// is minted. `state` is passed back untouched.
// ─────────────────────────────────────────────────────────────────────────────
import {
  signInWithPassword,
  startAppleSignIn,
  completeAppleSignIn,
  hasPendingAppleSignIn,
} from '../js/signin.js';

const CODES_URL = 'https://platform.nikatru.com/v1/ext/codes';

const PRODUCTS = { fullshot: 'FullShot' };
const CHANNELS = {
  'chrome-webstore': 'Chrome (Chrome Web Store)',
  'edge-addons': 'Microsoft Edge (Edge Add-ons)',
  amo: 'Firefox (Firefox Add-ons)',
};

/**
 * THE NAVIGATION, AS ONE PURE FUNCTION. `serverRedirectUri` is the value the
 * platform returned — never a value read from this page's URL. Returns the URL
 * to navigate to, or null when the server's value is not an https URL (which
 * the channel register's guard already makes impossible; refusing here too
 * costs nothing).
 */
export function returnUrl(serverRedirectUri, code, state) {
  let u;
  try {
    u = new URL(serverRedirectUri);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || typeof code !== 'string' || code === '') return null;
  u.searchParams.set('code', code);
  if (typeof state === 'string') u.searchParams.set('state', state);
  return u.href;
}

/** The extension's request, validated for display. Null when it is unusable. */
export function readRequest(search) {
  const q = new URLSearchParams(search);
  const r = {
    product: q.get('product'),
    channel: q.get('channel'),
    redirect_uri: q.get('redirect_uri'),
    code_challenge: q.get('code_challenge'),
    state: q.get('state'),
  };
  if (!Object.prototype.hasOwnProperty.call(PRODUCTS, r.product)) return null;
  if (!Object.prototype.hasOwnProperty.call(CHANNELS, r.channel)) return null;
  if (typeof r.redirect_uri !== 'string' || r.redirect_uri === '') return null;
  if (!/^[A-Za-z0-9_-]{43}$/.test(r.code_challenge ?? '')) return null;
  if (r.state !== null && r.state.length > 512) return null;
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
    $('product-name').textContent = PRODUCTS[request.product];
    $('channel-name').textContent = CHANNELS[request.channel];
    show('signin', session === null);
    show('consent', session !== null);
  };

  const onSignedIn = (s) => {
    session = s;
    say('');
    render();
    $('connect').focus();
  };

  $('signin-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    say('Signing in…');
    try {
      onSignedIn(await signInWithPassword($('email').value, $('password').value));
      $('password').value = '';
    } catch (err) {
      say(err.message === 'credentials' ? 'That email and password did not match an account.' : 'Sign-in is unavailable right now. Try again in a moment.');
    }
  });

  $('apple').addEventListener('click', () => {
    void startAppleSignIn(pageUrl, request);
  });

  $('connect').addEventListener('click', async () => {
    if (session === null || request === null) return;
    $('connect').disabled = true;
    say('Connecting…');
    let res;
    try {
      res = await fetch(CODES_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product: request.product,
          channel: request.channel,
          redirect_uri: request.redirect_uri,
          code_challenge: request.code_challenge,
          code_challenge_method: 'S256',
        }),
      });
    } catch {
      res = null;
    }
    const body = res && res.ok ? await res.json() : null;
    // The session has done its one job. Drop it whatever happened next.
    session = null;
    const to = body ? returnUrl(body.redirect_uri, body.code, request.state) : null;
    if (to === null) {
      $('connect').disabled = false;
      render();
      say('This browser could not be connected. Close this tab and start again from the extension.');
      return;
    }
    say('Connected. Returning you to the extension…');
    location.assign(to);
  });

  $('cancel').addEventListener('click', () => {
    session = null;
    render();
    say('Nothing was connected. You can close this tab.');
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
        say('Sign in with Apple did not complete. Close this tab and start again from the extension.');
      });
  }
  render();
}
