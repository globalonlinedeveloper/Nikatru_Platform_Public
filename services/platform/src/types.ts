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
   * seller console, per notification-destination.
   *
   * ⚠️ CORRECTED 2026-08-28: this said the console "requires the seller account
   * (OWNER_QUEUE A-1, PENDING)". A-1 is DONE — the account went LIVE 2026-08-11
   * ([ADR 044]) — so the console is reachable and this secret is one console
   * action away, not one signup away. It is still ABSENT from this Worker as far
   * as anything here can tell: a Worker secret is invisible to every guard in the
   * tree, so the 503 below stays the honest default.
   * Optional so the Worker builds, typechecks and deploys without it; the route
   * answers 503 rather than accepting anything, and
   * `tooling/ci/assert-mor-adapters.mjs` PRINTS the gap on every CI run rather
   * than failing the build over work only the owner can do.
   *
   * Set with `wrangler secret put PADDLE_NOTIFICATION_SECRET`. NEVER a committed
   * var: `tooling/ci/scan-secrets.mjs` refuses the prefix in the tree.
   */
  PADDLE_NOTIFICATION_SECRET?: string;
  /**
   * Paddle's SELLER API KEY (`pdl_live_apikey_…` / `pdl_sdbx_apikey_…`), the
   * bearer credential `POST /v1/checkout` creates a transaction with.
   *
   * 🔴 DECLARED HERE BECAUSE IT WAS READ BY NAME THROUGH A CAST AND `tsc` COULD
   * NOT SEE IT. `routes/checkout.ts` reached it as
   * `(c.env as unknown as Record<string, string | undefined>)['PADDLE_API_KEY']`
   * and justified that by symmetry with `routes/money.ts`. MEASURED 2026-08-25,
   * the symmetry did not hold: money.ts reads a rail's destination secret by
   * name because the NAME IS DATA (`verifier.secretEnvVar`, chosen at runtime by
   * the URL segment) — and that secret is declared right above this one anyway.
   * checkout.ts has exactly one credential, known at compile time, so the cast
   * bought nothing and cost the one thing the cast removes: an env sweep over
   * `services/platform/src` returned 19 names and this was not among them, so a
   * developer had no way to discover it from the type at all.
   *
   * OPTIONAL, and absence FAILS CLOSED: checkout answers 503
   * `checkout_not_configured` rather than attempting an unauthenticated call.
   *
   * 🔴 `wrangler secret put PADDLE_API_KEY`, NEVER a committed var — this
   * repository is public and `.gitleaks.toml` carries rules for both prefixes.
   * `.dev.vars.example` documents the local half; the deployed value is the
   * vault's `PADDLE_API_KEY_LIVE` ([ADR 044]).
   */
  PADDLE_API_KEY?: string;
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
   * GitHub token used ONLY to fire `workflow_dispatch` on the workflows named in
   * `GITHUB_DISPATCH_TARGETS` (services/platform/src/scheduled.ts).
   *
   * 🔴 OPTIONAL, AND THE LIMB WRITES `ok = 0` WITHOUT IT rather than skipping.
   * A dispatcher with no credential and no row is indistinguishable from a
   * dispatcher that is working, which is the exact shape of every silent
   * failure this portfolio has paid for. Absent ⇒ one heartbeat row per target
   * saying so, and `check-heartbeats.mjs` turns that into a durable issue.
   *
   * ⚠️ SCOPE IS THE WHOLE POINT: this wants `Actions: read and write` on the two
   * public repositories and NOTHING ELSE. Do not reuse a classic PAT from the
   * vault — those carry `repo`, `admin:org` and `delete_repo`, and this Worker
   * is a public-facing service whose secrets are worth exactly what they can do.
   * Set with `wrangler secret put GITHUB_DISPATCH_TOKEN`, never as a var.
   */
  GITHUB_DISPATCH_TOKEN?: string;
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

  /**
   * WHERE EACH APP'S OWN ERASURE ROUTE LIVES — `"<appId>=<https origin>"`,
   * comma-separated. Today: `"subly=https://api.nikatru.com"`.
   *
   * 🔴 A COMMITTED VAR, NOT A SECRET, AND NOT OPTIONAL IN PRACTICE. DELETE
   * /v1/account is the portfolio's erasure entry point, and this Worker can only
   * empty platform_db. Every app that keeps user rows in its OWN database has an
   * erasure route on its own Worker (services/subly-api/src/routes/account.ts;
   * the brick stamps one for every future app), and this list is how the shared
   * route finds them. An app whose endpoint is missing here is an app whose rows
   * survive "delete my account" — so the route REFUSES rather than skipping, and
   * `tooling/ci/assert-erasure-reach.mjs` fails the build when a per-app D1
   * binding on this Worker has no endpoint declared.
   *
   * ⚠️ `https://` IS REQUIRED AND CHECKED AT RUNTIME. The relay forwards the
   * CALLER'S OWN BEARER TOKEN, so a plaintext or malformed origin here would put
   * a live session token on the wire. Optional in the TYPE only because a var
   * cannot be proven present by `tsc`; absent at runtime is a refusal.
   */
  APP_ERASURE_ENDPOINTS?: string;
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
  /**
   * [pipeline B-16] WHICH APP THIS REQUEST IS FOR, set by each route the moment
   * it has resolved and VALIDATED one, and read by `app.onError`.
   *
   * 🔴 WHY IT IS A CONTEXT VARIABLE AND NOT `env.APP_ID`. `platform` is the ONE
   * Worker behind the whole portfolio: `env.APP_ID` is the constant "platform",
   * which answers "which Worker broke" and never "whose app broke". With 50 apps
   * on one host, an error report that cannot name the app is a report nobody can
   * route — and `onError` runs after the handler has thrown, so it cannot go and
   * re-parse a body that was consumed.
   *
   * ⚠️ OPTIONAL, AND IT MUST STAY OPTIONAL. A request can fail BEFORE any app id
   * exists — malformed JSON, a body over the cap, a 404 on an unmounted path. A
   * required field would force a placeholder, and a placeholder that means both
   * "no app was named" and "the app is literally called unknown" is worse than
   * an absent one. The reports print `-` and mean it.
   *
   * ⚠️ SET IT ONLY AFTER VALIDATION. An unvalidated value here would put
   * caller-controlled strings into the error sink's tags, which is a
   * cardinality bomb and a light injection surface. Every writer below is
   * downstream of `isKnownApp`.
   */
  appId?: string;
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
  /**
   * ⬜ DECLARED ON BOTH SIDES, EMITTED BY NOBODY, READ BY NOBODY — and PRINTED
   * on every CI run rather than deleted, because the decision this seam is
   * waiting on belongs to the owner and not to a cleanup pass.
   *
   * MEASURED 2026-08-25 over every git-tracked file in this repository and in
   * the three sibling repositories, with no language filter (.ts .dart .mjs .js
   * .json .md .yml alike), because the last dead-key sweep here was language
   * scoped and wrong:
   *   · the JSON key `"theme"` occurs in `app-config-data.json` ZERO times, so
   *     neither `defaults` nor any `apps.*` entry emits it. It can reach a
   *     client only through a hand-written CONFIG_KV override, which
   *     `deepMerge` passes through unvalidated.
   *   · `packages/core`'s AppConfig declares, parses, serialises and copyWiths
   *     it, and NOTHING reads it. Every `.theme` in the tree is that class's own
   *     six sites, one test asserting it is null, or `MaterialApp.theme` in a
   *     widget test — a DIFFERENT symbol, and exactly the false positive a
   *     careless sweep banks as a reader.
   *
   * ⚠️ CORRECTION 2026-08-25, SAME DAY — THAT SPLIT IS INVERTED. The paragraph
   * above is left unedited on purpose: renumbering a dated record falsifies it
   * instead of repairing it. Read it as history and read this as the number.
   * Re-measured at commit `a028cc0`, the merge base of branch `backlog-wave-2`,
   * over all 1260 files tracked there, no language filter. The TOTAL of nine is
   * right; the split is 2 / 1 / 6, not 6 / 1 / 2:
   *   · 2 — AppConfig's own sites: `this.theme` in the constructor and
   *     `theme ?? this.theme` in `copyWith`. The class touches the IDENTIFIER
   *     `theme` six times (declare, parse, serialise, copyWith), which is where
   *     "six sites" came from — but only two of those are the DOTTED token, and
   *     the dotted token is what the scan matches.
   *   · 1 — `packages/core/test/config_test.dart`, asserting it is null.
   *   · 6 — `MaterialApp.theme`, the different symbol.
   *   · AND THOSE SIX SIT IN TWO WIDGET TESTS, not the one named above:
   *     `apps/subly/test/chassis_properties_test.dart` (3) and its brick copy
   *     `tooling/bricks/app/__brick__/apps/{{app_id}}/test/chassis_properties_test.dart`
   *     (3). The brick copy appears nowhere in the record, and it is the copy
   *     that MULTIPLIES — every app the factory stamps carries it.
   *
   * DIRECTION OF THE ERROR: it UNDERSTATED the false-positive population this
   * note exists to warn about. Two thirds of the tree-wide hits are the
   * different symbol, not two ninths — the trap is three times larger than the
   * record admitted, and understating it is the direction that makes a careless
   * sweep look safer than it is.
   *
   * VERDICT UNCHANGED. All nine sit in AppConfig itself or under a `/test/`
   * segment, and limb 9 cuts both: `dartFiles` filters
   * `/(?:test|integration_test)/` and the reader loop skips `APP_CONFIG_DART`.
   * The reader scan's domain does not move, so everything below stands —
   * declared on both sides, emitted and read by nobody, owner-gated.
   *
   * COUNTED OVER COMMENT-STRIPPED SOURCE — CODE POSITIONS ONLY. That is the
   * domain limb 9 reads (`stripSourceComments` in
   * `tooling/ci/text-reductions.mjs`) and the only domain in which this
   * paragraph can state a count without becoming part of it. Not a hypothetical
   * worry: this corpus once shipped a "grep returns 12" correction that was
   * itself the 13th hit. A raw tree-wide grep at HEAD now returns 21, and every
   * one of the extra twelve is prose about the nine. Code positions in THIS
   * file: 0 before this correction and 0 after — every `.theme` here has always
   * been commentary, never a member access.
   *
   * SWEEP RULE — run from the repo root; both print 9, and they agree only
   * because no comment at `a028cc0` carried the token, which is precisely what
   * stopped being true when this correction was written:
   *
   *     git grep -o -E '\.theme\b' a028cc0 -- . | wc -l
   *
   *     node --input-type=module -e "
   *     import {execSync as x} from 'node:child_process';
   *     import {extname} from 'node:path';
   *     import {stripSourceComments as s} from './tooling/ci/text-reductions.mjs';
   *     const T = 'a028cc0', g = (c) => x(c, {encoding: 'utf8', maxBuffer: 1e9});
   *     let n = 0;
   *     for (const f of g('git ls-tree -r --name-only ' + T).split('\n').filter(Boolean))
   *       n += (s(g('git show ' + T + ':' + JSON.stringify(f)), extname(f))
   *             .match(/\.theme\b/g) || []).length;
   *     console.log(n);
   *     "
   *
   * Naming the commit is part of the rule. A tree-wide count with no commit
   * pinned rots the next time anyone writes the token — including into a comment
   * like this one. The client-side half carries the same correction: search
   * `packages/core/lib/src/config/app_config.dart` for `CORRECTION 2026-08-25`.
   *
   * ⚠️ CORRECTION 2026-08-25, PART TWO — THE DOMAIN CLAIM IS ALSO WRONG, AND IT
   * IS THE WORSE OF THE TWO ERRORS. The paragraph above declares the sweep ran
   * "over every git-tracked file in this repository and in the three sibling
   * repositories, with no language filter (.ts .dart .mjs .js .json .md .yml
   * alike)" and then asserts a result that was only ever true of ONE
   * repository's Dart. Run the rule as written over the domain as written and
   * it does not reproduce. Measured this run, `git grep -o -E '\.theme\b' -- .`
   * in each repository's working tree:
   *
   *     Nikatru_Platform_Public      9   PINNED AT a028cc0. The live worktree
   *                                      figure is larger and climbs with every
   *                                      note like this one, which is the whole
   *                                      reason it is pinned.
   *     Nikatru_Platform_Private     2
   *     Nikatru_Extensions_Public   51   🔴
   *     Nikatru_Extensions_Private   0
   *     ─────────────────────────────
   *     four-repo total             62
   *
   * FIFTY-ONE OF THOSE SIXTY-TWO ARE A THIRD SYMBOL the sentence does not admit
   * exists, and it is not `MaterialApp.theme` either. Every one is JavaScript:
   * `Nikatru_Extensions_Public` tracks ZERO `.dart` files and does not contain
   * the string `AppConfig` or `MaterialApp` in any file. Receivers, via
   * `git grep -o -E '\w+\.theme\b' -- . | awk -F: '{print $NF}' | sort | uniq -c
   * | sort -rn` — `dataset.theme` 12, `r.theme` 11, `s.theme` 7, `sync.theme` 6,
   * `settings.theme` 3, then a tail of local names. It is a browser extension's
   * own light/dark settings key — `document.documentElement.dataset.theme` and
   * the stored record behind it — concentrated in
   * `Extension/Full_Screen_Shot/test/editor-sim.node.js`,
   * `core/test/settings.node.js` and
   * `templates/tool/test/skeleton-sim.node.js`. Different language, different
   * product, same six letters.
   *
   * The remaining 2 are PROSE: `notes/HANDOFF-2026-08-21.md` and
   * `research/RESEARCH-dead-seams-2026-08-21.md` in `Nikatru_Platform_Private` each
   * cite `AppConfig.theme` in a markdown sentence. Same symbol this time — but
   * nothing executes a note.
   *
   * THE SHAPE OF THE MISTAKE MATTERS MORE THAN THE COUNT. It is the same error
   * twice in one sentence. The record WIDENED ITS DOMAIN to four repositories
   * and seven file extensions in order to sound rigorous — it says so, correcting
   * an earlier sweep for having been "language scoped and wrong" — and then
   * stated a RESULT it had only ever checked in one repository's Dart. A domain
   * claimed wider than the result checked is WORSE than the narrow claim it was
   * improving on, because it reads as more careful. The repair is not to widen
   * again; it is to state the domain that actually carries the verdict.
   *
   * THE DOMAIN THAT ACTUALLY CARRIES THE VERDICT — non-test Dart, the Platform
   * repository, comment-stripped, pinned. That is limb 9's real reach: it walks
   * `DART_ROOTS` (`apps`, `packages`, `tooling/bricks`), cuts
   * `/(?:test|integration_test)/`, takes every file through
   * `stripSourceComments`, and skips `APP_CONFIG_DART` itself. It reads no
   * JavaScript, no markdown and no other repository, so nothing outside this
   * domain can arm it or disarm it. From the Platform repo root, over every
   * tracked `.dart` — a SUPERSET of that walk — this prints 0:
   *
   *     node --input-type=module -e "
   *     import {execSync as x} from 'node:child_process';
   *     import {stripSourceComments as s} from './tooling/ci/text-reductions.mjs';
   *     const T = 'a028cc0';
   *     const SELF = 'packages/core/lib/src/config/app_config.dart';
   *     const g = (c) => x(c, {encoding: 'utf8', maxBuffer: 1e9});
   *     let n = 0;
   *     for (const f of g('git ls-tree -r --name-only ' + T).split('\n'))
   *       if (f.endsWith('.dart') && !/\/(?:test|integration_test)\//.test(f)
   *           && f !== SELF)
   *         n += (s(g('git show ' + T + ':' + JSON.stringify(f)), '.dart')
   *               .match(/\.theme\b/g) || []).length;
   *     console.log(n);
   *     "
   *
   * ZERO — not "nine, of which some are false positives". Zero, in the only
   * domain the guard can see. The self-reference trap is closed by the same two
   * devices as above: the commit is pinned, and the Dart file is excluded BY
   * NAME exactly as limb 9 excludes it, so no quantity of prose can move it.
   *
   * 🔴 THE FOUR-REPO SWEEP STRENGTHENS THE VERDICT, IT DOES NOT SOFTEN IT. Every
   * one of the 53 hits outside the Platform repository is either prose in a
   * markdown note or another language's unrelated settings key, in a repository
   * containing no Dart at all. Not one of them is STRUCTURALLY CAPABLE of being
   * a reader of `AppConfig.theme` — reading that field requires Dart that parses
   * that class, and there is none outside this tree. The wide sweep is not a
   * concession; it is the strongest evidence yet for EMITTED BY NOBODY, READ BY
   * NOBODY, and it now rests on a domain small enough to re-run in seconds.
   *
   * HOW LIMB 9 READS IT TODAY — rewritten 2026-08-25; do NOT describe the old
   * matcher. It no longer banks a bare `.theme` on any receiver as a reader. It
   * computes a LOOSE set (the access on any receiver) and a BOUND set (the
   * access resolved textually to an AppConfig-typed identifier) and feeds each
   * branch the set whose error direction is a visible FAIL; loose-only files
   * print as NEAR MISS instead of counting as readers. Search
   * `assert-config-registry.mjs` for `boundReaders` and for `NEAR MISS`. The
   * consequence here: `MaterialApp.theme` would no longer be banked as a reader
   * even if it left `/test/`. The false positive the paragraph above warns about
   * is now a warning for the HUMAN running the sweep rather than for the guard —
   * which is exactly who got it wrong, twice.
   *
   * 🔴 NOT DELETED, AND NOT OUT OF TIMIDITY. This is the SERVER-SIDE HOME of the
   * brand-vs-seed decision, which is half taken: the owner has recorded that
   * #6459F5 is Subly's brand under a two-layer model, and only the
   * accent-migration question is open. Deleting the field deletes the seam that
   * decision lands on. Serving it today would put a key on the wire that every
   * client parses into a field no surface reads.
   *
   * ⚠️ IT IS OPTIONAL, AND THAT IS PRECISELY HOW IT ESCAPED EVERY LIMB. Limb 6
   * of `tooling/ci/assert-config-registry.mjs` derives its completeness set with
   * `.filter((k) => k[2] !== '?')`, so an optional field is outside that check
   * BY CONSTRUCTION, and limb 8 covers `features` only. Limb 9 now ranges over
   * the optional fields specifically and FAILS in both directions — emitted and
   * unread, or read and unemitted (the `update_url` shape one field up, which
   * reported healthy for weeks). While neither has happened it prints TRIPWIRE
   * ARMED, DOMAIN EMPTY, the idiom `assert-adapter-capabilities.mjs` uses for
   * `max_promos_per_week`. `services/platform/test/config.test.ts` holds the
   * other half: `theme` is no longer waved past the stray-key assertion, so
   * putting it into a compiled-in default turns that lane red the same day.
   */
  theme?: Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Analytics (ADR 011 / G-12). The wire envelope + row shapes are LOCKED here and
// in migrations/0002_analytics.sql; the /v1/events route lands with G-12.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One client-sent analytics event. Mirrors the locked taxonomy in
 * `Private/requirements/` — the prose `analytics-events.md` this used to name was
 * folded into that JSON spec on 2026-08-16 (commit e88fdcf), where the event list
 * survives verbatim under origin `[REQ]analytics-events §standard-events` and the
 * envelope these fields mirror is pinned column by column as INV-1101/1102/1105 in
 * invariants.json. The deleted page reads back with
 * `git -C Private show e88fdcf^:requirements/analytics-events.md`.
 */
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
  /**
   * 'analytics' | 'sync_backup' | 'promo' | …
   *
   * Deliberately a free string and NOT a union: the route bounds it at 32 chars
   * and writes it as TEXT, so a client purpose the server has never heard of is
   * recorded rather than rejected. That is the right direction — a consent
   * decision the user really made, dropped with a 400 because the server's
   * vocabulary was a release behind the app's, is an unrecorded decision, and
   * `consent_artifacts` is the trail a DPDP §6(3) withdrawal has to reference.
   *
   * 'promo' (research/44 rung 4) is the GDPR Art 21 objection to in-app
   * promotion. Note that it inverts the usual reading of `granted`: the purpose
   * runs on legitimate interest, so `granted: false` is an OBJECTION and its
   * absence is not an absence of legal basis. Anything aggregating this table
   * by `granted` has to branch on the purpose.
   */
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
