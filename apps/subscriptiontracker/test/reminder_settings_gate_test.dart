// 🔴 THE PROOF THAT SETTINGS NEVER OFFERS A REMINDER THE PLATFORM CANNOT
// DELIVER.
//
// "Renewal alerts" and "Weekly digest" schedule through the app's own
// `NotificationService`. On Windows (flutter_local_notifications 17.x has no
// Windows implementation), on Linux (shows, cannot schedule) and on web
// (no plugin) nothing would ever fire — and until this change both rows were
// live switches on every target, so a user could turn on a reminder that no
// code path could deliver. Parity is the feature on all seven targets or an
// honest per-target sentence; the row keeps its name so the user can see WHAT
// is unavailable.
//
// NON-VACUOUS IN BOTH DIRECTIONS: the surface is tall enough that the lazy
// ListView builds every row, and the positive branch is identified by the
// row DESCRIPTION, which only the live switch renders — so "findsNothing" on
// a scheduling platform cannot pass merely because the row was never built.
//
// MUTATION PROOF (run and recorded in the PR): make `remindersDeliverable`
// in settings_screen.dart the constant `true` and the Windows, Linux and web
// cases go red.
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/misc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:subscriptiontracker/data/models/subscription.dart';
import 'package:subscriptiontracker/features/settings/settings_screen.dart';
import 'package:subscriptiontracker/l10n/app_localizations.dart';
import 'package:subscriptiontracker/services/notifications/notification_service.dart';
import 'package:subscriptiontracker/state/providers.dart';

import 'support/width_harness.dart';

/// A silent service whose capability matrix is pinned to one target.
class _PinnedNotifications extends NotificationService {
  _PinnedNotifications(TargetPlatform platform, {bool isWeb = false})
    : super.forTesting(platform: platform, isWeb: isWeb);

  @override
  Future<void> syncAll(
    List<Subscription> subs, {
    required ReminderCopy copy,
    int daysBefore = 2,
  }) async {}
  @override
  Future<void> cancelOwnedRenewals() async {}
  @override
  Future<void> cancelAll() async {}
  @override
  Future<void> scheduleWeeklyDigest({
    required ReminderCopy copy,
    required int count,
    required String formattedTotal,
  }) async {}
  @override
  Future<void> cancelWeeklyDigest() async {}
}

/// Tall enough that every settings row is built, not merely laid out.
const Size _tall = Size(800, 9000);

Future<void> _pump(WidgetTester tester, NotificationService svc) => pumpAt(
  tester,
  _tall,
  const SettingsScreen(),
  overrides: <Override>[
    subscriptiontrackerNotificationServiceProvider.overrideWithValue(svc),
  ],
);

void main() {
  final AppLocalizations en = lookupAppLocalizations(const Locale('en'));

  final Map<String, NotificationService Function()> cannotSchedule =
      <String, NotificationService Function()>{
        'Windows': () => _PinnedNotifications(TargetPlatform.windows),
        'Linux': () => _PinnedNotifications(TargetPlatform.linux),
        'web': () => _PinnedNotifications(TargetPlatform.android, isWeb: true),
      };

  cannotSchedule.forEach((String name, NotificationService Function() make) {
    testWidgets('🔴 $name: both reminder rows are a sentence, not a switch', (
      WidgetTester tester,
    ) async {
      await _pump(tester, make());
      expect(
        find.byKey(const Key('settings.pref.alerts.unavailable')),
        findsOneWidget,
      );
      expect(
        find.byKey(const Key('settings.pref.weekly.unavailable')),
        findsOneWidget,
      );
      // The descriptions exist ONLY on the live switch rows.
      expect(find.text(en.prefRenewalAlertsDesc), findsNothing);
      expect(find.text(en.prefWeeklyDigestDesc), findsNothing);
      // The in-app flag is not a notification and stays a switch everywhere.
      expect(
        find.byKey(const Key('settings.pref.unused.unavailable')),
        findsNothing,
      );
      expect(find.text(en.prefUnusedPlansDesc), findsOneWidget);
    });
  });

  final Map<String, TargetPlatform> canSchedule = <String, TargetPlatform>{
    'Android': TargetPlatform.android,
    'iOS': TargetPlatform.iOS,
    'macOS': TargetPlatform.macOS,
  };

  canSchedule.forEach((String name, TargetPlatform p) {
    testWidgets('$name: both reminder rows are live switches', (
      WidgetTester tester,
    ) async {
      await _pump(tester, _PinnedNotifications(p));
      expect(find.text(en.prefRenewalAlertsDesc), findsOneWidget);
      expect(find.text(en.prefWeeklyDigestDesc), findsOneWidget);
      expect(
        find.byKey(const Key('settings.pref.alerts.unavailable')),
        findsNothing,
      );
      expect(
        find.byKey(const Key('settings.pref.weekly.unavailable')),
        findsNothing,
      );
    });
  });
}
