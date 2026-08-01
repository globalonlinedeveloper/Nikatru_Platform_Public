import 'package:flutter/foundation.dart' show TargetPlatform, immutable;

/// Which store identifier `openStoreListing()` needs on a platform — part of the
/// matrix rather than a fact the adapter re-derives, for the same reason every
/// other platform difference here is declared.
///
/// 🔴 THIS IS NOT COSMETIC. The pinned plugin runs
/// `ArgumentError.checkNotNull(appStoreId, 'appStoreId')` on iOS/macOS and the
/// same for `microsoftStoreId` on Windows — `checkNotNull`, so it throws in a
/// RELEASE build, not just under an assert. Calling the listing with no id was a
/// guaranteed throw on three of the four store platforms, swallowed by the
/// adapter's `catch`. Android alone needs nothing: the Play Store resolves the
/// listing from the running app's own package name.
enum StoreIdRequirement {
  /// No id needed (Android), or no listing at all (Linux, web, Fuchsia).
  none,

  /// Apple's numeric App Store id — iOS and macOS.
  appStore,

  /// The Microsoft Store product id (the `ms-windows-store://review/?ProductId=`
  /// value) — Windows.
  microsoftStore,
}

/// What a platform can do about store reviews — [pipeline C-7], [pipeline C-13].
///
/// Pinned to **`in_app_review` 2.0.12** (MIT, verified publisher britannio.dev,
/// checked against pub.dev 2026-07-29). Re-review this matrix on any version
/// bump: it is a statement about the PLUGIN, not about the OS, and the plugin is
/// what changes.
///
/// - **Android** — inline prompt via the Play In-App Review API. Needs API 21+
///   **and the Play Store present on the device**, which is a property of the
///   handset rather than the build: a de-Googled phone or a sideloaded install
///   has no store to ask. That is why [ReviewPrompter.isAvailable] is asked
///   fresh at runtime instead of being inferred from this matrix alone.
/// - **iOS** — inline prompt (10.3+). ⚠️ `requestReview()` **does nothing in
///   TestFlight**, so the feature cannot be checked in the one build a developer
///   is most likely to test it in. Do not conclude it is broken from that.
/// - **macOS** — inline prompt (10.14+).
/// - **Windows** — 🔴 **NO inline prompt.** Only `openStoreListing()` exists, so
///   the honest behaviour is a "rate us" affordance the user chooses to press,
///   never an automatic prompt.
/// - **Linux / Web / Fuchsia** — no store, nothing to ask, no listing to open.
///
/// 🔴 THE ASYMMETRY THAT MATTERS: [canPrompt] false does NOT imply
/// [canOpenStoreListing] false. Windows is exactly that row, and collapsing the
/// two into one boolean is how a Windows build would silently lose its only
/// route to the store.
@immutable
class ReviewCapabilities {
  const ReviewCapabilities({
    required this.canPrompt,
    required this.canOpenStoreListing,
    required this.note,
    this.requiredStoreId = StoreIdRequirement.none,
  });

  /// Whether the OS can draw its own in-app rating prompt.
  final bool canPrompt;

  /// Whether the app can at least send the user to a store listing.
  final bool canOpenStoreListing;

  /// Why this platform differs, in one line. Empty when it does not.
  final String note;

  /// The store id this platform's listing call cannot run without.
  final StoreIdRequirement requiredStoreId;

  /// The capabilities for [platform], with [isWeb] taking precedence — a web
  /// build reports a host [TargetPlatform] but has no plugin behind it.
  ///
  /// The platform is a PARAMETER so every row is reachable from a test. A matrix
  /// that can only be evaluated on the host leaves five of six rows permanently
  /// unexercised, which is a comment with a type.
  static ReviewCapabilities forPlatform(
    TargetPlatform platform, {
    required bool isWeb,
  }) {
    if (isWeb) {
      return const ReviewCapabilities(
        canPrompt: false,
        canOpenStoreListing: false,
        note: 'No store and no plugin on the web; a page cannot ask for a '
            'store rating.',
      );
    }
    switch (platform) {
      case TargetPlatform.android:
        return const ReviewCapabilities(
          canPrompt: true,
          canOpenStoreListing: true,
          note: 'Needs API 21+ AND the Play Store installed — check '
              'isAvailable() at runtime, not just this matrix.',
        );
      case TargetPlatform.iOS:
        return const ReviewCapabilities(
          canPrompt: true,
          canOpenStoreListing: true,
          requiredStoreId: StoreIdRequirement.appStore,
          note: 'iOS 10.3+. requestReview() does NOTHING in TestFlight, so it '
              'cannot be verified in a TestFlight build. The listing needs the '
              'numeric App Store id.',
        );
      case TargetPlatform.macOS:
        return const ReviewCapabilities(
          canPrompt: true,
          canOpenStoreListing: true,
          requiredStoreId: StoreIdRequirement.appStore,
          note: 'macOS 10.14+. The listing needs the numeric App Store id.',
        );
      case TargetPlatform.windows:
        return const ReviewCapabilities(
          canPrompt: false,
          canOpenStoreListing: true,
          requiredStoreId: StoreIdRequirement.microsoftStore,
          note: 'in_app_review 2.0.12 implements only openStoreListing() on '
              'Windows — offer a "rate us" affordance, never an automatic '
              'prompt. It needs the Microsoft Store product id.',
        );
      case TargetPlatform.linux:
      case TargetPlatform.fuchsia:
        return const ReviewCapabilities(
          canPrompt: false,
          canOpenStoreListing: false,
          note: 'No store integration exists for this platform.',
        );
    }
  }
}
