import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:nikatru_api_client/nikatru_api_client.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:test/test.dart';

// Lane dpdp-rights: the client of GET /v1/account/export and
// GET|PUT|DELETE /v1/account/nominee (services/platform/src/routes/account-data.ts).

class _FakeAdapter implements HttpClientAdapter {
  _FakeAdapter(this.body, {this.status = 200});

  final String body;
  final int status;
  RequestOptions? lastRequest;
  Object? lastBody;
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
    lastRequest = options;
    lastBody = options.data;
    return ResponseBody.fromString(
      body,
      status,
      headers: <String, List<String>>{
        Headers.contentTypeHeader: <String>['application/json'],
      },
    );
  }
}

const String _base = 'https://platform.example.test';

DioPrivacyDataTransport _transport(_FakeAdapter adapter) =>
    DioPrivacyDataTransport(
      platformBaseUrl: _base,
      httpClient: Dio()..httpClientAdapter = adapter,
    );

void main() {
  test(
    'the export is fetched with the bearer and the install id, and kept as the server sent it',
    () async {
      const String body = '{"schema":"nikatru.data-export/1","stores":{}}';
      final _FakeAdapter a = _FakeAdapter(body);
      final core.Result<String> r = await _transport(a).exportData(
        accessToken: 'tok',
        anonId: '0f8fad5b-d9cb-469f-a165-70867728950e',
      );
      expect(r, isA<core.Ok<String>>());
      expect((r as core.Ok<String>).value, body);
      expect(
        a.lastRequest!.uri.toString(),
        startsWith('$_base/v1/account/export'),
      );
      expect(a.lastRequest!.uri.queryParameters['anon_id'], isNotNull);
      expect(a.lastRequest!.headers['authorization'], 'Bearer tok');
    },
  );

  test(
    '🔴 an answer that is not an export is refused, never saved as one',
    () async {
      final _FakeAdapter a = _FakeAdapter('{"ok":true}');
      final core.Result<String> r = await _transport(
        a,
      ).exportData(accessToken: 'tok');
      expect(r.isOk, isFalse);
    },
  );

  test('signed out, nothing is sent', () async {
    final _FakeAdapter a = _FakeAdapter('{}');
    expect((await _transport(a).exportData(accessToken: null)).isOk, isFalse);
    expect((await _transport(a).readNominee(accessToken: '')).isOk, isFalse);
    expect(a.calls, 0);
  });

  test(
    'PUT sends a name and an address and nothing else, and parses the reply',
    () async {
      final _FakeAdapter a = _FakeAdapter(
        jsonEncode(<String, Object?>{
          'nominee': <String, Object?>{
            'name': 'Meena',
            'email': 'meena@example.com',
            'updatedAt': 'x',
          },
        }),
      );
      final core.Result<core.PrivacyNominee> r = await _transport(a)
          .writeNominee(
            accessToken: 'tok',
            nominee: const core.PrivacyNominee(
              name: ' Meena ',
              email: 'meena@example.com',
            ),
          );
      expect((r as core.Ok<core.PrivacyNominee>).value.name, 'Meena');
      expect(a.lastRequest!.method, 'PUT');
      expect(a.lastBody, <String, Object?>{
        'name': 'Meena',
        'email': 'meena@example.com',
      });
    },
  );

  test(
    'an invalid nominee is refused here, before a request is spent',
    () async {
      final _FakeAdapter a = _FakeAdapter('{}');
      final core.Result<core.PrivacyNominee> r = await _transport(a)
          .writeNominee(
            accessToken: 'tok',
            nominee: const core.PrivacyNominee(
              name: 'Meena',
              email: 'not-an-address',
            ),
          );
      expect(r.isOk, isFalse);
      expect(a.calls, 0);
    },
  );

  test('no nominee reads as Ok(null), not as a failure', () async {
    final _FakeAdapter a = _FakeAdapter('{"nominee":null}');
    final core.Result<core.PrivacyNominee?> r = await _transport(
      a,
    ).readNominee(accessToken: 'tok');
    expect(r, isA<core.Ok<core.PrivacyNominee?>>());
    expect((r as core.Ok<core.PrivacyNominee?>).value, isNull);
  });
}
