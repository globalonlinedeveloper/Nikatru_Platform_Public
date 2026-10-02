// ST-R6 (audit C17-C19): the notifications screen can be closed from the
// keyboard, says dates one way, and shows a renewal whose date has passed.
//
//  · C17: Close was a GestureDetector inside Semantics(button:) — not
//    focusable, deaf to Enter/Space — and Esc did nothing. The live target is
//    web.
//  · C18: `DateFormat.yMd` wrote "10/12/2026", read two ways between US and
//    Indian readers; it is the OS reminder's month-day format now.
//  · C19: a row whose next_renewal has passed (the server has not rolled it)
//    was silently omitted.
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';
import 'package:subscriptiontracker/data/models/subscription.dart';
import 'package:subscriptiontracker/data/subscriptions/subscription_repository.dart';
import 'package:subscriptiontracker/features/notifications/notifications_screen.dart';
import 'package:subscriptiontracker/l10n/app_localizations.dart';
import 'package:subscriptiontracker/state/providers.dart';

import 'support/width_harness.dart' show MemStore, SilentNotifications;

class _Repo implements SubscriptionRepository {
  _Repo(this.subs);
  final List<Subscription> subs;

  @override
  Future<List<Subscription>> fetchAll() async => subs;

  @override
  dynamic noSuchMethod(Invocation invocation) =>
      throw UnimplementedError('${invocation.memberName}');
}

Subscription _sub(String id, int daysFromToday) {
  final DateTime t = wallClock();
  return Subscription(
    id: id,
    name: id,
    category: 'Other',
    price: const Money(1000, 'USD'),
    cycle: BillingCycle.monthly,
    nextRenewal: DateTime(t.year, t.month, t.day + daysFromToday),
  );
}

Future<void> _pump(WidgetTester tester, List<Subscription> subs) async {
  final GoRouter router = GoRouter(
    initialLocation: '/home',
    routes: <RouteBase>[
      GoRoute(
        path: '/home',
        builder: (_, _) => const Scaffold(body: Text('HOME')),
        routes: <RouteBase>[
          GoRoute(
            path: 'notifications',
            builder: (_, _) => const NotificationsScreen(),
          ),
        ],
      ),
      GoRoute(
        path: '/sub/:id',
        builder: (_, GoRouterState s) =>
            Scaffold(body: Text('SUB ${s.pathParameters['id']}')),
      ),
    ],
  );
  final ProviderContainer c = ProviderContainer(
    retry: (int retryCount, Object error) => null,
    overrides: <Override>[
      keyValueStoreProvider.overrideWith((_) async => MemStore()),
      renewalRemindersProvider.overrideWithValue(SilentNotifications()),
      subscriptionRepositoryProvider.overrideWithValue(_Repo(subs)),
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
  router.push('/home/notifications');
  await tester.pumpAndSettle();
  expect(find.byType(NotificationsScreen), findsOneWidget);
}

void main() {
  testWidgets('🔴 Esc closes the screen', (WidgetTester tester) async {
    await _pump(tester, <Subscription>[_sub('netflix', 2)]);
    await tester.sendKeyEvent(LogicalKeyboardKey.escape);
    await tester.pumpAndSettle();
    expect(find.byType(NotificationsScreen), findsNothing);
    expect(find.text('HOME'), findsOneWidget);
  });

  testWidgets('🔴 Close takes the keyboard: focus it, press Enter', (
    WidgetTester tester,
  ) async {
    await _pump(tester, <Subscription>[_sub('netflix', 2)]);
    final Finder close = find.bySemanticsLabel('Close');
    expect(close, findsOneWidget);
    // Tab to it: the Close control is the first focus stop on the screen.
    await tester.sendKeyEvent(LogicalKeyboardKey.tab);
    await tester.pump();
    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pumpAndSettle();
    expect(find.byType(NotificationsScreen), findsNothing);
  });

  testWidgets('dates are month-day, the reminder\'s own format', (
    WidgetTester tester,
  ) async {
    final Subscription s = _sub('netflix', 2);
    await _pump(tester, <Subscription>[s]);
    final String monthDay = DateFormatForTest.mmmd(s.nextRenewal);
    expect(find.textContaining(monthDay), findsWidgets);
    // No numeric y/M/d anywhere on the card.
    expect(
      find.textContaining('${s.nextRenewal.month}/${s.nextRenewal.day}/'),
      findsNothing,
    );
  });

  testWidgets('🔴 a renewal whose date PASSED renders "Renewed on"', (
    WidgetTester tester,
  ) async {
    await _pump(tester, <Subscription>[_sub('gym', -3)]);
    expect(find.textContaining('Renewed on'), findsOneWidget);
    expect(find.textContaining('Still using it?'), findsOneWidget);
  });
}

/// `DateFormat.MMMd('en_US')` without importing intl's symbols a second way.
abstract final class DateFormatForTest {
  static const List<String> _mon = <String>[
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', //
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
  static String mmmd(DateTime d) => '${_mon[d.month - 1]} ${d.day}';
}
