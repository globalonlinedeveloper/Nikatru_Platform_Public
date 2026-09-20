// ─────────────────────────────────────────────────────────────────────────────
// A SET OF PARTS PRINTED BESIDE THEIR WHOLE MUST ADD UP TO IT — on the two
// screens that print one.
//
// 🔴 THE DEFECT WAS NEVER ARITHMETIC, SO ONLY THE STRINGS CAN CATCH IT.
// `SubMath.categoryTotals` and `SubMath.totalMonthly` fold the same
// subscriptions and their minor units agree exactly. What disagreed was the
// RENDERING: the insights donut's centre showed the rounded SUM while its
// legend showed the sum of ROUNDED rows, and those differ whenever the
// fractions each row discards add past a unit. Read directly off the Play
// listing capture of 2026-09-20 — `$93` in the ring, a legend reading
// 39 + 20 + 16 + 11 + 5 + 3 = 94 beside it
// (O-INSIGHTS-DONUT-TOTAL-DISAGREES-WITH-ITS-LEGEND).
//
// So every assertion below reads the rendered `Text` back out of the tree and
// adds the column up the way a store reviewer would. A case written against
// `Money` values would pass against the defect it is named for.
//
// ⚠️ THE FIXTURE IS CHOSEN TO BE THREE DOLLARS WRONG, NOT ONE. Each of the six
// categories rounds DOWN, so the naive rendering is short by three whole units
// — far outside anything a one-cent tolerance could absorb, and the `control`
// case in each group proves that is really the input being fed.
//
// MUTATION PROOF (run 2026-09-20, recorded in the PR): replacing the
// apportioned `figures.parts[i]` in `insights_screen.dart` with
// `money.formatBagRounded(cats[i].value)` turns the insights case red at
// 94 != 97; the same swap in `budget_screen.dart` turns the budget case red.
// ─────────────────────────────────────────────────────────────────────────────
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:subscriptiontracker/core/format/money_format.dart';
import 'package:subscriptiontracker/core/format/sub_math.dart';
import 'package:subscriptiontracker/data/models/budget_info.dart';
import 'package:subscriptiontracker/data/models/subscription.dart';
import 'package:subscriptiontracker/data/subscriptions/subscription_repository.dart';
import 'package:subscriptiontracker/features/budget/budget_screen.dart';
import 'package:subscriptiontracker/features/insights/insights_screen.dart';
import 'package:subscriptiontracker/state/providers.dart';

import 'support/width_harness.dart';

/// Six categories, one subscription each, every one of them a price whose cents
/// are thrown away by a whole-unit rendering. 39.49 + 20.20 + 16.49 + 11.49 +
/// 5.49 + 3.49 = 96.65, which prints as `$97` — while the six rows printed on
/// their own read 39 + 20 + 16 + 11 + 5 + 3 = 94.
const List<(String, int)> _lossy = <(String, int)>[
  ('Fitness', 3949),
  ('AI tools', 2020),
  ('Streaming', 1649),
  ('Music', 1149),
  ('News', 549),
  ('Cloud', 349),
];

List<Subscription> _subs() => <Subscription>[
  for (final (String category, int cents) in _lossy)
    Subscription(
      id: category,
      name: category,
      category: category,
      price: Money(cents, 'USD'),
      cycle: BillingCycle.monthly,
      nextRenewal: DateTime(2030, 1, 1),
    ),
];

/// A budget comfortably above the spend, so nothing is `over` and no bar is
/// recoloured — this file is about the FIGURES, not the meters.
const BudgetInfo _budget = BudgetInfo(
  monthlyBudget: Money(20000, 'USD'),
  categories: <BudgetCap>[],
);

class _Repo implements SubscriptionRepository {
  @override
  Future<List<Subscription>> fetchAll() async => _subs();

  @override
  Future<BudgetInfo> budget() async => _budget;

  @override
  dynamic noSuchMethod(Invocation i) =>
      throw UnimplementedError('${i.memberName} is not under test');
}

List<Override> _overrides() => <Override>[
  subscriptionRepositoryProvider.overrideWithValue(_Repo()),
];

/// The whole dollars in a rendered figure such as `$1,234` — what a reader
/// would write down before adding the column up.
int dollarsIn(String figure) =>
    int.parse(figure.replaceAll(RegExp('[^0-9]'), '')) *
    (figure.startsWith('-') ? -1 : 1);

/// What the six rows would have printed if each were rounded on its own — the
/// shape this fix removes, recomputed here so every case can prove it is being
/// fed an input that really does disagree.
int naiveSumOfRounded() {
  const MoneyFormatter money = MoneyFormatter('en_US');
  return SubMath.categoryTotals(_subs())
      .map((CategoryTotal c) => dollarsIn(money.formatBagRounded(c.value)))
      .reduce((int a, int b) => a + b);
}

void main() {
  testWidgets('INSIGHTS — the legend adds up to the number in the ring', (
    WidgetTester tester,
  ) async {
    await pumpAt(
      tester,
      const Size(800, 1600),
      const InsightsScreen(),
      overrides: _overrides(),
    );

    final String centre = tester
        .widget<Text>(find.byKey(const Key('insights.donut.total')))
        .data!;
    final List<String> legend = <String>[
      for (int i = 0; i < _lossy.length; i++)
        tester.widget<Text>(find.byKey(Key('insights.legend.figure.$i'))).data!,
    ];

    // 🔴 VACUITY FIRST. Without this the two assertions below would also hold
    // on an input whose naive rounding happened to agree, and this file would
    // be measuring nothing at all.
    expect(
      legend,
      hasLength(6),
      reason:
          'COVERAGE LOST — the seeded six categories did not all reach the '
          'legend, so there is no column here to add up',
    );
    expect(
      naiveSumOfRounded(),
      isNot(dollarsIn(centre)),
      reason:
          'COVERAGE LOST — this fixture must be one the OLD rendering got '
          'wrong, or the case cannot fail',
    );

    expect(
      legend.map(dollarsIn).reduce((int a, int b) => a + b),
      dollarsIn(centre),
      reason:
          'a reader adding $legend must get $centre — the ring and its own '
          'legend are the same six subscriptions',
    );
    expect(centre, r'$97', reason: '39.49 + 20.20 + … + 3.49 = 96.65');
  });

  testWidgets('BUDGET — the category bars add up to the spend above them', (
    WidgetTester tester,
  ) async {
    await pumpAt(
      tester,
      const Size(800, 2400),
      const BudgetScreen(),
      overrides: _overrides(),
    );

    final List<String> bars = <String>[
      for (int i = 0; i < _lossy.length; i++)
        (tester.widget<Text>(find.byKey(Key('budget.bar.figure.$i'))).textSpan!
                as TextSpan)
            .text!,
    ];

    expect(
      bars,
      hasLength(6),
      reason: 'COVERAGE LOST — six categories were seeded and fewer drew a bar',
    );
    // The whole these bars are parts of, printed on the summary card two cards
    // up. It is the EXACT figure, cents and all, which is why the bars must sum
    // to its whole-unit reading rather than to itself.
    expect(
      find.text(r'$96.65'),
      findsOneWidget,
      reason:
          'COVERAGE LOST — the "Spent" stat is the whole this case is about; '
          'if it is not on screen the bars are parts of nothing',
    );
    expect(
      naiveSumOfRounded(),
      isNot(97),
      reason:
          'COVERAGE LOST — the fixture must be one the old rendering missed',
    );

    expect(
      bars.map(dollarsIn).reduce((int a, int b) => a + b),
      97,
      reason:
          'a reader adding $bars must reach the \$96.65 printed above them, '
          'read at the precision the bars are printed in',
    );
  });
}
