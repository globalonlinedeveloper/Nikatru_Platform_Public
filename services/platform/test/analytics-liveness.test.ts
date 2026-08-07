import { describe, it, expect } from 'vitest';
// `?raw` rather than node:fs — a Workers tsconfig has no node types on purpose.
import wranglerRaw from '../wrangler.jsonc?raw';
import {
  analyticsLiveness,
  ANALYTICS_LIVENESS_JOB,
  ANALYTICS_LIVENESS_WINDOW_HOURS,
} from '../src/scheduled';
import { realPlatformDb } from './harness';
import type { Env } from '../src/types';

// ─────────────────────────────────────────────────────────────────────────────
// [pipeline 11]E-13 — THE RAIL'S OWN SILENCE IS DETECTABLE.
//
// 🔴 THE FAILURE THIS EXISTS FOR IS LIVE AND WAS DAYS OLD BEFORE ANYBODY
// COUNTED. `SELECT COUNT(*) FROM events` = 0 and `consent_artifacts` = 0 in
// production, measured 2026-07-29 and again 2026-08-01. The ingest route, the
// dedup, the consent rail and the client queue were all built, tested and
// green — the one thing nobody had built was the thing that would notice they
// were producing nothing, and an empty table looks exactly like a quiet week.
//
// THE TWO PROPERTIES THAT MAKE A DETECTOR A DETECTOR, and both are the ones
// this repository has already got wrong once:
//   · A ROW IS WRITTEN EVEN WHEN THE RESULT SET IS EMPTY. A detector that only
//     records when it found something is silent in exactly the situation it
//     exists to report.
//   · `ok` MEANS THE WORK SUCCEEDED, NEVER THAT A ROW WAS FOUND. Until
//     2026-07-30 `keepAliveSupabase` recorded a nightly 401 as ok=1 because
//     `ok` meant `status < 500`; the one instrument between a project and
//     auto-pause reported green while being rejected at the door.
//
// The queries run against the REAL migrations on a real SQLite engine
// (test/harness.ts), so "counted the right rows" is a query rather than an
// inference from which methods the code happened to call.
// ─────────────────────────────────────────────────────────────────────────────

/** JSONC → JSON, string-literal aware. Same reduction wrangler-breaker.test.ts
 *  uses: the file's prose is full of the words being looked for. */
function parseJsonc(text: string): Record<string, unknown> {
  let out = '';
  let i = 0;
  let inStr = false;
  while (i < text.length) {
    const c = text[i];
    const c2 = text[i + 1];
    if (inStr) {
      if (c === '\\') { out += c + (c2 ?? ''); i += 2; continue; }
      if (c === '"') inStr = false;
      out += c; i++; continue;
    }
    if (c === '"') { inStr = true; out += c; i++; continue; }
    if (c === '/' && c2 === '/') { while (i < text.length && text[i] !== '\n') i++; continue; }
    if (c === '/' && c2 === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i += 2; continue;
    }
    out += c; i++;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1')) as Record<string, unknown>;
}

const envWith = (db: ReturnType<typeof realPlatformDb>) => ({ PLATFORM_DB: db }) as unknown as Env;

const insertEvent = (db: ReturnType<typeof realPlatformDb>, appId: string, serverTs: string, id: string) =>
  db.db
    .prepare(
      'INSERT INTO events (event_id, app_id, anon_id, event, params, server_ts) VALUES (?,?,?,?,?,?)',
    )
    .run(id, appId, 'anon-1', 'app_open', '{}', serverTs);

const hours = (n: number) => new Date(Date.now() - n * 60 * 60 * 1000).toISOString();

const liveness = (db: ReturnType<typeof realPlatformDb>) =>
  db.rows(`SELECT * FROM cron_heartbeat WHERE job = '${ANALYTICS_LIVENESS_JOB}' ORDER BY target`);

describe('the window is DERIVED from the cron cadence, not chosen', () => {
  it('the deployed cron runs once a day, which is what the window length means', () => {
    const cfg = parseJsonc(wranglerRaw);
    const crons = (cfg.triggers as { crons?: string[] } | undefined)?.crons ?? [];
    // 🔴 A NUMBER WITH NO DERIVATION IS A NUMBER SOMEBODY GUESSED. The window is
    // the interval between runs, so every period is reported exactly once — no
    // gap, no double-count. If the schedule ever changes, this fails instead of
    // the constant silently describing a window that no longer matches.
    expect(crons).toHaveLength(1);
    const [minute, hour, dom, month, dow] = crons[0].split(/\s+/);
    expect([dom, month, dow]).toEqual(['*', '*', '*']); // every day
    expect(Number.isInteger(Number(minute))).toBe(true);
    expect(Number.isInteger(Number(hour))).toBe(true);
    expect(ANALYTICS_LIVENESS_WINDOW_HOURS).toBe(24);
  });
});

describe('analyticsLiveness records what it measured', () => {
  it('writes ONE row per app plus an unconditional portfolio row', async () => {
    const db = realPlatformDb();
    insertEvent(db, 'subly', hours(1), 'e1');
    insertEvent(db, 'subly', hours(2), 'e2');
    insertEvent(db, 'other', hours(3), 'e3');

    await analyticsLiveness(envWith(db));

    const rows = liveness(db);
    expect(rows.map((r) => r.target)).toEqual(['(portfolio)', 'other', 'subly']);
    expect(rows.every((r) => r.ok === 1)).toBe(true);
    expect(String(rows.find((r) => r.target === 'subly')!.detail)).toContain('2 event(s)');
    expect(String(rows.find((r) => r.target === '(portfolio)')!.detail)).toContain('events=3 apps=2');
  });

  it('WRITES A ROW WHEN THERE ARE NO EVENTS AT ALL — the whole point', async () => {
    // The live state today. A detector that recorded nothing here would be
    // silent in exactly the situation it exists to report.
    const db = realPlatformDb();

    await analyticsLiveness(envWith(db));

    const rows = liveness(db);
    expect(rows).toHaveLength(1);
    expect(rows[0].target).toBe('(portfolio)');
    expect(String(rows[0].detail)).toContain('the rail is SILENT');
  });

  it('ok=1 at ZERO events: the WORK succeeded — [ADR 035]', async () => {
    const db = realPlatformDb();
    await analyticsLiveness(envWith(db));
    // 🔴 THIS TEST ASSERTED `ok === 1` UNTIL 2026-08-06 AND WAS THE BUG'S BEST
    // DEFENCE. Its reasoning — "`ok` means the work succeeded, never that a row
    // was found" — reads like the lesson keepAliveSupabase taught, and is its
    // inversion. `ok` is not a private note: it is the column
    // duty.platform-cron declares as its `failingValue` and the ONLY column
    // tooling/ops/check-heartbeats.mjs asserts on. So the job whose entire
    // purpose is to make silence visible could not, by construction, make
    // anything red — and it reported ok=1 with "the rail is SILENT" in its own
    // detail for three consecutive nights in production.
    //
    // Zero events is "I could not tell" (a broken rail and a quiet week are
    // indistinguishable here — see the gap test below), and this repository's
    // rule for that is already written in check-heartbeats.mjs: UNKNOWN FAILS
    // CLOSED. "I could not tell" must never read as "it is fine".
    //
    // 🔴 REVERSED AGAIN 2026-08-07 BY [ADR 035], AND THE REVERSAL IS THE POINT.
    // `ok: total > 0` shipped on 2026-08-06. The first real cron run after it
    // deployed — 2026-08-07T06:00:23Z — wrote ok=0, `check-heartbeats.mjs` went
    // exit 1, and it would have done so EVERY DAY for the owner-gated reason
    // that no app has shipped. A daily red nobody can act on is how an alarm
    // gets muted, and [pipeline C-6] says an owner-gated gap must PRINT.
    //
    // The comment above is right that `ok` is not a private note — it is the
    // column `duty.platform-cron` declares as its `failingValue`. That is
    // exactly why it must answer ONE question, the same for every writer: DID
    // THE WORK SUCCEED. A query that ran and correctly found nothing succeeded.
    // Whether the silence is a FAULT belongs to [11]E-13's baseline, judged by
    // a different reader — see the next test, where the two states are now
    // distinguishable BY `ok` rather than only by prose.
    expect(liveness(db)[0].ok).toBe(1);
  });

  it('the two ways to be red stay DISTINGUISHABLE — silence is not an outage', async () => {
    // ok=0 alone would collapse "the rail produced nothing" into "the detector
    // could not run", which is the conflation that made the keep-alive report a
    // nightly 401 as success. The detail is what separates them, and a person
    // reading the heartbeat table has to be able to tell which one happened.
    const silent = realPlatformDb();
    await analyticsLiveness(envWith(silent));

    const broken = realPlatformDb();
    broken.db.exec('DROP TABLE events');
    await analyticsLiveness(envWith(broken));

    // [ADR 035]: these were BOTH ok=0, so only the prose told them apart. Now
    // `ok` itself separates them — a strictly stronger assertion, and one a
    // machine can act on without interpreting a sentence.
    expect(liveness(silent)[0].ok).toBe(1);
    expect(liveness(broken)[0].ok).toBe(0);
    expect(String(liveness(silent)[0].detail)).toContain('the rail is SILENT');
    expect(String(liveness(silent)[0].detail)).not.toContain('liveness query failed');
    expect(String(liveness(broken)[0].detail)).toContain('liveness query failed');
    expect(String(liveness(broken)[0].detail)).not.toContain('the rail is SILENT');
  });

  it('a SINGLE event carries a COUNT, and no threshold is smuggled in', async () => {
    // The guard against over-correcting. Under [ADR 035] `ok` no longer moves
    // with the count at all, so this test's job is now the detail: there is no
    // derivable answer in this repository to "how many events is too few", and
    // nothing here may invent one.
    const db = realPlatformDb();
    insertEvent(db, 'subly', hours(1), 'only-one');
    await analyticsLiveness(envWith(db));
    expect(liveness(db).every((r) => r.ok === 1)).toBe(true);
    expect(String(liveness(db).find((r) => r.target === '(portfolio)')!.detail)).toContain('events=1 apps=1');
  });

  it('ok=0 when the query cannot run', async () => {
    const db = realPlatformDb();
    // A table that does not exist is the cheapest real failure: the SELECT
    // throws inside the Worker exactly as a D1 outage would.
    db.db.exec('DROP TABLE events');

    await analyticsLiveness(envWith(db));

    const rows = liveness(db);
    expect(rows).toHaveLength(1);
    expect(rows[0].ok).toBe(0);
    expect(String(rows[0].detail)).toContain('liveness query failed');
  });

  it('counts only the trailing window, on the EDGE clock', async () => {
    const db = realPlatformDb();
    insertEvent(db, 'subly', hours(1), 'recent');
    insertEvent(db, 'subly', hours(ANALYTICS_LIVENESS_WINDOW_HOURS + 5), 'stale');

    await analyticsLiveness(envWith(db));

    // `server_ts`, not `client_ts`: the client clock is untrusted, skewed and
    // offline-queued, so grouping on it would put an event in whichever window
    // the device's clock felt like.
    expect(db.sql.some((s) => s.includes('server_ts >='))).toBe(true);
    expect(String(liveness(db).find((r) => r.target === 'subly')!.detail)).toContain('1 event(s)');
  });

  it('states the gap it cannot close, in the data', async () => {
    // 🔴 THIS CANNOT DISTINGUISH "THE RAIL IS BROKEN" FROM "NOBODY OPENED THE
    // APP", and the row says so rather than a comment saying so. Closing it
    // needs an independent liveness signal this factory does not have:
    // Cloudflare's Free-plan request analytics is UNVERIFIED, and GlitchTip's
    // events are CONTAMINATED by the agent's own Electron visits — building the
    // alarm on those would report "active, zero events" forever and be right
    // for the wrong reason.
    const db = realPlatformDb();
    await analyticsLiveness(envWith(db));
    expect(String(liveness(db)[0].detail)).toContain('no independent liveness signal exists');
  });

  it('records NO THRESHOLD — there is no count it calls too low', async () => {
    const db = realPlatformDb();
    insertEvent(db, 'subly', hours(1), 'e1');
    await analyticsLiveness(envWith(db));
    // A single event is not "unhealthy" here. Deciding what number is too few
    // has no derivable answer in this repository, so this job measures and
    // records and never grades — the only distinction it draws is some vs NONE,
    // which needs no number. (Until 2026-08-06 this comment also said "and
    // neither is zero", which was the bug stated as a virtue.)
    expect(liveness(db).every((r) => r.ok === 1)).toBe(true);
  });
});
