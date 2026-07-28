import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';

void main() {
  // ── [pipeline C-11] ────────────────────────────────────────────────────────
  // THREE TESTS IN THIS FILE USED TO ASSERT THE DEFECT. They checked that
  // `buildAppTheme(light)` returned `AppColors.accent` as primary, that it
  // carried `AppColors.ramp`, and that `AppTheme.light()` matched
  // `buildAppTheme(light)` exactly. All three passed — because the shared
  // builder really did hand every app Subly's palette regardless of its seed.
  // They were green, and they were describing the bug.
  //
  // The split is now explicit and both halves are asserted:
  //   buildAppTheme(seed:) → the CHASSIS path, fully derived from the seed
  //   AppTheme.light()/dark() → the PINNED legacy Subly palette, for apps/subly
  //                             only, which 39-CHASSIS cut 1 froze
  // ───────────────────────────────────────────────────────────────────────────
  group('buildAppTheme — the seed drives what is painted', () {
    // THE TEST THIS FILE MOST NEEDED AND DID NOT HAVE. The deleted
    // `honours a custom seed` passed a colour and then asserted the BRIGHTNESS,
    // so any seed passed and no colour was ever examined.
    test('two different seeds produce different primaries', () {
      final ThemeData red = buildAppTheme(seed: const Color(0xFFFF0000));
      final ThemeData green = buildAppTheme(seed: const Color(0xFF00FF00));
      expect(red.colorScheme.primary, isNot(green.colorScheme.primary));
    });

    test('the brand gradient and category ramp follow the seed too', () {
      final AppThemeX red =
          buildAppTheme(seed: const Color(0xFFFF0000)).extension<AppThemeX>()!;
      final AppThemeX green =
          buildAppTheme(seed: const Color(0xFF00FF00)).extension<AppThemeX>()!;
      // The gradient is the most visible brand surface in the app; a const one
      // made every stamp look identical no matter what it was seeded with.
      expect(red.brandGradient, isNot(green.brandGradient));
      expect(red.heroGradient, isNot(green.heroGradient));
      expect(red.categoryRamp, isNot(green.categoryRamp));
      expect(red.muted, isNot(green.muted));
    });

    test('the category ramp stays eight visually separable colours', () {
      final AppThemeX x =
          buildAppTheme(seed: const Color(0xFF0E7C6B)).extension<AppThemeX>()!;
      expect(x.categoryRamp, hasLength(8));
      // Eight slots off one Material palette would be eight tints of one hue,
      // which is useless for a legend — so they must be genuinely distinct.
      expect(x.categoryRamp.toSet(), hasLength(8));
    });

    test('status colours do NOT follow the brand', () {
      final AppThemeX red =
          buildAppTheme(seed: const Color(0xFFFF0000)).extension<AppThemeX>()!;
      final AppThemeX green =
          buildAppTheme(seed: const Color(0xFF00FF00)).extension<AppThemeX>()!;
      // Green means good and red means danger in every app. Re-hueing these
      // from a brand seed trades a universal signal for a decoration.
      expect(red.positive, green.positive);
      expect(red.warn, green.warn);
      expect(red.danger, green.danger);
    });

    test('dark yields a dark scheme, and differs from light for one seed', () {
      const Color seed = Color(0xFF0E7C6B);
      final ThemeData light = buildAppTheme(seed: seed);
      final ThemeData dark =
          buildAppTheme(seed: seed, brightness: Brightness.dark);
      expect(dark.brightness, Brightness.dark);
      expect(dark.colorScheme.brightness, Brightness.dark);
      expect(
          dark.scaffoldBackgroundColor, isNot(light.scaffoldBackgroundColor));
    });

    test('useMaterial3 and the Manrope text theme still apply', () {
      final ThemeData t = buildAppTheme();
      expect(t.useMaterial3, isTrue);
      expect(t.textTheme.bodyMedium?.fontFamily, 'Manrope');
      expect(t.extension<AppThemeX>(), isNotNull);
    });
  });

  group('AppTheme — the PINNED legacy Subly palette', () {
    // apps/subly is frozen as a rail-prover, so these values must not move when
    // the shared builder becomes seed-driven. Byte-for-byte, deliberately.
    test('light() is exactly the palette Subly shipped', () {
      final ThemeData t = AppTheme.light();
      expect(t.colorScheme.primary, AppColors.accent);
      expect(t.colorScheme.secondary, AppColors.accent2);
      expect(t.scaffoldBackgroundColor, AppColors.bg);
      expect(t.dividerColor, AppColors.line);
      final AppThemeX x = t.extension<AppThemeX>()!;
      expect(x.brandGradient, AppColors.brandGradient);
      expect(x.categoryRamp, AppColors.ramp);
    });

    test('dark() is the pinned dark palette', () {
      final ThemeData t = AppTheme.dark();
      expect(t.brightness, Brightness.dark);
      expect(t.colorScheme.primary, AppColors.accent2);
      expect(t.scaffoldBackgroundColor, AppColors.onboardBg);
      expect(t.extension<AppThemeX>()!.categoryRamp, AppColors.ramp);
    });

    // 🔒 THE REGRESSION THAT WOULD UNDO C-11. If the pinned façade and the
    // seeded chassis path ever agree again, it means Subly's constants have been
    // wired back into the shared builder — which is exactly the state that made
    // every stamped app identical. They MUST differ.
    test('the pinned palette is NOT what the chassis path produces', () {
      expect(
        AppTheme.light().colorScheme.primary,
        isNot(buildAppTheme(seed: AppColors.accent).colorScheme.primary),
        reason:
            'if these match, app-specific constants are back in buildAppTheme '
            'and every stamped app is the same colour again',
      );
    });
  });

  group('AppThemeX', () {
    test('copyWith overrides only the given field', () {
      const AppThemeX base = AppThemeX.light;
      final AppThemeX c = base.copyWith(danger: const Color(0xFF000000));
      expect(c.danger, const Color(0xFF000000));
      expect(c.positive, base.positive);
    });

    test('lerp returns an AppThemeX and endpoints are stable', () {
      const AppThemeX a = AppThemeX.light;
      const AppThemeX b = AppThemeX.dark;
      expect(a.lerp(b, 0.0).line, a.line);
      expect(a.lerp(b, 1.0).line, b.line);
      expect(a.lerp(null, 0.5), same(a));
    });

    test('fromScheme derives tokens from the scheme it is given', () {
      final ColorScheme scheme =
          ColorScheme.fromSeed(seedColor: const Color(0xFF0E7C6B));
      final AppThemeX x = AppThemeX.fromScheme(scheme);
      expect(x.muted, scheme.onSurfaceVariant);
      expect(x.line, scheme.outlineVariant);
      expect((x.brandGradient as LinearGradient).colors.first, scheme.primary);
    });
  });
}
