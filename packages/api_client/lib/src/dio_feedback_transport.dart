import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;

/// dio-backed [core.FeedbackTransport]: `POST {feedbackBaseUrl}/v1/feedback` →
/// the feedback Worker (services/feedback) → a `feedback_reports` row in the
/// APAC platform database, and the screenshot in a private bucket. Lane
/// feedback-intake, O-FEEDBACK-INTAKE-UNBUILT.
///
/// The body is `multipart/form-data` with a `report` part (the JSON the person
/// previewed) and, only when one was attached, a `screenshot` part (PNG). The
/// Worker reads the account from the verified bearer, never from a body field,
/// so there is no reporter key on the wire; with no session the report is
/// anonymous.
///
/// Every answer is reduced to [core.FeedbackSendResult]: 201/200 sent; no
/// answer, 5xx, 503 (`intake_closed`) and 429 retry later (the outbox keeps the
/// report, and the Retry-After is passed on); any other 4xx refused.
class DioFeedbackTransport implements core.FeedbackTransport {
  DioFeedbackTransport({required String feedbackBaseUrl, Dio? httpClient})
    : _base = feedbackBaseUrl,
      _dio = httpClient ?? Dio();

  final String _base;
  final Dio _dio;

  @override
  Future<core.FeedbackSendResult> submit({
    required core.FeedbackSubmission submission,
    required String? accessToken,
  }) async {
    final FormData form = FormData.fromMap(<String, Object?>{
      'report': jsonEncode(submission.report),
      if (submission.screenshot != null)
        'screenshot': MultipartFile.fromBytes(
          submission.screenshot!,
          filename: 'screenshot.png',
          contentType: DioMediaType('image', 'png'),
        ),
    });
    final Response<dynamic> res;
    try {
      res = await _dio.post<dynamic>(
        '$_base/v1/feedback',
        data: form,
        options: Options(
          sendTimeout: const Duration(seconds: 30),
          receiveTimeout: const Duration(seconds: 15),
          validateStatus: (int? s) => s != null,
          headers: <String, Object?>{
            if (accessToken != null && accessToken.isNotEmpty)
              'authorization': 'Bearer $accessToken',
          },
        ),
      );
    } on DioException catch (e) {
      return core.FeedbackSendResult.retryLater(
        error: 'no_response:${e.type.name}',
      );
    }
    final int status = res.statusCode ?? 0;
    final Object? body = res.data;
    final String? error = body is Map ? body['error'] as String? : null;
    if (status == 200 || status == 201) {
      final Object? id = body is Map ? body['id'] : null;
      if (id is String && id.startsWith('FB-')) {
        return core.FeedbackSendResult.sent(id);
      }
      return const core.FeedbackSendResult.retryLater(error: 'not_a_receipt');
    }
    if (status == 429 || status >= 500 || status == 0) {
      final int? seconds = int.tryParse(
        res.headers.value('retry-after')?.trim() ?? '',
      );
      return core.FeedbackSendResult.retryLater(
        error: error ?? 'http_$status',
        retryAfter: seconds == null ? null : Duration(seconds: seconds),
      );
    }
    return core.FeedbackSendResult.refused(error ?? 'http_$status');
  }
}
