// ─────────────────────────────────────────────────────────────────────────────
// conformance/sql.ts — WHAT ANY `SqlDb` MUST DO. tooling/ports/sql.json names
// this file as its suite and `runSqlConformance` as the runner; each adapter's
// conformance test CALLS the runner (assert-ports limb 6). Against the sqlite
// engine (ports/fakes/sql.ts) it runs in every Worker's `npm test`
// (services/_shared/test/ports-sql.test.ts). Against the D1 binding it is
// PENDING in the registry: no Worker suite runs on workerd (no Miniflare, no
// @cloudflare/vitest-pool-workers), so D1's own answer is the live check
// tooling/ops/check-d1-accepts-live-sql.mjs, which grades statement SHAPES and
// none of the scenarios below.
//
// The scenarios are what this portfolio relies on: prepare, bind, first, all,
// run and batch answer in D1's shape; `bind` returns a NEW statement (the events
// route and the budget replace bind one statement many times in one batch); an
// `undefined` bind is REFUSED (D1_TYPE_ERROR) and writes nothing; the engine's
// own UNIQUE failure is CLASSIFIED as one (`run`'s retry rests on it); a
// transient reset is retried and the engine's own deterministic failure is NOT;
// and `batch` is ATOMIC — one failing statement rolls the rest back.
//
// 🔴 THE ERROR WORDING (trap auth-01). The classifier reads WORDS, so a case that
// stubs an error proves only what its stub says. The transient case therefore
// injects workerd's production wire text VERBATIM (services/_shared/src/d1.ts
// header, the GlitchTip event of 2026-08-29), and the unique and deterministic
// cases classify the ENGINE'S OWN rejection — never a hand-made one. The
// classifier's negative cases stay in services/_shared/test/d1-retry.test.ts.
// ─────────────────────────────────────────────────────────────────────────────
import type { SqlDb, SqlResult, SqlStatement } from '../../src/ports/sql';
import { isTransientD1Error, isUniqueViolation, withD1Retry } from '../../src/ports/sql';
import { missingFixture, same, type Register } from './check';

/** The schema every scenario runs against, one statement per migration. */
export const SQL_CONFORMANCE_SCHEMA: readonly string[] = [
  'CREATE TABLE items (id TEXT PRIMARY KEY, n INTEGER NOT NULL, note TEXT)',
];

/** The production message of a D1 Durable Object reset, as workerd threw it —
 *  the FULL wire text, not the substring the classifier looks for. */
export const D1_TRANSIENT_WIRE_TEXT = 'D1_ERROR: D1 DB storage operation exceeded timeout which caused object to be reset.';

/** A fresh database with SQL_CONFORMANCE_SCHEMA applied. */
export interface SqlSubject {
  db: SqlDb;
}

export interface SqlFixture {
  /** The registry's adapter id. */
  adapter: string;
  /** A fresh database with `schema` applied, in order. */
  make(schema: readonly string[]): SqlSubject | Promise<SqlSubject>;
}

interface Scenario {
  name: string;
  run(s: SqlSubject, adapter: string): Promise<void>;
}

/** The rejection `op` produces — thrown synchronously (at `bind`) or as a rejected promise. */
async function rejection(op: () => Promise<unknown>, what: string): Promise<unknown> {
  try {
    await op();
  } catch (err) {
    return err;
  }
  throw new Error(`${what}: expected a rejection, got a value`);
}

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));

async function count(db: SqlDb): Promise<number> {
  const row = await db.prepare('SELECT COUNT(*) AS c FROM items').first<{ c: number }>();
  return Number(row?.c);
}

const insert = (db: SqlDb, id: unknown, n: unknown): SqlStatement => db.prepare('INSERT INTO items (id, n) VALUES (?, ?)').bind(id, n);

/**
 * A view of `db` whose next `times` statement executions (or batches) reject with
 * workerd's transient wire text, BEFORE reaching the engine; every later one is
 * the engine. The counter is on the view, not the statement, because
 * `withD1Retry` re-invokes the SAME statement.
 */
export function withTransientResets(db: SqlDb, times: number): { db: SqlDb; injected: () => number } {
  let left = times;
  let injected = 0;
  const strike = (): void => {
    if (left > 0) {
      left--;
      injected++;
      throw new Error(D1_TRANSIENT_WIRE_TEXT);
    }
  };
  const inner = new WeakMap<object, SqlStatement>();
  const wrap = (stmt: SqlStatement): SqlStatement => {
    const view: SqlStatement = {
      bind: (...values: unknown[]) => wrap(stmt.bind(...values)),
      first: async <T>() => (strike(), stmt.first<T>()),
      all: async <T>() => (strike(), stmt.all<T>()),
      run: async <T>() => (strike(), stmt.run<T>()),
    };
    inner.set(view, stmt);
    return view;
  };
  return {
    db: {
      prepare: (sql: string) => wrap(db.prepare(sql)),
      batch: async <T>(statements: SqlStatement[]): Promise<SqlResult<T>[]> => {
        strike();
        return db.batch<T>(statements.map((s) => inner.get(s) ?? s));
      },
    },
    injected: () => injected,
  };
}

export const SQL_SCENARIOS: readonly Scenario[] = [
  {
    name: 'prepare-bind-first',
    async run({ db }) {
      await insert(db, 'a', 1).run();
      same(await db.prepare('SELECT id, n FROM items WHERE id = ?').bind('a').first(), { id: 'a', n: 1 }, 'first() of a bound read');
      same(await db.prepare('SELECT id FROM items WHERE id = ?').bind('absent').first(), null, 'first() of no row is null');
    },
  },
  {
    name: 'all-returns-rows',
    async run({ db }) {
      for (const [id, n] of [['b', 2], ['a', 1], ['c', 3]] as const) await insert(db, id, n).run();
      const r = await db.prepare('SELECT id, n FROM items WHERE n >= ? ORDER BY id').bind(2).all<{ id: string; n: number }>();
      same(r.results, [{ id: 'b', n: 2 }, { id: 'c', n: 3 }], 'all() answers every matching row, in the order asked');
      same((await db.prepare('SELECT id FROM items WHERE n > 99').all()).results, [], 'all() of no row is an empty array');
    },
  },
  {
    name: 'run-reports-changes',
    async run({ db }) {
      for (const id of ['a', 'b', 'c']) await insert(db, id, 1).run();
      const r = await db.prepare('UPDATE items SET n = n + 1 WHERE id <> ?').bind('a').run();
      same(r.meta.changes, 2, 'run() meta.changes of an UPDATE that touched two rows');
      same(Array.isArray(r.results), true, 'run() carries a results array');
      same((await db.prepare('DELETE FROM items WHERE id = ?').bind('absent').run()).meta.changes, 0, 'a DELETE of nothing changes nothing');
    },
  },
  {
    name: 'bind-returns-a-new-statement',
    async run({ db }) {
      const stmt = db.prepare('INSERT INTO items (id, n) VALUES (?, ?)');
      await db.batch([stmt.bind('a', 1), stmt.bind('b', 2)]);
      same((await db.prepare('SELECT id, n FROM items ORDER BY id').all()).results, [{ id: 'a', n: 1 }, { id: 'b', n: 2 }], 'one statement bound twice wrote two rows');
    },
  },
  {
    name: 'batch-answers-in-order',
    async run({ db }) {
      const out = await db.batch([insert(db, 'a', 1), insert(db, 'b', 2), db.prepare('SELECT id FROM items ORDER BY id')]);
      same(out.length, 3, 'one result per statement');
      same(out.map((r) => r.meta.changes).slice(0, 2), [1, 1], 'each write reports its own change');
      same(out[2].results, [{ id: 'a' }, { id: 'b' }], 'a batched read answers its rows, after the writes before it');
    },
  },
  {
    name: 'undefined-bind-is-refused',
    async run({ db }) {
      const err = await rejection(() => db.prepare('INSERT INTO items (id, n, note) VALUES (?, ?, ?)').bind('a', 1, undefined).run(), 'a run with an undefined bind');
      if (!/D1_TYPE_ERROR/.test(message(err))) throw new Error(`an undefined bind must be refused as D1_TYPE_ERROR, got: ${message(err)}`);
      same(await count(db), 0, 'the refused statement wrote nothing');
    },
  },
  {
    name: 'unique-violation-is-classified',
    async run({ db }) {
      await insert(db, 'a', 1).run();
      const err = await rejection(() => insert(db, 'a', 2).run(), 'a second insert of the same primary key');
      same(isUniqueViolation(err), true, `the engine's own UNIQUE failure is a unique violation (${message(err)})`);
      same(isTransientD1Error(err), false, `the engine's own UNIQUE failure is never transient (${message(err)})`);
      same(await db.prepare('SELECT n FROM items WHERE id = ?').bind('a').first(), { n: 1 }, 'the first row stands');
    },
  },
  {
    name: 'transient-error-is-retried',
    async run({ db }) {
      await insert(db, 'a', 1).run();
      const flaky = withTransientResets(db, 1);
      const retried: unknown[] = [];
      const row = await withD1Retry(() => flaky.db.prepare('SELECT n FROM items WHERE id = ?').bind('a').first(), { delayMs: 0, onRetry: (e) => void retried.push(e) });
      same(flaky.injected(), 1, 'the reset was injected');
      same(retried.length, 1, 'the reset was retried once');
      same(row, { n: 1 }, 'the retry answered from the engine');
      const batchFlaky = withTransientResets(db, 1);
      await withD1Retry(() => batchFlaky.db.batch([insert(batchFlaky.db, 'b', 2)]), { delayMs: 0 });
      same(await count(db), 2, 'a batch struck by a reset is re-sent whole, once');
    },
  },
  {
    name: 'deterministic-error-is-not-retried',
    async run({ db }) {
      let attempts = 0;
      const err = await rejection(
        () => withD1Retry(() => (attempts++, db.prepare('SELECT nope FROM items').all()), { delayMs: 0, attempts: 3 }),
        'a statement naming a column the schema does not have',
      );
      same(attempts, 1, `the engine's own deterministic failure is sent once, never retried (${message(err)})`);
      same(isTransientD1Error(err), false, `the engine's own deterministic failure is not transient (${message(err)})`);
    },
  },
  {
    name: 'batch-is-atomic',
    async run({ db }) {
      await insert(db, 'a', 1).run();
      const err = await rejection(() => db.batch([insert(db, 'b', 2), db.prepare('UPDATE items SET n = 9 WHERE id = ?').bind('a'), insert(db, 'a', 3)]), 'a batch whose last statement collides');
      same(isUniqueViolation(err), true, `the batch failed on its collision (${message(err)})`);
      same(await count(db), 1, 'the insert before the failing statement was rolled back');
      same(await db.prepare('SELECT n FROM items WHERE id = ?').bind('a').first(), { n: 1 }, 'the update before the failing statement was rolled back');
    },
  },
];

/** Register every scenario for `fixture` with `it`. A fixture that cannot make a database FAILS every scenario. */
export function runSqlConformance(fixture: SqlFixture, it: Register): void {
  for (const sc of SQL_SCENARIOS) {
    it(`${fixture.adapter} · sql · ${sc.name}`, async () => {
      const subject = await fixture.make(SQL_CONFORMANCE_SCHEMA);
      if (!subject?.db) throw missingFixture('sql', fixture.adapter, sc.name, 'a database with the conformance schema');
      return sc.run(subject, fixture.adapter);
    });
  }
}
