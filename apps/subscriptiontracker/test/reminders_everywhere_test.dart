// Train T5 · reminders on every target, actions on every reminder.
//
// The red controls of the domain half, at the core seam (RecordingSeam):
//  · NO-11 — several cycles armed: 10 plans on Android arm 30; 80 on iOS
//    never exceed the budget.
//  · NO-13 — quiet hours defer a 23:00 reminder to 07:00; a test reminder is
//    a local notification 10 s out where the target schedules, and the
//    e-mail route where it does not.
//  · NO-10 — the renewal reminder carries "Mark as paid" / "Snooze 1 day";
//    the handler's "paid" posts ONE payment and dismisses, "snooze" re-arms
//    at +24 h; a body tap still opens /sub/<id>.
import 'package:flutter/foundation.dart' show TargetPlatform;
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_notifications/nikatru_notifications.dart'
    show QuietHours;
import 'package:subscriptiontracker/data/api/seed_api_client.dart';
import 'package:subscriptiontracker/data/models/payment_record.dart';
import 'package:subscriptiontracker/data/models/subscription.dart';
import 'package:subscriptiontracker/services/notifications/notification_service.dart';
import 'package:subscriptiontracker/state/notification_tap_observer.dart';

import 'support/recording_seam.dart';

final DateTime _now = DateTime(2026, 10, 1, 8);

ReminderCopy _copy({bool actions = true}) => ReminderCopy(
  channelName: 'Renewal reminders',
  channelDescription: 'Alerts before a charge',
  reminderTitle: 'Renewal coming up',
  reminderBody: (String n, DateTime d) => '$n renews ${d.day}/${d.month}',
  digestTitle: 'Weekly',
  digestBody: (int c, String t) => '$c, $t',
  cancelByTitle: (DateTime d) => 'Cancel by ${d.day}/${d.month}',
  cancelByBody: (String n, DateTime d) => '$n by ${d.day}/${d.month}',
  markPaidAction: actions ? 'Mark as paid' : null,
  snoozeAction: actions ? 'Snooze 1 day' : null,
  testTitle: 'Test reminder',
  testBody: 'Reminders work on this device.',
);

List<Subscription> _subs(int n, {Cadence? cycle = BillingCycle.monthly}) =>
    <Subscription>[
      for (int i = 0; i < n; i++)
        Subscription(
          id: 's$i',
          name: 'Plan $i',
          category: 'Other',
          price: const Money(1000, 'USD'),
          cycle: cycle,
          nextRenewal: DateTime(2026, 10, 4 + i),
        ),
    ];

({RecordingSeam seam, RenewalReminders svc}) _build(
  TargetPlatform p, {
  bool isWeb = false,
  DateTime Function()? now,
}) {
  final RecordingSeam seam = RecordingSeam();
  return (
    seam: seam,
    svc: RenewalReminders.forTesting(
      platform: p,
      isWeb: isWeb,
      service: seam,
      now: now ?? () => _now,
    ),
  );
}

void main() {
  group('NO-11 · several cycles armed', () {
    test('RED CONTROL: 10 plans on Android arm 30 (3 charges each)', () async {
      final ({RecordingSeam seam, RenewalReminders svc}) w = _build(
        TargetPlatform.android,
      );
      await w.svc.syncAll(_subs(10), copy: _copy());
      expect(w.seam.pending, hasLength(30));
      expect(w.svc.remindersDroppedByBudget, 0);
      // The three for one plan are a cadence apart, nearest first.
      final List<DateTime> s0 =
          w.seam.pending.values
              .where((core.ScheduledNotification n) => n.payload == 'sub:s0')
              .map((core.ScheduledNotification n) => n.at)
              .toList()
            ..sort();
      expect(s0, <DateTime>[
        DateTime(2026, 10, 2, 9),
        DateTime(2026, 11, 2, 9),
        DateTime(2026, 12, 2, 9),
      ]);
    });

    test(
      'RED CONTROL: 80 plans on iOS never exceed 60; overflow counted',
      () async {
        final ({RecordingSeam seam, RenewalReminders svc}) w = _build(
          TargetPlatform.iOS,
        );
        await w.svc.syncAll(_subs(80), copy: _copy());
        expect(w.seam.pending.length, lessThanOrEqualTo(60));
        expect(w.seam.pending.length, RenewalReminders.renewalReminderBudget);
        expect(w.svc.remindersDroppedByBudget, 80 * 3 - 60);
      },
    );

    test(
      'a later cycle keeps the plan\'s anchor day (31st → 30 Nov → 31 Dec)',
      () async {
        final ({RecordingSeam seam, RenewalReminders svc}) w = _build(
          TargetPlatform.android,
        );
        final List<core.ScheduledNotification> p = w.svc.plannedFor(
          Subscription(
            id: 'm',
            name: 'M',
            category: 'Other',
            price: const Money(100, 'USD'),
            cycle: BillingCycle.monthly,
            nextRenewal: DateTime(2026, 10, 31),
          ),
          copy: _copy(),
          rules: const ReminderRules(leadDays: <int>[0]),
        );
        expect(p.map((core.ScheduledNotification n) => n.at), <DateTime>[
          DateTime(2026, 10, 31, 9),
          DateTime(2026, 11, 30, 9),
          DateTime(2026, 12, 31, 9),
        ]);
      },
    );

    test('🔴 a row renewing TOMORROW still gets its same-day fallback, and '
        'its next charges', () {
      final ({RecordingSeam seam, RenewalReminders svc}) w = _build(
        TargetPlatform.android,
      );
      final List<core.ScheduledNotification> p = w.svc.plannedFor(
        Subscription(
          id: 't',
          name: 'T',
          category: 'Other',
          price: const Money(100, 'USD'),
          cycle: BillingCycle.monthly,
          nextRenewal: DateTime(2026, 10, 2),
        ),
        copy: _copy(),
        rules: const ReminderRules(),
      );
      // 08:00 now, 09:00 today is ahead: the fallback, then 2 Oct+1 and +2
      // months at their two-day lead.
      expect(p.map((core.ScheduledNotification n) => n.at), <DateTime>[
        DateTime(2026, 10, 1, 9),
        DateTime(2026, 10, 31, 9),
        DateTime(2026, 11, 30, 9),
      ]);
    });

    test('a row with no cadence arms its one charge', () async {
      final ({RecordingSeam seam, RenewalReminders svc}) w = _build(
        TargetPlatform.android,
      );
      await w.svc.syncAll(_subs(2, cycle: null), copy: _copy());
      expect(w.seam.pending, hasLength(2));
    });

    test('deleting a row cancels every cycle it held', () async {
      final ({RecordingSeam seam, RenewalReminders svc}) w = _build(
        TargetPlatform.android,
      );
      await w.svc.syncAll(_subs(1), copy: _copy());
      expect(w.seam.pending, hasLength(3));
      await w.svc.cancelForSubscription('s0');
      expect(w.seam.pending, isEmpty);
    });
  });

  group('NO-13 · quiet hours and the test reminder', () {
    test('RED CONTROL: a 23:00 reminder inside 22:00-07:00 fires at 07:00', () {
      final ({RecordingSeam seam, RenewalReminders svc}) w = _build(
        TargetPlatform.android,
      );
      final List<core.ScheduledNotification> p = w.svc.plannedFor(
        _subs(1).single,
        copy: _copy(),
        rules: const ReminderRules(
          hour: 23,
          quiet: QuietHours(startMinute: 22 * 60, endMinute: 7 * 60),
        ),
      );
      // Lead 2 before 4 Oct = 2 Oct 23:00 → 3 Oct 07:00.
      expect(p.first.at, DateTime(2026, 10, 3, 7));
      expect(p.every((core.ScheduledNotification n) => n.at.hour == 7), isTrue);
    });

    test('without quiet hours the 23:00 reminder is left alone', () {
      final ({RecordingSeam seam, RenewalReminders svc}) w = _build(
        TargetPlatform.android,
      );
      final List<core.ScheduledNotification> p = w.svc.plannedFor(
        _subs(1).single,
        copy: _copy(),
        rules: const ReminderRules(hour: 23),
      );
      expect(p.first.at, DateTime(2026, 10, 2, 23));
    });

    test('RED CONTROL: a test reminder arrives (local, 10 s out)', () async {
      final ({RecordingSeam seam, RenewalReminders svc}) w = _build(
        TargetPlatform.android,
      );
      expect(await w.svc.sendTest(copy: _copy()), isTrue);
      final core.ScheduledNotification n =
          w.seam.pending[RenewalReminders.testReminderId]!;
      expect(n.at, _now.add(const Duration(seconds: 10)));
      expect(n.title, 'Test reminder');
      // Outside the renewal namespace: the next sync cannot cancel it.
      expect(RenewalReminders.isRenewalReminderId(n.id), isFalse);
    });

    test('RED CONTROL: every fixed id is its own, outside both namespaces', () {
      const List<int> fixed = <int>[
        RenewalReminders.digestId,
        RenewalReminders.overBudgetId,
        RenewalReminders.testReminderId,
      ];
      expect(fixed.toSet(), hasLength(fixed.length));
      for (final int id in fixed) {
        expect(RenewalReminders.isRenewalReminderId(id), isFalse);
        expect(
          id >= RenewalReminders.snoozeIdBase &&
              id <
                  RenewalReminders.snoozeIdBase +
                      RenewalReminders.snoozeIdRange,
          isFalse,
        );
      }
    });

    test('web: nothing schedules, so no test is armed', () async {
      final ({RecordingSeam seam, RenewalReminders svc}) w = _build(
        TargetPlatform.android,
        isWeb: true,
      );
      expect(await w.svc.sendTest(copy: _copy()), isFalse);
      expect(w.seam.pending, isEmpty);
    });

    test('Linux schedules now (NO-04): the test reminder is local', () async {
      final ({RecordingSeam seam, RenewalReminders svc}) w = _build(
        TargetPlatform.linux,
      );
      expect(w.svc.unavailability, isNull);
      expect(await w.svc.sendTest(copy: _copy()), isTrue);
    });
  });

  group('NO-10 · actions on the renewal reminder', () {
    test('a renewal reminder carries Mark as paid and Snooze 1 day', () async {
      final ({RecordingSeam seam, RenewalReminders svc}) w = _build(
        TargetPlatform.android,
      );
      await w.svc.syncAll(_subs(1), copy: _copy());
      for (final core.ScheduledNotification n in w.seam.pending.values) {
        expect(n.actions.map((core.NotificationAction a) => a.id), <String>[
          RenewalReminders.markPaidActionId,
          RenewalReminders.snoozeActionId,
        ]);
        expect(n.payload, 'sub:s0');
      }
    });

    test(
      'RED CONTROL: snooze re-arms at +24 h and dismisses the shown one',
      () async {
        final ({RecordingSeam seam, RenewalReminders svc}) w = _build(
          TargetPlatform.android,
        );
        final Subscription s = _subs(1).single;
        w.seam.pending[4242] = core.ScheduledNotification(
          id: 4242,
          title: 't',
          body: 'b',
          at: _now,
        );
        await w.svc.snooze(s, copy: _copy(), dismissId: 4242);
        expect(w.seam.pending.containsKey(4242), isFalse);
        final core.ScheduledNotification again =
            w.seam.pending[RenewalReminders.snoozeIdFor('s0')]!;
        expect(again.at, _now.add(const Duration(hours: 24)));
        expect(again.payload, 'sub:s0');
        // The snooze survives the sync the press triggers (it is not a
        // renewal id), and a delete takes it with the rest.
        expect(RenewalReminders.isRenewalReminderId(again.id), isFalse);
        await w.svc.syncAll(<Subscription>[s], copy: _copy());
        expect(w.seam.pending.containsKey(again.id), isTrue);
        await w.svc.cancelForSubscription('s0');
        expect(w.seam.pending.containsKey(again.id), isFalse);
      },
    );

    test('snooze respects quiet hours', () async {
      final ({RecordingSeam seam, RenewalReminders svc}) w = _build(
        TargetPlatform.android,
        now: () => DateTime(2026, 10, 1, 23, 30),
      );
      await w.svc.snooze(
        _subs(1).single,
        copy: _copy(),
        quiet: const QuietHours(startMinute: 22 * 60, endMinute: 7 * 60),
      );
      expect(
        w.seam.pending[RenewalReminders.snoozeIdFor('s0')]!.at,
        DateTime(2026, 10, 3, 7),
      );
    });
  });

  group('NO-10 · ReminderActionHandler', () {
    late RecordingSeam seam;
    late List<String> paid;
    late List<(String, int)> snoozed;
    late ReminderActionHandler h;

    setUp(() {
      seam = RecordingSeam();
      paid = <String>[];
      snoozed = <(String, int)>[];
      h = ReminderActionHandler(
        service: seam,
        markPaid: (String id) async => paid.add(id),
        snooze: (String id, int n) async => snoozed.add((id, n)),
      );
    });

    test('RED CONTROL: "paid" posts one payment and dismisses', () async {
      seam.pending[77] = core.ScheduledNotification(
        id: 77,
        title: 't',
        body: 'b',
        at: _now,
      );
      await h.handle(
        const core.NotificationTap(
          id: 77,
          payload: 'sub:abc',
          actionId: 'paid',
        ),
      );
      expect(paid, <String>['abc']);
      expect(seam.calls, contains('cancel:77'));
      expect(snoozed, isEmpty);
    });

    test('RED CONTROL: "snooze" hands the id on to re-arm', () async {
      await h.handle(
        const core.NotificationTap(
          id: 78,
          payload: 'sub:abc',
          actionId: 'snooze',
        ),
      );
      expect(snoozed, <(String, int)>[('abc', 78)]);
      expect(paid, isEmpty);
    });

    test('a failed payment leaves the notification up', () async {
      final List<Object> errors = <Object>[];
      final ReminderActionHandler failing = ReminderActionHandler(
        service: seam,
        markPaid: (String id) async => throw StateError('offline'),
        snooze: (String id, int n) async {},
        onError: errors.add,
      );
      await failing.handle(
        const core.NotificationTap(
          id: 79,
          payload: 'sub:abc',
          actionId: 'paid',
        ),
      );
      expect(seam.calls, isNot(contains('cancel:79')));
      expect(errors, hasLength(1));
    });

    test(
      'a body tap, an unknown action or an untrusted payload: nothing',
      () async {
        await h.handle(const core.NotificationTap(id: 1, payload: 'sub:abc'));
        await h.handle(
          const core.NotificationTap(id: 1, payload: 'sub:abc', actionId: 'x'),
        );
        await h.handle(
          const core.NotificationTap(
            id: 1,
            payload: 'sub:../../evil',
            actionId: 'paid',
          ),
        );
        expect(paid, isEmpty);
        expect(snoozed, isEmpty);
      },
    );

    test(
      'the body still opens /sub/<id>; a button press does not route',
      () async {
        final List<String> opened = <String>[];
        final List<core.NotificationTap> launchActions =
            <core.NotificationTap>[];
        final NotificationTapRouter r = NotificationTapRouter(
          service: seam,
          open: opened.add,
          onLaunchAction: launchActions.add,
        );
        await r.start();
        h.start();
        seam.taps.add(const core.NotificationTap(id: 1, payload: 'sub:abc'));
        seam.taps.add(
          const core.NotificationTap(
            id: 2,
            payload: 'sub:abc',
            actionId: 'paid',
          ),
        );
        await Future<void>.delayed(Duration.zero);
        await Future<void>.delayed(Duration.zero);
        expect(opened, <String>['/sub/abc']);
        expect(paid, <String>['abc']);
        await r.stop();
        await h.stop();
      },
    );
  });

  group('the payment write', () {
    test(
      'the same key records one payment (a press delivered twice)',
      () async {
        final SeedApiClient api = SeedApiClient();
        final Subscription s = (await api.getSubscriptions()).first;
        final int before = (await api.getPaymentHistory(s.id)).length;
        for (int i = 0; i < 2; i++) {
          await api.recordPayment(
            s.id,
            amount: s.price,
            paidOn: _now,
            idempotencyKey: 'paid_${s.id}_2026-10-01',
          );
        }
        final List<PaymentRecord> after = await api.getPaymentHistory(s.id);
        expect(after.length, before + 1);
        expect(after.first.date, _now);
      },
    );
  });
}
