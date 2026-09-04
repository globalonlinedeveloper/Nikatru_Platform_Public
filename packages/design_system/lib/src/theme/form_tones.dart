import 'package:flutter/material.dart';

import '../tokens/app_colors.dart';

/// The six neutral colours a hand-painted form paints with, resolved for the
/// current brightness.
///
/// MOVED HERE FROM `apps/subly/lib/features/auth/login_screen.dart` on
/// 2026-09-04 ([ADR 065], chassis step 2). It was a private `_tones` helper on
/// one screen in one app and it is neither app-specific nor screen-specific:
/// every hand-painted form in the portfolio needs exactly this resolution, and
/// the app brick had **no copy of it at all**, which is why a stamped app's
/// auth screens are plain Material with none of the reasoning below applied.
/// Nothing about the values changed in the move — see the two notes below,
/// which are the reason the values are what they are.
///
/// 🔴 LIGHT IS THE LITERAL TOKEN, NOT `scheme.<slot>`, AND THAT IS THE WHOLE
/// SHAPE OF THIS FUNCTION — the same rule `cardDecoration` and `RowCard` are
/// written to. `apps/subly` is the frozen legacy rail-prover the owner eyeballs,
/// so light must come out byte-identical to the twelve `AppColors.*` references
/// this replaced; a "tidy-up" to `scheme.surface` in the light arm would
/// repaint the login screen while every assertion comparing scheme-to-scheme
/// kept passing.
///
/// 🔴 AND THE DARK ARM IS NOT COSMETIC. `app.dart` supplies a `darkTheme`, so
/// every user on a dark-mode OS lands here — and with the tokens hardcoded that
/// meant `AppColors.bg` (#F4F4F8, near-white) behind `AppColors.ink` (#141420,
/// near-black) inside dark chassis chrome. Not "slightly off": a white sheet in
/// a dark app, and, had only the surfaces been fixed, near-black headings on a
/// near-black scaffold. Both halves move together or neither is worth doing,
/// which is why [ink] and [muted] are in here beside the surfaces rather than
/// left to `AppText`'s const styles.
///
/// [AppText.title], [AppText.body], [AppText.muted] and [AppText.label] each
/// bake `AppColors.ink` / `AppColors.muted` into a `const TextStyle`, so the
/// only place a screen can correct them is at the call site, with `copyWith`.
/// In LIGHT the value copied in is the value that was already there.
typedef FormTones = ({
  Color bg,
  Color surface,
  Color line,
  Color ink,
  Color muted,
  Color accent,
  Color danger,
});

/// Resolve [FormTones] for the ambient theme. Read the type's doc first — the
/// two arms are asymmetric on purpose and neither is a default for the other.
FormTones formTones(BuildContext context) {
  final ThemeData theme = Theme.of(context);
  if (theme.brightness == Brightness.light) {
    return (
      bg: AppColors.bg,
      surface: AppColors.surface,
      line: AppColors.line,
      ink: AppColors.ink,
      muted: AppColors.muted,
      accent: AppColors.accent,
      danger: AppColors.danger,
    );
  }
  final ColorScheme scheme = theme.colorScheme;
  return (
    // The scaffold is `scheme.surface` because that is exactly what
    // `buildAppTheme` sets `scaffoldBackgroundColor` to — the screen agreeing
    // with the theme rather than inventing a second answer.
    bg: scheme.surface,
    // `surfaceContainerHighest` is the slot `cardDecoration` and `RowCard`
    // already chose: the lightest container step, so a field or a card lifts off
    // the scaffold by the widest margin the scheme offers.
    surface: scheme.surfaceContainerHighest,
    line: scheme.outlineVariant,
    ink: scheme.onSurface,
    muted: scheme.onSurfaceVariant,
    accent: scheme.primary,
    danger: scheme.error,
  );
}
