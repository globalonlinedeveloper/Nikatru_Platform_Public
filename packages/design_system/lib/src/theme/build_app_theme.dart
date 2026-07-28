import 'package:flutter/material.dart';

import '../tokens/app_colors.dart';
import 'app_theme_x.dart';

/// Builds the NIKATRU [ThemeData] for a [seed] colour and [brightness].
///
/// 🔴 [pipeline C-11] THE SEED NOW DRIVES WHAT IS PAINTED. It did not before,
/// and the gap was total rather than partial: this function called
/// `ColorScheme.fromSeed(seedColor: seed, primary: AppColors.accent)` — passing
/// the seed and then overriding the one slot that matters — and attached the
/// `const AppThemeX.light`, so the gradients and the category ramp were fixed
/// too. Measured 2026-07-28 before the fix: a red-seeded theme and a
/// green-seeded theme produced an IDENTICAL primary, an IDENTICAL brand
/// gradient and an IDENTICAL ramp. `seed_hex` moved only the derived
/// secondary/tertiary ramp, which nothing prominent paints with.
///
/// Every app the factory stamped would therefore have looked the same. That is a
/// STORE-SURVIVAL problem, not a cosmetic one: both stores treat near-identical
/// apps as spam, Play enforcement extends to RELATED ACCOUNTS, and L21 stakes
/// the whole portfolio on one store identity — so a single clone-flag is a
/// portfolio-wide event, not an app-level one.
///
/// Everything here is now derived from the scheme: [ThemeData.colorScheme] from
/// the seed, the neutrals from the scheme's own semantic slots, and the brand
/// tokens via [AppThemeX.fromScheme].
/// 🔒 [seed] is REQUIRED, deliberately — owner decision 2026-07-28.
///
/// It used to default to `AppColors.accent`, which is *Subly's* colour. That
/// left one app-specific constant in the chassis path after C-11 removed the
/// rest: any call site that forgot a seed silently rendered a product's brand,
/// and the brick's own `smoke_test.dart` did exactly that. Requiring it turns a
/// silent wrong colour into a compile error, which is the only version of this
/// that cannot be got wrong by omission.
ThemeData buildAppTheme({
  required Color seed,
  Brightness brightness = Brightness.light,
}) {
  final ColorScheme scheme = ColorScheme.fromSeed(
    seedColor: seed,
    brightness: brightness,
  );
  return _themeFrom(
    scheme: scheme,
    brightness: brightness,
    tokens: AppThemeX.fromScheme(scheme, brightness: brightness),
    scaffoldBackground: scheme.surface,
    ink: scheme.onSurface,
    divider: scheme.outlineVariant,
  );
}

/// The shared assembly step. Private so there is exactly ONE place that decides
/// what a NIKATRU theme is made of, whether the caller is the seeded chassis
/// path or the pinned legacy one.
ThemeData _themeFrom({
  required ColorScheme scheme,
  required Brightness brightness,
  required AppThemeX tokens,
  required Color scaffoldBackground,
  required Color ink,
  required Color divider,
}) {
  final ThemeData base = ThemeData(useMaterial3: true, brightness: brightness);
  return base.copyWith(
    scaffoldBackgroundColor: scaffoldBackground,
    colorScheme: scheme,
    textTheme: base.textTheme.apply(
      fontFamily: 'Manrope',
      bodyColor: ink,
      displayColor: ink,
    ),
    splashFactory: InkRipple.splashFactory,
    dividerColor: divider,
    extensions: <ThemeExtension<dynamic>>[tokens],
  );
}

/// The ORIGINAL Subly palette, pinned exactly.
///
/// ⚠️ [pipeline C-11] This is deliberately NOT the chassis path. `apps/subly` was
/// frozen as a legacy rail-prover (39-CHASSIS cut 1), so its colours must not
/// move when the shared builder becomes seed-driven — and the way to guarantee
/// that is to state them here explicitly rather than to leave app-specific
/// constants wired into `buildAppTheme`, where they silently applied to every
/// app in the portfolio.
///
/// A new app must NEVER call this. `buildAppTheme(seed: …)` is the chassis path;
/// reaching for these values is how the portfolio ends up looking like one app
/// published eight times.
class AppTheme {
  AppTheme._();

  /// The original Subly light theme.
  static ThemeData light() => _themeFrom(
        brightness: Brightness.light,
        scheme: ColorScheme.fromSeed(
          seedColor: AppColors.accent,
          primary: AppColors.accent,
          secondary: AppColors.accent2,
          surface: AppColors.surface,
        ),
        tokens: AppThemeX.light,
        scaffoldBackground: AppColors.bg,
        ink: AppColors.ink,
        divider: AppColors.line,
      );

  /// Dark counterpart, from the same pinned tokens.
  static ThemeData dark() => _themeFrom(
        brightness: Brightness.dark,
        scheme: ColorScheme.fromSeed(
          seedColor: AppColors.accent,
          brightness: Brightness.dark,
          primary: AppColors.accent2,
          secondary: AppColors.accent,
        ),
        tokens: AppThemeX.dark,
        scaffoldBackground: AppColors.onboardBg,
        ink: const Color(0xFFF4F4F8),
        divider: const Color(0xFF2A2A38),
      );
}
