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
//   3. `consentPrivacy` CARRIES THE PROMISE — "You can change this any time in
//      Settings." (owner decision 2026-08-09, decisions-log.md; it supersedes
//      WORKORDER §8 decision 2, which parked the choice between two keys).
//      The reconciliation collapsed the pair onto the one chassis key, so the
//      sentence of record is now the only sentence there is, in the app and in
//      the brick alike.
//   4. `passwordTooShort` says 8, not 6 (WORKORDER §8 decision 3) — and
//      `resetSent` no longer leaks "(demo)" to a user.
// ─────────────────────────────────────────────────────────────────────────────
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:subly/app.dart';
import 'package:subly/core/app_config.dart';
import 'package:subly/core/e2e_keys.dart';
import 'package:subly/features/auth/login_screen.dart';
import 'package:subly/features/onboarding/onboarding_screen.dart';
import 'package:subly/l10n/app_localizations.dart';
// `providers.dart` is the spine, and it RE-EXPORTS the analytics half by name
// (`keyValueStoreProvider`, `analyticsEnabledProvider`, `consentTransportProvider`
// are all on that list), so this one import reaches every seam overridden below
// AND `localeProvider`, which lives only here. Importing `analytics_providers.dart`
// as well would be an `unnecessary_import` info.
import 'package:subly/state/providers.dart';

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

/// Mounts the REAL app root so the REAL consent prompt renders in [locale].
///
/// 🔴 THIS USED TO MOUNT `ConsentGate`, A WIDGET THE APP NEVER SHOWED — and
/// that is the whole reason this helper is written out at length. The prompt
/// Subly mounts is the inline scrim `_ConsentPrompt`, stacked over the router by
/// `AnalyticsGate` in `app.dart`; the dialog-shaped `ConsentGate` lost its last
/// mount in the P2.6 chassis merge and was deleted 2026-08-10. A copy test
/// pointed at an unmounted widget passes forever while the words a user actually
/// reads say something else, which is the same false-green as a fail-closed seam
/// with no open path. So: the app root, its own `localeProvider`, its own gate.
///
/// The three overrides are the minimum that makes the prompt exist:
///  · the store, because `PrefsKeyValueStore` needs a platform channel a widget
///    test has not got — and an EMPTY store is what "never answered" means;
///  · `analyticsEnabledProvider`, because it reads the compile-time
///    `AppConfig.isBackendLive`, so without the override the gate renders
///    nothing at all and every assertion below would pass over an empty tree;
///  · a discarding consent transport, so nothing here can reach the network.
Future<void> _pumpConsent(WidgetTester tester, Locale locale) async {
  // 🔴 NO SURFACE PIN, AND THE REMOVAL IS THE POINT. This helper shipped with
  // `setSurfaceSize(const Size(600, 1200))` and a comment claiming flutter_test's
  // 800×600 default "leaves it no room once the privacy sentence wraps, and a
  // RenderFlex overflow fails the case". THAT WAS NEVER MEASURED AND IT DOES NOT
  // REPRODUCE: at the plain 800×600 default the real prompt renders clean in
  // BOTH locales — `find.text(l10n.consentPrivacy)` matches once and the
  // `FilledButton` is found, with `takeException()` empty. Re-measured
  // 2026-08-10 on this tree.
  //
  // It mattered because the pin was not neutral: a tall, narrow surface at scale
  // 1.0 is the one geometry where the scrim could not overflow, so the ONE test
  // that finally mounts the real consent surface was pinned to the shape that
  // could not see the surface's actual layout defect (it overflowed by 644 px at
  // 360×640 @ text scale 2.0, which the chassis permits). The defect is fixed in
  // app.dart; `consent_scrim_layout_test.dart` is where the geometry is now
  // measured on purpose, at sizes a device actually has.
  final ProviderContainer c = ProviderContainer(
    overrides: <Override>[
      keyValueStoreProvider.overrideWith((_) async => MemStore()),
      analyticsEnabledProvider.overrideWithValue(true),
      consentTransportProvider.overrideWithValue(
        const core.DiscardingConsentTransport(),
      ),
    ],
  );
  addTearDown(c.dispose);
  // Through the controller rather than by overriding the provider: `set` is the
  // path the Settings language row takes, so the locale under test is reached
  // the way a user reaches it.
  await c.read(localeProvider.notifier).set(locale);

  await tester.pumpWidget(
    UncontrolledProviderScope(container: c, child: const SublyApp()),
  );
  // Not `pumpAndSettle`: the app root arms real timers (the recorder's flush
  // deadline, the router's redirects), and settling would wait on them. Several
  // provider futures resolve in sequence before the gate can decide, so the loop
  // is turned until the prompt is THERE rather than a fixed number of times.
  //
  // ⚠️ A HARDCODED FRAME COUNT IS THE THING THAT GETS BUMPED INSTEAD OF
  // DIAGNOSED. This helper carried `for (i = 0; i < 24; i++)` justified as "the
  // idiom consent_prompt_real_surface_test uses" — i.e. copied, not derived. A
  // count copied from another file is a number nobody owns: when a slower
  // resolution order makes it 25, the repair that looks obvious is 30, and the
  // real question (what is this waiting for?) never gets asked. The bound below
  // is generous and the exit condition is the actual thing being waited for.
  //
  // The exit condition is the privacy sentence in the locale under test, not a
  // widget type: `OutlinedButton`/`FilledButton` also occur on the onboarding
  // carousel BEHIND the scrim, so a type finder would report "arrived" a frame
  // before the prompt exists.
  final AppLocalizations l10n = await _load(locale.languageCode);
  for (int i = 0; i < 60; i++) {
    if (find.text(l10n.consentPrivacy).evaluate().isNotEmpty) break;
    await tester.pump();
  }
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
      // chassis key every stamped app's first run renders — the brick's
      // `features/firstrun/onboarding_screen.dart`, not anything in this app
      // (Subly's unrouted copy of that twin was deleted 2026-08-09). Had
      // Subly's pitch been written into it, every app the factory produces
      // would introduce itself with Subly's words.
      expect(en.onboarding1Title, 'Welcome');
      expect(en.sublyOnboarding1Title, isNot(en.onboarding1Title));
      expect(ta.sublyOnboarding1Title, isNot(ta.onboarding1Title));
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  group('the consent prompt speaks both locales', () {
    for (final String code in <String>['en', 'ta']) {
      testWidgets('[$code] title, body, privacy sentence and both buttons', (
        WidgetTester tester,
      ) async {
        final AppLocalizations l10n = await _load(code);
        await _pumpConsent(tester, Locale(code));

        expect(find.text(l10n.consentTitle(AppConfig.appName)), findsOneWidget);
        expect(find.text(l10n.consentBody), findsOneWidget);

        // BY THEIR CONTROLS, not by bare text. `OutlinedButton` beside
        // `FilledButton` is the equal-prominence pairing the prompt exists to
        // keep — a lopsided pair is the dark pattern consent rules are for — so
        // a finder that names the widget type goes red if the pairing is ever
        // broken, which a `find.text` never would.
        expect(
          find.widgetWithText(OutlinedButton, l10n.consentDecline),
          findsOneWidget,
        );
        expect(
          find.widgetWithText(FilledButton, l10n.consentAllow),
          findsOneWidget,
        );

        // 🔴 THE SENTENCE OF RECORD, ON THE SURFACE THAT ACTUALLY SHOWS IT.
        // The owner reconciled the two candidate wordings on 2026-08-09 and
        // chose the one that names the withdrawal route; this assertion is what
        // stops the shorter sentence coming back, in EITHER locale, and it can
        // only mean that because `_pumpConsent` mounts the real app root.
        expect(
          find.text(l10n.consentPrivacy),
          findsOneWidget,
          reason:
              'the prompt must show the sentence of record, including the '
              'promise that Settings can change the decision',
        );

        // 🔴 A GAP PINNED RATHER THAN LEFT SILENT. The retired dialog carried a
        // "Read the privacy policy" link; the live scrim does not, so
        // `consentReadPolicy` has no consumer today. Whether the live prompt
        // should link the policy is a consent-surface change and therefore an
        // owner/legal call, so it is recorded here instead of being quietly
        // closed or quietly forgotten. 👤 WHOEVER ADDS THE LINK: delete this
        // expectation in the same commit — it is a statement of what is, not a
        // rule about what should be.
        expect(
          find.text(l10n.consentReadPolicy),
          findsNothing,
          reason:
              'the live prompt has grown a policy link — good, but this file '
              'and the arb both still describe it as absent',
        );
      });
    }

    testWidgets('[ta] the pre-l10n English literals are GONE', (
      WidgetTester tester,
    ) async {
      await _pumpConsent(tester, const Locale('ta'));
      expect(find.text('Help improve ${AppConfig.appName}?'), findsNothing);
      expect(find.text('Allow'), findsNothing);
      expect(find.text('No thanks'), findsNothing);
    });

    test(
      'the privacy sentence NAMES THE WITHDRAWAL ROUTE, in both locales',
      () async {
        // The widget cases above pin "the prompt renders whatever the arb
        // says". This one pins WHAT THE ARB IS ALLOWED TO SAY, and it is the
        // half that survives a rewrite of the prompt: the sentence's last
        // clause is a promise, and `features/settings/settings_screen.dart` is
        // what keeps it (assert-consent-withdrawal-surface.mjs fails the build
        // if that row goes away). Dropping the clause while keeping the row is
        // a user who is never told the switch exists; dropping the row while
        // keeping the clause is a lie. Both halves are asserted, in two files.
        //
        // Tamil carries the same clause — "அமைப்புகளில்" is "in Settings" — and
        // checking English alone would be tautological in the way this file's
        // header warns about: the Tamil value could drop the promise silently
        // and only a Tamil reader would ever see it.
        //
        // ⚠️ THE TAMIL NEEDLE IS THE STEM "அமைப்புகள", WITHOUT THE FINAL PULLI,
        // AND THAT IS NOT A TYPO. Tamil inflects by suffix: the standalone
        // plural is "அமைப்புகள்" (ள + ் ) but the locative in this sentence is
        // "அமைப்புகளில்" (ள + ி …), so the standalone form is NOT a substring of
        // the inflected one and matching on it fails against a perfectly good
        // translation. It did, on the first run of this case. The stem matches
        // every case form a translator might legitimately reach for.
        const Map<String, String> settingsWord = <String, String>{
          'en': 'any time in Settings',
          'ta': 'அமைப்புகள',
        };
        for (final MapEntry<String, String> e in settingsWord.entries) {
          final AppLocalizations l10n = await _load(e.key);
          expect(
            l10n.consentPrivacy,
            contains(e.value),
            reason:
                '[${e.key}] the privacy sentence no longer tells the user the '
                'decision can be changed in Settings. The Settings row still '
                'exists, so this is a control the user is never told about',
          );
        }
      },
    );

    test('the RETIRED shorter sentence cannot come back', () async {
      // ⚠️ ANCHORED ON THE MISSING CLAUSE, NOT ON PUNCTUATION. This case first
      // shipped as `isNot(contains('— just a random code'))` — an EM DASH
      // literal — and the punctuation is exactly what the reconciliation moved
      // ("address — just" became "address. Just"). A future re-shortening
      // written with a comma, a hyphen or no dash at all would have walked
      // straight through it while retracting the same promise. What actually
      // defines the retired sentence is that it ENDS at the random code and
      // never reaches Settings, so that is what is asserted: the tail is
      // present AND the withdrawal clause is still there behind it.
      final AppLocalizations en = await _load('en');
      expect(
        en.consentPrivacy,
        contains('random code for this installation'),
        reason:
            'the sentence no longer describes what is collected; if that '
            'clause was deliberately rewritten, rewrite this case with it',
      );
      expect(
        en.consentPrivacy,
        contains('any time in Settings'),
        reason:
            'the pre-reconciliation wording is back in the arb. It stops at '
            '"just a random code for this installation" and says nothing about '
            'Settings, so shipping it silently retracts the withdrawal promise '
            'the sentence of record makes (owner decision 2026-08-09)',
      );
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
