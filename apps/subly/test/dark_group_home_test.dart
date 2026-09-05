// ─────────────────────────────────────────────────────────────────────────────
// P4·L3 — THE HOME GROUP IN BOTH BRIGHTNESSES: home's header control, the shell's
// compact nav pill, and the notifications card.
//
// These three are one increment because they are one defect. `cardDecoration`
// (#228, W0) fixed 17 card sites and its report NAMED what it was leaving
// behind: `RowCard` — closed by L1 — and **the compact nav pill in
// app_shell.dart, "chassis chrome, part of a larger hardcoded strip"**. That
// strip is the worst-placed instance of the whole family: `cardDecoration` is
// visible on five screens, the pill is visible on EVERY tab of the app at every
// compact width, and all four of its colours were light literals.
//
// 🔴 EVERY GROUP BELOW IS A PAIR, AND THE TWO HALVES FAIL IN OPPOSITE
// DIRECTIONS. Read them together or neither is worth anything — this is the
// shape `dark_card_surface_test.dart` established and it is deliberate:
//
//   · The LIGHT half is a PIN AGAINST THE LITERAL, not a feature test.
//     `apps/subly` is the frozen legacy rail-prover and the owner eyeballs the
//     light build. Asserting against `scheme.surface` instead would make the
//     natural regression — someone "tidying" a light branch to a scheme slot —
//     PASS, because both sides of the comparison would move together.
//
//   · The DARK half is the FALSIFIER: revert a branch to its unconditional
//     light literal and the dark case goes red naming the real value.
//
// 🔴 AND ONE GROUP RUNS THE OTHER WAY, WHICH IS WHY IT IS HERE AT ALL. The hero
// card's six white foregrounds are NOT the defect they look like: the ground is
// `AppColors.heroGradient`, three fixed near-black purples that render
// identically under `theme` and `darkTheme` because a const gradient is not a
// scheme slot. White is correct in BOTH modes there. The obvious tidy-up —
// "migrate every hardcoded colour to the scheme" — would put near-black text on
// a near-black card in LIGHT mode, and nothing else in this repo would notice.
// So the hero is pinned white in both brightnesses, on purpose.
//
// ⬜ WHAT THIS INCREMENT DOES **NOT** FIX, stated so the gap is not mistaken for
// coverage.
//
// 🔴 CORRECTED 2026-08-21 — THE PARAGRAPH THAT STOOD HERE IS NOW FALSE AND IS
// REWRITTEN RATHER THAN DELETED, because the gap it named was real and the shape
// of the note is what a later reader needs. It read: "`AppText.title/body/muted/
// fig/label` hardcode `AppColors.ink` / `AppColors.muted` inside
// `packages/design_system`. Every dark surface this campaign has created — W0's
// 17 cards, L1's rows, and the three here — carries near-black prose on it. That
// is ONE chassis-level increment (the token class has to grow a brightness), not
// five per-screen branches."
//
// ✅ THAT CHASSIS INCREMENT LANDED, and it landed the way the note asked for.
// The const styles did NOT move (107 call sites depend on their `const`-ness);
// `AppText.of(context)` / `AppText.resolve(theme)` were added beside them and
// return the const objects THEMSELVES in light — `identical(…title,
// AppText.title)` is pinned in `packages/design_system/test/app_text_test.dart`.
// Home was migrated to it, and so were the two shared primitives home is built
// from: `SectionHeader` and `RowCard`'s title, in `features/shared/widgets.dart`.
// So the sentence "near-black prose on every dark surface" is no longer true of
// home, of the three widgets below, or — measured across `apps/subly/lib` on
// 2026-08-21 — of ANY code site: every remaining bare `AppText.<style>` either
// resolves through the seam or carries its own `copyWith(color:)`.
//
// ⬜ WHAT IS ACTUALLY STILL OUTSTANDING is a DIFFERENT class, and naming it is
// the whole point of keeping this block: light `AppColors.*` literals painted
// UNCONDITIONALLY on things that are not text. Measured 2026-08-21:
//   · `settings_screen.dart` — the one screen still outstanding as a screen:
//     the currency chips (`:382` fill `AppColors.surface`, `:387`/`:420` borders
//     `AppColors.line`, `:394` label `AppColors.ink`), the edit-profile
//     `AlertDialog` (`:1287` `backgroundColor: AppColors.surface`) and the row
//     divider at `:1617` (`AppColors.line`).
//   · `home_screen.dart:443` — the forward-arrow `Icon` on the unused-subs row
//     is a `const Icon(color: AppColors.muted)`. Home's PROSE is migrated; this
//     one glyph is not, and it is not an `AppText` defect.
//   · `features/shared/painters.dart:49` — `RingPainter.track` defaults to
//     `AppColors.line` (#ECECF2) and neither caller overrides it, so the budget
//     and scan rings draw a near-white track on a dark screen.
//   · `features/shared/due.dart:28`/`:51` — the far-due label resolves to
//     `AppColors.muted`, which every `RowCard` subtitle on home and detail then
//     renders on a dark card.
// Named here for the same reason as before: a reader who sees dark surfaces
// passing tests could reasonably assume dark mode is done.
// ─────────────────────────────────────────────────────────────────────────────
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_design_system/nikatru_design_system.dart';
import 'package:subly/core/router.dart';
import 'package:subly/features/home/home_screen.dart';
import 'package:subly/features/notifications/notifications_screen.dart';
import 'package:subly/features/shared/widgets.dart' show kCardShadow;
import 'package:subly/features/shell/app_shell.dart';
import 'package:subly/l10n/app_localizations.dart';
import 'package:subly/state/providers.dart';

import 'support/width_harness.dart';

/// The seed `app.dart` passes to BOTH `theme:` and `darkTheme:`. Kept as a
/// literal (as in `dark_card_surface_test.dart` and `shared_primitives_test`)
/// so a change to the app's seed surfaces as a failure to explain rather than as
/// a test that silently follows it.
const Color kSublySeed = Color(0xFF6459F5);

/// The two literals the pill's light branch is made of. Written out here rather
/// than referenced from the source so that editing the source cannot edit the
/// expectation with it.
const Color kPillLightFill = Color.fromRGBO(255, 255, 255, 0.9);
const Color kPillLightRim = Color.fromRGBO(255, 255, 255, 0.6);

/// The hero's two foreground values — see the header for why they must NOT move.
const Color kHeroInk = Colors.white;
const Color kHeroInkFaint = Color.fromRGBO(255, 255, 255, 0.7);

/// The router's onboarding gate declines to decide while the seen-flag hydrates
/// (null), and a pump that never answers stalls pre-frame. Same override the
/// router tests use.
class _OnboardingSeen extends OnboardingSeenController {
  @override
  bool? build() => true;
}

/// Signed in and stable — the shell case asserts chrome, not auth, so this is
/// the smallest thing that stops the router's signed-out redirect bouncing us
/// off /home.
class _SignedInAuth extends core.AuthRepository {
  @override
  core.AuthUser? get currentUser => const core.AuthUser(
    id: 'dark',
    email: 'dark@test.dev',
    emailVerified: true,
  );

  @override
  Stream<core.AuthUser?> authStateChanges() =>
      const Stream<core.AuthUser?>.empty();

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

/// Hosts [screen] under [mode] with the real delegates and the two platform-
/// channel seams faked ([defaultWidthOverrides]).
///
/// The pump loop is the harness's, and for the same reason: several provider
/// futures resolve in sequence, `pumpAndSettle` would be a lie about why we are
/// waiting, and the seed data has to arrive before the dashboard exists to
/// measure.
Future<void> _pumpScreen(
  WidgetTester tester,
  ThemeMode mode,
  Widget screen,
) async {
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
        home: Scaffold(body: screen),
      ),
    ),
  );
  for (int i = 0; i < 12; i++) {
    await tester.pump();
  }
}

/// Hosts the WHOLE APP through its real router under [mode], pinned to a phone.
///
/// 🔴 THE SURFACE PIN IS LOAD-BEARING, not tidiness. `compactNavigationBar` is
/// delivered through a seam `AppScaffold` reaches ONLY in the compact window
/// class, and flutter_test's default surface is 800×600 — which resolves to
/// `medium`, i.e. a RAIL. An unpinned version of this test would assert nothing
/// about the pill because the pill would not be in the tree, and
/// `find.byKey(AppShell.navPillKey)` would fail with "found 0 widgets" rather
/// than with anything about colour.
///
/// And the router is not optional either: `StatefulNavigationShell` cannot be
/// constructed standalone, so the pill is only reachable through a real app.
Future<void> _pumpShell(WidgetTester tester, ThemeMode mode) async {
  await tester.binding.setSurfaceSize(kPhone);
  addTearDown(() => tester.binding.setSurfaceSize(null));
  final ProviderContainer c = ProviderContainer(
    overrides: <Override>[
      ...defaultWidthOverrides(),
      onboardingSeenProvider.overrideWith(_OnboardingSeen.new),
      // This user has accepted the current terms. Stated, not defaulted: a
      // signed-in user with no acceptance on record is sent to /reaccept-terms
      // by the router, which is correct and is what every pre-clickwrap install
      // sees once. The gate itself is driven in legal_gates_test.dart.
      legalReacceptanceNeededProvider.overrideWithValue(false),
      authRepositoryProvider.overrideWithValue(_SignedInAuth()),
      analyticsConsentProvider.overrideWithValue(core.ConsentStatus.denied),
    ],
  );
  addTearDown(c.dispose);
  await tester.pumpWidget(
    UncontrolledProviderScope(
      container: c,
      child: MaterialApp.router(
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        theme: buildAppTheme(seed: kSublySeed),
        darkTheme: buildAppTheme(seed: kSublySeed, brightness: Brightness.dark),
        themeMode: mode,
        routerConfig: c.read(routerProvider),
      ),
    ),
  );
  await tester.pumpAndSettle();
  expect(
    find.byType(AppShell),
    findsOneWidget,
    reason:
        'the router did not land on the shell, so nothing below is measuring '
        'the nav pill — check the redirect overrides, not the colours',
  );
}

/// The nearest [Container] ancestor of [icon] — the 48px control the icon sits
/// in. Nearest rather than `.first` of a type search, so a Container appearing
/// higher in the tree cannot become the thing being measured.
BoxDecoration _controlAround(WidgetTester tester, IconData icon) {
  final Container c = tester.widget<Container>(
    find
        .ancestor(of: find.byIcon(icon), matching: find.byType(Container))
        .first,
  );
  return c.decoration! as BoxDecoration;
}

/// The hero card, found by the one thing that is unmistakably it: its gradient.
Finder get _hero => find.byWidgetPredicate(
  (Widget w) =>
      w is Container &&
      w.decoration is BoxDecoration &&
      (w.decoration! as BoxDecoration).gradient == AppColors.heroGradient,
  description: 'the hero card (the AppColors.heroGradient Container)',
);

void main() {
  final ColorScheme dark = buildAppTheme(
    seed: kSublySeed,
    brightness: Brightness.dark,
  ).colorScheme;

  // ───────────────────────────────────────────────────────────────────────────
  group("home's header control is theme-aware", () {
    testWidgets('LIGHT is pixel-identical to the pre-dark bell', (
      WidgetTester tester,
    ) async {
      await _pumpScreen(tester, ThemeMode.light, const HomeScreen());
      final BoxDecoration d = _controlAround(
        tester,
        Icons.notifications_none_rounded,
      );

      expect(
        d.color,
        AppColors.surface,
        reason:
            'The light control MUST stay the literal AppColors.surface. This '
            'is the frozen legacy app the owner eyeballs, and the bell sits at '
            'the top of the first screen the app opens on.',
      );
      expect(
        (d.border! as Border).top.color,
        AppColors.line,
        reason: 'Light keeps the original hairline token, unchanged.',
      );
      expect(
        tester
            .widget<Icon>(find.byIcon(Icons.notifications_none_rounded))
            .color,
        AppColors.ink,
        reason: 'And the original glyph colour.',
      );
    });

    testWidgets('DARK derives fill, edge and glyph from the scheme', (
      WidgetTester tester,
    ) async {
      await _pumpScreen(tester, ThemeMode.dark, const HomeScreen());
      final BoxDecoration d = _controlAround(
        tester,
        Icons.notifications_none_rounded,
      );

      expect(
        d.color,
        isNot(AppColors.surface),
        reason:
            'THE DEFECT: a 0xFFFFFFFF square is the brightest thing on a dark '
            'screen, and it sat directly above a hero that is already dark. '
            'Reverting _circleButton to the unconditional token turns this red.',
      );
      expect(
        d.color,
        dark.surfaceContainerHighest,
        reason:
            'The same slot cardDecoration and RowCard use — the header control '
            'and the rows under it must be one material, not two.',
      );
      expect((d.border! as Border).top.color, dark.outlineVariant);
      expect(
        tester
            .widget<Icon>(find.byIcon(Icons.notifications_none_rounded))
            .color,
        dark.onSurface,
        reason:
            'A near-black glyph on the new dark fill would be a control with '
            'nothing visible in it — the defect moved one level in.',
      );
    });

    testWidgets('DARK: the unread dot punches out of the NEW fill', (
      WidgetTester tester,
    ) async {
      await _pumpScreen(tester, ThemeMode.dark, const HomeScreen());
      // The dot is the 8x8 warn circle; its ring exists to separate it from
      // whatever it sits on, so a white ring on a dark button is the same bug
      // one size down.
      final Container dot = tester.widget<Container>(
        find
            .byWidgetPredicate(
              (Widget w) =>
                  w is Container &&
                  w.decoration is BoxDecoration &&
                  (w.decoration! as BoxDecoration).shape == BoxShape.circle &&
                  (w.decoration! as BoxDecoration).color == AppColors.warn,
            )
            .first,
      );
      expect(
        ((dot.decoration! as BoxDecoration).border! as Border).top.color,
        dark.surfaceContainerHighest,
        reason:
            'The ring follows the FILL. Left at AppColors.surface it is a '
            'white halo around an amber dot on a dark control.',
      );
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  group('the hero is white in BOTH brightnesses — the anti-migration pin', () {
    for (final (String name, ThemeMode mode) in <(String, ThemeMode)>[
      ('LIGHT', ThemeMode.light),
      ('DARK', ThemeMode.dark),
    ]) {
      testWidgets('[$name] every hero foreground stays white', (
        WidgetTester tester,
      ) async {
        await _pumpScreen(tester, mode, const HomeScreen());
        expect(_hero, findsOneWidget);

        final Iterable<Text> texts = tester.widgetList<Text>(
          find.descendant(of: _hero, matching: find.byType(Text)),
        );
        expect(
          texts,
          isNotEmpty,
          reason:
              'nothing to check — a colour assertion over an empty set is the '
              'vacuous check this limb exists to replace',
        );
        for (final Text t in texts) {
          expect(
            t.style?.color,
            anyOf(kHeroInk, kHeroInkFaint),
            reason:
                'Hero copy "${t.data}" left the white family under $name. The '
                'ground here is a CONST gradient (heroA/B/C, near-black) that '
                'is identical in both themes, so a scheme-derived foreground '
                'is near-black-on-near-black in LIGHT — the campaign defect, '
                'introduced backwards.',
          );
        }
      });
    }

    testWidgets('and the gradient itself never becomes a scheme slot', (
      WidgetTester tester,
    ) async {
      await _pumpScreen(tester, ThemeMode.dark, const HomeScreen());
      final BoxDecoration d =
          tester.widget<Container>(_hero).decoration! as BoxDecoration;
      expect(
        d.gradient,
        AppColors.heroGradient,
        reason:
            'If the ground ever DOES become theme-aware, the white pins above '
            'stop being correct and must move in the same commit. This is the '
            'assertion that makes that impossible to do quietly.',
      );
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  group("the shell's compact nav pill is theme-aware", () {
    testWidgets('LIGHT is pixel-identical to the pre-dark chrome', (
      WidgetTester tester,
    ) async {
      await _pumpShell(tester, ThemeMode.light);

      expect(
        tester.widget<ColoredBox>(find.byKey(AppShell.navStripKey)).color,
        AppColors.bg,
        reason:
            'The strip under the pill MUST stay the literal AppColors.bg — it '
            'is the band the pill appears to float on, on every tab.',
      );
      final BoxDecoration pill =
          tester.widget<Container>(find.byKey(AppShell.navPillKey)).decoration!
              as BoxDecoration;
      expect(pill.color, kPillLightFill);
      expect((pill.border! as Border).top.color, kPillLightRim);
      expect(
        pill.boxShadow,
        kCardShadow,
        reason: 'Light keeps the original two-layer lift, unchanged.',
      );
    });

    testWidgets('DARK derives the strip and the pill from the scheme', (
      WidgetTester tester,
    ) async {
      await _pumpShell(tester, ThemeMode.dark);

      final Color strip = tester
          .widget<ColoredBox>(find.byKey(AppShell.navStripKey))
          .color;
      expect(
        strip,
        isNot(AppColors.bg),
        reason:
            'THE DEFECT, AND THE MOST-SEEN ONE IN THE APP: AppColors.bg is '
            '0xFFF4F4F8, so a near-white band ran across the bottom of EVERY '
            'dark-mode screen. Reverting the ColoredBox to the unconditional '
            'token turns this red.',
      );
      expect(
        strip,
        dark.surface,
        reason:
            'buildAppTheme sets scaffoldBackgroundColor to scheme.surface, so '
            'this is the strip disappearing into the page — which is exactly '
            'what AppColors.bg was doing in light, and what makes the pill '
            'read as floating rather than as sitting in a tray.',
      );

      final BoxDecoration pill =
          tester.widget<Container>(find.byKey(AppShell.navPillKey)).decoration!
              as BoxDecoration;
      expect(
        pill.color,
        isNot(kPillLightFill),
        reason: 'A 90%-white pill on a dark strip is the same defect again.',
      );
      expect(pill.color, dark.surfaceContainerHighest);
      expect((pill.border! as Border).top.color, dark.outlineVariant);
      expect(
        pill.boxShadow,
        isNull,
        reason:
            'kCardShadow is two BLACK alphas. On a dark ground it paints '
            'nothing a user can see, so it is DROPPED rather than dimmed for '
            'show — the same call cardDecoration and RowCard record.',
      );
    });

    testWidgets('DARK: an unselected tab label is readable on the new pill', (
      WidgetTester tester,
    ) async {
      await _pumpShell(tester, ThemeMode.dark);
      final AppLocalizations en = await AppLocalizations.delegate.load(
        const Locale('en'),
      );

      // Tab 0 is selected on /home, so Calendar is the unselected case.
      final Text label = tester.widget<Text>(
        find.descendant(
          of: find.byKey(AppShell.navPillKey),
          matching: find.text(en.navCalendar),
        ),
      );
      expect(
        label.style?.color,
        isNot(AppColors.muted),
        reason:
            'AppColors.muted (0xFF73737F) is a mid-grey chosen against white. '
            'Left in place, four of the five tab labels sit at near-nothing '
            'contrast on the dark pill.',
      );
      expect(label.style?.color, dark.onSurfaceVariant);
    });

    testWidgets('LIGHT: the selected tab keeps the brand accent', (
      WidgetTester tester,
    ) async {
      await _pumpShell(tester, ThemeMode.light);
      final AppLocalizations en = await AppLocalizations.delegate.load(
        const Locale('en'),
      );
      final Text home = tester.widget<Text>(
        find.descendant(
          of: find.byKey(AppShell.navPillKey),
          matching: find.text(en.navHome),
        ),
      );
      final Text calendar = tester.widget<Text>(
        find.descendant(
          of: find.byKey(AppShell.navPillKey),
          matching: find.text(en.navCalendar),
        ),
      );
      expect(
        home.style?.color,
        AppColors.accent,
        reason:
            'The SELECTED colour is the brand mark and is deliberately NOT '
            'branched: it is what tells the user which tab they are on, and it '
            'reads on both grounds.',
      );
      expect(
        calendar.style?.color,
        AppColors.muted,
        reason: 'Light keeps the original unselected token.',
      );
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  group('notifications is theme-aware', () {
    testWidgets('LIGHT is pixel-identical to the pre-dark screen', (
      WidgetTester tester,
    ) async {
      await _pumpScreen(tester, ThemeMode.light, const NotificationsScreen());

      final BoxDecoration close = _controlAround(tester, Icons.close);
      expect(close.color, AppColors.surface);
      expect((close.border! as Border).top.color, AppColors.line);

      final BoxDecoration card = tester
          .widgetList<Container>(
            find.descendant(
              of: find.byType(ListView),
              matching: find.byType(Container),
            ),
          )
          .map((Container c) => c.decoration)
          .whereType<BoxDecoration>()
          .firstWhere((BoxDecoration d) => d.color == AppColors.surface);
      expect(
        card.boxShadow,
        isNull,
        reason:
            'THE REASON THIS CARD IS SPELLED OUT INSTEAD OF CALLING '
            'cardDecoration: that helper carries kCardShadow in its light '
            'branch and this card has never had a shadow. Delegating would '
            'have been a one-line diff that repainted the light screen.',
      );
      expect(
        card.border,
        isNull,
        reason: 'Light gains nothing from the dark work.',
      );
    });

    testWidgets('DARK derives the scaffold, the close control and the card', (
      WidgetTester tester,
    ) async {
      await _pumpScreen(tester, ThemeMode.dark, const NotificationsScreen());

      final Scaffold sheet = tester.widget<Scaffold>(
        find.descendant(
          of: find.byType(NotificationsScreen),
          matching: find.byType(Scaffold),
        ),
      );
      expect(
        sheet.backgroundColor,
        isNot(AppColors.bg),
        reason:
            'THE DEFECT: a near-white sheet pushed in front of a dark app. '
            'Reverting backgroundColor to the token turns this red.',
      );
      expect(sheet.backgroundColor, dark.surface);

      final BoxDecoration close = _controlAround(tester, Icons.close);
      expect(close.color, dark.surfaceContainerHighest);
      expect((close.border! as Border).top.color, dark.outlineVariant);

      final Iterable<BoxDecoration> cards = tester
          .widgetList<Container>(
            find.descendant(
              of: find.byType(ListView),
              matching: find.byType(Container),
            ),
          )
          .map((Container c) => c.decoration)
          .whereType<BoxDecoration>()
          .where((BoxDecoration d) => d.color == dark.surfaceContainerHighest);
      expect(
        cards,
        isNotEmpty,
        reason:
            'No card derived its fill from the scheme — the list is either '
            'empty (nothing to measure) or the card branch was reverted.',
      );
      expect(
        (cards.first.border! as Border).top.color,
        dark.outlineVariant,
        reason:
            'Without a border the dark card has no boundary: this card carries '
            'no shadow at all, so colour separation is the ONLY edge it has, '
            'and the hairline is what keeps it from reading as a flat region.',
      );
    });
  });
}
