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
   * Warm cache for the Supabase JWKS document, so an ES256 verify does not fetch
   * it on every cold isolate. ONE identity project portfolio-wide, so one cache
   * — the same namespace services/subly-api binds.
   *
   * Optional, and absence is NOT a security hole: `jose` fetches the JWKS itself,
   * so a missing binding costs latency on a cold start and nothing else.
   * Verification never degrades to a weaker check — there is no fallback path
   * (see middleware/auth.ts for why the HS256 one was deliberately not ported).
   */
  JWKS_CACHE?: KVNamespace;

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

  /**
   * The SAME server-derived ceiling for POST /v1/money/:provider — the third
   * unauthenticated-in-the-Supabase-sense route on this Worker that does I/O.
   * Its own namespace so a flood of forged notifications cannot exhaust the
   * budget that analytics ingest and config resolution depend on.
   *
   * Optional, and absence fails OPEN, for the same reason as the other two: a
   * local or dev deploy without the binding must still run. The money route's
   * fail-CLOSED property is the signature check, not the limiter.
   */
  MONEY_CEILING_LIMITER?: RateLimiterBinding;

  // Non-secret vars (wrangler.jsonc vars).
  APP_ID: string;

  /**
   * WHICH MONEY WORLD THIS DEPLOY IS. Exactly 'live' or 'sandbox' — [5]M-12.
   *
   * ⚠️ IT IS A VAR, NOT A DERIVED VALUE, AND IT HAS NO DEFAULT. No primary source
   * establishes that a Paddle notification body identifies its own environment
   * (services/platform/src/lib/mor/paddle.ts, U1), and the destination secret's
   * documented prefix is the same in both worlds (U2) — so neither the payload
   * nor the credential can be asked. The deploy declares it, the route refuses to
   * serve when it is absent or unrecognised, and every entitlement row records
   * the value that granted it.
   *
   * Optional in the TYPE and mandatory at RUNTIME on purpose: a required field
   * here would make every existing test fixture construct a money environment it
   * does not use, and `tsc` cannot enforce what a deployed var actually contains.
   * `tooling/ci/assert-money-config.mjs` enforces the deployed value.
   */
  MONEY_ENVIRONMENT?: string;

  /**
   * Paddle's per-destination notification secret (`pdl_ntfset_…`), the key the
   * `Paddle-Signature` HMAC is computed with.
   *
   * 🔴 OWNER-GATED AND ABSENT TODAY. It can only be generated in the Paddle
   * seller console, which requires the seller account (OWNER_QUEUE A-1, PENDING).
   * Optional so the Worker builds, typechecks and deploys without it; the route
   * answers 503 rather than accepting anything, and
   * `tooling/ci/assert-mor-adapters.mjs` PRINTS the gap on every CI run rather
   * than failing the build over work only the owner can do.
   *
   * Set with `wrangler secret put PADDLE_NOTIFICATION_SECRET`. NEVER a committed
   * var: `tooling/ci/scan-secrets.mjs` refuses the prefix in the tree.
   */
  PADDLE_NOTIFICATION_SECRET?: string;
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
  /**
   * Supabase SERVICE ROLE key — used ONLY by DELETE /v1/account, to remove the
   * identity record itself.
   *
   * 🔴 OPTIONAL, AND THE ROUTE REFUSES 501 WITHOUT IT. That is not a
   * convenience: a deletion that purges the data and leaves the login working is
   * one the user cannot detect as incomplete, so the route must never start work
   * it cannot finish. Same shape the brick template already ships.
   *
   * ⚠️ WHAT THE OWNER IS APPROVING WHEN THEY SET IT: this key bypasses RLS
   * PORTFOLIO-WIDE, and this Worker is public-facing. Set with
   * `wrangler secret put SUPABASE_SERVICE_ROLE_KEY`, never as a committed var.
   */
  SUPABASE_SERVICE_ROLE_KEY?: string;
  API_VERSION: string;
  /**
   * Comma-separated EXACT browser origins for CORS (owner decision 2026-07-25).
   * Absent/empty ⇒ every browser origin is DENIED — it has not fallen back to
   * `*` since the fail-closed change, and this comment said it did until
   * 2026-08-01. See `middleware/cors.ts`, which is the behaviour of record;
   * `tooling/ci/assert-cors-allowlist.mjs` guards the list itself.
   */
  ALLOWED_ORIGINS?: string;
  /**
   * [pipeline 11]E-8 — the crash sink for UNHANDLED WORKER ERRORS.
   *
   * A `var`, not a secret, and deliberately so: a Sentry/GlitchTip DSN is a
   * write-only ingest key that this factory ALREADY ships inside every web
   * build (`deploy-web.yml` passes it as `--dart-define`, which lands in the
   * JavaScript bundle a browser downloads). Treating it as a secret here would
   * be a ceremony around a value that is public by construction, and it would
   * make the sink depend on an owner running `wrangler secret put` — which is
   * how a fail-closed seam stays closed forever.
   *
   * ABSENT ⇒ NO REPORT, silently. `lib/error-sink.ts` fails open by design.
   */
  GLITCHTIP_DSN?: string;
  /**
   * The commit this Worker was deployed from — `--var RELEASE:<sha>` in
   * deploy-workers.yml. NOT `API_VERSION`: that is the literal "v1" and has
   * never changed, so it groups every error the factory will ever report into
   * one bucket named after a URL prefix. Replaced by [9]R-2's real release id
   * when that lands.
   */
  RELEASE?: string;
}

/** Hono context Variables set by middleware. */
export interface Variables {
  /** Correlation id stamped by the request-id middleware (echoed in headers). */
  requestId: string;
  /**
   * The authenticated subject, set by `middleware/auth.ts` and by NOTHING else.
   * Present only on routes mounted behind it; a public route never sees it.
   */
  userId: string;
  /** The token's `email` claim when it carries one. Never required. */
  userEmail?: string;
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
  /**
   * How many PROMOTIONAL notifications a week an app may send — [pipeline 13]T-6.
   *
   * 🔴 SHIPS AS 0, and that is the whole design. Nothing in this repo sends a
   * promotional touch, so zero is the only value that cannot already be wrong.
   * Raising it is a deliberate decision taken once and priced at the time,
   * rather than a number that drifts upward while nobody is looking. No
   * engagement benchmark is encoded here and none should be — MASTER_PLAN §3
   * bans the figures that would otherwise get typed into this line.
   *
   * TYPED ON BOTH SIDES, which is the requirement. `packages/core`'s AppConfig
   * declares `maxPromosPerWeek` and parses this key; the contract test below
   * asserts the key set in BOTH directions, so adding it on one side alone
   * fails the other's lane. That bidirectional lever is what makes this a
   * contract rather than two files that happen to agree today.
   *
   * NOT enforced at runtime, deliberately: there is no send path to enforce it
   * on, and a limiter over an empty domain is an assertion that cannot fail.
   * `tooling/ci/assert-adapter-capabilities.mjs` carries the tripwire that
   * makes the FIRST promo sender read this value and post through a second,
   * separately opt-outable channel — and prints that its domain is empty today.
   */
  max_promos_per_week: number;
  /**
   * Where a NON-STORE build sends a user whose version is below
   * `min_supported_version` — [pipeline 9]R-10 / [10]D-8, and owner decision
   * #19 (2026-07-27).
   *
   * 🔴 THIS KEY EXISTED ON THE CLIENT AND NOWHERE ELSE, AND THAT IS A DEAD
   * SEAM THAT REPORTS HEALTHY. `packages/core`'s AppConfig has parsed
   * `update_url` since the force-update work landed, and the brick's app.dart
   * resolves `appConfigProvider…updateUrl ?? AppConfig.updateUrl` — runtime
   * first, compiled-in fallback. But the server had no such field, so the
   * runtime branch could never be taken in production: the client was parsing
   * a key this server was structurally incapable of sending, and every test
   * passed because the compile-time fallback answered instead. Nothing went
   * red, because falling back is the correct behaviour when the value is
   * absent. That is instance five of the shape [pipeline C-6] exists for.
   *
   * ⚠️ IT IS RUNTIME AND NOT COMPILE-TIME BECAUSE THE ALTERNATIVE IS CIRCULAR.
   * Owner decision #19 moved it here deliberately: baking the update
   * destination into the binary means shipping an update in order to change
   * where updates come from — and the binaries that need the change most are
   * exactly the ones that cannot receive it. A store channel does not use this
   * at all (the store owns the update path); a direct-download channel has
   * nothing else.
   *
   * `null` is the honest default and the ONLY defensible one today: no
   * non-store channel is served, `dl.nikatru.com` exists in documents and in
   * no DNS record, and a plausible-looking URL here would send the first
   * force-updated user to a 404 at the moment the app has already refused to
   * run. Null ⇒ the gate shows its message with no action, which is true.
   */
  update_url: string | null;
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
