// The calendar's fixture for the ST-D2 state and golden suites: one pinned
// day, one month of renewals relative to it, the four window classes, and a
// host that mounts the screen on the app's REAL themes (the width harness
// mounts Material's defaults, which is right for a width and wrong for a
// picture or a contrast).

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_chassis_screens/shell/app_shell.dart'
    show OfflineBannerHost;
import 'package:nikatru_design_system/nikatru_design_system.dart';
import 'package:subscriptiontracker/data/models/subscription.dart';
import 'package:subscriptiontracker/data/subscriptions/subscription_repository.dart';
import 'package:subscriptiontracker/features/calendar/calendar_screen.dart';
import 'package:subscriptiontracker/l10n/app_localizations.dart';
import 'package:subscriptiontracker/state/providers.dart';

import 'width_harness.dart';

/// The seed `app.dart` passes to both themes.
const Color kCalendarSeed = Color(0xFF6459F5);

/// Thursday 10 September 2026, mid-morning. Pinned so the month, today and
/// every due phrase are the same on every run.
DateTime kCalendarNow() => DateTime(2026, 9, 10, 10);

/// One window per class, named for it. The same four the design system's
/// foundation goldens photograph.
const Map<String, Size> kCalendarWindows = <String, Size>{
  'compact': Size(390, 844),
  'medium': Size(700, 1000),
  'expanded': Size(1024, 900),
  'large': Size(1440, 900),
};

Subscription _sub(
  String id,
  String name,
  int day, {
  int cents = 1299,
  BillingCycle cycle = BillingCycle.monthly,
}) => Subscription(
  id: id,
  name: name,
  category: 'Streaming',
  price: Money(cents, 'USD'),
  cycle: cycle,
  nextRenewal: DateTime(2026, 9, day),
);

/// Today, tomorrow (both urgent), a two-renewal day, and a yearly charge.
final List<Subscription> kCalendarSubs = <Subscription>[
  _sub('icloud', 'iCloud+', 10, cents: 299),
  _sub('adobe', 'Adobe CC', 11, cents: 23988, cycle: BillingCycle.yearly),
  _sub('netflix', 'Netflix', 15, cents: 1549),
  _sub('spotify', 'Spotify', 15, cents: 1199),
  _sub('gym', 'Gym', 24, cents: 4000),
];

/// A repository that answers [fetchAll] with a scripted outcome, and counts
/// the calls — so a retry is observed as a SECOND FETCH, not assumed.
class CalendarRepository implements SubscriptionRepository {
  CalendarRepository.populated() : _mode = 'populated';
  CalendarRepository.empty() : _mode = 'empty';
  CalendarRepository.pending() : _mode = 'pending';
  CalendarRepository.failing() : _mode = 'failing';

  final String _mode;
  int fetches = 0;

  @override
  Future<List<Subscription>> fetchAll() {
    fetches++;
    return switch (_mode) {
      'populated' => Future<List<Subscription>>.value(kCalendarSubs),
      'empty' => Future<List<Subscription>>.value(const <Subscription>[]),
      'pending' => Completer<List<Subscription>>().future,
      _ => Future<List<Subscription>>.error(StateError('the network is down')),
    };
  }

  @override
  dynamic noSuchMethod(Invocation i) =>
      throw UnimplementedError('${i.memberName} is not under test');
}

/// Mounts [CalendarScreen] at [size] on the app's own theme for [brightness],
/// under the chassis offline banner when [offline] — the same host `app.dart`
/// puts above every route.
///
/// [devicePixelRatio] 0.5 is for the goldens (a quarter of the pixels, the
/// same logical layout); the state cases use 1.
Future<void> pumpCalendar(
  WidgetTester tester, {
  required Size size,
  required CalendarRepository repository,
  Brightness brightness = Brightness.light,
  bool offline = false,
  double devicePixelRatio = 1,
}) async {
  tester.view.physicalSize = size * devicePixelRatio;
  tester.view.devicePixelRatio = devicePixelRatio;
  addTearDown(tester.view.reset);
  final ProviderContainer c = ProviderContainer(
    overrides: <Override>[
      ...defaultWidthOverrides(),
      subscriptionRepositoryProvider.overrideWithValue(repository),
    ],
  );
  addTearDown(c.dispose);
  await tester.pumpWidget(
    UncontrolledProviderScope(
      container: c,
      child: MaterialApp(
        debugShowCheckedModeBanner: false,
        theme: buildAppTheme(seed: kCalendarSeed, brightness: brightness),
        localizationsDelegates: <LocalizationsDelegate<dynamic>>[
          ...AppLocalizations.localizationsDelegates,
          ChassisLocalizations.delegate,
        ],
        supportedLocales: AppLocalizations.supportedLocales,
        builder: (BuildContext context, Widget? child) => OfflineBannerHost(
          unreachable: offline,
          onRetry: () {},
          child: child ?? const SizedBox.shrink(),
        ),
        home: const Scaffold(body: CalendarScreen(clock: kCalendarNow)),
      ),
    ),
  );
  // Provider futures resolve in sequence; a bounded pump, never a settle (a
  // pending fetch never settles, and that is the loading case).
  for (int i = 0; i < 12; i++) {
    await tester.pump();
  }
}
