import 'package:dio/dio.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;

/// dio-backed [core.CancellationTransport]. `POST {platformBaseUrl}
/// /v1/plan/cancel` → the shared platform Worker → an append-only
/// `cancellation_requests` row ([pipeline 5]M-9).
///
/// AUTHENTICATED: the host resolves the plan from the session, never
/// from a body field. A cancel route that took a plan id from the caller
/// would let anybody cancel anybody else's.
class DioCancellationTransport implements core.CancellationTransport {
  DioCancellationTransport({required String platformBaseUrl, Dio? httpClient})
      : _base = platformBaseUrl,
        _dio = httpClient ?? Dio();

  final String _base;
  final Dio _dio;

  @override
  Future<core.Result<core.CancellationReceipt>> requestCancellation({
    required String appId,
    required String? accessToken,
  }) async {
    if (accessToken == null || accessToken.isEmpty) {
      return const core.Result<core.CancellationReceipt>.err(
        core.Failure('no session: cancellation cannot be requested'),
      );
    }
    try {
      final Response<dynamic> res = await _dio.post<dynamic>(
        '$_base/v1/plan/cancel',
        data: <String, Object?>{'app_id': appId},
        options: Options(
          sendTimeout: const Duration(seconds: 10),
          receiveTimeout: const Duration(seconds: 10),
          // 🔴 202 IS A SUCCESS HERE AND IT IS THE COMMON CASE. The host records
          // the request and answers 202 when it could not also execute it on the
          // rail. Treating that as a failure would tell a user their
          // cancellation did not happen when the durable half of it did.
          validateStatus: (int? s) => s != null && s >= 200 && s < 300,
          headers: <String, Object?>{
            'authorization': 'Bearer $accessToken',
            'content-type': 'application/json',
          },
        ),
      );
      final Object? body = res.data;
      if (body is! Map) {
        return const core.Result<core.CancellationReceipt>.err(
          core.Failure('cancellation response was not an object'),
        );
      }
      return core.Result<core.CancellationReceipt>.ok(
        core.CancellationReceipt.fromJson(body.cast<String, Object?>()),
      );
    } catch (e) {
      // Includes the 404 the host returns when there is no subscription: dio
      // throws on a non-2xx under this validateStatus. Reported as a failure,
      // which the UI shows as "we could not cancel" — the honest answer, since
      // from here a 404 and a dropped connection are the same amount of
      // knowledge about whether anything changed.
      return core.Result<core.CancellationReceipt>.err(
        core.Failure('cancellation request failed', cause: e),
      );
    }
  }
}
