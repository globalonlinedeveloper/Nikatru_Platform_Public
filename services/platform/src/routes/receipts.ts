// ─────────────────────────────────────────────────────────────────────────────
// POST /v1/receipts/:store — THE ROUTE THAT REMOVES THE IRREVERSIBLE CLIENT
// UNLOCK ON iOS AND ANDROID.
//
// 🔴 THE RULE, AND EVERY LINE BELOW SERVES IT:
//
//   A STORE PURCHASE NEVER GRANTS ON THE STRENGTH OF THE CLIENT'S WORD, AND
//   NEVER ON THE STRENGTH OF THE PUSH ALONE.
//
// The client posts an OPAQUE token. The server calls the store's own API. Only a
// verified server-side answer writes a grant. Google's RTDN is a
// cache-invalidation ping with no proof in its body, so
// `purchases.subscriptionsv2.get` is mandatory; Microsoft has no push at all and
// is poll-only. `research/2026-09-09/bundle-entitlement-design-2026-09-09.md` §8
// files "the full purchase→webhook→unlock loop" as the one thing that could never
// be proven safe, *because on iOS and Android the unlock leg cannot be reversed*
// — and names this route as what makes the loop testable without the
// irreversible half.
//
// ── THE ORDER OF OPERATIONS IS THE DESIGN ───────────────────────────────────
//   1 · KNOWN RAIL, or 404. An unknown segment is not a rail we took
//       responsibility for.
//   2 · CEILING. The route is reachable by any authenticated user and every
//       request costs an outbound call to a vendor with its own quota.
//   3 · MONEY WORLD, or 503. Same refusal as the webhook: a default of 'live'
//       would honour sandbox purchases as real, a default of 'sandbox' would stop
//       honouring real ones. There is no safe guess. [5]M-12
//   4 · BOUNDED BODY, and 🔴 A BODY THAT TRIES TO DECIDE THE GRANT IS REFUSED
//       OUTRIGHT. `feature_set`, `expires_at`, `source`, `products`, `user_id`
//       from a client are not "ignored extra keys" — a request carrying them is a
//       request attempting the exact defect this route exists to close, and
//       silently dropping them would leave the attempt invisible.
//   5 · THE DOUBLE-BILLING PRE-CHECK (§3.4), BEFORE any store call, so a person
//       who already holds the set on another rail is told so — naming the rail —
//       instead of being sold it twice.
//   6 · VERIFY SERVER-SIDE. Unconfigured rail ⇒ 503. Store says no ⇒ 403 and
//       NOTHING IS WRITTEN. There is no third branch.
//   7 · RESOLVE THE FEATURE SET FROM THE STORE'S PRODUCT ID, server-side.
//   8 · PIN the version, then WRITE — through the one writer, once.
//   9 · RECONCILE THE RACE the pre-check cannot see (§3.4): two devices, one
//       offline, both pre-checks saw nothing, both bought. The server does NOT
//       try to cancel the loser — it cannot, on any store rail. It records BOTH,
//       serves the UNION, sets `superseded_by` on the older and raises a
//       `duplicate_grant` operator alert. Refunding is a human act on the rail
//       that took the money.
//
// ⚠️ IT IS BEHIND `platformAuth` BECAUSE THE SUBJECT IS THE WHOLE POINT. A grant
// is written for `c.get('userId')` — the Supabase `sub` from the verified JWT —
// and for no id that appeared in a request body. That is the same reason
// /v1/checkout is authenticated ([ADR 044] §6).
// ─────────────────────────────────────────────────────────────────────────────
import type { SqlDb } from '../../../_shared/src/ports/sql';
import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { readBoundedBody } from '../lib/body';
import { withinEdgeCeiling } from '../lib/edge-ceiling';
import { isMoneyEnvironment, type MoneyEnvironment } from '../lib/mor/contract';
import {
  type BundleGrantRow,
  type BundleStoreDeps,
  grantIsCurrent,
  liveGrantsFor,
  markSuperseded,
  mintGrantId,
  upsertBundleGrant,
} from '../lib/mor/bundle-store';
import { receiptVerifierFor } from '../lib/receipts/verifiers';
import { type ProductMap, featureSetForProduct } from '../lib/receipts/products';
import { nowIso, run } from '../lib/d1';
import { BUNDLE_ROWS, BUNDLES_REGISTER, type BundleRegisterRow, bundleVersionStatus } from '../lib/catalog';
import { BUNDLE_KIND } from '../../../../contracts/entitlement/bundle.js';
import { isValidAppId, productKindOf } from '../config';

const receipts = new Hono<AppEnv>();

/**
 * A token and, at most, a list of slugs the caller says it is about to buy. That
 * is a handful of short strings; 8 KiB is generous and far below anything that
 * could pressure the isolate.
 */
/** @ceiling workers.maxRequestBodySize lte */
export const MAX_RECEIPT_BODY_BYTES = 8 * 1024;

/**
 * 🔴 KEYS A CLIENT MAY NOT SEND. Every one of them is a field that DECIDES
 * ACCESS, and the whole point of the route is that those come from the store and
 * from the verified JWT. Refusing loudly rather than ignoring them means an
 * attempt shows up as a 400 in the logs instead of as a successful purchase.
 */
const FORBIDDEN_BODY_KEYS = [
  'feature_set',
  'feature_set_name',
  'feature_set_version',
  'source',
  'expires_at',
  'current_period_end',
  'products',
  'user_id',
  'grant_id',
  'provider_environment',
  'credit_days_applied',
];

interface ReceiptBody {
  token?: unknown;
  /**
   * OPTIONAL, and safe as a client input precisely because it can only ever make
   * the answer MORE restrictive: it is read by the pre-check to decide whether to
   * refuse, and it is never read by the writer. Naming what you want is not the
   * same as deciding what you get.
   */
  want?: unknown;
  [k: string]: unknown;
}

/** The members of one pinned feature-set version, from the PINNED tables. */
async function membersOf(
  db: SqlDb,
  name: string,
  version: number,
): Promise<string[]> {
  const res = await db
    .prepare('SELECT product_slug FROM feature_set_members WHERE name = ? AND version = ?')
    .bind(name, version)
    .all<{ product_slug: string }>();
  return (res.results ?? []).map((r) => r.product_slug);
}

/**
 * Pin a feature-set version the moment a grant is written against it.
 *
 * [ADR 057] §4 — a grant records `(name, version)` and the version's member list
 * must be resolvable FOREVER from the tables, not from whatever
 * catalog/bundles.json says on the day somebody reads it. The register is read
 * ONCE, here, at insert; after that the pinned rows are the record and editing
 * the register cannot reach an existing grant. `ON CONFLICT DO NOTHING` makes a
 * re-post idempotent and — more importantly — makes it impossible for a later
 * register edit to rewrite an already-minted version's membership.
 */
async function pinFeatureSet(
  db: SqlDb,
  name: string,
  version: number,
  products: readonly string[],
  register: readonly BundleRegisterRow[] | undefined,
): Promise<void> {
  // 🔴 ONLY A `sellable` VERSION IS MINTED — O-BUNDLE-MEMBER-INSERT-UNLOCKED
  // limb (2). Until 2026-09-26 the INSERT below bound the LITERAL 'sellable', so
  // a receipt for a version the register still called `draft` minted it as
  // sellable and froze a membership nobody had offered. The status is READ from
  // the register (src/lib/catalog.ts, the Worker's catalogue reader) and bound;
  // anything but `sellable` — `draft`, `retired`, or no row at all — is an ERROR
  // before the first INSERT, and the route's onError answers 500 with nothing
  // written, the same fail-closed path an unknown member takes below.
  const status = bundleVersionStatus(name, version, register);
  if (status !== 'sellable') {
    throw new Error(
      `feature set ${name}@${version} is ${status === null ? 'not in the bundle register' : `\`${status}\` in the bundle register`}; ` +
        'only a `sellable` version may be minted',
    );
  }
  // 🔴 EVERY KIND IS RESOLVED FROM THE REGISTER BEFORE ANYTHING IS WRITTEN.
  // `product_kind` is recorded as a fact at sale (migration 0009), and until
  // 2026-09-10 this bound the literal 'app' for every member — so the pinned
  // record would have called the extension an app. The kind comes from the
  // product registers (config.ts `productKindOf`), and a member no register
  // knows — or whose slug fails the shape rule 0009 states for
  // `feature_set_members.product_slug` — is an ERROR before the first INSERT,
  // not a row with a guessed kind and not a half-pinned version. The route's
  // onError turns it into a 500 with nothing written.
  const kinds = new Map<string, string>();
  for (const slug of products) {
    if (!isValidAppId(slug)) {
      throw new Error(`feature set ${name}@${version} names member ${JSON.stringify(slug)}, which is not a product-slug shape`);
    }
    const kind = productKindOf(slug);
    if (kind === null) {
      throw new Error(`feature set ${name}@${version} names member ${JSON.stringify(slug)}, which no product register carries`);
    }
    // A bundle is a product since 2026-09-26, and a bundle is never a member of one.
    if (kind === BUNDLE_KIND) {
      throw new Error(`feature set ${name}@${version} names member ${JSON.stringify(slug)}, which is itself a bundle`);
    }
    kinds.set(slug, kind);
  }
  const now = nowIso();
  await run(
    db.prepare(
      `INSERT INTO feature_sets (name, version, minted_at, minted_from, status)
       VALUES (?,?,?,?,?) ON CONFLICT (name, version) DO NOTHING`,
    ).bind(name, version, now, BUNDLES_REGISTER, status),
  );
  for (const [slug, kind] of kinds) {
    await run(
      db.prepare(
        `INSERT INTO feature_set_members (name, version, product_slug, product_kind)
         VALUES (?,?,?,?) ON CONFLICT (name, version, product_slug) DO NOTHING`,
      ).bind(name, version, slug, kind),
    );
  }
}

/**
 * ⏱ 2026-09-27 · Mint a feature-set version from the bundle register — the
 * members its row names — through `pinFeatureSet` above, so a bundle grant from
 * a RevenueCat event (src/lib/mor/grant.ts) is pinned by the same code, with the
 * same `sellable` refusal, as one from a receipt. It throws when the register
 * has no such row; the caller answers 503 with nothing written.
 */
export async function mintFeatureSetFromRegister(
  db: SqlDb,
  featureSet: string,
  version: number,
  register: readonly BundleRegisterRow[] = BUNDLE_ROWS,
): Promise<void> {
  const row = register.find((r) => r.featureSet === featureSet && r.version === version);
  if (row === undefined) {
    throw new Error(`feature set ${featureSet}@${version} is not in the bundle register; nothing is minted`);
  }
  const members = (Array.isArray(row.members) ? row.members : [])
    .map((m) => (m !== null && typeof m === 'object' ? (m as { slug?: unknown }).slug : null))
    .filter((s): s is string => typeof s === 'string' && s !== '');
  await pinFeatureSet(db, featureSet, version, members, register);
}

/**
 * §3.5's ENTITLEMENT-SIDE proration rule, and ONLY the entitlement side.
 *
 * `credit_days = ceil(days between now and the single-app grant's
 * current_period_end)`, added to the bundle's `expires_at`. The MONEY side is the
 * rail's — Paddle, Razorpay, Apple and Google each compute their own credit and
 * Microsoft computes none — and is recorded from the notification rather than
 * computed here. The two are independent and both are kept, so a support
 * conversation can reconstruct either.
 *
 * Returns 0 when there is nothing to credit: no period end, an unreadable one, or
 * one already in the past. NEVER negative — a lapsed single-app subscription owes
 * the customer no days, and subtracting would shorten a term they paid for.
 */
export function creditDays(currentPeriodEnd: string | null, nowMs: number): number {
  if (currentPeriodEnd === null) return 0;
  const end = Date.parse(currentPeriodEnd);
  if (Number.isNaN(end) || end <= nowMs) return 0;
  return Math.ceil((end - nowMs) / 86_400_000);
}

/** Add whole days to an ISO instant. NULL (a lifetime grant) stays NULL. */
export function extendExpiry(expiresAt: string | null, days: number): string | null {
  if (expiresAt === null || days <= 0) return expiresAt;
  const t = Date.parse(expiresAt);
  if (Number.isNaN(t)) return expiresAt;
  return new Date(t + days * 86_400_000).toISOString();
}

/**
 * Which live per-app subscription this bundle is replacing, if any.
 *
 * Deliberately narrow: an `entitlements` row for one of the bundle's OWN member
 * products, in this money world, still active. A row for some other app is not
 * being superseded by this purchase and crediting its remainder would be a gift
 * funded by us for a term the customer keeps.
 */
async function supersededPerAppPeriodEnd(
  db: SqlDb,
  userId: string,
  environment: MoneyEnvironment,
  products: readonly string[],
): Promise<string | null> {
  if (products.length === 0) return null;
  // 🔴 NO `IN (…)` AND THEREFORE NO INTERPOLATION. D1 cannot bind an identifier
  // OR a variable-length list, so an `IN` over a computed set means building the
  // statement text by hand on every request — which is the shape
  // tooling/ci/assert-d1-sql-inventory.mjs [R3] refuses, and it refuses it for a
  // good reason: a hand-built statement is one nobody audits. The membership test
  // moves into TypeScript instead, where the set is a typed array. The scan it
  // costs is bounded by ONE user's entitlement rows, which is a handful.
  const rows = await db
    .prepare(
      `SELECT app_id, current_period_end FROM entitlements
        WHERE user_id = ? AND provider_environment = ? AND is_active = 1
          AND revoked_at IS NULL AND current_period_end IS NOT NULL`,
    )
    .bind(userId, environment)
    .all<{ app_id: string; current_period_end: string }>();
  const ends = (rows.results ?? [])
    .filter((r) => products.includes(r.app_id))
    .map((r) => r.current_period_end)
    .sort();
  return ends.length === 0 ? null : ends[ends.length - 1];
}

receipts.post('/receipts/:store', async (c) => {
  const rid = c.get('requestId') ?? '-';
  const userId = c.get('userId');
  const storeId = c.req.param('store');

  // 1 · A KNOWN RAIL. 404, not 400: there is no such store on this host, and a
  // 2xx would tell the caller we took responsibility for a receipt we discarded.
  const verifier = receiptVerifierFor(storeId);
  if (verifier === null) return c.json({ error: 'unknown_store' }, 404);

  // 2 · The server-derived ceiling. Every request past here costs an outbound
  // call against a vendor quota we do not control.
  if (!(await withinEdgeCeiling(c.env.MONEY_CEILING_LIMITER, c, 'MONEY_CEILING_LIMITER'))) {
    return c.json({ error: 'rate_limited' }, 429);
  }

  // 3 · The money world, or refuse. [5]M-12
  const environment = c.env.MONEY_ENVIRONMENT;
  if (!isMoneyEnvironment(environment)) {
    console.error(
      `[receipts/${storeId}] rid=${rid} MONEY_ENVIRONMENT is ${JSON.stringify(environment)} — refusing to ` +
        'verify a purchase without knowing which money world this deploy is. [5]M-12',
    );
    return c.json({ error: 'money_rail_not_configured' }, 503);
  }
  const deps: BundleStoreDeps = { db: c.env.PLATFORM_DB, environment };

  // 4 · The body, bounded, then read for exactly two fields.
  const read = await readBoundedBody(c.req.raw, MAX_RECEIPT_BODY_BYTES);
  if (!read.ok) return c.json({ error: read.error }, read.status);
  let body: ReceiptBody;
  try {
    body = JSON.parse(read.text) as ReceiptBody;
  } catch {
    return c.json({ error: 'unparseable_body' }, 400);
  }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return c.json({ error: 'unparseable_body' }, 400);
  }
  const offered = FORBIDDEN_BODY_KEYS.filter((k) => Object.prototype.hasOwnProperty.call(body, k));
  if (offered.length > 0) {
    console.warn(
      `[receipts/${storeId}] rid=${rid} refused a body carrying grant-deciding key(s): ${offered.join(', ')}`,
    );
    return c.json(
      {
        error: 'client_supplied_grant',
        detail:
          'A receipt request may carry a token and nothing that decides access. What is granted comes from ' +
          "the store's own answer and from the verified session, never from this body.",
        keys: offered,
      },
      400,
    );
  }
  const token = typeof body.token === 'string' ? body.token.trim() : '';
  if (token === '') return c.json({ error: 'missing_token' }, 400);
  const want = Array.isArray(body.want)
    ? body.want.filter((s): s is string => typeof s === 'string' && s !== '')
    : [];

  const nowMs = Date.now();

  // ── 5 · THE DOUBLE-BILLING PRE-CHECK (§3.4) ────────────────────────────────
  // BEFORE the store call, so nobody spends money to be told they already own it.
  // It fires only when the holder is a DIFFERENT rail: the same rail re-posting
  // its own token is a renewal or a retry, and that is an upsert, not a second
  // purchase.
  //
  // ⚠️ AND IT CANNOT SEE THE RACE, WHICH IS WHY STEP 9 EXISTS. Two devices, one
  // offline: both pre-checks ran when neither grant existed. That is not a hole
  // in this check, it is the definition of the race, and the design's answer is
  // to record both rather than to under-serve somebody who has paid twice.
  const before = await liveGrantsFor(deps, userId);
  if (want.length > 0) {
    for (const g of before) {
      if (g.provider === storeId) continue;
      if (!grantIsCurrent(g, nowMs)) continue;
      const covered = await membersOf(c.env.PLATFORM_DB, g.feature_set_name, g.feature_set_version);
      if (want.every((slug) => covered.includes(slug))) {
        return c.json(
          {
            error: 'already_entitled',
            // 🔴 NAME THE HOLDING RAIL. Without it the client can only say "you
            // already have this", and the user's next question — "where do I
            // cancel it?" — has no answer. Cross-rail cancellation is impossible
            // by construction, so "manage it where you bought it" is the only
            // honest UI and this field is what makes it renderable.
            holding_rail: g.provider,
            holding_source: g.source,
            feature_set: { name: g.feature_set_name, version: g.feature_set_version },
            expires_at: g.expires_at,
            detail:
              `This account already holds ${want.join(', ')} through ${g.provider}. Buying it again on ` +
              `${storeId} would bill twice, and no store rail lets this server cancel the other one.`,
          },
          409,
        );
      }
    }
  }

  // ── 6 · VERIFY, SERVER-SIDE. THE ONLY STATEMENT WITH EVIDENTIAL WEIGHT ─────
  const env = c.env as unknown as Record<string, string | undefined>;
  const credentials: Record<string, string> = {};
  for (const name of verifier.credentialEnvVars) credentials[name] = env[name] ?? '';
  const outcome = await verifier.verify(
    { token, nowMs },
    { credentials, fetchImpl: receiptFetch(c.env) },
  );
  if (!outcome.ok) {
    console.warn(`[receipts/${storeId}] rid=${rid} ${outcome.code}: ${outcome.detail}`);
    // NOTHING IS WRITTEN ON THIS PATH, and there is no branch that writes less.
    return c.json({ error: outcome.code, detail: outcome.detail }, outcome.status);
  }
  const receipt = outcome.receipt;

  // ── 7 · WHAT THE STORE SAYS WAS BOUGHT → WHICH FEATURE SET ────────────────
  const fs = featureSetForProduct(storeId, receipt.productId, productMapFor(c.env));
  if (fs === null) {
    // A genuine, verified purchase of something this server does not sell as a
    // bundle. 422 and no row: writing a grant for a feature set nobody declared
    // would be inventing the offer at redemption time.
    console.error(
      `[receipts/${storeId}] rid=${rid} verified product ${JSON.stringify(receipt.productId)} maps to no ` +
        'declared feature set. No grant written.',
    );
    return c.json({ error: 'unmapped_product', product_id: receipt.productId }, 422);
  }

  // ── 8 · PIN, CREDIT, WRITE ────────────────────────────────────────────────
  await pinFeatureSet(c.env.PLATFORM_DB, fs.name, fs.version, fs.products, bundleRegisterFor(c.env));

  const perAppEnd = await supersededPerAppPeriodEnd(
    c.env.PLATFORM_DB,
    userId,
    environment,
    fs.products,
  );
  const credit = creditDays(perAppEnd, nowMs);

  const write = await upsertBundleGrant(deps, {
    userId,
    source: verifier.source,
    featureSetName: fs.name,
    featureSetVersion: fs.version,
    provider: storeId,
    providerSubscriptionId: receipt.subscriptionId,
    providerTransactionId: receipt.transactionId,
    providerStatus: receipt.status,
    lastEventId: receipt.transactionId,
    occurredAt: receipt.occurredAt,
    currentPeriodEnd: receipt.currentPeriodEnd,
    trialEnd: receipt.trialEnd,
    expiresAt: extendExpiry(receipt.expiresAt, credit),
    graceUntil: null,
    revokedAt: null,
    revocationReason: null,
    creditDaysApplied: credit > 0 ? credit : null,
  });
  const grantId = write.grantId;

  // ── 9 · THE RACE, RECONCILED (§3.4) ───────────────────────────────────────
  // Re-read rather than reason from `before`: the other rail's grant may have
  // landed while this request was out at the store, which is exactly the window
  // the race lives in.
  const after = await liveGrantsFor(deps, userId);
  const rivals = after.filter(
    (g) =>
      g.grant_id !== grantId &&
      grantIsCurrent(g, nowMs) &&
      g.feature_set_name === fs.name &&
      g.feature_set_version === fs.version,
  );
  let duplicate: { superseded: string; rails: string[] } | null = null;
  if (rivals.length > 0) {
    const mine = after.find((g) => g.grant_id === grantId) ?? null;
    const all = mine === null ? rivals : [...rivals, mine];
    const older = oldest(all);
    const newer = all.find((g) => g.grant_id !== older.grant_id) ?? older;
    if (older.grant_id !== newer.grant_id) {
      await markSuperseded(deps, older.grant_id, newer.grant_id);
    }
    // 🔴 THE OPERATOR ALERT. The server does NOT cancel the loser — it cannot, on
    // any store rail — so the only correct action is to make a human aware that
    // one person is paying twice. A silent supersede would hide a double charge
    // behind a perfectly working entitlement.
    console.error(
      `[operator-alert] duplicate_grant rid=${rid} feature_set=${fs.name}@${fs.version} ` +
        `rails=${[...new Set(all.map((g) => g.provider ?? '-'))].join('+')} superseded=${older.grant_id} ` +
        '— one subject holds the same bundle on two rails. The union is being served so nobody is ' +
        'under-served; refunding the duplicate is a human act on the rail that took it.',
    );
    duplicate = {
      superseded: older.grant_id,
      rails: [...new Set(all.map((g) => g.provider ?? '-'))].sort(),
    };
  }

  return c.json({
    ok: true,
    store: storeId,
    // `stale` is a correct outcome, not an error: a delayed retry of an older
    // event was refused by the ordering clause and the stored grant kept what it
    // already said. [5]M-2
    written: write.outcome,
    granted_via: 'bundle',
    grant: {
      grant_id: grantId,
      source: verifier.source,
      feature_set: { name: fs.name, version: fs.version },
      products: fs.products,
      provider_status: receipt.status,
      expires_at: extendExpiry(receipt.expiresAt, credit),
      credit_days_applied: credit > 0 ? credit : null,
    },
    // Present only when it happened, so a client cannot learn to expect the key.
    ...(duplicate === null ? {} : { duplicate_grant: duplicate }),
  });
});

/**
 * Oldest by when THIS SERVER first recorded the grant.
 *
 * Not by `occurred_at`: that column is each rail's own ordering clock and the
 * rails do not agree on what it measures — Play's is the paid-through instant,
 * Microsoft's the item's last modification, Paddle's the event time — so
 * comparing two rails' values decides nothing. `created_at` is one clock, ours,
 * and "which purchase did we see first" is the question the race asks.
 */
function oldest(rows: readonly BundleGrantRow[]): BundleGrantRow {
  return [...rows].sort((a, b) => a.created_at.localeCompare(b.created_at))[0];
}

// ─────────────────────────────────────────────────────────────────────────────
// The seams, each resolved from `env` so the route body never names a global.
//
// `RECEIPT_FETCH` / `RECEIPT_PRODUCT_MAP` are absent in every deploy and are
// absent from the Env type on purpose: they exist so the suite can run the REAL
// verifier code against a canned store answer with no network and no secret, and
// so the grant path can be exercised while the product register is legitimately
// empty. Nothing on the request path can set either — they are bindings, and a
// binding comes from wrangler configuration, not from a caller.
// ─────────────────────────────────────────────────────────────────────────────
function receiptFetch(env: AppEnv['Bindings']): typeof fetch {
  const injected = (env as unknown as { RECEIPT_FETCH?: typeof fetch }).RECEIPT_FETCH;
  return injected ?? fetch;
}

function productMapFor(env: AppEnv['Bindings']): ProductMap | undefined {
  return (env as unknown as { RECEIPT_PRODUCT_MAP?: ProductMap }).RECEIPT_PRODUCT_MAP;
}

/**
 * The third seam, `RECEIPT_BUNDLE_REGISTER`: the bundle register rows the mint
 * reads a version's status from. Absent in every deploy, like the two above —
 * `undefined` makes `bundleVersionStatus` read the committed register — and it
 * exists because the committed register's only version is `draft`, so the
 * grant path could otherwise be exercised only by marking an unsold version
 * sellable in a committed file.
 */
function bundleRegisterFor(env: AppEnv['Bindings']): readonly BundleRegisterRow[] | undefined {
  return (env as unknown as { RECEIPT_BUNDLE_REGISTER?: readonly BundleRegisterRow[] }).RECEIPT_BUNDLE_REGISTER;
}

export default receipts;
export { mintGrantId };
