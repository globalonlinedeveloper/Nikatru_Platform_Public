import { describe, it, expect, vi, afterEach } from 'vitest';
import { app } from '../src/index';

// ─────────────────────────────────────────────────────────────────────────────
// health.test.ts — THE KEYS `/v1/health` ANSWERS, pinned, through the REAL app.
//
// ⏱ 2026-10-01 · O-BRICK-HEALTH-HAS-NO-BUILD (rv2-services-010). The stamped
// route answered `{ ok, status, app, version, time, checks }` — no `build` — so
// the deploy smoke's `--field build` had nothing to join on, and
// tooling/ci/assert-analytics-contract.mjs failed this route in the stamped app's
// own CI. The live Worker this template was extracted from has answered `build`
// since its deploy lane joined on it; services/subscriptiontracker-api/test/
// health.test.ts is its twin. The set is asserted EXACTLY, both ways: a key
// dropped is a smoke that cannot join, and a key added is a contract change the
// deploy smoke should be told about.
// ─────────────────────────────────────────────────────────────────────────────

const BUILD = '4146d31c0ffee5eba11deadbeef0123456789abc';
const CTX = { waitUntil: (p: Promise<unknown>) => void p, passThroughOnException: () => {} };
const okDb = () => ({ prepare: () => ({ first: async () => ({ ok: 1 }) }) });

function env(over: Record<string, unknown> = {}) {
  return {
    APP_DB: okDb(),
    PLATFORM_DB: okDb(),
    SUPABASE_URL: 'https://id.example.test',
    APP_ID: '{{app_id}}',
    API_VERSION: 'v1',
    RELEASE: BUILD,
    ...over,
  };
}

async function health(e: Record<string, unknown>, now: number) {
  // The route's probe cache lives for the isolate; each case reads at its own instant.
  vi.spyOn(Date, 'now').mockReturnValue(now);
  vi.stubGlobal('fetch', async () => Response.json({ keys: [{ kid: 'k' }] }));
  const res = await app.fetch(new Request('https://api.example.test/v1/health'), e as never, CTX as never);
  return { res, body: (await res.json()) as Record<string, unknown> };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('/v1/health answers the keys the deploy smoke joins on', () => {
  it('🔴 the key set is exactly { app, build, checks, ok, status, time, version }', async () => {
    const { res, body } = await health(env(), 2_000_000_000_000);
    expect(res.status).toBe(200);
    expect(Object.keys(body).sort()).toEqual(['app', 'build', 'checks', 'ok', 'status', 'time', 'version']);
  });

  it('🔴 `build` is the deployed RELEASE, verbatim — the value `--field build` compares', async () => {
    const { body } = await health(env(), 2_000_003_600_000);
    expect(body.build).toBe(BUILD);
    expect(body.version).toBe('v1');
    expect(body.app).toBe('{{app_id}}');
  });

  it('with no RELEASE passed, `build` is present and null — never absent, never "v1"', async () => {
    const { body } = await health(env({ RELEASE: undefined }), 2_000_007_200_000);
    expect(Object.hasOwn(body, 'build')).toBe(true);
    expect(body.build).toBeNull();
  });
});
