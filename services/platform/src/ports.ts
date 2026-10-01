// ─────────────────────────────────────────────────────────────────────────────
// ⏱ 2026-10-01 · port-pay-core · THE PLATFORM WORKER'S COMPOSITION ROOT.
//
// The ONE module of this Worker that imports a payments adapter (tooling/ports/README.md
// §3; assert-ports limb 4 holds it). Routes ask for a rail by the provider id a row or a
// URL carries — `railFor`, `inboundFor` — and never name a vendor. Which adapters exist,
// in which environment, and how each cancels is the RENDERED table
// (src/generated/ports.ts, from tooling/ports/payments.json by tooling/ports/render.mjs).
//
// The two binding records below are typed by the rendered id union: a rendered adapter
// with no binding, or a binding for an id the registry does not list, fails `tsc`.
// ─────────────────────────────────────────────────────────────────────────────
import type { Env } from './types';
import type { MoneyEnvironment } from './lib/mor/contract';
import type { RailInbound, RailOutbound, SecretReader } from '../../_shared/src/ports/payments';
import { MOR_VERIFIER_IDS, PAYMENTS_ADAPTERS, type PaymentsAdapterId, type PortEnvironment } from './generated/ports';
import { paddleVerifier } from './lib/mor/paddle';
import { razorpayVerifier } from './lib/mor/razorpay';
import { revenuecatVerifier } from './lib/mor/revenuecat';
import { paddleRail } from './lib/mor/paddle-rail';
import { fakeVerifier, makeFakeRail } from '../../_shared/src/ports/fakes/payments';
import { RAIL_PRICE_IDS } from './routes/rail-price-ids';

/** Each adapter's inbound half, keyed by its rendered id. */
const INBOUND: { readonly [K in PaymentsAdapterId]: RailInbound } = {
  paddle: paddleVerifier,
  razorpay: razorpayVerifier,
  revenuecat: revenuecatVerifier,
  fake: fakeVerifier,
};

/** Each adapter's outbound half, or null for a rail with no outbound verb built yet. */
const OUTBOUND: { readonly [K in PaymentsAdapterId]: ((secrets: SecretReader) => RailOutbound) | null } = {
  paddle: paddleRail,
  razorpay: null, // O-RAZORPAY-CHECKOUT-ADAPTER: checkout, cancel and the plan ids arrive with Razorpay PR B.
  revenuecat: null, // a store rail: only the store that billed can cancel (cancel path `store`).
  // The fake sells what Paddle prices, so a sandbox rehearses the same catalogue.
  fake: () => makeFakeRail((appId, offeringId) => RAIL_PRICE_IDS.paddle?.[appId]?.[offeringId] !== undefined),
};

const ROW = new Map(PAYMENTS_ADAPTERS.map((a) => [a.id as string, a]));

/**
 * Every rail that verifies REAL money, in the rendered order (MOR_VERIFIER_IDS: the non-fake
 * adapters declaring `verify`). lib/mor/registry.ts re-exports it and `verifierFor` reads it; the
 * fake is reached only through `inboundFor`, in the environments the registry lists for it.
 */
export const MOR_VERIFIERS: readonly RailInbound[] = MOR_VERIFIER_IDS.map((id) => INBOUND[id]);

/** True when `provider` is a payments adapter this environment may serve. */
export function servesIn(provider: string, environment: PortEnvironment): boolean {
  return ROW.get(provider)?.environments.includes(environment) ?? false;
}

/**
 * The inbound verifier for a webhook's provider segment, or null — and null in an
 * environment the registry does not list it for, so `/v1/money/fake` is a 404 on a
 * live deploy exactly as an unknown provider is.
 */
export function inboundFor(provider: string, environment: MoneyEnvironment | null): RailInbound | null {
  const row = ROW.get(provider);
  if (row === undefined) return null;
  if (environment !== null && !row.environments.includes(environment)) return null;
  return INBOUND[row.id];
}

/**
 * The outbound rail for a provider id, bound to this Worker's secrets BY NAME, or null
 * when the registry lists no outbound half for it. Callers narrow with `railCan`.
 *
 * `provider` is `string | null` so a RENDERED selection that may be null
 * (CHECKOUT_RAIL_ID) is passed straight in: the null test is made here, on a typed
 * parameter, and never by a route against a generated constant whose value the build
 * already fixes (#1127, CodeQL #548 js/comparison-between-incompatible-types).
 */
export function railFor(provider: string | null, env: Env): RailOutbound | null {
  if (provider === null) return null;
  const row = ROW.get(provider);
  if (row === undefined) return null;
  const make = OUTBOUND[row.id];
  if (make === null) return null;
  const secrets: SecretReader = (name) => {
    const v = (env as unknown as Record<string, unknown>)[name];
    return typeof v === 'string' ? v : undefined;
  };
  return make(secrets);
}

/** The port's generic accessor (tooling/ports/README.md §3): the payments adapters a deploy may select. */
export function portFor(port: 'payments', environment: PortEnvironment): readonly PaymentsAdapterId[] {
  if (port !== 'payments') return [];
  return PAYMENTS_ADAPTERS.filter((a) => a.environments.includes(environment)).map((a) => a.id);
}
