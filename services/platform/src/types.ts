// ─────────────────────────────────────────────────────────────────────────────
// Shared types for the platform Worker. Keep Env in sync with wrangler.jsonc.
// ─────────────────────────────────────────────────────────────────────────────

/** The shape of a Cloudflare Rate Limiting binding, as this Worker uses it. */
export interface RateLimiterBinding {
  limit(opts: { key: string }): Promise<{ success: boolean }>;
}

/** Worker bindings + environment. Names must match wrangler.jsonc bindings. */
export interface Env {
  // SHARED entitlements DB (platform is the sole migrations applier).
  PLATFORM_DB: D1Database;
  // Per-app DBs bound for the nightly renewals fan-out. Add one per app.
  SUBLY_DB: D1Database;

  // Edge-cached per-app config overrides (key: `config:<app>`).
  CONFIG_KV: KVNamespace;

  /**
   * Cost circuit breaker for /v1/events (G-12). The Rate Limiting binding, NOT
   * a KV counter: KV is eventually consistent with a ~60s edge cache, so under
   * the exact burst a breaker exists to stop, a KV counter reads stale and lets
   * it through. Optional so a local/dev deploy without it still runs — absence
   * fails OPEN.
   */
  EVENTS_LIMITER?: RateLimiterBinding;

  /**
   * The SERVER-DERIVED half of the same breaker, on its own namespace so it does
   * not share the per-install budget. Keyed on `request.cf` colo+asn — values the
   * caller cannot choose — because EVENTS_LIMITER's key is composed entirely from
   * the request body on a route that is unauthenticated by design, so a caller
   * rotating `anon_id` per request gets a fresh bucket every time and the ceiling
   * bounds nothing. Optional for the same reason as above: absence fails OPEN.
   */
  EVENTS_CEILING_LIMITER?: RateLimiterBinding;

  /**
   * The SAME server-derived ceiling, for GET /config/:app — the other route on
   * this Worker that is unauthenticated by design and does I/O. Its own
   * namespace so config traffic and analytics traffic cannot exhaust each
   * other's budget.
   *
   * Why the edge cache is not enough on its own: `Cache-Control: s-maxage=300`
   * only collapses requests that share a cache key, and the query string is part
   * of that key. `GET /config/subly?cb=<random>` therefore reaches the origin
   * every time and spends a free-tier KV read every time. (An UNKNOWN app costs
   * nothing at all now — that answer comes from the compiled-in registry before
   * any I/O.) Optional, and absence fails OPEN, for the same reason as above:
   * config resolution is on every app's launch path.
   */
  CONFIG_CEILING_LIMITER?: RateLimiterBinding;

  // Non-secret vars (wrangler.jsonc vars).
  APP_ID: string;
  SUPABASE_URL: string;
  /**
   * OPTIONAL comma-separated list of Supabase project URLs the nightly cron keeps
   * awake. Absent ⇒ falls back to the single [SUPABASE_URL], so an existing
   * deploy is unaffected. Set this to keep more than one project from idling into
   * Supabase's ~7-day auto-pause.
   */
  SUPABASE_KEEPALIVE_URLS?: string;

  /**
   * Supabase publishable ("anon") key, used ONLY to make the keep-alive a real
   * request instead of a rejected one.
   *
   * Optional on purpose: the Worker must keep running without it, and the
   * heartbeat row says explicitly when it is missing rather than quietly
   * recording a 401 as success — which is what it did until 2026-07-29.
   * Set with `wrangler secret put SUPABASE_ANON_KEY`, not as a committed var:
   * the key is publishable, but this repo is public and the owner already
   * treats it as a GitHub secret for the web build, so the two should agree.
   */
  SUPABASE_ANON_KEY?: string;
  API_VERSION: string;
  /** Comma-separated browser origins for CORS. Absent/empty ⇒ '*'. */
  ALLOWED_ORIGINS?: string;
}

/** Hono context Variables set by middleware. */
export interface Variables {
  /** Correlation id stamped by the request-id middleware (echoed in headers). */
  requestId: string;
}

/** Convenience: the generics shape used across the worker + sub-routers. */
export type AppEnv = { Bindings: Env; Variables: Variables };

/**
 * Resolved runtime config for an app (CFG-1). DATA/flags only — never UI.
 * Apps compile in their own fallback and overlay this at launch.
 */
export interface AppConfig {
  app_id: string;
  api_base_url: string;
  features: Record<string, boolean>;
  /**
   * Percentage-rollout flags, `name → 0..100`. Distinct from `features`, which
   * is a hard on/off toggle: the client resolves these per-install with
   * `resolveFlag`/`FeatureFlags` (core, G-14) against its stable install id.
   *
   * TYPED HERE ON PURPOSE. Flags previously reached clients only through the
   * untyped KV override, which `deepMerge` passes through unvalidated — so the
   * server had no idea this key existed while the Dart `AppConfig` already
   * parsed it. Typing it now is free; doing it once apps depend on live
   * overrides is a coordinated client+server change.
   */
  flags: Record<string, number>;
  paywall: { enabled: boolean; [k: string]: unknown };
  content_pack: string | null;
  copy: Record<string, string>;
  min_supported_version: string;
  theme?: Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Analytics (ADR 011 / G-12). The wire envelope + row shapes are LOCKED here and
// in migrations/0002_analytics.sql; the /v1/events route lands with G-12.
// ─────────────────────────────────────────────────────────────────────────────

/** One client-sent analytics event. Mirrors `company/requirements/analytics-events.md`. */
export interface AnalyticsEvent {
  /** Client UUIDv4 — the exactly-once key. Batches retry, so ingest dedups. */
  event_id: string;
  /**
   * Pseudonymous per-install id. MUST be the same value the client buckets
   * feature flags with (the brick's `installIdProvider`) — two ids make every
   * %-rollout permanently unmeasurable. Never a device advertising id.
   */
  anon_id: string;
  /** Rotates after ~30 min idle. */
  session_id?: string;
  platform?: string;
  app_version?: string;
  /** Event name from the locked taxonomy. */
  event: string;
  /** Client clock — untrusted; the edge stamps the authoritative `server_ts`. */
  ts?: string;
  /** Enumerable values ONLY: no free text, no user content, no exact location. */
  params?: Record<string, string | number | boolean>;
  /** The consent artifact in force when this event was collected. */
  consent_id?: string;
}

/** POST /v1/events body: `app_id` once, events batched. */
export interface AnalyticsBatch {
  app_id: string;
  events: AnalyticsEvent[];
}

/** A DPDP consent grant/withdrawal. Append-only: withdrawal is a NEW row. */
export interface ConsentArtifact {
  consent_id: string;
  anon_id: string;
  /** 'analytics' | 'sync_backup' | … */
  purpose: string;
  granted: boolean;
  /** Which privacy-policy version the user was shown. */
  policy_version: string;
  app_version?: string;
  platform?: string;
  ts?: string;
}

/**
 * Coarse geo derived from the `request.cf` object. NEVER from an IP header —
 * `CF-Connecting-IP` is dropped at the edge and never stored, which makes rows
 * pseudonymous rather than anonymous (say so in the privacy policy).
 */
export interface EdgeGeo {
  country?: string;
  region?: string;
  city?: string;
}

/** A subscription row (subset used by the renewals fan-out). */
export interface Subscription {
  id: string;
  user_id: string;
  price: number | null;
  cycle: 'monthly' | 'yearly' | null;
  next_renewal: string | null; // 'YYYY-MM-DD'
}

/** One app the nightly scheduler fans out to. */
export interface AppTarget {
  appId: string;
  db: D1Database;
}
