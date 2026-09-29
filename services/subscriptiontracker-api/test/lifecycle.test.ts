// ─────────────────────────────────────────────────────────────────────────────
// ST-E3 ON THE WORKER — Pause, Mark cancelled and soft delete (round-2 F04, F03,
// B33). The app shipped all three in #1045; until this change the route
// answered 400 to `status: paused|cancelled` and to any non-null `deleted_at`,
// and DELETE removed the row and orphaned its payment_history.
//
// Every test below FAILS on main 454dd415 (the red control): the status and
// deleted_at PATCHes return 400, and DELETE leaves no row to restore.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, beforeEach } from 'vitest';
import { recomputeRenewals } from '../../platform/src/renewals';
import renewals from '../src/routes/renewals';
import subscriptions, { SOFT_DELETE_PURGE_DAYS } from '../src/routes/subscriptions';
import { todayYmd } from '../src/lib/d1';
import { realAppDb, asUser, SqliteD1 } from './harness';

const U = 'user-a';
type Row = Record<string, unknown>;

let db: SqliteD1;
let subs: ReturnType<typeof asUser>;
let ren: ReturnType<typeof asUser>;

beforeEach(() => {
  db = realAppDb();
  subs = asUser(subscriptions, '/v1/subscriptions', { APP_DB: db as never });
  ren = asUser(renewals, '/v1/renewals', { APP_DB: db as never });
});

const inDays = (days: number) =>
  new Date(Date.parse(`${todayYmd()}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

async function create(body: Row = {}): Promise<string> {
  const res = await subs(U, '/v1/subscriptions', {
    method: 'POST',
    body: { name: 'Netflix', price: 649, cycle: 'monthly', next_renewal: inDays(2), ...body },
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as Row).id as string;
}
const patch = (id: string, body: Row) => subs(U, `/v1/subscriptions/${id}`, { method: 'PATCH', body });
const listIds = async () =>
  ((await (await subs(U, '/v1/subscriptions')).json()) as Row[]).map((r) => r.id);
const dueIds = async () =>
  ((await (await ren(U, '/v1/renewals?withinDays=30')).json()) as Row[]).map((r) => r.id);

describe('F04 — Pause and Mark cancelled are accepted, and stop the row being due', () => {
  it('PATCH {status: paused} is 200; the row stays listed and leaves /v1/renewals', async () => {
    const id = await create();
    expect(await dueIds()).toEqual([id]);
    const res = await patch(id, { status: 'paused' });
    expect(res.status, 'main answers 400 here: STATUSES_ACCEPTED was active|trialing').toBe(200);
    expect(((await res.json()) as Row).status).toBe('paused');
    expect(await listIds(), 'a paused row keeps its place on the list').toEqual([id]);
    expect(await dueIds(), 'a paused row is not due').toEqual([]);
  });

  it('PATCH {status: cancelled, cancelled_on} is 200 and keeps the date', async () => {
    const id = await create();
    const res = await patch(id, { status: 'cancelled', cancelled_on: '2026-09-28' });
    expect(res.status).toBe(200);
    const out = (await res.json()) as Row;
    expect([out.status, out.cancelled_on]).toEqual(['cancelled', '2026-09-28']);
    expect(await listIds()).toEqual([id]);
    expect(await dueIds()).toEqual([]);
  });

  it('a cancel with no date is dated today; resume clears it and the row is due again', async () => {
    const id = await create();
    const out = (await (await patch(id, { status: 'cancelled' })).json()) as Row;
    expect(out.cancelled_on).toBe(todayYmd());
    const back = (await (await patch(id, { status: 'active', cancelled_on: null })).json()) as Row;
    expect([back.status, back.cancelled_on]).toEqual(['active', null]);
    expect(await dueIds()).toEqual([id]);
  });

  it('the platform fan-out charges neither a paused nor a cancelled row', async () => {
    const paused = await create({ next_renewal: '2020-01-15' });
    const cancelled = await create({ next_renewal: '2020-01-15' });
    const active = await create({ next_renewal: '2020-01-15' });
    await patch(paused, { status: 'paused' });
    await patch(cancelled, { status: 'cancelled' });
    const outcome = await recomputeRenewals(db as never, 'subscriptiontracker');
    expect(outcome.ok, outcome.detail).toBe(true);
    const charged = db.rows('SELECT DISTINCT subscription_id FROM payment_history').map((r) => r.subscription_id);
    expect(charged).toEqual([active]);
  });
});

describe('F03 — soft delete: PATCH {deleted_at} hides the row, null brings it back', () => {
  it('is 200, and GET / plus /v1/renewals omit the row', async () => {
    const id = await create();
    const res = await patch(id, { deleted_at: '2026-09-29T10:00:00Z' });
    expect(res.status, "main answers 400: 'deleted_at cannot be set yet'").toBe(200);
    expect(((await res.json()) as Row).deleted_at).toBe('2026-09-29T10:00:00.000Z');
    expect(await listIds()).toEqual([]);
    expect(await dueIds()).toEqual([]);
    // …and the row is still THERE, which is what Undo needs.
    expect(db.rows('SELECT id FROM subscriptions').map((r) => r.id)).toEqual([id]);
  });

  it('Undo: PATCH {deleted_at: null} restores it to the list', async () => {
    const id = await create();
    await patch(id, { deleted_at: new Date().toISOString() });
    expect((await patch(id, { deleted_at: null })).status).toBe(200);
    expect(await listIds()).toEqual([id]);
  });

  it('a create may not arrive already deleted', async () => {
    const res = await subs(U, '/v1/subscriptions', {
      method: 'POST',
      body: { name: 'X', deleted_at: '2026-09-29T10:00:00Z' },
    });
    expect(res.status).toBe(400);
    expect(db.rows('SELECT id FROM subscriptions')).toHaveLength(0);
  });

  it('the platform fan-out does not charge a soft-deleted row', async () => {
    const id = await create({ next_renewal: '2020-01-15' });
    await patch(id, { deleted_at: new Date().toISOString() });
    await recomputeRenewals(db as never, 'subscriptiontracker');
    expect(db.rows('SELECT id FROM payment_history')).toHaveLength(0);
  });
});

describe('B33 — DELETE is soft, keeps the history, and the purge removes both together', () => {
  function seedHistory(id: string) {
    db.db.exec(
      `INSERT INTO payment_history (id, subscription_id, user_id, amount, paid_at)
       VALUES ('p-${id}', '${id}', '${U}', 649, '2026-09-01T00:00:00Z')`,
    );
  }

  it('DELETE hides the row and keeps it, with its payment_history, restorable', async () => {
    const id = await create();
    seedHistory(id);
    const res = await subs(U, `/v1/subscriptions/${id}`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect(await listIds()).toEqual([]);
    expect(db.rows('SELECT id FROM subscriptions'), 'main hard-deleted the row').toHaveLength(1);
    expect(db.rows('SELECT id FROM payment_history')).toHaveLength(1);
    // Undo works for a DELETE too.
    await patch(id, { deleted_at: null });
    expect(await listIds()).toEqual([id]);
    const one = (await (await subs(U, `/v1/subscriptions/${id}`)).json()) as Row;
    expect((one.payment_history as Row[]).map((p) => p.id)).toEqual([`p-${id}`]);
  });

  it('a second DELETE keeps the first instant', async () => {
    const id = await create();
    await subs(U, `/v1/subscriptions/${id}`, { method: 'DELETE' });
    const first = db.rows('SELECT deleted_at FROM subscriptions')[0]?.deleted_at;
    await subs(U, `/v1/subscriptions/${id}`, { method: 'DELETE' });
    expect(db.rows('SELECT deleted_at FROM subscriptions')[0]?.deleted_at).toBe(first);
  });

  it(`past ${SOFT_DELETE_PURGE_DAYS} days the next list removes the row AND its history — no orphan`, async () => {
    const old = await create();
    const recent = await create();
    const other = await create();
    for (const id of [old, recent, other]) seedHistory(id);
    const longAgo = new Date(Date.now() - (SOFT_DELETE_PURGE_DAYS + 1) * 86_400_000).toISOString();
    await patch(old, { deleted_at: longAgo });
    await patch(recent, { deleted_at: new Date().toISOString() });
    // Another user's expired row is not this user's list's to purge.
    db.db.exec(
      `INSERT INTO subscriptions (id, user_id, name, deleted_at) VALUES ('theirs', 'user-b', 'Y', '${longAgo}')`,
    );

    expect(await listIds()).toEqual([other]);
    expect(db.rows('SELECT id FROM subscriptions ORDER BY id').map((r) => r.id).sort()).toEqual(
      [other, recent, 'theirs'].sort(),
    );
    expect(
      db.rows('SELECT subscription_id FROM payment_history').map((r) => r.subscription_id).sort(),
      'the purged row took its history; the restorable one kept it',
    ).toEqual([other, recent].sort());
  });
});
