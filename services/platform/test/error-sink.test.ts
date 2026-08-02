import { describe, it, expect, vi, afterEach } from 'vitest';
import app from '../src/index';
import { buildEnvelope, parseDsn, reportWorkerError } from '../src/lib/error-sink';
import { realPlatformDb } from './harness';

// ─────────────────────────────────────────────────────────────────────────────
// [pipeline 11]E-8 — a Worker's unhandled error is CAPTURED, not console-only.
//
// 🔴 THE STATE THIS REPLACED, measured at HEAD before this file existed:
// `app.onError` in both Workers logged and returned 500, and
// `grep -rn "sentry|glitchtip|toucan" services/` returned ZERO HITS. The only
// artefact of an unhandled error on the shared Worker — the one every stamped
// app posts analytics, consent, entitlement and merchant-of-record traffic to —
// was a 500 the client saw. `wrangler tail` is a live stream nobody watches at
// 3am and Cloudflare Free keeps no searchable history.
//
// TWO ASSERTIONS HERE FAILED ON THAT TREE BY CONSTRUCTION, which is what makes
// them worth writing rather than describing:
//   · the envelope names the WORKER it came from (`server_name` / the `service`
//     tag) — there was no envelope;
//   · its release is NOT the literal "v1". `API_VERSION` is "v1" in both
//     Workers and has never changed, so using it would group every error the
//     factory will ever report into one bucket named after a URL prefix. The
//     release is the deployed SHA until [9]R-2 lands a real release id.
//
// And the PRIVACY assertions are the reason this ships to the same GlitchTip
// instance as the app's crashes at all: the query string, the body and the
// headers must never appear in the payload. `?email=` is a URL.
// ─────────────────────────────────────────────────────────────────────────────

const DSN = 'https://abc123@glitchtip.example.test/7';
const NOW = new Date('2026-08-02T10:00:00.000Z');

const CTX = {
  service: 'platform',
  release: 'deadbeefcafe',
  // [pipeline B-16] REQUIRED on SinkContext rather than optional, and that is
  // deliberate: `service` answers "which Worker", and on the one host the whole
  // portfolio shares that is never the same question as "whose app". A field
  // typed `string | undefined` but still REQUIRED makes a new caller state an
  // answer — including "there wasn't one" — instead of inheriting silence.
  appId: 'subly',
  requestId: 'rid-1',
  method: 'POST',
  path: '/v1/events',
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the DSN is parsed, never spliced', () => {
  it('derives the envelope endpoint and the public key', () => {
    expect(parseDsn(DSN)).toEqual({
      endpoint: 'https://glitchtip.example.test/api/7/envelope/',
      publicKey: 'abc123',
    });
  });

  it.each([
    ['undefined', undefined],
    ['empty', ''],
    ['not a URL', 'nonsense'],
    ['no public key', 'https://glitchtip.example.test/7'],
    ['no project id', 'https://abc123@glitchtip.example.test'],
  ])('returns null for a %s DSN rather than POSTing somewhere unintended', (_label, dsn) => {
    expect(parseDsn(dsn as string | undefined)).toBeNull();
  });
});

describe('the envelope', () => {
  const parse = () => {
    const [header, itemHeader, item] = buildEnvelope(new TypeError('boom'), CTX, DSN, NOW).split('\n');
    return { header: JSON.parse(header), itemHeader: JSON.parse(itemHeader), event: JSON.parse(item) };
  };

  it('is three newline-delimited JSON objects, the Sentry envelope shape', () => {
    const { header, itemHeader, event } = parse();
    expect(header.dsn).toBe(DSN);
    expect(header.sent_at).toBe(NOW.toISOString());
    expect(itemHeader).toEqual({ type: 'event' });
    // The envelope header's id and the event's id must be the same event.
    expect(event.event_id).toBe(header.event_id);
    expect(event.event_id).toMatch(/^[0-9a-f]{32}$/);
  });

  it('NAMES THE WORKER it came from — in server_name and in the tags', () => {
    const { event } = parse();
    expect(event.server_name).toBe('platform');
    expect(event.tags.service).toBe('platform');
  });

  it('carries a release that is NOT the literal "v1"', () => {
    // The assertion that could not have passed on the tree this replaced, and
    // the one that stops `API_VERSION` being reached for as a release id.
    const { event } = parse();
    expect(event.release).toBe('deadbeefcafe');
    expect(event.release).not.toBe('v1');
  });

  it('carries the error type and message, and the correlation id', () => {
    const { event } = parse();
    expect(event.level).toBe('error');
    expect(event.exception.values[0].type).toBe('TypeError');
    expect(event.exception.values[0].value).toBe('boom');
    expect(event.tags.request_id).toBe('rid-1');
    expect(event.transaction).toBe('POST /v1/events');
  });

  it('turns a non-Error throw into a reportable exception', () => {
    const [, , item] = buildEnvelope('a bare string', CTX, DSN, NOW).split('\n');
    const event = JSON.parse(item);
    expect(event.exception.values[0].value).toBe('a bare string');
  });

  it('omits the request_id tag rather than inventing one', () => {
    const [, , item] = buildEnvelope(new Error('x'), { ...CTX, requestId: undefined }, DSN, NOW).split('\n');
    expect(JSON.parse(item).tags).not.toHaveProperty('request_id');
  });

  // ── [pipeline B-16] attribution ────────────────────────────────────────────
  it('tags the report with the APP, not only the Worker', () => {
    const [, , item] = buildEnvelope(new Error('x'), CTX, DSN, NOW).split('\n');
    const { tags } = JSON.parse(item);
    expect(tags.app_id).toBe('subly');
    // `service` still says which Worker. The two are different questions and
    // both must be answerable — this is the ONE Worker behind every app.
    expect(tags.service).toBe('platform');
  });

  it('OMITS the app_id tag when the request failed before naming an app', () => {
    // Malformed JSON, an over-cap body, a 404 on an unmounted path: all real,
    // all reach onError with no app resolved. A placeholder here would invent a
    // 51st app called "unknown" with its own error trend.
    const [, , item] = buildEnvelope(new Error('x'), { ...CTX, appId: undefined }, DSN, NOW).split('\n');
    expect(JSON.parse(item).tags).not.toHaveProperty('app_id');
  });

  it('carries a release that is NOT the API_VERSION constant', () => {
    // B-16's other half. "v1" would put every error this factory ever reports
    // into one bucket named after a URL prefix.
    const [, , item] = buildEnvelope(new Error('x'), CTX, DSN, NOW).split('\n');
    const event = JSON.parse(item);
    expect(event.release).toBe('deadbeefcafe');
    expect(event.release).not.toBe('v1');
  });
});

describe('the privacy invariants of the payload', () => {
  it('carries NO query string, NO body, NO headers and NO address', () => {
    // Fed a context whose path is a pathname, which is the only thing onError
    // hands it. The assertion is over the SERIALISED envelope, so a field added
    // anywhere in the payload has to pass it.
    const envelope = buildEnvelope(new Error('boom'), CTX, DSN, NOW);
    for (const forbidden of ['email=', 'token=', 'cf-connecting-ip', 'authorization', 'cookie']) {
      expect(envelope.toLowerCase()).not.toContain(forbidden);
    }
  });

  it('a path carrying a query string would be the caller\'s bug — onError passes pathname only', async () => {
    // Proven through the REAL handler rather than asserted about it: a request
    // to a route that throws, with a query string on it, must not produce an
    // envelope containing that query string.
    const sent: string[] = [];
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      sent.push(String(init.body));
      return new Response('', { status: 200 });
    });
    const res = await app.fetch(
      new Request('https://platform.example.test/v1/events?email=a@b.test', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // A REGISTERED app_id. `'demo'` was fine until [4]B-4a landed
        // (2026-08-03); the route now refuses an unregistered app with 404
        // before it ever touches PLATFORM_DB, so the fixture would have stopped
        // reaching `.prepare` — and this test needs a REAL unhandled throw to
        // reach the REAL onError. A 404 would have made it pass for the wrong
        // reason: no envelope is sent, so "the envelope has no query string" is
        // trivially true.
        body: JSON.stringify({ app_id: 'subly', events: [{ event_id: 'e1', event: 'app_open', anon_id: 'a1' }] }),
      }),
      // No PLATFORM_DB binding, so the handler throws on `.prepare` — a real
      // unhandled error reaching the real onError, not a stubbed one.
      { GLITCHTIP_DSN: DSN, RELEASE: 'sha123' } as never,
      { waitUntil: (p: Promise<unknown>) => void p, passThroughOnException: () => {} } as never,
    );
    expect(res.status).toBe(500);
    expect(sent).toHaveLength(1);
    expect(sent[0]).not.toContain('email=');
    expect(sent[0]).toContain('"server_name":"platform"');
    expect(sent[0]).toContain('"release":"sha123"');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// [pipeline B-16] ATTRIBUTION, THROUGH THE REAL APP.
//
// 🔴 THE PLAN'S RECORDED FAILING INPUT WAS THE TREE ITSELF: `app.onError` logged
// `[unhandled] rid=…` and reported `service: 'platform'`, and NOTHING on either
// path named the app. `service` is a compile-time constant — on the one Worker
// the whole portfolio shares it is the same string for all 50 apps, so a error
// report could be correlated to a request and never routed to a product.
//
// Driven through `app.fetch` rather than `buildEnvelope` on purpose: the unit
// tests above prove the envelope CAN carry an app id, and that is a different
// claim from the request path actually SETTING one. This repo has shipped four
// capabilities that worked in isolation and were never called.
// ─────────────────────────────────────────────────────────────────────────────
describe('[4]B-16 · the emitted report names the app AND the release', () => {
  const throwingEnv = { GLITCHTIP_DSN: DSN, RELEASE: 'sha123' } as never;
  const ctx = {
    waitUntil: (p: Promise<unknown>) => void p,
    passThroughOnException: () => {},
  } as never;

  it('an ingest failure is attributed to the app that caused it', async () => {
    const sent: string[] = [];
    vi.stubGlobal('fetch', async (_u: string, init: RequestInit) => {
      sent.push(String(init.body));
      return new Response('', { status: 200 });
    });
    // No PLATFORM_DB binding ⇒ the route throws on `.prepare`, exactly as a
    // real D1 outage would, and the throw escapes to the real onError.
    const res = await app.fetch(
      new Request('https://platform.example.test/v1/events', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          app_id: 'subly',
          events: [{ event_id: 'e1', event: 'app_open', anon_id: 'a1' }],
        }),
      }),
      throwingEnv,
      ctx,
    );
    expect(res.status).toBe(500);
    expect(sent).toHaveLength(1);
    const event = JSON.parse(sent[0].split('\n')[2]);
    expect(event.tags.app_id).toBe('subly');
    expect(event.release).toBe('sha123');
  });

  it('the log line carries app= and release=, not a bare request id', async () => {
    const lines: string[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => {
      lines.push(a.map(String).join(' '));
    });
    vi.stubGlobal('fetch', async () => new Response('', { status: 200 }));
    await app.fetch(
      new Request('https://platform.example.test/v1/events', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          app_id: 'subly',
          events: [{ event_id: 'e1', event: 'app_open', anon_id: 'a1' }],
        }),
      }),
      throwingEnv,
      ctx,
    );
    spy.mockRestore();
    const unhandled = lines.find((l) => l.includes('[unhandled]'));
    expect(unhandled).toBeDefined();
    expect(unhandled).toContain('app=subly');
    expect(unhandled).toContain('release=sha123');
  });

  it('a route that CATCHES its own failure still emits an attributed record', async () => {
    // ⚠️ THE CAUGHT PATHS ARE THE MAJORITY, AND THEY NEVER REACH `onError`.
    // `/v1/consent` catches its D1 failure and answers 503, so no envelope is
    // ever built for it — attribution there lives or dies on the route's OWN
    // log line. A version of B-16 that only checked `app.onError` would report
    // the requirement closed while every deliberately-handled failure on the
    // shared Worker stayed anonymous. This is the recorded failing input:
    // before 2026-08-03 the line read `[consent] rid=…` and nothing more.
    const lines: string[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => {
      lines.push(a.map(String).join(' '));
    });
    const res = await app.fetch(
      new Request('https://platform.example.test/v1/consent', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          consent_id: 'c1',
          app_id: 'subly',
          anon_id: 'a1',
          purpose: 'analytics',
          granted: true,
          policy_version: '2026-07-25',
        }),
      }),
      throwingEnv,
      ctx,
    );
    spy.mockRestore();
    // Caught, not unhandled: the client keeps its artifact and retries.
    expect(res.status).toBe(503);
    const consent = lines.find((l) => l.includes('[consent]'));
    expect(consent).toBeDefined();
    expect(consent).toContain('app=subly');
    expect(consent).toContain('release=sha123');
  });

  it('the INGEST route\'s caught path is attributed as well', async () => {
    // Same shape, the other write route — and it needs a DIFFERENT failure to
    // reach. `/v1/events` calls `.prepare()` OUTSIDE its try block, so an
    // unbound PLATFORM_DB throws past the route into `onError` (covered above)
    // and never exercises the route's own catch. The catch wraps `.batch()`,
    // so the failure has to be a write that fails after a successful prepare —
    // which is what the real-engine harness's `throwOnWrite` models, and what a
    // D1 outage mid-request actually looks like.
    const db = realPlatformDb();
    db.throwOnWrite = true;
    const lines: string[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => {
      lines.push(a.map(String).join(' '));
    });
    const res = await app.fetch(
      new Request('https://platform.example.test/v1/events', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          app_id: 'subly',
          events: [{ event_id: 'e1', event: 'app_open', anon_id: 'a1' }],
        }),
      }),
      { GLITCHTIP_DSN: DSN, RELEASE: 'sha123', PLATFORM_DB: db } as never,
      ctx,
    );
    spy.mockRestore();
    expect(res.status).toBe(503); // the client KEEPS the batch and retries
    const ingest = lines.find((l) => l.includes('[events]'));
    expect(ingest).toBeDefined();
    expect(ingest).toContain('app=subly');
    expect(ingest).toContain('release=sha123');
  });

  it('a request that names NO app is reported with no app_id, not a placeholder', async () => {
    // A body that is not JSON at all never reaches an app id. Asserted through
    // the real app so the "absent" case is a fact about the request path rather
    // than an inference from the envelope builder's signature.
    const sent: string[] = [];
    vi.stubGlobal('fetch', async (_u: string, init: RequestInit) => {
      sent.push(String(init.body));
      return new Response('', { status: 200 });
    });
    const res = await app.fetch(
      new Request('https://platform.example.test/v1/events', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: 'not json at all',
      }),
      throwingEnv,
      ctx,
    );
    // Malformed JSON is a clean 400 — the route refuses it, nothing throws, and
    // so nothing is reported. Asserted rather than assumed: a test that expected
    // an envelope here would be pinning a crash that should not happen.
    expect(res.status).toBe(400);
    expect(sent).toHaveLength(0);
  });
});

describe('the sink fails open', () => {
  it('sends nothing and reports false when no DSN is configured', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    expect(await reportWorkerError(new Error('x'), CTX, {}, NOW)).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('never rejects when GlitchTip is unreachable', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new Error('network down');
    });
    // A sink that can break the request path is worse than no sink.
    await expect(reportWorkerError(new Error('x'), CTX, { GLITCHTIP_DSN: DSN }, NOW)).resolves.toBe(false);
  });

  it('POSTs to the envelope endpoint with the Sentry auth header', async () => {
    const calls: Array<[string, RequestInit]> = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      calls.push([url, init]);
      return new Response('', { status: 200 });
    });
    expect(await reportWorkerError(new Error('x'), CTX, { GLITCHTIP_DSN: DSN }, NOW)).toBe(true);
    const [url, init] = calls[0];
    expect(url).toBe('https://glitchtip.example.test/api/7/envelope/');
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers['x-sentry-auth']).toContain('sentry_key=abc123');
    expect(headers['content-type']).toBe('application/x-sentry-envelope');
    // Cloudflare's edge rejects any client request carrying this header with
    // error 1000, before the origin is reached.
    expect(Object.keys(headers).map((h) => h.toLowerCase())).not.toContain('cf-connecting-ip');
  });
});
