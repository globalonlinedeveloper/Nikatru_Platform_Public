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

function harness(opts: { allowRate?: boolean; db?: FakeDb } = {}) {
  const db = opts.db ?? new FakeDb();
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => {
    c.set('requestId', 'test-rid');
    await next();
  });
  app.route('/v1', events);
  const env = {
    PLATFORM_DB: db,
    EVENTS_LIMITER:
      opts.allowRate === false
        ? { limit: async () => ({ success: false }) }
        : { limit: async () => ({ success: true }) },
  } as unknown as AppEnv['Bindings'];

  const post = (path: string, body: unknown, cf?: Record<string, string>) => {
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
  return { db, post };
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
    expect(await res.json()).toEqual({ ok: true, accepted: 1 });
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
