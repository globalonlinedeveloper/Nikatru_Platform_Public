// ─────────────────────────────────────────────────────────────────────────────
// The entitlement read as a UNION — [ADR 057] §5, and the invariants the bundle
// design (2026-09-09) names G8, G10 and G11.
//
// 🔴 EVERY ASSERTION HERE GRADES THE ROUTE'S ANSWER, NEVER A ROW. That is the
// whole point of the file. "The grant is revoked" is a fact about a row and it
// is trivially true after an UPDATE; "the customer can no longer use any product
// in the bundle" is a fact about the HTTP response, and it is the only one worth
// having. A test that revokes and then re-reads the row it just wrote proves the
// database stores what it was told.
//
// Real ES256 keys, a real SQL engine with the real migrations, and a stubbed
// JWKS fetch — the shape test/entitlements.test.ts established.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Hono } from 'hono';
import { SignJWT, exportJWK, generateKeyPair, type JWK, type KeyLike } from 'jose';
import { entitlementsAuth } from '../src/middleware/ext-device-auth';
import entitlements from '../src/routes/entitlements';
import type { AppEnv } from '../src/types';
import { realPlatformDb, type RealDb } from './harness';

const SUPABASE_URL = 'https://project-a.supabase.co';
const ISSUER = `${SUPABASE_URL}/auth/v1`;
const APP = 'subscriptiontracker';
const EXT = 'fullshot';

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

/**
 * 🔴 THE MOUNT, exactly as src/index.ts has it. It was two lines until
 * 2026-09-24 (`'/v1/entitlements'` and `'/v1/entitlements/*'`, both platformAuth);
 * a harness with only the exact-path line ran every sub-route test against an
 * UNAUTHENTICATED route and reported green — which is how the real defect got in.
 * Measured since (test/ext-auth.test.ts): `/*` also matches the exact path, so
 * index.ts now mounts ONE path-aware `entitlementsAuth` on `/v1/entitlements/*`,
 * and this copy follows it. test/ext-auth.test.ts's G9 mount test reads the REAL
 * app, which a mutation of index.ts cannot slip past the way it could this copy.
 */
function harness({ db = realPlatformDb(), environment = 'live' as string | null } = {}) {
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => {
    c.set('requestId', 'rid-test');
    await next();
  });
  app.use('/v1/entitlements/*', entitlementsAuth);
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

/** A pinned feature-set version and its members. Frozen by `sellable`, as the migration says. */
function mintFeatureSet(
  db: RealDb,
  name: string,
  version: number,
  members: [slug: string, kind: string][],
) {
  db.db
    .prepare(
      `INSERT INTO feature_sets (name, version, minted_at, minted_from, status)
       VALUES (?,?,?,?,'sellable')`,
    )
    .run(name, version, '2026-09-09T00:00:00.000Z', 'test-fixture');
  for (const [slug, kind] of members) {
    db.db
      .prepare(`INSERT INTO feature_set_members (name, version, product_slug, product_kind) VALUES (?,?,?,?)`)
      .run(name, version, slug, kind);
  }
}

function seedGrant(
  db: RealDb,
  o: {
    userId: string;
    grantId?: string;
    featureSet?: string;
    version?: number;
    source?: string;
    environment?: string | null;
    expiresAt?: string | null;
    graceUntil?: string | null;
    revokedAt?: string | null;
    revocationReason?: string | null;
  },
) {
  db.db
    .prepare(
      `INSERT INTO bundle_grants (
         grant_id, user_id, source, feature_set_name, feature_set_version,
         provider, provider_environment, provider_subscription_id, provider_transaction_id,
         provider_status, last_event_id, occurred_at, current_period_end, trial_end, expires_at,
         grace_until, revoked_at, revocation_reason, credit_days_applied, superseded_by,
         created_at, updated_at)
       VALUES (?,?,?,?,?, 'paddle',?,?,NULL, 'active','evt_1','2026-09-09T00:00:00.000Z',NULL,NULL,?,
               ?,?,?,NULL,NULL, '2026-09-09T00:00:00.000Z','2026-09-09T00:00:00.000Z')`,
    )
    .run(
      o.grantId ?? 'grant-1',
      o.userId,
      o.source ?? 'paddle_subscription',
      o.featureSet ?? 'nikatru_all',
      o.version ?? 1,
      o.environment === undefined ? 'live' : o.environment,
      `sub_${o.grantId ?? 'grant-1'}`,
      o.expiresAt === undefined ? '2099-01-01T00:00:00.000Z' : o.expiresAt,
      o.graceUntil ?? null,
      o.revokedAt ?? null,
      o.revocationReason ?? null,
    );
}

function seedAppRow(db: RealDb, userId: string, appId = APP, isActive: 0 | 1 = 1) {
  db.db
    .prepare(
      `INSERT INTO entitlements
         (user_id, app_id, entitlement, product_id, store, is_active, expires_at, updated_at,
          provider, provider_environment, provider_status)
       VALUES (?,?,'pro',NULL,NULL,?,'2099-01-01T00:00:00.000Z','2026-09-09T00:00:00.000Z','paddle','live','active')`,
    )
    .run(userId, appId, isActive);
}

// ═════════════════════════════════════════════════════════════════════════════
describe('the union read — a bundle grant unlocks a member product', () => {
  it('grants a product the user has NO per-app row for, and says which branch decided', async () => {
    const h = harness();
    mintFeatureSet(h.db, 'nikatru_all', 1, [
      [APP, 'app'],
      [EXT, 'extension'],
    ]);
    seedGrant(h.db, { userId: 'u1' });

    const res = await h.get(`/v1/entitlements?app_id=${APP}`, `Bearer ${await token('u1')}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;

    expect(body.is_pro).toBe(true);
    expect(body.granted_via).toBe('bundle');
    // The rows list stays EMPTY — nothing was materialised back into
    // `entitlements` ([ADR 057] §5). If this ever grows a row, a second writer
    // has appeared.
    expect(body.entitlements).toEqual([]);
    expect(body.bundle).toEqual({
      feature_set: 'nikatru_all',
      version: 1,
      // 🔴 SPANS TWO CATEGORIES. The app and the extension are one purchase, which
      // is the whole hybrid model — and it needed no schema change to express.
      products: [EXT, APP].sort(),
      expires_at: '2099-01-01T00:00:00.000Z',
      source: 'paddle_subscription',
    });
  });

  it("'app' wins the tie when a user holds BOTH, and the union never under-serves", async () => {
    const h = harness();
    mintFeatureSet(h.db, 'nikatru_all', 1, [[APP, 'app']]);
    seedGrant(h.db, { userId: 'u1' });
    seedAppRow(h.db, 'u1');

    const body = (await (
      await h.get(`/v1/entitlements?app_id=${APP}`, `Bearer ${await token('u1')}`)
    ).json()) as Record<string, unknown>;
    expect(body.is_pro).toBe(true);
    expect(body.granted_via).toBe('app');
    // The bundle block is still rendered: the account page has to be able to say
    // "you also hold the bundle", or a user cancels one and silently keeps paying
    // for the other.
    expect(body.bundle).toBeTruthy();
  });

  it('a lifetime bundle grant (no expires_at) grants — the same rule 3 the per-app branch has', async () => {
    const h = harness();
    mintFeatureSet(h.db, 'nikatru_all', 1, [[APP, 'app']]);
    seedGrant(h.db, { userId: 'u1', expiresAt: null });
    const body = (await (
      await h.get(`/v1/entitlements?app_id=${APP}`, `Bearer ${await token('u1')}`)
    ).json()) as Record<string, unknown>;
    expect(body.is_pro).toBe(true);
  });

  it('an expired bundle grant denies, and the per-app answer is unaffected', async () => {
    const h = harness();
    mintFeatureSet(h.db, 'nikatru_all', 1, [[APP, 'app']]);
    seedGrant(h.db, { userId: 'u1', expiresAt: '2020-01-01T00:00:00.000Z' });
    const body = (await (
      await h.get(`/v1/entitlements?app_id=${APP}`, `Bearer ${await token('u1')}`)
    ).json()) as Record<string, unknown>;
    expect(body.is_pro).toBe(false);
    expect(body.granted_via).toBe('none');
    expect(body.bundle).toBeUndefined();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe('G8 — a revocation propagates to EVERY member product', () => {
  it('a revoked grant denies the app AND the extension, not just the one asked about', async () => {
    const h = harness();
    mintFeatureSet(h.db, 'nikatru_all', 1, [
      [APP, 'app'],
      [EXT, 'extension'],
    ]);
    seedGrant(h.db, { userId: 'u1' });
    const authz = `Bearer ${await token('u1')}`;

    // GREEN CONTROL FIRST. Without it, a route that denied everything would
    // "pass" this test and the revocation would be proving nothing.
    const before = (await (await h.get(`/v1/entitlements?app_id=${APP}`, authz)).json()) as Record<string, unknown>;
    expect(before.is_pro).toBe(true);
    // 🔴 AND THE EXTENSION IS ASKED ABOUT ON THE SAME ROUTE. Until 2026-09-10
    // this test never did, and the route answered 404 for it — the name of this
    // test claimed a denial it never observed.
    const extBefore = await h.get(`/v1/entitlements?app_id=${EXT}`, authz);
    expect(extBefore.status).toBe(200);
    expect(((await extBefore.json()) as Record<string, unknown>).is_pro).toBe(true);
    const subjBefore = (await (await h.get('/v1/entitlements/subject', authz)).json()) as {
      products: { product: string }[];
    };
    expect(subjBefore.products.map((p) => p.product)).toEqual([EXT, APP].sort());

    h.db.db
      .prepare(`UPDATE bundle_grants SET revoked_at = ?, revocation_reason = ? WHERE grant_id = 'grant-1'`)
      .run('2026-09-09T12:00:00.000Z', 'refund_approved');

    // 🔴 THE ASSERTION IS ON THE ROUTE'S ANSWER, for BOTH members.
    const after = (await (await h.get(`/v1/entitlements?app_id=${APP}`, authz)).json()) as Record<string, unknown>;
    expect(after.is_pro).toBe(false);
    expect(after.granted_via).toBe('none');
    expect(after.bundle).toBeUndefined();
    const extAfter = await h.get(`/v1/entitlements?app_id=${EXT}`, authz);
    expect(extAfter.status).toBe(200);
    expect((await extAfter.json()) as Record<string, unknown>).toMatchObject({ is_pro: false, granted_via: 'none' });

    const subjAfter = (await (await h.get('/v1/entitlements/subject', authz)).json()) as {
      products: unknown[];
      bundles: unknown[];
    };
    expect(subjAfter.products).toEqual([]);
    expect(subjAfter.bundles).toEqual([]);
  });

  it('a revoked grant reuses the ONE seeded reason set — not a second vocabulary', () => {
    const db = realPlatformDb();
    // The reasons a bundle grant may carry are the rows 0004 seeded. This asserts
    // the relationship rather than a count: a parallel `bundle_revocation_reasons`
    // table would mean two answers to "why did this person lose access".
    const reasons = db
      .rows('SELECT reason FROM revocation_reasons ORDER BY reason')
      .map((r) => String(r.reason));
    expect(reasons).toContain('refund_approved');
    expect(reasons).toContain('chargeback_reversed');
    const bundleReasonTables = db
      .rows(
        "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%revocation%' AND name <> 'revocation_reasons'",
      )
      .map((r) => String(r.name));
    expect(bundleReasonTables).toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe('G10 — a grant covers EXACTLY the version it pinned', () => {
  it('a product added in v2 does not reach a grant that pinned v1', async () => {
    const h = harness();
    mintFeatureSet(h.db, 'nikatru_all', 1, [[EXT, 'extension']]);
    // v2 adds the app. Editing the bundle definition is FORWARD-ONLY: it mints a
    // new version and leaves every existing grant exactly as it was sold.
    mintFeatureSet(h.db, 'nikatru_all', 2, [
      [EXT, 'extension'],
      [APP, 'app'],
    ]);
    seedGrant(h.db, { userId: 'u1', version: 1 });
    const authz = `Bearer ${await token('u1')}`;

    const v1 = (await (await h.get(`/v1/entitlements?app_id=${APP}`, authz)).json()) as Record<string, unknown>;
    expect(v1.is_pro).toBe(false);
    expect(v1.granted_via).toBe('none');

    // 🔴 BOTH DIRECTIONS. Without the second half, a read that resolved NOTHING
    // would pass the first — and "the pin is honoured" would be indistinguishable
    // from "membership never resolves at all".
    seedGrant(h.db, { userId: 'u2', grantId: 'grant-2', version: 2 });
    const v2 = (await (
      await h.get(`/v1/entitlements?app_id=${APP}`, `Bearer ${await token('u2')}`)
    ).json()) as Record<string, unknown>;
    expect(v2.is_pro).toBe(true);
    expect(v2.granted_via).toBe('bundle');
  });

  it('the rendered products come from the PIN, not from the newest version', async () => {
    const h = harness();
    mintFeatureSet(h.db, 'nikatru_all', 1, [[EXT, 'extension']]);
    mintFeatureSet(h.db, 'nikatru_all', 2, [
      [EXT, 'extension'],
      [APP, 'app'],
    ]);
    seedGrant(h.db, { userId: 'u1', version: 1 });
    const subj = (await (
      await h.get('/v1/entitlements/subject', `Bearer ${await token('u1')}`)
    ).json()) as { bundles: { version: number; products: string[] }[] };
    expect(subj.bundles).toHaveLength(1);
    expect(subj.bundles[0].version).toBe(1);
    expect(subj.bundles[0].products).toEqual([EXT]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe('G11 — sandbox money grants no production unlock, on the bundle branch too', () => {
  it('a grant from the OTHER money world denies', async () => {
    const h = harness({ environment: 'live' });
    mintFeatureSet(h.db, 'nikatru_all', 1, [[APP, 'app']]);
    seedGrant(h.db, { userId: 'u1', environment: 'sandbox' });
    const body = (await (
      await h.get(`/v1/entitlements?app_id=${APP}`, `Bearer ${await token('u1')}`)
    ).json()) as Record<string, unknown>;
    expect(body.is_pro).toBe(false);
  });

  it('a grant with NO environment denies — undecidable is not evidence of payment', async () => {
    const h = harness({ environment: 'live' });
    mintFeatureSet(h.db, 'nikatru_all', 1, [[APP, 'app']]);
    seedGrant(h.db, { userId: 'u1', environment: null });
    const body = (await (
      await h.get(`/v1/entitlements?app_id=${APP}`, `Bearer ${await token('u1')}`)
    ).json()) as Record<string, unknown>;
    expect(body.is_pro).toBe(false);
  });

  it('the SAME world grants — so the rule is a comparison, not a constant denial', async () => {
    const h = harness({ environment: 'sandbox' });
    mintFeatureSet(h.db, 'nikatru_all', 1, [[APP, 'app']]);
    seedGrant(h.db, { userId: 'u1', environment: 'sandbox' });
    const body = (await (
      await h.get(`/v1/entitlements?app_id=${APP}`, `Bearer ${await token('u1')}`)
    ).json()) as Record<string, unknown>;
    expect(body.is_pro).toBe(true);
  });

  it('an undeclared MONEY_ENVIRONMENT is a 503 on the subject route too', async () => {
    const h = harness({ environment: null });
    const res = await h.get('/v1/entitlements/subject', `Bearer ${await token('u1')}`);
    expect(res.status).toBe(503);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe('the dates the bundle branch has and the per-app branch does not', () => {
  it('grace_until extends access past expires_at', async () => {
    const h = harness();
    mintFeatureSet(h.db, 'nikatru_all', 1, [[APP, 'app']]);
    seedGrant(h.db, {
      userId: 'u1',
      expiresAt: '2020-01-01T00:00:00.000Z',
      graceUntil: '2099-01-01T00:00:00.000Z',
    });
    const body = (await (
      await h.get(`/v1/entitlements?app_id=${APP}`, `Bearer ${await token('u1')}`)
    ).json()) as Record<string, unknown>;
    expect(body.is_pro).toBe(true);
  });

  it('an UNPARSEABLE grace_until denies — the same fail-closed rule as an unparseable expiry', async () => {
    const h = harness();
    mintFeatureSet(h.db, 'nikatru_all', 1, [[APP, 'app']]);
    seedGrant(h.db, { userId: 'u1', graceUntil: 'whenever' });
    const body = (await (
      await h.get(`/v1/entitlements?app_id=${APP}`, `Bearer ${await token('u1')}`)
    ).json()) as Record<string, unknown>;
    // Note this grant's expires_at is 2099 — it would grant on its own. The
    // undecidable grace is what denies it, which is the whole point: a date we
    // cannot read is not "no grace", it is a row we cannot decide.
    expect(body.is_pro).toBe(false);
  });

  it('a lifetime grant carrying a grace window is undecidable, and denies', async () => {
    const h = harness();
    mintFeatureSet(h.db, 'nikatru_all', 1, [[APP, 'app']]);
    seedGrant(h.db, { userId: 'u1', expiresAt: null, graceUntil: '2099-01-01T00:00:00.000Z' });
    expect(
      ((await (await h.get(`/v1/entitlements?app_id=${APP}`, `Bearer ${await token('u1')}`)).json()) as Record<string, unknown>)
        .is_pro,
    ).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe('the client contract does not change — [ADR 057] §6', () => {
  it('the keys a shipped client reads are exactly what they were, and `bundle` is ABSENT with no grant', async () => {
    const h = harness();
    seedAppRow(h.db, 'u1');
    const body = (await (
      await h.get(`/v1/entitlements?app_id=${APP}`, `Bearer ${await token('u1')}`)
    ).json()) as Record<string, unknown>;

    // 🔴 MEASURED, NOT ASSUMED. packages/core/lib/src/models/entitlement.dart
    // reads `app_id`, `is_pro`, `entitlements` and `verified_at` off the decoded
    // map and ignores every other key — verified by reading the factory, which is
    // why the two new keys are safe. This asserts the half that IS ours: the old
    // keys still carry the old shapes.
    expect(body.app_id).toBe(APP);
    expect(body.is_pro).toBe(true);
    expect(Array.isArray(body.entitlements)).toBe(true);
    expect((body.entitlements as Record<string, unknown>[])[0]).toEqual({
      entitlement: 'pro',
      product_id: null,
      store: null,
      is_active: true,
      expires_at: '2099-01-01T00:00:00.000Z',
      provider: 'paddle',
      provider_status: 'active',
      current_period_end: null,
      trial_end: null,
      revocation_reason: null,
    });
    expect('bundle' in body).toBe(false);
    expect(body.granted_via).toBe('app');
  });

  it('an unknown app is still a 404, never an empty list', async () => {
    const h = harness();
    const res = await h.get('/v1/entitlements?app_id=no-such-app', `Bearer ${await token('u1')}`);
    expect(res.status).toBe(404);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 🔴 THE BUNDLE IS PRODUCTS, NOT APPS. The extension is a register row
// (extensions/catalog/extensions.json), a member of the pinned set, and a thing
// a customer can ask "am I entitled" about. Until 2026-09-10 the route gated
// `app_id` on the app catalogue alone and answered 404 for it — to a customer
// holding a live grant.
//
// MUTATION PROOF: put `isKnownApp` back in routes/entitlements.ts and every case
// below goes RED on `404`.
// ═════════════════════════════════════════════════════════════════════════════
describe('the extension is a product this route answers for', () => {
  it('a live bundle grant makes the EXTENSION entitled, via the bundle, on the per-product route', async () => {
    const h = harness();
    mintFeatureSet(h.db, 'nikatru_all', 1, [
      [APP, 'app'],
      [EXT, 'extension'],
    ]);
    seedGrant(h.db, { userId: 'u1' });
    const res = await h.get(`/v1/entitlements?app_id=${EXT}`, `Bearer ${await token('u1')}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ app_id: EXT, is_pro: true, granted_via: 'bundle' });
    expect(body.bundle).toMatchObject({ feature_set: 'nikatru_all', version: 1 });
    expect((body.bundle as { products: string[] }).products.sort()).toEqual([EXT, APP].sort());
  });

  it('a known extension with NO grant is 200 and not entitled — a real answer, not "no such app"', async () => {
    const h = harness();
    const res = await h.get(`/v1/entitlements?app_id=${EXT}`, `Bearer ${await token('u1')}`);
    expect(res.status).toBe(200);
    expect((await res.json()) as Record<string, unknown>).toMatchObject({ is_pro: false, granted_via: 'none' });
  });

  it('a slug in NO register is still 404 — the set widened to every register, not to every string', async () => {
    const h = harness();
    const res = await h.get('/v1/entitlements?app_id=not_a_product', `Bearer ${await token('u1')}`);
    expect(res.status).toBe(404);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe('GET /v1/entitlements/subject', () => {
  it('🔴 refuses an unauthenticated request with 401 SPECIFICALLY', async () => {
    // A route that does not exist also returns non-2xx, so "refused" is not the
    // claim — 401 is. This is the assertion that would have caught the real
    // defect: `app.use("/v1/entitlements", …)` does not cover sub-paths in Hono,
    // so this route shipped outside the middleware until a second mount was added.
    const res = await harness().get('/v1/entitlements/subject');
    expect(res.status).toBe(401);
  });

  it('never returns another user’s products', async () => {
    const h = harness();
    mintFeatureSet(h.db, 'nikatru_all', 1, [[APP, 'app']]);
    seedGrant(h.db, { userId: 'other-user' });
    seedAppRow(h.db, 'other-user');
    const body = (await (
      await h.get('/v1/entitlements/subject', `Bearer ${await token('u1')}`)
    ).json()) as { products: unknown[]; bundles: unknown[] };
    expect(body.products).toEqual([]);
    expect(body.bundles).toEqual([]);
  });

  it('lists per-app and bundle products together, deduped, with the app branch winning', async () => {
    const h = harness();
    mintFeatureSet(h.db, 'nikatru_all', 1, [
      [APP, 'app'],
      [EXT, 'extension'],
    ]);
    seedGrant(h.db, { userId: 'u1' });
    seedAppRow(h.db, 'u1');
    const body = (await (
      await h.get('/v1/entitlements/subject', `Bearer ${await token('u1')}`)
    ).json()) as { products: { product: string; granted_via: string }[] };
    expect(body.products).toEqual([
      { product: EXT, granted_via: 'bundle', expires_at: '2099-01-01T00:00:00.000Z' },
      { product: APP, granted_via: 'app', expires_at: '2099-01-01T00:00:00.000Z' },
    ]);
  });

  it('names the rail that holds the subscription — the only honest thing a UI can say', async () => {
    const h = harness();
    mintFeatureSet(h.db, 'nikatru_all', 1, [[APP, 'app']]);
    seedGrant(h.db, { userId: 'u1', source: 'apple_iap' });
    const body = (await (
      await h.get('/v1/entitlements/subject', `Bearer ${await token('u1')}`)
    ).json()) as { bundles: { source: string }[] };
    // Cross-rail cancellation is impossible by construction, so "manage your
    // subscription where you bought it" is the UI — and it needs this field.
    expect(body.bundles[0].source).toBe('apple_iap');
  });
});
