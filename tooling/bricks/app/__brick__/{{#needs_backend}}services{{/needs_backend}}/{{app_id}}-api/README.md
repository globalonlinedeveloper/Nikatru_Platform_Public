# {{app_id}}-api — Cloudflare Worker

Per-app backend for **{{{display_name}}}**, stamped from the NIKATRU app brick.

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

## Provision (one command — nothing here is hand-edited)

    node tooling/scripts/provision-backend.mjs {{app_id}}

Creates the D1 with `--location apac`, **writes** the returned id into
`APP_DB.database_id` in `wrangler.jsonc`, and applies the starter migration.
Run it from the repo root, with `CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_ACCOUNT_ID` in the environment. It is idempotent: a second run
finds the database, leaves the config unchanged and re-verifies.

Until it has run, `database_id` is the all-zeros placeholder — correct for a
template, and `assert-d1-bindings.mjs` fails any config under `services/` that
still carries one.

`--location apac` is create-time-only and can never be changed afterwards, and
D1 places the primary near whoever issued the create call — so this must not be
run from a non-APAC CI runner without the flag.

## Bindings (wrangler.jsonc)
- `APP_DB` — this app's D1 (`{{app_id}}_db`). The ONLY per-app resource; its
  `database_id` is written by the command above.
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
