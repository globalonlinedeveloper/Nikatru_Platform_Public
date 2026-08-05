// ─────────────────────────────────────────────────────────────────────────────
// POST /v1/money/:provider — the ONE door a merchant of record knocks on.
//
// [ADR 020]:18 — "per-app Workers must NEVER see a webhook". The route lives on
// the shared `platform` Worker and nowhere else: fifty stamped apps must inherit
// one verified rail, not fifty copies of a signature check, and the brick's
// service template deliberately routes only /account.
//
// THE ORDER OF OPERATIONS IS THE DESIGN, and each step is here because skipping
// it has a name:
//
//   1 · BOUND THE BODY, then read it as RAW BYTES. Every rail signs the bytes it
//       sent, so `c.req.json()` — which throws the raw string away — makes the
//       signature unverifiable. It is also the defect lib/body.ts exists for:
//       parsing before bounding lets one unauthenticated POST allocate whatever
//       the caller chose to send in the isolate that also serves /config.
//   2 · VERIFY THE SIGNATURE, FAIL CLOSED. An unset secret is a 503, not an
//       open door. Nothing below this line runs for an unverified body — the
//       verbatim store is not an unauthenticated write surface.
//   3 · PARSE, OR REFUSE LOUDLY. A body whose shape the adapter does not
//       recognise is a 400 and NOT a row. An invented shape that silently
//       mis-parses writes a wrong entitlement that looks exactly like a right one.
//   4 · PERSIST VERBATIM.
//   5 · ANSWER 200 ON THE STRENGTH OF STEP 4.
//   6 · DERIVE. In the same request today (a single D1 write pair is well inside
//       the five-second delivery budget Paddle documents), but AFTER the record
//       exists, so a derivation defect can never lose a payment.
//
// ⚠️ IT IS UNAUTHENTICATED IN THE SUPABASE SENSE AND THAT IS CORRECT: the sender
// is a merchant of record, not a user. The signature IS the authentication, and
// it is stronger than the bearer secret the legacy RevenueCat route uses —
// a shared secret in a header proves the sender knows a string, while an HMAC
// over the body proves THIS BODY came from the holder of that string.
// ─────────────────────────────────────────────────────────────────────────────
import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { readBoundedBody } from '../lib/body';
import { withinEdgeCeiling } from '../lib/edge-ceiling';
import { isMoneyEnvironment, type MoneyEnvironment } from '../lib/mor/contract';
import { verifierFor } from '../lib/mor/registry';
import { deriveAndApply, persistNotification } from '../lib/mor/store';

const money = new Hono<AppEnv>();

/**
 * A notification is a handful of fields and one entity. 64 KiB is generous for
 * that and far below anything that could pressure the isolate; the batch route's
 * 256 KiB is sized for 100 analytics events and has no bearing here.
 */
/** @ceiling workers.maxRequestBodySize lte */
export const MAX_MONEY_BODY_BYTES = 64 * 1024;

/**
 * The configured money world. [5]M-12.
 *
 * FAIL CLOSED ON AN ABSENT OR UNRECOGNISED VALUE. A default of 'live' would mean
 * a misconfigured deploy silently accepts sandbox money as real; a default of
 * 'sandbox' would mean a misconfigured production deploy silently stops honouring
 * real payments while every check stays green. Neither is a safe guess, so there
 * is no guess: the route answers 503 and says which variable is wrong.
 */
function environmentOf(raw: string | undefined): MoneyEnvironment | null {
  return isMoneyEnvironment(raw) ? raw : null;
}

money.post('/:provider', async (c) => {
  const rid = c.get('requestId') ?? '-';
  const providerId = c.req.param('provider');

  const verifier = verifierFor(providerId);
  if (verifier === null) {
    // 404, not 400: there is no such rail on this host. Answering 200 would tell
    // an unknown sender we took responsibility for a notification we discarded.
    return c.json({ error: 'unknown_provider' }, 404);
  }

  // The server-derived ceiling, on a key the caller cannot rotate out of. This
  // route is reachable by anyone who can find the URL, and every request costs a
  // body read plus (for a well-formed one) an HMAC.
  if (!(await withinEdgeCeiling(c.env.MONEY_CEILING_LIMITER, c, 'MONEY_CEILING_LIMITER'))) {
    return c.json({ error: 'rate_limited' }, 429);
  }

  const environment = environmentOf(c.env.MONEY_ENVIRONMENT);
  if (environment === null) {
    console.error(
      `[money/${providerId}] rid=${rid} MONEY_ENVIRONMENT is ${JSON.stringify(c.env.MONEY_ENVIRONMENT)} — ` +
        "must be exactly 'live' or 'sandbox'. Refusing: a default here would either honour sandbox money " +
        'as real or stop honouring real money, and neither is a safe guess.',
    );
    return c.json({ error: 'money_rail_not_configured' }, 503);
  }

  const read = await readBoundedBody(c.req.raw, MAX_MONEY_BODY_BYTES);
  if (!read.ok) return c.json({ error: read.error }, read.status);

  const secret = (c.env as unknown as Record<string, string | undefined>)[verifier.secretEnvVar] ?? '';
  const verified = await verifier.verify(read.text, c.req.raw.headers, secret, Date.now());
  if (!verified.ok) {
    console.warn(`[money/${providerId}] rid=${rid} refused: ${verified.reason}`);
    return c.json({ error: 'unverified', detail: verified.reason }, verified.status);
  }

  const parsed = verifier.parse(read.text);
  if (!parsed.ok) {
    // 400 and NO ROW. The rail retries with a body we can read; nothing about the
    // stored entitlement changes in the meantime.
    console.warn(`[money/${providerId}] rid=${rid} unparseable: ${parsed.reason}`);
    return c.json({ error: 'unparseable_notification', detail: parsed.reason }, 400);
  }
  const notification = parsed.notification;

  const deps = { db: c.env.PLATFORM_DB, environment, nowMs: Date.now() };
  let fresh: boolean;
  try {
    ({ fresh } = await persistNotification(deps, notification, read.text));
  } catch (err) {
    console.error(`[money/${providerId}] rid=${rid} could not record the notification`, err);
    // 503 so the rail RETRIES. A 200 here would acknowledge a payment we have no
    // record of, which is the one outcome this route exists to make impossible.
    return c.json({ error: 'not_recorded' }, 503);
  }

  if (!fresh) {
    // Already recorded. Ack so the rail stops retrying; do not re-derive.
    return c.json({ ok: true, recorded: true, duplicate: true });
  }

  let outcome: string;
  try {
    outcome = (await deriveAndApply(deps, notification)).outcome;
  } catch (err) {
    // The notification IS recorded, which is the promise this 200 makes. A
    // derivation failure is re-runnable from the stored payload and must not
    // turn into a retry storm on a queue shared with events that move money.
    console.error(`[money/${providerId}] rid=${rid} derivation failed after recording`, err);
    return c.json({ ok: true, recorded: true, derived: 'error' });
  }

  return c.json({ ok: true, recorded: true, derived: outcome });
});

export default money;
