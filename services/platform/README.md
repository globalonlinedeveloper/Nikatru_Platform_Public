# platform — shared config + consolidated scheduler

One Cloudflare Worker for the whole NIKATRU portfolio. Wrangler v4 / jsonc.

## What it does

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
2. **Consolidated nightly cron** (`0 6 * * *`) — ONE cron for the whole account
   (Free-tier caps at 5 cron triggers/account):
   - **keepAliveSupabase** — cheap daily GET to `${SUPABASE_URL}/auth/v1/health`
     (Supabase pauses free-tier projects after ~7 days idle).
   - **renewals fan-out** — for each app in `appTargets(env)`, rolls past-due
     `next_renewal` forward one cycle and records a `payment_history` row per
     crossed charge, over that app's bound `APP_DB`. Relocated here from
     subly-api's per-app cron. Add an app by binding its DB + a target entry.

`GET /v1/health` is the deploy-verification endpoint (no auth).

## Databases + migrations

- **`platform_db`** (binding `PLATFORM_DB`, `migrations_dir: migrations`) — the
  SHARED entitlements DB. **platform is the SOLE applier** of its migrations
  (`migrations/0001_entitlements.sql`, relocated from subly-api to fix the
  footgun of a platform_db migration living in an APP_DB dir). Idempotent.
- **`subly_db`** (binding `SUBLY_DB`) — bound read/write for the renewals fan-out
  only; subly-api owns its own migrations.

```bash
npm install
npm run typecheck          # tsc --noEmit
npm test                   # vitest (config resolution + renewals date math)
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
