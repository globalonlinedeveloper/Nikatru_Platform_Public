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

    return ContentPane.reading(
      // P3 PORT — THE WIDTH DECISION THIS SCREEN NEVER HAD.
      //
      // Same defect and same fix as home's `ContentPane`. `AppScaffold` caps the
      // body at `kMaxBodyWidth` only in its EXTRA-LARGE class (>=1600), so
      // between 1200 and 1599 both cards took every pixel the drawer left them.
      // Nothing overflows and nothing clips, so no existing assertion could
      // fail — only a MEASUREMENT sees it, which is what
      // `test/width_insights_test.dart` is.
      //
      // 🔴 CORRECTED 2026-08-21 — THIS COMMENT CLAIMED "a 1550 px savings row"
      // AND THAT WIDTH CANNOT OCCUR. `AppScaffold` hands the body
      // `min(W - 361, 1280)`: the 360px drawer and its 1px divider are taken
      // off the top before the body sees anything. So 1280 is the ceiling at
      // ANY window width, and inside the LARGE class the body tops out at
      // 1599-361 = 1238; at W=1500 the pane gets 1139, and at W=1440, 1079.
      // Less the 18/18 page gutters and the card's 20/20 padding, the widest a
      // savings row has ever been is ~1204 — still a glyph at one edge and a
      // Cancel button at the other with most of the row empty between them, so
      // the DEFECT was real and only the number was invented. The shipped
      // pixels never depended on it.
      //
      // 🔴 `.reading` (720), NOT THE DEFAULT `kMaxBodyWidth` (1280) — and the
      // default is what this file used to carry, on the stated grounds that it
      // made `ContentPane` and `AppScaffold` "agree instead of agreeing only
      // past 1600". That reasoning is void: agreeing on 1280 buys nothing when
      // 1280 is also the most the body can ever be handed, so the cap NEVER
      // BOUND and this page was a phone column that merely got wider. 720 is
      // the design system's own width for a stack of cards read top to bottom,
      // and that is exactly this page's shape — two cards, one column, no
      // second pane to fill. It also keeps the donut row honest: at 720, less
      // the gutters and card padding, the legend still gets ~500px beside the
      // fixed 126px donut, against the ~155px it survives on at 375.
      //
      // ✅ POLICED by `test/width_insights_test.dart` — at 720 the 768, 1280
      // AND 1920 cases all go red if this wrapper is deleted or re-widened,
      // where the old 1280 cap left only 1920 falsifiable.
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
          // 🔴 THE SAVINGS CARD IS GATED ON THERE BEING SOMETHING TO SAVE.
          // `SubMath.savings` sums rows carrying `unused == true`, and NOTHING in
          // this app ever sets `unused` — the add sheet constructs every draft
          // without it and the API never writes it back. So for every real user
          // the figure is exactly 0.00, and the card rendered a green
          // "money you could keep" Pill saying `0.00/mo` immediately above the
          // line that says nothing is flagged. Two opposite claims, one screen.
          //
          // Gated rather than deleted: the arithmetic is correct and the surface
          // becomes true the moment anything writes `unused`. Inventing a usage
          // signal to populate it would be the other, worse repair.
          if (unused.isNotEmpty) ...<Widget>[
            const SizedBox(height: 14),
            _savingsCard(context, l10n, currency, unused, savings),
          ],
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
                // 🔴 A `CustomPaint` IS PIXELS. It contributes NOTHING to the
                // semantics tree — no label, no value, no role — so the chart
                // that is the whole point of this screen was, to a screen
                // reader, a 126×126 hole with a bare currency figure floating in
                // the middle of it. The `Center` child below is real text, so
                // "₹2,340" and "/mo" were audible, but nothing said what they
                // were the total OF, and the SHAPE — which categories, in what
                // proportion — existed only as arcs.
                //
                // 🔴 THE LABEL IS BUILT FROM `cats` AND `total`, WHICH IS THE
                // SAME DATA `DonutPainter` IS HANDED. `segments` is derived from
                // `cats` two statements up, so the sentence and the arcs cannot
                // disagree: a category that stops being painted stops being
                // announced in the same edit. Reading the figures back out of
                // the widget tree, or restating them from a second query, is how
                // a chart description drifts from its chart.
                //
                // ⚠️ `excludeSemantics: true` IS DELIBERATE AND IT IS NOT A LOSS.
                // The centre's two `Text`s say `{total}` and "/mo", and
                // `a11yCategoryDonut` already opens with `{total} a month in
                // total` — keeping both would announce the same figure twice,
                // once as a fragment. The legend to the RIGHT of the donut is
                // outside this subtree and is untouched, so a reader who wants
                // the per-category rows one at a time still has them.
                //
                // ⚠️ The join is `', '` and NOT an arb key, matching the rule
                // this file group already records for `' / '` in
                // `budget_screen.dart`: it separates two formatted values, both
                // of which are themselves localized (`a11yCategoryShare` carries
                // the name/figure order, `Currency` carries the figure). A key
                // for a comma asks a translator for punctuation, not language.
                //
                // 🔴 `container: true` IS LOAD-BEARING AND WAS MEASURED, not
                // assumed. Without it this annotation has no conflicting
                // sibling, so Flutter's fragment compiler ABSORBS it upward:
                // the whole card became ONE node reading "By category ·
                // <this sentence> · Fitness · $255 · Creative · $60 · …" — the
                // description and the legend it summarises glued into a single
                // stop, the chart no longer a thing you can land on, and the
                // figures said twice. `container: true` makes the chart its own
                // element, which is what it is.
                child: Semantics(
                  container: true,
                  label: l10n.a11yCategoryDonut(
                    currency.fmt0(total),
                    <String>[
                      for (final CategoryTotal c in cats)
                        l10n.a11yCategoryShare(c.name, currency.fmt0(c.value)),
                    ].join(', '),
                  ),
                  excludeSemantics: true,
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
                    // 🔴 48, NOT 36 — MEASURED 73.5x36.0 AGAINST
                    // androidTapTargetGuideline. This is the control that opens
                    // the cancel sheet, i.e. the one destructive path on this
                    // screen, and it shipped as the smallest button in the app.
                    // No WCAG 2.5.8 exception reaches it: there is one per row
                    // and no equivalent control anywhere on insights, it is not
                    // inline in text, and nothing about a savings card makes 36
                    // essential. Both numbers move together — `GradientButton`
                    // sizes its own `SizedBox`, so leaving the outer one at 36
                    // would clip the button rather than shrink it.
                    SizedBox(
                      height: 48,
                      child: GradientButton(
                        // REUSES the shared `cancel` key. The label is painted
                        // white on `AppColors.brandGradient` inside
                        // `GradientButton`, which is correct in both
                        // brightnesses — an on-gradient colour must not follow
                        // the scheme, because the surface under it does not.
                        label: l10n.cancel,
                        height: 48,
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
