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
    // `WidgetRef`, AND IT IS NOT THE SHAPE apps/subly SETTLED ON.
    // `apps/subly/lib/state/money_providers.dart:209-213` has since grown
    // `refreshEntitlementsIn(ProviderContainer)` — the SAME two calls behind a
    // name — and its `_cancel` calls that instead. THE BRICK'S OWN
    // `state/money_providers.dart` DOES NOT HAVE THAT HELPER YET, so this file
    // spells the pair out rather than call something that does not exist in a
    // stamped app. When the helper is added to the brick's money_providers
    // template, replace these two lines with `await
    // refreshEntitlementsIn(container);` and the two trees converge again.
    //
    // `refreshEntitlements` must NOT be made to delegate to the container form:
    // that would drop `_assertNotDisposed()` from the `WidgetRef` path and turn
    // a loud use-after-dispose into a silent one. `_restore` below stays on the
    // `WidgetRef` form, where the read already precedes every await.
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
    container.invalidate(entitlementsProvider);
    await container.read(entitlementsProvider.future);
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
      appBar: AppBar(
        // 🔴 AN EXPLICIT BACK CONTROL, BECAUSE THE AUTOMATIC ONE NEVER APPEARED.
        // `AppBar` inserts a back button only when its `Navigator` can pop, and
        // this screen is reached with `context.go` from the settings register
        // row and from the promo card — `go` REPLACES the stack, so there was
        // nothing to pop and no leading control was ever built. The result was a
        // cancellation screen with no way out of it except the system Back
        // gesture, which web and desktop do not reliably give: on the one screen
        // whose whole job is "cancelling must be no harder than subscribing".
        //
        // ⚠️ THE COMMENT IN `_cancel` ABOVE ALREADY ASSUMED THIS CONTROL
        // EXISTED — "the app bar's back control stays live throughout" is the
        // measured reason the provider container is hoisted before the first
        // await. That hazard is real again now, and the hoist is what makes
        // leaving mid-cancellation safe rather than a `StateError`.
        //
        // `BackButton` rather than a hand-rolled `IconButton`: it carries the
        // platform's own glyph and the tooltip/semantics label from
        // `MaterialLocalizations`, so this adds no copy to the arb and is
        // translated in every locale the app declares.
        leading: BackButton(
          // Pop when there IS somewhere to pop to (a future `push` from a
          // deeper surface), otherwise return to the register row this screen
          // hangs off. `/settings` and not `/` deliberately: it is where the
          // user was, and it is the origin `assert-purchase-path.mjs` measures
          // the ROSCA cancel distance from.
          onPressed: () =>
              context.canPop() ? context.pop() : context.go('/settings'),
        ),
        title: Text(l10n.managePlanTitle),
      ),
      // Bare `Scaffold` + `ListView` before this, the same shape as settings —
      // and this is the WORSE of the two to leave unconstrained. The screen
      // whose only job is "cancel must be no harder than subscribe" was, on a
      // desktop, a cancel row whose label sat a full window away from the icon
      // that identifies it. ROSCA is a rule about the difficulty of finding the
      // control, and layout is part of how hard something is to find.
      //
      // Same default cap as settings, for the same reason: a page of controls,
      // agreeing with the ceiling `AppScaffold` already applies.
      body: ContentPane(
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
