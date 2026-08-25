# Subly API — Cloudflare Worker (reusable tracker-app template)

A Hono + D1 Worker that backs **Subly** (subscription tracker) and doubles as the
template for every other app in the portfolio. Data is plain REST so it works on
all six Flutter targets. Auth is **Supabase** — the Worker verifies Supabase JWTs
(it never issues them).

> 🔴 **THIS IS A LIVE PRODUCTION WORKER.** It answers real traffic on
> **`api.nikatru.com`** (a custom domain declared in `wrangler.jsonc` `routes` and
> read back from the live Cloudflare account on 2026-08-03) and it holds the
> flagship app's **real user rows** in `subly_db`. Every push to `main` under
> `services/subly-api/**` runs `.github/workflows/deploy-workers.yml`, which —
> after `assert-gate-passed.mjs` confirms ci-gate went green for that commit —
> applies `d1 migrations apply APP_DB --remote` and then `wrangler deploy`, and
> `tooling/ops/post-deploy-smoke.mjs` joins the deploy to a commit through
> `GET /v1/health`'s `build` field.
>
> *(This line read "Scaffold-only. Nothing here provisions or deploys live cloud
> resources." until 2026-08-17. It was true when the directory was a template and
> false from the first deploy onward — and a "scaffold" label on the one Worker
> holding user rows is the kind of stale reassurance that gets a `--remote`
> command run casually. Corrected rather than deleted, because the sentence was
> load-bearing in the wrong direction.)*

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
| DELETE | `/v1/account` | **ES256/JWKS only** | Erase this user from every user-owned table in `subly_db` |

### ⚠️ `GET /v1/renewals` and `GET /v1/entitlements` are SERVED AND UNCONSUMED

**`GET /v1/renewals` — nothing in this repository calls it.** `ApiClient`
(`apps/subly/lib/data/api/api_client.dart`) declares no renewals method at all —
the app's "Upcoming renewals" surface derives its list client-side from
`GET /v1/subscriptions`, which it already holds.

**`GET /v1/entitlements` — a client method for it exists, and NOTHING CALLS THAT
METHOD.** The chain that looks like a caller is
`DioApiClient.getEntitlements()` (`apps/subly/lib/data/api/dio_api_client.dart:113`,
`GET /entitlements` on this Worker's base) wrapped by
`SubscriptionRepository.entitlements()`
(`apps/subly/lib/data/subscriptions/subscription_repository.dart:20`) — and it
stops there. Measured 2026-08-17 over `apps packages tooling sites` (1059 files):
`rg "\.entitlements\("` returns **zero** call sites, and `rg "getEntitlements"`
returns five matches in five files, none of them a use — the abstract method
(`api_client.dart:26`), two implementations (`seed_api_client.dart:80`,
`dio_api_client.dart:113`), the single call inside the unreached repository
method (`subscription_repository.dart:20`), and one line of prose in
`apps/subly/README.md:94`. No screen, controller, provider or test reaches any of
them.

🔴 **THE APP'S ENTITLEMENT READ GOES TO THE OTHER WORKER, WHICH IS WHY THIS ONE
HAS NO CALLER.** The live path is `entitlementsProvider`
(`apps/subly/lib/state/money_providers.dart:126`) → `entitlementTransportProvider`
(same file, `:44`) → `DioEntitlementTransport`
(`packages/api_client/lib/src/dio_entitlement_transport.dart:40`), which issues
`GET {PLATFORM_BASE_URL}/v1/entitlements?app_id=<id>`. `kPlatformBaseUrl` defaults
to `https://platform.nikatru.com` (`apps/subly/lib/state/providers.dart:476`), so
that read lands on **`services/platform`** — `platform/src/index.ts:105-106` — and
never on `api.nikatru.com`. `PaywallGate`, `manage_plan_screen.dart:90` and
`refreshEntitlements()` all watch THAT provider. The two Workers expose the same
path and answer the same question; only the platform one is wired, because
`platform_db.entitlements` is shared portfolio-wide and lives behind that Worker.

*(⚠️ CORRECTED 2026-08-17, same day it was written. This section first covered
`/v1/renewals` alone and claimed every other row in the table "either has a named
in-repo caller … or a named external sender". For `/v1/entitlements` that was
false, and falsely reassuring: the evidence stopped at `dio_api_client.dart`, a
method that EXISTS, without asking whether anything calls it. "A client method
exists" and "the endpoint is consumed" are different claims, and only the second
is what this section is about.)*

Both are kept rather than deleted, and that is a decision rather than an oversight:

- they are **live authed endpoints on a public hostname**, so "no in-repo client"
  is not "no caller" — removing one is an API-contract change, not a cleanup;
- each has a test that is the regression proof for a real defect the route had.
  `test/renewals.test.ts`: `?withinDays` had a floor and no ceiling, so
  `?withinDays=1e15` made `toISOString()` throw a `RangeError` that surfaced as a
  generic 500. `test/entitlements.test.ts`: an expiry the route could not parse
  granted Pro permanently and silently, with no error, no log and no failing test.
  Deleting a route deletes the only thing holding its bound;
- **the data behind them is actively maintained**, so they are read halves of live
  machinery rather than orphans. Renewals: the platform Worker's nightly
  `recomputeRenewals` fan-out (`services/platform/src/renewals.ts`) rolls past-due
  `next_renewal` values forward over this app's `APP_DB` and writes a
  `payment_history` row per crossed charge, every night. Entitlements: this
  Worker's own `POST /v1/webhooks/revenuecat` upserts the rows the route reads.

⚠️ Neither is part of what app #2 inherits: the brick's backend template carries
`src/routes/account.ts` and nothing else, so a stamped Worker has no renewals or
entitlements route to leave unconsumed. Whatever is decided here is a decision
about THIS Worker only.

The honest state is therefore: two routes with zero clients, kept on purpose.
🔄 CORRECTED 2026-08-25 — THIS PARAGRAPH USED TO SAY THE OPPOSITE, AND BOTH
HALVES OF IT ARE FALSE AT HEAD. It read: "⚠️ Unlike the platform Worker's
unconsumed routes (`POST /v1/checkout`, `POST /v1/money/:provider`), that claim
is **not machine-checked** — `tooling/platform-register.json` and
`assert-platform-register.mjs` reconcile routes against clients for
`services/platform` ONLY, and no equivalent register covers this Worker. So this
section is prose that can rot, and the day a client appears nothing will notice."
MEASURED TODAY: `tooling/platform-register.json` carries an `appWorkers[0]` whose
`name` is `subly-api`, `entrypoint` `services/subly-api/src/index.ts` and `config`
`services/subly-api/wrangler.jsonc`, with a TWELVE-entry `routes[]` —
`subly-renewals` and `subly-entitlements` among them — and
`node tooling/ci/assert-platform-register.mjs` prints `ok  platform register — 9
mounted route(s) reconciled with 9 register entry(ies), plus 12 across 1 app
Worker(s) reconciled with 12`. The gap is not merely covered but PRINTED, every
run: `⚠  GET /v1/renewals — NO CLIENT. · subly-api 🔴 NOTHING IN THIS REPO CALLS
IT`. So the claim above is machine-checked, and the day a client appears the
register goes red until somebody writes that client into the entry.

⚠️ WHAT IS STILL NOT CHECKED, SO NOBODY READS MORE INTO THAT GREEN THAN IS THERE:
the register's limb 2 asserts that a route's URL is CONSTRUCTED somewhere outside
the serving Worker and that the expression carries the route's own path. It is not
reachability analysis — `appWorkers[0]._why` says exactly that in the register
itself, and the `subly-entitlements` entry then records BY HAND what the machine
cannot see: `_rest.get('/entitlements')` really is the code that would issue the
request, while `SubscriptionRepository.entitlements()`, the method that wraps it,
has no live caller in the app. That is the distinction this section rotted over
once already, within hours of being written — a declaration counted as a call —
and it is now a printed fact in one place and a hand-checked note in the other.

### 🔴 `DELETE /v1/account` sits on a STRICTER auth boundary than everything above

Every other row in that table says "Supabase JWT", and `supabaseAuth` accepts two
different proofs: an ES256 signature checked against Supabase's public JWKS, and —
when that path fails and `SUPABASE_JWT_SECRET` is configured — an HS256 MAC
computed with a secret this Worker also holds. The second is symmetric: one leaked
environment variable mints a token for any user. Survivable for reading your own
subscriptions; not survivable for an irreversible erase.

So the erasure route is mounted behind **`erasureAuth`** (`src/middleware/auth.ts`),
which verifies asymmetrically and is not even handed the environment, and the route
itself **refuses anything whose `tokenAssurance` is not `asymmetric`** — two
independent limbs, because a mounting is one line somebody can move in a tidy-up.
`test/erasure.test.ts` proves the same HS256 token is accepted by
`GET /v1/subscriptions` and refused here; `tooling/ci/assert-erasure-reach.mjs`
fails the build if the route is ever put behind the permissive middleware.

**It erases `subly_db` and nothing else.** The identity record and `platform_db`
belong to `services/platform`, whose `DELETE /v1/account` relays the caller's own
bearer token here — after its service-role precondition and *before* it deletes the
identity, so a failure here leaves the user a working login and a retryable request.
The response says `scope: "subly_db"` so no caller can read `ok: true` as "the
account is gone". The table set is derived from the schema (every table with a
`user_id`), so a migration that adds a user-owned table is covered by that migration
alone — and an empty derivation is a 503 refusal, never a fast path.

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
#
# 🔴 THE FILES ARE NOT IN THIS DIRECTORY, AND THAT IS THE POINT. platform_db is
# owned and migrated by services/platform, its SOLE applier — this Worker binds
# PLATFORM_DB with NO `migrations_dir`, precisely so that
# `d1 migrations apply APP_DB` can never reach it. `migrations/` here holds
# 0001_init.sql and 0002_schema_debt.sql, and both are APP_DB.
#
# They are `execute`d from HERE rather than `migrations apply`d from ../platform
# because a local D1 lives under the WORKING DIRECTORY's `.wrangler/state`:
# running the apply over there would build a perfectly good platform_db that
# `wrangler dev` in this directory cannot see.
#
# The whole directory in order, not a named file: this Worker's entitlements
# route SELECTs `provider_environment`, which 0004_money_rail.sql adds — 0001
# alone gives you a table that is missing the column the route reads, i.e. a
# local failure that looks like a code bug.
for f in ../platform/migrations/*.sql; do
  wrangler d1 execute PLATFORM_DB --local --file="$f"
done

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

The renewals HTTP read endpoint (`GET /v1/renewals`) still lives here — served,
and with no in-repo client; see the note under the API surface table above.

## Clone for the next app

⚠️ **NOT BY HAND-COPYING THIS DIRECTORY.** App #2's backend is STAMPED from the
Mason brick at
`tooling/bricks/app/__brick__/{{#needs_backend}}services{{/needs_backend}}/{{app_id}}-api/`,
then provisioned with ONE command:

```bash
node tooling/scripts/provision-backend.mjs <app_id>
```

which creates the D1 (`--location apac`), writes the returned id into APP_DB's
`database_id`, and applies the starter migration. `assert-d1-bindings.mjs` fails
any config under `services/` still carrying the all-zeros placeholder, so the
"did I remember to fill it in" question is answered by the build.

What the stamp keeps identical, and why:

1. **APP_DB** is the only resource the new Worker owns outright — its own
   `name`, `vars.APP_ID`, `database_name` and `database_id`.
2. **PLATFORM_DB** (`platform_db`) is shared — all apps read one entitlements
   table, and the binding carries **no `migrations_dir`** because
   `services/platform` is its sole applier.
3. **SUPABASE_URL** is shared — all apps use one Supabase identity project.

⚠️ D1 Free is **10 databases per account**; `platform_db` is one of them, so
per-app databases run out after nine apps. That is why a backend is opt-in in the
brick (`needs_backend`) rather than stamped for every app.

*(This section ended in "### REPLACE_ tokens to fill before going live", listing
`REPLACE_WITH_D1_ID` / `REPLACE_SHARED_D1_ID` / `REPLACE_KV_ID`. Removed 2026-08-17
rather than edited: `rg REPLACE services/` finds those three strings in THIS FILE
and nowhere else in the tree. This Worker's `wrangler.jsonc` carries real ids, a
real Supabase project and a real custom domain, and the brick uses an all-zeros
UUID that a script fills — so the checklist described a state no file has been in
for some time, sitting under a heading that read as a live pre-launch TODO.)*
