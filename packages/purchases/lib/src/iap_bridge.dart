import 'package:flutter/foundation.dart' show immutable;

import 'offering.dart';

/// What an [IapBridge] needs before it can do anything.
///
/// 🔒 THE KEY ARRIVES AS A VALUE, NEVER AS A `String.fromEnvironment`. A
/// `--dart-define` would create a build-config surface, and
/// `tooling/capability-register.json`'s `vendors` block derives its surfaces
/// from exactly that spelling — so a key read that way is a vendor surface that
/// has to be registered before it exists. It is a constructor argument instead:
/// the app resolves it from its own configuration and hands it in, which is also
/// the shape that lets a test drive the seam with no build at all.
@immutable
class IapBridgeConfig {
  const IapBridgeConfig({
    required this.publicApiKey,
    required this.entitlementId,
    required this.appUserId,
  });

  /// The store SDK's PUBLIC key for this platform. Public by construction — it
  /// ships inside the binary, so it is not a secret and is never treated as one.
  final String publicApiKey;

  /// The entitlement identifier configured in the provider's dashboard, e.g.
  /// `pro`. Ours is the name the SERVER already uses; the client only reports.
  final String entitlementId;

  /// The account this purchase must be attributable to — [pipeline 5]M-7. Null
  /// when nobody is signed in, and [IapRail] refuses BEFORE the store sheet
  /// opens rather than after the money moves.
  final String? appUserId;

  bool get isUsable => publicApiKey.isNotEmpty && entitlementId.isNotEmpty;
}

/// How a store purchase attempt ended, from the STORE's point of view.
///
/// ⚠️ NOT ONE OF THESE VALUES IS AN UNLOCK, and that is the whole design. The
/// store telling us a purchase succeeded is a client-side claim about money;
/// the entitlement is a SERVER read ([pipeline 5]M-5). [submitted] means "the
/// receipt is with the store and the provider will tell our Worker about it",
/// nothing more.
enum IapPurchaseOutcome {
  /// The buyer completed the store's purchase sheet. The unlock is still
  /// pending and still comes from `GET /v1/entitlements`.
  submitted,

  /// The buyer dismissed the sheet. Not an error, and must never be reported
  /// as one — a "purchase failed" message after a deliberate cancel is how a
  /// paywall teaches people it is broken.
  cancelledByUser,

  /// The store refused: not signed in to the store, purchases disabled by
  /// parental control or MDM, product unavailable in this storefront.
  storeRefused,

  /// The bridge could not talk to the store at all (offline, SDK not
  /// configured, platform without a store). Distinct from [storeRefused]:
  /// "we could not ask" and "we asked and it said no" need different sentences.
  unavailable,
}

/// What happened when the store was asked to sell or restore.
@immutable
class IapPurchaseResult {
  const IapPurchaseResult(this.outcome, {this.detail = ''});

  final IapPurchaseOutcome outcome;

  /// Human-readable context for the UI and for CI output. Never shown alone.
  final String detail;

  bool get isSubmitted => outcome == IapPurchaseOutcome.submitted;
}

/// What the STORE currently believes about this customer.
///
/// ⚠️ A BELIEF, NOT AN ENTITLEMENT. This is deliberately not named
/// `Entitlements`: nothing here unlocks anything. It exists so the UI can offer
/// "manage subscription" and so a restore can report whether the store found
/// anything, and it is the one place a store's word is allowed to appear.
@immutable
class IapCustomerState {
  const IapCustomerState({
    required this.activeEntitlementIds,
    required this.managementUrl,
  });

  /// Nothing known. The value before [IapBridge.configure] has run, and the
  /// value when the store cannot be reached — the two are indistinguishable to
  /// the UI on purpose, because both mean "ask the server".
  static const IapCustomerState unknown = IapCustomerState(
    activeEntitlementIds: <String>{},
    managementUrl: null,
  );

  /// The entitlement ids the store says are active right now.
  final Set<String> activeEntitlementIds;

  /// The store's own subscription-management page for this customer, when the
  /// store supplies one. The SECOND half of the ROSCA cancel path — the first
  /// half is a real request to our own host ([pipeline 5]M-9).
  final Uri? managementUrl;

  bool holds(String entitlementId) =>
      activeEntitlementIds.contains(entitlementId);
}

/// THE SEAM between the money rail and a store billing SDK.
///
/// ## Why this is an interface, and why the SDK is not behind it here
/// The implementation lives in a SIBLING package (`packages/billing_revenuecat`)
/// rather than in this one, and the reason is measured rather than stylistic:
/// Subly and every stamped app depend on `nikatru_purchases`, so a native IAP
/// SDK declared here would be linked into every app in the portfolio.
/// `assert-play-declarations` limb D holds the dependency set EQUAL to the sworn
/// data-safety declaration, and the Apple `binaryInventory` does the same for
/// the privacy manifest — so the SDK would then demand purchase-history rows
/// from apps that sell nothing on mobile. [ADR 059] shape A makes mobile
/// FREE-ONLY at v1, which is most of them.
///
/// So an app OPTS IN by depending on the bridge package and declaring
/// `billing.mobileIap` in its `app.yaml`; `assert-app-yaml` holds those two
/// together in both directions.
///
/// Every method is allowed to fail, and none of them may throw for a condition
/// the caller can be told about — a store SDK that throws on "no network" turns
/// a paywall into a crash report.
abstract interface class IapBridge {
  /// Prepare the SDK. Answers false when the configuration is unusable or the
  /// platform has no store; [IapRail] then refuses with a stated reason instead
  /// of drawing a button that cannot work.
  Future<bool> configure(IapBridgeConfig config);

  /// The store product ids this build can actually sell right now.
  ///
  /// 🔴 IDS, NOT PRICES. Prices come from the rail config
  /// ([pipeline 5]M-11, and `assert-no-price-literals` enforces that no price
  /// is written in code) — what the store is asked for is whether the SKU is
  /// purchasable in this storefront, which is a fact only the store has.
  Future<Set<String>> purchasableProductIds();

  /// Run the store's purchase sheet for [offering].
  Future<IapPurchaseResult> purchase(Offering offering);

  /// Ask the store to restore prior purchases — [pipeline 5]M-10.
  Future<IapPurchaseResult> restore();

  /// The store's current belief about this customer, read once.
  Future<IapCustomerState> currentCustomerState();

  /// The same belief as it changes. A broadcast stream: the paywall, the
  /// settings screen and a test may all listen, and a single-subscription
  /// stream would make the second listener throw.
  Stream<IapCustomerState> get customerState;
}
