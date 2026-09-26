import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:nikatru_api_client/nikatru_api_client.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:test/test.dart';

// ⏱ 2026-09-26 — production's 422 `unreleased_build` on /v1/events and
// /v1/consent (services/platform/src/lib/build-stamp.ts). Neither transport may
// throw on it, and only the events transport's refusal is typed: the recorder
// stops on core.UnreleasedBuildFailure, and every other Err is still a retry.

/// Answers every request with a fixed status and JSON body.
class _FakeAdapter implements HttpClientAdapter {
  _FakeAdapter(this.status, this.body);

  final int status;
  final Object body;
  int calls = 0;

  @override
  void close({bool force = false}) {}

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    calls++;
    return ResponseBody.fromString(
      jsonEncode(body),
      status,
      headers: <String, List<String>>{
        Headers.contentTypeHeader: <String>['application/json'],
      },
    );
  }
}

Future<core.Result<void>> _sendEvents(_FakeAdapter a) =>
    DioEventTransport(
      platformBaseUrl: 'https://platform.example.test',
      httpClient: Dio()..httpClientAdapter = a,
    ).send(
      appId: 'subscriptiontracker',
      anonId: 'install-1',
      envelope: const <String, Object?>{'app_version': 'dev'},
      events: const <Map<String, Object?>>[
        <String, Object?>{'event_id': 'e1', 'event': 'first_launch'},
      ],
    );

core.Failure? _failure(core.Result<void> r) =>
    r.fold((_) => null, (core.Failure f) => f);

void main() {
  group('DioEventTransport', () {
    test('422 unreleased_build is an UnreleasedBuildFailure', () async {
      final core.Result<void> r = await _sendEvents(
        _FakeAdapter(422, <String, Object?>{
          'ok': false,
          'error': 'unreleased_build',
          'received': 0,
        }),
      );
      expect(_failure(r), isA<core.UnreleasedBuildFailure>());
    });

    test('any other refusal stays a plain, retryable Failure', () async {
      for (final (int status, Object body) in <(int, Object)>[
        (422, <String, Object?>{'error': 'something_else'}),
        (400, <String, Object?>{'error': 'unreleased_build'}),
        (429, <String, Object?>{'ok': false, 'error': 'rate_limited'}),
        (503, <String, Object?>{'error': 'ingest_failed'}),
      ]) {
        final core.Failure? f = _failure(
          await _sendEvents(_FakeAdapter(status, body)),
        );
        expect(f, isNotNull, reason: '$status');
        expect(f, isNot(isA<core.UnreleasedBuildFailure>()), reason: '$status');
      }
    });

    test('200 is Ok', () async {
      final core.Result<void> r = await _sendEvents(
        _FakeAdapter(200, <String, Object?>{'ok': true, 'received': 1}),
      );
      expect(r.isOk, isTrue);
    });
  });

  group('DioConsentTransport', () {
    test('422 unreleased_build returns an Err and throws nothing', () async {
      final _FakeAdapter a = _FakeAdapter(422, <String, Object?>{
        'ok': false,
        'error': 'unreleased_build',
      });
      final core.Result<void> r =
          await DioConsentTransport(
            platformBaseUrl: 'https://platform.example.test',
            httpClient: Dio()..httpClientAdapter = a,
          ).send(
            appId: 'subscriptiontracker',
            artifact: core.ConsentArtifact.create(
              purpose: core.ConsentPurpose.terms,
              granted: true,
              policyVersion: '2026-07-25',
              anonId: 'install-1',
              now: DateTime.utc(2026, 9, 26),
              appVersion: 'dev',
            ),
          );
      expect(r.isOk, isFalse);
      // One POST: the consent upload is fire-once by contract
      // (applyConsentDecision / applyLegalAcceptance ignore the result).
      expect(a.calls, 1);
    });
  });
}
