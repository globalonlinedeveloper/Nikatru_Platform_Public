import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import events from '../src/routes/events';
import type { AppEnv } from '../src/types';

/** Records every prepared SQL string and the values bound to it. */
class FakeDb {
  sql: string[] = [];
  bound: unknown[][] = [];
  batched = 0;
  throwOnBatch = false;

  prepare(sql: string) {
    this.sql.push(sql);
    const self = this;
    const mk = () => ({
      bind(...args: unknown[]) {
        self.bound.push(args);
        return mk();
      },
      async run() {
        if (self.throwOnBatch) throw new Error('d1 down');
        return { meta: { changes: 1 } };
      },
    });
    return mk();
  }

  async batch(rows: unknown[]) {
    if (this.throwOnBatch) throw new Error('d1 down');
    this.batched += rows.length;
    return [];
  }
}

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
    db?: FakeDb;
    /** Omit a binding entirely, to exercise the documented fail-OPEN. */
    omit?: Array<'EVENTS_LIMITER' | 'EVENTS_CEILING_LIMITER'>;
  } = {},
) {
  const db = opts.db ?? new FakeDb();
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
  return { db, post, fairness, ceiling };
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
    const db = new FakeDb();
    db.throwOnBatch = true;
    const { post } = harness({ db });
    const res = await post('/v1/events', { app_id: 'subly', events: [ev()] });
    expect(res.status).toBe(503);
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
    // Rejected before either limiter is charged for a malformed batch.
    expect([...fairness.keys, ...ceiling.keys]).toEqual([]);
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
