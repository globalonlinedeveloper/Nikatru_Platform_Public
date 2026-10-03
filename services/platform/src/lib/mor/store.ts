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
  type SubjectOneTime,
  type SubjectSubscription,
  type SubjectTransfer,
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
  /**
   * Is this id a product a notification may be attributed to — any register's
   * product but a bundle? Resolved by the CALLER from the product registers —
   * `isAttributableProduct` in src/config.ts for the Worker, the tooling
   * register reader (bundle kind excluded) for the dry-run.
   *
   * 🔴 INJECTED, NOT IMPORTED, AND THE REASON IS MEASURED: this module is loaded
   * under bare `node` by tooling/ops/money-dry-run.mjs (CI job "A stored
   * notification replayed in any order reaches the same entitlement"), and
   * config.ts imports the JSON registers without an import attribute, which
   * bare node refuses (ERR_IMPORT_ATTRIBUTE_MISSING, run 34429437969). Nothing
   * under src/lib/ may import src/config.ts for that reason. A missing function
   * here is a TypeError at the first attributable notification — loud, and it
   * grants nothing.
   */
  isKnownProduct: (id: string) => boolean;
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

/**
 * Stamp the stored notification with what derivation concluded — and, when
 * derivation resolved one, WHOSE it is.
 *
 * 🔴 `user_id` IS WHAT MAKES THIS ROW ERASABLE ([pipeline K-7], migration 0006).
 * The row is written verbatim BEFORE it is interpreted ([5]M-2), so the account
 * is not knowable at insert time; this is the first and only moment it is. The
 * shared erasure route derives the tables it purges from the schema — every
 * table carrying a `user_id` column — so stamping it here is what puts the one
 * non-pseudonymous table in platform_db (it holds the buyer's name and email,
 * verbatim, because that is what the provider sent) inside the reach of "delete
 * my account". Leaving it NULL means a person can be told they were erased while
 * their name is still in the database.
 *
 * NULL stays NULL when nothing was resolved: an unattributable notification has
 * no account, and writing a guess would be worse than leaving the honest gap —
 * `unclaimed_payments` is where that case is recorded.
 */
async function markDerived(
  deps: MoneyStoreDeps,
  n: NormalizedNotification,
  error: string | null,
  userId: string | null,
): Promise<void> {
  await deps.db
    .prepare(
      `UPDATE provider_notifications
          SET derived_at = ?, derive_error = ?, user_id = COALESCE(?, user_id)
        WHERE provider = ? AND provider_event_id = ?`,
    )
    .bind(nowIso(), error, userId, n.provider, n.eventId)
    .run();
}

export type ApplyResult =
  /** An entitlement row was written. */
  | { outcome: 'applied'; userId: string; appId: string; isActive: 0 | 1 }
  /** The event is OLDER than the state already stored. Correctly ignored. */
  | { outcome: 'stale'; userId: string; appId: string }
  /** Money arrived and no account could be resolved. A row was kept. [5]M-7 */
  | { outcome: 'unclaimed'; detail: string }
  /**
   * Not a money subject at all (a product, a customer, a report), or one that
   * concludes with no write. ⏱ 2026-09-22 · [ADR 092] §4.3: a concluded TRANSFER
   * carries its destination account, stamped on the stored notification.
   */
  | { outcome: 'ignored'; detail: string; userId?: string }
  /**
   * UNDECIDABLE ⇒ DENY. Nothing was written. The route answers 503 for this
   * outcome so the rail re-delivers, and the re-delivery is RE-DERIVED — see
   * `isUnconcluded` below for what makes that true.
   */
  | { outcome: 'refused'; detail: string };

// ─────────────────────────────────────────────────────────────────────────────
// 🔴 A DERIVATION THAT DID NOT CONCLUDE IS NOT FINISHED, AND TWO THINGS RE-RUN IT.
//
// The defect this closes: a `refused` outcome (a refund that arrived BEFORE the
// grant it reverses, store.ts:applyAdjustment) and a derivation that THREW were
// both answered HTTP 200, and because the notification was already stored, every
// re-delivery of the same event id was answered `duplicate` and never derived
// again. Nothing in `src/` re-read a row with `derived_at IS NULL`. The refunded
// customer kept Pro, for good, and three comments said the rail would retry.
//
// What is true NOW, and both halves are proven by tests that seed the refund
// first and the grant second:
//   1 · routes/money.ts answers 503 for `refused` and for a throw. Paddle
//       re-delivers on any status but 200 — 60 times within 3 days on a live
//       account (developer.paddle.com/webhooks/respond-to-webhooks) — and the
//       duplicate branch re-derives when `isUnconcluded` says the stored row
//       never concluded. That is the minutes-scale path.
//   2 · scheduled.ts `moneyRederive` re-derives every unconcluded row younger
//       than its age bound on the nightly cron, for whatever outlives the rail's
//       3-day window (a throw that was a bug until it was fixed).
//
// "Unconcluded" is defined ONCE, here, as a predicate over the stored row and as
// the SQL that selects such rows; a test holds the two forms equal over every
// derivation state the writer can produce. `unclaimed` and `ignored` are
// CONCLUDED: the first is resolved through `unclaimed_payments`, the second has
// nothing to derive.
// ─────────────────────────────────────────────────────────────────────────────

/** The two columns `markDerived` stamps. Both NULL until derivation ran. */
export interface DerivationState {
  derived_at: string | null;
  derive_error: string | null;
}

/**
 * Never stamped (derivation threw before `markDerived`), or stamped `refused`.
 * `markDerived` writes `${outcome}: ${detail}`, so the prefix is the outcome.
 */
export function isUnconcluded(s: DerivationState): boolean {
  return s.derived_at === null || (s.derive_error !== null && s.derive_error.startsWith('refused:'));
}

/** The stored row's derivation stamp, or null when no such row exists. */
export async function derivationStateOf(
  db: D1Database,
  n: Pick<NormalizedNotification, 'provider' | 'eventId'>,
): Promise<DerivationState | null> {
  const row = await db
    .prepare('SELECT derived_at, derive_error FROM provider_notifications WHERE provider = ? AND provider_event_id = ?')
    .bind(n.provider, n.eventId)
    .first<DerivationState>();
  return row ?? null;
}

/** A stored notification as the re-derivation sweep needs it: enough to parse again. */
export interface StoredNotification {
  provider: string;
  provider_event_id: string;
  payload: string;
  received_at: string;
}

/**
 * Every unconcluded notification received at or after `sinceIso`, oldest first,
 * at most `limit`. The WHERE is the SQL form of `isUnconcluded`, and
 * test/money-rederive.test.ts asserts the two agree on every state.
 */
export async function unconcludedNotifications(
  db: D1Database,
  sinceIso: string,
  limit: number,
): Promise<StoredNotification[]> {
  const res = await db
    .prepare(
      `SELECT provider, provider_event_id, payload, received_at
         FROM provider_notifications
        WHERE received_at >= ?
          AND (derived_at IS NULL OR derive_error LIKE 'refused:%')
        ORDER BY received_at
        LIMIT ?`,
    )
    .bind(sinceIso, limit)
    .all<StoredNotification>();
  return res.results ?? [];
}

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
): Promise<{ userId: string; appId: string } | { refused: string } | null> {
  // 🔴 THE APP ID IN THE METADATA IS CLIENT-SETTABLE AND IS VALIDATED HERE.
  // `custom_data` is written by whoever opened the checkout — server-minted on
  // rung 2, but the overlay checkout (`Paddle.Checkout.open`, no server-created
  // transaction) lets the CLIENT set it. Before this check any string ≤128 chars
  // was written into `provider_accounts.app_id` and `entitlements.app_id`, which
  // is a row belonging to no registered product ([4]B-4a) and defeats the reason
  // /v1/checkout is authenticated at all (index.ts). An unknown id is REFUSED as
  // attribution: logged, no link written, and the notification resolves through
  // an EXISTING link or lands in `unclaimed_payments` — never a grant.
  const appIdKnown = fromMetadata.appId === null || deps.isKnownProduct(fromMetadata.appId);
  if (!appIdKnown) {
    console.warn(
      `[money/${n.provider}] event ${n.eventId} carries nikatru_app_id ${JSON.stringify(fromMetadata.appId)}, ` +
        'which is not a registered product. Refusing the attribution; nothing is linked from it.',
    );
  }
  const linkAttempted =
    appIdKnown && fromMetadata.userId !== null && fromMetadata.appId !== null && subscriptionId !== null;
  const linkMoves = n.provider === REVENUECAT_PROVIDER;
  if (linkAttempted) {
    await (linkMoves ? revenuecatLinkUpsert(deps.db) : firstLinkWinsInsert(deps.db))
      .bind(n.provider, subscriptionId, fromMetadata.appId, fromMetadata.userId, nowIso(), n.eventId, n.occurredAt)
      .run();
    // Read back rather than trusting the insert: if a link ALREADY existed for
    // this subscription, DO NOTHING kept the original, and the original is the
    // truth. Trusting the payload here would let a later notification carrying
    // different metadata silently move a live subscription to another account.
    // ⏱ 2026-09-22 · [ADR 092] §4.4: for RevenueCat the upsert MAY have moved
    // the link, and the read-back is still the truth either way.
  }
  if (subscriptionId === null) return null;
  const row = await deps.db
    .prepare(
      `SELECT user_id, app_id, COALESCE(linked_occurred_at, linked_at) AS linked_occurred
         FROM provider_accounts
        WHERE provider = ? AND provider_subscription_id = ?`,
    )
    .bind(n.provider, subscriptionId)
    .first<{ user_id: string; app_id: string; linked_occurred: string }>();
  if (row === null) return null;
  // ⏱ 2026-09-22 · [ADR 092] §4.4 — a NEWER RevenueCat event names another
  // account and the link did NOT move: the current owner still holds a live row
  // on this purchase (or the link is another app's). Writing to either account
  // would be a guess, so it is refused by name. An OLDER event falls through to
  // the link's owner and loses on the entitlement's own ordering (stale).
  if (linkMoves && linkAttempted && row.user_id !== fromMetadata.userId && n.occurredAt > row.linked_occurred) {
    return {
      refused: `owner_change_on_live_subscription: a newer ${n.provider} event names another account for subscription ${subscriptionId}, and the link was not moved: its current owner still holds a live row on it, or the link is another app's (ADR 092 §4.4)`,
    };
  }
  return { userId: row.user_id, appId: row.app_id };
}

/** Paddle and Razorpay: the FIRST link wins, forever. Their bodies carry the checkout's metadata. */
const firstLinkWinsInsert = (db: D1Database): D1PreparedStatement =>
  db.prepare(`INSERT INTO provider_accounts
     (provider, provider_subscription_id, app_id, user_id, linked_at, linked_from_event_id, linked_occurred_at)
   VALUES (?,?,?,?,?,?,?)
   ON CONFLICT (provider, provider_subscription_id) DO NOTHING`);

/**
 * ⏱ 2026-09-22 · [ADR 092] §4.4 — RevenueCat ONLY: a purchase's owner can change
 * (its TRANSFER event), and the change reaches this ledger as the next signed
 * lifecycle event naming the new `app_user_id`. The link moves when ALL hold:
 *   · the same app;
 *   · the event is NEWER than the one the link rests on — by the PROVIDER's clock
 *     (`linked_occurred_at`; a link written before migration 0015 falls back to
 *     `linked_at`, its write time, which is never earlier than its event);
 *   · the CURRENT owner holds no live RevenueCat row on this purchase at the
 *     event's time. A live owner is never displaced by a notice; the caller
 *     refuses that case as `owner_change_on_live_subscription`.
 */
const revenuecatLinkUpsert = (db: D1Database): D1PreparedStatement =>
  db.prepare(`INSERT INTO provider_accounts
     (provider, provider_subscription_id, app_id, user_id, linked_at, linked_from_event_id, linked_occurred_at)
   VALUES (?,?,?,?,?,?,?)
   ON CONFLICT (provider, provider_subscription_id) DO UPDATE SET
     user_id              = excluded.user_id,
     linked_at            = excluded.linked_at,
     linked_from_event_id = excluded.linked_from_event_id,
     linked_occurred_at   = excluded.linked_occurred_at
   WHERE provider_accounts.app_id = excluded.app_id
     AND excluded.linked_occurred_at > COALESCE(provider_accounts.linked_occurred_at, provider_accounts.linked_at)
     AND NOT EXISTS (
       SELECT 1 FROM entitlements e
        WHERE e.user_id = provider_accounts.user_id
          AND e.app_id = provider_accounts.app_id
          AND e.provider = provider_accounts.provider
          AND e.provider_subscription_id = provider_accounts.provider_subscription_id
          AND e.is_active = 1
          AND (e.expires_at IS NULL OR e.expires_at > excluded.linked_occurred_at))`);

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
 * PURPOSE. services/subscriptiontracker-api/src/routes/entitlements.ts is a released reader
 * that knows only those two, and two readers of one row that can disagree is a
 * defect waiting for a deploy-order accident.
 */
async function upsertEntitlement(
  deps: MoneyStoreDeps,
  n: NormalizedNotification,
  account: { userId: string; appId: string },
  decision: DecisionOutcome & { ok: true },
  ids: {
    subscriptionId: string | null;
    transactionId: string | null;
    /** ⏱ 2026-09-22 · [ADR 092] E1: the rail's product handle and store, verbatim; null when the body names none. */
    productId?: string | null;
    store?: string | null;
  },
): Promise<boolean> {
  const d = decision.decision;
  const res = await deps.db
    .prepare(
      `INSERT INTO entitlements (
         user_id, app_id, entitlement, product_id, store, is_active, expires_at, updated_at,
         provider, provider_environment, provider_subscription_id, provider_transaction_id,
         provider_status, last_event_id, occurred_at, current_period_end, trial_end,
         revoked_at, revocation_reason
       ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT (user_id, app_id, entitlement) DO UPDATE SET
         product_id               = CASE WHEN excluded.provider = entitlements.provider
                                         THEN COALESCE(excluded.product_id, entitlements.product_id)
                                         ELSE excluded.product_id END,
         store                    = CASE WHEN excluded.provider = entitlements.provider
                                         THEN COALESCE(excluded.store, entitlements.store)
                                         ELSE excluded.store END,
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
      ids.productId ?? null,
      ids.store ?? null,
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
 * the whole posture: the stored entitlement keeps whatever it already said and
 * the stored notification carries the reason. The route answers 503 for this
 * outcome, so the rail re-delivers (Paddle: 60 times within 3 days, live), and
 * the re-delivery is re-derived because `isUnconcluded` still says so; the
 * nightly `moneyRederive` limb re-runs anything that outlives that window. A
 * branch that "did its best" here is a branch that grants or removes access on
 * a guess.
 */
export async function deriveAndApply(
  deps: MoneyStoreDeps,
  n: NormalizedNotification,
): Promise<ApplyResult> {
  const result = await derive(deps, n);
  await concludeDerivation(deps, n, result);
  return result;
}

/**
 * Stamp the stored notification with what a derivation concluded. ONE form for
 * every entry: `deriveAndApply` above and src/lib/mor/grant.ts (the one entry
 * from a verified event to a grant) both end here, so "unconcluded" means the
 * same thing whichever of them derived the row.
 */
export async function concludeDerivation(
  deps: MoneyStoreDeps,
  n: NormalizedNotification,
  result: ApplyResult,
): Promise<void> {
  await markDerived(
    deps,
    n,
    result.outcome === 'applied' || result.outcome === 'stale'
      ? null
      : `${result.outcome}: ${'detail' in result ? result.detail : ''}`,
    'userId' in result ? (result.userId ?? null) : null,
  );
}

async function derive(deps: MoneyStoreDeps, n: NormalizedNotification): Promise<ApplyResult> {
  if (n.subject.kind === 'unknown') {
    return { outcome: 'ignored', detail: n.subject.detail };
  }
  // ⏱ 2026-09-27 · a one-time purchase is decided by src/lib/mor/grant.ts, which
  // maps its price to OUR offering. This module cannot (it may not import the
  // Worker's config — see MoneyStoreDeps), so a one-time subject that reaches it
  // directly is REFUSED by name, never granted and never acked.
  if (n.subject.kind === 'one_time') {
    return {
      outcome: 'refused',
      detail: 'one_time_outside_grant_path: a one-time purchase is granted through src/lib/mor/grant.ts, which maps its price to an offering',
    };
  }
  // ⏱ 2026-09-15 · [ADR 085]: an attribution the adapter refused. Nothing is
  // written; the route answers 503 and the nightly re-derivation counts it.
  if (n.subject.kind === 'refused') {
    return { outcome: 'refused', detail: n.subject.detail };
  }
  if (n.subject.kind === 'subscription') return applySubscription(deps, n, n.subject);
  // ⏱ 2026-09-22 · [ADR 092] §4.3: an ownership notice, never an adjustment.
  if (n.subject.kind === 'transfer') return applyTransfer(deps, n, n.subject);
  return applyAdjustment(deps, n, n.subject);
}

/** The rail whose links MOVE on a newer event ([ADR 092] §4.4); every other rail's first link wins. */
const REVENUECAT_PROVIDER = 'revenuecat';

/**
 * The most source ids one TRANSFER tripwire checks.
 *
 * @ceiling none — bounds the shape of one webhook body, not a platform resource
 *
 * The source ids travel as ONE bound JSON array read through `json_each(?)`, so
 * the statement binds four parameters however many sources there are and its text
 * never changes. The vendor's own sample names ONE source; a body naming more than
 * this is anomalous and is refused by name rather than checked.
 */
const MAX_TRANSFER_SOURCES = 64;

/**
 * ⏱ 2026-09-22 · [ADR 092] §4.3 — a RevenueCat TRANSFER. It writes NOTHING: the
 * body names owners and no purchase, so there is no row it could decide.
 *
 *   1. The money world, as for a subscription: a sandbox transfer never reaches
 *      a live destination's ledger.
 *   2. THE TRIPWIRE. While any source account still holds a LIVE RevenueCat row
 *      for this app (`is_active = 1` and not expired at the EVENT's time), the
 *      move would leave a paying customer's access at the mercy of the next
 *      event's order — refused as `transfer_from_live_owner`, 503, counted
 *      nightly. Only RevenueCat rows count: a Paddle or Razorpay purchase is not
 *      what RevenueCat moved.
 *   3. Otherwise concluded as `ignored`, stamped with the DESTINATION account.
 *      The ledger's owner of the purchase moves on the next newer signed money
 *      event for it (`resolveAccount`, §4.4), never on this notice.
 */
async function applyTransfer(
  deps: MoneyStoreDeps,
  n: NormalizedNotification,
  t: SubjectTransfer,
): Promise<ApplyResult> {
  if (t.railEnvironment !== deps.environment) {
    return {
      outcome: 'refused',
      detail: `the notification says it is ${t.railEnvironment} money and this destination is configured for ${deps.environment}`,
    };
  }
  if (t.from.length > MAX_TRANSFER_SOURCES) {
    return {
      outcome: 'refused',
      detail: `transfer_sources_over_ceiling: \`transferred_from\` names ${t.from.length} accounts, more than the ${MAX_TRANSFER_SOURCES} one statement can check`,
    };
  }
  const live = await deps.db
    .prepare(
      `SELECT user_id FROM entitlements
        WHERE provider = ? AND app_id = ?
          AND user_id IN (SELECT value FROM json_each(?))
          AND is_active = 1
          AND (expires_at IS NULL OR expires_at > ?)
        LIMIT 1`,
    )
    .bind(REVENUECAT_PROVIDER, t.appId, JSON.stringify(t.from), n.occurredAt)
    .first<{ user_id: string }>();
  if (live !== null) {
    return {
      outcome: 'refused',
      detail: `transfer_from_live_owner: a source account still holds a live RevenueCat entitlement for ${t.appId} at the event's time, so the move is refused until an owner decides it (ADR 092 §4.3)`,
    };
  }
  return {
    outcome: 'ignored',
    detail: `revenuecat TRANSFER concluded for ${t.appId}: no entitlement written and no link moved; the next newer money event moves the link (ADR 092 §4.3, §4.4)`,
    userId: t.to,
  };
}

/**
 * The revocations that mean THE MONEY WENT BACK. Each arrives on its own
 * authority (a Paddle adjustment, a RevenueCat CUSTOMER_SUPPORT cancellation),
 * and the rail's subscription entity is not changed by it: Paddle documents no
 * effect of a refund on the subscription, which stays `active`.
 */
const MONEY_WENT_BACK: ReadonlySet<string> = new Set(['refund_approved', 'chargeback']);

/**
 * ⏱ 2026-09-29 · AB-M4-02 (moneyflows MF-2) · A REFUND OR A CHARGEBACK IS NOT
 * UNDONE BY A LATER STATE NOTICE.
 *
 * The defect: the ordering clause admits any NEWER event, and a subscription
 * event decides access from the entity's own status. After a refund revoked the
 * row, Paddle's next `subscription.updated` — which "covers a wide range of
 * changes, including billing detail updates … scheduled changes being created
 * or removed" (developer.paddle.com, read 2026-09-27) — still says `active` for
 * the period that was refunded, and it re-granted Pro to the refunded customer.
 * Scheduling the cancel that should follow a refund was itself enough.
 *
 * The rule: while the row is revoked for a reason in MONEY_WENT_BACK, a
 * subscription event for the SAME rail subscription writes nothing unless it
 * states a paid-through date LATER than the revoked row's — a new period, which
 * is a new payment. Concluded as `ignored`, never refused: the notice was read
 * and decided, and retrying it would decide the same. Only a restoring
 * adjustment (`chargeback_reversed`, applyAdjustment) gives access back inside
 * the refunded period.
 *
 * Returns the ignore detail, or null when the event may be applied.
 */
async function moneyWentBackFor(
  deps: MoneyStoreDeps,
  account: { userId: string; appId: string },
  n: NormalizedNotification,
  subscriptionId: string,
  incomingPeriodEnd: string | null,
): Promise<string | null> {
  const provider = n.provider;
  const row = await deps.db
    .prepare(
      `SELECT provider, provider_subscription_id, current_period_end, occurred_at, revoked_at, revocation_reason
         FROM entitlements
        WHERE user_id = ? AND app_id = ? AND entitlement = ?`,
    )
    .bind(account.userId, account.appId, MONEY_ENTITLEMENT)
    .first<{
      provider: string | null;
      provider_subscription_id: string | null;
      current_period_end: string | null;
      occurred_at: string | null;
      revoked_at: string | null;
      revocation_reason: string | null;
    }>();
  if (row === null || row.revoked_at === null || row.revocation_reason === null) return null;
  if (!MONEY_WENT_BACK.has(row.revocation_reason)) return null;
  if (row.provider !== provider || row.provider_subscription_id !== subscriptionId) return null;
  // An OLDER event is the ordering clause's to refuse (`stale`), exactly as before.
  if (row.occurred_at !== null && !(n.occurredAt > row.occurred_at)) return null;
  const heldTo = row.current_period_end === null ? Number.NaN : Date.parse(row.current_period_end);
  const offered = incomingPeriodEnd === null ? Number.NaN : Date.parse(incomingPeriodEnd);
  // A new period is the only thing that outranks the refund. An unreadable or
  // absent date on either side cannot show one, so the refund stands.
  if (Number.isFinite(heldTo) && Number.isFinite(offered) && offered > heldTo) return null;
  return (
    `money_went_back: ${provider} subscription ${subscriptionId} was revoked as ${row.revocation_reason}, ` +
    `and this event states no period later than the one that was paid back (${row.current_period_end ?? 'none'})`
  );
}

async function applySubscription(
  deps: MoneyStoreDeps,
  n: NormalizedNotification,
  s: SubjectSubscription,
): Promise<ApplyResult> {
  // ⏱ 2026-09-15 · [5]M-12, for a rail whose body DOES name its world
  // (RevenueCat `environment`). Checked before any account is linked, so a
  // sandbox purchase cannot even write a provider_accounts link into live.
  if (s.railEnvironment != null && s.railEnvironment !== deps.environment) {
    return {
      outcome: 'refused',
      detail: `the notification says it is ${s.railEnvironment} money and this destination is configured for ${deps.environment}`,
    };
  }
  const account = await resolveAccount(deps, n, s.subscriptionId, {
    userId: s.accountUserId,
    appId: s.accountAppId,
  });
  if (account !== null && 'refused' in account) return { outcome: 'refused', detail: account.refused };
  // ⏱ 2026-10-02 · PR #1149 ruling item 2: the charge's payment → its subscription, written
  // here on the signed event that names both, so a later refund or dispute resolves by payment.
  if (PAYMENT_LINKED_PROVIDERS.includes(n.provider) && s.transactionId !== null) {
    await linkPayment(deps, n, s.transactionId, s.subscriptionId, account?.userId ?? null);
  }
  if (account === null) {
    await recordUnclaimed(deps, n, {
      subscriptionId: s.subscriptionId,
      transactionId: s.transactionId,
      customerId: s.customerId,
      customerEmail: s.customerEmail,
      // Only a REGISTERED product id is written down, even here: the unclaimed
      // row is still a row, and an unknown string in `app_id` would be the
      // [4]B-4a breach by another table. The refused value is in the log.
      appId: s.accountAppId !== null && deps.isKnownProduct(s.accountAppId) ? s.accountAppId : null,
    });
    return {
      outcome: 'unclaimed',
      detail: `no account is linked to ${n.provider} subscription ${s.subscriptionId}, and the notification carried no usable metadata`,
    };
  }
  const decision = decideSubscription(s, deps.nowMs);
  if (!decision.ok) return { outcome: 'refused', detail: decision.reason };
  // ⏱ 2026-09-27 · A LIFETIME IS NOT OVERWRITTEN BY A SUBSCRIPTION. The row is
  // keyed (user, app, entitlement), so a later event of a subscription the same
  // person also held — its cancellation, its lapse — would otherwise replace a
  // paid one-time grant and end it at the subscription's period end.
  const held = await liveOneTimeRow(deps, account);
  if (held !== null) {
    return {
      outcome: 'ignored',
      detail: `a one-time purchase (${held.provider} ${held.provider_transaction_id ?? '-'}) holds ${account.appId} for this account with no end date; this ${n.provider} subscription event changes no access to it`,
      userId: account.userId,
    };
  }
  const paidBack = await moneyWentBackFor(deps, account, n, s.subscriptionId, decision.decision.currentPeriodEnd);
  if (paidBack !== null) return { outcome: 'ignored', detail: paidBack, userId: account.userId };
  const written = await upsertEntitlement(deps, n, account, decision, {
    subscriptionId: s.subscriptionId,
    transactionId: s.transactionId,
    productId: s.productId ?? null,
    store: s.store ?? null,
  });
  return written
    ? { outcome: 'applied', ...account, isActive: decision.decision.isActive }
    : { outcome: 'stale', ...account };
}

async function applyAdjustment(
  deps: MoneyStoreDeps,
  n: NormalizedNotification,
  parsed: SubjectAdjustment,
): Promise<ApplyResult> {
  if (parsed.reason === null) {
    // A credit or a chargeback WARNING. It moves no access, and saying so is
    // not the same as failing to decide.
    return { outcome: 'ignored', detail: `adjustment action '${parsed.actionVerbatim}' changes no entitlement` };
  }
  // ⏱ 2026-10-02 · PR #1149 ruling item 2: on a payment-linked rail the subscription is the one
  // the stored `payment id → subscription id` link names, and only without a link is it whatever
  // the adjustment's own body said — never the payment entity's fields alone.
  const linked =
    PAYMENT_LINKED_PROVIDERS.includes(n.provider) && parsed.transactionId !== null
      ? await subscriptionOfPayment(deps, n, parsed.transactionId)
      : null;
  const a: SubjectAdjustment = linked === null ? parsed : { ...parsed, subscriptionId: linked };
  // ⏱ 2026-09-27 · A refund of a ONE-TIME purchase names its transaction and no
  // subscription, and the one-time path links the account by that transaction
  // (`applyOneTime`), so the transaction is the handle when no subscription is.
  const account = await resolveAccount(deps, n, a.subscriptionId ?? a.transactionId, { userId: null, appId: null });
  // No metadata is offered, so no link is attempted and none can be refused; the check keeps the type honest.
  if (account !== null && 'refused' in account) return { outcome: 'refused', detail: account.refused };
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
    // assert a revocation of something that was never given. The route answers
    // 503 for this outcome and the re-delivery is RE-DERIVED (`isUnconcluded`),
    // so it succeeds once the grant that preceded it has been processed —
    // test/money.test.ts drives exactly that order.
    return {
      outcome: 'refused',
      detail: 'an adjustment arrived for an account with no entitlement row — the grant it reverses has not been applied yet',
    };
  }
  // ⏱ 2026-09-27 · A refund of ANOTHER purchase does not end a lifetime: the row
  // is keyed (user, app, entitlement), so without this a refunded subscription
  // would revoke a one-time grant bought separately. The one-time purchase's own
  // refund names its own transaction and passes.
  const held = await liveOneTimeRow(deps, account);
  if (held !== null && held.provider_transaction_id !== a.transactionId) {
    return {
      outcome: 'ignored',
      detail: `adjustment '${a.actionVerbatim}' reverses ${a.transactionId ?? '(no transaction)'}, and ${account.appId} is held by the one-time purchase ${held.provider_transaction_id ?? '-'}, which it does not reverse`,
      userId: account.userId,
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

/**
 * ⏱ 2026-10-02 · PR #1149 ruling item 2 (option b) · THE RAILS WHOSE ADJUSTMENTS NAME A PAYMENT,
 * NOT A SUBSCRIPTION. A Razorpay refund or dispute carries `payment_id`; whether its payment entity
 * also names the subscription is unconfirmed (razorpay.ts header). So every subscription event of
 * such a rail that names the payment it charged (`subscription.charged`) writes
 * `payment id → subscription id` into `provider_payment_links` (migration 0025), and an adjustment
 * resolves its subscription through that link first. ⚠️ The link is fixture-proven only:
 * tooling/ports/payments.json keeps the razorpay `refund revokes` case PENDING until one real
 * test-mode refund is seen to resolve by it, so flip limb 5 cannot read the adapter as finished.
 */
const PAYMENT_LINKED_PROVIDERS: readonly string[] = ['razorpay'];

/** Write the charge's payment → subscription link. The FIRST link wins: a payment has one subscription. */
async function linkPayment(
  deps: MoneyStoreDeps,
  n: NormalizedNotification,
  paymentId: string,
  subscriptionId: string,
  userId: string | null,
): Promise<void> {
  await deps.db
    .prepare(
      `INSERT INTO provider_payment_links (
         provider, provider_payment_id, provider_subscription_id, user_id, environment, linked_at, linked_from_event_id
       ) VALUES (?,?,?,?,?,?,?)
       ON CONFLICT (provider, provider_payment_id) DO NOTHING`,
    )
    .bind(n.provider, paymentId, subscriptionId, userId, deps.environment, nowIso(), n.eventId)
    .run();
}

/** The subscription a stored charge linked this payment to, or null when no charge has. */
async function subscriptionOfPayment(
  deps: MoneyStoreDeps,
  n: NormalizedNotification,
  paymentId: string,
): Promise<string | null> {
  const row = await deps.db
    .prepare(
      `SELECT provider_subscription_id FROM provider_payment_links
        WHERE provider = ? AND provider_payment_id = ? AND environment = ?`,
    )
    .bind(n.provider, paymentId, deps.environment)
    .first<{ provider_subscription_id: string }>();
  return row?.provider_subscription_id ?? null;
}

/**
 * ⏱ 2026-09-27 · The rails whose one-time purchases this module writes: a row
 * from one of them with NO subscription, NO end date, active and unrevoked is a
 * lifetime grant. Only `applyOneTime` writes such a row — a subscription row
 * always carries its subscription id. The Razorpay one-time limb (D-b2) adds its
 * rail here.
 */
const ONE_TIME_PROVIDERS: readonly string[] = ['paddle'];

/** The live one-time (lifetime) grant this account holds on this app, or null. */
async function liveOneTimeRow(
  deps: MoneyStoreDeps,
  account: { userId: string; appId: string },
): Promise<{ provider: string; provider_transaction_id: string | null } | null> {
  const row = await deps.db
    .prepare(
      `SELECT provider, provider_transaction_id FROM entitlements
        WHERE user_id = ? AND app_id = ? AND entitlement = ?
          AND provider IN (SELECT value FROM json_each(?))
          AND provider_subscription_id IS NULL
          AND expires_at IS NULL AND is_active = 1 AND revoked_at IS NULL`,
    )
    .bind(account.userId, account.appId, MONEY_ENTITLEMENT, JSON.stringify(ONE_TIME_PROVIDERS))
    .first<{ provider: string; provider_transaction_id: string | null }>();
  return row ?? null;
}

/**
 * ⏱ 2026-09-27 · O-ONE-TIME-GRANT-UNBUILT — a ONE-TIME purchase of a single-app
 * product, written to `entitlements` with NO END DATE.
 *
 * Reached ONLY from src/lib/mor/grant.ts, which has already mapped the purchase's
 * price to OUR offering and passes that offering's app as `appId`; `derive`
 * above refuses a one-time subject that arrives without it.
 *
 *   · The account resolves as a subscription's does, with the TRANSACTION as the
 *     purchase handle: the checkout's metadata links it on first sight, and a
 *     later refund (which names the transaction and no subscription) resolves
 *     through that link. No account ⇒ `unclaimed`, recorded [5]M-7.
 *   · The purchase must be attributed to the app the price sells. A price for one
 *     product carrying another product's metadata is REFUSED, never granted to
 *     either.
 *   · `expires_at` is NULL — "Null means NO END DATE" (contract.ts
 *     EntitlementDecision) — and the row carries no subscription id, which is
 *     what `liveOneTimeRow` recognises. The ordering clause is the shared one.
 */
export async function applyOneTime(
  deps: MoneyStoreDeps,
  n: NormalizedNotification,
  s: SubjectOneTime,
  appId: string,
): Promise<ApplyResult> {
  // Checked BEFORE any link is written: the first link wins forever on this rail,
  // so metadata naming another product must not become the purchase's owner record.
  if (s.accountAppId !== null && s.accountAppId !== appId) {
    return {
      outcome: 'refused',
      detail: `one_time_app_mismatch: the price on ${n.provider} purchase ${s.transactionId} sells ${appId}, and its metadata names ${s.accountAppId}`,
    };
  }
  const account = await resolveAccount(deps, n, s.transactionId, {
    userId: s.accountUserId,
    appId: s.accountAppId,
  });
  if (account !== null && 'refused' in account) return { outcome: 'refused', detail: account.refused };
  if (account === null) {
    await recordUnclaimed(deps, n, {
      subscriptionId: null,
      transactionId: s.transactionId,
      customerId: s.customerId,
      customerEmail: s.customerEmail,
      appId: deps.isKnownProduct(appId) ? appId : null,
    });
    return {
      outcome: 'unclaimed',
      detail: `no account is linked to ${n.provider} one-time purchase ${s.transactionId}, and the notification carried no usable metadata`,
    };
  }
  if (account.appId !== appId) {
    return {
      outcome: 'refused',
      detail: `one_time_app_mismatch: the price on ${n.provider} purchase ${s.transactionId} sells ${appId}, and the purchase is attributed to ${account.appId}`,
    };
  }
  // ⏱ 2026-09-27 · THE ROW IS ORDERED ACROSS PURCHASES. The upsert's clause
  // compares occurred_at on the (user, app, entitlement) row, whichever purchase
  // wrote it, so a lifetime delivered AFTER a newer event of ANOTHER purchase —
  // the subscription it replaces, cancelled a minute after the lifetime was
  // bought — would conclude `stale` and grant nothing, paid for and silent.
  // Refused by name instead: stored, re-delivered, counted nightly, and left for
  // an operator's make-good. The same purchase's own older event passes to the
  // upsert and is `stale` there, as every re-delivery is.
  const ahead = await deps.db
    .prepare(
      `SELECT provider, provider_transaction_id, occurred_at FROM entitlements
        WHERE user_id = ? AND app_id = ? AND entitlement = ?
          AND occurred_at IS NOT NULL AND NOT (? > occurred_at)
          AND (provider_transaction_id IS NULL OR provider_transaction_id <> ?)`,
    )
    .bind(account.userId, account.appId, MONEY_ENTITLEMENT, n.occurredAt, s.transactionId)
    .first<{ provider: string; provider_transaction_id: string | null; occurred_at: string }>();
  if (ahead !== null && ahead !== undefined) {
    return {
      outcome: 'refused',
      detail: `one_time_behind_newer_event: ${n.provider} one-time purchase ${s.transactionId} (${n.occurredAt}) reached a row another purchase wrote at ${ahead.occurred_at} (${ahead.provider} ${ahead.provider_transaction_id ?? '-'}); the ordering clause would drop it, so it is refused for an operator rather than concluded stale`,
    };
  }
  const decision: DecisionOutcome & { ok: true } = {
    ok: true,
    decision: {
      isActive: 1,
      expiresAt: null,
      currentPeriodEnd: null,
      trialEnd: null,
      providerStatus: s.statusVerbatim,
      revokedAt: null,
      revocationReason: null,
    },
  };
  const written = await upsertEntitlement(deps, n, account, decision, {
    subscriptionId: null,
    transactionId: s.transactionId,
  });
  return written
    ? { outcome: 'applied', ...account, isActive: 1 }
    : { outcome: 'stale', ...account };
}
