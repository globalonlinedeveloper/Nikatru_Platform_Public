import 'package:flutter/material.dart';

import '../tokens/app_spacing.dart';

/// The chassis CARD — an opaque, bordered surface that holds a group of rows,
/// a figure, or a decision (train ST-D0).
///
/// ## Its two decisions, and why neither is a shadow
///  * **The fill is OPAQUE and comes from the scheme's container ramp**:
///    `surfaceContainerLowest` in light (white on every seeded scheme — the
///    card lifts off the tinted scaffold by being lighter) and
///    `surfaceContainerHigh` in dark (the card lifts by being lighter than the
///    dark scaffold). One opaque colour is a ground whose contrast
///    `test/card_list_row_test.dart` can measure; an alpha wash is a
///    different colour on every scaffold it lands on.
///  * **The edge is an `outlineVariant` hairline in BOTH schemes.** The app's
///    `cardDecoration` records why a shadow cannot be the edge: its shadows are
///    black alphas, and black on a dark ground paints nothing, so the dark card
///    had no edge at all until it grew a border. Here the border is the edge
///    everywhere, so the two schemes are one design, not a light design with a
///    dark patch.
///
/// The corner is [AppRadius.card]. Tappable when [onTap] is given: the ink
/// is clipped to the corner and the card is announced as a button.
class AppCard extends StatelessWidget {
  const AppCard({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(AppSpacing.lg),
    this.onTap,
  });

  /// The card's content.
  final Widget child;

  /// Inside the border. [AppSpacing.lg] by default; a card holding
  /// [AppListRow]s passes `EdgeInsets.zero` so the rows' own inset rules.
  final EdgeInsetsGeometry padding;

  /// Makes the whole card one tap target.
  final VoidCallback? onTap;

  /// The card's fill for [theme] — public so a test, or a widget drawn ON a
  /// card, reads the ground it sits on instead of re-deriving it.
  static Color fillOf(ThemeData theme) => theme.brightness == Brightness.light
      ? theme.colorScheme.surfaceContainerLowest
      : theme.colorScheme.surfaceContainerHigh;

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    final Widget content = Padding(padding: padding, child: child);
    return Material(
      color: fillOf(theme),
      clipBehavior: Clip.antiAlias,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(AppRadius.card),
        side: BorderSide(color: theme.colorScheme.outlineVariant),
      ),
      child: onTap == null
          ? content
          : Semantics(
              button: true,
              child: InkWell(onTap: onTap, child: content),
            ),
    );
  }
}
