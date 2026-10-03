import { describe, it, expect } from 'vitest';
import { memoryKv } from '../src/ports/fakes/kv';
import { KV_SCENARIOS, runKvConformance } from './conformance/kv';

// ─────────────────────────────────────────────────────────────────────────────
// ports-kv.test.ts — tooling/ports/kv.json adapter `memory`: the fake passes the
// KV conformance suite. The binding's own run is PENDING in the registry (no
// Worker suite runs on workerd); this file is what makes the suite real.
// ─────────────────────────────────────────────────────────────────────────────

describe('kv port — the memory fake passes the conformance suite', () => {
  runKvConformance(
    {
      adapter: 'memory',
      make: () => {
        let t = 1_700_000_000_000;
        return { store: memoryKv({ now: () => t }), advance: (ms: number) => void (t += ms) };
      },
    },
    it,
  );
});

describe('kv conformance — the runner can fail', () => {
  const collect = () => {
    const cases = new Map<string, () => Promise<void>>();
    return { cases, it: (name: string, run: () => Promise<void>) => void cases.set(name, run) };
  };

  it('registers every scenario', () => {
    const c = collect();
    runKvConformance({ adapter: 'x', make: () => ({ store: memoryKv() }) }, c.it);
    expect(c.cases.size).toBe(KV_SCENARIOS.length);
  });

  it('🔴 an adapter with no clock FAILS the TTL scenario — a missing fixture is never a skip', async () => {
    const c = collect();
    runKvConformance({ adapter: 'no-clock', make: () => ({ store: memoryKv() }) }, c.it);
    await expect(c.cases.get('no-clock · kv · ttl-expires')!()).rejects.toThrow(/no fixture for scenario `ttl-expires`/);
  });

  it('🔴 a store that throws on a missing key fails `missing-is-null`', async () => {
    const c = collect();
    const store = memoryKv();
    const throwing = { ...store, get: async () => { throw new Error('KV GET failed: 404'); } };
    runKvConformance({ adapter: 'throws', make: () => ({ store: throwing as typeof store }) }, c.it);
    await expect(c.cases.get('throws · kv · missing-is-null')!()).rejects.toThrow(/404/);
  });

  it('🔴 a store that ignores the TTL fails `ttl-expires`', async () => {
    const c = collect();
    let t = 0;
    const store = memoryKv({ now: () => t });
    const ignoresTtl = { ...store, put: (k: string, v: string) => store.put(k, v) };
    runKvConformance({ adapter: 'no-ttl', make: () => ({ store: ignoresTtl as typeof store, advance: (ms: number) => void (t += ms) }) }, c.it);
    await expect(c.cases.get('no-ttl · kv · ttl-expires')!()).rejects.toThrow(/a key past its TTL/);
  });
});
