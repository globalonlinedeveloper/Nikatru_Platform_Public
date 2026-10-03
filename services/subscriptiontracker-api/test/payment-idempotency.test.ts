// ─────────────────────────────────────────────────────────────────────────────
// POST /v1/subscriptions/:id/payments with an Idempotency-Key — deferred item
// D-PAYMENTS-IDEMPOTENCY (#1089 review): the manual-payment route takes the
// shared primitive of #1075 (lib/idempotency.ts, PAYMENT_SCOPE). Against a REAL
// SQL engine (node:sqlite + the real migrations): the ledger's primary key is
// the lock, and a mock has none.
//
// Red control: on 96e0eb13 the route ignored the key and minted a fresh uuid
// per request, so a double submit, a replay, N concurrent submits and a retry
// over a stale claim each recorded the payment again (2+ rows, a doubled
// spend), and a mismatched body under the same key was a second 201, not 422.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, beforeEach } from 'vitest';
import subscriptions from '../src/routes/subscriptions';
import { CREATE_SCOPE, PAYMENT_SCOPE, idempotentRowId } from '../src/lib/idempotency';
import { realAppDb, asUser, SqliteD1 } from './harness';

const U = 'user-a';
// Low-entropy on purpose: gitleaks reads a random UUID in a constant named KEY
// as a leaked secret (generic-api-key).
const CLIENT_ID = 'offline-pay-0001';
const PAID = { amount: 649, paid_on: '2026-09-20' };
type Row = Record<string, unknown>;

let db: SqliteD1;
let subs: ReturnType<typeof asUser>;

beforeEach(() => {
  db = realAppDb();
  subs = asUser(subscriptions, '/v1/subscriptions', { APP_DB: db as never });
});

async function create(user = U, body: Row = {}): Promise<string> {
  const res = await subs(user, '/v1/subscriptions', {
    method: 'POST',
    body: { name: 'JioHotstar', price: 649, price_minor: 64900, currency: 'INR', cycle: 'monthly', ...body },
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as Row).id as string;
}
const pay = (id: string, key?: string, body: unknown = PAID, user = U) =>
  subs(user, `/v1/subscriptions/${id}/payments`, {
    method: 'POST',
    body,
    headers: key === undefined ? {} : { 'Idempotency-Key': key },
  });
const payments = (user = U) =>
  db.rows(`SELECT id, amount, currency, paid_at FROM payment_history WHERE user_id = '${user}'`) as Row[];

/** SHA-256 of [text], through the WebCrypto the Worker itself uses. */
const sha256 = async (text: string) =>
  new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

/** Move the claim's clock: pending, and [minutes] old. */
const ageClaim = (minutes: number) =>
  db
    .prepare("UPDATE idempotency_keys SET state = 'pending', created_at = ? WHERE key = ?")
    .bind(new Date(Date.now() - minutes * 60_000).toISOString(), CLIENT_ID)
    .run();

describe('POST /v1/subscriptions/:id/payments — Idempotency-Key', () => {
  it('a double submit records ONE payment, and the repeat is answered with it', async () => {
    const id = await create();
    const first = await pay(id, CLIENT_ID);
    expect(first.status).toBe(201);
    const made = (await first.json()) as Row;

    const again = await pay(id, CLIENT_ID);
    expect(again.status, 'the base recorded the payment a second time (201)').toBe(200);
    expect(((await again.json()) as Row).id).toBe(made.id);
    expect(payments()).toHaveLength(1);
  });

  it('a replay after success answers the stored payment field for field', async () => {
    const id = await create();
    const first = await pay(id, CLIENT_ID);
    const again = await pay(id, CLIENT_ID);
    expect(await again.json()).toEqual(await first.json());
  });

  it('the money on a replay is the money recorded — never recomputed from the subscription as it is now', async () => {
    const id = await create(); // INR
    const made = (await (await pay(id, CLIENT_ID)).json()) as Row;
    expect(made).toMatchObject({ amount: 649, currency: 'INR', paid_at: '2026-09-20T00:00:00Z' });

    // The subscription moves to another currency and price after the payment.
    const moved = await subs(U, `/v1/subscriptions/${id}`, {
      method: 'PATCH',
      body: { currency: 'USD', price: 7.99, price_minor: 799 },
    });
    expect(moved.status).toBe(200);

    const replay = (await (await pay(id, CLIENT_ID)).json()) as Row;
    expect(replay).toEqual(made);
    expect(payments()).toEqual([{ id: made.id, amount: 649, currency: 'INR', paid_at: '2026-09-20T00:00:00Z' }]);
    // ...and the history the user reads counts it once, in its own currency.
    const history = ((await (await subs(U, `/v1/subscriptions/${id}`)).json()) as Row).payment_history as Row[];
    expect(history.map((p) => [p.id, p.amount, p.currency])).toEqual([[made.id, 649, 'INR']]);
  });

  // A truly concurrent burst, made deterministic: every attempt's first claim
  // LOOKUP is held until all of them have made it, so all of them miss and all
  // race to the INSERT … ON CONFLICT DO NOTHING. On the base no attempt reads
  // the ledger, so the gate opens on its timeout and nothing waits forever.
  it('concurrent submits of one key record ONE payment; the rest are 409 in progress or the replay', async () => {
    const id = await create();
    const N = 5;
    let arrived = 0;
    let open!: () => void;
    const gate = new Promise<void>((resolve) => {
      open = resolve;
      setTimeout(resolve, 250);
    });
    const racing = new Proxy(db, {
      get(target, prop, receiver) {
        if (prop !== 'prepare') return Reflect.get(target, prop, receiver);
        return (sql: string) => {
          const stmt = target.prepare(sql);
          if (arrived >= N || !sql.startsWith('SELECT body_hash, row_id, state, created_at FROM idempotency_keys')) {
            return stmt;
          }
          if (++arrived === N) open();
          return {
            bind: (...args: unknown[]) => {
              const bound = stmt.bind(...args);
              return { first: async () => (await gate, bound.first()) };
            },
          };
        };
      },
    });
    const burst = asUser(subscriptions, '/v1/subscriptions', { APP_DB: racing as never });
    const results = await Promise.all(
      Array.from({ length: N }, () =>
        burst(U, `/v1/subscriptions/${id}/payments`, {
          method: 'POST',
          body: PAID,
          headers: { 'Idempotency-Key': CLIENT_ID },
        }),
      ),
    );
    const statuses = results.map((r) => r.status).sort();
    expect(statuses.filter((s) => s === 201), `statuses ${statuses.join(',')}`).toHaveLength(1);
    expect(payments(), `statuses ${statuses.join(',')}`).toHaveLength(1);
    expect(arrived, 'every attempt looked up the claim before any claimed it').toBe(N);
    for (const r of results) {
      if (r.status === 201 || r.status === 200) continue;
      expect(r.status).toBe(409); // the harness's onError would answer 500
      expect(((await r.json()) as Row).error).toBe('idempotency_in_progress');
      expect(r.headers.get('Retry-After')).toBe('2');
    }
  });

  it('a key still being processed is 409 idempotency_in_progress with a Retry-After, not a second payment', async () => {
    const id = await create();
    expect((await pay(id, CLIENT_ID)).status).toBe(201);
    // Rewind the claim to the moment the first attempt was still running.
    await db.prepare("UPDATE idempotency_keys SET state = 'pending' WHERE key = ?").bind(CLIENT_ID).run();
    const res = await pay(id, CLIENT_ID);
    expect(res.status).toBe(409);
    expect(((await res.json()) as Row).error).toBe('idempotency_in_progress');
    expect(res.headers.get('Retry-After')).toBe('2');
    expect(payments()).toHaveLength(1);
  });

  it('a pending claim younger than 10 minutes is still 409', async () => {
    const id = await create();
    expect((await pay(id, CLIENT_ID)).status).toBe(201);
    await ageClaim(9);
    expect((await pay(id, CLIENT_ID)).status).toBe(409);
    expect(payments()).toHaveLength(1);
  });

  it('a stale claim (over 10 minutes) whose payment exists is marked done and answered 200', async () => {
    const id = await create();
    const made = (await (await pay(id, CLIENT_ID)).json()) as Row;
    await ageClaim(11);
    const res = await pay(id, CLIENT_ID);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(made);
    const claim = db.rows(`SELECT state FROM idempotency_keys WHERE key = '${CLIENT_ID}'`)[0] as Row;
    expect(claim.state).toBe('done');
    expect(payments()).toHaveLength(1);
  });

  it('a stale claim with no payment is taken over and the payment is recorded once', async () => {
    const id = await create();
    expect((await pay(id, CLIENT_ID)).status).toBe(201);
    // The request died after claiming and before inserting: no payment.
    db.prepare("DELETE FROM payment_history WHERE user_id = 'user-a'").run();
    await ageClaim(11);
    expect((await pay(id, CLIENT_ID)).status).toBe(201);
    expect((await pay(id, CLIENT_ID)).status).toBe(200);
    expect(payments()).toHaveLength(1);
  });

  it('the same key with a mismatched body is 422, and nothing more is recorded', async () => {
    const id = await create();
    expect((await pay(id, CLIENT_ID)).status).toBe(201);
    for (const body of [
      { ...PAID, amount: 6490 },
      { ...PAID, paid_on: '2026-09-21' },
      { ...PAID, currency: 'USD' },
    ]) {
      const res = await pay(id, CLIENT_ID, body);
      expect(res.status, JSON.stringify(body)).toBe(422);
      expect(((await res.json()) as Row).error).toBe('idempotency_key_reused');
    }
    expect(payments()).toEqual([expect.objectContaining({ amount: 649, currency: 'INR' })]);
  });

  it('the same key and body for ANOTHER subscription is 422 — never the first payment replayed as this one', async () => {
    const a = await create();
    const b = await create(U, { name: 'Netflix' });
    expect((await pay(a, CLIENT_ID)).status).toBe(201);
    const res = await pay(b, CLIENT_ID);
    expect(res.status).toBe(422);
    expect(((await res.json()) as Row).error).toBe('idempotency_key_reused');
    expect(payments()).toHaveLength(1);
  });

  it('a key already used by a subscription create is 422 on a payment, and the other way round', async () => {
    const id = await create();
    const created = await subs(U, '/v1/subscriptions', {
      method: 'POST',
      body: { name: 'Gym', price: 20, cycle: 'monthly' },
      headers: { 'Idempotency-Key': CLIENT_ID },
    });
    expect(created.status).toBe(201);
    expect((await pay(id, CLIENT_ID)).status).toBe(422);

    expect((await pay(id, 'offline-pay-0002')).status).toBe(201);
    const reused = await subs(U, '/v1/subscriptions', {
      method: 'POST',
      body: { name: 'Gym', price: 20, cycle: 'monthly' },
      headers: { 'Idempotency-Key': 'offline-pay-0002' },
    });
    expect(reused.status).toBe(422);
    expect(payments()).toHaveLength(1);
  });

  it('a replay after the subscription was removed (soft delete) is 410; Undo brings the 200 back', async () => {
    const id = await create();
    const made = (await (await pay(id, CLIENT_ID)).json()) as Row;
    expect((await subs(U, `/v1/subscriptions/${id}`, { method: 'DELETE' })).status).toBe(200);
    const gone = await pay(id, CLIENT_ID);
    expect(gone.status).toBe(410);
    expect(((await gone.json()) as Row).error).toBe('idempotent_create_gone');

    const undo = await subs(U, `/v1/subscriptions/${id}`, { method: 'PATCH', body: { deleted_at: null } });
    expect(undo.status).toBe(200);
    const back = await pay(id, CLIENT_ID);
    expect(back.status).toBe(200);
    expect(await back.json()).toEqual(made);
    expect(payments()).toHaveLength(1);
  });

  it('after a purge the key still answers 410 and never records the payment again (the tombstone)', async () => {
    const id = await create();
    expect((await pay(id, CLIENT_ID)).status).toBe(201);
    await subs(U, `/v1/subscriptions/${id}`, { method: 'DELETE' });
    db.prepare('DELETE FROM payment_history WHERE subscription_id = ?').bind(id).run();
    db.prepare('DELETE FROM subscriptions WHERE id = ?').bind(id).run();
    expect((await pay(id, CLIENT_ID)).status).toBe(410);
    expect(payments()).toHaveLength(0);
  });

  // ⏱ 2026-10-01 · review of #1121, nit 2 (kills mutation R3c). The purge case
  // above deletes the payment AND its subscription, so it answers 410 from the
  // missing PAYMENT and never reaches the `parent_id == null` limb. Here ONLY
  // the subscriptions row goes (an erasure or a purge racing the history
  // delete): the payment row is still there, and the replay must still be 410 —
  // never a 200 reporting a payment under a subscription that no longer exists.
  it('🔴 only the subscriptions row deleted (the payment stays): the replay is 410', async () => {
    const id = await create();
    expect((await pay(id, CLIENT_ID)).status).toBe(201);
    db.prepare('DELETE FROM subscriptions WHERE id = ?').bind(id).run();
    expect(payments()).toHaveLength(1);
    const gone = await pay(id, CLIENT_ID);
    expect(gone.status).toBe(410);
    expect(((await gone.json()) as Row).error).toBe('idempotent_create_gone');
    expect(payments()).toHaveLength(1);
  });

  it('a refused payment releases its claim, so the corrected retry can record it', async () => {
    const id = await create();
    expect((await pay(id, CLIENT_ID, { amount: -1, paid_on: '2026-09-20' })).status).toBe(400);
    expect((await pay(id, CLIENT_ID)).status).toBe(201);
    // A payment against a row that is not there is a 404 and claims nothing either.
    expect((await pay('no-such-row', 'offline-pay-0003')).status).toBe(404);
    expect(db.rows("SELECT key FROM idempotency_keys WHERE key = 'offline-pay-0003'")).toHaveLength(0);
    expect(payments()).toHaveLength(1);
  });

  it('the key is private to its account: another user with the same key records their own', async () => {
    const a = await create('user-a');
    const b = await create('user-b');
    expect((await pay(a, CLIENT_ID, PAID, 'user-a')).status).toBe(201);
    expect((await pay(b, CLIENT_ID, PAID, 'user-b')).status).toBe(201);
    expect(payments('user-a')).toHaveLength(1);
    expect(payments('user-b')).toHaveLength(1);
  });

  it('the key as the idempotency_key query parameter is the same key', async () => {
    const id = await create();
    const viaQuery = () =>
      subs(U, `/v1/subscriptions/${id}/payments?idempotency_key=${CLIENT_ID}`, { method: 'POST', body: PAID });
    const first = await viaQuery();
    expect(first.status).toBe(201);
    expect((await viaQuery()).status).toBe(200);
    expect((await pay(id, CLIENT_ID)).status).toBe(200);
    expect(payments()).toHaveLength(1);
    expect(((await first.json()) as Row).id).toBe(await idempotentRowId(U, CLIENT_ID, PAYMENT_SCOPE));
  });

  it('no key behaves as before: two posts, two payments', async () => {
    const id = await create();
    expect((await pay(id)).status).toBe(201);
    expect((await pay(id)).status).toBe(201);
    expect(payments()).toHaveLength(2);
  });

  it('a malformed key is a 400 and records nothing', async () => {
    const id = await create();
    for (const bad of ['short', 'has space in it', 'x'.repeat(129)]) {
      const res = await pay(id, bad);
      expect(res.status).toBe(400);
      expect(((await res.json()) as Row).error).toBe('invalid_idempotency_key');
    }
    expect(payments()).toHaveLength(0);
  });
});

// The scope must not move a single claim the create has already written: its
// id derivation and its body hash are what production's ledger holds.
describe('the create scope is unchanged by the payment scope', () => {
  it('derives the same id as before, and a payment id of its own', async () => {
    const created = await idempotentRowId(U, CLIENT_ID);
    expect(await idempotentRowId(U, CLIENT_ID, CREATE_SCOPE)).toBe(created);
    const digest = await sha256(`subscriptiontracker/create\n${U}\n${CLIENT_ID}`);
    expect(created.replaceAll('-', '').slice(0, 12)).toBe(hex(digest.subarray(0, 6)));
    expect(await idempotentRowId(U, CLIENT_ID, PAYMENT_SCOPE)).not.toBe(created);
  });

  it('a create claim is still hashed from its body alone, as every claim in the ledger was', async () => {
    const body = { cycle: 'monthly', name: 'Gym', price: 20 }; // keys sorted: canonical JSON
    const first = await subs(U, '/v1/subscriptions', {
      method: 'POST',
      body,
      headers: { 'Idempotency-Key': CLIENT_ID },
    });
    expect(first.status).toBe(201);
    const claim = db.rows(`SELECT body_hash FROM idempotency_keys WHERE key = '${CLIENT_ID}'`)[0] as Row;
    expect(claim.body_hash).toBe(hex(await sha256(JSON.stringify(body))));
  });
});
