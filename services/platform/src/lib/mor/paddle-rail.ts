// ─────────────────────────────────────────────────────────────────────────────
// ⏱ 2026-10-01 · port-pay-core · PADDLE, OUTBOUND — an adapter of the payments port.
//
// `paddleRail` is Paddle's `RailOutbound` (services/_shared/src/ports/payments.ts):
// checkout (POST /transactions, [ADR 044]) and cancel at the period end
// (lib/mor/paddle-cancel.ts, AB-M4-03). It is reached ONLY through the Worker's
// composition root, src/ports.ts `railFor` — assert-ports limb 4 refuses any other
// module importing this file or paddle-cancel.ts, so no route names the vendor.
//
// WHAT MOVED, AND WHAT DID NOT. The create-body TYPE (four `?: never` keys), its one
// constructor and its refusing serializer moved here VERBATIM from routes/checkout.ts,
// whose header still carries the measured contract and the hard rule (NEVER
// `status: "billed"` on create). test/paddle-rail-body.test.ts holds the serialized
// body byte-identical to the bytes recorded before the move. The route keeps every
// status code it answered; this adapter answers in outcomes, never throws.
// ─────────────────────────────────────────────────────────────────────────────
import type {
  CancelReceipt,
  CancelRequest,
  CheckoutRequest,
  CheckoutSession,
  Outcome,
  RailOutbound,
  RailFactory,
} from '../../../../_shared/src/ports/payments';
import { notSent } from '../../../../_shared/src/ports/payments';
import { PADDLE_CUSTOM_DATA_APP_ID, PADDLE_CUSTOM_DATA_USER_ID } from './paddle';
import { PADDLE_API_BASE, PADDLE_API_KEY_PREFIX, cancelPaddleSubscription } from './paddle-cancel';
import { RAIL_PRICE_IDS } from '../../routes/rail-price-ids';

/** The registry's adapter id (tooling/ports/payments.json). */
export const PADDLE_RAIL_ID = 'paddle';

/**
 * The env var holding the seller API key — the NAME. The composition root reads it by
 * name through the port's SecretReader; routes/checkout.ts's header records why it is
 * a declared `Env` binding and how it is set (`wrangler secret put PADDLE_API_KEY`).
 */
export const PADDLE_API_KEY_VAR = 'PADDLE_API_KEY';

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
export const ACCEPTED_CREATE_STATUSES: ReadonlySet<string> = new Set(['draft']);

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

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

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

/**
 * Create a Paddle checkout: resolve OUR offering to Paddle's price, POST a draft
 * transaction carrying our account in `custom_data`, and accept only a `draft` that
 * echoed that metadata and carries a usable URL. Every refusal the route made before
 * the move is an outcome here, in the same order; `detail` is log-safe (never the key).
 */
async function createPaddleCheckout(apiKeyRaw: string | undefined, req: CheckoutRequest): Promise<Outcome<CheckoutSession>> {
  const { appId, offeringId, userId, environment } = req;
  // …one the rail has a price for. A served offering with no price id is OUR
  // misconfiguration, not the caller's request being wrong.
  const priceId = RAIL_PRICE_IDS[PADDLE_RAIL_ID]?.[appId]?.[offeringId];
  if (priceId === undefined) {
    return notSent(
      'invalid',
      `app=${appId} offering=${offeringId} is served by the config but has no Paddle price id in ` +
        'RAIL_PRICE_IDS.paddle. The served offerings and the rail mapping have drifted.',
    );
  }

  const apiKey = apiKeyRaw ?? '';
  if (apiKey.length === 0) {
    return notSent(
      'unavailable',
      `${PADDLE_API_KEY_VAR} is not set — refusing. Set it with \`wrangler secret put ${PADDLE_API_KEY_VAR}\`.`,
    );
  }
  if (!apiKey.startsWith(PADDLE_API_KEY_PREFIX[environment])) {
    // Deliberately does NOT print the key or its actual prefix.
    return notSent(
      'unavailable',
      `${PADDLE_API_KEY_VAR} does not carry the '${PADDLE_API_KEY_PREFIX[environment]}' prefix this deploy's ` +
        `MONEY_ENVIRONMENT='${environment}' requires. Refusing rather than creating a transaction in the other money world. [5]M-12`,
    );
  }

  const requestBody = buildCreateTransactionBody({ priceId, userId, appId });
  const upstream = (detail: string, kind: 'refused' | 'unavailable' | 'timeout' = 'refused'): Outcome<never> => ({
    ok: false,
    kind,
    retryable: kind !== 'refused',
    sent: true,
    detail,
  });

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
    return upstream(
      `app=${appId} offering=${offeringId} — POST /transactions did not complete ` +
        `(${err instanceof Error ? err.name : 'error'}). If it reached Paddle, a DRAFT transaction may exist that this request never saw.`,
      err instanceof Error && err.name === 'TimeoutError' ? 'timeout' : 'unavailable',
    );
  }

  const text = await res.text().catch(() => '');
  if (!res.ok) {
    return upstream(
      `app=${appId} offering=${offeringId} — Paddle answered ${res.status}, code=${vendorErrorCode(text)}. ` +
        'Refusing; no partial success is reported to the caller.',
    );
  }

  let envelope: unknown;
  try {
    envelope = JSON.parse(text);
  } catch {
    return upstream(`Paddle answered ${res.status} with a body that is not JSON.`);
  }
  const data = isPlainObject(envelope) ? envelope.data : undefined;
  if (!isPlainObject(data)) return upstream("Paddle's 2xx body carries no `data` object.");

  const transactionId = typeof data.id === 'string' && /^txn_[A-Za-z0-9]+$/.test(data.id) ? data.id : null;

  // 🔴 THE STATUS CHECK IS THE LOUD ONE (routes/checkout.ts header).
  const status = typeof data.status === 'string' ? data.status : '';
  if (!ACCEPTED_CREATE_STATUSES.has(status)) {
    return upstream(
      `app=${appId} — Paddle created transaction ${transactionId ?? '(unnamed)'} with status '${status}', not 'draft'. ` +
        'The create shape sends no customer_id, address_id or status, so this must not happen. ' +
        'CANCEL IT: PATCH /transactions/<id> {"status":"canceled"}.',
    );
  }

  // 🔴 THE ATTRIBUTION ECHO ([ADR 044] §6): an un-echoed metadata block is a REFUSAL.
  const echoed = isPlainObject(data.custom_data) ? data.custom_data : {};
  if (echoed[PADDLE_CUSTOM_DATA_USER_ID] !== userId || echoed[PADDLE_CUSTOM_DATA_APP_ID] !== appId) {
    return upstream(
      `app=${appId} — transaction ${transactionId ?? '(unnamed)'} came back without our custom_data. Every ` +
        'subscription event for it would be unattributable ([ADR 044] §6), so the checkout is refused. ' +
        'CANCEL IT: PATCH /transactions/<id> {"status":"canceled"}.',
    );
  }

  const rawUrl = isPlainObject(data.checkout) ? data.checkout.url : undefined;
  const checkoutUrl =
    typeof rawUrl === 'string' && rawUrl.length > 0 && rawUrl.length <= MAX_CHECKOUT_URL_LEN && rawUrl.startsWith('https://')
      ? rawUrl
      : null;
  if (transactionId === null || checkoutUrl === null) {
    // `checkout.url` is documented nullable and DERIVED from the account's default
    // payment link, which no API exposes ([ADR 044] §3).
    return upstream(
      `app=${appId} — created transaction ${transactionId ?? '(unnamed)'} carries no usable checkout url. It is ` +
        'UNUSED and should be canceled: PATCH /transactions/<id> {"status":"canceled"}. Check the account default payment link.',
    );
  }
  return { ok: true, url: checkoutUrl, reference: transactionId };
}

/** Cancel at the period end through paddle-cancel.ts, translated into the port's outcome. */
async function cancelPaddleAtPeriodEnd(apiKey: string | undefined, req: CancelRequest): Promise<Outcome<CancelReceipt>> {
  const done = await cancelPaddleSubscription({ environment: req.environment, apiKey, subscriptionId: req.subscriptionRef });
  if (done.kind === 'executed') return { ok: true, effectiveAt: done.effectiveAt };
  if (done.kind === 'not_configured') return notSent('unavailable', done.why);
  return { ok: false, kind: 'refused', retryable: true, sent: true, detail: done.why };
}

/**
 * Paddle's outbound rail. A factory, because the key is a secret the composition root
 * reads by NAME from the Worker's Env; this file never sees `Env`.
 */
export const paddleRail: RailFactory = (secrets): RailOutbound => ({
  id: PADDLE_RAIL_ID,
  capabilities: new Set(['checkout', 'cancel'] as const),
  createCheckout: (req) => createPaddleCheckout(secrets(PADDLE_API_KEY_VAR), req),
  cancel: (req) => cancelPaddleAtPeriodEnd(secrets(PADDLE_API_KEY_VAR), req),
});
