import 'purchase_capabilities.dart';

/// WHICH RAIL A CHANNEL SELLS THROUGH — the client-side view of
/// `tooling/channel-register.json` → `purchaseRails.rails`, per channel.
///
/// 🔴 THE NAMES ARE THE REGISTER'S OWN `rail` VALUES, and that is load-bearing
/// in exactly the way [PurchaseChannel]'s ids are: `tooling/ci/
/// assert-purchase-path.mjs` §G4(e) holds this map equal to the register's
/// per-channel decision, both directions. Without that limb this file would be
/// a SECOND COPY of the register — a decision restated in Dart, free to drift
/// from the one [ADR 039] locked, with nothing comparing them.
///
/// ## Why the rail kind lives here rather than in [PurchaseCapabilities]
/// [PurchaseCapabilities] answers "may this build open a HOSTED checkout?" —
/// `technicallySupported` is `url_launcher`'s question and `channelPermitted` is
/// a store-policy one, and both are about the EXTERNAL page. Neither can express
/// "this channel sells through the store's own billing system", because that is
/// not a permission at all: it is a different mechanism. Overloading
/// `channelPermitted` to mean it would make `android-play` read as sellable to
/// the hosted rail, which is the documented removal cause §G4(d) exists to
/// catch. So the two vocabularies stay separate and the facade reads both.
enum PurchaseRailKind {
  /// The merchant-of-record hosted checkout, opened in the browser. [ADR 038].
  paddle('paddle'),

  /// Google Play Billing, reached through the [IapBridge] seam. [ADR 039] D2/D5.
  playBilling('play-billing'),

  /// Apple StoreKit in-app purchase, same seam. [ADR 039] D3/D5.
  appleIap('apple-iap'),

  /// This channel sells nothing and must open no checkout of any kind. No
  /// channel carries it today; it exists so a channel that must not sell can
  /// SAY so rather than being absent and read as somebody not having got to it.
  none('none');

  const PurchaseRailKind(this.registerId);

  /// The value this rail carries in `tooling/channel-register.json`.
  final String registerId;

  /// Whether this rail is a STORE billing system rather than a hosted page.
  /// The facade's single predicate — a caller that tests
  /// `== PurchaseRailKind.playBilling || == appleIap` at a call site is one
  /// place a third store rail would be forgotten.
  bool get isStoreBilling =>
      this == PurchaseRailKind.playBilling || this == PurchaseRailKind.appleIap;

  /// The rail [channel] sells through.
  ///
  /// 🔒 EVERY ANSWER BELOW IS THE REGISTER'S, NOT AN OPINION. The comment on
  /// each case names the register row it mirrors, so a reviewer can check this
  /// switch against `channel-register.json` by reading, and CI checks it by
  /// running.
  static PurchaseRailKind forChannel(PurchaseChannel channel) {
    switch (channel) {
      case PurchaseChannel.web:
        // `web` → paddle. Our own site; no store sits between us and the buyer.
        return PurchaseRailKind.paddle;
      case PurchaseChannel.androidPlay:
        // `android-play` → play-billing, and it FORBIDS paddle. The rail follows
        // the CHANNEL, not the artifact: the sideload of this same build is
        // paddle, which is the confusion the register's own note is written for.
        return PurchaseRailKind.playBilling;
      case PurchaseChannel.iosAppStore:
        // `ios-appstore` → apple-iap. Guideline 3.1.1.
        return PurchaseRailKind.appleIap;
      case PurchaseChannel.macosAppStore:
        // `macos-appstore` → apple-iap. Same 3.1.1 family. A macOS build
        // distributed OUTSIDE the Mac App Store is a different channel and the
        // register parks it under `awaitingChannelRow`, so it has no row here.
        return PurchaseRailKind.appleIap;
      case PurchaseChannel.windowsStore:
        // `windows-store` → paddle. Microsoft Store Policies §10.8.1/§10.8.6
        // permit a third-party purchase rail for non-game PC apps ([ADR 039]).
        return PurchaseRailKind.paddle;
      case PurchaseChannel.windowsDirect:
        // `windows-direct` → paddle. Direct download; no store commerce policy.
        return PurchaseRailKind.paddle;
      case PurchaseChannel.linuxSnap:
      case PurchaseChannel.linuxAppImage:
        // Neither imposes a commerce policy on digital goods sold by the
        // publisher, so both take the hosted checkout.
        return PurchaseRailKind.paddle;
    }
  }
}
