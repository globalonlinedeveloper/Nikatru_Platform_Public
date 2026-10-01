import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:nikatru_api_client/nikatru_api_client.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:test/test.dart';

/// ST-N6 (D11) — the wire shape of `/preferences`, per key and versioned,
/// against a real socket; and every failure a typed failure CARRYING ITS
/// STATUS (review #1080 finding 6).
Future<({String base, List<String> seen})> _server({
  int status = 200,
  String body = '{"preferences":{}}',
  Map<String, String> headers = const <String, String>{},
}) async {
  final HttpServer server = await HttpServer.bind(
    InternetAddress.loopbackIPv4,
    0,
  );
  final List<String> seen = <String>[];
  unawaited(
    server.forEach((HttpRequest req) async {
      final String sent = await utf8.decoder.bind(req).join();
      seen.add('${req.method} ${req.uri} $sent');
      req.response.statusCode = status;
      req.response.headers.contentType = ContentType.json;
      headers.forEach(req.response.headers.set);
      req.response.write(body);
      await req.response.close();
    }),
  );
  addTearDown(() => server.close(force: true));
  return (base: 'http://${server.address.host}:${server.port}/v1', seen: seen);
}

RestAccountPreferencesTransport _over(String base) =>
    RestAccountPreferencesTransport(
      RestClient(baseUrl: base, tokenProvider: () async => 'tok'),
    );

void main() {
  test('read: the per-key document, each key with its version', () async {
    final s = await _server(
      body:
          '{"preferences":{"themeMode":{"value":"dark","version":3,"updated_at":"x"}}}',
    );
    final Map<String, core.PreferenceValue> doc = await _over(s.base).read();
    expect(doc.keys, <String>['themeMode']);
    expect(doc['themeMode']!.value, 'dark');
    expect(doc['themeMode']!.version, 3);
    expect(s.seen.single, startsWith('GET /v1/preferences'));
  });

  test(
    'patch: PATCH {changes: {key: {value, base_version}}}, and the conflicts',
    () async {
      final s = await _server(
        body:
            '{"preferences":{"currencyCode":{"value":"EUR","version":2,"updated_at":"x"}},'
            '"conflicts":["currencyCode"]}',
      );
      final core.PreferencesPatchResult r = await _over(s.base).patch(
        <String, core.PreferenceChange>{
          'currencyCode': const core.PreferenceChange('GBP', 1),
        },
      );
      expect(
        s.seen.single,
        'PATCH /v1/preferences '
        '{"changes":{"currencyCode":{"value":"GBP","base_version":1}}}',
      );
      expect(r.conflicts, <String>{'currencyCode'});
      expect(r.current['currencyCode']!.value, 'EUR');
      expect(r.current['currencyCode']!.version, 2);
    },
  );

  for (final int status in <int>[400, 403, 404, 405, 410, 413, 401, 503]) {
    test(
      'a $status is a failure carrying $status, not a throw of another kind',
      () async {
        final s = await _server(status: status, body: '{"error":"x"}');
        final RestAccountPreferencesTransport t = _over(s.base);
        await expectLater(
          t.read(),
          throwsA(
            isA<core.AccountPreferencesFailure>().having(
              (core.AccountPreferencesFailure f) => f.status,
              'status',
              status,
            ),
          ),
        );
        await expectLater(
          t.patch(<String, core.PreferenceChange>{
            'themeMode': const core.PreferenceChange('dark', 0),
          }),
          throwsA(
            isA<core.AccountPreferencesFailure>().having(
              (core.AccountPreferencesFailure f) => f.status,
              'status',
              status,
            ),
          ),
        );
      },
    );
  }

  test(
    'a Retry-After rides on the failure, for the queue to wait at least that long (review 3 of #1080)',
    () async {
      final s = await _server(
        status: 503,
        body: '{"error":"x"}',
        headers: <String, String>{'retry-after': '120'},
      );
      await expectLater(
        _over(s.base).patch(<String, core.PreferenceChange>{
          'themeMode': const core.PreferenceChange('dark', 0),
        }),
        throwsA(
          isA<core.AccountPreferencesFailure>().having(
            (core.AccountPreferencesFailure f) => f.retryAfter,
            'retryAfter',
            const Duration(seconds: 120),
          ),
        ),
      );
    },
  );

  test('no answer at all is status 0 — offline', () async {
    final RestAccountPreferencesTransport t = _over('http://127.0.0.1:1/v1');
    await expectLater(
      t.read(),
      throwsA(
        isA<core.AccountPreferencesFailure>().having(
          (core.AccountPreferencesFailure f) => f.status,
          'status',
          0,
        ),
      ),
    );
  });
}
