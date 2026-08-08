import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
// `show ContentPane` and not a bare import: `core/theme/app_theme.dart` and
// `app_colors.dart` below are re-export shims for this same package, so an
// unrestricted import makes both of them redundant and the analyzer says so
// (two `unnecessary_import` infos — the pair `settings_screen.dart` still
// carries). `ContentPane` is the one symbol this file needs that the shims do
// not re-export.
import 'package:nikatru_design_system/nikatru_design_system.dart'
    show ContentPane;

import '../../core/format/currency.dart';
import '../../core/format/sub_math.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_theme.dart';
import '../../data/models/subscription.dart';
import '../../state/settings_controller.dart';
import '../../state/subscriptions_controller.dart';
import '../cancel/cancel_sheet.dart';
import '../shared/painters.dart';
import '../shared/widgets.dart';

class InsightsScreen extends ConsumerWidget {
  const InsightsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final Currency currency = ref.watch(currencyProvider);
    final List<Subscription> subs =
        ref.watch(subscriptionsControllerProvider).valueOrNull ??
        const <Subscription>[];
    final double total = SubMath.totalMonthly(subs);
    final List<CategoryTotal> cats = SubMath.categoryTotals(subs);
    final List<Subscription> unused = SubMath.unused(subs);
    final double savings = SubMath.savings(subs);

    return ContentPane(
      // P3 PORT — THE WIDTH DECISION THIS SCREEN NEVER HAD.
      //
      // Same defect and same fix as home's `ContentPane`. `AppScaffold` caps the
      // body at `kMaxBodyWidth` only in its EXTRA-LARGE class (>=1600), so
      // between 1200 and 1599 both cards grew to the full window — a 1550 px
      // savings row with a glyph at one edge and a Cancel button at the other.
      // Nothing overflows and nothing clips, so no existing assertion could
      // fail. `ContentPane`'s DEFAULT cap IS `kMaxBodyWidth`, the same ceiling
      // `AppScaffold` applies above 1600, so this makes the two agree instead of
      // agreeing only past 1600. Default rather than `.reading`/`.pane`: two
      // cards on a scrolling page is home's and settings' shape, and a narrower
      // cap here would make insights the odd page out for no stated reason.
      //
      // ✅ POLICED by `test/width_insights_test.dart` — the 1920 case is the one
      // that goes red if this wrapper is deleted.
      child: ListView(
        // P3 PORT — PADDING RE-BASED FOR THE CHASSIS SHELL (home's precedent).
        // Live was `fromLTRB(18, 58, 18, 108)`. Both odd numbers paid for the
        // old shell: 58 cleared a status bar under a `Scaffold` with no app bar,
        // 108 cleared `AppShell`'s floating pill bar plus its FAB. The chassis
        // wraps the body in a `SafeArea` and puts navigation in
        // `bottomNavigationBar`, so both insets would now be paid twice.
        // 18 is `AppSpacing.gutterCompact`, the chassis's own page gutter.
        padding: const EdgeInsets.fromLTRB(
          AppSpacing.gutterCompact,
          AppSpacing.gutterCompact,
          AppSpacing.gutterCompact,
          AppSpacing.xl,
        ),
        children: <Widget>[
          Text('Insights', style: AppText.title.copyWith(fontSize: 26)),
          const SizedBox(height: 4),
          Text(
            'Where your money goes',
            style: AppText.muted.copyWith(fontSize: 12),
          ),
          const SizedBox(height: 16),
          _categoryCard(context, currency, cats, total),
          const SizedBox(height: 14),
          _savingsCard(context, currency, unused, savings),
        ],
      ),
    );
  }

  // 2026-07-27 - the six-month spending trend was REMOVED, not repaired.
  //
  // It drew `[142, 156, 151, 168, 174, total]` against labels Feb..Jul: five
  // invented figures and one real one, presented as the user's own history. The
  // app stores no spending history at all, so there was nothing to plot and no
  // way to make the series honest.
  //
  // Everything left on this screen is computed from the subscriptions actually
  // held. When real history exists, a trend can come back and be true.

  Widget _categoryCard(
    BuildContext context,
    Currency currency,
    List<CategoryTotal> cats,
    double total,
  ) {
    final List<MapEntry<double, Color>> segments = <MapEntry<double, Color>>[
      for (int i = 0; i < cats.length; i++)
        MapEntry<double, Color>(
          cats[i].value,
          AppColors.ramp[i % AppColors.ramp.length],
        ),
    ];

    return Container(
      padding: const EdgeInsets.all(20),
      decoration: cardDecoration(context),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text('By category', style: AppText.title.copyWith(fontSize: 16)),
          const SizedBox(height: 14),
          Row(
            children: <Widget>[
              SizedBox(
                width: 126,
                height: 126,
                child: CustomPaint(
                  painter: DonutPainter(segments: segments),
                  child: Center(
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: <Widget>[
                        Text(
                          currency.fmt0(total),
                          style: AppText.fig.copyWith(fontSize: 18),
                        ),
                        Text(
                          '/ mo',
                          style: AppText.muted.copyWith(fontSize: 9),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
              const SizedBox(width: 18),
              Expanded(
                child: Column(
                  children: <Widget>[
                    for (int i = 0; i < cats.length; i++)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 9),
                        child: Row(
                          children: <Widget>[
                            Container(
                              width: 10,
                              height: 10,
                              decoration: BoxDecoration(
                                color:
                                    AppColors.ramp[i % AppColors.ramp.length],
                                borderRadius: BorderRadius.circular(3),
                              ),
                            ),
                            const SizedBox(width: 8),
                            Expanded(
                              child: Text(
                                cats[i].name,
                                style: AppText.body.copyWith(
                                  fontWeight: FontWeight.w700,
                                  fontSize: 12,
                                ),
                              ),
                            ),
                            Text(
                              currency.fmt0(cats[i].value),
                              style: AppText.fig.copyWith(
                                fontSize: 12,
                                color: AppColors.muted,
                              ),
                            ),
                          ],
                        ),
                      ),
                  ],
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _savingsCard(
    BuildContext context,
    Currency currency,
    List<Subscription> unused,
    double savings,
  ) {
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: cardDecoration(context),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            children: <Widget>[
              // Expanded + ellipsis (P2.6b route-walk finding): an intrinsic
              // title beside an intrinsic pill overflows narrow cards.
              Expanded(
                child: Text(
                  'Savings opportunities',
                  style: AppText.title.copyWith(fontSize: 16),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              const SizedBox(width: 8),
              Pill(
                '${currency.fmt(savings)}/mo',
                bg: const Color.fromRGBO(16, 185, 129, 0.12),
                fg: AppColors.positive,
              ),
            ],
          ),
          const SizedBox(height: 12),
          for (final Subscription s in unused)
            Padding(
              padding: const EdgeInsets.only(bottom: 9),
              child: Container(
                padding: const EdgeInsets.all(11),
                decoration: BoxDecoration(
                  border: Border.all(color: AppColors.line),
                  borderRadius: BorderRadius.circular(15),
                ),
                child: Row(
                  children: <Widget>[
                    GlyphTile(glyph: s.glyph, size: 40, fontSize: 11),
                    const SizedBox(width: 11),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: <Widget>[
                          Text(
                            s.name,
                            style: AppText.body.copyWith(
                              fontWeight: FontWeight.w700,
                              fontSize: 14,
                            ),
                          ),
                          Text(
                            s.usageNote,
                            style: const TextStyle(
                              fontFamily: 'Manrope',
                              fontWeight: FontWeight.w700,
                              fontSize: 11,
                              color: AppColors.warn,
                            ),
                          ),
                        ],
                      ),
                    ),
                    SizedBox(
                      height: 36,
                      child: GradientButton(
                        label: 'Cancel',
                        height: 36,
                        fontSize: 12,
                        onPressed: () => showCancelSheet(context, s),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          if (unused.isEmpty)
            Text('Nothing flagged — nice.', style: AppText.muted),
        ],
      ),
    );
  }
}
