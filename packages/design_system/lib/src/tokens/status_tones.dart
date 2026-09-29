import 'package:flutter/material.dart';

import 'brand_tokens.dart';

/// The three statuses a surface can report. The vocabulary every status-aware
/// widget in this package takes — [DecisionStrip], [AppListRow]'s status dot —
/// so a caller names a MEANING and the widget resolves the colour.
enum StatusKind { positive, warn, danger }

/// The SCHEME-FORKED status pairs: a foreground tone and an OPAQUE tint per
/// [StatusKind], one set for light and one for dark (train ST-D0, which
/// absorbs ST-Y1).
///
/// 🔴 WHY THEY FORK. `AppColors.positive`/`warn`/`danger` are one literal per
/// status in both schemes, and `app_colors.dart` records the arithmetic that
/// makes that impossible for TEXT: a colour clearing 4.5:1 on white needs a
/// relative luminance ≤ 0.1833, one clearing 4.5:1 on a dark scaffold needs
/// ≥ 0.2376. So a status painted as a word — "Due tomorrow", "Unused", "Saved
/// ₹649" — is under WCAG 2.2 AA 1.4.3 in one scheme whatever value is chosen.
/// The fix recorded there as owed is this: a light tone and a dark tone,
/// resolved by ambient brightness.
///
/// 🔴 WHY THE TINTS ARE OPAQUE. A `withValues(alpha: .1)` wash composites to a
/// different colour on every ground it lands on, so its contrast with the tone
/// painted over it cannot be measured once and trusted — the shell's selected
/// tab recorded exactly that failure (a 10% wash that took its own label from
/// 4.57:1 to 4.28:1). An opaque tint is one colour everywhere, and
/// `test/status_contrast_test.dart` measures the tone on it.
///
/// ⚠️ THE VALUES ARE NOT TYPED HERE. They come from `contracts/tokens/dtcg/`
/// through the generated [BrandTokens] / [BrandTokensDark], so the websites, the
/// extensions and every stamped app read one status palette. Status is the one
/// part of that contract that IS an app's paint: green means good in every
/// app, so it is not a brand decision a seed should move.
@immutable
class StatusTones {
  const StatusTones({
    required this.positive,
    required this.warn,
    required this.danger,
    required this.positiveTint,
    required this.warnTint,
    required this.dangerTint,
  });

  /// Foreground tone for good news: text, an icon, a dot beside a word.
  final Color positive;

  /// Foreground tone for a warning.
  final Color warn;

  /// Foreground tone for danger and destructive outcomes.
  final Color danger;

  /// Opaque container behind a positive message.
  final Color positiveTint;

  /// Opaque container behind a warning.
  final Color warnTint;

  /// Opaque container behind a danger message.
  final Color dangerTint;

  /// The light-scheme half, from `contracts/tokens/dtcg/color.json`.
  static const StatusTones light = StatusTones(
    positive: BrandTokens.positive,
    warn: BrandTokens.warn,
    danger: BrandTokens.danger,
    positiveTint: BrandTokens.positiveTint,
    warnTint: BrandTokens.warnTint,
    dangerTint: BrandTokens.dangerTint,
  );

  /// The dark-scheme half, from `contracts/tokens/dtcg/color.dark.json`.
  static const StatusTones dark = StatusTones(
    positive: BrandTokensDark.positive,
    warn: BrandTokensDark.warn,
    danger: BrandTokensDark.danger,
    positiveTint: BrandTokensDark.positiveTint,
    warnTint: BrandTokensDark.warnTint,
    dangerTint: BrandTokensDark.dangerTint,
  );

  /// The half for [brightness]. Pure, so a theme builder can call it before
  /// any [BuildContext] exists.
  static StatusTones forBrightness(Brightness brightness) =>
      brightness == Brightness.light ? light : dark;

  /// The half for the ambient theme. The ONE way a widget should read a status
  /// colour: it cannot pick the wrong scheme half, because it does not pick.
  static StatusTones of(BuildContext context) =>
      forBrightness(Theme.of(context).brightness);

  /// The foreground tone for [kind].
  Color toneOf(StatusKind kind) => switch (kind) {
    StatusKind.positive => positive,
    StatusKind.warn => warn,
    StatusKind.danger => danger,
  };

  /// The opaque tint for [kind].
  Color tintOf(StatusKind kind) => switch (kind) {
    StatusKind.positive => positiveTint,
    StatusKind.warn => warnTint,
    StatusKind.danger => dangerTint,
  };
}
