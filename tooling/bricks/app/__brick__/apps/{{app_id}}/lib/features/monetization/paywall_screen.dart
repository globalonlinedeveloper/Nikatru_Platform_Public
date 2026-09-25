import 'dart:async' show unawaited;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:nikatru_chassis_screens/monetization/paywall_screen.dart';
import 'package:nikatru_purchases/nikatru_purchases.dart';

import '../../core/app_config.dart';
import '../../state/money_providers.dart';
import '../../state/providers.dart';

/// Where the paywall was opened from. A short ENUMERABLE code, because it
/// becomes an analytics parameter — free text there is a D1 column nobody can
/// group by.
enum PaywallTrigger {
  featureGate('feature_gate'),
  settings('settings');

  const PaywallTrigger(this.code);

  final String code;
}

/// The brick's own name for [PaywallPhase] — AN ALIAS, NOT A SECOND ENUM.
///
/// `tooling/screen-register.json`'s `monetization.purchase-states` row proves
/// this screen is REACHED by finding `_PaywallPhase.pending` in THIS file, and
/// `assert-screen-set.mjs:428` reads the reachability file alone, without
/// following the delegation — deliberately, because reachability is a claim
/// about the stamped app. A copy of the five values would satisfy it too, and
/// would be exactly the hand-maintained drift this package exists to remove.
typedef _PaywallPhase = PaywallPhase;

/// The in-flight sentence for a rail of this [kind]: only a hosted page opens
/// in the browser, so only a hosted rail may say so. A store's own sheet — and
/// the no-rail case, which never reaches the opening state — gets the sentence
/// that names neither the web nor a browser.
PaywallCheckoutStyle _checkoutStyleOf(PurchaseRailKind kind) => switch (kind) {
  PurchaseRailKind.paddle => PaywallCheckoutStyle.hosted,
  PurchaseRailKind.playBilling ||
  PurchaseRailKind.appleIap ||
  PurchaseRailKind.none => PaywallCheckoutStyle.store,
};

/// Paywall — the ADAPTER half.
///
/// 🏗️ THE BODY IS IN `package:nikatru_chassis_screens` ([ADR 067] decision 2).
/// Four things stayed here and each answers a named guard or a seam rather than
/// a preference:
///
/// ⛔ THE FOUR `funnel.on*` EMISSIONS, AS A SET.
/// `assert-stamp-properties.mjs:1364-1367` (`money-funnel-emitted-as-a-set`)
/// anchors all four as CALL SITES in this file. They also cannot leave: the
/// funnel is resolved with `ref.read(moneyFunnelProvider.future)` and this
/// package declares no `flutter_riverpod` (see its pubspec for why declaring one
/// would make ~66 existing import sites illegal).
///
/// ⛔ `PurchaseRail.startCheckout` AND THE BOUNDED WAIT.
/// `assert-purchase-path.mjs:287` and `assert-seams-wired.mjs:473` match
/// `.startCheckout(` as a CALL; the rail and the convergence poller are the
/// purchase SEAM, which a screen-body package must not be handed.
///
/// ⛔ `.formattedPrice`, read HERE where the rail's `Offering` still exists.
/// `assert-no-price-literals.mjs:371` reads this file unioned with the chassis
/// file, so either side satisfies it — and the honest home is the one place the
/// `Offering` is in scope.
///
/// ⛔ The navigations, because the chassis package declares no go_router.
class PaywallScreen extends ConsumerStatefulWidget {
  const PaywallScreen({super.key, this.trigger = PaywallTrigger.featureGate});

  final PaywallTrigger trigger;

  @override
  ConsumerState<PaywallScreen> createState() => _PaywallScreenState();
}

class _PaywallScreenState extends ConsumerState<PaywallScreen> {
  _PaywallPhase _phase = _PaywallPhase.choosing;
  PaywallRefusalView _refusalView = PaywallRefusalView.retryable;

  @override
  void initState() {
    super.initState();
    // 🔒 [pipeline 5]M-16. The funnel's DENOMINATOR. Emitted once, from
    // initState rather than build, because build runs on every rebuild and a
    // paywall_viewed per frame makes the conversion rate a rendering statistic.
    //
    // Fire-and-forget: analytics must never delay a paywall, and the recorder
    // already refuses without consent and queues without a network.
    WidgetsBinding.instance.addPostFrameCallback((_) async {
      final MoneyFunnel funnel = await ref.read(moneyFunnelProvider.future);
      await funnel.onPaywallViewed(widget.trigger.code);
    });
    // A store rail's plans are the STORE's answer, asked for here so an open
    // paywall shows today's price and this buyer's trial. A no-op on the web
    // rail, whose plans are the rail config.
    unawaited(refreshOfferingsOf(ref.read(purchaseRailProvider)));
  }

  Future<void> _buy(Offering offering) async {
    final PurchaseRail rail = ref.read(purchaseRailProvider);
    // 🔴 THE TOKEN SEAM IS RESOLVED HERE, BEFORE ANY AWAIT — and the read this
    // replaces was NOT lexically after one, which is exactly why it read as
    // safe. `awaitUnlock` invokes the `accessToken:` callback ONCE PER ATTEMPT
    // from inside its own retry loop (`entitlement_convergence.dart:120-127`):
    // six attempts spread over `kCheckoutConvergenceDelays` (2+4+8+16+30 = 60s),
    // five of them on the far side of a real sleep, while the user is free to
    // leave the paywall at any moment in that minute. A `ref.read` in that
    // callback therefore ran on a disposed widget and threw the release-mode
    // `StateError` `WidgetRef` raises from `_assertNotDisposed`
    // (flutter_riverpod 2.6.1 `consumer.dart:548-551`, reached by `read` at
    // `:617`) — and `_buy` has no `catch`, so it became an unhandled async
    // error with `_phase` stuck at pending.
    //
    // SAFE TO HOLD: `authRepositoryProvider` (`state/providers.dart:964-985`)
    // is a root-scope `Provider` with no `ref.watch` in its body, so it is
    // never recomputed and its instance lives as long as the container —
    // `routerProvider` holds the same one for the life of the app
    // (`core/router.dart:118`).
    //
    // A BOUND-METHOD TEAR-OFF, not a closure over `ref`: the closure would
    // still touch `ref` at call time, which is the whole defect.
    final Future<String?> Function() accessToken = ref
        .read(authRepositoryProvider)
        .currentAccessToken;
    final MoneyFunnel funnel = await ref.read(moneyFunnelProvider.future);

    setState(() => _phase = _PaywallPhase.opening);
    await funnel.onCheckoutStarted(offering.productId);

    final CheckoutStart start = await rail.startCheckout(offering);
    if (!mounted) return;

    if (start is CheckoutRefused) {
      await funnel.onPurchaseFailed(start.reason.name);
      if (!mounted) return;
      // The refusal's `detail` is English and names mechanisms, so it goes to
      // the log and never to the screen. What the buyer sees is chosen by the
      // refusal's ROUTE — one exhaustive switch, so a new refusal cannot land
      // here unrouted (O-PAYWALL-SPEAKS-ONLY-WEB-CHECKOUT).
      debugPrint(
        '[paywall] checkout refused (${start.reason.name}): ${start.detail}',
      );
      switch (refusalRouteOf(start.reason)) {
        case RefusalRoute.backToChoosing:
          // The buyer's own cancel: back to the plans, with nothing to explain.
          setState(() => _phase = _PaywallPhase.choosing);
        case RefusalRoute.signIn:
          // No session: sign in, then come back here. A session the rail has
          // not been told about (it missed the auth event): tell it once and
          // offer Try again — the sign-in route bounces a signed-in user home.
          final String? signedInAs = ref
              .read(authRepositoryProvider)
              .currentUser
              ?.id;
          if (signedInAs == null) {
            context.go('/sign-in?next=%2Fpaywall');
            return;
          }
          if (rail case final IdentifiesBuyer buyer) {
            await buyer.identifyBuyer(signedInAs);
            if (!mounted) return;
          }
          _showRefusal(PaywallRefusalView.retryable);
        case RefusalRoute.retry:
          _showRefusal(PaywallRefusalView.retryable);
        case RefusalRoute.unavailable:
          _showRefusal(PaywallRefusalView.unavailable);
      }
      return;
    }

    setState(() => _phase = _PaywallPhase.pending);

    // The bounded wait. Nothing here grants: it re-reads the SERVER until the
    // entitlement appears or the plan is exhausted.
    final ConvergenceResult result = await ref
        .read(entitlementConvergenceProvider)
        .awaitUnlock(appId: AppConfig.appId, accessToken: accessToken);
    if (!mounted) return;

    if (result.isUnlocked) {
      // 🔴 BOTH CALLS ARE MADE HERE, BEFORE THE AWAIT. `refreshEntitlements`
      // spends its `ref` SYNCHRONOUSLY — `ref.invalidate` then `ref.read`
      // (`state/money_providers.dart:186-188`) — so the deadline is on the
      // CALL, not on the future it returns. Sequentially it sat after
      // `await funnel.onPurchaseSuccess(...)`, which the `if (!mounted)` above
      // does not reach past: a user who leaves during that emit disposes this
      // widget and the invalidate throws.
      //
      // `Future.wait` RATHER THAN A HOISTED VARIABLE, and the difference is not
      // stylistic. A future that errors before its `await` is reached is
      // reported as an UNHANDLED exception — measured on this toolchain:
      // `Future<int>.error(...)`, a 50 ms delay, then `try { await f } catch`
      // prints `Unhandled exception` and never reaches the `catch`.
      // `Future.wait` attaches to both synchronously and still rethrows, so the
      // sequential form's error behaviour is preserved and both events run.
      // A plain SWAP of the two lines is wrong for a different reason: it
      // drops the `purchase_success` event whenever the re-read throws.
      //
      // · onPurchaseSuccess — emitted only after the SERVER confirmed, never on
      //   the checkout's return, or abandoned checkouts and declined cards count
      //   as revenue. It cannot throw: `MoneyFunnel._log` catches everything by
      //   contract (`money_funnel.dart:61-68`).
      // · refreshEntitlements — republishes so every gate in the app sees the
      //   new answer.
      await Future.wait(<Future<void>>[
        funnel.onPurchaseSuccess(offering.productId),
        refreshEntitlements(ref),
      ]);
      if (!mounted) return;
      setState(() => _phase = _PaywallPhase.unlocked);
      return;
    }

    await funnel.onPurchaseFailed(result.outcome.name);
    if (!mounted) return;
    setState(() => _phase = _PaywallPhase.pending);
  }

  void _showRefusal(PaywallRefusalView view) => setState(() {
    _phase = _PaywallPhase.refused;
    _refusalView = view;
  });

  @override
  Widget build(BuildContext context) {
    final PurchaseRail rail = ref.watch(purchaseRailProvider);
    // Repainted when a store rail's plans arrive or change; the web rail's
    // never do.
    return ListenableBuilder(
      listenable: offeringsChangesOf(rail),
      builder: (BuildContext context, Widget? _) {
        // The rail's own `Offering`s, mapped down to the plain rows the chassis
        // paints. `.formattedPrice` is read HERE, where the amount and the ISO
        // currency it was derived from are still in scope — [pipeline 5]M-11.
        final List<Offering> offerings = rail.offerings;
        return PaywallView(
          phase: _phase,
          canStartCheckout: rail.canStartCheckout,
          checkoutStyle: _checkoutStyleOf(rail.railKind),
          refusalView: _refusalView,
          offers: <PaywallOffer>[
            for (final Offering o in offerings)
              PaywallOffer(
                id: o.productId,
                formattedPrice: o.formattedPrice,
                term: o.term.wire,
                trial: switch (o.trial) {
                  final t? => (count: t.count, unit: t.unit.wire),
                  null => null,
                },
              ),
          ],
          onBuy: (PaywallOffer offer) => _buy(
            offerings.firstWhere((Offering o) => o.productId == offer.id),
          ),
          onCheckAgain: () async {
            final bool unlocked = (await refreshEntitlements(ref))
                .isProAt(DateTime.now());
            if (!mounted) return;
            setState(
              () => _phase = unlocked
                  ? _PaywallPhase.unlocked
                  : _PaywallPhase.pending,
            );
          },
          onGoHome: () => context.go('/'),
          onRetry: () => setState(() => _phase = _PaywallPhase.choosing),
        );
      },
    );
  }
}
