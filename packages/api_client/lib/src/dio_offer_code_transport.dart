import 'package:dio/dio.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;

/// dio-backed [core.OfferCodeTransport] — the client for the platform
/// Worker's own offer codes and invite-a-friend (lane growth-codes;
/// `services/platform/src/routes/codes.ts`, `routes/invites.ts`):
///
/// - `POST {platformBaseUrl}/v1/codes/redeem` — `{code, idempotencyKey}`;
/// - `POST {platformBaseUrl}/v1/invites/code|claim|settle` — `{app, code?}`.
///
/// AUTHENTICATED: a signed-out call is refused here, before it spends a
/// request. Only a channel whose capability row allows our own code field
/// calls [redeem] (packages/purchases `redeemMechanismFor`).
class DioOfferCodeTransport implements core.OfferCodeTransport {
  DioOfferCodeTransport({required String platformBaseUrl, Dio? httpClient})
    : _base = platformBaseUrl,
      _dio = httpClient ?? Dio();

  final String _base;
  final Dio _dio;

  static const core.Failure _noSession = core.Failure(
    'no session: an offer code cannot be redeemed',
  );

  static bool _signedOut(String? t) => t == null || t.isEmpty;

  Options _options(String accessToken) => Options(
    sendTimeout: const Duration(seconds: 15),
    receiveTimeout: const Duration(seconds: 15),
    validateStatus: (int? s) => s != null && s >= 200 && s < 600,
    headers: <String, Object?>{'authorization': 'Bearer $accessToken'},
  );

  Future<Response<dynamic>> _post(
    String path,
    String accessToken,
    Map<String, Object?> body,
  ) => _dio.post<dynamic>(
    '$_base$path',
    data: body,
    options: _options(accessToken),
  );

  @override
  Future<core.Result<core.RedeemedOffer>> redeem({
    required String? accessToken,
    required String code,
    required String idempotencyKey,
  }) async {
    if (_signedOut(accessToken)) {
      return const core.Result<core.RedeemedOffer>.err(_noSession);
    }
    try {
      final Response<dynamic> res = await _post(
        '/v1/codes/redeem',
        accessToken!,
        <String, Object?>{'code': code, 'idempotencyKey': idempotencyKey},
      );
      final int status = res.statusCode ?? 0;
      if (status != 200) {
        return core.Result<core.RedeemedOffer>.err(
          core.Failure(
            'redeem refused ($status)',
            cause: core.RedeemRefusal.forStatus(status),
          ),
        );
      }
      final core.RedeemedOffer? offer = core.RedeemedOffer.tryParse(res.data);
      return offer == null
          ? const core.Result<core.RedeemedOffer>.err(
              core.Failure('redeem: the answer is not a redemption'),
            )
          : core.Result<core.RedeemedOffer>.ok(offer);
    } catch (e) {
      return core.Result<core.RedeemedOffer>.err(
        core.Failure('redeem failed', cause: e),
      );
    }
  }

  @override
  Future<core.Result<String>> inviteCode({
    required String? accessToken,
    required String app,
  }) async {
    if (_signedOut(accessToken)) {
      return const core.Result<String>.err(_noSession);
    }
    try {
      final Response<dynamic> res = await _post(
        '/v1/invites/code',
        accessToken!,
        <String, Object?>{'app': app},
      );
      final Object? data = res.data;
      if (res.statusCode != 200 || data is! Map || data['code'] is! String) {
        return core.Result<String>.err(
          core.Failure('invite code refused (${res.statusCode})'),
        );
      }
      return core.Result<String>.ok(data['code'] as String);
    } catch (e) {
      return core.Result<String>.err(
        core.Failure('invite code failed', cause: e),
      );
    }
  }

  Future<core.Result<core.InviteState>> _invite(
    String path,
    String? accessToken,
    Map<String, Object?> body,
  ) async {
    if (_signedOut(accessToken)) {
      return const core.Result<core.InviteState>.err(_noSession);
    }
    try {
      final Response<dynamic> res = await _post(path, accessToken!, body);
      final int status = res.statusCode ?? 0;
      final core.InviteState? state = status == 200 || status == 202
          ? core.InviteState.tryParse(res.data)
          : null;
      return state == null
          ? core.Result<core.InviteState>.err(
              core.Failure('invite refused ($status)'),
            )
          : core.Result<core.InviteState>.ok(state);
    } catch (e) {
      return core.Result<core.InviteState>.err(
        core.Failure('invite failed', cause: e),
      );
    }
  }

  @override
  Future<core.Result<core.InviteState>> claimInvite({
    required String? accessToken,
    required String app,
    required String code,
  }) => _invite('/v1/invites/claim', accessToken, <String, Object?>{
    'app': app,
    'code': code,
  });

  @override
  Future<core.Result<core.InviteState>> settleInvite({
    required String? accessToken,
    required String app,
  }) =>
      _invite('/v1/invites/settle', accessToken, <String, Object?>{'app': app});
}
