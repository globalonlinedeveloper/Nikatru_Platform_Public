/// The telemetry port's conformance suite and its fake transport.
///
/// tooling/ports/README.md §3: each seam package exports `lib/testing.dart`
/// with the fake plus `run<Seam>Conformance`. tooling/ports/telemetry.json
/// names [runTelemetryClientConformance] as the port's runner; every adapter's
/// test CALLS it (assert-ports limb 6 matches the call, not an import).
///
/// 🔴 NO TEST PACKAGE IS IMPORTED HERE. This is a `lib/` file, and
/// `flutter_test` is only a dev dependency of this package, so the runner takes
/// the caller's `test` function as an argument and fails a scenario by throwing
/// [TelemetryConformanceFailure]. A thrown error fails the test that ran it.
///
/// A suite is a SCENARIO LIST plus a PER-ADAPTER FIXTURE: the fixture starts
/// the adapter over a [FakeTelemetryTransport] and says, per scenario, whether
/// the adapter is expected to deliver. The runner THROWS when a scenario has no
/// expectation for the adapter under test — a missing fixture is never a skip.
///
/// The fake is a Sentry-protocol [Transport]: it serialises every envelope the
/// SDK hands it to the exact bytes the sink would receive, so the PII and
/// stamping scenarios read what would actually LEAVE the device, not the
/// in-memory event.
library;

import 'dart:convert';

import 'package:sentry_flutter/sentry_flutter.dart';

import 'src/pii_scrubber.dart';
import 'src/telemetry_client.dart';
import 'src/telemetry_config.dart';

/// What the conformance suite checks, one adapter at a time.
enum TelemetryScenario {
  /// An event becomes a valid Sentry envelope: an event id of 32 hex digits,
  /// an `event` item whose id matches, a timestamp and a platform (the
  /// fields Sentry ingest requires; `level` is optional and defaults to error).
  validEnvelope,

  /// Every class of `PiiScrubber` is gone from the bytes that leave: PAN,
  /// Aadhaar, e-mail, Indian phone, IPv4, IPv6 and the long digit run — in a
  /// message, an exception value and a breadcrumb.
  piiScrubbed,

  /// The release and environment of the [TelemetryConfig] are on the event.
  releaseStamped,

  /// A sink outage FAILS OPEN: every call completes without throwing, and the
  /// client still delivers once the sink is back.
  failsOpen,

  /// A burst is bounded: no more than the fixture's limit leaves the device.
  rateBounded,
}

/// Per scenario: is this adapter expected to put something on the wire?
enum TelemetryExpectation {
  /// The scenario's events reach the transport (a real sink adapter).
  delivers,

  /// Nothing reaches the transport (the no-op client, selected by an empty
  /// DSN): the scenario asserts the wire stayed EMPTY and every call returned.
  deliversNothing,
}

/// One PII sample per `PiiScrubber` rule, keyed by the rule's name. Each value
/// is a string the scrubber must redact; none occurs anywhere else in an
/// envelope, so its absence from the serialised bytes is the whole assertion.
const Map<String, String> telemetryPiiSamples = <String, String>{
  'pan': 'ABCDE1234F',
  'aadhaar': '1234-5678-9012',
  'email': 'qa.tester@example.invalid',
  'phone': '98765 43210',
  'ipv4': '198.18.7.9',
  'ipv6': '2001:db8::7334',
  'longDigitRun': '11112222333344',
};

/// One envelope as the sink would receive it, decoded.
class FakeTelemetryEnvelope {
  /// Wraps the decoded parts of one serialised envelope.
  FakeTelemetryEnvelope(this.raw, this.header, this.items);

  /// The UTF-8 text of the whole envelope, exactly as serialised.
  final String raw;

  /// The envelope header (`event_id`, `sent_at`, `dsn`, `sdk`).
  final Map<String, dynamic> header;

  /// Each item: its header and its JSON payload (or null if not JSON).
  final List<({Map<String, dynamic> header, Object? payload})> items;

  /// The payload of every `event` item.
  Iterable<Map<String, dynamic>> get events => items
      .where((i) => i.header['type'] == 'event')
      .map((i) => i.payload)
      .whereType<Map<String, dynamic>>();
}

/// A Sentry-protocol [Transport] that records instead of sending.
///
/// Set [outage] to make every send fail the way a dead sink does (a thrown
/// socket-level error); clear it and the next send is recorded again.
class FakeTelemetryTransport implements Transport {
  /// A transport with an empty record and the sink up.
  FakeTelemetryTransport();

  // Serialisation only needs the envelope options' defaults, so the fake never
  // depends on how the adapter configured the SDK.
  final SentryOptions _serialiseWith = SentryOptions();

  /// Every envelope sent while the sink was up, in order.
  final List<FakeTelemetryEnvelope> envelopes = <FakeTelemetryEnvelope>[];

  /// How many sends failed because of [outage].
  int failedSends = 0;

  /// True makes every send throw, as an unreachable sink does.
  bool outage = false;

  /// Every `event` item delivered so far.
  Iterable<Map<String, dynamic>> get events =>
      envelopes.expand((e) => e.events);

  /// Every byte delivered so far, as one string.
  String get wire => envelopes.map((e) => e.raw).join('\n');

  @override
  Future<SentryId?> send(SentryEnvelope envelope) async {
    if (outage) {
      failedSends++;
      throw StateError('FakeTelemetryTransport: sink outage');
    }
    final bytes = <int>[];
    await for (final chunk in envelope.envelopeStream(_serialiseWith)) {
      bytes.addAll(chunk);
    }
    envelopes.add(_decode(utf8.decode(bytes)));
    return envelope.header.eventId ?? SentryId.empty();
  }

  static FakeTelemetryEnvelope _decode(String raw) {
    final lines = raw.split('\n');
    final header = jsonDecode(lines.first) as Map<String, dynamic>;
    final items = <({Map<String, dynamic> header, Object? payload})>[];
    for (var i = 1; i + 1 < lines.length; i += 2) {
      final itemHeader = jsonDecode(lines[i]) as Map<String, dynamic>;
      Object? payload;
      try {
        payload = jsonDecode(lines[i + 1]);
      } on FormatException {
        payload = null;
      }
      items.add((header: itemHeader, payload: payload));
    }
    return FakeTelemetryEnvelope(raw, header, items);
  }
}

/// Starts one adapter for one scenario.
///
/// [transport] is the wire the adapter must send through; [config] the build
/// identity it must stamp; [rateLimit] the most events per window the adapter
/// is configured to let through (the `rateBounded` scenario passes a small
/// one, every other scenario one no scenario reaches).
typedef TelemetryClientStarter = Future<TelemetryClient> Function(
  FakeTelemetryTransport transport,
  TelemetryConfig config,
  int rateLimit,
);

/// One adapter's fixture: how to start and stop it, and what each scenario
/// should see on the wire.
class TelemetryConformanceFixture {
  /// The fixture for one adapter.
  const TelemetryConformanceFixture({
    required this.start,
    required this.stop,
    required this.expectations,
  });

  /// Starts the adapter over the fake transport.
  final TelemetryClientStarter start;

  /// Tears it down (closes the SDK, for a real sink).
  final Future<void> Function() stop;

  /// Per scenario, delivers or delivers nothing. EVERY scenario must be here.
  final Map<TelemetryScenario, TelemetryExpectation> expectations;
}

/// The config every scenario stamps.
const TelemetryConfig telemetryConformanceConfig = TelemetryConfig(
  dsn: 'https://publickey@glitchtip.example.invalid/7',
  release: 'conformance@1.2.3+c0ffee1',
  environment: 'conformance',
);

/// The rate limit the `rateBounded` scenario configures; the burst it fires is
/// five times this.
const int telemetryConformanceRateLimit = 5;

/// A conformance scenario that did not hold.
class TelemetryConformanceFailure implements Exception {
  /// The failure, naming the adapter and what was seen.
  TelemetryConformanceFailure(this.message);

  /// What did not hold.
  final String message;

  @override
  String toString() => 'TelemetryConformanceFailure: $message';
}

/// How the caller's test framework registers one case: pass `test` from
/// `package:flutter_test` (or `package:test`).
typedef TelemetryTestRegistrar = void Function(
  String description,
  Future<void> Function() body,
);

/// One scenario's body, given a started client and its wire.
typedef _ScenarioBody = Future<void> Function(
  TelemetryClient client,
  FakeTelemetryTransport transport,
  bool delivers,
  void Function(bool holds, String why) check,
);

/// Runs every [TelemetryScenario] against one adapter, registering one case
/// per scenario through [test].
///
/// Throws [StateError] AT ONCE — before any case is registered — if [fixture]
/// has no expectation for a scenario.
void runTelemetryClientConformance(
  String adapter,
  TelemetryConformanceFixture fixture, {
  required TelemetryTestRegistrar test,
}) {
  for (final s in TelemetryScenario.values) {
    if (!fixture.expectations.containsKey(s)) {
      throw StateError(
        'runTelemetryClientConformance: adapter `$adapter` has no expectation '
        'for scenario `${s.name}`. A missing fixture is never a skip.',
      );
    }
  }

  for (final s in TelemetryScenario.values) {
    final body = _scenarios[s]!;
    test('TelemetryClient conformance · $adapter · ${s.name}', () async {
      final transport = FakeTelemetryTransport();
      final rateLimit =
          s == TelemetryScenario.rateBounded ? telemetryConformanceRateLimit : 1000;
      final client =
          await fixture.start(transport, telemetryConformanceConfig, rateLimit);
      void check(bool holds, String why) {
        if (!holds) {
          throw TelemetryConformanceFailure('$adapter · ${s.name}: $why');
        }
      }

      final delivers = fixture.expectations[s] == TelemetryExpectation.delivers;
      try {
        await body(client, transport, delivers, check);
        if (!delivers) {
          check(transport.envelopes.isEmpty,
              'expected to deliver nothing, and ${transport.envelopes.length} envelope(s) were sent');
          check(transport.failedSends == 0,
              'expected to deliver nothing, and ${transport.failedSends} send(s) were attempted');
        }
      } finally {
        await fixture.stop();
      }
    });
  }
}

final Map<TelemetryScenario, _ScenarioBody> _scenarios =
    <TelemetryScenario, _ScenarioBody>{
  TelemetryScenario.validEnvelope: (client, transport, delivers, check) async {
    await client.captureMessage('conformance-valid-envelope');
    await client.captureException(StateError('conformance-valid-exception'));
    if (!delivers) return;
    final withEvent =
        transport.envelopes.where((e) => e.events.isNotEmpty).toList();
    check(withEvent.length == 2,
        'one message and one exception must make two event envelopes; saw ${withEvent.length}');
    for (final env in withEvent) {
      final id = env.header['event_id'];
      check(id is String && RegExp(r'^[0-9a-f]{32}$').hasMatch(id),
          'Sentry ingest requires a 32-hex event id; the header has $id');
      final event = env.events.single;
      check(event['event_id'] == id,
          'the event item names ${event['event_id']}, its envelope $id');
      check(event['timestamp'] != null, 'the event carries no timestamp');
      check(event['platform'] != null, 'the event carries no platform');
    }
    final wire = jsonEncode(transport.events.toList());
    check(wire.contains('conformance-valid-envelope'),
        'the message did not arrive');
    check(wire.contains('StateError'), 'the exception type did not arrive');
  },
  TelemetryScenario.piiScrubbed: (client, transport, delivers, check) async {
    for (final entry in telemetryPiiSamples.entries) {
      client.addBreadcrumb('crumb ${entry.key} ${entry.value}');
      await client.captureMessage('message ${entry.key} ${entry.value}');
      await client.captureException(
        StateError('exception ${entry.key} ${entry.value}'),
      );
    }
    if (!delivers) return;
    final sent = transport.events.length;
    check(sent == 2 * telemetryPiiSamples.length,
        'every capture must reach the wire for its absence of PII to mean '
        'anything; ${2 * telemetryPiiSamples.length} captured, $sent sent');
    final wire = transport.wire;
    for (final entry in telemetryPiiSamples.entries) {
      check(!wire.contains(entry.value),
          'the ${entry.key} sample `${entry.value}` left the device');
      check(wire.contains('message ${entry.key} $redactedToken'),
          'the ${entry.key} message must arrive REDACTED, not dropped — a '
          'scrubber that deletes the event also passes the absence check');
    }
  },
  TelemetryScenario.releaseStamped: (client, transport, delivers, check) async {
    await client.captureMessage('conformance-stamped');
    if (!delivers) return;
    final events = transport.events.toList();
    check(events.length == 1, 'expected one event, saw ${events.length}');
    check(events.single['release'] == telemetryConformanceConfig.release,
        'release is ${events.single['release']}');
    check(
        events.single['environment'] == telemetryConformanceConfig.environment,
        'environment is ${events.single['environment']}');
  },
  TelemetryScenario.failsOpen: (client, transport, delivers, check) async {
    transport.outage = true;
    try {
      await Future.wait<void>(<Future<void>>[
        client.captureMessage('conformance-during-outage'),
        client.captureException(StateError('conformance-during-outage')),
      ]).timeout(const Duration(seconds: 10));
    } on Object catch (e) {
      check(false, 'a dead sink must never throw into, or hang, the app: $e');
    }
    client
      ..addBreadcrumb('conformance-outage-crumb')
      ..setUser(id: 'opaque-id')
      ..setUser();
    transport.outage = false;
    await client.captureMessage('conformance-after-outage');
    if (!delivers) return;
    check(transport.failedSends > 0,
        'the outage was never exercised: nothing tried to send during it');
    check(jsonEncode(transport.events.toList()).contains('conformance-after-outage'),
        'after the outage the client must deliver again');
  },
  TelemetryScenario.rateBounded: (client, transport, delivers, check) async {
    const burst = telemetryConformanceRateLimit * 5;
    for (var i = 0; i < burst; i++) {
      await client.captureMessage('conformance-burst-$i');
    }
    if (!delivers) return;
    final sent = transport.events.length;
    check(sent > 0, 'the bound dropped everything');
    check(sent <= telemetryConformanceRateLimit,
        '$sent of a $burst-event burst left the device; the bound is $telemetryConformanceRateLimit');
    check(jsonEncode(transport.events.first).contains('conformance-burst-0'),
        'the FIRST events of a burst are the ones worth keeping');
  },
};
