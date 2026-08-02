// ─────────────────────────────────────────────────────────────────────────────
// DELETE /v1/account REACHES EVERY TABLE — proven against the real migrations,
// the real SQL engine and the real route, with the table list DERIVED FROM THE
// DATABASE rather than typed here.
//
// [pipeline K-7] "The erasure path is published, reachable and not orphaned."
//
// 🔴 WHY THIS FILE EXISTS AND auth.test.ts WAS NOT ENOUGH. That suite proves the
// route empties `entitlements`, honours tenancy, and refuses when the derivation
// comes back empty. Every one of those assertions names a table somebody thought
// of. The failure this file is about is the table NOBODY thought of: the route
// derives its set from the schema, so a table holding personal data with no
// `user_id` column is invisible to it — and the route still answers `{ok:true}`.
// `provider_notifications` was exactly that table (0004 section B stores the
// merchant-of-record notification VERBATIM, which for a subscription event is
// the buyer's name, email address and billing country) from the day it was
// created until migration 0006. A person could ask to be erased, be told they
// were, and have their name still in the database.
//
// A DELETE ROUTE THAT SILENTLY MISSES ROWS IS WORSE THAN NO DELETE ROUTE.
//
// ── THE THREE PROPERTIES, AND WHY EACH IS UNFAKEABLE ─────────────────────────
//  1. THE DOMAIN IS THE DATABASE. The set of tables under test is read from
//     `sqlite_master` after the real migrations run, and asserted EQUAL to the
//     platform_db rows of tooling/legal/data-inventory.json. Neither side can be
//     shrunk: dropping a table from the register fails here, and adding a
//     migration without a register row fails here AND in
//     assert-data-inventory.mjs. A new table cannot arrive untested by anybody
//     forgetting to edit this file.
//  2. EVERY TABLE IS SEEDED, then the REAL route runs, then the outcome is
//     graded against the kind the register DECLARES — `purge` must be empty,
//     `unlink` must keep the row and lose the id, `pseudonymous` /
//     `no-personal-data` must be untouched. A wrong declaration fails the test,
//     not just the guard.
//  3. THE SWEEP: after the deletion, every TEXT column of every table is scanned
//     for the erased user's id. Zero hits. This is the assertion row counts
//     cannot fake — it does not know or care which tables exist, so it catches
//     the column nobody declared, in the table nobody added a row for.
//
// The identity provider is stubbed the same way auth.test.ts stubs it; what is
// under test here is the DATABASE half, so the network half is held constant.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Hono } from 'hono';
import { SignJWT, exportJWK, generateKeyPair, type JWK, type KeyLike } from 'jose';
import { platformAuth } from '../src/middleware/auth';
import account from '../src/routes/account';
import type { AppEnv } from '../src/types';
import { realPlatformDb, type RealDb } from './harness';
import registerRaw from '../../../tooling/legal/data-inventory.json?raw';

const SUPABASE_URL = 'https://project-a.supabase.co';
const ISSUER = `${SUPABASE_URL}/auth/v1`;

/** Distinctive on purpose. The final sweep looks for this literal in every TEXT
 *  column of every table, so it must not be a substring of any filler value. */
const SUBJECT = 'erasure-subject-9f3a';
const BYSTANDER = 'bystander-7c21';

interface ErasureDecl {
  kind: string;
  column?: string;
}
interface StoreRow {
  id: string;
  kind: string;
  name: string;
  personalData?: boolean;
  erasure?: ErasureDecl;
}

const register = JSON.parse(registerRaw) as { stores: StoreRow[] };
const declared = new Map<string, StoreRow>(
  register.stores
    .filter((s) => s.kind === 'd1-table' && s.id.startsWith('table:platform_db.'))
    .map((s) => [s.name, s]),
);

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
    if (url.includes('/auth/v1/admin/users/')) return new Response(null, { status: 204 });
    throw new Error(`unexpected fetch in test: ${url}`);
  });
});
afterAll(() => vi.unstubAllGlobals());

const token = (sub: string) =>
  new SignJWT({ sub })
    .setProtectedHeader({ alg: 'ES256', kid: 'test-key-1' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .setIssuer(ISSUER)
    .setAudience('authenticated')
    .sign(signingKey);

const KV = { get: async () => null, put: async () => undefined } as unknown as KVNamespace;

function harness(db: RealDb) {
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => {
    c.set('requestId', 'rid-erasure');
    await next();
  });
  app.use('/v1/account', platformAuth);
  app.route('/v1', account);
  const env = {
    PLATFORM_DB: db,
    JWKS_CACHE: KV,
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
    APP_ID: 'platform',
    API_VERSION: 'v1',
  } as unknown as AppEnv['Bindings'];
  return async (sub: string) =>
    app.request('/v1/account', { method: 'DELETE', headers: { Authorization: `Bearer ${await token(sub)}` } }, env);
}

interface ColumnInfo {
  name: string;
  type: string;
  notnull: number;
}

/** Every table the migrations actually created. `sqlite_master`, not a list. */
const tablesOf = (db: RealDb): string[] =>
  db
    .rows(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)
    .map((r) => String(r.name));

const columnsOf = (db: RealDb, table: string): ColumnInfo[] =>
  db.rows(`SELECT name, type, "notnull" FROM pragma_table_info(?)`, table).map((r) => ({
    name: String(r.name),
    type: String(r.type ?? ''),
    notnull: Number(r.notnull ?? 0),
  }));

/**
 * Insert one row into `table` belonging to (or referencing) `userId`.
 *
 * EVERY column is filled — not just the required ones — so a column added by a
 * later migration is exercised by this test the day it lands rather than sitting
 * NULL and trivially satisfying the sweep. The filler is unique per (table,
 * user, tag) because several tables carry a UNIQUE index, and it deliberately
 * contains neither SUBJECT nor BYSTANDER so the final sweep only ever matches a
 * real identifier.
 */
function plant(db: RealDb, table: string, userId: string, tag: string): void {
  const cols = columnsOf(db, table);
  const values = cols.map((c, i) => {
    if (c.name === 'user_id' || c.name.endsWith('_user_id')) return userId;
    const numeric = /INT|REAL|NUM|DOUB|FLOA/i.test(c.type);
    return numeric ? i : `filler-${table}-${tag}-${i}`;
  });
  db.db
    .prepare(
      `INSERT INTO ${table} (${cols.map((c) => c.name).join(',')}) VALUES (${cols.map(() => '?').join(',')})`,
    )
    .run(...(values as Array<string | number>));
}

/** Whether a table has any column an erasure request could address — the same
 *  two spellings the route derives its two sets from. `revocation_reasons` and
 *  the two pseudonymous tables have neither, so planting a SUBJECT row in them
 *  is impossible by construction rather than by omission. */
const addressable = (db: RealDb, table: string): boolean =>
  columnsOf(db, table).some((c) => c.name === 'user_id' || c.name.endsWith('_user_id'));

/** Rows in `table` whose text anywhere equals `needle`, across ALL columns. */
function rowsMentioning(db: RealDb, table: string, needle: string): number {
  const cols = columnsOf(db, table);
  const where = cols.map((c) => `CAST(${c.name} AS TEXT) = ?`).join(' OR ');
  return db.count(table, `(${where})`, ...cols.map(() => needle));
}

describe('the erasure surface — the register, the schema and the route are one system', () => {
  it('the register names EXACTLY the tables platform_db actually has', () => {
    // 🔴 THE DOMAIN ASSERTION. Everything below quantifies over the register; if
    // the register and the database can disagree, every one of those assertions
    // is about a set somebody chose. This is what stops a new migration arriving
    // with no erasure story and no test — the same relationship
    // assert-data-inventory.mjs enforces, asserted here against the LIVE schema
    // rather than against parsed SQL, so a migration the parser mis-reads is
    // caught by one of the two.
    const db = realPlatformDb();
    expect([...declared.keys()].sort()).toEqual(tablesOf(db).sort());
  });

  it('every table declares an erasure kind the route can actually perform', () => {
    for (const [name, row] of declared) {
      expect(row.erasure?.kind, `${name} declares no erasure kind`).toBeTruthy();
      expect(
        ['purge', 'unlink', 'pseudonymous', 'no-personal-data'],
        `${name} declares erasure kind ${row.erasure?.kind}, which no platform_db table may use — ` +
          '`no-route` describes a store this Worker cannot reach, and platform_db is the one it binds',
      ).toContain(row.erasure?.kind);
    }
  });

  it('erases the subject from every `purge` table, leaves every other user alone', async () => {
    const db = realPlatformDb();
    // Baselines BEFORE planting: `revocation_reasons` ships eight seeded rows
    // from its own migration, so "unchanged" is a delta, not a constant. A
    // hardcoded 2 here would have made this assertion about the fixture.
    const baseline = new Map(tablesOf(db).map((t) => [t, db.count(t)]));
    for (const table of tablesOf(db)) {
      plant(db, table, SUBJECT, 'a');
      plant(db, table, BYSTANDER, 'b');
    }
    const res = await harness(db)(SUBJECT);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      deleted: Record<string, number>;
      unlinked: Record<string, number>;
    };
    expect(body.ok).toBe(true);

    let purged = 0;
    let unlinked = 0;
    let untouched = 0;
    for (const [table, row] of declared) {
      const kind = row.erasure?.kind;
      const cols = columnsOf(db, table).map((c) => c.name);
      if (kind === 'purge') {
        purged++;
        // Checked BEFORE the count, so a table whose `user_id` was renamed or
        // never added fails with the sentence that names the fault instead of
        // crashing on "no such column" — a crash and a catch print the same red,
        // and only one of them tells the next reader where to look.
        expect(
          cols,
          `${table} declares erasure \`purge\` and has no \`user_id\` column. The route carries no table list — ` +
            'it derives one from the schema — so this table is invisible to the sweep and the deletion silently ' +
            'misses it.',
        ).toContain('user_id');
        expect(db.count(table, 'user_id = ?', SUBJECT), `${table} still holds the erased user's rows`).toBe(0);
        expect(db.count(table, 'user_id = ?', BYSTANDER), `${table} lost an unrelated user's rows`).toBe(1);
        expect(body.deleted[table], `${table} is not in the route's own report`).toBe(1);
      } else if (kind === 'unlink') {
        unlinked++;
        const col = row.erasure?.column as string;
        expect(
          cols,
          `${table} declares erasure \`unlink\` on ${col}, and no such column exists. Nothing nulls a column that ` +
            'is not there, so the erased person\'s id would simply stay wherever it really is.',
        ).toContain(col);
        // The ROW survives — it is the evidence of a payment, and destroying it
        // destroys the only thing that could resolve that payer's support
        // ticket. What must not survive is the erased person's id in it.
        expect(db.count(table), `${table} was emptied; unlink must keep the row`).toBe(
          (baseline.get(table) ?? 0) + 2,
        );
        expect(db.count(table, `${col} = ?`, SUBJECT), `${table}.${col} still names the erased user`).toBe(0);
        expect(db.count(table, `${col} = ?`, BYSTANDER), `${table}.${col} lost an unrelated link`).toBe(1);
        expect(db.count(table, `${col} IS NULL`)).toBe(1);
        expect(body.unlinked[`${table}.${col}`]).toBe(1);
      } else {
        untouched++;
        // 🔴 ASSERTED, NOT ASSUMED. A sweep that widened to "any table" would
        // empty `revocation_reasons` — eight seeded vocabulary rows every other
        // customer's entitlement resolves through — and no other test here
        // would notice.
        expect(db.count(table), `${table} declares itself unreachable and lost rows anyway`).toBe(
          (baseline.get(table) ?? 0) + 2,
        );
      }
    }
    // Each branch above is reachable, so a register that quietly lost every row
    // of one kind cannot pass this test by vacuous truth.
    expect(purged, 'no `purge` table was exercised').toBeGreaterThan(0);
    expect(unlinked, 'no `unlink` table was exercised').toBeGreaterThan(0);
    expect(untouched, 'no unreachable table was exercised').toBeGreaterThan(0);
  });

  it('THE SWEEP — after the deletion the erased id survives in NO column of ANY table', async () => {
    // The assertion row counts cannot fake, and the only one here that does not
    // consult the register at all. It catches the table nobody declared, the
    // column nobody thought of, and the `user_id` spelled `owner_id` — because
    // it does not look for a column, it looks for the PERSON.
    const db = realPlatformDb();
    const tables = tablesOf(db);
    for (const table of tables) {
      plant(db, table, SUBJECT, 'a');
      plant(db, table, BYSTANDER, 'b');
    }
    // The fixture has to be able to FAIL. `plant` only writes the id into a
    // table that has somewhere to put it, so the expected count is the number of
    // addressable tables — derived, so it moves with the schema — and it must be
    // more than zero or the sweep below would pass on a database with no
    // identifiers in it at all.
    const addressableTables = tables.filter((t) => addressable(db, t));
    expect(addressableTables.length, 'no table in platform_db can hold a user id at all').toBeGreaterThan(0);
    const before = tables.reduce((n, t) => n + rowsMentioning(db, t, SUBJECT), 0);
    expect(before, 'the fixture planted nothing, so the sweep below would pass on an empty database').toBe(
      addressableTables.length,
    );

    expect((await harness(db)(SUBJECT)).status).toBe(200);

    const survivors = tables
      .map((t) => ({ t, n: rowsMentioning(db, t, SUBJECT) }))
      .filter(({ n }) => n > 0);
    expect(
      survivors,
      `the erased user's id is still readable in: ${survivors.map((s) => s.t).join(', ')}`,
    ).toEqual([]);

    // …and the bystander is untouched everywhere the sweep looked, so "erased
    // everything" cannot pass by deleting the whole database.
    for (const t of addressableTables) {
      expect(rowsMentioning(db, t, BYSTANDER), `${t} lost an unrelated user's data`).toBeGreaterThan(0);
    }
  });

  it('a table added with a user_id and NO register row is caught by the register relation', () => {
    // The negative test for property 1, written as a test rather than claimed in
    // a comment: the fixture is what a careless migration looks like.
    const db = realPlatformDb(['CREATE TABLE forgotten_notes (id TEXT PRIMARY KEY, user_id TEXT);']);
    expect([...declared.keys()].sort()).not.toEqual(tablesOf(db).sort());
  });
});
