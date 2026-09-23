import 'package:flutter/material.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';

/// What the paywall is currently doing. [pipeline 5]M-6's "purchase states".
///
/// 🏗️ MOVED OUT OF THE BRICK BY [ADR 067] decision 2, AND THE ADAPTER STILL
/// SPELLS IT `_PaywallPhase`. `tooling/screen-register.json`'s
/// `monetization.purchase-states` row proves reachability with the literal
/// `_PaywallPhase.pending` READ IN THE BRICK FILE, and the reachability limb of
/// `assert-screen-set.mjs` (`:428`) reads that one file WITHOUT following the
/// delegation — deliberately, because "somebody can get to it" is a claim about
/// the stamped app. So the brick keeps `typedef _PaywallPhase = PaywallPhase;`
/// and there is still exactly ONE enum: an alias, not a copy. A second
/// five-value enum kept in step by hand is the drift this package exists to
/// remove.
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
enum PaywallPhase { choosing, opening, pending, unlocked, refused }

/// One purchasable plan, as the PAINTER needs it.
///
/// 🔴 PLAIN VALUES, NOT `Offering`. `nikatru_purchases` is the purchase SEAM,
/// and this package's pubspec records the standing rule that a screen body here
/// takes values and callbacks so the seam stays in the adapter. [formattedPrice]
/// keeps the field NAME `Offering.formattedPrice` carries, because
/// `assert-no-price-literals.mjs:371` looks for `.formattedPrice` over the
/// adapter UNIONED with this file and a renamed field would read as a paywall
/// that shows no rail-derived price at all — the one conclusion that limb exists
/// to make loud.
///
/// ⚠️ THERE IS NO `amount` AND NO `currency` FIELD, ON PURPOSE. A screen that
/// could format a price could also format the WRONG one; the string arrives
/// already derived from the rail's own amount + ISO currency by
/// `Offering.formattedPrice`, which is what [pipeline 5]M-11 asks for.
@immutable
class PaywallOffer {
  const PaywallOffer({
    required this.id,
    required this.formattedPrice,
    required this.term,
    this.trial,
  });

  /// The rail's product id — passed back through [PaywallView.onBuy] so the
  /// adapter can find the `Offering` this row was rendered from.
  final String id;

  /// Already formatted from an amount and an ISO currency by the rail.
  final String formattedPrice;

  /// The billing term's wire code (`month`, `year`, …), rendered through l10n.
  final String term;

  /// The free trial, or null when the plan has none.
  ///
  /// A COUNT AND A UNIT, NOT A DAY COUNT. A store sells "1 month free", and a
  /// month is not a fixed number of days, so the row says what the seller says.
  /// The unit is a wire code (`day`, `week`, `month`, `year`) rendered through
  /// l10n. ONE nullable value rather than a count defaulting to 0 beside a unit
  /// defaulting to a word: "no trial" is then unrepresentable as "0 days", and
  /// no English default sits in the widget for the hardcoded-string guard to find.
  final ({int count, String unit})? trial;
}

/// The paywall — [pipeline 5]M-6, and the consumer `PaywallGate` never had.
///
/// 🏗️ THE BODY OF `PaywallScreen`, MOVED HERE BY [ADR 067] decision 2. The
/// brick keeps an adapter of the same name: the phase machine, the funnel
/// emissions, `PurchaseRail.startCheckout` and the bounded convergence wait all
/// need a `WidgetRef` or a `GoRouter`, and this package declares neither.
///
/// The screen never grants access on its own, and it never spins: the poller is
/// bounded by the adapter and lands in a stated terminal state, which arrives
/// here as a [PaywallPhase].
///
/// ⚠️ [pipeline C-13] THE WORDING of the pending state is a `human` decision. A
/// green lane here proves the mechanism, not the copy.
class PaywallView extends StatelessWidget {
  const PaywallView({
    required this.phase,
    required this.offers,
    required this.canStartCheckout,
    required this.onBuy,
    required this.onCheckAgain,
    required this.onGoHome,
    this.detail = '',
    super.key,
  });

  /// The upgrade control on a plan row. One per offer, so a width test can find
  /// the row it measured.
  static const Key upgradeButton = Key('paywallUpgrade');

  /// "Check again" — the only control the pending state offers.
  static const Key checkAgainButton = Key('paywallCheckAgain');

  /// The way out once the server has confirmed.
  static const Key goHomeButton = Key('paywallGoHome');

  final PaywallPhase phase;

  /// The plans, already formatted. Empty is a real state and is rendered as
  /// "unavailable" rather than as an empty list.
  final List<PaywallOffer> offers;

  /// Whether the rail can open a checkout on THIS platform at all.
  final bool canStartCheckout;

  /// The REASON a refusal happened, verbatim from the capability row or the
  /// rail. A refusal with no reason is indistinguishable from a broken button.
  final String detail;

  final void Function(PaywallOffer offer) onBuy;
  final VoidCallback onCheckAgain;
  final VoidCallback onGoHome;

  @override
  Widget build(BuildContext context) {
    final ChassisLocalizations l10n = context.chassisL10n;
    final ThemeData theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(title: Text(l10n.paywallTitle)),
      // 🔴 THE `Center` IS GONE, AND THIS IS THE SCREEN THAT NAMES THE BUG.
      // `_body` returns a DIFFERENT NUMBER OF WIDGETS per [PaywallPhase] —
      // choosing, opening, pending, unlocked, refused — so the ListView's
      // extent changes every time the phase does. Under a `Center`, that
      // re-centres the whole scroller: press "Buy" and the plan list you were
      // looking at slides, for a reason the user did not cause. Pinned to the
      // top it stays where it was and only the new rows appear. `.pane` is the
      // 480 the brick file used to hold privately.
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
            ..._body(l10n, theme),
          ],
        ),
      ),
    );
  }

  List<Widget> _body(ChassisLocalizations l10n, ThemeData theme) {
    switch (phase) {
      case PaywallPhase.opening:
        return <Widget>[
          const Center(child: CircularProgressIndicator()),
          const SizedBox(height: 16),
          Text(l10n.paywallOpening, textAlign: TextAlign.center),
        ];
      case PaywallPhase.pending:
        return <Widget>[
          const Center(child: Icon(Icons.hourglass_top_outlined, size: 40)),
          const SizedBox(height: 16),
          // 🔴 NEVER THE WORD "FAILED". The user may well have paid.
          Text(l10n.paywallPending, textAlign: TextAlign.center),
          const SizedBox(height: 16),
          FilledButton(
            key: checkAgainButton,
            onPressed: onCheckAgain,
            child: Text(l10n.paywallCheckAgain),
          ),
        ];
      case PaywallPhase.unlocked:
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
            key: goHomeButton,
            onPressed: onGoHome,
            child: Text(l10n.goHome),
          ),
        ];
      case PaywallPhase.refused:
        return <Widget>[
          Text(l10n.paywallUnavailable, textAlign: TextAlign.center),
          const SizedBox(height: 8),
          // The REASON, verbatim from the capability row or the rail. A refusal
          // with no reason is indistinguishable from a broken button, and a user
          // on iOS deserves to know the rail is not available in this app rather
          // than to conclude the app is broken.
          Text(
            detail,
            style: theme.textTheme.bodySmall,
            textAlign: TextAlign.center,
          ),
        ];
      case PaywallPhase.choosing:
        if (!canStartCheckout || offers.isEmpty) {
          return <Widget>[
            Text(l10n.paywallUnavailable, textAlign: TextAlign.center),
          ];
        }
        return <Widget>[
          for (final PaywallOffer o in offers)
            Card(
              child: ListTile(
                // 🔒 [pipeline 5]M-11. FORMATTED FROM THE RAIL'S OWN AMOUNT AND
                // CURRENCY. There is no price literal anywhere in this file, and
                // `tooling/ci/assert-no-price-literals.mjs` fails the build if
                // one appears — in the adapter or here.
                title: Text(o.formattedPrice),
                subtitle: Text(
                  switch (o.trial) {
                    final ({int count, String unit}) t =>
                      l10n.paywallTermWithTrial(o.term, t.count, t.unit),
                    null => l10n.paywallTerm(o.term),
                  },
                ),
                trailing: FilledButton(
                  key: upgradeButton,
                  onPressed: () => onBuy(o),
                  child: Text(l10n.paywallUpgrade),
                ),
              ),
            ),
        ];
    }
  }
}
