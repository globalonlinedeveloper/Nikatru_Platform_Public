import 'package:nikatru_purchases/nikatru_purchases.dart';

import 'revenuecat_bridge.dart';

/// The store-bridge half of an app's purchase rail: whether THIS build gets a
/// store bridge at all, and with what configuration — O-BRICK-SELLS-NOTHING-IN-A-STORE.
///
/// 🔴 ONE RULE, IN THE PACKAGE, FOR EVERY APP. It used to live in
/// `apps/subscriptiontracker/lib/state/money_providers.dart`, so the one app
/// that sold in a store carried the fail-closed rule and the brick carried a
/// literal `iapBridge: null`. A second app would have copied the eight lines
/// or shipped the null. Both the app and the brick now call [forChannel], and
/// `tooling/ci/assert-app-yaml.mjs` limb 6 (e) refuses an app that declares
/// `billing.mobileIap` and does not.
///
/// The rule, moved verbatim: a bridge is built only for a channel the register
/// knows, whose rail kind is store billing, and only when the build carries a
/// public SDK key. Keyless (a fork's PR, a missing secret, every non-store
/// lane) there is NO bridge and NO config, so the facade answers
/// `iapBridgeMissing` and the store build sells nothing — it never falls back
/// to the web rail, because the facade picks the rail kind from the channel
/// alone. [newBridge] is called ONLY when a bridge is built: a RevenueCat
/// bridge configured on web or Windows would be an SDK call with no store
/// behind it.
abstract final class StoreBridgeWiring {
  /// The bridge and its configuration for a binary built for
  /// [releaseChannel] — both null, or both set.
  ///
  /// [publicKey] is the store SDK's PUBLIC key the store lanes compile in
  /// (`--dart-define=REVENUECAT_KEY`, resolved per app by
  /// `tooling/ci/store-key-secret.mjs`). [entitlementId] is the app's
  /// `billing.mobileIap.entitlementId`. The buyer's id is NOT passed: the SDK
  /// is configured on the first store call, and by then the rail has handed it
  /// the settled sign-in ([ADR 085] B).
  static ({IapBridge? bridge, IapBridgeConfig? config}) forChannel(
    String releaseChannel, {
    required String publicKey,
    required String entitlementId,
    IapBridge Function() newBridge = RevenueCatBridge.new,
  }) {
    final PurchaseChannel? channel = ChassisBilling.channelNamed(
      releaseChannel,
    );
    final bool bridged = channel != null &&
        PurchaseRailKind.forChannel(channel).isStoreBilling &&
        publicKey.isNotEmpty;
    if (!bridged) return (bridge: null, config: null);
    return (
      bridge: newBridge(),
      config: IapBridgeConfig(
        publicApiKey: publicKey,
        entitlementId: entitlementId,
        appUserId: null,
      ),
    );
  }
}
