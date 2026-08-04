// ─────────────────────────────────────────────────────────────────────────────
// platformAuth + DELETE /v1/account — the shared server's ONLY authenticated
// surface, exercised end to end against a REAL SQL ENGINE and a REAL ES256
// signature.
//
// [pipeline B-3] the shared server can verify an identity token and expose a
// user id · [B-5] one authenticated request erases a person from platform_db and
// the identity provider · [B-4b]'s tenancy property, on the route that exists.
//
// ── WHY THE KEYS ARE REAL AND THE NETWORK IS NOT ─────────────────────────────
// A real ES256 key pair is generated per run and the JWKS document is served by
// a STUBBED `fetch`, so:
//   · the primary (and only) verification path is the one under assertion —
//     services/subly-api's suite has to disable the network and fall through to
//     HS256 to test anything, and this Worker HAS no HS256 path to fall through
//     to, which is the whole point;
//   · no test depends on Supabase's uptime;
//   · "signature verification actually happens" is proven by a token signed with
//     a DIFFERENT real key being refused — not by a mock returning false.
//
// 🔴 THE THIRD TOKEN CASE IS THE RECORDED FAILING INPUT FOR THE FALLBACK
// REMOVAL. `services/subly-api/src/middleware/auth.ts` accepts a token signed
// with a shared HS256 secret when the asymmetric path fails. Carrying that here
// would mean the portfolio's one auth boundary — guarding account deletion for
// every app — accepts a symmetric secret. The "legacy HS256 token is refused"
// test below is what stops it being re-added by a well-meaning port.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Hono } from 'hono';
import { SignJWT, exportJWK, generateKeyPair, type JWK, type KeyLike } from 'jose';
import { platformAuth } from '../src/middleware/auth';
import account, { parseErasureEndpoints } from '../src/routes/account';
import type { AppEnv } from '../src/types';
import { realPlatformDb, type RealDb } from './harness';

const SUPABASE_URL = 'https://project-a.supabase.co';
const OTHER_URL = 'https://project-b.supabase.co';
const ISSUER = `${SUPABASE_URL}/auth/v1`;

let signingKey: KeyLike;
let publicJwk: JWK;
/** A second, unrelated ES256 pair — a well-formed token from the wrong key. */
let foreignKey: KeyLike;
const HS256_SECRET = new TextEncoder().encode('legacy-shared-secret-for-tests-only');

/** base64url without `Buffer`. The workerd build has no Node globals, and
 *  reaching for one here would be the same test-vs-production divergence
 *  vitest.config.ts exists to remove. */
const b64urlEncode = (s: string) =>
  btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64urlDecode = (s: string) =>
  atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '='));

/** Every DELETE the stubbed fetch saw, so the identity limb is asserted on what
 *  was REQUESTED rather than on the route's own return value. */
let identityCalls: Array<{ url: string; method: string; hasKey: boolean }> = [];
let identityStatus = 204;

/** The per-app erasure relay ([4]B-5 limb 3). Recorded the same way and for the
 *  same reason: "the app's rows were erased" is a claim about a REQUEST THIS
 *  WORKER MADE, and the response body cannot be evidence for it. */
const APP_ORIGIN = 'https://api.test';
const APP_ENDPOINTS = `subly=${APP_ORIGIN}`;
let appCalls: Array<{ url: string; method: string; authorization: string | null }> = [];
let appStatus = 200;
/** When set, the relay fetch THROWS — an app Worker that cannot be reached at
 *  all, which is a different failure from one that answers badly. */
let appThrows = false;

/** Every fetch stubs into exactly one of three worlds. A URL that matches none
 *  throws, so a new outbound call added to the route surfaces as a red test
 *  rather than as a silent 204. */
const ORDER: string[] = [];

beforeAll(async () => {
  const pair = await generateKeyPair('ES256', { extractable: true });
  signingKey = pair.privateKey;
  publicJwk = { ...(await exportJWK(pair.publicKey)), alg: 'ES256', kid: 'test-key-1' };
  foreignKey = (await generateKeyPair('ES256', { extractable: true })).privateKey;

  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/.well-known/jwks.json')) {
      return new Response(JSON.stringify({ keys: [publicJwk] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url.includes('/auth/v1/admin/users/')) {
      const headers = new Headers(init?.headers);
      ORDER.push('identity');
      identityCalls.push({
        url,
        method: init?.method ?? 'GET',
        hasKey: headers.get('apikey') !== null && headers.get('Authorization') !== null,
      });
      return new Response(null, { status: identityStatus });
    }
    if (url.startsWith(APP_ORIGIN)) {
      ORDER.push('app');
      appCalls.push({
        url,
        method: init?.method ?? 'GET',
        authorization: new Headers(init?.headers).get('Authorization'),
      });
      if (appThrows) throw new TypeError('fetch failed');
      return new Response(JSON.stringify({ ok: true, scope: 'subly_db' }), { status: appStatus });
    }
    throw new Error(`unexpected fetch in test: ${url}`);
  });
});
afterAll(() => vi.unstubAllGlobals());

const KV = {
  get: async () => null,
  put: async () => undefined,
} as unknown as KVNamespace;

async function token(
  claims: Record<string, unknown>,
  { issuer = ISSUER, audience = 'authenticated', key = null as KeyLike | null, alg = 'ES256' } = {},
) {
  let t = new SignJWT(claims)
    .setProtectedHeader({ alg, kid: alg === 'ES256' ? 'test-key-1' : undefined })
    .setIssuedAt()
    .setExpirationTime('1h')
    .setAudience(audience);
  if (issuer) t = t.setIssuer(issuer);
  return t.sign(key ?? (alg === 'ES256' ? signingKey : HS256_SECRET));
}

/** The real Worker shape: a public route and the authenticated one, so
 *  "auth did not leak onto the public surface" is asserted, not assumed. */
/** ⚠️ `null` means NO service-role key, never `undefined`. An `undefined`
 *  argument is swallowed by the parameter default and the test then asserts the
 *  CONFIGURED path while claiming to assert the unconfigured one — which is
 *  exactly what happened here on the first run, and is the same trap
 *  services/subly-api/test/auth.test.ts records against its own secret. */
function harness({
  serviceRoleKey = 'service-role-key' as string | null,
  db = realPlatformDb(),
  appEndpoints = APP_ENDPOINTS as string | null,
}: { serviceRoleKey?: string | null; db?: RealDb; appEndpoints?: string | null } = {}) {
  identityCalls = [];
  identityStatus = 204;
  appCalls = [];
  appStatus = 200;
  appThrows = false;
  ORDER.length = 0;
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => { c.set('requestId', 'rid-test'); await next(); });
  app.get('/v1/health', (c) => c.json({ ok: true }));
  app.use('/v1/account', platformAuth);
  app.route('/v1', account);
  app.get('/v1/whoami', platformAuth, (c) =>
    c.json({ userId: c.get('userId'), email: c.get('userEmail') }),
  );

  const env = {
    PLATFORM_DB: db,
    JWKS_CACHE: KV,
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey ?? undefined,
    APP_ERASURE_ENDPOINTS: appEndpoints ?? undefined,
    APP_ID: 'platform',
    API_VERSION: 'v1',
  } as unknown as AppEnv['Bindings'];

  return {
    db,
    get: (path: string, authz?: string) =>
      app.request(path, { headers: authz === undefined ? {} : { Authorization: authz } }, env),
    del: (path: string, authz?: string) =>
      app.request(path, { method: 'DELETE', headers: authz === undefined ? {} : { Authorization: authz } }, env),
  };
}

/** Entitlement rows are the only user-owned rows platform_db has today. */
function seedEntitlement(db: RealDb, userId: string, appId = 'subly') {
  db.db
    .prepare(
      `INSERT INTO entitlements (user_id, app_id, entitlement, product_id, store, is_active, expires_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?)`,
    )
    .run(userId, appId, 'pro', 'p1', 'APP_STORE', 1, null, '2026-08-01T00:00:00Z');
}

describe('platformAuth ACCEPTS only a real ES256 token from THIS project', () => {
  it('accepts a valid ES256 token and exposes sub + email', async () => {
    const res = await harness().get('/v1/whoami', `Bearer ${await token({ sub: 'user-a', email: 'a@test.dev' })}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ userId: 'user-a', email: 'a@test.dev' });
  });

  it('accepts a token with no email claim', async () => {
    const res = await harness().get('/v1/whoami', `Bearer ${await token({ sub: 'user-a' })}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ userId: 'user-a' });
  });

  it('401s a TAMPERED token', async () => {
    // The signature covers the payload, so flipping a claim breaks it. This is
    // the assertion that verification is happening at all rather than the token
    // being decoded and trusted.
    const good = await token({ sub: 'user-a' });
    const [h, p, s] = good.split('.');
    const payload = JSON.parse(b64urlDecode(p));
    payload.sub = 'user-b';
    const forged = `${h}.${b64urlEncode(JSON.stringify(payload))}.${s}`;
    const res = await harness().get('/v1/whoami', `Bearer ${forged}`);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthorized' });
  });

  it('401s a token signed with the LEGACY HS256 SECRET — there is no fallback', async () => {
    // 🔴 THE RECORDED FAILING INPUT FOR THE FALLBACK REMOVAL. services/subly-api
    // ACCEPTS this exact token when SUPABASE_JWT_SECRET is configured. Re-adding
    // that path here — by porting the sibling file wholesale, which is precisely
    // how it would happen — turns this test red.
    const hs = await token({ sub: 'user-a' }, { alg: 'HS256' });
    const res = await harness().get('/v1/whoami', `Bearer ${hs}`);
    expect(res.status).toBe(401);
  });

  it('401s a well-formed token signed with a DIFFERENT ES256 key', async () => {
    const res = await harness().get('/v1/whoami', `Bearer ${await token({ sub: 'user-a' }, { key: foreignKey })}`);
    expect(res.status).toBe(401);
  });

  it('401s a token from ANOTHER Supabase project', async () => {
    // Correct key, correct algorithm, wrong issuer. Without the `issuer` option
    // this passes — and every user of every other project on the same key would
    // be authenticated here.
    const res = await harness().get('/v1/whoami', `Bearer ${await token({ sub: 'user-a' }, { issuer: `${OTHER_URL}/auth/v1` })}`);
    expect(res.status).toBe(401);
  });

  it('401s a token with the wrong audience', async () => {
    const res = await harness().get('/v1/whoami', `Bearer ${await token({ sub: 'user-a' }, { audience: 'anon' })}`);
    expect(res.status).toBe(401);
  });

  it('401s an EXPIRED token', async () => {
    const expired = await new SignJWT({ sub: 'user-a' })
      .setProtectedHeader({ alg: 'ES256', kid: 'test-key-1' })
      .setIssuer(ISSUER)
      .setAudience('authenticated')
      .setIssuedAt(Math.floor(Date.now() / 1000) - 7200)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 3600)
      .sign(signingKey);
    const res = await harness().get('/v1/whoami', `Bearer ${expired}`);
    expect(res.status).toBe(401);
  });

  it('401s a verified token carrying NO `sub`', async () => {
    // A token nobody is the subject of authenticates nobody. Letting it through
    // sets userId to undefined and hands `WHERE user_id = ?` a null — which on
    // the DELETE route is the difference between erasing nothing and being asked
    // to erase everything.
    const res = await harness().get('/v1/whoami', `Bearer ${await token({ email: 'a@test.dev' })}`);
    expect(res.status).toBe(401);
  });

  it('401s a missing, malformed or non-Bearer Authorization header', async () => {
    const h = harness();
    for (const authz of [undefined, '', 'Bearer', 'Basic abc', `${await token({ sub: 'user-a' })}`]) {
      const res = await h.get('/v1/whoami', authz);
      expect(res.status, JSON.stringify(authz)).toBe(401);
    }
  });

  it('does NOT put auth in front of the public routes', async () => {
    // ⚠️ The `use` is path-scoped. A global `app.use('*', platformAuth)` would
    // lock every app out of GET /config/:app on its launch path, and silently
    // stop all pre-login analytics — the events that matter most.
    const res = await harness().get('/v1/health');
    expect(res.status).toBe(200);
  });
});

describe('DELETE /v1/account — three limbs, executed against a real engine', () => {
  it('refuses 501 when SUPABASE_SERVICE_ROLE_KEY is unset, and destroys NOTHING', async () => {
    // The route ships before the owner sets the secret, and is HONEST about it.
    // The precondition is checked BEFORE any delete: a partial erasure that
    // leaves a working login is strictly worse than a refusal.
    const h = harness({ serviceRoleKey: null });
    seedEntitlement(h.db, 'user-a');
    const res = await h.del('/v1/account', `Bearer ${await token({ sub: 'user-a' })}`);
    expect(res.status).toBe(501);
    expect(await res.json()).toEqual({ error: 'account_deletion_unconfigured' });
    expect(h.db.count('entitlements')).toBe(1);
    expect(identityCalls).toHaveLength(0);
  });

  it('401s an unauthenticated deletion before reaching the route at all', async () => {
    const h = harness();
    seedEntitlement(h.db, 'user-a');
    const res = await h.del('/v1/account');
    expect(res.status).toBe(401);
    expect(h.db.count('entitlements')).toBe(1);
  });

  it('LIMB 1+2 — empties every user-owned table for that user, by query', async () => {
    const h = harness();
    seedEntitlement(h.db, 'user-a');
    seedEntitlement(h.db, 'user-a', 'other-app');
    const res = await h.del('/v1/account', `Bearer ${await token({ sub: 'user-a' })}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; deleted: Record<string, number> };
    expect(body.ok).toBe(true);
    expect(body.deleted.entitlements).toBe(2);
    expect(h.db.count('entitlements', 'user_id = ?', 'user-a')).toBe(0);
  });

  it('TENANCY — user A\'s deletion leaves user B\'s rows untouched', async () => {
    // 🔴 The property [4]B-4b is about, on the one authenticated route that
    // exists. A `DELETE FROM entitlements` with the WHERE dropped passes every
    // other test in this file and fails only this one.
    const h = harness();
    seedEntitlement(h.db, 'user-a');
    seedEntitlement(h.db, 'user-b');
    await h.del('/v1/account', `Bearer ${await token({ sub: 'user-a' })}`);
    expect(h.db.count('entitlements', 'user_id = ?', 'user-a')).toBe(0);
    expect(h.db.count('entitlements', 'user_id = ?', 'user-b')).toBe(1);
  });

  it('LIMB 3 — the IDENTITY record is deleted, last, with the service-role key', async () => {
    // Row counts cannot fake this limb, which is exactly why it is the one that
    // was missing. Asserted on the request the route MADE.
    const h = harness();
    seedEntitlement(h.db, 'user-a');
    const res = await h.del('/v1/account', `Bearer ${await token({ sub: 'user-a' })}`);
    expect(res.status).toBe(200);
    expect(identityCalls).toHaveLength(1);
    expect(identityCalls[0].method).toBe('DELETE');
    expect(identityCalls[0].url).toContain('/auth/v1/admin/users/user-a');
    expect(identityCalls[0].hasKey).toBe(true);
  });

  it('a user id needing escaping is not injected into the admin URL', async () => {
    const h = harness();
    const res = await h.del('/v1/account', `Bearer ${await token({ sub: 'a/../admin b' })}`);
    expect(res.status).toBe(200);
    expect(identityCalls[0].url).toContain(encodeURIComponent('a/../admin b'));
  });

  it('502s when the identity delete fails — NEVER ok:true', async () => {
    // The data is gone and the login is not. The user must be told: a "deleted"
    // they cannot verify is the failure the client half refuses to fake.
    const h = harness();
    seedEntitlement(h.db, 'user-a');
    identityStatus = 500;
    const res = await h.del('/v1/account', `Bearer ${await token({ sub: 'user-a' })}`);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'identity_delete_failed' });
  });

  it('treats a 404 from the identity provider as DONE, so a retry succeeds', async () => {
    // The purges are idempotent, so the second pass of a partially-failed
    // deletion must not fail on "the user is already gone" — which is the state
    // the first pass was trying to reach.
    const h = harness();
    identityStatus = 404;
    const res = await h.del('/v1/account', `Bearer ${await token({ sub: 'user-a' })}`);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { deleted: Record<string, number> }).deleted.identity).toBe(1);
  });

  it('DERIVES the table set from the schema — a NEW user-owned table is purged with no route edit', async () => {
    // 🔴 THE UPGRADE OVER THE BRICK TEMPLATE, ASSERTED. The template carries
    // `const appTables = ['records'];` and a comment warning that missing a
    // table there means orphaned PII. Here the schema answers, so a migration
    // adding a user-owned table is covered by that migration alone.
    const db = realPlatformDb([
      'CREATE TABLE saved_items (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, body TEXT);',
    ]);
    db.db.prepare('INSERT INTO saved_items (id, user_id, body) VALUES (?,?,?)').run('s1', 'user-a', 'x');
    db.db.prepare('INSERT INTO saved_items (id, user_id, body) VALUES (?,?,?)').run('s2', 'user-b', 'y');
    const h = harness({ db });
    const res = await h.del('/v1/account', `Bearer ${await token({ sub: 'user-a' })}`);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { deleted: Record<string, number> }).deleted.saved_items).toBe(1);
    expect(db.count('saved_items', 'user_id = ?', 'user-b')).toBe(1);
  });

  it('leaves `events` and `consent_artifacts` alone — they have NO user_id, by design', async () => {
    // ⚠️ NOT AN OVERSIGHT AND NOT A GAP. [ADR 020] forbids ever writing an
    // anon_id -> user_id map, so those tables cannot be attributed to a person
    // and "zero rows for this user" is vacuously true of them. The derivation
    // reaches that answer from the schema instead of from a hardcoded exclusion
    // somebody could later "fix".
    const h = harness();
    h.db.db
      .prepare(
        `INSERT INTO events (event_id, app_id, anon_id, event, server_ts) VALUES (?,?,?,?,?)`,
      )
      .run('e1', 'subly', 'anon-1', 'first_launch', '2026-08-01T00:00:00Z');
    await h.del('/v1/account', `Bearer ${await token({ sub: 'user-a' })}`);
    expect(h.db.count('events')).toBe(1);
    expect(h.db.sql.some((s) => /DELETE FROM events\b/.test(s))).toBe(false);
  });

  it('refuses 503 when the derivation finds NO user-owned table', async () => {
    // 🔴 AN EMPTY SET IS A FAILURE, NOT A FAST PATH. Without this the route
    // would delete nothing, answer ok:true, and then delete the identity —
    // orphaning every row behind a login that no longer exists.
    //
    // ⚠️ THE SET GREW ON 2026-08-01 and this fixture had to grow with it — which
    // is the derivation working, not a test getting harder. [pipeline 5]M-7's
    // `provider_accounts` (the (provider, subscription) -> account link) carries
    // a `user_id`, so it is user-owned by definition and the route now erases it
    // with no edit to the route. Dropping only `entitlements` therefore no longer
    // empties the set. EVERY user-owned table must be dropped for this case to
    // arise, so the assertion is still "an empty derivation is a refusal".
    //
    // ⚠️ AND IT GREW AGAIN with [5]M-9's `cancellation_requests`, which is the
    // derivation working a second time: the table was added by a migration and
    // spelled its column `user_id`, so the erasure route empties it with no edit
    // to the route and this fixture is the only place that had to change.
    //
    // ⚠️ AND A THIRD TIME with 0006's `provider_notifications.user_id` — the
    // column that put the one non-pseudonymous table in platform_db inside the
    // reach of "delete my account" ([pipeline K-7]). Again: a migration, no route
    // edit, and this fixture the only thing that moved.
    const db = realPlatformDb();
    db.db.exec('DROP TABLE entitlements;');
    db.db.exec('DROP TABLE provider_accounts;');
    db.db.exec('DROP TABLE cancellation_requests;');
    db.db.exec('DROP TABLE provider_notifications;');
    const res = await harness({ db }).del('/v1/account', `Bearer ${await token({ sub: 'user-a' })}`);
    expect(res.status).toBe(503);
    expect(identityCalls).toHaveLength(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe("LIMB 3 — every app's OWN database, through that app's OWN route", () => {
  // 🔴 THE DEFECT THIS LIMB CLOSES. Everything above operates on PLATFORM_DB.
  // This Worker also BINDS subly_db — and bound is not swept, because a route
  // reads the databases it reads. So the only app in the field was the one app
  // account deletion did not reach: a Subly user could delete their account, lose
  // their login, and leave every subscription they had ever entered in a database
  // no login could reach again. Sweeping SUBLY_DB from here was rejected (it puts
  // one app's schema in the shared Worker, and makes any FUTURE binding an
  // erasure target the day somebody adds it); each app owns its own erasure and
  // this route orchestrates.

  it('calls each app\'s DELETE /v1/account, forwarding the CALLER\'S OWN token', async () => {
    // Forwarded rather than re-minted, and asserted as such: this Worker holds no
    // key that could sign a token for this user, and it must not — the app route
    // (services/subly-api) refuses anything that is not asymmetrically verified,
    // which is the property that let an erasure route exist on that Worker at all.
    const h = harness();
    const authz = `Bearer ${await token({ sub: 'user-a' })}`;
    const res = await h.del('/v1/account', authz);
    expect(res.status).toBe(200);
    expect(appCalls).toHaveLength(1);
    expect(appCalls[0].method).toBe('DELETE');
    expect(appCalls[0].url).toBe(`${APP_ORIGIN}/v1/account`);
    expect(appCalls[0].authorization).toBe(authz);
    expect(((await res.json()) as { apps: Record<string, string> }).apps).toEqual({
      subly: 'deleted',
    });
  });

  it('calls it BEFORE the identity delete — order is the whole safety property', async () => {
    // 🔴 THE ONE ASSERTION THE STATUS CODES CANNOT MAKE. If the identity went
    // first, an app purge that then failed would leave orphaned rows behind an
    // account that no longer exists — unreachable by anyone, for ever. This way
    // round the user keeps a working login and a retryable request.
    const h = harness();
    await h.del('/v1/account', `Bearer ${await token({ sub: 'user-a' })}`);
    expect(ORDER).toEqual(['app', 'identity']);
  });

  it('502s and does NOT delete the identity when an app route refuses', async () => {
    const h = harness();
    seedEntitlement(h.db, 'user-a');
    appStatus = 403; // e.g. the app route refusing a non-asymmetric proof
    const res = await h.del('/v1/account', `Bearer ${await token({ sub: 'user-a' })}`);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'app_data_delete_failed', app: 'subly' });
    expect(identityCalls).toHaveLength(0);
  });

  it('502s when the app route cannot be REACHED at all', async () => {
    const h = harness();
    appThrows = true;
    const res = await h.del('/v1/account', `Bearer ${await token({ sub: 'user-a' })}`);
    expect(res.status).toBe(502);
    expect(identityCalls).toHaveLength(0);
  });

  it('does NOT forgive a 404 from an app route, the way it forgives one from the identity provider', async () => {
    // ⚠️ THE SAME STATUS MEANS OPPOSITE THINGS ON THE TWO LIMBS. From Supabase,
    // 404 is "the user is already gone" — the goal state, so a retry can finish.
    // From an app Worker it is "there is no erasure route here", i.e. those rows
    // were never erased by anybody. Treating them alike would turn a missing route
    // into a reported success — the exact failure mode this whole change is about.
    const h = harness();
    appStatus = 404;
    const res = await h.del('/v1/account', `Bearer ${await token({ sub: 'user-a' })}`);
    expect(res.status).toBe(502);
    expect(identityCalls).toHaveLength(0);
  });

  it('refuses 501 when APP_ERASURE_ENDPOINTS is UNSET, and destroys nothing', async () => {
    // An empty list is a refusal, not "no apps to clean up". A deployment that
    // lost this var would erase platform_db and the identity, answer ok:true, and
    // orphan every app-owned row — the original defect, re-created by config
    // drift. Checked BEFORE anything is destroyed, like the service-role key.
    const h = harness({ appEndpoints: null });
    seedEntitlement(h.db, 'user-a');
    const res = await h.del('/v1/account', `Bearer ${await token({ sub: 'user-a' })}`);
    expect(res.status).toBe(501);
    expect(await res.json()).toEqual({ error: 'account_deletion_unconfigured' });
    expect(h.db.count('entitlements')).toBe(1);
    expect(appCalls).toHaveLength(0);
    expect(identityCalls).toHaveLength(0);
  });

  it('refuses 501 on a NON-https endpoint rather than putting a live token on the wire', async () => {
    const h = harness({ appEndpoints: 'subly=http://api.test' });
    seedEntitlement(h.db, 'user-a');
    const res = await h.del('/v1/account', `Bearer ${await token({ sub: 'user-a' })}`);
    expect(res.status).toBe(501);
    expect(h.db.count('entitlements')).toBe(1);
    expect(appCalls).toHaveLength(0);
  });

  it('refuses 501 on a malformed entry rather than silently skipping that app', async () => {
    // A dropped entry is an app whose rows quietly stop being erased, which looks
    // exactly like success. Throwing is what turns it into a refusal.
    for (const bad of ['subly', '=https://api.test', 'subly=notaurl']) {
      const h = harness({ appEndpoints: bad });
      const res = await h.del('/v1/account', `Bearer ${await token({ sub: 'user-a' })}`);
      expect(res.status, bad).toBe(501);
      expect(appCalls, bad).toHaveLength(0);
    }
  });

  it('relays to EVERY declared app, not just the first', async () => {
    // The loop is what makes app #2 covered by adding one entry. A route that
    // erased only `endpoints[0]` passes every other test in this file.
    const h = harness({ appEndpoints: `subly=${APP_ORIGIN},other=${APP_ORIGIN}` });
    const res = await h.del('/v1/account', `Bearer ${await token({ sub: 'user-a' })}`);
    expect(res.status).toBe(200);
    expect(appCalls).toHaveLength(2);
    expect(((await res.json()) as { apps: Record<string, string> }).apps).toEqual({
      subly: 'deleted',
      other: 'deleted',
    });
  });
});

describe('parseErasureEndpoints', () => {
  it('parses, trims and strips a trailing slash', () => {
    expect(parseErasureEndpoints(' subly=https://api.test/ , other=https://b.test ')).toEqual([
      { appId: 'subly', origin: 'https://api.test' },
      { appId: 'other', origin: 'https://b.test' },
    ]);
  });

  it('is empty for an absent or blank value — the CALLER decides that is a refusal', () => {
    // Deliberately NOT throwing here: "nothing configured" and "misconfigured"
    // are different facts, and the route logs them differently.
    expect(parseErasureEndpoints(undefined)).toEqual([]);
    expect(parseErasureEndpoints('   ')).toEqual([]);
  });

  it('throws on a path, a query string or a non-https scheme', () => {
    for (const bad of [
      'subly=https://api.test/v1',
      'subly=https://api.test?x=1',
      'subly=http://api.test',
      'subly=api.test',
    ]) {
      expect(() => parseErasureEndpoints(bad), bad).toThrow(RangeError);
    }
  });
});
