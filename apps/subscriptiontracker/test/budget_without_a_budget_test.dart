// ─────────────────────────────────────────────────────────────────────────────
// A SURFACE WITH NO BUDGET MAY NOT REPORT AGAINST ONE.
//
// ── WHAT THE STORE FRAMES SHOWED ────────────────────────────────────────────
// Both `04-budget.png` frames merged as `9f548515` read "$0 Budget", "$0 Left"
// and a DANGER-red "0% over budget" beside a real spend ($93.47 phone, $186.94
// tablet). None of those is a rendering bug: `/budget` returns
// `monthly_budget: 0` for a user who has never set one, `BudgetInfo.usageOf`
// then computes `ratio: 0` (it refuses to divide by zero) and
// `over: spend > 0`, and the card printed all three faithfully.
//
// ── WHY THE FIX IS "STOP CLAIMING", NOT "ADD THE CONTROL" ───────────────────
// MEASURED 2026-09-21, not assumed: `budget_screen.dart` contains no `onTap`,
// `onPressed`, `onChanged`, `TextField`, `Slider`, `GestureDetector`, `InkWell`
// or `showDialog`, and `ApiClient.updateBudget` has no caller anywhere outside
// `lib/data/`. THERE IS NO CONTROL IN THIS APP THAT SETS A BUDGET, and the six
// per-category "caps" on those frames do not come from one either: `capMap` is
// empty for the same reason the total is zero, so every bar falls through to
// `_softCap` — the category's OWN spend × 1.2 (40 → 48, 78 → 94). Nothing
// writes them, so there is no existing writer to extend into a total. Building
// the control would be a product increment on a destination [ADR 077] §A
// deletes, moving "the same ring, spent/left stats, donut and per-category
// caps" into /insights — so it would be built here in order to be moved.
//
// ── THE GREEN CONTROL IS IN THIS FILE, DELIBERATELY ─────────────────────────
// The first group pumps the SAME screen with a real budget and asserts all
// three strings ARE there, including the red arm. Without it, "the strings are
// absent" is satisfied by a screen that failed to build at all — which is how a
// negative assertion stops being able to fail.
//
// MUTATION PROOF: restore `final bool over = usage.over;` and the no-budget
// group's ring case goes red on the danger colour; drop the `if (hasBudget)`
// from the stats row and its stats case goes red on the "$0" it prints.
// ─────────────────────────────────────────────────────────────────────────────
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/intl.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';
import 'package:subscriptiontracker/core/format/money_format.dart';
import 'package:subscriptiontracker/data/models/budget_info.dart';
import 'package:subscriptiontracker/data/models/subscription.dart';
import 'package:subscriptiontracker/data/subscriptions/subscription_repository.dart';
import 'package:subscriptiontracker/features/budget/budget_screen.dart';
import 'package:subscriptiontracker/features/shared/painters.dart';
import 'package:subscriptiontracker/l10n/app_localizations.dart';
import 'package:subscriptiontracker/state/providers.dart';
import 'package:subscriptiontracker/state/settings_controller.dart';

import 'support/width_harness.dart';

/// What `/budget` returns for a user who has never set one: a bare zero, with
/// no categories and no currency of its own. Built through `fromJson` rather
/// than by constructor so the fixture is the WIRE shape, not a hand-made
/// object that happens to agree with it.
final BudgetInfo _unset = BudgetInfo.fromJson(<String, dynamic>{});

/// A budget that exists — the green control for every negative below.
const BudgetInfo _set = BudgetInfo(
  monthlyBudget: Money(20000, 'USD'),
  categories: <BudgetCap>[BudgetCap('Streaming', Money(6000, 'USD'))],
);

class _Repo implements SubscriptionRepository {
  _Repo(this._budget);
  final BudgetInfo _budget;

  @override
  Future<List<Subscription>> fetchAll() async => <Subscription>[
    Subscription(
      id: 'streamer',
      name: 'Streamer',
      category: 'Streaming',
      // More than `_set`'s $200, so the green control exercises the OVER arm —
      // the one that paints danger and says "over budget".
      price: const Money(29999, 'USD'),
      cycle: BillingCycle.monthly,
      nextRenewal: DateTime(2030, 1, 1),
    ),
  ];

  @override
  Future<BudgetInfo> budget() async => _budget;

  @override
  dynamic noSuchMethod(Invocation i) =>
      throw UnimplementedError('${i.memberName} is not under test');
}

/// The screen, tall enough that nothing is off-stage — a `findsNothing` over a
/// surface that clipped the row it is looking for is not a measurement.
Future<void> _pumpBudget(WidgetTester tester, BudgetInfo budget) async {
  await pumpAt(
    tester,
    const Size(420, 2400),
    const BudgetScreen(),
    overrides: <Override>[
      subscriptionRepositoryProvider.overrideWithValue(_Repo(budget)),
    ],
  );
  expect(
    find.byKey(const Key('budget.summary')),
    findsOneWidget,
    reason:
        'the summary card is not on screen, so every assertion below would '
        'pass against a screen that never built',
  );
}

AppLocalizations _l10n(WidgetTester tester) =>
    AppLocalizations.of(tester.element(find.byType(BudgetScreen)));

/// The ring's painter, read off the `CustomPaint` the card builds — the arc
/// carries the over/under verdict in its COLOUR, which no string assertion can
/// see.
RingPainter _ring(WidgetTester tester) {
  final Finder paints = find.descendant(
    of: find.byKey(const Key('budget.summary')),
    matching: find.byType(CustomPaint),
  );
  for (final Element e in paints.evaluate()) {
    final CustomPaint p = e.widget as CustomPaint;
    if (p.painter is RingPainter) return p.painter! as RingPainter;
  }
  fail('the summary card draws no RingPainter');
}

/// Every `Text` on the summary card that is painted in [AppColors.danger].
///
/// Structure, not prose: the red "0% over budget" is a colour decision, and a
/// translation or a reworded key would walk straight past `find.text`.
int _dangerTexts(WidgetTester tester) {
  final Finder texts = find.descendant(
    of: find.byKey(const Key('budget.summary')),
    matching: find.byType(Text),
  );
  int n = 0;
  for (final Element e in texts.evaluate()) {
    if ((e.widget as Text).style?.color == AppColors.danger) n++;
  }
  return n;
}

/// The reader's chosen currency, read off the running screen rather than
/// assumed: a bare wire budget takes it (`BudgetInfo.inCurrency`), so it is the
/// unit the "$0" on the frame was printed in.
String _readerCurrency(WidgetTester tester) => ProviderScope.containerOf(
  tester.element(find.byType(BudgetScreen)),
).read(currencyCodeProvider);

/// The screen's own rendering of a zero in the budget's currency — computed
/// through the formatter the screen uses, never spelled here, so a locale or a
/// currency change cannot leave this assertion looking for a string nothing
/// prints.
String _zero(WidgetTester tester) {
  final String code = _readerCurrency(tester);
  return MoneyFormatter(
    _l10n(tester).localeName,
    emptyCurrencyCode: code,
  ).formatRounded(Money(0, code));
}

void main() {
  group('GREEN CONTROL — with a budget, the card reports against it', () {
    testWidgets('the over-budget verdict is stated, in red', (
      WidgetTester tester,
    ) async {
      await _pumpBudget(tester, _set);
      expect(_ring(tester).color, AppColors.danger);
      expect(_dangerTexts(tester), greaterThan(0));
      expect(find.text(_l10n(tester).overBudget), findsOneWidget);
      // $299.99 of $200, which `usageOf` clamps to a ratio of 1 — so the
      // card states "100%". The kind of figure the no-budget case must not.
      expect(
        find.text(
          NumberFormat.percentPattern(_l10n(tester).localeName).format(1),
        ),
        findsOneWidget,
      );
    });

    testWidgets('the Budget and Left stats are present', (
      WidgetTester tester,
    ) async {
      await _pumpBudget(tester, _set);
      expect(find.text(_l10n(tester).statBudget), findsOneWidget);
      expect(find.text(_l10n(tester).statLeft), findsOneWidget);
      expect(find.text(_l10n(tester).statSpent), findsOneWidget);
    });
  });

  group('with NO budget set, the card makes no comparison', () {
    testWidgets('🔴 no red verdict anywhere on the card', (
      WidgetTester tester,
    ) async {
      await _pumpBudget(tester, _unset);
      final RingPainter ring = _ring(tester);
      expect(
        ring.color,
        isNot(AppColors.danger),
        reason:
            'the ring is painted as an overspend against a budget nobody set '
            '— the frame defect, in the one channel a string test cannot see',
      );
      expect(ring.progress, 0);
      expect(
        _dangerTexts(tester),
        0,
        reason: 'a danger-coloured figure is still stating the verdict',
      );
      expect(find.text(_l10n(tester).overBudget), findsNothing);
      expect(find.text(_l10n(tester).ofBudget), findsNothing);
      // The frame's "0%": rendered through the same locale pattern the card
      // uses, so it is the string the card would print, in any locale.
      expect(
        find.text(
          NumberFormat.percentPattern(_l10n(tester).localeName).format(0),
        ),
        findsNothing,
        reason: 'the ring centre still states a percentage of no budget',
      );
    });

    testWidgets('🔴 no "\$0 Budget" and no "\$0 Left"', (
      WidgetTester tester,
    ) async {
      await _pumpBudget(tester, _unset);
      final AppLocalizations l10n = _l10n(tester);
      expect(find.text(l10n.statBudget), findsNothing);
      expect(find.text(l10n.statLeft), findsNothing);
      expect(
        find.text(_zero(tester)),
        findsNothing,
        reason:
            'a zero is still printed as a figure on this card — the frames '
            'read "\$0 Budget" and "\$0 Left" beside a real spend',
      );
    });

    testWidgets('the one figure it DOES know is still stated', (
      WidgetTester tester,
    ) async {
      await _pumpBudget(tester, _unset);
      final AppLocalizations l10n = _l10n(tester);
      // Not a consolation prize: a card that dropped the spend too would pass
      // both negatives above by rendering nothing at all.
      expect(find.text(l10n.statSpent), findsOneWidget);
      // `format`, not `formatRounded`: the ring centre renders the whole bag
      // at each amount's own precision, which is what `formatBag` does for a
      // single-currency user.
      expect(
        find.text(
          MoneyFormatter(
            l10n.localeName,
            emptyCurrencyCode: _readerCurrency(tester),
          ).format(const Money(29999, 'USD')),
        ),
        findsOneWidget,
      );
    });
  });
}
