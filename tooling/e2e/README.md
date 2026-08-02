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
3. `verify_row.mjs` — confirms the row exists in D1 (server-side proof).
4. `purge.mjs` — deletes the user's D1 rows (all tables) + the auth user, so
   both stores return to pristine. Runs even if the test fails.

The suite is wired in `.github/workflows/e2e.yml` (nightly + manual dispatch).
Screenshots are uploaded as the `e2e-screenshots` artifact.

## Secrets it needs (GitHub → Settings → Secrets and variables → Actions)
| Secret | Notes |
|---|---|
| `SUPABASE_URL` | already set (web deploy) |
| `SUPABASE_ANON_KEY` | already set (publishable key) |
| `API_BASE_URL` | already set (`https://api.nikatru.com`) |
| `CLOUDFLARE_ACCOUNT_ID` | already set |
| `CLOUDFLARE_API_TOKEN` | already set — **must include D1 read+write** |
| `SUPABASE_SERVICE_ROLE_KEY` | **NEW** — add to enable the job |

If `SUPABASE_SERVICE_ROLE_KEY` is absent the workflow green-skips.

## Run locally
```bash
cd apps/subly && flutter pub get
chromedriver --port=4444 &
# provision a user (needs the two SUPABASE_* env vars), then:
flutter drive \
  --driver=test_driver/integration_test.dart \
  --target=integration_test/app_test.dart \
  -d web-server --browser-name=chrome \
  --dart-define=SUPABASE_URL=... --dart-define=SUPABASE_ANON_KEY=... \
  --dart-define=API_BASE_URL=https://api.nikatru.com \
  --dart-define=E2E_EMAIL=... --dart-define=E2E_PASSWORD=...
```
