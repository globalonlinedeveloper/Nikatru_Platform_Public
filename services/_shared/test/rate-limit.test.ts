import { describe, it, expect, vi, afterEach } from 'vitest';
import { edgeCeilingKey, strictRateLimit, withinRateLimit, type RateLimiterBinding } from '../src/rate-limit';

// ─────────────────────────────────────────────────────────────────────────────
// rate-limit.test.ts — the two limiters and the server-derived edge key.
// ⏱ 2026-10-01 · services-009: src/rate-limit.ts is the one home every Worker
// (and every stamped one) carries; these cases run in each of them.
//   · withinRateLimit FAILS OPEN — absent or throwing binding admits — and the
//     two faults are different log lines, so a dead breaker is tellable from a
//     working one;
//   · strictRateLimit FAILS CLOSED — absent or throwing is 'unavailable';
//   · the edge key takes nothing from the caller.
// ─────────────────────────────────────────────────────────────────────────────

afterEach(() => {
  vi.restoreAllMocks();
});

const limiter = (success: boolean): RateLimiterBinding => ({ limit: async () => ({ success }) });
const throwing: RateLimiterBinding = {
  limit: async () => {
    throw new Error('edge hiccup');
  },
};

describe('withinRateLimit — fails OPEN, and says which way', () => {
  it('answers what the binding answers', async () => {
    await expect(withinRateLimit(limiter(true), 'k', 'A_LIMITER')).resolves.toBe(true);
    await expect(withinRateLimit(limiter(false), 'k', 'A_LIMITER')).resolves.toBe(false);
  });

  it('🔴 an ABSENT binding admits and logs an error ONCE per isolate', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const name = `ABSENT_${Math.random()}`;
    await expect(withinRateLimit(undefined, 'k', name)).resolves.toBe(true);
    await expect(withinRateLimit(undefined, 'k', name)).resolves.toBe(true);
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0][0])).toContain(name);
  });

  it('a binding that THROWS admits and warns every time', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(withinRateLimit(throwing, 'k', 'T_LIMITER')).resolves.toBe(true);
    await expect(withinRateLimit(throwing, 'k', 'T_LIMITER')).resolves.toBe(true);
    expect(warn).toHaveBeenCalledTimes(2);
  });
});

describe('strictRateLimit — fails CLOSED', () => {
  it('within / over / unavailable', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(strictRateLimit(limiter(true), 'k', 'S')).resolves.toBe('within');
    await expect(strictRateLimit(limiter(false), 'k', 'S')).resolves.toBe('over');
    await expect(strictRateLimit(undefined, 'k', `S_${Math.random()}`)).resolves.toBe('unavailable');
    await expect(strictRateLimit(throwing, 'k', 'S')).resolves.toBe('unavailable');
  });
});

describe('edgeCeilingKey — nothing in the key comes from the caller', () => {
  const ctx = (cf: unknown) => ({ req: { raw: Object.assign(new Request('https://x.test/'), { cf }) } });

  it('is edge:<colo>:<asn> from request.cf', () => {
    expect(edgeCeilingKey(ctx({ colo: 'BOM', asn: 13335 }))).toBe('edge:BOM:13335');
  });

  it('🔴 a missing or hostile cf degrades to ONE bucket, never a per-request key', () => {
    expect(edgeCeilingKey(ctx(undefined))).toBe('edge:-:-');
    expect(edgeCeilingKey(ctx({ colo: 'X'.repeat(17), asn: 'Y'.repeat(17) }))).toBe('edge:-:-');
  });
});
