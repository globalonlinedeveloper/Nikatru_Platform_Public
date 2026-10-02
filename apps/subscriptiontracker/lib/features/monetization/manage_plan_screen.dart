import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:nikatru_chassis_screens/monetization/manage_plan_screen.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_design_system/nikatru_design_system.dart';
import 'package:nikatru_purchases/nikatru_purchases.dart';

import '../../core/app_config.dart';
import '../../l10n/chassis_bridge.g.dart';
import '../../state/money_providers.dart';
import '../../state/providers.dart';
import '../shared/chassis_adapters.dart';

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
///
/// ⏱ 2026-09-29 · train ST-D9 ([ADR 086] one piece at a time): the RENDERING
/// is the chassis [ManagePlanView], as it already is in the brick. What stays
/// here names a provider or this app's words: `_cancel`, `_restore` and the
/// hoisted container, the four outcome sentences and their tones, and the way
/// to the plans for a user without one (only while this build sells).
class ManagePlanScreen extends ConsumerStatefulWidget {
  const ManagePlanScreen({super.key});

  @override
  ConsumerState<ManagePlanScreen> createState() => _ManagePlanScreenState();
}

class _ManagePlanScreenState extends ConsumerState<ManagePlanScreen> {
  bool _busy = false;
  CancellationOutcome? _outcome;
  _Restored? _restored;

  Future<void> _cancel() async {
    final AppLocalizations l10n = AppLocalizations.of(context);
    // 🔴 THE CONTAINER IS RESOLVED HERE, BESIDE `l10n` AND BEFORE THE FIRST
    // AWAIT, BECAUSE THE REFRESH CANNOT BE. The re-read has to happen AFTER
    // the cancellation, or it reports the state the user just asked to change
    // — and `WidgetRef.read`/`invalidate` are `_assertNotDisposed()` plus the
    // identical call on this container (flutter_riverpod 2.6.1
    // `consumer.dart:617-620` and `:630-633`), where that assert throws a real
    // `StateError` in RELEASE. The container belongs to the root
    // `ProviderScope`, so it outlives every widget under it.
    //
    // Without it, a user who left while POST /v1/plan/cancel was in flight —
    // the app bar's back control stays live throughout — took the release-mode
    // `StateError` [userStateDrops] records, out of a `_cancel` nothing
    // catches. And the entitlement was then never invalidated, so a
    // non-autoDispose `entitlementsProvider` went on reporting the plan the
    // server had just cancelled for the rest of the session.
    //
    // `_restore` below hoists the container for the same reason: its server
    // read now follows the store's answer, so it too comes after an await.
    final ProviderContainer container = ProviderScope.containerOf(
      context,
      listen: false,
    );
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
    // asynchronously — but re-reading is what makes the screen show the
    // server's view rather than a guess. Through the hoisted container, not
    // `refreshEntitlements(ref)`: see the note above.
    await refreshEntitlementsIn(container);
    if (!mounted) return;
    setState(() {
      _busy = false;
      _outcome = outcome;
      _restored = null;
    });
  }

  // 🔴 THE STORE FIRST, THEN THE SERVER — [pipeline 5]M-10,
  // O-STORE-RESTORE-ASKS-ONLY-THE-SERVER. This control used to re-read our own
  // server and nothing else, so on a store build it never asked StoreKit or
  // Play for anything: a purchase the store held and our server had not yet
  // heard about stayed lost, and Apple guideline 3.1.1's Restore control was a
  // refresh button. The store rail now asks the store, whose answer reaches our
  // Worker through the provider's webhook; the hosted rail has no store and
  // answers `serverOnly`. The ORDER is the point: the server read that follows
  // is what the plan row shows, and it is the only thing that unlocks.
  //
  // Container and rail are both resolved BEFORE the first await — the note on
  // `_cancel` above. The wait and the sentence live in `_converge` and
  // `restoreSentence` (chassis_adapters.dart), outside this body, so `assert-purchase-path.mjs` §F
  // reads the whole of it.
  Future<void> _restore() async {
    final ProviderContainer container = ProviderScope.containerOf(
      context,
      listen: false,
    );
    final PurchaseRail rail = ref.read(purchaseRailProvider);
    setState(() => _busy = true);
    final RestoreOutcome asked = await restorePurchasesOf(rail);
    if (!mounted) return;
    core.Entitlements ent = await refreshEntitlementsIn(container);
    if (asked == RestoreOutcome.askedStore) {
      ent = await _converge(container, ent);
    }
    if (!mounted) return;
    setState(() {
      _busy = false;
      _restored = (outcome: asked, planActive: ent.isProAt(DateTime.now()));
      _outcome = null;
    });
  }

  /// The store answered, and what it holds reaches our server through the
  /// provider's webhook — so it can land AFTER the re-read above. The wait is
  /// the paywall's own bounded one ([EntitlementConvergence.awaitUnlock] over
  /// [kCheckoutConvergenceDelays], about a minute at most); a restore adds no
  /// timer of its own. Skipped when the re-read already shows the plan.
  Future<core.Entitlements> _converge(
    ProviderContainer container,
    core.Entitlements now,
  ) async {
    if (now.isProAt(DateTime.now())) return now;
    final ConvergenceResult r = await container
        .read(entitlementConvergenceProvider)
        .awaitUnlock(
          appId: AppConfig.appId,
          accessToken: container
              .read(authRepositoryProvider)
              .currentAccessToken,
        );
    if (!r.isUnlocked) return now;
    return refreshEntitlementsIn(container);
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final AsyncValue<core.Entitlements> ent = ref.watch(entitlementsProvider);
    // ST-U7 (C42): one read decides all four states, so "still asking" and
    // "could not ask" are never drawn as "you have no plan".
    final PlanStatus status = planStatusOf(ent);
    final bool isPro = status == PlanStatus.active;
    // The way to the plans: the same answer the settings Upgrade row reads,
    // so this screen never offers a paywall that could only say "not here".
    final bool offerPlans =
        ref.watch(sellingEnabledProvider) &&
        ref.watch(purchaseRailProvider).canStartCheckout;
    // MO-05, AB-M4-03-client: where the user PAID (chassis_adapters.dart).
    final PaidAt paid = paidAtOf(isPro ? ent.value : null);

    return ManagePlanView(
      title: l10n.managePlanTitle,
      isPro: isPro,
      planStatusLabel: isPro ? l10n.planActive : l10n.planInactive,
      planDetail: isPro ? l10n.planActiveDetail : l10n.planInactiveDetail,
      restoreHint: l10n.restorePurchasesHint,
      cancelLabel: l10n.cancelPlan,
      upgradeLabel: offerPlans ? l10n.seeProPlans : null,
      onUpgrade: offerPlans ? () => context.go('/paywall') : null,
      busy: _busy,
      loading: status == PlanStatus.checking,
      onReload: status == PlanStatus.failed
          ? () => ref.invalidate(entitlementsProvider)
          : null,
      offline: ref.watch(networkUnreachableProvider),
      onReconnect: () => ref.invalidate(appConfigProvider),
      // 🔒 FOUR OUTCOMES, FOUR SENTENCES. Collapsing `recorded` into
      // `executed` would have the app tell a user their subscription is
      // cancelled on the strength of our having written down that they asked —
      // while the merchant of record goes on billing them. That is the single
      // most expensive sentence this screen could say.
      outcomeMessage: switch ((_outcome, _restored)) {
        (final CancellationOutcome o, _) => cancelOutcomeMessage(
          context,
          l10n,
          o,
        ),
        (null, final _Restored r) => restoreSentence(
          l10n,
          r.outcome,
          planActive: r.planActive,
        ),
        (null, null) => null,
      },
      outcomeKind: switch ((_outcome, _restored)) {
        (CancellationOutcome.executed, _) => StatusKind.positive,
        (CancellationOutcome.failed, _) => StatusKind.danger,
        (null, (outcome: _, planActive: true)) => StatusKind.positive,
        _ => StatusKind.warn,
      },
      // 🔴 THE `onBack:` IS THE ONLY WAY OFF THIS SCREEN, AND UNTIL 2026-08-21
      // THERE WAS NONE. Both entries (settings and the home promo card) arrive
      // by `context.go('/manage-plan')` onto a `parentNavigatorKey:
      // rootNavigatorKey` route — so `go` replaces the stack, the shell and
      // its bottom nav bar are gone, and `Navigator` has nothing to pop. On
      // desktop and web there is no system gesture at all.
      //
      // ⚠️ A BACK CONTROL, DELIBERATELY NOT A BOTTOM NAV BAR: a purchase flow
      // with tabs underneath it is a way out of a funnel mid-transaction.
      //
      // `canPop` first, `/settings` second — Settings is the parent this
      // screen's own ROSCA step count is measured from (Settings → Manage →
      // Cancel → confirm), so the way out agrees with the way in.
      onBack: () => context.canPop() ? context.pop() : context.go('/settings'),
      onRestore: _restore,
      onCancel: _cancel,
      source: paid.source,
      periodEnds: paid.periodEnds,
      onManageInStore: paid.onManageInStore,
    );
  }
}

/// What a finished restore reports: what the rail answered, and whether the
/// server's entitlement shows an active plan after the re-read.
typedef _Restored = ({RestoreOutcome outcome, bool planActive});
