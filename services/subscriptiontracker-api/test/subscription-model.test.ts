// ─────────────────────────────────────────────────────────────────────────────
// THE ADR 077 §5 MODEL ON THE WIRE — 0003_subscription_model.sql + the route.
// Train ST-T3a, labels ST-M1 (the migration) and ST-M2 (route, validator,
// serializer).
//
// Three questions, each against the REAL migrations on a real SQL engine:
//
//   1. THE CONTRACT. A non-USD, weekly, trialing row goes in through POST and
//      comes back — from POST, GET /:id and GET / — carrying
//      exactly what was sent. Before 0003 the Worker dropped `currency` and
//      `price_minor`, so ₹649 came back as a bare 649 and the client read it as
//      $649.00 (the audit's B21/D5/D18).
//   2. OLD CLIENTS. A body with none of the new keys, and a row written before
//      0003 existed, both still work and read back as they did — plus the
//      defaults that make them valid in the new model.
//   3. A RED CONTROL FOR EVERY NEW RULE. Each rule the validator gained has an
//      input here that it must refuse with a 400 naming the field, and that
//      must leave the table as it was.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, beforeEach } from 'vitest';
import { recomputeRenewals } from '../../platform/src/renewals';
import subscriptions from '../src/routes/subscriptions';
import { todayYmd } from '../src/lib/d1';
import init0001 from '../migrations/0001_init.sql?raw';
import init0002 from '../migrations/0002_schema_debt.sql?raw';
import init0003 from '../migrations/0003_subscription_model.sql?raw';
import init0004 from '../migrations/0004_notice_days.sql?raw';
import init0005 from '../migrations/0005_lifecycle_history_categories.sql?raw';
import { realAppDb, asUser, SqliteD1 } from './harness';

const U = 'user-a';

let db: SqliteD1;
let subs: ReturnType<typeof asUser>;

beforeEach(() => {
  db = realAppDb();
  subs = asUser(subscriptions, '/v1/subscriptions', { APP_DB: db as never });
});

type Row = Record<string, unknown>;

const post = (body: unknown) => subs(U, '/v1/subscriptions', { method: 'POST', body });
const patch = (id: string, body: unknown) =>
  subs(U, `/v1/subscriptions/${id}`, { method: 'PATCH', body });
const getOne = async (id: string) => (await (await subs(U, `/v1/subscriptions/${id}`)).json()) as Row;
const getAll = async () => (await (await subs(U, '/v1/subscriptions')).json()) as Row[];

/** 'YYYY-MM-DD', `days` from the route's own today. */
const inDays = (days: number) =>
  new Date(Date.parse(`${todayYmd()}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** Every key the model added, with a value that is not its default. */
const INR_WEEKLY_TRIAL = {
  name: 'JioHotstar',
  category: 'Video',
  price: 649,
  price_minor: 64900,
  currency: 'INR',
  cycle_every: 1,
  cycle_unit: 'week',
  next_renewal: inDays(3),
  first_charge_on: '2026-09-01',
  status: 'trialing',
  trial_ends_on: inDays(3),
  notes: 'Cancel before the trial ends',
  service_id: 'jiohotstar',
  cancel_url: 'https://www.hotstar.com/in/subscribe/my-account',
  rail: 'upi_autopay',
  rail_holder: 'Google Pay · HDFC ••4471',
  reminder_days: [3, 1],
  shared_with: 'Family',
  share_numerator: 1,
  share_denominator: 4,
} as const;

/** What the model's keys must read back as — `cycle` is DERIVED, never sent. */
const EXPECTED_MODEL_KEYS = {
  price: 649,
  price_minor: 64900,
  currency: 'INR',
  cycle: null,
  cycle_every: 1,
  cycle_unit: 'week',
  first_charge_on: '2026-09-01',
  status: 'trialing',
  trial_ends_on: INR_WEEKLY_TRIAL.trial_ends_on,
  cancelled_on: null,
  deleted_at: null,
  notes: 'Cancel before the trial ends',
  service_id: 'jiohotstar',
  cancel_url: 'https://www.hotstar.com/in/subscribe/my-account',
  rail: 'upi_autopay',
  rail_holder: 'Google Pay · HDFC ••4471',
  reminder_days: [3, 1],
  shared_with: 'Family',
  share_numerator: 1,
  share_denominator: 4,
};

async function create(body: unknown): Promise<Row> {
  const res = await post(body);
  expect(res.status).toBe(201);
  return (await res.json()) as Row;
}

// ═════════════════════════════════════════════════════════════════════════════
describe('THE CONTRACT — a non-USD, weekly, trialing row round-trips', () => {
  it('POST answers with every field it was sent, and `cycle` derived as null', async () => {
    const created = await create(INR_WEEKLY_TRIAL);
    expect(created).toMatchObject(EXPECTED_MODEL_KEYS);
  });

  it('GET /:id, GET / and a PATCH echo answer the SAME row', async () => {
    const created = await create(INR_WEEKLY_TRIAL);
    const id = created.id as string;
    const one = await getOne(id);
    const { payment_history: history, price_history: prices, ...oneRow } = one;
    expect(history).toEqual([]);
    expect(prices).toEqual([]);
    expect(oneRow).toEqual(created);
    expect(await getAll()).toEqual([created]);

    // PATCH the same values back: nothing may drift on a second write.
    const res = await patch(id, INR_WEEKLY_TRIAL);
    expect(res.status).toBe(200);
    const patched = (await res.json()) as Row;
    expect({ ...patched, updated_at: null }).toEqual({ ...created, updated_at: null });
  });

  it('stores what it serves: the DB row holds the exact amount, the unit and a NULL legacy cycle', async () => {
    await create(INR_WEEKLY_TRIAL);
    const [row] = db.rows(
      'SELECT price, price_minor, currency, cycle, cycle_every, cycle_unit, status, reminder_days FROM subscriptions',
    );
    expect(row).toEqual({
      price: 649,
      price_minor: 64900,
      currency: 'INR',
      cycle: null,
      cycle_every: 1,
      cycle_unit: 'week',
      status: 'trialing',
      reminder_days: '[3,1]',
    });
  });

  it('🔴 the platform fan-out rolls a weekly row by a WEEK, never by a month', async () => {
    // ⏱ 2026-09-28 · ST-T3b (ST-M3). Until then services/platform/src/renewals.ts
    // rolled by the legacy `cycle` alone and SKIPPED NULL, and this case pinned
    // that a weekly row was left alone. The fan-out now reads `cycle_every` +
    // `cycle_unit` (contracts/renewals/vectors.json), so the weekly row IS
    // rolled — by seven days. What stays pinned is the route's half: `cycle`
    // is NULL for a weekly row, so a Worker that predates the pair still
    // cannot roll it a month and invent a payment.
    const weekly = await create({ ...INR_WEEKLY_TRIAL, next_renewal: inDays(-3) });
    const monthly = await create({ name: 'Netflix', price: 9.99, cycle: 'monthly', next_renewal: inDays(-3) });
    expect(db.rows('SELECT cycle FROM subscriptions WHERE id = ?', weekly.id as string)[0].cycle).toBeNull();
    await recomputeRenewals(db as never, 'subscriptiontracker');
    const next = (id: unknown) =>
      db.rows('SELECT next_renewal FROM subscriptions WHERE id = ?', id as string)[0].next_renewal;
    expect(next(weekly.id), 'the weekly row moves by seven days, not a month').toBe(inDays(4));
    expect(next(monthly.id), 'the control: a monthly row IS advanced').not.toBe(inDays(-3));
    expect(
      db.rows('SELECT subscription_id FROM payment_history ORDER BY subscription_id').map((r) => r.subscription_id),
    ).toEqual([weekly.id, monthly.id].sort());
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe('OLD CLIENTS keep working', () => {
  it('a body with none of the new keys: 201, old keys as before, new keys at their defaults', async () => {
    const created = await create({
      name: 'Netflix',
      category: 'Video',
      price: 9.99,
      cycle: 'monthly',
      next_renewal: '2026-10-01',
      plan: '',
      glyph: '',
      used_pct: 0,
      usage_note: '',
      unused: false,
    });
    expect(created).toMatchObject({
      price: 9.99,
      cycle: 'monthly',
      next_renewal: '2026-10-01',
      unused: false,
      // …and the model, derived or defaulted, never invented:
      currency: null,
      price_minor: null,
      cycle_every: 1,
      cycle_unit: 'month',
      status: 'active',
      share_numerator: 1,
      share_denominator: 1,
      reminder_days: null,
      deleted_at: null,
    });
  });

  it('the ST-T1 client body (Subscription.toJson) is stored whole — currency no longer dropped', async () => {
    // apps/subscriptiontracker/lib/data/models/subscription.dart `toJson`, key
    // for key: it has sent `price_minor` and `currency` since ST-T1.
    const created = await create({
      id: 'client-side-id',
      name: 'Spotify',
      category: 'Music',
      price: 119,
      price_minor: 11900,
      currency: 'INR',
      cycle: 'monthly',
      next_renewal: '2026-10-01',
      plan: '',
      glyph: '',
      used_pct: 0,
      usage_note: '',
      unused: false,
    });
    expect(created).toMatchObject({ price: 119, price_minor: 11900, currency: 'INR', cycle_unit: 'month' });
  });

  it('a row written BEFORE 0003 reads back valid once 0003 is applied', async () => {
    const legacy = new SqliteD1([init0001, init0002]);
    legacy.db.exec(
      "INSERT INTO subscriptions (id, user_id, name, price, cycle, next_renewal, used_pct, unused) " +
        "VALUES ('old-1', 'user-a', 'Prime', 1499, 'yearly', '2027-03-01', 0, 0)",
    );
    legacy.db.exec(init0003);
    legacy.db.exec(init0004); // the rest of the set: GET / purges into 0005's price_change
    legacy.db.exec(init0005);
    const call = asUser(subscriptions, '/v1/subscriptions', { APP_DB: legacy as never });
    const [row] = (await (await call(U, '/v1/subscriptions')).json()) as Row[];
    expect(row).toMatchObject({
      id: 'old-1',
      price: 1499,
      cycle: 'yearly',
      currency: null, // the client decodes this with the user's own currency (ST-C1)
      price_minor: null,
      cycle_every: 1,
      cycle_unit: 'year',
      status: 'active',
      share_numerator: 1,
      share_denominator: 1,
    });
  });

  it('an old client editing a weekly row with `cycle` alone moves the cadence too', async () => {
    const { id } = await create(INR_WEEKLY_TRIAL);
    const res = await patch(id as string, { cycle: 'yearly' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ cycle: 'yearly', cycle_every: 1, cycle_unit: 'year' });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe('the write rules that span keys', () => {
  it('currency is stored upper case, as the client reads it', async () => {
    expect(await create({ price: 1, price_minor: 100, currency: 'inr' })).toMatchObject({ currency: 'INR' });
  });

  it('a PATCH that changes `price` without `price_minor` clears the stale exact amount', async () => {
    const { id } = await create(INR_WEEKLY_TRIAL);
    const res = await patch(id as string, { price: 799 });
    expect(await res.json()).toMatchObject({ price: 799, price_minor: null, currency: 'INR' });
  });

  it('a PATCH that changes `currency` without `price_minor` clears it too', async () => {
    const { id } = await create(INR_WEEKLY_TRIAL);
    const res = await patch(id as string, { currency: 'JPY' });
    expect(await res.json()).toMatchObject({ price: 649, price_minor: null, currency: 'JPY' });
  });

  it('a PATCH touching neither keeps `price_minor`', async () => {
    const { id } = await create(INR_WEEKLY_TRIAL);
    const res = await patch(id as string, { notes: 'renegotiated' });
    expect(await res.json()).toMatchObject({ price_minor: 64900, notes: 'renegotiated' });
  });

  it('the cadence pair derives `cycle`: every 1 month is monthly, every 2 weeks is null', async () => {
    expect(await create({ cycle_every: 1, cycle_unit: 'month' })).toMatchObject({ cycle: 'monthly' });
    expect(await create({ cycle_every: 1, cycle_unit: 'year', cycle: 'yearly' })).toMatchObject({
      cycle: 'yearly',
    });
    expect(await create({ cycle_every: 2, cycle_unit: 'week', cycle: null })).toMatchObject({ cycle: null });
  });

  it('clearing the pair clears `cycle`', async () => {
    const { id } = await create({ cycle: 'monthly' });
    const res = await patch(id as string, { cycle_every: null, cycle_unit: null });
    expect(await res.json()).toMatchObject({ cycle: null, cycle_every: null, cycle_unit: null });
  });

  it('reminder_days: [] (none) and null (account default) are different answers', async () => {
    expect(await create({ reminder_days: [] })).toMatchObject({ reminder_days: [] });
    expect(await create({ reminder_days: null })).toMatchObject({ reminder_days: null });
  });

  it('a reminder_days value edited outside the Worker is served as null, not a 500', async () => {
    const { id } = await create({ reminder_days: [7] });
    db.db.exec("UPDATE subscriptions SET reminder_days = 'not json'");
    expect(await getOne(id as string)).toMatchObject({ reminder_days: null });
  });

  it('the boundaries are accepted', async () => {
    for (const body of [
      { cycle_every: 366, cycle_unit: 'day' },
      { share_numerator: 100, share_denominator: 100 },
      { reminder_days: [0, 365, 30, 7, 1] },
      { price: 1_000_000_000, price_minor: 10_000_000_000_000, currency: 'CLF' },
      { deleted_at: null },
      { cancel_url: 'http://example.com/cancel' },
      { status: 'active', cancelled_on: '2026-09-28' },
      { rail: 'unknown', service_id: 'x.y_z-1' },
    ]) {
      expect((await post(body)).status, JSON.stringify(body)).toBe(201);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 0004_notice_days.sql (audit F30, ST-R8): the cancel-by notice period.
describe('notice_days — the notice period round-trips, and null means none', () => {
  it('POST stores it, and POST, GET /:id and GET / all serve it as an integer', async () => {
    const created = await create({ name: 'Gym', price: 40, cycle: 'monthly', notice_days: 30 });
    expect(created.notice_days).toBe(30);
    expect((await getOne(created.id as string)).notice_days).toBe(30);
    expect((await getAll())[0].notice_days).toBe(30);
    expect(db.rows('SELECT notice_days FROM subscriptions')).toEqual([{ notice_days: 30 }]);
  });

  it('a body without it reads back null — every row that predates 0004', async () => {
    const created = await create({ name: 'Netflix', price: 9.99, cycle: 'monthly' });
    expect(created).toHaveProperty('notice_days', null);
    expect(await getOne(created.id as string)).toHaveProperty('notice_days', null);
  });

  it('PATCH sets it, leaves it alone when absent, and clears it with null', async () => {
    const { id } = await create({ name: 'Broadband', price: 30, cycle: 'monthly' });
    const set = await patch(id as string, { notice_days: 14 });
    expect(set.status).toBe(200);
    expect(await set.json()).toMatchObject({ notice_days: 14 });

    const untouched = await patch(id as string, { notes: 'contract ends 2027' });
    expect(await untouched.json()).toMatchObject({ notice_days: 14, notes: 'contract ends 2027' });

    const cleared = await patch(id as string, { notice_days: null });
    expect(cleared.status).toBe(200);
    expect(await cleared.json()).toMatchObject({ notice_days: null });
    expect(db.rows('SELECT notice_days FROM subscriptions WHERE id = ?', id as string)).toEqual([
      { notice_days: null },
    ]);
  });

  it('the boundaries 0 and 365 are accepted', async () => {
    expect(await create({ notice_days: 0 })).toMatchObject({ notice_days: 0 });
    expect(await create({ notice_days: 365 })).toMatchObject({ notice_days: 365 });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 0009_tags.sql (AD-12, train T20): the user's own labels.
describe('tags — the labels round-trip, and [] and null both mean none', () => {
  it('POST stores them as JSON text, and POST, GET /:id and GET / serve the list', async () => {
    const created = await create({ name: 'Netflix', price: 9.99, cycle: 'monthly', tags: ['family', 'Streaming'] });
    expect(created.tags).toEqual(['family', 'Streaming']);
    expect((await getOne(created.id as string)).tags).toEqual(['family', 'Streaming']);
    expect((await getAll())[0].tags).toEqual(['family', 'Streaming']);
    expect(db.rows('SELECT tags FROM subscriptions')).toEqual([{ tags: '["family","Streaming"]' }]);
  });

  it('a body without them reads back [] — every row that predates 0007', async () => {
    const created = await create({ name: 'Spotify', price: 1.99, cycle: 'monthly' });
    expect(created).toHaveProperty('tags', []);
    expect(db.rows('SELECT tags FROM subscriptions')).toEqual([{ tags: null }]);
  });

  it('PATCH sets them, leaves them alone when absent, and clears them with [] or null', async () => {
    const { id } = await create({ name: 'Gym', price: 40, cycle: 'monthly' });
    const set = await patch(id as string, { tags: ['work'] });
    expect(set.status).toBe(200);
    expect(await set.json()).toMatchObject({ tags: ['work'] });

    const untouched = await patch(id as string, { notes: 'ask HR' });
    expect(await untouched.json()).toMatchObject({ tags: ['work'], notes: 'ask HR' });

    const emptied = await patch(id as string, { tags: [] });
    expect(await emptied.json()).toMatchObject({ tags: [] });
    expect(db.rows('SELECT tags FROM subscriptions WHERE id = ?', id as string)).toEqual([{ tags: null }]);

    await patch(id as string, { tags: ['x'] });
    const cleared = await patch(id as string, { tags: null });
    expect(await cleared.json()).toMatchObject({ tags: [] });
  });

  it('the bounds are accepted at their edges: ten labels, a 32-character one', async () => {
    const ten = Array.from({ length: 10 }, (_, i) => `t${i}`);
    expect(await create({ tags: ten })).toMatchObject({ tags: ten });
    expect(await create({ tags: ['a'.repeat(32)] })).toMatchObject({ tags: ['a'.repeat(32)] });
  });

  it('text edited outside the Worker is served as [], never a 500', async () => {
    const { id } = await create({ name: 'Odd', price: 1, cycle: 'monthly' });
    db.db.prepare("UPDATE subscriptions SET tags = 'not json' WHERE id = ?").run(id as string);
    expect((await getOne(id as string)).tags).toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe('payment history is served in its subscription’s currency', () => {
  /** An overdue monthly INR row, rolled by the REAL platform fan-out — the
   *  only writer of payment_history. ⏱ 2026-09-28 · ST-T3b (ST-E3): the
   *  fan-out now writes the row's `currency` itself; the rows below whose
   *  `currency` is cleared stand for every payment written BEFORE that, which
   *  is what the COALESCE in routes/subscriptions.ts still serves. */
  async function rolled(body: Row): Promise<Row[]> {
    const { id } = await create({ name: 'Hotstar', cycle: 'monthly', next_renewal: inDays(-40), ...body });
    await recomputeRenewals(db as never, 'subscriptiontracker');
    const history = (await getOne(id as string)).payment_history as Row[];
    expect(history.length, 'the fan-out wrote no payment, so this proves nothing').toBeGreaterThan(0);
    // The fan-out's own write: the subscription's currency, and who recorded it.
    expect(db.rows('SELECT DISTINCT currency, source FROM payment_history')).toEqual([
      { currency: (body.currency as string | undefined) ?? null, source: 'renewal' },
    ]);
    // …then the pre-T3b shape, so the READ side's fallback is still what is
    // under test: a payment with no currency of its own.
    db.db.exec('UPDATE payment_history SET currency = NULL, source = NULL');
    return (await getOne(id as string)).payment_history as Row[];
  }

  it('🔴 a fan-out payment under an INR row reads INR, not the user’s currency', async () => {
    const history = await rolled({ price: 649, price_minor: 64900, currency: 'INR' });
    for (const p of history) expect(p).toMatchObject({ amount: 649, currency: 'INR', source: null });
  });

  it('a subscription with no currency leaves its payments NULL — the client fallback decides', async () => {
    const history = await rolled({ price: 9.99 });
    for (const p of history) expect(p.currency).toBeNull();
  });

  it('a payment that carries its own currency keeps it', async () => {
    const { id } = await create({ name: 'X', price: 5, price_minor: 500, currency: 'EUR' });
    db.db.exec(
      "INSERT INTO payment_history (id, subscription_id, user_id, amount, paid_at, currency, source) " +
        `VALUES ('p-own', '${String(id)}', '${U}', 4, '2026-08-01T00:00:00Z', 'GBP', 'manual')`,
    );
    const [p] = (await getOne(id as string)).payment_history as Row[];
    expect(p).toMatchObject({ currency: 'GBP', source: 'manual' });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// A RED CONTROL PER RULE. [label, body, the field the 400 must name]
const RED: ReadonlyArray<readonly [string, Row, string]> = [
  // currency
  ['currency of two letters', { currency: 'US' }, 'currency'],
  ['currency of four letters', { currency: 'USDX' }, 'currency'],
  ['currency with a digit', { currency: 'US1' }, 'currency'],
  ['currency as a number', { currency: 840 }, 'currency'],
  // price_minor
  ['price_minor as a decimal', { price: 4.99, price_minor: 4.99, currency: 'USD' }, 'price_minor'],
  ['price_minor negative', { price: 1, price_minor: -1, currency: 'USD' }, 'price_minor'],
  ['price_minor as a string', { price: 1, price_minor: '100', currency: 'USD' }, 'price_minor'],
  ['price_minor over its bound', { price: 1, price_minor: 10_000_000_000_001, currency: 'USD' }, 'price_minor'],
  ['price_minor with no price', { price_minor: 100, currency: 'USD' }, 'price_minor'],
  ['price_minor with a null price', { price: null, price_minor: 100, currency: 'USD' }, 'price_minor'],
  ['price_minor with no currency', { price: 1, price_minor: 100 }, 'price_minor'],
  ['price_minor with a null currency', { price: 1, price_minor: 100, currency: null }, 'price_minor'],
  // status
  ['status outside the set', { status: 'deleted' }, 'status'],
  ['status null (NOT NULL column)', { status: null }, 'status'],
  // `paused` and `cancelled` are ACCEPTED since ST-E3 (lifecycle.test.ts).
  // rail
  ['rail outside the set', { rail: 'visa' }, 'rail'],
  // service_id
  ['service_id with a space and capitals', { service_id: 'Netflix Premium' }, 'service_id'],
  ['service_id over its width', { service_id: 'a'.repeat(65) }, 'service_id'],
  // cancel_url
  ['cancel_url with a javascript: scheme', { cancel_url: 'javascript:alert(1)' }, 'cancel_url'],
  ['cancel_url with a data: scheme', { cancel_url: 'data:text/html,<script>1</script>' }, 'cancel_url'],
  ['cancel_url with an ftp: scheme', { cancel_url: 'ftp://example.com/x' }, 'cancel_url'],
  ['cancel_url that is not a URL', { cancel_url: 'hotstar.com/cancel' }, 'cancel_url'],
  ['cancel_url over its width', { cancel_url: `https://example.com/${'a'.repeat(2048)}` }, 'cancel_url'],
  // deleted_at — writable since ST-E3 (lifecycle.test.ts), but only as an instant
  ['deleted_at as free text', { deleted_at: 'yesterday' }, 'deleted_at'],
  ['deleted_at as a date with no time', { deleted_at: '2026-09-28' }, 'deleted_at'],
  ['deleted_at with no zone', { deleted_at: '2026-09-28T10:00:00' }, 'deleted_at'],
  ['deleted_at as a number', { deleted_at: 1_790_000_000_000 }, 'deleted_at'],
  // reminder_days
  ['reminder_days as a number', { reminder_days: 7 }, 'reminder_days'],
  ['reminder_days with a decimal', { reminder_days: [1.5] }, 'reminder_days'],
  ['reminder_days negative', { reminder_days: [-1] }, 'reminder_days'],
  ['reminder_days past a year', { reminder_days: [366] }, 'reminder_days'],
  ['reminder_days repeated', { reminder_days: [7, 7] }, 'reminder_days'],
  ['reminder_days too many', { reminder_days: [1, 2, 3, 4, 5, 6] }, 'reminder_days'],
  // the new dates
  ['first_charge_on as free text', { first_charge_on: 'last week' }, 'first_charge_on'],
  ['trial_ends_on as an impossible day', { trial_ends_on: '2026-02-30' }, 'trial_ends_on'],
  ['cancelled_on as a timestamp', { cancelled_on: '2026-09-28T00:00:00Z' }, 'cancelled_on'],
  // the new text widths
  ['notes over their width', { notes: 'n'.repeat(2001) }, 'notes'],
  ['rail_holder over its width', { rail_holder: 'r'.repeat(121) }, 'rail_holder'],
  ['shared_with over its width', { shared_with: 's'.repeat(201) }, 'shared_with'],
  ['notes as an object', { notes: {} }, 'notes'],
  // the cadence pair
  ['cycle_every without cycle_unit', { cycle_every: 1 }, 'cycle_every'],
  ['cycle_unit without cycle_every', { cycle_unit: 'week' }, 'cycle_every'],
  ['cycle_every of zero', { cycle_every: 0, cycle_unit: 'week' }, 'cycle_every'],
  ['cycle_every past its bound', { cycle_every: 367, cycle_unit: 'day' }, 'cycle_every'],
  ['cycle_every as a decimal', { cycle_every: 1.5, cycle_unit: 'month' }, 'cycle_every'],
  ['cycle_unit outside the set', { cycle_every: 1, cycle_unit: 'fortnight' }, 'cycle_unit'],
  ['cycle contradicting the pair', { cycle: 'monthly', cycle_every: 1, cycle_unit: 'week' }, 'cycle'],
  ['cycle contradicting a 12-month pair', { cycle: 'yearly', cycle_every: 12, cycle_unit: 'month' }, 'cycle'],
  ['half a cleared pair', { cycle_every: null, cycle_unit: 'week' }, 'cycle_every'],
  ['a cleared pair with a cycle', { cycle: 'monthly', cycle_every: null, cycle_unit: null }, 'cycle'],
  // the share pair
  ['share_numerator without share_denominator', { share_numerator: 1 }, 'share_numerator'],
  ['share_denominator without share_numerator', { share_denominator: 2 }, 'share_numerator'],
  ['share_denominator of zero', { share_numerator: 1, share_denominator: 0 }, 'share_denominator'],
  ['share_denominator past its bound', { share_numerator: 1, share_denominator: 101 }, 'share_denominator'],
  ['share_numerator of zero', { share_numerator: 0, share_denominator: 2 }, 'share_numerator'],
  ['share_numerator over the denominator', { share_numerator: 3, share_denominator: 2 }, 'share_numerator'],
  ['share as nulls (NOT NULL columns)', { share_numerator: null, share_denominator: null }, 'share_denominator'],
  // notice_days (0004_notice_days.sql, ST-R8)
  ['notice_days negative', { notice_days: -1 }, 'notice_days'],
  ['notice_days as a decimal', { notice_days: 1.5 }, 'notice_days'],
  ['notice_days past a year', { notice_days: 366 }, 'notice_days'],
  ['notice_days as a numeric string', { notice_days: '7' }, 'notice_days'],
  // tags (0009_tags.sql, AD-12)
  ['tags as a string', { tags: 'family' }, 'tags'],
  ['tags with a number', { tags: [1] }, 'tags'],
  ['tags with a blank label', { tags: [''] }, 'tags'],
  ['tags with an untrimmed label', { tags: [' family'] }, 'tags'],
  ['tags repeated ignoring case', { tags: ['Family', 'family'] }, 'tags'],
  ['tags too many', { tags: Array.from({ length: 11 }, (_, i) => `t${i}`) }, 'tags'],
  ['tags with a label over its width', { tags: ['a'.repeat(33)] }, 'tags'],
];

describe('a RED CONTROL for every new rule — POST refuses and stores nothing', () => {
  for (const [label, body, field] of RED) {
    it(`400s on ${label}`, async () => {
      const res = await post(body);
      expect(res.status, label).toBe(400);
      const out = (await res.json()) as { error: string; detail: string };
      expect(out.error).toBe('invalid_body');
      expect(out.detail, `the 400 for "${label}" must name ${field}`).toMatch(new RegExp(`\\b${field}\\b`));
      expect(db.rows('SELECT id FROM subscriptions'), 'a refused create stored a row').toHaveLength(0);
    });
  }
});

describe('…and PATCH refuses the same bodies with the row untouched', () => {
  for (const [label, body] of RED) {
    it(`400s on ${label}`, async () => {
      const { id } = await create(INR_WEEKLY_TRIAL);
      const before = db.rows('SELECT * FROM subscriptions WHERE id = ?', id as string);
      const res = await patch(id as string, body);
      expect(res.status, label).toBe(400);
      expect(db.rows('SELECT * FROM subscriptions WHERE id = ?', id as string)).toEqual(before);
    });
  }
});
