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
//     `POST …/attest/challenge` and to the exact body — Play Integrity (android),
//     App Attest (ios, macos App Store), or a registered per-install Ed25519
//     key (desktop, the weakest, with its own tighter ceilings and no session
//     before email verification). lib/native-attest/index.ts says what each
//     proves and what it does not; no proof is a 401 and GoTrue never hears it;
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
//     / ADR 020, SHIELD-R3): the incoming headers are forwarded as they arrived,
//     as services/edge-shield does, and the same-zone subrequest carries the
//     client's address to GoTrue without this file naming it.
//
// Credentials pass THROUGH: nothing here stores an email, a password or a token,
// and the one log line per call carries the route, the app, the status and the
// edge-shield marker — never the body.
// ─────────────────────────────────────────────────────────────────────────────
import { Hono, type Context, type MiddlewareHandler } from 'hono';
import type { AppEnv } from '../types';
import { NATIVE_AUTH_APPS } from '../generated/app-targets';
import { strictEdgeCeiling, strictRateLimit, type StrictVerdict } from '../lib/edge-ceiling';
import { readBoundedBody } from '../lib/body';
import {
  clientDataFor,
  configured,
  consumeChallenge,
  enabledKinds,
  isKind,
  issueChallenge,
  NATIVE_ATTEST_CHALLENGE_TTL_SECONDS,
  readHeaders,
  registerKey,
  verifyOp,
  type AttestKind,
  type AttestOp,
} from '../lib/native-attest';

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

/** The request headers never forwarded: the caller's cookie and GoTrue
 *  credentials; `referer`, GoTrue's fallback redirect source (a pinned
 *  `redirect_to` must not be bypassable through it); `host` and `content-length`,
 *  which describe THIS request, not the one sent upstream; and `origin`, which
 *  middleware/cors.ts has already refused. */
const DROPPED_REQUEST_HEADERS = ['cookie', 'authorization', 'apikey', 'referer', 'host', 'content-length', 'origin'];

/** A refusal in GoTrue's own (pre-2024-01-01) error shape, which gotrue-dart maps by `error_code`. */
function gotrueError(status: number, errorCode: string, msg: string, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ code: status, error_code: errorCode, msg }), {
    status,
    headers: { 'Content-Type': 'application/json', ...extra },
  });
}

/** One log line per call. Never the email, the password, the body or a token. */
function logged(c: Context<AppEnv>, op: NativeAuthOp | 'challenge' | 'install' | '-', res: Response, shield = '-'): Response {
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
 * registration: the headers, the kind this deploy accepts, the kind's own
 * config, the unattested ceilings, the body, the single-use challenge, and the
 * proof — in that order, so the cheap refusals cost no D1 read and no crypto,
 * and a challenge is burned by any request that reaches it, pass or fail.
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
  if (!isKind(h.kind) || !enabledKinds(c.env).has(h.kind)) {
    return gotrueError(403, 'attestation_kind_refused', 'This server does not accept that attestation');
  }
  const kind = h.kind;
  if (!configured(c.env, kind, app)) {
    console.error(`[native-auth] rid=${c.get('requestId') ?? '-'} attestation kind ${kind} is enabled but not configured`);
    return gotrueError(503, 'native_auth_unavailable', 'Sign-in is unavailable. Try again shortly.');
  }
  // The unattested channel's own, much tighter per-network ceiling; and key
  // registration's, for every kind. Both FAIL CLOSED, like the two above.
  if (op === 'install') {
    const r = refusedBy(await strictEdgeCeiling(c.env.NATIVE_AUTH_INSTALL_LIMITER, c, 'NATIVE_AUTH_INSTALL_LIMITER'));
    if (r) return r;
  } else if (kind === 'install-key') {
    const r = refusedBy(await strictEdgeCeiling(c.env.NATIVE_AUTH_UNATTESTED_LIMITER, c, 'NATIVE_AUTH_UNATTESTED_LIMITER'));
    if (r) return r;
  }

  const bounded = await readBoundedBody(c.req.raw, NATIVE_AUTH_MAX_BODY_BYTES);
  if (!bounded.ok) return gotrueError(bounded.status, bounded.status === 413 ? 'request_too_large' : 'bad_json', bounded.error);

  const now = Date.now();
  if (!(await consumeChallenge(c.env.PLATFORM_DB, app, h.challenge, now))) {
    return gotrueError(401, 'attestation_challenge_invalid', 'The attestation challenge is unknown, expired or already used');
  }
  const clientData = await clientDataFor(app, op, h.challenge, bounded.bytes);
  if (op !== 'install') {
    const v = await verifyOp(c.env, app, kind, h, clientData, now);
    if (!v.ok) {
      console.warn(`[native-auth] rid=${c.get('requestId') ?? '-'} attestation refused kind=${kind} (${v.why})`);
      return gotrueError(v.status, v.code, v.status === 503 ? 'Sign-in is unavailable. Try again shortly.' : 'The app attestation did not verify');
    }
  }
  return { kind, text: bounded.text, bytes: bounded.bytes, clientData, headers: h };
}

/**
 * ⏱ 2026-09-29 (ADR no.NNN) — NO SESSION BEFORE EMAIL VERIFICATION on the
 * unattested channel. GoTrue already answers a sign-up with no session and
 * refuses a password grant for an unconfirmed address (`mailer_autoconfirm`
 * false, which tooling/ops/auth-cutover-preflight.mjs grades); this holds the
 * property for `install-key` even if that setting ever drifts: a sign-up's
 * session is withheld (the user alone is returned, as GoTrue itself does when it
 * sends a confirmation), and a password grant whose user has no
 * `email_confirmed_at` is refused.
 */
async function unattestedSessionRule(op: NativeAuthOp, upstream: Response): Promise<Response | null> {
  if (!upstream.ok || (op !== 'signup' && op !== 'token')) return null;
  let body: Record<string, unknown>;
  try {
    body = (await upstream.clone().json()) as Record<string, unknown>;
  } catch {
    return gotrueError(502, 'native_auth_unavailable', 'Sign-in is unavailable. Try again shortly.');
  }
  if (op === 'signup') {
    if (!('access_token' in body) && !('refresh_token' in body)) return null;
    const user = isPlainObject(body.user) ? body.user : {};
    return new Response(JSON.stringify(user), { status: 200, headers: { 'Content-Type': 'application/json' } });
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

  const upstreamUrl = new URL(`${c.env.SUPABASE_URL}/auth/v1/${op}`);
  if (op === 'token') upstreamUrl.searchParams.set('grant_type', 'password');
  else if (redirects[0] !== undefined) upstreamUrl.searchParams.set('redirect_to', redirects[0]);

  // Forwarded as they arrived, as services/edge-shield forwards them, so the
  // user agent and the same-zone client address reach GoTrue without this Worker
  // reading either; then the caller's credentials out and ours in, exactly as
  // sessions.ts builds them.
  const headers = new Headers(c.req.raw.headers);
  for (const h of DROPPED_REQUEST_HEADERS) headers.delete(h);
  headers.set('Content-Type', 'application/json');
  headers.set('apikey', serviceRoleKey);
  headers.set('Authorization', `Bearer ${serviceRoleKey}`);

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl.toString(), {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      redirect: 'manual',
      signal: AbortSignal.timeout(NATIVE_AUTH_UPSTREAM_TIMEOUT_MS),
    });
  } catch (err) {
    console.error(
      `[native-auth] rid=${c.get('requestId') ?? '-'} GoTrue unreachable (${err instanceof Error ? err.name : typeof err})`,
    );
    return logged(c, op, gotrueError(503, 'native_auth_unavailable', 'Sign-in is unavailable. Try again shortly.'));
  }

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
    if (enabledKinds(c.env).size === 0 || !c.env.PLATFORM_DB) {
      return logged(c, 'challenge', gotrueError(403, 'attestation_kind_refused', 'This server does not accept native sign-in'));
    }
    const challenge = await issueChallenge(c.env.PLATFORM_DB, c.get('appId') as string, Date.now());
    return logged(c, 'challenge', c.json({ challenge, expires_in: NATIVE_ATTEST_CHALLENGE_TTL_SECONDS }));
  });

  // ⏱ 2026-09-29 (ADR no.NNN) — an install registers its key once: an App
  // Attest attestation, or a desktop Ed25519 key signing its own registration.
  nativeAuth.post('/auth/native/:app/attest/install', async (c) => {
    const edgeRefusal = refusedBy(await strictEdgeCeiling(c.env.NATIVE_AUTH_EDGE_LIMITER, c, 'NATIVE_AUTH_EDGE_LIMITER'));
    if (edgeRefusal) return logged(c, 'install', edgeRefusal);
    const admitted = await admit(c, 'install');
    if (admitted instanceof Response) return logged(c, 'install', admitted);
    if (admitted.kind === 'play-integrity') {
      return logged(c, 'install', gotrueError(400, 'validation_failed', 'play-integrity registers no key'));
    }
    let body: unknown;
    try {
      body = JSON.parse(admitted.text);
    } catch {
      return logged(c, 'install', gotrueError(400, 'bad_json', 'The request body is not JSON'));
    }
    if (!isPlainObject(body) || body.kind !== admitted.kind) {
      return logged(c, 'install', gotrueError(400, 'validation_failed', 'kind must match X-NK-Attest-Kind'));
    }
    const r = await registerKey(c.env, c.get('appId') as string, admitted.kind, body, admitted.headers, admitted.clientData, Date.now());
    if (!r.ok) {
      console.warn(`[native-auth] rid=${c.get('requestId') ?? '-'} key registration refused kind=${admitted.kind} (${r.why})`);
      return logged(c, 'install', gotrueError(r.status, r.code, r.status === 400 ? r.why : 'The app attestation did not verify'));
    }
    return logged(c, 'install', c.json({ key_id: r.keyId }, r.created ? 201 : 200));
  });

  return nativeAuth;
}

export default createNativeAuth(NATIVE_AUTH_APPS);
