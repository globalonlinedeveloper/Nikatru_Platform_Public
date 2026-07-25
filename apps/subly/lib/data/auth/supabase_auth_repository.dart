import 'package:supabase_flutter/supabase_flutter.dart' as sb;

import 'auth_models.dart';
import 'auth_repository.dart';

/// Supabase (GoTrue) implementation. Pure REST under the hood, so this same
/// class works on all six platforms with no desktop-specific package.
class SupabaseAuthRepository implements AuthRepository {
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
}
