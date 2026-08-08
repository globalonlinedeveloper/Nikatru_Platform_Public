// ─────────────────────────────────────────────────────────────────────────────
// P4·TEXT — THE BRIGHTNESS SEAM ON THE NAMED TEXT STYLES.
//
// `AppText.title/body/muted/fig/label/display` bake `AppColors.ink` (0xFF141420)
// and `AppColors.muted` into `const` TextStyles. With `darkTheme` supplied, that
// is near-black prose on a near-black scaffold on every screen at once — the one
// token defect that three independent dark-mode builders each hit from a
// different screen. `AppText.of(context)` is the seam that resolves it without
// touching the 107 const call sites.
//
// 🔴 THIS FILE IS A PAIR AND BOTH HALVES ARE LOAD-BEARING IN OPPOSITE
// DIRECTIONS — the same shape as `apps/subly/test/dark_card_surface_test.dart`:
//
//   · The LIGHT half is a PIN, not a feature test. It asserts `identical`
//     against the const objects AND asserts the LITERAL tokens those consts
//     carry. Asserting against `theme.colorScheme.onSurface` instead would make
//     the natural regression — someone "tidying" light to derive from the
//     scheme — pass, because both sides of the comparison would move together.
//     (Measured: for seed 0xFF6459F5 the light scheme's `onSurfaceVariant` is
//     #474650, not `AppColors.muted` #73737F, so that tidy-up is a real repaint,
//     not a no-op.)
//
//   · The DARK half is the FALSIFIER. Revert `AppText.resolve` to return
//     `_light` unconditionally and every dark case goes red on its first
//     expect — verified by doing exactly that (negative test, 2026-08-09).
//
// The dark expectations are computed from `buildAppTheme(...)` rather than
// written as hex literals, on purpose: pinning a dark grey here would re-freeze
// in the dark branch precisely the seed-follows-the-brand property [pipeline
// C-11] unfroze in the light one.
// ─────────────────────────────────────────────────────────────────────────────
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';

/// Two unrelated seeds. Neither is Subly's, deliberately — the seam belongs to
/// the chassis, so it must be asserted on a theme no app in the repo ships.
const Color _seedA = Color(0xFF0E7C6B);
const Color _seedB = Color(0xFFB3261E);

/// Resolves `AppText.of` under [theme]. `darkTheme` is left null so MaterialApp
/// uses [theme] whatever the host platform's brightness is.
///
/// ⚠️ `pumpAndSettle`, NOT `pump` — and this cost two false failures before it
/// was understood. MaterialApp wraps its child in an `AnimatedTheme`, so the
/// SECOND `pumpWidget` in one test still reports the FIRST theme at t=0: a
/// light→dark call handed back `AppColors.ink` and read exactly like a broken
/// resolver. Any test in this repo that pumps two themes in a row needs this.
Future<AppTextStyles> _pump(WidgetTester tester, ThemeData theme) async {
  late AppTextStyles styles;
  await tester.pumpWidget(
    MaterialApp(
      theme: theme,
      home: Builder(
        builder: (BuildContext context) {
          styles = AppText.of(context);
          return const SizedBox.shrink();
        },
      ),
    ),
  );
  await tester.pumpAndSettle();
  return styles;
}

void main() {
  // ───────────────────────────────────────────────────────────────────────────
  group('the const styles are untouched — the 107 call-site pin', () {
    // 105 references in apps/subly/lib + 2 in the app brick read these consts
    // directly and are NOT migrating. If someone "fixes dark" by re-pointing a
    // const at a scheme slot, every one of those sites repaints in LIGHT and
    // this is what says so.
    test('ink styles still carry the literal AppColors.ink', () {
      expect(AppText.display.color, AppColors.ink);
      expect(AppText.title.color, AppColors.ink);
      expect(AppText.fig.color, AppColors.ink);
      expect(AppText.body.color, AppColors.ink);
    });

    test('secondary styles still carry the literal AppColors.muted', () {
      expect(AppText.muted.color, AppColors.muted);
      expect(AppText.label.color, AppColors.muted);
    });

    test('they are still const — usable in a const widget tree', () {
      // If any of these stopped being `const`, this line would not compile, and
      // neither would ~107 call sites. The assertion is the compilation.
      const Widget w = Text('x', style: AppText.title);
      expect(w, isA<Text>());
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  group('LIGHT is byte-identical — of() returns the const objects themselves',
      () {
    testWidgets('every style is the SAME OBJECT as the const it replaces', (
      WidgetTester tester,
    ) async {
      final AppTextStyles s = await _pump(tester, buildAppTheme(seed: _seedA));

      // `same`, not `equals`. Equality would also hold for a light branch that
      // rebuilt each style through copyWith — which compares equal today and is
      // free to drift tomorrow. Identity cannot drift.
      expect(s.display, same(AppText.display));
      expect(s.title, same(AppText.title));
      expect(s.fig, same(AppText.fig));
      expect(s.body, same(AppText.body));
      expect(s.muted, same(AppText.muted));
      expect(s.label, same(AppText.label));
    });

    testWidgets('light does NOT derive from the scheme, for any seed', (
      WidgetTester tester,
    ) async {
      final AppTextStyles a = await _pump(tester, buildAppTheme(seed: _seedA));
      final AppTextStyles b = await _pump(tester, buildAppTheme(seed: _seedB));

      // Two different seeds, one light prose colour. This is the pin that makes
      // "light must not move" falsifiable: the moment light starts deriving,
      // these two stop matching.
      expect(a.title.color, AppColors.ink);
      expect(b.title.color, AppColors.ink);
      expect(a.muted.color, AppColors.muted);
      expect(b.muted.color, AppColors.muted);
    });

    testWidgets('the PINNED legacy AppTheme.light() path resolves light too', (
      WidgetTester tester,
    ) async {
      // apps/subly is on the chassis path today, but `AppTheme.light()` is still
      // the documented legacy façade. The seam must not care which one it is
      // under — it reads brightness, nothing else.
      final AppTextStyles s = await _pump(tester, AppTheme.light());
      expect(s.title, same(AppText.title));
      expect(s.muted, same(AppText.muted));
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  group('DARK derives from the scheme', () {
    testWidgets('ink styles become onSurface, not near-black ink', (
      WidgetTester tester,
    ) async {
      final ThemeData theme = buildAppTheme(
        seed: _seedA,
        brightness: Brightness.dark,
      );
      final ColorScheme scheme = theme.colorScheme;
      final AppTextStyles s = await _pump(tester, theme);

      expect(
        s.title.color,
        isNot(AppColors.ink),
        reason:
            'THE DEFECT THIS SEAM FIXES: 0xFF141420 prose on a dark scaffold. '
            'Reverting AppText.resolve to return the light set turns this red.',
      );
      expect(s.display.color, scheme.onSurface);
      expect(s.title.color, scheme.onSurface);
      expect(s.fig.color, scheme.onSurface);
      expect(s.body.color, scheme.onSurface);
    });

    testWidgets('secondary styles become onSurfaceVariant', (
      WidgetTester tester,
    ) async {
      final ThemeData theme = buildAppTheme(
        seed: _seedA,
        brightness: Brightness.dark,
      );
      final ColorScheme scheme = theme.colorScheme;
      final AppTextStyles s = await _pump(tester, theme);

      expect(s.muted.color, isNot(AppColors.muted));
      expect(s.label.color, isNot(AppColors.muted));
      // The same slot AppThemeX.fromScheme already uses for its `muted` token,
      // so the two cannot drift apart.
      expect(s.muted.color, scheme.onSurfaceVariant);
      expect(s.label.color, scheme.onSurfaceVariant);
      expect(s.muted.color, theme.extension<AppThemeX>()!.muted);
    });

    testWidgets('dark prose FOLLOWS THE SEED — it is not a second pin', (
      WidgetTester tester,
    ) async {
      final AppTextStyles a = await _pump(
        tester,
        buildAppTheme(seed: _seedA, brightness: Brightness.dark),
      );
      final AppTextStyles b = await _pump(
        tester,
        buildAppTheme(seed: _seedB, brightness: Brightness.dark),
      );

      // M3's neutral palette is hue-tinted by the seed, so two brands get
      // measurably different dark prose. A hardcoded dark grey would pass every
      // other test in this group and fail this one — which is the point.
      expect(a.title.color, isNot(b.title.color));
      expect(a.muted.color, isNot(b.muted.color));
    });

    testWidgets('dark separates prose from the scaffold it sits on', (
      WidgetTester tester,
    ) async {
      final ThemeData theme = buildAppTheme(
        seed: _seedA,
        brightness: Brightness.dark,
      );
      final AppTextStyles s = await _pump(tester, theme);

      // The bug in one line: near-black text on a near-black background. The
      // scaffold is `scheme.surface` (build_app_theme.dart), so the honest
      // check is that the prose is far from THAT, measured in luminance rather
      // than by asserting two colours merely differ.
      final double bg = theme.scaffoldBackgroundColor.computeLuminance();
      for (final TextStyle style in <TextStyle>[
        s.display,
        s.title,
        s.fig,
        s.body,
        s.muted,
        s.label,
      ]) {
        final double fg = style.color!.computeLuminance();
        final double contrast = (fg + 0.05) / (bg + 0.05);
        expect(
          contrast,
          greaterThan(4.5),
          reason: 'Dark prose must clear WCAG AA against the dark scaffold. '
              'Measured on the shipped tokens for Subly\'s seed: AppColors.ink '
              'scores 1.02:1 and AppColors.muted 3.96:1 against the dark '
              'scaffold #131318 — the first is invisible, the second is under '
              'AA. That is the defect in two numbers. The seam scores 14.4:1.',
        );
      }
    });

    testWidgets('copyWith preserves everything that is NOT colour', (
      WidgetTester tester,
    ) async {
      final AppTextStyles s = await _pump(
        tester,
        buildAppTheme(seed: _seedA, brightness: Brightness.dark),
      );

      // A dark branch built with a fresh `TextStyle(color: …)` instead of
      // `copyWith` passes every colour assertion above and silently drops the
      // tabular figures and the label's tracking. That is exactly the kind of
      // regression nobody notices until money columns stop aligning.
      expect(s.fig.fontFeatures, AppText.fig.fontFeatures);
      expect(s.fig.fontFamily, 'Space Grotesk');
      expect(s.label.fontSize, 11);
      expect(s.label.letterSpacing, 0.8);
      expect(s.label.fontWeight, FontWeight.w700);
      expect(s.display.height, AppText.display.height);
      expect(s.display.letterSpacing, AppText.display.letterSpacing);
      expect(s.body.fontFamily, 'Manrope');
      expect(s.muted.fontWeight, FontWeight.w500);
    });

    testWidgets('the PINNED legacy AppTheme.dark() path resolves dark too', (
      WidgetTester tester,
    ) async {
      final ThemeData theme = AppTheme.dark();
      final AppTextStyles s = await _pump(tester, theme);
      expect(s.title.color, theme.colorScheme.onSurface);
      expect(s.title.color, isNot(AppColors.ink));
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  group('of() and resolve() are the same resolution', () {
    testWidgets('of(context) == resolve(Theme.of(context)) in both modes', (
      WidgetTester tester,
    ) async {
      for (final ThemeData theme in <ThemeData>[
        buildAppTheme(seed: _seedA),
        buildAppTheme(seed: _seedA, brightness: Brightness.dark),
      ]) {
        final AppTextStyles viaContext = await _pump(tester, theme);
        final AppTextStyles viaTheme = AppText.resolve(theme);
        expect(viaContext.title.color, viaTheme.title.color);
        expect(viaContext.muted.color, viaTheme.muted.color);
      }
    });

    test('resolve() reads brightness, not the palette it was built from', () {
      // A bare ThemeData.dark() carries none of NIKATRU's tokens. The seam still
      // has to work — a stamped app is free to build its ThemeData any way it
      // likes, and there is no extension here to be missing.
      final AppTextStyles s = AppText.resolve(ThemeData.dark());
      expect(s.title.color, ThemeData.dark().colorScheme.onSurface);
      expect(s.title.color, isNot(AppColors.ink));
    });
  });
}
