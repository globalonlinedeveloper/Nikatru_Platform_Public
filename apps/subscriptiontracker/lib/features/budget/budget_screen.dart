import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';

import '../../core/format/money_format.dart';
import '../../core/format/sub_math.dart';
import '../../data/models/budget_info.dart';
import '../../data/models/subscription.dart';
import '../../l10n/app_localizations.dart';
import '../../state/providers.dart';
import '../../state/settings_controller.dart';
import '../../state/subscriptions_controller.dart';
import '../shared/async_gate.dart';
import '../shared/neutrals.dart';
import '../shared/painters.dart';
import '../shared/widgets.dart';
import '../shell/app_shell.dart';

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
    // The currency the BUDGET is in. A budget figure arrives from the wire with
    // no currency of its own (see `BudgetInfo.fromJson`), so the user's choice
    // is what it means — `inCurrency` below relabels it and converts nothing.
    final String currencyCode = ref.watch(currencyCodeProvider);
    final MoneyFormatter money = MoneyFormatter(
      l10n.localeName,
      emptyCurrencyCode: currencyCode,
    );
    // 🔴 THIS SCREEN CARRIED THE FAMILY DEFECT **TWICE**, in two different
    // spellings, and the second one was the more misleading of the pair.
    //
    //   · `subscriptionsControllerProvider…valueOrNull ?? const []` — a fetch
    //     in flight and a FAILED fetch both rendered as "you have no
    //     subscriptions", the defect all five screens shared.
    //   · `budgetProvider…valueOrNull == null` → a bare
    //     `Center(CircularProgressIndicator)`. `valueOrNull` is null for a
    //     failure too, so a budget request that FAILED spun forever. A spinner
    //     that never resolves is the one error state a user cannot even
    //     recognise AS an error: nothing says the wait is over, so nobody
    //     retries, and the screen is simply abandoned.
    //
    // ⚠️ RETURNING A BARE `DataStateView` HERE IS SAFE, AND IT IS NOT SAFE ON
    // EVERY SCREEN. This is a shell TAB: `AppScaffold` owns the navigation and
    // this build only ever supplies the body, so the rail, bar and drawer all
    // survive every state below. `notifications` and `detail` are pushed routes
    // that own their own chrome, and both keep it explicitly for that reason.
    final Widget? state = subscriptionsState(
      ref,
      l10n: l10n,
      emptyTitle: l10n.dataEmptyTitle,
      emptyBody: l10n.dataEmptyBody,
    );
    if (state != null) return state;
    final List<Subscription> subs = ref
        .watch(subscriptionsControllerProvider)
        .requireValue;

    // ── THE SECOND SOURCE, GATED IN THE SAME THREE WAYS ──────────────────────
    // 🔴 SEQUENCED AFTER THE LIST RATHER THAN MERGED WITH IT, and the order is
    // the argument: the list is what the page is ABOUT, so if it is missing
    // there is nothing to say about a budget either. Merging both into one
    // "anything unresolved" test would report a broken budget endpoint and a
    // broken subscription endpoint identically, and only one of those is
    // retried by re-fetching the list.
    //
    // There is no `subscriptionsState` equivalent for this provider because
    // there is no THIRD state to tell apart: `BudgetInfo` is a single record,
    // so "loaded but empty" does not exist for it — only loading and failed.
    final AsyncValue<BudgetInfo> budgetAsync = ref.watch(budgetProvider);
    if (!budgetAsync.hasValue) {
      return budgetAsync.hasError
          ? DataStateView.failed(
              title: l10n.dataFailedTitle,
              body: l10n.dataFailedBody,
              retryLabel: l10n.retry,
              // ONLY the budget is invalidated: the list above is already
              // resolved and good, and re-fetching it would throw away data the
              // user can see in order to repair data they cannot.
              onRetry: () => ref.invalidate(budgetProvider),
            )
          : DataStateView.loading(label: l10n.dataLoading);
    }
    final BudgetInfo budget = budgetAsync.requireValue.inCurrency(currencyCode);

    final DateTime now = DateTime.now();
    // 🔴 TWO FIGURES, AND THEY ARE NOT THE SAME FIGURE. `spent` is every
    // subtotal and is what the screen PRINTS, so a rupee subscription is never
    // hidden from the user. `spentHere` is only the part in the budget's own
    // currency, and it is what the RING measures — because a budget stated in
    // one currency cannot judge spending in another, and there is no rate
    // table in this app that could make it. For a single-currency user, which
    // is essentially everybody, the two are the same number.
    final MoneyBag spent = SubMath.totalMonthly(subs);
    // 🔴 MEASURED IN THE BUDGET'S OWN CURRENCY, BY THE MODEL. A recorded
    // budget is no longer relabelled into the reader's currency
    // (`BudgetInfo.inCurrency`), so it can differ from `currencyCode` — and
    // comparing unlike Money throws.
    final BudgetUsage usage = budget.usageOf(spent);
    final Money spentHere = usage.spentHere;
    final Money budgetVal = budget.monthlyBudget;
    // 🔴 "NO BUDGET" IS NOT "A BUDGET OF ZERO", AND THIS CARD SPENT ITS WHOLE
    // LIFE SAYING IT WAS. `/budget` returns `monthly_budget: 0` for a user who
    // has never set one — which is every user, because THERE IS NO CONTROL IN
    // THIS APP THAT SETS A BUDGET. Measured 2026-09-21: this file contains no
    // `onTap`, `onPressed`, `onChanged`, `TextField`, `Slider`,
    // `GestureDetector`, `InkWell` or `showDialog`, and `ApiClient.updateBudget`
    // has no caller anywhere outside `lib/data/`. The write path exists; nothing
    // reaches it.
    //
    // Against a zero budget `BudgetInfo.usageOf` is exactly right and the CARD
    // was exactly wrong: `ratio` is 0 (it refuses to divide by zero) while
    // `over` is `spend > 0`, so a real $93.47 of spending rendered as a
    // DANGER-red "0% over budget" over "$0 Budget" and "$0 Left" — three
    // statements of a comparison this surface has no second operand for. Both
    // store frames merged as `9f548515` photographed it.
    //
    // ⚠️ THE CATEGORY BARS BELOW ARE NOT EVIDENCE OF A BUDGET EITHER, which is
    // worth stating because they look like one. `capMap` is empty for the same
    // reason `budgetVal` is zero, so every bar falls to `_softCap` — the
    // category's OWN spend × 1.2. The six "caps" on those frames are derived
    // per render, not set by anybody: 40 → 48, 78 → 94.
    //
    // ✅ CORRECTED 2026-09-22 (O-BUDGET-SURFACE-HAS-NO-WAY-TO-SET-A-BUDGET, gap
    // b): the paragraph above describes the tree before this change. `_softCap`
    // is gone. A category with no cap of its own now renders its SPEND ALONE —
    // no " / cap" figure and no progress bar — because a bar is a comparison
    // and a cap nobody set is not a second operand. `_categoryBar` carries the
    // guard; `test/budget_without_a_budget_test.dart` pins both arms.
    //
    // 🔑 SO THE FIX IS THE SECOND BRANCH, NOT THE FIRST. Adding the control
    // would be a product increment on a destination [ADR 077] §A deletes —
    // "the same ring, spent/left stats, donut and per-category caps" move to
    // /insights — so it would be built here to be moved next. What the surface
    // owes today is to stop asserting a comparison it cannot make: no red
    // verdict, no "$0 Budget", no "$0 Left". The ring stays and states the one
    // figure that IS measured.
    final bool hasBudget = budgetVal.minorUnits > 0;
    final bool over = hasBudget && usage.over;
    final double pct = usage.ratio;
    final Map<String, Money> capMap = <String, Money>{
      for (final BudgetCap c in budget.categories) c.name: c.cap,
    };
    final List<CategoryTotal> cats = SubMath.categoryTotals(subs);
    // 🔴 THE BARS ARE PARTS OF `spent`, WHICH THIS PAGE PRINTS ONE CARD UP, so
    // they carry the same defect the insights donut did: each bar rounded on
    // its own shows SUM-OF-ROUNDED, and a reader adding the column gets a
    // figure the "Spent" stat does not confirm. Apportioned here once (largest
    // remainder, per currency) so the column sums to the whole-unit reading of
    // the very total beside it — see `MoneyFormatter.formatBreakdownRounded`.
    //
    // ⚠️ IT MOVES THE PRINTED FIGURE ONLY. `over`, `frac` and `_softCap` all
    // read `SubMath.chartWeight`, i.e. exact minor units, so no bar changes
    // length or colour and no category crosses its cap because of this.
    final ({List<String> parts, String total}) catFigures = money
        .formatBreakdownRounded(<MoneyBag>[
          for (final CategoryTotal c in cats) c.value,
        ]);

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
            //
            // 🔴 AND WITH NO BUDGET THERE IS NO SENTENCE TO SUBSTITUTE INTO.
            // Both arms name `{budget}` and a percentage OF it, so either one
            // read aloud against an unset budget announces the same false
            // comparison the pixels used to show. The label is dropped rather
            // than filled with a zero, and `excludeSemantics` goes with it —
            // the two `Text`s in the middle of the ring then announce
            // themselves, which is the honest reading: a figure and the word
            // for what it is. No new arb key, so no locale can drift out of
            // step with a sentence only one of them has.
            child: Semantics(
              container: true,
              label: !hasBudget
                  ? null
                  : over
                  ? l10n.a11yBudgetRingOver(
                      money.formatBag(spent),
                      money.formatRounded(budgetVal),
                      NumberFormat.percentPattern(l10n.localeName).format(pct),
                    )
                  : l10n.a11yBudgetRing(
                      money.formatBag(spent),
                      money.formatRounded(budgetVal),
                      NumberFormat.percentPattern(l10n.localeName).format(pct),
                    ),
              excludeSemantics: hasBudget,
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
                    children: !hasBudget
                        // WITH NO BUDGET THE RING HOLDS THE ONE FIGURE THIS
                        // SCREEN ACTUALLY KNOWS. `pct` is 0, so the arc is
                        // empty and reads as "nothing measured" rather than as
                        // "nothing spent" — the spend is right there in the
                        // middle of it. Both strings are keys this surface
                        // already renders, so the no-budget state invents no
                        // copy: `statSpent` is the label under the stat this
                        // replaces.
                        //
                        // `FittedBox` because a `MoneyBag` can print more than
                        // one subtotal and the ring is a fixed 168 px; scaling
                        // down is the only failure mode that is not an
                        // overflow stripe.
                        ? <Widget>[
                            Padding(
                              padding: const EdgeInsets.symmetric(
                                horizontal: 18,
                              ),
                              child: FittedBox(
                                fit: BoxFit.scaleDown,
                                child: Text(
                                  money.formatBag(spent),
                                  maxLines: 1,
                                  style: AppText.fig.copyWith(
                                    fontSize: 28,
                                    color: neutral.ink,
                                  ),
                                ),
                              ),
                            ),
                            Text(
                              l10n.statSpent,
                              style: AppText.muted.copyWith(
                                fontSize: 10,
                                color: neutral.muted,
                              ),
                            ),
                          ]
                        : <Widget>[
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
          // 🔴 THE WHOLE ROW GOES WITH THE BUDGET, NOT JUST TWO OF ITS THREE
          // STATS. "Left" is `budget - spent` and "Budget" is the budget: both
          // are the comparison this surface cannot make, and the frames printed
          // them as "$0 Left" and "$0 Budget". "Spent" survives — it moved into
          // the ring above, where it is the only figure left to state. A row of
          // one stat under a ring holding the same number would say it twice.
          if (hasBudget) const SizedBox(height: 16),
          if (hasBudget)
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceEvenly,
              children: <Widget>[
                _stat(
                  label: l10n.statSpent,
                  value: money.formatBag(spent),
                  valueColor: neutral.ink,
                  labelColor: neutral.muted,
                ),
                _stat(
                  label: l10n.statLeft,
                  value: money.formatRounded(
                    (budgetVal - spentHere).clampAtZero(),
                  ),
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
                  value: money.formatRounded(budgetVal),
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
        //
        // ✅ CORRECTED 2026-09-22: there is no default any more. A category
        // with no cap passes `null` and its card states the spend alone; the
        // invented 83% bar was the surface asserting a comparison nobody set.
        _categoryBar(
          context,
          money,
          // The bars measure in the BUDGET's currency, as the ring does.
          budget.currencyCode,
          cats[i],
          catFigures.parts[i],
          capMap[cats[i].name],
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
            //
            // ⚠️ HALF OF THAT WAS WRONG AND IS CORRECTED RATHER THAN DELETED.
            // The pill is `bottomNavigationBar` and WAS double-paid; the FAB is
            // `floatingActionButton`, which reserves nothing and floats over
            // this list, so its 72 px was dropped instead — visible in
            // `04-budget.png` of the frames merged as `9f548515`, where the "+"
            // covers the AI tools amount. [AppShell.pageInsetOf] states the
            // arithmetic once for all five branches.
            padding: AppShell.pageInsetOf(context),
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
  // ⏱ 2026-09-16 · [ADR 083]: the drawer is gone from every class. From 1200 px
  // up the body is `min(W - R - 1, 1280)`, R being the slim rail's rendered
  // width (116 px for a "Settings" label on Flutter 3.47.2). So the LARGE
  // ceiling is 1599 - R - 1 and a 1440 px window gives 1439 - R. The defect and
  // the cap below are unchanged; only these widths moved.
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
    MoneyFormatter money,
    String currencyCode,
    CategoryTotal cat,
    // This category's spend, ALREADY RENDERED — apportioned against the page's
    // own total in `build` so the column of bars adds up to it. Passed in
    // rather than formatted here, because a share only exists relative to the
    // other shares and this method can see exactly one of them.
    String spentText,
    // The cap the user SET for this category, or null. There is no default:
    // a cap nobody set is not a second operand, so without one the card
    // states the spend and draws no bar (O-BUDGET-SURFACE-HAS-NO-WAY-TO-SET-
    // A-BUDGET, gap b). A zero cap is read as unset, as the total is.
    Money? cap,
    int i,
  ) {
    final Money? setCap = cap == null || cap.minorUnits <= 0 ? null : cap;
    final bool hasBudget = setCap != null;
    // The BAR is drawn in the budget's own currency — see [SubMath.chartWeight]
    // for why a proportion cannot span two. The FIGURE beside it prints every
    // subtotal, so a foreign-currency row stays visible even where it cannot be
    // measured against a cap that is not in its units.
    final double spentHere = SubMath.chartWeight(cat.value, currencyCode);
    final bool over = setCap != null && spentHere > setCap.minorUnits;
    final double frac = setCap == null
        ? 0
        : math.min(spentHere / setCap.minorUnits, 1);
    final String? capText = setCap == null
        ? null
        : ' / ${money.formatRounded(setCap)}';
    final Color barColor = over
        ? AppColors.danger
        : AppColors.ramp[i % AppColors.ramp.length];
    final ({Color ink, Color muted, Color line}) neutral = neutrals(context);

    return Container(
      key: Key('budget.bar.$i'),
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
                // Keyed for the same reason the insights donut's centre is: the
                // property is that a reader can add this COLUMN of strings up
                // and get the total printed one card above, and only the
                // rendered strings can falsify that.
                key: Key('budget.bar.figure.$i'),
                TextSpan(
                  text: spentText,
                  style: AppText.fig.copyWith(
                    fontSize: 13,
                    color: over ? AppColors.danger : neutral.ink,
                  ),
                  children: <InlineSpan>[
                    // NOT an l10n key: ' / ' is a separator between two
                    // formatted figures, and both figures come from `Currency`.
                    if (hasBudget && capText != null)
                      TextSpan(
                        text: capText,
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
          if (hasBudget) ...<Widget>[
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
        ],
      ),
    );
  }
}
