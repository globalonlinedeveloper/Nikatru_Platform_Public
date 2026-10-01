// ─────────────────────────────────────────────────────────────────────────────
// POST /v1/report — the in-app AI content report (O-PLAY-AI-CONTENT-REPORTING).
//
// Driven through the REAL route over the real-SQL harness, so every assertion
// about a stored row is a statement about what landed in a schema built from the
// real migrations — not about what a mock was told.
//
// The properties, each a case below:
//   · the report is STORED before anything else can go wrong, and the reporter is
//     the JWT's subject, never a body field;
//   · every malformed body is refused before D1 is touched;
//   · one person is capped per hour, and the cap is theirs alone;
//   · the support notice is FAIL-SOFT — no key, the daily cap or a failed send all
//     leave the report stored and `notified_at` NULL;
//   · the notice carries NO user content (excerpt, note, reporter);
//   · the rows age out on the sweep's declared period.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, vi, afterEach } from 'vitest';
import { Hono } from 'hono';
import report, { MAX_REPORTS_PER_USER_PER_HOUR, MAX_EXCERPT_CHARS, parseReport } from '../src/routes/report';
import { MAX_REPORT_NOTICES_PER_DAY, REPORT_NOTICE_TO, RESEND_EMAILS_URL } from '../src/lib/report-notify';
import { retentionSweep, CONTENT_REPORTS_RETENTION_DAYS, type RetentionPeriods } from '../src/scheduled';
import { app as realApp } from '../src/index';
import type { AppEnv } from '../src/types';
import { realPlatformDb, type RealDb } from './harness';

const APP = 'subscriptiontracker';
const ALICE = 'u-alice-report';
const BOB = 'u-bob-report';

afterEach(() => vi.unstubAllGlobals());

/** The route, with `platformAuth`'s one output set as it would be. */
function appFor(userId: string) {
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => {
    c.set('userId', userId);
    c.set('requestId', 'test-report');
    await next();
  });
  app.route('/v1', report);
  return app;
}

/** POST a body; returns the answer AND the settled background work. */
async function post(db: RealDb, userId: string, body: unknown, env: Record<string, unknown> = {}) {
  const waits: Promise<unknown>[] = [];
  const ctx = { waitUntil: (p: Promise<unknown>) => waits.push(p), passThroughOnException: () => {} };
  const res = await appFor(userId).request(
    'http://x/v1/report',
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) },
    { PLATFORM_DB: db, ...env } as unknown as AppEnv['Bindings'],
    ctx as unknown as ExecutionContext,
  );
  await Promise.all(waits);
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

const GOOD = { app_id: APP, reason: 'offensive', content_ref: 'msg-42', content_excerpt: 'the generated text', note: 'this is hateful' };

describe('POST /v1/report — the report is stored, and it is the reporter’s', () => {
  it('202 with an id, and the row carries the JWT subject — never a body field', async () => {
    const db = realPlatformDb();
    const r = await post(db, ALICE, { ...GOOD, user_id: 'someone-else' });
    expect(r.status).toBe(202);
    expect(r.json.ok).toBe(true);
    const rows = db.rows('SELECT * FROM content_reports');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: r.json.id,
      user_id: ALICE,
      app_id: APP,
      reason: 'offensive',
      content_ref: 'msg-42',
      content_excerpt: 'the generated text',
      note: 'this is hateful',
      status: 'open',
      notified_at: null,
    });
  });

  it('an excerpt alone, or a reference alone, is enough', async () => {
    const db = realPlatformDb();
    expect((await post(db, ALICE, { app_id: APP, reason: 'other', content_ref: 'img-7' })).status).toBe(202);
    expect((await post(db, ALICE, { app_id: APP, reason: 'other', content_excerpt: 'x' })).status).toBe(202);
    expect(db.count('content_reports')).toBe(2);
  });
});

describe('POST /v1/report — every malformed body is refused, and nothing is written', () => {
  const cases: Array<[string, unknown, number, string]> = [
    ['not JSON', '{', 400, 'invalid_json'],
    ['an array', [], 400, 'invalid_body'],
    ['an unknown app', { ...GOOD, app_id: 'no-such-app' }, 404, 'unknown_app'],
    ['an inherited property as the app', { ...GOOD, app_id: '__proto__' }, 404, 'unknown_app'],
    ['a reason outside the closed set', { ...GOOD, reason: 'boring' }, 400, 'invalid_reason'],
    ['a non-string note', { ...GOOD, note: 5 }, 400, 'invalid_note'],
    ['an excerpt past its cap', { ...GOOD, content_excerpt: 'x'.repeat(MAX_EXCERPT_CHARS + 1) }, 400, 'invalid_content_excerpt'],
    ['nothing named at all', { app_id: APP, reason: 'offensive', note: 'just a note' }, 400, 'nothing_reported'],
  ];
  for (const [what, body, status, error] of cases) {
    it(`${what} → ${status} ${error}`, async () => {
      const db = realPlatformDb();
      const r = await post(db, ALICE, body);
      expect(r.status).toBe(status);
      expect(r.json.error).toBe(error);
      expect(db.count('content_reports')).toBe(0);
    });
  }

  it('an oversize body is 413 before it is parsed', async () => {
    const db = realPlatformDb();
    const r = await post(db, ALICE, { ...GOOD, note: 'x'.repeat(10_000) });
    expect(r.status).toBe(413);
    expect(db.count('content_reports')).toBe(0);
  });

  it('the rules are the same without a request', () => {
    expect(parseReport({ ...GOOD }).ok).toBe(true);
    expect(parseReport({ ...GOOD, content_ref: '   ', content_excerpt: '' })).toMatchObject({ ok: false, error: 'nothing_reported' });
  });
});

describe('POST /v1/report — one person is capped per hour, and the cap is theirs alone', () => {
  it(`the ${MAX_REPORTS_PER_USER_PER_HOUR + 1}th report in an hour is 429 and is NOT stored; another user is unaffected`, async () => {
    const db = realPlatformDb();
    for (let i = 0; i < MAX_REPORTS_PER_USER_PER_HOUR; i++) {
      expect((await post(db, ALICE, GOOD)).status).toBe(202);
    }
    const over = await post(db, ALICE, GOOD);
    expect(over.status).toBe(429);
    expect(over.json.error).toBe('rate_limited');
    expect(db.count('content_reports', 'user_id = ?', ALICE)).toBe(MAX_REPORTS_PER_USER_PER_HOUR);
    expect((await post(db, BOB, GOOD)).status).toBe(202);
  });

  it('reports older than an hour do not count against the cap', async () => {
    const db = realPlatformDb();
    const old = new Date(Date.now() - 2 * 3600_000).toISOString();
    for (let i = 0; i < MAX_REPORTS_PER_USER_PER_HOUR; i++) {
      db.db.exec(
        `INSERT INTO content_reports (id, user_id, app_id, reason, content_ref, created_at) VALUES ('old-${i}', '${ALICE}', '${APP}', 'other', 'r', '${old}')`,
      );
    }
    expect((await post(db, ALICE, GOOD)).status).toBe(202);
  });
});

describe('the support notice — fail-soft, capped, and carrying no user content', () => {
  function stubResend(status = 200) {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        return new Response(JSON.stringify({ id: 'resend-1' }), { status });
      }),
    );
    return calls;
  }

  it('with no key there is no send, and the report is still stored', async () => {
    const calls = stubResend();
    const db = realPlatformDb();
    expect((await post(db, ALICE, GOOD)).status).toBe(202);
    expect(calls).toHaveLength(0);
    expect(db.rows('SELECT notified_at FROM content_reports')[0].notified_at).toBeNull();
  });

  it('with a key: ONE send, to support, from the alerts sender — and notified_at is stamped', async () => {
    const calls = stubResend();
    const db = realPlatformDb();
    const r = await post(db, ALICE, GOOD, { RESEND_API_KEY: 're_test_key' });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(RESEND_EMAILS_URL);
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer re_test_key');
    const sent = JSON.parse(String(calls[0].init.body));
    expect(sent.to).toEqual([REPORT_NOTICE_TO]);
    expect(sent.from).toMatch(/<alerts@mail\.nikatru\.com>$/);
    expect(sent.subject).toContain(String(r.json.id));
    expect(db.rows('SELECT notified_at FROM content_reports')[0].notified_at).not.toBeNull();
  });

  it('🔴 the email carries NO user content — not the excerpt, not the note, not the reporter', async () => {
    const calls = stubResend();
    const db = realPlatformDb();
    await post(db, ALICE, GOOD, { RESEND_API_KEY: 're_test_key' });
    const wire = String(calls[0].init.body);
    expect(wire).not.toContain(GOOD.content_excerpt);
    expect(wire).not.toContain(GOOD.note);
    expect(wire).not.toContain(ALICE);
  });

  it(`🔴 past ${MAX_REPORT_NOTICES_PER_DAY} notices in a UTC day, the report is stored and NO send is made — the quota is shared with password resets`, async () => {
    const calls = stubResend();
    const db = realPlatformDb();
    const today = new Date().toISOString();
    for (let i = 0; i < MAX_REPORT_NOTICES_PER_DAY; i++) {
      db.db.exec(
        `INSERT INTO content_reports (id, user_id, app_id, reason, content_ref, created_at, notified_at) VALUES ('n-${i}', 'u-${i}', '${APP}', 'other', 'r', '${today}', '${today}')`,
      );
    }
    expect((await post(db, ALICE, GOOD, { RESEND_API_KEY: 're_test_key' })).status).toBe(202);
    expect(calls).toHaveLength(0);
    expect(db.count('content_reports', 'user_id = ? AND notified_at IS NULL', ALICE)).toBe(1);
  });

  it('a failed send leaves the report stored and un-noticed — the user still got 202', async () => {
    stubResend(500);
    const db = realPlatformDb();
    expect((await post(db, ALICE, GOOD, { RESEND_API_KEY: 're_test_key' })).status).toBe(202);
    expect(db.count('content_reports', 'notified_at IS NULL')).toBe(1);
  });
});

describe('retention — the rows age out on the declared period', () => {
  it(`a report older than ${CONTENT_REPORTS_RETENTION_DAYS} days is swept; a newer one is kept`, async () => {
    const db = realPlatformDb();
    const NOW = Date.now();
    const old = new Date(NOW - (CONTENT_REPORTS_RETENTION_DAYS + 1) * 86400_000).toISOString();
    const keep = new Date(NOW - (CONTENT_REPORTS_RETENTION_DAYS - 1) * 86400_000).toISOString();
    db.db.exec(
      `INSERT INTO content_reports (id, user_id, app_id, reason, content_ref, created_at) VALUES ('gone', 'u1', '${APP}', 'other', 'r', '${old}'), ('kept', 'u2', '${APP}', 'other', 'r', '${keep}')`,
    );
    const periods: RetentionPeriods = {
      events: null,
      events_daily: null,
      provider_notifications: null,
      signups: null,
      content_reports: CONTENT_REPORTS_RETENTION_DAYS,
      ext_codes: null,
      ext_devices: null,
      native_attest_redeemed: null,
      native_attest_keys: null,
      native_attest_counters: null,
    };
    await retentionSweep({ PLATFORM_DB: db } as unknown as AppEnv['Bindings'], periods, NOW);
    expect(db.rows('SELECT id FROM content_reports').map((r) => r.id)).toEqual(['kept']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ⏱ 2026-09-30 · O-REPORT-CAPS-ARE-READ-THEN-WRITE (rv2-services-004). A PARALLEL
// BURST CANNOT OVERSHOOT EITHER CAP.
//
// Both caps used to COUNT and then WRITE, so a wave of concurrent requests all
// read the same count before any sibling's row or stamp landed. The notice cap
// exists to protect the Resend quota that password resets share, so its overshoot
// is the one that locks people out.
//
// `interleaved` makes the race DETERMINISTIC rather than lucky: every D1 call
// yields one macrotask before it executes, so with N requests in flight each one
// reaches its next statement before any runs — the schedule a real burst of
// isolates produces. D1 still executes one statement at a time, as the real one
// does. RED ON MAIN, GREEN AFTER: on the tree before this change every report in
// the wave is stored and every notice is sent.
// ─────────────────────────────────────────────────────────────────────────────
describe('a parallel burst never exceeds a cap', () => {
  /** `db`, with every statement deferred one macrotask before it executes. */
  function interleaved(db: RealDb): RealDb {
    const tick = () => new Promise((r) => setTimeout(r, 0));
    const wrap = (stmt: object): object =>
      new Proxy(stmt, {
        get(target, prop, receiver) {
          const v = Reflect.get(target, prop, receiver);
          if (typeof v !== 'function') return v;
          if (prop === 'bind') return (...a: unknown[]) => wrap(v.apply(target, a));
          if (prop === 'first' || prop === 'run' || prop === 'all' || prop === 'raw') {
            return async (...a: unknown[]) => {
              await tick();
              return v.apply(target, a);
            };
          }
          return v.bind(target);
        },
      });
    return new Proxy(db, {
      get(target, prop, receiver) {
        if (prop === 'prepare') return (sql: string) => wrap(target.prepare(sql));
        const v = Reflect.get(target, prop, receiver);
        return typeof v === 'function' ? v.bind(target) : v;
      },
    });
  }

  it(`🔴 ${2 * MAX_REPORTS_PER_USER_PER_HOUR} reports at once from one account store EXACTLY ${MAX_REPORTS_PER_USER_PER_HOUR}; the rest are 429`, async () => {
    const db = realPlatformDb();
    const N = 2 * MAX_REPORTS_PER_USER_PER_HOUR;
    const results = await Promise.all(Array.from({ length: N }, () => post(interleaved(db), ALICE, GOOD)));
    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === 202)).toHaveLength(MAX_REPORTS_PER_USER_PER_HOUR);
    expect(statuses.filter((s) => s === 429)).toHaveLength(N - MAX_REPORTS_PER_USER_PER_HOUR);
    expect(db.count('content_reports', 'user_id = ?', ALICE)).toBe(MAX_REPORTS_PER_USER_PER_HOUR);
  });

  it('🔴 at the boundary (cap − 1 already stored), a burst of 5 lands ONE more, never more', async () => {
    const db = realPlatformDb();
    const recent = new Date(Date.now() - 60_000).toISOString();
    for (let i = 0; i < MAX_REPORTS_PER_USER_PER_HOUR - 1; i++) {
      db.db.exec(
        `INSERT INTO content_reports (id, user_id, app_id, reason, content_ref, created_at) VALUES ('b-${i}', '${ALICE}', '${APP}', 'other', 'r', '${recent}')`,
      );
    }
    const results = await Promise.all(Array.from({ length: 5 }, () => post(interleaved(db), ALICE, GOOD)));
    expect(results.filter((r) => r.status === 202)).toHaveLength(1);
    expect(db.count('content_reports', 'user_id = ?', ALICE)).toBe(MAX_REPORTS_PER_USER_PER_HOUR);
  });

  it(`🔴 with ${MAX_REPORT_NOTICES_PER_DAY - 1} notices already sent today, a burst from 5 accounts sends ONE more — the quota password resets share is not spent`, async () => {
    const sends: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        sends.push(url);
        return new Response(JSON.stringify({ id: 'resend-1' }), { status: 200 });
      }),
    );
    const db = realPlatformDb();
    const today = new Date().toISOString();
    for (let i = 0; i < MAX_REPORT_NOTICES_PER_DAY - 1; i++) {
      db.db.exec(
        `INSERT INTO content_reports (id, user_id, app_id, reason, content_ref, created_at, notified_at) VALUES ('n-${i}', 'u-${i}', '${APP}', 'other', 'r', '${today}', '${today}')`,
      );
    }
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) => post(interleaved(db), `u-burst-${i}`, GOOD, { RESEND_API_KEY: 're_test_key' })),
    );
    expect(results.every((r) => r.status === 202)).toBe(true);
    expect(sends).toHaveLength(1);
    expect(db.count('content_reports', 'notified_at IS NOT NULL')).toBe(MAX_REPORT_NOTICES_PER_DAY);
    expect(db.count('content_reports', 'notified_at IS NULL')).toBe(4);
  });

  it('a send that THREW may have been delivered, so its claim stays; a DEFINITE refusal releases it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('network connection lost');
      }),
    );
    const db = realPlatformDb();
    expect((await post(db, ALICE, GOOD, { RESEND_API_KEY: 're_test_key' })).status).toBe(202);
    expect(db.count('content_reports', 'notified_at IS NOT NULL')).toBe(1);
    // The refusal half is 'a failed send leaves the report stored and un-noticed' above.
  });
});

// ⏱ 2026-10-01 · rv2-services-017. Every case above drives the route with the
// caller already set, so none of them could see `platformAuth` come off
// `/v1/report` in src/index.ts. This one goes through the REAL app.
describe('POST /v1/report — behind auth on the REAL app', () => {
  it('🔴 no Authorization is a 401, and zero content_reports rows', async () => {
    const db = realPlatformDb();
    const res = await realApp.request(
      'http://x/v1/report',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(GOOD) },
      { PLATFORM_DB: db, SUPABASE_URL: 'https://auth.example' } as unknown as AppEnv['Bindings'],
    );
    expect(res.status).toBe(401);
    expect(db.count('content_reports')).toBe(0);
    expect(db.sql.filter((q) => q.includes('content_reports'))).toEqual([]);
  });
});
