# Subly API — Cloudflare Worker (reusable tracker-app template)

A Hono + D1 Worker that backs **Subly** (subscription tracker) and doubles as the
template for every other app in the portfolio. Data is plain REST so it works on
all six Flutter targets. Auth is **Supabase** — the Worker verifies Supabase JWTs
(it never issues them).

> Scaffold-only. Nothing here provisions or deploys live cloud resources.

## API surface

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/v1/health` | none | Liveness / deploy verification |
| POST | `/v1/webhooks/revenuecat` | shared secret | RevenueCat → entitlements upsert |
| GET | `/v1/subscriptions` | Supabase JWT | List subscriptions (price desc) |
| POST | `/v1/subscriptions` | Supabase JWT | Create subscription |
| GET | `/v1/subscriptions/:id` | Supabase JWT | One subscription + payment_history |
| PATCH | `/v1/subscriptions/:id` | Supabase JWT | Update fields |
| DELETE | `/v1/subscriptions/:id` | Supabase JWT | Cancel/delete |
| GET | `/v1/renewals?withinDays=7` | Supabase JWT | Upcoming renewals + `days_left` |
| GET | `/v1/budget` | Supabase JWT | Monthly budget + category caps |
| PUT | `/v1/budget` | Supabase JWT | Upsert budget + caps |
| GET | `/v1/entitlements` | Supabase JWT | `is_pro` + entitlements for this app |

**JSON conventions:** snake_case fields matching the DB columns. `unused` and
entitlement `is_active` are stored 0/1 but serialized as JSON booleans. Errors are
`{ "error": "<message>" }` with an appropriate status code; validation failures add
a `detail` naming the offending field.

### Input rules

Every write route validates the WHOLE body before it touches a row and answers
**400 `invalid_body`** rather than letting the value fail at the D1 bind (which
surfaces as an opaque 500 — and, for `PUT /v1/budget`, used to do so *after* the
delete). The pattern lives in each route's `validate()`; the leaf checks are in
`src/lib/validate.ts`.

| Field | Rule |
|---|---|
| `name` / `category` / `plan` / `glyph` / `usage_note` | string, bounded (200/120/200/32/1000); `''` allowed, `null` clears |
| `price` | finite number, 0 … 1 000 000 |
| `cycle` | `monthly` \| `yearly` (matches the DB CHECK) |
| `next_renewal` | a real calendar date as `YYYY-MM-DD` |
| `used_pct` | number 0 … 100 (truncated to an int) |
| `unused` | boolean |
| `?withinDays` | 0 … 3660; absent/empty ⇒ 7. Out of range is **400 `invalid_query`**, not a silent clamp — an unbounded window made `toISOString()` throw |

### Entitlements fail CLOSED

`is_pro` grants only on an entitlement that is `is_active = 1` **and** either has
no `expires_at` (a lifetime grant) or has one that parses and is in the future. An
`expires_at` that is present but **unparseable** denies — it used to grant, forever.
The RevenueCat webhook rejects (400) an `expiration_at_ms` it cannot read rather
than storing NULL, because NULL is how this table spells "lifetime". The Flutter
client mirrors both rules in `packages/core/lib/src/models/entitlement.dart`.

## Local development

```bash
npm install

# Apply the per-app schema to a local D1 (subly_db):
wrangler d1 migrations apply APP_DB --local        # npm run db:migrate:local

# Apply the SHARED entitlements schema to the local platform_db.
# (0002 targets PLATFORM_DB, not APP_DB — run it explicitly:)
wrangler d1 execute PLATFORM_DB --local --file=migrations/0002_entitlements.sql

# Secrets for local dev:
cp .dev.vars.example .dev.vars     # then fill in if needed (never commit)

npm run dev        # wrangler dev
# smoke test (no auth):
curl http://127.0.0.1:8787/v1/health
```

`npm run typecheck` runs `tsc --noEmit`.

## How token verification works

All of it lives in `src/middleware/auth.ts` — the single provider seam.

- **Primary (asymmetric):** fetch Supabase's JWKS from
  `${SUPABASE_URL}/auth/v1/.well-known/jwks.json` and verify signature + `issuer`
  (`${SUPABASE_URL}/auth/v1`) + `audience` (`authenticated`) with `jose`. The raw
  JWKS is also cached in the `JWKS_CACHE` KV namespace (~10 min TTL) to warm cold
  isolates; `jose` keeps its own in-memory cache and refetches on unknown `kid`.
- **Fallback (legacy HS256):** if `SUPABASE_JWT_SECRET` is set, verify with the
  shared secret. Useful for older projects still signing HS256.
- On success: `c.set('userId', payload.sub)` (+ `userEmail`). On any failure:
  `401 { "error": "unauthorized" }`.

Set config/secrets:

```bash
# non-secret (wrangler.jsonc vars): SUPABASE_URL, APP_ID, API_VERSION
wrangler secret put SUPABASE_JWT_SECRET        # optional (HS256 fallback)
wrangler secret put REVENUECAT_WEBHOOK_SECRET  # RevenueCat webhook auth
```

**Swap to Firebase/Auth0/etc.:** edit only `auth.ts` — repoint issuer + JWKS URL.
The rest of the app just reads `c.get('userId')`.

## Nightly cron (consolidated into services/platform)

subly-api no longer carries its own cron trigger. The nightly scheduler
(`0 6 * * *`) is **consolidated into `services/platform`** so the whole
portfolio shares ONE cron (staying under the 5-cron-triggers/account Free cap):

1. **keepAliveSupabase** — a cheap daily GET to `${SUPABASE_URL}/auth/v1/health`
   (Supabase pauses free-tier projects after ~7 days idle). Platform-wide.
2. **recomputeRenewals** — the platform scheduler fans out per-app, rolling any
   past-due `next_renewal` forward one cycle (monthly/yearly), inserting a
   `payment_history` row per crossed charge, over each app's bound `APP_DB`.

The renewals HTTP read endpoint (`GET /v1/renewals`) still lives here.

## Clone for the next app

The template is designed so each new tracker app is a copy with three edits:

1. In `wrangler.jsonc`: change `name`, `vars.APP_ID`, and the **APP_DB**
   `database_name` + `database_id` (run `wrangler d1 create <newapp>_db`).
2. Keep **PLATFORM_DB** (`platform_db`) identical — all apps share one
   entitlements table.
3. Keep **SUPABASE_URL** identical — all apps share one Supabase identity project.

Then apply `migrations/0001_init.sql` to the new APP_DB. The shared
entitlements schema (`platform_db`) is owned + migrated by **`services/platform`**
(its `migrations/0001_entitlements.sql`), applied once for the whole portfolio.

### REPLACE_ tokens to fill before going live

- `wrangler.jsonc` → `SUPABASE_URL`, APP_DB `database_id` (`REPLACE_WITH_D1_ID`),
  PLATFORM_DB `database_id` (`REPLACE_SHARED_D1_ID`), KV `id` (`REPLACE_KV_ID`).
