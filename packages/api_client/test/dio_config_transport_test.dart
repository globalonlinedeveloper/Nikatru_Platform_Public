import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:nikatru_api_client/nikatru_api_client.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:test/test.dart';

/// Answers every request with a fixed status and body and records it.
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

/// The served body is scalar whatever the channel (the service resolves its
/// per-channel maps before answering), so one fixture serves every case.
final String _served = jsonEncode(<String, Object?>{
  'app_id': 'demo',
  'api_base_url': 'https://api.example.test/v1',
  'min_supported_version': '2.0.0',
});

DioConfigTransport _transport(_FakeAdapter adapter, String? releaseChannel) =>
    DioConfigTransport(
      configBaseUrl: 'https://config.example.test',
      releaseChannel: releaseChannel,
      httpClient: Dio()..httpClientAdapter = adapter,
    );

void main() {
  // RC5: at the base the transport sent no channel, so every channel got the
  // service's `default` floor (O-UPDATE-FLOOR-HAS-NO-CHANNEL).
  test(
    'a declared channel is sent as ?channel=<id> on the pinned route',
    () async {
      final _FakeAdapter adapter = _FakeAdapter(_served);
      final core.Result<Map<String, Object?>> r = await _transport(
        adapter,
        'android-play',
      ).fetch('demo');

      expect(r.isOk, isTrue);
      expect(
        adapter.lastRequest!.uri.toString(),
        'https://config.example.test/config/demo?channel=android-play',
      );
    },
  );

  test(
    'a null channel sends no parameter (the service answers default)',
    () async {
      final _FakeAdapter adapter = _FakeAdapter(_served);
      final core.Result<Map<String, Object?>> r = await _transport(
        adapter,
        null,
      ).fetch('demo');

      expect(r.isOk, isTrue);
      expect(
        adapter.lastRequest!.uri.toString(),
        'https://config.example.test/config/demo',
      );
    },
  );

  test('an empty channel sends no parameter, never a bare ?channel=', () async {
    final _FakeAdapter adapter = _FakeAdapter(_served);
    final core.Result<Map<String, Object?>> r = await _transport(
      adapter,
      '',
    ).fetch('demo');

    expect(r.isOk, isTrue);
    expect(
      adapter.lastRequest!.uri.toString(),
      'https://config.example.test/config/demo',
    );
  });

  test('the served body is returned as the decoded map', () async {
    final core.Result<Map<String, Object?>> r = await _transport(
      _FakeAdapter(_served),
      'web',
    ).fetch('demo');

    expect(
      r.fold(
        (Map<String, Object?> v) => v['min_supported_version'],
        (_) => null,
      ),
      '2.0.0',
    );
  });

  test(
    'a 400 unknown_channel is a failure, so the loader falls back',
    () async {
      final _FakeAdapter adapter = _FakeAdapter(
        jsonEncode(<String, Object?>{'error': 'unknown_channel'}),
        status: 400,
      );
      final core.Result<Map<String, Object?>> r = await _transport(
        adapter,
        'nope',
      ).fetch('demo');

      expect(r.isOk, isFalse);
      expect(
        adapter.lastRequest!.uri.toString(),
        'https://config.example.test/config/demo?channel=nope',
      );
    },
  );
}
