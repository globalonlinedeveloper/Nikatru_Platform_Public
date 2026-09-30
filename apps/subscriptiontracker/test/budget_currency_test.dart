// 🔴 THE PROOF THAT A BUDGET IS NEVER RELABELLED INTO ANOTHER CURRENCY.
//
// Review item 4: `BudgetInfo.inCurrency(code)` rebuilt `Money(minorUnits, code)`
// — so a ₹5,000 budget became $5,000 the moment the user tapped the dollar
// chip, with no rate anywhere. The fix is in the MODEL (the Budget screen folded
// into the Insights budget card in ST-D3, ADR 077): a budget whose currency was RECORDED
// keeps it; only figures that arrived bare (the server's `/budget` returns a
// number with no currency) take the reader's choice, because for them that is
// the only unit the digits could mean.
//
// MUTATION PROOF (run and recorded in the PR): delete
// `if (currencyKnown) return this;` from `BudgetInfo.inCurrency` and the
// model case and the screen case go red.
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_core/nikatru_core.dart' show MoneyBag;
import 'package:subscriptiontracker/data/models/budget_info.dart';
import 'package:subscriptiontracker/data/models/subscription.dart';
import 'package:subscriptiontracker/data/subscriptions/subscription_repository.dart';
import 'package:subscriptiontracker/features/insights/insights_screen.dart';
import 'package:subscriptiontracker/state/providers.dart';
import 'package:subscriptiontracker/state/settings_controller.dart';

import 'support/width_harness.dart';

/// Five thousand rupees, recorded as rupees.
const BudgetInfo _inr = BudgetInfo(
  monthlyBudget: Money(500000, 'INR'),
  categories: <BudgetCap>[BudgetCap('Streaming', Money(150000, 'INR'))],
);

class _Repo implements SubscriptionRepository {
  _Repo(this._budget, this._subs);
  final BudgetInfo _budget;
  final List<Subscription> _subs;

  @override
  Future<List<Subscription>> fetchAll() async => _subs;

  @override
  Future<BudgetInfo> budget() async => _budget;

  @override
  dynamic noSuchMethod(Invocation i) =>
      throw UnimplementedError('${i.memberName} is not under test');
}

Subscription _usd(String id, int minor) => Subscription(
  id: id,
  name: id,
  category: 'Streaming',
  price: Money(minor, 'USD'),
  cycle: BillingCycle.monthly,
  nextRenewal: DateTime(2030, 1, 1),
);

void main() {
  group('the model refuses to relabel', () {
    test(
      '🔴 a RECORDED ₹5,000 budget stays ₹5,000 when the reader picks USD',
      () {
        final BudgetInfo shown = _inr.inCurrency('USD');
        expect(shown.monthlyBudget, const Money(500000, 'INR'));
        expect(shown.categories.single.cap, const Money(150000, 'INR'));
        expect(shown.currencyCode, 'INR');
      },
    );

    test('a BARE wire figure takes the reader\'s currency — the only meaning '
        'it has', () {
      final BudgetInfo bare = BudgetInfo.fromJson(<String, dynamic>{
        'monthly_budget': 5000,
        'categories': <Object?>[
          <String, dynamic>{'name': 'Streaming', 'cap': 1500},
        ],
      });
      expect(bare.currencyKnown, isFalse);
      final BudgetInfo shown = bare.inCurrency('INR');
      expect(shown.monthlyBudget, const Money(500000, 'INR'));
      expect(shown.categories.single.cap, const Money(150000, 'INR'));
    });

    test(
      'a budget this client wrote reads back KNOWN, whatever the default',
      () {
        final BudgetInfo back = BudgetInfo.fromJson(_inr.toJson());
        expect(back.currencyKnown, isTrue);
        expect(back.monthlyBudget, const Money(500000, 'INR'));
        expect(
          back.inCurrency('USD').monthlyBudget,
          const Money(500000, 'INR'),
        );
      },
    );

    test('a bare budget is cached WITHOUT an invented currency', () {
      final BudgetInfo bare = BudgetInfo.fromJson(<String, dynamic>{
        'monthly_budget': 5000,
      }).inCurrency('INR');
      final Map<String, dynamic> j = bare.toJson();
      expect(j.containsKey('currency'), isFalse);
      expect(BudgetInfo.fromJson(j).currencyKnown, isFalse);
    });

    test('spending is measured in the BUDGET\'s currency, never throwing', () {
      final MoneyBag onlyDollars = MoneyBag.sum(<Money>[
        const Money(999900, 'USD'),
      ]);
      final BudgetUsage u = _inr.usageOf(onlyDollars);
      expect(u.spentHere, const Money(0, 'INR'));
      expect(u.over, isFalse);
      expect(u.ratio, 0);

      final BudgetUsage over = _inr.usageOf(
        MoneyBag.sum(<Money>[const Money(600000, 'INR')]),
      );
      expect(over.over, isTrue);
      expect(over.ratio, 1);
    });
  });

  testWidgets(
    '🔴 the Insights budget card shows the ₹ budget to a reader who chose '
    'USD, and never a \$5,000',
    (WidgetTester tester) async {
      final MemStore store = MemStore();
      await pumpAt(
        tester,
        const Size(800, 2400),
        const InsightsScreen(),
        overrides: <Override>[
          keyValueStoreProvider.overrideWith((_) async => store),
          subscriptionRepositoryProvider.overrideWithValue(
            _Repo(_inr, <Subscription>[_usd('netflix', 1599)]),
          ),
        ],
      );
      final ProviderContainer c = ProviderScope.containerOf(
        tester.element(find.byType(InsightsScreen)),
      );
      await c.read(settingsControllerProvider.notifier).setCurrency('USD');
      for (int i = 0; i < 6; i++) {
        await tester.pump();
      }

      expect(find.textContaining('₹5,000'), findsWidgets);
      expect(find.textContaining(r'$5,000'), findsNothing);
    },
  );
}
