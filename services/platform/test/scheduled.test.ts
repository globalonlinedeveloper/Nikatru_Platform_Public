import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  keepAliveTargets,
  keepAliveSupabase,
  renewalsFanOut,
  KEEPALIVE_JOB,
  ANALYTICS_LIVENESS_JOB,
  RENEWALS_JOB,
} from '../src/scheduled';
import type { Env } from '../src/types';
import { realPlatformDb } from './harness';

/**
 * The keep-alive is the only thing standing between a low-traffic free-tier
 * Supabase project and the ~7-day auto-pause that breaks sign-in portfolio-wide.
 * It used to swallow every error and write nothing down, so a version that had
 * been failing nightly for a month looked identical to a working one. These tests
 * cover the two properties that matters: the target list is CONFIGURABLE, and
 * every outcome is RECORDED.
 */

/** Captures the SQL + bindings the heartbeat writes, without a real D1. */
function fakeDb() {
  const bound: unknown[][] = [];
  const statements: string[] = [];
  const db = {
    prepare(sql: string) {
      statements.push(sql);
      return {
        bind(...args: unknown[]) {
          bound.push(args);
          return { __stmt: true };
        },
      };
    },
    batch: vi.fn(async () => []),
  };
  return { db, bound, statements };
}

function env(overrides: Partial<Env> = {}): Env {
  const { db } = fakeDb();
  return {
    SUPABASE_URL: 'https://live.supabase.co',
    PLATFORM_DB: db,
    ...overrides,
  } as unknown as Env;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('keepAliveTargets — configurable, not hardcoded', () => {
  it('falls back to the single SUPABASE_URL when the list is unset', () => {
    expect(keepAliveTargets(env())).toEqual(['https://live.supabase.co']);
  });

  it('uses the comma-separated list when set, and trims whitespace', () => {
    const e = env({
      SUPABASE_KEEPALIVE_URLS: ' https://a.supabase.co , https://b.supabase.co ',
    });
    expect(keepAliveTargets(e)).toEqual(['https://a.supabase.co', 'https://b.supabase.co']);
  });

  it('the list OVERRIDES SUPABASE_URL rather than adding to it', () => {
    const e = env({ SUPABASE_KEEPALIVE_URLS: 'https://only.supabase.co' });
    expect(keepAliveTargets(e)).toEqual(['https://only.supabase.co']);
  });

  it('dedupes, including a trailing slash that would double the requests', () => {
    const e = env({
      SUPABASE_KEEPALIVE_URLS: 'https://a.supabase.co,https://a.supabase.co/,https://a.supabase.co//',
    });
    expect(keepAliveTargets(e)).toEqual(['https://a.supabase.co']);
  });

  it('drops empty entries from a trailing or doubled comma', () => {
    const e = env({ SUPABASE_KEEPALIVE_URLS: 'https://a.supabase.co,,' });
    expect(keepAliveTargets(e)).toEqual(['https://a.supabase.co']);
  });

  it('returns NOTHING when neither is configured — never a bogus target', () => {
    // The old code would have fetched "undefined/auth/v1/health" and logged a
    // failure nobody read. An empty list is now an explicit, recorded state.
    expect(keepAliveTargets(env({ SUPABASE_URL: '' }))).toEqual([]);
  });
});

describe('keepAliveSupabase — every outcome is recorded', () => {
  it('pings every configured target and records a success row each', async () => {
    const seen: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      seen.push(url);
      return new Response('', { status: 200 });
    }));
    const { db, bound } = fakeDb();
    await keepAliveSupabase({
      SUPABASE_KEEPALIVE_URLS: 'https://a.supabase.co,https://b.supabase.co',
      PLATFORM_DB: db,
    } as unknown as Env);

    expect(seen).toEqual([
      'https://a.supabase.co/auth/v1/health',
      'https://b.supabase.co/auth/v1/health',
    ]);
    expect(bound).toHaveLength(2);
    expect(bound[0][0]).toBe(KEEPALIVE_JOB);
    expect(bound[0][1]).toBe('https://a.supabase.co');
    expect(bound[0][2]).toBe(1); // ok
    expect(bound[1][1]).toBe('https://b.supabase.co');
  });

  it('a thrown request is recorded as a FAILURE, not swallowed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('network down');
    }));
    const { db, bound } = fakeDb();
    await keepAliveSupabase({
      SUPABASE_URL: 'https://live.supabase.co',
      PLATFORM_DB: db,
    } as unknown as Env);

    expect(bound).toHaveLength(1);
    expect(bound[0][2]).toBe(0); // not ok
    expect(String(bound[0][3])).toContain('network down');
  });

  it('a 5xx is recorded as a failure — a broken project must not read as green', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 503 })));
    const { db, bound } = fakeDb();
    await keepAliveSupabase({
      SUPABASE_URL: 'https://live.supabase.co',
      PLATFORM_DB: db,
    } as unknown as Env);
    expect(bound[0][2]).toBe(0);
    expect(bound[0][3]).toBe('HTTP 503');
  });

  it('one dead target does not stop the others being pinged', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.startsWith('https://dead')) throw new Error('boom');
      return new Response('', { status: 200 });
    }));
    const { db, bound } = fakeDb();
    await keepAliveSupabase({
      SUPABASE_KEEPALIVE_URLS: 'https://dead.supabase.co,https://alive.supabase.co',
      PLATFORM_DB: db,
    } as unknown as Env);

    expect(bound).toHaveLength(2);
    expect(bound[0][2]).toBe(0);
    expect(bound[1][2]).toBe(1);
  });

  // THE ONE THAT MATTERS MOST. An empty config protects nothing, and silence
  // looked exactly like success. It must now be a recorded failure.
  it('NO TARGETS is recorded as a failure, never a silent no-op', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const { db, bound } = fakeDb();
    await keepAliveSupabase({
      SUPABASE_URL: '',
      SUPABASE_KEEPALIVE_URLS: '',
      PLATFORM_DB: db,
    } as unknown as Env);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(bound).toHaveLength(1);
    expect(bound[0][1]).toBe('(none)');
    expect(bound[0][2]).toBe(0);
    expect(bound[0][3]).toBe('no targets configured');
  });

  it('a heartbeat write failure does not throw out of the cron', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 200 })));
    const db = {
      prepare: () => ({ bind: () => ({}) }),
      batch: vi.fn(async () => {
        throw new Error('d1 unavailable');
      }),
    };
    await expect(
      keepAliveSupabase({
        SUPABASE_URL: 'https://live.supabase.co',
        PLATFORM_DB: db,
      } as unknown as Env),
    ).resolves.toBeUndefined();
  });
});

/**
 * 🔴 THE DEFECT THESE EXIST FOR, measured in production on 2026-07-29.
 *
 * `cron_heartbeat` held three rows (27-29 Jul), every one `ok=1`, every one
 * `detail: "HTTP 401"`. The keep-alive was being REJECTED at the door every
 * night and recording it as success, because `ok` was defined as
 * `res.status < 500`. Supabase pauses idle free projects, and `ratel`
 * (fkbmodjtxatrqcghhfba) is ALREADY `INACTIVE` in the same organisation — so
 * this is a demonstrated failure mode, not a hypothetical one, and the
 * instrument meant to warn about it was the thing lying.
 */
describe('keep-alive: a rejected request is not a success', () => {
  function capture() {
    const rows: { ok: unknown; detail: unknown }[] = [];
    const db = {
      prepare: () => ({
        bind: (...a: unknown[]) => {
          // INSERT ... (job, target, ok, detail, ran_at)
          rows.push({ ok: a[2], detail: a[3] });
          return { __stmt: true };
        },
      }),
      batch: vi.fn(async () => []),
    };
    return { db, rows };
  }

  it('records a 401 as a FAILURE, not a success', async () => {
    const { db, rows } = capture();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 401 })));
    await keepAliveSupabase(env({ PLATFORM_DB: db } as never));
    expect(rows).toHaveLength(1);
    expect(rows[0].ok).toBe(0);
    expect(String(rows[0].detail)).toContain('401');
  });

  it('says WHY a 401 happened when no anon key is configured', async () => {
    const { db, rows } = capture();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 401 })));
    await keepAliveSupabase(env({ PLATFORM_DB: db } as never));
    expect(String(rows[0].detail)).toContain('no SUPABASE_ANON_KEY configured');
  });

  it('distinguishes "key present but refused" from "no key at all"', async () => {
    const { db, rows } = capture();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 401 })));
    await keepAliveSupabase(
      env({ PLATFORM_DB: db, SUPABASE_ANON_KEY: 'anon-key' } as never),
    );
    expect(String(rows[0].detail)).toContain('key present but refused');
  });

  it('SENDS the anon key when it has one — that is what makes it a real request', async () => {
    const { db } = capture();
    const seen: Record<string, string>[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: { headers?: Record<string, string> }) => {
        seen.push(init?.headers ?? {});
        return new Response('', { status: 200 });
      }),
    );
    await keepAliveSupabase(
      env({ PLATFORM_DB: db, SUPABASE_ANON_KEY: 'anon-key' } as never),
    );
    expect(seen[0].apikey).toBe('anon-key');
    expect(seen[0].Authorization).toBe('Bearer anon-key');
  });

  it('records a 200 as a success', async () => {
    const { db, rows } = capture();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 200 })));
    await keepAliveSupabase(env({ PLATFORM_DB: db } as never));
    expect(rows[0].ok).toBe(1);
  });

  // The old rule was `status < 500`. Anything in 4xx is the range where it lied.
  it.each([400, 401, 403, 404, 429])('records %i as a failure', async (status) => {
    const { db, rows } = capture();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status })));
    await keepAliveSupabase(env({ PLATFORM_DB: db } as never));
    expect(rows[0].ok).toBe(0);
  });

  // EVERY configured target must leave a row. A target that silently writes
  // nothing is indistinguishable from one that was never configured.
  it('writes one row per configured target', async () => {
    const { db, rows } = capture();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 200 })));
    await keepAliveSupabase(
      env({
        PLATFORM_DB: db,
        SUPABASE_KEEPALIVE_URLS: 'https://a.supabase.co,https://b.supabase.co',
      } as never),
    );
    expect(rows).toHaveLength(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// [pipeline B-11] THE SECOND CRON JOB WRITES ITS OWN RECORD.
//
// 🔴 THE RED THIS BLOCK WAS WRITTEN AGAINST, VERIFIED ON THE TREE AT 3982c41:
// `scheduled` ran `recomputeRenewals` for every app target, that function
// returned `void`, and `cron_heartbeat` received NOT ONE ROW from it — ever.
// The consequence is the one this whole discipline exists for: the requirement
// "every configured target has a heartbeat row" was TRUE, and true for a reason
// that had nothing to do with renewals. It ranged over the keep-alive's targets
// only, so the renewals fan-out could have been deleted from the cron outright
// and no assertion anywhere would have moved.
//
// Asserted against the REAL SQL engine with the REAL migrations, so "a row
// landed" is a COUNT against `cron_heartbeat` and not a record of which methods
// a double was asked for.
// ─────────────────────────────────────────────────────────────────────────────
describe('[4]B-11 · the renewals fan-out writes a heartbeat per target', () => {
  /** An app DB with the two tables `recomputeRenewals` reads, and nothing due. */
  function appDb() {
    return realPlatformDb([
      `CREATE TABLE subscriptions (
         id TEXT PRIMARY KEY, user_id TEXT, price REAL, cycle TEXT, next_renewal TEXT, updated_at TEXT
       )`,
      `CREATE TABLE payment_history (
         id TEXT PRIMARY KEY, subscription_id TEXT, user_id TEXT, amount REAL, paid_at TEXT
       )`,
    ]);
  }

  it('writes a row for the app it fanned out to — the claim that was false before', async () => {
    const platform = realPlatformDb();
    const app = appDb();
    await renewalsFanOut({ PLATFORM_DB: platform, SUBLY_DB: app } as unknown as Env);

    expect(platform.count('cron_heartbeat', 'job = ?', RENEWALS_JOB)).toBe(1);
    const [row] = platform.rows('SELECT target, ok, detail FROM cron_heartbeat WHERE job = ?', RENEWALS_JOB);
    expect(row.target).toBe('subly');
    expect(row.ok).toBe(1);
    // "nothing due" is a SUCCESS with its own detail — a quiet night and a
    // thrown query must not produce the same row.
    expect(String(row.detail)).toContain('nothing due');
  });

  it('a FAILING app database is recorded as ok=0, not swallowed into silence', async () => {
    const platform = realPlatformDb();
    // No `subscriptions` table at all — the SELECT throws, exactly as a schema
    // drift or a D1 outage would.
    const broken = realPlatformDb();
    await renewalsFanOut({ PLATFORM_DB: platform, SUBLY_DB: broken } as unknown as Env);

    const [row] = platform.rows('SELECT ok, detail FROM cron_heartbeat WHERE job = ?', RENEWALS_JOB);
    expect(row.ok).toBe(0);
    expect(String(row.detail)).not.toBe('');
  });

  it('an UNBOUND app database is a failure row, never "ran fine, nothing due"', async () => {
    const platform = realPlatformDb();
    await renewalsFanOut({ PLATFORM_DB: platform, SUBLY_DB: undefined } as unknown as Env);
    const [row] = platform.rows('SELECT ok, detail FROM cron_heartbeat WHERE job = ?', RENEWALS_JOB);
    expect(row.ok).toBe(0);
    expect(String(row.detail)).toContain('no database binding');
  });

  it('the job name is DISTINCT from the keep-alive\'s — one table, three meanings', async () => {
    // If both jobs wrote under one name, "is the keep-alive healthy" and "are
    // renewals healthy" would be the same query and neither could be answered.
    const platform = realPlatformDb();
    await renewalsFanOut({ PLATFORM_DB: platform, SUBLY_DB: appDb() } as unknown as Env);
    expect(platform.count('cron_heartbeat', 'job = ?', KEEPALIVE_JOB)).toBe(0);
    expect(new Set([KEEPALIVE_JOB, ANALYTICS_LIVENESS_JOB, RENEWALS_JOB]).size).toBe(3);
  });

  it('a real due subscription is advanced AND the detail reports the counts', async () => {
    // The success path with actual work in it: "nothing due" passing is not
    // evidence that a night with work records anything sensible.
    const platform = realPlatformDb();
    const app = appDb();
    app.db.exec(
      `INSERT INTO subscriptions (id, user_id, price, cycle, next_renewal)
       VALUES ('s1', 'u1', 9.99, 'monthly', '2020-01-15')`,
    );
    await renewalsFanOut({ PLATFORM_DB: platform, SUBLY_DB: app } as unknown as Env);

    const [row] = platform.rows('SELECT ok, detail FROM cron_heartbeat WHERE job = ?', RENEWALS_JOB);
    expect(row.ok).toBe(1);
    expect(String(row.detail)).toContain('advanced 1 subscription(s)');
    // …and the work really happened, not just the row about it.
    expect(app.count('payment_history')).toBeGreaterThan(0);
  });
});
