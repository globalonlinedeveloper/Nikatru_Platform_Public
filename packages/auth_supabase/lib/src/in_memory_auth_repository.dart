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
///
/// ⚠️ ONE MEMBER DELIBERATELY REFUSES: [deleteAccount]. That is not the
/// fail-closed shape above — it is [ADR 027]. Read its doc before "fixing" it.
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

  /// Set when [deleteAccount] REACHES the seam — before it refuses — so a test
  /// can assert the request really happened rather than assert the absence of a
  /// crash. It records arrival, never success: see [deleteAccount], which always
  /// throws here ([ADR 027]).
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
  }) async =>
      signInWithEmail(email: email, password: password);

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
  Future<core.AuthUser> updateProfile({required String displayName}) async {
    final core.AuthUser? current = _user;
    if (current == null) throw core.AuthFailure('Not signed in');
    final core.AuthUser updated = core.AuthUser(
      id: current.id,
      email: current.email,
      // Empty clears it. One "no name" case, not two that render differently.
      displayName: displayName.isEmpty ? null : displayName,
    );
    _user = updated;
    // EMITTING IS THE POINT, not bookkeeping: a screen showing the user's name
    // has no other way to learn it changed, and a save the user cannot see is
    // indistinguishable from one that silently failed.
    _changes.add(updated);
    return updated;
  }

  /// 🔴 IT REFUSES, AND THAT REFUSAL IS THE HONEST ANSWER — [ADR 027].
  ///
  /// Every other member of this class is a REAL implementation, because the
  /// alternative to a working demo identity is the dead fail-closed seam
  /// [pipeline C-6] exists to catch. Deletion is the one member where the
  /// opposite is true, and the reason is that there is nothing here to delete.
  ///
  /// Returning normally makes the Delete-account control render
  /// [core.AccountDeletionOutcome.deleted]'s sentence — "Your account has been
  /// deleted. Signing in with the same email and password will not work any
  /// more." In demo mode that is FALSE twice over: no server account was ever
  /// created, and [signInWithEmail] here accepts ANY non-empty credentials, so
  /// the user types the same pair and is signed straight back in. Every
  /// non-web artifact `build-platforms.yml` produces runs on this repository,
  /// because none of those builds passes the identity `--dart-define`s.
  ///
  /// **Only a real 2xx from `DELETE /v1/account` may ever produce `deleted`.**
  ///
  /// [deletionRequested] is set BEFORE the throw, so a test proving the button
  /// is wired to the seam still sees the request arrive — the dead-button shape
  /// and the lying-button shape are different defects and both are asserted.
  /// `notConfigured` is the outcome the server itself returns (501) when it
  /// cannot remove the identity record, and its message is already exact for
  /// this case: nothing was deleted, and the user was signed out of this device.
  @override
  Future<void> deleteAccount() async {
    if (_user == null) throw core.AuthFailure('Not signed in');
    deletionRequested = true;
    await signOut();
    throw core.AccountDeletionFailure(
      core.AccountDeletionOutcome.notConfigured,
    );
  }

  /// Release the broadcast controller. Call from a test's tearDown.
  Future<void> dispose() => _changes.close();
}
