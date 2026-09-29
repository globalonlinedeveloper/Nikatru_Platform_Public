// 🔴 THE PROOF THAT THE TWO USERS OF ONE NOTIFICATION PLUGIN DO NOT CANCEL
// EACH OTHER.
//
// The app's renewal reminders and the chassis daily reminder (id 1) share one
// plugin. Each used to call `cancelAll()`: the app's `syncAll` wiped the daily
// reminder on every list change, and the chassis "reminders off" path — reached
// at every launch — wiped every renewal reminder. Now the renewal set is
// rebuilt with `reconcile(owns: isRenewalReminderId)`, a namespace disjoint
// from every chassis id.
//
// ⏱ 2026-09-28 (ST-R4): proven at the core seam. The seam's reconcile reads the
// OS pending list (packages/notifications/test proves THAT half), so a model of
// the queue is the right fake here.
//
// MUTATION PROOF: make `syncAll` call `_service.cancelAll()` before reconcile
// and the first case goes red.
import 'package:flutter/foundation.dart' show TargetPlatform;
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:subscriptiontracker/data/models/subscription.dart';
import 'package:subscriptiontracker/services/notifications/notification_service.dart';
import 'package:subscriptiontracker/state/providers/notifications.dart'
    show kDailyReminderId;

import 'support/recording_seam.dart';

ReminderCopy _copy() => ReminderCopy(
  channelName: 'Renewal reminders',
  channelDescription: 'Alerts before a charge',
  reminderTitle: 'Renewal coming up',
  reminderBody: (String n, DateTime d) => '$n renews',
  digestTitle: 'Weekly',
  digestBody: (int c, String t) => '$c, $t',
  cancelByTitle: (DateTime d) => 'Cancel by',
  cancelByBody: (String n, DateTime d) => '$n by',
);

Subscription _sub(String id, DateTime renewal) => Subscription(
  id: id,
  name: id,
  category: 'Other',
  price: const Money(1000, 'USD'),
  cycle: BillingCycle.monthly,
  nextRenewal: renewal,
);

void main() {
  final DateTime now = DateTime(2026, 10, 1, 8);
  late RecordingSeam seam;
  late RenewalReminders svc;

  setUp(() {
    seam = RecordingSeam()..foreign.add(kDailyReminderId);
    svc = RenewalReminders.forTesting(
      platform: TargetPlatform.iOS,
      isWeb: false,
      service: seam,
      now: () => now,
    );
  });

  test('syncAll never touches the chassis daily reminder', () async {
    await svc.syncAll(<Subscription>[
      _sub('netflix', DateTime(2026, 10, 10)),
    ], copy: _copy());
    expect(seam.foreign, contains(kDailyReminderId));
    expect(seam.calls, isNot(contains('cancelAll')));
    expect(
      seam.pending.keys.every(RenewalReminders.isRenewalReminderId),
      isTrue,
    );
  });

  test(
    '🔴 a subscription removed while the app was closed is still cancelled',
    () async {
      await svc.syncAll(<Subscription>[
        _sub('netflix', DateTime(2026, 10, 10)),
        _sub('spotify', DateTime(2026, 10, 11)),
      ], copy: _copy());
      // A NEW service instance — a later launch — that never scheduled spotify.
      final RenewalReminders next = RenewalReminders.forTesting(
        platform: TargetPlatform.iOS,
        isWeb: false,
        service: seam,
        now: () => now,
      );
      await next.syncAll(<Subscription>[
        _sub('netflix', DateTime(2026, 10, 10)),
      ], copy: _copy());
      expect(
        seam.pending.values
            .map((core.ScheduledNotification n) => n.payload)
            .toSet(),
        <String>{'sub:netflix'},
      );
    },
  );

  test(
    'an id a pre-ST-R3 build scheduled (one per row) is cancelled too',
    () async {
      final int legacy = RenewalReminders.renewalIdFor('netflix');
      seam.foreign.add(legacy);
      await svc.syncAll(<Subscription>[
        _sub('netflix', DateTime(2026, 10, 10)),
      ], copy: _copy());
      expect(seam.allIds, isNot(contains(legacy)));
    },
  );

  test('the digest is not a renewal: syncAll leaves it, cancelWeeklyDigest '
      'takes it', () async {
    await svc.scheduleWeeklyDigest(
      copy: _copy(),
      count: 1,
      formattedTotal: r'$10',
    );
    expect(seam.pending.keys, contains(RenewalReminders.digestId));
    await svc.syncAll(const <Subscription>[], copy: _copy());
    expect(seam.pending.keys, contains(RenewalReminders.digestId));
    await svc.cancelWeeklyDigest();
    expect(seam.pending.keys, isNot(contains(RenewalReminders.digestId)));
    expect(seam.foreign, contains(kDailyReminderId));
  });

  test('the renewal namespace excludes every other id on the plugin', () {
    expect(RenewalReminders.isRenewalReminderId(kDailyReminderId), isFalse);
    expect(RenewalReminders.isRenewalReminderId(0x7f000000), isFalse);
    expect(
      RenewalReminders.isRenewalReminderId(RenewalReminders.digestId),
      isFalse,
    );
    for (final String k in <String>['a', 'netflix|2', 'x|today', 'y|cancel']) {
      expect(
        RenewalReminders.isRenewalReminderId(RenewalReminders.renewalIdFor(k)),
        isTrue,
      );
    }
  });

  test('renewal ids are STABLE — a value, not String.hashCode', () {
    expect(
      RenewalReminders.renewalIdFor('netflix'),
      RenewalReminders.renewalIdFor('netflix'),
    );
    expect(
      RenewalReminders.renewalIdFor('a'),
      isNot(RenewalReminders.renewalIdFor('b')),
    );
    // Pinned: an id that moved with an SDK bump orphans every alarm the
    // previous build scheduled.
    expect(
      RenewalReminders.renewalIdFor(''),
      0x10000000 + (0x811c9dc5 % 0x40000000),
    );
  });

  test(
    'cancelOwnedRenewals leaves the digest and the daily reminder',
    () async {
      await svc.syncAll(<Subscription>[
        _sub('netflix', DateTime(2026, 10, 10)),
      ], copy: _copy());
      await svc.scheduleWeeklyDigest(
        copy: _copy(),
        count: 1,
        formattedTotal: r'$10',
      );
      await svc.cancelOwnedRenewals();
      expect(seam.pending.keys, <int>[RenewalReminders.digestId]);
      expect(seam.foreign, contains(kDailyReminderId));
    },
  );
}
