import 'package:flutter/material.dart';

import '../tokens/app_spacing.dart';
import 'app_list_row.dart';

/// The LOADING state of a list: placeholder rows the shape of [AppListRow],
/// announced once (train ST-D0).
///
/// [DataStateView.loading] is the right loading state for a whole surface
/// with nothing to shape yet. A LIST that is about to fill is better served by
/// its own outline: the rows arrive where the placeholders were, so nothing on
/// screen jumps when the data lands.
///
/// ## Its rules
///  * **Static, not shimmering.** A shimmer animates forever, which is motion
///    a user who asked the OS to reduce motion did not ask for, and a test
///    that pumps it can never settle. The blocks say "loading" by shape.
///  * **Opaque blocks** in `surfaceContainerHighest` — the one container slot
///    that separates from both a card and a scaffold in both schemes.
///  * **One announcement.** The rows are excluded; the [label] is announced
///    once, as a live region, exactly as [DataStateView.loading] does it.
///
/// [label] is the app's string, already localised.
class SkeletonList extends StatelessWidget {
  const SkeletonList({super.key, required this.label, this.rows = 3})
    : assert(rows > 0, 'a skeleton with no rows says nothing');

  /// Announced while loading, e.g. "Loading subscriptions".
  final String label;

  /// How many placeholder rows to draw.
  final int rows;

  /// Stable handle, so a test asserts WHICH state is on screen.
  static const Key skeletonKey = Key('skeleton-list');

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    final Color block = theme.colorScheme.surfaceContainerHighest;
    final double height = AppListRow.minHeightFor(theme.visualDensity);

    Widget bar(double width, double h) => Container(
      width: width,
      height: h,
      decoration: BoxDecoration(
        color: block,
        borderRadius: BorderRadius.circular(AppRadius.sm / 2),
      ),
    );

    return Semantics(
      key: skeletonKey,
      label: label,
      liveRegion: true,
      child: ExcludeSemantics(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            for (int i = 0; i < rows; i++)
              SizedBox(
                height: height,
                child: Padding(
                  padding: const EdgeInsets.symmetric(
                    horizontal: AppSpacing.lg,
                    vertical: AppSpacing.sm,
                  ),
                  child: Row(
                    children: <Widget>[
                      Container(
                        width: AppListRow.leadingSize,
                        height: AppListRow.leadingSize,
                        decoration: BoxDecoration(
                          color: block,
                          borderRadius: BorderRadius.circular(
                            AppRadius.control,
                          ),
                        ),
                      ),
                      const SizedBox(width: AppSpacing.md),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: <Widget>[
                            // Two widths, alternating, so the column reads as
                            // a list of different names and not a barcode.
                            FractionallySizedBox(
                              widthFactor: i.isEven ? 0.6 : 0.45,
                              child: bar(double.infinity, 12),
                            ),
                            const SizedBox(height: AppSpacing.sm),
                            FractionallySizedBox(
                              widthFactor: 0.3,
                              child: bar(double.infinity, 10),
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(width: AppSpacing.md),
                      bar(56, 12),
                    ],
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}
