// ─────────────────────────────────────────────────────────────────────────────
// THE PENDING-NOTIFICATION BUDGET — MEASURED THROUGH THE REAL PLUGIN CHANNEL.
//
// 🔴 WHY THIS FILE DOES NOT USE THE `NotificationService.forTesting()` SUBCLASS
// IDIOM. settings_wiring_test's `_RecordingNotificationService` and
// reminder_plan_test's `_RenderingNotifications` both OVERRIDE `syncAll` — they
// test the WIRING and the COPY, and are right to. Neither one ever runs the
// body of `syncAll`, so neither can see how many notifications it hands the OS.
// Override `syncAll` here and the defect below is invisible by construction.
//
// So this drives the REAL service — `forTesting()` for a fresh instance, then
// the real `init()` and the real `syncAll()` — over the plugin's REAL method
// channel, `dexterous.com/flutter/local_notifications`, mocked at the host
// boundary exactly as packages/notifications/test/tap_registration_test.dart
// does. Every `zonedSchedule` the service issues arrives here as an outgoing
// MethodCall, which is precisely what iOS counts against its limit.
//
// 🔴 THE PLATFORM LIMIT IS REAL AND SILENT. iOS and macOS keep only the 64
// soonest pending local notifications per app and discard the rest — no error,
// no callback, no way to ask afterwards. Subly schedules one per subscription
// with no bound, so past ~64 subscriptions a user simply stops being reminded,
// and `syncAll` re-issues the same overflow on every resume.
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

/// The OS fact, stated here independently of the constant the service uses, so
/// this assertion still means something if that constant is ever raised.
/// UNUserNotificationCenter keeps the 64 soonest pending requests per app.
const int _iosPendingLimit = 64;

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late List<MethodCall> outgoing;

  setUpAll(() {
    // 🔴 MUST HAPPEN BEFORE THE FIRST `FlutterLocalNotificationsPlugin()`.
    // That constructor is a `factory` returning a static instance, and the
    // instance's constructor picks the platform implementation ONCE, from
    // `defaultTargetPlatform`. Setting the override in a `setUp` would be too
    // late for whichever test ran first.
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

  /// The reminder BODY is the subscription name (see [_copy]), so the bodies of
  /// the outgoing calls name exactly which subscriptions got a slot.
  List<String> scheduledNames() => scheduled()
      .map((MethodCall c) => (c.arguments as Map<Object?, Object?>)['body']!)
      .cast<String>()
      .toList();

  test(
    '80 subscriptions must not hand iOS more than it will keep',
    () async {
      final NotificationService service = await readyService();

      await service.syncAll(_subs(80), copy: _copy);

      expect(
        scheduled().length,
        lessThanOrEqualTo(_iosPendingLimit),
        reason:
            'iOS keeps only the $_iosPendingLimit soonest pending local '
            'notifications and DROPS the rest silently. Anything above that '
            'number is a reminder the user was promised and will never get.',
      );
    },
  );

}

/// [count] subscriptions renewing on consecutive days, far enough ahead that
/// none is skipped by the "don't fire in the past" guard. `sub-0` renews first.
List<Subscription> _subs(int count) => <Subscription>[
  for (int i = 0; i < count; i++)
    Subscription(
      id: 'id-$i',
      name: 'sub-$i',
      category: 'Other',
      price: 10,
      cycle: BillingCycle.monthly,
      nextRenewal: DateTime.now().add(Duration(days: 30 + i)),
    ),
];

/// The body is the bare subscription name so an assertion can read which
/// subscriptions got a slot straight off the outgoing method call.
final ReminderCopy _copy = ReminderCopy(
  channelName: 'Renewals',
  reminderTitle: 'Renewal',
  reminderBody: (String name, DateTime renewal) => name,
  digestTitle: 'Digest',
  digestBody: (int count, String total) => '$count / $total',
);
