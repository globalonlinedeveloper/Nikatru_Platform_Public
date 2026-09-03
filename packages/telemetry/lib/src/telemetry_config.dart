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
    this.dist = '',
    this.tracesSampleRate = 0.01,
  });

  /// GlitchTip/Sentry DSN. An empty string disables telemetry entirely.
  final String dsn;

  /// Release identifier, e.g. `app@1.2.3+45`.
  final String release;

  /// Deployment environment, e.g. `prod`, `staging`, `dev`.
  final String environment;

  /// Build VARIANT of [release] — the second half of the key a symbol or
  /// source-map lookup is stored under, and the reason a minified web stack
  /// trace can be read at all.
  ///
  /// 🔴 THIS WAS UNSET EVERYWHERE UNTIL 2026-09-03, AND THE COST WAS MEASURED,
  /// NOT SUSPECTED. GlitchTip held twelve releases for project `subly` and
  /// `GET /api/0/organizations/nikatru/releases/{version}/files/` answered 200
  /// with a ZERO-LENGTH list for every one of them, so two open, unresolved
  /// production issues — `minified:a0X: GoError: There is nothing to pop`
  /// (4 occurrences, level fatal) and `minified:ng: AuthException(...)` —
  /// carried frames reading `main.dart.js k7.er 63099`. Uploading the maps is
  /// only half of the repair: the server looks an artifact up by
  /// (release, dist), so an event that omits `dist` cannot match a bundle that
  /// was uploaded with one.
  ///
  /// ⚠️ IT MUST EQUAL THE `--dist` THE UPLOAD PASSED, byte for byte. The apps
  /// pass `AppConfig.releaseChannel` — the compile-time `RELEASE_CHANNEL`
  /// define — because that is exactly what a dist IS: the same commit built for
  /// `web` and for `windows-store` differs in nothing else, and every value it
  /// can take already resolves to a row in `tooling/channel-register.json`,
  /// which `assert-channel-register.mjs` enforces on every stamp a workflow
  /// passes. `.github/workflows/deploy-web.yml` uploads with `--dist web`
  /// beside the `--dart-define=RELEASE_CHANNEL=web` that produces this value.
  ///
  /// Empty is the honest default and it means "no variant declared": the SDK
  /// then sends no `dist` at all, rather than an empty one the server would
  /// try to match.
  final String dist;

  /// Fraction of transactions sampled for performance tracing (0.0 to 1.0).
  final double tracesSampleRate;

  /// Telemetry is enabled only when a DSN is present.
  bool get enabled => dsn.isNotEmpty;
}
