import 'rest_client.dart';

/// POST /v1/sessions/revoke-all, exactly as the register names the route.
const String workerRevokeAllRoute = '/v1/sessions/revoke-all';

/// ⏱ 2026-10-02 · AB-A4-01, O-LOGOUT-ALL-NEVER-REACHES-WORKER-REVOCATION —
/// `POST {baseUrl}/sessions/revoke-all`: every Worker refuses every access token
/// issued to this account up to now.
///
/// 🔴 WHY GOTRUE'S GLOBAL SIGN-OUT IS NOT ENOUGH ON ITS OWN. It ends the refresh
/// tokens, and nothing else: an access token another device already holds keeps
/// working at both Workers on its signature alone for up to an hour. This call
/// writes the Workers' revocation list (services/platform/src/routes/sessions.ts),
/// so "Log out of all devices" and a password reset end those tokens too.
///
/// 🔴 A 2xx IS NOT ALWAYS DONE. The route answers 200 `{d1Pending: true}` when it
/// refused the tokens but could not raise the browser-extension link floor in
/// D1 (tooling/platform-register.json, sessions-revoke-all). That is an
/// [ApiException] (`d1_pending`), never a quiet success.
///
/// 🔴 RETRIED ONLY WHEN NOTHING CAME BACK, AND NEVER AFTER AN ANSWER (review 1
/// of #1140, finding 1). An answered revoke-all has written the Workers'
/// record, which refuses every token issued before it, [accessToken] included:
/// asking again with the same token can only be told 401. So:
///   · any ANSWER is final — 204 done; `d1Pending` and every refusal thrown;
///   · a transport failure (no response: statusCode 0) is asked again, up to
///     [attempts] times in all, because the request may never have arrived;
///   · a 401 to such a RETRY is the lost first attempt's own record refusing
///     its token: the revoke landed, so it is done. A 401 to the FIRST attempt
///     is a refusal like any other.
///
/// [accessToken] is the bearer, handed in rather than read from [client]:
/// "Log out of all devices" calls this after GoTrue's global sign-out, when
/// the app holds no session to read one from. Only [client]'s base URL and
/// transport are used.
///
/// A refusal throws [ApiException] (statusCode 0 is "no response at all"). The
/// caller decides what the person is told; this function never swallows one.
///
/// The route is [workerRevokeAllRoute], written as tooling/platform-register.json
/// names it, so assert-platform-register's rename check and limb 3 of
/// assert-session-revocation both key on this one literal.
Future<void> requestWorkerSessionRevocation(
  RestClient client, {
  required String accessToken,
  int attempts = 2,
}) async {
  // The platform REST client's base already ends in `/v1`.
  final String path = workerRevokeAllRoute.substring('/v1'.length);
  final RestClient bearing = client.bearing(accessToken);
  for (int attempt = 1; ; attempt++) {
    final Object? body;
    try {
      body = await bearing.post(path);
    } on ApiException catch (e) {
      if (e.isOffline && attempt < attempts) continue;
      if (attempt > 1 && e.statusCode == 401) return;
      rethrow;
    }
    if (body is Map && body['d1Pending'] == true) {
      throw ApiException(
        200,
        'd1_pending',
        detail:
            'POST $path -> 200 d1Pending: tokens refused, link floor not raised',
      );
    }
    return;
  }
}
