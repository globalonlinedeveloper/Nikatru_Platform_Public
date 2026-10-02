import 'package:flutter/foundation.dart' show defaultTargetPlatform, kIsWeb;
import 'package:nikatru_core/nikatru_core.dart' as core;

import 'checkout_launcher.dart';
import 'offering.dart';
import 'purchase_capabilities.dart';
import 'purchase_rail.dart';
import 'purchase_rail_kind.dart';
import 'rail_config.dart';

/// The hosted-checkout [PurchaseRail]: a checkout page owned by the merchant of
/// record, opened in the user's own browser. It is one of several rails —
/// `ChassisBilling.railForDeclared` hands a store-billing channel `IapRail`
/// ([ADR 067]) and a channel it cannot sell on `UnavailablePurchaseRail`.
///
/// ## What this deliberately is NOT
/// It is not a native in-app-purchase rail, and it has no store to ask. As a
/// [RestoresPurchases] it answers [RestoreOutcome.serverOnly]: its entitlement
/// is a server row keyed `(user_id, app_id)`, so the screen's server re-read is
/// the whole restore. [PurchaseCapabilities] still records where its checkout
/// is REFUSED by policy (iOS, macOS-App-Store, Play), and the paywall says so.
///
/// ⚠️ CORRECTED 2026-09-25: this read "The one [PurchaseRail] implementation"
/// and "39-CHASSIS §4 cut 5 defers" a native rail. `IapRail` shipped under
/// [ADR 067]; only the comment had not moved.
///
/// It is also not a client that grants anything. `startCheckout` opens a page
/// and returns. The unlock comes from the server, later, and only from there.
///
/// ## ⏱ 2026-10-01 · O-ST-HOSTED-CHECKOUT-CANNOT-START — THE SERVER OPENS IT
/// This rail used to fill [RailConfig.checkoutUrlTemplate], which NO config
/// serves, so on every hosted channel `canStartCheckout` was false and a served
/// `paywall.enabled: true` still sold nothing on web, Windows or Linux. It now
/// asks `POST /v1/checkout` ([core.CheckoutSessionTransport]) and opens the
/// `checkout_url` that route returns. Chosen over a per-rail template because
/// the route is where the attribution lives: it puts our account id in the
/// transaction's `custom_data` and REFUSES when Paddle does not echo it back
/// ([ADR 044] §6) — a URL the client fills can only hope the vendor keeps a
/// query parameter. The server also re-checks `paywall.enabled` and the
/// offering, so a stale client cannot open a checkout the config has closed.
class HostedCheckoutRail implements PurchaseRail, RestoresPurchases {
  HostedCheckoutRail({
    required RailConfig config,
    required String appId,
    required String returnUrl,
    required Future<String?> Function() accountId,
    required Future<String?> Function() accessToken,
    required core.CancellationTransport cancellationTransport,
    core.CheckoutSessionTransport checkoutSessions =
        const core.UnavailableCheckoutSessionTransport(),
    CheckoutLauncher launcher = const UrlCheckoutLauncher(),
    PurchaseCapabilities? capabilities,
  })  : _config = config,
        _appId = appId,
        _returnUrl = returnUrl,
        _accountId = accountId,
        _accessToken = accessToken,
        _cancellations = cancellationTransport,
        _sessions = checkoutSessions,
        _launcher = launcher,
        _capabilities = capabilities ??
            PurchaseCapabilities.forPlatform(
              defaultTargetPlatform,
              isWeb: kIsWeb,
            );

  final RailConfig _config;
  final String _appId;
  final String _returnUrl;
  final Future<String?> Function() _accountId;
  final Future<String?> Function() _accessToken;
  final core.CancellationTransport _cancellations;
  final core.CheckoutSessionTransport _sessions;
  final CheckoutLauncher _launcher;
  final PurchaseCapabilities _capabilities;

  /// What this platform and channel allow. Its `why` travels with a refusal as
  /// `detail`, for the log — the paywall does not render it.
  PurchaseCapabilities get capabilities => _capabilities;

  /// Always the merchant-of-record page: this rail opens nothing else.
  @override
  PurchaseRailKind get railKind => PurchaseRailKind.hosted;

  @override
  List<Offering> get offerings => _config.offerings;

  /// The platform allows it, there is a plan to sell, and this build can ask
  /// the platform host for a checkout. The return URL is the rail's, not the
  /// server's: [_returnUrl] is kept for the day a session carries one.
  @override
  bool get canStartCheckout =>
      _capabilities.canStartCheckout &&
      _config.offerings.isNotEmpty &&
      _sessions.isAvailable;

  /// Where the merchant of record sends the buyer back to.
  String get returnUrl => _returnUrl;

  @override
  Future<CheckoutStart> startCheckout(Offering offering) async {
    // ORDER MATTERS, and it is the order of what the user can do something
    // about. A store-policy refusal is permanent for this build; a missing
    // session is one tap away. Reporting the fixable one first would send a user
    // to sign in for a purchase this build can never make.
    if (!_capabilities.technicallySupported) {
      return CheckoutRefused(
        CheckoutRefusal.platformNotSupported,
        detail: _capabilities.why,
      );
    }
    if (!_capabilities.channelPermitted) {
      return CheckoutRefused(
        CheckoutRefusal.channelNotPermitted,
        detail: _capabilities.why,
      );
    }
    if (_config.offerings.isEmpty || !_sessions.isAvailable) {
      return const CheckoutRefused(
        CheckoutRefusal.railNotConfigured,
        // ⏱ 2026-10-01. This read "No checkout URL has been configured for this
        // rail" — a `checkout_url_template` nobody serves. The hosted checkout
        // is now opened by the platform host, so what can be missing is the
        // plans (the paywall is not enabled) or the host itself (a build whose
        // backend is not live).
        detail: 'Nothing to sell, or no platform host to open a checkout. '
            'The paywall is not enabled for this app, or the backend is not live.',
      );
    }

    // 🔒 [pipeline 5]M-7 — ATTRIBUTION BEFORE MONEY. The account id is what
    // makes the merchant of record's notification resolve to a person. The
    // server attributes the transaction to the VERIFIED subject; this check is
    // the client half, so a signed-out buyer goes to sign-in, not to a 401.
    final String? account = await _accountId();
    if (account == null || account.isEmpty) {
      return const CheckoutRefused(
        CheckoutRefusal.notSignedIn,
        detail: 'A purchase must be attributable to an account.',
      );
    }

    final core.Result<core.CheckoutSession> session = await _sessions
        .createSession(
          appId: _appId,
          offeringId: offering.productId,
          accessToken: await _accessToken(),
        );
    final Uri? url = session.fold(
      (core.CheckoutSession s) => s.checkoutUrl,
      (core.Failure _) => null,
    );
    if (url == null) {
      return CheckoutRefused(
        CheckoutRefusal.couldNotOpen,
        detail: session.fold(
          (core.CheckoutSession _) => '',
          (core.Failure f) => 'The platform host opened no checkout: ${f.message}',
        ),
      );
    }

    if (!await _launcher.open(url)) {
      return const CheckoutRefused(
        CheckoutRefusal.couldNotOpen,
        detail: 'The platform did not open the checkout page.',
      );
    }
    return CheckoutOpened(offering: offering, url: url);
  }

  /// [pipeline 5]M-10 — nothing to ask. A hosted checkout leaves nothing on the
  /// device to give back, and the entitlement is a server row keyed
  /// `(user_id, app_id)`, so the server read the screen makes after this IS the
  /// restore.
  @override
  Future<RestoreOutcome> restorePurchases() async => RestoreOutcome.serverOnly;

  @override
  Future<CancellationOutcome> requestCancellation() async {
    final core.Result<core.CancellationReceipt> r = await _cancellations
        .requestCancellation(appId: _appId, accessToken: await _accessToken());
    return r.fold((core.CancellationReceipt receipt) {
      if (!receipt.hasActivePlan) return CancellationOutcome.noActivePlan;
      if (receipt.cancelAt != null) return CancellationOutcome.inStore;
      if (receipt.executed) return CancellationOutcome.executed;
      // Recorded but not executed is the state today, and it is reported as
      // its own outcome so the screen can say exactly that. Folding it into
      // `executed` would be the app telling a user their subscription is
      // cancelled on the strength of our having written down that they asked.
      if (receipt.recorded) return CancellationOutcome.recorded;
      return CancellationOutcome.failed;
    }, (core.Failure _) => CancellationOutcome.failed);
  }
}
