// 🔴 THE PROOF THAT A DESKTOP LIST LOAD NO LONGER THROWS.
//
// flutter_local_notifications 17.2.4 answers `initialize` with `true` on
// Windows and Linux and then throws `UnimplementedError` out of
// `zonedSchedule` (lib/src/flutter_local_notifications_plugin.dart:377 — the
// final `else` of a `defaultTargetPlatform` dispatch). The app service used to
// set `_ready = true` on that `true` and schedule anyway, so on both desktop
// targets EVERY list load ended in an uncaught async error — while the
// settings screen said "Reminders are not available on this platform."
//
// These cases run the REAL plugin's Dart dispatch under a mocked channel with
// `debugDefaultTargetPlatformOverride` set to the desktop target, so the
// throw is the plugin's own and not a fake's. The service must never reach it.
//
// MUTATION PROOF (run and recorded in the PR): delete the
// `if (!capabilities.canNotify) return;` line at the top of `init()` AND the
// `!capabilities.canSchedule` half of EVERY scheduling guard — `syncAll`,
// `scheduleRenewalReminder` and `scheduleWeeklyDigest` — and the Windows and
// Linux cases go red with the plugin's own UnimplementedError.
// ⚠️ Removing `syncAll`'s guard ALONE stays green, MEASURED: `syncAll`
// schedules through `scheduleRenewalReminder`, whose own guard still refuses.
// The gates are layered on purpose; the proof has to take all of them.
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart'
    show FlutterLocalNotificationsPlugin, IOSFlutterLocalNotificationsPlugin;
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_notifications/nikatru_notifications.dart'
    show NotificationCapabilities;
import 'package:subscriptiontracker/data/models/subscription.dart';
import 'package:subscriptiontracker/services/notifications/notification_service.dart';
import 'package:timezone/timezone.dart' as tz;

const MethodChannel _channel = MethodChannel(
  'dexterous.com/flutter/local_notifications',
);

Subscription _sub(String id) => Subscription(
  id: id,
  name: id,
  category: 'Entertainment',
  price: const Money(64900, 'INR'),
  cycle: BillingCycle.monthly,
  nextRenewal: DateTime.now().add(const Duration(days: 30)),
);

final ReminderCopy _copy = ReminderCopy(
  channelName: 'Renewals',
  reminderTitle: 'Renewal',
  reminderBody: (String name, DateTime _) => name,
  digestTitle: 'Digest',
  digestBody: (int _, String _) => '',
);

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late List<MethodCall> outgoing;

  // 🔴 THE PLUGIN IS A PROCESS SINGLETON, AND IT PICKS ITS PLATFORM
  // IMPLEMENTATION ONCE, AT FIRST CONSTRUCTION, FROM `defaultTargetPlatform`.
  // Built first under the Windows override it registered NOTHING (17.x had no
  // Windows implementation), and every later case in this file then died of a
  // LateInitializationError that production can never reach. Since 18.x the
  // constructor registers nothing at all and registerWith() does, so the iOS
  // method-channel implementation the mocked channel below observes is
  // registered here, once. Linux in production is the D-Bus
  // implementation the Dart plugin registrant installs — never this channel —
  // so the Linux case asserts what the SERVICE refuses, not what D-Bus hears.
  setUpAll(() {
    debugDefaultTargetPlatformOverride = TargetPlatform.iOS;
    IOSFlutterLocalNotificationsPlugin.registerWith();
    FlutterLocalNotificationsPlugin();
    debugDefaultTargetPlatformOverride = null;
  });

  setUp(() {
    outgoing = <MethodCall>[];
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(_channel, (MethodCall call) async {
          outgoing.add(call);
          // The host, modelled as the desktop plugin behaves: `initialize`
          // answers true, the pending list is empty, everything else "ok".
          if (call.method == 'pendingNotificationRequests') {
            return <Map<String, Object?>>[];
          }
          return true;
        });
    tz.setLocalLocation(tz.UTC);
  });

  tearDown(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(_channel, null);
    debugDefaultTargetPlatformOverride = null;
  });

  Iterable<String> methods() => outgoing.map((MethodCall c) => c.method);

  group('🔴 a fake Windows: no plugin initialised (no init settings yet)', () {
    test(
      'init + syncAll COMPLETE with no throw, no schedule, no initialize',
      () async {
        debugDefaultTargetPlatformOverride = TargetPlatform.windows;
        final NotificationService s = NotificationService.forTesting(
          platform: TargetPlatform.windows,
          isWeb: false,
        );
        expect(s.capabilities.canNotify, isFalse);
        expect(s.capabilities.canSchedule, isFalse);
        expect(s.unavailability, ReminderUnavailability.noNotifications);

        await s.init(localTimezone: () async => 'Asia/Kolkata');
        // The whole reason this test exists: this line used to throw
        // UnimplementedError out of the plugin on every list load.
        await expectLater(
          s.syncAll(<Subscription>[
            _sub('netflix'),
            _sub('spotify'),
          ], copy: _copy),
          completes,
        );
        await expectLater(
          s.scheduleWeeklyDigest(copy: _copy, count: 2, formattedTotal: ''),
          completes,
        );
        expect(methods(), isNot(contains('zonedSchedule')));
        expect(methods(), isNot(contains('initialize')));
        expect(methods(), isNot(contains('cancelAll')));
      },
    );
  });

  group('🔴 a fake Linux: shows, cannot schedule', () {
    test(
      'init runs the plugin; syncAll and the digest refuse without a throw',
      () async {
        debugDefaultTargetPlatformOverride = TargetPlatform.linux;
        final NotificationService s = NotificationService.forTesting(
          platform: TargetPlatform.linux,
          isWeb: false,
        );
        expect(s.capabilities.canNotify, isTrue);
        expect(s.capabilities.canSchedule, isFalse);
        expect(s.unavailability, ReminderUnavailability.noScheduling);

        await s.init(localTimezone: () async => 'Europe/Berlin');
        await expectLater(
          s.syncAll(<Subscription>[_sub('netflix')], copy: _copy),
          completes,
        );
        await expectLater(
          s.scheduleWeeklyDigest(copy: _copy, count: 1, formattedTotal: ''),
          completes,
        );
        expect(methods(), isNot(contains('zonedSchedule')));
      },
    );
  });

  group('the matrix the service reads is the chassis matrix', () {
    test('every target agrees with NotificationCapabilities.forPlatform', () {
      for (final TargetPlatform p in TargetPlatform.values) {
        final NotificationService s = NotificationService.forTesting(
          platform: p,
          isWeb: false,
        );
        final NotificationCapabilities expected =
            NotificationCapabilities.forPlatform(p, isWeb: false);
        expect(s.capabilities.canNotify, expected.canNotify, reason: '$p');
        expect(s.capabilities.canSchedule, expected.canSchedule, reason: '$p');
      }
      final NotificationService web = NotificationService.forTesting(
        platform: TargetPlatform.android,
        isWeb: true,
      );
      expect(web.capabilities.canNotify, isFalse);
      expect(web.unavailability, ReminderUnavailability.noNotifications);
    });

    test(
      'a scheduling target (iOS) still schedules — the gate is not a blanket',
      () async {
        debugDefaultTargetPlatformOverride = TargetPlatform.iOS;
        final NotificationService s = NotificationService.forTesting(
          platform: TargetPlatform.iOS,
          isWeb: false,
        );
        expect(s.unavailability, isNull);
        await s.init(localTimezone: () async => 'Asia/Kolkata');
        await s.syncAll(<Subscription>[_sub('netflix')], copy: _copy);
        expect(
          methods().where((String m) => m == 'zonedSchedule'),
          hasLength(1),
        );
      },
    );
  });
}
