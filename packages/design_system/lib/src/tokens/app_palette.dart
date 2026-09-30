import 'package:flutter/material.dart';

import 'status_tones.dart';

/// THE PALETTE, RESOLVED FOR THE AMBIENT BRIGHTNESS — train ST-D0 label D0-2,
/// landed by the D0 residue (fix-rv2-d0-residue, 2026-09-29).
///
/// ```dart
/// final AppPalette p = AppPalette.of(context);
/// Container(color: p.surface, child: Text('…', style: TextStyle(color: p.ink)));
/// ```
///
/// 🔴 WHY IT EXISTS. `AppColors` is one `const` per name, painted in BOTH
/// brightnesses. Every name that is a NEUTRAL (a ground, a hairline, a text
/// tone) is therefore right in one scheme and wrong in the other, and the tree
/// grew a private brightness fork per screen to cope — the app's
/// `neutrals(context)`, `cardDecoration`'s `isLight ?` branch, `SoftButton`'s,
/// `RowCard`'s. The ones nobody forked stayed wrong in dark, and the round-2
/// review measured them:
///  * **D7** — the settings switch's OFF track was the literal `#E2E2EA` on a
///    white card: **1.3:1**, so an off switch had no visible boundary (WCAG
///    2.2 SC 1.4.11 owes 3:1 to a control's state-identifying part).
///  * **B50** — the glyph tile painted `AppColors.accent` ink in dark too, and
///    ringed its status dot in `AppColors.surface` — a WHITE ring on a dark
///    card.
/// One extension, resolved once per theme, is the fork every screen was
/// re-deriving; a widget that reads it cannot pick the wrong half, because it
/// does not pick.
///
/// ## Where each value comes from — no new colour is typed here
///  * **light neutrals** are the Subly literals `AppColors` has always carried
///    ([lightBg] … [lightLine]); the light build is what the owner eyeballs, so
///    it stays byte-identical. `AppColors.bg`/`surface`/`ink`/`muted`/`line`
///    are now DEPRECATED ALIASES of these, kept for one release so the brick
///    and every stamped app migrate without breakage.
///  * **dark neutrals** are the seeded scheme's own slots — the same ones
///    `buildAppTheme` already maps its ink and divider to and the app's
///    `cardDecoration` paints its dark card with.
///  * **status** is [StatusTones] — the DTCG pairs in
///    `contracts/tokens/dtcg/color*.json`, generated into `BrandTokens`.
///  * **accent** is the brand SEED, as a FILL. [accentInk] is the same hue as a
///    FOREGROUND, and it is CONTRAST-AWARE: the seed when it clears 4.5:1 on
///    [surface], else the scheme's `primary` (the seed's tone that does).
///  * **control** is the first of `outline`, `onSurfaceVariant` that clears
///    3:1 on [surface] — the state-identifying boundary of a switch, a check
///    box, a radio when OFF.
///
/// ⚠️ NOT HERE, AND WHY. D0-2's row also moves the `ColorScheme` itself onto
/// DTCG instead of `fromSeed`. That repaints every screen of every stamped app
/// at once (every golden, the owner-eyeballed light build) and is an
/// owner-visible re-skin, not a residue fix; it stays with the design owner.
@immutable
class AppPalette extends ThemeExtension<AppPalette> {
  const AppPalette({
    required this.brightness,
    required this.bg,
    required this.surface,
    required this.ink,
    required this.muted,
    required this.line,
    required this.accent,
    required this.accentInk,
    required this.control,
    required this.status,
  });

  /// Page ground (light; dark reads `scheme.surface`).
  static const Color lightBg = Color(0xFFF4F4F8);

  /// Card fill (light; dark reads `scheme.surfaceContainerHighest`).
  static const Color lightSurface = Color(0xFFFFFFFF);

  /// Primary text (light; dark reads `scheme.onSurface`).
  static const Color lightInk = Color(0xFF141420);

  /// Secondary prose (light; dark reads `scheme.onSurfaceVariant`). The
  /// #6F6F7B measurement is on `AppColors.muted`.
  static const Color lightMuted = Color(0xFF6F6F7B);

  /// Decorative hairline (light; dark reads `scheme.outlineVariant`). Exempt
  /// from 1.4.11 because it identifies no state — never use it for [control].
  static const Color lightLine = Color(0xFFECECF2);

  /// WCAG 2.2 SC 1.4.11: a control's state-identifying part owes 3:1.
  static const double nonTextMinimum = 3;

  /// WCAG 2.2 SC 1.4.3: normal-size text owes 4.5:1.
  static const double textMinimum = 4.5;

  /// Which half this is.
  final Brightness brightness;

  /// The page ground.
  final Color bg;

  /// A card's fill — the ground most content sits on.
  final Color surface;

  /// Primary text on [surface] and [bg].
  final Color ink;

  /// Secondary text on [surface] and [bg].
  final Color muted;

  /// A decorative hairline. Identifies no state.
  final Color line;

  /// The brand as a FILL (a selected switch track, a primary button).
  final Color accent;

  /// The brand as a FOREGROUND — a glyph, a word, an icon — on [surface].
  final Color accentInk;

  /// A control's boundary in its OFF state: >= [nonTextMinimum] on [surface].
  final Color control;

  /// The DTCG status pairs for this half.
  final StatusTones status;

  /// The palette for [scheme]. [seed] is the brand as the app declared it
  /// (`buildAppTheme`'s `seed`); null reads `scheme.primary`.
  factory AppPalette.fromScheme(ColorScheme scheme, {Color? seed}) {
    final bool isLight = scheme.brightness == Brightness.light;
    final Color surface = isLight
        ? lightSurface
        : scheme.surfaceContainerHighest;
    final Color accent = seed ?? scheme.primary;
    return AppPalette(
      brightness: scheme.brightness,
      bg: isLight ? lightBg : scheme.surface,
      surface: surface,
      ink: isLight ? lightInk : scheme.onSurface,
      muted: isLight ? lightMuted : scheme.onSurfaceVariant,
      line: isLight ? lightLine : scheme.outlineVariant,
      accent: accent,
      accentInk: firstClearing(
        <Color>[accent, scheme.primary, scheme.onSurface],
        on: surface,
        minimum: textMinimum,
      ),
      control: firstClearing(
        <Color>[scheme.outline, scheme.onSurfaceVariant, scheme.onSurface],
        on: surface,
        minimum: nonTextMinimum,
      ),
      status: StatusTones.forBrightness(scheme.brightness),
    );
  }

  /// The palette for the ambient theme: the installed extension
  /// (`buildAppTheme` and `AppTheme` install one), else one derived from the
  /// ambient scheme, so a bare `ThemeData` still resolves both halves.
  static AppPalette of(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    return theme.extension<AppPalette>() ??
        AppPalette.fromScheme(theme.colorScheme);
  }

  /// The first of [candidates] reaching [minimum] against [on]; the last one
  /// when none does (`onSurface`, the scheme's own maximum-contrast tone).
  /// Public and pure so the rule is testable without a widget.
  static Color firstClearing(
    List<Color> candidates, {
    required Color on,
    required double minimum,
  }) {
    for (final Color c in candidates) {
      if (contrastRatio(c, on) >= minimum) return c;
    }
    return candidates.last;
  }

  /// WCAG 2.2 contrast ratio of two OPAQUE colours.
  static double contrastRatio(Color a, Color b) {
    final double la = a.computeLuminance();
    final double lb = b.computeLuminance();
    final double hi = la > lb ? la : lb;
    final double lo = la > lb ? lb : la;
    return (hi + 0.05) / (lo + 0.05);
  }

  @override
  AppPalette copyWith({
    Color? bg,
    Color? surface,
    Color? ink,
    Color? muted,
    Color? line,
    Color? accent,
    Color? accentInk,
    Color? control,
    StatusTones? status,
  }) {
    return AppPalette(
      brightness: brightness,
      bg: bg ?? this.bg,
      surface: surface ?? this.surface,
      ink: ink ?? this.ink,
      muted: muted ?? this.muted,
      line: line ?? this.line,
      accent: accent ?? this.accent,
      accentInk: accentInk ?? this.accentInk,
      control: control ?? this.control,
      status: status ?? this.status,
    );
  }

  @override
  AppPalette lerp(covariant ThemeExtension<AppPalette>? other, double t) {
    if (other is! AppPalette) return this;
    return AppPalette(
      brightness: t < 0.5 ? brightness : other.brightness,
      bg: Color.lerp(bg, other.bg, t)!,
      surface: Color.lerp(surface, other.surface, t)!,
      ink: Color.lerp(ink, other.ink, t)!,
      muted: Color.lerp(muted, other.muted, t)!,
      line: Color.lerp(line, other.line, t)!,
      accent: Color.lerp(accent, other.accent, t)!,
      accentInk: Color.lerp(accentInk, other.accentInk, t)!,
      control: Color.lerp(control, other.control, t)!,
      // The status pairs are measured as PAIRS; a blend of two is neither.
      status: t < 0.5 ? status : other.status,
    );
  }
}
