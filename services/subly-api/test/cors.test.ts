// ─────────────────────────────────────────────────────────────────────────────
// subly-api CORS — an EXACT allowlist, FAIL CLOSED, plus one recorded localhost
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
import type { AppEnv } from '../src/types';

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

/** Mirrors the deployed `vars.ALLOWED_ORIGINS`. */
const SHIPPED = 'https://subly.nikatru.com,https://subly-9cp.pages.dev';

describe('subly-api CORS — exact allowlist', () => {
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
      'https://nikatru.com',
      'https://subly.nikatru.com.evil.test', // suffix-of-hostname attack
      'http://subly.nikatru.com', // plaintext variant of an allowed origin
      'https://subly.nikatru.com/', // trailing slash is a different origin
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
    const res = await appWith('')('GET', 'https://subly.nikatru.com');
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
  // Documented in Private/company/requirements/master-requirements.md and as INC13.
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

describe('preflight covers every method the routes actually expose', () => {
  it('includes PUT — `PUT /v1/budget` is live and was preflight-blocked without it', async () => {
    const res = await appWith(SHIPPED)('OPTIONS', 'https://subly.nikatru.com');
    const methods = res.headers.get('Access-Control-Allow-Methods') ?? '';
    for (const m of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
      expect(methods, `missing ${m}`).toContain(m);
    }
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
