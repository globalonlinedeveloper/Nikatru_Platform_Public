import 'package:flutter/material.dart';

import '../tokens/app_spacing.dart';
import 'app_card.dart';

/// A GROUP OF ROWS on one card, with a hairline between each pair
/// (train ST-D1).
///
/// The shape every dashboard list takes — renewals, recent payments, a
/// settings section — so the separator, its inset and the card it sits on are
/// decided once here rather than once per screen:
///  * **The card carries no padding**; each [AppListRow] brings its own inset,
///    so the rows' ink reaches the card's edge and the hit area is the row.
///  * **The divider is inset by the row's own gutter** ([AppSpacing.lg]) at
///    both ends, in `outlineVariant` — the same hairline as the card's edge,
///    so the group reads as one surface cut into rows, not as boxes stacked.
///  * **One row is still a group**: no divider is drawn before the first or
///    after the last child.
class AppListGroup extends StatelessWidget {
  const AppListGroup({super.key, required this.children})
    : assert(children.length > 0, 'an empty group says nothing');

  /// The rows, in reading order. Usually [AppListRow]s.
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    final Color line = Theme.of(context).colorScheme.outlineVariant;
    return AppCard(
      padding: EdgeInsets.zero,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          for (int i = 0; i < children.length; i++) ...<Widget>[
            if (i > 0)
              Divider(
                height: 1,
                thickness: 1,
                indent: AppSpacing.lg,
                endIndent: AppSpacing.lg,
                color: line,
              ),
            children[i],
          ],
        ],
      ),
    );
  }
}
