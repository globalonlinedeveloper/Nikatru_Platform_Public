import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:nikatru_auth_supabase/nikatru_auth_supabase.dart';
import 'package:nikatru_platform_storage/nikatru_platform_storage.dart';
import 'package:nikatru_telemetry/nikatru_telemetry.dart';

import 'app.dart';
import 'core/config/app_config.dart';
import 'services/notifications/notification_service.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // [pipeline C-2] Telemetry chassis, mirroring the brick template's main.dart.
  // Until this landed, the ONLY app in production had NO crash reporting: the
  // package existed, was tested, and was declared by the brick and by nothing
  // that ships — so if Subly broke for a real user, nobody would ever find out.
  //
  // No DSN => NoOp client and appRunner runs directly, so demo builds and tests
  // are unaffected. A GLITCHTIP_DSN via --dart-define enables GlitchTip with PII
  // scrubbing. `sentry_flutter` stays isolated inside packages/telemetry and must
  // never be imported anywhere else.
  const TelemetryConfig telemetry = TelemetryConfig(
    dsn: String.fromEnvironment('GLITCHTIP_DSN'),
    release: 'subly@${AppConfig.appVersion}',
    environment: String.fromEnvironment('APP_ENV', defaultValue: 'dev'),
  );

  await TelemetryBootstrap.init(
    telemetry,
    appRunner: () async {
      // Local notifications work on all six platforms (web falls back to a no-op).
      await NotificationService.instance.init();

      // Only initialize Supabase when real credentials are supplied via
      // --dart-define. Left unconfigured, the app runs in demo mode with a mock
      // auth repository.
      //
      // 🔴 [G-43] THROUGH `initNikatruAuth`, NOT `Supabase.initialize`, AND THAT
      // IS A SECURITY FIX, NOT A REFACTOR. The bare `Supabase.initialize` this
      // replaces passed no `authOptions`, so the SDK fell back to
      // `SharedPreferencesLocalStorage` and wrote the access AND **refresh**
      // tokens as PLAINTEXT — a JSON file on Windows/Linux, a plist on
      // iOS/macOS, an XML file on Android. A refresh token is a long-lived key
      // to mint new access tokens, so leaking it is closer to leaking a password
      // than a cookie. `initNikatruAuth` routes the session through
      // `SecureSessionStorage` → DPAPI / Keychain / KeyStore / libsecret.
      //
      // ⚠️ DATED DECLARED EXCEPTION (2026-08-01) to 39-CHASSIS cut 1, which
      // freezes Subly as a legacy rail-prover receiving exactly three things.
      // This is not a fourth chassis feature: it is the G-43 requirement the
      // written record already claims Subly meets, and the trigger is the
      // Windows Store submission — the first DESKTOP binary is the first one
      // that writes that plaintext file to a real user's disk. The live web
      // surface is unchanged in substance (a browser has no OS keychain, so
      // SecureStore degrades to web storage there and says so). No behaviour
      // beyond session storage moves: same URL, same key, same flow.
      if (AppConfig.isSupabaseConfigured) {
        await initNikatruAuth(
          url: AppConfig.supabaseUrl,
          // Same string the define still calls SUPABASE_ANON_KEY; the SDK
          // renamed the parameter, which is why the deprecation is now gone.
          publishableKey: AppConfig.supabaseAnonKey,
          secureStore: FlutterSecureStore(),
        );
      }

      runApp(const ProviderScope(child: SublyApp()));
    },
  );
}
