import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';
import 'package:nikatru_purchases/nikatru_purchases.dart';

import '../../core/app_config.dart';
import '../../l10n/app_localizations.dart';
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

/// What the screen is currently doing. [pipeline 5]M-6's "purchase states", and
/// every one of them is a state the user can be shown a sentence about.
enum _PaywallPhase { choosing, opening, pending, unlocked, refused }

/// The paywall — [pipeline 5]M-6, and the consumer [PaywallGate] never had.
///
/// ## The three states this screen exists to keep apart
/// A hosted checkout returns the buyer to the app the instant they press pay,
/// and the merchant of record's notification reaches our server some time after
/// that. So between the two there is a real window in which the user HAS paid
/// and the server does NOT know.
///
///   · **opening**  — we handed the page to the browser.
///   · **pending**  — they came back, we asked the server, it does not see it
///                    yet. This is NOT a failure and must never be worded as
///                    one: it is somebody's money in flight.
///   · **unlocked** — the server confirmed. Only this state grants anything.
///
/// The screen never grants access on its own, and it never spins: the poller is
/// bounded ([kCheckoutConvergenceDelays]) and lands in a stated terminal state.
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
  String _detail = '';

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
    // SAFE TO HOLD: `authRepositoryProvider` (`providers/auth.dart:97`) is a
    // root-scope `Provider` with no `ref.watch` in its body, so it is never
    // recomputed and its instance lives as long as the container —
    // `routerProvider` holds the same one for the life of the app
    // (`router/router_provider.dart:19-22`; the P1b split moved it out of the
    // barrel, and `router.dart:173` had never been that line anyway).
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
      setState(() {
        _phase = _PaywallPhase.refused;
        _detail = start.detail;
      });
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
      // `Future.wait` RATHER THAN A HOISTED VARIABLE, and the difference is not
      // stylistic. A future that errors before its `await` is reached is
      // reported as an UNHANDLED exception — measured on this toolchain:
      // `Future<int>.error(...)`, a 50 ms delay, then `try { await f } catch`
      // prints `Unhandled exception` and never reaches the `catch`.
      // `Future.wait` attaches to both synchronously and still rethrows, so the
      // sequential form's error behaviour is preserved and both events run.
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

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final PurchaseRail rail = ref.watch(purchaseRailProvider);
    final ThemeData theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(title: Text(l10n.paywallTitle)),
      // 🔴 THE `Center` IS GONE, AND THIS IS THE SCREEN THAT NAMES THE BUG.
      // `_body` returns a DIFFERENT NUMBER OF WIDGETS per `_PaywallPhase` —
      // choosing, opening, pending, unlocked, refused — so the ListView's
      // extent changes every time the phase does. Under a `Center`, that
      // re-centres the whole scroller: press "Buy" and the plan list you were
      // looking at slides, for a reason the user did not cause. Pinned to the
      // top it stays where it was and only the new rows appear. `.pane` is the
      // 480 this file used to hold privately.
      body: ContentPane.pane(
        child: ListView(
          padding: const EdgeInsets.all(24),
          shrinkWrap: true,
          children: <Widget>[
            Icon(
              Icons.workspace_premium_outlined,
              size: 56,
              color: theme.colorScheme.primary,
            ),
            const SizedBox(height: 16),
            Text(
              l10n.paywallHeadline,
              style: theme.textTheme.headlineSmall,
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 24),
            ..._body(l10n, rail, theme),
          ],
        ),
      ),
    );
  }

  List<Widget> _body(
    AppLocalizations l10n,
    PurchaseRail rail,
    ThemeData theme,
  ) {
    switch (_phase) {
      case _PaywallPhase.opening:
        return <Widget>[
          const Center(child: CircularProgressIndicator()),
          const SizedBox(height: 16),
          Text(l10n.paywallOpening, textAlign: TextAlign.center),
        ];
      case _PaywallPhase.pending:
        return <Widget>[
          const Center(child: Icon(Icons.hourglass_top_outlined, size: 40)),
          const SizedBox(height: 16),
          // 🔴 NEVER THE WORD "FAILED". The user may well have paid.
          Text(l10n.paywallPending, textAlign: TextAlign.center),
          const SizedBox(height: 16),
          FilledButton(
            onPressed: () async {
              final bool unlocked = (await refreshEntitlements(
                ref,
              )).isProAt(DateTime.now());
              if (!mounted) return;
              setState(
                () => _phase = unlocked
                    ? _PaywallPhase.unlocked
                    : _PaywallPhase.pending,
              );
            },
            child: Text(l10n.paywallCheckAgain),
          ),
        ];
      case _PaywallPhase.unlocked:
        return <Widget>[
          Icon(
            Icons.check_circle_outline,
            size: 40,
            color: theme.colorScheme.primary,
          ),
          const SizedBox(height: 16),
          Text(l10n.paywallUnlocked, textAlign: TextAlign.center),
          const SizedBox(height: 16),
          FilledButton(
            onPressed: () => context.go('/'),
            child: Text(l10n.goHome),
          ),
        ];
      case _PaywallPhase.refused:
        return <Widget>[
          Text(l10n.paywallUnavailable, textAlign: TextAlign.center),
          const SizedBox(height: 8),
          // The REASON, verbatim from the capability row or the rail. A refusal
          // with no reason is indistinguishable from a broken button, and a user
          // on iOS deserves to know the rail is not available in this app rather
          // than to conclude the app is broken.
          Text(
            _detail,
            style: theme.textTheme.bodySmall,
            textAlign: TextAlign.center,
          ),
        ];
      case _PaywallPhase.choosing:
        if (!rail.canStartCheckout || rail.offerings.isEmpty) {
          return <Widget>[
            Text(l10n.paywallUnavailable, textAlign: TextAlign.center),
          ];
        }
        return <Widget>[
          for (final Offering o in rail.offerings)
            Card(
              child: ListTile(
                // 🔒 [pipeline 5]M-11. FORMATTED FROM THE RAIL'S OWN AMOUNT AND
                // CURRENCY. There is no price literal anywhere in this file, and
                // `tooling/ci/assert-no-price-literals.mjs` fails the build if
                // one appears.
                title: Text(o.formattedPrice),
                subtitle: Text(
                  o.trialDays > 0
                      ? l10n.paywallTermWithTrial(o.term.wire, o.trialDays)
                      : l10n.paywallTerm(o.term.wire),
                ),
                trailing: FilledButton(
                  onPressed: () => _buy(o),
                  child: Text(l10n.paywallUpgrade),
                ),
              ),
            ),
        ];
    }
  }
}
