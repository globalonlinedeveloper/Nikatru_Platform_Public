import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:nikatru_telemetry/nikatru_telemetry.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

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
      if (AppConfig.isSupabaseConfigured) {
        await Supabase.initialize(
          url: AppConfig.supabaseUrl,
          // anonKey is the publishable client key; deprecated alias in newer SDKs.
          // ignore: deprecated_member_use
          anonKey: AppConfig.supabaseAnonKey,
        );
      }

      runApp(const ProviderScope(child: SublyApp()));
    },
  );
}
