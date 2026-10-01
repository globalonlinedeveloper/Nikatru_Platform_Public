import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:nikatru_api_client/nikatru_api_client.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:test/test.dart';

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

DioFxTransport _transport(_FakeAdapter a) => DioFxTransport(
  platformBaseUrl: 'https://platform.example.test',
  httpClient: Dio()..httpClientAdapter = a,
);

void main() {
  test(
    'GET /v1/fx/latest, unauthenticated, and the body reads into FxTable',
    () async {
      final _FakeAdapter a = _FakeAdapter(
        '{"source":"ECB","base":"EUR","asOf":"2026-09-25",'
        '"rates":{"USD":1.1732,"INR":103.987}}',
      );
      final core.Result<Map<String, Object?>> r = await _transport(
        a,
      ).fetchLatest();
      expect(a.lastRequest!.method, 'GET');
      expect(
        a.lastRequest!.uri.toString(),
        'https://platform.example.test/v1/fx/latest',
      );
      expect(a.lastRequest!.headers.containsKey('authorization'), isFalse);
      final Map<String, Object?> body =
          (r as core.Ok<Map<String, Object?>>).value;
      expect(core.FxTable.tryFromJson(body)!.asOf, DateTime.utc(2026, 9, 25));
    },
  );

  test("the route's 503 before the first nightly run is an Err", () async {
    final core.Result<Map<String, Object?>> r = await _transport(
      _FakeAdapter('{"error":"fx_unavailable"}', status: 503),
    ).fetchLatest();
    expect(r, isA<core.Err<Map<String, Object?>>>());
  });

  test('a body that is not an object is an Err', () async {
    final core.Result<Map<String, Object?>> r = await _transport(
      _FakeAdapter('[1,2]'),
    ).fetchLatest();
    expect(r, isA<core.Err<Map<String, Object?>>>());
  });
}
