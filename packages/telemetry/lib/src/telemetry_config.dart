/// Immutable runtime configuration for telemetry.
///
/// All values come from the app's runtime CFG (environment / remote config).
/// Never hardcode a DSN or release in source and never commit one to the repo.
class TelemetryConfig {
  /// Creates a telemetry configuration.
  const TelemetryConfig({
    required this.dsn,
    required this.release,
    required this.environment,
    this.tracesSampleRate = 0.01,
  });

  /// GlitchTip/Sentry DSN. An empty string disables telemetry entirely.
  final String dsn;

  /// Release identifier, e.g. `app@1.2.3+45`.
  final String release;

  /// Deployment environment, e.g. `prod`, `staging`, `dev`.
  final String environment;

  /// Fraction of transactions sampled for performance tracing (0.0 to 1.0).
  final double tracesSampleRate;

  /// Telemetry is enabled only when a DSN is present.
  bool get enabled => dsn.isNotEmpty;
}
