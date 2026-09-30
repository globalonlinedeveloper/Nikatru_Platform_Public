// ═══════════════════════════════════════════════════════════════════════════
// THE NEXT 12 MONTHS — train ST-D3, label D3-6 (canvas v2 `Insights`, the Pro
// card). What the plans held today will charge, month by month, behind the
// design system's per-card `PaywallGate.card`.
//
// 🔴 A FORECAST, NOT A TREND. The canvas titles this card "Trend and 12-month
// forecast", and the trend half needs a spending history this app does not
// keep (the 2026-07-27 removal of an invented six-month series is recorded in
// insights_screen.dart). Every bar here is derived from a row's price, cycle
// and next renewal, so the card says "next 12 months" and nothing more.
//
// The projection: month 0 is the current month and counts the plans that
// still renew in it; each later month counts every monthly plan and the yearly
// plans whose renewal month it is. Bars are drawn in the display currency (no
// FX until ST-T5 I3); the sentence carries every currency's total.
// ═══════════════════════════════════════════════════════════════════════════

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';

import '../../core/format/money_format.dart';
import '../../core/format/sub_math.dart';
import '../../data/models/subscription.dart';
import '../../l10n/app_localizations.dart';
import '../../state/money_providers.dart';

/// What [subs] charge in each of the 12 months starting with [now]'s month.
List<({DateTime month, MoneyBag charged})> forecastMonths(
  List<Subscription> subs,
  DateTime now,
) => <({DateTime month, MoneyBag charged})>[
  for (int k = 0; k < 12; k++)
    () {
      final DateTime m = DateTime(now.year, now.month + k);
      return (
        month: m,
        charged: MoneyBag.sum(<Money>[
          for (final Subscription s in subs)
            if (k == 0
                ? s.renewsIn(m.year, m.month)
                : s.cycle == BillingCycle.monthly ||
                      s.nextRenewal.month == m.month)
              s.price,
        ]),
      );
    }(),
];

/// The Pro forecast card, gated per card.
class ForecastCard extends ConsumerWidget {
  const ForecastCard({
    super.key,
    required this.subs,
    required this.money,
    required this.currencyCode,
  });

  final List<Subscription> subs;
  final MoneyFormatter money;
  final String currencyCode;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    return PaywallGate.card(
      key: const Key('insights.forecast'),
      locked: ref.watch(paywallLockedProvider),
      onUpgrade: () => context.go('/paywall'),
      title: l10n.forecastTitle,
      badgeLabel: l10n.proBadge,
      message: l10n.forecastLocked,
      upgradeLabel: l10n.forecastSeePro,
      preview: const _Bars(
        heights: <double>[.5, .6, .55, .7, .65, .8, .75, .95, .8, .85, .85, 1],
      ),
      child: _unlocked(context, l10n),
    );
  }

  Widget _unlocked(BuildContext context, AppLocalizations l10n) {
    final ThemeData theme = Theme.of(context);
    final TextTheme text = theme.textTheme;
    final ColorScheme scheme = theme.colorScheme;
    final List<({DateTime month, MoneyBag charged})> months = forecastMonths(
      subs,
      DateTime.now(),
    );
    final List<double> w = <double>[
      for (final ({DateTime month, MoneyBag charged}) m in months)
        SubMath.chartWeight(m.charged, currencyCode),
    ];
    final double top = w.fold(0, (double a, double b) => a > b ? a : b);
    int peak = 0;
    for (int i = 1; i < w.length; i++) {
      if (w[i] > w[peak]) peak = i;
    }
    final MoneyBag total = MoneyBag.sum(<Money>[
      for (final ({DateTime month, MoneyBag charged}) m in months)
        ...m.charged.amounts,
    ]);
    final DateFormat monthName = DateFormat.MMMM(l10n.localeName);
    final DateFormat initial = DateFormat('MMMMM', l10n.localeName);

    return AppCard(
      key: const Key('insights.forecast.unlocked'),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          Semantics(
            header: true,
            child: Text(
              l10n.forecastTitle,
              style: text.labelLarge?.copyWith(color: scheme.onSurfaceVariant),
            ),
          ),
          const SizedBox(height: AppSpacing.md),
          // The bars and their initials are ONE node: the sentence below says
          // the total and the peak; twelve bare heights are not information.
          Semantics(
            container: true,
            label: l10n.forecastSummary(
              money.formatBagRounded(total),
              monthName.format(months[peak].month),
              money.formatBagRounded(months[peak].charged),
            ),
            excludeSemantics: true,
            child: Column(
              children: <Widget>[
                _Bars(
                  heights: <double>[
                    for (final double x in w) top <= 0 ? 0 : x / top,
                  ],
                  color: scheme.primary,
                ),
                const SizedBox(height: AppSpacing.xs),
                Row(
                  children: <Widget>[
                    for (final ({DateTime month, MoneyBag charged}) m in months)
                      Expanded(
                        child: Text(
                          initial.format(m.month),
                          textAlign: TextAlign.center,
                          style: text.labelSmall?.copyWith(
                            color: scheme.onSurfaceVariant,
                          ),
                        ),
                      ),
                  ],
                ),
              ],
            ),
          ),
          const SizedBox(height: AppSpacing.sm),
          ExcludeSemantics(
            child: Text(
              l10n.forecastSummary(
                money.formatBagRounded(total),
                monthName.format(months[peak].month),
                money.formatBagRounded(months[peak].charged),
              ),
              style: text.bodyMedium?.copyWith(color: scheme.onSurfaceVariant),
            ),
          ),
        ],
      ),
    );
  }
}

/// Twelve bars, heights as fractions of the tallest.
class _Bars extends StatelessWidget {
  const _Bars({required this.heights, this.color});

  final List<double> heights;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    final ColorScheme scheme = Theme.of(context).colorScheme;
    return SizedBox(
      height: AppSpacing.xxxl + AppSpacing.xl,
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.end,
        children: <Widget>[
          for (int i = 0; i < heights.length; i++) ...<Widget>[
            if (i > 0) const SizedBox(width: AppSpacing.xs),
            Expanded(
              child: FractionallySizedBox(
                heightFactor: heights[i].clamp(0.04, 1.0),
                alignment: Alignment.bottomCenter,
                child: DecoratedBox(
                  decoration: BoxDecoration(
                    color: color ?? scheme.surfaceContainerHighest,
                    borderRadius: BorderRadius.circular(AppRadius.sm / 2),
                  ),
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }
}
