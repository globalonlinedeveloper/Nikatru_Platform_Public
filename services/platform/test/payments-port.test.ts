// ─────────────────────────────────────────────────────────────────────────────
// ⏱ 2026-10-01 · port-pay-core · THE PAYMENTS PORT'S OWN RED CONTROLS.
//
//   1. A rail without `checkout` cannot be handed to the checkout dispatcher — a COMPILE
//      error, held by `@ts-expect-error` (an unused expect-error fails `tsc --noEmit`, so
//      deleting the guard in services/_shared/src/ports/payments.ts reddens the typecheck).
//   2. The fake rail is a 404 at the inbound door on EVERY deployed environment, exactly as
//      an unknown provider is (src/ports.ts `inboundFor`, from the rendered environments in
//      src/generated/ports.ts), and its verify checks the CONFIGURED secret, never the
//      committed public constant (#1127 money review, finding 1).
//   3. The cancel path and the web checkout rail are the RENDERED table's, not a hand map.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import money from '../src/routes/money';
import type { AppEnv } from '../src/types';
import { realPlatformDb } from './harness';
import {
  checkoutThrough,
  railCan,
  type CheckoutRequest,
  type RailOutbound,
} from '../../_shared/src/ports/payments';
import { FAKE_RAIL_TEST_SECRET, FAKE_SIGNATURE_HEADER, fakeSignature, fakeVerifier, makeFakeRail } from '../../_shared/src/ports/fakes/payments';
import { checkoutRailFor, inboundFor, portFor, railFor } from '../src/ports';
import { CHECKOUT_RAIL_BY_MARKET, CHECKOUT_RAIL_ID, PAYMENTS_ADAPTERS, RAIL_CANCEL_PATH } from '../src/generated/ports';
import { RAIL_CANCEL_PATH as REGISTRY_CANCEL_PATH } from '../src/lib/mor/registry';
import { PADDLE_API_KEY_VAR } from '../src/lib/mor/paddle-rail';
import paymentsRegistry from '../../../tooling/ports/payments.json';

const REQ: CheckoutRequest = { appId: 'subscriptiontracker', offeringId: 'pro_monthly', userId: 'u1', market: null, environment: 'sandbox' };

describe('the outbound port — a capability is declared AND typed', () => {
  it('🔴 a rail without `checkout` cannot be passed to the checkout dispatcher (compile-time)', () => {
    const cancelOnly: RailOutbound = {
      id: 'cancel-only',
      capabilities: new Set(['cancel'] as const),
      cancel: async () => ({ ok: true, effectiveAt: null }),
    };
    expect(railCan(cancelOnly, 'checkout')).toBe(false);
    // @ts-expect-error — RailOutbound is not RailWith<'checkout'>: createCheckout is optional on it.
    const call = () => checkoutThrough(cancelOnly, REQ);
    expect(call).toThrow(TypeError); // and at runtime it has no verb to call
  });

  it('railCan needs the capability DECLARED, not just the method present', () => {
    const undeclared: RailOutbound = { id: 'x', capabilities: new Set(), createCheckout: async () => ({ ok: true, url: 'https://a.invalid/', reference: 'r' }) };
    expect(railCan(undeclared, 'checkout')).toBe(false);
    expect(railCan(makeFakeRail(() => true), 'checkout')).toBe(true);
  });
});

/** A value only this test knows: the secret an operator would set, NOT the committed constant. */
const OPERATOR_SECRET = 'operator-chosen-private-value';

function door(environment: 'live' | 'sandbox', extra: Record<string, string> = {}) {
  const db = realPlatformDb();
  const app = new Hono<AppEnv>();
  app.route('/v1/money', money);
  const env = { PLATFORM_DB: db, MONEY_ENVIRONMENT: environment, ...extra } as unknown as AppEnv['Bindings'];
  return async (provider: string, raw: string, headers: Record<string, string>) =>
    app.fetch(new Request(`https://x/v1/money/${provider}`, { method: 'POST', headers, body: raw }), env, {
      waitUntil() {},
      passThroughOnException() {},
    } as unknown as ExecutionContext);
}

const fakeBody = JSON.stringify({
  event_id: 'evt_fake_door_1',
  type: 'subscription.updated',
  occurred_at: '2026-09-01T00:00:00.000Z',
  environment: 'sandbox',
  subscription: { id: 'fake_sub_door', status: 'active', current_period_end: '2027-01-01T00:00:00.000Z', user_id: 'user-door', app_id: 'subscriptiontracker' },
});

describe('the inbound door serves an adapter only in the environments the registry lists', () => {
  it('🔴 a live-environment request to /v1/money/fake is a 404 unknown_provider', async () => {
    const send = door('live', { FAKE_RAIL_WEBHOOK_SECRET: OPERATOR_SECRET });
    const res = await send('fake', fakeBody, { [FAKE_SIGNATURE_HEADER]: await fakeSignature(fakeBody, OPERATOR_SECRET) });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'unknown_provider' });
  });

  // #1127 money review, finding 1: the sandbox door accepted a body signed with the PUBLIC
  // constant and granted an entitlement to any user id. The fake is now registered for
  // `test` only, so a sandbox deploy 404s it whatever it is signed with, and nothing is recorded.
  it('🔴 a SANDBOX deploy refuses a body signed with the public test constant, even with its own secret set', async () => {
    const send = door('sandbox', { FAKE_RAIL_WEBHOOK_SECRET: OPERATOR_SECRET });
    const res = await send('fake', fakeBody, { [FAKE_SIGNATURE_HEADER]: await fakeSignature(fakeBody, FAKE_RAIL_TEST_SECRET) });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'unknown_provider' });
  });

  it('🔴 a SANDBOX deploy refuses even a body signed with its configured secret: the fake is not registered there', async () => {
    const send = door('sandbox', { FAKE_RAIL_WEBHOOK_SECRET: OPERATOR_SECRET });
    const res = await send('fake', fakeBody, { [FAKE_SIGNATURE_HEADER]: await fakeSignature(fakeBody, OPERATOR_SECRET) });
    expect(res.status).toBe(404);
  });

  it('inboundFor follows the rendered environments: the fake is served on no deployed environment', () => {
    expect(inboundFor('fake', 'live')).toBeNull();
    expect(inboundFor('fake', 'sandbox')).toBeNull();
    expect(inboundFor('paddle', 'live')?.provider).toBe('paddle');
    expect(inboundFor('paddle', 'sandbox')?.provider).toBe('paddle');
    expect(inboundFor('nobody', 'live')).toBeNull();
    expect(portFor('payments', 'live')).not.toContain('fake');
    expect(portFor('payments', 'sandbox')).not.toContain('fake');
    expect(portFor('payments', 'test')).toEqual(['fake']);
  });
});

// The fake's verify, where it IS registered (`test`): the HMAC is checked under the
// secret it is HANDED, never under the committed constant.
describe("the fake rail's verify takes the configured secret, never the public constant", () => {
  const signed = async (secret: string) => new Headers({ [FAKE_SIGNATURE_HEADER]: await fakeSignature(fakeBody, secret) });

  it('green control: a body signed with the configured secret is accepted', async () => {
    expect(await fakeVerifier.verify(fakeBody, await signed(OPERATOR_SECRET), OPERATOR_SECRET, Date.now())).toEqual({ ok: true });
  });

  it('🔴 a body signed with the PUBLIC constant is refused (401) when the configured secret is anything else', async () => {
    const v = await fakeVerifier.verify(fakeBody, await signed(FAKE_RAIL_TEST_SECRET), OPERATOR_SECRET, Date.now());
    expect(v.ok).toBe(false);
    expect(v.ok === false && v.status).toBe(401);
  });

  it('🔴 no configured secret is a 401 before any signature is read: the constant is never a fallback', async () => {
    const v = await fakeVerifier.verify(fakeBody, await signed(FAKE_RAIL_TEST_SECRET), '', Date.now());
    expect(v.ok).toBe(false);
    expect(v.ok === false && v.status).toBe(401);
    expect(v.ok === false && v.reason).toMatch(/FAKE_RAIL_WEBHOOK_SECRET is not set/);
  });

  it('a zero signature under the configured secret is refused (401)', async () => {
    const v = await fakeVerifier.verify(fakeBody, new Headers({ [FAKE_SIGNATURE_HEADER]: '0'.repeat(64) }), OPERATOR_SECRET, Date.now());
    expect(v.ok === false && v.status).toBe(401);
  });
});

describe('the rendered table is the one the Worker reads', () => {
  it('RAIL_CANCEL_PATH is the rendered map, re-exported by the registry', () => {
    expect(REGISTRY_CANCEL_PATH).toBe(RAIL_CANCEL_PATH);
    // ⏱ 2026-10-01 · fix-india-rail-tax-data: razorpay declares `cancel` now → api.
    expect(RAIL_CANCEL_PATH).toMatchObject({ paddle: 'api', razorpay: 'api', revenuecat: 'store' });
  });

  // ⏱ 2026-10-01 · fix-india-rail-tax-data: two real adapters sell now (paddle, razorpay), so the web
  // checkout rail is chosen PER BUYER-DECLARED MARKET from the rendered CHECKOUT_RAIL_BY_MARKET (the
  // `web` channel's purchaseRail in tooling/channel-register.json); CHECKOUT_RAIL_ID is its default.
  it('every rendered checkout rail is a real adapter declaring checkout, and the root binds each', () => {
    const sellers = new Set(PAYMENTS_ADAPTERS.filter((a) => a.status !== 'fake' && a.capabilities.includes('checkout')).map((a) => a.id));
    expect([...sellers].sort()).toEqual(['paddle', 'razorpay']);
    expect(CHECKOUT_RAIL_BY_MARKET).toEqual({ default: 'paddle', IN: 'razorpay' });
    expect(CHECKOUT_RAIL_ID).toBe(CHECKOUT_RAIL_BY_MARKET.default);
    for (const id of Object.values(CHECKOUT_RAIL_BY_MARKET)) {
      expect(id !== null && sellers.has(id)).toBe(true);
      const rail = railFor(id, {} as unknown as AppEnv['Bindings']);
      expect(rail !== null && railCan(rail, 'checkout')).toBe(true);
    }
  });

  it('checkoutRailFor: only a buyer-declared IN selects the India rail; null, unknown and malformed markets take the default', () => {
    expect(checkoutRailFor('IN')).toBe('razorpay');
    expect(checkoutRailFor(null)).toBe('paddle');
    expect(checkoutRailFor('US')).toBe('paddle');
    expect(checkoutRailFor('DE')).toBe('paddle');
    expect(checkoutRailFor('in')).toBe('paddle'); // not upper-case alpha-2: not a declaration
    expect(checkoutRailFor('IND')).toBe('paddle');
    expect(checkoutRailFor('default')).toBe('paddle');
    expect(checkoutRailFor('__proto__')).toBe('paddle');
  });

  // #1127 CodeQL #548: the route passes the rendered, nullable selection straight to
  // `railFor` and never compares the generated constant itself. With `provider: string`
  // this file does not typecheck (`tsc --noEmit` exits 1, TS2345), which is the red.
  it('railFor takes the nullable rendered selection: null (no seller, or several) binds to null', () => {
    const none: typeof CHECKOUT_RAIL_ID = null;
    expect(railFor(none, {} as unknown as AppEnv['Bindings'])).toBeNull();
    expect(railFor(null, {} as unknown as AppEnv['Bindings'])).toBeNull();
  });

  // #1127 money review, finding 2: railFor enforces the environments inboundFor does.
  it('🔴 railFor binds the fake on NO deployed environment, and an unset MONEY_ENVIRONMENT reads as live', () => {
    const on = (MONEY_ENVIRONMENT?: string) => ({ ...(MONEY_ENVIRONMENT === undefined ? {} : { MONEY_ENVIRONMENT }) }) as unknown as AppEnv['Bindings'];
    expect(railFor('fake', on('sandbox'))).toBeNull();
    expect(railFor('fake', on('live'))).toBeNull();
    expect(railFor('fake', on())).toBeNull();
    expect(railFor('fake', on('staging'))).toBeNull();
    // green control: the real rail binds wherever the registry lists it.
    for (const e of ['sandbox', 'live', undefined]) expect(railFor('paddle', on(e))?.id).toBe('paddle');
  });

  // #1127 money review, finding 4: the key the rail READS is a secret the registry DECLARES
  // (and, by `satisfies keyof Env` in lib/mor/paddle-rail.ts, a member of Env — a tsc fact).
  it('🔴 the Paddle key name the rail reads is one of payments.json paddle `secrets`', () => {
    const paddle = (paymentsRegistry as { adapters: { id: string; secrets: string[] }[] }).adapters.find((a) => a.id === 'paddle');
    expect(paddle?.secrets).toContain(PADDLE_API_KEY_VAR);
  });

  it('a rail with no outbound half binds to null, never to a stand-in', () => {
    // ⏱ 2026-10-01 · fix-india-rail-tax-data: razorpay HAS an outbound half now (razorpay-rail.ts).
    expect(railFor('razorpay', {} as unknown as AppEnv['Bindings'])?.id).toBe('razorpay');
    expect(railFor('revenuecat', {} as unknown as AppEnv['Bindings'])).toBeNull();
  });
});
