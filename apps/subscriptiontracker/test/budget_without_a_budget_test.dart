// ─────────────────────────────────────────────────────────────────────────────
// A SURFACE WITH NO BUDGET MAY NOT REPORT AGAINST ONE.
//
// ── WHAT THE STORE FRAMES SHOWED ────────────────────────────────────────────
// Both `04-budget.png` frames merged as `9f548515` read "$0 Budget", "$0 Left"
// and a DANGER-red "0% over budget" beside a real spend. `/budget` returns
// `monthly_budget: 0` for a user who has never set one, `BudgetInfo.usageOf`
// then computes `over: spend > 0`, and the old Budget screen printed it.
//
// ⏱ 2026-09-29 · ST-D3 D3-3: the Budget tab is gone (ADR 077 §A) and the
// budget is a card on Insights with an editor that CAN set one (D3-2). The
// invariant moves with it and is re-pinned against the card: no budget means no
// meter, no "left", no "over", no "$0" — and the one thing offered is the
// control that sets a budget.
//
// ── THE GREEN CONTROL IS IN THIS FILE, DELIBERATELY ─────────────────────────
// The first group pumps the SAME card with a real budget and asserts the words,
// the meter and the red arm ARE there. Without it, "absent" is satisfied by a
// card that failed to build.
//
// MUTATION PROOF: drop the `if (!hasBudget)` arm in `budget_card.dart` and the
// no-budget group goes red on the "over budget" words and the meter.
// ─────────────────────────────────────────────────────────────────────────────
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/misc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';
import 'package:subscriptiontracker/data/models/budget_info.dart';
import 'package:subscriptiontracker/data/models/subscription.dart';
import 'package:subscriptiontracker/data/subscriptions/subscription_repository.dart';
import 'package:subscriptiontracker/features/insights/budget_card.dart';
import 'package:subscriptiontracker/features/insights/insights_screen.dart';
import 'package:subscriptiontracker/state/providers.dart';
import 'package:subscriptiontracker/state/settings_controller.dart';

import 'support/width_harness.dart';

/// What `/budget` returns for a user who has never set one: a bare zero, with
/// no categories and no currency of its own — the WIRE shape.
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
      // More than `_set`'s $200, so the green control exercises the OVER arm.
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

Future<void> _pump(WidgetTester tester, BudgetInfo budget) async {
  await pumpAt(
    tester,
    const Size(420, 2400),
    const InsightsScreen(),
    overrides: <Override>[
      subscriptionRepositoryProvider.overrideWithValue(_Repo(budget)),
      currencyCodeProvider.overrideWithValue('USD'),
    ],
  );
  expect(
    find.byKey(const Key('insights.budget')),
    findsOneWidget,
    reason:
        'the budget card is not on screen, so every assertion below would '
        'pass against a screen that never built',
  );
}

Finder _inCard(Finder f) =>
    find.descendant(of: find.byKey(const Key('insights.budget')), matching: f);

void main() {
  group('GREEN CONTROL — a real budget reports against itself', () {
    testWidgets('the over-budget verdict is stated in words, in danger', (
      WidgetTester tester,
    ) async {
      await _pump(tester, _set);
      final Finder words = find.byKey(const Key('insights.budget.words'));
      expect(tester.widget<Text>(words).data, contains('over budget'));
      final BuildContext ctx = tester.element(words);
      expect(
        tester.widget<Text>(words).style?.color,
        StatusTones.of(ctx).danger,
      );
      expect(find.byKey(BudgetCard.meter), findsOneWidget);
      expect(_inCard(find.text('Edit')), findsOneWidget);
    });
  });

  group('no budget set — the card claims nothing and offers the control', () {
    testWidgets('🔴 no meter and no verdict', (WidgetTester tester) async {
      await _pump(tester, _unset);
      expect(find.byKey(BudgetCard.meter), findsNothing);
      expect(find.byKey(const Key('insights.budget.words')), findsNothing);
      expect(_inCard(find.textContaining('over budget')), findsNothing);
      expect(_inCard(find.textContaining('left this month')), findsNothing);
    });

    testWidgets(r'🔴 no "$0" anywhere on the card', (
      WidgetTester tester,
    ) async {
      await _pump(tester, _unset);
      expect(_inCard(find.textContaining(r'$0')), findsNothing);
    });

    testWidgets('the one thing offered is the control that sets a budget', (
      WidgetTester tester,
    ) async {
      await _pump(tester, _unset);
      expect(_inCard(find.text('Set a budget')), findsOneWidget);
      expect(
        _inCard(
          find.text(
            'Set a monthly budget to see what is left each '
            'month.',
          ),
        ),
        findsOneWidget,
      );
    });
  });
}
