// ─────────────────────────────────────────────────────────────────────────────
// ⏱ 2026-10-01 · port-pay-core · THE FAKE RAIL — both halves, no vendor.
//
// Registered in tooling/ports/payments.json with `status: fake` and
// `environments: ["test", "sandbox"]`; assert-ports limb 7 refuses it in live, and the
// inbound door answers 404 for `/v1/money/fake` on a live deploy (src/ports.ts
// `inboundFor`). It exists so the conformance suite has a second adapter whose every
// byte is ours, and so a sandbox can rehearse the whole money loop with no vendor.
//
//   INBOUND   JSON bodies signed HMAC-SHA256 (hex) under FAKE_RAIL_TEST_SECRET, in the
//             `x-fake-signature` header. The secret is a FIXED, PUBLIC test value: a
//             fake protects nothing, and its signature exists so "a bad signature is
//             refused" is a real case and not a skipped one.
//   OUTBOUND  checkout URLs on the reserved host checkout.fake.invalid (RFC 2606:
//             `.invalid` never resolves), cancel / refund / reconcile over in-memory
//             state. Never a network call.
// ─────────────────────────────────────────────────────────────────────────────
import type {
  CancelReceipt,
  CheckoutSession,
  NormalizedNotification,
  Outcome,
  ParseOutcome,
  RailInbound,
  RailOutbound,
  ReconcileReport,
  RefundReceipt,
  VerifyOutcome,
} from '../payments';
import { notSent } from '../payments';

export const FAKE_RAIL_ID = 'fake';
/** Public by design: see the header. Never a real credential's shape. */
export const FAKE_RAIL_TEST_SECRET = 'fake-rail-public-test-secret-not-a-credential';
export const FAKE_SIGNATURE_HEADER = 'x-fake-signature';
export const FAKE_CHECKOUT_HOST = 'checkout.fake.invalid';

const enc = new TextEncoder();
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);

/** HMAC-SHA256 of `body` under `secret`, lowercase hex. */
export async function fakeSignature(body: string, secret: string = FAKE_RAIL_TEST_SECRET): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(body)));
  return [...mac].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** The fake's subscription statuses, translated into the contract's access vocabulary. */
const STATUS_ACCESS: Readonly<Record<string, { access: 'granted' | 'trialing' | 'until_end' | 'suspended'; reason: string | null }>> = {
  active: { access: 'granted', reason: null },
  trialing: { access: 'trialing', reason: null },
  canceling: { access: 'until_end', reason: 'cancelled_at_period_end' },
  canceled: { access: 'until_end', reason: 'cancelled_at_period_end' },
};

/** The fake's adjustment actions → [REVOCATION_REASONS], and whether each restores. */
const ADJUSTMENT: Readonly<Record<string, { reason: string; restores: boolean }>> = {
  refund: { reason: 'refund_approved', restores: false },
  dispute: { reason: 'chargeback', restores: false },
  dispute_won: { reason: 'chargeback_reversed', restores: true },
  refund_reversed: { reason: 'chargeback_reversed', restores: true },
};

/** Parse a verified fake body. Refuses anything it does not know; never throws. */
export function parseFakeBody(raw: string): ParseOutcome {
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'the body is not JSON' };
  }
  if (!isObj(body)) return { ok: false, reason: 'the body is not an object' };
  const eventId = str(body.event_id);
  const type = str(body.type);
  const occurredAt = str(body.occurred_at);
  if (eventId === null || type === null || occurredAt === null || !Number.isFinite(Date.parse(occurredAt))) {
    return { ok: false, reason: 'event_id, type and occurred_at are required' };
  }
  const env = body.environment === 'live' || body.environment === 'sandbox' ? body.environment : null;
  const base = { provider: FAKE_RAIL_ID, eventId, notificationId: null, eventType: type, occurredAt: new Date(Date.parse(occurredAt)).toISOString() };

  if (type === 'subscription.updated') {
    const s = isObj(body.subscription) ? body.subscription : null;
    const id = s ? str(s.id) : null;
    const status = s ? str(s.status) : null;
    const rule = status !== null ? STATUS_ACCESS[status] : undefined;
    if (s === null || id === null || status === null || rule === undefined) {
      return { ok: false, reason: `subscription.updated carries no known subscription status (${JSON.stringify(status)})` };
    }
    const notification: NormalizedNotification = {
      ...base,
      subject: {
        kind: 'subscription',
        subscriptionId: id,
        statusVerbatim: status,
        access: rule.access,
        currentPeriodEnd: str(s.current_period_end),
        trialEnd: str(s.trial_end),
        transactionId: str(s.transaction_id),
        endsWithReason: rule.reason,
        accountUserId: str(s.user_id),
        accountAppId: str(s.app_id),
        customerId: null,
        customerEmail: null,
        railEnvironment: env,
      },
    };
    return { ok: true, notification };
  }
  if (type === 'adjustment.created') {
    const a = isObj(body.adjustment) ? body.adjustment : null;
    const action = a ? str(a.action) : null;
    const rule = action !== null ? ADJUSTMENT[action] : undefined;
    if (a === null || action === null || rule === undefined) {
      return { ok: false, reason: `adjustment.created carries no known action (${JSON.stringify(action)})` };
    }
    return {
      ok: true,
      notification: {
        ...base,
        subject: {
          kind: 'adjustment',
          actionVerbatim: action,
          statusVerbatim: 'approved',
          transactionId: str(a.transaction_id),
          subscriptionId: str(a.subscription_id),
          reason: rule.reason,
          restores: rule.restores,
          effective: true,
        },
      },
    };
  }
  return { ok: false, reason: `unknown fake event type ${JSON.stringify(type)}` };
}

/** The fake's inbound half: an [ADR 004] verifier. */
export const fakeVerifier: RailInbound = {
  provider: FAKE_RAIL_ID,
  secretEnvVar: 'FAKE_RAIL_WEBHOOK_SECRET',
  async verify(raw: string, headers: Headers): Promise<VerifyOutcome> {
    const sig = (headers.get(FAKE_SIGNATURE_HEADER) ?? '').trim().toLowerCase();
    if (sig === '') return { ok: false, status: 400, reason: `no ${FAKE_SIGNATURE_HEADER} header` };
    if (!/^[0-9a-f]{64}$/.test(sig)) return { ok: false, status: 400, reason: `${FAKE_SIGNATURE_HEADER} is not a hex HMAC-SHA256` };
    const want = await fakeSignature(raw);
    return timingSafeEqualHex(sig, want) ? { ok: true } : { ok: false, status: 401, reason: 'signature mismatch' };
  },
  parse: parseFakeBody,
};

/** What the fake sells: true when `offeringId` of `appId` has a price on it. */
export type FakeCatalogue = (appId: string, offeringId: string) => boolean;

/**
 * The fake's outbound half, over in-memory state. A fresh rail per call: the state is
 * the rail's own, and a test that wants a clean slate builds a new one.
 */
export function makeFakeRail(sells: FakeCatalogue, clock: () => number = () => Date.now()): RailOutbound {
  let seq = 0;
  const cancels = new Map<string, string>();
  const refunds = new Map<string, string>();
  return {
    id: FAKE_RAIL_ID,
    capabilities: new Set(['checkout', 'cancel', 'refund', 'reconcile'] as const),
    async createCheckout(req): Promise<Outcome<CheckoutSession>> {
      if (!sells(req.appId, req.offeringId)) {
        return notSent('invalid', `app=${req.appId} offering=${req.offeringId} has no price on the fake rail`);
      }
      seq += 1;
      const reference = `fake_txn_${seq}`;
      return { ok: true, url: `https://${FAKE_CHECKOUT_HOST}/c/${reference}`, reference };
    },
    async cancel(req): Promise<Outcome<CancelReceipt>> {
      if (!/^fake_sub_[a-z0-9_]{1,64}$/.test(req.subscriptionRef)) {
        return notSent('invalid', 'not a fake subscription reference');
      }
      const prior = cancels.get(req.subscriptionRef);
      if (prior !== undefined) return { ok: true, effectiveAt: prior };
      const at = new Date(clock() + 30 * 86_400_000).toISOString();
      cancels.set(req.subscriptionRef, at);
      return { ok: true, effectiveAt: at };
    },
    async refund(req): Promise<Outcome<RefundReceipt>> {
      if (!/^fake_txn_[0-9]{1,12}$/.test(req.purchaseRef)) return notSent('invalid', 'not a fake purchase reference');
      const prior = refunds.get(req.purchaseRef);
      if (prior !== undefined) return { ok: true, refundRef: prior };
      seq += 1;
      const ref = `fake_rfd_${seq}`;
      refunds.set(req.purchaseRef, ref);
      return { ok: true, refundRef: ref };
    },
    async reconcile(req): Promise<Outcome<ReconcileReport>> {
      if (!/^fake_sub_[a-z0-9_]{1,64}$/.test(req.subscriptionRef)) return notSent('invalid', 'not a fake subscription reference');
      const end = cancels.get(req.subscriptionRef) ?? null;
      return { ok: true, status: end === null ? 'active' : 'canceling', currentPeriodEnd: end };
    },
  };
}
