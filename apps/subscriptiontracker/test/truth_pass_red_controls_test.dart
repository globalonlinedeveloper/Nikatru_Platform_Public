// The ST truth pass (2026-10-01): every screen says what is true. One red
// control per patch, each written against a defect measured on the base
// (gap ids in brackets) and each failing there:
//
//   1 · status everywhere   [HO-01 HO-02 DE-02 NO-08]
//   2 · the calendar draws every charge, charging rows only   [CA-01 CA-02]
//   3 · insights tiles and signals   [IN-01 IN-02]
//   4 · the Pro forecast   [IN-03]
//   5 · add / edit integrity   [AD-01 AD-02]
//   6 · detail shows what the user saved   [DE-01 DE-03]
//   7 · announcements   [DE-12 EN-16 CA-03]
//   8 · the error screen in the user's language   [EN-17]
//
// The shell's tab size is in `l10n_group_home_test.dart` (it needs that file's
// router harness) and the design-system screens' 200 % cases are in
// `packages/design_system/test/system_screens_text_scale_test.dart`.
import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_design_system/nikatru_design_system.dart';
import 'package:subscriptiontracker/core/e2e_keys.dart';
import 'package:subscriptiontracker/core/format/money_format.dart';
import 'package:subscriptiontracker/core/format/sub_math.dart';
import 'package:subscriptiontracker/core/router.dart' show appErrorCopy;
import 'package:subscriptiontracker/data/models/subscription.dart';
import 'package:subscriptiontracker/data/subscriptions/subscription_repository.dart';
import 'package:subscriptiontracker/features/add/add_subscription_sheet.dart';
import 'package:subscriptiontracker/features/auth/login_screen.dart';
import 'package:subscriptiontracker/features/calendar/calendar_screen.dart';
import 'package:subscriptiontracker/features/stop/stop_flow.dart';
import 'package:subscriptiontracker/features/detail/subscription_detail_screen.dart';
import 'package:subscriptiontracker/features/home/home_screen.dart';
import 'package:subscriptiontracker/features/insights/forecast_card.dart';
import 'package:subscriptiontracker/features/insights/signals.dart';
import 'package:subscriptiontracker/features/insights/summary_tiles.dart';
import 'package:subscriptiontracker/features/notifications/notifications_screen.dart';
import 'package:subscriptiontracker/l10n/chassis_bridge.g.dart';
import 'package:subscriptiontracker/services/notifications/notification_service.dart';
import 'package:subscriptiontracker/state/money_providers.dart';
import 'package:subscriptiontracker/state/providers.dart';
import 'package:subscriptiontracker/state/subscriptions_controller.dart';

import 'support/width_harness.dart';

const Color _seed = Color(0xFF6459F5);

/// Wednesday 14 October 2026, mid-morning.
final DateTime _now = DateTime(2026, 10, 14, 9);

Subscription _sub(
  String id,
  String name,
  String category,
  DateTime renews, {
  int cents = 1000,
  Cadence cycle = Cadence.monthly,
  SubscriptionStatus status = SubscriptionStatus.active,
  DateTime? cancelledOn,
  String notes = '',
  String? cancelUrl,
  String currency = 'USD',
}) => Subscription(
  id: id,
  name: name,
  category: category,
  price: Money(cents, currency),
  cycle: cycle,
  nextRenewal: renews,
  glyph: Subscription.glyphFor(name),
  status: status,
  cancelledOn: cancelledOn,
  notes: notes,
  cancelUrl: cancelUrl,
);

/// Three charging plans, one paused and one cancelled — all due within the
/// week, and the cancelled one stored on TODAY, so a screen that forgets the
/// status says "Due today" about it.
List<Subscription> _mixed() => <Subscription>[
  _sub('nfx', 'Netflix', 'Streaming', DateTime(2026, 10, 15)),
  _sub('spt', 'Spotify', 'Music', DateTime(2026, 10, 16)),
  _sub('icl', 'iCloud', 'Storage', DateTime(2026, 10, 17)),
  _sub(
    'gym',
    'City Gym',
    'Fitness',
    DateTime(2026, 10, 18),
    status: SubscriptionStatus.paused,
  ),
  _sub(
    'nws',
    'Daily News',
    'News',
    DateTime(2026, 10, 14),
    status: SubscriptionStatus.cancelled,
    cancelledOn: DateTime(2026, 10, 10),
  ),
];

class _Repo implements SubscriptionRepository {
  _Repo(this.rows);
  final List<Subscription> rows;
  final List<(String, Map<String, dynamic>)> updates =
      <(String, Map<String, dynamic>)>[];

  @override
  Future<List<Subscription>> fetchAll() async => rows;

  @override
  Future<Subscription> update(String id, Map<String, dynamic> changes) async {
    updates.add((id, changes));
    return rows.firstWhere((Subscription s) => s.id == id).patched(changes);
  }

  @override
  Future<void> cancel(String id) async {}

  // DE-04 (stop train): no payment writes behind this fake, so the detail
  // screen offers no "Mark as paid".
  @override
  bool get canRecordPayments => false;

  @override
  dynamic noSuchMethod(Invocation invocation) =>
      throw UnimplementedError('${invocation.memberName} is not under test');
}

/// A target that cannot schedule a notification — the web build's
/// capabilities — with every outbound call a no-op.
class _WebReminders extends RenewalReminders {
  _WebReminders() : super.forTesting(isWeb: true);
  @override
  Future<void> syncAll(
    List<Subscription> subs, {
    required ReminderCopy copy,
    ReminderRules rules = const ReminderRules(),
  }) async {}
  @override
  Future<void> cancelAll() async {}
}

/// Records the URL the detail screen opened, and opens nothing.
class _RecordingLauncher implements core.ExternalLinkLauncher {
  final List<Uri> opened = <Uri>[];
  @override
  Future<core.LinkOutcome> open(Uri uri) async {
    opened.add(uri);
    return core.LinkOutcome.opened;
  }
}

Future<ProviderContainer> _pump(
  WidgetTester tester,
  Widget screen, {
  required List<Subscription> rows,
  List<Override> extra = const <Override>[],
  DateTime? now,
  Size size = kPhone,
  Locale locale = const Locale('en'),
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  final Set<Object> replaced = <Object>{
    for (final Override o in extra) o.origin,
  };
  final ProviderContainer c = ProviderContainer(
    retry: noProviderRetry,
    overrides: <Override>[
      for (final Override o in defaultWidthOverrides())
        if (!replaced.contains(o.origin)) o,
      subscriptionRepositoryProvider.overrideWithValue(_Repo(rows)),
      nowProvider.overrideWithValue(() => now ?? _now),
      ...extra,
    ],
  );
  addTearDown(c.dispose);
  await tester.pumpWidget(
    UncontrolledProviderScope(
      container: c,
      child: MaterialApp(
        locale: locale,
        localizationsDelegates: <LocalizationsDelegate<dynamic>>[
          ...AppLocalizations.localizationsDelegates,
          ChassisLocalizations.delegate,
        ],
        supportedLocales: AppLocalizations.supportedLocales,
        theme: buildAppTheme(seed: _seed),
        home: Scaffold(body: screen),
      ),
    ),
  );
  for (int i = 0; i < 12; i++) {
    await tester.pump();
  }
  return c;
}

void main() {
  late AppLocalizations en;
  late MoneyFormatter money;
  setUpAll(() async {
    en = await AppLocalizations.delegate.load(const Locale('en'));
    money = MoneyFormatter('en');
  });

  // ═══ 1 · STATUS EVERYWHERE ═════════════════════════════════════════════════
  group('1 · status everywhere [HO-01 HO-02 DE-02 NO-08]', () {
    testWidgets('Home counts the CHARGING rows: "3 active", not 5', (
      WidgetTester tester,
    ) async {
      await _pump(tester, const HomeScreen(), rows: _mixed());
      expect(find.text(en.activeCount(3)), findsOneWidget);
      expect(find.text(en.activeCount(5)), findsNothing);
    });

    testWidgets('a paused and a cancelled row SAY so on the Home list', (
      WidgetTester tester,
    ) async {
      // Tall enough that the whole list is built: HO-03's controls and HO-05's
      // decisions sit above it now.
      await _pump(
        tester,
        const HomeScreen(),
        rows: _mixed(),
        size: const Size(400, 2400),
      );
      expect(
        find.descendant(
          of: find.byKey(HomeScreen.allKey),
          matching: find.text('Fitness · ${en.statusPaused}'),
        ),
        findsOneWidget,
      );
      expect(
        find.descendant(
          of: find.byKey(HomeScreen.allKey),
          matching: find.text('News · ${en.statusCancelled}'),
        ),
        findsOneWidget,
      );
    });

    testWidgets('/notifications lists the three charging rows, not five', (
      WidgetTester tester,
    ) async {
      await _pump(tester, const NotificationsScreen(), rows: _mixed());
      expect(
        find.descendant(
          of: find.byKey(const Key('notifications-due-card')),
          matching: find.byType(AppListRow),
        ),
        findsNWidgets(3),
      );
      expect(find.textContaining('City Gym'), findsNothing);
      expect(find.textContaining('Daily News'), findsNothing);
    });

    testWidgets('a cancelled detail never says "Due today"', (
      WidgetTester tester,
    ) async {
      await _pump(
        tester,
        const SubscriptionDetailScreen(id: 'nws'),
        rows: _mixed(),
      );
      expect(find.text(en.dueToday), findsNothing);
      expect(find.text(en.detailCancelledOn('Oct 10, 2026')), findsOneWidget);
    });

    testWidgets('a paused detail reads "Paused — no charge"', (
      WidgetTester tester,
    ) async {
      await _pump(
        tester,
        const SubscriptionDetailScreen(id: 'gym'),
        rows: _mixed(),
      );
      expect(find.text(en.detailPausedNoCharge), findsOneWidget);
      expect(find.text(en.dueInDays(4)), findsNothing);
    });
  });

  // ═══ 2 · THE CALENDAR ══════════════════════════════════════════════════════
  group('2 · the calendar draws every charge [CA-01 CA-02]', () {
    final DateTime first = DateTime(2026, 10, 1, 9);
    List<Subscription> rows() => <Subscription>[
      _sub(
        'wk',
        'Coffee Club',
        'Food',
        DateTime(2026, 10, 1),
        cycle: Cadence.weekly,
        cents: 500,
      ),
      // Stored three months stale: the nightly pass never ran.
      _sub('st', 'Stale Monthly', 'Music', DateTime(2026, 7, 14)),
      _sub(
        'ps',
        'Paused Plan',
        'News',
        DateTime(2026, 10, 20),
        status: SubscriptionStatus.paused,
      ),
    ];

    test(
      'SubMath.chargesInMonth: 5 weekly, the stale row rolled, no pause',
      () {
        final List<ProjectedCharge> c = SubMath.chargesInMonth(
          rows(),
          2026,
          10,
        );
        expect(
          c
              .where((ProjectedCharge x) => x.sub.id == 'wk')
              .map((ProjectedCharge x) => x.on.day),
          <int>[1, 8, 15, 22, 29],
        );
        expect(
          c.where((ProjectedCharge x) => x.sub.id == 'st').single.on,
          DateTime(2026, 10, 14),
        );
        expect(c.where((ProjectedCharge x) => x.sub.id == 'ps'), isEmpty);
        expect(
          SubMath.chargedInMonth(rows(), 2026, 10).single,
          const Money(5 * 500 + 1000, 'USD'),
        );
      },
    );

    testWidgets('dots, rows and total agree; the paused plan is absent', (
      WidgetTester tester,
    ) async {
      await _pump(
        tester,
        CalendarScreen(clock: () => first),
        rows: rows(),
        now: first,
      );
      final MonthGrid grid = tester.widget<MonthGrid>(find.byType(MonthGrid));
      expect(grid.marks.keys.toSet(), <int>{1, 8, 14, 15, 22, 29});
      expect(find.text('Paused Plan'), findsNothing);
      expect(find.text('Coffee Club'), findsNWidgets(5));
      expect(find.text('Stale Monthly'), findsOneWidget);
      expect(
        find.text(
          en.calendarSubtitle(
            'October 2026',
            money.formatBag(SubMath.chargedInMonth(rows(), 2026, 10)),
          ),
        ),
        findsOneWidget,
      );
    });
  });

  testWidgets('a row with NO cadence and a past date reads Overdue, not '
      'Charged', (WidgetTester tester) async {
    final Subscription noCadence = Subscription(
      id: 'nc',
      name: 'No Cadence',
      category: 'Other',
      price: const Money(1000, 'USD'),
      cycle: null,
      nextRenewal: DateTime(2026, 10, 5),
    );
    await _pump(
      tester,
      CalendarScreen(clock: () => _now),
      rows: <Subscription>[noCadence],
    );
    expect(find.text(en.dueOverdue), findsOneWidget);
    expect(find.text(en.calendarCharged), findsNothing);
  });

  // ═══ 3 · INSIGHTS TILES AND SIGNALS ════════════════════════════════════════
  group('3 · insights tiles and signals [IN-01 IN-02]', () {
    test('a quarterly ₹900 plan never reads "₹900/mo"', () {
      final Subscription q = _sub(
        'q',
        'Quarterly',
        'Music',
        DateTime(2026, 11, 1),
        cents: 90000,
        cycle: Cadence.quarterly,
        currency: 'INR',
      );
      final String price = money.format(q.price);
      final String shown = chargeWithCycle(en, money, q);
      expect(shown, isNot(en.perMonthAmount(price)));
      expect(shown, en.priceWithCadence(price, en.perEveryMonths(3)));
    });

    Future<List<String>> next30(
      WidgetTester tester,
      List<Subscription> s,
    ) async {
      await tester.pumpWidget(
        MaterialApp(
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: Scaffold(
            body: SummaryTiles(subs: s, money: money, now: _now),
          ),
        ),
      );
      return tester
          .widgetList<Text>(
            find.descendant(
              of: find.byKey(const Key('insights.tile.next30')),
              matching: find.byType(Text),
            ),
          )
          .map((Text t) => t.data ?? '')
          .toList();
    }

    testWidgets('a paused plan inside 30 days moves neither figure nor count', (
      WidgetTester tester,
    ) async {
      final Subscription a = _sub('a', 'A', 'Music', DateTime(2026, 10, 20));
      final Subscription p = _sub(
        'p',
        'P',
        'Music',
        DateTime(2026, 10, 18),
        cents: 4000,
        status: SubscriptionStatus.paused,
      );
      final List<String> alone = await next30(tester, <Subscription>[a]);
      final List<String> withPaused = await next30(tester, <Subscription>[
        a,
        p,
      ]);
      expect(alone, contains(en.insightsChargeCount(1)));
      expect(withPaused, alone);
    });

    test('signals range over charging rows only', () {
      final List<InsightSignal> s = signalsFor(<Subscription>[
        _sub(
          'y',
          'Yearly',
          'Music',
          DateTime(2026, 11, 1),
          cycle: Cadence.yearly,
          status: SubscriptionStatus.paused,
        ),
        _sub(
          'c',
          'Cancelled',
          'Music',
          DateTime(2026, 11, 2),
          status: SubscriptionStatus.cancelled,
        ),
      ], _now);
      expect(s.whereType<AnnualSoonSignal>(), isEmpty);
      expect(s.whereType<SameCategorySignal>(), isEmpty);
      expect(s.whereType<StillUsingSignal>(), isEmpty);
    });
  });

  // ═══ 4 · THE PRO FORECAST ══════════════════════════════════════════════════
  group('4 · the Pro forecast is right [IN-03]', () {
    final DateTime oct1 = DateTime(2026, 10, 1, 9);
    int charges(Subscription s) =>
        forecastMonths(<Subscription>[s], oct1)
            .map(
              (({DateTime month, MoneyBag charged}) m) =>
                  m.charged.isEmpty ? 0 : m.charged.single.minorUnits,
            )
            .fold(0, (int a, int b) => a + b) ~/
        s.price.minorUnits;

    test('weekly ≈ 52 charges in 12 months', () {
      expect(
        charges(
          _sub('w', 'W', 'Food', DateTime(2026, 10, 1), cycle: Cadence.weekly),
        ),
        inInclusiveRange(52, 53),
      );
    });

    test('quarterly 4', () {
      expect(
        charges(
          _sub(
            'q',
            'Q',
            'Food',
            DateTime(2026, 11, 5),
            cycle: Cadence.quarterly,
          ),
        ),
        4,
      );
    });

    test('paused 0', () {
      expect(
        charges(
          _sub(
            'p',
            'P',
            'Food',
            DateTime(2026, 10, 5),
            status: SubscriptionStatus.paused,
          ),
        ),
        0,
      );
    });

    testWidgets('the UNLOCKED card draws the projection and says its total', (
      WidgetTester tester,
    ) async {
      final List<Subscription> s = <Subscription>[
        _sub('w', 'W', 'Food', DateTime(2026, 10, 1), cycle: Cadence.weekly),
      ];
      await _pump(
        tester,
        ForecastCard(subs: s, money: money, currencyCode: 'USD'),
        rows: s,
        now: oct1,
        extra: <Override>[paywallLockedProvider.overrideWithValue(false)],
      );
      expect(
        find.byKey(const Key('insights.forecast.unlocked')),
        findsOneWidget,
      );
      // An INDEPENDENT figure, not one read back from `forecastMonths`: a
      // weekly US$10 plan from 1 Oct 2026 charges 53 times by 30 Sep 2027
      // (Oct 1 + 52 weeks is Sep 30), so the card says US$530. The old
      // projection said one charge — US$10.
      final MoneyBag total = MoneyBag.sum(<Money>[
        const Money(53 * 1000, 'USD'),
      ]);
      expect(
        find.textContaining(money.formatBagRounded(total)),
        findsOneWidget,
      );
    });
  });

  // ═══ 5 · ADD / EDIT INTEGRITY ══════════════════════════════════════════════
  group('5 · add / edit integrity [AD-01 AD-02]', () {
    Future<_Repo> open(WidgetTester tester, {Subscription? editing}) async {
      final _Repo repo = _Repo(<Subscription>[?editing]);
      tester.view.physicalSize = kPhone;
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      final ProviderContainer c = ProviderContainer(
        overrides: <Override>[
          ...defaultWidthOverrides(),
          subscriptionRepositoryProvider.overrideWithValue(repo),
        ],
      );
      addTearDown(c.dispose);
      await tester.pumpWidget(
        UncontrolledProviderScope(
          container: c,
          child: MaterialApp(
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            supportedLocales: AppLocalizations.supportedLocales,
            theme: buildAppTheme(seed: _seed),
            home: Scaffold(
              body: Builder(
                builder: (BuildContext context) => TextButton(
                  onPressed: () =>
                      showAddSubscriptionSheet(context, initial: editing),
                  child: const Text('open'),
                ),
              ),
            ),
          ),
        ),
      );
      await c.read(subscriptionsControllerProvider.future);
      await tester.tap(find.text('open'));
      await tester.pumpAndSettle();
      // ST-T9 (AD-03): an ADD opens on the catalogue pick step; these cases
      // are about the form, so they take "Add by hand".
      if (editing == null) {
        await tester.tap(find.byKey(E2EKeys.addByHand));
        await tester.pumpAndSettle();
      }
      return repo;
    }

    testWidgets('a blank name disables Add and says why', (
      WidgetTester tester,
    ) async {
      await open(tester);
      await tester.enterText(find.byKey(E2EKeys.addPrice), '5');
      await tester.pump();
      expect(
        tester.widget<FilledButton>(find.byKey(E2EKeys.addSubmit)).onPressed,
        isNull,
      );
      expect(find.text(en.nameErrorRequired), findsOneWidget);
      await tester.enterText(find.byKey(E2EKeys.addName), 'Hulu');
      await tester.pump();
      expect(
        tester.widget<FilledButton>(find.byKey(E2EKeys.addSubmit)).onPressed,
        isNotNull,
      );
      expect(find.text(en.nameErrorRequired), findsNothing);
    });

    testWidgets('editing only the price of an "entertainment" row PATCHes only '
        'price keys', (WidgetTester tester) async {
      final Subscription row = _sub(
        'ent',
        'Hotstar',
        'entertainment',
        DateTime(2030, 3, 14),
        cents: 29900,
        currency: 'INR',
      );
      final _Repo repo = await open(tester, editing: row);
      await tester.enterText(find.byKey(E2EKeys.addPrice), '349');
      await tester.pump();
      await tester.ensureVisible(find.byKey(E2EKeys.addSubmit));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(E2EKeys.addSubmit));
      await tester.pumpAndSettle();
      expect(repo.updates, hasLength(1));
      expect(repo.updates.single.$2.keys.toSet(), <String>{
        'price',
        'price_minor',
        'currency',
      });
    });
  });

  // ═══ 6 · DETAIL SHOWS WHAT THE USER SAVED ══════════════════════════════════
  group('6 · detail shows what the user saved [DE-01 DE-03]', () {
    final Subscription saved = _sub(
      'sv',
      'Netflix',
      'Streaming',
      DateTime(2026, 10, 20),
      notes: 'Shared with my sister',
      cancelUrl: 'https://example.com/cancel',
    );

    testWidgets('notes and the website show, and the website opens', (
      WidgetTester tester,
    ) async {
      final _RecordingLauncher launcher = _RecordingLauncher();
      await _pump(
        tester,
        const SubscriptionDetailScreen(id: 'sv'),
        rows: <Subscription>[saved],
        // Tall enough that the card at the foot of the page is on screen.
        size: const Size(400, 2000),
        extra: <Override>[
          websiteLinkLauncherProvider.overrideWithValue((_) => launcher),
        ],
      );
      expect(find.text('Shared with my sister'), findsOneWidget);
      expect(find.text('https://example.com/cancel'), findsOneWidget);
      await tester.tap(find.byKey(const Key('detail.details.website')));
      await tester.pump();
      expect(launcher.opened, <Uri>[Uri.parse('https://example.com/cancel')]);
    });

    testWidgets('on a target that cannot schedule, the hint renders', (
      WidgetTester tester,
    ) async {
      await _pump(
        tester,
        const SubscriptionDetailScreen(id: 'sv'),
        rows: <Subscription>[saved],
        extra: <Override>[
          renewalRemindersProvider.overrideWithValue(_WebReminders()),
        ],
      );
      final Finder hint = find.byKey(
        const Key('detail.reminders.noDeviceNotifications'),
      );
      // Below a phone's fold of a lazy list (DE-11's details sit above it).
      await tester.scrollUntilVisible(
        hint,
        200,
        scrollable: find.byType(Scrollable).first,
      );
      expect(hint, findsOneWidget);
      expect(
        find.text(en.detailRemindersNoDeviceNotifications),
        findsOneWidget,
      );
    });
  });

  // ═══ 7 · ANNOUNCEMENTS ═════════════════════════════════════════════════════
  group('7 · announcements [DE-12 EN-16 CA-03]', () {
    // ⏱ 2026-10-01 · club apply-st: the cancel sheet is retired (DE-07); the
    // stop flow that replaced it keeps DE-12 — a step change moves focus to
    // the new step's heading, which is announced.
    testWidgets('the stop flow moves focus to the next step and announces it', (
      WidgetTester tester,
    ) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      final Subscription s = _sub('nfx', 'Netflix', 'Streaming', _now);
      await _pump(
        tester,
        Builder(
          builder: (BuildContext context) => TextButton(
            onPressed: () => showStopSheet(context, s),
            child: const Text('open'),
          ),
        ),
        rows: <Subscription>[s],
      );
      await tester.tap(find.text('open'));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(E2EKeys.stopChoiceStop));
      await tester.pumpAndSettle();
      final Finder heading = find.byKey(const Key('stop.step.heading'));
      expect(heading, findsOneWidget);
      final SemanticsData data = tester
          .getSemantics(heading)
          .getSemanticsData();
      expect(data.hasFlag(SemanticsFlag.isLiveRegion), isTrue);
      expect(data.hasFlag(SemanticsFlag.isHeader), isTrue);
      expect(data.label, contains(en.stopWalkthroughTitle('Netflix')));
      expect(
        FocusManager.instance.primaryFocus?.debugLabel,
        'stop-step',
        reason: 'the step change must move focus to the new step heading',
      );
      handle.dispose();
    });

    testWidgets('the account-deletion notice is a live region', (
      WidgetTester tester,
    ) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      final ProviderContainer c = await _pump(
        tester,
        const LoginScreen(),
        rows: const <Subscription>[],
      );
      c.read(lastAccountDeletionOutcomeProvider.notifier).state =
          core.AccountDeletionOutcome.signInSurvives;
      await tester.pump();
      final Finder live = find.byKey(const Key('accountDeletionNoticeLive'));
      expect(live, findsOneWidget);
      expect(
        tester
            .getSemantics(live)
            .getSemanticsData()
            .hasFlag(SemanticsFlag.isLiveRegion),
        isTrue,
      );
      handle.dispose();
    });

    testWidgets('a calendar day cell names the day, today and its renewals', (
      WidgetTester tester,
    ) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      final List<Subscription> rows = <Subscription>[
        _sub('a', 'Netflix', 'Streaming', DateTime(2026, 10, 14), cents: 1549),
        _sub('b', 'Spotify', 'Music', DateTime(2026, 10, 14), cents: 1199),
      ];
      await _pump(tester, CalendarScreen(clock: () => _now), rows: rows);
      final String total = money.formatBag(
        MoneyBag.sum(<Money>[for (final Subscription s in rows) s.price]),
      );
      final Finder cell = find.bySemanticsLabel(RegExp('October 14'));
      expect(cell, findsOneWidget);
      final String label = tester.getSemantics(cell).label;
      expect(label, contains('Wednesday'));
      expect(label, contains(en.calendarDayToday));
      expect(label, contains(en.calendarDayRenewals(2)));
      expect(label, contains(total));
      handle.dispose();
    });
  });

  // ═══ 8 · THE ERROR SCREEN IN THE USER'S LANGUAGE ═══════════════════════════
  group('8 · system screens [EN-17]', () {
    testWidgets('the Tamil error screen title is Tamil, with Go home', (
      WidgetTester tester,
    ) async {
      final AppLocalizations ta = await AppLocalizations.delegate.load(
        const Locale('ta'),
      );
      bool wentHome = false;
      final ErrorWidgetBuilder previous = AppErrorScreen.install(
        localized: appErrorCopy,
        onGoHome: () => wentHome = true,
      );
      final ErrorWidgetBuilder installed = ErrorWidget.builder;
      // Restored at once: flutter_test checks the global before any tear-down
      // runs, and the builder under test is held in `installed`.
      ErrorWidget.builder = previous;
      await tester.pumpWidget(
        MaterialApp(
          locale: const Locale('ta'),
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: Builder(
            builder: (BuildContext context) =>
                installed(FlutterErrorDetails(exception: StateError('boom'))),
          ),
        ),
      );
      await tester.pump();
      expect(find.text(ta.errorTitle), findsOneWidget);
      expect(find.text(AppErrorScreen.fallbackTitle), findsNothing);
      await tester.tap(find.text(ta.goHome));
      expect(wentHome, isTrue);
    });
  });
}
