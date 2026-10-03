// INSIGHTS AND THE BUDGET EDITOR, PIXEL FOR PIXEL — train ST-D3 verify
// (decision D-12's harness, as ST-D0's foundation_golden_test uses it).
//
// Insights (canvas `Insights`, `InsightsDark`, `DesktopInsights`) and the budget
// editor (`BudgetEditor`) photographed at one window per class — compact 390,
// medium 700, expanded 1024, large 1440 — in light and dark: sixteen goldens
// under test/goldens/. Then one case per data state, which runs everywhere.
//
// 🔴 THE FIXTURE IS TIME-STABLE ON PURPOSE. Every renewal is placed RELATIVE to
// now, no plan is yearly (an "annual in N days" row would print a weekday and a
// month that change the width of the line), and the Pro forecast is LOCKED (its
// unlocked form prints month names). What is photographed does not drift with
// the calendar.
//
// ⏱ 2026-10-01 · AND "NOW" IS PINNED, through `nowProvider` ([_kNow]). The
// screen used to read `DateTime.now()` three times and this fixture a fourth,
// so the rows and the screen's "today" were two reads of the wall clock: a run
// straddling midnight placed a row a day off, and a time-travel run (which
// moves the clock behind `nowProvider`, never `DateTime.now()`) would move the
// screen and leave the fixture behind. One pinned instant feeds both.
//
// Regenerate, after a DELIBERATE visual change only, on Linux:
//   flutter test --update-goldens test/insights_golden_test.dart
// and review every PNG before committing it.
//
// ⚠️ LINUX ONLY for the comparison, for the renderer reason the foundation
// suite gives: glyph anti-aliasing differs on macOS and Windows.

import 'dart:io' show Platform;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_design_system/nikatru_design_system.dart';
import 'package:subscriptiontracker/core/format/money_format.dart';
import 'package:subscriptiontracker/core/format/sub_math.dart';
import 'package:subscriptiontracker/data/models/budget_info.dart';
import 'package:subscriptiontracker/data/models/subscription.dart';
import 'package:subscriptiontracker/data/subscriptions/subscription_repository.dart';
import 'package:subscriptiontracker/features/insights/budget_card.dart';
import 'package:subscriptiontracker/features/insights/budget_editor.dart';
import 'package:subscriptiontracker/features/insights/forecast_card.dart';
import 'package:subscriptiontracker/features/insights/insights_screen.dart';
import 'package:subscriptiontracker/l10n/app_localizations.dart';
import 'package:subscriptiontracker/state/money_providers.dart';
import 'package:subscriptiontracker/state/providers.dart';
import 'package:subscriptiontracker/state/settings_controller.dart';

import 'support/width_harness.dart';

const Map<String, Size> _classes = <String, Size>{
  'compact': Size(390, 844),
  'medium': Size(700, 1000),
  'expanded': Size(1024, 900),
  'large': Size(1440, 900),
};

/// The one "now" the fixture and the screen both read (see the header).
final DateTime _kNow = DateTime(2026, 9, 10, 10);

List<Subscription> _subs() {
  final DateTime now = _kNow;
  Subscription s(String id, String name, String cat, int minor, int days) =>
      Subscription(
        id: id,
        name: name,
        category: cat,
        price: Money(minor, 'USD'),
        cycle: BillingCycle.monthly,
        nextRenewal: DateTime(now.year, now.month, now.day + days),
      );
  return <Subscription>[
    s('1', 'Streamer', 'Video', 1549, 3),
    s('2', 'Tube', 'Video', 1399, 12),
    s('3', 'Tunes', 'Music', 1099, 20),
    s('4', 'Chat', 'AI tools', 2000, 40),
    s('5', 'Drive', 'Cloud', 299, 45),
  ];
}

/// The unlocked forecast's rows: every cadence the projection has to count,
/// and a paused plan it must not.
List<Subscription> _forecastRows() {
  Subscription s(
    String id,
    int cents,
    Cadence cycle,
    DateTime next, {
    SubscriptionStatus status = SubscriptionStatus.active,
  }) => Subscription(
    id: id,
    name: id,
    category: 'Video',
    price: Money(cents, 'USD'),
    cycle: cycle,
    nextRenewal: next,
    status: status,
  );
  return <Subscription>[
    s('weekly', 500, Cadence.weekly, DateTime(2026, 10, 2)),
    s('monthly', 1549, Cadence.monthly, DateTime(2026, 10, 15)),
    s('quarterly', 2999, Cadence.quarterly, DateTime(2026, 11, 5)),
    s('yearly', 9900, Cadence.yearly, DateTime(2027, 3, 1)),
    s(
      'paused',
      4000,
      Cadence.monthly,
      DateTime(2026, 10, 20),
      status: SubscriptionStatus.paused,
    ),
  ];
}

class _Repo implements SubscriptionRepository {
  _Repo({
    this.subs,
    this.failList = false,
    this.failBudget = false,
    this.hang = false,
  });

  final List<Subscription>? subs;
  final bool failList;
  final bool failBudget;
  final bool hang;

  @override
  Future<List<Subscription>> fetchAll() async {
    if (hang)
      return Future<List<Subscription>>.delayed(const Duration(days: 1));
    if (failList) throw StateError('the network is down');
    return subs ?? _subs();
  }

  @override
  Future<BudgetInfo> budget() async {
    if (failBudget) throw StateError('the network is down');
    return const BudgetInfo(
      monthlyBudget: Money(8000, 'USD'),
      categories: <BudgetCap>[BudgetCap('Video', Money(3000, 'USD'))],
    );
  }

  @override
  dynamic noSuchMethod(Invocation i) =>
      throw UnimplementedError('${i.memberName} is not under test');
}

Future<void> _pump(
  WidgetTester tester,
  Size size,
  Brightness brightness,
  Widget home, {
  _Repo? repo,
  String currency = 'USD',
  List<Override> extra = const <Override>[],
  bool locked = true,
  DateTime Function()? now,
}) async {
  tester.view.physicalSize = size * 0.5;
  tester.view.devicePixelRatio = 0.5;
  addTearDown(tester.view.reset);
  final ProviderContainer c = ProviderContainer(
    retry: (int retryCount, Object error) => null,
    overrides: <Override>[
      ...defaultWidthOverrides(),
      subscriptionRepositoryProvider.overrideWithValue(repo ?? _Repo()),
      currencyCodeProvider.overrideWithValue(currency),
      paywallLockedProvider.overrideWithValue(locked),
      // ⏱ 2026-10-02 · unpinned cases read the pinned [_kNow], never the wall clock.
      nowProvider.overrideWithValue(now ?? () => _kNow),
      ...extra,
    ],
  );
  addTearDown(c.dispose);
  await tester.pumpWidget(
    UncontrolledProviderScope(
      container: c,
      child: MaterialApp(
        debugShowCheckedModeBanner: false,
        theme: buildAppTheme(
          seed: const Color(0xFF6459F5),
          brightness: brightness,
        ),
        localizationsDelegates: <LocalizationsDelegate<dynamic>>[
          ...AppLocalizations.localizationsDelegates,
          ChassisLocalizations.delegate,
        ],
        supportedLocales: AppLocalizations.supportedLocales,
        home: Scaffold(body: home),
      ),
    ),
  );
  for (int i = 0; i < 12; i++) {
    await tester.pump();
  }
}

Widget _editorHost() => Builder(
  builder: (BuildContext context) => Center(
    child: TextButton(
      onPressed: () => showBudgetEditorSheet(
        context,
        budget: const BudgetInfo(
          monthlyBudget: Money(8000, 'USD'),
          categories: <BudgetCap>[BudgetCap('Video', Money(3000, 'USD'))],
        ),
        spent: SubMath.totalMonthly(_subs()),
        categories: SubMath.categoryTotals(_subs()),
      ),
      child: const Text('open'),
    ),
  ),
);

void main() {
  test('each photographed size is the class it is named for', () {
    expect(windowClassFor(_classes['compact']!.width), WindowClass.compact);
    expect(windowClassFor(_classes['medium']!.width), WindowClass.medium);
    expect(windowClassFor(_classes['expanded']!.width), WindowClass.expanded);
    expect(windowClassFor(_classes['large']!.width), WindowClass.large);
  });

  for (final MapEntry<String, Size> c in _classes.entries) {
    for (final Brightness b in Brightness.values) {
      testWidgets('Insights · ${c.key} · ${b.name}', (
        WidgetTester tester,
      ) async {
        await _pump(tester, c.value, b, const InsightsScreen());
        await expectLater(
          find.byType(MaterialApp),
          matchesGoldenFile('goldens/insights_${c.key}_${b.name}.png'),
        );
      }, skip: !Platform.isLinux);

      // ⏱ ST truth pass (2026-10-01, IN-03): the Pro card UNLOCKED — the
      // goldens above photograph only its locked preview, so the one paid
      // feature's real bars had no picture. A pinned day and fixed dates: a
      // weekly, a monthly, a quarterly and a yearly plan, and a paused one
      // that must draw nothing.
      testWidgets('Forecast unlocked · ${c.key} · ${b.name}', (
        WidgetTester tester,
      ) async {
        final List<Subscription> rows = _forecastRows();
        await _pump(
          tester,
          c.value,
          b,
          SingleChildScrollView(
            padding: const EdgeInsets.all(16),
            child: ForecastCard(
              subs: rows,
              money: MoneyFormatter('en'),
              currencyCode: 'USD',
            ),
          ),
          repo: _Repo(subs: rows),
          locked: false,
          now: () => DateTime(2026, 10, 1, 9),
        );
        await expectLater(
          find.byType(MaterialApp),
          matchesGoldenFile(
            'goldens/insights_forecast_unlocked_${c.key}_${b.name}.png',
          ),
        );
      }, skip: !Platform.isLinux);

      testWidgets('BudgetEditor · ${c.key} · ${b.name}', (
        WidgetTester tester,
      ) async {
        await _pump(tester, c.value, b, _editorHost());
        await tester.tap(find.text('open'));
        await tester.pumpAndSettle();
        await expectLater(
          find.byType(MaterialApp),
          matchesGoldenFile('goldens/budget_editor_${c.key}_${b.name}.png'),
        );
      }, skip: !Platform.isLinux);
    }
  }

  // ⏱ T12 (IN-06) · CONVERTED TOTALS: a rupee user with a dollar plan, at the
  // contract vector's ECB rates (contracts/fx/latest.v1.example.json). Every
  // tile is ONE rupee figure and the caption names the fix date.
  for (final Brightness b in Brightness.values) {
    testWidgets('Insights · converted · compact · ${b.name}', (
      WidgetTester tester,
    ) async {
      // The screen reads the pinned [_kNow] (header); so must these rows, or
      // "in 5 days" is a month away from the screen's today.
      final DateTime now = _kNow;
      await _pump(
        tester,
        _classes['compact']!,
        b,
        const InsightsScreen(),
        currency: 'INR',
        repo: _Repo(
          subs: <Subscription>[
            Subscription(
              id: 'h',
              name: 'Hotstar',
              category: 'Video',
              price: const Money(64900, 'INR'),
              cycle: BillingCycle.monthly,
              nextRenewal: DateTime(now.year, now.month, now.day + 5),
            ),
            Subscription(
              id: 'i',
              name: 'iCloud',
              category: 'Cloud',
              price: const Money(1000, 'USD'),
              cycle: BillingCycle.monthly,
              nextRenewal: DateTime(now.year, now.month, now.day + 9),
            ),
          ],
        ),
        extra: <Override>[
          fxTransportProvider.overrideWithValue(const _VectorFx()),
        ],
      );
      await expectLater(
        find.byType(MaterialApp),
        matchesGoldenFile('goldens/insights_converted_compact_${b.name}.png'),
      );
    }, skip: !Platform.isLinux);
  }

  group('one case per state', () {
    const Size phone = Size(420, 2400);

    testWidgets(
      'loading: a fetch in flight is announced, not a report of zero',
      (WidgetTester tester) async {
        await _pump(
          tester,
          phone,
          Brightness.light,
          const InsightsScreen(),
          repo: _Repo(hang: true),
        );
        expect(find.byType(DataStateView), findsOneWidget);
        expect(find.byKey(const Key('insights.tile.month')), findsNothing);
      },
    );

    testWidgets(
      'empty: no plans offers the first step, not a chart of nothing',
      (WidgetTester tester) async {
        await _pump(
          tester,
          phone,
          Brightness.light,
          const InsightsScreen(),
          repo: _Repo(subs: const <Subscription>[]),
        );
        expect(find.byType(DataStateView), findsOneWidget);
        expect(find.text('Add subscription'), findsWidgets);
        expect(find.byKey(const Key('insights.category')), findsNothing);
      },
    );

    testWidgets('error: a failed fetch says so and offers Retry', (
      WidgetTester tester,
    ) async {
      await _pump(
        tester,
        phone,
        Brightness.light,
        const InsightsScreen(),
        repo: _Repo(failList: true),
      );
      expect(find.byType(DataStateView), findsOneWidget);
      expect(find.text('Retry'), findsWidgets);
    });

    testWidgets('offline: the held plans still report; only the budget card, '
        'whose read failed, says so', (WidgetTester tester) async {
      await _pump(
        tester,
        phone,
        Brightness.light,
        const InsightsScreen(),
        repo: _Repo(failBudget: true),
      );
      expect(find.byKey(const Key('insights.tile.month')), findsOneWidget);
      expect(find.byKey(const Key('insights.category')), findsOneWidget);
      expect(
        find.descendant(
          of: find.byKey(const Key('insights.budget')),
          matching: find.text('Retry'),
        ),
        findsOneWidget,
      );
      expect(find.byKey(BudgetCard.meter), findsNothing);
    });

    testWidgets('populated: tiles, budget in words, signals, categories, Pro', (
      WidgetTester tester,
    ) async {
      await _pump(tester, phone, Brightness.light, const InsightsScreen());
      for (final String k in <String>[
        'insights.tile.month',
        'insights.budget',
        'insights.signals',
        'insights.category',
        'insights.forecast',
      ]) {
        expect(find.byKey(Key(k)), findsOneWidget, reason: '$k is missing');
      }
      expect(find.textContaining('left this month'), findsOneWidget);
      expect(find.text('See Pro'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  });
}

/// The contract vector's `response` (two of its rates), dated so the caption
/// is the same on every run.
class _VectorFx implements core.FxTransport {
  const _VectorFx();

  @override
  Future<core.Result<Map<String, Object?>>> fetchLatest() async =>
      const core.Result<Map<String, Object?>>.ok(<String, Object?>{
        'source':
            'Euro foreign exchange reference rates, European Central Bank',
        'base': 'EUR',
        'asOf': '2026-09-25',
        'rates': <String, Object?>{'USD': 1.1732, 'INR': 103.987},
      });
}
