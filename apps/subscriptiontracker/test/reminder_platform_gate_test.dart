// The renewal reminders obey the capability matrix on every target — and on
// Windows that matrix now says YES (ST-R4, O-RENEWAL-REMINDERS-OFF-ON-DESKTOP).
//
// flutter_local_notifications 17.2.4 answered `initialize` with `true` on
// Windows and Linux and then THREW out of `zonedSchedule`, so both desktops
// ended every list load in an uncaught error. The service was gated on the
// matrix, and the matrix said no for both. 22.x has a Windows plugin; it needs
// the app's identity (app.yaml → lib/core/windows_notification_identity.g.dart),
// which this app now carries, so Windows schedules. Linux still cannot
// (flutter_local_notifications_linux 8.0.1 has no zonedSchedule), and web has no
// plugin — both stay a no-op, and email and the calendar feed serve them.
import 'package:flutter/foundation.dart' show TargetPlatform;
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_notifications/nikatru_notifications.dart';
import 'package:subscriptiontracker/core/windows_notification_identity.g.dart';
import 'package:subscriptiontracker/data/models/subscription.dart';
import 'package:subscriptiontracker/services/notifications/notification_service.dart';

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

final List<Subscription> _subs = <Subscription>[
  Subscription(
    id: 'netflix',
    name: 'Netflix',
    category: 'Other',
    price: const Money(1000, 'USD'),
    cycle: BillingCycle.monthly,
    nextRenewal: DateTime(2026, 10, 10),
  ),
];

Future<RecordingSeam> _sync(
  RenewalReminders Function(RecordingSeam) make,
) async {
  final RecordingSeam seam = RecordingSeam();
  final RenewalReminders svc = make(seam);
  await svc.syncAll(_subs, copy: _copy());
  await svc.scheduleWeeklyDigest(copy: _copy(), count: 1, formattedTotal: 'x');
  return seam;
}

void main() {
  DateTime now() => DateTime(2026, 10, 1, 8);

  test('this app carries a Windows identity (rendered from app.yaml)', () {
    expect(kWindowsNotificationIdentity, isNotNull);
    final WindowsNotificationIdentity id = kWindowsNotificationIdentity!;
    expect(
      RegExp(
        r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
      ).hasMatch(id.toastActivatorClsid),
      isTrue,
    );
    expect(id.appUserModelId, endsWith('!subscriptiontracker'));
  });

  test(
    '🔴 Windows WITH the identity schedules renewals and the digest',
    () async {
      final RecordingSeam seam = await _sync(
        (RecordingSeam s) => RenewalReminders.forTesting(
          platform: TargetPlatform.windows,
          isWeb: false,
          service: s,
          now: now,
        ),
      );
      expect(seam.pending, isNotEmpty);
    },
  );

  test('Windows WITHOUT an identity schedules nothing', () async {
    final RecordingSeam seam = await _sync(
      (RecordingSeam s) => RenewalReminders(
        service: s,
        capabilities: NotificationCapabilities.resolve(
          TargetPlatform.windows,
          isWeb: false,
        ),
        now: now,
      ),
    );
    expect(seam.pending, isEmpty);
    expect(seam.calls, isNot(contains('reconcile')));
  });

  for (final ({String name, TargetPlatform p, bool web}) c
      in <({String name, TargetPlatform p, bool web})>[
        (
          name: 'Linux (shows, cannot schedule)',
          p: TargetPlatform.linux,
          web: false,
        ),
        (name: 'web', p: TargetPlatform.android, web: true),
      ]) {
    test('${c.name}: nothing reaches the seam, and nothing throws', () async {
      final RecordingSeam seam = await _sync(
        (RecordingSeam s) => RenewalReminders.forTesting(
          platform: c.p,
          isWeb: c.web,
          service: s,
          now: now,
        ),
      );
      expect(seam.pending, isEmpty);
      expect(seam.calls, isNot(contains('reconcile')));
    });
  }

  test('the matrix the service reads is the chassis matrix, resolved', () {
    for (final TargetPlatform p in TargetPlatform.values) {
      final RenewalReminders s = RenewalReminders.forTesting(
        platform: p,
        isWeb: false,
      );
      final NotificationCapabilities want = NotificationCapabilities.resolve(
        p,
        isWeb: false,
        windows: kWindowsNotificationIdentity,
      );
      expect(s.capabilities.canNotify, want.canNotify, reason: '$p');
      expect(s.capabilities.canSchedule, want.canSchedule, reason: '$p');
    }
  });

  test('unavailability names the reason a settings screen shows', () {
    expect(
      RenewalReminders.forTesting(
        platform: TargetPlatform.linux,
        isWeb: false,
      ).unavailability,
      ReminderUnavailability.noScheduling,
    );
    expect(
      RenewalReminders.forTesting(
        platform: TargetPlatform.android,
        isWeb: true,
      ).unavailability,
      ReminderUnavailability.noNotifications,
    );
    expect(
      RenewalReminders.forTesting(
        platform: TargetPlatform.windows,
        isWeb: false,
      ).unavailability,
      isNull,
    );
  });
}
