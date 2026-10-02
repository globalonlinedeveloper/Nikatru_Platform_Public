import 'package:nikatru_core/nikatru_core.dart' as core;

import 'rest_client.dart';

/// `DELETE {baseUrl}{path}` — the erasure call, with the server's REFUSAL KEPT.
///
/// 🔴 WHY THIS IS A FUNCTION AND NOT A LINE IN EVERY APP. The obvious wiring is
/// `requestServerDeletion: () => rest.delete('/account')`, and that is exactly
/// what the brick shipped. It works, and it throws away the only thing the
/// caller needs: an [ApiException] carries the status, but by the time
/// `AuthRepository.deleteAccount` has wrapped it in an `AuthFailure` the status
/// is a substring of a sentence. Every app would then have to re-derive 501 vs
/// 502 from prose, and the app that got it wrong would be the one telling a user
/// "deletion failed" when their data was gone and their login still worked.
///
/// So the mapping happens ONCE, here, at the only layer that still has the
/// status code, and every caller above sees an [core.AccountDeletionFailure]
/// that names the outcome.
///
/// A 2xx returns normally. Everything else throws.
Future<void> requestAccountDeletion(
  RestClient client, {
  String path = '/account',
}) async {
  final Object? body;
  try {
    body = await client.delete(path);
  } on ApiException catch (e) {
    // ⏱ 2026-09-15 · O-OAUTH-DELETE-REAUTH. 403 `reauth_required`: the route
    // refused a password-less account whose last sign-in is not recent, BEFORE
    // touching anything. That is a failed re-authentication, not a server refusal
    // — the person stays signed in and is asked to sign in with their provider
    // again — so it is `reauthFailed`, never `nothingDeleted` (whose sentence says
    // they were signed out).
    if (e.statusCode == 403 && e.message == 'reauth_required') {
      throw core.AccountDeletionFailure(
        core.AccountDeletionOutcome.reauthFailed,
        detail: 'DELETE $path -> HTTP 403: reauth_required',
      );
    }
    // `statusCode == 0` is RestClient's "no response at all", which
    // AccountDeletionOutcome maps to couldNotReach rather than to a refusal.
    //
    // `detail` carries the status AND the server's own error string forward —
    // never into the user's sentence (that stays `outcome.plainMessage`), only
    // into `toString()`. Without it an unmodelled status arrives as
    // `AccountDeletionOutcome.unknown` and nothing anywhere in the app can say
    // WHICH status it was, which is precisely the hole the 2026-08-09 delete-leg
    // investigation fell into.
    // ⏱ 2026-10-01 · AB-A5-02-client. The server refuses a deletion while a
    // plan is still billing, and its 503 SAYS WHY in `message` — the one 503
    // that carries a sentence for the user. That sentence travels to the
    // dialog instead of being folded into the generic "the server refused":
    // the user's next step is in it. Keyed on the sentence, not the error code,
    // so this shared seam names no app's vocabulary.
    if (e.statusCode == 503 && e.serverSentence != null) {
      throw core.AccountDeletionFailure(
        core.AccountDeletionOutcome.nothingDeleted,
        detail: 'DELETE $path -> HTTP 503: ${e.message}',
        serverSentence: e.serverSentence,
      );
    }
    throw core.AccountDeletionFailure.forStatus(
      e.statusCode,
      detail: 'DELETE $path -> HTTP ${e.statusCode}: ${e.message}',
    );
  }
  // ⏱ 2026-09-15 · [ADR 081]: A 2xx IS NOT ALWAYS "DELETED". The route answers
  // 202 `erasure_pending` when it accepted the deletion and an app could not be
  // reached: that app's data and the sign-in are removed later, automatically.
  // Reported through the same failure channel as every other not-gone outcome,
  // because the seam's contract is "returns only when the account is gone" — the
  // screen then shows [core.AccountDeletionOutcome.pending]'s sentence, never
  // "your account has been deleted".
  if (body is Map && body['status'] == 'erasure_pending') {
    throw core.AccountDeletionFailure(
      core.AccountDeletionOutcome.pending,
      detail: 'DELETE $path -> HTTP 202 erasure_pending: ${body['pending']}',
    );
  }
}

/// ⏱ 2026-09-16 · O-SIWA-TOKEN-NOT-REVOKED-ON-DELETE — `PUT {baseUrl}/account/apple-token`.
///
/// Hands the identity provider's own refresh token to the server that will revoke
/// it when this account is deleted. It lives beside [requestAccountDeletion]
/// because it is the same erasure: without this call the deletion has nothing to
/// revoke with, and the server refuses to report such a deletion as finished.
///
/// 🔴 THE TOKEN GOES IN THE BODY, NEVER IN A URL, and nothing here logs it. A
/// query parameter would land in every proxy log between here and the Worker.
///
/// Throws [ApiException] on a refusal, which the caller treats as "not captured"
/// — the next sign-in offers another token.
///
/// ⏱ 2026-09-24 · KEPT, UNCHANGED ON THE WIRE, for callers that only ever held an
/// Apple token (the app template). The server keeps this path as an alias that
/// writes `provider = 'apple'`; [storeProviderRefreshToken] is the general form.
Future<void> storeAppleRefreshToken(
  RestClient client,
  String refreshToken, {
  required String appId,
  String path = '/account/apple-token',
}) async {
  // `appId` is the row's PROVENANCE MARKER, not a permission: the shared
  // Worker's production monitor attributes each stored token to an app the
  // factory ships, the way it does for a pending erasure.
  final Map<String, Object?> appleTokenBody = <String, Object?>{
    'refreshToken': refreshToken,
    'appId': appId,
  };
  await client.put(path, body: appleTokenBody);
}

/// ⏱ 2026-09-24 · O-GOOGLE-SIGN-IN-NOT-BUILT — `PUT {baseUrl}/account/provider-token`.
///
/// [storeAppleRefreshToken] for any identity provider the server revokes at on
/// deletion: `provider` is `apple` or `google`, and the server refuses (400) a
/// provider this account has not linked. Same rules as above: the token goes in
/// the body, nothing here logs it, and a refusal throws [ApiException].
Future<void> storeProviderRefreshToken(
  RestClient client, {
  required String provider,
  required String refreshToken,
  required String appId,
  String path = '/account/provider-token',
}) async {
  final Map<String, Object?> providerTokenBody = <String, Object?>{
    'provider': provider,
    'refreshToken': refreshToken,
    'appId': appId,
  };
  await client.put(path, body: providerTokenBody);
}

/// ⏱ 2026-10-02 · review of #1155, finding 1 — `PUT {baseUrl}/account/apple-code`.
///
/// The native Sign in with Apple sheet's one-time authorization code, which
/// the server exchanges at Apple (with the key only it holds) for the refresh
/// token an account deletion revokes with. Body `{authorizationCode, appId}`;
/// the server refuses (400) an account that has not linked Apple and a code
/// Apple will not exchange. Nothing here logs the code; a refusal throws
/// [ApiException].
Future<void> exchangeAppleAuthorizationCode(
  RestClient client, {
  required String authorizationCode,
  required String appId,
  String path = '/account/apple-code',
}) async {
  final Map<String, Object?> appleCodeBody = <String, Object?>{
    'authorizationCode': authorizationCode,
    'appId': appId,
  };
  await client.put(path, body: appleCodeBody);
}

/// ⏱ 2026-10-02 · review of #1155, finding 3 — `POST
/// {baseUrl}/account/identity-change`. Asks the server whether THIS session
/// may link or unlink a sign-in method: it answers 200, or 403
/// `reauth_required` when the token's own last authentication is too old. A
/// refusal throws [ApiException]; the caller changes nothing.
Future<void> checkSignInMethodChange(
  RestClient client, {
  String path = '/account/identity-change',
}) async {
  await client.post(path);
}
