// ─────────────────────────────────────────────────────────────────────────────
// [pipeline 5]M-9 — THE CANCELLATION QUEUE HAS A DEPTH SOMEBODY CAN READ.
//
// 🔴 THE STATE THIS WAS BUILT AGAINST, MEASURED ON THIS TREE 2026-08-21.
// `cancellation_requests` had ONE writer (the INSERT in src/routes/cancellation.ts,
// which binds `executed_at` as the literal NULL) and NO reader outside the test
// suite: `executed_at` occurred in five code sites repository-wide and none of
// them read the column, there was no UPDATE of the table anywhere, and nothing
// in tooling/ops listed a pending row. A user who pressed cancel got an honest
// 202 and their request joined a queue whose depth nobody could state.
//
// The census does not drain anything — executing is owner-gated on the merchant
// of record's seller credential (OWNER_QUEUE A-1). What is under test here is
// the property that makes the depth READABLE, and every one of these is a shape
// this repository has already got wrong at least once:
//   · A ROW IS WRITTEN AT ZERO. A detector that records only when it found
//     something is silent in exactly the case it exists for.
//   · `ok` MEANS THE WORK SUCCEEDED, never "the queue is empty". Nothing here
//     can drain a row, so grading the backlog would be a permanent red — the
//     muted-alarm shape `analytics_liveness` paid for once.
//   · THE OLDEST IS THE OLDEST *UNDRAINED* ROW. `MIN(requested_at)` over the
//     whole table is pinned by the first request ever made and keeps growing
//     after every request has been executed — a clock, not a queue depth.
//
// The query runs against the REAL migrations on a real SQLite engine
// (test/harness.ts), so "counted the right rows" is a query rather than an
// inference from which methods the code happened to call.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from 'vitest';
import { cancellationDrainCensus, CANCELLATION_DRAIN_JOB, scheduled } from '../src/scheduled';
import { realPlatformDb, type RealDb } from './harness';
import type { Env } from '../src/types';

const envWith = (db: unknown) => ({ PLATFORM_DB: db }) as unknown as Env;

/** ISO timestamp `n` hours ago — relative, never a hardcoded calendar date, so
 *  the assertions do not quietly change meaning as the wall clock moves past a
 *  literal. Lexicographic order over these strings is chronological order, which
 *  is what `MIN()` relies on. */
const hours = (n: number) => new Date(Date.now() - n * 60 * 60 * 1000).toISOString();

/** Written with the SAME column list the route's only INSERT uses, against the
 *  real 0005 migration, so a census that named a column wrong could not pass. */
function insertRequest(
  db: RealDb,
  requestId: string,
  requestedAt: string,
  executedAt: string | null,
  reason: string | null = 'provider_not_configured',
) {
  db.db
    .prepare(
      `INSERT INTO cancellation_requests
         (request_id, user_id, app_id, environment, provider,
          provider_subscription_id, requested_at, executed_at, not_executed_reason)
       VALUES (?,?,?,?,?,?,?,?,?)`,
    )
    .run(requestId, 'user-1', 'subly', 'live', 'paddle', 'sub_1', requestedAt, executedAt, reason);
}

/** The leading `key=value` run, parsed the way a MACHINE reader would parse it.
 *
 *  ⚠️ CORRECTED 2026-08-22 — this doc used to end "…so asserting on the English
 *  would be checking a contract nothing depends on", and that sentence was doing
 *  real damage: it is exactly why the two zero-branches below went unpinned for
 *  two passes. The tokens of `recorded === 0` and of `undrained === 0` when
 *  `recorded` is also 0 are BYTE-IDENTICAL (`undrained=0 recorded=0 oldest=none
 *  oldest_age_h=0`) — the only thing that separates the two branches is the
 *  English after the em dash, so a suite that refuses to read English cannot
 *  tell them apart, and either limb could be deleted in silence. The English is
 *  a HUMAN reader's contract (check-heartbeats.mjs prints `detail` verbatim to
 *  an operator), and `prose` below grades it. */
const tokens = (detail: unknown): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const m of String(detail).matchAll(/([A-Za-z_][A-Za-z0-9_]*)=(\S+)/g)) {
    if (!(m[1] in out)) out[m[1]] = m[2];
  }
  return out;
};

const beats = (db: RealDb) =>
  db.rows(`SELECT * FROM cron_heartbeat WHERE job = '${CANCELLATION_DRAIN_JOB}'`);

/** The operator-facing half of `detail`: everything after the token run's em
 *  dash. Compared WHOLE rather than by substring — a substring match on
 *  "recorded" would pass against either zero-branch and put the pin back where
 *  it was. */
//  ⚠️ NO `i === -1` FALLBACK. It was written and then DELETED the same day: the
//  census emits the em dash on every one of its four paths, so no input reaches
//  the fallback, and a `? '' :` arm that cannot be taken makes the helper look
//  defensive while grading nothing. Measured — with the fallback in place,
//  forcing its condition to `false` left this file 13/13 green. Without it, a
//  detail that ever stops carrying the dash makes `slice(1)` return almost the
//  whole line and every `toBe` here goes red, which is the correct outcome.
const prose = (detail: unknown): string => String(detail).slice(String(detail).indexOf('— ') + 2);

/**
 * `detail` is sliced to 200 chars by `recordHeartbeat`, and the tokens lead — so
 * a truncation would eat the tail first. The two counts are the only unbounded
 * tokens, so the bound checked is the measured length PLUS headroom for both of
 * them reaching seven digits, not the length of a two-row fixture.
 */
const HEADROOM = 2 * (7 - 1);
const fitsTheSlice = (detail: unknown) =>
  expect(String(detail).length + HEADROOM).toBeLessThanOrEqual(200);

describe('the census writes a row even when there is nothing to report', () => {
  it('records depth zero on an empty table, under this job name', async () => {
    const db = realPlatformDb();
    await cancellationDrainCensus(envWith(db));

    const rows = beats(db);
    expect(rows).toHaveLength(1);
    expect(rows[0].job).toBe('cancellation_drain');
    expect(rows[0].target).toBe('(portfolio)');
    expect(Number(rows[0].ok)).toBe(1);

    const t = tokens(rows[0].detail);
    // 🔴 BOTH TOKENS. `undrained=0` alone reads identically for "everything was
    // executed" and "nobody ever asked"; the pair is what tells them apart.
    expect(t.undrained).toBe('0');
    expect(t.recorded).toBe('0');
    fitsTheSlice(rows[0].detail);
  });
});

describe('undrained is the rows with no executed_at, and nothing else', () => {
  it('counts only the NULL rows, and dates the oldest UNDRAINED one', async () => {
    const db = realPlatformDb();
    // Drained, and the oldest row in the table by a wide margin. A census that
    // reported `MIN(requested_at)` would be pinned here forever.
    insertRequest(db, 'r-drained', hours(500), hours(400), null);
    insertRequest(db, 'r-old', hours(300), null);
    insertRequest(db, 'r-new', hours(100), null);

    await cancellationDrainCensus(envWith(db));
    const t = tokens(beats(db)[0].detail);

    expect(t.recorded).toBe('3');
    expect(t.undrained).toBe('2');
    // The value the operator acts on: how long the oldest UNANSWERED request has
    // been waiting. ~300h, not the ~500h of the executed row.
    expect(Number(t.oldest_age_h)).toBeGreaterThan(299);
    expect(Number(t.oldest_age_h)).toBeLessThan(301);
    expect(Number(beats(db)[0].ok)).toBe(1);
    fitsTheSlice(beats(db)[0].detail);
  });

  it('is ok=1 with a real backlog — grading it would be a permanent red', async () => {
    const db = realPlatformDb();
    insertRequest(db, 'r-1', hours(10), null);
    await cancellationDrainCensus(envWith(db));
    // Nothing in this Worker can drain a row, so `ok = undrained === 0` would go
    // red the night the first cancellation arrives and stay red until an
    // owner-gated credential lands. [ADR 035].
    expect(Number(beats(db)[0].ok)).toBe(1);
    expect(tokens(beats(db)[0].detail).undrained).toBe('1');
  });

  it('separates "all executed" from "never asked" — both are undrained=0', async () => {
    const empty = realPlatformDb();
    await cancellationDrainCensus(envWith(empty));

    const drained = realPlatformDb();
    insertRequest(drained, 'r-1', hours(50), hours(40), null);
    insertRequest(drained, 'r-2', hours(30), hours(20), null);
    await cancellationDrainCensus(envWith(drained));

    const a = tokens(beats(empty)[0].detail);
    const b = tokens(beats(drained)[0].detail);
    expect(a.undrained).toBe('0');
    expect(b.undrained).toBe('0');
    // The token that discriminates. Without `recorded`, these two states are the
    // same line and an operator cannot tell a working drain from an idle rail.
    expect(a.recorded).toBe('0');
    expect(b.recorded).toBe('2');
    fitsTheSlice(beats(drained)[0].detail);
  });
});

describe('an age that cannot be computed says so', () => {
  it('reports oldest_age_h=unknown rather than a silent zero', async () => {
    const db = realPlatformDb();
    // `requested_at` is a bare TEXT column with no CHECK, so this row is
    // reachable. Reported as `0` it would read as "the queue is brand new" at
    // exactly the moment nobody can tell how old it is.
    insertRequest(db, 'r-bad', 'not-a-date', null);
    await cancellationDrainCensus(envWith(db));

    const t = tokens(beats(db)[0].detail);
    expect(t.undrained).toBe('1');
    expect(t.oldest_age_h).toBe('unknown');
    expect(Number(beats(db)[0].ok)).toBe(1);
  });
});

describe('a query that could not run is never "nothing is waiting"', () => {
  it('records ok=0 when the census query throws', async () => {
    const db = realPlatformDb();
    insertRequest(db, 'r-1', hours(10), null);
    // Only the census read fails; the heartbeat write still has to land, because
    // a failure that records nothing is indistinguishable from a run that never
    // happened — and "absent" and "failed" have different responses.
    const broken = {
      prepare(sql: string) {
        if (sql.includes('FROM cancellation_requests')) {
          return {
            first: async () => {
              throw new Error('d1 down');
            },
          };
        }
        return db.prepare(sql);
      },
      batch: (statements: unknown[]) => db.batch(statements as never),
    };

    await cancellationDrainCensus(envWith(broken));
    const rows = beats(db);
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].ok)).toBe(0);
    expect(String(rows[0].detail)).toContain('FAILED');
    // Not a number. A reader that parsed this as 0 would get NaN, loudly.
    expect(tokens(rows[0].detail).undrained).toBe('unknown');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ADDED 2026-08-22 — THE HALF THAT WAS DECORATION.
//
// The six cases above pin four things: both `CASE WHEN … IS NULL` limbs of the
// query, the `Number.isFinite` branch, and `ok = false` in the catch. Everything
// else in `cancellationDrainCensus` survived an `if (false)` sweep with this
// file at 6/6 green — measured, twice, by two independent reviewers — which made
// the census look guarded while most of it was not. The cases below close that,
// one condition at a time. Each names the mutation it exists to redden, so the
// next reader can re-run the sweep rather than trust this paragraph.
//
// THE RE-RUN, so this paragraph is a measurement and not a promise. 20 mutants —
// the FOURTEEN mutation points in `cancellationDrainCensus` (every condition it
// contains, its two SQL `CASE` limbs, the catch's `ok = false`, and the
// ` oldest=` token), `recordHeartbeat`'s one row-count guard, the handler call
// site, and the four conditions THIS FILE's own helper and stubs contain — each
// set to its `if (false)` equivalent one at a time, against a baseline of
// EXIT 0, 13 passed.
// 17 red in vitest · 2 red only in `tsc --noEmit` (EXIT 2), stated as such rather
// than counted as test coverage · 1 SURVIVOR, `if (rows.length === 0) return;`
// in `recordHeartbeat`, which predates this work and which nothing here reaches.
// 🔴 A FIXTURE THAT DOES NOT TEST ITSELF IS ALSO A DECORATION, and one of these
// cases was: "survives first() returning null" originally ran against an EMPTY
// table, whose real answer is byte-identical to the stub's, so the stub's own
// router could be switched off with the case still green. It now inserts a row
// first. Two conditions were DELETED rather than pinned — `?? 0` in the source's
// `recorded` normalisation, and an `i === -1` fallback in `prose` above — because
// no input could reach either.
// ─────────────────────────────────────────────────────────────────────────────

describe('the census is actually wired into the nightly cron', () => {
  it('writes a cancellation_drain beat when the SCHEDULED HANDLER runs', async () => {
    // 🔴 PINS `await cancellationDrainCensus(env)` INSIDE `scheduled`. Until this
    // case existed, deleting that line left the whole suite green: no test in
    // services/platform/test imported the handler, every import from that module
    // was of a named function or constant, and `deriveWatchedJobs` is satisfied
    // by the constant reaching `recordHeartbeat` INSIDE the function whether or
    // not anything calls it. A census nothing calls records nothing and looks
    // exactly like a census that found nothing.
    const db = realPlatformDb();
    insertRequest(db, 'r-1', hours(12), null);

    // `scheduled` hands its work to `ctx.waitUntil` and returns immediately, so
    // a ctx that drops the promise would make this test pass against a handler
    // that never ran. Collect and await.
    const pending: Promise<unknown>[] = [];
    const ctx = {
      waitUntil: (p: Promise<unknown>) => pending.push(p),
      passThroughOnException: () => {},
    };
    await scheduled({} as never, envWith(db), ctx as never);
    expect(pending).toHaveLength(1);
    await Promise.all(pending);

    const mine = beats(db);
    expect(mine).toHaveLength(1);
    expect(tokens(mine[0].detail).undrained).toBe('1');

    // AND THE WHOLE CENSUS, not just this limb. `duty.platform-cron.watchedJobs`
    // in tooling/ops/register.json names six jobs; a job the register watches
    // and the handler never runs reads as "absent" forever, which is the
    // `analytics_liveness` incident. This is the only test in the tree that runs
    // the real handler, so it is the only place that fact is checkable.
    const jobs = db.rows('SELECT DISTINCT job FROM cron_heartbeat ORDER BY job').map((r) => r.job);
    expect(jobs).toEqual([
      'analytics_liveness',
      'cancellation_drain',
      'events_rollup',
      'renewals',
      'retention_sweep',
      'supabase_keepalive',
    ]);
  });
});

describe('the two zero-branches say different things to a human', () => {
  it('an empty table and a fully drained one are NOT the same sentence', async () => {
    // 🔴 PINS `recorded === 0` AND `undrained === 0`. Their TOKENS are identical
    // when the table is empty, so only these two strings tell the branches
    // apart. Forcing either condition to `false` reddens exactly one of them.
    const empty = realPlatformDb();
    await cancellationDrainCensus(envWith(empty));
    expect(prose(beats(empty)[0].detail)).toBe(
      'nothing has ever been recorded, so the queue depth is zero rather than unknown.',
    );

    const drained = realPlatformDb();
    insertRequest(drained, 'r-1', hours(50), hours(40), null);
    await cancellationDrainCensus(envWith(drained));
    expect(prose(beats(drained)[0].detail)).toBe(
      'every recorded request carries executed_at.',
    );

    // The backlog branch is the third sentence, and it is the one an operator
    // acts on. Naming it here keeps all three in one place.
    const backlog = realPlatformDb();
    insertRequest(backlog, 'r-1', hours(9), null);
    await cancellationDrainCensus(envWith(backlog));
    expect(prose(beats(backlog)[0].detail)).toContain('UNDRAINED');
  });
});

describe('oldest is a timestamp an operator can act on', () => {
  it('carries the oldest UNDRAINED row verbatim, not just its age', async () => {
    // 🔴 PINS THE ` oldest=${oldest}` TOKEN. Deleting it left the suite green:
    // the three cases above read `undrained`, `recorded` and `oldest_age_h` and
    // never `oldest`. An age alone cannot be joined back to a row.
    const db = realPlatformDb();
    const oldestRowInTable = hours(900); // executed — must NOT be reported
    const oldestUndrained = hours(200);
    insertRequest(db, 'r-drained', oldestRowInTable, hours(800), null);
    insertRequest(db, 'r-old', oldestUndrained, null);
    insertRequest(db, 'r-new', hours(20), null);

    await cancellationDrainCensus(envWith(db));
    const t = tokens(beats(db)[0].detail);
    expect(t.oldest).toBe(oldestUndrained);
    expect(t.oldest).not.toBe(oldestRowInTable);
    expect(t.recorded).toBe('3');
    expect(t.undrained).toBe('2');
  });

  it('never reports a NEGATIVE age when a row is dated in the future', async () => {
    // 🔴 PINS `Math.max(0, …)`. `requested_at` is a bare TEXT column with no
    // CHECK and clock skew between a Worker and whatever wrote the row is real,
    // so a future timestamp is reachable. Un-clamped it prints
    // `oldest_age_h=-5.0`, which sorts and compares as "younger than brand new"
    // in every reader that treats the number as a duration.
    const db = realPlatformDb();
    insertRequest(db, 'r-future', hours(-5), null);
    await cancellationDrainCensus(envWith(db));

    const t = tokens(beats(db)[0].detail);
    expect(t.oldest_age_h).toBe('0.0');
    expect(Number(t.oldest_age_h)).toBeGreaterThanOrEqual(0);
    expect(Number(beats(db)[0].ok)).toBe(1);
  });
});

describe('a malformed aggregate row is normalised, not propagated', () => {
  it('survives first() returning null — no row object at all', async () => {
    // 🔴 PINS THE `row?.` CHAINS and the `row?.undrained == null` guard. D1's
    // `.first()` is typed `T | null`; an aggregate always returns a row today,
    // but the type says otherwise and the guards are what make that true rather
    // than lucky. Drop any one of them and this row is a caught TypeError, i.e.
    // ok=0 and `undrained=unknown` — a census that reports FAILED on a healthy
    // empty queue.
    const db = realPlatformDb();
    // ⚠️ A REAL ROW GOES IN FIRST, and that is not decoration. Without it the
    // table is empty, the census over the REAL table answers `recorded=0
    // undrained=0` — byte-identical to what the null row produces — and the
    // stub's own `sql.includes` router could be switched off with this case
    // still green, i.e. the fixture would not be testing its own fixture.
    // Measured: with this row present, disabling the router reddens the case.
    insertRequest(db, 'r-1', hours(7), null);
    const nullFirst = {
      prepare(sql: string) {
        if (sql.includes('FROM cancellation_requests')) return { first: async () => null };
        return db.prepare(sql);
      },
      batch: (statements: unknown[]) => db.batch(statements as never),
    };

    await cancellationDrainCensus(envWith(nullFirst));
    const rows = beats(db);
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].ok)).toBe(1);
    const t = tokens(rows[0].detail);
    expect(t.recorded).toBe('0');
    expect(t.undrained).toBe('0');
    expect(t.oldest_age_h).toBe('0');
  });

  // 🔴 THE TWO `|| 0` FALLBACKS NEED SEPARATE FIXTURES, and the reason is the
  // detail's own branching: the two zero-branches print `undrained=0 recorded=0`
  // and `undrained=0` as LITERALS, so a fixture that drives both counts to zero
  // grades the literal text and not the arithmetic. Each case below therefore
  // corrupts ONE count and leaves the other a real number, so the corrupted one
  // is the value actually interpolated into the string.
  const stub = (db: RealDb, aggregate: Record<string, unknown>) => ({
    prepare(sql: string) {
      if (sql.includes('FROM cancellation_requests')) return { first: async () => aggregate };
      return db.prepare(sql);
    },
    batch: (statements: unknown[]) => db.batch(statements as never),
  });

  it('survives a non-numeric `undrained` — `|| 0`, never NaN in the detail', async () => {
    // 🔴 PINS `|| 0` ON `undrained`. Drop it and this fixture falls through to
    // the backlog branch and prints `undrained=NaN`, because `NaN === 0` is
    // false. Every downstream reader that asks `Number(t.undrained) > 0` then
    // answers FALSE, so a queue of unknown depth is reported as drained.
    const db = realPlatformDb();
    await cancellationDrainCensus(envWith(stub(db, { recorded: 3, undrained: 'some', oldest: null })));

    const t = tokens(beats(db)[0].detail);
    expect(t.recorded).toBe('3');
    expect(t.undrained).toBe('0');
    expect(prose(beats(db)[0].detail)).toBe('every recorded request carries executed_at.');
    expect(String(beats(db)[0].detail)).not.toContain('NaN');
  });

  it('survives a non-numeric `recorded` — `|| 0`, never NaN in the detail', async () => {
    // 🔴 PINS `|| 0` ON `recorded`. Drop it and `recorded === 0` is false for a
    // NaN, so this fixture prints `recorded=NaN` beside a real `undrained=2` —
    // the exact pair the census exists to make readable.
    const db = realPlatformDb();
    await cancellationDrainCensus(envWith(stub(db, { recorded: 'lots', undrained: 2, oldest: hours(4) })));

    const t = tokens(beats(db)[0].detail);
    expect(t.recorded).toBe('0');
    expect(String(beats(db)[0].detail)).not.toContain('NaN');
  });
});
