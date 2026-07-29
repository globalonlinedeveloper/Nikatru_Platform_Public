import 'package:flutter/foundation.dart' show TargetPlatform, immutable;

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
  });

  /// Whether the OS can draw its own in-app rating prompt.
  final bool canPrompt;

  /// Whether the app can at least send the user to a store listing.
  final bool canOpenStoreListing;

  /// Why this platform differs, in one line. Empty when it does not.
  final String note;

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
          note: 'iOS 10.3+. requestReview() does NOTHING in TestFlight, so it '
              'cannot be verified in a TestFlight build.',
        );
      case TargetPlatform.macOS:
        return const ReviewCapabilities(
          canPrompt: true,
          canOpenStoreListing: true,
          note: 'macOS 10.14+.',
        );
      case TargetPlatform.windows:
        return const ReviewCapabilities(
          canPrompt: false,
          canOpenStoreListing: true,
          note: 'in_app_review 2.0.12 implements only openStoreListing() on '
              'Windows — offer a "rate us" affordance, never an automatic '
              'prompt.',
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
