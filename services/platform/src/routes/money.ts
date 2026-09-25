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
//       A rail whose event id is a HEADER (the verifier's `eventIdHeader`) is
//       refused 400 `missing_event_id` first when that header is absent or empty.
//   4 · PERSIST VERBATIM. Exactly once per event id; a re-delivery keeps the
//       first copy.
//   5 · DERIVE. In the same request (a single D1 write pair is well inside the
//       five-second delivery budget Paddle documents), but AFTER the record
//       exists, so a derivation defect can never lose a payment.
//   6 · ANSWER BY WHAT DERIVATION CONCLUDED. 200 when it concluded — applied,
//       stale, ignored, unclaimed — and 🔴 503 WHEN IT DID NOT: a `refused`
//       outcome or a throw. Paddle re-delivers on any status but 200 (60 times
//       within 3 days, live; developer.paddle.com/webhooks/respond-to-webhooks),
//       and the re-delivery is RE-DERIVED here because step 4 kept the row and
//       `isUnconcluded` says it never concluded. A 200 for an unconcluded
//       derivation — what this route used to answer — was a false ack: the
//       row stayed underived for good, and a refund that arrived before its
//       grant left the refunded customer Pro. A re-delivery of a CONCLUDED
//       notification is still `duplicate: true` with no second derivation.
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
import { isKnownProduct } from '../config';
import { deriveAndApply, derivationStateOf, isUnconcluded, persistNotification } from '../lib/mor/store';

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

  // A rail whose event id is a HEADER rather than a body field (the verifier
  // names it) is refused here when that header is absent or empty: 400, no parse,
  // no row. Persisting without the id would break exactly-once — the store keys
  // on (provider, provider_event_id) — and the header is covered by nothing the
  // signature checks, so there is no value to fall back to.
  let eventIdHint: string | undefined;
  if (verifier.eventIdHeader !== undefined) {
    eventIdHint = (c.req.header(verifier.eventIdHeader) ?? '').trim();
    if (eventIdHint === '') {
      console.warn(`[money/${providerId}] rid=${rid} refused: no ${verifier.eventIdHeader} header`);
      return c.json({ error: 'missing_event_id', detail: `no ${verifier.eventIdHeader} header` }, 400);
    }
  }

  const parsed = eventIdHint === undefined ? verifier.parse(read.text) : verifier.parse(read.text, eventIdHint);
  if (!parsed.ok) {
    // 400 and NO ROW. The rail retries with a body we can read; nothing about the
    // stored entitlement changes in the meantime.
    console.warn(`[money/${providerId}] rid=${rid} unparseable: ${parsed.reason}`);
    return c.json({ error: 'unparseable_notification', detail: parsed.reason }, 400);
  }
  const notification = parsed.notification;

  // `isKnownProduct` is handed in rather than imported by the store: see
  // MoneyStoreDeps for the measured reason (the dry-run loads the store under
  // bare node, where config.ts's JSON imports cannot resolve).
  const deps = { db: c.env.PLATFORM_DB, environment, nowMs: Date.now(), isKnownProduct };
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
    // Already recorded. If that derivation CONCLUDED, ack so the rail stops
    // re-delivering and do not derive again. If it did not — it refused, or it
    // threw before it could be stamped — this re-delivery is the retry the 503
    // below asked for, and it falls through to derive again from the stored
    // notification. A row that vanished between the two reads is acked: there
    // is nothing left to derive from.
    const state = await derivationStateOf(c.env.PLATFORM_DB, notification);
    if (state === null || !isUnconcluded(state)) {
      return c.json({ ok: true, recorded: true, duplicate: true });
    }
    console.log(`[money/${providerId}] rid=${rid} re-deriving a stored notification that had not concluded`);
  }

  let outcome: string;
  try {
    outcome = (await deriveAndApply(deps, notification)).outcome;
  } catch (err) {
    // The notification IS recorded, so nothing is lost — and NOTHING IS
    // CONCLUDED either, so this is not a 200. 503: Paddle re-delivers, the
    // duplicate branch above re-derives. Retries are per notification on the
    // rail's side (the doc names no shared queue and guarantees no order), so a
    // 503 here delays no other event.
    console.error(`[money/${providerId}] rid=${rid} derivation failed after recording`, err);
    return c.json({ ok: false, recorded: true, derived: 'error', retry: true }, 503);
  }

  if (outcome === 'refused') {
    // Undecidable ⇒ deny, and deny is not done: the row stays unconcluded and
    // the rail is asked to bring the notification back. The common case is a
    // refund that arrived before the grant it reverses; the re-delivery finds
    // the grant applied and revokes.
    return c.json({ ok: false, recorded: true, derived: outcome, retry: true }, 503);
  }

  return c.json({ ok: true, recorded: true, derived: outcome });
});

export default money;
