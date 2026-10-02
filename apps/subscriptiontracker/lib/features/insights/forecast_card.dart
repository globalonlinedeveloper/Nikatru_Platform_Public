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
// The projection: every CHARGE each plan still charging makes in each of the
// twelve months, from the date engine `Subscription.nextCharge` uses
// (`RecurrenceSchedule`, via `SubMath.chargedInMonth`) — the same list the
// calendar draws. Bars are drawn in the display currency (no FX until ST-T5
// I3); the sentence carries every currency's total.
//
// ⏱ ST truth pass (IN-03): this added a price to month k when the plan was
// `monthly` or its STORED renewal month was k — so a weekly plan charged 11
// times a year instead of 52, a quarterly one once, every cadence that was not
// monthly was read as yearly, and a paused plan kept charging in the forecast.
//
// ⏱ 2026-09-30 · THE REST OF THE PRO "PLAN AND SAVE" SET (lead ruling D-11,
// audit §5.3), on this one gated card:
//   · ST-P6 (round-2 F23) — THE TREND IS BACK, and it is true this time: the
//     last 12 months of what was actually CHARGED, from payment_history
//     (`GET /v1/insights`, [spendHistoryProvider]). No history, no bars — a
//     sentence says none is recorded; a failed read draws nothing.
//   · ST-P6 (round-2 X07) — "set aside each month" for every plan that bills
//     less often than monthly ([SubMath.setAsidePerMonth]).
//   · ST-P5 (round-2 F36) — the month report as a PDF (month_report.dart),
//     handed to the same FileExporter the CSV export uses.
// ═══════════════════════════════════════════════════════════════════════════

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import 'package:nikatru_core/nikatru_core.dart' show ExportOutcome;
import 'package:nikatru_design_system/nikatru_design_system.dart';

import '../../core/format/history_math.dart';
import '../../core/format/money_format.dart';
import '../../core/format/sub_math.dart';
import '../../data/models/spend_history.dart';
import '../../data/models/subscription.dart';
import '../../l10n/app_localizations.dart';
import '../../state/money_providers.dart';
import '../../state/providers.dart'
    show fileExporterProvider, nowProvider, spendHistoryProvider;
import 'month_report.dart';
import 'summary_tiles.dart' show chargeWithCycle;

/// What [subs] charge in each of the 12 months starting with [now]'s month:
/// every charge of every row still charging ([SubMath.chargedInMonth]).
List<({DateTime month, MoneyBag charged})> forecastMonths(
  List<Subscription> subs,
  DateTime now,
) => <({DateTime month, MoneyBag charged})>[
  for (int k = 0; k < 12; k++)
    () {
      final DateTime m = DateTime(now.year, now.month + k);
      return (month: m, charged: SubMath.chargedInMonth(subs, m.year, m.month));
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
      // `nowProvider`, never `DateTime.now()`: month 0 is a function of
      // today, and the unlocked golden must be able to pin it.
      child: _unlocked(context, ref, l10n, ref.watch(nowProvider)()),
    );
  }

  Widget _unlocked(
    BuildContext context,
    WidgetRef ref,
    AppLocalizations l10n,
    DateTime now,
  ) {
    final ThemeData theme = Theme.of(context);
    final TextTheme text = theme.textTheme;
    final ColorScheme scheme = theme.colorScheme;
    final List<({DateTime month, MoneyBag charged})> months = forecastMonths(
      subs,
      now,
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
          ..._trend(context, ref, l10n),
          ..._setAsides(context, l10n),
          const SizedBox(height: AppSpacing.md),
          Align(
            alignment: AlignmentDirectional.centerStart,
            child: TextButton.icon(
              key: const Key('insights.report.export'),
              icon: const Icon(Icons.picture_as_pdf_outlined),
              label: Text(l10n.reportExport),
              onPressed: () => _exportReport(context, ref, l10n),
            ),
          ),
        ],
      ),
    );
  }

  /// ST-P6 (F23): the last 12 months of real charges. Loading and a failed
  /// read draw NOTHING — never a row of empty bars that reads as "you spent
  /// nothing" — and a history with no charge says so in a sentence.
  List<Widget> _trend(
    BuildContext context,
    WidgetRef ref,
    AppLocalizations l10n,
  ) {
    final SpendHistory? history = ref.watch(spendHistoryProvider).value;
    if (history == null) return const <Widget>[];
    final ThemeData theme = Theme.of(context);
    final TextTheme text = theme.textTheme;
    final ColorScheme scheme = theme.colorScheme;
    final List<({DateTime month, MoneyBag charged})> trend =
        HistoryMath.spendTrend(history.payments, ref.watch(nowProvider)());
    final Widget heading = Semantics(
      header: true,
      child: Text(
        l10n.trendTitle,
        style: text.labelLarge?.copyWith(color: scheme.onSurfaceVariant),
      ),
    );
    if (!HistoryMath.hasSpend(trend)) {
      return <Widget>[
        const SizedBox(height: AppSpacing.lg),
        heading,
        const SizedBox(height: AppSpacing.sm),
        Text(
          l10n.trendNone,
          key: const Key('insights.trend.none'),
          style: text.bodyMedium?.copyWith(color: scheme.onSurfaceVariant),
        ),
      ];
    }
    final List<double> w = <double>[
      for (final ({DateTime month, MoneyBag charged}) m in trend)
        SubMath.chartWeight(m.charged, currencyCode),
    ];
    final double top = w.fold(0, (double a, double b) => a > b ? a : b);
    final String summary = l10n.trendSummary(
      money.formatBagRounded(
        MoneyBag.sum(<Money>[
          for (final ({DateTime month, MoneyBag charged}) m in trend)
            ...m.charged.amounts,
        ]),
      ),
    );
    final DateFormat initial = DateFormat('MMMMM', l10n.localeName);
    return <Widget>[
      const SizedBox(height: AppSpacing.lg),
      heading,
      const SizedBox(height: AppSpacing.md),
      Semantics(
        key: const Key('insights.trend'),
        container: true,
        label: summary,
        excludeSemantics: true,
        child: Column(
          children: <Widget>[
            _Bars(
              heights: <double>[
                for (final double x in w) top <= 0 ? 0 : x / top,
              ],
              color: scheme.secondary,
            ),
            const SizedBox(height: AppSpacing.xs),
            Row(
              children: <Widget>[
                for (final ({DateTime month, MoneyBag charged}) m in trend)
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
          summary,
          style: text.bodyMedium?.copyWith(color: scheme.onSurfaceVariant),
        ),
      ),
    ];
  }

  /// ST-P6 (X07): what to put aside each month for every plan that bills
  /// less often than monthly. Nothing when there is none.
  List<Widget> _setAsides(BuildContext context, AppLocalizations l10n) {
    final List<({Subscription sub, Money perMonth})> asides = SubMath.setAsides(
      subs,
    );
    if (asides.isEmpty) return const <Widget>[];
    final ThemeData theme = Theme.of(context);
    final TextTheme text = theme.textTheme;
    final ColorScheme scheme = theme.colorScheme;
    return <Widget>[
      const SizedBox(height: AppSpacing.lg),
      Semantics(
        header: true,
        child: Text(
          l10n.setAsideTitle,
          style: text.labelLarge?.copyWith(color: scheme.onSurfaceVariant),
        ),
      ),
      const SizedBox(height: AppSpacing.sm),
      for (final ({Subscription sub, Money perMonth}) a in asides)
        Padding(
          padding: const EdgeInsets.only(bottom: AppSpacing.xs),
          child: Text(
            l10n.setAsideRow(
              money.format(a.perMonth),
              a.sub.name,
              chargeWithCycle(l10n, money, a.sub),
            ),
            key: Key('insights.setAside.${a.sub.id}'),
            style: text.bodyMedium?.copyWith(color: scheme.onSurface),
          ),
        ),
    ];
  }

  /// ST-P5 (F36): the month report, as a PDF, through the file exporter.
  /// The exporter never throws; a platform that could not export says so.
  Future<void> _exportReport(
    BuildContext context,
    WidgetRef ref,
    AppLocalizations l10n,
  ) async {
    final ScaffoldMessengerState? messenger = ScaffoldMessenger.maybeOf(
      context,
    );
    final ExportOutcome outcome = await ref
        .read(fileExporterProvider)
        .export(
          monthReportFile(
            subs,
            ref.read(nowProvider)(),
            currencyCode: currencyCode,
          ),
        );
    if (outcome == ExportOutcome.failed) {
      messenger?.showSnackBar(SnackBar(content: Text(l10n.reportExportFailed)));
    }
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
