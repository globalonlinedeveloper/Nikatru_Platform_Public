// "WORTH A LOOK" — train ST-D3, label D3-4. The rules as a pure function, and
// the one question answered through the real store.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/misc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:subscriptiontracker/data/local/subscription_store.dart';
import 'package:subscriptiontracker/data/models/budget_info.dart';
import 'package:subscriptiontracker/data/models/subscription.dart';
import 'package:subscriptiontracker/data/subscriptions/subscription_repository.dart';
import 'package:subscriptiontracker/features/insights/insights_screen.dart';
import 'package:subscriptiontracker/features/insights/signals.dart';
import 'package:subscriptiontracker/state/providers.dart';
import 'package:subscriptiontracker/state/settings_controller.dart';

import 'support/width_harness.dart';

final DateTime _now = DateTime(2026, 9, 29);

Subscription _sub(
  String id,
  String category,
  int minor, {
  BillingCycle cycle = BillingCycle.monthly,
  int inDays = 10,
}) => Subscription(
  id: id,
  name: 'Plan $id',
  category: category,
  price: Money(minor, 'USD'),
  cycle: cycle,
  nextRenewal: _now.add(Duration(days: inDays)),
);

class _Repo implements SubscriptionRepository {
  _Repo(this.subs);
  List<Subscription> subs;

  /// Every PATCH body, by id. Applied the way the route applies it
  /// (`Subscription.patched`), so a later `fetchAll` — a sync — reads it.
  final List<(String, Map<String, dynamic>)> patches =
      <(String, Map<String, dynamic>)>[];

  @override
  Future<List<Subscription>> fetchAll() async => subs;

  @override
  Future<Subscription> update(String id, Map<String, dynamic> changes) async {
    patches.add((id, changes));
    subs = <Subscription>[
      for (final Subscription s in subs) s.id == id ? s.patched(changes) : s,
    ];
    return subs.firstWhere((Subscription s) => s.id == id);
  }

  @override
  Future<BudgetInfo> budget() async => const BudgetInfo(
    monthlyBudget: Money(0, 'USD'),
    categories: <BudgetCap>[],
  );

  @override
  dynamic noSuchMethod(Invocation i) =>
      throw UnimplementedError('${i.memberName} is not under test');
}

void main() {
  group('signalsFor — only what the rows can prove', () {
    test('two plans in one category are one signal; one plan is none', () {
      final List<InsightSignal> s = signalsFor(<Subscription>[
        _sub('a', 'Video', 1000),
        _sub('b', 'Video', 500),
        _sub('c', 'Music', 300),
      ], _now);
      final List<SameCategorySignal> same = s
          .whereType<SameCategorySignal>()
          .toList();
      expect(same, hasLength(1));
      expect(same.single.category, 'Video');
      expect(same.single.subs.map((Subscription x) => x.id), <String>[
        'a',
        'b',
      ]);
    });

    test(
      'a yearly plan within 60 days is flagged; at 61, or monthly, it is not',
      () {
        final List<InsightSignal> s = signalsFor(<Subscription>[
          _sub('y1', 'Office', 9900, cycle: BillingCycle.yearly, inDays: 36),
          _sub('y2', 'Cloud', 9900, cycle: BillingCycle.yearly, inDays: 61),
          _sub('m1', 'Music', 300, inDays: 5),
        ], _now);
        final List<AnnualSoonSignal> annual = s
            .whereType<AnnualSoonSignal>()
            .toList();
        expect(annual.map((AnnualSoonSignal a) => a.sub.id), <String>['y1']);
        expect(annual.single.days, 36);
      },
    );

    test('ONE question, about the costliest plan not yet answered', () {
      final List<Subscription> subs = <Subscription>[
        _sub('small', 'Music', 300),
        _sub('big', 'Video', 1500),
      ];
      expect(
        signalsFor(subs, _now).whereType<StillUsingSignal>().single.sub.id,
        'big',
      );
      expect(
        signalsFor(
          subs,
          _now,
          answered: <String>{'big'},
        ).whereType<StillUsingSignal>().single.sub.id,
        'small',
      );
      expect(
        signalsFor(
          subs,
          _now,
          answered: <String>{'big', 'small'},
        ).whereType<StillUsingSignal>(),
        isEmpty,
        reason: 'everything answered ⇒ nothing asked',
      );
    });
  });

  testWidgets('Yes is stored on the device and the question moves on', (
    WidgetTester tester,
  ) async {
    final MemStore store = MemStore();
    await pumpAt(
      tester,
      const Size(420, 2600),
      const InsightsScreen(),
      overrides: <Override>[
        keyValueStoreProvider.overrideWith((_) async => store),
        subscriptionRepositoryProvider.overrideWithValue(
          _Repo(<Subscription>[
            _sub('big', 'Video', 1500),
            _sub('small', 'Music', 300),
          ]),
        ),
        currencyCodeProvider.overrideWithValue('USD'),
      ],
    );
    expect(find.text('Still using Plan big?'), findsOneWidget);
    await tester.tap(
      find.byKey(const Key('insights.signal.stillUsing.yes.big')),
    );
    await tester.pumpAndSettle();
    expect(find.text('Still using Plan big?'), findsNothing);
    expect(find.text('Still using Plan small?'), findsOneWidget);
    expect(store.data[kLocalStillUsingKey], '["big"]');
  });

  // Train T11 (IN-08). Red: drop the PATCH from `StillUsingController.answer`
  // — device A only writes its own cache, and device B asks again; or drop the
  // row's answer from `answeredIds` — device B asks again with the answer
  // already on the row.
  testWidgets(
    'Yes on one device hides the question on ANOTHER after a sync (the answer is the row’s)',
    (WidgetTester tester) async {
      final _Repo server = _Repo(<Subscription>[
        _sub('big', 'Video', 1500),
        _sub('small', 'Music', 300),
      ]);

      // Device A answers.
      await pumpAt(
        tester,
        const Size(420, 2600),
        const InsightsScreen(),
        overrides: <Override>[
          keyValueStoreProvider.overrideWith((_) async => MemStore()),
          subscriptionRepositoryProvider.overrideWithValue(server),
          currencyCodeProvider.overrideWithValue('USD'),
        ],
      );
      await tester.tap(
        find.byKey(const Key('insights.signal.stillUsing.yes.big')),
      );
      await tester.pumpAndSettle();
      expect(server.patches, hasLength(1));
      expect(server.patches.single.$1, 'big');
      expect(server.patches.single.$2, <String, dynamic>{'still_using': 'yes'});

      // Device B: its own, EMPTY device store — nothing cached — reading the
      // same rows after a sync.
      await tester.pumpWidget(const SizedBox.shrink());
      await pumpAt(
        tester,
        const Size(420, 2600),
        const InsightsScreen(),
        overrides: <Override>[
          keyValueStoreProvider.overrideWith((_) async => MemStore()),
          subscriptionRepositoryProvider.overrideWithValue(
            _Repo(List<Subscription>.of(server.subs)),
          ),
          currencyCodeProvider.overrideWithValue('USD'),
        ],
      );
      expect(find.text('Still using Plan big?'), findsNothing);
      expect(find.text('Still using Plan small?'), findsOneWidget);
    },
  );

  test('answeredIds is the rows’ answers plus the device cache', () {
    final Subscription yes = _sub(
      'a',
      'Video',
      100,
    ).patched(<String, dynamic>{'still_using': 'yes'});
    final Subscription no = _sub(
      'b',
      'Video',
      100,
    ).patched(<String, dynamic>{'still_using': 'no'});
    expect(
      answeredIds(
        <Subscription>[yes, no, _sub('c', 'Music', 1)],
        <String>{'d'},
      ),
      <String>{'a', 'b', 'd'},
    );
  });

  test('the answers are forgotten with everything else', () async {
    final MemStore store = MemStore();
    final LocalSubscriptionStore local = LocalSubscriptionStore(
      Future<MemStore>.value(store),
    );
    await local.writeStillUsing(<String>{'a'});
    expect(await local.readStillUsing(), <String>{'a'});
    await local.clear();
    expect(store.data.containsKey(kLocalStillUsingKey), isFalse);
    expect(await local.readStillUsing(), isEmpty);
  });
}
