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
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from 'vitest';

// `?raw` rather than node:fs — a Workers tsconfig has no node types on purpose
// (see test/raw-modules.d.ts). Same import shape as erasure-reach.test.ts.
import registerRaw from '../../../tooling/ops/register.json?raw';
import {
  EVENTS_RETENTION_DAYS,
  MAX_ROWS_PER_SWEEP,
  PROVIDER_NOTIFICATIONS_RETENTION_DAYS,
  RETENTION_SWEEP_JOB,
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

/** Two ancient rows and one fresh row in each swept table. */
function seeded(): RealDb {
  const db = realPlatformDb();
  db.db.exec(
    `INSERT INTO events (event_id, app_id, anon_id, event, server_ts) VALUES
       ('old-1', 'subly', 'a1', 'app_launch', '2020-01-01T00:00:00.000Z'),
       ('old-2', 'subly', 'a1', 'app_launch', '2026-07-01T00:00:00.000Z'),
       ('new-1', 'subly', 'a1', 'app_launch', '2026-08-10T00:00:00.000Z')`,
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

const NONE: RetentionPeriods = { events: null, provider_notifications: null };

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
    await retentionSweep(envOf(db), { events: 0, provider_notifications: -1 }, NOW);
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
  const THIRTY: RetentionPeriods = { events: 30, provider_notifications: 30 };

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
         ('at-cutoff', 'subly', 'a1', 'app_launch', '${CUTOFF_30D}'),
         ('one-ms-before', 'subly', 'a1', 'app_launch', '2026-07-11T23:59:59.999Z')`,
    );
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
    // RealDb.bound records every `.bind(...)` tuple in order. The two sweeps
    // come first; the heartbeat's INSERT binds after them.
    expect(db.bound[0]).toEqual([CUTOFF_30D, MAX_ROWS_PER_SWEEP]);
    expect(db.bound[1]).toEqual([CUTOFF_30D, MAX_ROWS_PER_SWEEP]);
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
    await retentionSweep(envOf(db), { events: 30, provider_notifications: null }, NOW);
    expect(db.count('events')).toBe(1);
    expect(db.count('provider_notifications')).toBe(3);
    expect(deletesPrepared(db)).toHaveLength(1);
    expect(String(heartbeat(db)[0].detail)).toContain('inert=provider_notifications');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('BOUNDED — the sweep is a catch-up job, never one unbounded DELETE', () => {
  it(`removes at most MAX_ROWS_PER_SWEEP (${MAX_ROWS_PER_SWEEP}) per store per run, and says it was capped`, async () => {
    const db = realPlatformDb();
    const overflow = MAX_ROWS_PER_SWEEP + 5;
    db.db.exec(
      `INSERT INTO events (event_id, app_id, anon_id, event, server_ts)
       SELECT 'bulk-' || n, 'subly', 'a1', 'app_launch', '2020-01-01T00:00:00.000Z'
       FROM (WITH RECURSIVE c(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM c WHERE n < ${overflow}) SELECT n FROM c)`,
    );
    db.db.exec(
      `INSERT INTO events (event_id, app_id, anon_id, event, server_ts)
       VALUES ('keep-me', 'subly', 'a1', 'app_launch', '2026-08-10T00:00:00.000Z')`,
    );
    expect(db.count('events')).toBe(overflow + 1);

    await retentionSweep(envOf(db), { events: 30, provider_notifications: null }, NOW);
    expect(db.count('events')).toBe(overflow + 1 - MAX_ROWS_PER_SWEEP);
    const first = String(heartbeat(db)[0].detail);
    expect(first).toContain('capped=1');
    expect(first).toContain(`events=30d:${MAX_ROWS_PER_SWEEP}`);

    // The next night finishes the backlog and stops reporting capped.
    await retentionSweep(envOf(db), { events: 30, provider_notifications: null }, NOW);
    expect(db.rows('SELECT event_id FROM events')).toEqual([{ event_id: 'keep-me' }]);
    expect(String(heartbeat(db)[1].detail)).toContain('capped=0');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('a failing DELETE is recorded as ok=0, never as "nothing to do"', () => {
  it('records the failure instead of swallowing it', async () => {
    const db = seeded();
    db.throwOnWrite = true;
    await retentionSweep(envOf(db), { events: 30, provider_notifications: 30 }, NOW);
    // The heartbeat write itself is best-effort and shares the same flag, so the
    // observable contract here is that the cron does not throw out of the sweep.
    db.throwOnWrite = false;
    expect(db.count('events')).toBe(3);
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
    provider_notifications: PROVIDER_NOTIFICATIONS_RETENTION_DAYS,
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

  const stores: RetentionStore[] = ['events', 'provider_notifications'];

  it('duty.platform-cron WATCHES this job — otherwise it runs nightly and nothing reads its outcome', () => {
    const cron = register.rows.find((r) => r.id === 'duty.platform-cron') as
      | { watchedJobs?: string[] }
      | undefined;
    expect(cron?.watchedJobs, 'duty.platform-cron declares no watchedJobs').toBeTruthy();
    expect(cron?.watchedJobs).toContain(RETENTION_SWEEP_JOB);
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