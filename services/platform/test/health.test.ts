// ─────────────────────────────────────────────────────────────────────────────
// health.test.ts — THE RECORDED FAILING CASES FOR `/v1/health`.
//
// 🔴 WHAT THIS FILE IS FOR. `ok` was the literal `true`, so the two probes that
// read it could not fail: `post-deploy-smoke.mjs --require-ok` and GlitchTip
// monitor 11's `"ok":true` body assertion. A health check nobody has watched go
// red is exactly what this change replaces — so the deliverable is not the
// three-state module, it is THIS: every dependency driven to failure with the
// endpoint shown reporting not-ok.
//
// Driven through the REAL Worker (`src/index.ts`), not a hand-built Hono app.
// The property under test is partly a WIRING — which dependencies the health
// route actually looks at, and in which order the response is assembled — and a
// local `new Hono()` would prove things about this file instead of about the
// Worker that ships.
//
// ⚠️ `vi.resetModules()` BEFORE EVERY IMPORT, AND IT IS LOAD-BEARING. The probe
// memo in src/index.ts is MODULE-SCOPED (one per isolate, by design — see
// src/lib/health.ts). Without a fresh module graph per test, a reading taken by
// one test would be served from cache to the next and half the assertions below
// would be measuring the previous test's dependency.
//
// 🔴 THE TWO SMOKE ASSERTIONS AT THE BOTTOM IMPORT THE REAL `judgeOk` AND THE
// REAL `judge` from tooling/ops/post-deploy-smoke.mjs. Restating what the smoke
// does would be a second copy of a contract that can drift from the first; this
// runs the shipped decision function over the shipped response body, which is
// the only way to show that the live probe becomes real WITHOUT ITSELF CHANGING.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, vi, afterEach } from 'vitest';
import { judge, judgeOk } from '../../../tooling/ops/post-deploy-smoke.mjs';

/** The SHA the deploy threads as `--var RELEASE`, and the value the smoke joins
 *  a deploy to with `--field build --expect <sha>`. */
const BUILD = '4146d31c0ffee5eba11deadbeef0123456789abc';

/** Deliberately full of things that must NEVER reach a public response body: a
 *  host, a port, a binding id and a vendor error code. Every failure below
 *  throws one of these, and the leak assertions look for them verbatim. */
const D1_SECRET = 'D1_ERROR: connect ECONNREFUSED platform-db.internal:5432 token=sk_live_9f3a';
const KV_SECRET = 'KV binding CONFIG_KV namespace_id=9c1f77e2b4 unauthorized (10001)';

interface Ctx {
  waitUntil(p: Promise<unknown>): void;
  passThroughOnException(): void;
}

const ctx: Ctx = { waitUntil: () => undefined, passThroughOnException: () => undefined };

/** A D1 stand-in whose read RESOLVES — a healthy dependency. `first()` answering
 *  `null` is what an empty table really returns, and it is a successful read. */
function okDb() {
  return {
    calls: 0,
    prepare(_sql: string) {
      this.calls += 1;
      return { first: async () => null };
    },
  };
}

/** A D1 stand-in that is UNREACHABLE. Throws from `prepare` — the synchronous
 *  shape, which src/lib/health.ts catches inside the try on purpose. */
function deadDb() {
  return {
    prepare(_sql: string): { first: () => Promise<unknown> } {
      throw new Error(D1_SECRET);
    },
  };
}

/** A D1 stand-in that never answers at all. */
function hangingDb() {
  return {
    prepare(_sql: string) {
      return { first: () => new Promise<unknown>(() => undefined) };
    },
  };
}

function okKv() {
  return { calls: 0, async get(_k: string) { this.calls += 1; return null; } };
}

function deadKv() {
  return {
    async get(_k: string): Promise<string | null> {
      throw new Error(KV_SECRET);
    },
  };
}

/** The JWKS document a working identity project serves. */
function jwksOk() {
  return async () =>
    new Response(JSON.stringify({ keys: [{ kty: 'EC', kid: 'test-key-1', alg: 'ES256' }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
}

function env(over: Record<string, unknown> = {}) {
  return {
    APP_ID: 'platform',
    API_VERSION: 'v1',
    RELEASE: BUILD,
    SUPABASE_URL: 'https://project.supabase.co',
    ALLOWED_ORIGINS: 'https://subly.nikatru.com',
    PLATFORM_DB: okDb(),
    CONFIG_KV: okKv(),
    ...over,
  };
}

/** A FRESH module graph, and therefore a fresh probe memo. See the header. */
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

/** One GET /v1/health against the real Worker. Returns the raw text too: the
 *  monitor asserts a BYTE SEQUENCE in the body, not a parsed field. */
async function health(bindings: Record<string, unknown> = {}) {
  const worker = await freshWorker();
  const res = await worker.fetch(
    new Request('https://platform.nikatru.com/v1/health'),
    env(bindings),
    ctx,
  );
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

describe('/v1/health — the healthy answer is still the OLD shape', () => {
  it('answers ok:true, 200, and every field the smoke and the monitor read', async () => {
    vi.stubGlobal('fetch', jwksOk());
    const { res, text, body } = await health();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.status).toBe('ok');
    expect(body.build).toBe(BUILD);
    expect(body.app).toBe('platform');
    expect(body.version).toBe('v1');

    // 🔴 THE MONITOR'S ASSERTION, VERBATIM. GlitchTip monitor 11 carries
    // `expectedBody: "\"ok\":true"` — a substring match on the raw body, not a
    // parse. If serialisation ever put a space after the colon this would break
    // the live monitor silently, so the byte sequence itself is pinned.
    expect(text).toContain('"ok":true');

    // THE SMOKE'S ASSERTION, from the shipped decision function.
    expect(judgeOk(text)).toBe(true);
    expect(judge({ status: res.status, body: text, field: 'build', expected: BUILD }).ok).toBe(true);
  });

  it('names every dependency it looked at, each with an age', async () => {
    vi.stubGlobal('fetch', jwksOk());
    const { body } = await health();
    expect(body.checks.map((c) => c.name).sort()).toEqual([
      'config_kv',
      'platform_db',
      'supabase_jwks',
    ]);
    for (const c of body.checks) {
      expect(c.status).toBe('ok');
      expect(typeof c.ageMs).toBe('number');
    }
  });
});

describe('🔴 PLATFORM_DB unreachable — the endpoint says NO', () => {
  it('reports ok:false and a degraded platform_db, and the two live probes go red', async () => {
    vi.stubGlobal('fetch', jwksOk());
    const { res, text, body } = await health({ PLATFORM_DB: deadDb() });

    expect(body.ok).toBe(false);
    expect(body.status).toBe('degraded');
    expect(reading(body, 'platform_db')).toMatchObject({ status: 'degraded', reason: 'unreachable' });
    // The OTHER dependencies are still healthy and still say so — a health check
    // that collapses to one bit tells an operator nothing about where to look.
    expect(reading(body, 'config_kv').status).toBe('ok');
    expect(reading(body, 'supabase_jwks').status).toBe('ok');

    // ── THE PROOF THE TWO LIVE PROBES BECOME REAL, WITHOUT EITHER CHANGING ──
    expect(judgeOk(text)).toBe(false); // post-deploy-smoke.mjs --require-ok
    expect(text).not.toContain('"ok":true'); // GlitchTip monitor 11's body match

    // 🔴 STILL HTTP 200, DELIBERATELY. `judge()` treats every non-200 as
    // RETRYABLE, so a 503 would make "deployed and unwell" look exactly like
    // "not deployed yet" — collapsing the distinction --require-ok exists for.
    // The build still matches, so the smoke reaches its ok-conjunct and fails
    // THERE, with the right reason.
    expect(res.status).toBe(200);
    expect(judge({ status: res.status, body: text, field: 'build', expected: BUILD }).ok).toBe(true);
  });

  it('⛔ leaks no host, port, token or vendor error text', async () => {
    vi.stubGlobal('fetch', jwksOk());
    const { text } = await health({ PLATFORM_DB: deadDb() });
    expect(text).not.toContain('ECONNREFUSED');
    expect(text).not.toContain('platform-db.internal');
    expect(text).not.toContain('5432');
    expect(text).not.toContain('sk_live_9f3a');
    expect(text).not.toContain(D1_SECRET);
    // Nor the SQL, nor the table it names.
    expect(text).not.toContain('SELECT');
    expect(text).not.toContain('entitlements');
  });
});

describe('🔴 CONFIG_KV refusing reads — the endpoint says NO', () => {
  it('reports ok:false and a degraded config_kv', async () => {
    vi.stubGlobal('fetch', jwksOk());
    const { text, body } = await health({ CONFIG_KV: deadKv() });
    expect(body.ok).toBe(false);
    expect(reading(body, 'config_kv')).toMatchObject({ status: 'degraded', reason: 'unreachable' });
    expect(reading(body, 'platform_db').status).toBe('ok');
    expect(judgeOk(text)).toBe(false);
    expect(text).not.toContain('"ok":true');
  });

  it('⛔ leaks no namespace id or vendor error text', async () => {
    vi.stubGlobal('fetch', jwksOk());
    const { text } = await health({ CONFIG_KV: deadKv() });
    expect(text).not.toContain('namespace_id');
    expect(text).not.toContain('9c1f77e2b4');
    expect(text).not.toContain(KV_SECRET);
  });

  it('never WRITES to KV — the 1,000/day budget is what it reports on', async () => {
    vi.stubGlobal('fetch', jwksOk());
    const puts: string[] = [];
    const spy = {
      async get(_k: string) {
        return null;
      },
      async put(k: string) {
        puts.push(k);
      },
      async delete(k: string) {
        puts.push(k);
      },
    };
    const { body } = await health({ CONFIG_KV: spy });
    expect(body.ok).toBe(true);
    expect(puts).toEqual([]);
  });
});

describe('🔴 the Supabase JWKS fetch failing — the endpoint says NO', () => {
  it('a non-2xx answer is degraded, and every DELETE /v1/account would 401', async () => {
    vi.stubGlobal('fetch', async () => new Response('nope', { status: 503 }));
    const { text, body } = await health();
    expect(body.ok).toBe(false);
    expect(reading(body, 'supabase_jwks')).toMatchObject({
      status: 'degraded',
      reason: 'jwks_unavailable',
    });
    expect(judgeOk(text)).toBe(false);
    expect(text).not.toContain('"ok":true');
  });

  it('a 200 carrying NO keys is degraded — the failure a status check cannot see', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ keys: [] }), { status: 200 }));
    const { body } = await health();
    expect(body.ok).toBe(false);
    expect(reading(body, 'supabase_jwks')).toMatchObject({ status: 'degraded', reason: 'jwks_empty' });
  });

  it('a thrown fetch is degraded, not an unhandled 500', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new Error('getaddrinfo ENOTFOUND project.supabase.co');
    });
    const { res, text, body } = await health();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(false);
    expect(reading(body, 'supabase_jwks').status).toBe('degraded');
    expect(text).not.toContain('ENOTFOUND');
    expect(text).not.toContain('project.supabase.co');
  });
});

describe('🔴 "I did not look" is NOT "healthy"', () => {
  it('an ABSENT binding is unknown — never ok, never silently skipped', async () => {
    vi.stubGlobal('fetch', jwksOk());
    const { text, body } = await health({ PLATFORM_DB: undefined });
    expect(reading(body, 'platform_db')).toMatchObject({
      status: 'unknown',
      reason: 'binding_absent',
    });
    // THE WHOLE POINT: an unknown makes the endpoint say no. The old handler
    // would have answered ok:true with no binding at all.
    expect(body.ok).toBe(false);
    expect(body.status).toBe('unknown');
    expect(judgeOk(text)).toBe(false);
  });

  it('an UNCONFIGURED identity provider is unknown, not ok', async () => {
    vi.stubGlobal('fetch', jwksOk());
    const { body } = await health({ SUPABASE_URL: '' });
    expect(reading(body, 'supabase_jwks')).toMatchObject({
      status: 'unknown',
      reason: 'not_configured',
    });
    expect(body.ok).toBe(false);
  });

  it('a probe that TIMES OUT is unknown, and the endpoint still answers', async () => {
    vi.stubGlobal('fetch', jwksOk());
    vi.useFakeTimers();
    const worker = await freshWorker();
    const pending = worker.fetch(
      new Request('https://platform.nikatru.com/v1/health'),
      env({ PLATFORM_DB: hangingDb() }),
      ctx,
    );
    // Past PROBE_TIMEOUT_MS (2000). Without the deadline this never settles,
    // which is the failure mode a health check must not have.
    await vi.advanceTimersByTimeAsync(2100);
    const res = await pending;
    const text = await res.text();
    const body = JSON.parse(text) as Body;

    expect(res.status).toBe(200);
    expect(reading(body, 'platform_db')).toMatchObject({
      status: 'unknown',
      reason: 'probe_timeout',
    });
    expect(body.ok).toBe(false);
    expect(judgeOk(text)).toBe(false);
  });

  it('a DEGRADED reading outranks an UNKNOWN one in the summary status', async () => {
    vi.stubGlobal('fetch', jwksOk());
    const { body } = await health({ PLATFORM_DB: deadDb(), CONFIG_KV: undefined });
    expect(reading(body, 'platform_db').status).toBe('degraded');
    expect(reading(body, 'config_kv').status).toBe('unknown');
    // A measured failure is a more definite fact than an absence of evidence.
    expect(body.status).toBe('degraded');
    expect(body.ok).toBe(false);
  });
});

describe('the cache carries its AGE — a cached ok with no age is the same defect', () => {
  it('a second request inside the TTL reuses the reading AND says how old it is', async () => {
    vi.stubGlobal('fetch', jwksOk());
    const db = okDb();
    const kv = okKv();
    const bindings = env({ PLATFORM_DB: db, CONFIG_KV: kv });
    const worker = await freshWorker();

    const t0 = 1_700_000_000_000;
    const clock = vi.spyOn(Date, 'now').mockReturnValue(t0);

    const first = await worker.fetch(
      new Request('https://platform.nikatru.com/v1/health'),
      bindings,
      ctx,
    );
    const b1 = JSON.parse(await first.text()) as Body;
    expect(reading(b1, 'platform_db').ageMs).toBe(0);
    expect(db.calls).toBe(1);
    expect(kv.calls).toBe(1);

    // 1.2s later — inside READING_TTL_MS (5000).
    clock.mockReturnValue(t0 + 1200);
    const second = await worker.fetch(
      new Request('https://platform.nikatru.com/v1/health'),
      bindings,
      ctx,
    );
    const b2 = JSON.parse(await second.text()) as Body;

    // 🔴 THE FAN-OUT WAS COLLAPSED: the dependencies were NOT touched again.
    expect(db.calls).toBe(1);
    expect(kv.calls).toBe(1);
    // 🔴 AND THE RESPONSE SAYS THE READING IS OLD. This is the difference
    // between a cache and a lie.
    expect(reading(b2, 'platform_db').ageMs).toBe(1200);
    expect(reading(b2, 'config_kv').ageMs).toBe(1200);
    expect(b2.ok).toBe(true);
    clock.mockRestore();
  });

  it('past the TTL it looks again, so a dependency that broke is NOT masked', async () => {
    vi.stubGlobal('fetch', jwksOk());
    const flaky = {
      calls: 0,
      prepare(_sql: string) {
        this.calls += 1;
        if (this.calls > 1) throw new Error(D1_SECRET);
        return { first: async () => null };
      },
    };
    const bindings = env({ PLATFORM_DB: flaky });
    const worker = await freshWorker();

    const t0 = 1_700_000_000_000;
    const clock = vi.spyOn(Date, 'now').mockReturnValue(t0);
    const first = await worker.fetch(
      new Request('https://platform.nikatru.com/v1/health'),
      bindings,
      ctx,
    );
    expect((JSON.parse(await first.text()) as Body).ok).toBe(true);

    // 5.1s later — PAST READING_TTL_MS, so the memo must not be trusted.
    clock.mockReturnValue(t0 + 5100);
    const second = await worker.fetch(
      new Request('https://platform.nikatru.com/v1/health'),
      bindings,
      ctx,
    );
    const text = await second.text();
    const b2 = JSON.parse(text) as Body;
    expect(flaky.calls).toBe(2);
    expect(b2.ok).toBe(false);
    expect(reading(b2, 'platform_db').status).toBe('degraded');
    expect(reading(b2, 'platform_db').ageMs).toBe(0);
    expect(judgeOk(text)).toBe(false);
    clock.mockRestore();
  });

  it('the TTL is BELOW the smoke gap and the monitor interval it must not weaken', async () => {
    // Not a restatement of the constant — a check that the DERIVATION in
    // src/lib/health.ts still holds. post-deploy-smoke.mjs retries with
    // GAP_MS = 10_000, and GlitchTip monitor 11 polls at intervalSeconds 60 with
    // confirmationThreshold 2. A TTL at or above either would let two
    // consecutive looks rest on ONE reading.
    const { READING_TTL_MS } = await import('../src/lib/health');
    expect(READING_TTL_MS).toBeLessThan(10_000);
    expect(READING_TTL_MS).toBeLessThan(60_000);
  });
});
