// ═══════════════════════════════════════════════════════════════════════════
// THE BUDGET CARD — train ST-D3, label D3-2. ADR 077 §2.1 folds the Budget tab
// into Insights; decision D-08 replaces its ring with a LINEAR METER and the
// meaning in words: "₹451 left this month", "92% used".
//
// 🔴 THE WORDS CARRY THE STATE, THE COLOUR ONLY REPEATS IT (WCAG 1.4.1). Over
// budget reads "₹200 over budget" in the danger tone and the meter turns
// danger; under reads "left this month" in the positive tone. Take the colour
// away and nothing is lost. Both tones are the ST-D0 scheme-forked pairs,
// measured AA on the card fill in both schemes (`status_contrast_test.dart`).
//
// ⚠️ THE FIGURE IS THE MONTHLY AVERAGE, NOT A LEDGER, as it always was: a
// yearly plan counts a twelfth. It is labelled as spend against a monthly
// budget, never as "charged this month".
// ═══════════════════════════════════════════════════════════════════════════

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';

import '../../core/format/money_format.dart';
import '../../core/format/sub_math.dart';
import '../../data/models/budget_info.dart';
import '../../data/models/subscription.dart';
import '../../l10n/app_localizations.dart';
import 'budget_editor.dart';

/// The budget, spent against it, and the one control that changes it.
class BudgetCard extends ConsumerWidget {
  const BudgetCard({super.key, required this.subs, required this.currencyCode});

  final List<Subscription> subs;

  /// The display currency: a budget stored before the budget carried its own
  /// currency is read in this one (`BudgetInfo.inCurrency`).
  final String currencyCode;

  static const Key editButton = Key('insights.budget.edit');
  static const Key meter = Key('insights.budget.meter');

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final AsyncValue<BudgetInfo> budgetAsync = ref.watch(budgetProvider);
    if (!budgetAsync.hasValue) {
      return AppCard(
        key: const Key('insights.budget'),
        padding: EdgeInsets.zero,
        child: budgetAsync.hasError
            ? DataStateView.failed(
                title: l10n.dataFailedTitle,
                body: l10n.dataFailedBody,
                retryLabel: l10n.retry,
                onRetry: () => ref.invalidate(budgetProvider),
              )
            : SkeletonList(label: l10n.dataLoading, rows: 1),
      );
    }
    final BudgetInfo budget = budgetAsync.requireValue.inCurrency(currencyCode);
    return _Loaded(
      budget: budget,
      subs: subs,
      money: MoneyFormatter(l10n.localeName, emptyCurrencyCode: currencyCode),
    );
  }
}

class _Loaded extends StatelessWidget {
  const _Loaded({
    required this.budget,
    required this.subs,
    required this.money,
  });

  final BudgetInfo budget;
  final List<Subscription> subs;
  final MoneyFormatter money;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final ThemeData theme = Theme.of(context);
    final TextTheme text = theme.textTheme;
    final ColorScheme scheme = theme.colorScheme;
    final StatusTones tones = StatusTones.of(context);

    final MoneyBag spent = SubMath.totalMonthly(subs);
    final BudgetUsage usage = budget.usageOf(spent);
    final Money limit = budget.monthlyBudget;
    final bool hasBudget = limit.minorUnits > 0;
    // The ratio the WORDS print is the real one — 112 % over — while the meter
    // is clamped to full: a bar cannot be longer than its track.
    final double used = hasBudget
        ? usage.spentHere.minorUnits / limit.minorUnits
        : 0;
    final String percent = NumberFormat.percentPattern(
      l10n.localeName,
    ).format(used);
    final bool otherCurrencies = spent.amounts.any(
      (Money m) => m.currencyCode != budget.currencyCode,
    );

    void edit() => showBudgetEditorSheet(
      context,
      budget: budget,
      spent: spent,
      categories: SubMath.categoryTotals(subs),
    );

    return AppCard(
      key: const Key('insights.budget'),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            children: <Widget>[
              Expanded(
                child: Semantics(
                  header: true,
                  child: Text(
                    l10n.budgetCardTitle,
                    style: text.labelLarge?.copyWith(
                      color: scheme.onSurfaceVariant,
                    ),
                  ),
                ),
              ),
              Semantics(
                label: hasBudget ? l10n.budgetEditA11y : null,
                excludeSemantics: hasBudget,
                button: true,
                child: TextButton(
                  key: BudgetCard.editButton,
                  onPressed: edit,
                  child: Text(hasBudget ? l10n.budgetEdit : l10n.budgetSet),
                ),
              ),
            ],
          ),
          if (!hasBudget)
            Text(
              l10n.budgetNoneBody,
              style: text.bodyMedium?.copyWith(color: scheme.onSurfaceVariant),
            )
          else ...<Widget>[
            MergeSemantics(
              child: Wrap(
                crossAxisAlignment: WrapCrossAlignment.end,
                spacing: AppSpacing.sm,
                children: <Widget>[
                  Text(
                    money.format(usage.spentHere),
                    style: text.headlineMedium?.copyWith(
                      color: scheme.onSurface,
                      fontFeatures: const <FontFeature>[
                        FontFeature.tabularFigures(),
                      ],
                    ),
                  ),
                  Padding(
                    padding: const EdgeInsets.only(bottom: AppSpacing.xs),
                    child: Text(
                      l10n.budgetOfAmount(money.formatRounded(limit)),
                      style: text.bodyMedium?.copyWith(
                        color: scheme.onSurfaceVariant,
                      ),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: AppSpacing.md),
            // 🔴 ONE NODE, LABEL AND VALUE IN WORDS. A progress bar's own
            // semantics value must be a NUMBER on Flutter 3.47 (a "55% used"
            // string trips the engine's assertion), and a bare number is not
            // what a reader needs to hear — so the bar is excluded and this
            // node carries "Budget used, 55% used".
            Semantics(
              container: true,
              label: l10n.budgetMeterLabel,
              value: l10n.budgetUsedPercent(percent),
              child: ExcludeSemantics(
                child: LinearProgressIndicator(
                  key: BudgetCard.meter,
                  value: usage.ratio,
                  minHeight: AppSpacing.md,
                  borderRadius: BorderRadius.circular(AppRadius.pill),
                  color: usage.over ? tones.danger : scheme.primary,
                  backgroundColor: scheme.surfaceContainerHighest,
                ),
              ),
            ),
            const SizedBox(height: AppSpacing.sm),
            Wrap(
              alignment: WrapAlignment.spaceBetween,
              spacing: AppSpacing.md,
              children: <Widget>[
                Text(
                  key: const Key('insights.budget.words'),
                  usage.over
                      ? l10n.budgetOver(
                          money.formatRounded(usage.spentHere - limit),
                        )
                      : l10n.budgetLeft(
                          money.formatRounded(
                            (limit - usage.spentHere).clampAtZero(),
                          ),
                        ),
                  style: text.titleSmall?.copyWith(
                    color: usage.over ? tones.danger : tones.positive,
                  ),
                ),
                ExcludeSemantics(
                  // Already the meter's value; read once, not twice.
                  child: Text(
                    l10n.budgetUsedPercent(percent),
                    style: text.bodyMedium?.copyWith(
                      color: scheme.onSurfaceVariant,
                    ),
                  ),
                ),
              ],
            ),
          ],
          if (otherCurrencies) ...<Widget>[
            const SizedBox(height: AppSpacing.sm),
            Text(
              l10n.budgetOtherCurrencies,
              style: text.bodySmall?.copyWith(color: scheme.onSurfaceVariant),
            ),
          ],
        ],
      ),
    );
  }
}
