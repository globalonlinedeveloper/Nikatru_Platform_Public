// ─────────────────────────────────────────────────────────────────────────────
// THE PER-USER TENANCY PREDICATE.
//
// D1 has no row-level security, and the corpus deliberately declined it
// ("authorize in the Worker, not RLS"). So `AND user_id = ?` in these route
// queries IS the whole tenancy boundary for a live, deployed, multi-user API —
// and until this file it was enforced by nothing but code review. Proven
// 2026-07-31: deleting `AND user_id = ?` from subscriptions.ts:107 left
// `tsc --noEmit` AND `wrangler deploy --dry-run` both green, i.e. the entire CI
// lane passed on a Worker where any authenticated user could read any other
// user's subscription by id.
//
// These run against a REAL SQL engine. That is not a nicety: a recording mock
// never EVALUATES a WHERE clause, so every assertion here would pass against
// the mutated route. The only honest test of a predicate is to let a database
// apply it.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, beforeEach } from 'vitest';
import subscriptions from '../src/routes/subscriptions';
import budget from '../src/routes/budget';
import renewals from '../src/routes/renewals';
import { realAppDb, asUser } from './harness';

const A = 'user-a';
const B = 'user-b';

let db: ReturnType<typeof realAppDb>;
let subs: ReturnType<typeof asUser>;
let budgets: ReturnType<typeof asUser>;

beforeEach(() => {
  db = realAppDb();
  subs = asUser(subscriptions, '/v1/subscriptions', { APP_DB: db as never });
  budgets = asUser(budget, '/v1/budget', { APP_DB: db as never });
});

/** Create a subscription as `user` and return its id. */
async function create(user: string, name: string, price = 9.99) {
  const res = await subs(user, '/v1/subscriptions', {
    method: 'POST',
    body: { name, price, plan: 'Pro', usage_note: `${user} private note` },
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

describe('subscriptions are readable only by their owner', () => {
  it('user B cannot GET user A’s subscription by id', async () => {
    const id = await create(A, 'Netflix');
    const res = await subs(B, `/v1/subscriptions/${id}`);
    expect(res.status, 'B must not be able to read A’s row').toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
  });

  it('user B’s list contains only user B’s rows', async () => {
    await create(A, 'Netflix');
    await create(A, 'Spotify');
    await create(B, 'Disney+');
    const list = (await (await subs(B, '/v1/subscriptions')).json()) as Array<{
      name: string;
      user_id: string;
    }>;
    expect(list.map((r) => r.name)).toEqual(['Disney+']);
    expect(new Set(list.map((r) => r.user_id))).toEqual(new Set([B]));
  });

  it('the owner CAN read their own row — the predicate is not just denying everything', async () => {
    // Without this, a route that returned 404 unconditionally would pass the
    // tests above. A guard that cannot distinguish "secure" from "broken" is not
    // a guard.
    const id = await create(A, 'Netflix');
    const res = await subs(A, `/v1/subscriptions/${id}`);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { name: string }).name).toBe('Netflix');
  });
});

describe('subscriptions are writable only by their owner', () => {
  it('user B cannot PATCH user A’s subscription, and A’s data is unchanged', async () => {
    const id = await create(A, 'Netflix');
    const res = await subs(B, `/v1/subscriptions/${id}`, {
      method: 'PATCH',
      body: { name: 'HIJACKED', price: 0 },
    });
    expect(res.status).toBe(404);
    const [row] = db.rows('SELECT name, price FROM subscriptions WHERE id = ?', id);
    expect(row.name).toBe('Netflix');
    expect(row.price).toBe(9.99);
  });

  it('user B cannot DELETE user A’s subscription', async () => {
    const id = await create(A, 'Netflix');
    // DELETE answers ok:true either way (it is idempotent by design); what must
    // hold is that the ROW survives.
    await subs(B, `/v1/subscriptions/${id}`, { method: 'DELETE' });
    expect(
      db.rows('SELECT id FROM subscriptions WHERE id = ?', id),
      'A’s row must still exist',
    ).toHaveLength(1);
  });

  it('the owner CAN patch and delete their own row', async () => {
    const id = await create(A, 'Netflix');
    expect((await subs(A, `/v1/subscriptions/${id}`, { method: 'PATCH', body: { name: 'N2' } })).status).toBe(200);
    expect(db.rows('SELECT name FROM subscriptions WHERE id = ?', id)[0].name).toBe('N2');
    await subs(A, `/v1/subscriptions/${id}`, { method: 'DELETE' });
    expect(db.rows('SELECT id FROM subscriptions WHERE id = ?', id)).toHaveLength(0);
  });
});

describe('payment history is scoped to the owner', () => {
  it('a payment row belonging to A is not returned to B', async () => {
    const id = await create(A, 'Netflix');
    db.db
      .prepare(
        'INSERT INTO payment_history (id, subscription_id, user_id, amount, paid_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run('p1', id, A, 9.99, '2026-07-01');

    const own = (await (await subs(A, `/v1/subscriptions/${id}`)).json()) as {
      payment_history: unknown[];
    };
    expect(own.payment_history).toHaveLength(1);

    // B cannot even reach the row, so it cannot reach the payments either.
    expect((await subs(B, `/v1/subscriptions/${id}`)).status).toBe(404);
  });
});

describe('budget rows are scoped to the owner', () => {
  it('user B’s PUT does not touch user A’s category caps', async () => {
    await budgets(A, '/v1/budget', {
      method: 'PUT',
      body: { monthly_budget: 500, categories: [{ name: 'Music', cap: 20 }] },
    });
    await budgets(B, '/v1/budget', {
      method: 'PUT',
      body: { monthly_budget: 10, categories: [{ name: 'Games', cap: 5 }] },
    });

    const forA = db.rows('SELECT name FROM budget_categories WHERE user_id = ?', A);
    expect(forA.map((r) => r.name)).toEqual(['Music']);
    expect(
      db.rows('SELECT monthly_budget FROM budgets WHERE user_id = ?', A)[0].monthly_budget,
    ).toBe(500);
  });

  it('user B’s GET returns user B’s budget, not user A’s', async () => {
    await budgets(A, '/v1/budget', {
      method: 'PUT',
      body: { monthly_budget: 500, categories: [{ name: 'Music', cap: 20 }] },
    });
    expect(await (await budgets(B, '/v1/budget')).json()).toEqual({
      monthly_budget: 0,
      categories: [],
    });
  });
});

describe('renewals are scoped to the owner', () => {
  it('user B’s upcoming renewals never include user A’s subscriptions', async () => {
    const rens = asUser(renewals, '/v1/renewals', { APP_DB: db as never });
    const soon = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
    await subs(A, '/v1/subscriptions', {
      method: 'POST',
      body: { name: 'Netflix', price: 9.99, next_renewal: soon },
    });
    const res = await rens(B, '/v1/renewals');
    expect(res.status).toBe(200);
    expect(JSON.stringify(await res.json())).not.toContain('Netflix');
  });
});

describe('every route refuses a caller with no identity', () => {
  it('401s when the auth middleware sets no userId', async () => {
    for (const [call, path] of [
      [subs, '/v1/subscriptions'],
      [budgets, '/v1/budget'],
    ] as const) {
      const res = await call('', path);
      expect(res.status).toBe(401);
    }
  });
});
