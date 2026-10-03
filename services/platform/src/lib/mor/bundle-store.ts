// ─────────────────────────────────────────────────────────────────────────────
// THE ONE WRITER INTO `bundle_grants`. [ADR 057] §5 — ONE WRITER PER TABLE.
//
// The companion to store.ts, and separate from it for the reason [ADR 057] §5
// gives for refusing to materialise bundle grants back into `entitlements`: two
// writers to one table drift about what "older" means, and then two concurrent
// deliveries race over one row. `entitlements` already has two writers and limb
// 5 of tooling/ci/assert-entitlement-contract.mjs exists to hold them in step.
// `bundle_grants` is NEW, so the stronger constraint is still available and limb
// 10 enforces it: EXACTLY ONE `INSERT INTO bundle_grants` in all of `services/`,
// carrying the ordering clause verbatim. That single upsert is `upsertBundleGrant`
// below and there must never be a second one anywhere.
//
// 🔴 WHAT THIS MODULE REFUSES TO DO, and the refusal is the point of the unit:
// it will not write a grant from anything a client said. Every caller must hand
// it a `VerifiedGrant`, and the only way to obtain one is a server-side answer
// from the rail — a signed notification the money route already verified, or a
// receipt the server pulled from the store's own API
// (src/lib/receipts/*). tooling/ci/assert-bundle-provenance.mjs (invariant G7)
// asserts that property over the tree rather than trusting this comment: a code
// path that reaches this function with a feature set, an expiry or a source taken
// from a request body goes RED.
//
// [5]M-2 · ORDERING IS THE PROVIDER'S CLOCK AND THE COMPARISON IS IN THE SQL.
// No rail guarantees delivery order. A refund at T2 and a retried purchase from
// T1 < T2 are two different events, both genuinely new, and the late one
// re-grants a refunded bundle. The tail clause below is the same shape 0004's
// writer carries, against this table's own columns, and it is in the statement
// rather than in TypeScript so there is no read-modify-write window two
// concurrent deliveries could both pass.
//
// [5]M-12 · a row records which money world granted it. `provider_environment`
// is written from CONFIGURATION, never from the payload, exactly as store.ts
// does it — the union read denies a row from the other world, and a row with no
// world at all.
// ─────────────────────────────────────────────────────────────────────────────
import type { SqlDb } from '../../../../_shared/src/ports/sql';
import { nowIso } from '../d1';
import type { MoneyEnvironment } from './contract';

/**
 * The identity a bundle grant is minted from.
 *
 * 🔴 BOTH HALVES, ALWAYS. `grant_id` is `sha256(provider ‖ NUL ‖
 * provider_subscription_id)` — the migration's own words — so it is
 * REPRODUCIBLE from the notification alone. A retried delivery derives the same
 * id and the upsert stays an upsert instead of becoming an append, which is the
 * failure [ADR 057] measured against a NULL key column (3 identical inserts, 3
 * rows, no error).
 *
 * The NUL separator is not decoration: without it `('apple_iap','x1')` and
 * `('apple','iapx1')` hash identically, and two rails' subscriptions would
 * collide onto one grant. NUL cannot occur in either half — a provider id is a
 * registry key and a subscription id is a rail handle — so it is the one
 * separator that cannot be forged into the input.
 */
export async function mintGrantId(provider: string, providerSubscriptionId: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${provider}\u0000${providerSubscriptionId}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * A grant the SERVER has evidence for.
 *
 * The type exists to make the provenance rule checkable rather than remembered:
 * nothing constructs one of these except a verified rail answer, and the fields
 * that decide access (`source`, the feature set, the dates) are therefore
 * server-derived by construction. A client body cannot become one of these
 * without a verifier having spoken first.
 */
export interface VerifiedGrant {
  /** The Supabase `sub`, from the verified JWT. Never from a request body. */
  readonly userId: string;
  /** A member of the `bundle_sources` set seeded by migration 0009. */
  readonly source: string;
  /** The PINNED feature set. [ADR 057] §4 — resolved server-side, at insert. */
  readonly featureSetName: string;
  readonly featureSetVersion: number;
  /** The rail. `provider` is the registry key; both are required — see mintGrantId. */
  readonly provider: string;
  readonly providerSubscriptionId: string;
  readonly providerTransactionId: string | null;
  readonly providerStatus: string | null;
  /** The rail's own event/receipt identity, and the rail's own clock. */
  readonly lastEventId: string | null;
  readonly occurredAt: string | null;
  readonly currentPeriodEnd: string | null;
  readonly trialEnd: string | null;
  /** The RESOLVED access end. NULL means lifetime — the read's rule 3. */
  readonly expiresAt: string | null;
  readonly graceUntil: string | null;
  readonly revokedAt: string | null;
  readonly revocationReason: string | null;
  /** §3.5's entitlement-side proration answer, RECORDED not recomputed. */
  readonly creditDaysApplied: number | null;
  /**
   * ⏱ 2026-09-27 · The term ONE grant was sold on, when its source sells both
   * (migration 0018 `bundle_grants.term`): a store SKU's own term, from the
   * rendered SKU map (src/lib/mor/store-skus.ts). Absent or null ⇒ the source's
   * term applies (the read is `COALESCE(g.term, s.term)`), which is every
   * receipt-route grant today.
   */
  readonly term?: 'subscription' | 'one_time' | null;
}

export interface BundleStoreDeps {
  db: SqlDb;
  /** From configuration, never from the payload. [5]M-12 */
  environment: MoneyEnvironment;
}

export interface BundleGrantRow {
  grant_id: string;
  user_id: string;
  source: string;
  feature_set_name: string;
  feature_set_version: number;
  provider: string | null;
  provider_environment: string | null;
  provider_subscription_id: string | null;
  provider_status: string | null;
  occurred_at: string | null;
  current_period_end: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  revocation_reason: string | null;
  credit_days_applied: number | null;
  superseded_by: string | null;
  created_at: string;
}

export type BundleWriteResult =
  /** The row was written or updated. */
  | { outcome: 'applied'; grantId: string }
  /** The event is OLDER than the state already stored. Correctly ignored. */
  | { outcome: 'stale'; grantId: string };

/**
 * 🔴 THE ONE UPSERT. Limb 10 of assert-entitlement-contract.mjs compares the tail
 * clause below against its own copy after whitespace normalisation and refuses a
 * SECOND `INSERT INTO bundle_grants` anywhere under `services/`.
 *
 * The conflict target is `(provider, provider_subscription_id)` WITH the partial
 * index's predicate, because that is the uniqueness the migration actually
 * created — a bare two-column target does not match a partial index and SQLite
 * refuses the statement. It is also the right key: the identity a provider
 * restates on every renewal, cancellation and refund is the subscription, and
 * `grant_id` is derived FROM it rather than being independent of it.
 *
 * Returns `stale` when the conflict fired and the ordering clause refused the
 * update — an older event arriving late, which is a correct outcome and not an
 * error.
 */
export async function upsertBundleGrant(
  deps: BundleStoreDeps,
  grant: VerifiedGrant,
): Promise<BundleWriteResult> {
  const grantId = await mintGrantId(grant.provider, grant.providerSubscriptionId);
  const now = nowIso();
  const res = await deps.db
    .prepare(
      `INSERT INTO bundle_grants (
         grant_id, user_id, source, feature_set_name, feature_set_version,
         provider, provider_environment, provider_subscription_id, provider_transaction_id,
         provider_status, last_event_id, occurred_at, current_period_end, trial_end,
         expires_at, grace_until, revoked_at, revocation_reason, credit_days_applied,
         superseded_by, created_at, updated_at, term
       ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,?,?,?)
       ON CONFLICT (provider, provider_subscription_id)
         WHERE provider IS NOT NULL AND provider_subscription_id IS NOT NULL
       DO UPDATE SET
         source                  = excluded.source,
         feature_set_name        = excluded.feature_set_name,
         feature_set_version     = excluded.feature_set_version,
         provider_environment    = excluded.provider_environment,
         provider_transaction_id = excluded.provider_transaction_id,
         provider_status         = excluded.provider_status,
         last_event_id           = excluded.last_event_id,
         occurred_at             = excluded.occurred_at,
         current_period_end      = excluded.current_period_end,
         trial_end               = excluded.trial_end,
         expires_at              = excluded.expires_at,
         grace_until             = excluded.grace_until,
         revoked_at              = excluded.revoked_at,
         revocation_reason       = excluded.revocation_reason,
         credit_days_applied     = excluded.credit_days_applied,
         updated_at              = excluded.updated_at,
         term                    = excluded.term
       WHERE bundle_grants.occurred_at IS NULL OR excluded.occurred_at > bundle_grants.occurred_at`,
    )
    .bind(
      grantId,
      grant.userId,
      grant.source,
      grant.featureSetName,
      grant.featureSetVersion,
      grant.provider,
      deps.environment,
      grant.providerSubscriptionId,
      grant.providerTransactionId,
      grant.providerStatus,
      grant.lastEventId,
      grant.occurredAt,
      grant.currentPeriodEnd,
      grant.trialEnd,
      grant.expiresAt,
      grant.graceUntil,
      grant.revokedAt,
      grant.revocationReason,
      grant.creditDaysApplied,
      now,
      now,
      grant.term ?? null,
    )
    .run();
  return (res.meta?.changes ?? 0) > 0
    ? { outcome: 'applied', grantId }
    : { outcome: 'stale', grantId };
}

/**
 * Every LIVE grant this subject holds, in the reader's money world.
 *
 * "Live" is the same fail-closed shape the entitlement read applies, expressed
 * in SQL where it can use an index: not revoked, this world (a row with NO world
 * is undecidable and is excluded here exactly as the read denies it), and not
 * past its expiry — with `expires_at IS NULL` meaning LIFETIME, which grants,
 * rather than "no value", which would deny. An unparseable expiry cannot be
 * filtered in SQL, so it is left to the caller, which is the only place that can
 * apply the same `Date.parse` the route does.
 */
export async function liveGrantsFor(
  deps: BundleStoreDeps,
  userId: string,
): Promise<BundleGrantRow[]> {
  const res = await deps.db
    .prepare(
      `SELECT grant_id, user_id, source, feature_set_name, feature_set_version,
              provider, provider_environment, provider_subscription_id, provider_status,
              occurred_at, current_period_end, expires_at, revoked_at, revocation_reason,
              credit_days_applied, superseded_by, created_at
         FROM bundle_grants
        WHERE user_id = ? AND revoked_at IS NULL AND provider_environment = ?`,
    )
    .bind(userId, deps.environment)
    .all<BundleGrantRow>();
  return res.results ?? [];
}

/**
 * Whether one already-fetched grant row is CURRENT, applying the same rules the
 * entitlement read applies to an `entitlements` row.
 *
 * Kept beside the query rather than inside it because the unparseable-expiry
 * branch cannot be expressed in SQL, and splitting the policy across two places
 * is the drift this repository has already paid for once.
 */
export function grantIsCurrent(row: BundleGrantRow, nowMs: number): boolean {
  if (row.revoked_at !== null) return false;
  if (row.expires_at === null || row.expires_at === undefined) return true; // lifetime
  const exp = Date.parse(row.expires_at);
  // Undecidable ⇒ DENY. "We cannot read when this ends" is not "it never ends".
  if (Number.isNaN(exp)) return false;
  return exp > nowMs;
}

/**
 * Record that an older grant has been replaced.
 *
 * ⚠️ THIS IS AN UPDATE, NOT AN INSERT, AND THAT IS WHY IT DOES NOT BREACH THE
 * ONE-WRITER RULE. [ADR 057] §5 is about who can bring a grant INTO existence and
 * about two writers disagreeing over what "older" means; `superseded_by` is a
 * LINK written after both rows already exist, and it moves no access — the union
 * read still honours a superseded row. That distinction is the whole of §3.4's
 * race handling: the server records both grants and serves the union, because it
 * CANNOT cancel the loser on any store rail and pretending otherwise would be
 * the failure mode.
 */
export async function markSuperseded(
  deps: BundleStoreDeps,
  olderGrantId: string,
  newerGrantId: string,
): Promise<void> {
  await deps.db
    .prepare(
      `UPDATE bundle_grants SET superseded_by = ?, updated_at = ?
        WHERE grant_id = ? AND superseded_by IS NULL`,
    )
    .bind(newerGrantId, nowIso(), olderGrantId)
    .run();
}
