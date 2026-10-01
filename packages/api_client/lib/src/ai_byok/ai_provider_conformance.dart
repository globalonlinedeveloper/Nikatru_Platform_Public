/// THE AI PORT'S CLIENT CONFORMANCE SUITE — the scenarios of
/// services/_shared/test/conformance/ai.ts, client-side. Every client adapter
/// of tooling/ports/ai.json passes them, each against its OWN recorded bytes.
///
/// An adapter's test CALLS [runAiProviderConformance] with one harness builder
/// per scenario and package:test's `group` and `test` (passed in, so this
/// library imports no test runner). Each builder is handed the [SecureStore]
/// the scenario wants — holding the sentinel key, or EMPTY for `noKey` — so
/// the suite, not the fixture, decides whether a key exists. 🔴 A MISSING
/// FIXTURE THROWS: never a skip. assert-ports limb 6 counts a client adapter
/// conformant when its test file CALLS this runner (ai.json `clientSuite`).
///
/// The bring-your-own-key analogue of the server's "no call without a
/// reservation" is "no call without the user's key": `noKey` is that scenario.
/// And `noNikatruHost` holds every request to the provider's own host — the
/// user's key must never pass through anything of ours.
library;

import 'dart:async';

import 'package:nikatru_core/nikatru_core.dart';

enum AiProviderScenario {
  structuredRows,
  refusal,
  maxTokens,
  usageReported,
  noKey,
  keyNotLogged,
  rateLimited,
  serverError,
  badRequest,
  modelFromConfig,
  noNikatruHost,
}

/// One scenario's harness: the provider, and what reached its carrier.
class AiProviderHarness {
  const AiProviderHarness({
    required this.provider,
    required this.calls,
    required this.models,
    required this.hosts,
    this.expectedUsage,
  });

  final AiProvider provider;

  /// Requests that reached the carrier.
  final int Function() calls;

  /// The model of every request, in order.
  final List<String> Function() models;

  /// The host of every request, in order.
  final List<String> Function() hosts;

  /// For usageReported: the usage the carrier's answer carried.
  final AiUsage? expectedUsage;
}

class AiProviderConformanceSubject {
  const AiProviderConformanceSubject({
    required this.adapter,
    required this.keyName,
    required this.secret,
    required this.ownerDomain,
    required this.modelA,
    required this.modelB,
    required this.fixtures,
  });

  final String adapter;

  /// The SecureStore key the adapter reads its key from.
  final String keyName;

  /// The sentinel key — never a real one.
  final String secret;

  /// Our own domain: no request may target it or a subdomain of it.
  final String ownerDomain;

  /// Two model ids of this provider, for modelFromConfig.
  final String modelA;
  final String modelB;
  final Map<
    AiProviderScenario,
    FutureOr<AiProviderHarness> Function(SecureStore keys)
  >
  fixtures;
}

class AiConformanceFailure implements Exception {
  AiConformanceFailure(this.message);
  final String message;
  @override
  String toString() => 'ai conformance $message';
}

/// The output shape every scenario asks for.
const Map<String, Object?> aiConformanceSchema = <String, Object?>{
  'type': 'object',
  'additionalProperties': false,
  'required': <Object?>['rows'],
  'properties': <String, Object?>{
    'rows': <String, Object?>{
      'type': 'array',
      'items': <String, Object?>{
        'type': 'object',
        'additionalProperties': false,
        'required': <Object?>['name', 'amount'],
        'properties': <String, Object?>{
          'name': <String, Object?>{'type': 'string'},
          'amount': <String, Object?>{'type': 'number'},
        },
      },
    },
  },
};

/// What a fixture answers an ended call with: rows that validate.
const String aiConformanceRowsText =
    '{"rows":[{"name":"Fixture streaming","amount":9.99}]}';

/// What a max_tokens stop leaves behind. Never rows.
const String aiConformanceTruncatedText = '{"rows":[{"name":"Fixture str';

AiRequest aiConformanceRequest(String model) => AiRequest(
  feature: 'import',
  model: model,
  system: 'Extract the subscriptions in the input as rows.',
  input: 'conformance input',
  schema: aiConformanceSchema,
  maxOutputTokens: 512,
);

Never _fail(AiProviderScenario s, String what) =>
    throw AiConformanceFailure('${s.name}: $what');

void _expectFailure(
  AiProviderScenario s,
  AiOutcome out,
  AiFailureKind kind,
  bool retryable,
) {
  if (out is! AiFailure) _fail(s, 'expected ${kind.name}, got a success');
  if (out.kind != kind) {
    _fail(
      s,
      'expected kind ${kind.name}, got ${out.kind.name} (${out.detail})',
    );
  }
  if (out.retryable != retryable) {
    _fail(s, 'expected retryable $retryable, got ${out.retryable}');
  }
}

/// Run ONE scenario against one harness; throws [AiConformanceFailure] when the adapter does not conform.
Future<void> checkAiProviderScenario(
  AiProviderScenario s,
  AiProviderHarness h,
  AiProviderConformanceSubject subject,
) async {
  final AiProvider p = h.provider;
  final AiRequest req = aiConformanceRequest(subject.modelA);
  switch (s) {
    case AiProviderScenario.structuredRows:
      final AiOutcome out = await p.complete(req);
      if (out is! AiSuccess) _fail(s, 'expected a success, got $out');
      final Object? rows = out.output is Map
          ? (out.output! as Map<Object?, Object?>)['rows']
          : null;
      if (rows is! List || rows.isEmpty) _fail(s, 'no rows came back');
      if (h.calls() != 1) _fail(s, 'expected 1 call, got ${h.calls()}');
    case AiProviderScenario.refusal:
      final AiOutcome out = await p.complete(req);
      _expectFailure(s, out, AiFailureKind.refused, false);
      if ((out as AiFailure).stopReason != AiStopReason.refusal) {
        _fail(s, 'stopReason ${out.stopReason}');
      }
    case AiProviderScenario.maxTokens:
      final AiOutcome out = await p.complete(req);
      _expectFailure(s, out, AiFailureKind.incomplete, false);
      if ((out as AiFailure).stopReason != AiStopReason.maxTokens) {
        _fail(s, 'stopReason ${out.stopReason}');
      }
      if (out.usage == null) {
        _fail(s, 'a truncation is billed, and its usage was not reported');
      }
    case AiProviderScenario.usageReported:
      final AiUsage want =
          h.expectedUsage ?? _fail(s, 'the fixture names no expectedUsage');
      if (want.cacheReadTokens == 0) {
        _fail(
          s,
          'the fixture must report cache reads, or their mapping is unexamined',
        );
      }
      final AiOutcome out = await p.complete(req);
      if (out is! AiSuccess) _fail(s, 'expected a success, got $out');
      if (out.usage != want) {
        _fail(s, 'usage is ${out.usage}, the carrier reported $want');
      }
    case AiProviderScenario.noKey:
      for (int i = 0; i < 2; i++) {
        _expectFailure(
          s,
          await p.complete(req),
          AiFailureKind.unavailable,
          false,
        );
      }
      if (h.calls() != 0) {
        _fail(s, '${h.calls()} request(s) left without a key');
      }
    case AiProviderScenario.keyNotLogged:
      final List<String> printed = <String>[];
      final List<AiOutcome> outcomes = <AiOutcome>[];
      await runZoned(
        () async {
          for (int i = 0; i < 5; i++) {
            outcomes.add(await p.complete(req));
          }
        },
        zoneSpecification: ZoneSpecification(
          print: (_, _, _, String line) => printed.add(line),
        ),
      );
      final List<AiFailure> failures = outcomes.whereType<AiFailure>().toList();
      if (failures.length < 3) {
        _fail(
          s,
          'the harness produced ${failures.length} failure(s); it needs a success and three failures',
        );
      }
      if (h.calls() == 0) {
        _fail(s, 'nothing reached the carrier, so the key was never used');
      }
      for (final String text in <String>[
        ...printed,
        ...outcomes.map((AiOutcome o) => o.toString()),
        ...failures.map((AiFailure f) => f.detail),
      ]) {
        // "match" / "no match" only: the key is never printed, even by a test.
        if (text.contains(subject.secret)) {
          _fail(s, 'the key appears in a printed line or an outcome: match');
        }
      }
    case AiProviderScenario.rateLimited:
    case AiProviderScenario.serverError:
      _expectFailure(s, await p.complete(req), AiFailureKind.retryable, true);
      if (h.calls() != 1) {
        _fail(
          s,
          'a retryable answer must not be retried here: ${h.calls()} call(s)',
        );
      }
    case AiProviderScenario.badRequest:
      _expectFailure(s, await p.complete(req), AiFailureKind.invalid, false);
    case AiProviderScenario.modelFromConfig:
      final AiOutcome a = await p.complete(
        aiConformanceRequest(subject.modelA),
      );
      final AiOutcome b = await p.complete(
        aiConformanceRequest(subject.modelB),
      );
      if (a is! AiSuccess || b is! AiSuccess) {
        _fail(s, 'a call under a configured model failed');
      }
      final List<String> seen = h.models();
      if (seen.length != 2 ||
          seen[0] != subject.modelA ||
          seen[1] != subject.modelB) {
        _fail(
          s,
          'the wire carried $seen; the two configured models were not sent as asked',
        );
      }
    case AiProviderScenario.noNikatruHost:
      await p.complete(req);
      final List<String> hosts = h.hosts();
      if (hosts.isEmpty) {
        _fail(s, 'no request reached the carrier, so no host was examined');
      }
      final String own = subject.ownerDomain.toLowerCase();
      for (final String host in hosts) {
        final String hl = host.toLowerCase();
        if (hl == own || hl.endsWith('.$own')) {
          _fail(
            s,
            'a request targeted $host, a Nikatru host: the user\'s key passed through us',
          );
        }
      }
  }
}

/// The two registration functions of package:test, passed in.
typedef AiGroupFn = void Function(String description, dynamic Function() body);
typedef AiTestFn = void Function(String description, dynamic Function() body);

/// The entry point a client adapter's test CALLS. Throws on a missing fixture.
void runAiProviderConformance(
  AiProviderConformanceSubject subject, {
  required AiGroupFn group,
  required AiTestFn test,
}) {
  final List<AiProviderScenario> missing = AiProviderScenario.values
      .where((AiProviderScenario s) => !subject.fixtures.containsKey(s))
      .toList();
  if (missing.isNotEmpty) {
    throw AiConformanceFailure(
      'runAiProviderConformance(${subject.adapter}): no fixture for ${missing.map((AiProviderScenario s) => s.name).join(', ')} — a missing fixture is never a skip',
    );
  }
  group('ai port client conformance — ${subject.adapter}', () {
    for (final AiProviderScenario s in AiProviderScenario.values) {
      test(s.name, () async {
        final InMemorySecureStore keys = InMemorySecureStore(
          s == AiProviderScenario.noKey
              ? null
              : <String, String>{subject.keyName: subject.secret},
        );
        final AiProviderHarness h = await subject.fixtures[s]!(keys);
        await checkAiProviderScenario(s, h, subject);
      });
    }
  });
}
