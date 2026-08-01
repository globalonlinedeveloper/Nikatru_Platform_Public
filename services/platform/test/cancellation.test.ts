// ─────────────────────────────────────────────────────────────────────────────
// POST /v1/plan/cancel — the ROSCA cancel path's server half.
// [pipeline 5]M-9.
//
// 🔴 THE ASSERTION THAT MATTERS MOST IS THE ONE ABOUT HONESTY, not about the
// happy path. This route can RECORD a cancellation and cannot EXECUTE one (no
// seller credential exists — OWNER_QUEUE A-1). The failure mode that would hurt
// a real person is the route answering something a client reads as "cancelled"
// while the billing continues. So the shape of the response is under test as
// hard as the row it writes:
//   · 202, never 200
//   · `executed: false` with a stored, enumerable reason
//   · `recorded: true` only when a row actually landed
//
// Same harness as entitlements.test.ts: real ES256 keys, a real SQL engine, a
// stubbed JWKS fetch.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Hono } from 'hono';
import { SignJWT, exportJWK, generateKeyPair, type JWK, type KeyLike } from 'jose';
import { platformAuth } from '../src/middleware/auth';
import cancellation from '../src/routes/cancellation';
import type { AppEnv } from '../src/types';
import { realPlatformDb, type RealDb } from './harness';

const SUPABASE_URL = 'https://project-a.supabase.co';
const ISSUER = `${SUPABASE_URL}/auth/v1`;

let signingKey: KeyLike;
let publicJwk: JWK;

beforeAll(async () => {
  const pair = await generateKeyPair('ES256', { extractable: true });
  signingKey = pair.privateKey;
  publicJwk = { ...(await exportJWK(pair.publicKey)), alg: 'ES256', kid: 'test-key-1' };
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

async function token(sub: string) {
  return new SignJWT({ sub })
    .setProtectedHeader({ alg: 'ES256', kid: 'test-key-1' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .setAudience('authenticated')
    .setIssuer(ISSUER)
    .sign(signingKey);
}

/** ⚠️ `null` means NO money environment, never `undefined` — an `undefined`
 *  argument is swallowed by the parameter default and the test would assert the
 *  configured path while claiming to assert the unconfigured one. */
function harness({ db = realPlatformDb(), environment = 'live' as string | null } = {}) {
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => {
    c.set('requestId', 'rid-test');
    await next();
  });
  app.use('/v1/plan/*', platformAuth);
  app.route('/v1', cancellation);

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
    post: (body: unknown, authz?: string) =>
      app.request(
        '/v1/plan/cancel',
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(authz === undefined ? {} : { Authorization: authz }),
          },
          body: typeof body === 'string' ? body : JSON.stringify(body),
        },
        env,
      ),
  };
}

function seedLive(
  db: RealDb,
  o: { userId: string; appId?: string; provider?: string | null; environment?: string | null },
) {
  db.db
    .prepare(
      `INSERT INTO entitlements
         (user_id, app_id, entitlement, product_id, store, is_active, expires_at, updated_at,
          provider, provider_environment, provider_subscription_id, provider_status)
       VALUES (?,?,?,?,?,1,?,?,?,?,?,?)`,
    )
    .run(
      o.userId,
      o.appId ?? 'subly',
      'pro',
      null,
      null,
      null,
      '2026-08-01T00:00:00.000Z',
      o.provider === undefined ? 'paddle' : o.provider,
      o.environment === undefined ? 'live' : o.environment,
      'sub_123',
      'active',
    );
}

const USER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

describe('[5]M-9 · cancelling is a real server call, and it tells the truth', () => {
  it('records the request and answers 202 with executed:false — NEVER 200', async () => {
    const h = harness();
    seedLive(h.db, { userId: USER });

    const res = await h.post({ app_id: 'subly' }, `Bearer ${await token(USER)}`);

    // 🔴 202, not 200. A 200 reads as "done" to every client that does not
    // inspect the body, and the client would then tell a paying user their
    // subscription is over while the merchant of record keeps billing them.
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({
      has_active_plan: true,
      recorded: true,
      executed: false,
      not_executed_reason: 'provider_not_configured',
    });

    // `recorded: true` is a claim about a ROW, so the row is what is asserted —
    // not that the route said so.
    const rows = h.db.rows('SELECT * FROM cancellation_requests');
    expect(rows).toHaveLength(1);
    expect(rows[0].user_id).toBe(USER);
    expect(rows[0].app_id).toBe('subly');
    expect(rows[0].environment).toBe('live');
    expect(rows[0].provider).toBe('paddle');
    expect(rows[0].provider_subscription_id).toBe('sub_123');
    expect(rows[0].executed_at).toBeNull();
    expect(rows[0].not_executed_reason).toBe('provider_not_configured');
  });

  it('a SECOND press writes a SECOND row — "they asked three times" is the fact support needs', async () => {
    const h = harness();
    seedLive(h.db, { userId: USER });
    const authz = `Bearer ${await token(USER)}`;

    await h.post({ app_id: 'subly' }, authz);
    await h.post({ app_id: 'subly' }, authz);

    // An upsert here would erase the evidence that nothing happened the first
    // time, which is precisely the complaint this table exists to substantiate.
    expect(h.db.count('cancellation_requests')).toBe(2);
  });

  it('a row with NO provider records `no_provider_on_row`, not the A-1 reason', async () => {
    const h = harness();
    seedLive(h.db, { userId: USER, provider: null });

    const res = await h.post({ app_id: 'subly' }, `Bearer ${await token(USER)}`);

    expect(res.status).toBe(202);
    const body = (await res.json()) as { not_executed_reason: string };
    expect(body.not_executed_reason).toBe('no_provider_on_row');
  });

  it('NOTHING to cancel is 404 and writes NO row — never manufactured evidence', async () => {
    const h = harness();
    const res = await h.post({ app_id: 'subly' }, `Bearer ${await token(USER)}`);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      has_active_plan: false,
      recorded: false,
      executed: false,
    });
    // Recording a cancellation of nothing manufactures evidence of a
    // subscription that never existed, and support would have to disprove it.
    expect(h.db.count('cancellation_requests')).toBe(0);
  });

  it("another user's subscription is NOT cancellable — user_id comes from the JWT", async () => {
    const h = harness();
    seedLive(h.db, { userId: OTHER });

    const res = await h.post({ app_id: 'subly' }, `Bearer ${await token(USER)}`);

    expect(res.status).toBe(404);
    expect(h.db.count('cancellation_requests')).toBe(0);
  });

  it("a row from the OTHER money world is not this deploy's to cancel — [5]M-12", async () => {
    const h = harness({ environment: 'live' });
    seedLive(h.db, { userId: USER, environment: 'sandbox' });

    const res = await h.post({ app_id: 'subly' }, `Bearer ${await token(USER)}`);

    expect(res.status).toBe(404);
    expect(h.db.count('cancellation_requests')).toBe(0);
  });

  it('an UNAUTHENTICATED request is 401 SPECIFICALLY', async () => {
    const h = harness();
    seedLive(h.db, { userId: USER });

    const res = await h.post({ app_id: 'subly' });

    expect(res.status).toBe(401);
    expect(h.db.count('cancellation_requests')).toBe(0);
  });

  it('an UNKNOWN app is 404 and writes nothing', async () => {
    const h = harness();
    const res = await h.post({ app_id: 'not_an_app' }, `Bearer ${await token(USER)}`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'unknown_app' });
  });

  it('an UNDECLARED money environment is 503 — no default in either direction', async () => {
    const h = harness({ environment: null });
    seedLive(h.db, { userId: USER });

    const res = await h.post({ app_id: 'subly' }, `Bearer ${await token(USER)}`);

    expect(res.status).toBe(503);
    expect(h.db.count('cancellation_requests')).toBe(0);
  });

  it('a body that is not JSON is 400 and writes nothing', async () => {
    const h = harness();
    seedLive(h.db, { userId: USER });
    const res = await h.post('not json at all', `Bearer ${await token(USER)}`);
    expect(res.status).toBe(400);
    expect(h.db.count('cancellation_requests')).toBe(0);
  });
});
