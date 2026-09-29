import 'package:flutter/material.dart';

import '../tokens/app_spacing.dart';
import '../tokens/status_tones.dart';

/// The chassis LIST ROW — a label and a figure that read as a pair
/// (train ST-D0).
///
/// ```
/// [leading]  title ··························· figure  [›]
///            ● subtitle (or a status line)     caption
/// ```
///
/// ## What it fixes by construction
///  * **Height from the platform's density, not from a width.** 64 px on a
///    touch platform, 56 on the three desktop ones — the same
///    `theme.visualDensity` signal the app's `RowCard` reads, and for the same
///    reason: a phone in landscape still wants a thumb row and a half-width
///    desktop window still wants a pointer row. The TAP target is never under
///    48 either way.
///  * **The figure is tabular.** A column of prices whose digits are
///    proportional does not line up, and a row that exists to be compared with
///    the row below it must.
///  * **A status is a WORD first and a colour second.** [status] paints the
///    subtitle in the [StatusTones] tone for the ambient scheme and puts a dot
///    before it — but the subtitle text is required with it, so the state is
///    never carried by hue alone (WCAG 2.2 1.4.1).
///  * **One node per row.** Title, subtitle, figure and caption are merged, so
///    a reader hears one row, and a tappable row is announced as a button.
///
/// Every string is the app's, already localised.
class AppListRow extends StatelessWidget {
  const AppListRow({
    super.key,
    required this.title,
    this.subtitle,
    this.status,
    this.leading,
    this.figure,
    this.caption,
    this.onTap,
    this.showChevron = true,
  }) : assert(
         status == null || subtitle != null,
         'a status needs its subtitle: it is carried by the words, then the '
         'colour',
       );

  /// The row's name.
  final String title;

  /// The second line: a detail, or — with [status] — the status in words.
  final String? subtitle;

  /// Paints [subtitle] in this status's tone, with a dot before it.
  final StatusKind? status;

  /// A 40 px slot before the text: an avatar, a glyph tile, an icon.
  final Widget? leading;

  /// The value the row is about, e.g. a price. Tabular figures.
  final String? figure;

  /// A small line under [figure], e.g. "per month".
  final String? caption;

  /// Makes the row one tap target.
  final VoidCallback? onTap;

  /// Draws a trailing chevron on a tappable row. Off for a row whose tap
  /// toggles rather than navigates.
  final bool showChevron;

  /// The row's minimum height for [density]: 64 at standard density, 56 at
  /// compact. Public and pure so the rule is testable without a platform
  /// override.
  static double minHeightFor(VisualDensity density) =>
      64 + density.baseSizeAdjustment.dy;

  /// The leading slot's side.
  static const double leadingSize = 40;

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    final ColorScheme scheme = theme.colorScheme;
    final TextTheme text = theme.textTheme;
    final Color? statusTone = status == null
        ? null
        : StatusTones.of(context).toneOf(status!);
    const List<FontFeature> tabular = <FontFeature>[
      FontFeature.tabularFigures(),
    ];

    final Widget row = ConstrainedBox(
      constraints: BoxConstraints(minHeight: minHeightFor(theme.visualDensity)),
      child: Padding(
        padding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.lg,
          vertical: AppSpacing.sm,
        ),
        child: Row(
          children: <Widget>[
            if (leading != null) ...<Widget>[
              SizedBox.square(dimension: leadingSize, child: leading),
              const SizedBox(width: AppSpacing.md),
            ],
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: <Widget>[
                  Text(
                    title,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: text.titleMedium?.copyWith(color: scheme.onSurface),
                  ),
                  if (subtitle != null)
                    Row(
                      children: <Widget>[
                        if (statusTone != null) ...<Widget>[
                          ExcludeSemantics(
                            child: Container(
                              width: 8,
                              height: 8,
                              decoration: BoxDecoration(
                                color: statusTone,
                                shape: BoxShape.circle,
                              ),
                            ),
                          ),
                          const SizedBox(width: AppSpacing.xs + 2),
                        ],
                        Flexible(
                          child: Text(
                            subtitle!,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: text.bodySmall?.copyWith(
                              color: statusTone ?? scheme.onSurfaceVariant,
                              fontWeight: statusTone == null
                                  ? null
                                  : FontWeight.w600,
                            ),
                          ),
                        ),
                      ],
                    ),
                ],
              ),
            ),
            if (figure != null || caption != null) ...<Widget>[
              const SizedBox(width: AppSpacing.md),
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                mainAxisSize: MainAxisSize.min,
                children: <Widget>[
                  if (figure != null)
                    Text(
                      figure!,
                      style: text.titleMedium?.copyWith(
                        color: scheme.onSurface,
                        fontFeatures: tabular,
                      ),
                    ),
                  if (caption != null)
                    Text(
                      caption!,
                      style: text.bodySmall?.copyWith(
                        color: scheme.onSurfaceVariant,
                      ),
                    ),
                ],
              ),
            ],
            if (onTap != null && showChevron) ...<Widget>[
              const SizedBox(width: AppSpacing.xs),
              ExcludeSemantics(
                child: Icon(
                  Icons.chevron_right,
                  color: scheme.onSurfaceVariant,
                ),
              ),
            ],
          ],
        ),
      ),
    );

    return MergeSemantics(
      child: onTap == null
          ? row
          : Semantics(
              button: true,
              child: InkWell(onTap: onTap, child: row),
            ),
    );
  }
}
