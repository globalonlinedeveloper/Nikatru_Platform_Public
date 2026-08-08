import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';

import '../../core/format/currency.dart';
import '../../core/format/sub_math.dart';
import '../../data/models/budget_info.dart';
import '../../data/models/subscription.dart';
import '../../state/providers.dart';
import '../../state/settings_controller.dart';
import '../../state/subscriptions_controller.dart';
import '../shared/painters.dart';
import '../shared/widgets.dart';

final FutureProvider<BudgetInfo> budgetProvider = FutureProvider<BudgetInfo>(
  (ref) => ref.watch(subscriptionRepositoryProvider).budget(),
);

class BudgetScreen extends ConsumerWidget {
  const BudgetScreen({super.key});

  static const List<String> _months = <String>[
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final Currency currency = ref.watch(currencyProvider);
    final List<Subscription> subs =
        ref.watch(subscriptionsControllerProvider).valueOrNull ??
        const <Subscription>[];
    final BudgetInfo? budget = ref.watch(budgetProvider).valueOrNull;
    if (budget == null) {
      return const Center(child: CircularProgressIndicator());
    }

    final DateTime now = DateTime.now();
    final double total = SubMath.totalMonthly(subs);
    final double budgetVal = budget.monthlyBudget;
    final bool over = total > budgetVal;
    final double pct = budgetVal <= 0 ? 0 : (total / budgetVal).clamp(0, 1);
    final Map<String, double> capMap = <String, double>{
      for (final BudgetCap c in budget.categories) c.name: c.cap,
    };
    final List<CategoryTotal> cats = SubMath.categoryTotals(subs);

    // 🔀 P3 PORT — THE WIDTH DECISION THIS SCREEN NEVER HAD.
    //
    // Same defect and same fix as home's `ContentPane` (home_screen.dart:109).
    // `AppScaffold` caps the body at `kMaxBodyWidth` only in its EXTRA-LARGE
    // class (>=1600), so between 1200 and 1599 every category bar grew to the
    // full window — a 1550 px progress meter with a name at one edge and a
    // figure at the other. Nothing overflowed and nothing clipped, so no
    // assertion could fail; only a MEASUREMENT sees it, which is what
    // `test/width_budget_test.dart` is. `ContentPane`'s default IS
    // `kMaxBodyWidth`, so this makes the two agree instead of agreeing only
    // past 1600.
    return ContentPane(
      child: ListView(
        // 🔀 P3 PORT — PADDING RE-BASED FOR THE CHASSIS SHELL.
        // Live was `fromLTRB(18, 58, 18, 108)`. Both odd numbers were paying
        // for the old shell: 58 cleared a status bar under a `Scaffold` with
        // no app bar, and 108 cleared `AppShell`'s floating pill bar plus its
        // FAB. `AppScaffold._compact()` wraps the body in a `SafeArea` and puts
        // the navigation in `bottomNavigationBar`, so both insets are now paid
        // twice. 18 is `AppSpacing.gutterCompact`, the chassis's page gutter.
        padding: const EdgeInsets.fromLTRB(
          AppSpacing.gutterCompact,
          AppSpacing.gutterCompact,
          AppSpacing.gutterCompact,
          AppSpacing.xl,
        ),
        children: <Widget>[
          Text('Budget & goals', style: AppText.title.copyWith(fontSize: 26)),
          const SizedBox(height: 4),
          Text(
            '${_months[now.month - 1]} ${now.year}',
            style: AppText.muted.copyWith(fontSize: 12),
          ),
          const SizedBox(height: 16),
          Container(
            padding: const EdgeInsets.all(24),
            decoration: cardDecoration(context),
            child: Column(
              children: <Widget>[
                SizedBox(
                  width: 168,
                  height: 168,
                  child: CustomPaint(
                    painter: RingPainter(
                      progress: pct,
                      color: over ? AppColors.danger : AppColors.accent,
                    ),
                    child: Center(
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: <Widget>[
                          Text(
                            '${(pct * 100).round()}%',
                            style: AppText.fig.copyWith(
                              fontSize: 34,
                              color: over ? AppColors.danger : AppColors.ink,
                            ),
                          ),
                          Text(
                            over ? 'over budget' : 'of budget',
                            style: AppText.muted.copyWith(fontSize: 10),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
                const SizedBox(height: 16),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                  children: <Widget>[
                    _stat('Spent', currency.fmt(total), AppColors.ink),
                    _stat(
                      'Left',
                      currency.fmt0(math.max(budgetVal - total, 0)),
                      AppColors.positive,
                    ),
                    _stat('Budget', currency.fmt0(budgetVal), AppColors.ink),
                  ],
                ),
              ],
            ),
          ),
          SectionHeader('By category'),
          for (int i = 0; i < cats.length; i++)
            Padding(
              padding: const EdgeInsets.only(bottom: 10),
              // ⚠️ SILENT DEFAULT, carried over unchanged: a category with no
              // configured cap gets `value * 1.2`, so its bar always renders at
              // 83% and can never read as over budget. That is a product
              // decision, not a bug — recorded here because the number looks
              // like an arbitrary constant at the call site.
              child: _categoryBar(
                context,
                currency,
                cats[i],
                capMap[cats[i].name] ?? cats[i].value * 1.2,
                i,
              ),
            ),
        ],
      ),
    );
  }

  Widget _stat(String label, String value, Color color) {
    return Column(
      children: <Widget>[
        Text(value, style: AppText.fig.copyWith(fontSize: 18, color: color)),
        Text(label, style: AppText.muted.copyWith(fontSize: 10)),
      ],
    );
  }

  Widget _categoryBar(
    BuildContext context,
    Currency currency,
    CategoryTotal cat,
    double cap,
    int i,
  ) {
    final bool over = cat.value > cap;
    final double frac = cap <= 0 ? 1 : math.min(cat.value / cap, 1);
    final Color barColor = over
        ? AppColors.danger
        : AppColors.ramp[i % AppColors.ramp.length];

    return Container(
      padding: const EdgeInsets.all(15),
      decoration: cardDecoration(context, radius: 18),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: <Widget>[
              Text(
                cat.name,
                style: AppText.body.copyWith(
                  fontWeight: FontWeight.w700,
                  fontSize: 14,
                ),
              ),
              Text.rich(
                TextSpan(
                  text: currency.fmt0(cat.value),
                  style: AppText.fig.copyWith(
                    fontSize: 13,
                    color: over ? AppColors.danger : AppColors.ink,
                  ),
                  children: <InlineSpan>[
                    TextSpan(
                      text: ' / ${currency.fmt0(cap)}',
                      style: AppText.muted.copyWith(fontSize: 13),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 9),
          ClipRRect(
            borderRadius: BorderRadius.circular(8),
            child: LinearProgressIndicator(
              value: frac,
              minHeight: 8,
              backgroundColor: AppColors.line,
              color: barColor,
            ),
          ),
        ],
      ),
    );
  }
}
