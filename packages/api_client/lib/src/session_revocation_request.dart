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
/// D1 (tooling/platform-register.json, sessions-revoke-all: "`d1Pending: true`
/// means RETRY"). So that answer is asked again, up to [attempts] times in all,
/// and still pending after that is an [ApiException] — never a quiet success.
///
/// A refusal throws [ApiException] (statusCode 0 is "no response at all"). The
/// caller decides what the person is told; this function never swallows one.
///
/// The route is [workerRevokeAllRoute], written as tooling/platform-register.json
/// names it, so assert-platform-register's rename check and limb 3 of
/// assert-session-revocation both key on this one literal.
Future<void> requestWorkerSessionRevocation(
  RestClient client, {
  int attempts = 2,
}) async {
  // The platform REST client's base already ends in `/v1`.
  final String path = workerRevokeAllRoute.substring('/v1'.length);
  for (int attempt = 1; ; attempt++) {
    final Object? body = await client.post(path);
    final bool pending = body is Map && body['d1Pending'] == true;
    if (!pending) return;
    if (attempt >= attempts) {
      throw ApiException(
        200,
        'd1_pending',
        detail: 'POST $path -> 200 d1Pending after $attempts attempt(s)',
      );
    }
  }
}
