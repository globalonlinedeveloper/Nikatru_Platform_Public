import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
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
      appBar: AppBar(title: Text(l10n.managePlanTitle)),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: <Widget>[
          ListTile(
            leading: Icon(isPro ? Icons.verified_outlined : Icons.lock_outline),
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
