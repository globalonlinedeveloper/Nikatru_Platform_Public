import type { AuthRecency } from '../../_shared/src/auth';
/** ⏱ 2026-10-01 · O-CLOUDFLARE-BINDINGS-SCATTERED (port-storage): the KV
 *  bindings are declared as the KV PORT; the binding satisfies it structurally
 *  (services/_shared/src/ports/adapters/cloudflare.ts). */
import type { KvStore } from '../../_shared/src/ports/kv';
/** ⏱ 2026-10-02 · O-CLOUDFLARE-BINDINGS-SCATTERED (port-sql): the D1 bindings
 *  are declared as the SQL PORT; the binding satisfies it structurally
 *  (services/_shared/src/ports/adapters/cloudflare.ts `cloudflareD1`), and
 *  assert-ports limb 9 refuses a `D1Database` type in any handler. */
import type { SqlDb } from '../../_shared/src/ports/sql';
// ─────────────────────────────────────────────────────────────────────────────
// Shared types for the Worker. Keep the Env interface in sync with wrangler.jsonc.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Worker bindings + environment. Names must match wrangler.jsonc bindings.
 * Secrets are optional here because they arrive via `wrangler secret put` /
 * .dev.vars and may be absent in template mode.
 */
export interface Env {
  // D1 databases
  APP_DB: SqlDb; // per-app data (subscriptions, budgets, ...)
  PLATFORM_DB: SqlDb; // shared entitlements across the portfolio

  // KV — caches the Supabase JWKS document
  JWKS_CACHE: KvStore;

  // ⏱ 2026-09-25 · AUTH-REVOKE-AT-WORKERS. KV — the shared revocation list
  // (`rev:<sub>`), READ ONLY here, by middleware/auth.ts; services/platform
  // writes it. Optional: absence fails OPEN, and
  // tooling/ci/assert-session-revocation.mjs reds a config that does not bind it.
  SESSION_REVOKED?: KvStore;

  // 🔴 `EXPORTS: R2Bucket` WAS HERE and was removed on 2026-08-01 with the
  // binding it typed ([4]B-18). It is worth naming why the TYPE had to go too:
  // assert-vendor-portability.mjs derives its surface set from the UNION of this
  // interface and the wrangler configs, so leaving the field would have kept the
  // R2 surface reporting as alive after the binding was deleted — a declaration
  // standing in for a use, which is the same mistake in the other direction.

  // Non-secret vars (wrangler.jsonc vars)
  APP_ID: string;
  SUPABASE_URL: string;
  API_VERSION: string;
  /** Comma-separated browser origins for CORS. Absent/empty ⇒ '*' (template). */
  ALLOWED_ORIGINS?: string;
  /**
   * [5]M-12 — which money world this deploy is: 'live' or 'sandbox'. Read by
   * /v1/entitlements (a row from the other world grants nothing).
   * Absent/unrecognised ⇒ it answers 503 rather than guess — see
   * src/lib/money.ts for why neither default is safe. (Until 2026-09-16 the
   * legacy RevenueCat webhook on this Worker read it too; that route is retired.)
   */
  MONEY_ENVIRONMENT?: string;
  /**
   * [pipeline 11]E-8 — the crash sink for UNHANDLED WORKER ERRORS. A `var`, not
   * a secret: a GlitchTip DSN is a write-only ingest key this factory already
   * ships inside every web build. Absent ⇒ no report, silently; lib/
   * error-sink.ts fails open by design.
   */
  GLITCHTIP_DSN?: string;
  /**
   * The commit this Worker was deployed from — `--var RELEASE:<sha>`. NOT
   * `API_VERSION`, which is the literal "v1" and would group every error the
   * factory ever reports into one bucket. [9]R-2 replaces it with a real
   * release id.
   */
  RELEASE?: string;

  // Secrets (wrangler secret put / .dev.vars) — optional in template mode
  SUPABASE_JWT_SECRET?: string;
  // ⏱ 2026-09-16 — REVENUECAT_WEBHOOK_SECRET removed with the retired legacy
  // RevenueCat route. The platform door reads REVENUECAT_WEBHOOK_SIGNING_SECRET.
}

/**
 * HOW a request's bearer token was verified.
 *
 * 🔴 NOT COSMETIC, AND NOT A LOG FIELD. `supabaseAuth` accepts two materially
 * different proofs: an ES256 SIGNATURE checked against Supabase's public JWKS,
 * and — when the asymmetric path fails and `SUPABASE_JWT_SECRET` is set — an
 * HS256 MAC computed with a secret this Worker also holds. The second is
 * symmetric: anyone who learns that one environment variable can mint a token for
 * any user of this app. That is an acceptable risk for reading your own
 * subscriptions and an unacceptable one for erasing an account, so the difference
 * has to survive the middleware rather than being collapsed into "authenticated".
 * `src/routes/account.ts` refuses anything that is not `'asymmetric'`.
 */
import type { TokenAssurance } from '../../_shared/src/auth-middleware';
export type { TokenAssurance }; // declared once, beside the boundary that sets it

/**
 * Hono context Variables set by middleware (c.get / c.set).
 */
export interface Variables {
  userId: string;
  userEmail?: string;
  /** Correlation id stamped by the request-id middleware (echoed in headers). */
  requestId: string;
  /**
   * Set by whichever auth middleware admitted this request. OPTIONAL, and the
   * optionality is load-bearing: a route reached with no auth middleware at all
   * reads `undefined`, and the erasure route treats `undefined` as a refusal.
   * Typing it as required would make "nobody set this" unrepresentable and turn
   * the fail-closed branch into dead code.
   */
  tokenAssurance?: TokenAssurance;
  /**
   * ⏱ 2026-09-16 · O-APP-API-DELETE-NO-RECENCY. How the verified token's user
   * signs in and when they last AUTHENTICATED, set by both auth middlewares from
   * the payload they verified. The erasure route refuses when it is absent
   * (services/_shared/src/auth.ts).
   */
  authRecency?: AuthRecency;
}

/** Convenience: the generics shape used across the app and sub-routers. */
export type AppEnv = { Bindings: Env; Variables: Variables };

/**
 * A subscription row. Mirrors the `subscriptions` table 1:1.
 * NOTE: `unused` is stored as 0/1 in D1 but serialized to a JSON boolean at the
 * route boundary (see serializeSubscription in routes/subscriptions.ts).
 */
export interface Subscription {
  id: string;
  user_id: string;
  name: string | null;
  category: string | null;
  price: number | null;
  cycle: 'monthly' | 'yearly' | null;
  next_renewal: string | null; // 'YYYY-MM-DD'
  plan: string | null;
  glyph: string | null;
  used_pct: number;
  usage_note: string | null;
  unused: number; // 0 | 1 in DB
  created_at: string | null;
  updated_at: string | null;
  // ── added by 0003_subscription_model.sql ([ADR 077] §5) ──
  currency: string | null; // ISO 4217, upper case; NULL on rows written before 0003
  price_minor: number | null;
  cycle_every: number | null;
  cycle_unit: string | null; // day | week | month | year
  first_charge_on: string | null; // 'YYYY-MM-DD'
  status: string; // NOT NULL DEFAULT 'active'
  trial_ends_on: string | null; // 'YYYY-MM-DD'
  cancelled_on: string | null; // 'YYYY-MM-DD'
  deleted_at: string | null; // ISO-8601 instant
  notes: string | null;
  service_id: string | null;
  cancel_url: string | null;
  rail: string | null;
  rail_holder: string | null;
  reminder_days: string | null; // JSON text of a list of days
  shared_with: string | null;
  share_numerator: number; // NOT NULL DEFAULT 1
  share_denominator: number; // NOT NULL DEFAULT 1
  // ── added by 0005_lifecycle_history_categories.sql (ST-X8) ──
  category_id: string | null; // a `categories` row; `category` keeps its name in step
  // ── added by 0004_notice_days.sql (ST-R8) ──
  notice_days: number | null; // whole days before next_renewal to cancel by; NULL = none
  // ── added by 0009_tags.sql (AD-12) ──
  tags?: string | null; // JSON text of a list of labels; NULL = none. Optional: a DB 0007 has not reached has no such key
}

/** A payment_history row.
 *
 * `updated_at` was added by migration 0002_schema_debt.sql — "no way to tell a
 * stale row from a fresh one, so any last-write-wins merge is undecidable for
 * that table" — and was missing from this interface until 2026-08-25 while
 * routes/subscriptions.ts served it anyway through a `SELECT *`. Declared here
 * because it IS on the wire; the same edit named the columns in that SELECT so
 * the two can no longer drift apart silently. `currency` and `source` were added
 * by 0003_subscription_model.sql and named in that SELECT in the same change. */
export interface Payment {
  id: string;
  subscription_id: string | null;
  user_id: string | null;
  amount: number | null;
  paid_at: string | null;
  updated_at: string | null;
  currency: string | null;
  source: string | null;
}

/** A price_change row (0005_lifecycle_history_categories.sql, [ADR 077] §5.2).
 *  Written only by PATCH /v1/subscriptions/:id, when an edit moves the price,
 *  the exact amount or the currency. */
export interface PriceChange {
  id: string;
  subscription_id: string;
  user_id: string;
  old_price: number | null;
  new_price: number | null;
  old_price_minor: number | null;
  new_price_minor: number | null;
  old_currency: string | null;
  new_currency: string | null;
  changed_at: string; // ISO-8601 instant
}

/** A categories row (0005). A built-in has `user_id` NULL and `builtin` 1. */
export interface Category {
  id: string;
  user_id: string | null;
  name: string;
  builtin: number; // 0 | 1 in DB
  created_at: string | null;
  updated_at: string | null;
}

// `Entitlement` WAS HERE and was deleted 2026-08-09 with its last reader: both
// routes now read the shared table through their own named-column row types
// (routes/entitlements.ts exports `EntitlementRow` for the schema-witness
// test). A row type no route reads through is a declaration standing in for a
// use — the same mistake the EXPORTS note above records in the other direction.
