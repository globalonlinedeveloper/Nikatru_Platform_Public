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
class HostedCheckoutRail implements PurchaseRail, RestoresPurchases {
  HostedCheckoutRail({
    required RailConfig config,
    required String appId,
    required String returnUrl,
    required Future<String?> Function() accountId,
    required Future<String?> Function() accessToken,
    required core.CancellationTransport cancellationTransport,
    CheckoutLauncher launcher = const UrlCheckoutLauncher(),
    PurchaseCapabilities? capabilities,
  })  : _config = config,
        _appId = appId,
        _returnUrl = returnUrl,
        _accountId = accountId,
        _accessToken = accessToken,
        _cancellations = cancellationTransport,
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
  final CheckoutLauncher _launcher;
  final PurchaseCapabilities _capabilities;

  /// What this platform and channel allow. Its `why` travels with a refusal as
  /// `detail`, for the log — the paywall does not render it.
  PurchaseCapabilities get capabilities => _capabilities;

  /// Always the merchant-of-record page: this rail opens nothing else.
  @override
  PurchaseRailKind get railKind => PurchaseRailKind.paddle;

  @override
  List<Offering> get offerings => _config.offerings;

  @override
  bool get canStartCheckout =>
      _capabilities.canStartCheckout && _config.canCheckout;

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
    if (!_config.canCheckout) {
      return const CheckoutRefused(
        CheckoutRefusal.railNotConfigured,
        // ⚠️ CORRECTED 2026-08-28. This read "… OWNER_QUEUE A-1
        // (merchant-of-record seller account) is pending." The seller account is
        // NOT pending: it went LIVE 2026-08-11 ([ADR 044]). The refusal itself is
        // unchanged and still fires — what is absent is the checkout URL template,
        // because `paywall.enabled` is false for every app in
        // services/platform/src/app-config-data.json.
        detail: 'No checkout URL has been configured for this rail. '
            'The paywall is not enabled for this app.',
      );
    }

    // 🔒 [pipeline 5]M-7 — ATTRIBUTION BEFORE MONEY. The account id is what
    // makes the merchant of record's notification resolve to a person. Without
    // it the payment arrives unclaimed, and an unclaimed payment from an IN-APP
    // purchase is a defect, not a supported state — so the checkout does not
    // open at all rather than opening one that cannot be honoured.
    final String? account = await _accountId();
    if (account == null || account.isEmpty) {
      return const CheckoutRefused(
        CheckoutRefusal.notSignedIn,
        detail: 'A purchase must be attributable to an account.',
      );
    }

    final String? filled = RailConfig.fill(
      _config.checkoutUrlTemplate,
      appId: _appId,
      priceId: offering.productId,
      accountId: account,
      returnUrl: _returnUrl,
    );
    final Uri? url = filled == null ? null : Uri.tryParse(filled);
    if (url == null) {
      return const CheckoutRefused(
        CheckoutRefusal.railNotConfigured,
        detail: 'The configured checkout template did not produce a URL.',
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
