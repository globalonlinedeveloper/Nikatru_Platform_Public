// Tests for [TelemetryConfig]'s `dist` — the build VARIANT that travels beside
// `release`.
//
// 🔴 WHY THE EMPTY CASE IS THE IMPORTANT ONE. `dist` was added on 2026-09-03 so
// a web crash could be resolved against an uploaded source map, and the whole
// value of the field is that it either says something true or says nothing.
// `TelemetryBootstrap.init` sets `options.dist` ONLY when this string is
// non-empty, because an EMPTY dist is not "no dist" — it is a dist value that
// matches no uploaded bundle, which is strictly worse than sending none. That
// branch is what these tests pin: the default must stay empty, and a declared
// value must survive verbatim.
//
// The `options.dist` assignment itself is not asserted here. `SentryFlutter.init`
// is a one-shot global initializer that starts a real SDK, and a test that drove
// it would leave a live client behind for every other test in this package —
// the same reason `telemetry_bootstrap_test.dart` drives `scrubEvent` directly
// instead of going through `init`. What is testable without that is the value
// the bootstrap reads, and its emptiness is the whole condition.
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_telemetry/nikatru_telemetry.dart';

void main() {
  group('TelemetryConfig.dist', () {
    test('defaults to empty, so nothing is claimed by omission', () {
      const config = TelemetryConfig(
        dsn: 'https://key@glitchtip.example.invalid/1',
        release: 'subly@1.2.3+abc1234',
        environment: 'production',
      );

      expect(config.dist, isEmpty);
    });

    test('carries a declared channel verbatim', () {
      const config = TelemetryConfig(
        dsn: 'https://key@glitchtip.example.invalid/1',
        release: 'subly@1.2.3+abc1234',
        environment: 'production',
        dist: 'web',
      );

      expect(config.dist, 'web');
    });

    test('is independent of the fields it travels beside', () {
      const config = TelemetryConfig(
        dsn: 'https://key@glitchtip.example.invalid/1',
        release: 'subly@1.2.3+abc1234',
        environment: 'production',
        dist: 'windows-store',
      );

      expect(config.release, 'subly@1.2.3+abc1234');
      expect(config.environment, 'production');
      expect(config.dist, 'windows-store');
      expect(config.enabled, isTrue);
    });

    test('an empty DSN still disables telemetry, dist or no dist', () {
      const config = TelemetryConfig(
        dsn: '',
        release: 'subly@1.2.3+abc1234',
        environment: 'production',
        dist: 'web',
      );

      expect(config.enabled, isFalse);
    });
  });
}
