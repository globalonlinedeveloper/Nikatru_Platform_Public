// ─────────────────────────────────────────────────────────────────────────────
// THE ERASURE WALK COSTS A FIXED NUMBER OF D1 ROUND TRIPS, WHATEVER THE SCHEMA.
//
// ⏱ 2026-09-18 · O-ERASURE-WALK-ROUND-TRIPS. DELETE /v1/account took 17291 ms
// and 16800 ms on 09-16 and 09-17 (Workers observability) and the app's 15 s
// client timeout aborted it while the server went on to finish, so a person was
// told "we do not know whether anything was deleted" about an account that WAS.
// The time was round trips: the schema walk asked each table separately and ran
// twice, then wrote one statement per table — 44 sequential calls on
// platform_db's 18 tables, and one more for every table a migration adds.
//
// 🔴 WHAT THIS FILE PROVES, AND WHY IT IS A COUNT AND NOT A CLOCK. A timing test
// on a laptop would pass against the slow code (local SQLite answers in
// microseconds) and flake in CI. The defect is the NUMBER of calls, each of which
// costs ~100-300 ms against real D1, so the number is what is asserted: the same
// path over 0 extra tables and over 40 extra tables must make the SAME number of
// calls, and that number must be small. Run against the old walk, the 40-table
// case made 80+ calls and this file went red.
//
// 🔴 AND THE SECOND PROPERTY THE FIX BUYS: ALL-OR-NOTHING. A trigger aborts the
// DELETE on the table that sorts LAST. The old loop had already erased every
// table before it, leaving a half-erased person whose identity still logs in; one
// `db.batch()` is one transaction, so now nothing moves. Red against the old code.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from 'vitest';
import { erasePlatformRows } from '../src/lib/platform-erasure';
import { realPlatformDb, type RealDb } from './harness';

const SUBJECT = 'u-round-trips';
const BYSTANDER = 'u-bystander-round-trips';

/** THE CEILING. One sqlite_master read, one batch of every pragma, one batch of
 *  every write. A number here that has to rise when a table is added is the
 *  defect coming back. */
const MAX_ROUND_TRIPS = 3;

const INNER = Symbol('counted-inner');
type Stmt = ReturnType<RealDb['prepare']>;

/**
 * A D1Database that counts ROUND TRIPS — every call that would cross the network
 * to D1: `.all()`, `.first()` and `.run()` on a statement, and `.batch()` as ONE
 * call however many statements it carries. `prepare` and `bind` are local in D1
 * and are not counted.
 */
class CountingD1 {
  roundTrips = 0;

  constructor(private readonly inner: RealDb) {}

  private wrap(stmt: Stmt) {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    return {
      [INNER]: stmt,
      bind: (...args: unknown[]) => self.wrap(stmt.bind(...args) as Stmt),
      all<T = Record<string, unknown>>() {
        self.roundTrips++;
        return stmt.all<T>();
      },
      first<T = Record<string, unknown>>() {
        self.roundTrips++;
        return stmt.first<T>();
      },
      run() {
        self.roundTrips++;
        return stmt.run();
      },
    };
  }

  prepare(sql: string) {
    return this.wrap(this.inner.prepare(sql));
  }

  batch(statements: Array<{ [INNER]: Stmt }>) {
    this.roundTrips++;
    return this.inner.batch(statements.map((s) => s[INNER]));
  }
}

/** `n` extra user-owned tables, plus one `*_user_id` reference, so the walk has
 *  both rules to apply at every size. */
function extraTables(n: number): string[] {
  const ddl: string[] = [];
  for (let i = 0; i < n; i++) {
    const name = `extra_${String(i).padStart(2, '0')}`;
    ddl.push(`CREATE TABLE ${name} (id INTEGER PRIMARY KEY, user_id TEXT NOT NULL, note TEXT)`);
  }
  if (n > 0) ddl.push('CREATE TABLE extra_refs (id INTEGER PRIMARY KEY, reviewer_user_id TEXT)');
  return ddl;
}

function seed(db: RealDb, n: number): void {
  db.db.exec(
    `INSERT INTO entitlements (user_id, app_id, entitlement, is_active)
       VALUES ('${SUBJECT}','subscriptiontracker','pro',1), ('${BYSTANDER}','subscriptiontracker','pro',1)`,
  );
  for (let i = 0; i < n; i++) {
    const name = `extra_${String(i).padStart(2, '0')}`;
    db.db.exec(`INSERT INTO ${name} (user_id, note) VALUES ('${SUBJECT}','mine'), ('${BYSTANDER}','theirs')`);
  }
  if (n > 0) db.db.exec(`INSERT INTO extra_refs (reviewer_user_id) VALUES ('${SUBJECT}'), ('${BYSTANDER}')`);
}

async function eraseCounted(n: number) {
  const db = realPlatformDb(extraTables(n));
  seed(db, n);
  const counted = new CountingD1(db);
  const result = await erasePlatformRows(counted as unknown as D1Database, SUBJECT);
  return { db, counted, result };
}

describe('O-ERASURE-WALK-ROUND-TRIPS · erasePlatformRows makes a FIXED number of D1 round trips', () => {
  it('🔴 the SAME count over 0 extra tables and over 40 — the walk does not grow with the schema', async () => {
    const small = await eraseCounted(0);
    const large = await eraseCounted(40);

    // Both erasures really happened, or a cheap count would prove nothing.
    expect(small.result.ok).toBe(true);
    expect(large.result.ok).toBe(true);
    expect(large.db.count('extra_39', 'user_id = ?', SUBJECT)).toBe(0);
    expect(large.db.count('extra_39', 'user_id = ?', BYSTANDER)).toBe(1);

    expect(large.counted.roundTrips).toBe(small.counted.roundTrips);
    expect(large.counted.roundTrips).toBeLessThanOrEqual(MAX_ROUND_TRIPS);
  });

  it('every table and every reference is still reached — fewer calls, not less erasure', async () => {
    const { db, result } = await eraseCounted(40);
    if (!result.ok) throw new Error(result.reason);

    for (let i = 0; i < 40; i++) {
      const name = `extra_${String(i).padStart(2, '0')}`;
      expect(result.deleted[name], name).toBe(1);
    }
    expect(result.deleted.entitlements).toBe(1);
    expect(result.unlinked['extra_refs.reviewer_user_id']).toBe(1);
    // The bystander's reference is untouched; only the subject's was NULLed.
    expect(db.rows('SELECT reviewer_user_id AS r FROM extra_refs WHERE reviewer_user_id IS NOT NULL').map((x) => x.r)).toEqual([BYSTANDER]);
  });

  it('🔴 ALL-OR-NOTHING — a write that fails on the LAST table leaves EVERY table untouched', async () => {
    const db = realPlatformDb([
      ...extraTables(5),
      // Sorts after every other table, so the old loop reached it last.
      'CREATE TABLE zz_guarded (id INTEGER PRIMARY KEY, user_id TEXT NOT NULL)',
      `CREATE TRIGGER zz_guarded_refuses BEFORE DELETE ON zz_guarded
         BEGIN SELECT RAISE(ABORT, 'zz_guarded refuses this delete'); END`,
    ]);
    seed(db, 5);
    db.db.exec(`INSERT INTO zz_guarded (user_id) VALUES ('${SUBJECT}')`);

    await expect(erasePlatformRows(new CountingD1(db) as unknown as D1Database, SUBJECT)).rejects.toThrow(
      /zz_guarded refuses/,
    );

    // THE PROPERTY: the tables that sort BEFORE the failure still hold the
    // subject's rows. The old per-table loop had deleted them already.
    expect(db.count('entitlements', 'user_id = ?', SUBJECT)).toBe(1);
    for (let i = 0; i < 5; i++) {
      const name = `extra_${String(i).padStart(2, '0')}`;
      expect(db.count(name, 'user_id = ?', SUBJECT), name).toBe(1);
    }
    expect(db.count('extra_refs', 'reviewer_user_id = ?', SUBJECT)).toBe(1);
  });
});
