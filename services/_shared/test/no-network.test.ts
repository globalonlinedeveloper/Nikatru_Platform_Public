// ─────────────────────────────────────────────────────────────────────────────
// no-network.test.ts — THE GUARD IS WIRED INTO THE WORKER RUNNING THIS FILE.
//
// ⏱ 2026-09-22 · O-WORKER-TEST-REACHES-LIVE-HOSTS. no-network.ts does nothing
// unless the Worker's vitest.config.ts lists it in `test.setupFiles`, and a
// config that drops the line fails NO other test: every test that fetches stubs
// its own origins, so the suite stays green over a network that is open again.
// This file lives in services/_shared/test, which every Worker's `include`
// runs (and every Worker stamped from the brick), so a Worker whose config
// lost the line goes red HERE, by name.
//
// It reads the function's NAME rather than calling it: a call would be a
// refused request, and the guard's own afterEach would fail this test for it.
// Without the setup file, `globalThis.fetch` is Node's own, named `fetch`.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from 'vitest';

describe('no-network.ts is wired into this Worker', () => {
  it('global fetch is the refusing guard, not the real network', () => {
    expect(globalThis.fetch.name).toBe('noNetwork');
  });
});
