// ─────────────────────────────────────────────────────────────────────────────
// THE PROMO GRANT (lane growth-codes): free Pro months on ONE app, written as a
// `bundle_grants` row through the ONE writer (src/lib/mor/bundle-store.ts).
//
//   source            `promo_code` — requires_receipt 0, so the AI meter
//                     (src/lib/ai/meter.ts planOf) never counts it as PAID: a
//                     code or an invite reward NEVER buys an AI allowance.
//   feature set       `promo_<app>` version 1, one member: the app. Pinned here
//                     on first use (ON CONFLICT DO NOTHING, so it is minted once
//                     and its membership can never be rewritten).
//   term              `one_time`: the grant resolves to its pinned version and
//                     never rolls to a bundle.
//   provider          `nikatru_code`, with the redemption (or invite reward) id
//                     as the subscription id — so a retry derives the same
//                     grant_id and the upsert stays an upsert.
//   last_event_id     the OPERATOR RECORD: `code:<issued_by>` or
//                     `invite:<offer>` — tooling/ci/assert-bundle-provenance.mjs
//                     limb 5.
//   expires_at        NEVER STACKED (the brief's rule): the months start when the
//                     account's live trial for the app ends, or its live free
//                     months end, or now — whichever is latest. One free month
//                     at a time, and never inside a trial.
//
// 🔴 A RELAY, NOT A DOOR (assert-bundle-provenance limb 3b): every caller must
// verify first — routes/codes.ts through `codeVerifier(...).verify(`, and
// routes/invites.ts through `inviteEligibility.verify(` — and nothing here takes
// a field from a request body.
// ─────────────────────────────────────────────────────────────────────────────
import type { SqlDb } from '../../../../_shared/src/ports/sql';
import { upsertBundleGrant } from '../mor/bundle-store';
import type { MoneyEnvironment } from '../mor/contract';
import { catalogueApp } from '../catalog';
import { firstRow, nowIso, run } from '../d1';

export const PROMO_PROVIDER = 'nikatru_code';
// @ceiling none — a feature-set version number, not a platform resource
export const PROMO_FEATURE_SET_VERSION = 1;
export const promoFeatureSet = (appId: string): string => `promo_${appId}`;

/** `iso` plus `months` calendar months, UTC. */
export function addMonths(iso: string, months: number): string {
  const d = new Date(iso);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString();
}

export interface PromoGrant {
  /** The verified session's `sub`, or the inviter the server read from its own row. */
  readonly userId: string;
  readonly appId: string;
  readonly months: number;
  /** The redemption id or invite reward id: the grant's identity. */
  readonly grantKey: string;
  /** Who authorised it: `code:<issued_by>` or `invite:<offer id>`. */
  readonly operator: string;
  readonly nowIso: string;
}

/** Mint `promo_<app>`@1 with the app as its one member. Throws for an app no catalogue row knows. */
async function pinPromoSet(db: SqlDb, appId: string): Promise<void> {
  if (catalogueApp(appId) === undefined) throw new Error(`promo grant: ${appId} is not a catalogue app`);
  const name = promoFeatureSet(appId);
  await run(
    db
      .prepare(`INSERT INTO feature_sets (name, version, minted_at, minted_from, status) VALUES (?,?,?,?,?) ON CONFLICT (name, version) DO NOTHING`)
      .bind(name, PROMO_FEATURE_SET_VERSION, nowIso(), 'tooling/catalog/offers.json', 'sellable'),
  );
  await run(
    db
      .prepare(`INSERT INTO feature_set_members (name, version, product_slug, product_kind) VALUES (?,?,?,?) ON CONFLICT (name, version, product_slug) DO NOTHING`)
      .bind(name, PROMO_FEATURE_SET_VERSION, appId, 'app'),
  );
}

/**
 * When new free months may start: the latest of now, a live trial's end for
 * this app (the rail's `trial_end`), and the end of free months already held.
 */
export async function promoStart(db: SqlDb, userId: string, appId: string, at: string): Promise<string> {
  const trial = await firstRow<{ t: string | null }>(
    db.prepare('SELECT MAX(trial_end) AS t FROM entitlements WHERE user_id = ? AND app_id = ? AND trial_end > ?').bind(userId, appId, at),
  );
  const promo = await firstRow<{ t: string | null }>(
    db
      .prepare(
        "SELECT MAX(expires_at) AS t FROM bundle_grants WHERE user_id = ? AND source = 'promo_code' AND feature_set_name = ? AND revoked_at IS NULL AND expires_at > ?",
      )
      .bind(userId, promoFeatureSet(appId), at),
  );
  return [at, trial?.t ?? at, promo?.t ?? at].reduce((a, b) => (Date.parse(b) > Date.parse(a) ? b : a));
}

/** Write the grant. Returns its expiry. */
export async function grantPromoMonths(
  deps: { db: SqlDb; environment: MoneyEnvironment },
  g: PromoGrant,
): Promise<{ expiresAt: string; grantKey: string }> {
  await pinPromoSet(deps.db, g.appId);
  const expiresAt = addMonths(await promoStart(deps.db, g.userId, g.appId, g.nowIso), g.months);
  await upsertBundleGrant(deps, {
    userId: g.userId,
    source: 'promo_code',
    term: 'one_time',
    featureSetName: promoFeatureSet(g.appId),
    featureSetVersion: PROMO_FEATURE_SET_VERSION,
    provider: PROMO_PROVIDER,
    providerSubscriptionId: g.grantKey,
    providerTransactionId: null,
    providerStatus: 'active',
    lastEventId: g.operator, // the operator record (limb 5)
    occurredAt: g.nowIso,
    currentPeriodEnd: expiresAt,
    trialEnd: null,
    expiresAt,
    graceUntil: null,
    revokedAt: null,
    revocationReason: null,
    creditDaysApplied: null,
  });
  return { expiresAt, grantKey: g.grantKey };
}
