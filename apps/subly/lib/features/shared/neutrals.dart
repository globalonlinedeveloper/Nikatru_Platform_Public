import 'package:flutter/material.dart';

import '../../core/theme/app_colors.dart';

/// The neutral text and hairline tones this app paints with, resolved for the
/// ambient brightness. Shared by Budget, Calendar and Insights.
///
/// 🔴 LIGHT IS THE LITERAL TOKEN, ON PURPOSE — the rule `cardDecoration` and
/// `RowCard` carry (`features/shared/widgets.dart`): `apps/subly` is the frozen
/// legacy rail-prover the owner eyeballs, so the light branch stays
/// byte-identical to the pre-dark screens.
/// `Theme.of(context).extension<AppThemeX>()` is NOT a substitute — under the
/// seeded chassis theme its `muted`/`line` are `scheme.onSurfaceVariant`/
/// `outlineVariant` in BOTH brightnesses, so reading it would repaint every
/// muted line and every hairline in the light build.
///
/// 🔴 DARK IS THE DEFECT THIS FIXES. `AppText.title`/`.fig`/`.body` bake
/// `AppColors.ink` (#141420), `AppText.muted`/`.label` bake `AppColors.muted`,
/// and Insights' unused-subscription rows are outlined in `AppColors.line`
/// (#ECECF2) — a near-white hairline. On a dark scaffold
/// (`buildAppTheme(brightness: dark)` sets it to `scheme.surface`) the ring
/// percentage, the stats, the category names and both card titles were
/// near-black on near-black, and the row outlines glared. The dark values are
/// the SAME slots `buildAppTheme` itself maps these neutrals to
/// (`ink: scheme.onSurface`, `divider: scheme.outlineVariant`) and that
/// `AppThemeX.fromScheme` maps `muted` to (`scheme.onSurfaceVariant`), so this
/// derives from the seed rather than inventing a colour.
///
/// ── THE HOIST, 2026-08-25 ─────────────────────────────────────────────────
/// 📌 THIS FILE IS THE CLOSING CLEANUP THE THREE COPIES NAMED. Until today
/// `budget_screen.dart`, `calendar_screen.dart` and `insights_screen.dart` each
/// carried a private `_neutrals(BuildContext)`, and each said in its own doc
/// that the triplication was deliberate for one increment — every P4 file-group
/// increment had to stay independently compilable — and that the hoist into
/// `features/shared/` belonged to the closing cleanup alongside the deletion of
/// `DueInfo.of`. Both halves landed together, in the same change.
///
/// ⚠️ THE THREE COPIES WERE NOT IDENTICAL, AND THE DIFFERENCE IS WHY THIS
/// RETURNS THREE FIELDS. Budget's and Insights' copies returned
/// `({Color ink, Color muted, Color line})` byte-identically; Calendar's
/// returned `({Color ink, Color muted})` — it paints no hairline of its own, so
/// it never needed the third slot. Unifying on the WIDER record and letting
/// Calendar ignore `line` is the merge that keeps one answer to one question. A
/// second, narrower overload beside this one would put the tree straight back
/// where it started: two spellings of one rule, and the one nobody re-measures
/// is the one that drifts. `line` is derived from the same `theme` in the same
/// two branches as `ink` and `muted`, so computing it for a caller that drops it
/// costs one field read and cannot disagree with anything.
({Color ink, Color muted, Color line}) neutrals(BuildContext context) {
  final ThemeData theme = Theme.of(context);
  if (theme.brightness == Brightness.light) {
    return (ink: AppColors.ink, muted: AppColors.muted, line: AppColors.line);
  }
  final ColorScheme scheme = theme.colorScheme;
  return (
    ink: scheme.onSurface,
    muted: scheme.onSurfaceVariant,
    line: scheme.outlineVariant,
  );
}
