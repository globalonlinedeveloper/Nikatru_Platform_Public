// ─────────────────────────────────────────────────────────────────────────────
// ⏱ 2026-10-01 · port-pay-core · THE PAYMENTS PORT'S OWN RED CONTROLS.
//
//   1. A rail without `checkout` cannot be handed to the checkout dispatcher — a COMPILE
//      error, held by `@ts-expect-error` (an unused expect-error fails `tsc --noEmit`, so
//      deleting the guard in services/_shared/src/ports/payments.ts reddens the typecheck).
//   2. The fake rail is a 404 at the inbound door on a LIVE deploy, exactly as an unknown
//      provider is, and is served on a sandbox deploy (src/ports.ts `inboundFor`, from the
//      rendered environments in src/generated/ports.ts).
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
import { FAKE_SIGNATURE_HEADER, fakeSignature, makeFakeRail } from '../../_shared/src/ports/fakes/payments';
import { inboundFor, portFor, railFor } from '../src/ports';
import { CHECKOUT_RAIL_ID, PAYMENTS_ADAPTERS, RAIL_CANCEL_PATH } from '../src/generated/ports';
import { RAIL_CANCEL_PATH as REGISTRY_CANCEL_PATH } from '../src/lib/mor/registry';

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

function door(environment: 'live' | 'sandbox') {
  const db = realPlatformDb();
  const app = new Hono<AppEnv>();
  app.route('/v1/money', money);
  const env = { PLATFORM_DB: db, MONEY_ENVIRONMENT: environment } as unknown as AppEnv['Bindings'];
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
    const send = door('live');
    const res = await send('fake', fakeBody, { [FAKE_SIGNATURE_HEADER]: await fakeSignature(fakeBody) });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'unknown_provider' });
  });

  it('the same signed body on a SANDBOX deploy reaches the rail (it is not a 404)', async () => {
    const send = door('sandbox');
    const res = await send('fake', fakeBody, { [FAKE_SIGNATURE_HEADER]: await fakeSignature(fakeBody) });
    expect(res.status).not.toBe(404);
    const body = (await res.json()) as { recorded?: boolean };
    expect(body.recorded).toBe(true);
  });

  it('a forged fake body is refused at verify on a sandbox deploy', async () => {
    const send = door('sandbox');
    const res = await send('fake', fakeBody, { [FAKE_SIGNATURE_HEADER]: '0'.repeat(64) });
    expect(res.status).toBe(401);
  });

  it('inboundFor follows the rendered environments', () => {
    expect(inboundFor('fake', 'live')).toBeNull();
    expect(inboundFor('fake', 'sandbox')?.provider).toBe('fake');
    expect(inboundFor('paddle', 'live')?.provider).toBe('paddle');
    expect(inboundFor('nobody', 'live')).toBeNull();
    expect(portFor('payments', 'live')).not.toContain('fake');
  });
});

describe('the rendered table is the one the Worker reads', () => {
  it('RAIL_CANCEL_PATH is the rendered map, re-exported by the registry', () => {
    expect(REGISTRY_CANCEL_PATH).toBe(RAIL_CANCEL_PATH);
    expect(RAIL_CANCEL_PATH).toMatchObject({ paddle: 'api', razorpay: 'none', revenuecat: 'store' });
  });

  it('the web checkout rail is the one real adapter declaring checkout, and the root binds it', () => {
    const sellers = PAYMENTS_ADAPTERS.filter((a) => a.status !== 'fake' && a.capabilities.includes('checkout'));
    expect(sellers.map((a) => a.id)).toEqual([CHECKOUT_RAIL_ID]);
    const rail = railFor(CHECKOUT_RAIL_ID ?? '', {} as unknown as AppEnv['Bindings']);
    expect(rail !== null && railCan(rail, 'checkout')).toBe(true);
  });

  it('a rail with no outbound half binds to null, never to a stand-in', () => {
    expect(railFor('razorpay', {} as unknown as AppEnv['Bindings'])).toBeNull();
    expect(railFor('revenuecat', {} as unknown as AppEnv['Bindings'])).toBeNull();
  });
});
