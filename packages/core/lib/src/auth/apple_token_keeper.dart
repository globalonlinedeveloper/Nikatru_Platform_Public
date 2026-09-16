import 'dart:async';

import 'auth_models.dart';
import 'auth_repository.dart';

/// ⏱ 2026-09-16 · O-SIWA-TOKEN-NOT-REVOKED-ON-DELETE — KEEP THE ONE VALUE A
/// DELETION CANNOT BE DONE WITHOUT, AND KEEP IT SERVER-SIDE.
///
/// 🔴 THE TOKEN IS OFFERED EXACTLY ONCE AND NOBODY ELSE IS HOLDING IT. Apple
/// requires an app offering Sign in with Apple to revoke the user's tokens when
/// their account is deleted, and that call takes a token. The identity provider
/// hands `provider_refresh_token` to the CLIENT in the session that completes the
/// OAuth redirect and stores none of it ("Supabase does not store them for
/// security reasons… it is up to you to store somewhere"), and supabase/auth#1308
/// — "Revoke Sign in with Apple tokens" — is closed as NOT PLANNED. It is also
/// gone from the next session: a refresh replaces it with null. So the window in
/// which it can be captured is the moment the sign-in lands, which is what this
/// watches for.
///
/// ⚠️ IT DOES NOT STORE THE TOKEN ON THE DEVICE. [send] posts it to the server
/// that will do the revoking, and nothing here writes it anywhere else: a copy in
/// device storage would be a credential this app has no use for.
///
/// Sends at most once per distinct token — a sign-out and back in mints a new one
/// and that one is sent — and a failed send is not retried, deliberately: the
/// next sign-in offers another token, and a retry loop around a credential is a
/// place for one to sit in memory.
StreamSubscription<AuthUser?> keepAppleRefreshToken({
  required AuthRepository auth,
  required Future<void> Function(String refreshToken) send,
  void Function(Object error)? onError,
}) {
  String? lastSent;
  return auth.authStateChanges().listen((AuthUser? user) async {
    if (user == null) return;
    try {
      final AuthSession? session = await auth.currentSession();
      final String? token = session?.providerRefreshToken;
      if (token == null || token.isEmpty || token == lastSent) return;
      lastSent = token;
      await send(token);
    } catch (e) {
      // A failed capture must never break a sign-in: the person is now signed in
      // either way, and the only cost is that their next deletion has nothing to
      // revoke with — which the server refuses loudly rather than skipping.
      onError?.call(e);
    }
  });
}
