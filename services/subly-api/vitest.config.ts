import { defineConfig } from 'vitest/config';

// ─────────────────────────────────────────────────────────────────────────────
// 🔴 RESOLVE THE BUILD THAT ACTUALLY SHIPS, NOT THE ONE NODE PREFERS.
//
// Ported from services/platform/vitest.config.ts, whose header names THIS Worker
// as the reason it was written. `jose` publishes three builds behind export
// conditions. Under Vitest's default resolution it hands back the NODE build,
// whose `createRemoteJWKSet` fetches the JWKS with `node:https` — while the
// deployed Worker gets the `workerd` build, which uses `fetch`. Same package,
// same version, DIFFERENT TRANSPORT.
//
// What that cost this Worker, precisely: a test that stubs `fetch` could not
// serve a JWKS document to the node build, so the ES256 path could not be
// exercised at all — and test/auth.test.ts says so out loud, disabling the
// network and asserting the HS256 FALLBACK instead. That was tolerable while the
// fallback was the only path an operator could configure. It stopped being
// tolerable the moment this Worker grew a route (DELETE /v1/account) whose whole
// security property is that it verifies ASYMMETRICALLY and refuses the fallback:
// without this file, the one path that route depends on would be the one path no
// test could reach, and the suite would still be green.
//
// It changes module resolution only. The tests still execute on Node, and the
// real-SQL harness (`process.getBuiltinModule('node:sqlite')`, `?raw` migration
// imports) is untouched — verified by running the whole pre-existing suite
// against this config before the erasure tests were written.
//
// ⚠️ `workerd` FIRST, then `browser`: they are separate conditions in jose's
// export map and only the first is what Cloudflare's bundler selects. Listing
// `browser` alone would test a third build nobody deploys.
// ─────────────────────────────────────────────────────────────────────────────
export default defineConfig({
  resolve: {
    conditions: ['workerd', 'browser', 'import', 'default'],
  },
});
