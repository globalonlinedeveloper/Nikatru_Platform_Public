/// GlitchTip/Sentry telemetry facade for NIKATRU apps.
///
/// App code depends only on `TelemetryConfig` and `TelemetryBootstrap`: it
/// builds one `TelemetryConfig` and hands it to `TelemetryBootstrap.init`, and
/// that is the whole surface. `apps/subly/lib/main.dart` and the app brick's
/// `main.dart` name no other symbol from this barrel, and both discard the
/// value `init` returns.
///
/// `TelemetryClient` is the INTERNAL seam, not an app dependency — the doc line
/// here used to claim app code depended on it, and a sweep of `apps/` and
/// `tooling/bricks/` found zero occurrences. It is the interface
/// `NoOpTelemetryClient` and `SentryTelemetryClient` implement and the type
/// `TelemetryBootstrap.init` returns, which is what makes the vendor swappable;
/// it is exported so a future caller CAN hold one, not because one does.
///
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
