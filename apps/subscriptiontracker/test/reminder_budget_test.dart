// 🔴 APPLE KEEPS 64 PENDING NOTIFICATIONS PER APP AND DROPS THE REST SILENTLY.
//
// `UNUserNotificationCenter` discards every pending request after the 64
// soonest, with no error and no callback (macOS too). An account with more
// reminders than that got an arbitrary subset. [RenewalReminders.plannedReminders]
// chooses instead: the soonest [RenewalReminders.renewalReminderBudget], leaving
// room for the digest, and says how many it left out.
//
// ⏱ 2026-09-28 (ST-R3): the budget counts REMINDERS, not subscriptions — a
// row with `reminder_days: [7, 1]` takes two slots — and it is proven at the
// core seam (support/recording_seam.dart), which is where this app now stops.
import 'package:flutter/foundation.dart' show TargetPlatform;
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:subscriptiontracker/data/models/subscription.dart';
import 'package:subscriptiontracker/services/notifications/notification_service.dart';

import 'support/recording_seam.dart';

final DateTime _now = DateTime(2026, 10, 1, 8);

ReminderCopy _copy() => ReminderCopy(
  channelName: 'Renewal reminders',
  channelDescription: 'Alerts before a charge',
  reminderTitle: 'Renewal coming up',
  reminderBody: (String n, DateTime d) => '$n renews ${d.day}/${d.month}',
  digestTitle: 'Weekly',
  digestBody: (int c, String t) => '$c, $t',
  cancelByTitle: (DateTime d) => 'Cancel by ${d.day}/${d.month}',
  cancelByBody: (String n, DateTime d) => '$n by ${d.day}/${d.month}',
);

/// [n] rows renewing on consecutive days from 3 days out, so every lead
/// instant is in the future and the order is the index order.
List<Subscription> _subs(int n, {List<int>? days}) => <Subscription>[
  for (int i = 0; i < n; i++)
    Subscription(
      id: 's$i',
      name: 'Plan $i',
      category: 'Other',
      price: const Money(1000, 'USD'),
      cycle: BillingCycle.monthly,
      nextRenewal: DateTime(2026, 10, 4 + i),
      reminderDays: days,
    ),
];

({RecordingSeam seam, RenewalReminders svc}) _build(TargetPlatform p) {
  final RecordingSeam seam = RecordingSeam();
  return (
    seam: seam,
    svc: RenewalReminders.forTesting(
      platform: p,
      isWeb: false,
      service: seam,
      now: () => _now,
    ),
  );
}

void main() {
  group('what reaches the OS', () {
    test('80 subscriptions must not hand iOS more than it will keep', () async {
      final ({RecordingSeam seam, RenewalReminders svc}) w = _build(
        TargetPlatform.iOS,
      );
      await w.svc.syncAll(_subs(80), copy: _copy());
      expect(w.seam.pending.length, RenewalReminders.renewalReminderBudget);
    });

    test(
      'the budget keeps the SOONEST — the ones a user can still act on',
      () async {
        final ({RecordingSeam seam, RenewalReminders svc}) w = _build(
          TargetPlatform.iOS,
        );
        await w.svc.syncAll(_subs(80), copy: _copy());
        final List<DateTime> kept =
            w.seam.pending.values
                .map((core.ScheduledNotification n) => n.at)
                .toList()
              ..sort();
        // ⏱ 2026-10-01 · NO-11: three charges per plan are wanted now, so
        // "the soonest" is read off the whole plan rather than counted by
        // hand: the kept set is exactly its first [renewalReminderBudget].
        final List<DateTime> wanted = <DateTime>[
          for (final Subscription s in _subs(80))
            for (final core.ScheduledNotification n in w.svc.plannedFor(
              s,
              copy: _copy(),
              rules: const ReminderRules(),
            ))
              n.at,
        ]..sort();
        expect(kept, wanted.take(RenewalReminders.renewalReminderBudget));
        expect(kept.last.isBefore(wanted.last), isTrue);
      },
    );

    test('a set inside the budget is scheduled in full, untouched', () async {
      final ({RecordingSeam seam, RenewalReminders svc}) w = _build(
        TargetPlatform.iOS,
      );
      await w.svc.syncAll(_subs(10), copy: _copy());
      // NO-11: 10 plans × 3 charges = 30, inside 60.
      expect(w.seam.pending.length, 10 * RenewalReminders.cyclesPerPlan);
      expect(w.svc.remindersDroppedByBudget, 0);
    });

    test('the overflow is countable, not silent', () async {
      final ({RecordingSeam seam, RenewalReminders svc}) w = _build(
        TargetPlatform.iOS,
      );
      await w.svc.syncAll(_subs(80), copy: _copy());
      expect(
        w.svc.remindersDroppedByBudget,
        80 * RenewalReminders.cyclesPerPlan -
            RenewalReminders.renewalReminderBudget,
      );
    });

    test(
      'ST-R3: two lead days take two slots each, inside the budget',
      () async {
        final ({RecordingSeam seam, RenewalReminders svc}) w = _build(
          TargetPlatform.iOS,
        );
        await w.svc.syncAll(_subs(40, days: <int>[7, 1]), copy: _copy());
        // 40 rows × 2 leads = 80 wanted; but a row 3..9 days out has already
        // passed its 7-day lead, so count what is actually schedulable.
        final int wanted = <core.ScheduledNotification>[
          for (final Subscription s in _subs(40, days: <int>[7, 1]))
            ...w.svc.plannedFor(s, copy: _copy(), rules: const ReminderRules()),
        ].length;
        expect(wanted, greaterThan(RenewalReminders.renewalReminderBudget));
        expect(w.seam.pending.length, RenewalReminders.renewalReminderBudget);
        expect(
          w.svc.remindersDroppedByBudget,
          wanted - RenewalReminders.renewalReminderBudget,
        );
      },
    );
  });

  group('the budget itself', () {
    test('leaves headroom below the platform limit for the digest', () {
      expect(RenewalReminders.renewalReminderBudget, lessThan(64));
      expect(RenewalReminders.renewalReminderBudget, greaterThan(0));
    });

    test('applies to the Darwin platforms and to nothing else', () {
      for (final TargetPlatform p in TargetPlatform.values) {
        expect(
          RenewalReminders.platformCapsPendingNotifications(p),
          p == TargetPlatform.iOS || p == TargetPlatform.macOS,
          reason: '$p',
        );
      }
    });
  });

  group('the plan, per platform', () {
    test('Android keeps every one of the 80', () async {
      final ({RecordingSeam seam, RenewalReminders svc}) w = _build(
        TargetPlatform.android,
      );
      await w.svc.syncAll(_subs(80), copy: _copy());
      // NO-11: three charges each — AlarmManager has no pool to overflow.
      expect(w.seam.pending.length, 80 * RenewalReminders.cyclesPerPlan);
      expect(w.svc.remindersDroppedByBudget, 0);
    });

    test('iOS narrows 80 to the budget and macOS agrees', () async {
      for (final TargetPlatform p in <TargetPlatform>[
        TargetPlatform.iOS,
        TargetPlatform.macOS,
      ]) {
        final ({RecordingSeam seam, RenewalReminders svc}) w = _build(p);
        await w.svc.syncAll(_subs(80), copy: _copy());
        expect(
          w.seam.pending.length,
          RenewalReminders.renewalReminderBudget,
          reason: '$p',
        );
      }
    });
  });
}
