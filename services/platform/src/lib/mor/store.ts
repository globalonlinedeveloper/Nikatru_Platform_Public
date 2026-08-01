// ─────────────────────────────────────────────────────────────────────────────
// The money rail's persistence — the ONLY code in this repo that may write the
// shared `entitlements` table from a provider notification.
//
// [5]M-2 · a notification is recorded VERBATIM, EXACTLY ONCE, BEFORE it is
//          interpreted — and the ack is on the strength of that record.
// [5]M-7 · every payment is attributable to the account that will consume it,
//          or resolvably unclaimed. Never acknowledged and discarded.
// [5]M-12 · a row records which money world granted it; a reader in the other
//          world sees nothing.
//
// 🔴 THE ORDERING DEFECT THIS EXISTS TO CLOSE, stated first because dedup does
// not touch it. No rail guarantees delivery order. A refund at T2 and a retried
// purchase from T1 < T2 are TWO DIFFERENT EVENT IDS: both are stored exactly
// once, both are genuinely new, and the late one re-grants Pro to a refunded
// customer. Deduplication is orthogonal and cannot help. What closes it is the
// PROVIDER'S OWN CLOCK persisted beside the row and compared on every write —
// `updated_at` cannot serve, because receipt time orders the retries rather than
// the events. The comparison lives in the `ON CONFLICT … DO UPDATE … WHERE`
// clause below, in SQL, so there is no read-modify-write window between two
// concurrent deliveries in which the check could be true for both.
// ─────────────────────────────────────────────────────────────────────────────
import { nowIso } from '../d1';
import {
  type DecisionOutcome,
  type MoneyEnvironment,
  type NormalizedNotification,
  type SubjectAdjustment,
  type SubjectSubscription,
  decideAdjustment,
  decideSubscription,
} from './contract';

/**
 * The entitlement every MoR grant writes. ONE name portfolio-wide: the shared
 * table is keyed (user_id, app_id, entitlement), and a per-app entitlement
 * vocabulary would make "is this person Pro" a question with fifty different
 * spellings and no single reader.
 */
export const MONEY_ENTITLEMENT = 'pro';

export interface MoneyStoreDeps {
  db: D1Database;
  /** From configuration, never from the payload — see contract.ts. */
  environment: MoneyEnvironment;
  nowMs: number;
}

/** SHA-256 hex of a lowercased, trimmed email — the unclaimed-payment lookup key. */
export async function emailHash(email: string): Promise<string> {
  const bytes = new TextEncoder().encode(email.trim().toLowerCase());
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Write the notification down, byte for byte, exactly once.
 *
 * Returns `fresh: false` when this event id has already been stored — a retry.
 * The caller still answers 2xx (the rail must stop retrying) but does NOT
 * re-derive: re-deriving a duplicate is harmless today and would stop being
 * harmless the moment a derivation has a side effect other than the upsert.
 *
 * `ON CONFLICT … DO NOTHING`, never `INSERT OR IGNORE` — 0002_analytics.sql:12-19
 * records why: OR IGNORE also swallows NOT NULL / CHECK / FK violations, so real
 * corruption would be indistinguishable from a duplicate retry.
 */
export async function persistNotification(
  deps: MoneyStoreDeps,
  n: NormalizedNotification,
  raw: string,
): Promise<{ fresh: boolean }> {
  const res = await deps.db
    .prepare(
      `INSERT INTO provider_notifications (
         provider, provider_event_id, provider_notification_id, event_type,
         occurred_at, environment, received_at, payload, derived_at, derive_error
       ) VALUES (?,?,?,?,?,?,?,?,NULL,NULL)
       ON CONFLICT (provider, provider_event_id) DO NOTHING`,
    )
    .bind(
      n.provider,
      n.eventId,
      n.notificationId,
      n.eventType,
      n.occurredAt,
      deps.environment,
      nowIso(),
      raw,
    )
    .run();
  return { fresh: (res.meta?.changes ?? 0) > 0 };
}

/** Stamp the stored notification with what derivation concluded. */
async function markDerived(
  deps: MoneyStoreDeps,
  n: NormalizedNotification,
  error: string | null,
): Promise<void> {
  await deps.db
    .prepare(
      `UPDATE provider_notifications
          SET derived_at = ?, derive_error = ?
        WHERE provider = ? AND provider_event_id = ?`,
    )
    .bind(nowIso(), error, n.provider, n.eventId)
    .run();
}

export type ApplyResult =
  /** An entitlement row was written. */
  | { outcome: 'applied'; userId: string; appId: string; isActive: 0 | 1 }
  /** The event is OLDER than the state already stored. Correctly ignored. */
  | { outcome: 'stale'; userId: string; appId: string }
  /** Money arrived and no account could be resolved. A row was kept. [5]M-7 */
  | { outcome: 'unclaimed'; detail: string }
  /** Not a money subject at all (a product, a customer, a report). */
  | { outcome: 'ignored'; detail: string }
  /** UNDECIDABLE ⇒ DENY. Nothing was written; the rail will retry. */
  | { outcome: 'refused'; detail: string };

interface ExistingRow {
  user_id: string;
  app_id: string;
  current_period_end: string | null;
  trial_end: string | null;
  provider_status: string | null;
}

/**
 * Resolve the account this notification is FOR.
 *
 * The positive path first — [5]M-7's replacement criterion is explicit that the
 * common in-app case is the one that must be asserted, not the rare
 * unresolvable one. A checkout launched from inside an app carries the account
 * id in provider metadata, so the FIRST notification for a subscription resolves
 * itself and the link is written down. Every LATER notification resolves through
 * the written link, which is what makes a RENEWAL attributable without depending
 * on whether the rail propagates checkout metadata onto renewals — a vendor fact
 * this repo could not establish (paddle.ts, U3).
 */
async function resolveAccount(
  deps: MoneyStoreDeps,
  n: NormalizedNotification,
  subscriptionId: string | null,
  fromMetadata: { userId: string | null; appId: string | null },
): Promise<{ userId: string; appId: string } | null> {
  if (fromMetadata.userId !== null && fromMetadata.appId !== null && subscriptionId !== null) {
    await deps.db
      .prepare(
        `INSERT INTO provider_accounts
           (provider, provider_subscription_id, app_id, user_id, linked_at, linked_from_event_id)
         VALUES (?,?,?,?,?,?)
         ON CONFLICT (provider, provider_subscription_id) DO NOTHING`,
      )
      .bind(n.provider, subscriptionId, fromMetadata.appId, fromMetadata.userId, nowIso(), n.eventId)
      .run();
    // Read back rather than trusting the insert: if a link ALREADY existed for
    // this subscription, DO NOTHING kept the original, and the original is the
    // truth. Trusting the payload here would let a later notification carrying
    // different metadata silently move a live subscription to another account.
  }
  if (subscriptionId === null) return null;
  const row = await deps.db
    .prepare(
      `SELECT user_id, app_id FROM provider_accounts
        WHERE provider = ? AND provider_subscription_id = ?`,
    )
    .bind(n.provider, subscriptionId)
    .first<{ user_id: string; app_id: string }>();
  if (row === null) return null;
  return { userId: row.user_id, appId: row.app_id };
}

/** Record a payment nobody could be found for, so it is resolvable later. */
async function recordUnclaimed(
  deps: MoneyStoreDeps,
  n: NormalizedNotification,
  fields: {
    subscriptionId: string | null;
    transactionId: string | null;
    customerId: string | null;
    customerEmail: string | null;
    appId: string | null;
  },
): Promise<void> {
  const hash = fields.customerEmail === null ? null : await emailHash(fields.customerEmail);
  await deps.db
    .prepare(
      `INSERT INTO unclaimed_payments (
         provider, provider_event_id, provider_subscription_id, provider_transaction_id,
         provider_customer_id, customer_email_hash, app_id, environment, received_at,
         claimed_at, claimed_user_id
       ) VALUES (?,?,?,?,?,?,?,?,?,NULL,NULL)
       ON CONFLICT (provider, provider_event_id) DO NOTHING`,
    )
    .bind(
      n.provider,
      n.eventId,
      fields.subscriptionId,
      fields.transactionId,
      fields.customerId,
      hash,
      fields.appId,
      deps.environment,
      nowIso(),
    )
    .run();
}

/**
 * The entitlement upsert. THE ORDERING COMPARISON IS IN THE `WHERE`, in SQL.
 *
 * Returns whether the row was written. `changes === 0` on a conflict means the
 * WHERE refused it, which is exactly the "an older event arrived late" case.
 *
 * ⚠️ `is_active` AND `expires_at` ARE KEPT IN STEP WITH THE NEW COLUMNS ON
 * PURPOSE. services/subly-api/src/routes/entitlements.ts is a released reader
 * that knows only those two, and two readers of one row that can disagree is a
 * defect waiting for a deploy-order accident.
 */
async function upsertEntitlement(
  deps: MoneyStoreDeps,
  n: NormalizedNotification,
  account: { userId: string; appId: string },
  decision: DecisionOutcome & { ok: true },
  ids: { subscriptionId: string | null; transactionId: string | null },
): Promise<boolean> {
  const d = decision.decision;
  const res = await deps.db
    .prepare(
      `INSERT INTO entitlements (
         user_id, app_id, entitlement, product_id, store, is_active, expires_at, updated_at,
         provider, provider_environment, provider_subscription_id, provider_transaction_id,
         provider_status, last_event_id, occurred_at, current_period_end, trial_end,
         revoked_at, revocation_reason
       ) VALUES (?,?,?,NULL,NULL,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT (user_id, app_id, entitlement) DO UPDATE SET
         is_active                = excluded.is_active,
         expires_at               = excluded.expires_at,
         updated_at               = excluded.updated_at,
         provider                 = excluded.provider,
         provider_environment     = excluded.provider_environment,
         provider_subscription_id = excluded.provider_subscription_id,
         provider_transaction_id  = excluded.provider_transaction_id,
         provider_status          = excluded.provider_status,
         last_event_id            = excluded.last_event_id,
         occurred_at              = excluded.occurred_at,
         current_period_end       = excluded.current_period_end,
         trial_end                = excluded.trial_end,
         revoked_at               = excluded.revoked_at,
         revocation_reason        = excluded.revocation_reason
       WHERE entitlements.occurred_at IS NULL
          OR excluded.occurred_at > entitlements.occurred_at`,
    )
    .bind(
      account.userId,
      account.appId,
      MONEY_ENTITLEMENT,
      d.isActive,
      d.expiresAt,
      nowIso(),
      n.provider,
      deps.environment,
      ids.subscriptionId,
      ids.transactionId,
      d.providerStatus,
      n.eventId,
      n.occurredAt,
      d.currentPeriodEnd,
      d.trialEnd,
      d.revokedAt,
      d.revocationReason,
    )
    .run();
  return (res.meta?.changes ?? 0) > 0;
}

/**
 * Interpret a stored notification and, when it decides something, write the row.
 *
 * Every branch that cannot decide returns `refused` and writes NOTHING. That is
 * the whole posture: the rail retries (Paddle 60 times over 3 days), the stored
 * entitlement keeps whatever it already said, and the stored notification
 * carries the reason. A branch that "did its best" here is a branch that grants
 * or removes access on a guess.
 */
export async function deriveAndApply(
  deps: MoneyStoreDeps,
  n: NormalizedNotification,
): Promise<ApplyResult> {
  const result = await derive(deps, n);
  await markDerived(
    deps,
    n,
    result.outcome === 'applied' || result.outcome === 'stale'
      ? null
      : `${result.outcome}: ${'detail' in result ? result.detail : ''}`,
  );
  return result;
}

async function derive(deps: MoneyStoreDeps, n: NormalizedNotification): Promise<ApplyResult> {
  if (n.subject.kind === 'unknown') {
    return { outcome: 'ignored', detail: n.subject.detail };
  }
  if (n.subject.kind === 'subscription') return applySubscription(deps, n, n.subject);
  return applyAdjustment(deps, n, n.subject);
}

async function applySubscription(
  deps: MoneyStoreDeps,
  n: NormalizedNotification,
  s: SubjectSubscription,
): Promise<ApplyResult> {
  const account = await resolveAccount(deps, n, s.subscriptionId, {
    userId: s.accountUserId,
    appId: s.accountAppId,
  });
  if (account === null) {
    await recordUnclaimed(deps, n, {
      subscriptionId: s.subscriptionId,
      transactionId: s.transactionId,
      customerId: s.customerId,
      customerEmail: s.customerEmail,
      appId: s.accountAppId,
    });
    return {
      outcome: 'unclaimed',
      detail: `no account is linked to ${n.provider} subscription ${s.subscriptionId}, and the notification carried no usable metadata`,
    };
  }
  const decision = decideSubscription(s, deps.nowMs);
  if (!decision.ok) return { outcome: 'refused', detail: decision.reason };
  const written = await upsertEntitlement(deps, n, account, decision, {
    subscriptionId: s.subscriptionId,
    transactionId: s.transactionId,
  });
  return written
    ? { outcome: 'applied', ...account, isActive: decision.decision.isActive }
    : { outcome: 'stale', ...account };
}

async function applyAdjustment(
  deps: MoneyStoreDeps,
  n: NormalizedNotification,
  a: SubjectAdjustment,
): Promise<ApplyResult> {
  if (a.reason === null) {
    // A credit or a chargeback WARNING. It moves no access, and saying so is
    // not the same as failing to decide.
    return { outcome: 'ignored', detail: `adjustment action '${a.actionVerbatim}' changes no entitlement` };
  }
  const account = await resolveAccount(deps, n, a.subscriptionId, { userId: null, appId: null });
  if (account === null) {
    await recordUnclaimed(deps, n, {
      subscriptionId: a.subscriptionId,
      transactionId: a.transactionId,
      customerId: null,
      customerEmail: null,
      appId: null,
    });
    return {
      outcome: 'unclaimed',
      detail: `no account is linked to ${n.provider} subscription ${a.subscriptionId ?? '(none on the adjustment)'}`,
    };
  }
  const existing = await deps.db
    .prepare(
      `SELECT user_id, app_id, current_period_end, trial_end, provider_status
         FROM entitlements
        WHERE user_id = ? AND app_id = ? AND entitlement = ?`,
    )
    .bind(account.userId, account.appId, MONEY_ENTITLEMENT)
    .first<ExistingRow>();
  if (existing === null) {
    // A refund for access we never granted. Refusing (rather than writing an
    // is_active = 0 row out of nowhere) keeps the rail honest: the row would
    // assert a revocation of something that was never given, and the retry will
    // succeed once the grant that preceded it has been processed.
    return {
      outcome: 'refused',
      detail: 'an adjustment arrived for an account with no entitlement row — the grant it reverses has not been applied yet',
    };
  }
  const decision = decideAdjustment(
    a,
    {
      currentPeriodEnd: existing.current_period_end,
      trialEnd: existing.trial_end,
      providerStatus: existing.provider_status,
    },
    deps.nowMs,
  );
  if (!decision.ok) return { outcome: 'refused', detail: decision.reason };
  const written = await upsertEntitlement(deps, n, account, decision, {
    subscriptionId: a.subscriptionId,
    transactionId: a.transactionId,
  });
  return written
    ? { outcome: 'applied', ...account, isActive: decision.decision.isActive }
    : { outcome: 'stale', ...account };
}
