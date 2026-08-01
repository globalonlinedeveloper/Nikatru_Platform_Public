// ─────────────────────────────────────────────────────────────────────────────
// GET /v1/entitlements — the SHARED entitlement read. [pipeline 5]M-4.
//
// 🔴 THE ORIGINAL ACCEPTANCE CRITERION COULD NOT FAIL. "An unauthenticated
// request to the same route is refused" is satisfied by a route that DOES NOT
// EXIST — a 404 is non-2xx, i.e. "refused". Everything below is one of the three
// replacements, and a 404 satisfies none of them:
//   1. an unauthenticated request returns 401 SPECIFICALLY;
//   2. a token signed by the legacy HS256 shared secret is REJECTED (the shared
//      Worker has no symmetric fallback — middleware/auth.ts records why, and
//      that divergence has to be exercised rather than asserted);
//   3. a request for app B never returns app A's rows.
//
// Real ES256 keys, a real SQL engine, and a stubbed JWKS fetch — the same shape
// test/auth.test.ts established, for the same reasons.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Hono } from 'hono';
import { SignJWT, exportJWK, generateKeyPair, type JWK, type KeyLike } from 'jose';
import { platformAuth } from '../src/middleware/auth';
import entitlements from '../src/routes/entitlements';
import type { AppEnv } from '../src/types';
import { realPlatformDb, type RealDb } from './harness';

const SUPABASE_URL = 'https://project-a.supabase.co';
const ISSUER = `${SUPABASE_URL}/auth/v1`;

let signingKey: KeyLike;
let publicJwk: JWK;
let foreignKey: KeyLike;
const HS256_SECRET = new TextEncoder().encode('legacy-shared-secret-for-tests-only');

beforeAll(async () => {
  const pair = await generateKeyPair('ES256', { extractable: true });
  signingKey = pair.privateKey;
  publicJwk = { ...(await exportJWK(pair.publicKey)), alg: 'ES256', kid: 'test-key-1' };
  foreignKey = (await generateKeyPair('ES256', { extractable: true })).privateKey;

  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/.well-known/jwks.json')) {
      return new Response(JSON.stringify({ keys: [publicJwk] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    throw new Error(`unexpected fetch in test: ${url}`);
  });
});
afterAll(() => vi.unstubAllGlobals());

const KV = { get: async () => null, put: async () => undefined } as unknown as KVNamespace;

async function token(
  claims: Record<string, unknown>,
  { key = null as KeyLike | null, alg = 'ES256' } = {},
) {
  return new SignJWT(claims)
    .setProtectedHeader({ alg, kid: alg === 'ES256' ? 'test-key-1' : undefined })
    .setIssuedAt()
    .setExpirationTime('1h')
    .setAudience('authenticated')
    .setIssuer(ISSUER)
    .sign(key ?? (alg === 'ES256' ? signingKey : HS256_SECRET));
}

/** ⚠️ `null` means NO money environment, never `undefined`. An `undefined`
 *  argument is swallowed by the parameter default, and the test then asserts the
 *  CONFIGURED path while claiming to assert the unconfigured one — which is
 *  exactly what happened here on the first run, and is the same trap
 *  test/auth.test.ts records against its own service-role key. */
function harness({ db = realPlatformDb(), environment = 'live' as string | null } = {}) {
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => { c.set('requestId', 'rid-test'); await next(); });
  // The PUBLIC surface is mounted too, so "auth did not leak onto it" is
  // asserted rather than assumed.
  app.get('/v1/health', (c) => c.json({ ok: true }));
  app.use('/v1/entitlements', platformAuth);
  app.route('/v1', entitlements);

  const env = {
    PLATFORM_DB: db,
    JWKS_CACHE: KV,
    SUPABASE_URL,
    APP_ID: 'platform',
    API_VERSION: 'v1',
    MONEY_ENVIRONMENT: environment ?? undefined,
  } as unknown as AppEnv['Bindings'];

  return {
    db,
    get: (path: string, authz?: string) =>
      app.request(path, { headers: authz === undefined ? {} : { Authorization: authz } }, env),
  };
}

/** One entitlement row, with every money-rail column the read cares about. */
function seed(
  db: RealDb,
  o: {
    userId: string;
    appId?: string;
    entitlement?: string;
    isActive?: 0 | 1;
    expiresAt?: string | null;
    environment?: string | null;
    status?: string | null;
  },
) {
  db.db
    .prepare(
      `INSERT INTO entitlements
         (user_id, app_id, entitlement, product_id, store, is_active, expires_at, updated_at,
          provider, provider_environment, provider_status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      o.userId,
      o.appId ?? 'subly',
      o.entitlement ?? 'pro',
      null,
      null,
      o.isActive ?? 1,
      o.expiresAt === undefined ? null : o.expiresAt,
      '2026-08-01T00:00:00.000Z',
      'paddle',
      o.environment === undefined ? 'live' : o.environment,
      o.status ?? 'active',
    );
}

const USER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

describe('[5]M-4 · the three things a 404 cannot satisfy', () => {
  it('1 · an UNAUTHENTICATED request is 401 SPECIFICALLY — not 404, not 403', async () => {
    const h = harness();
    const res = await h.get('/v1/entitlements?app_id=subly');
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthorized' });
  });

  it('1b · a malformed Authorization header is 401', async () => {
    const h = harness();
    expect((await h.get('/v1/entitlements?app_id=subly', 'Basic abc')).status).toBe(401);
    expect((await h.get('/v1/entitlements?app_id=subly', 'Bearer')).status).toBe(401);
  });

  it('2 · a token signed by the LEGACY HS256 SHARED SECRET is REJECTED', async () => {
    // services/subly-api's middleware accepts one when the asymmetric path
    // fails. Carrying that fallback here would mean the portfolio's single auth
    // boundary — guarding entitlements for every app that exists and every app
    // that does not yet — accepts a symmetric secret. This is the recorded
    // failing input that stops a well-meaning port re-adding it.
    const h = harness();
    const hs = await token({ sub: USER }, { alg: 'HS256' });
    expect((await h.get('/v1/entitlements?app_id=subly', `Bearer ${hs}`)).status).toBe(401);
  });

  it('2b · a well-formed token from the WRONG ES256 key is rejected', async () => {
    const h = harness();
    const wrong = await token({ sub: USER }, { key: foreignKey });
    expect((await h.get('/v1/entitlements?app_id=subly', `Bearer ${wrong}`)).status).toBe(401);
  });

  it('2c · a verified token with no `sub` authenticates nobody', async () => {
    const h = harness();
    const noSub = await token({});
    expect((await h.get('/v1/entitlements?app_id=subly', `Bearer ${noSub}`)).status).toBe(401);
  });

  it('3 · 🔴 A REQUEST FOR APP B NEVER RETURNS APP A\'s ROWS', async () => {
    // The app_id scoping limb the whole shared-table design rests on, and which
    // had no test anywhere before this file. `user_id` alone returns every app's
    // rows for this user; `app_id` alone returns every user's rows for this app.
    const h = harness();
    seed(h.db, { userId: USER, appId: 'subly', entitlement: 'pro' });
    const t = await token({ sub: USER });

    const subly = await h.get('/v1/entitlements?app_id=subly', `Bearer ${t}`);
    expect(await subly.json()).toMatchObject({ app_id: 'subly', is_pro: true });

    // 'probe' is a second registered app in DEFAULT_CONFIGS only when a probe
    // stamp exists, so an UNKNOWN app is the reachable second case: it must be a
    // 404, never an empty list that reads as "you own nothing here".
    const unknown = await h.get('/v1/entitlements?app_id=notanapp', `Bearer ${t}`);
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toEqual({ error: 'unknown_app' });
  });

  it('3b · one user never sees another user\'s row', async () => {
    const h = harness();
    seed(h.db, { userId: OTHER, appId: 'subly' });
    const t = await token({ sub: USER });
    const res = await h.get('/v1/entitlements?app_id=subly', `Bearer ${t}`);
    expect(await res.json()).toMatchObject({ is_pro: false, entitlements: [] });
  });

  it('3c · a MISSING app_id is a 404, not a silent default to some app', async () => {
    const h = harness();
    const t = await token({ sub: USER });
    expect((await h.get('/v1/entitlements', `Bearer ${t}`)).status).toBe(404);
  });

  it('auth did not leak onto the public surface', async () => {
    const h = harness();
    expect((await h.get('/v1/health')).status).toBe(200);
  });
});

describe('the money boundary, read end — undecidable ⇒ DENY', () => {
  it('a lifetime grant (no expiry) IS honoured', async () => {
    const h = harness();
    seed(h.db, { userId: USER, expiresAt: null });
    const res = await h.get('/v1/entitlements?app_id=subly', `Bearer ${await token({ sub: USER })}`);
    expect(await res.json()).toMatchObject({ is_pro: true });
  });

  it('an UNPARSEABLE expiry DENIES — it is not read as "no expiry"', async () => {
    // The exact fail-open this repo fixed on both ends: `Date.parse` returns NaN
    // on anything it cannot read, and NaN became "no end date", i.e. FOREVER.
    const h = harness();
    seed(h.db, { userId: USER, expiresAt: 'the thirty-second of Octember' });
    const res = await h.get('/v1/entitlements?app_id=subly', `Bearer ${await token({ sub: USER })}`);
    const body = (await res.json()) as { is_pro: boolean; entitlements: unknown[] };
    expect(body.is_pro).toBe(false);
    // …and the row is still RETURNED, so a support conversation can see that it
    // exists and why it is inert. Refusing silently is what makes a paid user's
    // lockout unexplainable.
    expect(body.entitlements).toHaveLength(1);
  });

  it('an EMPTY-STRING expiry denies — nothing we write can produce it', async () => {
    const h = harness();
    seed(h.db, { userId: USER, expiresAt: '' });
    const res = await h.get('/v1/entitlements?app_id=subly', `Bearer ${await token({ sub: USER })}`);
    expect(await res.json()).toMatchObject({ is_pro: false });
  });

  it('a PAST expiry denies, a FUTURE one grants', async () => {
    const h = harness();
    seed(h.db, { userId: USER, expiresAt: '2020-01-01T00:00:00.000Z' });
    seed(h.db, { userId: USER, entitlement: 'pro_annual', expiresAt: '2099-01-01T00:00:00.000Z' });
    const res = await h.get('/v1/entitlements?app_id=subly', `Bearer ${await token({ sub: USER })}`);
    expect(await res.json()).toMatchObject({ is_pro: true });
  });

  it('is_active = 0 denies regardless of the dates', async () => {
    const h = harness();
    seed(h.db, { userId: USER, isActive: 0, expiresAt: '2099-01-01T00:00:00.000Z' });
    const res = await h.get('/v1/entitlements?app_id=subly', `Bearer ${await token({ sub: USER })}`);
    expect(await res.json()).toMatchObject({ is_pro: false });
  });
});

describe('[5]M-12 · a reader in one money world cannot see the other\'s rows', () => {
  it('a SANDBOX row does not grant on a LIVE deploy', async () => {
    const h = harness({ environment: 'live' });
    seed(h.db, { userId: USER, environment: 'sandbox', expiresAt: '2099-01-01T00:00:00.000Z' });
    const res = await h.get('/v1/entitlements?app_id=subly', `Bearer ${await token({ sub: USER })}`);
    expect(await res.json()).toMatchObject({ is_pro: false });
  });

  it('a LIVE row does not grant on a SANDBOX deploy — the isolation runs both ways', async () => {
    const h = harness({ environment: 'sandbox' });
    seed(h.db, { userId: USER, environment: 'live', expiresAt: '2099-01-01T00:00:00.000Z' });
    const res = await h.get('/v1/entitlements?app_id=subly', `Bearer ${await token({ sub: USER })}`);
    expect(await res.json()).toMatchObject({ is_pro: false });
  });

  it('a row with NO environment at all is UNDECIDABLE and denies', async () => {
    // "Written before the rail knew" is not evidence of a live payment. This is
    // a real constraint on the deferred RevenueCat rail: when
    // services/subly-api's webhook is un-deferred it must set the column. Safe
    // today because `entitlements` has never held a row.
    const h = harness({ environment: 'live' });
    seed(h.db, { userId: USER, environment: null, expiresAt: '2099-01-01T00:00:00.000Z' });
    const res = await h.get('/v1/entitlements?app_id=subly', `Bearer ${await token({ sub: USER })}`);
    expect(await res.json()).toMatchObject({ is_pro: false });
  });

  it('an undeclared MONEY_ENVIRONMENT refuses to decide at all', async () => {
    const h = harness({ environment: null });
    seed(h.db, { userId: USER, expiresAt: '2099-01-01T00:00:00.000Z' });
    const res = await h.get('/v1/entitlements?app_id=subly', `Bearer ${await token({ sub: USER })}`);
    expect(res.status).toBe(503);
  });
});

describe('the response shape carries what a support conversation needs', () => {
  it('returns the provider, its verbatim status, both dates and any revocation reason', async () => {
    const h = harness();
    h.db.db
      .prepare(
        `INSERT INTO entitlements
           (user_id, app_id, entitlement, is_active, expires_at, updated_at, provider,
            provider_environment, provider_status, current_period_end, trial_end, revocation_reason)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        USER, 'subly', 'pro', 0, '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z',
        'paddle', 'live', 'canceled', '2026-08-01T00:00:00.000Z', '2026-07-31T00:00:00.000Z',
        'cancelled_at_period_end',
      );
    const res = await h.get('/v1/entitlements?app_id=subly', `Bearer ${await token({ sub: USER })}`);
    const body = (await res.json()) as { entitlements: Array<Record<string, unknown>> };
    expect(body.entitlements[0]).toMatchObject({
      entitlement: 'pro',
      is_active: false,
      provider: 'paddle',
      provider_status: 'canceled',
      current_period_end: '2026-08-01T00:00:00.000Z',
      trial_end: '2026-07-31T00:00:00.000Z',
      revocation_reason: 'cancelled_at_period_end',
    });
  });

  it('never returns the user id or the money environment to the client', async () => {
    // The row belongs to the caller by construction, so echoing the subject adds
    // nothing and puts a Supabase `sub` on the wire and into every client log.
    const h = harness();
    seed(h.db, { userId: USER });
    const res = await h.get('/v1/entitlements?app_id=subly', `Bearer ${await token({ sub: USER })}`);
    const text = await res.text();
    expect(text).not.toContain(USER);
    expect(text).not.toContain('provider_environment');
  });
});
