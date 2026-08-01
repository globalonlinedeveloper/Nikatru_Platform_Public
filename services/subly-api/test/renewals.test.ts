// ─────────────────────────────────────────────────────────────────────────────
// GET /v1/renewals?withinDays=N — THE WINDOW HAS TO BE BOUNDED AT BOTH ENDS.
//
// It had a floor and no ceiling: `Math.max(0, Math.trunc(Number(raw)))`. The
// value then becomes a date —
//   `new Date(todayMs + withinDays * 86_400_000).toISOString()`
// — and past ~1e11 days that Date is Invalid and `.toISOString()` THROWS a
// RangeError, which index.ts serves as a generic 500. `?withinDays=1e15` is one
// keystroke away from a normal request.
//
// A ceiling is also what makes the query mean anything: `next_renewal <= ?` with
// a year-275760 bound is "every row this user has", not a renewals view.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, beforeEach } from 'vitest';
import renewals from '../src/routes/renewals';
import subscriptions from '../src/routes/subscriptions';
import { todayYmd } from '../src/lib/d1';
import { realAppDb, asUser } from './harness';

const U = 'user-a';

let db: ReturnType<typeof realAppDb>;
let rens: ReturnType<typeof asUser>;
let subs: ReturnType<typeof asUser>;

beforeEach(() => {
  db = realAppDb();
  rens = asUser(renewals, '/v1/renewals', { APP_DB: db as never });
  subs = asUser(subscriptions, '/v1/subscriptions', { APP_DB: db as never });
});

/** Relative to the route's OWN notion of today (`todayYmd`), not a second
 *  independent `Date.now()` — otherwise a run straddling UTC midnight seeds
 *  against one day and queries against the next, and the window tests flake. */
const ymd = (daysFromNow: number) =>
  new Date(Date.parse(`${todayYmd()}T00:00:00Z`) + daysFromNow * 86_400_000)
    .toISOString()
    .slice(0, 10);

async function seed(name: string, inDays: number) {
  const res = await subs(U, '/v1/subscriptions', {
    method: 'POST',
    body: { name, price: 5, next_renewal: ymd(inDays) },
  });
  expect(res.status).toBe(201);
}

const names = async (query = '') => {
  const res = await rens(U, `/v1/renewals${query}`);
  return {
    status: res.status,
    list: res.status === 200
      ? ((await res.json()) as Array<{ name: string }>).map((r) => r.name)
      : [],
  };
};

describe('withinDays is bounded ABOVE — the missing ceiling', () => {
  for (const bad of ['1e15', '1e308', '100000000000', '3661', '999999999']) {
    it(`400s on withinDays=${bad} instead of 500ing on an Invalid Date`, async () => {
      const res = await rens(U, `/v1/renewals?withinDays=${bad}`);
      expect(res.status, bad).toBe(400);
      expect(await res.json()).toHaveProperty('error', 'invalid_query');
    });
  }

  it('the unbounded value really did throw before the ceiling existed', () => {
    // Pins WHY the bound is where it is: without it the route reached this
    // expression, and this is what it did. If Date ever grows a wider range this
    // fails and the bound can be revisited deliberately.
    const todayMs = Date.parse(`${todayYmd()}T00:00:00Z`);
    expect(() => new Date(todayMs + 1e15 * 86_400_000).toISOString()).toThrow(
      RangeError,
    );
  });

  it('accepts the boundary value 3660 and rejects 3661', async () => {
    expect((await rens(U, '/v1/renewals?withinDays=3660')).status).toBe(200);
    expect((await rens(U, '/v1/renewals?withinDays=3661')).status).toBe(400);
  });
});

describe('withinDays is bounded BELOW and shaped', () => {
  it('400s on a negative window rather than silently flooring it to 0', async () => {
    const res = await rens(U, '/v1/renewals?withinDays=-5');
    expect(res.status).toBe(400);
  });

  for (const bad of ['abc', 'NaN', 'Infinity', '7d']) {
    it(`400s on withinDays=${bad}`, async () => {
      expect((await rens(U, `/v1/renewals?withinDays=${bad}`)).status).toBe(400);
    });
  }
});

describe('the window still works — the guard did not just break the route', () => {
  it('defaults to 7 days when absent or empty', async () => {
    await seed('Soon', 3);
    await seed('Later', 30);
    expect((await names()).list).toEqual(['Soon']);
    expect((await names('?withinDays=')).list).toEqual(['Soon']);
  });

  it('honours an explicit window, ascending by date', async () => {
    await seed('Soon', 3);
    await seed('Later', 30);
    expect((await names('?withinDays=60')).list).toEqual(['Soon', 'Later']);
  });

  it('withinDays=0 is today only', async () => {
    await seed('Today', 0);
    await seed('Tomorrow', 1);
    expect((await names('?withinDays=0')).list).toEqual(['Today']);
  });

  it('a fractional window truncates rather than 400ing', async () => {
    await seed('Soon', 3);
    await seed('Later', 30);
    expect((await names('?withinDays=3.9')).list).toEqual(['Soon']);
  });

  it('reports days_left for each row', async () => {
    await seed('Soon', 3);
    const res = await rens(U, '/v1/renewals?withinDays=10');
    const [row] = (await res.json()) as Array<{ days_left: number }>;
    expect(row.days_left).toBe(3);
  });

  it('the maximum window returns rows far out, not an error', async () => {
    await seed('Distant', 3000);
    expect((await names('?withinDays=3660')).list).toEqual(['Distant']);
  });
});
