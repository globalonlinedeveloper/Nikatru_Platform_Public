import 'package:dio/dio.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;

/// dio-backed [core.ContentReportTransport]. `POST {platformBaseUrl}/v1/report`
/// → the shared platform Worker → a `content_reports` row, and a notice to
/// support. O-PLAY-AI-CONTENT-REPORTING.
///
/// AUTHENTICATED: the host takes the reporter from the verified session, never
/// from a body field, so there is no reporter key on the wire.
class DioContentReportTransport implements core.ContentReportTransport {
  DioContentReportTransport({required String platformBaseUrl, Dio? httpClient})
      : _base = platformBaseUrl,
        _dio = httpClient ?? Dio();

  final String _base;
  final Dio _dio;

  @override
  Future<core.Result<core.ContentReportReceipt>> submit({
    required String appId,
    required String? accessToken,
    required core.ContentReport report,
  }) async {
    if (accessToken == null || accessToken.isEmpty) {
      return const core.Result<core.ContentReportReceipt>.err(
        core.Failure('no session: a content report cannot be sent'),
      );
    }
    if (!report.namesSomething) {
      // The host answers this with 400 `nothing_reported`; refusing here saves
      // the round trip and a slot of the per-hour cap.
      return const core.Result<core.ContentReportReceipt>.err(
        core.Failure('a content report must name the content'),
      );
    }
    try {
      final Response<dynamic> res = await _dio.post<dynamic>(
        '$_base/v1/report',
        data: <String, Object?>{
          'app_id': appId,
          'reason': report.reason.wire,
          'content_ref': _blankToNull(report.contentRef),
          'content_excerpt': _blankToNull(report.contentExcerpt),
          'note': _blankToNull(report.note),
        },
        options: Options(
          sendTimeout: const Duration(seconds: 10),
          receiveTimeout: const Duration(seconds: 10),
          // 202 is the host's success: RECEIVED, not yet reviewed.
          validateStatus: (int? s) => s != null && s >= 200 && s < 300,
          headers: <String, Object?>{
            'authorization': 'Bearer $accessToken',
            'content-type': 'application/json',
          },
        ),
      );
      final Object? body = res.data;
      final core.ContentReportReceipt? receipt = body is Map
          ? core.ContentReportReceipt.fromJson(body.cast<String, Object?>())
          : null;
      if (receipt == null) {
        return const core.Result<core.ContentReportReceipt>.err(
          core.Failure('content report response was not a receipt'),
        );
      }
      return core.Result<core.ContentReportReceipt>.ok(receipt);
    } catch (e) {
      // Every non-2xx lands here under this validateStatus — including 429, the
      // per-hour cap. The dialog says "not sent, try again later" for all of
      // them, which is true of each.
      return core.Result<core.ContentReportReceipt>.err(
        core.Failure('content report failed', cause: e),
      );
    }
  }

  static String? _blankToNull(String? v) {
    final String? t = v?.trim();
    return (t == null || t.isEmpty) ? null : t;
  }
}
