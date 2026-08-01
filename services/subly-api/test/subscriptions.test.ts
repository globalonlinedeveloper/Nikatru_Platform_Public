// ─────────────────────────────────────────────────────────────────────────────
// POST / PATCH /v1/subscriptions — BODY VALIDATION.
//
// These bound raw JSON straight into D1. `interface CreateBody` looked like a
// contract and enforced nothing: it is erased before the request exists. What
// that actually cost, all reachable without an attacker:
//
//   · a non-object body (`null`, `[]`, `"x"`) threw a TypeError on the first
//     property read — a 500 before any check ran;
//   · `{"price":{}}` bound an object and D1 answered D1_TYPE_ERROR — on PATCH
//     that lands AFTER the ownership check, so "not yours" and "bad value" were
//     indistinguishable from outside;
//   · `{"cycle":"weekly"}` was rejected by the DATABASE's CHECK constraint as a
//     500 instead of by the route as a 400;
//   · `{"next_renewal":"soon"}` was ACCEPTED AND STORED. /v1/renewals compares
//     next_renewal as a string, so that subscription never appears in any
//     renewal window again — a bill the user is still paying, invisible.
//
// Run against a REAL SQL engine (node:sqlite + the real migrations) because half
// of the above is the database's answer, and a mock has no CHECK constraint and
// no type errors to give.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, beforeEach } from 'vitest';
import subscriptions from '../src/routes/subscriptions';
import { realAppDb, asUser } from './harness';

const U = 'user-a';

let db: ReturnType<typeof realAppDb>;
let subs: ReturnType<typeof asUser>;

beforeEach(() => {
  db = realAppDb();
  subs = asUser(subscriptions, '/v1/subscriptions', { APP_DB: db as never });
});

const post = (body: unknown) =>
  subs(U, '/v1/subscriptions', { method: 'POST', body });

/** A valid subscription, then its id. */
async function seed(): Promise<string> {
  const res = await post({
    name: 'Netflix',
    category: 'Video',
    price: 9.99,
    cycle: 'monthly',
    next_renewal: '2026-09-01',
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

const BAD_BODIES: ReadonlyArray<readonly [string, unknown]> = [
  ['a non-object body (null)', null],
  ['a non-object body (array)', []],
  // Raw JSON text: the harness passes a string body through verbatim, so
  // `'hello'` would be malformed JSON and would test the wrong branch.
  ['a non-object body (JSON string)', '"hello"'],
  ['a non-object body (JSON number)', '7'],
  ['name as an object', { name: {} }],
  ['name as a number', { name: 7 }],
  ['category as an array', { category: ['a'] }],
  ['price as an object', { price: {} }],
  ['price as a numeric string', { price: '9.99' }],
  ['a negative price', { price: -1 }],
  ['an absurd price', { price: 1_000_000_001 }],
  ['cycle outside the CHECK constraint', { cycle: 'weekly' }],
  ['cycle as a number', { cycle: 1 }],
  ['next_renewal as free text', { next_renewal: 'soon' }],
  ['next_renewal in the wrong format', { next_renewal: '01/09/2026' }],
  ['next_renewal as an impossible day', { next_renewal: '2026-02-31' }],
  ['next_renewal as a full timestamp', { next_renewal: '2026-09-01T00:00:00Z' }],
  ['used_pct out of range', { used_pct: 101 }],
  ['used_pct as a string', { used_pct: '50' }],
  ['unused as a string', { unused: 'yes' }],
  ['an oversized name', { name: 'n'.repeat(201) }],
  ['an oversized usage_note', { usage_note: 'x'.repeat(1001) }],
  ['a glyph that is a field', { glyph: 'g'.repeat(33) }],
];

describe('POST /v1/subscriptions rejects an unusable body with 400, not 500', () => {
  for (const [label, body] of BAD_BODIES) {
    it(`400s on ${label}, and stores nothing`, async () => {
      const res = await post(body);
      expect(res.status, label).toBe(400);
      expect((await res.json()) as { error: string }).toHaveProperty(
        'error',
        'invalid_body',
      );
      expect(
        db.rows('SELECT id FROM subscriptions'),
        'a rejected create must leave the table empty',
      ).toHaveLength(0);
    });
  }

  it('400s malformed JSON before anything else', async () => {
    const res = await subs(U, '/v1/subscriptions', { method: 'POST', body: '{nope' });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_json' });
  });
});

describe('PATCH /v1/subscriptions/:id rejects the same bodies', () => {
  for (const [label, body] of BAD_BODIES) {
    it(`400s on ${label}, and the row is untouched`, async () => {
      const id = await seed();
      const res = await subs(U, `/v1/subscriptions/${id}`, { method: 'PATCH', body });
      expect(res.status, label).toBe(400);
      const [row] = db.rows('SELECT name, price, cycle FROM subscriptions WHERE id = ?', id);
      expect(row.name).toBe('Netflix');
      expect(row.price).toBe(9.99);
      expect(row.cycle).toBe('monthly');
    });
  }

  it('validates BEFORE the ownership read, so a bad body is 400 not 404', async () => {
    // Both answers are "no". They are not the same answer, and the caller can
    // only fix one of them.
    const id = await seed();
    const other = await asUser(subscriptions, '/v1/subscriptions', {
      APP_DB: db as never,
    })('user-b', `/v1/subscriptions/${id}`, { method: 'PATCH', body: { price: {} } });
    expect(other.status).toBe(400);
  });

  it('a well-formed PATCH on someone else’s row is still 404', async () => {
    // The guard above must not have turned the tenancy check into dead code.
    const id = await seed();
    const other = await subs('user-b', `/v1/subscriptions/${id}`, {
      method: 'PATCH',
      body: { price: 1 },
    });
    expect(other.status).toBe(404);
    expect(db.rows('SELECT price FROM subscriptions WHERE id = ?', id)[0].price).toBe(9.99);
  });
});

// Without these, a route that answered 400 to EVERYTHING would pass every test
// above. Each is a shape the Subly client really sends.
describe('the valid shapes the first-party client sends still work', () => {
  it('accepts a full create and stores every field', async () => {
    const res = await post({
      name: 'Spotify',
      category: 'Music',
      price: 119,
      cycle: 'yearly',
      next_renewal: '2027-02-28',
      plan: 'Family',
      glyph: '🎵',
      used_pct: 80,
      usage_note: 'shared with family',
      unused: false,
    });
    expect(res.status).toBe(201);
    const [row] = db.rows('SELECT * FROM subscriptions');
    expect(row).toMatchObject({
      name: 'Spotify',
      category: 'Music',
      price: 119,
      cycle: 'yearly',
      next_renewal: '2027-02-28',
      plan: 'Family',
      glyph: '🎵',
      used_pct: 80,
      usage_note: 'shared with family',
      unused: 0,
    });
  });

  it('accepts the empty strings the client sends for "not set"', async () => {
    // Subscription.toJson in apps/subly sends plan/glyph/usage_note as ''.
    // Rejecting empty here would 400 first-party traffic on every create.
    const res = await post({ name: 'X', plan: '', glyph: '', usage_note: '' });
    expect(res.status).toBe(201);
  });

  it('accepts a create with no body fields at all', async () => {
    const res = await post({});
    expect(res.status).toBe(201);
    const [row] = db.rows('SELECT * FROM subscriptions');
    expect(row.used_pct).toBe(0);
    expect(row.unused).toBe(0);
    expect(row.name).toBeNull();
  });

  it('accepts the range boundaries: price 0, used_pct 0 and 100', async () => {
    expect((await post({ price: 0, used_pct: 0 })).status).toBe(201);
    expect((await post({ price: 1_000_000_000, used_pct: 100 })).status).toBe(201);
  });

  it('accepts a real price in a low-denomination currency', async () => {
    // Subly stores a bare number with no currency and ships worldwide. A yearly
    // subscription is ~2 600 000 VND and ~1 800 000 IDR — the first version of
    // this bound was 1 000 000 and would have 400d both.
    expect((await post({ name: 'VN', price: 2_640_000 })).status).toBe(201);
    expect((await post({ name: 'ID', price: 1_800_000 })).status).toBe(201);
  });

  it('explicit null clears EVERY nullable column, including unused', async () => {
    // One rule for null, not a per-column table nobody can remember.
    const id = await seed();
    const res = await subs(U, `/v1/subscriptions/${id}`, {
      method: 'PATCH',
      body: {
        name: null,
        category: null,
        price: null,
        cycle: null,
        next_renewal: null,
        plan: null,
        glyph: null,
        used_pct: null,
        usage_note: null,
        unused: null,
      },
    });
    expect(res.status).toBe(200);
    const [row] = db.rows('SELECT * FROM subscriptions WHERE id = ?', id);
    for (const col of [
      'name',
      'category',
      'price',
      'cycle',
      'next_renewal',
      'plan',
      'glyph',
      'used_pct',
      'usage_note',
      'unused',
    ]) {
      expect(row[col], col).toBeNull();
    }
  });

  it('accepts a leap day and rejects the same date in a non-leap year', async () => {
    expect((await post({ next_renewal: '2028-02-29' })).status).toBe(201);
    expect((await post({ next_renewal: '2027-02-29' })).status).toBe(400);
  });

  it('PATCH updates only the keys present, and explicit null clears a column', async () => {
    const id = await seed();
    const res = await subs(U, `/v1/subscriptions/${id}`, {
      method: 'PATCH',
      body: { price: 12.5, usage_note: null },
    });
    expect(res.status).toBe(200);
    const [row] = db.rows('SELECT * FROM subscriptions WHERE id = ?', id);
    expect(row.price).toBe(12.5);
    expect(row.usage_note).toBeNull();
    expect(row.name, 'an absent key must not be overwritten').toBe('Netflix');
    expect(row.cycle).toBe('monthly');
  });

  it('PATCH with an empty body still bumps updated_at and 200s', async () => {
    const id = await seed();
    const res = await subs(U, `/v1/subscriptions/${id}`, { method: 'PATCH', body: {} });
    expect(res.status).toBe(200);
    expect(db.rows('SELECT updated_at FROM subscriptions WHERE id = ?', id)[0].updated_at)
      .toBeTypeOf('string');
  });

  it('accepts unused as a real boolean and serializes it back as one', async () => {
    const res = await post({ name: 'Y', unused: true });
    expect(((await res.json()) as { unused: boolean }).unused).toBe(true);
    expect(db.rows('SELECT unused FROM subscriptions')[0].unused).toBe(1);
  });

  it('a float used_pct is truncated into the INTEGER column', async () => {
    await post({ used_pct: 33.7 });
    expect(db.rows('SELECT used_pct FROM subscriptions')[0].used_pct).toBe(33);
  });
});
