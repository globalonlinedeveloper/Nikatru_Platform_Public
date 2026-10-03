// ─────────────────────────────────────────────────────────────────────────────
// PUT /v1/budget SURVIVES ONE TRANSIENT D1 RESET ON ITS REPLACE BATCH — and
// still refuses a deterministic one.
//
// ⏱ 2026-10-01 · rv2 SYN-S2 (services-027).
// The replace is one `APP_DB.batch()` (one DELETE, one INSERT per category, the
// budget upsert), and it was sent bare: the reset services/_shared/src/d1.ts
// names — "D1 DB storage operation exceeded timeout which caused object to be
// reset" — was a 500 on the save a user makes from the budget screen. It now goes
// through `batchIdempotent`.
//
// 🔴 RED WITHOUT THE FIX: with the route's `batchIdempotent(` put back to
// `c.env.APP_DB.batch(`, the first case answers 500 and the rows are the seed's.
// `injected` is asserted so an injector that stopped matching cannot pass.
//
// ⏱ 2026-10-03 (review of #1152, nit 5): the injector above threw only BEFORE
// the batch ran, so `batchIdempotent`'s claim — a batch run twice leaves the rows
// one run leaves, which is what makes a reset AFTER commit safe to retry — was
// untested. The second case commits, throws, and retries. 🔴 RED with the PUT
// batch made non-idempotent by moving its `DELETE … WHERE user_id` out of the
// batch (a `.run()` before it): one run still replaces the set, and the FIRST
// case stays green, but the replay re-inserts every category and answers 500.
// (Dropping the DELETE outright reds this case too, and the first one with it.)
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from 'vitest';
import budget from '../src/routes/budget';
import { realAppDb, asUser } from './harness';

const TRANSIENT = 'D1_ERROR: D1 DB storage operation exceeded timeout which caused object to be reset.';
const DETERMINISTIC = 'D1_ERROR: no such column: definitely_not_a_column';
const A = 'user-a';

/** The real engine, with the next `times` batches failing with `message` BEFORE
 *  they run — a reset rolls the whole batch back, so nothing of it commits — and
 *  the next `afterCommit` batches failing AFTER they ran: the reset that lands
 *  once the batch has committed, which only an idempotent batch survives. */
function flakyBatches(db: ReturnType<typeof realAppDb>) {
  const state = { times: 0, afterCommit: 0, message: TRANSIENT, injected: 0, batches: 0 };
  const wrapped = {
    prepare: (sql: string) => db.prepare(sql),
    async batch(statements: unknown[]) {
      state.batches++;
      if (state.times > 0) {
        state.times--;
        state.injected++;
        throw new Error(state.message);
      }
      const out = await db.batch(statements as never);
      if (state.afterCommit > 0) {
        state.afterCommit--;
        state.injected++;
        throw new Error(state.message);
      }
      return out;
    },
  };
  return { state, wrapped };
}

function setup() {
  const db = realAppDb();
  const { state, wrapped } = flakyBatches(db);
  const call = asUser(budget, '/v1/budget', { APP_DB: wrapped as never });
  return { db, state, call };
}

const caps = (db: ReturnType<typeof realAppDb>) =>
  db
    .rows('SELECT name, cap FROM budget_categories WHERE user_id = ? ORDER BY name', A)
    .map((r) => `${r.name}:${r.cap}`);

const SEED = { monthly_budget: 500, categories: [{ name: 'Music', cap: 20 }] };
const NEXT = { monthly_budget: 650, categories: [{ name: 'Music', cap: 25 }, { name: 'Video', cap: 35 }] };

describe('PUT /v1/budget retries a transient reset of its replace batch', () => {
  it('🔴 one reset on the batch does NOT fail the save, and the new set is stored once', async () => {
    const { db, state, call } = setup();
    expect((await call(A, '/v1/budget', { method: 'PUT', body: SEED })).status).toBe(200);

    state.times = 1;
    const res = await call(A, '/v1/budget', { method: 'PUT', body: NEXT });

    expect(state.injected).toBe(1);
    expect(res.status).toBe(200);
    expect(caps(db)).toEqual(['Music:25', 'Video:35']);
    expect(db.rows('SELECT monthly_budget FROM budgets WHERE user_id = ?', A).map((r) => r.monthly_budget)).toEqual([650]);
  });

  it('🔴 a reset AFTER the batch committed is replayed to the same rows a single run leaves (batchIdempotent\'s claim)', async () => {
    // The single run: a fresh database, the same two saves, no fault.
    const once = setup();
    expect((await once.call(A, '/v1/budget', { method: 'PUT', body: SEED })).status).toBe(200);
    expect((await once.call(A, '/v1/budget', { method: 'PUT', body: NEXT })).status).toBe(200);

    const { db, state, call } = setup();
    expect((await call(A, '/v1/budget', { method: 'PUT', body: SEED })).status).toBe(200);
    const before = state.batches;
    state.afterCommit = 1;
    const res = await call(A, '/v1/budget', { method: 'PUT', body: NEXT });

    expect(state.injected).toBe(1);
    expect(state.batches - before).toBe(2); // ran, committed, threw, ran again
    expect(res.status).toBe(200);
    const rows = (d: ReturnType<typeof realAppDb>) =>
      d.rows('SELECT name, cap FROM budget_categories WHERE user_id = ? ORDER BY name, cap', A).map((r) => `${r.name}:${r.cap}`);
    expect(rows(db)).toEqual(rows(once.db));
    expect(rows(db)).toEqual(['Music:25', 'Video:35']);
    expect(db.rows('SELECT monthly_budget FROM budgets WHERE user_id = ?', A).map((r) => r.monthly_budget)).toEqual([650]);
  });

  it('a DETERMINISTIC failure is not retried: one batch, a 500, and the stored set untouched', async () => {
    const { db, state, call } = setup();
    expect((await call(A, '/v1/budget', { method: 'PUT', body: SEED })).status).toBe(200);
    const before = state.batches;

    state.times = 5;
    state.message = DETERMINISTIC;
    const res = await call(A, '/v1/budget', { method: 'PUT', body: NEXT });

    expect(res.status).toBe(500);
    expect(state.batches - before).toBe(1);
    expect(caps(db)).toEqual(['Music:20']);
  });
});
