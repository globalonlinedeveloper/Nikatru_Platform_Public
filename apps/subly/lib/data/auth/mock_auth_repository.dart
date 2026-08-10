import 'dart:async';

import 'package:nikatru_core/nikatru_core.dart' as core;

import 'auth_models.dart';
import 'auth_repository.dart';

/// In-memory auth used automatically when Supabase isn't configured, so the
/// whole app is explorable (every screen, sign-in → scan → dashboard) with no
/// backend.
///
/// 🔴 RETIRED, AND TEST-ONLY. `authRepositoryProvider` resolves the chassis
/// `InMemoryAuthRepository` whenever the backend is not live — including under
/// `--proof` — and has since before the cut-1 reversal
/// (`git show 255265b:apps/subly/lib/state/providers.dart:544`). The ONLY
/// non-test import of this file tree-wide is `test/delete_account_test.dart`.
///
/// ⚠️ THIS DOC USED TO CLAIM THE `--proof` SCREENSHOT LANE NEEDED THE FICTIONAL
/// PROFILE `Alex Rivera` FROM HERE, AND THAT WAS FALSE IN BOTH HALVES. The lane
/// does not build this class at all, and `InMemoryAuthRepository`'s demo
/// identity carries NO `displayName` (it only ever gains one through
/// `updateProfile`), so the name cannot appear on a captured frame. The
/// screenshot suite's `includeProfileName: AppConfig.isBackendLive` and the
/// capability register's waiver both repeated the claim; all three are corrected
/// together. A reason nobody re-measures is how a dead dependency keeps a class
/// alive — and `assert-no-seam-forks`' staleness limb cannot catch this, because
/// it adjudicates whether the PATH still exists, never whether the REASON is
/// still true.
///
/// ⚠️ `extends`, NOT `implements`. The three email-verification members on
/// `core.AuthRepository` carry honest default bodies and Dart hands those on
/// only through `extends` — see that file's note. A retired demo repository
/// inheriting "not available here" is exactly right; writing three stubs by
/// hand here would be three more things to keep true.
class MockAuthRepository extends AuthRepository {
  final StreamController<AuthUser?> _controller =
      StreamController<AuthUser?>.broadcast();
  AuthUser? _user;

  AuthUser _demoUser(String email) => AuthUser(
    id: 'demo-user',
    email: email.isEmpty ? 'alex@example.com' : email,
    displayName: 'Alex Rivera',
    // 🔴 STATED, NOT DEFAULTED. `AuthUser.emailVerified` is false by default so
    // a real provider that forgets to map it fails closed; a demo identity with
    // no mailbox behind it has to say the opposite out loud, or the screenshot
    // lane parks on "check your inbox" and every store artifact captures that
    // screen instead of the app.
    emailVerified: true,
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
  ///
  /// 🔄 THE "apps/subly IS FROZEN (39-CHASSIS cut 1)" CLAUSE IS GONE FROM THIS
  /// DOC because the freeze it cited is gone: [ADR 036] dissolved it and the
  /// owner approved the cut-1 REVERSAL on 2026-08-09, so the real client is no
  /// longer "elsewhere because Subly may not have it" — it is in
  /// `packages/auth_supabase` because that is where the one Supabase importer
  /// belongs. The refusal below stands on its own reasoning, which never had
  /// anything to do with the freeze.
  ///
  /// 🔴 IT REFUSES, AND THAT IS THE HONEST ANSWER — [ADR 027].
  ///
  /// This used to sign out and return normally, which the new Delete-account
  /// control turns into "Your account has been deleted. Signing in with the same
  /// email and password will not work any more." In demo mode that is FALSE
  /// twice over: there is no server account, and [signInWithEmail] here accepts
  /// any credentials, so the user types the same pair and is signed straight
  /// back in. Every non-web artifact `build-platforms.yml` produces runs on this
  /// repository, because none of those builds passes the identity dart-defines.
  ///
  /// Only a real 2xx from `DELETE /v1/account` may ever produce `deleted`.
  @override
  Future<void> deleteAccount() async {
    if (currentUser == null) throw AuthFailure('Not signed in');
    await signOut();
    throw core.AccountDeletionFailure(
      core.AccountDeletionOutcome.notConfigured,
    );
  }

  /// [pipeline C-13] Required by the shared `AuthRepository` seam, which Subly
  /// reaches via the F0-4 re-export shim. Implemented properly rather than
  /// thrown from, because a stub that refuses is the fail-closed shape
  /// [pipeline C-6] exists to catch.
  @override
  Future<AuthUser> updateProfile({required String displayName}) async {
    final AuthUser? current = _user;
    if (current == null) throw AuthFailure('Not signed in');
    final AuthUser updated = AuthUser(
      id: current.id,
      email: current.email,
      displayName: displayName.isEmpty ? null : displayName,
      // Carried, never defaulted — rebuilding without it demotes a verified
      // session to unverified on a rename.
      emailVerified: current.emailVerified,
    );
    _user = updated;
    _controller.add(updated);
    return updated;
  }
}
