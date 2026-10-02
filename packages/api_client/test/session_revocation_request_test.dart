import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:nikatru_api_client/nikatru_api_client.dart';
import 'package:test/test.dart';

/// What the fake Worker does with one request that reaches it unrefused.
enum _Turn {
  /// KV and the link floor written: 204.
  done,

  /// KV written, the link floor not: 200 `{d1Pending: true}`.
  pending,

  /// KV written, then the response is lost on the way back: no answer at all.
  lostResponse,

  /// The request never arrives: no answer, nothing written.
  neverArrived,

  /// KV could not be written: 503, nothing refused.
  unavailable,
}

/// ⏱ 2026-10-02 · review 1 of #1140, finding 1 — a fake platform Worker that
/// behaves like services/platform/src/routes/sessions.ts and
/// services/_shared/src/auth.ts together: once a revoke-all has written its
/// record, every token issued before it is refused 401 at the auth middleware,
/// BEFORE the route runs. The bearer that sent the revoke is one of them. The
/// scripted test this replaces answered 200 d1Pending and then 204 to the SAME
/// token, which no real Worker can do.
class _Worker implements HttpClientAdapter {
  _Worker(this.turns);

  /// One per request that reaches the route, in order.
  final List<_Turn> turns;
  final List<RequestOptions> requests = <RequestOptions>[];
  final Set<String> refused = <String>{};
  int _turn = 0;

  @override
  void close({bool force = false}) {}

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    requests.add(options);
    final String bearer = '${options.headers['Authorization']}';
    if (refused.contains(bearer)) {
      return _answer(401, '{"error":"session_revoked"}');
    }
    final _Turn turn = turns[_turn++];
    switch (turn) {
      case _Turn.neverArrived:
        throw DioException.connectionError(
          requestOptions: options,
          reason: 'Connection reset',
        );
      case _Turn.unavailable:
        return _answer(503, '{"error":"revocation_unavailable"}');
      case _Turn.done:
      case _Turn.pending:
      case _Turn.lostResponse:
        refused.add(bearer);
    }
    return switch (turn) {
      _Turn.done => _answer(204, ''),
      _Turn.pending => _answer(200, '{"d1Pending":true}'),
      _ => throw DioException.connectionError(
        requestOptions: options,
        reason: 'Connection reset after the write',
      ),
    };
  }

  static ResponseBody _answer(int status, String body) =>
      ResponseBody.fromString(
        body,
        status,
        headers: <String, List<String>>{
          Headers.contentTypeHeader: <String>['application/json'],
        },
      );
}

/// The app's platform client, whose OWN token is not the one to send: in the
/// sign-out flow the app holds no session by the time revoke-all is sent.
RestClient _client(_Worker worker) => RestClient(
  baseUrl: 'https://platform.test/v1',
  tokenProvider: () async => null,
  httpClient: Dio()..httpClientAdapter = worker,
);

Future<void> _revoke(_Worker w) =>
    requestWorkerSessionRevocation(_client(w), accessToken: 'held-token');

Matcher _apiException(int status, [String? message]) {
  TypeMatcher<ApiException> m = isA<ApiException>().having(
    (ApiException e) => e.statusCode,
    'statusCode',
    status,
  );
  if (message != null) {
    m = m.having((ApiException e) => e.message, 'message', message);
  }
  return throwsA(m);
}

void main() {
  test(
    'a 204 is done: ONE POST to /v1/sessions/revoke-all, with the HANDED bearer',
    () async {
      final _Worker w = _Worker(<_Turn>[_Turn.done]);
      await _revoke(w);
      expect(w.requests, hasLength(1));
      expect(w.requests.single.method, 'POST');
      expect(
        w.requests.single.uri.toString(),
        'https://platform.test/v1/sessions/revoke-all',
      );
      expect(w.requests.single.headers['Authorization'], 'Bearer held-token');
    },
  );

  test('🔴 200 {d1Pending: true} is an ANSWER: thrown as d1_pending after ONE '
      'request, never re-sent with the token it just refused', () async {
    final _Worker w = _Worker(<_Turn>[_Turn.pending, _Turn.done]);
    await expectLater(_revoke(w), _apiException(200, 'd1_pending'));
    expect(w.requests, hasLength(1));
  });

  test('🔴 a LOST RESPONSE is asked again, and the 401 the retry meets is the '
      'first attempt\'s own record: done', () async {
    final _Worker w = _Worker(<_Turn>[_Turn.lostResponse]);
    await _revoke(w);
    expect(w.requests, hasLength(2));
    expect(w.refused, <String>{'Bearer held-token'});
  });

  test(
    'a request that never arrived is asked again, and its 204 is done',
    () async {
      final _Worker w = _Worker(<_Turn>[_Turn.neverArrived, _Turn.done]);
      await _revoke(w);
      expect(w.requests, hasLength(2));
    },
  );

  test('no answer on every attempt is thrown as statusCode 0', () async {
    final _Worker w = _Worker(<_Turn>[_Turn.neverArrived, _Turn.neverArrived]);
    await expectLater(_revoke(w), _apiException(0));
    expect(w.requests, hasLength(2));
  });

  test('🔴 a 401 to the FIRST attempt is a refusal, not a success', () async {
    final _Worker w = _Worker(<_Turn>[_Turn.done])
      ..refused.add('Bearer held-token');
    await expectLater(_revoke(w), _apiException(401));
    expect(w.requests, hasLength(1));
  });

  test('🔴 a 503 revocation_unavailable is thrown to the caller, not swallowed '
      'and not retried (the server answered)', () async {
    final _Worker w = _Worker(<_Turn>[_Turn.unavailable, _Turn.done]);
    await expectLater(_revoke(w), _apiException(503));
    expect(w.requests, hasLength(1));
  });
}
