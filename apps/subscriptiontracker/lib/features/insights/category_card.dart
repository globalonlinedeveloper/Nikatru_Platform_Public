// ═══════════════════════════════════════════════════════════════════════════
// BY CATEGORY — train ST-D3, label D3-5 (canvas v2 `Insights`). Ranked bars,
// and the same numbers as a TABLE one tap away (R3 §4: every chart has a
// table view).
//
// 🔴 THE DONUT THIS REPLACES WAS A 126 px CustomPaint: silent to a screen
// reader unless wrapped, unreadable past a handful of slices, and blank for
// any currency but the chosen one. A ranked bar is read in reading order, one
// row at a time, and every row is ONE semantics node — "Video: ₹1,297, 26% of
// the total" — with the bar itself excluded, because its length only repeats
// the words.
//
// ⚠️ ONE ROUNDING DECISION FOR THE WHOLE CARD, kept from the donut:
// `formatBreakdownRounded` folds the total from these very categories and
// apportions the rows against it, so the rows add up to the total printed in
// the header by construction (`rounded_breakdown_surfaces_test.dart`).
//
// ⚠️ A SHARE IS A SHARE OF THE DISPLAY CURRENCY. With no FX rates (ST-T5 I3),
// a category billed only in another currency has no share to claim, so its
// row prints its amount and no percentage — never a 0 %.
//
// ⏱ ST-X8 (audit C6): a category's NAME — in the bars, the table and every
// row's semantics label — is painted through `categoryLabel`, never printed as
// the stored id, which is an English word. The id still keys everything else.
// row prints its amount and no percentage — never a 0 %. ⏱ T12 (IN-06): once a
// rate table has been read the screen hands this card categories already
// folded into the home currency, so that case is now only the offline first
// launch.
//
// ⏱ T12 (IN-07): a row is a CONTROL when [CategoryCard.onCategoryTap] is set —
// it opens Home filtered to that category, announced as a button.
// ═══════════════════════════════════════════════════════════════════════════

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';

import '../../core/format/category_label.dart';
import '../../core/format/money_format.dart';
import '../../core/format/sub_math.dart';
import '../../l10n/app_localizations.dart';

/// The category breakdown as ranked bars or as a table.
class CategoryCard extends StatefulWidget {
  const CategoryCard({
    super.key,
    required this.categories,
    required this.money,
    required this.currencyCode,
    required this.perYear,
    this.onCategoryTap,
  });

  /// Called with a category's name when its row is tapped (IN-07). Null keeps
  /// every row a plain figure.
  final ValueChanged<String>? onCategoryTap;

  /// Already ranked (SubMath.categoryTotals order) and in the chosen unit.
  final List<CategoryTotal> categories;
  final MoneyFormatter money;
  final String currencyCode;
  final bool perYear;

  static const Key tableToggle = Key('insights.category.toggle');
  static const Key table = Key('insights.category.table');
  static const Key total = Key('insights.category.total');
  static Key figure(int i) => Key('insights.category.figure.$i');
  static Key row(int i) => Key('insights.category.row.$i');

  @override
  State<CategoryCard> createState() => _CategoryCardState();
}

class _CategoryCardState extends State<CategoryCard> {
  bool _asTable = false;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final ThemeData theme = Theme.of(context);
    final TextTheme text = theme.textTheme;
    final ColorScheme scheme = theme.colorScheme;
    final List<CategoryTotal> cats = widget.categories;

    final ({List<String> parts, String total}) figures = widget.money
        .formatBreakdownRounded(<MoneyBag>[
          for (final CategoryTotal c in cats) c.value,
        ]);
    final List<double> weights = <double>[
      for (final CategoryTotal c in cats)
        SubMath.chartWeight(c.value, widget.currencyCode),
    ];
    final double sum = weights.fold(0, (double a, double b) => a + b);
    final double top = weights.fold(0, (double a, double b) => a > b ? a : b);
    final NumberFormat pct = NumberFormat.percentPattern(l10n.localeName);
    String? shareOf(int i) =>
        sum <= 0 || weights[i] <= 0 ? null : pct.format(weights[i] / sum);

    return AppCard(
      key: const Key('insights.category'),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          Row(
            children: <Widget>[
              Expanded(
                child: MergeSemantics(
                  child: Wrap(
                    spacing: AppSpacing.sm,
                    crossAxisAlignment: WrapCrossAlignment.center,
                    children: <Widget>[
                      Semantics(
                        header: true,
                        child: Text(
                          l10n.byCategory,
                          style: text.labelLarge?.copyWith(
                            color: scheme.onSurfaceVariant,
                          ),
                        ),
                      ),
                      Text(
                        key: CategoryCard.total,
                        widget.perYear
                            ? l10n.perYearAmount(figures.total)
                            : l10n.perMonthAmount(figures.total),
                        style: text.titleSmall?.copyWith(
                          color: scheme.onSurface,
                          fontFeatures: const <FontFeature>[
                            FontFeature.tabularFigures(),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
              ),
              IconButton(
                key: CategoryCard.tableToggle,
                onPressed: () => setState(() => _asTable = !_asTable),
                icon: Icon(
                  _asTable ? Icons.bar_chart : Icons.table_rows_outlined,
                  semanticLabel: _asTable
                      ? l10n.categoryShowChart
                      : l10n.categoryShowTable,
                ),
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.sm),
          if (_asTable)
            _table(context, l10n, cats, figures.parts, shareOf)
          else
            for (int i = 0; i < cats.length; i++)
              Padding(
                padding: const EdgeInsets.only(bottom: AppSpacing.md),
                child: Semantics(
                  key: CategoryCard.row(i),
                  container: true,
                  button: widget.onCategoryTap != null,
                  onTap: widget.onCategoryTap == null
                      ? null
                      : () => widget.onCategoryTap!(cats[i].name),
                  label: shareOf(i) == null
                      ? l10n.a11yCategoryRowNoShare(
                          categoryLabel(l10n, cats[i].name),
                          figures.parts[i],
                        )
                      : l10n.a11yCategoryRow(
                          categoryLabel(l10n, cats[i].name),
                          figures.parts[i],
                          shareOf(i)!,
                        ),
                  excludeSemantics: true,
                  child: _tappable(
                    widget.onCategoryTap == null
                        ? null
                        : () => widget.onCategoryTap!(cats[i].name),
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: <Widget>[
                        Row(
                          children: <Widget>[
                            Expanded(
                              child: Text(
                                categoryLabel(l10n, cats[i].name),
                                style: text.titleSmall?.copyWith(
                                  color: scheme.onSurface,
                                ),
                              ),
                            ),
                            Text(
                              key: CategoryCard.figure(i),
                              figures.parts[i],
                              style: text.titleSmall?.copyWith(
                                color: scheme.onSurface,
                                fontFeatures: const <FontFeature>[
                                  FontFeature.tabularFigures(),
                                ],
                              ),
                            ),
                            if (shareOf(i) != null) ...<Widget>[
                              const SizedBox(width: AppSpacing.sm),
                              Text(
                                shareOf(i)!,
                                style: text.labelMedium?.copyWith(
                                  color: scheme.onSurfaceVariant,
                                ),
                              ),
                            ],
                          ],
                        ),
                        const SizedBox(height: AppSpacing.xs),
                        LinearProgressIndicator(
                          value: top <= 0 ? 0 : weights[i] / top,
                          minHeight: AppSpacing.sm,
                          borderRadius: BorderRadius.circular(AppRadius.pill),
                          color: scheme.primary,
                          backgroundColor: scheme.surfaceContainerHighest,
                        ),
                      ],
                    ),
                  ),
                ),
              ),
        ],
      ),
    );
  }

  /// [child] as an ink-splashing control when [onTap] is set.
  static Widget _tappable(VoidCallback? onTap, Widget child) => onTap == null
      ? child
      : Material(
          type: MaterialType.transparency,
          child: InkWell(
            borderRadius: BorderRadius.circular(AppRadius.control),
            onTap: onTap,
            child: child,
          ),
        );

  Widget _table(
    BuildContext context,
    AppLocalizations l10n,
    List<CategoryTotal> cats,
    List<String> parts,
    String? Function(int) shareOf,
  ) {
    final ThemeData theme = Theme.of(context);
    final TextTheme text = theme.textTheme;
    final ColorScheme scheme = theme.colorScheme;
    final TextStyle? head = text.labelMedium?.copyWith(
      color: scheme.onSurfaceVariant,
    );
    final TextStyle? cell = text.bodyMedium?.copyWith(color: scheme.onSurface);
    Widget pad(Widget child, {bool end = false}) => Padding(
      padding: const EdgeInsets.symmetric(vertical: AppSpacing.sm),
      child: Align(
        alignment: end
            ? AlignmentDirectional.centerEnd
            : AlignmentDirectional.centerStart,
        child: child,
      ),
    );
    return Table(
      key: CategoryCard.table,
      columnWidths: const <int, TableColumnWidth>{
        0: FlexColumnWidth(),
        1: IntrinsicColumnWidth(),
        2: IntrinsicColumnWidth(),
      },
      border: TableBorder(
        horizontalInside: BorderSide(color: scheme.outlineVariant),
      ),
      children: <TableRow>[
        TableRow(
          children: <Widget>[
            pad(Text(l10n.categoryTableCategory, style: head)),
            pad(Text(l10n.categoryTableAmount, style: head), end: true),
            Padding(
              padding: const EdgeInsetsDirectional.only(start: AppSpacing.lg),
              child: pad(Text(l10n.categoryTableShare, style: head), end: true),
            ),
          ],
        ),
        for (int i = 0; i < cats.length; i++)
          TableRow(
            children: <Widget>[
              pad(Text(categoryLabel(l10n, cats[i].name), style: cell)),
              pad(Text(parts[i], style: cell), end: true),
              Padding(
                padding: const EdgeInsetsDirectional.only(start: AppSpacing.lg),
                child: pad(Text(shareOf(i) ?? '', style: cell), end: true),
              ),
            ],
          ),
      ],
    );
  }
}
