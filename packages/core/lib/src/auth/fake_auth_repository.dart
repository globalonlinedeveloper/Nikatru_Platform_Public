import 'dart:async';

import 'account_deletion.dart';
import 'auth_event.dart';
import 'auth_models.dart';
import 'auth_repository.dart';
import 'sign_in_methods.dart';

/// THE auth port's fake: a whole [AuthRepository] with no network, whose
/// failures are SWITCHES a test sets, and which passes the same conformance
/// suite the GoTrue adapter does (`runAuthRepositoryConformance`,
/// `package:nikatru_core/testing.dart`; tooling/ports/auth.json adapter
/// `fake`).
///
/// ⏱ 2026-10-03 · port-auth. It replaces the hand-written doubles of
/// `packages/` tests that each re-implemented a slice of the seam — a provider
/// sign-in that lands (or lands as somebody else), a session handed back as
/// set, a password re-check that records its attempts. One double kept to the
/// suite is one place the seam's meaning is written; four drift.
///
/// Exported ONLY from `testing.dart`, so no `lib/` code can select it.
class FakeAuthRepository implements AuthRepository {
  /// A fake with [user] signed in (or nobody), whose accounts are [accounts]
  /// (address → password; the signed-in user's address with [password]).
  FakeAuthRepository({
    AuthUser? signedIn,
    String? password,
    Map<String, String>? accounts,
    this.sessionLifetime = const Duration(hours: 1),
    DateTime Function()? clock,
    Future<void> Function()? requestServerDeletion,
  }) : _now = clock ?? (() => DateTime.now().toUtc()),
       _requestServerDeletion = requestServerDeletion {
    if (accounts != null) _passwords.addAll(accounts);
    if (signedIn != null) {
      _users[signedIn.email] = signedIn;
      if (password != null) _passwords[signedIn.email] = password;
      _user = signedIn;
      _session = _issue();
    }
  }

  /// How long a session this fake issues lasts.
  final Duration sessionLifetime;

  final DateTime Function() _now;
  final Future<void> Function()? _requestServerDeletion;
  final Map<String, String> _passwords = <String, String>{};
  final Map<String, AuthUser> _users = <String, AuthUser>{};
  final StreamController<AuthUser?> _changes =
      StreamController<AuthUser?>.broadcast();
  final StreamController<AuthEvent> _events =
      StreamController<AuthEvent>.broadcast();

  AuthUser? _user;
  AuthSession? _session;
  int _issued = 0;

  // ── the switches ───────────────────────────────────────────────────────────

  /// True: every call that would reach the provider fails as a transport
  /// failure ([AuthFailure.network]); a refresh keeps the session.
  bool offline = false;

  /// True: every credential call is throttled ([AuthFailure.overRequestRateLimit]).
  bool rateLimited = false;

  /// True: the provider REFUSES the next refresh (a revoked session); the
  /// session is dropped, as a real provider drops it.
  bool sessionRevoked = false;

  /// The user [signInWithApple] lands as, or null for a sign-in that never lands.
  AuthUser? emitOnApple;

  /// The user [signInWithGoogle] lands as, or null for one that never lands.
  AuthUser? emitOnGoogle;

  /// Overrides what [currentSession] hands back (a provider token, a set
  /// expiry). Null hands back the session this fake issued.
  AuthSession? session;

  // ── what reached the seam ──────────────────────────────────────────────────

  /// Every password [signInWithEmail] was given, in order.
  final List<String> passwordAttempts = <String>[];

  /// How many times each provider door was pressed.
  int appleCalls = 0;

  /// How many times [signInWithGoogle] was pressed.
  int googleCalls = 0;

  /// Every address a password reset was sent to.
  final List<String> passwordResets = <String>[];

  /// Every scope [signOut] was called with.
  final List<SignOutScope> signOuts = <SignOutScope>[];

  /// How many refreshes reached the provider.
  int refreshes = 0;

  /// Puts [user] on the stream as if the provider pushed it (a restored
  /// session, a link followed elsewhere), and signs it in.
  void emit(AuthUser? user) {
    _user = user;
    _session = user == null ? null : _issue();
    _announce(user == null ? AuthEventKind.signedOut : AuthEventKind.signedIn);
  }

  /// Closes the streams.
  Future<void> dispose() async {
    await _changes.close();
    await _events.close();
  }

  AuthSession _issue() {
    _issued++;
    return AuthSession(
      accessToken: 'fake-access-$_issued',
      refreshToken: 'fake-refresh-$_issued',
      expiresAt: _now().toUtc().add(sessionLifetime),
    );
  }

  void _announce(AuthEventKind kind) {
    _changes.add(_user);
    _events.add(AuthEvent(kind, _user));
  }

  void _reach() {
    if (offline) {
      throw AuthFailure('The network is unreachable', code: AuthFailure.network);
    }
  }

  void _throttle() {
    if (rateLimited) {
      throw AuthFailure(
        'Too many requests',
        code: AuthFailure.overRequestRateLimit,
      );
    }
  }

  // ── the seam ───────────────────────────────────────────────────────────────

  @override
  AuthUser? get currentUser => _user;

  @override
  Stream<AuthUser?> authStateChanges() => _changes.stream;

  @override
  Stream<AuthEvent> authEvents() => _events.stream;

  @override
  Future<AuthUser> signInWithEmail({
    required String email,
    required String password,
    String? captchaToken,
  }) async {
    passwordAttempts.add(password);
    _reach();
    _throttle();
    final String? want = _passwords[email];
    if (want == null || want != password) {
      throw AuthFailure(
        'Invalid login credentials',
        code: AuthFailure.invalidCredentials,
      );
    }
    _user = _users[email] ?? AuthUser(id: 'fake-${email.hashCode}', email: email);
    _session = _issue();
    _announce(AuthEventKind.signedIn);
    return _user!;
  }

  @override
  Future<AuthUser> signUpWithEmail({
    required String email,
    required String password,
    String? captchaToken,
  }) async {
    _reach();
    _throttle();
    if (_passwords.containsKey(email)) {
      throw AuthFailure('User already registered', code: 'user_already_exists');
    }
    _passwords[email] = password;
    final AuthUser u = AuthUser(id: 'fake-${email.hashCode}', email: email);
    _users[email] = u;
    return u;
  }

  @override
  Future<void> signInWithApple() async {
    appleCalls++;
    if (emitOnApple != null) emit(emitOnApple);
  }

  @override
  Future<void> signInWithGoogle() async {
    googleCalls++;
    if (emitOnGoogle != null) emit(emitOnGoogle);
  }

  @override
  Future<void> sendPasswordReset(String email, {String? captchaToken}) async {
    _reach();
    passwordResets.add(email);
  }

  @override
  Future<AuthUser> updatePassword({
    required String newPassword,
    String? currentPassword,
  }) async {
    final AuthUser? u = _user;
    if (u == null) throw AuthFailure('Not signed in');
    _reach();
    _passwords[u.email] = newPassword;
    return u;
  }

  @override
  Future<AuthUser> updateEmail({required String newEmail}) async {
    final AuthUser? u = _user;
    if (u == null) throw AuthFailure('Not signed in');
    _reach();
    return u;
  }

  @override
  Future<void> signOut({SignOutScope scope = SignOutScope.local}) async {
    if (scope == SignOutScope.global) _reach();
    signOuts.add(scope);
    _user = null;
    _session = null;
    session = null;
    _announce(AuthEventKind.signedOut);
  }

  @override
  Future<void> resendVerificationEmail({String? captchaToken}) async {
    if (_user == null) throw AuthFailure('Not signed in');
    _reach();
  }

  @override
  Future<void> resendSignUpConfirmation(
    String email, {
    String? captchaToken,
  }) async => _reach();

  @override
  Future<AuthUser?> reloadUser() async => _user;

  @override
  Future<void> linkAppleIdentity() async {
    throw AuthFailure('Linking another sign-in method is not available here.');
  }

  @override
  Future<void> linkGoogleIdentity() async {
    throw AuthFailure('Linking another sign-in method is not available here.');
  }

  // ⏱ 2026-10-03 · merge of main into club/rt-ports: main's SE-04 and EN-21
  // added these to the seam with refusing defaults; the fake IMPLEMENTS the
  // seam, so it states them, refusing exactly as the defaults do.
  @override
  Future<AuthUser> unlinkIdentity(SignInMethod method) async {
    throw AuthFailure('Removing a sign-in method is not available here.');
  }

  @override
  bool get emailCodeAvailable => false;

  @override
  Future<void> sendEmailCode(String email, {String? captchaToken}) async {
    throw AuthFailure('Signing in with a code is not available here.');
  }

  @override
  Future<AuthUser> verifyEmailCode({
    required String email,
    required String code,
  }) async {
    throw AuthFailure('Signing in with a code is not available here.');
  }

  /// The token, refreshed first when the session is past its expiry: a refresh
  /// the provider REFUSES drops the session; one that cannot reach it keeps it
  /// and hands out nothing.
  @override
  Future<String?> currentAccessToken() async {
    final AuthSession? s = _session;
    if (s == null) return null;
    if (s.isValidAt(_now())) return s.accessToken;
    if (offline) return null;
    refreshes++;
    if (sessionRevoked) {
      _user = null;
      _session = null;
      _announce(AuthEventKind.signedOut);
      return null;
    }
    _session = _issue();
    _events.add(AuthEvent(AuthEventKind.tokenRefreshed, _user));
    return _session!.accessToken;
  }

  @override
  Future<AuthSession?> currentSession() async => session ?? _session;

  /// Gone ⇔ this fake holds no session after trying for a token: a refused
  /// refresh dropped it, an unreachable one did not.
  @override
  Future<bool> sessionIsGone() async {
    if (_session == null) return true;
    await currentAccessToken();
    return _session == null;
  }

  @override
  Future<AuthUser> updateProfile({required String displayName}) async {
    final AuthUser? u = _user;
    if (u == null) throw AuthFailure('Not signed in');
    _user = AuthUser(
      id: u.id,
      email: u.email,
      displayName: displayName.isEmpty ? null : displayName,
      emailVerified: u.emailVerified,
      hasPasswordIdentity: u.hasPasswordIdentity,
      lastSignInAt: u.lastSignInAt,
      oauthProviders: u.oauthProviders,
    );
    _announce(AuthEventKind.userUpdated);
    return _user!;
  }

  /// Asks the server through the hook it was built with, then signs out
  /// REGARDLESS; with no hook it refuses as `notConfigured` after signing out —
  /// the GoTrue adapter's contract exactly.
  @override
  Future<void> deleteAccount() async {
    Object? failure;
    try {
      final Future<void> Function()? ask = _requestServerDeletion;
      if (ask == null) {
        failure = AccountDeletionFailure(AccountDeletionOutcome.notConfigured);
      } else {
        await ask();
        final AuthUser? u = _user;
        if (u != null) {
          _passwords.remove(u.email);
          _users.remove(u.email);
        }
      }
    } catch (e) {
      failure = e;
    }
    await signOut();
    if (failure != null) throw failure;
  }
}
