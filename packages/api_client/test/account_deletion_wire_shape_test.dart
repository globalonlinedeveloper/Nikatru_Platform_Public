import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:nikatru_api_client/nikatru_api_client.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:test/test.dart';

/// WHAT ACTUALLY GOES ON THE WIRE, CAPTURED BY A REAL SERVER.
///
/// 🔴 EVERY OTHER TEST OF THIS PATH USES A FAKE `HttpClientAdapter`, AND A FAKE
/// ADAPTER CANNOT SEE THE REQUEST-TARGET. It is handed `RequestOptions`, whose
/// `.path` is the string the caller passed (`/account`) — the same value whether
/// dio composes `https://host/v1/account` or `https://host/v1//account`. So the
/// one property a client bug actually shows up in was the one property no test
/// asserted, and "the URL join is wrong" survived as a live hypothesis through
/// three sessions of the 2026-08-09 delete-account investigation for exactly
/// that reason. This binds a real `HttpServer` on loopback and reads the request
/// line dio emitted.
///
/// It is a `dart:io` test on purpose. The web build composes its URI with the
/// SAME `RequestOptions.uri` in dio's core — only the adapter differs — so the
/// join proved here is the join the browser sends.
class _Captured {
  late final String method;
  late final String path;
  late final Map<String, String> headers;
  late final String body;
}

/// Serves ONE request from [base] (with `PORT` substituted), captures it, and
/// answers [status].
Future<_Captured> _capture({
  required String base,
  int status = 200,
  String body = '{"ok":true}',
}) async {
  final HttpServer server =
      await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
  final Completer<_Captured> seen = Completer<_Captured>();
  unawaited(
    server.forEach((HttpRequest req) async {
      final _Captured c = _Captured()
        ..method = req.method
        // `req.uri` is the request-target the client actually sent — NOT
        // anything reconstructed from the base URL on this side.
        ..path = req.uri.toString()
        ..headers = <String, String>{}
        ..body = await utf8.decoder.bind(req).join();
      req.headers.forEach(
        (String k, List<String> v) => c.headers[k.toLowerCase()] = v.join(','),
      );
      if (!seen.isCompleted) seen.complete(c);
      req.response.statusCode = status;
      req.response.headers.contentType = ContentType.json;
      req.response.write(body);
      await req.response.close();
    }),
  );
  addTearDown(() => server.close(force: true));

  final RestClient client = RestClient(
    baseUrl: base.replaceAll('PORT', '${server.port}'),
    tokenProvider: () async => 'tok-123',
  );
  try {
    await requestAccountDeletion(client);
  } on core.AccountDeletionFailure {
    // The status under test may be a refusal; the capture is what matters.
  }
  return seen.future.timeout(const Duration(seconds: 10));
}

void main() {
  test('DELETE {base}/account lands on exactly ONE `/v1/account`', () async {
    final _Captured c = await _capture(base: 'http://127.0.0.1:PORT/v1');
    expect(c.method, 'DELETE');
    expect(
      c.path,
      '/v1/account',
      reason:
          'the erasure route is mounted at exactly this path — `/v1//account` '
          'or `/v1/account/` is a different route and Hono answers 404, which '
          '`forStatus` reports as `unknown` ("we cannot tell how much of it was '
          'removed")',
    );
    expect(c.headers['authorization'], 'Bearer tok-123');
    expect(
      c.body,
      isEmpty,
      reason: 'the route parses no body; sending one is a difference between '
          'this client and the curl reproduction that proved the route works',
    );
  });

  test('a base URL with a TRAILING SLASH composes the same single path',
      () async {
    // `PLATFORM_BASE_URL` arrives from a `--dart-define` and nothing trims it,
    // so this is a real input, not a hypothetical one.
    final _Captured c = await _capture(base: 'http://127.0.0.1:PORT/v1/');
    expect(c.path, '/v1/account');
    expect(c.method, 'DELETE');
  });

  test('a refusal carries the STATUS forward in `detail`, not in the sentence',
      () async {
    // The user-facing sentence stays outcome-shaped; the status has to survive
    // somewhere or an unmodelled one can never be named. See the note on
    // `AccountDeletionFailure.detail`.
    late final core.AccountDeletionFailure failure;
    final HttpServer server =
        await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    addTearDown(() => server.close(force: true));
    unawaited(
      server.forEach((HttpRequest req) async {
        req.response.statusCode = 404;
        req.response.headers.contentType = ContentType.json;
        req.response.write('{"error":"not_found"}');
        await req.response.close();
      }),
    );
    try {
      await requestAccountDeletion(
        RestClient(
          baseUrl: 'http://127.0.0.1:${server.port}/v1',
          tokenProvider: () async => 'tok-123',
        ),
      );
      fail('a 404 must not succeed');
    } on core.AccountDeletionFailure catch (e) {
      failure = e;
    }
    expect(failure.outcome, core.AccountDeletionOutcome.unknown);
    expect(failure.detail, contains('404'));
    expect(failure.toString(), contains('404'));
    expect(
      failure.message,
      core.AccountDeletionOutcome.unknown.plainMessage,
      reason: 'the technical detail must never leak into what the user reads',
    );
  });
}
