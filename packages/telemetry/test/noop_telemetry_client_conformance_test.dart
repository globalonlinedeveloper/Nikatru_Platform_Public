import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_telemetry/src/noop_telemetry_client.dart';
import 'package:nikatru_telemetry/testing.dart';

// The `noop` adapter of tooling/ports/telemetry.json — NoOpTelemetryClient, the
// client an empty DSN selects (TelemetryBootstrap.clientFor). Its contract under
// every scenario is the same: every call returns, nothing throws, and NOTHING
// reaches the wire. The runner checks the fake transport stayed empty.

void main() {
  runTelemetryClientConformance(
    'noop',
    TelemetryConformanceFixture(
      start: (transport, config, rateLimit) async => const NoOpTelemetryClient(),
      stop: () async {},
      expectations: const <TelemetryScenario, TelemetryExpectation>{
        TelemetryScenario.validEnvelope: TelemetryExpectation.deliversNothing,
        TelemetryScenario.piiScrubbed: TelemetryExpectation.deliversNothing,
        TelemetryScenario.releaseStamped: TelemetryExpectation.deliversNothing,
        TelemetryScenario.failsOpen: TelemetryExpectation.deliversNothing,
        TelemetryScenario.rateBounded: TelemetryExpectation.deliversNothing,
      },
    ),
    test: test,
  );
}
