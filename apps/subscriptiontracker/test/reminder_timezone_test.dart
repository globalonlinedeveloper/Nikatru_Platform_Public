// 🔴 THE PROOF THAT A "9 AM" RENEWAL REMINDER IS 9 AM WHERE THE USER IS.
//
// Every other app-level notification test pins `tz.setLocalLocation(tz.UTC)`,
// which is the one zone where the shipped defect (`tz.local` never set, so
// every reminder was 09:00 UTC = 14:30 IST) and the fix agree. This file goes
// through `init()`'s OWN resolver seam and asserts ABSOLUTE UTC instants, so a
// service that forgets `setLocalLocation` cannot pass it.
//
// MUTATION PROOF (run and recorded in the PR): delete the
// `tz.setLocalLocation(zone.location)` line in `NotificationService.init` and
// every case in the first group goes red.
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:subscriptiontracker/data/models/subscription.dart';
import 'package:subscriptiontracker/services/notifications/notification_service.dart';
import 'package:timezone/timezone.dart' as tz;

const MethodChannel _channel = MethodChannel(
  'dexterous.com/flutter/local_notifications',
);

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late List<MethodCall> outgoing;

  setUpAll(() {
    // One process, one platform — see reminder_budget_test.dart for why the
    // plugin singleton cannot be re-pointed mid-file.
    debugDefaultTargetPlatformOverride = TargetPlatform.iOS;
    // flutter_local_notifications 18+ installs its platform implementation
    // through registerWith(), which only the app's generated plugin registrant
    // calls; 17.x did it in the plugin constructor. A test registers it itself.
    IOSFlutterLocalNotificationsPlugin.registerWith();
  });

  tearDownAll(() {
    debugDefaultTargetPlatformOverride = null;
  });

  setUp(() {
    outgoing = <MethodCall>[];
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(_channel, (MethodCall call) async {
          outgoing.add(call);
          // `syncAll` reads the pending list to cancel only its own ids.
          if (call.method == 'pendingNotificationRequests') {
            return <Map<String, Object?>>[];
          }
          return true;
        });
    // Start from the WRONG zone on purpose, so "init() set it" is the only
    // way the assertions below can hold.
    tz.setLocalLocation(tz.UTC);
  });

  tearDown(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(_channel, null);
    tz.setLocalLocation(tz.UTC);
  });

  Subscription sub(DateTime renewal) => Subscription(
    id: 'netflix',
    name: 'Netflix',
    category: 'Entertainment',
    price: const Money(64900, 'INR'),
    cycle: BillingCycle.monthly,
    nextRenewal: renewal,
  );

  final ReminderCopy copy = ReminderCopy(
    channelName: 'Renewals',
    reminderTitle: 'Renewal',
    reminderBody: (String name, DateTime _) => name,
    digestTitle: 'Digest',
    digestBody: (int _, String _) => '',
  );

  Map<Object?, Object?> scheduledArgs() =>
      outgoing
              .singleWhere((MethodCall c) => c.method == 'zonedSchedule')
              .arguments
          as Map<Object?, Object?>;

  group('a 9 AM reminder under Asia/Kolkata', () {
    test('is scheduled at 03:30Z, not 09:00Z', () async {
      final NotificationService s = NotificationService.forTesting();
      await s.init(localTimezone: () async => 'Asia/Kolkata');

      expect(tz.local.name, 'Asia/Kolkata');
      expect(s.timezoneFallbackReason, isNull);

      final tz.TZDateTime? when = s.whenFor(sub(DateTime(2030, 6, 12)), 2);
      expect(when, isNotNull);
      expect(when!.hour, 9, reason: 'the wall clock the user reads');
      expect(
        when.toUtc(),
        DateTime.utc(2030, 6, 10, 3, 30),
        reason:
            '09:00 IST is 03:30Z; 09:00Z here means the service is '
            'scheduling in UTC and the reminder fires at 14:30 IST',
      );
    });

    test('and the plugin is handed that zone by NAME', () async {
      final NotificationService s = NotificationService.forTesting();
      await s.init(localTimezone: () async => 'Asia/Kolkata');
      outgoing.clear();

      await s.scheduleRenewalReminder(sub(DateTime(2030, 6, 12)), copy: copy);

      final Map<Object?, Object?> args = scheduledArgs();
      expect(args['timeZoneName'], 'Asia/Kolkata');
      expect(args['scheduledDateTime'], startsWith('2030-06-10T09:00:00'));
    });
  });

  group('DST is carried by the zone, not by a fixed offset', () {
    // America/New_York enters DST on Sunday 2030-03-10.
    test(
      '09:00 New York is 14:00Z before the change and 13:00Z after',
      () async {
        final NotificationService s = NotificationService.forTesting();
        await s.init(localTimezone: () async => 'America/New_York');

        expect(
          s.whenFor(sub(DateTime(2030, 3, 3)), 2)!.toUtc(),
          DateTime.utc(2030, 3, 1, 14),
        );
        expect(
          s.whenFor(sub(DateTime(2030, 3, 13)), 2)!.toUtc(),
          DateTime.utc(2030, 3, 11, 13),
        );
      },
    );
  });

  group('the fallback is loud and is never UTC', () {
    test(
      'a resolver that throws leaves a reason and a device offset',
      () async {
        final NotificationService s = NotificationService.forTesting();
        await s.init(localTimezone: () async => throw StateError('no channel'));

        expect(s.timezoneFallbackReason, isNotNull);
        expect(s.timezoneFallbackReason, contains('no channel'));
        expect(tz.local.name, startsWith('device'));
        expect(tz.local.name, isNot('UTC'));
      },
    );

    test(
      'a zone the database does not carry is the same degradation',
      () async {
        final NotificationService s = NotificationService.forTesting();
        await s.init(localTimezone: () async => 'Mars/Olympus_Mons');

        expect(s.timezoneFallbackReason, contains('Mars/Olympus_Mons'));
        expect(tz.local.name, startsWith('device'));
      },
    );
  });

  group('a clock or zone change is honoured at the next init()', () {
    test('a later init() re-resolves tz.local', () async {
      final NotificationService s = NotificationService.forTesting();
      await s.init(localTimezone: () async => 'Asia/Kolkata');
      expect(tz.local.name, 'Asia/Kolkata');

      // The device moved. Already-scheduled reminders keep the absolute
      // instants the OS holds; the next launch re-syncs the set in the new
      // zone, which is this call.
      await s.init(localTimezone: () async => 'Europe/London');
      expect(tz.local.name, 'Europe/London');
      expect(
        s.whenFor(sub(DateTime(2030, 6, 12)), 2)!.toUtc(),
        DateTime.utc(2030, 6, 10, 8),
        reason: '09:00 BST is 08:00Z',
      );
    });
  });
}
