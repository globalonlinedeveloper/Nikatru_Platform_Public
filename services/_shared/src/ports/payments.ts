// ─────────────────────────────────────────────────────────────────────────────
// ⏱ 2026-10-01 · port-pay-core · THE PAYMENTS PORT — both halves of a rail.
//
// The standard is tooling/ports/README.md; the registry is tooling/ports/payments.json.
// Types and pure helpers only, and NO vendor import: a rail is an adapter of this
// file, chosen by the Worker's composition root (services/<w>/src/ports.ts) from
// the rendered table (services/platform/src/generated/ports.ts), never named by a
// route. Row O-PAYMENTS-OUTBOUND-VENDOR-SHAPED closes with this file.
//
//   INBOUND  — `RailInbound` IS [ADR 004]'s `MoRWebhookVerifier`, re-exported.
//              lib/mor/contract.ts stays the home of the normalized vocabulary.
//   OUTBOUND — `RailOutbound`: checkout, cancel, refund, reconcile, each a
//              DECLARED capability. Outcomes, never throws across the port.
// ─────────────────────────────────────────────────────────────────────────────
import type { MoneyEnvironment } from '../../../platform/src/lib/mor/contract';

export type {
  MoRWebhookVerifier as RailInbound,
  MoneyEnvironment,
  NormalizedNotification,
  ParseOutcome,
  VerifyOutcome,
} from '../../../platform/src/lib/mor/contract';

/** The outbound verbs a rail may declare. Capability verbs, never vendor nouns. */
export const RAIL_CAPABILITIES = ['checkout', 'cancel', 'refund', 'reconcile'] as const;
export type RailCapability = (typeof RAIL_CAPABILITIES)[number];

/** Why a call across the port did not succeed (tooling/ports/README.md §3). */
export type PortFailureKind = 'refused' | 'unavailable' | 'invalid' | 'timeout';

/**
 * Every outbound answer. Never a throw: an adapter that throws has crossed the port
 * with an answer nobody can map to a status.
 *
 * `sent` says whether anything left this Worker. A failure with `sent: false` is
 * ours to fix (no credential, no price); one with `sent: true` was the rail's
 * answer, and for a create it may have left an artefact at the vendor.
 */
export type Outcome<T> =
  | ({ ok: true } & T)
  | { ok: false; kind: PortFailureKind; retryable: boolean; sent: boolean; detail: string };

export interface CheckoutRequest {
  appId: string;
  offeringId: string;
  /** Our account id; it must travel to the rail so the webhook can be attributed. */
  userId: string;
  /** The buyer's market (ISO 3166-1 alpha-2), or null when the caller did not say. */
  market: string | null;
  environment: MoneyEnvironment;
}

/** A checkout the buyer can open: a URL on the rail's host, and the rail's reference. */
export interface CheckoutSession {
  url: string;
  reference: string;
}

export interface CancelRequest {
  subscriptionRef: string;
  /** The ONLY cancel this platform makes (INV-514: a cancel ends renewal; the paid period is kept). */
  when: 'period_end';
  environment: MoneyEnvironment;
}

export interface CancelReceipt {
  /** When access ends, as the rail stated it; null when its answer names none. */
  effectiveAt: string | null;
}

export interface RefundRequest {
  /** The rail's purchase (transaction) reference. */
  purchaseRef: string;
  /** The amount in minor units; null refunds the whole purchase. */
  amountMinor: number | null;
  environment: MoneyEnvironment;
}

export interface RefundReceipt {
  refundRef: string;
}

export interface ReconcileRequest {
  subscriptionRef: string;
  environment: MoneyEnvironment;
}

/** What the rail says a subscription is, for an ALERT-ONLY comparison against our row. */
export interface ReconcileReport {
  status: string;
  currentPeriodEnd: string | null;
}

export interface RailOutbound {
  /** The wire id: the registry's adapter id, the `provider` column, the webhook segment. */
  readonly id: string;
  /** What this rail can do. A verb absent here is never called. */
  readonly capabilities: ReadonlySet<RailCapability>;
  readonly createCheckout?: (req: CheckoutRequest) => Promise<Outcome<CheckoutSession>>;
  readonly cancel?: (req: CancelRequest) => Promise<Outcome<CancelReceipt>>;
  readonly refund?: (req: RefundRequest) => Promise<Outcome<RefundReceipt>>;
  readonly reconcile?: (req: ReconcileRequest) => Promise<Outcome<ReconcileReport>>;
}

/** The method each capability needs. */
export const VERB_OF = {
  checkout: 'createCheckout',
  cancel: 'cancel',
  refund: 'refund',
  reconcile: 'reconcile',
} as const satisfies Record<RailCapability, keyof RailOutbound>;

/** A rail that DECLARES capability `C` and carries its method — the only type a dispatcher takes. */
export type RailWith<C extends RailCapability> = RailOutbound &
  Required<Pick<RailOutbound, (typeof VERB_OF)[C]>>;

/** Narrow a rail to one that can do `cap`: declared AND implemented, never one without the other. */
export function railCan<C extends RailCapability>(rail: RailOutbound, cap: C): rail is RailWith<C> {
  return rail.capabilities.has(cap) && typeof rail[VERB_OF[cap]] === 'function';
}

/** Reads one secret by NAME. The composition root binds it to a Worker's Env; adapters never see Env. */
export type SecretReader = (name: string) => string | undefined;

/** How the composition root builds an outbound rail: secrets in, a rail out. */
export type RailFactory = (secrets: SecretReader) => RailOutbound;

/** A failure nobody sent. */
export function notSent(kind: PortFailureKind, detail: string): Outcome<never> {
  return { ok: false, kind, retryable: false, sent: false, detail };
}

// ── the dispatchers: the ONLY way a route reaches a rail's verb ─────────────────

/** Checkout through a rail that declares it. A rail without `checkout` is a compile error here. */
export function checkoutThrough(rail: RailWith<'checkout'>, req: CheckoutRequest): Promise<Outcome<CheckoutSession>> {
  return rail.createCheckout(req);
}

/** Cancel at the period end through a rail that declares it. */
export function cancelThrough(rail: RailWith<'cancel'>, req: CancelRequest): Promise<Outcome<CancelReceipt>> {
  return rail.cancel(req);
}
