// ─────────────────────────────────────────────────────────────────────────────
// THE TWO HISTORIES THE USER WRITES — a manual payment (ST-R5, round-2 X06) and
// the price-change log (ST-I4, round-2 F14), against the REAL migrations.
//
// Red control: on main 454dd415 there is no POST /:id/payments (404) and no
// price_change table, so every "writes one row" assertion below fails there.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, beforeEach } from 'vitest';
import subscriptions from '../src/routes/subscriptions';
import { realAppDb, asUser, SqliteD1 } from './harness';

const U = 'user-a';
type Row = Record<string, unknown>;

let db: SqliteD1;
let subs: ReturnType<typeof asUser>;

beforeEach(() => {
  db = realAppDb();
  subs = asUser(subscriptions, '/v1/subscriptions', { APP_DB: db as never });
});

async function create(body: Row = {}): Promise<string> {
  const res = await subs(U, '/v1/subscriptions', {
    method: 'POST',
    body: { name: 'JioHotstar', price: 649, price_minor: 64900, currency: 'INR', cycle: 'monthly', ...body },
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as Row).id as string;
}
const pay = (id: string, body: unknown, user = U) =>
  subs(user, `/v1/subscriptions/${id}/payments`, { method: 'POST', body });
const patch = (id: string, body: Row) => subs(U, `/v1/subscriptions/${id}`, { method: 'PATCH', body });
const getOne = async (id: string) => (await (await subs(U, `/v1/subscriptions/${id}`)).json()) as Row;

describe('X06 — POST /v1/subscriptions/:id/payments records a manual payment', () => {
  it('is 201, and GET /:id lists it in the history as manual, in the row currency', async () => {
    const id = await create();
    const res = await pay(id, { amount: 649, paid_on: '2026-09-20' });
    expect(res.status, 'main has no such route').toBe(201);
    const made = (await res.json()) as Row;
    expect(made).toMatchObject({
      subscription_id: id,
      amount: 649,
      paid_at: '2026-09-20T00:00:00Z',
      currency: 'INR',
      source: 'manual',
    });
    const history = (await getOne(id)).payment_history as Row[];
    expect(history.map((p) => [p.id, p.source])).toEqual([[made.id, 'manual']]);
  });

  it('keeps a currency of its own when one is sent', async () => {
    const id = await create();
    const made = (await (await pay(id, { amount: 7.99, paid_on: '2026-09-20', currency: 'usd' })).json()) as Row;
    expect(made.currency).toBe('USD');
  });

  const RED: ReadonlyArray<readonly [string, unknown, string]> = [
    ['no amount', { paid_on: '2026-09-20' }, 'amount'],
    ['a negative amount', { amount: -1, paid_on: '2026-09-20' }, 'amount'],
    ['an amount as a string', { amount: '649', paid_on: '2026-09-20' }, 'amount'],
    ['no date', { amount: 649 }, 'paid_on'],
    ['an impossible date', { amount: 649, paid_on: '2026-02-30' }, 'paid_on'],
    ['a bad currency', { amount: 649, paid_on: '2026-09-20', currency: 'RUPEES' }, 'currency'],
    ['a non-object body', [649], 'body'],
  ];
  for (const [label, body, field] of RED) {
    it(`400s on ${label}, storing nothing`, async () => {
      const id = await create();
      const res = await pay(id, body);
      expect(res.status).toBe(400);
      expect(((await res.json()) as Row).detail).toMatch(new RegExp(`\\b${field}\\b`));
      expect(db.rows('SELECT id FROM payment_history')).toHaveLength(0);
    });
  }

  it("404s for another user's row and for a removed one, storing nothing", async () => {
    const id = await create();
    expect((await pay(id, { amount: 1, paid_on: '2026-09-20' }, 'user-b')).status).toBe(404);
    await subs(U, `/v1/subscriptions/${id}`, { method: 'DELETE' });
    expect((await pay(id, { amount: 1, paid_on: '2026-09-20' })).status).toBe(404);
    expect(db.rows('SELECT id FROM payment_history')).toHaveLength(0);
  });
});

describe('F14 — every price edit writes one price_change row', () => {
  it('a PATCH that changes the price writes one row, old and new, served as price_history', async () => {
    const id = await create();
    const res = await patch(id, { price: 899, price_minor: 89900, currency: 'INR' });
    expect(res.status).toBe(200);
    const rows = db.rows(
      'SELECT subscription_id, user_id, old_price, new_price, old_price_minor, new_price_minor, old_currency, new_currency FROM price_change',
    );
    expect(rows, 'main has no price_change table').toEqual([
      {
        subscription_id: id,
        user_id: U,
        old_price: 649,
        new_price: 899,
        old_price_minor: 64900,
        new_price_minor: 89900,
        old_currency: 'INR',
        new_currency: 'INR',
      },
    ]);
    const served = (await getOne(id)).price_history as Row[];
    expect(served.map((p) => [p.old_price, p.new_price])).toEqual([[649, 899]]);
  });

  it('an edit that does not move the amount writes nothing', async () => {
    const id = await create();
    await patch(id, { name: 'Hotstar' });
    await patch(id, { price: 649, price_minor: 64900, currency: 'INR' });
    expect(db.rows('SELECT id FROM price_change')).toHaveLength(0);
  });

  it('a legacy row stamped with its currency is not a price change; a currency switch is', async () => {
    const id = await create({ currency: undefined, price_minor: undefined });
    await patch(id, { currency: 'INR' });
    expect(db.rows('SELECT id FROM price_change'), 'NULL → INR is a stamp, not a change').toHaveLength(0);
    await patch(id, { currency: 'USD' });
    expect(db.rows('SELECT old_currency, new_currency FROM price_change')).toEqual([
      { old_currency: 'INR', new_currency: 'USD' },
    ]);
  });

  it('a refused edit logs nothing', async () => {
    const id = await create();
    expect((await patch(id, { price: -5 })).status).toBe(400);
    expect(db.rows('SELECT id FROM price_change')).toHaveLength(0);
  });
});
