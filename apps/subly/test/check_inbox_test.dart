// ─────────────────────────────────────────────────────────────────────────────
// A SIGN-UP THAT RETURNS NO SESSION HAS SOMEWHERE TO GO.
//
// 🔴 THE DEFECT THIS PINS, MEASURED ON THE LIVE PROJECT. With Supabase's
// "Confirm email" ON, `signUp` hands back a user and NO SESSION. Every gate in
// `core/router.dart` therefore reads the registrant as SIGNED OUT — including
// the verification gate, whose test is `sessionIsUnverified`, and that answers
// FALSE for a null user BY DESIGN (`identity_assurance.dart:36`: a visitor with
// no session is not "unverified", they are signed out). So nothing fired:
//
//   · through `/sign-up`, the screen re-enabled its button and stayed put;
//   · through `LoginScreen`'s toggle — the door most users take, because
//     `/sign-in` is where the router sends every signed-out visitor — the code
//     ran `context.go('/scan')` unconditionally, and `/scan` is on the
//     signed-out allowlist, so a brand-new registrant landed on a RECEIPT
//     SCANNER, signed out, told nothing about the mail in their inbox.
//
// 2 of the 4 accounts on the live project are unconfirmed with
// `last_sign_in_at` NULL.
//
// ⚠️ EVERY LIMB IS DRIVEN THROUGH THE REAL ROUTER, and it has to be: the bug was
// never in a screen or in a gate. Both worked. It was in what happens BETWEEN
// them, which only a test that owns the whole navigation can see.
//
// ⚠️ AND EVERY LIMB HAS ITS OPPOSITE. A destination asserted only in the
// no-session case passes just as well against a screen that sends EVERY sign-up
// to `/check-inbox` — which would strand the "Confirm email" OFF user on a
// waiting room for a mail they do not need. So the session-appeared arm is
// driven too, and it must NOT land here.
// ─────────────────────────────────────────────────────────────────────────────
import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:subly/core/e2e_keys.dart';
import 'package:subly/core/router.dart';
import 'package:subly/features/auth/check_inbox_screen.dart';
import 'package:subly/features/auth/legal_consent_fields.dart';
import 'package:subly/features/auth/sign_up_screen.dart';
import 'package:subly/l10n/app_localizations.dart';
import 'package:subly/state/providers.dart';

const String _address = 'newcomer@b.test';

/// An in-memory `KeyValueStore`, so nothing here touches SharedPreferences.
class _MemStore implements core.KeyValueStore {
  final Map<String, String> data = <String, String>{};

  @override
  Future<String?> read(String key) async => data[key];

  @override
  Future<bool> containsKey(String key) async => data.containsKey(key);

  @override
  Future<void> remove(String key) async => data.remove(key);

  @override
  Future<void> write(String key, String value) async => data[key] = value;
}

/// The router declines to decide while the onboarding flag hydrates, so a
/// router test that never answers stalls before its first real frame.
class _OnboardingSeen extends OnboardingSeenController {
  @override
  bool? build() => true;
}

/// A repository that registers the account and hands back NO SESSION — the
/// shape gotrue produces with "Confirm email" ON.
///
/// 🔴 `currentUser` STAYS NULL AFTER A SUCCESSFUL SIGN-UP, and that is the whole
/// fixture. `signUpWithEmail` returning an [core.AuthUser] while the synchronous
/// snapshot the router reads stays null is not a contrivance: the return value
/// is `res.user` and the snapshot is `res.session?.user`, and those are
/// different things on this path.
class _ConfirmationRequiredAuth extends core.AuthRepository {
  final List<String> signUps = <String>[];

  @override
  core.AuthUser? get currentUser => null;

  @override
  Stream<core.AuthUser?> authStateChanges() =>
      const Stream<core.AuthUser?>.empty();

  @override
  Future<core.AuthUser> signUpWithEmail({
    required String email,
    required String password,
    String? captchaToken,
  }) async {
    signUps.add(email);
    return core.AuthUser(id: 'u1', email: email);
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

/// The other arm: "Confirm email" OFF, so the session arrives with the account.
class _ImmediateSessionAuth extends core.AuthRepository {
  core.AuthUser? _user;
  final StreamController<core.AuthUser?> changes =
      StreamController<core.AuthUser?>.broadcast();

  @override
  core.AuthUser? get currentUser => _user;

  @override
  Stream<core.AuthUser?> authStateChanges() => changes.stream;

  @override
  Future<core.AuthUser> signUpWithEmail({
    required String email,
    required String password,
    String? captchaToken,
  }) async {
    _user = core.AuthUser(id: 'u1', email: email, emailVerified: true);
    changes.add(_user);
    return _user!;
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

/// Captures what would have gone to the append-only consent record.
class _RecordingTransport implements core.ConsentTransport {
  final List<core.ConsentArtifact> sent = <core.ConsentArtifact>[];

  @override
  Future<core.Result<void>> send({
    required String appId,
    required core.ConsentArtifact artifact,
  }) async {
    sent.add(artifact);
    return const core.Result<void>.ok(null);
  }
}

ProviderContainer _container(core.AuthRepository auth) => ProviderContainer(
  overrides: <Override>[
    onboardingSeenProvider.overrideWith(_OnboardingSeen.new),
    authRepositoryProvider.overrideWithValue(auth),
    keyValueStoreProvider.overrideWith((ref) async => _MemStore()),
    consentTransportProvider.overrideWithValue(_RecordingTransport()),
    analyticsConsentProvider.overrideWithValue(core.ConsentStatus.denied),
  ],
);

/// Mount the REAL router and settle its first frame.
///
/// ⚠️ THE SURFACE IS PINNED TALL, and it is not decoration. flutter_test's
/// default is 800×600; `LoginScreen`'s sign-up arm is taller than that, so the
/// toggle at its foot — the ONLY way to reach the second sign-up door — lands
/// below the viewport and `tap()` degrades to a warning plus a miss rather than
/// a failure. The limb would then fail two lines later, on a checkbox that is
/// absent because the toggle never flipped, which reads as a defect in the
/// screen instead of in the harness.
Future<void> _pumpApp(WidgetTester tester, ProviderContainer c) async {
  await tester.binding.setSurfaceSize(const Size(800, 1600));
  addTearDown(() => tester.binding.setSurfaceSize(null));
  await tester.pumpWidget(
    UncontrolledProviderScope(
      container: c,
      child: MaterialApp.router(
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        routerConfig: c.read(routerProvider),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

String _where(ProviderContainer c) =>
    c.read(routerProvider).routerDelegate.currentConfiguration.uri.path;

/// Register through `/sign-up` — the dedicated door.
Future<void> _signUpViaSignUpScreen(WidgetTester tester) async {
  await tester.enterText(find.byType(TextField).at(0), _address);
  await tester.enterText(find.byType(TextField).at(1), 'password123');
  await tester.tap(find.byKey(LegalConsentFields.termsCheckbox));
  await tester.pumpAndSettle();
  await tester.tap(find.byKey(SignUpScreen.submitButton));
  await tester.pumpAndSettle();
}

/// Register through `LoginScreen`'s toggle — the door the router sends every
/// signed-out visitor to, and the one that used to end on `/scan`.
Future<void> _signUpViaLoginScreen(
  WidgetTester tester,
  AppLocalizations l10n,
) async {
  await tester.tap(find.text(l10n.newHerePrompt));
  await tester.pumpAndSettle();
  await tester.enterText(find.byKey(E2EKeys.loginEmail), _address);
  await tester.enterText(find.byKey(E2EKeys.loginPassword), 'password123');
  await tester.tap(find.byKey(LegalConsentFields.termsCheckbox));
  await tester.pumpAndSettle();
  await tester.tap(find.byKey(E2EKeys.loginSubmit));
  await tester.pumpAndSettle();
}

void main() {
  // The SHIPPED English strings, resolved the way the app resolves them —
  // never re-typed here. A test carrying its own copy of a sentence goes on
  // passing after the arb changes, which is a test that has stopped reading it.
  final AppLocalizations en = lookupAppLocalizations(const Locale('en'));

  group('a sign-up with no session lands on /check-inbox', () {
    testWidgets('through /sign-up, and the screen NAMES the address', (
      WidgetTester tester,
    ) async {
      final _ConfirmationRequiredAuth auth = _ConfirmationRequiredAuth();
      final ProviderContainer c = _container(auth);
      addTearDown(c.dispose);
      await _pumpApp(tester, c);

      c.read(routerProvider).go('/sign-up');
      await tester.pumpAndSettle();
      await _signUpViaSignUpScreen(tester);

      // The premise, asserted rather than assumed: without a sign-up having
      // really happened the destination check below would be measuring a button
      // that did nothing.
      expect(auth.signUps, <String>[
        _address,
      ], reason: 'the seam never registered anybody');
      expect(
        _where(c),
        '/check-inbox',
        reason:
            'this is the assertion the reverted code fails: before this '
            'increment the screen navigated NOWHERE from here, and the router '
            'could not rescue it because sessionIsUnverified is false for a '
            'null user by design',
      );
      expect(
        find.textContaining(_address),
        findsOneWidget,
        reason:
            'naming the address is the job — it is the only place a mistyped '
            'one is visible, because there is no session to read it back from',
      );
      expect(find.text(en.checkInboxThenSignIn), findsOneWidget);
    });

    testWidgets('through the LoginScreen toggle, which used to reach /scan', (
      WidgetTester tester,
    ) async {
      final _ConfirmationRequiredAuth auth = _ConfirmationRequiredAuth();
      final ProviderContainer c = _container(auth);
      addTearDown(c.dispose);
      await _pumpApp(tester, c);

      // A signed-out visitor starts here without being sent: /onboarding is
      // seen, /home is gated, so the router has already settled on the form.
      expect(_where(c), '/sign-in');
      await _signUpViaLoginScreen(tester, en);

      expect(auth.signUps, <String>[_address]);
      expect(
        _where(c),
        '/check-inbox',
        reason:
            'THE NEGATIVE TEST FOR THE REVERT: put `context.go(\'/scan\')` back '
            'on this path and this reads /scan — a signed-out registrant on a '
            'receipt scanner, which is what shipped',
      );
      expect(find.textContaining(_address), findsOneWidget);
    });

    // 🔴 THE OPEN HALF. Without these two, both limbs above pass just as well
    // against a screen that sends EVERY sign-up here — stranding the
    // "Confirm email" OFF user on a waiting room for a mail they never get.
    testWidgets('but a sign-up that DID hand back a session does not', (
      WidgetTester tester,
    ) async {
      final ProviderContainer c = _container(_ImmediateSessionAuth());
      addTearDown(c.dispose);
      await _pumpApp(tester, c);

      c.read(routerProvider).go('/sign-up');
      await tester.pumpAndSettle();
      await _signUpViaSignUpScreen(tester);

      expect(
        _where(c),
        '/home',
        reason:
            'with a session the redirect guard is the only thing that may move '
            'the user; a screen that pushed as well would race it',
      );
    });

    testWidgets('and the LoginScreen door still reaches /scan with a session', (
      WidgetTester tester,
    ) async {
      final ProviderContainer c = _container(_ImmediateSessionAuth());
      addTearDown(c.dispose);
      await _pumpApp(tester, c);
      await _signUpViaLoginScreen(tester, en);

      expect(
        _where(c),
        '/scan',
        reason:
            'the existing destination is untouched for the state it was always '
            'right for — this increment narrows that navigation, it does not '
            'move it',
      );
    });
  });

  group('/check-inbox is not a dead end and not a stray URL', () {
    testWidgets('the way back to sign-in works', (WidgetTester tester) async {
      final ProviderContainer c = _container(_ConfirmationRequiredAuth());
      addTearDown(c.dispose);
      await _pumpApp(tester, c);

      c.read(routerProvider).go('/check-inbox', extra: _address);
      await tester.pumpAndSettle();
      expect(_where(c), '/check-inbox');

      await tester.tap(find.byKey(CheckInboxScreen.backToSignInButton));
      await tester.pumpAndSettle();
      expect(
        _where(c),
        '/sign-in',
        reason:
            'confirming happens in a mail client, so the only thing this app '
            'can do next is take their password; without this control the '
            'screen is the dead end it was built to remove',
      );
    });

    testWidgets('typing the URL with no sign-up behind it goes to the form', (
      WidgetTester tester,
    ) async {
      final ProviderContainer c = _container(_ConfirmationRequiredAuth());
      addTearDown(c.dispose);
      await _pumpApp(tester, c);

      c.read(routerProvider).go('/check-inbox');
      await tester.pumpAndSettle();
      expect(
        _where(c),
        '/sign-in',
        reason:
            'no address, no screen — the alternative is "we sent a link to " '
            'with a blank where the address should be',
      );
    });

    // The address is carried by the NAVIGATION, never by the URL: an email
    // address in a path or a query string is a real address in browser history,
    // in a referrer, and in every log the page's assets touch.
    testWidgets('the address never appears in the location', (
      WidgetTester tester,
    ) async {
      final ProviderContainer c = _container(_ConfirmationRequiredAuth());
      addTearDown(c.dispose);
      await _pumpApp(tester, c);

      c.read(routerProvider).go('/sign-up');
      await tester.pumpAndSettle();
      await _signUpViaSignUpScreen(tester);

      expect(
        c
            .read(routerProvider)
            .routerDelegate
            .currentConfiguration
            .uri
            .toString(),
        isNot(contains('@')),
      );
    });
  });
}
