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

describe('platform CORS (shared Worker — ADR 020)', () => {
  it('allows the write methods the shared endpoints need', async () => {
    // Regression guard: while this was a config-read-only host the list was
    // `GET, OPTIONS`, which preflight-blocks DELETE /v1/account from every web
    // build — a failure that presents as a browser bug, not a config bug.
    const res = await appWith('')('OPTIONS', 'https://subly.nikatru.com');
    expect(res.status).toBe(204);
    const methods = res.headers.get('Access-Control-Allow-Methods') ?? '';
    for (const m of ['GET', 'POST', 'DELETE', 'OPTIONS']) {
      expect(methods, `missing ${m}`).toContain(m);
    }
    expect(res.headers.get('Access-Control-Allow-Headers')).toContain('Authorization');
  });

  it('with no explicit allowlist, reflects any https *.nikatru.com origin', async () => {
    // A newly stamped app must work with NO platform redeploy.
    for (const origin of [
      'https://subly.nikatru.com',
      'https://brand-new-app.nikatru.com',
      'https://nikatru.com',
    ]) {
      const res = await appWith('')('GET', origin);
      expect(res.headers.get('Access-Control-Allow-Origin'), origin).toBe(origin);
      expect(res.headers.get('Vary')).toBe('Origin');
    }
  });

  it('refuses look-alike and insecure origins rather than reflecting them', async () => {
    for (const origin of [
      'https://nikatru.com.evil.test', // suffix-of-hostname attack
      'https://evilnikatru.com', // no dot before the suffix
      'http://subly.nikatru.com', // plaintext
      'https://example.com',
      'not-a-url',
    ]) {
      const res = await appWith('')('GET', origin);
      expect(res.headers.get('Access-Control-Allow-Origin'), origin).toBeNull();
    }
  });

  it('an explicit allowlist wins and is exact-match only', async () => {
    const call = appWith('https://subly.nikatru.com');
    expect(
      (await call('GET', 'https://subly.nikatru.com')).headers.get('Access-Control-Allow-Origin'),
    ).toBe('https://subly.nikatru.com');
    // In allowlist mode even a sibling portfolio origin is refused.
    expect(
      (await call('GET', 'https://other.nikatru.com')).headers.get('Access-Control-Allow-Origin'),
    ).toBeNull();
  });

  it('a non-browser caller (no Origin header) is unaffected', async () => {
    const res = await appWith('')('GET');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(res.status).toBe(200);
  });
});
