import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_telemetry/src/pii_scrubber.dart';
import 'package:nikatru_telemetry/src/sentry_telemetry_client.dart';
import 'package:nikatru_telemetry/src/telemetry_bootstrap.dart';
import 'package:nikatru_telemetry/src/telemetry_rate_bound.dart';
import 'package:nikatru_telemetry/testing.dart';
import 'package:sentry_flutter/sentry_flutter.dart';

// The `sentry` adapter of tooling/ports/telemetry.json — SentryTelemetryClient —
// over the conformance suite (lib/testing.dart), with the SDK initialised
// through TelemetryBootstrap.configureCore: the SAME DSN/release/environment
// stamping, PII scrub and rate bound every app gets, sending through the fake
// transport instead of the network.
//
// 🔴 RED CONTROL (recorded in the port-telemetry PR): make PiiScrubber's e-mail
// rule match nothing and the `piiScrubbed` case fails, naming the email sample.

TelemetryConformanceFixture _sentryFixture() => TelemetryConformanceFixture(
      start: (transport, config, rateLimit) async {
        await Sentry.init((options) {
          TelemetryBootstrap.configureCore(
            options,
            config,
            rateBound: TelemetryRateBound(maxEvents: rateLimit),
          );
          options
            ..debug = false
            ..transport = transport;
        });
        return const SentryTelemetryClient();
      },
      stop: Sentry.close,
      expectations: const <TelemetryScenario, TelemetryExpectation>{
        TelemetryScenario.validEnvelope: TelemetryExpectation.delivers,
        TelemetryScenario.piiScrubbed: TelemetryExpectation.delivers,
        TelemetryScenario.releaseStamped: TelemetryExpectation.delivers,
        TelemetryScenario.failsOpen: TelemetryExpectation.delivers,
        TelemetryScenario.rateBounded: TelemetryExpectation.delivers,
      },
    );

void main() {
  runTelemetryClientConformance('sentry', _sentryFixture(), test: test);

  group('the suite itself', () {
    test('a fixture missing a scenario is refused before anything runs', () {
      final full = _sentryFixture();
      final partial = TelemetryConformanceFixture(
        start: full.start,
        stop: full.stop,
        expectations: Map<TelemetryScenario, TelemetryExpectation>.of(
          full.expectations,
        )..remove(TelemetryScenario.rateBounded),
      );
      expect(
        () => runTelemetryClientConformance('partial', partial, test: test),
        throwsA(isA<StateError>().having(
          (e) => e.message,
          'message',
          contains('rateBounded'),
        )),
      );
    });

    test('every PII sample is one the scrubber redacts, so the suite tests it',
        () {
      const scrubber = PiiScrubber();
      for (final entry in telemetryPiiSamples.entries) {
        expect(scrubber.scrubText(entry.value), redactedToken,
            reason: 'the ${entry.key} sample is not wholly redacted');
      }
    });
  });

  group('TelemetryRateBound', () {
    test('admits maxEvents per window, drops the rest, and slides', () {
      var now = DateTime.utc(2026, 10);
      final bound = TelemetryRateBound(
        maxEvents: 2,
        window: const Duration(minutes: 1),
        now: () => now,
      );
      expect(bound.tryAcquire(), isTrue);
      expect(bound.tryAcquire(), isTrue);
      expect(bound.tryAcquire(), isFalse);
      expect(bound.dropped, 1);
      now = now.add(const Duration(seconds: 59));
      expect(bound.tryAcquire(), isFalse);
      now = now.add(const Duration(seconds: 1));
      expect(bound.tryAcquire(), isTrue,
          reason: 'a minute after the first event, its slot is free again');
    });

    test('the bootstrap hook drops an event over the bound instead of sending it',
        () async {
      final options = SentryOptions();
      TelemetryBootstrap.configureCore(
        options,
        telemetryConformanceConfig,
        rateBound: TelemetryRateBound(maxEvents: 1),
      );
      final first = await options.beforeSend!(SentryEvent(), Hint());
      final second = await options.beforeSend!(SentryEvent(), Hint());
      expect(first, isNotNull);
      expect(second, isNull);
    });
  });
}
