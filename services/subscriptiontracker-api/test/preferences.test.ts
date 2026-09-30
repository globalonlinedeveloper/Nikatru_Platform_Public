// ─────────────────────────────────────────────────────────────────────────────
// /v1/preferences — per key, server-ordered (audit D11, ST-N6; lead ruling on
// #1080). Against a REAL SQL engine with the REAL migrations applied, like
// budget.test: "accepted while the row is not newer" is an upsert's WHERE
// clause, and a mock would pass it either way.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from 'vitest';
import preferences, { MAX_BODY_BYTES, MAX_PATCH_KEYS, MAX_SWITCHES } from '../src/routes/preferences';
import { realAppDb, asUser } from './harness';
import contractRaw from './fixtures/preferences-contract.json?raw';

const A = 'user-a';
const B = 'user-b';

function setup() {
  const db = realAppDb();
  const call = asUser(preferences, '/v1/preferences', { APP_DB: db as never });
  return { db, call };
}

type Doc = Record<string, { value: unknown; version: number; updated_at: string }>;
type Answer = { preferences: Doc; conflicts?: string[] };

const patch = (call: ReturnType<typeof setup>['call'], user: string, changes: Record<string, unknown>) =>
  call(user, '/v1/preferences', { method: 'PATCH', body: { changes } });
const get = async (call: ReturnType<typeof setup>['call'], user: string) =>
  ((await (await call(user, '/v1/preferences')).json()) as Answer).preferences;
const values = (doc: Doc) => Object.fromEntries(Object.entries(doc).map(([k, v]) => [k, v.value]));

describe('/v1/preferences', () => {
  it('an account with none stored answers an empty document', async () => {
    const { call } = setup();
    const res = await call(A, '/v1/preferences');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ preferences: {} });
  });

  it('a PATCH writes only the keys it names, at version 1, for that account only', async () => {
    const { call } = setup();
    const res = await patch(call, A, { themeMode: { value: 'dark', base_version: 0 } });
    expect(res.status).toBe(200);
    const answer = (await res.json()) as Answer;
    expect(answer.conflicts).toEqual([]);
    expect(answer.preferences.themeMode).toMatchObject({ value: 'dark', version: 1 });
    expect(values(await get(call, A))).toEqual({ themeMode: 'dark' });
    expect(await get(call, B)).toEqual({});
  });

  it('🔴 a stale device never touches keys it did not change (review finding 1, scenario A)', async () => {
    const { call } = setup();
    await patch(call, A, {
      themeMode: { value: 'light', base_version: 0 },
      currencyCode: { value: 'USD', base_version: 0 },
    });
    // Device B moves the currency on.
    await patch(call, A, { currencyCode: { value: 'EUR', base_version: 1 } });
    // Device A, offline since the first write, sends ONLY its theme change.
    const res = await patch(call, A, { themeMode: { value: 'dark', base_version: 1 } });
    expect(((await res.json()) as Answer).conflicts).toEqual([]);
    expect(values(await get(call, A))).toEqual({ themeMode: 'dark', currencyCode: 'EUR' });
  });

  it('🔴 a change based on an older version is a CONFLICT: the server keeps its value and answers it', async () => {
    const { call } = setup();
    await patch(call, A, { currencyCode: { value: 'USD', base_version: 0 } }); // v1
    await patch(call, A, { currencyCode: { value: 'EUR', base_version: 1 } }); // v2, the other device
    const res = await patch(call, A, {
      currencyCode: { value: 'GBP', base_version: 1 }, // based on v1: stale
      themeMode: { value: 'dark', base_version: 0 }, // independent key: accepted
    });
    expect(res.status).toBe(200);
    const answer = (await res.json()) as Answer;
    expect(answer.conflicts).toEqual(['currencyCode']);
    expect(answer.preferences.currencyCode).toMatchObject({ value: 'EUR', version: 2 });
    expect(answer.preferences.themeMode).toMatchObject({ value: 'dark', version: 1 });
    expect(values(await get(call, A))).toEqual({ currencyCode: 'EUR', themeMode: 'dark' });
  });

  it('versions are the server’s: each accepted write bumps by one', async () => {
    const { call } = setup();
    for (let i = 0; i < 3; i++) {
      await patch(call, A, { reminderLeadDays: { value: i + 1, base_version: i } });
    }
    expect((await get(call, A)).reminderLeadDays).toMatchObject({ value: 3, version: 3 });
  });

  it('🔴 a body over 16 KiB is a 413 with our error code, and writes nothing', async () => {
    const { call } = setup();
    const res = await call(A, '/v1/preferences', {
      method: 'PATCH',
      body: JSON.stringify({ changes: { locale: { value: 'x'.repeat(MAX_BODY_BYTES), base_version: 0 } } }),
    });
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ error: 'preferences_too_large', limit_bytes: MAX_BODY_BYTES });
    expect(await get(call, A)).toEqual({});
  });

  it('the whole-document PUT is gone', async () => {
    const { call } = setup();
    const res = await call(A, '/v1/preferences', { method: 'PUT', body: { preferences: { themeMode: 'dark' } } });
    expect(res.status).toBe(404);
    expect(await get(call, A)).toEqual({});
  });

  it('the switch count is capped per account', async () => {
    const { call } = setup();
    for (let i = 0; i < MAX_SWITCHES; i += MAX_PATCH_KEYS) {
      const changes: Record<string, unknown> = {};
      for (let j = i; j < Math.min(i + MAX_PATCH_KEYS, MAX_SWITCHES); j++) {
        changes[`switch.s${j}`] = { value: true, base_version: 0 };
      }
      expect((await patch(call, A, changes)).status).toBe(200);
    }
    const res = await patch(call, A, { 'switch.oneMore': { value: true, base_version: 0 } });
    expect(res.status).toBe(400);
    // An existing switch still changes.
    expect((await patch(call, A, { 'switch.s0': { value: false, base_version: 1 } })).status).toBe(200);
  });

  it('the app’s contract fixture is accepted whole (review finding 6)', async () => {
    const { call } = setup();
    const contract = JSON.parse(contractRaw) as { changes: Record<string, { value: unknown }> };
    const res = await patch(call, A, contract.changes);
    expect(res.status).toBe(200);
    expect(((await res.json()) as Answer).conflicts).toEqual([]);
    expect(values(await get(call, A))).toEqual(
      Object.fromEntries(Object.entries(contract.changes).map(([k, v]) => [k, v.value])),
    );
  });

  for (const [label, body] of [
    ['not an object', []],
    ['no changes key', { themeMode: 'dark' }],
    ['an empty change set', { changes: {} }],
    ['an unknown key', { changes: { fontSize: { value: 3, base_version: 0 } } }],
    ['a currency that is not a code', { changes: { currencyCode: { value: '$', base_version: 0 } } }],
    ['a theme outside the three', { changes: { themeMode: { value: 'sepia', base_version: 0 } } }],
    ['a locale that is not a tag', { changes: { locale: { value: '<script>', base_version: 0 } } }],
    ['a fractional lead', { changes: { reminderLeadDays: { value: 1.5, base_version: 0 } } }],
    ['a minute past midnight', { changes: { reminderMinuteOfDay: { value: 1440, base_version: 0 } } }],
    ['a switch that is not a boolean', { changes: { 'switch.alerts': { value: 'yes', base_version: 0 } } }],
    ['a switch name that is not an identifier', { changes: { 'switch.a b': { value: true, base_version: 0 } } }],
    ['a missing base version', { changes: { themeMode: { value: 'dark' } } }],
    ['a negative base version', { changes: { themeMode: { value: 'dark', base_version: -1 } } }],
    [
      'too many keys in one PATCH',
      {
        changes: Object.fromEntries(
          Array.from({ length: MAX_PATCH_KEYS + 1 }, (_, i) => [`switch.k${i}`, { value: true, base_version: 0 }]),
        ),
      },
    ],
  ] as const) {
    it(`refuses ${label} with a 400 and writes nothing — not even the valid keys beside it`, async () => {
      const { call } = setup();
      await patch(call, A, { themeMode: { value: 'light', base_version: 0 } });
      const withValid =
        typeof body === 'object' && !Array.isArray(body) && 'changes' in body && Object.keys(body.changes).length > 0
          ? { changes: { 'switch.besideIt': { value: true, base_version: 0 }, ...body.changes } }
          : body;
      const res = await call(A, '/v1/preferences', { method: 'PATCH', body: withValid });
      expect(res.status).toBe(400);
      expect(values(await get(call, A))).toEqual({ themeMode: 'light' });
    });
  }
});
