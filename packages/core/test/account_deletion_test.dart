import 'package:nikatru_core/nikatru_core.dart';
import 'package:test/test.dart';

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
}
