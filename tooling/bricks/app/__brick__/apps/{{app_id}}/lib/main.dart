import 'package:flutter/material.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:nikatru_telemetry/nikatru_telemetry.dart';

import 'app.dart';

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

      runApp(const ProviderScope(child: {{app_id.pascalCase()}}App()));
    },
  );
}
