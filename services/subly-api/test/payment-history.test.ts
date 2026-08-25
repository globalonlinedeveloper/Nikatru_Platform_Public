// ─────────────────────────────────────────────────────────────────────────────
// payment_history.updated_at — A COLUMN A MIGRATION PAID FOR AND NOTHING
// DELIVERED.
//
// 0002_schema_debt.sql added it with a stated purpose — "no way to tell a stale
// row from a fresh one, so any last-write-wins merge is undecidable for that
// table" — and seeded the rows that existed at the time from `paid_at`. It then
// sat in a state where BOTH halves were broken, in opposite directions:
//
//   · NO WRITER. `services/platform/src/renewals.ts` is the table's only writer
//     anywhere in the tree and its column list ended at `paid_at`, so every row
//     written after the migration carried NULL forever and the one-shot backfill
//     was the only value the column would ever hold.
//   · A READER THAT DECLARED NOTHING. `routes/subscriptions.ts` read the table
//     with `SELECT *` and returned the result verbatim as `payment_history` in
//     the GET /v1/subscriptions/:id body, so `"updated_at": null` was on the wire
//     while `Payment` in src/types.ts declared five fields and not that one.
//
// ⚠️ THE CROSS-SERVICE IMPORT IS DELIBERATE. The writer lives in the shared
// platform Worker and the schema it writes into is subly_db's, so the claim
// "the cron writes the column subly's migration bought" cannot be made from
// either side alone. `test/harness.ts` already imports across this boundary for
// the same reason (`PLATFORM_MIGRATIONS`, `0001_entitlements.sql?raw`).
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from 'vitest';
import { recomputeRenewals } from '../../platform/src/renewals';
import subscriptions from '../src/routes/subscriptions';
import { realAppDb, asUser, SqliteD1 } from './harness';

const U = 'user-a';

/** One subscription whose renewal is far enough in the past to be due. */
function seedDue(db: SqliteD1): void {
  db.db.exec(
    `INSERT INTO subscriptions (id, user_id, name, price, cycle, next_renewal)
     VALUES ('s1', 'user-a', 'Netflix', 9.99, 'monthly', '2020-01-15')`,
  );
}

describe('the nightly renewals pass writes payment_history.updated_at', () => {
  it('stamps every row it creates, seeded from paid_at exactly as the backfill was', async () => {
    const db = realAppDb();
    seedDue(db);

    const outcome = await recomputeRenewals(db as never, 'subly');
    expect(outcome.ok, outcome.detail).toBe(true);

    const rows = db.rows('SELECT paid_at, updated_at FROM payment_history');
    expect(rows.length, 'the pass must have created rows at all').toBeGreaterThan(0);
    for (const r of rows) {
      // 🔴 Deleting `updated_at` from the INSERT column list in
      // services/platform/src/renewals.ts turns this red: the column exists, so
      // the row is written, and every value is NULL.
      expect(r.updated_at, 'a row written tonight must not be undecidably stale').not.toBeNull();
      expect(r.updated_at).toBe(r.paid_at);
    }
  });

  it('the whole nightly batch still lands when the column does NOT exist', async () => {
    // `recomputeRenewals` calls itself "generic over any app DB with
    // subscriptions + payment_history", and the fan-out's one rule is that one
    // app's database must not take the rest of the loop down. subly_db has this
    // column because of ITS 0002; the brick's starter schema has no
    // payment_history at all, so a future app's table may legitimately predate
    // it. An unconditional six-column INSERT would fail the entire batch — every
    // renewal missed and every payment row lost — in order to write one
    // timestamp. This is the fixture services/platform/test/scheduled.test.ts
    // already uses, which is how the shape was measured rather than assumed.
    const db = new SqliteD1([
      `CREATE TABLE subscriptions (
         id TEXT PRIMARY KEY, user_id TEXT, name TEXT, price REAL, cycle TEXT,
         next_renewal TEXT, updated_at TEXT
       )`,
      `CREATE TABLE payment_history (
         id TEXT PRIMARY KEY, subscription_id TEXT, user_id TEXT, amount REAL, paid_at TEXT
       )`,
    ]);
    seedDue(db);

    const outcome = await recomputeRenewals(db as never, 'legacy-app');
    expect(outcome.ok, outcome.detail).toBe(true);
    expect(db.rows('SELECT id FROM payment_history').length).toBeGreaterThan(0);
    // …and the degradation is a NUMBER AN OPERATOR SEES, not a silence: the
    // detail is what lands in `cron_heartbeat`.
    expect(outcome.detail).toMatch(/WITHOUT updated_at/);
  });

  it('a database that HAS the column says nothing about a gap', async () => {
    // The other direction of the same predicate: a reason that printed on every
    // run, healthy or not, would be noise, and noise is how a real signal is
    // muted.
    const db = realAppDb();
    seedDue(db);
    const outcome = await recomputeRenewals(db as never, 'subly');
    expect(outcome.detail).not.toMatch(/WITHOUT updated_at/);
  });
});

describe('GET /v1/subscriptions/:id serves a DECLARED payment row', () => {
  it('carries updated_at, and it is the value the cron wrote', async () => {
    const db = realAppDb();
    seedDue(db);
    await recomputeRenewals(db as never, 'subly');

    const call = asUser(subscriptions, '/v1/subscriptions', { APP_DB: db as never });
    const res = await call(U, '/v1/subscriptions/s1');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      payment_history: Array<Record<string, unknown>>;
    };
    expect(body.payment_history.length).toBeGreaterThan(0);
    for (const row of body.payment_history) {
      // The SELECT names its columns, so this key set is a decision made in
      // routes/subscriptions.ts rather than whatever the migrations left behind.
      expect(Object.keys(row).sort()).toEqual([
        'amount',
        'id',
        'paid_at',
        'subscription_id',
        'updated_at',
        'user_id',
      ]);
      expect(row.updated_at).toBe(row.paid_at);
    }
  });

  it('🔴 a column NO ONE DECLARED does not reach the client', async () => {
    // This is the assertion `SELECT *` cannot survive, and the only one that
    // separates "the six columns happen to match today" from "the wire shape is
    // a decision". The extra column stands in for the next migration: 0002 is
    // exactly how `updated_at` reached the wire with nothing declaring it.
    const db = realAppDb(['ALTER TABLE payment_history ADD COLUMN internal_note TEXT;']);
    seedDue(db);
    await recomputeRenewals(db as never, 'subly');
    db.db.exec("UPDATE payment_history SET internal_note = 'operator eyes only'");

    const call = asUser(subscriptions, '/v1/subscriptions', { APP_DB: db as never });
    const body = (await (await call(U, '/v1/subscriptions/s1')).json()) as {
      payment_history: Array<Record<string, unknown>>;
    };
    expect(body.payment_history.length).toBeGreaterThan(0);
    for (const row of body.payment_history) {
      expect(Object.keys(row)).not.toContain('internal_note');
    }
  });
});
