# {{app_id}}-api — Cloudflare Worker

Per-app backend for **{{{display_name}}}**, stamped from the NIKATRU app brick.

- `GET /v1/health` — public deploy marker (no auth).
- `DELETE /v1/account` — **G2** in-app account deletion (auth required): purges
  every row this user owns from `APP_DB` + their shared `PLATFORM_DB`
  entitlements. Extend `src/routes/account.ts` as you add user-owned tables.

## Bindings (wrangler.jsonc)
- `APP_DB` — this app's D1 (`{{app_id}}_db`). The ONLY per-app resource. Set
  `database_id` after `wrangler d1 create {{app_id}}_db --location apac`
  (`--location` is create-time-only and can never be changed afterwards).
- `PLATFORM_DB` — shared entitlements DB (same id in every app).
- `JWKS_CACHE` — shared KV caching the Supabase JWKS.

There is deliberately **no R2 binding**. Object storage is ONE portfolio bucket
bound in `services/platform`, addressed with an `<app_id>/` key prefix — see
[ADR 020]. Payment/MoR webhooks also terminate in `platform`, never here.

## Develop
    npm install
    npm run typecheck
    npm run dry-run           # wrangler deploy --dry-run (offline validation)
    npm run db:migrate:local  # apply migrations to a local D1
    npm run dev
