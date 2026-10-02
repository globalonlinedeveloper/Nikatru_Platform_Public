import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  JWKS_READING_TTL_MS,
  READING_TTL_MS,
  inspect,
  newProbeCache,
  probeBinding,
  probeJwks,
  timeBox,
  worstOf,
  type ProbeOutcome,
  type ProbeReading,
} from '../src/health';

// ─────────────────────────────────────────────────────────────────────────────
// health.test.ts — THE HEALTH MODULE'S OWN CASES, beside the one home.
//
// ⏱ 2026-10-01 · rv2 SYN-S2 (services-033).
// src/health.ts was exercised only THROUGH each carrier's /v1/health route, in
// services/platform and services/subscriptiontracker-api — so the brick's stamped
// Worker, which has no health test of its own, ran the three-state machinery
// untested, and the one decision every carrier's `ok` rests on (`worstOf`) had no
// case naming it. The machinery's cases live here, where every Worker's vitest
// runs them; each carrier keeps the WIRING (which dependencies its route probes).
// ─────────────────────────────────────────────────────────────────────────────

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const reading = (status: ProbeReading['status']): ProbeReading => ({ name: status, status, reason: null, ageMs: 0 });
const ok = (): Promise<ProbeOutcome> => Promise.resolve({ status: 'ok', reason: null });

describe('worstOf — the summary a report carries', () => {
  it('degraded outranks unknown, and unknown outranks ok', () => {
    expect(worstOf([reading('ok'), reading('unknown'), reading('degraded')])).toBe('degraded');
    expect(worstOf([reading('ok'), reading('unknown')])).toBe('unknown');
    expect(worstOf([reading('ok'), reading('ok')])).toBe('ok');
  });

  it('🔴 NO readings is unknown, never ok — "I did not look" is not "healthy"', () => {
    expect(worstOf([])).toBe('unknown');
  });
});

describe('timeBox — a probe that hangs is answered, not awaited', () => {
  it('a probe slower than its box is unknown/probe_timeout', async () => {
    vi.useFakeTimers();
    const pending = timeBox(new Promise<ProbeOutcome>(() => {}), 50);
    await vi.advanceTimersByTimeAsync(50);
    await expect(pending).resolves.toEqual({ status: 'unknown', reason: 'probe_timeout' });
  });

  it('a probe inside its box keeps its own answer', async () => {
    await expect(timeBox(Promise.resolve({ status: 'degraded', reason: 'x' }), 1000)).resolves.toEqual({
      status: 'degraded',
      reason: 'x',
    });
  });
});

describe('inspect — the report, the cache and its age', () => {
  it('ok only when every probe is ok; a throwing probe is degraded/unreachable', async () => {
    const report = await inspect(
      newProbeCache(),
      [
        { name: 'a', ttlMs: READING_TTL_MS, run: ok },
        { name: 'b', ttlMs: READING_TTL_MS, run: () => Promise.reject(new Error('host:5432 token=sk_live_x')) },
      ],
      1_000,
    );
    expect(report.ok).toBe(false);
    expect(report.status).toBe('degraded');
    expect(report.checks.find((c) => c.name === 'b')).toEqual({ name: 'b', status: 'degraded', reason: 'unreachable', ageMs: 0 });
    // The vendor's error text never reaches the report.
    expect(JSON.stringify(report)).not.toContain('sk_live');
  });

  it('🔴 an EMPTY probe list is not ok', async () => {
    const report = await inspect(newProbeCache(), [], 1_000);
    expect(report.ok).toBe(false);
    expect(report.status).toBe('unknown');
  });

  it('reuses a reading inside its TTL and says how old it is; past the TTL it looks again', async () => {
    const cache = newProbeCache();
    let runs = 0;
    const spec = { name: 'db', ttlMs: READING_TTL_MS, run: () => (runs++, ok()) };
    await inspect(cache, [spec], 10_000);
    const again = await inspect(cache, [spec], 10_000 + READING_TTL_MS - 1);
    expect(runs).toBe(1);
    expect(again.checks[0].ageMs).toBe(READING_TTL_MS - 1);
    await inspect(cache, [spec], 10_000 + READING_TTL_MS);
    expect(runs).toBe(2);
  });
});

describe('the probes', () => {
  it('an absent binding is unknown/binding_absent, and is never read', async () => {
    const read = vi.fn();
    await expect(probeBinding(undefined, read)).resolves.toEqual({ status: 'unknown', reason: 'binding_absent' });
    expect(read).not.toHaveBeenCalled();
  });

  it('the JWKS probe: unconfigured is unknown, non-2xx and an empty key set are degraded', async () => {
    await expect(probeJwks(undefined)).resolves.toEqual({ status: 'unknown', reason: 'not_configured' });
    vi.stubGlobal('fetch', async () => new Response('', { status: 530 }));
    await expect(probeJwks('https://id.example.test')).resolves.toEqual({ status: 'degraded', reason: 'jwks_unavailable' });
    vi.stubGlobal('fetch', async () => Response.json({ keys: [] }));
    await expect(probeJwks('https://id.example.test')).resolves.toEqual({ status: 'degraded', reason: 'jwks_empty' });
    vi.stubGlobal('fetch', async () => Response.json({ keys: [{ kid: 'k' }] }));
    await expect(probeJwks('https://id.example.test')).resolves.toEqual({ status: 'ok', reason: null });
  });

  it('a JWKS reading is never staler than the JWKS cache it reports on', () => {
    expect(JWKS_READING_TTL_MS).toBeLessThanOrEqual(600 * 1000);
  });
});
