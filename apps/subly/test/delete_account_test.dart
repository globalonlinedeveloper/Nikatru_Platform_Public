import 'dart:async';
import 'dart:io' show SocketException;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:subly/core/router.dart';
import 'package:subly/data/auth/mock_auth_repository.dart';
import 'package:subly/features/auth/login_screen.dart';
import 'package:subly/features/settings/settings_screen.dart';
import 'package:subly/l10n/app_localizations.dart';
import 'package:subly/state/providers.dart';

/// THE STORE-MANDATED DELETION PATH, AND THE PART THAT IS EASY TO GET WRONG.
///
/// Both stores require an in-app way to delete an account wherever one can be
/// created, and this app had none: `deleteAccount()` was an unconditional throw,
/// so there was nothing honest to point a button at. [ADR 027].
///
/// A button is the cheap half. The half that matters is that it does not LIE:
/// `DELETE /v1/account` answers 501 when it cannot delete the identity record
/// (nothing was deleted at all) and 502 when the rows went and the identity did
/// not (the data is gone and the same password still signs in). A `catch (_)`
/// printing one message collapses those, and the 502 case is the one a user can
/// never discover for themselves.
///
/// Every assertion below is on WHAT THE USER IS TOLD, because that is the thing
/// that can be false.
class _MemStore implements core.KeyValueStore {
  final Map<String, String> data = <String, String>{};
  @override
  Future<bool> containsKey(String key) async => data.containsKey(key);
  @override
  Future<String?> read(String key) async => data[key];
  @override
  Future<void> remove(String key) async => data.remove(key);
  @override
  Future<void> write(String key, String value) async => data[key] = value;
}

/// A repository whose `deleteAccount` fails the way the REAL route fails.
///
/// It throws `core.AccountDeletionFailure.forStatus(...)` — the exact object
/// `requestAccountDeletion` builds from an `ApiException` — rather than a
/// hand-written error, so a change to that mapping breaks these tests instead of
/// leaving them agreeing with a copy of the old behaviour.
class _FakeAuth implements core.AuthRepository {
  _FakeAuth({this.deleteStatus});

  /// The HTTP status the server answers with, or null for a clean delete.
  final int? deleteStatus;

  /// The only password this fake accepts. A constant rather than a constructor
  /// parameter: every test that needs the wrong one passes a different string,
  /// so a settable field would be an option nothing uses.
  static const String rightPassword = 'correct-horse';

  bool signedIn = true;
  int deleteCalls = 0;
  int signOutCalls = 0;

  /// Thrown by [signInWithEmail] instead of an `AuthFailure` — a transport
  /// error, not the provider refusing the credentials.
  Object? reauthThrows;

  @override
  core.AuthUser? get currentUser =>
      signedIn ? const core.AuthUser(id: 'u1', email: 'a@b.test') : null;

  /// 🔴 A REAL STREAM THAT REALLY EMITS ON SIGN-OUT. The first version of this
  /// fake returned `Stream.value(currentUser)` — a single-value stream that
  /// completes at construction and never fires again — so the router's
  /// `refreshListenable` never re-ran the redirect and the survives-the-redirect
  /// test below could not have failed. An assertion that cannot fail is worse
  /// than none.
  final StreamController<core.AuthUser?> _authChanges =
      StreamController<core.AuthUser?>.broadcast();

  @override
  Stream<core.AuthUser?> authStateChanges() => _authChanges.stream;

  @override
  Future<core.AuthUser> signInWithEmail({
    required String email,
    required String password,
  }) async {
    if (reauthThrows != null) throw reauthThrows!;
    if (password != rightPassword) throw core.AuthFailure('Invalid login');
    return currentUser!;
  }

  @override
  Future<void> deleteAccount() async {
    deleteCalls++;
    // The real seam signs out REGARDLESS of the outcome, and this mirrors it —
    // the messages under test say whether the user was signed out.
    await signOut();
    if (deleteStatus != null) {
      throw core.AccountDeletionFailure.forStatus(deleteStatus!);
    }
  }

  @override
  Future<void> signOut() async {
    signOutCalls++;
    signedIn = false;
    _authChanges.add(null);
  }

  @override
  Future<String?> currentAccessToken() async => 'token';
  @override
  Future<core.AuthSession?> currentSession() async => null;
  @override
  Future<core.AuthUser> signUpWithEmail({
    required String email,
    required String password,
  }) async => currentUser!;
  @override
  Future<void> sendPasswordReset(String email) async {}
  @override
  Future<void> signInWithApple() async {}
  @override
  Future<core.AuthUser> updateProfile({required String displayName}) async =>
      currentUser!;
}

Future<void> _pumpSettings(WidgetTester tester, _FakeAuth auth) async {
  // A TALL SURFACE, deliberately. Settings is a ListView, so an off-screen row
  // has no element and `findsNothing` would pass for a control that exists and
  // is merely below the fold — which would make the signed-out assertion below
  // a tautology. Rendering the whole list is what lets absence mean absence.
  tester.view.physicalSize = const Size(1200, 4000);
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    ProviderScope(
      overrides: <Override>[
        onboardingSeenProvider.overrideWith(_OnboardingSeen.new),
        authRepositoryProvider.overrideWithValue(auth),
        keyValueStoreProvider.overrideWith((ref) async => _MemStore()),
        analyticsConsentProvider.overrideWithValue(core.ConsentStatus.denied),
      ],
      // P2.6b: the merged screen reads l10n and l10n.yaml sets
      // nullable-getter:false — a host without delegates throws on first pump.
      child: const MaterialApp(
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: Scaffold(body: SettingsScreen()),
      ),
    ),
  );
  // pumpAndSettle, never a bare pump(): the settings controller hydrates from
  // the store asynchronously, and `pump()` with no duration runs NO timers.
  await tester.pumpAndSettle();
}

/// Open the dialog and get as far as a typed password.
Future<void> _openDialog(WidgetTester tester, String password) async {
  await tester.tap(find.text('Delete account'));
  await tester.pumpAndSettle();
  await tester.enterText(
    find.byKey(const Key('deleteAccountPassword')),
    password,
  );
  await tester.pumpAndSettle();
}

String _resultText(WidgetTester tester) =>
    tester.widget<Text>(find.byKey(const Key('deleteAccountResult'))).data!;

/// P2.6a: the union router's onboarding gate DECLINES TO DECIDE while the
/// seen-flag is still hydrating (null) and sends seen=false to /onboarding —
/// so a router test that never answers the question stalls before its first
/// real frame. Predicted by the re-stamp red-team pass, observed here.
class _OnboardingSeen extends OnboardingSeenController {
  @override
  bool? build() => true;
}

void main() {
  testWidgets(
    '🔴 THE OUTCOME SURVIVES THE SIGN-OUT REDIRECT — driven through the REAL router',
    (WidgetTester tester) async {
      // The trap this test exists for: `deleteAccount()` signs out whichever way
      // the request went, the auth stream fires, and go_router replaces the page
      // stack with /login. A message posted to the screen being torn down —
      // SnackBar or pageless dialog — is raced by that teardown. Every other test
      // in this file pumps SettingsScreen bare, so none of them would notice.
      //
      // 502 is the case that matters: the data is gone and the login still
      // works, and it is the one state a user cannot discover for themselves.
      tester.view.physicalSize = const Size(1200, 4000);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.reset);

      final _FakeAuth auth = _FakeAuth(deleteStatus: 502);
      final ProviderContainer container = ProviderContainer(
        overrides: <Override>[
          onboardingSeenProvider.overrideWith(_OnboardingSeen.new),
          authRepositoryProvider.overrideWithValue(auth),
          keyValueStoreProvider.overrideWith((ref) async => _MemStore()),
          analyticsConsentProvider.overrideWithValue(core.ConsentStatus.denied),
        ],
      );
      addTearDown(container.dispose);

      await tester.pumpWidget(
        UncontrolledProviderScope(
          container: container,
          child: MaterialApp.router(
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            supportedLocales: AppLocalizations.supportedLocales,
            routerConfig: container.read(routerProvider),
          ),
        ),
      );
      await tester.pumpAndSettle();
      container.read(routerProvider).go('/settings');
      await tester.pumpAndSettle();

      await tester.tap(find.text('Delete account'));
      await tester.pumpAndSettle();
      await tester.enterText(
        find.byKey(const Key('deleteAccountPassword')),
        _FakeAuth.rightPassword,
      );
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('deleteAccountConfirm')));
      await tester.pumpAndSettle();

      expect(auth.deleteCalls, 1);
      expect(auth.signedIn, isFalse, reason: 'the seam signs out regardless');
      // The redirect really happened — otherwise this test proves nothing.
      expect(find.byType(LoginScreen), findsOneWidget);
      expect(
        find.byKey(const Key('accountDeletionNotice')),
        findsOneWidget,
        reason:
            'the sign-out redirect must not carry away the only message telling '
            'the user their data is gone and their login is not',
      );
      expect(
        tester
            .widget<Text>(find.byKey(const Key('accountDeletionNoticeText')))
            .data!,
        contains('sign-in was NOT'),
      );

      // …and it does not haunt a later sign-out.
      await tester.tap(find.text('Dismiss'));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('accountDeletionNotice')), findsNothing);
    },
  );

  // A plain `test`, not `testWidgets`: there is no widget here, and inside
  // testWidgets' FakeAsync zone a real future only advances when something
  // pumps — so this stalled for the full ten-minute timeout before it was moved.
  test('DEMO MODE MUST NOT CLAIM A DELETION — the mock refuses', () async {
    // `build-platforms.yml` builds every non-web artifact WITHOUT the identity
    // dart-defines, so those runs use MockAuthRepository. It used to sign out and
    // return normally, which this dialog would render as "Your account has been
    // deleted" — while the same email and password sign straight back in,
    // because the mock accepts anything.
    final MockAuthRepository mock = MockAuthRepository();
    await mock.signInWithEmail(email: 'a@b.test', password: 'anything');
    await expectLater(
      mock.deleteAccount(),
      throwsA(
        isA<core.AccountDeletionFailure>().having(
          (core.AccountDeletionFailure f) => f.outcome,
          'outcome',
          core.AccountDeletionOutcome.notConfigured,
        ),
      ),
      reason: 'only a real 2xx may ever produce `deleted`',
    );
    expect(mock.currentUser, isNull, reason: 'it still signs out');
  });

  testWidgets('a signed-in user is offered the control; a signed-out one is not', (
    WidgetTester tester,
  ) async {
    final _FakeAuth auth = _FakeAuth();
    await _pumpSettings(tester, auth);
    expect(
      find.text('Delete account'),
      findsOneWidget,
      reason:
          'both stores require an in-app deletion path wherever an account can '
          'be created — this app shipped none',
    );

    final _FakeAuth signedOut = _FakeAuth()..signedIn = false;
    await _pumpSettings(tester, signedOut);
    expect(
      find.text('Delete account'),
      findsNothing,
      reason:
          'offering "delete your account" to a signed-out user is an offer the '
          'app cannot honour',
    );
  });

  testWidgets('IT CANNOT BE TRIGGERED ACCIDENTALLY: no password, no delete', (
    WidgetTester tester,
  ) async {
    final _FakeAuth auth = _FakeAuth();
    await _pumpSettings(tester, auth);
    await tester.tap(find.text('Delete account'));
    await tester.pumpAndSettle();

    final Finder confirm = find.byKey(const Key('deleteAccountConfirm'));
    expect(
      tester.widget<FilledButton>(confirm).onPressed,
      isNull,
      reason:
          'the destructive button must be inert until a password is typed — an '
          'irreversible action one stray tap away is the misfire the confirm '
          'step exists to stop',
    );

    await tester.enterText(
      find.byKey(const Key('deleteAccountPassword')),
      'correct-horse',
    );
    await tester.pumpAndSettle();
    expect(tester.widget<FilledButton>(confirm).onPressed, isNotNull);
    expect(
      auth.deleteCalls,
      0,
      reason: 'nothing may be sent before confirming',
    );
  });

  testWidgets('a wrong password deletes NOTHING and never sends the request', (
    WidgetTester tester,
  ) async {
    final _FakeAuth auth = _FakeAuth();
    await _pumpSettings(tester, auth);
    await _openDialog(tester, 'not-my-password');
    await tester.tap(find.byKey(const Key('deleteAccountConfirm')));
    await tester.pumpAndSettle();

    expect(auth.deleteCalls, 0, reason: 'reauth failed — nothing may be sent');
    expect(auth.signedIn, isTrue, reason: 'a typo must not end the session');
    expect(_resultText(tester), contains('could not confirm it was you'));
    expect(_resultText(tester), contains('nothing was deleted'));
    expect(
      _resultText(tester),
      contains('still signed in'),
      reason:
          'every SERVER refusal signs the user out; a typo must not, and the '
          'message must not claim otherwise',
    );
    // The re-auth is `signInWithEmail`, so an account created with "Continue
    // with Apple" has no password here. The message must say so rather than
    // insisting the password was wrong, and the email route must be on screen.
    expect(_resultText(tester), contains('Apple'));
    // The full fallback SENTENCE, not the bare address (P2.6b): the merged
    // settings screen also shows support@nikatru.com in its Contact-support
    // row's subtitle, so the address alone now legitimately appears twice.
    // The property is unchanged — the dialog offers the email route — and the
    // sentence is the dialog's own, so the finder stays unique.
    expect(find.textContaining('and we will finish it'), findsOneWidget);
    expect(find.text('Account deleted'), findsNothing);
  });

  testWidgets('an OFFLINE re-auth is not reported as a wrong password', (
    WidgetTester tester,
  ) async {
    // `catch (_)` swallowed the difference: a train tunnel, a rate-limit and a
    // typo all printed "that password did not match", sending the user round a
    // loop retyping a correct one.
    final _FakeAuth auth = _FakeAuth()
      ..reauthThrows = const SocketException('no route to host');
    await _pumpSettings(tester, auth);
    await _openDialog(tester, _FakeAuth.rightPassword);
    await tester.tap(find.byKey(const Key('deleteAccountConfirm')));
    await tester.pumpAndSettle();

    expect(auth.deleteCalls, 0);
    expect(_resultText(tester), contains('could not reach the server'));
    expect(_resultText(tester), isNot(contains('confirm it was you')));
  });

  testWidgets('501 says NOTHING WAS DELETED and never claims success', (
    WidgetTester tester,
  ) async {
    // The live answer while SUPABASE_SERVICE_ROLE_KEY is unset (an owner
    // action). The route checks that precondition BEFORE destroying anything,
    // which is what makes "nothing was deleted" a safe thing to say.
    final _FakeAuth auth = _FakeAuth(deleteStatus: 501);
    await _pumpSettings(tester, auth);
    await _openDialog(tester, 'correct-horse');
    await tester.tap(find.byKey(const Key('deleteAccountConfirm')));
    await tester.pumpAndSettle();

    expect(auth.deleteCalls, 1);
    expect(find.text('Not deleted'), findsOneWidget);
    expect(find.text('Account deleted'), findsNothing);
    final String said = _resultText(tester);
    expect(said, contains('Nothing was deleted'));
    expect(said, contains('unchanged'));
    // 🔴 THE ANTI-CLAIM. "has been deleted" is the exact phrase the success
    // path uses; a UI that reached this branch and still printed it would be
    // telling the user the one thing they cannot check.
    expect(said, isNot(contains('has been deleted')));
    // And no invented policy: the published page states no turnaround time,
    // retention period or legal basis, so neither may this dialog.
    for (final String forbidden in <String>[
      'business days',
      'within',
      '30 days',
      'retain',
    ]) {
      expect(
        said,
        isNot(contains(forbidden)),
        reason: 'invented policy: $forbidden',
      );
    }
  });

  testWidgets('502 says the DATA is gone and the SIGN-IN is not', (
    WidgetTester tester,
  ) async {
    // The rows were purged and the identity delete failed. This is the state a
    // user cannot discover for themselves, and the one a single "deletion
    // failed" message hides completely.
    final _FakeAuth auth = _FakeAuth(deleteStatus: 502);
    await _pumpSettings(tester, auth);
    await _openDialog(tester, 'correct-horse');
    await tester.tap(find.byKey(const Key('deleteAccountConfirm')));
    await tester.pumpAndSettle();

    final String said = _resultText(tester);
    expect(said, contains('Your data was deleted'));
    expect(said, contains('sign-in was NOT'));
    expect(said, contains('still sign in'));
    expect(find.text('Account deleted'), findsNothing);
    expect(
      said,
      isNot(equals(core.AccountDeletionOutcome.notConfigured.plainMessage)),
      reason:
          '502 and 501 mean opposite things to the user; one message for both '
          'is the defect this dialog exists to avoid',
    );
  });

  testWidgets('a clean delete says so, and only then', (
    WidgetTester tester,
  ) async {
    final _FakeAuth auth = _FakeAuth();
    await _pumpSettings(tester, auth);
    await _openDialog(tester, 'correct-horse');
    await tester.tap(find.byKey(const Key('deleteAccountConfirm')));
    await tester.pumpAndSettle();

    expect(auth.deleteCalls, 1);
    expect(auth.signOutCalls, greaterThan(0));
    expect(find.text('Account deleted'), findsOneWidget);
    expect(_resultText(tester), contains('has been deleted'));
    expect(
      _resultText(tester),
      contains('will not work any more'),
      reason:
          'the published page tells the user to CHECK the deletion by trying to '
          'sign in; the app must name the same test',
    );
  });
}
