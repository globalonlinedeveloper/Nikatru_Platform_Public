// ─────────────────────────────────────────────────────────────────────────────
// THE MONEY BOUNDARY, SERVER END.
//
// /v1/entitlements decides `is_pro`, and `is_pro` is the only thing standing
// between a free user and paid features. It used to read:
//
//     return Number.isNaN(exp) ? true : exp > nowMs;
//
// i.e. an expiry it could NOT PARSE granted Pro — permanently, silently, to
// every reader of that row. There is no signal: no error, no log, no failing
// test; the endpoint answers 200 with `is_pro: true` and the paywall opens.
//
// The client end of the same wire had the mirror-image bug
// (packages/core/lib/src/models/entitlement.dart: `DateTime.tryParse` → null →
// LIFETIME). Fixing either side alone just moves where the fail-open lives,
// which is why both are pinned here and there.
//
// These run against a REAL SQL engine with a real row, because the value that
// matters is what a row already IN THE TABLE makes the endpoint say — a mock
// returns whatever the test hands it, which proves nothing about a corrupt or
// legacy row.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import entitlements, { type EntitlementRow } from '../src/routes/entitlements';
import { realPlatformDb, ENTITLEMENTS_SCHEMA, PLATFORM_MIGRATIONS, TEST_ENV } from './harness';
import type { AppEnv } from '../src/types';

const USER = 'user-a';
const OTHER = 'user-b';

type Row = {
  entitlement?: string;
  product_id?: string | null;
  store?: string | null;
  is_active?: number;
  expires_at?: string | null;
  user_id?: string;
  app_id?: string;
  /** [5]M-12 — defaults to 'live', the world a live rail stamps. Pass null
   *  explicitly to seed a pre-2026-08-09 legacy row that carries no world. */
  provider_environment?: string | null;
};

function harness(
  db: ReturnType<typeof realPlatformDb>,
  envOverrides: Record<string, unknown> = {},
) {
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => {
    c.set('userId', c.req.header('X-Test-User') ?? USER);
    c.set('requestId', 'test-rid');
    await next();
  });
  app.route('/v1/entitlements', entitlements);
  app.onError((_e, c) => c.json({ error: 'internal_error' }, 500));

  const env = {
    ...TEST_ENV,
    PLATFORM_DB: db,
    ...envOverrides,
  } as unknown as AppEnv['Bindings'];

  return {
    /** Insert a row exactly as it would sit in the shared platform_db. */
    seed(row: Row) {
      db.db
        .prepare(
          `INSERT INTO entitlements
             (user_id, app_id, entitlement, product_id, store, is_active, expires_at, updated_at,
              provider_environment)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          row.user_id ?? USER,
          row.app_id ?? 'subly',
          row.entitlement ?? 'pro',
          row.product_id ?? 'subly_pro_monthly',
          row.store ?? 'APP_STORE',
          row.is_active ?? 1,
          row.expires_at ?? null,
          '2026-08-01T00:00:00.000Z',
          row.provider_environment === undefined ? 'live' : row.provider_environment,
        );
    },
    get: async (user = USER) => {
      const res = await app.request(
        '/v1/entitlements',
        { headers: { 'X-Test-User': user } },
        env,
      );
      return {
        status: res.status,
        body: (await res.json()) as {
          app_id: string;
          is_pro: boolean;
          entitlements: Array<{ entitlement: string; expires_at: string | null }>;
        },
      };
    },
  };
}

const future = new Date(Date.now() + 30 * 86_400_000).toISOString();
const past = new Date(Date.now() - 30 * 86_400_000).toISOString();

describe('GET /v1/entitlements — an UNDECIDABLE expiry must not grant Pro', () => {
  // Every one of these is a string a real `expires_at` column can hold: a
  // half-written value, a column that used to be epoch-ms, a locale date from a
  // hand-run backfill. `Date.parse` returns NaN for all of them.
  for (const bad of [
    'not-a-date',
    // `''` used to be read as LIFETIME by `if (!r.expires_at) return true`.
    // Nothing this Worker writes can produce it, so it only ever means a damaged
    // row — the undecidable case, not the no-end case.
    '',
    '2026-13-45T99:99:99Z',
    '1800000000000', // epoch-ms as text — Date.parse('1800000000000') is NaN
    'null',
    '   ',
  ]) {
    it(`denies Pro for expires_at = ${JSON.stringify(bad)}`, async () => {
      const db = realPlatformDb();
      const h = harness(db);
      h.seed({ is_active: 1, expires_at: bad });
      const { status, body } = await h.get();
      expect(status).toBe(200);
      expect(body.is_pro, 'an expiry nobody can read must never unlock').toBe(false);
    });
  }

  it('still RETURNS the row — denied access, not a hidden entitlement', async () => {
    // Support has to be able to see that the row exists and why it is broken;
    // suppressing it would turn a paywall bug into an unreproducible one.
    const db = realPlatformDb();
    const h = harness(db);
    h.seed({ is_active: 1, expires_at: 'not-a-date' });
    const { body } = await h.get();
    expect(body.is_pro).toBe(false);
    expect(body.entitlements).toHaveLength(1);
    expect(body.entitlements[0].expires_at).toBe('not-a-date');
  });
});

describe('GET /v1/entitlements — the decidable cases still decide correctly', () => {
  // Without these, a route that answered `is_pro: false` unconditionally would
  // pass every test above. A boundary that cannot tell "denied" from "broken" is
  // not a boundary.
  it('a NULL expires_at is a LIFETIME grant and stays Pro', async () => {
    const db = realPlatformDb();
    const h = harness(db);
    h.seed({ is_active: 1, expires_at: null });
    expect((await h.get()).body.is_pro).toBe(true);
  });

  it('a FUTURE expiry grants and a PAST expiry denies', async () => {
    const db = realPlatformDb();
    const h = harness(db);
    h.seed({ entitlement: 'pro', is_active: 1, expires_at: future });
    expect((await h.get()).body.is_pro).toBe(true);

    const db2 = realPlatformDb();
    const h2 = harness(db2);
    h2.seed({ entitlement: 'pro', is_active: 1, expires_at: past });
    expect((await h2.get()).body.is_pro).toBe(false);
  });

  it('is_active = 0 denies whatever the date says', async () => {
    const db = realPlatformDb();
    const h = harness(db);
    h.seed({ is_active: 0, expires_at: future });
    expect((await h.get()).body.is_pro).toBe(false);
  });

  it('one broken row does not sink a second, valid entitlement', async () => {
    // The decision is `rows.some(...)`. A user can hold several entitlements and
    // a corrupt one must neither grant on its own nor revoke a good one.
    const db = realPlatformDb();
    const h = harness(db);
    h.seed({ entitlement: 'pro', is_active: 1, expires_at: 'garbage' });
    h.seed({ entitlement: 'cloud_sync', is_active: 1, expires_at: future });
    const { body } = await h.get();
    expect(body.is_pro).toBe(true);
    expect(body.entitlements).toHaveLength(2);
  });

  it('a broken row belonging to ANOTHER user grants nobody anything', async () => {
    const db = realPlatformDb();
    const h = harness(db);
    h.seed({ user_id: OTHER, is_active: 1, expires_at: 'garbage' });
    h.seed({ user_id: OTHER, entitlement: 'cloud_sync', is_active: 1, expires_at: future });
    const { body } = await h.get(USER);
    expect(body.is_pro).toBe(false);
    expect(body.entitlements).toHaveLength(0);
  });

  it('an entitlement for a DIFFERENT app_id is not this app’s Pro', async () => {
    const db = realPlatformDb();
    const h = harness(db);
    h.seed({ app_id: 'loop', is_active: 1, expires_at: future });
    const { body } = await h.get();
    expect(body.app_id).toBe('subly');
    expect(body.is_pro).toBe(false);
    expect(body.entitlements).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE ENVIRONMENT LIMB — [5]M-12 on the legacy reader, added 2026-08-09. The
// platform route has carried it all along; this one granted on `is_active`
// alone, so a sandbox row (or a row that never declared a world) unlocked live
// Pro through the door the app actually uses.
// ─────────────────────────────────────────────────────────────────────────────
describe('GET /v1/entitlements — a row from the wrong money world grants nothing', () => {
  it('a SANDBOX row does not unlock a live deploy', async () => {
    const db = realPlatformDb();
    const h = harness(db);
    h.seed({ is_active: 1, expires_at: future, provider_environment: 'sandbox' });
    const { body } = await h.get();
    expect(body.is_pro, 'sandbox money must never grant a production unlock').toBe(false);
    expect(body.entitlements, 'the row is still visible — denied, not hidden').toHaveLength(1);
  });

  it('a row with NO world at all is UNDECIDABLE and denies', async () => {
    // "Written before the rail knew" is not evidence of a live payment — the
    // fail-closed rule applied to itself, same as the platform route.
    const db = realPlatformDb();
    const h = harness(db);
    h.seed({ is_active: 1, expires_at: null, provider_environment: null });
    expect((await h.get()).body.is_pro).toBe(false);
  });

  it('a sandbox deploy REFUSES a live row — the limb cuts both ways', async () => {
    // The refusal half on its own: a live row ALONE on a sandbox deploy grants
    // nothing. (An earlier draft seeded a granting sandbox row next to this one
    // and asserted is_pro === true — a test the limb's deletion also passes.)
    const db = realPlatformDb();
    const h = harness(db, { MONEY_ENVIRONMENT: 'sandbox' });
    h.seed({ entitlement: 'cloud_sync', is_active: 1, expires_at: future, provider_environment: 'live' });
    expect((await h.get()).body.is_pro).toBe(false);
  });

  it('a sandbox deploy honours a sandbox row in its own world', async () => {
    const db = realPlatformDb();
    const h = harness(db, { MONEY_ENVIRONMENT: 'sandbox' });
    h.seed({ entitlement: 'pro', is_active: 1, expires_at: future, provider_environment: 'sandbox' });
    expect((await h.get()).body.is_pro).toBe(true);
  });

  it('the denial reason is DIAGNOSABLE from the payload — the world rides along', async () => {
    // Two denial reasons now exist (wrong world, unparseable expiry); support
    // must be able to tell them apart without server logs.
    const db = realPlatformDb();
    const h = harness(db);
    h.seed({ is_active: 1, expires_at: future, provider_environment: 'sandbox' });
    const { body } = await h.get();
    expect(body.is_pro).toBe(false);
    expect(
      (body.entitlements[0] as { provider_environment?: string }).provider_environment,
    ).toBe('sandbox');
  });

  it('503s when MONEY_ENVIRONMENT is unset — no guess, no access decision', async () => {
    const db = realPlatformDb();
    for (const broken of [undefined, '', 'prod']) {
      const h = harness(db, { MONEY_ENVIRONMENT: broken });
      const { status } = await h.get();
      expect(status, JSON.stringify(broken)).toBe(503);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The harness comment has claimed since PR #94 that "the shape is asserted
// against src/types.ts's `Entitlement` in entitlements.test.ts so it cannot
// drift unnoticed" — and entitlements.test.ts did not exist. A guard described
// in prose and never written is worse than none: it is why nobody checked.
//
// The harness now imports the REAL services/platform migration rather than a
// hand-typed copy, so this compares the table that actually ships against the
// type every route reads rows through. That is the drift that happens:
// platform_db is migrated by a different npm project, on its own schedule, and a
// column added or renamed there would otherwise leave this Worker's whole
// entitlement suite passing against a table it does not talk to.
// ─────────────────────────────────────────────────────────────────────────────
describe('the SHIPPED platform_db schema carries every column the route reads', () => {
  /** Column names from the CREATE TABLE body — not the indexes after it. */
  function columnsOf(sql: string): string[] {
    const body = /CREATE TABLE[^(]*\(([\s\S]*?)\n\);/.exec(sql);
    if (body === null) throw new Error('no CREATE TABLE body found');
    const TABLE_CONSTRAINTS = new Set([
      'PRIMARY',
      'FOREIGN',
      'UNIQUE',
      'CHECK',
      'CONSTRAINT',
    ]);
    return body[1]
      .split('\n')
      .map((line) => /^\s*(\w+)\s+\w/.exec(line.split('--')[0]))
      .filter((m): m is RegExpExecArray => m !== null)
      .map((m) => m[1])
      .filter((name) => !TABLE_CONSTRAINTS.has(name.toUpperCase()));
  }

  /** Columns later migrations bolt onto the table. */
  function alterColumnsOf(migrations: readonly string[]): string[] {
    return migrations.flatMap((sql) =>
      [...sql.matchAll(/ALTER TABLE entitlements ADD COLUMN (\w+)/g)].map((m) => m[1]),
    );
  }

  it('every EntitlementRow field is a real column of the shipped migrations', () => {
    // The witness used to compare src/types.ts `Entitlement` against 0001 —
    // and this PR removed that type's last reader, so the pair asserted less
    // than it said. It now witnesses the type the route ACTUALLY reads rows
    // through: TypeScript fails to compile if `EntitlementRow` gains or loses
    // a field, and the runtime check fails if a field names no shipped column.
    const witness: Record<keyof EntitlementRow, true> = {
      entitlement: true,
      product_id: true,
      store: true,
      is_active: true,
      expires_at: true,
      provider_environment: true,
    };
    const shipped = new Set([
      ...columnsOf(ENTITLEMENTS_SCHEMA),
      ...alterColumnsOf(PLATFORM_MIGRATIONS),
    ]);
    expect(
      alterColumnsOf(PLATFORM_MIGRATIONS).length,
      'the ALTER parser must actually find the 0004 money columns',
    ).toBeGreaterThanOrEqual(11);
    for (const field of Object.keys(witness)) {
      expect(shipped.has(field), `${field} is read by the route but shipped by no migration`).toBe(true);
    }
  });

  it('the parser really reads the file — it is not matching an empty set', () => {
    // The parser is the load-bearing half of the assertion above. Point it at a
    // table with a column the type does NOT have and it must SEE that column;
    // otherwise "the sets are equal" only ever means "both were empty".
    expect(
      columnsOf(`
CREATE TABLE entitlements (
  user_id     TEXT,
  surprise    TEXT,  -- a column nobody declared in src/types.ts
  PRIMARY KEY (user_id)
);
CREATE INDEX idx_x ON entitlements (user_id);`),
    ).toEqual(['user_id', 'surprise']);
  });

  it('a route really reads through that table', async () => {
    // REQUIRED COVERAGE: the assertion above compares two declarations. This one
    // proves the declaration is the thing the route queries, so the pair cannot
    // both pass against a table nothing uses.
    const db = realPlatformDb();
    const h = harness(db);
    h.seed({ entitlement: 'pro', product_id: 'p1', store: 'STRIPE', expires_at: future });
    const { body } = await h.get();
    expect(body.entitlements[0]).toEqual({
      entitlement: 'pro',
      product_id: 'p1',
      store: 'STRIPE',
      is_active: true,
      expires_at: future,
      provider_environment: 'live',
    });
  });
});
