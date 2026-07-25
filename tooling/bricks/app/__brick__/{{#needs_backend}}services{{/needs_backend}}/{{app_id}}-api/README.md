# {{app_id}}-api — Cloudflare Worker

Per-app backend for **{{display_name}}**, stamped from the NIKATRU app brick.

- `GET /v1/health` — public deploy marker (no auth).
- `DELETE /v1/account` — **G2** in-app account deletion (auth required): purges
  every row this user owns from `APP_DB` + their shared `PLATFORM_DB`
  entitlements. Extend `src/routes/account.ts` as you add user-owned tables.

## Bindings (wrangler.jsonc)
- `APP_DB` — this app's D1 (`{{app_id}}_db`). Set `database_id` after
  `wrangler d1 create {{app_id}}_db`.
- `PLATFORM_DB` — shared entitlements DB (same id in every app).
- `JWKS_CACHE` — shared KV caching the Supabase JWKS.
- `EXPORTS` — R2 bucket for exports/receipts.

## Develop
    npm install
    npm run typecheck
    npm run dry-run           # wrangler deploy --dry-run (offline validation)
    npm run db:migrate:local  # apply migrations to a local D1
    npm run dev
