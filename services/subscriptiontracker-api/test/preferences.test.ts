// ─────────────────────────────────────────────────────────────────────────────
// /v1/preferences — the account's copy of the preferences (audit D11, ST-N6).
//
// Against a REAL SQL engine with the REAL migrations applied, like budget.test:
// the property under test is "written by one device, read by another", which
// is a row surviving between two requests — a mock would pass it either way.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from 'vitest';
import preferences from '../src/routes/preferences';
import { realAppDb, asUser } from './harness';

const A = 'user-a';
const B = 'user-b';

function setup() {
  const db = realAppDb();
  const call = asUser(preferences, '/v1/preferences', { APP_DB: db as never });
  return { db, call };
}

const DOC = {
  currencyCode: 'EUR',
  themeMode: 'dark',
  locale: 'ta',
  reminderLeadDays: 3,
  reminderMinuteOfDay: 8 * 60 + 30,
  prefs: { alerts: true, weekly: false, unused: true, priceHike: true },
};

describe('/v1/preferences', () => {
  it('an account with none stored answers null, not defaults', async () => {
    const { call } = setup();
    const res = await call(A, '/v1/preferences');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ preferences: null });
  });

  it('written by one device, read back by the next — for that account only', async () => {
    const { call } = setup();
    const put = await call(A, '/v1/preferences', { method: 'PUT', body: { preferences: DOC } });
    expect(put.status).toBe(200);

    const mine = await call(A, '/v1/preferences');
    expect(await mine.json()).toEqual({ preferences: DOC });
    const theirs = await call(B, '/v1/preferences');
    expect(await theirs.json()).toEqual({ preferences: null });
  });

  it('a PUT replaces the document whole', async () => {
    const { call } = setup();
    await call(A, '/v1/preferences', { method: 'PUT', body: { preferences: DOC } });
    await call(A, '/v1/preferences', { method: 'PUT', body: { preferences: { themeMode: 'light' } } });
    const res = await call(A, '/v1/preferences');
    expect(await res.json()).toEqual({ preferences: { themeMode: 'light' } });
  });

  it('"" is a locale choice (follow the device) and is kept', async () => {
    const { call } = setup();
    const res = await call(A, '/v1/preferences', { method: 'PUT', body: { preferences: { locale: '' } } });
    expect(res.status).toBe(200);
  });

  for (const [label, body] of [
    ['not an object', []],
    ['no preferences key', { theme: 'dark' }],
    ['an unknown key', { preferences: { fontSize: 3 } }],
    ['a currency that is not a code', { preferences: { currencyCode: '$' } }],
    ['a theme outside the three', { preferences: { themeMode: 'sepia' } }],
    ['a locale that is not a tag', { preferences: { locale: '<script>' } }],
    ['a fractional lead', { preferences: { reminderLeadDays: 1.5 } }],
    ['a minute past midnight', { preferences: { reminderMinuteOfDay: 1440 } }],
    ['a switch that is not a boolean', { preferences: { prefs: { alerts: 'yes' } } }],
    ['too many switches', { preferences: { prefs: Object.fromEntries(Array.from({ length: 33 }, (_, i) => [`s${i}`, true])) } }],
  ] as const) {
    it(`refuses ${label} with a 400 and keeps what was stored`, async () => {
      const { call } = setup();
      await call(A, '/v1/preferences', { method: 'PUT', body: { preferences: DOC } });
      const res = await call(A, '/v1/preferences', { method: 'PUT', body });
      expect(res.status).toBe(400);
      const after = await call(A, '/v1/preferences');
      expect(await after.json()).toEqual({ preferences: DOC });
    });
  }
});
