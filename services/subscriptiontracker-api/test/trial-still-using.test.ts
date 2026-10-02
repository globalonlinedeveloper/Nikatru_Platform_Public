// ─────────────────────────────────────────────────────────────────────────────
// Train T11 · 0010's fields on the wire: the price after a trial (AD-08) and the
// "Still using?" answer (IN-08).
//
//   · `price_after_trial_minor` — an exact amount in the ROW's currency,
//     bounded like `price_minor`. Before 0010 there was nowhere to put it, so a
//     trial converted at the price typed for the trial.
//   · `still_using` / `still_using_at` — the answer, and the SERVER's time it
//     was given. Before, the answer lived on one device
//     (localSubscriptionStoreProvider.writeStillUsing), so every other device
//     asked again.
//
// RED CONTROL: remove the three keys from `serializeSubscription` — the
// round-trip tests read `undefined` for every one; remove them from `validate`
// and the POST stores NULL for both.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import subscriptions from '../src/routes/subscriptions';
import { realAppDb, asUser } from './harness';

const U = 'user-a';
type Row = Record<string, unknown>;

let db: ReturnType<typeof realAppDb>;
let subs: ReturnType<typeof asUser>;

beforeEach(() => {
  db = realAppDb();
  subs = asUser(subscriptions, '/v1/subscriptions', { APP_DB: db as never });
});
afterEach(() => {
  vi.useRealTimers();
});

const post = (body: Row) => subs(U, '/v1/subscriptions', { method: 'POST', body });
const patch = (id: string, body: Row) => subs(U, `/v1/subscriptions/${id}`, { method: 'PATCH', body });
const getOne = async (id: string) => (await (await subs(U, `/v1/subscriptions/${id}`)).json()) as Row;
const getAll = async () => (await (await subs(U, '/v1/subscriptions')).json()) as Row[];

/** A free week, then ₹899 a month. */
const TRIAL = {
  name: 'JioHotstar',
  price: 0,
  price_minor: 0,
  currency: 'INR',
  cycle: 'monthly',
  status: 'trialing',
  trial_ends_on: '2026-10-08',
  next_renewal: '2026-10-08',
  price_after_trial_minor: 89900,
};

async function create(body: Row): Promise<Row> {
  const res = await post(body);
  expect(res.status, JSON.stringify(await res.clone().json())).toBe(201);
  return (await res.json()) as Row;
}

describe('AD-08 — a trialing row with a post-trial price round-trips exactly', () => {
  it('POST, GET /:id and GET / serve the post-trial price as sent; the DB holds it as an integer', async () => {
    const created = await create(TRIAL);
    expect(created).toMatchObject({ status: 'trialing', price: 0, price_after_trial_minor: 89900, currency: 'INR' });
    const { payment_history: _h, price_history: _p, ...one } = await getOne(created.id as string);
    expect(one).toEqual(created);
    expect(await getAll()).toEqual([created]);
    expect(db.rows('SELECT price_after_trial_minor FROM subscriptions')).toEqual([{ price_after_trial_minor: 89900 }]);
  });

  it('a row without one, and every row that predates 0010, serves null', async () => {
    const created = await create({ name: 'Netflix', price: 649, cycle: 'monthly' });
    expect(created).toMatchObject({ price_after_trial_minor: null, still_using: null, still_using_at: null });
  });

  it('PATCH sets it in the stored currency, and null clears it', async () => {
    const { id } = await create({ ...TRIAL, price_after_trial_minor: null });
    const set = await patch(id as string, { price_after_trial_minor: 64900 });
    expect(set.status).toBe(200);
    expect(await set.json()).toMatchObject({ price_after_trial_minor: 64900, currency: 'INR' });
    const cleared = await patch(id as string, { price_after_trial_minor: null });
    expect(await cleared.json()).toMatchObject({ price_after_trial_minor: null });
  });

  it('is bounded like price_minor: a whole number, 0 to 10^13', async () => {
    for (const bad of [-1, 1.5, '89900', 10_000_000_000_001, true]) {
      const res = await post({ ...TRIAL, price_after_trial_minor: bad });
      expect(res.status, JSON.stringify(bad)).toBe(400);
      expect(((await res.json()) as Row).detail).toMatch(/^price_after_trial_minor must be a whole number/);
    }
    expect(db.rows('SELECT id FROM subscriptions')).toHaveLength(0);
  });

  it('needs a currency to be in: a POST without one, or a PATCH on a row with none, is a 400 that writes nothing', async () => {
    const noCurrency = await post({ name: 'X', price: 0, price_after_trial_minor: 500 });
    expect(noCurrency.status).toBe(400);
    expect(((await noCurrency.json()) as Row).detail).toMatch(/needs a currency/);
    expect(db.rows('SELECT id FROM subscriptions')).toHaveLength(0);

    const { id } = await create({ name: 'Legacy', price: 5 });
    const res = await patch(id as string, { price_after_trial_minor: 500 });
    expect(res.status).toBe(400);
    expect(db.rows('SELECT price_after_trial_minor FROM subscriptions')).toEqual([{ price_after_trial_minor: null }]);
    // Sent WITH a currency, the same edit is fine.
    expect((await patch(id as string, { price_after_trial_minor: 500, currency: 'usd' })).status).toBe(200);
  });

  it('a currency that MOVES takes it away; the same currency re-sent (every older client’s full-body edit) keeps it', async () => {
    const { id } = await create(TRIAL);
    const same = await patch(id as string, { name: 'JioHotstar Super', currency: 'INR', price: 0, price_minor: 0 });
    expect(await same.json()).toMatchObject({ price_after_trial_minor: 89900 });
    const moved = await patch(id as string, { currency: 'JPY' });
    expect(await moved.json()).toMatchObject({ currency: 'JPY', price_after_trial_minor: null });
  });
});

describe('IN-08 — "Still using?" is answered once, for every device', () => {
  it('an answer is stored with the SERVER’s time; a device that syncs afterwards reads it', async () => {
    vi.useFakeTimers({ now: Date.parse('2026-10-01T09:00:00Z'), toFake: ['Date'] });
    const { id } = await create({ name: 'Gym', price: 40, cycle: 'monthly' });
    const res = await patch(id as string, { still_using: 'yes' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ still_using: 'yes', still_using_at: '2026-10-01T09:00:00.000Z' });
    // The second device: another session for the same user, reading the list.
    const otherDevice = asUser(subscriptions, '/v1/subscriptions', { APP_DB: db as never });
    const [row] = (await (await otherDevice(U, '/v1/subscriptions')).json()) as Row[];
    expect([row.still_using, row.still_using_at]).toEqual(['yes', '2026-10-01T09:00:00.000Z']);
  });

  it('the client’s still_using_at is never stored: a back-dated echo keeps the server stamp', async () => {
    vi.useFakeTimers({ now: Date.parse('2026-10-01T09:00:00Z'), toFake: ['Date'] });
    const { id } = await create({ name: 'Gym', price: 40, still_using: 'no', still_using_at: '2001-01-01T00:00:00Z' });
    expect(db.rows('SELECT still_using, still_using_at FROM subscriptions WHERE id = ?', id as string)).toEqual([
      { still_using: 'no', still_using_at: '2026-10-01T09:00:00.000Z' },
    ]);
  });

  it('re-sending the SAME answer keeps its stamp; a DIFFERENT answer re-stamps; null clears both', async () => {
    vi.useFakeTimers({ now: Date.parse('2026-10-01T09:00:00Z'), toFake: ['Date'] });
    const { id } = await create({ name: 'Gym', price: 40 });
    await patch(id as string, { still_using: 'yes' });
    vi.setSystemTime(Date.parse('2026-10-05T09:00:00Z'));
    expect(await (await patch(id as string, { still_using: 'yes', notes: 'x' })).json()).toMatchObject({
      still_using: 'yes',
      still_using_at: '2026-10-01T09:00:00.000Z',
    });
    expect(await (await patch(id as string, { still_using: 'no' })).json()).toMatchObject({
      still_using: 'no',
      still_using_at: '2026-10-05T09:00:00.000Z',
    });
    expect(await (await patch(id as string, { still_using: null })).json()).toMatchObject({
      still_using: null,
      still_using_at: null,
    });
  });

  it('only yes, no or null is an answer; a malformed still_using_at is refused', async () => {
    for (const body of [{ still_using: 'maybe' }, { still_using: true }, { still_using: 'YES' }, { still_using_at: 'yesterday' }]) {
      const res = await post({ name: 'X', ...body });
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(((await res.json()) as Row).error).toBe('invalid_body');
    }
    expect(db.rows('SELECT id FROM subscriptions')).toHaveLength(0);
  });
});
