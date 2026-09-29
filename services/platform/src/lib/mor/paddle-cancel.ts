// ─────────────────────────────────────────────────────────────────────────────
// ⏱ 2026-09-29 · AB-M4-03 (moneyflows MF-3a) · THE PADDLE CANCEL, CARRIED OUT.
//
// Until this file, POST /v1/plan/cancel RECORDED a request and executed none:
// every row got `provider_not_configured`, which stopped being true on
// 2026-08-11 when [ADR 044] evidenced the live seller key. What was missing was
// the endpoint shape, read against the vendor's own page on 2026-09-27
// (research/session-2026-09-23/prep-locked/moneyflows/audit.md §5):
//
//   POST {api}/subscriptions/{subscription_id}/cancel
//   {"effective_from": "next_billing_period"}
//
// "creates a scheduled_change … Its status remains active until after the
// effective date of the scheduled change, at which point it changes to
// canceled." `next_billing_period` is the LOCKED behaviour (INV-514; the
// published refund page: a cancel ends renewal, the paid period is kept). The
// terminal `subscription.canceled` that follows is decided by paddle.ts
// (AB-M4-01), so this call writes nothing to `entitlements` itself.
//
// Every non-2xx, a timeout and a body we cannot read are ONE outcome,
// `provider_error`: the caller keeps the honest 202 `executed: false`, and the
// drain census in ../../scheduled.ts counts the row.
// ─────────────────────────────────────────────────────────────────────────────
import type { MoneyEnvironment } from './contract';

/**
 * The API host per money world. V11 in `lib/mor/paddle.ts`, from
 * developer.paddle.com/api-reference/about/authentication.
 *
 * Both members are present because [MoneyEnvironment] has two and a partial
 * record would make the sandbox branch a runtime `undefined` rather than a
 * type error. `sandbox` is unreachable on the deployed config
 * (`MONEY_ENVIRONMENT: "live"`, and `tooling/ci/assert-money-config.mjs` fails
 * the build on any other value there) — it is the shape, not a live rail.
 * Moved here from routes/checkout.ts on 2026-09-29: both outbound Paddle calls
 * read it.
 */
export const PADDLE_API_BASE: Readonly<Record<MoneyEnvironment, string>> = {
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
 * acting in the wrong world. [5]M-12.
 *
 * Only the PREFIX is ever compared, and only against the key's own leading
 * characters — nothing here logs, returns or stores the value.
 */
export const PADDLE_API_KEY_PREFIX: Readonly<Record<MoneyEnvironment, string>> = {
  live: 'pdl_live_apikey_',
  sandbox: 'pdl_sdbx_apikey_',
};

/**
 * How long we wait for `POST /subscriptions/{id}/cancel`.
 *
 * @ceiling none — a CLIENT-SIDE PATIENCE BUDGET on an outbound call, not a
 * platform resource, the same kind as checkout.ts `PADDLE_CREATE_TIMEOUT_MS`. A
 * timeout is `provider_error`: the request stays recorded and unexecuted, and a
 * second press (or an account deletion's retry) asks again.
 */
export const PADDLE_CANCEL_TIMEOUT_MS = 10_000;

/** Paddle subscription ids are `sub_` + lowercase alphanumerics; anything else never reaches a URL path. */
const PADDLE_SUBSCRIPTION_ID = /^sub_[a-z0-9]{1,64}$/;

/** What one cancel attempt did. Every caller handles all three. */
export type PaddleCancelOutcome =
  /** Paddle scheduled the cancel. `effectiveAt` is its `scheduled_change.effective_at`, or null when the body names none. */
  | { kind: 'executed'; effectiveAt: string | null }
  /** No key, or a key from the other money world. Nothing was sent. */
  | { kind: 'not_configured'; why: string }
  /** Sent, and Paddle did not confirm: a non-2xx, a timeout, or a body we could not read. */
  | { kind: 'provider_error'; why: string };

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Schedule the cancel of one Paddle subscription at the end of the paid period.
 * Never throws; never logs or returns the key.
 */
export async function cancelPaddleSubscription(o: {
  environment: MoneyEnvironment;
  apiKey: string | undefined;
  subscriptionId: string;
}): Promise<PaddleCancelOutcome> {
  const apiKey = o.apiKey ?? '';
  if (apiKey.length === 0) return { kind: 'not_configured', why: 'PADDLE_API_KEY is not set' };
  if (!apiKey.startsWith(PADDLE_API_KEY_PREFIX[o.environment])) {
    return {
      kind: 'not_configured',
      why: `PADDLE_API_KEY does not carry the '${PADDLE_API_KEY_PREFIX[o.environment]}' prefix MONEY_ENVIRONMENT='${o.environment}' requires`,
    };
  }
  if (!PADDLE_SUBSCRIPTION_ID.test(o.subscriptionId)) {
    return { kind: 'provider_error', why: 'the row carries no usable Paddle subscription id' };
  }
  let res: Response;
  try {
    res = await fetch(`${PADDLE_API_BASE[o.environment]}/subscriptions/${o.subscriptionId}/cancel`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Paddle-Version': '1',
      },
      body: JSON.stringify({ effective_from: 'next_billing_period' }),
      signal: AbortSignal.timeout(PADDLE_CANCEL_TIMEOUT_MS),
    });
  } catch (err) {
    return { kind: 'provider_error', why: `the cancel call did not complete: ${err instanceof Error ? err.name : 'error'}` };
  }
  const text = await res.text().catch(() => '');
  if (!res.ok) return { kind: 'provider_error', why: `Paddle answered ${res.status}` };
  let envelope: unknown;
  try {
    envelope = JSON.parse(text);
  } catch {
    return { kind: 'provider_error', why: `Paddle answered ${res.status} with a body that is not JSON` };
  }
  const data = isPlainObject(envelope) ? envelope.data : undefined;
  if (!isPlainObject(data)) return { kind: 'provider_error', why: "Paddle's 2xx body carries no `data` object" };
  const change = isPlainObject(data.scheduled_change) ? data.scheduled_change : null;
  const at = change !== null && typeof change.effective_at === 'string' && !Number.isNaN(Date.parse(change.effective_at))
    ? change.effective_at
    : null;
  return { kind: 'executed', effectiveAt: at };
}
