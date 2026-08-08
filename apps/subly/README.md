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
cp config/subly.live.example.json config/subly.live.json   # already filled for Subly
flutter run --dart-define-from-file=config/subly.live.json
# any target: -d chrome | -d windows | -d macos | -d linux | <device>
```

`config/subly.live.json` (gitignored) carries the live values:

| Key | Value |
|---|---|
| `SUPABASE_URL` | `https://lcrkiurkvzhkonjwhpiv.supabase.co` (Cross_Platform_Auth, Mumbai) |
| `SUPABASE_ANON_KEY` | the project **publishable** key (`sb_publishable_…`) |
| `API_BASE_URL` | `https://api.nikatru.com` (Cloudflare Worker custom domain; `subly-api.rajasekarjavaee.workers.dev` still works as a fallback) |

When both Supabase and the API are set, `AppConfig.isBackendLive` is true and the app uses
real Supabase Auth + the live Worker/D1 instead of the mock+seed demo path. Values are passed
at build time only — nothing is committed. (Legacy anon JWT also works in the `SUPABASE_ANON_KEY`
slot if a pinned SDK rejects the publishable format.)

## Architecture (layers)

```
lib/
├── main.dart · app.dart              app entry (+ conditional Supabase.initialize)
├── core/
│   ├── config/app_config.dart        per-app identity + --dart-define config (no secrets)
│   ├── theme/                        colors + text styles from the design
│   ├── format/                       Currency (with demo FX) + SubMath derivations
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
