import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:supabase_flutter/supabase_flutter.dart' as sb;

/// Supabase (GoTrue) implementation of core's [core.AuthRepository].
///
/// [pipeline C-15] THE ONLY PLACE THE SUPABASE SDK IS IMPORTED. Everything above
/// the data layer programs against the interface in `packages/core`, so swapping
/// identity providers means writing one more class here — not touching an app.
/// `assert-package-boundaries.mjs` fails the build if an app reaches for the SDK
/// directly.
///
/// Pure REST underneath, so the same class serves all six platforms with no
/// desktop-specific package.
class SupabaseAuthRepository implements core.AuthRepository {
  SupabaseAuthRepository({
    sb.GoTrueClient? client,
    Future<void> Function()? requestServerDeletion,
  })  : _injected = client,
        _requestServerDeletion = requestServerDeletion;

  final sb.GoTrueClient? _injected;

  /// Calls the backend's delete-account route. Injected because that route is
  /// **stage 4's** and does not exist yet — see [deleteAccount].
  final Future<void> Function()? _requestServerDeletion;

  sb.GoTrueClient get _auth => _injected ?? sb.Supabase.instance.client.auth;

  core.AuthUser? _map(sb.User? u) => u == null
      ? null
      : core.AuthUser(
          id: u.id,
          email: u.email ?? '',
          displayName: u.userMetadata?['full_name'] as String?,
        );

  @override
  core.AuthUser? get currentUser => _map(_auth.currentUser);

  @override
  Stream<core.AuthUser?> authStateChanges() =>
      _auth.onAuthStateChange.map((sb.AuthState s) => _map(s.session?.user));

  @override
  Future<core.AuthUser> signInWithEmail({
    required String email,
    required String password,
  }) async {
    final sb.AuthResponse res = await _auth.signInWithPassword(
      email: email,
      password: password,
    );
    final core.AuthUser? u = _map(res.user);
    if (u == null) throw core.AuthFailure('Sign-in failed');
    return u;
  }

  @override
  Future<core.AuthUser> signUpWithEmail({
    required String email,
    required String password,
  }) async {
    final sb.AuthResponse res = await _auth.signUp(
      email: email,
      password: password,
    );
    final core.AuthUser? u = _map(res.user);
    if (u == null) throw core.AuthFailure('Sign-up failed');
    return u;
  }

  @override
  Future<void> signInWithApple() async {
    // 🔴 [G-43] WEB MUST BE A FULL-PAGE REDIRECT, NEVER A POPUP. Popups are
    // blocked by default in several browsers unless the call sits inside a
    // direct user-gesture handler, and they break outright in embedded webviews
    // and in PWAs launched standalone. `authScreenLaunchMode: platformDefault`
    // on web means the SDK navigates the page itself; forcing an external
    // application there is what produces the popup.
    //
    // Completion surfaces on authStateChanges(), never as a return value —
    // the app is torn down and rebuilt by the redirect on some platforms, so
    // there is no continuation to return to.
    await _auth.signInWithOAuth(
      sb.OAuthProvider.apple,
      authScreenLaunchMode: kIsWeb
          ? sb.LaunchMode.platformDefault
          : sb.LaunchMode.externalApplication,
    );
  }

  @override
  Future<void> sendPasswordReset(String email) =>
      _auth.resetPasswordForEmail(email);

  @override
  Future<void> signOut() => _auth.signOut();

  @override
  Future<String?> currentAccessToken() async =>
      _auth.currentSession?.accessToken;

  @override
  Future<core.AuthSession?> currentSession() async {
    final sb.Session? s = _auth.currentSession;
    if (s == null) return null;
    return core.AuthSession(
      accessToken: s.accessToken,
      refreshToken: s.refreshToken,
      // GoTrue reports expiry as UNIX seconds; null when it does not know.
      expiresAt: s.expiresAt == null
          ? null
          : DateTime.fromMillisecondsSinceEpoch(
              s.expiresAt! * 1000,
              isUtc: true,
            ),
    );
  }

  /// [pipeline C-13] gotrue's `updateUser` writes `auth.users.user_metadata`,
  /// which is a REAL store — the profile screen was refused on the grounds that
  /// no profile data model existed, and that was never true.
  ///
  /// Writes the SAME `full_name` key [_map] reads. A write to any other key
  /// would succeed forever and change nothing the app displays.
  ///
  /// The SDK emits `userUpdated` on its auth stream, so [authStateChanges]
  /// carries the new user without this doing anything extra.
  @override
  Future<core.AuthUser> updateProfile({required String displayName}) async {
    final sb.UserResponse res = await _auth.updateUser(
      sb.UserAttributes(
        // Empty clears it: storing `''` would give callers a second "no name"
        // case that renders as a blank line instead of the not-set label.
        data: <String, dynamic>{
          'full_name': displayName.isEmpty ? null : displayName,
        },
      ),
    );
    final core.AuthUser? u = _map(res.user);
    if (u == null) throw core.AuthFailure('Could not save your profile');
    return u;
  }

  /// 🔴 [pipeline C-15] THE CLIENT HALF. `DELETE /v1/account` is stage 4's route
  /// and does not exist yet, so the caller injects it. When it is absent this
  /// still signs out and then throws — it does NOT pretend to have deleted
  /// anything, because silently succeeding on a deletion request is the one
  /// outcome a user can never detect and never recover from.
  @override
  Future<void> deleteAccount() async {
    Object? failure;
    try {
      if (_requestServerDeletion == null) {
        failure = core.AuthFailure(
          'Account deletion is not available yet: the server route is not '
          'wired. Your account has NOT been deleted.',
        );
      } else {
        await _requestServerDeletion();
      }
    } catch (e) {
      failure = e;
    }
    // Sign out REGARDLESS. A user who has asked to be deleted must not be left
    // holding a live session — that is the worst of both outcomes.
    try {
      await signOut();
    } catch (_) {
      // Already failing; a sign-out error must not mask the real cause.
    }
    if (failure != null) {
      throw failure is core.AuthFailure
          ? failure
          : core.AuthFailure('Account deletion failed: $failure');
    }
  }
}
