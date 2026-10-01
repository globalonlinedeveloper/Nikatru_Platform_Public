// ═══════════════════════════════════════════════════════════════════════════
// THE SUMMARY GRID — train ST-D3, label D3-1 (canvas v2 `Insights`,
// `DesktopInsights`). Four figures the old screen did not have: the monthly
// average, the yearly charge, what falls due in the next thirty days, and the
// single most expensive plan.
//
// 🔴 EVERY FIGURE IS DERIVED FROM THE LIST THE SCREEN WAS HANDED, and from
// nothing else. The canvas prints "Charged in Sep · 9 payments", which needs a
// payment ledger this app does not keep: a row carries ONE `nextRenewal`, so a
// charge earlier this month has already rolled forward and is invisible. "Next
// 30 days" (the `DesktopInsights` tile) is answerable from what a row holds, so
// that is the tile both window classes draw.
//
// Built only from the ST-D0 foundation: `AppCard`, the theme's type ramp and
// scheme roles, `AppSpacing`. No colour, size or type literal.
// ═══════════════════════════════════════════════════════════════════════════

import 'package:flutter/material.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';

import '../../core/format/money_format.dart';
import '../../core/format/sub_math.dart';
import '../../data/models/subscription.dart';
import '../../l10n/app_localizations.dart';
import '../shared/cadence_label.dart';

/// The width from which the four tiles sit in ONE row rather than two.
///
/// Four tiles need roughly 130 px each to hold a six-figure rupee amount at the
/// ramp's `headlineSmall`; 560 is the narrowest reading column that gives them
/// that (less three gaps). A phone at 375–430 is two by two, the reading column
/// of a tablet (720) and the large grid are one row.
const double kSummaryOneRowFrom =
    AppBreakpoints.medium - AppSpacing.xxl - AppSpacing.sm;

/// A plan's real charge with its OWN cycle — "US$20.00/mo", "₹4,899/yr",
/// "₹900 every 3 months".
///
/// ⏱ ST truth pass (IN-01): every cadence that was not yearly printed as
/// "/mo", so a quarterly ₹900 plan read "₹900/mo" — three times what it
/// costs a month. Monthly and yearly keep their short forms; any other cadence
/// is the price beside [cadenceCaption], the caption every row already wears.
String chargeWithCycle(
  AppLocalizations l10n,
  MoneyFormatter money,
  Subscription s,
) {
  final Cadence c = s.billingCadence;
  final String amount = money.format(s.price);
  if (c == Cadence.yearly) return l10n.perYearAmount(amount);
  if (c == Cadence.monthly) return l10n.perMonthAmount(amount);
  return l10n.priceWithCadence(amount, cadenceCaption(l10n, c));
}

/// The four summary tiles, laid out for the width they are handed.
class SummaryTiles extends StatelessWidget {
  const SummaryTiles({
    super.key,
    required this.subs,
    required this.money,
    required this.now,
  });

  final List<Subscription> subs;
  final MoneyFormatter money;
  final DateTime now;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    // ⏱ ST truth pass (IN-01): CHARGING rows for every tile. The count under
    // "Next 30 days" is the SAME row set its amount is summed over
    // (`dueWithinRows`), so a paused plan inside the window moves neither;
    // the biggest plan is the biggest one still charging.
    final List<Subscription> charging = SubMath.charging(subs);
    final List<Subscription> ranked = SubMath.byMonthlyDesc(charging);
    final int dueCount = SubMath.dueWithinRows(subs, now, 30).length;
    final List<Widget> tiles = <Widget>[
      SummaryTile(
        key: const Key('insights.tile.month'),
        label: l10n.insightsPerMonthLabel,
        figure: money.formatBagRounded(SubMath.totalMonthly(subs)),
        caption: l10n.insightsOnAverage,
      ),
      SummaryTile(
        key: const Key('insights.tile.year'),
        label: l10n.insightsPerYearLabel,
        figure: money.formatBagRounded(SubMath.totalYearly(subs)),
        caption: l10n.insightsActiveCount(charging.length),
      ),
      SummaryTile(
        key: const Key('insights.tile.next30'),
        label: l10n.insightsNext30Label,
        figure: money.formatBagRounded(SubMath.dueWithin(subs, now, 30)),
        caption: l10n.insightsChargeCount(dueCount),
      ),
      SummaryTile(
        key: const Key('insights.tile.biggest'),
        label: l10n.insightsBiggestLabel,
        // RANKED by monthly share, PRINTED as the plan's real charge with its
        // cycle: a MonthlyShare is a comparison figure and never printed
        // (monthly_share_display_test, "the share stays unprintable").
        figure: ranked.isEmpty
            ? money.formatBagRounded(const MoneyBag(<String, Money>{}))
            : chargeWithCycle(l10n, money, ranked.first),
        caption: ranked.isEmpty ? l10n.insightsNoneYet : ranked.first.name,
      ),
    ];
    return LayoutBuilder(
      builder: (BuildContext context, BoxConstraints constraints) {
        if (constraints.maxWidth >= kSummaryOneRowFrom) {
          return _row(tiles);
        }
        return Column(
          children: <Widget>[
            _row(tiles.sublist(0, 2)),
            const SizedBox(height: AppSpacing.sm),
            _row(tiles.sublist(2)),
          ],
        );
      },
    );
  }

  /// Equal-width tiles of equal height: the row is as tall as its tallest
  /// tile, so a caption that wraps at 200 % text does not leave its neighbour
  /// short.
  static Widget _row(List<Widget> tiles) => IntrinsicHeight(
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        for (int i = 0; i < tiles.length; i++) ...<Widget>[
          if (i > 0) const SizedBox(width: AppSpacing.sm),
          Expanded(child: tiles[i]),
        ],
      ],
    ),
  );
}

/// One labelled figure on an [AppCard]: label, figure, caption, read as ONE
/// node so a screen reader never announces a bare amount.
class SummaryTile extends StatelessWidget {
  const SummaryTile({
    super.key,
    required this.label,
    required this.figure,
    required this.caption,
  });

  final String label;
  final String figure;
  final String caption;

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    final TextTheme text = theme.textTheme;
    final ColorScheme scheme = theme.colorScheme;
    return MergeSemantics(
      child: AppCard(
        padding: const EdgeInsets.all(AppSpacing.md),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            Text(
              label,
              style: text.labelMedium?.copyWith(color: scheme.onSurfaceVariant),
            ),
            const SizedBox(height: AppSpacing.xs),
            Text(
              figure,
              style: text.headlineSmall?.copyWith(
                color: scheme.onSurface,
                fontFeatures: const <FontFeature>[FontFeature.tabularFigures()],
              ),
            ),
            const SizedBox(height: AppSpacing.xs),
            Text(
              caption,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: text.bodySmall?.copyWith(color: scheme.onSurfaceVariant),
            ),
          ],
        ),
      ),
    );
  }
}
