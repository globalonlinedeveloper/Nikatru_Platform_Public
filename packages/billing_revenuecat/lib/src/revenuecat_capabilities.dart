import 'package:flutter/foundation.dart' show TargetPlatform, immutable;

/// WHERE THE STORE BILLING BRIDGE ACTUALLY WORKS — [pipeline C-7].
///
/// ## Why a second capability matrix beside `PurchaseCapabilities`
/// They answer different questions and conflating them is the mistake
/// `PurchaseCapabilities` was itself split to avoid. That one asks *may this
/// build open a HOSTED checkout here* — a `url_launcher` question and a
/// store-policy question. This one asks *can a native store purchase happen
/// here at all*, which is a question about a PLATFORM SDK and has a different
/// answer on every target: on Linux and Windows there is no store to talk to,
/// on web there is no native payload to load.
///
/// 🔒 EVERY `false` BELOW IS A MECHANICAL FACT OR A REFUSAL TO GUESS, and the
/// two are labelled differently because they have different remedies. Where the
/// vendor's support for a target has NOT been read against a primary source in
/// this repository, the answer is `false` and the `why` says exactly that —
/// being wrong in that direction is a platform where we do not yet sell, and
/// being wrong in the other is a paywall that cannot complete a sale.
@immutable
class RevenueCatCapabilities {
  const RevenueCatCapabilities({
    required this.canPurchase,
    required this.canRestore,
    required this.why,
  });

  /// Whether a native store purchase can be started on this platform.
  final bool canPurchase;

  /// Whether prior purchases can be restored here — [pipeline 5]M-10. Separate
  /// from [canPurchase] because a platform that cannot sell may still be able
  /// to read what the account already owns, and folding the two would hide that.
  final bool canRestore;

  /// The one-line reason, shown in the honest-refusal UI and in CI output.
  /// Never empty: a `false` with no reason is indistinguishable from an
  /// oversight.
  final String why;

  /// The capabilities on [platform].
  static RevenueCatCapabilities forPlatform(
    TargetPlatform platform, {
    required bool isWeb,
  }) {
    if (isWeb) {
      return const RevenueCatCapabilities(
        canPurchase: false,
        canRestore: false,
        why: 'A browser has no store billing service. Web sells through the '
            'merchant-of-record hosted checkout, which is a different rail and '
            'a different package.',
      );
    }
    switch (platform) {
      case TargetPlatform.android:
        return const RevenueCatCapabilities(
          canPurchase: true,
          canRestore: true,
          why: 'Google Play Billing, reached through the plugin native payload. '
              'The rail the channel register gives `android-play`.',
        );
      case TargetPlatform.iOS:
        return const RevenueCatCapabilities(
          canPurchase: true,
          canRestore: true,
          why: 'StoreKit in-app purchase, reached through the plugin native '
              'payload. The rail the channel register gives `ios-appstore`.',
        );
      case TargetPlatform.macOS:
        return const RevenueCatCapabilities(
          canPurchase: false,
          canRestore: false,
          why: 'UNVERIFIED, therefore denied. `macos-appstore` takes '
              '`apple-iap` in the register, but this repository has not read '
              "the plugin's macOS support against a primary source, and no Mac "
              'App Store build exists to check it against (the Apple account is '
              'awaiting activation). An unverified vendor fact must never '
              'resolve to "allowed".',
        );
      case TargetPlatform.windows:
        return const RevenueCatCapabilities(
          canPurchase: false,
          canRestore: false,
          why: 'MECHANICAL: there is no store billing service to talk to. '
              'Windows ships through the Microsoft Store, which the register '
              'gives `paddle` — a third-party purchase rail Microsoft Store '
              'Policies §10.8.1 permit.',
        );
      case TargetPlatform.linux:
        return const RevenueCatCapabilities(
          canPurchase: false,
          canRestore: false,
          why: 'MECHANICAL: neither Snap nor an AppImage carries a billing '
              'service. Both channels take the hosted checkout.',
        );
      case TargetPlatform.fuchsia:
        return const RevenueCatCapabilities(
          canPurchase: false,
          canRestore: false,
          why: 'Fuchsia is not a distribution target for this factory, so there '
              'is no channel and no rail.',
        );
    }
  }

  @override
  String toString() =>
      'RevenueCatCapabilities(canPurchase: $canPurchase, canRestore: $canRestore)';
}
