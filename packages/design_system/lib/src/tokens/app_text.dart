import 'package:flutter/material.dart';

import 'app_colors.dart';

/// The six named styles resolved for ONE brightness — what [AppText.of] hands
/// back.
///
/// It is a plain value object rather than a `ThemeExtension` on purpose; see
/// the "why not a ThemeExtension" note on [AppText.of].
@immutable
class AppTextStyles {
  const AppTextStyles({
    required this.display,
    required this.title,
    required this.fig,
    required this.body,
    required this.muted,
    required this.label,
  });

  final TextStyle display;
  final TextStyle title;
  final TextStyle fig;
  final TextStyle body;
  final TextStyle muted;
  final TextStyle label;
}

/// Named text styles matching the design (Manrope body, Space Grotesk numerals).
///
/// ─────────────────────────────────────────────────────────────────────────────
/// 🔴 P4·TEXT — THE ROOT CAUSE THREE INDEPENDENT DARK-MODE BUILDERS LANDED ON.
///
/// Every style below bakes [AppColors.ink] or [AppColors.muted] into a `const`
/// [TextStyle]. `AppColors.ink` is `0xFF141420` — near-black. So the moment
/// `app.dart` started supplying a `darkTheme`, EVERY line of prose in the app
/// stayed near-black on a near-black scaffold, and the only per-screen remedy
/// was a `copyWith(color: …)` at each of the 105 call sites in `apps/subly/lib`
/// (muted 38 · body 20 · fig 18 · title 16 · label 12 · display 1) plus the 2 in
/// the app brick. That is not a screen bug repeated 105 times; it is one token
/// bug seen 105 times.
///
/// 🔒 THE CONST STYLES DO NOT MOVE. They stay exactly as shipped — same fields,
/// same literals, same `const`-ness — for two independent reasons:
///   1. `apps/subly` is the frozen legacy rail-prover and the owner eyeballs the
///      LIGHT build. Re-pointing `color:` at a scheme slot here would repaint
///      every screen at once, which is the repaint `app.dart`'s theme-fork note
///      exists to avoid.
///   2. They are `const`, and 107 call sites depend on that. A non-const style
///      cannot be used in a `const` widget constructor, so "just make it a
///      getter" is a compile break across the whole tree.
///
/// ✅ THE SEAM IS ADDITIVE: [AppText.of] returns the same six names resolved for
/// the ambient brightness. In LIGHT it returns THE CONST OBJECTS THEMSELVES —
/// `identical(AppText.of(context).title, AppText.title)` is true — so a call
/// site that migrates renders byte-identically in light and correctly in dark.
/// Nothing is repainted by adopting it, which is what lets it be adopted one
/// widget at a time instead of in one 105-file sweep.
/// ─────────────────────────────────────────────────────────────────────────────
class AppText {
  AppText._();

  static const TextStyle display = TextStyle(
    fontFamily: 'Space Grotesk',
    fontWeight: FontWeight.w700,
    letterSpacing: -1.0,
    height: 1.03,
    color: AppColors.ink,
  );

  static const TextStyle title = TextStyle(
    fontFamily: 'Space Grotesk',
    fontWeight: FontWeight.w700,
    letterSpacing: -0.4,
    color: AppColors.ink,
  );

  /// Tabular figures for money / dates.
  static const TextStyle fig = TextStyle(
    fontFamily: 'Space Grotesk',
    fontWeight: FontWeight.w600,
    letterSpacing: -0.3,
    color: AppColors.ink,
    fontFeatures: <FontFeature>[FontFeature.tabularFigures()],
  );

  static const TextStyle body = TextStyle(
    fontFamily: 'Manrope',
    fontWeight: FontWeight.w500,
    color: AppColors.ink,
  );

  static const TextStyle muted = TextStyle(
    fontFamily: 'Manrope',
    fontWeight: FontWeight.w500,
    color: AppColors.muted,
  );

  static const TextStyle label = TextStyle(
    fontFamily: 'Manrope',
    fontWeight: FontWeight.w700,
    fontSize: 11,
    letterSpacing: 0.8,
    color: AppColors.muted,
  );

  /// The LIGHT set — the const styles themselves, deliberately not copies.
  ///
  /// Returning the very same objects makes the light guarantee `identical`
  /// rather than "equal", which is the only version of "byte-identical" that
  /// cannot drift: a future edit that rebuilds light through `copyWith` would
  /// still compare equal today and could silently change tomorrow.
  static const AppTextStyles _light = AppTextStyles(
    display: display,
    title: title,
    fig: fig,
    body: body,
    muted: muted,
    label: label,
  );

  /// The six styles resolved for the brightness of [context]'s theme.
  ///
  /// ⚠️ WHY THIS AND NOT A `ThemeExtension`. A text extension would have to be
  /// registered inside `buildAppTheme`/`AppTheme`, and the values it carries in
  /// the light case ARE [AppColors] — so registering it puts app-specific
  /// constants back into the shared builder, which is precisely the defect
  /// [pipeline C-11] removed (`theme_test.dart` pins that they must differ).
  /// A static resolver needs no registration at all, so:
  ///   · nothing in `build_app_theme.dart` changes, and the C-11 split stays
  ///     provably intact;
  ///   · a stamped app that builds its `ThemeData` some other way still gets
  ///     correct text — there is no extension to forget and no `!` to crash on.
  static AppTextStyles of(BuildContext context) => resolve(Theme.of(context));

  /// [of] without a [BuildContext] — the same resolution, so a test can assert
  /// it without pumping a widget and a caller that already holds the
  /// [ThemeData] need not go back to the element tree.
  static AppTextStyles resolve(ThemeData theme) =>
      theme.brightness == Brightness.light
          ? _light
          : _darkFrom(theme.colorScheme);

  /// The DARK set, DERIVED from the scheme — never a second pinned literal.
  ///
  /// Two slots, mapped semantically rather than by taste:
  ///   · the four ink-coloured styles → `scheme.onSurface`, the slot M3
  ///     guarantees is legible on `scheme.surface` (what `buildAppTheme` sets
  ///     the scaffold to);
  ///   · the two [AppColors.muted] styles → `scheme.onSurfaceVariant`, the
  ///     secondary-prose slot. This is the SAME choice `AppThemeX.fromScheme`
  ///     already makes for its `muted` token, so the two cannot drift apart.
  ///
  /// Deriving (rather than pinning a dark ink literal) is what keeps a stamped
  /// app's prose following its `seed_hex`: the M3 neutral palette is hue-tinted
  /// by the seed, so a red-seeded app and a green-seeded app get measurably
  /// different dark prose. Pinning one dark grey here would re-freeze in the
  /// dark branch exactly the property C-11 unfroze in the light one.
  ///
  /// `copyWith` — not a fresh `TextStyle` — so `fig` keeps its tabular figures
  /// and `label` keeps its 11px/0.8 tracking. Rebuilding the styles from scratch
  /// would silently drop both.
  static AppTextStyles _darkFrom(ColorScheme scheme) => AppTextStyles(
        display: display.copyWith(color: scheme.onSurface),
        title: title.copyWith(color: scheme.onSurface),
        fig: fig.copyWith(color: scheme.onSurface),
        body: body.copyWith(color: scheme.onSurface),
        muted: muted.copyWith(color: scheme.onSurfaceVariant),
        label: label.copyWith(color: scheme.onSurfaceVariant),
      );
}
