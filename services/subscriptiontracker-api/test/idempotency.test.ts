// ─────────────────────────────────────────────────────────────────────────────
// POST /v1/subscriptions with an Idempotency-Key — AB-O2-02 (the server half of
// the offline outbox, audit D22). Against a REAL SQL engine (node:sqlite + the
// real migrations): the primary key is the lock, and a mock has none.
//
// Red control: the same key posted twice yields ONE row. On the base the route
// ignored the header and minted a fresh uuid per request — two rows.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, beforeEach } from 'vitest';
import subscriptions from '../src/routes/subscriptions';
import { idempotentRowId } from '../src/lib/idempotency';
import { realAppDb, asUser } from './harness';

const BODY = {
  name: 'Gym',
  category: 'Health',
  price: 20,
  cycle: 'monthly',
  next_renewal: '2026-10-01',
};
// Low-entropy on purpose: gitleaks reads a random UUID in a constant named KEY
// as a leaked secret (generic-api-key).
const CLIENT_ID = 'offline-add-0001';

let db: ReturnType<typeof realAppDb>;
let subs: ReturnType<typeof asUser>;

beforeEach(() => {
  db = realAppDb();
  subs = asUser(subscriptions, '/v1/subscriptions', { APP_DB: db as never });
});

const post = (user: string, key?: string, body: unknown = BODY) =>
  subs(user, '/v1/subscriptions', {
    method: 'POST',
    body,
    headers: key === undefined ? {} : { 'Idempotency-Key': key },
  });

async function count(user: string): Promise<number> {
  const res = await subs(user, '/v1/subscriptions');
  return ((await res.json()) as unknown[]).length;
}

describe('POST /v1/subscriptions — Idempotency-Key', () => {
  it('the same key posted twice yields one row, and the repeat is answered with it', async () => {
    const first = await post('user-a', CLIENT_ID);
    expect(first.status).toBe(201);
    const made = (await first.json()) as { id: string };

    const again = await post('user-a', CLIENT_ID);
    expect(again.status).toBe(200);
    expect(((await again.json()) as { id: string }).id).toBe(made.id);
    expect(await count('user-a')).toBe(1);
  });

  it('an attempt that loses the insert race is answered with the winning row, not a 500', async () => {
    expect((await post('user-a', CLIENT_ID)).status).toBe(201);
    // The race, made deterministic: the second attempt's LOOKUP misses (the
    // winner had not committed when it looked), so it goes on to INSERT the
    // same derived id and hits the primary key.
    let missed = false;
    const racing = new Proxy(db, {
      get(target, prop, receiver) {
        if (prop !== 'prepare') return Reflect.get(target, prop, receiver);
        return (sql: string) => {
          const stmt = target.prepare(sql);
          if (missed || !sql.startsWith('SELECT * FROM subscriptions WHERE id = ? AND user_id = ?')) return stmt;
          missed = true;
          return { bind: () => ({ first: async () => null }) };
        };
      },
    });
    const loser = asUser(subscriptions, '/v1/subscriptions', { APP_DB: racing as never });
    const res = await loser('user-a', '/v1/subscriptions', {
      method: 'POST',
      body: BODY,
      headers: { 'Idempotency-Key': CLIENT_ID },
    });
    expect(missed).toBe(true);
    expect(res.status).toBe(200);
    expect(await count('user-a')).toBe(1);
  });

  it('the key is private to its account: another user with the same key gets their own row', async () => {
    expect((await post('user-a', CLIENT_ID)).status).toBe(201);
    expect((await post('user-b', CLIENT_ID)).status).toBe(201);
    expect(await count('user-a')).toBe(1);
    expect(await count('user-b')).toBe(1);
    expect(await idempotentRowId('user-a', CLIENT_ID)).not.toBe(await idempotentRowId('user-b', CLIENT_ID));
  });

  it('no key behaves as before: two posts, two rows', async () => {
    expect((await post('user-a')).status).toBe(201);
    expect((await post('user-a')).status).toBe(201);
    expect(await count('user-a')).toBe(2);
  });

  it('a malformed key is a 400 and writes nothing', async () => {
    for (const bad of ['short', 'has space in it', 'x'.repeat(129), 'semi;colon-key']) {
      const res = await post('user-a', bad);
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toBe('invalid_idempotency_key');
    }
    expect(await count('user-a')).toBe(0);
  });

  it('a keyed create with an invalid body is still refused by validation', async () => {
    const res = await post('user-a', CLIENT_ID, { name: {} });
    expect(res.status).toBe(400);
    expect(await count('user-a')).toBe(0);
  });
});
