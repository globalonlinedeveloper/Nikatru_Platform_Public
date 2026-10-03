// ─────────────────────────────────────────────────────────────────────────────
// entitlement-read.ts — THE ONE READER OF A CUSTOMER'S ENTITLEMENT.
//
// [ADR 057] §5: the entitlement read is a UNION of a per-app `entitlements` row
// and a `bundle_grants` row whose PINNED feature set contains the product, and
// there is ONE reader of it. [ADR 067] decision 2: a module every Worker needs
// has one home, and every carrier imports it instead of copying it.
//
// ── ⏱ 2026-09-10 · WHY THIS FILE EXISTS, MEASURED ON origin/main 543b3220 ────
// Two readers existed. `services/platform/src/routes/entitlements.ts` carried
// the union (#587), the extension membership (#612) and the receipts wave
// (#603); `services/subscriptiontracker-api/src/routes/entitlements.ts` carried
// its own `SELECT … FROM entitlements` with ZERO references to `bundle_grants`,
// `granted_via` or `feature_set`. Both were served at `/v1/entitlements`. A
// bundle purchase was therefore invisible to any caller of api.nikatru.com —
// today `DioApiClient.getEntitlements()`, which has no live caller and is one
// wiring change from having one (the live app path is
// `DioEntitlementTransport` → platform.nikatru.com, which had the union).
// The doctrine says ONE reader; the tree held two, and the one nobody upgraded
// was the one that would have kept a refunded — or a newly-bundled — customer
// on the wrong answer. So the read moved HERE, both Workers mount it, and
// tooling/ci/assert-one-entitlement-reader.mjs refuses a second one.
//
// Rejected alternative: the api Worker proxies to platform. That adds a network
// hop and a second failure mode to a read the app makes on every launch, and it
// still leaves two code paths answering one question.
//
// ── 🔴 THE FAIL-CLOSED RULES, ALL OF THEM, WITH THE IDS THE REVIEW USES ─────
// (REVIEW-platform-2026-09-10 §2 "Fail-closed audit", verified correct on
// 7bdde682; every one is preserved here and asserted by both Workers' suites.)
//
//   ROW RULES — `grantsAccess`, ONE function for BOTH branches of the union:
//     rule 1  `is_active !== 1`                        → deny
//     rule 2  environment mismatch, INCLUDING NULL     → deny   [5]M-12
//     rule 3  `expires_at IS NULL`                     → GRANT  (lifetime)
//     rule 4  `expires_at` present but UNPARSEABLE     → deny   (undecidable ≠ never ends)
//     rule 5  otherwise                                → `expires_at > now`
//   BUNDLE PROJECTION — `bundleRowToGrantable`:
//     G8      `revoked_at` set                         → is_active 0 for EVERY member
//     rule 4' unparseable OR contradictory `grace_until` → undecidable → deny
//     G10     membership joins the tables, never the register: a `one_time` grant
//             its PINNED (name, version), a `subscription` grant the latest
//             `sellable` version (ADR no.099, bundle membership by term; 0018)
//     G11     rule 2 applies to the bundle branch unchanged
//   READ-LEVEL REFUSALS — `readProductEntitlement` / `readSubjectEntitlements`:
//     [5]M-4  unknown product                          → `unknown_product` (carrier answers 404)
//     [5]M-12 MONEY_ENVIRONMENT undeclared/unrecognised → `money_rail_not_configured` (carrier answers 503)
//     DB error on ANY statement                        → THROWS. This module catches
//             nothing, so the carrier's `app.onError` answers 500 `internal_error`
//             and no code path can answer `is_pro: true` on an exception.
//
// ── 🔴 WHAT IS INJECTED, AND WHY NOTHING IS IMPORTED ─────────────────────────
// Nothing under services/_shared/src may carry a bare import or a `..` import
// (test/shared-home.test.ts measures why: there is no node_modules any carrier
// can reach from here, and a `..` specifier makes the one home depend on one
// carrier). So this file names no framework and no catalogue. Each carrier
// hands in:
//   · `allRows`          — ITS transient-D1 retry (services/<w>/src/lib/d1.ts),
//                          held equal across carriers by twinned-worker-modules.
//   · `isMoneyEnvironment` — ITS copy of the two-value money vocabulary
//                          (platform: contracts/entitlement/contract.js via
//                          lib/mor/contract.ts; the per-app Worker: lib/money.ts,
//                          whose header records why it restates rather than imports).
//   · `isKnownProduct`   — ITS known-product set. On the shared host that is the
//                          union of every product register (src/config.ts, which
//                          inlines catalog JSON and MUST NOT be imported by anything
//                          a guard loads under bare Node — ERR_IMPORT_ATTRIBUTE_MISSING,
//                          2026-09-09). On a per-app Worker it is the singleton
//                          `{ APP_ID }`: that Worker answers for exactly one product,
//                          by construction, and its route never reads the id from
//                          the request.
//   · `warn` / `error`   — the carrier's log sinks. Every line correlates by
//                          REQUEST ID, never by user id: the subject is a Supabase
//                          `sub` and these lines land in Workers Logs outside the
//                          PiiScrubber seam.
//
// ── 🔴 NOTHING IS MATERIALISED BACK INTO `entitlements` ──────────────────────
// The rejected alternative was fanning a bundle grant out into per-app rows; it
// fails because two writers to one table drift, which is what limb 5 of
// assert-entitlement-contract.mjs already exists for. One writer (store.ts) per
// table; combine at read time, here.
//
// ── THE WIRE SHAPE IS RENDERED BY THE CARRIER, NOT HERE ──────────────────────
// This module returns a DECISION (`ProductEntitlementRead`); each route writes
// the `c.json({ … })` literal itself so tooling/ci/assert-analytics-contract.mjs
// can keep pinning the envelope against the released Dart client by reading the
// route file — and it FOLLOWS the route's `entitlements: read.entitlements` into
// `readProductEntitlement` below for the item literal. The two envelopes are
// held byte-identical at runtime by each Worker's
// test/one-entitlement-reader.test.ts, which seed the SAME rows and assert the
// SAME expected bytes (services/_shared/test/entitlement-parity.ts) against
// their own carrier — neither suite imports the other Worker.
// ─────────────────────────────────────────────────────────────────────────────
import type { SqlDb, SqlStatement } from './ports/sql';

/** What a carrier hands the reader. Every member is the carrier's own plumbing. */
export interface EntitlementReadDeps {
  readonly db: SqlDb;
  /** The carrier's `allRows` — the transient-D1 retry lives with the carrier. */
  readonly allRows: <T>(stmt: SqlStatement) => Promise<T[]>;
  /** The carrier's copy of the two-value money vocabulary ('live' | 'sandbox'). */
  readonly isMoneyEnvironment: (v: unknown) => boolean;
  /** Whether `id` is a product this deploy may answer for. */
  readonly isKnownProduct: (id: unknown) => boolean;
  readonly warn: (message: string) => void;
  readonly error: (message: string) => void;
  /** Injectable clock; defaults to `Date.now`. */
  readonly nowMs?: () => number;
}

/**
 * The minimum a row must present to be DECIDED. Both branches project into this
 * shape; neither branch decides for itself.
 */
export interface GrantableRow {
  /** For the deny log only. Never used in the decision. */
  readonly label: string;
  /** 1 = the row asserts access. Any other value denies. */
  readonly is_active: number;
  /** Which money world wrote it. NULL is UNDECIDABLE and denies. */
  readonly provider_environment: string | null;
  /** NULL = lifetime (grants). Present-but-unparseable = undecidable (denies). */
  readonly expires_at: string | null;
}

/**
 * THE FIVE FAIL-CLOSED RULES, in one place, for both branches of the union.
 *
 *   1. `is_active !== 1`                       → deny
 *   2. environment mismatch, INCLUDING NULL    → deny  [5]M-12
 *   3. `expires_at IS NULL`                    → GRANT (lifetime)
 *   4. `expires_at` present but unparseable    → deny  (undecidable is not "never ends")
 *   5. otherwise                               → `expires_at > now`
 *
 * Rule 2 including NULL is the fail-closed rule applied to itself: "written
 * before the rail knew" is not evidence of a payment. Rules 3 and 4 stay
 * distinct because collapsing them is how a damaged row became a lifetime grant
 * to anybody in the version this logic replaced (`Number.isNaN(exp) ? true`).
 *
 * `environment` is a plain string here on purpose: this module does not own the
 * money vocabulary, the carrier's `isMoneyEnvironment` has already admitted the
 * value before any row is decided, and rule 2 is a comparison, not a constant.
 */
export function grantsAccess(
  r: GrantableRow,
  environment: string,
  nowMs: number,
  warn: (message: string) => void,
): boolean {
  if (r.is_active !== 1) return false;
  if (r.provider_environment !== environment) {
    warn(
      `${r.label} — row's money environment is ${JSON.stringify(r.provider_environment)}, this deploy is ` +
        `'${environment}'. Denying. [5]M-12`,
    );
    return false;
  }
  if (r.expires_at === null || r.expires_at === undefined) return true; // lifetime
  const exp = Date.parse(r.expires_at);
  if (Number.isNaN(exp)) {
    warn(`${r.label} — unparseable expires_at, denying (fail closed)`);
    return false;
  }
  return exp > nowMs;
}

/** The `entitlements` row shape the per-product read projects. Named columns,
 *  not `SELECT *`: the shared table grows a column with every platform
 *  migration, and `*` would ship each one to every client without anybody
 *  deciding that. Exported for the per-app Worker's schema-witness test, which
 *  asserts every field here is a real column of the shipped migrations. */
export interface EntitlementRow {
  entitlement: string;
  product_id: string | null;
  store: string | null;
  is_active: number;
  expires_at: string | null;
  provider: string | null;
  provider_environment: string | null;
  provider_status: string | null;
  current_period_end: string | null;
  trial_end: string | null;
  revocation_reason: string | null;
}

/** A `bundle_grants` row, as the read projects it. */
export interface BundleGrantRow {
  grant_id: string;
  feature_set_name: string;
  feature_set_version: number;
  source: string;
  provider: string | null;
  provider_environment: string | null;
  provider_status: string | null;
  expires_at: string | null;
  grace_until: string | null;
  revoked_at: string | null;
  superseded_by: string | null;
  /** The version whose members this grant is SERVED — `bundleGrantsServed` says which, by term. */
  served_version: number | null;
}

/** A sentinel that can never parse, so an undecidable date DENIES rather than defaults. */
const UNDECIDABLE = ' undecidable';

/**
 * Project a bundle grant into the shape `grantsAccess` decides.
 *
 * TWO COLUMNS THE PER-APP TABLE DOES NOT HAVE, AND HOW THEY MAP:
 *
 * · `revoked_at` IS the bundle's `is_active`. A revoked grant is inactive for
 *   EVERY member product, which is invariant G8 — and it is expressed here,
 *   once, rather than per product, so a revocation cannot propagate to some
 *   members and not others.
 *
 * · `grace_until` EXTENDS access past `expires_at`. The effective end is the
 *   LATER of the two, computed here rather than in SQL: SQLite would compare
 *   them as strings, which is correct only while both are the same ISO shape,
 *   and "correct while nobody writes a different shape" is not a property.
 *
 * 🔴 AN UNPARSEABLE `grace_until` DENIES, exactly as an unparseable `expires_at`
 * does. A grace date we cannot read is not "no grace", it is a row we cannot
 * decide — and the whole posture of this rail is that undecidable denies. The
 * sentinel makes that reuse rule 4 instead of adding a sixth rule.
 */
export function bundleRowToGrantable(r: BundleGrantRow): GrantableRow {
  const label = `bundle ${r.feature_set_name}@${r.feature_set_version}`;
  let effective: string | null = r.expires_at;
  if (r.grace_until !== null && r.grace_until !== undefined) {
    const g = Date.parse(r.grace_until);
    if (Number.isNaN(g)) {
      effective = UNDECIDABLE;
    } else if (effective === null) {
      // A lifetime grant with a grace window is a contradiction: grace exists to
      // extend an END, and this row has none. Honouring the lifetime shape is the
      // wrong direction here, because the only way this row exists is a writer
      // that set both. Undecidable, therefore denied.
      effective = UNDECIDABLE;
    } else {
      const e = Date.parse(effective);
      effective = Number.isNaN(e) ? UNDECIDABLE : g > e ? r.grace_until : effective;
    }
  }
  return {
    label,
    is_active: r.revoked_at === null || r.revoked_at === undefined ? 1 : 0,
    provider_environment: r.provider_environment,
    expires_at: effective,
  };
}

/**
 * THE MEMBERSHIP RULE, IN ONE STATEMENT. ADR no.099, bundle membership by term,
 * amending [ADR 057] §4: a grant's members are a function of its TERM,
 * `COALESCE(g.term, s.term)` — the grant's own term where its source sells both
 * (a store rail), else its source's (migration 0018).
 *
 *   · `one_time`     → the version the grant PINNED (`g.feature_set_version`)
 *                      — the ELSE branch. A lifetime buyer owns exactly what
 *                      was sold: G10.
 *   · `subscription` → the LATEST `sellable` version of the feature set, so a
 *                      product that joins the bundle reaches every current
 *                      subscriber and no grant row is ever rewritten. With no
 *                      sellable version at all (every one retired), the pinned
 *                      version — a paying subscriber never resolves to nothing.
 *
 * `served_version` is that version. The pin is still recorded and still
 * returned (`feature_set_version`): it is the audit of what was sold, not what
 * is served. A grant whose term cannot be read — its source is not a
 * `bundle_sources` row and it carries no term of its own — resolves by the
 * pre-0018 rule, its pin: never MORE than it was sold, and no grant that
 * resolved before this migration resolves to less. Which sources exist is
 * assert-bundle-provenance.mjs's and assert-entitlement-contract.mjs limb 9's
 * to grade, not this read's.
 *
 * `productSlug` null returns every grant (the subject read); a slug returns the
 * grants whose SERVED version contains it (the per-product read). One statement
 * for both, so the two routes cannot disagree about a rolled grant.
 */
async function bundleGrantsServed(
  deps: Pick<EntitlementReadDeps, 'db' | 'allRows'>,
  userId: string,
  productSlug: string | null,
): Promise<BundleGrantRow[]> {
  return deps.allRows<BundleGrantRow>(
    deps.db
      .prepare(
        `SELECT x.* FROM (
           SELECT g.grant_id, g.feature_set_name, g.feature_set_version, g.source,
                  g.provider, g.provider_environment, g.provider_status,
                  g.expires_at, g.grace_until, g.revoked_at, g.superseded_by,
                  CASE COALESCE(g.term, s.term)
                    WHEN 'subscription' THEN COALESCE(
                      (SELECT MAX(f.version) FROM feature_sets f
                        WHERE f.name = g.feature_set_name AND f.status = 'sellable'),
                      g.feature_set_version)
                    ELSE g.feature_set_version
                  END AS served_version
             FROM bundle_grants g
             LEFT JOIN bundle_sources s ON s.source = g.source
            WHERE g.user_id = ?) x
          WHERE ? IS NULL
             OR EXISTS (
                  SELECT 1 FROM feature_set_members m
                   WHERE m.name = x.feature_set_name
                     AND m.version = x.served_version
                     AND m.product_slug = ?)`,
      )
      .bind(userId, productSlug, productSlug),
  );
}

/**
 * Every bundle grant this user holds whose SERVED version contains
 * `productSlug` — the membership join is on `(name, served_version)`, so the
 * term rule above is a property of the SQL rather than of a reader's care.
 */
export async function bundleGrantsForProduct(
  deps: Pick<EntitlementReadDeps, 'db' | 'allRows'>,
  userId: string,
  productSlug: string,
): Promise<BundleGrantRow[]> {
  return bundleGrantsServed(deps, userId, productSlug);
}

/** Every bundle grant this user holds, member-filtered by nothing — the subject read. */
export async function bundleGrantsForUser(
  deps: Pick<EntitlementReadDeps, 'db' | 'allRows'>,
  userId: string,
): Promise<BundleGrantRow[]> {
  return bundleGrantsServed(deps, userId, null);
}

/**
 * The member slugs of one PINNED feature-set version, in a stable order.
 *
 * Ordered by slug so the rendered `bundle.products` array does not change shape
 * between two reads of the same grant — an unordered list is a response that
 * looks different every deploy and makes any client-side diff meaningless.
 */
export async function membersOfPinnedVersion(
  deps: Pick<EntitlementReadDeps, 'db' | 'allRows'>,
  name: string,
  version: number,
): Promise<string[]> {
  const rows = await deps.allRows<{ product_slug: string }>(
    deps.db
      .prepare(
        `SELECT product_slug FROM feature_set_members
          WHERE name = ? AND version = ?
          ORDER BY product_slug ASC`,
      )
      .bind(name, version),
  );
  return rows.map((r) => r.product_slug);
}

/**
 * The members a grant is SERVED: its `served_version`'s members. A grant with
 * no served version (none the rule can resolve) is served nothing — the
 * fail-closed direction, and unreachable while 0018's CHECKs hold.
 */
async function servedMembers(
  deps: Pick<EntitlementReadDeps, 'db' | 'allRows'>,
  g: BundleGrantRow,
): Promise<string[]> {
  return g.served_version === null ? [] : membersOfPinnedVersion(deps, g.feature_set_name, g.served_version);
}

// ─────────────────────────────────────────────────────────────────────────────
// THE PER-PRODUCT READ — `GET /v1/entitlements` on EVERY carrier.
// ─────────────────────────────────────────────────────────────────────────────

/** One per-app row as the wire carries it. The rows are returned even when they
 *  grant nothing, so a client and a support conversation can both see that a
 *  row EXISTS and why it is inert. `provider_environment` is NOT on the wire:
 *  the money world is a deploy fact, the deny reason is logged server-side
 *  with the request id, and the released client never read it. */
export interface WireEntitlement {
  entitlement: string;
  product_id: string | null;
  store: string | null;
  is_active: boolean;
  expires_at: string | null;
  provider: string | null;
  provider_status: string | null;
  current_period_end: string | null;
  trial_end: string | null;
  revocation_reason: string | null;
}

/** The PINNED feature set a live bundle grant was sold under. Rendered from the
 *  pin, never from the register, for the same reason the decision joins on it:
 *  it describes what the customer BOUGHT, never what the bundle contains today. */
export interface WireBundleBlock {
  feature_set: string;
  version: number;
  products: string[];
  expires_at: string | null;
  source: string;
}

export type GrantedVia = 'app' | 'bundle' | 'none';

export type ProductEntitlementRead =
  /** [5]M-4 — an unknown id is a refusal, not an empty list: an empty list says
   *  "you own nothing here", a different and misleading answer to "no such product". */
  | { readonly kind: 'unknown_product' }
  /** [5]M-12 — no safe default exists; the carrier answers 503. */
  | { readonly kind: 'money_rail_not_configured' }
  | {
      readonly kind: 'ok';
      readonly app_id: string;
      readonly is_pro: boolean;
      /** WHICH BRANCH DECIDED, and 'app' wins a tie. A user who holds both a
       *  per-app subscription and the bundle is served the UNION — never
       *  under-served — and the account page has to be able to say which one it
       *  is looking at. 'none' when neither grants: an absent key would be a
       *  third state every client would have to guess at. */
      readonly granted_via: GrantedVia;
      readonly entitlements: WireEntitlement[];
      /** Present ONLY when a live grant exists; `null` otherwise, and the
       *  carrier renders null as an ABSENT key. */
      readonly bundle: WireBundleBlock | null;
    };

export interface ProductEntitlementInput {
  readonly userId: string;
  /** The product asked about. Already the deploy's own id on a per-app Worker;
   *  a request parameter on the shared host — validated HERE either way. */
  readonly productId: string;
  /** `MONEY_ENVIRONMENT` as the carrier's env carries it: possibly undefined. */
  readonly environment: unknown;
  /** Correlation id for the log lines. Never the user id. */
  readonly rid: string;
}

export async function readProductEntitlement(
  deps: EntitlementReadDeps,
  input: ProductEntitlementInput,
): Promise<ProductEntitlementRead> {
  const { userId, productId, rid } = input;

  // THE PRODUCT MUST BE ONE THIS DEPLOY KNOWS. [5]M-4. On the shared host the
  // known set is the union of every product register — extensions included,
  // which is what #612 fixed; on a per-app Worker it is `{ APP_ID }`.
  if (!deps.isKnownProduct(productId)) return { kind: 'unknown_product' };

  // This deploy's money world. Undeclared is a refusal for the same reason the
  // webhook refuses: there is no safe default, and a read that guessed 'live'
  // would honour sandbox rows in production. [5]M-12
  const environment = input.environment;
  if (typeof environment !== 'string' || !deps.isMoneyEnvironment(environment)) {
    deps.error(
      `[entitlements] rid=${rid} MONEY_ENVIRONMENT is ${JSON.stringify(environment)} — refusing to decide ` +
        'access without knowing which money world this deploy is. [5]M-12',
    );
    return { kind: 'money_rail_not_configured' };
  }

  // 🔴 BOTH PREDICATES, ALWAYS. `user_id` alone would return every app's rows
  // for this user; `app_id` alone would return every user's rows for this app.
  // The shared table's entire safety rests on this one statement.
  const rows = await deps.allRows<EntitlementRow>(
    deps.db
      .prepare(
        `SELECT entitlement, product_id, store, is_active, expires_at,
                provider, provider_environment, provider_status,
                current_period_end, trial_end, revocation_reason
           FROM entitlements
          WHERE user_id = ? AND app_id = ?`,
      )
      .bind(userId, productId),
  );

  const nowMs = (deps.nowMs ?? Date.now)();
  const warn = (m: string) => deps.warn(`[entitlements] rid=${rid} app=${productId} ${m}`);

  /** Whether ONE per-app row grants access: a PROJECTION plus the SHARED decision. */
  const appPro = rows.some((r) =>
    grantsAccess(
      {
        label: `entitlement=${r.entitlement}`,
        is_active: r.is_active,
        provider_environment: r.provider_environment,
        expires_at: r.expires_at,
      },
      environment,
      nowMs,
      warn,
    ),
  );

  // ── THE BUNDLE BRANCH ──────────────────────────────────────────────────────
  // The membership join is on the SERVED (name, version): a one-time grant's
  // pinned version (G10), a subscription grant's latest sellable one
  // (`bundleGrantsServed`). The SAME
  // `grantsAccess` decides it, so the environment rule, the lifetime rule and
  // the unparseable-date rule are not re-implemented here and cannot drift.
  // `version` on the wire stays the minted version; `products` is what the
  // grant is served.
  const bundleRows = await bundleGrantsForProduct(deps, userId, productId);
  const liveBundle = bundleRows.find((g) => grantsAccess(bundleRowToGrantable(g), environment, nowMs, warn));
  const bundlePro = liveBundle !== undefined;

  const bundle: WireBundleBlock | null =
    liveBundle === undefined
      ? null
      : {
          feature_set: liveBundle.feature_set_name,
          version: liveBundle.feature_set_version,
          products: await servedMembers(deps, liveBundle),
          expires_at: liveBundle.expires_at,
          source: liveBundle.source,
        };

  return {
    kind: 'ok',
    app_id: productId,
    is_pro: appPro || bundlePro,
    granted_via: appPro ? 'app' : bundlePro ? 'bundle' : 'none',
    entitlements: rows.map((r) => ({
      entitlement: r.entitlement,
      product_id: r.product_id,
      store: r.store,
      is_active: r.is_active === 1,
      expires_at: r.expires_at,
      provider: r.provider,
      provider_status: r.provider_status,
      current_period_end: r.current_period_end,
      trial_end: r.trial_end,
      revocation_reason: r.revocation_reason,
    })),
    bundle,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// THE SUBJECT READ — `GET /v1/entitlements/subject`: "what do I own", which the
// per-product read cannot answer. Same refusal, same five rules through the
// same `grantsAccess`. Mounted by the shared host only today; it lives here so
// that a second carrier mounting it cannot grow a second copy.
// ─────────────────────────────────────────────────────────────────────────────

interface SubjectAppRow {
  app_id: string;
  entitlement: string;
  is_active: number;
  expires_at: string | null;
  provider_environment: string | null;
}

export interface WireOwnedProduct {
  product: string;
  granted_via: GrantedVia;
  expires_at: string | null;
}

export type SubjectEntitlementRead =
  | { readonly kind: 'money_rail_not_configured' }
  | {
      readonly kind: 'ok';
      /** Sorted by slug, so two reads of one subject render the same bytes. */
      readonly products: WireOwnedProduct[];
      readonly bundles: WireBundleBlock[];
    };

export interface SubjectEntitlementInput {
  readonly userId: string;
  readonly environment: unknown;
  readonly rid: string;
}

export async function readSubjectEntitlements(
  deps: EntitlementReadDeps,
  input: SubjectEntitlementInput,
): Promise<SubjectEntitlementRead> {
  const { userId, rid } = input;
  const environment = input.environment;
  if (typeof environment !== 'string' || !deps.isMoneyEnvironment(environment)) {
    deps.error(
      `[entitlements/subject] rid=${rid} MONEY_ENVIRONMENT is ${JSON.stringify(environment)} — refusing ` +
        'to decide access without knowing which money world this deploy is. [5]M-12',
    );
    return { kind: 'money_rail_not_configured' };
  }

  const nowMs = (deps.nowMs ?? Date.now)();
  const warn = (m: string) => deps.warn(`[entitlements/subject] rid=${rid} ${m}`);

  const appRows = await deps.allRows<SubjectAppRow>(
    deps.db
      .prepare(
        `SELECT app_id, entitlement, is_active, expires_at, provider_environment
           FROM entitlements
          WHERE user_id = ?`,
      )
      .bind(userId),
  );

  // A Map, so a product granted BOTH per-app and by a bundle appears once. The
  // tie-break matches the per-product read: 'app' wins, because a per-app
  // subscription is the more specific fact and it is the one whose cancellation
  // the user will go looking for.
  const owned = new Map<string, { granted_via: GrantedVia; expires_at: string | null }>();

  for (const r of appRows) {
    const ok = grantsAccess(
      {
        label: `app=${r.app_id} entitlement=${r.entitlement}`,
        is_active: r.is_active,
        provider_environment: r.provider_environment,
        expires_at: r.expires_at,
      },
      environment,
      nowMs,
      warn,
    );
    if (ok) owned.set(r.app_id, { granted_via: 'app', expires_at: r.expires_at });
  }

  const grantRows = await bundleGrantsForUser(deps, userId);
  const bundles: WireBundleBlock[] = [];
  for (const g of grantRows) {
    if (!grantsAccess(bundleRowToGrantable(g), environment, nowMs, warn)) continue;
    const products = await servedMembers(deps, g);
    bundles.push({
      feature_set: g.feature_set_name,
      version: g.feature_set_version,
      products,
      expires_at: g.expires_at,
      source: g.source,
    });
    for (const slug of products) {
      if (!owned.has(slug)) owned.set(slug, { granted_via: 'bundle', expires_at: g.expires_at });
    }
  }

  return {
    kind: 'ok',
    products: [...owned.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([slug, v]) => ({ product: slug, granted_via: v.granted_via, expires_at: v.expires_at })),
    bundles,
  };
}
