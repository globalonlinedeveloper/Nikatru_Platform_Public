import 'package:flutter/material.dart';

import '../tokens/app_colors.dart';
import '../tokens/brand_tokens.dart';
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
  // O-DESKTOP-TAP-TARGETS-BELOW-48. The button themes keep the standard
  // density on every platform; the global `visualDensity` stays the platform's
  // own (compact on the desktop three), which is what RowCard's pointer layout
  // reads. Measured under the five-platform sweeps, 2026-09-25: with `padded`
  // alone a desktop FilledButton, OutlinedButton, TextButton or SegmentedButton
  // segment was 40 tall (the padded minimum is 48 plus the density's
  // adjustment, and compact takes 8 off); with the standard density here it
  // is 48. Checkbox and the icon buttons, 40x40 on the desktop three before,
  // reach 48 from `padded` alone.
  const ButtonStyle standardDensity = ButtonStyle(
    visualDensity: VisualDensity.standard,
  );
  final ThemeData base = ThemeData(
    useMaterial3: true,
    brightness: brightness,
    // O-DESKTOP-TAP-TARGETS-BELOW-48. The platform default is `shrinkWrap` on
    // linux, macOS and windows, which left Checkbox, Radio and IconButton hit
    // areas under 48 there; android and iOS already default to `padded`.
    materialTapTargetSize: MaterialTapTargetSize.padded,
    filledButtonTheme: const FilledButtonThemeData(style: standardDensity),
    outlinedButtonTheme: const OutlinedButtonThemeData(style: standardDensity),
    segmentedButtonTheme: const SegmentedButtonThemeData(
      style: standardDensity,
    ),
    textButtonTheme: const TextButtonThemeData(style: standardDensity),
  );
  return base.copyWith(
    scaffoldBackgroundColor: scaffoldBackground,
    colorScheme: scheme,
    textTheme: base.textTheme.apply(
      // The APP-WIDE text face, and it is a brand fact, so it is read from the
      // contract rather than typed. It was the literal `'Manrope'` until
      // 2026-09-05, one line away from `app_text.dart`, which had already been
      // repointed — so a change to contracts/tokens/dtcg/font.json would have
      // moved the six named styles and left every unnamed Material style on the
      // old face. Half a repaint is worse than none: it looks deliberate.
      fontFamily: BrandTokens.fontBody,
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
/// ⚠️ [pipeline C-11] This is deliberately NOT the chassis path. Subly's
/// colours must not move when the shared builder becomes seed-driven — and the
/// way to guarantee that is to state them here explicitly rather than to leave
/// app-specific constants wired into `buildAppTheme`, where they silently
/// applied to every app in the portfolio.
///
/// 📌 PREMISE CORRECTED 2026-08-21 — the paragraph above used to carry its
/// warrant as *"`apps/subscriptiontracker` was frozen as a legacy rail-prover (39-CHASSIS
/// cut 1)"*. THAT PREMISE IS DEAD, and it was already dead when this comment was
/// written. `Private/decisions/036-subly-freeze-dissolved-by-owner-order.md`
/// dissolves cut 1 by owner order of 2026-08-08: *"Subly stops being a frozen
/// legacy rail-prover and becomes the active commercial product"*. Subly is the
/// shipping product, live on the web — read nothing below as a freeze.
///
/// ONLY THE PREMISE CHANGED; THE PIN IS UNTOUCHED. Its real warrant is the token
/// discipline restated above, which never depended on the freeze: an
/// app-specific constant left in the chassis path paints the WHOLE portfolio,
/// which is the store-survival problem the C-11 note at the top of this file
/// measures. `Private/decisions/037-subly-is-re-stamped-not-retrofitted.md`
/// reinforces it — that is the same escape clause's binding second half,
/// *"re-stamp it from the brick; do not retrofit it"*. Retrofitting
/// `buildAppTheme` to serve Subly is exactly the move both halves forbid, so
/// these values stay here and stay pinned until the re-stamp replaces them.
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
