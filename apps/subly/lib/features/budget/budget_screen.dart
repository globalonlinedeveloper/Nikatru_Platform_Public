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
import '../shared/neutrals.dart';
import '../shared/painters.dart';
import '../shared/widgets.dart';

final FutureProvider<BudgetInfo> budgetProvider = FutureProvider<BudgetInfo>(
  (ref) => ref.watch(subscriptionRepositoryProvider).budget(),
);

/// 📌 THE PRIVATE `_neutrals(BuildContext)` THAT STOOD HERE IS HOISTED
/// (2026-08-25) into `features/shared/neutrals.dart` as `neutrals(context)`,
/// together with the whole doc that recorded why light is the literal token and
/// why dark derives from the seed. The triplication was deliberate for exactly
/// one increment and its own doc said so; this is the closing cleanup it named,
/// landed with the deletion of `DueInfo.of`. Read the argument there.

/// The gap this page has always spent between two category bars.
///
/// Named rather than left as a bare `10` because the two-column layout below
/// spends it on the HORIZONTAL axis too: one number, so the grid has one
/// rhythm, and no new number enters the file to do it.
const double _barGap = 10;

/// Whether a stack of [cardCount] cards should be laid out two-up in [width].
///
/// 🔴 THE SECOND CONDITION IS NOT DEFENSIVE PADDING. Width alone is not enough:
/// one card in a two-column grid is a card beside a hole. Here that is a real
/// state and not a hypothetical — a user tracking subscriptions in a single
/// category has exactly one bar, and it stays in one column at any width.
///
/// ⚠️ 1200 IS A BODY WIDTH, NOT A WINDOW WIDTH, AND THE TWO ARE 361px APART.
/// `AppScaffold` hands the body `min(W - 361, 1280)` — the 360px drawer and its
/// 1px divider are taken off the top first — so the second column appears at a
/// WINDOW width of 1561, not 1200. That is the honest seam anyway: the question
/// is how much room this screen was actually handed to divide, and the answer
/// is its own incoming constraints, not the size of the display.
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
/// ⚠️ `CrossAxisAlignment.stretch` on each column is what keeps the bars
/// looking as they do in one column: a `Container` with no width shrink-wraps
/// its child, and it is only the `ListView`'s tight cross-axis constraint that
/// makes today's bars full-bleed. Inside a `Row` that constraint is gone.
///
/// ⚠️ `MainAxisSize.min` on both columns and `CrossAxisAlignment.start` on the
/// `Row`: this lives inside a `ListView`, so the incoming height is unbounded
/// and the columns must shrink-wrap. The two columns are top-aligned and end
/// wherever their own content does — they are not forced to equal heights,
/// which would stretch whichever column has less in it.
///
/// ⚠️ Duplicated verbatim in `insights_screen.dart`, for the reason the hoisted
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
          key: const Key('budget.bars.left'),
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: left,
        ),
      ),
      SizedBox(width: gap),
      Expanded(
        child: Column(
          key: const Key('budget.bars.right'),
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: right,
        ),
      ),
    ],
  );
}

class BudgetScreen extends ConsumerWidget {
  const BudgetScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final ({Color ink, Color muted, Color line}) neutral = neutrals(context);
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

    // The ring card and the category bars are built ONCE and then laid out in
    // one column or two. Building each element once is the whole trick: the
    // commonest way a responsive branch rots is that one arm gains an element
    // and the other does not, and nothing goes red because both arms still
    // render something.
    final Widget ringCard = Container(
      // Keyed so `test/width_budget_test.dart` can measure the width this
      // card is OFFERED. It is the one element on the page whose offered
      // width differs between the two layouts — the bars follow their
      // column and the headings follow the pane, but this card is held at
      // `reading` inside a 1244px page, and nothing else would notice if
      // that hold were dropped.
      key: const Key('budget.summary'),
      padding: const EdgeInsets.all(24),
      decoration: cardDecoration(context),
      child: Column(
        children: <Widget>[
          SizedBox(
            width: 168,
            height: 168,
            // 🔴 THE ARC IS A `CustomPaint`, SO IT ANNOUNCES NOTHING, and
            // what it was hiding here is worse than on the insights donut:
            // `pct` is CLAMPED to 1 four statements up, so a user £400
            // over budget hears "100%" — a figure that is true of being
            // exactly on budget too. The overspend exists ONLY in the
            // colour (danger red) and in the two words underneath. Colour
            // is not a channel a screen reader has.
            //
            // So the label carries the two REAL figures — `total` and
            // `budgetVal`, the same pair `pct` was computed from — and the
            // over/under distinction comes from a whole second key rather
            // than a clause glued in front of the first. `overBudget` /
            // `ofBudget` are the visible words and could have been
            // interpolated; two complete sentences is the rule this
            // codebase already records (`newHerePrompt`, `poweredByLine`),
            // because where the clause SITS in the sentence is the
            // translator's call and a prefix takes that away.
            //
            // `excludeSemantics` for the same reason as the donut: the
            // centre `Text`s are the percent and that same over/of word,
            // both of which the label now states in context.
            //
            // `container: true` for the reason `insights_screen.dart`
            // records against its donut: an absorbed annotation glues the
            // ring's sentence to the three stat boxes below it and the
            // chart stops being something a reader can land on.
            child: Semantics(
              container: true,
              label: over
                  ? l10n.a11yBudgetRingOver(
                      currency.fmt(total),
                      currency.fmt0(budgetVal),
                      NumberFormat.percentPattern(l10n.localeName).format(pct),
                    )
                  : l10n.a11yBudgetRing(
                      currency.fmt(total),
                      currency.fmt0(budgetVal),
                      NumberFormat.percentPattern(l10n.localeName).format(pct),
                    ),
              excludeSemantics: true,
              child: CustomPaint(
                painter: RingPainter(
                  progress: pct,
                  color: over ? AppColors.danger : AppColors.accent,
                  // The UNFILLED remainder of the ring is a neutral, so it has
                  // to move with the surface — the same rule, and the same
                  // value, as the category meters' `backgroundColor` at the
                  // bottom of this file. `RingPainter` has no `BuildContext`,
                  // so this is the only place the resolution can happen.
                  //
                  // Measured on the dark card (#35343A): the baked
                  // `AppColors.line` default this replaces read 10.48:1 while
                  // the arc it backs read 2.52:1 — the empty half of the gauge
                  // was 4.16:1 BRIGHTER than the filled half, so the ring read
                  // inside-out. `neutral.line` (#47464F) reads 1.32:1 and puts
                  // the arc 1.90:1 above its own track (2.63:1 when `over`
                  // paints it `danger` #EF4D6A).
                  //
                  // Light is byte-identical: `neutral.line` IS `AppColors.line`
                  // there, still 1.18:1 on this card's #FFFFFF.
                  track: neutral.line,
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
    );

    final List<Widget> bars = <Widget>[
      for (int i = 0; i < cats.length; i++)
        // ⚠️ SILENT DEFAULT, carried over unchanged: a category with no
        // configured cap gets `value * 1.2`, so its bar always renders at 83%
        // and can never read as over budget. That is a product decision, not a
        // bug — recorded here because the number looks like an arbitrary
        // constant at the call site.
        _categoryBar(
          context,
          currency,
          cats[i],
          capMap[cats[i].name] ?? cats[i].value * 1.2,
          i,
        ),
    ];

    // 🔴 THE `LayoutBuilder` SITS OUTSIDE THE PANE, AND THAT IS NOT STYLE.
    // `app_spacing.dart`'s `pagePadding` tombstone records this exact trap: a
    // `LayoutBuilder` INSIDE a `ContentPane` measures the PANE, so on a 1920
    // window it reads 720 and every branch taken on it is confidently wrong
    // with nothing to show for it. Out here it reads the body width the chassis
    // handed down, which is the width there actually is to divide.
    return LayoutBuilder(
      builder: (BuildContext _, BoxConstraints constraints) {
        // TWO COLUMNS FROM `AppBreakpoints.large` (1200) UP — see `_twoUp` for
        // why the bar count is half the condition and why 1200 of BODY is 1561
        // of WINDOW.
        final bool twoUp = _twoUp(constraints.maxWidth, bars.length);

        return _pane(
          twoUp: twoUp,
          child: ListView(
            // 🔀 P3 PORT — PADDING RE-BASED FOR THE CHASSIS SHELL.
            // Live was `fromLTRB(18, 58, 18, 108)`. Both odd numbers were
            // paying for the old shell: 58 cleared a status bar under a
            // `Scaffold` with no app bar, and 108 cleared `AppShell`'s floating
            // pill bar plus its FAB. `AppScaffold._compact()` wraps the body in
            // a `SafeArea` and puts the navigation in `bottomNavigationBar`, so
            // both insets are now paid twice. 18 is `AppSpacing.gutterCompact`,
            // the chassis's page gutter.
            padding: const EdgeInsets.fromLTRB(
              AppSpacing.gutterCompact,
              AppSpacing.gutterCompact,
              AppSpacing.gutterCompact,
              AppSpacing.xl,
            ),
            children: <Widget>[
              // The heading stays FULL WIDTH in both layouts. It is the page's
              // one label, not a card, and splitting a title across a column
              // boundary would make the grid look like two pages.
              Text(
                l10n.budgetTitle,
                style: AppText.title.copyWith(fontSize: 26, color: neutral.ink),
              ),
              const SizedBox(height: 4),
              Text(
                // 🔴 THE HARDCODED ENGLISH `_months` TABLE IS GONE. It was
                // never a translation problem so much as a data one: `intl`
                // already ships month names for every locale, so an arb key for
                // "January" would have been asking a translator for something
                // the SDK knows. `DateFormat.yMMMM` also carries the ORDER —
                // "August 2026" in en, and whatever the locale puts first
                // elsewhere, which the interpolated month-then-year string
                // could never do. Measured: `en` renders "August 2026",
                // byte-identical to the table it replaces.
                DateFormat.yMMMM(l10n.localeName).format(now),
                style: AppText.muted.copyWith(
                  fontSize: 12,
                  color: neutral.muted,
                ),
              ),
              const SizedBox(height: 16),
              if (twoUp) _heldAtReading(ringCard) else ringCard,
              // ⚠️ `byCategory` is SHARED with `insights_screen.dart` — one
              // heading over the same breakdown, so one key. And
              // `SectionHeader` itself paints with `AppText.title`'s baked
              // `AppColors.ink`, which this file cannot reach: it lives in
              // `features/shared/widgets.dart`. Named in this increment's
              // report.
              //
              // Full width in both layouts, and above the grid rather than
              // inside a column: it labels ALL the bars, so putting it in one
              // column would claim it labels half of them.
              SectionHeader(l10n.byCategory),
              if (twoUp)
                _twoColumnCards(bars, _barGap)
              else
                for (final Widget bar in bars)
                  Padding(
                    padding: const EdgeInsets.only(bottom: _barGap),
                    child: bar,
                  ),
            ],
          ),
        );
      },
    );
  }

  /// The ring card, held at [AppBreakpoints.reading] inside a wider page.
  ///
  /// 🔴 ONLY THE CATEGORY BARS ARE A STACK. The ring card is this page's single
  /// summary and there is no second one to sit beside it, so the two-column
  /// layout leaves it alone — and "leaves it alone" has to mean the width it
  /// already had, not the width of the grid underneath it. At the two-up cap
  /// the page content box is 1244, and a 168px ring centred in that above three
  /// `spaceEvenly` stats ~240px apart is precisely the sprawl the second column
  /// exists to end. 720 is what this card renders at today at every size from
  /// 768 up, so holding it there changes no pixels in it.
  ///
  /// ⚠️ DELIBERATELY NOT A NESTED `ContentPane`, even though that is the
  /// primitive for this shape. `test/support/width_harness.dart` states in its
  /// own header that `inPane` cannot tell one pane from another and that a
  /// screen with two panes must switch to `inPaneOf` with keys; adding a second
  /// pane here would quietly make this screen that screen, and the measurement
  /// that broke would be some other test's. Same three widgets, no ambiguity.
  ///
  /// `topCenter`, never `Alignment.center`: a `ListView` child that centres
  /// vertically moves whenever its own height changes. `ContentPane`'s class
  /// doc carries the full reasoning.
  Widget _heldAtReading(Widget child) => Align(
    alignment: Alignment.topCenter,
    child: ConstrainedBox(
      constraints: const BoxConstraints(maxWidth: AppBreakpoints.reading),
      child: child,
    ),
  );

  /// The pane that caps this page, and its cap MOVES WITH THE COLUMN COUNT.
  ///
  // 🔀 P3 PORT — THE WIDTH DECISION THIS SCREEN NEVER HAD.
  //
  // Same defect and same fix as home's `ContentPane` (home_screen.dart:119).
  // `AppScaffold` caps the body at `kMaxBodyWidth` only in its EXTRA-LARGE
  // class (>=1600), so between 1200 and 1599 every category bar took every
  // pixel the drawer left it. Nothing overflowed and nothing clipped, so no
  // assertion could fail; only a MEASUREMENT sees it, which is what
  // `test/width_budget_test.dart` is.
  //
  // 🔴 CORRECTED 2026-08-21 — THIS COMMENT CLAIMED "a 1550 px progress meter"
  // AND ALSO THAT THE BAR GREW TO "THE FULL WINDOW". Both are impossible.
  // `AppScaffold` hands the body `min(W - 361, 1280)` — the 360px drawer and
  // its 1px divider come off the top first, so the body is NEVER the window —
  // which makes 1280 the ceiling at any width, and 1599-361 = 1238 the ceiling
  // inside the LARGE class. At W=1500 the pane gets 1139; at W=1440, 1079.
  // Less the 18/18 page gutters and the bar card's 15/15 padding, the widest a
  // meter has ever been is ~1214: still a name at one edge and a figure at the
  // other with a third of a screen of nothing between them, so the DEFECT was
  // real and only the number was invented. The shipped pixels never depended
  // on it.
  //
  // 🔴 ONE COLUMN → `.reading` (720), the cap this file has carried since the
  // P3 port, and the reasoning is unchanged. A progress meter is the element
  // that degrades WORST when stretched: it is a length the eye has to judge
  // against a track, and past ~800px a 3% overspend and a 6% one look
  // identical. (The `kMaxBodyWidth` default this file carried BEFORE the port
  // was wrong for a different reason: 1280 is also the most the body can ever
  // be handed, so that cap never bound at any real window.)
  //
  // 🔴 TWO COLUMNS → the default `kMaxBodyWidth` (1280), AND THAT IS NOT A
  // REVERSAL OF THE LINE ABOVE. The 720 argument is about how wide one METER
  // may get, and in the two-up layout there are two columns: 1280 less the
  // 18/18 page gutters less the 10px column gap leaves 617 per column, so
  // every meter is NARROWER than it is today at 768 and up — the bar the cap
  // protects is better off, not worse. Capping the two-up layout at 720
  // instead would give 355px columns, narrower than the 375px phone this page
  // is designed for.
  //
  // ✅ POLICED by `test/width_budget_test.dart`, which measures the pane AND a
  // column at each surface — the pane alone cannot fail at 1280, because 1280
  // is the surface.
  Widget _pane({required bool twoUp, required Widget child}) =>
      twoUp ? ContentPane(child: child) : ContentPane.reading(child: child);

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
    final ({Color ink, Color muted, Color line}) neutral = neutrals(context);

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
