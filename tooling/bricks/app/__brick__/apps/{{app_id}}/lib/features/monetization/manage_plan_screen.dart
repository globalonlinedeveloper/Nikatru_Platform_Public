import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:nikatru_chassis_screens/monetization/manage_plan_screen.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_design_system/nikatru_design_system.dart';
import 'package:nikatru_purchases/nikatru_purchases.dart';

import '../../core/app_config.dart';
import '../../l10n/app_localizations.dart';
import '../../state/money_providers.dart';
import '../../state/providers.dart';

/// Manage subscription — the ADAPTER half.
///
/// 🏗️ THE BODY IS IN `package:nikatru_chassis_screens` ([ADR 067] decision 2).
/// Three things stayed here and each answers a named guard or a seam:
///
/// ⛔ `.requestCancellation()`. `assert-screen-set.mjs:289` matches it as a
/// purchase-path limb, and `tooling/screen-register.json`'s
/// `monetization.manage-plan` row proves REACHABILITY with that literal in THIS
/// file — the reachability limb reads one file and does not follow the
/// delegation, deliberately, because reachability is a claim about the stamped
/// app.
///
/// ⛔ `_restore` ([pipeline 5]M-10) — `restorePurchasesOf(rail)` and then the
/// entitlement re-read — and the hoisted `ProviderContainer` in `_cancel`:
/// between them they need `nikatru_purchases` and Riverpod, and this package
/// declares neither.
///
/// ⛔ The app-owned labels and the outcome sentences. `managePlanTitle`,
/// `plan{Active,Inactive}`, `cancelPlan`, `restorePurchasesHint`,
/// `cancelExecuted`, `cancelNoPlan`, `cancelFailed` and the three `restore*`
/// sentences live in the APP's `.arb`.
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
    final ChassisLocalizations l10n = context.chassisL10n;
    final AppLocalizations appL10n = AppLocalizations.of(context);
    // 🔴 THE CONTAINER IS RESOLVED HERE, BESIDE `l10n` AND BEFORE THE FIRST
    // AWAIT, BECAUSE `refreshEntitlements` CANNOT BE. It takes a `WidgetRef`
    // and spends it SYNCHRONOUSLY — `ref.invalidate` then `ref.read`
    // (`state/money_providers.dart:186-188`) — while the re-read has to happen
    // AFTER the cancellation, or it reports the state the user just asked to
    // change. So no ordering puts that call before an await, and what gets
    // hoisted is what the `ref` RESOLVES TO: `WidgetRef.read`/`invalidate` are
    // `_assertNotDisposed()` plus the identical call on this container
    // (flutter_riverpod 2.6.1 `consumer.dart:617-620` and `:630-633`, the
    // assert itself at `:548-551`), and the container belongs to the root
    // `ProviderScope`, so it outlives every widget under it.
    //
    // Without it, a user who left while POST /v1/plan/cancel was in flight —
    // the app bar's back control stays live throughout — took the release-mode
    // `StateError('Cannot use "ref" after the widget was disposed.')`, out of a
    // `_cancel` nothing catches.
    //
    // ⚠️ AND AN `if (mounted)` SKIP WOULD BE WORSE THAN THE CRASH, not merely
    // different: `entitlementsProvider` is a plain `FutureProvider`, NOT
    // autoDispose (`state/money_providers.dart:126-127`), so skipping the
    // invalidate after a SUCCESSFUL server-side cancellation leaves the app
    // reporting the cancelled plan as active for the rest of the session.
    //
    // ⚠️ THE INLINE PAIR IS THE PRICE OF `refreshEntitlements` TAKING A
    // `WidgetRef`, AND IT IS NOT THE SHAPE apps/subscriptiontracker SETTLED ON.
    // `apps/subscriptiontracker/lib/state/money_providers.dart:209-213` has since grown
    // `refreshEntitlementsIn(ProviderContainer)` — the SAME two calls behind a
    // name — and its `_cancel` calls that instead. THE BRICK'S OWN
    // `state/money_providers.dart` DOES NOT HAVE THAT HELPER YET, so this file
    // spells the pair out rather than call something that does not exist in a
    // stamped app. When the helper is added to the brick's money_providers
    // template, replace the pair — here, in `_restore` and in `_converge` —
    // with `await refreshEntitlementsIn(container);` and the two trees converge
    // again.
    //
    // `refreshEntitlements` must NOT be made to delegate to the container form:
    // that would drop `_assertNotDisposed()` from the `WidgetRef` path and turn
    // a loud use-after-dispose into a silent one. `_restore` below hoists the
    // container too: its re-read now follows the store's answer, so it also
    // comes after an await, and it spells out the same pair.
    final ProviderContainer container = ProviderScope.containerOf(
      context,
      listen: false,
    );
    final bool? confirmed = await showDialog<bool>(
      context: context,
      builder: (BuildContext dialogContext) => AlertDialog(
        title: Text(appL10n.cancelPlan),
        content: Text(appL10n.cancelPlanConfirm),
        actions: <Widget>[
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: Text(l10n.keepPlan),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(dialogContext, true),
            child: Text(appL10n.cancelPlan),
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
    container.invalidate(entitlementsProvider);
    await container.read(entitlementsProvider.future);
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
  // Play for anything, and Apple guideline 3.1.1's Restore control was a
  // refresh button. The store rail now asks the store, whose answer reaches our
  // Worker through the provider's webhook; every other rail answers
  // `serverOnly`. The ORDER is the point: the re-read that follows is what the
  // plan row shows, and it is the only thing that unlocks.
  //
  // Container and rail are both resolved BEFORE the first await — the note on
  // `_cancel` above. The wait and the sentence live in `_converge` and
  // `_restoreMessage`, outside this body, so `assert-purchase-path.mjs` §F
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
    container.invalidate(entitlementsProvider);
    core.Entitlements ent = await container.read(entitlementsProvider.future);
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
    container.invalidate(entitlementsProvider);
    return container.read(entitlementsProvider.future);
  }

  @override
  Widget build(BuildContext context) {
    final ChassisLocalizations l10n = context.chassisL10n;
    final AppLocalizations appL10n = AppLocalizations.of(context);
    final AsyncValue<core.Entitlements> ent = ref.watch(entitlementsProvider);
    final bool isPro = ent.valueOrNull?.isProAt(DateTime.now()) ?? false;

    return ManagePlanView(
      title: appL10n.managePlanTitle,
      isPro: isPro,
      planStatusLabel: isPro ? appL10n.planActive : appL10n.planInactive,
      restoreHint: appL10n.restorePurchasesHint,
      cancelLabel: appL10n.cancelPlan,
      busy: _busy,
      // Pop when there IS somewhere to pop to (a future `push` from a deeper
      // surface), otherwise return to the register row this screen hangs off.
      // `/settings` and not `/` deliberately: it is where the user was, and it
      // is the origin `assert-purchase-path.mjs` measures the ROSCA cancel
      // distance from.
      onBack: () => context.canPop() ? context.pop() : context.go('/settings'),
      onRestore: _restore,
      onCancel: _cancel,
      outcomeMessage: _latestMessage(l10n, appL10n),
    );
  }

  /// The view has ONE sentence slot, and the last action fills it: `_restore`
  /// clears the cancel outcome and `_cancel` clears the restore outcome.
  String? _latestMessage(ChassisLocalizations l10n, AppLocalizations appL10n) {
    final _Restored? restored = _restored;
    if (restored != null) return _restoreMessage(appL10n, restored);
    final CancellationOutcome? outcome = _outcome;
    if (outcome != null) return _outcomeMessage(l10n, appL10n, outcome);
    return null;
  }

  /// 🔒 FOUR OUTCOMES, FOUR SENTENCES. Collapsing `recorded` into `executed`
  /// would have the app tell a user their subscription is cancelled on the
  /// strength of our having written down that they asked — while the merchant of
  /// record goes on billing them. That is the single most expensive sentence
  /// this screen could say.
  String _outcomeMessage(
    ChassisLocalizations l10n,
    AppLocalizations appL10n,
    CancellationOutcome o,
  ) {
    switch (o) {
      case CancellationOutcome.executed:
        return appL10n.cancelExecuted;
      case CancellationOutcome.recorded:
        return l10n.cancelRecorded;
      case CancellationOutcome.noActivePlan:
        return appL10n.cancelNoPlan;
      case CancellationOutcome.failed:
        return appL10n.cancelFailed;
    }
  }

  /// 🔒 THE SENTENCE FOLLOWS THE SERVER, NOT THE STORE. A plan the re-read
  /// shows is "found" whatever the store answered, because the plan row is
  /// that same read and the two must agree. With no plan, a store that could
  /// not be asked gets its own sentence — "nothing found" would be a claim we
  /// never checked. The store's `detail` is never shown — it is untranslated
  /// engineering text.
  String _restoreMessage(AppLocalizations appL10n, _Restored r) {
    if (r.planActive) return appL10n.restoreFoundPlan;
    return switch (r.outcome) {
      RestoreOutcome.couldNotAsk => appL10n.restoreCouldNotReachStore,
      RestoreOutcome.askedStore ||
      RestoreOutcome.serverOnly => appL10n.restoreNothingFound,
    };
  }
}

/// What a finished restore reports: what the rail answered, and whether the
/// server's entitlement shows an active plan after the re-read.
typedef _Restored = ({RestoreOutcome outcome, bool planActive});
