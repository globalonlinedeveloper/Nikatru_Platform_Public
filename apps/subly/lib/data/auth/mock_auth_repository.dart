import 'dart:async';

import 'auth_models.dart';
import 'auth_repository.dart';

/// In-memory auth used automatically when Supabase isn't configured, so the
/// whole app is explorable (every screen, sign-in → scan → dashboard) with no
/// backend. Never used once real credentials are supplied.
class MockAuthRepository implements AuthRepository {
  final StreamController<AuthUser?> _controller =
      StreamController<AuthUser?>.broadcast();
  AuthUser? _user;

  AuthUser _demoUser(String email) => AuthUser(
    id: 'demo-user',
    email: email.isEmpty ? 'alex@example.com' : email,
    displayName: 'Alex Rivera',
  );

  @override
  AuthUser? get currentUser => _user;

  @override
  Stream<AuthUser?> authStateChanges() => _controller.stream;

  @override
  Future<AuthUser> signInWithEmail({
    required String email,
    required String password,
  }) async {
    await Future<void>.delayed(const Duration(milliseconds: 250));
    _user = _demoUser(email);
    _controller.add(_user);
    return _user!;
  }

  @override
  Future<AuthUser> signUpWithEmail({
    required String email,
    required String password,
  }) => signInWithEmail(email: email, password: password);

  @override
  Future<void> signInWithApple() async {
    await Future<void>.delayed(const Duration(milliseconds: 250));
    _user = _demoUser('alex@example.com');
    _controller.add(_user);
  }

  @override
  Future<void> sendPasswordReset(String email) async {}

  @override
  Future<void> signOut() async {
    _user = null;
    _controller.add(null);
  }

  @override
  Future<String?> currentAccessToken() async =>
      _user == null ? null : 'demo-token';

  @override
  Future<AuthSession?> currentSession() async => _user == null
      ? null
      // No expiry: the demo token never lapses, and `isValidAt` treats an
      // unknown expiry as still-valid rather than guessing on the client.
      : const AuthSession(accessToken: 'demo-token');
  /// [pipeline C-15] Added when core's AuthRepository gained this member.
  /// apps/subly is frozen (39-CHASSIS cut 1), so this is the minimum that keeps
  /// it compiling — the real client lives in packages/auth_supabase.
  @override
  Future<void> deleteAccount() async {
    if (currentUser == null) throw AuthFailure('Not signed in');
    await signOut();
  }
}
