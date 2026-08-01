import 'package:dio/dio.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;

/// dio-backed [core.EntitlementTransport]. `GET {platformBaseUrl}/v1/entitlements
/// ?app_id=&lt;id&gt;` → the shared platform Worker → the one `entitlements` table
/// every app in the portfolio shares ([ADR 020], [pipeline 5]M-4).
///
/// AUTHENTICATED, unlike [DioConsentTransport] and [DioEventTransport]: this is
/// the one platform read that is about a PERSON. The host answers 401 without a
/// token and scopes every row by `(user_id, app_id)`.
///
/// ⚠️ ONE READ PER SESSION-ISH, NEVER PER SCREEN. The whole portfolio shares a
/// 100k Worker-requests/day free ceiling across ~50 apps; an entitlement read
/// wired into a widget's `build` would spend it. Callers go through the
/// entitlement cache and refresh on a bounded schedule.
class DioEntitlementTransport implements core.EntitlementTransport {
  DioEntitlementTransport({required String platformBaseUrl, Dio? httpClient})
    : _base = platformBaseUrl,
      _dio = httpClient ?? Dio();

  final String _base;
  final Dio _dio;

  @override
  Future<core.Result<core.Entitlements>> fetch({
    required String appId,
    required String? accessToken,
  }) async {
    // 🔴 REFUSED HERE, NOT AT THE SERVER. A signed-out read is not an error
    // condition to be discovered over the network — it is a known state, and
    // sending it would spend a request from a shared daily ceiling to be told
    // something this process already knows.
    if (accessToken == null || accessToken.isEmpty) {
      return const core.Result<core.Entitlements>.err(
        core.Failure('no session: entitlements cannot be read'),
      );
    }
    try {
      final Response<dynamic> res = await _dio.get<dynamic>(
        '$_base/v1/entitlements',
        queryParameters: <String, Object?>{'app_id': appId},
        options: Options(
          sendTimeout: const Duration(seconds: 10),
          receiveTimeout: const Duration(seconds: 10),
          validateStatus: (int? s) => s != null && s >= 200 && s < 300,
          headers: <String, Object?>{'authorization': 'Bearer $accessToken'},
        ),
      );
      final Object? body = res.data;
      if (body is! Map) {
        // A 200 whose body is not an object is not an answer. Reporting it as a
        // FAILURE rather than parsing it into `Entitlements.none` is the money
        // boundary again: `none` is a definite "you have not paid", and a
        // definite no is the wrong thing to say about a response nobody could
        // read — the poller would stop, and a paying user would stay locked.
        return const core.Result<core.Entitlements>.err(
          core.Failure('entitlements response was not an object'),
        );
      }
      return core.Result<core.Entitlements>.ok(
        core.Entitlements.fromJson(body.cast<String, dynamic>()),
      );
    } catch (e) {
      return core.Result<core.Entitlements>.err(
        core.Failure('entitlement fetch failed', cause: e),
      );
    }
  }
}
