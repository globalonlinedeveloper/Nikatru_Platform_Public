import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
// A `show` list and not a bare import: `core/theme/app_theme.dart` and
// `app_colors.dart` below are re-export shims for this same package, so an
// unrestricted import makes both of them redundant and the analyzer says so
// (two `unnecessary_import` infos — the pair `settings_screen.dart` still
// carries).
//
// 🔴 CORRECTED 2026-08-21 — THIS SAID `ContentPane` WAS "the one symbol this
// file needs that the shims do not re-export". True until today; it is now two.
// The two-column branch below reads `AppBreakpoints.large`, and
// `app_theme.dart`'s shim re-exports `AppSpacing` and `AppRadius` but NOT
// `AppBreakpoints`.
import 'package:nikatru_design_system/nikatru_design_system.dart'
    show AppBreakpoints, ContentPane;

import '../../core/format/money_format.dart';
import '../../core/format/sub_math.dart';
import '../../core/theme/app_theme.dart';
import '../../data/models/subscription.dart';
import '../../l10n/app_localizations.dart';
import '../../state/settings_controller.dart';
import '../add/add_subscription_sheet.dart';
import '../shared/async_gate.dart';
import '../shell/app_shell.dart';
import 'budget_card.dart';
import 'category_card.dart';
import 'signals.dart';
import 'summary_tiles.dart';

/// 📌 THE PRIVATE `_neutrals(BuildContext)` THAT STOOD HERE IS HOISTED
/// (2026-08-25) into `features/shared/neutrals.dart` as `neutrals(context)`,
/// together with the whole doc that recorded why light is the literal token and
/// why dark derives from the seed. The triplication was deliberate for exactly
/// one increment and its own doc said so; this is the closing cleanup it named,
/// landed with the deletion of `DueInfo.of`. Read the argument there.

/// The gap this page has always spent between its two cards.
///
/// Named rather than left as a bare `14` because the two-column layout below
/// spends it on the HORIZONTAL axis too: one number, so the grid has one
/// rhythm, and no new number enters the file to do it.
const double _cardGap = 14;

/// Whether a stack of [cardCount] cards should be laid out two-up in [width].
///
/// 🔴 THE SECOND CONDITION IS NOT DEFENSIVE PADDING. Width alone is not enough:
/// one card in a two-column grid is a card beside a hole. On THIS screen that
/// is the ordinary case rather than an edge one — the savings card is gated on
/// `unused.isNotEmpty`, and nothing in this app ever sets `unused`, so every
/// real user has exactly one card here and stays in one column at any width.
///
/// ⚠️ 1200 IS A BODY WIDTH, NOT A WINDOW WIDTH, AND THE TWO ARE 361px APART.
/// `AppScaffold` hands the body `min(W - 361, 1280)` — the 360px drawer and its
/// 1px divider are taken off the top first — so the second column appears at a
/// WINDOW width of 1561, not 1200. That is the honest seam anyway: the question
/// is how much room this screen was actually handed to divide, and the answer
/// is its own incoming constraints, not the size of the display.
///
/// ⏱ 2026-09-16 · [ADR 083]: the 361 px was the drawer's, and no window class
/// has the drawer now. From 1200 px up the body is `min(W - R - 1, 1280)`, R
/// being the slim rail's rendered width, so the second column appears at a
/// window of 1200 + R + 1 (1317 px for a 116 px rail), not 1561.
bool _twoUp(double width, int cardCount) =>
    width >= AppBreakpoints.large && cardCount >= 2;

/// [cards] dealt into two equal columns, [gap] apart on both axes.
///
/// 🔴 ALTERNATING, NOT HALVED. Card 0 and card 1 are the first row read
/// left-to-right, 2 and 3 the next. Dealing the first half of the list to the
/// left column instead reads DOWN one column and back UP the other — a
/// newspaper, not a card grid — and it puts the semantics tree in an order no
/// sighted reader follows, because a screen reader walks the widget tree and
/// would announce the whole left column before the top of the right one.
///
/// ⚠️ `CrossAxisAlignment.stretch` on each column is what keeps the cards
/// looking as they do in one column: a `Container` with no width shrink-wraps
/// its child, and it is only the `ListView`'s tight cross-axis constraint that
/// makes today's cards full-bleed. Inside a `Row` that constraint is gone.
///
/// ⚠️ `MainAxisSize.min` on both columns and `CrossAxisAlignment.start` on the
/// `Row`: this lives inside a `ListView`, so the incoming height is unbounded
/// and the columns must shrink-wrap. The two columns are top-aligned and end
/// wherever their own content does — they are not forced to equal heights,
/// which would stretch whichever column has less in it.
///
/// ⚠️ Duplicated verbatim in `budget_screen.dart`, for the reason the hoisted
/// `neutrals` helper recorded when it stood above this one: each P4 file-group
/// increment has to stay independently compilable, and the hoist into
/// `features/shared/` belongs to the campaign's closing cleanup.
///
/// (CORRECTION 2026-08-25: `_neutrals` took that hoist —
/// `features/shared/neutrals.dart`. THIS helper did NOT, and is still
/// duplicated. It is a layout function with no theme input, and it was outside
/// the file set of the due/neutrals cleanup. The duplication is unresolved,
/// not resolved.)
Widget _twoColumnCards(List<Widget> cards, double gap) {
  final List<Widget> left = <Widget>[];
  final List<Widget> right = <Widget>[];
  for (int i = 0; i < cards.length; i++) {
    final List<Widget> column = i.isEven ? left : right;
    if (column.isNotEmpty) column.add(SizedBox(height: gap));
    column.add(cards[i]);
  }
  return Row(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: <Widget>[
      Expanded(
        child: Column(
          // Keyed so a width test can measure a COLUMN and not only the
          // pane. The pane's own width at a 1280 surface IS 1280, i.e. an
          // assertion that cannot fail; a column's width is a number only
          // this layout produces. The key sits on the `Column` and not on
          // the `Expanded` because `Expanded` is a `ParentDataWidget` and
          // owns no `RenderBox` of its own to read constraints off.
          key: const Key('insights.cards.left'),
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: left,
        ),
      ),
      SizedBox(width: gap),
      Expanded(
        child: Column(
          key: const Key('insights.cards.right'),
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: right,
        ),
      ),
    ],
  );
}

/// Which unit the category breakdown reads in — the canvas's Month / Year
/// switch (D3-1). The summary tiles print both, so the switch moves only the
/// breakdown; the budget is a monthly figure and never moves with it.
enum InsightsPeriod { month, year }

class InsightsScreen extends ConsumerStatefulWidget {
  const InsightsScreen({super.key});

  @override
  ConsumerState<InsightsScreen> createState() => _InsightsScreenState();
}

class _InsightsScreenState extends ConsumerState<InsightsScreen> {
  InsightsPeriod _period = InsightsPeriod.month;

  /// The breakdown for [period], ranked by the MONTHLY ranking in both units so
  /// flipping the switch never reorders the rows under the reader's eye.
  static List<CategoryTotal> _categoryTotals(
    List<Subscription> subs,
    InsightsPeriod period,
  ) {
    final List<CategoryTotal> monthly = SubMath.categoryTotals(subs);
    if (period == InsightsPeriod.month) return monthly;
    return <CategoryTotal>[
      for (final CategoryTotal c in monthly)
        CategoryTotal(
          c.name,
          MoneyBag.sum(<Money>[
            for (final Subscription s in subs)
              if (s.category == c.name) s.yearlyCharge,
          ]),
        ),
    ];
  }

  @override
  Widget build(BuildContext context) {
    final WidgetRef ref = this.ref;
    final AppLocalizations l10n = AppLocalizations.of(context);
    // The currency the DONUT is drawn in — see [SubMath.chartWeight] — and the
    // one an empty total reads as. Every figure printed beside the donut still
    // carries every subtotal.
    final String currencyCode = ref.watch(currencyCodeProvider);
    final MoneyFormatter money = MoneyFormatter(
      l10n.localeName,
      emptyCurrencyCode: currencyCode,
    );
    // 🔴 `valueOrNull ?? const []` STOOD HERE (insights:234) AND IT MADE THE
    // DONUT LIE. Every figure on this screen is DERIVED from the list, so an
    // absent list did not blank the page, it produced a fully composed,
    // confident report whose every number was 0.00. The gate wraps the WHOLE
    // body, which is safe because this is a shell TAB: `AppScaffold` owns the
    // navigation and every state below keeps it.
    return subscriptionsGate(
      ref,
      l10n: l10n,
      emptyTitle: l10n.dataEmptyTitle,
      emptyBody: l10n.dataEmptyBody,
      // ST-U6 (C3): the first step, not a dead end.
      emptyActionLabel: l10n.addSubscriptionTitle,
      onEmptyAction: () => showAddSubscriptionSheet(context),
      builder: (List<Subscription> subs) {
        final List<CategoryTotal> cats = _categoryTotals(subs, _period);

        // The page's card STACK, in reading order — built ONCE, then laid out
        // in one column or two, so no arm can gain a card the other lacks.
        // Every card is keyed `insights.card.<n>` so a test can find the
        // LOWEST card whatever it is (the FAB and fold cases in
        // `width_shell_fab_test.dart`).
        final List<Widget> cards = <Widget>[
          BudgetCard(subs: subs, currencyCode: currencyCode),
          // D3-4: what the rows can prove, and one question — never the
          // `unused` / `usedPct` fields nothing writes.
          SignalsSection(subs: subs, money: money),
          CategoryCard(
            categories: cats,
            money: money,
            currencyCode: currencyCode,
            perYear: _period == InsightsPeriod.year,
          ),
        ];

        final List<Widget> keyed = <Widget>[
          for (int i = 0; i < cards.length; i++)
            KeyedSubtree(key: Key('insights.card.$i'), child: cards[i]),
        ];

        // 🔴 THE `LayoutBuilder` SITS OUTSIDE THE PANE: inside a `ContentPane`
        // it would measure the PANE, not the body the chassis handed down.
        return LayoutBuilder(
          builder: (BuildContext _, BoxConstraints constraints) {
            final bool twoUp = _twoUp(constraints.maxWidth, cards.length);
            return _pane(
              twoUp: twoUp,
              child: ListView(
                padding: AppShell.pageInsetOf(context),
                children: <Widget>[
                  // The heading and the summary stay FULL WIDTH in both
                  // layouts: they are the page's label and its headline
                  // figures, not cards of the grid.
                  _header(context, l10n),
                  const SizedBox(height: AppSpacing.lg),
                  SummaryTiles(subs: subs, money: money, now: DateTime.now()),
                  const SizedBox(height: AppSpacing.lg),
                  if (twoUp)
                    _twoColumnCards(keyed, _cardGap)
                  else
                    for (int i = 0; i < keyed.length; i++) ...<Widget>[
                      if (i > 0) const SizedBox(height: _cardGap),
                      keyed[i],
                    ],
                ],
              ),
            );
          },
        );
      },
    );
  }

  /// The title and the Month / Year switch on one line; the switch drops under
  /// the title when the two do not fit (a phone at 200 % text).
  Widget _header(BuildContext context, AppLocalizations l10n) {
    final ThemeData theme = Theme.of(context);
    return Wrap(
      alignment: WrapAlignment.spaceBetween,
      crossAxisAlignment: WrapCrossAlignment.center,
      spacing: AppSpacing.md,
      runSpacing: AppSpacing.sm,
      children: <Widget>[
        Semantics(
          header: true,
          child: Text(
            l10n.insightsTitle,
            style: theme.textTheme.headlineMedium?.copyWith(
              color: theme.colorScheme.onSurface,
            ),
          ),
        ),
        Semantics(
          label: l10n.insightsPeriodLabel,
          container: true,
          child: SegmentedButton<InsightsPeriod>(
            key: const Key('insights.period'),
            segments: <ButtonSegment<InsightsPeriod>>[
              ButtonSegment<InsightsPeriod>(
                value: InsightsPeriod.month,
                label: Text(l10n.insightsPeriodMonth),
              ),
              ButtonSegment<InsightsPeriod>(
                value: InsightsPeriod.year,
                label: Text(l10n.insightsPeriodYear),
              ),
            ],
            selected: <InsightsPeriod>{_period},
            onSelectionChanged: (Set<InsightsPeriod> next) =>
                setState(() => _period = next.single),
          ),
        ),
      ],
    );
  }

  /// The pane that caps this page, and its cap MOVES WITH THE COLUMN COUNT.
  ///
  // P3 PORT — THE WIDTH DECISION THIS SCREEN NEVER HAD.
  //
  // Same defect and same fix as home's `ContentPane`. `AppScaffold` caps the
  // body at `kMaxBodyWidth` only in its EXTRA-LARGE class (>=1600), so between
  // 1200 and 1599 both cards took every pixel the drawer left them. Nothing
  // overflows and nothing clips, so no existing assertion could fail — only a
  // MEASUREMENT sees it, which is what `test/width_insights_test.dart` is.
  //
  // 🔴 CORRECTED 2026-08-21 — THIS COMMENT CLAIMED "a 1550 px savings row"
  // AND THAT WIDTH CANNOT OCCUR. `AppScaffold` hands the body
  // `min(W - 361, 1280)`: the 360px drawer and its 1px divider are taken off
  // the top before the body sees anything. So 1280 is the ceiling at ANY
  // window width, and inside the LARGE class the body tops out at
  // 1599-361 = 1238; at W=1500 the pane gets 1139, and at W=1440, 1079.
  // Less the 18/18 page gutters and the card's 20/20 padding, the widest a
  // savings row has ever been is ~1204 — still a glyph at one edge and a
  // Cancel button at the other with most of the row empty between them, so the
  // DEFECT was real and only the number was invented. The shipped pixels never
  // depended on it.
  //
  // ⏱ 2026-09-16 · [ADR 083]: the drawer is gone from every class. From 1200 px
  // up the body is `min(W - R - 1, 1280)`, R being the slim rail's rendered
  // width (116 px for a "Settings" label on Flutter 3.47.2). So the LARGE
  // ceiling is 1599 - R - 1 and a 1440 px window gives 1439 - R. The defect and
  // the cap below are unchanged; only these widths moved.
  //
  // 🔴 ONE COLUMN → `.reading` (720). This is the cap the file has carried
  // since the P3 port and the reasoning is unchanged: 720 is the design
  // system's own width for a stack of cards read top to bottom. It also keeps
  // the donut row honest — at 720, less the gutters and card padding, the
  // legend still gets ~500px beside the fixed 126px donut, against the ~155px
  // it survives on at 375. (The `kMaxBodyWidth` default this file carried
  // BEFORE the port was wrong for a different reason: 1280 is also the most
  // the body can ever be handed, so that cap never bound at any real window.)
  //
  // 🔴 TWO COLUMNS → the default `kMaxBodyWidth` (1280), AND THAT IS NOT A
  // REVERSAL OF THE LINE ABOVE. `reading` bounds a COLUMN of cards, and in the
  // two-up layout there are two of them: 1280 less the 18/18 page gutters less
  // the 14px column gap leaves 615 per column — comfortably inside `reading`,
  // so the number that justifies 720 is still being honoured, once per column.
  // Capping the two-up layout at 720 instead would give 353px columns, which is
  // narrower than the 375px phone this page is designed for.
  //
  // ✅ POLICED by `test/width_insights_test.dart`, which measures the pane AND
  // a column at each surface — the pane alone cannot fail at 1280, because
  // 1280 is the surface.
  Widget _pane({required bool twoUp, required Widget child}) =>
      twoUp ? ContentPane(child: child) : ContentPane.reading(child: child);

  // 2026-07-27 - the six-month spending trend was REMOVED, not repaired.
  //
  // It drew `[142, 156, 151, 168, 174, total]` against labels Feb..Jul: five
  // invented figures and one real one, presented as the user's own history. The
  // app stores no spending history at all, so there was nothing to plot and no
  // way to make the series honest.
  //
  // Everything left on this screen is computed from the subscriptions actually
  // held. When real history exists, a trend can come back and be true.
}
