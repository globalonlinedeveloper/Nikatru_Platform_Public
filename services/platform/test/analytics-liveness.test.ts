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
    expect(String(rows.find((r) => r.target === '(portfolio)')!.detail)).toContain('3 event(s) from 2 app(s)');
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

  it('ok=1 at ZERO events: the work succeeded, nothing was found', async () => {
    const db = realPlatformDb();
    await analyticsLiveness(envWith(db));
    // `ok` must not conflate "I could not measure" with "I measured nothing".
    // The keep-alive conflated a rejected request with a successful one for a
    // month and nobody could tell from the table.
    expect(liveness(db)[0].ok).toBe(1);
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
    // A single event is not "unhealthy" here, and neither is zero. Deciding
    // what number is too few has no derivable answer in this repository, so
    // this job measures and records and never grades.
    expect(liveness(db).every((r) => r.ok === 1)).toBe(true);
  });
});
