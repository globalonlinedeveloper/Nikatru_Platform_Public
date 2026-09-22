# Subly live E2E

End-to-end test of the **deployed** app against **live Supabase auth + the live
Cloudflare Worker + D1**. It drives the real Flutter widget tree in headless
Chrome (via `integration_test` + `flutter drive`), so it works despite the web
build being a canvas with no DOM.

## What it does
1. `provision_user.mjs` — creates a throwaway, **pre-confirmed** `@nikatru.com`
   user via the GoTrue admin API (email confirmation is ON in this project).
2. `integration_test/app_test.dart` — logs in through the UI, then visits every
   screen (onboarding, login, scan, home, calendar, insights, budget, settings,
   notifications, add-sheet, detail), screenshotting each, and exercises the full
   subscription lifecycle: **create** (POST) → read-back → **delete** (DELETE) →
   create a second (left for the verify+purge steps), plus a currency switch and
   sign-out. 17 screenshots in all.
3. `verify_row.mjs` — reads the golden-path user's subscription count in D1
   (server-side proof).
4. `assert_one_issuer.mjs` — asks the deployed Worker whether it accepts this
   target's session.
5. `verify_purged.mjs` — re-reads the delete-leg user's identity (GoTrue admin
   API) and every user-owned D1 table.
6. `verify_consent.mjs` — reads the consent artifact the run wrote to
   platform_db.
7. `purge.mjs` — deletes the user's D1 rows (all tables) + the auth user, so
   both stores return to pristine. Runs even if the test fails.

The suite is wired in `.github/workflows/e2e.yml` (nightly + manual dispatch).
Screenshots are uploaded as the `e2e-screenshots-<app>` artifact.

## Auth targets — the verifiers grade against the one this run used
`e2e.yml`'s `auth_target` input picks the auth stack: `hosted` (the hosted
Supabase project, the one issuer the Workers trust today) or `boxa` (the Box A
GoTrue, which the Workers refuse until the Phase 5 cutover). The preflight
writes the choice to `$GITHUB_ENV` as `E2E_AUTH_TARGET`, and the three
verifiers read it. The same read has opposite correct answers on the two
targets, so each verifier asserts the outcome for ITS target and never skips:

| verifier | `hosted` expects | `boxa` expects |
|---|---|---|
| `verify_row.mjs` | at least 1 subscription row | **exactly 0** rows — a row means the Worker accepted a Box A token (exit 1, a security finding) |
| `verify_purged.mjs` | identity **gone** (404), 0 rows | identity **still resolves** on Box A (2xx naming this user), 0 rows — the delete leg stops at the one-issuer refusal |
| `verify_consent.mjs` | the granted=0 artifact | **the same** artifact — the consent route is unauthenticated and the suite answers the prompt before sign-in |

An unset or unknown `E2E_AUTH_TARGET` is exit 2, "could not decide what to
expect", before any request — never a default to `hosted`. On `boxa` a count D1
did not answer is exit 2, never 0. The expectations and every verdict line live
in `auth_target_expectation.mjs` (imported, never run as a step);
`tooling/ci/test/e2e-verify-target.test.mjs` pins the hosted lines byte for byte
and holds the three red controls. To run a verifier by hand, set
`E2E_AUTH_TARGET=hosted` or `boxa` alongside its other env vars.

## Secrets it needs (GitHub → Settings → Secrets and variables → Actions)
| Secret | Notes |
|---|---|
| `SUPABASE_URL` | already set (web deploy) |
| `SUPABASE_ANON_KEY` | already set (publishable key) |
| `API_BASE_URL` | already set (`https://subscriptiontracker-api.nikatru.com`) |
| `CLOUDFLARE_ACCOUNT_ID` | already set |
| `CLOUDFLARE_API_TOKEN` | already set — **must include D1 read+write** |
| `SUPABASE_SERVICE_ROLE_KEY` | **NEW** — add to enable the job |

`auth_target=boxa` reads `BOXA_SUPABASE_URL`, `BOXA_SUPABASE_ANON_KEY` and
`BOXA_SUPABASE_SERVICE_ROLE_KEY` in place of the three `SUPABASE_*` secrets. If a
secret the chosen target needs is absent, the preflight FAILS the run — it does
not skip.

## Run locally
```bash
cd apps/subscriptiontracker && flutter pub get
chromedriver --port=4444 &
# provision a user (needs the two SUPABASE_* env vars), then:
flutter drive \
  --driver=test_driver/integration_test.dart \
  --target=integration_test/app_test.dart \
  -d web-server --browser-name=chrome \
  --dart-define=SUPABASE_URL=... --dart-define=SUPABASE_ANON_KEY=... \
  --dart-define=API_BASE_URL=https://subscriptiontracker-api.nikatru.com \
  --dart-define=E2E_EMAIL=... --dart-define=E2E_PASSWORD=...
```
