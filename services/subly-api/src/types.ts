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
  APP_DB: D1Database; // per-app data (subscriptions, budgets, ...)
  PLATFORM_DB: D1Database; // shared entitlements across the portfolio

  // KV — caches the Supabase JWKS document
  JWKS_CACHE: KVNamespace;

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
   * the RevenueCat webhook (events from the OTHER world are acked and ignored,
   * never written) and by /v1/entitlements (a row from the other world grants
   * nothing). Absent/unrecognised ⇒ both answer 503 rather than guess — see
   * src/lib/money.ts for why neither default is safe.
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
  REVENUECAT_WEBHOOK_SECRET?: string;
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
export type TokenAssurance = 'asymmetric' | 'symmetric';

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
}

/** A payment_history row. */
export interface Payment {
  id: string;
  subscription_id: string | null;
  user_id: string | null;
  amount: number | null;
  paid_at: string | null;
}

/** An entitlements row (PLATFORM_DB). */
export interface Entitlement {
  user_id: string;
  app_id: string;
  entitlement: string;
  product_id: string | null;
  store: string | null;
  is_active: number; // 0 | 1 in DB
  expires_at: string | null;
  updated_at: string | null;
}
