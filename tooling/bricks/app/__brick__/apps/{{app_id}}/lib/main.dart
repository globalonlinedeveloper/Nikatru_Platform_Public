import 'package:nikatru_auth_supabase/nikatru_auth_supabase.dart';
import 'package:nikatru_chassis_screens/shell/bootstrap.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart';
import 'package:nikatru_notifications/nikatru_notifications.dart';
import 'package:nikatru_platform_storage/nikatru_platform_storage.dart';
import 'package:nikatru_telemetry/nikatru_telemetry.dart';

import 'app.dart';
import 'core/app_config.dart';
import 'core/windows_notification_identity.g.dart';
import 'state/providers.dart';

/// 🏗️ THE BOOT ORDER IS IN `package:nikatru_chassis_screens/shell/bootstrap.dart`
/// ([ADR 067] decision 2). [bootstrapNikatru] owns the sequence and the reason
/// for each step; this file supplies the four things a package that declares no
/// third-party dependency cannot carry, and nothing else.
Future<void> main() async {
  // `release` is AppConfig.telemetryRelease — `<this app's id>@<this build's
  // version>` — and NOT a literal. A literal here is right for at most one of
  // fifty apps: this line used to carry the CI throwaway probe's own id and a
  // frozen 0.1.0, which every stamped app then reported to the ONE shared
  // GlitchTip project as though the crash were the probe's.
  const TelemetryConfig config = TelemetryConfig(
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

  // ONE adapter, init()ed by bootstrapNikatru (its step 4); ST-R4 identity.
  final core.NotificationService notifications = createLocalNotificationService(
    windows: kWindowsNotificationIdentity,
  );

  final TelemetryClient sink = TelemetryBootstrap.clientFor(config);
  await bootstrapNikatru(
    releaseChannel: AppConfig.releaseChannel, // step 3½: root + signer check
    integrityProbe: platformDeviceIntegrityProbe(),
    recordIntegrity: integrityRecorder(sink.addBreadcrumb, sink.captureMessage),
    notifications: notifications,
    runGuarded: (Future<void> Function() appRunner) =>
        TelemetryBootstrap.init(config, appRunner: appRunner),
    initialiseIdentity: () async {
      // It goes through `initNikatruAuth` rather than `Supabase.initialize`
      // because that function is what passes the SecureStore-backed session
      // storage: the SDK's default writes the access AND refresh tokens as
      // PLAINTEXT (XML on Android, plist on iOS/macOS, a JSON file on desktop).
      // An app may not import `package:supabase_flutter` directly either —
      // assert-package-boundaries.mjs fails the build for it — so this is also
      // the only legal path.
      if (AppConfig.isBackendLive) {
        await initNikatruAuth(
          url: AppConfig.authEndpoint,
          publishableKey: AppConfig.authPublicKey,
          // Keychain / KeyStore / DPAPI / libsecret. On web there is no OS
          // keychain a page can reach, so this degrades to ordinary web storage
          // — stated in SecureSessionStorage rather than papered over.
          secureStore: FlutterSecureStore(),
        );
      }
    },
    run: () => runApp(
      ProviderScope(
        // Riverpod 3.0 retries a failing provider by default (exponential backoff).
        // Off, deliberately: every failure path in this app already has its own
        // answer (a retry button, a fallback, a sign-in), and a silent retry would
        // hold an error screen in "loading" and double every failing network call.
        retry: (int retryCount, Object error) => null,
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
    ),
  );
}
