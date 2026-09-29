import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:nikatru_chassis_screens/monetization/manage_plan_screen.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;

import '../../l10n/app_localizations.dart';

export 'package:nikatru_chassis_screens/settings/settings_screen.dart'
    show RowChevron;

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
