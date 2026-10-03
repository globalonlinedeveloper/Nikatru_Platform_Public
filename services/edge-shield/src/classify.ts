// ─────────────────────────────────────────────────────────────────────────────
// WHICH REQUESTS THE SHIELD COUNTS, AND AGAINST WHICH LIMITERS.
//
// LEAD RULING SHIELD-R1, row O-BOXES-UNSHIELDED-FROM-SPIKES. Two hosts reach
// this Worker, each through ONE zone route in ../wrangler.jsonc:
//   · auth-api.nikatru.com/auth/v1/*  — Box C's self-hosted GoTrue
//   · glitchtip.nikatru.com/api/*     — Box B's GlitchTip (crash intake + API)
//
// A class is a set of paths with ONE cost profile on the box behind it, and each
// class has ONE limiter, keyed `global:<class>`, so a distributed spike is shed
// here before it reaches the box. The numbers live in ../wrangler.jsonc beside
// each binding, with the documented default or labelled estimate each one is
// anchored on; `period` below must equal the binding's own, which
// test/wrangler-config.test.ts holds, because it is what Retry-After promises.
//
// 🔴 THREE CREDENTIAL CLASSES, NOT ONE (⏱ 2026-10-01 · SYN-A2 / PB-01, row
// O-ONE-CLIENT-CAN-EXHAUST-THE-CREDENTIAL-CAP). Until then every path below that
// proves, mints or mails a credential shared ONE `auth-credential` bucket, and
// no per-IP limit covered `/auth/v1/token`: junk password posts from one address
// filled it, and every sign-up, OTP, recovery, verify and MFA step in that colo
// was refused here, before GoTrue's own per-IP limiter could tell that client
// apart. Now each kind of credential call has its own bucket —
//   · auth-password       — /token, every grant but refresh_token (and none);
//   · auth-signup-recover — /signup, /otp, /recover, /resend, /verify, /magiclink;
//   · auth-factor         — /factors/<id>/verify|challenge, /reauthenticate —
// so filling one refuses nothing in the other two, and refresh stays its own.
//
// 🔴 NO PER-CLIENT LIMITER, AND NO CLIENT ADDRESS READ AT ALL (LEAD RULING
// SHIELD-R3, 2026-09-26). The posture of ADR no.011 / ADR no.020 is that no
// Worker reads a client-IP header, and tooling/ci/assert-glitchtip-no-ip.mjs
// holds it for this Worker too. The per-IP limit on the CREDENTIAL paths of
// auth-signup-recover and auth-factor is the nikatru.com zone's own rate-limiting
// rule instead, declared as code in tooling/edge-ratelimit-rule.json and applied
// by deploy-workers.yml. /auth/v1/token is NOT in it (lead ruling on PR #1147):
// the Free plan cannot read the query, so it would count the refresh grant, and a
// refresh 429 signs a native user out — behind carrier-grade NAT, many at once.
// ⚠️ THE RESIDUAL: a covered global bucket is still lockable by about cap ÷ the
// per-IP rate — 300/min ÷ 30/min = 10 addresses at the zone rule's limit, per
// colo; test/wrangler-config.test.ts holds both covered caps at or above it.
// auth-password has no per-IP bound at the edge: one client can fill it alone.
//
// ⚠️ NOT EVERY PATH IS COUNTED, AND THE ONES THAT ARE NOT ARE NAMED:
//   · OPTIONS, always — a refused CORS preflight turns the real request into an
//     opaque network error, which a browser client retries instead of backing off;
//   · GET /auth/v1/.well-known/jwks.json — served from the edge cache instead
//     (src/index.ts), so a flood of it never reaches Box C at all;
//   · glitchtip /api/* other than the intake — the GlitchTip web UI and this
//     repo's own CI (release creation, source-map upload, monitor reads) use it
//     with a token, in bursts a crash-intake limit would refuse.
// Everything else under /auth/v1/ falls into `auth-other`, a wide backstop, so
// an unlisted GoTrue path is bounded rather than free.
// ─────────────────────────────────────────────────────────────────────────────
import type { Env, RateLimiterBinding } from './types';

export const AUTH_HOST = 'auth-api.nikatru.com';
export const INTAKE_HOST = 'glitchtip.nikatru.com';
export const JWKS_PATH = '/auth/v1/.well-known/jwks.json';

export type ShieldClass = 'auth-password' | 'auth-signup-recover' | 'auth-factor' | 'auth-refresh' | 'auth-other' | 'intake';

export interface ClassSpec {
  /** Seconds in the binding's window; the refusal's Retry-After. */
  period: 10 | 60;
  /** The status a refused request gets. 429 everywhere except the refresh grant; see below. */
  refusal: 429 | 503;
  global: (env: Env) => RateLimiterBinding | undefined;
}

/**
 * The class table. Each binding is named once, as `env.<NAME>`, so
 * tooling/ci/assert-platform-register.mjs limb 3 finds its reader here.
 *
 * 🔴 THE REFRESH GRANT IS REFUSED 503, NOT 429 — a deliberate departure from
 * SHIELD-R1 §2, whose premise was that the clients back off on a 429. For the
 * refresh grant they do not: gotrue-dart 2.26.0 (the SDK every app ships) treats
 * any 4xx on `grant_type=refresh_token` as final, REMOVES THE SESSION and emits
 * signedOut, and supabase_flutter deletes the stored session
 * (gotrue_client.dart `_doRefresh`, `error is! AuthRetryableFetchException`,
 * read in the pub cache 2026-09-26). A 429 here would sign out every user whose
 * refresh landed in an over-limit minute. A 5xx is the retryable class: the
 * session is kept, the access token (valid for its hour) keeps working against
 * the Workers, and the SDK asks again on its next tick. Every other class is
 * refused 429 as ruled — a password sign-in's 429 reaches the form as "Too many
 * attempts", and the crash SDKs stop sending for Retry-After.
 */
export const CLASSES: Record<ShieldClass, ClassSpec> = {
  'auth-password': {
    period: 60,
    refusal: 429,
    global: (env) => env.AUTH_PASSWORD_GLOBAL_LIMITER,
  },
  'auth-signup-recover': {
    period: 60,
    refusal: 429,
    global: (env) => env.AUTH_SIGNUP_RECOVER_GLOBAL_LIMITER,
  },
  'auth-factor': {
    period: 60,
    refusal: 429,
    global: (env) => env.AUTH_FACTOR_GLOBAL_LIMITER,
  },
  'auth-refresh': {
    period: 60,
    refusal: 503,
    global: (env) => env.AUTH_REFRESH_GLOBAL_LIMITER,
  },
  'auth-other': {
    period: 60,
    refusal: 429,
    global: (env) => env.AUTH_OTHER_GLOBAL_LIMITER,
  },
  intake: {
    period: 60,
    refusal: 429,
    global: (env) => env.INTAKE_GLOBAL_LIMITER,
  },
};

/**
 * auth-signup-recover: GoTrue paths (below /auth/v1) that MINT an account or
 * send mail, or redeem what was mailed — a sign-up, a send or a link per request.
 * `/token`'s grants are auth-password (see classify()).
 */
const SIGNUP_RECOVER_PATHS = new Set(['/signup', '/otp', '/recover', '/resend', '/verify', '/magiclink']);
/** auth-factor: `/reauthenticate` sends a nonce to a signed-in user. */
const REAUTHENTICATE_PATH = '/reauthenticate';
/** auth-factor: MFA — `/factors/<id>/verify` guesses a code, `/factors/<id>/challenge` sends one. */
const FACTOR_PATH = /^\/factors\/[^/]+\/(?:verify|challenge)$/;
/** GlitchTip's Sentry-protocol intake: `/api/<project id>/envelope/` and `/store/`. */
const INTAKE_PATH = /^\/api\/[^/]+\/(?:envelope|store)$/;

/**
 * The path as the classifier reads it: repeated slashes collapsed, a trailing
 * slash dropped, lower-cased. Only the CLASSIFIER sees this — the request goes
 * to the origin byte for byte. Normalising can only move a variant INTO a
 * counted class (`//TOKEN/` is counted as `/token`), never out of one.
 */
export function normalisePath(pathname: string): string {
  let p = pathname.replace(/\/{2,}/g, '/').toLowerCase();
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  return p;
}

export type Route = { kind: 'jwks' } | { kind: 'limit'; cls: ShieldClass } | { kind: 'pass' };

/**
 * ⏱ 2026-10-02 — the GoTrue POSTs that are SAFE TO SEND TWICE, so an origin fault
 * on one is retried (src/index.ts). Measured: a request lost between Cloudflare
 * and the tunnel comes back as a 520 after ~13-15 s, with no line in Box C's
 * GoTrue or envoy log (2026-09-30 15:30:59Z `POST /logout`, 2026-10-01 15:00:51Z
 * `POST /admin/generate_link`, which reddened main's E2E). A 520 cannot say
 * whether the origin acted, so only a request whose repeat changes nothing the
 * caller relies on is resent:
 *   · `/logout` — ending a session twice ends it once;
 *   · `/admin/generate_link` — service-role only; a second call mints a link
 *     that replaces the first, and the caller receives the second.
 * NEVER the refresh grant (a replayed refresh token can trip reuse detection
 * and end the session), `/verify` (single use), or anything that sends mail or
 * creates an account (`/otp`, `/signup`, `/recover`, `/resend`, `/magiclink`).
 */
const RETRY_SAFE_AUTH_POSTS = new Set(['/logout', '/admin/generate_link']);

/**
 * ⏱ 2026-10-02 · review 1 of #1140, finding 5 — the GETs that CONSUME a
 * one-time code, so they are never retried either: `/verify` is the link in an
 * auth e-mail (`?token=…`, used once), `/callback` is the OAuth provider's
 * return (`?code=…`, used once). A fault that came back after GoTrue spent the
 * code would turn into an "expired link" on the retry, hiding the fault.
 */
const ONE_TIME_AUTH_GETS = new Set(['/verify', '/callback']);

/** Whether an origin fault (520/522) on this request may be retried once: any
 *  GET or HEAD the shield handles except the one-time-code GETs above, and the
 *  GoTrue POSTs above. Pure. */
export function retryableOnOriginFault(url: URL, method: string): boolean {
  const m = method.toUpperCase();
  const path = normalisePath(url.pathname);
  const auth = url.hostname.toLowerCase() === AUTH_HOST && path.startsWith('/auth/v1/');
  const rest = auth ? path.slice('/auth/v1'.length) : null;
  if (m === 'GET' || m === 'HEAD') return rest === null || !ONE_TIME_AUTH_GETS.has(rest);
  return m === 'POST' && rest !== null && RETRY_SAFE_AUTH_POSTS.has(rest);
}

/** What the shield does with a request. Pure: host, path, query and method only. */
export function classify(url: URL, method: string): Route {
  const m = method.toUpperCase();
  if (m === 'OPTIONS') return { kind: 'pass' };
  const host = url.hostname.toLowerCase();
  const path = normalisePath(url.pathname);

  if (host === AUTH_HOST && (path === '/auth/v1' || path.startsWith('/auth/v1/'))) {
    if (m === 'GET' && path === JWKS_PATH) return { kind: 'jwks' };
    const rest = path.slice('/auth/v1'.length);
    if (rest === '/token') {
      // Any grant but a refresh is a credential proof (password, pkce, id_token,
      // an unknown one); a missing or repeated grant_type counts as one too.
      const grants = url.searchParams.getAll('grant_type');
      const refresh = grants.length === 1 && grants[0] === 'refresh_token';
      return { kind: 'limit', cls: refresh ? 'auth-refresh' : 'auth-password' };
    }
    if (SIGNUP_RECOVER_PATHS.has(rest)) return { kind: 'limit', cls: 'auth-signup-recover' };
    if (rest === REAUTHENTICATE_PATH || FACTOR_PATH.test(rest)) return { kind: 'limit', cls: 'auth-factor' };
    return { kind: 'limit', cls: 'auth-other' };
  }

  if (host === INTAKE_HOST && INTAKE_PATH.test(path)) return { kind: 'limit', cls: 'intake' };
  return { kind: 'pass' };
}

