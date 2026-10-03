/// The auth port's conformance suite and its fake.
///
/// tooling/ports/README.md §3: each seam package exports `lib/testing.dart`
/// with the fake plus `run<Seam>Conformance`. tooling/ports/auth.json names
/// [runAuthRepositoryConformance] as the Dart half's runner; every adapter's
/// test CALLS it (assert-ports limb 6 matches the call, not an import).
///
/// 🔴 NO TEST PACKAGE IS IMPORTED HERE. This is a `lib/` file and `test` is
/// only a dev dependency of `core`, so the runner takes the caller's `test`
/// function and fails a scenario by throwing [AuthConformanceFailure]. A
/// thrown error fails the test that ran it. No `lib/` file of an app or a
/// package imports this library (limb 10).
///
/// A suite is a SCENARIO LIST plus a PER-ADAPTER FIXTURE: the fixture stages
/// the adapter for one scenario (the fake by its switches, the GoTrue adapter
/// by the recorded HTTP answers of `packages/auth_supabase/test/fixtures/`).
/// The runner THROWS when a scenario has no fixture for the adapter under test
/// — a missing fixture is never a skip.
library;

import 'dart:async';

import 'src/auth/age_signal.dart';
import 'src/auth/auth_models.dart';
import 'src/auth/auth_repository.dart';

export 'src/auth/fake_auth_repository.dart';

/// What the conformance suite checks, one adapter at a time.
enum AuthScenario {
  /// The right password signs in: the user comes back, [AuthRepository.currentUser]
  /// holds it, [AuthRepository.authStateChanges] emits it and a token is handed out.
  signIn,

  /// A session past its expiry is REFRESHED before its token is handed out:
  /// the token returned is not the expired one.
  refresh,

  /// [AuthRepository.signOut] ends the session: no user, no token, gone.
  signOut,

  /// [AuthRepository.deleteAccount] asks the server once and signs out locally.
  delete,

  /// A wrong password is [AuthFailure.invalidCredentials] — and nothing else.
  wrongPassword,

  /// A request that never reached the provider is [AuthFailure.network], never
  /// a wrong password (O-REAUTH-READS-NETWORK-FAILURE-AS-WRONG-PASSWORD).
  offline,

  /// A provider that throttled the request is
  /// [AuthFailure.overRequestRateLimit], never a wrong password.
  rateLimited,

  /// A refresh the provider REFUSED (a revoked session) is honoured: no token,
  /// and [AuthRepository.sessionIsGone] is true.
  revokedSession,

  /// A refresh that could not REACH the provider is not a revocation: no token
  /// now, and the session is NOT gone.
  refreshUnreachable,

  /// The seam asks for no age signal: the sign-up door reads it BEFORE
  /// [AuthRepository.signUpWithEmail] ([signUpAgeGate], ADR 082). A refused
  /// gate never reaches the adapter, so no account exists afterwards; an adult
  /// signal does, and the account is created.
  ageSignal,
}

/// A scenario's own failure, thrown by the runner.
class AuthConformanceFailure implements Exception {
  /// A failure of [scenario] with [message].
  AuthConformanceFailure(this.scenario, this.message);

  /// The scenario that failed.
  final AuthScenario scenario;

  /// What was expected and what was seen.
  final String message;

  @override
  String toString() => 'AuthConformanceFailure(${scenario.name}): $message';
}

/// The world every scenario runs in: one account, its password, a clock the
/// runner moves, and the server-deletion hook an adapter must call.
class AuthConformanceWorld {
  /// A world at [start] with no deletion requested yet.
  AuthConformanceWorld({required DateTime start}) : _now = start.toUtc();

  /// The one account's address.
  static const String email = 'conformance@example.invalid';

  /// Its password.
  static const String password = 'correct horse battery staple';

  /// A password that is not it.
  static const String wrongPassword = 'not the password';

  /// An address that has no account until the age-signal scenario creates one.
  static const String newEmail = 'new-account@example.invalid';

  DateTime _now;

  /// The clock the adapter must read for expiry.
  DateTime now() => _now;

  /// Moves the clock on.
  void advance(Duration d) => _now = _now.add(d);

  /// How many times the adapter asked the server to delete the account.
  int serverDeletions = 0;

  /// The hook a fixture wires as the adapter's server-deletion request.
  Future<void> requestServerDeletion() async => serverDeletions++;
}

/// Stages one adapter for one scenario in [world].
///
/// For [AuthScenario.refresh], [AuthScenario.revokedSession] and
/// [AuthScenario.refreshUnreachable] the adapter is returned SIGNED IN with a
/// session that expires one hour after `world.now()`; the runner then moves the
/// clock past it. For every other scenario it is returned signed out.
typedef AuthAdapterStarter = FutureOr<AuthRepository> Function(
  AuthScenario scenario,
  AuthConformanceWorld world,
);

/// The `test` function of `package:test` or `flutter_test`.
typedef AuthConformanceTest = void Function(
  String description,
  FutureOr<void> Function() body,
);

/// Runs every [AuthScenario] against the adapter [adapter] names, through
/// [test]. [fixtures] must stage EVERY scenario: one missing is a thrown
/// failure, not a skip.
void runAuthRepositoryConformance({
  required String adapter,
  required AuthConformanceTest test,
  required Map<AuthScenario, AuthAdapterStarter> fixtures,
  DateTime? start,
}) {
  for (final AuthScenario s in AuthScenario.values) {
    test('$adapter conforms to AuthRepository: ${s.name}', () async {
      final AuthAdapterStarter? stage = fixtures[s];
      if (stage == null) {
        throw AuthConformanceFailure(
          s,
          '$adapter has no fixture for ${s.name}; a missing fixture is never a skip',
        );
      }
      final AuthConformanceWorld world = AuthConformanceWorld(
        start: start ?? DateTime.utc(2026, 10, 3, 12),
      );
      await _scenarios[s]!(await stage(s, world), world);
    });
  }
}

void _check(AuthScenario s, bool ok, String message) {
  if (!ok) throw AuthConformanceFailure(s, message);
}

/// Calls [body] and returns the [AuthFailure] it threw, or fails [s].
Future<AuthFailure> _refusal(
  AuthScenario s,
  Future<Object?> Function() body,
) async {
  try {
    await body();
  } on AuthFailure catch (e) {
    return e;
  } catch (e) {
    throw AuthConformanceFailure(
      s,
      'expected an AuthFailure, got ${e.runtimeType}: $e',
    );
  }
  throw AuthConformanceFailure(s, 'expected an AuthFailure, got success');
}

Future<void> _signIn(AuthScenario s, AuthRepository auth) async {
  final AuthUser u = await auth.signInWithEmail(
    email: AuthConformanceWorld.email,
    password: AuthConformanceWorld.password,
  );
  _check(s, u.email == AuthConformanceWorld.email, 'signed in as ${u.email}');
}

/// The three refusals a sign-in can meet, each its own code: a screen that
/// reads one as another tells an offline user their password is wrong.
Future<void> _refusedAs(
  AuthScenario s,
  AuthRepository auth,
  String password,
  String code,
) async {
  final AuthFailure f = await _refusal(
    s,
    () => auth.signInWithEmail(
      email: AuthConformanceWorld.email,
      password: password,
    ),
  );
  _check(s, f.code == code, 'refused with code ${f.code}, expected $code');
  _check(s, auth.currentUser == null, 'a refused sign-in left a user');
}

/// Moves the clock past the session and reads the token.
Future<String?> _afterExpiry(
  AuthRepository auth,
  AuthConformanceWorld world,
) async {
  world.advance(const Duration(hours: 2));
  return auth.currentAccessToken();
}

final Map<
  AuthScenario,
  Future<void> Function(AuthRepository, AuthConformanceWorld)
>
_scenarios = <
  AuthScenario,
  Future<void> Function(AuthRepository, AuthConformanceWorld)
>{
  AuthScenario.signIn: (AuthRepository auth, AuthConformanceWorld world) async {
    const AuthScenario s = AuthScenario.signIn;
    _check(s, auth.currentUser == null, 'staged signed in');
    final Future<AuthUser?> emitted = auth
        .authStateChanges()
        .firstWhere((AuthUser? u) => u != null)
        .timeout(const Duration(seconds: 5));
    await _signIn(s, auth);
    _check(s, auth.currentUser?.email == AuthConformanceWorld.email, 'no current user');
    _check(s, (await emitted)?.email == AuthConformanceWorld.email, 'the stream did not emit the user');
    _check(s, await auth.currentAccessToken() != null, 'no token after sign-in');
    _check(s, !await auth.sessionIsGone(), 'a fresh session reads as gone');
  },
  AuthScenario.refresh: (AuthRepository auth, AuthConformanceWorld world) async {
    const AuthScenario s = AuthScenario.refresh;
    final String? before = (await auth.currentSession())?.accessToken;
    _check(s, before != null, 'staged with no session');
    final String? after = await _afterExpiry(auth, world);
    _check(s, after != null, 'an expired session was not refreshed');
    _check(s, after != before, 'the EXPIRED token was handed out');
    _check(s, !await auth.sessionIsGone(), 'a refreshed session reads as gone');
  },
  AuthScenario.signOut: (AuthRepository auth, AuthConformanceWorld world) async {
    const AuthScenario s = AuthScenario.signOut;
    await _signIn(s, auth);
    await auth.signOut();
    _check(s, auth.currentUser == null, 'a user after sign-out');
    _check(s, await auth.currentAccessToken() == null, 'a token after sign-out');
    _check(s, await auth.sessionIsGone(), 'the session is not gone after sign-out');
  },
  AuthScenario.delete: (AuthRepository auth, AuthConformanceWorld world) async {
    const AuthScenario s = AuthScenario.delete;
    await _signIn(s, auth);
    await auth.deleteAccount();
    _check(s, world.serverDeletions == 1, 'the server was asked ${world.serverDeletions} time(s)');
    _check(s, auth.currentUser == null, 'still signed in after deletion');
    _check(s, await auth.currentAccessToken() == null, 'a token after deletion');
  },
  AuthScenario.wrongPassword: (AuthRepository auth, AuthConformanceWorld world) =>
      _refusedAs(AuthScenario.wrongPassword, auth, AuthConformanceWorld.wrongPassword, AuthFailure.invalidCredentials),
  AuthScenario.offline: (AuthRepository auth, AuthConformanceWorld world) =>
      _refusedAs(AuthScenario.offline, auth, AuthConformanceWorld.password, AuthFailure.network),
  AuthScenario.rateLimited: (AuthRepository auth, AuthConformanceWorld world) =>
      _refusedAs(AuthScenario.rateLimited, auth, AuthConformanceWorld.password, AuthFailure.overRequestRateLimit),
  AuthScenario.revokedSession: (AuthRepository auth, AuthConformanceWorld world) async {
    const AuthScenario s = AuthScenario.revokedSession;
    _check(s, await auth.currentSession() != null, 'staged with no session');
    _check(s, await _afterExpiry(auth, world) == null, 'a token after the refresh was refused');
    _check(s, await auth.sessionIsGone(), 'a REFUSED refresh was not read as gone');
  },
  AuthScenario.refreshUnreachable: (AuthRepository auth, AuthConformanceWorld world) async {
    const AuthScenario s = AuthScenario.refreshUnreachable;
    _check(s, await auth.currentSession() != null, 'staged with no session');
    _check(s, await _afterExpiry(auth, world) == null, 'a token although the refresh never arrived');
    _check(s, !await auth.sessionIsGone(), 'an UNREACHABLE provider was read as a revocation');
  },
  AuthScenario.ageSignal: (AuthRepository auth, AuthConformanceWorld world) async {
    const AuthScenario s = AuthScenario.ageSignal;
    // The door's order: the gate first, the seam only if it proceeds.
    Future<AuthUser?> door(AgeSignal signal) async {
      if (signUpAgeGate(signal) == SignUpAgeGate.refuse) return null;
      return auth.signUpWithEmail(
        email: AuthConformanceWorld.newEmail,
        password: AuthConformanceWorld.password,
      );
    }

    _check(s, await door(const BelowAdultAgeSignal()) == null, 'a below-adult signal reached the seam');
    final AuthFailure none = await _refusal(
      s,
      () => auth.signInWithEmail(
        email: AuthConformanceWorld.newEmail,
        password: AuthConformanceWorld.password,
      ),
    );
    _check(s, none.code == AuthFailure.invalidCredentials, 'a refused sign-up left an account (${none.code})');
    final AuthUser? created = await door(const AdultAgeSignal());
    _check(s, created?.email == AuthConformanceWorld.newEmail, 'an adult signal did not create the account');
  },
};
