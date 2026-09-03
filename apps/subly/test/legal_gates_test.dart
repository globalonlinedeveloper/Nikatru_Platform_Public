// ─────────────────────────────────────────────────────────────────────────────
// THE FOUR AUTH RIDERS, PINNED CLIENT-SIDE (owner locks 2026-08-09 late +
// research/43 + research/44's rider, all landing with the 39-CHASSIS cut-1
// reversal).
//
// 🔴 WHY EVERY ONE OF THESE IS A WIDGET/UNIT TEST AND NOT AN E2E LEG. The
// nightly suite creates its users through the SUPABASE ADMIN API, which
// bypasses email confirmation entirely — so a green e2e run says precisely
// nothing about whether an unverified session can reach the product. That is
// not a gap in the e2e suite's coverage; it is a property of how it makes
// users, and no amount of adding legs to it changes the answer. The rules below
// have to be asserted where the decision is actually taken, which is here.
//
// The four:
//   (a) an UNVERIFIED session cannot proceed — the router parks it on
//       /verify-email and nothing else is reachable.
//   (b) identity linking REFUSES on an unverified session — the takeover vector.
//   (c) the sign-up terms clickwrap arrives UNTICKED and BLOCKS.
//   (d) re-acceptance fires when either document version advances.
//   (e) the marketing opt-in arrives UNTICKED, does NOT block, and is its own
//       consent purpose.
//
// ⚠️ THE NEGATIVE HALF IS THE POINT OF EACH GROUP. A gate asserted only in its
// closed state passes just as well when it is closed on EVERYTHING, which is
// the fail-closed dead seam [pipeline C-6] exists to catch — so every gate here
// is driven in BOTH directions: the state that must be blocked, and the state
// that must be let through.
// ─────────────────────────────────────────────────────────────────────────────
import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_auth_supabase/nikatru_auth_supabase.dart'
    show InMemoryAuthRepository;
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:subly/core/e2e_keys.dart';
import 'package:subly/core/router.dart';
import 'package:subly/features/auth/legal_consent_fields.dart';
import 'package:subly/features/auth/reaccept_terms_screen.dart';
import 'package:subly/features/auth/sign_up_screen.dart';
import 'package:subly/features/auth/verify_email_screen.dart';
import 'package:subly/l10n/app_localizations.dart';
import 'package:subly/state/providers.dart';

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

/// A repository whose verification state the test chooses.
///
/// 🔴 `extends`, NOT `implements` — see the note on `core.AuthRepository`'s
/// verification members. The three of them carry honest default bodies and Dart
/// hands those on only through `extends`; a double written `implements` would
/// have to restate all three, which is how a test double ends up asserting
/// against stubs it wrote rather than against the contract.
class _Auth extends core.AuthRepository {
  _Auth({this.verified = true, this.signedIn = true});

  final bool verified;
  final bool signedIn;
  final StreamController<core.AuthUser?> changes =
      StreamController<core.AuthUser?>.broadcast();

  @override
  core.AuthUser? get currentUser => signedIn
      ? core.AuthUser(id: 'u1', email: 'a@b.test', emailVerified: verified)
      : null;

  @override
  Stream<core.AuthUser?> authStateChanges() => changes.stream;

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

ProviderContainer _container({
  required core.AuthRepository auth,
  bool? reacceptNeeded = false,
}) => ProviderContainer(
  overrides: <Override>[
    onboardingSeenProvider.overrideWith(_OnboardingSeen.new),
    authRepositoryProvider.overrideWithValue(auth),
    legalReacceptanceNeededProvider.overrideWithValue(reacceptNeeded),
    keyValueStoreProvider.overrideWith((ref) async => _MemStore()),
    analyticsConsentProvider.overrideWithValue(core.ConsentStatus.denied),
  ],
);

/// The SAME container with `legalReacceptanceNeededProvider` LEFT ALONE.
///
/// 🔴 THE OVERRIDE ABOVE IS WHY A WHOLE SUITE OF GREEN TESTS SAID NOTHING. Its
/// default is `false` — the one value the re-acceptance gate cannot be wrong
/// about — so every suite that used it (this file and eight others) drove the
/// router with the gate effectively switched off. A signed-out visitor on a
/// FRESH INSTALL sees `true`, because nobody has a clickwrap record yet, and
/// that arm sent the app into `/sign-in` → `/reaccept-terms` → `/sign-in` → …
/// until go_router gave up and rendered NotFoundScreen. Measured 2026-08-10.
///
/// Nothing here is stubbed below the router: the real provider hydrates through
/// the real `ConsentController` over an empty [_MemStore], which IS the
/// fresh-install shape. A gate this consequential needs at least one assertion
/// that no override can flatter.
ProviderContainer _realGateContainer({required core.AuthRepository auth}) =>
    ProviderContainer(
      overrides: <Override>[
        onboardingSeenProvider.overrideWith(_OnboardingSeen.new),
        authRepositoryProvider.overrideWithValue(auth),
        keyValueStoreProvider.overrideWith((ref) async => _MemStore()),
        analyticsConsentProvider.overrideWithValue(core.ConsentStatus.denied),
      ],
    );

/// Drive the REAL router to [location] and report where it SETTLED.
Future<String> _settleAt(
  WidgetTester tester,
  ProviderContainer c,
  String location,
) async {
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
  c.read(routerProvider).go(location);
  await tester.pumpAndSettle();
  return c.read(routerProvider).routerDelegate.currentConfiguration.uri.path;
}

Future<void> _pumpScreen(WidgetTester tester, Widget child) async {
  await tester.pumpWidget(
    ProviderScope(
      overrides: <Override>[
        keyValueStoreProvider.overrideWith((ref) async => _MemStore()),
      ],
      child: MaterialApp(
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: child,
      ),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  // ═══════════════════════════════════════════════════════════════════════════
  // (a) AN UNVERIFIED SESSION CANNOT PROCEED
  // ═══════════════════════════════════════════════════════════════════════════
  group('email verification is mandatory, and the client honours it', () {
    testWidgets('an UNVERIFIED user asking for /home lands on /verify-email', (
      WidgetTester tester,
    ) async {
      final ProviderContainer c = _container(auth: _Auth(verified: false));
      addTearDown(c.dispose);
      expect(
        await _settleAt(tester, c, '/home'),
        '/verify-email',
        reason:
            'the whole rule in one assertion: a session whose address nobody '
            'has proven must not reach the product, because email is the '
            'matching key the one-identity lock merges social sign-ins on',
      );
    });

    testWidgets('every other gated route is closed to them too', (
      WidgetTester tester,
    ) async {
      final ProviderContainer c = _container(auth: _Auth(verified: false));
      addTearDown(c.dispose);
      for (final String route in <String>[
        '/settings',
        '/budget',
        '/paywall',
        '/sub/42',
      ]) {
        expect(
          await _settleAt(tester, c, route),
          '/verify-email',
          reason:
              'a gate with one door left open is not a gate — $route must not '
              'be a way past it',
        );
      }
    });

    // 🔴 THE OPEN HALF. Without this the group passes just as well against a
    // router that sends EVERYONE to /verify-email, which is the fail-closed
    // dead seam this repository keeps rediscovering.
    testWidgets('a VERIFIED user reaches /home, and cannot open the gate', (
      WidgetTester tester,
    ) async {
      final ProviderContainer c = _container(auth: _Auth(verified: true));
      addTearDown(c.dispose);
      expect(await _settleAt(tester, c, '/home'), '/home');
      expect(
        await _settleAt(tester, c, '/verify-email'),
        '/home',
        reason:
            'a verified user typing the URL must not be shown "check your '
            'inbox" for something they already did',
      );
    });

    testWidgets(
      'a SIGNED-OUT visitor is not "unverified" — they are signed out',
      (WidgetTester tester) async {
        final ProviderContainer c = _container(auth: _Auth(signedIn: false));
        addTearDown(c.dispose);
        expect(
          await _settleAt(tester, c, '/home'),
          '/sign-in',
          reason:
              'null in, false out: sessionIsUnverified must not claim a visitor '
              'with no session at all, or the sign-in form becomes unreachable',
        );
      },
    );

    test('the predicate itself, in both directions', () {
      expect(core.sessionIsUnverified(null), isFalse);
      expect(
        core.sessionIsUnverified(
          const core.AuthUser(id: 'u', email: 'a@b.test'),
        ),
        isTrue,
        reason:
            'the DEFAULT is unverified — an implementation that forgets to map '
            'the field must fail closed, loudly, on the first sign-in',
      );
      expect(
        core.sessionIsUnverified(
          const core.AuthUser(id: 'u', email: 'a@b.test', emailVerified: true),
        ),
        isFalse,
      );
    });

    testWidgets('the screen offers a resend, and it REACHES the seam', (
      WidgetTester tester,
    ) async {
      final InMemoryAuthRepository auth = InMemoryAuthRepository(
        emailVerified: false,
      );
      addTearDown(auth.dispose);
      await auth.signInWithEmail(email: 'a@b.test', password: 'x');

      await tester.pumpWidget(
        ProviderScope(
          overrides: <Override>[
            authRepositoryProvider.overrideWithValue(auth),
            keyValueStoreProvider.overrideWith((ref) async => _MemStore()),
          ],
          child: MaterialApp(
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            supportedLocales: AppLocalizations.supportedLocales,
            home: const VerifyEmailScreen(),
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(auth.verificationResends, 0);
      await tester.tap(find.byKey(VerifyEmailScreen.resendButton));
      await tester.pumpAndSettle();
      expect(
        auth.verificationResends,
        1,
        reason:
            'the dead-button shape and the lying-button shape are different '
            'defects; this asserts the request ARRIVED, not that nothing threw',
      );
      expect(find.byKey(VerifyEmailScreen.statusLine), findsOneWidget);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // (b) VERIFIED-ONLY IDENTITY LINKING
  // ═══════════════════════════════════════════════════════════════════════════
  group('identity linking never merges an unverified address', () {
    test('the predicate refuses null and refuses unverified', () {
      expect(core.mayLinkIdentity(null), isFalse);
      expect(
        core.mayLinkIdentity(const core.AuthUser(id: 'u', email: 'a@b.test')),
        isFalse,
      );
      expect(
        core.mayLinkIdentity(
          const core.AuthUser(id: 'u', email: 'a@b.test', emailVerified: true),
        ),
        isTrue,
        reason:
            'the open half — a rule that refuses everything closes the feature '
            'rather than the hole',
      );
    });

    test('the repository REFUSES before it reaches any provider', () async {
      final InMemoryAuthRepository unverified = InMemoryAuthRepository(
        emailVerified: false,
      );
      addTearDown(unverified.dispose);
      await unverified.signInWithEmail(email: 'a@b.test', password: 'x');
      await expectLater(
        unverified.linkAppleIdentity(),
        throwsA(
          isA<core.AuthFailure>().having(
            (core.AuthFailure e) => e.message,
            'message',
            contains('Confirm your email'),
          ),
        ),
        reason:
            'register with someone else’s address, leave it unconfirmed, '
            'wait for them to arrive through the Apple door — this is the step '
            'that closes it',
      );

      // The VERIFIED session gets past that rule and fails for the honest
      // reason instead: there is no second provider configured here. Two
      // refusals with two messages, so the test can tell WHICH rule fired.
      final InMemoryAuthRepository verified = InMemoryAuthRepository();
      addTearDown(verified.dispose);
      await verified.signInWithEmail(email: 'a@b.test', password: 'x');
      await expectLater(
        verified.linkAppleIdentity(),
        throwsA(
          isA<core.AuthFailure>().having(
            (core.AuthFailure e) => e.message,
            'message',
            contains('identity provider'),
          ),
        ),
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // (c) + (e) THE SIGN-UP CLICKWRAP AND THE MARKETING OPT-IN
  // ═══════════════════════════════════════════════════════════════════════════
  group('the sign-up consents arrive unticked and behave differently', () {
    testWidgets('both boxes are UNTICKED on arrival', (
      WidgetTester tester,
    ) async {
      await _pumpScreen(tester, const SignUpScreen());
      expect(
        tester
            .widget<Checkbox>(find.byKey(LegalConsentFields.termsCheckbox))
            .value,
        isFalse,
        reason:
            'a pre-ticked clickwrap is not consent in any market this ships to '
            '(Planet49/EDPB, DPDP Rules 2025, CPRA)',
      );
      expect(
        tester
            .widget<Checkbox>(find.byKey(LegalConsentFields.marketingCheckbox))
            .value,
        isFalse,
        reason: 'research/44: express opt-in, DEFAULT OFF',
      );
    });

    testWidgets('the terms box BLOCKS the button; the marketing box does not', (
      WidgetTester tester,
    ) async {
      await _pumpScreen(tester, const SignUpScreen());
      final Finder submit = find.byKey(SignUpScreen.submitButton);

      expect(
        tester.widget<FilledButton>(submit).onPressed,
        isNull,
        reason: 'untouched terms box ⇒ no account can be created',
      );

      // Ticking MARKETING alone changes nothing — the whole point of the
      // distinction. If this ever passes the gate, an optional consent has
      // become a condition of the service (GDPR Art 7(4)).
      await tester.tap(find.byKey(LegalConsentFields.marketingCheckbox));
      await tester.pumpAndSettle();
      expect(
        tester.widget<FilledButton>(submit).onPressed,
        isNull,
        reason:
            'the marketing opt-in must NEVER gate sign-up — that is '
            'conditionality, declined as legally unavailable, not as taste',
      );

      // Ticking TERMS opens it.
      await tester.tap(find.byKey(LegalConsentFields.termsCheckbox));
      await tester.pumpAndSettle();
      expect(
        tester.widget<FilledButton>(submit).onPressed,
        isNotNull,
        reason:
            'the open half: a clickwrap that never opens is a sign-up screen '
            'that cannot sign anybody up',
      );
    });

    // 🔴 THE ORDERING, AND IT IS A LEGAL PROPERTY RATHER THAN A TIDINESS ONE.
    // The consent trail is APPEND-ONLY and every row carries `anon_id` and no
    // user id, so a row written for a registration that never completed can
    // never be reached by `DELETE /v1/account`, which is keyed by user id. It
    // is a permanent record of a consent nobody gave, for an account that does
    // not exist.
    //
    // ⚠️ AND IT IS ALSO A GATE BYPASS, which is the half that is easy to miss.
    // `accept()` sets the device stamp synchronously at its first line, so
    // recording before the call meant a FAILED sign-up opened the re-acceptance
    // gate — and the same person could then sign IN to a pre-clickwrap account
    // with the gate already satisfied by an acceptance for a sign-up that
    // threw.
    testWidgets('a FAILED sign-up records no acceptance and opens no gate', (
      WidgetTester tester,
    ) async {
      final _MemStore store = _MemStore();
      final _RecordingTransport transport = _RecordingTransport();
      final ProviderContainer c = ProviderContainer(
        overrides: <Override>[
          keyValueStoreProvider.overrideWith((ref) async => store),
          consentTransportProvider.overrideWithValue(transport),
          authRepositoryProvider.overrideWithValue(_RefusingAuth()),
          analyticsConsentProvider.overrideWithValue(core.ConsentStatus.denied),
        ],
      );
      addTearDown(c.dispose);

      await tester.pumpWidget(
        UncontrolledProviderScope(
          container: c,
          child: MaterialApp(
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            supportedLocales: AppLocalizations.supportedLocales,
            home: const SignUpScreen(),
          ),
        ),
      );
      await tester.pumpAndSettle();

      await tester.enterText(find.byType(TextField).at(0), 'a@b.test');
      await tester.enterText(find.byType(TextField).at(1), 'password123');
      await tester.tap(find.byKey(LegalConsentFields.termsCheckbox));
      await tester.tap(find.byKey(LegalConsentFields.marketingCheckbox));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(SignUpScreen.submitButton));
      await tester.pumpAndSettle();

      // The domain, asserted first: the sign-up really was attempted and
      // really did fail. Without this the two checks below would pass against
      // a form whose button never fired.
      expect(
        find.text('that address is already registered'),
        findsOneWidget,
        reason:
            'the refusal must have reached the screen, or this test is '
            'measuring a button that did nothing',
      );

      expect(
        transport.sent,
        isEmpty,
        reason:
            'an append-only, anon-id-keyed consent row for an account that '
            'was never created can never be erased by an account deletion',
      );
      expect(
        c.read(legalReacceptanceNeededProvider),
        isNot(isFalse),
        reason:
            'the device stamp must NOT have been set: a failed sign-up that '
            'opens the re-acceptance gate lets the same person sign IN to a '
            'pre-clickwrap account with the gate already satisfied',
      );
    });

    test(
      'marketing-email is its OWN consent purpose, never a limb of another',
      () {
        expect(core.ConsentPurpose.marketingEmail.value, 'marketing-email');
        expect(
          core.ConsentPurpose.marketingEmail.value,
          isNot(core.ConsentPurpose.analytics.value),
        );
        expect(
          core.ConsentPurpose.terms.value,
          isNot(core.ConsentPurpose.marketingEmail.value),
          reason:
              'the shipped signups KV is purpose-limited; folding the opt-in into '
              'the terms tick is exactly the repurposing the split forbids',
        );
      },
    );

    test(
      'acceptance records TWO artifacts, and the decline is recorded too',
      () async {
        final _MemStore store = _MemStore();
        final core.ConsentController controller = core.ConsentController(
          store: store,
        );
        final _RecordingTransport transport = _RecordingTransport();

        await applyLegalAcceptance(
          controller: controller,
          transport: transport,
          appId: 'subly',
          anonId: 'anon-1',
          marketingEmail: false,
        );

        expect(transport.sent.length, 2);
        expect(transport.sent[0].purpose, 'terms');
        expect(transport.sent[0].granted, isTrue);
        expect(transport.sent[1].purpose, 'marketing-email');
        expect(
          transport.sent[1].granted,
          isFalse,
          reason:
              'an ABSENT row proves nothing — it is also what "we never asked" '
              'looks like. The decline is the evidence the box existed.',
        );
        expect(
          transport.sent[0].policyVersion,
          kLegalVersions.stamp,
          reason:
              'the COMPOSITE stamp: a terms-only change has to be visible to the '
              're-acceptance check, and it cannot be if only the privacy version '
              'is written down',
        );
      },
    );

    test(
      'a surface that did not ask does not speak for the marketing decision',
      () async {
        final core.ConsentController controller = core.ConsentController(
          store: _MemStore(),
        );
        final _RecordingTransport transport = _RecordingTransport();

        await applyLegalAcceptance(
          controller: controller,
          transport: transport,
          appId: 'subly',
          anonId: 'anon-1',
          marketingEmail: null,
        );

        expect(
          transport.sent.map((core.ConsentArtifact a) => a.purpose),
          <String>['terms'],
          reason:
              'the re-acceptance interstitial shows no marketing box; writing '
              'granted:false from it would silently unsubscribe somebody for '
              'accepting a terms change',
        );
      },
    );
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // (d) MATERIAL-CHANGE RE-ACCEPTANCE
  // ═══════════════════════════════════════════════════════════════════════════
  group('re-acceptance fires when either document advances', () {
    test('the predicate compares the WHOLE stamp, and is not an ordering', () {
      const core.LegalVersions now = core.LegalVersions(
        terms: '2026-08-01',
        privacy: '2026-08-01',
      );
      expect(
        core.needsLegalReacceptance(acceptedStamp: now.stamp, current: now),
        isFalse,
      );
      expect(
        core.needsLegalReacceptance(acceptedStamp: null, current: now),
        isTrue,
        reason: 'never accepted ⇒ ask',
      );
      expect(
        core.needsLegalReacceptance(acceptedStamp: '', current: now),
        isTrue,
      );
      // A TERMS-ONLY move. This is the case that a privacy-version-only record
      // is blind to, and the reason the stamp is composite at all.
      expect(
        core.needsLegalReacceptance(
          acceptedStamp: const core.LegalVersions(
            terms: '2026-07-01',
            privacy: '2026-08-01',
          ).stamp,
          current: now,
        ),
        isTrue,
      );
      // A PRIVACY-ONLY move.
      expect(
        core.needsLegalReacceptance(
          acceptedStamp: const core.LegalVersions(
            terms: '2026-08-01',
            privacy: '2026-07-01',
          ).stamp,
          current: now,
        ),
        isTrue,
      );
      // An UNPARSEABLE stamp asks again rather than silently answering "no
      // change". Failing open here means showing somebody a product under terms
      // they never saw.
      expect(
        core.needsLegalReacceptance(acceptedStamp: 'garbage', current: now),
        isTrue,
      );
    });

    testWidgets('a user who has not accepted is parked on /reaccept-terms', (
      WidgetTester tester,
    ) async {
      final ProviderContainer c = _container(
        auth: _Auth(verified: true),
        reacceptNeeded: true,
      );
      addTearDown(c.dispose);
      expect(await _settleAt(tester, c, '/home'), '/reaccept-terms');
      expect(await _settleAt(tester, c, '/settings'), '/reaccept-terms');
    });

    testWidgets('an accepted user cannot open the interstitial by URL', (
      WidgetTester tester,
    ) async {
      final ProviderContainer c = _container(auth: _Auth(verified: true));
      addTearDown(c.dispose);
      expect(await _settleAt(tester, c, '/reaccept-terms'), '/home');
    });

    // 🔴 ORDERING. Verification is decided BEFORE re-acceptance, and reversing
    // the two would take a legal acceptance from an identity nobody has proven.
    testWidgets(
      'an UNVERIFIED user who also owes acceptance sees /verify-email first',
      (WidgetTester tester) async {
        final ProviderContainer c = _container(
          auth: _Auth(verified: false),
          reacceptNeeded: true,
        );
        addTearDown(c.dispose);
        expect(await _settleAt(tester, c, '/home'), '/verify-email');
      },
    );

    // While the acceptance is still being read from disk the router must
    // DECLINE TO DECIDE. Answering "not accepted" here flashes the interstitial
    // at every launch for a user who accepted months ago — the defect
    // OnboardingSeenController's three states were introduced to fix.
    testWidgets('a null (still hydrating) answer does not redirect', (
      WidgetTester tester,
    ) async {
      final ProviderContainer c = _container(
        auth: _Auth(verified: true),
        reacceptNeeded: null,
      );
      addTearDown(c.dispose);
      expect(await _settleAt(tester, c, '/home'), '/home');
    });

    testWidgets('the interstitial arrives UNTICKED and its button is dead', (
      WidgetTester tester,
    ) async {
      await _pumpScreen(tester, const ReacceptTermsScreen());
      expect(
        tester
            .widget<Checkbox>(find.byKey(LegalConsentFields.termsCheckbox))
            .value,
        isFalse,
        reason:
            'carrying the previous acceptance forward as a pre-ticked box makes '
            'the acceptance a re-render of a decision taken against a document '
            'that no longer exists',
      );
      expect(
        tester
            .widget<FilledButton>(find.byKey(ReacceptTermsScreen.acceptButton))
            .onPressed,
        isNull,
      );
      expect(
        find.byKey(LegalConsentFields.marketingCheckbox),
        findsNothing,
        reason:
            'asking for a marketing opt-in on a screen the user cannot leave is '
            'the conditionality research/43 declined',
      );

      await tester.tap(find.byKey(LegalConsentFields.termsCheckbox));
      await tester.pumpAndSettle();
      expect(
        tester
            .widget<FilledButton>(find.byKey(ReacceptTermsScreen.acceptButton))
            .onPressed,
        isNotNull,
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // (f) A SIGNED-OUT VISITOR CAN STILL REACH THE SIGN-IN FORM WHEN AN
  //     ACCEPTANCE IS OWED — which is EVERY install, because nobody holds a
  //     clickwrap record yet, and every install again after a version bump.
  //
  // 🔴 THIS GROUP EXISTS BECAUSE THE GATE SHIPPED WITHOUT A `loggedIn`
  // CONDITION AND MADE THE APP IMPOSSIBLE TO SIGN INTO. Measured on the real
  // router with the real provider (2026-08-10): asking for `/sign-in` settled
  // at `/reaccept-terms` with `"Page not found" ×1` and `"Welcome" ×0` — the
  // signed-out rule and the re-acceptance gate each sent the user to the
  // other's screen until go_router hit its redirect limit and the errorBuilder
  // took over.
  //
  // ⚠️ EVERY OTHER GATE TEST IN THIS FILE OVERRIDES `reacceptNeeded` TO
  // `false`, which is the single value that cannot reproduce it. So the first
  // test below uses no override at all, and the rest drive the arm the
  // production value actually takes.
  // ═══════════════════════════════════════════════════════════════════════════
  group('an owed acceptance never blocks the way IN', () {
    testWidgets('THE FRESH-INSTALL SHAPE, real provider, nothing overridden', (
      WidgetTester tester,
    ) async {
      final ProviderContainer c = _realGateContainer(
        auth: _Auth(signedIn: false),
      );
      addTearDown(c.dispose);
      final String where = await _settleAt(tester, c, '/sign-in');

      // ⚠️ THE PREMISE, ASSERTED RATHER THAN ASSUMED. Empty store ⇒ no
      // acceptance on record ⇒ the real provider must answer `true`. If it ever
      // answers `false` this test passes while proving nothing — which is
      // precisely how the `overrideWithValue(false)` default fooled the rest of
      // the file. (It is read AFTER the pump because hydration is async and the
      // three-state provider correctly reads `null` until the store lands.)
      expect(
        c.read(legalReacceptanceNeededProvider),
        isTrue,
        reason:
            'a fresh install owes an acceptance; without this line the '
            'assertion below is a tautology',
      );

      expect(
        where,
        '/sign-in',
        reason:
            'a person with no session cannot owe an acceptance — there is '
            'nobody to have accepted — and sending them to the interstitial '
            'costs them the only screen that could give them a session',
      );
      expect(
        find.byKey(E2EKeys.loginSubmit),
        findsOneWidget,
        reason:
            'settling on the right PATH is not the assertion: the loop ended '
            'on NotFoundScreen while the location still read /reaccept-terms, '
            'so the form itself has to be found',
      );
    });

    testWidgets('every signed-out entry point still terminates on the form', (
      WidgetTester tester,
    ) async {
      final ProviderContainer c = _container(
        auth: _Auth(signedIn: false),
        reacceptNeeded: true,
      );
      addTearDown(c.dispose);
      for (final String route in <String>[
        '/home',
        '/settings',
        '/sign-in',
        '/reaccept-terms',
      ]) {
        expect(
          await _settleAt(tester, c, route),
          '/sign-in',
          reason:
              '$route must reach the form, not a redirect loop — including '
              '/reaccept-terms itself, which a signed-out visitor can type',
        );
      }
      expect(find.byKey(E2EKeys.loginSubmit), findsOneWidget);
    });

    testWidgets('/sign-up stays reachable with an acceptance owed', (
      WidgetTester tester,
    ) async {
      final ProviderContainer c = _container(
        auth: _Auth(signedIn: false),
        reacceptNeeded: true,
      );
      addTearDown(c.dispose);
      expect(
        await _settleAt(tester, c, '/sign-up'),
        '/sign-up',
        reason:
            'the registration form is where the acceptance is TAKEN; gating it '
            'behind having already accepted is the loop in its purest form',
      );
    });

    // ═════════════════════════════════════════════════════════════════════════
    // THE ACCEPTANCE BELONGS TO A PERSON, NOT TO A HANDSET.
    //
    // 🔴 THE SHARED-DEVICE HOLE. The record lives in the device's consent store
    // and the router's comment calls it "whether the signed-in USER must be
    // shown" the interstitial. Those were two different claims: A accepts → A
    // signs out → B signs in to a pre-clickwrap account → the gate compared A's
    // stamp, answered "nothing owed", and B was inside the product having
    // agreed to nothing — with a record on file saying somebody had. A family
    // tablet is not an exotic case.
    // ═════════════════════════════════════════════════════════════════════════
    test('a session ending retires the acceptance on this device', () async {
      final _MemStore store = _MemStore();
      final _RecordingTransport transport = _RecordingTransport();
      final _SwitchableAuth auth = _SwitchableAuth();

      ProviderContainer coldStart() => ProviderContainer(
        overrides: <Override>[
          keyValueStoreProvider.overrideWith((ref) async => store),
          consentTransportProvider.overrideWithValue(transport),
          authRepositoryProvider.overrideWithValue(auth),
          analyticsConsentProvider.overrideWithValue(core.ConsentStatus.denied),
        ],
      );

      // ── A accepts ──────────────────────────────────────────────────────────
      auth.userId = 'user-A';
      final ProviderContainer a = coldStart();
      addTearDown(a.dispose);
      await a
          .read(legalAcceptanceProvider.notifier)
          .accept(marketingEmail: false);
      expect(
        a.read(legalReacceptanceNeededProvider),
        isFalse,
        reason: 'A accepted, so A owes nothing — the open half of this rule',
      );

      // ── A signs out ────────────────────────────────────────────────────────
      // Driven through the SEAM, not by poking the marker: the whole mechanism
      // is that a session ending is what retires the acceptance, and a test
      // that writes the flag itself would assert its own arm.
      auth.signOut();
      await Future<void>.delayed(Duration.zero);
      await Future<void>.delayed(Duration.zero);

      // ── B arrives on the SAME device, cold ─────────────────────────────────
      auth.userId = 'user-B';
      final ProviderContainer b = coldStart();
      addTearDown(b.dispose);
      b.read(legalAcceptanceProvider);
      await b.read(consentControllerProvider.future);
      await Future<void>.delayed(Duration.zero);
      await Future<void>.delayed(Duration.zero);

      expect(
        b.read(legalReacceptanceNeededProvider),
        isTrue,
        reason:
            "B never accepted anything. Answering with A's stamp puts B inside "
            'the product under terms B was never shown, and leaves a record '
            'claiming otherwise',
      );

      // 🔴 AND NOTHING IDENTIFYING WAS STORED TO ACHIEVE IT. [ADR 020] forbids
      // a paid identifier beside a pseudonymous one, and the first version of
      // this fix kept the accepting user's id in this very store next to the
      // anon-keyed consent artifact — `assert-pseudonymity-firewall.mjs` failed
      // the build on it, in both trees. This assertion is what stops it coming
      // back through a "small" convenience edit.
      expect(
        store.data.values.where((String v) => v.contains('user-A')),
        isEmpty,
        reason:
            'no user id may be persisted beside the anon-keyed consent record',
      );
      expect(
        store.data.values.where((String v) => v.contains('user-B')),
        isEmpty,
      );
    });

    // 🔴 THE OPEN HALF. Without it this group passes just as well against a
    // router whose re-acceptance gate never fires at all — the fail-closed dead
    // seam inverted, and the failure mode that would silently drop the whole
    // research/43 rider.
    testWidgets('but a SIGNED-IN user on the same fresh store IS gated', (
      WidgetTester tester,
    ) async {
      final ProviderContainer c = _realGateContainer(auth: _Auth());
      addTearDown(c.dispose);
      final String where = await _settleAt(tester, c, '/home');
      expect(
        c.read(legalReacceptanceNeededProvider),
        isTrue,
        reason: 'same premise as the signed-out case, same empty store',
      );
      expect(
        where,
        '/reaccept-terms',
        reason:
            'the fix conditions the gate on there being a session — it must '
            'not have switched the gate off',
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // THE GATE MUST GIVE THE DESTINATION BACK, AND MUST NOT CRASH TAKING IT.
  //
  // 🔴 WHY THIS GROUP EXISTS. The nightly e2e went red on 2026-08-11 because a
  // gate ATE the destination: `LoginScreen._submit` ends on `context.go('/scan')`,
  // the re-acceptance gate intercepted it, and its exit line handed the user to
  // `/home` — so ScanScreen, the only renderer of `l10n.goToDashboard`, never
  // mounted. Nothing in this file caught it, because every case here asserted
  // arrival AT an interstitial and none asserted the destination AFTER one.
  // A gate is two halves and only one of them was tested.
  // ═══════════════════════════════════════════════════════════════════════════
  group('a satisfied gate returns the user to where they were going', () {
    testWidgets('a banked ?next= is honoured, not replaced by /home', (
      WidgetTester tester,
    ) async {
      final ProviderContainer c = _container(auth: _Auth(verified: true));
      addTearDown(c.dispose);
      expect(
        await _settleAt(tester, c, '/reaccept-terms?next=%2Fscan'),
        '/scan',
        reason:
            'the regression verbatim: a user sent to the gate from /scan and '
            'handed back to /home has lost the journey they were on, and the '
            'nightly proves it end to end',
      );
    });

    testWidgets('with NO next, the fallback still applies', (
      WidgetTester tester,
    ) async {
      final ProviderContainer c = _container(auth: _Auth(verified: true));
      addTearDown(c.dispose);
      expect(
        await _settleAt(tester, c, '/reaccept-terms'),
        '/home',
        reason:
            'the old behaviour is the FALLBACK, not the bug — removing it '
            'would strand anyone who reached the gate directly',
      );
    });

    // 🔴 THE CRASH THE FIRST DRAFT OF THIS FIX WOULD HAVE SHIPPED. `next` rides
    // in a public URL, and `Uri.queryParameters` DECODES THE WHOLE QUERY: an
    // escape that is well-formed hex but not well-formed UTF-8 raises
    // FormatException on read, not on parse. The read runs for every signed-in
    // user who does NOT owe the gate — the common path — so one typed or mailed
    // link would take the app down for everyone who followed it. Measured
    // against the real SDK before `_bankedNext` existed; these cases are the
    // reason it does.
    testWidgets('a malformed ?next= cannot crash the redirect', (
      WidgetTester tester,
    ) async {
      final ProviderContainer c = _container(auth: _Auth(verified: true));
      addTearDown(c.dispose);
      for (final String poison in <String>[
        '/reaccept-terms?next=%FF',
        '/reaccept-terms?next=%E0%A4%A',
        // The nastiest shape: the poison is not even in `next`.
        '/reaccept-terms?a=%ED%A0%80&next=%2Fscan',
      ]) {
        expect(
          await _settleAt(tester, c, poison),
          '/home',
          reason:
              'an undecodable query must degrade to the fallback, never throw '
              '— a redirect that throws takes the whole app down, and $poison '
              'is something a stranger can put in a link',
        );
      }
    });

    // The other direction: a `next` must not become an open redirect or a way
    // to re-open the gate that was just cleared.
    testWidgets('a hostile ?next= is refused, and lands on the fallback', (
      WidgetTester tester,
    ) async {
      final ProviderContainer c = _container(auth: _Auth(verified: true));
      addTearDown(c.dispose);
      for (final String hostile in <String>[
        // Protocol-relative: a browser resolves this OFF-ORIGIN.
        '/reaccept-terms?next=%2F%2Fevil.test',
        '/reaccept-terms?next=https%3A%2F%2Fevil.test',
        // Re-opening a gate the user has just satisfied.
        '/reaccept-terms?next=%2Freaccept-terms',
        '/reaccept-terms?next=%2Fverify-email%3Fx%3D1',
      ]) {
        expect(
          await _settleAt(tester, c, hostile),
          '/home',
          reason:
              '`next` is attacker-controlled input on web; $hostile must not '
              'be honoured',
        );
      }
    });
  });
}

/// A repository whose signed-in identity the test can change between
/// containers — the shared-device case, where the handset stays the same and
/// the person does not.
class _SwitchableAuth extends core.AuthRepository {
  String? userId;
  final StreamController<core.AuthUser?> changes =
      StreamController<core.AuthUser?>.broadcast();

  @override
  core.AuthUser? get currentUser => userId == null
      ? null
      : core.AuthUser(
          id: userId!,
          email: '$userId@b.test',
          emailVerified: true,
        );

  @override
  Stream<core.AuthUser?> authStateChanges() async* {
    yield currentUser;
    yield* changes.stream;
  }

  /// The REAL seam the controller listens through, so the sign-out limb is
  /// DRIVEN rather than simulated. A test that wrote the re-ask marker itself
  /// would be asserting its own arm.
  @override
  Future<void> signOut() async {
    userId = null;
    changes.add(null);
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

/// A repository whose `signUpWithEmail` always REFUSES — the realistic failure
/// (the address is already registered), which is also the one a user is most
/// likely to meet.
class _RefusingAuth extends core.AuthRepository {
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
  }) async => throw core.AuthFailure('that address is already registered');

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

/// Captures what would have gone to the append-only server record.
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
