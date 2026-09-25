import 'dart:async';

import 'package:nikatru_core/nikatru_core.dart';
import 'package:test/test.dart';

/// ⏱ 2026-09-15 · O-OAUTH-DELETE-REAUTH — a repository whose provider sign-in
/// can land, land as SOMEBODY ELSE, or never land.
class _ProviderAuth extends AuthRepository {
  final StreamController<AuthUser?> users =
      StreamController<AuthUser?>.broadcast();
  int appleCalls = 0;
  AuthUser? emitOnApple;

  @override
  Stream<AuthUser?> authStateChanges() => users.stream;

  @override
  Future<void> signInWithApple() async {
    appleCalls++;
    if (emitOnApple != null) users.add(emitOnApple);
  }

  /// The session [currentSession] hands back — the ONE place Apple's own refresh
  /// token ever appears.
  AuthSession? session;

  @override
  Future<AuthSession?> currentSession() async => session;

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

/// THE CHASSIS HALF OF [ADR 027].
///
/// `DELETE /v1/account` answers 501 when it cannot delete the identity record
/// (nothing was deleted) and 502 when the rows went and the identity did not
/// (the data is gone and the same password still signs in). Every app that ever
/// ships a Delete-account control has to tell those apart, so the telling-apart
/// lives here rather than in fifty screens — the same reasoning that put
/// `Analytics.purge()` on the facade in [ADR 025].
void main() {
  group('forStatus maps the route`s real answers', () {
    test('2xx is the only outcome that means the account is gone', () {
      for (final int ok in <int>[200, 204, 299]) {
        expect(AccountDeletionOutcome.forStatus(ok),
            AccountDeletionOutcome.deleted);
        expect(AccountDeletionOutcome.forStatus(ok).accountIsGone, isTrue);
      }
      for (final int bad in <int>[0, 401, 403, 418, 500, 501, 502, 503]) {
        expect(
          AccountDeletionOutcome.forStatus(bad).accountIsGone,
          isFalse,
          reason: 'a UI that treats "no exception" as success is the failure '
              'this enum replaces — $bad must never read as deleted',
        );
      }
    });

    // ⏱ 2026-09-15 · [ADR 081]: 202 erasure_pending is accepted-and-finishing.
    test(
        '202 · pending — accepted, NOT gone, and the one 2xx that is not deleted',
        () {
      expect(AccountDeletionOutcome.forStatus(202),
          AccountDeletionOutcome.pending);
      expect(AccountDeletionOutcome.pending.accountIsGone, isFalse);
      expect(AccountDeletionOutcome.pending.plainMessage,
          contains("isn't finished yet"));
    });

    test('501 · nothing was deleted — the route refuses BEFORE it destroys',
        () {
      expect(
        AccountDeletionOutcome.forStatus(501),
        AccountDeletionOutcome.notConfigured,
      );
    });

    test('502 · the data is gone and the SIGN-IN is not', () {
      expect(
        AccountDeletionOutcome.forStatus(502),
        AccountDeletionOutcome.signInSurvives,
      );
    });

    test('401 / 403 / 503 refused before any row was touched', () {
      for (final int s in <int>[401, 403, 503]) {
        expect(
          AccountDeletionOutcome.forStatus(s),
          AccountDeletionOutcome.nothingDeleted,
        );
      }
    });

    test('no status at all is NOT a refusal', () {
      // RestClient reports "no response" as statusCode 0. Whether the request
      // ever arrived is unknowable, so nothing may be claimed about it.
      expect(
        AccountDeletionOutcome.forStatus(0),
        AccountDeletionOutcome.couldNotReach,
      );
    });

    test('🔴 AN UNMODELLED 5xx IS `unknown`, NOT `nothingDeleted`', () {
      // The route deletes rows BEFORE it deletes the identity, so an unhandled
      // 500 may have left the account half-erased. "Nothing was deleted" there
      // would be a guess presented as a fact.
      expect(AccountDeletionOutcome.forStatus(500),
          AccountDeletionOutcome.unknown);
      expect(AccountDeletionOutcome.forStatus(418),
          AccountDeletionOutcome.unknown);
    });

    test('reauthFailed is client-only — no status produces it', () {
      for (int s = 0; s <= 599; s++) {
        expect(
          AccountDeletionOutcome.forStatus(s),
          isNot(AccountDeletionOutcome.reauthFailed),
          reason: 'status $s must not resolve to a client-side outcome',
        );
      }
    });
  });

  group('the messages are the honest part', () {
    test('🔴 NO TWO OUTCOMES SHARE A SENTENCE', () {
      final Set<String> said = AccountDeletionOutcome.values
          .map((AccountDeletionOutcome o) => o.plainMessage)
          .toSet();
      expect(
        said.length,
        AccountDeletionOutcome.values.length,
        reason:
            'collapsing two outcomes into one message is exactly the defect '
            'this type exists to prevent',
      );
    });

    test('only the success message says the account has been deleted', () {
      for (final AccountDeletionOutcome o in AccountDeletionOutcome.values) {
        if (o.accountIsGone) continue;
        expect(
          o.plainMessage,
          isNot(contains('has been deleted')),
          reason: '$o would tell the user the one thing they cannot check',
        );
      }
      expect(
        AccountDeletionOutcome.deleted.plainMessage,
        contains('has been deleted'),
      );
    });

    test('502 does NOT claim the data survived, and 501 does NOT claim it went',
        () {
      expect(
        AccountDeletionOutcome.signInSurvives.plainMessage,
        contains('Your data was deleted'),
      );
      expect(
        AccountDeletionOutcome.notConfigured.plainMessage,
        startsWith('Nothing was deleted'),
      );
    });

    test('the reauth message does not claim a sign-out that did not happen',
        () {
      // A mistyped password leaves the session exactly as it was; every
      // server-side refusal signs out. Getting this backwards is why the two are
      // separate values.
      expect(
        AccountDeletionOutcome.reauthFailed.plainMessage,
        contains('still signed in'),
      );
      expect(
        AccountDeletionOutcome.nothingDeleted.plainMessage,
        contains('signed out'),
      );
    });

    test(
        '🔴 NOTHING INVENTS A TURNAROUND TIME, RETENTION PERIOD OR LEGAL BASIS',
        () {
      // sites/nikatru/delete-account.html publishes none of those on purpose. An
      // app string promising one would commit the business to it.
      const List<String> forbidden = <String>[
        'business day',
        'within 30',
        '30 days',
        'retain',
        'retention',
        'legally',
        'law requires',
        'guarantee',
      ];
      for (final AccountDeletionOutcome o in AccountDeletionOutcome.values) {
        final String lower = o.plainMessage.toLowerCase();
        for (final String f in forbidden) {
          expect(lower, isNot(contains(f)), reason: '$o invents policy: "$f"');
        }
      }
    });
  });

  group('AccountDeletionFailure carries the outcome, not a sentence to parse',
      () {
    test('it IS an AuthFailure, so the seam contract is unchanged', () {
      final AccountDeletionFailure f = AccountDeletionFailure.forStatus(502);
      expect(f, isA<AuthFailure>());
      expect(f.outcome, AccountDeletionOutcome.signInSurvives);
      expect(f.message, AccountDeletionOutcome.signInSurvives.plainMessage);
    });

    test('🔴 A 2xx CANNOT BE TURNED INTO A FAILURE', () {
      // Building a "failure" from a success status would report a deletion that
      // worked as one that did not — the mirror image of the defect above.
      expect(() => AccountDeletionFailure.forStatus(200),
          throwsA(isA<AssertionError>()));
    });

    test('an unrecognised error resolves to `unknown`, never to a refusal', () {
      expect(
        accountDeletionOutcomeOf(StateError('something else entirely')),
        AccountDeletionOutcome.unknown,
      );
      expect(
        accountDeletionOutcomeOf(AuthFailure('a plain auth failure')),
        AccountDeletionOutcome.unknown,
      );
      expect(
        accountDeletionOutcomeOf(AccountDeletionFailure.forStatus(501)),
        AccountDeletionOutcome.notConfigured,
      );
    });
  });

  // ⏱ 2026-09-15 · O-OAUTH-DELETE-REAUTH (owner ruling on OWNER_QUEUE A-10).
  group('confirmIdentityWithProvider', () {
    final DateTime now = DateTime.utc(2026, 9, 15, 12);
    AuthUser apple(DateTime? at, {String id = 'u1'}) => AuthUser(
          id: id,
          email: 'relay@privaterelay.appleid.com',
          hasPasswordIdentity: false,
          lastSignInAt: at,
        );

    test('a sign-in inside the freshness window needs no second sheet',
        () async {
      final _ProviderAuth auth = _ProviderAuth();
      await confirmIdentityWithProvider(
        auth: auth,
        user: apple(now.subtract(const Duration(minutes: 2))),
        now: () => now,
      );
      expect(auth.appleCalls, 0);
    });

    test(
        'a stale sign-in opens the sheet and returns on a NEWER sign-in of the SAME account',
        () async {
      final _ProviderAuth auth = _ProviderAuth()
        ..emitOnApple = apple(now.add(const Duration(seconds: 5)));
      await confirmIdentityWithProvider(
        auth: auth,
        user: apple(now.subtract(const Duration(hours: 3))),
        now: () => now,
      );
      expect(auth.appleCalls, 1);
    });

    test('🔴 a DIFFERENT account arriving is not a confirmation', () async {
      final _ProviderAuth auth = _ProviderAuth()
        ..emitOnApple =
            apple(now.add(const Duration(seconds: 5)), id: 'someone-else');
      await expectLater(
        confirmIdentityWithProvider(
          auth: auth,
          user: apple(now.subtract(const Duration(hours: 3))),
          now: () => now,
          timeout: const Duration(milliseconds: 50),
        ),
        throwsA(isA<AuthFailure>()),
      );
    });

    test(
        '🔴 the same session re-emitted (a refresh, no new sign-in) is not a confirmation',
        () async {
      final DateTime old = now.subtract(const Duration(hours: 3));
      final _ProviderAuth auth = _ProviderAuth()..emitOnApple = apple(old);
      await expectLater(
        confirmIdentityWithProvider(
          auth: auth,
          user: apple(old),
          now: () => now,
          timeout: const Duration(milliseconds: 50),
        ),
        throwsA(isA<AuthFailure>()),
      );
    });

    test(
        '🔴 a sheet that never completes times out as an AuthFailure (reauthFailed)',
        () async {
      final _ProviderAuth auth = _ProviderAuth();
      await expectLater(
        confirmIdentityWithProvider(
          auth: auth,
          user: apple(null),
          now: () => now,
          timeout: const Duration(milliseconds: 50),
        ),
        throwsA(isA<AuthFailure>()),
      );
      expect(auth.appleCalls, 1);
    });

    test('the freshness window is strictly inside the server window (600 s)',
        () {
      expect(kProviderReauthFreshness.inSeconds, lessThan(600));
    });
  });

  group('AuthUser carries the password identity and the last sign-in', () {
    test('both survive a JSON round trip', () {
      final AuthUser u = AuthUser(
        id: 'u1',
        email: 'a@b.test',
        hasPasswordIdentity: false,
        lastSignInAt: DateTime.utc(2026, 9, 15, 12),
      );
      expect(AuthUser.fromJson(u.toJson()), u);
    });

    test('an older payload without the fields reads as a password account', () {
      final AuthUser u =
          AuthUser.fromJson(<String, Object?>{'id': 'u1', 'email': 'a@b.test'});
      expect(u.hasPasswordIdentity, isTrue);
      expect(u.lastSignInAt, isNull);
    });

    test('the deletion messages no longer send an Apple user to email', () {
      expect(AccountDeletionOutcome.reauthFailed.plainMessage,
          isNot(contains('by email')));
      expect(
        AccountDeletionOutcome.reauthFailed.plainMessage,
        contains('signing in with Apple'),
      );
      expect(AccountDeletionOutcome.reauthFailed.plainMessage,
          contains('still signed in'));
    });
  });
  // ⏱ 2026-09-16 · O-SIWA-TOKEN-NOT-REVOKED-ON-DELETE. The provider offers its own
  // refresh token exactly once — on the session that completes the OAuth redirect —
  // and stores none of it. Miss that moment and the account's deletion has nothing
  // to revoke with.
  group('keepAppleRefreshToken', () {
    test('sends the token the moment a sign-in carries one', () async {
      final List<String> sent = <String>[];
      final _ProviderAuth auth = _ProviderAuth()
        ..session = const AuthSession(
          accessToken: 'a',
          providerRefreshToken: 'apple-refresh-1',
        );
      final StreamSubscription<AuthUser?> sub = keepAppleRefreshToken(
        auth: auth,
        send: (String t) async => sent.add(t),
      );
      addTearDown(sub.cancel);
      auth.users.add(const AuthUser(id: 'u1', email: 'a@b.test'));
      await Future<void>.delayed(Duration.zero);
      expect(sent, <String>['apple-refresh-1']);
    });

    test('🔴 the SAME token is never sent twice, and a NEW one is', () async {
      final List<String> sent = <String>[];
      final _ProviderAuth auth = _ProviderAuth()
        ..session = const AuthSession(
          accessToken: 'a',
          providerRefreshToken: 'apple-refresh-1',
        );
      final StreamSubscription<AuthUser?> sub = keepAppleRefreshToken(
        auth: auth,
        send: (String t) async => sent.add(t),
      );
      addTearDown(sub.cancel);
      const AuthUser u = AuthUser(id: 'u1', email: 'a@b.test');
      auth.users.add(u);
      await Future<void>.delayed(Duration.zero);
      // A token refresh re-emits the same user; the session's provider token is
      // the same string, and re-posting it every time would be a credential on
      // the wire for no reason.
      auth.users.add(u);
      await Future<void>.delayed(Duration.zero);
      expect(sent, <String>['apple-refresh-1']);

      auth.session = const AuthSession(
        accessToken: 'a',
        providerRefreshToken: 'apple-refresh-2',
      );
      auth.users.add(u);
      await Future<void>.delayed(Duration.zero);
      expect(sent, <String>['apple-refresh-1', 'apple-refresh-2']);
    });

    test('a sign-out, and a session with no provider token, send nothing', () async {
      final List<String> sent = <String>[];
      final _ProviderAuth auth = _ProviderAuth()
        ..session = const AuthSession(accessToken: 'a');
      final StreamSubscription<AuthUser?> sub = keepAppleRefreshToken(
        auth: auth,
        send: (String t) async => sent.add(t),
      );
      addTearDown(sub.cancel);
      auth.users.add(null);
      auth.users.add(const AuthUser(id: 'u1', email: 'a@b.test'));
      await Future<void>.delayed(Duration.zero);
      expect(sent, isEmpty);
    });

    test('🔴 a failed send never breaks the sign-in', () async {
      final List<Object> errors = <Object>[];
      final _ProviderAuth auth = _ProviderAuth()
        ..session = const AuthSession(
          accessToken: 'a',
          providerRefreshToken: 'apple-refresh-1',
        );
      final StreamSubscription<AuthUser?> sub = keepAppleRefreshToken(
        auth: auth,
        send: (String _) async => throw StateError('server refused'),
        onError: errors.add,
        retryDelays: const <Duration>[],
      );
      addTearDown(sub.cancel);
      auth.users.add(const AuthUser(id: 'u1', email: 'a@b.test'));
      await Future<void>.delayed(Duration.zero);
      expect(errors, hasLength(1));
      expect(errors.single, isA<AppleTokenNotKept>());
    });

    // ⏱ 2026-09-22 — THE SEND THAT NEVER LANDED WAS RECORDED AS SENT. The shared
    // Worker's CORS list left out PUT, so every web send was refused at
    // preflight; the keeper had already written the token down as delivered, so
    // it never tried again and nothing reported it. These pin the three halves
    // of the fix: a refused send is retried, retrying STOPS, and giving up says so.
    //
    // RED CONTROL (recorded 2026-09-22): moving `lastSent = token;` back above
    // `await send(token);` in apple_token_keeper.dart turns the first two red —
    // the retry re-reads the session, finds the token already "sent", and stops.
    // ⏱ 2026-09-24: that line is now `await send(provider, token);` in
    // provider_token_keeper.dart, which keepAppleRefreshToken wraps.
    group('delivery is retried, bounded, and reported', () {
      const List<Duration> quick = <Duration>[Duration.zero, Duration.zero];
      const AuthUser u = AuthUser(id: 'u1', email: 'a@b.test');

      // Enough event-loop turns for every zero-length retry timer to fire.
      Future<void> settle() async {
        for (int i = 0; i < 20; i++) {
          await Future<void>.delayed(Duration.zero);
        }
      }

      _ProviderAuth signedInWithApple() => _ProviderAuth()
        ..session = const AuthSession(
          accessToken: 'a',
          providerRefreshToken: 'apple-refresh-1',
        );

      test('🔴 a send that fails once and then succeeds is retried, and lands',
          () async {
        int attempts = 0;
        final List<String> landed = <String>[];
        final List<Object> errors = <Object>[];
        final _ProviderAuth auth = signedInWithApple();
        final StreamSubscription<AuthUser?> sub = keepAppleRefreshToken(
          auth: auth,
          send: (String t) async {
            attempts++;
            if (attempts == 1) throw StateError('preflight refused');
            landed.add(t);
          },
          onError: errors.add,
          retryDelays: quick,
        );
        addTearDown(sub.cancel);
        auth.users.add(u);
        await settle();
        expect(attempts, 2, reason: 'the refused send must be tried again');
        expect(landed, <String>['apple-refresh-1']);
        expect(errors, isEmpty, reason: 'a round that landed reports nothing');

        // Landed means recorded: the same token is not posted again.
        auth.users.add(u);
        await settle();
        expect(attempts, 2);
      });

      test('🔴 a send that always fails stops at the bound and reports once',
          () async {
        int attempts = 0;
        final List<Object> errors = <Object>[];
        final _ProviderAuth auth = signedInWithApple();
        final StreamSubscription<AuthUser?> sub = keepAppleRefreshToken(
          auth: auth,
          send: (String t) async {
            attempts++;
            // The failure QUOTES the token, as a careless server might: the
            // report must not carry it onward.
            throw StateError('refused $t');
          },
          onError: errors.add,
          retryDelays: quick,
        );
        addTearDown(sub.cancel);
        auth.users.add(u);
        await settle();
        expect(attempts, 3, reason: 'one attempt, then one per retry delay');
        expect(errors, hasLength(1));
        final AppleTokenNotKept report = errors.single as AppleTokenNotKept;
        expect(report.attempts, 3);
        expect(report.toString(), isNot(contains('apple-refresh-1')));
        expect(report.toString(), contains('refused'));

        await settle();
        expect(attempts, 3, reason: 'retrying must stop at the bound');

        // …and the next auth-state change starts a fresh bounded round,
        // because the token was never recorded as delivered.
        auth.users.add(u);
        await settle();
        expect(attempts, 6);
        expect(errors, hasLength(2));
      });

      test('a sign-out abandons a pending retry', () async {
        int attempts = 0;
        final _ProviderAuth auth = signedInWithApple();
        final StreamSubscription<AuthUser?> sub = keepAppleRefreshToken(
          auth: auth,
          send: (String _) async {
            attempts++;
            throw StateError('refused');
          },
          retryDelays: const <Duration>[Duration(milliseconds: 30)],
        );
        addTearDown(sub.cancel);
        auth.users.add(u);
        await Future<void>.delayed(Duration.zero);
        expect(attempts, 1);
        auth.users.add(null);
        await Future<void>.delayed(const Duration(milliseconds: 80));
        expect(attempts, 1, reason: 'no retry may fire after the sign-out');
      });

      test('cancelling the keeper cancels a pending retry', () async {
        int attempts = 0;
        final List<Object> errors = <Object>[];
        final _ProviderAuth auth = signedInWithApple();
        final StreamSubscription<AuthUser?> sub = keepAppleRefreshToken(
          auth: auth,
          send: (String _) async {
            attempts++;
            throw StateError('refused');
          },
          onError: errors.add,
          retryDelays: const <Duration>[Duration(milliseconds: 30)],
        );
        auth.users.add(u);
        await Future<void>.delayed(Duration.zero);
        expect(attempts, 1);
        await sub.cancel();
        await Future<void>.delayed(const Duration(milliseconds: 80));
        expect(attempts, 1, reason: 'a timer must not outlive its listener');
        expect(errors, isEmpty);
      });
    });
  });
}
