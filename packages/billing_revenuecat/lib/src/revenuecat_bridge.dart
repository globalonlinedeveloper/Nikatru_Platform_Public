import 'dart:async';

import 'package:flutter/foundation.dart'
    show TargetPlatform, debugPrint, defaultTargetPlatform, kIsWeb;
import 'package:flutter/services.dart' show PlatformException;
import 'package:nikatru_purchases/nikatru_purchases.dart';
import 'package:purchases_flutter/purchases_flutter.dart' as rc;

import 'revenuecat_capabilities.dart';

/// The RevenueCat implementation of [IapBridge] — [ADR 067] decision 7,
/// [ADR 039] D5.
///
/// ## What it is allowed to decide, which is almost nothing
/// It configures the SDK, asks the store what it sells and at what price, runs
/// the store's sheet, and reports what the store said. It NEVER unlocks: nothing here
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

  /// [ADR 085] B — a sign-in or account switch after [configure].
  /// `Purchases.logIn` re-identifies the SDK, so the next webhook event carries
  /// the NIKATRU user id the platform links on. Its `LogInResult` is DISCARDED
  /// for the same reason [purchase]'s is: the store's `CustomerInfo` is not an
  /// entitlement.
  @override
  Future<bool> identify(String appUserId) async {
    if (!_capabilities.canPurchase && !_capabilities.canRestore) return false;
    if (appUserId.isEmpty) return false;
    try {
      await rc.Purchases.logIn(appUserId);
      return true;
    } on PlatformException catch (e) {
      debugPrint('[billing_revenuecat] logIn refused: ${e.code}');
      return false;
    } catch (e) {
      debugPrint('[billing_revenuecat] logIn failed: $e');
      return false;
    }
  }

  /// [ADR 085] B — a sign-out. `Purchases.logOut` drops the identified user
  /// and the SDK mints an anonymous id, which the platform webhook refuses and
  /// `IapRail` never sells to (it refuses `notSignedIn` first).
  @override
  Future<bool> logOut() async {
    if (!_capabilities.canPurchase && !_capabilities.canRestore) return false;
    try {
      await rc.Purchases.logOut();
      return true;
    } on PlatformException catch (e) {
      debugPrint('[billing_revenuecat] logOut refused: ${e.code}');
      return false;
    } catch (e) {
      debugPrint('[billing_revenuecat] logOut failed: $e');
      return false;
    }
  }

  void _onCustomerInfo(rc.CustomerInfo info) {
    if (_states.isClosed) return;
    _states.add(customerStateFrom(info));
  }

  /// The store's own description of every plan it sells here — price,
  /// currency, term, and the free trial THIS buyer is eligible for.
  ///
  /// Eligibility is the store's to decide, and the two stores decide it in
  /// different places. Play offers only what the buyer is eligible for, and the
  /// SDK's `defaultOption` is already chosen from those. The App Store attaches
  /// its introductory offer to the product for EVERY buyer, so it is shown only
  /// when `checkTrialOrIntroductoryPriceEligibility` says this buyer is
  /// eligible; a check that fails counts as not eligible, because "1 month
  /// free" to somebody who already had it is a promise the sheet then breaks.
  @override
  Future<List<StorePlan>> storePlans() async {
    if (!_capabilities.canPurchase) return const <StorePlan>[];
    try {
      final rc.Offerings offerings = await rc.Purchases.getOfferings();
      final Set<String>? appleEligible =
          _usesAppleIntroRules ? await _appleIntroEligible(offerings) : null;
      return storePlansOf(offerings, appleIntroEligible: appleEligible);
    } on PlatformException catch (e) {
      debugPrint('[billing_revenuecat] getOfferings refused: ${e.code}');
      return const <StorePlan>[];
    } catch (e) {
      debugPrint('[billing_revenuecat] getOfferings failed: $e');
      return const <StorePlan>[];
    }
  }

  bool get _usesAppleIntroRules =>
      !kIsWeb &&
      (defaultTargetPlatform == TargetPlatform.iOS ||
          defaultTargetPlatform == TargetPlatform.macOS);

  Future<Set<String>> _appleIntroEligible(rc.Offerings offerings) async {
    final List<String> ids = <String>[
      for (final rc.Offering o in offerings.all.values)
        for (final rc.Package p in o.availablePackages)
          if (p.storeProduct.introductoryPrice != null)
            p.storeProduct.identifier,
    ];
    if (ids.isEmpty) return const <String>{};
    try {
      final Map<String, rc.IntroEligibility> answer =
          await rc.Purchases.checkTrialOrIntroductoryPriceEligibility(ids);
      return <String>{
        for (final MapEntry<String, rc.IntroEligibility> e in answer.entries)
          if (e.value.status ==
              rc.IntroEligibilityStatus.introEligibilityStatusEligible)
            e.key,
      };
    } catch (e) {
      debugPrint('[billing_revenuecat] intro eligibility unknown: $e');
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
    Map<String, rc.Package> packages;
    try {
      final rc.Offerings offerings = await rc.Purchases.getOfferings();
      packages = packagesFor(offerings, offering.productId);
    } on PlatformException catch (e) {
      return outcomeForPlatformException(e);
    } catch (e) {
      return IapPurchaseResult(
        IapPurchaseOutcome.unavailable,
        detail: 'Could not read the store offerings: $e',
      );
    }
    if (packages.isEmpty) {
      // 🔴 A REFUSAL, NOT A FAILURE. The rail config sells a SKU this storefront
      // does not carry — a real state in a portfolio priced per market — and the
      // paywall has to say so rather than opening a sheet that cannot complete.
      return IapPurchaseResult(
        IapPurchaseOutcome.storeRefused,
        detail: 'The store does not offer ${offering.productId} here.',
      );
    }
    if (packages.length > 1) {
      // 🔴 A REFUSAL, NOT A PICK. Two base plans behind one product id bill
      // different amounts or terms, and choosing either would charge a buyer
      // for a plan the paywall did not describe.
      return IapPurchaseResult(
        IapPurchaseOutcome.storeRefused,
        detail: ambiguousPlanDetail(offering.productId, packages.keys),
      );
    }
    final rc.Package package = packages.values.single;
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
// visible in these functions and every one of them is exercised directly.
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

/// What the RAIL calls the store product [identifier]: the part before the
/// first `:`.
///
/// 🔴 THE ONE PLACE THIS IS DECIDED. RevenueCat reports a Play subscription as
/// `<subscription id>:<base plan id>` (`pro_monthly:monthly`) and an App Store
/// product as its bare id (`pro_monthly`); the rail config names the product
/// once, as the bare id. An exact comparison of the two found nothing on Play,
/// so every Play purchase was refused as "not offered here". Every lookup below
/// goes through this function, so the two stores cannot be matched two ways.
String railProductIdOf(String identifier) {
  final int colon = identifier.indexOf(':');
  return colon == -1 ? identifier : identifier.substring(0, colon);
}

/// Every rail product id the current offerings can sell.
Set<String> productIdsOf(rc.Offerings offerings) => <String>{
      for (final rc.Offering o in offerings.all.values)
        for (final rc.Package p in o.availablePackages)
          railProductIdOf(p.storeProduct.identifier),
    };

/// Every package that sells the rail's [productId], keyed by the STORE's
/// identifier. The same identifier in two RevenueCat offerings is one plan and
/// appears once; two identifiers are two base plans.
Map<String, rc.Package> packagesFor(rc.Offerings offerings, String productId) {
  final Map<String, rc.Package> out = <String, rc.Package>{};
  for (final rc.Offering o in offerings.all.values) {
    for (final rc.Package p in o.availablePackages) {
      final String id = p.storeProduct.identifier;
      if (railProductIdOf(id) == productId) out.putIfAbsent(id, () => p);
    }
  }
  return out;
}

/// The one package that sells [productId], or null when this storefront has
/// none — or has more than one base plan for it, which [RevenueCatBridge]
/// refuses rather than picks.
rc.Package? packageFor(rc.Offerings offerings, String productId) {
  final Map<String, rc.Package> found = packagesFor(offerings, productId);
  return found.length == 1 ? found.values.single : null;
}

/// The refusal for a product the store sells under more than one base plan.
String ambiguousPlanDetail(String productId, Iterable<String> identifiers) {
  final List<String> sorted = identifiers.toList()..sort();
  return 'The store offers $productId under more than one base plan '
      '(${sorted.join(', ')}); a plan is sold under exactly one, so '
      'nothing was sold.';
}

/// The store's plans as the rail reads them — one per rail product id.
///
/// [appleIntroEligible] is the App Store identifiers whose introductory offer
/// THIS buyer is eligible for; null on a store that only offers what the buyer
/// is eligible for (Play), where `defaultOption` already carries the answer.
///
/// Dropped, each with a debug line, never guessed: a product whose price or
/// currency cannot be read, a billing period that is not one month, one year
/// or none, and a product id sold under more than one base plan. A PAID
/// introductory price is not a free trial and is not shown as one.
List<StorePlan> storePlansOf(
  rc.Offerings offerings, {
  Set<String>? appleIntroEligible,
}) {
  final Map<String, Map<String, rc.StoreProduct>> byRailId =
      <String, Map<String, rc.StoreProduct>>{};
  for (final rc.Offering o in offerings.all.values) {
    for (final rc.Package p in o.availablePackages) {
      final rc.StoreProduct sp = p.storeProduct;
      byRailId
          .putIfAbsent(
            railProductIdOf(sp.identifier),
            () => <String, rc.StoreProduct>{},
          )
          .putIfAbsent(sp.identifier, () => sp);
    }
  }
  final List<StorePlan> out = <StorePlan>[];
  for (final MapEntry<String, Map<String, rc.StoreProduct>> e
      in byRailId.entries) {
    if (e.value.length > 1) {
      debugPrint(
        '[billing_revenuecat] ${ambiguousPlanDetail(e.key, e.value.keys)}',
      );
      continue;
    }
    final rc.StoreProduct sp = e.value.values.single;
    final String code = sp.currencyCode.toUpperCase();
    final int? amount = StorePlan.minorUnitsOf(sp.price, code);
    final OfferingTerm? term = termOfPeriod(sp.subscriptionPeriod);
    if (amount == null || term == null) {
      debugPrint(
        '[billing_revenuecat] dropped ${sp.identifier}: price ${sp.price} '
        '$code, period ${sp.subscriptionPeriod}',
      );
      continue;
    }
    out.add(
      StorePlan(
        productId: e.key,
        amountMinor: amount,
        currencyCode: code,
        term: term,
        trial: appleIntroEligible == null
            ? playFreeTrialOf(sp)
            : appleFreeTrialOf(
                sp,
                eligible: appleIntroEligible.contains(sp.identifier),
              ),
      ),
    );
  }
  return out;
}

/// The term an ISO 8601 billing period bills per. None (a non-subscription
/// product) is one-time; a period the rail has no word for is null, and the
/// plan is dropped rather than described as the nearest term.
OfferingTerm? termOfPeriod(String? iso8601) => switch (iso8601) {
      null || '' => OfferingTerm.oneTime,
      'P1M' => OfferingTerm.month,
      'P1Y' => OfferingTerm.year,
      _ => null,
    };

TrialUnit? _trialUnitOf(rc.PeriodUnit unit) => switch (unit) {
      rc.PeriodUnit.day => TrialUnit.day,
      rc.PeriodUnit.week => TrialUnit.week,
      rc.PeriodUnit.month => TrialUnit.month,
      rc.PeriodUnit.year => TrialUnit.year,
      rc.PeriodUnit.unknown => null,
    };

/// Play: the FREE phase of the offer the SDK chose for this buyer, in its own
/// unit. Play lists only the offers a buyer is eligible for.
TrialPeriod? playFreeTrialOf(rc.StoreProduct product) {
  final rc.PricingPhase? free = product.defaultOption?.freePhase;
  final rc.Period? period = free?.billingPeriod;
  if (free == null || period == null || period.value <= 0) return null;
  final TrialUnit? unit = _trialUnitOf(period.unit);
  if (unit == null) return null;
  final int cycles = free.billingCycleCount ?? 1;
  return TrialPeriod(
    count: period.value * (cycles > 1 ? cycles : 1),
    unit: unit,
  );
}

/// App Store: the introductory offer, when it is FREE and this buyer is
/// [eligible] for it. A paid introductory price is dropped with a debug line —
/// it is a discount, and the paywall has no words for one.
TrialPeriod? appleFreeTrialOf(
  rc.StoreProduct product, {
  required bool eligible,
}) {
  final rc.IntroductoryPrice? intro = product.introductoryPrice;
  if (intro == null || !eligible) return null;
  if (intro.price != 0) {
    debugPrint(
      '[billing_revenuecat] ${product.identifier}: a paid introductory price '
      'is not shown as a trial',
    );
    return null;
  }
  final TrialUnit? unit = _trialUnitOf(intro.periodUnit);
  if (unit == null || intro.periodNumberOfUnits <= 0) return null;
  return TrialPeriod(count: intro.periodNumberOfUnits, unit: unit);
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
