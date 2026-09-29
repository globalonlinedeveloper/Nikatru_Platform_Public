import 'package:flutter/material.dart';

import '../tokens/app_spacing.dart';
import 'focusable_tap.dart';

/// The chassis SECTION HEADER — the name of the group of rows below it, with
/// an optional count or a way to see more (train ST-D1).
///
/// ```
/// Upcoming renewals ························ Calendar →
/// All subscriptions ································ 12
/// ```
///
/// ## What it fixes by construction
///  * **The title is a HEADING.** It carries `Semantics(header: true)`, so a
///    screen reader can jump between the groups of a long dashboard instead of
///    reading every row to find the next one.
///  * **The action is a real control.** A link painted as small text was, on
///    the app's first dashboard, a 13 px-tall tap target that no keyboard could
///    reach. Here it is a [FocusableTap] at least [kMinInteractiveDimension]
///    tall — keyboard-reachable, announced as a button, and as tall for a
///    finger as it is for a reader.
///  * **The arrow mirrors.** `Icons.arrow_forward` is declared with
///    `matchTextDirection`, so an RTL locale gets an arrow pointing the way it
///    reads; the word carries the meaning and the arrow is excluded.
///  * **Count and action are exclusive.** A header that both counts and links
///    has two trailing things competing for one edge.
///
/// Every string is the app's, already localised.
class AppSectionHeader extends StatelessWidget {
  const AppSectionHeader({
    super.key,
    required this.title,
    this.count,
    this.actionLabel,
    this.onAction,
  }) : assert(
         (actionLabel == null) == (onAction == null),
         'an action needs both its label and its callback',
       ),
       assert(
         count == null || actionLabel == null,
         'a section header shows a count or an action, not both',
       );

  /// The group's name.
  final String title;

  /// A figure beside the title, already formatted — e.g. how many rows.
  final String? count;

  /// The words of the link to the fuller view.
  final String? actionLabel;

  /// Opens the fuller view.
  final VoidCallback? onAction;

  /// The action glyph's side. Smaller than a 24 px icon on purpose: it
  /// follows a label-sized word and must not outweigh it.
  static const double actionIconSize = 18;

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    final ColorScheme scheme = theme.colorScheme;
    final TextTheme text = theme.textTheme;
    final TextStyle? actionStyle = text.labelLarge?.copyWith(
      color: scheme.primary,
    );

    return Padding(
      padding: const EdgeInsets.only(top: AppSpacing.xl, bottom: AppSpacing.sm),
      child: ConstrainedBox(
        // Every header is the height its action needs, so a list of sections
        // keeps one rhythm whether or not a given one links anywhere.
        constraints: const BoxConstraints(minHeight: kMinInteractiveDimension),
        child: Row(
          children: <Widget>[
            Expanded(
              // `container`, so the heading is the TITLE alone: without it
              // the count beside it merged into the heading's label
              // ("All subscriptions 12").
              child: Semantics(
                header: true,
                container: true,
                child: Text(
                  title,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: text.titleMedium?.copyWith(color: scheme.onSurface),
                ),
              ),
            ),
            if (count != null) ...<Widget>[
              const SizedBox(width: AppSpacing.md),
              Text(
                count!,
                style: text.labelLarge?.copyWith(
                  color: scheme.onSurfaceVariant,
                ),
              ),
            ],
            if (actionLabel != null) ...<Widget>[
              const SizedBox(width: AppSpacing.md),
              FocusableTap(
                onTap: onAction,
                borderRadius: BorderRadius.circular(AppRadius.control),
                child: ConstrainedBox(
                  constraints: const BoxConstraints(
                    minHeight: kMinInteractiveDimension,
                    minWidth: kMinInteractiveDimension,
                  ),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(
                      horizontal: AppSpacing.xs,
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: <Widget>[
                        Text(actionLabel!, style: actionStyle),
                        const SizedBox(width: AppSpacing.xs),
                        ExcludeSemantics(
                          child: Icon(
                            Icons.arrow_forward,
                            size: actionIconSize,
                            color: scheme.primary,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
