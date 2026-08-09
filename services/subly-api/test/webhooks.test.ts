// ─────────────────────────────────────────────────────────────────────────────
// The RevenueCat entitlement LIFECYCLE.
//
// The defect these exist for: CANCELLATION and BILLING_ISSUE were mapped to
// is_active = 0, so a paying user who turned auto-renew off — or whose card
// blipped — lost Pro on the very next read, mid-period. /v1/entitlements
// short-circuits on `is_active !== 1` BEFORE it ever consults `expires_at`, so
// the paid-through date could not save them.
//
// These tests drive the REAL route and then read the REAL /v1/entitlements
// answer out of a REAL SQL engine, because the bug lived in the seam between
// the two: each half is defensible on its own.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import webhooks, {
  resolveIsActive,
  isHandledType,
  validateEvent,
} from '../src/routes/webhooks';
import entitlements from '../src/routes/entitlements';
import { realPlatformDb, RecordingDb, TEST_ENV } from './harness';
import type { AppEnv } from '../src/types';

const SECRET = 'whsec_test';
const USER = 'user-a';
const DAY = 24 * 60 * 60 * 1000;

/** `null` means NO secret configured — an `undefined` default would be
 *  swallowed by the parameter default and quietly test the wrong thing.
 *  `envOverrides` patches bindings AFTER TEST_ENV, so a test can unset
 *  MONEY_ENVIRONMENT (pass `undefined` explicitly) or run as a sandbox deploy. */
function harness(
  db: unknown,
  secret: string | null = SECRET,
  envOverrides: Record<string, unknown> = {},
) {
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => {
    c.set('requestId', 'test-rid');
    await next();
  });
  app.route('/v1/webhooks', webhooks);
  // The read side, mounted with a stub auth so the pair can be tested together.
  const api = new Hono<AppEnv>();
  api.use('*', async (c, next) => {
    c.set('userId', USER);
    await next();
  });
  api.route('/entitlements', entitlements);
  app.route('/v1', api);

  const env = {
    ...TEST_ENV,
    PLATFORM_DB: db,
    REVENUECAT_WEBHOOK_SECRET: secret ?? undefined,
    ...envOverrides,
  } as unknown as AppEnv['Bindings'];

  return {
    post: (body: unknown, authz: string | null = `Bearer ${SECRET}`) =>
      app.request(
        '/v1/webhooks/revenuecat',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(authz === null ? {} : { Authorization: authz }),
          },
          body: typeof body === 'string' ? body : JSON.stringify(body),
        },
        env,
      ),
    isPro: async () => {
      const res = await app.request('/v1/entitlements', {}, env);
      return ((await res.json()) as { is_pro: boolean }).is_pro;
    },
  };
}

/**
 * The provider's clock, DETERMINISTIC AND STRICTLY INCREASING. Each event built
 * by `event()` is stamped one second after the previous one — `Date.now()`
 * would hand two in-process posts the SAME millisecond, and the strict-`>`
 * ordering clause would then (correctly) drop the second write, turning every
 * two-event lifecycle test into a coin flip.
 */
const CLOCK_BASE = Date.UTC(2026, 7, 1);
let clockSeq = 0;
const nextEventTs = () => CLOCK_BASE + ++clockSeq * 1000;

/** `expiresInDays` omitted ⇒ the field is absent; null ⇒ explicitly null.
 *  `environment` defaults to PRODUCTION (the tests run as a live deploy);
 *  `eventTs` overrides the provider clock, null OMITS it (a clock-less event). */
const event = (
  type: string,
  opts: {
    expiresInDays?: number | null;
    entitlement?: string;
    environment?: string;
    eventTs?: number | null;
  } = {},
) => {
  const ev: Record<string, unknown> = {
    id: `evt-${++clockSeq}`,
    type,
    app_user_id: USER,
    entitlement_ids: [opts.entitlement ?? 'pro'],
    product_id: 'subly_pro_monthly',
    store: 'APP_STORE',
    environment: opts.environment ?? 'PRODUCTION',
  };
  if (opts.eventTs === null) {
    // clock-less on purpose — no event_timestamp_ms at all
  } else if (opts.eventTs !== undefined) {
    // Passed through VERBATIM, junk included — the unreadable-clock tests cast
    // garbage through this parameter and it must reach the wire unrepaired.
    ev.event_timestamp_ms = opts.eventTs;
  } else ev.event_timestamp_ms = nextEventTs();
  if (opts.expiresInDays === null) ev.expiration_at_ms = null;
  else if (typeof opts.expiresInDays === 'number') {
    ev.expiration_at_ms = Date.now() + opts.expiresInDays * DAY;
  }
  return { api_version: '1.0', event: ev };
};

// ── the pure decision, exhaustively ──────────────────────────────────────────
describe('resolveIsActive — access state, not event name', () => {
  const now = 1_800_000_000_000;

  it('grants outright on every purchase-shaped event', () => {
    for (const t of [
      'INITIAL_PURCHASE',
      'RENEWAL',
      'PRODUCT_CHANGE',
      'UNCANCELLATION',
      'NON_RENEWING_PURCHASE',
      'SUBSCRIPTION_EXTENDED',
    ]) {
      expect(resolveIsActive(t, now - DAY, now), t).toBe(1);
    }
  });

  it('EXPIRATION revokes — it is the only event that does so on its own', () => {
    expect(resolveIsActive('EXPIRATION', now + 30 * DAY, now)).toBe(0);
  });

  it('CANCELLATION with a FUTURE paid-through date keeps access', () => {
    // Auto-renew off ≠ access off. This is the whole finding.
    expect(resolveIsActive('CANCELLATION', now + 20 * DAY, now)).toBe(1);
  });

  it('CANCELLATION with a PAST date revokes — the refund shape of the same event', () => {
    expect(resolveIsActive('CANCELLATION', now - 1, now)).toBe(0);
  });

  it('BILLING_ISSUE keeps access for the grace window, and drops it after', () => {
    expect(resolveIsActive('BILLING_ISSUE', now + 3 * DAY, now)).toBe(1);
    expect(resolveIsActive('BILLING_ISSUE', now - 3 * DAY, now)).toBe(0);
  });

  it('a grace event with no date at all keeps access', () => {
    // Matches how /v1/entitlements already reads a null expires_at: no date
    // means "no known end", not "expired".
    expect(resolveIsActive('CANCELLATION', null, now)).toBe(1);
    expect(resolveIsActive('BILLING_ISSUE', undefined, now)).toBe(1);
  });

  it('a grace event with an UNREADABLE date revokes — absent ≠ undecidable', () => {
    // This assertion used to read `.toBe(1)`: a date nobody could decide GRANTED
    // access. That is the same fail-open /v1/entitlements had on an unparseable
    // `expires_at`, sitting on the other end of the same wire. `validateEvent`
    // now rejects such an event before the route reaches here, so this pins the
    // DIRECTION of the pure function rather than a live code path.
    expect(resolveIsActive('CANCELLATION', Number.NaN, now)).toBe(0);
    expect(resolveIsActive('BILLING_ISSUE', Number.NaN, now)).toBe(0);
  });

  it('isHandledType covers exactly the three classes and nothing else', () => {
    for (const t of ['INITIAL_PURCHASE', 'EXPIRATION', 'CANCELLATION', 'BILLING_ISSUE']) {
      expect(isHandledType(t), t).toBe(true);
    }
    for (const t of ['SUBSCRIPTION_PAUSED', 'TRANSFER', 'TEST', '']) {
      expect(isHandledType(t), t).toBe(false);
    }
  });
});

// ── the route, writing to a real table, read back through /v1/entitlements ────
describe('POST /v1/webhooks/revenuecat → /v1/entitlements', () => {
  it('a cancelled-but-paid-through subscriber STAYS Pro', async () => {
    const db = realPlatformDb();
    const h = harness(db);

    expect((await h.post(event('INITIAL_PURCHASE', { expiresInDays: 30 }))).status).toBe(200);
    expect(await h.isPro()).toBe(true);

    // The user turns auto-renew off with 20 days left on the period.
    expect((await h.post(event('CANCELLATION', { expiresInDays: 20 }))).status).toBe(200);
    expect(await h.isPro(), 'cancel-at-period-end must not revoke').toBe(true);

    const [row] = db.rows('SELECT * FROM entitlements WHERE user_id = ?', USER);
    expect(row.is_active).toBe(1);
    expect(typeof row.expires_at).toBe('string');
  });

  it('a billing issue enters GRACE, it does not revoke', async () => {
    const db = realPlatformDb();
    const h = harness(db);
    await h.post(event('RENEWAL', { expiresInDays: 30 }));
    await h.post(event('BILLING_ISSUE', { expiresInDays: 16 }));
    expect(await h.isPro()).toBe(true);
  });

  it('a refunded CANCELLATION (date in the past) revokes immediately', async () => {
    const db = realPlatformDb();
    const h = harness(db);
    await h.post(event('INITIAL_PURCHASE', { expiresInDays: 30 }));
    await h.post(event('CANCELLATION', { expiresInDays: -1 }));
    expect(await h.isPro()).toBe(false);
    // Assert the STORED flag, not just is_pro. A past `expires_at` makes is_pro
    // false on its own, so an is_pro-only assertion passes even when the handler
    // wrote is_active = 1 — mutation-proven 2026-08-01: "grace always grants"
    // slipped through this test until this line was added.
    expect(db.rows('SELECT is_active FROM entitlements')[0].is_active).toBe(0);
  });

  it('EXPIRATION revokes', async () => {
    const db = realPlatformDb();
    const h = harness(db);
    await h.post(event('INITIAL_PURCHASE', { expiresInDays: 30 }));
    await h.post(event('EXPIRATION', { expiresInDays: -1 }));
    expect(await h.isPro()).toBe(false);
    expect(db.rows('SELECT is_active FROM entitlements')[0].is_active).toBe(0);
  });

  it('UNCANCELLATION restores Pro', async () => {
    const db = realPlatformDb();
    const h = harness(db);
    await h.post(event('EXPIRATION', { expiresInDays: -1 }));
    expect(await h.isPro()).toBe(false);
    await h.post(event('UNCANCELLATION', { expiresInDays: 25 }));
    expect(await h.isPro()).toBe(true);
  });

  it('an unhandled type is acked and writes NOTHING — never a silent revoke', async () => {
    const db = realPlatformDb();
    const h = harness(db);
    await h.post(event('INITIAL_PURCHASE', { expiresInDays: 30 }));
    for (const t of ['SUBSCRIPTION_PAUSED', 'TRANSFER', 'SOMETHING_NEW']) {
      const res = await h.post(event(t, { expiresInDays: -1 }));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true, ignored: t });
    }
    expect(await h.isPro()).toBe(true);
  });

  it('writes one row per entitlement id, scoped to this APP_ID', async () => {
    const db = realPlatformDb();
    const h = harness(db);
    await h.post({
      event: {
        type: 'INITIAL_PURCHASE',
        app_user_id: USER,
        entitlement_ids: ['pro', 'cloud_sync'],
        environment: 'PRODUCTION',
        expiration_at_ms: Date.now() + 30 * DAY,
      },
    });
    const rows = db.rows('SELECT entitlement, app_id FROM entitlements ORDER BY entitlement');
    expect(rows.map((r) => r.entitlement)).toEqual(['cloud_sync', 'pro']);
    expect(new Set(rows.map((r) => r.app_id))).toEqual(new Set(['subly']));
  });
});

// ── the shared-secret gate (already correct; pinned so it stays that way) ─────
describe('POST /v1/webhooks/revenuecat — authentication', () => {
  it('FAILS CLOSED with 503 when no secret is configured', async () => {
    const db = new RecordingDb();
    const res = await harness(db, null).post(event('EXPIRATION'), null);
    expect(res.status).toBe(503);
    expect(db.sql.length, 'nothing may be written without a configured secret').toBe(0);
  });

  it('401s a wrong or absent bearer, and writes nothing', async () => {
    for (const authz of [null, 'Bearer nope', 'Basic whsec_test', '']) {
      const db = new RecordingDb();
      const res = await harness(db).post(event('EXPIRATION'), authz);
      expect(res.status, String(authz)).toBe(401);
      expect(db.sql.length).toBe(0);
    }
  });

  it('400s malformed JSON', async () => {
    const res = await harness(new RecordingDb()).post('{not json');
    expect(res.status).toBe(400);
  });

  it('acks an event with no user or no entitlement id without writing', async () => {
    const db = new RecordingDb();
    expect((await harness(db).post({ event: { type: 'RENEWAL' } })).status).toBe(200);
    expect(
      (await harness(db).post({ event: { type: 'RENEWAL', app_user_id: USER } })).status,
    ).toBe(200);
    expect(db.sql.length).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// BODY VALIDATION — this is public input that lands in the SHARED platform_db.
//
// The hole that mattered: `expires_at` was written as
//   `typeof ev.expiration_at_ms === 'number' ? new Date(...).toISOString() : null`
// so ANY expiry the handler could not read became SQL NULL — and NULL is how
// /v1/entitlements spells "lifetime". A sender that switched to sending the
// timestamp as a string would have converted every subscriber to a permanent
// free-forever grant, with a 200 on every request and nothing in the logs.
//
// The rule these pin: an expiry we cannot read is REJECTED (400, write nothing,
// the sender retries), never silently reinterpreted.
// ─────────────────────────────────────────────────────────────────────────────
describe('POST /v1/webhooks/revenuecat — body validation', () => {
  /** Build an INITIAL_PURCHASE with one field overridden/injected. Carries the
   *  PRODUCTION environment (the harness deploy is 'live') and NO provider
   *  clock — a clock-less event, which inserts freely on an empty key. */
  const withField = (patch: Record<string, unknown>) => ({
    api_version: '1.0',
    event: {
      type: 'INITIAL_PURCHASE',
      app_user_id: USER,
      entitlement_ids: ['pro'],
      environment: 'PRODUCTION',
      ...patch,
    },
  });

  describe('an unreadable expiry is rejected, never read as "lifetime"', () => {
    for (const [label, value] of [
      ['a stringified epoch', '1800000000000'],
      ['an ISO string', '2026-09-01T00:00:00Z'],
      ['a boolean', true],
      ['an object', { seconds: 1 }],
      ['an array', [1]],
      ['past the max representable instant', 8.64e15 + 1],
      ['past the min representable instant', -8.64e15 - 1],
    ] as const) {
      it(`400s on ${label} and writes NOTHING`, async () => {
        const db = new RecordingDb();
        const res = await harness(db).post(withField({ expiration_at_ms: value }));
        expect(res.status, label).toBe(400);
        expect(db.sql.length, 'no row may be touched by a body we cannot read').toBe(0);
      });
    }

    it('400s on JSON `1e400`, which parses to Infinity — the 500 case', async () => {
      // Sent as RAW JSON TEXT on purpose: JSON.stringify(Infinity) is `null`, so
      // building this through an object literal would quietly test the
      // absent-date path instead. `typeof Infinity === 'number'` passed the old
      // check, and `new Date(Infinity).toISOString()` then threw a RangeError
      // with no try/catch above it — a 500 RevenueCat retries forever.
      const raw =
        `{"event":{"type":"INITIAL_PURCHASE","app_user_id":"${USER}",` +
        `"entitlement_ids":["pro"],"environment":"PRODUCTION","expiration_at_ms":1e400}}`;
      expect(
        (JSON.parse(raw) as { event: { expiration_at_ms: number } }).event
          .expiration_at_ms,
        'the fixture must really decode to Infinity or this proves nothing',
      ).toBe(Number.POSITIVE_INFINITY);

      const db = new RecordingDb();
      const res = await harness(db).post(raw);
      expect(res.status).toBe(400);
      expect(db.sql.length).toBe(0);
    });

    it('does NOT downgrade the rejected event into a lifetime grant', async () => {
      // The end-to-end statement of the same thing, through a real table: a
      // subscriber with a real end date sends a garbage renewal; they must not
      // come out the other side holding a null (= forever) expiry.
      const db = realPlatformDb();
      const h = harness(db);
      await h.post(event('INITIAL_PURCHASE', { expiresInDays: 30 }));
      const before = db.rows('SELECT expires_at FROM entitlements')[0].expires_at;

      const res = await h.post(withField({ type: 'RENEWAL', expiration_at_ms: '99999' }));
      expect(res.status).toBe(400);
      expect(db.rows('SELECT expires_at FROM entitlements')[0].expires_at).toBe(before);
      expect(await h.isPro()).toBe(true);
    });

    it('still accepts the two legitimate absent-date shapes', async () => {
      // Without this the route could 400 EVERY event and pass every test above.
      const db = realPlatformDb();
      const h = harness(db);
      expect((await h.post(event('INITIAL_PURCHASE'))).status).toBe(200); // absent
      expect((await h.post(event('RENEWAL', { expiresInDays: null }))).status).toBe(200);
      expect(await h.isPro()).toBe(true);
    });

    it('accepts the exact maximum representable instant', async () => {
      // The boundary the range check is written against. If MAX_TIME_MS were
      // wrong by one in the other direction, this 500s on toISOString.
      const db = realPlatformDb();
      const h = harness(db);
      const res = await h.post(withField({ expiration_at_ms: 8.64e15 }));
      expect(res.status).toBe(200);
      expect(db.rows('SELECT expires_at FROM entitlements')[0].expires_at).toBe(
        new Date(8.64e15).toISOString(),
      );
    });
  });

  describe('identifiers are shaped before they reach a PRIMARY KEY', () => {
    for (const [label, value] of [
      ['an object', { id: 1 }],
      ['a number', 42],
      ['an array', ['a']],
      ['a 257-character string', 'x'.repeat(257)],
    ] as const) {
      it(`400s on app_user_id that is ${label}`, async () => {
        const db = new RecordingDb();
        const res = await harness(db).post(withField({ app_user_id: value }));
        expect(res.status, label).toBe(400);
        expect(db.sql.length).toBe(0);
      });
    }

    it('ACKS an EMPTY app_user_id rather than 400ing it', async () => {
      // Empty is indistinguishable from absent — there is no user to act on, and
      // no retry can add one. 400 here would be an infinite retry for a body
      // that can never improve. A wrong-TYPED id is different: coercing it would
      // key a row nothing can ever read back, so that one is worth the retry.
      const db = new RecordingDb();
      const res = await harness(db).post(withField({ app_user_id: '' }));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
      expect(db.sql.length).toBe(0);
    });

    it('400s on a non-string entitlement id rather than binding it', async () => {
      const db = new RecordingDb();
      const res = await harness(db).post(withField({ entitlement_ids: ['pro', 7] }));
      expect(res.status).toBe(400);
      expect(db.sql.length).toBe(0);
    });

    it('400s on entitlement_ids that is not an array, or is oversized', async () => {
      const db = new RecordingDb();
      expect(
        (await harness(db).post(withField({ entitlement_ids: 'pro' }))).status,
      ).toBe(400);
      expect(
        (
          await harness(db).post(
            withField({ entitlement_ids: Array.from({ length: 51 }, (_, i) => `e${i}`) }),
          )
        ).status,
      ).toBe(400);
      expect(db.sql.length).toBe(0);
    });

    it('400s on a non-string product_id / store', async () => {
      const db = new RecordingDb();
      for (const patch of [{ product_id: 12 }, { store: ['APP_STORE'] }]) {
        const res = await harness(db).post(withField(patch));
        expect(res.status, JSON.stringify(patch)).toBe(400);
      }
      expect(db.sql.length).toBe(0);
    });

    it('ACKS a non-string `type` — it matches nothing we handle', async () => {
      const db = new RecordingDb();
      const res = await harness(db).post(withField({ type: 7 }));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true, ignored: '' });
      expect(db.sql.length).toBe(0);
    });

    it('accepts the boundary-length id — the bound is 256, not "short"', async () => {
      const db = realPlatformDb();
      const id = 'u'.repeat(256);
      const res = await harness(db).post(
        withField({ app_user_id: id, expiration_at_ms: Date.now() + 30 * DAY }),
      );
      expect(res.status).toBe(200);
      expect(db.rows('SELECT user_id FROM entitlements')[0].user_id).toBe(id);
    });

    it('falls back to original_app_user_id, and shapes that too', async () => {
      const db = realPlatformDb();
      const ok = await harness(db).post({
        event: {
          type: 'INITIAL_PURCHASE',
          original_app_user_id: 'legacy-user',
          entitlement_ids: ['pro'],
          environment: 'PRODUCTION',
        },
      });
      expect(ok.status).toBe(200);
      expect(db.rows('SELECT user_id FROM entitlements')[0].user_id).toBe('legacy-user');

      const rec = new RecordingDb();
      expect(
        (
          await harness(rec).post({
            event: { type: 'INITIAL_PURCHASE', original_app_user_id: {} },
          })
        ).status,
      ).toBe(400);
      expect(rec.sql.length).toBe(0);
    });
  });

  describe('envelope shape', () => {
    it('400s a body that is not a JSON object', async () => {
      const db = new RecordingDb();
      for (const body of ['null', '[]', '"hello"', '7']) {
        const res = await harness(db).post(body);
        expect(res.status, body).toBe(400);
      }
      expect(db.sql.length).toBe(0);
    });

    it('400s when `event` is present but not an object', async () => {
      const db = new RecordingDb();
      expect((await harness(db).post({ event: 'RENEWAL' })).status).toBe(400);
      expect((await harness(db).post({ event: [] })).status).toBe(400);
      expect(db.sql.length).toBe(0);
    });

    it('acks (200) a body with no `event` at all — not a malformed one', async () => {
      // The distinction that matters: 400 tells RevenueCat to retry. An empty
      // ping is not something a retry can fix.
      const db = new RecordingDb();
      const res = await harness(db).post({ api_version: '1.0' });
      expect(res.status).toBe(200);
      expect(db.sql.length).toBe(0);
    });

    it('an UNHANDLED type is acked no matter which field is junk', async () => {
      // Validation ORDER, and the reason this test lists every field rather than
      // one: we must not 400 an event we would never act on, because a 400 asks
      // RevenueCat to retry forever down the same delivery queue that carries
      // the RENEWAL and EXPIRATION events that move money.
      //
      // The first version of this test only sent `expiration_at_ms: 'garbage'` —
      // and passed against a route that DID 400 an unhandled event with a
      // wrong-typed `app_user_id`, because the identity check sat above the
      // handled-type gate. A fixture that exercises the one field that happens
      // to comply proves the ordering it was written to prove is correct.
      const db = new RecordingDb();
      for (const junk of [
        { expiration_at_ms: 'garbage' },
        { app_user_id: 12345 },
        { original_app_user_id: {} },
        { entitlement_ids: 'pro' },
        { product_id: [] },
        { store: 9 },
      ]) {
        const res = await harness(db).post(
          withField({ type: 'SUBSCRIPTION_PAUSED', ...junk }),
        );
        expect(res.status, JSON.stringify(junk)).toBe(200);
        expect(await res.json()).toEqual({ ok: true, ignored: 'SUBSCRIPTION_PAUSED' });
      }
      expect(db.sql.length).toBe(0);
    });
  });

  describe('validateEvent as a unit', () => {
    it('reports WHICH field was wrong — a 400 has to be actionable', () => {
      const r = validateEvent({ event: { type: 'RENEWAL', app_user_id: 1 } });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.detail).toContain('app_user_id');
    });

    it('returns the checked values, with the ISO conversion already done', () => {
      const ms = Date.UTC(2026, 8, 1);
      const ts = Date.UTC(2026, 7, 15, 12);
      const r = validateEvent({
        event: {
          id: 'evt-abc',
          type: 'RENEWAL',
          app_user_id: USER,
          entitlement_id: 'pro',
          environment: 'PRODUCTION',
          event_timestamp_ms: ts,
          expiration_at_ms: ms,
        },
      });
      expect(r.ok && r.act).toBe(true);
      if (r.ok && r.act) {
        expect(r.event).toEqual({
          type: 'RENEWAL',
          userId: USER,
          entitlementIds: ['pro'],
          productId: null,
          store: null,
          expiresAtMs: ms,
          expiresAt: new Date(ms).toISOString(),
          environment: 'live', // PRODUCTION, mapped to OUR vocabulary
          occurredAt: new Date(ts).toISOString(),
          eventId: 'evt-abc',
        });
      }
    });

    it('maps SANDBOX to sandbox, and a clock-less event to a null occurred_at', () => {
      const r = validateEvent({
        event: {
          type: 'RENEWAL',
          app_user_id: USER,
          entitlement_id: 'pro',
          environment: 'SANDBOX',
        },
      });
      expect(r.ok && r.act).toBe(true);
      if (r.ok && r.act) {
        expect(r.event.environment).toBe('sandbox');
        expect(r.event.occurredAt).toBeNull();
        expect(r.event.eventId).toBeNull();
      }
    });

    it('prefers entitlement_ids over the singular entitlement_id', () => {
      const r = validateEvent({
        event: {
          type: 'RENEWAL',
          app_user_id: USER,
          entitlement_ids: ['a', 'b'],
          entitlement_id: 'ignored',
          environment: 'PRODUCTION',
        },
      });
      expect(r.ok && r.act && r.event.entitlementIds).toEqual(['a', 'b']);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ORDERING — [5]M-2's defence on THIS writer. RevenueCat gives no ordering
// guarantee, so a delayed retry of an older event arrives after a newer one;
// before 2026-08-09 the UPSERT overwrote unconditionally and the retry rolled
// access backwards. The conditional `WHERE occurred_at IS NULL OR excluded > …`
// is clause-for-clause the MoR store's, against the same shared table.
// ─────────────────────────────────────────────────────────────────────────────
describe('POST /v1/webhooks/revenuecat — event ordering (occurred_at)', () => {
  const T1 = Date.UTC(2026, 6, 1, 10);
  const T2 = Date.UTC(2026, 6, 1, 11);
  const T3 = Date.UTC(2026, 6, 1, 12);

  it('a delayed retry of an OLDER event cannot roll a newer state back', async () => {
    const db = realPlatformDb();
    const h = harness(db);
    // The newer event lands first: a renewal, paid 30 days out.
    await h.post(event('RENEWAL', { expiresInDays: 30, eventTs: T2 }));
    expect(await h.isPro()).toBe(true);

    // Then an OLDER cancellation-refund (past expiry) arrives late.
    const res = await h.post(event('CANCELLATION', { expiresInDays: -1, eventTs: T1 }));
    expect(res.status, 'the late event is still acked — RevenueCat must stop retrying').toBe(200);

    const [row] = db.rows('SELECT is_active, occurred_at FROM entitlements');
    expect(row.is_active, 'the older event must not revoke the newer grant').toBe(1);
    expect(row.occurred_at).toBe(new Date(T2).toISOString());
    expect(await h.isPro()).toBe(true);
  });

  it('a genuinely newer event still applies', async () => {
    const db = realPlatformDb();
    const h = harness(db);
    await h.post(event('RENEWAL', { expiresInDays: 30, eventTs: T1 }));
    await h.post(event('EXPIRATION', { expiresInDays: -1, eventTs: T3 }));
    expect(db.rows('SELECT is_active FROM entitlements')[0].is_active).toBe(0);
    expect(await h.isPro()).toBe(false);
  });

  it('an event with the SAME clock does not overwrite — the > is strict', async () => {
    // Two different events in the same millisecond are unorderable; first-in
    // wins, which is also what the MoR store does. A same-event RETRY loses
    // nothing here: its content is identical by definition.
    const db = realPlatformDb();
    const h = harness(db);
    await h.post(event('RENEWAL', { expiresInDays: 30, eventTs: T2 }));
    await h.post(event('EXPIRATION', { expiresInDays: -1, eventTs: T2 }));
    expect(db.rows('SELECT is_active FROM entitlements')[0].is_active).toBe(1);
  });

  it('a clock-less event cannot clobber a clocked row', async () => {
    const db = realPlatformDb();
    const h = harness(db);
    await h.post(event('RENEWAL', { expiresInDays: 30, eventTs: T2 }));
    const res = await h.post(event('EXPIRATION', { expiresInDays: -1, eventTs: null }));
    expect(res.status).toBe(200);
    expect(db.rows('SELECT is_active FROM entitlements')[0].is_active).toBe(1);
  });

  it('a clocked event upgrades a clock-less row', async () => {
    const db = realPlatformDb();
    const h = harness(db);
    await h.post(event('RENEWAL', { expiresInDays: 30, eventTs: null }));
    expect(db.rows('SELECT occurred_at FROM entitlements')[0].occurred_at).toBeNull();
    await h.post(event('EXPIRATION', { expiresInDays: -1, eventTs: T1 }));
    const [row] = db.rows('SELECT is_active, occurred_at FROM entitlements');
    expect(row.is_active).toBe(0);
    expect(row.occurred_at).toBe(new Date(T1).toISOString());
  });

  it('rows are stamped with the full provenance quartet', async () => {
    const db = realPlatformDb();
    const h = harness(db);
    const body = event('INITIAL_PURCHASE', { expiresInDays: 30, eventTs: T1 });
    await h.post(body);
    const [row] = db.rows(
      'SELECT provider, provider_environment, last_event_id, occurred_at FROM entitlements',
    );
    expect(row.provider).toBe('revenuecat');
    expect(row.provider_environment).toBe('live');
    expect(row.last_event_id).toBe((body.event as { id: string }).id);
    expect(row.occurred_at).toBe(new Date(T1).toISOString());
  });

  it('400s an unreadable event_timestamp_ms and writes nothing', async () => {
    for (const bad of ['garbage', '1800000000000', {}, 8.64e15 + 1]) {
      const db = new RecordingDb();
      const res = await harness(db).post(event('RENEWAL', { eventTs: bad as number }));
      expect(res.status, JSON.stringify(bad)).toBe(400);
      expect(db.sql.length).toBe(0);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE SANDBOX GUARD — [5]M-12 on THIS writer. RevenueCat delivers SANDBOX and
// PRODUCTION events to the SAME URL under the SAME bearer secret (where a
// sandbox-signed MoR notification simply fails live verification), so without
// this guard one sandbox test purchase against a production user id overwrites
// a paying customer's live row.
// ─────────────────────────────────────────────────────────────────────────────
describe('POST /v1/webhooks/revenuecat — the money-world guard', () => {
  it('a SANDBOX event on a live deploy is ACKED and writes NOTHING', async () => {
    const db = new RecordingDb();
    const res = await harness(db).post(
      event('INITIAL_PURCHASE', { expiresInDays: 30, environment: 'SANDBOX' }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, ignored_environment: 'sandbox' });
    expect(db.sql.length, 'the other money world must not reach a bind').toBe(0);
  });

  it('a sandbox test purchase cannot overwrite a paying customer', async () => {
    // The end-to-end statement, through a real table: live Pro, then the same
    // user's id turns up in a sandbox event with a dead expiry.
    const db = realPlatformDb();
    const h = harness(db);
    await h.post(event('INITIAL_PURCHASE', { expiresInDays: 30 }));
    expect(await h.isPro()).toBe(true);

    await h.post(event('EXPIRATION', { expiresInDays: -1, environment: 'SANDBOX' }));
    expect(await h.isPro(), 'sandbox money must never touch a live row').toBe(true);
    expect(db.rows('SELECT provider_environment FROM entitlements')[0].provider_environment).toBe('live');
  });

  it('a PRODUCTION event on a SANDBOX deploy is ignored the same way', async () => {
    const db = new RecordingDb();
    const res = await harness(db, SECRET, { MONEY_ENVIRONMENT: 'sandbox' }).post(
      event('RENEWAL', { expiresInDays: 30 }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, ignored_environment: 'live' });
    expect(db.sql.length).toBe(0);
  });

  it('an event with NO environment is acked without writing — no world, no row', async () => {
    const db = new RecordingDb();
    const body = event('RENEWAL', { expiresInDays: 30 });
    delete (body.event as Record<string, unknown>).environment;
    const res = await harness(db).post(body);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(db.sql.length).toBe(0);
  });

  it('400s an unrecognised environment and writes nothing', async () => {
    for (const bad of ['STAGING', 'production', 7, {}]) {
      const db = new RecordingDb();
      const res = await harness(db).post(event('RENEWAL', { environment: bad as string }));
      expect(res.status, JSON.stringify(bad)).toBe(400);
      expect(db.sql.length).toBe(0);
    }
  });

  it('503s when MONEY_ENVIRONMENT is unset — before the body is even read', async () => {
    const db = new RecordingDb();
    for (const broken of [undefined, 'prod', '']) {
      const res = await harness(db, SECRET, { MONEY_ENVIRONMENT: broken }).post(
        event('RENEWAL', { expiresInDays: 30 }),
      );
      expect(res.status, JSON.stringify(broken)).toBe(503);
      expect(await res.json()).toEqual({ error: 'money_rail_not_configured' });
    }
    expect(db.sql.length).toBe(0);
  });
});
