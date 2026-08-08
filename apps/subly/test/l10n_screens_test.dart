// ─────────────────────────────────────────────────────────────────────────────
// P4·L6 — THE THREE SCREENS A USER MEETS BEFORE THE APP: the routed onboarding
// carousel, the analytics-consent dialog, and login.
//
// 🔴 EVERY CASE RUNS IN EN *AND* TA, AND THE ENGLISH HALF ALONE WOULD BE
// TAUTOLOGICAL. Almost every value here is byte-identical to the literal it
// replaces — that is the whole reason the pinning tests elsewhere needed no
// edits — so an implementation that never touched the arb would pass an
// English-only suite. Tamil is what makes these assertions able to fail, and
// each Tamil case also asserts the pre-l10n English literal `findsNothing`.
//
// The file additionally pins four COPY DECISIONS as arb-value assertions. A
// decision recorded only in a work order is a decision the next edit does not
// know about:
//
//   1. `sublyOnboarding1Title` carries NO `\n` (WORKORDER §1). The Dart literal
//      it replaced did, and the hard break was placed for one English phrase.
//   2. `sublyOnboarding*` is a NEW family, not an overwrite of the chassis
//      `onboarding1Title` — those are the stamped first run every app inherits.
//   3. `consentPrivacyLive` is NOT `consentPrivacy` (WORKORDER §8 decision 2).
//      The live dialog promises "You can change this any time in Settings.";
//      the older arb value does not. Users consented under the live sentence.
//   4. `passwordTooShort` says 8, not 6 (WORKORDER §8 decision 3) — and
//      `resetSent` no longer leaks "(demo)" to a user.
// ─────────────────────────────────────────────────────────────────────────────
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:subly/core/app_config.dart';
import 'package:subly/core/e2e_keys.dart';
import 'package:subly/features/auth/login_screen.dart';
import 'package:subly/features/consent/consent_prompt.dart';
import 'package:subly/features/onboarding/onboarding_screen.dart';
import 'package:subly/l10n/app_localizations.dart';
// `analytics_providers.dart` re-exports `providers.dart`, so importing both is
// an `unnecessary_import` info — `keyValueStoreProvider` comes through here too.
import 'package:subly/state/analytics_providers.dart';

import 'support/width_harness.dart' show MemStore;

/// Hosts [screen] under the real delegates in [locale].
///
/// `l10n.yaml` sets `nullable-getter: false`, so a host WITHOUT these delegates
/// does not degrade to English — it throws on the first frame. That is the
/// intended shape (a screen silently rendering the wrong language is worse), and
/// it is why every host in this suite carries them.
Future<void> _pump(WidgetTester tester, Locale locale, Widget screen) async {
  // ⚠️ THE SURFACE IS PINNED TALL, AND IT IS NOT COSMETIC. flutter_test's
  // default is 800×600; the login column is ~712 px tall, so the sign-in /
  // sign-up toggle at the bottom sits OFF the render tree. A `find.text` still
  // matches it (finders read the widget tree, not the screen), but `tap()`
  // derives an offset outside the view and silently hits nothing — which
  // presents as the NEXT assertion failing, not as a failed tap.
  await tester.binding.setSurfaceSize(const Size(400, 1400));
  addTearDown(() => tester.binding.setSurfaceSize(null));
  await tester.pumpWidget(
    ProviderScope(
      overrides: <Override>[
        keyValueStoreProvider.overrideWith((_) async => MemStore()),
      ],
      child: MaterialApp(
        locale: locale,
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: screen,
      ),
    ),
  );
  for (int i = 0; i < 12; i++) {
    await tester.pump();
  }
}

/// Mounts [ConsentGate] over a trivial app so the real dialog opens.
///
/// Under `home:` rather than through a router: the gate falls back to its own
/// context when [rootNavigatorKey] is unattached, and `MaterialApp` has already
/// put a Navigator above `home`. The router-shaped mount — the one that proves
/// the dialog is REACHABLE in production wiring — is
/// `consent_gate_open_path_test.dart`'s job and stays there; this file is about
/// the words on it.
Future<void> _pumpConsent(WidgetTester tester, Locale locale) async {
  await tester.pumpWidget(
    ProviderScope(
      overrides: <Override>[
        backendLiveProvider.overrideWithValue(true),
        keyValueStoreProvider.overrideWith((_) async => MemStore()),
      ],
      child: MaterialApp(
        locale: locale,
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: const ConsentGate(child: Scaffold(body: Text('HOME'))),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

Future<AppLocalizations> _load(String code) =>
    AppLocalizations.delegate.load(Locale(code));

void main() {
  // ───────────────────────────────────────────────────────────────────────────
  group('the routed onboarding carousel speaks both locales', () {
    for (final String code in <String>['en', 'ta']) {
      testWidgets('[$code] the first slide and the two controls', (
        WidgetTester tester,
      ) async {
        final AppLocalizations l10n = await _load(code);
        await _pump(tester, Locale(code), const OnboardingScreen());

        expect(find.text(l10n.sublyOnboarding1Title), findsOneWidget);
        expect(find.text(l10n.sublyOnboarding1Body), findsOneWidget);
        expect(find.text(l10n.onboardingSkip), findsOneWidget);
        expect(
          find.text(l10n.onboardingNext),
          findsOneWidget,
          reason:
              'page 1 of 3 shows Next; onboardingStart belongs to the last page',
        );
      });
    }

    testWidgets('[ta] the pre-l10n English literals are GONE', (
      WidgetTester tester,
    ) async {
      await _pump(tester, const Locale('ta'), const OnboardingScreen());

      // THE FALSIFIER. Both spellings: the literal as it was written before
      // this increment (with the hard break) and the arb's English value, so
      // this stays meaningful whichever way a regression reintroduces English.
      expect(
        find.text('Every subscription,\none clean board'),
        findsNothing,
        reason: 'the pre-l10n Dart literal survived into a Tamil build',
      );
      expect(find.text('Every subscription, one clean board'), findsNothing);
      expect(find.text('Skip'), findsNothing);
      expect(find.text('Next'), findsNothing);
    });

    test('the copy decisions this family encodes', () async {
      final AppLocalizations en = await _load('en');
      final AppLocalizations ta = await _load('ta');

      // DECISION 1 — no hard line break. It read
      // 'Every subscription,\none clean board' as a Dart literal; a break
      // positioned for one English phrase lands mid-clause in a translation of
      // a different length, and at text scale 2.0 it fights the wrap the layout
      // already does correctly.
      for (final String s in <String>[
        en.sublyOnboarding1Title,
        en.sublyOnboarding2Title,
        en.sublyOnboarding3Title,
        ta.sublyOnboarding1Title,
      ]) {
        expect(
          s,
          isNot(contains('\n')),
          reason: 'a hard break is back in a slide title: "$s"',
        );
      }

      // DECISION 2 — a NEW family, not an overwrite. `onboarding1Title` is the
      // chassis key every stamped app's first run renders
      // (features/firstrun/onboarding_screen.dart). Had Subly's pitch been
      // written into it, every app the factory produces would introduce itself
      // with Subly's words.
      expect(en.onboarding1Title, 'Welcome');
      expect(en.sublyOnboarding1Title, isNot(en.onboarding1Title));
      expect(ta.sublyOnboarding1Title, isNot(ta.onboarding1Title));
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  group('the consent dialog speaks both locales', () {
    for (final String code in <String>['en', 'ta']) {
      testWidgets('[$code] title, body, privacy line, link and both buttons', (
        WidgetTester tester,
      ) async {
        final AppLocalizations l10n = await _load(code);
        await _pumpConsent(tester, Locale(code));

        expect(find.byType(AlertDialog), findsOneWidget);
        expect(find.text(l10n.consentTitle(AppConfig.appName)), findsOneWidget);
        expect(find.text(l10n.consentBody), findsOneWidget);
        expect(find.text(l10n.consentReadPolicy), findsOneWidget);
        expect(find.text(l10n.consentAllow), findsOneWidget);
        expect(find.text(l10n.consentDecline), findsOneWidget);

        // 🔴 THE KEY THIS INCREMENT MINTED, AND THE ONE IT MUST NOT USE.
        // Swapping `consentPrivacyLive` for `consentPrivacy` in
        // consent_prompt.dart turns BOTH of these red — the first because the
        // live sentence stopped appearing, the second because the shorter one
        // started. Without the second, a swap would only be caught in the
        // locale whose two values happen to differ visibly.
        expect(
          find.text(l10n.consentPrivacyLive),
          findsOneWidget,
          reason:
              'the dialog must show the sentence users actually consented '
              'under, including the promise that Settings can change it',
        );
        expect(
          find.text(l10n.consentPrivacy),
          findsNothing,
          reason:
              "the arb's older, SHORTER privacy line reached the dialog — it "
              'drops "You can change this any time in Settings." and silently '
              'retracts a promise the shipped copy makes',
        );
      });
    }

    testWidgets('[ta] the pre-l10n English literals are GONE', (
      WidgetTester tester,
    ) async {
      await _pumpConsent(tester, const Locale('ta'));
      expect(find.text('Help improve ${AppConfig.appName}?'), findsNothing);
      expect(find.text('Read the privacy policy'), findsNothing);
      expect(find.text('Allow'), findsNothing);
      expect(find.text('No thanks'), findsNothing);
    });

    test('consentPrivacyLive and consentPrivacy are DIFFERENT texts', () async {
      for (final String code in <String>['en', 'ta']) {
        final AppLocalizations l10n = await _load(code);
        expect(
          l10n.consentPrivacyLive,
          isNot(l10n.consentPrivacy),
          reason:
              'in [$code] the two keys collapsed to one value, which makes the '
              'assertions above unable to tell them apart — the mint (WORKORDER '
              '§8 decision 2) was pointless and the swap it guards against '
              'would ship green',
        );
      }
      // English states the difference concretely, so a reader does not have to
      // diff two long sentences to see what the mint was for.
      final AppLocalizations en = await _load('en');
      expect(en.consentPrivacyLive, contains('any time in Settings'));
      expect(en.consentPrivacy, isNot(contains('Settings')));
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  group('login speaks both locales', () {
    for (final String code in <String>['en', 'ta']) {
      testWidgets('[$code] the sign-in face of the screen', (
        WidgetTester tester,
      ) async {
        final AppLocalizations l10n = await _load(code);
        await _pump(tester, Locale(code), const LoginScreen());

        expect(find.text(l10n.welcomeBack), findsOneWidget);
        expect(find.text(l10n.signInSubtitle), findsOneWidget);
        expect(find.text(l10n.email.toUpperCase()), findsOneWidget);
        expect(find.text(l10n.password.toUpperCase()), findsOneWidget);
        expect(find.text(l10n.forgotPasswordShort), findsOneWidget);
        expect(find.text(l10n.orDivider), findsOneWidget);
        expect(find.text(l10n.continueWithApple), findsOneWidget);
        expect(find.text(l10n.signIn), findsOneWidget);
        // ONE key, one whole sentence — not a lead-in span plus a link span.
        expect(find.text(l10n.newHerePrompt), findsOneWidget);
      });

      testWidgets('[$code] the toggle shows the sign-up face', (
        WidgetTester tester,
      ) async {
        final AppLocalizations l10n = await _load(code);
        await _pump(tester, Locale(code), const LoginScreen());

        await tester.tap(find.text(l10n.newHerePrompt));
        await tester.pump();

        // TWO, not one, and the number is explained by the line under it:
        // `signUpTitle` (the heading) and `signUp` (the submit button) are
        // separate keys carrying identical words, so both render the same
        // string. Asserting `findsOneWidget` here would be asserting that one
        // of the two controls had gone missing.
        expect(l10n.signUpTitle, l10n.signUp);
        expect(find.text(l10n.signUpTitle), findsNWidgets(2));
        expect(find.text(l10n.signUpSubtitle), findsOneWidget);
        expect(find.text(l10n.haveAccountPrompt), findsOneWidget);
        expect(
          find.text(l10n.welcomeBack),
          findsNothing,
          reason: 'the sign-in heading survived the toggle',
        );
        expect(
          find.text(l10n.forgotPasswordShort),
          findsNothing,
          reason: 'the reset link belongs to the sign-in face only',
        );
      });

      // The ERROR path, localized. Everything above is static copy; this drives
      // the screen into a failure and reads what the user is told — the branch
      // that used to hold eight hardcoded English sentences in
      // `_friendlyMessage`. The empty-field case is the one reachable without
      // an auth backend: `_submit` returns before it touches the repository.
      testWidgets('[$code] the empty-field error comes from the arb', (
        WidgetTester tester,
      ) async {
        final AppLocalizations l10n = await _load(code);
        await _pump(tester, Locale(code), const LoginScreen());

        await tester.tap(find.byKey(E2EKeys.loginSubmit));
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 100));

        expect(find.text(l10n.authEnterBoth), findsOneWidget);
      });
    }

    testWidgets('[ta] the pre-l10n English literals are GONE', (
      WidgetTester tester,
    ) async {
      await _pump(tester, const Locale('ta'), const LoginScreen());
      expect(
        find.text('Welcome back'),
        findsNothing,
        reason:
            'integration_test/app_test.dart pins this string SIX times — in '
            'English, which is the locale it runs in. It must not survive a '
            'Tamil build.',
      );
      expect(find.text('Sign in to keep your money in check.'), findsNothing);
      expect(find.text('Forgot password?'), findsNothing);
      expect(find.text('or'), findsNothing);
      expect(find.text('  Continue with Apple'), findsNothing);
      expect(find.text('EMAIL'), findsNothing);
      expect(find.text('PASSWORD'), findsNothing);
    });

    test('the copy decisions this screen encodes', () async {
      final AppLocalizations en = await _load('en');
      final AppLocalizations ta = await _load('ta');

      // DECISION 3 (WORKORDER §8.3) — the friendly weak-password message now
      // reuses the key sign-up already shows. The literal it replaced said
      // "Password must be at least 6 characters."; the 6 was GoTrue's server
      // default leaking into our words while the app enforces 8.
      expect(en.passwordTooShort, 'Use at least 8 characters.');
      expect(
        en.passwordTooShort,
        isNot(contains('6')),
        reason: 'the server default leaked back into the user-facing copy',
      );

      // The "(demo)" leak. The literal was 'Password reset sent (demo).' — a
      // build-mode detail shown to a user, and a claim the app cannot make: it
      // does not know whether that address has an account, and answering either
      // way is an account-enumeration oracle.
      expect(en.resetSent, isNot(contains('demo')));
      expect(en.resetSent, contains('If that address has an account'));

      // The two-space gutter. '  Continue with Apple' was centred inside
      // SoftButton, so the spaces were a ~4 px optical nudge left over from a
      // design with a glyph. Leading whitespace in an arb value is invisible in
      // review and is the first thing a translator drops, so it would render
      // differently per locale for no stated reason.
      for (final String s in <String>[
        en.continueWithApple,
        ta.continueWithApple,
      ]) {
        expect(s, s.trim(), reason: 'padding whitespace is back in the value');
      }

      // The field labels are upper-cased BY THE LAYOUT. Tamil has no case, so
      // `toUpperCase()` is a no-op there — which is the correct rendering, and
      // would have been frozen wrong had the capitals been written into the
      // value the way 'EMAIL' was written into the Dart.
      expect(en.email.toUpperCase(), 'EMAIL');
      expect(en.password.toUpperCase(), 'PASSWORD');
      expect(
        ta.email.toUpperCase(),
        ta.email,
        reason:
            'Tamil script has no upper case; a shouting arb value would have '
            'been a mistranslation nothing could correct at the call site',
      );
    });
  });
}
