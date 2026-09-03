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
2. **Consolidated nightly cron** (`0 6 * * *`) — one cron for the whole account,
   plus `0 18 * * *` which runs the GitHub dispatcher and nothing else.
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
     subly-api's per-app cron. Add an app by binding its DB + a target entry.

`GET /v1/health` is the deploy-verification endpoint (no auth).

## Databases + migrations

- **`platform_db`** (binding `PLATFORM_DB`, `migrations_dir: migrations`) — the
  SHARED portfolio database, and it is no longer only entitlements. **platform is
  the SOLE applier** of its migrations, which is why `subly-api` binds
  `PLATFORM_DB` with no `migrations_dir` at all. `migrations/` holds
  `0001_entitlements.sql` (relocated from subly-api to fix the footgun of a
  platform_db migration living in an APP_DB dir), then `0002_analytics`,
  `0003_cron_heartbeat`, `0004_money_rail`, `0005_cancellation_requests`,
  `0006_erasure_reach` and `0007_events_rollup`. Additive-only, enforced by
  `tooling/ci/check-migrations.mjs`.
- **`subly_db`** (binding `SUBLY_DB`) — bound read/write for the renewals fan-out
  only; subly-api owns its own migrations.

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
wrangler kv key put --binding=CONFIG_KV "config:subly" \
  '{"paywall":{"enabled":true},"min_supported_version":"1.1.0"}'
```
