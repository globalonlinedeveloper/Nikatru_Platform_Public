import { describe, it, expect } from 'vitest';
import { memoryObjects } from '../src/ports/fakes/objects';
import { OBJECTS_SCENARIOS, runObjectsConformance } from './conformance/objects';

// ─────────────────────────────────────────────────────────────────────────────
// ports-objects.test.ts — tooling/ports/objects.json adapter `memory`: the fake
// passes the object-store conformance suite. The bucket's own run is PENDING in
// the registry (no Worker suite runs on workerd).
// ─────────────────────────────────────────────────────────────────────────────

describe('objects port — the memory fake passes the conformance suite', () => {
  runObjectsConformance({ adapter: 'memory', make: () => memoryObjects() }, it);
});

describe('objects conformance — the runner can fail', () => {
  const collect = () => {
    const cases = new Map<string, () => Promise<void>>();
    return { cases, it: (name: string, run: () => Promise<void>) => void cases.set(name, run) };
  };

  it('registers every scenario', () => {
    const c = collect();
    runObjectsConformance({ adapter: 'x', make: () => memoryObjects() }, c.it);
    expect(c.cases.size).toBe(OBJECTS_SCENARIOS.length);
  });

  it('🔴 a store whose list never truncates fails `list-paginates`', async () => {
    const c = collect();
    const real = memoryObjects();
    const unpaged = { ...real, list: (o?: { prefix?: string }) => real.list({ prefix: o?.prefix }) };
    runObjectsConformance({ adapter: 'unpaged', make: () => unpaged }, c.it);
    await expect(c.cases.get('unpaged · objects · list-paginates')!()).rejects.toThrow(/five objects at two a page/);
  });

  it('🔴 a store that drops custom metadata fails `custom-metadata-round-trips`', async () => {
    const c = collect();
    const real = memoryObjects();
    const forgetful = { ...real, put: (k: string, v: string) => real.put(k, v) };
    runObjectsConformance({ adapter: 'forgetful', make: () => forgetful as typeof real }, c.it);
    await expect(c.cases.get('forgetful · objects · custom-metadata-round-trips')!()).rejects.toThrow(/custom metadata/);
  });
});
