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
  // ⚠️ THREE ATOMS OF THIS ONE REGEX WERE GREEN AND UNDISCLOSED UNTIL 2026-08-24.
  // Each is dispositioned HERE, at the code site, rather than merged into a
  // neighbouring row. Measured in a mirror on 2026-08-24, one mutation at a
  // time, against a baseline of EXIT 0 / 17 passed: all three left the file
  // EXIT 0 / 17 passed. What separates them is not whether a test caught them —
  // none did — but whether ANY INPUT could tell the two spellings apart.
  //
  // 🔴 THE LITERAL `=` IS PINNED, because it is the one that changes a verdict.
  // Relaxed to `=?` the key still matches, the optional `=` backtracks to empty,
  // and `\S+` takes the equals sign as the VALUE. On a detail whose `oldest` is
  // EMPTY the two spellings disagree outright: `oldest= oldest_age_h=unknown`
  // reads `oldest` as ABSENT with the `=` required, and as the string `"="`
  // without it — one spelling tells an operator the timestamp is missing, the
  // other shows them `=` as the timestamp. `requested_at` is a bare
  // `TEXT NOT NULL` with no CHECK (migrations/0005_cancellation_requests.sql,
  // anchor `requested_at    TEXT NOT NULL`), so the empty string is storable and
  // the case below drives it through the REAL table, not a stub:
  //   "an EMPTY oldest is an absent token, never the equals sign itself".
  //
  // ✅ DECLARED, NOT PINNED — the leading class `[A-Za-z_]` widened to
  // `[A-Za-z0-9_]`. NO INPUT SEPARATES THE TWO, so there is no case to write. A
  // match can never cross whitespace — neither the key class, nor `=`, nor `\S+`
  // admits a space — so the widening can only change the reading of a token that
  // STARTS with a digit, and every token this census emits starts with one of
  // the four key LITERALS `undrained` `recorded` `oldest` `oldest_age_h`.
  // Widening the first character of a key that is already a letter is a no-op.
  // Checked against all four detail paths including a `String(err)` tail
  // carrying `1x=y`: the four keys read identically under both spellings.
  //
  // ✅ DECLARED, NOT PINNED — the quantifier `*` tightened to `+`. This is the
  // NARROWING direction, so "green by construction" does not excuse it, and it
  // still cannot change a verdict: `+` drops only ONE-CHARACTER keys, and the
  // shortest key the census emits — or that any assertion in this file reads —
  // is `oldest`, at six characters.
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
//
//  🔴 AND THE FOUR-PATH CLAIM IS NOW A POINTER TO FOUR CASES, NOT A SENTENCE.
//  A deletion justified by "the census emits the em dash on every one of its
//  four paths" was, until 2026-08-24, TEST-ENFORCED ON TWO OF THEM — the two
//  zero-branches, held whole-string by "an empty table and a fully drained one
//  are NOT the same sentence". The other two survived, measured in a mirror on
//  2026-08-24 one mutation at a time against a baseline of EXIT 0 / 17 passed:
//    · src/scheduled.ts backlog separator ` — UNDRAINED:` -> ` :: UNDRAINED:`
//      => EXIT 0 / 17 passed. That branch was graded only by
//      `toContain('UNDRAINED')`, and a substring survives a wrong slice.
//    · src/scheduled.ts catch separator ` — the drain census query FAILED`
//      -> ` :: the drain census query FAILED` => EXIT 0 / 17 passed. That path
//      was graded by `toContain('FAILED')` on the RAW detail and never called
//      `prose` at all.
//  Both are now held WHOLE-LINE by the two cases in "the em dash is the
//  separator on every path". The claim above is a check, so it is code now.
//
//  🔴 THE SPACE INSIDE `'— '` IS AN ATOM OF ITS OWN, AND IT IS PINNED. Dropping
//  it to `indexOf('—')` while leaving the `+ 2` alone was EXIT 0 / 17 passed,
//  same run — a no-op on every detail whose dash IS followed by a space, which
//  is why it sat green while its neighbours (`+ 2` -> `+ 1`, `'— '` -> `'~ '`)
//  are both red. It is not the exempt direction: the space is what NARROWS the
//  search, and the `+ 2` offset keeps assuming it is there. `oldest` is
//  interpolated verbatim from a bare TEXT column, so a value carrying its OWN em
//  dash separates the two spellings — shipped skips it and slices at the real
//  separator, the mutant slices two characters into the VALUE. The first case in
//  "the em dash is the separator on every path" drives exactly that row.
const prose = (detail: unknown): string => String(detail).slice(String(detail).indexOf('— ') + 2);

/**
 * `detail` is sliced to 200 chars by `recordHeartbeat`, and the tokens lead — so
 * a truncation would eat the tail first. The two counts are the only unbounded
 * tokens, so the bound checked is the measured length PLUS headroom for both of
 * them reaching seven digits, not the length of a two-row fixture.
 *
 * ⚠️ THIS IS AN ASSERTION, NOT A GUARD, so only ONE of its two directions can
 * ever be measured and that is said here rather than counted as coverage.
 * LOOSENING it is green by construction — `200 -> 1000000` and `HEADROOM -> 0`
 * both left this file 17/17 green, measured 2026-08-24. TIGHTENING is what says
 * the bound is live: `200 -> 120` goes RED, and `HEADROOM -> 92` goes RED, same
 * run. A pair that reddens in the tightening direction is a bound with a real
 * margin; a pair green in both would be a number nothing stands on.
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
    // ✅ DECLARED — this PAIR is a restatement, not a second check. Measured
    // 2026-08-24, deleting EITHER bound alone leaves the file EXIT 0 / 17
    // passed, because the "carries the oldest UNDRAINED row verbatim" case
    // below pins `t.oldest` to the exact undrained timestamp and therefore
    // already excludes the ~500h drained row this fixture is built to rule out.
    // The pair is kept because it states the property in the units an operator
    // reads (hours, not an ISO string) at the site where the fixture makes it
    // legible. Neither line can change a verdict on its own.
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
    //
    // ✅ DECLARED, NOT PINNED — and the sentence above USED TO CARRY THE CHECK.
    // It presented `expect(pending).toHaveLength(1)` as what refutes a dropped
    // promise. It is not: measured 2026-08-24, deleting that line alone leaves
    // this file EXIT 0 / 17 passed, and so does deleting
    // `expect(mine).toHaveLength(1)` alone. What actually refutes a dropped
    // promise is the heartbeat row — `expect(tokens(mine[0].detail).undrained)`
    // reads a value that only exists if the awaited census ran. Both length
    // checks are RESTATEMENTS of a property that assertion already holds, kept
    // as LOCATORS: they say WHERE the run stopped when the row is missing. No
    // input makes either disagree with the assertion covering it, so neither can
    // change a verdict, and declaring that is the honest disposition.
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
    // in tooling/ops/register.json names SEVEN jobs (six until 2026-09-03); a job the register watches
    // and the handler never runs reads as "absent" forever, which is the
    // `analytics_liveness` incident. This is the only test in the tree that runs
    // the real handler, so it is the only place that fact is checkable.
    // ⚠️ `ORDER BY job` IS A DETERMINISM DEVICE, NOT A CHECK, and no test can
    // redden its removal: measured 2026-08-24, dropping it left this file
    // 17/17 green because SQLite happened to return the DISTINCT set in that
    // order anyway. It is KEPT because its mutation is one-directional — losing
    // it can only ever turn a passing run into a FALSE RED, never hide a job the
    // handler failed to write, since the same seven names are still compared.
    // (The sibling `ORDER BY request_id` below is the same class but IS red on
    // removal — there the rowid order and the expected order genuinely differ.)
    //
    // ⚠️ `DISTINCT` IS THE SECOND GREEN ATOM IN THIS ONE SELECT, and the
    // enumeration that paid for `ORDER BY job` omitted it. Paid here. Measured
    // 2026-08-24 after the last edit to this file: drop `DISTINCT` and keep
    // everything else and the file is EXIT 0 / 17 passed, `tsc --noEmit` EXIT 0.
    //
    // It is NOT the widening direction, so "green by construction" does not
    // excuse it: removing `DISTINCT` can only ever ADD rows, which makes the
    // assertion STRICTER, and the strict form passes. It is KEPT for a reason
    // that is not "obviously right" — `recordHeartbeat` (../src/scheduled.ts)
    // inserts ONE ROW PER ELEMENT of the array it is handed, so a FAN-OUT limb
    // writes several rows in a single run: the keep-alive writes one per Supabase
    // target and the renewals limb one per app target. What this assertion is
    // about is the SET of job names the register watches, not how many rows each
    // job wrote, and the strict form would go RED the day a second target of
    // either kind is configured — a false red with nothing to do with the census.
    //
    // ⚠️ AND THE CHECK IT THEREFORE DOES NOT MAKE, said plainly rather than left
    // to be assumed: a job that wrote TWO heartbeat rows in one run is INVISIBLE
    // to this case. Nothing in this file asks that question of any job.
    const jobs = db.rows('SELECT DISTINCT job FROM cron_heartbeat ORDER BY job').map((r) => r.job);
    expect(jobs).toEqual([
      'analytics_liveness',
      'cancellation_drain',
      'events_rollup',
      // Added 2026-09-03 with the [research/76 §C] Phase 1 dispatcher. This
      // assertion went RED the moment that limb was wired, which is the case
      // doing exactly what its header says: it is the only test in the tree
      // that runs the real handler, so it is the only place a newly wired job
      // is checkable at all.
      'github_dispatch',
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

// ─────────────────────────────────────────────────────────────────────────────
// ADDED 2026-08-24 — THE SEPARATOR ITSELF, ON THE TWO PATHS NOTHING GRADED.
//
// `prose` ships with no `i === -1` fallback on the strength of a claim about all
// FOUR census paths (see its doc above). Two of the four held that claim; these
// two cases close the other two, and the first of them also pins the SPACE
// inside `indexOf('— ')`. Each names the mutation it exists to redden, so the
// next reader re-runs the sweep instead of trusting this paragraph.
// ─────────────────────────────────────────────────────────────────────────────

describe('the em dash is the separator on every path', () => {
  it('slices at the dash FOLLOWED BY A SPACE, not at one inside the oldest value', async () => {
    // 🔴 PINS TWO ATOMS AT ONCE, both measured green before this case existed:
    //   · src/scheduled.ts's BACKLOG separator ` — UNDRAINED:`. Relaxed to
    //     ` :: UNDRAINED:` the file was EXIT 0 / 17 passed, because the only
    //     assertion reaching it was `toContain('UNDRAINED')` and a wrong slice
    //     still contains the word.
    //   · the SPACE in `prose`'s `indexOf('— ')`. Dropped, the file was
    //     EXIT 0 / 17 passed, because on every OTHER fixture the dash is
    //     followed by a space and the two spellings agree byte for byte.
    const db = realPlatformDb();
    // Em dashes INSIDE `requested_at`, written as `—` rather than as the
    // glyph so the atom under test is visible in the source. The column is
    // `TEXT NOT NULL` with no CHECK and this file already relies on that for
    // `not-a-date`; a value rendered with em dashes by whatever wrote it is the
    // realistic way this arrives. The census prints `oldest` VERBATIM, so the
    // stray dash lands AHEAD of the real separator — which is the only shape
    // that separates `indexOf('— ')` from `indexOf('—')`.
    insertRequest(db, 'r-dashed', '2024—09—01T00:00:00.000Z', null);
    await cancellationDrainCensus(envWith(db));

    const detail = beats(db)[0].detail;
    // The fixture tests itself: if the census ever stopped printing `oldest`
    // verbatim, this case would silently stop being about the two spellings.
    expect(String(detail)).toContain('oldest=2024—09—01T00:00:00.000Z');
    // WHOLE LINE. `toContain('UNDRAINED')` is exactly what let both mutants
    // through; under either one this is a slice that starts mid-token.
    expect(prose(detail)).toBe(
      'UNDRAINED: nothing here executes a cancellation; this falls only when a human acts. [5]M-9',
    );
  });

  it('grades the FAILED path too — the catch branch has an operator-facing half as well', async () => {
    // 🔴 PINS src/scheduled.ts's CATCH separator ` — the drain census query
    // FAILED`. Relaxed to ` :: ` the file was EXIT 0 / 17 passed: the only case
    // reaching that path asserted `toContain('FAILED')` on the RAW detail and
    // never called `prose`, so the half a human actually reads was ungraded on
    // the one path that exists to be read by a human at 3am.
    const db = realPlatformDb();
    insertRequest(db, 'r-1', hours(10), null);
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
    const detail = beats(db)[0].detail;
    // ANCHORED at `^`. `toContain` is what survived the wrong slice; a mis-sliced
    // line starts `ndrained=unknown …` and fails here.
    expect(prose(detail)).toMatch(/^the drain census query FAILED: /);
    // And the cause still reaches the operator through the same slice.
    expect(prose(detail)).toContain('d1 down');
    expect(Number(beats(db)[0].ok)).toBe(0);
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
    // ✅ DECLARED — a restatement of the line above, which already excludes every
    // other value. Deleting it alone is EXIT 0 / 17 passed, measured 2026-08-24.
    // Kept because it NAMES the wrong answer this case exists to rule out; it
    // cannot change a verdict, and saying so is the honest record.
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
    // ✅ DECLARED — implied by the exact-string assertion above, so deleting it
    // alone is EXIT 0 / 17 passed, measured 2026-08-24. Kept because it states
    // the CLAMP as an inequality, which is the form the bug had; it cannot
    // change a verdict.
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

  it('a NULL count beside a real total normalises to zero, not to a backlog', async () => {
    // 🔴 PINS THE `? 0` ARM of `row?.undrained == null ? 0 : …`. The CONDITION
    // was already graded by "survives first() returning null"; the ARM'S VALUE
    // was not, and it was green through every earlier sweep for a reason worth
    // writing down: when the real aggregate carries a NULL count the table is
    // also EMPTY, so `recorded === 0` wins below and prints its LITERAL, and the
    // arm's value never reaches the detail at all. Set to 99 the file stayed
    // 15/15 green, measured 2026-08-24. THIS fixture is the only shape that
    // reaches it — a null count beside a total that is NOT zero — and it is a
    // shape a D1 aggregate can hand back the day the query's shape moves.
    const db = realPlatformDb();
    await cancellationDrainCensus(envWith(stub(db, { recorded: 3, undrained: null, oldest: null })));

    const t = tokens(beats(db)[0].detail);
    // The arm's value, read straight out of the interpolated token.
    expect(t.undrained).toBe('0');
    expect(t.recorded).toBe('3');
    // And the sentence it selects. With the arm at 99 this is the backlog
    // branch, i.e. an operator is paged about a queue that does not exist.
    expect(prose(beats(db)[0].detail)).not.toContain('UNDRAINED');
    expect(Number(beats(db)[0].ok)).toBe(1);
  });

  it('an age is UNKNOWN when the aggregate carries no oldest, never epoch-old', async () => {
    // 🔴 PINS THE `? Number.NaN` ARM of `oldest === null ? … : Date.parse(…)`.
    // The GUARD itself cannot be deleted — without it `.first()`'s `T | null`
    // reaches `Date.parse`, `tsc --noEmit` EXIT 2 — but the ARM'S VALUE could be
    // anything as far as the suite was concerned: forced to `0` the file stayed
    // 15/15 green, measured 2026-08-24, because every earlier fixture that had a
    // null oldest ALSO had a zero count, and both zero-branches print their age
    // as a literal. Here the count is real and the oldest is absent, so the
    // backlog branch interpolates the age — and `0` prints it as the number of
    // hours since the epoch, a queue reported as half a million hours deep.
    const db = realPlatformDb();
    await cancellationDrainCensus(envWith(stub(db, { recorded: 3, undrained: 2, oldest: null })));

    const t = tokens(beats(db)[0].detail);
    expect(t.undrained).toBe('2');
    expect(t.oldest_age_h).toBe('unknown');
    expect(Number(beats(db)[0].ok)).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ADDED 2026-08-24 — THE LAST TWO CONDITIONS IN THIS FILE THAT NOTHING GRADED.
//
// A 36-mutant `if (false)` sweep of the whole set on 2026-08-24, against a
// baseline of EXIT 0 / 13 passed, left exactly TWO survivors that were neither
// held by a test nor held by `tsc --noEmit`, and BOTH were in this file's own
// helpers rather than in the subject: forcing `!(m[1] in out)` to TRUE (so the
// LAST occurrence of a key wins instead of the first) and changing
// `insertRequest`'s `reason` default from `provider_not_configured` to `null`
// each left the file 13/13 green. A fixture whose own behaviour nothing grades
// is the same decoration as an assertion that cannot fail — it is what every
// case above stands on. The two cases below close them, one condition each.
//
// RE-SWEPT AFTER THE FIX, so this paragraph is a measurement and not a promise:
// 42 mutants against the tree as it now stands — baseline EXIT 0, 15 passed,
// `tsc --noEmit` EXIT 0 — give 38 red in vitest, 2 red ONLY in `tsc --noEmit`
// (EXIT 2, and their absence does not compile, so they cannot be deleted), and
// 2 that do not move. One is `if (rows.length === 0) return;` in
// `recordHeartbeat`, which no case here can reach and which no hunk on this
// branch touched. The other is not a condition at all:
// `fitsTheSlice`'s 200 is an ASSERTION, not a guard: WIDENING it to 1000000 is
// green by construction, so it was checked the other way — TIGHTENED to 120 it
// goes red, which is what says the bound is live rather than vacuous.
//
// ⚠️ CORRECTED LATER ON 2026-08-24, AND THE 42 ABOVE IS LEFT AS WRITTEN. That
// sweep merged each TERNARY into ONE row — condition and both arms sharing a
// single verdict — and two live holes hid inside its "38 red": the `? 0` arm of
// the `undrained` normalisation and the `? Number.NaN` arm of the age guard, in
// src/scheduled.ts. Both were green for the same reason, and it is the reason
// this file keeps re-learning: every fixture that reached either arm ALSO had a
// zero count, and both zero-branches print their tokens as LITERALS, so the arm
// never reached the output being asserted on. The two cases in "a malformed
// aggregate row is normalised, not propagated" close them by driving the
// aggregate stub to a NULL part beside a NON-zero total.
// RE-SWEPT WITH EVERY ARM SPLIT OUT, after the last edit: 56 mutants, baseline
// EXIT 0 / 17 passed and `tsc --noEmit` EXIT 0 — 48 red in vitest, 3 red ONLY in
// `tsc --noEmit` (EXIT 2), 2 the widening direction of `fitsTheSlice`'s bound
// (green by construction; tightening `200 -> 120` and `HEADROOM -> 92` are both
// RED), 1 the `ORDER BY job` determinism device in the handler case, and 2
// discarded as invalid because the mutant needed a type assertion that supplies
// the very fact the operator provides. 48 + 3 + 2 + 1 + 2 = 56.
// 🔴 THAT `1` IS A `2` AND THE TOTAL IS 57 — the handler case's SELECT carries
// TWO green SQL atoms and the sweep above rowed only one of them. `DISTINCT` was
// the omitted row, and the omission is the merge-into-a-neighbour that every
// round of this work has been caught by. Measured 2026-08-24 after the last edit
// to this file: dropping `DISTINCT` leaves EXIT 0 / 17 passed and `tsc --noEmit`
// EXIT 0, so no test reddens it; it is NOT the widening direction (its removal
// makes the assertion STRICTER) and it is kept for the reason written at the
// code site, together with the check it therefore does not make. The other four
// terms of the sum were not re-taken when this row was added, which is why the
// sum is left as its run wrote it instead of being silently re-added.
// `if (rows.length === 0) return;` in `recordHeartbeat` is unchanged and still
// out of scope — no hunk on this branch touched it.
//
// 🔴 THE RUNNING TOTAL IS RETIRED HERE, 2026-08-24, SIXTH PASS — AND NOT
// RE-ADDED. Every block above carried one term forward from a run that had
// stopped describing the tree, and the sentence this file used to close on —
// that no unfalsifiable condition survived the sweep — was not true when it was
// written. Six green survivors were named after it: the SPACE inside
// `indexOf('— ')`, the BACKLOG separator and the CATCH separator in
// src/scheduled.ts, and three atoms of the `tokens` regex. Each was re-measured
// in a mirror this pass, one mutation at a time, against a baseline of
// EXIT 0 / 17 passed, and each was EXIT 0 / 17 passed.
//
// THREE OF THE SIX CHANGE A VERDICT — an input exists on which the shipped
// spelling and the mutant disagree — and all three are now PINNED:
//   · the space, and the backlog separator, by "slices at the dash FOLLOWED BY
//     A SPACE, not at one inside the oldest value";
//   · the catch separator, by "grades the FAILED path too";
//   · the regex's `=`, by "an EMPTY oldest is an absent token".
// THREE CANNOT, and are DECLARED at their code sites rather than pinned: the
// regex's leading character class and its `*` quantifier (both at the `tokens`
// helper, anchor `THREE ATOMS OF THIS ONE REGEX`), together with the redundant
// length and inequality restatements marked `✅ DECLARED` in the cases above.
//
// A pure widening is not an assertion that cannot fail — it is a matcher that is
// deliberately loose, and the honest record is saying so beside it. What is NOT
// acceptable, and is what these six rounds were closing, is leaving it silent.
// So no new total is stated: a count in a comment is a promise about a sweep
// somebody else ran, and a disposition beside the atom is a fact about the line.
// ─────────────────────────────────────────────────────────────────────────────

describe('the helpers this file stands on grade themselves', () => {
  it('tokens() takes the FIRST occurrence of a key, so the LEADING run wins', () => {
    // 🔴 PINS `!(m[1] in out)` IN `tokens`. `detail` is a token run followed by
    // free English, and `recordHeartbeat` slices the whole thing to 200 chars, so
    // the contract every assertion above reads is the LEADING run — which is what
    // this guard makes true. Forced to `false` the map stays empty and every case
    // above reddens; forced to `true` the trailing prose silently overwrites the
    // measurement, and nothing above could tell.
    const t = tokens('undrained=2 recorded=9 — UNDRAINED, and note undrained=0 earlier');
    expect(t.undrained).toBe('2');
    expect(t.recorded).toBe('9');
  });

  it('an EMPTY oldest is an absent token, never the equals sign itself', async () => {
    // 🔴 PINS THE LITERAL `=` IN `tokens`' REGEX — the disposition is written in
    // full at the code site. Relaxed to `=?` the file was EXIT 0 / 17 passed,
    // measured 2026-08-24, because no fixture had ever produced a key whose
    // value was empty. `requested_at` is `TEXT NOT NULL` with no CHECK, so the
    // empty string is storable, and it makes the census print `oldest= ` with
    // nothing between the equals sign and the next space.
    //
    // With `=` REQUIRED there is no `oldest` token at all — the reader reports
    // the timestamp as ABSENT, which is true. With `=?` the optional equals
    // backtracks to empty and `\S+` claims the `=` itself, so the reader reports
    // the oldest undrained request as having been made at `=`. That is a machine
    // reader inventing a value out of a delimiter, and it is the one shape that
    // separates the two spellings.
    const db = realPlatformDb();
    insertRequest(db, 'r-empty', '', null);
    await cancellationDrainCensus(envWith(db));

    const detail = beats(db)[0].detail;
    expect(String(detail)).toContain('oldest= oldest_age_h=');
    const t = tokens(detail);
    expect(t.oldest).toBeUndefined();
    // The NEIGHBOURING tokens still parse, so this case is about the `=` and not
    // about a fixture that broke the whole run.
    expect(t.undrained).toBe('1');
    expect(t.recorded).toBe('1');
    expect(t.oldest_age_h).toBe('unknown');
  });

  it('insertRequest() writes the reason it defaults to, and NULL when told to', () => {
    // 🔴 PINS THE `reason = 'provider_not_configured'` DEFAULT. The census never
    // SELECTs `not_executed_reason`, so nothing above could distinguish the
    // default from `null` — yet the row shape this fixture claims to reproduce is
    // the route's: an UNDRAINED row carries a reason and a DRAINED one does not.
    // Read back from the real table, so the claim in this helper's doc that it
    // writes the route's own column list is a query and not a sentence.
    const db = realPlatformDb();
    insertRequest(db, 'r-undrained', hours(3), null);
    insertRequest(db, 'r-drained', hours(2), hours(1), null);

    const rows = db.rows(
      'SELECT request_id, executed_at, not_executed_reason FROM cancellation_requests ORDER BY request_id',
    );
    expect(rows.map((r) => [r.request_id, r.not_executed_reason])).toEqual([
      ['r-drained', null],
      ['r-undrained', 'provider_not_configured'],
    ]);
  });
});
