// ─────────────────────────────────────────────────────────────────────────────
// subscriptiontracker-api CORS — an EXACT allowlist, FAIL CLOSED, plus one recorded localhost
// exception.
//
// The defect these exist for: this middleware returned '*' on an empty
// ALLOWED_ORIGINS while the shared platform Worker fell CLOSED on the same
// input — one seam, three implementations, two opposite fail modes — and
// assert-cors-allowlist.mjs read only the platform config. Emptying THIS var
// produced byte-identical guard output and exit 0.
//
// The BEHAVIOUR is pinned here; that the DEPLOYED config still lists every
// origin in use is pinned in wrangler-config.test.ts and, across every Worker,
// by tooling/ci/assert-cors-allowlist.mjs.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { corsMiddleware, resolveOrigin, allowlist } from '../src/middleware/cors';
import { app } from '../src/index';
import type { AppEnv } from '../src/types';
import {
  mountedEndpoints,
  refusedPreflights,
  unansweredMethods,
  type RequestThroughApp,
} from '../../_shared/test/preflight';

/** An app wired exactly like index.ts, with a settable ALLOWED_ORIGINS. */
function appWith(allowedOrigins: string | undefined) {
  const app = new Hono<AppEnv>();
  app.use('*', corsMiddleware);
  app.get('/x', (c) => c.json({ ok: true }));
  app.put('/x', (c) => c.json({ ok: true }));
  return (method: string, origin?: string) =>
    app.request(
      '/x',
      { method, headers: origin === undefined ? {} : { Origin: origin } },
      { ALLOWED_ORIGINS: allowedOrigins } as AppEnv['Bindings'],
    );
}

/** Mirrors the deployed `vars.ALLOWED_ORIGINS`. Read 2026-09-09, after [ADR 075]
 *  moved the app to a PATH on the apex and the old subdomain was retired behind a
 *  301 -- so the live browser origin is the apex, and the subdomain is gone.
 *  Re-read 2026-09-11: the pre-rename Pages origin `subly-9cp.pages.dev` left too. */
const SHIPPED =
  'https://nikatru.com,https://subscriptiontracker-7qg.pages.dev';

describe('subscriptiontracker-api CORS — exact allowlist', () => {
  it('reflects an origin that is on the list, exactly', async () => {
    const call = appWith(SHIPPED);
    for (const origin of SHIPPED.split(',')) {
      const res = await call('GET', origin);
      expect(res.headers.get('Access-Control-Allow-Origin'), origin).toBe(origin);
    }
  });

  it('refuses everything not on the list — no pattern matching at all', async () => {
    const call = appWith(SHIPPED);
    for (const origin of [
      'https://other.nikatru.com', // a SIBLING portfolio origin is not implied
      // ⏱ The apex moved from this list to the allowed one on 2026-09-09: it is
      // now where the app is SERVED. The three attacks below moved with it, and
      // they matter more here than they did on a subdomain -- an origin that
      // merely LOOKS like the apex now looks like the whole portfolio.
      'https://nikatru.com.evil.test', // suffix-of-hostname attack
      'http://nikatru.com', // plaintext variant of an allowed origin
      'https://nikatru.com/', // trailing slash is a different origin
      'https://nikatru.com/subscriptiontracker', // an origin is not a URL: the PATH is not part of it
      'https://subly.nikatru.com', // the RETIRED subdomain is refused, not grandfathered
      'https://subly-9cp.pages.dev', // the RETIRED pre-rename Pages origin, likewise (2026-09-11)
      'https://evil.test',
      'not-a-url',
    ]) {
      const res = await call('GET', origin);
      expect(res.headers.get('Access-Control-Allow-Origin'), origin).toBeNull();
    }
  });

  it('an EMPTY allowlist DENIES — it is NOT a wildcard', async () => {
    // ⚠️ THE REGRESSION. Empty used to mean '*', which turned this
    // user-data API into an answer-every-origin API with CI fully green.
    for (const value of ['', '   ', ' , , ', undefined]) {
      const res = await appWith(value)('GET', 'https://evil.test');
      expect(
        res.headers.get('Access-Control-Allow-Origin'),
        `ALLOWED_ORIGINS=${JSON.stringify(value)} must not produce a wildcard`,
      ).toBeNull();
    }
  });

  it('an empty allowlist does not even reflect a LISTED-looking origin', async () => {
    // Probed with the origin that IS on the list when the list is not empty --
    // the apex since [ADR 075]. Probing a host that would be refused anyway
    // proves nothing about emptiness.
    const res = await appWith('')('GET', 'https://nikatru.com');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('tolerates whitespace and empty entries in the var', async () => {
    const call = appWith(' https://a.test , ,https://b.test ');
    for (const o of ['https://a.test', 'https://b.test']) {
      expect((await call('GET', o)).headers.get('Access-Control-Allow-Origin')).toBe(o);
    }
  });
});

describe('the localhost exception is a RECORDED per-app trade', () => {
  // `flutter drive -d web-server` serves on http://localhost:<random-port>, so
  // the CI integration_test harness cannot name its own origin in advance.
  // Documented in Private/requirements/ and as INC13 — the prose
  // `master-requirements.md` that used to be named here ("CORS scoped to the
  // app's origins + localhost") was folded into that JSON spec on 2026-08-16 in
  // commit e88fdcf, and its origins now read `[REQ]master-requirements §…`. The
  // localhost clause got no successor row of its own, so the sentence survives
  // only in the deleted page:
  // `git -C Private show e88fdcf^:requirements/master-requirements.md`.
  it('allows any localhost port, http or https, on top of the list', async () => {
    const call = appWith(SHIPPED);
    for (const o of [
      'http://localhost:3000',
      'http://localhost:59123',
      'https://localhost',
      'http://127.0.0.1:8080',
    ]) {
      expect((await call('GET', o)).headers.get('Access-Control-Allow-Origin'), o).toBe(o);
    }
  });

  it('the exception survives an empty list — it is not list-conditional', async () => {
    expect(
      (await appWith('')('GET', 'http://localhost:4000')).headers.get(
        'Access-Control-Allow-Origin',
      ),
    ).toBe('http://localhost:4000');
  });

  it('does NOT extend to lookalike hostnames', async () => {
    const call = appWith(SHIPPED);
    for (const o of [
      'http://localhost.evil.test',
      'http://notlocalhost',
      'http://127.0.0.1.evil.test',
      'http://localhost:3000/path',
    ]) {
      expect((await call('GET', o)).headers.get('Access-Control-Allow-Origin'), o).toBeNull();
    }
  });
});

describe('preflight covers every method the routes actually expose — derived, not listed', () => {
  // 🔴 ⏱ 2026-09-22. THIS WAS A HAND-TYPED LOOP over six methods, written after
  // `PUT /v1/budget` shipped preflight-blocked. It pinned the fix for that one
  // route and nothing else: the shared platform Worker carried the identical
  // defect for `PUT /v1/account/apple-token` behind an identical green loop. The
  // methods now come from the REAL app's route table (see
  // services/_shared/test/preflight.ts for that seam and why it was chosen), and each
  // mounted route is preflighted on its own path with its own method, through
  // the real middleware stack.
  const endpoints = mountedEndpoints(app.routes);
  const origin = 'https://nikatru.com';
  const env = { ALLOWED_ORIGINS: SHIPPED } as AppEnv['Bindings'];
  const through: RequestThroughApp = (path, init) => app.request(path, init, env);

  it('reads a real route table — including the route that was once refused', () => {
    // Not a tautology: an empty or middleware-only table would make the next
    // test pass vacuously, and a table missing these would mean the seam stopped
    // seeing the `api` sub-app merged in by `app.route('/v1', api)`.
    expect(endpoints).toContainEqual({ method: 'PUT', path: '/v1/budget' });
    expect(endpoints).toContainEqual({ method: 'PATCH', path: '/v1/subscriptions/:id' });
    expect(endpoints.length).toBeGreaterThan(5);
  });

  it('every mounted route is preflight-approved for its own method, from a listed origin', async () => {
    expect(await refusedPreflights(through, endpoints, origin)).toEqual([]);
  });

  it('offers no method that no mounted route answers', async () => {
    const res = await through('/v1/health', {
      method: 'OPTIONS',
      headers: { Origin: origin, 'Access-Control-Request-Method': 'GET' },
    });
    expect(unansweredMethods(res.headers.get('Access-Control-Allow-Methods'), endpoints)).toEqual([]);
    expect(res.headers.get('Access-Control-Allow-Headers')).toContain('Authorization');
  });

  it('a disallowed origin gets no preflight approval', async () => {
    const res = await appWith(SHIPPED)('OPTIONS', 'https://evil.test');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });
});

describe('the decision function, directly', () => {
  it('parses the var into exact origins', () => {
    expect(allowlist(' a , ,b ')).toEqual(['a', 'b']);
    expect(allowlist(undefined)).toEqual([]);
    expect(allowlist('')).toEqual([]);
  });

  it('never returns "*" for any input', () => {
    for (const origin of ['', 'https://evil.test', 'https://subly.nikatru.com', '*']) {
      for (const list of [[], ['https://subly.nikatru.com']]) {
        expect(resolveOrigin(origin, list), `${origin} / ${list.length}`).not.toBe('*');
      }
    }
  });

  it('a non-browser caller (no Origin header) still reaches the route', async () => {
    // CORS is a browser mechanism; these callers were never gated by it.
    const res = await appWith(SHIPPED)('GET');
    expect(res.status).toBe(200);
  });
});
