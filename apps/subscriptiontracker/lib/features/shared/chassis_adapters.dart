import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:nikatru_chassis_screens/monetization/manage_plan_screen.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;

import '../../l10n/app_localizations.dart';

// ST-T9 (EN-18): the after-sign-in setup is the chassis step list; the app
// screen hands it this app's three steps. Reached through this file, the one
// recorded import of the chassis (tooling/chassis-parity.json `adopted`).
export 'package:nikatru_chassis_screens/firstrun/setup_steps_view.dart'
    show SetupStep, SetupStepsView;
// ⏱ 2026-10-01 · O-APPS-GOV-IN-VAPT-CHECKLIST — the device-integrity pieces
// lib/core/device_integrity.dart calls, re-exported like the others here.
export 'package:nikatru_chassis_screens/integrity/device_integrity_gate.dart'
    show
        DeviceIntegrityScope,
        integrityRecorder,
        modifiedCopyBlocked,
        reauthenticateUser;
export 'package:nikatru_chassis_screens/settings/help_section.dart'
    show HelpKeys, SettingsHeading, helpCard;
export 'package:nikatru_chassis_screens/settings/data_section.dart'
    show DataKeys, dataCard;
export 'package:nikatru_chassis_screens/settings/settings_screen.dart'
    show DevicesSection, EditProfileDialog, RowChevron;

/// ST-U7/U5 adapters: this app's entitlement read and strings, handed to the
/// chassis states that own the rendering — plan status (C42) and the chevron
/// of an inert settings row (D6, D2). The forks call the chassis; they do not
/// grow their own copies of it.
///
/// ⏱ 2026-09-29 · train ST-D9: the plan screens now import the chassis
/// directly (ManagePlanView, PaywallView and PlansLoadGate), so the re-exports
/// of PlanStatusTile / PlansLoadGate / PlansLoading and the plan-status
/// labels left this file; the chassis owns those words.
PlanStatus planStatusOf(AsyncValue<core.Entitlements> ent) => PlanStatus.of(
  loaded: ent.hasValue,
  failed: ent.hasError,
  pro: ent.value?.isProAt(DateTime.now()) ?? false,
);

/// A settings row with nowhere to go says so; the chevron is [RowChevron].
String? inertRowSubtitle(
  BuildContext context,
  VoidCallback? onTap,
  String? subtitle,
) =>
    subtitle ??
    (onTap == null
        ? AppLocalizations.of(context).settingsNotAvailableYet
        : null);
