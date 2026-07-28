/// GlitchTip/Sentry telemetry facade for NIKATRU apps.
///
/// App code depends only on `TelemetryClient` and `TelemetryBootstrap`;
/// `sentry_flutter` is intentionally isolated inside this package and must
/// never be imported anywhere else in the monorepo.
library;

export 'src/telemetry_capabilities.dart';
export 'src/noop_telemetry_client.dart';
export 'src/pii_scrubber.dart';
export 'src/sentry_telemetry_client.dart';
export 'src/telemetry_bootstrap.dart';
export 'src/telemetry_client.dart';
export 'src/telemetry_config.dart';
