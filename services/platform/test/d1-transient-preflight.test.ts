// ─────────────────────────────────────────────────────────────────────────────
// THE ERASURE PREFLIGHT SURVIVES ONE TRANSIENT D1 RESET — and still refuses a
// deterministic one.
//
// 🔬 THE DEFECT THIS FILE IS BORN FROM. `src/lib/d1.ts` has carried a correct,
// narrow retry since 2026-09-02, and its message list names the fault measured
// in production verbatim:
//
//     D1_ERROR: D1 DB storage operation exceeded timeout which caused object to
//     be reset.
//
// This route did not call it. `columnsMatching` issued its two schema reads as
// bare `db.prepare(...).all()`, and `src/index.ts` imports only `nowIso` from
// `./lib/d1`, so the helper was not even in scope here. One DO reset during the
// preflight therefore turned an erasure into `503 account_deletion_failed`.
//
// ⚠️ AND ON THIS WORKER THE BLAST RADIUS IS LARGER THAN ONE REQUEST. This is the
// portfolio's erasure ENTRY POINT: the preflight runs before the service-role
// limb, before the relay to every app's own route and before the identity
// delete, so a reset here refuses the whole four-limb erasure — which is the
// correct behaviour for a REAL failure and pure loss for a fault that resolves
// in milliseconds.
//
// 🔴 WHAT MAKES THIS TEST WORTH KEEPING. It was run against the UNWRAPPED route
// first and went RED, so it measures the wiring rather than describing it. And
// it asserts the fault ACTUALLY FIRED (`injected`) — a fault injector whose
// predicate stopped matching would leave a green test that exercises nothing.
//
// ⚠️ THE NEGATIVE CASE IS HALF THE POINT. A helper that retried everything would
// turn a deterministic failure into a SLOW deterministic failure, so the
// deterministic case asserts the statement was sent EXACTLY ONCE.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, vi, afterEach } from 'vitest';
import { Hono } from 'hono';
import account from '../src/routes/account';
import type { AppEnv } from '../src/types';
import { realPlatformDb, type RealDb } from './harness';

/** The production message, copied from the GlitchTip event named in lib/d1.ts.
 *  Deliberately the FULL wire text, not the substring the matcher looks for. */
const TRANSIENT =
  'D1_ERROR: D1 DB storage operation exceeded timeout which caused object to be reset.';

/** A failure D1 will return identically every time. Retrying it is pure delay. */
const DETERMINISTIC = 'D1_ERROR: no such column: definitely_not_a_column';

const SUBJECT = 'u-erasure-s72';
const BYSTANDER = 'u-bystander-s72';

const ENV = {
  APP_ID: 'platform',
  SUPABASE_URL: 'https://project.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-test-key',
  APP_ERASURE_ENDPOINTS: 'subly=https://api.nikatru.com',
};

/**
 * Wraps a real database and makes the FIRST `n` executions of any statement
 * matching `failWhen` throw. Everything else is the real engine.
 *
 * The counter lives on the WRAPPER, not on the statement, because that is the
 * shape the retry has to survive: `withD1Retry` re-invokes `.all()` on the SAME
 * prepared statement, so a per-statement counter would make the retry succeed
 * for the wrong reason.
 */
class FlakyD1 {
  /** Executions of a MATCHING statement, thrown or not. */
  calls = 0;
  /** Executions this injector actually failed. Zero means the test is vacuous. */
  injected = 0;
  private remaining: number;

  constructor(
    private readonly inner: RealDb,
    private readonly failWhen: RegExp,
    private readonly message: string,
    times = 1,
  ) {
    this.remaining = times;
  }

  prepare(sql: string) {
    const stmt = this.inner.prepare(sql);
    if (!this.failWhen.test(sql)) return stmt;
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    return {
      bind: (...args: unknown[]) => stmt.bind(...args),
      async all<T = Record<string, unknown>>(): Promise<{ results: T[] }> {
        self.calls++;
        if (self.remaining > 0) {
          self.remaining--;
          self.injected++;
          throw new Error(self.message);
        }
        return stmt.all<T>();
      },
      first: <T = Record<string, unknown>>() => stmt.first<T>(),
      run: () => stmt.run(),
    };
  }

  batch(statements: unknown[]) {
    return this.inner.batch(statements as never);
  }
}

/** Drive the REAL route, exactly as erasure-derivation.test.ts does. */
async function erase(db: unknown) {
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => {
    c.set('userId', SUBJECT);
    c.set('requestId', 'test-s72');
    await next();
  });
  app.route('/v1', account);
  const res = await app.request(
    'http://x/v1/account',
    { method: 'DELETE', headers: { Authorization: 'Bearer test' } },
    { ...ENV, PLATFORM_DB: db } as unknown as AppEnv['Bindings'],
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

afterEach(() => vi.unstubAllGlobals());

/** Both outbound hops answer OK: the app relay, then the GoTrue identity delete. */
function stubHops() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })),
  );
}

/** One entitlement for the person asking to be erased, one for somebody else. */
function seeded(): RealDb {
  const db = realPlatformDb();
  db.db.exec(
    `INSERT INTO entitlements (user_id, app_id, entitlement, is_active)
       VALUES ('${SUBJECT}','subly','pro',1), ('${BYSTANDER}','subly','pro',1)`,
  );
  return db;
}

/** The property the bug cannot rename: whose rows are left in the table. */
const remaining = (db: RealDb) =>
  db.rows('SELECT user_id FROM entitlements ORDER BY user_id').map((r) => r.user_id);

describe('DELETE /v1/account survives a transient D1 reset in the preflight', () => {
  it('🔴 one reset on the sqlite_master read does NOT fail the erasure', async () => {
    stubHops();
    const db = seeded();
    const flaky = new FlakyD1(db, /sqlite_master/i, TRANSIENT);

    const { status, body } = await erase(flaky);

    // The injector really fired. Without this the assertions below would pass
    // against a predicate that had quietly stopped matching.
    expect(flaky.injected).toBe(1);
    expect(status).toBe(200);
    // Not the status alone: the ROWS. A 200 that erased nothing is the failure
    // this whole route was written to make impossible.
    expect(remaining(db)).toEqual([BYSTANDER]);
    // …and the erasure ran to its END, which a preflight throw would have
    // prevented: limb 3 relayed and the identity was deleted last.
    expect((body.apps as Record<string, string>).subly).toBe('deleted');
    expect((body.deleted as Record<string, number>).identity).toBe(1);
  });

  it('🔴 one reset on the pragma_table_info read does NOT fail the erasure', async () => {
    stubHops();
    const db = seeded();
    const flaky = new FlakyD1(db, /pragma_table_info/i, TRANSIENT);

    const { status } = await erase(flaky);

    expect(flaky.injected).toBe(1);
    expect(status).toBe(200);
    expect(remaining(db)).toEqual([BYSTANDER]);
  });

  it('a DETERMINISTIC failure is NOT retried — it is refused once, immediately', async () => {
    stubHops();
    const db = seeded();
    // `times` is high enough that a retry would be visible as a second call.
    const flaky = new FlakyD1(db, /sqlite_master/i, DETERMINISTIC, 5);

    const { status, body } = await erase(flaky);

    expect(status).toBe(503);
    expect(body.error).toBe('account_deletion_failed');
    // THE ASSERTION THAT MATTERS: one attempt, not two.
    expect(flaky.calls).toBe(1);
    // And it failed closed — nobody's rows were touched and no identity went.
    expect(remaining(db)).toEqual([SUBJECT, BYSTANDER].sort());
  });

  it('a reset on EVERY attempt still fails closed, rather than reporting success', async () => {
    stubHops();
    const db = seeded();
    const flaky = new FlakyD1(db, /sqlite_master/i, TRANSIENT, 99);

    const { status, body } = await erase(flaky);

    expect(status).toBe(503);
    expect(body.error).toBe('account_deletion_failed');
    // Two attempts total — the helper's documented default, exercised end to end
    // through the route rather than against the helper in isolation.
    expect(flaky.calls).toBe(2);
    expect(remaining(db)).toEqual([SUBJECT, BYSTANDER].sort());
  });
});
