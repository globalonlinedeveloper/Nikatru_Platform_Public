// ─────────────────────────────────────────────────────────────────────────────
// What /v1/checkout sells, /v1/plan/cancel accepts — parity as a mechanism.
//
// ⏱ 2026-10-01 · #1117 review 1, finding 1. Checkout learned to sell an
// extension (`isKnownApp || isSellableExtension`) while the cancel route still
// asked `isKnownApp` alone, so a FullShot buyer would have been answered 404
// `unknown_app` by the "cancel as easily as you bought" half ([5]M-9). A note
// in a PR body held that; this test holds it instead.
//
// Both sets are read from the ROUTES' OWN ANSWERS, not from the predicates they
// happen to call today: every product id the register knows (apps, extensions,
// bundles) plus one it does not is offered to both, and any id checkout does not
// refuse as `unknown_app` must not be refused as `unknown_app` by cancel. A
// third predicate added to either gate is caught without this file changing.
// tooling/paywall-flip.json EXT-CANCEL names this file as its verify.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import checkout from '../src/routes/checkout';
import cancellation from '../src/routes/cancellation';
import { KNOWN_PRODUCTS } from '../src/config';
import type { AppEnv } from '../src/types';

function harness() {
  const app = new Hono<AppEnv>();
  // The product gate is decided before any I/O on both routes; auth is not
  // what is under test, so the user is set directly.
  app.use('*', async (c, next) => {
    c.set('requestId', 'rid-parity');
    c.set('userId', 'user-parity');
    await next();
  });
  app.route('/v1', checkout);
  app.route('/v1', cancellation);
  const env = {
    CONFIG_KV: { get: async () => null, put: async () => undefined } as unknown as KVNamespace,
    APP_ID: 'platform',
    API_VERSION: 'v1',
    // No money environment: past the product gate both routes answer 503, and
    // neither reaches a database or a rail.
    MONEY_ENVIRONMENT: undefined,
    // ⏱ 2026-10-01 · O-ST-CHECKOUT-UNBOUNDED: checkout's two limiters run BEFORE
    // its product gate, and the per-user bucket fails CLOSED (503) when unbound —
    // which would read here as "sold" for every id. Both admit, so the gate is
    // what answers.
    CHECKOUT_CEILING_LIMITER: { limit: async () => ({ success: true }) },
    CHECKOUT_USER_LIMITER: { limit: async () => ({ success: true }) },
  } as unknown as AppEnv['Bindings'];
  const post = (path: string, body: unknown) =>
    app.request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }, env);
  return { post };
}

/** True when the route refused `appId` as a product it does not know. */
async function refusesAsUnknown(res: Response): Promise<boolean> {
  if (res.status !== 404) return false;
  const body = (await res.json()) as { error?: unknown };
  return body.error === 'unknown_app';
}

describe('POST /v1/plan/cancel accepts every product POST /v1/checkout sells', () => {
  it('the checkout product set is a subset of the cancel product set', async () => {
    const h = harness();
    const candidates = [...KNOWN_PRODUCTS.keys(), 'not-a-product'];
    const sold: string[] = [];
    const orphaned: string[] = [];
    for (const appId of candidates) {
      const bought = await h.post('/v1/checkout', { app_id: appId, offering_id: 'pro_monthly' });
      if (await refusesAsUnknown(bought)) continue;
      sold.push(appId);
      const cancelled = await h.post('/v1/plan/cancel', { app_id: appId });
      if (await refusesAsUnknown(cancelled)) orphaned.push(appId);
    }
    // Non-vacuity: the set read off checkout holds an app AND an extension, and
    // the id nobody registered is not in it — a harness that broke checkout's
    // answers would otherwise prove parity over nothing.
    expect(sold).toContain('subscriptiontracker');
    expect(sold).toContain('fullshot');
    expect(sold).not.toContain('not-a-product');
    expect(orphaned, `checkout sells ${orphaned.join(', ')} but cancel answers 404 unknown_app`).toEqual([]);
  });
});
