# Subly — Flutter app (portfolio template)

One Flutter codebase → six platforms. Demo-runnable with zero backend; flips to Supabase Auth
+ a Cloudflare Worker when you supply `--dart-define` values.

## Run

```bash
flutter pub get
flutter run                # demo mode (mock auth + seed data)
# platforms: flutter run -d chrome | -d windows | -d macos | -d linux | <device>
```

### Live mode (Subly is provisioned)

The backend is live. Copy the example config to the gitignored real file and run against it:

```bash
cp config/defaults.example.json config/defaults.json   # already filled for Subly
flutter run --dart-define-from-file=config/defaults.json
# any target: -d chrome | -d windows | -d macos | -d linux | <device>
```

`config/defaults.json` (gitignored) carries the live values:

| Key | Value |
|---|---|
| `SUPABASE_URL` | `https://lcrkiurkvzhkonjwhpiv.supabase.co` (Cross_Platform_Auth, Mumbai) |
| `SUPABASE_ANON_KEY` | the project **publishable** key (`sb_publishable_…`) |
| `API_BASE_URL` | `https://api.nikatru.com` (Cloudflare Worker custom domain; `subly-api.rajasekarjavaee.workers.dev` still works as a fallback) |

🔴 **THE KEYS ARE `--dart-define` NAMES, NOT THE CFG-1 WIRE NAMES.** The chassis file this pair is
named after (`config/defaults.json` in a freshly stamped app) ships snake keys — `app_id`,
`api_base_url` — because it was drafted as a runtime-config document, and **nothing in any app reads
it**. `--dart-define-from-file` maps each JSON key to a define of exactly that name, so a file of
snake keys supplies `api_base_url` while `AppConfig` reads `API_BASE_URL`, and the app boots in
**demo mode looking configured**. Measured 2026-08-08 with a real `flutter test
--dart-define-from-file`: snake file ⇒ `API_BASE_URL=<UNSET>`. [ADR 037] P2.5 therefore adopted the
chassis **names** and kept Subly's **keys**.

When both Supabase and the API are set, `AppConfig.isBackendLive` is true and the app uses
real Supabase Auth + the live Worker/D1 instead of the mock+seed demo path. Values are passed
at build time only — nothing is committed. (Legacy anon JWT also works in the `SUPABASE_ANON_KEY`
slot if a pinned SDK rejects the publishable format.)

⚠️ **`AppConfig._phApiBase` is a SENTINEL, not the host.** It stays
`https://subly-api.YOUR_SUBDOMAIN.workers.dev`. `isApiConfigured` is `apiBaseUrl != _phApiBase`, so
writing the real `https://api.nikatru.com` into the constant makes that comparison false for exactly
the builds that pass the correct value — production would resolve `SeedApiClient()` and
`NoOpAnalytics`. `assert-store-build-config.mjs` cannot catch it; it checks that the define is
passed, and prints on every run that it cannot see values.

## Architecture (layers)

```
lib/
├── main.dart · app.dart              app entry (+ conditional Supabase.initialize)
├── core/
│   ├── app_config.dart               per-app identity + --dart-define config (moved P2.5, [ADR 037])
│   ├── theme/                        colors + text styles from the design
│   ├── format/                       Currency (re-symbols only, NO FX) + SubMath derivations
│   └── router.dart                   go_router: onboarding→login→scan→shell + overlays (moved P2.5, [ADR 037])
├── data/
│   ├── auth/                         AuthRepository (abstract) · Supabase · Mock
│   ├── api/                          ApiClient (abstract) · Dio (live) · Seed (demo)
│   ├── models/                       Subscription, BudgetInfo, Entitlement, …
│   ├── subscriptions/                SubscriptionRepository
│   └── seed/demo_data.dart           the design's 12 subscriptions
├── services/
│   ├── notifications/                flutter_local_notifications (zonedSchedule per renewal)
│   └── purchases/                    PurchasesService + RevenueCat stub
├── state/                            Riverpod providers + Async/Notifier controllers
└── features/                         onboarding · auth · scan · home · calendar · insights ·
                                      budget · settings · detail · notifications · add · cancel · shell
```

**Seams that make it a template:** `AuthRepository` and `ApiClient` are abstract. Demo mode
(mock + seed) is selected automatically when `AppConfig` is unconfigured; live mode (Supabase
+ Dio→Worker) switches on when it is. Swapping identity providers (e.g. to Firebase) is one
new `AuthRepository` implementation — nothing above `data/` changes.

## Notifications (cross-platform reminders)

`NotificationService` schedules a one-off reminder per renewal via `zonedSchedule`
(iOS/Android/macOS/Linux/Windows; web is a no-op). This is the **most version-sensitive
file** — it targets the `flutter_local_notifications` 17.x API. If `pub get` resolves a newer
major, re-check `zonedSchedule` params and add `WindowsInitializationSettings`. For exact
local-time firing, add `flutter_timezone` (noted inline).

## RevenueCat

`PurchasesService` is stubbed so the app builds with no native config. Entitlements are the
**server's** source of truth: RevenueCat's webhook writes the shared `(user_id, app_id)`
table and the app reads it via `ApiClient.getEntitlements()`. Wiring steps are at the bottom
of `services/purchases/purchases_service.dart`.

## Fonts

The design uses Manrope + Space Grotesk. Drop the `.ttf` files in `assets/fonts/` and
uncomment the `fonts:` block in `pubspec.yaml` to match exactly; otherwise the app falls back
to the platform font.
