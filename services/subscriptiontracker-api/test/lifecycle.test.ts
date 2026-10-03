// ─────────────────────────────────────────────────────────────────────────────
// ST-E3 ON THE WORKER — Pause, Mark cancelled and soft delete (round-2 F04, F03,
// B33). The app shipped all three in #1045; until this change the route
// answered 400 to `status: paused|cancelled` and to any non-null `deleted_at`,
// and DELETE removed the row and orphaned its payment_history.
//
// Every test below FAILS on main 454dd415 (the red control): the status and
// deleted_at PATCHes return 400, and DELETE leaves no row to restore.
// ─────────────────────────────────────────────────────────────────────────────
import renewalsSrc from '../../platform/src/renewals.ts?raw';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { recomputeRenewals } from '../../platform/src/renewals';
import subscriptions, {
  CHARGING_STATUSES,
  MAX_BATCH_STATEMENTS,
  SOFT_DELETE_PURGE_DAYS,
} from '../src/routes/subscriptions';
import { todayYmd } from '../src/lib/d1';
import { realAppDb, asUser, SqliteD1 } from './harness';

const U = 'user-a';
type Row = Record<string, unknown>;

let db: SqliteD1;
let subs: ReturnType<typeof asUser>;

beforeEach(() => {
  db = realAppDb();
  subs = asUser(subscriptions, '/v1/subscriptions', { APP_DB: db as never });
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
// "Due" as the platform fan-out charges: a CHARGING_STATUSES row that is not
// removed. It read this Worker's GET /v1/renewals until that route was removed
// (rv2-services-023, lane fix-st-api-bounds); 'the charging set is ONE set'
// below holds these literals to the fan-out's own, and 'the platform fan-out
// charges neither…' runs the fan-out itself.
const dueIds = async () =>
  db
    .rows(
      `SELECT id FROM subscriptions WHERE user_id = ? AND deleted_at IS NULL
         AND status IN (${CHARGING_STATUSES.map((s) => `'${s}'`).join(', ')}) ORDER BY id`,
      U,
    )
    .map((r) => r.id);

describe('F04 — Pause and Mark cancelled are accepted, and stop the row being due', () => {
  it('PATCH {status: paused} is 200; the row stays listed and is no longer due', async () => {
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

  it('a cancel with an explicit null date is dated today too (finding 3)', async () => {
    const id = await create();
    const out = (await (await patch(id, { status: 'cancelled', cancelled_on: null })).json()) as Row;
    expect([out.status, out.cancelled_on]).toEqual(['cancelled', todayYmd()]);
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

describe('every batch on this router is within MAX_BATCH_STATEMENTS (tooling/ceilings.json)', () => {
  it('the purge and a price-moving PATCH send at most that many statements, and the purge sends exactly it', async () => {
    const sizes: number[] = [];
    const real = db.batch.bind(db);
    db.batch = async (statements) => {
      sizes.push(statements.length);
      return real(statements);
    };
    const id = await create();
    await subs(U, '/v1/subscriptions');
    await patch(id, { price: 999 });
    expect(sizes, 'the list must purge and the price edit must log').toHaveLength(2);
    expect(Math.max(...sizes)).toBe(MAX_BATCH_STATEMENTS);
  });
});

describe('the charging set is ONE set', () => {
  it('the platform fan-out spells out exactly CHARGING_STATUSES', () => {
    // services/platform/src/renewals.ts writes the set as SQL literals (a D1
    // statement may not interpolate it); this keeps the literals and the
    // constant from drifting. (It read this Worker's GET /v1/renewals until
    // that route was removed, rv2-services-023.)
    const src = renewalsSrc;
    const set = /status IN \(([^)]*)\)/.exec(src)?.[1];
    expect(set, 'renewals.ts no longer filters on status').toBeDefined();
    expect(set?.split(',').map((s) => s.trim().replace(/'/g, ''))).toEqual([...CHARGING_STATUSES]);
  });
});

describe('F03 — soft delete: PATCH {deleted_at} hides the row, null brings it back', () => {
  it('is 200, and GET / and the due set omit the row', async () => {
    const id = await create();
    const res = await patch(id, { deleted_at: new Date().toISOString() });
    expect(res.status, "main answers 400: 'deleted_at cannot be set yet'").toBe(200);
    expect(((await res.json()) as Row).deleted_at).not.toBeNull();
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

  // Review of #1063, finding 1: the client's instant is the DEVICE clock.
  for (const [label, sent] of [
    ['a past instant (a clock a year behind)', '2025-09-29T10:00:00Z'],
    ['a future instant (a clock a year ahead)', '2027-09-29T10:00:00Z'],
  ] as const) {
    it(`${label} is stored as SERVER now, never trusted — and the next list purges nothing`, async () => {
      const id = await create();
      const before = new Date().toISOString();
      expect((await patch(id, { deleted_at: sent })).status).toBe(200);
      const after = new Date().toISOString();
      const stored = db.rows('SELECT deleted_at FROM subscriptions WHERE id = ?', id)[0]?.deleted_at as string;
      expect(stored, `stored the client's ${sent}`).not.toBe(new Date(sent).toISOString());
      expect(stored >= before && stored <= after, `${stored} is not server-now`).toBe(true);
      await subs(U, '/v1/subscriptions');
      expect(db.rows('SELECT id FROM subscriptions'), 'a past instant made the soft delete a hard one').toHaveLength(1);
      // …and Undo still brings it back (a future instant would have hidden it for good).
      await patch(id, { deleted_at: null });
      expect(await listIds()).toEqual([id]);
    });
  }

  // Red control (review of #1089, finding 1): refuse every PATCH on a removed
  // row but the Undo, as #1089 shipped — the second removal answers 404, a
  // delete that succeeded reported as failed. The status is what can fail now.
  it('a second PATCH {deleted_at} answers 200 and keeps the first stamp, as DELETE does', async () => {
    const id = await create();
    db.db.exec(`UPDATE subscriptions SET deleted_at = '2026-09-01T00:00:00.000Z' WHERE id = '${id}'`);
    const res = await patch(id, { deleted_at: new Date().toISOString() });
    expect(res.status, 'a repeated removal was reported as a failure').toBe(200);
    expect(((await res.json()) as Row).deleted_at).toBe('2026-09-01T00:00:00.000Z');
    expect(db.rows('SELECT deleted_at FROM subscriptions')[0]?.deleted_at).toBe('2026-09-01T00:00:00.000Z');
  });

  it('GET /:id of a removed row is a 404, like POST /:id/payments', async () => {
    const id = await create();
    await subs(U, `/v1/subscriptions/${id}`, { method: 'DELETE' });
    expect((await subs(U, `/v1/subscriptions/${id}`)).status).toBe(404);
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
    // Seeded in SQL: the route never stores a client instant (finding 1), so
    // an old stamp can only be one the server wrote a month ago.
    db.db.exec(`UPDATE subscriptions SET deleted_at = '${longAgo}' WHERE id = '${old}'`);
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

  it('a purge that fails does not take the list down (best-effort, finding 2)', async () => {
    const id = await create();
    db.batch = async () => {
      throw new Error('D1_ERROR: simulated purge failure');
    };
    const res = await subs(U, '/v1/subscriptions');
    expect(res.status).toBe(200);
    expect(((await res.json()) as Row[]).map((r) => r.id)).toEqual([id]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Independent review of #1063 — minors 1, 2 and 3. Each block names the red
// control it was proved against: the one-line mutation of the route that turns
// it red.
// ─────────────────────────────────────────────────────────────────────────────

describe('minor 1 — a PATCH on a removed row is a 404 and writes nothing', () => {
  // Red control: drop the `existing.deleted_at !== null && !restoring` refusal
  // and the `deleted_at IS NULL` in the write's WHERE — the PATCH answers 200,
  // renames the hidden row and logs a price step for it.
  it('answers exactly what GET /:id answers, and neither the row nor the price history moves', async () => {
    const id = await create();
    await subs(U, `/v1/subscriptions/${id}`, { method: 'DELETE' });
    const before = db.rows('SELECT * FROM subscriptions WHERE id = ?', id);

    const res = await patch(id, { name: 'Renamed', price: 999 });
    const got = await subs(U, `/v1/subscriptions/${id}`);
    expect(res.status, 'a removed row took an edit').toBe(404);
    expect(await res.json()).toEqual(await got.json());
    expect(got.status).toBe(404);
    expect(db.rows('SELECT * FROM subscriptions WHERE id = ?', id), 'the removed row was edited').toEqual(before);
    expect(db.rows('SELECT id FROM price_change'), 'a price step was logged for a removed row').toHaveLength(0);
  });

  // Red control for the up-front refusal ALONE (the write's WHERE still holds):
  // without it the body is judged against a row nobody can see, and a bad
  // category answers 400 — telling the caller the row is there.
  it('is refused BEFORE the body is judged against it: a bad category_id is still a 404', async () => {
    const id = await create();
    await subs(U, `/v1/subscriptions/${id}`, { method: 'DELETE' });
    const res = await patch(id, { category_id: 'nope' });
    expect(res.status, 'a removed row answered as if it were there').toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
  });

  it('a status change is refused the same way', async () => {
    const id = await create();
    await patch(id, { deleted_at: new Date().toISOString() });
    expect((await patch(id, { status: 'paused' })).status).toBe(404);
    expect(db.rows('SELECT status FROM subscriptions WHERE id = ?', id)).toEqual([{ status: 'active' }]);
  });

  it('the Undo is the one PATCH a removed row takes', async () => {
    const id = await create();
    await subs(U, `/v1/subscriptions/${id}`, { method: 'DELETE' });
    const res = await patch(id, { deleted_at: null });
    expect(res.status).toBe(200);
    expect(((await res.json()) as Row).deleted_at).toBeNull();
    expect((await patch(id, { price: 999 })).status, 'a restored row is editable again').toBe(200);
  });

  it('a DELETE landing between the ownership read and the write is not edited through', async () => {
    const id = await create();
    // The race, made deterministic: the row is removed the moment the route
    // has read it as live, so only the write's own WHERE can refuse the edit.
    const racing = new Proxy(db, {
      get(target, prop, receiver) {
        if (prop !== 'prepare') return Reflect.get(target, prop, receiver);
        return (sql: string) => {
          const stmt = target.prepare(sql);
          if (!/^SELECT id, deleted_at FROM subscriptions/.test(sql)) return stmt;
          return {
            bind: (...args: unknown[]) => ({
              first: async () => {
                const seen = await stmt.bind(...args).first();
                target.db.exec(`UPDATE subscriptions SET deleted_at = '${new Date().toISOString()}' WHERE id = '${id}'`);
                return seen;
              },
            }),
          };
        };
      },
    });
    const loser = asUser(subscriptions, '/v1/subscriptions', { APP_DB: racing as never });
    const res = await loser(U, `/v1/subscriptions/${id}`, { method: 'PATCH', body: { name: 'Late', price: 999 } });
    expect(res.status).toBe(404);
    expect(db.rows('SELECT name, price FROM subscriptions WHERE id = ?', id)).toEqual([{ name: 'Netflix', price: 649 }]);
    expect(db.rows('SELECT id FROM price_change')).toHaveLength(0);
  });
});

describe('minor 2 — the cancel date is set on the TRANSITION into cancelled, and kept after', () => {
  // Red control: date a dateless cancel as today whatever the row holds (the
  // old `validate` rule) — every "keeps" assertion below reads today instead.
  it('re-sending status: cancelled keeps the original date', async () => {
    const id = await create();
    await patch(id, { status: 'cancelled', cancelled_on: '2026-09-01' });
    const again = (await (await patch(id, { status: 'cancelled' })).json()) as Row;
    expect(again.cancelled_on, 'the re-sent cancel re-dated the row to today').toBe('2026-09-01');
  });

  it('…and so does re-sending it with an explicit null date', async () => {
    const id = await create();
    await patch(id, { status: 'cancelled', cancelled_on: '2026-09-01' });
    const again = (await (await patch(id, { status: 'cancelled', cancelled_on: null })).json()) as Row;
    expect(again.cancelled_on).toBe('2026-09-01');
  });

  it('a row cancelled by a dateless PATCH on an earlier day keeps that day', async () => {
    const id = await create();
    await patch(id, { status: 'cancelled' });
    db.db.exec(`UPDATE subscriptions SET cancelled_on = '2026-08-15' WHERE id = '${id}'`);
    await patch(id, { status: 'cancelled', name: 'Netflix Premium' });
    expect(db.rows('SELECT cancelled_on FROM subscriptions WHERE id = ?', id)).toEqual([{ cancelled_on: '2026-08-15' }]);
  });

  it('an explicit date on a cancelled row is the user correcting it, and is written', async () => {
    const id = await create();
    await patch(id, { status: 'cancelled', cancelled_on: '2026-09-01' });
    const fixed = (await (await patch(id, { status: 'cancelled', cancelled_on: '2026-08-30' })).json()) as Row;
    expect(fixed.cancelled_on).toBe('2026-08-30');
  });

  it('paused → cancelled is a transition, and is dated today', async () => {
    const id = await create();
    await patch(id, { status: 'paused' });
    const out = (await (await patch(id, { status: 'cancelled' })).json()) as Row;
    expect(out.cancelled_on).toBe(todayYmd());
  });

  it('a row CREATED cancelled with no date is dated today', async () => {
    const res = await subs(U, '/v1/subscriptions', { method: 'POST', body: { name: 'Old gym', status: 'cancelled' } });
    expect(res.status).toBe(201);
    expect(((await res.json()) as Row).cancelled_on).toBe(todayYmd());
  });
});

describe('minor 3 — a failed purge reaches the error sink, not only the log', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // Red control: delete the `reportWorkerError` call from GET /'s catch (the
  // `console.error` alone, as #1063 shipped it) — nothing is sent.
  it('the list still loads, and ONE envelope naming this Worker and the route goes to GlitchTip', async () => {
    const sent: Array<{ url: string; body: string }> = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      sent.push({ url: String(url), body: String(init.body) });
      return new Response('', { status: 200 });
    });
    const reporting = asUser(subscriptions, '/v1/subscriptions', {
      APP_DB: db as never,
      GLITCHTIP_DSN: 'https://abc123@glitchtip.example.test/7',
      RELEASE: 'sha-purge',
    });
    const id = await create();
    db.batch = async () => {
      throw new Error('D1_ERROR: simulated purge failure');
    };

    const res = await reporting(U, '/v1/subscriptions?email=a@b.test');
    expect(res.status).toBe(200);
    expect(((await res.json()) as Row[]).map((r) => r.id)).toEqual([id]);
    expect(sent, 'the purge failure reached console.error and nothing else').toHaveLength(1);
    expect(sent[0]?.url).toBe('https://glitchtip.example.test/api/7/envelope/');
    expect(sent[0]?.body).toContain('"server_name":"subscriptiontracker-api"');
    expect(sent[0]?.body).toContain('"release":"sha-purge"');
    expect(sent[0]?.body).toContain('"transaction":"GET /v1/subscriptions"');
    expect(sent[0]?.body).toContain('simulated purge failure');
    expect(sent[0]?.body, 'the query string reached the sink').not.toContain('email=');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Independent review of #1089 — finding 1 (a repeated removal is idempotent),
// finding 2 (a date cleared alone) and nit 5 (the `waitUntil` hand-off). Each
// block names its red control.
// ─────────────────────────────────────────────────────────────────────────────

/** The production transient, verbatim (services/_shared/test/d1-retry.test.ts). */
const RESET = 'D1_ERROR: D1 DB storage operation exceeded timeout which caused object to be reset.';

/** A db whose first run of a statement matching [sql] COMMITS and then throws
 *  the transient: the acknowledgement lost after the write landed, which is
 *  the exact window `run()` retries into. */
function commitThenReset(sql: RegExp) {
  let tripped = false;
  return new Proxy(db, {
    get(target, prop, receiver) {
      if (prop !== 'prepare') return Reflect.get(target, prop, receiver);
      return (text: string) => {
        const stmt = target.prepare(text);
        if (!sql.test(text)) return stmt;
        return {
          bind: (...args: unknown[]) => {
            const bound = stmt.bind(...args);
            return {
              run: async () => {
                const out = await bound.run();
                if (!tripped) {
                  tripped = true;
                  throw new Error(RESET);
                }
                return out;
              },
            };
          },
        };
      };
    },
  });
}

describe('review of #1089, finding 1 — removing a row twice is a 200, not a failed delete', () => {
  // Red control: drop `removing` from the target (so its write is limited to
  // live rows again) — `run()`'s retry of the committed UPDATE matches nothing,
  // and a delete that landed answers 404.
  it('a D1 reset after the removal committed: the retry answers 200 and the stamp is the first', async () => {
    const id = await create();
    const flaky = asUser(subscriptions, '/v1/subscriptions', {
      APP_DB: commitThenReset(/^UPDATE subscriptions SET deleted_at/) as never,
    });
    const res = await flaky(U, `/v1/subscriptions/${id}`, {
      method: 'PATCH',
      body: { deleted_at: new Date().toISOString() },
    });
    expect(res.status, 'a committed removal was reported as a failure').toBe(200);
    const stamped = ((await res.json()) as Row).deleted_at as string;
    expect(stamped).not.toBeNull();
    expect(db.rows('SELECT deleted_at FROM subscriptions WHERE id = ?', id)).toEqual([{ deleted_at: stamped }]);
  });

  // Red control: refuse a delete-only body on a removed row (#1089's rule) —
  // device B's removal answers 404.
  it('two devices removing the same row both get 200, and the row keeps device A’s stamp', async () => {
    const id = await create();
    const a = await patch(id, { deleted_at: new Date().toISOString() });
    expect(a.status).toBe(200);
    const first = ((await a.json()) as Row).deleted_at;
    const updatedAt = db.rows('SELECT updated_at FROM subscriptions WHERE id = ?', id)[0]?.updated_at;
    const b = await patch(id, { deleted_at: '2026-12-31T00:00:00Z' });
    expect(b.status, 'the second device was told its delete failed').toBe(200);
    expect(((await b.json()) as Row).deleted_at).toBe(first);
    expect(db.rows('SELECT deleted_at, updated_at FROM subscriptions WHERE id = ?', id)).toEqual([
      { deleted_at: first, updated_at: updatedAt },
    ]);
  });

  // ⏱ 2026-10-01 (#1091 review nit) — THE updated_at RULE, both halves. The case
  // above proves a repeated removal leaves `updated_at` alone; it would pass just
  // the same if no removal ever moved it. A change moves it to the server's now;
  // a no-op does not. Red control: `updated_at = updated_at` for every removal —
  // the first removal and the Undo keep the creation stamp, and this fails.
  it('updated_at moves on the first removal and on the Undo, and not on a repeated removal', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-09-30T10:00:00.000Z'));
      const id = await create();
      const stamp = () => db.rows('SELECT updated_at FROM subscriptions WHERE id = ?', id)[0]?.updated_at as string;
      const created = stamp();
      vi.setSystemTime(new Date('2026-09-30T11:00:00.000Z'));
      expect((await patch(id, { deleted_at: new Date().toISOString() })).status).toBe(200);
      const removed = stamp();
      expect(removed, 'the first removal changed the row and did not move updated_at').not.toBe(created);
      expect(Date.parse(removed)).toBe(Date.parse('2026-09-30T11:00:00.000Z'));
      vi.setSystemTime(new Date('2026-09-30T12:00:00.000Z'));
      expect((await patch(id, { deleted_at: new Date().toISOString() })).status).toBe(200);
      expect(stamp(), 'a repeated removal changed nothing and must not move updated_at').toBe(removed);
      vi.setSystemTime(new Date('2026-09-30T13:00:00.000Z'));
      expect((await patch(id, { deleted_at: null })).status).toBe(200);
      expect(Date.parse(stamp()), 'the Undo changed the row and did not move updated_at').toBe(Date.parse('2026-09-30T13:00:00.000Z'));
    } finally {
      vi.useRealTimers();
    }
  });

  // Red control: as the first test — a write limited to live rows matches
  // nothing once the other device's removal lands between read and write.
  it('a removal racing another device’s (removed between the read and the write) is a 200 and keeps that stamp', async () => {
    const id = await create();
    const otherStamp = '2026-09-30T00:00:00.000Z';
    const racing = new Proxy(db, {
      get(target, prop, receiver) {
        if (prop !== 'prepare') return Reflect.get(target, prop, receiver);
        return (sql: string) => {
          const stmt = target.prepare(sql);
          if (!/^SELECT id, deleted_at FROM subscriptions/.test(sql)) return stmt;
          return {
            bind: (...args: unknown[]) => ({
              first: async () => {
                const seen = await stmt.bind(...args).first();
                target.db.exec(`UPDATE subscriptions SET deleted_at = '${otherStamp}' WHERE id = '${id}'`);
                return seen;
              },
            }),
          };
        };
      },
    });
    const late = asUser(subscriptions, '/v1/subscriptions', { APP_DB: racing as never });
    const res = await late(U, `/v1/subscriptions/${id}`, {
      method: 'PATCH',
      body: { deleted_at: new Date().toISOString() },
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as Row).deleted_at).toBe(otherStamp);
  });

  // Red control: count any body carrying a non-null `deleted_at` as a removal
  // (drop the one-key test) — the rename rides in on a removed row.
  it('an EDIT on a removed row is still a 404, even when it re-sends deleted_at beside it', async () => {
    const id = await create();
    await patch(id, { deleted_at: new Date().toISOString() });
    const before = db.rows('SELECT * FROM subscriptions WHERE id = ?', id);
    const res = await patch(id, { deleted_at: new Date().toISOString(), name: 'Renamed', price: 999 });
    expect(res.status, 'a removed row took an edit').toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
    expect(db.rows('SELECT * FROM subscriptions WHERE id = ?', id)).toEqual(before);
    expect(db.rows('SELECT id FROM price_change')).toHaveLength(0);
  });

  it('removing a row that is not yours, or that was purged, is still a 404', async () => {
    const id = await create();
    const notYours = await subs('user-b', `/v1/subscriptions/${id}`, {
      method: 'PATCH',
      body: { deleted_at: new Date().toISOString() },
    });
    expect(notYours.status).toBe(404);
    db.db.exec(`DELETE FROM subscriptions WHERE id = '${id}'`);
    expect((await patch(id, { deleted_at: new Date().toISOString() })).status).toBe(404);
  });
});

describe('review of #1089, finding 2 — clearing the cancel date alone cannot leave a cancelled row undated', () => {
  // Red control: write `cancelled_on = ?` (null) for a lone `{cancelled_on: null}`,
  // as #1089 did — the cancelled row is stored with no date.
  it('a cancelled row keeps its date', async () => {
    const id = await create();
    await patch(id, { status: 'cancelled', cancelled_on: '2026-09-01' });
    const res = await patch(id, { cancelled_on: null });
    expect(res.status).toBe(200);
    expect(((await res.json()) as Row).cancelled_on, 'a cancelled row lost its date').toBe('2026-09-01');
    expect(db.rows('SELECT status, cancelled_on FROM subscriptions WHERE id = ?', id)).toEqual([
      { status: 'cancelled', cancelled_on: '2026-09-01' },
    ]);
  });

  it('a legacy cancelled row with no date is dated today', async () => {
    const id = await create();
    await patch(id, { status: 'cancelled' });
    db.db.exec(`UPDATE subscriptions SET cancelled_on = NULL WHERE id = '${id}'`);
    expect(((await (await patch(id, { cancelled_on: null })).json()) as Row).cancelled_on).toBe(todayYmd());
  });

  // Red control: keep the date whatever the status (drop the CASE's ELSE NULL)
  // — a stale date stays on a row that is not cancelled.
  it('a row that is NOT cancelled is cleared, as asked', async () => {
    const id = await create();
    db.db.exec(`UPDATE subscriptions SET cancelled_on = '2026-08-01' WHERE id = '${id}'`);
    expect(((await (await patch(id, { cancelled_on: null })).json()) as Row).cancelled_on).toBeNull();
  });

  it('moving away from cancelled with a null date still clears it', async () => {
    const id = await create();
    await patch(id, { status: 'cancelled', cancelled_on: '2026-09-01' });
    const out = (await (await patch(id, { status: 'active', cancelled_on: null })).json()) as Row;
    expect(out).toMatchObject({ status: 'active', cancelled_on: null });
  });
});

describe('review of #1089, nit 5 — the purge report is handed to waitUntil', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // Red control: delete `c.executionCtx.waitUntil(report)` from GET /'s catch.
  // The report is still sent (fetch runs before its first await), so minor 3's
  // test stays green, but nothing keeps the Worker alive to finish it.
  it('the report promise goes to the execution context, and resolves as delivered', async () => {
    let sent = 0;
    vi.stubGlobal('fetch', async () => {
      sent++;
      return new Response('', { status: 200 });
    });
    const handed: Promise<unknown>[] = [];
    const ctx = {
      waitUntil: (p: Promise<unknown>) => {
        handed.push(p);
      },
      passThroughOnException: () => {},
      props: {},
    } as unknown as ExecutionContext;
    const reporting = asUser(
      subscriptions,
      '/v1/subscriptions',
      { APP_DB: db as never, GLITCHTIP_DSN: 'https://abc123@glitchtip.example.test/7', RELEASE: 'sha-wait' },
      ctx,
    );
    await create();
    db.batch = async () => {
      throw new Error('D1_ERROR: simulated purge failure');
    };

    const res = await reporting(U, '/v1/subscriptions');
    expect(res.status).toBe(200);
    expect(handed, 'the report was never handed to waitUntil').toHaveLength(1);
    expect(await handed[0]).toBe(true);
    expect(sent).toBe(1);
  });
});
