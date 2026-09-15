// ─────────────────────────────────────────────────────────────────────────────
// signup-erasure.test.ts — [ADR 087] §3: the nikatru.com launch list (`signups`,
// keyed by email) is reached by DELETE /v1/account through the account's CONFIRMED
// address, read from the identity provider BEFORE the identity is deleted.
//
// ⏱ 2026-09-15. Real migrations (0010 + 0011) on a real SQL engine, the real route,
// the real nightly retry. What each case pins:
//   · confirmed → the row goes (any letter case), a bystander's row stays, and the
//     account read happens BEFORE the identity DELETE;
//   · unconfirmed or no address → skipped and said so, the erasure still completes;
//   · a transient read failure (5xx) → 202 erasure_pending, the IDENTITY IS KEPT, the
//     step is in the ledger; the retry later finishes BOTH the purge and the identity;
//   · a refused read (403) → 502, identity kept — never a guess.
// tooling/ci/assert-erasure-reach.mjs limb 5 holds the same order statically.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { Hono } from 'hono';
import { SignJWT, exportJWK, generateKeyPair, type JWK, type KeyLike } from 'jose';
import { platformAuth } from '../src/middleware/auth';
import account from '../src/routes/account';
import { erasureRetry } from '../src/scheduled';
import { SIGNUP_PURGE_STEP } from '../src/lib/erasure-ledger';
import type { AppEnv, Env } from '../src/types';
import { realPlatformDb, type RealDb } from './harness';

const SUPABASE_URL = 'https://signups.supabase.co';
const ISSUER = `${SUPABASE_URL}/auth/v1`;
const APP_ORIGIN = 'https://api.test';
const SUBJECT = 'signup-subject-41d2';
const NOW_MS = Date.parse('2026-09-20T06:00:00.000Z');

let signingKey: KeyLike;
let publicJwk: JWK;
/** Every call to the identity provider's admin user endpoint, in order. */
let adminCalls: Array<{ method: string; url: string }> = [];
/** What the account READ answers. */
let userRead: { status: number; body: unknown } = { status: 200, body: {} };

beforeAll(async () => {
  const pair = await generateKeyPair('ES256', { extractable: true });
  signingKey = pair.privateKey;
  publicJwk = { ...(await exportJWK(pair.publicKey)), alg: 'ES256', kid: 'test-key-1' };
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/.well-known/jwks.json')) {
      return new Response(JSON.stringify({ keys: [publicJwk] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url.startsWith(`${SUPABASE_URL}/auth/v1/admin/users/`)) {
      const method = init?.method ?? 'GET';
      adminCalls.push({ method, url });
      if (method === 'GET') return new Response(JSON.stringify(userRead.body), { status: userRead.status });
      return new Response(null, { status: 204 });
    }
    if (url.startsWith(APP_ORIGIN)) return new Response('{"ok":true}', { status: 200 });
    throw new Error(`unexpected fetch in test: ${url}`);
  });
});
afterAll(() => vi.unstubAllGlobals());
beforeEach(() => {
  adminCalls = [];
  userRead = { status: 200, body: {} };
});

const confirmed = (email: string) => ({ status: 200, body: { id: SUBJECT, email, email_confirmed_at: '2026-01-02T03:04:05Z' } });

const KV = { get: async () => null, put: async () => undefined } as unknown as KVNamespace;

function envOf(db: RealDb): AppEnv['Bindings'] {
  return {
    PLATFORM_DB: db,
    JWKS_CACHE: KV,
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
    APP_ERASURE_ENDPOINTS: `subscriptiontracker=${APP_ORIGIN}`,
    APP_ID: 'platform',
    API_VERSION: 'v1',
  } as unknown as AppEnv['Bindings'];
}

async function deleteAccount(db: RealDb) {
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => {
    c.set('requestId', 'rid-signups');
    await next();
  });
  app.use('/v1/account', platformAuth);
  app.route('/v1', account);
  const token = await new SignJWT({ sub: SUBJECT })
    .setProtectedHeader({ alg: 'ES256', kid: 'test-key-1' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .setIssuer(ISSUER)
    .setAudience('authenticated')
    .sign(signingKey);
  return app.request('/v1/account', { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }, envOf(db));
}

function seeded(): RealDb {
  const db = realPlatformDb();
  db.db.exec(
    `INSERT INTO signups (email, signed_up_at) VALUES
       ('person@example.com', '2026-03-01T00:00:00.000Z'),
       ('bystander@example.com', '2026-03-02T00:00:00.000Z')`,
  );
  return db;
}
const emails = (db: RealDb) => db.rows('SELECT email FROM signups ORDER BY email').map((r) => String(r.email));
const identityDeletes = () => adminCalls.filter((c) => c.method === 'DELETE');
const steps = (db: RealDb) =>
  db.rows('SELECT app_id, confirmed_at FROM pending_erasures WHERE subject_ref = ?', SUBJECT) as Array<{ app_id: string; confirmed_at: string | null }>;

describe('a CONFIRMED account address takes its signup off the list', () => {
  it('deletes the row (any letter case), keeps a bystander, and reads the account BEFORE deleting the identity', async () => {
    const db = seeded();
    userRead = confirmed('Person@Example.COM');
    const res = await deleteAccount(db);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { signups: string; deleted: Record<string, number> };
    expect(body.signups).toBe('purged');
    expect(body.deleted.signups).toBe(1);
    expect(body.deleted.identity).toBe(1);
    expect(emails(db)).toEqual(['bystander@example.com']);
    expect(adminCalls.map((c) => c.method)).toEqual(['GET', 'DELETE']);
  });
});

describe('no confirmed address — skipped, said so, and the erasure still completes', () => {
  it('an UNCONFIRMED address is not trusted: the row stays and the identity is still deleted', async () => {
    const db = seeded();
    userRead = { status: 200, body: { id: SUBJECT, email: 'person@example.com', email_confirmed_at: null } };
    const res = await deleteAccount(db);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { signups: string }).signups).toBe('skipped_unconfirmed');
    expect(emails(db)).toEqual(['bystander@example.com', 'person@example.com']);
    expect(identityDeletes()).toHaveLength(1);
  });

  it('an account with no address skips the purge the same way', async () => {
    const db = seeded();
    userRead = { status: 200, body: { id: SUBJECT, phone: '+10000000000' } };
    const res = await deleteAccount(db);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { signups: string }).signups).toBe('skipped_no_email');
    expect(emails(db)).toHaveLength(2);
    expect(identityDeletes()).toHaveLength(1);
  });
});

describe('🔴 the address cannot be read — the identity is NEVER deleted on a guess', () => {
  it('a 5xx from the identity provider is 202 erasure_pending, the step is queued, the identity kept', async () => {
    const db = seeded();
    userRead = { status: 503, body: { message: 'unavailable' } };
    const res = await deleteAccount(db);
    expect(res.status).toBe(202);
    const body = (await res.json()) as { status: string; pending: string[]; signups: string };
    expect(body.status).toBe('erasure_pending');
    expect(body.pending).toContain(SIGNUP_PURGE_STEP);
    expect(body.signups).toBe('pending');
    expect(identityDeletes()).toHaveLength(0);
    expect(steps(db)).toEqual([{ app_id: SIGNUP_PURGE_STEP, confirmed_at: null }]);
    expect(emails(db)).toHaveLength(2);
  });

  it('a refused read (403) is a 502 with the identity kept, not a skip', async () => {
    const db = seeded();
    userRead = { status: 403, body: { message: 'not allowed' } };
    const res = await deleteAccount(db);
    expect(res.status).toBe(502);
    expect(identityDeletes()).toHaveLength(0);
    expect(emails(db)).toHaveLength(2);
  });

  it('the nightly retry later finishes BOTH: the purge, then the identity, then the ledger closes', async () => {
    const db = seeded();
    userRead = { status: 503, body: {} };
    expect((await deleteAccount(db)).status).toBe(202);
    adminCalls = [];
    userRead = confirmed('person@example.com');
    await erasureRetry({ ...envOf(db) } as unknown as Env, NOW_MS);
    expect(emails(db)).toEqual(['bystander@example.com']);
    expect(identityDeletes()).toHaveLength(1);
    // The account is read (step, then again right before the identity) and only then deleted.
    const firstDelete = adminCalls.findIndex((c) => c.method === 'DELETE');
    expect(adminCalls.slice(0, firstDelete).every((c) => c.method === 'GET')).toBe(true);
    expect(adminCalls.slice(0, firstDelete).length).toBeGreaterThanOrEqual(1);
    expect(steps(db)).toEqual([]);
  });

  it('a retry whose read still fails keeps the identity and the step for the next night', async () => {
    const db = seeded();
    userRead = { status: 503, body: {} };
    expect((await deleteAccount(db)).status).toBe(202);
    adminCalls = [];
    await erasureRetry({ ...envOf(db) } as unknown as Env, NOW_MS);
    expect(identityDeletes()).toHaveLength(0);
    expect(steps(db)).toEqual([{ app_id: SIGNUP_PURGE_STEP, confirmed_at: null }]);
    expect(emails(db)).toHaveLength(2);
  });
});
