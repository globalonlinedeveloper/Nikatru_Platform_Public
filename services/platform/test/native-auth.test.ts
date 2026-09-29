// ─────────────────────────────────────────────────────────────────────────────
// native-auth.test.ts — POST /v1/auth/native/:app/{token,signup,recover,resend}
// (⏱ 2026-09-28 · ST-N1, routes/native-auth.ts).
//
// WHAT IS BEING PROVEN, and each case is the shape of a way this could be wrong:
//   ST-N1a · the route
//     · 🔴 a password call reaches GoTrue with the SERVICE-ROLE bearer (which is
//       what makes GoTrue skip its captcha) and WITHOUT gotrue_meta_security, and
//       GoTrue's status and JSON come back verbatim, Set-Cookie dropped;
//     · the caller's cookie, authorization, apikey and referer never reach GoTrue;
//       the user agent does, as it arrived;
//     · refresh / pkce / id_token grants are 400 — they are not captcha-gated and
//       must go straight to GoTrue, never through the service-role door;
//     · 🔴 a request carrying Origin is a 403: a web page cannot use this route;
//     · a redirect is kept only when it is the app's OWN callback;
//     · an app that is not a native app, or whose id is not scheme-safe, is 404;
//     · a SECOND fixture app is served by the same code with its own scheme —
//       the route is per app, read from the generated register;
//     · the source names no client-address header.
//   ST-N1b · the limiters
//     · 🔴 the 6th call for one account inside the period is 429 in GoTrue's shape;
//     · 🔴 a limiter that throws, or is not bound, is a 503 — NEVER an admit.
// GoTrue is a fake behind a stubbed `fetch`; the limiters are in-memory counters.
// Nothing here reaches a network.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import { app } from '../src/index';
import {
  createNativeAuth,
  isOwnCallback,
  NATIVE_AUTH_MAX_BODY_BYTES,
  NATIVE_AUTH_RETRY_AFTER_SECONDS,
  NATIVE_AUTH_UPSTREAM_TIMEOUT_MS,
} from '../src/routes/native-auth';
import { NATIVE_AUTH_APPS } from '../src/generated/app-targets';
import type { AppEnv, RateLimiterBinding } from '../src/types';
import source from '../src/routes/native-auth.ts?raw';
import { realPlatformDb, type RealDb } from './harness';
import { clientDataFor, issueChallenge, type AttestOp } from '../src/lib/native-attest';
import { b64url, sha256 } from '../src/lib/native-attest/bytes';

const SUPABASE_URL = 'https://native-auth-test.gotrue.example';
const SERVICE_KEY = 'service-role-key-made-up-for-this-test';
const ANON_KEY = 'anon-key-the-app-would-send';
const APP = 'subscriptiontracker';
const OWN = `com.nikatru.${APP}://auth-callback`;
const BASE = `/v1/auth/native/${APP}`;
const UA = 'Dart/3.9 (dart:io) nikatru-subscriptiontracker/1.4.0';

/** A Rate Limiting binding with Cloudflare's shape: `limit` per key per test. */
class FakeLimiter implements RateLimiterBinding {
  readonly keys: string[] = [];
  private readonly counts = new Map<string, number>();
  constructor(
    private readonly cap: number,
    public mode: 'ok' | 'throw' = 'ok',
  ) {}
  async limit({ key }: { key: string }): Promise<{ success: boolean }> {
    this.keys.push(key);
    if (this.mode === 'throw') throw new Error('rate limiter unavailable');
    const n = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, n);
    return { success: n <= this.cap };
  }
}

/** What GoTrue received, and what it answers. */
type Seen = { url: URL; headers: Headers; body: Record<string, unknown>; signal: unknown };
const gotrue: {
  seen: Seen[];
  answer: () => Response | Promise<Response>;
} = { seen: [], answer: () => new Response('{}') };

const answerJson = (status: number, body: unknown, headers: Record<string, string> = {}) => () =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

beforeAll(() => {
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    if (url.origin !== SUPABASE_URL) throw new Error(`unexpected fetch in test: ${url.href}`);
    gotrue.seen.push({
      url,
      headers: new Headers(init.headers),
      body: JSON.parse(String(init.body)) as Record<string, unknown>,
      signal: init.signal,
    });
    return gotrue.answer();
  });
});
afterAll(() => vi.unstubAllGlobals());

const exportRaw = async (k: CryptoKey) => (await crypto.subtle.exportKey('raw', k)) as ArrayBuffer;

/** The desktop install every call below attests with, unless a case says otherwise. */
let installKey: CryptoKeyPair;
let installKeyId: string;
beforeAll(async () => {
  installKey = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const raw = new Uint8Array(await exportRaw(installKey.publicKey));
  installKeyId = b64url(await sha256(raw));
});

/** A session GoTrue would answer a password grant with, for a CONFIRMED address. */
const SESSION = {
  access_token: 'access-token-value',
  refresh_token: 'refresh-token-value',
  token_type: 'bearer',
  user: { id: 'user-1', email_confirmed_at: '2026-09-01T00:00:00Z' },
};

let account: FakeLimiter;
let edge: FakeLimiter;
let unattested: FakeLimiter;
let installs: FakeLimiter;
let db: RealDb;
beforeEach(async () => {
  db = realPlatformDb();
  // The install's key, registered for both apps the suite serves — the
  // registration route itself is proven in its own block below.
  const pk = b64url(new Uint8Array(await exportRaw(installKey.publicKey)));
  for (const a of [APP, 'budgetbuddy']) {
    db.db
      .prepare('INSERT INTO native_attest_keys (app_id, key_id, kind, public_key, sign_count, created_at, last_used_at) VALUES (?, ?, ?, ?, 0, ?, ?)')
      .run(a, installKeyId, 'install-key', pk, '2026-09-29T00:00:00.000Z', '2026-09-29T00:00:00.000Z');
  }
  gotrue.seen = [];
  gotrue.answer = answerJson(200, SESSION, {
    'Set-Cookie': 'sb=1; Path=/',
    'x-nikatru-shield': '1',
    'x-supabase-api-version': '2024-01-01',
  });
  account = new FakeLimiter(5);
  edge = new FakeLimiter(60);
  // Roomy by default so the ST-N1 cases measure what they did before; the
  // tighter ceiling is proven on its own in the ST-A block.
  unattested = new FakeLimiter(1000);
  installs = new FakeLimiter(1000);
});
afterEach(() => vi.restoreAllMocks());

function env(over: Partial<AppEnv['Bindings']> = {}): AppEnv['Bindings'] {
  return {
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
    ALLOWED_ORIGINS: 'https://nikatru.com',
    NATIVE_AUTH_ACCOUNT_LIMITER: account,
    NATIVE_AUTH_EDGE_LIMITER: edge,
    NATIVE_AUTH_UNATTESTED_LIMITER: unattested,
    NATIVE_AUTH_INSTALL_LIMITER: installs,
    NATIVE_AUTH_ATTEST_KINDS: 'app-attest,install-key',
    PLATFORM_DB: db,
    ...over,
  } as AppEnv['Bindings'];
}

/**
 * The four attestation headers for `path` and `text`, as the app's attesting
 * client sends them: a fresh challenge, and the install key's Ed25519 signature
 * over the binding of THIS app, op, challenge and body.
 */
async function attestHeaders(path: string, text: string, key: CryptoKeyPair = installKey, keyId = installKeyId): Promise<Record<string, string>> {
  const [, , , , app, ...rest] = new URL(path, 'https://x.example').pathname.split('/');
  const op = (rest[0] === 'attest' ? 'install' : rest[0]) as AttestOp;
  const challenge = await issueChallenge(db as unknown as D1Database, app!, Date.now());
  const clientData = await clientDataFor(app!, op, challenge, new TextEncoder().encode(text));
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, key.privateKey, new TextEncoder().encode(clientData)));
  return {
    'X-NK-Attest-Kind': 'install-key',
    'X-NK-Attest-Challenge': challenge,
    'X-NK-Attest-Key': keyId,
    'X-NK-Attest-Proof': b64url(sig),
  };
}

/** A request as gotrue-dart sends it through the attesting client: its own apikey and anon bearer, no Origin. */
async function call(
  path: string,
  body: unknown,
  {
    headers = {},
    bindings = {},
    via = app,
    attest = true,
  }: { headers?: Record<string, string>; bindings?: Partial<AppEnv['Bindings']>; via?: Hono<AppEnv>; attest?: boolean } = {},
) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  const proof = attest ? await attestHeaders(path, text) : {};
  return via.request(
    path,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json;charset=UTF-8',
        'User-Agent': UA,
        'X-Supabase-Api-Version': '2024-01-01',
        apikey: ANON_KEY,
        Authorization: `Bearer ${ANON_KEY}`,
        ...proof,
        ...headers,
      },
      body: text,
    },
    env(bindings),
  );
}

const password = (email = 'person@example.test') => ({
  email,
  password: 'correct horse battery staple',
  gotrue_meta_security: { captcha_token: null },
});

describe('ST-N1a · the route is mounted, per app, from the generated register', () => {
  it('serves the generated NATIVE_AUTH_APPS, and app #1 is in it', () => {
    // Not a tautology: the register is rendered from apps/, and an empty render
    // would make every case below 404 for a reason unrelated to the route.
    expect(NATIVE_AUTH_APPS).toContain(APP);
  });

  it('🔴 a password call reaches GoTrue with the service-role bearer and without gotrue_meta_security', async () => {
    const res = await call(`${BASE}/token?grant_type=password`, password());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(SESSION);
    expect(gotrue.seen).toHaveLength(1);
    const [s] = gotrue.seen;
    expect(s!.url.pathname).toBe('/auth/v1/token');
    expect([...s!.url.searchParams]).toEqual([['grant_type', 'password']]);
    expect(s!.headers.get('authorization')).toBe(`Bearer ${SERVICE_KEY}`);
    expect(s!.headers.get('apikey')).toBe(SERVICE_KEY);
    expect(s!.body).toEqual({ email: 'person@example.test', password: 'correct horse battery staple' });
    expect(s!.body).not.toHaveProperty('gotrue_meta_security');
    expect(s!.signal).toBeInstanceOf(AbortSignal);
    expect(NATIVE_AUTH_UPSTREAM_TIMEOUT_MS).toBeGreaterThan(0);
  });

  it('forwards the incoming headers as they arrived, minus the caller\'s credentials, cookie and referer', async () => {
    await call(`${BASE}/token?grant_type=password`, password(), {
      headers: {
        Cookie: 'sb-access-token=stolen',
        Referer: 'https://elsewhere.example/landing',
        'X-Request-Id': 'rid-1',
        // What Cloudflare puts on the request this Worker receives; on the
        // same-zone subrequest it becomes GoTrue's CF-Connecting-IP (edge-shield's
        // header comment). Passed through as it arrived — never read here.
        'X-Real-IP': '203.0.113.7',
      },
    });
    const h = gotrue.seen[0]!.headers;
    expect(h.get('x-real-ip')).toBe('203.0.113.7');
    expect(h.get('user-agent')).toBe(UA);
    expect(h.get('x-supabase-api-version')).toBe('2024-01-01');
    expect(h.get('x-request-id')).toBe('rid-1');
    expect(h.get('cookie')).toBeNull();
    expect(h.get('referer')).toBeNull();
    expect(h.get('authorization')).not.toContain(ANON_KEY);
    expect(h.get('apikey')).not.toBe(ANON_KEY);
    expect(h.get('content-type')).toBe('application/json');
  });

  it('returns GoTrue\'s status and JSON verbatim, so gotrue-dart can map error_code, and drops Set-Cookie', async () => {
    const refusal = { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' };
    gotrue.answer = answerJson(400, refusal, { 'Set-Cookie': 'x=1', 'x-nikatru-shield': '1' });
    const res = await call(`${BASE}/token?grant_type=password`, password());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual(refusal);
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('logs one line per call — route, app, status, the shield marker — and never the email, password or token', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await call(`${BASE}/token?grant_type=password`, password('someone.private@example.test'));
    const lines = log.mock.calls.map((a) => a.join(' ')).filter((l) => l.startsWith('[native-auth]'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/route=token app=subscriptiontracker status=200 shield=1$/);
    expect(lines[0]).not.toContain('someone.private');
    expect(lines[0]).not.toContain('horse');
    expect(lines[0]).not.toContain('token-value');
  });

  it('🔴 red control: a refresh, pkce or id_token grant is 400 and never reaches GoTrue', async () => {
    for (const grant of ['refresh_token', 'pkce', 'id_token', 'PASSWORD', '']) {
      const res = await call(`${BASE}/token?grant_type=${grant}`, { refresh_token: 'rt' });
      expect(res.status, grant).toBe(400);
      expect(((await res.json()) as { error_code: string }).error_code).toBe('unsupported_grant_type');
    }
    const none = await call(`${BASE}/token`, password());
    expect(none.status).toBe(400);
    expect(gotrue.seen).toHaveLength(0);
    expect(edge.keys, 'a refused grant spends no limiter call').toHaveLength(0);
  });

  it('🔴 red control: a request carrying Origin is 403 — even a listed origin — with no CORS grant', async () => {
    for (const origin of ['https://nikatru.com', 'https://evil.example', 'null']) {
      const res = await call(`${BASE}/token?grant_type=password`, password(), { headers: { Origin: origin } });
      expect(res.status, origin).toBe(403);
      expect(((await res.json()) as { error_code: string }).error_code).toBe('browser_origin_refused');
      expect(res.headers.get('access-control-allow-origin')).toBeNull();
    }
    expect(gotrue.seen).toHaveLength(0);
  });

  it('🔴 red control: an app that is not a native app is 404, and so is one whose id is not scheme-safe', async () => {
    const unknown = await call('/v1/auth/native/notanapp/token?grant_type=password', password());
    expect(unknown.status).toBe(404);
    expect(((await unknown.json()) as { error_code: string }).error_code).toBe('unknown_app');
    // `snake_case` is IN this fixture's list, and is still refused: com.nikatru.snake_case
    // is not a scheme (authCallbackScheme() refuses it; O-AUTH-SCHEME-REFUSES-A-SNAKE-CASE-APP-ID).
    const fixture = new Hono<AppEnv>().route('/v1', createNativeAuth(['snake_case']));
    const snake = await call('/v1/auth/native/snake_case/token?grant_type=password', password(), { via: fixture });
    expect(snake.status).toBe(404);
    expect(gotrue.seen).toHaveLength(0);
  });

  it('🔴 red control: a redirect that is not the app\'s own callback is 400', async () => {
    for (const foreign of [
      'https://nikatru.com/subscriptiontracker',
      'com.nikatru.otherapp://auth-callback',
      `${OWN}.evil.example`,
      `${OWN}/extra`,
      `${OWN}?nk_auth=reset&next=https://evil.example`,
      `${OWN}?other=1`,
      `${OWN}?nk_auth=`,
      `${OWN}#fragment`,
      `COM.NIKATRU.${APP.toUpperCase()}://auth-callback`,
    ]) {
      const q = encodeURIComponent(foreign);
      const a = await call(`${BASE}/signup?redirect_to=${q}`, { email: 'a@example.test', password: 'pw' });
      expect(a.status, foreign).toBe(400);
      const b = await call(`${BASE}/recover?email_redirect_to=${q}`, { email: 'a@example.test' });
      expect(b.status, foreign).toBe(400);
    }
    expect(gotrue.seen).toHaveLength(0);
  });

  it('keeps the app\'s own callback, with or without a marker, and forwards nothing else in the query', async () => {
    expect(isOwnCallback(APP, OWN)).toBe(true);
    expect(isOwnCallback(APP, `${OWN}?nk_auth=email-change`)).toBe(true);
    await call(`${BASE}/signup?redirect_to=${encodeURIComponent(`${OWN}?nk_auth=confirm`)}&foo=bar`, {
      email: 'a@example.test',
      password: 'pw',
    });
    await call(`${BASE}/recover?email_redirect_to=${encodeURIComponent(`${OWN}?nk_auth=reset`)}`, { email: 'a@example.test' });
    await call(`${BASE}/resend`, { email: 'a@example.test', type: 'signup' });
    expect(gotrue.seen.map((s) => `${s.url.pathname}${s.url.search}`)).toEqual([
      `/auth/v1/signup?redirect_to=${encodeURIComponent(`${OWN}?nk_auth=confirm`)}`,
      `/auth/v1/recover?redirect_to=${encodeURIComponent(`${OWN}?nk_auth=reset`)}`,
      '/auth/v1/resend',
    ]);
  });

  it('forwards only each call\'s allow-listed body fields', async () => {
    const extra = { gotrue_meta_security: { captcha_token: 'x' }, role: 'service_role', app_metadata: { admin: true }, phone: '+911234567890' };
    await call(`${BASE}/signup`, {
      email: 'a@example.test',
      password: 'pw',
      data: { name: 'A' },
      code_challenge: 'c'.repeat(43),
      code_challenge_method: 's256',
      ...extra,
    });
    await call(`${BASE}/recover`, { email: 'a@example.test', code_challenge: null, code_challenge_method: null, password: 'x', ...extra });
    await call(`${BASE}/resend`, { email: 'a@example.test', type: 'email_change', data: { x: 1 }, code_challenge: 'd'.repeat(43), code_challenge_method: 's256', ...extra });
    expect(gotrue.seen.map((s) => s.body)).toEqual([
      { email: 'a@example.test', password: 'pw', data: { name: 'A' }, code_challenge: 'c'.repeat(43), code_challenge_method: 's256' },
      { email: 'a@example.test' },
      { email: 'a@example.test', type: 'email_change', code_challenge: 'd'.repeat(43), code_challenge_method: 's256' },
    ]);
  });

  it('refuses a body it cannot vouch for: no email, a phone resend, a wrong type, not JSON, too large', async () => {
    const cases: Array<[string, unknown, number]> = [
      [`${BASE}/token?grant_type=password`, { phone: '+911234567890', password: 'pw' }, 400],
      [`${BASE}/token?grant_type=password`, { email: 42, password: 'pw' }, 400],
      [`${BASE}/signup`, { email: 'a@example.test', password: 'pw', data: 'not-an-object' }, 400],
      [`${BASE}/resend`, { email: 'a@example.test', type: 'sms' }, 400],
      [`${BASE}/resend`, { email: 'a@example.test' }, 400],
      [`${BASE}/recover`, 'not json', 400],
      [`${BASE}/recover`, [{ email: 'a@example.test' }], 400],
      [`${BASE}/signup`, { email: 'a@example.test', password: 'x'.repeat(NATIVE_AUTH_MAX_BODY_BYTES) }, 413],
    ];
    for (const [path, body, status] of cases) {
      expect((await call(path, body)).status, `${path} ${JSON.stringify(body).slice(0, 60)}`).toBe(status);
    }
    expect(gotrue.seen).toHaveLength(0);
  });

  it('ONE PIPELINE: a second fixture app is served by the same code, with its own scheme', async () => {
    const fixture = new Hono<AppEnv>().route('/v1', createNativeAuth([APP, 'budgetbuddy']));
    const own = encodeURIComponent('com.nikatru.budgetbuddy://auth-callback?nk_auth=confirm');
    const ok = await call(`/v1/auth/native/budgetbuddy/signup?redirect_to=${own}`, { email: 'b@example.test', password: 'pw' }, { via: fixture });
    expect(ok.status).toBe(200);
    expect(gotrue.seen[0]!.url.searchParams.get('redirect_to')).toBe('com.nikatru.budgetbuddy://auth-callback?nk_auth=confirm');
    // App #1's callback is not budgetbuddy's.
    const cross = await call(`/v1/auth/native/budgetbuddy/signup?redirect_to=${encodeURIComponent(OWN)}`, { email: 'b@example.test', password: 'pw' }, { via: fixture });
    expect(cross.status).toBe(400);
    // And the per-account key is per app: the same address is a different bucket.
    await call(`/v1/auth/native/budgetbuddy/token?grant_type=password`, password(), { via: fixture });
    await call(`/v1/auth/native/${APP}/token?grant_type=password`, password(), { via: fixture });
    const apps = account.keys.map((k) => k.split(':')[1]);
    expect(apps.slice(-2)).toEqual(['budgetbuddy', APP]);
  });

  it('🔴 the source names no client-address header — GoTrue gets the address from the forwarded request', () => {
    // Comments are stripped first: the header comment EXPLAINS why no address is
    // read, and a guard over prose would fail on the explanation.
    const code = stripComments(source);
    expect(code.length).toBeGreaterThan(1000);
    for (const header of ['cf-connecting-ip', 'x-forwarded-for', 'x-real-ip', 'true-client-ip', 'forwarded']) {
      expect(code.toLowerCase(), header).not.toContain(header);
    }
    expect(code).not.toMatch(/\.cf\b/);
  });
});

describe('ST-N1b · the limiters, which fail CLOSED', () => {
  it('🔴 the 6th call for one account inside 60 s is 429 over_request_rate_limit, with Retry-After', async () => {
    for (let i = 1; i <= 5; i++) {
      // The address is the account however it is cased or padded.
      const email = i % 2 ? 'Person@Example.test' : ' person@example.test ';
      expect((await call(`${BASE}/token?grant_type=password`, password(email))).status, `call ${i}`).toBe(200);
    }
    const sixth = await call(`${BASE}/recover`, { email: 'PERSON@example.test' });
    expect(sixth.status).toBe(429);
    expect(sixth.headers.get('retry-after')).toBe(String(NATIVE_AUTH_RETRY_AFTER_SECONDS));
    expect(await sixth.json()).toMatchObject({ code: 429, error_code: 'over_request_rate_limit' });
    expect(gotrue.seen).toHaveLength(5);
    // Another account is its own bucket.
    expect((await call(`${BASE}/token?grant_type=password`, password('other@example.test'))).status).toBe(200);
    // The key is a digest, never the address.
    for (const k of account.keys) {
      expect(k).toMatch(/^acct:subscriptiontracker:[0-9a-f]{64}$/);
      expect(k).not.toContain('example');
    }
  });

  it('the per-network ceiling is keyed on the edge, not on the caller, and over it is 429', async () => {
    edge = new FakeLimiter(1);
    expect((await call(`${BASE}/token?grant_type=password`, password('a@example.test'))).status).toBe(200);
    const res = await call(`${BASE}/token?grant_type=password`, password('b@example.test'));
    expect(res.status).toBe(429);
    expect(((await res.json()) as { error_code: string }).error_code).toBe('over_request_rate_limit');
    expect(new Set(edge.keys)).toEqual(new Set(['edge:-:-']));
  });

  it('🔴 red control: a limiter that throws is a 503 — never an admit', async () => {
    for (const which of ['account', 'edge'] as const) {
      account = new FakeLimiter(5, which === 'account' ? 'throw' : 'ok');
      edge = new FakeLimiter(60, which === 'edge' ? 'throw' : 'ok');
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const res = await call(`${BASE}/token?grant_type=password`, password());
      expect(res.status, which).toBe(503);
      expect(((await res.json()) as { error_code: string }).error_code).toBe('native_auth_unavailable');
    }
    expect(gotrue.seen).toHaveLength(0);
  });

  it('🔴 a limiter that is not bound is a 503 on every call — the opposite of every other limiter here', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    for (const missing of ['NATIVE_AUTH_ACCOUNT_LIMITER', 'NATIVE_AUTH_EDGE_LIMITER'] as const) {
      const res = await call(`${BASE}/signup`, { email: 'a@example.test', password: 'pw' }, { bindings: { [missing]: undefined } });
      expect(res.status, missing).toBe(503);
    }
    expect(gotrue.seen).toHaveLength(0);
  });

  it('no service-role key, or a GoTrue that cannot be reached, is a 503 — never a guess', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const noKey = await call(`${BASE}/token?grant_type=password`, password(), { bindings: { SUPABASE_SERVICE_ROLE_KEY: undefined } });
    expect(noKey.status).toBe(503);
    expect(gotrue.seen).toHaveLength(0);
    gotrue.answer = () => {
      throw new TypeError('Network connection lost');
    };
    const down = await call(`${BASE}/token?grant_type=password`, password('x@example.test'));
    expect(down.status).toBe(503);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ⏱ 2026-09-29 · ADR no.NNN — ST-A · ONLY AN ATTESTED INSTALL GETS THROUGH.
// The defect: until this block, a script that simply left `Origin` off got
// captcha-free password sign-in and sign-up. Every case below is a way a
// script could still try, and each must stop BEFORE GoTrue and before an
// account's bucket is spent.
// ─────────────────────────────────────────────────────────────────────────────
const errorCode = async (res: Response) => ((await res.json()) as { error_code: string }).error_code;

describe('ST-A · the attestation gate (ADR no.NNN)', () => {
  it('🔴 red control — THE ORIGINAL BYPASS: the exact request that worked before, with no attestation, is 401 on all four ops', async () => {
    for (const [path, body] of [
      [`${BASE}/token?grant_type=password`, password()],
      [`${BASE}/signup`, { email: 'bot@example.test', password: 'pw' }],
      [`${BASE}/recover`, { email: 'bot@example.test' }],
      [`${BASE}/resend`, { email: 'bot@example.test', type: 'signup' }],
    ] as const) {
      const res = await call(path, body, { attest: false });
      expect(res.status, path).toBe(401);
      expect(await errorCode(res)).toBe('attestation_required');
    }
    expect(gotrue.seen).toHaveLength(0);
    expect(account.keys, 'an unattested call spends no account bucket — no lockout by script').toHaveLength(0);
  });

  it('a genuine install-key signature passes, and the key\'s last use is recorded', async () => {
    const res = await call(`${BASE}/token?grant_type=password`, password());
    expect(res.status).toBe(200);
    const row = db.rows('SELECT last_used_at FROM native_attest_keys WHERE app_id = ? AND key_id = ?', APP, installKeyId)[0];
    expect(String(row!.last_used_at) > '2026-09-29T00:00:00.000Z').toBe(true);
  });

  it('🔴 a REPLAYED request — same challenge, same signature, same body — is 401 the second time', async () => {
    const text = JSON.stringify(password());
    const headers = await attestHeaders(`${BASE}/token?grant_type=password`, text);
    const first = await call(`${BASE}/token?grant_type=password`, text, { attest: false, headers });
    expect(first.status).toBe(200);
    const replay = await call(`${BASE}/token?grant_type=password`, text, { attest: false, headers });
    expect(replay.status).toBe(401);
    expect(await errorCode(replay)).toBe('attestation_challenge_invalid');
    expect(gotrue.seen).toHaveLength(1);
  });

  it('🔴 a signature over a DIFFERENT body is 401 — the proof covers the exact bytes, so a captured one cannot carry another password', async () => {
    const headers = await attestHeaders(`${BASE}/token?grant_type=password`, JSON.stringify(password('victim@example.test')));
    const res = await call(`${BASE}/token?grant_type=password`, password('other@example.test'), { attest: false, headers });
    expect(res.status).toBe(401);
    expect(await errorCode(res)).toBe('attestation_invalid');
    expect(gotrue.seen).toHaveLength(0);
  });

  it('🔴 a proof for one op does not open another, and a challenge for another app does not redeem here', async () => {
    const text = JSON.stringify({ email: 'a@example.test', password: 'pw' });
    const asSignup = await attestHeaders(`${BASE}/signup`, text);
    const res = await call(`${BASE}/token?grant_type=password`, text, { attest: false, headers: asSignup });
    expect(res.status).toBe(401);
    expect(await errorCode(res)).toBe('attestation_invalid');

    const fixture = new Hono<AppEnv>().route('/v1', createNativeAuth([APP, 'budgetbuddy']));
    const forBudget = await attestHeaders('/v1/auth/native/budgetbuddy/signup', text);
    const cross = await call(`${BASE}/signup`, text, { attest: false, headers: forBudget, via: fixture });
    expect(cross.status).toBe(401);
    expect(await errorCode(cross)).toBe('attestation_challenge_invalid');
    expect(gotrue.seen).toHaveLength(0);
  });

  it('🔴 an expired challenge, a made-up challenge and an unregistered key are each refused', async () => {
    const text = JSON.stringify(password());
    const stale = await attestHeaders(`${BASE}/token?grant_type=password`, text);
    db.db.prepare("UPDATE native_attest_challenges SET expires_at = '2026-01-01T00:00:00.000Z'").run();
    expect(await errorCode(await call(`${BASE}/token?grant_type=password`, text, { attest: false, headers: stale }))).toBe(
      'attestation_challenge_invalid',
    );

    const invented = { ...(await attestHeaders(`${BASE}/token?grant_type=password`, text)), 'X-NK-Attest-Challenge': 'A'.repeat(43) };
    expect(await errorCode(await call(`${BASE}/token?grant_type=password`, text, { attest: false, headers: invented }))).toBe(
      'attestation_challenge_invalid',
    );

    const stranger = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair;
    const strangerId = b64url(await sha256(new Uint8Array(await exportRaw(stranger.publicKey))));
    const unknown = await call(`${BASE}/token?grant_type=password`, text, {
      attest: false,
      headers: await attestHeaders(`${BASE}/token?grant_type=password`, text, stranger, strangerId),
    });
    expect(unknown.status).toBe(401);
    expect(await errorCode(unknown)).toBe('attestation_key_unknown');

    // A registered key id with ANOTHER key's signature.
    const forged = await call(`${BASE}/token?grant_type=password`, text, {
      attest: false,
      headers: await attestHeaders(`${BASE}/token?grant_type=password`, text, stranger, installKeyId),
    });
    expect(await errorCode(forged)).toBe('attestation_invalid');
    expect(gotrue.seen).toHaveLength(0);
  });

  it('🔴 THE FLAG: a kind this deploy does not list is 403, and a deploy that lists none refuses everything, challenges included', async () => {
    const onlyApple = await call(`${BASE}/token?grant_type=password`, password(), { bindings: { NATIVE_AUTH_ATTEST_KINDS: 'app-attest' } });
    expect(onlyApple.status).toBe(403);
    expect(await errorCode(onlyApple)).toBe('attestation_kind_refused');
    for (const off of [undefined, '', 'nonsense']) {
      const res = await call(`${BASE}/signup`, { email: 'a@example.test', password: 'pw' }, { bindings: { NATIVE_AUTH_ATTEST_KINDS: off } });
      expect(res.status, String(off)).toBe(403);
      const ch = await app.request(`${BASE}/attest/challenge`, { method: 'POST', body: '{}' }, env({ NATIVE_AUTH_ATTEST_KINDS: off }));
      expect(ch.status, String(off)).toBe(403);
    }
    expect(gotrue.seen).toHaveLength(0);
  });

  it('🔴 a listed kind whose server config is missing is 503 — play-integrity with no key, app-attest with no team id — never a pass', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const text = JSON.stringify(password());
    for (const [kind, bindings] of [
      ['play-integrity', { NATIVE_AUTH_ATTEST_KINDS: 'play-integrity' }],
      ['app-attest', { NATIVE_AUTH_ATTEST_KINDS: 'app-attest', APP_ATTEST_TEAM_ID: undefined }],
    ] as const) {
      const headers = { ...(await attestHeaders(`${BASE}/token?grant_type=password`, text)), 'X-NK-Attest-Kind': kind };
      const res = await call(`${BASE}/token?grant_type=password`, text, { attest: false, headers, bindings });
      expect(res.status, kind).toBe(503);
      expect(await errorCode(res)).toBe('native_auth_unavailable');
    }
    expect(gotrue.seen).toHaveLength(0);
  });

  it('🔴 the UNATTESTED channel has its own, tighter per-network ceiling; over it is 429, and absent it is 503', async () => {
    unattested = new FakeLimiter(10);
    for (let i = 0; i < 10; i++) expect((await call(`${BASE}/recover`, { email: `p${i}@example.test` })).status, `call ${i}`).toBe(200);
    const over = await call(`${BASE}/recover`, { email: 'p10@example.test' });
    expect(over.status).toBe(429);
    expect(new Set(unattested.keys)).toEqual(new Set(['edge:-:-']));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const unbound = await call(`${BASE}/recover`, { email: 'x@example.test' }, { bindings: { NATIVE_AUTH_UNATTESTED_LIMITER: undefined } });
    expect(unbound.status).toBe(503);
    expect(gotrue.seen).toHaveLength(10);
  });

  it('🔴 NO SESSION BEFORE EMAIL VERIFICATION on the unattested channel: a sign-up\'s session is withheld, an unconfirmed password grant is 403', async () => {
    gotrue.answer = answerJson(200, { ...SESSION, user: { id: 'new', email_confirmed_at: null } });
    const signup = await call(`${BASE}/signup`, { email: 'new@example.test', password: 'pw' });
    expect(signup.status).toBe(200);
    const body = (await signup.json()) as Record<string, unknown>;
    expect(body).toEqual({ id: 'new', email_confirmed_at: null });
    expect(JSON.stringify(body)).not.toContain('token-value');

    const token = await call(`${BASE}/token?grant_type=password`, password('new@example.test'));
    expect(token.status).toBe(403);
    expect(await errorCode(token)).toBe('email_not_confirmed');

    // What GoTrue itself answers today (mailer_autoconfirm false) passes through untouched.
    gotrue.answer = answerJson(200, { id: 'new', email: 'new@example.test', confirmation_sent_at: '2026-09-29T00:00:00Z' });
    const plain = await call(`${BASE}/signup`, { email: 'new2@example.test', password: 'pw' });
    expect(await plain.json()).toMatchObject({ id: 'new', confirmation_sent_at: '2026-09-29T00:00:00Z' });
  });

  it('the challenge endpoint mints a 43-character single-use challenge and stores only its hash', async () => {
    const res = await app.request(`${BASE}/attest/challenge`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }, env());
    expect(res.status).toBe(200);
    const { challenge, expires_in } = (await res.json()) as { challenge: string; expires_in: number };
    expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(expires_in).toBe(120);
    const rows = db.rows('SELECT challenge_hash FROM native_attest_challenges');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.challenge_hash).toBe(b64url(await sha256(challenge)));
    expect(edge.keys).toHaveLength(1);
    // A browser still cannot use any of it.
    const browser = await app.request(`${BASE}/attest/challenge`, { method: 'POST', headers: { Origin: 'https://nikatru.com' }, body: '{}' }, env());
    expect(browser.status).toBe(403);
  });
});

describe('ST-A · key registration (POST …/attest/install)', () => {
  const installPath = `${BASE}/attest/install`;
  async function register(key: CryptoKeyPair, over: { body?: string; proofKey?: CryptoKeyPair } = {}) {
    const raw = new Uint8Array(await exportRaw(key.publicKey));
    const text = over.body ?? JSON.stringify({ kind: 'install-key', public_key: b64url(raw) });
    const headers = await attestHeaders(installPath, text, over.proofKey ?? key, 'unused');
    delete (headers as Record<string, string | undefined>)['X-NK-Attest-Key'];
    return app.request(installPath, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: text }, env());
  }

  it('a new install registers its key once (201), again is 200, and the key then signs in', async () => {
    const fresh = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair;
    const first = await register(fresh);
    expect(first.status).toBe(201);
    const { key_id } = (await first.json()) as { key_id: string };
    expect(key_id).toBe(b64url(await sha256(new Uint8Array(await exportRaw(fresh.publicKey)))));
    expect((await register(fresh)).status).toBe(200);
    const text = JSON.stringify(password());
    const res = await call(`${BASE}/token?grant_type=password`, text, {
      attest: false,
      headers: await attestHeaders(`${BASE}/token?grant_type=password`, text, fresh, key_id),
    });
    expect(res.status).toBe(200);
  });

  it('🔴 a registration signed by a DIFFERENT key (no proof of possession) is 401, and nothing is stored', async () => {
    const claimed = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair;
    const res = await register(claimed, { proofKey: installKey });
    expect(res.status).toBe(401);
    expect(db.count('native_attest_keys')).toBe(2);
  });

  it('🔴 registrations have their own per-network ceiling: the 6th in a minute is 429', async () => {
    installs = new FakeLimiter(5);
    for (let i = 0; i < 5; i++) {
      const k = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair;
      expect((await register(k)).status).toBe(201);
    }
    const k = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair;
    expect((await register(k)).status).toBe(429);
  });

  it('refuses a body whose kind disagrees with the header, and a key that is not 32 bytes', async () => {
    expect((await register(installKey, { body: JSON.stringify({ kind: 'app-attest', key_id: 'x' }) })).status).toBe(400);
    expect((await register(installKey, { body: JSON.stringify({ kind: 'install-key', public_key: 'AAAA' }) })).status).toBe(400);
  });
});

/** Blank `//` and `/* *\/` comments, keeping string and template literals (a URL's
 *  `//` is not a comment). Enough for this one file; not a TypeScript parser. */
function stripComments(src: string): string {
  let out = '';
  for (let i = 0; i < src.length; ) {
    const c = src[i]!;
    const d = src[i + 1];
    if (c === '/' && d === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && d === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      let j = i + 1;
      while (j < src.length && src[j] !== c) j += src[j] === '\\' ? 2 : 1;
      out += src.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}
