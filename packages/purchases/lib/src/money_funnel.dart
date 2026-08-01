import 'package:nikatru_core/nikatru_core.dart' as core;

/// The four money events, and the reason they live in a package rather than in
/// an app — [pipeline 5]M-16.
///
/// ## What was wrong before
/// `apps/subly/lib/state/analytics_funnel.dart` declares `onPaywallViewed`,
/// `onCheckoutStarted`, `onPurchaseSuccess` and `onPurchaseFailed`, and all four
/// had **zero callers, tree-wide**. The analytics rail emitted launch,
/// activation and notification opens — everything except the money. And because
/// the file sits inside one app, no other app and no stamped brick could have
/// emitted them even if something had wanted to.
///
/// So the funnel's money half moves here, beside the rail that produces it, and
/// the brick calls it. Every app the factory stamps is born measuring its own
/// conversion.
///
/// ## 🔒 THE FIREWALL — [ADR 020]:21, and it is the reason this class is thin
/// **These events must never carry a user id, and this rail must never build a
/// `(user_id, anon_id)` mapping.** The obvious way to answer "which cohort
/// paid?" is to join the pseudonymous analytics id to the paying account id —
/// and doing it once retroactively reclassifies the ENTIRE analytics store as
/// personal data subject to DPDP erasure, for every app, forever. It cannot be
/// undone by deleting the join afterwards.
///
/// Which is why every parameter below is an ENUMERABLE CODE — a price id, a
/// term, a refusal reason — and why there is no `userId` parameter to forget to
/// leave out. `tooling/ci/assert-pseudonymity-firewall.mjs` enforces both halves.
class MoneyFunnel {
  const MoneyFunnel(this._analytics);

  final core.Analytics _analytics;

  /// The paywall was shown. [trigger] is where from (`settings`, `feature_gate`,
  /// `onboarding`) — a short code, never free text.
  Future<void> onPaywallViewed(String trigger) =>
      _log('paywall_viewed', <String, Object?>{'trigger': trigger});

  /// A checkout page was opened. [sku] is the rail's own price id.
  Future<void> onCheckoutStarted(String sku) =>
      _log('checkout_started', <String, Object?>{'sku': sku});

  /// The SERVER confirmed the entitlement.
  ///
  /// 🔴 EMITTED AFTER THE ENTITLEMENT READ SUCCEEDS, never on the checkout's
  /// return. A success event fired when the browser comes back counts abandoned
  /// checkouts and declined cards as revenue, which makes the conversion number
  /// worse than having none — it looks authoritative and is wrong upward.
  Future<void> onPurchaseSuccess(String sku) =>
      _log('purchase_success', <String, Object?>{'sku': sku});

  /// The purchase did not complete. [reason] must be an ENUMERABLE code
  /// (`channel_not_permitted`, `rail_not_configured`, `not_signed_in`,
  /// `could_not_open`, `still_pending`), never a raw platform error string —
  /// that would put free text into D1 and, worse, occasionally put a URL or an
  /// account identifier there with it.
  Future<void> onPurchaseFailed(String reason) =>
      _log('purchase_failed', <String, Object?>{'reason': reason});

  /// Best-effort by contract: analytics must never be able to break a purchase.
  Future<void> _log(String event, Map<String, Object?> params) async {
    try {
      await _analytics.log(event, params: params);
    } catch (_) {
      // The recorder already refuses without consent and queues without a
      // network. Anything that still escapes is not worth a paywall crash.
    }
  }
}
