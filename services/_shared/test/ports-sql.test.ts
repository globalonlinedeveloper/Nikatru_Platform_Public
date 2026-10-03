import { describe, it, expect } from 'vitest';
import { SqliteDb, SqliteStatement, sqliteDb } from '../src/ports/fakes/sql';
import type { SqlResult, SqlStatement } from '../src/ports/sql';
import { SQL_SCENARIOS, runSqlConformance } from './conformance/sql';

// ─────────────────────────────────────────────────────────────────────────────
// ports-sql.test.ts — tooling/ports/sql.json adapter `sqlite`: the node:sqlite
// engine every Worker suite runs its SQL through passes the SQL conformance
// suite. The D1 binding's own run is PENDING in the registry (no Worker suite
// runs on workerd); this file is what makes the suite real, and the block below
// is what makes it able to FAIL.
// ─────────────────────────────────────────────────────────────────────────────

describe('sql port — the sqlite engine passes the conformance suite', () => {
  runSqlConformance({ adapter: 'sqlite', make: (schema) => ({ db: sqliteDb(schema) }) }, it);
});

describe('sql conformance — the runner can fail', () => {
  const collect = () => {
    const cases = new Map<string, () => Promise<void>>();
    return { cases, it: (name: string, run: () => Promise<void>) => void cases.set(name, run) };
  };

  it('registers every scenario', () => {
    const c = collect();
    runSqlConformance({ adapter: 'x', make: (schema) => ({ db: sqliteDb(schema) }) }, c.it);
    expect(c.cases.size).toBe(SQL_SCENARIOS.length);
  });

  it('🔴 a fixture that makes no database FAILS — a missing fixture is never a skip', async () => {
    const c = collect();
    runSqlConformance({ adapter: 'none', make: () => ({}) as never }, c.it);
    await expect(c.cases.get('none · sql · prepare-bind-first')!()).rejects.toThrow(/no fixture for scenario `prepare-bind-first`/);
  });

  it('🔴 an engine whose batch is NOT atomic fails `batch-is-atomic`', async () => {
    // The mutation the brief names: every statement runs on its own, no BEGIN, no ROLLBACK.
    class NonAtomic extends SqliteDb {
      override async batch<T = unknown>(statements: SqlStatement[]): Promise<SqlResult<T>[]> {
        const out: SqlResult<T>[] = [];
        for (const s of statements) out.push((s as SqliteStatement).batchResult() as SqlResult<T>);
        return out;
      }
    }
    const c = collect();
    runSqlConformance({ adapter: 'non-atomic', make: (schema) => ({ db: new NonAtomic(schema) }) }, c.it);
    await expect(c.cases.get('non-atomic · sql · batch-is-atomic')!()).rejects.toThrow(/rolled back/);
    // …and only that scenario: the mutation is caught by the case that names it.
    await expect(c.cases.get('non-atomic · sql · batch-answers-in-order')!()).resolves.toBeUndefined();
  });

  it('🔴 an engine that binds `undefined` as NULL fails `undefined-bind-is-refused`', async () => {
    const lenient = (schema: readonly string[]) => {
      const db = sqliteDb(schema);
      const prepare = db.prepare.bind(db);
      db.prepare = (sql: string) => {
        const stmt = prepare(sql);
        const bind = stmt.bind.bind(stmt);
        stmt.bind = (...values: unknown[]) => bind(...values.map((v) => (v === undefined ? null : v)));
        return stmt;
      };
      return { db };
    };
    const c = collect();
    runSqlConformance({ adapter: 'lenient', make: lenient }, c.it);
    await expect(c.cases.get('lenient · sql · undefined-bind-is-refused')!()).rejects.toThrow(/expected a rejection/);
  });

  it('🔴 an engine whose `bind` mutates in place fails `bind-returns-a-new-statement`', async () => {
    const inPlace = (schema: readonly string[]) => {
      const db = sqliteDb(schema);
      const prepare = db.prepare.bind(db);
      db.prepare = (sql: string) => {
        const stmt = prepare(sql);
        // Every bind overwrites the one statement's parameters and hands it back.
        stmt.bind = (...values: unknown[]) => ((stmt as unknown as { params: unknown[] }).params = values, stmt);
        return stmt;
      };
      return { db };
    };
    const c = collect();
    runSqlConformance({ adapter: 'in-place', make: inPlace }, c.it);
    // Both batched executions carry the LAST tuple, so the second collides with the first.
    await expect(c.cases.get('in-place · sql · bind-returns-a-new-statement')!()).rejects.toThrow(/UNIQUE constraint failed|wrote two rows/);
  });

  it('🔴 an engine that words every failure as a reset fails `deterministic-error-is-not-retried`', async () => {
    const resets = (schema: readonly string[]) => {
      const db = sqliteDb(schema);
      const prepare = db.prepare.bind(db);
      db.prepare = (sql: string) => {
        const stmt = prepare(sql);
        const all = stmt.all.bind(stmt);
        stmt.all = async <T>() => {
          try {
            return await all<T>();
          } catch {
            throw new Error('D1_ERROR: Network connection lost.');
          }
        };
        return stmt;
      };
      return { db };
    };
    const c = collect();
    runSqlConformance({ adapter: 'resets', make: resets }, c.it);
    await expect(c.cases.get('resets · sql · deterministic-error-is-not-retried')!()).rejects.toThrow(/never retried/);
  });

  it('🔴 an engine whose UNIQUE failure is worded as something else fails `unique-violation-is-classified`', async () => {
    const reworded = (schema: readonly string[]) => {
      const db = sqliteDb(schema);
      const prepare = db.prepare.bind(db);
      db.prepare = (sql: string) => {
        const stmt = prepare(sql);
        const bind = stmt.bind.bind(stmt);
        stmt.bind = (...values: unknown[]) => {
          const bound = bind(...values);
          const run = bound.run.bind(bound);
          bound.run = async <T>() => {
            try {
              return await run<T>();
            } catch {
              throw new Error('write failed');
            }
          };
          return bound;
        };
        return stmt;
      };
      return { db };
    };
    const c = collect();
    runSqlConformance({ adapter: 'reworded', make: reworded }, c.it);
    await expect(c.cases.get('reworded · sql · unique-violation-is-classified')!()).rejects.toThrow(/is a unique violation/);
  });
});
