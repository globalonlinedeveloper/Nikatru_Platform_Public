// ─────────────────────────────────────────────────────────────────────────────
// retention-sweep.test.ts — [pipeline 14]O-17. The D1 retention sweep must be
// INERT while no period is declared, and must delete EXACTLY the rows past the
// period the moment one is.
//
// 🔑 WHY EVERY CASE PASSES ITS OWN PERIODS INSTEAD OF READING THE SHIPPED ONES.
// A suite that pinned `EVENTS_RETENTION_DAYS === null` would go red the day the
// owner declares a period — turning a one-line change into a two-line one and
// making this file an obstacle to the very decision it exists to enable. The
// same trap signup-retention.test.mjs records in its header. So the two branch
// suites force their own values through `retentionSweep`'s parameters, and the
// SHIPPED-FILE suite derives its expectation from whatever is declared. Every
// case below is therefore correct in both states of the tree.
//
// 🔴 AND WHY IT RUNS AGAINST THE REAL MIGRATIONS. `realPlatformDb()` applies
// services/platform/migrations/*.sql through node:sqlite, so "nothing was
// deleted" is a COUNT against the real schema and not a record of which methods
// a double was asked for. A hand-written recorder cannot tell an INSERT naming a
// column no migration created from a correct one — harness.ts's own header.
//
// NEGATIVE TESTS THIS SUITE MUST SURVIVE (run them before trusting it):
//   N1 delete the `if (cutoff === null) { inert.push(store); continue; }` guard
//        -> the DORMANT cases go red (rows disappear AND a DELETE is prepared)
//   N2 loosen `days > 0` to `days >= 0` in retentionCutoff
//        -> "a period of 0 is INERT" goes red — the case that stops a
//           fat-fingered zero meaning "delete the whole table"
//   N3 change `server_ts < ?` to `<=`
//        -> the boundary case goes red (a row exactly at the cutoff is kept)
//   N4 drop the `LIMIT ?` from the subquery
//        -> the bound case goes red (1005 deleted in one run, capped=0)
//   N5 declare a period in scheduled.ts and leave the register at
//      `period-undeclared` -> the register-agreement case goes red
//   N6 drop the `revoked_at GLOB '…'` guard from the ext_devices DELETE
//        -> the integer-`revoked_at` case goes red (a device revoked YESTERDAY,
//           written as integer milliseconds, is swept at once)
//   N7 sweep ext_devices on `created_at` instead of `revoked_at`
//        -> the never-revoked case goes red (a live credential is deleted)
//   N8 (⏱ 2026-09-30, EXA-11) drop the expired limb from the ext_devices DELETE
//        -> the expired-and-never-presented cases go red (kept forever)
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from 'vitest';

// `?raw` rather than node:fs — a Workers tsconfig has no node types on purpose
// (see test/raw-modules.d.ts). Same import shape as erasure-reach.test.ts.
import registerRaw from '../../../tooling/ops/register.json?raw';
import {
  EVENTS_RETENTION_DAYS,
  EVENTS_DAILY_RETENTION_DAYS,
  MAX_ROWS_PER_SWEEP,
  MAX_SWEEP_STATEMENTS_PER_RUN,
  JOB_STATEMENT_BUDGET,
  PROVIDER_NOTIFICATIONS_RETENTION_DAYS,
  RETENTION_SWEEP_JOB,
  SIGNUPS_RETENTION_DAYS,
  CONTENT_REPORTS_RETENTION_DAYS,
  EXT_CODES_RETENTION_DAYS,
  EXT_DEVICES_RETENTION_DAYS,
  extDevicesExpiredCutoffs,
  NATIVE_ATTEST_REDEEMED_RETENTION_DAYS,
  NATIVE_ATTEST_COUNTERS_RETENTION_DAYS,
  NATIVE_ATTEST_KEYS_RETENTION_DAYS,
  retentionCutoff,
  retentionSweep,
} from '../src/scheduled';
import type { RetentionPeriods, RetentionStore } from '../src/scheduled';
import type { Env } from '../src/types';
import { realPlatformDb, type RealDb } from './harness';

/** A fixed "now" so every expectation is arithmetic rather than a race. */
const NOW = Date.parse('2026-08-11T00:00:00.000Z');
/** 30 days before NOW — the cutoff every activated case below uses. */
const CUTOFF_30D = '2026-07-12T00:00:00.000Z';

const envOf = (db: RealDb) => ({ PLATFORM_DB: db }) as unknown as Env;

/** Mark the rollup as CAUGHT UP to the last complete day before NOW, so the
 *  `events` limb's cutoff is decided by age rather than by the interlock.
 *  Any test about the sweep's ARITHMETIC needs this; without it the watermark is
 *  NULL and the limb is inert, so the test would pass for the wrong reason. */
const caughtUp = (db: RealDb) =>
  db.db.exec("UPDATE rollup_state SET rolled_through = '2026-08-10' WHERE rollup = 'events_daily'");

/** Two ancient rows and one fresh row in each swept table. */
function seeded(): RealDb {
  const db = realPlatformDb();
  db.db.exec(
    `INSERT INTO events (event_id, app_id, anon_id, event, server_ts) VALUES
       ('old-1', 'subscriptiontracker', 'a1', 'app_launch', '2020-01-01T00:00:00.000Z'),
       ('old-2', 'subscriptiontracker', 'a1', 'app_launch', '2026-07-01T00:00:00.000Z'),
       ('new-1', 'subscriptiontracker', 'a1', 'app_launch', '2026-08-10T00:00:00.000Z')`,
  );
  // 🔴 `derived_at` IS SET ON EVERY ROW HERE, AND THAT IS LOAD-BEARING.
  // The sweep refuses to delete a payment notification that never derived
  // ([ADR 045] §4 — an underived payload IS the book of account and carries a
  // ~2,698-day statutory clock). A seed that left `derived_at` NULL would make
  // every deletion case below silently assert nothing: rows would survive
  // because the guard refused them, while the test read that as "the period had
  // not elapsed". The underived case is driven deliberately, on its own, in
  // `seededWithUnderived` — not smuggled into the arithmetic cases.
  db.db.exec(
    `INSERT INTO provider_notifications (provider, provider_event_id, received_at, payload, derived_at) VALUES
       ('paddle', 'evt-old-1', '2020-01-01T00:00:00.000Z', '{}', '2020-01-01T00:00:01.000Z'),
       ('paddle', 'evt-old-2', '2026-07-01T00:00:00.000Z', '{}', '2026-07-01T00:00:01.000Z'),
       ('paddle', 'evt-new-1', '2026-08-10T00:00:00.000Z', '{}', '2026-08-10T00:00:01.000Z')`,
  );
  // 🔴 THE ROLLUP WATERMARK IS SET, AND IT IS LOAD-BEARING FOR THE SAME REASON
  // `derived_at` IS. The `events` limb no longer deletes on age alone: its cutoff
  // is min(age, rolled_through + 1d), and a NULL watermark makes it INERT
  // (`rollupBoundedCutoff`). A seed that left this NULL would make every events
  // arithmetic case below silently assert nothing — rows would survive because
  // the INTERLOCK refused them, while the test read that as "the period had not
  // elapsed". Exactly the failure the comment above describes, one table over.
  //
  // '2026-08-10' is the last complete day before NOW, i.e. THE ROLLUP HAS CAUGHT
  // UP, so the age cutoff binds and these cases test the arithmetic they mean to.
  // The interlock's own cases — stalled, never-run, exactly-at-cutoff — are
  // driven deliberately in their own describe block, not smuggled in here.
  db.db.exec("UPDATE rollup_state SET rolled_through = '2026-08-10' WHERE rollup = 'events_daily'");
  return db;
}

/** The same tree, plus two ANCIENT payment rows the sweep must refuse:
 *  one that never derived at all, and one that derived into an error. */
function seededWithUnderived(): RealDb {
  const db = seeded();
  db.db.exec(
    `INSERT INTO provider_notifications (provider, provider_event_id, received_at, payload, derived_at, derive_error) VALUES
       ('paddle', 'evt-underived', '2019-01-01T00:00:00.000Z', '{}', NULL, NULL),
       ('paddle', 'evt-errored',   '2019-01-01T00:00:00.000Z', '{}', '2019-01-01T00:00:01.000Z', 'unclaimed: no account is linked')`,
  );
  return db;
}

const heartbeat = (db: RealDb) =>
  db.rows('SELECT target, ok, detail FROM cron_heartbeat WHERE job = ?', RETENTION_SWEEP_JOB);

/** Every SQL string the sweep asked the DB to prepare that is a DELETE. */
const deletesPrepared = (db: RealDb) => db.sql.filter((s) => /^\s*DELETE\b/i.test(s));

const NONE: RetentionPeriods = { events: null, events_daily: null, provider_notifications: null, signups: null, content_reports: null, ext_codes: null, ext_devices: null, native_attest_redeemed: null, native_attest_keys: null, native_attest_counters: null };

// ─────────────────────────────────────────────────────────────────────────────
describe('retentionCutoff — the pure half', () => {
  it('no declared period yields NO cutoff at all', () => {
    expect(retentionCutoff(null, NOW)).toBeNull();
  });

  it('a positive number of days becomes an ISO instant that many days back', () => {
    expect(retentionCutoff(30, NOW)).toBe(CUTOFF_30D);
    expect(retentionCutoff(1, NOW)).toBe('2026-08-10T00:00:00.000Z');
  });

  it('🔴 0, negatives and non-numbers stay INERT rather than becoming "now"', () => {
    // A cutoff of NOW deletes the whole table. A fat-fingered 0 must mean NO
    // RETENTION, never "delete everything" — the same rule signupPutOptions
    // applies to a KV expirationTtl, for the same reason.
    for (const v of [0, -1, -365, NaN, Infinity]) {
      expect(retentionCutoff(v, NOW), `${String(v)} must not produce a cutoff`).toBeNull();
    }
    for (const v of ['30', '', true, {}, []]) {
      expect(retentionCutoff(v as unknown as number, NOW)).toBeNull();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('DORMANT — with no declared period the sweep touches nothing', () => {
  it('deletes NO rows from either store', async () => {
    const db = seeded();
    await retentionSweep(envOf(db), NONE, NOW);
    expect(db.count('events')).toBe(3);
    expect(db.count('provider_notifications')).toBe(3);
  });

  it('does not even PREPARE a DELETE — inert means no statement, not a statement that matches nothing', async () => {
    const db = seeded();
    await retentionSweep(envOf(db), NONE, NOW);
    expect(deletesPrepared(db)).toEqual([]);
  });

  it('a period of 0 or a negative is treated as undeclared, not as "delete everything"', async () => {
    const db = seeded();
    await retentionSweep(envOf(db), { events: 0, events_daily: null, provider_notifications: -1, signups: null, content_reports: null, ext_codes: null, ext_devices: null, native_attest_redeemed: null, native_attest_keys: null, native_attest_counters: null }, NOW);
    expect(db.count('events')).toBe(3);
    expect(db.count('provider_notifications')).toBe(3);
    expect(deletesPrepared(db)).toEqual([]);
  });

  it('SAYS SO in its heartbeat, in parseable tokens, and does NOT go red', async () => {
    const db = seeded();
    await retentionSweep(envOf(db), NONE, NOW);
    const rows = heartbeat(db);
    expect(rows).toHaveLength(1);
    expect(rows[0].target).toBe('(portfolio)');
    // ok=1: an inert run SUCCEEDED at doing nothing. A daily red on a number
    // only the owner can supply is how an alarm gets muted (CLAUDE.md C-6).
    expect(rows[0].ok).toBe(1);
    const detail = String(rows[0].detail);
    expect(detail).toContain('declared=0');
    expect(detail).toContain('deleted=0');
    expect(detail).toContain('INERT');
    expect(detail).toContain('events');
    expect(detail).toContain('provider_notifications');
    // recordHeartbeat slices `detail` to 200 chars; a truncated tail would
    // silently eat a token if the order were ever rearranged.
    expect(detail.length).toBeLessThanOrEqual(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('ACTIVATED — one value turns the same job into a bounded deletion', () => {
  const THIRTY: RetentionPeriods = { events: 30, events_daily: null, provider_notifications: 30, signups: null, content_reports: null, ext_codes: null, ext_devices: null, native_attest_redeemed: null, native_attest_keys: null, native_attest_counters: null };

  it('deletes EXACTLY the rows past the period, and nothing newer', async () => {
    const db = seeded();
    await retentionSweep(envOf(db), THIRTY, NOW);

    expect(db.count('events')).toBe(1);
    expect(db.rows('SELECT event_id FROM events')).toEqual([{ event_id: 'new-1' }]);

    expect(db.count('provider_notifications')).toBe(1);
    expect(db.rows('SELECT provider_event_id FROM provider_notifications')).toEqual([
      { provider_event_id: 'evt-new-1' },
    ]);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 🔴 THE DERIVATION GUARD — [ADR 045] §4.
  //
  // The retention FLOOR on provider_notifications is NONE *only because* a
  // derived record independently satisfies the books-of-account duty. An
  // underived payload IS the book of account by function, and inherits CGST
  // s.36 — 72 months from the annual-return due date, roughly 2,698 days,
  // suspended indefinitely by any appeal or reopened assessment. So the sweep's
  // legality is a property of THIS PREDICATE, not of the period.
  //
  // These rows are FOUR YEARS past a 30-day cutoff. Age alone would take them.
  it('🔴 REFUSES a payment row that never derived, however old it is', async () => {
    const db = seededWithUnderived();
    await retentionSweep(envOf(db), THIRTY, NOW);

    const left = db
      .rows('SELECT provider_event_id FROM provider_notifications ORDER BY provider_event_id')
      .map((r) => (r as { provider_event_id: string }).provider_event_id);

    expect(left).toContain('evt-underived');
    expect(left).toContain('evt-errored');
    // …and the guard has NOT cost the working path its deletions: the three
    // derived rows are still swept exactly as before. A predicate that refused
    // everything would pass the two assertions above and be useless.
    expect(left).not.toContain('evt-old-1');
    expect(left).not.toContain('evt-old-2');
    expect(left).toContain('evt-new-1');
  });

  it('🔴 the refusal is IN THE SQL, so it cannot be lost to a later refactor', async () => {
    // Asserting only on surviving rows would still pass if the predicate moved
    // into JS and someone later deleted the row set in a second statement. The
    // condition must be in the statement the database is asked to run.
    const db = seededWithUnderived();
    await retentionSweep(envOf(db), THIRTY, NOW);
    const pn = deletesPrepared(db).filter((sql) => /provider_notifications/.test(sql));
    expect(pn).toHaveLength(1);
    expect(pn[0]).toMatch(/derived_at IS NOT NULL/);
    expect(pn[0]).toMatch(/derive_error IS NULL/);
    // The events sweep must NOT carry it — events has no such column, and a
    // copy-paste of the predicate there would throw at runtime.
    for (const sql of deletesPrepared(db).filter((q) => /FROM events/.test(q))) {
      expect(sql).not.toMatch(/derived_at/);
    }
  });

  it('the boundary is STRICT — a row exactly at the cutoff survives', async () => {
    const db = realPlatformDb();
    db.db.exec(
      `INSERT INTO events (event_id, app_id, anon_id, event, server_ts) VALUES
         ('at-cutoff', 'subscriptiontracker', 'a1', 'app_launch', '${CUTOFF_30D}'),
         ('one-ms-before', 'subscriptiontracker', 'a1', 'app_launch', '2026-07-11T23:59:59.999Z')`,
    );
    caughtUp(db);
    await retentionSweep(envOf(db), THIRTY, NOW);
    expect(db.rows('SELECT event_id FROM events')).toEqual([{ event_id: 'at-cutoff' }]);
  });

  it('every DELETE is FILTERED — never an unfiltered wipe', async () => {
    const db = seeded();
    await retentionSweep(envOf(db), THIRTY, NOW);
    const deletes = deletesPrepared(db);
    expect(deletes).toHaveLength(2);
    for (const sql of deletes) {
      expect(sql, `an unfiltered DELETE reached the shared database: ${sql}`).toMatch(/\bWHERE\b/i);
      expect(sql).toMatch(/\bLIMIT\s*\?/i);
    }
  });

  it('the cutoff is BOUND, not interpolated — the deleted set is data, not string-building', async () => {
    const db = seeded();
    await retentionSweep(envOf(db), THIRTY, NOW);
    // RealDb.bound records every `.bind(...)` tuple in order. bound[0] is the
    // ROLLUP WATERMARK READ, which now runs once before the loop — the two
    // sweeps follow it, and the heartbeat's INSERT binds after them.
    expect(db.bound[0]).toEqual(['events_daily']);
    expect(db.bound[1]).toEqual([CUTOFF_30D, MAX_ROWS_PER_SWEEP]);
    expect(db.bound[2]).toEqual([CUTOFF_30D, MAX_ROWS_PER_SWEEP]);
  });

  it('is IDEMPOTENT — a second run at the same instant deletes nothing more', async () => {
    const db = seeded();
    await retentionSweep(envOf(db), THIRTY, NOW);
    const after = db.count('events') + db.count('provider_notifications');
    await retentionSweep(envOf(db), THIRTY, NOW);
    expect(db.count('events') + db.count('provider_notifications')).toBe(after);
    const rows = heartbeat(db);
    expect(rows).toHaveLength(2);
    expect(String(rows[1].detail)).toContain('deleted=0');
  });

  it('reports what it did, per store, in parseable tokens', async () => {
    const db = seeded();
    await retentionSweep(envOf(db), THIRTY, NOW);
    const detail = String(heartbeat(db)[0].detail);
    expect(detail).toContain('declared=2');
    expect(detail).toContain('deleted=4');
    expect(detail).toContain('capped=0');
    expect(detail).toContain('events=30d:2');
    expect(detail).toContain('provider_notifications=30d:2');
    expect(detail.length).toBeLessThanOrEqual(200);
  });

  it('one store declared and one not is a MIXED run, not an all-or-nothing one', async () => {
    const db = seeded();
    await retentionSweep(envOf(db), { events: 30, events_daily: null, provider_notifications: null, signups: null, content_reports: null, ext_codes: null, ext_devices: null, native_attest_redeemed: null, native_attest_keys: null, native_attest_counters: null }, NOW);
    expect(db.count('events')).toBe(1);
    expect(db.count('provider_notifications')).toBe(3);
    expect(deletesPrepared(db)).toHaveLength(1);
    // Both undeclared stores are named, in `stores` order — a reader must be
    // able to tell WHICH are inert, not just how many.
    expect(String(heartbeat(db)[0].detail)).toContain('inert=events_daily,provider_notifications');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('BOUNDED — the sweep is a catch-up job, never one unbounded DELETE', () => {
  // ⏱ 2026-10-01 · O-NIGHTLY-CRON-INVOCATION-BUDGET-UNSUMMED. Until then a store
  // lost at most MAX_ROWS_PER_SWEEP rows a NIGHT, so past ~1,000 expired rows a
  // day the declared period silently stopped being true. A pass that removes a
  // full batch is now followed by another, inside MAX_SWEEP_STATEMENTS_PER_RUN.
  const eventsOnly = { events: 30, events_daily: null, provider_notifications: null, signups: null, content_reports: null, ext_codes: null, ext_devices: null, native_attest_redeemed: null, native_attest_keys: null, native_attest_counters: null };
  const seedExpired = (db: ReturnType<typeof realPlatformDb>, n: number) => {
    db.db.exec(
      `INSERT INTO events (event_id, app_id, anon_id, event, server_ts)
       SELECT 'bulk-' || n, 'subscriptiontracker', 'a1', 'app_launch', '2020-01-01T00:00:00.000Z'
       FROM (WITH RECURSIVE c(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM c WHERE n < ${n}) SELECT n FROM c)`,
    );
    db.db.exec(
      `INSERT INTO events (event_id, app_id, anon_id, event, server_ts)
       VALUES ('keep-me', 'subscriptiontracker', 'a1', 'app_launch', '2026-08-10T00:00:00.000Z')`,
    );
  };

  it('🔴 2,500 expired rows are cleared in ONE run — it was 1,000 a night', async () => {
    const db = realPlatformDb();
    seedExpired(db, 2500);
    caughtUp(db);
    expect(MAX_ROWS_PER_SWEEP).toBe(1000);
    await retentionSweep(envOf(db), eventsOnly, NOW);
    expect(db.rows('SELECT event_id FROM events')).toEqual([{ event_id: 'keep-me' }]);
    const detail = String(heartbeat(db)[0].detail);
    expect(detail).toContain('deleted=2500 capped=0 passes=3');
    expect(detail).toContain('events=30d:2500');
  });

  it(`a store still full when the statement budget runs out is CAPPED, and the next night finishes it`, async () => {
    const db = realPlatformDb();
    seedExpired(db, 2500);
    caughtUp(db);
    // A budget of two passes: 2,000 rows, and the second pass was still full.
    await retentionSweep(envOf(db), eventsOnly, NOW, 2);
    expect(db.count('events')).toBe(2500 + 1 - 2 * MAX_ROWS_PER_SWEEP);
    expect(String(heartbeat(db)[0].detail)).toContain('deleted=2000 capped=1 passes=2');
    await retentionSweep(envOf(db), eventsOnly, NOW);
    expect(db.rows('SELECT event_id FROM events')).toEqual([{ event_id: 'keep-me' }]);
    expect(String(heartbeat(db)[1].detail)).toContain('capped=0');
  });

  it('a store the budget never reached counts as capped — it was not swept tonight', async () => {
    const db = realPlatformDb();
    seedExpired(db, 1500);
    caughtUp(db);
    db.db.exec("INSERT INTO signups (email, signed_up_at) VALUES ('old@example.com', '2020-01-01T00:00:00.000Z')");
    await retentionSweep(envOf(db), { ...eventsOnly, signups: 400 }, NOW, 2);
    // Both passes went to `events` (1,000 then 500): `events` is clean, `signups` untouched.
    expect(db.count('signups')).toBe(1);
    expect(String(heartbeat(db)[0].detail)).toContain('deleted=1500 capped=1 passes=2');
  });

  it('the shipped budget is the one JOB_STATEMENT_BUDGET counts', () => {
    expect(MAX_SWEEP_STATEMENTS_PER_RUN).toBeGreaterThan(0);
    expect(JOB_STATEMENT_BUDGET[RETENTION_SWEEP_JOB]).toBe(2 + MAX_SWEEP_STATEMENTS_PER_RUN);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('a failing DELETE is recorded as ok=0, never as "nothing to do"', () => {
  it('records the failure instead of swallowing it', async () => {
    const db = seeded();
    db.throwOnWrite = true;
    await retentionSweep(envOf(db), { events: 30, events_daily: null, provider_notifications: 30, signups: null, content_reports: null, ext_codes: null, ext_devices: null, native_attest_redeemed: null, native_attest_keys: null, native_attest_counters: null }, NOW);
    // The heartbeat write itself is best-effort and shares the same flag, so the
    // observable contract here is that the cron does not throw out of the sweep.
    db.throwOnWrite = false;
    expect(db.count('events')).toBe(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ⏱ 2026-09-15 · [ADR 087] THE SIGNUP LIST. 400 days from the ORIGINAL signup
// time, deleted by this sweep because a D1 table has no expiry of its own.
// ─────────────────────────────────────────────────────────────────────────────
describe('signups — the nikatru.com launch list is swept on its original signup time', () => {
  const seedSignups = (db: RealDb) =>
    db.db.exec(
      `INSERT INTO signups (email, signed_up_at) VALUES
         ('old@example.com',   '2020-01-01T00:00:00.000Z'),
         ('edge@example.com',  '${CUTOFF_30D}'),
         ('fresh@example.com', '2026-08-10T00:00:00.000Z')`,
    );

  it('deletes exactly the signups older than the period; the one AT the cutoff and the fresh one survive', async () => {
    const db = realPlatformDb();
    seedSignups(db);
    await retentionSweep(envOf(db), { events: null, events_daily: null, provider_notifications: null, signups: 30, content_reports: null, ext_codes: null, ext_devices: null, native_attest_redeemed: null, native_attest_keys: null, native_attest_counters: null }, NOW);
    expect(db.rows('SELECT email FROM signups ORDER BY email')).toEqual([
      { email: 'edge@example.com' },
      { email: 'fresh@example.com' },
    ]);
    const detail = String(heartbeat(db)[0].detail);
    expect(detail).toContain('signups=30d:1');
    expect(detail.length).toBeLessThanOrEqual(200);
  });

  it('undeclared is INERT for signups too — no DELETE is prepared and nothing is lost', async () => {
    const db = realPlatformDb();
    seedSignups(db);
    await retentionSweep(envOf(db), NONE, NOW);
    expect(db.count('signups')).toBe(3);
    expect(deletesPrepared(db)).toEqual([]);
  });

  it('the shipped sweep keeps a signup for SIGNUPS_RETENTION_DAYS and no longer', async () => {
    const db = realPlatformDb();
    const keep = new Date(NOW - (SIGNUPS_RETENTION_DAYS - 1) * 86400000).toISOString();
    const drop = new Date(NOW - (SIGNUPS_RETENTION_DAYS + 1) * 86400000).toISOString();
    db.db.exec(`INSERT INTO signups (email, signed_up_at) VALUES ('keep@example.com', '${keep}'), ('drop@example.com', '${drop}')`);
    await retentionSweep(envOf(db), undefined, NOW);
    expect(db.rows('SELECT email FROM signups')).toEqual([{ email: 'keep@example.com' }]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ⏱ 2026-09-24 · O-EXTENSION-ACCOUNT-CHECK-UNBUILT. THE EXTENSION'S ONE-TIME
// CODES, swept a day after `expires_at`. 🔴 EVERY TIMESTAMP IS ISO TEXT: the
// cutoff is an ISO string, and SQLite sorts every INTEGER below every TEXT, so an
// integer `expires_at` would put a LIVE code below any cutoff. The unexpired code
// seeded here is the row that proves the sweep reads `expires_at` as a time.
// ─────────────────────────────────────────────────────────────────────────────
describe('ext_codes — a one-time code is swept a day after it expires, never before', () => {
  const iso = (ms: number) => new Date(ms).toISOString();
  const seedCodes = (db: RealDb, nowMs: number) =>
    db.db.exec(
      `INSERT INTO ext_codes (code_hash, user_id, product, channel, redirect_uri, code_challenge, created_at, expires_at, used_at) VALUES
         ('h-ancient', 'u1', 'fullshot', 'amo', 'https://r.example/', 'c', '${iso(nowMs - 3 * 86400000)}', '${iso(nowMs - 3 * 86400000 + 120000)}', NULL),
         ('h-yesterday', 'u1', 'fullshot', 'amo', 'https://r.example/', 'c', '${iso(nowMs - 86400000 - 180000)}', '${iso(nowMs - 86400000 - 60000)}', '${iso(nowMs - 86400000 - 90000)}'),
         ('h-expired-an-hour-ago', 'u1', 'fullshot', 'amo', 'https://r.example/', 'c', '${iso(nowMs - 3600000 - 120000)}', '${iso(nowMs - 3600000)}', NULL),
         ('h-unexpired', 'u2', 'fullshot', 'amo', 'https://r.example/', 'c', '${iso(nowMs - 1000)}', '${iso(nowMs + 119000)}', NULL)`,
    );

  it('deletes the codes that expired more than a day ago; one expired an hour ago and one still UNEXPIRED survive', async () => {
    const db = realPlatformDb();
    seedCodes(db, NOW);
    await retentionSweep(
      envOf(db),
      { events: null, events_daily: null, provider_notifications: null, signups: null, content_reports: null, ext_codes: EXT_CODES_RETENTION_DAYS, ext_devices: null, native_attest_redeemed: null, native_attest_keys: null, native_attest_counters: null },
      NOW,
    );
    expect(db.rows('SELECT code_hash FROM ext_codes ORDER BY code_hash')).toEqual([
      { code_hash: 'h-expired-an-hour-ago' },
      { code_hash: 'h-unexpired' },
    ]);
    expect(String(heartbeat(db)[0].detail)).toContain(`ext_codes=${EXT_CODES_RETENTION_DAYS}d:2`);
  });

  it('the shipped sweep keeps an unexpired code — the default periods reach ext_codes and spare it', async () => {
    const db = realPlatformDb();
    seedCodes(db, NOW);
    await retentionSweep(envOf(db), undefined, NOW);
    expect(db.count('ext_codes', 'code_hash = ?', 'h-unexpired')).toBe(1);
    expect(db.count('ext_codes', 'code_hash = ?', 'h-ancient')).toBe(0);
  });

  it('undeclared is INERT for ext_codes too — no DELETE is prepared and nothing is lost', async () => {
    const db = realPlatformDb();
    seedCodes(db, NOW);
    await retentionSweep(envOf(db), NONE, NOW);
    expect(db.count('ext_codes')).toBe(4);
    expect(deletesPrepared(db)).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ⏱ 2026-09-25 · O-EXTENSION-ACCOUNT-CHECK-UNBUILT. A REVOKED LINKED DEVICE is
// deleted 30 days after `revoked_at`; a device that was never revoked is a live
// credential and is never swept, however old. 🔴 `revoked_at` has TEXT affinity
// and 0017 has no CHECK constraint, so an INTEGER written there is stored as the
// TEXT '1786…', which sorts below every ISO cutoff — the integer case below is
// the row that proves the sweep refuses a value it cannot date.
// ─────────────────────────────────────────────────────────────────────────────
describe('ext_devices — a revoked device is swept 30 days after revocation, a live one never', () => {
  const iso = (ms: number) => new Date(ms).toISOString();
  const DAY = 86400000;
  const ONLY_DEVICES: RetentionPeriods = {
    events: null,
    events_daily: null,
    provider_notifications: null,
    signups: null,
    content_reports: null,
    ext_codes: null,
    ext_devices: EXT_DEVICES_RETENTION_DAYS,
    native_attest_redeemed: null,
    native_attest_keys: null,
    native_attest_counters: null,
  };
  // Every token hash here is a made-up value; no credential exists in this file.
  const seedDevices = (db: RealDb, nowMs: number) => {
    db.db.exec(
      `INSERT INTO ext_devices (link_id, user_id, product, channel, token_hash, created_at, last_seen_at, revoked_at) VALUES
         ('l-revoked-31d', 'u1', 'fullshot', 'amo', 'th-fixture-1', '${iso(nowMs - 400 * DAY)}', '${iso(nowMs - 32 * DAY)}', '${iso(nowMs - 31 * DAY)}'),
         ('l-revoked-29d', 'u1', 'fullshot', 'amo', 'th-fixture-2', '${iso(nowMs - 400 * DAY)}', '${iso(nowMs - 30 * DAY)}', '${iso(nowMs - 29 * DAY)}'),
         ('l-live-100d',   'u2', 'fullshot', 'amo', 'th-fixture-3', '${iso(nowMs - 100 * DAY)}', '${iso(nowMs - DAY)}', NULL)`,
    );
    // UNQUOTED on purpose: an integer literal, milliseconds for "revoked yesterday".
    db.db.exec(
      `INSERT INTO ext_devices (link_id, user_id, product, channel, token_hash, created_at, last_seen_at, revoked_at) VALUES
         ('l-revoked-integer', 'u3', 'fullshot', 'amo', 'th-fixture-4', '${iso(nowMs - 400 * DAY)}', NULL, ${String(nowMs - DAY)})`,
    );
  };

  it('the shipped period is 30 days', () => {
    expect(EXT_DEVICES_RETENTION_DAYS).toBe(30);
  });

  it('deletes a device revoked 31 days ago', async () => {
    const db = realPlatformDb();
    seedDevices(db, NOW);
    await retentionSweep(envOf(db), ONLY_DEVICES, NOW);
    expect(db.count('ext_devices', 'link_id = ?', 'l-revoked-31d')).toBe(0);
  });

  it('keeps a device revoked 29 days ago', async () => {
    const db = realPlatformDb();
    seedDevices(db, NOW);
    await retentionSweep(envOf(db), ONLY_DEVICES, NOW);
    expect(db.count('ext_devices', 'link_id = ?', 'l-revoked-29d')).toBe(1);
  });

  it('keeps a never-revoked device inside its lifetime (created 100 days ago, used yesterday) — a live credential is never swept', async () => {
    const db = realPlatformDb();
    seedDevices(db, NOW);
    await retentionSweep(envOf(db), ONLY_DEVICES, NOW);
    expect(db.count('ext_devices', 'link_id = ?', 'l-live-100d')).toBe(1);
  });

  // ⏱ 2026-09-30 · EXA-11 (re-review finding 5). A link whose lifetime ended
  // (lib/ext-links.ts: 180 days at most, 30 days idle) and that was never
  // presented again is deleted 30 days after that end, as a revoked one is.
  const seedExpired = (db: RealDb, nowMs: number) => {
    db.db.exec(
      `INSERT INTO ext_devices (link_id, user_id, product, channel, token_hash, created_at, last_seen_at, revoked_at) VALUES
         ('l-age-211d',  'u4', 'fullshot', 'amo', 'th-fixture-5', '${iso(nowMs - 211 * DAY)}', '${iso(nowMs - DAY)}', NULL),
         ('l-age-209d',  'u4', 'fullshot', 'amo', 'th-fixture-6', '${iso(nowMs - 209 * DAY)}', '${iso(nowMs - DAY)}', NULL),
         ('l-idle-61d',  'u5', 'fullshot', 'amo', 'th-fixture-7', '${iso(nowMs - 70 * DAY)}', '${iso(nowMs - 61 * DAY)}', NULL),
         ('l-idle-59d',  'u5', 'fullshot', 'amo', 'th-fixture-8', '${iso(nowMs - 70 * DAY)}', '${iso(nowMs - 59 * DAY)}', NULL),
         ('l-never-61d', 'u6', 'fullshot', 'amo', 'th-fixture-9', '${iso(nowMs - 61 * DAY)}', NULL, NULL)`,
    );
  };

  it('🔴 deletes a never-revoked link older than 180 + 30 days, however recently used', async () => {
    const db = realPlatformDb();
    seedExpired(db, NOW);
    await retentionSweep(envOf(db), ONLY_DEVICES, NOW);
    expect(db.count('ext_devices', 'link_id = ?', 'l-age-211d')).toBe(0);
    expect(db.count('ext_devices', 'link_id = ?', 'l-age-209d')).toBe(1);
  });

  it('🔴 deletes a never-revoked link idle for more than 30 + 30 days; keeps one idle 59 days', async () => {
    const db = realPlatformDb();
    seedExpired(db, NOW);
    await retentionSweep(envOf(db), ONLY_DEVICES, NOW);
    expect(db.count('ext_devices', 'link_id = ?', 'l-idle-61d')).toBe(0);
    expect(db.count('ext_devices', 'link_id = ?', 'l-idle-59d')).toBe(1);
  });

  it('a link never used at all counts its idleness from created_at', async () => {
    const db = realPlatformDb();
    seedExpired(db, NOW);
    await retentionSweep(envOf(db), ONLY_DEVICES, NOW);
    expect(db.count('ext_devices', 'link_id = ?', 'l-never-61d')).toBe(0);
  });

  it('the expired limb is bounded per PASS like every other store (LIMIT ?), and swept again while full', async () => {
    const db = realPlatformDb();
    const rows: string[] = [];
    for (let i = 0; i < MAX_ROWS_PER_SWEEP + 5; i++) {
      rows.push(`('l-bulk-${i}', 'u7', 'fullshot', 'amo', 'th-bulk-${i}', '${iso(NOW - 300 * DAY)}', NULL, NULL)`);
    }
    db.db.exec(`INSERT INTO ext_devices (link_id, user_id, product, channel, token_hash, created_at, last_seen_at, revoked_at) VALUES ${rows.join(',')}`);
    // One pass: the LIMIT holds it to a batch, and the store is still full.
    await retentionSweep(envOf(db), ONLY_DEVICES, NOW, 1);
    expect(db.count('ext_devices')).toBe(5);
    expect(String(heartbeat(db)[0].detail)).toContain('capped=1');
    // ⏱ 2026-10-01: the shipped budget sweeps it again and finishes it.
    await retentionSweep(envOf(db), ONLY_DEVICES, NOW);
    expect(db.count('ext_devices')).toBe(0);
    expect(String(heartbeat(db)[1].detail)).toContain('capped=0');
  });

  it('binds an ISO-8601 TEXT cutoff, never a number', async () => {
    const db = realPlatformDb();
    seedDevices(db, NOW);
    await retentionSweep(envOf(db), ONLY_DEVICES, NOW);
    const deletes = deletesPrepared(db);
    expect(deletes).toHaveLength(1);
    expect(deletes[0]).toContain('FROM ext_devices WHERE (revoked_at < ?');
    // The DELETE's tuple is (cutoff, maxAgeCutoff, idleCutoff, MAX_ROWS_PER_SWEEP).
    const tuples = db.bound.filter((t) => t.length === 4 && t[3] === MAX_ROWS_PER_SWEEP);
    expect(tuples).toHaveLength(1);
    const cutoff = retentionCutoff(EXT_DEVICES_RETENTION_DAYS, NOW);
    expect(tuples[0][0]).toBe(cutoff);
    expect(tuples[0].slice(1, 3)).toEqual(extDevicesExpiredCutoffs(String(cutoff)));
    for (const v of tuples[0].slice(0, 3)) {
      expect(typeof v).toBe('string');
      expect(String(v)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    }
  });

  it('🔴 an INTEGER `revoked_at` is stored as TEXT and would match a bare `<` — the sweep keeps it anyway', async () => {
    const db = realPlatformDb();
    seedDevices(db, NOW);
    const cutoff = String(retentionCutoff(EXT_DEVICES_RETENTION_DAYS, NOW));
    // The schema does not refuse it: TEXT affinity converts the integer.
    expect(db.rows("SELECT typeof(revoked_at) AS t FROM ext_devices WHERE link_id = 'l-revoked-integer'")).toEqual([{ t: 'text' }]);
    // …and the bare comparison matches it, although it means "revoked yesterday".
    expect(db.count('ext_devices', 'link_id = ? AND revoked_at < ?', 'l-revoked-integer', cutoff)).toBe(1);
    await retentionSweep(envOf(db), ONLY_DEVICES, NOW);
    expect(db.count('ext_devices', 'link_id = ?', 'l-revoked-integer')).toBe(1);
  });

  it('reports its count in the retention heartbeat, as the other stores do', async () => {
    const db = realPlatformDb();
    seedDevices(db, NOW);
    await retentionSweep(envOf(db), ONLY_DEVICES, NOW);
    const rows = heartbeat(db);
    expect(rows).toHaveLength(1);
    expect(rows[0].target).toBe('(portfolio)');
    expect(rows[0].ok).toBe(1);
    const detail = String(rows[0].detail);
    expect(detail).toContain('declared=1');
    expect(detail).toContain('deleted=1');
    expect(detail).toContain(`ext_devices=${EXT_DEVICES_RETENTION_DAYS}d:1`);
  });

  it('the shipped sweep reaches ext_devices: the 31-day row goes, the other three stay, and the token fits the heartbeat', async () => {
    const db = realPlatformDb();
    seedDevices(db, NOW);
    await retentionSweep(envOf(db), undefined, NOW);
    expect(db.rows('SELECT link_id FROM ext_devices ORDER BY link_id')).toEqual([
      { link_id: 'l-live-100d' },
      { link_id: 'l-revoked-29d' },
      { link_id: 'l-revoked-integer' },
    ]);
    const detail = String(heartbeat(db)[0].detail);
    expect(detail).toContain(`ext_devices=${EXT_DEVICES_RETENTION_DAYS}d:1`);
    // recordHeartbeat slices at 200; under 200 means nothing was cut.
    expect(detail.length).toBeLessThan(200);
  });

  it('undeclared is INERT for ext_devices too — no DELETE is prepared and nothing is lost', async () => {
    const db = realPlatformDb();
    seedDevices(db, NOW);
    await retentionSweep(envOf(db), NONE, NOW);
    expect(db.count('ext_devices')).toBe(4);
    expect(deletesPrepared(db)).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ⏱ 2026-09-29 · ADR no.NNN — the native sign-in attestation state. A challenge
// is swept a day past `expires_at` (never before), a key when unused for
// NATIVE_ATTEST_KEYS_RETENTION_DAYS (a key used yesterday survives).
// ─────────────────────────────────────────────────────────────────────────────
describe('native_attest_* — redeemed nonces and counters in FULL, keys when long unused', () => {
  const iso = (ms: number) => new Date(ms).toISOString();
  const DAY = 86400000;
  it('the shipped sweep deletes the expired nonce, the stale key and yesterday\'s counter, and keeps the live ones', async () => {
    const db = realPlatformDb();
    const now = Date.now();
    db.db.exec(
      `INSERT INTO native_attest_redeemed (nonce, app_id, expires_at) VALUES
        ('n-live', 'subscriptiontracker', '${iso(now + 120_000)}'),
        ('n-recent', 'subscriptiontracker', '${iso(now - DAY / 2)}'),
        ('n-old', 'subscriptiontracker', '${iso(now - 3 * DAY)}')`,
    );
    db.db.exec(
      `INSERT INTO native_attest_keys (app_id, key_id, kind, public_key, sign_count, created_at, last_used_at) VALUES
        ('subscriptiontracker', 'k-used', 'app-attest', 'pk', 0, '${iso(now - 400 * DAY)}', '${iso(now - DAY)}'),
        ('subscriptiontracker', 'k-stale', 'app-attest', 'pk', 0, '${iso(now - 400 * DAY)}', '${iso(now - (NATIVE_ATTEST_KEYS_RETENTION_DAYS + 1) * DAY)}')`,
    );
    db.db.exec(
      `INSERT INTO native_attest_counters (day, scope, calls) VALUES
        ('${iso(now).slice(0, 10)}', 'play-integrity:decode', 3),
        ('${iso(now - 3 * DAY).slice(0, 10)}', 'play-integrity:decode', 9)`,
    );
    await retentionSweep(envOf(db));
    expect(db.rows('SELECT nonce FROM native_attest_redeemed ORDER BY nonce')).toEqual([{ nonce: 'n-live' }, { nonce: 'n-recent' }]);
    expect(db.rows('SELECT key_id FROM native_attest_keys')).toEqual([{ key_id: 'k-used' }]);
    expect(db.rows('SELECT calls FROM native_attest_counters')).toEqual([{ calls: 3 }]);
  });

  it('🔴 redeemed nonces are swept IN FULL — past the per-run row cap that bounds every other store', async () => {
    const db = realPlatformDb();
    const now = Date.now();
    const old = iso(now - 3 * DAY);
    const rows = Array.from({ length: 1_050 }, (_, i) => `('n-${i}', 'subscriptiontracker', '${old}')`).join(',');
    db.db.exec(`INSERT INTO native_attest_redeemed (nonce, app_id, expires_at) VALUES ${rows}`);
    await retentionSweep(envOf(db));
    expect(db.count('native_attest_redeemed')).toBe(0);
  });

  it('undeclared is INERT for all three — nothing is lost', async () => {
    const db = realPlatformDb();
    const now = Date.now();
    db.db.exec(`INSERT INTO native_attest_redeemed (nonce, app_id, expires_at) VALUES ('n-old', 'subscriptiontracker', '${iso(now - 3 * DAY)}')`);
    await retentionSweep(envOf(db), NONE, now);
    expect(db.count('native_attest_redeemed')).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE SHIPPED FILE, AND THE REGISTER IT ANSWERS TO.
//
// Correct whether or not the owner has declared a period — see the header.
// ─────────────────────────────────────────────────────────────────────────────
describe('the shipped constants and tooling/ops/register.json agree', () => {
  /** Widened on purpose: `EVENTS_RETENTION_DAYS` has the literal type `null`
   *  today and a numeric literal type after the owner acts. Reading both through
   *  `number | null` is what lets every case below compile in BOTH states. */
  const shipped: RetentionPeriods = {
    events: EVENTS_RETENTION_DAYS,
    events_daily: EVENTS_DAILY_RETENTION_DAYS,
    provider_notifications: PROVIDER_NOTIFICATIONS_RETENTION_DAYS,
    signups: SIGNUPS_RETENTION_DAYS,
    content_reports: CONTENT_REPORTS_RETENTION_DAYS,
    ext_codes: EXT_CODES_RETENTION_DAYS,
    ext_devices: EXT_DEVICES_RETENTION_DAYS,
    native_attest_redeemed: NATIVE_ATTEST_REDEEMED_RETENTION_DAYS,
    native_attest_keys: NATIVE_ATTEST_KEYS_RETENTION_DAYS,
    native_attest_counters: NATIVE_ATTEST_COUNTERS_RETENTION_DAYS,
  };

  const register = JSON.parse(registerRaw) as {
    rows: Array<Record<string, unknown>>;
    _retentionCoverage?: { _maxUndeclared?: number };
  };
  const rowFor = (store: RetentionStore) => {
    const id = `retention.d1.platform_db.${store}`;
    const row = register.rows.find((r) => r.id === id);
    expect(row, `${id} is gone from the register — the store has no recorded rule.`).toBeTruthy();
    return row as Record<string, unknown>;
  };

  // 🔴 `events_daily` ADDED 2026-08-13, AND ITS ABSENCE WAS NOT A JUDGEMENT CALL —
  // it was a silent hole. `EVENTS_DAILY_RETENTION_DAYS` was read into `shipped`
  // above and then never asserted, because this array — not the map — is what
  // every `it.each` below ranges over. MEASURED, not inferred: setting the
  // constant to 37 while both registers still said 1100 left 40 tests passing and
  // `assert-retention-coverage.mjs` / `assert-data-inventory.mjs` both green.
  //
  // 📌 A value that is READ but never ASSERTED looks exactly like a value that is
  // checked — it appears in the file, it type-checks, it is even used. The list
  // that drives the assertions is the coverage; the map is only the data. This is
  // the `check-migrations.mjs` failure in a new shape: the domain was smaller than
  // it looked and nothing said so.
  // ⏱ 2026-09-15 · `signups` ([ADR 087], 0011_signups.sql) joins the list the day it joins the sweep.
  // ⏱ 2026-09-24 · `ext_codes` (O-EXTENSION-ACCOUNT-CHECK-UNBUILT) joins the list the day it joins the sweep.
  // ⏱ 2026-09-25 · `ext_devices` (revoked devices, O-EXTENSION-ACCOUNT-CHECK-UNBUILT) joins it the same way.
  // ⏱ 2026-09-29 · the native attestation tables (ADR no.NNN) join it the same way; ⏱ 2026-09-30 `native_attest_redeemed` replaced `native_attest_challenges` (stateless challenges) and `native_attest_counters` joined.
  const stores: RetentionStore[] = ['events', 'events_daily', 'provider_notifications', 'signups', 'ext_codes', 'ext_devices', 'native_attest_redeemed', 'native_attest_keys', 'native_attest_counters'];

  it('duty.platform-cron WATCHES this job — otherwise it runs nightly and nothing reads its outcome', () => {
    const cron = register.rows.find((r) => r.id === 'duty.platform-cron') as
      | { watchedJobs?: Record<string, string[]> }
      | undefined;
    expect(cron?.watchedJobs, 'duty.platform-cron declares no watchedJobs').toBeTruthy();
    // The map shape landed 2026-09-03: a bare list could only mean "every job
    // runs on crons[0]", which stopped being true when the Worker gained a
    // second schedule. The claim here is unchanged — this job is watched.
    expect(Object.keys(cron?.watchedJobs ?? {})).toContain(RETENTION_SWEEP_JOB);
  });

  it.each(stores)('%s — the row NAMES the deleting job, declared or not', (store) => {
    // The whole point of P7: the job is named BEFORE the period exists, so the
    // owner's number does not arrive to find [14]O-17\'s "by a job" half missing.
    const job = rowFor(store).deletingJob;
    expect(typeof job === 'string' && job.trim() !== '', `${store} has no deletingJob`).toBe(true);
    expect(String(job)).toContain(RETENTION_SWEEP_JOB);
  });

  it.each(stores)('%s — the code and the register agree on whether a period exists', (store) => {
    const row = rowFor(store);
    const declared = shipped[store];
    if (declared === null) {
      expect(row.rule, `no period is declared in scheduled.ts; the register must still say so.`).toBe(
        'period-undeclared',
      );
    } else {
      expect(
        row.rule,
        `services/platform/src/scheduled.ts declares ${declared} day(s) for ${store} and the register still ` +
          'calls the period undeclared. Move the row to `rule: "period"` with a matching `periodDays`, and ratchet ' +
          '`_retentionCoverage._maxUndeclared` down by one in the same change.',
      ).toBe('period');
    }
  });

  it.each(stores)('%s — and on WHAT the period is, not merely that there is one', (store) => {
    // The stronger half. The case above passes for any non-undeclared rule; a
    // register claiming 30 days while the code deletes at 365 would satisfy it
    // completely. This is the `ttlSource` idea one store class over: the
    // register\'s number is READ OFF the code rather than asserted beside it.
    const row = rowFor(store);
    const declared = shipped[store];
    if (declared === null) {
      expect(row.periodDays, 'no period is declared in the code, so the register must not state one.').toBeUndefined();
      return;
    }
    expect(row.periodDays).toBe(declared);
  });

  it('the undeclared ceiling has ratcheted with the code — a closed gap must not fund a new one', () => {
    const undeclared = stores.filter((s) => shipped[s] === null).length;
    const cap = register._retentionCoverage?._maxUndeclared;
    expect(typeof cap).toBe('number');
    expect(
      cap,
      'a period was declared in scheduled.ts and `_retentionCoverage._maxUndeclared` still allows the old ' +
        'number of gaps. Leaving the ceiling where it was is how a cap silently buys back the room it just gave up.',
    ).toBeLessThanOrEqual(undeclared + register.rows.filter((r) => r.rule === 'period-undeclared' && !String(r.id).startsWith('retention.d1.platform_db.')).length);
  });
});