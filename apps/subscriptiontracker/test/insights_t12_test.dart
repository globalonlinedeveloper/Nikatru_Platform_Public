// T12 · SEE ONE TOTAL — the Insights red controls (IN-06 … IN-10), and
// Insights at 200 % text (which had no test at all).
//
//  · IN-06 ₹649 + $10 is ONE rupee total at the vector's rate, the caption
//    names the ECB date, offline serves the last cached table with ITS date,
//    and the user's own rate for one pair wins;
//  · IN-07 tapping a category row opens Home filtered to it, and Home then
//    lists only that category;
//  · IN-08 "No" routes to the plan's stop flow and the answer is kept;
//  · IN-09 the budget card says what its meter measures;
//  · IN-10 a ₹499/month plan cancelled three months ago shows ₹1,497 saved.

import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_design_system/nikatru_design_system.dart'
    show ChassisLocalizations;
import 'package:subscriptiontracker/core/format/sub_math.dart';
import 'package:subscriptiontracker/data/local/subscription_store.dart';
import 'package:subscriptiontracker/data/models/budget_info.dart';
import 'package:subscriptiontracker/data/models/subscription.dart';
import 'package:subscriptiontracker/data/subscriptions/subscription_repository.dart';
import 'package:subscriptiontracker/features/home/home_screen.dart';
import 'package:subscriptiontracker/features/insights/budget_card.dart';
import 'package:subscriptiontracker/features/insights/fx_caption.dart';
import 'package:subscriptiontracker/features/insights/insights_screen.dart';
import 'package:subscriptiontracker/features/insights/summary_tiles.dart';
import 'package:subscriptiontracker/l10n/app_localizations.dart';
import 'package:subscriptiontracker/state/providers.dart';
import 'package:subscriptiontracker/state/settings_controller.dart';

import 'support/width_harness.dart';

final DateTime _now = DateTime(2026, 9, 29, 10);

/// contracts/fx/latest.v1.example.json `response`, the rates this test needs.
Map<String, Object?> _ecb(String asOf) => <String, Object?>{
  'source': 'Euro foreign exchange reference rates, European Central Bank',
  'base': 'EUR',
  'asOf': asOf,
  'rates': <String, Object?>{'USD': 1.1732, 'INR': 103.987},
};

class _Fx implements core.FxTransport {
  _Fx(this.answer);
  final core.Result<Map<String, Object?>> answer;
  int calls = 0;

  @override
  Future<core.Result<Map<String, Object?>>> fetchLatest() async {
    calls++;
    return answer;
  }
}

class _Repo implements SubscriptionRepository {
  _Repo(this.subs);
  final List<Subscription> subs;

  @override
  Future<List<Subscription>> fetchAll() async => subs;

  @override
  Future<BudgetInfo> budget() async => const BudgetInfo(
    monthlyBudget: Money(200000, 'INR'),
    categories: <BudgetCap>[],
  );

  @override
  dynamic noSuchMethod(Invocation i) =>
      throw UnimplementedError('${i.memberName} is not under test');
}

Subscription _sub(
  String id,
  String name,
  Money price, {
  String category = 'Entertainment',
  SubscriptionStatus status = SubscriptionStatus.active,
  DateTime? cancelledOn,
}) => Subscription(
  id: id,
  name: name,
  category: category,
  price: price,
  cycle: Cadence.monthly,
  nextRenewal: DateTime(2026, 10, 12),
  status: status,
  cancelledOn: cancelledOn,
);

final List<Subscription> _mixed = <Subscription>[
  _sub('hotstar', 'Hotstar', const Money(64900, 'INR')),
  _sub('icloud', 'iCloud', const Money(1000, 'USD'), category: 'Storage'),
];

List<Override> _overrides({
  required List<Subscription> subs,
  core.FxTransport? fx,
  MemStore? store,
}) => <Override>[
  keyValueStoreProvider.overrideWith((_) async => store ?? MemStore()),
  subscriptionRepositoryProvider.overrideWithValue(_Repo(subs)),
  currencyCodeProvider.overrideWithValue('INR'),
  nowProvider.overrideWithValue(() => _now),
  fxTransportProvider.overrideWithValue(
    fx ?? _Fx(core.Result<Map<String, Object?>>.ok(_ecb('2026-09-25'))),
  ),
];

String _figure(WidgetTester tester, Key tile) => tester
    .widgetList<Text>(
      find.descendant(of: find.byKey(tile), matching: find.byType(Text)),
    )
    .map((Text t) => t.data ?? '')
    .join(' | ');

Future<void> _settle(WidgetTester tester) async {
  for (int i = 0; i < 12; i++) {
    await tester.pump();
  }
}

/// [InsightsScreen] under a real router with a stub for every place it can
/// send the user, so a test reads WHERE a tap went.
Future<GoRouter> _pumpRouted(
  WidgetTester tester,
  List<Override> overrides,
) async {
  await tester.binding.setSurfaceSize(const Size(420, 2600));
  addTearDown(() => tester.binding.setSurfaceSize(null));
  final GoRouter router = GoRouter(
    initialLocation: '/insights',
    routes: <RouteBase>[
      GoRoute(
        path: '/insights',
        builder: (_, _) => const Scaffold(body: InsightsScreen()),
      ),
      GoRoute(
        path: '/home',
        builder: (_, GoRouterState s) =>
            Scaffold(body: Text('home:${s.uri.queryParameters['category']}')),
      ),
      GoRoute(
        path: '/sub/:id',
        builder: (_, GoRouterState s) =>
            Scaffold(body: Text('sub:${s.pathParameters['id']}')),
        routes: <RouteBase>[
          GoRoute(
            path: 'stop',
            builder: (_, GoRouterState s) =>
                Scaffold(body: Text('stop:${s.pathParameters['id']}')),
          ),
        ],
      ),
    ],
  );
  addTearDown(router.dispose);
  final ProviderContainer c = ProviderContainer(
    retry: (int retryCount, Object error) => null,
    overrides: <Override>[
      for (final Override o in defaultWidthOverrides())
        if (!overrides.any((Override x) => x.origin == o.origin)) o,
      ...overrides,
    ],
  );
  addTearDown(c.dispose);
  await tester.pumpWidget(
    UncontrolledProviderScope(
      container: c,
      child: MaterialApp.router(
        routerConfig: router,
        localizationsDelegates: <LocalizationsDelegate<dynamic>>[
          ...AppLocalizations.localizationsDelegates,
          ChassisLocalizations.delegate,
        ],
        supportedLocales: AppLocalizations.supportedLocales,
      ),
    ),
  );
  await _settle(tester);
  return router;
}

void main() {
  group('IN-06 · one total in the home currency', () {
    testWidgets('🔴 ₹649 + \$10 is ONE ₹ total, captioned with the ECB date', (
      WidgetTester tester,
    ) async {
      await pumpAt(
        tester,
        const Size(420, 2600),
        const InsightsScreen(),
        overrides: _overrides(subs: _mixed),
      );
      await _settle(tester);
      // 64900 paise + $10.00 at the vector rate (88635 paise) = ₹1,535.35.
      final String month = _figure(tester, const Key('insights.tile.month'));
      expect(month, contains('₹1,535'));
      expect(month, isNot(contains('\$')));
      expect(
        find.descendant(
          of: find.byKey(FxCaption.caption),
          matching: find.text('Converted at ECB rates of Sep 25, 2026'),
        ),
        findsOneWidget,
      );
      // The ROWS keep their own currency: the budget counts the dollar plan.
      expect(find.byKey(const Key('insights.budget.words')), findsOneWidget);
      expect(
        find.text(
          'Plans in other currencies are not counted in this '
          'budget.',
        ),
        findsNothing,
      );
    });

    testWidgets('🔴 offline: the last cached table, with ITS date', (
      WidgetTester tester,
    ) async {
      final MemStore store = MemStore();
      store.data[core.FxRatesLoader.storeKey] = jsonEncode(<String, Object?>{
        'fetchedAt': '2026-09-20T06:00:00.000Z',
        'body': _ecb('2026-09-18'),
      });
      await pumpAt(
        tester,
        const Size(420, 2600),
        const InsightsScreen(),
        overrides: _overrides(
          subs: _mixed,
          store: store,
          fx: _Fx(
            const core.Result<Map<String, Object?>>.err(
              core.Failure('offline'),
            ),
          ),
        ),
      );
      await _settle(tester);
      expect(
        find.text('Converted at ECB rates of Sep 18, 2026'),
        findsOneWidget,
      );
      expect(
        _figure(tester, const Key('insights.tile.month')),
        contains('₹1,535'),
      );
    });

    testWidgets('the user\'s own rate for one pair wins, and can be undone', (
      WidgetTester tester,
    ) async {
      await pumpAt(
        tester,
        const Size(420, 2600),
        const InsightsScreen(),
        overrides: _overrides(subs: _mixed),
      );
      await _settle(tester);
      await tester.tap(find.byKey(FxCaption.setRate));
      await tester.pumpAndSettle();
      await tester.enterText(
        find.byKey(const Key('insights.fx.rateField')),
        '90',
      );
      await tester.tap(find.byKey(const Key('insights.fx.save')));
      await _settle(tester);
      expect(find.text('Your rate: 1 USD = 90 INR'), findsOneWidget);
      // 64900 + 90000 paise.
      expect(
        _figure(tester, const Key('insights.tile.month')),
        contains('₹1,549'),
      );
      await tester.tap(find.byKey(FxCaption.useEcb));
      await _settle(tester);
      expect(find.text('Your rate: 1 USD = 90 INR'), findsNothing);
      expect(
        _figure(tester, const Key('insights.tile.month')),
        contains('₹1,535'),
      );
    });

    testWidgets('one currency: nothing converted, no caption', (
      WidgetTester tester,
    ) async {
      await pumpAt(
        tester,
        const Size(420, 2600),
        const InsightsScreen(),
        overrides: _overrides(subs: <Subscription>[_mixed.first]),
      );
      await _settle(tester);
      expect(find.byKey(FxCaption.caption), findsNothing);
    });
  });

  group('IN-07 · drill down', () {
    testWidgets('🔴 tapping "Entertainment" opens Home filtered to it', (
      WidgetTester tester,
    ) async {
      final GoRouter router = await _pumpRouted(
        tester,
        _overrides(subs: _mixed),
      );
      final Finder row = find.ancestor(
        of: find.text('Entertainment'),
        matching: find.byWidgetPredicate(
          (Widget w) =>
              w.key is ValueKey<String> &&
              (w.key! as ValueKey<String>).value.startsWith(
                'insights.category.row.',
              ),
        ),
      );
      await tester.tap(row.first);
      await _settle(tester);
      expect(
        router.routerDelegate.currentConfiguration.uri.toString(),
        '/home?category=Entertainment',
      );
      expect(find.text('home:Entertainment'), findsOneWidget);
    });

    testWidgets('🔴 Home with ?category= lists only that category', (
      WidgetTester tester,
    ) async {
      await pumpAt(
        tester,
        const Size(420, 2600),
        const Scaffold(body: HomeScreen(category: 'Entertainment')),
        overrides: _overrides(subs: _mixed),
      );
      await _settle(tester);
      expect(find.byKey(HomeScreen.filterKey), findsOneWidget);
      expect(
        find.descendant(
          of: find.byKey(HomeScreen.allKey),
          matching: find.text('Hotstar'),
        ),
        findsOneWidget,
      );
      expect(
        find.descendant(
          of: find.byKey(HomeScreen.allKey),
          matching: find.text('iCloud'),
        ),
        findsNothing,
      );
    });
  });

  group('IN-08 · still using? Yes or No', () {
    testWidgets('🔴 "No" routes to stopping, and the answer is kept', (
      WidgetTester tester,
    ) async {
      final MemStore store = MemStore();
      final GoRouter router = await _pumpRouted(
        tester,
        _overrides(subs: _mixed, store: store),
      );
      // The costliest unanswered plan is asked about (ranked in-currency).
      final Finder no = find.byWidgetPredicate(
        (Widget w) =>
            w.key is ValueKey<String> &&
            (w.key! as ValueKey<String>).value.startsWith(
              'insights.signal.stillUsing.no.',
            ),
      );
      expect(no, findsOneWidget);
      final String id = (tester.widget(no).key! as ValueKey<String>).value
          .split('.')
          .last;
      await tester.tap(no);
      await _settle(tester);
      // PUSHED over Insights, so Back returns to the question's screen. It
      // lands on the stop flow (DE-07), not merely the plan.
      expect(find.text('stop:$id'), findsOneWidget);
      expect(router.canPop(), isTrue);
      expect(store.data[kLocalStillUsingKey], '["$id"]');
    });
  });

  group('IN-09 · the meter says what it measures', () {
    testWidgets('the budget card says "Average monthly share"', (
      WidgetTester tester,
    ) async {
      await pumpAt(
        tester,
        const Size(420, 2600),
        const InsightsScreen(),
        overrides: _overrides(subs: _mixed),
      );
      await _settle(tester);
      expect(
        tester.widget<Text>(find.byKey(BudgetCard.averageNote)).data,
        'Average monthly share',
      );
    });
  });

  group('IN-10 · what cancelling saved', () {
    test('🔴 ₹499/month cancelled 3 months ago is ₹1,497 saved', () {
      final core.MoneyBag saved = SubMath.savedSinceCancelled(<Subscription>[
        _sub(
          'jio',
          'JioCinema',
          const Money(49900, 'INR'),
          status: SubscriptionStatus.cancelled,
          cancelledOn: DateTime(2026, 6, 29),
        ),
        // Cancelled this month: nothing saved yet.
        _sub(
          'new',
          'New',
          const Money(10000, 'INR'),
          status: SubscriptionStatus.cancelled,
          cancelledOn: DateTime(2026, 9, 2),
        ),
        // Still charging: not a saving.
        _mixed.first,
      ], _now);
      expect(saved.single, const Money(149700, 'INR'));
      expect(SubMath.wholeMonthsBetween(DateTime(2026, 6, 30), _now), 2);
    });

    testWidgets('the tile shows it, and is absent when nothing was saved', (
      WidgetTester tester,
    ) async {
      await pumpAt(
        tester,
        const Size(420, 2600),
        const InsightsScreen(),
        overrides: _overrides(
          subs: <Subscription>[
            _mixed.first,
            _sub(
              'jio',
              'JioCinema',
              const Money(49900, 'INR'),
              status: SubscriptionStatus.cancelled,
              cancelledOn: DateTime(2026, 6, 29),
            ),
          ],
        ),
      );
      await _settle(tester);
      final String tile = _figure(tester, SummaryTiles.savedKey);
      expect(tile, contains('Saved since you cancelled'));
      expect(tile, contains('₹1,497'));
      expect(tile, contains('From 1 cancelled plan'));
    });
  });

  group('Insights at 200 % text', () {
    for (final Size size in <Size>[kPhone, const Size(1280, 900)]) {
      testWidgets('nothing overflows at ${size.width.toInt()} px', (
        WidgetTester tester,
      ) async {
        await pumpAt(
          tester,
          size,
          Builder(
            builder: (BuildContext context) => MediaQuery(
              data: MediaQuery.of(
                context,
              ).copyWith(textScaler: const TextScaler.linear(2)),
              child: const Scaffold(body: InsightsScreen()),
            ),
          ),
          overrides: _overrides(
            subs: <Subscription>[
              ..._mixed,
              _sub(
                'jio',
                'JioCinema',
                const Money(49900, 'INR'),
                status: SubscriptionStatus.cancelled,
                cancelledOn: DateTime(2026, 6, 29),
              ),
            ],
          ),
        );
        await _settle(tester);
        expect(tester.takeException(), isNull);
        // Scroll the whole page so every card is laid out at least once.
        await tester.drag(
          find.byType(Scrollable).first,
          const Offset(0, -4000),
        );
        await _settle(tester);
        expect(tester.takeException(), isNull);
      });
    }
  });
}
