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
import webhooks, { resolveIsActive, isHandledType } from '../src/routes/webhooks';
import entitlements from '../src/routes/entitlements';
import { realPlatformDb, RecordingDb, TEST_ENV } from './harness';
import type { AppEnv } from '../src/types';

const SECRET = 'whsec_test';
const USER = 'user-a';
const DAY = 24 * 60 * 60 * 1000;

/** `null` means NO secret configured — an `undefined` default would be
 *  swallowed by the parameter default and quietly test the wrong thing. */
function harness(db: unknown, secret: string | null = SECRET) {
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

/** `expiresInDays` omitted ⇒ the field is absent; null ⇒ explicitly null. */
const event = (
  type: string,
  opts: { expiresInDays?: number | null; entitlement?: string } = {},
) => {
  const ev: Record<string, unknown> = {
    type,
    app_user_id: USER,
    entitlement_ids: [opts.entitlement ?? 'pro'],
    product_id: 'subly_pro_monthly',
    store: 'APP_STORE',
  };
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
    // Matches how /v1/entitlements already reads a null expires_at.
    expect(resolveIsActive('CANCELLATION', null, now)).toBe(1);
    expect(resolveIsActive('BILLING_ISSUE', undefined, now)).toBe(1);
    expect(resolveIsActive('CANCELLATION', Number.NaN, now)).toBe(1);
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
