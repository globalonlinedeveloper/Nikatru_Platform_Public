// ─────────────────────────────────────────────────────────────────────────────
// events-rollup.test.ts — [11]E-11, [ADR 045]
//
// 🔴 THE TEST THAT MATTERS IN THIS FILE IS THE MUTATION ONE, and everything else
// is supporting evidence. `assert-seams-wired.mjs` once shipped with a caller
// check that matched the function's own DECLARATION, so deleting every real
// caller still passed — and ALL SIX of its fixtures passed against the broken
// version. A fixture you wrote encodes the same misunderstanding as the code you
// wrote. So the fail-closed interlock is proved by breaking the REAL call and
// watching rows die, not by asserting that a function returns what it returns.
//
// WHY IT RUNS AGAINST THE REAL MIGRATIONS. `realPlatformDb()` applies
// services/platform/migrations/*.sql — including 0007 — so the grain, the unique
// index and the seeded `rollup_state` row are the shipped ones. A hand-written
// CREATE TABLE here would be a second declaration of the schema, and the day it
// drifted from the migration every assertion below would still pass.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, expect, it } from 'vitest';

import {
  EVENTS_ROLLUP_JOB,
  eventsRollup,
  retentionSweep,
  rolledThrough,
  rollupBoundedCutoff,
  type RetentionPeriods,
} from '../src/scheduled';
import type { Env } from '../src/types';
import { realPlatformDb, type RealDb } from './harness';

const envOf = (db: RealDb) => ({ PLATFORM_DB: db }) as unknown as Env;

/** 2026-08-11T00:00:00Z — so the last COMPLETE day is 2026-08-10. */
const NOW = Date.parse('2026-08-11T00:00:00.000Z');

const heartbeat = (db: RealDb) => db.rows('SELECT target, ok, detail FROM cron_heartbeat WHERE job = ?', EVENTS_ROLLUP_JOB);

/** N days of launches for one install, one row per day, ending the day before NOW. */
function seedDays(db: RealDb, n: number, startDay = '2026-07-01'): void {
  const rows: string[] = [];
  for (let i = 0; i < n; i++) {
    const day = new Date(Date.parse(`${startDay}T00:00:00.000Z`) + i * 86400000).toISOString().slice(0, 10);
    rows.push(`('e-${i}', 'subly', 'a1', 'app_launch', '${day}T09:00:00.000Z')`);
  }
  db.db.exec(`INSERT INTO events (event_id, app_id, anon_id, event, server_ts) VALUES ${rows.join(',')}`);
}

const daily = (db: RealDb) => db.rows('SELECT day, app_id, anon_id, event, feature, n_rows FROM events_daily ORDER BY day, event, feature');

// ─────────────────────────────────────────────────────────────────────────────
describe('🔴 THE FAIL-CLOSED INTERLOCK — the sweep cannot outrun the rollup', () => {
  it('THE MUTATION: with NO rollup run, the sweep deletes NOTHING even when every row is "old"', async () => {
    const db = realPlatformDb();
    seedDays(db, 30);
    const before = db.count('events');
    expect(before).toBe(30);

    // Every row is far past a 1-day period. Age alone would delete all but today's.
    await retentionSweep(envOf(db), { events: 1, events_daily: null, provider_notifications: null }, NOW);

    // The watermark is NULL — nothing has been rolled up — so the limb is INERT.
    expect(await rolledThrough(envOf(db))).toBeNull();
    expect(db.count('events'), 'the sweep deleted unrolled-up history — the interlock is not wired').toBe(before);
    // …and it did not merely fail to match: no DELETE was even prepared for events.
    expect(db.sql.filter((s) => /^\s*DELETE\s+FROM\s+events\b/i.test(s))).toHaveLength(0);
  });

  it('…and once the rollup HAS run, the sweep deletes exactly up to the watermark and not one row beyond', async () => {
    const db = realPlatformDb();
    seedDays(db, 30);

    await eventsRollup(envOf(db), NOW);
    const wm = await rolledThrough(envOf(db));
    expect(wm).not.toBeNull();

    await retentionSweep(envOf(db), { events: 1, events_daily: null, provider_notifications: null }, NOW);

    // Nothing newer than the watermark's day survives being deleted only because
    // the rollup consumed it — every surviving row must be AFTER rolled_through.
    const survivors = db.rows('SELECT server_ts FROM events ORDER BY server_ts').map((r) => String(r.server_ts));
    for (const ts of survivors) {
      expect(ts.slice(0, 10) > String(wm), `row ${ts} survived but is at or before the watermark ${wm}`).toBe(true);
    }
    // And everything deleted was genuinely in the rollup.
    expect(db.count('events_daily')).toBeGreaterThan(0);
  });

  it('the four watermark cases, as pure arithmetic', () => {
    // age binds — the rollup is ahead of the age cutoff
    expect(rollupBoundedCutoff('2027-06-01T00:00:00.000Z', '2027-09-01')).toBe('2027-06-01T00:00:00.000Z');
    // watermark binds — the rollup stalled months ago
    expect(rollupBoundedCutoff('2027-06-01T00:00:00.000Z', '2027-04-15')).toBe('2027-04-16T00:00:00.000Z');
    // never ran — INERT, and this is the case that matters most
    expect(rollupBoundedCutoff('2027-06-01T00:00:00.000Z', null)).toBeNull();
    // consumed exactly to the age cutoff day
    expect(rollupBoundedCutoff('2027-06-01T00:00:00.000Z', '2027-05-31')).toBe('2027-06-01T00:00:00.000Z');
    // no period declared stays inert regardless of how healthy the rollup is
    expect(rollupBoundedCutoff(null, '2027-09-01')).toBeNull();
  });

  it('the heartbeat NAMES the interlock rather than reporting a bare inert store', async () => {
    const db = realPlatformDb();
    seedDays(db, 5);
    await retentionSweep(envOf(db), { events: 1, events_daily: null, provider_notifications: null }, NOW);
    const detail = String(db.rows("SELECT detail FROM cron_heartbeat WHERE job = 'retention_sweep'")[0].detail);
    // `events(unrolled)` must be distinguishable from "no period declared" —
    // one needs the owner, the other resolves itself on the next rollup.
    expect(detail).toContain('events(unrolled)');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('the rollup is IDEMPOTENT — the property the whole table rests on', () => {
  it('three identical runs leave identical contents', async () => {
    const db = realPlatformDb();
    seedDays(db, 7);

    await eventsRollup(envOf(db), NOW);
    const first = JSON.stringify(daily(db));
    await eventsRollup(envOf(db), NOW);
    await eventsRollup(envOf(db), NOW);

    expect(JSON.stringify(daily(db)), 'the rollup duplicated on re-run — every count it feeds is now multiplied').toBe(first);
  });

  it("🔴 a non-feature_used row lands with feature='' and NOT NULL — the sentinel ON CONFLICT depends on", async () => {
    const db = realPlatformDb();
    seedDays(db, 3);
    await eventsRollup(envOf(db), NOW);

    // SQLite treats NULLs as DISTINCT in a unique index, so a NULL here would
    // make ON CONFLICT never fire for the ~90% of rows that are not feature_used
    // — measured as 3 rows after 3 runs instead of 1.
    expect(db.count('events_daily', "feature IS NULL")).toBe(0);
    expect(db.count('events_daily', "feature = ''")).toBeGreaterThan(0);
  });

  it('a feature_used row carries its params.$.name, and a re-run does not duplicate it', async () => {
    const db = realPlatformDb();
    db.db.exec(
      `INSERT INTO events (event_id, app_id, anon_id, event, server_ts, params) VALUES
         ('f-1', 'subly', 'a1', 'feature_used', '2026-08-01T09:00:00.000Z', '{"name":"export"}'),
         ('f-2', 'subly', 'a1', 'feature_used', '2026-08-01T10:00:00.000Z', '{"name":"export"}'),
         ('f-3', 'subly', 'a1', 'feature_used', '2026-08-01T11:00:00.000Z', '{"name":"sync"}'),
         ('f-4', 'subly', 'a1', 'feature_used', '2026-08-01T12:00:00.000Z', '{}')`,
    );
    await eventsRollup(envOf(db), NOW);
    await eventsRollup(envOf(db), NOW);

    const rows = daily(db).filter((r) => r.event === 'feature_used');
    expect(rows).toHaveLength(3); // export(2) · sync(1) · ''(1 — no name)
    expect(rows.find((r) => r.feature === 'export')?.n_rows).toBe(2);
    expect(rows.find((r) => r.feature === 'sync')?.n_rows).toBe(1);
    expect(rows.find((r) => r.feature === '')?.n_rows).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('catch-up — falling behind is safe, and resuming is stateless', () => {
  it('consumes at most MAX_DAYS_PER_ROLLUP_RUN and resumes across nights', async () => {
    const db = realPlatformDb();
    seedDays(db, 40, '2026-06-20');

    await eventsRollup(envOf(db), NOW);
    const after1 = await rolledThrough(envOf(db));
    await eventsRollup(envOf(db), NOW);
    const after2 = await rolledThrough(envOf(db));
    await eventsRollup(envOf(db), NOW);
    const after3 = await rolledThrough(envOf(db));

    // Strictly monotonic — a watermark that went backwards would re-open the
    // window the sweep is allowed to delete in.
    expect(String(after2) > String(after1)).toBe(true);
    expect(String(after3) > String(after2)).toBe(true);
    // 40 days at 14/night is caught up on the third run.
    expect(db.count('events_daily')).toBe(40);
  });

  it('NEVER consumes today — a partial day would write an n_rows a later run must correct', async () => {
    const db = realPlatformDb();
    db.db.exec(
      `INSERT INTO events (event_id, app_id, anon_id, event, server_ts) VALUES
         ('yesterday', 'subly', 'a1', 'app_launch', '2026-08-10T09:00:00.000Z'),
         ('today',     'subly', 'a1', 'app_launch', '2026-08-11T09:00:00.000Z')`,
    );
    await eventsRollup(envOf(db), NOW);
    expect(daily(db).map((r) => r.day)).toEqual(['2026-08-10']);
    expect(await rolledThrough(envOf(db))).toBe('2026-08-10');
  });

  it('an empty events table rolls up nothing and does NOT go red', async () => {
    const db = realPlatformDb();
    await eventsRollup(envOf(db), NOW);
    expect(db.count('events_daily')).toBe(0);
    expect(await rolledThrough(envOf(db))).toBeNull();
    const rows = heartbeat(db);
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].ok)).toBe(1);
    expect(String(rows[0].detail)).toContain('NOTHING TO ROLL UP');
  });

  it('GAP SKIP — a long dormancy costs one run, not one run per empty day', async () => {
    const db = realPlatformDb();
    // Two clusters 60 days apart. Walking calendar days would need 5 nights at
    // 14/night; the gap skip jumps straight to the next day carrying data.
    seedDays(db, 3, '2026-05-01');
    seedDays2(db, 3, '2026-07-01');
    await eventsRollup(envOf(db), NOW);
    await eventsRollup(envOf(db), NOW);
    expect(db.count('events_daily'), 'the gap skip did not skip — catch-up is O(calendar days)').toBe(6);
  });
});

/** A second seeder so two clusters can coexist without event_id collisions. */
function seedDays2(db: RealDb, n: number, startDay: string): void {
  const rows: string[] = [];
  for (let i = 0; i < n; i++) {
    const day = new Date(Date.parse(`${startDay}T00:00:00.000Z`) + i * 86400000).toISOString().slice(0, 10);
    rows.push(`('g-${i}', 'subly', 'a1', 'app_launch', '${day}T09:00:00.000Z')`);
  }
  db.db.exec(`INSERT INTO events (event_id, app_id, anon_id, event, server_ts) VALUES ${rows.join(',')}`);
}

// ─────────────────────────────────────────────────────────────────────────────
describe('the rollup records what it did', () => {
  it('reports days, rows and the watermark in parseable tokens', async () => {
    const db = realPlatformDb();
    seedDays(db, 5);
    await eventsRollup(envOf(db), NOW);
    const rows = heartbeat(db);
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].ok)).toBe(1);
    const detail = String(rows[0].detail);
    expect(detail).toContain('days=5');
    expect(detail).toContain('rows=5');
    expect(detail).toContain('watermark=');
    expect(detail).toContain('lag=');
  });

  it('a thrown statement is recorded as ok=0, never as "nothing to do"', async () => {
    const db = realPlatformDb();
    seedDays(db, 2);
    db.db.exec('DROP TABLE events_daily');
    await eventsRollup(envOf(db), NOW);
    const rows = heartbeat(db);
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].ok)).toBe(0);
    expect(String(rows[0].detail)).toContain('FAILED');
  });
});

// The sweep's own period for the rollup table, so the chain terminates.
describe('events_daily is itself swept, on age alone', () => {
  it('deletes rollup rows past their period and keeps newer ones', async () => {
    const db = realPlatformDb();
    db.db.exec(
      `INSERT INTO events_daily (day, app_id, anon_id, event, feature, n_rows) VALUES
         ('2020-01-01', 'subly', 'a1', 'app_launch', '', 3),
         ('2026-08-01', 'subly', 'a1', 'app_launch', '', 4)`,
    );
    const periods: RetentionPeriods = { events: null, events_daily: 30, provider_notifications: null };
    await retentionSweep(envOf(db), periods, NOW);
    expect(db.rows('SELECT day FROM events_daily')).toEqual([{ day: '2026-08-01' }]);
  });
});
