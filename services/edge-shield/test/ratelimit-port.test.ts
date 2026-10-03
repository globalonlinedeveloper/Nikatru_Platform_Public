import { describe, expect, it } from 'vitest';
import { memoryRateLimiter } from '../../_shared/src/ports/fakes/ratelimit';
import type { RateLimiter } from '../../_shared/src/ports/ratelimit';
import { admit } from '../src/limit';
import type { Env, RateLimiterBinding } from '../src/types';

// ─────────────────────────────────────────────────────────────────────────────
// ratelimit-port.test.ts — THE SHIELD'S LIMITERS ARE THE RATE-LIMITER PORT.
//
// ⏱ 2026-10-01 · O-CLOUDFLARE-BINDINGS-SCATTERED (port-storage). The shield's
// `RateLimiterBinding` (src/types.ts) stays declared in its own source ON
// PURPOSE: an import from services/_shared in src/ would make this Worker a kit
// CARRIER (services/_shared/test/carrier-parity.test.ts), and its own
// JWKS_TTL_SECONDS — the edge cache's 300 s bound (LEAD RULING SHIELD-R1 §5), not
// the kit's 600 s KV TTL — would then read as a copy of a kit export. So the
// proof that the two are ONE surface lives here, where tsc (`test/**/*.ts` is in
// this Worker's tsconfig) checks it in BOTH directions: the day either side
// grows a member the other lacks, `npm run typecheck` is red.
// ─────────────────────────────────────────────────────────────────────────────

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const sameSurface: Same<RateLimiterBinding, RateLimiter> = true;

describe("the shield's limiter is the rate-limiter port", () => {
  it('the two types are one surface (checked by tsc, both directions)', () => {
    expect(sameSurface).toBe(true);
  });

  it('a limiter over budget refuses the request — through the port fake', async () => {
    const limiter = memoryRateLimiter({ budget: 2 });
    const env: Env = { AUTH_PASSWORD_GLOBAL_LIMITER: limiter };
    // ⏱ 2026-10-03 · club rt-ports stack: `admit` takes the shield's release mark
    // since #1115's review (apply-platform); this test arrived beside it (port-storage).
    const mark = 'test-release';
    expect(await admit('auth-password', env, mark)).toBeNull();
    expect(await admit('auth-password', env, mark)).toBeNull();
    const refused = await admit('auth-password', env, mark);
    expect(refused?.status).toBe(429);
    expect(limiter.keys).toEqual(['global:auth-password', 'global:auth-password', 'global:auth-password']);
  });
});
