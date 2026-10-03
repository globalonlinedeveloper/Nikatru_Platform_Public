// ─────────────────────────────────────────────────────────────────────────────
// WHAT ONE ACCOUNT CAN WRITE AND READ IS BOUNDED — lane fix-st-api-bounds.
//
//   · rv2-services-025  a body is read under a cap derived from the MAX_* bounds;
//   · rv2-services-031  a date is inside 1970-01-01..2100-12-31;
//   · rv2-services-030  a currency is in the ONE ISO 4217 table and `price_minor`
//                       is `price` in that currency's minor units;
//   · rv2-services-008  a per-account row cap, enforced in the INSERT, and a
//                       bounded, keyset-paged GET /;
//   · rv2-services-029  the POST and PATCH read-backs are the caller's own row.
//
// Every case runs against the REAL migrations on a real SQL engine, and every
// refusal also asserts that NO ROW was written.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, beforeEach } from 'vitest';
import subscriptions, {
  MAX_SUBSCRIPTIONS_PER_USER,
  PAYMENT_BODY_MAX_BYTES,
  SUBSCRIPTION_BODY_MAX_BYTES,
} from '../src/routes/subscriptions';
import { realAppDb, asUser, SqliteD1 } from './harness';

const U = 'user-a';
type Row = Record<string, unknown>;

let db: SqliteD1;
let subs: ReturnType<typeof asUser>;

beforeEach(() => {
  db = realAppDb();
  subs = asUser(subscriptions, '/v1/subscriptions', { APP_DB: db as never });
});

const post = (body: unknown, headers: Record<string, string> = {}) =>
  subs(U, '/v1/subscriptions', { method: 'POST', body, headers });
const count = () => Number(db.rows('SELECT COUNT(*) AS n FROM subscriptions')[0].n);

describe('rv2-services-025 — a body is read under a cap, before it is parsed', () => {
  it('the caps are derived and near the brief’s figures (≈ 32 KB, payments 1 KB)', () => {
    expect(SUBSCRIPTION_BODY_MAX_BYTES).toBeGreaterThan(24 * 1024);
    expect(SUBSCRIPTION_BODY_MAX_BYTES).toBeLessThanOrEqual(40 * 1024);
    expect(PAYMENT_BODY_MAX_BYTES).toBe(1024);
  });

  it('🔴 Content-Length 200000 is a 413 body_too_large and no row', async () => {
    const res = await post('{"name":"x"}', { 'Content-Length': '200000' });
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ error: 'body_too_large' });
    expect(count()).toBe(0);
  });

  it('a body over the cap with NO honest Content-Length is 413 too (the stream is budgeted)', async () => {
    const big = JSON.stringify({ name: 'x', notes: 'n'.repeat(SUBSCRIPTION_BODY_MAX_BYTES) });
    const res = await post(big);
    expect(res.status).toBe(413);
    expect(count()).toBe(0);
  });

  it('a body with every text column at its cap in 4-byte characters is NOT refused by the cap', async () => {
    const wide = (n: number) => '😀'.repeat(n / 2); // 2 UTF-16 units, 4 UTF-8 bytes
    const res = await post({
      name: wide(200),
      category: wide(120),
      plan: wide(200),
      glyph: wide(32),
      usage_note: wide(1000),
      notes: wide(2000),
      rail_holder: wide(120),
      shared_with: wide(200),
    });
    expect(res.status).toBe(201);
  });

  it('PATCH and POST /:id/payments are capped too', async () => {
    const id = ((await (await post({ name: 'x', price: 1 })).json()) as Row).id as string;
    const patch = await subs(U, `/v1/subscriptions/${id}`, {
      method: 'PATCH',
      body: '{}',
      headers: { 'Content-Length': '200000' },
    });
    expect(patch.status).toBe(413);
    const pay = await subs(U, `/v1/subscriptions/${id}/payments`, {
      method: 'POST',
      body: { amount: 1, paid_on: '2026-09-01', pad: 'p'.repeat(PAYMENT_BODY_MAX_BYTES) },
    });
    expect(pay.status).toBe(413);
    expect(db.rows('SELECT id FROM payment_history')).toEqual([]);
  });

  it('a malformed body is still the invalid_json it always was', async () => {
    const res = await post('{not json');
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_json' });
  });
});

describe('rv2-services-031 — a date is inside 1970-01-01..2100-12-31', () => {
  for (const date of ['0001-01-01', '9999-12-31', '0206-05-01', '1969-12-31', '2101-01-01']) {
    it(`🔴 next_renewal ${date} is a 400 and no row`, async () => {
      const res = await post({ name: 'x', next_renewal: date });
      expect(res.status).toBe(400);
      expect(((await res.json()) as Row).detail).toContain('1970-01-01 to 2100-12-31');
      expect(count()).toBe(0);
    });
  }

  it('every date column is bounded, not only next_renewal', async () => {
    for (const col of ['first_charge_on', 'trial_ends_on', 'cancelled_on']) {
      expect((await post({ name: 'x', [col]: '9999-12-31' })).status, col).toBe(400);
    }
    expect(count()).toBe(0);
  });

  it('the edges themselves are accepted', async () => {
    expect((await post({ name: 'x', next_renewal: '1970-01-01' })).status).toBe(201);
    expect((await post({ name: 'y', next_renewal: '2100-12-31' })).status).toBe(201);
  });
});

describe('rv2-services-030 — one ISO 4217 table, and price_minor is price', () => {
  it('🔴 currency ZZZ is a 400 and no row', async () => {
    const res = await post({ name: 'x', price: 1, currency: 'ZZZ' });
    expect(res.status).toBe(400);
    expect(((await res.json()) as Row).detail).toContain('ISO 4217');
    expect(count()).toBe(0);
  });

  it('🔴 {price: 6.49, currency: JPY, price_minor: 649} is a 400 (JPY has no minor unit)', async () => {
    const res = await post({ name: 'x', price: 6.49, currency: 'JPY', price_minor: 649 });
    expect(res.status).toBe(400);
    expect(((await res.json()) as Row).detail).toContain('price_minor');
    expect(count()).toBe(0);
  });

  it('the agreeing amounts are accepted: JPY 649, KRW 14900, BHD 2.5 → 2500, USD 19.99 → 1999', async () => {
    for (const body of [
      { price: 649, currency: 'JPY', price_minor: 649 },
      { price: 14900, currency: 'KRW', price_minor: 14900 },
      { price: 2.5, currency: 'BHD', price_minor: 2500 },
      { price: 19.99, currency: 'usd', price_minor: 1999 },
    ]) {
      expect((await post({ name: 'x', ...body })).status, JSON.stringify(body)).toBe(201);
    }
  });

  it('KRW written the two-decimal way (won × 100) is refused — the 100× mail defect', async () => {
    expect((await post({ name: 'x', price: 14900, currency: 'KRW', price_minor: 1490000 })).status).toBe(400);
    expect(count()).toBe(0);
  });

  it('a PATCH is checked by the same rule', async () => {
    const id = ((await (await post({ name: 'x' })).json()) as Row).id as string;
    const res = await subs(U, `/v1/subscriptions/${id}`, {
      method: 'PATCH',
      body: { price: 2.5, currency: 'BHD', price_minor: 250 },
    });
    expect(res.status).toBe(400);
    const pay = await subs(U, `/v1/subscriptions/${id}/payments`, {
      method: 'POST',
      body: { amount: 1, paid_on: '2026-09-01', currency: 'ZZZ' },
    });
    expect(pay.status).toBe(400);
  });
});

/** Fill U's rows to [n] directly, bypassing the route (the cap is what is under test). */
function fill(n: number, deleted = false) {
  const stmt = db.db.prepare(
    "INSERT INTO subscriptions (id, user_id, name, price, deleted_at) VALUES (?, ?, ?, ?, ?)",
  );
  for (let i = 0; i < n; i++) {
    stmt.run(`fill-${String(i).padStart(4, '0')}`, U, `s${i}`, i % 7, deleted && i === 0 ? '2026-09-01T00:00:00Z' : null);
  }
}

describe('rv2-services-008 — the per-account row cap', () => {
  it(`the cap is ${MAX_SUBSCRIPTIONS_PER_USER}`, () => {
    expect(MAX_SUBSCRIPTIONS_PER_USER).toBe(500);
  });

  it('🔴 a POST at the cap is 409 limit_reached and writes no row', async () => {
    fill(MAX_SUBSCRIPTIONS_PER_USER);
    const res = await post({ name: 'one too many' });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'limit_reached', limit: MAX_SUBSCRIPTIONS_PER_USER });
    expect(count()).toBe(MAX_SUBSCRIPTIONS_PER_USER);
  });

  it('one below the cap is still a 201, and that is the last', async () => {
    fill(MAX_SUBSCRIPTIONS_PER_USER - 1);
    expect((await post({ name: 'last' })).status).toBe(201);
    expect((await post({ name: 'over' })).status).toBe(409);
  });

  it('a removed row counts until it is purged (it still holds its storage)', async () => {
    fill(MAX_SUBSCRIPTIONS_PER_USER, true);
    expect((await post({ name: 'x' })).status).toBe(409);
  });

  it('the cap is PER ACCOUNT: another user at zero is not refused', async () => {
    fill(MAX_SUBSCRIPTIONS_PER_USER);
    expect((await subs('user-b', '/v1/subscriptions', { method: 'POST', body: { name: 'x' } })).status).toBe(201);
  });

  it('a keyed create at the cap releases its claim, so a retry after a removal succeeds', async () => {
    fill(MAX_SUBSCRIPTIONS_PER_USER);
    expect((await post({ name: 'x' }, { 'Idempotency-Key': 'cap-key-0001' })).status).toBe(409);
    expect(db.rows("SELECT key FROM idempotency_keys WHERE key = 'cap-key-0001'")).toEqual([]);
    db.db.prepare("DELETE FROM subscriptions WHERE id = 'fill-0000'").run();
    expect((await post({ name: 'x' }, { 'Idempotency-Key': 'cap-key-0001' })).status).toBe(201);
  });
});

describe('rv2-services-008 — GET / is bounded, and pages by keyset', () => {
  it('no `limit`: the bare array every older client reads, most expensive first', async () => {
    fill(5);
    const res = await subs(U, '/v1/subscriptions');
    const list = (await res.json()) as Row[];
    expect(Array.isArray(list)).toBe(true);
    expect(list.map((r) => r.price)).toEqual([4, 3, 2, 1, 0]);
  });

  it('the unpaged list holds a full account: the LIMIT is the cap, so it never truncates', async () => {
    fill(MAX_SUBSCRIPTIONS_PER_USER);
    expect(((await (await subs(U, '/v1/subscriptions')).json()) as Row[]).length).toBe(MAX_SUBSCRIPTIONS_PER_USER);
  });

  it('🔴 the unpaged list is BOUNDED: an account over the cap (rows from before it) reads at most the cap', async () => {
    fill(MAX_SUBSCRIPTIONS_PER_USER + 3);
    expect(((await (await subs(U, '/v1/subscriptions')).json()) as Row[]).length).toBe(MAX_SUBSCRIPTIONS_PER_USER);
  });

  it('?limit pages the WHOLE list exactly once, in list order, NULL prices last', async () => {
    fill(23);
    db.db.prepare("UPDATE subscriptions SET price = NULL WHERE id IN ('fill-0003', 'fill-0011')").run();
    const all = ((await (await subs(U, '/v1/subscriptions')).json()) as Row[]).map((r) => r.id);
    const seen: unknown[] = [];
    let after: string | null = null;
    let pages = 0;
    do {
      const q: string = `/v1/subscriptions?limit=4${after ? `&after=${after}` : ''}`;
      const page = (await (await subs(U, q)).json()) as { items: Row[]; next: string | null };
      expect(page.items.length).toBeLessThanOrEqual(4);
      seen.push(...page.items.map((r) => r.id));
      after = page.next;
      pages++;
    } while (after !== null && pages < 20);
    expect(pages).toBe(6);
    expect(new Set(seen).size).toBe(23);
    expect(seen.slice(-2).sort()).toEqual(['fill-0003', 'fill-0011']);
    // Same rows as the unpaged list; the order within one price is by id.
    expect([...seen].sort()).toEqual([...all].sort());
  });

  it('a row edited between pages is neither served twice nor skipped', async () => {
    fill(6);
    const first = (await (await subs(U, '/v1/subscriptions?limit=3')).json()) as { items: Row[]; next: string };
    // A row on page 2 moves ABOVE the cursor: an OFFSET would now skip a row.
    db.db.prepare("UPDATE subscriptions SET price = 99 WHERE id = 'fill-0000'").run();
    const second = (await (await subs(U, `/v1/subscriptions?limit=3&after=${first.next}`)).json()) as {
      items: Row[];
    };
    const ids = [...first.items, ...second.items].map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('a bad limit or cursor is a 400 naming it', async () => {
    for (const q of ['limit=0', 'limit=501', 'limit=2.5', 'limit=abc', 'limit=3&after=%%%', 'limit=3&after=eyJ4IjoxfQ', 'after=abc']) {
      const res = await subs(U, `/v1/subscriptions?${q}`);
      expect(res.status, q).toBe(400);
      expect(((await res.json()) as Row).error, q).toBe('invalid_query');
    }
  });

  it('a page never carries another account’s rows', async () => {
    fill(3);
    await subs('user-b', '/v1/subscriptions', { method: 'POST', body: { name: 'B only', price: 2 } });
    const page = (await (await subs(U, '/v1/subscriptions?limit=50')).json()) as { items: Row[]; next: null };
    expect(page.items.map((r) => r.user_id)).toEqual([U, U, U]);
    expect(page.next).toBeNull();
  });
});

/** APP_DB whose read-back of a subscription row by id comes back EMPTY — the
 *  write itself goes through. */
function readBackMisses(real: SqliteD1) {
  return new Proxy(real, {
    get(target, prop, receiver) {
      if (prop !== 'prepare') return Reflect.get(target, prop, receiver);
      return (sql: string) => {
        const stmt = target.prepare(sql);
        if (!/^SELECT \* FROM subscriptions WHERE id = \? AND user_id = \?$/.test(sql.trim())) return stmt;
        return {
          bind: (...args: unknown[]) => {
            const bound = stmt.bind(...args);
            return Object.assign(Object.create(Object.getPrototypeOf(bound)), bound, { first: async () => null });
          },
        };
      };
    },
  });
}

describe('rv2-services-029 — the read-backs are the caller’s own row', () => {
  it('🔴 PATCH whose read-back finds nothing is a 404, never a 200 carrying {error}', async () => {
    const id = ((await (await post({ name: 'x' })).json()) as Row).id as string;
    const stubbed = asUser(subscriptions, '/v1/subscriptions', { APP_DB: readBackMisses(db) as never });
    const res = await stubbed(U, `/v1/subscriptions/${id}`, { method: 'PATCH', body: { name: 'y' } });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
  });

  it('POST whose read-back finds nothing is a 500, never a 201 carrying {error}', async () => {
    const stubbed = asUser(subscriptions, '/v1/subscriptions', { APP_DB: readBackMisses(db) as never });
    const res = await stubbed(U, '/v1/subscriptions', { method: 'POST', body: { name: 'x' } });
    expect(res.status).toBe(500);
  });

  it('both read-backs carry `AND user_id = ?` (the predicate is in the SQL, not only in the id)', async () => {
    const seen: string[] = [];
    const spy = new Proxy(db, {
      get(target, prop, receiver) {
        if (prop !== 'prepare') return Reflect.get(target, prop, receiver);
        return (sql: string) => {
          seen.push(sql.replace(/\s+/g, ' ').trim());
          return target.prepare(sql);
        };
      },
    });
    const s = asUser(subscriptions, '/v1/subscriptions', { APP_DB: spy as never });
    const id = ((await (await s(U, '/v1/subscriptions', { method: 'POST', body: { name: 'x' } })).json()) as Row)
      .id as string;
    await s(U, `/v1/subscriptions/${id}`, { method: 'PATCH', body: { name: 'y' } });
    const reads = seen.filter((q) => q.startsWith('SELECT * FROM subscriptions WHERE id = ?'));
    expect(reads.length).toBeGreaterThanOrEqual(2);
    for (const q of reads) expect(q).toContain('AND user_id = ?');
  });
});
