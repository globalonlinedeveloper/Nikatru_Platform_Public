import { defineConfig } from 'vitest/config';

// The shield imports nothing from services/_shared (it has no Hono app, no D1 and
// no JWT to verify), so unlike the two app Workers it does not run the shared
// suite. It DOES take the shared no-network setup: global `fetch` rejects any
// request a test did not stub, so a test that forgets its stub fails naming the
// URL instead of reaching auth-api or glitchtip (O-WORKER-TEST-REACHES-LIVE-HOSTS).
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    setupFiles: ['../_shared/test/no-network.ts'],
  },
});
