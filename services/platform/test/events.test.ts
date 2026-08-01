import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import events, {
  MAX_CONSENT_BODY_BYTES,
  MAX_EVENTS_BODY_BYTES,
  MAX_PARAM_COUNT,
} from '../src/routes/events';
import type { AppEnv } from '../src/types';
import { realPlatformDb, type RealDb } from './harness';

// ─────────────────────────────────────────────────────────────────────────────
// 🔴 `class FakeDb` USED TO LIVE HERE. It was deleted on 2026-08-01
// ([pipeline B-9]) and replaced by `realPlatformDb()` — node:sqlite with THE
// REAL platform_db migrations applied. See test/harness.ts for the full
// reasoning; the short version is that FakeDb answered `{ changes: 1 }` to every
// statement, so this file could assert what SQL the route CHOSE and could not
// assert a single thing about what LANDED. "Writes zero rows" was not merely
// unproven against it, it was unprovable: the strongest available statement was
// "the route did not call batch()", which is a different claim.
//
// Everything the old double recorded is still recorded — `db.sql`, `db.bound`,
// `db.batched` are unchanged — so every assertion below grades the same request,
// now executed against a real engine rather than swallowed by one.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A limiter stub that RECORDS every key it is asked about.
 *
 * The old stub was `{ limit: async () => ({ success: true }) }` — it ignored the
 * key entirely, so nothing in this file asserted what the breaker was keyed on.
 * That is why the route could key its only ceiling on `${app_id}:${anon_id}`,
 * both of which the (unauthenticated) caller picks, and stay green: mutating the
 * key to a fresh random uuid per request left the whole suite passing.
 */
class FakeLimiter {
  keys: string[] = [];
  constructor(private readonly allow: boolean = true) {}
  limit = async ({ key }: { key: string }) => {
    this.keys.push(key);
    return { success: this.allow };
  };
}

function harness(
  opts: {
    allowRate?: boolean;
    /** The SERVER-DERIVED half. Independent of `allowRate` on purpose. */
    allowCeiling?: boolean;
    db?: RealDb;
    /** Omit a binding entirely, to exercise the documented fail-OPEN. */
    omit?: Array<'EVENTS_LIMITER' | 'EVENTS_CEILING_LIMITER'>;
  } = {},
) {
  const db = opts.db ?? realPlatformDb();
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => {
    c.set('requestId', 'test-rid');
    await next();
  });
  app.route('/v1', events);
  const fairness = new FakeLimiter(opts.allowRate !== false);
  const ceiling = new FakeLimiter(opts.allowCeiling !== false);
  const omit = opts.omit ?? [];
  const env = {
    PLATFORM_DB: db,
    EVENTS_LIMITER: omit.includes('EVENTS_LIMITER') ? undefined : fairness,
    EVENTS_CEILING_LIMITER: omit.includes('EVENTS_CEILING_LIMITER') ? undefined : ceiling,
  } as unknown as AppEnv['Bindings'];

  const post = (path: string, body: unknown, cf?: Record<string, unknown>) => {
    const req = new Request(`https://platform.nikatru.com${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Deliberately present: the route must IGNORE it.
        'CF-Connecting-IP': '203.0.113.9',
      },
      body: JSON.stringify(body),
    });
    if (cf) Object.defineProperty(req, 'cf', { value: cf });
    return app.fetch(req, env);
  };

  /**
   * The same route, but the caller composes the raw Request. Needed because
   * `post()` always serialises an object — and the unbounded-body defect is
   * about BYTES ON THE WIRE, including a lying Content-Length and a body that
   * arrives as a stream, neither of which a JSON helper can express.
   */
  const postRaw = (path: string, init: RequestInit) =>
    app.fetch(new Request(`https://platform.nikatru.com${path}`, { method: 'POST', ...init }), env);

  return { db, post, postRaw, fairness, ceiling };
}

const ev = (over: Record<string, unknown> = {}) => ({
  event_id: '11111111-1111-4111-8111-111111111111',
  anon_id: 'install-1',
  event: 'first_launch',
  ts: '2026-07-25T10:00:00.000Z',
  session_id: 's1',
  platform: 'web',
  app_version: '1.0.0',
  ...over,
});

describe('POST /v1/events — ingest', () => {
  it('uses ON CONFLICT DO NOTHING, never INSERT OR IGNORE', async () => {
    // OR IGNORE also swallows NOT NULL / CHECK / FK violations, which would make
    // genuine corruption indistinguishable from a duplicate retry.
    const { db, post } = harness();
    await post('/v1/events', { app_id: 'subly', events: [ev()] });
    const sql = db.sql.join('\n');
    expect(sql).toContain('ON CONFLICT(event_id) DO NOTHING');
    expect(sql).not.toContain('OR IGNORE');
  });

  it('NEVER stores an IP, and takes geo from the cf object instead', async () => {
    const { db, post } = harness();
    const res = await post('/v1/events', { app_id: 'subly', events: [ev()] }, {
      country: 'IN',
      region: 'Tamil Nadu',
      city: 'Chennai',
    });
    expect(res.status).toBe(200);
    // The schema has no ip column and the statement must not invent one.
    expect(db.sql.join('\n')).not.toMatch(/\bip\b/);
    const row = db.bound[0];
    expect(row).toContain('IN');
    expect(row).toContain('Chennai');
    // The header was present on the request and must appear nowhere.
    expect(JSON.stringify(row)).not.toContain('203.0.113.9');
  });

  it('stamps its own server_ts and keeps the client ts as untrusted data', async () => {
    const { db, post } = harness();
    await post('/v1/events', {
      app_id: 'subly',
      events: [ev({ ts: '1999-01-01T00:00:00.000Z' })],
    });
    const row = db.bound[0] as string[];
    expect(row).toContain('1999-01-01T00:00:00.000Z'); // preserved
    const serverTs = row[9];
    expect(new Date(serverTs).getUTCFullYear()).toBeGreaterThan(2020);
    expect(serverTs).not.toBe('1999-01-01T00:00:00.000Z');
  });

  it('skips malformed events but still ingests the valid ones', async () => {
    const { db, post } = harness();
    const res = await post('/v1/events', {
      app_id: 'subly',
      events: [ev(), { anon_id: 'x' }, ev({ event_id: 'b'.repeat(9), event: '' })],
    });
    expect(await res.json()).toEqual({ ok: true, received: 1 });
    expect(db.batched).toBe(1);
  });

  it('caps the NUMBER of params, not just their type and length', async () => {
    // 🔴 The client stopped at `kMaxParamCount = 12`; the server stopped at
    // nothing. Measured at HEAD on this route: 200 keys sent, 200 keys stored.
    // The JSON-length cap did not cover it either — 200 short keys serialise to
    // well under 2048 bytes, so the only thing bounding this column was the
    // client being ours, on a route that is unauthenticated by design.
    const { db, post } = harness();
    const params: Record<string, number> = {};
    for (let i = 0; i < 200; i++) params[`k${i}`] = i;
    await post('/v1/events', { app_id: 'subly', events: [ev({ params })] });
    const stored = JSON.parse((db.bound[0] as string[])[7]) as Record<string, number>;
    expect(Object.keys(stored)).toHaveLength(MAX_PARAM_COUNT);
    // The FIRST 12 are kept, so a client whose params are ordered by importance
    // keeps the ones it put first — and the row is deterministic, not sampled.
    expect(stored.k0).toBe(0);
    expect(stored[`k${MAX_PARAM_COUNT - 1}`]).toBe(MAX_PARAM_COUNT - 1);
    expect(stored[`k${MAX_PARAM_COUNT}`]).toBeUndefined();
  });

  it('the count is of ACCEPTED keys, exactly as the Dart mirror counts them', async () => {
    // Asserted rather than left implicit: if the server counted EXAMINED entries,
    // a map of rejected values followed by good ones would keep fewer keys than
    // the client keeps from the same map — and the shared constant that
    // analytics-contract.test.ts asserts would hide the difference entirely.
    const { db, post } = harness();
    const params: Record<string, unknown> = {};
    // 20 droppable entries first (nested objects), then 12 good ones.
    for (let i = 0; i < 20; i++) params[`drop${i}`] = { nested: true };
    for (let i = 0; i < MAX_PARAM_COUNT; i++) params[`keep${i}`] = i;
    await post('/v1/events', { app_id: 'subly', events: [ev({ params })] });
    const stored = JSON.parse((db.bound[0] as string[])[7]) as Record<string, number>;
    expect(Object.keys(stored)).toHaveLength(MAX_PARAM_COUNT);
    expect(stored.keep0).toBe(0);
    expect(stored[`keep${MAX_PARAM_COUNT - 1}`]).toBe(MAX_PARAM_COUNT - 1);
  });

  it('drops free text and nested values from params', async () => {
    const { db, post } = harness();
    await post('/v1/events', {
      app_id: 'subly',
      events: [
        ev({
          params: {
            sku: 'pro_monthly',
            count: 2,
            ok: true,
            note: 'z'.repeat(500),
            nested: { a: 1 },
          },
        }),
      ],
    });
    const params = JSON.parse((db.bound[0] as string[])[7]);
    expect(params).toEqual({ sku: 'pro_monthly', count: 2, ok: true });
  });

  it('rejects a missing app_id and an oversized batch', async () => {
    const { post } = harness();
    expect((await post('/v1/events', { events: [ev()] })).status).toBe(400);
    const big = { app_id: 'subly', events: Array.from({ length: 101 }, () => ev()) };
    expect((await post('/v1/events', big)).status).toBe(413);
  });

  it('an empty batch is a no-op success, not an error', async () => {
    const { db, post } = harness();
    const res = await post('/v1/events', { app_id: 'subly', events: [] });
    expect(res.status).toBe(200);
    expect(db.batched).toBe(0);
  });

  it('the circuit breaker sheds load with 429', async () => {
    const { db, post } = harness({ allowRate: false });
    const res = await post('/v1/events', { app_id: 'subly', events: [ev()] });
    expect(res.status).toBe(429);
    expect(db.batched).toBe(0);
  });

  it('a D1 failure returns 503 so the client KEEPS the batch', async () => {
    // Dedup on event_id makes the retry safe; a 200 here would lose the events.
    const db = realPlatformDb();
    db.throwOnWrite = true;
    const { post } = harness({ db });
    const res = await post('/v1/events', { app_id: 'subly', events: [ev()] });
    expect(res.status).toBe(503);
    // NEW, and only sayable now: the 503 is honest. Nothing landed, so the
    // client's retry cannot double-count. Against FakeDb this line could not be
    // written at all.
    expect(db.count('events')).toBe(0);
  });

  it('malformed JSON is a 400, not a crash', async () => {
    const app = new Hono<AppEnv>();
    app.route('/v1', events);
    const res = await app.fetch(
      new Request('https://x/v1/events', { method: 'POST', body: '{oops' }),
      {} as AppEnv['Bindings'],
    );
    expect(res.status).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE COST CIRCUIT BREAKER — what it is KEYED ON, not merely that it fires.
//
// Every test below is new. Before them the suite asserted only that a denying
// limiter produced a 429; the key was never observed, so the route's single
// ceiling could be composed entirely from the request body of an endpoint that
// is unauthenticated by design and nothing went red. Proven by mutation on the
// real route: replacing the key with `MUTANT-${crypto.randomUUID()}` — i.e.
// deleting all bucketing — left tsc clean and the whole suite green.
//
// The property that matters is UNSPOOFABILITY: a caller who rotates `anon_id`
// (or `app_id`) per request must land in the SAME ceiling bucket every time.
// ─────────────────────────────────────────────────────────────────────────────
describe('the /v1/events cost circuit breaker is keyed on server-derived values', () => {
  const cf = { colo: 'MAA', asn: 24560, country: 'IN' };

  it('checks TWO distinct keys per request, only one of which is client-chosen', async () => {
    const { fairness, ceiling, post } = harness();
    const res = await post('/v1/events', { app_id: 'subly', events: [ev()] }, cf);
    expect(res.status).toBe(200);
    expect(ceiling.keys).toHaveLength(1);
    expect(fairness.keys).toHaveLength(1);
    expect(ceiling.keys[0]).not.toBe(fairness.keys[0]);
    // The fairness bucket is still per (app, install) — that half is unchanged.
    expect(fairness.keys[0]).toBe('subly:install-1');
  });

  it('the ceiling key contains NO body-supplied value at all', async () => {
    const { ceiling, post } = harness();
    const body = {
      app_id: 'app-from-the-body',
      events: [ev({ anon_id: 'anon-from-the-body', session_id: 'sess-from-the-body' })],
    };
    await post('/v1/events', body, cf);
    const key = ceiling.keys[0];
    for (const supplied of ['app-from-the-body', 'anon-from-the-body', 'sess-from-the-body']) {
      expect(key, supplied).not.toContain(supplied);
    }
    // It is exactly the two `request.cf` fields, and it says which they are.
    expect(key).toBe('edge:MAA:24560');
  });

  it('ROTATING anon_id and app_id cannot move the caller to a fresh bucket', async () => {
    // This is the bypass itself. With the old single key each of these three
    // requests got its own 120/min bucket, so the ceiling was "120 requests per
    // minute PER REQUEST" — no ceiling at all.
    const { fairness, ceiling, post } = harness();
    for (let i = 0; i < 3; i++) {
      await post(
        '/v1/events',
        { app_id: `app-${i}`, events: [ev({ anon_id: `rotating-${i}` })] },
        cf,
      );
    }
    expect(new Set(fairness.keys).size).toBe(3); // client moved buckets, as before
    expect(new Set(ceiling.keys).size).toBe(1); // …and got nowhere on the ceiling
  });

  it('a different edge PoP or network IS a different bucket (it is not one global key)', async () => {
    const { ceiling, post } = harness();
    await post('/v1/events', { app_id: 'subly', events: [ev()] }, { colo: 'MAA', asn: 24560 });
    await post('/v1/events', { app_id: 'subly', events: [ev()] }, { colo: 'SIN', asn: 24560 });
    await post('/v1/events', { app_id: 'subly', events: [ev()] }, { colo: 'MAA', asn: 9999 });
    expect(ceiling.keys).toEqual(['edge:MAA:24560', 'edge:SIN:24560', 'edge:MAA:9999']);
  });

  it('the ceiling alone can shed the request even when the fairness bucket allows it', async () => {
    const { db, fairness, post } = harness({ allowCeiling: false });
    const res = await post('/v1/events', { app_id: 'subly', events: [ev()] }, cf);
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ ok: false, error: 'rate_limited', received: 0 });
    expect(db.batched).toBe(0);
    // Shed BEFORE the body-derived key is even consulted: a rotating caller must
    // not be able to spend the fairness limiter's budget to get a verdict.
    expect(fairness.keys).toEqual([]);
  });

  it('BOTH halves must pass — the fairness bucket still shed independently', async () => {
    const { db, ceiling, post } = harness({ allowRate: false });
    const res = await post('/v1/events', { app_id: 'subly', events: [ev()] }, cf);
    expect(res.status).toBe(429);
    expect(db.batched).toBe(0);
    expect(ceiling.keys).toHaveLength(1); // it was consulted, and it allowed
  });

  it('CF-Connecting-IP never reaches the key, on either half', async () => {
    // The harness always sends 203.0.113.9. The privacy invariant is that the
    // header is never read — including as a rate-limit dimension.
    const { fairness, ceiling, post } = harness();
    await post('/v1/events', { app_id: 'subly', events: [ev()] }, cf);
    expect([...ceiling.keys, ...fairness.keys].join('|')).not.toContain('203.0.113.9');
  });

  it('/v1/consent is behind the same two-key breaker', async () => {
    const { fairness, ceiling, post } = harness();
    await post(
      '/v1/consent',
      {
        consent_id: '22222222-2222-4222-8222-222222222222',
        app_id: 'subly',
        anon_id: 'install-1',
        purpose: 'analytics',
        granted: true,
        policy_version: '2026-07-25',
      },
      cf,
    );
    expect(ceiling.keys).toEqual(['edge:MAA:24560']);
    expect(fairness.keys).toEqual(['consent:subly:install-1']);
  });

  it('a missing cf object degrades to one bounded bucket, never to unbounded', async () => {
    // `request.cf` is populated unconditionally by the runtime, so this is the
    // local/dev shape. It must still produce a stable key, not a per-request one.
    const { ceiling, post } = harness();
    await post('/v1/events', { app_id: 'subly', events: [ev()] });
    await post('/v1/events', { app_id: 'subly', events: [ev({ anon_id: 'other' })] });
    expect(new Set(ceiling.keys).size).toBe(1);
    expect(ceiling.keys[0]).toBe('edge:-:-');
  });

  it('a hostile cf object cannot inject an unbounded key either', async () => {
    const { ceiling, post } = harness();
    await post('/v1/events', { app_id: 'subly', events: [ev()] }, {
      colo: 'x'.repeat(200), // over the length cap
      asn: { toString: () => 'nope' }, // neither number nor string
    });
    expect(ceiling.keys[0]).toBe('edge:-:-');
  });

  it('either binding being absent fails OPEN, as documented', async () => {
    // Dropping real analytics because a binding is missing is worse than the
    // burst it would have stopped — but that is a DEPLOY-time gap, not a
    // caller-reachable one, and wrangler.jsonc declares both.
    for (const omit of [
      ['EVENTS_CEILING_LIMITER'],
      ['EVENTS_LIMITER'],
      ['EVENTS_LIMITER', 'EVENTS_CEILING_LIMITER'],
    ] as const) {
      const { post } = harness({ allowRate: false, allowCeiling: false, omit: [...omit] });
      const res = await post('/v1/events', { app_id: 'subly', events: [ev()] }, cf);
      expect(res.status, omit.join('+')).toBe(omit.length === 2 ? 200 : 429);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE BODY IS BOUNDED **BEFORE** IT IS PARSED.
//
// 🔴 THE DEFECT. `c.req.json()` was the FIRST statement of the handler. The 413
// on `events.length > 100` and the whole circuit breaker both evaluated after
// it, so they graded values that only existed because the isolate had already
// materialised the entire request — on a public, unauthenticated route sharing
// an isolate with GET /config/:app.
//
// Measured at HEAD with a streamed 8 MB body and an ALLOWING limiter: all 8 MB
// were pulled into the isolate, and only then did the handler answer. With the
// fix the same request is refused after the cap is crossed.
//
// Every test below fails on a handler that parses first — that is the property,
// not "a big body is rejected", which a post-parse check also satisfies.
// ─────────────────────────────────────────────────────────────────────────────
describe('POST /v1/events bounds the body before parsing it', () => {
  /** A body that streams `chunks` × 1 MB, counting what the handler pulls. */
  function streamedBody(chunks: number) {
    const counter = { pulled: 0 };
    const meg = new TextEncoder().encode('z'.repeat(1024 * 1024));
    const stream = new ReadableStream<Uint8Array>(
      {
        pull(ctrl) {
          if (counter.pulled >= chunks) {
            ctrl.close();
            return;
          }
          counter.pulled++;
          ctrl.enqueue(meg);
        },
      },
      // highWaterMark 0 so the stream pre-buffers NOTHING. With the default of 1
      // the fixture pulls a megabyte before the handler has run at all, and
      // `pulled` would read as 1 even for a request the handler never touched —
      // a floor the assertions would then have to be loosened to accept, which
      // is how a measurement stops measuring.
      { highWaterMark: 0 },
    );
    return { counter, stream };
  }

  it('an over-cap streamed body is refused, and the isolate stops reading it', async () => {
    const { db, postRaw } = harness();
    const { counter, stream } = streamedBody(8);
    const res = await postRaw('/v1/events', {
      headers: { 'Content-Type': 'application/json' },
      body: stream,
      // @ts-expect-error undici requires `duplex` for a stream body; the Workers
      // runtime does not have the option, which is why this is a test-only cast.
      duplex: 'half',
    });
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: 'body_too_large' });
    expect(db.batched).toBe(0);
    // 🔴 THE LOAD-BEARING ASSERTION, and the one that fails on a handler that
    // parses first: at HEAD all 8 chunks were pulled. Exactly ONE now — the cap
    // is 256 KB, so the very first 1 MB chunk crosses it and the reader is
    // cancelled. Peak buffering is one chunk, whatever the caller intended to
    // send. `toBe(1)`, not `toBeLessThan(8)`: a bound that loosens as the fixture
    // grows is a bound that stops noticing.
    expect(counter.pulled).toBe(1);
  });

  it('a LYING Content-Length does not buy a bigger body', async () => {
    // Content-Length is caller-supplied, so it is only ever a cheap early
    // reject. If it were the bound, `Content-Length: 10` plus 8 MB of body would
    // be accepted — which is the whole reason the read is independently
    // budgeted.
    const { postRaw } = harness();
    const { counter, stream } = streamedBody(8);
    const res = await postRaw('/v1/events', {
      headers: { 'Content-Type': 'application/json', 'Content-Length': '10' },
      body: stream,
      // @ts-expect-error see above
      duplex: 'half',
    });
    expect(res.status).toBe(413);
    expect(counter.pulled).toBe(1);
  });

  it('an over-cap Content-Length is refused without reading the body at all', async () => {
    const { postRaw } = harness();
    const { counter, stream } = streamedBody(8);
    const res = await postRaw('/v1/events', {
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': String(MAX_EVENTS_BODY_BYTES + 1),
      },
      body: stream,
      // @ts-expect-error see above
      duplex: 'half',
    });
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: 'body_too_large' });
    expect(counter.pulled).toBe(0); // the cheap limb, doing its job
  });

  it('a Content-Length that is not a count is a 400, not a skipped check', async () => {
    // `Number('')` is 0 and `Number('12abc')` is NaN — treating either as "no
    // header" would be a free way to bypass the cheap limb.
    const { postRaw } = harness();
    for (const value of ['abc', '-1', '1.5']) {
      const res = await postRaw('/v1/events', {
        headers: { 'Content-Type': 'application/json', 'Content-Length': value },
        body: JSON.stringify({ app_id: 'subly', events: [ev()] }),
      });
      expect(res.status, value).toBe(400);
      expect(await res.json(), value).toEqual({ error: 'bad_content_length' });
    }
  });

  it('a body just UNDER the cap is still accepted', async () => {
    // A cap that also rejects legitimate traffic is not a fix. The number is
    // derived from the caps this route already enforces (100 events × ~2.4 KB),
    // so the largest batch the route permits must go through.
    const { db, post } = harness();
    const params: Record<string, string> = {};
    for (let i = 0; i < 12; i++) params[`k${i}`] = 'v'.repeat(64);
    const big = {
      app_id: 'subly',
      events: Array.from({ length: 100 }, (_, i) => ev({ event_id: `id-${i}`, params })),
    };
    expect(JSON.stringify(big).length).toBeLessThan(MAX_EVENTS_BODY_BYTES);
    const res = await post('/v1/events', big);
    expect(res.status).toBe(200);
    expect(db.batched).toBe(100);
  });

  it('the ceiling is consulted BEFORE the body is read', async () => {
    // The order is the fix. A denied ceiling must cost the isolate nothing.
    const { db, postRaw } = harness({ allowCeiling: false });
    const { counter, stream } = streamedBody(8);
    const res = await postRaw('/v1/events', {
      headers: { 'Content-Type': 'application/json' },
      body: stream,
      // @ts-expect-error see above
      duplex: 'half',
    });
    expect(res.status).toBe(429);
    expect(counter.pulled).toBe(0);
    expect(db.batched).toBe(0);
  });

  it('/v1/consent has a far tighter cap — there is no 256 KB consent artifact', async () => {
    const { db, postRaw } = harness();
    const res = await postRaw('/v1/consent', {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        consent_id: '2'.repeat(16),
        app_id: 'subly',
        anon_id: 'install-1',
        purpose: 'analytics',
        policy_version: '2026-07-25',
        pad: 'z'.repeat(MAX_CONSENT_BODY_BYTES),
      }),
    });
    expect(res.status).toBe(413);
    expect(db.bound).toEqual([]);
    // …and the cap is genuinely tighter than the batch route's, not a copy.
    expect(MAX_CONSENT_BODY_BYTES).toBeLessThan(MAX_EVENTS_BODY_BYTES);
  });
});

describe('anon_id is required, never invented and never borrowed', () => {
  it('a batch whose first event has no anon_id is a 400, not bucket `unknown`', async () => {
    // `?? "unknown"` collapsed every client whose install-id provider returned
    // null into ONE bucket — capping honest clients together at 120/min while
    // the rotation bypass stayed wide open — and wrote rows with anon_id
    // literally 'unknown' into a NOT NULL column meant to identify an install.
    const { db, fairness, ceiling, post } = harness();
    const res = await post('/v1/events', {
      app_id: 'subly',
      events: [ev({ anon_id: undefined })],
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'missing_anon_id' });
    expect(db.batched).toBe(0);
    // The BODY-DERIVED limiter is not charged: there is no usable install id to
    // key it on, and inventing one is the `?? 'unknown'` defect above.
    expect(fairness.keys).toEqual([]);
    // ⚠️ CHANGED DELIBERATELY. This used to assert that NEITHER limiter was
    // charged. The server-derived ceiling now runs before the body is read at
    // all — that is the whole point of the unbounded-body fix — so a malformed
    // batch is charged against `edge:<colo>:<asn>`. That is the correct
    // direction: a flood of garbage costs this isolate the same work as a flood
    // of valid batches, and the key it lands on is the one a caller cannot
    // rotate out of. The opposite order is what let an 8 MB body be parsed in
    // full before anything graded it.
    expect(ceiling.keys).toEqual(['edge:-:-']);
  });

  it('never writes the literal `unknown` as an install id', async () => {
    const { db, post } = harness();
    await post('/v1/events', { app_id: 'subly', events: [ev({ anon_id: '' })] });
    expect(JSON.stringify(db.bound)).not.toContain('unknown');
  });

  it('an event without its own anon_id is skipped, not attributed to another install', async () => {
    // It used to inherit `firstAnon`, so one install's id was stamped onto a
    // different install's row — silent mis-attribution in the analytics table.
    const { db, post } = harness();
    const res = await post('/v1/events', {
      app_id: 'subly',
      events: [
        ev({ anon_id: 'install-A' }),
        ev({ event_id: '33333333-3333-4333-8333-333333333333', anon_id: undefined }),
      ],
    });
    expect(await res.json()).toEqual({ ok: true, received: 1 });
    expect(db.bound).toHaveLength(1);
    expect(db.bound[0][2]).toBe('install-A');
  });
});

describe('POST /v1/consent — the DPDP artifact', () => {
  const artifact = (over: Record<string, unknown> = {}) => ({
    consent_id: '22222222-2222-4222-8222-222222222222',
    app_id: 'subly',
    anon_id: 'install-1',
    purpose: 'analytics',
    granted: true,
    policy_version: '2026-07-25',
    ts: '2026-07-25T10:00:00.000Z',
    ...over,
  });

  it('inserts append-only and is idempotent on consent_id', async () => {
    const { db, post } = harness();
    const res = await post('/v1/consent', artifact());
    expect(res.status).toBe(200);
    const sql = db.sql.join('\n');
    expect(sql).toContain('INSERT INTO consent_artifacts');
    expect(sql).toContain('ON CONFLICT(consent_id) DO NOTHING');
    // Append-only: a withdrawal is a NEW row, so nothing here may UPDATE.
    expect(sql).not.toContain('UPDATE');
  });

  it('records a withdrawal as granted=0', async () => {
    const { db, post } = harness();
    await post('/v1/consent', artifact({ granted: false }));
    expect(db.bound[0][4]).toBe(0);
  });

  it('stores no IP', async () => {
    const { db, post } = harness();
    await post('/v1/consent', artifact());
    expect(JSON.stringify(db.bound[0])).not.toContain('203.0.113.9');
    expect(db.sql.join('\n')).not.toMatch(/\bip\b/);
  });

  it('requires every field that makes the artifact meaningful', async () => {
    const { post } = harness();
    for (const missing of [
      'consent_id',
      'app_id',
      'anon_id',
      'purpose',
      'policy_version',
    ]) {
      const body = artifact();
      delete (body as Record<string, unknown>)[missing];
      expect((await post('/v1/consent', body)).status, missing).toBe(400);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// WHAT ONLY A REAL ENGINE CAN ANSWER — [pipeline B-9].
//
// Every assertion in this block is one that `class FakeDb` made IMPOSSIBLE, not
// merely inconvenient. They are grouped so that deleting the harness deletes a
// visible capability rather than quietly weakening assertions spread through the
// file above.
// ─────────────────────────────────────────────────────────────────────────────
describe('the route is executed against platform_db, not asserted about', () => {
  it('every column the INSERT names exists in the shipped migration', async () => {
    // 🔴 THE MUTATION THIS FILE COULD NOT CATCH. Rename any column in the
    // `INSERT INTO events (...)` list — `anon_id` to `anonymous_id`, say — and
    // FakeDb answered `{ changes: 1 }` exactly as before: the whole suite stayed
    // green against a Worker that could not write a single row to the real
    // database. `tsc --noEmit` cannot see it either; SQL is a string.
    const { db, post } = harness();
    const res = await post('/v1/events', { app_id: 'subly', events: [ev()] });
    expect(res.status).toBe(200);
    const rows = db.rows('SELECT * FROM events');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      event_id: '11111111-1111-4111-8111-111111111111',
      app_id: 'subly',
      anon_id: 'install-1',
      event: 'first_launch',
      client_ts: '2026-07-25T10:00:00.000Z',
    });
  });

  it('DEDUP IS A PROPERTY OF THE DATABASE, not of a substring in the SQL', async () => {
    // Above, `expect(sql).toContain('ON CONFLICT(event_id) DO NOTHING')` is a
    // grep over the statement text. It stays green if the UNIQUE INDEX the clause
    // depends on is dropped from 0002_analytics.sql, which is the only thing that
    // makes the clause mean anything. Two sends, one row, by query.
    const { db, post } = harness();
    await post('/v1/events', { app_id: 'subly', events: [ev()] });
    await post('/v1/events', { app_id: 'subly', events: [ev({ event: 'second_send' })] });
    expect(db.count('events')).toBe(1);
    // …and it is the FIRST write that survives — DO NOTHING, not DO UPDATE.
    expect(db.rows('SELECT event FROM events')[0].event).toBe('first_launch');
  });

  it('a batch is ONE transaction — a failing row takes the whole batch with it', async () => {
    // D1's `batch()` is transactional and the route depends on that: it returns
    // 503 so the client keeps and retries the batch, which is only safe if the
    // batch is all-or-nothing. Against FakeDb, `batch()` incremented a counter.
    // A DB-level abort the route cannot pre-empt, as subly-api's harness does it.
    const db = realPlatformDb([
      `CREATE TRIGGER reject_boom BEFORE INSERT ON events
         WHEN NEW.event = 'boom'
         BEGIN SELECT RAISE(ABORT, 'rejected by trigger'); END;`,
    ]);
    const { post } = harness({ db });
    const res = await post('/v1/events', {
      app_id: 'subly',
      events: [
        ev({ event_id: 'good-1' }),
        ev({ event_id: 'bad-1', event: 'boom' }),
        ev({ event_id: 'good-2' }),
      ],
    });
    expect(res.status).toBe(503);
    // The route ACCEPTED all three as well-formed and handed them to D1 as one
    // batch; the engine rolled every one of them back. Zero, not two.
    expect(db.batched).toBe(3);
    expect(db.count('events')).toBe(0);
  });

  it('a rejected request writes ZERO ROWS — the claim [4]B-4a is built on', async () => {
    // Not "the route did not call batch()". A count, against the table.
    const { db, post } = harness();
    for (const body of [
      { events: [ev()] }, // no app_id           → 400
      { app_id: 'subly', events: [ev({ anon_id: undefined })] }, // → 400
      { app_id: 'subly', events: Array.from({ length: 101 }, () => ev()) }, // → 413
    ]) {
      const res = await post('/v1/events', body);
      expect(res.status).not.toBe(200);
    }
    expect(db.count('events')).toBe(0);
  });

  it('🔴 RECORDED RED FOR [4]B-4a: an UNREGISTERED app_id writes a real row TODAY', async () => {
    // This is not an aspiration, it is the current behaviour, asserted so that
    // the increment which fixes it has a test to flip rather than a paragraph to
    // remember. `services/platform/src/routes/events.ts` accepts any string of
    // ≤64 chars as `app_id` and binds it straight into `events.app_id`, while
    // `routes/config.ts` rejects an unknown app with 404 — the asymmetry is the
    // defect. When the app registry lands, this expectation becomes `0` and the
    // status becomes 4xx; until then the honest number is 1.
    const { db, post } = harness();
    const res = await post('/v1/events', {
      app_id: 'zzz-not-a-real-app',
      events: [ev()],
    });
    expect(res.status).toBe(200);
    expect(db.count('events', "app_id = ?", 'zzz-not-a-real-app')).toBe(1);
  });

  it('the consent artifact lands, append-only and idempotent on consent_id', async () => {
    const { db, post } = harness();
    const artifact = {
      consent_id: '22222222-2222-4222-8222-222222222222',
      app_id: 'subly',
      anon_id: 'install-1',
      purpose: 'analytics',
      granted: true,
      policy_version: '2026-07-25',
    };
    expect((await post('/v1/consent', artifact)).status).toBe(200);
    // A REPLAY of the same artifact with the decision flipped must not overwrite
    // the record: DPDP §6(3) needs the trail, and the route uses DO NOTHING.
    expect((await post('/v1/consent', { ...artifact, granted: false })).status).toBe(200);
    const rows = db.rows('SELECT granted FROM consent_artifacts');
    expect(rows).toHaveLength(1);
    expect(rows[0].granted).toBe(1);
    // A WITHDRAWAL is a new artifact, with its own id — and that one does land.
    await post('/v1/consent', {
      ...artifact,
      consent_id: '33333333-3333-4333-8333-333333333333',
      granted: false,
    });
    expect(db.count('consent_artifacts')).toBe(2);
  });

  it('the shipped schema has NO ip column — the privacy invariant, at the table', async () => {
    // events.test.ts asserted `expect(db.sql).not.toMatch(/\bip\b/)` — a property
    // of the statement the route happened to write. This asserts it of the table
    // the portfolio actually stores rows in, which is where it has to hold.
    const db = realPlatformDb();
    for (const table of ['events', 'consent_artifacts']) {
      const cols = db.rows(`PRAGMA table_info(${table})`).map((c) => String(c.name));
      expect(cols, table).not.toContain('ip');
      expect(cols.join(','), table).not.toMatch(/(^|,)(ip_address|client_ip|remote_addr)(,|$)/);
    }
  });
});
