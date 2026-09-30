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
///  * **Selection is a bar AND a state** ([selected], train ST-D1). A
///    master-detail list has to say which row the second pane is about: a
///    [selectedBarWidth] bar in `scheme.primary` on the START edge (so it
///    mirrors in RTL), and `Semantics(selected: …)` on the row's one node. The
///    row's ground does NOT change, so every contrast measured on the card
///    still holds on the selected row. Null — the default — means the row is
///    not selectable at all, and nothing is announced: a single-column list
///    whose tap pushes a route has no selection to report.
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
    this.selected,
    this.titleMaxLines = 1,
    this.subtitleMaxLines = 1,
  }) : assert(
         titleMaxLines > 0 && subtitleMaxLines > 0,
         'a row line needs at least one line',
       ),
       assert(
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

  /// Whether this row is the one a neighbouring pane is showing. Null: the
  /// list has no selection, and the row announces none.
  final bool? selected;

  /// The selection bar's thickness.
  static const double selectedBarWidth = 3;

  /// How many lines [title] may take before it is ellipsised. One by default:
  /// a row of NAMES scans as a column. A row whose title is a SENTENCE — a
  /// notice, a reminder — passes more, because an ellipsis there cuts the
  /// part of the sentence that says what happened (train ST-D5).
  final int titleMaxLines;

  /// How many lines [subtitle] may take before it is ellipsised; see
  /// [titleMaxLines].
  final int subtitleMaxLines;

  /// The text scale above which a one-line title gets a SECOND line.
  static const double largeTextScale = 1.3;

  /// The lines a title may take at [scaler] when the caller asked for
  /// [requested] — B51 (round-2 review, ST-Y4; ST-D0 D0-4's "2-line at >1.3×
  /// text"). Above [largeTextScale] a name that fitted at 100 % no longer
  /// does, and one line ellipsised it to its first word or two: at 200 % a
  /// 360 px row showed "Amazon Prime V…" for every Amazon plan alike. Two lines
  /// keep the name readable and the rows distinguishable; at or below the
  /// threshold nothing moves. Public and pure so the app's own rows adopt the
  /// same rule rather than a second threshold.
  static int titleLinesFor(TextScaler scaler, int requested) =>
      scaler.scale(1) > largeTextScale && requested < 2 ? 2 : requested;

  /// The row's minimum height for [density]: 64 at standard density, 56 at
  /// compact. Public and pure so the rule is testable without a platform
  /// override.
  static double minHeightFor(VisualDensity density) =>
      64 + density.baseSizeAdjustment.dy;

  /// The leading slot's side.
  static const double leadingSize = 40;

  /// The most of the row's width the figure column may take before it scales
  /// down. Half: the title is what the row is ABOUT, so it keeps the other
  /// half and ellipsises inside it.
  static const double figureShare = 0.5;

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
        child: LayoutBuilder(
          builder: (BuildContext context, BoxConstraints c) => Row(
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
                      maxLines: titleLinesFor(
                        MediaQuery.textScalerOf(context),
                        titleMaxLines,
                      ),
                      overflow: TextOverflow.ellipsis,
                      style: text.titleMedium?.copyWith(
                        color: scheme.onSurface,
                      ),
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
                              maxLines: subtitleMaxLines,
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
                // 🔴 THE FIGURE IS CAPPED AT [figureShare] OF THE ROW AND SCALES
                // DOWN PAST IT (train ST-D1). Unbounded, a price at 200 % text
                // on a 360 px phone took the whole row and overflowed it by
                // 20 px — measured by Home's text-scale case. Capped, the title
                // ellipsises and the figure shrinks to fit: every digit stays
                // on screen. Below the cap nothing moves, so at 100 % the row
                // lays out exactly as before.
                ConstrainedBox(
                  constraints: BoxConstraints(
                    maxWidth: c.maxWidth * figureShare,
                  ),
                  child: FittedBox(
                    fit: BoxFit.scaleDown,
                    alignment: AlignmentDirectional.centerEnd,
                    child: Column(
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
                  ),
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
      ),
    );

    final Widget marked = selected == true
        ? DecoratedBox(
            decoration: BoxDecoration(
              border: BorderDirectional(
                start: BorderSide(
                  color: scheme.primary,
                  width: selectedBarWidth,
                ),
              ),
            ),
            child: row,
          )
        : row;

    return MergeSemantics(
      child: Semantics(
        selected: selected,
        child: onTap == null
            ? marked
            : Semantics(
                button: true,
                child: InkWell(onTap: onTap, child: marked),
              ),
      ),
    );
  }
}
