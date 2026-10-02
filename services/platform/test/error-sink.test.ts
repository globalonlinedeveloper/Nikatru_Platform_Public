import { describe, it, expect, vi, afterEach } from 'vitest';
import app from '../src/index';
import { buildEnvelope, reportablePath } from '../src/lib/error-sink';
import { realPlatformDb } from './harness';
import { sha256Hex } from '../src/middleware/ext-device-auth';
import { mintToken } from '../src/lib/reminders';

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
  appId: 'subscriptiontracker',
  requestId: 'rid-1',
  method: 'POST',
  path: '/v1/events',
};

afterEach(() => {
  vi.unstubAllGlobals();
});

// ⏱ 2026-10-01 · services-033: the sink MODULE's cases (the DSN parse, the
// envelope and its app/release tags, the privacy invariants, fail-open) moved to
// services/_shared/test/error-sink.test.ts, beside the one home, where every
// Worker — the brick's stamped one included — runs them. What is left here is
// this Worker's WIRING: its onError, its routes' attribution, its calendar path.
describe('the REAL onError passes the pathname only', () => {
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
        body: JSON.stringify({ app_id: 'subscriptiontracker', events: [{ event_id: 'e1', event: 'app_open', anon_id: 'a1' }] }),
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
          app_id: 'subscriptiontracker',
          events: [{ event_id: 'e1', event: 'app_open', anon_id: 'a1' }],
        }),
      }),
      throwingEnv,
      ctx,
    );
    expect(res.status).toBe(500);
    expect(sent).toHaveLength(1);
    const event = JSON.parse(sent[0].split('\n')[2]);
    expect(event.tags.app_id).toBe('subscriptiontracker');
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
          app_id: 'subscriptiontracker',
          events: [{ event_id: 'e1', event: 'app_open', anon_id: 'a1' }],
        }),
      }),
      throwingEnv,
      ctx,
    );
    spy.mockRestore();
    const unhandled = lines.find((l) => l.includes('[unhandled]'));
    expect(unhandled).toBeDefined();
    expect(unhandled).toContain('app=subscriptiontracker');
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
          app_id: 'subscriptiontracker',
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
    expect(consent).toContain('app=subscriptiontracker');
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
          app_id: 'subscriptiontracker',
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
    expect(ingest).toContain('app=subscriptiontracker');
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

// ─────────────────────────────────────────────────────────────────────────────
// ⏱ 2026-09-30 · O-CALENDAR-TOKEN-SHIPPED-TO-ERROR-SINK (rv2-services-002).
//
// 🔴 THE PRIVACY RULE ABOVE ASSUMED A SECRET COULD ONLY LIVE IN THE QUERY
// STRING. The calendar feed's 256-bit capability token is a PATH segment
// (`/v1/calendar/<token>.ics`), and onError reported the concrete pathname, so
// any unhandled error on that route sent the live token to GlitchTip — where
// anyone who could read the issue could fetch that person's subscriptions.
//
// RED ON MAIN, GREEN AFTER: driven through the REAL app, with a real feed row and
// no subscriptiontracker_db bound — the route's own configuration-fault throw
// (routes/calendar.ts, "no database binding for app") reaches the real onError.
// On the tree before this change the captured envelope contains the token.
// ─────────────────────────────────────────────────────────────────────────────
describe('a path-segment capability never reaches the sink', () => {
  // Minted by the route's own minter, so it is exactly the shape a live feed carries.
  const TOKEN = mintToken();

  it('🔴 an error on GET /v1/calendar/<token>.ics reports the ROUTE PATTERN, and the token appears nowhere in the envelope', async () => {
    expect(TOKEN).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const platform = realPlatformDb();
    platform.db
      .prepare('INSERT INTO reminder_feed (user_id, app_id, token_hash, created_at, revoked_at) VALUES (?, ?, ?, ?, NULL)')
      .run('u-sink', 'subscriptiontracker', await sha256Hex(TOKEN), '2026-09-30T00:00:00Z');
    const sent: string[] = [];
    vi.stubGlobal('fetch', async (_u: string, init: RequestInit) => {
      sent.push(String(init.body));
      return new Response('', { status: 200 });
    });
    const res = await app.fetch(
      new Request(`https://platform.example.test/v1/calendar/${TOKEN}.ics?download=1`),
      // PLATFORM_DB bound, so the token is found; SUBSCRIPTIONTRACKER_DB not, so
      // the route throws AFTER the token check — the case the finding names.
      { GLITCHTIP_DSN: DSN, RELEASE: 'sha123', PLATFORM_DB: platform } as never,
      { waitUntil: (p: Promise<unknown>) => void p, passThroughOnException: () => {} } as never,
    );
    expect(res.status).toBe(500);
    expect(sent).toHaveLength(1);
    expect(sent[0]).not.toContain(TOKEN);
    expect(sent[0]).not.toContain(TOKEN.slice(0, 16));
    const event = JSON.parse(sent[0].split('\n')[2]);
    expect(event.transaction).toBe('GET /v1/calendar/:file');
  });

  it('with no matched handler, a capability-shaped segment is scrubbed from the concrete path', () => {
    expect(reportablePath(`/v1/calendar/${TOKEN}.ics`)).toBe('/v1/calendar/:redacted');
    expect(reportablePath('/v1/events')).toBe('/v1/events');
    // Middleware (`ALL`) and wildcard routes name no handler: fall back to the scrub.
    expect(reportablePath(`/v1/calendar/${TOKEN}.ics`, [{ method: 'ALL', path: '*' }])).toBe('/v1/calendar/:redacted');
    expect(
      reportablePath(`/v1/calendar/${TOKEN}.ics`, [
        { method: 'ALL', path: '*' },
        { method: 'GET', path: '/v1/calendar/:file' },
      ]),
    ).toBe('/v1/calendar/:file');
  });

  it('the envelope scrubs a concrete token path whatever the caller passed', () => {
    const envelope = buildEnvelope(new Error('x'), { ...CTX, method: 'GET', path: `/v1/calendar/${TOKEN}.ics` }, DSN, NOW);
    expect(envelope).not.toContain(TOKEN);
    expect(JSON.parse(envelope.split('\n')[2]).transaction).toBe('GET /v1/calendar/:redacted');
  });
});
