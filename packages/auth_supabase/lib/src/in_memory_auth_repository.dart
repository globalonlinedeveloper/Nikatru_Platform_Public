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
  InMemoryAuthRepository({
    this.sessionLifetime = const Duration(hours: 1),
    this.emailVerified = true,
  });

  /// How long an issued session lasts, so expiry is exercisable rather than
  /// theoretical.
  final Duration sessionLifetime;

  /// What [core.AuthUser.emailVerified] reads as on the users this hands out.
  ///
  /// 🔴 TRUE BY DEFAULT, AND IT IS THE ONE PLACE IN THE REPOSITORY THAT SAYS SO
  /// EXPLICITLY. `core.AuthUser.emailVerified` defaults to FALSE precisely so
  /// that a real provider which forgets to map it locks its users out rather
  /// than shipping the takeover path. This class is not a provider: there is no
  /// mailbox, no confirmation link and nothing to prove, so an unverified demo
  /// identity would park every non-web artifact `build-platforms.yml` produces
  /// on a "check your inbox" screen whose Resend button cannot work. Same
  /// reasoning as [deleteAccount] below, opposite conclusion — and both are
  /// stated rather than inherited.
  ///
  /// Settable so the UNVERIFIED path is drivable: a test that pumps the real
  /// gate needs a repository that produces the state the gate exists for, and
  /// hand-rolling a second fake to get it is how a gate ends up asserted
  /// against something other than what ships.
  final bool emailVerified;

  final StreamController<core.AuthUser?> _changes =
      StreamController<core.AuthUser?>.broadcast();

  /// The SAME changes with their reason attached. A second controller rather
  /// than a derivation of the first, because the reason cannot be derived: a
  /// recovery arrival and an ordinary sign-in put identical values on
  /// [_changes], which is the whole defect this seam member exists to fix.
  final StreamController<core.AuthEvent> _events =
      StreamController<core.AuthEvent>.broadcast();

  core.AuthUser? _user;
  core.AuthSession? _session;
  int _issued = 0;

  /// Set when [deleteAccount] REACHES the seam — before it refuses — so a test
  /// can assert the request really happened rather than assert the absence of a
  /// crash. It records arrival, never success: see [deleteAccount], which always
  /// throws here ([ADR 027]).
  bool deletionRequested = false;

  /// How many times [resendVerificationEmail] has been reached. Same reasoning
  /// as [deletionRequested]: a button proven to reach the seam is a different
  /// assertion from a button proven not to crash.
  int verificationResends = 0;

  /// Every password [updatePassword] has been asked to set, newest last.
  ///
  /// The VALUES, not a count, and the difference is a real defect class: a
  /// screen that submits the confirmation field instead of the password field
  /// reaches the seam exactly once either way, so a counter cannot tell the two
  /// apart. This can.
  final List<String> passwordsSet = <String>[];

  @override
  core.AuthUser? get currentUser => _user;

  @override
  Stream<core.AuthUser?> authStateChanges() => _changes.stream;

  @override
  Stream<core.AuthEvent> authEvents() => _events.stream;

  core.AuthUser _signIn(
    String email, {
    core.AuthEventKind kind = core.AuthEventKind.signedIn,
  }) {
    final core.AuthUser u = core.AuthUser(
      id: 'in-memory-${email.hashCode.toUnsigned(32)}',
      email: email,
      emailVerified: emailVerified,
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
    _events.add(core.AuthEvent(kind, u));
    return u;
  }

  /// Deliver a password-recovery link, as if the user had just followed one.
  ///
  /// 🔴 THE OPEN PATH FOR THE RECOVERY GATE, AND WITHOUT IT THAT GATE IS
  /// UNDRIVABLE OUTSIDE PRODUCTION. There is no mailbox here and no PKCE
  /// exchange, so nothing else in this class can ever produce
  /// [core.AuthEventKind.passwordRecovery] — and a router gate whose only input
  /// cannot be produced is the [pipeline C-6] dead seam exactly: it compiles, it
  /// never fires, and every test of the closed side stays green.
  ///
  /// It is a REAL sign-in that reports a different reason, which is precisely
  /// what the provider does: a recovery session is an ordinary session, and the
  /// event label is the entire difference. That equivalence is the thing under
  /// test, so making it anything else here would be testing a different system.
  core.AuthUser deliverPasswordRecovery(String email) =>
      _signIn(email, kind: core.AuthEventKind.passwordRecovery);

  /// Deliver a reset link that CANNOT be exchanged — the other half of the same
  /// gate, and the half that was a production crash.
  ///
  /// 🔴 SYMMETRY IS THE POINT. [deliverPasswordRecovery] exists because a gate
  /// whose only input cannot be produced is a dead seam; this exists for exactly
  /// the same reason one branch down. GlitchTip SUBLY-8 was a FATAL, uncaught
  /// `AuthException(Code verifier could not be found in local storage)` for the
  /// ordinary act of requesting a reset on one device and opening the mail on
  /// another — and nothing in the demo identity could produce that state, so no
  /// test above the seam could reach the screen that now explains it.
  ///
  /// No session is minted, because that is the whole shape of this failure: the
  /// link arrives, the exchange fails, and the user is still signed out.
  /// [message] is the PROVIDER'S English on purpose — the classifier reads it,
  /// so a test that passes its own wording is testing its own wording.
  void failRecoveryArrival([
    String message = 'Code verifier could not be found in local storage.',
  ]) =>
      _events.add(
        core.AuthEvent(
          core.AuthEventKind.recoveryLinkFailed,
          null,
          problem: core.authLinkProblemOf(message),
        ),
      );

  @override
  Future<core.AuthUser> signInWithEmail({
    required String email,
    required String password,
    String? captchaToken,
  }) async {
    if (email.isEmpty || password.isEmpty) {
      throw core.AuthFailure('Email and password are required');
    }
    lastCaptchaToken = captchaToken;
    return _signIn(email);
  }

  @override
  Future<core.AuthUser> signUpWithEmail({
    required String email,
    required String password,
    String? captchaToken,
  }) async => signInWithEmail(
    email: email,
    password: password,
    captchaToken: captchaToken,
  );

  /// The captcha token most recently handed to any method here, or null.
  ///
  /// RECORDED FOR THE SAME REASON [verificationResends] IS. A screen that stops
  /// sending the token does not fail against a fake - the call simply arrives
  /// without it and this class is perfectly happy. Keeping the last value is
  /// what makes "the widget is actually wired to this call" assertable instead
  /// of assumed, which is the only way that wiring can be tested before the
  /// gate exists on the provider we point at.
  String? lastCaptchaToken;

  @override
  Future<void> signInWithApple() async => _signIn('apple.user@example.com');

  /// Every address a reset was asked for. Recorded, not sent: there is no
  /// mailbox, and the only way to complete a reset here is
  /// [deliverPasswordRecovery] — which a test calls to stand in for the link.
  final List<String> passwordResetsRequested = <String>[];

  @override
  Future<void> sendPasswordReset(String email, {String? captchaToken}) async {
    lastCaptchaToken = captchaToken;
    passwordResetsRequested.add(email);
  }

  /// There is no mailbox behind this class, so there is nothing to resend — but
  /// it must not THROW either: with [emailVerified] true (the default) no user
  /// of this repository ever reaches the screen that calls it, and with it false
  /// a test driving the unverified path wants to press the button and stay on
  /// the screen. Recorded rather than silent, so "the button is wired" is
  /// assertable without asserting the absence of a crash.
  @override
  Future<void> resendVerificationEmail({String? captchaToken}) async {
    if (_user == null) throw core.AuthFailure('Not signed in');
    lastCaptchaToken = captchaToken;
    verificationResends++;
  }

  /// Nothing changes off-device here, so a reload returns what is already held.
  /// It does NOT flip [core.AuthUser.emailVerified] to true: a demo identity
  /// that "confirms" itself the moment somebody presses the button would make
  /// the unverified path untestable through the very control that exits it.
  @override
  Future<core.AuthUser?> reloadUser() async => _user;

  /// Refuses on an unverified session exactly as the Supabase implementation
  /// does — the rule is `core.mayLinkIdentity`, not a Supabase behaviour — and
  /// then refuses anyway, because there is no second identity provider here to
  /// link to. Two refusals with two different messages, so a test can tell which
  /// rule fired.
  @override
  Future<void> linkAppleIdentity() async {
    if (!core.mayLinkIdentity(_user)) {
      throw core.AuthFailure(
        'Confirm your email address before linking another sign-in method.',
      );
    }
    throw core.AuthFailure(
      'Linking another sign-in method needs a configured identity provider.',
    );
  }

  /// Sets the password, for real — within the limits of a class that never
  /// validates one.
  ///
  /// 🔴 IT REFUSES A PASSWORD THIS REPOSITORY'S OWN SIGN-IN WOULD ACCEPT, and
  /// that asymmetry is deliberate. [signInWithEmail] takes any non-empty pair
  /// because it is a demo door; SETTING a password is where the client-side rule
  /// lives, and a demo identity that accepted `'a'` would let a screen ship with
  /// no length check at all and every widget test still pass. The rule is
  /// [core.kMinPasswordLength] — the shared one, not a second copy.
  ///
  /// Emits [core.AuthEventKind.userUpdated] rather than a sign-in: the session
  /// did not change, only the record did. A recovery gate that cleared itself on
  /// `signedIn` would still be holding the user here; one that cleared on
  /// `userUpdated` would throw them off the success screen the instant the save
  /// landed. Naming the event correctly is what lets the gate do neither.
  @override
  Future<core.AuthUser> updatePassword({required String newPassword}) async {
    final core.AuthUser? current = _user;
    if (current == null) {
      throw core.AuthFailure('Your reset link is no longer valid.');
    }
    if (newPassword.length < core.kMinPasswordLength) {
      throw core.AuthFailure('Password should be at least 8 characters');
    }
    passwordsSet.add(newPassword);
    _changes.add(current);
    _events.add(core.AuthEvent(core.AuthEventKind.userUpdated, current));
    return current;
  }

  @override
  Future<void> signOut() async {
    _user = null;
    _session = null;
    _changes.add(null);
    _events.add(const core.AuthEvent(core.AuthEventKind.signedOut, null));
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
      // ⚠️ CARRIED, NOT DEFAULTED. `emailVerified` defaults to false on
      // `core.AuthUser`, so rebuilding the user without it would silently
      // DEMOTE a verified session to unverified on a rename — and the router's
      // gate would bounce the user to "check your inbox" from the profile
      // screen, with the save having worked.
      emailVerified: current.emailVerified,
    );
    _user = updated;
    // EMITTING IS THE POINT, not bookkeeping: a screen showing the user's name
    // has no other way to learn it changed, and a save the user cannot see is
    // indistinguishable from one that silently failed.
    _changes.add(updated);
    _events.add(core.AuthEvent(core.AuthEventKind.userUpdated, updated));
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

  /// Release BOTH broadcast controllers. Call from a test's tearDown.
  ///
  /// ⚠️ `Future.wait`, not `_changes.close()` alone — a second controller closed
  /// by nobody leaks a subscription per test, and the symptom is a later,
  /// unrelated test hanging rather than this one failing.
  Future<void> dispose() =>
      Future.wait(<Future<void>>[_changes.close(), _events.close()]);
}
