// ─────────────────────────────────────────────────────────────────────────────
// GET /v1/insights — a year of the user's charges and price edits, in one read
// (ST-P6 trend, round-2 F23; ST-I4 price-rise alert, round-2 X09), against the
// REAL migrations.
//
// Red control: on the base (fbe498ac) there is no src/routes/insights.ts, so
// this file does not load, and the index test below finds no /v1/insights mount.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, beforeEach } from 'vitest';
import subscriptions from '../src/routes/subscriptions';
import insights, { windowStart } from '../src/routes/insights';
import { app } from '../src/index';
import { todayYmd } from '../src/lib/d1';
import { realAppDb, asUser, SqliteD1 } from './harness';

const U = 'user-a';
type Row = Record<string, unknown>;

let db: SqliteD1;
let subs: ReturnType<typeof asUser>;
let ins: ReturnType<typeof asUser>;

beforeEach(() => {
  db = realAppDb();
  subs = asUser(subscriptions, '/v1/subscriptions', { APP_DB: db as never });
  ins = asUser(insights, '/v1/insights', { APP_DB: db as never });
});

async function create(user = U, body: Row = {}): Promise<string> {
  const res = await subs(user, '/v1/subscriptions', {
    method: 'POST',
    body: { name: 'JioHotstar', price: 649, price_minor: 64900, currency: 'INR', cycle: 'monthly', ...body },
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as Row).id as string;
}
const pay = (id: string, paid_on: string, user = U) =>
  subs(user, `/v1/subscriptions/${id}/payments`, { method: 'POST', body: { amount: 649, paid_on } });
const read = async (user = U) => {
  const res = await ins(user, '/v1/insights');
  expect(res.status).toBe(200);
  return (await res.json()) as { since: string; payments: Row[]; price_changes: Row[] };
};

describe('windowStart — the first day of the month 11 months back', () => {
  it.each([
    ['2026-09-30', '2025-10-01'],
    ['2026-01-15', '2025-02-01'],
    ['2026-12-01', '2026-01-01'],
  ])('%s → %s', (today, start) => {
    expect(windowStart(today)).toBe(start);
  });
});

describe('F23 — the payments of the last 12 months, every plan, one read', () => {
  it('serves every plan\'s charges in the window, newest first, in the row currency', async () => {
    const a = await create();
    const b = await create(U, { name: 'Netflix', price: 199, price_minor: 19900 });
    const today = todayYmd();
    expect((await pay(a, today)).status).toBe(201);
    expect((await pay(b, today)).status).toBe(201);
    const got = await read();
    expect(got.since).toBe(windowStart(today));
    expect(got.payments.map((p) => p.subscription_id).sort()).toEqual([a, b].sort());
    for (const p of got.payments) expect(p.currency).toBe('INR');
  });

  it('leaves out a charge older than the window', async () => {
    const a = await create();
    const old = new Date(Date.parse(`${windowStart(todayYmd())}T00:00:00Z`) - 86_400_000)
      .toISOString()
      .slice(0, 10);
    expect((await pay(a, old)).status).toBe(201);
    expect((await read()).payments).toHaveLength(0);
  });

  it('serves a NULL payment currency in its subscription\'s (the fan-out writes none)', async () => {
    const a = await create();
    db.db.exec(
      `INSERT INTO payment_history (id, subscription_id, user_id, amount, paid_at)
       VALUES ('p1', '${a}', '${U}', 649, '${todayYmd()}T00:00:00Z')`,
    );
    const [p] = (await read()).payments;
    expect(p).toMatchObject({ id: 'p1', currency: 'INR', amount: 649 });
  });

  it("never serves another user's rows", async () => {
    const theirs = await create('user-b');
    expect((await pay(theirs, todayYmd(), 'user-b')).status).toBe(201);
    await subs('user-b', `/v1/subscriptions/${theirs}`, { method: 'PATCH', body: { price: 999, price_minor: 99900, currency: 'INR' } });
    const got = await read();
    expect(got.payments).toHaveLength(0);
    expect(got.price_changes).toHaveLength(0);
  });
});

describe('X09 — the price edits a rise alert is computed from', () => {
  it('serves the edit PATCH logged, old and new amounts both', async () => {
    const a = await create();
    const res = await subs(U, `/v1/subscriptions/${a}`, {
      method: 'PATCH',
      body: { price: 799, price_minor: 79900, currency: 'INR' },
    });
    expect(res.status).toBe(200);
    const [c] = (await read()).price_changes;
    expect(c).toMatchObject({
      subscription_id: a,
      old_price_minor: 64900,
      new_price_minor: 79900,
      old_currency: 'INR',
      new_currency: 'INR',
    });
    expect(c).not.toHaveProperty('user_id');
  });
});

describe('removed means removed — a soft-deleted plan is not in the trend', () => {
  it("serves neither the charges nor the price edits of a REMOVED plan", async () => {
    const kept = await create();
    const gone = await create(U, { name: 'Netflix', price: 199, price_minor: 19900 });
    const today = todayYmd();
    expect((await pay(kept, today)).status).toBe(201);
    expect((await pay(gone, today)).status).toBe(201);
    for (const id of [kept, gone]) {
      const res = await subs(U, `/v1/subscriptions/${id}`, {
        method: 'PATCH',
        body: { price: 999, price_minor: 99900, currency: 'INR' },
      });
      expect(res.status).toBe(200);
    }
    // Green control: before the removal, both plans are served.
    const before = await read();
    expect(before.payments.map((p) => p.subscription_id).sort()).toEqual([kept, gone].sort());
    expect(before.price_changes.map((c) => c.subscription_id).sort()).toEqual([kept, gone].sort());

    expect((await subs(U, `/v1/subscriptions/${gone}`, { method: 'DELETE' })).status).toBe(200);
    const after = await read();
    expect(after.payments.map((p) => p.subscription_id)).toEqual([kept]);
    expect(after.price_changes.map((c) => c.subscription_id)).toEqual([kept]);
  });
});

describe('the route is mounted', () => {
  it('index.ts mounts GET /v1/insights (behind the /v1 auth group)', () => {
    const mounted = app.routes.map((r) => `${r.method} ${r.path}`);
    expect(mounted).toContain('GET /v1/insights');
  });
});
