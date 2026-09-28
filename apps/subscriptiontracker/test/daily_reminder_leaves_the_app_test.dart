// ─────────────────────────────────────────────────────────────────────────────
// ST-U1 (audit C20, C22/D4) — ONE reminders control, and an honest sentence
// where no reminder can be delivered.
//
// The chassis "Reminders" switch scheduled a DAILY 20:00 "Time for today / A
// minute now keeps your streak going" — habit-app boilerplate beside this app's
// own renewal alerts. It left this app: Settings no longer offers it, and launch
// re-asserts it off. On a target that cannot schedule (web — the live one —
// Windows, Linux) the Notifications list says it is the only reminder there is.
//
// MUTATION PROOF: restore the NOTIFICATIONS section in settings_screen.dart and
// the first case goes red; drop the `canSchedule` line from
// notifications_screen.dart and the second does.
// ─────────────────────────────────────────────────────────────────────────────
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/misc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:subscriptiontracker/features/notifications/notifications_screen.dart';
import 'package:subscriptiontracker/features/settings/settings_screen.dart';
import 'package:subscriptiontracker/services/notifications/notification_service.dart';
import 'package:subscriptiontracker/state/providers.dart';

import 'support/width_harness.dart';

void main() {
  testWidgets('Settings offers no daily "Reminders" switch', (
    WidgetTester tester,
  ) async {
    await pumpAt(tester, const Size(800, 4000), const SettingsScreen());
    expect(find.text('Reminders'), findsNothing);
    expect(find.text('NOTIFICATIONS'), findsNothing);
  });

  testWidgets('where nothing can be scheduled, the list says so', (
    WidgetTester tester,
  ) async {
    await pumpAt(
      tester,
      kPhone,
      const NotificationsScreen(),
      overrides: <Override>[
        subscriptiontrackerNotificationServiceProvider.overrideWithValue(
          NotificationService.forTesting(isWeb: true),
        ),
      ],
    );
    expect(
      find.byKey(const Key('notificationsNoRemindersHere')),
      findsOneWidget,
    );
  });

  testWidgets('and where reminders CAN be scheduled, it says nothing', (
    WidgetTester tester,
  ) async {
    await pumpAt(
      tester,
      kPhone,
      const NotificationsScreen(),
      overrides: <Override>[
        subscriptiontrackerNotificationServiceProvider.overrideWithValue(
          NotificationService.forTesting(
            platform: TargetPlatform.android,
            isWeb: false,
          ),
        ),
      ],
    );
    expect(find.byKey(const Key('notificationsNoRemindersHere')), findsNothing);
  });
}
