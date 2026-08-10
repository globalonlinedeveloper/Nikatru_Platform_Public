// ─────────────────────────────────────────────────────────────────────────────
// P4·L1 — THE SHARED PRIMITIVES: RowCard's brightness, and the l10n of the two
// shared strings that reach every screen.
//
// `features/shared/` is the one directory in this app where a single line is
// wrong on three screens at once. Three separate properties are pinned here
// because all three live in that directory, and each is falsifiable on its own:
//
//   1. ROWCARD IN BOTH BRIGHTNESSES. RowCard is `cardDecoration`'s deferred
//      sibling — same file, same defect, explicitly named in W0's report as NOT
//      fixed there. The pair reads exactly like `dark_card_surface_test.dart`:
//      the LIGHT half is a PIN against the LITERAL `AppColors.surface` (asserting
//      against `scheme.surface` would let the natural regression — "tidying" the
//      light branch to a scheme slot — pass, because both sides of the
//      comparison would move together), and the DARK half is the FALSIFIER.
//
//   2. `DueInfo.localized` RETURNS ARB STRINGS. Asserted in EN *and* TA. The
//      English half alone would be tautological: `l10n.dueToday` is "Due today",
//      which is byte-identical to the hardcoded literal `DueInfo.of` still
//      returns, so an implementation that never touched the arb would pass it.
//      Tamil is what makes the assertion able to fail.
//
//   3. `PoweredByNikatru` RENDERS THE LOCALIZED LINE. Same reasoning, and Tamil
//      is even sharper here: `poweredByLine` reads "{company} வழங்கும் {app}" —
//      the two names SWAP PLACES. A concatenation of an interpolated "by" cannot
//      produce that string in any order.
//
//   4. P4·TEXT — THE OTHER THREE LIGHT-ONLY PRIMITIVES: `SectionHeader`,
//      `SoftButton`, `GradientButton`. Same pair shape as RowCard above: each
//      group is a LIGHT pin against the LITERAL tokens plus a DARK falsifier,
//      and each of the three is independently falsifiable (reverting one
//      widget's dark branch reddens only its own group — verified 2026-08-09).
//      The seam underneath `SectionHeader` is `AppText.of(context)`, pinned
//      separately at package level in
//      `packages/design_system/test/app_text_test.dart`.
// ─────────────────────────────────────────────────────────────────────────────
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';
import 'package:subly/core/app_config.dart';
import 'package:subly/data/models/subscription.dart';
import 'package:subly/features/shared/due.dart';
import 'package:subly/features/shared/widgets.dart';
import 'package:subly/l10n/app_localizations.dart';

/// The seed `app.dart` passes to BOTH `theme:` and `darkTheme:`. Kept as a
/// literal (as in `dark_card_surface_test.dart`) so a change to the app's seed
/// surfaces as a failure to explain rather than a test that silently follows it.
const Color kSublySeed = Color(0xFF6459F5);

/// A subscription whose renewal is [days] away from [now].
Subscription _dueIn(int days, DateTime now) => Subscription(
  id: 's1',
  name: 'Netflix',
  category: 'Streaming',
  price: 649,
  cycle: BillingCycle.monthly,
  nextRenewal: now.add(Duration(days: days)),
);

/// Mounts a bare [RowCard] under [mode] and hands back the two widgets that
/// carry the surface: the outer Container (shadow / border) and the Material
/// (fill — it has to be the Material so the InkWell splash clips to it).
Future<({BoxDecoration decoration, Material material})> _pumpRow(
  WidgetTester tester,
  ThemeMode mode,
) async {
  await tester.pumpWidget(
    MaterialApp(
      theme: buildAppTheme(seed: kSublySeed),
      darkTheme: buildAppTheme(seed: kSublySeed, brightness: Brightness.dark),
      themeMode: mode,
      home: const Scaffold(
        body: Center(child: RowCard(title: 'Netflix')),
      ),
    ),
  );
  final Container container = tester.widget<Container>(
    find
        .descendant(of: find.byType(RowCard), matching: find.byType(Container))
        .first,
  );
  final Material material = tester.widget<Material>(
    find
        .descendant(of: find.byType(RowCard), matching: find.byType(Material))
        .first,
  );
  return (
    decoration: container.decoration! as BoxDecoration,
    material: material,
  );
}

/// Mounts [PoweredByNikatru] with the real delegates in [locale].
Future<void> _pumpFooter(WidgetTester tester, Locale locale) async {
  await tester.pumpWidget(
    MaterialApp(
      locale: locale,
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      supportedLocales: AppLocalizations.supportedLocales,
      theme: buildAppTheme(seed: kSublySeed),
      home: const Scaffold(body: Center(child: PoweredByNikatru())),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  final ColorScheme dark = buildAppTheme(
    seed: kSublySeed,
    brightness: Brightness.dark,
  ).colorScheme;

  // ───────────────────────────────────────────────────────────────────────────
  group('RowCard is theme-aware', () {
    testWidgets('LIGHT is pixel-identical to the pre-dark row', (
      WidgetTester tester,
    ) async {
      final ({BoxDecoration decoration, Material material}) row =
          await _pumpRow(tester, ThemeMode.light);

      expect(
        row.material.color,
        AppColors.surface,
        reason:
            'The light row MUST stay the literal AppColors.surface. This is the '
            'frozen legacy app the owner eyeballs; RowCard is on home (2 sites) '
            'and scan, so a swap to scheme.surface repaints the dashboard.',
      );
      expect(
        row.decoration.boxShadow,
        kCardShadow,
        reason: 'Light keeps the original two-layer shadow, unchanged.',
      );
      expect(
        row.decoration.border,
        isNull,
        reason:
            'Light gains NOTHING from the dark work — a border here would be a '
            'visible 1px inset on every row.',
      );
    });

    testWidgets('DARK derives its fill from the scheme, not the token', (
      WidgetTester tester,
    ) async {
      final ({BoxDecoration decoration, Material material}) row =
          await _pumpRow(tester, ThemeMode.dark);

      expect(
        row.material.color,
        isNot(AppColors.surface),
        reason:
            'THE DEFECT THIS INCREMENT FIXES: a white row on a dark scaffold. '
            'Reverting the Material to the unconditional AppColors.surface '
            'turns this red.',
      );
      expect(
        row.material.color,
        dark.surfaceContainerHighest,
        reason:
            'The dark row uses the same scheme slot as cardDecoration — the '
            'lightest container step, widest separation from the scaffold.',
      );
    });

    testWidgets('DARK carries an edge affordance instead of the shadow', (
      WidgetTester tester,
    ) async {
      final ({BoxDecoration decoration, Material material}) row =
          await _pumpRow(tester, ThemeMode.dark);

      // kCardShadow is two BLACK alphas (0x0A141420, 0x24141420). On a dark
      // scaffold they paint nothing a user can see, so the row would have no
      // boundary at all — the border is required, not decorative.
      expect(
        row.decoration.boxShadow,
        isNull,
        reason:
            'The black-alpha shadow is DROPPED in dark, not dimmed for show.',
      );
      expect(
        row.decoration.border,
        isNotNull,
        reason: 'Without a border the dark row has NO boundary.',
      );
      expect(
        (row.decoration.border! as Border).top.color,
        dark.outlineVariant,
        reason:
            "The hairline is the scheme's own divider slot, not an invented "
            'colour.',
      );
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  group('DueInfo.localized reads the arb', () {
    // `now` is fixed and mid-month so no Duration arithmetic crosses a boundary
    // that DateTime(y, m, d) truncation would round differently.
    final DateTime now = DateTime(2026, 6, 15, 9, 30);

    for (final String code in <String>['en', 'ta']) {
      testWidgets('[$code] today / tomorrow / N days come from l10n', (
        WidgetTester tester,
      ) async {
        // The exact load path `Localizations` itself takes.
        final AppLocalizations l10n = await AppLocalizations.delegate.load(
          Locale(code),
        );

        expect(
          DueInfo.localized(l10n, _dueIn(0, now), now).label,
          l10n.dueToday,
          reason:
              'Due-today must be the arb string. In [$code] that is '
              '"${l10n.dueToday}" — an implementation that kept the hardcoded '
              '"Due today" passes [en] and fails [ta].',
        );
        expect(
          DueInfo.localized(l10n, _dueIn(1, now), now).label,
          l10n.renewsTomorrow,
          reason: 'The d == 1 branch is renewsTomorrow, NOT dueInDays(1).',
        );
        expect(
          DueInfo.localized(l10n, _dueIn(2, now), now).label,
          l10n.dueInDays(2),
          reason: 'The near branch (d <= 5) interpolates the count.',
        );
        expect(
          DueInfo.localized(l10n, _dueIn(30, now), now).label,
          l10n.dueInDays(30),
          reason: 'The far branch uses the same key, only the colour differs.',
        );

        // The three labels must be mutually distinct in every locale — a
        // translation that collapsed two of them would make the branch
        // unobservable, and the assertions above would still pass.
        final Set<String> labels = <String>{
          l10n.dueToday,
          l10n.renewsTomorrow,
          l10n.dueInDays(2),
        };
        expect(
          labels,
          hasLength(3),
          reason: 'Locale $code collapsed a branch.',
        );
      });
    }

    testWidgets('the plural key actually pluralizes (the shipped bug)', (
      WidgetTester tester,
    ) async {
      final AppLocalizations en = await AppLocalizations.delegate.load(
        const Locale('en'),
      );

      // 🔴 This pins the ARB VALUES, not DueInfo. Both live branches of
      // `DueInfo.of` read `In $d days`, so before `dueInDays` became a plural
      // key a one-day horizon anywhere in the app rendered "In 1 days".
      // English needed the plural before Tamil did. DueInfo.localized itself
      // never reaches the =1 arm (d == 1 returns renewsTomorrow first), so if
      // the arm is ever deleted as "unreachable", this is what says otherwise.
      expect(en.dueInDays(1), 'In 1 day');
      expect(en.dueInDays(2), 'In 2 days');
      expect(en.dueInDays(1), isNot(en.dueInDays(2)));
    });

    testWidgets('localized keeps of()\'s thresholds and colours', (
      WidgetTester tester,
    ) async {
      final AppLocalizations en = await AppLocalizations.delegate.load(
        const Locale('en'),
      );

      // `of` is retained until the three call sites migrate, which means the
      // two factories coexist and can DRIFT. The urgency colour is the part a
      // reader would not notice drifting, so it is asserted across the whole
      // range rather than at one point.
      for (int d = -3; d <= 40; d++) {
        final Subscription s = _dueIn(d, now);
        expect(
          DueInfo.localized(en, s, now).color,
          DueInfo.of(s, now).color,
          reason: 'Colour drift between of() and localized() at d = $d.',
        );
      }
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  group('PoweredByNikatru renders the localized line', () {
    testWidgets('[en] the publisher line and the three short links', (
      WidgetTester tester,
    ) async {
      final AppLocalizations en = await AppLocalizations.delegate.load(
        const Locale('en'),
      );
      await _pumpFooter(tester, const Locale('en'));

      expect(
        find.text(en.poweredByLine(AppConfig.appName, AppConfig.companyName)),
        findsOneWidget,
      );
      expect(find.text(en.linkPrivacyShort), findsOneWidget);
      expect(find.text(en.linkTermsShort), findsOneWidget);
      expect(find.text(en.linkRefundShort), findsOneWidget);
    });

    testWidgets('[ta] the placeholders SWAP ORDER — a concatenation cannot', (
      WidgetTester tester,
    ) async {
      final AppLocalizations ta = await AppLocalizations.delegate.load(
        const Locale('ta'),
      );
      await _pumpFooter(tester, const Locale('ta'));

      // "{company} வழங்கும் {app}" — company first. This is the whole reason
      // poweredByLine is a placeholder key rather than a translated "by".
      expect(
        find.text(ta.poweredByLine(AppConfig.appName, AppConfig.companyName)),
        findsOneWidget,
        reason:
            'The Tamil line puts the company FIRST. No interpolation of '
            "'\$appName by \$companyName' can produce it.",
      );
      expect(
        find.text('${AppConfig.appName} by ${AppConfig.companyName}'),
        findsNothing,
        reason:
            'THE FALSIFIER: the pre-l10n hardcoded string must not survive '
            'into a Tamil build.',
      );

      expect(find.text(ta.linkPrivacyShort), findsOneWidget);
      expect(find.text(ta.linkTermsShort), findsOneWidget);
      expect(find.text(ta.linkRefundShort), findsOneWidget);
      expect(
        find.text('Privacy'),
        findsNothing,
        reason: 'Same falsifier for the footer links.',
      );
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // P4·TEXT — the three primitives that were still light-only after W0/L1.
  //
  // Each group is one widget, so a revert of one dark branch reddens exactly
  // one group and names itself. The LIGHT halves assert LITERAL tokens
  // (`AppColors.ink` / `.surface` / `.line` / `.brandGradient`, `kBrandGlow`),
  // never scheme slots: asserting against the scheme would let the natural
  // regression — "tidying" a light branch to `scheme.*` — pass, because both
  // sides of the comparison would move together.
  // ───────────────────────────────────────────────────────────────────────────
  group('SectionHeader is theme-aware', () {
    testWidgets('LIGHT is byte-identical to the pre-dark heading', (
      WidgetTester tester,
    ) async {
      await _pumpUnder(tester, ThemeMode.light, const SectionHeader('By date'));
      final TextStyle s = _headerStyle(tester);

      expect(
        s.color,
        AppColors.ink,
        reason:
            'The light heading MUST stay the literal AppColors.ink. It is on '
            'calendar, budget and twice on home — the screens the owner '
            'eyeballs.',
      );
      // Still AppText.title underneath, not a style rebuilt by hand: these three
      // are what `AppText.title` carries and a fresh TextStyle would drop them.
      expect(s.fontFamily, 'Space Grotesk');
      expect(s.fontWeight, FontWeight.w700);
      expect(s.letterSpacing, -0.4);
      expect(s.fontSize, 17, reason: 'The call-site copyWith is unchanged.');
    });

    testWidgets('DARK resolves the heading through the AppText seam', (
      WidgetTester tester,
    ) async {
      await _pumpUnder(tester, ThemeMode.dark, const SectionHeader('By date'));
      final TextStyle s = _headerStyle(tester);

      expect(
        s.color,
        isNot(AppColors.ink),
        reason:
            'THE ROOT CAUSE THIS INCREMENT FIXES: 0xFF141420 prose on a dark '
            'scaffold. Reverting SectionHeader to the const AppText.title '
            'turns this red.',
      );
      expect(
        s.color,
        dark.onSurface,
        reason: 'The seam maps the ink styles onto the scheme\'s prose slot.',
      );
      // copyWith, not a rebuild — the size and the tracking must survive dark.
      expect(s.fontSize, 17);
      expect(s.letterSpacing, -0.4);
      expect(s.fontFamily, 'Space Grotesk');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  group('SoftButton is theme-aware', () {
    testWidgets('LIGHT is byte-identical to the pre-dark pill', (
      WidgetTester tester,
    ) async {
      await _pumpUnder(
        tester,
        ThemeMode.light,
        const SoftButton(label: 'Keep it'),
      );
      final _Soft s = _softStyle(tester);

      expect(s.background, AppColors.surface, reason: 'literal, pinned');
      expect(s.side, AppColors.line, reason: 'literal, pinned');
      expect(s.foreground, AppColors.ink, reason: 'the old const default');
      expect(s.labelColor, AppColors.ink);
    });

    testWidgets('DARK takes the RowCard slots instead of the white pill', (
      WidgetTester tester,
    ) async {
      await _pumpUnder(
        tester,
        ThemeMode.dark,
        const SoftButton(label: 'Keep it'),
      );
      final _Soft s = _softStyle(tester);

      expect(
        s.background,
        isNot(AppColors.surface),
        reason:
            'THE DEFECT THIS INCREMENT FIXES: a white pill on a dark sheet — '
            '"Keep it", "Continue with Apple", the consent answers. Reverting '
            'the backgroundColor to the unconditional AppColors.surface turns '
            'this red.',
      );
      expect(
        s.background,
        dark.surfaceContainerHighest,
        reason:
            'The same slot cardDecoration and RowCard use, so the three read '
            'as one surface family.',
      );
      expect(
        s.side,
        isNot(AppColors.line),
        reason:
            'AppColors.line (0xFFECECF2) is a hairline tuned to sit ON white. '
            'Left alone it is the brightest thing on a dark sheet.',
      );
      expect(s.side, dark.outlineVariant);
      expect(s.foreground, isNot(AppColors.ink));
      expect(s.foreground, dark.onSurface);
      expect(
        s.labelColor,
        dark.onSurface,
        reason:
            'The Text carries its own style, so the foregroundColor alone is '
            'not enough — both have to move or the label stays near-black.',
      );
    });

    testWidgets('an EXPLICIT color is honoured verbatim in both brightnesses', (
      WidgetTester tester,
    ) async {
      // `settings_screen.dart:671` passes `color: AppColors.danger` for the
      // delete-account row. A caller that names a colour is choosing an accent,
      // not asking for the default prose colour, so the brightness branch must
      // not overrule it — otherwise this widget's own dark fix would flatten a
      // deliberate accent.
      //
      // (This case was justified by `consent_prompt.dart passes AppColors.accent
      // for "Allow"` until 2026-08-10, when that widget was deleted. The
      // justification was RE-POINTED rather than the case deleted: the caller it
      // named is gone, the behaviour it protects is not.)
      for (final ThemeMode mode in <ThemeMode>[
        ThemeMode.light,
        ThemeMode.dark,
      ]) {
        await _pumpUnder(
          tester,
          mode,
          const SoftButton(label: 'Allow', color: AppColors.accent),
        );
        final _Soft s = _softStyle(tester);
        expect(s.foreground, AppColors.accent, reason: 'mode: $mode');
        expect(s.labelColor, AppColors.accent, reason: 'mode: $mode');
      }
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  group('GradientButton is theme-aware', () {
    testWidgets('LIGHT keeps the brand gradient AND the accent glow', (
      WidgetTester tester,
    ) async {
      await _pumpUnder(
        tester,
        ThemeMode.light,
        const GradientButton(label: 'Sign in'),
      );
      final _Grad g = _gradientStyle(tester);

      expect(g.decoration.gradient, AppColors.brandGradient);
      expect(
        g.decoration.boxShadow,
        kBrandGlow,
        reason: 'Light keeps the original one-layer accent glow, unchanged.',
      );
      expect(g.labelColor, Colors.white);
    });

    testWidgets('DARK drops the light-tuned accent glow', (
      WidgetTester tester,
    ) async {
      await _pumpUnder(
        tester,
        ThemeMode.dark,
        const GradientButton(label: 'Sign in'),
      );
      final _Grad g = _gradientStyle(tester);

      expect(
        g.decoration.boxShadow,
        isNull,
        reason:
            'kBrandGlow is the ACCENT at 50%. Over the near-white page it is a '
            'soft lift; over scheme.surface in dark the same constant resolves '
            'to #3B3687 (measured) — a hard purple bloom. This is kCardShadow\'s '
            'defect read the other way round: a fixed-alpha shadow tuned to one '
            'background misbehaves on the other. Restoring the unconditional '
            'boxShadow turns this red.',
      );
    });

    testWidgets('DARK does NOT repaint the fill or the label', (
      WidgetTester tester,
    ) async {
      await _pumpUnder(
        tester,
        ThemeMode.dark,
        const GradientButton(label: 'Sign in'),
      );
      final _Grad g = _gradientStyle(tester);

      // 🔒 Deliberate NON-change, asserted so nobody "finishes the job" later.
      // brandGradient + white is already this app's treatment on its dark
      // surfaces (onboarding CTA, both heroes, the FAB, the calendar today-pill)
      // and contrast holds at both gradient ends for a 15px w700 label. Swapping
      // dark to the theme's derived gradient would force scheme.onPrimary for
      // the label and leave this one CTA diverging from every other brand
      // surface — a repaint with no defect behind it.
      expect(g.decoration.gradient, AppColors.brandGradient);
      expect(g.labelColor, Colors.white);
    });
  });
}

// ─── P4·TEXT helpers ─────────────────────────────────────────────────────────

/// Mounts [child] under Subly's REAL theme pair — the same `buildAppTheme(seed:)`
/// calls `app.dart` makes — at [mode].
///
/// ⚠️ `pumpAndSettle`, not `pump`: MaterialApp wraps its child in an
/// `AnimatedTheme`, so a second `pumpWidget` in one test still reports the FIRST
/// theme at t=0 and a light→dark switch reads as a broken widget.
Future<void> _pumpUnder(
  WidgetTester tester,
  ThemeMode mode,
  Widget child,
) async {
  await tester.pumpWidget(
    MaterialApp(
      theme: buildAppTheme(seed: kSublySeed),
      darkTheme: buildAppTheme(seed: kSublySeed, brightness: Brightness.dark),
      themeMode: mode,
      home: Scaffold(body: Center(child: child)),
    ),
  );
  await tester.pumpAndSettle();
}

/// The style the single [Text] inside a mounted [SectionHeader] actually renders
/// with — the thing a user sees, not the style the widget was handed.
TextStyle _headerStyle(WidgetTester tester) => tester
    .widget<Text>(
      find.descendant(
        of: find.byType(SectionHeader),
        matching: find.byType(Text),
      ),
    )
    .style!;

typedef _Soft = ({
  Color background,
  Color foreground,
  Color side,
  Color labelColor,
});

/// [SoftButton]'s four resolved colours. The `ButtonStyle` properties are
/// `WidgetStateProperty`s, so they are resolved for the default (enabled,
/// untouched) state rather than read raw.
_Soft _softStyle(WidgetTester tester) {
  final ButtonStyle style = tester
      .widget<OutlinedButton>(find.byType(OutlinedButton))
      .style!;
  final Text label = tester.widget<Text>(
    find.descendant(of: find.byType(SoftButton), matching: find.byType(Text)),
  );
  return (
    background: style.backgroundColor!.resolve(<WidgetState>{})!,
    foreground: style.foregroundColor!.resolve(<WidgetState>{})!,
    side: style.side!.resolve(<WidgetState>{})!.color,
    labelColor: label.style!.color!,
  );
}

typedef _Grad = ({BoxDecoration decoration, Color labelColor});

/// [GradientButton]'s outer decoration (gradient + glow) and its label colour.
_Grad _gradientStyle(WidgetTester tester) {
  final DecoratedBox box = tester.widget<DecoratedBox>(
    find
        .descendant(
          of: find.byType(GradientButton),
          matching: find.byType(DecoratedBox),
        )
        .first,
  );
  final Text label = tester.widget<Text>(
    find.descendant(
      of: find.byType(GradientButton),
      matching: find.byType(Text),
    ),
  );
  return (
    decoration: box.decoration as BoxDecoration,
    labelColor: label.style!.color!,
  );
}
