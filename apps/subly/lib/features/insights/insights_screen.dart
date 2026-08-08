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
import '../../l10n/app_localizations.dart';
import '../../state/settings_controller.dart';
import '../../state/subscriptions_controller.dart';
import '../cancel/cancel_sheet.dart';
import '../shared/painters.dart';
import '../shared/widgets.dart';

/// The three neutrals this screen paints with, resolved for the current
/// brightness.
///
/// 🔴 LIGHT IS THE LITERAL TOKEN, ON PURPOSE — the rule `cardDecoration` and
/// `RowCard` carry (`features/shared/widgets.dart`): `apps/subly` is the frozen
/// legacy rail-prover the owner eyeballs, so light stays byte-identical.
/// `Theme.of(context).extension<AppThemeX>()` is NOT a substitute — under the
/// seeded chassis theme its `muted`/`line` are `scheme.onSurfaceVariant`/
/// `outlineVariant` in BOTH brightnesses, so reading it would repaint light.
///
/// 🔴 DARK IS THE DEFECT THIS FIXES. `AppText.title`/`.fig`/`.body` bake
/// `AppColors.ink` (#141420), `AppText.muted` bakes `AppColors.muted`, and the
/// unused-subscription rows are outlined in `AppColors.line` (#ECECF2) — a
/// near-white hairline. On a dark scaffold the two card titles were
/// near-invisible and the row outlines glared. The dark values are the same
/// slots `buildAppTheme` maps these neutrals to (`ink: scheme.onSurface`,
/// `divider: scheme.outlineVariant`) and `AppThemeX.fromScheme` maps `muted` to.
///
/// ⚠️ `calendar_screen.dart` and `budget_screen.dart` carry the identical
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

class InsightsScreen extends ConsumerWidget {
  const InsightsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final ({Color ink, Color muted, Color line}) neutral = _neutrals(context);
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
          Text(
            l10n.insightsTitle,
            style: AppText.title.copyWith(fontSize: 26, color: neutral.ink),
          ),
          const SizedBox(height: 4),
          Text(
            l10n.insightsSubtitle,
            style: AppText.muted.copyWith(fontSize: 12, color: neutral.muted),
          ),
          const SizedBox(height: 16),
          _categoryCard(context, l10n, currency, cats, total),
          const SizedBox(height: 14),
          _savingsCard(context, l10n, currency, unused, savings),
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
    AppLocalizations l10n,
    Currency currency,
    List<CategoryTotal> cats,
    double total,
  ) {
    final ({Color ink, Color muted, Color line}) neutral = _neutrals(context);
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
          // `byCategory` is SHARED with `budget_screen.dart` — the same heading
          // over the same breakdown, so one key rather than two that drift.
          Text(
            l10n.byCategory,
            style: AppText.title.copyWith(fontSize: 16, color: neutral.ink),
          ),
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
                          style: AppText.fig.copyWith(
                            fontSize: 18,
                            color: neutral.ink,
                          ),
                        ),
                        Text(
                          l10n.perMonthShort,
                          style: AppText.muted.copyWith(
                            fontSize: 9,
                            color: neutral.muted,
                          ),
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
                                  color: neutral.ink,
                                ),
                              ),
                            ),
                            Text(
                              currency.fmt0(cats[i].value),
                              style: AppText.fig.copyWith(
                                fontSize: 12,
                                color: neutral.muted,
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
    AppLocalizations l10n,
    Currency currency,
    List<Subscription> unused,
    double savings,
  ) {
    final ({Color ink, Color muted, Color line}) neutral = _neutrals(context);
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
                  l10n.savingsOpportunities,
                  style: AppText.title.copyWith(
                    fontSize: 16,
                    color: neutral.ink,
                  ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              const SizedBox(width: 8),
              Pill(
                // A KEY, not an interpolation: `/mo` is an abbreviation of a
                // word, and where it sits relative to the amount is the
                // translator's call.
                l10n.perMonthAmount(currency.fmt(savings)),
                // The savings pill is a STATUS surface — green means "money you
                // could keep" in either brightness — so both halves stay the
                // literal tokens, the same call `AppThemeX.fromScheme` makes
                // when it refuses to re-hue positive/warn/danger.
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
                  // The row outline is a neutral, so it has to move with the
                  // surface: `AppColors.line` (#ECECF2) is a near-white
                  // hairline that GLARES on a dark card instead of receding.
                  border: Border.all(color: neutral.line),
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
                              color: neutral.ink,
                            ),
                          ),
                          Text(
                            // [DATA], not a key — `usageNote` is a field on the
                            // subscription, so localizing it is the demo-data
                            // decision the workorder records as out of scope.
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
                        // REUSES the shared `cancel` key. The label is painted
                        // white on `AppColors.brandGradient` inside
                        // `GradientButton`, which is correct in both
                        // brightnesses — an on-gradient colour must not follow
                        // the scheme, because the surface under it does not.
                        label: l10n.cancel,
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
            Text(
              l10n.insightsNothingFlagged,
              style: AppText.muted.copyWith(color: neutral.muted),
            ),
        ],
      ),
    );
  }
}
