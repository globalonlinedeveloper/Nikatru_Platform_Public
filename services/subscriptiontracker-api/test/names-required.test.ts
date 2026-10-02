// ─────────────────────────────────────────────────────────────────────────────
// Train T11 · AD-01 (server half) — a subscription has a name.
//
// `validate` checked `name` with `isBoundedString`, a LENGTH check and nothing
// else, and POST bound `f.name ?? null`: `{name: "  "}` and a body with no name
// at all were both 201, and every list then showed a row the user could not
// tell from any other. POST and PATCH now answer 400 `name_required` to a name
// that is absent (POST), null, empty or only whitespace, and write nothing; a
// PATCH that OMITS `name` is a partial edit and is fine.
//
// RED CONTROL: make `nameMissing` return false — the whitespace POST is 201 and
// stores a row, and the null/blank PATCHes are 200 and clear the stored name.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, beforeEach } from 'vitest';
import subscriptions from '../src/routes/subscriptions';
import { realAppDb, asUser } from './harness';

const U = 'user-a';
type Row = Record<string, unknown>;

let db: ReturnType<typeof realAppDb>;
let subs: ReturnType<typeof asUser>;

beforeEach(() => {
  db = realAppDb();
  subs = asUser(subscriptions, '/v1/subscriptions', { APP_DB: db as never });
});

const post = (body: unknown) => subs(U, '/v1/subscriptions', { method: 'POST', body });
const patch = (id: string, body: unknown) => subs(U, `/v1/subscriptions/${id}`, { method: 'PATCH', body });

const BLANK_NAMES: ReadonlyArray<readonly [string, unknown]> = [
  ['two spaces', '  '],
  ['the empty string', ''],
  ['tabs and newlines', '\t\n \r'],
  ['a no-break space', '\u00a0'],
  ['null', null],
];

describe('POST refuses a subscription with no name — 400 name_required, and no row', () => {
  for (const [label, name] of BLANK_NAMES) {
    it(`name: ${label}`, async () => {
      const res = await post({ name, price: 649, cycle: 'monthly' });
      expect(res.status).toBe(400);
      expect(((await res.json()) as Row).error).toBe('name_required');
      expect(db.rows('SELECT id FROM subscriptions'), 'a nameless row was stored').toHaveLength(0);
    });
  }

  it('a body that sends no name at all', async () => {
    const res = await post({ price: 649, cycle: 'monthly' });
    expect(res.status).toBe(400);
    expect(((await res.json()) as Row).error).toBe('name_required');
    expect(db.rows('SELECT id FROM subscriptions')).toHaveLength(0);
  });

  it('a name with words is stored as typed (spaces around it are the user’s)', async () => {
    const res = await post({ name: ' Netflix ', price: 649, cycle: 'monthly' });
    expect(res.status).toBe(201);
    expect(((await res.json()) as Row).name).toBe(' Netflix ');
  });

  it('a name that is not a string is still the invalid_body it always was', async () => {
    const res = await post({ name: 42 });
    expect(res.status).toBe(400);
    expect(((await res.json()) as Row).error).toBe('invalid_body');
  });
});

describe('PATCH refuses to blank a name, and leaves one it was not sent alone', () => {
  async function seeded(): Promise<string> {
    const res = await post({ name: 'Netflix', price: 649, cycle: 'monthly' });
    expect(res.status).toBe(201);
    return ((await res.json()) as Row).id as string;
  }

  for (const [label, name] of BLANK_NAMES) {
    it(`name: ${label} → 400 name_required, the row unchanged`, async () => {
      const id = await seeded();
      const before = db.rows('SELECT * FROM subscriptions WHERE id = ?', id);
      const res = await patch(id, { name, price: 999 });
      expect(res.status).toBe(400);
      expect(((await res.json()) as Row).error).toBe('name_required');
      expect(db.rows('SELECT * FROM subscriptions WHERE id = ?', id), 'the refused edit wrote').toEqual(before);
    });
  }

  it('a PATCH that omits name is fine, and keeps it', async () => {
    const id = await seeded();
    const res = await patch(id, { price: 999 });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ name: 'Netflix', price: 999 });
  });

  it('a rename to real text is fine', async () => {
    const id = await seeded();
    const res = await patch(id, { name: 'Netflix Premium' });
    expect(res.status).toBe(200);
    expect(((await res.json()) as Row).name).toBe('Netflix Premium');
  });
});
