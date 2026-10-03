import { defineConfig } from 'vitest/config';

// ─────────────────────────────────────────────────────────────────────────────
// 🔴 RESOLVE THE BUILD THAT ACTUALLY SHIPS, NOT THE ONE NODE PREFERS.
//
// `jose` publishes three builds behind export conditions. Under Vitest's default
// resolution it hands back the NODE build, whose `createRemoteJWKSet` fetches
// the JWKS with `node:https` — while the deployed Worker gets the `workerd`
// build, which uses `fetch`. Same package, same version, DIFFERENT TRANSPORT.
//
// That difference is not cosmetic; it decides what can be tested at all:
//
//   · a test that stubs `fetch` cannot serve the JWKS to the node build, so the
//     ES256 path fails for a reason that exists only in the test environment;
//   · `services/subscriptiontracker-api/test/auth.test.ts` works around exactly this by
//     DISABLING the network and asserting the HS256 fallback instead — so that
//     suite's "auth works" is a statement about the path this Worker
//     deliberately does not have (see src/middleware/auth.ts);
//   · and services/platform has NO fallback, so without this config its only
//     verification path would be permanently unexercised while the suite still
//     went green on the 401s.
//
// Pinning the conditions makes test/auth.test.ts verify a REAL ES256 signature
// against a REAL JWKS document through the SAME code the edge runs. It changes
// module resolution only — the tests still execute on Node, and the real-SQL
// harness (`process.getBuiltinModule('node:sqlite')`, `?raw` migration imports)
// is untouched.
//
// ⚠️ `workerd` FIRST, then `browser`: they are separate conditions in jose's
// export map and only the first is what Cloudflare's bundler selects. Listing
// `browser` alone would test a third build nobody deploys.
//
// 🔴 BOTH BLOCKS ARE REQUIRED, and `ssr.resolve.conditions` is the one that does
// the work under Vite 6+. Vitest executes test modules through Vite's SSR
// pipeline, and from Vite 6 that pipeline stopped reading `resolve.conditions`
// — it reads `ssr.resolve.conditions`, which defaults to the NODE conditions.
// So on the vite 5 -> 7 bump (2026-08-10, the undici/vite/esbuild Dependabot
// sweep) this file kept its `resolve` block, kept looking correct, and silently
// went back to resolving jose's node build: 44 of platform's 326 tests turned
// red with a blanket 401, because `createRemoteJWKSet` was fetching the JWKS
// over `node:https` again and the stubbed `fetch` could not serve it.
//
// That is the negative test for the block below — deleting `ssr` reproduces the
// 44 failures on vite 7. `resolve` is kept for the client-side/optimizer path
// and so a downgrade to vite 5 is not silently unprotected.
//
// ⏱ 2026-09-27 · jose 6 (O-RENOVATE-BACKLOG-OUTRUNS-ITS-LIMITS, M2): jose now
// publishes ONE build — its export map is `types` + `default` → dist/webapi,
// which fetches the JWKS with `fetch` in every runtime — so the conditions
// below no longer choose jose's transport, and the negative test above no
// longer reproduces: with both blocks deleted, test/auth.test.ts ran 65/65
// green on jose 6.2.12. The ES256 path is now the edge's code by construction.
// The blocks stay: harmless, and the protection returns if jose is pinned back
// to 5.
// ─────────────────────────────────────────────────────────────────────────────
// ⏱ 2026-09-22 · O-WORKER-TEST-REACHES-LIVE-HOSTS: `setupFiles` makes the
// network unreachable from every test file here — global `fetch` REJECTS any
// request the test did not stub, and the test that made it fails naming the
// URL. The cancellation-drain handler test had been probing the three live Box B
// hosts and timing out CI on PRs that touched no services/ file. See
// ../_shared/test/no-network.ts.
// ─────────────────────────────────────────────────────────────────────────────
// ⏱ 2026-10-01 · time travel: the second setup file moves `Date` to the instant
// in NIKATRU_TEST_NOW and does nothing when it is unset, so the weekly
// .github/workflows/time-travel.yml can run this suite ~400 days ahead and at
// the year boundary, and a date fuse (#1101: fx.test.ts, red on every PR at
// 2026-10-01 00:00Z) fires there first. See ../_shared/test/test-clock.ts.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts", "../_shared/test/**/*.test.ts"],
    setupFiles: ["../_shared/test/no-network.ts", "../_shared/test/test-clock.ts"],
  },
  resolve: {
    conditions: ['workerd', 'browser', 'import', 'default'],
  },
  ssr: {
    resolve: {
      conditions: ['workerd', 'browser', 'import', 'default'],
    },
  },
});
