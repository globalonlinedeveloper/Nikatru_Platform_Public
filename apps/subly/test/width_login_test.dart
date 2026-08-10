// ─────────────────────────────────────────────────────────────────────────────
// WIDTH AND BRIGHTNESS — THE LOGIN SCREEN (`/sign-in`, the canonical auth
// route since 2026-08-10; `/login` redirects onto it).
//
// Two properties, both of which were live defects on the same screen, and both
// of which are invisible to every other test in this suite because neither
// throws, clips, or changes a single string.
//
// 1 · THE FORM CAP (`ContentPane.form`, 420). An email field, a password field
//     and a button, stretched edge to edge across a 1280 px window. The
//     arithmetic here is DIFFERENT from `width_onboarding_test.dart`'s and the
//     difference is deliberate: this screen keeps its 28/28 padding on the
//     SCROLL VIEW, outside the cap (matching `features/auth/sign_up_screen.dart`
//     — the app's other auth surface, and the only other one since the stamped
//     `sign_in_screen.dart` twin went with the 2026-08-10 route
//     consolidation), so the width inside the pane is `min(surface - 56, 420)`
//     rather than `min(surface, 420) - 56`.
//
//     🔴 THAT MAKES 768 THE FALSIFYING CASE, AND IT IS FALSIFIED EARLY: the cap
//     engages the moment the surface passes 420 + 56 = 476 px — a large phone in
//     landscape, never mind a tablet. Strip `ContentPane.form` out of
//     `login_screen.dart` and the 768 case reads 712 instead of 420 (verified,
//     negative test 2026-08-09). Contrast the `kMaxBodyWidth` groups in
//     `responsive_width_test.dart`, which need a 1920 surface to tell a present
//     cap from an absent one.
//
// 2 · THE DARK BRANCH. `app.dart` supplies a `darkTheme` and `themeMode`
//     defaults to `ThemeMode.system`, so every user on a dark-mode OS lands
//     here — and this screen painted twelve `AppColors.*` literals
//     unconditionally. The pair below reads like `dark_card_surface_test.dart`
//     and `shared_primitives_test.dart`, for the same reasons:
//
//       · The LIGHT half is a PIN, not a feature test. It asserts the LITERAL
//         token (`AppColors.bg`, `AppColors.surface`, `AppColors.ink`), never
//         `scheme.<slot>`. Asserting against the scheme would let the natural
//         regression — someone "tidying" the light arm of `_tones` to a scheme
//         slot — pass, because both sides of the comparison would move together.
//         apps/subly is the frozen rail-prover the owner eyeballs.
//       · The DARK half is the FALSIFIER, and it deliberately covers TEXT as
//         well as SURFACES. Fixing only the surfaces produces a screen that
//         passes a surface-only test and renders near-black headings
//         (`AppColors.ink`, #141420, baked into `AppText.title`) on a near-black
//         scaffold. A dark test that cannot see that has not tested dark.
// ─────────────────────────────────────────────────────────────────────────────
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';
import 'package:subly/core/e2e_keys.dart';
import 'package:subly/features/auth/login_screen.dart';
import 'package:subly/l10n/app_localizations.dart';

import 'support/width_harness.dart';

/// The 28/28 padding, which stays OUTSIDE the cap on this screen.
const double kGutters = 56;

/// The seed `app.dart` passes to BOTH `theme:` and `darkTheme:`. A literal here
/// (as in `dark_card_surface_test.dart`) so a change to the app's seed surfaces
/// as a failure to explain rather than a test that silently follows it.
const Color kSublySeed = Color(0xFF6459F5);

/// [pumpAt], plus the two themes and a [ThemeMode] — the harness's own pump
/// hosts a bare `MaterialApp` with no theme at all, which is right for a width
/// question and useless for a brightness one.
Future<void> pumpLogin(WidgetTester tester, Size size, ThemeMode mode) async {
  await tester.binding.setSurfaceSize(size);
  addTearDown(() => tester.binding.setSurfaceSize(null));
  final ProviderContainer c = ProviderContainer(
    overrides: defaultWidthOverrides(),
  );
  addTearDown(c.dispose);
  await tester.pumpWidget(
    UncontrolledProviderScope(
      container: c,
      child: MaterialApp(
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        theme: buildAppTheme(seed: kSublySeed),
        darkTheme: buildAppTheme(seed: kSublySeed, brightness: Brightness.dark),
        themeMode: mode,
        home: const LoginScreen(),
      ),
    ),
  );
  for (int i = 0; i < 12; i++) {
    await tester.pump();
  }
}

Color? _scaffoldBackground(WidgetTester tester) =>
    tester.widget<Scaffold>(find.byType(Scaffold)).backgroundColor;

Color? _fieldFill(WidgetTester tester) => tester
    .widget<TextField>(find.byKey(E2EKeys.loginEmail))
    .decoration!
    .fillColor;

Color? _headingColor(WidgetTester tester, String heading) =>
    tester.widget<Text>(find.text(heading)).style!.color;

void main() {
  final ColorScheme dark = buildAppTheme(
    seed: kSublySeed,
    brightness: Brightness.dark,
  ).colorScheme;

  // ───────────────────────────────────────────────────────────────────────────
  group('login is capped at the form width', () {
    testWidgets('at 375 the cap is a no-op and nothing overflows', (
      WidgetTester tester,
    ) async {
      await pumpAt(tester, kPhone, const LoginScreen());
      expect(
        offeredWidth(tester, inPane(Column)),
        375 - kGutters,
        reason:
            'a ConstrainedBox may only tighten within what it was handed, so '
            'the narrowest phone must render exactly as it did before the pane '
            'existed — 375 less the 28/28 padding that was already there',
      );
      expect(
        tester.takeException(),
        isNull,
        reason: 'the fields and the divider row must lay out clean at 375',
      );
    });

    // ⚠️ NOT `768 - 56`. The cap is 420 and it engaged 292 px ago — this is the
    // case that goes red the moment `ContentPane.form` is removed.
    testWidgets('at 768 the form cap has ALREADY engaged', (
      WidgetTester tester,
    ) async {
      await pumpAt(tester, kTablet, const LoginScreen());
      expect(
        offeredWidth(tester, inPane(Column)),
        AppBreakpoints.form,
        reason:
            'stripping the pane makes this 712 — a sign-in form as wide as a '
            'tablet, which is the shape the cap exists to refuse',
      );
    });

    testWidgets('at 1280 the form is still exactly the cap', (
      WidgetTester tester,
    ) async {
      await pumpAt(tester, kDesktop, const LoginScreen());
      expect(offeredWidth(tester, inPane(Column)), AppBreakpoints.form);
      expect(AppBreakpoints.form, 420);
      // Where the cap starts biting, stated as arithmetic rather than left for
      // the next reader to work out: 420 + 28 + 28. A large phone in landscape
      // is already past it, so this cap is not a desktop-only concern.
      expect(AppBreakpoints.form + kGutters, 476);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  group('login is theme-aware', () {
    testWidgets('LIGHT is pixel-identical to the pre-dark screen', (
      WidgetTester tester,
    ) async {
      final AppLocalizations en = await AppLocalizations.delegate.load(
        const Locale('en'),
      );
      await pumpLogin(tester, kPhone, ThemeMode.light);

      expect(
        _scaffoldBackground(tester),
        AppColors.bg,
        reason:
            'The light scaffold MUST stay the literal AppColors.bg. This is '
            'the frozen legacy app the owner eyeballs; swapping it for '
            'scheme.surface repaints the first screen every user sees.',
      );
      expect(
        _fieldFill(tester),
        AppColors.surface,
        reason: 'The light field fill stays the literal AppColors.surface.',
      );
      expect(
        _headingColor(tester, en.welcomeBack),
        AppColors.ink,
        reason:
            'The light heading colour is the value AppText.title already '
            'carried — the copyWith must be a no-op in light, not a repaint.',
      );
    });

    testWidgets('DARK derives its surfaces from the scheme, not the tokens', (
      WidgetTester tester,
    ) async {
      await pumpLogin(tester, kPhone, ThemeMode.dark);

      expect(
        _scaffoldBackground(tester),
        isNot(AppColors.bg),
        reason:
            'THE DEFECT THIS INCREMENT FIXES: a near-white sheet inside dark '
            'chassis chrome. Reverting _tones to the hardcoded tokens turns '
            'this red.',
      );
      expect(
        _scaffoldBackground(tester),
        dark.surface,
        reason:
            'the screen agrees with buildAppTheme, which sets '
            'scaffoldBackgroundColor to scheme.surface — not a second answer',
      );
      expect(
        _fieldFill(tester),
        dark.surfaceContainerHighest,
        reason:
            'the same slot cardDecoration and RowCard already chose: the '
            'lightest container step, widest separation from the scaffold',
      );
    });

    testWidgets('DARK also fixes the TEXT, not only the surfaces', (
      WidgetTester tester,
    ) async {
      final AppLocalizations en = await AppLocalizations.delegate.load(
        const Locale('en'),
      );
      await pumpLogin(tester, kPhone, ThemeMode.dark);

      // 🔴 THE HALF A SURFACE-ONLY SWEEP LEAVES BEHIND. AppText.title bakes
      // `AppColors.ink` (#141420) into a const TextStyle in the design system,
      // so a screen that fixed only its backgrounds would render a near-black
      // "Welcome back" on a near-black scaffold — legible to no one, and green
      // in every test that looks at surfaces alone.
      expect(
        _headingColor(tester, en.welcomeBack),
        isNot(AppColors.ink),
        reason:
            'the heading is still painting the light-mode ink token onto a '
            'dark scaffold',
      );
      expect(
        _headingColor(tester, en.welcomeBack),
        dark.onSurface,
        reason: "the heading takes the scheme's own on-surface slot",
      );
    });
  });
}
