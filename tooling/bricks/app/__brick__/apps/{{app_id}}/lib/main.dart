import 'package:flutter/material.dart';
import 'package:nikatru_auth_supabase/nikatru_auth_supabase.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_design_system/nikatru_design_system.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:nikatru_notifications/nikatru_notifications.dart';
import 'package:nikatru_platform_storage/nikatru_platform_storage.dart';
import 'package:nikatru_telemetry/nikatru_telemetry.dart';

import 'app.dart';
import 'core/app_config.dart';
import 'state/providers.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // Telemetry chassis: no DSN -> NoOp client (appRunner runs directly);
  // a GLITCHTIP_DSN via --dart-define enables GlitchTip/Sentry with PII
  // scrubbing. sentry_flutter is isolated inside packages/telemetry.
  //
  // `release` is AppConfig.telemetryRelease — `<this app's id>@<this build's
  // version>` — and NOT a literal. A literal here is right for at most one of
  // fifty apps: this line used to carry the CI throwaway probe's own id and a
  // frozen 0.1.0, which every stamped app then reported to the ONE shared
  // GlitchTip project as though the crash were the probe's.
  const TelemetryConfig config = TelemetryConfig(
    dsn: String.fromEnvironment('GLITCHTIP_DSN'),
    release: AppConfig.telemetryRelease,
    environment: String.fromEnvironment('APP_ENV', defaultValue: 'dev'),
  );

  await TelemetryBootstrap.init(
    config,
    appRunner: () async {
      // [pipeline C-13] Replace Flutter's default build-error widget before the
      // first frame. The default is the grey/yellow box in release and the red
      // screen in debug; shipping either to a user looks like a broken app and
      // leaks widget internals. One line at startup, impossible to retrofit across
      // fifty shipped apps.
      //
      // The copy is the design system's own last-resort fallback: this runs
      // before any BuildContext exists, so there is no Localizations to read,
      // and an error during the FIRST build is exactly what this covers. See
      // AppErrorScreen.fallbackTitle for why it cannot come from the app's ARB.
      AppErrorScreen.install();

      // 🔴 [13]T-9 THE INBOUND HALF, AND THE ORDER IS LOAD-BEARING.
      //
      // ONE adapter, constructed once and `init()`ed once, HERE — before the
      // first frame — and then handed to the tree as an override. Three things
      // make that the whole wiring rather than a tidy-up:
      //
      //  1. `init()` is where the plugin's tap callback is registered
      //     (`_plugin.initialize(_taps.add)`), and the taps are delivered on
      //     THAT instance's own broadcast stream. A second instance — which is
      //     exactly what `notificationServiceProvider`'s default body,
      //     `createLocalNotificationService()`, builds — exposes a stream that is
      //     silent forever. Working code, no error, no tap.
      //  2. `FlutterLocalNotificationsPlugin()` is a process singleton, so the
      //     LAST `initialize` call is the one whose callback survives. Doing it
      //     here and overriding the provider means the reminder rail's own
      //     `svc.init()` (RemindersEnabledController.resyncOnStart, from
      //     AnalyticsGate's post-frame callback) hits `_initialized` and returns
      //     early instead of re-pointing every future tap at a stream nobody
      //     listens to.
      //  3. A cold start FROM a notification is the case that cannot be fixed
      //     later: the OS delivers it at launch, so the registration has to
      //     already exist. A post-frame `init()` is too late by a frame.
      //
      // ⚠️ IT MUST NOT ASK FOR PERMISSION, and it does not: `init()` loads the
      // timezone database and registers the callback, nothing else. The ask
      // stays on the enable path (`applyReminderChoice`), because Android 13+
      // turns a SECOND denial into USER_FIXED — permanently non-promptable — so
      // a launch-time prompt can burn the channel for the life of the install.
      // `tooling/ci/assert-stamp-properties.mjs` walks this boot path and fails
      // the build if an ask ever appears on it.
      final core.NotificationService notifications =
          createLocalNotificationService();
      await notifications.init();

      // 🔴 [pipeline C-15 / G-43] IDENTITY, BEFORE THE FIRST FRAME — and this
      // call is the only thing that makes the identity --dart-defines work.
      //
      // Nothing in the brick used to initialise the SDK at all, while
      // `authRepositoryProvider` returns the real `SupabaseAuthRepository` the
      // moment SUPABASE_URL/SUPABASE_ANON_KEY are supplied — the exact
      // configuration the stamped README tells the owner to use. The router
      // resolves that provider through `refreshListenable` while it is being
      // built, so the app died at LAUNCH on `Supabase.instance` (AssertionError
      // in debug, LateInitializationError in release), before a screen rendered.
      // It was invisible to every test because widget tests take no
      // --dart-defines, so `isBackendLive` is false and the in-memory
      // implementation is used.
      //
      // It goes through `initNikatruAuth` rather than `Supabase.initialize`
      // because that function is what passes the SecureStore-backed session
      // storage: the SDK's default writes the access AND refresh tokens as
      // PLAINTEXT (XML on Android, plist on iOS/macOS, a JSON file on desktop).
      // An app may not import `package:supabase_flutter` directly either —
      // assert-package-boundaries.mjs fails the build for it — so this is also
      // the only legal path.
      if (AppConfig.isBackendLive) {
        await initNikatruAuth(
          url: AppConfig.supabaseUrl,
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
            // THE INITIALISED INSTANCE, not a fresh one. The tap stream belongs
            // to the object that registered with the OS; overriding with
            // anything else — or not overriding at all — gives the app a
            // `notificationTaps()` that is silent for the life of the process,
            // and gives the reminder rail a second plugin registration that
            // silently wins. ONE provider on purpose: the chassis has a single
            // notification seam, so the tap source and the schedule target are
            // the same object and cannot drift apart.
            notificationServiceProvider.overrideWithValue(notifications),
          ],
          child: const {{app_id.pascalCase()}}App(),
        ),
      );
    },
  );
}
