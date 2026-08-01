import 'package:flutter/foundation.dart' show TargetPlatform, immutable;

/// One distribution channel the factory ships through.
///
/// 🔴 THE NAMES ARE THE `id` VALUES IN `tooling/channel-register.json`, and that
/// is load-bearing rather than tidy: `tooling/ci/assert-purchase-path.mjs`
/// asserts this enum covers EVERY registered channel. Add a channel to the
/// register with no row here and the build goes red — which is the only way
/// "the rail declares where it may be used" can stay true as channels are added,
/// instead of quietly meaning "where it could be used in August 2026".
enum PurchaseChannel {
  web('web'),
  androidPlay('android-play'),
  iosAppStore('ios-appstore'),
  macosAppStore('macos-appstore'),
  windowsStore('windows-store'),
  windowsDirect('windows-direct'),
  linuxSnap('linux-snap'),
  linuxAppImage('linux-appimage');

  const PurchaseChannel(this.registerId);

  /// The `id` this channel carries in `tooling/channel-register.json`.
  final String registerId;
}

/// What the purchase rail can do here — [pipeline 5]M-15.
///
/// ## Two fields, and the distinction is the whole point
/// A one-boolean matrix cannot express this rail's actual shape, and a matrix
/// that cannot express its subject reads as six rows of `false` — which M-15's
/// original acceptance criterion would have scored as a complete matrix and a
/// perfectly degrading rail.
///
/// - [technicallySupported] — can this build physically start the checkout?
///   That is `url_launcher`'s question, and on the pinned **6.x** the answer is
///   yes on all six targets.
/// - [channelPermitted] — is this build ALLOWED to? That is a store-policy
///   question, and the answer is no on the mobile stores no matter how well the
///   code works.
///
/// Conflating them produces exactly one of two lies: "we cannot take payment on
/// iOS" (false — the code works fine; the policy forbids it) or "we can take
/// payment on iOS" (false in the way that gets an app rejected).
///
/// ## The matrix is pinned
/// Tied to **`url_launcher` 6.x** and to the store policies as read on
/// **2026-08-01**. Re-review on any dependency bump and whenever a channel's
/// commerce policy changes.
@immutable
class PurchaseCapabilities {
  const PurchaseCapabilities({
    required this.technicallySupported,
    required this.channelPermitted,
    required this.why,
  });

  /// Whether the build can open a hosted checkout at all.
  final bool technicallySupported;

  /// Whether the distribution channel's policy permits selling digital content
  /// through a rail that is not the platform's own billing system.
  final bool channelPermitted;

  /// The one-line reason, shown in the honest-refusal UI and in CI output. Never
  /// empty: a `false` with no reason is indistinguishable from an oversight.
  final String why;

  /// Whether a purchase may actually be STARTED here. Both halves, always —
  /// this is the single predicate the paywall consults, so the two can never
  /// drift apart at a call site.
  bool get canStartCheckout => technicallySupported && channelPermitted;

  /// The capabilities of one distribution [channel].
  ///
  /// 🔒 EVERY `channelPermitted: false` BELOW CITES A POLICY, and where the
  /// policy could not be established from a primary source the answer is FALSE
  /// and says so. An UNVERIFIED vendor fact must never resolve to "allowed":
  /// being wrong in that direction is an app removal, and being wrong in the
  /// other is a platform where we do not yet sell.
  static PurchaseCapabilities forChannel(PurchaseChannel channel) {
    switch (channel) {
      case PurchaseChannel.web:
        return const PurchaseCapabilities(
          technicallySupported: true,
          channelPermitted: true,
          why: 'Our own site. No store sits between us and the buyer.',
        );
      case PurchaseChannel.androidPlay:
        return const PurchaseCapabilities(
          technicallySupported: true,
          channelPermitted: false,
          why:
              'Google Play requires Play Billing for in-app digital purchases. '
              '39-CHASSIS §4 cut 5 defers a native IAP rail, so this app sells '
              'nothing here — it points at the web instead of shipping a second '
              'rail nobody has built.',
        );
      case PurchaseChannel.iosAppStore:
        return const PurchaseCapabilities(
          technicallySupported: true,
          channelPermitted: false,
          why:
              'App Store Review Guideline 3.1.1 requires in-app purchase for '
              'digital content. Launching an external checkout is a documented '
              'rejection cause, not a grey area.',
        );
      case PurchaseChannel.macosAppStore:
        return const PurchaseCapabilities(
          technicallySupported: true,
          channelPermitted: false,
          why:
              'Same 3.1.1 family as iOS. A macOS build distributed OUTSIDE the '
              'Mac App Store is not this channel and is not covered by this row.',
        );
      case PurchaseChannel.windowsStore:
        return const PurchaseCapabilities(
          technicallySupported: true,
          channelPermitted: false,
          // ⚠️ UNVERIFIED — and therefore NO. Microsoft Store policy on using a
          // developer's own commerce engine for digital goods has not been read
          // against a primary source in this repo. Guessing "allowed" risks a
          // takedown on the single store identity L21 depends on.
          why:
              'UNVERIFIED: Microsoft Store commerce policy has not been checked '
              'against a primary source. Undecidable ⇒ denied. windows-direct '
              'carries the Windows rail until it is.',
        );
      case PurchaseChannel.windowsDirect:
        return const PurchaseCapabilities(
          technicallySupported: true,
          channelPermitted: true,
          why: 'Direct download. No store commerce policy applies.',
        );
      case PurchaseChannel.linuxSnap:
      case PurchaseChannel.linuxAppImage:
        return const PurchaseCapabilities(
          technicallySupported: true,
          channelPermitted: true,
          why:
              'Neither the Snap Store nor an AppImage imposes a commerce policy '
              'on digital goods sold by the publisher.',
        );
    }
  }

  /// The capabilities for [platform], taking the RESTRICTIVE answer where a
  /// platform ships through more than one channel.
  ///
  /// 🔴 RESTRICTIVE, NOT OPTIMISTIC, and Windows is why the rule needs writing
  /// down: it ships through `windows-store` AND `windows-direct`, and a build
  /// does not know at runtime which one installed it. Taking the permissive
  /// answer would put an external checkout inside a Store build on the strength
  /// of the direct build's freedom. A caller that DOES know its channel should
  /// use [forChannel] and get the better answer honestly.
  static PurchaseCapabilities forPlatform(
    TargetPlatform platform, {
    required bool isWeb,
  }) {
    if (isWeb) return forChannel(PurchaseChannel.web);
    switch (platform) {
      case TargetPlatform.android:
        return forChannel(PurchaseChannel.androidPlay);
      case TargetPlatform.iOS:
        return forChannel(PurchaseChannel.iosAppStore);
      case TargetPlatform.macOS:
        return forChannel(PurchaseChannel.macosAppStore);
      case TargetPlatform.windows:
        return forChannel(PurchaseChannel.windowsStore);
      case TargetPlatform.linux:
        return forChannel(PurchaseChannel.linuxSnap);
      case TargetPlatform.fuchsia:
        // Declared, and not a target. Not a channel either, so there is no row
        // to be restrictive about — it simply cannot sell.
        return const PurchaseCapabilities(
          technicallySupported: false,
          channelPermitted: false,
          why: 'Fuchsia is not a distribution target for this factory.',
        );
    }
  }

  @override
  String toString() =>
      'PurchaseCapabilities(technicallySupported: $technicallySupported, '
      'channelPermitted: $channelPermitted)';
}
