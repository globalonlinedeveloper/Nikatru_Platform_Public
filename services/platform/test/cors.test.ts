import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { corsMiddleware } from '../src/middleware/cors';
import type { AppEnv } from '../src/types';

/** A minimal app wired exactly like index.ts, with a settable ALLOWED_ORIGINS. */
function appWith(allowedOrigins: string) {
  const app = new Hono<AppEnv>();
  app.use('*', corsMiddleware);
  app.get('/x', (c) => c.json({ ok: true }));
  app.delete('/x', (c) => c.json({ ok: true }));
  return (method: string, origin?: string) =>
    app.request(
      '/x',
      { method, headers: origin === undefined ? {} : { Origin: origin } },
      { ALLOWED_ORIGINS: allowedOrigins } as AppEnv['Bindings'],
    );
}

/** Mirrors the deployed `vars.ALLOWED_ORIGINS`. These tests cover the middleware
 *  BEHAVIOUR; that the shipped config still contains every origin in use is
 *  asserted separately by `tooling/ci/assert-cors-allowlist.mjs`, because
 *  reading wrangler.jsonc needs node APIs this Worker's tsconfig deliberately
 *  does not expose. */
const SHIPPED =
  'https://subly.nikatru.com,https://subly-9cp.pages.dev,http://localhost:3000';

describe('platform CORS (shared Worker — ADR 020, exact allowlist)', () => {
  it('allows the write methods the shared endpoints need', async () => {
    // Regression guard: while this was a config-read-only host the list was
    // `GET, OPTIONS`, which preflight-blocks DELETE /v1/account from every web
    // build — a failure that presents as a browser bug, not a config bug.
    const res = await appWith(SHIPPED)('OPTIONS', 'https://subly.nikatru.com');
    expect(res.status).toBe(204);
    const methods = res.headers.get('Access-Control-Allow-Methods') ?? '';
    for (const m of ['GET', 'POST', 'DELETE', 'OPTIONS']) {
      expect(methods, `missing ${m}`).toContain(m);
    }
    expect(res.headers.get('Access-Control-Allow-Headers')).toContain('Authorization');
  });

  it('reflects an origin that is on the list, exactly', async () => {
    const call = appWith(SHIPPED);
    for (const origin of SHIPPED.split(',')) {
      const res = await call('GET', origin);
      expect(res.headers.get('Access-Control-Allow-Origin'), origin).toBe(origin);
      expect(res.headers.get('Vary')).toBe('Origin');
    }
  });

  it('refuses everything not on the list — no pattern matching at all', async () => {
    const call = appWith(SHIPPED);
    for (const origin of [
      'https://other.nikatru.com', // a SIBLING portfolio origin is not implied
      'https://nikatru.com',
      'https://nikatru.com.evil.test', // suffix-of-hostname attack
      'https://evilnikatru.com',
      'http://subly.nikatru.com', // plaintext variant of an allowed origin
      'https://subly.nikatru.com/', // trailing slash is a different origin
      'https://example.com',
      'not-a-url',
    ]) {
      const res = await call('GET', origin);
      expect(res.headers.get('Access-Control-Allow-Origin'), origin).toBeNull();
    }
  });

  it('an EMPTY allowlist denies every browser origin — it is NOT a wildcard', async () => {
    // The semantics changed on 2026-07-25: empty used to mean '*'. Clearing the
    // var now takes every web build offline for config + analytics, so this must
    // fail loudly in a test rather than quietly in production.
    const call = appWith('');
    expect(
      (await call('GET', 'https://subly.nikatru.com')).headers.get(
        'Access-Control-Allow-Origin',
      ),
    ).toBeNull();
  });

  it('tolerates whitespace and empty entries in the var', async () => {
    const call = appWith(' https://a.test , ,https://b.test ');
    expect((await call('GET', 'https://a.test')).headers.get('Access-Control-Allow-Origin')).toBe(
      'https://a.test',
    );
    expect((await call('GET', 'https://b.test')).headers.get('Access-Control-Allow-Origin')).toBe(
      'https://b.test',
    );
  });

  it('a non-browser caller (no Origin header) is unaffected', async () => {
    // CORS is a browser mechanism; these callers were never gated by it.
    const res = await appWith(SHIPPED)('GET');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(res.status).toBe(200);
  });

});
