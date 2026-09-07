import 'package:flutter/foundation.dart' show debugPrint;
import 'package:nikatru_core/nikatru_core.dart' as core;

import 'checkout_launcher.dart';
import 'iap_bridge.dart';
import 'offering.dart';
import 'purchase_capabilities.dart';
import 'purchase_rail.dart';
import 'purchase_rail_kind.dart';
import 'rail_config.dart';

/// The STORE billing implementation of [PurchaseRail] — [ADR 067] decision 7,
/// [ADR 039] D2/D3/D5.
///
/// ## What it shares with [HostedCheckoutRail], and why that is the point
/// It grants nothing. `startCheckout` runs the store's purchase sheet and
/// returns [CheckoutSubmitted]; the unlock still arrives from
/// `GET /v1/entitlements`, converged on by `EntitlementConvergence`, exactly as
/// it does for the hosted rail. The store SDK's own "the user is Pro" answer is
/// deliberately NOT wired to anything that unlocks — it is a client-side claim
/// about money, on a device the customer controls, and [pipeline 5]M-5 is that
/// the client grants nothing, ever. A store SDK is a payment mechanism, not an
/// authority on entitlement.
///
/// ## What it does differently
/// - It refuses on any channel whose register rail is not a store rail. A
///   `paddle` channel opening a store sheet is as wrong as the reverse, and the
///   register is the decision in both directions.
/// - `requestCancellation` records our own `/v1/plan/cancel` row AND opens the
///   store's management page. ROSCA — cancelling must be no harder than buying —
///   and on a store rail the second half is not optional: only the store can
///   actually stop the renewal, so a rail that recorded the request and stopped
///   there would have told the customer they cancelled while the charge stayed.
///   The record is written FIRST: if the page fails to open we still hold the
///   evidence that they asked, which is what a support conversation and a
///   regulator both read.
class IapRail implements PurchaseRail {
  IapRail({
    required IapBridge bridge,
    required IapBridgeConfig bridgeConfig,
    required RailConfig config,
    required PurchaseChannel channel,
    required String appId,
    required Future<String?> Function() accessToken,
    required core.CancellationTransport cancellationTransport,
    CheckoutLauncher launcher = const UrlCheckoutLauncher(),
    PurchaseRailKind? railKind,
  })  : _bridge = bridge,
        _bridgeConfig = bridgeConfig,
        _config = config,
        _channel = channel,
        _appId = appId,
        _accessToken = accessToken,
        _cancellations = cancellationTransport,
        _launcher = launcher,
        // Injectable ONLY so a test can drive the refusal path for a rail this
        // channel does not take. The default is the register's answer, resolved
        // — never a value a caller happens to pass.
        _railKind = railKind ?? PurchaseRailKind.forChannel(channel);

  final IapBridge _bridge;
  final IapBridgeConfig _bridgeConfig;
  final RailConfig _config;
  final PurchaseChannel _channel;
  final String _appId;
  final Future<String?> Function() _accessToken;
  final core.CancellationTransport _cancellations;
  final CheckoutLauncher _launcher;
  final PurchaseRailKind _railKind;

  bool _configured = false;
  bool _configureAttempted = false;

  /// The rail this channel sells through, as the register decides it.
  PurchaseRailKind get railKind => _railKind;

  /// The channel this rail was built for. Exposed so the paywall can name it in
  /// a refusal rather than saying "not supported" with no subject.
  PurchaseChannel get channel => _channel;

  @override
  List<Offering> get offerings => _config.offerings;

  /// 🔴 DELIBERATELY NOT `_bridge.something`. `canStartCheckout` is read while a
  /// paywall is BUILDING a widget, so it has to be synchronous, and the store's
  /// answer is not. What it can honestly say without asking the store is: this
  /// channel takes a store rail, and the rail config has something to sell. The
  /// store's own refusals ([IapPurchaseOutcome.storeRefused],
  /// [IapPurchaseOutcome.unavailable]) arrive from [startCheckout] with a reason
  /// the UI can show — which is better than a button that is absent for a
  /// condition that cleared thirty seconds ago.
  @override
  bool get canStartCheckout =>
      _railKind.isStoreBilling && _config.offerings.isNotEmpty;

  Future<bool> _ensureConfigured() async {
    if (_configured) return true;
    if (_configureAttempted) return false;
    _configureAttempted = true;
    if (!_bridgeConfig.isUsable) return false;
    try {
      _configured = await _bridge.configure(_bridgeConfig);
    } catch (e) {
      // A store SDK that throws on a cold start must not take a paywall with
      // it. The refusal below is a sentence the user can read.
      debugPrint('[purchases] IAP bridge configure failed: $e');
      _configured = false;
    }
    return _configured;
  }

  @override
  Future<CheckoutStart> startCheckout(Offering offering) async {
    // ORDER MATTERS, and it is the order of what the user can do something
    // about — the same rule [HostedCheckoutRail] follows. A channel that does
    // not take this rail is permanent for this build; a missing session is one
    // tap away.
    if (!_railKind.isStoreBilling) {
      return CheckoutRefused(
        CheckoutRefusal.channelNotPermitted,
        detail:
            'Channel ${_channel.registerId} sells through ${_railKind.registerId}, '
            'not the store billing rail. tooling/channel-register.json is the decision.',
      );
    }
    if (_config.offerings.isEmpty) {
      return const CheckoutRefused(
        CheckoutRefusal.railNotConfigured,
        detail: 'The rail config declares no offerings for this app.',
      );
    }

    // 🔒 [pipeline 5]M-7 — ATTRIBUTION BEFORE MONEY. The store SDK is told which
    // account is buying BEFORE the sheet opens, so the provider's webhook
    // resolves to a person. Without it the payment arrives unclaimed, and an
    // unclaimed IN-APP purchase is a defect, not a supported state.
    final String? account = _bridgeConfig.appUserId;
    if (account == null || account.isEmpty) {
      return const CheckoutRefused(
        CheckoutRefusal.notSignedIn,
        detail: 'A purchase must be attributable to an account.',
      );
    }

    if (!await _ensureConfigured()) {
      return const CheckoutRefused(
        CheckoutRefusal.railNotConfigured,
        detail: 'The store billing SDK could not be configured on this device.',
      );
    }

    final IapPurchaseResult r = await _bridge.purchase(offering);
    switch (r.outcome) {
      case IapPurchaseOutcome.submitted:
        return CheckoutSubmitted(offering: offering);
      case IapPurchaseOutcome.cancelledByUser:
        return CheckoutRefused(
          CheckoutRefusal.purchaseCancelled,
          detail: r.detail,
        );
      case IapPurchaseOutcome.storeRefused:
        return CheckoutRefused(
          CheckoutRefusal.channelNotPermitted,
          detail: r.detail,
        );
      case IapPurchaseOutcome.unavailable:
        return CheckoutRefused(CheckoutRefusal.couldNotOpen, detail: r.detail);
    }
  }

  /// Ask the store to restore prior purchases — [pipeline 5]M-10.
  ///
  /// Returns whether the store had anything to give back. It STILL does not
  /// unlock: the caller converges on the server afterwards, the same as after a
  /// purchase, because a restore is a claim about the past and the entitlement
  /// row is the answer.
  Future<IapPurchaseResult> restorePurchases() async {
    if (!_railKind.isStoreBilling) {
      return const IapPurchaseResult(
        IapPurchaseOutcome.unavailable,
        detail: 'This channel does not sell through a store billing rail.',
      );
    }
    if (!await _ensureConfigured()) {
      return const IapPurchaseResult(
        IapPurchaseOutcome.unavailable,
        detail: 'The store billing SDK could not be configured on this device.',
      );
    }
    return _bridge.restore();
  }

  @override
  Future<CancellationOutcome> requestCancellation() async {
    // ── 1 · OUR OWN RECORD FIRST, ALWAYS ────────────────────────────────────
    // Written before the store page is opened, so a failure to open leaves the
    // evidence that the customer asked. Doing it the other way round means the
    // one case where the user needs the record — the page did not open — is the
    // case where nothing was written.
    final core.Result<core.CancellationReceipt> r = await _cancellations
        .requestCancellation(appId: _appId, accessToken: await _accessToken());

    final CancellationOutcome recorded = r.fold((core.CancellationReceipt rec) {
      if (!rec.hasActivePlan) return CancellationOutcome.noActivePlan;
      if (rec.executed) return CancellationOutcome.executed;
      if (rec.recorded) return CancellationOutcome.recorded;
      return CancellationOutcome.failed;
    }, (core.Failure _) => CancellationOutcome.failed);

    // ── 2 · THEN THE STORE'S OWN MANAGEMENT PAGE ────────────────────────────
    // 🔴 ONLY THE STORE CAN STOP THE RENEWAL. Neither our Worker nor this SDK
    // can cancel a Play or App Store subscription on the customer's behalf, so
    // reporting `executed` on the strength of our record alone would tell a
    // customer they cancelled while the charge stayed on their card. The page is
    // opened for every outcome in which a plan exists, including
    // [CancellationOutcome.failed]: our host being unreachable is not a reason
    // to withhold the only control that actually works.
    if (recorded != CancellationOutcome.noActivePlan) {
      await _openManagementPage();
    }
    return recorded;
  }

  /// Opens the store's subscription-management page when the store supplies one.
  ///
  /// Answers whether it opened, for tests and for a UI that wants to fall back
  /// to instructions. A store that returns no URL is a normal answer — not every
  /// storefront exposes one — and the caller shows the written path instead.
  Future<bool> _openManagementPage() async {
    if (!await _ensureConfigured()) return false;
    IapCustomerState state;
    try {
      state = await _bridge.currentCustomerState();
    } catch (e) {
      debugPrint('[purchases] could not read store customer state: $e');
      return false;
    }
    final Uri? url = state.managementUrl;
    if (url == null) return false;
    return _launcher.open(url);
  }
}
