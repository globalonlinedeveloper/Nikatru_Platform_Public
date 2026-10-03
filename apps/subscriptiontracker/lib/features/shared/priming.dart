import 'package:flutter/foundation.dart'
    show TargetPlatform, defaultTargetPlatform, kIsWeb;
import 'package:flutter/material.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart'
    show showPermissionPriming;
import 'package:nikatru_notifications/nikatru_notifications.dart'
    show NotificationCapabilities;

import '../../core/windows_notification_identity.g.dart';
import '../../l10n/chassis_bridge.g.dart';

/// Subly's words for the design system's permission PRIMING (train ST-D8).
///
/// 🔴 THE OS PROMPT CAN BE SHOWN ONCE ON MOST PLATFORMS, and Subly reached it
/// from two places — the reminder switches in Settings and the first
/// subscription added — both of which spent it with nothing on screen saying
/// why. Both now come through here, so the explanation is written once: the
/// first add directly, and Settings through ST-T4b's `toggleReminderPref` →
/// `primeReminderPermission` (settings/reminder_settings.dart), which keeps its
/// own [key]. [reason], when given, names what the user is turning on.
/// Answers whether the user chose to proceed; "Not now" and every dismissal
/// answer false and spend nothing.
///
/// 🔴 NO OS PROMPT, NO PRIMING. Where the platform cannot schedule a reminder
/// (web, Linux, and Windows without its notification identity:
/// [NotificationCapabilities.canSchedule] is false, the same reading the
/// onboarding slide makes) there is no prompt to explain, so
/// this answers yes without drawing anything. Priming there would explain an
/// ask that never comes — and on the first add it would hold the add sheet
/// open behind a question, which is what the live web e2e would have met.
///
/// ⏱ 2026-10-01 · NO-04: Linux SCHEDULES now (packages/notifications'
/// ledger) but still has no permission prompt — a desktop notification
/// server asks nobody — so it stays on the no-priming side by name.
Future<bool> primeReminders(BuildContext context, {String? reason, Key? key}) {
  final bool linux = !kIsWeb && defaultTargetPlatform == TargetPlatform.linux;
  if (linux ||
      !NotificationCapabilities.resolve(
        defaultTargetPlatform,
        isWeb: kIsWeb,
        windows: kWindowsNotificationIdentity,
      ).canSchedule) {
    return Future<bool>.value(true);
  }
  final AppLocalizations l10n = AppLocalizations.of(context);
  return showPermissionPriming(
    context,
    title: l10n.permissionPrimingTitle,
    body: l10n.permissionPrimingBody,
    reasons: <String>[if (reason != null) reason],
    key: key,
    allowLabel: l10n.continueLabel,
    notNowLabel: l10n.notNow,
  );
}
