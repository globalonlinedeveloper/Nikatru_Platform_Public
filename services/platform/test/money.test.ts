import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import money, { MAX_MONEY_BODY_BYTES } from '../src/routes/money';
import type { AppEnv } from '../src/types';
import { MOR_VERIFIERS, verifierFor } from '../src/lib/mor/registry';
import {
  PADDLE_CUSTOM_DATA_APP_ID,
  PADDLE_CUSTOM_DATA_USER_ID,
  PADDLE_REPLAY_TOLERANCE_SECONDS,
  PADDLE_SECRET_PREFIX,
  paddleSignature,
  paddleVerifier,
} from '../src/lib/mor/paddle';
import { REVOCATION_REASONS } from '../src/lib/mor/contract';
import { realPlatformDb, type RealDb } from './harness';

// ─────────────────────────────────────────────────────────────────────────────
// THE MONEY RAIL — POST /v1/money/:provider.
//
// [5]M-1 one verifier stands between a provider and the entitlement table ·
// [5]M-2 recorded verbatim, exactly once, before it is interpreted, and an
// OUT-OF-ORDER delivery cannot re-grant a refunded subscription ·
// [5]M-7 attributable, or resolvably unclaimed — never acked and discarded ·
// [5]M-12 sandbox money cannot grant a production unlock.
//
// 🔴 NO MONEY HAS EVER MOVED THROUGH THIS RAIL, so every defect in it is
// invisible by construction and this file is the only thing that has ever walked
// it. Each test below names the specific way the rail can be wrong.
//
// ⚠️ EVERY PADDLE FACT EXERCISED HERE WAS FETCHED FROM developer.paddle.com ON
// 2026-08-01 and is listed, with its source URL, in the header of
// src/lib/mor/paddle.ts. The signatures in this file are computed with the SAME
// construction the adapter verifies, which would be circular on its own — so the
// construction itself is pinned by an assertion against the documented recipe
// (`${ts}:${rawBody}`, HMAC-SHA256, hex) rather than only by round-tripping.
// ─────────────────────────────────────────────────────────────────────────────

const SECRET = `${PADDLE_SECRET_PREFIX}01test_notification_destination_secret`;

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
    db?: RealDb;
    secret?: string | undefined;
    environment?: string | undefined;
    allowCeiling?: boolean;
  } = {},
) {
  const db = opts.db ?? realPlatformDb();
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => {
    c.set('requestId', 'test-rid');
    await next();
  });
  app.route('/v1/money', money);
  const ceiling = new FakeLimiter(opts.allowCeiling !== false);
  const env = {
    PLATFORM_DB: db,
    MONEY_CEILING_LIMITER: ceiling,
    MONEY_ENVIRONMENT: 'environment' in opts ? opts.environment : 'live',
    PADDLE_NOTIFICATION_SECRET: 'secret' in opts ? opts.secret : SECRET,
  } as unknown as AppEnv['Bindings'];

  /** POST a raw body with a signature computed for `ts`. */
  const send = async (
    raw: string,
    o: { ts?: number; signature?: string; header?: string; provider?: string } = {},
  ) => {
    const ts = o.ts ?? Math.floor(Date.now() / 1000);
    const h1 = o.signature ?? (await paddleSignature(SECRET, ts, raw));
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    const header = o.header ?? `ts=${ts};h1=${h1}`;
    if (header !== '') headers['Paddle-Signature'] = header;
    return app.fetch(
      new Request(`https://x/v1/money/${o.provider ?? 'paddle'}`, {
        method: 'POST',
        headers,
        body: raw,
      }),
      env,
      { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext,
    );
  };

  return { app, db, env, ceiling, send };
}

// ── payload builders — the documented Paddle shapes (V7/V9/V10) ──────────────

let seq = 0;
const nextEventId = () => `evt_${(seq += 1).toString().padStart(26, '0')}`;

function subscriptionBody(o: {
  eventId?: string;
  occurredAt: string;
  status: string;
  subscriptionId?: string;
  periodEnd?: string | null;
  trialEnd?: string | null;
  userId?: string | null;
  appId?: string | null;
  eventType?: string;
  customerEmail?: string;
}): string {
  const custom: Record<string, string> = {};
  if (o.userId != null) custom[PADDLE_CUSTOM_DATA_USER_ID] = o.userId;
  if (o.appId != null) custom[PADDLE_CUSTOM_DATA_APP_ID] = o.appId;
  return JSON.stringify({
    event_id: o.eventId ?? nextEventId(),
    notification_id: 'ntf_01',
    event_type: o.eventType ?? 'subscription.updated',
    occurred_at: o.occurredAt,
    data: {
      id: o.subscriptionId ?? 'sub_0000000000000000000000001',
      status: o.status,
      current_billing_period:
        o.periodEnd === undefined || o.periodEnd === null
          ? null
          : { starts_at: '2026-07-01T00:00:00.000Z', ends_at: o.periodEnd },
      items: o.trialEnd ? [{ trial_dates: { starts_at: '2026-07-01T00:00:00.000Z', ends_at: o.trialEnd } }] : [],
      custom_data: custom,
      customer_id: 'ctm_0000000000000000000000001',
      customer: o.customerEmail ? { id: 'ctm_0000000000000000000000001', email: o.customerEmail } : {},
    },
  });
}

function adjustmentBody(o: {
  eventId?: string;
  occurredAt: string;
  action: string;
  status?: string;
  subscriptionId?: string | null;
}): string {
  return JSON.stringify({
    event_id: o.eventId ?? nextEventId(),
    notification_id: 'ntf_02',
    event_type: 'adjustment.created',
    occurred_at: o.occurredAt,
    data: {
      id: 'adj_0000000000000000000000001',
      action: o.action,
      status: o.status ?? 'approved',
      transaction_id: 'txn_0000000000000000000000001',
      subscription_id: o.subscriptionId === undefined ? 'sub_0000000000000000000000001' : o.subscriptionId,
    },
  });
}

const FUTURE = '2027-01-01T00:00:00.000Z';
const PAST = '2020-01-01T00:00:00.000Z';
const USER = 'user-abc';
const APP = 'subly';

const entRow = (db: RealDb) =>
  db.rows('SELECT * FROM entitlements WHERE user_id = ? AND app_id = ?', USER, APP)[0];

// ─────────────────────────────────────────────────────────────────────────────

describe('[5]M-1 · the verifier is the only door', () => {
  it('a valid signature over the raw body is accepted', async () => {
    const { send, db } = harness();
    const res = await send(subscriptionBody({ occurredAt: '2026-08-01T00:00:00.000Z', status: 'active', periodEnd: FUTURE, userId: USER, appId: APP }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, recorded: true, derived: 'applied' });
    expect(db.count('provider_notifications')).toBe(1);
  });

  it('THE STORED NOTIFICATION IS STAMPED WITH THE ACCOUNT — which is what makes it erasable', async () => {
    // 🔴 WITHOUT THIS ASSERTION THE ERASURE COLUMN IS A DEAD FEATURE THAT
    // REPORTS HEALTHY. Migration 0006 gives `provider_notifications` a `user_id`
    // so the schema-derived sweep in routes/account.ts can reach the one table
    // in platform_db that holds the buyer's NAME AND EMAIL ADDRESS, verbatim.
    // erasure-reach.test.ts proves the sweep empties the table — but it plants
    // its own rows, so it would keep passing while the money rail left the
    // column NULL on every real row, and "delete my account" would silently miss
    // every payment notification in production.
    //
    // The stamp cannot happen at INSERT time: [5]M-2 requires the row be stored
    // verbatim BEFORE it is interpreted, so derivation is the first moment the
    // account is known. This is that moment, asserted.
    const { send, db } = harness();
    await send(subscriptionBody({ occurredAt: '2026-08-01T00:00:00.000Z', status: 'active', periodEnd: FUTURE, userId: USER, appId: APP }));
    expect(db.rows('SELECT user_id FROM provider_notifications')[0].user_id).toBe(USER);
    expect(db.count('provider_notifications', 'user_id = ?', USER)).toBe(1);
  });

  it('an UNATTRIBUTABLE notification is stamped with NO account, never a guess', async () => {
    // The other half of the same property. A notification whose account cannot
    // be resolved gets `user_id IS NULL` — writing anything else would attach a
    // stranger's payment to somebody, and erasing on a guess is as wrong as not
    // erasing at all. `unclaimed_payments` is where that case is recorded.
    const { send, db } = harness();
    const res = await send(subscriptionBody({ occurredAt: '2026-08-01T00:00:00.000Z', status: 'active', periodEnd: FUTURE }));
    expect(await res.json()).toMatchObject({ derived: 'unclaimed' });
    expect(db.rows('SELECT user_id FROM provider_notifications')[0].user_id).toBeNull();
  });

  it('A TAMPERED BODY IS REJECTED — 401, and NOTHING is written', async () => {
    // The signature is computed over the honest body; one byte of the body is
    // then changed. This is the assertion the whole rail rests on: without it,
    // anyone who finds the URL can grant themselves Pro.
    const { send, db } = harness();
    const honest = subscriptionBody({ occurredAt: '2026-08-01T00:00:00.000Z', status: 'active', periodEnd: FUTURE, userId: USER, appId: APP });
    const ts = Math.floor(Date.now() / 1000);
    const signature = await paddleSignature(SECRET, ts, honest);
    const tampered = honest.replace('"status":"active"', '"status":"trialing"');
    expect(tampered).not.toBe(honest);
    const res = await send(tampered, { ts, signature });
    expect(res.status).toBe(401);
    expect(db.count('provider_notifications')).toBe(0);
    expect(db.count('entitlements')).toBe(0);
  });

  it('a signature made with a DIFFERENT secret is rejected', async () => {
    const { send, db } = harness();
    const raw = subscriptionBody({ occurredAt: '2026-08-01T00:00:00.000Z', status: 'active', periodEnd: FUTURE, userId: USER, appId: APP });
    const ts = Math.floor(Date.now() / 1000);
    const signature = await paddleSignature(`${PADDLE_SECRET_PREFIX}wrong`, ts, raw);
    expect((await send(raw, { ts, signature })).status).toBe(401);
    expect(db.count('provider_notifications')).toBe(0);
  });

  it('NO configured secret FAILS CLOSED with 503, never an open door', async () => {
    const { send, db } = harness({ secret: undefined });
    const res = await send(subscriptionBody({ occurredAt: '2026-08-01T00:00:00.000Z', status: 'active', periodEnd: FUTURE }));
    expect(res.status).toBe(503);
    expect(db.count('provider_notifications')).toBe(0);
  });

  it('a missing Paddle-Signature header is 401', async () => {
    const { send } = harness();
    const res = await send(subscriptionBody({ occurredAt: '2026-08-01T00:00:00.000Z', status: 'active', periodEnd: FUTURE }), { header: '' });
    expect(res.status).toBe(401);
  });

  it('a malformed signature header is 400 and names the field', async () => {
    const { send } = harness();
    const res = await send(subscriptionBody({ occurredAt: '2026-08-01T00:00:00.000Z', status: 'active', periodEnd: FUTURE }), {
      header: 'ts=notanumber;h1=abc',
    });
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toMatch(/ts is not a unix-second integer/);
  });

  it('an h1 that is not a 64-char hex digest is 400, not a silent mismatch', async () => {
    const { send } = harness();
    const res = await send(subscriptionBody({ occurredAt: '2026-08-01T00:00:00.000Z', status: 'active', periodEnd: FUTURE }), {
      header: `ts=${Math.floor(Date.now() / 1000)};h1=deadbeef`,
    });
    expect(res.status).toBe(400);
  });

  it('a replayed notification outside the tolerance is rejected — BOTH directions', async () => {
    const { send } = harness();
    const raw = subscriptionBody({ occurredAt: '2026-08-01T00:00:00.000Z', status: 'active', periodEnd: FUTURE });
    const nowS = Math.floor(Date.now() / 1000);
    const stale = nowS - (PADDLE_REPLAY_TOLERANCE_SECONDS + 60);
    const future = nowS + (PADDLE_REPLAY_TOLERANCE_SECONDS + 60);
    // Each is signed CORRECTLY for its own timestamp — only the clock is wrong,
    // so this cannot pass by accident on a signature mismatch.
    expect((await send(raw, { ts: stale, signature: await paddleSignature(SECRET, stale, raw) })).status).toBe(401);
    expect((await send(raw, { ts: future, signature: await paddleSignature(SECRET, future, raw) })).status).toBe(401);
  });

  it('the signed payload is EXACTLY `${ts}:${rawBody}` with HMAC-SHA256, hex', async () => {
    // Pins the documented construction independently of the adapter, so a
    // round-trip through our own helper cannot certify a wrong recipe. Computed
    // here with the Web Crypto primitives directly.
    const raw = '{"a":1}';
    const ts = 1735689600;
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(SECRET),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${ts}:${raw}`));
    const hex = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
    expect(await paddleSignature(SECRET, ts, raw)).toBe(hex);
    expect(hex).toMatch(/^[0-9a-f]{64}$/);
  });

  it('an unknown provider is 404 — never an ack for a rail we do not run', async () => {
    const { send } = harness();
    const res = await send('{}', { provider: 'stripe' });
    expect(res.status).toBe(404);
  });

  it('the registry is not empty, and every registered rail names its own secret var', () => {
    // COVERAGE: "a test per registered provider" over an empty provider set is a
    // check that cannot fail. tooling/ci/assert-mor-adapters.mjs enforces the
    // same floor from the outside; this is the inside half.
    expect(MOR_VERIFIERS.length).toBeGreaterThanOrEqual(1);
    for (const v of MOR_VERIFIERS) {
      expect(v.provider).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(v.secretEnvVar).toMatch(/^[A-Z][A-Z0-9_]*$/);
      expect(verifierFor(v.provider)).toBe(v);
    }
  });
});

describe('[5]M-2 · verbatim, exactly once, before it is interpreted', () => {
  it('the payload is stored BYTE FOR BYTE, not re-serialised', async () => {
    // A re-serialised copy is a different byte string and can never be
    // re-verified against the signature that arrived with it.
    const { send, db } = harness();
    const raw = subscriptionBody({ occurredAt: '2026-08-01T00:00:00.000Z', status: 'active', periodEnd: FUTURE, userId: USER, appId: APP });
    await send(raw);
    const row = db.rows('SELECT payload, occurred_at, event_type FROM provider_notifications')[0];
    expect(row.payload).toBe(raw);
    expect(row.occurred_at).toBe('2026-08-01T00:00:00.000Z');
  });

  it('a REDELIVERY of the same event id stores ONE row and is still acked', async () => {
    const { send, db } = harness();
    const raw = subscriptionBody({ eventId: 'evt_dup', occurredAt: '2026-08-01T00:00:00.000Z', status: 'active', periodEnd: FUTURE, userId: USER, appId: APP });
    expect((await send(raw)).status).toBe(200);
    const second = await send(raw);
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ duplicate: true });
    expect(db.count('provider_notifications')).toBe(1);
  });

  it('🔴 AN OLDER EVENT ARRIVING AFTER A NEWER ONE CANNOT RE-GRANT ACCESS', async () => {
    // THE PRIMARY ASSERTION OF M-2, and the one dedup never touches: a refund at
    // T2 and a retried purchase from T1 < T2 are TWO DIFFERENT EVENT IDS. Both
    // are new, both are stored exactly once, and without an ordering comparison
    // the late one re-grants Pro to a refunded customer.
    const { send, db } = harness();
    const T1 = '2026-08-01T00:00:00.000Z';
    const T2 = '2026-08-02T00:00:00.000Z';

    // A grant at T1 establishes the account link and an active row.
    await send(subscriptionBody({ eventId: 'evt_grant_t1', occurredAt: T1, status: 'active', periodEnd: FUTURE, userId: USER, appId: APP }));
    expect(entRow(db).is_active).toBe(1);

    // A cancellation whose paid-through date has already passed, at T2.
    await send(subscriptionBody({ eventId: 'evt_cancel_t2', occurredAt: T2, status: 'canceled', periodEnd: PAST }));
    expect(entRow(db).is_active).toBe(0);
    expect(entRow(db).revocation_reason).toBe('cancelled_at_period_end');
    expect(entRow(db).last_event_id).toBe('evt_cancel_t2');

    // …and now the LATE RETRY of an older grant. It is a different event id, so
    // dedup lets it through; the row must NOT move.
    const late = await send(subscriptionBody({ eventId: 'evt_grant_t1_retry', occurredAt: T1, status: 'active', periodEnd: FUTURE, userId: USER, appId: APP }));
    expect(await late.json()).toMatchObject({ derived: 'stale' });
    expect(entRow(db).is_active).toBe(0);
    expect(entRow(db).revocation_reason).toBe('cancelled_at_period_end');
    // The row records WHICH event last wrote it, so "why is this row like this"
    // has one answer.
    expect(entRow(db).last_event_id).toBe('evt_cancel_t2');
    expect(entRow(db).occurred_at).toBe(T2);
    // All three notifications are on record, including the one that changed
    // nothing — "we received it and correctly ignored it" is a fact, not a gap.
    expect(db.count('provider_notifications')).toBe(3);
  });

  it('an event at the SAME instant does not re-write the row either', async () => {
    // Strictly-newer, not newer-or-equal: two deliveries sharing a timestamp have
    // no defined order, and picking the later arrival would make the outcome
    // depend on network jitter.
    const { send, db } = harness();
    const T = '2026-08-01T00:00:00.000Z';
    await send(subscriptionBody({ eventId: 'e1', occurredAt: T, status: 'canceled', periodEnd: PAST, userId: USER, appId: APP }));
    expect(entRow(db).is_active).toBe(0);
    const res = await send(subscriptionBody({ eventId: 'e2', occurredAt: T, status: 'active', periodEnd: FUTURE, userId: USER, appId: APP }));
    expect(await res.json()).toMatchObject({ derived: 'stale' });
    expect(entRow(db).is_active).toBe(0);
  });

  it('the record is written BEFORE derivation, and an unhandled entity still records', async () => {
    const { send, db } = harness();
    const raw = JSON.stringify({
      event_id: 'evt_product',
      notification_id: 'ntf_x',
      event_type: 'product.updated',
      occurred_at: '2026-08-01T00:00:00.000Z',
      data: { id: 'pro_1', name: 'a product, not a subscription' },
    });
    const res = await send(raw);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ recorded: true, derived: 'ignored' });
    const row = db.rows('SELECT payload, derived_at, derive_error FROM provider_notifications')[0];
    expect(row.payload).toBe(raw);
    // Ignoring is RECORDED, never silent.
    expect(String(row.derive_error)).toMatch(/no subscription or adjustment entity/);
    expect(row.derived_at).not.toBeNull();
    expect(db.count('entitlements')).toBe(0);
  });

  it('a body missing a required top-level field is 400 and stores NOTHING', async () => {
    const { send, db } = harness();
    for (const drop of ['event_id', 'event_type', 'occurred_at', 'data']) {
      const body = JSON.parse(subscriptionBody({ occurredAt: '2026-08-01T00:00:00.000Z', status: 'active', periodEnd: FUTURE }));
      delete body[drop];
      const res = await send(JSON.stringify(body));
      expect(res.status, `dropping ${drop}`).toBe(400);
    }
    expect(db.count('provider_notifications')).toBe(0);
  });

  it('an over-sized body is refused before it is parsed', async () => {
    const { send } = harness();
    const res = await send('x'.repeat(MAX_MONEY_BODY_BYTES + 1));
    expect(res.status).toBe(413);
  });
});

describe('[5]M-3 · the entitlement record is complete', () => {
  it('a grant writes provider, environment, ids, VERBATIM status, both dates and the event clock', async () => {
    const { send, db } = harness();
    await send(
      subscriptionBody({
        eventId: 'evt_full',
        occurredAt: '2026-08-01T00:00:00.000Z',
        status: 'trialing',
        periodEnd: FUTURE,
        trialEnd: '2026-08-31T00:00:00.000Z',
        userId: USER,
        appId: APP,
      }),
    );
    const row = entRow(db);
    expect(row).toMatchObject({
      user_id: USER,
      app_id: APP,
      entitlement: 'pro',
      is_active: 1,
      provider: 'paddle',
      provider_environment: 'live',
      provider_subscription_id: 'sub_0000000000000000000000001',
      // VERBATIM, not flattened to a boolean: 'trialing' is not representable as
      // is_active and cannot be un-flattened later.
      provider_status: 'trialing',
      last_event_id: 'evt_full',
      occurred_at: '2026-08-01T00:00:00.000Z',
      current_period_end: FUTURE,
      trial_end: '2026-08-31T00:00:00.000Z',
      revoked_at: null,
      revocation_reason: null,
    });
    // The legacy reader (services/subly-api/src/routes/entitlements.ts) knows only
    // is_active + expires_at. It must reach the same answer as the new columns.
    expect(row.expires_at).toBe(FUTURE);
  });

  it('every revocation reason the code can write is seeded in the database', () => {
    const db = realPlatformDb();
    const seeded = db.rows('SELECT reason, restores_access FROM revocation_reasons ORDER BY reason');
    const inCode = [...REVOCATION_REASONS].sort((a, b) => a.reason.localeCompare(b.reason));
    expect(seeded.map((r) => r.reason)).toEqual(inCode.map((r) => r.reason));
    expect(seeded.map((r) => r.restores_access === 1)).toEqual(inCode.map((r) => r.restores));
    // Exactly one member restores access, and it is the chargeback reversal —
    // nothing else in this rail gives access back.
    expect(inCode.filter((r) => r.restores).map((r) => r.reason)).toEqual(['chargeback_reversed']);
  });
});

describe('the money boundary FAILS CLOSED — undecidable ⇒ deny', () => {
  it('a cancel with NO paid-through date is REFUSED, not read as a lifetime grant', async () => {
    // The exact fail-open this session fixed on both ends: a missing/unreadable
    // end date spelled "no expiry", i.e. FOREVER. Here it must write nothing.
    const { send, db } = harness();
    await send(subscriptionBody({ eventId: 'g', occurredAt: '2026-08-01T00:00:00.000Z', status: 'active', periodEnd: FUTURE, userId: USER, appId: APP }));
    const before = entRow(db);
    const res = await send(subscriptionBody({ eventId: 'c', occurredAt: '2026-08-02T00:00:00.000Z', status: 'canceled', periodEnd: null }));
    expect(await res.json()).toMatchObject({ derived: 'refused' });
    // The stored row is UNCHANGED — the rail retries; it does not guess.
    expect(entRow(db)).toEqual(before);
    const note = db.rows("SELECT derive_error FROM provider_notifications WHERE provider_event_id = 'c'")[0];
    expect(String(note.derive_error)).toMatch(/no current_period_end/);
  });

  it('an UNREADABLE date is refused rather than normalised to null', async () => {
    const { send, db } = harness();
    const body = JSON.parse(subscriptionBody({ occurredAt: '2026-08-01T00:00:00.000Z', status: 'active', periodEnd: FUTURE, userId: USER, appId: APP }));
    body.data.current_billing_period.ends_at = 'the thirty-second of Octember';
    const res = await send(JSON.stringify(body));
    expect(res.status).toBe(400);
    expect(db.count('entitlements')).toBe(0);
  });

  it('a subscription status outside the documented set is refused LOUDLY, not silently ignored', async () => {
    // The entity is recognised by its `sub_` id, so an unknown status is a
    // subscription we cannot interpret — a 400 and a retry. Recognising the
    // entity by its STATUS VALUE instead (the first version of this adapter)
    // meant a status Paddle adds later would make the whole subscription
    // unrecognisable and the rail would keep a stale row in silence.
    const { send, db } = harness();
    const res = await send(subscriptionBody({ occurredAt: '2026-08-01T00:00:00.000Z', status: 'super_active', periodEnd: FUTURE, userId: USER, appId: APP }));
    expect(res.status).toBe(400);
    expect(db.count('entitlements')).toBe(0);
    expect(db.count('provider_notifications')).toBe(0);
  });

  it('an entity that is NOT a subscription and NOT an adjustment is ignored, not force-fitted', async () => {
    // A customer entity legitimately carries `status: 'active'`. Under the old
    // status-keyed rule it would have been parsed as a subscription.
    const { send, db } = harness();
    const raw = JSON.stringify({
      event_id: 'evt_customer',
      event_type: 'customer.updated',
      occurred_at: '2026-08-01T00:00:00.000Z',
      data: { id: 'ctm_0000000000000000000000001', status: 'active', email: 'x@example.com' },
    });
    const res = await send(raw);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ derived: 'ignored' });
    expect(db.count('entitlements')).toBe(0);
  });

  it("'canceled' with a FUTURE period end KEEPS access — cancel-at-period-end never revokes early", async () => {
    const { send, db } = harness();
    await send(subscriptionBody({ eventId: 'g', occurredAt: '2026-08-01T00:00:00.000Z', status: 'active', periodEnd: FUTURE, userId: USER, appId: APP }));
    await send(subscriptionBody({ eventId: 'c', occurredAt: '2026-08-02T00:00:00.000Z', status: 'canceled', periodEnd: FUTURE }));
    expect(entRow(db).is_active).toBe(1);
    expect(entRow(db).provider_status).toBe('canceled');
    expect(entRow(db).revoked_at).toBeNull();
  });

  it("'past_due' keeps access to the paid-through date, then lapses as payment_failed_final", async () => {
    const { send, db } = harness();
    await send(subscriptionBody({ eventId: 'g', occurredAt: '2026-08-01T00:00:00.000Z', status: 'active', periodEnd: FUTURE, userId: USER, appId: APP }));
    await send(subscriptionBody({ eventId: 'p1', occurredAt: '2026-08-02T00:00:00.000Z', status: 'past_due', periodEnd: FUTURE }));
    expect(entRow(db).is_active).toBe(1);
    await send(subscriptionBody({ eventId: 'p2', occurredAt: '2026-08-03T00:00:00.000Z', status: 'past_due', periodEnd: PAST }));
    expect(entRow(db).is_active).toBe(0);
    // "Dunning is cut (stage 13)" must never be read as "a lapsed subscriber
    // keeps Pro" — the entitlement consequence is THIS stage's.
    expect(entRow(db).revocation_reason).toBe('payment_failed_final');
  });

  it("'paused' suspends access now and records why", async () => {
    const { send, db } = harness();
    await send(subscriptionBody({ eventId: 'g', occurredAt: '2026-08-01T00:00:00.000Z', status: 'active', periodEnd: FUTURE, userId: USER, appId: APP }));
    await send(subscriptionBody({ eventId: 'pz', occurredAt: '2026-08-02T00:00:00.000Z', status: 'paused', periodEnd: null }));
    expect(entRow(db).is_active).toBe(0);
    expect(entRow(db).revocation_reason).toBe('subscription_paused');
  });
});

describe('refunds, chargebacks and the one path that gives access back', () => {
  const grant = (send: ReturnType<typeof harness>['send']) =>
    send(subscriptionBody({ eventId: 'g', occurredAt: '2026-08-01T00:00:00.000Z', status: 'active', periodEnd: FUTURE, userId: USER, appId: APP }));

  it('an APPROVED refund revokes NOW, not at the period end', async () => {
    const { send, db } = harness();
    await grant(send);
    await send(adjustmentBody({ eventId: 'r', occurredAt: '2026-08-02T00:00:00.000Z', action: 'refund' }));
    expect(entRow(db).is_active).toBe(0);
    expect(entRow(db).revocation_reason).toBe('refund_approved');
    expect(entRow(db).revoked_at).not.toBeNull();
  });

  it('a PENDING refund changes nothing — a request that may still be rejected', async () => {
    const { send, db } = harness();
    await grant(send);
    const res = await send(adjustmentBody({ eventId: 'r', occurredAt: '2026-08-02T00:00:00.000Z', action: 'refund', status: 'pending_approval' }));
    expect(await res.json()).toMatchObject({ derived: 'refused' });
    expect(entRow(db).is_active).toBe(1);
  });

  it('a chargeback WARNING moves no access — locking a customer pre-emptively is our own incident', async () => {
    const { send, db } = harness();
    await grant(send);
    const res = await send(adjustmentBody({ eventId: 'w', occurredAt: '2026-08-02T00:00:00.000Z', action: 'chargeback_warning' }));
    expect(await res.json()).toMatchObject({ derived: 'ignored' });
    expect(entRow(db).is_active).toBe(1);
  });

  it('a REVERSED chargeback RESTORES access — the only path in this rail that does', async () => {
    const { send, db } = harness();
    await grant(send);
    await send(adjustmentBody({ eventId: 'cb', occurredAt: '2026-08-02T00:00:00.000Z', action: 'chargeback' }));
    expect(entRow(db).is_active).toBe(0);
    expect(entRow(db).revocation_reason).toBe('chargeback');
    await send(adjustmentBody({ eventId: 'cbr', occurredAt: '2026-08-03T00:00:00.000Z', action: 'chargeback_reverse' }));
    expect(entRow(db).is_active).toBe(1);
    expect(entRow(db).revocation_reason).toBe('chargeback_reversed');
    expect(entRow(db).revoked_at).toBeNull();
    // It restores to the period the row already had. It does NOT invent a new
    // paid-through date, which would be granting access on an arithmetic guess.
    expect(entRow(db).current_period_end).toBe(FUTURE);
  });

  it('an adjustment for an account with no entitlement row is REFUSED, not written from nowhere', async () => {
    const { send, db } = harness();
    // Link the subscription without ever granting: a refund then arrives first.
    db.db.exec(
      "INSERT INTO provider_accounts (provider, provider_subscription_id, app_id, user_id, linked_at) " +
        "VALUES ('paddle','sub_0000000000000000000000001','subly','user-abc','2026-08-01T00:00:00.000Z')",
    );
    const res = await send(adjustmentBody({ eventId: 'r', occurredAt: '2026-08-02T00:00:00.000Z', action: 'refund' }));
    expect(await res.json()).toMatchObject({ derived: 'refused' });
    expect(db.count('entitlements')).toBe(0);
  });
});

describe('[5]M-7 · attributable, or resolvably unclaimed', () => {
  it('THE POSITIVE PATH: an in-app checkout carries the account id, and the link is written down', async () => {
    const { send, db } = harness();
    await send(subscriptionBody({ eventId: 'g', occurredAt: '2026-08-01T00:00:00.000Z', status: 'active', periodEnd: FUTURE, userId: USER, appId: APP }));
    const link = db.rows('SELECT * FROM provider_accounts')[0];
    expect(link).toMatchObject({
      provider: 'paddle',
      provider_subscription_id: 'sub_0000000000000000000000001',
      user_id: USER,
      app_id: APP,
      linked_from_event_id: 'g',
    });
    expect(db.count('unclaimed_payments')).toBe(0);
  });

  it('🔴 A RENEWAL WITH NO METADATA RESOLVES TO THE SAME ACCOUNT', async () => {
    // Whether checkout metadata propagates onto renewals is a vendor fact this
    // repo could NOT establish (paddle.ts, U3). The written link is why the
    // answer does not matter: the renewal below carries no custom_data at all.
    const { send, db } = harness();
    await send(subscriptionBody({ eventId: 'g', occurredAt: '2026-08-01T00:00:00.000Z', status: 'active', periodEnd: '2026-09-01T00:00:00.000Z', userId: USER, appId: APP }));
    const renewal = await send(subscriptionBody({ eventId: 'renew', occurredAt: '2026-09-01T00:00:00.000Z', status: 'active', periodEnd: FUTURE }));
    expect(await renewal.json()).toMatchObject({ derived: 'applied' });
    expect(entRow(db).current_period_end).toBe(FUTURE);
    expect(db.count('unclaimed_payments')).toBe(0);
  });

  it('a payment nobody can be found for is KEPT, never acked and discarded', async () => {
    const { send, db } = harness();
    const res = await send(
      subscriptionBody({ eventId: 'orphan', occurredAt: '2026-08-01T00:00:00.000Z', status: 'active', periodEnd: FUTURE, customerEmail: 'Buyer@Example.COM' }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ derived: 'unclaimed' });
    const row = db.rows('SELECT * FROM unclaimed_payments')[0];
    expect(row).toMatchObject({ provider: 'paddle', provider_event_id: 'orphan', environment: 'live', claimed_at: null });
    // The email is a SHA-256 of the lowercased address, not the address.
    expect(String(row.customer_email_hash)).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(row)).not.toMatch(/Buyer@Example/i);
    expect(db.count('entitlements')).toBe(0);
  });

  it('a later notification carrying DIFFERENT metadata cannot move a live subscription to another account', async () => {
    const { send, db } = harness();
    await send(subscriptionBody({ eventId: 'g', occurredAt: '2026-08-01T00:00:00.000Z', status: 'active', periodEnd: FUTURE, userId: USER, appId: APP }));
    await send(subscriptionBody({ eventId: 'g2', occurredAt: '2026-08-02T00:00:00.000Z', status: 'active', periodEnd: FUTURE, userId: 'attacker', appId: APP }));
    expect(db.count('provider_accounts')).toBe(1);
    expect(db.rows('SELECT user_id FROM provider_accounts')[0].user_id).toBe(USER);
    expect(db.count('entitlements', 'user_id = ?', 'attacker')).toBe(0);
  });
});

describe('[5]M-12 · sandbox money cannot grant a production unlock', () => {
  it('an absent MONEY_ENVIRONMENT FAILS CLOSED with 503 — no default in either direction', async () => {
    const { send, db } = harness({ environment: undefined });
    const res = await send(subscriptionBody({ occurredAt: '2026-08-01T00:00:00.000Z', status: 'active', periodEnd: FUTURE, userId: USER, appId: APP }));
    expect(res.status).toBe(503);
    expect(db.count('provider_notifications')).toBe(0);
  });

  it('an unrecognised MONEY_ENVIRONMENT is 503, not coerced to live', async () => {
    const { send } = harness({ environment: 'production' });
    const res = await send(subscriptionBody({ occurredAt: '2026-08-01T00:00:00.000Z', status: 'active', periodEnd: FUTURE, userId: USER, appId: APP }));
    expect(res.status).toBe(503);
  });

  it('a sandbox deploy STAMPS the row sandbox, so a live reader can tell them apart', async () => {
    const { send, db } = harness({ environment: 'sandbox' });
    await send(subscriptionBody({ occurredAt: '2026-08-01T00:00:00.000Z', status: 'active', periodEnd: FUTURE, userId: USER, appId: APP }));
    expect(entRow(db).provider_environment).toBe('sandbox');
    expect(db.rows('SELECT environment FROM provider_notifications')[0].environment).toBe('sandbox');
  });
});

describe('the route is bounded and does not leak', () => {
  it('the server-derived ceiling sheds BEFORE the body is read', async () => {
    const { send, db, ceiling } = harness({ allowCeiling: false });
    const res = await send(subscriptionBody({ occurredAt: '2026-08-01T00:00:00.000Z', status: 'active', periodEnd: FUTURE }));
    expect(res.status).toBe(429);
    expect(db.count('provider_notifications')).toBe(0);
    // Keyed on values from `request.cf`, which the caller cannot choose.
    expect(ceiling.keys[0]).toMatch(/^edge:/);
  });

  it('a refusal never echoes the configured secret', async () => {
    const { send } = harness();
    const res = await send('not json at all', { header: 'ts=1;h1=zz' });
    const text = await res.text();
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain(PADDLE_SECRET_PREFIX);
  });

  it('the adapter refuses a body that is not JSON at all', () => {
    const out = paddleVerifier.parse('<html>gateway error</html>');
    expect(out.ok).toBe(false);
  });
});
