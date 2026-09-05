// ─────────────────────────────────────────────────────────────────────────────
// THE PENDING-NOTIFICATION BUDGET — MEASURED THROUGH THE REAL PLUGIN CHANNEL.
//
// 🔴 WHY THIS FILE DOES NOT USE THE `NotificationService.forTesting()` SUBCLASS
// IDIOM. settings_wiring_test's `_RecordingNotificationService` and
// reminder_plan_test's `_RenderingNotifications` both OVERRIDE `syncAll` — they
// test the WIRING and the COPY, and are right to. Neither one ever runs the
// body of `syncAll`, so neither can see how many notifications it hands the OS.
// Override `syncAll` here and the defect below is invisible by construction,
// which is how it survived the other 832 tests in this suite.
//
// So this drives the REAL service — `forTesting()` for a fresh instance, then
// the real `init()` and the real `syncAll()` — over the plugin's REAL method
// channel, `dexterous.com/flutter/local_notifications`, mocked at the host
// boundary exactly as packages/notifications/test/tap_registration_test.dart
// does. Every `zonedSchedule` the service issues arrives here as an outgoing
// MethodCall, which is precisely what iOS counts against its limit.
//
// 🔴 THE PLATFORM LIMIT IS REAL AND SILENT. iOS and macOS keep only the 64
// soonest pending local notification requests per app and discard the rest —
// no error, no callback. Subly schedules one per subscription with no bound, so
// past ~64 subscriptions a user simply stopped being reminded, and `syncAll`
// re-issued the same overflow on every resume.
// ─────────────────────────────────────────────────────────────────────────────
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:subly/data/models/subscription.dart';
import 'package:subly/services/notifications/notification_service.dart';
import 'package:timezone/timezone.dart' as tz;

/// The plugin's own channel name, from
/// `flutter_local_notifications/lib/src/platform_flutter_local_notifications.dart`.
const MethodChannel _channel = MethodChannel(
  'dexterous.com/flutter/local_notifications',
);

/// The OS fact, restated independently of the constant the service uses, so
/// these assertions still mean something if that constant is ever raised.
const int _darwinPendingLimit = 64;

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late List<MethodCall> outgoing;

  setUpAll(() {
    // 🔴 MUST HAPPEN BEFORE THE FIRST `FlutterLocalNotificationsPlugin()`, AND
    // IT IS ALSO WHY THE ANDROID CASE BELOW IS NOT DRIVEN THROUGH THE CHANNEL.
    // That constructor is a `factory` returning a static instance whose
    // constructor picks the platform implementation ONCE, from
    // `defaultTargetPlatform`. Flipping the override mid-file does not re-pick
    // it — `zonedSchedule`'s Android branch would then null-assert on a
    // resolve that still returns the iOS implementation. One process, one
    // platform; so the channel proves the capped platform and the planner
    // proves the uncapped one.
    debugDefaultTargetPlatformOverride = TargetPlatform.iOS;
  });

  tearDownAll(() {
    debugDefaultTargetPlatformOverride = null;
  });

  setUp(() {
    outgoing = <MethodCall>[];
    // Stand in for the host. `initialize` returns a bool, so the default null
    // would throw on the cast.
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(_channel, (MethodCall call) async {
          outgoing.add(call);
          return true;
        });
  });

  tearDown(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(_channel, null);
    tz.setLocalLocation(tz.UTC);
  });

  /// A ready service whose every plugin call lands in [outgoing].
  Future<NotificationService> readyService() async {
    final NotificationService service = NotificationService.forTesting();
    await service.init();
    expect(
      outgoing.map((MethodCall c) => c.method),
      contains('initialize'),
      reason: 'the service must have reached the real plugin at all',
    );
    outgoing.clear();
    return service;
  }

  List<MethodCall> scheduled() =>
      outgoing.where((MethodCall c) => c.method == 'zonedSchedule').toList();

  /// The reminder BODY is the bare subscription name (see [_copy]), so the
  /// bodies of the outgoing calls name exactly which subscriptions got a slot.
  List<String> scheduledNames() => scheduled()
      .map((MethodCall c) => (c.arguments as Map<Object?, Object?>)['body']!)
      .cast<String>()
      .toList();

  group('what reaches the OS', () {
    test('80 subscriptions must not hand iOS more than it will keep', () async {
      final NotificationService service = await readyService();

      await service.syncAll(_subs(80), copy: _copy);

      expect(
        scheduled().length,
        lessThanOrEqualTo(_darwinPendingLimit),
        reason:
            'iOS keeps only the $_darwinPendingLimit soonest pending local '
            'notification requests and DROPS the rest silently. Every request '
            'above that number is a reminder the user was promised and will '
            'never receive.',
      );
      expect(scheduled().length, NotificationService.renewalReminderBudget);
    });

    test(
      'the kept reminders are the SOONEST, whatever order they arrive in',
      () async {
        final NotificationService service = await readyService();

        // Reversed on purpose: the repository gives no ordering guarantee, so a
        // cap that merely took the first N of the incoming list would keep an
        // arbitrary set and drop the renewals happening this week.
        await service.syncAll(_subs(80).reversed.toList(), copy: _copy);

        final int budget = NotificationService.renewalReminderBudget;
        expect(
          scheduledNames(),
          <String>[for (int i = 0; i < budget; i++) 'sub-$i'],
          reason:
              'the reminders that survive the cap must be the ones renewing '
              'first — those are the only ones a user could still act on',
        );
      },
    );

    test('a set inside the budget is scheduled in full, untouched', () async {
      final NotificationService service = await readyService();

      await service.syncAll(_subs(10), copy: _copy);

      expect(
        scheduled().length,
        10,
        reason: 'the cap must not touch the ordinary account',
      );
      expect(service.remindersDroppedByBudget, 0);
    });

    test('the overflow is countable, not silent', () async {
      final NotificationService service = await readyService();

      await service.syncAll(_subs(80), copy: _copy);

      expect(
        service.remindersDroppedByBudget,
        80 - NotificationService.renewalReminderBudget,
        reason: 'the whole point of the cap is that the drop is now a number',
      );
    });
  });

  group('the budget itself', () {
    test('leaves headroom below the platform limit for the digest', () {
      // `_digestId` lives in the same per-app pool, so a renewal set filling
      // all 64 slots would push the weekly digest out.
      expect(
        NotificationService.renewalReminderBudget,
        lessThan(_darwinPendingLimit),
        reason: 'no headroom left for the weekly digest',
      );
      expect(NotificationService.renewalReminderBudget, greaterThan(0));
    });

    test('applies to the Darwin platforms and to nothing else', () {
      // ⚠️ Capping a platform that has no cap is a regression, not a fix.
      expect(
        NotificationService.platformCapsPendingNotifications(
          TargetPlatform.iOS,
        ),
        isTrue,
      );
      expect(
        NotificationService.platformCapsPendingNotifications(
          TargetPlatform.macOS,
        ),
        isTrue,
      );
      for (final TargetPlatform p in <TargetPlatform>[
        TargetPlatform.android,
        TargetPlatform.linux,
        TargetPlatform.windows,
        TargetPlatform.fuchsia,
      ]) {
        expect(
          NotificationService.platformCapsPendingNotifications(p),
          isFalse,
          reason:
              '$p has no 64-request pool; narrowing its reminder set '
              'would delete working reminders',
        );
      }
    });
  });

  group('the plan, per platform', () {
    // Driven through `plannedReminders` rather than the channel: see the note
    // in `setUpAll` for why one test process can only exercise one platform
    // implementation of the plugin.
    test('Android keeps every one of the 80', () async {
      final NotificationService service = await readyService();

      expect(
        service
            .plannedReminders(_subs(80), platform: TargetPlatform.android)
            .length,
        80,
        reason: 'AlarmManager has no pending-request pool to overflow',
      );
    });

    test('iOS narrows 80 to the budget and macOS agrees', () async {
      final NotificationService service = await readyService();

      for (final TargetPlatform p in <TargetPlatform>[
        TargetPlatform.iOS,
        TargetPlatform.macOS,
      ]) {
        expect(
          service.plannedReminders(_subs(80), platform: p).length,
          NotificationService.renewalReminderBudget,
        );
      }
    });

    test(
      'a renewal already past its reminder instant never spends a slot',
      () async {
        final NotificationService service = await readyService();

        // 40 stale rows ahead of 40 live ones. Without the schedulable filter
        // the cap sorts the stale ones to the front, spends 40 of its 60 slots
        // on reminders `scheduleRenewalReminder` then declines to post, and the
        // user ends up with 20 reminders instead of 40.
        final List<Subscription> subs = <Subscription>[
          ..._subs(
            40,
            name: 'stale',
            from: DateTime.now().subtract(const Duration(days: 400)),
          ),
          ..._subs(40, name: 'live'),
        ];

        final List<Subscription> planned = service.plannedReminders(
          subs,
          platform: TargetPlatform.iOS,
        );

        expect(planned.length, 40);
        expect(
          planned.every((Subscription s) => s.name.startsWith('live')),
          isTrue,
          reason: 'a slot spent on an unpostable reminder is a slot burned',
        );
      },
    );
  });
}

/// [count] subscriptions renewing on consecutive days from [from], so `name-0`
/// renews first. The default start is far enough ahead that none is skipped by
/// the "don't fire in the past" guard.
List<Subscription> _subs(int count, {String name = 'sub', DateTime? from}) {
  final DateTime start = from ?? DateTime.now().add(const Duration(days: 30));
  return <Subscription>[
    for (int i = 0; i < count; i++)
      Subscription(
        id: '$name-id-$i',
        name: '$name-$i',
        category: 'Other',
        price: 10,
        cycle: BillingCycle.monthly,
        nextRenewal: start.add(Duration(days: i)),
      ),
  ];
}

/// The body is the bare subscription name so an assertion can read which
/// subscriptions got a slot straight off the outgoing method call.
final ReminderCopy _copy = ReminderCopy(
  channelName: 'Renewals',
  reminderTitle: 'Renewal',
  reminderBody: (String name, DateTime renewal) => name,
  digestTitle: 'Digest',
  digestBody: (int count, String total) => '$count / $total',
);
