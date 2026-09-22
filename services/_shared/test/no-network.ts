// ─────────────────────────────────────────────────────────────────────────────
// no-network.ts — A UNIT TEST CANNOT REACH THE NETWORK. Every Worker's
// vitest.config.ts lists this file in `test.setupFiles`, so it runs before each
// test file is imported, in both lanes and in every Worker stamped from the brick.
//
// 🔴 THE DEFECT THIS EXISTS FOR (O-WORKER-TEST-REACHES-LIVE-HOSTS). ⏱ 2026-09-22.
// services/platform/test/cancellation-drain.test.ts ran the REAL `scheduled`
// handler with an env that set no BOXB_REACH_URLS, so `boxbTargets` fell back to
// the three live Box B hosts and `probeReachability` GET each of them, 10 s
// timeout apiece, inside a test whose limit is 5 s. PR #870 touched no
// services/ file and its CI went red twice on that test alone — "Error: Test
// timed out in 5000ms." (runs 35718264734 and 35719553813). The test was green
// only while Box B answered fast; the network was an unstated input.
//
// WHAT THIS DOES. Global `fetch` is replaced by one that REJECTS at once, with an
// error naming the method and URL. A test that needs HTTP installs its own stub
// OVER this one (`vi.stubGlobal('fetch', …)` or `globalThis.fetch = …`), and
// restoring that stub (`vi.unstubAllGlobals()`, or `globalThis.fetch = realFetch`
// where `realFetch` was captured at module load) puts THIS one back, because it
// was installed before the test module ran. So a stub is never installed under
// the guard, and a restored stub never restores the real network.
//
// ⚠️ REJECTING IS NOT ENOUGH ON ITS OWN, and the case that proves it is the one
// above: `probeReachability` CATCHES a transport error and records it as an ok=0
// row, so a refused request would have turned into a quiet row that no
// assertion in that test read. So every refusal is also RECORDED, and the
// `afterEach` below fails the test that made it, naming every URL. A live call
// anywhere under test — swallowed or not — is a red test in well under a second,
// never a timeout and never a silent pass.
//
// The rejection is a TypeError, the shape a real transport failure takes
// (`TypeError: fetch failed`), so code under test takes the same path it would
// take in an outage; the afterEach is what makes it loud.
//
// SCOPE: `fetch` is the Workers runtime's only outbound HTTP API, and the
// Workers' tsconfig types (`@cloudflare/workers-types`) keep `node:http`/`https`
// out of their sources. jose's node build (which fetches a JWKS over node:https)
// is kept out by the `workerd` resolve conditions in each vitest.config.ts.
//
// ⚠️ NO IMPORT BUT `vitest`, on purpose — the shared home has no node_modules
// (shared-home.test.ts), and `vitest` is the one specifier every file under
// services/_shared/test already resolves through the running vitest.
// ─────────────────────────────────────────────────────────────────────────────
import { afterEach } from 'vitest';

/** Every request refused since the last test ended, as `METHOD URL`. */
const refused: string[] = [];

function describeRequest(input: unknown, init?: { method?: string }): string {
  if (typeof Request !== 'undefined' && input instanceof Request) {
    return `${(init?.method ?? input.method).toUpperCase()} ${input.url}`;
  }
  return `${(init?.method ?? 'GET').toUpperCase()} ${String(input)}`;
}

function noNetwork(input: unknown, init?: { method?: string }): Promise<Response> {
  const what = describeRequest(input, init);
  refused.push(what);
  return Promise.reject(
    new TypeError(
      `NO NETWORK IN UNIT TESTS: ${what} was not stubbed by this test. Point the code under test at a ` +
        'stub origin (an env var, or an injected fetch) and stub that origin (services/_shared/test/no-network.ts).',
    ),
  );
}

globalThis.fetch = noNetwork as unknown as typeof fetch;

afterEach(() => {
  if (refused.length === 0) return;
  const seen = refused.splice(0, refused.length);
  throw new Error(
    `NO NETWORK IN UNIT TESTS: this test reached for the network ${seen.length} time(s) and was refused: ` +
      `${seen.join(', ')}. It fails here even when the code under test caught the error.`,
  );
});
