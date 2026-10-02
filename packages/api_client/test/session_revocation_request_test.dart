import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:nikatru_api_client/nikatru_api_client.dart';
import 'package:test/test.dart';

/// ⏱ 2026-10-02 · AB-A4-01 — `POST /v1/sessions/revoke-all`, the call that makes
/// "Log out of all devices" and a password reset reach the Workers. Each case is
/// a way the call could report done when it is not.
class _Script implements HttpClientAdapter {
  _Script(this.answers);

  /// One (status, body) per request, in order.
  final List<(int, String)> answers;
  final List<RequestOptions> requests = <RequestOptions>[];

  @override
  void close({bool force = false}) {}

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    requests.add(options);
    final (int status, String body) = answers[requests.length - 1];
    return ResponseBody.fromString(
      body,
      status,
      headers: <String, List<String>>{
        Headers.contentTypeHeader: <String>['application/json'],
      },
    );
  }
}

RestClient _client(_Script script) => RestClient(
  baseUrl: 'https://platform.test/v1',
  tokenProvider: () async => 'token',
  httpClient: Dio()..httpClientAdapter = script,
);

void main() {
  test(
    'a 204 is done: ONE POST to /v1/sessions/revoke-all, with the bearer token',
    () async {
      final _Script s = _Script(<(int, String)>[(204, '')]);
      await requestWorkerSessionRevocation(_client(s));
      expect(s.requests, hasLength(1));
      expect(s.requests.single.method, 'POST');
      expect(
        s.requests.single.uri.toString(),
        'https://platform.test/v1/sessions/revoke-all',
      );
      expect(s.requests.single.headers['Authorization'], 'Bearer token');
    },
  );

  test(
    '🔴 200 {d1Pending: true} is NOT done: asked again, and the second 204 is',
    () async {
      final _Script s = _Script(<(int, String)>[
        (200, '{"d1Pending":true}'),
        (204, ''),
      ]);
      await requestWorkerSessionRevocation(_client(s));
      expect(s.requests, hasLength(2));
    },
  );

  test(
    '🔴 still d1Pending after the last attempt is an ApiException, never a quiet success',
    () async {
      final _Script s = _Script(<(int, String)>[
        (200, '{"d1Pending":true}'),
        (200, '{"d1Pending":true}'),
      ]);
      await expectLater(
        requestWorkerSessionRevocation(_client(s)),
        throwsA(
          isA<ApiException>().having(
            (ApiException e) => e.message,
            'message',
            'd1_pending',
          ),
        ),
      );
      expect(s.requests, hasLength(2));
    },
  );

  test(
    '🔴 a 503 revocation_unavailable is thrown to the caller, not swallowed',
    () async {
      final _Script s = _Script(<(int, String)>[
        (503, '{"error":"revocation_unavailable"}'),
      ]);
      await expectLater(
        requestWorkerSessionRevocation(_client(s)),
        throwsA(
          isA<ApiException>().having(
            (ApiException e) => e.statusCode,
            'statusCode',
            503,
          ),
        ),
      );
      expect(s.requests, hasLength(1));
    },
  );
}
