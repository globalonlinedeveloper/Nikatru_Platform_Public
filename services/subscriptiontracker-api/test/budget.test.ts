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
import budget, { BUDGET_BODY_MAX_BYTES } from '../src/routes/budget';
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

/** name -> stored surrogate id, straight out of the database. */
const idsByName = (db: ReturnType<typeof realAppDb>): Record<string, string> =>
  Object.fromEntries(
    db
      .rows('SELECT name, id FROM budget_categories WHERE user_id = ?', A)
      .map((r) => [String(r.name), String(r.id)]),
  );

type CategoryBody = { id: string; name: string; cap: number };
const getBody = async (
  call: ReturnType<typeof asUser>,
): Promise<{ monthly_budget: number; categories: CategoryBody[] }> =>
  (await (await call(A, '/v1/budget')).json()) as {
    monthly_budget: number;
    categories: CategoryBody[];
  };

describe('PUT /v1/budget — happy path', () => {
  it('stores the budget and the caps, and GET reads them back', async () => {
    const { db, call } = setup();
    await seed(call);

    const body = await getBody(call);
    expect(body.monthly_budget).toBe(500);
    expect(body.categories.map((c) => ({ name: c.name, cap: c.cap }))).toEqual([
      { name: 'Music', cap: 20 },
      { name: 'Video', cap: 35 },
    ]);
    // 🔴 THE id IS ON THE WIRE. It was not until 2026-08-25: GET selected
    // `name, cap`, so the column 0002_schema_debt.sql added, backfilled and put a
    // UNIQUE index on never left the database and no caller could address a row
    // by it. Deleting `id` from that SELECT turns this assertion red.
    const stored = idsByName(db);
    expect(body.categories.map((c) => c.id)).toEqual([stored.Music, stored.Video]);
    for (const c of body.categories) expect(typeof c.id, 'id must be on the wire').toBe('string');
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
    expect(await res.json()).toEqual({ monthly_budget: 0, currency: null, categories: [] });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE SURROGATE id IS AN ADDRESS, WHICH MEANS IT HAS TO SURVIVE A SAVE.
//
// 0002_schema_debt.sql states its own purpose: without a single-column id "the
// row is unaddressable as (entity, row_id), and renaming a category would read
// as delete+create rather than an edit". PUT is a REPLACE — DELETE-all then
// re-insert — so before 2026-08-25 it minted a fresh uuid() for every category
// on every save. The column was written on every write, indexed UNIQUE, and read
// by nothing: a rename read as delete+create, and so did a save that changed
// NOTHING AT ALL. Each test below fails against that version.
// ─────────────────────────────────────────────────────────────────────────────
describe('PUT /v1/budget — the category id is an address, not a fresh uuid', () => {
  it('a save that changes nothing leaves every id EXACTLY where it was', async () => {
    const { db, call } = setup();
    await seed(call);
    const before = idsByName(db);

    await call(A, '/v1/budget', { method: 'PUT', body: SEED });

    expect(idsByName(db)).toEqual(before);
  });

  it('a RENAME that round-trips the id is an EDIT — same row, new name', async () => {
    const { db, call } = setup();
    await seed(call);
    const musicId = idsByName(db).Music;

    const body = await getBody(call);
    const renamed = body.categories.map((c) =>
      c.name === 'Music' ? { id: c.id, name: 'Audio', cap: c.cap } : c,
    );
    const res = await call(A, '/v1/budget', {
      method: 'PUT',
      body: { monthly_budget: 500, categories: renamed },
    });
    expect(res.status).toBe(200);

    const after = idsByName(db);
    expect(after.Music).toBeUndefined();
    expect(after.Audio, 'the renamed row must keep its address').toBe(musicId);
  });

  it('a category that is genuinely new gets an id of its own', async () => {
    const { db, call } = setup();
    await seed(call);
    const before = idsByName(db);
    await call(A, '/v1/budget', {
      method: 'PUT',
      body: { monthly_budget: 500, categories: [...SEED.categories, { name: 'Books', cap: 10 }] },
    });
    const after = idsByName(db);
    expect(after.Music).toBe(before.Music);
    expect(after.Video).toBe(before.Video);
    expect(typeof after.Books).toBe('string');
    expect(new Set(Object.values(after)).size).toBe(3);
  });

  it('the id the caller sends is the id that is stored', async () => {
    const { db, call } = setup();
    const chosen = '018f4c2e-0000-7000-8000-0000000000aa';
    const res = await call(A, '/v1/budget', {
      method: 'PUT',
      body: { monthly_budget: 100, categories: [{ id: chosen, name: 'Music', cap: 20 }] },
    });
    expect(res.status).toBe(200);
    expect(idsByName(db).Music).toBe(chosen);
    expect((await getBody(call)).categories[0].id).toBe(chosen);
  });

  it('400s a DUPLICATE id — the UNIQUE index would answer 500 and name nothing', async () => {
    const { db, call } = setup();
    await seed(call);
    const dup = '018f4c2e-0000-7000-8000-0000000000bb';
    const res = await call(A, '/v1/budget', {
      method: 'PUT',
      body: {
        monthly_budget: 500,
        categories: [
          { id: dup, name: 'A', cap: 1 },
          { id: dup, name: 'B', cap: 2 },
        ],
      },
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { detail: string }).detail).toMatch(/id duplicates/);
    expect(caps(db), 'the DELETE must not have run').toEqual(['Music:20', 'Video:35']);
  });

  const badIds: Array<[string, unknown]> = [
    ['id is a number', 7],
    ['id is blank', '   '],
    ['id is an object', {}],
    ['id is over-long', 'x'.repeat(65)],
  ];
  for (const [label, id] of badIds) {
    it(`400s when ${label}, leaving the existing caps intact`, async () => {
      const { db, call } = setup();
      await seed(call);
      const res = await call(A, '/v1/budget', {
        method: 'PUT',
        body: { monthly_budget: 500, categories: [{ id, name: 'Music', cap: 20 }] },
      });
      expect(res.status, label).toBe(400);
      expect(caps(db)).toEqual(['Music:20', 'Video:35']);
    });
  }

  it('an ABSENT id is still accepted — no released client sends one yet', async () => {
    // apps/subscriptiontracker's BudgetCap.toJson emits name + cap only. A required id would
    // 400 every save the shipped app makes.
    const { call } = setup();
    const res = await call(A, '/v1/budget', {
      method: 'PUT',
      body: { monthly_budget: 10, categories: [{ name: 'Music', cap: 5 }] },
    });
    expect(res.status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE BUDGET HAS A UNIT AND A CEILING (rv2-services 032, 0007_budget_currency.sql).
//
// Before 0007 `monthly_budget` and each cap had to be finite and ≥ 0 and
// nothing else, so 1.7e308 was stored and served; and they had no currency, so
// the unit was whatever the client assumed — while every subscription has
// carried its own since 0003. Each test below is red against that version.
// ─────────────────────────────────────────────────────────────────────────────
describe('PUT /v1/budget — amounts are bounded by MAX_PRICE', () => {
  const tooBig: Array<[string, unknown]> = [
    ['monthly_budget is 1e12', { monthly_budget: 1e12, categories: [] }],
    ['monthly_budget is 1.7e308', { monthly_budget: 1.7e308, categories: [] }],
    ['a cap is 1e12', { monthly_budget: 500, categories: [{ name: 'Music', cap: 1e12 }] }],
  ];
  for (const [label, body] of tooBig) {
    it(`400s when ${label}, writing nothing`, async () => {
      const { db, call } = setup();
      await seed(call);
      const res = await call(A, '/v1/budget', { method: 'PUT', body });
      expect(res.status, label).toBe(400);
      expect(((await res.json()) as { detail: string }).detail).toMatch(/must not exceed 1000000000/);
      expect(caps(db), 'the DELETE must not have run').toEqual(['Music:20', 'Video:35']);
      expect(db.rows('SELECT monthly_budget FROM budgets WHERE user_id = ?', A)[0].monthly_budget).toBe(500);
    });
  }

  it('MAX_PRICE itself is accepted — the bound is inclusive, like a price', async () => {
    const { db, call } = setup();
    const res = await call(A, '/v1/budget', {
      method: 'PUT',
      body: { monthly_budget: 1_000_000_000, categories: [{ name: 'Rent', cap: 1_000_000_000 }] },
    });
    expect(res.status).toBe(200);
    expect(caps(db)).toEqual(['Rent:1000000000']);
  });
});

describe('PUT /v1/budget — the budget carries its currency', () => {
  const currencyOf = (db: ReturnType<typeof realAppDb>) =>
    db.rows('SELECT currency FROM budgets WHERE user_id = ?', A)[0]?.currency;

  it('a currency round-trips: stored upper case, served by GET and by PUT', async () => {
    const { db, call } = setup();
    const res = await call(A, '/v1/budget', {
      method: 'PUT',
      body: { monthly_budget: 5000, currency: 'inr', categories: [{ name: 'Video', cap: 649 }] },
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { currency: string | null }).currency).toBe('INR');
    expect(currencyOf(db)).toBe('INR');
    const body = (await (await call(A, '/v1/budget')).json()) as { currency: string | null };
    expect(body.currency).toBe('INR');
  });

  it('NULL reads as the user\'s currency: a budget saved with none serves `currency: null`', async () => {
    const { db, call } = setup();
    await seed(call); // SEED sends no currency, as the app does for a bare budget
    expect(currencyOf(db)).toBeNull();
    const body = (await (await call(A, '/v1/budget')).json()) as Record<string, unknown>;
    expect(body).toHaveProperty('currency', null);
    expect(body.monthly_budget).toBe(500);
  });

  it('a budget row written before 0007 reads back with `currency: null`', async () => {
    // The shape of every production row on the day 0007 applies: the column is
    // there and holds NULL, because the migration adds it with no default.
    const { db, call } = setup();
    db.db.prepare('INSERT INTO budgets (user_id, monthly_budget, updated_at) VALUES (?, ?, ?)').run(
      A,
      300,
      '2026-09-01T00:00:00.000Z',
    );
    const body = (await (await call(A, '/v1/budget')).json()) as Record<string, unknown>;
    expect(body).toMatchObject({ monthly_budget: 300, currency: null });
  });

  it('an ABSENT currency leaves the stored code alone — an old client must not wipe it', async () => {
    const { db, call } = setup();
    await call(A, '/v1/budget', { method: 'PUT', body: { monthly_budget: 10, currency: 'EUR' } });
    const res = await call(A, '/v1/budget', { method: 'PUT', body: SEED });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { currency: string | null }).currency).toBe('EUR');
    expect(currencyOf(db)).toBe('EUR');
  });

  it('an explicit null clears it back to the user\'s currency', async () => {
    const { db, call } = setup();
    await call(A, '/v1/budget', { method: 'PUT', body: { monthly_budget: 10, currency: 'EUR' } });
    const res = await call(A, '/v1/budget', {
      method: 'PUT',
      body: { monthly_budget: 10, currency: null },
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { currency: string | null }).currency).toBeNull();
    expect(currencyOf(db)).toBeNull();
  });

  const badCurrencies: Array<[string, unknown]> = [
    ['currency is a number', 356],
    ['currency is two letters', 'IN'],
    ['currency is four letters', 'INRS'],
    ['currency is blank', ''],
    ['currency has a digit', 'US1'],
    ['currency is an object', { code: 'INR' }],
    // ⏱ 2026-10-01 · rv2-services-030: three letters is not enough — the code
    // must be in contracts/currency/iso4217.js.
    ['currency is three letters ISO 4217 never assigned', 'ZZZ'],
    ['currency is a code with no minor unit (XAU, gold)', 'XAU'],
  ];
  for (const [label, currency] of badCurrencies) {
    it(`400s when ${label}, writing nothing`, async () => {
      const { db, call } = setup();
      await call(A, '/v1/budget', { method: 'PUT', body: { ...SEED, currency: 'EUR' } });
      const res = await call(A, '/v1/budget', {
        method: 'PUT',
        body: { monthly_budget: 999, currency, categories: [] },
      });
      expect(res.status, label).toBe(400);
      expect(((await res.json()) as { detail: string }).detail).toMatch(/currency/);
      expect(currencyOf(db)).toBe('EUR');
      expect(caps(db), 'the DELETE must not have run').toEqual(['Music:20', 'Video:35']);
    });
  }
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

// ⏱ 2026-10-01 · rv2-services-025 (lane fix-st-api-bounds). The body is read
// under a cap derived from MAX_CATEGORIES and the per-field widths, BEFORE it is
// parsed: an oversized PUT used to be materialised whole in the isolate first.
describe('PUT /v1/budget — the body is read under a cap', () => {
  it('the cap fits a full 200-category budget (≈ 128 KB) and no more than ~2× it', () => {
    expect(BUDGET_BODY_MAX_BYTES).toBeGreaterThan(120 * 1024);
    expect(BUDGET_BODY_MAX_BYTES).toBeLessThan(256 * 1024);
  });

  it('🔴 Content-Length 200000 is a 413 body_too_large, and the stored set survives', async () => {
    const { db, call } = setup();
    await call(A, '/v1/budget', { method: 'PUT', body: SEED });
    const res = await call(A, '/v1/budget', {
      method: 'PUT',
      body: '{"categories":[]}',
      headers: { 'Content-Length': '200000' },
    });
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ error: 'body_too_large' });
    expect(caps(db)).toEqual(['Music:20', 'Video:35']);
  });

  it('a full 200-category budget at the widest names is accepted', async () => {
    const { call } = setup();
    const categories = Array.from({ length: 200 }, (_, i) => ({
      name: `${String(i).padStart(3, '0')}${'😀'.repeat(58)}`,
      cap: 1,
      id: `id-${String(i).padStart(3, '0')}-${'x'.repeat(56)}`,
    }));
    const res = await call(A, '/v1/budget', { method: 'PUT', body: { monthly_budget: 1, categories } });
    expect(res.status).toBe(200);
  });
});
