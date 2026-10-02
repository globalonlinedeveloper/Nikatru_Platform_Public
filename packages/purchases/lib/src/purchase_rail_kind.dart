import 'generated/rails.dart';
import 'purchase_capabilities.dart';

/// WHICH RAIL A CHANNEL SELLS THROUGH — the client-side view of
/// `tooling/channel-register.json` → `purchaseRails`, per channel.
///
/// 🔴 RENDERED, NOT RESTATED. The answer per channel is
/// `generated/rails.dart`'s `kChannelRailKind`, which `tooling/ports/render.mjs`
/// renders from the register (and `--check`, run by assert-ports limb 3 on
/// every build, fails on a hand edit or a register edit not re-rendered). This
/// file used to carry a `switch` with one `case` per channel — a second copy of
/// the decision [ADR 039] locked, compared to the register by a guard but still
/// typed by hand. A channel moving rail is now a register edit and a re-render,
/// and nothing in Dart names a payment vendor.
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
  /// A hosted checkout page owned by the merchant of record, opened in the
  /// browser ([ADR 038]). WHICH merchant serves it is the server's business —
  /// the Worker's rail table picks it per channel and market — so the client
  /// names none: this was `paddle` until port-pay-client.
  hosted('hosted'),

  /// Google Play Billing, reached through the [IapBridge] seam. [ADR 039] D2/D5.
  playBilling('play-billing'),

  /// Apple StoreKit in-app purchase, same seam. [ADR 039] D3/D5.
  appleIap('apple-iap'),

  /// This channel sells nothing and must open no checkout of any kind. It
  /// exists so a channel that must not sell can SAY so rather than being absent
  /// and read as somebody not having got to it.
  none('none');

  const PurchaseRailKind(this.wire);

  /// The kind's value in the rendered map: a STORE rail's register id
  /// (`play-billing`, `apple-iap`), `none`, or `hosted` for every rail that is
  /// a hosted page, whichever vendor serves it.
  final String wire;

  /// Whether this rail is a STORE billing system rather than a hosted page.
  /// The facade's single predicate — a caller that tests
  /// `== PurchaseRailKind.playBilling || == appleIap` at a call site is one
  /// place a third store rail would be forgotten.
  bool get isStoreBilling =>
      this == PurchaseRailKind.playBilling || this == PurchaseRailKind.appleIap;

  /// The kind whose [wire] is [wire]; [none] for anything else.
  ///
  /// 🔒 FAIL CLOSED. A channel the rendered map does not name, or a kind this
  /// enum does not know, sells NOTHING — a build that cannot say which rail it
  /// takes must not guess one, because on a store channel the wrong guess is an
  /// external checkout inside a store build.
  static PurchaseRailKind fromWire(String? wire) {
    for (final PurchaseRailKind k in PurchaseRailKind.values) {
      if (k.wire == wire) return k;
    }
    return PurchaseRailKind.none;
  }

  /// The rail [channel] sells through — the register's answer, as rendered.
  static PurchaseRailKind forChannel(PurchaseChannel channel) =>
      fromWire(kChannelRailKind[channel.registerId]);
}
