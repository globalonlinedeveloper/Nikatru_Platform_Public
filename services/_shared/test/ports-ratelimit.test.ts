import { describe, it, expect, vi, afterEach } from 'vitest';
import { memoryRateLimiter } from '../src/ports/fakes/ratelimit';
import { strictRateLimit, withinRateLimit } from '../src/rate-limit';
import { RATELIMIT_SCENARIOS, runRateLimitConformance } from './conformance/ratelimit';

// ─────────────────────────────────────────────────────────────────────────────
// ports-ratelimit.test.ts — tooling/ports/ratelimit.json adapter `memory`: the
// fake passes the rate-limiter conformance suite, and the kit's two policies
// (src/rate-limit.ts) answer through the PORT exactly as they do through the
// binding: over budget is `false` / 'over'. The binding's own run is PENDING in
// the registry (no Worker suite runs on workerd).
// ─────────────────────────────────────────────────────────────────────────────

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ratelimit port — the memory fake passes the conformance suite', () => {
  runRateLimitConformance(
    {
      adapter: 'memory',
      make: (budget) => {
        let t = 0;
        return { limiter: memoryRateLimiter({ budget, periodSeconds: 60, now: () => t }), advance: (ms: number) => void (t += ms), periodSeconds: 60 };
      },
    },
    it,
  );
});

describe('ratelimit conformance — the runner can fail', () => {
  const collect = () => {
    const cases = new Map<string, () => Promise<void>>();
    return { cases, it: (name: string, run: () => Promise<void>) => void cases.set(name, run) };
  };

  it('registers every scenario', () => {
    const c = collect();
    runRateLimitConformance({ adapter: 'x', make: (budget) => ({ limiter: memoryRateLimiter({ budget }), periodSeconds: 60 }) }, c.it);
    expect(c.cases.size).toBe(RATELIMIT_SCENARIOS.length);
  });

  it('🔴 a limiter that always admits fails `over-budget-fails`', async () => {
    const c = collect();
    runRateLimitConformance({ adapter: 'open', make: () => ({ limiter: { limit: async () => ({ success: true }) }, periodSeconds: 60 }) }, c.it);
    await expect(c.cases.get('open · ratelimit · over-budget-fails')!()).rejects.toThrow(/budget of two/);
  });

  it('🔴 an adapter with no clock FAILS the window scenario — never a skip', async () => {
    const c = collect();
    runRateLimitConformance({ adapter: 'no-clock', make: (budget) => ({ limiter: memoryRateLimiter({ budget }), periodSeconds: 60 }) }, c.it);
    await expect(c.cases.get('no-clock · ratelimit · the-window-rolls')!()).rejects.toThrow(/no fixture for scenario `the-window-rolls`/);
  });
});

describe("the kit's policies over the port", () => {
  it('withinRateLimit (fail-open) answers false once the limiter is over budget', async () => {
    const limiter = memoryRateLimiter({ budget: 1 });
    await expect(withinRateLimit(limiter, 'k', 'PORT_LIMITER')).resolves.toBe(true);
    await expect(withinRateLimit(limiter, 'k', 'PORT_LIMITER')).resolves.toBe(false);
  });

  it("strictRateLimit (fail-closed) answers 'over' once the limiter is over budget", async () => {
    const limiter = memoryRateLimiter({ budget: 1 });
    await expect(strictRateLimit(limiter, 'k', 'PORT_LIMITER')).resolves.toBe('within');
    await expect(strictRateLimit(limiter, 'k', 'PORT_LIMITER')).resolves.toBe('over');
  });
});
