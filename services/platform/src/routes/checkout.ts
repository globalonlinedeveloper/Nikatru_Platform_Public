// ─────────────────────────────────────────────────────────────────────────────
// POST /v1/checkout — the Paddle CREATE-TRANSACTION server half. [ADR 044].
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
// And nothing calls it. Both switches are off — `paywall.enabled = false`
// portfolio-wide and [T-11] (renewal notices for two 30-day trials) still blocks
// the flip ([ADR 044] §5(4)). The route therefore answers 403 `paywall_disabled`
// for every app today, BY DESIGN, and its open path is proven only by a test
// that supplies the KV override an owner would set. That is [pipeline C-6]
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
import type { AppEnv, RateLimiterBinding } from '../types';
import { isKnownApp, resolveConfig } from '../config';
import { readBoundedBody } from '../lib/body';
import { withinEdgeCeiling } from '../lib/edge-ceiling';
import { isMoneyEnvironment, type MoneyEnvironment } from '../lib/mor/contract';
import { PADDLE_CUSTOM_DATA_APP_ID, PADDLE_CUSTOM_DATA_USER_ID } from '../lib/mor/paddle';

const checkout = new Hono<AppEnv>();

/**
 * An app id and an offering id. 1 KiB is generous for two short identifiers, and
 * the bound exists before the parse for the reason `lib/body.ts` records.
 *
 * @ceiling workers.maxRequestBodySize lte
 */
export const MAX_CHECKOUT_BODY_BYTES = 1024;

/**
 * How long we wait for `POST /transactions`.
 *
 * @ceiling none — a CLIENT-SIDE PATIENCE BUDGET, not a platform resource. There
 * is no Cloudflare limit on the other side of it for the arithmetic to check:
 * Workers bill CPU time, and this is wall-clock spent awaiting a subrequest. The
 * value is chosen against the consequence instead — a timeout may leave an
 * orphan draft nobody can name (see the header), so it is long enough that a
 * healthy call never trips it, and short enough that a hung upstream does not
 * hold a user's tap open indefinitely.
 */
export const PADDLE_CREATE_TIMEOUT_MS = 10_000;

/**
 * The widest `checkout.url` we will hand back.
 *
 * @ceiling none — an input SHAPE cap on a value we return rather than store, so
 * no platform budget moves with it. The measured URL is ~70 characters; 2048 is
 * the conventional URL ceiling and is generous by a factor of thirty.
 */
export const MAX_CHECKOUT_URL_LEN = 2048;

/** Bounds the vendor error CODE we copy into a log line. Never returned. */
/** @ceiling none — an input SHAPE cap on a log field. */
export const MAX_VENDOR_CODE_LEN = 64;

/**
 * The API host per money world. V11 in `lib/mor/paddle.ts`, from
 * developer.paddle.com/api-reference/about/authentication.
 *
 * Both members are present because [MoneyEnvironment] has two and a partial
 * record would make the sandbox branch a runtime `undefined` rather than a
 * type error. `sandbox` is unreachable on the deployed config
 * (`MONEY_ENVIRONMENT: "live"`, and `tooling/ci/assert-money-config.mjs` fails
 * the build on any other value there) — it is the shape, not a live rail.
 */
const PADDLE_API_BASE: Readonly<Record<MoneyEnvironment, string>> = {
  live: 'https://api.paddle.com',
  sandbox: 'https://sandbox-api.paddle.com',
};

/**
 * 🔴 THE CREDENTIAL MUST BELONG TO THE WORLD THE DEPLOY DECLARED. V11 again:
 * Paddle API keys are prefixed `pdl_live_apikey_` and `pdl_sdbx_apikey_`, and
 * unlike the destination secret (U2 — one documented prefix, no sandbox variant,
 * so the webhook guard deliberately cannot tell them apart) this pair IS
 * documented. So the one place the two worlds *can* be told apart is checked:
 * a live-declared deploy holding a sandbox key refuses rather than quietly
 * creating transactions in the wrong world. [5]M-12.
 *
 * Only the PREFIX is ever compared, and only against the key's own leading
 * characters — nothing here logs, returns or stores the value.
 */
const PADDLE_API_KEY_PREFIX: Readonly<Record<MoneyEnvironment, string>> = {
  live: 'pdl_live_apikey_',
  sandbox: 'pdl_sdbx_apikey_',
};

/**
 * The env var holding the seller API key. Read BY NAME off `c.env` rather than
 * through a typed field, exactly as `routes/money.ts` reads a rail's destination
 * secret: `src/types.ts` belongs to the Worker's binding contract and this route
 * does not need to widen it to work.
 *
 * 🔴 SET IT WITH `wrangler secret put PADDLE_API_KEY`, NEVER AS A COMMITTED VAR.
 * This repository is public and `.gitleaks.toml` carries rules for both key
 * prefixes. The value is the vault's `PADDLE_API_KEY_LIVE` — and the vault
 * QUOTES its values, so strip the quotes before pasting or the header goes out
 * as `Bearer "…"` and Cloudflare/Paddle answer with something that reads exactly
 * like a revoked token.
 */
const PADDLE_API_KEY_VAR = 'PADDLE_API_KEY';

/**
 * The OPTIONAL server-derived ceiling for this route, read by name for the same
 * reason as the key above.
 *
 * ⬜ HONEST GAP, STATED RATHER THAN HIDDEN: there is no `CHECKOUT_CEILING_LIMITER`
 * in `wrangler.jsonc` today, and `withinEdgeCeiling` fails OPEN on an absent
 * binding (it logs once per isolate and allows). So in production this route is
 * bounded by the auth boundary alone until that binding is added — which matters
 * more here than on a read route, because every accepted request creates a
 * Paddle transaction that CANNOT BE DELETED, only canceled. It is wired now, on
 * its own namespace name, so adding the binding is a config change rather than a
 * code change; the 429 branch is exercised in the tests today.
 */
const CHECKOUT_LIMITER_VAR = 'CHECKOUT_CEILING_LIMITER';

/** Our own offering vocabulary. `[a-z][a-z0-9_]*`, same grammar as an app id. */
const OFFERING_ID_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;

/**
 * OUR offering id → PADDLE's price id, per app. Measured live 2026-08-11 and
 * recorded in [ADR 044] §7:
 *   `pri_01kzew6dqmtv3jg33dy9m23g31` — Pro Monthly, 499 minor units USD / month
 *   `pri_01kzew6e0yec2rfvk561hmzbbz` — Pro Yearly, 1999 minor units USD / year
 * both under product `pro_01kzew6de0nhqncmgxj1qtfg0q`, both `trial_period` 30
 * days with `requires_payment_method: true`.
 *
 * 🔴 THE JOIN IS `custom_data.offering_id` ON PADDLE'S OWN PRICE, not a
 * coincidence of naming: both live prices carry `custom_data { app_id: "subly",
 * offering_id: "pro_monthly" | "pro_yearly" }`, which is what makes these two
 * lines checkable against the rail rather than asserted. [ADR 044] §7 records
 * that NO `pri_` id existed anywhere in this repo before now, so the app could
 * not name a Paddle price at all.
 *
 * ⚠️ A CALLER NEVER NAMES A PRICE. The body carries our offering id and the
 * server resolves it here, so no request can create a transaction for an
 * arbitrary price on the account — which is the difference between an endpoint
 * that sells two SKUs and one that sells whatever the client typed.
 *
 * ⬜ AND IT BELONGS IN `src/app-config-data.json`, BESIDE THE OFFERINGS IT MAPS.
 * It is here because that document is [pipeline 4]B-2's served-config data with
 * its own three readers and its own registry guard, and adding a vendor id to it
 * is a change to a shared file, not to this route. The cost of the split is that
 * two lists can disagree — so they are compared: `test/checkout.test.ts` asserts
 * this map covers EVERY offering the served config declares for every app it
 * names, and fails the moment a third SKU is added to one and not the other.
 */
export const PADDLE_PRICE_IDS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  subly: {
    pro_monthly: 'pri_01kzew6dqmtv3jg33dy9m23g31',
    pro_yearly: 'pri_01kzew6e0yec2rfvk561hmzbbz',
  },
};

/**
 * The statuses a CREATE is allowed to come back as.
 *
 * `draft` and nothing else, because that is what the request shape below
 * produces: *"Transactions are created as `ready` if they have an `address_id`,
 * `customer_id`, and `items`, otherwise they are created as `draft`"*
 * (developer.paddle.com/api-reference/transactions/create-transaction, quoted by
 * [ADR 044] §4). We send none of those two, so anything else means the request
 * that left this Worker was not the request this file describes — and the one
 * value that would be catastrophic, `billed`, is in exactly that set. Widening
 * this set is only correct alongside the request-shape change that produces the
 * new value.
 */
const ACCEPTED_CREATE_STATUSES: ReadonlySet<string> = new Set(['draft']);

/** The keys that must never appear on a create body. See the header. */
export const FORBIDDEN_CREATE_KEYS: readonly string[] = [
  'status',
  'customer_id',
  'address_id',
  'collection_mode',
];

// ─────────────────────────────────────────────────────────────────────────────
// THE REQUEST BODY TYPE — the deliverable. `status` is unsettable BY CONSTRUCTION.
// ─────────────────────────────────────────────────────────────────────────────

/** One line of the transaction. `price_id` is always server-resolved. */
export interface PaddleCreateItem {
  readonly price_id: string;
  readonly quantity: number;
}

/**
 * The metadata that travels back to us on every later subscription event, and
 * the whole reason rung 2 exists ([ADR 044] §6).
 *
 * 🔴 THE TWO KEYS COME FROM `lib/mor/paddle.ts`, IMPORTED, NOT RETYPED. That
 * adapter reads `custom_data[PADDLE_CUSTOM_DATA_USER_ID]` off an incoming
 * notification to resolve the account; if the writer and the reader spelled the
 * keys separately, the drift would show up as every payment landing in
 * `unclaimed_payments` with every test still green — which is precisely the
 * failure already sitting in the database. One constant, two ends.
 */
export type PaddleCheckoutCustomData = Readonly<
  Record<typeof PADDLE_CUSTOM_DATA_USER_ID | typeof PADDLE_CUSTOM_DATA_APP_ID, string>
>;

/**
 * The body of `POST /transactions`, in the ONLY shape this repo may send.
 *
 * 🔴 THE FOUR `?: never` FIELDS ARE THE POINT OF THIS FILE. `never` in an
 * optional position admits exactly one value — `undefined` — so every one of
 * these is a compile error rather than a review catch:
 *
 *     { items, custom_data, status: 'billed' }        ← mints an invoice
 *     { items, custom_data, customer_id: 'ctm_…' }    ← creates it `ready`
 *
 * `status` is the catastrophic one and the reason the technique is used at all.
 * The other three are here because they are the inputs that CHANGE the created
 * status away from `draft`, and a create whose status we do not control is a
 * create whose consequences we cannot state. Adding one later is a deliberate
 * edit to this type — and it must move [ACCEPTED_CREATE_STATUSES] with it, or
 * the route will (correctly) refuse its own new request shape.
 */
export interface PaddleCreateTransactionBody {
  readonly items: readonly PaddleCreateItem[];
  readonly custom_data: PaddleCheckoutCustomData;
  readonly status?: never;
  readonly customer_id?: never;
  readonly address_id?: never;
  readonly collection_mode?: never;
}

/**
 * The ONLY constructor of a create body. Takes our own vocabulary — a resolved
 * price id and the account this checkout is for — and nothing a caller sent.
 */
export function buildCreateTransactionBody(input: {
  priceId: string;
  userId: string;
  appId: string;
}): PaddleCreateTransactionBody {
  return Object.freeze({
    items: Object.freeze([Object.freeze({ price_id: input.priceId, quantity: 1 })]),
    custom_data: Object.freeze({
      [PADDLE_CUSTOM_DATA_USER_ID]: input.userId,
      [PADDLE_CUSTOM_DATA_APP_ID]: input.appId,
    }),
  });
}

/**
 * Serialise a create body, refusing one that carries a forbidden key.
 *
 * ⚠️ THIS IS NOT BELT-AND-BRACES ON THE TYPE, IT COVERS THE CASE THE TYPE CANNOT.
 * TypeScript is erased: an object built by `JSON.parse`, by a spread of caller
 * input, or through any `as` cast satisfies the compiler and still carries
 * `status` at runtime. That is the mistake a future edit actually makes, and it
 * is the input the negative test constructs. Throwing rather than deleting the
 * key: silently dropping it would hide the defect from the person who wrote it.
 */
export function serializeCreateTransactionBody(body: PaddleCreateTransactionBody): string {
  for (const key of FORBIDDEN_CREATE_KEYS) {
    if (Object.hasOwn(body, key)) {
      throw new Error(
        `paddle create-transaction body carries '${key}', which this repo never sends. ` +
          "status:'billed' mints an invoice number and an immutable tax record, and on a cardless " +
          'trial Paddle completes the transaction and creates a subscription. [ADR 044] §4',
      );
    }
  }
  return JSON.stringify(body);
}

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

/** A bounded, enumerable vendor error code for the log. Never returned. */
function vendorErrorCode(text: string): string {
  try {
    const body: unknown = JSON.parse(text);
    if (!isPlainObject(body)) return '-';
    const err = body.error;
    if (!isPlainObject(err)) return '-';
    const code = err.code;
    return typeof code === 'string' && code.length > 0 && code.length <= MAX_VENDOR_CODE_LEN
      ? code
      : '-';
  } catch {
    return '-';
  }
}

checkout.post('/checkout', async (c) => {
  const userId = c.get('userId');
  const rid = c.get('requestId') ?? '-';

  // The ceiling first among the I/O steps, and BEFORE the subrequest: every
  // accepted request mints a transaction at Paddle that can only be canceled,
  // never deleted.
  const limiter = (c.env as unknown as Record<string, RateLimiterBinding | undefined>)[
    CHECKOUT_LIMITER_VAR
  ];
  if (!(await withinEdgeCeiling(limiter, c, CHECKOUT_LIMITER_VAR))) {
    return c.json({ error: 'rate_limited' }, 429);
  }

  const read = await readBoundedBody(c.req.raw, MAX_CHECKOUT_BODY_BYTES);
  if (!read.ok) return c.json({ error: read.error }, read.status);

  let body: unknown;
  try {
    body = JSON.parse(read.text);
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }
  if (!isPlainObject(body)) return c.json({ error: 'invalid_json' }, 400);

  const appId = body.app_id;
  if (typeof appId !== 'string' || !isKnownApp(appId)) {
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
  // bounds the read is the ceiling above, which has no binding yet. Stated, not
  // hidden: see CHECKOUT_LIMITER_VAR.
  const kvValue = await c.env.CONFIG_KV.get(`config:${appId}`);
  const cfg = resolveConfig(appId, kvValue);
  if (cfg === null) return c.json({ error: 'unknown_app' }, 404);
  if (cfg.paywall?.enabled !== true) {
    return c.json({ error: 'paywall_disabled' }, 403);
  }

  // The offering has to be one this app actually sells…
  if (!servedOfferingIds(cfg.paywall.offerings).includes(offeringId)) {
    return c.json({ error: 'unknown_offering' }, 404);
  }
  // …and one the rail has a price for. A served offering with no price id is OUR
  // misconfiguration, not the caller's request being wrong, so it is a 503 with
  // a loud log rather than a 404 that blames them.
  const priceId = PADDLE_PRICE_IDS[appId]?.[offeringId];
  if (priceId === undefined) {
    console.error(
      `[checkout] rid=${rid} app=${appId} offering=${offeringId} is served by the config but has no ` +
        'Paddle price id in PADDLE_PRICE_IDS. The served offerings and the rail mapping have drifted.',
    );
    return c.json({ error: 'offering_not_available' }, 503);
  }

  const apiKey = (c.env as unknown as Record<string, string | undefined>)[PADDLE_API_KEY_VAR] ?? '';
  if (apiKey.length === 0) {
    console.error(
      `[checkout] rid=${rid} ${PADDLE_API_KEY_VAR} is not set — refusing. ` +
        `Set it with \`wrangler secret put ${PADDLE_API_KEY_VAR}\`.`,
    );
    return c.json({ error: 'checkout_not_configured' }, 503);
  }
  if (!apiKey.startsWith(PADDLE_API_KEY_PREFIX[environment])) {
    // Deliberately does NOT print the key or its actual prefix: the point is
    // that the credential does not belong to the declared world, and naming the
    // expected prefix is enough to fix it.
    console.error(
      `[checkout] rid=${rid} ${PADDLE_API_KEY_VAR} does not carry the ` +
        `'${PADDLE_API_KEY_PREFIX[environment]}' prefix this deploy's MONEY_ENVIRONMENT='${environment}' ` +
        'requires. Refusing rather than creating a transaction in the other money world. [5]M-12',
    );
    return c.json({ error: 'checkout_not_configured' }, 503);
  }

  const requestBody = buildCreateTransactionBody({ priceId, userId, appId });

  let res: Response;
  try {
    res = await fetch(`${PADDLE_API_BASE[environment]}/transactions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        // PINNED. [ADR 044] §3 measured 200 with and without, so this is not
        // required — but an unpinned vendor API is one whose response shape can
        // change under a deploy that changed nothing.
        'Paddle-Version': '1',
      },
      body: serializeCreateTransactionBody(requestBody),
      signal: AbortSignal.timeout(PADDLE_CREATE_TIMEOUT_MS),
    });
  } catch (err) {
    // Includes the timeout. ⚠️ THE TRANSACTION MAY EXIST ANYWAY and we will never
    // learn its id — a draft bills nobody, but it is an orphan row at Paddle.
    console.error(
      `[checkout] rid=${rid} app=${appId} offering=${offeringId} — POST /transactions did not complete. ` +
        'If it reached Paddle, a DRAFT transaction may exist that this request never saw.',
      err,
    );
    return c.json({ error: 'checkout_unavailable' }, 502);
  }

  const text = await res.text().catch(() => '');
  if (!res.ok) {
    console.error(
      `[checkout] rid=${rid} app=${appId} offering=${offeringId} — Paddle answered ${res.status}, ` +
        `code=${vendorErrorCode(text)}. Refusing; no partial success is reported to the caller.`,
    );
    return c.json({ error: 'checkout_unavailable' }, 502);
  }

  let envelope: unknown;
  try {
    envelope = JSON.parse(text);
  } catch {
    console.error(`[checkout] rid=${rid} — Paddle answered ${res.status} with a body that is not JSON.`);
    return c.json({ error: 'checkout_unavailable' }, 502);
  }
  const data = isPlainObject(envelope) ? envelope.data : undefined;
  if (!isPlainObject(data)) {
    console.error(`[checkout] rid=${rid} — Paddle's 2xx body carries no \`data\` object.`);
    return c.json({ error: 'checkout_unavailable' }, 502);
  }

  const transactionId = typeof data.id === 'string' && /^txn_[A-Za-z0-9]+$/.test(data.id) ? data.id : null;

  // 🔴 THE STATUS CHECK IS THE LOUD ONE. Reaching here with anything but `draft`
  // means the request that left this Worker was not the request above — and the
  // value that would matter most, `billed`, is a live invoice and a tax record.
  // Refusing does not undo it; the log is what surfaces it to a human.
  const status = typeof data.status === 'string' ? data.status : '';
  if (!ACCEPTED_CREATE_STATUSES.has(status)) {
    console.error(
      `[checkout] rid=${rid} app=${appId} — Paddle created transaction ${transactionId ?? '(unnamed)'} ` +
        `with status '${status}', not 'draft'. The create shape sends no customer_id, address_id or ` +
        'status, so this must not happen. CANCEL IT: PATCH /transactions/<id> {"status":"canceled"}.',
    );
    return c.json({ error: 'checkout_unavailable' }, 502);
  }

  // 🔴 THE ATTRIBUTION ECHO. This is the entire justification for rung 2 ([ADR
  // 044] §6): if `custom_data` did not come back, the subscription events that
  // follow will carry no account id either, and every one of them will land in
  // `unclaimed_payments` exactly as the one row already in the database did.
  // Returning a checkout URL anyway would ship that defect again while looking
  // like a success, so an un-echoed metadata block is a REFUSAL.
  const echoed = isPlainObject(data.custom_data) ? data.custom_data : {};
  if (
    echoed[PADDLE_CUSTOM_DATA_USER_ID] !== userId ||
    echoed[PADDLE_CUSTOM_DATA_APP_ID] !== appId
  ) {
    console.error(
      `[checkout] rid=${rid} app=${appId} — transaction ${transactionId ?? '(unnamed)'} came back without ` +
        'our custom_data. Every subscription event for it would be unattributable ([ADR 044] §6), so the ' +
        'checkout is refused. CANCEL IT: PATCH /transactions/<id> {"status":"canceled"}.',
    );
    return c.json({ error: 'checkout_unavailable' }, 502);
  }

  const rawUrl = isPlainObject(data.checkout) ? data.checkout.url : undefined;
  const checkoutUrl =
    typeof rawUrl === 'string' &&
    rawUrl.length > 0 &&
    rawUrl.length <= MAX_CHECKOUT_URL_LEN &&
    rawUrl.startsWith('https://')
      ? rawUrl
      : null;

  if (transactionId === null || checkoutUrl === null) {
    // `checkout.url` is documented nullable — present for automatically-collected
    // transactions, and for manual ones only when `billing_details.enable_checkout`
    // is true ([ADR 044] §3). It is DERIVED from the account's default payment
    // link, which no API exposes, so a null here is a dashboard fact this Worker
    // cannot read and must not paper over.
    console.error(
      `[checkout] rid=${rid} app=${appId} — created transaction ${transactionId ?? '(unnamed)'} carries no ` +
        'usable checkout url. It is UNUSED and should be canceled: PATCH /transactions/<id> ' +
        '{"status":"canceled"}. Check the account default payment link.',
    );
    return c.json({ error: 'checkout_unavailable' }, 502);
  }

  return c.json({
    provider: 'paddle',
    app_id: appId,
    offering_id: offeringId,
    transaction_id: transactionId,
    checkout_url: checkoutUrl,
  });
});

export default checkout;
