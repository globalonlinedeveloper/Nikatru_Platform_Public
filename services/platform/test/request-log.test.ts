// ─────────────────────────────────────────────────────────────────────────────
// ⏱ 2026-09-30 · review of #1090, minor 2 — ONE REQUEST LINE, NEVER A TOKEN.
//
// Invocation logs are off (wrangler.jsonc), so per-route timing comes from the
// line src/lib/request-log.ts writes. Driven through the REAL app with console
// captured: every line carries the route PATTERN, the status, the ms and the
// colo; no line, and no console output of any kind, carries a token-shaped
// segment; and the two capability routes write nothing at all, because a console
// event carries its invocation's request URL as metadata.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, vi, afterEach } from 'vitest';
import { app } from '../src/index';
import { CAPABILITY_ROUTES, requestLine } from '../src/lib/request-log';
import { mintToken } from '../src/lib/reminders';
import { sha256Hex } from '../src/middleware/ext-device-auth';
import { realPlatformDb } from './harness';

/** Any segment the error sink would call a capability: 32+ base64url characters. */
const TOKEN_SHAPED = /[A-Za-z0-9_-]{32,}/;

const ctx = { waitUntil: (p: Promise<unknown>) => void p, passThroughOnException: () => {} } as never;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** Every console call during `run`, by level, each argument serialised. */
async function captured(run: () => unknown): Promise<{ log: string[]; all: string[] }> {
  const seen: Record<'log' | 'warn' | 'error', string[]> = { log: [], warn: [], error: [] };
  for (const level of ['log', 'warn', 'error'] as const) {
    vi.spyOn(console, level).mockImplementation((...a: unknown[]) => {
      seen[level].push(a.map((x) => (typeof x === 'string' ? x : x instanceof Error ? `${x.name}: ${x.message}` : JSON.stringify(x))).join(' '));
    });
  }
  // GlitchTip is not under test here; answer its POST so nothing reaches the network.
  vi.stubGlobal('fetch', async () => new Response('', { status: 200 }));
  await run();
  return { log: seen.log, all: [...seen.log, ...seen.warn, ...seen.error] };
}

const reqLines = (log: string[]) => log.filter((l) => l.includes('"message":"[req] '));

describe('one structured line per request', () => {
  it('carries the route PATTERN, method, status, ms and colo — and its message carries them too', async () => {
    const { log } = await captured(() =>
      app.fetch(
        new Request('https://platform.example.test/v1/events', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ app_id: 'subscriptiontracker', events: [{ event_id: 'e1', event: 'app_open', anon_id: 'a1' }] }),
        }),
        { GLITCHTIP_DSN: 'https://k@glitchtip.example.test/1' } as never, // no PLATFORM_DB: the route throws
        ctx,
      ),
    );
    const lines = reqLines(log);
    expect(lines).toHaveLength(1);
    const line = JSON.parse(lines[0]) as ReturnType<typeof requestLine>;
    expect(line).toMatchObject({ route: '/v1/events', method: 'POST', status: 500, colo: null });
    expect(typeof line.ms).toBe('number');
    expect(line.message).toBe(`[req] POST /v1/events 500 ${line.ms}ms colo=-`);
  });

  it('a path parameter is reported by its NAME: a session id never appears', async () => {
    const id = crypto.randomUUID();
    const { log } = await captured(() => app.fetch(new Request(`https://platform.example.test/v1/sessions/${id}`, { method: 'DELETE' }), {} as never, ctx));
    const lines = reqLines(log);
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain(id);
    expect(lines[0]).not.toMatch(TOKEN_SHAPED);
  });

  it('with no route matched, a token-shaped segment makes the request SILENT — scrubbed is not enough, the event metadata has the URL', async () => {
    const token = mintToken();
    const { log, all } = await captured(() =>
      app.fetch(new Request(`https://platform.example.test/v1/nothing-here/${token}`), {} as never, ctx),
    );
    expect(reqLines(log)).toEqual([]);
    for (const l of all) expect(l).not.toContain(token);
  });
});

describe('🔴 the capability routes write NO console line at all', () => {
  it('GET /v1/calendar/<token>.ics — found, missing, and failing — logs nothing, and no output carries the token', async () => {
    const token = mintToken();
    const platform = realPlatformDb();
    platform.db
      .prepare('INSERT INTO reminder_feed (user_id, app_id, token_hash, created_at, revoked_at) VALUES (?, ?, ?, ?, NULL)')
      .run('u-log', 'subscriptiontracker', await sha256Hex(token), '2026-09-30T00:00:00Z');
    const { log, all } = await captured(async () => {
      // A live feed whose app database is not bound: the route throws after the token check.
      const failing = await app.fetch(new Request(`https://platform.example.test/v1/calendar/${token}.ics`), {
        PLATFORM_DB: platform,
        GLITCHTIP_DSN: 'https://k@glitchtip.example.test/1',
      } as never, ctx);
      expect(failing.status).toBe(500);
      // An unknown token: 404.
      const missing = await app.fetch(new Request(`https://platform.example.test/v1/calendar/${mintToken()}.ics`), {
        PLATFORM_DB: platform,
      } as never, ctx);
      expect(missing.status).toBe(404);
    });
    expect(reqLines(log)).toEqual([]);
    expect(all.filter((l) => l.startsWith('[unhandled]'))).toEqual([]);
    for (const l of all) expect(l).not.toContain(token);
  });

  it('GET and POST /v1/reminders/unsubscribe?t=<token> log nothing, and no output carries the token', async () => {
    const token = mintToken();
    const platform = realPlatformDb();
    const { log, all } = await captured(async () => {
      await app.fetch(new Request(`https://platform.example.test/v1/reminders/unsubscribe?t=${token}`), { PLATFORM_DB: platform } as never, ctx);
      await app.fetch(new Request(`https://platform.example.test/v1/reminders/unsubscribe?t=${token}`, { method: 'POST' }), {
        PLATFORM_DB: platform,
      } as never, ctx);
    });
    expect(reqLines(log)).toEqual([]);
    for (const l of all) expect(l).not.toContain(token);
  });

  it('every capability route names a route the app REALLY mounts — a rename cannot silently unmark one', () => {
    const mounted = new Set(app.routes.filter((r) => r.method !== 'ALL').map((r) => r.path));
    for (const route of CAPABILITY_ROUTES) expect(mounted.has(route), route).toBe(true);
    expect(CAPABILITY_ROUTES.size).toBeGreaterThanOrEqual(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ⏱ 2026-09-30 · delta review of #1090, finding 1 — THE SKIP KEYS ON THE PATH, NOT
// ONLY ON THE MATCHED HANDLER. Only GET is mounted on `/v1/calendar/:file`, so
// OPTIONS, PROPFIND or POST on a token URL matched no handler, fell back to the
// scrubbed path `/v1/calendar/:redacted`, and wrote a `[req]` line — whose Workers
// Logs event carries the full URL as metadata. Same for the unsubscribe URL with
// a trailing slash. RED on 27a71f36, GREEN after.
// ─────────────────────────────────────────────────────────────────────────────
describe('🔴 no console line for a capability URL, whatever the method or the trailing slash', () => {
  it('OPTIONS, PROPFIND and POST on /v1/calendar/<token>.ics write no [req] line and nothing carrying the token', async () => {
    const token = mintToken();
    const { log, all } = await captured(async () => {
      for (const method of ['OPTIONS', 'PROPFIND', 'POST']) {
        const res = await app.fetch(
          new Request(`https://platform.example.test/v1/calendar/${token}.ics`, { method, headers: { Origin: 'https://caldav.example' } }),
          { PLATFORM_DB: realPlatformDb() } as never,
          ctx,
        );
        expect(res.status, method).toBeLessThan(500);
      }
    });
    expect(reqLines(log)).toEqual([]);
    for (const l of all) expect(l).not.toContain(token);
  });

  it('the unsubscribe URL with a trailing slash (or a doubled one) writes nothing carrying the token', async () => {
    const token = mintToken();
    const { log, all } = await captured(async () => {
      for (const path of ['/v1/reminders/unsubscribe/', '/v1//reminders/unsubscribe/', '/v1/Reminders/Unsubscribe']) {
        await app.fetch(new Request(`https://platform.example.test${path}?t=${token}`), { PLATFORM_DB: realPlatformDb() } as never, ctx);
      }
    });
    expect(reqLines(log)).toEqual([]);
    for (const l of all) expect(l).not.toContain(token);
  });

  it('onError on such a path writes no [unhandled] line and nothing carrying the token — the report still goes to the sink', async () => {
    const token = mintToken();
    const sinkPosts: string[] = [];
    // Every env read but the sink's throws, so the first middleware that reads
    // the environment throws and the REAL onError runs.
    const env = new Proxy({ GLITCHTIP_DSN: 'https://k@glitchtip.example.test/1', RELEASE: 'sha' } as Record<string, unknown>, {
      get(t, k) {
        if (k === 'GLITCHTIP_DSN' || k === 'RELEASE') return t[k as string];
        if (typeof k === 'string' && /^[A-Z_]+$/.test(k)) throw new Error(`env ${k} unreadable`);
        return undefined;
      },
    });
    const { log, all } = await captured(async () => {
      vi.stubGlobal('fetch', async (_u: string, init: RequestInit) => {
        sinkPosts.push(String(init.body));
        return new Response('', { status: 200 });
      });
      const res = await app.fetch(
        new Request(`https://platform.example.test/v1/calendar/${token}.ics`, { method: 'OPTIONS', headers: { Origin: 'https://caldav.example' } }),
        env as never,
        ctx,
      );
      expect(res.status).toBe(500);
    });
    expect(sinkPosts).toHaveLength(1); // onError really ran, and reported
    expect(sinkPosts[0]).not.toContain(token);
    expect(all.filter((l) => l.startsWith('[unhandled]'))).toEqual([]);
    expect(reqLines(log)).toEqual([]);
    for (const l of all) expect(l).not.toContain(token);
  });

  it('negative control: an ordinary route still writes its ONE [req] line', async () => {
    const { log } = await captured(() => app.fetch(new Request('https://platform.example.test/v1/health'), {} as never, ctx));
    const lines = reqLines(log);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toMatchObject({ route: '/v1/health', method: 'GET' });
  });
});
