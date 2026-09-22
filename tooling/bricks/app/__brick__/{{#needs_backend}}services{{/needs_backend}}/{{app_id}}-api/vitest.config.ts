import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// ⏱ 2026-09-15 · [ADR 081]: `cloudflare:workers` is a workerd built-in that
// src/erasure-entrypoint.ts imports; under Node tests it resolves to a stub that
// stores `ctx` and `env` as the runtime base class does.
const WORKERS_STUB = fileURLToPath(new URL('./test/stubs/cloudflare-workers.ts', import.meta.url));

// ─────────────────────────────────────────────────────────────────────────────
// 🔴 RESOLVE THE BUILD THAT ACTUALLY SHIPS, NOT THE ONE NODE PREFERS.
//
// `jose` publishes three builds behind export conditions. Under Vitest's default
// resolution it hands back the NODE build, whose `createRemoteJWKSet` fetches the
// JWKS with `node:https` — while the deployed Worker gets the `workerd` build,
// which uses `fetch`. Same package, same version, DIFFERENT TRANSPORT.
//
// What that cost the Worker this template was extracted from: a test that stubs
// `fetch` could not serve a JWKS document to the node build, so the ES256 path
// could not be exercised at all, and its auth suite asserted the HS256 fallback
// instead. That is tolerable only until a route appears whose whole security
// argument is that it verifies asymmetrically — `DELETE /v1/account` is exactly
// that route, and this Worker ships it on day one.
//
// So the conditions below are not a preference. They make the test run the code
// the edge runs. Do not "simplify" them away: the failure they prevent is a green
// suite over a transport production never uses.
//
// ── WHY `../_shared/test` IS IN `include` ────────────────────────────────────
// ⏱ 2026-09-12. `services/_shared/` holds the modules every Worker re-exports —
// the auth core, the health machinery, the D1 transient retry, the erasure
// derivation — and its tests live beside it. A Worker that ran only its OWN tests
// would ship those modules untested in its own resolution, which is the case this
// line closes: a stamped Worker runs the chassis's suite from the first `npm
// test`, before it has a single test of its own.
//
// This file, and the `test` script beside it in package.json, were ABSENT from
// this template until 2026-09-12 — a stamped backend shipped with no way to run a
// test at all. Found by the factory-vs-app drift audit,
// research/factory-drift-2026-09-12/.
//
// ── WHY `setupFiles` NAMES `../_shared/test/no-network.ts` ───────────────────
// ⏱ 2026-09-22 · O-WORKER-TEST-REACHES-LIVE-HOSTS. Global `fetch` REJECTS any
// request the test did not stub, and the test that made it fails naming the
// URL — so a unit test cannot quietly depend on a live host and time out CI
// when that host is slow, which services/platform's handler test did.
// ─────────────────────────────────────────────────────────────────────────────
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts', '../_shared/test/**/*.test.ts'],
    setupFiles: ['../_shared/test/no-network.ts'],
  },
  resolve: {
    conditions: ['workerd', 'browser', 'import', 'default'],
    alias: { 'cloudflare:workers': WORKERS_STUB },
  },
  ssr: {
    resolve: {
      conditions: ['workerd', 'browser', 'import', 'default'],
    },
  },
});
