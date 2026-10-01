// T12 · PLAN THE YEAR — the calendar's red controls (CA-04, CA-05, CA-06).
//
//  · paging forward shows the NEXT month's PROJECTED dots, and Today returns;
//  · a Sunday-start locale (en) starts on Sunday, and a chosen week start
//    (train T14's preference, through [calendarWeekStartProvider]) wins;
//  · an empty month says when the next charge is;
//  · the twelve-month agenda, and the most-expensive-month line on a large
//    window;
//  · a trial ending on the 14th marks the 14th, a notice period marks its
//    cancel-by day, and both are SAID;
//  · the feed's three controls render on the calendar and go through the
//    shared calls (one mint for all three, Settings' launcher).
//
// Each fails on the screen that rendered one fixed month.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/misc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_design_system/nikatru_design_system.dart';
import 'package:subscriptiontracker/data/models/subscription.dart';
import 'package:subscriptiontracker/data/subscriptions/subscription_repository.dart';
import 'package:subscriptiontracker/features/calendar/calendar_feed_actions.dart';
import 'package:subscriptiontracker/features/calendar/calendar_screen.dart';
import 'package:subscriptiontracker/state/providers.dart';

import 'support/width_harness.dart';

/// Thursday 10 September 2026.
DateTime _now() => DateTime(2026, 9, 10, 10);

class _Repo implements SubscriptionRepository {
  _Repo(this.subs);
  final List<Subscription> subs;

  @override
  Future<List<Subscription>> fetchAll() async => subs;

  @override
  dynamic noSuchMethod(Invocation i) =>
      throw UnimplementedError('${i.memberName} is not under test');
}

Subscription _sub(
  String id,
  String name,
  DateTime next, {
  Cadence? cycle = Cadence.monthly,
  SubscriptionStatus status = SubscriptionStatus.active,
  DateTime? trialEndsOn,
  int? noticeDays,
}) => Subscription(
  id: id,
  name: name,
  category: 'Streaming',
  price: const Money(64900, 'INR'),
  cycle: cycle,
  nextRenewal: next,
  status: status,
  trialEndsOn: trialEndsOn,
  noticeDays: noticeDays,
);

Future<void> _pump(
  WidgetTester tester,
  List<Subscription> subs, {
  Size size = kPhone,
  List<Override> overrides = const <Override>[],
}) => pumpAt(
  tester,
  size,
  const Scaffold(body: CalendarScreen(clock: _now)),
  overrides: <Override>[
    subscriptionRepositoryProvider.overrideWithValue(_Repo(subs)),
    ...overrides,
  ],
);

MonthGrid _grid(WidgetTester tester) =>
    tester.widget<MonthGrid>(find.byType(MonthGrid));

/// The column (0-based) the grid cell for [day] sits in.
int _columnOf(WidgetTester tester, int day) {
  final Rect grid = tester.getRect(find.byType(GridView));
  final Rect cell = tester.getRect(find.byKey(MonthGrid.dayKey(day)));
  final double pitch = (grid.width + MonthGrid.cellSpacing) / 7;
  return ((cell.left - grid.left) / pitch).round();
}

String _label(WidgetTester tester) =>
    tester.widget<Text>(find.byKey(CalendarScreen.monthLabelKey)).data!;

void main() {
  group('CA-04 · a calendar you can page', () {
    testWidgets(
      '🔴 forward shows next month\'s PROJECTED dots; Today returns',
      (WidgetTester tester) async {
        await _pump(tester, <Subscription>[
          // Stored date in September; October's charge exists only by
          // projection.
          _sub('netflix', 'Netflix', DateTime(2026, 9, 15)),
          _sub(
            'weekly',
            'Weekly box',
            DateTime(2026, 9, 3),
            cycle: Cadence.weekly,
          ),
        ]);
        expect(_label(tester), contains('September 2026'));
        expect(_grid(tester).marks[15], 1);
        expect(find.byKey(CalendarScreen.todayKey), findsNothing);

        await tester.tap(find.byKey(CalendarScreen.nextKey));
        await tester.pump();
        expect(_label(tester), contains('October 2026'));
        expect(_grid(tester).month.month, 10);
        expect(
          _grid(tester).marks[15],
          2,
          reason:
              'the monthly plan, projected — and the weekly box\'s sixth '
              'charge (Sep 3 + 6 weeks) on the same day',
        );
        // Sep 3 + 7k: Oct 1, 8, 15, 22, 29.
        for (final int d in <int>[1, 8, 22, 29]) {
          expect(_grid(tester).marks[d], 1, reason: 'weekly on Oct $d');
        }
        expect(find.text('Netflix'), findsOneWidget);

        await tester.tap(find.byKey(CalendarScreen.todayKey));
        await tester.pump();
        expect(_label(tester), contains('September 2026'));

        await tester.tap(find.byKey(CalendarScreen.prevKey));
        await tester.pump();
        expect(_label(tester), contains('August 2026'));
        expect(
          _grid(tester).marks[15],
          isNull,
          reason: 'no charge before the stored date is ever invented',
        );
      },
    );

    testWidgets('🔴 en (a Sunday-start locale) starts on Sunday', (
      WidgetTester tester,
    ) async {
      await _pump(tester, <Subscription>[
        _sub('a', 'A', DateTime(2026, 9, 15)),
      ]);
      // 1 Sep 2026 is a Tuesday: column 2 of a Sunday week.
      expect(_columnOf(tester, 1), 2);
      // 6 Sep is a Sunday: the first column.
      expect(_columnOf(tester, 6), 0);
    });

    testWidgets(
      'a chosen week start (T14\'s preference) wins over the locale',
      (WidgetTester tester) async {
        await _pump(
          tester,
          <Subscription>[_sub('a', 'A', DateTime(2026, 9, 15))],
          overrides: <Override>[calendarWeekStartProvider.overrideWithValue(0)],
        );
        expect(
          _columnOf(tester, 1),
          1,
          reason: 'Tuesday, second of a Monday week',
        );
      },
    );

    testWidgets('🔴 an empty month names the next charge', (
      WidgetTester tester,
    ) async {
      await _pump(tester, <Subscription>[
        _sub('adobe', 'Adobe CC', DateTime(2026, 9, 11), cycle: Cadence.yearly),
      ]);
      await tester.tap(find.byKey(CalendarScreen.nextKey));
      await tester.pump();
      expect(
        tester.widget<Text>(find.byKey(CalendarScreen.emptyKey)).data,
        'Nothing renews in October 2026 — next: Adobe CC on Sep 11, 2027',
      );
    });

    testWidgets('the 12-month agenda lists the year ahead', (
      WidgetTester tester,
    ) async {
      await _pump(tester, <Subscription>[
        _sub('netflix', 'Netflix', DateTime(2026, 9, 15)),
      ]);
      await tester.tap(find.text('12 months'));
      await tester.pump();
      expect(find.byType(MonthGrid), findsNothing);
      expect(find.byKey(CalendarScreen.agendaMonthKey(0)), findsOneWidget);
      await tester.scrollUntilVisible(
        find.byKey(CalendarScreen.agendaMonthKey(11)),
        300,
      );
      // The twelfth month is August 2027 and still holds the projection.
      expect(
        find.descendant(
          of: find.byKey(CalendarScreen.agendaMonthKey(11)),
          matching: find.text('Netflix'),
        ),
        findsOneWidget,
      );
    });

    testWidgets('a large window names the most expensive month ahead', (
      WidgetTester tester,
    ) async {
      await _pump(tester, <Subscription>[
        _sub('netflix', 'Netflix', DateTime(2026, 9, 15)),
        _sub('adobe', 'Adobe CC', DateTime(2027, 3, 2), cycle: Cadence.yearly),
      ], size: const Size(1440, 900));
      expect(
        tester.widget<Text>(find.byKey(CalendarScreen.mostExpensiveKey)).data,
        startsWith('Most expensive month ahead: March 2027'),
      );
    });
  });

  group('CA-05 · deadlines on the grid', () {
    testWidgets('🔴 a trial ending on the 14th marks the 14th, in words', (
      WidgetTester tester,
    ) async {
      final SemanticsHandle h = tester.ensureSemantics();
      await _pump(tester, <Subscription>[
        _sub(
          'trial',
          'Disney+',
          DateTime(2026, 9, 14),
          status: SubscriptionStatus.trialing,
          trialEndsOn: DateTime(2026, 9, 14),
        ),
        // A three-day notice before the 24th: cancel by the 21st.
        _sub('gym', 'Gym', DateTime(2026, 9, 24), noticeDays: 3),
      ]);
      expect(_grid(tester).deadlines[14], 'trial ends');
      expect(_grid(tester).deadlines[21], 'cancel by');
      expect(_grid(tester).deadlines.containsKey(13), isFalse);
      expect(find.bySemanticsLabel('14, trial ends'), findsOneWidget);
      expect(find.bySemanticsLabel('21, cancel by'), findsOneWidget);
      // The legend explains the square, and the rows say what ends.
      expect(find.text('Trial ends or cancel by'), findsOneWidget);
      await tester.scrollUntilVisible(
        find.byKey(const Key('calendar.deadline.gym.cancelBy')),
        200,
        // The grid is a (non-scrolling) Scrollable too; the page is first.
        scrollable: find.byType(Scrollable).first,
      );
      expect(
        find.byKey(const Key('calendar.deadline.trial.trial')),
        findsOneWidget,
      );
      h.dispose();
    });

    testWidgets('a cancel-by for NEXT month\'s charge lands in this month', (
      WidgetTester tester,
    ) async {
      await _pump(tester, <Subscription>[
        // Charges Oct 2 (projected); 5 days' notice is Sep 27.
        _sub('box', 'Box', DateTime(2026, 9, 2), noticeDays: 5),
      ]);
      expect(_grid(tester).deadlines[27], 'cancel by');
    });
  });

  group('CA-06 · the feed where users look for it', () {
    testWidgets('signed out or offline-only: no feed controls', (
      WidgetTester tester,
    ) async {
      await _pump(tester, <Subscription>[
        _sub('a', 'A', DateTime(2026, 9, 15)),
      ]);
      expect(find.byKey(CalendarFeedBar.subscribeKey), findsNothing);
    });

    testWidgets('🔴 Subscribe, Download .ics and Copy link render and call the '
        'SHARED transport — one mint for all three', (
      WidgetTester tester,
    ) async {
      final _Transport t = _Transport();
      final _Launcher l = _Launcher();
      final List<String> copied = <String>[];
      await _pump(
        tester,
        <Subscription>[_sub('a', 'A', DateTime(2026, 9, 15))],
        size: const Size(390, 1600),
        overrides: <Override>[
          authRepositoryProvider.overrideWithValue(_SignedIn()),
          reminderChannelsAvailableProvider.overrideWithValue(true),
          reminderChannelsTransportProvider.overrideWithValue(t),
          calendarLinkLauncherProvider.overrideWithValue(l),
          clipboardWriterProvider.overrideWithValue((String s) async {
            copied.add(s);
          }),
        ],
      );
      expect(find.byKey(CalendarFeedBar.subscribeKey), findsOneWidget);
      expect(find.byKey(CalendarFeedBar.downloadKey), findsOneWidget);
      expect(find.byKey(CalendarFeedBar.copyKey), findsOneWidget);

      await tester.tap(find.byKey(CalendarFeedBar.subscribeKey));
      await tester.pump();
      await tester.tap(find.byKey(CalendarFeedBar.downloadKey));
      await tester.pump();
      await tester.tap(find.byKey(CalendarFeedBar.copyKey));
      await tester.pump();

      expect(t.mints, <String>['mint:subscriptiontracker:tok']);
      expect(l.opened, <Uri>[
        // Native: the calendar app subscribes by webcal:.
        Uri.parse('webcal://platform.test/v1/calendar/feed/abc.ics'),
        Uri.parse('https://platform.test/v1/calendar/feed/abc.ics?download=1'),
      ]);
      expect(copied, <String>[
        'https://platform.test/v1/calendar/feed/abc.ics',
      ]);
      await tester.pump(const Duration(seconds: 5));
    });
  });
}

class _SignedIn extends core.AuthRepository {
  @override
  core.AuthUser? get currentUser =>
      const core.AuthUser(id: 'u1', email: 'u1@test.dev', emailVerified: true);

  @override
  Stream<core.AuthUser?> authStateChanges() =>
      const Stream<core.AuthUser?>.empty();

  @override
  Future<String?> currentAccessToken() async => 'tok';

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _Transport implements core.ReminderChannelsTransport {
  final List<String> mints = <String>[];

  @override
  Future<core.Result<core.CalendarFeed>> mintCalendarFeed({
    required String appId,
    required String? accessToken,
  }) async {
    mints.add('mint:$appId:$accessToken');
    return core.Result<core.CalendarFeed>.ok(
      core.CalendarFeed(
        httpsUrl: Uri.parse('https://platform.test/v1/calendar/feed/abc.ics'),
        webcalUrl: Uri.parse('webcal://platform.test/v1/calendar/feed/abc.ics'),
      ),
    );
  }

  @override
  dynamic noSuchMethod(Invocation i) =>
      throw UnimplementedError('${i.memberName} is not under test');
}

class _Launcher implements core.ExternalLinkLauncher {
  final List<Uri> opened = <Uri>[];

  @override
  Future<core.LinkOutcome> open(Uri uri) async {
    opened.add(uri);
    return core.LinkOutcome.opened;
  }

  @override
  dynamic noSuchMethod(Invocation i) =>
      throw UnimplementedError('${i.memberName} is not under test');
}
