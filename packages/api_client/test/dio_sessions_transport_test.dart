// DioSessionsTransport — the "Your devices" client (SE-03). The routes are
// `services/platform/src/routes/sessions.ts`; these pin the request each call
// sends and how each answer is read.
import 'dart:convert';
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

DioSessionsTransport _transport(_FakeAdapter adapter) => DioSessionsTransport(
  platformBaseUrl: _base,
  httpClient: Dio()..httpClientAdapter = adapter,
);

const String _current = '11111111-1111-4111-8111-111111111111';
const String _other = '22222222-2222-4222-8222-222222222222';

void main() {
  test('GET /v1/sessions with the bearer; rows parsed, current marked', () async {
    final _FakeAdapter adapter = _FakeAdapter(
      jsonEncode(<String, Object?>{
        'sessions': <Object?>[
          <String, Object?>{
            'id': _current,
            'current': true,
            'createdAt': '2026-09-01T10:00:00.000Z',
            'lastActiveAt': '2026-10-01T09:30:00.000Z',
            'device': 'Chrome on Windows',
          },
          <String, Object?>{
            'id': _other,
            'current': false,
            'createdAt': null,
            'lastActiveAt': null,
            'device': 'Safari on iPhone',
          },
          // Not a row: no id. Dropped, not shown inert.
          <String, Object?>{'current': false, 'device': 'Ghost'},
        ],
      }),
    );
    final core.Result<List<core.DeviceSession>> r = await _transport(
      adapter,
    ).list(accessToken: 'tok');
    expect(adapter.lastRequest!.method, 'GET');
    expect(adapter.lastRequest!.uri.toString(), '$_base/v1/sessions');
    expect(adapter.lastRequest!.headers['authorization'], 'Bearer tok');
    final List<core.DeviceSession> rows =
        (r as core.Ok<List<core.DeviceSession>>).value;
    expect(rows.map((core.DeviceSession s) => s.id), <String>[
      _current,
      _other,
    ]);
    expect(rows.first.current, isTrue);
    expect(rows.first.lastActiveAt, DateTime.utc(2026, 10, 1, 9, 30));
    expect(rows.last.device, 'Safari on iPhone');
    expect(rows.last.lastActiveAt, isNull);
  });

  test('a 2xx without the list is NOT an empty list', () async {
    final _FakeAdapter adapter = _FakeAdapter(jsonEncode(<String, Object?>{}));
    final core.Result<List<core.DeviceSession>> r = await _transport(
      adapter,
    ).list(accessToken: 'tok');
    expect(r.isOk, isFalse);
  });

  test('a 503 sessions_unavailable is a failure, said', () async {
    final _FakeAdapter adapter = _FakeAdapter(
      jsonEncode(<String, Object?>{'error': 'sessions_unavailable'}),
      status: 503,
    );
    expect((await _transport(adapter).list(accessToken: 'tok')).isOk, isFalse);
  });

  test('DELETE /v1/sessions/:id names exactly that session', () async {
    final _FakeAdapter adapter = _FakeAdapter(
      jsonEncode(<String, Object?>{'ok': true}),
    );
    final core.Result<void> r = await _transport(
      adapter,
    ).revoke(id: _other, accessToken: 'tok');
    expect(r.isOk, isTrue);
    expect(adapter.lastRequest!.method, 'DELETE');
    expect(adapter.lastRequest!.uri.toString(), '$_base/v1/sessions/$_other');
    expect(adapter.lastRequest!.headers['authorization'], 'Bearer tok');
  });

  test('409 current_session is a failure — the caller is not signed out', () async {
    final _FakeAdapter adapter = _FakeAdapter(
      jsonEncode(<String, Object?>{'error': 'current_session'}),
      status: 409,
    );
    final core.Result<void> r = await _transport(
      adapter,
    ).revoke(id: _current, accessToken: 'tok');
    expect(r.isOk, isFalse);
  });

  test('404 is a session already gone — signed out, so not a failure', () async {
    final _FakeAdapter adapter = _FakeAdapter(
      jsonEncode(<String, Object?>{'error': 'not_found'}),
      status: 404,
    );
    final core.Result<void> r = await _transport(
      adapter,
    ).revoke(id: _other, accessToken: 'tok');
    expect(r.isOk, isTrue);
  });

  test('every refusal status maps to its own outcome', () {
    expect(core.SessionRevokeOutcome.forStatus(204).signedOut, isTrue);
    expect(
      core.SessionRevokeOutcome.forStatus(409),
      core.SessionRevokeOutcome.currentSession,
    );
    expect(
      core.SessionRevokeOutcome.forStatus(429),
      core.SessionRevokeOutcome.rateLimited,
    );
    expect(
      core.SessionRevokeOutcome.forStatus(503),
      core.SessionRevokeOutcome.unavailable,
    );
    expect(
      core.SessionRevokeOutcome.forStatus(null),
      core.SessionRevokeOutcome.unknown,
    );
  });

  test('signed out: refused here, no request sent', () async {
    final _FakeAdapter adapter = _FakeAdapter('{}');
    final DioSessionsTransport t = _transport(adapter);
    expect((await t.list(accessToken: null)).isOk, isFalse);
    expect((await t.revoke(id: _other, accessToken: '')).isOk, isFalse);
    expect(adapter.calls, 0);
  });
}
