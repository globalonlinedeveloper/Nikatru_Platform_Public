// ─────────────────────────────────────────────────────────────────────────────
// ⏱ 2026-10-01 · fix-india-rail-tax-data · RAZORPAY, OUTBOUND — an adapter of the payments port.
//
// `razorpayRail` is Razorpay's `RailOutbound` (services/_shared/src/ports/payments.ts):
// checkout (a Razorpay SUBSCRIPTION the buyer authorises on OUR apex checkout page) and cancel
// at the cycle end. It is reached ONLY through the Worker's composition root, src/ports.ts
// `railFor` — assert-ports limb 4 refuses any other module importing this file — and it is
// selected for web checkout only when the BUYER DECLARES market `IN` (src/ports.ts
// `checkoutRailFor`, from the rendered CHECKOUT_RAIL_BY_MARKET). [ADR 076]: India domestic
// web sales run on Razorpay; Nikatru is the seller of record on this rail and issues the GST
// invoice itself ([ADR 076] §10.1) — Razorpay only collects. Row O-RAZORPAY-CHECKOUT-ADAPTER.
//
// ── THE VENDOR CALLS, AND WHERE THEIR SHAPES COME FROM ───────────────────────
// ⚠️ Written against Razorpay's public API reference as the author knows it; the pages were
// NOT re-read on 2026-10-01 (razorpay.com/docs pages answered 404 from the build sandbox), so
// every shape below is UNCONFIRMED until the first test-mode call, and every vendor answer is
// validated rather than trusted — an unexpected shape is a refusal, never a partial success.
//   · AUTH     HTTP Basic, `<key_id>:<key_secret>` (razorpay.com/docs/api/authentication/).
//              Key ids carry `rzp_test_` (test mode) or `rzp_live_` (live) — the prefix is
//              checked against MONEY_ENVIRONMENT so a sandbox deploy never creates live money.
//   · CREATE   POST https://api.razorpay.com/v1/subscriptions
//              { plan_id, total_count, customer_notify: 1, notes: {...} } → the subscription
//              entity: `id` (`sub_…`), `status` `created`, `notes` echoed
//              (razorpay.com/docs/api/payments/subscriptions/create-subscription/).
//   · THE URL  ⏱ 2026-10-02 · PR #1149 ruling item 3 (design.md §1.6): the checkout URL
//              is OUR page, `https://nikatru.com/checkout/?provider=razorpay&sub=<id>`, which
//              loads Checkout.js with { key, subscription_id } — NEVER Razorpay's hosted
//              `short_url`, which this file does not read. The main website is the
//              Razorpay-approved one, and every app checks out on that one apex path, so
//              O-RAZORPAY-WEBSITE-CAP-PATHS is never raised. The host allow-list is
//              `nikatru.com` only. The apex page itself is design PR E, not built here.
//   · CANCEL   POST https://api.razorpay.com/v1/subscriptions/<id>/cancel
//              { cancel_at_cycle_end: 1 } → the subscription entity; access runs to
//              `current_end` (razorpay.com/docs/api/payments/subscriptions/cancel-subscription/).
//              A second cancel of an already-cancelled subscription is answered by Razorpay
//              with an error (as recalled), so a non-2xx is followed by ONE read
//              (GET /v1/subscriptions/<id>): a subscription already `cancelled` / `completed`
//              is the same receipt, which is what makes the verb idempotent.
//   · NOTES    { user_id, app_id, offering_id, env } — the keys lib/mor/razorpay.ts reads back
//              off every subscription webhook (imported, never retyped). `env` is the money
//              world, the one cross-world signal a Razorpay body can carry (razorpay.ts header).
//
// ── WHAT IS NOT BUILT, NAMED ─────────────────────────────────────────────────
//   · The ONE-TIME ORDER path (POST /v1/orders) is not built: the rail sells subscription
//     plans only, and an offering with no plan id is `invalid`, nothing sent.
//   · refund / reconcile are not declared (and so not implemented — `railCan`).
//   · RAIL_PRICE_IDS.razorpay is EMPTY today (every Razorpay price in app-config-data.json is
//     `pending`), so every real checkout answers `invalid`, nothing sent. That is correct: no
//     plan id is invented here; render-rail-prices.mjs fills the map when the plans exist.
// ─────────────────────────────────────────────────────────────────────────────
import type {
  CancelReceipt,
  CancelRequest,
  CheckoutRequest,
  CheckoutSession,
  Outcome,
  RailFactory,
  RailOutbound,
  SecretReader,
} from '../../../../_shared/src/ports/payments';
import { notSent } from '../../../../_shared/src/ports/payments';
import type { MoneyEnvironment } from './contract';
import type { Env } from '../../types';
import { RAZORPAY_NOTE_APP_ID, RAZORPAY_NOTE_ENV, RAZORPAY_NOTE_OFFERING_ID, RAZORPAY_NOTE_USER_ID } from './razorpay';
import { RAIL_PRICE_IDS } from '../../routes/rail-price-ids';

/** The registry's adapter id (tooling/ports/payments.json). */
export const RAZORPAY_RAIL_ID = 'razorpay';

/** The API key pair, by NAME (read through the port's SecretReader). `satisfies keyof Env` ties each to src/types.ts. */
export const RAZORPAY_KEY_ID_VAR = 'RAZORPAY_KEY_ID' satisfies keyof Env;
export const RAZORPAY_KEY_SECRET_VAR = 'RAZORPAY_KEY_SECRET' satisfies keyof Env;

export const RAZORPAY_API_BASE = 'https://api.razorpay.com/v1';

/** The key-id prefix each money world requires. Never the key. */
export const RAZORPAY_KEY_ID_PREFIX: Readonly<Record<MoneyEnvironment, string>> = { live: 'rzp_live_', sandbox: 'rzp_test_' };

/** The hosts a returned checkout URL may live on: the apex alone (design.md §1.6, PR #1149 ruling item 3). */
export const RAZORPAY_CHECKOUT_HOSTS: readonly string[] = ['nikatru.com'];

/** OUR checkout page, which loads Checkout.js with the subscription id — never Razorpay's hosted `short_url`. */
export const RAZORPAY_CHECKOUT_PAGE = 'https://nikatru.com/checkout/';

/** The apex checkout URL for one subscription: `?provider=razorpay&sub=<id>`. Exported for the tests. */
export function razorpayCheckoutUrl(subscriptionId: string): string {
  const u = new URL(RAZORPAY_CHECKOUT_PAGE);
  u.searchParams.set('provider', RAZORPAY_RAIL_ID);
  u.searchParams.set('sub', subscriptionId);
  return u.toString();
}

/**
 * How many billing cycles the subscription is created for (`total_count`, required on create).
 * @ceiling none — a mandate span chosen by us, not a platform resource. 60 cycles is five years
 * monthly; Razorpay caps the span per payment method (UPI AutoPay among them), which is UNCONFIRMED
 * here — the first test-mode create decides whether this must move.
 */
export const RAZORPAY_TOTAL_COUNT = 60;

/** @ceiling none — a CLIENT-SIDE PATIENCE BUDGET for one subrequest, as paddle-rail.ts records for its own. */
export const RAZORPAY_TIMEOUT_MS = 10_000;

/** @ceiling none — an input SHAPE cap on a URL we return. */
const MAX_CHECKOUT_URL_LEN = 2048;

const SUBSCRIPTION_ID = /^sub_[A-Za-z0-9]{1,40}$/;

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Resolve OUR offering to Razorpay's plan id, or undefined when the rail does not sell it. */
export type RazorpayPlanResolver = (appId: string, offeringId: string) => string | undefined;

export interface RazorpayRailOptions {
  /** Defaults to RAIL_PRICE_IDS.razorpay (rendered; empty today). Tests inject a fixture plan. */
  planFor?: RazorpayPlanResolver;
  /** Defaults to the global fetch, read at call time (so a test's stub is honoured). */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

const defaultPlanFor: RazorpayPlanResolver = (appId, offeringId) => RAIL_PRICE_IDS[RAZORPAY_RAIL_ID]?.[appId]?.[offeringId];

type Keys = { ok: true; auth: string } | { ok: false; out: Outcome<never> };

/** The Basic credential for this world, or a not-sent refusal. Never prints the key or its prefix. */
function keysFor(secrets: SecretReader, environment: MoneyEnvironment): Keys {
  const id = secrets(RAZORPAY_KEY_ID_VAR) ?? '';
  const secret = secrets(RAZORPAY_KEY_SECRET_VAR) ?? '';
  if (id.length === 0 || secret.length === 0) {
    return {
      ok: false,
      out: notSent('unavailable', `${RAZORPAY_KEY_ID_VAR} / ${RAZORPAY_KEY_SECRET_VAR} are not both set — refusing (fail closed). Set them with \`wrangler secret put\`.`),
    };
  }
  if (!id.startsWith(RAZORPAY_KEY_ID_PREFIX[environment])) {
    return {
      ok: false,
      out: notSent(
        'unavailable',
        `${RAZORPAY_KEY_ID_VAR} does not carry the '${RAZORPAY_KEY_ID_PREFIX[environment]}' prefix this deploy's MONEY_ENVIRONMENT='${environment}' requires. ` +
          'Refusing rather than creating a subscription in the other money world. [5]M-12',
      ),
    };
  }
  return { ok: true, auth: `Basic ${btoa(`${id}:${secret}`)}` };
}

const sentFailure = (detail: string, kind: 'refused' | 'unavailable' | 'timeout' = 'refused'): Outcome<never> => ({
  ok: false,
  kind,
  retryable: kind !== 'refused',
  sent: true,
  detail,
});

/** One call with a timeout; a transport failure is an outcome, never a throw. */
async function call(
  opts: RazorpayRailOptions,
  auth: string,
  method: 'GET' | 'POST',
  path: string,
  body: unknown,
): Promise<{ ok: true; status: number; json: unknown } | { ok: false; out: Outcome<never> }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? RAZORPAY_TIMEOUT_MS);
  const doFetch = opts.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await doFetch(`${RAZORPAY_API_BASE}${path}`, {
      method,
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: controller.signal,
    });
  } catch (err) {
    const aborted = controller.signal.aborted || (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError'));
    // ⚠️ A create that timed out MAY exist at Razorpay in `created` status; it bills nobody
    // until a buyer authorises it, and it expires unauthorised.
    return { ok: false, out: sentFailure(`${method} ${path.replace(/sub_[A-Za-z0-9]+/, 'sub_…')} did not complete (${aborted ? 'timeout' : 'transport error'}).`, aborted ? 'timeout' : 'unavailable') };
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text().catch(() => '');
  let json: unknown = null;
  try {
    json = text.length > 0 ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { ok: true, status: res.status, json };
}

/** Unix seconds → ISO, or null. */
function unixIso(v: unknown): string | null {
  return typeof v === 'number' && Number.isInteger(v) && v > 0 ? new Date(v * 1000).toISOString() : null;
}

async function createRazorpayCheckout(secrets: SecretReader, opts: RazorpayRailOptions, req: CheckoutRequest): Promise<Outcome<CheckoutSession>> {
  const { appId, offeringId, userId, environment } = req;
  const planId = (opts.planFor ?? defaultPlanFor)(appId, offeringId);
  if (planId === undefined) {
    return notSent('invalid', `app=${appId} offering=${offeringId} has no Razorpay plan id in RAIL_PRICE_IDS.razorpay; nothing was sent.`);
  }
  const keys = keysFor(secrets, environment);
  if (!keys.ok) return keys.out;

  const notes = {
    [RAZORPAY_NOTE_USER_ID]: userId,
    [RAZORPAY_NOTE_APP_ID]: appId,
    [RAZORPAY_NOTE_OFFERING_ID]: offeringId,
    [RAZORPAY_NOTE_ENV]: environment,
  };
  const r = await call(opts, keys.auth, 'POST', '/subscriptions', {
    plan_id: planId,
    total_count: RAZORPAY_TOTAL_COUNT,
    customer_notify: 1,
    notes,
  });
  if (!r.ok) return r.out;
  if (r.status < 200 || r.status > 299) {
    return sentFailure(`app=${appId} offering=${offeringId} — Razorpay answered ${r.status} to the subscription create. Refusing; no partial success is reported.`);
  }
  const sub = r.json;
  if (!isPlainObject(sub)) return sentFailure('Razorpay answered 2xx with a body that is not a JSON object.');
  const id = typeof sub.id === 'string' && SUBSCRIPTION_ID.test(sub.id) ? sub.id : null;
  if (sub.status !== 'created') {
    return sentFailure(`app=${appId} — Razorpay created subscription ${id ?? '(unnamed)'} with status ${JSON.stringify(sub.status)}, not 'created'. Cancel it.`);
  }
  // 🔴 THE ATTRIBUTION ECHO: a subscription whose notes did not come back can never be attributed.
  const echoed = isPlainObject(sub.notes) ? sub.notes : {};
  if (echoed[RAZORPAY_NOTE_USER_ID] !== userId || echoed[RAZORPAY_NOTE_APP_ID] !== appId || echoed[RAZORPAY_NOTE_ENV] !== environment) {
    return sentFailure(`app=${appId} — subscription ${id ?? '(unnamed)'} came back without our notes; every webhook for it would be unattributable, so the checkout is refused. Cancel it.`);
  }
  if (id === null) {
    return sentFailure(`app=${appId} — Razorpay created a subscription with no usable sub_ id. Cancel it.`);
  }
  // OUR apex page, never the vendor's hosted `short_url` (see THE URL in the header).
  const url = razorpayCheckoutUrl(id);
  const host = new URL(url).host;
  if (url.length > MAX_CHECKOUT_URL_LEN || !RAZORPAY_CHECKOUT_HOSTS.includes(host)) {
    return sentFailure(`app=${appId} — the checkout URL for ${id} is not on ${RAZORPAY_CHECKOUT_HOSTS.join(' / ')}. Cancel it.`);
  }
  return { ok: true, url, reference: id };
}

async function cancelRazorpayAtCycleEnd(secrets: SecretReader, opts: RazorpayRailOptions, req: CancelRequest): Promise<Outcome<CancelReceipt>> {
  if (req.when !== 'period_end') return notSent('invalid', 'only a period-end cancel is ever made (INV-514)');
  if (!SUBSCRIPTION_ID.test(req.subscriptionRef)) return notSent('invalid', 'the subscription reference is not a Razorpay sub_ id; nothing was sent.');
  const keys = keysFor(secrets, req.environment);
  if (!keys.ok) return keys.out;
  const path = `/subscriptions/${req.subscriptionRef}`;
  const r = await call(opts, keys.auth, 'POST', `${path}/cancel`, { cancel_at_cycle_end: 1 });
  if (!r.ok) return r.out;
  if (r.status >= 200 && r.status <= 299) {
    const sub = r.json;
    if (!isPlainObject(sub) || sub.id !== req.subscriptionRef) {
      return sentFailure('Razorpay answered the cancel 2xx with a body that does not name the subscription.', 'unavailable');
    }
    return { ok: true, effectiveAt: unixIso(sub.current_end) ?? unixIso(sub.ended_at) };
  }
  // Already cancelled? One read decides, which is what makes a repeated cancel the same receipt.
  const read = await call(opts, keys.auth, 'GET', path, undefined);
  if (!read.ok) return read.out;
  const sub = read.json;
  if (read.status >= 200 && read.status <= 299 && isPlainObject(sub) && sub.id === req.subscriptionRef && (sub.status === 'cancelled' || sub.status === 'completed')) {
    return { ok: true, effectiveAt: unixIso(sub.current_end) ?? unixIso(sub.ended_at) };
  }
  return { ok: false, kind: 'refused', retryable: true, sent: true, detail: `Razorpay answered the cancel ${r.status}, and the subscription does not read as cancelled.` };
}

/** Razorpay's outbound rail, with test seams (a plan resolver, a fetch). */
export function makeRazorpayRail(secrets: SecretReader, opts: RazorpayRailOptions = {}): RailOutbound {
  return {
    id: RAZORPAY_RAIL_ID,
    capabilities: new Set(['checkout', 'cancel'] as const),
    createCheckout: (req) => createRazorpayCheckout(secrets, opts, req),
    cancel: (req) => cancelRazorpayAtCycleEnd(secrets, opts, req),
  };
}

/** The composition root's factory: secrets in, a rail out. This file never sees `Env`. */
export const razorpayRail: RailFactory = (secrets) => makeRazorpayRail(secrets);
