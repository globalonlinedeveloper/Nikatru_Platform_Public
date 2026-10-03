import 'package:flutter/material.dart';

import '../tokens/app_spacing.dart';
import 'app_card.dart';
import 'sensitive.dart';

/// One labelled figure in an [AppSummaryCard]'s stat row.
@immutable
class SummaryStat {
  const SummaryStat({required this.label, required this.value});

  /// What the figure is, e.g. "Due in 7 days".
  final String label;

  /// The figure, already formatted.
  final String value;
}

/// The DASHBOARD SUMMARY — the one figure a screen is about, what qualifies
/// it, and the two or three figures that sit under it (train ST-D1).
///
/// ```
/// MONTHLY SPEND
/// $93.47
/// (6 active) ($1,121 / yr)
/// ───────────────────────────────
/// Due in 7 days     Due in 30 days
/// $15.99            $61.97
/// ```
///
/// ## What it fixes by construction
///  * **It is an [AppCard], not a brand-gradient slab.** The app's first hero
///    was three fixed near-black purples with white text and five
///    `rgba(255,255,255,…)` literals, identical in both schemes — a surface the
///    theme could not reach and no contrast test could measure against a slot.
///    Here every colour is a scheme slot, so both schemes are the design and
///    `test/app_summary_card_test.dart` measures every word on its ground.
///  * **The figure is tabular and scales down rather than overflowing.** At a
///    200 % text scale on a 360 px phone a currency figure is wider than the
///    card; it shrinks to fit (`FittedBox.scaleDown`) instead of clipping the
///    digits that matter most.
///  * **Label and figure are ONE node** — "Monthly spend, $93.47" — so a
///    reader hears the number with its meaning, not a bare number.
///  * **Facts are read-only chips** in the `secondaryContainer` pair, which
///    the seeded scheme derives for contrast. No button role: they do nothing.
///
/// Every string is the app's, already localised and formatted.
class AppSummaryCard extends StatelessWidget {
  const AppSummaryCard({
    super.key,
    required this.label,
    required this.figure,
    this.facts = const <String>[],
    this.stats = const <SummaryStat>[],
  });

  /// What [figure] is.
  final String label;

  /// The headline figure.
  final String figure;

  /// Short qualifiers under the figure, drawn as chips.
  final List<String> facts;

  /// Secondary figures, side by side under a hairline.
  final List<SummaryStat> stats;

  static const List<FontFeature> _tabular = <FontFeature>[
    FontFeature.tabularFigures(),
  ];

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    final ColorScheme scheme = theme.colorScheme;
    final TextTheme text = theme.textTheme;

    return AppCard(
      padding: const EdgeInsets.all(AppSpacing.xl),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          MergeSemantics(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                Text(
                  label,
                  style: text.labelLarge?.copyWith(
                    color: scheme.onSurfaceVariant,
                  ),
                ),
                const SizedBox(height: AppSpacing.xs),
                // The figure is money: private in a problem report.
                Sensitive(
                  child: FittedBox(
                    fit: BoxFit.scaleDown,
                    alignment: AlignmentDirectional.centerStart,
                    child: Text(
                      figure,
                      maxLines: 1,
                      style: text.displaySmall?.copyWith(
                        color: scheme.onSurface,
                        fontFeatures: _tabular,
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
          if (facts.isNotEmpty) ...<Widget>[
            const SizedBox(height: AppSpacing.md),
            // A Wrap, not a Row: two intrinsic-width chips overflow a narrow
            // card where a Wrap folds them onto a second line.
            Wrap(
              spacing: AppSpacing.sm,
              runSpacing: AppSpacing.sm,
              children: <Widget>[
                for (final String f in facts)
                  DecoratedBox(
                    decoration: BoxDecoration(
                      color: scheme.secondaryContainer,
                      borderRadius: BorderRadius.circular(AppRadius.pill),
                    ),
                    child: Padding(
                      padding: const EdgeInsets.symmetric(
                        horizontal: AppSpacing.md,
                        vertical: AppSpacing.xs,
                      ),
                      child: Text(
                        f,
                        style: text.labelLarge?.copyWith(
                          color: scheme.onSecondaryContainer,
                        ),
                      ),
                    ),
                  ),
              ],
            ),
          ],
          if (stats.isNotEmpty) ...<Widget>[
            const SizedBox(height: AppSpacing.lg),
            Divider(height: 1, thickness: 1, color: scheme.outlineVariant),
            const SizedBox(height: AppSpacing.lg),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                for (int i = 0; i < stats.length; i++) ...<Widget>[
                  if (i > 0) const SizedBox(width: AppSpacing.lg),
                  Expanded(
                    child: MergeSemantics(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        mainAxisSize: MainAxisSize.min,
                        children: <Widget>[
                          Text(
                            stats[i].label,
                            style: text.labelMedium?.copyWith(
                              color: scheme.onSurfaceVariant,
                            ),
                          ),
                          const SizedBox(height: AppSpacing.xs),
                          Sensitive(
                            child: FittedBox(
                              fit: BoxFit.scaleDown,
                              alignment: AlignmentDirectional.centerStart,
                              child: Text(
                                stats[i].value,
                                maxLines: 1,
                                style: text.titleLarge?.copyWith(
                                  color: scheme.onSurface,
                                  fontFeatures: _tabular,
                                ),
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ],
              ],
            ),
          ],
        ],
      ),
    );
  }
}
