import 'dart:async';

import 'package:flutter/foundation.dart'
    show debugPrint, defaultTargetPlatform, kIsWeb;
import 'package:flutter/services.dart' show PlatformException;
import 'package:nikatru_purchases/nikatru_purchases.dart';
import 'package:purchases_flutter/purchases_flutter.dart' as rc;

import 'revenuecat_capabilities.dart';

/// The RevenueCat implementation of [IapBridge] — [ADR 067] decision 7,
/// [ADR 039] D5.
///
/// ## What it is allowed to decide, which is almost nothing
/// It configures the SDK, asks the store what is purchasable, runs the store's
/// sheet, and reports what the store said. It NEVER unlocks: nothing here
/// touches an entitlement cache, and `CustomerInfo.entitlements` is surfaced as
/// [IapCustomerState] — a name chosen so no caller can mistake it for our own
/// entitlement record. The unlock is `GET /v1/entitlements`, converged on by
/// `nikatru_purchases`, because the store's word arrives on a device the
/// customer controls and [pipeline 5]M-5 is that the client grants nothing.
/// The grant behind that read is written only by the platform's signed
/// RevenueCat webhook, which links the event by the app user id set in
/// [configure] — the NIKATRU user id ([ADR 085]).
///
/// ## Every SDK call is wrapped
/// A `PlatformException` from a store SDK is a normal condition — offline,
/// purchases disabled by parental control, an unknown SKU in this storefront —
/// and a paywall that turns one into an unhandled async error is a crash report
/// where a sentence belongs. Every method here answers with a value.
class RevenueCatBridge implements IapBridge {
  RevenueCatBridge({RevenueCatCapabilities? capabilities})
      : _capabilities = capabilities ??
            RevenueCatCapabilities.forPlatform(
              defaultTargetPlatform,
              isWeb: kIsWeb,
            );

  final RevenueCatCapabilities _capabilities;

  final StreamController<IapCustomerState> _states =
      StreamController<IapCustomerState>.broadcast();

  bool _listenerAttached = false;

  /// Where this bridge works, and why it does not work elsewhere. Exposed so a
  /// paywall can show the REASON rather than only the refusal.
  RevenueCatCapabilities get capabilities => _capabilities;

  @override
  Stream<IapCustomerState> get customerState => _states.stream;

  @override
  Future<bool> configure(IapBridgeConfig config) async {
    if (!_capabilities.canPurchase && !_capabilities.canRestore) return false;
    if (!config.isUsable) return false;
    try {
      final rc.PurchasesConfiguration c =
          rc.PurchasesConfiguration(config.publicApiKey)
            // 🔒 [pipeline 5]M-7 — ATTRIBUTION BEFORE MONEY. The account id is
            // set BEFORE any purchase can start, so the provider's webhook
            // resolves to a person. RevenueCat would otherwise mint an
            // anonymous id and the payment would arrive unclaimed.
            ..appUserID = config.appUserId;
      await rc.Purchases.configure(c);
      if (!_listenerAttached) {
        _listenerAttached = true;
        rc.Purchases.addCustomerInfoUpdateListener(_onCustomerInfo);
      }
      return true;
    } on PlatformException catch (e) {
      debugPrint('[billing_revenuecat] configure refused: ${e.code}');
      return false;
    } catch (e) {
      debugPrint('[billing_revenuecat] configure failed: $e');
      return false;
    }
  }

  void _onCustomerInfo(rc.CustomerInfo info) {
    if (_states.isClosed) return;
    _states.add(customerStateFrom(info));
  }

  @override
  Future<Set<String>> purchasableProductIds() async {
    if (!_capabilities.canPurchase) return const <String>{};
    try {
      final rc.Offerings offerings = await rc.Purchases.getOfferings();
      return productIdsOf(offerings);
    } on PlatformException catch (e) {
      debugPrint('[billing_revenuecat] getOfferings refused: ${e.code}');
      return const <String>{};
    } catch (e) {
      debugPrint('[billing_revenuecat] getOfferings failed: $e');
      return const <String>{};
    }
  }

  @override
  Future<IapPurchaseResult> purchase(Offering offering) async {
    if (!_capabilities.canPurchase) {
      return IapPurchaseResult(
        IapPurchaseOutcome.unavailable,
        detail: _capabilities.why,
      );
    }
    rc.Package? package;
    try {
      final rc.Offerings offerings = await rc.Purchases.getOfferings();
      package = packageFor(offerings, offering.productId);
    } on PlatformException catch (e) {
      return outcomeForPlatformException(e);
    } catch (e) {
      return IapPurchaseResult(
        IapPurchaseOutcome.unavailable,
        detail: 'Could not read the store offerings: $e',
      );
    }
    if (package == null) {
      // 🔴 A REFUSAL, NOT A FAILURE. The rail config sells a SKU this storefront
      // does not carry — a real state in a portfolio priced per market — and the
      // paywall has to say so rather than opening a sheet that cannot complete.
      return IapPurchaseResult(
        IapPurchaseOutcome.storeRefused,
        detail: 'The store does not offer ${offering.productId} here.',
      );
    }
    try {
      await rc.Purchases.purchase(rc.PurchaseParams.package(package));
      // ⚠️ THE RESULT IS DELIBERATELY DISCARDED. `PurchaseResult` carries the
      // store's own `CustomerInfo`, i.e. the store's opinion about whether this
      // customer is entitled — and acting on it here is exactly the client-side
      // grant [pipeline 5]M-5 forbids. What we report is that the sheet
      // COMPLETED; the unlock comes from the server, which is fed by the
      // provider's webhook rather than by this device.
      return const IapPurchaseResult(IapPurchaseOutcome.submitted);
    } on PlatformException catch (e) {
      return outcomeForPlatformException(e);
    } catch (e) {
      return IapPurchaseResult(
        IapPurchaseOutcome.unavailable,
        detail: 'The store purchase could not be completed: $e',
      );
    }
  }

  @override
  Future<IapPurchaseResult> restore() async {
    if (!_capabilities.canRestore) {
      return IapPurchaseResult(
        IapPurchaseOutcome.unavailable,
        detail: _capabilities.why,
      );
    }
    try {
      final rc.CustomerInfo info = await rc.Purchases.restorePurchases();
      if (!_states.isClosed) _states.add(customerStateFrom(info));
      // Same rule as `purchase`: "the store found something" is not "this user
      // is Pro". The caller converges on the server afterwards either way.
      return const IapPurchaseResult(IapPurchaseOutcome.submitted);
    } on PlatformException catch (e) {
      return outcomeForPlatformException(e);
    } catch (e) {
      return IapPurchaseResult(
        IapPurchaseOutcome.unavailable,
        detail: 'The store could not restore purchases: $e',
      );
    }
  }

  @override
  Future<IapCustomerState> currentCustomerState() async {
    if (!_capabilities.canPurchase && !_capabilities.canRestore) {
      return IapCustomerState.unknown;
    }
    try {
      return customerStateFrom(await rc.Purchases.getCustomerInfo());
    } on PlatformException catch (e) {
      debugPrint('[billing_revenuecat] getCustomerInfo refused: ${e.code}');
      return IapCustomerState.unknown;
    } catch (e) {
      debugPrint('[billing_revenuecat] getCustomerInfo failed: $e');
      return IapCustomerState.unknown;
    }
  }

  /// Release the customer-state stream. A bridge outlives a screen and a test
  /// harness both, so the owner closes it explicitly.
  Future<void> dispose() => _states.close();
}

// ─────────────────────────────────────────────────────────────────────────────
// THE MAPPINGS, AS TOP-LEVEL PURE FUNCTIONS
//
// 🔴 PURE AND PUBLIC ON PURPOSE. Each of these is a translation between the
// vendor's vocabulary and ours, and a translation buried inside a method that
// also performs a platform call can only be tested by mocking the platform. The
// mistranslations that matter here — a user cancel reported as a failure, a
// management URL dropped, an inactive entitlement counted as active — are all
// visible in these three functions and every one of them is exercised directly.
// ─────────────────────────────────────────────────────────────────────────────

/// The store's belief about a customer, as our value type.
///
/// ⚠️ `entitlements.active` IS USED, NEVER `entitlements.all`. `all` includes
/// expired entitlements, so reading it would report a lapsed subscriber as
/// holding the entitlement — and while nothing here unlocks, the UI it feeds
/// would offer "manage subscription" to somebody who has none.
IapCustomerState customerStateFrom(rc.CustomerInfo info) {
  final String? url = info.managementURL;
  Uri? parsed;
  if (url != null && url.isNotEmpty) {
    final Uri? u = Uri.tryParse(url);
    // 🔒 HTTPS OR NOTHING. This value ends up in a platform `launchUrl` call —
    // an instruction to the operating system — and it arrives from a network
    // response. The same rule `RailConfig._url` applies to the checkout
    // template, applied to the store's own answer.
    if (u != null && u.scheme == 'https' && u.host.isNotEmpty) parsed = u;
  }
  return IapCustomerState(
    activeEntitlementIds: info.entitlements.active.keys.toSet(),
    managementUrl: parsed,
  );
}

/// Every store product id the current offerings can sell.
Set<String> productIdsOf(rc.Offerings offerings) {
  final Set<String> out = <String>{};
  for (final rc.Offering o in offerings.all.values) {
    for (final rc.Package p in o.availablePackages) {
      out.add(p.storeProduct.identifier);
    }
  }
  return out;
}

/// The package that sells [productId], or null when this storefront has none.
rc.Package? packageFor(rc.Offerings offerings, String productId) {
  for (final rc.Offering o in offerings.all.values) {
    for (final rc.Package p in o.availablePackages) {
      if (p.storeProduct.identifier == productId) return p;
    }
  }
  return null;
}

/// The store's error, as an outcome the UI can explain.
///
/// 🔴 A USER CANCEL IS NOT A FAILURE, and this is the mapping that decides it.
/// RevenueCat reports a dismissed sheet as a `PlatformException`, so the naive
/// `catch` reports "purchase failed" to somebody who deliberately backed out —
/// which is how a paywall teaches people it is broken.
IapPurchaseResult outcomeForPlatformException(PlatformException e) {
  rc.PurchasesErrorCode code;
  try {
    code = rc.PurchasesErrorHelper.getErrorCode(e);
  } catch (_) {
    // `getErrorCode` parses the exception's `code` as a number and throws on
    // anything else — a MissingPluginException, for one. "We could not ask" is
    // the honest answer there, not "the store said no".
    return IapPurchaseResult(
      IapPurchaseOutcome.unavailable,
      detail: e.message ?? e.code,
    );
  }
  switch (code) {
    case rc.PurchasesErrorCode.purchaseCancelledError:
      return IapPurchaseResult(
        IapPurchaseOutcome.cancelledByUser,
        detail: e.message ?? 'The purchase was cancelled.',
      );
    case rc.PurchasesErrorCode.purchaseNotAllowedError:
    case rc.PurchasesErrorCode.purchaseInvalidError:
    case rc.PurchasesErrorCode.productNotAvailableForPurchaseError:
    case rc.PurchasesErrorCode.productAlreadyPurchasedError:
    case rc.PurchasesErrorCode.ineligibleError:
    case rc.PurchasesErrorCode.paymentPendingError:
      return IapPurchaseResult(
        IapPurchaseOutcome.storeRefused,
        detail: e.message ?? code.name,
      );
    default:
      // Everything else — network, store problem, configuration, unknown — is
      // "we could not ask". Deliberately the residual case: a new error code in
      // a future SDK version lands here rather than being silently classified
      // as a refusal the user is told is final.
      return IapPurchaseResult(
        IapPurchaseOutcome.unavailable,
        detail: e.message ?? code.name,
      );
  }
}
