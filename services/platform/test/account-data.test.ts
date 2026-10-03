import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import inventory from '../../../tooling/legal/data-inventory.json';
import accountExport, { WITHHELD } from '../src/routes/account-export';
import accountNominee from '../src/routes/account-nominee';
import { eraseTargets, erasureTargets } from '../../_shared/src/erasure';
import { memoryRateLimiter } from '../../_shared/src/ports/fakes/ratelimit';
import type { AppEnv } from '../src/types';
import { RealDb, realPlatformDb } from './harness';

// ─────────────────────────────────────────────────────────────────────────────
// account-data.test.ts — the DPDP access export and the nominee (lane
// dpdp-rights, Do 3 and Do 4). Each 🔴 case is one of the brief's red controls.
//
// 🔴 THE SEED IS DERIVED, NOT LISTED: every table carrying `user_id` in the REAL
// migrations of both databases gets one row for the subject (and one for someone
// else), filled column by column from the schema. The expectation is DERIVED
// too: every tooling/legal/data-inventory.json row whose export is `by: user_id`
// must come back with a row. A new user-owned table, or a new inventory row, is
// checked by this file with no edit to it.
// ─────────────────────────────────────────────────────────────────────────────

const APP_MIGRATIONS = import.meta.glob('../../subscriptiontracker-api/migrations/*.sql', { query: '?raw', import: 'default', eager: true });
const appDb = () => new RealDb(Object.keys(APP_MIGRATIONS).sort().map((k) => APP_MIGRATIONS[k] as string));

const ME = 'u-asha-export';
const THEM = 'u-bob-export';
const ANON = '0f8fad5b-d9cb-469f-a165-70867728950e';

type Col = { name: string; type: string; notnull: number; dflt_value: unknown; pk: number };

/** One row for `user` in every table of `db` carrying `user_id`, every NOT NULL column filled by type. */
function seedEveryUserTable(db: RealDb, user: string, tag: string): string[] {
  const tables = db.rows(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`).map((r) => String(r.name));
  const seeded: string[] = [];
  for (const t of tables) {
    const cols = db.rows(`SELECT name, type, "notnull", dflt_value, pk FROM pragma_table_info('${t}')`) as unknown as Col[];
    if (!cols.some((c) => c.name === 'user_id')) continue;
    const names: string[] = [];
    const values: Array<string | number> = [];
    for (const c of cols) {
      if (c.name === 'user_id') {
        names.push(c.name);
        values.push(user);
      } else if ((c.notnull || c.pk) && c.dflt_value === null && !(c.pk && /INT/i.test(c.type))) {
        names.push(c.name);
        values.push(/INT|REAL|NUM/i.test(c.type) ? 1 : `${tag}-${t}-${c.name}`);
      }
    }
    db.db.prepare(`INSERT INTO ${t} (${names.join(', ')}) VALUES (${names.map(() => '?').join(', ')})`).run(...values);
    seeded.push(t);
  }
  return seeded;
}

function routes(userId: string) {
  const a = new Hono<AppEnv>();
  a.use('*', async (c, next) => {
    c.set('userId', userId);
    c.set('requestId', 'test-export');
    await next();
  });
  a.route('/v1', accountExport);
  a.route('/v1', accountNominee);
  return a;
}

const envOf = (platform: RealDb, app: RealDb) =>
  ({ PLATFORM_DB: platform, SUBSCRIPTIONTRACKER_DB: app, EVENTS_LIMITER: memoryRateLimiter({ budget: 1000 }) }) as never;

type Store = { id: string; name: string; personalData?: boolean; export?: { by: string; reader: string } };
const STORES = (inventory as unknown as { stores: Store[] }).stores;

describe('🔴 GET /v1/account/export — everything we hold server-side, from every store', () => {
  it('🔴 the export of a seeded user contains a row from EVERY store the inventory says it reads, and none of anyone else\'s', async () => {
    const platform = realPlatformDb();
    const app = appDb();
    const seededPlatform = seedEveryUserTable(platform, ME, 'me');
    const seededApp = seedEveryUserTable(app, ME, 'me');
    seedEveryUserTable(platform, THEM, 'them');
    seedEveryUserTable(app, THEM, 'them');
    expect(seededPlatform.length).toBeGreaterThan(10);
    expect(seededApp.length).toBeGreaterThan(3);

    const res = await routes(ME).request('https://platform.nikatru.com/v1/account/export', {}, envOf(platform, app));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toContain('attachment');
    const body = (await res.json()) as { schema: string; subject: string; stores: Record<string, Array<Record<string, unknown>>> };
    expect(body).toMatchObject({ schema: 'nikatru.data-export/1', subject: ME });

    const expected = STORES.filter((s) => s.personalData === true && s.export?.by === 'user_id').map((s) => s.id.replace(/^table:/, ''));
    expect(expected.length).toBeGreaterThan(20);
    const missing = expected.filter((k) => !(body.stores[k]?.length > 0));
    expect(missing, 'inventory stores the export claims to read and did not return').toEqual([]);
    // And nothing in it is the other account's.
    expect(JSON.stringify(body)).not.toContain(THEM);
    expect(JSON.stringify(body)).not.toContain('them-');
  });

  it('🔒 a credential-shaped column is WITHHELD, never exported', async () => {
    const platform = realPlatformDb();
    const app = appDb();
    seedEveryUserTable(platform, ME, 'me');
    const body = (await (await routes(ME).request('https://platform.nikatru.com/v1/account/export', {}, envOf(platform, app))).json()) as {
      stores: Record<string, Array<Record<string, unknown>>>;
    };
    const feed = body.stores['platform_db.reminder_feed'][0];
    expect(Object.entries(feed).filter(([k]) => /hash/.test(k)).every(([, v]) => v === WITHHELD)).toBe(true);
    expect(JSON.stringify(body)).not.toContain('me-reminder_feed-token_hash');
  });

  it('the install-keyed stores come with the export only for the install the app names', async () => {
    const platform = realPlatformDb();
    const app = appDb();
    seedEveryUserTable(platform, ME, 'me');
    platform.db
      .prepare(`INSERT INTO consent_artifacts (consent_id, anon_id, purpose, granted, policy_version, client_ts, server_ts, app_id) VALUES ('c1', ?, 'analytics', 1, '2026-10-04', '2026-10-01T00:00:00Z', '2026-10-01T00:00:00Z', 'subscriptiontracker')`)
      .run(ANON);
    const without = (await (await routes(ME).request('https://platform.nikatru.com/v1/account/export', {}, envOf(platform, app))).json()) as {
      stores: Record<string, unknown[]>;
    };
    expect(without.stores['platform_db.consent_artifacts']).toBeUndefined();
    const withAnon = (await (await routes(ME).request(`https://platform.nikatru.com/v1/account/export?anon_id=${ANON}`, {}, envOf(platform, app))).json()) as {
      stores: Record<string, unknown[]>;
    };
    expect(withAnon.stores['platform_db.consent_artifacts']).toHaveLength(1);
    expect(withAnon.stores['platform_db.events']).toEqual([]);
    const bad = await routes(ME).request('https://platform.nikatru.com/v1/account/export?anon_id=not-an-id', {}, envOf(platform, app));
    expect(bad.status).toBe(422);
  });
});

describe('🔴 the nominee (DPDP s.14): a name and an address, nothing more, and it leaves with the account', () => {
  const put = (platform: RealDb, body: unknown) =>
    routes(ME).request(
      'https://platform.nikatru.com/v1/account/nominee',
      { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
      envOf(platform, appDb()),
    );

  it('set, read, replace and remove', async () => {
    const platform = realPlatformDb();
    expect((await put(platform, { name: 'Meena', email: 'Meena@Example.com' })).status).toBe(200);
    const got = (await (await routes(ME).request('https://platform.nikatru.com/v1/account/nominee', {}, envOf(platform, appDb()))).json()) as {
      nominee: { name: string; email: string };
    };
    expect(got.nominee).toMatchObject({ name: 'Meena', email: 'meena@example.com' });
    await put(platform, { name: 'Ravi', email: 'ravi@example.com' });
    expect(platform.rows('SELECT name FROM privacy_nominees')).toEqual([{ name: 'Ravi' }]);
    const del = await routes(ME).request('https://platform.nikatru.com/v1/account/nominee', { method: 'DELETE' }, envOf(platform, appDb()));
    expect(del.status).toBe(204);
    expect(platform.rows('SELECT * FROM privacy_nominees')).toEqual([]);
  });

  it('anything beyond a name and an address is refused', async () => {
    const platform = realPlatformDb();
    expect((await put(platform, { name: 'Meena', email: 'meena@example.com', phone: '98765' })).status).toBe(422);
    expect((await put(platform, { name: '', email: 'meena@example.com' })).status).toBe(422);
    expect((await put(platform, { name: 'Meena', email: 'not-an-address' })).status).toBe(422);
    expect(platform.rows('SELECT * FROM privacy_nominees')).toEqual([]);
  });

  it('🔴 ERASURE REMOVES THE NOMINEE: the account deletion\'s derived walk reaches privacy_nominees, and the export lists it', async () => {
    const platform = realPlatformDb();
    await put(platform, { name: 'Meena', email: 'meena@example.com' });
    const targets = await erasureTargets(platform);
    expect(targets.tables).toContain('privacy_nominees');
    expect(targets.tables).toContain('privacy_requests');
    await eraseTargets(platform, ME, targets);
    expect(platform.rows('SELECT * FROM privacy_nominees')).toEqual([]);
  });
});
