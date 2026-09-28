// ─────────────────────────────────────────────────────────────────────────────
// EXACT ALARMS — MEASURED THROUGH THE REAL PLUGIN CHANNEL, WITH A HOST THAT
// REFUSES THE WAY ANDROID REFUSES.
//
// 🔴 THE DEFECT THIS FILE LOCKS OUT. Every `zonedSchedule` in
// `notification_service.dart` passed `AndroidScheduleMode.exactAllowWhileIdle`
// unconditionally, and `android/app/src/main/AndroidManifest.xml` declares NO
// permission at all — zero `<uses-permission>` elements, with
// flutter_local_notifications 17.2.4 contributing only VIBRATE and
// POST_NOTIFICATIONS from its own plugin manifest. So on every Android 12+
// device `AlarmManager.canScheduleExactAlarms()` is false, and the plugin's Java
// side (`setupAllowWhileIdleAlarm` → `checkCanScheduleExactAlarms` →
// `ExactAlarmPermissionException`, error code `exact_alarms_not_permitted`)
// refuses the call.
//
// ⚠️ AND IT COSTS THE WHOLE SET, NOT ONE REMINDER. That refusal arrives in Dart
// as a `PlatformException` out of `zonedSchedule`; nothing caught it; and
// `syncAll` schedules in a `for` loop. The first subscription threw and the loop
// never reached the second. A user with forty subscriptions received nothing,
// from one uncaught throw, with no crash report and no red test.
//
// 🔴 SO THE FAKE HOST BELOW THROWS. A mock that cheerfully accepted an exact
// request would leave the assertions green over exactly the defect — the shape
// this repository has been caught by more than once. `_host` models the Java
// side: an exact mode while `exactPermitted` is false throws the real error
// code, so a regression to unconditional exact shows up as ZERO notifications
// scheduled, which is what the device does.
//
// Driven over the plugin's REAL method channel rather than a
// `NotificationService.forTesting()` override, for the reason
// reminder_budget_test.dart records: an override of `syncAll` never runs its
// body, so it cannot see what reached the OS — and what reached the OS is the
// entire question here.
// ─────────────────────────────────────────────────────────────────────────────
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:subscriptiontracker/data/models/subscription.dart';
import 'package:subscriptiontracker/services/notifications/notification_service.dart';
import 'package:timezone/timezone.dart' as tz;

/// The plugin's own channel name, from
/// `flutter_local_notifications/lib/src/platform_flutter_local_notifications.dart`.
const MethodChannel _channel = MethodChannel(
  'dexterous.com/flutter/local_notifications',
);

/// The plugin's own error code for a refused exact alarm, restated here rather
/// than imported: it is a Java-side constant
/// (`EXACT_ALARMS_PERMISSION_ERROR_CODE`) with no Dart export, and a test that
/// read it from the code under test would agree with a typo.
const String _refusalCode = 'exact_alarms_not_permitted';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late List<MethodCall> outgoing;

  /// What the fake OS says to `canScheduleExactNotifications`.
  late bool exactPermitted;

  /// Whether the fake OS ACTUALLY honours an exact request. Normally equal to
  /// [exactPermitted]; the two are separated so the race — permission revoked
  /// between the check and the schedule — can be modelled.
  late bool exactHonoured;

  /// An unrelated failure, so "we swallow the right exception" is a real claim
  /// rather than "we swallow everything".
  late bool failEverything;

  setUpAll(() {
    // 🔴 BEFORE THE FIRST `FlutterLocalNotificationsPlugin()`. That constructor
    // is a `factory` returning a static instance which picks its platform
    // implementation ONCE from `defaultTargetPlatform`; flipping the override
    // later does not re-pick it. One process, one platform — and this file's
    // whole subject is the Android one.
    debugDefaultTargetPlatformOverride = TargetPlatform.android;
    // flutter_local_notifications 18+ installs its platform implementation
    // through registerWith(), which only the app's generated plugin registrant
    // calls; 17.x did it in the plugin constructor. A test registers it itself.
    AndroidFlutterLocalNotificationsPlugin.registerWith();
  });

  tearDownAll(() {
    debugDefaultTargetPlatformOverride = null;
  });

  setUp(() {
    outgoing = <MethodCall>[];
    exactPermitted = false;
    exactHonoured = true;
    failEverything = false;
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(_channel, (MethodCall call) async {
          outgoing.add(call);
          if (failEverything) {
            throw PlatformException(code: 'some_other_failure');
          }
          switch (call.method) {
            case 'pendingNotificationRequests':
              // `syncAll` reads the pending list to cancel only its own ids.
              return <Map<String, Object?>>[];
            case 'canScheduleExactNotifications':
              return exactPermitted;
            case 'requestExactAlarmsPermission':
              return exactPermitted;
            case 'zonedSchedule':
              // THE HOST, MODELLED. `AlarmManagerCompat.setExactAndAllowWhileIdle`
              // is reached only through `checkCanScheduleExactAlarms`, which
              // throws when the permission is absent.
              final String mode =
                  ((call.arguments
                              as Map<Object?, Object?>)['platformSpecifics']
                          as Map<Object?, Object?>)['scheduleMode']!
                      as String;
              final bool wantsExact =
                  mode == 'exact' ||
                  mode == 'exactAllowWhileIdle' ||
                  mode == 'alarmClock';
              if (wantsExact && !(exactPermitted && exactHonoured)) {
                throw PlatformException(
                  code: _refusalCode,
                  message: 'Exact alarms are not permitted',
                );
              }
              return null;
            default:
              return true;
          }
        });
  });

  tearDown(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(_channel, null);
    tz.setLocalLocation(tz.UTC);
  });

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

  List<String> modes() => scheduled()
      .map(
        (MethodCall c) =>
            ((c.arguments as Map<Object?, Object?>)['platformSpecifics']
                    as Map<Object?, Object?>)['scheduleMode']!
                as String,
      )
      .cast<String>()
      .toList();

  // ───────────────────────────────────────────────────────────────────────────
  group('a device that has NOT granted SCHEDULE_EXACT_ALARM', () {
    test(
      'still gets every renewal reminder — the whole set, not the first one',
      () async {
        final NotificationService service = await readyService();

        await service.syncAll(_subs(12), copy: _copy);

        expect(
          scheduled().length,
          12,
          reason:
              'AT HEAD OF THE DEFECT THIS IS 0. The first subscription threw '
              '`$_refusalCode` out of zonedSchedule and syncAll\'s for-loop '
              'never reached the second, so an account with twelve '
              'subscriptions was reminded about none of them.',
        );
        expect(
          modes().toSet(),
          <String>{'inexactAllowWhileIdle'},
          reason:
              'degrade, do not fail: setAndAllowWhileIdle still fires while '
              'the device is dozing, it just lets the OS batch the wake-up. A '
              'renewal reminder tolerates a ten-minute window; a missing one '
              'does not.',
        );
      },
    );

    test('the weekly digest degrades on the same terms', () async {
      final NotificationService service = await readyService();

      await service.scheduleWeeklyDigest(
        copy: _copy,
        count: 3,
        formattedTotal: 'Rs 900',
      );

      expect(scheduled().length, 1);
      expect(modes(), <String>['inexactAllowWhileIdle']);
    });

    test('a single reminder resolves the mode for itself', () async {
      // No batch to inherit from: the one-off path must read the OS rather than
      // assume the batch default.
      final NotificationService service = await readyService();

      await service.scheduleRenewalReminder(_subs(1).single, copy: _copy);

      expect(modes(), <String>['inexactAllowWhileIdle']);
    });

    test('canScheduleExactAlarms reports the refusal honestly', () async {
      final NotificationService service = await readyService();
      expect(await service.canScheduleExactAlarms(), isFalse);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  group('a device that HAS granted it', () {
    test('keeps exact precision when the OS grants it', () async {
      exactPermitted = true;
      final NotificationService service = await readyService();

      await service.syncAll(_subs(3), copy: _copy);

      expect(scheduled().length, 3);
      expect(
        modes().toSet(),
        <String>{'exactAllowWhileIdle'},
        reason:
            'a user who granted the permission bought precision and must keep '
            'it; a blanket switch to inexact would be the opposite defect',
      );
    });

    test('canScheduleExactAlarms reports the grant', () async {
      exactPermitted = true;
      final NotificationService service = await readyService();
      expect(await service.canScheduleExactAlarms(), isTrue);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  group('the reading is taken once per batch', () {
    test('twelve subscriptions cost ONE permission round-trip', () async {
      final NotificationService service = await readyService();

      await service.syncAll(_subs(12), copy: _copy);

      expect(
        outgoing
            .where(
              (MethodCall c) => c.method == 'canScheduleExactNotifications',
            )
            .length,
        1,
        reason:
            'the answer cannot change inside one loop in any way the user '
            'would notice, and eighty subscriptions must not mean eighty extra '
            'platform round-trips',
      );
    });

    test('and it is NOT cached across batches', () async {
      // The user can revoke "Alarms & reminders" from system settings between
      // two syncs. A cached `true` is how an app goes on issuing alarms the OS
      // is refusing — the exact shape providers/notifications.dart already
      // records for the notification permission.
      exactPermitted = true;
      final NotificationService service = await readyService();
      await service.syncAll(_subs(1), copy: _copy);
      expect(modes(), <String>['exactAllowWhileIdle']);

      outgoing.clear();
      exactPermitted = false;
      await service.syncAll(_subs(1), copy: _copy);
      expect(modes(), <String>['inexactAllowWhileIdle']);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  group('the race between the check and the schedule', () {
    test('a refusal AFTER a granted reading still lands the reminder', () async {
      // Two separate IPC calls, so the permission can be revoked between them.
      // The window is small; the cost of not handling it is the whole set.
      exactPermitted = true;
      exactHonoured = false;
      final NotificationService service = await readyService();

      await service.syncAll(_subs(4), copy: _copy);

      expect(scheduled().length, 8, reason: '4 exact tries, 4 retries');
      expect(
        modes().where((String m) => m == 'inexactAllowWhileIdle').length,
        4,
        reason: 'each refused notification is retried inexact and lands',
      );
    });

    test('an UNRELATED PlatformException is not swallowed', () async {
      final NotificationService service = await readyService();
      failEverything = true;

      await expectLater(
        service.scheduleRenewalReminder(_subs(1).single, copy: _copy),
        throwsA(isA<PlatformException>()),
      );
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  group('the mapping itself', () {
    test('granted → exactAllowWhileIdle, refused → inexactAllowWhileIdle', () {
      expect(
        NotificationService.scheduleModeFor(permitted: true),
        AndroidScheduleMode.exactAllowWhileIdle,
      );
      expect(
        NotificationService.scheduleModeFor(permitted: false),
        AndroidScheduleMode.inexactAllowWhileIdle,
      );
    });

    test('the refused mode is one that needs NO permission', () {
      // 🔴 THE POINT OF THE WHOLE CHANGE. `alarmClock`, `exact` and
      // `exactAllowWhileIdle` all reach `checkCanScheduleExactAlarms` in the
      // plugin's Java. Only the two inexact modes do not, and only
      // `inexactAllowWhileIdle` also survives Doze.
      const List<AndroidScheduleMode> needPermission = <AndroidScheduleMode>[
        AndroidScheduleMode.alarmClock,
        AndroidScheduleMode.exact,
        AndroidScheduleMode.exactAllowWhileIdle,
      ];
      const AndroidScheduleMode ok = AndroidScheduleMode.inexactAllowWhileIdle;
      expect(needPermission, isNot(contains(ok)));
      expect(NotificationService.scheduleModeFor(permitted: false), ok);
    });
  });
}

// ── fixtures ────────────────────────────────────────────────────────────────

/// [n] subscriptions renewing on consecutive days, far enough ahead that
/// `_whenFor` never returns null and `validateDateIsInTheFuture` never throws.
List<Subscription> _subs(int n) {
  final DateTime base = DateTime.now().add(const Duration(days: 30));
  return <Subscription>[
    for (int i = 0; i < n; i++)
      Subscription(
        id: 'sub-id-$i',
        name: 'sub-$i',
        category: 'Other',
        price: const Money(1000, 'USD'),
        cycle: BillingCycle.monthly,
        nextRenewal: base.add(Duration(days: i)),
      ),
  ];
}

/// The reminder BODY is the bare subscription name, so an outgoing call names
/// exactly which subscription it belongs to.
final ReminderCopy _copy = ReminderCopy(
  channelName: 'Renewals',
  reminderTitle: 'Renewal',
  reminderBody: (String name, DateTime when) => name,
  digestTitle: 'Weekly',
  digestBody: (int count, String total) => '$count · $total',
);
