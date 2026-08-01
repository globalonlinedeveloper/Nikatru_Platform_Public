import 'package:flutter/material.dart';
import 'package:nikatru_auth_supabase/nikatru_auth_supabase.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:nikatru_platform_storage/nikatru_platform_storage.dart';
import 'package:nikatru_telemetry/nikatru_telemetry.dart';

import 'app.dart';
import 'core/app_config.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // Telemetry chassis: no DSN -> NoOp client (appRunner runs directly);
  // a GLITCHTIP_DSN via --dart-define enables GlitchTip/Sentry with PII
  // scrubbing. sentry_flutter is isolated inside packages/telemetry.
  const TelemetryConfig config = TelemetryConfig(
    dsn: String.fromEnvironment('GLITCHTIP_DSN'),
    release: 'probe@0.1.0',
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

      runApp(const ProviderScope(child: {{app_id.pascalCase()}}App()));
    },
  );
}
