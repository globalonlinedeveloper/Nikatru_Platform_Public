// ─────────────────────────────────────────────────────────────────────────────
// sessions.test.ts — GET /v1/sessions, DELETE /v1/sessions/:id,
// POST /v1/sessions/revoke-all and POST /v1/sessions/revoke-others
// (⏱ 2026-09-25 · AUTH-REVOKE-AT-WORKERS, the server half).
//
// WHAT IS BEING PROVEN, and each case is the shape of a way this could be wrong:
//   · 🔴 a session signed out HERE has its current access token refused by the
//     REAL platformAuth on the very next request — the list and the check agree
//     on the key, the record shape and the clock;
//   · 🔴 another account's session id is a 404 that deletes nothing and writes
//     nothing — the RPC's `user_id = p_user` is the only thing between one
//     account and another's sessions, and the fake below enforces it the same way;
//   · the caller's own session is never revoked through the list (409, no RPC);
//   · every failure to reach the RPC is a 503, never an empty list or a guess;
//   · every KV write carries the record's TTL;
//   · SESSIONS_LIMITER fronts all four routes, keyed on the verified subject.
// The RPC is a fake over an in-memory `auth.sessions`; KV is a Map. Nothing here
// reaches a network.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import { SignJWT, exportJWK, generateKeyPair, type JWK, type KeyLike } from 'jose';
import { platformAuth } from '../src/middleware/auth';
import sessions, { SESSIONS_RPC_TIMEOUT_MS, deviceLabel, isoUtc } from '../src/routes/sessions';
import { REVOCATION_TTL_SECONDS } from '../../_shared/src/auth';
import type { AppEnv } from '../src/types';

const SUPABASE_URL = 'https://sessions-test.supabase.co';
const ISSUER = `${SUPABASE_URL}/auth/v1`;
const SERVICE_KEY = 'service-role-key-made-up-for-this-test';

const ME = '11111111-1111-4111-8111-111111111111';
const OTHER_USER = '22222222-2222-4222-8222-222222222222';
const S_MINE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'; // the caller's session
const S_PHONE = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const S_LAPTOP = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const S_THEIRS = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'; // OTHER_USER's session

const CHROME_WIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';
const SAFARI_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1';

let signingKey: KeyLike;
let publicJwk: JWK;

type Row = {
  id: string;
  user_id: string;
  created_at: string;
  refreshed_at: string | null;
  user_agent: string | null;
  aal: string;
  not_after: string | null;
  ip: string;
};

/** The fake database and its switches, reset per harness. */
const db: {
  rows: Row[];
  mode: 'ok' | 'missing' | 'error' | 'throw' | 'not-array';
  anyUser: boolean;
  calls: Array<{ fn: string; body: Record<string, unknown>; headers: Headers; signal: unknown }>;
} = { rows: [], mode: 'ok', anyUser: false, calls: [] };

function seed(): Row[] {
  return [
    { id: S_MINE, user_id: ME, created_at: '2026-09-20T08:00:00.123456+00:00', refreshed_at: '2026-09-25 06:30:00.5', user_agent: CHROME_WIN, aal: 'aal1', not_after: null, ip: '203.0.113.9' },
    { id: S_PHONE, user_id: ME, created_at: '2026-09-21T09:00:00+00:00', refreshed_at: null, user_agent: SAFARI_IPHONE, aal: 'aal1', not_after: null, ip: '198.51.100.7' },
    { id: S_LAPTOP, user_id: ME, created_at: '2026-09-22T10:00:00+00:00', refreshed_at: '2026-09-24T12:00:00', user_agent: null, aal: 'aal1', not_after: null, ip: '192.0.2.1' },
    { id: S_THEIRS, user_id: OTHER_USER, created_at: '2026-09-23T11:00:00+00:00', refreshed_at: null, user_agent: CHROME_WIN, aal: 'aal1', not_after: null, ip: '192.0.2.2' },
  ];
}

/** PostgREST, as far as these two functions go. */
async function fakeRpc(fn: string, init: RequestInit): Promise<Response> {
  const body = JSON.parse(String(init.body)) as Record<string, string>;
  db.calls.push({ fn, body, headers: new Headers(init.headers), signal: init.signal });
  if (db.mode === 'throw') throw new TypeError('Network connection lost');
  if (db.mode === 'missing') {
    return new Response(JSON.stringify({ code: 'PGRST202', message: `Could not find the function public.${fn}` }), { status: 404 });
  }
  if (db.mode === 'error') return new Response('{"message":"boom"}', { status: 500 });
  if (db.mode === 'not-array') return new Response('{"id":"x"}', { status: 200 });
  if (fn === 'nikatru_sessions_of') {
    const mine = db.rows.filter((r) => r.user_id === body.p_user);
    // Exactly the columns the SQL function returns — no ip.
    return Response.json(mine.map(({ id, created_at, refreshed_at, user_agent, aal, not_after }) => ({ id, created_at, refreshed_at, user_agent, aal, not_after })));
  }
  if (fn === 'nikatru_revoke_session') {
    const hit = db.rows.filter((r) => r.id === body.p_session && (db.anyUser || r.user_id === body.p_user));
    db.rows = db.rows.filter((r) => !hit.includes(r));
    return Response.json(hit.map((r) => ({ id: r.id })));
  }
  return new Response('{"code":"PGRST202"}', { status: 404 });
}

beforeAll(async () => {
  const pair = await generateKeyPair('ES256', { extractable: true });
  signingKey = pair.privateKey;
  publicJwk = { ...(await exportJWK(pair.publicKey)), alg: 'ES256', kid: 'sessions-key-1' };
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    if (url === `${ISSUER}/.well-known/jwks.json`) return Response.json({ keys: [publicJwk] });
    const rpc = url.match(/^https:\/\/sessions-test\.supabase\.co\/rest\/v1\/rpc\/([a-z_]+)$/);
    if (rpc) return fakeRpc(rpc[1], init);
    throw new Error(`unexpected fetch in test: ${url}`);
  });
});

afterAll(() => vi.unstubAllGlobals());
afterEach(() => vi.restoreAllMocks());

const nowS = () => Math.floor(Date.now() / 1000);

/** A token for `sub`, issued a few seconds ago, carrying `session_id` if given. */
const token = (sub: string, sessionId?: string) =>
  new SignJWT(sessionId ? { sub, session_id: sessionId } : { sub })
    .setProtectedHeader({ alg: 'ES256', kid: 'sessions-key-1' })
    .setIssuedAt(nowS() - 5)
    .setExpirationTime('1h')
    .setAudience('authenticated')
    .setIssuer(ISSUER)
    .sign(signingKey);

function kvFake({ failPuts = 0 } = {}) {
  const store = new Map<string, string>();
  const puts: Array<{ key: string; value: string; opts: unknown }> = [];
  let failuresLeft = failPuts;
  const kv = {
    get: async (key: string, type?: string) => {
      const raw = store.get(key);
      if (raw === undefined) return null;
      return type === 'json' ? JSON.parse(raw) : raw;
    },
    put: async (key: string, value: string, opts?: unknown) => {
      puts.push({ key, value, opts });
      if (failuresLeft > 0) {
        failuresLeft -= 1;
        throw new Error('KV PUT failed: 503 Service Unavailable');
      }
      store.set(key, value);
    },
  } as unknown as KVNamespace;
  return { kv, store, puts };
}

function harness({
  serviceKey = SERVICE_KEY as string | null,
  failPuts = 0,
  allow = true,
  revokedBound = true,
}: { serviceKey?: string | null; failPuts?: number; allow?: boolean; revokedBound?: boolean } = {}) {
  db.rows = seed();
  db.mode = 'ok';
  db.anyUser = false;
  db.calls = [];
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const revoked = kvFake({ failPuts });
  const limiterKeys: string[] = [];
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => {
    c.set('requestId', 'rid-test');
    await next();
  });
  // Mounted exactly as src/index.ts mounts it.
  app.use('/v1/sessions', platformAuth);
  app.use('/v1/sessions/*', platformAuth);
  app.route('/v1', sessions);
  const env = {
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: serviceKey ?? undefined,
    SESSION_REVOKED: revokedBound ? revoked.kv : undefined,
    SESSIONS_LIMITER: {
      limit: async ({ key }: { key: string }) => {
        limiterKeys.push(key);
        return { success: allow };
      },
    },
    APP_ID: 'platform',
    API_VERSION: 'v1',
  } as unknown as AppEnv['Bindings'];
  const call = (method: string, path: string, authz: string) =>
    app.request(path, { method, headers: { Authorization: authz } }, env);
  const errorLines = () => errors.mock.calls.map((a) => a.map(String).join(' '));
  return { call, revoked, limiterKeys, errorLines };
}

const record = (store: Map<string, string>, sub = ME) => {
  const raw = store.get(`rev:${sub}`);
  return raw === undefined ? undefined : (JSON.parse(raw) as { before: number | null; sids: Array<[string, number]> });
};

describe('GET /v1/sessions', () => {
  it('lists the caller\'s sessions only, marks the current one, ISO UTC dates, a device label, no IP', async () => {
    const h = harness();
    const res = await h.call('GET', '/v1/sessions', `Bearer ${await token(ME, S_MINE)}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { sessions: Array<Record<string, unknown>> };
    expect(body.sessions).toEqual([
      // refreshed_at had NO offset and is read as UTC; newest activity first.
      { id: S_MINE, current: true, createdAt: '2026-09-20T08:00:00.123Z', lastActiveAt: '2026-09-25T06:30:00.500Z', device: 'Chrome on Windows' },
      { id: S_LAPTOP, current: false, createdAt: '2026-09-22T10:00:00.000Z', lastActiveAt: '2026-09-24T12:00:00.000Z', device: 'Unknown device' },
      // refreshed_at null ⇒ lastActiveAt = createdAt.
      { id: S_PHONE, current: false, createdAt: '2026-09-21T09:00:00.000Z', lastActiveAt: '2026-09-21T09:00:00.000Z', device: 'Safari on iPhone' },
    ]);
    expect(JSON.stringify(body)).not.toContain(S_THEIRS);
    expect(JSON.stringify(body)).not.toMatch(/ip|203\.0\.113/);
  });

  it('calls the RPC with the service-role key, the VERIFIED subject and a timeout signal', async () => {
    const h = harness();
    await h.call('GET', '/v1/sessions', `Bearer ${await token(ME, S_MINE)}`);
    expect(db.calls).toHaveLength(1);
    const [c] = db.calls;
    expect(c.fn).toBe('nikatru_sessions_of');
    expect(c.body).toEqual({ p_user: ME });
    expect(c.headers.get('apikey')).toBe(SERVICE_KEY);
    expect(c.headers.get('authorization')).toBe(`Bearer ${SERVICE_KEY}`);
    expect(c.signal).toBeInstanceOf(AbortSignal);
    expect(SESSIONS_RPC_TIMEOUT_MS).toBeGreaterThan(0);
  });

  it.each([
    ['the function is not installed (404 PGRST202)', 'missing', /not installed — apply docs\/platform\/supabase\/sql\/sessions-rpc\.sql/],
    ['the RPC answers 500', 'error', /answered 500/],
    ['the RPC is unreachable', 'throw', /unreachable \(TypeError\)/],
    ['the RPC answers something that is not a list', 'not-array', /not an array/],
  ] as const)('🔴 %s ⇒ 503 sessions_unavailable and one log line, never an empty list', async (_label, mode, why) => {
    const h = harness();
    db.mode = mode;
    const res = await h.call('GET', '/v1/sessions', `Bearer ${await token(ME, S_MINE)}`);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'sessions_unavailable' });
    const lines = h.errorLines().filter((l) => l.includes('sessions_unavailable'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(why);
    expect(lines[0]).not.toContain(ME);
    expect(lines[0]).not.toContain(SERVICE_KEY);
  });

  it('the service-role key unset ⇒ 503 and no RPC call at all', async () => {
    const h = harness({ serviceKey: null });
    const res = await h.call('GET', '/v1/sessions', `Bearer ${await token(ME, S_MINE)}`);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'sessions_unavailable' });
    expect(db.calls).toEqual([]);
  });

  it('no bearer token ⇒ 401 from platformAuth, before the route runs', async () => {
    const h = harness();
    const res = await h.call('GET', '/v1/sessions', '');
    expect(res.status).toBe(401);
    expect(db.calls).toEqual([]);
  });
});

describe('DELETE /v1/sessions/:id', () => {
  it('🔴 signs another of MY sessions out: the row is deleted, the id is listed with the TTL, and its token is refused next', async () => {
    const h = harness();
    const phoneToken = await token(ME, S_PHONE);
    // Control: the phone's token works before the revoke.
    expect((await h.call('GET', '/v1/sessions', `Bearer ${phoneToken}`)).status).toBe(200);

    const res = await h.call('DELETE', `/v1/sessions/${S_PHONE}`, `Bearer ${await token(ME, S_MINE)}`);
    expect(res.status).toBe(204);
    expect(db.rows.map((r) => r.id)).not.toContain(S_PHONE);
    const rec = record(h.revoked.store);
    expect(rec?.before).toBeNull();
    expect(rec?.sids.map(([id]) => id)).toEqual([S_PHONE]);
    expect(Math.abs(rec!.sids[0][1] - nowS())).toBeLessThanOrEqual(2);
    expect(h.revoked.puts.map((p) => p.opts)).toEqual([{ expirationTtl: REVOCATION_TTL_SECONDS }]);

    // The phone's STILL-UNEXPIRED access token is now refused by the real middleware.
    const after = await h.call('GET', '/v1/sessions', `Bearer ${phoneToken}`);
    expect(after.status).toBe(401);
    expect(await after.json()).toEqual({ error: 'unauthorized' });
    // …and the caller's own session is untouched.
    expect((await h.call('GET', '/v1/sessions', `Bearer ${await token(ME, S_MINE)}`)).status).toBe(200);
  });

  it('🔴 ANOTHER account\'s session id ⇒ 404, nothing deleted, nothing written', async () => {
    const h = harness();
    const res = await h.call('DELETE', `/v1/sessions/${S_THEIRS}`, `Bearer ${await token(ME, S_MINE)}`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
    expect(db.rows.map((r) => r.id)).toContain(S_THEIRS);
    expect(db.calls.map((c) => c.body)).toEqual([{ p_user: ME, p_session: S_THEIRS }]);
    expect(h.revoked.puts).toEqual([]);
  });

  it('a well-formed id that matches no session ⇒ 404 and no KV write', async () => {
    const h = harness();
    const res = await h.call('DELETE', '/v1/sessions/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', `Bearer ${await token(ME, S_MINE)}`);
    expect(res.status).toBe(404);
    expect(h.revoked.puts).toEqual([]);
  });

  it('a non-UUID id ⇒ 404 and no RPC', async () => {
    const h = harness();
    const res = await h.call('DELETE', '/v1/sessions/not-a-uuid', `Bearer ${await token(ME, S_MINE)}`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
    expect(db.calls).toEqual([]);
  });

  it('the caller\'s OWN session ⇒ 409 current_session and no RPC', async () => {
    const h = harness();
    const res = await h.call('DELETE', `/v1/sessions/${S_MINE.toUpperCase()}`, `Bearer ${await token(ME, S_MINE)}`);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'current_session' });
    expect(db.calls).toEqual([]);
    expect(h.revoked.puts).toEqual([]);
  });

  it('a KV write that fails ONCE is retried, and the id is listed', async () => {
    const h = harness({ failPuts: 1 });
    const res = await h.call('DELETE', `/v1/sessions/${S_LAPTOP}`, `Bearer ${await token(ME, S_MINE)}`);
    expect(res.status).toBe(204);
    expect(h.revoked.puts).toHaveLength(2);
    expect(record(h.revoked.store)?.sids.map(([id]) => id)).toEqual([S_LAPTOP]);
  });

  it('a KV write that fails TWICE ⇒ still 204 (the session is gone), and one log line without identifiers', async () => {
    const h = harness({ failPuts: 2 });
    const res = await h.call('DELETE', `/v1/sessions/${S_LAPTOP}`, `Bearer ${await token(ME, S_MINE)}`);
    expect(res.status).toBe(204);
    expect(db.rows.map((r) => r.id)).not.toContain(S_LAPTOP);
    const lines = h.errorLines().filter((l) => l.includes('revocation_write_failed'));
    expect(lines).toHaveLength(1);
    for (const l of h.errorLines()) {
      expect(l).not.toContain(ME);
      expect(l).not.toContain(S_LAPTOP);
    }
  });

  it('the RPC not installed ⇒ 503 sessions_unavailable, nothing written', async () => {
    const h = harness();
    db.mode = 'missing';
    const res = await h.call('DELETE', `/v1/sessions/${S_PHONE}`, `Bearer ${await token(ME, S_MINE)}`);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'sessions_unavailable' });
    expect(h.revoked.puts).toEqual([]);
  });
});

describe('POST /v1/sessions/revoke-all', () => {
  it('🔴 refuses every token issued before now — the caller\'s own included — with the TTL', async () => {
    const h = harness();
    const mine = await token(ME, S_MINE);
    const phone = await token(ME, S_PHONE);
    const res = await h.call('POST', '/v1/sessions/revoke-all', `Bearer ${mine}`);
    expect(res.status).toBe(204);
    const rec = record(h.revoked.store);
    expect(Math.abs((rec?.before ?? 0) - nowS())).toBeLessThanOrEqual(2);
    expect(h.revoked.puts.map((p) => p.opts)).toEqual([{ expirationTtl: REVOCATION_TTL_SECONDS }]);
    expect(db.calls).toEqual([]); // no RPC: the client signs the refresh tokens out itself
    expect((await h.call('GET', '/v1/sessions', `Bearer ${mine}`)).status).toBe(401);
    expect((await h.call('GET', '/v1/sessions', `Bearer ${phone}`)).status).toBe(401);
  });

  it('🔴 the KV write fails ⇒ 503 revocation_unavailable, never a 204 that did nothing', async () => {
    const h = harness({ failPuts: 1 });
    const res = await h.call('POST', '/v1/sessions/revoke-all', `Bearer ${await token(ME, S_MINE)}`);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'revocation_unavailable' });
  });

  it('the binding absent ⇒ 503 revocation_unavailable', async () => {
    const h = harness({ revokedBound: false });
    const res = await h.call('POST', '/v1/sessions/revoke-all', `Bearer ${await token(ME, S_MINE)}`);
    expect(res.status).toBe(503);
  });
});

describe('POST /v1/sessions/revoke-others', () => {
  it('🔴 lists every session but the caller\'s; the caller keeps working, the others are refused', async () => {
    const h = harness();
    const mine = await token(ME, S_MINE);
    const res = await h.call('POST', '/v1/sessions/revoke-others', `Bearer ${mine}`);
    expect(res.status).toBe(204);
    const rec = record(h.revoked.store);
    expect(rec?.before).toBeNull();
    expect(rec?.sids.map(([id]) => id).sort()).toEqual([S_PHONE, S_LAPTOP].sort());
    expect(h.revoked.puts.map((p) => p.opts)).toEqual([{ expirationTtl: REVOCATION_TTL_SECONDS }]);
    expect((await h.call('GET', '/v1/sessions', `Bearer ${mine}`)).status).toBe(200);
    expect((await h.call('GET', '/v1/sessions', `Bearer ${await token(ME, S_LAPTOP)}`)).status).toBe(401);
    // Another account is untouched.
    expect(record(h.revoked.store, OTHER_USER)).toBeUndefined();
  });

  it('a token with no session_id ⇒ 409 current_session_unknown and no RPC', async () => {
    const h = harness();
    const res = await h.call('POST', '/v1/sessions/revoke-others', `Bearer ${await token(ME)}`);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'current_session_unknown' });
    expect(db.calls).toEqual([]);
  });

  it('the KV write fails ⇒ 503 revocation_unavailable', async () => {
    const h = harness({ failPuts: 1 });
    const res = await h.call('POST', '/v1/sessions/revoke-others', `Bearer ${await token(ME, S_MINE)}`);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'revocation_unavailable' });
  });

  it('the RPC fails ⇒ 503 sessions_unavailable and nothing written', async () => {
    const h = harness();
    db.mode = 'error';
    const res = await h.call('POST', '/v1/sessions/revoke-others', `Bearer ${await token(ME, S_MINE)}`);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'sessions_unavailable' });
    expect(h.revoked.puts).toEqual([]);
  });
});

describe('SESSIONS_LIMITER fronts all four routes', () => {
  it.each([
    ['GET', '/v1/sessions'],
    ['DELETE', `/v1/sessions/${S_PHONE}`],
    ['POST', '/v1/sessions/revoke-all'],
    ['POST', '/v1/sessions/revoke-others'],
  ])('🔴 %s %s over the limit ⇒ 429 rate_limited, keyed on the verified subject, nothing done', async (method, path) => {
    const h = harness({ allow: false });
    const res = await h.call(method, path, `Bearer ${await token(ME, S_MINE)}`);
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: 'rate_limited' });
    expect(h.limiterKeys).toEqual([`sessions:${ME}`]);
    expect(db.calls).toEqual([]);
    expect(h.revoked.puts).toEqual([]);
  });
});

describe('deviceLabel and isoUtc (pure)', () => {
  it.each([
    [CHROME_WIN, 'Chrome on Windows'],
    [SAFARI_IPHONE, 'Safari on iPhone'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 14.6; rv:130.0) Gecko/20100101 Firefox/130.0', 'Firefox on macOS'],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0', 'Edge on Windows'],
    ['Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36', 'Chrome on Android'],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0 Mobile/15E148 Safari/604.1', 'Chrome on iPhone'],
    ['Dart/3.5 (dart:io)', 'Unknown device'],
    ['', 'Unknown device'],
    [null, 'Unknown device'],
  ])('%s ⇒ %s', (ua, label) => {
    expect(deviceLabel(ua)).toBe(label);
  });

  it('a timestamp with no offset is UTC; an offset is honoured; garbage is null', () => {
    expect(isoUtc('2026-09-25 06:30:00')).toBe('2026-09-25T06:30:00.000Z');
    expect(isoUtc('2026-09-25T06:30:00')).toBe('2026-09-25T06:30:00.000Z');
    expect(isoUtc('2026-09-25T12:00:00+05:30')).toBe('2026-09-25T06:30:00.000Z');
    expect(isoUtc('not a date')).toBeNull();
    expect(isoUtc(null)).toBeNull();
  });
});
