import 'dart:async';

import 'package:nikatru_core/nikatru_core.dart' as core;

/// A REAL in-memory implementation of [core.AuthRepository] — not a mock.
///
/// [pipeline C-15] The lock says the auth seam must be **wired, not mocked**. A
/// freshly stamped app has no Supabase project until the owner supplies the
/// identity `--dart-define`s, and the alternative to this class is a stub that
/// returns null from everything — which is the fail-closed shape [pipeline C-6]
/// exists to catch: every test passes, because refusing is the correct answer
/// when nothing is configured, and nobody ever exercises the open path.
///
/// So this one actually works. It signs in, holds a session, emits on
/// [authStateChanges], expires, and signs out. A widget test that drives it
/// drives the same interface production drives — the only thing missing is the
/// network.
///
/// It is NOT a security boundary and never validates a password: it is the
/// demo/test identity, exactly as `NoOpAnalytics` is the demo/test rail.
class InMemoryAuthRepository implements core.AuthRepository {
  InMemoryAuthRepository({this.sessionLifetime = const Duration(hours: 1)});

  /// How long an issued session lasts, so expiry is exercisable rather than
  /// theoretical.
  final Duration sessionLifetime;

  final StreamController<core.AuthUser?> _changes =
      StreamController<core.AuthUser?>.broadcast();

  core.AuthUser? _user;
  core.AuthSession? _session;
  int _issued = 0;

  /// Set when [deleteAccount] succeeds, so a test can assert the request really
  /// happened rather than assert the absence of a crash.
  bool deletionRequested = false;

  @override
  core.AuthUser? get currentUser => _user;

  @override
  Stream<core.AuthUser?> authStateChanges() => _changes.stream;

  core.AuthUser _signIn(String email) {
    final core.AuthUser u = core.AuthUser(
      id: 'in-memory-${email.hashCode.toUnsigned(32)}',
      email: email,
    );
    _user = u;
    _session = core.AuthSession(
      // Distinct per sign-in: a test that asserts the token REACHED the HTTP
      // layer would pass against a constant even when nothing refreshed.
      accessToken: 'in-memory-token-${++_issued}',
      refreshToken: 'in-memory-refresh-$_issued',
      expiresAt: DateTime.now().toUtc().add(sessionLifetime),
    );
    _changes.add(u);
    return u;
  }

  @override
  Future<core.AuthUser> signInWithEmail({
    required String email,
    required String password,
  }) async {
    if (email.isEmpty || password.isEmpty) {
      throw core.AuthFailure('Email and password are required');
    }
    return _signIn(email);
  }

  @override
  Future<core.AuthUser> signUpWithEmail({
    required String email,
    required String password,
  }) async => signInWithEmail(email: email, password: password);

  @override
  Future<void> signInWithApple() async => _signIn('apple.user@example.com');

  @override
  Future<void> sendPasswordReset(String email) async {}

  @override
  Future<void> signOut() async {
    _user = null;
    _session = null;
    _changes.add(null);
  }

  @override
  Future<String?> currentAccessToken() async {
    final core.AuthSession? s = _session;
    if (s == null) return null;
    // Expiry is REAL here. A token store that hands back an expired token is
    // how a caller ends up retrying a 401 forever.
    final DateTime? exp = s.expiresAt;
    if (exp != null && !exp.isAfter(DateTime.now().toUtc())) return null;
    return s.accessToken;
  }

  @override
  Future<core.AuthSession?> currentSession() async => _session;

  @override
  Future<void> deleteAccount() async {
    if (_user == null) throw core.AuthFailure('Not signed in');
    deletionRequested = true;
    await signOut();
  }

  /// Release the broadcast controller. Call from a test's tearDown.
  Future<void> dispose() => _changes.close();
}
