// ─────────────────────────────────────────────────────────────────────────────
// CATEGORIES BY ID — the API half of ST-X8 (round-2 F16, B29, C11).
//
// Red control: on main 454dd415 there is no /v1/categories, no `category_id`
// on a subscription and none on a cap — a cap is keyed by its category's NAME,
// so "renaming a category keeps its cap" and "a built-in has an id a client can
// translate by" both fail there.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, beforeEach } from 'vitest';
import budget from '../src/routes/budget';
import categories, { MAX_CATEGORY_BATCH_STATEMENTS } from '../src/routes/categories';
import subscriptions from '../src/routes/subscriptions';
import { realAppDb, asUser, SqliteD1 } from './harness';

const U = 'user-a';
type Row = Record<string, unknown>;

let db: SqliteD1;
let cats: ReturnType<typeof asUser>;
let subs: ReturnType<typeof asUser>;
let bud: ReturnType<typeof asUser>;

beforeEach(() => {
  db = realAppDb();
  cats = asUser(categories, '/v1/categories', { APP_DB: db as never });
  subs = asUser(subscriptions, '/v1/subscriptions', { APP_DB: db as never });
  bud = asUser(budget, '/v1/budget', { APP_DB: db as never });
});

const json = async (res: Response) => (await res.json()) as Row;
const newCategory = async (name: string, user = U) =>
  json(await cats(user, '/v1/categories', { method: 'POST', body: { name } }));

describe('the built-ins have stable ids a client translates by (F16, B29)', () => {
  it('GET /v1/categories lists the ten built-ins, flagged, then the user’s own', async () => {
    const mine = await newCategory('Gym & classes');
    const list = (await (await cats(U, '/v1/categories')).json()) as Row[];
    expect(list.slice(0, 10).every((c) => c.builtin === true)).toBe(true);
    expect(list.slice(0, 10).map((c) => c.id)).toContain('streaming');
    expect(list.map((c) => c.id)).toEqual([...list.slice(0, 10).map((c) => c.id), mine.id]);
    expect(list[10]).toMatchObject({ name: 'Gym & classes', builtin: false });
  });

  it('a subscription saved by name from an old client gets the built-in id', async () => {
    const res = await subs(U, '/v1/subscriptions', { method: 'POST', body: { name: 'Netflix', category: 'Streaming' } });
    expect((await json(res)).category_id).toBe('streaming');
  });

  it('a subscription saved by id carries the category’s name for old readers', async () => {
    const res = await subs(U, '/v1/subscriptions', { method: 'POST', body: { name: 'Netflix', category_id: 'streaming' } });
    expect(res.status).toBe(201);
    expect(await json(res)).toMatchObject({ category_id: 'streaming', category: 'Streaming' });
  });

  it('a built-in can be neither renamed nor deleted', async () => {
    expect((await cats(U, '/v1/categories/streaming', { method: 'PATCH', body: { name: 'TV' } })).status).toBe(403);
    expect((await cats(U, '/v1/categories/streaming', { method: 'DELETE' })).status).toBe(403);
    expect(db.rows("SELECT name FROM categories WHERE id = 'streaming'")).toEqual([{ name: 'Streaming' }]);
  });
});

describe('a category of the user’s own, by id (B29)', () => {
  it('saves by id; another user cannot use it; an unknown id is a 400', async () => {
    const mine = await newCategory('Gym');
    const ok = await subs(U, '/v1/subscriptions', { method: 'POST', body: { name: 'Cult', category_id: mine.id } });
    expect(await json(ok)).toMatchObject({ category_id: mine.id, category: 'Gym' });

    const theirs = await subs('user-b', '/v1/subscriptions', { method: 'POST', body: { name: 'X', category_id: mine.id } });
    expect(theirs.status).toBe(400);
    const bogus = await subs(U, '/v1/subscriptions', { method: 'POST', body: { name: 'X', category_id: 'nope' } });
    expect(bogus.status).toBe(400);
    expect(db.rows("SELECT id FROM subscriptions WHERE name = 'X'")).toHaveLength(0);
  });

  it('user B can neither rename nor delete user A’s category (review finding 5)', async () => {
    const mine = await newCategory('Gym');
    const sub = await json(
      await subs(U, '/v1/subscriptions', { method: 'POST', body: { name: 'Cult', category_id: mine.id } }),
    );
    await bud(U, '/v1/budget', {
      method: 'PUT',
      body: { monthly_budget: 1, categories: [{ name: 'Gym', cap: 700, category_id: mine.id }] },
    });

    const renamed = await cats('user-b', `/v1/categories/${mine.id as string}`, { method: 'PATCH', body: { name: 'Mine now' } });
    expect(renamed.status).toBe(404);
    await cats('user-b', `/v1/categories/${mine.id as string}`, { method: 'DELETE' });

    expect(db.rows('SELECT name, user_id FROM categories WHERE id = ?', mine.id as string)).toEqual([
      { name: 'Gym', user_id: U },
    ]);
    expect(await json(await subs(U, `/v1/subscriptions/${sub.id as string}`))).toMatchObject({
      category: 'Gym',
      category_id: mine.id,
    });
    expect(db.rows('SELECT name, cap, category_id FROM budget_categories')).toEqual([
      { name: 'Gym', cap: 700, category_id: mine.id },
    ]);
  });

  it('a name already taken — by the user or by a built-in — is a 409', async () => {
    await newCategory('Gym');
    expect((await cats(U, '/v1/categories', { method: 'POST', body: { name: 'Gym' } })).status).toBe(409);
    expect((await cats(U, '/v1/categories', { method: 'POST', body: { name: 'Music' } })).status).toBe(409);
    // …but another user may have their own "Gym".
    expect((await cats('user-b', '/v1/categories', { method: 'POST', body: { name: 'Gym' } })).status).toBe(201);
  });

  it('an empty or oversized name is a 400', async () => {
    expect((await cats(U, '/v1/categories', { method: 'POST', body: { name: '  ' } })).status).toBe(400);
    expect((await cats(U, '/v1/categories', { method: 'POST', body: { name: 'g'.repeat(121) } })).status).toBe(400);
    expect(db.rows('SELECT id FROM categories WHERE user_id IS NOT NULL')).toHaveLength(0);
  });
});

describe('every batch on this router is MAX_CATEGORY_BATCH_STATEMENTS (tooling/ceilings.json)', () => {
  it('a rename and a delete each send exactly that many statements', async () => {
    const sizes: number[] = [];
    const real = db.batch.bind(db);
    db.batch = async (statements) => {
      sizes.push(statements.length);
      return real(statements);
    };
    const mine = await newCategory('Gym');
    await cats(U, `/v1/categories/${mine.id as string}`, { method: 'PATCH', body: { name: 'Gym 2' } });
    await cats(U, `/v1/categories/${mine.id as string}`, { method: 'DELETE' });
    expect(sizes).toEqual([MAX_CATEGORY_BATCH_STATEMENTS, MAX_CATEGORY_BATCH_STATEMENTS]);
  });
});

describe('C11 — renaming a category keeps its cap (caps keyed by category id)', () => {
  it('a cap saved by category_id survives the rename; the subscription follows too', async () => {
    const mine = await newCategory('Gym');
    const sub = await json(
      await subs(U, '/v1/subscriptions', { method: 'POST', body: { name: 'Cult', category_id: mine.id } }),
    );
    const put = await bud(U, '/v1/budget', {
      method: 'PUT',
      body: { monthly_budget: 5000, categories: [{ name: 'Gym', cap: 1500, category_id: mine.id }] },
    });
    expect(put.status).toBe(200);

    const renamed = await cats(U, `/v1/categories/${mine.id}`, { method: 'PATCH', body: { name: 'Fitness club' } });
    expect(renamed.status).toBe(200);

    const caps = (await json(await bud(U, '/v1/budget'))).categories as Row[];
    expect(caps, 'main keys caps by name, so a rename orphans the cap').toEqual([
      expect.objectContaining({ name: 'Fitness club', cap: 1500, category_id: mine.id }),
    ]);
    const after = await json(await subs(U, `/v1/subscriptions/${sub.id as string}`));
    expect(after).toMatchObject({ category: 'Fitness club', category_id: mine.id });
  });

  it('a cap sent by NAME (the shipped app) is matched to its category id', async () => {
    await bud(U, '/v1/budget', { method: 'PUT', body: { monthly_budget: 1, categories: [{ name: 'Music', cap: 200 }] } });
    expect(db.rows('SELECT name, category_id FROM budget_categories')).toEqual([
      { name: 'Music', category_id: 'music' },
    ]);
  });

  it('a cap keyed by an id the user cannot use is a 400 and replaces nothing', async () => {
    await bud(U, '/v1/budget', { method: 'PUT', body: { monthly_budget: 1, categories: [{ name: 'Music', cap: 200 }] } });
    const res = await bud(U, '/v1/budget', {
      method: 'PUT',
      body: { monthly_budget: 1, categories: [{ name: 'X', cap: 1, category_id: 'nope' }] },
    });
    expect(res.status).toBe(400);
    expect(db.rows('SELECT name FROM budget_categories')).toEqual([{ name: 'Music' }]);
  });

  it('deleting the user’s own category uncategorises its subscriptions and drops its cap', async () => {
    const mine = await newCategory('Gym');
    const sub = await json(
      await subs(U, '/v1/subscriptions', { method: 'POST', body: { name: 'Cult', category_id: mine.id } }),
    );
    await bud(U, '/v1/budget', {
      method: 'PUT',
      body: { monthly_budget: 1, categories: [{ name: 'Gym', cap: 1, category_id: mine.id }] },
    });
    expect((await cats(U, `/v1/categories/${mine.id}`, { method: 'DELETE' })).status).toBe(200);
    expect(await json(await subs(U, `/v1/subscriptions/${sub.id as string}`))).toMatchObject({
      category: null,
      category_id: null,
    });
    expect(db.rows('SELECT id FROM budget_categories')).toHaveLength(0);
    expect(db.rows('SELECT id FROM categories WHERE user_id IS NOT NULL')).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Independent review of #1063 — minor 6: the two cross-user READS of a
// category that had no test. The writes (rename, delete, a subscription saved
// under another user's id) are covered above.
// ─────────────────────────────────────────────────────────────────────────────
describe('minor 6 — user B can neither see nor use user A’s categories', () => {
  // Red control: drop `OR user_id = ?` in favour of any user in GET /'s WHERE
  // (e.g. `user_id IS NULL OR user_id IS NOT NULL`) — B's list carries A's "Gym".
  it('B’s GET /v1/categories lists the built-ins and B’s own, never A’s', async () => {
    const mine = await newCategory('Gym');
    const theirs = await newCategory('Chess club', 'user-b');
    const listed = (await (await cats('user-b', '/v1/categories')).json()) as Row[];
    const ids = listed.map((c) => c.id);
    expect(ids, 'B was served A’s category').not.toContain(mine.id);
    expect(listed.map((c) => c.name)).not.toContain('Gym');
    expect(ids).toContain(theirs.id);
    expect(listed.filter((c) => c.builtin !== true).map((c) => c.id)).toEqual([theirs.id]);
    expect(listed.filter((c) => c.builtin === true)).toHaveLength(10);
  });

  // Red control: widen PUT /v1/budget's category read to every user's rows
  // (drop `OR user_id = ?`'s user filter) — B's cap is stored under A's id.
  it('B cannot key a budget cap by A’s category id: a 400 that stores nothing, and A’s cap is untouched', async () => {
    const mine = await newCategory('Gym');
    await bud(U, '/v1/budget', {
      method: 'PUT',
      body: { monthly_budget: 5000, categories: [{ name: 'Gym', cap: 1500, category_id: mine.id }] },
    });
    await bud('user-b', '/v1/budget', { method: 'PUT', body: { monthly_budget: 10, categories: [{ name: 'Music', cap: 5 }] } });

    const res = await bud('user-b', '/v1/budget', {
      method: 'PUT',
      body: { monthly_budget: 99, categories: [{ name: 'Anything', cap: 1, category_id: mine.id }] },
    });
    expect(res.status, 'B keyed a cap by A’s category').toBe(400);
    expect(((await res.json()) as Row).detail).toContain(String(mine.id));
    expect(db.rows("SELECT name, cap, category_id FROM budget_categories WHERE user_id = 'user-b'")).toEqual([
      { name: 'Music', cap: 5, category_id: 'music' },
    ]);
    expect(db.rows("SELECT monthly_budget FROM budgets WHERE user_id = 'user-b'")).toEqual([{ monthly_budget: 10 }]);
    expect(db.rows("SELECT name, cap, category_id FROM budget_categories WHERE user_id = 'user-a'")).toEqual([
      { name: 'Gym', cap: 1500, category_id: mine.id },
    ]);
  });
});
