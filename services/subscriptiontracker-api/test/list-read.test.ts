// ─────────────────────────────────────────────────────────────────────────────
// Train T11 · SV-01 — GET /v1/subscriptions is ONE statement.
//
// The list ran `purgeExpired` — a 3-statement DELETE batch over payment_history,
// price_change and subscriptions — before its SELECT, on every call: the read
// every app open makes cost four statements, three of them writes. The purge is
// the platform Worker's nightly limb now (services/platform/src/subscription-
// housekeeping.ts `purgeSoftDeleted`, tested in services/platform/test/
// subscription-housekeeping.test.ts).
//
// THE STUB COUNTS EXECUTIONS, NOT PREPARES: every `.all/.first/.run` is one
// statement, and every statement inside a `.batch` is one more — the
// worst-case reading tooling/ceilings.json's d1.queriesPerInvocation uses.
//
// RED CONTROL: put the purge back ahead of the SELECT (the tree before this
// change) — the count is 4 and a batch was sent.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from 'vitest';
import subscriptions from '../src/routes/subscriptions';
import { realAppDb, asUser, type SqliteD1 } from './harness';

const U = 'user-a';

/** Wrap [db] so every statement it EXECUTES is counted, batched or not. */
function counting(db: SqliteD1) {
  const seen = { statements: 0, batches: 0, sql: [] as string[] };
  const wrap = (stmt: ReturnType<SqliteD1['prepare']>, sql: string): unknown =>
    new Proxy(stmt, {
      get(target, prop, receiver) {
        if (prop === 'bind') return (...args: unknown[]) => wrap(target.bind(...args), sql);
        if (prop === 'all' || prop === 'first' || prop === 'run') {
          return (...args: unknown[]) => {
            seen.statements++;
            seen.sql.push(sql);
            return (target as unknown as Record<string, (...a: unknown[]) => unknown>)[prop](...args);
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    });
  const stub = new Proxy(db, {
    get(target, prop, receiver) {
      if (prop === 'prepare') return (sql: string) => wrap(target.prepare(sql), sql);
      if (prop === 'batch') {
        return (statements: unknown[]) => {
          seen.batches++;
          seen.statements += statements.length;
          return target.batch(statements as never);
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  });
  return { stub, seen };
}

describe('SV-01 — a list read is one SELECT and no write', () => {
  it('GET /v1/subscriptions executes exactly ONE statement, and sends no batch', async () => {
    const db = realAppDb();
    // Something to purge, had the route still purged: a row removed 40 days ago.
    db.db.exec(
      `INSERT INTO subscriptions (id, user_id, name, deleted_at)
       VALUES ('old', '${U}', 'Old', '${new Date(Date.now() - 40 * 86_400_000).toISOString()}'),
              ('live', '${U}', 'Live', NULL)`,
    );
    const { stub, seen } = counting(db);
    const subs = asUser(subscriptions, '/v1/subscriptions', { APP_DB: stub as never });

    const res = await subs(U, '/v1/subscriptions');
    expect(res.status).toBe(200);
    expect(((await res.json()) as Array<{ id: string }>).map((r) => r.id)).toEqual(['live']);
    expect(seen.batches, `the list sent a batch: ${seen.sql.join(' | ')}`).toBe(0);
    expect(seen.statements, seen.sql.join(' | ')).toBe(1);
    expect(seen.sql[0]).toMatch(/^SELECT \* FROM subscriptions WHERE user_id = \? AND deleted_at IS NULL/);
    // …and the row the old purge would have removed is still there for the
    // nightly limb, which is the only writer that removes it now.
    expect(db.rows("SELECT id FROM subscriptions WHERE id = 'old'")).toHaveLength(1);
  });

  it('control: the counter sees a batch when one is sent (a price-moving PATCH sends two statements)', async () => {
    const db = realAppDb();
    db.db.exec(`INSERT INTO subscriptions (id, user_id, name, price) VALUES ('s', '${U}', 'S', 1)`);
    const { stub, seen } = counting(db);
    const subs = asUser(subscriptions, '/v1/subscriptions', { APP_DB: stub as never });
    const res = await subs(U, '/v1/subscriptions/s', { method: 'PATCH', body: { price: 2 } });
    expect(res.status).toBe(200);
    expect(seen.batches).toBe(1);
    expect(seen.statements).toBeGreaterThanOrEqual(3);
  });
});
