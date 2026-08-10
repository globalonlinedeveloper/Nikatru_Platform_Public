// ─────────────────────────────────────────────────────────────────────────────
// THE TWO PURE PIECES PASSWORD RESET STANDS ON, driven directly.
//
// Both live in `core` for the reason `identity_assurance.dart` does: they are
// consulted from several surfaces (a reset screen, a sign-up form, the in-memory
// identity, a router gate) and a rule copied per surface is several rules that
// will disagree. A pure function can be driven in both directions with no widget
// tree, no Supabase project and no mailbox, which is the only way a rule this
// consequential gets a falsifiable assertion at all.
//
// ── WHY THE DERIVED DEFAULT IS TESTED AT ALL ────────────────────────────────
// `AuthRepository.authEvents()` carries a default body that MAPS
// `authStateChanges()` rather than throwing or returning an empty stream. That
// choice is the whole reason eight test doubles in this repository still
// compile, and it has one property that must never rot: the default can report
// arrivals and departures, and it can NEVER report `passwordRecovery`. If it
// could, a double that knows nothing about recovery would be able to trip the
// router's recovery gate — the exact opposite of the fail-closed direction every
// other default here is chosen for.
// ─────────────────────────────────────────────────────────────────────────────
import 'dart:async';

import 'package:nikatru_core/nikatru_core.dart';
import 'package:test/test.dart';

void main() {
  group('newPasswordProblem — the one rule, in one place', () {
    test('a good password with a matching confirmation is accepted', () {
      expect(
        newPasswordProblem(
          password: 'correct-horse',
          confirmation: 'correct-horse',
        ),
        isNull,
        reason:
            'THE OPEN PATH. A validator that rejects everything satisfies every '
            'negative case below and ships a form nobody can submit',
      );
    });

    test('an empty box is empty, NOT "too short"', () {
      expect(
        newPasswordProblem(password: '', confirmation: ''),
        NewPasswordProblem.empty,
        reason:
            'the remedy differs: an untouched field needs "fill this in", not '
            '"try harder" — and the two arms would be indistinguishable if '
            'empty fell through to the length check',
      );
    });

    test('below the floor is tooShort, and the floor is the published 8', () {
      expect(
        newPasswordProblem(password: 'sevench', confirmation: 'sevench'),
        NewPasswordProblem.tooShort,
      );
      expect(
        newPasswordProblem(password: 'eightchr', confirmation: 'eightchr'),
        isNull,
        reason: 'exactly at the floor is acceptable — 8 means 8, not 9',
      );
      expect(
        kMinPasswordLength,
        8,
        reason:
            'the constant and the arb sentence "Use at least 8 characters." are '
            'one claim. They said 6 and 8 once, and a user reading one number '
            'while the code enforced another cannot tell which is wrong',
      );
    });

    test('a mistyped confirmation is caught BEFORE anything is sent', () {
      expect(
        newPasswordProblem(
          password: 'correct-horse',
          confirmation: 'correct-hosre',
        ),
        NewPasswordProblem.mismatched,
        reason:
            'this is the one screen where a typo is unrecoverable by retrying: '
            'the password set is not the one meant, and the link that got the '
            'user here is single-use',
      );
    });

    // ORDER IS PART OF THE CONTRACT, and this is the input that proves it. Both
    // rules are broken at once; reporting the mismatch would send the user to
    // fix the confirmation box when the password box is the one that must grow.
    test('too short AND mismatched reports tooShort — the field to fix', () {
      expect(
        newPasswordProblem(password: 'abc', confirmation: 'xyz'),
        NewPasswordProblem.tooShort,
      );
    });
  });

  group('authEvents() — the derived default, and what it cannot say', () {
    test('a repository that maps nothing still reports arrival and departure',
        () async {
      final _StreamOnlyRepository repo = _StreamOnlyRepository();
      addTearDown(repo.dispose);
      final List<AuthEvent> seen = <AuthEvent>[];
      final StreamSubscription<AuthEvent> sub = repo.authEvents().listen(
            seen.add,
          );
      addTearDown(sub.cancel);

      repo.emit(const AuthUser(id: 'u1', email: 'a@b.test'));
      repo.emit(null);
      await Future<void>.delayed(Duration.zero);

      expect(seen.map((AuthEvent e) => e.kind), <AuthEventKind>[
        AuthEventKind.signedIn,
        AuthEventKind.signedOut,
      ]);
      expect(
        seen.first.user?.id,
        'u1',
        reason:
            'the default carries the user through — an event with the right '
            'label and no user is a gate that fires on nobody',
      );
    });

    // 🔴 THE LIMB THAT MATTERS. The default has no input that can produce a
    // recovery, so a double inheriting it can never trip the recovery gate.
    test('it can NEVER report passwordRecovery, whatever it is fed', () async {
      final _StreamOnlyRepository repo = _StreamOnlyRepository();
      addTearDown(repo.dispose);
      final List<AuthEvent> seen = <AuthEvent>[];
      final StreamSubscription<AuthEvent> sub = repo.authEvents().listen(
            seen.add,
          );
      addTearDown(sub.cancel);

      for (int i = 0; i < 5; i++) {
        repo.emit(AuthUser(id: 'u$i', email: 'a$i@b.test'));
        repo.emit(null);
      }
      await Future<void>.delayed(Duration.zero);

      expect(seen, hasLength(10), reason: 'every emission arrived');
      expect(
        seen.where((AuthEvent e) => e.startsPasswordRecovery),
        isEmpty,
        reason:
            'the honest degradation is "every arrival is an ordinary sign-in". '
            'A default that could fabricate a recovery would let a test double '
            'that knows nothing about recovery route a real user into the '
            'reset flow',
      );
    });

    test('startsPasswordRecovery refuses a recovery event with no user', () {
      expect(
        const AuthEvent(
          AuthEventKind.passwordRecovery,
          AuthUser(id: 'u1', email: 'a@b.test'),
        ).startsPasswordRecovery,
        isTrue,
      );
      expect(
        const AuthEvent(AuthEventKind.passwordRecovery, null)
            .startsPasswordRecovery,
        isFalse,
        reason:
            'the reset screen has one action and it needs a session. A gate '
            'that fired on a userless recovery would strand a signed-out '
            'visitor on a form that cannot submit',
      );
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // authLinkProblemOf — the classifier that decides WHICH sentence a dead link
  // gets. It reads the provider's ENGLISH, which is a bounded compromise the
  // seam already makes elsewhere, and the reason this group exists at all: the
  // string it matches lives in a VENDORED SDK, so it can change under us with
  // nothing going red. If gotrue rewords the message, the verifier case below
  // is what says so.
  group('authLinkProblemOf', () {
    test('gotrue verbatim verifier message is verifierMissing', () {
      // The exact string from gotrue 2.26.0 `gotrue_client.dart:390` — read off
      // the SDK on disk, not from memory, and the same one GlitchTip SUBLY-8
      // recorded from production.
      expect(
        authLinkProblemOf(
          'AuthException(message: Code verifier could not be found in local '
          'storage., statusCode: null, code: null)',
        ),
        AuthLinkProblem.verifierMissing,
      );
    });

    test('the expiry wording AND the error_code are both expiredOrUsed', () {
      // The two spellings the two paths deliver — the exception text on one
      // side, the URL parameters on the other. They MUST agree: the user is in
      // one situation and the app must not describe it two ways.
      expect(
        authLinkProblemOf('Email link is invalid or has expired'),
        AuthLinkProblem.expiredOrUsed,
      );
      expect(
        authLinkProblemOf('access_denied otp_expired'),
        AuthLinkProblem.expiredOrUsed,
      );
    });

    test('anything unrecognised is unknown, not guessed at', () {
      expect(
        authLinkProblemOf('SocketException: connection closed'),
        AuthLinkProblem.unknown,
        reason: 'a wrong-but-confident sentence is worse than a general one: '
            '"open it on the device you asked from" sends somebody whose '
            'network dropped on a pointless errand',
      );
    });

    // 🔴 ORDER IS CONTRACTUAL. The real verifier message happens to contain no
    // expiry word — but a future one could contain both, and `verifierMissing`
    // is the arm carrying the ACTIONABLE advice, so it has to win. Without this
    // case the ordering is an accident nobody would notice changing.
    test('verifierMissing wins when a message could match both', () {
      expect(
        authLinkProblemOf('Code verifier could not be found — link expired'),
        AuthLinkProblem.verifierMissing,
      );
    });
  });

  group('AuthEvent.recoveryLinkIsUnusable', () {
    test('true for recoveryLinkFailed and for nothing else', () {
      expect(
        const AuthEvent(
          AuthEventKind.recoveryLinkFailed,
          null,
          problem: AuthLinkProblem.verifierMissing,
        ).recoveryLinkIsUnusable,
        isTrue,
      );
      for (final AuthEventKind k in AuthEventKind.values) {
        if (k == AuthEventKind.recoveryLinkFailed) continue;
        expect(
          AuthEvent(k, null).recoveryLinkIsUnusable,
          isFalse,
          reason: '$k must not read as a failed reset arrival',
        );
      }
    });

    test('the problem is part of identity — two failures are not one event',
        () {
      // Equality is what a Notifier uses to decide whether to publish. Left out
      // of `==`, a second arrival with a DIFFERENT cause would not repaint, and
      // the screen would go on explaining the previous failure.
      expect(
        const AuthEvent(
          AuthEventKind.recoveryLinkFailed,
          null,
          problem: AuthLinkProblem.verifierMissing,
        ),
        isNot(
          const AuthEvent(
            AuthEventKind.recoveryLinkFailed,
            null,
            problem: AuthLinkProblem.expiredOrUsed,
          ),
        ),
      );
    });
  });
}

/// A repository that implements the ONE stream member and inherits everything
/// else — the shape every test double in `apps/subly/test` has.
///
/// `extends`, not `implements`, on purpose: that is what makes the default
/// bodies reach it, and it is the difference this whole seam is written around.
class _StreamOnlyRepository extends AuthRepository {
  final StreamController<AuthUser?> _c =
      StreamController<AuthUser?>.broadcast();

  void emit(AuthUser? user) => _c.add(user);
  Future<void> dispose() => _c.close();

  @override
  AuthUser? get currentUser => null;

  @override
  Stream<AuthUser?> authStateChanges() => _c.stream;

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}
