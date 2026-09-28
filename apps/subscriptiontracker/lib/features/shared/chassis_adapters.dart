import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:nikatru_chassis_screens/monetization/manage_plan_screen.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;

import '../../l10n/app_localizations.dart';

export 'package:nikatru_chassis_screens/monetization/manage_plan_screen.dart'
    show PlanStatus, PlanStatusTile;
export 'package:nikatru_chassis_screens/monetization/paywall_screen.dart'
    show PlansLoadGate, PlansLoading;
export 'package:nikatru_chassis_screens/settings/settings_screen.dart'
    show RowChevron;

/// ST-U7/U5 adapters: this app's entitlement read and strings, handed to the
/// chassis states that own the rendering — plan status (C42), plans loading
/// (C38) and the chevron of an inert settings row (D6, D2).
/// The forks call the chassis; they do not grow their own copies of it.
PlanStatus planStatusOf(AsyncValue<core.Entitlements> ent) => PlanStatus.of(
  loaded: ent.hasValue,
  failed: ent.hasError,
  pro: ent.valueOrNull?.isProAt(DateTime.now()) ?? false,
);

PlanStatusLabels planStatusLabels(AppLocalizations l10n) => PlanStatusLabels(
  active: l10n.planActive,
  inactive: l10n.planInactive,
  checking: l10n.planChecking,
  failed: l10n.planCheckFailed,
  retry: l10n.retry,
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
