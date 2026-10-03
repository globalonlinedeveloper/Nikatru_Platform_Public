// ─────────────────────────────────────────────────────────────────────────────
// Train T11 · the nightly housekeeping of an app's `subscriptions` table
// (src/subscription-housekeeping.ts), run per app by scheduled.ts
// `appRenewalsPass`:
//
//   · AD-13 — trials end on their own: a row still `trialing` on its
//     `trial_ends_on` becomes `active`, at its post-trial price (0010's
//     `price_after_trial_minor`) with ONE price_change row; and the renewals
//     roll writes no assumed payment for a charge date inside the trial.
//   · SV-01 — the 30-day purge of soft-deleted rows, which GET
//     /v1/subscriptions used to run before every list, is this limb now: a
//     31-day-old removed row goes WITH its payment_history and price_change.
//   · the statement budget — a fixed count of statements per app per night,
//     whatever the data.
//
// RED CONTROLS (each named at its test): on the tree before this change there
// is no module to import, so the file fails whole; each test also names the
// one-line mutation of the module that turns it red on its own.
//
// Built on subscriptiontracker_db at the schema that SHIPS — every migration in
// the app's directory, by glob, as test/reminder-days.test.ts does.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from 'vitest';
import {
  HOUSEKEEPING_STATEMENTS_PER_APP,
  MAX_PURGE_PER_RUN,
  SOFT_DELETE_PURGE_DAYS,
  endTrials,
  probeHousekeepingSchema,
  purgeSoftDeleted,
} from '../src/subscription-housekeeping';
import { appRenewalsPass } from '../src/scheduled';
import { MINOR_DIGITS_NOT_TWO } from '../src/lib/reminders';
import housekeepingSrc from '../src/subscription-housekeeping.ts?raw';
import { RealDb } from './harness';

const APP_MIGRATIONS = import.meta.glob('../../subscriptiontracker-api/migrations/*.sql', {
  query: '?raw',
  import: 'default',
  eager: true,
});

const DAY = 86_400_000;
const U = 'user-a';

/** subscriptiontracker_db at the schema that ships: every migration, in order. */
function appDb(): RealDb {
  const names = Object.keys(APP_MIGRATIONS).sort();
  // Floor: 0010 adds `price_after_trial_minor`. A glob that found fewer would
  // grade only the "no post-trial price column" path.
  expect(names.some((n) => n.endsWith('/0010_trial_price_still_using.sql'))).toBe(true);
  return new RealDb(names.map((n) => APP_MIGRATIONS[n]));
}

/** 'YYYY-MM-DD', `days` from the real today (the passes read the real clock). */
const inDays = (days: number) => new Date(Date.now() + days * DAY).toISOString().slice(0, 10);

type Seed = Record<string, string | number | null>;

function seed(db: RealDb, id: string, cols: Seed = {}): void {
  const row: Seed = {
    id,
    user_id: U,
    name: id,
    price: 649,
    price_minor: 64900,
    currency: 'INR',
    cycle: 'monthly',
    cycle_every: 1,
    cycle_unit: 'month',
    next_renewal: inDays(10),
    status: 'active',
    ...cols,
  };
  const keys = Object.keys(row);
  db.db
    .prepare(`INSERT INTO subscriptions (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`)
    .run(...keys.map((k) => row[k]));
}

function seedHistory(db: RealDb, subscriptionId: string, userId = U): void {
  db.db
    .prepare(
      `INSERT INTO payment_history (id, subscription_id, user_id, amount, paid_at)
       VALUES (?, ?, ?, 649, '2026-08-01T00:00:00Z')`,
    )
    .run(`p-${subscriptionId}-${userId}`, subscriptionId, userId);
  db.db
    .prepare(
      `INSERT INTO price_change (id, subscription_id, user_id, old_price, new_price, changed_at)
       VALUES (?, ?, ?, 499, 649, '2026-08-01T00:00:00Z')`,
    )
    .run(`c-${subscriptionId}-${userId}`, subscriptionId, userId);
}

const one = (db: RealDb, id: string) => db.rows('SELECT * FROM subscriptions WHERE id = ?', id)[0];

// ═════════════════════════════════════════════════════════════════════════════
describe('AD-13 — a trial ends on its own, at its post-trial price', () => {
  // Red control: drop `price = CASE …` from endTrials' UPDATE — the row is
  // active at the trial's price 0, and the price_change row disagrees with it.
  it('a trial that ended yesterday is active after the run, at its post-trial price, with ONE price_change row', async () => {
    const db = appDb();
    seed(db, 'trial', {
      price: 0,
      price_minor: 0,
      status: 'trialing',
      trial_ends_on: inDays(-1),
      next_renewal: inDays(-1),
      price_after_trial_minor: 89900,
    });
    const out = await appRenewalsPass(db as never, 'subscriptiontracker');
    expect(out.ok, out.detail).toBe(true);

    const row = one(db, 'trial');
    expect([row.status, row.price, row.price_minor, row.price_after_trial_minor]).toEqual(['active', 899, 89900, null]);
    const steps = db.rows(
      'SELECT subscription_id, user_id, old_price, new_price, old_price_minor, new_price_minor, old_currency, new_currency FROM price_change',
    );
    expect(steps).toEqual([
      {
        subscription_id: 'trial',
        user_id: U,
        old_price: 0,
        new_price: 899,
        old_price_minor: 0,
        new_price_minor: 89900,
        old_currency: 'INR',
        new_currency: 'INR',
      },
    ]);
    // The day the trial ended IS a charge, and at the price after the trial.
    expect(db.rows('SELECT amount, paid_at FROM payment_history')).toEqual([
      { amount: 899, paid_at: `${inDays(-1)}T00:00:00Z` },
    ]);
    expect(out.detail).toMatch(/^trials_ended=1 repriced=1; purged=0; advanced 1 subscription/);
  });

  it('the decimal follows the currency’s own minor digits: JPY has none, KWD has three', async () => {
    const db = appDb();
    seed(db, 'jpy', { currency: 'JPY', price: 0, price_minor: 0, status: 'trialing', trial_ends_on: inDays(-1), price_after_trial_minor: 1200 });
    seed(db, 'kwd', { currency: 'KWD', price: 0, price_minor: 0, status: 'trialing', trial_ends_on: inDays(-1), price_after_trial_minor: 3500 });
    const schema = await probeHousekeepingSchema(db as never);
    expect((await endTrials(db as never, schema)).ok).toBe(true);
    expect(one(db, 'jpy').price).toBe(1200);
    expect(one(db, 'kwd').price).toBe(3.5);
  });

  // Red control: drop 'KWD' from one of the statements' 1000 lists — the
  // statement and the table disagree and this reds (and so may the KWD case
  // above, at 35.0, depending on which statement lost it).
  it('every CASE the statements divide by IS the ISO minor-digits table, code for code', () => {
    const divisorOf: Record<number, number> = { 0: 1, 3: 1000, 4: 10000 };
    const expected = new Map<number, string[]>();
    for (const [code, digits] of Object.entries(MINOR_DIGITS_NOT_TWO)) {
      const d = divisorOf[digits];
      expected.set(d, [...(expected.get(d) ?? []), code].sort());
    }
    const arms = [...housekeepingSrc.matchAll(/WHEN currency IN \(([^)]*)\) THEN (\d+)/g)];
    // The CASE is written into three places: the log's new price, the log's
    // "did it move" test and the UPDATE's price. A floor, so a regex that
    // stopped matching cannot pass on nothing.
    expect(arms.length, 'the CASE arms are no longer found in the source').toBe(9);
    for (const [, list, divisor] of arms) {
      const codes = list.split(',').map((c: string) => c.trim().replace(/'/g, '')).sort();
      expect(codes, `the ${divisor} arm`).toEqual(expected.get(Number(divisor)));
    }
    expect(housekeepingSrc.match(/ELSE 100 END\)/g)).toHaveLength(3);
  });

  it('ends on trial_ends_on itself; a trial ending tomorrow, a paused or a removed one is left alone', async () => {
    const db = appDb();
    seed(db, 'today', { status: 'trialing', trial_ends_on: inDays(0) });
    seed(db, 'tomorrow', { status: 'trialing', trial_ends_on: inDays(1) });
    seed(db, 'paused', { status: 'paused', trial_ends_on: inDays(-5) });
    seed(db, 'removed', { status: 'trialing', trial_ends_on: inDays(-5), deleted_at: new Date().toISOString() });
    const schema = await probeHousekeepingSchema(db as never);
    const out = await endTrials(db as never, schema);
    expect(out.detail).toBe('trials_ended=1 repriced=0');
    expect(['today', 'tomorrow', 'paused', 'removed'].map((id) => one(db, id).status)).toEqual([
      'active',
      'trialing',
      'paused',
      'trialing',
    ]);
  });

  it('a trial with no post-trial price converts at its own price and logs no price step', async () => {
    const db = appDb();
    seed(db, 'plain', { status: 'trialing', trial_ends_on: inDays(-2) });
    const schema = await probeHousekeepingSchema(db as never);
    await endTrials(db as never, schema);
    expect([one(db, 'plain').status, one(db, 'plain').price, one(db, 'plain').price_minor]).toEqual(['active', 649, 64900]);
    expect(db.count('price_change')).toBe(0);
  });

  it('a post-trial price equal to the trial price moves nothing and logs nothing (the PATCH route’s rule)', async () => {
    const db = appDb();
    seed(db, 'same', { status: 'trialing', trial_ends_on: inDays(-1), price_after_trial_minor: 64900 });
    const schema = await probeHousekeepingSchema(db as never);
    await endTrials(db as never, schema);
    expect(one(db, 'same').status).toBe('active');
    expect(db.count('price_change')).toBe(0);
  });

  // Red control: delete the `when < sub.trial_ends_on` skip in renewals.ts —
  // every missed charge date inside the trial is written as a payment at 649.
  it('the renewals roll writes NO assumed payment for a charge date inside the trial, and still rolls the date', async () => {
    const db = appDb();
    seed(db, 'in-trial', {
      cycle: null,
      cycle_every: 1,
      cycle_unit: 'week',
      status: 'trialing',
      trial_ends_on: inDays(5),
      next_renewal: inDays(-15),
    });
    const out = await appRenewalsPass(db as never, 'subscriptiontracker');
    expect(out.ok, out.detail).toBe(true);
    expect(db.count('payment_history'), 'a charge inside the trial was recorded as paid').toBe(0);
    expect(one(db, 'in-trial').next_renewal).toBe(inDays(6));
    expect(one(db, 'in-trial').status).toBe('trialing');
    expect(out.detail).toContain('3 in-trial charge(s) not recorded');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe('SV-01 — the 30-day purge runs nightly, not on the list read', () => {
  const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();

  // Red control: drop the payment_history DELETE from the batch — the
  // 31-day-old row goes and its history stays behind, an orphan.
  it(`a row soft-deleted ${SOFT_DELETE_PURGE_DAYS + 1} days ago goes WITH its history; a recent or live one stays`, async () => {
    const db = appDb();
    seed(db, 'old', { deleted_at: ago(SOFT_DELETE_PURGE_DAYS + 1) });
    seed(db, 'recent', { deleted_at: ago(SOFT_DELETE_PURGE_DAYS - 1) });
    seed(db, 'live');
    for (const id of ['old', 'recent', 'live']) seedHistory(db, id);
    // A history row under the same subscription id but ANOTHER user's is not
    // the purged row's history, and is never taken with it.
    seedHistory(db, 'old', 'user-b');

    const out = await appRenewalsPass(db as never, 'subscriptiontracker');
    expect(out.ok, out.detail).toBe(true);
    expect(out.detail).toContain('purged=1');
    expect(db.rows('SELECT id FROM subscriptions ORDER BY id').map((r) => r.id)).toEqual(['live', 'recent']);
    const left = (table: string) =>
      db.rows(`SELECT subscription_id || '/' || user_id AS k FROM ${table} ORDER BY k`).map((r) => r.k);
    expect(left('payment_history')).toEqual(['live/user-a', 'old/user-b', 'recent/user-a']);
    expect(left('price_change')).toEqual(['live/user-a', 'old/user-b', 'recent/user-a']);
  });

  it(`removes at most MAX_PURGE_PER_RUN (${MAX_PURGE_PER_RUN}) a night, oldest first, and says capped`, async () => {
    const db = appDb();
    for (let i = 0; i <= MAX_PURGE_PER_RUN; i++) {
      seed(db, `gone-${String(i).padStart(3, '0')}`, { deleted_at: ago(SOFT_DELETE_PURGE_DAYS + 2 + i) });
    }
    const schema = await probeHousekeepingSchema(db as never);
    const out = await purgeSoftDeleted(db as never, schema);
    expect(out).toEqual({ ok: true, detail: `purged=${MAX_PURGE_PER_RUN} capped` });
    // The one left is the NEWEST of the expired rows: oldest first.
    expect(db.rows('SELECT id FROM subscriptions').map((r) => r.id)).toEqual(['gone-000']);
  });

  it('a failed purge is an ok=0 heartbeat row, and the renewals pass before it still ran', async () => {
    const db = appDb();
    seed(db, 'due', { next_renewal: inDays(-1) });
    seed(db, 'old', { deleted_at: ago(SOFT_DELETE_PURGE_DAYS + 1) });
    const real = db.batch.bind(db);
    db.batch = async (statements) => {
      if (statements.length === 3) throw new Error('D1_ERROR: simulated purge failure');
      return real(statements);
    };
    const out = await appRenewalsPass(db as never, 'subscriptiontracker');
    expect(out.ok).toBe(false);
    expect(out.detail).toContain('purge failed: Error: D1_ERROR: simulated purge failure');
    expect(db.count('payment_history'), 'the renewals roll was skipped by the purge failing').toBe(1);
    expect(db.count('subscriptions'), 'the purge batch is one transaction').toBe(2);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe('the statement budget — fixed per app, whatever the data', () => {
  async function housekeepingStatements(db: RealDb): Promise<number> {
    const before = db.sql.length;
    const schema = await probeHousekeepingSchema(db as never);
    await endTrials(db as never, schema);
    await purgeSoftDeleted(db as never, schema);
    return db.sql.length - before;
  }

  // Red control: end trials with one UPDATE per row (a loop over the due ids)
  // — the busy night sends 2 + 40 statements and this reds.
  it(`HOUSEKEEPING_STATEMENTS_PER_APP (${HOUSEKEEPING_STATEMENTS_PER_APP}) on an empty night AND on a busy one`, async () => {
    const quiet = appDb();
    expect(await housekeepingStatements(quiet)).toBe(HOUSEKEEPING_STATEMENTS_PER_APP);

    const busy = appDb();
    for (let i = 0; i < 40; i++) {
      seed(busy, `t${i}`, { status: 'trialing', trial_ends_on: inDays(-1), price_after_trial_minor: 1000 + i });
      seed(busy, `d${i}`, { deleted_at: new Date(Date.now() - 40 * DAY).toISOString() });
      seedHistory(busy, `d${i}`);
    }
    expect(await housekeepingStatements(busy)).toBe(HOUSEKEEPING_STATEMENTS_PER_APP);
    expect(busy.count('subscriptions', "status = 'trialing'")).toBe(0);
    expect(busy.count('subscriptions', 'deleted_at IS NOT NULL')).toBe(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe('an app database without the columns is skipped, never thrown on', () => {
  it('a subscriptions table that predates 0003 reads as skipped, ok', async () => {
    const db = new RealDb([
      `CREATE TABLE subscriptions (id TEXT PRIMARY KEY, user_id TEXT, price REAL, cycle TEXT, next_renewal TEXT);
       CREATE TABLE payment_history (id TEXT PRIMARY KEY, subscription_id TEXT, user_id TEXT, amount REAL, paid_at TEXT);`,
    ]);
    const out = await appRenewalsPass(db as never, 'brick');
    expect(out.ok, out.detail).toBe(true);
    expect(out.detail).toMatch(/^trials=skipped\(no lifecycle columns\); purged=skipped\(no deleted_at\); nothing due/);
  });
});
