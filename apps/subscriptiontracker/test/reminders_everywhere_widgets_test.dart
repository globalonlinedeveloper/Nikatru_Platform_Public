// Train T5 · the widget half of reminders everywhere.
//
//  · HO-09 — the catch-up nudge reads the CAPABILITY and "Renewal alerts",
//    not the retired daily switch launch forces off: a web-capability fake
//    with a passed reminder moment shows the banner.
//  · NO-09 — /notifications says where reminders go, by capability.
//  · NO-10 — each /notifications row action does its ONE thing; Esc and
//    Close still work.
//  · NO-12 — the exact-alarm offer shows ONCE; a refusal is said in Settings.
//  · NO-04 — "Renewal alerts" creates and removes the Linux login entry.
//
// MUTATION PROOF: point CatchUpNudgeBanner back at remindersEnabledProvider
// and the first case goes red; drop `answered.answer` from a row action and
// its row case does; drop `wasOffered()` from maybeOfferExactAlarms and the
// once case does.
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';
import 'package:nikatru_notifications/nikatru_notifications.dart'
    show ExactAlarmAccess, LinuxAutostartControl;
import 'package:subscriptiontracker/data/api/seed_api_client.dart';
import 'package:subscriptiontracker/data/models/subscription.dart';
import 'package:subscriptiontracker/data/subscriptions/subscription_repository.dart';
import 'package:subscriptiontracker/features/home/home_screen.dart';
import 'package:subscriptiontracker/features/notifications/notifications_screen.dart';
import 'package:subscriptiontracker/features/settings/reminder_settings.dart';
import 'package:subscriptiontracker/l10n/app_localizations.dart';
import 'package:subscriptiontracker/services/notifications/notification_service.dart';
import 'package:subscriptiontracker/state/providers.dart';
import 'package:subscriptiontracker/state/settings_controller.dart';

import 'support/recording_seam.dart';
import 'support/width_harness.dart';

RenewalReminders _web() => RenewalReminders.forTesting(isWeb: true);

void main() {
  group('HO-09 · the catch-up nudge comes back', () {
    Widget banner(DateTime now) =>
        Scaffold(body: CatchUpNudgeBanner(clock: () => now));

    testWidgets(
      'RED CONTROL: web capabilities + a passed reminder moment → banner',
      (WidgetTester tester) async {
        // 10:00, the default reminder time (09:00) has passed; "Renewal
        // alerts" is at its default, ON. The daily switch is NOT set — launch
        // forces it off, which is exactly why the banner never showed.
        await pumpAt(
          tester,
          kPhone,
          banner(DateTime(2026, 10, 1, 10)),
          overrides: <Override>[
            renewalRemindersProvider.overrideWithValue(_web()),
          ],
        );
        expect(find.byType(MaterialBanner), findsOneWidget);
      },
    );

    testWidgets('before the reminder moment: nothing', (
      WidgetTester tester,
    ) async {
      await pumpAt(
        tester,
        kPhone,
        banner(DateTime(2026, 10, 1, 8)),
        overrides: <Override>[
          renewalRemindersProvider.overrideWithValue(_web()),
        ],
      );
      expect(find.byType(MaterialBanner), findsNothing);
    });

    testWidgets('where the target schedules: nothing (no double message)', (
      WidgetTester tester,
    ) async {
      await pumpAt(tester, kPhone, banner(DateTime(2026, 10, 1, 10)));
      expect(find.byType(MaterialBanner), findsNothing);
    });

    testWidgets('"Renewal alerts" OFF is respected', (
      WidgetTester tester,
    ) async {
      final MemStore store = MemStore()
        ..data[kSettingsKey] = '{"prefs":{"alerts":false}}';
      await pumpAt(
        tester,
        kPhone,
        banner(DateTime(2026, 10, 1, 10)),
        overrides: <Override>[
          keyValueStoreProvider.overrideWith((_) async => store),
          renewalRemindersProvider.overrideWithValue(_web()),
        ],
      );
      expect(find.byType(MaterialBanner), findsNothing);
    });
  });

  group('NO-09 · the status line on /notifications', () {
    testWidgets('RED CONTROL: no push → e-mail + calendar, with Settings', (
      WidgetTester tester,
    ) async {
      await pumpAt(
        tester,
        kPhone,
        const NotificationsScreen(),
        overrides: <Override>[
          renewalRemindersProvider.overrideWithValue(_web()),
        ],
      );
      final AppLocalizations l10n = await AppLocalizations.delegate.load(
        const Locale('en'),
      );
      expect(find.text(l10n.notificationsStatusNoPush), findsOneWidget);
      expect(
        find.byKey(const Key('notificationsOpenSettings')),
        findsOneWidget,
      );
      expect(find.byKey(const Key('notificationsStatusLine')), findsNothing);
    });

    testWidgets(
      'RED CONTROL: push → "Reminders: on, {lead} before at {time}"',
      (WidgetTester tester) async {
        await pumpAt(tester, kPhone, const NotificationsScreen());
        final Finder line = find.byKey(const Key('notificationsStatusLine'));
        expect(line, findsOneWidget);
        expect(
          tester.widget<Text>(line).data,
          'Reminders: on, 2 days before at 9:00 AM',
        );
        expect(
          find.byKey(const Key('notificationsOpenSettings')),
          findsNothing,
        );
      },
    );

    testWidgets('push, alerts off → "Reminders: off"', (
      WidgetTester tester,
    ) async {
      final MemStore store = MemStore()
        ..data[kSettingsKey] = '{"prefs":{"alerts":false}}';
      await pumpAt(
        tester,
        kPhone,
        const NotificationsScreen(),
        overrides: <Override>[
          keyValueStoreProvider.overrideWith((_) async => store),
        ],
      );
      expect(
        tester
            .widget<Text>(find.byKey(const Key('notificationsStatusLine')))
            .data,
        'Reminders: off',
      );
    });
  });

  group('NO-10 · the in-app list acts', () {
    late _Api api;
    late RecordingSeam seam;

    Future<void> pump(WidgetTester tester) async {
      // The same clock the screen reads (`nowProvider`'s default), so a
      // time-travel run moves both (test/support/test_clock.dart).
      final DateTime t = wallClock();
      final Subscription sub = Subscription(
        id: 'netflix',
        name: 'Netflix',
        category: 'Other',
        price: const Money(649, 'USD'),
        cycle: BillingCycle.monthly,
        nextRenewal: DateTime(t.year, t.month, t.day + 2),
      );
      api = _Api(<Subscription>[sub]);
      seam = RecordingSeam();
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
            builder: (_, GoRouterState s) => Scaffold(
              body: Text('SUB ${s.pathParameters['id']} ${s.uri.query}'),
            ),
          ),
        ],
      );
      final ProviderContainer c = ProviderContainer(
        retry: (int retryCount, Object error) => null,
        overrides: <Override>[
          keyValueStoreProvider.overrideWith((_) async => MemStore()),
          renewalRemindersProvider.overrideWithValue(
            RenewalReminders.forTesting(
              platform: TargetPlatform.android,
              isWeb: false,
              service: seam,
            ),
          ),
          apiClientProvider.overrideWithValue(api),
          subscriptionRepositoryProvider.overrideWithValue(_Repo(api)),
        ],
      );
      addTearDown(c.dispose);
      await tester.binding.setSurfaceSize(const Size(800, 1600));
      addTearDown(() => tester.binding.setSurfaceSize(null));
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
      expect(find.byKey(const Key('notifications.paid.netflix')), findsOne);
    }

    Finder row() => find.byKey(const Key('notifications.paid.netflix'));

    testWidgets('RED CONTROL: Mark as paid records ONE payment', (
      WidgetTester tester,
    ) async {
      await pump(tester);
      await tester.tap(row());
      await tester.pumpAndSettle();
      expect(api.payments, <String>['netflix:6.49:USD']);
      expect(row(), findsNothing, reason: 'the answered notice leaves');
      expect(find.text('Marked Netflix as paid'), findsOneWidget);
      // No schedule was touched by a payment.
      expect(seam.pending.keys.where((int id) => id >= 0x50000000), isEmpty);
    });

    testWidgets('a failed payment is SAID and the notice stays', (
      WidgetTester tester,
    ) async {
      await pump(tester);
      api.fail = true;
      await tester.tap(row());
      await tester.pumpAndSettle();
      expect(find.text("Couldn't mark it as paid. Try again."), findsOneWidget);
      expect(row(), findsOneWidget);
    });

    testWidgets('RED CONTROL: Snooze re-arms the OS reminder; no network', (
      WidgetTester tester,
    ) async {
      await pump(tester);
      await tester.tap(find.byKey(const Key('notifications.snooze.netflix')));
      await tester.pumpAndSettle();
      expect(
        seam.pending.containsKey(RenewalReminders.snoozeIdFor('netflix')),
        isTrue,
      );
      expect(api.payments, isEmpty);
      expect(row(), findsNothing);
    });

    testWidgets('RED CONTROL: Keep it hides the notice; no network, no OS', (
      WidgetTester tester,
    ) async {
      await pump(tester);
      final int before = seam.pending.length;
      await tester.tap(find.byKey(const Key('notifications.keep.netflix')));
      await tester.pumpAndSettle();
      expect(row(), findsNothing);
      expect(api.payments, isEmpty);
      expect(seam.pending.length, before);
    });

    testWidgets('RED CONTROL: How to stop opens the plan at its stop entry', (
      WidgetTester tester,
    ) async {
      await pump(tester);
      await tester.tap(find.byKey(const Key('notifications.stop.netflix')));
      await tester.pumpAndSettle();
      expect(find.text('SUB netflix stop=1'), findsOneWidget);
    });

    testWidgets('Esc and Close still work beside the row actions', (
      WidgetTester tester,
    ) async {
      await pump(tester);
      await tester.sendKeyEvent(LogicalKeyboardKey.escape);
      await tester.pumpAndSettle();
      expect(find.text('HOME'), findsOneWidget);
      await pumpAgain(tester);
      await tester.tap(find.bySemanticsLabel('Close'));
      await tester.pumpAndSettle();
      expect(find.text('HOME'), findsOneWidget);
    });
  });

  group('NO-12 · exact alarms offered once', () {
    testWidgets('RED CONTROL: the offer shows once; a refusal is said', (
      WidgetTester tester,
    ) async {
      final _Exact exact = _Exact();
      await pumpAt(
        tester,
        const Size(800, 1600),
        Scaffold(
          body: Consumer(
            builder: (BuildContext context, WidgetRef ref, _) => Column(
              children: <Widget>[
                TextButton(
                  key: const Key('offer'),
                  onPressed: () => maybeOfferExactAlarms(context, ref),
                  child: const Text('offer'),
                ),
                const ReminderToolsRows(),
              ],
            ),
          ),
        ),
        overrides: <Override>[
          offersExactAlarmsProvider.overrideWithValue(true),
          exactAlarmAccessProvider.overrideWithValue(exact),
        ],
      );
      expect(
        find.byKey(const Key('settings.reminder.exactRefused')),
        findsNothing,
      );

      await tester.tap(find.byKey(const Key('offer')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('settings.reminder.exactOffer')), findsOne);
      await tester.tap(
        find.byKey(const Key('settings.reminder.exactOffer.open')),
      );
      await tester.pumpAndSettle();
      expect(exact.requests, 1, reason: 'the system page was opened');
      // Refused on the system page: Settings says so.
      expect(
        find.byKey(const Key('settings.reminder.exactRefused')),
        findsOneWidget,
      );
      expect(find.text('Reminders may arrive a little late.'), findsOneWidget);

      // Once: a second enable does not offer again.
      await tester.tap(find.byKey(const Key('offer')));
      await tester.pumpAndSettle();
      expect(
        find.byKey(const Key('settings.reminder.exactOffer')),
        findsNothing,
      );
      expect(exact.requests, 1);
    });

    testWidgets('already allowed: recorded, nothing shown', (
      WidgetTester tester,
    ) async {
      final _Exact exact = _Exact()..allowed = true;
      await pumpAt(
        tester,
        kPhone,
        Scaffold(
          body: Consumer(
            builder: (BuildContext context, WidgetRef ref, _) => TextButton(
              key: const Key('offer'),
              onPressed: () => maybeOfferExactAlarms(context, ref),
              child: const Text('offer'),
            ),
          ),
        ),
        overrides: <Override>[
          offersExactAlarmsProvider.overrideWithValue(true),
          exactAlarmAccessProvider.overrideWithValue(exact),
        ],
      );
      await tester.tap(find.byKey(const Key('offer')));
      await tester.pumpAndSettle();
      expect(
        find.byKey(const Key('settings.reminder.exactOffer')),
        findsNothing,
      );
      expect(exact.requests, 0);
    });

    testWidgets('not Android: never offered', (WidgetTester tester) async {
      final _Exact exact = _Exact();
      await pumpAt(
        tester,
        kPhone,
        Scaffold(
          body: Consumer(
            builder: (BuildContext context, WidgetRef ref, _) => TextButton(
              key: const Key('offer'),
              onPressed: () => maybeOfferExactAlarms(context, ref),
              child: const Text('offer'),
            ),
          ),
        ),
        overrides: <Override>[
          offersExactAlarmsProvider.overrideWithValue(false),
          exactAlarmAccessProvider.overrideWithValue(exact),
        ],
      );
      await tester.tap(find.byKey(const Key('offer')));
      await tester.pumpAndSettle();
      expect(
        find.byKey(const Key('settings.reminder.exactOffer')),
        findsNothing,
      );
    });
  });

  group('NO-13 · Send a test reminder', () {
    testWidgets(
      'RED CONTROL: where the target schedules, one arrives in 10 s',
      (WidgetTester tester) async {
        final RecordingSeam seam = RecordingSeam();
        await pumpAt(
          tester,
          const Size(800, 1600),
          const Scaffold(body: ReminderToolsRows()),
          overrides: <Override>[
            renewalRemindersProvider.overrideWithValue(
              RenewalReminders.forTesting(
                platform: TargetPlatform.android,
                isWeb: false,
                service: seam,
              ),
            ),
          ],
        );
        await tester.tap(find.byKey(const Key('settings.reminder.test')));
        await tester.pumpAndSettle();
        expect(seam.pending.keys, contains(RenewalReminders.testReminderId));
        expect(find.text('A test reminder arrives in 10 seconds.'), findsOne);
      },
    );

    // Web has no local path, and its e-mail leg waits for a host route (an
    // owner call on the shared mail quota): a row that can only fail is not
    // offered there.
    testWidgets('RED CONTROL: web is not offered a test it cannot send', (
      WidgetTester tester,
    ) async {
      await pumpAt(
        tester,
        const Size(800, 1600),
        const Scaffold(body: ReminderToolsRows()),
        overrides: <Override>[
          renewalRemindersProvider.overrideWithValue(
            RenewalReminders.forTesting(isWeb: true),
          ),
        ],
      );
      expect(find.byKey(const Key('settings.reminder.test')), findsNothing);
    });
  });

  group('NO-04 · the Linux login entry follows "Renewal alerts"', () {
    test('RED CONTROL: OFF removes it, ON creates it', () async {
      final _Autostart entry = _Autostart();
      final ProviderContainer c = ProviderContainer(
        overrides: <Override>[
          keyValueStoreProvider.overrideWith((_) async => MemStore()),
          renewalRemindersProvider.overrideWithValue(
            RenewalReminders.forTesting(
              platform: TargetPlatform.linux,
              isWeb: false,
            ),
          ),
          linuxAutostartProvider.overrideWithValue(entry),
        ],
      );
      addTearDown(c.dispose);
      final SettingsController s = c.read(settingsControllerProvider.notifier);
      await s.hydration;
      expect(await s.toggle('alerts'), isFalse);
      expect(entry.enabled, isFalse);
      expect(await s.toggle('alerts'), isTrue);
      expect(entry.enabled, isTrue);
      expect(entry.calls, <String>['disable', 'enable']);
    });
  });
}

Future<void> pumpAgain(WidgetTester tester) async {
  final GoRouter router = GoRouter.of(tester.element(find.text('HOME')));
  router.push('/home/notifications');
  await tester.pumpAndSettle();
}

class _Api extends SeedApiClient {
  _Api(this.subs);
  final List<Subscription> subs;
  final List<String> payments = <String>[];
  bool fail = false;

  @override
  Future<List<Subscription>> getSubscriptions() async => subs;

  @override
  Future<void> recordPayment(
    String id, {
    required Money amount,
    required DateTime paidOn,
    required String idempotencyKey,
  }) async {
    if (fail) throw StateError('offline');
    payments.add('$id:${amount.toMajorUnits()}:${amount.currencyCode}');
  }
}

class _Repo implements SubscriptionRepository {
  _Repo(this.api);
  final _Api api;

  @override
  Future<List<Subscription>> fetchAll() async => api.subs;

  @override
  dynamic noSuchMethod(Invocation invocation) =>
      throw UnimplementedError('${invocation.memberName}');
}

class _Exact implements ExactAlarmAccess {
  bool allowed = false;
  int requests = 0;

  @override
  Future<bool> canScheduleExact() async => allowed;

  @override
  Future<bool> requestExactAlarms() async {
    requests++;
    return allowed;
  }
}

class _Autostart implements LinuxAutostartControl {
  bool enabled = false;
  final List<String> calls = <String>[];

  @override
  String get path => '/fake/autostart/subscriptiontracker.desktop';

  @override
  Future<void> enable() async {
    calls.add('enable');
    enabled = true;
  }

  @override
  Future<void> disable() async {
    calls.add('disable');
    enabled = false;
  }

  @override
  Future<bool> isEnabled() async => enabled;
}
