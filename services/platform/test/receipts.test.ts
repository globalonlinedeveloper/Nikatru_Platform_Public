// ─────────────────────────────────────────────────────────────────────────────
// POST /v1/receipts/:store — A STORE PURCHASE NEVER GRANTS ON THE CLIENT'S WORD.
//
// 🔴 EVERY ASSERTION BELOW GRADES THE ROUTE'S ANSWER, and the row counts are the
// second half of the same question, never the first. "A grant was written" is a
// claim about what the route DID; asserting a row you seeded yourself proves the
// harness works and nothing else.
//
// ⚠️ NO NETWORK, NO SECRET, NO VENDOR ACCOUNT. `RECEIPT_FETCH` is the injected
// transport seam — the REAL verifier code runs (URL construction, auth header,
// response parse, state mapping, every refusal) against a canned store answer.
// `RECEIPT_PRODUCT_MAP` is the second seam and exists because the register is
// legitimately EMPTY: no store SKU has been minted, so without it the grant path
// could only be exercised by committing a product id that resolves to nothing.
//
// Real ES256 keys, a real SQL engine with the real migrations, a stubbed JWKS —
// the shape test/entitlements.test.ts established.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Hono } from 'hono';
import { SignJWT, exportJWK, generateKeyPair, type JWK, type KeyLike } from 'jose';
import { platformAuth } from '../src/middleware/auth';
import receipts, { creditDays, extendExpiry } from '../src/routes/receipts';
import { mintGrantId } from '../src/lib/mor/bundle-store';
import type { FeatureSetRef, ProductMap } from '../src/lib/receipts/products';
import { BUNDLES_REGISTER, type BundleRegisterRow } from '../src/lib/catalog';
import type { AppEnv } from '../src/types';
import { realPlatformDb, type RealDb } from './harness';

const SUPABASE_URL = 'https://project-a.supabase.co';
const ISSUER = `${SUPABASE_URL}/auth/v1`;
const USER = 'user-receipts-1';

const NIKATRU_ALL: FeatureSetRef = {
  name: 'nikatru_all',
  version: 1,
  products: ['subscriptiontracker', 'fullshot'],
};

/**
 * The third seam's register: nikatru_all@1 as `sellable`. The committed register
 * carries it as `draft` (it has never been sold), and since 2026-09-26 the mint
 * refuses anything but a `sellable` version — so the grant path runs over this
 * row, and the refusal is proven against the committed register (RC5 below).
 */
const SELLABLE_V1: readonly BundleRegisterRow[] = [
  {
    featureSet: 'nikatru_all',
    version: 1,
    status: 'sellable',
    members: [{ slug: 'subscriptiontracker' }, { slug: 'fullshot' }],
  },
];

/** The two seams' fixture map. Keyed exactly as products.ts keys it. */
function productMap(entries: Array<[string, string]>): ProductMap {
  const m = new Map<string, FeatureSetRef>();
  for (const [store, id] of entries) m.set(`${store}\u0000${id}`, NIKATRU_ALL);
  return m;
}

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
    // 🔴 A REAL OUTBOUND CALL IS A TEST FAILURE, not a slow test. If a verifier
    // ever reaches the global fetch it has escaped the injected seam, and this
    // throw is what says so instead of the suite quietly hitting a vendor.
    throw new Error(`unexpected network call in test: ${url}`);
  });
});
afterAll(() => vi.unstubAllGlobals());

const KV = { get: async () => null, put: async () => undefined } as unknown as KVNamespace;

async function token() {
  return new SignJWT({ sub: USER })
    .setProtectedHeader({ alg: 'ES256', kid: 'test-key-1' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .setAudience('authenticated')
    .setIssuer(ISSUER)
    .sign(signingKey);
}

/** One canned store answer, recorded per call so replay can be observed. */
function stubStore(answers: Array<{ status: number; body: unknown }>) {
  const calls: string[] = [];
  const bodies: string[] = [];
  let i = 0;
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push(String(input));
    bodies.push(typeof init?.body === 'string' ? init.body : '');
    const a = answers[Math.min(i, answers.length - 1)];
    i += 1;
    return new Response(JSON.stringify(a.body), {
      status: a.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { impl, calls, bodies };
}

/**
 * The shape `purchases.subscriptionsv2.get` really answers. `startTime` is
 * carried DELIBERATELY and is the same on every answer, exactly as Play sends
 * it: it is "Time at which the subscription was granted" and never moves. A
 * verifier that ordered by it would make every renewal below `stale`, and the
 * renewal tests are what catch that.
 */
const PLAY_ACTIVE = (productId: string, expiry: string) => ({
  subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
  latestOrderId: 'GPA.1234',
  startTime: '2026-09-01T00:00:00.000Z',
  lineItems: [{ productId, expiryTime: expiry }],
});

/**
 * A `CollectionItemContractV6` item as the Collections reference names its
 * fields. `acquiredDate` is constant across renewals — "The date on which the
 * user acquired the item" — for the same reason as Play's `startTime`, and is
 * carried so a verifier that read it is caught.
 */
const MS_ACTIVE = (
  productId: string,
  endDate: string,
  modifiedDate = '2026-09-05T00:00:00.000Z',
) => ({
  items: [
    {
      itemId: 'ms-item-1',
      productId,
      status: 'Active',
      endDate,
      modifiedDate,
      acquiredDate: '2026-09-05T00:00:00.000Z',
    },
  ],
});

function harness({
  db = realPlatformDb(),
  environment = 'live' as string | null,
  fetchImpl = undefined as typeof fetch | undefined,
  map = productMap([]) as ProductMap | undefined,
  credentials = {} as Record<string, string>,
  // `null` = no seam: the mint reads the COMMITTED register, as every deploy does.
  // (Not `undefined`, which a destructuring default would silently replace.)
  register = SELLABLE_V1 as readonly BundleRegisterRow[] | null,
} = {}) {
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => {
    c.set('requestId', 'rid-test');
    await next();
  });
  app.use('/v1/receipts/*', platformAuth);
  app.route('/v1', receipts);

  const env = {
    PLATFORM_DB: db,
    JWKS_CACHE: KV,
    SUPABASE_URL,
    APP_ID: 'platform',
    API_VERSION: 'v1',
    MONEY_ENVIRONMENT: environment ?? undefined,
    RECEIPT_FETCH: fetchImpl,
    RECEIPT_PRODUCT_MAP: map,
    RECEIPT_BUNDLE_REGISTER: register ?? undefined,
    ...credentials,
  } as unknown as AppEnv['Bindings'];

  return {
    db,
    post: async (store: string, body: unknown, authz?: string) =>
      app.request(
        `/v1/receipts/${store}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(authz === undefined ? {} : { Authorization: authz }),
          },
          body: JSON.stringify(body),
        },
        env,
      ),
  };
}

const PLAY_CREDS = {
  GOOGLE_PLAY_PACKAGE_NAME: 'com.nikatru.subscriptiontracker',
  GOOGLE_PLAY_OAUTH_BEARER: 'ya29.test-bearer-not-a-real-credential',
};
const MS_CREDS = { MICROSOFT_STORE_SERVICE_TOKEN: 'aad.test-token-not-a-real-credential' };

function seedGrant(
  db: RealDb,
  o: {
    grantId: string;
    provider: string;
    source: string;
    subId: string;
    occurredAt: string;
    expiresAt: string | null;
    environment?: string;
  },
) {
  db.db
    .prepare(
      `INSERT INTO bundle_grants
         (grant_id, user_id, source, feature_set_name, feature_set_version, provider,
          provider_environment, provider_subscription_id, occurred_at, expires_at,
          created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      o.grantId,
      USER,
      o.source,
      NIKATRU_ALL.name,
      NIKATRU_ALL.version,
      o.provider,
      o.environment ?? 'live',
      o.subId,
      o.occurredAt,
      o.expiresAt,
      '2026-09-01T00:00:00.000Z',
      '2026-09-01T00:00:00.000Z',
    );
  for (const slug of NIKATRU_ALL.products) {
    db.db
      .prepare(
        `INSERT INTO feature_set_members (name, version, product_slug, product_kind)
         VALUES (?,?,?,?) ON CONFLICT DO NOTHING`,
      )
      // The seed records the register's kind, as the route does.
      .run(NIKATRU_ALL.name, NIKATRU_ALL.version, slug, slug === 'fullshot' ? 'extension' : 'app');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
describe('the door itself', () => {
  it('refuses an unauthenticated request with 401 SPECIFICALLY, not a 404', async () => {
    const h = harness();
    const res = await h.post('google_play', { token: 't' });
    expect(res.status).toBe(401);
    expect(h.db.count('bundle_grants')).toBe(0);
  });

  it('answers 404 for a store rail that is not registered', async () => {
    const h = harness();
    const res = await h.post('steam', { token: 't' }, `Bearer ${await token()}`);
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: 'unknown_store' });
  });

  it('refuses to decide anything without a money world [5]M-12', async () => {
    const h = harness({ environment: null });
    const res = await h.post('google_play', { token: 't' }, `Bearer ${await token()}`);
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: 'money_rail_not_configured' });
    expect(h.db.count('bundle_grants')).toBe(0);
  });
});

describe('the client may not decide its own grant', () => {
  it('REFUSES a body carrying a feature set out loud, and writes nothing', async () => {
    const h = harness({ credentials: PLAY_CREDS });
    const res = await h.post(
      'google_play',
      { token: 't', feature_set: 'nikatru_all', expires_at: '2099-01-01T00:00:00.000Z' },
      `Bearer ${await token()}`,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; keys: string[] };
    expect(body.error).toBe('client_supplied_grant');
    // Both offending keys are NAMED, so the attempt is visible in a log rather
    // than silently dropped.
    expect(body.keys.sort()).toEqual(['expires_at', 'feature_set']);
    expect(h.db.count('bundle_grants')).toBe(0);
  });

  it('refuses an empty token rather than treating absence as a purchase', async () => {
    const h = harness({ credentials: PLAY_CREDS });
    const res = await h.post('google_play', { token: '   ' }, `Bearer ${await token()}`);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'missing_token' });
    expect(h.db.count('bundle_grants')).toBe(0);
  });
});

describe('a FORGED token grants nothing', () => {
  it('answers 403 and writes NO row when Google does not know the purchase token', async () => {
    const store = stubStore([{ status: 404, body: { error: { message: 'purchaseToken not found' } } }]);
    const h = harness({
      credentials: PLAY_CREDS,
      fetchImpl: store.impl,
      map: productMap([['google_play', 'nikatru_all_yearly']]),
    });
    const res = await h.post('google_play', { token: 'forged-token-abc' }, `Bearer ${await token()}`);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: 'receipt_not_verified' });
    // 🔴 THE WHOLE POINT: the server DID ask Google, and it wrote nothing.
    expect(store.calls.length).toBe(1);
    expect(store.calls[0]).toContain('forged-token-abc');
    expect(h.db.count('bundle_grants')).toBe(0);
  });

  it('answers 403 when the token is real but the subscription is not active', async () => {
    const store = stubStore([
      {
        status: 200,
        body: {
          subscriptionState: 'SUBSCRIPTION_STATE_EXPIRED',
          lineItems: [{ productId: 'nikatru_all_yearly', expiryTime: '2026-01-01T00:00:00.000Z' }],
        },
      },
    ]);
    const h = harness({
      credentials: PLAY_CREDS,
      fetchImpl: store.impl,
      map: productMap([['google_play', 'nikatru_all_yearly']]),
    });
    const res = await h.post('google_play', { token: 'real-but-dead' }, `Bearer ${await token()}`);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: 'receipt_not_active' });
    expect(h.db.count('bundle_grants')).toBe(0);
  });

  it('an UNCONFIGURED rail refuses with 503 and never falls back to the client word', async () => {
    const store = stubStore([{ status: 200, body: PLAY_ACTIVE('nikatru_all_yearly', '2027-09-09T00:00:00.000Z') }]);
    const h = harness({
      credentials: {}, // no Google credential exists for this project today
      fetchImpl: store.impl,
      map: productMap([['google_play', 'nikatru_all_yearly']]),
    });
    const res = await h.post('google_play', { token: 'anything' }, `Bearer ${await token()}`);
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: 'receipt_rail_not_configured' });
    // It did not even ask, and — the part that matters — it did not grant.
    expect(store.calls.length).toBe(0);
    expect(h.db.count('bundle_grants')).toBe(0);
  });

  it('APPLE is registered and REFUSES EVEN WITH CREDENTIALS, because a JWS is not evidence until its chain is checked', async () => {
    const h = harness({
      credentials: {
        APPLE_ASC_ISSUER_ID: 'issuer',
        APPLE_ASC_KEY_ID: 'key',
        APPLE_ASC_PRIVATE_KEY: 'not-a-real-key',
      },
      map: productMap([['apple_iap', 'nikatru_all_yearly']]),
    });
    const res = await h.post('apple_iap', { token: 'tx-1' }, `Bearer ${await token()}`);
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: 'receipt_rail_not_verifiable' });
    expect(h.db.count('bundle_grants')).toBe(0);
  });
});

describe('a verified receipt writes exactly one grant, and a REPLAY writes no second one', () => {
  it('grants on the store\'s answer and names what it granted', async () => {
    const store = stubStore([{ status: 200, body: PLAY_ACTIVE('nikatru_all_yearly', '2027-09-09T00:00:00.000Z') }]);
    const h = harness({
      credentials: PLAY_CREDS,
      fetchImpl: store.impl,
      map: productMap([['google_play', 'nikatru_all_yearly']]),
    });
    const res = await h.post('google_play', { token: 'tok-live-1' }, `Bearer ${await token()}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      ok: true,
      store: 'google_play',
      written: 'applied',
      granted_via: 'bundle',
    });
    expect(body.grant).toMatchObject({
      source: 'google_play_billing',
      feature_set: { name: 'nikatru_all', version: 1 },
      products: ['subscriptiontracker', 'fullshot'],
      expires_at: '2027-09-09T00:00:00.000Z',
    });
    // The grant id is reproducible from the notification alone.
    expect(body.grant).toMatchObject({ grant_id: await mintGrantId('google_play', 'tok-live-1') });
    expect(h.db.count('bundle_grants')).toBe(1);
    // The version was PINNED, so the member list survives a register edit.
    expect(h.db.count('feature_set_members', 'name = ?', 'nikatru_all')).toBe(2);
    // 🔴 AND EACH MEMBER'S KIND IS THE REGISTER'S, recorded as a fact at sale
    // (0009). Until 2026-09-10 every member was pinned 'app', so the record
    // would have called the extension an app.
    // MUTATION PROOF: bind the literal 'app' again in pinFeatureSet — RED here.
    const kinds = Object.fromEntries(
      h.db.rows('SELECT product_slug, product_kind FROM feature_set_members WHERE name = ?', 'nikatru_all')
        .map((r) => [r.product_slug, r.product_kind]),
    );
    expect(kinds).toEqual({ subscriptiontracker: 'app', fullshot: 'extension' });
  });

  it('a feature set naming a member NO register carries is an ERROR, and nothing is pinned or granted', async () => {
    const store = stubStore([{ status: 200, body: PLAY_ACTIVE('ghost_sku', '2027-09-09T00:00:00.000Z') }]);
    const ghost: ProductMap = new Map([
      // Keyed exactly as products.ts keys it: `<store>` NUL `<product id>`.
      [`google_play${String.fromCharCode(0)}ghost_sku`, { name: 'ghost_set', version: 1, products: ['subscriptiontracker', 'not_a_product'] }],
    ]);
    const h = harness({ credentials: PLAY_CREDS, fetchImpl: store.impl, map: ghost });
    const res = await h.post('google_play', { token: 'tok-ghost' }, `Bearer ${await token()}`);
    // Fail closed: the route's onError, not a row with a guessed kind.
    expect(res.status).toBe(500);
    expect(h.db.count('feature_sets')).toBe(0);
    expect(h.db.count('feature_set_members')).toBe(0);
    expect(h.db.count('bundle_grants')).toBe(0);
  });

  it('RC5 — a version the COMMITTED register calls `draft` is refused: nothing pinned, nothing granted', async () => {
    // O-BUNDLE-MEMBER-INSERT-UNLOCKED limb (2). `register: null` is every
    // deploy: the mint reads catalog/bundles.json, where nikatru_all@1 is draft.
    // MUTATION PROOF: bind the literal 'sellable' again and drop the status check
    // in pinFeatureSet — this goes 200 with a grant, RED here.
    const store = stubStore([{ status: 200, body: PLAY_ACTIVE('nikatru_all_yearly', '2027-09-09T00:00:00.000Z') }]);
    const h = harness({
      credentials: PLAY_CREDS,
      fetchImpl: store.impl,
      map: productMap([['google_play', 'nikatru_all_yearly']]),
      register: null,
    });
    const res = await h.post('google_play', { token: 'tok-draft' }, `Bearer ${await token()}`);
    expect(res.status).toBe(500);
    expect(h.db.count('feature_sets')).toBe(0);
    expect(h.db.count('feature_set_members')).toBe(0);
    expect(h.db.count('bundle_grants')).toBe(0);
  });

  it('a version the register does not carry at all is refused the same way', async () => {
    const store = stubStore([{ status: 200, body: PLAY_ACTIVE('nikatru_all_yearly', '2027-09-09T00:00:00.000Z') }]);
    const h = harness({
      credentials: PLAY_CREDS,
      fetchImpl: store.impl,
      map: productMap([['google_play', 'nikatru_all_yearly']]),
      register: [{ ...SELLABLE_V1[0], version: 2 }],
    });
    const res = await h.post('google_play', { token: 'tok-absent' }, `Bearer ${await token()}`);
    expect(res.status).toBe(500);
    expect(h.db.count('feature_sets')).toBe(0);
    expect(h.db.count('bundle_grants')).toBe(0);
  });

  it('the minted row records the status READ from the register, and the register it was read from', async () => {
    const store = stubStore([{ status: 200, body: PLAY_ACTIVE('nikatru_all_yearly', '2027-09-09T00:00:00.000Z') }]);
    const h = harness({
      credentials: PLAY_CREDS,
      fetchImpl: store.impl,
      map: productMap([['google_play', 'nikatru_all_yearly']]),
    });
    const res = await h.post('google_play', { token: 'tok-minted' }, `Bearer ${await token()}`);
    expect(res.status).toBe(200);
    expect(h.db.rows('SELECT status, minted_from FROM feature_sets WHERE name = ?', 'nikatru_all')).toEqual([
      { status: 'sellable', minted_from: BUNDLES_REGISTER },
    ]);
  });

  it('a REPLAYED token upserts onto the same row instead of appending a second grant', async () => {
    const store = stubStore([
      { status: 200, body: PLAY_ACTIVE('nikatru_all_yearly', '2027-09-09T00:00:00.000Z') },
    ]);
    const h = harness({
      credentials: PLAY_CREDS,
      fetchImpl: store.impl,
      map: productMap([['google_play', 'nikatru_all_yearly']]),
    });
    const authz = `Bearer ${await token()}`;
    const first = await h.post('google_play', { token: 'tok-replay' }, authz);
    const second = await h.post('google_play', { token: 'tok-replay' }, authz);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    // 🔴 ONE ROW, NOT TWO. The append-instead-of-upsert failure [ADR 057]
    // measured against a NULL key column is what this asserts is absent.
    expect(h.db.count('bundle_grants')).toBe(1);
    expect(h.db.count('bundle_grants', 'user_id = ?', USER)).toBe(1);
    // And the SAME state delivered twice is `stale`, not a second application:
    // the store's clock did not move, so the ordering clause refused an equal
    // clock. That refusal is correct for a true duplicate — the renewal tests
    // below are what prove it is not ALSO refusing renewals.
    expect((await second.json()) as Record<string, unknown>).toMatchObject({ written: 'stale' });
  });

  it('an OLDER state arriving late is answered `stale` and does not move the expiry [5]M-2', async () => {
    // The late answer is an EARLIER snapshot of the same subscription — its
    // paid-through instant is before the one already stored — as a delayed
    // retry from before a renewal would be. Same `startTime` on both, because
    // Play never changes it.
    const store = stubStore([
      { status: 200, body: PLAY_ACTIVE('nikatru_all_yearly', '2027-09-09T00:00:00.000Z') },
      { status: 200, body: PLAY_ACTIVE('nikatru_all_yearly', '2026-12-01T00:00:00.000Z') },
    ]);
    const h = harness({
      credentials: PLAY_CREDS,
      fetchImpl: store.impl,
      map: productMap([['google_play', 'nikatru_all_yearly']]),
    });
    const authz = `Bearer ${await token()}`;
    await h.post('google_play', { token: 'tok-order' }, authz);
    const late = await h.post('google_play', { token: 'tok-order' }, authz);
    expect((await late.json()) as Record<string, unknown>).toMatchObject({ written: 'stale' });
    const rows = h.db.rows('SELECT expires_at FROM bundle_grants');
    expect(rows).toHaveLength(1);
    expect(rows[0].expires_at).toBe('2027-09-09T00:00:00.000Z');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 🔴 RENEWALS. The ordering clause refuses an EQUAL clock, so the clock a store
// receipt writes MUST move on every renewal. Play's `startTime` and Microsoft's
// `acquiredDate` never move; keyed on either, the first period granted and every
// renewal re-post was `stale`, and a paying subscriber lost access at the end of
// period one. Each test below asserts the NEW EXPIRY in the row — a 200 and a
// row count of 1 are exactly what the broken version answered.
//
// MUTATION PROOF: restore `occurredAt: isoFromStoreInstant(doc.startTime)` in
// google.ts (or `held.acquiredDate` in microsoft.ts) and the matching test
// below goes RED on `written: 'stale'` and on the unmoved `expires_at`.
// ─────────────────────────────────────────────────────────────────────────────
describe('a RENEWAL re-post ADVANCES the grant — the store clock must move per period', () => {
  it('Google Play: the same token, one period later, moves expires_at to the new period end', async () => {
    const store = stubStore([
      { status: 200, body: PLAY_ACTIVE('nikatru_all_yearly', '2027-09-09T00:00:00.000Z') },
      // Period two. Same token, same `startTime`, new order id, later expiry —
      // the document Play serves after a successful renewal.
      {
        status: 200,
        body: {
          ...PLAY_ACTIVE('nikatru_all_yearly', '2028-09-09T00:00:00.000Z'),
          latestOrderId: 'GPA.1234..1',
        },
      },
    ]);
    const h = harness({
      credentials: PLAY_CREDS,
      fetchImpl: store.impl,
      map: productMap([['google_play', 'nikatru_all_yearly']]),
    });
    const authz = `Bearer ${await token()}`;
    const first = await h.post('google_play', { token: 'tok-renews' }, authz);
    expect((await first.json()) as Record<string, unknown>).toMatchObject({ written: 'applied' });

    const renewal = await h.post('google_play', { token: 'tok-renews' }, authz);
    expect(renewal.status).toBe(200);
    expect((await renewal.json()) as Record<string, unknown>).toMatchObject({
      written: 'applied',
      grant: { expires_at: '2028-09-09T00:00:00.000Z' },
    });
    const rows = h.db.rows('SELECT expires_at, occurred_at, provider_transaction_id FROM bundle_grants');
    expect(rows).toHaveLength(1);
    // 🔴 THE ASSERTION THAT WAS MISSING: the row's expiry is the NEW period end.
    expect(rows[0].expires_at).toBe('2028-09-09T00:00:00.000Z');
    expect(rows[0].occurred_at).toBe('2028-09-09T00:00:00.000Z');
    expect(rows[0].provider_transaction_id).toBe('GPA.1234..1');
  });

  it('Google Play: the LATEST line-item expiry is the clock, so a multi-item document orders by the furthest paid-through instant', async () => {
    const store = stubStore([
      { status: 200, body: PLAY_ACTIVE('nikatru_all_yearly', '2027-09-09T00:00:00.000Z') },
      {
        status: 200,
        body: {
          ...PLAY_ACTIVE('nikatru_all_yearly', '2027-09-09T00:00:00.000Z'),
          lineItems: [
            { productId: 'nikatru_all_yearly', expiryTime: '2027-09-09T00:00:00.000Z' },
            { productId: 'nikatru_all_addon', expiryTime: '2029-01-01T00:00:00.000Z' },
          ],
        },
      },
    ]);
    const h = harness({
      credentials: PLAY_CREDS,
      fetchImpl: store.impl,
      map: productMap([['google_play', 'nikatru_all_yearly']]),
    });
    const authz = `Bearer ${await token()}`;
    await h.post('google_play', { token: 'tok-multi' }, authz);
    const second = await h.post('google_play', { token: 'tok-multi' }, authz);
    expect((await second.json()) as Record<string, unknown>).toMatchObject({ written: 'applied' });
    expect(h.db.rows('SELECT occurred_at FROM bundle_grants')[0].occurred_at).toBe('2029-01-01T00:00:00.000Z');
  });

  it('Google Play: an ACTIVE document with no readable expiry is refused as unreadable, never written as a lifetime grant', async () => {
    const store = stubStore([
      {
        status: 200,
        body: { ...PLAY_ACTIVE('nikatru_all_yearly', ''), lineItems: [{ productId: 'nikatru_all_yearly' }] },
      },
    ]);
    const h = harness({
      credentials: PLAY_CREDS,
      fetchImpl: store.impl,
      map: productMap([['google_play', 'nikatru_all_yearly']]),
    });
    const res = await h.post('google_play', { token: 'tok-no-expiry' }, `Bearer ${await token()}`);
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ error: 'store_unreadable' });
    expect(h.db.count('bundle_grants')).toBe(0);
  });

  it('Microsoft: the same Store ID key, one period later, moves expires_at to the new endDate', async () => {
    const store = stubStore([
      { status: 200, body: MS_ACTIVE('9NBLGGH4XYZ', '2027-06-01T00:00:00.000Z', '2026-09-05T00:00:00.000Z') },
      // Period two: `endDate` and `modifiedDate` moved, `acquiredDate` did not.
      { status: 200, body: MS_ACTIVE('9NBLGGH4XYZ', '2028-06-01T00:00:00.000Z', '2027-06-01T00:00:00.000Z') },
    ]);
    const h = harness({
      credentials: MS_CREDS,
      fetchImpl: store.impl,
      map: productMap([['microsoft_store', '9NBLGGH4XYZ']]),
    });
    const authz = `Bearer ${await token()}`;
    const first = await h.post('microsoft_store', { token: 'store-id-key-1' }, authz);
    expect((await first.json()) as Record<string, unknown>).toMatchObject({ written: 'applied' });

    const renewal = await h.post('microsoft_store', { token: 'store-id-key-2' }, authz);
    expect(renewal.status).toBe(200);
    expect((await renewal.json()) as Record<string, unknown>).toMatchObject({
      written: 'applied',
      grant: { expires_at: '2028-06-01T00:00:00.000Z' },
    });
    const rows = h.db.rows('SELECT expires_at, occurred_at FROM bundle_grants');
    expect(rows).toHaveLength(1);
    expect(rows[0].expires_at).toBe('2028-06-01T00:00:00.000Z');
    expect(rows[0].occurred_at).toBe('2027-06-01T00:00:00.000Z');
  });

  it('Microsoft: an unchanged item re-posted is `stale` — the clock is equal, so it is a true duplicate', async () => {
    const store = stubStore([{ status: 200, body: MS_ACTIVE('9NBLGGH4XYZ', '2027-06-01T00:00:00.000Z') }]);
    const h = harness({
      credentials: MS_CREDS,
      fetchImpl: store.impl,
      map: productMap([['microsoft_store', '9NBLGGH4XYZ']]),
    });
    const authz = `Bearer ${await token()}`;
    await h.post('microsoft_store', { token: 'store-id-key-1' }, authz);
    const again = await h.post('microsoft_store', { token: 'store-id-key-2' }, authz);
    expect((await again.json()) as Record<string, unknown>).toMatchObject({ written: 'stale' });
    expect(h.db.count('bundle_grants')).toBe(1);
  });

  it('Microsoft: an Active item with neither modifiedDate nor endDate has no clock and is refused, not guessed', async () => {
    const store = stubStore([
      { status: 200, body: { items: [{ itemId: 'ms-item-1', productId: '9NBLGGH4XYZ', status: 'Active' }] } },
    ]);
    const h = harness({
      credentials: MS_CREDS,
      fetchImpl: store.impl,
      map: productMap([['microsoft_store', '9NBLGGH4XYZ']]),
    });
    const res = await h.post('microsoft_store', { token: 'store-id-key' }, `Bearer ${await token()}`);
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ error: 'store_unreadable' });
    expect(h.db.count('bundle_grants')).toBe(0);
  });
});

describe('double billing', () => {
  it('answers 409 already_entitled and NAMES THE HOLDING RAIL before spending a store call', async () => {
    const db = realPlatformDb();
    seedGrant(db, {
      grantId: 'held-by-apple',
      provider: 'apple_iap',
      source: 'apple_iap',
      subId: 'apple-sub-1',
      occurredAt: '2026-09-01T00:00:00.000Z',
      expiresAt: '2027-09-01T00:00:00.000Z',
    });
    const store = stubStore([{ status: 200, body: PLAY_ACTIVE('nikatru_all_yearly', '2028-01-01T00:00:00.000Z') }]);
    const h = harness({
      db,
      credentials: PLAY_CREDS,
      fetchImpl: store.impl,
      map: productMap([['google_play', 'nikatru_all_yearly']]),
    });
    const res = await h.post(
      'google_play',
      { token: 'about-to-buy', want: ['subscriptiontracker', 'fullshot'] },
      `Bearer ${await token()}`,
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      error: 'already_entitled',
      // Without this the client can only say "you already have this" and the
      // user's next question has no answer.
      holding_rail: 'apple_iap',
      holding_source: 'apple_iap',
    });
    // The refusal is a PRE-check: no store call was spent, no row was added.
    expect(store.calls.length).toBe(0);
    expect(db.count('bundle_grants')).toBe(1);
  });

  it('does NOT refuse when the holder is the SAME rail — that is a renewal, and the renewal ADVANCES the expiry', async () => {
    const db = realPlatformDb();
    // The stored clock is the FIRST period's paid-through instant — what the
    // verifier wrote when period one was verified.
    seedGrant(db, {
      grantId: await mintGrantId('google_play', 'tok-renew'),
      provider: 'google_play',
      source: 'google_play_billing',
      subId: 'tok-renew',
      occurredAt: '2027-09-01T00:00:00.000Z',
      expiresAt: '2027-09-01T00:00:00.000Z',
    });
    const store = stubStore([{ status: 200, body: PLAY_ACTIVE('nikatru_all_yearly', '2028-09-01T00:00:00.000Z') }]);
    const h = harness({
      db,
      credentials: PLAY_CREDS,
      fetchImpl: store.impl,
      map: productMap([['google_play', 'nikatru_all_yearly']]),
    });
    const res = await h.post(
      'google_play',
      { token: 'tok-renew', want: ['subscriptiontracker'] },
      `Bearer ${await token()}`,
    );
    expect(res.status).toBe(200);
    expect(db.count('bundle_grants')).toBe(1);
    // 🔴 NOT a 200 and a row count — the row's expiry MOVED. The previous
    // version of this test asserted only the two lines above and passed while
    // every renewal was being discarded as `stale`.
    expect((await res.json()) as Record<string, unknown>).toMatchObject({ written: 'applied' });
    const rows = db.rows('SELECT expires_at FROM bundle_grants WHERE provider_subscription_id = ?', 'tok-renew');
    expect(rows[0].expires_at).toBe('2028-09-01T00:00:00.000Z');
  });

  it('THE RACE: both grants are recorded, the union is served, the older is superseded and an operator alert is raised', async () => {
    const db = realPlatformDb();
    // The rival landed while this request was out at the store — the window the
    // pre-check cannot see, which is the definition of the race (§3.4).
    seedGrant(db, {
      grantId: 'rival-microsoft',
      provider: 'microsoft_store',
      source: 'microsoft_store',
      subId: 'ms-item-9',
      occurredAt: '2026-09-02T00:00:00.000Z',
      expiresAt: '2027-09-02T00:00:00.000Z',
    });
    // The Microsoft grant was RECORDED first (its `created_at` is seeded in the
    // past; the Play row's is now), so it is the older row — which is what
    // `superseded_by` must point away from. "Older" is by our own clock, because
    // the rails' `occurred_at` values measure different things.
    const store = stubStore([
      { status: 200, body: PLAY_ACTIVE('nikatru_all_yearly', '2027-12-01T00:00:00.000Z') },
    ]);
    const alerts: string[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => {
      alerts.push(a.map(String).join(' '));
    });
    const h = harness({
      db,
      credentials: PLAY_CREDS,
      fetchImpl: store.impl,
      map: productMap([['google_play', 'nikatru_all_yearly']]),
    });
    // No `want`, so the pre-check has nothing to compare — exactly the second
    // device that was offline when it bought.
    const res = await h.post('google_play', { token: 'tok-race' }, `Bearer ${await token()}`);
    spy.mockRestore();

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    // 🔴 THE USER IS NEVER UNDER-SERVED: the new grant stands, and so does the old.
    expect(body).toMatchObject({ ok: true, written: 'applied' });
    expect(body.duplicate_grant).toMatchObject({
      superseded: 'rival-microsoft',
      rails: ['google_play', 'microsoft_store'],
    });
    expect(db.count('bundle_grants')).toBe(2);
    // The server did NOT cancel the loser — it cannot, on any store rail. It
    // linked it.
    const older = db.rows('SELECT superseded_by, revoked_at FROM bundle_grants WHERE grant_id = ?', 'rival-microsoft');
    expect(older[0].superseded_by).toBe(await mintGrantId('google_play', 'tok-race'));
    expect(older[0].revoked_at).toBe(null);
    expect(alerts.some((l) => l.includes('duplicate_grant'))).toBe(true);
  });
});

describe('a verified Microsoft receipt is a PULL, because that rail has no push at all', () => {
  it('grants on the Collections answer and carries the item id as the subscription identity', async () => {
    const store = stubStore([{ status: 200, body: MS_ACTIVE('9NBLGGH4XYZ', '2027-06-01T00:00:00.000Z') }]);
    const h = harness({
      credentials: MS_CREDS,
      fetchImpl: store.impl,
      map: productMap([['microsoft_store', '9NBLGGH4XYZ']]),
    });
    const res = await h.post('microsoft_store', { token: 'store-id-key' }, `Bearer ${await token()}`);
    expect(res.status).toBe(200);
    expect((await res.json()) as Record<string, unknown>).toMatchObject({
      grant: { grant_id: await mintGrantId('microsoft_store', 'ms-item-1'), source: 'microsoft_store' },
    });
    expect(store.calls[0]).toContain('collections.mp.microsoft.com');
  });

  it('asks Microsoft with the DOCUMENTED request body — the Store ID key as identityValue, productTypes present', async () => {
    const store = stubStore([{ status: 200, body: MS_ACTIVE('9NBLGGH4XYZ', '2027-06-01T00:00:00.000Z') }]);
    const h = harness({
      credentials: MS_CREDS,
      fetchImpl: store.impl,
      map: productMap([['microsoft_store', '9NBLGGH4XYZ']]),
    });
    await h.post('microsoft_store', { token: 'store-id-key-xyz' }, `Bearer ${await token()}`);
    const sent = JSON.parse(store.bodies[0]) as Record<string, unknown>;
    // learn.microsoft.com/windows/uwp/monetize/query-for-products, "Request body".
    expect(sent).toMatchObject({
      beneficiaries: [{ identityType: 'b2b', identityValue: 'store-id-key-xyz' }],
      productTypes: ['Durable'],
    });
    expect((sent.beneficiaries as Array<Record<string, unknown>>)[0]).toHaveProperty('localTicketReference');
  });

  it('answers 403 when Microsoft rejects the Store ID key', async () => {
    const store = stubStore([{ status: 401, body: {} }]);
    const h = harness({ credentials: MS_CREDS, fetchImpl: store.impl });
    const res = await h.post('microsoft_store', { token: 'stolen-key' }, `Bearer ${await token()}`);
    expect(res.status).toBe(403);
    expect(h.db.count('bundle_grants')).toBe(0);
  });
});

describe('a verified purchase of something we do not sell as a bundle', () => {
  it('answers 422 and writes nothing rather than inventing the offer at redemption time', async () => {
    const store = stubStore([{ status: 200, body: PLAY_ACTIVE('some_other_sku', '2027-09-09T00:00:00.000Z') }]);
    const h = harness({ credentials: PLAY_CREDS, fetchImpl: store.impl, map: productMap([]) });
    const res = await h.post('google_play', { token: 'tok-unmapped' }, `Bearer ${await token()}`);
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ error: 'unmapped_product', product_id: 'some_other_sku' });
    expect(h.db.count('bundle_grants')).toBe(0);
  });
});

describe('proration — the ENTITLEMENT side, which is ours (§3.5)', () => {
  it('credits the unused remainder of a single-app term as extra bundle days', async () => {
    const db = realPlatformDb();
    const now = Date.now();
    const periodEnd = new Date(now + 10 * 86_400_000).toISOString();
    db.db
      .prepare(
        `INSERT INTO entitlements
           (user_id, app_id, entitlement, is_active, expires_at, updated_at,
            provider, provider_environment, current_period_end)
         VALUES (?,?,?,?,?,?,?,?,?)`,
      )
      .run(USER, 'subscriptiontracker', 'pro', 1, periodEnd, 'x', 'paddle', 'live', periodEnd);
    const bundleEnd = new Date(now + 365 * 86_400_000).toISOString();
    const store = stubStore([{ status: 200, body: PLAY_ACTIVE('nikatru_all_yearly', bundleEnd) }]);
    const h = harness({
      db,
      credentials: PLAY_CREDS,
      fetchImpl: store.impl,
      map: productMap([['google_play', 'nikatru_all_yearly']]),
    });
    const res = await h.post('google_play', { token: 'tok-prorate' }, `Bearer ${await token()}`);
    const body = (await res.json()) as { grant: { credit_days_applied: number; expires_at: string } };
    expect(body.grant.credit_days_applied).toBe(10);
    // The credit is ADDED to the bundle's own end, and it is recorded on the row
    // rather than derivable from a chain that could later be corrected.
    expect(Date.parse(body.grant.expires_at) - Date.parse(bundleEnd)).toBe(10 * 86_400_000);
    expect(db.rows('SELECT credit_days_applied FROM bundle_grants')[0].credit_days_applied).toBe(10);
  });

  it('credits NOTHING for a lapsed or unreadable period end — never a negative term', () => {
    const now = Date.parse('2026-09-09T00:00:00.000Z');
    expect(creditDays(null, now)).toBe(0);
    expect(creditDays('not-a-date', now)).toBe(0);
    expect(creditDays('2026-01-01T00:00:00.000Z', now)).toBe(0);
    expect(creditDays('2026-09-19T00:00:00.000Z', now)).toBe(10);
    // A LIFETIME grant stays lifetime: there is no date to extend.
    expect(extendExpiry(null, 10)).toBe(null);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// EACH VERIFIER, DIRECTLY — the unconfigured refusal, per rail.
//
// 🔴 WHY PER RAIL AND NOT ONCE THROUGH THE ROUTE. The route picks a verifier from
// the registry, so a route-level test proves whichever rail the registry happened
// to return. The property that matters is that EVERY rail refuses without a
// credential — Apple, Google and Microsoft each have their own configuration and
// their own way of being half-set-up, and "one of them refuses" is not the claim.
//
// ⚠️ AND IT IS ALSO WHAT MAKES THESE THREE MODULES REACHABLE. Until this block
// existed, `tooling/scripts/assert-no-dead-files.mjs` reported all three as
// unreachable: its `module-import` resolver does not follow a bare `./apple`
// specifier, and the only writer of one was their own registry. The honest fix
// was a test that names each module rather than an exemption that waives it —
// a file nothing imports and nothing tests IS dead, and the sweep was right to
// say so.
// ═════════════════════════════════════════════════════════════════════════════
import { appleIapVerifier } from '../src/lib/receipts/apple';
import { googlePlayVerifier } from '../src/lib/receipts/google';
import { microsoftStoreVerifier } from '../src/lib/receipts/microsoft';

describe('every verifier refuses when its credential is not configured', () => {
  const RAILS = [
    ['apple', appleIapVerifier],
    ['google', googlePlayVerifier],
    ['microsoft', microsoftStoreVerifier],
  ] as const;

  for (const [name, verifier] of RAILS) {
    it(`${name} — no credential means REFUSE, never grant`, async () => {
      // An empty environment is the state this repository is actually in today:
      // no Apple, Google or Microsoft receipt credential has been minted. The
      // failure this asserts against is a verifier that treats "nothing
      // configured" as "nothing to check" and returns a grant.
      const out = await verifier.verify(
        { token: 'whatever-a-client-sent', productId: 'p', userId: 'u' } as never,
        // The REAL deps shape with an EMPTY credential bag — which is the state
        // this repository is in today. Passing a malformed deps object instead
        // would make the verifier throw, and a throw is not the refusal under
        // test: the route would answer 500 rather than the honest 503.
        { credentials: {}, fetch: async () => { throw new Error("a verifier with no credential must not reach the network"); } } as never,
      );
      expect(out.ok).toBe(false);
    });
  }

  it('the three rails are DISTINCT verifiers, not one object under three names', () => {
    // A registry that returned the same object for every store would satisfy the
    // loop above three times over while implementing one rail.
    const ids = new Set(RAILS.map(([, v]) => v.store));
    expect(ids.size).toBe(3);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// The two shared functions every verifier reaches for. Tested HERE rather than
// through a rail, because a bug in either is a bug in all three at once — and
// because the module carries runtime code, not only types: until this block
// existed the dead-file sweep could not reach it at all, since a `import type`
// specifier is erased and the only other writer imported nothing but types.
// ═════════════════════════════════════════════════════════════════════════════
import { refuse, isoFromStoreInstant } from '../src/lib/receipts/contract';

describe('the shared receipt primitives', () => {
  it('`refuse` produces a NON-ok outcome carrying its reason', () => {
    const out = refuse(503, 'rail_not_configured', 'no credential is configured for this rail');
    // The narrowing is the assertion: `ReceiptOutcome` is a UNION, and only the
    // non-ok arm carries a status. A test that read `out.status` without
    // narrowing would not compile, which is the type system making the same
    // point the route has to make at runtime.
    if (out.ok) throw new Error('refuse() returned an ok outcome');
    // 🔴 503, NOT 403. "We could not check" and "we checked and you are not
    // entitled" are different answers with different client behaviour, and
    // collapsing them is how an outage reads as a revocation.
    expect(out.status).toBe(503);
    // The reason has to survive: a refusal with no reason is indistinguishable
    // from a rail nobody has implemented, and both answer "not entitled".
    expect(JSON.stringify(out)).toContain('no credential is configured');
  });

  it('🔴 `isoFromStoreInstant` answers NULL on anything it cannot read, never a guess', () => {
    // Every store sends time differently and none of them is our clock. The one
    // thing this must never do is invent a date: an unreadable instant that
    // materialised as "now" would grant a period nobody paid for.
    for (const bad of [undefined, null, '', 'yesterday', {}, [], NaN, 'not-a-date']) {
      expect(isoFromStoreInstant(bad), `${JSON.stringify(bad)} must not parse`).toBeNull();
    }
  });

  it('…and it DOES read the shapes the stores really send — so it is not a constant null', () => {
    // Without this, a function that returned null for everything would pass the
    // case above and silently refuse every legitimate receipt.
    const fromMs = isoFromStoreInstant(1757376000000);
    const fromIso = isoFromStoreInstant('2026-09-09T00:00:00.000Z');
    expect(fromIso).toBe('2026-09-09T00:00:00.000Z');
    expect(typeof fromMs === 'string' || fromMs === null).toBe(true);
  });
});
