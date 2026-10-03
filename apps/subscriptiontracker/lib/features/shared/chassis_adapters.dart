import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:nikatru_chassis_screens/monetization/manage_plan_screen.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_design_system/nikatru_design_system.dart';
import 'package:nikatru_purchases/nikatru_purchases.dart';

import '../../core/app_config.dart';
import '../../l10n/chassis_bridge.g.dart';
import '../../state/money_providers.dart';
import 'widgets.dart' show openExternalUrl;

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
    show HelpKeys, HelpRowBuilder, SettingsHeading, helpCard;
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

// ── ⏱ 2026-10-01 · train st-money-ready ──────────────────────────────────────
// The paywall and Manage plan adapters are FORKS held to ceilings that only
// fall (tooling/chassis-parity.json); what this train adds to them lives here,
// beside the other chassis adapters, so the forks shrink instead of growing.

/// MO-03: Apple's standard EULA, linked only on an Apple rail (Apple requires a
/// link to the terms of use beside an auto-renewable subscription). Null on
/// every other rail, so no link is drawn there.
VoidCallback? appleEulaOpener(PurchaseRailKind kind) =>
    kind == PurchaseRailKind.appleIap
    ? () => openExternalUrl(AppConfig.appleEulaUrl)
    : null;

/// What a finished restore says — Manage plan's sentence, and the paywall's.
///
/// 🔒 THE SENTENCE FOLLOWS THE SERVER, NOT THE STORE. A plan the re-read
/// shows is "found" whatever the store answered, because the plan row is that
/// same read and the two must agree. With no plan, a store that could not be
/// asked gets its own sentence — "nothing found" would be a claim we never
/// checked. The store's `detail` is never shown — it is untranslated
/// engineering text.
String restoreSentence(
  AppLocalizations l10n,
  RestoreOutcome asked, {
  required bool planActive,
}) {
  if (planActive) return l10n.restoreFoundPlan;
  return switch (asked) {
    RestoreOutcome.couldNotAsk => l10n.restoreCouldNotReachStore,
    RestoreOutcome.askedStore ||
    RestoreOutcome.serverOnly => l10n.restoreNothingFound,
  };
}

/// MO-03: Restore from the paywall — the rail first (the store, on a store
/// build), then the server re-read, whose answer is the only unlock: the same
/// order and the same words as Manage plan's Restore ([pipeline 5]M-10).
///
/// ⏱ 2026-10-01 · review 1 of #1114 (item 4). It used to run silently: a tap
/// that found nothing did visibly nothing, a re-read that threw escaped the
/// async callback unhandled, and `ref` was read AFTER the store's await — a
/// Back press during a slow store restore disposes the screen, and that read
/// throws in release (money_providers.dart, `refreshEntitlementsIn`). Now the
/// container and the messenger are taken BEFORE the first await, [update]
/// gets `busy` on both edges (and `unlocked` at the end), every outcome is a
/// sentence on screen, and nothing escapes.
VoidCallback paywallRestore(
  BuildContext context,
  AppLocalizations l10n,
  void Function(bool busy, bool unlocked) update,
) => () async {
  final ProviderContainer container = ProviderScope.containerOf(
    context,
    listen: false,
  );
  final ScaffoldMessengerState say = ScaffoldMessenger.of(context);
  update(true, false);
  bool active = false;
  String message;
  try {
    final RestoreOutcome asked = await restorePurchasesOf(
      container.read(purchaseRailProvider),
    );
    active = (await refreshEntitlementsIn(container)).isProAt(DateTime.now());
    message = restoreSentence(l10n, asked, planActive: active);
  } catch (_) {
    message = l10n.restoreCouldNotCheck;
  }
  say.showSnackBar(SnackBar(content: Text(message)));
  update(false, active);
};

/// The paywall's "check again": the server re-read, and whether it shows Pro.
Future<bool> proAfterReread(WidgetRef ref) async =>
    (await refreshEntitlements(ref)).isProAt(DateTime.now());

/// The served feature CODES, in this app's words (D-11). A code this build has
/// no words for draws nothing — never the raw code on a buyer's screen.
///
/// ⏱ 2026-10-01 · MO-07: the Pro codes name what Pro DELIVERS today (ADR 101):
/// `forecast` and `caps`. `plan`/`save` named a pitch, and "Find savings" gated
/// nothing; a code joins the served list in the PR that ships its feature.
///
/// GENERIC over the row type, so this file imports one chassis path (the
/// hardcoded-strings resolver follows exactly one): the fork passes
/// `PaywallFeature.new`.
List<T> paywallFeatures<T>(
  AppLocalizations l10n,
  List<String> codes,
  T Function({required IconData icon, required String title, String? body}) row,
) => <T>[
  for (final String code in codes)
    ?switch (code) {
      'forecast' => row(
        icon: Icons.insights_outlined,
        title: l10n.paywallFeatureForecast,
        body: l10n.paywallFeatureForecastBody,
      ),
      'caps' => row(
        icon: Icons.account_balance_wallet_outlined,
        title: l10n.paywallFeatureCaps,
        body: l10n.paywallFeatureCapsBody,
      ),
      'track' => row(
        icon: Icons.list_alt_outlined,
        title: l10n.paywallFeatureTrack,
      ),
      'remind' => row(
        icon: Icons.notifications_none_outlined,
        title: l10n.paywallFeatureRemind,
      ),
      'sync' => row(icon: Icons.sync, title: l10n.paywallFeatureSync),
      _ => null,
    },
];

/// Where the active plan was bought, as Manage plan draws it (MO-05).
typedef PaidAt = ({
  PlanSourceView? source,
  DateTime? periodEnds,
  VoidCallback? onManageInStore,
});

/// ⏱ 2026-10-01 · MO-05, AB-M4-03-client: WHERE THE USER PAID, from the
/// entitlement's own `store` — never the build channel. A plan bought in Google
/// Play and opened on the web build is managed in Google Play: the screen draws
/// "Manage in Google Play" (the store's own page, through the app's one link
/// launcher) and no Cancel, so nothing posts /v1/plan/cancel for a plan only the
/// store can stop. [ent] is null for no active plan.
PaidAt paidAtOf(core.Entitlements? ent) {
  final ({BillingSource? source, DateTime? periodEnds})? paid = ent == null
      ? null
      : BillingSource.activePlanOf(ent, DateTime.now());
  final Uri? page = paid?.source?.manageUrl;
  return (
    source: switch (paid?.source) {
      BillingSource.web => PlanSourceView.web,
      BillingSource.appStore => PlanSourceView.appStore,
      BillingSource.googlePlay => PlanSourceView.googlePlay,
      null => null,
    },
    periodEnds: paid?.periodEnds?.toLocal(),
    onManageInStore: page == null
        ? null
        : () => openExternalUrl(page.toString()),
  );
}

/// What a cancel request came back as, in words. `inStore` (the server's 409
/// for a store row) is the chassis's sentence: the plan is real and only its
/// store can stop it — never worded as a failure.
String cancelOutcomeMessage(
  BuildContext context,
  AppLocalizations l10n,
  CancellationOutcome o,
) => switch (o) {
  CancellationOutcome.executed => l10n.cancelExecuted,
  CancellationOutcome.recorded => l10n.cancelRecorded,
  CancellationOutcome.noActivePlan => l10n.cancelNoPlan,
  CancellationOutcome.inStore => context.chassisL10n.cancelInStore,
  CancellationOutcome.failed => l10n.cancelFailed,
};
