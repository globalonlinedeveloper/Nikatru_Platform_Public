import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:nikatru_api_client/nikatru_api_client.dart';
import 'package:nikatru_core/nikatru_core.dart' show OutboxFailure;
import 'package:test/test.dart';

/// A dio adapter that returns a fixed body/status and records the last request.
class _FakeAdapter implements HttpClientAdapter {
  _FakeAdapter(this.body, {this.status = 200});

  final String body;
  final int status;
  RequestOptions? lastRequest;

  @override
  void close({bool force = false}) {}

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    lastRequest = options;
    return ResponseBody.fromString(
      body,
      status,
      headers: <String, List<String>>{
        Headers.contentTypeHeader: <String>['application/json'],
      },
    );
  }
}

/// Answers 409 "still processing" with a Retry-After of 30 s.
class _RetryAfterAdapter implements HttpClientAdapter {
  @override
  void close({bool force = false}) {}

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async => ResponseBody.fromString(
    jsonEncode(<String, dynamic>{'error': 'idempotency_in_progress'}),
    409,
    headers: <String, List<String>>{
      Headers.contentTypeHeader: <String>['application/json'],
      'retry-after': <String>['30'],
    },
  );
}

RestClient _client(_FakeAdapter adapter, {Future<String?> Function()? token}) {
  final Dio dio = Dio()..httpClientAdapter = adapter;
  return RestClient(
    baseUrl: 'https://example.test/v1',
    tokenProvider: token ?? () async => null,
    httpClient: dio,
  );
}

void main() {
  test('attaches the bearer token and returns the decoded body', () async {
    final _FakeAdapter adapter =
        _FakeAdapter(jsonEncode(<String, dynamic>{'ok': true}));
    final RestClient client = _client(adapter, token: () async => 'tok123');

    final dynamic data = await client.get('/health');
    expect((data as Map<String, dynamic>)['ok'], isTrue);
    expect(adapter.lastRequest!.headers['Authorization'], 'Bearer tok123');
  });

  test('omits the Authorization header when there is no token', () async {
    final _FakeAdapter adapter = _FakeAdapter(jsonEncode(<String, dynamic>{}));
    final RestClient client = _client(adapter);
    await client.get('/health');
    expect(adapter.lastRequest!.headers.containsKey('Authorization'), isFalse);
  });

  test('sends a JSON body on post', () async {
    final _FakeAdapter adapter =
        _FakeAdapter(jsonEncode(<String, dynamic>{'id': '1'}));
    final RestClient client = _client(adapter);
    await client.post('/things', body: <String, dynamic>{'name': 'x'});
    expect(adapter.lastRequest!.data, <String, dynamic>{'name': 'x'});
  });

  // AB-O2-02: a replayed write carries the SAME key on every attempt, and a
  // write that was not given one carries no header at all.
  // AB-O2-02 + the pre-merge E2E on #1075: the key rides the QUERY STRING, so
  // a server whose CORS allow-list predates it still accepts the request (a
  // new header failed the browser preflight on every web add). The same key
  // on every attempt; an unkeyed write carries none; no custom header ever.
  test('a write carries its idempotency key as a query parameter, never as a '
      'header', () async {
    final _FakeAdapter adapter =
        _FakeAdapter(jsonEncode(<String, dynamic>{'id': '1'}));
    final RestClient client = _client(adapter);
    await client.post('/things', body: <String, dynamic>{}, idempotencyKey: 'k-1');
    expect(adapter.lastRequest!.queryParameters['idempotency_key'], 'k-1');
    expect(adapter.lastRequest!.uri.query, contains('idempotency_key=k-1'));
    expect(adapter.lastRequest!.headers.keys.map((String k) => k.toLowerCase()),
        isNot(contains('idempotency-key')));
    await client.patch('/things/1', body: <String, dynamic>{}, idempotencyKey: 'k-2');
    expect(adapter.lastRequest!.queryParameters['idempotency_key'], 'k-2');
    await client.post('/things', body: <String, dynamic>{});
    expect(adapter.lastRequest!.queryParameters, isEmpty);
  });

  // Review #1075 round 3, minor d: the outbox waits as long as the server says.
  test('a Retry-After on a refusal is carried on the ApiException', () async {
    final Dio dio = Dio()..httpClientAdapter = _RetryAfterAdapter();
    final RestClient client = RestClient(
      baseUrl: 'https://example.test/v1',
      tokenProvider: () async => null,
      httpClient: dio,
    );
    await expectLater(
      client.post('/things', body: <String, dynamic>{}),
      throwsA(
        isA<ApiException>()
            .having((ApiException e) => e.statusCode, 'status', 409)
            .having(
              (ApiException e) => e.retryAfter,
              'retryAfter',
              const Duration(seconds: 30),
            )
            // Review #1075 round 4, minor 1: the outbox waits on THIS 409 —
            // the server's `error` code as it arrives on the wire — and no
            // other.
            .having(classifyForOutbox, 'classified', OutboxFailure.busy),
      ),
    );
  });

  test('maps a non-2xx response to ApiException carrying the error message',
      () {
    final _FakeAdapter adapter = _FakeAdapter(
      jsonEncode(<String, dynamic>{'error': 'nope'}),
      status: 400,
    );
    final RestClient client = _client(adapter);
    expect(
      client.get('/things'),
      throwsA(isA<ApiException>()
          .having((ApiException e) => e.statusCode, 'statusCode', 400)
          .having((ApiException e) => e.message, 'message', 'nope')),
    );
  });

  test('a refused body keeps the Worker\'s detail beside the error code', () {
    final _FakeAdapter adapter = _FakeAdapter(
      jsonEncode(<String, dynamic>{
        'error': 'invalid_body',
        'detail': 'price must be a finite number between 0 and 1000000000',
      }),
      status: 400,
    );
    expect(
      _client(adapter).get('/things'),
      throwsA(isA<ApiException>()
          .having((ApiException e) => e.message, 'message', 'invalid_body')
          .having((ApiException e) => e.detail, 'detail',
              startsWith('price must be'))),
    );
    // No detail on the wire is null, never an invented sentence.
    expect(
      _client(_FakeAdapter(jsonEncode(<String, dynamic>{'error': 'nope'}),
              status: 400))
          .get('/things'),
      throwsA(isA<ApiException>()
          .having((ApiException e) => e.detail, 'detail', isNull)),
    );
  });

  test('decode passes a good value through and maps parse failures', () {
    final RestClient client =
        _client(_FakeAdapter(jsonEncode(<String, dynamic>{})));
    // Good parse returns the value.
    expect(
        client.decode(<dynamic>[1, 2], (Object? b) => (b! as List).length), 2);
    // A wrong-shape parse throws ApiException(0, ...), not a raw TypeError.
    expect(
      () => client.decode(<String, dynamic>{}, (Object? b) => b! as List),
      throwsA(isA<ApiException>()
          .having((ApiException e) => e.statusCode, 'statusCode', 0)),
    );
  });
}
