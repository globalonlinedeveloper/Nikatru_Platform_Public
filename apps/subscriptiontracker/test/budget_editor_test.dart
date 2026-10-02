// THE BUDGET CAN BE SET — train ST-D3, label D3-2.
//
// Until D3-2, `SubscriptionRepository.saveBudget` had no caller: the old Budget
// tab was read-only and no screen could write a budget. These cases drive the
// budget card on Insights through its editor and read what reached the
// repository, so deleting the editor's `saveBudget` call turns the first one
// red — the verify the design train names ("saveBudget has a caller").

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/misc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';
import 'package:subscriptiontracker/data/models/budget_info.dart';
import 'package:subscriptiontracker/data/models/subscription.dart';
import 'package:subscriptiontracker/data/subscriptions/subscription_repository.dart';
import 'package:subscriptiontracker/features/insights/budget_card.dart';
import 'package:subscriptiontracker/features/insights/budget_editor.dart';
import 'package:subscriptiontracker/features/insights/insights_screen.dart';
import 'package:subscriptiontracker/state/money_providers.dart';
import 'package:subscriptiontracker/state/providers.dart';
import 'package:subscriptiontracker/state/settings_controller.dart';

import 'support/width_harness.dart';

class _Repo implements SubscriptionRepository {
  _Repo(this.stored, {this.failSave = false});

  BudgetInfo stored;
  final bool failSave;
  final List<BudgetInfo> saved = <BudgetInfo>[];

  @override
  Future<List<Subscription>> fetchAll() async => <Subscription>[
    Subscription(
      id: 'a',
      name: 'Streamer',
      category: 'Video',
      price: const Money(1549, 'USD'),
      cycle: BillingCycle.monthly,
      nextRenewal: DateTime(2030, 1, 1),
    ),
    Subscription(
      id: 'b',
      name: 'Tunes',
      category: 'Music',
      price: const Money(1199, 'USD'),
      cycle: BillingCycle.monthly,
      nextRenewal: DateTime(2030, 1, 4),
    ),
  ];

  @override
  Future<BudgetInfo> budget() async => stored;

  @override
  Future<BudgetInfo> saveBudget(BudgetInfo b) async {
    if (failSave) throw StateError('offline');
    saved.add(b);
    stored = b;
    return b;
  }

  @override
  dynamic noSuchMethod(Invocation i) =>
      throw UnimplementedError('${i.memberName} is not under test');
}

const BudgetInfo _none = BudgetInfo(
  monthlyBudget: Money(0, 'USD'),
  categories: <BudgetCap>[],
);

Future<_Repo> _pump(
  WidgetTester tester,
  _Repo repo, {
  List<Override> extra = const <Override>[],
}) async {
  await pumpAt(
    tester,
    const Size(420, 2400),
    const InsightsScreen(),
    overrides: <Override>[
      subscriptionRepositoryProvider.overrideWithValue(repo),
      currencyCodeProvider.overrideWithValue('USD'),
      ...extra,
    ],
  );
  expect(find.byKey(const Key('insights.budget')), findsOneWidget);
  return repo;
}

Future<void> _openEditor(WidgetTester tester) async {
  await tester.tap(find.byKey(BudgetCard.editButton));
  await tester.pumpAndSettle();
  expect(find.byType(BudgetEditor), findsOneWidget);
}

void main() {
  testWidgets('saveBudget has a caller: Set a budget → 50 → Save writes it', (
    WidgetTester tester,
  ) async {
    final _Repo repo = await _pump(tester, _Repo(_none));
    expect(find.text('Set a budget'), findsOneWidget);
    await _openEditor(tester);

    await tester.enterText(find.byKey(BudgetEditor.amountField), '50');
    await tester.tap(find.byKey(BudgetEditor.saveButton));
    await tester.pumpAndSettle();

    expect(repo.saved, hasLength(1), reason: 'Save must reach the repository');
    expect(repo.saved.single.monthlyBudget, const Money(5000, 'USD'));
    expect(find.byType(BudgetEditor), findsNothing, reason: 'saved ⇒ closed');
    // The card RE-READ what was written (the provider was invalidated), so it
    // now speaks in words: 27.48 of 50.
    expect(find.text('Edit'), findsOneWidget);
    expect(
      find.textContaining('left this month'),
      findsOneWidget,
      reason: 'decision D-08: the meaning is in words, not only in the meter',
    );
  });

  testWidgets('a cap typed for a category is saved with the budget', (
    WidgetTester tester,
  ) async {
    final _Repo repo = await _pump(tester, _Repo(_none));
    await _openEditor(tester);
    await tester.enterText(find.byKey(BudgetEditor.amountField), '50');
    await tester.enterText(find.byKey(BudgetEditor.capField('Video')), '20');
    await tester.tap(find.byKey(BudgetEditor.saveButton));
    await tester.pumpAndSettle();
    final BudgetInfo saved = repo.saved.single;
    expect(saved.categories, hasLength(1));
    expect(saved.categories.single.name, 'Video');
    expect(saved.categories.single.cap, const Money(2000, 'USD'));
  });

  testWidgets(
    'an amount that is not money is refused in words; nothing saved',
    (WidgetTester tester) async {
      final _Repo repo = await _pump(tester, _Repo(_none));
      await _openEditor(tester);
      await tester.enterText(find.byKey(BudgetEditor.amountField), '5.5.5');
      await tester.tap(find.byKey(BudgetEditor.saveButton));
      await tester.pumpAndSettle();
      expect(repo.saved, isEmpty);
      expect(find.text('Enter an amount, like 5500.'), findsOneWidget);
      expect(find.byType(BudgetEditor), findsOneWidget);
    },
  );

  testWidgets('a failed write keeps the editor open, with what was typed', (
    WidgetTester tester,
  ) async {
    await _pump(tester, _Repo(_none, failSave: true));
    await _openEditor(tester);
    await tester.enterText(find.byKey(BudgetEditor.amountField), '50');
    await tester.tap(find.byKey(BudgetEditor.saveButton));
    await tester.pumpAndSettle();
    expect(find.byType(BudgetEditor), findsOneWidget);
    expect(find.textContaining('could not be saved'), findsOneWidget);
    expect(
      tester
          .widget<TextField>(find.byKey(BudgetEditor.amountField))
          .controller!
          .text,
      '50',
    );
  });

  testWidgets('over budget is said in words and the meter is full', (
    WidgetTester tester,
  ) async {
    await _pump(
      tester,
      _Repo(
        const BudgetInfo(
          monthlyBudget: Money(2000, 'USD'),
          categories: <BudgetCap>[],
        ),
      ),
    );
    expect(find.textContaining('over budget'), findsOneWidget);
    expect(
      tester
          .widget<LinearProgressIndicator>(find.byKey(BudgetCard.meter))
          .value,
      1,
    );
    // The meter's own semantics carry the real percentage, over 100.
    expect(find.bySemanticsLabel('Budget used'), findsOneWidget);
  });

  testWidgets('the editor opens as a dialog on a wide window', (
    WidgetTester tester,
  ) async {
    tester.view.physicalSize = const Size(1440, 1000);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await pumpAt(
      tester,
      const Size(1440, 1000),
      const InsightsScreen(),
      overrides: <Override>[
        subscriptionRepositoryProvider.overrideWithValue(_Repo(_none)),
        currencyCodeProvider.overrideWithValue('USD'),
      ],
    );
    await _openEditor(tester);
    expect(find.byType(Dialog), findsOneWidget);
    expect(
      tester.getSize(find.byType(BudgetEditor)).width,
      lessThanOrEqualTo(AppBreakpoints.medium),
    );
  });

  // ⏱ 2026-10-01 · MO-07 — RED CONTROL: the caps' Pro chip is a BUTTON to the
  // paywall where this build sells, and a plain label where it does not.
  for (final bool selling in <bool>[true, false]) {
    testWidgets('caps locked, selling=$selling: the Pro chip '
        '${selling ? 'is' : 'is not'} a button', (WidgetTester tester) async {
      await _pump(
        tester,
        _Repo(_none),
        extra: <Override>[
          paywallLockedProvider.overrideWithValue(true),
          sellingEnabledProvider.overrideWithValue(selling),
        ],
      );
      await _openEditor(tester);
      final Finder chip = find.byKey(BudgetEditor.proChip);
      expect(chip, findsOneWidget);
      expect(
        find.descendant(of: chip, matching: find.byType(InkWell)),
        selling ? findsOneWidget : findsNothing,
      );
      expect(
        tester.getSemantics(chip),
        selling
            ? isSemantics(isButton: true, hasTapAction: true)
            : isNot(isSemantics(isButton: true)),
      );
      if (selling) {
        await tester.tap(chip);
        await tester.pumpAndSettle();
        // No router in this harness: the sheet closes, and that is the half a
        // test without a GoRouter can see.
        expect(find.byType(BudgetEditor), findsNothing);
      }
    });
  }
}
