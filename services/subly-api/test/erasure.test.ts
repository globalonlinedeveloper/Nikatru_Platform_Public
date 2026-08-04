// ─────────────────────────────────────────────────────────────────────────────
// DELETE /v1/account ON subly-api — the route that finally reaches subly_db,
// and the boundary that decides who may ask for it.
//
// Driven through the REAL Worker (`src/index.ts`), against the REAL migrations,
// a REAL SQL engine and a REAL ES256 signature. Three of those matter for
// different reasons:
//
//   · THE REAL WORKER, because the security property under test is partly a
//     MOUNTING. A hand-built `new Hono()` in this file would prove that
//     `erasureAuth` refuses an HS256 token and prove nothing about whether the
//     deployed Worker puts `erasureAuth` in front of this path. index.ts also
//     registers `supabaseAuth` at `/v1/*`, which matches `/v1/account` — so
//     "which middleware actually runs" is a real question with a real answer, and
//     it is asked here rather than reasoned about.
//   · THE REAL MIGRATIONS + A REAL ENGINE, because the route carries no table
//     list. It asks the database which tables are user-owned, and a mock does not
//     have a `sqlite_master`.
//   · A REAL SIGNATURE, because "verification happens" is otherwise a claim about
//     a mock returning true.
//
// 🔴 THE ASSERTION THIS FILE EXISTS FOR is the HS256 pair: the SAME token, in the
// SAME Worker, in the SAME test — accepted by `GET /v1/subscriptions` and refused
// by `DELETE /v1/account`. Asserting the refusal alone would be satisfied by a
// token that was simply invalid; asserting both is what proves the erasure
// boundary is STRICTER rather than just differently broken.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Hono } from 'hono';
import { SignJWT, exportJWK, generateKeyPair, type JWK, type KeyLike } from 'jose';
import worker from '../src/index';
import account from '../src/routes/account';
import { supabaseAuth } from '../src/middleware/auth';
import type { AppEnv } from '../src/types';
import { realAppDb, realPlatformDb, TEST_ENV, type SqliteD1 } from './harness';
import registerRaw from '../../../tooling/legal/data-inventory.json?raw';

const SUPABASE_URL = TEST_ENV.SUPABASE_URL;
const OTHER_URL = 'https://project-b.supabase.co';
const ISSUER = `${SUPABASE_URL}/auth/v1`;
/** The legacy shared secret every OTHER route on this Worker still accepts. */
const HS256_SECRET = new TextEncoder().encode('legacy-shared-secret-for-tests-only');

/** Distinctive on purpose: the final sweep looks for these literals in every
 *  column of every table, so they must not be a substring of any filler. */
const SUBJECT = 'erasure-subject-9f3a';
const BYSTANDER = 'bystander-7c21';

let signingKey: KeyLike;
let publicJwk: JWK;
/** Every fetch the Worker made that was NOT the JWKS document. This route must
 *  make none: the identity record is the platform Worker's to delete, and a
 *  second Worker reaching for the service-role key would be the defect. */
let strayFetches: string[] = [];

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
    strayFetches.push(url);
    return new Response(null, { status: 204 });
  });
});
afterAll(() => vi.unstubAllGlobals());

async function token(
  claims: Record<string, unknown>,
  { issuer = ISSUER, audience = 'authenticated', alg = 'ES256', key = null as KeyLike | null } = {},
) {
  let t = new SignJWT(claims)
    .setProtectedHeader({ alg, kid: alg === 'ES256' ? 'test-key-1' : undefined })
    .setIssuedAt()
    .setExpirationTime('1h')
    .setAudience(audience);
  if (issuer) t = t.setIssuer(issuer);
  return t.sign(key ?? (alg === 'ES256' ? signingKey : HS256_SECRET));
}

const KV = { get: async () => null, put: async () => undefined } as unknown as KVNamespace;
const CTX = {
  waitUntil: (p: Promise<unknown>) => void p,
  passThroughOnException: () => {},
} as never;

/**
 * The DEPLOYED Worker, with the legacy shared secret CONFIGURED.
 *
 * ⚠️ Configured on purpose, and it is the whole point: with no secret set, an
 * HS256 token is refused everywhere and the erasure boundary would look strict
 * for a reason that has nothing to do with it. The secret being present is the
 * state this Worker actually ships in — `wrangler.jsonc` documents
 * `wrangler secret put SUPABASE_JWT_SECRET` — and it is the state under which the
 * refusal has to hold.
 */
function deployed(appDb: SqliteD1, platformDb = realPlatformDb()) {
  strayFetches = [];
  const env = {
    ...TEST_ENV,
    APP_DB: appDb,
    PLATFORM_DB: platformDb,
    JWKS_CACHE: KV,
    SUPABASE_JWT_SECRET: 'legacy-shared-secret-for-tests-only',
  } as unknown as AppEnv['Bindings'];
  return (path: string, init: { method?: string; authz?: string } = {}) =>
    worker.fetch(
      new Request(`https://api.nikatru.test${path}`, {
        method: init.method ?? 'GET',
        headers: init.authz === undefined ? {} : { Authorization: init.authz },
      }),
      env,
      CTX,
    );
}

/** Rows in `table` for `userId`. A query, never an inference from what the route
 *  returned about itself. */
const rowsFor = (db: SqliteD1, table: string, userId: string): number =>
  db.rows(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id = ?`, userId)[0].n as number;

const tablesOf = (db: SqliteD1): string[] =>
  db
    .rows(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)
    .map((r) => String(r.name));

interface ColumnInfo {
  name: string;
  type: string;
}
const columnsOf = (db: SqliteD1, table: string): ColumnInfo[] =>
  db
    .rows(`SELECT name, type FROM pragma_table_info(?)`, table)
    .map((r) => ({ name: String(r.name), type: String(r.type ?? '') }));

/**
 * Insert one row into `table` belonging to (or referencing) `userId`, filling
 * EVERY column — so a column a later migration adds is exercised by the sweep the
 * day it lands rather than sitting NULL and satisfying it trivially.
 *
 * ⚠️ `cycle` IS THE ONE COLUMN THIS CANNOT FILL WITH FILLER. 0001_init.sql
 * constrains it to ('monthly','yearly'), so a generic string makes the INSERT
 * fail — and a fixture that throws while planting looks exactly like a route that
 * failed to delete. Named here rather than worked around silently.
 */
function plant(db: SqliteD1, table: string, userId: string, tag: string): void {
  const cols = columnsOf(db, table);
  const values = cols.map((c, i) => {
    if (c.name === 'user_id' || c.name.endsWith('_user_id')) return userId;
    if (c.name === 'cycle') return 'monthly';
    return /INT|REAL|NUM|DOUB|FLOA/i.test(c.type) ? i : `filler-${table}-${tag}-${i}`;
  });
  db.db
    .prepare(
      `INSERT INTO ${table} (${cols.map((c) => c.name).join(',')}) VALUES (${cols.map(() => '?').join(',')})`,
    )
    .run(...(values as Array<string | number>));
}

/** Rows in `table` whose text in ANY column equals `needle`. */
function rowsMentioning(db: SqliteD1, table: string, needle: string): number {
  const cols = columnsOf(db, table);
  const where = cols.map((c) => `CAST(${c.name} AS TEXT) = ?`).join(' OR ');
  return db.rows(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`, ...cols.map(() => needle))[0]
    .n as number;
}

/** Every table in subly_db, seeded for both users. Returns the table list. */
function seedEveryTable(db: SqliteD1): string[] {
  const tables = tablesOf(db);
  for (const t of tables) {
    plant(db, t, SUBJECT, 'a');
    plant(db, t, BYSTANDER, 'b');
  }
  return tables;
}

// ═════════════════════════════════════════════════════════════════════════════
describe('the DEPLOYED Worker erases subly_db for the caller — and only for them', () => {
  it('purges every user-owned table and leaves the other user alone', async () => {
    const db = realAppDb();
    const tables = seedEveryTable(db);
    const res = await deployed(db)('/v1/account', {
      method: 'DELETE',
      authz: `Bearer ${await token({ sub: SUBJECT })}`,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      scope: string;
      deleted: Record<string, number>;
      unlinked: Record<string, number>;
    };
    expect(body.ok).toBe(true);
    // The scope is part of the contract: this Worker erases ONE database, and a
    // caller must not be able to read a bare ok:true as "the account is gone".
    expect(body.scope).toBe('subly_db');

    // Four tables today, and the assertion is over the DERIVED set rather than
    // over four names typed here — a fifth user-owned table added by a migration
    // joins this loop with no edit to the test.
    expect(tables.length).toBeGreaterThan(0);
    for (const t of tables) {
      expect(rowsFor(db, t, SUBJECT), `${t} still holds the erased user's rows`).toBe(0);
      expect(rowsFor(db, t, BYSTANDER), `${t} lost an unrelated user's rows`).toBe(1);
      expect(body.deleted[t], `${t} is missing from the route's own report`).toBe(1);
    }
  });

  it('is idempotent — a retry after a partial failure succeeds and deletes nothing more', async () => {
    const db = realAppDb();
    seedEveryTable(db);
    const call = deployed(db);
    const authz = `Bearer ${await token({ sub: SUBJECT })}`;
    expect((await call('/v1/account', { method: 'DELETE', authz })).status).toBe(200);
    const second = await call('/v1/account', { method: 'DELETE', authz });
    expect(second.status).toBe(200);
    const body = (await second.json()) as { deleted: Record<string, number> };
    for (const n of Object.values(body.deleted)) expect(n).toBe(0);
  });

  it('makes NO outbound request — the identity record is not this Worker\'s to delete', async () => {
    // 🔴 A SECOND WORKER DELETING THE IDENTITY WOULD BE THE DEFECT, not the
    // feature. It is portfolio-wide, exactly one piece of code may destroy it,
    // and doing it here would mean handing this Worker the Supabase service-role
    // key. Asserted on the requests the route MADE, which is the only evidence
    // that cannot be faked by a return value.
    const db = realAppDb();
    seedEveryTable(db);
    await deployed(db)('/v1/account', {
      method: 'DELETE',
      authz: `Bearer ${await token({ sub: SUBJECT })}`,
    });
    expect(strayFetches).toEqual([]);
  });

  it('does not touch PLATFORM_DB — those rows belong to the shared Worker', async () => {
    const db = realAppDb();
    const platform = realPlatformDb();
    platform.db
      .prepare(
        `INSERT INTO entitlements (user_id, app_id, entitlement, product_id, store, is_active, expires_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?)`,
      )
      .run(SUBJECT, 'subly', 'pro', 'p1', 'APP_STORE', 1, null, '2026-08-01T00:00:00Z');
    seedEveryTable(db);
    await deployed(db, platform)('/v1/account', {
      method: 'DELETE',
      authz: `Bearer ${await token({ sub: SUBJECT })}`,
    });
    expect(platform.rows('SELECT COUNT(*) AS n FROM entitlements')[0].n).toBe(1);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe('THE HS256 FALLBACK CANNOT REACH THIS ROUTE', () => {
  it('accepts the legacy HS256 token on a DATA route — so the refusal below is about the boundary, not the token', async () => {
    // 🔴 THE HALF THAT MAKES THE NEXT TEST MEAN SOMETHING. Without it, "the
    // erasure route 401s an HS256 token" is equally satisfied by a token that was
    // never valid at all, and the assertion would be vacuous while looking
    // strict. The JWKS fetch succeeds here, so the ES256 path is genuinely tried
    // and genuinely fails on the algorithm before the fallback runs.
    const db = realAppDb();
    const res = await deployed(db)('/v1/subscriptions', {
      authz: `Bearer ${await token({ sub: SUBJECT }, { alg: 'HS256' })}`,
    });
    expect(res.status).toBe(200);
  });

  it('401s that SAME token on DELETE /v1/account, and destroys NOTHING', async () => {
    const db = realAppDb();
    const tables = seedEveryTable(db);
    const res = await deployed(db)('/v1/account', {
      method: 'DELETE',
      authz: `Bearer ${await token({ sub: SUBJECT }, { alg: 'HS256' })}`,
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthorized' });
    for (const t of tables) expect(rowsFor(db, t, SUBJECT), `${t} was erased anyway`).toBe(1);
  });

  it('401s an unauthenticated deletion, and destroys NOTHING', async () => {
    const db = realAppDb();
    const tables = seedEveryTable(db);
    const res = await deployed(db)('/v1/account', { method: 'DELETE' });
    expect(res.status).toBe(401);
    for (const t of tables) expect(rowsFor(db, t, SUBJECT)).toBe(1);
  });

  it('401s a garbage token, an unsigned token, and a token from ANOTHER Supabase project', async () => {
    const db = realAppDb();
    const tables = seedEveryTable(db);
    const cases: Array<[string, string]> = [
      ['garbage', 'Bearer not-a-jwt'],
      ['alg:none', 'Bearer eyJhbGciOiJub25lIn0.eyJzdWIiOiJhIn0.'],
      ['non-bearer', `Basic ${await token({ sub: SUBJECT })}`],
      [
        'other project',
        `Bearer ${await token({ sub: SUBJECT }, { issuer: `${OTHER_URL}/auth/v1` })}`,
      ],
      ['wrong audience', `Bearer ${await token({ sub: SUBJECT }, { audience: 'anon' })}`],
      [
        'foreign ES256 key',
        `Bearer ${await token({ sub: SUBJECT }, { key: (await generateKeyPair('ES256', { extractable: true })).privateKey })}`,
      ],
    ];
    const call = deployed(db);
    for (const [label, authz] of cases) {
      const res = await call('/v1/account', { method: 'DELETE', authz });
      expect(res.status, label).toBe(401);
    }
    for (const t of tables) expect(rowsFor(db, t, SUBJECT)).toBe(1);
  });

  it('401s a verified ES256 token carrying NO `sub` — nobody is the subject of that erasure', async () => {
    const db = realAppDb();
    const tables = seedEveryTable(db);
    const res = await deployed(db)('/v1/account', {
      method: 'DELETE',
      authz: `Bearer ${await token({ email: 'a@test.dev' })}`,
    });
    expect(res.status).toBe(401);
    for (const t of tables) expect(rowsFor(db, t, SUBJECT)).toBe(1);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe('THE SECOND LIMB — the route refuses on its own, not only because of where it is mounted', () => {
  /** The route mounted behind whatever middleware the caller chooses. This is
   *  what a careless re-mount looks like, written as a test rather than feared
   *  in a comment. */
  function mounted(db: SqliteD1, middleware: 'permissive' | 'none') {
    const app = new Hono<AppEnv>();
    app.use('*', async (c, next) => {
      c.set('requestId', 'rid-test');
      await next();
    });
    if (middleware === 'permissive') app.use('/v1/account', supabaseAuth);
    app.route('/v1', account);
    const env = {
      ...TEST_ENV,
      APP_DB: db,
      JWKS_CACHE: KV,
      SUPABASE_JWT_SECRET: 'legacy-shared-secret-for-tests-only',
    } as unknown as AppEnv['Bindings'];
    return (authz?: string) =>
      app.request(
        '/v1/account',
        { method: 'DELETE', headers: authz === undefined ? {} : { Authorization: authz } },
        env,
      );
  }

  it('403s an HS256-verified request even when mounted behind `supabaseAuth`', async () => {
    // 🔴 THE MUTATION THIS PINS: move `app.route('/v1', account)` under the `api`
    // group in index.ts — a plausible tidy-up — and account deletion is behind a
    // shared secret with every other test still green. Here the route itself
    // says no, loudly, and nothing is destroyed.
    const db = realAppDb();
    const tables = seedEveryTable(db);
    const res = await mounted(db, 'permissive')(
      `Bearer ${await token({ sub: SUBJECT }, { alg: 'HS256' })}`,
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'erasure_requires_asymmetric_auth' });
    for (const t of tables) expect(rowsFor(db, t, SUBJECT)).toBe(1);
  });

  it('200s an ES256-verified request through the SAME permissive mount — the check is about the PROOF', async () => {
    // Without this, the test above passes for a route that refuses everything,
    // and "requires asymmetric" would be indistinguishable from "is broken".
    const db = realAppDb();
    seedEveryTable(db);
    const res = await mounted(db, 'permissive')(`Bearer ${await token({ sub: SUBJECT })}`);
    expect(res.status).toBe(200);
    expect(rowsFor(db, 'subscriptions', SUBJECT)).toBe(0);
  });

  it('403s when NO auth middleware ran at all — `undefined` is a refusal, not a gap', async () => {
    // The dangerous spelling would have been `!== 'symmetric'`, which admits
    // undefined. A route accidentally mounted outside every auth `use` would then
    // erase whatever `userId` happened to be, which is nothing — reported as ok.
    const db = realAppDb();
    const tables = seedEveryTable(db);
    const res = await mounted(db, 'none')();
    expect(res.status).toBe(403);
    for (const t of tables) expect(rowsFor(db, t, SUBJECT)).toBe(1);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe('the table set is DERIVED FROM THE SCHEMA, not listed in the route', () => {
  it('purges a user-owned table a FUTURE migration adds, with no edit to the route', async () => {
    const db = realAppDb([
      'CREATE TABLE saved_reports (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, body TEXT);',
    ]);
    db.db.prepare('INSERT INTO saved_reports (id,user_id,body) VALUES (?,?,?)').run('r1', SUBJECT, 'x');
    db.db.prepare('INSERT INTO saved_reports (id,user_id,body) VALUES (?,?,?)').run('r2', BYSTANDER, 'y');
    const res = await deployed(db)('/v1/account', {
      method: 'DELETE',
      authz: `Bearer ${await token({ sub: SUBJECT })}`,
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { deleted: Record<string, number> }).deleted.saved_reports).toBe(1);
    expect(rowsFor(db, 'saved_reports', BYSTANDER)).toBe(1);
  });

  it('UNLINKS a `*_user_id` REFERENCE instead of deleting the row that carries it', async () => {
    // subly_db has no such column today, and the limb is still under test: the
    // rule is what makes a future `shared_with_user_id` safe on the day it is
    // created rather than on the day somebody remembers this file.
    const db = realAppDb([
      'CREATE TABLE shared_links (id TEXT PRIMARY KEY, shared_with_user_id TEXT, note TEXT);',
    ]);
    db.db
      .prepare('INSERT INTO shared_links (id,shared_with_user_id,note) VALUES (?,?,?)')
      .run('l1', SUBJECT, 'keep me');
    db.db
      .prepare('INSERT INTO shared_links (id,shared_with_user_id,note) VALUES (?,?,?)')
      .run('l2', BYSTANDER, 'keep me too');
    const res = await deployed(db)('/v1/account', {
      method: 'DELETE',
      authz: `Bearer ${await token({ sub: SUBJECT })}`,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { unlinked: Record<string, number> };
    expect(body.unlinked['shared_links.shared_with_user_id']).toBe(1);
    // The ROW survives; what is erased is WHO.
    expect(db.rows('SELECT COUNT(*) AS n FROM shared_links')[0].n).toBe(2);
    expect(
      db.rows('SELECT COUNT(*) AS n FROM shared_links WHERE shared_with_user_id IS NULL')[0].n,
    ).toBe(1);
    expect(
      db.rows('SELECT COUNT(*) AS n FROM shared_links WHERE shared_with_user_id = ?', BYSTANDER)[0]
        .n,
    ).toBe(1);
  });

  it('refuses 503 when the derivation finds NO user-owned table', async () => {
    // 🔴 AN EMPTY SET IS A FAILURE, NOT A FAST PATH. Without this the route
    // reports ok:true having deleted nothing, and the shared Worker takes that as
    // permission to delete the identity — orphaning every row behind a login that
    // no longer exists. EVERY user-owned table has to be dropped for this case to
    // arise, so the fixture grows with the schema, which is the derivation
    // working rather than the test getting harder.
    const db = realAppDb();
    for (const t of tablesOf(db)) db.db.exec(`DROP TABLE ${t};`);
    const res = await deployed(db)('/v1/account', {
      method: 'DELETE',
      authz: `Bearer ${await token({ sub: SUBJECT })}`,
    });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'account_deletion_failed' });
  });

  it('THE SWEEP — afterwards the erased id survives in NO column of ANY table', async () => {
    // The assertion row counts cannot fake, and the only one here that consults
    // no list at all: it does not look for a column, it looks for the PERSON. It
    // would catch a `user_id` spelled `owner_id`, in a table nobody declared.
    const db = realAppDb();
    const tables = seedEveryTable(db);
    // The fixture has to be able to FAIL: every table in subly_db is addressable
    // today, so the planted count is derived from the table list rather than
    // written as a literal, and it must be non-zero or the sweep below would pass
    // on a database with no identifiers in it.
    const before = tables.reduce((n, t) => n + rowsMentioning(db, t, SUBJECT), 0);
    expect(before, 'the fixture planted nothing, so the sweep would pass vacuously').toBe(
      tables.length,
    );
    expect(tables.length).toBeGreaterThan(0);

    expect(
      (
        await deployed(db)('/v1/account', {
          method: 'DELETE',
          authz: `Bearer ${await token({ sub: SUBJECT })}`,
        })
      ).status,
    ).toBe(200);

    const survivors = tables
      .map((t) => ({ t, n: rowsMentioning(db, t, SUBJECT) }))
      .filter(({ n }) => n > 0);
    expect(
      survivors,
      `the erased user's id is still readable in: ${survivors.map((s) => s.t).join(', ')}`,
    ).toEqual([]);
    // …and "erased everything" cannot pass by emptying the database.
    for (const t of tables) {
      expect(rowsMentioning(db, t, BYSTANDER), `${t} lost an unrelated user's data`).toBe(1);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe('the register and the schema are one system', () => {
  interface StoreRow {
    id: string;
    kind: string;
    name: string;
    erasure?: { kind: string; route?: string; column?: string };
  }
  const register = JSON.parse(registerRaw) as { stores: StoreRow[] };
  const declared = register.stores.filter(
    (s) => s.kind === 'd1-table' && s.id.startsWith('table:subly_db.'),
  );

  it('names EXACTLY the tables subly_db actually has', () => {
    // 🔴 THE DOMAIN ASSERTION. Without it every claim below quantifies over a set
    // somebody chose, and a migration adding a table with no register row — the
    // way an erasure gap is actually born — would change nothing here.
    expect(declared.map((s) => s.name).sort()).toEqual(tablesOf(realAppDb()).sort());
  });

  it('declares `purge` for every one of them, naming THIS route', () => {
    expect(declared.length).toBeGreaterThan(0);
    for (const s of declared) {
      expect(s.erasure?.kind, `${s.name} declares erasure kind ${s.erasure?.kind}`).toBe('purge');
      expect(s.erasure?.route, `${s.name} names no route`).toBe(
        'services/subly-api/src/routes/account.ts',
      );
    }
  });

  it('and every `purge` table really has the column the route derives from', () => {
    const db = realAppDb();
    for (const s of declared) {
      expect(
        columnsOf(db, s.name).map((c) => c.name),
        `${s.name} declares \`purge\` and has no \`user_id\`, so the schema-derived sweep cannot see it`,
      ).toContain('user_id');
    }
  });
});
