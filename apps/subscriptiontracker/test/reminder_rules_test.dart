// ST-R3 (audit C23, C26), ST-R7 (C24) and ST-R8 (F30): WHEN a reminder fires.
//
// Before: one reminder per row, two days before, at 09:00, and none at all for
// a row whose lead had already passed ("added the day before it renews" was
// reminded of nothing). Now: the row's own `reminder_days` (else the Settings
// default) at the Settings time of day, a same-day fallback when every lead
// has passed, a "Cancel by" reminder for a notice period, and a digest that is
// a one-off counting what renews in the week it opens.
import 'package:flutter/foundation.dart' show TargetPlatform;
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:subscriptiontracker/data/models/subscription.dart';
import 'package:subscriptiontracker/services/notifications/notification_service.dart';

import 'support/recording_seam.dart';

ReminderCopy _copy() => ReminderCopy(
  channelName: 'Renewal reminders',
  reminderTitle: 'Renewal coming up',
  reminderBody: (String n, DateTime d) => '$n renews ${d.month}/${d.day}',
  digestTitle: 'Weekly',
  digestBody: (int c, String t) => '$c renewals this week, $t',
  cancelByTitle: (DateTime d) => 'Cancel by ${d.month}/${d.day}',
  cancelByBody: (String n, DateTime d) => '$n: cancel by ${d.month}/${d.day}',
);

Subscription _sub(
  String id,
  DateTime renewal, {
  List<int>? days,
  int? notice,
}) => Subscription(
  id: id,
  name: id,
  category: 'Other',
  price: const Money(1000, 'USD'),
  cycle: BillingCycle.monthly,
  nextRenewal: renewal,
  reminderDays: days,
  noticeDays: notice,
);

RenewalReminders _svc(DateTime now, [core.NotificationService? seam]) =>
    RenewalReminders.forTesting(
      platform: TargetPlatform.android,
      isWeb: false,
      service: seam ?? RecordingSeam(),
      now: () => now,
    );

const ReminderRules _at0930 = ReminderRules(hour: 9, minute: 30);

void main() {
  // Thursday 1 October 2026, 08:00.
  final DateTime now = DateTime(2026, 10, 1, 8);

  group('ST-R3 the rules', () {
    test(
      '🔴 [7, 1] at 09:30 arms TWO ids for one cycle, nearest first',
      () async {
        final RecordingSeam seam = RecordingSeam();
        await _svc(now, seam).syncAll(
          <Subscription>[
            _sub('netflix', DateTime(2026, 10, 10), days: <int>[7, 1]),
          ],
          copy: _copy(),
          rules: _at0930,
        );
        final List<core.ScheduledNotification> armed =
            seam.pending.values.toList()..sort(
              (core.ScheduledNotification a, core.ScheduledNotification b) =>
                  a.at.compareTo(b.at),
            );
        expect(armed.map((core.ScheduledNotification n) => n.at), <DateTime>[
          DateTime(2026, 10, 3, 9, 30),
          DateTime(2026, 10, 9, 9, 30),
        ]);
        expect(
          armed.map((core.ScheduledNotification n) => n.id).toSet().length,
          2,
        );
        expect(
          armed.every(
            (core.ScheduledNotification n) => n.payload == 'sub:netflix',
          ),
          isTrue,
        );
        expect(
          armed.length,
          lessThanOrEqualTo(RenewalReminders.renewalReminderBudget),
        );
      },
    );

    test('a row with no reminder_days takes the Settings default', () {
      final List<core.ScheduledNotification> p = _svc(now).plannedFor(
        _sub('netflix', DateTime(2026, 10, 10)),
        copy: _copy(),
        rules: const ReminderRules(leadDays: <int>[3], hour: 20, minute: 15),
      );
      expect(p.single.at, DateTime(2026, 10, 7, 20, 15));
    });

    test(
      '🔴 a row renewing TOMORROW with lead 2 gets the same-day fallback',
      () {
        final List<core.ScheduledNotification> p = _svc(now).plannedFor(
          _sub('netflix', DateTime(2026, 10, 2)),
          copy: _copy(),
          rules: const ReminderRules(leadDays: <int>[2], hour: 9, minute: 30),
        );
        expect(p, hasLength(1));
        expect(p.single.at, DateTime(2026, 10, 1, 9, 30));
        expect(p.single.payload, 'sub:netflix');
      },
    );

    test('past today\'s time, the fallback is the renewal day itself', () {
      final List<core.ScheduledNotification> p = _svc(DateTime(2026, 10, 1, 10))
          .plannedFor(
            _sub('netflix', DateTime(2026, 10, 2)),
            copy: _copy(),
            rules: _at0930,
          );
      expect(p.single.at, DateTime(2026, 10, 2, 9, 30));
    });

    test('no fallback when a nearer lead is still ahead', () {
      final List<core.ScheduledNotification> p = _svc(now).plannedFor(
        _sub('netflix', DateTime(2026, 10, 4), days: <int>[7, 1]),
        copy: _copy(),
        rules: _at0930,
      );
      expect(p.map((core.ScheduledNotification n) => n.at), <DateTime>[
        DateTime(2026, 10, 3, 9, 30),
      ]);
    });

    test('a charge already past gets nothing', () {
      expect(
        _svc(now).plannedFor(
          _sub('netflix', DateTime(2026, 9, 30)),
          copy: _copy(),
          rules: _at0930,
        ),
        isEmpty,
      );
    });
  });

  group('ST-R8 the notice period', () {
    test(
      '🔴 "Cancel by" arms at next renewal − notice days, at the time of day',
      () {
        final List<core.ScheduledNotification> p = _svc(now).plannedFor(
          _sub('gym', DateTime(2026, 10, 20), notice: 7),
          copy: _copy(),
          rules: _at0930,
        );
        final core.ScheduledNotification cancel = p.singleWhere(
          (core.ScheduledNotification n) => n.title.startsWith('Cancel by'),
        );
        expect(cancel.at, DateTime(2026, 10, 13, 9, 30));
        expect(cancel.title, 'Cancel by 10/13');
        expect(cancel.payload, 'sub:gym');
      },
    );

    test('no notice period, no Cancel-by reminder', () {
      final List<core.ScheduledNotification> p = _svc(now).plannedFor(
        _sub('gym', DateTime(2026, 10, 20)),
        copy: _copy(),
        rules: _at0930,
      );
      expect(
        p.where((core.ScheduledNotification n) => n.title.startsWith('Cancel')),
        isEmpty,
      );
    });

    test('a cancel-by day already past is not armed', () {
      final List<core.ScheduledNotification> p = _svc(now).plannedFor(
        _sub('gym', DateTime(2026, 10, 5), notice: 7),
        copy: _copy(),
        rules: _at0930,
      );
      expect(
        p.where((core.ScheduledNotification n) => n.title.startsWith('Cancel')),
        isEmpty,
      );
    });
  });

  group('ST-R7 the weekly digest', () {
    test(
      '🔴 is ONE one-off at the next Sunday 18:00, replaced on re-arm',
      () async {
        final RecordingSeam seam = RecordingSeam();
        final RenewalReminders svc = _svc(now, seam);
        await svc.scheduleWeeklyDigest(
          copy: _copy(),
          count: 2,
          formattedTotal: r'$20.00',
        );
        await svc.scheduleWeeklyDigest(
          copy: _copy(),
          count: 3,
          formattedTotal: r'$30.00',
        );
        final core.ScheduledNotification d =
            seam.pending[RenewalReminders.digestId]!;
        expect(seam.pending.length, 1);
        expect(d.at, DateTime(2026, 10, 4, 18));
        expect(d.body, r'3 renewals this week, $30.00');
        // A one-off by construction: nothing went through scheduleDaily.
        expect(seam.foreign, isEmpty);
      },
    );

    test('digestDay is strictly after now, and a Sunday', () {
      expect(
        RenewalReminders.digestDay(DateTime(2026, 10, 4, 17)),
        DateTime(2026, 10, 4, 18),
      );
      expect(
        RenewalReminders.digestDay(DateTime(2026, 10, 4, 18)),
        DateTime(2026, 10, 11, 18),
      );
    });
  });
}
