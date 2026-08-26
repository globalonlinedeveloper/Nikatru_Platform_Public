// ─────────────────────────────────────────────────────────────────────────────
// health.test.ts — THE RECORDED FAILING CASES FOR `/v1/health` ON subly-api.
//
// The twin of services/platform/test/health.test.ts; read that file's header for
// why the deliverable is the failing cases rather than the module. The same
// three-state machinery is under test here because src/lib/health.ts is a
// BYTE-IDENTICAL copy — held so by
// services/platform/test/twinned-worker-modules.test.ts — but the DEPENDENCY SET
// is this Worker's own and is asserted separately, which is the half a shared
// module cannot cover.
//
// 🔴 THE FINDING THIS FILE RECORDS RATHER THAN FIXES. GlitchTip monitor id 2
// (`Subly API health`, tooling/monitor-register.json) asserts `expectedStatus:
// 200` and NO `expectedBody`. So an honest `ok:false` from this Worker still
// leaves that monitor GREEN — the deploy smoke catches it, the 60-second monitor
// does not. That is asserted below as a live property of the register, so the
// day somebody adds the body assertion this test tells them the gap closed.
// Fixing it means editing tooling/monitor-register.json and the live GlitchTip
// monitor, neither of which is this Worker's source.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, vi, afterEach } from 'vitest';
import { judge, judgeOk } from '../../../tooling/ops/post-deploy-smoke.mjs';
import monitorRegisterRaw from '../../../tooling/monitor-register.json?raw';

const BUILD = '4146d31c0ffee5eba11deadbeef0123456789abc';

const APP_DB_SECRET = 'D1_ERROR: connect ECONNREFUSED subly-app-db.internal:5432 token=sk_live_7c21';
const PLATFORM_DB_SECRET = 'D1_ERROR: platform-db.internal refused (auth 10001)';

interface Ctx {
  waitUntil(p: Promise<unknown>): void;
  passThroughOnException(): void;
}
const ctx: Ctx = { waitUntil: () => undefined, passThroughOnException: () => undefined };

function okDb() {
  return {
    calls: 0,
    prepare(_sql: string) {
      this.calls += 1;
      return { first: async () => null };
    },
  };
}

function deadDb(message: string) {
  return {
    prepare(_sql: string): { first: () => Promise<unknown> } {
      throw new Error(message);
    },
  };
}

function hangingDb() {
  return {
    prepare(_sql: string) {
      return { first: () => new Promise<unknown>(() => undefined) };
    },
  };
}

function jwksOk() {
  return async () =>
    new Response(JSON.stringify({ keys: [{ kty: 'EC', kid: 'test-key-1', alg: 'ES256' }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
}

function env(over: Record<string, unknown> = {}) {
  return {
    APP_ID: 'subly',
    API_VERSION: 'v1',
    RELEASE: BUILD,
    SUPABASE_URL: 'https://project.supabase.co',
    ALLOWED_ORIGINS: 'https://subly.nikatru.com',
    APP_DB: okDb(),
    PLATFORM_DB: okDb(),
    JWKS_CACHE: { async get(_k: string) { return null; } },
    ...over,
  };
}

async function freshWorker() {
  vi.resetModules();
  const mod = await import('../src/index');
  return mod.default as unknown as {
    fetch(req: Request, env: unknown, ctx: Ctx): Promise<Response>;
  };
}

interface Reading {
  name: string;
  status: string;
  reason: string | null;
  ageMs: number;
}
interface Body {
  ok: boolean;
  status: string;
  app: string;
  version: string;
  build: string | null;
  time: string;
  checks: Reading[];
}

async function health(bindings: Record<string, unknown> = {}) {
  const worker = await freshWorker();
  const res = await worker.fetch(new Request('https://api.nikatru.com/v1/health'), env(bindings), ctx);
  const text = await res.text();
  return { res, text, body: JSON.parse(text) as Body };
}

function reading(body: Body, name: string): Reading {
  const found = body.checks.find((c) => c.name === name);
  if (!found) throw new Error(`no reading named ${name} — the check set changed shape`);
  return found;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('/v1/health — the healthy answer keeps the OLD shape', () => {
  it('answers ok:true, 200, and the fields the deploy smoke joins on', async () => {
    vi.stubGlobal('fetch', jwksOk());
    const { res, text, body } = await health();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.status).toBe('ok');
    expect(body.build).toBe(BUILD);
    expect(body.app).toBe('subly');
    expect(text).toContain('"ok":true');
    expect(judgeOk(text)).toBe(true);
    expect(judge({ status: res.status, body: text, field: 'build', expected: BUILD }).ok).toBe(true);
  });

  it('looks at THIS Worker’s dependencies — both databases and the JWKS', async () => {
    vi.stubGlobal('fetch', jwksOk());
    const { body } = await health();
    expect(body.checks.map((c) => c.name).sort()).toEqual([
      'app_db',
      'platform_db',
      'supabase_jwks',
    ]);
  });
});

describe('🔴 APP_DB unreachable — the endpoint says NO', () => {
  it('reports ok:false, a degraded app_db, and the smoke goes red', async () => {
    vi.stubGlobal('fetch', jwksOk());
    const { res, text, body } = await health({ APP_DB: deadDb(APP_DB_SECRET) });
    expect(body.ok).toBe(false);
    expect(body.status).toBe('degraded');
    expect(reading(body, 'app_db')).toMatchObject({ status: 'degraded', reason: 'unreachable' });
    expect(reading(body, 'platform_db').status).toBe('ok');
    expect(judgeOk(text)).toBe(false);
    expect(text).not.toContain('"ok":true');
    // 200, so the smoke still reaches its ok-conjunct rather than retrying a
    // non-200 for a minute and reporting the wrong reason.
    expect(res.status).toBe(200);
    expect(judge({ status: res.status, body: text, field: 'build', expected: BUILD }).ok).toBe(true);
  });

  it('⛔ leaks no host, port, token or vendor error text', async () => {
    vi.stubGlobal('fetch', jwksOk());
    const { text } = await health({ APP_DB: deadDb(APP_DB_SECRET) });
    expect(text).not.toContain('ECONNREFUSED');
    expect(text).not.toContain('subly-app-db.internal');
    expect(text).not.toContain('sk_live_7c21');
    expect(text).not.toContain('SELECT');
    expect(text).not.toContain('subscriptions');
  });
});

describe('🔴 the SHARED PLATFORM_DB unreachable — the endpoint says NO', () => {
  it('reports ok:false even though this Worker’s own database is fine', async () => {
    vi.stubGlobal('fetch', jwksOk());
    const { text, body } = await health({ PLATFORM_DB: deadDb(PLATFORM_DB_SECRET) });
    expect(body.ok).toBe(false);
    expect(reading(body, 'platform_db')).toMatchObject({ status: 'degraded', reason: 'unreachable' });
    expect(reading(body, 'app_db').status).toBe('ok');
    expect(judgeOk(text)).toBe(false);
    expect(text).not.toContain('platform-db.internal');
    expect(text).not.toContain('entitlements');
  });
});

describe('🔴 the Supabase JWKS fetch failing — erasure is down and it SAYS so', () => {
  it('a non-2xx answer is degraded', async () => {
    vi.stubGlobal('fetch', async () => new Response('nope', { status: 500 }));
    const { text, body } = await health();
    expect(body.ok).toBe(false);
    expect(reading(body, 'supabase_jwks')).toMatchObject({
      status: 'degraded',
      reason: 'jwks_unavailable',
    });
    expect(judgeOk(text)).toBe(false);
  });

  it('a 200 with no keys is degraded — the shape a status check cannot see', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ keys: [] }), { status: 200 }));
    const { body } = await health();
    expect(body.ok).toBe(false);
    expect(reading(body, 'supabase_jwks')).toMatchObject({ status: 'degraded', reason: 'jwks_empty' });
  });

  it('a thrown fetch is degraded and leaks nothing', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new Error('getaddrinfo ENOTFOUND project.supabase.co');
    });
    const { res, text, body } = await health();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(false);
    expect(reading(body, 'supabase_jwks').status).toBe('degraded');
    expect(text).not.toContain('ENOTFOUND');
  });
});

describe('🔴 "I did not look" is NOT "healthy"', () => {
  it('an absent binding is unknown and makes the endpoint say no', async () => {
    vi.stubGlobal('fetch', jwksOk());
    const { text, body } = await health({ APP_DB: undefined });
    expect(reading(body, 'app_db')).toMatchObject({ status: 'unknown', reason: 'binding_absent' });
    expect(body.ok).toBe(false);
    expect(body.status).toBe('unknown');
    expect(judgeOk(text)).toBe(false);
  });

  it('a probe that times out is unknown, and the endpoint still answers', async () => {
    vi.stubGlobal('fetch', jwksOk());
    vi.useFakeTimers();
    const worker = await freshWorker();
    const pending = worker.fetch(
      new Request('https://api.nikatru.com/v1/health'),
      env({ APP_DB: hangingDb() }),
      ctx,
    );
    await vi.advanceTimersByTimeAsync(2100);
    const res = await pending;
    const text = await res.text();
    const body = JSON.parse(text) as Body;
    expect(res.status).toBe(200);
    expect(reading(body, 'app_db')).toMatchObject({ status: 'unknown', reason: 'probe_timeout' });
    expect(body.ok).toBe(false);
    expect(judgeOk(text)).toBe(false);
  });
});

describe('the cache carries its AGE', () => {
  it('reuses a reading inside the TTL and reports how old it is', async () => {
    vi.stubGlobal('fetch', jwksOk());
    const db = okDb();
    const bindings = env({ APP_DB: db });
    const worker = await freshWorker();
    const t0 = 1_700_000_000_000;
    const clock = vi.spyOn(Date, 'now').mockReturnValue(t0);

    const first = await worker.fetch(new Request('https://api.nikatru.com/v1/health'), bindings, ctx);
    expect(reading(JSON.parse(await first.text()) as Body, 'app_db').ageMs).toBe(0);
    expect(db.calls).toBe(1);

    clock.mockReturnValue(t0 + 900);
    const second = await worker.fetch(new Request('https://api.nikatru.com/v1/health'), bindings, ctx);
    const b2 = JSON.parse(await second.text()) as Body;
    expect(db.calls).toBe(1); // the fan-out was collapsed
    expect(reading(b2, 'app_db').ageMs).toBe(900); // and the response says so
    clock.mockRestore();
  });

  it('past the TTL it looks again, so a dependency that broke is not masked', async () => {
    vi.stubGlobal('fetch', jwksOk());
    const flaky = {
      calls: 0,
      prepare(_sql: string) {
        this.calls += 1;
        if (this.calls > 1) throw new Error(APP_DB_SECRET);
        return { first: async () => null };
      },
    };
    const bindings = env({ APP_DB: flaky });
    const worker = await freshWorker();
    const t0 = 1_700_000_000_000;
    const clock = vi.spyOn(Date, 'now').mockReturnValue(t0);
    const first = await worker.fetch(new Request('https://api.nikatru.com/v1/health'), bindings, ctx);
    expect((JSON.parse(await first.text()) as Body).ok).toBe(true);

    clock.mockReturnValue(t0 + 5100);
    const second = await worker.fetch(new Request('https://api.nikatru.com/v1/health'), bindings, ctx);
    const text = await second.text();
    expect(flaky.calls).toBe(2);
    expect((JSON.parse(text) as Body).ok).toBe(false);
    expect(judgeOk(text)).toBe(false);
    clock.mockRestore();
  });
});

describe('🔴 THE MONITOR GAP THIS CHANGE CANNOT CLOSE FROM HERE', () => {
  it('monitor id 2 asserts STATUS ONLY, so an honest ok:false leaves it green', async () => {
    const register = JSON.parse(monitorRegisterRaw) as {
      hosts?: Array<{ hostname?: string; monitor?: Record<string, unknown> }>;
    };
    const hosts = register.hosts ?? [];
    // COVERAGE SELF-CHECK: a register that stopped parsing would make every
    // assertion below hold vacuously.
    expect(hosts.length).toBeGreaterThan(0);
    const mine = hosts.find((h) => h.hostname === 'api.nikatru.com');
    expect(mine, 'api.nikatru.com is no longer in the monitor register').toBeTruthy();
    const monitor = mine?.monitor ?? {};
    expect(monitor.path).toBe('/v1/health');
    expect(monitor.expectedStatus).toBe(200);

    // THE GAP, ASSERTED AS A FACT. This Worker now answers 200 + ok:false when a
    // dependency is down (proved above), and this monitor never reads the body —
    // so it cannot see that. The day an `expectedBody` is added, this line goes
    // red and the comment at the top of this file should be deleted with it.
    expect(monitor.expectedBody).toBeUndefined();

    // And the contrast that shows the fix is only a register change away:
    // platform's monitor DOES assert the body, over the same response shape.
    const platform = hosts.find((h) => h.hostname === 'platform.nikatru.com');
    expect(platform?.monitor?.expectedBody).toBe('"ok":true');
  });
});
