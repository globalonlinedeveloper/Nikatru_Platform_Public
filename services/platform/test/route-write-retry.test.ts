// ─────────────────────────────────────────────────────────────────────────────
// A ROUTE'S WRITE SURVIVES ONE TRANSIENT D1 RESET (rv2-services-003).
//
// 🔬 THE DEFECT. lib/d1.ts `run()` has retried the documented-transient D1
// faults since 2026-09-02, and no platform ROUTE imported it: the reminder
// preference, the one-click unsubscribe, the calendar feed's mint and revoke,
// and the content report all wrote with a bare `.run()`, so a measured
// production reset (`D1 DB storage operation exceeded timeout which caused
// object to be reset`) was a 500. The worst one is the RFC 8058 unsubscribe
// POST: the mail provider sends it ONCE, reads the 500, and the person keeps
// getting mail they asked to stop.
//
// Every case below was run against the bare `.run()` first and went RED (a 500),
// and each asserts the fault ACTUALLY FIRED (`injected`) — an injector whose
// predicate stopped matching would leave a green case that exercises nothing.
//
// The `commitFirst` cases are the ambiguous half of the fault: the write
// committed and the acknowledgement was lost, so the retry meets its own row. A
// route that answered that as "no feed" or "rate limited" would have turned a
// success into a failure one layer down.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import reminders from '../src/routes/reminders';
import calendar from '../src/routes/calendar';
import report, { MAX_REPORTS_PER_USER_PER_HOUR } from '../src/routes/report';
import { app as realApp } from '../src/index';
import { sha256Hex } from '../src/middleware/ext-device-auth';
import type { AppEnv } from '../src/types';
import { realPlatformDb, type RealDb } from './harness';
import { DETERMINISTIC, FlakyD1, TRANSIENT } from './flaky-d1';

const APP = 'subscriptiontracker';
const ALICE = 'u-alice-retry';

/** One route module, with `platformAuth`'s one output set as it would be. */
function appFor(route: Hono<AppEnv>, userId = ALICE) {
  const a = new Hono<AppEnv>();
  a.use('*', async (c, next) => {
    c.set('userId', userId);
    c.set('requestId', 'test-write-retry');
    await next();
  });
  a.route('/v1', route);
  // The real Worker's mapping: an unhandled throw is a 500 (src/index.ts onError).
  a.onError((_err, c) => c.json({ error: 'internal_error' }, 500));
  return a;
}

const env = (db: unknown, over: Record<string, unknown> = {}) =>
  ({ PLATFORM_DB: db, ...over }) as unknown as AppEnv['Bindings'];

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

/** What a `waitUntil` needs, for a route that schedules background work. */
const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;

describe('PUT /v1/reminders/prefs — the upsert is retried', () => {
  it('🔴 one reset on the INSERT is a 200, and the preference is stored', async () => {
    const db = realPlatformDb();
    const flaky = new FlakyD1(db, /INSERT INTO reminder_prefs/, TRANSIENT, { methods: ['run'] });
    const res = await appFor(reminders).request(
      'http://x/v1/reminders/prefs',
      json('PUT', { app_id: APP, email_opt_in: true, lead_days: 5 }),
      env(flaky),
    );
    expect(flaky.injected).toBe(1);
    expect(res.status).toBe(200);
    expect(db.rows('SELECT user_id, email_opt_in, lead_days FROM reminder_prefs')).toEqual([
      { user_id: ALICE, email_opt_in: 1, lead_days: 5 },
    ]);
  });

  it('a DETERMINISTIC failure is sent once and surfaces — a retry of it is pure delay', async () => {
    const db = realPlatformDb();
    const flaky = new FlakyD1(db, /INSERT INTO reminder_prefs/, DETERMINISTIC, { methods: ['run'], times: 5 });
    const res = await appFor(reminders).request(
      'http://x/v1/reminders/prefs',
      json('PUT', { app_id: APP, email_opt_in: true }),
      env(flaky),
    );
    expect(res.status).toBe(500);
    expect(flaky.calls).toBe(1);
    expect(db.count('reminder_prefs')).toBe(0);
  });
});

describe('POST /v1/reminders/unsubscribe — the RFC 8058 one-click is retried', () => {
  async function seeded(): Promise<{ db: RealDb; token: string }> {
    const db = realPlatformDb();
    const token = 'U'.repeat(43);
    db.db
      .prepare('INSERT INTO reminder_prefs (user_id, app_id, email_opt_in, lead_days, updated_at) VALUES (?, ?, 1, 3, ?)')
      .run(ALICE, APP, '2026-09-28T00:00:00Z');
    db.db
      .prepare(
        'INSERT INTO reminder_sent (user_id, app_id, subscription_id, due_on, kind, sent_at, unsubscribe_hash) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(ALICE, APP, 's-1', '2026-10-03', 'renewal', '2026-09-30T06:00:00.000Z', await sha256Hex(token));
    return { db, token };
  }

  it('🔴 one reset on the UPDATE, through the REAL app, still opts the person out — the provider sends this once', async () => {
    const { db, token } = await seeded();
    const flaky = new FlakyD1(db, /UPDATE reminder_prefs/, TRANSIENT, { methods: ['run'] });
    const res = await realApp.request(
      `http://x/v1/reminders/unsubscribe?t=${token}`,
      { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'List-Unsubscribe=One-Click' },
      env(flaky),
    );
    expect(flaky.injected).toBe(1);
    expect(res.status).toBe(200);
    expect(db.rows('SELECT email_opt_in FROM reminder_prefs')).toEqual([{ email_opt_in: 0 }]);
  });

  it('a reset AFTER the UPDATE committed is still a 200 — the retry is the same opt-out again', async () => {
    const { db, token } = await seeded();
    const flaky = new FlakyD1(db, /UPDATE reminder_prefs/, TRANSIENT, { methods: ['run'], commitFirst: true });
    const res = await appFor(reminders).request(`http://x/v1/reminders/unsubscribe?t=${token}`, { method: 'POST' }, env(flaky));
    expect(flaky.injected).toBe(1);
    expect(res.status).toBe(200);
    expect(db.rows('SELECT email_opt_in FROM reminder_prefs')).toEqual([{ email_opt_in: 0 }]);
  });
});

describe('/v1/calendar/feed — mint and revoke are retried', () => {
  it('🔴 one reset on the mint is a 201, and the URL it answers is live', async () => {
    const db = realPlatformDb();
    const flaky = new FlakyD1(db, /INSERT INTO reminder_feed/, TRANSIENT, { methods: ['run'] });
    const res = await appFor(calendar).request('https://x/v1/calendar/feed', json('POST', { app_id: APP }), env(flaky));
    expect(flaky.injected).toBe(1);
    expect(res.status).toBe(201);
    const { https_url } = (await res.json()) as { https_url: string };
    const token = /\/v1\/calendar\/([A-Za-z0-9_-]{43})\.ics$/.exec(https_url)![1];
    // The hash the retry stored is the hash of the token the caller was given.
    expect(db.rows('SELECT token_hash, revoked_at FROM reminder_feed')).toEqual([
      { token_hash: await sha256Hex(token), revoked_at: null },
    ]);
  });

  async function minted(): Promise<RealDb> {
    const db = realPlatformDb();
    const res = await appFor(calendar).request('https://x/v1/calendar/feed', json('POST', { app_id: APP }), env(db));
    expect(res.status).toBe(201);
    return db;
  }

  it('🔴 one reset on the revoke is a 204, and the feed is revoked', async () => {
    const db = await minted();
    const flaky = new FlakyD1(db, /UPDATE reminder_feed/, TRANSIENT, { methods: ['run'] });
    const res = await appFor(calendar).request(`https://x/v1/calendar/feed?app_id=${APP}`, { method: 'DELETE' }, env(flaky));
    expect(flaky.injected).toBe(1);
    expect(res.status).toBe(204);
    expect(db.count('reminder_feed', 'revoked_at IS NOT NULL')).toBe(1);
  });

  it('🔴 a reset AFTER the revoke committed is a 204, not a false 404 — the retry finds the feed already revoked', async () => {
    const db = await minted();
    const flaky = new FlakyD1(db, /UPDATE reminder_feed/, TRANSIENT, { methods: ['run'], commitFirst: true });
    const res = await appFor(calendar).request(`https://x/v1/calendar/feed?app_id=${APP}`, { method: 'DELETE' }, env(flaky));
    expect(flaky.injected).toBe(1);
    expect(res.status).toBe(204);
    expect(db.count('reminder_feed', 'revoked_at IS NOT NULL')).toBe(1);
  });
});

describe('POST /v1/report — the capped insert is retried, and a committed first attempt is a 202', () => {
  const GOOD = { app_id: APP, reason: 'offensive', content_ref: 'msg-42', content_excerpt: 'the generated text' };

  it('🔴 one reset on the INSERT is a 202, and exactly one report is stored', async () => {
    const db = realPlatformDb();
    const flaky = new FlakyD1(db, /INSERT INTO content_reports/, TRANSIENT, { methods: ['run'] });
    const res = await appFor(report).request('http://x/v1/report', json('POST', GOOD), env(flaky), ctx);
    expect(flaky.injected).toBe(1);
    expect(res.status).toBe(202);
    const { id } = (await res.json()) as { id: string };
    expect(db.rows('SELECT id, user_id FROM content_reports')).toEqual([{ id, user_id: ALICE }]);
  });

  it('🔴 a reset AFTER the insert committed is a 202 for the stored row, never a 429', async () => {
    const db = realPlatformDb();
    const flaky = new FlakyD1(db, /INSERT INTO content_reports/, TRANSIENT, { methods: ['run'], commitFirst: true });
    const res = await appFor(report).request('http://x/v1/report', json('POST', GOOD), env(flaky), ctx);
    expect(flaky.injected).toBe(1);
    expect(res.status).toBe(202);
    const { id } = (await res.json()) as { id: string };
    expect(db.rows('SELECT id FROM content_reports')).toEqual([{ id }]);
  });

  it(`…and that holds when the committed row was the ${MAX_REPORTS_PER_USER_PER_HOUR}th, so the retry's own cap check says "full"`, async () => {
    const db = realPlatformDb();
    const recent = new Date(Date.now() - 60_000).toISOString();
    for (let i = 0; i < MAX_REPORTS_PER_USER_PER_HOUR - 1; i++) {
      db.db
        .prepare("INSERT INTO content_reports (id, user_id, app_id, reason, content_ref, status, created_at) VALUES (?, ?, ?, 'other', 'r', 'open', ?)")
        .run(`earlier-${i}`, ALICE, APP, recent);
    }
    const flaky = new FlakyD1(db, /INSERT INTO content_reports/, TRANSIENT, { methods: ['run'], commitFirst: true });
    const res = await appFor(report).request('http://x/v1/report', json('POST', GOOD), env(flaky), ctx);
    expect(flaky.injected).toBe(1);
    expect(res.status).toBe(202);
    expect(db.count('content_reports', 'user_id = ?', ALICE)).toBe(MAX_REPORTS_PER_USER_PER_HOUR);
    // The cap itself is untouched: the next report is the 429 it always was.
    const next = await appFor(report).request('http://x/v1/report', json('POST', GOOD), env(db), ctx);
    expect(next.status).toBe(429);
    expect(db.count('content_reports', 'user_id = ?', ALICE)).toBe(MAX_REPORTS_PER_USER_PER_HOUR);
  });
});

// ── THE CLASS GUARD ──────────────────────────────────────────────────────────
// The cases above hold the five writes the review named. This holds the CLASS:
// no route module in any Worker may write with a bare `.run()` — every write
// goes through `run()` from lib/d1, which retries only the documented-transient
// faults. A new route that writes bare is red here before it ships.
//
// ⚠️ ONE EXEMPTION, AND IT IS COUNTED, NOT WAIVED. routes/events.ts's consent
// insert (`POST /v1/consent`) catches every D1 failure and answers 503
// `consent_failed`, which the client retries with the same `consent_id` under
// ON CONFLICT DO NOTHING. It is held at EXACTLY its count, so a second bare
// write in that file is still red.
//
// Vite keys this Worker's own files from the test directory (`../src/…`) and a
// sibling's from the services directory (`../../<worker>/src/…`); both are
// named `services/<worker>/src/…` below, so one name means one file.
const ROUTE_SOURCES = Object.fromEntries(
  Object.entries(
    import.meta.glob('../../*/src/routes/**/*.ts', { query: '?raw', import: 'default', eager: true }),
  ).map(([k, v]) => [k.startsWith('../src/') ? `services/platform/${k.slice(3)}` : `services/${k.slice(6)}`, v]),
);

/** Bare `.run()` calls a file may carry, and why. Every other route file: zero. */
const EXEMPT: Record<string, { count: number; why: string }> = {
  'services/platform/src/routes/events.ts': {
    count: 1,
    why: 'the consent insert catches and answers 503 consent_failed; the client retries it idempotently',
  },
};

/** The source without its comments, so prose that mentions `.run()` is not code. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

const bareRuns = (src: string) => (code(src).match(/\.run\(\s*\)/g) ?? []).length;

describe('no route writes with a bare .run() — every write goes through run() from lib/d1', () => {
  it('the glob reached both Workers’ route directories (else every check below passes over nothing)', () => {
    const files = Object.keys(ROUTE_SOURCES);
    expect(files).toContain('services/platform/src/routes/reminders.ts');
    expect(files).toContain('services/subscriptiontracker-api/src/routes/subscriptions.ts');
    for (const f of Object.keys(EXEMPT)) expect(files, `exempt file ${f} no longer exists`).toContain(f);
    expect(files.length).toBeGreaterThanOrEqual(15);
  });

  it('the counter sees a bare write and ignores one in a comment', () => {
    expect(bareRuns("await db.prepare('x').bind(1)\n  .run();")).toBe(1);
    expect(bareRuns('await run(db.prepare(x).bind(1));')).toBe(0);
    expect(bareRuns('// a bare .run() here would be a 500\n/* and .run() here */')).toBe(0);
  });

  for (const [file, src] of Object.entries(ROUTE_SOURCES)) {
    it(file, () => {
      const want = EXEMPT[file]?.count ?? 0;
      expect(bareRuns(src), `bare .run() in ${file} — wrap the statement in run() from lib/d1`).toBe(want);
    });
  }
});
