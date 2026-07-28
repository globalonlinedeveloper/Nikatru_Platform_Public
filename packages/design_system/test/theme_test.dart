import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';

void main() {
  group('buildAppTheme', () {
    test('light reproduces the original Subly defaults', () {
      final ThemeData t = buildAppTheme(brightness: Brightness.light);
      expect(t.brightness, Brightness.light);
      expect(t.useMaterial3, isTrue);
      expect(t.scaffoldBackgroundColor, AppColors.bg);
      expect(t.colorScheme.primary, AppColors.accent);
      expect(t.colorScheme.secondary, AppColors.accent2);
      expect(t.dividerColor, AppColors.line);
    });

    test('dark yields a dark colour scheme', () {
      final ThemeData t = buildAppTheme(brightness: Brightness.dark);
      expect(t.brightness, Brightness.dark);
      expect(t.colorScheme.brightness, Brightness.dark);
      expect(t.scaffoldBackgroundColor, AppColors.onboardBg);
    });

    // ── DELETED 2026-07-28: a test that could not fail ──────────────────────
    // It read:
    //     test('honours a custom seed', () {
    //       final t = buildAppTheme(seed: Color(0xFF00A0FF), brightness: dark);
    //       expect(t.brightness, Brightness.dark);      // ← the OTHER parameter
    //     });
    // It passed a seed colour and then asserted the BRIGHTNESS. Any seed passed;
    // no colour was ever examined. So it carried the name of the check the
    // codebase most needed while performing none of it — and that green tick is
    // why nobody noticed that AppThemeX's brand tokens are `static const` and
    // ignore the seed entirely (a stamped app gets its own primary colour and
    // Subly's gradient, side by side, on screen).
    //
    // Deleted rather than rewritten, per the [2]C-11 lock: an assertion that
    // cannot fail is worse than none, because it occupies the space a real one
    // would take. The real test — the seed provably reaching ColorScheme.primary
    // AND AppThemeX.brandGradient — lands with C-11's increment.
    // ─────────────────────────────────────────────────────────────────────────

    test('attaches the AppThemeX extension with brand tokens', () {
      final AppThemeX? x = buildAppTheme().extension<AppThemeX>();
      expect(x, isNotNull);
      expect(x!.categoryRamp, AppColors.ramp);
      expect(x.positive, AppColors.positive);
      expect(x.danger, AppColors.danger);
      expect(x.line, AppColors.line);
    });
  });

  group('AppTheme compat facade', () {
    test('light() matches buildAppTheme(light)', () {
      final ThemeData a = AppTheme.light();
      final ThemeData b = buildAppTheme(brightness: Brightness.light);
      expect(a.scaffoldBackgroundColor, b.scaffoldBackgroundColor);
      expect(a.colorScheme.primary, b.colorScheme.primary);
      expect(a.dividerColor, b.dividerColor);
    });

    test('dark() builds a dark theme', () {
      expect(AppTheme.dark().brightness, Brightness.dark);
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
  });
}
