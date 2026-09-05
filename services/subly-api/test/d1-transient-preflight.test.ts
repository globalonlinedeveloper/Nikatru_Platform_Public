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
// The erasure route did not call it. `columnsMatching` issued its two schema
// reads as bare `db.prepare(...).all()`, and `src/index.ts` imports only
// `nowIso` from `./lib/d1`, so the helper was not even in scope at the route.
// One DO reset during the preflight therefore turned an erasure into
// `503 account_deletion_failed` — the same red-night failure mode the helper
// exists to remove, in the one route that had not been wired to it.
//
// 🔴 WHAT MAKES THIS TEST WORTH KEEPING. It was run against the UNWRAPPED route
// first and went RED (200 → 503, and the subject's rows still in the table), so
// it measures the wiring rather than describing it. And it asserts the fault
// ACTUALLY FIRED (`injected`), because a fault injector whose predicate stops
// matching would leave a green test that exercises nothing — the exact shape of
// guard this repository keeps finding.
//
// ⚠️ AND THE NEGATIVE CASE IS HALF THE POINT. A helper that retried everything
// would turn a deterministic failure into a SLOW deterministic failure and burn
// the request's wall-clock budget on a database that is answering correctly. So
// the deterministic case asserts the statement was sent EXACTLY ONCE.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import account from '../src/routes/account';
import type { AppEnv } from '../src/types';
import { realAppDb, TEST_ENV, type SqliteD1 } from './harness';

/** The production message, copied from the GlitchTip event named in lib/d1.ts.
 *  Deliberately the FULL wire text, not the substring the matcher looks for —
 *  a matcher that only recognises its own excerpt is a matcher that never met
 *  a real error. */
const TRANSIENT =
  'D1_ERROR: D1 DB storage operation exceeded timeout which caused object to be reset.';

/** A failure D1 will return identically every time. Retrying it is pure delay. */
const DETERMINISTIC = 'D1_ERROR: no such column: definitely_not_a_column';

const SUBJECT = 'erasure-subject-s72';
const BYSTANDER = 'bystander-s72';

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
    private readonly inner: SqliteD1,
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

/** Drive the REAL route, exactly as erasure-derivation.test.ts does, so the
 *  preflight under test is the one that ships. */
async function erase(db: unknown, userId = SUBJECT) {
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => {
    c.set('userId', userId);
    c.set('tokenAssurance', 'asymmetric');
    c.set('requestId', 'test-s72');
    await next();
  });
  app.route('/v1', account);
  const res = await app.request(
    'http://x/v1/account',
    { method: 'DELETE' },
    { ...TEST_ENV, APP_DB: db } as unknown as AppEnv['Bindings'],
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

/** Two subscriptions: the person asking to be erased, and somebody else. */
function seeded(): SqliteD1 {
  const db = realAppDb();
  db.db.exec(
    `INSERT INTO subscriptions (id, user_id, name, price, cycle, next_renewal)
       VALUES ('s-subject','${SUBJECT}','Netflix',499,'monthly','2026-10-01'),
              ('s-other','${BYSTANDER}','Spotify',119,'monthly','2026-10-01')`,
  );
  return db;
}

/** The property the bug cannot rename: whose rows are left in the table. */
const remaining = (db: SqliteD1) =>
  db.rows('SELECT user_id FROM subscriptions ORDER BY user_id').map((r) => r.user_id);

describe('DELETE /v1/account survives a transient D1 reset in the preflight', () => {
  it('🔴 one reset on the sqlite_master read does NOT fail the erasure', async () => {
    const db = seeded();
    const flaky = new FlakyD1(db, /sqlite_master/i, TRANSIENT);

    const { status, body } = await erase(flaky);

    // The injector really fired. Without this the two assertions below would
    // pass against a predicate that had quietly stopped matching.
    expect(flaky.injected).toBe(1);
    expect(status).toBe(200);
    expect(body.scope).toBe('subly_db');
    // Not the status alone: the ROWS. A 200 that erased nothing is the failure
    // this whole route was written to make impossible.
    expect(remaining(db)).toEqual([BYSTANDER]);
  });

  it('🔴 one reset on the pragma_table_info read does NOT fail the erasure', async () => {
    const db = seeded();
    const flaky = new FlakyD1(db, /pragma_table_info/i, TRANSIENT);

    const { status } = await erase(flaky);

    expect(flaky.injected).toBe(1);
    expect(status).toBe(200);
    expect(remaining(db)).toEqual([BYSTANDER]);
  });

  it('a DETERMINISTIC failure is NOT retried — it is refused once, immediately', async () => {
    const db = seeded();
    // `times` is high enough that a retry would be visible as a second call.
    const flaky = new FlakyD1(db, /sqlite_master/i, DETERMINISTIC, 5);

    const { status, body } = await erase(flaky);

    expect(status).toBe(503);
    expect(body.error).toBe('account_deletion_failed');
    // THE ASSERTION THAT MATTERS: one attempt, not two. A broad retry here would
    // spend the request's budget re-asking a question already answered.
    expect(flaky.calls).toBe(1);
    // And it failed closed — nobody's rows were touched.
    expect(remaining(db)).toEqual([SUBJECT, BYSTANDER].sort());
  });

  it('a reset on EVERY attempt still fails closed, rather than reporting success', async () => {
    const db = seeded();
    const flaky = new FlakyD1(db, /sqlite_master/i, TRANSIENT, 99);

    const { status, body } = await erase(flaky);

    expect(status).toBe(503);
    expect(body.error).toBe('account_deletion_failed');
    // Two attempts total — the helper's documented default, exercised end to end
    // through the route rather than asserted against the helper in isolation.
    expect(flaky.calls).toBe(2);
    expect(remaining(db)).toEqual([SUBJECT, BYSTANDER].sort());
  });
});
