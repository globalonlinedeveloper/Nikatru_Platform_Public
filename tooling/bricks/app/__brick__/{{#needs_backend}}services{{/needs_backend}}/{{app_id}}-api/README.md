# {{app_id}}-api — Cloudflare Worker

Per-app backend for **{{display_name}}**, stamped from the NIKATRU app brick.

- `GET /v1/health` — public deploy marker (no auth).
- `DELETE /v1/account` — **G2** in-app account deletion (auth required): purges
  every row this user owns from `APP_DB`, their shared `PLATFORM_DB`
  entitlements, **and their Supabase identity record**. Extend
  `src/routes/account.ts` as you add user-owned tables.

## Secrets (never in wrangler.jsonc)
- `SUPABASE_SERVICE_ROLE_KEY` — **required before `DELETE /v1/account` will do
  anything.** It is the only credential that can remove an identity record, and
  without it the route answers `501 account_deletion_unconfigured` rather than
  reporting a deletion that leaves the user's login working. Set it with:

      wrangler secret put SUPABASE_SERVICE_ROLE_KEY

  It bypasses RLS — nothing outside `src/routes/account.ts` may read it, and it
  must never be logged or returned in a response.
- `SUPABASE_JWT_SECRET` — optional legacy HS256 fallback; most projects verify
  with the ES256 JWKS and need no secret here.

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
