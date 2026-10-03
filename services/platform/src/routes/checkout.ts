// ─────────────────────────────────────────────────────────────────────────────
// POST /v1/checkout — the Paddle CREATE-TRANSACTION server half. [ADR 044].
//
// ⏱ 2026-10-01 · port-pay-core: THIS ROUTE NO LONGER NAMES A VENDOR IN CODE. It
// dispatches through the payments port (services/_shared/src/ports/payments.ts
// `checkoutThrough`) to the rail src/ports.ts `railFor` binds for the rendered
// selection. ⏱ 2026-10-01 · fix-india-rail-tax-data: that selection is now PER MARKET —
// `checkoutRailFor(market)` over the rendered CHECKOUT_RAIL_BY_MARKET (the `web` channel's
// purchaseRail: Paddle by default, the India rail for a buyer who DECLARES `IN` in the
// optional body field `market`; never cf.country). The
// create body, its `?: never` guard, the call and every refusal below moved VERBATIM
// to src/lib/mor/paddle-rail.ts; the record that follows is the measured Paddle
// contract that adapter keeps, left here because it is why this route answers as it does.
//
// ═════════════════════════════════════════════════════════════════════════════
// ⚠️ WHAT THIS ENDPOINT BUYS TODAY: **NOTHING YET.** It is rung 2, and the ADR
// that governs it says so in its own one-sentence summary.
//
// [ADR 044] §5(2): `Paddle.Checkout.open({items:[{priceId, quantity}]})` opens a
// checkout with NO server-created transaction and NO API key on the request
// path. It exercises the identical payment-link and `_ptxn` machinery. "The
// server endpoint is therefore not a v1 dependency, which was the load-bearing
// surprise of this investigation." The owner then chose *both*, so this exists —
// but inventing a justification for it would be the dishonest move, so here is
// the real one, and it is a FUTURE tense:
//
//   · §5(3) — it earns its place when the transaction needs something the
//     overlay cannot pre-fill: a known `customer_id`, a discount, or
//     `custom_data` carrying our own account id.
//   · §6 — that last one is a FILED DEFECT, not a nicety. The single row in
//     `provider_notifications` today is a `subscription.created` simulation
//     whose `derive_error` reads *"unclaimed: no account is linked to paddle
//     subscription sub_…, and the notification carried no usable metadata"*.
//     A webhook arrived and we could not tell whose it was. This route is the
//     only place that fix can live, which is why the `custom_data` echo below
//     is a REFUSAL and not a log line.
//
// ⏱ 2026-10-01 · O-ST-HOSTED-CHECKOUT-CANNOT-START: the hosted rail CALLS it now
// (packages/purchases `HostedCheckoutRail` → `CheckoutSessionTransport` → this
// route) and opens the `checkout_url` it returns, so the attribution above rides
// on every hosted purchase. Both switches are still off — `paywall.enabled =
// false` portfolio-wide and [T-11] (renewal notices for two 30-day trials) still
// blocks the flip ([ADR 044] §5(4)). The route therefore answers 403
// `paywall_disabled` for every app today, BY DESIGN, and its open path is proven
// only by a test that supplies the KV override an owner would set. That is [pipeline C-6]
// applied to itself: a fail-closed seam whose open path is never exercised is a
// dead feature that reports healthy.
// ═════════════════════════════════════════════════════════════════════════════
//
// ── 🔴 THE HARD RULE, MADE STRUCTURAL RATHER THAN REMEMBERED ─────────────────
// NEVER `status: "billed"` ON CREATE. It mints an invoice number and an
// immutable tax record, and on a CARDLESS TRIAL — which both of our SKUs are —
// Paddle *"automatically completes the transaction and creates a subscription"*
// (developer.paddle.com/changelog/2025/cardless-trials-developer-preview/, cited
// by [ADR 044] §4). Both live prices carry `trial_period` 30 days with
// `requires_payment_method: true`, so the shape that bills a stranger is one
// JSON key away from the shape that bills nobody.
//
// A comment saying "don't" is what this repo calls a note, and a note only helps
// the session that reads it. So the request body TYPE has no settable `status`
// at all — `status?: never` means the only assignable value is `undefined`, and
// `{ …, status: 'billed' }` is a COMPILE ERROR at every call site. The runtime
// half is [serializeCreateTransactionBody], which refuses a `status` own-key on
// the object it is handed: types are erased at runtime, and a future caller that
// spreads parsed JSON into this shape would type-check while carrying the key.
// Both halves have a recorded failing input in test/checkout.test.ts — the
// compile half as a `@ts-expect-error` that FAILS `tsc` if the guard is ever
// removed (an unused expect-error is an error), the runtime half as a cast.
//
// ── THE MEASURED CONTRACT ([ADR 044] §3, live 2026-08-11, NOT re-probed here) ─
//   POST https://api.paddle.com/transactions
//   { "items": [ { "price_id": "pri_…", "quantity": 1 } ] }        ⇒ 201
//   data.status        = "draft"   (forced: no customer_id/address_id, no status)
//   data.checkout.url  = "https://nikatru.com/pricing.html?_ptxn=txn_…"
//
// `checkout.url` is DERIVED — the account's default payment link plus
// `?_ptxn=<transaction id>` — and it is NOT readable through any API (`/me`,
// `/account`, `/payouts` all answer 404 `invalid_url`), so the URL this route
// returns is only as good as a dashboard setting nothing here can verify. It is
// nullable in the contract, which is why an absent one is a refusal below rather
// than a `null` handed to a client.
//
// ⚠️ A TRANSACTION CANNOT BE DELETED. `PATCH {"status":"canceled"}` is the only
// retreat and the row persists ([ADR 044] §4, measured 200). Every refusal after
// the create has therefore already left a draft behind at Paddle. A draft bills
// nobody — no customer, no address, no payment method, `grand_total "0"` — so
// the blast radius of an orphan is a row in someone else's database, not money;
// the transaction id is logged on every such path so a human can cancel it. The
// same is true of a TIMEOUT, where we never learn the id at all: that is stated
// here rather than papered over, because it is the one outcome this design
// cannot make impossible.
//
// ── FAIL CLOSED ON EVERYTHING UPSTREAM ───────────────────────────────────────
// Any non-2xx, any unreadable body, any missing/implausible field, any status
// other than `draft`, any `custom_data` that did not come back — 502, and the
// caller gets `{ error: 'checkout_unavailable' }` with no upstream detail. There
// is no partial success: the response either carries a usable checkout URL for a
// transaction we can attribute, or it carries nothing.
// ─────────────────────────────────────────────────────────────────────────────
import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { MARKET_PATTERN, isKnownApp, isSellableExtension, resolvePaywall } from '../config';
import { readBoundedBody } from '../lib/body';
import { strictRateLimit, withinEdgeCeiling } from '../lib/edge-ceiling';
import { isMoneyEnvironment, type MoneyEnvironment } from '../lib/mor/contract';
import { checkoutThrough, railCan } from '../../../_shared/src/ports/payments';
import { checkoutRailFor, railFor } from '../ports';
import { RAIL_PRICE_AMOUNTS_MINOR, RAIL_PRICE_IDS, RAIL_PRICE_PENDING } from './rail-price-ids';

const checkout = new Hono<AppEnv>();

/**
 * An app id and an offering id. 1 KiB is generous for two short identifiers, and
 * the bound exists before the parse for the reason `lib/body.ts` records.
 *
 * @ceiling workers.maxRequestBodySize lte
 */
export const MAX_CHECKOUT_BODY_BYTES = 1024;

// PADDLE_API_BASE and PADDLE_API_KEY_PREFIX moved to src/lib/mor/paddle-cancel.ts on 2026-09-29
// (AB-M4-03): the cancel executor calls the same host with the same key, and one table has one home.

/**
 * ⏱ 2026-10-01 · port-pay-core: the key is now read BY NAME by the composition root
 * (src/ports.ts `railFor`) and handed to the rail; the name lives in lib/mor/paddle-rail.ts
 * `PADDLE_API_KEY_VAR`. The record below is kept as it was written, EXCEPT its "the read
 * below" paragraph, which the move made false and which is corrected in place (#1127
 * money review, finding 4).
 *
 * The env var holding the seller API key — the NAME, kept as a const because
 * every refusal below names it in a log line so an operator can act on it.
 *
 * 🔴 IT IS A DECLARED BINDING NOW, AND THE COMMENT THAT SAID OTHERWISE WAS
 * MEASURED FALSE. This const used to justify reading the value through
 * `(c.env as unknown as Record<string, string | undefined>)[…]` "exactly as
 * `routes/money.ts` reads a rail's destination secret", so `src/types.ts` would
 * not have to be widened. Measured 2026-08-25: the two are NOT symmetric.
 * money.ts reads by name because the name is DATA — `verifier.secretEnvVar`,
 * resolved at runtime from the `:provider` URL segment — and its secret is
 * declared in `Env` regardless. This route has ONE credential, known at compile
 * time. The cast bought nothing and cost discovery: an env sweep over
 * `services/platform/src` extracting every `env.[A-Z_]+` returned 19 names with
 * this one absent, and `.dev.vars.example` documented two values, neither of
 * them this — so a developer following the file verbatim got a Worker whose
 * POST /v1/checkout refuses with no hint the value existed anywhere.
 *
 * The read was therefore `c.env[PADDLE_API_KEY_VAR]`, a TYPED index. Since
 * port-pay-core there is no read in this file: the composition root's SecretReader reads
 * by name (the name is DATA there, as in money.ts). The compile-time tie moved with the
 * name: lib/mor/paddle-rail.ts declares `PADDLE_API_KEY_VAR = 'PADDLE_API_KEY' satisfies
 * keyof Env`, so deleting or renaming `Env.PADDLE_API_KEY` in `src/types.ts` makes
 * `npx tsc --noEmit` fail THERE, and test/payments-port.test.ts holds the name in
 * tooling/ports/payments.json's paddle `secrets`. Those are the checks; this paragraph
 * carries neither.
 *
 * 🔴 SET IT WITH `wrangler secret put PADDLE_API_KEY`, NEVER AS A COMMITTED VAR.
 * This repository is public and `.gitleaks.toml` carries rules for both key
 * prefixes. The value is the vault's `PADDLE_API_KEY_LIVE` — and the vault
 * QUOTES its values, so strip the quotes before pasting or the header goes out
 * as `Bearer "…"` and Cloudflare/Paddle answer with something that reads exactly
 * like a revoked token.
 */
/**
 * The server-derived ceiling for this route, keyed `edge:<colo>:<asn>`.
 *
 * ⏱ 2026-10-01 · O-ST-CHECKOUT-UNBOUNDED — BOUND NOW. This used to read "HONEST
 * GAP": no `CHECKOUT_CEILING_LIMITER` in `wrangler.jsonc`, so the route was
 * bounded by the auth boundary alone. It is declared at the top level and in
 * `env.sandbox`, each on its own namespace id, and test/wrangler-breaker.test.ts
 * fails if either entry goes. It still fails OPEN on an absent binding, like
 * every other edge ceiling: the fail-CLOSED bound is [CHECKOUT_USER_LIMITER_VAR].
 */
const CHECKOUT_LIMITER_VAR = 'CHECKOUT_CEILING_LIMITER';

/**
 * The per-USER bucket, keyed `checkout:<sub>` on the VERIFIED subject — this
 * route sits behind platformAuth, so the key is not a value the caller chose.
 *
 * 🔴 IT FAILS CLOSED (`strictRateLimit`), unlike the edge ceiling above. Every
 * accepted request creates a Paddle transaction that CANNOT BE DELETED, only
 * canceled, so an absent binding or a limiter fault answers 503 rather than
 * admitting a request nothing bounds. One account opening a checkout a handful
 * of times a minute is a person changing their mind; more is a script.
 */
const CHECKOUT_USER_LIMITER_VAR = 'CHECKOUT_USER_LIMITER';

/** Our own offering vocabulary. `[a-z][a-z0-9_]*`, same grammar as an app id. */
const OFFERING_ID_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;

/**
 * ⏱ 2026-10-01 · fix-india-rail-tax-data · The BUYER-DECLARED market: ISO 3166-1 alpha-2, upper
 * case. Anything else — absent, lower case, a name, a number — is null, and null sells through the
 * default rail. Never derived from cf.country (src/ports.ts `checkoutRailFor` records why).
 */
// The pattern is src/config.ts's, the one GET /config/:app?market= refuses by: a market the
// price book answers in rupees is a market this route sells through the India rail, never two spellings.
function declaredMarket(v: unknown): string | null {
  return typeof v === 'string' && MARKET_PATTERN.test(v) ? v : null;
}

// PADDLE_PRICE_IDS, RAIL_PRICE_AMOUNTS_MINOR and RAIL_PRICE_PENDING are RENDERED into
// ./rail-price-ids.ts from services/platform/src/app-config-data.json `prices` by
// tooling/catalog/render-rail-prices.mjs, whose --check fails on a hand edit and whose limb E
// refuses a rail id or one of those maps declared anywhere else under src/ (O-RAIL-PRICE-IDS-HAND-KEPT).
// Why each map exists, and why its amounts are a second copy on purpose, moved into that
// renderer's header verbatim. They are re-exported here for the tests and the grant path.
// ⏱ 2026-10-01 · port-pay-core: PADDLE_PRICE_IDS is no longer re-exported — a route names no rail's map.
// The payments port reads RAIL_PRICE_IDS[railId][appId][offeringId], rendered by the same tool.
export { RAIL_PRICE_AMOUNTS_MINOR, RAIL_PRICE_PENDING };

/**
 * ⏱ 2026-09-27 · The `one_time` offering a rail's price sells, or null — the map
 * src/lib/mor/grant.ts is handed (it may not import this route or config.ts).
 *
 * A price sells an offering when RAIL_PRICE_IDS[provider] maps that offering to it AND
 * the committed served config declares the offering with `term: "one_time"`. A
 * price that maps to a recurring offering, or to nothing, sells no one-time
 * offering, so a completed transaction for it grants nothing. The committed
 * config is read (no KV override): a webhook's meaning does not move with an
 * operator's display override.
 *
 * ⏱ 2026-10-01 · port-pay-core — A BEHAVIOUR CHANGE, NAMED (#1127 money review, nit 6).
 * This was Paddle-only (`provider !== 'paddle'` → null). It now consults
 * RAIL_PRICE_IDS[provider], so Razorpay's plan ids are in scope too. Effect today: none.
 * Razorpay's `parse` refuses every event, and its map holds plans, which are recurring,
 * so no Razorpay price resolves to a `one_time` offering.
 * ⏱ 2026-10-01 · fix-india-rail-tax-data: Razorpay's `parse` maps subscription / refund /
 * dispute events now, but never a `one_time` subject (its order path is not built), so the
 * effect is still none.
 */
export function oneTimeOfferingFor(
  provider: string,
  priceId: string,
): { appId: string; offeringId: string } | null {
  const byApp = RAIL_PRICE_IDS[provider];
  if (byApp === undefined) return null;
  for (const [appId, prices] of Object.entries(byApp)) {
    for (const [offeringId, id] of Object.entries(prices)) {
      if (id !== priceId) continue;
      const offerings = resolvePaywall(appId, null)?.offerings;
      const served = Array.isArray(offerings)
        ? offerings.find((o) => isPlainObject(o) && o.product_id === offeringId)
        : undefined;
      return isPlainObject(served) && served.term === 'one_time' ? { appId, offeringId } : null;
    }
  }
  return null;
}

// ⏱ 2026-10-01 · port-pay-core: ACCEPTED_CREATE_STATUSES, FORBIDDEN_CREATE_KEYS, the create-body
// TYPE (its four `?: never` keys), buildCreateTransactionBody and serializeCreateTransactionBody
// moved VERBATIM to src/lib/mor/paddle-rail.ts, behind `paddleRail`; so did the create call and
// PADDLE_CREATE_TIMEOUT_MS, MAX_CHECKOUT_URL_LEN and MAX_VENDOR_CODE_LEN. This route reaches the
// rail only through src/ports.ts `railFor`; test/paddle-rail-body.test.ts holds the bytes it sends.

// ─────────────────────────────────────────────────────────────────────────────
// The route.
// ─────────────────────────────────────────────────────────────────────────────

/** This deploy's money world, or null when it did not declare one. [5]M-12. */
function declaredMoneyWorld(raw: string | undefined): MoneyEnvironment | null {
  return isMoneyEnvironment(raw) ? raw : null;
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** The `product_id`s an app's resolved paywall actually offers. */
function servedOfferingIds(offerings: unknown): string[] {
  if (!Array.isArray(offerings)) return [];
  const out: string[] = [];
  for (const o of offerings) {
    if (!isPlainObject(o)) continue;
    const id = o.product_id;
    if (typeof id === 'string' && OFFERING_ID_PATTERN.test(id)) out.push(id);
  }
  return out;
}

checkout.post('/checkout', async (c) => {
  const userId = c.get('userId');
  const rid = c.get('requestId') ?? '-';

  // The ceiling first among the I/O steps, and BEFORE the subrequest: every
  // accepted request mints a transaction at Paddle that can only be canceled,
  // never deleted.
  if (!(await withinEdgeCeiling(c.env.CHECKOUT_CEILING_LIMITER, c, CHECKOUT_LIMITER_VAR))) {
    return c.json({ error: 'rate_limited' }, 429);
  }
  // The per-user bucket, after auth (userId is the verified subject) and before
  // any read or subrequest. FAILS CLOSED — see CHECKOUT_USER_LIMITER_VAR.
  const perUser = await strictRateLimit(
    c.env.CHECKOUT_USER_LIMITER,
    `checkout:${userId}`,
    CHECKOUT_USER_LIMITER_VAR,
  );
  if (perUser === 'over') return c.json({ error: 'rate_limited' }, 429);
  if (perUser === 'unavailable') return c.json({ error: 'checkout_unavailable' }, 503);

  const read = await readBoundedBody(c.req.raw, MAX_CHECKOUT_BODY_BYTES);
  if (!read.ok) return c.json({ error: read.error }, read.status);

  let body: unknown;
  try {
    body = JSON.parse(read.text);
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }
  if (!isPlainObject(body)) return c.json({ error: 'invalid_json' }, 400);

  // ⏱ 2026-10-01 · EXM-01: an app, or an extension with a committed paywall
  // (config.ts `resolvePaywall`). FullShot Pro is sold here and nowhere else.
  const appId = body.app_id;
  if (typeof appId !== 'string' || !(isKnownApp(appId) || isSellableExtension(appId))) {
    return c.json({ error: 'unknown_app' }, 404);
  }
  c.set('appId', appId); // [pipeline B-16] attribution, post-validation.

  const offeringId = body.offering_id;
  if (typeof offeringId !== 'string' || !OFFERING_ID_PATTERN.test(offeringId)) {
    return c.json({ error: 'unknown_offering' }, 404);
  }

  // Same refusal as every other money surface: there is no safe default for
  // which money world this deploy is. [5]M-12.
  const environment = declaredMoneyWorld(c.env.MONEY_ENVIRONMENT);
  if (environment === null) {
    console.error(
      `[checkout] rid=${rid} MONEY_ENVIRONMENT is ${JSON.stringify(c.env.MONEY_ENVIRONMENT)} — ` +
        "must be exactly 'live' or 'sandbox'. Refusing to create a transaction without knowing " +
        'which money world it would be created in.',
    );
    return c.json({ error: 'money_rail_not_configured' }, 503);
  }

  // THE PAYWALL SWITCH IS THE SERVER'S TOO, not just the client's. The same
  // resolved document GET /config/:app serves — compiled-in defaults overlaid
  // with the KV override — so a dormant paywall cannot be bypassed by calling
  // the API directly, and turning it on is one owner action in one place rather
  // than two that can disagree. [ADR 044] §5(4): both switches stay off until
  // [T-11] (renewal notices for the 30-day trials) is answered.
  //
  // ⬜ IT COSTS ONE KV READ PER REQUEST, INCLUDING TODAY'S 403s, and the paywall
  // state cannot be known without it — the config route's "decide from memory
  // before the KV read" lesson applies to the UNKNOWN-APP answer (which is
  // decided above, from the compiled-in registry) and not to this one. What
  // bounds the read is the two limiters above: the edge ceiling and the
  // fail-closed per-user bucket (O-ST-CHECKOUT-UNBOUNDED, 2026-10-01).
  const kvValue = await c.env.CONFIG_KV.get(`config:${appId}`);
  const paywall = resolvePaywall(appId, kvValue);
  if (paywall === null) return c.json({ error: 'unknown_app' }, 404);
  if (paywall?.enabled !== true) {
    return c.json({ error: 'paywall_disabled' }, 403);
  }

  // The offering has to be one this app actually sells…
  if (!servedOfferingIds(paywall.offerings).includes(offeringId)) {
    return c.json({ error: 'unknown_offering' }, 404);
  }
  // …and one the rail has a price for — the rail resolves its own price
  // (RAIL_PRICE_IDS[railId][appId][offeringId]) and refuses an unsellable offering. Which
  // rail sells is the rendered selection for the buyer's DECLARED market
  // (src/ports.ts `checkoutRailFor`), never a vendor named here.
  const market = declaredMarket(body.market);
  const railId = checkoutRailFor(market);
  const rail = railFor(railId, c.env);
  if (rail === null || !railCan(rail, 'checkout')) {
    console.error(`[checkout] rid=${rid} no payments adapter declares checkout for this deploy (market=${market ?? '-'} rail=${String(railId)}).`);
    return c.json({ error: 'checkout_not_configured' }, 503);
  }
  const out = await checkoutThrough(rail, { appId, offeringId, userId, market, environment });
  if (!out.ok) {
    console.error(`[checkout] rid=${rid} app=${appId} offering=${offeringId} rail=${rail.id} ${out.kind}: ${out.detail}`);
    // Nothing sent: OUR misconfiguration — no price for a served offering (503
    // offering_not_available) or no usable credential (503 checkout_not_configured).
    // Sent: the rail's answer was not a usable checkout (502, no upstream detail).
    if (!out.sent) {
      return c.json({ error: out.kind === 'invalid' ? 'offering_not_available' : 'checkout_not_configured' }, 503);
    }
    return c.json({ error: 'checkout_unavailable' }, 502);
  }

  return c.json({
    provider: rail.id,
    app_id: appId,
    offering_id: offeringId,
    transaction_id: out.reference,
    checkout_url: out.url,
  });
});

export default checkout;
