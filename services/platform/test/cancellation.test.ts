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
// ⏱ 2026-09-29 · AB-M4-03: a Paddle row IS now executed when the seller key is
// set (the last describe below); a store row answers 409 with the store's page.
// Every case above runs with no key, so its 202 `executed: false` still holds.
//
// Same harness as entitlements.test.ts: real ES256 keys, a real SQL engine, a
// stubbed JWKS fetch.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { Hono } from 'hono';
import { SignJWT, exportJWK, generateKeyPair, type JWK, type CryptoKey } from 'jose';
import { platformAuth } from '../src/middleware/auth';
import cancellation from '../src/routes/cancellation';
import type { AppEnv } from '../src/types';
import { realPlatformDb, type RealDb } from './harness';
import { MOR_VERIFIERS, RAIL_CANCEL_PATH } from '../src/lib/mor/registry';

const SUPABASE_URL = 'https://project-a.supabase.co';
const ISSUER = `${SUPABASE_URL}/auth/v1`;

let signingKey: CryptoKey;
let publicJwk: JWK;

/** ⏱ 2026-09-29 · AB-M4-03 — what the stubbed Paddle API answers, and every call it saw. */
let paddleAnswer: () => Response | Promise<Response> = () => {
  throw new Error('no Paddle answer set for this test');
};
const paddleCalls: Array<{ url: string; body: string; authorization: string | null }> = [];

beforeAll(async () => {
  const pair = await generateKeyPair('ES256', { extractable: true });
  signingKey = pair.privateKey;
  publicJwk = { ...(await exportJWK(pair.publicKey)), alg: 'ES256', kid: 'test-key-1' };
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/.well-known/jwks.json')) {
      return new Response(JSON.stringify({ keys: [publicJwk] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url.startsWith('https://api.paddle.com/') || url.startsWith('https://sandbox-api.paddle.com/')) {
      const req = new Request(url, init);
      paddleCalls.push({ url, body: await req.text(), authorization: req.headers.get('authorization') });
      return paddleAnswer();
    }
    throw new Error(`unexpected fetch in test: ${url}`);
  });
});
beforeEach(() => {
  paddleCalls.length = 0;
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
function harness({
  db = realPlatformDb(),
  environment = 'live' as string | null,
  paddleApiKey = undefined as string | undefined,
} = {}) {
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
    PADDLE_API_KEY: paddleApiKey,
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
  o: {
    userId: string;
    appId?: string;
    provider?: string | null;
    environment?: string | null;
    store?: string | null;
    subscriptionId?: string;
  },
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
      o.appId ?? 'subscriptiontracker',
      'pro',
      null,
      o.store ?? null,
      null,
      '2026-08-01T00:00:00.000Z',
      o.provider === undefined ? 'paddle' : o.provider,
      o.environment === undefined ? 'live' : o.environment,
      o.subscriptionId ?? 'sub_123',
      'active',
    );
}

const USER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

describe('[5]M-9 · cancelling is a real server call, and it tells the truth', () => {
  it('records the request and answers 202 with executed:false — NEVER 200', async () => {
    const h = harness();
    seedLive(h.db, { userId: USER });

    const res = await h.post({ app_id: 'subscriptiontracker' }, `Bearer ${await token(USER)}`);

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
    expect(rows[0].app_id).toBe('subscriptiontracker');
    expect(rows[0].environment).toBe('live');
    expect(rows[0].provider).toBe('paddle');
    // The cancel executor acts only on `backlog = 0` (migration 0029: the column's
    // default, 1, marks the rows that predate it), so the route writes 0.
    expect(rows[0].backlog).toBe(0);
    expect(rows[0].provider_subscription_id).toBe('sub_123');
    expect(rows[0].executed_at).toBeNull();
    expect(rows[0].not_executed_reason).toBe('provider_not_configured');
  });

  it('a SECOND press writes a SECOND row — "they asked three times" is the fact support needs', async () => {
    const h = harness();
    seedLive(h.db, { userId: USER });
    const authz = `Bearer ${await token(USER)}`;

    await h.post({ app_id: 'subscriptiontracker' }, authz);
    await h.post({ app_id: 'subscriptiontracker' }, authz);

    // An upsert here would erase the evidence that nothing happened the first
    // time, which is precisely the complaint this table exists to substantiate.
    expect(h.db.count('cancellation_requests')).toBe(2);
  });

  it('a row with NO provider records `no_provider_on_row`, not the A-1 reason', async () => {
    const h = harness();
    seedLive(h.db, { userId: USER, provider: null });

    const res = await h.post({ app_id: 'subscriptiontracker' }, `Bearer ${await token(USER)}`);

    expect(res.status).toBe(202);
    const body = (await res.json()) as { not_executed_reason: string };
    expect(body.not_executed_reason).toBe('no_provider_on_row');
  });

  it('NOTHING to cancel is 404 and writes NO row — never manufactured evidence', async () => {
    const h = harness();
    const res = await h.post({ app_id: 'subscriptiontracker' }, `Bearer ${await token(USER)}`);

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

    const res = await h.post({ app_id: 'subscriptiontracker' }, `Bearer ${await token(USER)}`);

    expect(res.status).toBe(404);
    expect(h.db.count('cancellation_requests')).toBe(0);
  });

  it("a row from the OTHER money world is not this deploy's to cancel — [5]M-12", async () => {
    const h = harness({ environment: 'live' });
    seedLive(h.db, { userId: USER, environment: 'sandbox' });

    const res = await h.post({ app_id: 'subscriptiontracker' }, `Bearer ${await token(USER)}`);

    expect(res.status).toBe(404);
    expect(h.db.count('cancellation_requests')).toBe(0);
  });

  it('an UNAUTHENTICATED request is 401 SPECIFICALLY', async () => {
    const h = harness();
    seedLive(h.db, { userId: USER });

    const res = await h.post({ app_id: 'subscriptiontracker' });

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

    const res = await h.post({ app_id: 'subscriptiontracker' }, `Bearer ${await token(USER)}`);

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

// ─────────────────────────────────────────────────────────────────────────────
// ⏱ 2026-09-29 · AB-M4-03 (moneyflows MF-3a) · THE CANCEL IS CHOSEN BY RAIL, AND A
// PADDLE CANCEL IS CARRIED OUT. Red control on main 454dd415: every case below
// that expects 200 or 409 answered 202 `executed: false`, and the RevenueCat row
// was recorded as `provider_not_configured`.
// ─────────────────────────────────────────────────────────────────────────────
const LIVE_KEY = `pdl_live_apikey_${'x'.repeat(24)}`;
const EFFECTIVE = '2026-10-29T00:00:00.000Z';
const scheduled = () =>
  new Response(
    JSON.stringify({ data: { id: 'sub_123', status: 'active', scheduled_change: { action: 'cancel', effective_at: EFFECTIVE, resume_at: null } } }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );

describe('AB-M4-03 · the cancel path follows the rail the person paid on', () => {
  it('every registered rail declares how it is cancelled — a new rail cannot fall through silently', () => {
    for (const v of MOR_VERIFIERS) expect(Object.keys(RAIL_CANCEL_PATH)).toContain(v.provider);
  });

  it('a PADDLE row with the seller key is CANCELLED at the period end: 200, executed, one call, executed_at stamped', async () => {
    paddleAnswer = scheduled;
    const h = harness({ paddleApiKey: LIVE_KEY });
    seedLive(h.db, { userId: USER, subscriptionId: 'sub_01abc' });

    const res = await h.post({ app_id: 'subscriptiontracker' }, `Bearer ${await token(USER)}`);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ has_active_plan: true, recorded: true, executed: true, effective_at: EFFECTIVE });
    expect(paddleCalls).toHaveLength(1);
    expect(paddleCalls[0].url).toBe('https://api.paddle.com/subscriptions/sub_01abc/cancel');
    // 🔴 The LOCKED behaviour is period-end (INV-514). `immediately` would end paid access early.
    expect(JSON.parse(paddleCalls[0].body)).toEqual({ effective_from: 'next_billing_period' });
    expect(paddleCalls[0].authorization).toBe(`Bearer ${LIVE_KEY}`);
    const rows = h.db.rows('SELECT executed_at, not_executed_reason FROM cancellation_requests');
    expect(rows).toHaveLength(1);
    expect(rows[0].executed_at).not.toBeNull();
    expect(rows[0].not_executed_reason).toBeNull();
  });

  it('Paddle answering non-2xx keeps the honest 202 with `provider_error`', async () => {
    paddleAnswer = () => new Response(JSON.stringify({ error: { code: 'not_found' } }), { status: 404 });
    const h = harness({ paddleApiKey: LIVE_KEY });
    seedLive(h.db, { userId: USER });

    const res = await h.post({ app_id: 'subscriptiontracker' }, `Bearer ${await token(USER)}`);

    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({ executed: false, not_executed_reason: 'provider_error' });
    expect(h.db.rows('SELECT executed_at FROM cancellation_requests')[0].executed_at).toBeNull();
  });

  it('a Paddle call that throws (timeout, network) is `provider_error`, never a 500', async () => {
    paddleAnswer = () => {
      throw new DOMException('The operation timed out.', 'TimeoutError');
    };
    const h = harness({ paddleApiKey: LIVE_KEY });
    seedLive(h.db, { userId: USER });

    const res = await h.post({ app_id: 'subscriptiontracker' }, `Bearer ${await token(USER)}`);

    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({ executed: false, not_executed_reason: 'provider_error' });
  });

  it('a SANDBOX key on a live deploy sends nothing — `provider_not_configured`', async () => {
    const h = harness({ paddleApiKey: `pdl_sdbx_apikey_${'x'.repeat(24)}` });
    seedLive(h.db, { userId: USER });

    const res = await h.post({ app_id: 'subscriptiontracker' }, `Bearer ${await token(USER)}`);

    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({ not_executed_reason: 'provider_not_configured' });
    expect(paddleCalls).toHaveLength(0);
  });

  it('a REVENUECAT (App Store) row answers 409 with the store page and records NOTHING', async () => {
    const h = harness({ paddleApiKey: LIVE_KEY });
    seedLive(h.db, { userId: USER, provider: 'revenuecat', store: 'APP_STORE' });

    const res = await h.post({ app_id: 'subscriptiontracker' }, `Bearer ${await token(USER)}`);

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      has_active_plan: true,
      recorded: false,
      executed: false,
      cancel_at: 'app_store',
      manage_url: 'https://apps.apple.com/account/subscriptions',
    });
    expect(h.db.count('cancellation_requests')).toBe(0);
    expect(paddleCalls).toHaveLength(0);
  });

  it('a Play row names Play; a row whose store is unnamed still answers 409, with no URL', async () => {
    const h = harness();
    seedLive(h.db, { userId: USER, provider: 'revenuecat', store: 'PLAY_STORE' });
    const play = await h.post({ app_id: 'subscriptiontracker' }, `Bearer ${await token(USER)}`);
    expect(await play.json()).toMatchObject({ cancel_at: 'play_store', manage_url: 'https://play.google.com/store/account/subscriptions' });

    const h2 = harness();
    seedLive(h2.db, { userId: USER, provider: 'revenuecat', store: null });
    const bare = await h2.post({ app_id: 'subscriptiontracker' }, `Bearer ${await token(USER)}`);
    expect(bare.status).toBe(409);
    expect(await bare.json()).toMatchObject({ cancel_at: 'store', manage_url: null });
  });
});
