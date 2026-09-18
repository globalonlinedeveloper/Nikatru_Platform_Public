import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:nikatru_api_client/nikatru_api_client.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:test/test.dart';

/// Answers every request with a fixed status and body and records it.
class _FakeAdapter implements HttpClientAdapter {
  _FakeAdapter(this.body, {this.status = 202});

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

DioContentReportTransport _transport(_FakeAdapter adapter) =>
    DioContentReportTransport(
      platformBaseUrl: 'https://platform.example.test',
      httpClient: Dio()..httpClientAdapter = adapter,
    );

const core.ContentReport _report = core.ContentReport(
  reason: core.ContentReportReason.selfHarm,
  contentExcerpt: '  the generated text  ',
  note: '   ',
);

void main() {
  test('202 with {ok, id} is a receipt, and the request is the pinned shape',
      () async {
    final _FakeAdapter adapter = _FakeAdapter(
      jsonEncode(<String, Object?>{'ok': true, 'id': 'r-1'}),
    );
    final core.Result<core.ContentReportReceipt> r = await _transport(adapter)
        .submit(appId: 'demo', accessToken: 'tok', report: _report);

    expect(r.fold((core.ContentReportReceipt v) => v.id, (_) => null), 'r-1');
    final RequestOptions req = adapter.lastRequest!;
    expect(req.method, 'POST');
    expect(req.uri.toString(), 'https://platform.example.test/v1/report');
    expect(req.headers['authorization'], 'Bearer tok');
    // Blank text goes as null, the wire reason is the server's spelling.
    expect(req.data, <String, Object?>{
      'app_id': 'demo',
      'reason': 'self_harm',
      'content_ref': null,
      'content_excerpt': 'the generated text',
      'note': null,
    });
  });

  test('429 (the per-hour cap) is a failure, never a receipt', () async {
    final _FakeAdapter adapter = _FakeAdapter(
      jsonEncode(<String, Object?>{'error': 'rate_limited'}),
      status: 429,
    );
    final core.Result<core.ContentReportReceipt> r = await _transport(adapter)
        .submit(appId: 'demo', accessToken: 'tok', report: _report);
    expect(r.isOk, isFalse);
  });

  test('a 2xx that is not a receipt is a failure', () async {
    for (final Map<String, Object?> body in <Map<String, Object?>>[
      <String, Object?>{'ok': false, 'id': 'r-1'},
      <String, Object?>{'ok': true},
      <String, Object?>{'ok': true, 'id': ''},
    ]) {
      final core.Result<core.ContentReportReceipt> r =
          await _transport(_FakeAdapter(jsonEncode(body)))
              .submit(appId: 'demo', accessToken: 'tok', report: _report);
      expect(r.isOk, isFalse, reason: '$body');
    }
  });

  test('no session and an empty report never reach the network', () async {
    final _FakeAdapter adapter = _FakeAdapter('{}');
    final DioContentReportTransport t = _transport(adapter);
    expect(
      (await t.submit(appId: 'demo', accessToken: null, report: _report)).isOk,
      isFalse,
    );
    expect(
      (await t.submit(
        appId: 'demo',
        accessToken: 'tok',
        report: const core.ContentReport(
          reason: core.ContentReportReason.other,
          contentRef: ' ',
          note: 'only a note',
        ),
      ))
          .isOk,
      isFalse,
    );
    expect(adapter.calls, 0);
  });

  test('the Unavailable transport answers "could not send"', () async {
    final core.Result<core.ContentReportReceipt> r =
        await const core.UnavailableContentReportTransport()
            .submit(appId: 'demo', accessToken: 'tok', report: _report);
    expect(r.isOk, isFalse);
  });
}
