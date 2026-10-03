// fakes/ratelimit.ts — an in-memory `RateLimiter`: `budget` requests per key per
// `periodSeconds`, a fixed window. tooling/ports/ratelimit.json adapter `memory`;
// passes services/_shared/test/conformance/ratelimit.ts. Never selectable in live.
import type { RateLimiter } from '../ratelimit';

export interface MemoryRateLimiterOptions {
  /** Requests admitted per key per period. */
  budget: number;
  /** The window, in seconds (Workers Rate Limiting allows 10 or 60). */
  periodSeconds?: number;
  /** Milliseconds since the epoch; injectable so a test can roll the window. */
  now?: () => number;
}

export interface MemoryRateLimiter extends RateLimiter {
  /** Every key asked about, in order, for assertions. */
  readonly keys: readonly string[];
}

export function memoryRateLimiter(options: MemoryRateLimiterOptions): MemoryRateLimiter {
  const { budget } = options;
  if (!(Number.isInteger(budget) && budget >= 0)) throw new TypeError(`memoryRateLimiter: budget must be a non-negative integer, got ${budget}`);
  const periodMs = (options.periodSeconds ?? 60) * 1000;
  const now = options.now ?? (() => Date.now());
  const windows = new Map<string, { start: number; count: number }>();
  const keys: string[] = [];
  return {
    async limit({ key }: { key: string }): Promise<{ success: boolean }> {
      keys.push(key);
      const t = now();
      let w = windows.get(key);
      if (!w || t - w.start >= periodMs) {
        w = { start: t, count: 0 };
        windows.set(key, w);
      }
      w.count += 1;
      return { success: w.count <= budget };
    },
    get keys(): readonly string[] {
      return keys;
    },
  };
}
