// 🔴 THE PROOF THAT THE TWO NOTIFICATION SERVICES NO LONGER CANCEL EACH OTHER.
//
// The app's `NotificationService` (renewal reminders + weekly digest) and the
// chassis `createLocalNotificationService()` (the daily reminder, id 1) share
// ONE `FlutterLocalNotificationsPlugin` singleton — its constructor is a
// factory returning a static instance. Each used to call `cancelAll()`: the
// app's `syncAll` wiped the chassis daily reminder on every list change, and
// the chassis "reminders off" path — reached at EVERY launch, because the
// stored intent defaults to false — wiped every renewal reminder.
//
// Now each service cancels only the ids it owns. The app's renewal ids live
// in a namespace ([NotificationService.isRenewalReminderId]) disjoint from
// the chassis ids, and `syncAll` reads the OS pending list and cancels by
// membership. These cases drive the REAL plugin's Dart dispatch on iOS under a
// mocked channel that models the pending list, so what is asserted is the
// exact sequence the OS would receive.
//
// MUTATION PROOF (run and recorded in the PR): put `await cancelAll();` back
// in `syncAll` in place of `cancelOwnedRenewals()` and this file goes red.
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:subscriptiontracker/data/models/subscription.dart';
import 'package:subscriptiontracker/services/notifications/notification_service.dart';
import 'package:subscriptiontracker/state/providers/notifications.dart'
    show kDailyReminderId;
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

/// The OS's pending-notification pool, modelled: ids arrive through
/// `zonedSchedule`, leave through `cancel`, and are wiped by `cancelAll`.
class _Pool {
  final Set<int> ids = <int>{};
  final List<MethodCall> outgoing = <MethodCall>[];
  int cancelAllCalls = 0;

  Future<Object?> handle(MethodCall call) async {
    outgoing.add(call);
    switch (call.method) {
      case 'zonedSchedule':
        ids.add((call.arguments as Map<Object?, Object?>)['id']! as int);
        return true;
      case 'cancel':
        // The plugin sends the id as a positional map on iOS/macOS.
        final Object? args = call.arguments;
        final int id = args is Map<Object?, Object?>
            ? args['id']! as int
            : args! as int;
        ids.remove(id);
        return true;
      case 'cancelAll':
        cancelAllCalls += 1;
        ids.clear();
        return true;
      case 'pendingNotificationRequests':
        return <Map<String, Object?>>[
          for (final int id in ids)
            <String, Object?>{'id': id, 'title': '', 'body': '', 'payload': ''},
        ];
      default:
        return true;
    }
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late _Pool pool;

  setUpAll(() {
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
    pool = _Pool();
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(_channel, pool.handle);
    tz.setLocalLocation(tz.UTC);
  });
  tearDown(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(_channel, null);
  });

  Future<NotificationService> service() async {
    final NotificationService s = NotificationService.forTesting(
      platform: TargetPlatform.iOS,
      isWeb: false,
    );
    await s.init(localTimezone: () async => 'Asia/Kolkata');
    return s;
  }

  test(
    '🔴 syncAll leaves the chassis daily reminder (id 1) standing',
    () async {
      final NotificationService s = await service();
      // The chassis scheduled its daily nudge on the same plugin.
      pool.ids.add(kDailyReminderId);

      await s.syncAll(<Subscription>[
        _sub('netflix'),
        _sub('spotify'),
      ], copy: _copy);

      expect(pool.cancelAllCalls, 0, reason: 'syncAll must never cancelAll');
      expect(pool.ids, contains(kDailyReminderId));
      expect(
        pool.ids.where(NotificationService.isRenewalReminderId),
        hasLength(2),
      );
    },
  );

  test('🔴 a subscription removed while the app was closed is still cancelled '
      '— by membership in the pending list, not by wiping it', () async {
    // Launch 1 schedules two.
    final NotificationService first = await service();
    await first.syncAll(<Subscription>[
      _sub('netflix'),
      _sub('spotify'),
    ], copy: _copy);
    final int spotify = NotificationService.renewalIdFor('spotify');
    expect(pool.ids, contains(spotify));
    pool.ids.add(kDailyReminderId);

    // Launch 2 is a NEW service with an empty in-process set; only the OS
    // pending list knows about spotify.
    final NotificationService second = await service();
    await second.syncAll(<Subscription>[_sub('netflix')], copy: _copy);

    expect(pool.cancelAllCalls, 0);
    expect(pool.ids, isNot(contains(spotify)));
    expect(pool.ids, contains(NotificationService.renewalIdFor('netflix')));
    expect(pool.ids, contains(kDailyReminderId));
  });

  test('the digest is not a renewal: syncAll leaves it, cancelWeeklyDigest '
      'takes only it', () async {
    final NotificationService s = await service();
    await s.scheduleWeeklyDigest(copy: _copy, count: 1, formattedTotal: '');
    final int digest = pool.ids.single;
    expect(NotificationService.isRenewalReminderId(digest), isFalse);

    await s.syncAll(<Subscription>[_sub('netflix')], copy: _copy);
    expect(pool.ids, contains(digest));

    await s.cancelWeeklyDigest();
    expect(pool.ids, isNot(contains(digest)));
    expect(pool.ids, contains(NotificationService.renewalIdFor('netflix')));
  });

  test(
    'the renewal namespace is disjoint from every other id on the plugin',
    () {
      expect(
        NotificationService.isRenewalReminderId(kDailyReminderId),
        isFalse,
      );
      expect(
        NotificationService.isRenewalReminderId(0x7f000000),
        isFalse,
        reason: 'the chassis immediate bucket',
      );
      expect(
        NotificationService.isRenewalReminderId(0x7ffffffe),
        isFalse,
        reason: 'the digest',
      );
      for (final String id in <String>['a', 'netflix', 'x' * 200, '']) {
        expect(
          NotificationService.isRenewalReminderId(
            NotificationService.renewalIdFor(id),
          ),
          isTrue,
        );
      }
    },
  );

  test('renewal ids are STABLE — a value, not String.hashCode', () {
    // Pinned constants: if this changes, every alarm a previous build
    // scheduled is orphaned and `cancelForSubscription` misses it.
    expect(
      NotificationService.renewalIdFor('netflix'),
      NotificationService.renewalIdFor('netflix'),
    );
    expect(
      NotificationService.renewalIdFor(''),
      0x10000000 + (0x811c9dc5 % 0x40000000),
    );
    expect(
      NotificationService.renewalIdFor('a'),
      isNot(NotificationService.renewalIdFor('b')),
    );
  });

  test(
    'cancelAll still exists for sign-out, and DOES wipe everything',
    () async {
      final NotificationService s = await service();
      pool.ids.add(kDailyReminderId);
      await s.syncAll(<Subscription>[_sub('netflix')], copy: _copy);
      await s.cancelAll();
      expect(pool.cancelAllCalls, 1);
      expect(pool.ids, isEmpty);
    },
  );
}
