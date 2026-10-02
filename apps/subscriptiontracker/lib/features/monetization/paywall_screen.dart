import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:nikatru_chassis_screens/monetization/paywall_screen.dart';
import 'package:nikatru_purchases/nikatru_purchases.dart';

import '../../core/app_config.dart';
import '../../core/format/money_format.dart';
import '../../l10n/app_localizations.dart';
import '../../state/money_providers.dart';
import '../../state/providers.dart';
import '../shared/chassis_adapters.dart';
import '../shared/widgets.dart' show openExternalUrl;

/// Where the paywall was opened from. A short ENUMERABLE code, because it
/// becomes an analytics parameter — free text there is a D1 column nobody can
/// group by.
enum PaywallTrigger {
  featureGate('feature_gate'),
  settings('settings');

  const PaywallTrigger(this.code);

  final String code;
}

/// What the screen is currently doing — the chassis's [PaywallPhase], under
/// the name this file has always spelled it: an alias, never a second enum.
typedef _PaywallPhase = PaywallPhase;

/// The paywall — [pipeline 5]M-6, and the consumer [PaywallGate] never had.
///
/// ## The three states this screen exists to keep apart
/// A hosted checkout returns the buyer to the app the instant they press pay,
/// and the merchant of record's notification reaches our server some time after
/// that. So between the two there is a real window in which the user HAS paid
/// and the server does NOT know.
///
///   · **opening**  — handed to the rail: a hosted page, or the store's sheet.
///   · **pending**  — back, and the server does not see it yet: NOT a failure,
///                    it is somebody's money in flight.
///   · **unlocked** — the server confirmed. Only this state grants anything.
///
/// It never grants on its own and never spins: the poller is bounded
/// ([kCheckoutConvergenceDelays]) and ends in a stated state. ST-U2 (audit
/// C34, C35): a back button, and nothing sold while `paywall.enabled` is off.
///
/// ⏱ 2026-09-29 · train ST-D9 ([ADR 086] one piece at a time): the RENDERING
/// is the chassis [PaywallView], as it already is in the brick. What stays here
/// names a provider or this app's words: the phase machine, the four funnel
/// emissions, the price under the reader's locale, and the D-11 pitch resolved
/// from the served config codes through this app's catalogue.
///
/// ⚠️ [pipeline C-13] THE WORDING of the pending state is a `human` decision. A
/// green lane here proves the mechanism, not the copy.
class PaywallScreen extends ConsumerStatefulWidget {
  const PaywallScreen({super.key, this.trigger = PaywallTrigger.featureGate});

  final PaywallTrigger trigger;

  @override
  ConsumerState<PaywallScreen> createState() => _PaywallScreenState();
}

class _PaywallScreenState extends ConsumerState<PaywallScreen> {
  _PaywallPhase _phase = _PaywallPhase.choosing;
  bool _restoring = false;
  PaywallRefusalView _refusedView = PaywallRefusalView.retryable;

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
    // `StateError` [userStateDrops] records — and `_buy` has no `catch`, so it
    // became an unhandled async error with `_phase` stuck at pending.
    //
    // SAFE TO HOLD: a root-scope `Provider` with no `ref.watch` — one instance.
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
          // offer Try again — `/sign-in` bounces a signed-in user to `/home`
          // (`router/gates.dart:418`).
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
      // (`money_providers.dart:186-188`) — so the deadline is on the CALL, not
      // on the future it returns. Sequentially it sat after
      // `await funnel.onPurchaseSuccess(...)`, which the `if (!mounted)` above
      // does not reach past: a user who leaves during that emit disposes this
      // widget and the invalidate throws.
      //
      // `Future.wait`, not a hoisted variable: a future that errors before its
      // `await` is reached is an UNHANDLED exception (measured), and
      // `Future.wait` attaches to both at once and still rethrows.
      //
      // · onPurchaseSuccess — emitted only after the SERVER confirmed, never on
      //   the checkout's return, or abandoned checkouts and declined cards count
      //   as revenue. It cannot throw: `MoneyFunnel._log` catches everything by
      //   contract (`money_funnel.dart:61-66`).
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
    _refusedView = view;
  });

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final PurchaseRail rail = ref.watch(purchaseRailProvider);
    final PaywallPitch pitch = ref.watch(paywallPitchProvider);
    final bool selling = ref.watch(sellingEnabledProvider);
    // ST-U7 (C38): the chassis gate asks the rail once, says while it waits,
    // and repaints when a store rail's plans arrive or change; the web rail's
    // never do.
    return PlansLoadGate(
      load: () => refreshOfferingsOf(rail),
      changes: offeringsChangesOf(rail),
      builder: (BuildContext context, bool loading) {
        final List<Offering> offerings = selling
            ? rail.offerings
            : const <Offering>[];
        return PaywallView(
          phase: _phase,
          onBack: () => context.canPop() ? context.pop() : context.go('/home'),
          canStartCheckout: selling && rail.canStartCheckout,
          // Only a hosted page opens in the browser, so only a hosted rail may
          // say so. A store's own sheet names neither the web nor a browser.
          checkoutStyle: rail.railKind == PurchaseRailKind.hosted
              ? PaywallCheckoutStyle.hosted
              : PaywallCheckoutStyle.store,
          refusalView: _refusedView,
          loadingOffers: selling && loading,
          offline: ref.watch(networkUnreachableProvider),
          onReconnect: () => ref.invalidate(appConfigProvider),
          showTrial: pitch.trialCopy,
          proFeatures: paywallFeatures(l10n, pitch.pro, PaywallFeature.new),
          freeFeatures: paywallFeatures(l10n, pitch.free, PaywallFeature.new),
          offers: <PaywallOffer>[
            for (final Offering o in offerings)
              PaywallOffer(
                id: o.productId,
                // 🔒 [pipeline 5]M-11, AND UNDER THE READER'S LOCALE. The rail
                // supplies the amount and the ISO code (`o.price`); the
                // rendering is the formatter every screen uses, never
                // `toStringAsFixed` with a glued symbol (`₹1250000.00`).
                formattedPrice: MoneyFormatter(l10n.localeName).format(o.price),
                term: o.term.wire,
                trial: switch (o.trial) {
                  final TrialPeriod t => (count: t.count, unit: t.unit.wire),
                  null => null,
                },
              ),
          ],
          onBuy: (PaywallOffer offer) => _buy(
            offerings.firstWhere((Offering o) => o.productId == offer.id),
          ),
          onCheckAgain: () async {
            final bool unlocked = await proAfterReread(ref);
            if (!mounted) return;
            setState(
              () => _phase = unlocked
                  ? _PaywallPhase.unlocked
                  : _PaywallPhase.pending,
            );
          },
          onGoHome: () => context.go('/'),
          onRetry: () => setState(() => _phase = _PaywallPhase.choosing),
          // MO-03/MO-04 (st-money-ready): chassis_adapters.dart says why.
          cancelWhere: switch (rail.railKind) {
            PurchaseRailKind.appleIap => PaywallCancelWhere.appStore,
            PurchaseRailKind.playBilling => PaywallCancelWhere.googlePlay,
            _ => PaywallCancelWhere.here,
          },
          restoring: _restoring,
          onRestore: paywallRestore(context, l10n, (bool busy, bool on) {
            if (!mounted) return;
            setState(() => _restoring = busy);
            if (on) setState(() => _phase = _PaywallPhase.unlocked);
          }),
          onOpenTerms: () => openExternalUrl(AppConfig.termsUrl),
          onOpenPrivacy: () => openExternalUrl(AppConfig.privacyUrl),
          onOpenEula: appleEulaOpener(rail.railKind),
        );
      },
    );
  }
}
