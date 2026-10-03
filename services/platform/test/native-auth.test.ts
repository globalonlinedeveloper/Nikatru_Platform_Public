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
import { REQUEST_ID_SHAPE } from '../src/lib/request-id';
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
import {
  clientDataFor,
  issueChallenge,
  KIND_OPS,
  NATIVE_ATTEST_INSTALLS_PER_NETWORK_PER_DAY,
  NATIVE_ATTEST_OPS_PER_KEY_PER_DAY,
  requestTarget,
  type AttestOp,
} from '../src/lib/native-attest';
import { b64url, sha256 } from '../src/lib/native-attest/bytes';
import { assertionFor, b64std, ecPair, spkiOf, TEAM } from './native-attest-fixtures';
import wranglerRaw from '../wrangler.jsonc?raw';

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

/**
 * The installs every call below attests with. ⏱ 2026-09-30 (review of #1070):
 * the DEFAULT is a real App Attest assertion — the kind that may authorise all
 * four ops — built on a test key (test/native-attest-fixtures.ts). The desktop
 * Ed25519 key is kept for the cases that prove what `install-key` can and
 * cannot do.
 */
let appleKey: CryptoKeyPair;
let appleSpki: Uint8Array;
let appleKeyId: string;
let installKey: CryptoKeyPair;
let installKeyId: string;
beforeAll(async () => {
  appleKey = await ecPair('P-256');
  appleSpki = await spkiOf(appleKey.publicKey);
  appleKeyId = b64std(await sha256(appleSpki.subarray(appleSpki.length - 65)));
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

const CHALLENGE_KEY = 'challenge-key-made-up-for-this-test-0123456789';

let account: FakeLimiter;
let edge: FakeLimiter;
let unattested: FakeLimiter;
let installs: FakeLimiter;
let db: RealDb;
/** The App Attest assertion counter per app: it must rise on every op. */
let counters: Map<string, number>;
beforeEach(async () => {
  db = realPlatformDb();
  counters = new Map();
  // Both installs' keys, registered for both apps the suite serves — the
  // registration route itself is proven in its own block below.
  const pk = b64url(new Uint8Array(await exportRaw(installKey.publicKey)));
  for (const a of [APP, 'budgetbuddy']) {
    const ins = db.db.prepare(
      'INSERT INTO native_attest_keys (app_id, key_id, kind, public_key, sign_count, created_at, last_used_at) VALUES (?, ?, ?, ?, 0, ?, ?)',
    );
    ins.run(a, appleKeyId, 'app-attest', b64url(appleSpki), '2026-09-29T00:00:00.000Z', '2026-09-29T00:00:00.000Z');
    ins.run(a, installKeyId, 'install-key', pk, '2026-09-29T00:00:00.000Z', '2026-09-29T00:00:00.000Z');
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
  // tighter ceilings are proven on their own in the ST-A block.
  unattested = new FakeLimiter(1000);
  installs = new FakeLimiter(1000);
});
afterEach(() => vi.restoreAllMocks());

// ⏱ 2026-09-30: every call now mints a signed challenge and signs a real App
// Attest assertion, and the busiest cases make eighteen calls — measured at
// 3-5 s on a loaded runner against vitest's 5 s default. The budget is per
// case and generous on purpose; a HANG still fails, a slow runner does not.
vi.setConfig({ testTimeout: 30_000 });

function env(over: Partial<AppEnv['Bindings']> = {}): AppEnv['Bindings'] {
  return {
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
    ALLOWED_ORIGINS: 'https://nikatru.com',
    NATIVE_AUTH_ACCOUNT_LIMITER: account,
    NATIVE_AUTH_EDGE_LIMITER: edge,
    NATIVE_AUTH_UNATTESTED_LIMITER: unattested,
    NATIVE_AUTH_INSTALL_LIMITER: installs,
    // TEST ONLY: `install-key` is listed here so the cases below can prove what
    // it may and may not do when listed. No deploy lists it (the config case).
    NATIVE_AUTH_ATTEST_KINDS: 'app-attest,install-key',
    NATIVE_ATTEST_CHALLENGE_KEY: CHALLENGE_KEY,
    APP_ATTEST_TEAM_ID: TEAM,
    PLATFORM_DB: db,
    ...over,
  } as AppEnv['Bindings'];
}

type Signer = { kind: 'app-attest' } | { kind: 'install-key'; key?: CryptoKeyPair; keyId?: string };

/**
 * The four attestation headers for `path` and `text`, as the app's attesting
 * client sends them: a fresh challenge, and a proof over the binding of THIS
 * app, op, challenge, path + query and body — an App Attest assertion with a
 * rising counter by default, or the install key's Ed25519 signature.
 */
async function attestHeaders(path: string, text: string, signer: Signer = { kind: 'app-attest' }, at = Date.now()): Promise<Record<string, string>> {
  const url = new URL(path, 'https://x.example');
  const [, , , , app, ...rest] = url.pathname.split('/');
  const op = (rest[0] === 'attest' ? 'install' : rest[0]) as AttestOp;
  const challenge = await issueChallenge(env(), app!, at);
  const clientData = await clientDataFor(app!, op, challenge, requestTarget(url), new TextEncoder().encode(text));
  if (signer.kind === 'app-attest') {
    const n = (counters.get(app!) ?? 0) + 1;
    counters.set(app!, n);
    const assertion = await assertionFor(appleKey.privateKey, clientData, n, `${TEAM}.com.nikatru.${app}`);
    return {
      'X-NK-Attest-Kind': 'app-attest',
      'X-NK-Attest-Challenge': challenge,
      'X-NK-Attest-Key': appleKeyId,
      'X-NK-Attest-Proof': b64url(assertion),
    };
  }
  const key = signer.key ?? installKey;
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, key.privateKey, new TextEncoder().encode(clientData)));
  return {
    'X-NK-Attest-Kind': 'install-key',
    'X-NK-Attest-Challenge': challenge,
    'X-NK-Attest-Key': signer.keyId ?? installKeyId,
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
    signer,
  }: { headers?: Record<string, string>; bindings?: Partial<AppEnv['Bindings']>; via?: Hono<AppEnv>; attest?: boolean; signer?: Signer } = {},
) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  const proof = attest ? await attestHeaders(path, text, signer) : {};
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

  it('🔴 forwards the request id this Worker accepted or minted, never the caller\'s raw x-request-id (review of #1152, nit 4)', async () => {
    const lines: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => void lines.push(a.join(' ')));
    try {
      await call(`${BASE}/token?grant_type=password`, password(), { headers: { 'X-Request-Id': 'a@b.c' } });
    } finally {
      spy.mockRestore();
    }
    const sent = gotrue.seen[0]!.headers.get('x-request-id');
    expect(sent).not.toBe('a@b.c');
    expect(sent).toMatch(REQUEST_ID_SHAPE);
    // The id GoTrue logs is the one our own line carries as rid=.
    expect(lines.some((l) => l.includes(`rid=${sent}`)), lines.join('\n')).toBe(true);
  });

  it('forwards the incoming headers as they arrived, minus the caller\'s credentials, cookie, referer, address claims and attestation', async () => {
    await call(`${BASE}/token?grant_type=password`, password(), {
      headers: {
        Cookie: 'sb-access-token=stolen',
        Referer: 'https://elsewhere.example/landing',
        'X-Request-Id': 'rid-1',
        // ⏱ 2026-09-30 (review of #1070): the two caller-writable address
        // claims are DROPPED; the only address GoTrue sees is the one Cloudflare
        // stamps, which passes through as it arrived and is never read here.
        'X-Real-IP': '203.0.113.7',
        'X-Forwarded-For': '198.51.100.9, 203.0.113.7',
        'CF-Connecting-IP': '203.0.113.7',
      },
    });
    const h = gotrue.seen[0]!.headers;
    expect(h.get('x-real-ip')).toBeNull();
    expect(h.get('x-forwarded-for')).toBeNull();
    expect(h.get('cf-connecting-ip')).toBe('203.0.113.7');
    for (const a of ['x-nk-attest-kind', 'x-nk-attest-challenge', 'x-nk-attest-key', 'x-nk-attest-proof']) expect(h.get(a), a).toBeNull();
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
    // ⏱ 2026-09-30 (review of #1070): the route forwards an ALLOWLIST, so the
    // caller-writable address claims are dropped without the source naming them —
    // and Cloudflare's own connecting address passes as a `cf-` header, unnamed too.
    expect(code).toContain('const GOTRUE_BOUND_HEADERS = new Set([');
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

  it('🔴 BLOCKER 1 · install-key may NOT sign up, reset or resend — 403 even with the kind listed, before any config, challenge or crypto', async () => {
    expect([...KIND_OPS['install-key']].sort()).toEqual(['install', 'token']);
    for (const [path, body] of [
      [`${BASE}/signup`, { email: 'bot@example.test', password: 'pw' }],
      [`${BASE}/recover`, { email: 'bot@example.test' }],
      [`${BASE}/resend`, { email: 'bot@example.test', type: 'signup' }],
    ] as const) {
      for (const kinds of ['install-key', 'app-attest,install-key,play-integrity']) {
        const res = await call(path, body, { signer: { kind: 'install-key' }, bindings: { NATIVE_AUTH_ATTEST_KINDS: kinds } });
        expect(res.status, `${path} ${kinds}`).toBe(403);
        expect(await errorCode(res)).toBe('attestation_kind_refused');
      }
    }
    expect(gotrue.seen).toHaveLength(0);
    expect(account.keys).toHaveLength(0);
    // The attested kind still may.
    expect((await call(`${BASE}/signup`, { email: 'person@example.test', password: 'pw' })).status).toBe(200);
  });

  it('🔴 BLOCKER 1 · no deploy lists install-key: production lists only server-verified kinds, the sandbox none', () => {
    const listed = [...wranglerRaw.matchAll(/"NATIVE_AUTH_ATTEST_KINDS":\s*"([^"]*)"/g)].map((m) => m[1]);
    expect(listed).toEqual(['app-attest,play-integrity', '']);
    for (const v of listed) expect(v).not.toContain('install-key');
  });

  it('🔴 SECOND REVIEW nit 10 · production never accepts App Attest DEVELOPMENT keys: only the sandbox block sets the flag', () => {
    const at = [...wranglerRaw.matchAll(/"APP_ATTEST_ALLOW_DEVELOPMENT"/g)].map((m) => m.index!);
    expect(at).toHaveLength(1);
    const sandbox = wranglerRaw.indexOf('"sandbox": {');
    expect(sandbox).toBeGreaterThan(0);
    expect(at[0]!, 'the one occurrence sits inside env.sandbox, after the top-level vars').toBeGreaterThan(sandbox);
  });

  it('🔴 SECOND REVIEW nit 9 · a key stops at its daily call budget; another key still passes', async () => {
    const day = new Date().toISOString().slice(0, 10);
    db.db.prepare('INSERT INTO native_attest_counters (day, scope, calls) VALUES (?, ?, ?)').run(day, `key:${APP}:${appleKeyId}`, NATIVE_ATTEST_OPS_PER_KEY_PER_DAY);
    const capped = await call(`${BASE}/token?grant_type=password`, password());
    expect(capped.status).toBe(429);
    expect(await errorCode(capped)).toBe('over_request_rate_limit');
    expect(Number(capped.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(gotrue.seen).toHaveLength(0);
    const other = await call(`${BASE}/token?grant_type=password`, password(), { signer: { kind: 'install-key' } });
    expect(other.status).toBe(200);
  });

  it('SECOND REVIEW nit 11 · an unconfigured kind is reported ONCE per isolate, not per request', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const text = JSON.stringify(password());
    const path = `${BASE}/token?grant_type=password`;
    for (let i = 0; i < 3; i++) {
      const headers = { ...(await attestHeaders(path, text)), 'X-NK-Attest-Kind': 'play-integrity' };
      expect((await call(path, text, { attest: false, headers, bindings: { NATIVE_AUTH_ATTEST_KINDS: 'play-integrity' } })).status).toBe(503);
    }
    expect(err.mock.calls.filter((a) => String(a[0]).includes('play-integrity is enabled but not configured')).length).toBeLessThanOrEqual(1);
  });

  it('a genuine App Attest assertion passes every op, and moves the key\'s counter and last use', async () => {
    expect((await call(`${BASE}/token?grant_type=password`, password())).status).toBe(200);
    expect((await call(`${BASE}/recover`, { email: 'a@example.test' })).status).toBe(200);
    const row = db.rows('SELECT sign_count, last_used_at FROM native_attest_keys WHERE app_id = ? AND key_id = ?', APP, appleKeyId)[0];
    expect(row!.sign_count).toBe(2);
    expect(String(row!.last_used_at) > '2026-09-29T00:00:00.000Z').toBe(true);
  });

  it('a genuine install-key signature passes the password grant (the one op it may authorise when listed)', async () => {
    const res = await call(`${BASE}/token?grant_type=password`, password(), { signer: { kind: 'install-key' } });
    expect(res.status).toBe(200);
  });

  it('🔴 a REPLAYED request — same challenge, same proof, same body — is 401 the second time', async () => {
    const text = JSON.stringify(password());
    const headers = await attestHeaders(`${BASE}/token?grant_type=password`, text);
    const first = await call(`${BASE}/token?grant_type=password`, text, { attest: false, headers });
    expect(first.status).toBe(200);
    const replay = await call(`${BASE}/token?grant_type=password`, text, { attest: false, headers });
    expect(replay.status).toBe(401);
    expect(await errorCode(replay)).toBe('attestation_challenge_invalid');
    expect(gotrue.seen).toHaveLength(1);
  });

  it('🔴 a proof over a DIFFERENT body, or a DIFFERENT query, is 401 — it covers the exact bytes, the path and the query', async () => {
    const headers = await attestHeaders(`${BASE}/token?grant_type=password`, JSON.stringify(password('victim@example.test')));
    const res = await call(`${BASE}/token?grant_type=password`, password('other@example.test'), { attest: false, headers });
    expect(res.status).toBe(401);
    expect(await errorCode(res)).toBe('attestation_invalid');

    const own = encodeURIComponent(`${OWN}?nk_auth=reset`);
    const other = encodeURIComponent(`${OWN}?nk_auth=confirm`);
    const text = JSON.stringify({ email: 'a@example.test' });
    const forOwn = await attestHeaders(`${BASE}/recover?redirect_to=${own}`, text);
    const moved = await call(`${BASE}/recover?redirect_to=${other}`, text, { attest: false, headers: forOwn });
    expect(moved.status).toBe(401);
    expect(await errorCode(moved)).toBe('attestation_invalid');
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

  it('🔴 an expired challenge, a forged challenge, an unregistered key and a forged key id are each refused', async () => {
    const text = JSON.stringify(password());
    const path = `${BASE}/token?grant_type=password`;
    const stale = await attestHeaders(path, text, { kind: 'app-attest' }, Date.now() - 10 * 60_000);
    expect(await errorCode(await call(path, text, { attest: false, headers: stale }))).toBe('attestation_challenge_invalid');

    // Well-formed, but its MAC is not this server's.
    const genuine = await attestHeaders(path, text);
    const forged = { ...genuine, 'X-NK-Attest-Challenge': genuine['X-NK-Attest-Challenge']!.replace(/\.[A-Za-z0-9_-]{43}$/, `.${'A'.repeat(43)}`) };
    expect(await errorCode(await call(path, text, { attest: false, headers: forged }))).toBe('attestation_challenge_invalid');
    // A challenge minted under ANOTHER key is not this server's either.
    const otherKey = await attestHeaders(path, text);
    const rekeyed = await call(path, text, { attest: false, headers: otherKey, bindings: { NATIVE_ATTEST_CHALLENGE_KEY: 'a-different-challenge-key-0123456789abcdef' } });
    expect(await errorCode(rekeyed)).toBe('attestation_challenge_invalid');

    const stranger = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair;
    const strangerId = b64url(await sha256(new Uint8Array(await exportRaw(stranger.publicKey))));
    const unknown = await call(path, text, { signer: { kind: 'install-key', key: stranger, keyId: strangerId } });
    expect(unknown.status).toBe(401);
    expect(await errorCode(unknown)).toBe('attestation_key_unknown');
    const forgedKey = await call(path, text, { signer: { kind: 'install-key', key: stranger, keyId: installKeyId } });
    expect(await errorCode(forgedKey)).toBe('attestation_invalid');
    expect(gotrue.seen).toHaveLength(0);
  });

  it('🔴 THE FLAG: a kind this deploy does not list is 403, and a deploy that lists none refuses everything, challenges included', async () => {
    const onlyApple = await call(`${BASE}/token?grant_type=password`, password(), {
      signer: { kind: 'install-key' },
      bindings: { NATIVE_AUTH_ATTEST_KINDS: 'app-attest' },
    });
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

  it('🔴 a listed kind whose server config is missing is 503 — no Play key, no team id, no challenge key — never a pass', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const text = JSON.stringify(password());
    const path = `${BASE}/token?grant_type=password`;
    for (const [kind, bindings] of [
      ['play-integrity', { NATIVE_AUTH_ATTEST_KINDS: 'play-integrity' }],
      ['app-attest', { APP_ATTEST_TEAM_ID: undefined }],
      ['app-attest', { NATIVE_ATTEST_CHALLENGE_KEY: undefined }],
      ['app-attest', { NATIVE_ATTEST_CHALLENGE_KEY: 'too-short' }],
    ] as const) {
      const headers = { ...(await attestHeaders(path, text)), 'X-NK-Attest-Kind': kind };
      const res = await call(path, text, { attest: false, headers, bindings });
      expect(res.status, `${kind} ${JSON.stringify(bindings)}`).toBe(503);
      expect(await errorCode(res)).toBe('native_auth_unavailable');
    }
    const ch = await app.request(`${BASE}/attest/challenge`, { method: 'POST', body: '{}' }, env({ NATIVE_ATTEST_CHALLENGE_KEY: undefined }));
    expect(ch.status).toBe(503);
    expect(gotrue.seen).toHaveLength(0);
  });

  it('🔴 the UNATTESTED kind has its own, tighter per-network ceiling; over it is 429, and absent it is 503', async () => {
    unattested = new FakeLimiter(10);
    for (let i = 0; i < 10; i++) {
      expect((await call(`${BASE}/token?grant_type=password`, password(`p${i}@example.test`), { signer: { kind: 'install-key' } })).status, `call ${i}`).toBe(200);
    }
    const over = await call(`${BASE}/token?grant_type=password`, password('p10@example.test'), { signer: { kind: 'install-key' } });
    expect(over.status).toBe(429);
    expect(new Set(unattested.keys)).toEqual(new Set(['edge:-:-']));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const unbound = await call(`${BASE}/token?grant_type=password`, password('x@example.test'), {
      signer: { kind: 'install-key' },
      bindings: { NATIVE_AUTH_UNATTESTED_LIMITER: undefined },
    });
    expect(unbound.status).toBe(503);
    expect(gotrue.seen).toHaveLength(10);
  });

  it('🔴 NO SESSION BEFORE EMAIL VERIFICATION on the unattested kind: an unconfirmed password grant is 403 and its session withheld', async () => {
    gotrue.answer = answerJson(200, { ...SESSION, user: { id: 'new', email_confirmed_at: null } });
    const token = await call(`${BASE}/token?grant_type=password`, password('new@example.test'), { signer: { kind: 'install-key' } });
    expect(token.status).toBe(403);
    expect(await errorCode(token)).toBe('email_not_confirmed');
    // The attested kind is GoTrue's own answer, verbatim.
    const attested = await call(`${BASE}/token?grant_type=password`, password('new2@example.test'));
    expect(attested.status).toBe(200);
  });

  it('🔴 REVIEW FINDING 2 · challenges are STATELESS: issuing 25 writes no row anywhere; redeeming writes one nonce, pruned once expired', async () => {
    const tables = db.rows("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").map((r) => String(r.name));
    const total = () => tables.reduce((n, t) => n + db.count(t), 0);
    const before = total();
    const minted: string[] = [];
    for (let i = 0; i < 25; i++) {
      const res = await app.request(`${BASE}/attest/challenge`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }, env());
      expect(res.status).toBe(200);
      const { challenge, expires_in } = (await res.json()) as { challenge: string; expires_in: number };
      expect(challenge).toMatch(/^c1\.subscriptiontracker\.\d{10}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}$/);
      expect(expires_in).toBe(120);
      minted.push(challenge);
    }
    expect(new Set(minted).size).toBe(25);
    expect(total(), 'issuing a challenge writes nothing').toBe(before);
    expect(edge.keys).toHaveLength(25);

    // A redemption writes exactly one nonce row, after deleting the expired ones.
    db.db.prepare('INSERT INTO native_attest_redeemed (nonce, app_id, expires_at) VALUES (?, ?, ?)').run('n-expired', APP, '2020-01-01T00:00:00.000Z');
    expect((await call(`${BASE}/token?grant_type=password`, password())).status).toBe(200);
    expect(db.rows('SELECT nonce FROM native_attest_redeemed').map((r) => r.nonce)).not.toContain('n-expired');
    expect(db.count('native_attest_redeemed')).toBe(1);

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
    const headers = await attestHeaders(installPath, text, { kind: 'install-key', key: over.proofKey ?? key, keyId: 'unused' });
    delete (headers as Record<string, string | undefined>)['X-NK-Attest-Key'];
    return app.request(installPath, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: text }, env());
  }
  const fresh = async () => (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair;

  it('a new install registers its key once (201), again is 200, and the key then signs the password grant', async () => {
    const k = await fresh();
    const first = await register(k);
    expect(first.status).toBe(201);
    const { key_id } = (await first.json()) as { key_id: string };
    expect(key_id).toBe(b64url(await sha256(new Uint8Array(await exportRaw(k.publicKey)))));
    expect((await register(k)).status).toBe(200);
    const res = await call(`${BASE}/token?grant_type=password`, password(), { signer: { kind: 'install-key', key: k, keyId: key_id } });
    expect(res.status).toBe(200);
  });

  it('🔴 a registration signed by a DIFFERENT key (no proof of possession) is 401, and nothing is stored', async () => {
    const res = await register(await fresh(), { proofKey: installKey });
    expect(res.status).toBe(401);
    expect(db.count('native_attest_keys')).toBe(4);
  });

  it('🔴 registrations have their own per-network ceiling: the 6th in a minute is 429', async () => {
    installs = new FakeLimiter(5);
    for (let i = 0; i < 5; i++) expect((await register(await fresh())).status).toBe(201);
    expect((await register(await fresh())).status).toBe(429);
  });

  it('🔴 REVIEW FINDING 2 · a network\'s registrations are capped per UTC day, and a registration prunes long-idle keys first', async () => {
    const day = new Date().toISOString().slice(0, 10);
    db.db.prepare('INSERT INTO native_attest_keys (app_id, key_id, kind, public_key, sign_count, created_at, last_used_at) VALUES (?, ?, ?, ?, 0, ?, ?)')
      .run(APP, 'k-idle', 'install-key', 'pk', '2020-01-01T00:00:00.000Z', '2020-01-01T00:00:00.000Z');
    expect((await register(await fresh())).status).toBe(201);
    expect(db.count('native_attest_keys', 'key_id = ?', 'k-idle'), 'the idle key was pruned by the write').toBe(0);
    db.db.prepare('UPDATE native_attest_counters SET calls = ? WHERE day = ? AND scope = ?').run(NATIVE_ATTEST_INSTALLS_PER_NETWORK_PER_DAY, day, 'install:edge:-:-');
    const capped = await register(await fresh());
    expect(capped.status).toBe(429);
    expect(capped.headers.get('retry-after')).toBe('86400');
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
