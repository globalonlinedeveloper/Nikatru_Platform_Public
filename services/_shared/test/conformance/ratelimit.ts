// ─────────────────────────────────────────────────────────────────────────────
// conformance/ratelimit.ts — WHAT ANY `RateLimiter` MUST DO. tooling/ports/
// ratelimit.json names this file as its suite and `runRateLimitConformance` as
// the runner. Against the memory fake it runs in every Worker's `npm test`
// (services/_shared/test/ports-ratelimit.test.ts); against the binding it is
// PENDING — no Worker suite runs on workerd, and the binding is per-colo and
// eventually consistent, so an over-budget answer there is not deterministic.
//
// The one property every caller relies on: a limiter OVER BUDGET answers
// `success: false`. Within budget it answers true, and keys are counted apart
// (the edge ceiling's `edge:<colo>:<asn>` buckets must not share a budget).
// ─────────────────────────────────────────────────────────────────────────────
import type { RateLimiter } from '../../src/ports/ratelimit';
import { missingFixture, same, type Register } from './check';

export interface RateLimitSubject {
  limiter: RateLimiter;
  /** Advance the limiter's clock by `ms`. Without it the window scenario FAILS. */
  advance?: (ms: number) => void;
  /** The period the limiter was made with, in seconds. */
  periodSeconds: number;
}

export interface RateLimitFixture {
  /** The registry's adapter id. */
  adapter: string;
  /** A fresh limiter admitting `budget` requests per key per period. */
  make(budget: number): RateLimitSubject | Promise<RateLimitSubject>;
}

interface Scenario {
  name: string;
  run(fixture: RateLimitFixture): Promise<void>;
}

const answers = async (limiter: RateLimiter, key: string, n: number): Promise<boolean[]> => {
  const out: boolean[] = [];
  for (let i = 0; i < n; i++) out.push((await limiter.limit({ key })).success);
  return out;
};

export const RATELIMIT_SCENARIOS: readonly Scenario[] = [
  {
    name: 'within-budget-succeeds',
    async run(f) {
      const { limiter } = await f.make(3);
      same(await answers(limiter, 'edge:SIN:13335', 3), [true, true, true], 'three requests on a budget of three');
    },
  },
  {
    name: 'over-budget-fails',
    async run(f) {
      const { limiter } = await f.make(2);
      same(await answers(limiter, 'global:auth-credential', 4), [true, true, false, false], 'the third and fourth on a budget of two');
    },
  },
  {
    name: 'zero-budget-refuses-the-first',
    async run(f) {
      const { limiter } = await f.make(0);
      same(await answers(limiter, 'k', 1), [false], 'a budget of zero');
    },
  },
  {
    name: 'keys-are-counted-apart',
    async run(f) {
      const { limiter } = await f.make(1);
      same(await answers(limiter, 'edge:SIN:1', 2), [true, false], 'key one, over budget');
      same(await answers(limiter, 'edge:BOM:2', 1), [true], 'key two keeps its own budget');
    },
  },
  {
    name: 'the-window-rolls',
    async run(f) {
      const { limiter, advance, periodSeconds } = await f.make(1);
      if (!advance) throw missingFixture('ratelimit', f.adapter, 'the-window-rolls', 'advance');
      same(await answers(limiter, 'k', 2), [true, false], 'inside one period');
      advance(periodSeconds * 1000);
      same(await answers(limiter, 'k', 1), [true], 'the next period');
    },
  },
];

/** Register every scenario for `fixture` with `it`. A scenario the fixture cannot serve FAILS. */
export function runRateLimitConformance(fixture: RateLimitFixture, it: Register): void {
  for (const sc of RATELIMIT_SCENARIOS) {
    it(`${fixture.adapter} · ratelimit · ${sc.name}`, async () => sc.run(fixture));
  }
}
