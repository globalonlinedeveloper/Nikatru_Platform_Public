// ─────────────────────────────────────────────────────────────────────────────
// THE ERASURE WALK COSTS A FIXED NUMBER OF D1 ROUND TRIPS, WHATEVER THE SCHEMA.
//
// ⏱ 2026-09-18 · O-ERASURE-WALK-ROUND-TRIPS. The same proof as
// services/platform/test/erasure-round-trips.test.ts, for THIS Worker's copy of
// the walk (src/lib/erase-subject.ts). The platform relays DELETE /v1/account to
// this route and waits for it, so its round trips sit inside the same 15 s client
// timeout the platform's do; a fix that reached one copy would leave the other
// slow. Read the platform file's header for why this is a COUNT, not a clock.
//
// 🔴 Red against the old walk, which made one call per table, twice over, then one
// per write — and left earlier tables erased when a later write failed.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from 'vitest';
import { eraseSubjectRows } from '../src/lib/erase-subject';
import { realAppDb, type SqliteD1 } from './harness';

const SUBJECT = 'u-round-trips';
const BYSTANDER = 'u-bystander-round-trips';

/** One sqlite_master read, one batch of every pragma, one batch of every write. */
const MAX_ROUND_TRIPS = 3;

const INNER = Symbol('counted-inner');
type Stmt = ReturnType<SqliteD1['prepare']>;

/** Counts every call that would cross the network to D1; `batch` is ONE call. */
class CountingD1 {
  roundTrips = 0;

  constructor(private readonly inner: SqliteD1) {}

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

const name = (i: number) => `extra_${String(i).padStart(2, '0')}`;

function extraTables(n: number): string[] {
  const ddl: string[] = [];
  for (let i = 0; i < n; i++) ddl.push(`CREATE TABLE ${name(i)} (id INTEGER PRIMARY KEY, user_id TEXT NOT NULL)`);
  if (n > 0) ddl.push('CREATE TABLE extra_refs (id INTEGER PRIMARY KEY, reviewer_user_id TEXT)');
  return ddl;
}

function seed(db: SqliteD1, n: number): void {
  for (let i = 0; i < n; i++) db.db.exec(`INSERT INTO ${name(i)} (user_id) VALUES ('${SUBJECT}'), ('${BYSTANDER}')`);
  if (n > 0) db.db.exec(`INSERT INTO extra_refs (reviewer_user_id) VALUES ('${SUBJECT}'), ('${BYSTANDER}')`);
}

const owners = (db: SqliteD1, table: string, column = 'user_id') =>
  db.rows(`SELECT ${column} AS who FROM ${table} WHERE ${column} IS NOT NULL ORDER BY ${column}`).map((r) => r.who);

async function eraseCounted(n: number) {
  const db = realAppDb(extraTables(n));
  seed(db, n);
  const counted = new CountingD1(db);
  const result = await eraseSubjectRows(counted as unknown as D1Database, SUBJECT);
  return { db, counted, result };
}

describe('O-ERASURE-WALK-ROUND-TRIPS · eraseSubjectRows makes a FIXED number of D1 round trips', () => {
  it('🔴 the SAME count over 0 extra tables and over 40 — the walk does not grow with the schema', async () => {
    const small = await eraseCounted(0);
    const large = await eraseCounted(40);

    expect(small.result.ok).toBe(true);
    expect(large.result.ok).toBe(true);
    expect(owners(large.db, 'extra_39')).toEqual([BYSTANDER]);

    expect(large.counted.roundTrips).toBe(small.counted.roundTrips);
    expect(large.counted.roundTrips).toBeLessThanOrEqual(MAX_ROUND_TRIPS);
  });

  it('every table and every reference is still reached — fewer calls, not less erasure', async () => {
    const { db, result } = await eraseCounted(40);
    if (!result.ok) throw new Error(result.reason);

    for (let i = 0; i < 40; i++) expect(result.deleted[name(i)], name(i)).toBe(1);
    expect(result.unlinked['extra_refs.reviewer_user_id']).toBe(1);
    expect(owners(db, 'extra_refs', 'reviewer_user_id')).toEqual([BYSTANDER]);
  });

  it('🔴 ALL-OR-NOTHING — a write that fails on the LAST table leaves EVERY table untouched', async () => {
    const db = realAppDb([
      ...extraTables(5),
      'CREATE TABLE zz_guarded (id INTEGER PRIMARY KEY, user_id TEXT NOT NULL)',
      `CREATE TRIGGER zz_guarded_refuses BEFORE DELETE ON zz_guarded
         BEGIN SELECT RAISE(ABORT, 'zz_guarded refuses this delete'); END`,
    ]);
    seed(db, 5);
    db.db.exec(`INSERT INTO zz_guarded (user_id) VALUES ('${SUBJECT}')`);

    await expect(eraseSubjectRows(new CountingD1(db) as unknown as D1Database, SUBJECT)).rejects.toThrow(
      /zz_guarded refuses/,
    );

    for (let i = 0; i < 5; i++) expect(owners(db, name(i)), name(i)).toEqual([BYSTANDER, SUBJECT].sort());
    expect(owners(db, 'extra_refs', 'reviewer_user_id')).toEqual([BYSTANDER, SUBJECT].sort());
  });
});
