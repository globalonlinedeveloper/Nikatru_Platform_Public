import { describe, it, expect } from 'vitest';
import {
  revenuecatVerifier,
  revenueCatSignature,
  parseRevenueCatSignatureHeader,
  REVENUECAT_REPLAY_TOLERANCE_SECONDS,
  makeRevenuecatVerifier,
} from '../src/lib/mor/revenuecat';
import { decideSubscription } from '../src/lib/mor/contract';
import { verifierFor, MOR_VERIFIERS } from '../src/lib/mor/registry';
// Side-effect import: the harness installs `crypto.subtle.timingSafeEqual`, the
// Workers extension Node's WebCrypto lacks — without it a refusal and a crash
// print the same red (razorpay-verifier.test.ts says why at length).
import './harness';

// ─────────────────────────────────────────────────────────────────────────────
// revenuecat-verifier.test.ts — the store rails' webhook check on the one door
// (O-REVENUECAT-VERIFIER).
//
// 🔴 THE VECTORS ARE COMPUTED HERE, NOT TAKEN FROM THE SUBJECT: every positive
// case builds its digest with an INDEPENDENT WebCrypto call in this file, so the
// adapter and this file must agree on algorithm, key, message and encoding.
//
// Pinned, from revenuecat.com/docs/integrations/webhooks (read 2026-09-15):
// `X-RevenueCat-Webhook-Signature: t=<unix_timestamp>,v1=<hmac_sha256_hex>`,
// HMAC-SHA256 over `"<timestamp>.<raw_json_body>"` with the signing secret, `t` in
// unix seconds, and a replay tolerance of the vendor's own example, 5 minutes.
// ─────────────────────────────────────────────────────────────────────────────

const SECRET = 'rc_signing_secret_for_tests';
const BODY = '{"api_version":"1.0","event":{"id":"evt_1","type":"RENEWAL","event_timestamp_ms":1757900000000}}';
const NOW_MS = 1_757_900_000_000;
const T = Math.floor(NOW_MS / 1000);

/** The digest, computed independently of the subject. */
async function hmacHex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const headersWith = (value: string) => new Headers({ 'X-RevenueCat-Webhook-Signature': value });
const signed = async (t = T, body = BODY, secret = SECRET) => headersWith(`t=${t},v1=${await hmacHex(secret, `${t}.${body}`)}`);

describe('revenuecat verify — the signature scheme, from the primary source', () => {
  it('accepts a digest over `${t}.${rawBody}` with the signing secret as the key', async () => {
    expect(await revenuecatVerifier.verify(BODY, await signed(), SECRET, NOW_MS)).toEqual({ ok: true });
  });

  it('the adapter and an independent HMAC agree, digit for digit', async () => {
    expect(await revenueCatSignature(SECRET, T, BODY)).toBe(await hmacHex(SECRET, `${T}.${BODY}`));
  });

  // 🔴 THE SEPARATOR IS A DOT. Paddle signs `${ts}:${body}`; copying that here would
  // reject every genuine RevenueCat delivery in production.
  it("refuses a digest computed the Paddle way, over `t:body`", async () => {
    const wrong = headersWith(`t=${T},v1=${await hmacHex(SECRET, `${T}:${BODY}`)}`);
    expect(await revenuecatVerifier.verify(BODY, wrong, SECRET, NOW_MS)).toEqual({
      ok: false,
      status: 401,
      reason: 'signature does not match',
    });
  });

  it('refuses a digest over the body alone — the timestamp is part of what is signed', async () => {
    const wrong = headersWith(`t=${T},v1=${await hmacHex(SECRET, BODY)}`);
    expect(await revenuecatVerifier.verify(BODY, wrong, SECRET, NOW_MS)).toMatchObject({ ok: false, status: 401 });
  });

  it('refuses a body altered by one character', async () => {
    const tampered = BODY.replace('RENEWAL', 'RENEWAM');
    expect(await revenuecatVerifier.verify(tampered, await signed(), SECRET, NOW_MS)).toMatchObject({
      ok: false,
      status: 401,
    });
  });

  it('refuses a signed timestamp swapped for another — t is inside the digest', async () => {
    const sig = await hmacHex(SECRET, `${T}.${BODY}`);
    const moved = headersWith(`t=${T + 1},v1=${sig}`);
    expect(await revenuecatVerifier.verify(BODY, moved, SECRET, NOW_MS)).toMatchObject({ ok: false, status: 401 });
  });

  it('refuses a digest made with a different secret', async () => {
    expect(await revenuecatVerifier.verify(BODY, await signed(T, BODY, 'someone_elses'), SECRET, NOW_MS)).toMatchObject({
      ok: false,
      status: 401,
    });
  });

  it('accepts the fields in either order, and upper-case hex', async () => {
    const sig = (await hmacHex(SECRET, `${T}.${BODY}`)).toUpperCase();
    expect(await revenuecatVerifier.verify(BODY, headersWith(`v1=${sig},t=${T}`), SECRET, NOW_MS)).toEqual({ ok: true });
  });
});

describe('revenuecat verify — the replay window, the vendor\'s own five minutes, both directions', () => {
  it('is 300 seconds', () => {
    expect(REVENUECAT_REPLAY_TOLERANCE_SECONDS).toBe(300);
  });

  it('accepts a delivery exactly at the edge of the window, early or late', async () => {
    const edge = REVENUECAT_REPLAY_TOLERANCE_SECONDS;
    expect(await revenuecatVerifier.verify(BODY, await signed(T - edge), SECRET, NOW_MS)).toEqual({ ok: true });
    expect(await revenuecatVerifier.verify(BODY, await signed(T + edge), SECRET, NOW_MS)).toEqual({ ok: true });
  });

  it('refuses one second past it, in the past AND in the future, before spending a digest', async () => {
    const past = T - REVENUECAT_REPLAY_TOLERANCE_SECONDS - 1;
    const future = T + REVENUECAT_REPLAY_TOLERANCE_SECONDS + 1;
    const a = await revenuecatVerifier.verify(BODY, await signed(past), SECRET, NOW_MS);
    const b = await revenuecatVerifier.verify(BODY, await signed(future), SECRET, NOW_MS);
    expect(a).toMatchObject({ ok: false, status: 401 });
    expect(b).toMatchObject({ ok: false, status: 401 });
    if (!a.ok) expect(a.reason).toMatch(/outside the 300s tolerance/);
  });

  it('reads t as SECONDS — the same t against a millisecond clock of that instant is fresh', async () => {
    expect(await revenuecatVerifier.verify(BODY, await signed(T), SECRET, T * 1000 + 999)).toEqual({ ok: true });
  });
});

describe('revenuecat verify — the three refusals stay distinct', () => {
  it('503 when the seam is not configured, never 401', async () => {
    expect(await revenuecatVerifier.verify(BODY, await signed(), '', NOW_MS)).toEqual({
      ok: false,
      status: 503,
      reason: 'no destination secret configured',
    });
  });

  it('401 when the header is absent — a caller that signed nothing', async () => {
    expect(await revenuecatVerifier.verify(BODY, new Headers(), SECRET, NOW_MS)).toMatchObject({ ok: false, status: 401 });
  });

  it('401 for a bearer-style Authorization header alone — that is not the signature', async () => {
    const h = new Headers({ Authorization: `Bearer ${SECRET}` });
    expect(await revenuecatVerifier.verify(BODY, h, SECRET, NOW_MS)).toMatchObject({ ok: false, status: 401 });
  });

  for (const [what, header] of [
    ['missing t', `v1=${'a'.repeat(64)}`],
    ['missing v1', `t=${T}`],
    ['t not an integer', `t=12.5,v1=${'a'.repeat(64)}`],
    ['v1 not hex', `t=${T},v1=${'z'.repeat(64)}`],
    ['v1 too short', `t=${T},v1=abc123`],
    ['Paddle-shaped (; separated)', `t=${T};v1=${'a'.repeat(64)}`],
    ['implausibly long', `t=${T},v1=${'a'.repeat(600)}`],
  ] as const) {
    it(`400 when the header is ${what} — malformed is not the same as wrong`, async () => {
      expect(await revenuecatVerifier.verify(BODY, headersWith(header), SECRET, NOW_MS)).toMatchObject({
        ok: false,
        status: 400,
      });
    });
  }

  it('the header parser ignores an unknown field, so a future v2 does not break v1', () => {
    const r = parseRevenueCatSignatureHeader(`t=${T},v2=whatever,v1=${'b'.repeat(64)}`);
    expect(r).toEqual({ ok: true, t: T, v1: 'b'.repeat(64) });
  });
});

// ⏱ 2026-09-15 · [ADR 085]. The block that stood here was 'revenuecat parse —
// refuses rather than guesses' and pinned the four undecided facts in the refusal
// text. The owner decided them; the cases below pin each decision instead.
// Event bodies follow revenuecat.com/docs/integrations/webhooks/event-types-and-fields
// (read 2026-09-15): `api_version` at the root, every other field under `event`.
const RC_APP = 'app_rc_test_android';
const ROUTES = { [RC_APP]: 'subscriptiontracker' } as const;
const routed = makeRevenuecatVerifier(ROUTES);
const USER = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';

function rcEvent(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    api_version: '1.0',
    event: {
      id: 'evt_rc_1',
      type: 'INITIAL_PURCHASE',
      event_timestamp_ms: NOW_MS,
      app_id: RC_APP,
      app_user_id: USER,
      original_app_user_id: '$RCAnonymousID:abc',
      environment: 'PRODUCTION',
      original_transaction_id: 'otx_1',
      transaction_id: 'tx_1',
      expiration_at_ms: NOW_MS + 30 * 86_400_000,
      period_type: 'NORMAL',
      ...over,
    },
  });
}

function subjectOf(raw: string, v = routed) {
  const r = v.parse(raw);
  if (!r.ok) throw new Error(`parse failed: ${r.reason}`);
  return r.notification.subject;
}

describe('revenuecat parse — a body that is not a RevenueCat event is a 400', () => {
  it('refuses a non-JSON body', () => {
    expect(routed.parse('').ok).toBe(false);
  });

  it('refuses a body with no `event` object', () => {
    expect(routed.parse('{"api_version":"1.0"}').ok).toBe(false);
  });

  it('refuses an event with no millisecond `event_timestamp_ms`', () => {
    expect(routed.parse(rcEvent({ event_timestamp_ms: 'yesterday' })).ok).toBe(false);
  });

  it('reads `id` as the event id and `event_timestamp_ms` as the ordering clock', () => {
    const r = routed.parse(rcEvent());
    expect(r.ok && r.notification.eventId).toBe('evt_rc_1');
    expect(r.ok && r.notification.occurredAt).toBe(new Date(NOW_MS).toISOString());
  });

  it('a TEST event is acknowledged and attributed to nobody', () => {
    expect(subjectOf(rcEvent({ type: 'TEST', app_id: 'app_nobody' })).kind).toBe('unknown');
  });
});

describe('revenuecat parse — A · an event is routed by the app id an app declares', () => {
  it('an app id no app declares is REFUSED, not guessed, and says so', () => {
    const s = subjectOf(rcEvent({ app_id: 'app_undeclared' }));
    expect(s.kind).toBe('refused');
    expect(s.kind === 'refused' && s.detail).toMatch(/declared by no NIKATRU app.*ADR 085 A/);
  });

  it('a declared id routes to that NIKATRU app', () => {
    const s = subjectOf(rcEvent());
    expect(s.kind === 'subscription' && s.accountAppId).toBe('subscriptiontracker');
  });

  it('THE REGISTERED VERIFIER SHIPS REFUSING ON A: no app declares a RevenueCat id yet', () => {
    // The rendered table is empty (tooling/app-yaml/render.mjs), so a fully valid
    // event is refused. This case goes red the day an app declares one — which is
    // the day it should be rewritten, not deleted.
    expect(subjectOf(rcEvent(), revenuecatVerifier).kind).toBe('refused');
  });
});

describe('revenuecat parse — B · the app user id IS the NIKATRU user id', () => {
  it('a logged-in event names the account by app_user_id and links by original_transaction_id', () => {
    const s = subjectOf(rcEvent());
    expect(s.kind).toBe('subscription');
    if (s.kind !== 'subscription') return;
    expect(s.accountUserId).toBe(USER);
    expect(s.subscriptionId).toBe('otx_1');
    expect(s.access).toBe('granted');
  });

  it('an anonymous app_user_id is REFUSED until the purchase is attached to a logged-in user', () => {
    const s = subjectOf(rcEvent({ app_user_id: '$RCAnonymousID:9f8e7d' }));
    expect(s.kind).toBe('refused');
    expect(s.kind === 'refused' && s.detail).toMatch(/anonymous.*ADR 085 B/);
  });

  it('an event with no original_transaction_id is refused — later events could not be linked', () => {
    expect(subjectOf(rcEvent({ original_transaction_id: undefined })).kind).toBe('refused');
  });
});

describe('revenuecat parse — C · a CANCELLATION is read refund-first', () => {
  it('cancel_reason CUSTOMER_SUPPORT is a refund: revoked NOW as refund_approved', () => {
    const s = subjectOf(rcEvent({ type: 'CANCELLATION', cancel_reason: 'CUSTOMER_SUPPORT' }));
    expect(s.kind === 'subscription' && [s.access, s.endsWithReason]).toEqual(['suspended', 'refund_approved']);
    if (s.kind !== 'subscription') return;
    const d = decideSubscription(s, NOW_MS);
    expect(d.ok && [d.decision.isActive, d.decision.revocationReason]).toEqual([0, 'refund_approved']);
  });

  it('a stated non-refund reason (UNSUBSCRIBE) keeps access to the period end', () => {
    const s = subjectOf(rcEvent({ type: 'CANCELLATION', cancel_reason: 'UNSUBSCRIBE' }));
    expect(s.kind === 'subscription' && [s.access, s.endsWithReason]).toEqual(['until_end', 'cancelled_at_period_end']);
    if (s.kind !== 'subscription') return;
    const d = decideSubscription(s, NOW_MS);
    expect(d.ok && d.decision.isActive).toBe(1);
  });

  it('NO reason and a PAST expiration: the date is the fallback, refund_approved now', () => {
    const s = subjectOf(rcEvent({ type: 'CANCELLATION', expiration_at_ms: NOW_MS - 86_400_000 }));
    if (s.kind !== 'subscription') throw new Error(s.kind);
    const d = decideSubscription(s, NOW_MS);
    expect(d.ok && [d.decision.isActive, d.decision.revocationReason]).toEqual([0, 'refund_approved']);
  });

  it('cancel_reason UNKNOWN and a FUTURE expiration: access stands to that date', () => {
    const s = subjectOf(rcEvent({ type: 'CANCELLATION', cancel_reason: 'UNKNOWN' }));
    if (s.kind !== 'subscription') throw new Error(s.kind);
    const d = decideSubscription(s, NOW_MS);
    expect(d.ok && [d.decision.isActive, d.decision.revocationReason]).toEqual([1, null]);
  });
});

describe('revenuecat parse — D · a lapsed BILLING_ISSUE is payment_failed_final', () => {
  it('while the paid-through date is ahead, access stands', () => {
    const s = subjectOf(rcEvent({ type: 'BILLING_ISSUE' }));
    if (s.kind !== 'subscription') throw new Error(s.kind);
    const d = decideSubscription(s, NOW_MS);
    expect(d.ok && d.decision.isActive).toBe(1);
  });

  it('once the paid-through date is past, access ends as payment_failed_final — not a 503 loop', () => {
    const s = subjectOf(
      rcEvent({ type: 'BILLING_ISSUE', expiration_at_ms: NOW_MS - 1000, grace_period_expiration_at_ms: NOW_MS + 86_400_000 }),
    );
    if (s.kind !== 'subscription') throw new Error(s.kind);
    const d = decideSubscription(s, NOW_MS);
    expect(d.ok && [d.decision.isActive, d.decision.revocationReason]).toEqual([0, 'payment_failed_final']);
  });
});

describe('revenuecat parse — what else the table decides, and what it does not', () => {
  it('SUBSCRIPTION_PAUSED changes no access: acknowledged, not attributed', () => {
    expect(subjectOf(rcEvent({ type: 'SUBSCRIPTION_PAUSED' })).kind).toBe('unknown');
  });

  it('an event type outside the contract table (TRANSFER) is REFUSED, not ignored', () => {
    expect(subjectOf(rcEvent({ type: 'TRANSFER' })).kind).toBe('refused');
  });

  it('EXPIRATION with expiration_reason SUBSCRIPTION_PAUSED revokes as subscription_paused', () => {
    const s = subjectOf(rcEvent({ type: 'EXPIRATION', expiration_reason: 'SUBSCRIPTION_PAUSED' }));
    expect(s.kind === 'subscription' && [s.access, s.endsWithReason]).toEqual(['suspended', 'subscription_paused']);
  });

  it('a TRIAL period is trialing, with the trial end recorded', () => {
    const s = subjectOf(rcEvent({ period_type: 'TRIAL' }));
    expect(s.kind === 'subscription' && [s.access, s.trialEnd !== null]).toEqual(['trialing', true]);
  });

  it('environment SANDBOX is carried as the sandbox world; any other value is refused', () => {
    const s = subjectOf(rcEvent({ environment: 'SANDBOX' }));
    expect(s.kind === 'subscription' && s.railEnvironment).toBe('sandbox');
    expect(subjectOf(rcEvent({ environment: 'STAGING' })).kind).toBe('refused');
  });
});

describe('revenuecat in the registry', () => {
  it('is reachable by its provider id — the same `revenuecat` the legacy writer stamps — and names its own secret', () => {
    const v = verifierFor('revenuecat');
    expect(v).not.toBeNull();
    expect(v?.provider).toBe('revenuecat');
    expect(v?.secretEnvVar).toBe('REVENUECAT_WEBHOOK_SIGNING_SECRET');
  });

  it('joins the other rails rather than replacing one', () => {
    const providers = MOR_VERIFIERS.map((v) => v.provider);
    expect(providers).toEqual(expect.arrayContaining(['paddle', 'razorpay', 'revenuecat']));
  });

  it('its secret is NOT the legacy bearer variable — the signing secret is a different value by the vendor\'s account', () => {
    expect(verifierFor('revenuecat')?.secretEnvVar).not.toBe('REVENUECAT_WEBHOOK_SECRET');
  });
});
