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

## What a run expects — two derived facts, never a target name
`e2e.yml`'s `auth_target` input picks a SECRET SET: `production` (the default,
`SUPABASE_*`) or `selfhosted` (`SELFHOSTED_SUPABASE_*`, the GoTrue on Box C).
The step "Derive what this run expects" (`derive_expectation.mjs`) then reads
the chosen `SUPABASE_URL` and `tooling/platform-register.json` and writes two
facts to `$GITHUB_ENV` (2026-09-25; `E2E_AUTH_TARGET` is retired):

| fact | value | decides |
|---|---|---|
| `E2E_STACK` | `hosted` when the URL is a `https://<ref>.supabase.co` origin, else `selfhosted` | the captcha posture (`captcha_posture.mjs`; the wrong-password copy in `app_test.dart`) |
| `E2E_WORKERS_TRUST` | `yes` when the URL's origin is the register's `vars.SUPABASE_URL`, else `no` | everything behind the Worker (`assert_one_issuer.mjs`, the three verifiers, and whether `app_test.dart` walks the app) |

The Phase 5 cutover rotates the repo secrets before the switch commit moves
`vars.SUPABASE_URL`, and these two facts follow each step with no e2e edit.
The same read has opposite correct answers under the two trust values, so each
verifier asserts the outcome for ITS value and never skips:

| verifier | `E2E_WORKERS_TRUST=yes` expects | `E2E_WORKERS_TRUST=no` expects |
|---|---|---|
| `verify_row.mjs` | at least 1 subscription row | **exactly 0** rows — a row means the Worker accepted a token from an issuer it does not trust (exit 1, a security finding) |
| `verify_purged.mjs` | identity **gone** (404), 0 rows | identity **still resolves** on the run's stack (2xx naming this user), 0 rows — the delete leg stops at the one-issuer refusal |
| `verify_consent.mjs` | the granted=0 artifact | **the same** artifact — the consent route is unauthenticated and the suite answers the prompt before sign-in |

An unset or unknown `E2E_STACK` or `E2E_WORKERS_TRUST` is exit 2, "could not
decide what to expect", before any request — never a default. With trust `no` a
count D1 did not answer is exit 2, never 0. The derivation, the expectations and
every verdict line live in `auth_target_expectation.mjs` (imported, never run as
a step); `tooling/ci/test/e2e-verify-target.test.mjs` pins the trusted lines
byte for byte and holds the red controls. To run a verifier by hand, set
`E2E_WORKERS_TRUST=yes` or `no` (and `E2E_STACK` for the two probes) alongside
its other env vars.

## Secrets it needs (GitHub → Settings → Secrets and variables → Actions)
| Secret | Notes |
|---|---|
| `SUPABASE_URL` | already set (web deploy) |
| `SUPABASE_ANON_KEY` | already set (publishable key) |
| `API_BASE_URL` | already set (`https://subscriptiontracker-api.nikatru.com`) |
| `CLOUDFLARE_ACCOUNT_ID` | already set |
| `CLOUDFLARE_API_TOKEN` | already set — **must include D1 read+write** |
| `SUPABASE_SERVICE_ROLE_KEY` | **NEW** — add to enable the job |

`auth_target=selfhosted` reads `SELFHOSTED_SUPABASE_URL`,
`SELFHOSTED_SUPABASE_ANON_KEY` and `SELFHOSTED_SUPABASE_SERVICE_ROLE_KEY` in
place of the three `SUPABASE_*` secrets, and is refused on `main`. If a secret
the chosen target needs is absent, the preflight FAILS the run — it does not
skip.

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
  --dart-define=E2E_EMAIL=... --dart-define=E2E_PASSWORD=... \
  --dart-define=E2E_EXPECT_CAPTCHA_GATE=no --dart-define=E2E_EXPECT_WORKERS_TRUST=yes
```
The two `E2E_EXPECT_*` defines are REQUIRED (`yes` or `no`, no default); the
values above are the hosted project while the Workers trust it.
