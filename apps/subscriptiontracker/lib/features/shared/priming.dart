import 'package:flutter/foundation.dart' show defaultTargetPlatform, kIsWeb;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart'
    show showPermissionPriming;
import 'package:nikatru_notifications/nikatru_notifications.dart'
    show NotificationCapabilities;

import '../../l10n/app_localizations.dart';
import '../../state/settings_controller.dart';

/// Subly's words for the design system's permission PRIMING (train ST-D8).
///
/// 🔴 THE OS PROMPT CAN BE SHOWN ONCE ON MOST PLATFORMS, and Subly reached it
/// from two places — the reminder switches in Settings and the first
/// subscription added — both of which spent it with nothing on screen saying
/// why. Both now come through here, so the explanation is written once.
/// [reason] names what the user is turning on, in that surface's own words.
/// Answers whether the user chose to proceed; "Not now" and every dismissal
/// answer false and spend nothing.
///
/// 🔴 NO OS PROMPT, NO PRIMING. Where the platform cannot schedule a reminder
/// (web, Windows, Linux: [NotificationCapabilities.canSchedule] is false, the
/// same reading the onboarding slide makes) there is no prompt to explain, so
/// this answers yes without drawing anything. Priming there would explain an
/// ask that never comes — and on the first add it would hold the add sheet
/// open behind a question, which is what the live web e2e would have met.
Future<bool> primeReminders(BuildContext context, {required String reason}) {
  if (!NotificationCapabilities.forPlatform(
    defaultTargetPlatform,
    isWeb: kIsWeb,
  ).canSchedule) {
    return Future<bool>.value(true);
  }
  final AppLocalizations l10n = AppLocalizations.of(context);
  return showPermissionPriming(
    context,
    title: l10n.permissionPrimingTitle,
    body: l10n.permissionPrimingBody,
    reasons: <String>[reason],
    allowLabel: l10n.continueLabel,
    notNowLabel: l10n.notNow,
  );
}

/// A settings preference [row] (`<key, label, description>`) flipped, PRIMED
/// first when the flip is a reminder switch going ON.
///
/// `SettingsController.toggle` spends the OS prompt the moment a
/// reminder-bearing row turns on, so the priming has to come BEFORE it: "Not
/// now" leaves the switch OFF. Turning a row OFF, and the in-app-only `unused`
/// row, never prime — neither is a notification ask.
///
/// Here rather than in the settings screen because that file is a private copy
/// of a chassis screen held to a no-growth ceiling by `assert-chassis-parity`
/// (`tooling/chassis-parity.json` `forks`): the call site there is one line.
Future<void> primeThenToggle(
  BuildContext context,
  WidgetRef ref,
  List<String> row,
) async {
  final String key = row[0];
  final bool on = ref.read(settingsControllerProvider).prefs[key] ?? false;
  if (!on && SettingsController.isReminderBearing(key)) {
    if (!await primeReminders(context, reason: row[2])) return;
  }
  await ref.read(settingsControllerProvider.notifier).toggle(key);
}
