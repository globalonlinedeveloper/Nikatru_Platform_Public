import 'package:flutter/material.dart';

import '../tokens/app_spacing.dart';
import '../tokens/status_tones.dart';
import 'app_card.dart';
import 'sensitive.dart';

/// The chassis FIGURE TILE — one labelled figure on its own card: a price, a
/// next-charge date, a total (train ST-D5).
///
/// ```
/// ┌───────────────────┐
/// │ LABEL             │
/// │ 15.49             │
/// │ ● caption         │
/// └───────────────────┘
/// ```
///
/// ## What it fixes by construction
///  * **Nothing under the 12 px floor.** The label is the ramp's
///    `labelMedium` (12) and the caption its `bodySmall` (12). The
///    hand-rolled tiles this replaces painted both at 10.
///  * **The figure is tabular**, so two tiles side by side, or one tile over
///    the next month's, line their digits up.
///  * **A status is a word first and a colour second**, as on [AppListRow]:
///    [status] paints [caption] in the [StatusTones] tone for the ambient
///    scheme with a dot before it, and the caption is required with it.
///  * **One node.** Label, figure and caption are merged, so a reader hears
///    "Next charge, Jul 22, Renews tomorrow" once, not three fragments.
///  * **It wraps, it never overflows.** Every line may take a second line
///    under a large text scale or a long translation; nothing is ellipsised,
///    because the part a tile would cut is the figure it exists to show.
///
/// Every string is the app's, already localised.
class AppFigureTile extends StatelessWidget {
  const AppFigureTile({
    super.key,
    required this.label,
    required this.figure,
    this.caption,
    this.status,
  }) : assert(
         status == null || caption != null,
         'a status needs its caption: it is carried by the words, then the '
         'colour',
       );

  /// What the figure is, e.g. "Price".
  final String label;

  /// The figure, e.g. "15.49" or "Jul 22".
  final String figure;

  /// A small line under the figure, e.g. "per month" or "Renews tomorrow".
  final String? caption;

  /// Paints [caption] in this status's tone, with a dot before it.
  final StatusKind? status;

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    final ColorScheme scheme = theme.colorScheme;
    final TextTheme text = theme.textTheme;
    final StatusKind? kind = status;
    final Color? tone = kind == null
        ? null
        : StatusTones.of(context).toneOf(kind);
    final String? under = caption;
    return AppCard(
      padding: const EdgeInsets.all(AppSpacing.md),
      child: MergeSemantics(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            Text(
              label,
              style: text.labelMedium?.copyWith(color: scheme.onSurfaceVariant),
            ),
            const SizedBox(height: AppSpacing.xs),
            // A figure is often money: private in a problem report (Sensitive).
            Sensitive(
              child: Text(
                figure,
                style: text.titleLarge?.copyWith(
                  color: scheme.onSurface,
                  fontWeight: FontWeight.w700,
                  fontFeatures: const <FontFeature>[
                    FontFeature.tabularFigures(),
                  ],
                ),
              ),
            ),
            if (under != null)
              Row(
                children: <Widget>[
                  if (tone != null) ...<Widget>[
                    ExcludeSemantics(
                      child: Container(
                        width: AppSpacing.sm,
                        height: AppSpacing.sm,
                        decoration: BoxDecoration(
                          color: tone,
                          shape: BoxShape.circle,
                        ),
                      ),
                    ),
                    const SizedBox(width: AppSpacing.xs),
                  ],
                  Flexible(
                    child: Text(
                      under,
                      style: text.bodySmall?.copyWith(
                        color: tone ?? scheme.onSurfaceVariant,
                        fontWeight: tone == null ? null : FontWeight.w600,
                      ),
                    ),
                  ),
                ],
              ),
          ],
        ),
      ),
    );
  }
}
