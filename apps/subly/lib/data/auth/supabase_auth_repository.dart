import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:supabase_flutter/supabase_flutter.dart' as sb;

import 'auth_models.dart';
import 'auth_repository.dart';

/// Supabase (GoTrue) implementation. Pure REST under the hood, so this same
/// class works on all six platforms with no desktop-specific package.
class SupabaseAuthRepository implements AuthRepository {
  SupabaseAuthRepository({Future<void> Function()? requestServerDeletion})
    : _requestServerDeletion = requestServerDeletion;

  /// Calls the backend's `DELETE /v1/account`. INJECTED rather than built here
  /// for the same reason `packages/auth_supabase` injects it: the route is
  /// reached through the app's REST client, and this file must not know which
  /// one. Leaving it null keeps the honest refusal for a caller that has no such
  /// route — see [deleteAccount].
  final Future<void> Function()? _requestServerDeletion;

  sb.GoTrueClient get _auth => sb.Supabase.instance.client.auth;

  AuthUser? _map(sb.User? u) => u == null
      ? null
      : AuthUser(
          id: u.id,
          email: u.email ?? '',
          displayName: u.userMetadata?['full_name'] as String?,
        );

  @override
  AuthUser? get currentUser => _map(_auth.currentUser);

  @override
  Stream<AuthUser?> authStateChanges() =>
      _auth.onAuthStateChange.map((sb.AuthState s) => _map(s.session?.user));

  @override
  Future<AuthUser> signInWithEmail({
    required String email,
    required String password,
  }) async {
    final sb.AuthResponse res = await _auth.signInWithPassword(
      email: email,
      password: password,
    );
    final AuthUser? u = _map(res.user);
    if (u == null) throw AuthFailure('Sign-in failed');
    return u;
  }

  @override
  Future<AuthUser> signUpWithEmail({
    required String email,
    required String password,
  }) async {
    final sb.AuthResponse res = await _auth.signUp(
      email: email,
      password: password,
    );
    final AuthUser? u = _map(res.user);
    if (u == null) throw AuthFailure('Sign-up failed');
    return u;
  }

  @override
  Future<void> signInWithApple() async {
    // On desktop (Windows/Linux) supply a localhost or custom-scheme redirect;
    // see backend/README for the callback setup. Completion surfaces on
    // authStateChanges().
    await _auth.signInWithOAuth(sb.OAuthProvider.apple);
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
  Future<AuthSession?> currentSession() async {
    final sb.Session? s = _auth.currentSession;
    if (s == null) return null;
    return AuthSession(
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

  /// [pipeline C-13] Required by the shared `AuthRepository` seam. `updateUser`
  /// writes `auth.users.user_metadata`, and this writes the same `full_name` key
  /// `_map` reads — a write to any other key would succeed forever and change
  /// nothing the app displays.
  @override
  Future<AuthUser> updateProfile({required String displayName}) async {
    final sb.UserResponse res = await _auth.updateUser(
      sb.UserAttributes(
        data: <String, dynamic>{
          'full_name': displayName.isEmpty ? null : displayName,
        },
      ),
    );
    final AuthUser? u = _map(res.user);
    if (u == null) throw AuthFailure('Could not save your profile');
    return u;
  }

  /// 🔴 THE CLIENT HALF. This used to be an UNCONDITIONAL THROW — "the server
  /// route is not wired" — written when `DELETE /v1/account` genuinely did not
  /// exist. It does now ([pipeline B-5], `services/platform/src/routes/account.ts`),
  /// and the refusal outlived its reason: the one shipping app had a seam that
  /// could only ever fail, which is why it also had no Delete-account control.
  /// [ADR 027].
  ///
  /// The shape is the chassis's, deliberately (`packages/auth_supabase`):
  ///   · nothing injected  → still an honest refusal, never a faked success;
  ///   · SIGN OUT REGARDLESS — a user who has asked to be deleted must not be
  ///     left holding a live session, whichever way the request went;
  ///   · a sign-out error must NOT mask the real cause;
  ///   · the failure is RETHROWN UNCHANGED when it is already an
  ///     [core.AccountDeletionFailure], so the 501-vs-502 distinction survives
  ///     all the way to the screen. Flattening it into a new `AuthFailure` here
  ///     is exactly how "your data is gone and your login still works" would
  ///     have been shown as "deletion failed".
  @override
  Future<void> deleteAccount() async {
    Object? failure;
    try {
      if (_requestServerDeletion == null) {
        failure = core.AccountDeletionFailure(
          core.AccountDeletionOutcome.notConfigured,
        );
      } else {
        await _requestServerDeletion();
      }
    } catch (e) {
      failure = e;
    }
    try {
      await signOut();
    } catch (_) {
      // Already failing; a sign-out error must not mask the real cause.
    }
    if (failure != null) {
      throw failure is AuthFailure
          ? failure
          : core.AccountDeletionFailure(
              core.AccountDeletionOutcome.unknown,
              message: 'Account deletion failed: $failure',
            );
    }
  }
}
