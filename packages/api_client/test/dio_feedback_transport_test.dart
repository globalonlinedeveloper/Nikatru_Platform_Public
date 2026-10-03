import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:nikatru_api_client/nikatru_api_client.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:test/test.dart';

/// Answers every request with a fixed status, body and headers, and records it.
class _FakeAdapter implements HttpClientAdapter {
  _FakeAdapter(this.body, {this.status = 201, this.headers = const {}});

  final String body;
  final int status;
  final Map<String, List<String>> headers;
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
        ...headers,
      },
    );
  }
}

DioFeedbackTransport _transport(_FakeAdapter adapter) => DioFeedbackTransport(
  feedbackBaseUrl: 'https://feedback.example.test',
  httpClient: Dio()..httpClientAdapter = adapter,
);

core.FeedbackSubmission _submission({Uint8List? shot}) => core.FeedbackSubmission(
  report: <String, Object?>{
    'idempotencyKey': 'key-12345678',
    'description': 'broken',
  },
  screenshot: shot,
);

void main() {
  test('201 {id} is sent; the request is multipart to /v1/feedback with the bearer', () async {
    final _FakeAdapter adapter = _FakeAdapter(
      jsonEncode(<String, Object?>{'id': 'FB-0123456789', 'status': 'new'}),
    );
    final core.FeedbackSendResult r = await _transport(adapter).submit(
      submission: _submission(shot: Uint8List.fromList(<int>[1, 2, 3])),
      accessToken: 'tok',
    );
    expect(r.kind, core.FeedbackSendKind.sent);
    expect(r.id, 'FB-0123456789');
    final RequestOptions req = adapter.lastRequest!;
    expect(req.method, 'POST');
    expect(req.uri.toString(), 'https://feedback.example.test/v1/feedback');
    expect(req.headers['authorization'], 'Bearer tok');
    final FormData form = req.data as FormData;
    expect(form.fields.single.key, 'report');
    expect(jsonDecode(form.fields.single.value), <String, Object?>{
      'idempotencyKey': 'key-12345678',
      'description': 'broken',
    });
    expect(form.files.single.key, 'screenshot');
  });

  test('signed out: no authorization header at all, and no screenshot part without one', () async {
    final _FakeAdapter adapter = _FakeAdapter(
      jsonEncode(<String, Object?>{'id': 'FB-0123456789'}),
      status: 200,
    );
    await _transport(adapter).submit(submission: _submission(), accessToken: null);
    expect(adapter.lastRequest!.headers.containsKey('authorization'), isFalse);
    expect((adapter.lastRequest!.data as FormData).files, isEmpty);
  });

  test('429 and 503 are retry-later, with the Retry-After passed on', () async {
    final core.FeedbackSendResult limited = await _transport(
      _FakeAdapter(
        jsonEncode(<String, Object?>{'error': 'rate_limited'}),
        status: 429,
        headers: <String, List<String>>{'retry-after': <String>['3600']},
      ),
    ).submit(submission: _submission(), accessToken: null);
    expect(limited.kind, core.FeedbackSendKind.retryLater);
    expect(limited.retryAfter, const Duration(hours: 1));
    final core.FeedbackSendResult closed = await _transport(
      _FakeAdapter(jsonEncode(<String, Object?>{'error': 'intake_closed'}), status: 503),
    ).submit(submission: _submission(), accessToken: null);
    expect(closed.kind, core.FeedbackSendKind.retryLater);
    expect(closed.error, 'intake_closed');
  });

  test('any other 4xx is refused, never retried', () async {
    final core.FeedbackSendResult r = await _transport(
      _FakeAdapter(jsonEncode(<String, Object?>{'error': 'required'}), status: 422),
    ).submit(submission: _submission(), accessToken: null);
    expect(r.kind, core.FeedbackSendKind.refused);
    expect(r.error, 'required');
  });

  test('a 2xx that is not a receipt is not "sent"', () async {
    final core.FeedbackSendResult r = await _transport(
      _FakeAdapter(jsonEncode(<String, Object?>{'ok': true}), status: 201),
    ).submit(submission: _submission(), accessToken: null);
    expect(r.kind, core.FeedbackSendKind.retryLater);
  });
}
