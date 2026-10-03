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
import { Hono } from 'hono';
import type { AppEnv } from '../src/types';
import { SUBSCRIPTION_BODY_MAX_BYTES } from '../src/routes/subscriptions';
import { boundedJson } from '../src/lib/json-body';
import { CREATE_SCOPE, idempotentCreate, idempotentRowId } from '../src/lib/idempotency';
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

  it('an attempt that loses the CLAIM race is answered with the winning row, never through the error path', async () => {
    expect((await post('user-a', CLIENT_ID)).status).toBe(201);
    // The race, made deterministic: the second attempt's claim LOOKUP misses
    // (the winner had not committed when it looked), so it goes on to claim
    // the key and loses the INSERT … ON CONFLICT DO NOTHING.
    let missed = false;
    const racing = new Proxy(db, {
      get(target, prop, receiver) {
        if (prop !== 'prepare') return Reflect.get(target, prop, receiver);
        return (sql: string) => {
          const stmt = target.prepare(sql);
          if (missed || !sql.startsWith('SELECT body_hash, row_id, state, created_at FROM idempotency_keys')) return stmt;
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
    expect(res.status).toBe(200); // the harness's onError would answer 500
    expect(await count('user-a')).toBe(1);
  });

  it('a replay answers the row the create made, field for field', async () => {
    const first = await post('user-a', CLIENT_ID);
    const again = await post('user-a', CLIENT_ID);
    expect(await again.json()).toEqual(await first.json());
  });

  it('the same key with a DIFFERENT body is a 422, and nothing is written', async () => {
    expect((await post('user-a', CLIENT_ID)).status).toBe(201);
    const res = await post('user-a', CLIENT_ID, { ...BODY, price: 99 });
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: string }).error).toBe('idempotency_key_reused');
    expect(await count('user-a')).toBe(1);
  });

  // Review #1075 round 2, minor b: DELETE is a SOFT delete in production, and
  // the replay after it must already be 410 — not 200 with the deleted row.
  it('a replay after the row was deleted (the API DELETE, a soft delete) is 410', async () => {
    const made = (await (await post('user-a', CLIENT_ID)).json()) as { id: string };
    expect((await subs('user-a', `/v1/subscriptions/${made.id}`, { method: 'DELETE' })).status).toBe(200);
    const res = await post('user-a', CLIENT_ID);
    expect(res.status).toBe(410);
    expect(await count('user-a')).toBe(0);
  });

  it('after a purge the key still answers 410 and never re-creates the row (the tombstone)', async () => {
    const made = (await (await post('user-a', CLIENT_ID)).json()) as { id: string };
    await subs('user-a', `/v1/subscriptions/${made.id}`, { method: 'DELETE' });
    db.prepare('DELETE FROM subscriptions WHERE id = ?').bind(made.id).run();
    expect((await post('user-a', CLIENT_ID)).status).toBe(410);
    expect(await count('user-a')).toBe(0);
  });

  // Review #1075 round 2, minor c: a claim whose request died answered 409
  // forever. The clock is moved by ageing the claim's created_at.
  const ageClaim = (minutes: number) =>
    db
      .prepare("UPDATE idempotency_keys SET state = 'pending', created_at = ? WHERE key = ?")
      .bind(new Date(Date.now() - minutes * 60_000).toISOString(), CLIENT_ID)
      .run();

  it('a pending claim younger than 10 minutes is still 409', async () => {
    expect((await post('user-a', CLIENT_ID)).status).toBe(201);
    await ageClaim(9);
    expect((await post('user-a', CLIENT_ID)).status).toBe(409);
  });

  it('an abandoned pending claim whose row exists is marked done and answered 200', async () => {
    expect((await post('user-a', CLIENT_ID)).status).toBe(201);
    await ageClaim(11);
    expect((await post('user-a', CLIENT_ID)).status).toBe(200);
    const claim = db.rows("SELECT state FROM idempotency_keys WHERE key = 'offline-add-0001'")[0] as { state: string };
    expect(claim.state).toBe('done');
    expect(await count('user-a')).toBe(1);
  });

  it('an abandoned pending claim with no row is taken over and the create runs', async () => {
    expect((await post('user-a', CLIENT_ID)).status).toBe(201);
    // The request died after claiming and before inserting: no row.
    db.prepare("DELETE FROM subscriptions WHERE user_id = 'user-a'").run();
    await ageClaim(11);
    expect((await post('user-a', CLIENT_ID)).status).toBe(201);
    expect(await count('user-a')).toBe(1);
  });

  it('a key still being processed is a 409, not a second insert', async () => {
    expect((await post('user-a', CLIENT_ID)).status).toBe(201);
    // Rewind the claim to the moment the first attempt was still running.
    await db.prepare("UPDATE idempotency_keys SET state = 'pending' WHERE key = ?").bind(CLIENT_ID).run();
    const res = await post('user-a', CLIENT_ID);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe('idempotency_in_progress');
    expect(await count('user-a')).toBe(1);
  });

  it('a refused create releases its claim, so the corrected retry can create', async () => {
    expect((await post('user-a', CLIENT_ID, { name: {} })).status).toBe(400);
    expect((await post('user-a', CLIENT_ID)).status).toBe(201);
  });

  it('the key is private to its account: another user with the same key gets their own row', async () => {
    expect((await post('user-a', CLIENT_ID)).status).toBe(201);
    expect((await post('user-b', CLIENT_ID)).status).toBe(201);
    expect(await count('user-a')).toBe(1);
    expect(await count('user-b')).toBe(1);
    expect(await idempotentRowId('user-a', CLIENT_ID)).not.toBe(await idempotentRowId('user-b', CLIENT_ID));
  });

  // Pre-merge E2E on #1075: the app sends the key as a QUERY PARAMETER (a new
  // header failed the browser's CORS preflight against the Worker as deployed).
  it('the key as the idempotency_key query parameter is the same key', async () => {
    const viaQuery = () =>
      subs('user-a', `/v1/subscriptions?idempotency_key=${CLIENT_ID}`, { method: 'POST', body: BODY });
    const first = await viaQuery();
    expect(first.status).toBe(201);
    const again = await viaQuery();
    expect(again.status).toBe(200);
    expect(((await again.json()) as { id: string }).id).toBe(((await first.json()) as { id: string }).id);
    // ...and the header and the parameter name ONE key.
    expect((await post('user-a', CLIENT_ID)).status).toBe(200);
    expect(await count('user-a')).toBe(1);
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

// ⏱ 2026-10-01 · review of #1121, nit 1. `requestHash` chose the create's hash
// by OBJECT IDENTITY (`scope === CREATE_SCOPE`), so a route mounted with an
// equal literal `{ name: 'create' }` hashed every body down the prefixed branch
// — and every claim already in production's ledger would answer 422 to its own
// retry through it. Red control: restore `scope === CREATE_SCOPE` and this is
// 422 idempotency_key_reused.
describe('the create scope is chosen by NAME, not by object identity', () => {
  it('🔴 a claim made by POST / is replayed (200) through a route mounted with an equal literal scope', async () => {
    const first = await post('user-a', CLIENT_ID);
    expect(first.status).toBe(201);
    const made = (await first.json()) as { id: string };

    const literal = new Hono<AppEnv>();
    literal.post(
      '/',
      boundedJson(SUBSCRIPTION_BODY_MAX_BYTES),
      idempotentCreate(
        async (c, id) => {
          const row = db.rows('SELECT id FROM subscriptions WHERE id = ? AND user_id = ?', id, c.get('userId'))[0];
          return row ? c.json(row, 200) : null;
        },
        { name: 'create' }, // structurally equal to CREATE_SCOPE, a different object
      ),
      (c) => c.json({ error: 'the handler must not run on a replay' }, 500),
    );
    const viaLiteral = asUser(literal, '/v1/subscriptions', { APP_DB: db as never });
    const again = await viaLiteral('user-a', '/v1/subscriptions', {
      method: 'POST',
      body: BODY,
      headers: { 'Idempotency-Key': CLIENT_ID },
    });
    expect(again.status, 'an equal literal must hash as the create does').toBe(200);
    expect(((await again.json()) as { id: string }).id).toBe(made.id);
  });

  it('…and the derived row id agrees: it is keyed by the scope NAME too', async () => {
    expect(await idempotentRowId('user-a', CLIENT_ID, { name: 'create' })).toBe(
      await idempotentRowId('user-a', CLIENT_ID, CREATE_SCOPE),
    );
  });
});
