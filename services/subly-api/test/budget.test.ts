// ─────────────────────────────────────────────────────────────────────────────
// PUT /v1/budget — validate before mutating, and replace ATOMICALLY.
//
// The defect these exist for: the route ran an unconditional
// `DELETE FROM budget_categories WHERE user_id = ?` and only THEN looked at the
// body, in a second D1 round-trip that nothing could roll back. One malformed
// PUT — or a perfectly well-typed one with a duplicate category name, which
// violates `PRIMARY KEY (user_id, name)` — permanently wiped the user's whole
// category set and returned a generic 500 that said nothing about the loss.
//
// Every case below therefore asserts BOTH halves: the 400, and that the
// pre-existing rows are still there. A test that only checked the status code
// would pass against the broken version.
//
// These run against a REAL SQL engine with the REAL migrations applied. A mock
// cannot fail a primary key, cannot reject an `undefined` bind, and cannot roll
// a batch back — so a mock would report this route healthy either way.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from 'vitest';
import budget from '../src/routes/budget';
import { realAppDb, asUser } from './harness';

const A = 'user-a';

function setup() {
  const db = realAppDb();
  const call = asUser(budget, '/v1/budget', { APP_DB: db as never });
  return { db, call };
}

const SEED = {
  monthly_budget: 500,
  categories: [
    { name: 'Music', cap: 20 },
    { name: 'Video', cap: 35 },
  ],
};

async function seed(call: ReturnType<typeof asUser>) {
  const res = await call(A, '/v1/budget', { method: 'PUT', body: SEED });
  expect(res.status).toBe(200);
}

const caps = (db: ReturnType<typeof realAppDb>) =>
  db
    .rows('SELECT name, cap FROM budget_categories WHERE user_id = ? ORDER BY name', A)
    .map((r) => `${r.name}:${r.cap}`);

describe('PUT /v1/budget — happy path', () => {
  it('stores the budget and the caps, and GET reads them back', async () => {
    const { db, call } = setup();
    await seed(call);

    const res = await call(A, '/v1/budget');
    expect(await res.json()).toEqual({
      monthly_budget: 500,
      categories: [
        { name: 'Music', cap: 20 },
        { name: 'Video', cap: 35 },
      ],
    });
    expect(caps(db)).toEqual(['Music:20', 'Video:35']);
  });

  it('REPLACES the set — a category dropped from the body is gone', async () => {
    const { db, call } = setup();
    await seed(call);
    await call(A, '/v1/budget', {
      method: 'PUT',
      body: { monthly_budget: 600, categories: [{ name: 'Music', cap: 25 }] },
    });
    expect(caps(db)).toEqual(['Music:25']);
  });

  it('an empty category list clears the set', async () => {
    const { db, call } = setup();
    await seed(call);
    await call(A, '/v1/budget', { method: 'PUT', body: { monthly_budget: 0, categories: [] } });
    expect(caps(db)).toEqual([]);
  });

  it('every new row carries the surrogate `id` 0002_schema_debt.sql added', async () => {
    // That migration's stated contract is that NEW rows are written with a
    // client-generated id; writing NULL re-opens the unaddressable-row gap it
    // was written to pay down.
    const { db, call } = setup();
    await seed(call);
    const ids = db.rows('SELECT id FROM budget_categories').map((r) => r.id);
    expect(ids).toHaveLength(2);
    for (const id of ids) expect(typeof id, 'id must not be NULL').toBe('string');
    expect(new Set(ids).size, 'ids must be distinct').toBe(2);
  });

  it('GET returns defaults when nothing is stored', async () => {
    const { call } = setup();
    const res = await call(A, '/v1/budget');
    expect(await res.json()).toEqual({ monthly_budget: 0, categories: [] });
  });
});

describe('PUT /v1/budget — a rejected body must not destroy the stored set', () => {
  const bad: Array<[string, unknown]> = [
    ['categories is a string', { categories: 'abc' }],
    ['categories is a number', { categories: 7 }],
    ['categories is an object', { categories: { Music: 20 } }],
    ['an element is not an object', { categories: ['Music'] }],
    ['an element is null', { categories: [null] }],
    ['an element is an array', { categories: [[]] }],
    ['cap is missing', { categories: [{ name: 'Music' }] }],
    ['cap is a string', { categories: [{ name: 'Music', cap: '20' }] }],
    ['cap is null', { categories: [{ name: 'Music', cap: null }] }],
    ['cap is negative', { categories: [{ name: 'Music', cap: -1 }] }],
    ['name is missing', { categories: [{ cap: 20 }] }],
    ['name is blank', { categories: [{ name: '   ', cap: 20 }] }],
    ['name is not a string', { categories: [{ name: 7, cap: 20 }] }],
    ['monthly_budget is a string', { monthly_budget: '500', categories: [] }],
    ['monthly_budget is negative', { monthly_budget: -5, categories: [] }],
    ['the body is an array', []],
    ['the body is a string', '"hello"'],
  ];

  for (const [label, body] of bad) {
    it(`400s when ${label}, leaving the existing caps intact`, async () => {
      const { db, call } = setup();
      await seed(call);
      const res = await call(A, '/v1/budget', { method: 'PUT', body });
      expect(res.status, label).toBe(400);
      expect((await res.json()) as { error: string }).toMatchObject({ error: 'invalid_body' });
      expect(caps(db), 'the DELETE must not have run').toEqual(['Music:20', 'Video:35']);
    });
  }

  it('400s a DUPLICATE category name — reachable from a well-typed first-party body', async () => {
    // This is the variant with no malformed input at all: it passes every type
    // check and then violates PRIMARY KEY (user_id, name) inside the batch.
    const { db, call } = setup();
    await seed(call);
    const res = await call(A, '/v1/budget', {
      method: 'PUT',
      body: { monthly_budget: 500, categories: [{ name: 'A', cap: 1 }, { name: 'A', cap: 2 }] },
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { detail: string }).detail).toMatch(/duplicates "A"/);
    expect(caps(db)).toEqual(['Music:20', 'Video:35']);
  });

  it('400s an over-long list without touching the stored set', async () => {
    const { db, call } = setup();
    await seed(call);
    const many = Array.from({ length: 201 }, (_, i) => ({ name: `c${i}`, cap: 1 }));
    const res = await call(A, '/v1/budget', {
      method: 'PUT',
      body: { monthly_budget: 1, categories: many },
    });
    expect(res.status).toBe(400);
    expect(caps(db)).toEqual(['Music:20', 'Video:35']);
  });

  it('400s malformed JSON without touching the stored set', async () => {
    const { db, call } = setup();
    await seed(call);
    const res = await call(A, '/v1/budget', { method: 'PUT', body: '{not json' });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_json' });
    expect(caps(db)).toEqual(['Music:20', 'Video:35']);
  });

  it('an INSERT that fails mid-batch rolls the DELETE back — the replace is ATOMIC', async () => {
    // ⚠️ THIS IS THE ATOMICITY TEST, and it deliberately does NOT go through
    // validation. Every other case here is prevented before a write, so they all
    // still pass if the DELETE is moved back OUTSIDE the batch — mutation-proven
    // 2026-08-01. The only way to observe the transaction is to make an INSERT
    // fail for a reason the route cannot pre-empt, so a trigger raises on one
    // row. If the DELETE is not in the same batch, it commits and the caps are
    // gone; inside the batch, D1's implicit transaction takes it back.
    const db = realAppDb([
      `CREATE TRIGGER reject_boom BEFORE INSERT ON budget_categories
         WHEN NEW.name = 'BOOM'
         BEGIN SELECT RAISE(ABORT, 'boom'); END;`,
    ]);
    const call = asUser(budget, '/v1/budget', { APP_DB: db as never });
    await seed(call);

    const res = await call(A, '/v1/budget', {
      method: 'PUT',
      body: {
        monthly_budget: 500,
        categories: [
          { name: 'Music', cap: 1 },
          { name: 'BOOM', cap: 2 },
        ],
      },
    });
    expect(res.status).toBe(500);
    expect(caps(db), 'the DELETE must roll back with the failed INSERTs').toEqual([
      'Music:20',
      'Video:35',
    ]);
  });

  it('the monthly budget is not written either when the body is rejected', async () => {
    const { db, call } = setup();
    await seed(call);
    await call(A, '/v1/budget', {
      method: 'PUT',
      body: { monthly_budget: 999, categories: 'abc' },
    });
    expect(db.rows('SELECT monthly_budget FROM budgets WHERE user_id = ?', A)[0].monthly_budget).toBe(
      500,
    );
  });
});
