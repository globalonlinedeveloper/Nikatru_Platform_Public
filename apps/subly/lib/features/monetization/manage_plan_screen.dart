import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_design_system/nikatru_design_system.dart';
import 'package:nikatru_purchases/nikatru_purchases.dart';

import '../../l10n/app_localizations.dart';
import '../../state/money_providers.dart';

/// Manage subscription — [pipeline 5]M-9 (ROSCA) and [pipeline 5]M-10 (restore).
///
/// ## Why cancelling is ONE screen and ONE confirm, and why that number matters
/// ROSCA's rule is that cancelling must be no harder than subscribing. Buying is
/// Settings → Upgrade → pick a plan: the checkout opens on the third tap.
/// Cancelling is Settings → Manage → Cancel → confirm. The counts are derived
/// from the ROUTER by `tooling/ci/assert-purchase-path.mjs`, from the same
/// navigation source as the purchase count, so the two cannot drift apart by
/// somebody counting them differently.
///
/// 🔴 THE ORIGINAL CRITERION ("cancel steps ≤ purchase steps") WAS VACUOUSLY
/// TRUE. With no purchase flow at all, `0 ≤ 0` passed — so a legal-conduct
/// requirement was green for exactly as long as the thing it protects was
/// missing. The guard now floors BOTH counts at ≥ 1.
///
/// ⚠️ CANCELLING DURING THE TRIAL is the path regulators scrutinise hardest, and
/// it is the same path: nothing here branches on whether the subscription is in
/// its trial. That is deliberate — a separate trial-cancel flow is a second
/// thing to get wrong, and the trial case is covered by the same test set.
class ManagePlanScreen extends ConsumerStatefulWidget {
  const ManagePlanScreen({super.key});

  @override
  ConsumerState<ManagePlanScreen> createState() => _ManagePlanScreenState();
}

class _ManagePlanScreenState extends ConsumerState<ManagePlanScreen> {
  bool _busy = false;
  CancellationOutcome? _outcome;

  Future<void> _cancel() async {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final bool? confirmed = await showDialog<bool>(
      context: context,
      builder: (BuildContext dialogContext) => AlertDialog(
        title: Text(l10n.cancelPlan),
        content: Text(l10n.cancelPlanConfirm),
        actions: <Widget>[
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: Text(l10n.keepPlan),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(dialogContext, true),
            child: Text(l10n.cancelPlan),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;

    setState(() => _busy = true);
    // 🔴 A REAL SERVER CALL. The confirm button on the account-deletion dialog
    // in this same chassis once called `Navigator.pop` and NOTHING ELSE, which
    // looks exactly like a button that worked. This one goes to
    // POST /v1/plan/cancel and the screen reports what came back.
    final CancellationOutcome outcome = await ref
        .read(purchaseRailProvider)
        .requestCancellation();
    // The entitlement may not have changed yet — the rail confirms
    // asynchronously — but re-reading is what makes the screen show the server's
    // view rather than a guess.
    await refreshEntitlements(ref);
    if (!mounted) return;
    setState(() {
      _busy = false;
      _outcome = outcome;
    });
  }

  Future<void> _restore() async {
    setState(() => _busy = true);
    await refreshEntitlements(ref);
    if (!mounted) return;
    setState(() => _busy = false);
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final AsyncValue<core.Entitlements> ent = ref.watch(entitlementsProvider);
    final bool isPro = ent.valueOrNull?.isProAt(DateTime.now()) ?? false;

    return Scaffold(
      // 🔴 THE `leading:` IS THE ONLY WAY OFF THIS SCREEN, AND UNTIL NOW THERE
      // WAS NONE. Measured 2026-08-21: this file contained no navigation call
      // of any kind, and both entries (`settings_screen.dart:575` and
      // `home_screen.dart:1111`) arrive by `context.go('/manage-plan')` onto a
      // `parentNavigatorKey: rootNavigatorKey` route — so `go` replaces the
      // stack with a single match, the shell and its bottom nav bar are gone,
      // and `Navigator` has nothing to pop. A bare `AppBar` then renders NO
      // implicit back button (Flutter only synthesises one when the route can
      // pop). On Android the system back gesture found nothing either; on
      // desktop and web there is no system gesture at all. The screen the app
      // must be able to reach in one tap was a screen you could not leave.
      //
      // ⚠️ A BACK CONTROL, DELIBERATELY NOT A BOTTOM NAV BAR. `core/router.dart`
      // puts this route above the shell on the recorded ground that "a purchase
      // flow with a bottom nav bar underneath it is a way out of a funnel
      // mid-transaction". One labelled exit that lands on the surface the user
      // came through keeps the funnel; five branch tabs dissolve it.
      //
      // `canPop` first, `/settings` second: nothing pushes this route today, so
      // the fallback is the live arm — and `/settings` rather than `/home`
      // because Settings is the parent this screen's own ROSCA step count is
      // measured from (Settings → Manage → Cancel → confirm), and
      // `assert-purchase-path.mjs` derives that count from the same
      // `/settings` → `/manage-plan` hop. Sending the user anywhere else would
      // make the way out disagree with the way in that the guard counts.
      appBar: AppBar(
        title: Text(l10n.managePlanTitle),
        leading: IconButton(
          // 🔴 `semanticLabel` ON THE ICON, NOT ONLY `tooltip` ON THE BUTTON.
          // Measured: with `tooltip:` alone, `a11y_semantics_test.dart`'s
          // manage-plan sweep reported `«» NO NAME` — the tooltip's label sits
          // on its own node and does not merge into the tappable button node,
          // so a screen reader announces the only exit from this screen as
          // nothing at all. The `Icon`'s label does merge. `tooltip:` stays
          // because it is also the desktop hover affordance, which the icon
          // label is not.
          icon: Icon(Icons.arrow_back, semanticLabel: l10n.back),
          tooltip: l10n.back,
          onPressed: () =>
              context.canPop() ? context.pop() : context.go('/settings'),
        ),
      ),
      // Bare `Scaffold` + `ListView` before this, the same shape as settings —
      // and this is the WORSE of the two to leave unconstrained. The screen
      // whose only job is "cancel must be no harder than subscribe" was, on a
      // desktop, a cancel row whose label sat a full window away from the icon
      // that identifies it. ROSCA is a rule about the difficulty of finding the
      // control, and layout is part of how hard something is to find.
      //
      // Same cap as settings, for the same reason: a page of controls. Settings
      // moved from the bare 1280 default to `reading` (720) on 2026-08-21 because
      // the default NEVER BOUND — `AppScaffold` hands the body min(W-361, 1280),
      // so at 1440 it is already 1079 and the "ceiling" was decorative. This
      // screen was left bare in that pass and this comment went false with it:
      // it claimed parity with settings while being 560px wider.
      //
      // ROSCA argues for the tighter cap rather than against it. The rule is
      // about how hard the cancel control is to FIND, and a 1280px row whose
      // label sits a window away from its icon is harder to find than a 720px
      // one, not easier.
      body: ContentPane.reading(
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: <Widget>[
            ListTile(
              leading: Icon(
                isPro ? Icons.verified_outlined : Icons.lock_outline,
              ),
              title: Text(isPro ? l10n.planActive : l10n.planInactive),
            ),
            const Divider(),
            // [pipeline 5]M-10. On this rail the entitlement is a server row keyed
            // (user_id, app_id), so a fresh install on a new device is unlocked by
            // signing in — there is nothing device-local to restore. The control
            // exists because a user who has just paid wants a button, and because
            // Apple guideline 3.1.1 makes one mandatory the day a native IAP rail
            // ships (deferred, 39-CHASSIS §4 cut 5).
            ListTile(
              leading: const Icon(Icons.refresh),
              title: Text(l10n.restorePurchases),
              subtitle: Text(l10n.restorePurchasesHint),
              enabled: !_busy,
              onTap: _busy ? null : _restore,
            ),
            if (isPro)
              ListTile(
                leading: const Icon(Icons.cancel_outlined),
                title: Text(l10n.cancelPlan),
                enabled: !_busy,
                onTap: _busy ? null : _cancel,
              ),
            if (_busy) const LinearProgressIndicator(),
            if (_outcome != null)
              Padding(
                padding: const EdgeInsets.only(top: 16),
                child: Text(_outcomeMessage(l10n, _outcome!)),
              ),
          ],
        ),
      ),
    );
  }

  /// 🔒 FOUR OUTCOMES, FOUR SENTENCES. Collapsing `recorded` into `executed`
  /// would have the app tell a user their subscription is cancelled on the
  /// strength of our having written down that they asked — while the merchant of
  /// record goes on billing them. That is the single most expensive sentence
  /// this screen could say.
  String _outcomeMessage(AppLocalizations l10n, CancellationOutcome o) {
    switch (o) {
      case CancellationOutcome.executed:
        return l10n.cancelExecuted;
      case CancellationOutcome.recorded:
        return l10n.cancelRecorded;
      case CancellationOutcome.noActivePlan:
        return l10n.cancelNoPlan;
      case CancellationOutcome.failed:
        return l10n.cancelFailed;
    }
  }
}
