import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:nikatru_api_client/nikatru_api_client.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:test/test.dart';

/// ST-N6 (D11) — the wire shape of `/preferences`, against a real socket, and
/// every failure an Err rather than a throw.
Future<({String base, List<String> seen})> _server({
  int status = 200,
  String body = '{"preferences":null}',
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
  test('read: null is "the account has none"', () async {
    final s = await _server();
    final core.Result<Map<String, Object?>?> r = await _over(s.base).read();
    expect(r.fold((v) => v, (_) => 'err'), isNull);
    expect(s.seen.single, startsWith('GET /v1/preferences'));
  });

  test('read: the document comes back as a map', () async {
    final s = await _server(body: '{"preferences":{"themeMode":"dark"}}');
    final r = await _over(s.base).read();
    expect(r.fold((v) => v, (_) => null), <String, Object?>{
      'themeMode': 'dark',
    });
  });

  test('write: PUT {preferences: …}', () async {
    final s = await _server(body: '{"preferences":{"locale":"ta"}}');
    final r = await _over(s.base).write(<String, Object?>{'locale': 'ta'});
    expect(r.fold((_) => true, (_) => false), isTrue);
    expect(
      s.seen.single,
      'PUT /v1/preferences {"preferences":{"locale":"ta"}}',
    );
  });

  test('a Worker without the route (404) is an Err, not a throw', () async {
    final s = await _server(status: 404, body: '{"error":"not_found"}');
    final t = _over(s.base);
    expect((await t.read()).fold((_) => 'ok', (_) => 'err'), 'err');
    expect(
      (await t.write(<String, Object?>{})).fold((_) => 'ok', (_) => 'err'),
      'err',
    );
  });
}
