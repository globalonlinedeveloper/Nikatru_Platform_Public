import 'package:flutter/material.dart';

import '../tokens/app_colors.dart';

/// Brand tokens that don't map cleanly onto [ColorScheme] — status colours,
/// the muted/line neutrals, the brand + hero gradients and the category ramp.
///
/// Read them anywhere with `Theme.of(context).extension<AppThemeX>()!`.
@immutable
class AppThemeX extends ThemeExtension<AppThemeX> {
  const AppThemeX({
    required this.positive,
    required this.warn,
    required this.danger,
    required this.muted,
    required this.line,
    required this.brandGradient,
    required this.heroGradient,
    required this.categoryRamp,
  });

  final Color positive;
  final Color warn;
  final Color danger;
  final Color muted;
  final Color line;
  final Gradient brandGradient;
  final Gradient heroGradient;
  final List<Color> categoryRamp;

  /// Brand tokens DERIVED from a seeded [ColorScheme] — [pipeline C-11].
  ///
  /// 🔴 WHY THIS EXISTS. [light] and [dark] below are `const`, so every stamped
  /// app inherited the same gradients and the same category ramp no matter what
  /// `seed_hex` it was stamped with. Measured 2026-07-28: a red-seeded app and a
  /// green-seeded app produced a byte-identical `brandGradient` and ramp — the
  /// brand input moved nothing that a user actually looks at.
  ///
  /// That is not cosmetic. Both stores treat near-identical apps as spam, Play
  /// enforcement extends to RELATED ACCOUNTS, and L21 stakes the whole portfolio
  /// on a single store identity — so one clone-flag is a portfolio-wide event.
  ///
  /// Status colours (positive/warn/danger) deliberately do NOT derive: green
  /// means good and red means danger in every app, and re-hueing them from a
  /// brand seed would trade a universal signal for a decoration.
  factory AppThemeX.fromScheme(
    ColorScheme scheme, {
    Brightness brightness = Brightness.light,
  }) {
    final bool isLight = brightness == Brightness.light;
    return AppThemeX(
      positive: AppColors.positive,
      warn: AppColors.warn,
      danger: AppColors.danger,
      muted: scheme.onSurfaceVariant,
      line: scheme.outlineVariant,
      brandGradient: LinearGradient(
        begin: Alignment.topLeft,
        end: Alignment.bottomRight,
        colors: <Color>[scheme.primary, scheme.tertiary],
      ),
      heroGradient: LinearGradient(
        begin: Alignment.topLeft,
        end: Alignment.bottomRight,
        colors: isLight
            ? <Color>[
                scheme.primaryContainer,
                scheme.secondaryContainer,
                scheme.tertiaryContainer,
              ]
            : <Color>[
                scheme.surfaceContainerLowest,
                scheme.primaryContainer,
                scheme.tertiaryContainer,
              ],
        stops: const <double>[0.0, 0.7, 1.0],
      ),
      // The ramp needs eight visually separable colours. Rotating the seed's hue
      // keeps them separable AND tied to the brand; taking eight slots off one
      // Material palette would give eight tints of the same hue, which is
      // useless for a category legend.
      categoryRamp: List<Color>.generate(8, (int i) {
        final HSLColor base = HSLColor.fromColor(scheme.primary);
        return base
            .withHue((base.hue + i * 45.0) % 360.0)
            .withSaturation(base.saturation.clamp(0.45, 0.85))
            .withLightness(isLight ? 0.55 : 0.65)
            .toColor();
      }),
    );
  }

  /// Light-mode brand tokens (the original Subly values).
  ///
  /// ⚠️ These stay `const` ON PURPOSE — they are the LEGACY PIN that keeps
  /// `apps/subly` rendering byte-for-byte as shipped (39-CHASSIS cut 1 froze it
  /// as a rail-prover). They are reached only through [AppTheme.light]/[dark];
  /// the chassis path builds tokens with [AppThemeX.fromScheme]. Do NOT wire
  /// these back into `buildAppTheme` — that is the defect C-11 fixed.
  static const AppThemeX light = AppThemeX(
    positive: AppColors.positive,
    warn: AppColors.warn,
    danger: AppColors.danger,
    muted: AppColors.muted,
    line: AppColors.line,
    brandGradient: AppColors.brandGradient,
    heroGradient: AppColors.heroGradient,
    categoryRamp: AppColors.ramp,
  );

  /// Dark-mode brand tokens — same accents, a darker divider neutral.
  static const AppThemeX dark = AppThemeX(
    positive: AppColors.positive,
    warn: AppColors.warn,
    danger: AppColors.danger,
    muted: AppColors.muted,
    line: Color(0xFF2A2A38),
    brandGradient: AppColors.brandGradient,
    heroGradient: AppColors.heroGradient,
    categoryRamp: AppColors.ramp,
  );

  @override
  AppThemeX copyWith({
    Color? positive,
    Color? warn,
    Color? danger,
    Color? muted,
    Color? line,
    Gradient? brandGradient,
    Gradient? heroGradient,
    List<Color>? categoryRamp,
  }) {
    return AppThemeX(
      positive: positive ?? this.positive,
      warn: warn ?? this.warn,
      danger: danger ?? this.danger,
      muted: muted ?? this.muted,
      line: line ?? this.line,
      brandGradient: brandGradient ?? this.brandGradient,
      heroGradient: heroGradient ?? this.heroGradient,
      categoryRamp: categoryRamp ?? this.categoryRamp,
    );
  }

  @override
  AppThemeX lerp(covariant ThemeExtension<AppThemeX>? other, double t) {
    if (other is! AppThemeX) {
      return this;
    }
    return AppThemeX(
      positive: Color.lerp(positive, other.positive, t)!,
      warn: Color.lerp(warn, other.warn, t)!,
      danger: Color.lerp(danger, other.danger, t)!,
      muted: Color.lerp(muted, other.muted, t)!,
      line: Color.lerp(line, other.line, t)!,
      brandGradient:
          Gradient.lerp(brandGradient, other.brandGradient, t) ?? brandGradient,
      heroGradient:
          Gradient.lerp(heroGradient, other.heroGradient, t) ?? heroGradient,
      categoryRamp: t < 0.5 ? categoryRamp : other.categoryRamp,
    );
  }
}
