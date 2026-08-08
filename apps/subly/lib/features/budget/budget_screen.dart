import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';

import '../../core/format/currency.dart';
import '../../core/format/sub_math.dart';
import '../../data/models/budget_info.dart';
import '../../data/models/subscription.dart';
import '../../l10n/app_localizations.dart';
import '../../state/providers.dart';
import '../../state/settings_controller.dart';
import '../../state/subscriptions_controller.dart';
import '../shared/painters.dart';
import '../shared/widgets.dart';

final FutureProvider<BudgetInfo> budgetProvider = FutureProvider<BudgetInfo>(
  (ref) => ref.watch(subscriptionRepositoryProvider).budget(),
);

/// The three neutrals this screen paints with, resolved for the current
/// brightness.
///
/// 🔴 LIGHT IS THE LITERAL TOKEN, ON PURPOSE — the rule `cardDecoration` and
/// `RowCard` carry (`features/shared/widgets.dart`): `apps/subly` is the frozen
/// legacy rail-prover the owner eyeballs, so light stays byte-identical.
/// `Theme.of(context).extension<AppThemeX>()` is NOT a substitute — under the
/// seeded chassis theme its `muted`/`line` are `scheme.onSurfaceVariant`/
/// `outlineVariant` in BOTH brightnesses, so reading it would repaint the light
/// build.
///
/// 🔴 DARK IS THE DEFECT THIS FIXES. `AppText.title`/`.fig`/`.body` bake
/// `AppColors.ink` (#141420) and `AppText.muted` bakes `AppColors.muted`, so on
/// a dark scaffold the ring percentage, the three stats and every category name
/// were near-black on near-black. The dark values are the same slots
/// `buildAppTheme` maps these neutrals to (`ink: scheme.onSurface`,
/// `divider: scheme.outlineVariant`) and `AppThemeX.fromScheme` maps `muted` to.
///
/// ⚠️ `calendar_screen.dart` and `insights_screen.dart` carry the identical
/// helper: each P4 file-group increment has to stay independently compilable,
/// and the hoist into `features/shared/` belongs to the campaign's closing
/// cleanup alongside the deletion of `DueInfo.of`.
({Color ink, Color muted, Color line}) _neutrals(BuildContext context) {
  final ThemeData theme = Theme.of(context);
  if (theme.brightness == Brightness.light) {
    return (ink: AppColors.ink, muted: AppColors.muted, line: AppColors.line);
  }
  final ColorScheme scheme = theme.colorScheme;
  return (
    ink: scheme.onSurface,
    muted: scheme.onSurfaceVariant,
    line: scheme.outlineVariant,
  );
}

class BudgetScreen extends ConsumerWidget {
  const BudgetScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final ({Color ink, Color muted, Color line}) neutral = _neutrals(context);
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
          Text(
            l10n.budgetTitle,
            style: AppText.title.copyWith(fontSize: 26, color: neutral.ink),
          ),
          const SizedBox(height: 4),
          Text(
            // 🔴 THE HARDCODED ENGLISH `_months` TABLE IS GONE. It was never a
            // translation problem so much as a data one: `intl` already ships
            // month names for every locale, so an arb key for "January" would
            // have been asking a translator for something the SDK knows.
            // `DateFormat.yMMMM` also carries the ORDER — "August 2026" in en,
            // and whatever the locale puts first elsewhere, which the
            // interpolated `'$month $year'` could never do. Measured: `en`
            // renders "August 2026", byte-identical to the table it replaces.
            DateFormat.yMMMM(l10n.localeName).format(now),
            style: AppText.muted.copyWith(fontSize: 12, color: neutral.muted),
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
                            // NOT an arb key — a NUMBER. `NumberFormat`
                            // .percentPattern carries the locale's own
                            // convention, including where the sign goes (some
                            // locales lead with it) and which digits are used;
                            // `'${…}%'` hardcoded the English answer to both.
                            // The pattern is `#,##0%`, i.e. zero fraction
                            // digits, so `en` still renders "83%".
                            NumberFormat.percentPattern(
                              l10n.localeName,
                            ).format(pct),
                            style: AppText.fig.copyWith(
                              fontSize: 34,
                              color: over ? AppColors.danger : neutral.ink,
                            ),
                          ),
                          Text(
                            over ? l10n.overBudget : l10n.ofBudget,
                            style: AppText.muted.copyWith(
                              fontSize: 10,
                              color: neutral.muted,
                            ),
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
                    _stat(
                      label: l10n.statSpent,
                      value: currency.fmt(total),
                      valueColor: neutral.ink,
                      labelColor: neutral.muted,
                    ),
                    _stat(
                      label: l10n.statLeft,
                      value: currency.fmt0(math.max(budgetVal - total, 0)),
                      // `positive` is a STATUS colour, not a neutral: green
                      // means "money left" in either brightness, so it stays
                      // the literal token deliberately — the same reason
                      // `AppThemeX.fromScheme` refuses to re-hue it from the
                      // seed.
                      valueColor: AppColors.positive,
                      labelColor: neutral.muted,
                    ),
                    _stat(
                      label: l10n.statBudget,
                      value: currency.fmt0(budgetVal),
                      valueColor: neutral.ink,
                      labelColor: neutral.muted,
                    ),
                  ],
                ),
              ],
            ),
          ),
          // ⚠️ `byCategory` is SHARED with `insights_screen.dart` — one heading
          // over the same breakdown, so one key. And `SectionHeader` itself
          // paints with `AppText.title`'s baked `AppColors.ink`, which this
          // file cannot reach: it lives in `features/shared/widgets.dart`.
          // Named in this increment's report.
          SectionHeader(l10n.byCategory),
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

  Widget _stat({
    required String label,
    required String value,
    required Color valueColor,
    required Color labelColor,
  }) {
    return Column(
      children: <Widget>[
        Text(
          value,
          style: AppText.fig.copyWith(fontSize: 18, color: valueColor),
        ),
        Text(
          label,
          style: AppText.muted.copyWith(fontSize: 10, color: labelColor),
        ),
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
    final ({Color ink, Color muted, Color line}) neutral = _neutrals(context);

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
                  color: neutral.ink,
                ),
              ),
              Text.rich(
                TextSpan(
                  text: currency.fmt0(cat.value),
                  style: AppText.fig.copyWith(
                    fontSize: 13,
                    color: over ? AppColors.danger : neutral.ink,
                  ),
                  children: <InlineSpan>[
                    // NOT an l10n key: ' / ' is a separator between two
                    // formatted figures, and both figures come from `Currency`.
                    TextSpan(
                      text: ' / ${currency.fmt0(cap)}',
                      style: AppText.muted.copyWith(
                        fontSize: 13,
                        color: neutral.muted,
                      ),
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
              // The UNFILLED half of the bar is a neutral, so it has to move
              // with the surface: `AppColors.line` (#ECECF2) is a
              // near-white hairline that reads as a FULL bar on a dark card.
              backgroundColor: neutral.line,
              color: barColor,
            ),
          ),
        ],
      ),
    );
  }
}
