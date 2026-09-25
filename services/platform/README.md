# platform — the shared Worker for the whole portfolio

One Cloudflare Worker every NIKATRU app talks to. Wrangler v4 / jsonc.

> *(This page was titled "shared config + consolidated scheduler" and described
> exactly those two things until 2026-08-17. It grew from 2 mounted routes to
> **9** — analytics ingest, the DPDP consent artifact, erasure, the shared
> entitlement read, plan cancellation, checkout and the merchant-of-record
> webhook all landed after it was written — so the page described a config
> endpoint while the file next to it carried the money rail and the erasure path.
> A README that under-describes a Worker is not merely incomplete: it is what a
> reader consults before deciding whether a change here is risky.)*

## The full route table

Derived from `src/index.ts`; `tooling/platform-register.json` holds the
authoritative version and `tooling/ci/assert-platform-register.mjs` fails the
build when the two disagree, so this table cannot silently fall behind again.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/v1/health` | none | Deploy verification. Returns `build` = the deployed commit |
| GET | `/config/:app` | none | CFG-1 runtime config, KV-backed + edge-cached (below) |
| POST | `/v1/events` | none | First-party analytics ingest (G-12) |
| POST | `/v1/consent` | none | The DPDP consent artifact |
| POST | `/v1/money/:provider` | **HMAC over raw body** | Merchant-of-record webhook ([5]M-1) |
| DELETE | `/v1/account` | **ES256/JWKS only** | Erasure ([4]B-5) |
| GET | `/v1/entitlements` | Supabase JWT | The shared entitlement read ([5]M-4) |
| POST | `/v1/plan/cancel` | Supabase JWT | The ROSCA cancel path ([5]M-9) |
| POST | `/v1/checkout` | Supabase JWT | Paddle create-transaction ([ADR 044] rung 2) |

Three properties of that table are load-bearing and are asserted, not assumed:

- **The three public routes are unauthenticated BY DESIGN.** `platformAuth` is
  mounted PATH-SCOPED, never at `'*'` — config resolution happens on every app's
  launch path, and the most valuable analytics events (`first_launch`,
  `paywall_viewed`) happen before any login exists.
- **`/v1/money/:provider` is not behind `platformAuth` and must not be.** The
  sender is a merchant of record, not a user; its proof is an HMAC-SHA256 over
  the raw body, which is strictly stronger here than a bearer token — a secret
  proves the sender knows a string, a signature proves THIS BODY came from its
  holder.
- **`POST /v1/checkout` answers 403 for every app today.** `paywall.enabled` is
  false portfolio-wide, so the route is wired and dormant on purpose; the
  register records it as an unconsumed route rather than dressing it up.

## The two subsystems with the most behaviour behind them

(Not the whole Worker — the route table above is. These two are singled out
because a caller can get them wrong in ways the others do not offer.)

1. **CFG-1 config chassis** — `GET /config/<app>` returns an app's runtime config
   as JSON: compiled-in per-app defaults (`src/config.ts`) overlaid with a KV
   override document (`CONFIG_KV` key `config:<app>`), edge-cached (5 min). Config
   is DATA/flags (`api_base_url`, `features.*`, `paywall`, `content_pack`,
   `copy.*`, `min_supported_version`, optional `theme`) — never server-driven UI.
   Apps also compile in their own fallback so they work if this host is down.
   Unknown app ⇒ `404 {"error":"unknown_app"}`, decided from the compiled-in
   registry **before any KV read** — an unregistered or malformed app id costs
   zero I/O. (It used to read KV first and index the registry with the raw path
   segment, so `/config/__proto__` answered `200 {}` and `/config/constructor`
   answered 500, each after spending a free-tier KV read.) Malformed KV JSON is
   ignored (defaults win) so a bad override can never take an app down. A known
   app is behind `CONFIG_CEILING_LIMITER`, the same server-derived
   (`edge:<colo>:<asn>`) ceiling `/v1/events` uses — the 5-minute edge cache does
   not collapse cache-busting query strings, so without it an anonymous caller
   can spend one KV read per request.
2. **Consolidated nightly cron** (`0 6 * * *`) — the nightly handler for the whole
   account, below. `wrangler.jsonc` declares six triggers in all: `0 0`, `0 12` and
   `0 18 * * *` run the GitHub dispatcher and the 6-hourly ops watchdog and nothing
   else (the 06:00 firing runs both inside the nightly chain); `30 2 * * *` runs the
   off-vendor backup alone; and `15 * * * *` runs the stuck-Actions-run check alone
   (`opsStuckRunsJob`, since 2026-09-24), whose own heartbeat
   (`OPS_STUCK_RUNS_HEARTBEAT_URL`) is sent only while no run is stuck.
   ⚠️ This read *"(Free-tier caps at 5 cron triggers/account)"* until 2026-09-03.
   The account is on **Workers Paid**, where the ceiling is **250 per account**
   ([limits](https://developers.cloudflare.com/workers/platform/limits/)).
   Consolidating was forced; it is now a choice, kept because one place to look
   beats a Worker per job:
   - **keepAliveSupabase** — cheap daily GET to `${SUPABASE_URL}/auth/v1/health`
     (Supabase pauses free-tier projects after ~7 days idle).
   - **renewals fan-out** — for each app in `appTargets(env)`, rolls past-due
     `next_renewal` forward one cycle and records a `payment_history` row per
     crossed charge, over that app's bound `APP_DB`. Relocated here from
     subscriptiontracker-api's per-app cron. Add an app by binding its DB + a target entry.

`GET /v1/health` is the deploy-verification endpoint (no auth).

## Databases + migrations

- **`platform_db`** (binding `PLATFORM_DB`, `migrations_dir: migrations`) — the
  SHARED portfolio database, and it is no longer only entitlements. **platform is
  the SOLE applier** of its migrations, which is why `subscriptiontracker-api` binds
  `PLATFORM_DB` with no `migrations_dir` at all. `migrations/` holds
  `0001_entitlements.sql` (relocated from subscriptiontracker-api to fix the footgun of a
  platform_db migration living in an APP_DB dir), then `0002_analytics`,
  `0003_cron_heartbeat`, `0004_money_rail`, `0005_cancellation_requests`,
  `0006_erasure_reach`, `0007_events_rollup` and
  `services/platform/migrations/0008_app_id_slug_rename.sql` (the 2026-09-09 `subly` -> `subscriptiontracker`
  slug move: a WHERE-scoped backfill of every `app_id` column EXCEPT
  `consent_artifacts`, which is append-only and kept the identifier it was
  granted against — until `0014` moved those rows too, by owner decision
  2026-09-22, pre-launch), then `0009_bundle_grants`, `0010_pending_erasures`,
  `0011_signups`, `0012_apple_provider_tokens`, `0013_content_reports` (the
  in-app AI content report, O-PLAY-AI-CONTENT-REPORTING) and
  `0014_consent_artifacts_app_id_rename` (that one-time consent-row rename — the
  single exemption `tooling/ci/assert-analytics-contract.mjs` grants the
  append-only rule, pinned to that file and its one statement). Additive-only, enforced
  by `tooling/ci/check-migrations.mjs`. (This list had stopped at 0008 until
  2026-09-18; nothing guards it, so the directory is the authority.)
- **`subscriptiontracker_db`** (binding `SUBSCRIPTIONTRACKER_DB`) — bound read/write for the renewals fan-out
  only; subscriptiontracker-api owns its own migrations.

```bash
npm install
npm run typecheck          # tsc --noEmit
npm test                   # vitest — the whole suite: every route above, auth,
                           # the money rail, the insights queries, and migration
                           # replay against a REAL SQL engine (node:sqlite)
npm run dry-run            # wrangler deploy --dry-run (validates bindings/bundle)
npm run db:migrate         # wrangler d1 migrations apply PLATFORM_DB --remote
npm run deploy             # wrangler deploy
```

## Config overrides (KV)

Store a partial JSON override; it deep-merges over the defaults:

```bash
wrangler kv key put --binding=CONFIG_KV "config:subscriptiontracker" \
  '{"paywall":{"enabled":true},"min_supported_version":"1.1.0"}'
```

## Why `package.json` carries an `overrides` block

```json
"overrides": { "sharp": ">=0.35.4" }
```

`sharp` is not a dependency of this Worker. It arrives four levels down —
`wrangler` → `miniflare` → `sharp` — and miniflare pins it EXACTLY
(`"sharp": "0.35.2"`), so no bump of anything we declare can move it. Measured
2026-09-09: the newest miniflare on npm, `5.20260908.0-alpha`, still pins
`0.35.2`, and `wrangler@4.130.0` still pins that miniflare. There is no version
of our own tree that resolves the fix.

GHSA-rgj7-g3m4-5g8c (CVSSv4 8.9) is a libheif RCE in every `sharp` before
0.35.4. The alternative to this line was a dated ignore entry in
`osv-scanner.toml` — a waiver, which leaves the vulnerable bytes on disk and
buys only silence. The override removes them, and both suites plus
`wrangler deploy --dry-run` were re-measured on 0.35.4 (libvips 8.18.6) before
it landed.

⚠️ THE RANGE IS `>=`, NOT `^`, AND THAT IS THE WHOLE POINT. A caret would pin us
inside 0.35.x and start HOLDING BACK the upstream the day miniflare moves to
0.36. `>=0.35.4` says the only thing we actually mean — never below the fix —
so the line retires itself instead of becoming the next thing to remember.

## The Sign in with Apple revocation secrets (OWNER ACTION, not an agent's)

Apple requires an app offering Sign in with Apple to REVOKE the user's tokens when
their account is deleted. `DELETE /v1/account` does that through
`POST https://appleid.apple.com/auth/revoke` (`src/lib/apple-revoke.ts`), which
takes a client secret signed with a Sign in with Apple key. **No agent creates or
downloads that key.** Until all four secrets are set, a deletion for an account
that has a stored Apple token answers `202 erasure_pending`, keeps the identity,
and is retried nightly — it is never reported as finished.

1. **Apple Developer → Certificates, Identifiers & Profiles → Keys → +**: name it
   (e.g. `nikatru sign in with apple`), tick **Sign in with Apple**, Configure and
   pick the primary App ID, then Continue → Register.
2. **Download the `.p8` ONCE** — Apple never offers it again — and note the
   **Key ID** on that page and the **Team ID** (top right of the portal).
3. The **client id** is the identifier the tokens were issued to: the Services ID
   the identity provider signs in with (the `client_id` in the Supabase Apple
   provider settings), NOT the app's bundle id, unless that is what is configured
   there. A mismatch is Apple's `invalid_client`, which this Worker treats as
   blocked and says so in the log rather than retrying forever.
4. Set the four, from `services/platform`:

   ```
   wrangler secret put APPLE_REVOKE_CLIENT_ID     # the Services ID above
   wrangler secret put APPLE_REVOKE_TEAM_ID       # 10 characters
   wrangler secret put APPLE_REVOKE_KEY_ID        # 10 characters
   wrangler secret put APPLE_REVOKE_PRIVATE_KEY   # the whole .p8, BEGIN/END lines included
   ```

5. Apply the migration that holds the token the revoke consumes:
   `wrangler d1 migrations apply PLATFORM_DB --remote`.

The client secret is minted per call and lives five minutes; Apple's own cap is six
months, so nothing long-lived is stored anywhere. Rotating the key is one
`wrangler secret put` of the new `.p8` plus its Key ID.
