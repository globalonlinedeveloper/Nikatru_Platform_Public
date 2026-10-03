// ─────────────────────────────────────────────────────────────────────────────
// native-auth.ts — a native app signs in, signs up, recovers and re-sends
// WITHOUT a captcha, and a browser cannot use the same door.
//
// ⏱ 2026-09-28 · ST-N1 (rows O-BOXA-CAPTCHA-REFUSES-NATIVE-SIGN-IN,
// O-NATIVE-AUTH-CALLBACK-UNBUILT). Box C's GoTrue enforces Turnstile on the
// password grant, /signup, /recover and /resend, and ADR 084 keeps the site key
// out of every store build — so every native sign-in was refused
// `captcha_failed`. GoTrue's captcha is on or off for the whole server (no env
// var exempts one client), and its verifyCaptcha returns early when the bearer
// carries an admin role (supabase/auth v2.189.0 internal/api/middleware.go:219).
// So this Worker, which already holds the service-role key, forwards FOUR
// allow-listed calls with that bearer; web keeps Turnstile at GoTrue, unchanged.
//
//   POST /v1/auth/native/:app/token?grant_type=password
//   POST /v1/auth/native/:app/signup
//   POST /v1/auth/native/:app/recover
//   POST /v1/auth/native/:app/resend
//   POST /v1/auth/native/:app/attest/challenge   (⏱ 2026-09-29, ADR no.NNN)
//   POST /v1/auth/native/:app/attest/install     (⏱ 2026-09-29, ADR no.NNN)
//   POST /v1/auth/native/:app/handoff/token      (⏱ 2026-10-01, the desktop
//        system-browser hand-off: a code the web page minted, PKCE-bound, in
//        exchange for a NEW session — lib/native-attest/handoff.ts)
//
// The first four are exactly the paths gotrue-dart builds from a base URL, so the client
// half (ST-T7b) points a second GoTrueClient at `/v1/auth/native/<app>`. Refresh,
// PKCE and id_token grants never come here: GoTrue does not captcha them, and
// the client sends them straight to GoTrue.
//
// ── WHAT STANDS WHERE THE CAPTCHA STOOD ─────────────────────────────────────
//   · 🔴 ⏱ 2026-09-29 (ADR no.NNN) AN ATTESTATION, on every op. Until then the
//     list below was the whole defence, and a missing `Origin` is something any
//     script can send: captcha-free password sign-in and sign-up for anybody.
//     Now each op carries a proof bound to a single-use challenge from
//     `POST …/attest/challenge`, to the path and query, and to the exact body —
//     Play Integrity (android) or App Attest (ios, macos App Store), the only
//     kinds any deploy lists. ⏱ 2026-09-30 (review of #1070): the per-install
//     Ed25519 kind proves nothing a script cannot do, so no deploy lists it, and
//     KIND_OPS confines it to the password grant even where one would; desktop
//     sign-up and reset go through the web Turnstile flow. lib/native-attest/
//     index.ts says what each proves; no proof is a 401 and GoTrue never hears it;
//   · a request carrying `Origin` is refused 403 — a web page cannot use this
//     route. The refusal is the shared CORS middleware's (services/_shared/src/
//     cors.ts), bound in middleware/cors.ts with `refuseBrowsersOn` — the one
//     module allowed to read `Origin` (tooling/ci/assert-no-origin-authz.mjs) —
//     and it runs on every request before this router; it grants no CORS here;
//   · `:app` must be a NATIVE_AUTH_APPS id (generated/app-targets.ts) with a
//     scheme-safe id, and a redirect is kept only when it is that app's own
//     `com.nikatru.<app>://auth-callback`, with or without `?nk_auth=<marker>`;
//   · only the allow-listed body fields go on; `gotrue_meta_security` (the
//     captcha token) and everything else is dropped;
//   · NATIVE_AUTH_EDGE_LIMITER (per network) and NATIVE_AUTH_ACCOUNT_LIMITER
//     (per account) — both FAIL CLOSED: a missing binding or a limiter fault is
//     a 503, never an admit (`strictRateLimit`, lib/edge-ceiling.ts);
//   · GoTrue's own per-IP limiter, once Box C keys it on the address Cloudflare
//     stamps (ADR 059 R4-08). This Worker never reads a client address (ADR 011
//     / ADR 020, SHIELD-R3): only GOTRUE_BOUND_HEADERS and Cloudflare's own
//     `cf-` stamps go on, each as it arrived (⏱ 2026-09-30, review of #1070), and
//     the same-zone subrequest carries the client's address to GoTrue without
//     this file naming it.
//
// Credentials pass THROUGH: nothing here stores an email, a password or a token,
// and the one log line per call carries the route, the app, the status and the
// edge-shield marker — never the body.
// ─────────────────────────────────────────────────────────────────────────────
import { Hono, type Context, type MiddlewareHandler } from 'hono';
import type { AppEnv } from '../types';
import { NATIVE_AUTH_APPS } from '../generated/app-targets';
import { edgeCeilingKey, strictEdgeCeiling, strictRateLimit, type StrictVerdict } from '../lib/edge-ceiling';
import { readBoundedBody } from '../lib/body';
import {
  challengeIsOurs,
  challengesConfigured,
  clientDataFor,
  configured,
  enabledKinds,
  isKind,
  issueChallenge,
  KIND_OPS,
  NATIVE_ATTEST_CHALLENGE_TTL_SECONDS,
  playProofPlausible,
  readHeaders,
  redeemChallenge,
  registerKey,
  requestTarget,
  verifyOp,
  type AttestKind,
  type AttestOp,
} from '../lib/native-attest';
import { redeemHandoffCode } from '../lib/native-attest/handoff';
import { identityFor } from '../ports';
import type { IdentityAnswer } from '../../../_shared/src/ports/identity';

/**
 * How long one GoTrue call may take before the route gives up on it.
 *
 * @ceiling none — a CLIENT-SIDE PATIENCE BUDGET on an outbound call, not a
 * platform resource, the same kind as sessions.ts `SESSIONS_RPC_TIMEOUT_MS`.
 * A sign-up sends mail before it answers, so this is longer than an RPC's.
 */
export const NATIVE_AUTH_UPSTREAM_TIMEOUT_MS = 10_000;

/**
 * The largest request body accepted, in bytes.
 *
 * @ceiling none — an INPUT SHAPE bound, not a platform resource: an email, a
 * password, a PKCE challenge and a small metadata object fit in a fraction of it.
 */
export const NATIVE_AUTH_MAX_BODY_BYTES = 8_192;

/**
 * Seconds a caller over a cap is told to wait: the limiters' `period`.
 *
 * @ceiling none — it restates the 60 s `simple.period` of the two limiters in
 * wrangler.jsonc (tooling/ceilings.json ratelimit.allowedPeriods), not a cap.
 */
export const NATIVE_AUTH_RETRY_AFTER_SECONDS = 60;

/** The four calls this route forwards — the paths gotrue-dart builds from its base. */
export type NativeAuthOp = 'token' | 'signup' | 'recover' | 'resend';

/** The body fields each call may carry; everything else is dropped. Measured
 *  against the pinned gotrue-dart 2.26.0 (pubspec.lock): its email resend sends
 *  the PKCE pair too, so a PKCE resend stays PKCE. */
const BODY_FIELDS: Record<NativeAuthOp, readonly string[]> = {
  token: ['email', 'password'],
  signup: ['email', 'password', 'data', 'code_challenge', 'code_challenge_method'],
  recover: ['email', 'code_challenge', 'code_challenge_method'],
  resend: ['email', 'type', 'code_challenge', 'code_challenge_method'],
};

/** The resend types that send an email; the phone types are not served here. */
const RESEND_TYPES = new Set(['signup', 'email_change']);

/** The app id rule authCallbackScheme() applies (packages/auth_supabase auth_redirect.dart). */
const SCHEME_SAFE_APP_ID = /^[a-z][a-z0-9]*$/;
/** An `nk_auth` marker: lower-case letters and `-` (auth_redirect.dart `AuthFlow`). */
const MARKER = /^[a-z][a-z-]*$/;

/**
 * ⏱ 2026-09-30 (review of #1070): the request headers FORWARDED to GoTrue — an
 * ALLOWLIST, where there used to be a list of the ones dropped. What gotrue-dart
 * sends that GoTrue reads, and nothing else; plus the `cf-` family as it
 * arrived and never read here — Cloudflare's own stamps (the connecting address
 * among them) AND any caller-sent `cf-*` header Cloudflare does not strip (e.g.
 * `cf-access-client-id`), none of which GoTrue reads. So the caller-writable address claims,
 * the caller's cookie and GoTrue credentials, `referer` (GoTrue's fallback
 * redirect source), `origin` and the four attestation headers are all dropped
 * without this file naming any of them — tooling/ci/assert-glitchtip-no-ip.mjs
 * refuses a Worker that names a client-address header at all, even to delete it.
 */
const GOTRUE_BOUND_HEADERS = new Set(['accept', 'accept-language', 'user-agent', 'x-client-info', 'x-request-id', 'x-supabase-api-version']);
const sentOn = (name: string) => GOTRUE_BOUND_HEADERS.has(name) || name.startsWith('cf-');

/** Attestation kinds already reported unconfigured in this isolate: one line each, not one per request. */
const reportedUnconfigured = new Set<string>();

/** Seconds until the next 00:00 UTC — when every daily attestation budget resets. */
const secondsToUtcMidnight = (now: number) => Math.max(1, Math.ceil((86_400_000 - (now % 86_400_000)) / 1000));

/** A refusal in GoTrue's own (pre-2024-01-01) error shape, which gotrue-dart maps by `error_code`. */
function gotrueError(status: number, errorCode: string, msg: string, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ code: status, error_code: errorCode, msg }), {
    status,
    headers: { 'Content-Type': 'application/json', ...extra },
  });
}

/** One log line per call. Never the email, the password, the body or a token. */
function logged(c: Context<AppEnv>, op: NativeAuthOp | 'challenge' | 'install' | 'handoff' | '-', res: Response, shield = '-'): Response {
  console.log(
    `[native-auth] rid=${c.get('requestId') ?? '-'} route=${op} app=${c.get('appId') ?? '-'} status=${res.status} shield=${shield}`,
  );
  return res;
}

/** `com.nikatru.<app>://auth-callback`, optionally `?nk_auth=<marker>` and nothing else. */
export function isOwnCallback(app: string, value: string): boolean {
  const base = `com.nikatru.${app}://auth-callback`;
  if (value === base) return true;
  if (!value.startsWith(`${base}?nk_auth=`)) return false;
  return MARKER.test(value.slice(base.length + '?nk_auth='.length));
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** 429 in GoTrue's shape, or 503 when the limiter could not answer. Null means admitted. */
function refusedBy(verdict: StrictVerdict): Response | null {
  if (verdict === 'within') return null;
  if (verdict === 'over') {
    return gotrueError(429, 'over_request_rate_limit', 'Request rate limit reached', {
      'Retry-After': String(NATIVE_AUTH_RETRY_AFTER_SECONDS),
    });
  }
  return gotrueError(503, 'native_auth_unavailable', 'Sign-in is unavailable. Try again shortly.');
}

/**
 * THE ATTESTATION GATE (⏱ 2026-09-29, ADR no.NNN), for an op or a key
 * registration, IN THIS ORDER — the order is the security property:
 *   1. the headers;
 *   2. the op table (KIND_OPS — structural, before any config is read);
 *   3. the kind this deploy accepts, then the kind's own config;
 *   4. PURE checks, no limiter and no D1: a Play proof's shape (malformed = 400),
 *      then the challenge's MAC, app and expiry (challengeIsOurs);
 *   5. the kind's per-network ceiling;
 *   6. the body, then the D1 redemption (single use — burned pass or fail);
 *   7. the proof (verifyOp: shape, per-network daily share, global ceiling,
 *      and only then Google; or the key's signature, then its daily budget).
 * So a malformed proof or a forged challenge costs no limiter, no D1 and no
 * crypto beyond one HMAC.
 *
 * Answers the kind, the exact body and the clientData, or the refusal.
 */
async function admit(
  c: Context<AppEnv>,
  op: AttestOp,
): Promise<{ kind: AttestKind; text: string; bytes: Uint8Array; clientData: string; headers: NonNullable<ReturnType<typeof readHeaders>> } | Response> {
  const app = c.get('appId') as string;
  const h = readHeaders(c.req.raw.headers);
  if (!h) return gotrueError(401, 'attestation_required', 'This request carries no app attestation');
  if (isKind(h.kind) && !KIND_OPS[h.kind].has(op)) {
    return gotrueError(403, 'attestation_kind_refused', 'That attestation cannot authorise this call');
  }
  if (!isKind(h.kind) || !enabledKinds(c.env).has(h.kind)) {
    return gotrueError(403, 'attestation_kind_refused', 'This server does not accept that attestation');
  }
  const kind = h.kind;
  if (!configured(c.env, kind, app)) {
    // A PERMANENT misconfiguration until an owner step is done: reported once per
    // isolate, as lib/edge-ceiling.ts reports an absent binding (review nit 11).
    if (!reportedUnconfigured.has(kind)) {
      reportedUnconfigured.add(kind);
      console.error(`[native-auth] attestation kind ${kind} is enabled but not configured — every such call answers 503`);
    }
    return gotrueError(503, 'native_auth_unavailable', 'Sign-in is unavailable. Try again shortly.');
  }
  // Pure checks BEFORE any limiter is spent (second review of #1070): a Play
  // proof not even shaped like an integrity token is 400 and costs nothing; a
  // challenge this server did not mint, or that has expired, costs the network
  // none of its budgets. The D1 redemption (single use) stays below.
  if (kind === 'play-integrity' && op !== 'install' && !playProofPlausible(h)) {
    return gotrueError(400, 'attestation_invalid', 'The app attestation is malformed');
  }
  if (!(await challengeIsOurs(c.env, app, h.challenge, Date.now()))) {
    return gotrueError(401, 'attestation_challenge_invalid', 'The attestation challenge is unknown, expired or already used');
  }
  // Each kind's own per-network ceiling, all FAIL CLOSED like the two above:
  // key registration's for every kind; the unattested kind's, far tighter; and
  // Play Integrity's, spent BEFORE a decode is asked of Google (review of #1070).
  if (op === 'install') {
    const r = refusedBy(await strictEdgeCeiling(c.env.NATIVE_AUTH_INSTALL_LIMITER, c, 'NATIVE_AUTH_INSTALL_LIMITER'));
    if (r) return r;
  } else if (kind === 'install-key') {
    const r = refusedBy(await strictEdgeCeiling(c.env.NATIVE_AUTH_UNATTESTED_LIMITER, c, 'NATIVE_AUTH_UNATTESTED_LIMITER'));
    if (r) return r;
  } else if (kind === 'play-integrity') {
    const r = refusedBy(await strictEdgeCeiling(c.env.NATIVE_AUTH_PLAY_VERIFY_LIMITER, c, 'NATIVE_AUTH_PLAY_VERIFY_LIMITER'));
    if (r) return r;
  }

  const bounded = await readBoundedBody(c.req.raw, NATIVE_AUTH_MAX_BODY_BYTES);
  if (!bounded.ok) return gotrueError(bounded.status, bounded.status === 413 ? 'request_too_large' : 'bad_json', bounded.error);

  const now = Date.now();
  if (!(await redeemChallenge(c.env, app, h.challenge, now))) {
    return gotrueError(401, 'attestation_challenge_invalid', 'The attestation challenge is unknown, expired or already used');
  }
  const clientData = await clientDataFor(app, op, h.challenge, requestTarget(new URL(c.req.url)), bounded.bytes);
  if (op !== 'install') {
    const v = await verifyOp(c.env, app, kind, h, clientData, edgeCeilingKey(c), now);
    if (!v.ok) {
      console.warn(`[native-auth] rid=${c.get('requestId') ?? '-'} attestation refused kind=${kind} (${v.why})`);
      if (v.status === 429) {
        return gotrueError(429, v.code, 'Request rate limit reached', { 'Retry-After': String(secondsToUtcMidnight(now)) });
      }
      const msg =
        v.status === 503 ? 'Sign-in is unavailable. Try again shortly.' : v.status === 400 ? 'The app attestation is malformed' : 'The app attestation did not verify';
      return gotrueError(v.status, v.code, msg);
    }
  }
  return { kind, text: bounded.text, bytes: bounded.bytes, clientData, headers: h };
}

/**
 * ⏱ 2026-09-29 (ADR no.NNN) — NO SESSION BEFORE EMAIL VERIFICATION on the
 * unattested channel. KIND_OPS already keeps `install-key` off signup, recover
 * and resend; for the one op it may reach, the password grant, GoTrue refuses
 * an unconfirmed address (`mailer_autoconfirm` false, which
 * tooling/ops/auth-cutover-preflight.mjs grades), and this holds the property
 * even if that setting drifts: a grant whose user has no `email_confirmed_at`
 * is refused and its session withheld.
 */
async function unattestedSessionRule(op: NativeAuthOp, upstream: Response): Promise<Response | null> {
  if (!upstream.ok || op !== 'token') return null;
  let body: Record<string, unknown>;
  try {
    body = (await upstream.clone().json()) as Record<string, unknown>;
  } catch {
    return gotrueError(502, 'native_auth_unavailable', 'Sign-in is unavailable. Try again shortly.');
  }
  const user = isPlainObject(body.user) ? body.user : null;
  if (user && typeof user.email_confirmed_at === 'string' && user.email_confirmed_at !== '') return null;
  return gotrueError(403, 'email_not_confirmed', 'Email not confirmed');
}

/**
 * Everything after the per-network ceiling: the attestation, the redirect, the
 * body, the per-account bucket, and the forward itself.
 */
async function relay(c: Context<AppEnv>, op: NativeAuthOp, edge: StrictVerdict): Promise<Response> {
  const app = c.get('appId') as string;
  const edgeRefusal = refusedBy(edge);
  if (edgeRefusal) return logged(c, op, edgeRefusal);

  const admitted = await admit(c, op);
  if (admitted instanceof Response) return logged(c, op, admitted);

  // The redirect: kept only when it is this app's own callback. `email_redirect_to`
  // is accepted as a spelling of the same thing and forwarded as `redirect_to`,
  // the name GoTrue reads.
  const redirects = [c.req.query('redirect_to'), c.req.query('email_redirect_to')].filter(
    (v): v is string => v !== undefined,
  );
  for (const r of redirects) {
    if (!isOwnCallback(app, r)) {
      return logged(c, op, gotrueError(400, 'validation_failed', "redirect_to is not this app's own callback"));
    }
  }
  if (redirects.length === 2 && redirects[0] !== redirects[1]) {
    return logged(c, op, gotrueError(400, 'validation_failed', 'redirect_to and email_redirect_to disagree'));
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(admitted.text);
  } catch {
    return logged(c, op, gotrueError(400, 'bad_json', 'The request body is not JSON'));
  }
  if (!isPlainObject(parsed)) return logged(c, op, gotrueError(400, 'bad_json', 'The request body is not a JSON object'));

  // The allow-list. A JSON null is the SDK's way of saying "not set" (gotrue-dart
  // sends `code_challenge: null` outside PKCE), so it is dropped like an absent field.
  const body: Record<string, unknown> = {};
  for (const field of BODY_FIELDS[op]) {
    const v = parsed[field];
    if (v === undefined || v === null) continue;
    if (field === 'data' ? !isPlainObject(v) : typeof v !== 'string') {
      return logged(c, op, gotrueError(400, 'validation_failed', `${field} has the wrong type`));
    }
    body[field] = v;
  }
  if (typeof body.email !== 'string' || body.email.trim() === '') {
    return logged(c, op, gotrueError(400, 'validation_failed', 'An email address is required'));
  }
  if (op === 'resend' && !RESEND_TYPES.has(String(body.type))) {
    return logged(c, op, gotrueError(400, 'validation_failed', 'type must be signup or email_change'));
  }

  const account = `acct:${app}:${await sha256Hex(body.email.trim().toLowerCase())}`;
  const accountRefusal = refusedBy(
    await strictRateLimit(c.env.NATIVE_AUTH_ACCOUNT_LIMITER, account, 'NATIVE_AUTH_ACCOUNT_LIMITER'),
  );
  if (accountRefusal) return logged(c, op, accountRefusal);

  const serviceRoleKey = c.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    console.error(`[native-auth] rid=${c.get('requestId') ?? '-'} SUPABASE_SERVICE_ROLE_KEY is not set`);
    return logged(c, op, gotrueError(503, 'native_auth_unavailable', 'Sign-in is unavailable. Try again shortly.'));
  }

  const query: Record<string, string> = {};
  if (op === 'token') query.grant_type = 'password';
  else if (redirects[0] !== undefined) query.redirect_to = redirects[0];

  // Only the allowlisted headers go on (GOTRUE_BOUND_HEADERS), each as it
  // arrived, so the user agent and Cloudflare's own stamps reach GoTrue without
  // this Worker reading any of them; the port adds our credentials, exactly as
  // the session calls get them. ⏱ 2026-10-03 · port-auth: the request is built
  // by the identity port's adapter (identityFor, src/ports.ts), not here.
  const headers = new Headers();
  for (const [name, value] of c.req.raw.headers) if (sentOn(name)) headers.set(name, value);

  const answer = await identityFor(c.env).credential(op, body, {
    headers,
    query,
    signal: AbortSignal.timeout(NATIVE_AUTH_UPSTREAM_TIMEOUT_MS),
  });
  if (!answer.ok) {
    const err = answer.cause;
    console.error(
      `[native-auth] rid=${c.get('requestId') ?? '-'} GoTrue unreachable (${err instanceof Error ? err.name : answer.detail})`,
    );
    return logged(c, op, gotrueError(503, 'native_auth_unavailable', 'Sign-in is unavailable. Try again shortly.'));
  }
  const upstream = answer.res;

  if (admitted.kind === 'install-key') {
    const withheld = await unattestedSessionRule(op, upstream);
    if (withheld) return logged(c, op, withheld, upstream.headers.get('x-nikatru-shield') ?? '-');
  }

  // The status and the JSON go back verbatim — gotrue-dart maps `error_code`, and
  // reads `x-supabase-api-version` to know which error shape it holds — with no
  // cookie of GoTrue's set on the app.
  const res = new Response(upstream.body, upstream);
  res.headers.delete('Set-Cookie');
  return logged(c, op, res, upstream.headers.get('x-nikatru-shield') ?? '-');
}

/** The one answer every failed hand-off exchange gets — no oracle (expired, reused, mismatched, forged). */
const handoffInvalid = () => gotrueError(400, 'invalid_grant', 'The sign-in code is invalid, expired or already used');

/** lowercase hex digest, as GoTrue issues a `hashed_token` (tooling/e2e/magic_link.mjs TOKEN_HASH_SHAPE). */
const TOKEN_HASH = /^[0-9a-f]{40,128}$/;

/**
 * ⏱ 2026-10-01 — A NEW SESSION FOR `user`, minted with no password and no
 * captcha: the caller has already redeemed a hand-off code that only a FRESH web
 * sign-in on nikatru.com could mint (routes/native-handoff.ts holds it to
 * RECENT_AUTH_SECONDS), with this app's PKCE verifier. GoTrue has no "create session" admin
 * call, so it is the documented server-side pair: `admin/generate_link`
 * (type magiclink — it SENDS NO MAIL) for the account's current address, then
 * `/verify` with that token hash, which answers a session. The user is read by
 * id first, so a changed address follows the account, a deleted or banned one
 * is refused, and the session must name the same id or it is withheld.
 * ⚠️ The magic-link token is one per user: an unused one emailed earlier is
 * replaced (tooling/e2e/magic_link.mjs says the same).
 */
async function handoffSession(c: Context<AppEnv>, user: string): Promise<Response> {
  const key = c.env.SUPABASE_SERVICE_ROLE_KEY;
  const down = () => gotrueError(503, 'native_auth_unavailable', 'Sign-in is unavailable. Try again shortly.');
  if (!key) {
    console.error(`[native-auth] rid=${c.get('requestId') ?? '-'} SUPABASE_SERVICE_ROLE_KEY is not set`);
    return down();
  }
  // ⏱ 2026-10-03 · port-auth: the three calls are the identity port's verbs
  // (identityFor, src/ports.ts); a transport failure is thrown into the catch
  // below, which answered it before the port existed.
  const identity = identityFor(c.env);
  const call = async (a: Promise<IdentityAnswer>): Promise<Response> => {
    const r = await a;
    if (!r.ok) throw r.cause ?? new Error(r.detail);
    return r.res;
  };
  const bounded = () => ({ signal: AbortSignal.timeout(NATIVE_AUTH_UPSTREAM_TIMEOUT_MS) });
  try {
    const u = await call(identity.readUser(user, bounded()));
    if (u.status === 404) return handoffInvalid();
    if (!u.ok) return down();
    const account = (await u.json()) as Record<string, unknown>;
    const banned = typeof account.banned_until === 'string' && Date.parse(account.banned_until) > Date.now();
    if (account.id !== user || banned || typeof account.email !== 'string' || account.email === '') return handoffInvalid();

    const link = await call(identity.mintSignInLink(account.email, bounded()));
    if (!link.ok) return down();
    const hashed = ((await link.json()) as Record<string, unknown>).hashed_token;
    if (typeof hashed !== 'string' || !TOKEN_HASH.test(hashed)) return down();

    const verified = await call(identity.redeemSignInLink(hashed, bounded()));
    if (!verified.ok) return down();
    const session = (await verified.json()) as Record<string, unknown>;
    const who = isPlainObject(session.user) ? session.user.id : undefined;
    if (who !== user || typeof session.access_token !== 'string' || typeof session.refresh_token !== 'string') return down();
    return new Response(JSON.stringify(session), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  } catch (err) {
    console.error(`[native-auth] rid=${c.get('requestId') ?? '-'} hand-off session failed (${err instanceof Error ? err.name : typeof err})`);
    return down();
  }
}

/**
 * The app, before anything else: it costs no limiter call and answers before any
 * body is read. (A browser never gets this far: middleware/cors.ts has already
 * answered 403.)
 */
function gate(apps: readonly string[]): MiddlewareHandler<AppEnv> {
  const served = new Set(apps);
  return async (c, next) => {
    const app = c.req.param('app') ?? '';
    if (!SCHEME_SAFE_APP_ID.test(app) || !served.has(app)) {
      return logged(c, '-', gotrueError(404, 'unknown_app', 'No native app by that id'));
    }
    c.set('appId', app);
    await next();
  };
}

/**
 * The router for a given app set. The default export serves NATIVE_AUTH_APPS;
 * a test passes a second fixture id to prove a newly stamped app is served with
 * no change to this file.
 */
export function createNativeAuth(apps: readonly string[]): Hono<AppEnv> {
  const nativeAuth = new Hono<AppEnv>();
  nativeAuth.use('/auth/native/:app/*', gate(apps));

  nativeAuth.post('/auth/native/:app/token', async (c) => {
    // Only the password grant is captcha-gated at GoTrue, so only it comes here.
    if (c.req.query('grant_type') !== 'password') {
      return logged(c, 'token', gotrueError(400, 'unsupported_grant_type', 'Only grant_type=password is served here'));
    }
    return relay(c, 'token', await strictEdgeCeiling(c.env.NATIVE_AUTH_EDGE_LIMITER, c, 'NATIVE_AUTH_EDGE_LIMITER'));
  });

  nativeAuth.post('/auth/native/:app/signup', async (c) =>
    relay(c, 'signup', await strictEdgeCeiling(c.env.NATIVE_AUTH_EDGE_LIMITER, c, 'NATIVE_AUTH_EDGE_LIMITER')),
  );

  nativeAuth.post('/auth/native/:app/recover', async (c) =>
    relay(c, 'recover', await strictEdgeCeiling(c.env.NATIVE_AUTH_EDGE_LIMITER, c, 'NATIVE_AUTH_EDGE_LIMITER')),
  );

  nativeAuth.post('/auth/native/:app/resend', async (c) =>
    relay(c, 'resend', await strictEdgeCeiling(c.env.NATIVE_AUTH_EDGE_LIMITER, c, 'NATIVE_AUTH_EDGE_LIMITER')),
  );

  // ⏱ 2026-09-29 (ADR no.NNN) — a single-use challenge every proof binds to.
  // Under the per-network ceiling; refused outright when this deploy accepts no
  // kind at all, so a closed route mints nothing.
  nativeAuth.post('/auth/native/:app/attest/challenge', async (c) => {
    const edgeRefusal = refusedBy(await strictEdgeCeiling(c.env.NATIVE_AUTH_EDGE_LIMITER, c, 'NATIVE_AUTH_EDGE_LIMITER'));
    if (edgeRefusal) return logged(c, 'challenge', edgeRefusal);
    if (enabledKinds(c.env).size === 0) {
      return logged(c, 'challenge', gotrueError(403, 'attestation_kind_refused', 'This server does not accept native sign-in'));
    }
    if (!challengesConfigured(c.env)) {
      console.error(`[native-auth] rid=${c.get('requestId') ?? '-'} NATIVE_ATTEST_CHALLENGE_KEY or PLATFORM_DB is not set`);
      return logged(c, 'challenge', gotrueError(503, 'native_auth_unavailable', 'Sign-in is unavailable. Try again shortly.'));
    }
    // STATELESS (review of #1070): a signed token, and no row written.
    const challenge = await issueChallenge(c.env, c.get('appId') as string, Date.now());
    return logged(c, 'challenge', c.json({ challenge, expires_in: NATIVE_ATTEST_CHALLENGE_TTL_SECONDS }));
  });

  // ⏱ 2026-09-29 (ADR no.NNN) — an install registers its key once: an App
  // Attest attestation, or a desktop Ed25519 key signing its own registration.
  nativeAuth.post('/auth/native/:app/attest/install', async (c) => {
    const edgeRefusal = refusedBy(await strictEdgeCeiling(c.env.NATIVE_AUTH_EDGE_LIMITER, c, 'NATIVE_AUTH_EDGE_LIMITER'));
    if (edgeRefusal) return logged(c, 'install', edgeRefusal);
    const admitted = await admit(c, 'install');
    if (admitted instanceof Response) return logged(c, 'install', admitted);
    // KIND_OPS gives play-integrity no `install`, so admit() has already
    // refused it (403); this narrows the type and would shout if that changed.
    if (admitted.kind === 'play-integrity') throw new Error('unreachable: KIND_OPS gives play-integrity no install');
    let body: unknown;
    try {
      body = JSON.parse(admitted.text);
    } catch {
      return logged(c, 'install', gotrueError(400, 'bad_json', 'The request body is not JSON'));
    }
    if (!isPlainObject(body) || body.kind !== admitted.kind) {
      return logged(c, 'install', gotrueError(400, 'validation_failed', 'kind must match X-NK-Attest-Kind'));
    }
    const r = await registerKey(c.env, c.get('appId') as string, admitted.kind, body, admitted.headers, admitted.clientData, edgeCeilingKey(c), Date.now());
    if (!r.ok) {
      console.warn(`[native-auth] rid=${c.get('requestId') ?? '-'} key registration refused kind=${admitted.kind} (${r.why})`);
      if (r.status === 429) {
        return logged(c, 'install', gotrueError(429, r.code, 'Request rate limit reached', { 'Retry-After': '86400' }));
      }
      return logged(c, 'install', gotrueError(r.status, r.code, r.status === 400 ? r.why : r.status === 503 ? 'Sign-in is unavailable. Try again shortly.' : 'The app attestation did not verify'));
    }
    return logged(c, 'install', c.json({ key_id: r.keyId }, r.created ? 201 : 200));
  });

  // ⏱ 2026-10-01 — THE SYSTEM-BROWSER HAND-OFF (lib/native-attest/handoff.ts):
  // a desktop app that cannot attest exchanges the code the signed-in web page
  // minted (routes/native-handoff.ts) for a session of its own. No attestation
  // and no password: the code is the credential, bound to this app, its
  // redirect and its PKCE verifier, and spent once. Under the per-network
  // ceiling (fail closed); every refusal is the same 400.
  nativeAuth.post('/auth/native/:app/handoff/token', async (c) => {
    const edgeRefusal = refusedBy(await strictEdgeCeiling(c.env.NATIVE_AUTH_EDGE_LIMITER, c, 'NATIVE_AUTH_EDGE_LIMITER'));
    if (edgeRefusal) return logged(c, 'handoff', edgeRefusal);
    const bounded = await readBoundedBody(c.req.raw, NATIVE_AUTH_MAX_BODY_BYTES);
    if (!bounded.ok) return logged(c, 'handoff', gotrueError(bounded.status, bounded.status === 413 ? 'request_too_large' : 'bad_json', bounded.error));
    let body: unknown;
    try {
      body = JSON.parse(bounded.text);
    } catch {
      return logged(c, 'handoff', gotrueError(400, 'bad_json', 'The request body is not JSON'));
    }
    if (!isPlainObject(body)) return logged(c, 'handoff', gotrueError(400, 'bad_json', 'The request body is not a JSON object'));
    if (!challengesConfigured(c.env)) {
      console.error(`[native-auth] rid=${c.get('requestId') ?? '-'} NATIVE_ATTEST_CHALLENGE_KEY or PLATFORM_DB is not set`);
      return logged(c, 'handoff', gotrueError(503, 'native_auth_unavailable', 'Sign-in is unavailable. Try again shortly.'));
    }
    const r = await redeemHandoffCode(c.env, {
      app: c.get('appId') as string,
      code: body.code,
      verifier: body.code_verifier,
      redirectUri: body.redirect_uri,
      now: Date.now(),
    });
    if (!r.ok) {
      console.warn(`[native-auth] rid=${c.get('requestId') ?? '-'} hand-off refused (${r.why})`);
      return logged(c, 'handoff', handoffInvalid());
    }
    return logged(c, 'handoff', await handoffSession(c, r.user));
  });

  return nativeAuth;
}

export default createNativeAuth(NATIVE_AUTH_APPS);
