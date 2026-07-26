import { describe, it, expect, vi, afterEach } from 'vitest';
import { keepAliveTargets, keepAliveSupabase, KEEPALIVE_JOB } from '../src/scheduled';
import type { Env } from '../src/types';

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
      return { status: 200 } as Response;
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
    vi.stubGlobal('fetch', vi.fn(async () => ({ status: 503 }) as Response));
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
      return { status: 200 } as Response;
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
    vi.stubGlobal('fetch', vi.fn(async () => ({ status: 200 }) as Response));
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
