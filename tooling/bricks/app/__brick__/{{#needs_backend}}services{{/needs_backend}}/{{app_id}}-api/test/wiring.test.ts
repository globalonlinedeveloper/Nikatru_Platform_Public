import { describe, it, expect, vi, afterEach } from 'vitest';
import { app } from '../src/index';
import type { AppEnv } from '../src/types';

// ─────────────────────────────────────────────────────────────────────────────
// wiring.test.ts — WHAT THIS WORKER WIRES, driven through its REAL app.
//
// ⏱ 2026-10-01 · rv2 SYN-S2 (services-018,
// services-033). The modules are the kit's and their own cases run here through
// `../_shared/test/**`; what a stamped Worker can get wrong on its own is the
// MOUNTING — the request-id middleware, `onError` reaching the sink, and which
// dependencies `/v1/health` looks at. The live Workers carry the same cases.
// ─────────────────────────────────────────────────────────────────────────────

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DSN = 'https://abc123@glitchtip.example.test/7';
const CTX = { waitUntil: (p: Promise<unknown>) => void p, passThroughOnException: () => {} };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the correlation id', () => {
  it('a plain caller id is echoed back unchanged', async () => {
    const res = await app.request('/nope', { headers: { 'x-request-id': 'rid-123' } }, {} as AppEnv['Bindings']);
    expect(res.headers.get('x-request-id')).toBe('rid-123');
  });

  it('🔴 `a@b.c` and a 500-character id are each replaced by a fresh uuid, echoed back', async () => {
    for (const bad of ['a@b.c', 'x'.repeat(500)]) {
      const res = await app.request('/nope', { headers: { 'x-request-id': bad } }, {} as AppEnv['Bindings']);
      expect(res.headers.get('x-request-id')).toMatch(UUID);
    }
  });
});

describe('an unhandled error reaches the sink, naming this Worker', () => {
  it('the REAL onError reports with the deployed release and no query string', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const sent: string[] = [];
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      sent.push(String(init.body));
      return new Response('', { status: 200 });
    });
    // APP_ID throws when the health route reads it: a genuine unhandled error.
    const env = new Proxy({ GLITCHTIP_DSN: DSN, RELEASE: 'sha123' } as Record<string, unknown>, {
      get(target, prop: string) {
        if (prop === 'APP_ID') throw new TypeError('binding exploded');
        return target[prop];
      },
    });
    const res = await app.fetch(new Request('https://api.example.test/v1/health?email=a@b.test'), env as never, CTX as never);
    expect(res.status).toBe(500);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain('"server_name":"{{app_id}}-api"');
    expect(sent[0]).toContain('"release":"sha123"');
    expect(sent[0]).not.toContain('email=');
  });
});

describe('/v1/health looks at THIS Worker’s dependencies', () => {
  const okDb = () => ({ prepare: () => ({ first: async () => ({ ok: 1 }) }) });
  // The route's probe cache lives for the isolate, so each case reads at its own
  // instant, an hour apart: no case can be answered from another's reading.
  const at = (ms: number) => vi.spyOn(Date, 'now').mockReturnValue(ms);

  it('answers ok:true with app_db, platform_db and supabase_jwks all ok', async () => {
    at(1_000_000_000_000);
    vi.stubGlobal('fetch', async () => Response.json({ keys: [{ kid: 'k' }] }));
    const env = { APP_DB: okDb(), PLATFORM_DB: okDb(), SUPABASE_URL: 'https://id.example.test', APP_ID: '{{app_id}}', API_VERSION: 'v1' };
    const res = await app.fetch(new Request('https://api.example.test/v1/health'), env as never, CTX as never);
    const body = (await res.json()) as { ok: boolean; checks: Array<{ name: string; status: string }> };
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.checks.map((c) => c.name).sort()).toEqual(['app_db', 'platform_db', 'supabase_jwks']);
  });

  it('🔴 an absent APP_DB says ok:false, still with HTTP 200', async () => {
    at(1_000_003_600_000);
    vi.stubGlobal('fetch', async () => Response.json({ keys: [{ kid: 'k' }] }));
    const env = { PLATFORM_DB: okDb(), SUPABASE_URL: 'https://id2.example.test', APP_ID: '{{app_id}}', API_VERSION: 'v1' };
    const res = await app.fetch(new Request('https://api.example.test/v1/health'), env as never, CTX as never);
    const body = (await res.json()) as { ok: boolean; checks: Array<{ name: string; status: string; reason: string | null }> };
    expect(res.status).toBe(200);
    expect(body.ok).toBe(false);
    expect(body.checks.find((c) => c.name === 'app_db')).toMatchObject({ status: 'unknown', reason: 'binding_absent' });
  });
});
