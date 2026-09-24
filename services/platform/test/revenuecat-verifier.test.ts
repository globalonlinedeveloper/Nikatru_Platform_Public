import { describe, it, expect } from 'vitest';
import {
  revenuecatVerifier,
  revenueCatSignature,
  parseRevenueCatSignatureHeader,
  REVENUECAT_REPLAY_TOLERANCE_SECONDS,
  makeRevenuecatVerifier,
} from '../src/lib/mor/revenuecat';
import { decideSubscription } from '../src/lib/mor/contract';
import {
  REVENUECAT_EVENT_REASONS,
  revenueCatAccessRuling,
  revenueCatAccessRulingForRow,
} from '../../../contracts/entitlement/contract.js';
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

  // ⏱ 2026-09-24 — the case that stood here was 'THE REGISTERED VERIFIER SHIPS
  // REFUSING ON A: no app declares a RevenueCat id yet', and it asked to be
  // rewritten, not deleted, the day an app declared one. That day was #890
  // (35da94b2): apps/subscriptiontracker/app.yaml billing.mobileIap.revenuecatAppIds
  // declares both store apps, and tooling/app-yaml/render.mjs renders them into
  // revenuecat-app-ids.ts. The old case stayed green only because rcEvent()
  // defaults to the fixture RC_APP, which the rendered table does not hold.
  //
  // ⏱ 2026-09-24 · F912 (the #912 review, finding 1). The three cases below took
  // the IMPORTED `revenuecatVerifier`, so a registry that registered some other
  // instance kept them green while the route served that other instance. They now
  // take the verifier the route takes (routes/money.ts calls verifierFor), and the
  // first case pins that the registry serves the imported one.
  it('the registry serves the REGISTERED verifier itself — the instance the route looks up', () => {
    expect(verifierFor('revenuecat')).toBe(revenuecatVerifier);
  });

  it('the REGISTERED verifier routes the Play app id appa553a1e2c6 to subscriptiontracker', () => {
    const s = subjectOf(rcEvent({ app_id: 'appa553a1e2c6' }), verifierFor('revenuecat')!);
    expect(s.kind).toBe('subscription');
    expect(s.kind === 'subscription' && s.accountAppId).toBe('subscriptiontracker');
  });

  it('the REGISTERED verifier routes the App Store app id app805d73cd44 to subscriptiontracker', () => {
    const s = subjectOf(rcEvent({ app_id: 'app805d73cd44' }), verifierFor('revenuecat')!);
    expect(s.kind).toBe('subscription');
    expect(s.kind === 'subscription' && s.accountAppId).toBe('subscriptiontracker');
  });

  it('the REGISTERED verifier still refuses an app id no app declares', () => {
    const s = subjectOf(rcEvent({ app_id: 'app_undeclared' }), verifierFor('revenuecat')!);
    expect(s.kind).toBe('refused');
  });
});

// ⏱ 2026-09-24 · F912 — [ADR 085] A, append 2026-09-24. A row whose
// `notAGrant` is true is acknowledged BEFORE routing step A, the way TEST is: it
// writes nothing, so routing it could change no entitlement, and refusing it only
// cost five vendor retries and a false count in the nightly refused total. The
// reference says EXPERIMENT_ENROLLMENT "isn't associated with a store" and that
// `app_id` "is usually excluded", so it is the case that forces the order. Every
// case here goes through the REGISTERED verifier, as the route does.
describe('revenuecat parse — M2 · a not-a-grant row is acknowledged before A', () => {
  it('EXPERIMENT_ENROLLMENT with NO app_id is acknowledged, not refused on A', () => {
    const s = subjectOf(rcEvent({ type: 'EXPERIMENT_ENROLLMENT', app_id: undefined }), verifierFor('revenuecat')!);
    expect(s.kind).toBe('unknown');
    expect(s.kind === 'unknown' && s.detail).toMatch(/acknowledged before routing, \[ADR 085\] A append 2026-09-24/);
  });

  it('EXPERIMENT_ENROLLMENT with the declared Play app id appa553a1e2c6 is acknowledged', () => {
    const s = subjectOf(rcEvent({ type: 'EXPERIMENT_ENROLLMENT', app_id: 'appa553a1e2c6' }), verifierFor('revenuecat')!);
    expect(s.kind).toBe('unknown');
  });

  it('EXPERIMENT_ENROLLMENT with an app id no app declares is acknowledged, not refused on A', () => {
    const s = subjectOf(rcEvent({ type: 'EXPERIMENT_ENROLLMENT', app_id: 'app_undeclared' }), verifierFor('revenuecat')!);
    expect(s.kind).toBe('unknown');
  });

  it('control: INITIAL_PURCHASE with NO app_id is still refused on A — a grant is never routed by guess', () => {
    const s = subjectOf(rcEvent({ app_id: undefined }), verifierFor('revenuecat')!);
    expect(s.kind).toBe('refused');
    expect(s.kind === 'refused' && s.detail).toMatch(/carries no `app_id`.*ADR 085 A/);
  });

  it('control: TRANSFER with NO app_id is still refused on A', () => {
    const s = subjectOf(rcTransfer({ app_id: undefined }), verifierFor('revenuecat')!);
    expect(s.kind).toBe('refused');
    expect(s.kind === 'refused' && s.detail).toMatch(/carries no `app_id`.*ADR 085 A/);
  });

  it('control: REFUND_REVERSED is still refused by name, and with NO app_id still refused on A', () => {
    const named = subjectOf(rcEvent({ type: 'REFUND_REVERSED', app_id: 'app805d73cd44' }), verifierFor('revenuecat')!);
    expect(named.kind === 'refused' && named.detail).toMatch(/^revenuecat REFUND_REVERSED: refund_reversed_undecided:/);
    const bare = subjectOf(rcEvent({ type: 'REFUND_REVERSED', app_id: undefined }), verifierFor('revenuecat')!);
    expect(bare.kind).toBe('refused');
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

  it('an event type outside the contract table is REFUSED, not ignored', () => {
    expect(subjectOf(rcEvent({ type: 'SOME_FUTURE_EVENT' })).kind).toBe('refused');
  });

  it('the seven vendor types that change no access are acknowledged by name, not refused', () => {
    // O-REVENUECAT-ACCOUNT step 6, 2026-09-24: each is a contract row in NOT_A_GRANT,
    // and each row's `why` quotes the vendor. Before it, each drew a 503 and five retries.
    // ⏱ 2026-09-24 · F912: that Set is now each row's `notAGrant: true` (pinned below).
    expect(revenueCatAccessRuling('INVOICE_ISSUANCE')).toBeNull();
    expect(subjectOf(rcEvent({ type: 'INVOICE_ISSUANCE' })).kind).toBe('unknown');
    expect(revenueCatAccessRuling('VIRTUAL_CURRENCY_TRANSACTION')).toBeNull();
    expect(subjectOf(rcEvent({ type: 'VIRTUAL_CURRENCY_TRANSACTION' })).kind).toBe('unknown');
    expect(revenueCatAccessRuling('EXPERIMENT_ENROLLMENT')).toBeNull();
    expect(subjectOf(rcEvent({ type: 'EXPERIMENT_ENROLLMENT' })).kind).toBe('unknown');
    expect(revenueCatAccessRuling('PURCHASE_REDEEMED')).toBeNull();
    expect(subjectOf(rcEvent({ type: 'PURCHASE_REDEEMED' })).kind).toBe('unknown');
    expect(revenueCatAccessRuling('SUBSCRIBER_ALIAS')).toBeNull();
    expect(subjectOf(rcEvent({ type: 'SUBSCRIBER_ALIAS' })).kind).toBe('unknown');
    expect(revenueCatAccessRuling('PRICE_INCREASE_CONSENT_REQUIRED')).toBeNull();
    expect(subjectOf(rcEvent({ type: 'PRICE_INCREASE_CONSENT_REQUIRED' })).kind).toBe('unknown');
    expect(revenueCatAccessRuling('PRICE_INCREASE_CONSENT_APPROVED')).toBeNull();
    expect(subjectOf(rcEvent({ type: 'PRICE_INCREASE_CONSENT_APPROVED' })).kind).toBe('unknown');
  });

  it('TEMPORARY_ENTITLEMENT_GRANT changes no access: acknowledged, not a grant (ADR 092 §4.6)', () => {
    // P1: at most 24 hours, only app_user_id and store — and no environment.
    expect(revenueCatAccessRuling('TEMPORARY_ENTITLEMENT_GRANT')).toBeNull();
    expect(subjectOf(rcEvent({ type: 'TEMPORARY_ENTITLEMENT_GRANT', environment: undefined })).kind).toBe('unknown');
  });

  it('REFUND_REVERSED is REFUSED BY NAME and is never ruled a revocation (ADR 092 §4.6)', () => {
    const s = subjectOf(rcEvent({ type: 'REFUND_REVERSED', store: 'APP_STORE' }));
    expect(s.kind === 'refused' && s.detail).toMatch(/^revenuecat REFUND_REVERSED: refund_reversed_undecided:/);
    // The restoring reason, fed to the ruling directly: never 'revoke'.
    expect(
      revenueCatAccessRulingForRow({
        event: 'REFUND_REVERSED',
        reason: 'chargeback_reversed',
        dateDerived: false,
        notAGrant: false,
      }),
    ).not.toBe('revoke');
  });

  it('E1 · a lifecycle event carries product_id and store onto the subject', () => {
    const s = subjectOf(rcEvent({ product_id: 'st_pro_monthly', store: 'PLAY_STORE' }));
    expect(s.kind === 'subscription' && [s.productId, s.store]).toEqual(['st_pro_monthly', 'PLAY_STORE']);
    const bare = subjectOf(rcEvent());
    expect(bare.kind === 'subscription' && [bare.productId, bare.store]).toEqual([null, null]);
  });
});

// ⏱ 2026-09-24 · F912 (the #912 review, finding 3). "Not a grant" was a Set of
// event names beside the table, so a row could be added without being in it and
// read as a grant. It is now each row's own REQUIRED boolean, and the ruling reads
// the row. tooling/ci/assert-entitlement-contract.mjs limb 6b refuses a row that
// omits it; the cases here pin what the ruling does with it.
describe('the contract table — every row says whether it is a grant', () => {
  it('every REVENUECAT_EVENT_REASONS row declares notAGrant as a boolean', () => {
    const undeclared = REVENUECAT_EVENT_REASONS.filter((row) => typeof row.notAGrant !== 'boolean').map((r) => r.event);
    expect(undeclared).toEqual([]);
  });

  it('the nine rows that change no access are the rows marked notAGrant: true, and no others', () => {
    const marked = REVENUECAT_EVENT_REASONS.filter((row) => row.notAGrant === true).map((r) => r.event);
    expect([...marked].sort()).toEqual(
      [
        'EXPERIMENT_ENROLLMENT',
        'INVOICE_ISSUANCE',
        'PRICE_INCREASE_CONSENT_APPROVED',
        'PRICE_INCREASE_CONSENT_REQUIRED',
        'PURCHASE_REDEEMED',
        'SUBSCRIBER_ALIAS',
        'SUBSCRIPTION_PAUSED',
        'TEMPORARY_ENTITLEMENT_GRANT',
        'VIRTUAL_CURRENCY_TRANSACTION',
      ],
    );
  });

  it('the ruling reads the ROW: a grant-shaped row is null with notAGrant true, and a grant with false', () => {
    const grantRow = { event: 'INITIAL_PURCHASE', reason: null, dateDerived: false };
    expect(revenueCatAccessRulingForRow({ ...grantRow, notAGrant: true })).toBeNull();
    expect(revenueCatAccessRulingForRow({ ...grantRow, notAGrant: false })).toBe('grant');
  });

  it('a row that declares no notAGrant is never read as a grant — the ruling fails closed', () => {
    const bare = { event: 'INITIAL_PURCHASE', reason: null, dateDerived: false } as unknown as Parameters<
      typeof revenueCatAccessRulingForRow
    >[0];
    expect(revenueCatAccessRulingForRow(bare)).toBeNull();
  });
});

// ── ⏱ 2026-09-22 · [ADR 092] §4.3 · TRANSFER ─────────────────────────────────
// The body follows the event reference's TRANSFER sample (P2, read 2026-09-22):
// `transferred_from` and `transferred_to` are id lists, `environment` and `store`
// are Sometimes, and there is no app_user_id, product or transaction — "The
// webhook is sent only for the destination user" (P1).
const FROM_USER = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';

function rcTransfer(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    api_version: '1.0',
    event: {
      id: 'evt_rc_transfer_1',
      type: 'TRANSFER',
      event_timestamp_ms: NOW_MS,
      app_id: RC_APP,
      environment: 'PRODUCTION',
      store: 'PLAY_STORE',
      transferred_from: [FROM_USER],
      transferred_to: [USER],
      ...over,
    },
  });
}

describe('revenuecat parse — TRANSFER is an ownership fact, never a grant', () => {
  it('the ruling answers transfer, not grant', () => {
    expect(revenueCatAccessRuling('TRANSFER')).toBe('transfer');
  });

  it('parses to a transfer subject naming the sources and the ONE destination', () => {
    const s = subjectOf(rcTransfer());
    expect(s).toEqual({
      kind: 'transfer',
      appId: 'subscriptiontracker',
      from: [FROM_USER],
      to: USER,
      railEnvironment: 'live',
    });
  });

  it('a TRANSFER from an app id no app declares is refused on A, like any event', () => {
    expect(subjectOf(rcTransfer({ app_id: 'app_undeclared' })).kind).toBe('refused');
  });

  it.each([
    ['transferred_from null', { transferred_from: null }, /^revenuecat TRANSFER: transfer_ids_absent: `transferred_from`/],
    ['transferred_to empty', { transferred_to: [] }, /^revenuecat TRANSFER: transfer_ids_absent: `transferred_to`/],
    ['transferred_to null', { transferred_to: null }, /^revenuecat TRANSFER: transfer_ids_absent: `transferred_to`/],
    ['an anonymous source', { transferred_from: ['$RCAnonymousID:1a2b'] }, /^revenuecat TRANSFER: transfer_anonymous:/],
    ['an anonymous destination', { transferred_to: ['$RCAnonymousID:1a2b'] }, /^revenuecat TRANSFER: transfer_anonymous:/],
    ['two destinations', { transferred_to: [USER, FROM_USER] }, /^revenuecat TRANSFER: transfer_ambiguous_destination:/],
    ['no environment', { environment: undefined }, /^revenuecat TRANSFER: transfer_environment_absent:/],
    ['an unknown environment', { environment: 'STAGING' }, /neither PRODUCTION nor SANDBOX/],
    ['an inherited key as environment', { environment: 'toString' }, /neither PRODUCTION nor SANDBOX/],
  ])('%s is REFUSED BY NAME', (_label, over, detail) => {
    const s = subjectOf(rcTransfer(over));
    expect(s.kind).toBe('refused');
    expect(s.kind === 'refused' && s.detail).toMatch(detail);
  });

  it('a SANDBOX transfer is carried as the sandbox world', () => {
    const s = subjectOf(rcTransfer({ environment: 'SANDBOX' }));
    expect(s.kind === 'transfer' && s.railEnvironment).toBe('sandbox');
  });
});

describe('revenuecat parse — the rest of the table', () => {

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
