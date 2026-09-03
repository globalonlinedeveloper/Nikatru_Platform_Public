// Subly's entry point: the stamped chassis init sequence, with the live [13]T-9
// tap-observer registration kept intact. The ORDER of everything inside
// `appRunner` is load-bearing — each step below says why.
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:nikatru_auth_supabase/nikatru_auth_supabase.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_design_system/nikatru_design_system.dart';
import 'package:nikatru_notifications/nikatru_notifications.dart';
import 'package:nikatru_platform_storage/nikatru_platform_storage.dart';
import 'package:nikatru_telemetry/nikatru_telemetry.dart';

import 'app.dart';
import 'core/app_config.dart';
import 'services/notifications/notification_service.dart';
import 'state/providers.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // [pipeline K-10/K-11] The licences of assets that ship in the bundle but that
  // Flutter's NOTICES collector never sees — today, the CC BY 4.0 Material Icons
  // font, which arrives from the SDK artifact cache rather than as a Dart
  // package. Measured: the shipped NOTICES had ZERO hits for its licence, so the
  // font was being distributed with its attribution condition unmet, and an
  // unmet CC BY condition means the licence does not apply.
  //
  // Registered BEFORE `runApp` because `LicenseRegistry` is read lazily by
  // `LicensePage` — the surface Settings offers — and a registration that lands
  // after a user has already opened that page shows them an incomplete list.
  // It is idempotent, so the stamped chassis calling it too is harmless.
  registerVendoredAssetLicences();

  // [pipeline C-2] Telemetry chassis. Until this landed, the ONLY app in
  // production had NO crash reporting: the package existed, was tested, and was
  // declared by the brick and by nothing that ships — so if Subly broke for a
  // real user, nobody would ever find out.
  //
  // No DSN => NoOp client and appRunner runs directly, so demo builds and tests
  // are unaffected. A GLITCHTIP_DSN via --dart-define enables GlitchTip with PII
  // scrubbing. `sentry_flutter` stays isolated inside packages/telemetry and must
  // never be imported anywhere else.
  //
  // `release` is AppConfig.telemetryRelease — `<this app's id>@<this build's
  // version>` — and NOT a literal. A literal here is right for at most one of
  // fifty apps: the brick's line used to carry the CI throwaway probe's own id
  // and a frozen 0.1.0, which every stamped app then reported to the ONE shared
  // GlitchTip project as though the crash were the probe's.
  //
  // It used to interpolate `'subly@${AppConfig.appVersion}'` here. The emitted
  // STRING is identical (AppConfig.appId == 'subly'); what the composed constant
  // buys is that it can no longer drift from the id when this app is re-stamped
  // or cloned.
  const TelemetryConfig telemetry = TelemetryConfig(
    dsn: String.fromEnvironment('GLITCHTIP_DSN'),
    release: AppConfig.telemetryRelease,
    environment: String.fromEnvironment('APP_ENV', defaultValue: 'dev'),
    // The build VARIANT the crash sink keys a source-map lookup on, together
    // with `release`. It is `AppConfig.releaseChannel` and not a literal for
    // the same reason `release` is not: the channel is a fact about THIS
    // artifact, every value it can take resolves to a row in
    // `tooling/channel-register.json`, and the lane that uploads the maps
    // (`deploy-web.yml`) passes the identical string to `--dist`. A build with
    // no channel stamped reports none, and the SDK then sends no `dist` at all.
    dist: AppConfig.releaseChannel,
  );

  await TelemetryBootstrap.init(
    telemetry,
    appRunner: () async {
      // [pipeline C-13] Replace Flutter's default build-error widget before the
      // first frame. The default is the grey/yellow box in release and the red
      // screen in debug; shipping either to a user looks like a broken app and
      // leaks widget internals. One line at startup, impossible to retrofit
      // across fifty shipped apps.
      //
      // The copy is the design system's own last-resort fallback: this runs
      // before any BuildContext exists, so there is no Localizations to read,
      // and an error during the FIRST build is exactly what this covers.
      //
      // 🔴 IT MUST STAY FIRST INSIDE `appRunner`. Everything below can throw —
      // a plugin channel, a timezone database, a Supabase handshake — and the
      // error widget is what the user sees if one of them does during the first
      // build. Installing it after the thing it protects is installing it too
      // late.
      AppErrorScreen.install();

      // Local notifications work on all six platforms (web falls back to a
      // no-op). Subly's own fork, which owns every OUTBOUND call this app makes
      // (renewal reminders, the weekly digest).
      await NotificationService.instance.init();

      // [13]T-9 THE INBOUND HALF, AND THE ORDER IS LOAD-BEARING.
      //
      // `FlutterLocalNotificationsPlugin()` is a process singleton (its
      // constructor is a `factory` returning a static instance), so the fork
      // above and the shared adapter below drive the SAME plugin, and the LAST
      // `initialize` call is the one whose `onDidReceiveNotificationResponse`
      // survives. The fork registers no tap callback; this one does. Initialise
      // it second and every notification Subly posts — including the fork's own
      // renewal reminders — becomes tappable. Swap the two lines and taps go
      // silently nowhere, which is the state this increment ends.
      //
      // The settings are a superset, not a conflict: both pass the same
      // launcher icon, the same Darwin defaults and the same Linux
      // `defaultActionName`, so the second call adds the callback and changes
      // nothing else. [2]C-3's de-forking removes the duplication entirely.
      final core.NotificationService taps = createLocalNotificationService();
      await taps.init();

      // 🔴 [pipeline C-15 / G-43] (absent from origins.lock.json by construction — G-43 is a MASTER_PLAN §3 chassis-gap id, a different register from the pipeline ids; see Private/MASTER_PLAN.md) IDENTITY, BEFORE THE FIRST FRAME — and this
      // call is the only thing that makes the identity --dart-defines work.
      //
      // Nothing in the brick used to initialise the SDK at all, while
      // `authRepositoryProvider` returns the real `SupabaseAuthRepository` the
      // moment SUPABASE_URL/SUPABASE_ANON_KEY are supplied. The router resolves
      // that provider through `refreshListenable` while it is being built, so
      // the app died at LAUNCH on `Supabase.instance` (AssertionError in debug,
      // LateInitializationError in release), before a screen rendered. It was
      // invisible to every test because widget tests take no --dart-defines.
      //
      // It goes through `initNikatruAuth` rather than `Supabase.initialize`
      // because that function is what passes the SecureStore-backed session
      // storage: the SDK's default writes the access AND **refresh** tokens as
      // PLAINTEXT — a JSON file on Windows/Linux, a plist on iOS/macOS, an XML
      // file on Android. A refresh token is a long-lived key to mint new access
      // tokens, so leaking it is closer to leaking a password than a cookie.
      // `initNikatruAuth` routes the session through `SecureSessionStorage` →
      // DPAPI / Keychain / KeyStore / libsecret. An app may not import
      // `package:supabase_flutter` directly either — assert-package-boundaries
      // fails the build for it — so this is also the only legal path.
      //
      // 🔴 THE PREDICATE IS `isBackendLive`, AND IT IS THE SAME ONE
      // `authRepositoryProvider` SELECTS ON. That is the whole point of naming
      // it here: this `if` decides whether the Supabase SDK is initialised, and
      // that provider decides whether anything USES it. While the two disagreed
      // — this line on `isBackendLive`, the provider on `isSupabaseConfigured`
      // alone — a build carrying the Supabase defines but no API_BASE_URL
      // resolved a live `SupabaseAuthRepository` against an uninitialised SDK
      // and died at launch on `Supabase.instance`, because the router reads that
      // provider through `refreshListenable` while it is being built. One
      // decision, one predicate: `isSupabaseConfigured && isApiConfigured`.
      if (AppConfig.isBackendLive) {
        await initNikatruAuth(
          url: AppConfig.supabaseUrl,
          // Same string the define still calls SUPABASE_ANON_KEY; the SDK
          // renamed the parameter, which is why the deprecation is now gone.
          publishableKey: AppConfig.supabaseAnonKey,
          // Keychain / KeyStore / DPAPI / libsecret. On web there is no OS
          // keychain a page can reach, so this degrades to ordinary web storage
          // — stated in SecureSessionStorage rather than papered over.
          secureStore: FlutterSecureStore(),
        );
      }

      runApp(
        ProviderScope(
          overrides: <Override>[
            // The INITIALISED instance, not a fresh one — taps are delivered on
            // this object's own stream, so overriding with anything else gives
            // the app a stream that is silent forever. See
            // notificationTapSourceProvider.
            notificationTapSourceProvider.overrideWithValue(taps),

            // 🔴 P2.6a — THE SECOND OVERRIDE IS NEW, AND WITHOUT IT [13]T-9
            // DIES SILENTLY THE MOMENT THE CHASSIS SPINE LANDS.
            //
            // The merged providers.dart carries the stamp's
            // `notificationServiceProvider`, whose default body is
            // `createLocalNotificationService()` — a SECOND adapter instance.
            // `RemindersEnabledController.resyncOnStart` reads it and calls
            // `svc.init()` from AnalyticsGate's post-frame callback, i.e. after
            // main() has finished. `LocalNotificationService._initialized` is
            // per-instance (local_notification_service_io.dart:74) and
            // `init()` does `_plugin.initialize(_taps.add)` with THAT
            // instance's own broadcast controller (:86-87, :100-113). The
            // plugin is a process singleton and the last `initialize` wins, so
            // that call re-points every future tap at a stream nobody listens
            // to. Nothing throws, nothing goes red, and `notification_opened`
            // silently returns to zero emitters — the exact defect [13]T-9 was
            // written to end.
            //
            // Overriding with the same object makes `resyncOnStart`'s
            // `svc.init()` an early return on the `_initialized` flag, so the
            // registration made above survives and the reminder repair path
            // still runs.
            notificationServiceProvider.overrideWithValue(taps),
          ],
          child: const SublyApp(),
        ),
      );
    },
  );
}
