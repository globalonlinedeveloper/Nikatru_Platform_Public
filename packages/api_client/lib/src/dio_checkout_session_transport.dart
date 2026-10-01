import 'package:dio/dio.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;

/// dio-backed [core.CheckoutSessionTransport]. `POST {platformBaseUrl}
/// /v1/checkout` → the shared platform Worker → a Paddle draft transaction
/// carrying our `custom_data` ([ADR 044] §6), and the `checkout_url` to open.
///
/// AUTHENTICATED: the host attributes the transaction to the verified subject,
/// never to a body field, so a checkout can only ever be opened for oneself.
class DioCheckoutSessionTransport implements core.CheckoutSessionTransport {
  DioCheckoutSessionTransport({
    required String platformBaseUrl,
    Dio? httpClient,
  }) : _base = platformBaseUrl,
       _dio = httpClient ?? Dio();

  final String _base;
  final Dio _dio;

  @override
  bool get isAvailable => true;

  @override
  Future<core.Result<core.CheckoutSession>> createSession({
    required String appId,
    required String offeringId,
    required String? accessToken,
  }) async {
    if (accessToken == null || accessToken.isEmpty) {
      return const core.Result<core.CheckoutSession>.err(
        core.Failure('no session: a checkout cannot be opened'),
      );
    }
    try {
      final Response<dynamic> res = await _dio.post<dynamic>(
        '$_base/v1/checkout',
        data: <String, Object?>{'app_id': appId, 'offering_id': offeringId},
        options: Options(
          sendTimeout: const Duration(seconds: 15),
          receiveTimeout: const Duration(seconds: 15),
          validateStatus: (int? s) => s == 200,
          headers: <String, Object?>{
            'authorization': 'Bearer $accessToken',
            'content-type': 'application/json',
          },
        ),
      );
      final Object? body = res.data;
      final core.CheckoutSession? session = body is Map
          ? core.CheckoutSession.fromJson(body.cast<String, Object?>())
          : null;
      if (session == null) {
        return const core.Result<core.CheckoutSession>.err(
          core.Failure('checkout response carried no usable checkout url'),
        );
      }
      return core.Result<core.CheckoutSession>.ok(session);
    } catch (e) {
      // 403 paywall_disabled, 429 rate_limited, 502/503 — dio throws on any of
      // them under this validateStatus. All mean "no page to open"; the rail
      // reports it and the paywall offers Try again.
      return core.Result<core.CheckoutSession>.err(
        core.Failure('checkout request failed', cause: e),
      );
    }
  }
}

/// The checkout transport a build should use: the platform host's when [live],
/// the discard transport otherwise (a demo build, a widget test) — the same
/// discard rule as the entitlement and cancellation transports. One call, so a
/// stamped app's wiring is one argument (O-ST-HOSTED-CHECKOUT-CANNOT-START).
core.CheckoutSessionTransport checkoutSessionsFor(
  bool live,
  String platformBaseUrl,
) => live
    ? DioCheckoutSessionTransport(platformBaseUrl: platformBaseUrl)
    : const core.UnavailableCheckoutSessionTransport();
